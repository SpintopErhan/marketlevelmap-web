// MarketLevelMap chart-data Worker — Phase 0: Binance access probe.
// Writes nothing. Every hour it checks that this Worker can read CLOSED candles
// from Binance's public market-data endpoint and logs one JSON line per run
// (read them with `wrangler tail` or Workers Logs). See ../README.md.

export const PAIRS = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "XRPUSDT", "AVAXUSDT"];
export const PRIMARY = "https://data-api.binance.vision";
export const FALLBACK = "https://api.binance.com";
const TRACE = "https://www.cloudflare.com/cdn-cgi/trace";
const HOUR_MS = 3600 * 1000;

async function timed(fetchImpl, url) {
  const started = Date.now();
  try {
    const response = await fetchImpl(url, { headers: { accept: "application/json" } });
    const body = await response.text();
    return { status: response.status, ms: Date.now() - started, body };
  } catch (error) {
    return { status: 0, ms: Date.now() - started, error: String(error && error.message || error) };
  }
}

// Binance kline: [openTime, open, high, low, close, volume, closeTime, ...]
export function lastClosed(klines, nowMs) {
  const closed = klines.filter((k) => Number(k[6]) <= nowMs);
  return closed.length ? closed[closed.length - 1] : null;
}

async function where(fetchImpl) {
  const result = await timed(fetchImpl, TRACE);
  const fields = Object.fromEntries((result.body || "").split("\n").filter(Boolean).map((line) => line.split("=")));
  return { colo: fields.colo || null, loc: fields.loc || null };
}

async function probePair(fetchImpl, base, pair, nowMs) {
  const result = await timed(fetchImpl, `${base}/api/v3/klines?symbol=${pair}&interval=1h&limit=3`);
  const row = { pair, status: result.status, ms: result.ms };
  if (result.error) row.error = result.error;
  if (result.status !== 200) {
    if (result.body) row.body = result.body.slice(0, 200);
    return row;
  }
  try {
    const candle = lastClosed(JSON.parse(result.body), nowMs);
    row.lastClosedOpen = candle ? new Date(Number(candle[0])).toISOString() : null;
    // The latest CLOSED 1H candle opened one hour before the current hour began.
    const expected = Math.floor(nowMs / HOUR_MS) * HOUR_MS - HOUR_MS;
    row.fresh = candle ? Number(candle[0]) === expected : false;
  } catch (error) {
    row.error = "unparseable response";
  }
  return row;
}

export async function runProbe(fetchImpl, nowMs) {
  const location = await where(fetchImpl);
  const primary = [];
  for (const pair of PAIRS) primary.push(await probePair(fetchImpl, PRIMARY, pair, nowMs));
  // One request against the main API, only to learn whether it is reachable from here.
  const fallback = await probePair(fetchImpl, FALLBACK, PAIRS[0], nowMs);
  const ok = primary.every((row) => row.status === 200 && row.fresh);
  return {
    probe: "binance-access-v1",
    at: new Date(nowMs).toISOString(),
    ...location,
    ok,
    primary,
    fallback: { base: FALLBACK, ...fallback },
  };
}

export default {
  async scheduled(event, env, ctx) {
    const report = await runProbe(fetch, event.scheduledTime || Date.now());
    // One structured line per run; `ok:false` lines are what we look for.
    console.log(JSON.stringify(report));
  },
};
