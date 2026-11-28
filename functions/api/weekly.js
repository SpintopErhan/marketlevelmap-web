// Weekly outlook data (README "Weekly outlook"): for every analysed asset (PAXG left out), the last closed
// week's change, where the price stood at the week's start against the monthly open, the yearly open and the
// ATH, and the timeframe alignment of the 1D chart (1W · 1D · 4H structure).
//
// - Last week: the last CLOSED 1W candle in the public candle data (data.marketlevelmap.com, written by the local
//   program): open → close. Its close is this week's open, the "price" the distances below are measured from.
// - Monthly open, yearly open, ATH: `keyLevels` of candles/<SYMBOL>/levels.json, written by the local program with
//   the candles (so never older than the candles). A level whose period started after the week closed (the
//   first week of a new month or year) is left out rather than mixed up. Until an asset's file carries
//   keyLevels, its 1D Critical Zones report's levels are used (MO, YO, ATH, else OATH).
// - Alignment: `structure.state` of the 1W, 1D and 4H Price Action reports. Only the three states leave the
//   server; the reports themselves stay members-only (README "Accounts").
// - Macro and commodities: last week's weekly candle (open → close) of the US dollar index, S&P 500 and Nasdaq 100
//   futures and COMEX gold and silver futures from Yahoo Finance; the US 10-year yield's change in basis points.
//   Their week runs Monday to Friday (futures open Sunday evening UTC). A source that fails leaves its item null.
// Snapshot: kept in D1 (USERS_DB, table `snapshots`) and at the edge. A visitor always gets the stored snapshot at
// once; when it is older than an hour (two minutes while some asset still lacks last week's candle) it is rebuilt in
// the background for the next visitor. Only the very first request of a week waits for the build.
const ACTIVE_POINTER_KEY = "site-publication/active.json";
const CANDLES = "https://data.marketlevelmap.com/candles/";
const LEFT_OUT = new Set(["PAXGUSDT"]);
// Tokenized stocks (README "Tokenized stocks"): in the outlook as their own group; their data starts in August 2026, so
// no yearly open, and their "ATH" is LH (highest since listing; athCode "LH"); no Price Action reports yet.
const isStock = (symbol) => /^[A-Z]{1,6}CUSDC$/.test(symbol);
const ALIGN_TFS = ["1w", "1d", "4h"];
const WEEK = 7 * 86400;

function json(value, maxAge) {
  return new Response(JSON.stringify(value), {
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": maxAge ? `public, max-age=${maxAge}` : "no-store" },
  });
}

// A slow source must not hold the whole snapshot: its request is given up after `ms` (the item is left empty).
const timeout = (ms) => (typeof AbortSignal !== "undefined" && AbortSignal.timeout ? AbortSignal.timeout(ms) : undefined);

async function readJson(bucket, key) {
  if (!key) return null;
  try {
    const object = await bucket.get(key);
    return object ? await object.json() : null;
  } catch (_) {
    return null;
  }
}

// Monday 00:00 UTC of the current week, in seconds.
export function weekStart(nowMs) {
  const d = new Date(nowMs);
  const day = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) / 1000;
  return day - ((d.getUTCDay() + 6) % 7) * 86400;
}

// Last week's candle ([openSec, open, high, low, close, …] rows): exactly the week before `start`. An older
// candle is never used in its place, so a late upload shows "–" instead of the wrong week.
export function lastClosedWeek(rows, start) {
  const r = (Array.isArray(rows) ? rows : []).find((x) => Array.isArray(x) && Number(x[0]) === start - WEEK && Number(x[1]) > 0 && Number(x[4]) > 0);
  return r ? { openTime: Number(r[0]), open: Number(r[1]), close: Number(r[4]) } : null;
}

const pct = (price, level) => (price > 0 && level > 0 ? Math.round((price / level - 1) * 10000) / 100 : null);
const parts = (entry) => String(entry && entry.graphicKey || "").split(":");

async function getJson(url) {
  try {
    const r = await fetch(url, { headers: { Accept: "application/json" }, cf: { cacheTtl: 300 }, signal: timeout(8000) });
    return r.ok ? await r.json() : null;
  } catch (_) {
    return null;
  }
}

// keyLevels of levels.json → { MO: {price, periodStart}, … }
export function keyLevelMap(file, symbol) {
  const list = file && file.pair === symbol && file.keyLevels && Array.isArray(file.keyLevels.levels) ? file.keyLevels.levels : null;
  if (!list) return null;
  const map = {};
  for (const l of list) if (l && l.code && Number(l.price) > 0) map[String(l.code).toUpperCase()] = { price: Number(l.price), periodStart: l.periodStart ? Date.parse(l.periodStart) / 1000 : null };
  return map;
}

