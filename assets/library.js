/* Pattern library pages: theme toggle, language switch (each language has its own page), filters. */
(function(){
  var lang=document.documentElement.lang;
  // The other pages pick their language from mlm-lang; keep it in step with the library page being read.
  try{localStorage.setItem("mlm-lang",lang)}catch(e){}

  var select=document.getElementById("lang");
  if(select)select.addEventListener("change",function(){
    try{localStorage.setItem("mlm-lang",select.value)}catch(e){}
    var href=select.getAttribute("data-href-"+select.value);if(href)location.href=href;
  });

  var toggle=document.getElementById("theme-toggle");
  function dark(){return document.documentElement.dataset.theme?document.documentElement.dataset.theme==="dark":matchMedia("(prefers-color-scheme: dark)").matches}
  function syncTheme(){var d=dark();toggle.setAttribute("aria-pressed",String(d));toggle.setAttribute("aria-label",d?"Switch to light theme":"Switch to dark theme")}
  if(toggle){toggle.addEventListener("click",function(){document.documentElement.dataset.theme=dark()?"light":"dark";try{localStorage.setItem("mlm-theme",document.documentElement.dataset.theme)}catch(e){}syncTheme()});syncTheme()}

  // Topics menu: always open on wide screens (its toggle is hidden there), collapsed on narrow ones.
  var nav=document.querySelector(".lib-nav");
  if(nav&&window.matchMedia){var wide=matchMedia("(min-width:1100px)");var syncNav=function(){if(wide.matches)nav.open=true};syncNav();if(wide.addEventListener)wide.addEventListener("change",syncNav)}

  // Category pages: every card is in the HTML; the direction filter and search only hide cards.
  var cards=[].slice.call(document.querySelectorAll(".pattern-card")),search=document.querySelector(".lib-search"),empty=document.querySelector(".lib-empty");
  if(!search)return;
  var direction="";
  function apply(){
    var q=search.value.trim().toLocaleLowerCase(lang),shown=0;
    cards.forEach(function(card){
      var ok=(!direction||card.dataset.direction===direction)&&(!q||card.dataset.search.indexOf(q)>-1);
      card.hidden=!ok;if(ok)shown++;
    });
    empty.hidden=shown>0;
  }
  document.querySelectorAll('[data-filter="direction"]').forEach(function(button){
    button.addEventListener("click",function(){
      // A second click on the chosen direction clears it.
      direction=direction===button.dataset.value?"":button.dataset.value;
      document.querySelectorAll('[data-filter="direction"]').forEach(function(b){b.setAttribute("aria-pressed",String(b.dataset.value===direction))});
      apply();
    });
  });
  search.addEventListener("input",apply);
})();
