// Fed and inflation (README "Fed meetings"): GET /api/fed.
// - The coming FOMC meetings' rate probabilities: SoSoValue `/macro/fomc-probabilities` (republished with credit, as
//   SoSoValue allowed on 28 Nov 2026). Each meeting has six numbers without labels; checked against CME FedWatch on
//   28 Nov 2026: position 0 is the CURRENT target range and each next position is 25 bp higher (9 Dec 2026: 375-400
//   1.6 %, 400-425 98.4 %). Should the market ever price cuts below the current range, this has to be checked again
//   (README "Fed meetings").
// - Inflation: SoSoValue's macro event history of "CPI (YoY)" and "Core PCE Price Index (YoY)" (actual, forecast).
// - The Fed's target range history: FRED (Federal Reserve Bank of St. Louis), series DFEDTARL / DFEDTARU, as the
//   dates on which the range changed.
// Stored in D1 (snapshots, key fed:v1) and refreshed in the background when older than 3 hours (10 minutes after a
// failed try), taking 3 requests from the SoSoValue minute budget shared with the ETF flows. A part that fails keeps
// its previous copy.
import { reserve } from "./etf-flows.js";
import { readSnapshot, writeSnapshot } from "./weekly.js";

const API = "https://openapi.sosovalue.com/openapi/v1";
const FRED = "https://fred.stlouisfed.org/graph/fredgraph.csv?id=DFEDTARL,DFEDTARU&cosd=2021-01-01";
const KEY = "fed:v1";
const FRESH_MS = 3 * 3600 * 1000, RETRY_MS = 10 * 60 * 1000;
const num = (v) => { const n = parseFloat(String(v == null ? "" : v).replace("%", "")); return Number.isFinite(n) ? n : null; };

function json(value, status = 200, maxAge = 0) {
  return new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": maxAge ? `public, max-age=${maxAge}` : "no-store" } });
}
const rowsOf = (b) => (b && Array.isArray(b.data) ? b.data : b && b.data && Array.isArray(b.data.list) ? b.data.list : Array.isArray(b) ? b : []);

// [{ meeting_date, probabilities: ["1.6", …] }] → [{ date, probs: [numbers] }], by date.
export function meetingsFrom(body) {
  return rowsOf(body).filter((r) => r && /^\d{4}-\d{2}-\d{2}$/.test(String(r.meeting_date)) && Array.isArray(r.probabilities))
    .map((r) => ({ date: String(r.meeting_date), probs: r.probabilities.map((p) => num(p) ?? 0) }))
    .sort((a, b) => (a.date < b.date ? -1 : 1));
}
// [{ date, actual: "3.7%", forecast, previous }] → [{ date, actual, forecast }] oldest first.
export function seriesFrom(body) {
  return rowsOf(body).filter((r) => r && /^\d{4}-\d{2}-\d{2}/.test(String(r.date)) && num(r.actual) != null)
    .map((r) => ({ date: String(r.date).slice(0, 10), actual: num(r.actual), forecast: num(r.forecast) }))
    .sort((a, b) => (a.date < b.date ? -1 : 1));
}
// FRED CSV (date, lower, upper per day) → the days the range changed: [{ date, lower, upper }].
export function rangeSteps(csv) {
  const out = [];
  for (const line of String(csv || "").split(/\r?\n/).slice(1)) {
    const [d, l, u] = line.split(",");
    const lower = num(l), upper = num(u);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d || "") || lower == null || upper == null) continue;
    const last = out[out.length - 1];
    if (!last || last.lower !== lower || last.upper !== upper) out.push({ date: d, lower, upper });
  }
  return out;
}

async function soso(env, path) {
  const r = await fetch(API + path, { headers: { "x-soso-api-key": env.SOSOVALUE_API_KEY, Accept: "application/json" }, signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error(`sosovalue ${r.status}`);
  return r.json();
}
const hist = (name) => `/macro/events/${encodeURIComponent(name)}/history?limit=60`;

export async function refresh(env, old, now = Date.now()) {
  const out = { ...(old || {}), schemaVersion: "marketlevelmap-fed-v1", triedAt: new Date(now).toISOString() };
  let ok = false;
  if (env.SOSOVALUE_API_KEY && (await reserve(env.USERS_DB, 3, now))) {
    const [m, cpi, pce] = await Promise.all([soso(env, "/macro/fomc-probabilities"), soso(env, hist("CPI (YoY)")), soso(env, hist("Core PCE Price Index (YoY)"))].map((p) => p.catch(() => null)));
    const meetings = meetingsFrom(m), c = seriesFrom(cpi), p = seriesFrom(pce);
    if (meetings.length) { out.meetings = meetings; out.meetingsAt = new Date(now).toISOString(); ok = true; }
    if (c.length) out.cpi = c;
    if (p.length) out.corePce = p;
  }
  try {
    const r = await fetch(FRED, { headers: { "User-Agent": "marketlevelmap-site", Accept: "text/csv" }, signal: AbortSignal.timeout(8000) });
    const steps = r.ok ? rangeSteps(await r.text()) : [];
    if (steps.length) { out.target = steps; out.targetAt = new Date(now).toISOString(); }
  } catch (_) { /* keep the old copy */ }
  if (ok) out.fetchedAt = new Date(now).toISOString();
  return out;
}

export async function onRequestGet({ env, waitUntil }) {
  const db = env.USERS_DB, now = Date.now();
  const stored = await readSnapshot(db, KEY), data = stored && stored.data;
  const tried = data && data.triedAt ? now - Date.parse(data.triedAt) : Infinity;
  const due = (!stored || now - stored.at > FRESH_MS) && tried > RETRY_MS;
  const run = () => refresh(env, data, Date.now()).then(async (fresh) => { await writeSnapshot(db, KEY, fresh, fresh.fetchedAt ? Date.now() : (stored ? stored.at : 0)); return fresh; });
  if (data && data.meetings) {
    if (due && waitUntil) waitUntil(run().catch(() => null));
    const { triedAt, ...body } = data; // eslint-disable-line no-unused-vars
    return json({ source: "SoSoValue, FRED", ...body }, 200, 600);
  }
  if (!due) return json({ error: "unavailable" }, 200, 0);
  try {
    const fresh = await run();
    const { triedAt, ...body } = fresh; // eslint-disable-line no-unused-vars
    return json(fresh.meetings ? { source: "SoSoValue, FRED", ...body } : { error: "unavailable" }, 200, fresh.meetings ? 600 : 0);
  } catch (_) { return json({ error: "unavailable" }, 200, 0); }
}
