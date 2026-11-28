/* Back to top (README "Back to top"): a round arrow button at the bottom right that appears once the page has been
   scrolled more than about one and a half screens and brings it back to the top (smoothly, unless the visitor asked
   for reduced motion). Not inside an embedded page (html.embed). Words follow the page language. */
(function () {
  "use strict";
  if (document.documentElement.classList.contains("embed")) return;
  var CSS = ".to-top{position:fixed;right:18px;bottom:18px;z-index:90;display:flex;align-items:center;justify-content:center;width:44px;height:44px;" +
    "border:1px solid var(--line);border-radius:50%;background:var(--panel);color:var(--fg);box-shadow:0 8px 24px rgba(0,0,0,.28);cursor:pointer;" +
    "opacity:0;transform:translateY(12px);pointer-events:none;transition:opacity .2s ease,transform .2s ease,border-color .2s ease,color .2s ease}" +
    ".to-top.show{opacity:1;transform:none;pointer-events:auto}.to-top:hover{border-color:var(--accent);color:var(--accent)}" +
    ".to-top:focus-visible{outline:2px solid var(--accent);outline-offset:2px}.to-top svg{width:20px;height:20px;fill:none;stroke:currentColor;stroke-width:2.2;stroke-linecap:round;stroke-linejoin:round}" +
    "@media(max-width:520px){.to-top{right:14px;bottom:14px;width:42px;height:42px}}@media print{.to-top{display:none}}";
  function label() { return document.documentElement.lang === "tr" ? "Sayfanın başına dön" : "Back to top"; }
  function start() {
    var style = document.createElement("style"); style.textContent = CSS; document.head.appendChild(style);
    var b = document.createElement("button");
    b.type = "button"; b.className = "to-top"; b.tabIndex = -1;
    b.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 19V5"/><path d="M5 12l7-7 7 7"/></svg>';
    function words() { b.setAttribute("aria-label", label()); b.title = label(); }
    words(); document.body.appendChild(b);
    var shown = false;
    function check() {
      var on = window.scrollY > window.innerHeight * 1.5;
      if (on !== shown) { shown = on; b.classList.toggle("show", on); b.tabIndex = on ? 0 : -1; }
    }
    window.addEventListener("scroll", check, { passive: true }); window.addEventListener("resize", check); check();
    b.addEventListener("click", function () {
      var calm = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
      window.scrollTo({ top: 0, behavior: calm ? "auto" : "smooth" });
      var first = document.querySelector("main h1, h1"); if (first) { first.setAttribute("tabindex", "-1"); first.focus({ preventScroll: true }); }
    });
    new MutationObserver(words).observe(document.documentElement, { attributes: true, attributeFilter: ["lang"] });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
})();
