/* Explanatory notes behind an ⓘ button (README "Info tips"). A note marked data-tip is folded away: a small ⓘ button
   opens it in a box (tap or click; on a mouse also on hover), tap again, outside or Escape closes it. data-tip="<CSS
   selector>" puts the button at the end of that element (a heading, a short line); empty, the button (with the word
   "Explanation") takes the note's place. The note element itself is moved into the box, so the page's language switch
   (data-i18n and the like) and hidden attribute keep working: a hidden note hides its button too.
   Legal notices, data-as-of lines and warnings are not marked and stay in view. InfoTip.scan(root) folds notes added
   later. */
(function () {
  "use strict";
  var CSS = ".tip-wrap{display:inline-block;vertical-align:middle;margin-left:6px;line-height:1}.tip-wrap[hidden]{display:none}" +
    ".tip-wrap.tip-inline{display:block;margin:8px 0 0}" +
    ".tip-btn{display:inline-flex;align-items:center;gap:5px;min-width:24px;min-height:24px;padding:0 2px;border:0;border-radius:999px;background:none;color:var(--muted);font:500 12px Inter,system-ui,sans-serif;letter-spacing:normal;text-transform:none;cursor:pointer;vertical-align:middle}" +
    ".tip-btn svg{width:16px;height:16px;flex:none;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round}" +
    ".tip-btn:hover,.tip-btn[aria-expanded=true]{color:var(--accent)}.tip-btn:focus-visible{outline:2px solid var(--accent);outline-offset:2px}" +
    ".tip-pop{display:none!important;position:fixed;z-index:120;box-sizing:border-box;width:max-content;max-width:min(360px,calc(100vw - 24px));margin:0!important;padding:10px 12px;border:1px solid var(--line);border-radius:10px;" +
    "background:var(--panel);color:var(--fg);box-shadow:0 12px 32px rgba(0,0,0,.3);font:400 12.5px/1.55 Inter,system-ui,sans-serif;letter-spacing:normal;text-transform:none;text-align:left;white-space:normal}" +
    ".tip-pop.tip-open{display:block!important}";
  var WORDS = { en: { more: "Explanation", open: "Show the explanation" }, tr: { more: "Açıklama", open: "Açıklamayı göster" } };
  function w() { return WORDS[document.documentElement.lang === "tr" ? "tr" : "en"]; }
  var ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 11v5"/><path d="M12 7.6v.2"/></svg>';
  var tips = [], current = null, count = 0, fine = window.matchMedia && matchMedia("(hover: hover) and (pointer: fine)").matches;

  // Under the button, or above it when there is more room there; always inside the window.
  function place(t) {
    var r = t.btn.getBoundingClientRect(), p = t.note, vw = document.documentElement.clientWidth, vh = window.innerHeight;
    p.style.left = "0px"; p.style.top = "0px";
    var pw = p.offsetWidth, ph = p.offsetHeight, left = Math.min(Math.max(12, r.left), vw - 12 - pw);
    var below = vh - 8 - (r.bottom + 6), above = r.top - 6 - 8;
    var top = ph <= below || below >= above ? r.bottom + 6 : r.top - 6 - ph;
    top = Math.max(8, Math.min(top, vh - 8 - ph));
    p.style.left = Math.max(12, left) + "px"; p.style.top = top + "px";
  }
  function close(t) {
    if (!t) return;
    t.note.classList.remove("tip-open"); t.btn.setAttribute("aria-expanded", "false"); t.pinned = false;
    if (t.note.parentNode !== t.wrap) t.wrap.appendChild(t.note); // back in place (the page's code still finds it)
    if (current === t) current = null;
  }
  function open(t, pinned) {
    if (current && current !== t) close(current);
    var r = t.btn.getBoundingClientRect();
    if (pinned && (r.top < 0 || r.bottom > window.innerHeight)) t.btn.scrollIntoView({ block: "center" });
    current = t; t.pinned = t.pinned || !!pinned;
    // Open, the box lives at the top of the page: an ancestor with a transform (the pages' entry animations) would
    // otherwise position a fixed box relative to itself.
    (document.fullscreenElement || document.body).appendChild(t.note);
    t.note.classList.add("tip-open"); t.btn.setAttribute("aria-expanded", "true"); place(t);
  }
  function labels(t) {
    var x = w(); t.btn.setAttribute("aria-label", x.open); t.btn.title = x.open;
    var l = t.btn.querySelector(".tip-lbl"); if (l) l.textContent = x.more;
  }
  function make(note) {
    if (note.__tip) return;
    var anchor = note.getAttribute("data-tip") ? document.querySelector(note.getAttribute("data-tip")) : null;
    var wrap = document.createElement("span"), btn = document.createElement("button");
    wrap.className = "tip-wrap" + (anchor ? "" : " tip-inline");
    btn.type = "button"; btn.className = "tip-btn"; btn.setAttribute("aria-expanded", "false");
    btn.innerHTML = ICON + (anchor ? "" : '<span class="tip-lbl"></span>');
    if (!note.id) note.id = "tip-" + (++count);
    btn.setAttribute("aria-controls", note.id); note.setAttribute("role", "note");
    note.classList.add("tip-pop");
    if (anchor) anchor.appendChild(wrap); else note.parentNode.insertBefore(wrap, note);
    wrap.appendChild(btn); wrap.appendChild(note);
    var t = { note: note, btn: btn, wrap: wrap, pinned: false };
    note.__tip = t; tips.push(t); labels(t);
    function sync() { wrap.hidden = note.hidden; if (note.hidden) close(t); }
    new MutationObserver(sync).observe(note, { attributes: true, attributeFilter: ["hidden"] }); sync();
    // Clicks inside stay here (a heading's own click, e.g. a card that folds, must not see them).
    wrap.addEventListener("click", function (e) { e.stopPropagation(); });
    note.addEventListener("click", function (e) { e.stopPropagation(); });
    btn.addEventListener("click", function (e) { e.preventDefault(); if (current === t && t.pinned) close(t); else open(t, true); });
    if (fine) {
      wrap.addEventListener("mouseenter", function () { if (!current || !current.pinned) open(t, false); });
      wrap.addEventListener("mouseleave", function (e) { if (current === t && !t.pinned && e.relatedTarget !== note && !note.contains(e.relatedTarget)) close(t); });
      note.addEventListener("mouseleave", function (e) { if (current === t && !t.pinned && !wrap.contains(e.relatedTarget)) close(t); });
    }
  }
  function scan(root) { [].forEach.call((root || document).querySelectorAll("[data-tip]"), make); }

  document.addEventListener("click", function () { if (current) close(current); });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape" && current) { var b = current.btn; close(current); b.focus(); } });
  window.addEventListener("resize", function () { if (current) place(current); });
  window.addEventListener("scroll", function () { if (current) place(current); }, true);
  new MutationObserver(function () { tips.forEach(labels); }).observe(document.documentElement, { attributes: true, attributeFilter: ["lang"] });

  var style = document.createElement("style"); style.textContent = CSS; document.head.appendChild(style);
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", function () { scan(); });
  else scan();
  window.InfoTip = { scan: scan };
})();
