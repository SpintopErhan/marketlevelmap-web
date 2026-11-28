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
const FED_TABLE = "https://www.federalreserve.gov/monetarypolicy/openmarket.htm";
const KEY = "fed:v1";
const FRESH_MS = 3 * 3600 * 1000, RETRY_MS = 10 * 60 * 1000, RETRY_EMPTY_MS = 60 * 1000; // sooner while nothing was ever loaded
const num = (v) => { const n = parseFloat(String(v == null ? "" : v).replace("%", "")); return Number.isFinite(n) ? n : null; };

function json(value, status = 200, maxAge = 0) {
  return new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": maxAge ? `public, max-age=${maxAge}` : "no-store" } });
}
// The rows wherever SoSoValue puts them: the body, `data`, or a list inside `data` (as the admin probe reads them).
function rowsOf(body) {
  if (Array.isArray(body)) return body;
  const d = body && typeof body === "object" ? (body.data !== undefined ? body.data : body) : null;
  if (Array.isArray(d)) return d;
  if (d && typeof d === "object") for (const k of ["list", "items", "rows", "meetings", "events", "data"]) if (Array.isArray(d[k])) return d[k];
  return [];
}

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

// The Board's "Open Market Operations" page: a table per year (a heading with the year, then rows "Month Day |
// increase | decrease | level", the level "3.75-4.00"). → the same steps as rangeSteps, from 2021, oldest first.
const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const plain = (h) => h.replace(/<[^>]+>/g, " ").replace(/&nbsp;|&#160;/g, " ").replace(/\s+/g, " ").trim();
export function fedTableSteps(html) {
  const text = String(html || ""), out = [];
  const years = [...text.matchAll(/<h[2-5][^>]*>\s*(\d{4})\s*<\/h[2-5]>/gi)].map((m) => ({ year: Number(m[1]), at: m.index }));
  years.forEach((y, i) => {
    const part = text.slice(y.at, i + 1 < years.length ? years[i + 1].at : undefined);
    for (const row of part.match(/<tr[\s\S]*?<\/tr>/gi) || []) {
      const cells = (row.match(/<t[dh][^>]*>[\s\S]*?<\/t[dh]>/gi) || []).map(plain);
      if (cells.length < 2) continue;
      const dm = /^([A-Za-z]+)\.?\s+(\d{1,2})/.exec(cells[0]), lv = /(\d+(?:\.\d+)?)\s*[-–]\s*(\d+(?:\.\d+)?)/.exec(cells[cells.length - 1]);
      const mi = dm ? MONTHS.findIndex((m) => m.startsWith(dm[1].toLowerCase().slice(0, 3))) : -1;
      if (mi < 0 || !lv) continue;
      out.push({ date: new Date(Date.UTC(y.year, mi, Number(dm[2]))).toISOString().slice(0, 10), lower: Number(lv[1]), upper: Number(lv[2]) });
    }
  });
  out.sort((a, b) => (a.date < b.date ? -1 : 1));
  // From the range in force on 1 Jan 2021, like the FRED series.
  const before = out.filter((r) => r.date < "2021-01-01").pop(), after = out.filter((r) => r.date >= "2021-01-01");
  const steps = before ? [{ ...before, date: "2021-01-01" }].concat(after) : after;
  return steps.filter((r, i) => i === 0 || r.lower !== steps[i - 1].lower || r.upper !== steps[i - 1].upper);
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
  out.problem = null; // why the last try gave no meetings (no data values), for checking from outside
  if (!env.SOSOVALUE_API_KEY) out.problem = "no key";
  else if (!(await reserve(env.USERS_DB, 3, now))) out.problem = "busy";
  else {
    const [m, cpi, pce] = await Promise.all([soso(env, "/macro/fomc-probabilities"), soso(env, hist("CPI (YoY)")), soso(env, hist("Core PCE Price Index (YoY)"))].map((p) => p.catch((e) => ({ failed: String(e && e.message || e).slice(0, 60) }))));
    const meetings = meetingsFrom(m), c = seriesFrom(cpi), p = seriesFrom(pce);
    if (meetings.length) { out.meetings = meetings; out.meetingsAt = new Date(now).toISOString(); ok = true; }
    else out.problem = m && m.failed ? m.failed : "shape: " + (m && typeof m === "object" ? Object.keys(m.data && typeof m.data === "object" ? m.data : m).slice(0, 8).join(",") : typeof m);
    if (c.length) out.cpi = c;
    if (p.length) out.corePce = p;
  }
  // Target range: FRED, else the Federal Reserve Board's own table of decisions. Why both failed is kept.
  const tries = [];
  for (const [name, url, parse] of [["fred", FRED, rangeSteps], ["federalreserve.gov", FED_TABLE, fedTableSteps]]) {
    try {
      const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (compatible; MarketLevelMap/1.0; +https://marketlevelmap.com)", Accept: "text/csv,text/html,*/*" }, signal: AbortSignal.timeout(8000) });
      const steps = r.ok ? parse(await r.text()) : [];
      if (steps.length) { out.target = steps; out.targetAt = new Date(now).toISOString(); out.targetSource = name; break; }
      tries.push(name + " " + r.status + (r.ok ? " no rows" : ""));
    } catch (e) { tries.push(name + " " + String(e && e.message || e).slice(0, 40)); }
  }
  out.targetProblem = tries.length && !out.targetAt ? tries.join("; ") : out.target ? null : tries.join("; ");
  if (ok) out.fetchedAt = new Date(now).toISOString();
  return out;
}

export async function onRequestGet({ env, waitUntil }) {
  const db = env.USERS_DB, now = Date.now();
  const stored = await readSnapshot(db, KEY), data = stored && stored.data;
  const tried = data && data.triedAt ? now - Date.parse(data.triedAt) : Infinity;
  // Also tried again (every 10 minutes) while the target range is missing.
  const due = (!stored || now - stored.at > FRESH_MS || (data && !data.target)) && tried > (data && data.meetings ? RETRY_MS : RETRY_EMPTY_MS);
  const run = () => refresh(env, data, Date.now()).then(async (fresh) => { await writeSnapshot(db, KEY, fresh, fresh.fetchedAt ? Date.now() : (stored ? stored.at : 0)); return fresh; });
  if (data && data.meetings) {
    if (due && waitUntil) waitUntil(run().catch(() => null));
    const { triedAt, ...body } = data; // eslint-disable-line no-unused-vars
    return json({ source: "SoSoValue, FRED", ...body }, 200, 600);
  }
  if (!due) return json({ error: "unavailable", problem: (data && data.problem) || null }, 200, 0);
  try {
    const fresh = await run();
    const { triedAt, ...body } = fresh; // eslint-disable-line no-unused-vars
    return json(fresh.meetings ? { source: "SoSoValue, FRED", ...body } : { error: "unavailable", problem: fresh.problem || null }, 200, fresh.meetings ? 600 : 0);
  } catch (_) { return json({ error: "unavailable" }, 200, 0); }
}
