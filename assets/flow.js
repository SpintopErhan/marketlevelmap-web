/* Live order flow (README "Live order flow"). Members-only page (flow.html) that reads Binance, OKX and Coinbase spot
   straight from the exchanges' public WebSockets in the visitor's browser. Nothing is stored or sent to our server:
   the session starts when the page opens and ends when it closes (no history, no recording).
   Panels: order book (walls, analysis zones, book balance), CVD with price and a divergence flag, depth (±10/25 bp
   ratios) and Time & Sales (big prints). Venues are combined by default; one venue can be picked instead. */
(function () {
  "use strict";
  var W = {
    en: {
      title: "Live flow", sub: "Spot · members only", venueAll: "Combined: Binance · OKX · Coinbase", live: "Live", connecting: "Connecting…", paused: "Paused",
      book: "Order book", grouping: "Grouping", spread: "Spread", balance: "Book balance (±{bp} bp)", bids: "Bids {p}", asks: "Asks {p}",
      bookNote: "Stripe: price levels inside an analysis zone. Bold row: a large resting order (wall).",
      cvdLegend: "CVD (session)", priceLegend: "Price", divUp: "Last 1 min: price ↑ {p}, CVD ↓ (divergence)", divDown: "Last 1 min: price ↓ {p}, CVD ↑ (divergence)",
      divNone: "Last 1 min: price and CVD agree", divWait: "The divergence check starts after the first minute",
      cvdSession: "CVD (session)", bs5: "Last 5 min buy/sell", bs15: "Last 15 min buy/sell",
      depth: "Depth", depthSub: "±{r} · cumulative", r10: "±10 bp bid/ask", r25: "±25 bp bid/ask",
      tape: "Time & Sales", all: "All", buys: "Buys {p}", sells: "Sells {p}", lastN: "last {n} trades",
      price: "Price", inside: "Inside the {type} zone", support: "support", resistance: "resistance", nearestRes: "Nearest resistance", nearestSup: "Nearest support",
      zonesFrom: "Zones: Critical Zones · analysed {date}", noZones: "No Critical Zones analysis for this asset yet.", zoneTf: "Zone timeframe",
      gateGuest: "Live flow is for members. Sign in with Google to apply for membership.", signIn: "Sign in with Google",
      gateMember: "Live flow is for members. It opens once your membership is approved.", profile: "Your profile",
      notCrypto: "Live flow is available for crypto assets only.", waiting: "Waiting for data…",
      status: { live: "live", connecting: "connecting", unavailable: "not listed" },
      zf: "Flow in the zone", zfSince: "{type} {range} · {min} min since entry", zfLast: "Last zone: {type} {range} · left {min} min ago",
      zfNone: "The price is not inside a zone. The count starts when it enters one.", zfNoZones: "No zones loaded.",
      zfBuy: "Buys in the zone", zfSell: "Sells in the zone", zfCvd: "CVD in the zone", zfRestBid: "Resting bids in the zone", zfRestAsk: "Resting asks in the zone",
      zfBook: "where the books reach", zfWait: "Reading after 30 s in the zone", zfBal: "Buying and selling are balanced",
      zfUpUp: "Buying is lifting the price", zfUpFlat: "Buying is being absorbed: the price is not rising", zfDnDn: "Selling is pushing the price down", zfDnFlat: "Selling is being absorbed: the price is not falling",
      zfMove: "price {p}, CVD {c}", zfNote: "The count resets when the price leaves the zone and starts again in the next one.",
      vp: "Session volume profile", vpSub: "since the page opened", vpPoc: "Busiest level (POC) {p}", vpZone: "stripe: levels inside an analysis zone",
      prem: "Coinbase premium", premTitle: "Coinbase USD mid against Binance USDT mid (OKX when Binance is not reachable)",
      note: "Live data from Binance, OKX and Coinbase spot, read directly by your browser. Nothing is recorded; the flow stops when you leave the page. In the combined book, Coinbase (USD) prices are aligned to USDT. For information only, not a signal."
    },
    tr: {
      title: "Canlı akış", sub: "Spot · üyelere özel", venueAll: "Birleşik: Binance · OKX · Coinbase", live: "Canlı", connecting: "Bağlanıyor…", paused: "Duraklatıldı",
      book: "Emir defteri", grouping: "Gruplama", spread: "Spread", balance: "Defter dengesi (±{bp} bp)", bids: "Alış {p}", asks: "Satış {p}",
      bookNote: "Şerit: analiz bölgesinin içine düşen fiyat seviyeleri. Kalın satır: büyük bekleyen emir (duvar).",
      cvdLegend: "CVD (oturum)", priceLegend: "Fiyat", divUp: "Son 1 dk: fiyat ↑ {p}, CVD ↓ (uyumsuzluk)", divDown: "Son 1 dk: fiyat ↓ {p}, CVD ↑ (uyumsuzluk)",
      divNone: "Son 1 dk: fiyat ve CVD aynı yönde", divWait: "Uyumsuzluk kontrolü ilk dakikadan sonra başlar",
      cvdSession: "CVD (oturum)", bs5: "Son 5 dk alış/satış", bs15: "Son 15 dk alış/satış",
      depth: "Derinlik", depthSub: "±{r} · kümülatif", r10: "±10 bp alış/satış", r25: "±25 bp alış/satış",
      tape: "Time & Sales", all: "Tümü", buys: "Alış {p}", sells: "Satış {p}", lastN: "son {n} işlem",
      price: "Fiyat", inside: "{type} bölgesinin içinde", support: "Destek", resistance: "Direnç", nearestRes: "En yakın direnç", nearestSup: "En yakın destek",
      zonesFrom: "Bölgeler: Kritik Bölgeler · analiz {date}", noZones: "Bu varlık için henüz Kritik Bölgeler analizi yok.", zoneTf: "Bölge zaman dilimi",
      gateGuest: "Canlı akış üyelere özeldir. Üyelik başvurusu için Google ile giriş yapın.", signIn: "Google ile giriş yap",
      gateMember: "Canlı akış üyelere özeldir. Üyeliğiniz onaylandığında açılır.", profile: "Profiliniz",
      notCrypto: "Canlı akış yalnızca kripto varlıklar için kullanılabilir.", waiting: "Veri bekleniyor…",
      status: { live: "canlı", connecting: "bağlanıyor", unavailable: "listelenmiyor" },
      zf: "Bölgede akış", zfSince: "{type} {range} · girişten beri {min} dk", zfLast: "Son bölge: {type} {range} · {min} dk önce çıktı",
      zfNone: "Fiyat şu an bir bölgenin içinde değil. Bir bölgeye girdiğinde sayaç başlar.", zfNoZones: "Bölge yüklenmedi.",
      zfBuy: "Bölge içi alış", zfSell: "Bölge içi satış", zfCvd: "Bölge içi CVD", zfRestBid: "Bölgedeki bekleyen alış", zfRestAsk: "Bölgedeki bekleyen satış",
      zfBook: "defterin ulaştığı kısım", zfWait: "Okuma bölgede 30 sn sonra başlar", zfBal: "Alış ve satış dengede",
      zfUpUp: "Alışlar fiyatı yukarı taşıyor", zfUpFlat: "Alışlar karşılanıyor: fiyat yükselmiyor", zfDnDn: "Satışlar fiyatı aşağı itiyor", zfDnFlat: "Satışlar karşılanıyor: fiyat düşmüyor",
      zfMove: "fiyat {p}, CVD {c}", zfNote: "Fiyat bölgeden çıkınca sayaç sıfırlanır; sonraki bölgede yeniden başlar.",
      vp: "Oturum hacim profili", vpSub: "sayfa açıldığından beri", vpPoc: "En yoğun seviye (POC) {p}", vpZone: "şerit: analiz bölgesinin içindeki seviyeler",
      prem: "Coinbase primi", premTitle: "Coinbase USD orta fiyatı ile Binance USDT orta fiyatı arasındaki fark (Binance'e ulaşılamazsa OKX)",
      note: "Canlı veri: Binance, OKX ve Coinbase spot; doğrudan tarayıcınız okur. Hiçbir veri kaydedilmez; sayfadan çıkınca akış durur. Birleşik defterde Coinbase (USD) fiyatları USDT'ye hizalanır. Bilgi amaçlıdır, sinyal değildir."
    }
  };
  function lang() { var s = document.getElementById("lang"); return s && s.value === "tr" ? "tr" : "en"; }
  function w() { return W[lang()]; }
  function fill(t, o) { return String(t).replace(/\{(\w+)\}/g, function (_, k) { return o[k] == null ? "" : o[k]; }); }
  function $(id) { return document.getElementById(id); }
  function locale() { return window.MarketUI ? MarketUI.locale() : "en-US"; }
  function nf(v, d) { return Number(v).toLocaleString(locale(), { minimumFractionDigits: d, maximumFractionDigits: d }); }
  function pctText(r, d) { var s = nf(Math.abs(r) * 100, d == null ? 2 : d); return lang() === "tr" ? "%" + s : s + "%"; }

  var ORDER = ["binance", "okx", "coinbase"], NAME = { binance: "Binance", okx: "OKX", coinbase: "Coinbase" }, SHORT = { binance: "BIN", okx: "OKX", coinbase: "CB" };
  var KEEP_SECS = 7200, KEEP_TRADES = 1500, ROWS = 12, TAPE_ROWS = 40;
  var dirty = true;

  // ─── Venues ──────────────────────────────────────────────────────────────
  function Venue(id, base) { this.id = id; this.base = base; this.bids = new Map(); this.asks = new Map(); this.status = "connecting"; this.ws = null; this.timers = []; this.retry = 0; this.stopped = false; this.ready = false; }
  Venue.prototype.setStatus = function (s) { if (this.status !== s) { this.status = s; dirty = true; } };
  Venue.prototype.later = function (fn, ms) { var t = setTimeout(fn, ms); this.timers.push(t); };
  Venue.prototype.set = function (side, p, q) { p = +p; q = +q; if (!(p > 0)) return; var m = side === "b" ? this.bids : this.asks; if (q > 0) m.set(p, q); else m.delete(p); this.top = null; };
  Venue.prototype.clear = function () { this.bids.clear(); this.asks.clear(); this.ready = false; this.top = null; };
  Venue.prototype.best = function () {
    if (this.top) return this.top;
    var bb = 0, ba = Infinity, lb = Infinity, ha = 0;
    this.bids.forEach(function (q, p) { if (p > bb) bb = p; if (p < lb) lb = p; });
    this.asks.forEach(function (q, p) { if (p < ba) ba = p; if (p > ha) ha = p; });
    this.top = bb > 0 && ba < Infinity && ba > bb ? { bid: bb, ask: ba, mid: (bb + ba) / 2, low: lb, high: ha } : null;
    return this.top;
  };
  Venue.prototype.open = function (url) {
    var self = this, ws;
    try { ws = new WebSocket(url); } catch (e) { this.retryLater(); return; }
    this.ws = ws;
    ws.onopen = function () { if (self.ws === ws) { self.retry = 0; self.onopen(ws); } };
    ws.onmessage = function (e) { if (self.ws !== ws) return; var m; try { m = JSON.parse(e.data); } catch (_) { return; } self.onmsg(m); };
    ws.onclose = function () { if (self.ws !== ws) return; self.ws = null; clearInterval(self.ping); self.retryLater(); };
    ws.onerror = function () {};
  };
  Venue.prototype.retryLater = function () {
    if (this.stopped || this.status === "unavailable") return;
    this.clear(); this.setStatus("connecting");
    var self = this; this.later(function () { self.connect(); }, Math.min(30000, 1000 * Math.pow(2, this.retry++)));
  };
  Venue.prototype.stop = function () {
    this.stopped = true; this.timers.forEach(clearTimeout); this.timers = []; clearInterval(this.ping);
    var ws = this.ws; this.ws = null; if (ws) try { ws.close(); } catch (e) {}
  };
  Venue.prototype.unavailable = function () { this.clear(); this.setStatus("unavailable"); this.stop(); };

  function getJson(urls) {
    var i = 0;
    function next() {
      if (i >= urls.length) return Promise.resolve({});
      var u = urls[i++];
      return fetch(u, { cache: "no-store" }).then(function (r) {
        if (r.status === 400) return { bad: true };
        return r.ok ? r.json().then(function (d) { return { data: d }; }) : next();
      }).catch(next);
    }
    return next();
  }

  // Binance: diff-depth stream kept in sync with a REST snapshot (the documented "local order book" procedure).
  function Binance(base) { Venue.call(this, "binance", base); this.sym = base + "USDT"; this.snapId = 0; }
  Binance.prototype = Object.create(Venue.prototype);
  Binance.prototype.connect = function () { var s = this.sym.toLowerCase(); this.buf = []; this.open("wss://stream.binance.com:9443/stream?streams=" + s + "@depth@100ms/" + s + "@aggTrade"); };
  Binance.prototype.onopen = function () { this.snapshot(); };
  Binance.prototype.snapshot = function () {
    var self = this, ws = this.ws, id = ++this.snapId;
    this.ready = false; this.buf = []; this.prevU = null;
    getJson(["https://api.binance.com/api/v3/depth?symbol=", "https://data-api.binance.vision/api/v3/depth?symbol="].map(function (u) { return u + self.sym + "&limit=5000"; })).then(function (r) {
      if (self.ws !== ws || id !== self.snapId) return;
      if (r.bad) { self.unavailable(); return; }
      if (!r.data || !r.data.bids) { try { ws.close(); } catch (e) {} return; }
      self.bids.clear(); self.asks.clear(); self.top = null;
      r.data.bids.forEach(function (l) { self.set("b", l[0], l[1]); });
      r.data.asks.forEach(function (l) { self.set("a", l[0], l[1]); });
      self.lastId = r.data.lastUpdateId; self.ready = true; self.setStatus("live");
      var buf = self.buf; self.buf = []; buf.forEach(function (d) { if (self.ready) self.depth(d); });
      dirty = true;
    });
  };
  Binance.prototype.onmsg = function (m) {
    var d = m && m.data; if (!d) return;
    if (d.e === "aggTrade") trade(this, +d.p, +d.q, !d.m);
    else if (d.e === "depthUpdate") { if (!this.ready) { this.buf.push(d); if (this.buf.length > 3000) this.buf.shift(); } else this.depth(d); }
  };
  Binance.prototype.depth = function (d) {
    if (d.u <= this.lastId) return;
    if (this.prevU == null ? d.U > this.lastId + 1 : d.U !== this.prevU + 1) { this.resync(); return; }
    var self = this;
    d.b.forEach(function (l) { self.set("b", l[0], l[1]); });
    d.a.forEach(function (l) { self.set("a", l[0], l[1]); });
    this.prevU = d.u; dirty = true;
  };
  Binance.prototype.resync = function () {
    var now = Date.now();
    if (this.lastResync && now - this.lastResync < 5000) { var ws = this.ws; if (ws) try { ws.close(); } catch (e) {} return; }
    this.lastResync = now; this.snapshot();
  };

  // OKX: "books" (400 levels, snapshot then updates) and "trades".
  function Okx(base) { Venue.call(this, "okx", base); this.inst = base + "-USDT"; }
  Okx.prototype = Object.create(Venue.prototype);
  Okx.prototype.connect = function () { this.open("wss://ws.okx.com:8443/ws/v5/public"); };
  Okx.prototype.onopen = function (ws) {
    ws.send(JSON.stringify({ op: "subscribe", args: [{ channel: "books", instId: this.inst }, { channel: "trades", instId: this.inst }] }));
    clearInterval(this.ping); this.ping = setInterval(function () { try { ws.send("ping"); } catch (e) {} }, 20000);
  };
  Okx.prototype.onmsg = function (m) {
    var self = this;
    if (m.event === "error") { if (!this.ready) this.unavailable(); return; }
    if (!m.arg || !Array.isArray(m.data)) return;
    if (m.arg.channel === "books") {
      if (m.action === "snapshot") { this.bids.clear(); this.asks.clear(); this.top = null; }
      m.data.forEach(function (d) { (d.bids || []).forEach(function (l) { self.set("b", l[0], l[1]); }); (d.asks || []).forEach(function (l) { self.set("a", l[0], l[1]); }); });
      this.ready = true; this.setStatus("live"); dirty = true;
    } else if (m.arg.channel === "trades") {
      m.data.forEach(function (t) { trade(self, +t.px, +t.sz, t.side === "buy"); });
    }
  };

  // Coinbase Advanced Trade: "level2" (full book), "market_trades", "heartbeats" (keeps quiet products open).
  // The trade side is checked against Coinbase's own book (at or above the ask = buyer took it), so the CVD sign
  // does not depend on how the feed labels the side.
  function Coinbase(base) { Venue.call(this, "coinbase", base); this.pid = base + "-USD"; this.agree = 0; this.seen = 0; }
  Coinbase.prototype = Object.create(Venue.prototype);
  Coinbase.prototype.connect = function () { this.open("wss://advanced-trade-ws.coinbase.com"); };
  Coinbase.prototype.onopen = function (ws) {
    var pid = this.pid;
    ["level2", "market_trades", "heartbeats"].forEach(function (ch) { ws.send(JSON.stringify({ type: "subscribe", product_ids: [pid], channel: ch })); });
  };
  Coinbase.prototype.onmsg = function (m) {
    var self = this;
    if (m.type === "error") { if (!this.ready) this.unavailable(); return; }
    if (m.channel === "l2_data") {
      (m.events || []).forEach(function (ev) {
        if (ev.type === "snapshot") { self.bids.clear(); self.asks.clear(); self.top = null; }
        (ev.updates || []).forEach(function (u) { self.set(u.side === "bid" ? "b" : "a", u.price_level, u.new_quantity); });
      });
      this.ready = true; this.setStatus("live"); dirty = true;
    } else if (m.channel === "market_trades") {
      (m.events || []).forEach(function (ev) {
        if (ev.type !== "update") return; // the snapshot is past trades: this page has no history
        var top = self.best();
        (ev.trades || []).slice().sort(function (a, b) { return Date.parse(a.time) - Date.parse(b.time); }).forEach(function (t) {
          var p = +t.price, field = String(t.side).toUpperCase() === "BUY", byBook = top ? (p >= top.ask ? true : p <= top.bid ? false : null) : null;
          if (byBook !== null) { self.seen++; if (byBook === field) self.agree++; }
          var flip = self.seen >= 20 && self.agree / self.seen < 0.5;
          trade(self, p, +t.size, byBook !== null ? byBook : flip ? !field : field);
        });
      });
    }
  };

  // ─── Session data ────────────────────────────────────────────────────────
  var venues = {}, trades = [], secs = [], mode = "all", base = "", started = 0, profile = {}, zs = null;
  function trade(v, p, q, buy) {
    if (!(p > 0 && q > 0)) return;
    var now = Date.now();
    trades.push({ v: v.id, p: p, q: q, buy: buy, t: now });
    if (trades.length > KEEP_TRADES) trades.splice(0, trades.length - KEEP_TRADES);
    var s = Math.floor(now / 1000), rec = secs[secs.length - 1];
    if (!rec || rec.t !== s) { rec = { t: s, v: {} }; secs.push(rec); if (secs.length > KEEP_SECS) secs.shift(); }
    var r = rec.v[v.id] || (rec.v[v.id] = { bv: 0, sv: 0, p: 0 });
    if (buy) r.bv += q; else r.sv += q;
    r.p = p;
    // Volume profile: per venue, at a fine price step fixed by the venue's first trade (0.1 bp, rounded 1-2-5).
    var vp = profile[v.id] || (profile[v.id] = { fine: niceStep(p * 0.00001), m: new Map() }), key = Math.round(p / vp.fine) * vp.fine;
    vp.m.set(key, (vp.m.get(key) || 0) + q);
    if (zs && zs.active) { var zv = zs.v[v.id] || (zs.v[v.id] = { bv: 0, sv: 0 }); if (buy) zv.bv += q; else zv.sv += q; }
    dirty = true;
  }
  function selected() { return (mode === "all" ? ORDER : [mode]).filter(function (id) { return venues[id] && venues[id].status !== "unavailable"; }); }
  function bookVenues() { return selected().filter(function (id) { return venues[id].ready && venues[id].best(); }).map(function (id) { return venues[id]; }); }

  // ─── Page state ──────────────────────────────────────────────────────────
  var zones = [], step = 0, stepIdx = 1, steps = [], cvdInt = 5, tapeMin = 0, digits = null, ladder = null, tapeRows = null;

  function niceStep(x) { var e = Math.pow(10, Math.floor(Math.log10(x))), f = x / e; return (f < 1.5 ? 1 : f < 3.5 ? 2 : f < 7.5 ? 5 : 10) * e; }
  function nextStep(s) { var e = Math.pow(10, Math.floor(Math.log10(s) + 1e-9)), f = Math.round(s / e); return (f === 1 ? 2 : f === 2 ? 5 : 10) * e; }
  function decimals(x) { return Math.max(0, -Math.floor(Math.log10(x) + 1e-9)); }
  function stepDigits() { return Math.max(digits || 0, decimals(step)); }
  function fmtPrice(p, d) { return nf(p, d == null ? (digits == null ? 2 : digits) : d); }
  function fmtSize(q) { var a = Math.abs(q); return nf(q, a >= 1000 ? 0 : a >= 100 ? 1 : a >= 1 ? 3 : 4); }
  function compact(v) { return Number(v).toLocaleString(locale(), { notation: "compact", maximumFractionDigits: v >= 1e6 ? 2 : 0 }); }
  function cssVar(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || "#888"; }

  function setupSteps(mid) {
    var s = niceStep(mid * 0.00005); steps = [s];
    for (var i = 0; i < 3; i++) steps.push(nextStep(steps[steps.length - 1]));
    step = steps[stepIdx];
    var sel = $("fl-group"); sel.textContent = "";
    steps.forEach(function (v, i) { var o = document.createElement("option"); o.value = i; o.textContent = nf(v, decimals(v)); if (i === stepIdx) o.selected = true; sel.appendChild(o); });
  }

  // Combined book: each venue's levels are scaled by primaryMid/venueMid (so USD and USDT books line up), then bucketed.
  function bookState() {
    var vs = bookVenues(); if (!vs.length) return null;
    var pm = vs[0].best().mid, out = { mid: pm, top: vs[0].best(), venues: [] };
    vs.forEach(function (v) { var b = v.best(), k = pm / b.mid; out.venues.push({ v: v, k: k, cover: Math.min((pm - b.low * k) / pm, (b.high * k - pm) / pm) }); });
    return out;
  }
  function sideSums(bs, x) {
    var b = 0, a = 0, n = 0;
    bs.venues.forEach(function (o) {
      if (o.cover < x * 0.98) return; n++;
      var lo = bs.mid * (1 - x), hi = bs.mid * (1 + x);
      o.v.bids.forEach(function (q, p) { p *= o.k; if (p >= lo && p <= bs.mid) b += q; });
      o.v.asks.forEach(function (q, p) { p *= o.k; if (p <= hi && p >= bs.mid) a += q; });
    });
    return n ? { b: b, a: a } : null;
  }

  function zoneAt(lo, hi) { for (var i = 0; i < zones.length; i++) { var z = zones[i]; if (hi >= z.low && lo <= z.high) return z.type; } return ""; }

  function renderBook(bs) {
    var t = w();
    if (!bs) { ladder.forEach(function (r) { r.el.hidden = true; }); $("fl-mid").hidden = true; $("fl-book-wait").hidden = false; return null; }
    $("fl-book-wait").hidden = true; $("fl-mid").hidden = false;
    if (!steps.length) setupSteps(bs.mid);
    var d = stepDigits(), bidTop = Math.floor(bs.mid / step) * step, askLow = Math.ceil(bs.mid / step) * step;
    if (askLow === bidTop) askLow += step;
    var bidB = new Array(ROWS).fill(0), askB = new Array(ROWS).fill(0);
    bs.venues.forEach(function (o) {
      o.v.bids.forEach(function (q, p) { p *= o.k; if (p > bs.mid) return; var i = p >= bidTop ? 0 : Math.ceil((bidTop - p) / step - 1e-9); if (i >= 0 && i < ROWS) bidB[i] += q; });
      o.v.asks.forEach(function (q, p) { p *= o.k; if (p < bs.mid) return; var i = p <= askLow ? 0 : Math.ceil((p - askLow) / step - 1e-9); if (i >= 0 && i < ROWS) askB[i] += q; });
    });
    var all = bidB.concat(askB), nz = all.filter(function (x) { return x > 0; }).sort(function (a, b) { return a - b; });
    var med = nz.length ? nz[Math.floor(nz.length / 2)] : 0, max = nz.length ? nz[nz.length - 1] : 1;
    function paint(row, price, q, lo, hi, side) {
      row.el.hidden = false;
      var wall = q > 0 && med > 0 && q >= med * 3 && q >= max * 0.5, z = zoneAt(lo, hi);
      row.el.className = "ob-row " + side + (wall ? " wall" : "") + (z ? " z-" + z : "");
      row.bar.style.width = (q / max * 100).toFixed(1) + "%";
      row.p.textContent = fmtPrice(price, d); row.q.textContent = q > 0 ? fmtSize(q) : "";
      row.n.textContent = q > 0 ? compact(price * q) : "";
    }
    for (var i = 0; i < ROWS; i++) {
      var ap = askLow + (ROWS - 1 - i) * step; paint(ladder[i], ap, askB[ROWS - 1 - i], ap - step, ap, "ask");
      var bp = bidTop - i * step; paint(ladder[ROWS + i], bp, bidB[i], bp, bp + step, "bid");
    }
    var sp = bs.top.ask - bs.top.bid;
    $("fl-spread").textContent = fmtPrice(sp, Math.min(8, Math.max(digits || 0, decimals(sp)))) + " · " + nf(sp / bs.mid * 1e4, 2) + " bp";
    $("fl-midp").textContent = fmtPrice(bs.mid, digits);
    // Book balance within ±50 bp (narrower when the venues' books do not reach that far).
    var cover = Math.max.apply(null, bs.venues.map(function (o) { return o.cover; })), x = Math.min(0.005, Math.floor(cover * 1e4) / 1e4);
    var s = x > 0 ? sideSums(bs, x) : null;
    if (s && s.a + s.b > 0) {
      var bShare = s.b / (s.a + s.b);
      $("fl-bal-b").style.flex = String(bShare); $("fl-bal-a").style.flex = String(1 - bShare);
      $("fl-bal-bt").textContent = fill(t.bids, { p: pctText(bShare, 0) }); $("fl-bal-at").textContent = fill(t.asks, { p: pctText(1 - bShare, 0) });
      $("fl-bal-l").textContent = fill(t.balance, { bp: Math.round(x * 1e4) });
    }
    return bs;
  }

  function sizeCanvas(c) {
    var r = c.getBoundingClientRect(), k = window.devicePixelRatio || 1, wpx = Math.max(1, Math.round(r.width * k)), hpx = Math.max(1, Math.round(r.height * k));
    if (c.width !== wpx || c.height !== hpx) { c.width = wpx; c.height = hpx; }
    var g = c.getContext("2d"); g.setTransform(k, 0, 0, k, 0, 0); g.clearRect(0, 0, r.width, r.height);
    return { g: g, w: r.width, h: r.height };
  }

  function renderDepth(bs) {
    var cv = sizeCanvas($("fl-depth")), g = cv.g, up = cssVar("--up"), down = cssVar("--down"), muted = cssVar("--muted");
    if (!bs) return;
    var R = Math.min(0.01, Math.min.apply(null, bs.venues.map(function (o) { return o.cover; })));
    if (!(R > 0)) return;
    var N = 60, bc = new Array(N).fill(0), ac = new Array(N).fill(0);
    bs.venues.forEach(function (o) {
      o.v.bids.forEach(function (q, p) { p *= o.k; var dd = (bs.mid - p) / bs.mid; if (dd >= 0 && dd <= R) bc[Math.min(N - 1, Math.floor(dd / R * N))] += q; });
      o.v.asks.forEach(function (q, p) { p *= o.k; var dd = (p - bs.mid) / bs.mid; if (dd >= 0 && dd <= R) ac[Math.min(N - 1, Math.floor(dd / R * N))] += q; });
    });
    for (var i = 1; i < N; i++) { bc[i] += bc[i - 1]; ac[i] += ac[i - 1]; }
    var mx = Math.max(bc[N - 1], ac[N - 1]) || 1, cx = cv.w / 2, top = 8, hh = cv.h - top - 4;
    // Analysis zones inside the range, as faint bands.
    zones.forEach(function (z) {
      var a = (z.low - bs.mid) / bs.mid, b = (z.high - bs.mid) / bs.mid; a = Math.max(a, -R); b = Math.min(b, R); if (b <= a) return;
      g.globalAlpha = 0.09; g.fillStyle = z.type === "support" ? up : down; g.fillRect(cx + a / R * cx, top, (b - a) / R * cx, hh); g.globalAlpha = 1;
    });
    function area(arr, dir, color) {
      g.beginPath(); g.moveTo(cx, top + hh);
      for (var i = 0; i < N; i++) g.lineTo(cx + dir * (i + 1) / N * cx, top + hh - arr[i] / mx * hh);
      g.lineTo(cx + dir * cx, top + hh); g.closePath();
      g.globalAlpha = 0.18; g.fillStyle = color; g.fill(); g.globalAlpha = 1; g.strokeStyle = color; g.lineWidth = 1.5; g.stroke();
    }
    area(bc, -1, up); area(ac, 1, down);
    g.setLineDash([3, 4]); g.strokeStyle = muted; g.beginPath(); g.moveTo(cx, 0); g.lineTo(cx, cv.h); g.stroke(); g.setLineDash([]);
    $("fl-depth-sub").textContent = fill(w().depthSub, { r: R >= 0.001 ? pctText(R, R >= 0.01 ? 0 : 1) : Math.round(R * 1e4) + " bp" });
    [[0.001, "fl-r10"], [0.0025, "fl-r25"]].forEach(function (x) { var s = sideSums(bs, x[0]); $(x[1]).textContent = s && s.a > 0 ? nf(s.b / s.a, 2) + "×" : "—"; });
  }

  // CVD and price per bar (cvdInt seconds), from the 1-second records of the selected venues.
  function series() {
    var sel = selected(), primary = null, cvd = 0, out = [], cur = null, lastP = 0;
    for (var i = 0; i < secs.length && !primary; i++) for (var j = 0; j < sel.length; j++) if (secs[i].v[sel[j]]) { primary = sel[j]; break; }
    secs.forEach(function (rec) {
      var key = Math.floor(rec.t / cvdInt);
      sel.forEach(function (id) { var r = rec.v[id]; if (r) cvd += r.bv - r.sv; });
      if (primary && rec.v[primary]) lastP = rec.v[primary].p;
      if (!cur || cur.k !== key) { cur = { k: key, cvd: cvd, p: lastP }; out.push(cur); } else { cur.cvd = cvd; cur.p = lastP; }
    });
    return { bars: out.slice(-120), cvd: cvd, primary: primary };
  }
  function windowStats(sec) {
    var sel = selected(), now = Math.floor(Date.now() / 1000), bv = 0, sv = 0;
    for (var i = secs.length - 1; i >= 0 && secs[i].t > now - sec; i--) sel.forEach(function (id) { var r = secs[i].v[id]; if (r) { bv += r.bv; sv += r.sv; } });
    return { bv: bv, sv: sv };
  }
  function renderCvd() {
    var t = w(), s = series(), cv = sizeCanvas($("fl-cvd")), g = cv.g, accent = cssVar("--accent"), fg = cssVar("--fg"), line = cssVar("--line");
    g.strokeStyle = line; g.lineWidth = 1; for (var k = 1; k < 4; k++) { var y = Math.round(cv.h * k / 4) + 0.5; g.beginPath(); g.moveTo(0, y); g.lineTo(cv.w, y); g.stroke(); }
    var bars = s.bars.filter(function (b) { return b.p > 0; });
    function plot(get, color, dash, width) {
      if (bars.length < 2) return;
      var vals = bars.map(get), mn = Math.min.apply(null, vals), mx = Math.max.apply(null, vals), span = mx - mn || 1;
      g.beginPath(); g.setLineDash(dash); g.strokeStyle = color; g.lineWidth = width;
      vals.forEach(function (v, i) { var x = i / Math.max(vals.length - 1, 1) * cv.w, y = 8 + (1 - (v - mn) / span) * (cv.h - 16); if (i) g.lineTo(x, y); else g.moveTo(x, y); });
      g.stroke(); g.setLineDash([]);
    }
    if (bars.length < 2) { g.fillStyle = cssVar("--muted"); g.font = "12px Inter, system-ui, sans-serif"; g.textAlign = "center"; g.fillText(t.waiting, cv.w / 2, cv.h / 2); }
    plot(function (b) { return b.p; }, fg, [4, 3], 1.2);
    plot(function (b) { return b.cvd; }, accent, [], 2);
    var cvdEl = $("fl-k-cvd"); cvdEl.textContent = (s.cvd < 0 ? "−" : s.cvd > 0 ? "+" : "") + fmtSize(Math.abs(s.cvd)) + " " + base; cvdEl.className = "num " + (s.cvd > 0 ? "up" : s.cvd < 0 ? "down" : "");
    [[300, "fl-k-5"], [900, "fl-k-15"]].forEach(function (x) { var st = windowStats(x[0]), tot = st.bv + st.sv; $(x[1]).textContent = tot > 0 ? pctText(st.bv / tot, 0) + " / " + pctText(st.sv / tot, 0) : "—"; });
    // Divergence: over the last 60 s the price moved at least 3 bp one way while the CVD moved the other way by a real share of the volume.
    var flag = $("fl-div"), now = Math.floor(Date.now() / 1000), sel = selected();
    if (!s.primary || Date.now() - started < 60000) { flag.className = "flag muted"; flag.textContent = t.divWait; return; }
    var p0 = 0, p1 = 0, dc = 0, vol = 0;
    secs.forEach(function (rec) {
      var r = rec.v[s.primary];
      if (r && rec.t <= now - 60) p0 = r.p;
      if (r) p1 = r.p;
      if (rec.t > now - 60) sel.forEach(function (id) { var x = rec.v[id]; if (x) { dc += x.bv - x.sv; vol += x.bv + x.sv; } });
    });
    var dp = p0 > 0 ? p1 / p0 - 1 : 0;
    if (Math.abs(dp) >= 0.0003 && vol > 0 && Math.abs(dc) >= vol * 0.1 && (dp > 0) !== (dc > 0)) { flag.className = "flag on"; flag.textContent = "⚠ " + fill(dp > 0 ? t.divUp : t.divDown, { p: pctText(dp) }); }
    else { flag.className = "flag muted"; flag.textContent = t.divNone; }
  }

  function renderTape() {
    var t = w(), sel = selected(), avg = {}, n = {};
    var list = trades.filter(function (x) { return sel.indexOf(x.v) > -1; });
    list.slice(-500).forEach(function (x) { avg[x.v] = (avg[x.v] || 0) + x.q; n[x.v] = (n[x.v] || 0) + 1; });
    Object.keys(avg).forEach(function (k) { avg[k] /= n[k]; });
    var recent = list.slice(-200), bv = 0, sv = 0;
    recent.forEach(function (x) { if (x.buy) bv += x.q; else sv += x.q; });
    var tot = bv + sv;
    $("fl-split-b").style.flex = String(tot ? bv / tot : 0.5); $("fl-split-s").style.flex = String(tot ? sv / tot : 0.5);
    $("fl-split-bt").textContent = fill(t.buys, { p: tot ? pctText(bv / tot, 0) : "—" }); $("fl-split-st").textContent = fill(t.sells, { p: tot ? pctText(sv / tot, 0) : "—" });
    $("fl-split-n").textContent = fill(t.lastN, { n: recent.length });
    var shown = [];
    for (var i = list.length - 1; i >= 0 && shown.length < TAPE_ROWS; i--) { var x = list[i], r = avg[x.v] ? x.q / avg[x.v] : 1; if (r >= tapeMin) shown.push({ x: x, r: r }); }
    tapeRows.forEach(function (row, i) {
      var it = shown[i]; row.el.hidden = !it; if (!it) return;
      var x = it.x, d = new Date(x.t), cls = x.buy ? "b" : "s";
      row.el.className = it.r >= 5 ? "big" : "";
      row.t.textContent = String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0") + ":" + String(d.getSeconds()).padStart(2, "0") + "." + String(d.getMilliseconds()).padStart(3, "0");
      row.p.textContent = fmtPrice(x.p); row.p.className = "num " + cls;
      row.q.textContent = fmtSize(x.q); row.q.className = "num r " + cls;
      row.v.textContent = SHORT[x.v];
    });
    $("fl-tape-wait").hidden = shown.length > 0;
  }

  function renderContext(bs) {
    var t = w(), box = $("fl-ctx-zones"), last = trades.length ? trades[trades.length - 1] : null;
    var p = bs ? bs.mid : last ? last.p : 0;
    $("fl-ctx-price").textContent = p ? fmtPrice(p) : "—";
    box.textContent = "";
    if (!p || !zones.length) return;
    function add(label, z, cls, dist) {
      var s = document.createElement("span"); s.className = cls || "";
      var b = document.createElement("b"); b.className = "num"; b.textContent = fmtPrice(z.low) + " – " + fmtPrice(z.high);
      s.appendChild(document.createTextNode(label + " ")); s.appendChild(b);
      if (dist != null) { var m = document.createElement("span"); m.className = "muted"; m.textContent = " " + (dist > 0 ? "+" : "−") + pctText(dist, Math.abs(dist) < 0.001 ? 2 : 1); s.appendChild(m); }
      box.appendChild(s);
    }
    var inside = zones.filter(function (z) { return p >= z.low && p <= z.high; });
    inside.forEach(function (z) { add("● " + fill(t.inside, { type: z.type === "support" ? t.support : t.resistance }), z, z.type === "support" ? "in up" : "in down"); });
    var above = zones.filter(function (z) { return z.low > p && z.type === "resistance"; }).sort(function (a, b) { return a.low - b.low; })[0];
    var below = zones.filter(function (z) { return z.high < p && z.type === "support"; }).sort(function (a, b) { return b.high - a.high; })[0];
    if (above) add(t.nearestRes, above, "", above.low / p - 1);
    if (below) add(t.nearestSup, below, "", below.high / p - 1);
  }

  // Coinbase premium: Coinbase USD mid over Binance USDT mid (OKX when Binance is not reachable), whatever venue is shown.
  function renderPremium() {
    var el = $("fl-prem"), cb = venues.coinbase, ref = venues.binance && venues.binance.ready && venues.binance.best() ? venues.binance : venues.okx;
    var a = cb && cb.ready && cb.best(), b = ref && ref.ready && ref.best();
    el.hidden = !(a && b); if (el.hidden) return;
    var r = a.mid / b.mid - 1, d = a.mid - b.mid, v = $("fl-prem-v");
    v.textContent = (r >= 0 ? "+" : "−") + pctText(r, 3); v.className = "num " + (r > 0 ? "up" : r < 0 ? "down" : "");
    $("fl-prem-d").textContent = "(" + (d >= 0 ? "+" : "−") + fmtPrice(Math.abs(d)) + " $" + (ref.id === "okx" ? " · OKX" : "") + ")";
  }

  // Flow in the zone: from the moment the price enters a band, buys and sells of the shown venues inside it.
  function zoneOf(p) { var best = null; zones.forEach(function (z) { if (p >= z.low && p <= z.high && (!best || z.high - z.low < best.high - best.low)) best = z; }); return best; }
  function renderZoneFlow(bs) {
    var t = w(), last = trades.length ? trades[trades.length - 1] : null, p = bs ? bs.mid : last ? last.p : 0, now = Date.now();
    if (p) {
      var z = zoneOf(p);
      if (z && !(zs && zs.active && zs.z === z)) zs = { z: z, since: now, p0: p, p1: p, v: {}, active: true };
      else if (!z && zs && zs.active) { zs.active = false; zs.end = now; }
      if (zs && zs.active) zs.p1 = p;
    }
    var head = $("fl-zf-head"), body = $("fl-zf-body"), msg = $("fl-zf-msg");
    if (!zs) { body.hidden = true; msg.hidden = false; msg.textContent = zones.length ? t.zfNone : t.zfNoZones; head.textContent = ""; return; }
    var sup = zs.z.type === "support", typ = sup ? t.support : t.resistance, range = fmtPrice(zs.z.low) + " – " + fmtPrice(zs.z.high);
    typ = typ.charAt(0).toUpperCase() + typ.slice(1);
    head.textContent = zs.active ? fill(t.zfSince, { type: typ, range: range, min: Math.floor((now - zs.since) / 60000) }) : fill(t.zfLast, { type: typ, range: range, min: Math.floor((now - zs.end) / 60000) });
    msg.hidden = zs.active; msg.textContent = zs.active ? "" : t.zfNone;
    body.hidden = false;
    var bv = 0, sv = 0; selected().forEach(function (id) { var x = zs.v[id]; if (x) { bv += x.bv; sv += x.sv; } });
    var dc = bv - sv, tot = bv + sv;
    $("fl-zf-b").textContent = fmtSize(bv) + " " + base; $("fl-zf-s").textContent = fmtSize(sv) + " " + base;
    var c = $("fl-zf-c"); c.textContent = (dc < 0 ? "−" : dc > 0 ? "+" : "") + fmtSize(Math.abs(dc)) + " " + base; c.className = "num " + (dc > 0 ? "up" : dc < 0 ? "down" : "");
    $("fl-zf-bar-b").style.flex = String(tot ? bv / tot : 0.5); $("fl-zf-bar-s").style.flex = String(tot ? sv / tot : 0.5);
    $("fl-zf-bt").textContent = fill(t.bids, { p: tot ? pctText(bv / tot, 1) : "—" }); $("fl-zf-st").textContent = fill(t.asks, { p: tot ? pctText(sv / tot, 1) : "—" });
    // Resting orders inside the band on the zone's side (only as far as the books reach).
    $("fl-zf-rl").textContent = sup ? t.zfRestBid : t.zfRestAsk;
    var rest = 0;
    if (bs) bs.venues.forEach(function (o) { (sup ? o.v.bids : o.v.asks).forEach(function (q, pr) { pr *= o.k; if (pr >= zs.z.low && pr <= zs.z.high) rest += q; }); });
    $("fl-zf-r").textContent = bs ? fmtSize(rest) + " " + base : "—";
    var read = $("fl-zf-read"), dp = zs.p0 ? zs.p1 / zs.p0 - 1 : 0;
    if (!zs.active) { read.hidden = true; return; }
    read.hidden = false;
    if (now - zs.since < 30000 || !tot) { read.textContent = t.zfWait; return; }
    var move = " (" + fill(t.zfMove, { p: (dp >= 0 ? "+" : "−") + pctText(dp), c: dc >= 0 ? "+" : "−" }) + ")";
    if (Math.abs(dc) < tot * 0.05) read.textContent = t.zfBal + move;
    else if (dc > 0) read.textContent = (dp > 0.0003 ? t.zfUpUp : t.zfUpFlat) + move;
    else read.textContent = (dp < -0.0003 ? t.zfDnDn : t.zfDnFlat) + move;
  }

  // Session volume profile of the shown venues (Coinbase scaled like the book), up to 24 rows.
  function renderProfile(bs) {
    var t = w(), sel = selected(), pts = [];
    sel.forEach(function (id) {
      var vp = profile[id]; if (!vp) return;
      var k = 1; if (bs) bs.venues.forEach(function (o) { if (o.v.id === id) k = o.k; });
      vp.m.forEach(function (q, pr) { pts.push([pr * k, q]); });
    });
    var box = $("fl-vp"), poc = $("fl-vp-poc");
    if (!pts.length) { box.textContent = ""; poc.textContent = t.waiting; return; }
    var lo = Infinity, hi = 0; pts.forEach(function (x) { if (x[0] < lo) lo = x[0]; if (x[0] > hi) hi = x[0]; });
    var bucket = Math.max(step || 0, niceStep(Math.max((hi - lo) / 24, lo * 0.00001)));
    var top = Math.ceil(hi / bucket) * bucket, n = Math.max(1, Math.min(24, Math.round((top - Math.floor(lo / bucket) * bucket) / bucket) + 1)), rows = new Array(n).fill(0);
    pts.forEach(function (x) { var i = Math.round((top - x[0]) / bucket); if (i >= 0 && i < n) rows[i] += x[1]; });
    var max = Math.max.apply(null, rows) || 1, pi = rows.indexOf(max), d = Math.max(digits || 0, decimals(bucket)), cur = bs ? bs.mid : 0;
    box.textContent = "";
    rows.forEach(function (q, i) {
      var pr = top - i * bucket, z = zoneAt(pr - bucket / 2, pr + bucket / 2);
      var lab = document.createElement("span"); lab.className = "num" + (cur && Math.abs(cur - pr) <= bucket / 2 ? " cur" : "") + (z ? " z-" + z : ""); lab.textContent = fmtPrice(pr, d);
      var bar = document.createElement("i"); bar.style.width = (q / max * 100).toFixed(1) + "%"; bar.className = i === pi ? "poc" : "";
      box.appendChild(lab); box.appendChild(bar);
    });
    poc.textContent = fill(t.vpPoc, { p: fmtPrice(top - pi * bucket, d) });
  }

  function renderStatus() {
    var t = w(), box = $("fl-venues"); box.textContent = "";
    var any = false, wait = false;
    (mode === "all" ? ORDER : [mode]).forEach(function (id) {
      var v = venues[id]; if (!v) return;
      var s = document.createElement("span"); s.className = "vs " + v.status; s.title = NAME[id] + " · " + (t.status[v.status] || v.status);
      s.innerHTML = "<i></i>"; s.appendChild(document.createTextNode(NAME[id])); box.appendChild(s);
      if (v.status === "live") any = true; else if (v.status === "connecting") wait = true;
    });
    var live = $("fl-live"); live.className = "live " + (paused ? "paused" : any ? "on" : "wait");
    live.lastChild.textContent = paused ? t.paused : any ? t.live : t.connecting;
  }

  var paused = false, frame = 0;
  function render() {
    if (document.hidden || !ladder) return;
    frame++;
    var bs = renderBook(bookState());
    if (bs && digits == null) digits = window.MarketUI ? MarketUI.digitsFor(bs.mid) : 2;
    renderContext(bs); renderTape(); renderStatus(); renderPremium(); renderZoneFlow(bs);
    if (frame % 2 === 0 || dirty) { renderCvd(); renderDepth(bs); renderProfile(bs); }
    dirty = false;
  }

  // ─── Lifecycle ───────────────────────────────────────────────────────────
  function start() {
    trades = []; secs = []; profile = {}; zs = null; started = Date.now(); paused = false;
    venues = { binance: new Binance(base), okx: new Okx(base), coinbase: new Coinbase(base) };
    ORDER.forEach(function (id) { venues[id].connect(); });
  }
  function stop() { ORDER.forEach(function (id) { if (venues[id]) venues[id].stop(); }); }
  var hideTimer = null;
  document.addEventListener("visibilitychange", function () {
    if (!ladder) return;
    if (document.hidden) { hideTimer = setTimeout(function () { stop(); paused = true; }, 60000); }
    else { clearTimeout(hideTimer); if (paused) start(); render(); }
  });
  window.addEventListener("pagehide", stop);

  function buildDom() {
    var book = $("fl-book-rows"), mid = $("fl-mid");
    ladder = [];
    for (var i = 0; i < ROWS * 2; i++) {
      var el = document.createElement("div"); el.className = "ob-row"; el.hidden = true;
      el.innerHTML = '<i></i><span class="num"></span><span class="num r"></span><span class="num r m"></span>';
      var row = { el: el, bar: el.children[0], p: el.children[1], q: el.children[2], n: el.children[3] };
      ladder.push(row);
      if (i < ROWS) book.insertBefore(el, mid); else book.appendChild(el);
    }
    var tape = $("fl-tape"); tapeRows = [];
    for (var j = 0; j < TAPE_ROWS; j++) {
      var r = document.createElement("div"); r.hidden = true;
      r.innerHTML = '<span class="num v"></span><span class="num"></span><span class="num r"></span><span class="v"></span>';
      tape.appendChild(r); tapeRows.push({ el: r, t: r.children[0], p: r.children[1], q: r.children[2], v: r.children[3] });
    }
    $("fl-group").addEventListener("change", function () { stepIdx = +this.value; step = steps[stepIdx]; render(); });
    $("fl-venue").addEventListener("change", function () { mode = this.value; render(); });
    $("fl-int").addEventListener("click", function (e) { var b = e.target.closest("button[data-s]"); if (!b) return; cvdInt = +b.dataset.s; seg(this, b); render(); });
    $("fl-big").addEventListener("click", function (e) { var b = e.target.closest("button[data-x]"); if (!b) return; tapeMin = +b.dataset.x; seg(this, b); render(); });
    function seg(box, b) { box.querySelectorAll("button").forEach(function (x) { x.setAttribute("aria-pressed", String(x === b)); }); }
    window.addEventListener("resize", function () { dirty = true; render(); });
    new MutationObserver(function () { dirty = true; render(); }).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  }

  function applyWords() {
    var t = w();
    document.querySelectorAll("[data-fl]").forEach(function (el) { var v = t[el.dataset.fl]; if (typeof v === "string") el.textContent = v; });
    var all = document.querySelector('#fl-venue option[value="all"]'); if (all) all.textContent = t.venueAll;
    var pr = $("fl-prem"); if (pr) pr.title = t.premTitle;
    document.title = "MarketLevelMap — " + (base ? base + " · " : "") + t.title;
    if (ladder) { dirty = true; render(); }
  }

  // Zones of the latest Critical Zones analysis of this asset (timeframe chosen on the page; 1D first).
  function loadZones(entries) {
    var sel = $("fl-ztf"), cz = entries.filter(function (e) { return MarketUI.methodOf(e) === "cz" && e.report; }).sort(MarketUI.byTimeframe);
    sel.textContent = "";
    if (!cz.length) { $("fl-zsrc").textContent = w().noZones; $("fl-zsrc").dataset.fl = "noZones"; sel.hidden = true; return; }
    cz.forEach(function (e) { var o = document.createElement("option"); o.value = e.publicationId; o.textContent = MarketUI.timeframeOf(e).toUpperCase(); sel.appendChild(o); });
    var pick = cz.filter(function (e) { return MarketUI.timeframeOf(e).toLowerCase() === "1d"; })[0] || cz[0];
    sel.value = pick.publicationId;
    function load(e) {
      fetch(e.report.url, { cache: "no-store" }).then(function (r) { return r.ok ? r.json() : null; }).then(function (rep) {
        zones = (rep && Array.isArray(rep.zones) ? rep.zones : []).map(function (z) { var a = Number(z.low), b = Number(z.high); return { low: Math.min(a, b), high: Math.max(a, b), type: z.type === "support" ? "support" : "resistance" }; })
          .filter(function (z) { return z.low > 0 && z.high > 0; });
        zs = null;
        var src = $("fl-zsrc"); delete src.dataset.fl;
        src.textContent = fill(w().zonesFrom, { date: rep && rep.analyzedAt ? MarketUI.date(rep.analyzedAt) : "—" });
        dirty = true; render();
      }).catch(function () {});
    }
    sel.onchange = function () { var e = cz.filter(function (x) { return x.publicationId === sel.value; })[0]; if (e) load(e); };
    load(pick);
  }

  function gate(user) {
    var t = w(), box = $("fl-gate"), msg = $("fl-gate-msg"), link = $("fl-gate-link");
    box.hidden = false;
    if (!user) { msg.dataset.fl = "gateGuest"; link.dataset.fl = "signIn"; link.href = "/api/auth/google/start?return=" + encodeURIComponent(location.pathname + location.search); }
    else { msg.dataset.fl = "gateMember"; link.dataset.fl = "profile"; link.href = "/account"; }
    msg.textContent = t[msg.dataset.fl]; link.textContent = t[link.dataset.fl];
  }

  function boot() {
    var q = new URLSearchParams(location.search), asset = String(q.get("asset") || "BTCUSDT").toUpperCase().replace(/[^A-Z0-9]/g, "");
    var m = /^([A-Z0-9]{2,15})USDT$/.exec(asset);
    base = m ? m[1] : "";
    $("fl-asset").textContent = base || asset;
    $("lang").addEventListener("change", function () { setTimeout(applyWords, 0); });
    applyWords();
    var ready = window.MLMAccount ? MLMAccount.ready : Promise.resolve(null);
    ready.then(function (user) {
      var member = !!(user && (user.status === "approved" || user.isAdmin));
      if (!member) { gate(user); return; }
      if (!base) { $("fl-gate").hidden = false; $("fl-gate-msg").dataset.fl = "notCrypto"; $("fl-gate-msg").textContent = w().notCrypto; $("fl-gate-link").hidden = true; return; }
      $("fl-app").hidden = false; $("fl-ctl").hidden = false;
      buildDom(); start(); setInterval(render, 250);
      fetch("/api/publication", { cache: "no-store" }).then(function (r) { return r.ok ? r.json() : null; }).then(function (body) {
        var entries = (body && body.entries) || [], assets = {};
        entries.forEach(function (e) { var a = MarketUI.assetOf(e); if (/^[A-Z0-9]{2,15}USDT$/.test(a)) assets[a] = 1; });
        assets[asset] = 1;
        var sel = $("fl-asset-sel"); sel.textContent = "";
        Object.keys(assets).sort(MarketUI.byPopularity).forEach(function (a) { var o = document.createElement("option"); o.value = a; o.textContent = a; if (a === asset) o.selected = true; sel.appendChild(o); });
        sel.onchange = function () { location.search = "?asset=" + encodeURIComponent(sel.value); };
        loadZones(entries.filter(function (e) { return MarketUI.assetOf(e) === asset; }));
      }).catch(function () {});
    });
  }
  window.MLMFlow = { _state: function () { return { venues: venues, trades: trades, secs: secs, zones: zones, step: step }; } };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();
})();
