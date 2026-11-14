// BTC correlation (README "Market context"): the Pearson correlation of BTC's daily returns with Nasdaq 100 and
// S&P 500 futures, gold futures and the US dollar index, over the last 30 and 90 shared days.
//   Yahoo Finance daily closes, range 6 months: BTC-USD, NQ=F, ES=F, GC=F, DX-Y.NYB.
//   Each pair uses only the dates both have (stock and futures markets close at weekends; BTC does not), so a
//   return runs from one shared date to the next. Returns are log returns. Fewer than 20 shared returns: null.
// One answer per edge location every CACHE_SECONDS; the figures move slowly.
const CACHE_SECONDS = 6 * 3600;
const UA = { "User-Agent": "Mozilla/5.0 (compatible; MarketLevelMap/1.0)", Accept: "application/json" };
const PAIRS = [["ndx", "NQ=F"], ["spx", "ES=F"], ["gold", "GC=F"], ["dxy", "DX-Y.NYB"]];
const WINDOWS = [30, 90];

function json(value, maxAge) {
  return new Response(JSON.stringify(value), {
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": maxAge ? `public, max-age=${maxAge}` : "no-store" },
  });
}

// date (YYYY-MM-DD in the exchange's own time) → close
export function dailyCloses(body) {
  const r = body && body.chart && body.chart.result && body.chart.result[0];
  const t = r && r.timestamp, q = r && r.indicators && r.indicators.quote && r.indicators.quote[0];
  if (!Array.isArray(t) || !q || !Array.isArray(q.close)) return null;
  const off = Number(r.meta && r.meta.gmtoffset) || 0, out = {};
  // Half a day added: a summer-time bar at local midnight, shifted by today's (winter) offset, would land on the day
  // before (see monthly.js).
  t.forEach((sec, i) => { const c = Number(q.close[i]); if (c > 0) out[new Date((sec + off + 43200) * 1000).toISOString().slice(0, 10)] = c; });
  return out;
}

export function correlation(a, b, windowSize) {
  const dates = Object.keys(a).filter((d) => b[d] != null).sort();
  const ra = [], rb = [];
  for (let i = 1; i < dates.length; i++) { ra.push(Math.log(a[dates[i]] / a[dates[i - 1]])); rb.push(Math.log(b[dates[i]] / b[dates[i - 1]])); }
  const x = ra.slice(-windowSize), y = rb.slice(-windowSize), n = x.length;
  if (n < 20) return null;
  const mx = x.reduce((s, v) => s + v, 0) / n, my = y.reduce((s, v) => s + v, 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) { sxy += (x[i] - mx) * (y[i] - my); sxx += (x[i] - mx) ** 2; syy += (y[i] - my) ** 2; }
  return sxx > 0 && syy > 0 ? Math.round(sxy / Math.sqrt(sxx * syy) * 100) / 100 : null;
}

async function yahoo(symbol) {
  for (const host of ["query1", "query2"]) {
    try {
      const r = await fetch(`https://${host}.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=6mo&interval=1d`, { headers: UA });
      if (r.ok) { const c = dailyCloses(await r.json()); if (c && Object.keys(c).length) return c; }
    } catch (e) { /* next host */ }
  }
  return null;
}

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const cache = typeof caches !== "undefined" ? caches.default : null;
  const key = new Request(`${url.origin}/api/correlation?v=2`);
  if (cache) { const hit = await cache.match(key); if (hit) return hit; }
  const [btc, ...others] = await Promise.all([yahoo("BTC-USD"), ...PAIRS.map((p) => yahoo(p[1]))]);
  const pairs = {};
  PAIRS.forEach(([k], i) => {
    pairs[k] = btc && others[i] ? Object.fromEntries(WINDOWS.map((w) => [`c${w}`, correlation(btc, others[i], w)])) : null;
  });
  const ok = Object.values(pairs).some(Boolean);
  const response = json({ at: new Date().toISOString(), windows: WINDOWS, pairs }, ok ? CACHE_SECONDS : 120);
  if (cache && ok) context.waitUntil(cache.put(key, response.clone()));
  return response;
}
