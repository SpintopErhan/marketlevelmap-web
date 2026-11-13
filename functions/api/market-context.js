// Market context (README "Market context"): BTC and USDT dominance, total crypto market cap, ETH/BTC and the US dollar
// index, for the home strip, the analysis page card and the live flow panel. One request per visitor every few
// minutes; the sources are asked at most once per CACHE_SECONDS at each edge location.
//   CoinGecko /global            total market cap (USD), its 24 h change, market-cap shares (dominance)
//   CoinGecko /simple/price      BTC and USDT market caps and 24 h changes, to work out the dominance 24 h ago
//   CoinPaprika /global, /tickers  the same figures when CoinGecko refuses the edge (it rate-limits shared IPs)
//   Coinbase ETH-BTC /stats      ETH/BTC last and 24 h open (Binance refuses requests from Cloudflare)
//   Yahoo Finance DX-Y.NYB       DXY, delayed about 15 minutes, closed at weekends
// A source that fails leaves its fields null; the rest still answers (200 with `errors`).
const CACHE_SECONDS = 180;
const UA = { "User-Agent": "Mozilla/5.0 (compatible; MarketLevelMap/1.0)", Accept: "application/json" };

function json(value, maxAge) {
  return new Response(JSON.stringify(value), {
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": maxAge ? `public, max-age=${maxAge}` : "no-store" },
  });
}
async function getJson(url, ms = 8000) {
  const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, { headers: UA, signal: ctl.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } finally { clearTimeout(timer); }
}
const num = (x) => { const n = Number(x); return Number.isFinite(n) ? n : null; };

async function coingecko() {
  const [g, s] = await Promise.all([
    getJson("https://api.coingecko.com/api/v3/global"),
    getJson("https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,tether&vs_currencies=usd&include_market_cap=true&include_24hr_change=true").catch(() => null),
  ]);
  const d = g && g.data;
  if (!d || !d.total_market_cap) throw new Error("no global data");
  const total = num(d.total_market_cap.usd), totalChg = num(d.market_cap_change_percentage_24h_usd), pct = d.market_cap_percentage || {};
  // Dominance 24 h ago = coin cap then / total cap then, both from today's values and their 24 h changes.
  function dom(key, id) {
    const v = num(pct[key]);
    const c = s && s[id] ? num(s[id].usd_24h_change) : null, cap = s && s[id] ? num(s[id].usd_market_cap) : null;
    let change = null;
    if (v != null && c != null && cap && total && totalChg != null) {
      const before = (cap / (1 + c / 100)) / (total / (1 + totalChg / 100)) * 100;
      change = v - before;
    }
    return { value: v, change };
  }
  return { total: { usd: total, change: totalChg }, btc: dom("btc", "bitcoin"), usdt: dom("usdt", "tether") };
}
// CoinPaprika: total cap and its 24 h change from /global; BTC and USDT caps and their 24 h changes from /tickers.
async function coinpaprika() {
  const [g, b, u] = await Promise.all([
    getJson("https://api.coinpaprika.com/v1/global"),
    getJson("https://api.coinpaprika.com/v1/tickers/btc-bitcoin").catch(() => null),
    getJson("https://api.coinpaprika.com/v1/tickers/usdt-tether").catch(() => null),
  ]);
  const total = num(g && g.market_cap_usd), totalChg = num(g && g.market_cap_change_24h);
  if (!total) throw new Error("no global data");
  function dom(t) {
    const q = t && t.quotes && t.quotes.USD, cap = q ? num(q.market_cap) : null, c = q ? num(q.market_cap_change_24h) : null;
    if (!cap) return { value: null, change: null };
    const value = cap / total * 100;
    const change = c != null && totalChg != null ? value - (cap / (1 + c / 100)) / (total / (1 + totalChg / 100)) * 100 : null;
    return { value, change };
  }
  return { total: { usd: total, change: totalChg }, btc: dom(b), usdt: dom(u) };
}
async function ethbtc() {
  const s = await getJson("https://api.exchange.coinbase.com/products/ETH-BTC/stats");
  const last = num(s.last), open = num(s.open);
  if (!last) throw new Error("no ETH-BTC");
  return { price: last, change: open ? (last / open - 1) * 100 : null };
}
async function dxy() {
  let body = null;
  for (const host of ["query1", "query2"]) {
    try { body = await getJson(`https://${host}.finance.yahoo.com/v8/finance/chart/DX-Y.NYB?range=1d&interval=5m`); break; } catch (e) { body = null; }
  }
  const m = body && body.chart && body.chart.result && body.chart.result[0] && body.chart.result[0].meta;
  if (!m || !num(m.regularMarketPrice)) throw new Error("no DXY");
  const price = num(m.regularMarketPrice), prev = num(m.chartPreviousClose) || num(m.previousClose);
  return { price, change: prev ? (price / prev - 1) * 100 : null, time: m.regularMarketTime ? new Date(m.regularMarketTime * 1000).toISOString() : null };
}

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const cache = typeof caches !== "undefined" ? caches.default : null;
  const key = new Request(`${url.origin}/api/market-context`);
  if (cache) { const hit = await cache.match(key); if (hit) return hit; }
  const errors = [];
  const settle = (p, name) => p.catch((e) => { errors.push(`${name}: ${e && e.message ? e.message : e}`); return null; });
  let [cg, eb, dx] = await Promise.all([settle(coingecko(), "coingecko"), settle(ethbtc(), "coinbase"), settle(dxy(), "yahoo")]);
  if (!cg) cg = await settle(coinpaprika(), "coinpaprika");
  const body = {
    at: new Date().toISOString(),
    total: cg ? cg.total : null,
    btcDominance: cg ? cg.btc : null,
    usdtDominance: cg ? cg.usdt : null,
    ethbtc: eb,
    dxy: dx,
    ...(errors.length ? { errors } : {}),
  };
  // A fully failed answer is cached for a short time only, so a source outage does not stick for minutes.
  const response = json(body, cg || eb || dx ? CACHE_SECONDS : 30);
  if (cache) context.waitUntil(cache.put(key, response.clone()));
  return response;
}
