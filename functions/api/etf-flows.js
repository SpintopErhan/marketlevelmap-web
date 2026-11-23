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

// Older history (README "ETF flows"): the summary endpoint gives the free key about a month, but SoSoValue's analysis
// charts carry the daily BTC and ETH totals for about 500 days. They give only the net flow, with no documented unit
// or time zone, so a chart is used only when it agrees with the days we already have (unit and date shift are found by
// matching), and only days we do not have are added. Tried once per asset (again a day later if it failed).
export const HISTORY_CHARTS = {
  BTC: [["total_crypto_spot_btc_eth_etf_fund_flow_1d", "bitcoin_daily_total_net_inflow"], ["total_crypto_eth_etf_fund_flow", "bitcoin_etf"]],
  ETH: [["total_crypto_spot_btc_eth_etf_fund_flow_1d", "ethereum_daily_total_net_inflow"], ["total_crypto_eth_etf_fund_flow", "ethereum_etf"]],
};
const shiftDay = (d, n) => new Date(Date.parse(d + "T00:00:00Z") + n * 86400000).toISOString().slice(0, 10);
// The chart's rows that agree with `known` (days with netInflow): { days (only new dates, oldest first), matched,
// overlap, scale, shift } or null when they do not agree well enough.
export function chartDays(body, key, known) {
  const pts = rows(body).filter((r) => r && r[key] !== undefined && r[key] !== null && r[key] !== "" && Number.isFinite(Number(r[key])))
    .map((r) => ({ date: day(r.timestamp), v: Number(r[key]) })).filter((p) => p.date);
  const have = new Map((known || []).filter((d) => d.netInflow !== null && d.netInflow !== undefined).map((d) => [d.date, d.netInflow]));
  if (!pts.length || have.size < 5) return null;
  let best = null;
  for (const scale of [1, 1e6]) for (const shift of [0, 1, -1]) {
    let overlap = 0, matched = 0;
    for (const p of pts) {
      const k = have.get(shiftDay(p.date, shift));
      if (k === undefined) continue;
      overlap++;
      if (Math.abs(p.v * scale - k) <= Math.max(1e5, 0.02 * Math.abs(k))) matched++;
    }
    if (!best || matched > best.matched) best = { scale, shift, overlap, matched };
  }
  if (best.matched < Math.max(5, 0.7 * best.overlap)) return null;
  const seen = new Set(), days = [];
  for (const p of pts) {
    const date = shiftDay(p.date, best.shift);
    if (have.has(date) || seen.has(date)) continue;
    seen.add(date);
    days.push({ date, netInflow: p.v * best.scale, netAssets: null, valueTraded: null, cumInflow: null });
  }
  days.sort((a, b) => a.date.localeCompare(b.date));
  return { days, matched: best.matched, overlap: best.overlap, scale: best.scale, shift: best.shift };
}
// Old days added under the stored ones; their cumulative inflow is worked back from the oldest known one.
export function addHistory(days, older) {
  const have = new Set(days.map((d) => d.date));
  const all = days.concat(older.filter((d) => !have.has(d.date))).sort((a, b) => a.date.localeCompare(b.date));
  for (let i = all.length - 2; i >= 0; i--) {
    const next = all[i + 1];
    if (all[i].cumInflow === null && next.cumInflow !== null && next.netInflow !== null) all[i] = { ...all[i], cumInflow: next.cumInflow - next.netInflow };
  }
  return all;
}
async function backfill(env, asset, days, prev, now) {
  const charts = HISTORY_CHARTS[asset];
  if (!charts) return { days, history: prev || null };
  if (prev && (prev.ok || now - Date.parse(prev.at) < 86400000)) return { days, history: prev };
  for (const [chart, key] of charts) {
    if (!(await reserve(env.USERS_DB, 1, now))) return { days, history: prev || null }; // next refresh tries again
    let got = null;
    try { got = chartDays(await api(env, `/analyses/${chart}?limit=500`), key, days); } catch (_) { /* try the next chart */ }
    if (got) {
      const all = addHistory(days, got.days);
      return { days: all, history: { ok: true, at: new Date(now).toISOString(), chart, from: all[0].date, added: got.days.length, matched: got.matched, overlap: got.overlap } };
    }
  }
  return { days, history: { ok: false, at: new Date(now).toISOString() } };
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
  const hist = await backfill(env, asset, mergeDays(stored && stored.days, summary), stored && stored.history, now);
  const out = { schemaVersion: "marketlevelmap-etf-flows-v1", asset, source: "SoSoValue", fetchedAt: new Date(now).toISOString(), fundsAt, days: hist.days, funds };
  if (hist.history) out.history = hist.history;
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
