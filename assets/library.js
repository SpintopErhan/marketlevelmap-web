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

  // Library home: every card is in the HTML; filters and search only hide cards.
  var cards=[].slice.call(document.querySelectorAll(".pattern-card")),search=document.querySelector(".lib-search"),empty=document.querySelector(".lib-empty");
  if(!search)return;
  var chosen={kind:"",direction:""};
  function apply(){
    var q=search.value.trim().toLocaleLowerCase(lang),shown=0;
    cards.forEach(function(card){
      var ok=(!chosen.kind||card.dataset.kind===chosen.kind)&&(!chosen.direction||card.dataset.direction===chosen.direction)&&(!q||card.dataset.search.indexOf(q)>-1);
      card.hidden=!ok;if(ok)shown++;
    });
    empty.hidden=shown>0;
  }
  document.querySelectorAll("[data-filter]").forEach(function(button){
    button.addEventListener("click",function(){
      var group=button.dataset.filter,value=button.dataset.value;
      // Direction buttons toggle (a second click clears); "All" clears the category.
      chosen[group]=group==="direction"&&chosen.direction===value?"":value;
      document.querySelectorAll('[data-filter="'+group+'"]').forEach(function(b){b.setAttribute("aria-pressed",String(group==="kind"?b.dataset.value===chosen.kind:b.dataset.value===chosen.direction))});
      apply();
    });
  });
  search.addEventListener("input",apply);
})();
