/* Market context (README "Market context"): crypto (BTC, ETH and USDT dominance, total market cap, ETH/BTC), macro
   (DXY, US 10-year yield, S&P 500 and Nasdaq 100 futures) and commodities (gold and silver spot) from
   /api/market-context, refreshed every 3 minutes while shown. Any element with data-mctx="card" (analysis page) or "panel"
   (live flow) is filled. The live flow turns its panel on and off with
   MLMContext.setActive(on): a hidden panel asks for nothing. Public; the data is general market information. */
(function () {
  "use strict";
  var W = {
    en: { gCrypto: "Crypto", gMacro: "Macro", gMetal: "Commodities", delayedG: "delayed ~15 min",
      btcDom: "BTC dominance", ethDom: "ETH dominance", usdtDom: "USDT dominance", total: "Total crypto market cap", ethbtc: "ETH/BTC",
      dxy: "US dollar index (DXY)", us10y: "US 10-year yield", spx: "S&P 500 futures", ndx: "Nasdaq 100 futures",
      gold: "Gold (spot, ounce)", silver: "Silver (spot, ounce)",
      pts: "pts", bp: "bp", noData: "no data", sources: "Sources and notes",
      src: "Dominance and market cap: {d}. ETH/BTC: {e}. DXY, yield and index futures: Yahoo Finance (delayed about 15 minutes; change against the previous close). Gold and silver spot: {m}; the day's change from the COMEX futures. Updated {t}.",
      domNote: "Dominance: the coin's share of the total crypto market cap; its change is in percentage points over 24 h. Yield change in basis points (bp)." },
    tr: { gCrypto: "Kripto", gMacro: "Makro", gMetal: "Emtia", delayedG: "~15 dk gecikmeli",
      btcDom: "BTC dominansı", ethDom: "ETH dominansı", usdtDom: "USDT dominansı", total: "Toplam kripto piyasa değeri", ethbtc: "ETH/BTC",
      dxy: "Dolar endeksi (DXY)", us10y: "ABD 10 yıllık tahvil faizi", spx: "S&P 500 vadeli", ndx: "Nasdaq 100 vadeli",
      gold: "Altın (spot, ons)", silver: "Gümüş (spot, ons)",
      pts: "puan", bp: "bp", noData: "veri yok", sources: "Kaynaklar ve notlar",
      src: "Dominans ve piyasa değeri: {d}. ETH/BTC: {e}. DXY, faiz ve endeks vadelileri: Yahoo Finance (yaklaşık 15 dakika gecikmeli; değişim önceki kapanışa göre). Altın ve gümüş spot: {m}; günlük değişim COMEX vadelisinden. Güncelleme {t}.",
      domNote: "Dominans: varlığın toplam kripto piyasa değerindeki payı; değişimi 24 saatte yüzde puan olarak. Faiz değişimi baz puan (bp) olarak." }
  };
  var LIB = { dxy: ["dolar-endeksi", "dollar-index"] };
  function lang() { var s = document.getElementById("lang"); return s && s.value === "tr" ? "tr" : "en"; }
  function w() { return W[lang()]; }
  function loc() { return lang() === "tr" ? "tr-TR" : "en-US"; }
  function nf(v, d) { return Number(v).toLocaleString(loc(), { minimumFractionDigits: d, maximumFractionDigits: d }); }
  function pct(v, d) { var s = nf(Math.abs(v), d); return lang() === "tr" ? "%" + s : s + "%"; }
  function signed(v, d, asPct) { if (v == null || !isFinite(v)) return ""; var z = Math.abs(v) < 0.5 * Math.pow(10, -d); return (z ? "" : v > 0 ? "+" : "−") + (asPct ? pct(v, d) : nf(Math.abs(v), d)); }
  function compact(v) { return Number(v).toLocaleString(loc(), { notation: "compact", maximumFractionDigits: 2 }) + " $"; }
  var notesOpen = null, data = null, timer = null, active = { page: false, panel: false };

  function items() {
    var t = w(), d = data || {}, out = [];
    function dom(k, x, g) { out.push({ g: g, k: k, label: t[k], value: x && x.value != null ? pct(x.value, 2) : null, chg: x && x.change != null ? signed(x.change, 2) + " " + t.pts : "", dir: x ? x.change : null }); }
    function px(k, x, dec, g) { out.push({ g: g, k: k, label: t[k], value: x && x.price ? nf(x.price, dec) : null, chg: x && x.change != null ? signed(x.change, 2, true) : "", dir: x ? x.change : null }); }
    dom("btcDom", d.btcDominance, "gCrypto"); dom("ethDom", d.ethDominance, "gCrypto"); dom("usdtDom", d.usdtDominance, "gCrypto");
    out.push({ g: "gCrypto", k: "total", label: t.total, value: d.total && d.total.usd ? compact(d.total.usd) : null, chg: d.total && d.total.change != null ? signed(d.total.change, 2, true) : "", dir: d.total ? d.total.change : null });
    px("ethbtc", d.ethbtc, 5, "gCrypto");
    px("dxy", d.dxy, 2, "gMacro");
    var y = d.us10y; out.push({ g: "gMacro", k: "us10y", label: t.us10y, value: y && y.value != null ? pct(y.value, 2) : null, chg: y && y.changeBp != null ? signed(y.changeBp, 1) + " " + t.bp : "", dir: y ? y.changeBp : null });
    px("spx", d.spx, 2, "gMacro"); px("ndx", d.ndx, 2, "gMacro");
    px("gold", d.gold, 2, "gMetal"); px("silver", d.silver, 2, "gMetal");
    return out;
  }
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function render() {
    var t = w(), list = items();
    document.querySelectorAll("[data-mctx]").forEach(function (box) {
      box.textContent = "";
      if (!data) { box.appendChild(el("span", "mctx-wait", "…")); return; }
      var group = null;
      list.forEach(function (it) {
        if (it.g !== group) {
          group = it.g; var h = el("p", "mctx-g", t[group]);
          if (group === "gMacro") h.appendChild(el("small", "mctx-gn", " · " + t.delayedG));
          box.appendChild(h);
        }
        var row = el("div", "mctx-item");
        var lab = LIB[it.k] ? el("a", "mctx-l", it.label) : el("span", "mctx-l", it.label);
        if (lab.tagName === "A") lab.href = (lang() === "tr" ? "/tr/kutuphane/" : "/en/library/") + LIB[it.k][lang() === "tr" ? 0 : 1] + "/";
        row.appendChild(lab);
        row.appendChild(el("b", "mctx-v num", it.value == null ? t.noData : it.value));
        if (it.chg) row.appendChild(el("span", "mctx-c num " + (it.dir > 0 ? "up" : it.dir < 0 ? "down" : ""), it.chg));
        box.appendChild(row);
      });
      // The live flow panel keeps the notes behind a "Sources" toggle so all rows fit a 1×1 panel.
      var at = data.at ? new Date(data.at) : null, notes = box;
      if (box.dataset.mctx === "panel") {
        // Open by default when the panel is tall (1×2); a reader's own toggle is kept across refreshes.
        box.classList.toggle("tall", box.clientHeight >= 500);
        var sum = el("summary", null, t.sources), d = notes = el("details"); d.appendChild(sum); box.appendChild(d);
        d.open = notesOpen != null ? notesOpen : box.classList.contains("tall");
        sum.addEventListener("click", function () { notesOpen = !d.open; });
      }
      notes.appendChild(el("p", "mctx-src", t.domNote));
      notes.appendChild(el("p", "mctx-src", t.src.replace("{d}", data.domSource || "—").replace("{e}", data.ethSource || "—").replace("{m}", data.metalSource || "—").replace("{t}", at ? at.toLocaleTimeString(loc(), { hour: "2-digit", minute: "2-digit" }) : "—")));
    });
  }
  // The browser asks CoinGecko itself, from the visitor's own address (CoinGecko and CoinPaprika rate-limit shared server
  // addresses), and works out the same dominance figures as the endpoint.
  function n(x) { var v = Number(x); return isFinite(v) ? v : null; }
  function fromBrowser(b) {
    return Promise.all([
      fetch("https://api.coingecko.com/api/v3/global").then(function (r) { return r.ok ? r.json() : null; }),
      fetch("https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum,tether&vs_currencies=usd&include_market_cap=true&include_24hr_change=true").then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; })
    ]).then(function (res) {
      var d = res[0] && res[0].data, s2 = res[1]; if (!d || !d.total_market_cap) return b;
      var total = n(d.total_market_cap.usd), tc = n(d.market_cap_change_percentage_24h_usd), pc = d.market_cap_percentage || {};
      function dom(key, id) {
        var v = n(pc[key]), c = s2 && s2[id] ? n(s2[id].usd_24h_change) : null, cap = s2 && s2[id] ? n(s2[id].usd_market_cap) : null, ch = null;
        if (v != null && c != null && cap && total && tc != null) ch = v - (cap / (1 + c / 100)) / (total / (1 + tc / 100)) * 100;
        return { value: v, change: ch };
      }
      b.total = { usd: total, change: tc }; b.btcDominance = dom("btc", "bitcoin"); b.ethDominance = dom("eth", "ethereum"); b.usdtDominance = dom("usdt", "tether"); b.domSource = "CoinGecko";
      return b;
    }).catch(function () { return b; }).then(function (b2) { return b2.btcDominance && b2.btcDominance.value != null ? b2 : fromCoinLore(b2); });
  }
  // Second browser fallback: CoinLore (free, no key).
  function fromCoinLore(b) {
    return Promise.all([
      fetch("https://api.coinlore.net/api/global/").then(function (r) { return r.ok ? r.json() : null; }),
      fetch("https://api.coinlore.net/api/ticker/?id=90,80,518").then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; })
    ]).then(function (res) {
      var g = Array.isArray(res[0]) ? res[0][0] : res[0], total = n(g && g.total_mcap), tc = n(g && g.mcap_change); if (!total) return b;
      var by = {}; (Array.isArray(res[1]) ? res[1] : []).forEach(function (x) { by[x.symbol] = x; });
      function dom(sym) {
        var x = by[sym], cap = x ? n(x.market_cap_usd) : null, c = x ? n(x.percent_change_24h) : null;
        if (!cap) return { value: sym === "BTC" ? n(g.btc_d) : null, change: null };
        var v = cap / total * 100; return { value: v, change: c != null && tc != null ? v - (cap / (1 + c / 100)) / (total / (1 + tc / 100)) * 100 : null };
      }
      b.total = { usd: total, change: tc }; b.btcDominance = dom("BTC"); b.ethDominance = dom("ETH"); b.usdtDominance = dom("USDT"); b.btcDominance.change = null; b.ethDominance.change = null; b.usdtDominance.change = null; b.domSource = "CoinLore";
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
  // Gold and silver spot when the endpoint has none: gold-api.com from the browser (no day's change then).
  function metalsFromBrowser(b) {
    if ((b.gold && b.gold.price) || (b.silver && b.silver.price)) return Promise.resolve(b);
    function one(sym) { return fetch("https://api.gold-api.com/price/" + sym).then(function (r) { return r.ok ? r.json() : null; }).then(function (g) { var p = g && n(g.price); return p ? { price: p, change: null } : null; }).catch(function () { return null; }); }
    return Promise.all([one("XAU"), one("XAG")]).then(function (r) { b.gold = r[0]; b.silver = r[1]; if (r[0] || r[1]) b.metalSource = "gold-api.com"; return b; });
  }
  function load() {
    fetch("/api/market-context", { cache: "no-store" }).then(function (r) { return r.ok ? r.json() : null; }).then(function (b) {
      if (!b) return null;
      // The browser asks CoinGecko first (the visitor's own address is not rate-limited like the edge); the endpoint's
      // figures (CoinGecko, CoinPaprika or CoinLore) stay when it cannot.
      var kept = { total: b.total, btcDominance: b.btcDominance, ethDominance: b.ethDominance, usdtDominance: b.usdtDominance, domSource: b.domSource };
      return fromBrowser(b).then(function (r) { if (r.domSource !== "CoinGecko" && kept.btcDominance && kept.btcDominance.value != null) { for (var k in kept) r[k] = kept[k]; } return r; }).then(ethFromBrowser).then(metalsFromBrowser);
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
  window.MLMContext = { setActive: function (on) { active.panel = !!on; sync(); if (on && data) render(); }, _state: function () { return { data: data, timer: !!timer, active: active }; } };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();
})();
