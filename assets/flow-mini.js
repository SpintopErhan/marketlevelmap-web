/* Flow summary on the analysis page (README "Flow summary"). Members only, USDT assets only, not in the admin desk
   embed. A small live card at the top of the side column: last 5 min buy/sell share and CVD (spot trades), funding,
   basis and liquidations (USDT perpetual), open interest 1 h change. One venue at a time, chosen on the card and
   remembered in this browser: Binance (spot aggTrade; USD-M markPrice and forceOrder; openInterestHist) or OKX (one
   socket: spot trades, funding-rate, mark-price, index-tickers, liquidation-orders; rubik open-interest history).
   Read in the browser; nothing is stored. The full picture is on the live flow page, linked from the card. */
(function () {
  "use strict";
  var W = {
    en: { title: "Flow summary", sub: "live · {venue} · since the page opened", open: "Open live flow →", bs5: "Last 5 min buy/sell", cvd: "CVD (session)",
      fund: "Funding", basis: "Basis (perp − index)", oi1h: "Open interest 1 h", liq: "Liquidations 15 min", read: "Last 5 min: price {p}, CVD {c}", wait: "Collecting the first minutes…" },
    tr: { title: "Akış özeti", sub: "canlı · {venue} · sayfa açıldığından beri", open: "Canlı akışı aç →", bs5: "Son 5 dk alış/satış", cvd: "CVD (oturum)",
      fund: "Fonlama", basis: "Baz (perp − endeks)", oi1h: "Açık pozisyon 1 sa", liq: "Likidasyon 15 dk", read: "Son 5 dk: fiyat {p}, CVD {c}", wait: "İlk dakikalar toplanıyor…" }
  };
  function $(id) { return document.getElementById(id); }
  function lang() { var s = $("lang"); return s && s.value === "tr" ? "tr" : "en"; }
  function w() { return W[lang()]; }
  function fill(t, o) { return String(t).replace(/\{(\w+)\}/g, function (_, k) { return o[k] == null ? "" : o[k]; }); }
  function locale() { return window.MarketUI ? MarketUI.locale() : "en-US"; }
  function nf(v, d) { return Number(v).toLocaleString(locale(), { minimumFractionDigits: d, maximumFractionDigits: d }); }
  function pct(r, d) { var s = nf(Math.abs(r) * 100, d); return lang() === "tr" ? "%" + s : s + "%"; }
  function sp(r, d) { var z = Math.abs(r) * 100 < 0.5 * Math.pow(10, -d); return (z ? "" : r > 0 ? "+" : "−") + pct(r, d); }
  function money(v) { return v > 0 ? v.toLocaleString(locale(), { notation: "compact", maximumFractionDigits: v >= 1e6 ? 2 : 0 }) + " $" : "0 $"; }
  function size(q) { var a = Math.abs(q); return nf(q, a >= 1000 ? 0 : a >= 100 ? 1 : a >= 1 ? 2 : 4); }

  var sym = "", base = "", trades = [], cvd = 0, f = {}, liqs = [], box = null, venue = "binance", run = 0, socks = [], timers = [];
  try { if (localStorage.getItem("mlm-fm-venue") === "okx") venue = "okx"; } catch (e) {}
  // open(urls, onmsg, onopen): a socket that reconnects until the venue changes (run counter).
  function open(urls, onmsg, onopen) {
    var i = 0, retry = 0, my = run;
    (function go() {
      if (my !== run) return;
      var ws, got = false; try { ws = new WebSocket(urls[i % urls.length]); } catch (e) { return; }
      socks.push(ws);
      ws.onopen = function () { if (onopen) onopen(ws); };
      ws.onmessage = function (e) { if (my !== run) return; got = true; retry = 0; if (e.data === "pong") return; var m; try { m = JSON.parse(e.data); } catch (_) { return; } onmsg(m.data && !m.arg ? m.data : m); };
      ws.onclose = function () { if (my !== run) return; if (!got) i++; timers.push(setTimeout(go, Math.min(30000, 1000 * Math.pow(2, retry++)))); };
    })();
  }
  function stop() {
    run++; timers.forEach(function (x) { clearTimeout(x); clearInterval(x); }); timers = [];
    socks.forEach(function (ws) { try { ws.close(); } catch (e) {} }); socks = [];
    trades = []; cvd = 0; f = {}; liqs = [];
  }
  function start() { stop(); if (venue === "okx") startOkx(); else startBinance(); timers.push(setInterval(render, 1000)); render(); }
  function startOkx() {
    var spot = base + "-USDT", swap = base + "-USDT-SWAP", my = run, ct = 0;
    function go() {
      open(["wss://ws.okx.com:8443/ws/v5/public"], function (m) {
        if (!m.arg || !Array.isArray(m.data)) return;
        var ch = m.arg.channel;
        if (ch === "trades") m.data.forEach(function (d) { var q = +d.sz, p = +d.px; if (q > 0 && p > 0) { trades.push({ t: Date.now(), q: q, buy: d.side === "buy", p: p }); cvd += d.side === "buy" ? q : -q; } });
        else if (ch === "funding-rate") m.data.forEach(function (d) { f.fr = +d.fundingRate; });
        else if (ch === "mark-price") m.data.forEach(function (d) { f.mark = +d.markPx; });
        else if (ch === "index-tickers") m.data.forEach(function (d) { f.index = +d.idxPx; });
        else if (ch === "liquidation-orders") m.data.forEach(function (it) {
          if (it.instId !== swap) return;
          (it.details || []).forEach(function (d) { var pr = +d.bkPx, q = +d.sz * ct; if (pr > 0 && q > 0) liqs.push({ t: Date.now(), long: d.posSide === "long" || (d.posSide !== "short" && d.side === "sell"), n: pr * q }); });
        });
        if (trades.length > 20000) trades.splice(0, 5000);
      }, function (ws) {
        ws.send(JSON.stringify({ op: "subscribe", args: [{ channel: "trades", instId: spot }, { channel: "funding-rate", instId: swap }, { channel: "mark-price", instId: swap }, { channel: "index-tickers", instId: spot }, { channel: "liquidation-orders", instType: "SWAP" }] }));
        timers.push(setInterval(function () { try { ws.send("ping"); } catch (e) {} }, 20000));
      });
    }
    // Liquidation sizes are in contracts: read the contract value first (liquidations stay empty without it).
    fetch("https://www.okx.com/api/v5/public/instruments?instType=SWAP&instId=" + swap, { cache: "no-store" }).then(function (r) { return r.ok ? r.json() : null; }).then(function (b) {
      var v = b && b.data && b.data[0] && Number(b.data[0].ctVal); if (v > 0) ct = v;
    }).catch(function () {}).then(function () { if (my === run) go(); });
    function oi() {
      fetch("https://www.okx.com/api/v5/rubik/stat/contracts/open-interest-volume?ccy=" + base + "&period=5m", { cache: "no-store" }).then(function (r) { return r.ok ? r.json() : null; }).then(function (b) {
        if (my !== run || !b || !Array.isArray(b.data) || b.data.length < 13) return;
        var l = b.data.slice().sort(function (a, c) { return +a[0] - +c[0]; }), last = +l[l.length - 1][1], first = +l[l.length - 13][1];
        f.oi1h = first > 0 ? last / first - 1 : null;
      }).catch(function () {});
    }
    oi(); timers.push(setInterval(oi, 300000));
  }
  function startBinance() {
    var s = sym.toLowerCase();
    open(["wss://data-stream.binance.vision/ws/" + s + "@aggTrade", "wss://stream.binance.com:9443/ws/" + s + "@aggTrade"], function (d) {
      if (d.e !== "aggTrade") return; var q = +d.q, p = +d.p; if (!(q > 0 && p > 0)) return;
      trades.push({ t: Date.now(), q: q, buy: !d.m, p: p }); cvd += d.m ? -q : q;
      if (trades.length > 20000) trades.splice(0, 5000);
    });
    open(["wss://fstream.binance.com/market/ws"], function (d) {
      if (d.e === "markPriceUpdate") { f.fr = +d.r; f.mark = +d.p; f.index = +d.i; }
      else if (d.e === "forceOrder" && d.o) { var pr = +d.o.ap || +d.o.p, q = +d.o.z || +d.o.q; if (pr > 0 && q > 0) liqs.push({ t: Date.now(), long: d.o.S === "SELL", n: pr * q }); }
    }, function (ws) { ws.send(JSON.stringify({ method: "SUBSCRIBE", params: [s + "@markPrice@1s", s + "@forceOrder"], id: 1 })); });
    function oi() {
      fetch("https://fapi.binance.com/futures/data/openInterestHist?symbol=" + sym + "&period=5m&limit=13", { cache: "no-store" }).then(function (r) { return r.ok ? r.json() : null; }).then(function (l) {
        if (!Array.isArray(l) || l.length < 2) return; l.sort(function (a, b) { return a.timestamp - b.timestamp; });
        if (+l[0].sumOpenInterest > 0) { f.oi1h = +l[l.length - 1].sumOpenInterest / +l[0].sumOpenInterest - 1; histOk = true; }
      }).catch(function () {});
    }
    // Fallback when the history does not answer: this page's own minute samples of /fapi/v1/openInterest.
    var histOk = false, smp = [], my = run;
    function oiNow() {
      fetch("https://fapi.binance.com/fapi/v1/openInterest?symbol=" + sym, { cache: "no-store" }).then(function (r) { return r.ok ? r.json() : null; }).then(function (b) {
        if (my !== run || histOk || !b || !(+b.openInterest > 0)) return;
        var now = Date.now(); smp.push({ t: now, oi: +b.openInterest }); while (smp.length && smp[0].t < now - 3900000) smp.shift();
        if (smp.length > 1) { var ref = smp.filter(function (x) { return x.t <= now - 3600000; }).pop() || smp[0]; f.oi1h = smp[smp.length - 1].oi / ref.oi - 1; }
      }).catch(function () {});
    }
    oi(); oiNow(); timers.push(setInterval(oi, 300000)); timers.push(setInterval(oiNow, 60000));
  }
  function set(id, text, cls) { var e = $(id); if (!e) return; e.textContent = text; e.className = "num" + (cls ? " " + cls : ""); }
  function render() {
    if (document.hidden || !box) return;
    var t = w(), now = Date.now(), bv = 0, sv = 0, first = null, cvd5 = 0;
    trades.forEach(function (x) { if (x.t > now - 300000) { if (!first) first = x; if (x.buy) bv += x.q; else sv += x.q; cvd5 += x.buy ? x.q : -x.q; } });
    var tot = bv + sv, last = trades[trades.length - 1];
    set("fm-bs", tot ? pct(bv / tot, 0) + " / " + pct(sv / tot, 0) : "—");
    set("fm-cvd", trades.length ? (cvd >= 0 ? "+" : "−") + size(Math.abs(cvd)) + " " + base : "—", cvd > 0 ? "up" : cvd < 0 ? "down" : "");
    set("fm-fund", f.fr != null ? sp(f.fr, 4) : "—", f.fr > 0 ? "up" : f.fr < 0 ? "down" : "");
    set("fm-basis", f.mark > 0 && f.index > 0 ? sp(f.mark / f.index - 1, 3) : "—");
    set("fm-oi", f.oi1h != null ? sp(f.oi1h, 1) : "—", f.oi1h > 0 ? "up" : f.oi1h < 0 ? "down" : "");
    var L = 0, S = 0; liqs.forEach(function (x) { if (x.t > now - 900000) { if (x.long) L += x.n; else S += x.n; } });
    set("fm-liq", "L " + money(L) + " · S " + money(S));
    var read = $("fm-read");
    read.textContent = first && last && now - trades[0].t > 60000 ? fill(t.read, { p: sp(last.p / first.p - 1, 2), c: cvd5 >= 0 ? "+" : "−" }) : t.wait;
  }
  function words() {
    if (!box) return; var t = w();
    box.querySelectorAll("[data-fm]").forEach(function (e) { e.textContent = fill(t[e.dataset.fm], { venue: venue === "okx" ? "OKX" : "Binance" }); });
    box.querySelectorAll("#fm-venue button").forEach(function (b) { b.setAttribute("aria-pressed", String(b.dataset.v === venue)); });
    render();
  }
  function boot() {
    box = $("flowmini-block"); if (!box || document.documentElement.classList.contains("embed")) return;
    var q = new URLSearchParams(location.search), a = String(q.get("asset") || "BTCUSDT").toUpperCase(), m = /^([A-Z0-9]{2,15})USDT$/.exec(a);
    if (!m) return; sym = a; base = m[1];
    (window.MLMAccount ? MLMAccount.ready : Promise.resolve(null)).then(function (user) {
      if (!(user && (user.status === "approved" || user.isAdmin))) return;
      $("fm-link").href = "flow?asset=" + encodeURIComponent(sym);
      box.hidden = false; words(); start();
      $("fm-venue").addEventListener("click", function (e) {
        var b = e.target.closest("button[data-v]"); if (!b || b.dataset.v === venue) return;
        venue = b.dataset.v; try { localStorage.setItem("mlm-fm-venue", venue); } catch (_) {}
        words(); start();
      });
      var l = $("lang"); if (l) l.addEventListener("change", function () { setTimeout(words, 0); });
    });
  }
  window.MLMFlowMini = { _state: function () { return { venue: venue, trades: trades.length, f: f, liqs: liqs.length, socks: socks.filter(function (x) { return x.readyState < 2; }).map(function (x) { return x.url; }) }; } };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();
})();
