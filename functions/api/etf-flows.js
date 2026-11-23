// US spot crypto ETF flows (README "ETF flows"): daily total net inflow, total net assets, value traded and cumulative
// inflow of all US spot ETFs of an asset, plus each fund's latest day, from the SoSoValue API (free key, secret
// SOSOVALUE_API_KEY; their API terms allow use in products). GET /api/etf-flows?asset=BTC|ETH.
//
// The answer is kept in D1 (`snapshots`, key `etf:v1:<ASSET>`): days already fetched are kept and new ones merged in, so
// the history grows past what one request returns (SoSoValue gives at most 300 trading days per call). A visitor
// always gets the stored copy at once; when it is older than FRESH_MS it is refreshed in the background for the next
// visitor (no Worker needed). A refresh costs 2 + one request per fund (BTC: about a dozen), within SoSoValue's
// 20 requests a minute and 100,000 a month.
import { readSnapshot, writeSnapshot } from "./weekly.js";

const API = "https://openapi.sosovalue.com/openapi/v1";
const ASSETS = ["BTC", "ETH"];
const FRESH_MS = 3 * 3600 * 1000; // US flows are published after the US close and corrected the next morning
const RETRY_MS = 10 * 60 * 1000; // after a failed refresh
const KEY = (asset) => `etf:v1:${asset}`;

function json(value, status = 200, maxAge = 0) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": maxAge ? `public, max-age=${maxAge}` : "no-store" },
  });
}
const num = (v) => (v === null || v === undefined || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));
// SoSoValue dates come as "yyyy-MM-dd" (summary) or a timestamp in ms (per fund): both to "yyyy-MM-dd".
export function day(v) {
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10);
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? new Date(n > 1e11 ? n : n * 1000).toISOString().slice(0, 10) : null;
}
// The data may come bare or wrapped ({ code, data }).
const rows = (body) => (Array.isArray(body) ? body : body && Array.isArray(body.data) ? body.data : body && body.data && Array.isArray(body.data.list) ? body.data.list : []);

async function api(env, path) {
  const r = await fetch(API + path, { headers: { "x-soso-api-key": env.SOSOVALUE_API_KEY, Accept: "application/json" }, signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error(`sosovalue ${r.status}`);
  return r.json();
}
export function summaryDays(body) {
  return rows(body).map((r) => ({ date: day(r.date), netInflow: num(r.total_net_inflow), netAssets: num(r.total_net_assets), valueTraded: num(r.total_value_traded), cumInflow: num(r.cum_net_inflow) }))
    .filter((d) => d.date && d.netInflow !== null);
}
// Days kept so far plus new ones; a new value for a day replaces the old (late corrections). Oldest first.
export function mergeDays(old, fresh) {
  const map = new Map((old || []).map((d) => [d.date, d]));
  for (const d of fresh) map.set(d.date, d);
  return [...map.values()].sort((a, b) => a.date.localeCompare(b.date));
}
// Each fund's newest day: [{ ticker, name, netInflow, netAssets, premDsc, valueTraded }] for the latest date any fund
// has (funds that have not reported it yet are listed with null values).
export function fundsDay(list, histories) {
  const per = list.map((f, i) => {
    const h = rows(histories[i]).map((r) => ({ date: day(r.date), netInflow: num(r.net_inflow), netAssets: num(r.net_assets), premDsc: num(r.prem_dsc), valueTraded: num(r.value_traded) })).filter((r) => r.date);
    return { f, h };
  });
  const latest = per.reduce((m, p) => p.h.reduce((mm, r) => (r.date > mm ? r.date : mm), m), "");
  if (!latest) return null;
  return {
    date: latest,
    rows: per.map(({ f, h }) => {
      const r = h.find((x) => x.date === latest) || {};
      return { ticker: f.ticker, name: f.name || "", netInflow: r.netInflow ?? null, netAssets: r.netAssets ?? null, premDsc: r.premDsc ?? null, valueTraded: r.valueTraded ?? null };
    }).sort((a, b) => (b.netAssets || 0) - (a.netAssets || 0)),
  };
}

export async function refresh(env, asset, stored) {
  const first = !stored || !stored.days || !stored.days.length;
  const summary = summaryDays(await api(env, `/etfs/summary-history?symbol=${asset}&country_code=US&limit=${first ? 300 : 30}`));
  if (!summary.length) throw new Error("no days");
  let funds = stored && stored.funds ? stored.funds : null;
  try {
    const list = rows(await api(env, `/etfs?symbol=${asset}&country_code=US`)).filter((f) => f && typeof f.ticker === "string" && /^[A-Z0-9.]{1,10}$/.test(f.ticker)).slice(0, 20);
    const histories = [];
    for (const f of list) histories.push(await api(env, `/etfs/${encodeURIComponent(f.ticker)}/history?limit=5`).catch(() => null));
    funds = fundsDay(list, histories) || funds;
  } catch (_) { /* the totals still update */ }
  return { schemaVersion: "marketlevelmap-etf-flows-v1", asset, source: "SoSoValue", fetchedAt: new Date().toISOString(), days: mergeDays(stored && stored.days, summary), funds };
}

export async function onRequestGet({ request, env, waitUntil }) {
  const asset = String(new URL(request.url).searchParams.get("asset") || "BTC").toUpperCase();
  if (!ASSETS.includes(asset)) return json({ error: "asset" }, 400);
  if (!env.SOSOVALUE_API_KEY) return json({ error: "not_configured" }, 503);
  const db = env.USERS_DB, now = Date.now();
  const stored = await readSnapshot(db, KEY(asset));
  const data = stored && stored.data;
  const tried = data && data.triedAt ? Date.parse(data.triedAt) : 0;
  const stale = !stored || now - stored.at > FRESH_MS;
  const run = () => refresh(env, asset, data).then((fresh) => writeSnapshot(db, KEY(asset), fresh, Date.now()).then(() => fresh))
    .catch(async () => { if (data) await writeSnapshot(db, KEY(asset), { ...data, triedAt: new Date().toISOString() }, stored.at); return null; });
  if (data) {
    if (stale && now - tried > RETRY_MS && waitUntil) waitUntil(run());
    const { triedAt, ...out } = data;
    return json(out, 200, 600);
  }
  const fresh = await run();
  return fresh ? json(fresh, 200, 600) : json({ error: "unavailable" }, 502);
}
