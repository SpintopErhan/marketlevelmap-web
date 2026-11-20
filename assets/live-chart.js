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
  var LEVEL_COLOR = "#d6dbe3"; // key levels the visitor chose to show: soft white, apart from the orange CZ zone outlines
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
    // Price Action Fibonacci (opt-in): the 0.618-0.786 deep pullback band of the current leg, soft gold.
    if (layer === "PA_FIB") return { fill: "rgba(240,185,11,0.10)", stroke: "rgba(240,185,11,0.55)", dash: [4, 3], width: 1 };
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

  // Price Action Fibonacci level line: thin, from the protected swing to the zones' right edge, with its ratio
  // at the right end (0 and 1 solid, 0.5 dashed).
  function drawFibLine(ctx, timeScale, series, zone, start, right) {
    var x0 = timeScale.timeToCoordinate(start.time), y = series.priceToCoordinate(Number(zone.low));
    if (x0 === null || y === null || x0 >= right) return;
    y = Math.round(y) + 0.5; x0 = Math.max(x0, -2);
    ctx.strokeStyle = "rgba(240,185,11,0.75)"; ctx.lineWidth = 1; ctx.setLineDash(zone.dashed ? [4, 4] : []);
    ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(right, y); ctx.stroke(); ctx.setLineDash([]);
    ctx.font = "600 11px " + WATERMARK_FONT; ctx.textBaseline = "bottom"; ctx.textAlign = "right";
    ctx.fillStyle = "rgba(240,185,11,0.95)"; ctx.fillText(zone.label, right - 4, y - 2); ctx.textAlign = "left";
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

  // Supertrend line: drawn here rather than as line series, so a segment joins only two candles of the same direction
  // (line series join across whitespace, which drew the line through the turns).
  // Index range of time-sorted points inside the visible time range, with one point of margin on each side so lines
  // still run to the chart's edges. Drawing only these keeps a frame's work to what is on screen.
  function visibleSpan(points, ts) {
    var n = points.length, vr = ts.getVisibleRange();
    if (!vr || typeof vr.from !== "number") return [0, n];
    var lo = 0, hi = n; while (lo < hi) { var m = (lo + hi) >> 1; if (points[m].time < vr.from) lo = m + 1; else hi = m; }
    var a = Math.max(0, lo - 1); lo = a; hi = n;
    while (lo < hi) { var k = (lo + hi) >> 1; if (points[k].time <= vr.to) lo = k + 1; else hi = k; }
    return [a, Math.min(n, lo + 1)];
  }
  function TrendLinePrimitive() { this.points = []; this.chart = null; this.series = null; this.requestUpdate = null; }
  TrendLinePrimitive.prototype.attached = function (p) { this.chart = p.chart; this.series = p.series; this.requestUpdate = p.requestUpdate; };
  TrendLinePrimitive.prototype.detached = function () { this.chart = this.series = this.requestUpdate = null; };
  TrendLinePrimitive.prototype.set = function (points) { this.points = points || []; if (this.requestUpdate) this.requestUpdate(); };
  TrendLinePrimitive.prototype.updateAllViews = function () {};
  TrendLinePrimitive.prototype.paneViews = function () {
    var self = this;
    return [{
      zOrder: function () { return "normal"; },
      renderer: function () {
        return { draw: function (target) {
          if (!self.chart || !self.series || self.points.length < 2) return;
          var ts = self.chart.timeScale();
          var span = visibleSpan(self.points, ts);
          target.useMediaCoordinateSpace(function (scope) {
            // One path per run of the same side and colour (a segment takes the colour of its end point).
            var ctx = scope.context, prev = null, open = null;
            ctx.lineWidth = 2; ctx.lineJoin = "round";
            function flush() { if (open) { ctx.stroke(); open = null; } }
            for (var i = span[0]; i < span[1]; i++) {
              var p = self.points[i], x = ts.timeToCoordinate(p.time), y = self.series.priceToCoordinate(p.value);
              if (x === null || y === null) { flush(); prev = null; continue; }
              if (prev && prev.dir === p.dir) {
                var col = p.color || (p.dir === 1 ? "#3ccf91" : "#ef6b73");
                if (open !== col) { flush(); ctx.strokeStyle = col; ctx.beginPath(); ctx.moveTo(prev.x, prev.y); open = col; }
                ctx.lineTo(x, y);
              } else flush();
              prev = { x: x, y: y, dir: p.dir };
            }
            flush();
          });
        } };
      }
    }];
  };

  // Ichimoku: lines and the cloud by logical index (row i of the chart is logical index i), so the cloud can run
  // 26 candles past the last one, where there are no candles to hang a series on.
  function IchimokuPrimitive() { this.data = null; this.chart = null; this.series = null; this.requestUpdate = null; }
  IchimokuPrimitive.prototype.attached = TrendLinePrimitive.prototype.attached;
  IchimokuPrimitive.prototype.detached = TrendLinePrimitive.prototype.detached;
  IchimokuPrimitive.prototype.set = function (data) { this.data = data; if (this.requestUpdate) this.requestUpdate(); };
  IchimokuPrimitive.prototype.updateAllViews = function () {};
  IchimokuPrimitive.prototype.paneViews = function () {
    var self = this;
    return [{
      zOrder: function () { return "bottom"; },
      renderer: function () {
        return { draw: function (target) {
          var d = self.data; if (!self.chart || !self.series || !d) return;
          var ts = self.chart.timeScale(), sr = self.series, from = d.from, n = d.close.length;
          var X = function (i) { return ts.logicalToCoordinate(i); }, Y = function (v) { return v == null ? null : sr.priceToCoordinate(v); };
          // Only the indexes on screen (plus one each side), shifted by each line's offset.
          var vl = ts.getVisibleLogicalRange(), lf = vl ? Math.floor(vl.from) - 1 : -Infinity, lt = vl ? Math.ceil(vl.to) + 1 : Infinity;
          target.useMediaCoordinateSpace(function (scope) {
            var ctx = scope.context;
            // Cloud: Senkou A and B of candle i sit at i + 26.
            for (var i = Math.max(from, 52, lf - 27); i < Math.min(n - 1, lt - 25); i++) {
              var a0 = Y(d.spanA[i]), a1 = Y(d.spanA[i + 1]), b0 = Y(d.spanB[i]), b1 = Y(d.spanB[i + 1]), x0 = X(i + 26), x1 = X(i + 27);
              if (a0 === null || a1 === null || b0 === null || b1 === null || x0 === null || x1 === null) continue;
              ctx.fillStyle = d.spanA[i] >= d.spanB[i] ? "rgba(60,207,145,0.13)" : "rgba(239,107,115,0.13)";
              ctx.beginPath(); ctx.moveTo(x0, a0); ctx.lineTo(x1, a1); ctx.lineTo(x1, b1); ctx.lineTo(x0, b0); ctx.closePath(); ctx.fill();
            }
            function line(values, shift, color, width, dash) {
              ctx.strokeStyle = color; ctx.lineWidth = width; ctx.setLineDash(dash || []); ctx.beginPath(); var open = false;
              // A dashed line keeps its full length so the dash pattern stays fixed to the candles while panning.
              var j0 = dash ? from : Math.max(from, lf - shift), j1 = dash ? n : Math.min(n, lt - shift + 1);
              for (var j = j0; j < j1; j++) {
                var x = X(j + shift), y = Y(values[j]);
                if (x === null || y === null) { open = false; continue; }
                if (!open) { ctx.moveTo(x, y); open = true; } else ctx.lineTo(x, y);
              }
              ctx.stroke(); ctx.setLineDash([]);
            }
            line(d.spanA, 26, "rgba(60,207,145,0.55)", 1);
            line(d.spanB, 26, "rgba(239,107,115,0.55)", 1);
            line(d.close, -26, "rgba(185,163,255,0.6)", 1, [3, 3]);
            line(d.kijun, 0, "#c96a8a", 1.5);
            line(d.tenkan, 0, "#3fb6d6", 1.5);
          });
        } };
      }
    }];
  };

  // Economic events (README "Economic events on the chart"): a small marker at the bottom of the price pane under the candle an
  // event falls in (or where that candle will be, for events still ahead), with a faint line up the pane for the
  // very high impact ones. Orange: very high, yellow: high, grey: medium.
  function EventsPrimitive() { this.events = []; this.chart = null; this.series = null; this.requestUpdate = null; this.logical = null; }
  EventsPrimitive.prototype.attached = TrendLinePrimitive.prototype.attached;
  EventsPrimitive.prototype.detached = TrendLinePrimitive.prototype.detached;
  EventsPrimitive.prototype.set = function (events) { this.events = events || []; if (this.requestUpdate) this.requestUpdate(); };
  EventsPrimitive.prototype.updateAllViews = function () {};
  EventsPrimitive.prototype.positions = function (height) {
    var ts = this.chart.timeScale(), out = [], self = this;
    this.events.forEach(function (e) {
      var l = self.logical ? self.logical(e.time) : null, x = l == null ? null : ts.logicalToCoordinate(Math.floor(l));
      if (x !== null) out.push({ x: x, y: height - 9, e: e });
    });
    return out;
  };
  EventsPrimitive.prototype.paneViews = function () {
    var self = this;
    return [{
      zOrder: function () { return "top"; },
      renderer: function () {
        return { draw: function (target) {
          if (!self.chart || !self.events.length) return;
          target.useMediaCoordinateSpace(function (scope) {
            var ctx = scope.context, h = scope.mediaSize.height;
            self.positions(h).forEach(function (p) {
              var c = p.e.impact === "VERY_HIGH" ? "255,159,67" : p.e.impact === "HIGH" ? "242,201,76" : "143,154,171";
              if (p.e.impact === "VERY_HIGH") {
                ctx.strokeStyle = "rgba(" + c + ",0.22)"; ctx.lineWidth = 1; ctx.setLineDash([2, 4]);
                ctx.beginPath(); ctx.moveTo(p.x, 0); ctx.lineTo(p.x, p.y - 6); ctx.stroke(); ctx.setLineDash([]);
              }
              ctx.fillStyle = "rgb(" + c + ")"; ctx.strokeStyle = "#101820"; ctx.lineWidth = 1.2;
              ctx.beginPath(); ctx.moveTo(p.x, p.y - 5); ctx.lineTo(p.x + 5, p.y); ctx.lineTo(p.x, p.y + 5); ctx.lineTo(p.x - 5, p.y); ctx.closePath(); ctx.fill(); ctx.stroke();
            });
          });
        } };
      }
    }];
  };

  // Parabolic SAR: dots, each run joined by a faint curve so its parabolic acceleration shows, and a larger dot where
  // a run starts (the switch of side).
  function SarPrimitive() { this.points = []; this.chart = null; this.series = null; this.requestUpdate = null; }
  SarPrimitive.prototype.attached = TrendLinePrimitive.prototype.attached;
  SarPrimitive.prototype.detached = TrendLinePrimitive.prototype.detached;
  SarPrimitive.prototype.set = TrendLinePrimitive.prototype.set;
  SarPrimitive.prototype.updateAllViews = function () {};
  SarPrimitive.prototype.paneViews = function () {
    var self = this;
    return [{
      zOrder: function () { return "top"; },
      renderer: function () {
        return { draw: function (target) {
          if (!self.chart || !self.series || !self.points.length) return;
          var ts = self.chart.timeScale(), spacing = ts.options().barSpacing || 6;
          target.useMediaCoordinateSpace(function (scope) {
            var ctx = scope.context, runs = [], run = null, span = visibleSpan(self.points, ts);
            for (var j = span[0]; j < span[1]; j++) {
              var p = self.points[j], x = ts.timeToCoordinate(p.time), y = self.series.priceToCoordinate(p.value);
              if (x === null || y === null) { run = null; continue; }
              if (!run || run.dir !== p.dir) { run = { dir: p.dir, pts: [], start: p.start }; runs.push(run); }
              run.pts.push({ x: x, y: y });
            }
            var r = Math.max(1.6, Math.min(3.2, spacing * 0.28));
            runs.forEach(function (rn) {
              var col = rn.dir === 1 ? "85,217,156" : "239,110,118";
              if (rn.pts.length > 1) {
                ctx.strokeStyle = "rgba(" + col + ",0.35)"; ctx.lineWidth = 1.2; ctx.lineJoin = "round";
                ctx.beginPath(); ctx.moveTo(rn.pts[0].x, rn.pts[0].y);
                for (var i = 1; i < rn.pts.length; i++) ctx.lineTo(rn.pts[i].x, rn.pts[i].y);
                ctx.stroke();
              }
              rn.pts.forEach(function (pt, i) {
                var first = i === 0 && rn.start;
                ctx.fillStyle = "rgb(" + col + ")";
                ctx.beginPath(); ctx.arc(pt.x, pt.y, first ? r + 1.4 : r, 0, Math.PI * 2); ctx.fill();
                if (first) { ctx.strokeStyle = "#101820"; ctx.lineWidth = 1; ctx.stroke(); }
              });
            });
          });
        } };
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
            if (!self.chart || !self.series || !self.times.length || self.hidden) return;
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
                if (zone.fibLine) { ctx.save(); ctx.globalAlpha = reveal; drawFibLine(ctx, timeScale, self.series, zone, start, right); ctx.restore(); return; }
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

  // From [time, open, high, low, close, volume] rows and the RSI above:
  //   Supertrend 10/3  ATR 10 (Wilder, alpha = 1/10 from the first true range); bands (high+low)/2 +/- 3 ATR, each
  //                    band only tightens until the close crosses it; the line is the lower band while the
  //                    direction is up and the upper band while it is down (dir 1 / -1).
  //   Parabolic SAR    0.02 start and step, 0.2 cap; the SAR never enters the two previous candles' range.
  //   Stochastic RSI   14/14/3/3: where RSI 14 sits in its last 14 values (0-100), %K = 3-candle average of that,
  //                    %D = 3-candle average of %K.
  //   OBV              volume added on a higher close, taken off on a lower one, from 0 at the first loaded candle
  //                    (its level depends on where the history starts; its direction is what counts).
  //   Ichimoku 9/26/52 Tenkan = middle of the 9-candle high/low, Kijun = the same over 26, Senkou A = (Tenkan +
  //                    Kijun) / 2 and Senkou B = middle of 52, both drawn 26 candles ahead (the cloud), Chikou = the
  //                    close drawn 26 candles back.
  //   VWAP             cumulative (typical price x volume) / cumulative volume, restarting each UTC day on 1H, week
  //                    (Monday) on 4H, month on 1D and year on 1W (vwapKey: the period a candle belongs to).
  function vwapPeriod(sec, tf) {
    var d = new Date(sec * 1000);
    if (tf === "1h") return d.toISOString().slice(0, 10);
    if (tf === "4h") return new Date((sec - ((d.getUTCDay() + 6) % 7) * 86400) * 1000).toISOString().slice(0, 10);
    if (tf === "1d") return d.toISOString().slice(0, 7);
    return d.toISOString().slice(0, 4);
  }
  function extraIndicators(rows, rsi, tf) {
    var n = rows.length, out = { tenkan: new Array(n), kijun: new Array(n), spanA: new Array(n), spanB: new Array(n), vwap: new Array(n), vwapKey: new Array(n), st: new Array(n), stDir: new Array(n), psar: new Array(n), psarDir: new Array(n), srsiK: new Array(n), srsiD: new Array(n), obv: new Array(n) };
    var atr = null, fub = null, flb = null, dir = 1, obv = 0, stoch = new Array(n);
    for (var i = 0; i < n; i++) {
      var h = rows[i][2], l = rows[i][3], c = rows[i][4], v = Number(rows[i][5]) || 0;
      if (i > 0) {
        var pc = rows[i - 1][4], tr = Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc));
        atr = atr === null ? tr : atr + (tr - atr) / 10;
        var mid = (h + l) / 2, ub = mid + 3 * atr, lb = mid - 3 * atr;
        if (fub === null) { fub = ub; flb = lb; dir = c >= mid ? 1 : -1; }
        else {
          fub = ub < fub || pc > fub ? ub : fub;
          flb = lb > flb || pc < flb ? lb : flb;
          dir = dir === -1 ? (c > fub ? 1 : -1) : (c < flb ? -1 : 1);
        }
        out.st[i] = dir === 1 ? flb : fub; out.stDir[i] = dir;
        obv += c > pc ? v : c < pc ? -v : 0;
      }
      out.obv[i] = obv;
      // Stochastic RSI
      if (i >= 14 && rsi[i] != null) {
        var lo = Infinity, hi = -Infinity, ok = true;
        for (var k = i - 13; k <= i; k++) { if (rsi[k] == null) { ok = false; break; } lo = Math.min(lo, rsi[k]); hi = Math.max(hi, rsi[k]); }
        if (ok) stoch[i] = hi > lo ? (rsi[i] - lo) / (hi - lo) * 100 : (i > 0 && stoch[i - 1] != null ? stoch[i - 1] : 50);
      }
      if (stoch[i] != null && stoch[i - 1] != null && stoch[i - 2] != null) out.srsiK[i] = (stoch[i] + stoch[i - 1] + stoch[i - 2]) / 3;
      if (out.srsiK[i] != null && out.srsiK[i - 1] != null && out.srsiK[i - 2] != null) out.srsiD[i] = (out.srsiK[i] + out.srsiK[i - 1] + out.srsiK[i - 2]) / 3;
    }
    // Ichimoku: middle of the highest high and lowest low over the last `len` candles.
    function midHL(i, len) { if (i < len - 1) return null; var hi = -Infinity, lo = Infinity; for (var k = i - len + 1; k <= i; k++) { hi = Math.max(hi, rows[k][2]); lo = Math.min(lo, rows[k][3]); } return (hi + lo) / 2; }
    var pv = 0, vol = 0, key = null;
    for (var q = 0; q < n; q++) {
      out.tenkan[q] = midHL(q, 9); out.kijun[q] = midHL(q, 26);
      out.spanA[q] = out.tenkan[q] != null && out.kijun[q] != null ? (out.tenkan[q] + out.kijun[q]) / 2 : null; out.spanB[q] = midHL(q, 52);
      var k2 = vwapPeriod(rows[q][0], tf), vq = Number(rows[q][5]) || 0, typ = (rows[q][2] + rows[q][3] + rows[q][4]) / 3;
      if (k2 !== key) { key = k2; pv = 0; vol = 0; }
      pv += typ * vq; vol += vq; out.vwap[q] = vol > 0 ? pv / vol : typ; out.vwapKey[q] = k2;
    }
    // Parabolic SAR
    if (n > 1) {
      var up = rows[1][4] >= rows[0][4], sar = up ? rows[0][3] : rows[0][2], ep = up ? rows[1][2] : rows[1][3], af = 0.02;
      out.psar[1] = sar; out.psarDir[1] = up ? 1 : -1;
      for (var j = 2; j < n; j++) {
        var hj = rows[j][2], lj = rows[j][3];
        sar = sar + af * (ep - sar);
        if (up) {
          sar = Math.min(sar, rows[j - 1][3], rows[j - 2][3]);
          if (lj < sar) { up = false; sar = ep; ep = lj; af = 0.02; }
          else if (hj > ep) { ep = hj; af = Math.min(af + 0.02, 0.2); }
        } else {
          sar = Math.max(sar, rows[j - 1][2], rows[j - 2][2]);
          if (hj > sar) { up = true; sar = ep; ep = hj; af = 0.02; }
          else if (lj < ep) { ep = lj; af = Math.min(af + 0.02, 0.2); }
        }
        out.psar[j] = sar; out.psarDir[j] = up ? 1 : -1;
      }
    }
    return out;
  }

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
  // Number and date formats are built once per locale and option set: the chart asks for a price label for every
  // axis tick on every frame, and building a new format each time was the biggest cost while panning and zooming.
  var fmtCache = {};
  function numFormat(locale, d) {
    var k = "n|" + locale + "|" + d;
    return fmtCache[k] || (fmtCache[k] = new Intl.NumberFormat(locale, { minimumFractionDigits: d, maximumFractionDigits: d }));
  }
  function cachedFormat(kind, locale, options) {
    var k = kind + "|" + locale + "|" + JSON.stringify(options);
    return fmtCache[k] || (fmtCache[k] = kind === "date" ? new Intl.DateTimeFormat(locale, options) : new Intl.NumberFormat(locale, options));
  }

  function build(LC, container, state) {
    container.textContent = "";
    var decimals = state.decimals;
    // Numbers on the price axes follow the page language. A chart-wide priceFormatter would also force the asset's
    // decimals onto every pane (the comparison ratio needs its own), so each series gets a formatter of its own
    // instead (addSeries below): the asset's decimals, as before, unless the series brings a custom one.
    function localization() { return { locale: pageLocale() }; }
    function localFormat(pf) {
      var minMove = pf && pf.minMove != null ? pf.minMove : pf && pf.precision != null ? Math.pow(10, -pf.precision) : pf && pf.type === "volume" ? 1 : 0.01;
      return { type: "custom", minMove: minMove, formatter: function (price) { return numFormat(pageLocale(), decimals == null ? 2 : decimals).format(Number(price)); } };
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
    var addSeriesRaw = chart.addSeries.bind(chart);
    chart.addSeries = function (type, options, pane) {
      options = Object.assign({}, options || {});
      if (!options.priceFormat || options.priceFormat.type !== "custom") options.priceFormat = localFormat(options.priceFormat);
      return addSeriesRaw(type, options, pane);
    };
    var candles = chart.addSeries(LC.CandlestickSeries, {
      upColor: "#55d99c", downColor: "#ef6e76", borderVisible: false, wickUpColor: "#55d99c", wickDownColor: "#ef6e76",
      priceLineVisible: false
    });
    // Volume lives in its own pane below the price pane, so zone bands (drawn on the price pane)
    // and volume bars can never overlap, whatever the zoom.
    // Volume in US dollars (README "Chart volume"): the candle files carry the coin volume, so each bar is that times the
    // candle's close, an approximation of the dollar volume. Only the bars and the legend use it; VWAP, OBV and the
    // indicator card keep the coin volume, as their definitions use.
    function usdVolume(r) { return (Number(r[5]) || 0) * (Number(r[4]) || 0); }
    var volume = chart.addSeries(LC.HistogramSeries, { priceFormat: { type: "custom", minMove: 1, formatter: function (v) { return cachedFormat("num", pageLocale(), { notation: "compact", maximumFractionDigits: 1 }).format(Number(v)); } },
      priceLineVisible: false, lastValueVisible: false }, 1);
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
    var IND_PANE = 130, indPaneCount = 0, indPrefs = { bb: false, rsi: false, macd: false, st: false, psar: false, srsi: false, obv: false, ichi: false, vwap: false }, indSeries = {};
    function sizePanes() {
      var panes = chart.panes(), height = container.clientHeight;
      // Stretch factors are relative, so each pane gets its height in pixels and the price pane the rest.
      if (panes.length > 1 && height > 0) {
        // Indicator panes keep IND_PANE px, but together never more than 40% of a chart whose height is fixed (full
        // screen on a phone on its side), so the price pane stays readable.
        var n = panes.length - 2, each = n > 0 ? Math.min(IND_PANE, Math.max(36, Math.floor(height * 0.4 / n))) : 0;
        var ind = n * each, vol = Math.max(48, Math.round((height - ind) * 0.16));
        panes[0].setStretchFactor(Math.max(1, height - ind - vol));
        panes[1].setStretchFactor(vol);
        for (var p = 2; p < panes.length; p++) panes[p].setStretchFactor(each);
      }
      sizeWatermark();
      if (typeof placeCmpLabels === "function" && cmp) requestAnimationFrame(placeCmpLabels);
    }
    sizePanes();
    // The stylesheet sets the chart's height; indicator panes are added below it, so it is measured again
    // without the inline height whenever the panes or the window change.
    function fitHeight() {
      container.style.height = "";
      if (indPaneCount > 0) container.style.height = (container.clientHeight + indPaneCount * IND_PANE) + "px";
      sizePanes();
    }
    // autoSize follows the container through a ResizeObserver, but some phone browsers miss the change when the
    // screen turns (the chart stayed at its upright width). After a turn, a window resize or a full-screen change the
    // chart is checked against its container a few times and resized when they differ.
    var fitTimers = [];
    function fitNow() {
      if (destroyed) return;
      // The drawn size is the chart's table (its element stretches with the container whatever is drawn).
      var el = chart.chartElement(), t = el && el.querySelector("table"), w = container.clientWidth, h = container.clientHeight;
      if (!t || !w || !h || (Math.abs(t.offsetWidth - w) <= 1 && Math.abs(t.offsetHeight - h) <= 1)) return;
      chart.applyOptions({ autoSize: false }); chart.resize(w, h, true); chart.applyOptions({ autoSize: true });
      sizePanes();
    }
    function scheduleFit() {
      fitTimers.forEach(clearTimeout);
      fitTimers = [60, 300, 800].map(function (ms) { return setTimeout(fitNow, ms); });
    }
    function onWindowResize() { if (indPaneCount > 0) fitHeight(); scheduleFit(); }
    window.addEventListener("resize", onWindowResize);
    window.addEventListener("orientationchange", scheduleFit);
    document.addEventListener("fullscreenchange", scheduleFit);
    var paneObserver = window.ResizeObserver ? new ResizeObserver(sizePanes) : null;
    if (paneObserver) paneObserver.observe(container);
    var emaColors = ["#ff6975", "#6fb5ff", "#e7d98c"], emas = emaColors.map(function (color) {
      return chart.addSeries(LC.LineSeries, { color: color, lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
    });
    // Price Action AVWAP (README "Price Action view"): near-white long-dashed curve from the report's points.
    var avwap = chart.addSeries(LC.LineSeries, { color: "#f2f4f8", lineWidth: 2, lineStyle: LC.LineStyle.LargeDashed, priceLineVisible: false,
      lastValueVisible: true, title: "AVWAP", crosshairMarkerVisible: false, visible: false }), avwapPoints = [];
    var zones = new ZonesPrimitive(), zoneList = [], baseZones = [], fvgZones = [], structureZones = [], lastValidZones = [], fibZones = [];
    candles.attachPrimitive(zones);
    var eventMarks = new EventsPrimitive();
    var stLine = new TrendLinePrimitive(), sarDots = new SarPrimitive(), ichi = new IchimokuPrimitive(), vwapLine = new TrendLinePrimitive();
    candles.attachPrimitive(eventMarks);
    // Time (seconds) to logical index, interpolated between candles and run on in candle steps past the last one.
    eventMarks.logical = function (t) {
      var T = indicatorTimes(), n = T.length, step = STEP[state.tf];
      if (!n) return null;
      if (t < T[0]) return null;
      if (t >= T[n - 1]) return n - 1 + (t - T[n - 1]) / step;
      var lo = 0, hi = n - 1; while (hi - lo > 1) { var m = (lo + hi) >> 1; if (T[m] <= t) lo = m; else hi = m; }
      return lo + (t - T[lo]) / (T[hi] - T[lo]);
    };
    candles.attachPrimitive(ichi); candles.attachPrimitive(stLine); candles.attachPrimitive(sarDots); candles.attachPrimitive(vwapLine);
    var structurePoints = new PointsPrimitive(function () { return times(); });
    candles.attachPrimitive(structurePoints);
    // Zone tooltip: hovering (or tapping) a band shows its name and price range. The narrowest band under the
    // pointer wins, so a band inside another is still reachable. Lines (structure, Fibonacci levels) are skipped.
    var zoneTip = document.createElement("div");
    zoneTip.style.cssText = "position:absolute;z-index:6;display:none;pointer-events:none;padding:5px 9px;border:1px solid #3a4654;border-radius:7px;" +
      "background:rgba(14,16,22,.94);color:#eef1f7;font:600 12px " + WATERMARK_FONT + ";white-space:nowrap;box-shadow:0 6px 18px rgba(0,0,0,.35)";
    container.appendChild(zoneTip);
    var ZONE_NAMES = {
      en: { rh: "RH", eq: "EQ", rl: "RL", fvg: "FVG", lastValid: "Last valid range" },
      tr: { rh: "RH", eq: "EQ", rl: "RL", fvg: "FVG", lastValid: "Son geçerli aralık" }
    };
    function zoneName(zone) {
      var n = ZONE_NAMES[document.documentElement.lang === "tr" ? "tr" : "en"];
      var rangeView = baseZones.some(function (z) { return z.type === "equilibrium"; }); // Price Action: the range's three bands
      if (zone.layer === "PA_FVG") return zone.label || n.fvg;
      if (zone.layer === "PA_FIB") return zone.label ? "Fibonacci " + zone.label : "Fibonacci";
      if (zone.layer === "PA_LAST_VALID") return n.lastValid;
      if (rangeView) return zone.type === "resistance" ? n.rh : zone.type === "support" ? n.rl : n.eq;
      return ""; // Critical Zones: the range alone (the colour already says support or resistance)
    }
    function fmtPrice(v) { var d = decimals == null ? 2 : decimals; return numFormat(pageLocale(), d).format(Number(v)); }
    function showEventTip(param) {
      var h = chart.panes()[0].getHeight();
      if (!eventMarks.events.length || param.point.y < h - 22) return false;
      var near = eventMarks.positions(h).filter(function (p) { return Math.abs(p.x - param.point.x) <= 7; });
      if (!near.length) return false;
      zoneTip.innerHTML = near.map(function (p) {
        var e = p.e, d = new Date(e.time * 1000), when = cachedFormat("date", pageLocale(), Object.assign({ timeZone: "UTC", day: "numeric", month: "short" }, e.dateOnly ? {} : { hour: "2-digit", minute: "2-digit", hourCycle: "h23" })).format(d);
        var esc = function (x) { return String(x).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); };
        return '<div style="font-weight:600">' + esc(e.title) + '</div><div style="font-weight:400;color:#9aa6b6">' + esc(when) + (e.dateOnly ? "" : " UTC") + (e.country ? " · " + esc(e.country) : "") + "</div>";
      }).join('<div style="height:6px"></div>');
      zoneTip.style.display = "block"; zoneTip.style.whiteSpace = "normal"; zoneTip.style.maxWidth = "260px";
      var w = zoneTip.offsetWidth, th = zoneTip.offsetHeight, x = Math.max(4, Math.min(param.point.x - w / 2, container.clientWidth - w - 4));
      zoneTip.style.left = x + "px"; zoneTip.style.top = Math.max(4, h - 22 - th - 6) + "px";
      return true;
    }
    function showZoneTip(param) {
      if (!param || !param.point || (param.paneIndex != null && param.paneIndex !== 0)) { zoneTip.style.display = "none"; return; }
      if (zones.hidden) { if (showEventTip(param)) return; zoneTip.style.display = "none"; return; }
      if (showEventTip(param)) return;
      zoneTip.style.whiteSpace = "nowrap"; zoneTip.style.maxWidth = "";
      // A tap can come without a time (touch); take it from the x position, and past the last candle use the last one.
      var price = candles.coordinateToPrice(param.point.y), t = times(), hit = null;
      var time = param.time != null ? param.time : chart.timeScale().coordinateToTime(param.point.x);
      if (time == null && t.length) time = t[t.length - 1];
      if (price == null) { zoneTip.style.display = "none"; return; }
      zoneList.forEach(function (z) {
        if (z.line || z.fibLine) return;
        var lo = Math.min(Number(z.low), Number(z.high)), hi = Math.max(Number(z.low), Number(z.high));
        if (!(price >= lo && price <= hi)) return;
        var start = zoneStart(z, t);
        if (!start || time == null || time < start.time) return;
        if (!hit || hi - lo < hit.hi - hit.lo) hit = { z: z, lo: lo, hi: hi };
      });
      if (!hit) { zoneTip.style.display = "none"; return; }
      var name = zoneName(hit.z);
      zoneTip.textContent = (name ? name + "  " : "") + fmtPrice(hit.lo) + " – " + fmtPrice(hit.hi);

      zoneTip.style.display = "block";
      var w = zoneTip.offsetWidth, h = zoneTip.offsetHeight, maxX = container.clientWidth - w - 4;
      var x = Math.max(4, Math.min(param.point.x + 14, maxX)), y = param.point.y - h - 10;
      if (y < 4) y = param.point.y + 14;
      zoneTip.style.left = x + "px"; zoneTip.style.top = y + "px";
    }
    chart.subscribeCrosshairMove(showZoneTip);
    chart.subscribeClick(showZoneTip); // phones: a tap shows the band under the finger
    function hideZoneTip() { zoneTip.style.display = "none"; }
    container.addEventListener("mouseleave", hideZoneTip);
    // A tapped tooltip must not outlive what it described: scrolling, zooming or new zones / candles clear it.
    chart.timeScale().subscribeVisibleLogicalRangeChange(function () { if (zoneTip.style.display !== "none") hideZoneTip(); });
    // Candle legend (top left, like most charting tools): date, open, high, low, close, the change from the previous
    // close and the volume of the candle under the pointer; the newest candle when the pointer is off the chart.
    var legend = document.createElement("div");
    legend.className = "lc-legend";
    legend.style.cssText = "position:absolute;left:8px;top:6px;z-index:5;pointer-events:none;display:flex;flex-wrap:wrap;gap:2px 10px;max-width:calc(100% - 90px);" +
      "font:500 11.5px " + WATERMARK_FONT + ";color:#8f9aab;font-variant-numeric:tabular-nums;text-shadow:0 0 3px #101820,0 0 3px #101820";
    container.appendChild(legend);
    // Quick comparison labels (README "Quick comparison"): under the legend on the price pane, and on the ratio pane.
    var cmpLabel = document.createElement("div"), ratioLabel = document.createElement("div");
    [cmpLabel, ratioLabel].forEach(function (el) {
      el.style.cssText = "position:absolute;left:8px;z-index:5;pointer-events:none;display:none;max-width:calc(100% - 90px);font:500 11.5px " + WATERMARK_FONT +
        ";color:#8f9aab;font-variant-numeric:tabular-nums;text-shadow:0 0 3px #101820,0 0 3px #101820";
      container.appendChild(el);
    });
    var LEGEND_WORDS = { en: { o: "O", h: "H", l: "L", c: "C", v: "Vol" }, tr: { o: "A", h: "Y", l: "D", c: "K", v: "Hacim" } };
    function legendDate(sec) {
      var intraday = state.tf === "1h" || state.tf === "4h", o = { timeZone: "UTC", day: "numeric", month: "short", year: "numeric" };
      if (intraday) { o.hour = "2-digit"; o.minute = "2-digit"; o.hourCycle = "h23"; }
      return cachedFormat("date", pageLocale(), o).format(new Date(sec * 1000)) + (intraday ? " UTC" : "");
    }
    var legendHover = false;
    function refreshLegend() { if (!legendHover) showLegend(null); }
    function showLegend(param) {
      var bar = null, vol = null, idx = null;
      if (param && param.time != null && param.seriesData && (param.paneIndex == null || param.paneIndex >= 0)) {
        bar = param.seriesData.get(candles); var v = param.seriesData.get(volume); vol = v ? v.value : null; idx = param.logical;
      }
      legendHover = !!(bar && bar.open != null);
      if (!bar || bar.open == null) {
        var all = candles.data(); if (!all.length) { legend.textContent = ""; return; }
        idx = all.length - 1; bar = all[idx]; var vs = volume.data(); vol = vs.length ? vs[vs.length - 1].value : null;
      }
      var prev = idx != null && idx > 0 && candles.dataByIndex ? candles.dataByIndex(Math.round(idx) - 1) : null;
      var w = LEGEND_WORDS[document.documentElement.lang === "tr" ? "tr" : "en"], up = bar.close >= bar.open, col = up ? "#55d99c" : "#ef6e76";
      var base = prev && prev.close != null ? prev.close : bar.open, chg = base ? (bar.close / base - 1) * 100 : null;
      function item(k, v) { return '<span>' + k + ' <b style="color:' + col + ';font-weight:600">' + v + "</b></span>"; }
      var html = '<span style="color:#c7cfde">' + legendDate(bar.time) + "</span>" + item(w.o, fmtPrice(bar.open)) + item(w.h, fmtPrice(bar.high)) +
        item(w.l, fmtPrice(bar.low)) + item(w.c, fmtPrice(bar.close));
      if (chg != null) {
        var p = numFormat(pageLocale(), 2).format(Math.abs(chg)), sg = chg > 0 ? "+" : chg < 0 ? "−" : "";
        html += '<b style="color:' + (chg >= 0 ? "#55d99c" : "#ef6e76") + ';font-weight:600">' + sg + (pageLocale() === "tr-TR" ? "%" + p : p + "%") + "</b>";
      }
      if (vol != null) {
        var vtxt = cachedFormat("num", pageLocale(), { notation: "compact", maximumFractionDigits: 2 }).format(Number(vol));
        html += "<span>" + w.v + ' <b style="color:#c7cfde;font-weight:600">' + (pageLocale() === "tr-TR" ? vtxt + " $" : "$" + vtxt) + "</b></span>";
      }
      legend.innerHTML = html;
    }
    chart.subscribeCrosshairMove(showLegend);
    container.addEventListener("mouseleave", function () { showLegend(null); });
    var sweepMarkers = LC.createSeriesMarkers ? LC.createSeriesMarkers(candles, []) : null;
    var liveLine = null, loadingOlder = false, destroyed = false, generation = 0;
    var forming = null, liveStatus = "pending", socket = null, retryTimer = null, socketFailures = 0;
    function allRows() { return state.rows.concat(state.tail); }
    // Candle times, rebuilt only when the candle list changes (they are read on every frame by the event marks,
    // the zones and the drawing tools). Callers must not change the returned array.
    var timesCache = { rows: null, rl: -1, tail: null, tl: -1, list: [] }, indTimesCache = { base: null, forming: null, list: [] };
    function times() {
      var c = timesCache;
      if (c.rows !== state.rows || c.rl !== state.rows.length || c.tail !== state.tail || c.tl !== state.tail.length) {
        c.rows = state.rows; c.rl = state.rows.length; c.tail = state.tail; c.tl = state.tail.length;
        c.list = allRows().map(function (r) { return r[0]; });
      }
      return c.list;
    }
    function indicatorTimes() {
      var base = times(), c = indTimesCache, ft = forming ? forming[0] : null;
      if (c.base !== base || c.forming !== ft) { c.base = base; c.forming = ft; c.list = ft == null ? base : base.concat([ft]); }
      return c.list;
    }
    function notify() { if (state.onChange) try { state.onChange(); } catch (error) { /* page re-render only */ } }

    function applyPrecision() {
      if (decimals == null) return;
      var format = localFormat({ minMove: Math.pow(10, -decimals) });
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
    var indDataCache = { key: null, data: null };
    function indicatorDataNow() {
      var rows = allRows(), v = indicators(rows.map(function (r) { return r[4]; })), x = extraIndicators(rows, v.rsi, state.tf);
      return { tf: state.tf, tenkan: x.tenkan, kijun: x.kijun, spanA: x.spanA, spanB: x.spanB, vwap: x.vwap, vwapKey: x.vwapKey, volume: rows.map(function (r) { return r[5]; }), st: x.st, stDir: x.stDir, psar: x.psar, psarDir: x.psarDir, srsiK: x.srsiK, srsiD: x.srsiD, obv: x.obv, time: rows.map(function (r) { return r[0]; }), high: rows.map(function (r) { return r[2]; }), low: rows.map(function (r) { return r[3]; }), close: rows.map(function (r) { return r[4]; }),
        ema: [0, 1, 2].map(function (i) { return rows.map(function (r) { return r[6 + i]; }); }), rsi: v.rsi, macd: v.macd, signal: v.signal, hist: v.hist, bbUpper: v.bbUpper, bbMid: v.bbMid, bbLower: v.bbLower, warmup: IND_WARMUP };
    }
    function indicatorRows() { var rows = allRows(); return forming ? rows.concat([forming]) : rows; }
    function drawIndicators() {
      var onPrice = indPrefs.st || indPrefs.psar || indPrefs.ichi || indPrefs.vwap;
      if (!Object.keys(indSeries).length && !onPrice) { stLine.set([]); sarDots.set([]); ichi.set(null); vwapLine.set([]); return; }
      var rows = indicatorRows(), v = indicators(rows.map(function (r) { return r[4]; })), warm = Math.min(IND_WARMUP, Math.max(0, rows.length - 1));
      var x = onPrice || indSeries.srsiK || indSeries.obv ? extraIndicators(rows, v.rsi, state.tf) : null;
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
      // Supertrend: green under the candles while the direction is up, red above them while it is down; a gap
      // (whitespace point) where the direction turns, so the two lines never join.
      var stPoints = [];
      if (indPrefs.st && x) for (var s1 = Math.min(20, rows.length); s1 < rows.length; s1++) if (x.st[s1] != null) stPoints.push({ time: rows[s1][0], value: x.st[s1], dir: x.stDir[s1] });
      stLine.set(stPoints);
      var ps = [];
      if (indPrefs.psar && x) for (var s2 = Math.min(20, rows.length); s2 < rows.length; s2++) if (x.psar[s2] != null) ps.push({ time: rows[s2][0], value: x.psar[s2], dir: x.psarDir[s2], start: x.psarDir[s2 - 1] != null && x.psarDir[s2 - 1] !== x.psarDir[s2] });
      sarDots.set(ps);
      ichi.set(indPrefs.ichi && x ? { from: Math.min(26, rows.length), tenkan: x.tenkan, kijun: x.kijun, spanA: x.spanA, spanB: x.spanB, close: rows.map(function (r) { return r[4]; }) } : null);
      var vw = [];
      if (indPrefs.vwap && x) for (var s3 = 0; s3 < rows.length; s3++) vw.push({ time: rows[s3][0], value: x.vwap[s3], dir: x.vwapKey[s3], color: "#ffb03a" });
      vwapLine.set(vw);
      if (indSeries.srsiK) { indSeries.srsiK.setData(points(x.srsiK, warm)); indSeries.srsiD.setData(points(x.srsiD, warm)); }
      if (indSeries.obv) indSeries.obv.setData(points(x.obv, 1));
      drawCompare(rows);
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
      if (indPrefs.srsi) {
        var pct = { type: "price", precision: 1, minMove: 0.1 }, range = function () { return { priceRange: { minValue: 0, maxValue: 100 } }; };
        indSeries.srsiK = chart.addSeries(LC.LineSeries, line("#6fb5ff", { lineWidth: 1.5, lastValueVisible: true, title: "Stoch RSI", priceFormat: pct, autoscaleInfoProvider: range }), pane);
        indSeries.srsiD = chart.addSeries(LC.LineSeries, line("#ff9f43", { priceFormat: pct, autoscaleInfoProvider: range }), pane);
        [80, 20].forEach(function (level) { indSeries.srsiK.createPriceLine({ price: level, color: "rgba(154,170,181,0.55)", lineWidth: 1, lineStyle: LC.LineStyle.Dashed, axisLabelVisible: true, title: "" }); });
        pane++;
      }
      if (indPrefs.macd) {
        var macdFormat = { type: "price", precision: Math.max(2, decimals == null ? 2 : decimals), minMove: Math.pow(10, -Math.max(2, decimals == null ? 2 : decimals)) };
        indSeries.hist = chart.addSeries(LC.HistogramSeries, { priceLineVisible: false, lastValueVisible: false, priceFormat: macdFormat }, pane);
        indSeries.macd = chart.addSeries(LC.LineSeries, line("#6fb5ff", { lineWidth: 1.5, lastValueVisible: true, title: "MACD 12/26/9", priceFormat: macdFormat }), pane);
        indSeries.signal = chart.addSeries(LC.LineSeries, line("#ff9f43", { priceFormat: macdFormat }), pane);
        pane++;
      }
      if (indPrefs.obv) indSeries.obv = chart.addSeries(LC.LineSeries, line("#e7d98c", { lineWidth: 1.5, lastValueVisible: true, title: "OBV", priceFormat: { type: "volume" } }), pane++);
      if (cmp) {
        indSeries.cmpLine = chart.addSeries(LC.LineSeries, line(CMP_COLOR, Object.assign({ lineWidth: 1.5, autoscaleInfoProvider: function () { return null; } }, priceFormat ? { priceFormat: priceFormat } : {})), 0);
        indSeries.ratio = chart.addSeries(LC.LineSeries, line(CMP_COLOR, { lineWidth: 1.5, lastValueVisible: true }), pane++);
      }
      // The chart grows by one pane height for each indicator pane, so the candles keep their room.
      indPaneCount = pane - 2;
      fitHeight();
      drawIndicators();
      drawDivergences();
      requestAnimationFrame(placeCmpLabels);
    }

    // Divergences (README "Indicator summary"): a dashed line between the two swing points on the candles and, when
    // that pane is open, between the same two points on the RSI or MACD line. Green: positive, red: negative.
    // ---- Quick comparison (README "Quick comparison") ----
    // Another analysed asset on the same timeframe: its closes as a line on the price pane that starts on this asset's
    // close at the left edge of the view and follows the other asset's moves from there (see cmpRescale), its ratio in a
    // pane of its own, and the correlation of their candle-to-candle returns over the last 30 and 90 candles.
    // Only candles both have are used. The line does not take part in the price axis's autoscale, so the candles keep
    // their scale. The page passes the other asset's live price (setCompareLive) for the forming candle.
    var CMP_COLOR = "#c6f36b", QUOTES = ["BTC", "ETH"], cmp = null, cmpGen = 0;
    function cmpWords() {
      return document.documentElement.lang === "tr"
        ? { vs: "Karşılaştırma", range: "görünür aralıkta", corr: "Korelasyon", candles: "mum", wait: "yükleniyor…" }
        : { vs: "Comparison", range: "over the visible range", corr: "Correlation", candles: "candles", wait: "loading…" };
    }
    function baseOf(pair) { return String(pair).replace(/(USDT|USDC|FDUSD|BUSD|USD|TRY|EUR)$/, "") || pair; }
    function loadCompare() {
      var my = ++cmpGen;
      if (!cmp || cmp.pair === state.pair) { cmp = null; layoutIndicators(); return Promise.resolve(); }
      var pair = cmp.pair, tf = state.tf;
      cmp.map = null; cmp.tf = tf; layoutIndicators();
      return loadIndex().then(function (index) {
        var entry = index.pairs && index.pairs[pair] && index.pairs[pair][tf];
        if (!entry) throw new Error("no candles for " + pair + " " + tf);
        var archives = (entry.archives || []).slice(), names = (MONTHLY[tf] ? archives.slice(-PAGE) : archives).concat(["latest"]);
        return loadPeriods(pair, tf, names);
      }).then(function (files) {
        if (destroyed || my !== cmpGen || !cmp || cmp.pair !== pair || state.tf !== tf) return;
        var map = {}; mergeRows([], files).forEach(function (r) { map[r[0]] = Number(r[4]); });
        cmp.map = map; layoutIndicators();
      }).catch(function () { if (!destroyed && my === cmpGen && cmp && cmp.pair === pair) { cmp.map = {}; layoutIndicators(); } });
    }
    function pctText(r) {
      var v = numFormat(pageLocale(), 2).format(Math.abs(r * 100)), sg = r > 0 ? "+" : r < 0 ? "−" : "";
      return sg + (pageLocale() === "tr-TR" ? "%" + v : v + "%");
    }
    function corrOf(a, b, n) {
      var x = [], y = [];
      for (var i = Math.max(1, a.length - n); i < a.length; i++) { x.push(Math.log(a[i] / a[i - 1])); y.push(Math.log(b[i] / b[i - 1])); }
      if (x.length < n) return null;
      var mx = 0, my = 0; x.forEach(function (v, i) { mx += v; my += y[i]; }); mx /= x.length; my /= y.length;
      var sxy = 0, sxx = 0, syy = 0; x.forEach(function (v, i) { var dx = v - mx, dy = y[i] - my; sxy += dx * dy; sxx += dx * dx; syy += dy * dy; });
      return sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : null;
    }
    var cmpAligned = null, cmpAnchor = "", cmpFrame = 0;
    // The line starts where the visible range starts (TradingView's "same % scale", on this chart's price axis): at
    // the first visible common candle it equals this asset's close, and from there it moves by the other asset's
    // percentage changes. Above the candles: the other asset did better since the left edge; below: worse. Scrolling
    // or zooming moves the starting point to the new left edge (redrawn once per frame at most).
    // Index range of the common candles on screen: [first visible, last visible].
    function cmpSpan() {
      var t = cmpAligned.t, r = chart.timeScale().getVisibleRange(), n = t.length;
      if (!r || typeof r.from !== "number") return [0, n - 1];
      var lo = 0, hi = n; while (lo < hi) { var m = (lo + hi) >> 1; if (t[m] < r.from) lo = m + 1; else hi = m; }
      var i0 = Math.min(lo, n - 1); lo = i0; hi = n;
      while (lo < hi) { var k = (lo + hi) >> 1; if (t[k] <= r.to) lo = k + 1; else hi = k; }
      return [i0, Math.max(i0, lo - 1)];
    }
    // Only the candles on screen are drawn (a frame stays cheap while scrolling); redrawn when the view's first or last
    // common candle changes.
    function cmpRescale() {
      if (!cmp || !cmpAligned || !cmpAligned.t.length || !indSeries.cmpLine) return;
      var span = cmpSpan(), key = span[0] + ":" + span[1];
      if (key === cmpAnchor) return;
      cmpAnchor = key;
      var t = cmpAligned.t, a = cmpAligned.a, b = cmpAligned.b, i0 = span[0], f = a[i0] / b[i0], line = [];
      for (var i = i0; i <= span[1]; i++) line.push({ time: t[i], value: b[i] * f });
      indSeries.cmpLine.setData(line);
    }
    function drawCompare(rows) {
      if (!cmp || !indSeries.cmpLine) { cmpAligned = null; cmpLabel.style.display = ratioLabel.style.display = "none"; return; }
      var w = cmpWords(), name = baseOf(cmp.pair);
      if (!cmp.map) { cmpLabel.textContent = w.vs + ": " + name + " · " + w.wait; cmpLabel.style.display = "block"; ratioLabel.style.display = "none"; return; }
      var t = [], a = [], b = [];
      rows.forEach(function (r, i) {
        var other = cmp.map[r[0]];
        if (other == null && forming && i === rows.length - 1 && r === forming && cmp.live > 0) other = cmp.live;
        if (other > 0 && r[4] > 0) { t.push(r[0]); a.push(r[4]); b.push(other); }
      });
      cmpAligned = { t: t, a: a, b: b };
      if (!t.length) { indSeries.cmpLine.setData([]); indSeries.ratio.setData([]); cmpLabel.style.display = ratioLabel.style.display = "none"; return; }
      // The ratio is quoted the usual way: in BTC when one of the two is BTC, else in ETH, else this asset in the other
      // (BTC chart compared with BNB → BNB/BTC; ETH with SOL → SOL/ETH; SOL with XRP → SOL/XRP).
      var rank = function (pair) { var i = QUOTES.indexOf(baseOf(pair)); return i < 0 ? 99 : i; }, flip = rank(state.pair) < rank(cmp.pair);
      var ratio = [];
      for (var i = 0; i < t.length; i++) ratio.push({ time: t[i], value: flip ? b[i] / a[i] : a[i] / b[i] });
      indSeries.ratio.setData(ratio);
      cmpAnchor = ""; cmpRescale();
      var last = ratio[ratio.length - 1].value, d = last >= 100 ? 2 : last >= 1 ? 4 : Math.min(8, Math.ceil(-Math.log10(last)) + 3);
      // A formatter of its own: the chart-wide price formatter would print the ratio with this asset's few decimals.
      if (indSeries.ratio.__d !== d) { indSeries.ratio.__d = d; indSeries.ratio.applyOptions({ priceFormat: { type: "custom", minMove: Math.pow(10, -d), formatter: function (v) { return numFormat(pageLocale(), d).format(v); } } }); }
      var r30 = corrOf(a, b, 30), r90 = corrOf(a, b, 90), c2 = function (v) { return v == null ? "–" : numFormat(pageLocale(), 2).format(v); };
      ratioLabel.textContent = (flip ? name + "/" + baseOf(state.pair) : baseOf(state.pair) + "/" + name) + " " + numFormat(pageLocale(), d).format(last) + "  ·  " + w.corr + " (30 / 90 " + w.candles + "): " + c2(r30) + " / " + c2(r90);
      ratioLabel.style.display = "block";
      cmpVisible(); placeCmpLabels();
    }
    // The comparison label: how each asset moved over the visible range (first visible common candle → last one).
    function cmpVisible() {
      if (!cmp || !cmpAligned || !cmpAligned.t.length) return;
      var r = chart.timeScale().getVisibleRange(), t = cmpAligned.t, i0 = 0, i1 = t.length - 1;
      if (r && typeof r.from === "number") { while (i0 < t.length - 1 && t[i0] < r.from) i0++; while (i1 > i0 && t[i1] > r.to) i1--; }
      var A = cmpAligned.a, B = cmpAligned.b, w = cmpWords();
      cmpLabel.innerHTML = "";
      var head = document.createElement("span"); head.textContent = w.vs + ": "; cmpLabel.appendChild(head);
      var nm = document.createElement("b"); nm.style.color = CMP_COLOR; nm.style.fontWeight = "600"; nm.textContent = baseOf(cmp.pair); cmpLabel.appendChild(nm);
      var add = function (sep, label, ratio) { var s = document.createElement("span"); s.textContent = sep + label + " "; var v = document.createElement("b"); v.style.fontWeight = "600"; v.style.color = ratio >= 0 ? "#55d99c" : "#ef6e76"; v.textContent = pctText(ratio); s.appendChild(v); cmpLabel.appendChild(s); };
      var tail = document.createElement("span"); tail.textContent = " · " + w.range + ":"; cmpLabel.appendChild(tail);
      add(" ", baseOf(state.pair), A[i1] / A[i0] - 1); add(" · ", baseOf(cmp.pair), B[i1] / B[i0] - 1);
      cmpLabel.style.display = "block";
      placeCmpLabels();
    }
    function placeCmpLabels() {
      // Under the legend, right of the drawing toolbar when there is one.
      var bar = container.querySelector(".cd-bar");
      cmpLabel.style.top = (legend.offsetHeight + 8) + "px";
      cmpLabel.style.left = (bar && bar.offsetParent ? bar.offsetLeft + bar.offsetWidth + 8 : 8) + "px";
      if (!indSeries.ratio) return;
      var panes = chart.panes(), idx = indSeries.ratio.getPane().paneIndex(), top = 0;
      for (var p = 0; p < idx; p++) top += panes[p].getHeight() + 1;
      ratioLabel.style.top = (top + 4) + "px";
    }
    chart.timeScale().subscribeVisibleLogicalRangeChange(function () {
      if (!cmp || !cmpAligned || cmpFrame) return;
      cmpFrame = requestAnimationFrame(function () { cmpFrame = 0; if (destroyed || !cmp || !cmpAligned) return; cmpRescale(); cmpVisible(); });
    });

    var divList = [], divShown = true, divSeries = [];
    function drawDivergences() {
      divSeries.forEach(function (sr) { try { chart.removeSeries(sr); } catch (e) {} }); divSeries = [];
      if (!divShown || destroyed) return;
      divList.forEach(function (d) {
        var color = d.type === "bull" ? "#3bcf91" : "#ef6b73";
        function seg(points, pane) {
          var sr = chart.addSeries(LC.LineSeries, { color: color, lineWidth: 2, lineStyle: LC.LineStyle.Dashed, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false, autoscaleInfoProvider: function () { return null; } }, pane);
          sr.setData(points); divSeries.push(sr);
        }
        seg([{ time: d.t1, value: d.p1 }, { time: d.t2, value: d.p2 }], 0);
        var target = d.kind === "rsi" ? indSeries.rsi : d.kind === "macd" ? indSeries.macd : null;
        if (target) { try { seg([{ time: d.t1, value: d.v1 }, { time: d.t2, value: d.v2 }], target.getPane().paneIndex()); } catch (e) {} }
      });
    }

    function setData() {
      var rows = allRows();
      candles.setData(rows.map(function (r) { return { time: r[0], open: r[1], high: r[2], low: r[3], close: r[4] }; }));
      volume.setData(rows.map(function (r) { return { time: r[0], value: usdVolume(r), color: r[4] >= r[1] ? "rgba(59,158,112,0.55)" : "rgba(169,83,91,0.55)" }; }));
      refreshLegend();
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
      volume.update({ time: forming[0], value: usdVolume(forming), color: up ? "rgba(59,158,112,0.25)" : "rgba(169,83,91,0.25)" });
      refreshLegend();
      drawIndicatorsSoon();
    }
    // Live ticks of the forming candle come several times a second; recomputing every indicator over thousands of
    // candles on each one is wasted work, so they are redrawn at most once a second (and once more after the last tick).
    var indLast = 0, indTimer = null;
    function drawIndicatorsSoon() {
      var wait = 1000 - (Date.now() - indLast);
      if (wait <= 0) { clearTimeout(indTimer); indTimer = null; indLast = Date.now(); drawIndicators(); return; }
      if (!indTimer) indTimer = setTimeout(function () { indTimer = null; if (destroyed) return; indLast = Date.now(); drawIndicators(); }, wait);
    }

    // A closed candle from Binance after the last known one: extend EMAs and draw it normally.
    function addClosed(row) {
      var rows = allRows(), last = rows[rows.length - 1];
      if (last && row[0] <= last[0]) return false;
      var full = withEma(last, row);
      state.tail.push(full);
      candles.update({ time: full[0], open: full[1], high: full[2], low: full[3], close: full[4] });
      volume.update({ time: full[0], value: usdVolume(full), color: full[4] >= full[1] ? "rgba(59,158,112,0.55)" : "rgba(169,83,91,0.55)" });
      refreshLegend();
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
      var count = state.rows.length + state.tail.length, last = forming || state.tail[state.tail.length - 1] || state.rows[state.rows.length - 1];
      if (!last) { if (!pulse.hidden) pulse.hidden = true; return; }
      var price = liveLine && liveStatus !== "live" ? liveLine.options().price : last[4];
      var x = chart.timeScale().logicalToCoordinate(count - 1 + (forming ? 1 : 0)), y = candles.priceToCoordinate(price);
      if (x === null || y === null || x < 0 || x > chart.timeScale().width() || y < 0) { if (!pulse.hidden) pulse.hidden = true; return; }
      var t = "translate(" + x.toFixed(1) + "px," + y.toFixed(1) + "px)";
      if (pulse.hidden) pulse.hidden = false;
      if (pulse.style.transform !== t) pulse.style.transform = t;
    }
    // Placed from the chart's own paint, when the price axis has already rescaled for the new view: placed from the
    // range-change event it read the old scale, sat off the candle after a zoom and jumped there up to half a second
    // later (seen as a flicker after pinch-zooming on phones).
    candles.attachPrimitive({ paneViews: function () { return [{ renderer: function () { return { draw: function () { placePulse(); } }; } }]; } });
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
        // Volume profile levels bring their own colour (teal) and a solid POC; key levels stay dashed soft white.
        var style = level.color ? (level.solid ? LC.LineStyle.Solid : LC.LineStyle.Dashed) : LC.LineStyle.LargeDashed;
        if (!levelLines[code]) levelLines[code] = candles.createPriceLine({ price: price, color: level.color || LEVEL_COLOR, lineWidth: 1, lineStyle: style, axisLabelVisible: true, title: code });
        else if (levelLines[code].options().price !== price) levelLines[code].applyOptions({ price: price });
      });
      Object.keys(levelLines).forEach(function (code) { if (!keep[code]) { candles.removePriceLine(levelLines[code]); delete levelLines[code]; } });
    }

    return {
      setLevels: setLevels,
      // Closed candles with RSI 14, MACD 12/26/9, EMA 20/50/200 and Bollinger 20/2, for the indicator summary.
      // Indicator values over the closed candles; the page asks for them on every live tick and every few seconds, so
      // they are computed once per candle list (times() is rebuilt only when the candles change).
      indicatorData: function () {
        var key = times();
        if (indDataCache.key === key) return indDataCache.data;
        indDataCache = { key: key, data: indicatorDataNow() };
        return indDataCache.data;
      },
      // [{ kind: "rsi"|"macd", type: "bull"|"bear", t1, t2, p1, p2, v1, v2 }] and whether to draw them.
      setDivergences: function (list, shown) { divList = list || []; divShown = shown !== false; drawDivergences(); },
      // Bollinger, Supertrend, Parabolic SAR, Ichimoku and VWAP (price pane); RSI, Stochastic RSI, MACD and OBV
      // (panes under the volume, in that order): { bb, st, psar, ichi, vwap, rsi, srsi, macd, obv } booleans.
      // Quick comparison: another pair (null to remove), its live price for the forming candle, and what is shown.
      setCompare: function (pair) {
        pair = pair ? String(pair).toUpperCase() : null;
        if (destroyed || (cmp ? cmp.pair : null) === pair) return Promise.resolve();
        cmp = pair && pair !== state.pair ? { pair: pair, map: null, live: null } : null;
        return loadCompare();
      },
      setCompareLive: function (price) { if (cmp && Number(price) > 0) { cmp.live = Number(price); if (forming) drawIndicatorsSoon(); } },
      // Zone bands (report zones, FVG, structure, Fibonacci) shown or not; the page turns them off while comparing.
      setZonesVisible: function (on) { zones.hidden = on === false; if (zones.hidden) hideZoneTip(); if (zones.requestUpdate) zones.requestUpdate(); },
      zonesVisible: function () { return !zones.hidden; },
      compareInfo: function () { return cmp ? { pair: cmp.pair, loaded: !!cmp.map } : null; },
      setIndicators: function (prefs) {
        // EMA 20/50/200 stay on unless turned off explicitly.
        var showEma = !(prefs && prefs.ema === false);
        emas.forEach(function (s) { s.applyOptions({ visible: showEma }); });
        var next = {};
        Object.keys(indPrefs).forEach(function (k) { next[k] = !!(prefs && prefs[k]); });
        if (destroyed || Object.keys(next).every(function (k) { return next[k] === indPrefs[k]; })) return;
        indPrefs = next; layoutIndicators();
      },
      // What the drawing tools (assets/chart-draw.js) need: the chart, the candle series (drawings sit on the price
      // pane), the container, the candle times, the candle length and a key for the pair and timeframe shown.
      drawHost: function () {
        return { chart: chart, series: candles, container: container, times: times,
          step: function () { return STEP[state.tf]; }, key: function () { return state.pair + ":" + state.tf; },
          pair: function () { return state.pair; }, rows: allRows,
          alive: function () { return !destroyed; } };
      },
      // Economic events: [{ time (seconds), title, country, impact: VERY_HIGH|HIGH|MEDIUM, dateOnly }]; [] hides them.
      setEvents: function (list) { eventMarks.set(list); },
      // The chart as drawn now (zones, levels, watermark; no crosshair), at device resolution.
      // size { w, h } (CSS px): drawn at that size instead of the container's (a narrow phone chart gives a standard
      // image). Resized, captured and put back in the same task, so nothing changes on screen; the right edge and
      // the candle width are kept, so a wider image shows more candles to the left.
      screenshot: function (size) {
        if (!size || !(size.w > 0) || !(size.h > 0)) return chart.takeScreenshot(true, false);
        var w0 = container.clientWidth, h0 = container.clientHeight;
        chart.applyOptions({ autoSize: false }); chart.resize(size.w, size.h, true);
        try { return chart.takeScreenshot(true, false); }
        finally { chart.resize(w0, h0, true); chart.applyOptions({ autoSize: true }); }
      },
      lastClosedAt: function () { var rows = allRows(), last = rows[rows.length - 1]; return new Date((last[0] + STEP[state.tf]) * 1000).toISOString(); },
      // The last closed candle as drawn (R2 or browser tail): open time (the chart's label) and close time.
      lastClosedCandle: function () {
        var rows = allRows(), last = rows[rows.length - 1];
        return { open: new Date(last[0] * 1000).toISOString(), close: new Date((last[0] + STEP[state.tf]) * 1000).toISOString(), timeframe: state.tf };
      },
      setZones: function (list, priceDecimals) {
        hideZoneTip();
        baseZones = (list || []).filter(function (z) { return z && z.drawn !== false && Number(z.low) > 0 && Number(z.high) > 0; });
        if (priceDecimals != null && priceDecimals !== decimals) { decimals = priceDecimals; applyPrecision(); }
        zoneList = baseZones.concat(fvgZones, structureZones, lastValidZones, fibZones);
        zones.set(zoneList, times());
      },
      // Price Action report structure: BOS / CHoCH lines and sweep markers (README "Price Action view").
      setStructure: function (structure) {
        var events = (structure && structure.events) || [], sweeps = (structure && structure.sweeps) || [];
        structureZones = events.filter(function (e) { return Number(e.level) > 0; }).map(function (e) {
          return { line: true, layer: "PA_STRUCTURE", kind: e.type, low: Number(e.level), high: Number(e.level), formedAt: e.swingTime, endAt: e.breakTime,
            label: (e.type === "CHOCH" ? "CHoCH" : "BOS") + (e.direction === "bullish" ? " ↑" : " ↓") };
        });
        zoneList = baseZones.concat(fvgZones, structureZones, lastValidZones, fibZones);
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
        zoneList = baseZones.concat(fvgZones, structureZones, lastValidZones, fibZones);
        zones.set(zoneList, times());
      },
      // Price Action report FVG boxes (remaining gap, from the candle that formed it to the right edge).
      setFvg: function (list) {
        fvgZones = (list || []).filter(function (f) { return f && Number(f.low) > 0 && Number(f.high) > Number(f.low); }).map(function (f) {
          return { type: "fvg", layer: "PA_FVG", low: Number(f.low), high: Number(f.high), formedAt: f.createdAt,
            filledPercent: Number(f.filledPercent || 0), label: String(f.direction).toLowerCase() === "bullish" ? "FVG \u2191" : "FVG \u2193" };
        });
        zoneList = baseZones.concat(fvgZones, structureZones, lastValidZones, fibZones);
        zones.set(zoneList, times());
      },
      // Price Action Fibonacci of the current leg (opt-in, off unless the page passes one): fib = { start, end,
      // startTime, labels: [band, half, zero, one] } with start = 1 (protected swing) and end = 0 (leg extreme).
      setFib: function (fib) {
        var a = fib && Number(fib.start), b = fib && Number(fib.end);
        fibZones = a > 0 && b > 0 && a !== b ? (function () {
          var at = function (r) { return b + (a - b) * r; }, L = fib.labels || [];
          return [
            { layer: "PA_FIB", type: "fib", low: Math.min(at(0.618), at(0.786)), high: Math.max(at(0.618), at(0.786)), formedAt: fib.startTime, label: L[0] || "0.618–0.786" },
            { fibLine: true, layer: "PA_FIB", low: at(0.5), high: at(0.5), formedAt: fib.startTime, label: L[1] || "0.5", dashed: true },
            { fibLine: true, layer: "PA_FIB", low: b, high: b, formedAt: fib.startTime, label: L[2] || "0" },
            { fibLine: true, layer: "PA_FIB", low: a, high: a, formedAt: fib.startTime, label: L[3] || "1" }
          ];
        })() : [];
        zoneList = baseZones.concat(fvgZones, structureZones, lastValidZones, fibZones);
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
      setLocale: function () { if (!destroyed) { chart.applyOptions({ localization: localization() }); refreshLegend(); if (cmp) drawIndicators(); } },
      // Change timeframe without tearing the chart down. 1H in particular is a lot of candles;
      // rebuilding the widget blanked the panel and redrew it.
      // Also another asset in the same chart (opts.pair, with opts.decimalsFor for its price-axis decimals): the analysis
      // page switches assets in place like it switches timeframes (README "Asset switch").
      reload: function (nextTf, opts) {
        hideZoneTip();
        opts = opts || {};
        nextTf = String(nextTf || "").toLowerCase();
        var nextPair = opts.pair ? String(opts.pair).toUpperCase() : state.pair, newPair = nextPair !== state.pair;
        if (destroyed || !STEP[nextTf]) return Promise.reject(new Error("unsupported timeframe " + nextTf));
        if (nextTf === state.tf && !newPair) return Promise.resolve();
        var epoch = ++generation;
        closeStream();
        forming = null;
        setLiveStatus("pending");
        return loadIndex().then(function (index) {
          if (destroyed || epoch !== generation) return;
          var entry = index.pairs && index.pairs[nextPair] && index.pairs[nextPair][nextTf];
          if (!entry) throw new Error("no candles for " + nextPair + " " + nextTf);
          var archives = (entry.archives || []).slice();
          var initial = MONTHLY[nextTf] ? archives.slice(-PAGE) : archives.slice();
          var remaining = MONTHLY[nextTf] ? archives.slice(0, Math.max(0, archives.length - PAGE)) : [];
          return loadPeriods(nextPair, nextTf, initial.concat(["latest"])).then(function (files) {
            if (destroyed || epoch !== generation) return;
            var rows = mergeRows([], files);
            if (!rows.length) throw new Error("no closed candles for " + nextPair + " " + nextTf);
            if (newPair) {
              // Nothing of the previous asset stays: its live price line, key-level lines, divergences and sweeps go;
              // the page sets the new asset's ones once the candles are in.
              state.pair = nextPair;
              if (liveLine) { candles.removePriceLine(liveLine); liveLine = null; }
              Object.keys(levelLines).forEach(function (code) { candles.removePriceLine(levelLines[code]); delete levelLines[code]; });
              divList = []; drawDivergences();
              structurePoints.points = null; structurePoints.update();
              if (sweepMarkers) sweepMarkers.setMarkers([]);
              var d = opts.decimalsFor ? opts.decimalsFor(rows[rows.length - 1][4]) : null;
              if (d != null && d !== decimals) { decimals = d; applyPrecision(); }
            }
            state.tf = nextTf;
            state.rows = rows;
            state.tail = [];
            state.remaining = remaining;
            baseZones = []; fvgZones = []; structureZones = []; lastValidZones = []; zoneList = []; avwapPoints = [];
            chart.applyOptions({ timeScale: { timeVisible: nextTf === "1h" || nextTf === "4h", secondsVisible: false, rightOffset: 12 } });
            touched = false;
            setData();
            initialView();
            if (cmp) loadCompare();
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
        window.removeEventListener("orientationchange", scheduleFit);
        document.removeEventListener("fullscreenchange", scheduleFit);
        fitTimers.forEach(clearTimeout);
        chart.remove(); container.textContent = ""; container.style.height = "";
      }
    };
  }

  return { show: show, indicators: indicators, extraIndicators: extraIndicators, _test: { extraIndicators: extraIndicators, mergeRows: mergeRows, zoneStart: zoneStart, palette: palette, klineRow: klineRow, withEma: withEma } };
})();
