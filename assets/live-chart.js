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

  function loadPeriods(pair, tf, names) {
    return Promise.all(names.map(function (name) { return getJson(DATA + pair + "/" + tf + "/" + name + ".json"); }));
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
  function zoneStart(zone, times) {
    var first = times[0];
    var formed = Date.parse(zone.formedAt || "");
    if (!isFinite(formed)) return { time: first, edge: "unknown" };
    var seconds = Math.floor(formed / 1000);
    if (seconds < first) return { time: first, edge: "clipped" };
    for (var i = 0; i < times.length; i++) if (times[i] >= seconds) return { time: times[i], edge: "solid" };
    return null; // formed after the last loaded candle: nothing to draw yet
  }

  function ZonesPrimitive() { this.zones = []; this.times = []; this.chart = null; this.series = null; this.requestUpdate = null; }
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
              var ctx = scope.context, right = end === null ? paneWidth : Math.min(paneWidth, end);
              if (right <= 0) return;
              self.zones.forEach(function (zone) {
                var start = zoneStart(zone, self.times);
                if (!start) return;
                var x0 = timeScale.timeToCoordinate(start.time);
                var yHigh = self.series.priceToCoordinate(Number(zone.high)), yLow = self.series.priceToCoordinate(Number(zone.low));
                if (x0 === null || yHigh === null || yLow === null || x0 > right) return;
                var top = Math.min(yHigh, yLow), height = Math.max(1, Math.abs(yLow - yHigh)), left = Math.max(x0, -2);
                var style = palette(zone);
                ctx.save();
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
                ctx.restore();
              });
            });
          }
        };
      }
    }];
  };

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
        return build(LC, container, { pair: pair, tf: tf, rows: rows, tail: [], remaining: remaining, decimals: decimals, onChange: options.onChange });
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
      layout: { background: { color: "#101820" }, textColor: "#c7cfde" },
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
    var volume = chart.addSeries(LC.HistogramSeries, { priceFormat: { type: "volume" }, priceScaleId: "volume", priceLineVisible: false, lastValueVisible: false });
    volume.priceScale().applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
    var emaColors = ["#ff6975", "#6fb5ff", "#e7d98c"], emas = emaColors.map(function (color) {
      return chart.addSeries(LC.LineSeries, { color: color, lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
    });
    var zones = new ZonesPrimitive(), zoneList = [];
    candles.attachPrimitive(zones);
    var liveLine = null, loadingOlder = false, destroyed = false;
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
    }

    function setData() {
      var rows = allRows();
      candles.setData(rows.map(function (r) { return { time: r[0], open: r[1], high: r[2], low: r[3], close: r[4] }; }));
      volume.setData(rows.map(function (r) { return { time: r[0], value: r[5], color: r[4] >= r[1] ? "rgba(59,158,112,0.55)" : "rgba(169,83,91,0.55)" }; }));
      emas.forEach(function (series, i) {
        series.setData(rows.filter(function (r) { return r[6 + i] != null; }).map(function (r) { return { time: r[0], value: r[6 + i] }; }));
      });
      zones.set(zoneList, rows.map(function (r) { return r[0]; }));
      drawForming();
    }

    // The forming candle: faded colours, no EMA, replaced on every update until it closes.
    function drawForming() {
      if (!forming) return;
      var up = forming[4] >= forming[1], tone = up ? "rgba(85,217,156,0.38)" : "rgba(239,110,118,0.38)";
      candles.update({ time: forming[0], open: forming[1], high: forming[2], low: forming[3], close: forming[4], color: tone, wickColor: tone, borderColor: tone });
      volume.update({ time: forming[0], value: forming[5], color: up ? "rgba(59,158,112,0.25)" : "rgba(169,83,91,0.25)" });
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
      var step = STEP[state.tf] * 1000, requests = 0;
      function next(startMs) {
        requests++;
        var url = BINANCE_REST + "?symbol=" + state.pair + "&interval=" + state.tf + "&startTime=" + startMs + "&limit=" + KLINE_LIMIT;
        return fetch(url, { cache: "no-store" }).then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
          .then(function (klines) {
            if (destroyed || !Array.isArray(klines)) return;
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
      return next((rows[rows.length - 1][0] + STEP[state.tf]) * 1000).then(function () { drawForming(); notify(); });
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
    var sized = 0, waitForSize = function () {
      if (touched || destroyed || sized++ > 20) return;
      if (chart.timeScale().width() > 0) { initialView(); return; }
      requestAnimationFrame(waitForSize);
    };
    requestAnimationFrame(waitForSize);
    chart.timeScale().subscribeVisibleLogicalRangeChange(loadOlder);
    fillTail().then(function () { initialView(); setLiveStatus("live"); openStream(); })
      .catch(function () { setLiveStatus("unavailable"); });

    return {
      lastClosedAt: function () { var rows = allRows(), last = rows[rows.length - 1]; return new Date((last[0] + STEP[state.tf]) * 1000).toISOString(); },
      // The last closed candle as drawn (R2 or browser tail): open time (the chart's label) and close time.
      lastClosedCandle: function () {
        var rows = allRows(), last = rows[rows.length - 1];
        return { open: new Date(last[0] * 1000).toISOString(), close: new Date((last[0] + STEP[state.tf]) * 1000).toISOString(), timeframe: state.tf };
      },
      setZones: function (list, priceDecimals) {
        zoneList = (list || []).filter(function (z) { return z && z.drawn !== false && Number(z.low) > 0 && Number(z.high) > 0; });
        if (priceDecimals != null && priceDecimals !== decimals) { decimals = priceDecimals; applyPrecision(); }
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
      destroy: function () {
        destroyed = true; closeStream(); document.removeEventListener("visibilitychange", onVisibility);
        chart.remove(); container.textContent = "";
      }
    };
  }

  return { show: show, _test: { mergeRows: mergeRows, zoneStart: zoneStart, palette: palette, klineRow: klineRow, withEma: withEma } };
})();
