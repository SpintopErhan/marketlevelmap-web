/* Drawing tools on the analysis chart (README "Chart drawing tools"): trend line, horizontal line, box, arrow and
   text, with select / move, eraser, colour, hide, undo and clear. Members only and desktop only (the page decides and
   calls MLMDraw.attach / detach). Drawings are kept in this browser only (localStorage "mlm-draw:<PAIR>:<tf>"); nothing
   goes to the server. Points are stored as (time in seconds, price), so they stay on their candles when the chart
   scrolls, zooms, loads older candles or gets new ones; past the last candle the time runs on in candle steps.
   They are drawn by a series primitive on the price pane, so the chart's own screenshot (download, share) carries them. */
(function () {
  "use strict";
  var COLORS = ["#f2c94c", "#6fb5ff", "#55d99c", "#ef6e76", "#e8ecf3"];
  var WORDS = {
    en: { select: "Select and move", trend: "Trend line", hline: "Horizontal line", rect: "Box", arrow: "Arrow", text: "Text",
      erase: "Eraser", color: "Colour", hide: "Hide drawings", show: "Show drawings", undo: "Undo (Ctrl+Z)", clear: "Delete all drawings",
      clearAsk: "Delete all drawings on this chart?", textPh: "Text, then Enter" },
    tr: { select: "Seç ve taşı", trend: "Trend çizgisi", hline: "Yatay çizgi", rect: "Kutu", arrow: "Ok", text: "Yazı",
      erase: "Silgi", color: "Renk", hide: "Çizimleri gizle", show: "Çizimleri göster", undo: "Geri al (Ctrl+Z)", clear: "Tüm çizimleri sil",
      clearAsk: "Bu grafikteki tüm çizimler silinsin mi?", textPh: "Yazı, sonra Enter" }
  };
  var ICONS = {
    select: '<path d="M6 3l12 9-5 1 3 6-2.5 1-3-6-4.5 3z"/>',
    trend: '<path d="M4 19L20 5"/><circle cx="4" cy="19" r="1.6"/><circle cx="20" cy="5" r="1.6"/>',
    hline: '<path d="M3 12h18"/><circle cx="12" cy="12" r="1.6"/>',
    rect: '<rect x="4" y="6" width="16" height="12" rx="1"/>',
    arrow: '<path d="M5 19L19 5M19 5h-7M19 5v7"/>',
    text: '<path d="M5 6h14M12 6v13M9 19h6"/>',
    erase: '<path d="M8 20h12M5 15l8-9 6 6-8 8H8z"/>',
    hide: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
    undo: '<path d="M9 7L4 12l5 5M4 12h11a5 5 0 0 1 0 10h-2"/>',
    clear: '<path d="M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13"/>'
  };
  function lang() { return document.documentElement.lang === "tr" ? "tr" : "en"; }
  function w() { return WORDS[lang()]; }

  var host = null, prim = null, bar = null, input = null, list = [], key = null, hidden = false;
  var tool = "select", color = COLORS[0], selected = null, pending = null, drag = null, undoStack = [], hover = null;

  // ---- storage ----
  function store(k) { return "mlm-draw:" + k; }
  function load(k) { try { var v = JSON.parse(localStorage.getItem(store(k)) || "[]"); return Array.isArray(v) ? v : []; } catch (e) { return []; } }
  // Fields starting with "_" are drawing-time scratch (text width, the first click) and are not stored.
  function plain(v) { return JSON.stringify(v, function (k, x) { return k.charAt(0) === "_" ? undefined : x; }); }
  function save() { if (!key) return; try { if (list.length) localStorage.setItem(store(key), plain(list)); else localStorage.removeItem(store(key)); } catch (e) {} }
  function remember() { undoStack.push(plain(list)); if (undoStack.length > 60) undoStack.shift(); }
  function syncKey() {
    var k = host ? host.key() : null;
    if (k === key) return;
    key = k; list = k ? load(k) : []; undoStack = []; selected = null; pending = null; drag = null; closeInput(false);
  }
  function changed() { save(); redraw(); }

  // ---- coordinates: time in seconds <-> x (through the logical index), price <-> y ----
  function timeToX(t) {
    var T = host.times(), n = T.length, step = host.step(), logical;
    if (!n) return null;
    if (t <= T[0]) logical = (t - T[0]) / step;
    else if (t >= T[n - 1]) logical = n - 1 + (t - T[n - 1]) / step;
    else { var lo = 0, hi = n - 1; while (hi - lo > 1) { var m = (lo + hi) >> 1; if (T[m] <= t) lo = m; else hi = m; } logical = lo + (t - T[lo]) / (T[hi] - T[lo]); }
    return host.chart.timeScale().logicalToCoordinate(logical);
  }
  function xToTime(x) {
    var T = host.times(), n = T.length, step = host.step(), logical = host.chart.timeScale().coordinateToLogical(x);
    if (!n || logical == null) return null;
    if (logical <= 0) return T[0] + logical * step;
    if (logical >= n - 1) return T[n - 1] + (logical - (n - 1)) * step;
    var i = Math.floor(logical); return T[i] + (logical - i) * (T[i + 1] - T[i]);
  }
  function toXY(pt) { var x = timeToX(pt.t), y = host.series.priceToCoordinate(pt.p); return x == null || y == null ? null : { x: x, y: y }; }
  function fromXY(x, y) { var t = xToTime(x), p = host.series.coordinateToPrice(y); return t == null || p == null ? null : { t: t, p: p }; }
  // Pointer position inside the price pane, or null below it (volume and indicator panes) or over the price axis.
  function local(ev) {
    var r = host.container.getBoundingClientRect(), x = ev.clientX - r.left, y = ev.clientY - r.top;
    var paneH = host.chart.panes()[0].getHeight(), paneW = host.chart.timeScale().width();
    return x >= 0 && y >= 0 && x <= paneW && y <= paneH ? { x: x, y: y } : null;
  }

  // ---- drawing ----
  function fmt(p) { var d = p >= 1000 ? 1 : p >= 1 ? 2 : 5; return Number(p).toLocaleString(lang() === "tr" ? "tr-TR" : "en-US", { minimumFractionDigits: d, maximumFractionDigits: d }); }
  function rgba(hex, a) { var n = parseInt(hex.slice(1), 16); return "rgba(" + (n >> 16) + "," + ((n >> 8) & 255) + "," + (n & 255) + "," + a + ")"; }
  function paint(ctx, d, width, sel) {
    var a = toXY(d.a), b = d.b ? toXY(d.b) : null;
    if (!a || (d.b && !b)) return;
    ctx.strokeStyle = d.color; ctx.fillStyle = d.color; ctx.lineWidth = sel ? 2.5 : 2; ctx.setLineDash([]);
    if (d.type === "trend" || d.type === "arrow") {
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      if (d.type === "arrow") {
        var ang = Math.atan2(b.y - a.y, b.x - a.x), len = 12;
        ctx.beginPath(); ctx.moveTo(b.x, b.y);
        ctx.lineTo(b.x - len * Math.cos(ang - 0.45), b.y - len * Math.sin(ang - 0.45));
        ctx.lineTo(b.x - len * Math.cos(ang + 0.45), b.y - len * Math.sin(ang + 0.45));
        ctx.closePath(); ctx.fill();
      }
    } else if (d.type === "hline") {
      ctx.beginPath(); ctx.moveTo(0, a.y); ctx.lineTo(width, a.y); ctx.stroke();
      ctx.font = "600 11px Inter, system-ui, sans-serif"; ctx.textAlign = "right"; ctx.textBaseline = "bottom"; ctx.fillText(fmt(d.a.p), width - 6, a.y - 3);
    } else if (d.type === "rect") {
      var x = Math.min(a.x, b.x), y = Math.min(a.y, b.y), rw = Math.abs(b.x - a.x), rh = Math.abs(b.y - a.y);
      ctx.fillStyle = rgba(d.color, 0.14); ctx.fillRect(x, y, rw, rh); ctx.strokeRect(x, y, rw, rh);
    } else if (d.type === "text") {
      ctx.font = "600 14px Inter, system-ui, sans-serif"; ctx.textAlign = "left"; ctx.textBaseline = "middle";
      var tw = ctx.measureText(d.text || "").width;
      ctx.fillStyle = "rgba(16,24,32,.78)"; ctx.fillRect(a.x - 4, a.y - 11, tw + 8, 22);
      if (sel) { ctx.strokeStyle = d.color; ctx.lineWidth = 1; ctx.strokeRect(a.x - 4, a.y - 11, tw + 8, 22); }
      ctx.fillStyle = d.color; ctx.fillText(d.text || "", a.x, a.y + 1);
      d._w = tw;
    }
    if (sel && d.type !== "text") handles(d).forEach(function (h) {
      ctx.fillStyle = "#101820"; ctx.strokeStyle = d.color; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(h.x, h.y, 4.5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    });
  }
  function handles(d) {
    var a = toXY(d.a), b = d.b ? toXY(d.b) : null;
    if (!a) return [];
    if (d.type === "hline") return [{ x: Math.max(30, Math.min(a.x, host.chart.timeScale().width() - 30)), y: a.y, which: "a" }];
    if (d.type === "rect" && b) return [{ x: a.x, y: a.y, which: "a" }, { x: b.x, y: b.y, which: "b" }, { x: a.x, y: b.y, which: "ab" }, { x: b.x, y: a.y, which: "ba" }];
    return b ? [{ x: a.x, y: a.y, which: "a" }, { x: b.x, y: b.y, which: "b" }] : [];
  }
  function Primitive() { this.requestUpdate = null; }
  Primitive.prototype.attached = function (p) { this.requestUpdate = p.requestUpdate; };
  Primitive.prototype.detached = function () { this.requestUpdate = null; };
  Primitive.prototype.updateAllViews = function () {};
  Primitive.prototype.paneViews = function () {
    return [{
      zOrder: function () { return "top"; },
      renderer: function () {
        return { draw: function (target) {
          if (!host || !host.alive()) return;
          syncKey();
          if (hidden) return;
          target.useMediaCoordinateSpace(function (scope) {
            var ctx = scope.context, width = scope.mediaSize.width;
            ctx.save();
            list.forEach(function (d) { paint(ctx, d, width, d === selected || d === hover); });
            if (pending) paint(ctx, pending, width, true);
            ctx.restore();
          });
        } };
      }
    }];
  };
  function redraw() { if (prim && prim.requestUpdate) prim.requestUpdate(); }

  // ---- hit testing (pixels) ----
  function segDist(p, a, b) {
    var dx = b.x - a.x, dy = b.y - a.y, l = dx * dx + dy * dy, t = l ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l)) : 0;
    return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
  }
  function hits(d, p) {
    var a = toXY(d.a), b = d.b ? toXY(d.b) : null;
    if (!a) return false;
    if (d.type === "hline") return Math.abs(p.y - a.y) <= 6;
    if (d.type === "text") return p.x >= a.x - 4 && p.x <= a.x + (d._w || 40) + 4 && Math.abs(p.y - a.y) <= 11;
    if (!b) return false;
    if (d.type === "rect") {
      var x0 = Math.min(a.x, b.x), x1 = Math.max(a.x, b.x), y0 = Math.min(a.y, b.y), y1 = Math.max(a.y, b.y);
      return p.x >= x0 - 5 && p.x <= x1 + 5 && p.y >= y0 - 5 && p.y <= y1 + 5;
    }
    return segDist(p, a, b) <= 6;
  }
  function pick(p) { for (var i = list.length - 1; i >= 0; i--) if (hits(list[i], p)) return list[i]; return null; }
  function pickHandle(p) {
    if (!selected) return null;
    var hs = handles(selected);
    for (var i = 0; i < hs.length; i++) if (Math.hypot(hs[i].x - p.x, hs[i].y - p.y) <= 7) return hs[i].which;
    return null;
  }

  // ---- pointer ----
  function swallow(ev) { ev.preventDefault(); ev.stopPropagation(); if (ev.stopImmediatePropagation) ev.stopImmediatePropagation(); }
  function onDown(ev) {
    if (!host || ev.button !== 0 || hidden) return;
    if (ev.target.closest && ev.target.closest(".cd-bar, .cd-input")) return;
    var p = local(ev); if (!p) return;
    syncKey();
    if (tool === "select") {
      var which = pickHandle(p), d = which ? selected : pick(p);
      if (!d) { if (selected) { selected = null; redraw(); } return; } // empty space: the chart pans as usual
      swallow(ev); selected = d; remember();
      drag = { d: d, which: which, start: fromXY(p.x, p.y), a: { t: d.a.t, p: d.a.p }, b: d.b ? { t: d.b.t, p: d.b.p } : null, moved: false };
      redraw(); return;
    }
    swallow(ev);
    var pt = fromXY(p.x, p.y); if (!pt) return;
    if (tool === "erase") { var hit = pick(p); if (hit) { remember(); list.splice(list.indexOf(hit), 1); if (selected === hit) selected = null; changed(); } return; }
    if (tool === "hline") { remember(); var h = { type: "hline", a: pt, color: color }; list.push(h); selected = h; setTool("select"); changed(); return; }
    if (tool === "text") { openInput(p, pt, null); return; }
    // Two-point shapes: drag, or click and click again.
    if (pending) { pending.b = pt; finish(); return; }
    pending = { type: tool, a: pt, b: { t: pt.t, p: pt.p }, color: color, _x: p.x, _y: p.y };
    redraw();
  }
  function onMove(ev) {
    if (!host) return;
    if (drag) {
      swallow(ev);
      var p = local(ev) || clampLocal(ev), now = p && fromXY(p.x, p.y); if (!now || !drag.start) return;
      var dt = now.t - drag.start.t, dp = now.p - drag.start.p, d = drag.d; drag.moved = true;
      if (!drag.which) { d.a = { t: drag.a.t + dt, p: drag.a.p + dp }; if (d.b) d.b = { t: drag.b.t + dt, p: drag.b.p + dp }; }
      else if (drag.which === "a") d.a = d.type === "hline" ? { t: d.a.t, p: now.p } : now;
      else if (drag.which === "b") d.b = now;
      else if (drag.which === "ab") { d.a = { t: now.t, p: d.a.p }; d.b = { t: d.b.t, p: now.p }; }
      else if (drag.which === "ba") { d.b = { t: now.t, p: d.b.p }; d.a = { t: d.a.t, p: now.p }; }
      redraw(); return;
    }
    var q = local(ev);
    if (pending) { if (q) { var pt = fromXY(q.x, q.y); if (pt) { pending.b = pt; redraw(); } } return; }
    // Hover feedback in select and eraser modes.
    var over = q && (tool === "select" || tool === "erase") && !hidden ? (pickHandle(q) ? selected : pick(q)) : null;
    if (over !== hover) { hover = over; redraw(); }
    host.container.style.cursor = tool !== "select" ? (tool === "erase" && over ? "pointer" : "crosshair") : over ? (pickHandle(q) ? "grab" : "move") : "";
  }
  function clampLocal(ev) {
    var r = host.container.getBoundingClientRect();
    return { x: Math.max(0, Math.min(ev.clientX - r.left, host.chart.timeScale().width())), y: Math.max(0, Math.min(ev.clientY - r.top, host.chart.panes()[0].getHeight())) };
  }
  function onUp(ev) {
    if (!host) return;
    if (drag) { swallow(ev); if (!drag.moved) undoStack.pop(); drag = null; changed(); return; }
    if (pending) {
      var p = local(ev);
      // A drag of a few pixels or more ends the shape; a plain click waits for the second click.
      if (p && Math.hypot(p.x - pending._x, p.y - pending._y) > 4) { var pt = fromXY(p.x, p.y); if (pt) pending.b = pt; finish(); }
    }
  }
  function finish() {
    var d = pending; pending = null; delete d._x; delete d._y;
    var a = toXY(d.a), b = toXY(d.b);
    if (a && b && Math.hypot(a.x - b.x, a.y - b.y) < 3) { redraw(); return; } // nothing drawn
    remember(); list.push(d); selected = d; setTool("select"); changed();
  }
  function onDbl(ev) {
    if (!host || tool !== "select") return;
    var p = local(ev); if (!p) return;
    var d = pick(p); if (!d || d.type !== "text") return;
    swallow(ev); openInput(toXY(d.a), d.a, d);
  }
  function onKey(ev) {
    if (!host || (ev.target && /^(INPUT|TEXTAREA|SELECT)$/.test(ev.target.tagName))) return;
    if (ev.key === "Escape" && (pending || selected || tool !== "select")) { pending = null; selected = null; setTool("select"); redraw(); return; }
    if ((ev.key === "Delete" || ev.key === "Backspace") && selected) { ev.preventDefault(); remember(); list.splice(list.indexOf(selected), 1); selected = null; changed(); return; }
    if ((ev.ctrlKey || ev.metaKey) && !ev.shiftKey && (ev.key === "z" || ev.key === "Z") && undoStack.length && overChart) { ev.preventDefault(); undo(); }
  }
  var overChart = false;
  function onEnter() { overChart = true; }
  function onLeave() { overChart = false; if (hover) { hover = null; redraw(); } }

  // ---- text input ----
  function openInput(p, pt, editing) {
    closeInput(false);
    input = document.createElement("input");
    input.className = "cd-input"; input.type = "text"; input.maxLength = 80; input.placeholder = w().textPh;
    input.value = editing ? editing.text : "";
    input.style.cssText = "position:absolute;z-index:8;left:" + Math.max(0, p.x - 4) + "px;top:" + (p.y - 13) + "px;width:200px;padding:3px 6px;" +
      "border:1px solid " + (editing ? editing.color : color) + ";border-radius:5px;background:#101820;color:#eef1f7;font:600 14px Inter,system-ui,sans-serif;outline:none";
    host.container.appendChild(input);
    input._pt = pt; input._edit = editing;
    input.addEventListener("keydown", function (ev) {
      ev.stopPropagation();
      if (ev.key === "Enter") closeInput(true); else if (ev.key === "Escape") closeInput(false);
    });
    input.addEventListener("blur", function () { closeInput(true); });
    setTimeout(function () { if (input) input.focus(); }, 0);
  }
  function closeInput(commit) {
    if (!input) return;
    var el = input, text = el.value.trim(); input = null;
    if (commit) {
      remember();
      if (el._edit) { if (text) el._edit.text = text; else { list.splice(list.indexOf(el._edit), 1); selected = null; } }
      else if (text) { var d = { type: "text", a: el._pt, text: text, color: color }; list.push(d); selected = d; }
      else undoStack.pop();
      setTool("select"); changed();
    }
    el.remove();
  }

  // ---- toolbar ----
  var TOOLS = ["select", "trend", "hline", "rect", "arrow", "text", "erase"];
  function btn(name, title, onClick) {
    var b = document.createElement("button");
    b.type = "button"; b.className = "cd-btn"; b.dataset.cd = name; b.title = title; b.setAttribute("aria-label", title);
    b.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true">' + (ICONS[name] || "") + "</svg>";
    b.addEventListener("click", onClick);
    return b;
  }
  function buildBar() {
    bar = document.createElement("div");
    bar.className = "cd-bar"; bar.setAttribute("role", "toolbar");
    TOOLS.forEach(function (t) { bar.appendChild(btn(t, w()[t], function () { setTool(tool === t && t !== "select" ? "select" : t); })); });
    var sep = document.createElement("i"); sep.className = "cd-sep"; bar.appendChild(sep);
    var cb = btn("color", w().color, function () { pal.style.top = cb.offsetTop + "px"; pal.hidden = !pal.hidden; });
    cb.innerHTML = '<span class="cd-dot"></span>'; bar.appendChild(cb);
    var pal = document.createElement("div"); pal.className = "cd-pal"; pal.hidden = true;
    COLORS.forEach(function (c) {
      var s = document.createElement("button"); s.type = "button"; s.style.background = c; s.title = c;
      s.addEventListener("click", function () {
        color = c; pal.hidden = true;
        if (selected) { remember(); selected.color = c; changed(); }
        sync();
      });
      pal.appendChild(s);
    });
    bar.appendChild(pal);
    bar.appendChild(btn("hide", w().hide, function () { hidden = !hidden; pending = null; selected = null; closeInput(false); sync(); redraw(); }));
    bar.appendChild(btn("undo", w().undo, undo));
    bar.appendChild(btn("clear", w().clear, function () {
      if (!list.length || !window.confirm(w().clearAsk)) return;
      remember(); list = []; selected = null; changed();
    }));
    ["mousedown", "pointerdown", "dblclick", "wheel"].forEach(function (t) { bar.addEventListener(t, function (ev) { ev.stopPropagation(); }); });
    host.container.appendChild(bar);
    sync();
  }
  function sync() {
    if (!bar) return;
    var t = w();
    bar.querySelectorAll(".cd-btn").forEach(function (b) {
      var n = b.dataset.cd, title = n === "hide" ? (hidden ? t.show : t.hide) : t[n];
      b.title = title; b.setAttribute("aria-label", title);
      if (TOOLS.indexOf(n) > -1) b.setAttribute("aria-pressed", String(n === tool));
      if (n === "hide") b.setAttribute("aria-pressed", String(hidden));
      if (TOOLS.indexOf(n) > -1 && n !== "select") b.disabled = hidden;
    });
    var dot = bar.querySelector(".cd-dot"); if (dot) dot.style.background = color;
  }
  function setTool(t) {
    tool = t; pending = null; if (t !== "select") selected = null;
    if (host) host.container.style.cursor = t === "select" ? "" : "crosshair";
    sync(); redraw();
  }
  function undo() { if (!undoStack.length) return; list = JSON.parse(undoStack.pop()); selected = null; pending = null; changed(); }

  // ---- attach / detach ----
  var CSS = ".cd-bar{position:absolute;left:6px;top:30px;z-index:7;display:flex;flex-direction:column;gap:2px;padding:4px;border:1px solid #2a3442;border-radius:9px;background:rgba(14,19,26,.92)}" +
    ".cd-btn{display:grid;place-items:center;width:28px;height:28px;padding:0;border:0;border-radius:6px;background:none;color:#aab4c3;cursor:pointer}" +
    ".cd-btn:focus:not(:focus-visible){outline:none}.cd-btn:hover:not(:disabled){background:#1f2a36;color:#eef1f7}.cd-btn[aria-pressed=true]{background:#24384a;color:#6fd3c0}.cd-btn:disabled{opacity:.35;cursor:default}" +
    ".cd-btn svg{width:17px;height:17px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}" +
    ".cd-dot{width:14px;height:14px;border-radius:50%;border:1px solid rgba(255,255,255,.35)}.cd-sep{height:1px;margin:3px 2px;background:#2a3442}" +
    ".cd-pal{position:absolute;left:40px;top:0;display:flex;gap:6px;padding:6px;border:1px solid #2a3442;border-radius:8px;background:#0e131a}.cd-pal[hidden]{display:none}" +
    ".cd-pal button{width:18px;height:18px;padding:0;border:1px solid rgba(255,255,255,.3);border-radius:50%;cursor:pointer}";
  function css() { if (document.getElementById("cd-css")) return; var s = document.createElement("style"); s.id = "cd-css"; s.textContent = CSS; document.head.appendChild(s); }
  var EVENTS = [["mousedown", onDown], ["pointerdown", function (ev) { if (ev.pointerType === "mouse") onDownGuard(ev); }], ["dblclick", onDbl], ["mouseenter", onEnter], ["mouseleave", onLeave]];
  // pointerdown comes before mousedown: stop it too when a drawing takes the press, so the chart does not start a pan.
  function onDownGuard(ev) {
    if (!host || ev.button !== 0 || hidden || (ev.target.closest && ev.target.closest(".cd-bar, .cd-input"))) return;
    var p = local(ev); if (!p) return;
    if (tool !== "select" || pickHandle(p) || pick(p)) { ev.stopPropagation(); }
  }
  function attach(h) {
    if (!h) return detach();
    if (host && host.container === h.container && host.series === h.series) { syncKey(); redraw(); return; }
    detach(); css();
    host = h; key = null; syncKey(); tool = "select"; hidden = false;
    prim = new Primitive(); host.series.attachPrimitive(prim);
    buildBar();
    EVENTS.forEach(function (e) { host.container.addEventListener(e[0], e[1], true); });
    window.addEventListener("mousemove", onMove, true);
    window.addEventListener("mouseup", onUp, true);
    document.addEventListener("keydown", onKey);
  }
  function detach() {
    if (!host) return;
    closeInput(false);
    try { host.series.detachPrimitive(prim); } catch (e) {}
    EVENTS.forEach(function (e) { host.container.removeEventListener(e[0], e[1], true); });
    window.removeEventListener("mousemove", onMove, true);
    window.removeEventListener("mouseup", onUp, true);
    document.removeEventListener("keydown", onKey);
    if (bar) bar.remove();
    host.container.style.cursor = "";
    host = prim = bar = null; key = null; list = []; selected = pending = drag = hover = null;
  }
  // Desktop: a mouse or trackpad (fine pointer that can hover) and room for the toolbar.
  function desktop() { return window.matchMedia && matchMedia("(hover: hover) and (pointer: fine) and (min-width: 900px)").matches; }
  new MutationObserver(function () { sync(); redraw(); }).observe(document.documentElement, { attributes: true, attributeFilter: ["lang"] });
  window.MLMDraw = { attach: attach, detach: detach, desktop: desktop, _state: function () { return { key: key, list: list, tool: tool, hidden: hidden }; } };
})();
