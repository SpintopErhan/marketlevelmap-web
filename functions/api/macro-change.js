// Change of the macro and commodity items for the home page's heat map (README "Market heat map"): GET
// /api/macro-change. The same Yahoo Finance symbols as the weekly outlook (US dollar index, US 10-year yield, S&P 500
// and Nasdaq 100 futures, COMEX gold and silver futures), daily candles of the last three months:
// - day: the last session's price (the live price while it trades) against the session before's close (over a
//   weekend Friday against Thursday);
// - week: against the open of this week's first session (futures sessions dated Sunday count to the next week);
// - month: against the open of this month's first session.
// The yield's change is in basis points (changeBp). Answer: { at, macro: { dxy: { close, date, day, week, month } |
// null, … } }, each change a number or null; cached 5 minutes at the edge. A source that fails leaves its item null.
import { MACRO, YAHOO_HEADERS } from "./weekly.js";

const CACHE_SECONDS = 300;
const DAY = 86400;

function json(body, maxAge) {
  return new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": maxAge ? `public, max-age=${maxAge}` : "no-store" } });
}
// Monday 00:00 UTC of the week a bar belongs to (a Sunday-dated bar belongs to the week after).
const weekOf = (t) => { const s = t + DAY, d = Math.floor(s / DAY); return (d - ((d + 3) % 7)) * DAY; };
const monthOf = (t) => { const d = new Date(t * 1000); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1) / 1000; };
// Yahoo chart body (range=3mo, interval=1d) → { close, date, prev, weekOpen, monthOpen }, or null.
export function yahooBars(body) {
  const r = body && body.chart && body.chart.result && body.chart.result[0];
  const t = r && r.timestamp, q = r && r.indicators && r.indicators.quote && r.indicators.quote[0];
  if (!Array.isArray(t) || !t.length || !q || !Array.isArray(q.close)) return null;
  const bars = [];
  for (let i = 0; i < t.length; i++) {
    const c = Number(q.close[i]), o = Number(q.open && q.open[i]);
    if (q.close[i] != null && c > 0) bars.push({ t: t[i], c, o: o > 0 ? o : null });
  }
  const live = Number(r.meta && r.meta.regularMarketPrice), lastT = t[t.length - 1];
  // A session that has just begun can have no close yet: its bar is the live price.
  if (live > 0 && bars.length && bars[bars.length - 1].t !== lastT) bars.push({ t: lastT, c: live, o: Number(q.open && q.open[t.length - 1]) || null });
  if (bars.length < 2) return null;
  const last = bars[bars.length - 1], close = live > 0 ? live : last.c;
  const firstOf = (key) => { const k = key(last.t), b = bars.find((x) => key(x.t) === k); return b ? (b.o || null) : null; };
  return { close, date: new Date(last.t * 1000).toISOString().slice(0, 10), prev: bars[bars.length - 2].c, weekOpen: firstOf(weekOf), monthOpen: firstOf(monthOf) };
}
export function macroItem(key, b) {
  if (!b) return null;
  if (key === "us10y") {
    const k = b.close > 20 ? 10 : 1, bp = (from) => (from > 0 ? Math.round((b.close - from) / k * 1000) / 10 : null);
    return { close: b.close / k, date: b.date, day: bp(b.prev), week: bp(b.weekOpen), month: bp(b.monthOpen), unit: "bp" };
  }
  const pc = (from) => (from > 0 ? Math.round((b.close / from - 1) * 10000) / 100 : null);
  return { close: b.close, date: b.date, day: pc(b.prev), week: pc(b.weekOpen), month: pc(b.monthOpen), unit: "%" };
}
async function bars(symbol) {
  for (const host of ["query1", "query2"]) {
    try {
      const r = await fetch(`https://${host}.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=3mo&interval=1d`, { headers: YAHOO_HEADERS, signal: AbortSignal.timeout(3000) });
      const b = yahooBars(r.ok ? await r.json() : null);
      if (b) return b;
    } catch (_) { /* next host */ }
  }
  return null;
}
export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const cache = typeof caches !== "undefined" ? caches.default : null;
  const key = new Request(`${url.origin}/api/macro-change`);
  if (cache) { const hit = await cache.match(key); if (hit) return hit; }
  const macro = {};
  await Promise.all(MACRO.map(async ([k, symbol]) => { macro[k] = macroItem(k, await bars(symbol)); }));
  const any = Object.values(macro).some(Boolean);
  const response = json({ at: new Date().toISOString(), macro }, any ? CACHE_SECONDS : 0);
  if (any && cache && context.waitUntil) context.waitUntil(cache.put(key, response.clone()));
  return response;
}
