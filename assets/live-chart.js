/* Interactive analysis chart (Lightweight Charts) built from the public candle data.

   Candles + EMA 20/50/200 come from https://data.marketlevelmap.com/candles/ (format:
   PUBLIC_CHART_CANDLE_DATA_CONTRACT_V1 in the engine repository). Only CLOSED candles exist
   there; the live price is shown as a separate price line, never as a candle. Zones come from
   the active publication's report JSON and are drawn as published — never derived from candles.

   1H/4H open with the last ~2 months and load 2 more months when the user scrolls left;
   1D/1W load their whole history at once (same as the local program).

   Live tail (plan revision 1): R2 holds closed candles written by the local program. What came
   after its last candle — missing closed candles and the forming candle — is fetched from
   Binance in the visitor's browser and only displayed, never stored. The forming candle is
   drawn faded and has no EMA; when it closes the EMA chain advances one step with the same
   formula the engine uses. If Binance is not reachable from this browser the chart stays on
   the R2 candles and the page's existing live price line (MarketFeed, e.g. Coinbase) is used. */
var LiveChart = (function () {
  var DATA = "https://data.marketlevelmap.com/candles/";
  var LIB = "https://unpkg.com/lightweight-charts@5.2.1/dist/lightweight-charts.standalone.production.js";
  var STEP = { "1h": 3600, "4h": 14400, "1d": 86400, "1w": 604800 };
  var MONTHLY = { "1h": true, "4h": true };
  var PAGE = 2; // monthly files per page = "2 months", like the local chart window
  var ZONE_TAIL_BARS = 5; // zones end this many bars after the last closed candle
  var BINANCE_REST = "https://data-api.binance.vision/api/v3/klines";
  var BINANCE_WS = "wss://data-stream.binance.vision/ws/";
  var EMA_PERIODS = [20, 50, 200];
  var LEVEL_COLOR = "#e8a765"; // key levels the visitor chose to show (the site's CZ colour)
  var WATERMARK_FONT = "Inter, system-ui, -apple-system, 'Segoe UI', sans-serif";
  var TAIL_REQUESTS = 2, KLINE_LIMIT = 1000, WS_GIVE_UP = 3;
  var libPromise = null, indexPromise = null;

  function loadLib() {
    if (window.LightweightCharts) return Promise.resolve(window.LightweightCharts);
    if (!libPromise) {
      libPromise = new Promise(function (resolve, reject) {
        var s = document.createElement("script");
        s.src = LIB; s.async = true;
        s.onload = function () { window.LightweightCharts ? resolve(window.LightweightCharts) : reject(new Error("chart library missing")); };
        s.onerror = function () { libPromise = null; reject(new Error("chart library unavailable")); };
        document.head.appendChild(s);
      });
    }
    return libPromise;
  }

  function getJson(url) {
    return fetch(url).then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status + " " + url); return r.json(); });
  }

  function loadIndex() {
    if (!indexPromise) indexPromise = getJson(DATA + "index.json").catch(function (e) { indexPromise = null; throw e; });
    return indexPromise;
  }

  var fileCache = {};
  function loadPeriods(pair, tf, names) {
    return Promise.all(names.map(function (name) {
      var url = DATA + pair + "/" + tf + "/" + name + ".json";
      if (!fileCache[url]) fileCache[url] = getJson(url).catch(function (err) { delete fileCache[url]; throw err; });
      return fileCache[url];
    }));
  }

  // Merge candle rows from several files: unique by open time, ascending.
  function mergeRows(existing, files) {
    var byTime = {};
    existing.forEach(function (row) { byTime[row[0]] = row; });
    files.forEach(function (file) { (file.candles || []).forEach(function (row) { byTime[row[0]] = row; }); });
    return Object.keys(byTime).map(Number).sort(function (a, b) { return a - b; }).map(function (t) { return byTime[t]; });
  }

  // ---- Live tail helpers ------------------------------------------------------------------
  // Binance kline → candle row without EMAs: [openSec, open, high, low, close, volume].
  function klineRow(openMs, open, high, low, close, volume) {
    return [Math.round(Number(openMs) / 1000), Number(open), Number(high), Number(low), Number(close), Number(volume)];
  }

  // Continue every EMA from the previous row: ema = a*close + (1-a)*prev, a = 2/(n+1).
  function withEma(previous, row) {
    var out = row.slice(0, 6);
    EMA_PERIODS.forEach(function (period, i) {
      var prev = previous ? previous[6 + i] : null, a = 2 / (period + 1);
      out.push(prev == null ? null : a * out[4] + (1 - a) * prev);
    });
    return out;
  }

  // ---- Zones -------------------------------------------------------------------------------
  // Same palette as the local program's band renderer.
  function palette(zone) {
    var layer = String(zone.layer || "").toUpperCase(), type = zone.type;
    // Price Action FVG (README "Price Action view"): neutral grey, dashed, fading as the gap fills.
    if (layer === "PA_FVG") {
      var left = Math.max(0, Math.min(1, 1 - Number(zone.filledPercent || 0) / 100));
      return { fill: "rgba(170,176,188," + (0.05 + 0.11 * left).toFixed(3) + ")", stroke: "rgba(196,202,214," + (0.45 + 0.45 * left).toFixed(3) + ")", dash: [4, 3], width: 1.5 };
    }
    // Price Action "no confirmed range" (README "Price Action view"): the last valid range, faded grey and dashed.
    if (layer === "PA_LAST_VALID") return { fill: "rgba(170,176,188,0.06)", stroke: "rgba(170,176,188,0.6)", dash: [6, 4], width: 1.5 };
    if (layer === "HISTORICAL_BROKEN_CONTEXT") return { fill: "rgba(224,133,77,0.14)", stroke: "rgba(238,158,108,0.96)", dash: [7, 4], width: 1.5 };
    if (layer === "CANONICAL_EXTENDED") return { fill: "rgba(61,207,224,0.08)", stroke: "rgba(61,207,224,0.95)", dash: [10, 5], width: 1.5 };
    if (layer === "SINGLETON_SWING_CONTEXT") return { fill: "rgba(165,140,255,0.12)", stroke: "rgba(185,157,255,0.98)", dash: [2, 5], width: 1.5 };
    if (layer === "RECENT") return type === "support"
      ? { fill: "rgba(241,194,83,0.12)", stroke: "rgba(241,194,83,0.98)", dash: [4, 3], width: 1.5 }
      : { fill: "rgba(247,122,181,0.12)", stroke: "rgba(247,122,181,0.98)", dash: [4, 3], width: 1.5 };
    if (type === "support") return { fill: "rgba(32,132,86,0.18)", stroke: "rgba(42,166,106,0.78)", dash: [], width: 1 };
    if (type === "equilibrium") return { fill: "rgba(54,101,170,0.18)", stroke: "rgba(83,139,215,0.78)", dash: [], width: 1 };
    return { fill: "rgba(150,55,62,0.18)", stroke: "rgba(197,71,78,0.78)", dash: [], width: 1 };
  }

  // Where a zone starts on the loaded candles. "unknown": no formedAt (decision B: drawn from the
  // first loaded candle with a faded, dashed left edge). "clipped": its start is older than what is
  // loaded, so no left edge is drawn until the user scrolls back to it.
  // startAt (first structural evidence) wins over formedAt (confirmation); a box that starts at
  // its first evidence opens START_PADDING_BARS candles earlier so that candle sits inside it.
  // The local program draws with the same rule.
  var START_PADDING_BARS = 3;
  function zoneStart(zone, times) {
    var first = times[0];
    var evidence = Date.parse(zone.startAt || "");
    var formed = isFinite(evidence) ? evidence : Date.parse(zone.formedAt || "");
    if (!isFinite(formed)) return { time: first, edge: "unknown" };
    var seconds = Math.floor(formed / 1000);
    if (seconds < first) return { time: first, edge: "clipped" };
    for (var i = 0; i < times.length; i++) if (times[i] >= seconds) {
      if (!isFinite(evidence)) return { time: times[i], edge: "solid" };
      var padded = i - START_PADDING_BARS;
      return padded < 0 ? { time: first, edge: "clipped" } : { time: times[padded], edge: "solid" };
    }
    return null; // formed after the last loaded candle: nothing to draw yet
  }

  // Price Action structure (README "Price Action view"): BOS soft lavender dashed, CHoCH pink-violet solid,
  // a short line from the broken swing's candle to the break candle with a label in the middle.
  function drawStructureLine(ctx, timeScale, series, zone, start, times) {
    var endSeconds = Math.floor(Date.parse(zone.endAt || "") / 1000), end = null;
    for (var i = 0; i < times.length; i++) if (times[i] >= endSeconds) { end = times[i]; break; }
    if (end === null) return;
    var x0 = timeScale.timeToCoordinate(start.time), x1 = timeScale.timeToCoordinate(end), y = series.priceToCoordinate(Number(zone.low));
    if (x0 === null || x1 === null || y === null || x1 <= x0) return;
    var choch = zone.kind === "CHOCH", color = choch ? "#e27bd0" : "#a99cf0";
    y = Math.round(y) + 0.5;
    ctx.save();
    ctx.strokeStyle = color; ctx.lineWidth = choch ? 2 : 1.25; ctx.setLineDash(choch ? [] : [5, 3]);
    ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x1, y); ctx.stroke(); ctx.setLineDash([]);
    ctx.font = (choch ? "700 " : "600 ") + "11px " + WATERMARK_FONT; ctx.textBaseline = "middle";
    var w = ctx.measureText(zone.label).width + 10, h = 16, left = (x0 + x1) / 2 - w / 2;
    ctx.fillStyle = "rgba(14,16,22,0.92)"; ctx.strokeStyle = color; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.rect(left, y - h / 2, w, h); ctx.fill(); ctx.stroke();
    ctx.fillStyle = color; ctx.fillText(zone.label, left + 5, y + 0.5);
    ctx.restore();
  }

  // Price Action structure points (README "Price Action view"): bold main HH / HL / LH / LL labels, faint internal
  // ones (switchable) and a thin dotted next-BOS line, all from the report's structure.points.
  var POINT_COLORS = { main: { HH: "#55d99c", HL: "#55d99c", LH: "#ef6e76", LL: "#ef6e76" }, internal: { HH: "#3f8a69", HL: "#3f8a69", LH: "#9a5258", LL: "#9a5258" } };
  function snapTime(iso, times) {
    var seconds = Math.floor(Date.parse(iso || "") / 1000);
    for (var i = 0; i < times.length; i++) if (times[i] >= seconds) return times[i] === seconds ? times[i] : null;
    return null;
  }
  function PointsPrimitive(getTimes) { this.points = null; this.reveal = 1; this.showInternal = true; this.getTimes = getTimes; this.chart = null; this.series = null; this.requestUpdate = null; }
  PointsPrimitive.prototype.attached = function (p) { this.chart = p.chart; this.series = p.series; this.requestUpdate = p.requestUpdate; };
  PointsPrimitive.prototype.detached = function () { this.chart = this.series = this.requestUpdate = null; };
  PointsPrimitive.prototype.update = function () { if (this.requestUpdate) this.requestUpdate(); };
  PointsPrimitive.prototype.updateAllViews = function () {};
  PointsPrimitive.prototype.paneViews = function () {
    var self = this;
    return [{
      zOrder: function () { return "top"; },
      renderer: function () {
        return {
          draw: function (target) {
            if (!self.chart || !self.series || !self.points) return;
            var timeScale = self.chart.timeScale(), times = self.getTimes();
            if (self.reveal <= 0) return;
            target.useMediaCoordinateSpace(function (scope) {
              var ctx = scope.context, width = scope.mediaSize.width;
              ctx.globalAlpha = self.reveal;
              var labels = (self.points.main || []).map(function (p) { return { p: p, layer: "main" }; });
              if (self.showInternal) labels = labels.concat((self.points.internal || []).map(function (p) { return { p: p, layer: "internal" }; }));
              ctx.textAlign = "center";
              labels.forEach(function (item) {
                var p = item.p, time = p.label ? snapTime(p.time, times) : null;
                if (time === null) return;
                var x = timeScale.timeToCoordinate(time), y = self.series.priceToCoordinate(Number(p.price));
                if (x === null || y === null) return;
                ctx.font = (item.layer === "main" ? "bold 11px " : "8px ") + "sans-serif";
                ctx.fillStyle = POINT_COLORS[item.layer][p.label] || "#8a93a8";
                ctx.textBaseline = p.kind === "high" ? "bottom" : "top";
                ctx.fillText(p.label, x, y + (p.kind === "high" ? -6 : 6));
              });
              var next = self.points.nextBos;
              if (!next || !(Number(next.price) > 0)) return;
              var seconds = Math.floor(Date.parse(next.time || "") / 1000), start = null;
              for (var i = 0; i < times.length; i++) if (times[i] >= seconds) { start = times[i]; break; }
              var x0 = start === null ? null : timeScale.timeToCoordinate(start), y = self.series.priceToCoordinate(Number(next.price));
              if (y === null) return;
              var end = timeScale.logicalToCoordinate(times.length - 1 + ZONE_TAIL_BARS), right = end === null ? width : Math.min(width, end);
              ctx.strokeStyle = "#a99cf0"; ctx.lineWidth = 1; ctx.setLineDash([2, 3]);
              ctx.beginPath(); ctx.moveTo(Math.max(0, x0 === null ? 0 : x0), y); ctx.lineTo(right, y); ctx.stroke(); ctx.setLineDash([]);
              ctx.font = "10px sans-serif"; ctx.fillStyle = "#a99cf0"; ctx.textAlign = "right"; ctx.textBaseline = "bottom";
              ctx.fillText(self.nextLabel || "Next BOS", right - 4, y - 2);
            });
          }
        };
      }
    }];
  };

  function ZonesPrimitive() { this.zones = []; this.reveal = 1; this.times = []; this.chart = null; this.series = null; this.requestUpdate = null; }
  ZonesPrimitive.prototype.attached = function (p) { this.chart = p.chart; this.series = p.series; this.requestUpdate = p.requestUpdate; };
  ZonesPrimitive.prototype.detached = function () { this.chart = this.series = this.requestUpdate = null; };
  ZonesPrimitive.prototype.set = function (zones, times) { this.zones = zones || []; this.times = times || []; if (this.requestUpdate) this.requestUpdate(); };
  ZonesPrimitive.prototype.updateAllViews = function () {};
  ZonesPrimitive.prototype.paneViews = function () {
    var self = this;
    return [{
      zOrder: function () { return "bottom"; },
      renderer: function () {
        return {
          draw: function (target) {
            if (!self.chart || !self.series || !self.times.length) return;
            var timeScale = self.chart.timeScale();
            target.useMediaCoordinateSpace(function (scope) {
              // Zones stop a few bars after the last closed candle instead of running to the price axis.
              var paneWidth = scope.mediaSize.width, end = timeScale.logicalToCoordinate(self.times.length - 1 + ZONE_TAIL_BARS);
              var ctx = scope.context, fullRight = end === null ? paneWidth : Math.min(paneWidth, end), reveal = self.reveal;
              if (fullRight <= 0 || reveal <= 0) return;
              self.zones.forEach(function (zone) {
                var start = zoneStart(zone, self.times), right = fullRight;
                if (!start) return;
                if (zone.line) { ctx.save(); ctx.globalAlpha = reveal; drawStructureLine(ctx, timeScale, self.series, zone, start, self.times); ctx.restore(); return; }
                var x0 = timeScale.timeToCoordinate(start.time);
                var yHigh = self.series.priceToCoordinate(Number(zone.high)), yLow = self.series.priceToCoordinate(Number(zone.low));
                if (x0 === null || yHigh === null || yLow === null || x0 > right) return;
                var top = Math.min(yHigh, yLow), height = Math.max(1, Math.abs(yLow - yHigh)), left = Math.max(x0, -2);
                var style = palette(zone);
                // While the chart opens (reveal < 1) the zone grows from its left edge and fades in.
                if (reveal < 1) right = left + (right - left) * reveal;
                ctx.save();
                ctx.globalAlpha = reveal;
                ctx.fillStyle = style.fill; ctx.fillRect(left, top, right - left, height);
                ctx.strokeStyle = style.stroke; ctx.lineWidth = style.width; ctx.setLineDash(style.dash);
                ctx.beginPath();
                ctx.moveTo(left, top + 0.5); ctx.lineTo(right, top + 0.5);
                ctx.moveTo(left, top + height - 0.5); ctx.lineTo(right, top + height - 0.5);
                ctx.stroke();
                if (start.edge !== "clipped" && x0 >= 0) {
                  if (start.edge === "unknown") { ctx.globalAlpha = 0.45; ctx.setLineDash([3, 4]); }
                  ctx.beginPath(); ctx.moveTo(x0 + 0.5, top); ctx.lineTo(x0 + 0.5, top + height); ctx.stroke();
                }
                // A readable label (FVG boxes): dark pill inside the box, above it when the box is thin.
                if (zone.label && right - Math.max(left, 0) > 48) {
                  ctx.globalAlpha = reveal; ctx.setLineDash([]);
                  ctx.font = "600 12px " + WATERMARK_FONT; ctx.textBaseline = "middle";
                  var pillW = ctx.measureText(zone.label).width + 12, pillH = 18, pillX = Math.max(left, 0) + 6;
                  var pillY = height >= pillH + 6 ? top + 4 : top - pillH - 3;
                  ctx.fillStyle = "rgba(14,16,22,0.9)"; ctx.strokeStyle = style.stroke; ctx.lineWidth = 1;
                  ctx.beginPath(); ctx.rect(pillX, pillY, pillW, pillH); ctx.fill(); ctx.stroke();
                  ctx.fillStyle = "#eef1f7"; ctx.fillText(zone.label, pillX + 6, pillY + pillH / 2 + 0.5);
                }
                ctx.restore();
              });
            });
          }
        };
      }
    }];
  };

  // ---- Indicators ---------------------------------------------------------------------------
  // Same formulas as the local program, from the closes:
  //   RSI 14       Wilder: gains and losses smoothed with an RMA (alpha = 1/14) from the first change;
  //   MACD 12/26/9 EMA12 - EMA26 (alpha = 2/(n+1), started at the first close), signal = EMA9 of MACD,
  //                histogram = MACD - signal;
  //   Bollinger    20-candle simple average +/- 2 population standard deviations (ddof = 0).
  // Starting values only matter at the very beginning of the history; the chart leaves out the first
  // IND_WARMUP points of RSI and MACD, since the site loads the recent history, not all of it.
  function indicators(closes) {
    var n = closes.length, out = { rsi: new Array(n), macd: new Array(n), signal: new Array(n), hist: new Array(n), bbUpper: new Array(n), bbMid: new Array(n), bbLower: new Array(n) };
    var avgGain = null, avgLoss = null, ema12 = null, ema26 = null, sig = null;
    for (var i = 0; i < n; i++) {
      var c = closes[i];
      if (i > 0) {
        var d = c - closes[i - 1], gain = d > 0 ? d : 0, loss = d < 0 ? -d : 0;
        if (avgGain === null) { avgGain = gain; avgLoss = loss; } else { avgGain += (gain - avgGain) / 14; avgLoss += (loss - avgLoss) / 14; }
        out.rsi[i] = avgLoss === 0 ? (avgGain === 0 ? 50 : 100) : 100 - 100 / (1 + avgGain / avgLoss);
      }
      ema12 = ema12 === null ? c : ema12 + (c - ema12) * 2 / 13;
      ema26 = ema26 === null ? c : ema26 + (c - ema26) * 2 / 27;
      out.macd[i] = ema12 - ema26;
      sig = sig === null ? out.macd[i] : sig + (out.macd[i] - sig) * 2 / 10;
      out.signal[i] = sig; out.hist[i] = out.macd[i] - sig;
      if (i >= 19) {
        var sum = 0, sq = 0, k;
        for (k = i - 19; k <= i; k++) sum += closes[k];
        var mean = sum / 20;
        for (k = i - 19; k <= i; k++) sq += (closes[k] - mean) * (closes[k] - mean);
        var sd = Math.sqrt(sq / 20);
        out.bbMid[i] = mean; out.bbUpper[i] = mean + 2 * sd; out.bbLower[i] = mean - 2 * sd;
      }
    }
    return out;
  }
  var IND_WARMUP = 100;

  // ---- Chart -------------------------------------------------------------------------------
  function show(container, options) {
    var pair = String(options.pair || "").toUpperCase(), tf = String(options.timeframe || "").toLowerCase();
    if (!STEP[tf]) return Promise.reject(new Error("unsupported timeframe " + tf));
    return Promise.all([loadLib(), loadIndex()]).then(function (loaded) {
      var LC = loaded[0], entry = loaded[1].pairs && loaded[1].pairs[pair] && loaded[1].pairs[pair][tf];
      if (!entry) throw new Error("no candles for " + pair + " " + tf);
      var archives = (entry.archives || []).slice();
      var initial = MONTHLY[tf] ? archives.slice(-PAGE) : archives.slice();
      var remaining = MONTHLY[tf] ? archives.slice(0, Math.max(0, archives.length - PAGE)) : [];
      return loadPeriods(pair, tf, initial.concat(["latest"])).then(function (files) {
        var rows = mergeRows([], files);
        if (!rows.length) throw new Error("no closed candles for " + pair + " " + tf);
        // Price-axis decimals: an explicit value, else the site's size rule applied to the last close.
        var lastClose = rows[rows.length - 1][4];
        var decimals = options.decimals != null ? options.decimals : options.decimalsFor ? options.decimalsFor(lastClose) : null;
        return build(LC, container, { pair: pair, tf: tf, rows: rows, tail: [], remaining: remaining, decimals: decimals, reveal: options.reveal !== false, onChange: options.onChange });
      });
    });
  }

  // Axis, crosshair and price-line labels use the page language's number format (tr-TR: 82.424,0),
  // matching the tables.
  function pageLocale() { return document.documentElement.lang === "tr" ? "tr-TR" : "en-US"; }

  function build(LC, container, state) {
    container.textContent = "";
    var decimals = state.decimals;
    function localization() {
      var locale = pageLocale();
      return {
        locale: locale,
        priceFormatter: function (price) {
          var d = decimals == null ? 2 : decimals;
          return Number(price).toLocaleString(locale, { minimumFractionDigits: d, maximumFractionDigits: d });
        }
      };
    }
    var chart = LC.createChart(container, {
      autoSize: true,
      layout: { background: { color: "#101820" }, textColor: "#c7cfde", panes: { separatorColor: "#26303c", separatorHoverColor: "#33404d" } },
      grid: { vertLines: { color: "#1f2733" }, horzLines: { color: "#1f2733" } },
      rightPriceScale: { borderColor: "#42495a" },
      timeScale: { borderColor: "#42495a", timeVisible: state.tf === "1h" || state.tf === "4h", secondsVisible: false, rightOffset: 12 },
      crosshair: { mode: LC.CrosshairMode.Normal },
      localization: localization()
    });
    var candles = chart.addSeries(LC.CandlestickSeries, {
      upColor: "#55d99c", downColor: "#ef6e76", borderVisible: false, wickUpColor: "#55d99c", wickDownColor: "#ef6e76",
      priceLineVisible: false
    });
    // Volume lives in its own pane below the price pane, so zone bands (drawn on the price pane)
    // and volume bars can never overlap, whatever the zoom.
    var volume = chart.addSeries(LC.HistogramSeries, { priceFormat: { type: "volume" }, priceLineVisible: false, lastValueVisible: false }, 1);
    volume.priceScale().applyOptions({ scaleMargins: { top: 0.15, bottom: 0 } });
    candles.priceScale().applyOptions({ scaleMargins: { top: 0.08, bottom: 0.06 } });
    // Faint site name in the middle of the price pane. It is drawn on the chart canvas, so chart
    // screenshots (download, share) carry it. Its size follows the chart width.
    var watermark = LC.createTextWatermark ? LC.createTextWatermark(chart.panes()[0], { horzAlign: "center", vertAlign: "center", lines: [] }) : null;
    function sizeWatermark() {
      if (!watermark) return;
      var big = Math.round(Math.max(22, Math.min(56, (container.clientWidth || 800) / 13)));
      watermark.applyOptions({ lines: [
        { text: "MarketLevelMap", color: "rgba(199, 207, 222, 0.08)", fontSize: big, fontFamily: WATERMARK_FONT, fontStyle: "bold" },
        { text: "marketlevelmap.com", color: "rgba(199, 207, 222, 0.10)", fontSize: Math.round(big * 0.4), fontFamily: WATERMARK_FONT, fontStyle: "" }
      ] });
    }
    var IND_PANE = 130, indPaneCount = 0, indPrefs = { bb: false, rsi: false, macd: false }, indSeries = {};
    function sizePanes() {
      var panes = chart.panes(), height = container.clientHeight;
      // Stretch factors are relative, so each pane gets its height in pixels and the price pane the rest.
      if (panes.length > 1 && height > 0) {
        var ind = (panes.length - 2) * IND_PANE, vol = Math.max(48, Math.round((height - ind) * 0.16));
        panes[0].setStretchFactor(Math.max(1, height - ind - vol));
        panes[1].setStretchFactor(vol);
        for (var p = 2; p < panes.length; p++) panes[p].setStretchFactor(IND_PANE);
      }
      sizeWatermark();
    }
    sizePanes();
    // The stylesheet sets the chart's height; indicator panes are added below it, so it is measured again
    // without the inline height whenever the panes or the window change.
    function fitHeight() {
      container.style.height = "";
      if (indPaneCount > 0) container.style.height = (container.clientHeight + indPaneCount * IND_PANE) + "px";
      sizePanes();
    }
    function onWindowResize() { if (indPaneCount > 0) fitHeight(); }
    window.addEventListener("resize", onWindowResize);
    var paneObserver = window.ResizeObserver ? new ResizeObserver(sizePanes) : null;
    if (paneObserver) paneObserver.observe(container);
    var emaColors = ["#ff6975", "#6fb5ff", "#e7d98c"], emas = emaColors.map(function (color) {
      return chart.addSeries(LC.LineSeries, { color: color, lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
    });
    // Price Action AVWAP (README "Price Action view"): near-white long-dashed curve from the report's points.
    var avwap = chart.addSeries(LC.LineSeries, { color: "#f2f4f8", lineWidth: 2, lineStyle: LC.LineStyle.LargeDashed, priceLineVisible: false,
      lastValueVisible: true, title: "AVWAP", crosshairMarkerVisible: false, visible: false }), avwapPoints = [];
    var zones = new ZonesPrimitive(), zoneList = [], baseZones = [], fvgZones = [], structureZones = [], lastValidZones = [];
    candles.attachPrimitive(zones);
    var structurePoints = new PointsPrimitive(function () { return times(); });
    candles.attachPrimitive(structurePoints);
    var sweepMarkers = LC.createSeriesMarkers ? LC.createSeriesMarkers(candles, []) : null;
    var liveLine = null, loadingOlder = false, destroyed = false, generation = 0;
    var forming = null, liveStatus = "pending", socket = null, retryTimer = null, socketFailures = 0;
    function allRows() { return state.rows.concat(state.tail); }
    function times() { return allRows().map(function (r) { return r[0]; }); }
    function notify() { if (state.onChange) try { state.onChange(); } catch (error) { /* page re-render only */ } }

    function applyPrecision() {
      if (decimals == null) return;
      var format = { type: "price", precision: decimals, minMove: Math.pow(10, -decimals) };
      chart.applyOptions({ localization: localization() });
      candles.applyOptions({ priceFormat: format });
      emas.forEach(function (s) { s.applyOptions({ priceFormat: format }); });
      avwap.applyOptions({ priceFormat: format });
    }

    // Only the points on the loaded candles: the values are the engine's cumulative ones from the anchor,
    // so the first visible value is never a new average over the loaded window.
    function drawAvwap() {
      var rows = allRows(), first = rows.length ? rows[0][0] : null, last = rows.length ? rows[rows.length - 1][0] : null;
      var data = first === null ? [] : avwapPoints.filter(function (p) { return p.time >= first && p.time <= last; });
      avwap.setData(data);
      avwap.applyOptions({ visible: data.length > 0 });
    }

    // RSI / MACD panes and Bollinger bands (shown on request: setIndicators). Recomputed from the closes,
    // with the forming candle, whenever candles change.
    function indicatorRows() { var rows = allRows(); return forming ? rows.concat([forming]) : rows; }
    function drawIndicators() {
      if (!indSeries.bbUpper && !indSeries.rsi && !indSeries.macd) return;
      var rows = indicatorRows(), v = indicators(rows.map(function (r) { return r[4]; })), warm = Math.min(IND_WARMUP, Math.max(0, rows.length - 1));
      var points = function (values, from) {
        var list = [];
        for (var i = from; i < rows.length; i++) if (values[i] != null && isFinite(values[i])) list.push({ time: rows[i][0], value: values[i] });
        return list;
      };
      if (indSeries.bbUpper) { indSeries.bbUpper.setData(points(v.bbUpper, 19)); indSeries.bbMid.setData(points(v.bbMid, 19)); indSeries.bbLower.setData(points(v.bbLower, 19)); }
      if (indSeries.rsi) indSeries.rsi.setData(points(v.rsi, warm));
      if (indSeries.macd) {
        indSeries.macd.setData(points(v.macd, warm)); indSeries.signal.setData(points(v.signal, warm));
        var hist = [];
        for (var i = warm; i < rows.length; i++) {
          var h = v.hist[i], prev = v.hist[i - 1];
          hist.push({ time: rows[i][0], value: h, color: h >= 0 ? (h >= prev ? "rgba(59,207,145,0.75)" : "rgba(59,207,145,0.35)") : (h <= prev ? "rgba(239,107,115,0.75)" : "rgba(239,107,115,0.35)") });
        }
        indSeries.hist.setData(hist);
      }
    }
    function layoutIndicators() {
      Object.keys(indSeries).forEach(function (key) { chart.removeSeries(indSeries[key]); });
      indSeries = {};
      while (chart.panes().length > 2) chart.removePane(chart.panes().length - 1);
      var priceFormat = decimals == null ? undefined : { type: "price", precision: decimals, minMove: Math.pow(10, -decimals) };
      var line = function (color, extra) { return Object.assign({ color: color, lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false }, extra || {}); };
      if (indPrefs.bb) {
        // Upper gold, middle pink, lower purple (2 px), so the three bands read apart from the EMAs.
        var bb = function (color) { return line(color, Object.assign({ lineWidth: 2 }, priceFormat ? { priceFormat: priceFormat } : {})); };
        indSeries.bbUpper = chart.addSeries(LC.LineSeries, bb("#f0b90b"), 0);
        indSeries.bbMid = chart.addSeries(LC.LineSeries, bb("#e8549a"), 0);
        indSeries.bbLower = chart.addSeries(LC.LineSeries, bb("#9575e0"), 0);
      }
      var pane = 2;
      if (indPrefs.rsi) {
        indSeries.rsi = chart.addSeries(LC.LineSeries, line("#b892ff", { lineWidth: 1.5, lastValueVisible: true, title: "RSI 14", priceFormat: { type: "price", precision: 1, minMove: 0.1 },
          autoscaleInfoProvider: function () { return { priceRange: { minValue: 0, maxValue: 100 } }; } }), pane++);
        [70, 30].forEach(function (level) { indSeries.rsi.createPriceLine({ price: level, color: "rgba(154,170,181,0.55)", lineWidth: 1, lineStyle: LC.LineStyle.Dashed, axisLabelVisible: true, title: "" }); });
      }
      if (indPrefs.macd) {
        var macdFormat = { type: "price", precision: Math.max(2, decimals == null ? 2 : decimals), minMove: Math.pow(10, -Math.max(2, decimals == null ? 2 : decimals)) };
        indSeries.hist = chart.addSeries(LC.HistogramSeries, { priceLineVisible: false, lastValueVisible: false, priceFormat: macdFormat }, pane);
        indSeries.macd = chart.addSeries(LC.LineSeries, line("#6fb5ff", { lineWidth: 1.5, lastValueVisible: true, title: "MACD 12/26/9", priceFormat: macdFormat }), pane);
        indSeries.signal = chart.addSeries(LC.LineSeries, line("#ff9f43", { priceFormat: macdFormat }), pane);
        pane++;
      }
      // The chart grows by one pane height for each indicator pane, so the candles keep their room.
      indPaneCount = pane - 2;
      fitHeight();
      drawIndicators();
    }

    function setData() {
      var rows = allRows();
      candles.setData(rows.map(function (r) { return { time: r[0], open: r[1], high: r[2], low: r[3], close: r[4] }; }));
      volume.setData(rows.map(function (r) { return { time: r[0], value: r[5], color: r[4] >= r[1] ? "rgba(59,158,112,0.55)" : "rgba(169,83,91,0.55)" }; }));
      emas.forEach(function (series, i) {
        series.setData(rows.filter(function (r) { return r[6 + i] != null; }).map(function (r) { return { time: r[0], value: r[6 + i] }; }));
      });
      zones.set(zoneList, rows.map(function (r) { return r[0]; }));
      drawAvwap();
      drawForming();
      drawIndicators();
    }

    // The forming candle: faded colours, no EMA, replaced on every update until it closes.
    function drawForming() {
      if (!forming) return;
      var up = forming[4] >= forming[1], tone = up ? "rgba(85,217,156,0.38)" : "rgba(239,110,118,0.38)";
      candles.update({ time: forming[0], open: forming[1], high: forming[2], low: forming[3], close: forming[4], color: tone, wickColor: tone, borderColor: tone });
      volume.update({ time: forming[0], value: forming[5], color: up ? "rgba(59,158,112,0.25)" : "rgba(169,83,91,0.25)" });
      drawIndicators();
    }

    // A closed candle from Binance after the last known one: extend EMAs and draw it normally.
    function addClosed(row) {
      var rows = allRows(), last = rows[rows.length - 1];
      if (last && row[0] <= last[0]) return false;
      var full = withEma(last, row);
      state.tail.push(full);
      candles.update({ time: full[0], open: full[1], high: full[2], low: full[3], close: full[4] });
      volume.update({ time: full[0], value: full[5], color: full[4] >= full[1] ? "rgba(59,158,112,0.55)" : "rgba(169,83,91,0.55)" });
      emas.forEach(function (series, i) { if (full[6 + i] != null) series.update({ time: full[0], value: full[6 + i] }); });
      zones.set(zoneList, times());
      return true;
    }

    function setLiveStatus(status) {
      if (status === liveStatus) return;
      liveStatus = status;
      // Live: the series' own last-price label is the live price, so the separate line goes away.
      candles.applyOptions({ priceLineVisible: status === "live" });
      if (status === "live" && liveLine) { candles.removePriceLine(liveLine); liveLine = null; }
      notify();
    }

    // Missing closed candles + the forming one, straight after the last known candle.
    function fillTail() {
      var step = STEP[state.tf] * 1000, requests = 0, epoch = generation;
      function next(startMs) {
        if (destroyed || epoch !== generation) return;
        requests++;
        var url = BINANCE_REST + "?symbol=" + state.pair + "&interval=" + state.tf + "&startTime=" + startMs + "&limit=" + KLINE_LIMIT;
        return fetch(url, { cache: "no-store" }).then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
          .then(function (klines) {
            if (destroyed || epoch !== generation || !Array.isArray(klines)) return;
            var now = Date.now();
            klines.forEach(function (k) {
              var row = klineRow(k[0], k[1], k[2], k[3], k[4], k[5]);
              if (Number(k[6]) < now) { addClosed(row); if (forming && forming[0] <= row[0]) forming = null; }
              else forming = row;
            });
            if (klines.length === KLINE_LIMIT && requests < TAIL_REQUESTS) return next(Number(klines[klines.length - 1][0]) + step);
          });
      }
      var rows = allRows();
      return next((rows[rows.length - 1][0] + STEP[state.tf]) * 1000).then(function () {
        if (destroyed || epoch !== generation) return;
        drawForming(); notify();
      });
    }

    function openStream() {
      if (destroyed || document.hidden || socket) return;
      var ws, received = false;
      try { ws = socket = new WebSocket(BINANCE_WS + state.pair.toLowerCase() + "@kline_" + state.tf); }
      catch (error) { socket = null; setLiveStatus("unavailable"); return; }
      ws.onmessage = function (event) {
        var k;
        try { k = JSON.parse(event.data).k; } catch (error) { return; }
        if (!k || destroyed) return;
        received = true; socketFailures = 0;
        var row = klineRow(k.t, k.o, k.h, k.l, k.c, k.v);
        if (k.x) { addClosed(row); forming = null; notify(); }
        else { forming = row; drawForming(); }
        setLiveStatus("live");
      };
      ws.onclose = function () {
        if (socket !== ws) return;
        socket = null;
        if (destroyed || document.hidden) return;
        if (!received && ++socketFailures >= WS_GIVE_UP) { setLiveStatus("unavailable"); return; }
        retryTimer = setTimeout(resume, 5000);
      };
    }

    function closeStream() {
      clearTimeout(retryTimer);
      if (socket) { var ws = socket; socket = null; try { ws.close(); } catch (error) { /* already closed */ } }
    }

    function resume() {
      if (destroyed || document.hidden) return;
      fillTail().then(function () { setLiveStatus("live"); openStream(); })
        .catch(function () { setLiveStatus("unavailable"); });
    }

    function onVisibility() { if (document.hidden) closeStream(); else resume(); }
    document.addEventListener("visibilitychange", onVisibility);

    function loadOlder(range) {
      if (loadingOlder || destroyed || !state.remaining.length || !range || range.from > 30) return;
      loadingOlder = true;
      var page = state.remaining.slice(-PAGE);
      state.remaining = state.remaining.slice(0, Math.max(0, state.remaining.length - PAGE));
      loadPeriods(state.pair, state.tf, page).then(function (files) {
        if (destroyed) return;
        var before = state.rows.length;
        state.rows = mergeRows(state.rows, files);
        var added = state.rows.length - before, view = chart.timeScale().getVisibleLogicalRange();
        setData();
        if (view && added > 0) chart.timeScale().setVisibleLogicalRange({ from: view.from + added, to: view.to + added });
      }).catch(function () { state.remaining = state.remaining.concat(page); })
        .then(function () { loadingOlder = false; });
    }

    applyPrecision();
    setData();
    // ~180 candles on desktop like the local chart, fewer on narrow screens so candles stay readable.
    // autoSize measures the container asynchronously, so the initial view is (re)applied once the
    // chart has a real size — but never after the user has started to interact with it.
    var touched = false;
    ["pointerdown", "wheel", "touchstart"].forEach(function (name) { container.addEventListener(name, function () { touched = true; }, { passive: true }); });
    function initialView() {
      if (touched || destroyed) return;
      var count = allRows().length + (forming ? 1 : 0), bars = Math.max(60, Math.min(180, Math.round((container.clientWidth || 800) / 5)));
      chart.timeScale().setVisibleLogicalRange({ from: Math.max(0, count - bars), to: count - 1 + 12 });
    }
    initialView();
    // Opening animation (first view and every timeframe switch, which builds a new chart): the candles are
    // uncovered from left to right (CSS on .lc-reveal), then the zones grow and the structure labels fade in.
    // Data, scrolling, zooming and level lines are not affected; any touch finishes it at once.
    var reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (state.reveal !== false && !reduceMotion && window.requestAnimationFrame) {
      container.classList.add("lc-reveal");
      setTimeout(function () { container.classList.remove("lc-reveal"); }, 900);
      zones.reveal = structurePoints.reveal = 0;
      var revealStart = null, revealStep = function (now) {
        if (destroyed) return;
        if (revealStart === null) revealStart = now;
        var k = touched ? 1 : Math.min(1, Math.max(0, (now - revealStart - 450) / 700)), eased = 1 - Math.pow(1 - k, 3);
        zones.reveal = structurePoints.reveal = eased;
        if (zones.requestUpdate) zones.requestUpdate();
        structurePoints.update();
        if (k < 1) requestAnimationFrame(revealStep);
      };
      requestAnimationFrame(revealStep);
    }
    // Live price pulse: a small beating dot on the last candle at the current price.
    var pulse = document.createElement("span"), pulseTimer;
    pulse.className = "lc-pulse"; pulse.hidden = true; pulse.setAttribute("aria-hidden", "true"); container.appendChild(pulse);
    function placePulse() {
      if (destroyed) return;
      var rows = allRows(), last = forming || rows[rows.length - 1];
      if (!last) { pulse.hidden = true; return; }
      var price = liveLine && liveStatus !== "live" ? liveLine.options().price : last[4];
      var x = chart.timeScale().logicalToCoordinate(rows.length - 1 + (forming ? 1 : 0)), y = candles.priceToCoordinate(price);
      if (x === null || y === null || x < 0 || x > chart.timeScale().width() || y < 0) { pulse.hidden = true; return; }
      pulse.hidden = false; pulse.style.transform = "translate(" + x.toFixed(1) + "px," + y.toFixed(1) + "px)";
    }
    chart.timeScale().subscribeVisibleLogicalRangeChange(placePulse);
    pulseTimer = setInterval(placePulse, 500);
    var sized = 0, waitForSize = function () {
      if (touched || destroyed || sized++ > 20) return;
      if (chart.timeScale().width() > 0) { initialView(); return; }
      requestAnimationFrame(waitForSize);
    };
    requestAnimationFrame(waitForSize);
    chart.timeScale().subscribeVisibleLogicalRangeChange(loadOlder);
    var opened = generation;
    fillTail().then(function () {
      if (destroyed || opened !== generation) return;
      initialView(); setLiveStatus("live"); openStream();
    }).catch(function () { if (!destroyed && opened === generation) setLiveStatus("unavailable"); });

    // Key levels the page asks for (analysis page "Key levels" eye toggles): one dashed price line
    // each, labelled with its code on the price axis. Price lines do not change the price scale.
    var levelLines = {};
    function setLevels(list) {
      if (destroyed) return;
      var keep = {};
      (list || []).forEach(function (level) {
        var code = String(level.code), price = Number(level.price);
        if (!(price > 0)) return;
        keep[code] = true;
        // Volume profile levels bring their own colour (teal) and a solid POC; key levels stay dashed orange.
        var style = level.color ? (level.solid ? LC.LineStyle.Solid : LC.LineStyle.Dashed) : LC.LineStyle.LargeDashed;
        if (!levelLines[code]) levelLines[code] = candles.createPriceLine({ price: price, color: level.color || LEVEL_COLOR, lineWidth: 1, lineStyle: style, axisLabelVisible: true, title: code });
        else if (levelLines[code].options().price !== price) levelLines[code].applyOptions({ price: price });
      });
      Object.keys(levelLines).forEach(function (code) { if (!keep[code]) { candles.removePriceLine(levelLines[code]); delete levelLines[code]; } });
    }

    return {
      setLevels: setLevels,
      // Bollinger (price pane), RSI and MACD (panes under the volume): { bb, rsi, macd } booleans.
      setIndicators: function (prefs) {
        // EMA 20/50/200 stay on unless turned off explicitly.
        var showEma = !(prefs && prefs.ema === false);
        emas.forEach(function (s) { s.applyOptions({ visible: showEma }); });
        var next = { bb: !!(prefs && prefs.bb), rsi: !!(prefs && prefs.rsi), macd: !!(prefs && prefs.macd) };
        if (destroyed || (next.bb === indPrefs.bb && next.rsi === indPrefs.rsi && next.macd === indPrefs.macd)) return;
        indPrefs = next; layoutIndicators();
      },
      // The chart as drawn now (zones, levels, watermark; no crosshair), at device resolution.
      screenshot: function () { return chart.takeScreenshot(true, false); },
      lastClosedAt: function () { var rows = allRows(), last = rows[rows.length - 1]; return new Date((last[0] + STEP[state.tf]) * 1000).toISOString(); },
      // The last closed candle as drawn (R2 or browser tail): open time (the chart's label) and close time.
      lastClosedCandle: function () {
        var rows = allRows(), last = rows[rows.length - 1];
        return { open: new Date(last[0] * 1000).toISOString(), close: new Date((last[0] + STEP[state.tf]) * 1000).toISOString(), timeframe: state.tf };
      },
      setZones: function (list, priceDecimals) {
        baseZones = (list || []).filter(function (z) { return z && z.drawn !== false && Number(z.low) > 0 && Number(z.high) > 0; });
        if (priceDecimals != null && priceDecimals !== decimals) { decimals = priceDecimals; applyPrecision(); }
        zoneList = baseZones.concat(fvgZones, structureZones, lastValidZones);
        zones.set(zoneList, times());
      },
      // Price Action report structure: BOS / CHoCH lines and sweep markers (README "Price Action view").
      setStructure: function (structure) {
        var events = (structure && structure.events) || [], sweeps = (structure && structure.sweeps) || [];
        structureZones = events.filter(function (e) { return Number(e.level) > 0; }).map(function (e) {
          return { line: true, layer: "PA_STRUCTURE", kind: e.type, low: Number(e.level), high: Number(e.level), formedAt: e.swingTime, endAt: e.breakTime,
            label: (e.type === "CHOCH" ? "CHoCH" : "BOS") + (e.direction === "bullish" ? " ↑" : " ↓") };
        });
        zoneList = baseZones.concat(fvgZones, structureZones, lastValidZones);
        zones.set(zoneList, times());
        var curve = structure && structure.state !== "undetermined" && structure.avwap && Array.isArray(structure.avwap.points) ? structure.avwap.points : [];
        avwapPoints = curve.map(function (p) { return { time: Math.floor(Date.parse(p.time || "") / 1000), value: Number(p.value) }; })
          .filter(function (p) { return isFinite(p.time) && p.value > 0; });
        drawAvwap();
        structurePoints.points = structure && structure.state !== "undetermined" && structure.points ? structure.points : null;
        structurePoints.update();
        if (!sweepMarkers) return;
        var candleTimes = times();
        sweepMarkers.setMarkers(sweeps.map(function (s) {
          var seconds = Math.floor(Date.parse(s.time || "") / 1000), time = null;
          for (var i = 0; i < candleTimes.length; i++) if (candleTimes[i] >= seconds) { time = candleTimes[i]; break; }
          return time === null ? null : { time: time, position: s.band === "RH" ? "aboveBar" : "belowBar", color: "#dfe3ea", shape: "circle", text: "Sweep" };
        }).filter(Boolean).sort(function (a, b) { return a.time - b.time; }));
      },
      // Structure points: internal labels on / off, and the next-BOS line's caption in the page language.
      setInternalStructure: function (visible, nextLabel) {
        structurePoints.showInternal = visible !== false;
        if (nextLabel) structurePoints.nextLabel = nextLabel;
        structurePoints.update();
      },
      // Price Action "no confirmed range": the last valid range (report noRange.lastValid), labelled on its high band.
      setLastValid: function (lastValid, label) {
        lastValidZones = lastValid && Array.isArray(lastValid.zones) ? lastValid.zones.filter(function (z) {
          return z && Number(z.low) > 0 && Number(z.high) >= Number(z.low);
        }).map(function (z) {
          return { layer: "PA_LAST_VALID", type: z.type, low: Number(z.low), high: Number(z.high), formedAt: lastValid.analyzedAt,
            label: z.type === "resistance" ? label : null };
        }) : [];
        zoneList = baseZones.concat(fvgZones, structureZones, lastValidZones);
        zones.set(zoneList, times());
      },
      // Price Action report FVG boxes (remaining gap, from the candle that formed it to the right edge).
      setFvg: function (list) {
        fvgZones = (list || []).filter(function (f) { return f && Number(f.low) > 0 && Number(f.high) > Number(f.low); }).map(function (f) {
          return { type: "fvg", layer: "PA_FVG", low: Number(f.low), high: Number(f.high), formedAt: f.createdAt,
            filledPercent: Number(f.filledPercent || 0), label: String(f.direction).toLowerCase() === "bullish" ? "FVG \u2191" : "FVG \u2193" };
        });
        zoneList = baseZones.concat(fvgZones, structureZones, lastValidZones);
        zones.set(zoneList, times());
      },
      liveStatus: function () { return liveStatus; },
      // Fallback only: while Binance candles are live the series' last price is already live.
      setLivePrice: function (price) {
        var p = Number(price);
        if (!(p > 0) || destroyed || liveStatus === "live") return;
        if (!liveLine) liveLine = candles.createPriceLine({ price: p, color: "#f0c040", lineWidth: 1, lineStyle: LC.LineStyle.Dashed, axisLabelVisible: true, title: "" });
        else liveLine.applyOptions({ price: p });
      },
      setLocale: function () { if (!destroyed) chart.applyOptions({ localization: localization() }); },
      // Change timeframe without tearing the chart down. 1H in particular is a lot of candles;
      // rebuilding the widget blanked the panel and redrew it.
      reload: function (nextTf) {
        nextTf = String(nextTf || "").toLowerCase();
        if (destroyed || !STEP[nextTf]) return Promise.reject(new Error("unsupported timeframe " + nextTf));
        if (nextTf === state.tf) return Promise.resolve();
        var epoch = ++generation;
        closeStream();
        forming = null;
        setLiveStatus("pending");
        return loadIndex().then(function (index) {
          if (destroyed || epoch !== generation) return;
          var entry = index.pairs && index.pairs[state.pair] && index.pairs[state.pair][nextTf];
          if (!entry) throw new Error("no candles for " + state.pair + " " + nextTf);
          var archives = (entry.archives || []).slice();
          var initial = MONTHLY[nextTf] ? archives.slice(-PAGE) : archives.slice();
          var remaining = MONTHLY[nextTf] ? archives.slice(0, Math.max(0, archives.length - PAGE)) : [];
          return loadPeriods(state.pair, nextTf, initial.concat(["latest"])).then(function (files) {
            if (destroyed || epoch !== generation) return;
            var rows = mergeRows([], files);
            if (!rows.length) throw new Error("no closed candles for " + state.pair + " " + nextTf);
            state.tf = nextTf;
            state.rows = rows;
            state.tail = [];
            state.remaining = remaining;
            baseZones = []; fvgZones = []; structureZones = []; lastValidZones = []; zoneList = []; avwapPoints = [];
            chart.applyOptions({ timeScale: { timeVisible: nextTf === "1h" || nextTf === "4h", secondsVisible: false, rightOffset: 12 } });
            touched = false;
            setData();
            initialView();
            fillTail().then(function () {
              if (destroyed || epoch !== generation) return;
              initialView();
              setLiveStatus("live");
              openStream();
            }).catch(function () { if (!destroyed && epoch === generation) setLiveStatus("unavailable"); });
          });
        });
      },
      destroy: function () {
        destroyed = true; clearInterval(pulseTimer); closeStream(); document.removeEventListener("visibilitychange", onVisibility);
        if (paneObserver) paneObserver.disconnect();
        window.removeEventListener("resize", onWindowResize);
        chart.remove(); container.textContent = ""; container.style.height = "";
      }
    };
  }

  return { show: show, indicators: indicators, _test: { mergeRows: mergeRows, zoneStart: zoneStart, palette: palette, klineRow: klineRow, withEma: withEma } };
})();
