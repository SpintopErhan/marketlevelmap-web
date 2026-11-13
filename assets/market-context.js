/* Market context (README "Market context"): BTC and USDT dominance, total crypto market cap, ETH/BTC and DXY from
   /api/market-context, refreshed every 3 minutes while shown. Any element with data-mctx="card" (analysis page) or "panel"
   (live flow) is filled. The live flow turns its panel on and off with
   MLMContext.setActive(on): a hidden panel asks for nothing. Public; the data is general market information. */
(function () {
  "use strict";
  var W = {
    en: { btcDom: "BTC dominance", usdtDom: "USDT dominance", total: "Total crypto market cap", ethbtc: "ETH/BTC", dxy: "US dollar index (DXY)",
      pts: "{v} pts", h24: "24 h", noData: "no data", delayed: "delayed ~15 min", src: "Dominance and market cap: {d}. ETH/BTC: {e}. DXY: Yahoo Finance (delayed about 15 minutes). Updated {t}.",
      domNote: "Dominance: the coin's share of the total crypto market cap; the change is in percentage points over 24 h." },
    tr: { btcDom: "BTC dominansı", usdtDom: "USDT dominansı", total: "Toplam kripto piyasa değeri", ethbtc: "ETH/BTC", dxy: "Dolar endeksi (DXY)",
      pts: "{v} puan", h24: "24 sa", noData: "veri yok", delayed: "~15 dk gecikmeli", src: "Dominans ve piyasa değeri: {d}. ETH/BTC: {e}. DXY: Yahoo Finance (yaklaşık 15 dakika gecikmeli). Güncelleme {t}.",
      domNote: "Dominans: varlığın toplam kripto piyasa değerindeki payı; değişim 24 saatte yüzde puan olarak." }
  };
  var LIB = { dxy: ["dolar-endeksi", "dollar-index"] };
  function lang() { var s = document.getElementById("lang"); return s && s.value === "tr" ? "tr" : "en"; }
  function w() { return W[lang()]; }
  function loc() { return lang() === "tr" ? "tr-TR" : "en-US"; }
  function nf(v, d) { return Number(v).toLocaleString(loc(), { minimumFractionDigits: d, maximumFractionDigits: d }); }
  function pct(v, d) { var s = nf(Math.abs(v), d); return lang() === "tr" ? "%" + s : s + "%"; }
  function signed(v, d, asPct) { if (v == null || !isFinite(v)) return ""; var z = Math.abs(v) < 0.5 * Math.pow(10, -d); return (z ? "" : v > 0 ? "+" : "−") + (asPct ? pct(v, d) : nf(Math.abs(v), d)); }
  function compact(v) { return Number(v).toLocaleString(loc(), { notation: "compact", maximumFractionDigits: 2 }) + " $"; }
  var data = null, timer = null, active = { page: false, panel: false };

  function items() {
    var t = w(), d = data || {}, out = [];
    var bd = d.btcDominance, ud = d.usdtDominance, tot = d.total, eb = d.ethbtc, dx = d.dxy;
    out.push({ k: "btcDom", label: t.btcDom, value: bd && bd.value != null ? pct(bd.value, 2) : null, chg: bd && bd.change != null ? signed(bd.change, 2) + " " + t.pts.replace("{v}", "").trim() : "", dir: bd ? bd.change : null, ptsRaw: bd && bd.change });
    out.push({ k: "ethbtc", label: t.ethbtc, value: eb && eb.price ? nf(eb.price, 5) : null, chg: eb && eb.change != null ? signed(eb.change, 2, true) : "", dir: eb ? eb.change : null });
    out.push({ k: "usdtDom", label: t.usdtDom, value: ud && ud.value != null ? pct(ud.value, 2) : null, chg: ud && ud.change != null ? signed(ud.change, 2) + " " + t.pts.replace("{v}", "").trim() : "", dir: ud ? ud.change : null });
    out.push({ k: "total", label: t.total, value: tot && tot.usd ? compact(tot.usd) : null, chg: tot && tot.change != null ? signed(tot.change, 2, true) : "", dir: tot ? tot.change : null });
    out.push({ k: "dxy", label: t.dxy, value: dx && dx.price ? nf(dx.price, 2) : null, chg: dx && dx.change != null ? signed(dx.change, 2, true) : "", dir: dx ? dx.change : null, note: t.delayed });
    return out;
  }
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function render() {
    var t = w(), list = items();
    document.querySelectorAll("[data-mctx]").forEach(function (box) {
      var mode = box.dataset.mctx; box.textContent = "";
      if (!data) { box.appendChild(el("span", "mctx-wait", "…")); return; }
      list.forEach(function (it) {
        var row = el(mode === "strip" ? "span" : "div", "mctx-item");
        var lab = LIB[it.k] && mode !== "strip" ? el("a", "mctx-l", it.label) : el("span", "mctx-l", it.label);
        if (lab.tagName === "A") lab.href = (lang() === "tr" ? "/tr/kutuphane/" : "/en/library/") + LIB[it.k][lang() === "tr" ? 0 : 1] + "/";
        row.appendChild(lab);
        row.appendChild(el("b", "mctx-v num", it.value == null ? t.noData : it.value));
        if (it.chg) row.appendChild(el("span", "mctx-c num " + (it.dir > 0 ? "up" : it.dir < 0 ? "down" : ""), it.chg));
        if (it.note && mode !== "strip") row.appendChild(el("small", "mctx-n", it.note));
        box.appendChild(row);
      });
      if (mode !== "strip") {
        var at = data.at ? new Date(data.at) : null;
        box.appendChild(el("p", "mctx-src", t.domNote));
        box.appendChild(el("p", "mctx-src", t.src.replace("{d}", data.domSource || "—").replace("{e}", data.ethSource || "—").replace("{t}", at ? at.toLocaleTimeString(loc(), { hour: "2-digit", minute: "2-digit" }) : "—")));
      }
    });
  }
  // The browser asks CoinGecko itself, from the visitor's own address (CoinGecko and CoinPaprika rate-limit shared server
  // addresses), and works out the same dominance figures as the endpoint.
  function n(x) { var v = Number(x); return isFinite(v) ? v : null; }
  function fromBrowser(b) {
    return Promise.all([
      fetch("https://api.coingecko.com/api/v3/global").then(function (r) { return r.ok ? r.json() : null; }),
      fetch("https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,tether&vs_currencies=usd&include_market_cap=true&include_24hr_change=true").then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; })
    ]).then(function (res) {
      var d = res[0] && res[0].data, s2 = res[1]; if (!d || !d.total_market_cap) return b;
      var total = n(d.total_market_cap.usd), tc = n(d.market_cap_change_percentage_24h_usd), pc = d.market_cap_percentage || {};
      function dom(key, id) {
        var v = n(pc[key]), c = s2 && s2[id] ? n(s2[id].usd_24h_change) : null, cap = s2 && s2[id] ? n(s2[id].usd_market_cap) : null, ch = null;
        if (v != null && c != null && cap && total && tc != null) ch = v - (cap / (1 + c / 100)) / (total / (1 + tc / 100)) * 100;
        return { value: v, change: ch };
      }
      b.total = { usd: total, change: tc }; b.btcDominance = dom("btc", "bitcoin"); b.usdtDominance = dom("usdt", "tether"); b.domSource = "CoinGecko";
      return b;
    }).catch(function () { return b; }).then(function (b2) { return b2.btcDominance && b2.btcDominance.value != null ? b2 : fromCoinLore(b2); });
  }
  // Second browser fallback: CoinLore (free, no key).
  function fromCoinLore(b) {
    return Promise.all([
      fetch("https://api.coinlore.net/api/global/").then(function (r) { return r.ok ? r.json() : null; }),
      fetch("https://api.coinlore.net/api/ticker/?id=90,518").then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; })
    ]).then(function (res) {
      var g = Array.isArray(res[0]) ? res[0][0] : res[0], total = n(g && g.total_mcap), tc = n(g && g.mcap_change); if (!total) return b;
      var by = {}; (Array.isArray(res[1]) ? res[1] : []).forEach(function (x) { by[x.symbol] = x; });
      function dom(sym) {
        var x = by[sym], cap = x ? n(x.market_cap_usd) : null, c = x ? n(x.percent_change_24h) : null;
        if (!cap) return { value: sym === "BTC" ? n(g.btc_d) : null, change: null };
        var v = cap / total * 100; return { value: v, change: c != null && tc != null ? v - (cap / (1 + c / 100)) / (total / (1 + tc / 100)) * 100 : null };
      }
      b.total = { usd: total, change: tc }; b.btcDominance = dom("BTC"); b.usdtDominance = dom("USDT"); b.btcDominance.change = null; b.usdtDominance.change = null; b.domSource = "CoinLore";
      return b;
    }).catch(function () { return b; });
  }
  // ETH/BTC when the endpoint has none: Binance from the browser (it refuses Cloudflare, not visitors), else Coinbase.
  function ethFromBrowser(b) {
    if (b.ethbtc && b.ethbtc.price) return Promise.resolve(b);
    return fetch("https://api.binance.com/api/v3/ticker/24hr?symbol=ETHBTC").then(function (r) { return r.ok ? r.json() : null; }).then(function (t) {
      var last = t && n(t.lastPrice), open = t && n(t.openPrice); if (!last) throw new Error("no");
      b.ethbtc = { price: last, change: open ? (last / open - 1) * 100 : null }; b.ethSource = "Binance"; return b;
    }).catch(function () {
      return fetch("https://api.exchange.coinbase.com/products/ETH-BTC/stats").then(function (r) { return r.ok ? r.json() : null; }).then(function (s) {
        var last = s && n(s.last), open = s && n(s.open);
        if (last) { b.ethbtc = { price: last, change: open ? (last / open - 1) * 100 : null }; b.ethSource = "Coinbase"; }
        return b;
      }).catch(function () { return b; });
    });
  }
  function load() {
    fetch("/api/market-context", { cache: "no-store" }).then(function (r) { return r.ok ? r.json() : null; }).then(function (b) {
      if (!b) return null;
      // The browser asks CoinGecko first (the visitor's own address is not rate-limited like the edge); the endpoint's
      // figures (CoinGecko, CoinPaprika or CoinLore) stay when it cannot.
      var kept = { total: b.total, btcDominance: b.btcDominance, usdtDominance: b.usdtDominance, domSource: b.domSource };
      return fromBrowser(b).then(function (r) { if (r.domSource !== "CoinGecko" && kept.btcDominance && kept.btcDominance.value != null) { r.total = kept.total; r.btcDominance = kept.btcDominance; r.usdtDominance = kept.usdtDominance; r.domSource = kept.domSource; } return r; }).then(ethFromBrowser);
    }).then(function (b) { if (b) { data = b; render(); } }).catch(function () {});
  }
  function sync() {
    var on = active.page || active.panel;
    if (on && !timer) { load(); timer = setInterval(function () { if (!document.hidden) load(); }, 180000); }
    else if (!on && timer) { clearInterval(timer); timer = null; }
  }
  function boot() {
    var boxes = document.querySelectorAll("[data-mctx]");
    // The analysis card starts at once; the live flow panel waits for setActive.
    active.page = [].some.call(boxes, function (b) { return b.dataset.mctx !== "panel"; });
    var l = document.getElementById("lang"); if (l) l.addEventListener("change", function () { setTimeout(render, 0); });
    new MutationObserver(function () { render(); }).observe(document.documentElement, { attributes: true, attributeFilter: ["lang"] });
    render(); sync();
  }
  window.MLMContext = { setActive: function (on) { active.panel = !!on; sync(); }, _state: function () { return { data: data, timer: !!timer, active: active }; } };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();
})();
