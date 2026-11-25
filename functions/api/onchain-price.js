// Live price of the tokenized stocks (README "Tokenized stocks"): GET /api/onchain-price?symbols=NVDACUSDC,AAPLCUSDC.
// The price is read straight from the token's main pool on Base (`slot0`, the pool's current price), so it needs no
// data licence. The pools come from candles/<PAIR>/pools.json, written by the local program with the candles (pools
// change: a new one becomes the main pool). The 24-hour figures come from the 1H candle files: open 24 hours ago,
// high, low and USDC volume (field 9) of the last 24 candles. Without pools.json, or when no pool answers, or when the
// pool price is far from a recent candle (a broken or emptied pool), the price is the last candle's close and says so.
// Answer: { at, prices: [ { s, c, o, h, l, q, quote: "USDC", source: "pool"|"candle", priceAt, candleAt } ] }; cached
// 20 seconds at the edge.
const CANDLES = "https://data.marketlevelmap.com/candles/";
const RPCS = ["https://mainnet.base.org", "https://base-rpc.publicnode.com"];
const SYMBOL = /^[A-Z]{1,6}CUSDC$/;
const MAX_SYMBOLS = 20;
const CACHE_SECONDS = 20;
const SLOT0 = "0x3850c7bd"; // slot0(): Uniswap v3 and its forks (Aerodrome Slipstream…); the first word is sqrtPriceX96
const MAX_GAP = 0.15; // pool price further than this from a candle younger than FRESH_CANDLE_MS is not used
const FRESH_CANDLE_MS = 6 * 3600 * 1000;
const HOUR = 3600;

function json(body, maxAge) {
  return new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": maxAge ? `public, max-age=${maxAge}` : "no-store" } });
}
async function getJson(url, ttl) {
  try { const r = await fetch(url, { cf: { cacheTtl: ttl }, signal: AbortSignal.timeout(6000) }); return r.ok ? await r.json() : null; } catch (_) { return null; }
}
const isAddress = (a) => typeof a === "string" && /^0x[0-9a-fA-F]{40}$/.test(a);

