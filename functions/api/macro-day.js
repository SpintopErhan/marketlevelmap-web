// Daily change of the macro and commodity items (README "Market heat map"): GET /api/macro-day. The same Yahoo Finance
// symbols as the weekly outlook (US dollar index, US 10-year yield, S&P 500 and Nasdaq 100 futures, COMEX gold and
// silver futures), daily candles: the last session's price (the live price while it trades) against the session
// before's close. Over a weekend that is Friday against Thursday. The yield's change is in basis points.
// Answer: { at, macro: { dxy: { close, change, date } | null, us10y: { close, changeBp, date } | null, … } };
// cached 5 minutes at the edge. A source that fails leaves its item null.
import { MACRO, YAHOO_HEADERS } from "./weekly.js";

const CACHE_SECONDS = 300;
const round2 = (v) => Math.round(v * 100) / 100;

function json(body, maxAge) {
  return new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": maxAge ? `public, max-age=${maxAge}` : "no-store" } });
}
// Yahoo chart body (range=5d, interval=1d) → { close, prev, date } of the last session, or null.
export function yahooDay(body) {
  const r = body && body.chart && body.chart.result && body.chart.result[0];
  const t = r && r.timestamp, q = r && r.indicators && r.indicators.quote && r.indicators.quote[0];
  if (!Array.isArray(t) || !q || !Array.isArray(q.close)) return null;
  const bars = [];
  for (let i = 0; i < t.length; i++) { const c = Number(q.close[i]); if (q.close[i] != null && c > 0) bars.push({ t: t[i], c }); }
  const live = Number(r.meta && r.meta.regularMarketPrice), lastT = t[t.length - 1];
  // A session that has just begun can have no close yet: its bar is the live price.
  if (live > 0 && bars.length && bars[bars.length - 1].t !== lastT) bars.push({ t: lastT, c: live });
  if (bars.length < 2) return null;
  const last = bars[bars.length - 1];
  return { close: live > 0 ? live : last.c, prev: bars[bars.length - 2].c, date: new Date(last.t * 1000).toISOString().slice(0, 10) };
}
export function macroItem(key, d) {
  if (!d) return null;
  if (key === "us10y") { const k = d.close > 20 ? 10 : 1; return { close: d.close / k, changeBp: Math.round((d.close - d.prev) / k * 1000) / 10, date: d.date }; }
  return { close: d.close, change: round2((d.close / d.prev - 1) * 100), date: d.date };
}
async function day(symbol) {
  for (const host of ["query1", "query2"]) {
    try {
      const r = await fetch(`https://${host}.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=5d&interval=1d`, { headers: YAHOO_HEADERS, signal: AbortSignal.timeout(3000) });
      const d = yahooDay(r.ok ? await r.json() : null);
      if (d) return d;
    } catch (_) { /* next host */ }
  }
  return null;
}
export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const cache = typeof caches !== "undefined" ? caches.default : null;
  const key = new Request(`${url.origin}/api/macro-day`);
  if (cache) { const hit = await cache.match(key); if (hit) return hit; }
  const macro = {};
  await Promise.all(MACRO.map(async ([k, symbol]) => { macro[k] = macroItem(k, await day(symbol)); }));
  const any = Object.values(macro).some(Boolean);
  const response = json({ at: new Date().toISOString(), macro }, any ? CACHE_SECONDS : 0);
  if (any && cache && context.waitUntil) context.waitUntil(cache.put(key, response.clone()));
  return response;
}
