// Changes over the last CLOSED periods for the home page's heat map (README "Market heat map"): yesterday (the last
// UTC day), last week (Monday to Sunday, UTC) and last month, open to close.
// GET /api/closed-changes?part=0|1|2|macro. The pairs (every pair of the candle index but PAXG, in name order) are
// split into three parts by position (i % 3) because Cloudflare allows a Function about 50 outside requests: each pair
// costs one daily candle file, sometimes the year before's file (January) and an OKX request when a candle is missing.
// - Crypto and tokenized stocks: the public daily candles (data.marketlevelmap.com, uploaded by the local program);
//   a period counts only when its first and last day are there. A crypto pair whose candles lack the period falls
//   back to OKX's closed UTC candle (1Dutc / 1Wutc / 1Mutc). Tokens have no fallback: "–" until the upload.
// - Macro (part=macro): Yahoo daily candles of the six items of the weekly outlook. "day" is the last session that
//   ended before today (over a weekend Friday) against the session before's close; week and month are the sessions of
//   last week (a futures session dated Sunday counts to the next week) and last month, first open to last close. The
//   yield in basis points.
// Each pair also carries `last` (its last daily close), `back` ({ d7, d30, d90, d365 }: the closes N days ago, for the
// market map page's performance table) and `ema`: [EMA20, EMA50, EMA200] of its last closed daily candle (the market breadth card).
// Answer: { at, periods: { day: {from, to}, week: {from, to, isoWeek}, month: {from, to} } (ISO dates, `to`
// exclusive), assets: { PAIR: { day, week, month, source? } }, macro: { dxy: { day, week, month, dayDate } … } }.
// Kept at the edge until the next UTC midnight once every value is there, else 10 minutes.
import { MACRO } from "./weekly.js";
import { yahooDaily, weekOf, monthOf } from "./macro-change.js";

const CANDLES = "https://data.marketlevelmap.com/candles/";
const DAY = 86400;
const PARTS = 3;
const LEFT_OUT = new Set(["PAXGUSDT"]);
const iso = (sec) => new Date(sec * 1000).toISOString().slice(0, 10);
const pct = (close, open) => (close > 0 && open > 0 ? Math.round((close / open - 1) * 10000) / 100 : null);

function json(body, maxAge) {
  return new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": maxAge ? `public, max-age=${maxAge}` : "no-store" } });
}
// ISO 8601 week number of the week starting `monday` (seconds).
export function isoWeek(monday) {
  const thu = new Date((monday + 3 * DAY) * 1000), jan1 = Date.UTC(thu.getUTCFullYear(), 0, 1) / 1000;
  return Math.floor((thu.getTime() / 1000 - jan1) / DAY / 7) + 1;
}
// The three closed periods before `nowMs`, in seconds ([from, to)).
export function periods(nowMs) {
  const d = new Date(nowMs), today = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) / 1000;
  const monday = today - ((d.getUTCDay() + 6) % 7) * DAY, month = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1) / 1000;
  return {
    day: { from: today - DAY, to: today },
    week: { from: monday - 7 * DAY, to: monday },
    month: { from: Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1) / 1000, to: month },
  };
}
// Open to close of [from, to) from daily rows [openSec, open, high, low, close, …]: only when its first and last day
// are both there.
export function closedChange(rows, p) {
  const byTime = new Map();
  for (const r of rows) if (Array.isArray(r) && Number(r[1]) > 0 && Number(r[4]) > 0) byTime.set(Number(r[0]), r);
  const first = byTime.get(p.from), last = byTime.get(p.to - DAY);
  return first && last ? pct(Number(last[4]), Number(first[1])) : null;
}
// { d7, d30, d90, d365 }: the close of the daily candle that ended at (today − N days) 00:00 UTC, or null.
export function backCloses(rows, today) {
  const byTime = new Map();
  for (const r of rows) if (Array.isArray(r) && Number(r[4]) > 0) byTime.set(Number(r[0]), Number(r[4]));
  const out = {};
  for (const n of [7, 30, 90, 365]) out["d" + n] = byTime.get(today - (n + 1) * DAY) ?? null;
  return out;
}
// OKX closed UTC candle starting at `from` (rows [ts ms, open, high, low, close, …, confirm]).
export function okxClosed(body, from) {
  const rows = body && body.code === "0" && Array.isArray(body.data) ? body.data : [];
  const r = rows.find((x) => Array.isArray(x) && Number(x[0]) === from * 1000 && String(x[8]) === "1");
  return r ? pct(Number(r[4]), Number(r[1])) : null;
}
// Macro from Yahoo daily candles (see the top).
export function macroClosed(body, P, key) {
  const r = body && body.chart && body.chart.result && body.chart.result[0];
  const t = r && r.timestamp, q = r && r.indicators && r.indicators.quote && r.indicators.quote[0];
  if (!Array.isArray(t) || !q || !Array.isArray(q.close)) return null;
  const bars = [];
  for (let i = 0; i < t.length; i++) { const c = Number(q.close[i]), o = Number(q.open && q.open[i]); if (q.close[i] != null && c > 0) bars.push({ t: t[i], o: o > 0 ? o : null, c }); }
  if (bars.length < 2) return null;
  const k = key === "us10y" && bars[bars.length - 1].c > 20 ? 10 : 1;
  const ch = (close, open) => (close > 0 && open > 0 ? (key === "us10y" ? Math.round((close - open) / k * 1000) / 10 : pct(close, open)) : null);
  const done = bars.filter((b) => b.t < P.day.to);
  const lastDone = done[done.length - 1], before = done[done.length - 2];
  const span = (keyOf, from) => { const s = bars.filter((b) => keyOf(b.t) === from); return s.length ? ch(s[s.length - 1].c, s[0].o) : null; };
  return {
    day: lastDone && before ? ch(lastDone.c, before.c) : null, dayDate: lastDone ? iso(lastDone.t) : null,
    week: span(weekOf, P.week.from), month: span(monthOf, P.month.from), unit: key === "us10y" ? "bp" : "%",
  };
}