async function getCandles(url) {
  try {
    const r = await fetch(url, { headers: { Accept: "application/json" }, cf: { cacheTtl: 300 }, signal: timeout(8000) });
    return r.ok ? ((await r.json()).candles || []) : [];
  } catch (_) {
    return [];
  }
}

// latest.json first; right after a new archive file starts (e.g. a new year) last week can sit in the newest archive.
async function weeklyCandles(symbol, start, index) {
  const base = `${CANDLES}${encodeURIComponent(symbol)}/1w/`;
  const rows = await getCandles(base + "latest.json");
  if (lastClosedWeek(rows, start)) return rows;
  const idx = await index();
  const archives = idx && idx.pairs && idx.pairs[symbol] && idx.pairs[symbol]["1w"] && idx.pairs[symbol]["1w"].archives;
  const last = Array.isArray(archives) && archives.length ? archives[archives.length - 1] : null;
  return last ? rows.concat(await getCandles(base + encodeURIComponent(last) + ".json")) : rows;
}

// Fallback when the public candle files do not have last week yet (the local program uploads them now and then):
// OKX's UTC weekly candle (1Wutc, opens Monday 00:00 UTC like Binance's), closed ("confirm" 1) and exactly the week
// before `start`. Cloudflare can reach OKX (Binance refuses it). Rows: [ts ms, open, high, low, close, …, confirm].
export function okxWeekFrom(body, start) {
  const rows = body && body.code === "0" && Array.isArray(body.data) ? body.data : [];
  const r = rows.find((x) => Array.isArray(x) && Number(x[0]) === (start - WEEK) * 1000 && String(x[8]) === "1" && Number(x[1]) > 0 && Number(x[4]) > 0);
  return r ? { openTime: start - WEEK, open: Number(r[1]), close: Number(r[4]), source: "okx" } : null;
}
async function okxWeek(symbol, start) {
  if (!/USDT$/.test(symbol)) return null;
  const id = `${symbol.slice(0, -4)}-USDT`;
  return okxWeekFrom(await getJson(`https://www.okx.com/api/v5/market/candles?instId=${encodeURIComponent(id)}&bar=1Wutc&limit=3`), start);
}

// Yahoo weekly candles: the bar of the week before `start` (its time is that Monday, or the Sunday evening before
// for futures), never the current week's.
export const MACRO = [["dxy", "DX-Y.NYB"], ["us10y", "^TNX"], ["spx", "ES=F"], ["ndx", "NQ=F"], ["gold", "GC=F"], ["silver", "SI=F"]];
export function yahooWeek(body, start) {
  const r = body && body.chart && body.chart.result && body.chart.result[0];
  const t = r && r.timestamp, q = r && r.indicators && r.indicators.quote && r.indicators.quote[0];
  if (!Array.isArray(t) || !q) return null;
  for (let i = 0; i < t.length; i++) {
    const open = Number(q.open && q.open[i]), close = Number(q.close && q.close[i]);
    if (t[i] >= start - WEEK - 2 * 86400 && t[i] < start - 2 * 86400 && open > 0 && close > 0) return { open, close };
  }
  return null;
}
export const YAHOO_HEADERS = { "User-Agent": "Mozilla/5.0 (compatible; MarketLevelMap/1.0)", Accept: "application/json" };
async function macroWeek(symbol, start) {
  for (const host of ["query1", "query2"]) {
    let body = null;
    try {
      const r = await fetch(`https://${host}.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=1mo&interval=1wk`, { headers: YAHOO_HEADERS, signal: timeout(3000) });
      body = r.ok ? await r.json() : null;
    } catch (_) { body = null; }
    const w = yahooWeek(body, start);
    if (w) return w;
  }
  return null;
}
export async function buildMacro(start) {
  const out = {};
  await Promise.all(MACRO.map(async ([key, symbol]) => {
    const w = await macroWeek(symbol, start);
    if (!w) { out[key] = null; return; }
    // ^TNX is the yield in percent (older feeds quoted it times ten): the change in basis points.
    const k = key === "us10y" && w.close > 20 ? 10 : 1;
    out[key] = key === "us10y" ? { close: w.close / k, changeBp: Math.round((w.close - w.open) / k * 1000) / 10 } : { close: w.close, change: pct(w.close, w.open) };
  }));
  return out;
}

