// Member alarms (README "Alarms"): the database tables, the price source and the rules that decide when an alarm
// fires, shared by the site (functions/api/auth) and the alarm Worker (workers/alarms).
//
// Alarm kinds:
//   price + above / below  — the price is at or above / at or below a level (checked every minute).
//   zone  + enter          — the price is inside a zone the member chose (every minute).
//   zone  + break          — a candle of the chosen timeframe closed beyond the zone: under a support zone, over a
//                            resistance zone (checked on closed candles only, so a wick does not fire it).
// An alarm fires once and is then switched off; the member can switch it on again. Prices and candles come from
// OKX (reachable from Cloudflare, unlike Binance); Coinbase and Kraken stand in for a price OKX does not answer.

export const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS push_subs (
    id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, endpoint TEXT NOT NULL UNIQUE,
    p256dh TEXT NOT NULL, auth TEXT NOT NULL, ua TEXT, created_at TEXT NOT NULL, last_ok_at TEXT)`,
  "CREATE INDEX IF NOT EXISTS push_subs_user ON push_subs (user_id)",
  `CREATE TABLE IF NOT EXISTS alarms (
    id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, kind TEXT NOT NULL, asset TEXT NOT NULL,
    cond TEXT NOT NULL, price REAL, zone_low REAL, zone_high REAL, zone_type TEXT, tf TEXT,
    lang TEXT NOT NULL DEFAULT 'tr', active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL,
    triggered_at TEXT, triggered_price REAL)`,
  "CREATE INDEX IF NOT EXISTS alarms_active ON alarms (active)",
  "CREATE INDEX IF NOT EXISTS alarms_user ON alarms (user_id)",
];

export const MAX_ACTIVE = 20;
export const TF_SECONDS = { "1h": 3600, "4h": 14400, "1d": 86400, "1w": 604800 };
const OKX_BAR = { "1h": "1H", "4h": "4H", "1d": "1Dutc", "1w": "1Wutc" }; // UTC candles, like the charts
const ASSET = /^[A-Z0-9]{2,20}$/;

// ---- validation of a new alarm (from the page) ----
export function cleanAlarm(input) {
  const a = input || {}, kind = a.kind, cond = a.cond, asset = String(a.asset || "").toUpperCase();
  const lang = a.lang === "en" ? "en" : "tr", num = (v) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : null);
  if (!ASSET.test(asset)) return { error: "asset" };
  if (kind === "price") {
    if (cond !== "above" && cond !== "below") return { error: "cond" };
    const price = num(a.price);
    if (!price) return { error: "price" };
    return { kind, cond, asset, price, lang };
  }
  if (kind === "zone") {
    if (cond !== "enter" && cond !== "break") return { error: "cond" };
    const z = a.zone || {}, low = num(z.low), high = num(z.high), type = z.type === "resistance" ? "resistance" : z.type === "support" ? "support" : null;
    if (!low || !high || low >= high || !type) return { error: "zone" };
    const tf = String(a.tf || "").toLowerCase();
    if (cond === "break" && !TF_SECONDS[tf]) return { error: "tf" };
    return { kind, cond, asset, zone_low: low, zone_high: high, zone_type: type, tf: cond === "break" ? tf : null, lang };
  }
  return { error: "kind" };
}

// ---- prices ----
const okxId = (asset) => asset.replace(/USDT$/, "") + "-USDT";
async function getJson(url, ms = 6000) {
  const r = await fetch(url, { headers: { Accept: "application/json", "User-Agent": "MarketLevelMap alarms (+https://marketlevelmap.com)" }, signal: AbortSignal.timeout(ms) });
  if (!r.ok) throw new Error(url + " " + r.status);
  return r.json();
}
// { BTCUSDT: { price, source } } for the assets asked (USDT pairs).
export async function fetchPrices(assets) {
  const out = {};
  try {
    const d = await getJson("https://www.okx.com/api/v5/market/tickers?instType=SPOT");
    const by = {}; (d.data || []).forEach((t) => { by[t.instId] = Number(t.last); });
    assets.forEach((a) => { const p = by[okxId(a)]; if (p > 0) out[a] = { price: p, source: "OKX" }; });
  } catch (_) { /* fall back below */ }
  await Promise.all(assets.filter((a) => !out[a]).map(async (a) => {
    const base = a.replace(/USDT$/, "");
    try { const d = await getJson(`https://api.exchange.coinbase.com/products/${base}-USD/ticker`); if (Number(d.price) > 0) { out[a] = { price: Number(d.price), source: "Coinbase" }; return; } } catch (_) {}
    try {
      const d = await getJson(`https://api.kraken.com/0/public/Ticker?pair=${base === "BTC" ? "XBT" : base}USDT`);
      const v = d.result && Object.values(d.result)[0];
      if (v && Number(v.c[0]) > 0) out[a] = { price: Number(v.c[0]), source: "Kraken" };
    } catch (_) {}
  }));
  return out;
}
// The last closed candle of an asset and timeframe from OKX: { open (sec), close (sec), closePrice } or null.
export async function lastClosedCandle(asset, tf) {
  const d = await getJson(`https://www.okx.com/api/v5/market/candles?instId=${okxId(asset)}&bar=${OKX_BAR[tf]}&limit=3`);
  const row = (d.data || []).find((c) => c[8] === "1"); // newest first; "1" = confirmed (closed)
  if (!row) return null;
  const open = Math.floor(Number(row[0]) / 1000);
  return { open, close: open + TF_SECONDS[tf], closePrice: Number(row[4]) };
}

