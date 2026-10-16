// Price snapshot for the homepage strip, fetched at the edge.
// Used for the first paint and as a fallback for visitors whose network cannot reach Binance.
// Binance refuses requests from some countries (e.g. the Netherlands, the US), and Cloudflare serves
// visitors from a nearby location, so when Binance answers with an error the snapshot comes from
// Coinbase instead and says so in `source`.
// Always answers 200 with JSON: a 5xx here would be replaced by Cloudflare's error page.
const BINANCE = ["https://data-api.binance.vision", "https://api.binance.com"];
const COINBASE = "https://api.exchange.coinbase.com";
const SYMBOL = /^[A-Z0-9]{2,20}$/;
const MAX_SYMBOLS = 30;
const CACHE_SECONDS = 3;
const USER_AGENT = "MarketLevelMap price strip (+https://marketlevelmap.com)";

function json(value, maxAge) {
  return new Response(JSON.stringify(value), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": maxAge ? `public, max-age=${maxAge}` : "no-store",
    },
  });
}

async function get(url, attempts) {
  try {
    const response = await fetch(url, { headers: { Accept: "application/json", "User-Agent": USER_AGENT } });
    attempts.push({ host: new URL(url).host, status: response.status });
    return response.ok ? await response.json() : null;
  } catch (_) {
    attempts.push({ host: new URL(url).host, status: "network error" });
    return null;
  }
}

async function fromBinance(symbols, attempts) {
  const query = `symbols=${encodeURIComponent(JSON.stringify(symbols))}&type=MINI`;
  for (const base of BINANCE) {
    const rows = await get(`${base}/api/v3/ticker/24hr?${query}`, attempts);
    if (Array.isArray(rows) && rows.length) {
      return rows.filter((row) => row && SYMBOL.test(row.symbol)).map((row) => ({ s: row.symbol, c: row.lastPrice, o: row.openPrice }));
    }
  }
  return null;
}

// Coinbase lists pairs as BASE-QUOTE; prefer the USDT pair, else USD.
async function fromCoinbase(symbols, attempts) {
  const rows = await Promise.all(symbols.map(async (symbol) => {
    const base = symbol.replace(/USDT$/, "");
    if (base === symbol || !base) return null;
    for (const quote of ["USDT", "USD"]) {
      const stats = await get(`${COINBASE}/products/${base}-${quote}/stats`, attempts);
      if (stats && Number(stats.last) > 0) return { s: symbol, c: stats.last, o: stats.open };
    }
    return null;
  }));
  const found = rows.filter(Boolean);
  return found.length ? found : null;
}

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const symbols = [...new Set((url.searchParams.get("symbols") || "").toUpperCase().split(",").filter((s) => SYMBOL.test(s)))]
    .sort()
    .slice(0, MAX_SYMBOLS);
  if (!symbols.length) return json({ prices: [], error: "No valid symbols." });

  const cache = typeof caches !== "undefined" ? caches.default : null;
  const cacheKey = new Request(`${url.origin}/api/prices?symbols=${symbols.join(",")}`);
  if (cache) {
    const hit = await cache.match(cacheKey);
    if (hit) return hit;
  }

  const attempts = [];
  let source = "binance";
  let prices = await fromBinance(symbols, attempts);
  if (!prices) {
    source = "coinbase";
    prices = await fromCoinbase(symbols, attempts);
  }
  const body = prices
    ? { at: new Date().toISOString(), source, prices, ...(source === "binance" ? {} : { attempts }) }
    : { at: new Date().toISOString(), source: null, prices: [], error: "Prices are unavailable.", attempts };
  const response = json(body, CACHE_SECONDS);
  if (cache) context.waitUntil(cache.put(cacheKey, response.clone()));
  return response;
}