export async function buildWeekly(env, nowMs) {
  const bucket = env.MARKETLEVELMAP_PUBLIC;
  const active = await readJson(bucket, ACTIVE_POINTER_KEY);
  const entries = (active && Array.isArray(active.entries) ? active.entries : []).filter((e) => {
    const [, symbol] = parts(e);
    return /^[A-Z0-9]{2,20}$/.test(symbol || "") && !LEFT_OUT.has(symbol) && e.report && e.report.objectKey;
  });
  const bySymbol = {};
  for (const e of entries) {
    const [source, symbol, tf] = parts(e);
    const s = (bySymbol[symbol] ||= { cz1d: null, pa: {} });
    const method = String(source).toUpperCase();
    if (method === "CZ" && String(tf).toLowerCase() === "1d") s.cz1d = e;
    // Tokenized stocks are members-only: their Price Action structure does not reach the public outlook.
    if (method === "PA" && ALIGN_TFS.includes(String(tf).toLowerCase()) && !isStock(symbol)) s.pa[String(tf).toLowerCase()] = e;
  }
  const start = weekStart(nowMs);
  let indexPromise = null;
  const index = () => (indexPromise ||= fetch(CANDLES + "index.json", { cf: { cacheTtl: 300 } }).then((r) => (r.ok ? r.json() : null)).catch(() => null));
  const macroPromise = buildMacro(start).catch(() => null);
  // Assets without analysis (README "Assets without analysis"): every pair with weekly candles is in the outlook.
  const idx = await index();
  for (const symbol of Object.keys((idx && idx.pairs) || {})) {
    if (/^[A-Z0-9]{2,20}$/.test(symbol) && !LEFT_OUT.has(symbol) && idx.pairs[symbol]["1w"]) bySymbol[symbol] ||= { cz1d: null, pa: {}, noAnalysis: true };
  }
  const assets = await Promise.all(Object.keys(bySymbol).map(async (symbol) => {
    const s = bySymbol[symbol];
    const [rows, file, cz, ...pa] = await Promise.all([
      weeklyCandles(symbol, start, index),
      getJson(`${CANDLES}${encodeURIComponent(symbol)}/levels.json`),
      s.cz1d ? readJson(bucket, s.cz1d.report.objectKey) : null,
      ...ALIGN_TFS.map((tf) => (s.pa[tf] ? readJson(bucket, s.pa[tf].report.objectKey) : null)),
    ]);
    // A pair whose daily candles start after last week began (a new listing) has no full last week: its weekly
    // candle would cover only a few days, so it is left out, and its absence is not a missing upload.
    const tfs = idx && idx.pairs && idx.pairs[symbol];
    const firstDay = Number((tfs && tfs["1d"] && tfs["1d"].firstOpenTime) || (tfs && tfs["1w"] && tfs["1w"].firstOpenTime) || 0);
    const newListing = firstDay > start - WEEK;
    const week = newListing ? null : lastClosedWeek(rows, start) || await okxWeek(symbol, start);
    const levels = {}, key = keyLevelMap(file, symbol);
    if (key) {
      // Only levels whose period had begun when last week closed.
      for (const code of isStock(symbol) ? ["MO"] : ["MO", "YO", "ATH"]) if (key[code] && !(key[code].periodStart >= start)) levels[code] = key[code].price;
      // Tokenized stocks: LH (highest since listing) in the ATH place.
      if (isStock(symbol) && key.LH) levels.ATH = key.LH.price;
    } else {
      for (const l of (cz && Array.isArray(cz.levels) ? cz.levels : [])) if (l && l.code && Number(l.price) > 0) levels[String(l.code).toUpperCase()] = Number(l.price);
      if (!levels.ATH && levels.OATH) levels.ATH = levels.OATH;
    }
    const price = week ? week.close : null;
    const alignment = {};
    ALIGN_TFS.forEach((tf, i) => {
      const state = pa[i] && pa[i].structure && pa[i].structure.state;
      alignment[tf] = state === "bullish" || state === "bearish" ? state : null;
    });
    return {
      symbol,
      category: isStock(symbol) ? "stock" : "crypto",
      ...(s.noAnalysis ? { noAnalysis: true } : {}),
      ...(newListing ? { newListing: true } : {}),
      ...(isStock(symbol) && levels.ATH ? { athCode: "LH" } : {}),
      lastWeek: week ? { openTime: new Date(week.openTime * 1000).toISOString(), change: pct(week.close, week.open), ...(week.source ? { source: week.source } : {}) } : null,
      vsMonthlyOpen: pct(price, levels.MO),
      vsYearlyOpen: pct(price, levels.YO),
      vsAth: pct(price, levels.ATH),
      levelsFrom: key ? "candles" : "report",
      alignment,
    };
  }));
  return { schemaVersion: "marketlevelmap-weekly-v1", weekStart: new Date(start * 1000).toISOString(), generatedAt: new Date(nowMs).toISOString(), assets, macro: await macroPromise };
}

