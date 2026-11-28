// Admin-only check of which SoSoValue API data the site's key can read (README "ETF flows"). GET
// /api/soso-probe?part=1|2|3|4: each part sends at most 12 requests, taken from the ETF flows minute budget, and answers
// per endpoint only the HTTP status, SoSoValue's code and message, the row count, the date range and the field names —
// never the data itself (part 4 also a short sample: README "Fed meetings"). Run the parts a minute apart.
import { adminUser } from "./auth/[[path]].js";
import { reserve } from "./etf-flows.js";

const V1 = "https://openapi.sosovalue.com/openapi/v1", V3 = "https://openapi.sosovalue.com/openapi/v3";
export const PARTS = {
  1: [
    ["ETF history chart BTC (500 days?)", V1 + "/analyses/total_crypto_spot_etf_fund_flow?limit=500"],
    ["ETF history chart ETH", V1 + "/analyses/total_crypto_eth_etf_fund_flow?limit=500"],
    ["ETF history chart BTC+ETH", V1 + "/analyses/total_crypto_spot_btc_eth_etf_fund_flow_1d?limit=500"],
    ["Chart list", V1 + "/analyses"],
    ["Fear & greed", V1 + "/analyses/fgi_indicator?limit=500"],
    ["BTC futures open interest", V1 + "/analyses/futures_open_interest?limit=500"],
    ["BTC funding rate", V1 + "/analyses/funding_rate?limit=500"],
    ["Binance long/short 1d", V1 + "/analyses/binance_btcusdt_futures_long_short_ratio_1d?limit=500"],
    ["Stablecoin market cap", V1 + "/analyses/stablecoin_total_market_cap?limit=500"],
    ["Total crypto market cap", V1 + "/analyses/total_crypto_market_cap?limit=500"],
    ["ETF market snapshot (IBIT)", V1 + "/etfs/IBIT/market-snapshot"],
    ["Market overview", V1 + "/market/overview"],
  ],
  2: [
    ["FOMC probabilities", V1 + "/macro/fomc-probabilities"],
    ["Macro events", V1 + "/macro/events"],
    ["Macro event history (CPI)", V1 + "/macro/events/" + encodeURIComponent("CPI") + "/history?limit=100"],
    ["Macro rates", V1 + "/macro/rates"],
    ["BTC treasuries list", V1 + "/btc-treasuries"],
    ["BTC purchases (MSTR)", V1 + "/btc-treasuries/MSTR/purchase-history?limit=100"],
    ["Crypto stocks list", V1 + "/crypto-stocks"],
    ["SoSoValue indices", V1 + "/indices"],
    ["Sector spotlight", V1 + "/currencies/sector-spotlight"],
    ["Currencies list", V1 + "/currencies?page_size=5"],
    ["News", V1 + "/news?page_size=5"],
    ["Hot news", V1 + "/news/hot?page_size=5"],
  ],
  3: [
    ["v3 stock quote (AAPL)", V3 + "/instruments/AAPL.US/quote"],
    ["v3 daily candles (SPY, 2000)", V3 + "/instruments/SPY.US/candles?interval=1d&limit=2000"],
    ["v3 daily candles (NVDA, 2000)", V3 + "/instruments/NVDA.US/candles?interval=1d&limit=2000"],
    ["v3 1h candles (NVDA)", V3 + "/instruments/NVDA.US/candles?interval=60m&limit=500"],
    ["v3 15m candles (QQQ)", V3 + "/instruments/QQQ.US/candles?interval=15m&limit=500"],
    ["v3 ETF list", V3 + "/instruments?type=etf&limit=5"],
    ["v3 perp quote (BTC Binance)", V3 + "/instruments/BTC-USDT-PERP.BINANCE/quote"],
    ["v3 perp 1h candles", V3 + "/instruments/BTC-USDT-PERP.BINANCE/candles?interval=60m&limit=500"],
    ["v3 market breadth", V3 + "/market/breadth"],
    ["v3 sectors", V3 + "/market/sectors"],
    ["v3 ETF holdings (SPY)", V3 + "/instruments/SPY.US/holdings"],
    ["v3 earnings (NVDA)", V3 + "/parties/NVDA.US/earnings"],
  ],
  // Fed meetings (28 Nov 2026, after SoSoValue allowed republishing with credit): this part also answers a short
  // sample of each response, to learn the shapes before the feature is built.
  4: [
    ["FOMC probabilities", V1 + "/macro/fomc-probabilities"],
    ["Macro rates", V1 + "/macro/rates"],
    ["Macro events", V1 + "/macro/events"],
    ["FOMC history", V1 + "/macro/events/FOMC/history?limit=50"],
    ["Fed rate decision history", V1 + "/macro/events/" + encodeURIComponent("Fed Interest Rate Decision") + "/history?limit=50"],
    ["Interest rate decision history", V1 + "/macro/events/" + encodeURIComponent("Interest Rate Decision") + "/history?limit=50"],
    ["Fed funds rate history", V1 + "/macro/events/" + encodeURIComponent("Federal Funds Rate") + "/history?limit=50"],
    ["Rate history (FEDFUNDS)", V1 + "/macro/rates/FEDFUNDS/history?limit=50"],
    ["Chart names", V1 + "/analyses"],
  ],
};
const SAMPLE_PARTS = new Set([4]);
// A short look at the data itself: the chart list's names in full, else the first rows (or the object), cut short.
export function sample(body, name) {
  const rows = rowsOf(body);
  if (name === "Chart names" && rows) return rows.map((r) => r && r.chart_name).filter(Boolean);
  const v = rows ? rows.slice(0, 3) : body && body.data !== undefined ? body.data : body;
  const t = JSON.stringify(v);
  return t && t.length > 2500 ? t.slice(0, 2500) + "…" : v;
}

