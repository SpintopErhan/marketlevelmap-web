/* Card order on the analysis page (README "Analysis page card order"): the cards of the side column (under the
   chart on phones) can be moved and hidden by anyone. "Edit" shows a bar on each card (drag handle on desktop,
   up / down, hide); hidden cards are listed under the edit bar and come back with one click; "Reset" restores the
   page's order. The choice is kept in this browser (localStorage "mlm-side-layout-v1": { order, hidden }) and holds
   for both views (Critical Zones and Price Action); a card a view does not show is simply skipped. The members-only
   lock card is not part of it and stays on top. A user-hidden card gets the class "user-hidden"; the page's own
   `hidden` attribute (a card with nothing to show) is left alone. */
(function () {
  "use strict";
  var KEY = "mlm-side-layout-v1", FIXED = "lock-block";
  var WORDS = {
    en: { edit: "Edit cards", done: "Done", reset: "Reset order", up: "Move up", down: "Move down", hide: "Hide", drag: "Drag to move",
      hiddenList: "Hidden cards:", note: "Move or hide the cards; the order is kept in this browser.", fold: "Collapse card", unfold: "Expand card" },
    tr: { edit: "Kartları düzenle", done: "Bitti", reset: "Varsayılan sıra", up: "Yukarı taşı", down: "Aşağı taşı", hide: "Gizle", drag: "Sürükleyerek taşı",
      hiddenList: "Gizli kartlar:", note: "Kartları taşıyabilir ya da gizleyebilirsin; sıra bu tarayıcıda saklanır.", fold: "Kartı daralt", unfold: "Kartı aç" }
  };
  function w() { return WORDS[document.documentElement.lang === "tr" ? "tr" : "en"]; }
  var col = null, bar = null, editing = false, defaults = [], state = { order: [], hidden: [] };

  function cards() { return [].filter.call(col.children, function (el) { return el.tagName === "SECTION" && el.classList.contains("block") && el.id && el.id !== FIXED; }); }
  function load() {
    try { var v = JSON.parse(localStorage.getItem(KEY) || "null"); if (v && Array.isArray(v.order)) return { order: v.order.filter(String), hidden: Array.isArray(v.hidden) ? v.hidden : [] }; } catch (e) {}
    return { order: [], hidden: [] };
  }
  function save() {
    state.order = cards().map(function (c) { return c.id; });
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {}
  }
  // Collapsed cards (localStorage "mlm-side-collapsed-v1"): only the title band stays; the arrow at the top right of
  // every card folds and unfolds it. Independent of the order and of "Reset order".
  var FOLD = "mlm-side-collapsed-v1", folded = [];
  function loadFold() { try { var v = JSON.parse(localStorage.getItem(FOLD) || "[]"); return Array.isArray(v) ? v.filter(String) : []; } catch (e) { return []; } }
  function saveFold() { try { localStorage.setItem(FOLD, JSON.stringify(folded)); } catch (e) {} }
  function folds() {
    var t = w();
    cards().forEach(function (card) {
      var b = card.querySelector(":scope > .so-fold");
      if (!b) {
        b = document.createElement("button"); b.type = "button"; b.className = "so-fold";
        b.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>';
        b.addEventListener("click", function () {
          var i = folded.indexOf(card.id); if (i > -1) folded.splice(i, 1); else folded.push(card.id);
          saveFold(); folds();
        });
        card.appendChild(b); card.classList.add("so-has-fold");
      }
      var shut = folded.indexOf(card.id) > -1;
      card.classList.toggle("so-collapsed", shut);
      b.setAttribute("aria-expanded", String(!shut)); b.title = shut ? t.unfold : t.fold; b.setAttribute("aria-label", b.title);
    });
  }
  function title(card) { var h = card.querySelector(".block-head h2"); return h ? h.textContent.trim() : card.id; }

  // Saved order first; a card the saved order does not know (added later) keeps its place after its default neighbour.
  function apply() {
    var list = cards(), byId = {}, known = state.order.filter(function (id) { return document.getElementById(id); });
    list.forEach(function (c) { byId[c.id] = c; });
    var order = known.slice();
    defaults.forEach(function (id, i) {
      if (order.indexOf(id) > -1 || !byId[id]) return;
      var prev = defaults.slice(0, i).reverse().filter(function (p) { return order.indexOf(p) > -1; })[0];
      order.splice(prev ? order.indexOf(prev) + 1 : 0, 0, id);
    });
    var anchor = document.getElementById(FIXED);
    order.forEach(function (id) { if (byId[id]) col.appendChild(byId[id]); });
    col.insertBefore(bar, col.firstChild);
    if (anchor) col.insertBefore(anchor, bar.nextSibling);
    list.forEach(function (c) { c.classList.toggle("user-hidden", state.hidden.indexOf(c.id) > -1); });
    folds();
  }

  // ---- edit bar and card controls ----
  function button(text, title, onClick, cls) {
    var b = document.createElement("button"); b.type = "button"; b.className = cls || "so-btn"; b.textContent = text; if (title) { b.title = title; b.setAttribute("aria-label", title); }
    b.addEventListener("click", onClick); return b;
  }
  function renderBar() {
    var t = w(); bar.textContent = "";
    var row = document.createElement("div"); row.className = "so-row";
    row.appendChild(button(editing ? t.done : t.edit, null, function () { editing = !editing; render(); }, "so-main"));
    if (editing) row.appendChild(button(t.reset, null, function () { state = { order: [], hidden: [] }; try { localStorage.removeItem(KEY); } catch (e) {} defaults.forEach(function (id) { var c = document.getElementById(id); if (c) col.appendChild(c); }); apply(); render(); }, "so-link"));
    bar.appendChild(row);
    if (!editing) return;
    var note = document.createElement("p"); note.className = "so-note"; note.textContent = t.note; bar.appendChild(note);
    var hiddenCards = cards().filter(function (c) { return state.hidden.indexOf(c.id) > -1; });
    if (hiddenCards.length) {
      var hl = document.createElement("div"); hl.className = "so-hidden"; var lab = document.createElement("span"); lab.textContent = t.hiddenList; hl.appendChild(lab);
      hiddenCards.forEach(function (c) { hl.appendChild(button("+ " + title(c), null, function () { state.hidden = state.hidden.filter(function (id) { return id !== c.id; }); save(); apply(); render(); }, "so-chip")); });
      bar.appendChild(hl);
    }
  }
  function visibleCards() { return cards().filter(function (c) { return !c.hidden && !c.classList.contains("user-hidden"); }); }
  function move(card, dir) {
    var vis = visibleCards(), i = vis.indexOf(card), other = vis[i + dir];
    if (!other) return;
    if (dir < 0) col.insertBefore(card, other); else col.insertBefore(card, other.nextSibling);
    save(); render();
    card.scrollIntoView({ block: "nearest" });
  }
  var dragging = null;
  function controls(card) {
    var t = w(), c = document.createElement("div"); c.className = "so-ctl";
    var handle = document.createElement("span"); handle.className = "so-handle"; handle.textContent = "⋮⋮"; handle.title = t.drag; handle.draggable = true;
    handle.addEventListener("dragstart", function (e) { dragging = card; card.classList.add("so-dragging"); try { e.dataTransfer.setData("text/plain", card.id); e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setDragImage(card, 20, 20); } catch (x) {} });
    handle.addEventListener("dragend", function () { if (dragging) dragging.classList.remove("so-dragging"); dragging = null; cards().forEach(function (x) { x.classList.remove("so-over"); }); save(); render(); });
    c.appendChild(handle);
    var vis = visibleCards(), i = vis.indexOf(card);
    var up = button("↑", t.up, function () { move(card, -1); }); up.disabled = i <= 0; c.appendChild(up);
    var dn = button("↓", t.down, function () { move(card, 1); }); dn.disabled = i >= vis.length - 1; c.appendChild(dn);
    c.appendChild(button(t.hide, null, function () { if (state.hidden.indexOf(card.id) < 0) state.hidden.push(card.id); save(); apply(); render(); }, "so-link"));
    return c;
  }
  function onDragOver(e) {
    if (!dragging) return;
    var card = e.target.closest && e.target.closest(".side-col > section.block");
    if (!card || card === dragging || card.id === FIXED) return;
    e.preventDefault();
    var r = card.getBoundingClientRect(), after = e.clientY > r.top + r.height / 2;
    col.insertBefore(dragging, after ? card.nextSibling : card);
  }
  function render() {
    renderBar(); folds();
    col.classList.toggle("so-editing", editing);
    cards().forEach(function (card) {
      var old = card.querySelector(":scope > .so-ctl"); if (old) old.remove();
      if (editing && !card.classList.contains("user-hidden")) card.insertBefore(controls(card), card.firstChild);
    });
  }

  var CSS = ".side-col>.block.user-hidden{display:none!important}" +
    ".side-col>.block.so-has-fold{position:relative}.side-col>.block.so-has-fold>.block-head{padding-right:34px}" +
    ".so-fold{position:absolute;top:13px;right:12px;display:grid;place-items:center;width:28px;height:28px;padding:0;border:1px solid transparent;border-radius:8px;background:none;color:var(--muted);cursor:pointer}" +
    ".so-fold:hover{border-color:var(--line);color:var(--fg)}.so-fold svg{width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;transition:transform .15s ease}" +
    ".so-collapsed .so-fold svg{transform:rotate(-90deg)}" +
    ".so-collapsed>:not(.block-head):not(.so-ctl):not(.so-fold){display:none!important}.side-col>.block.so-collapsed>.block-head{margin-bottom:0!important}" +
    ".so-collapsed>.block-head>:not(:first-child){display:none!important}.so-collapsed>.block-head>:first-child>:not(h2){display:none!important}" +
    ".so-bar{margin:0 0 14px}.so-row{display:flex;align-items:center;gap:12px;justify-content:flex-end}" +
    ".so-main{padding:6px 12px;border:1px solid var(--line);border-radius:9px;background:var(--panel);color:var(--fg);font-family:inherit;font-size:12.5px;font-weight:600;cursor:pointer}" +
    ".so-main:hover{border-color:var(--accent);color:var(--accent)}" +
    ".so-link{padding:0;border:0;background:none;color:var(--muted);font-family:inherit;font-size:12px;font-weight:500;text-decoration:underline;text-underline-offset:3px;cursor:pointer}.so-link:hover{color:var(--fg)}" +
    ".so-note{margin:8px 0 0;color:var(--muted);font-size:12px;text-align:right}" +
    ".so-hidden{display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin-top:8px;font-size:12px;color:var(--muted)}" +
    ".so-chip{padding:4px 9px;border:1px dashed var(--line);border-radius:999px;background:none;color:var(--fg);font-family:inherit;font-size:12px;font-weight:500;cursor:pointer}.so-chip:hover{border-color:var(--accent);color:var(--accent)}" +
    ".so-ctl{display:flex;align-items:center;gap:6px;justify-content:flex-end;margin:-6px -6px 10px;padding:5px 6px;border-radius:9px;background:var(--raise,rgba(127,127,127,.08))}" +
    ".so-ctl .so-btn{width:28px;height:26px;border:1px solid var(--line);border-radius:7px;background:var(--panel);color:var(--fg);font-family:inherit;font-size:13px;font-weight:600;cursor:pointer}" +
    ".so-ctl .so-btn:disabled{opacity:.35;cursor:default}.so-ctl .so-btn:hover:not(:disabled){border-color:var(--accent);color:var(--accent)}" +
    ".so-handle{margin-right:auto;padding:2px 6px;color:var(--muted);font-weight:700;letter-spacing:-2px;cursor:grab;user-select:none}" +
    ".so-editing>.block:not(.user-hidden){outline:1px dashed var(--line);outline-offset:-1px}.so-dragging{opacity:.5}" +
    "@media (hover:none),(pointer:coarse){.so-handle{display:none}.so-ctl{justify-content:flex-end}}";

  function boot() {
    col = document.querySelector(".side-col"); if (!col) return;
    defaults = cards().map(function (c) { return c.id; });
    state = load(); folded = loadFold();
    var s = document.createElement("style"); s.textContent = CSS; document.head.appendChild(s);
    bar = document.createElement("div"); bar.className = "so-bar"; col.insertBefore(bar, col.firstChild);
    apply(); render();
    col.addEventListener("dragover", onDragOver);
    col.addEventListener("drop", function (e) { if (dragging) e.preventDefault(); });
    new MutationObserver(function () { render(); }).observe(document.documentElement, { attributes: true, attributeFilter: ["lang"] });
  }
  window.MLMSideOrder = { _state: function () { return { order: cards().map(function (c) { return c.id; }), hidden: state.hidden.slice(), editing: editing }; } };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();
})();