// Price of one token in quote units from a pool's sqrtPriceX96 (hex word). token0 is the lower address.
export function poolPrice(sqrtHex, token, quote) {
  const sqrt = Number(BigInt(sqrtHex)) / 2 ** 96;
  if (!(sqrt > 0) || !Number.isFinite(sqrt)) return null;
  const r = sqrt * sqrt; // token1 raw per token0 raw
  const quoteIs0 = quote.address.toLowerCase() < token.address.toLowerCase();
  const p = quoteIs0 ? 10 ** (token.decimals - quote.decimals) / r : r * 10 ** (token.decimals - quote.decimals);
  return Number.isFinite(p) && p > 0 ? p : null;
}
// Every pool's slot0 in ONE eth_call through Multicall3 (the same address on every EVM chain, Base included):
// separate or batched calls from Cloudflare were partly refused, one call is not. Returns { address(lower case): first
// 32-byte word of its slot0 }. Pools that fail inside the multicall are simply missing; the next endpoint is asked
// only when the whole call fails.
const MULTICALL3 = "0xca11bde05977b3631167028862be2a173976ca11";
const AGGREGATE3 = "0x82ad56cb"; // aggregate3((address target, bool allowFailure, bytes callData)[])
const word = (hex) => hex.padStart(64, "0");
export function encodeAggregate3(addresses) {
  const n = addresses.length, parts = [word("20"), word(n.toString(16))];
  for (let i = 0; i < n; i++) parts.push(word((n * 32 + i * 160).toString(16))); // offsets of the tuples
  for (const a of addresses) {
    parts.push(word(a.toLowerCase().replace(/^0x/, "")), word("1"), word("60"), word("4"), SLOT0.slice(2).padEnd(64, "0"));
  }
  return AGGREGATE3 + parts.join("");
}
// (bool success, bytes returnData)[] → the first word of each successful returnData (or null).
export function decodeAggregate3(hex, n) {
  const d = hex.replace(/^0x/, ""), at = (pos) => parseInt(d.slice(pos * 2, pos * 2 + 64), 16);
  const arr = at(0), len = at(arr), out = [];
  if (len !== n) return null;
  for (let i = 0; i < n; i++) {
    const t = arr + 32 + at(arr + 32 + i * 32), ok = at(t) === 1, b = t + at(t + 32), blen = at(b);
    out.push(ok && blen >= 32 ? "0x" + d.slice((b + 32) * 2, (b + 64) * 2) : null);
  }
  return out;
}
export async function slot0Batch(addresses) {
  const out = {}, list = [...new Set(addresses.map((a) => a.toLowerCase()))];
  if (!list.length) return out;
  const data = encodeAggregate3(list);
  for (const url of RPCS) {
    try {
      const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", "User-Agent": "marketlevelmap-site" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_call", params: [{ to: MULTICALL3, data }, "latest"] }), signal: AbortSignal.timeout(6000) });
      const b = r.ok ? await r.json() : null, words = b && typeof b.result === "string" ? decodeAggregate3(b.result, list.length) : null;
      if (!words) continue;
      list.forEach((a, i) => { if (words[i]) out[a] = words[i]; });
      return out;
    } catch (_) { /* next endpoint */ }
  }
  return out;
}
// The pools file's usable part: { token, quote, pools: [address…] } (main pool first), or null.
export function readPools(f, pair) {
  if (!f || f.pair !== pair || !f.token || !f.quote || !isAddress(f.token.address) || !isAddress(f.quote.address)) return null;
  const td = Number(f.token.decimals), qd = Number(f.quote.decimals);
  if (!Number.isInteger(td) || !Number.isInteger(qd)) return null;
  const pools = (Array.isArray(f.pools) ? f.pools : []).filter((p) => p && isAddress(p.address) && (!p.kind || p.kind === "v3")).map((p) => p.address).slice(0, 3);
  return pools.length ? { token: { address: f.token.address, decimals: td }, quote: { address: f.quote.address, decimals: qd }, pools } : null;
}
// The last 24 hours from 1H candle rows [openSec, o, h, l, c, volume, …, usdcVolume (index 9)] (oldest first).
export function dayStats(rows) {
  if (!rows.length) return null;
  const last = rows[rows.length - 1], from = last[0] - 23 * HOUR, day = rows.filter((r) => r[0] >= from);
  return {
    o: Number(day[0][1]), h: Math.max(...day.map((r) => Number(r[2]))), l: Math.min(...day.map((r) => Number(r[3]))),
    q: day.reduce((a, r) => a + (Number(r[9]) || 0), 0), last: Number(last[4]), candleAt: (last[0] + HOUR) * 1000,
  };
}
async function candles(pair, index) {
  const tf = index && index.pairs && index.pairs[pair] && index.pairs[pair]["1h"];
  if (!tf) return [];
  const names = ["latest"].concat((tf.archives || []).slice(-1)); // the last archive covers the first day of a month
  const files = await Promise.all(names.map((n) => getJson(`${CANDLES}${encodeURIComponent(pair)}/1h/${n}.json`, 60)));
  const byTime = new Map();
  files.forEach((f) => (f && Array.isArray(f.candles) ? f.candles : []).forEach((r) => { if (Array.isArray(r) && r.length >= 5) byTime.set(r[0], r); }));
  return [...byTime.values()].sort((a, b) => a[0] - b[0]);
}
// What a pair needs before the pools are read: its 24 h figures from the candles and its pools.
async function pairInfo(pair, index) {
  const [rows, poolsFile] = await Promise.all([candles(pair, index), getJson(`${CANDLES}${encodeURIComponent(pair)}/pools.json`, 300)]);
  const st = dayStats(rows);
  return st ? { pair, st, cfg: readPools(poolsFile, pair) } : null;
}
// The answer for one pair from its candles and the pools' words: the first pool (main first) with a sane price.
export function priceFrom(info, words, now = Date.now()) {
  const { pair, st, cfg } = info;
  const out = { s: pair, o: st.o, h: st.h, l: st.l, q: st.q, quote: "USDC", c: st.last, source: "candle", priceAt: st.candleAt, candleAt: st.candleAt };
  for (const address of cfg ? cfg.pools : []) {
    const word = words[address.toLowerCase()], p = word ? poolPrice(word, cfg.token, cfg.quote) : null;
    if (!p) continue;
    if (now - st.candleAt < FRESH_CANDLE_MS && Math.abs(p / st.last - 1) > MAX_GAP) continue;
    Object.assign(out, { c: p, source: "pool", priceAt: now, h: Math.max(st.h, p), l: Math.min(st.l, p) });
    break;
  }
  return out;
}
export async function pricesOf(pairs, index, now = Date.now()) {
  const infos = (await Promise.all(pairs.map((p) => pairInfo(p, index)))).filter(Boolean);
  const words = await slot0Batch(infos.flatMap((i) => (i.cfg ? i.cfg.pools : [])));
  return infos.map((i) => priceFrom(i, words, now));
}
export async function priceOf(pair, index, now = Date.now()) { return (await pricesOf([pair], index, now))[0] || null; }

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const symbols = [...new Set((url.searchParams.get("symbols") || "").toUpperCase().split(",").filter((s) => SYMBOL.test(s)))].sort().slice(0, MAX_SYMBOLS);
  if (!symbols.length) return json({ prices: [], error: "No valid symbols." });
  const cache = typeof caches !== "undefined" ? caches.default : null;
  const key = new Request(`${url.origin}/api/onchain-price?symbols=${symbols.join(",")}`);
  if (cache) { const hit = await cache.match(key); if (hit) return hit; }
  const index = await getJson(CANDLES + "index.json", 120);
  const prices = await pricesOf(symbols, index);
  const response = json({ at: new Date().toISOString(), prices }, CACHE_SECONDS);
  if (cache && context.waitUntil) context.waitUntil(cache.put(key, response.clone()));
  return response;
}