// ---- rules ----
// alarm: a database row; price: { price, source } or undefined; candle: lastClosedCandle result for (asset, tf).
// Returns null, or { price, source, candle } describing what fired it.
export function check(alarm, price, candle) {
  if (alarm.kind === "price") {
    if (!price) return null;
    if (alarm.cond === "above" && price.price >= alarm.price) return { price: price.price, source: price.source };
    if (alarm.cond === "below" && price.price <= alarm.price) return { price: price.price, source: price.source };
    return null;
  }
  if (alarm.kind === "zone" && alarm.cond === "enter") {
    if (!price) return null;
    return price.price >= alarm.zone_low && price.price <= alarm.zone_high ? { price: price.price, source: price.source } : null;
  }
  if (alarm.kind === "zone" && alarm.cond === "break") {
    // Only a candle that closed after the alarm was set counts.
    if (!candle || candle.close * 1000 <= Date.parse(alarm.created_at)) return null;
    const out = alarm.zone_type === "support" ? candle.closePrice < alarm.zone_low : candle.closePrice > alarm.zone_high;
    return out ? { price: candle.closePrice, source: "OKX", candle } : null;
  }
  return null;
}

// ---- the notification text (descriptive only) ----
function digitsFor(v) { return v >= 100 ? 1 : v >= 1 ? 2 : v >= 0.01 ? 4 : 6; }
function money(v, lang, d) {
  const s = new Intl.NumberFormat(lang === "en" ? "en-US" : "tr-TR", { minimumFractionDigits: d, maximumFractionDigits: d }).format(v);
  return lang === "en" ? "$" + s : s + " $";
}
export function message(alarm, hit) {
  const en = alarm.lang === "en", base = alarm.asset.replace(/USDT$/, "");
  const ref = alarm.kind === "price" ? alarm.price : alarm.zone_low, d = digitsFor(ref);
  const m = (v) => money(v, alarm.lang, d), src = `(${hit.source})`;
  const zone = alarm.kind === "zone" ? `${m(alarm.zone_low).replace(/ \$$|^\$/, "")}–${m(alarm.zone_high)}` : "";
  const zoneName = alarm.zone_type === "resistance" ? (en ? "resistance zone" : "direnç bölgesi") : (en ? "support zone" : "destek bölgesi");
  let body;
  if (alarm.kind === "price") {
    body = en
      ? `${base} ${alarm.cond === "above" ? "rose to or above" : "fell to or below"} ${m(alarm.price)} · now ${m(hit.price)} ${src}`
      : `${base} fiyatı ${m(alarm.price)} seviyesinin ${alarm.cond === "above" ? "üstüne çıktı" : "altına indi"} · şu an ${m(hit.price)} ${src}`;
  } else if (alarm.cond === "enter") {
    body = en
      ? `${base} entered the ${zoneName} you set (${zone}) · now ${m(hit.price)} ${src}`
      : `${base} fiyatı kurduğun ${zoneName}ne girdi (${zone}) · şu an ${m(hit.price)} ${src}`;
  } else {
    const tf = alarm.tf.toUpperCase(), side = alarm.zone_type === "support";
    body = en
      ? `${base} ${tf} candle closed ${side ? "below" : "above"} the ${zoneName} you set (${zone}) · close ${m(hit.price)} ${src}`
      : `${base} ${tf} mumu kurduğun ${zoneName}nin ${side ? "altında" : "üstünde"} kapandı (${zone}) · kapanış ${m(hit.price)} ${src}`;
  }
  const url = `/bulletin?asset=${encodeURIComponent(alarm.asset)}${alarm.tf ? "&tf=" + alarm.tf : ""}`;
  return { title: en ? `${base} alarm` : `${base} alarmı`, body, url, tag: "alarm-" + alarm.id };
}

// ---- one run (the Worker's minute) ----
// db: a D1 database; vapid: { publicKey, privateKey, subject }; push: sendPush. Returns a short summary.
export async function runAlarms(db, vapid, push, nowMs = Date.now()) {
  const alarms = (await db.prepare("SELECT * FROM alarms WHERE active = 1").all()).results || [];
  if (!alarms.length) return { alarms: 0, fired: 0 };
  const assets = [...new Set(alarms.map((a) => a.asset))];
  const prices = await fetchPrices(assets);
  const candleKeys = [...new Set(alarms.filter((a) => a.cond === "break").map((a) => a.asset + ":" + a.tf))];
  const candles = {};
  await Promise.all(candleKeys.map(async (k) => { const [a, tf] = k.split(":"); try { candles[k] = await lastClosedCandle(a, tf); } catch (_) { candles[k] = null; } }));
  let fired = 0, sent = 0, gone = 0;
  for (const alarm of alarms) {
    const hit = check(alarm, prices[alarm.asset], candles[alarm.asset + ":" + alarm.tf]);
    if (!hit) continue;
    // Switch it off first; when two runs overlap only the one that switched it off sends.
    const res = await db.prepare("UPDATE alarms SET active = 0, triggered_at = ?, triggered_price = ? WHERE id = ? AND active = 1")
      .bind(new Date(nowMs).toISOString(), hit.price, alarm.id).run();
    if (!res.meta || res.meta.changes !== 1) continue;
    fired++;
    const note = message(alarm, hit);
    const subs = (await db.prepare("SELECT * FROM push_subs WHERE user_id = ?").bind(alarm.user_id).all()).results || [];
    for (const s of subs) {
      try {
        const r = await push({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, note, vapid);
        if (r.ok) { sent++; await db.prepare("UPDATE push_subs SET last_ok_at = ? WHERE id = ?").bind(new Date(nowMs).toISOString(), s.id).run(); }
        else if (r.gone) { gone++; await db.prepare("DELETE FROM push_subs WHERE id = ?").bind(s.id).run(); }
      } catch (_) { /* one device failing must not stop the others */ }
    }
  }
  return { alarms: alarms.length, fired, sent, gone };
}
