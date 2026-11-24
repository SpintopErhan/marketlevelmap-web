/* Live figures of the tokenized stocks (README "Tokenized stocks") for pages that list them next to the crypto feed
   (market table): /api/onchain-price every 30 seconds while the page is visible. Each answer is
   { c: price, o: open 24 h ago, h, l, q: 24 h USDC volume, quote: "USDC", source: "pool"|"candle", priceAt, candleAt },
   the same field names MarketFeed uses, so the page draws both the same way.
   OnchainFeed.start(["NVDACUSDC"], { onData: function (symbol, d) {} }) → { stop: function () {} } */
var OnchainFeed = (function () {
  var EVERY = 30000;
  function start(symbols, opts) {
    var list = (symbols || []).filter(function (s) { return /^[A-Z]{1,6}CUSDC$/.test(s); }), timer = null, stopped = false;
    if (!list.length) return { stop: function () {} };
    function load() {
      if (stopped) return;
      fetch("/api/onchain-price?symbols=" + encodeURIComponent(list.join(","))).then(function (r) { return r.ok ? r.json() : null; }).then(function (b) {
        (b && Array.isArray(b.prices) ? b.prices : []).forEach(function (p) { if (p && p.s && Number(p.c) > 0 && opts && opts.onData) opts.onData(p.s, p); });
      }).catch(function () {}).then(schedule);
    }
    function schedule() { clearTimeout(timer); if (!stopped && !document.hidden) timer = setTimeout(load, EVERY); }
    function onVisible() { if (!document.hidden) load(); else clearTimeout(timer); }
    document.addEventListener("visibilitychange", onVisible);
    load();
    return { stop: function () { stopped = true; clearTimeout(timer); document.removeEventListener("visibilitychange", onVisible); } };
  }
  return { start: start };
})();