async function getJson(url, budget) {
  if (budget.left <= 0) return null;
  budget.left--;
  try { const r = await fetch(url, { cf: { cacheTtl: 300 }, signal: AbortSignal.timeout(6000) }); return r.ok ? await r.json() : null; } catch (_) { return null; }
}
async function pairChanges(pair, index, P, budget) {
  const tf = index.pairs[pair] && index.pairs[pair]["1d"];
  if (!tf) return null;
  const base = `${CANDLES}${encodeURIComponent(pair)}/1d/`;
  let rows = ((await getJson(base + "latest.json", budget)) || {}).candles || [];
  // Last year's file: for the 1-year look-back (performance table), and in January for last month too.
  const year = String(new Date((P.day.to - 366 * DAY) * 1000).getUTCFullYear());
  if (Array.isArray(tf.archives) && tf.archives.includes(year) && String(tf.latest) !== year) rows = rows.concat(((await getJson(base + year + ".json", budget)) || {}).candles || []);
  const out = {};
  for (const k of ["day", "week", "month"]) out[k] = closedChange(rows, P[k]);
  // The EMAs (20, 50, 200) of the last daily candle in the file, for the market breadth card (fields 6–8).
  const lastRow = rows.filter((r) => Array.isArray(r) && Number(r[0]) < P.day.to).sort((a, b) => a[0] - b[0]).pop();
  if (lastRow) { out.ema = [6, 7, 8].map((i) => (Number(lastRow[i]) > 0 ? Number(lastRow[i]) : null)); out.last = Number(lastRow[4]) || null; }
  // Performance table: the close of the day that ended N days before today (00:00 UTC), N = 7, 30, 90, 365.
  out.back = backCloses(rows, P.day.to);
  const m = /^([A-Z0-9]+)USDT$/.exec(pair);
  if (m) {
    const bars = { day: "1Dutc", week: "1Wutc", month: "1Mutc" };
    for (const k of ["day", "week", "month"]) {
      if (out[k] != null || budget.left <= 2) continue;
      const v = okxClosed(await getJson(`https://www.okx.com/api/v5/market/candles?instId=${m[1]}-USDT&bar=${bars[k]}&limit=3`, budget), P[k].from);
      if (v != null) { out[k] = v; out.source = "okx"; }
    }
  }
  return out;
}

export async function onRequestGet(context) {
  const url = new URL(context.request.url), part = url.searchParams.get("part") || "0";
  if (!["0", "1", "2", "macro"].includes(part)) return json({ error: "part" });
  const now = Date.now(), P = periods(now);
  const cache = typeof caches !== "undefined" ? caches.default : null;
  const key = new Request(`${url.origin}/api/closed-changes?part=${part}&d=${iso(P.day.to)}&v=3`);
  if (cache) { const hit = await cache.match(key); if (hit) return hit; }
  const budget = { left: 45 };
  const body = { at: new Date(now).toISOString(), periods: {
    day: { from: iso(P.day.from), to: iso(P.day.to) },
    week: { from: iso(P.week.from), to: iso(P.week.to), isoWeek: isoWeek(P.week.from) },
    month: { from: iso(P.month.from), to: iso(P.month.to) },
  } };
  let complete;
  if (part === "macro") {
    body.macro = {};
    await Promise.all(MACRO.map(async ([k, symbol]) => { body.macro[k] = await yahooDaily(symbol, (b) => macroClosed(b, P, k)); }));
    complete = Object.values(body.macro).every((v) => v && v.day != null && v.week != null && v.month != null);
  } else {
    const index = await getJson(CANDLES + "index.json", budget);
    const pairs = Object.keys((index && index.pairs) || {}).filter((p) => /^[A-Z0-9]{2,20}$/.test(p) && !LEFT_OUT.has(p)).sort().filter((_, i) => i % PARTS === Number(part));
    body.assets = {};
    await Promise.all(pairs.map(async (p) => { const v = await pairChanges(p, index, P, budget); if (v) body.assets[p] = v; }));
    // A pair listed after a period began cannot have it: that is not a missing upload.
    complete = !!index && pairs.every((p) => {
      const a = body.assets[p], first = Number(index.pairs[p]["1d"] && index.pairs[p]["1d"].firstOpenTime) || 0;
      return a && ["day", "week", "month"].every((k) => a[k] != null || first > P[k].from);
    });
  }
  const untilMidnight = Math.max(60, P.day.to + DAY - Math.floor(now / 1000));
  const response = json(body, complete ? untilMidnight : 600);
  if (cache && context.waitUntil) context.waitUntil(cache.put(key, response.clone()));
  return response;
}
