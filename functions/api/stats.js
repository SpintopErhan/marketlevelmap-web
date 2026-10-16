// Market summary for one asset on the bulletin page: last price, 24h open/high/low/volume, and the
// current week's (Monday 00:00 UTC) and month's opening prices.
// Binance first; where Binance refuses the request (e.g. from the Netherlands or the US) the same figures
// come from Coinbase, and `source` says which. Cached for a minute per symbol.
// Always answers 200 with JSON: a 5xx here would be replaced by Cloudflare's error page.
const BINANCE = ["https://data-api.binance.vision", "https://api.binance.com"];
const COINBASE = "https://api.exchange.coinbase.com";
const SYMBOL = /^[A-Z0-9]{2,20}$/;
const CACHE_SECONDS = 60;
const USER_AGENT = "MarketLevelMap market summary (+https://marketlevelmap.com)";
const DAY = 86400000;

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

function weekStart(now) {
  const day = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return day - ((now.getUTCDay() + 6) % 7) * DAY;
}

function monthStart(now) {
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
}

async function fromBinance(symbol, attempts) {
  for (const base of BINANCE) {
    const ticker = await get(`${base}/api/v3/ticker/24hr?symbol=${symbol}`, attempts);
    if (!ticker || !(Number(ticker.lastPrice) > 0)) continue;
    const [week, month] = await Promise.all([
      get(`${base}/api/v3/klines?symbol=${symbol}&interval=1w&limit=1`, attempts),
      get(`${base}/api/v3/klines?symbol=${symbol}&interval=1M&limit=1`, attempts),
    ]);
    return {
      source: "binance",
      quote: "USDT",
      last: ticker.lastPrice,
      open24h: ticker.openPrice,
      high24h: ticker.highPrice,
      low24h: ticker.lowPrice,
      volumeQuote: ticker.quoteVolume,
      weekOpen: Array.isArray(week?.[0]) ? week[0][1] : null,
      monthOpen: Array.isArray(month?.[0]) ? month[0][1] : null,
    };
  }
  return null;
}

// Coinbase: the USD pair (its main, liquid market), else USDT. Week/month opens come from the latest
// daily candles ([time, low, high, open, close, volume], time in seconds, newest first).
async function fromCoinbase(symbol, attempts, now) {
  const base = symbol.replace(/USDT$/, "");
  if (!base || base === symbol) return null;
  for (const quote of ["USD", "USDT"]) {
    const pair = `${base}-${quote}`;
    const stats = await get(`${COINBASE}/products/${pair}/stats`, attempts);
    if (!stats || !(Number(stats.last) > 0)) continue;
    const week = weekStart(now);
    const month = monthStart(now);
    const candles = await get(`${COINBASE}/products/${pair}/candles?granularity=86400`, attempts);
    // Open of the first daily candle on or after the given day.
    const openAt = (ms) => {
      const rows = Array.isArray(candles) ? candles.filter((c) => Array.isArray(c) && c[0] * 1000 >= ms && c[0] * 1000 < ms + DAY) : [];
      rows.sort((a, b) => a[0] - b[0]);
      return rows.length ? String(rows[0][3]) : null;
    };
    return {
      source: "coinbase",
      quote,
      pair,
      last: stats.last,
      open24h: stats.open,
      high24h: stats.high,
      low24h: stats.low,
      volumeQuote: String(Number(stats.volume) * Number(stats.last)),
      weekOpen: openAt(week),
      monthOpen: openAt(month),
    };
  }
  return null;
}

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const symbol = (url.searchParams.get("symbol") || "").toUpperCase();
  if (!SYMBOL.test(symbol)) return json({ error: "Invalid symbol." });

  const cache = typeof caches !== "undefined" ? caches.default : null;
  const cacheKey = new Request(`${url.origin}/api/stats?symbol=${symbol}`);
  if (cache) {
    const hit = await cache.match(cacheKey);
    if (hit) return hit;
  }

  const now = new Date();
  const attempts = [];
  const stats = (await fromBinance(symbol, attempts)) || (await fromCoinbase(symbol, attempts, now));
  const body = stats
    ? { at: now.toISOString(), symbol, ...stats, weekStart: new Date(weekStart(now)).toISOString(), monthStart: new Date(monthStart(now)).toISOString(), ...(stats.source === "binance" ? {} : { attempts }) }
    : { at: now.toISOString(), symbol, error: "Market data is unavailable.", attempts };
  const response = json(body, CACHE_SECONDS);
  if (cache) context.waitUntil(cache.put(cacheKey, response.clone()));
  return response;
}
