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

  document.querySelectorAll(".nav-toggle").forEach(function(button){
    button.addEventListener("click",function(){var group=button.closest(".nav-group"),open=group.classList.toggle("open");button.setAttribute("aria-expanded",String(open))});
  });

  // Library-wide word search (the boxes in the topics menu and on the library home page).
  // Case and Turkish letters do not matter ("kirilim" finds "kırılım"); every word must match the start of a word.
  // Matches in the name rank first, then the alternative name, category and section titles, then key points and summary.
  var indexes={};
  function fold(text){return String(text||"").toLocaleLowerCase("tr").normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/ı/g,"i")}
  function escapeRe(text){return text.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")}
  function loadIndex(url){
    if(!indexes[url])indexes[url]=fetch(url).then(function(r){return r.ok?r.json():{pages:[]}}).then(function(d){
      return (d.pages||[]).map(function(p,i){
        var fields=[["n",p.n,10],["a",p.a,8],["c",p.c,3]].concat(p.t.map(function(x){return["t",x,3]}),p.k.map(function(x){return["k",x,2]}),[["s",p.s,2]]);
        return{page:p,order:i,fields:fields.map(function(f){return{kind:f[0],text:f[1],folded:fold(f[1]),weight:f[2]}})};
      });
    }).catch(function(){delete indexes[url];return[]});
    return indexes[url];
  }
  function findPages(entries,query){
    var words=fold(query).split(/[^a-z0-9]+/).filter(Boolean);if(!words.length)return[];
    var res=words.map(function(w){return new RegExp("(^|[^a-z0-9])"+escapeRe(w))});
    var hits=[];
    entries.forEach(function(e){
      var score=0,ok=res.every(function(re){
        var best=0;e.fields.forEach(function(f){if(f.weight>best&&re.test(f.folded))best=f.weight});
        score+=best;return best>0;
      });
      if(!ok)return;
      if(e.fields[0].folded.indexOf(fold(query).trim())===0)score+=6;
      hits.push({e:e,score:score,res:res});
    });
    return hits.sort(function(a,b){return b.score-a.score||a.e.order-b.e.order}).slice(0,12);
  }
  // A short line under the name: the first key point, summary or section title that contains a searched word, words marked.
  function snippet(hit){
    var rank={k:0,s:1,t:2},fields=hit.e.fields.filter(function(f){return f.kind in rank}).sort(function(a,b){return rank[a.kind]-rank[b.kind]});
    var f=fields.filter(function(f){return hit.res.some(function(re){return re.test(f.folded)})})[0]||hit.e.fields[hit.e.fields.length-1];
    var text=f.text,folded=f.folded,start=0;
    if(f.kind==="s"&&text.length>150){
      var at=-1;hit.res.forEach(function(re){var m=re.exec(folded);if(m&&(at<0||m.index<at))at=m.index});
      if(at>90){start=text.lastIndexOf(" ",at-40)+1;}
      text=(start?"…":"")+text.slice(start,start+150)+(start+150<f.text.length?"…":"");
      folded=(start?"…":"")+folded.slice(start,start+150)+(start+150<f.folded.length?"…":"");
    }
    var out=document.createElement("span");out.className="find-snip";
    if(folded.length!==text.length){out.textContent=text;return out}
    var marks=[];hit.res.forEach(function(re){var g=new RegExp(re.source,"g"),m;while((m=g.exec(folded))){var b=m.index+m[1].length;marks.push([b,m.index+m[0].length]);if(g.lastIndex===m.index)g.lastIndex++}});
    marks.sort(function(a,b){return a[0]-b[0]});
    var pos=0;marks.forEach(function(r){if(r[0]<pos)return;out.appendChild(document.createTextNode(text.slice(pos,r[0])));var m=document.createElement("mark");m.textContent=text.slice(r[0],r[1]);out.appendChild(m);pos=r[1]});
    out.appendChild(document.createTextNode(text.slice(pos)));return out;
  }
  document.querySelectorAll(".lib-find").forEach(function(box){
    var input=box.querySelector(".lib-find-input"),list=box.querySelector(".lib-find-results"),request=0;
    function close(){list.hidden=true;input.setAttribute("aria-expanded","false")}
    function links(){return [].slice.call(list.querySelectorAll("a"))}
    function render(){
      var query=input.value,mine=++request;
      if(!query.trim()){list.textContent="";close();return}
      loadIndex(box.dataset.index).then(function(entries){
        if(mine!==request)return;
        list.textContent="";
        var hits=findPages(entries,query);
        if(!hits.length){var li=document.createElement("li");li.className="find-empty";li.textContent=box.dataset.empty;list.appendChild(li)}
        hits.forEach(function(hit){
          var li=document.createElement("li"),a=document.createElement("a"),name=document.createElement("strong"),cat=document.createElement("span");
          li.setAttribute("role","option");a.href=hit.e.page.u;name.textContent=hit.e.page.n;cat.className="find-cat";cat.textContent=hit.e.page.c;
          a.appendChild(name);a.appendChild(cat);a.appendChild(snippet(hit));li.appendChild(a);list.appendChild(li);
        });
        list.hidden=false;input.setAttribute("aria-expanded","true");
      });
    }
    input.addEventListener("input",render);
    input.addEventListener("focus",function(){loadIndex(box.dataset.index);if(input.value.trim())render()});
    // Arrow keys move through the results, Enter opens the first one, Escape closes the list.
    box.addEventListener("keydown",function(e){
      var all=links(),i=all.indexOf(document.activeElement);
      if(e.key==="ArrowDown"&&all.length){e.preventDefault();all[Math.min(i+1,all.length-1)].focus()}
      else if(e.key==="ArrowUp"&&all.length){e.preventDefault();if(i<=0)input.focus();else all[i-1].focus()}
      else if(e.key==="Enter"&&document.activeElement===input&&all.length){e.preventDefault();location.href=all[0].href}
      else if(e.key==="Escape"){close();input.focus()}
    });
    document.addEventListener("click",function(e){if(!box.contains(e.target))close()});
  });

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
