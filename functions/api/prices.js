// Price snapshot for the homepage strip, fetched from Binance's public REST API at the edge.
// Used for the first paint and as a fallback for visitors whose network blocks Binance directly.
// Responses are cached per symbol set for a few seconds so Binance sees at most one request per
// Cloudflare location in that window.
const UPSTREAMS = ["https://data-api.binance.vision", "https://api.binance.com"];
const SYMBOL = /^[A-Z0-9]{2,20}$/;
const MAX_SYMBOLS = 30;
const CACHE_SECONDS = 3;

function json(value, status = 200, maxAge = 0) {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": maxAge ? `public, max-age=${maxAge}` : "no-store",
    },
  });
}

async function fetchTickers(symbols) {
  const query = `symbols=${encodeURIComponent(JSON.stringify(symbols))}&type=MINI`;
  for (const base of UPSTREAMS) {
    try {
      const response = await fetch(`${base}/api/v3/ticker/24hr?${query}`, { headers: { Accept: "application/json" } });
      if (!response.ok) continue;
      const rows = await response.json();
      if (Array.isArray(rows)) return rows;
    } catch (_) {
      // Try the next upstream.
    }
  }
  return null;
}

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const symbols = [...new Set((url.searchParams.get("symbols") || "").toUpperCase().split(",").filter((s) => SYMBOL.test(s)))]
    .sort()
    .slice(0, MAX_SYMBOLS);
  if (!symbols.length) return json({ error: "No valid symbols." }, 400);

  const cache = typeof caches !== "undefined" ? caches.default : null;
  const cacheKey = new Request(`${url.origin}/api/prices?symbols=${symbols.join(",")}`);
  if (cache) {
    const hit = await cache.match(cacheKey);
    if (hit) return hit;
  }

  const rows = await fetchTickers(symbols);
  if (!rows) return json({ error: "Prices are unavailable." }, 502);

  const response = json({
    at: new Date().toISOString(),
    prices: rows
      .filter((row) => row && SYMBOL.test(row.symbol))
      .map((row) => ({ s: row.symbol, c: row.lastPrice, o: row.openPrice })),
  }, 200, CACHE_SECONDS);
  if (cache) context.waitUntil(cache.put(cacheKey, response.clone()));
  return response;
}