const DATE_KEYS = ["date", "timestamp", "time", "t", "ts", "open_time", "meeting_date", "release_time", "publish_time"];
function toDay(v) {
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10);
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return null;
  return new Date(n > 1e11 ? n : n * 1000).toISOString().slice(0, 10);
}
function rowsOf(body) {
  if (Array.isArray(body)) return body;
  if (!body || typeof body !== "object") return null;
  const d = body.data !== undefined ? body.data : body;
  if (Array.isArray(d)) return d;
  if (d && typeof d === "object") for (const k of ["list", "items", "candles", "rows", "meetings", "events", "data"]) if (Array.isArray(d[k])) return d[k];
  return null;
}
// What a response holds, without its values.
export function describe(status, body) {
  const out = { status };
  if (body && typeof body === "object" && !Array.isArray(body)) {
    if (body.code !== undefined) out.code = body.code;
    if (typeof body.message === "string") out.message = body.message.slice(0, 160);
  }
  const rows = rowsOf(body);
  if (rows) {
    out.rows = rows.length;
    const first = rows.find((r) => r && typeof r === "object");
    if (first) {
      out.fields = Object.keys(first).slice(0, 25);
      const k = DATE_KEYS.find((x) => first[x] !== undefined);
      if (k) {
        const days = rows.map((r) => toDay(r && r[k])).filter(Boolean).sort();
        if (days.length) out.range = [days[0], days[days.length - 1]];
      }
    }
  } else if (body && typeof body === "object") {
    const d = body.data !== undefined && body.data && typeof body.data === "object" ? body.data : body;
    out.fields = Object.keys(d).slice(0, 25);
  }
  out.ok = status === 200 && (out.code === undefined || out.code === 0) && (rows ? rows.length > 0 : !!(out.fields && out.fields.length));
  return out;
}

export async function onRequestGet({ request, env }) {
  const headers = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" };
  if (!(await adminUser(request, env))) return new Response(JSON.stringify({ error: "forbidden" }), { status: 403, headers });
  if (!env.SOSOVALUE_API_KEY) return new Response(JSON.stringify({ error: "not_configured" }), { status: 503, headers });
  const part = Number(new URL(request.url).searchParams.get("part") || 1), list = PARTS[part];
  if (!list) return new Response(JSON.stringify({ error: "part" }), { status: 400, headers });
  if (!(await reserve(env.USERS_DB, list.length))) return new Response(JSON.stringify({ error: "busy", retry: "in a minute" }), { status: 429, headers });
  const results = [];
  for (const [name, url] of list) {
    try {
      const r = await fetch(url, { headers: { "x-soso-api-key": env.SOSOVALUE_API_KEY, Accept: "application/json" }, signal: AbortSignal.timeout(10000) });
      let body = null;
      try { body = await r.json(); } catch (_) { /* not JSON */ }
      const row = { name, path: url.replace(/^https:\/\/openapi\.sosovalue\.com\/openapi/, ""), ...describe(r.status, body) };
      if (SAMPLE_PARTS.has(part)) row.sample = sample(body, name);
      results.push(row);
    } catch (e) {
      results.push({ name, path: url.replace(/^https:\/\/openapi\.sosovalue\.com\/openapi/, ""), status: 0, ok: false, message: String(e && e.message || e).slice(0, 120) });
    }
  }
  return new Response(JSON.stringify({ part, at: new Date().toISOString(), results }, null, 1), { status: 200, headers });
}
