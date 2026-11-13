/* Zone scanner (README "Zone scanner"). Members-only page (scanner.html): every analysed asset's live price against
   the bands of its latest Critical Zones report (timeframe chosen on the page), zone alarms, and big spot trades
   across all assets. Prices come from assets/market-feed.js; big trades from Binance's public aggTrade streams,
   opened by the visitor's browser. Nothing is stored on our side: alarms live in this browser (localStorage). */
(function () {
  "use strict";
  var W = {
    en: {
      title: "Scanner", sub: "live · Critical Zones", lead: "Where each asset's price stands against its analysis zones.", tf: "Timeframe",
      assets: "Assets", byNear: "nearest first", asset: "Asset", price: "Price", status: "Status", position: "Position", res: "Nearest resistance", sup: "Nearest support",
      inS: "Inside the support zone", inR: "Inside the resistance zone", nearR: "{p} below resistance", nearS: "{p} above support", between: "Between zones", noZones: "No zones",
      inside: "inside", loading: "Loading…", noAnalysis: "No Critical Zones analysis on this timeframe",
      alarms: "Alarms", alarmsNone: "No alarms. Use the bell on a row.", alarmsNote: "Alarms ring while this page is open (also in a background tab) and are kept only in this browser.",
      enter: "When the price enters a zone", exit: "When the price leaves a zone", remove: "Remove",
      entered: "{asset} entered the {type} zone", left: "{asset} left the {type} zone", support: "support", resistance: "resistance", priceNow: "price {p}",
      big: "Big trades", bigSub: "all assets · spot · Binance", bigNote: "A print is at least the chosen multiple of the asset's average trade and $10K. Click a row for the live flow.",
      buy: "BUY", sell: "SELL", bigWait: "Waiting for big trades…", bigOff: "Binance cannot be reached from here.",
      gateGuest: "The scanner is for members. Sign in with Google to apply for membership.", signIn: "Sign in with Google",
      gateMember: "The scanner is for members. It opens once your membership is approved.", profile: "Your profile",
      notifyOff: "Browser notifications are blocked; alarms show on the page only.",
      spot: "Spot", futures: "Futures", fFund: "Funding", fOi: "Open interest", fOi1h: "OI 1h", fLiq: "Liquidations 15 min", fYear: "annual {p}",
      fNote: "Futures columns: Binance USDT perpetuals. Funding is the current rate (annualised under it); open interest is read every minute and its 1-hour change comes from Binance's 5-minute history (marked “session” when it is taken from this page's own samples instead); liquidations are summed since the page opened (at most the last 15 min; L = longs liquidated, S = shorts). Click a column title to sort.",
      bigSubF: "all assets · futures · Binance", byCol: "by the chosen column", sess: "session", srcBin: "Futures source: Binance USD-M.", srcOkx: "Futures source: OKX USDT swaps (Binance futures did not answer from here).", bigSubFO: "all assets · futures · OKX", sortBy: "Sort by {c}"
    },
    tr: {
      title: "Tarayıcı", sub: "canlı · Kritik Bölgeler", lead: "Her varlığın fiyatının analiz bölgelerine göre nerede durduğu.", tf: "Zaman dilimi",
      assets: "Varlıklar", byNear: "yakınlık sırasına göre", asset: "Varlık", price: "Fiyat", status: "Durum", position: "Konum", res: "En yakın direnç", sup: "En yakın destek",
      inS: "Destek bölgesinin içinde", inR: "Direnç bölgesinin içinde", nearR: "Dirence {p} uzakta", nearS: "Desteğe {p} uzakta", between: "Bölgeler arası", noZones: "Bölge yok",
      inside: "içinde", loading: "Yükleniyor…", noAnalysis: "Bu zaman diliminde Kritik Bölgeler analizi yok",
      alarms: "Alarmlar", alarmsNone: "Alarm yok. Satırdaki zili kullanın.", alarmsNote: "Alarmlar bu sayfa açıkken çalar (arka plandaki sekmede de) ve yalnızca bu tarayıcıda tutulur.",
      enter: "Fiyat bölgeye girince", exit: "Fiyat bölgeden çıkınca", remove: "Kaldır",
      entered: "{asset} {type} bölgesine girdi", left: "{asset} {type} bölgesinden çıktı", support: "destek", resistance: "direnç", priceNow: "fiyat {p}",
      big: "Büyük işlemler", bigSub: "tüm varlıklar · spot · Binance", bigNote: "İşlem, varlığın ortalama işleminin seçilen katı ve en az 10 B $ olmalıdır. Satıra tıklayınca canlı akış açılır.",
      buy: "ALIŞ", sell: "SATIŞ", bigWait: "Büyük işlem bekleniyor…", bigOff: "Buradan Binance'e ulaşılamıyor.",
      gateGuest: "Tarayıcı üyelere özeldir. Üyelik başvurusu için Google ile giriş yapın.", signIn: "Google ile giriş yap",
      gateMember: "Tarayıcı üyelere özeldir. Üyeliğiniz onaylandığında açılır.", profile: "Profiliniz",
      notifyOff: "Tarayıcı bildirimleri engelli; alarmlar yalnızca sayfada görünür.",
      spot: "Spot", futures: "Vadeli", fFund: "Fonlama", fOi: "Açık pozisyon", fOi1h: "AP 1 sa", fLiq: "Likidasyon 15 dk", fYear: "yıllık {p}",
      fNote: "Vadeli sütunlar: Binance USDT sürekli vadeli. Fonlama güncel orandır (altında yıllık karşılığı); açık pozisyon dakikada bir okunur, 1 saatlik değişimi Binance'in 5 dakikalık geçmişinden gelir (bu sayfanın kendi örneklerinden hesaplanırsa “oturum” yazar); likidasyonlar sayfa açıldığından beri toplanır (en fazla son 15 dk; L = long likidasyonu, S = short). Sıralamak için sütun başlığına tıklayın.",
      bigSubF: "tüm varlıklar · vadeli · Binance", byCol: "seçilen sütuna göre", sess: "oturum", srcBin: "Vadeli kaynak: Binance USD-M.", srcOkx: "Vadeli kaynak: OKX USDT swap (Binance vadeli buradan cevap vermedi).", bigSubFO: "tüm varlıklar · vadeli · OKX", sortBy: "{c} göre sırala"
    }
  };
  function lang() { var s = document.getElementById("lang"); return s && s.value === "tr" ? "tr" : "en"; }
  function w() { return W[lang()]; }
  function fill(t, o) { return String(t).replace(/\{(\w+)\}/g, function (_, k) { return o[k] == null ? "" : o[k]; }); }
  function $(id) { return document.getElementById(id); }
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function locale() { return MarketUI.locale(); }
  function nf(v, d) { return Number(v).toLocaleString(locale(), { minimumFractionDigits: d, maximumFractionDigits: d }); }
  function pct(r, d) { var s = nf(Math.abs(r) * 100, d == null ? 1 : d); return lang() === "tr" ? "%" + s : s + "%"; }
  function price(p) { return MarketUI.price(p); }
  var TF_ORDER = ["1h", "4h", "1d", "1w"], NEAR = 0.01;
  var MARKET = /[?&]market=futures(&|$)/.test(location.search) ? "futures" : "spot", FUT = MARKET === "futures";
  // ─── Futures data (Binance USD-M): all-market mark price/funding and liquidations in one socket, OI history by REST.
  var fut = {}, liqAll = [], sortKey = "", futSrc = "binance";
  // Per-symbol streams on /market (the same ones the live flow page uses): <sym>@markPrice@1s and <sym>@forceOrder.
  // Open interest from /fapi/v1/openInterest every minute; its 1-hour change from Binance's 5-minute history when that
  // answers, else from this page's own minute samples (marked "session").
  function futStart(list) {
    var syms = list.filter(function (a) { return /USDT$/.test(a); }); if (!syms.length) return;
    var retry = 0, params = [], bws = null;
    syms.forEach(function (s) { params.push(s.toLowerCase() + "@markPrice@1s", s.toLowerCase() + "@forceOrder"); });
    // The rule: when Binance futures sends no funding within 10 s (it is restricted in some countries), the
    // futures columns and big trades switch to OKX for this page.
    setTimeout(function () { if (futSrc === "binance" && !syms.some(function (x) { return fut[x] && fut[x].fr != null; })) { futSrc = "okx"; if (bws) { var x = bws; bws = null; try { x.close(); } catch (e) {} } futOkx(syms); } }, 10000);
    (function open() {
      if (futSrc !== "binance") return;
      var ws; try { ws = new WebSocket("wss://fstream.binance.com/market/ws"); } catch (e) { return; }
      bws = ws;
      ws.onopen = function () { retry = 0; ws.send(JSON.stringify({ method: "SUBSCRIBE", params: params, id: 1 })); };
      ws.onmessage = function (e) {
        var m; try { m = JSON.parse(e.data); } catch (_) { return; }
        var list2 = Array.isArray(m) ? m : [m.data || m];
        list2.forEach(function (x) {
          if (!x) return;
          if (x.e === "markPriceUpdate" && syms.indexOf(x.s) > -1) { var f = fut[x.s] || (fut[x.s] = {}); f.mark = +x.p; f.fr = +x.r; f.next = +x.T; if (f.oi > 0) f.oiV = f.oi * f.mark; dirty = true; }
          else if (x.e === "forceOrder" && x.o && syms.indexOf(x.o.s) > -1) { var o = x.o, pr = +o.ap || +o.p, q = +o.z || +o.q; if (pr > 0 && q > 0) { liqAll.push({ s: o.s, side: o.S === "SELL" ? "L" : "S", n: pr * q, t: Date.now() }); if (liqAll.length > 5000) liqAll.shift(); dirty = true; } }
        });
      };
      ws.onclose = function () { if (bws !== ws) return; setTimeout(open, Math.min(30000, 1000 * Math.pow(2, retry++))); };
    })();
    var histOk = {};
    function oiNow() {
      syms.forEach(function (sym, i) {
        setTimeout(function () {
          if (futSrc !== "binance") return;
          fetch("https://fapi.binance.com/fapi/v1/openInterest?symbol=" + sym, { cache: "no-store" }).then(function (r) { return r.ok ? r.json() : null; }).then(function (b) {
            if (futSrc !== "binance" || !b || !(+b.openInterest > 0)) return;
            var f = fut[sym] || (fut[sym] = {}), now = Date.now(); f.oi = +b.openInterest; if (f.mark > 0) f.oiV = f.oi * f.mark;
            var smp = f.smp || (f.smp = []); smp.push({ t: now, oi: f.oi }); while (smp.length && smp[0].t < now - 3900000) smp.shift();
            if (!histOk[sym] && smp.length > 1) { var ref = smp.filter(function (x) { return x.t <= now - 3600000; }).pop() || smp[0]; f.oi1h = f.oi / ref.oi - 1; f.oiSess = now - ref.t < 3500000; }
            dirty = true;
          }).catch(function () {});
        }, i * 200);
      });
    }
    function oiHist() {
      syms.forEach(function (sym, i) {
        setTimeout(function () {
          if (futSrc !== "binance") return;
          fetch("https://fapi.binance.com/futures/data/openInterestHist?symbol=" + sym + "&period=5m&limit=13", { cache: "no-store" }).then(function (r) { return r.ok ? r.json() : null; }).then(function (l) {
            if (futSrc !== "binance" || !Array.isArray(l) || l.length < 2) return;
            l.sort(function (a, b) { return a.timestamp - b.timestamp; });
            var f = fut[sym] || (fut[sym] = {}); if (+l[0].sumOpenInterest > 0) { f.oi1h = +l[l.length - 1].sumOpenInterest / +l[0].sumOpenInterest - 1; f.oiSess = false; histOk[sym] = true; dirty = true; }
          }).catch(function () {});
        }, i * 250);
      });
    }
    oiNow(); oiHist(); setInterval(oiNow, 60000); setInterval(oiHist, 300000);
  }
  // OKX USDT swaps: one socket with funding-rate, mark-price and trades per asset plus liquidation-orders; sizes are in
  // contracts (× ctVal from the instrument list). Open interest of all swaps every minute; the 1-hour change from OKX's
  // 5-minute history per instrument, else from this page's samples ("session").
  function futOkx(syms) {
    var inst = {}, ct = {}, retry = 0;
    fut = {}; liqAll.length = 0; dirty = true; syncSrc();
    if (bigWs) { var bw = bigWs; bigWs = null; try { bw.close(); } catch (e) {} } big.length = 0; stats = {}; pend = {}; bigDirty = true;
    fetch("https://www.okx.com/api/v5/public/instruments?instType=SWAP", { cache: "no-store" }).then(function (r) { return r.ok ? r.json() : null; }).then(function (b) {
      ((b && b.data) || []).forEach(function (d) { var m = /^([A-Z0-9]+)-USDT-SWAP$/.exec(d.instId); if (m && syms.indexOf(m[1] + "USDT") > -1) { inst[d.instId] = m[1] + "USDT"; ct[d.instId] = +d.ctVal || 1; } });
      var ids = Object.keys(inst); if (!ids.length) return;
      (function open() {
        var ws; try { ws = new WebSocket("wss://ws.okx.com:8443/ws/v5/public"); } catch (e) { return; }
        var ping = null;
        ws.onopen = function () {
          retry = 0; var args = [{ channel: "liquidation-orders", instType: "SWAP" }];
          ids.forEach(function (id) { args.push({ channel: "funding-rate", instId: id }, { channel: "mark-price", instId: id }, { channel: "trades", instId: id }); });
          ws.send(JSON.stringify({ op: "subscribe", args: args })); ping = setInterval(function () { try { ws.send("ping"); } catch (e) {} }, 20000);
        };
        ws.onmessage = function (e) {
          if (e.data === "pong") return; var m; try { m = JSON.parse(e.data); } catch (_) { return; }
          if (!m.arg || !Array.isArray(m.data)) return; var ch = m.arg.channel;
          m.data.forEach(function (d) {
            if (ch === "liquidation-orders") { var sy = inst[d.instId]; if (!sy) return; (d.details || []).forEach(function (x) { var n = +x.bkPx * +x.sz * ct[d.instId]; if (n > 0) { liqAll.push({ s: sy, side: x.posSide === "long" || (x.posSide !== "short" && x.side === "sell") ? "L" : "S", n: n, t: Date.now() }); if (liqAll.length > 5000) liqAll.shift(); dirty = true; } }); return; }
            var s2 = inst[d.instId]; if (!s2) return; var f = fut[s2] || (fut[s2] = {});
            if (ch === "funding-rate") { f.fr = +d.fundingRate; f.next = +d.fundingTime; }
            else if (ch === "mark-price") f.mark = +d.markPx;
            else if (ch === "trades") onAgg({ s: s2, T: +d.ts, m: d.side === "sell", q: +d.sz * ct[d.instId], p: +d.px });
            dirty = true;
          });
        };
        ws.onclose = function () { clearInterval(ping); setTimeout(open, Math.min(30000, 1000 * Math.pow(2, retry++))); };
      })();
      var histOk = {};
      function oiNow() {
        fetch("https://www.okx.com/api/v5/public/open-interest?instType=SWAP", { cache: "no-store" }).then(function (r) { return r.ok ? r.json() : null; }).then(function (b) {
          var now = Date.now();
          ((b && b.data) || []).forEach(function (d) {
            var s2 = inst[d.instId]; if (!s2) return; var f = fut[s2] || (fut[s2] = {});
            f.oi = +d.oiCcy; f.oiV = +d.oiUsd || (f.mark > 0 ? f.oi * f.mark : 0);
            var smp = f.smp || (f.smp = []); smp.push({ t: now, oi: f.oi }); while (smp.length && smp[0].t < now - 3900000) smp.shift();
            if (!histOk[s2] && smp.length > 1) { var ref = smp.filter(function (x) { return x.t <= now - 3600000; }).pop() || smp[0]; f.oi1h = f.oi / ref.oi - 1; f.oiSess = now - ref.t < 3500000; }
          });
          dirty = true;
        }).catch(function () {});
      }
      function oiHist() {
        ids.forEach(function (id, i) {
          setTimeout(function () {
            fetch("https://www.okx.com/api/v5/rubik/stat/contracts/open-interest-history?instId=" + id + "&period=5m&limit=13", { cache: "no-store" }).then(function (r) { return r.ok ? r.json() : null; }).then(function (b) {
              var l = b && Array.isArray(b.data) ? b.data.slice() : []; if (l.length < 2) return;
              l.sort(function (a, c) { return +a[0] - +c[0]; });
              var s2 = inst[id], f = fut[s2] || (fut[s2] = {}), a0 = +l[0][2], a1 = +l[l.length - 1][2];
              if (a0 > 0) { f.oi1h = a1 / a0 - 1; f.oiSess = false; histOk[s2] = true; dirty = true; }
            }).catch(function () {});
          }, i * 300);
        });
      }
      oiNow(); oiHist(); setInterval(oiNow, 60000); setInterval(oiHist, 300000);
    }).catch(function () {});
  }
  function syncSrc() {
    var t = w(), e = $("sc-fsrc"); if (!e) return;
    e.hidden = !FUT; e.textContent = futSrc === "okx" ? t.srcOkx : t.srcBin;
    var bs = document.querySelector('[data-sc="bigSub"]'); if (bs && FUT) bs.textContent = futSrc === "okx" ? t.bigSubFO : t.bigSubF;
  }
  function liq15(sym) { var now = Date.now(), L = 0, S = 0; liqAll.forEach(function (x) { if (x.s === sym && x.t > now - 900000) { if (x.side === "L") L += x.n; else S += x.n; } }); return { L: L, S: S }; }
  function money(v) { return v > 0 ? v.toLocaleString(locale(), { notation: "compact", maximumFractionDigits: v >= 1e6 ? 2 : 0 }) + " $" : "0 $"; }
  function signPct(r, d) { var z = Math.abs(r) * 100 < 0.5 * Math.pow(10, -d); return (z ? "" : r > 0 ? "+" : "−") + pct(r, d); }

  var entries = {}, assets = [], tf = "1d", zonesBy = {}, loads = {}, prices = {}, opens = {}, last = {}, alarms = {}, dirty = true;
  try { alarms = JSON.parse(localStorage.getItem("mlm-zone-alarms") || "{}") || {}; } catch (e) { alarms = {}; }
  function saveAlarms() { try { localStorage.setItem("mlm-zone-alarms", JSON.stringify(alarms)); } catch (e) {} }

  // ─── Zones ───────────────────────────────────────────────────────────────
  function normZones(rep) {
    return (rep && Array.isArray(rep.zones) ? rep.zones : []).map(function (z) { var a = Number(z.low), b = Number(z.high); return { low: Math.min(a, b), high: Math.max(a, b), type: z.type === "support" ? "support" : "resistance" }; })
      .filter(function (z) { return z.low > 0 && z.high > 0; });
  }
  function loadTf(t) {
    if (loads[t]) return loads[t];
    zonesBy[t] = zonesBy[t] || {};
    loads[t] = Promise.all(assets.map(function (a) {
      var e = entries[a] && entries[a][t];
      if (!e) { zonesBy[t][a] = null; return null; }
      return fetch(e.report.url, { cache: "no-store" }).then(function (r) { return r.ok ? r.json() : null; }).then(function (rep) { zonesBy[t][a] = rep && !rep.locked ? normZones(rep) : null; dirty = true; }).catch(function () { zonesBy[t][a] = null; });
    }));
    return loads[t];
  }
  function narrowest(list) { return list.sort(function (a, b) { return (a.high - a.low) - (b.high - b.low); })[0] || null; }
  function state(p, zones) {
    if (!(p > 0) || !zones) return null;
    var inside = narrowest(zones.filter(function (z) { return p >= z.low && p <= z.high; }));
    var res = zones.filter(function (z) { return z.type === "resistance" && z.low > p; }).sort(function (a, b) { return a.low - b.low; })[0] || null;
    var sup = zones.filter(function (z) { return z.type === "support" && z.high < p; }).sort(function (a, b) { return b.high - a.high; })[0] || null;
    var dr = res ? res.low / p - 1 : Infinity, ds = sup ? 1 - sup.high / p : Infinity;
    return { inside: inside, res: res, sup: sup, dr: dr, ds: ds, near: Math.min(dr, ds), zones: zones };
  }

  // ─── Table ───────────────────────────────────────────────────────────────
  function statusPill(st) {
    var t = w();
    if (!st) return el("span", "pill far", t.loading);
    if (!st.zones.length) return el("span", "pill far", t.noZones);
    if (st.inside) return el("span", "pill " + (st.inside.type === "support" ? "in-s" : "in-r"), "● " + (st.inside.type === "support" ? t.inS : t.inR));
    if (st.near <= NEAR) return el("span", "pill near", st.dr <= st.ds ? fill(t.nearR, { p: pct(st.dr) }) : fill(t.nearS, { p: pct(st.ds) }));
    return el("span", "pill far", t.between);
  }
  // Position bar: from the support zone below (or the one the price is in) to the resistance zone above.
  function meter(st, p) {
    var box = el("div", "meter");
    if (!st || !st.zones.length) return box;
    var lo = st.inside && st.inside.type === "support" ? st.inside : st.sup, hi = st.inside && st.inside.type === "resistance" ? st.inside : st.res;
    if (st.inside && !lo) lo = st.inside; if (st.inside && !hi) hi = st.inside;
    var a = lo ? lo.low : p * 0.95, b = hi ? hi.high : p * 1.05; if (!(b > a)) return box;
    function x(v) { return Math.max(0, Math.min(100, (v - a) / (b - a) * 100)); }
    [lo, hi].forEach(function (z) { if (!z) return; var s = el("s", z.type === "support" ? "s" : "r"); s.style.left = x(z.low) + "%"; s.style.width = Math.max(1.5, x(z.high) - x(z.low)) + "%"; box.appendChild(s); });
    var i = el("i"); i.style.left = x(p) + "%"; box.appendChild(i);
    return box;
  }
  function zoneText(z, d) { return z ? price(z.low) + " – " + price(z.high) : "—"; }
  function render() {
    if (!dirty) return; dirty = false;
    var t = w(), body = $("sc-rows"), zones = zonesBy[tf] || {};
    var rows = assets.map(function (a) { return { a: a, p: prices[a], st: zones[a] === undefined ? undefined : state(prices[a], zones[a]), has: !!(entries[a] && entries[a][tf]) }; })
      .filter(function (r) { return r.has; })
      .sort(function (x, y) {
        if (FUT && sortKey) {
          function v(r) { var f = fut[r.a] || {}, l = liq15(r.a); return sortKey === "fr" ? Math.abs(f.fr || 0) : sortKey === "oi" ? f.oiV || 0 : sortKey === "oi1h" ? Math.abs(f.oi1h || 0) : l.L + l.S; }
          return v(y) - v(x) || MarketUI.byPopularity(x.a, y.a);
        }
        function k(r) { return !r.st ? 9 : r.st.inside ? -1 + 1e-6 * (r.st.inside.high - r.st.inside.low) / r.p : r.st.near; } return k(x) - k(y) || MarketUI.byPopularity(x.a, y.a); });
    body.textContent = "";
    $("sc-empty").hidden = rows.length > 0;
    rows.forEach(function (r) {
      var tr = el("tr"), o = opens[r.a], ch = r.p && o ? r.p / o - 1 : NaN;
      var c0 = el("td"); var link = el("a", "", MarketUI.baseOf(r.a)); link.href = "flow?asset=" + encodeURIComponent(r.a); c0.appendChild(el("b")).appendChild(link); tr.appendChild(c0);
      var c1 = el("td", "r num", r.p ? price(r.p) : "—"); if (isFinite(ch)) { c1.appendChild(document.createTextNode(" ")); c1.appendChild(el("small", MarketUI.signClass(ch), (ch >= 0 ? "+" : "−") + pct(ch))); } tr.appendChild(c1);
      var c2 = el("td"); c2.appendChild(zones[r.a] === null ? el("span", "pill far", t.noZones) : !r.st ? el("span", "pill far", t.loading) : statusPill(r.st)); tr.appendChild(c2);
      if (FUT) {
        var f = fut[r.a] || {}, l = liq15(r.a), hrs = 8;
        var cf = el("td", "r num " + (f.fr > 0 ? "up" : f.fr < 0 ? "down" : ""), f.fr != null ? signPct(f.fr, 4) : "—");
        if (f.fr != null) { cf.appendChild(el("small", "muted blk", fill(t.fYear, { p: signPct(f.fr * 24 / hrs * 365, 1) }))); }
        tr.appendChild(cf);
        tr.appendChild(el("td", "r num hide-m", f.oiV ? money(f.oiV) : "—"));
        var co = el("td", "r num " + (f.oi1h > 0 ? "up" : f.oi1h < 0 ? "down" : ""), f.oi1h != null ? signPct(f.oi1h, 1) : "—"); if (f.oi1h != null && f.oiSess) co.appendChild(el("small", "muted blk", t.sess)); tr.appendChild(co);
        var cl = el("td", "r num liqc"); cl.appendChild(el("span", "down", "L " + money(l.L))); cl.appendChild(el("span", "up", "S " + money(l.S))); tr.appendChild(cl);
      } else {
      var c3 = el("td", "hide-m"); c3.appendChild(meter(r.st, r.p)); tr.appendChild(c3);
      tr.appendChild(el("td", "r num hide-m", r.st && r.st.res ? price(r.st.res.low) + " · +" + pct(r.st.dr) : r.st && r.st.inside && r.st.inside.type === "resistance" ? t.inside : "—"));
      tr.appendChild(el("td", "r num hide-m", r.st && r.st.sup ? price(r.st.sup.high) + " · −" + pct(r.st.ds) : r.st && r.st.inside && r.st.inside.type === "support" ? t.inside : "—"));
      }
      var c6 = el("td", "r"), key = r.a + "|" + tf, al = alarms[key], bell = el("button", "bell" + (al && (al.enter || al.exit) ? " on" : ""));
      bell.type = "button"; bell.dataset.key = key; bell.setAttribute("aria-label", t.alarms + " · " + r.a); bell.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4zM10 20a2 2 0 0 0 4 0"/></svg>';
      c6.appendChild(bell); tr.appendChild(c6);
      body.appendChild(tr);
    });
    renderAlarmList();
  }
  function renderAlarmList() {
    var t = w(), box = $("sc-alarms"); box.textContent = "";
    var keys = Object.keys(alarms).filter(function (k) { return alarms[k] && (alarms[k].enter || alarms[k].exit); });
    if (!keys.length) { box.appendChild(el("span", "muted", t.alarmsNone)); return; }
    keys.sort().forEach(function (k) {
      var parts = k.split("|"), a = alarms[k], chip = el("span", "chip");
      chip.appendChild(el("b", "", MarketUI.baseOf(parts[0]) + " · " + parts[1].toUpperCase()));
      chip.appendChild(document.createTextNode(" " + [a.enter ? "↘ " + t.enter.toLowerCase() : "", a.exit ? "↗ " + t.exit.toLowerCase() : ""].filter(Boolean).join(", ")));
      var x = el("button", "x", "×"); x.type = "button"; x.title = t.remove; x.addEventListener("click", function () { delete alarms[k]; saveAlarms(); dirty = true; render(); });
      chip.appendChild(x); box.appendChild(chip);
    });
  }

  // ─── Alarms ──────────────────────────────────────────────────────────────
  var menu = null;
  function openMenu(bell) {
    closeMenu();
    var t = w(), key = bell.dataset.key, al = alarms[key] || {};
    menu = el("div", "alarm-menu"); menu.setAttribute("role", "dialog");
    menu.appendChild(el("b", "", MarketUI.baseOf(key.split("|")[0]) + " · " + key.split("|")[1].toUpperCase()));
    [["enter", t.enter], ["exit", t.exit]].forEach(function (o) {
      var lab = el("label"), cb = el("input"); cb.type = "checkbox"; cb.checked = !!al[o[0]];
      cb.addEventListener("change", function () {
        var cur = alarms[key] || {}; cur[o[0]] = cb.checked; if (!cur.enter && !cur.exit) delete alarms[key]; else alarms[key] = cur;
        saveAlarms(); askPermission(); loadTf(key.split("|")[1]); dirty = true; render();
      });
      lab.appendChild(cb); lab.appendChild(document.createTextNode(" " + o[1])); menu.appendChild(lab);
    });
    menu.appendChild(el("small", "muted", t.alarmsNote));
    document.body.appendChild(menu);
    var r = bell.getBoundingClientRect(), mw = Math.min(280, innerWidth - 24);
    menu.style.width = mw + "px"; menu.style.top = (r.bottom + scrollY + 6) + "px"; menu.style.left = Math.max(12, Math.min(innerWidth - mw - 12, r.right - mw)) + scrollX + "px";
  }
  function closeMenu() { if (menu) { menu.remove(); menu = null; } }
  function askPermission() {
    if (!("Notification" in window)) return;
    if (Notification.permission === "default") try { Notification.requestPermission().then(function () { syncNotify(); }); } catch (e) {}
    syncNotify();
  }
  function syncNotify() { $("sc-notify").hidden = !("Notification" in window) || Notification.permission !== "denied" || !Object.keys(alarms).length; }
  function notify(text, sub, asset) {
    var box = $("sc-toasts"), card = el("a", "toast"); card.href = "flow?asset=" + encodeURIComponent(asset);
    card.appendChild(el("b", "", "🔔 " + text)); card.appendChild(el("span", "", sub));
    box.prepend(card); setTimeout(function () { card.classList.add("out"); setTimeout(function () { card.remove(); }, 400); }, 20000);
    while (box.children.length > 4) box.lastChild.remove();
    if ("Notification" in window && Notification.permission === "granted") try { var n = new Notification(text, { body: sub, tag: asset + text, icon: "/assets/icons/icon-192.png" }); n.onclick = function () { window.focus(); location.href = "flow?asset=" + encodeURIComponent(asset); }; } catch (e) {}
  }
  // Each alarmed asset/timeframe remembers the zone the price was last in; a change rings once.
  function checkAlarms(a) {
    var p = prices[a]; if (!(p > 0)) return;
    Object.keys(alarms).forEach(function (key) {
      var parts = key.split("|"); if (parts[0] !== a) return;
      var zones = zonesBy[parts[1]] && zonesBy[parts[1]][a]; if (!zones) return;
      var st = state(p, zones), now = st.inside, prev = last[key], al = alarms[key], t = w(), tfL = parts[1].toUpperCase();
      last[key] = now;
      function zk(z) { return z ? z.low + "-" + z.high : ""; }
      if (prev === undefined || zk(prev) === zk(now)) return;
      if (prev && al.exit) notify(fill(t.left, { asset: MarketUI.baseOf(a), type: prev.type === "support" ? t.support : t.resistance }), price(prev.low) + " – " + price(prev.high) + " · " + fill(t.priceNow, { p: price(p) }) + " · " + tfL, a);
      if (now && al.enter) notify(fill(t.entered, { asset: MarketUI.baseOf(a), type: now.type === "support" ? t.support : t.resistance }), price(now.low) + " – " + price(now.high) + " · " + fill(t.priceNow, { p: price(p) }) + " · " + tfL, a);
    });
  }

  // ─── Big trades (Binance aggTrade for every USDT asset) ──────────────────
  var BIG_URLS = ["wss://data-stream.binance.vision/stream?streams=", "wss://stream.binance.com:9443/stream?streams="];
  var big = [], bigMult = 10, stats = {}, pend = {}, bigWs = null, bigUrl = 0, bigRetry = 0, bigGot = false;
  function bigStart(list) {
    var syms = list.filter(function (a) { return /USDT$/.test(a); }); if (!syms.length || (FUT && futSrc !== "binance")) return;
    var streams = syms.map(function (a) { return a.toLowerCase() + "@aggTrade"; }), ws;
    // Futures: Binance USD-M serves aggTrade on /market (subscribed after opening); spot: a combined-stream URL.
    var url = FUT ? "wss://fstream.binance.com/market/ws" : BIG_URLS[bigUrl % BIG_URLS.length] + streams.join("/");
    try { ws = new WebSocket(url); } catch (e) { return; }
    bigWs = ws; var got = false;
    if (FUT) ws.onopen = function () { ws.send(JSON.stringify({ method: "SUBSCRIBE", params: streams, id: 2 })); };
    ws.onmessage = function (e) { var m; try { m = JSON.parse(e.data); } catch (_) { return; } var d = m && (m.data || m); if (d && d.e === "aggTrade") { got = bigGot = true; bigRetry = 0; onAgg(d); } };
    ws.onclose = function () { if (bigWs !== ws) return; bigWs = null; if (FUT && futSrc !== "binance") return; if (!got) bigUrl++; if (!bigGot && bigUrl >= BIG_URLS.length * 2) { $("sc-big-wait").textContent = w().bigOff; return; } setTimeout(function () { bigStart(list); }, Math.min(30000, 1000 * Math.pow(2, bigRetry++))); };
    ws.onerror = function () {};
  }
  // aggTrades of one taker order share the time and side: they are added up into one print first.
  function onAgg(d) {
    var s = d.s, buy = !d.m, q = +d.q, p = +d.p, cur = pend[s];
    if (cur && (cur.T !== d.T || cur.buy !== buy)) { flush(s); cur = null; }
    if (!cur) { cur = pend[s] = { s: s, T: d.T, buy: buy, q: 0, n: 0, p: p, at: Date.now() }; setTimeout(function () { if (pend[s] === cur) flush(s); }, 250); }
    cur.q += q; cur.n += q * p; cur.p = p;
  }
  function flush(s) {
    var o = pend[s]; delete pend[s]; if (!o) return;
    var st = stats[s] || (stats[s] = { buf: [], sum: 0 });
    var avg = st.buf.length ? st.sum / st.buf.length : 0, warm = st.buf.length >= 50;
    st.buf.push(o.q); st.sum += o.q; if (st.buf.length > 500) st.sum -= st.buf.shift();
    if (warm && o.q >= avg * 5 && o.n >= 10000) { o.x = o.q / avg; big.unshift(o); if (big.length > 200) big.pop(); bigDirty = true; }
  }
  var bigDirty = true;
  function renderBig() {
    if (!bigDirty) return; bigDirty = false;
    var t = w(), box = $("sc-big"), list = big.filter(function (o) { return o.x >= bigMult; }).slice(0, 20);
    box.textContent = "";
    $("sc-big-wait").hidden = list.length > 0;
    list.forEach(function (o) {
      var a = el("a", o.x >= bigMult * 3 ? "huge" : ""); a.href = "flow?asset=" + encodeURIComponent(o.s);
      var d = new Date(o.T); a.appendChild(el("span", "num muted", String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0") + ":" + String(d.getSeconds()).padStart(2, "0")));
      a.appendChild(el("b", "", MarketUI.baseOf(o.s)));
      a.appendChild(el("span", "num " + (o.buy ? "up" : "down"), (o.buy ? t.buy : t.sell) + " " + price(o.p)));
      a.appendChild(el("span", "num r", o.n.toLocaleString(locale(), { notation: "compact", maximumFractionDigits: o.n >= 1e6 ? 2 : 0 }) + " $"));
      a.appendChild(el("span", "num r muted", nf(o.x, 0) + "×"));
      box.appendChild(a);
    });
  }

  // ─── Page ────────────────────────────────────────────────────────────────
  function applyWords() {
    var t = w();
    document.querySelectorAll("[data-sc]").forEach(function (e) { var v = t[e.dataset.sc]; if (typeof v === "string") e.textContent = v; });
    document.title = "MarketLevelMap — " + t.title;
    buildHead(); syncSrc();
    dirty = bigDirty = true; if (assets.length) { render(); renderBig(); }
  }
  function gate(user) {
    var t = w(), msg = $("sc-gate-msg"), link = $("sc-gate-link");
    $("sc-gate").hidden = false;
    if (!user) { msg.dataset.sc = "gateGuest"; link.dataset.sc = "signIn"; link.href = "/api/auth/google/start?return=" + encodeURIComponent(location.pathname + location.search); }
    else { msg.dataset.sc = "gateMember"; link.dataset.sc = "profile"; link.href = "/account"; }
    msg.textContent = t[msg.dataset.sc]; link.textContent = t[link.dataset.sc];
  }
  function setTf(next) {
    tf = next; dirty = true;
    $("sc-tf").querySelectorAll("button").forEach(function (b) { b.setAttribute("aria-pressed", String(b.dataset.tf === tf)); });
    try { localStorage.setItem("mlm-scanner-tf", tf); } catch (e) {}
    loadTf(tf).then(function () { dirty = true; render(); }); render();
  }
  // Table head: spot shows the position bar and nearest zones; futures shows funding, OI, OI 1h and liquidations
  // (sortable by clicking; clicking again returns to the zone order).
  function buildHead() {
    var t = w(), tr = $("sc-head-row"); if (!tr) return; tr.textContent = "";
    function th(text, cls, key) {
      var c = el("th", cls || ""); if (!key) { c.textContent = text; tr.appendChild(c); return; }
      var b = el("button", "sort" + (sortKey === key ? " on" : ""), text + (sortKey === key ? " ↓" : "")); b.type = "button"; b.title = fill(t.sortBy, { c: text });
      b.addEventListener("click", function () { sortKey = sortKey === key ? "" : key; buildHead(); dirty = true; render(); }); c.appendChild(b); tr.appendChild(c);
    }
    var bn = document.querySelector('[data-sc="byNear"]'); if (bn) bn.textContent = sortKey ? t.byCol : t.byNear;
    th(t.asset); th(t.price, "r"); th(t.status);
    if (FUT) { th(t.fFund, "r", "fr"); th(t.fOi, "r hide-m", "oi"); th(t.fOi1h, "r", "oi1h"); th(t.fLiq, "r", "liq"); }
    else { th(t.position, "hide-m"); th(t.res, "r hide-m"); th(t.sup, "r hide-m"); }
    th("");
  }
  function boot() {
    $("lang").addEventListener("change", function () { setTimeout(applyWords, 0); });
    applyWords();
    (window.MLMAccount ? MLMAccount.ready : Promise.resolve(null)).then(function (user) {
      if (!(user && (user.status === "approved" || user.isAdmin))) { gate(user); return; }
      $("sc-app").hidden = false;
      $("sc-fnote").hidden = !FUT;
      $("sc-market").querySelectorAll("button").forEach(function (b) { b.setAttribute("aria-pressed", String(b.dataset.m === MARKET)); b.addEventListener("click", function () { if (b.dataset.m !== MARKET) location.search = b.dataset.m === "futures" ? "?market=futures" : ""; }); });
      fetch("/api/publication", { cache: "no-store" }).then(function (r) { return r.ok ? r.json() : null; }).then(function (body) {
        ((body && body.entries) || []).forEach(function (e) {
          if (MarketUI.methodOf(e) !== "cz" || !e.report) return;
          var a = MarketUI.assetOf(e), f = MarketUI.timeframeOf(e).toLowerCase(); if (!/^[A-Z0-9]{2,20}$/.test(a) || TF_ORDER.indexOf(f) < 0) return;
          (entries[a] || (entries[a] = {}))[f] = e;
        });
        assets = Object.keys(entries).sort(MarketUI.byPopularity);
        var tfs = TF_ORDER.filter(function (f) { return assets.some(function (a) { return entries[a][f]; }); }), seg = $("sc-tf");
        seg.textContent = "";
        tfs.forEach(function (f) { var b = el("button", "", f.toUpperCase()); b.type = "button"; b.dataset.tf = f; seg.appendChild(b); });
        var saved; try { saved = localStorage.getItem("mlm-scanner-tf"); } catch (e) {}
        seg.addEventListener("click", function (e) { var b = e.target.closest("button[data-tf]"); if (b) setTf(b.dataset.tf); });
        setTf(tfs.indexOf(saved) > -1 ? saved : tfs.indexOf("1d") > -1 ? "1d" : tfs[0] || "1d");
        Object.keys(alarms).forEach(function (k) { var f = k.split("|")[1]; if (TF_ORDER.indexOf(f) > -1) loadTf(f); });
        if (assets.length) MarketFeed.start(assets, { background: true, onData: function (sym, d) { var p = Number(d.c); if (!(p > 0)) return; prices[sym] = p; if (Number(d.o) > 0) opens[sym] = Number(d.o); dirty = true; checkAlarms(sym); } });
        bigStart(assets); if (FUT) futStart(assets);
        syncNotify();
      });
      $("sc-rows").addEventListener("click", function (e) { var b = e.target.closest("button.bell"); if (b) { e.stopPropagation(); openMenu(b); } });
      document.addEventListener("click", function (e) { if (menu && !menu.contains(e.target)) closeMenu(); });
      document.addEventListener("keydown", function (e) { if (e.key === "Escape") closeMenu(); });
      $("sc-mult").addEventListener("click", function (e) { var b = e.target.closest("button[data-x]"); if (!b) return; bigMult = +b.dataset.x; this.querySelectorAll("button").forEach(function (x) { x.setAttribute("aria-pressed", String(x === b)); }); bigDirty = true; renderBig(); });
      setInterval(function () { if (document.hidden) return; render(); renderBig(); }, 500);
    });
  }
  window.MLMScanner = { _state: function () { return { futSrc: futSrc, fut: fut, liqAll: liqAll, market: MARKET, assets: assets, prices: prices, zonesBy: zonesBy, alarms: alarms, big: big, stats: stats, tf: tf }; }, _check: checkAlarms };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();
})();
