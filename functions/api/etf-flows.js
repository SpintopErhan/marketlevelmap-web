// US spot crypto ETF flows (README "ETF flows"): daily total net inflow, total net assets, value traded and cumulative
// inflow of all US spot ETFs of an asset, plus each fund's latest day, from the SoSoValue API (free key, secret
// SOSOVALUE_API_KEY; their API terms allow use in products). GET /api/etf-flows?asset=BTC|ETH|SOL|… (one asset, with
// the funds) or ?asset=ALL (every asset's last five days, no funds: the home page card).
//
// The answer is kept in D1 (`snapshots`, key `etf:v1:<ASSET>`): days already fetched are kept and new ones merged in, so
// the history grows past what one request returns (the free key gets about the last month). A visitor always gets the
// stored copy at once; when it is older than FRESH_MS it is refreshed in the background for the next visitor (no
// Worker needed). The totals cost one request; the funds 2 + one per fund (BTC: about a dozen) and are refreshed only
// for the one-asset answer. SoSoValue allows 20 requests a minute and 100,000 a month per key, so every refresh first
// takes its requests from a shared minute budget (`etf:v1:rate`); what does not fit waits for a later visitor.
import { readSnapshot, writeSnapshot } from "./weekly.js";

const API = "https://openapi.sosovalue.com/openapi/v1";
export const ASSETS = ["BTC", "ETH", "SOL", "XRP", "LTC", "HBAR", "DOGE", "LINK", "AVAX", "DOT"];
const FRESH_MS = 3 * 3600 * 1000; // US flows are published after the US close and corrected the next morning
const RETRY_MS = 10 * 60 * 1000; // after a failed refresh
const KEY = (asset) => `etf:v1:${asset}`;
const RATE_KEY = "etf:v1:rate";
const PER_MINUTE = 18; // of SoSoValue's 20, two kept spare

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

// Takes n requests from this minute's budget; false when they do not fit. Best effort: two refreshes starting at the same
// instant can both pass, and SoSoValue then refuses one (429), which is handled like any failed refresh.
export async function reserve(db, n, now = Date.now()) {
  const minute = Math.floor(now / 60000), s = await readSnapshot(db, RATE_KEY);
  const used = s && s.data && s.data.minute === minute ? Number(s.data.used) || 0 : 0;
  if (used + n > PER_MINUTE) return false;
  await writeSnapshot(db, RATE_KEY, { minute, used: used + n }, now);
  return true;
}
const fundsAge = (data, now) => (data && data.fundsAt ? now - Date.parse(data.fundsAt) : Infinity);

// New totals (always) and, when `withFunds` and the budget allows, each fund's latest day. Funds that could not be
// fetched leave the old fund table in place (fundsAt unchanged, so they are tried again later).
export async function refresh(env, asset, stored, { withFunds = true, now = Date.now() } = {}) {
  const db = env.USERS_DB;
  if (!(await reserve(db, 1, now))) throw new Error("busy");
  const first = !stored || !stored.days || !stored.days.length;
  const summary = summaryDays(await api(env, `/etfs/summary-history?symbol=${asset}&country_code=US&limit=${first ? 300 : 30}`));
  if (!summary.length) throw new Error("no days");
  let funds = stored && stored.funds ? stored.funds : null, fundsAt = (stored && stored.fundsAt) || null, fundsSkipped = false;
  if (withFunds) {
    const guess = (funds && funds.rows ? funds.rows.length : 12) + 1;
    fundsSkipped = true;
    if (await reserve(db, guess, now)) {
      try {
        const list = rows(await api(env, `/etfs?symbol=${asset}&country_code=US`)).filter((f) => f && typeof f.ticker === "string" && /^[A-Z0-9.]{1,10}$/.test(f.ticker)).slice(0, 20);
        if (list.length + 1 > guess && !(await reserve(db, list.length + 1 - guess, now))) throw new Error("busy");
        const histories = [];
        for (const f of list) histories.push(await api(env, `/etfs/${encodeURIComponent(f.ticker)}/history?limit=5`));
        const got = fundsDay(list, histories);
        if (got) { funds = got; fundsAt = new Date(now).toISOString(); fundsSkipped = false; }
      } catch (_) { /* the totals still update */ }
    }
  }
  const out = { schemaVersion: "marketlevelmap-etf-flows-v1", asset, source: "SoSoValue", fetchedAt: new Date(now).toISOString(), fundsAt, days: mergeDays(stored && stored.days, summary), funds };
  if (fundsSkipped) out.triedAt = new Date(now).toISOString(); // the funds wait RETRY_MS, like a failed refresh
  return out;
}

// Refresh one asset and store it; on failure keep the old copy and note the try. The stored answer or null.
function runner(env, asset, stored, opts) {
  const db = env.USERS_DB, data = stored && stored.data;
  return refresh(env, asset, data, opts).then((fresh) => writeSnapshot(db, KEY(asset), fresh, Date.now()).then(() => fresh))
    .catch(async () => { if (data) await writeSnapshot(db, KEY(asset), { ...data, triedAt: new Date().toISOString() }, stored.at); return null; });
}
const triedAgo = (data, now) => (data && data.triedAt ? now - Date.parse(data.triedAt) : Infinity);

// Every asset's last five days. Stale totals are refreshed in the background (oldest first) while the budget lasts.
async function overview(env, waitUntil, now) {
  const db = env.USERS_DB;
  const stored = await Promise.all(ASSETS.map((a) => readSnapshot(db, KEY(a))));
  const assets = [];
  ASSETS.forEach((a, i) => { const d = stored[i] && stored[i].data; if (d && d.days && d.days.length) assets.push({ asset: a, days: d.days.slice(-5) }); });
  const due = ASSETS.map((a, i) => ({ a, s: stored[i] })).filter(({ s }) => (!s || now - s.at > FRESH_MS) && triedAgo(s && s.data, now) > RETRY_MS)
    .sort((x, y) => (x.s ? x.s.at : 0) - (y.s ? y.s.at : 0));
  if (due.length && waitUntil) waitUntil((async () => { for (const { a, s } of due) if (!(await runner(env, a, s, { withFunds: false }))) break; })());
  return json({ source: "SoSoValue", assets }, 200, assets.length ? 600 : 0);
}

export async function onRequestGet({ request, env, waitUntil }) {
  const asset = String(new URL(request.url).searchParams.get("asset") || "BTC").toUpperCase();
  if (asset !== "ALL" && !ASSETS.includes(asset)) return json({ error: "asset" }, 400);
  if (!env.SOSOVALUE_API_KEY) return json({ error: "not_configured" }, 503);
  const db = env.USERS_DB, now = Date.now();
  if (asset === "ALL") return overview(env, waitUntil, now);
  const stored = await readSnapshot(db, KEY(asset));
  const data = stored && stored.data;
  const stale = !stored || now - stored.at > FRESH_MS || fundsAge(data, now) > FRESH_MS;
  if (data) {
    if (stale && triedAgo(data, now) > RETRY_MS && waitUntil) waitUntil(runner(env, asset, stored, {}));
    const { triedAt, ...out } = data;
    return json(out, 200, 600);
  }
  const fresh = await runner(env, asset, stored, {});
  if (!fresh) return json({ error: "unavailable" }, 502);
  const { triedAt, ...out } = fresh;
  return json(out, 200, 600);
}
