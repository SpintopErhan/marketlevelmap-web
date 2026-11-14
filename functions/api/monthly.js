// Monthly closes for the monthly returns page (README "Monthly returns"): S&P 500 and Nasdaq 100 (cash indices),
// gold and silver (COMEX futures; free sources have no long spot history) and the US dollar index, from Yahoo
// Finance daily closes over the last 11 years (10 years of returns need the close before the first month); a month's
// close is its last daily close. Yahoo's monthly bars are not used: for futures their dates are irregular (two bars in
// one month, none in the next), which left months empty.
//   GET /api/monthly?symbol=spx|ndx|gold|silver|dxy → { symbol, rows: [{ m: "YYYY-MM", close }] }
// The current month's close is the latest price. Cached 12 hours at each edge location.
const CACHE_SECONDS = 12 * 3600;
const UA = { "User-Agent": "Mozilla/5.0 (compatible; MarketLevelMap/1.0)", Accept: "application/json" };
export const SYMBOLS = { spx: "^GSPC", ndx: "^NDX", gold: "GC=F", silver: "SI=F", dxy: "DX-Y.NYB" };

function json(value, maxAge, status) {
  return new Response(JSON.stringify(value), {
    status: status || 200,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": maxAge ? `public, max-age=${maxAge}` : "no-store" },
  });
}

// Yahoo daily bars → [{ m, close }]: each month's last daily close (the day in the exchange's own time), ascending.
export function monthlyRows(body) {
  const r = body && body.chart && body.chart.result && body.chart.result[0];
  const t = r && r.timestamp, q = r && r.indicators && r.indicators.quote && r.indicators.quote[0];
  if (!Array.isArray(t) || !q || !Array.isArray(q.close)) return null;
  const off = Number(r.meta && r.meta.gmtoffset) || 0, by = {};
  // Yahoo's gmtoffset is today's offset; a summer-time bar at local midnight shifted by winter time lands an hour
  // into the previous day (and month). Adding half a day puts every bar safely inside its own day.
  const days = [];
  t.forEach((sec, i) => { const c = Number(q.close[i]); if (c > 0) days.push([new Date((sec + off + 43200) * 1000).toISOString().slice(0, 10), c]); });
  days.sort((a, b) => (a[0] < b[0] ? -1 : 1)).forEach(([d, c]) => { by[d.slice(0, 7)] = c; });
  // The latest price, when newer than the last daily bar, is the running month's close.
  const last = Number(r.meta && r.meta.regularMarketPrice), lastT = Number(r.meta && r.meta.regularMarketTime);
  if (last > 0 && lastT > 0) by[new Date((lastT + off) * 1000).toISOString().slice(0, 7)] = last;
  return Object.keys(by).sort().map((m) => ({ m, close: by[m] }));
}

export async function onRequestGet(context) {
  const url = new URL(context.request.url), key = String(url.searchParams.get("symbol") || "").toLowerCase();
  const symbol = SYMBOLS[key];
  if (!symbol) return json({ error: "unknown symbol" }, 0, 400);
  const cache = typeof caches !== "undefined" ? caches.default : null;
  // v: raised when the rows change meaning (v2: the summer-time month fix; v3: months from daily closes), so old cached answers are not served.
  const cacheKey = new Request(`${url.origin}/api/monthly?symbol=${key}&v=3`);
  if (cache) { const hit = await cache.match(cacheKey); if (hit) return hit; }
  let rows = null;
  for (const host of ["query1", "query2"]) {
    try {
      const to = Math.floor(Date.now() / 1000), from = to - Math.round(11 * 365.25 * 86400);
      const r = await fetch(`https://${host}.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?period1=${from}&period2=${to}&interval=1d`, { headers: UA });
      if (r.ok) { rows = monthlyRows(await r.json()); if (rows && rows.length) break; }
    } catch (e) { rows = null; }
  }
  if (!rows || rows.length < 13) return json({ symbol: key, rows: [], error: "no data" }, 60);
  const response = json({ symbol: key, rows }, CACHE_SECONDS);
  if (cache) context.waitUntil(cache.put(cacheKey, response.clone()));
  return response;
}
