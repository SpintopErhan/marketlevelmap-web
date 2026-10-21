/* 7-day price sparkline for the market table's analysis column.
   Data: 84 closed 2h candles from Binance in the visitor's browser; if Binance cannot be reached,
   the closed 1h candles the local program uploaded to R2 (data.marketlevelmap.com), taken every
   second hour so they match 2h closes. The right end follows the table's live price.
   Series are kept 10 minutes in localStorage. */
var Sparkline = (function () {
  var BINANCE = "https://data-api.binance.vision/api/v3/klines";
  var DATA = "https://data.marketlevelmap.com/candles/";
  var KEY = "mlm-spark-v2", TTL = 10 * 60 * 1000, POINTS = 84, MIN_POINTS = 12, HOUR = 3600;
  var W = 112, H = 32, PAD = 2;
  var pending = {}, indexPromise = null;

  function readCache(symbol) {
    try {
      var entry = JSON.parse(localStorage.getItem(KEY) || "{}")[symbol];
      if (entry && Date.now() - entry.at < TTL && Array.isArray(entry.closes)) return entry.closes;
    } catch (e) {}
    return null;
  }
  function writeCache(symbol, closes) {
    try {
      var all = JSON.parse(localStorage.getItem(KEY) || "{}"), now = Date.now();
      Object.keys(all).forEach(function (key) { if (!all[key] || now - all[key].at >= TTL) delete all[key]; });
      all[symbol] = { at: now, closes: closes };
      localStorage.setItem(KEY, JSON.stringify(all));
    } catch (e) {}
  }
  function getJson(url) {
    return fetch(url).then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); });
  }

  function fromBinance(symbol) {
    return getJson(BINANCE + "?symbol=" + encodeURIComponent(symbol) + "&interval=2h&limit=" + POINTS)
      .then(function (rows) { return rows.map(function (k) { return Number(k[4]); }); });
  }
  // The last monthly archive plus latest.json cover the last 7 days even right after a month change.
  // A 2h candle (opening on an even UTC hour) closes with the 1h candle that opens on the odd hour.
  function fromR2(symbol) {
    if (!indexPromise) indexPromise = getJson(DATA + "index.json").catch(function (e) { indexPromise = null; throw e; });
    return indexPromise.then(function (index) {
      var entry = index.pairs && index.pairs[symbol] && index.pairs[symbol]["1h"];
      if (!entry) throw new Error("no 1h candles");
      var names = (entry.archives || []).slice(-1).concat(["latest"]);
      return Promise.all(names.map(function (name) { return getJson(DATA + symbol + "/1h/" + name + ".json"); }));
    }).then(function (files) {
      var byTime = {};
      files.forEach(function (file) { (file.candles || []).forEach(function (row) { byTime[row[0]] = row[4]; }); });
      return Object.keys(byTime).map(Number).filter(function (time) { return Math.floor(time / HOUR) % 2 === 1; })
        .sort(function (a, b) { return a - b; }).slice(-POINTS)
        .map(function (time) { return Number(byTime[time]); });
    });
  }

  function load(symbol) {
    var cached = readCache(symbol);
    if (cached) return Promise.resolve(cached);
    if (!pending[symbol]) {
      pending[symbol] = fromBinance(symbol).catch(function () { return fromR2(symbol); }).then(function (closes) {
        closes = closes.filter(function (value) { return value > 0 && isFinite(value); });
        if (closes.length < MIN_POINTS) throw new Error("not enough candles");
        writeCache(symbol, closes);
        return closes;
      }).finally(function () { delete pending[symbol]; });
    }
    return pending[symbol];
  }

  function svgEl(name, attrs) {
    var el = document.createElementNS("http://www.w3.org/2000/svg", name);
    Object.keys(attrs).forEach(function (key) { el.setAttribute(key, attrs[key]); });
    return el;
  }

  // Draws into host and returns the 7-day change ratio (for the label).
  function draw(host, closes, options) {
    var values = closes.slice();
    if (options.live > 0) values[values.length - 1] = options.live;
    var min = Math.min.apply(null, values), max = Math.max.apply(null, values), span = max - min || max * 0.001 || 1;
    var y = function (price) { return PAD + (H - 2 * PAD) * (1 - (price - min) / span); };
    var x = function (i) { return PAD + (W - 2 * PAD) * i / (values.length - 1); };
    var change = values[values.length - 1] / values[0] - 1, tone = change >= 0 ? "up" : "down";
    var svg = svgEl("svg", { viewBox: "0 0 " + W + " " + H, width: W, height: H, "aria-hidden": "true", focusable: "false" });
    svg.appendChild(svgEl("polyline", {
      points: values.map(function (value, i) { return x(i).toFixed(1) + "," + y(value).toFixed(1); }).join(" "),
      "class": "spark-line " + tone,
    }));
    svg.appendChild(svgEl("circle", { cx: x(values.length - 1), cy: y(values[values.length - 1]), r: 1.8, "class": "spark-dot " + tone }));
    host.textContent = "";
    host.appendChild(svg);
    return change;
  }

  return { load: load, draw: draw };
})();
