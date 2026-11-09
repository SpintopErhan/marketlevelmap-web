// Weekly outlook data (README "Weekly outlook"): for every analysed asset (PAXG left out), the last closed
// week's change, where the price stood at the week's start against the monthly open, the yearly open and the
// ATH, and the timeframe alignment of the 1D chart (1W · 1D · 4H structure).
//
// - Last week: the last CLOSED 1W candle in the public candle data (data.marketlevelmap.com, written by the local
//   program): open → close. Its close is this week's open, the "price" the distances below are measured from.
// - Monthly open, yearly open, ATH: the 1D Critical Zones report's key levels (MO, YO, OATH).
// - Alignment: `structure.state` of the 1W, 1D and 4H Price Action reports. Only the three states leave the
//   server; the reports themselves stay members-only (README "Accounts").
// One snapshot per week: cached at the edge for an hour, so a request is cheap and the numbers stay put.
const ACTIVE_POINTER_KEY = "site-publication/active.json";
const CANDLES = "https://data.marketlevelmap.com/candles/";
const LEFT_OUT = new Set(["PAXGUSDT"]);
const ALIGN_TFS = ["1w", "1d", "4h"];
const WEEK = 7 * 86400;

function json(value, maxAge) {
  return new Response(JSON.stringify(value), {
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": maxAge ? `public, max-age=${maxAge}` : "no-store" },
  });
}

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

async function getCandles(url) {
  try {
    const r = await fetch(url, { headers: { Accept: "application/json" }, cf: { cacheTtl: 300 } });
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
    if (method === "PA" && ALIGN_TFS.includes(String(tf).toLowerCase())) s.pa[String(tf).toLowerCase()] = e;
  }
  const start = weekStart(nowMs);
  let indexPromise = null;
  const index = () => (indexPromise ||= fetch(CANDLES + "index.json", { cf: { cacheTtl: 300 } }).then((r) => (r.ok ? r.json() : null)).catch(() => null));
  const assets = await Promise.all(Object.keys(bySymbol).map(async (symbol) => {
    const s = bySymbol[symbol];
    const [rows, cz, ...pa] = await Promise.all([
      weeklyCandles(symbol, start, index),
      s.cz1d ? readJson(bucket, s.cz1d.report.objectKey) : null,
      ...ALIGN_TFS.map((tf) => (s.pa[tf] ? readJson(bucket, s.pa[tf].report.objectKey) : null)),
    ]);
    const week = lastClosedWeek(rows, start);
    const levels = {};
    for (const l of (cz && Array.isArray(cz.levels) ? cz.levels : [])) if (l && l.code && Number(l.price) > 0) levels[String(l.code).toUpperCase()] = Number(l.price);
    const price = week ? week.close : null;
    const alignment = {};
    ALIGN_TFS.forEach((tf, i) => {
      const state = pa[i] && pa[i].structure && pa[i].structure.state;
      alignment[tf] = state === "bullish" || state === "bearish" ? state : null;
    });
    return {
      symbol,
      lastWeek: week ? { openTime: new Date(week.openTime * 1000).toISOString(), change: pct(week.close, week.open) } : null,
      vsMonthlyOpen: pct(price, levels.MO),
      vsYearlyOpen: pct(price, levels.YO),
      vsAth: pct(price, levels.OATH || levels.ATH),
      alignment,
    };
  }));
  return { schemaVersion: "marketlevelmap-weekly-v1", weekStart: new Date(start * 1000).toISOString(), generatedAt: new Date(nowMs).toISOString(), assets };
}

export async function onRequestGet({ request, env, waitUntil }) {
  if (!env.MARKETLEVELMAP_PUBLIC) return json({ error: "not_configured" });
  const now = Date.now();
  const cacheKey = new Request(`${new URL(request.url).origin}/api/weekly?w=${weekStart(now)}`);
  const cache = typeof caches !== "undefined" ? caches.default : null;
  if (cache) {
    const hit = await cache.match(cacheKey);
    if (hit) return hit;
  }
  const data = await buildWeekly(env, now);
  // Kept for the hour only once every asset has last week's candle; until the upload is complete, ask again soon.
  const complete = data.assets.length > 0 && data.assets.every((a) => a.lastWeek);
  const response = json(data, complete ? 600 : 120);
  if (cache && complete) {
    const stored = new Response(JSON.stringify(data), { headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "public, max-age=3600" } });
    const put = cache.put(cacheKey, stored);
    if (waitUntil) waitUntil(put); else await put;
  }
  return response;
}
