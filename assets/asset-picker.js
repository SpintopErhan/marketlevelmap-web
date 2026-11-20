/* Asset search and watchlist on the analysis page (README "Asset search and watchlist"). Public.
   - Search: clicking the asset name (or the arrow next to it), or typing a letter anywhere on the page, opens a
     window that lists every analysed asset with its live price and 24 h change; typing filters it; ↑ ↓ and Enter
     choose, Escape closes. Favourites (the home page's stars, localStorage "mlm-favorites") come first.
   - Watchlist: the list icon opens the same list as a panel at the right. On wide screens (≥ 1480 px) it is docked
     beside the page and its open state is kept (localStorage "mlm-watchlist-open"); on narrower ones it slides over
     the page and closes when an asset is picked.
   - Choosing an asset opens its analysis page, keeping the timeframe and the view (Critical Zones / Price Action).
   The page gives the list and the live prices: MLMPicker.init({ assets, current }) and MLMPicker.quote(sym, d)
   with d = { c: last price, o: open 24 h ago } (the price band's feed). */
(function () {
  "use strict";
  var WORDS = {
    en: { search: "Search an asset", choose: "Choose an asset", watch: "Watchlist", close: "Close", none: "No asset matches", hint: "↑ ↓ to move · Enter to open · Esc to close" },
    tr: { search: "Varlık ara", choose: "Varlık seç", watch: "İzleme listesi", close: "Kapat", none: "Eşleşen varlık yok", hint: "↑ ↓ ile gez · Enter ile aç · Esc ile kapat" }
  };
  function w() { return WORDS[document.documentElement.lang === "tr" ? "tr" : "en"]; }
  var assets = [], current = null, quotes = {}, cells = {}, modal = null, panel = null, sel = 0, shown = [];
  function favs() { try { var v = JSON.parse(localStorage.getItem("mlm-favorites") || "[]"); return Array.isArray(v) ? v : []; } catch (e) { return []; } }
  function ordered() { var f = favs(); return assets.filter(function (s) { return f.indexOf(s) > -1; }).concat(assets.filter(function (s) { return f.indexOf(s) < 0; })); }
  function hue(sym) { var base = sym.replace(/(USDT|USDC|FDUSD|BUSD|USD|TRY|EUR)$/, "") || sym, h = 0; for (var i = 0; i < base.length; i++) h = (h * 31 + base.charCodeAt(i)) % 360; return h; }
  function href(sym) { var u = new URL(location.href); u.searchParams.set("asset", sym); u.hash = ""; return u.pathname + u.search; }
  function go(sym) {
    if (sym === current) { closeAll(); return; }
    // The analysis page switches in place when it can (bulletin.html "Asset switch"); otherwise the next page loads,
    // with the chosen row marked meanwhile.
    if (window.MLMSwitchAsset && window.MLMSwitchAsset(sym)) { closeAll(); return; }
    if (window.MLMLeaving) window.MLMLeaving(document.querySelector('.ap-row[data-sym="' + sym + '"]'));
    location.href = href(sym);
  }
  // The page changed its asset in place: mark the new one and point the rows at the new address.
  function setCurrent(sym) {
    current = sym;
    [].forEach.call(document.querySelectorAll(".ap-row[data-sym]"), function (a) {
      var on = a.dataset.sym === sym; if (on) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
      a.href = href(a.dataset.sym);
    });
  }

  // ---- one row (used by both lists) ----
  function row(sym, isFav) {
    var a = document.createElement("a"); a.className = "ap-row"; a.href = href(sym); a.dataset.sym = sym;
    if (sym === current) a.setAttribute("aria-current", "page");
    var base = MarketUI.baseOf(sym), ic = document.createElement("span"); ic.className = "ap-ic"; ic.textContent = base.slice(0, 4); ic.style.background = "hsl(" + hue(sym) + " 62% 64%)";
    var nm = document.createElement("span"); nm.className = "ap-nm"; nm.innerHTML = "<b></b><small></small>"; nm.firstChild.textContent = base + (isFav ? " ★" : ""); nm.lastChild.textContent = MarketUI.nameOf(sym);
    var pr = document.createElement("span"), ch = document.createElement("span"); pr.className = "ap-pr num"; ch.className = "ap-ch num";
    a.appendChild(ic); a.appendChild(nm); a.appendChild(pr); a.appendChild(ch);
    a.addEventListener("click", function (e) { if (e.ctrlKey || e.metaKey || e.shiftKey || e.button) return; e.preventDefault(); go(sym); });
    var cell = { pr: pr, ch: ch };
    (cells[sym] || (cells[sym] = [])).push(cell);
    if (quotes[sym]) put(cell, quotes[sym]); // the row is not in the page yet, so it is filled directly
    return a;
  }
  function put(c, d) {
    var p = Number(d.c), r = Number(d.o) > 0 ? p / Number(d.o) - 1 : NaN;
    c.pr.textContent = MarketUI.price(p); c.ch.textContent = isFinite(r) ? MarketUI.pct(r) : ""; c.ch.className = "ap-ch num " + MarketUI.signClass(r);
  }
  // A new price: refresh the rows on screen and forget the ones that were removed (a closed window, a new filter).
  function paint(sym) {
    var d = quotes[sym], list = cells[sym]; if (!list || !d) return;
    cells[sym] = list = list.filter(function (c) { return c.pr.isConnected; });
    list.forEach(function (c) { put(c, d); });
  }
  function fill(box, filter) {
    box.textContent = ""; var f = favs(), q = String(filter || "").trim().toUpperCase();
    shown = ordered().filter(function (s) { return !q || s.indexOf(q) > -1 || MarketUI.nameOf(s).toUpperCase().indexOf(q) > -1; });
    if (!shown.length) { var e = document.createElement("p"); e.className = "ap-none"; e.textContent = w().none; box.appendChild(e); }
    shown.forEach(function (s) { box.appendChild(row(s, f.indexOf(s) > -1)); });
  }

  // ---- search window ----
  function openSearch(first) {
    if (!assets.length) return;
    if (modal) { modal.input.focus(); return; }
    var t = w(), back = document.createElement("div"); back.className = "ap-back";
    var box = document.createElement("div"); box.className = "ap-modal"; box.setAttribute("role", "dialog"); box.setAttribute("aria-modal", "true"); box.setAttribute("aria-label", t.choose);
    var head = document.createElement("div"); head.className = "ap-head";
    var input = document.createElement("input"); input.type = "search"; input.className = "ap-input"; input.placeholder = t.search; input.setAttribute("aria-label", t.search); input.autocomplete = "off"; input.spellcheck = false;
    var x = document.createElement("button"); x.type = "button"; x.className = "ap-x"; x.setAttribute("aria-label", t.close); x.textContent = "×";
    head.appendChild(input); head.appendChild(x);
    var list = document.createElement("div"); list.className = "ap-list"; list.setAttribute("role", "listbox");
    var hint = document.createElement("p"); hint.className = "ap-hint"; hint.textContent = t.hint;
    box.appendChild(head); box.appendChild(list); box.appendChild(hint); back.appendChild(box);
    // Inside a full-screen element (the expanded chart) only that element is shown, so the window goes there.
    (document.fullscreenElement || document.body).appendChild(back);
    modal = { back: back, input: input, list: list };
    function refresh() { fill(list, input.value); sel = 0; mark(); }
    input.addEventListener("input", refresh);
    input.addEventListener("keydown", function (e) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); sel = Math.max(0, Math.min(shown.length - 1, sel + (e.key === "ArrowDown" ? 1 : -1))); mark(); }
      else if (e.key === "Enter") { e.preventDefault(); if (shown[sel]) go(shown[sel]); }
      else if (e.key === "Escape") { e.preventDefault(); closeSearch(); }
    });
    x.addEventListener("click", closeSearch);
    back.addEventListener("mousedown", function (e) { if (e.target === back) closeSearch(); });
    input.value = first || ""; refresh();
    // Start on the asset shown now when there is no typed letter.
    if (!first) { var i = shown.indexOf(current); if (i > -1) { sel = i; mark(); } }
    setTimeout(function () { input.focus(); }, 0);
  }
  function mark() {
    if (!modal) return;
    [].forEach.call(modal.list.querySelectorAll(".ap-row"), function (r, i) { var on = i === sel; r.classList.toggle("sel", on); r.setAttribute("aria-selected", String(on)); if (on) r.scrollIntoView({ block: "nearest" }); });
  }
  function closeSearch() { if (!modal) return; modal.back.remove(); modal = null; }

  // ---- watchlist panel ----
  var OPEN = "mlm-watchlist-open";
  function docked() { return window.matchMedia && matchMedia("(min-width: 1480px)").matches; }
  function togglePanel(force) {
    var open = force != null ? force : !panel;
    if (open && !panel) {
      var t = w(); panel = document.createElement("aside"); panel.className = "ap-panel"; panel.setAttribute("aria-label", t.watch);
      var head = document.createElement("div"); head.className = "ap-phead";
      var h = document.createElement("b"); h.textContent = t.watch;
      var x = document.createElement("button"); x.type = "button"; x.className = "ap-x"; x.setAttribute("aria-label", t.close); x.textContent = "×"; x.addEventListener("click", function () { togglePanel(false); });
      head.appendChild(h); head.appendChild(x);
      var input = document.createElement("input"); input.type = "search"; input.className = "ap-input ap-pinput"; input.placeholder = t.search; input.setAttribute("aria-label", t.search); input.autocomplete = "off";
      var list = document.createElement("div"); list.className = "ap-list ap-plist";
      input.addEventListener("input", function () { fill(list, input.value); });
      panel.appendChild(head); panel.appendChild(input); panel.appendChild(list); document.body.appendChild(panel);
      fill(list, "");
      var cur = list.querySelector('[aria-current="page"]'); if (cur) cur.scrollIntoView({ block: "center" });
    } else if (!open && panel) { panel.remove(); panel = null; }
    var dock = !!panel && docked();
    document.documentElement.classList.toggle("ap-docked", dock);
    document.documentElement.classList.toggle("ap-over", !!panel && !dock);
    if (toggleBtn) toggleBtn.setAttribute("aria-pressed", String(!!panel));
    if (docked()) { try { localStorage.setItem(OPEN, panel ? "1" : "0"); } catch (e) {} }
    window.dispatchEvent(new Event("resize"));
  }
  function closeAll() { closeSearch(); if (panel && !docked()) togglePanel(false); }

  // ---- header controls ----
  var toggleBtn = null;
  function controls() {
    var t = w(), title = document.getElementById("title"), head = title && title.parentNode; if (!head || head.querySelector(".ap-open")) return;
    var open = document.createElement("button"); open.type = "button"; open.className = "ap-open"; open.title = t.choose; open.setAttribute("aria-label", t.choose);
    open.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>';
    open.addEventListener("click", function () { openSearch(""); });
    title.insertAdjacentElement("afterend", open);
    title.classList.add("ap-title"); title.addEventListener("click", function () { openSearch(""); });
    var icon = document.getElementById("asset-icon"); if (icon) { icon.classList.add("ap-title"); icon.addEventListener("click", function () { openSearch(""); }); }
    toggleBtn = document.createElement("button"); toggleBtn.type = "button"; toggleBtn.className = "ap-wl"; toggleBtn.title = t.watch; toggleBtn.setAttribute("aria-label", t.watch); toggleBtn.setAttribute("aria-pressed", "false");
    toggleBtn.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01"/></svg>';
    toggleBtn.addEventListener("click", function () { togglePanel(); });
    open.insertAdjacentElement("afterend", toggleBtn);
  }
  // Typing a letter or digit anywhere (not in a field, no modifier) opens the search with that letter.
  document.addEventListener("keydown", function (e) {
    if (!assets.length || modal || e.ctrlKey || e.metaKey || e.altKey || e.key.length !== 1 || !/[a-z0-9]/i.test(e.key)) return;
    var tg = e.target; if (tg && (/^(INPUT|TEXTAREA|SELECT)$/.test(tg.tagName) || tg.isContentEditable)) return;
    e.preventDefault(); openSearch(e.key.toUpperCase());
  });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape" && panel && !docked() && !modal) togglePanel(false); });
  window.addEventListener("resize", function () { if (!panel) return; var dock = docked(); document.documentElement.classList.toggle("ap-docked", dock); document.documentElement.classList.toggle("ap-over", !dock); });

  var CSS = ".ap-title{cursor:pointer}.ap-open,.ap-wl{display:inline-grid;place-items:center;width:30px;height:30px;padding:0;border:1px solid var(--line);border-radius:9px;background:var(--panel);color:var(--muted);cursor:pointer;flex:none}" +
    ".ap-open:hover,.ap-wl:hover,.ap-wl[aria-pressed=true]{color:var(--fg);border-color:var(--accent)}.ap-open svg,.ap-wl svg{width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}" +
    ".ap-back{position:fixed;inset:0;z-index:90;display:flex;align-items:flex-start;justify-content:center;padding:9vh 16px 16px;background:rgba(6,10,14,.55)}" +
    ".ap-modal{width:min(560px,100%);max-height:78vh;display:flex;flex-direction:column;border:1px solid var(--line);border-radius:14px;background:var(--panel);box-shadow:0 24px 60px rgba(0,0,0,.45);overflow:hidden}" +
    ".ap-head{display:flex;align-items:center;gap:8px;padding:12px;border-bottom:1px solid var(--line)}" +
    ".ap-input{flex:1;min-width:0;height:38px;padding:0 12px;border:1px solid var(--line);border-radius:9px;background:var(--bg);color:var(--fg);font:inherit;font-size:15px;outline:none}.ap-input:focus{border-color:var(--accent)}" +
    ".ap-x{flex:none;width:32px;height:32px;padding:0;border:0;border-radius:8px;background:none;color:var(--muted);font-size:22px;line-height:1;cursor:pointer}.ap-x:hover{color:var(--fg);background:var(--bg)}" +
    ".ap-list{overflow-y:auto;padding:6px}.ap-modal .ap-list{flex:1}" +
    ".ap-row{display:grid;grid-template-columns:34px minmax(0,1fr) auto 72px;align-items:center;gap:10px;padding:8px 10px;border-radius:9px;color:var(--fg);text-decoration:none}" +
    ".ap-row:hover,.ap-row.sel{background:var(--bg)}.ap-row[aria-current=page]{box-shadow:inset 3px 0 0 var(--accent)}" +
    ".ap-ic{display:grid;place-items:center;width:34px;height:34px;border-radius:50%;color:#0b1a17;font-size:9.5px;font-weight:700;overflow:hidden}" +
    ".ap-nm{display:grid;min-width:0}.ap-nm b{font-size:14px}.ap-nm small{color:var(--muted);font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}" +
    ".ap-pr{font-size:13.5px;font-weight:600;text-align:right}.ap-ch{font-size:12.5px;text-align:right}.ap-ch.up{color:var(--up)}.ap-ch.down{color:var(--down)}" +
    ".ap-none{margin:18px;color:var(--muted);text-align:center}.ap-hint{margin:0;padding:8px 14px;border-top:1px solid var(--line);color:var(--muted);font-size:11.5px}" +
    ".ap-panel{position:fixed;top:0;right:0;bottom:0;z-index:80;width:290px;display:flex;flex-direction:column;border-left:1px solid var(--line);background:var(--panel);box-shadow:-12px 0 40px rgba(0,0,0,.25)}" +
    ".ap-phead{display:flex;align-items:center;justify-content:space-between;padding:12px 12px 8px 16px}.ap-phead b{font-size:15px}.ap-pinput{flex:none;margin:0 12px 6px;height:34px;font-size:13.5px}.ap-plist{flex:1}" +
    ".ap-panel .ap-row{grid-template-columns:28px minmax(0,1fr) auto;grid-template-rows:auto auto;column-gap:8px;row-gap:0;padding:7px 8px}.ap-panel .ap-ic{grid-row:1/3;width:28px;height:28px;font-size:8px}" +
    ".ap-panel .ap-nm{grid-row:1/3}.ap-panel .ap-pr{grid-column:3;grid-row:1}.ap-panel .ap-ch{grid-column:3;grid-row:2;font-size:11.5px}" +
    "html.ap-docked body{padding-right:290px}html.ap-docked .ap-panel{box-shadow:none}" +
    "@media(max-width:640px){.ap-back{padding:0}.ap-modal{width:100%;max-height:100%;height:100%;border-radius:0;border:0}.ap-panel{width:min(320px,88vw)}.ap-hint{display:none}}";
  function init(o) {
    assets = (o && o.assets || []).slice(); current = o && o.current || null;
    if (!document.getElementById("ap-css")) { var s = document.createElement("style"); s.id = "ap-css"; s.textContent = CSS; document.head.appendChild(s); }
    controls();
    var open = false; try { open = localStorage.getItem(OPEN) === "1"; } catch (e) {}
    if (open && docked()) togglePanel(true);
  }
  new MutationObserver(function () {
    var t = w(), o = document.querySelector(".ap-open"); if (o) { o.title = t.choose; o.setAttribute("aria-label", t.choose); }
    if (toggleBtn) { toggleBtn.title = t.watch; toggleBtn.setAttribute("aria-label", t.watch); }
  }).observe(document.documentElement, { attributes: true, attributeFilter: ["lang"] });
  window.MLMPicker = { init: init, quote: function (sym, d) { quotes[sym] = d; paint(sym); }, open: openSearch, togglePanel: togglePanel, setCurrent: setCurrent };
})();