// Complete: every asset has last week's candle from the public (Binance) candle files and the macro sources answered.
// A snapshot missing either, or with a week taken from OKX, is rebuilt every two minutes and is not kept at the edge,
// so the Binance candles show within minutes of their upload.
export const isComplete = (data) => !!(data && data.assets && data.assets.length > 0 && data.assets.every((a) => a.newListing || (a.lastWeek && !a.lastWeek.source)) &&
  data.macro && Object.values(data.macro).some((v) => v));
const FRESH_MS = 3600 * 1000, FRESH_INCOMPLETE_MS = 120 * 1000;

// ---- stored snapshot (D1). Any failure here falls back to building the answer, as before. ----
let tableReady = false;
async function snapshotTable(db) {
  if (!tableReady) {
    await db.prepare("CREATE TABLE IF NOT EXISTS snapshots (key TEXT PRIMARY KEY, body TEXT NOT NULL, updated_at INTEGER NOT NULL)").run();
    tableReady = true;
  }
  return db;
}
export async function readSnapshot(db, key) {
  if (!db) return null;
  try {
    const row = await (await snapshotTable(db)).prepare("SELECT body, updated_at FROM snapshots WHERE key = ?").bind(key).first();
    return row ? { data: JSON.parse(row.body), at: Number(row.updated_at) } : null;
  } catch (_) { return null; }
}
export async function writeSnapshot(db, key, data, at) {
  if (!db) return;
  try {
    await (await snapshotTable(db)).prepare("INSERT INTO snapshots (key, body, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET body = excluded.body, updated_at = excluded.updated_at")
      .bind(key, JSON.stringify(data), at).run();
  } catch (_) { /* the answer is still served */ }
}
// Snapshot age at which it is rebuilt in the background.
export const isStale = (snap, nowMs) => nowMs - snap.at > (isComplete(snap.data) ? FRESH_MS : FRESH_INCOMPLETE_MS);

export async function onRequestGet({ request, env, waitUntil }) {
  if (!env.MARKETLEVELMAP_PUBLIC) return json({ error: "not_configured" });
  const now = Date.now(), start = weekStart(now);
  // v: raised when the response gains fields, so a snapshot made before the change is not served for the rest of the week.
  const cacheKey = new Request(`${new URL(request.url).origin}/api/weekly?w=${start}&v=2`);
  const storeKey = `weekly:${start}:v2`;
  const cache = typeof caches !== "undefined" ? caches.default : null;
  if (cache) {
    const hit = await cache.match(cacheKey);
    if (hit) return hit;
  }
  const later = (p) => { if (p && waitUntil) waitUntil(p); };
  // Kept at the edge only until the snapshot is due for a rebuild (an hour after it was made, not an hour after this
  // visit): re-putting a fresh copy with a full hour on every visit kept an old snapshot out for up to two hours.
  const edge = (data, madeAt = Date.now()) => {
    if (!cache || !isComplete(data)) return null;
    const maxAge = Math.max(60, Math.round((madeAt + FRESH_MS - Date.now()) / 1000));
    return cache.put(cacheKey, new Response(JSON.stringify(data), { headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": `public, max-age=${maxAge}` } }));
  };
  const rebuild = async () => {
    const data = await buildWeekly(env, Date.now());
    await writeSnapshot(env.USERS_DB, storeKey, data, Date.now());
    await edge(data);
    return data;
  };
  const stored = await readSnapshot(env.USERS_DB, storeKey);
  if (stored) {
    if (isStale(stored, now)) later(rebuild().catch(() => null));
    else if (isComplete(stored.data)) later(edge(stored.data, stored.at));
    return json(stored.data, isComplete(stored.data) ? 600 : 120);
  }
  const data = await buildWeekly(env, now);
  later(Promise.all([writeSnapshot(env.USERS_DB, storeKey, data, now), edge(data)]).catch(() => null));
  return json(data, isComplete(data) ? 600 : 120);
}
