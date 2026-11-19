// TEMPORARY (to be removed after the test): which exchange APIs answer from Cloudflare, for choosing the price source
// of the planned alarms. Public market data only; no keys, nothing stored. Reports the Cloudflare location it ran in.
const SOURCES = [
  ["okx ticker", "https://www.okx.com/api/v5/market/ticker?instId=BTC-USDT", (d) => d && d.data && d.data[0] && d.data[0].last],
  ["okx candles BNB 1H", "https://www.okx.com/api/v5/market/candles?instId=BNB-USDT&bar=1H&limit=2", (d) => d && d.data && d.data[0] && d.data[0][4]],
  ["binance data-api", "https://data-api.binance.vision/api/v3/ticker/price?symbol=BTCUSDT", (d) => d && d.price],
  ["binance api", "https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT", (d) => d && d.price],
  ["coinbase", "https://api.exchange.coinbase.com/products/BTC-USD/ticker", (d) => d && d.price],
  ["bybit", "https://api.bybit.com/v5/market/tickers?category=spot&symbol=BTCUSDT", (d) => d && d.result && d.result.list && d.result.list[0] && d.result.list[0].lastPrice],
  ["kraken", "https://api.kraken.com/0/public/Ticker?pair=XBTUSDT", (d) => d && d.result && Object.values(d.result)[0] && Object.values(d.result)[0].c[0]],
];

async function probe([name, url, pick]) {
  const t0 = Date.now();
  try {
    const r = await fetch(url, { headers: { Accept: "application/json", "User-Agent": "MarketLevelMap source check" }, signal: AbortSignal.timeout(6000) });
    let price = null;
    try { price = pick(await r.json()) || null; } catch (_) { price = null; }
    return { name, status: r.status, ok: r.ok && price != null, price, ms: Date.now() - t0 };
  } catch (e) {
    return { name, status: 0, ok: false, error: String(e && e.name || e), ms: Date.now() - t0 };
  }
}

export async function onRequestGet({ request }) {
  const cf = request.cf || {};
  const results = await Promise.all(SOURCES.map(probe));
  return new Response(JSON.stringify({ colo: cf.colo || null, country: cf.country || null, at: new Date().toISOString(), results }, null, 1), {
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Robots-Tag": "noindex" },
  });
}
