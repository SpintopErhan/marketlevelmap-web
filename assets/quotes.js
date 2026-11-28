/* Live figures for pages without the market table (README "Market map page"): window.MLMQuotes, the same shape the
   home page's table provides: { order, get(sym) → { price, volume, live, day, week, month, ath } }, and a
   "mlm-quotes" event on each change. Every asset of the candle index (MarketUI.catalog()); crypto from MarketFeed,
   tokenized stocks from OnchainFeed; opens from the feed, else the DO / WO / MO key levels of levels.json, which also
   gives the ATH. Does nothing when a page already provides MLMQuotes. Needs MarketUI, MarketFeed, OnchainFeed. */
(function () {
  "use strict";
  if (window.MLMQuotes) return;
  var data = {}, keys = {}, order = [];
  var Q = window.MLMQuotes = {
    order: order,
    get: function (sym) {
      var d = data[sym]; if (!d || !(Number(d.c) > 0)) return null;
      var key = keys[sym] || {};
      function open(f, code) { var v = Number(d[f]) > 0 ? Number(d[f]) : Number(key[code]); return v > 0 ? v : null; }
      return { price: Number(d.c), volume: Number(d.q) > 0 ? Number(d.q) : 0, live: Number(d.o) > 0 ? Number(d.o) : null,
        day: open("day", "DO"), week: open("week", "WO"), month: open("month", "MO"), ath: Number(key.ATH) > 0 ? Number(key.ATH) : null };
    }
  };
  var timer = null;
  function changed() { if (!timer) timer = setTimeout(function () { timer = null; document.dispatchEvent(new Event("mlm-quotes")); }, 300); }
  MarketUI.catalog().then(function (cat) {
    Object.keys(cat || {}).filter(function (s) { return /^[A-Z0-9]{2,20}$/.test(s); }).sort(MarketUI.byPopularity).forEach(function (s) { order.push(s); });
    if (!order.length) return;
    order.forEach(function (sym) {
      fetch("https://data.marketlevelmap.com/candles/" + encodeURIComponent(sym) + "/levels.json").then(function (r) { return r.ok ? r.json() : null; }).then(function (f) {
        if (!f || f.pair !== sym || !f.keyLevels || !Array.isArray(f.keyLevels.levels)) return;
        var m = {}; f.keyLevels.levels.forEach(function (l) { if (l && l.code && Number(l.price) > 0) m[String(l.code).toUpperCase()] = Number(l.price); });
        keys[sym] = m; changed();
      }).catch(function () {});
    });
    function onData(sym, d) { data[sym] = d; changed(); }
    var crypto = order.filter(function (s) { return !MarketUI.isTokenized(s); }), stocks = order.filter(MarketUI.isTokenized);
    if (window.MarketFeed) MarketFeed.start(crypto, { onData: onData });
    if (stocks.length && window.OnchainFeed) OnchainFeed.start(stocks, { onData: onData });
    changed();
  }).catch(function () {});
  void Q;
})();
