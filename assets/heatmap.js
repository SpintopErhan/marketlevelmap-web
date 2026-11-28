/* Market heat map and market breadth (README "Market heat map", "Market breadth"), shared by the home page and the
   market map page (/market-map). The page gives an element with data-heatmap (optionally data-more-href: a link at the
   bottom; class hm-big: a taller map); this module fills it, adds its styles and words (en, tr) and follows the page
   language. Live figures come from window.MLMQuotes ({ order, get(sym) → { price, volume, live, day, week, month,
   ath } }) and its "mlm-quotes" event: the home page's market table provides it, assets/quotes.js elsewhere.
   Needs MarketUI and Treemap. */
(function () {
  "use strict";
  var WORDS = {"en": {"hmTitle": "Market map", "hmLive": "Live", "hmDay": "Yesterday", "hmWeek": "Last week", "hmMonth": "Last month", "hmLiveRange": "Last 24 hours · live", "hmDayRange": "Yesterday · {d} (UTC day, open to close)", "hmWeekRange": "Week {n} · {d}", "hmMonthRange": "{d}", "hmNote": "Each tile's size follows the asset's 24-hour volume (its square root, so the small ones stay readable); the macro tiles are all the same size. Live: the last 24 hours, updated live (macro: the current session against the previous close). Yesterday, Last week, Last month: the last closed UTC day, week (Monday to Sunday, ISO week number) and month, open to close; the same for everyone all day. Macro and commodities there: the last finished session (over a weekend Friday) and the sessions of last week and last month. “vs BTC”: the crypto tiles show the change against BTC (1+asset change)/(1+BTC change)−1, so BTC is 0 and the others are how much better or worse than BTC they did; tokenized stocks and macro stay in dollars. Click a tile to open the asset.", "hmVol": "24h volume", "hmVsBtc": "vs BTC", "hmVsTitle": "Crypto against BTC: how much better or worse than BTC", "brTitle": "Market breadth", "brOf": "{n} crypto assets", "br24": "Up in 24 h", "brDay": "Above daily open", "brWeek": "Above weekly open", "brMonth": "Above monthly open", "brE20": "Above EMA20 (1D)", "brE50": "Above EMA50 (1D)", "brE200": "Above EMA200 (1D)", "brAth": "Within 25% of ATH", "brNote": "How many of the crypto assets followed here (PAXG left out) stand above each reference at the live price: up over 24 hours; above the open of the current day, week and month (UTC); above the 20-, 50- and 200-day EMA of the last closed daily candle; no more than 25% below their all-time high. It shows whether a move is broad or carried by a few assets; it describes, it does not forecast.", "fCrypto": "Crypto", "fStocks": "Tokenized stocks", "wkMacro": "Macro and commodities", "wkDxy": "DXY", "wkUs10y": "US 10Y", "wkSpx": "S&P 500", "wkNdx": "Nasdaq 100", "wkGold": "Gold", "wkSilver": "Silver", "more": "Market map page →"}, "tr": {"hmTitle": "Piyasa haritası", "hmLive": "Canlı", "hmDay": "Dün", "hmWeek": "Geçen hafta", "hmMonth": "Geçen ay", "hmLiveRange": "Son 24 saat · canlı", "hmDayRange": "Dün · {d} (UTC günü, açılıştan kapanışa)", "hmWeekRange": "{n}. hafta · {d}", "hmMonthRange": "{d}", "hmNote": "Her kutunun büyüklüğü varlığın 24 saatlik hacmine göredir (karekökü alınır, küçükler de okunsun diye); makro kutuları eşit boydadır. Canlı: son 24 saatteki değişim, canlı güncellenir (makroda süren seansın bir önceki kapanışa göre değişimi). Dün, Geçen hafta, Geçen ay: kapanmış son UTC günü, haftası (Pazartesi–Pazar, ISO hafta numarasıyla) ve ayı; açılıştan kapanışa. Gün boyunca herkes için aynıdır. Makro ve emtiada: biten son seans (hafta sonu Cuma) ile geçen haftanın ve geçen ayın seansları. “BTC'ye göre”: kripto kutuları değişimi BTC'ye karşı gösterir, (1+varlık)/(1+BTC)−1; BTC 0 olur, diğerleri BTC'den ne kadar iyi ya da kötü gittiğini gösterir; tokenize hisseler ve makro dolar cinsinden kalır. Kutuya tıklayınca varlık açılır.", "hmVol": "24s hacim", "hmVsBtc": "BTC'ye göre", "hmVsTitle": "Kriptolar BTC'ye karşı: BTC'den ne kadar iyi ya da kötü", "brTitle": "Piyasa genişliği", "brOf": "{n} kripto", "br24": "24 saatte artıda", "brDay": "Günlük açılış üstünde", "brWeek": "Haftalık açılış üstünde", "brMonth": "Aylık açılış üstünde", "brE20": "EMA20 (1D) üstünde", "brE50": "EMA50 (1D) üstünde", "brE200": "EMA200 (1D) üstünde", "brAth": "ATH'ye %25'ten yakın", "brNote": "Burada izlenen kripto varlıkların (PAXG hariç) kaçının, canlı fiyatla her referansın üstünde olduğu: son 24 saatte artıda olanlar; bugünün, bu haftanın ve bu ayın (UTC) açılışının üstündekiler; son kapanmış günlük mumun 20, 50 ve 200 günlük EMA'sının üstündekiler; tüm zamanların zirvesinin (ATH) en fazla %25 altında olanlar. Bir hareketin geniş tabana mı yayıldığını, yoksa birkaç varlıkla mı sınırlı kaldığını gösterir; durumu anlatır, tahmin değildir.", "fCrypto": "Kripto", "fStocks": "Tokenize hisseler", "wkMacro": "Makro ve emtia", "wkDxy": "DXY", "wkUs10y": "ABD 10Y", "wkSpx": "S&P 500", "wkNdx": "Nasdaq 100", "wkGold": "Altın", "wkSilver": "Gümüş", "more": "Piyasa haritası sayfası →"}};
  var CSS = ".hm-card:not([hidden]){display:flex;flex-direction:column;min-width:0}\n.hm-head{display:flex;flex-wrap:wrap;align-items:flex-start;justify-content:space-between;gap:8px 16px;margin-bottom:10px}\n.hm-card .hm-head .wk-range{margin:4px 0 0}\n\n.hm-board{display:grid;grid-template-columns:minmax(0,1.55fr) minmax(0,1fr);grid-template-rows:minmax(0,1.5fr) minmax(0,1fr);gap:10px;height:300px}\n.hm-board.no-stock{grid-template-rows:minmax(0,1fr)}\n.hm-group{display:flex;flex-direction:column;min-width:0;min-height:0}.hm-group[hidden]{display:none}\n.hm-group[data-g=crypto]{grid-row:1/3}.hm-board.no-stock .hm-group[data-g=crypto]{grid-row:auto}\n.hm-gt{margin:0 0 4px;color:var(--muted);font-size:10.5px;font-weight:700;letter-spacing:.05em;text-transform:uppercase}\n.hm-tiles{position:relative;flex:1;min-height:0;overflow:hidden;border-radius:8px}\n.hm-tiles>*{position:absolute;box-sizing:border-box;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1px;overflow:hidden;border:1px solid var(--bg,#0f141a);border-radius:5px;background:var(--raise);color:var(--fg);text-decoration:none;line-height:1.1;text-align:center;transition:background-color .4s ease}\n.hm-tiles>a:hover{outline:2px solid var(--accent);outline-offset:-2px;z-index:1}\n.hm-tiles b{font-weight:700;white-space:nowrap}.hm-tiles span{font-weight:600;font-variant-numeric:tabular-nums;white-space:nowrap}\n.hm-head>.hm-view{margin-left:auto}.hm-head>.hm-vs{align-self:center}.hm-vs{min-height:30px;padding:0 12px;border:1px solid var(--line);border-radius:10px;background:var(--panel);color:var(--muted);font-size:12px;font-weight:600;cursor:pointer}\n.hm-vs:hover{color:var(--fg)}.hm-vs[aria-pressed=true]{border-color:var(--accent);color:var(--accent)}.hm-head{align-items:center}\n/* Market breadth: how many of the followed crypto assets stand above each reference (README \"Market breadth\"). */\n.br{margin-top:12px}.br[hidden]{display:none}.br .hm-gt{display:flex;align-items:center;gap:5px;margin-bottom:6px}\n.br-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:6px 14px}\n@media(max-width:520px){.br-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}\n.br-item{display:grid;grid-template-columns:minmax(0,1fr) auto;column-gap:8px;align-items:end;min-width:0;font-size:11.5px;line-height:1.25;color:var(--muted)}.br-item b{color:var(--fg);font-weight:700;font-variant-numeric:tabular-nums}\n.br-bar{grid-column:1/-1;height:5px;margin-top:4px;border-radius:3px;background:var(--raise);overflow:hidden}.br-bar i{display:block;height:100%;border-radius:3px}\n.hm-foot{display:flex;flex-wrap:wrap;align-items:baseline;justify-content:space-between;gap:4px 16px;margin-top:8px}\n.hm-foot .wk-src{margin:0}.hm-card .wk-go{margin-top:0}\n@media(max-width:700px){.hm-board,.hm-board.no-stock{display:flex;flex-direction:column;height:auto}.hm-group[data-g=crypto] .hm-tiles{height:250px;flex:none}.hm-group[data-g=stock] .hm-tiles{height:160px;flex:none}.hm-group[data-g=macro] .hm-tiles{height:96px;flex:none}}\n.hm-card{padding:16px 18px;border:1px solid var(--line);border-radius:14px;background:var(--panel)}.hm-card[hidden]{display:none}\n.hm-card .wk-eyebrow{margin:0;color:var(--accent);font-size:11px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase}\n.hm-card .wk-range{margin:4px 0 0;color:var(--muted);font-size:13px}\n.hm-card .wk-go{display:inline-block;color:var(--accent);font-size:14px;font-weight:600;text-decoration:none}\n.hm-view{display:flex;max-width:100%;overflow-x:auto;scrollbar-width:none;padding:3px;border:1px solid var(--line);border-radius:10px;background:var(--panel)}.hm-view::-webkit-scrollbar{display:none}\n.hm-view .hm-tab{flex:none;white-space:nowrap;min-height:28px;padding:0 12px;border:0;border-radius:8px;background:transparent;color:var(--muted);font:600 12px Inter,system-ui,sans-serif;cursor:pointer}\n.hm-view .hm-tab:hover{color:var(--fg)}.hm-view .hm-tab.active{background:var(--raise);color:var(--fg)}\n@media(max-width:400px){.hm-view .hm-tab{padding:0 8px}}\n.hm-card.hm-big .hm-board{height:420px}@media(max-width:700px){.hm-card.hm-big .hm-board{height:auto}}";
  var TEMPLATE = "<div class=\"hm-head\"><div><p class=\"wk-eyebrow\" id=\"hm-title\"><span data-hm=\"hmTitle\"></span></p><p class=\"wk-range\" id=\"hm-range\"></p></div><div class=\"hm-view\" role=\"group\" aria-label=\"View\" id=\"hm-view\"><button class=\"hm-tab\" type=\"button\" data-view=\"live\" data-hm=\"hmLive\"></button><button class=\"hm-tab\" type=\"button\" data-view=\"day\" data-hm=\"hmDay\"></button><button class=\"hm-tab\" type=\"button\" data-view=\"week\" data-hm=\"hmWeek\"></button><button class=\"hm-tab\" type=\"button\" data-view=\"month\" data-hm=\"hmMonth\"></button></div><button class=\"hm-vs\" type=\"button\" id=\"hm-vs\" aria-pressed=\"false\" data-hm=\"hmVsBtc\"></button></div><p data-hm=\"hmNote\" data-tip=\"#hm-title\"></p><div class=\"hm-board\" id=\"hm-board\"><div class=\"hm-group\" data-g=\"crypto\"><p class=\"hm-gt\" data-hm=\"fCrypto\"></p><div class=\"hm-tiles\"></div></div><div class=\"hm-group\" data-g=\"stock\" hidden><p class=\"hm-gt\" data-hm=\"fStocks\"></p><div class=\"hm-tiles\"></div></div><div class=\"hm-group\" data-g=\"macro\" hidden><p class=\"hm-gt\" data-hm=\"wkMacro\"></p><div class=\"hm-tiles\"></div></div></div><div class=\"br\" id=\"br\" hidden><p class=\"hm-gt\" id=\"br-title\"><span data-hm=\"brTitle\"></span> \u00b7 <span id=\"br-n\"></span></p><p data-hm=\"brNote\" data-tip=\"#br-title\"></p><div class=\"br-grid\" id=\"br-grid\"></div></div>";
  function W() { return WORDS[document.documentElement.lang === "tr" ? "tr" : "en"]; }
  function texts(root) { var w = W(); root.querySelectorAll("[data-hm]").forEach(function (el) { el.textContent = w[el.getAttribute("data-hm")] || ""; }); var m = root.querySelector(".hm-more"); if (m) m.textContent = w.more; }
  function mount(card) {
    if (card.__hm) return; card.__hm = true;
    var more = card.getAttribute("data-more-href");
    card.innerHTML = TEMPLATE + (more ? '<div class="hm-foot"><a class="wk-go hm-more" href="' + more + '"></a></div>' : "");
    texts(card);
    new MutationObserver(function () { texts(document); }).observe(document.documentElement, { attributes: true, attributeFilter: ["lang"] });
    if (window.InfoTip) InfoTip.scan(card);

  var board=card.querySelector("#hm-board"),KEY="mlm-heatmap-view",DAY=86400000;
  var VIEWS=["live","day","week","month"],view="day";try{var sv=localStorage.getItem(KEY);if(VIEWS.indexOf(sv)>-1)view=sv}catch(e){}
  var macro=null,closed={assets:{},macro:null,periods:null},sizes={},sizedAt=0,timer=null;
  var MACRO=[["dxy","wkDxy"],["us10y","wkUs10y"],["spx","wkSpx"],["ndx","wkNdx"],["gold","wkGold"],["silver","wkSilver"]];
  function txt(v){if(v==null||!isFinite(v))return"–";var n=Math.abs(v).toLocaleString(MarketUI.locale(),{minimumFractionDigits:1,maximumFractionDigits:1}),s=v>0?"+":v<0?"−":"";return MarketUI.lang()==="tr"?s+"%"+n:s+n+"%"}
  function bpTxt(v){return v==null?"–":(v>0?"+":v<0?"−":"")+Math.abs(v).toLocaleString(MarketUI.locale(),{maximumFractionDigits:1})+" bp"}
  function fill(v,full){if(v==null||!isFinite(v))return"var(--raise)";var a=(0.22+0.6*Math.min(Math.abs(v)/full,1)).toFixed(2);return v>=0?"rgba(60,207,145,"+a+")":"rgba(239,107,115,"+a+")"}
  // Until the table's feeds answer (a second or two after the page opens), the map is drawn from the figures it
  // showed last in this browser (mlm-heatmap-last, at most an hour old, same UTC day), then follows the live ones.
  var LAST="mlm-heatmap-last",saved=null,savedAt=0;
  var TODAY=new Date().toISOString().slice(0,10);
  try{var sv0=JSON.parse(localStorage.getItem(LAST)||"null");if(sv0&&sv0.at>Date.now()-3600000&&new Date(sv0.at).toISOString().slice(0,10)===TODAY&&Array.isArray(sv0.order))saved=sv0}catch(e){}
  // The closed periods' figures are the same all day: kept for the day (mlm-heatmap-closed).
  var CLOSED="mlm-heatmap-closed";try{var c0=JSON.parse(localStorage.getItem(CLOSED)||"null");if(c0&&c0.v===2&&c0.periods&&c0.periods.day.to===TODAY)closed=c0}catch(e){}
  function live(){return!!(window.MLMQuotes&&MLMQuotes.order.length&&MLMQuotes.order.some(function(s){return MLMQuotes.get(s)}))}
  var Q={get order(){return live()?MLMQuotes.order:saved?saved.order:[]},get:function(s){var q=live()?MLMQuotes.get(s):null;return q||(saved&&saved.q[s])||null}};
  function remember(){if(!live()||Date.now()-savedAt<10000)return;savedAt=Date.now();var q={};MLMQuotes.order.forEach(function(s){var x=MLMQuotes.get(s);if(x)q[s]=x});
    try{localStorage.setItem(LAST,JSON.stringify({at:Date.now(),order:MLMQuotes.order,q:q,macro:macro}))}catch(e){}}
  if(saved&&saved.macro)macro=saved.macro;
  function order(){return Q.order.length?Q.order:Object.keys(closed.assets).sort(MarketUI.byPopularity)}
  function assets(){return order().filter(function(s){return s!=="PAXGUSDT"})}
  function rawChange(sym){if(view==="live"){var q=Q.get(sym);return q&&q.live?(q.price/q.live-1)*100:null}var a=closed.assets[sym];return a&&a[view]!=null?a[view]:null}
  // "vs BTC" (crypto only): (1 + the asset's change) / (1 + BTC's change) − 1.
  var vsBtc=false;try{vsBtc=localStorage.getItem("mlm-heatmap-vsbtc")==="1"}catch(e){}
  function change(sym){var v=rawChange(sym);if(!vsBtc||v==null||MarketUI.isTokenized(sym))return v;var b=rawChange("BTCUSDT");return b==null?null:((1+v/100)/(1+b/100)-1)*100}
  // Full colour at: assets 5 % (live, day), 10 % (week), 20 % (month); macro a fifth of that; the yield 10 / 10 / 25 / 50 bp.
  var FULL={live:5,day:5,week:10,month:20},BP={live:10,day:10,week:25,month:50};
  function resize(){var now=Date.now(),list=assets(),have=list.filter(function(s){var q=Q.get(s);return q&&q.volume>0});
    // Measured again once a minute, or at once when a volume arrives that had none yet.
    if(now-sizedAt<60000&&have.every(function(s){return sizes[s]}))return;sizedAt=now;
    have.forEach(function(s){sizes[s]=Math.sqrt(Q.get(s).volume)})}
  // Tiles of one group: label and value sized to the tile, the full figures in its title.
  function tiles(box,items){
    var W=box.clientWidth,H=box.clientHeight;if(!W||!H)return;
    var known=items.map(function(it){return it.weight}).filter(function(v){return v>0}).sort(function(a,b){return a-b});
    // Smallest tile: a third of the median, and never smaller than about 46×34 px so its name and change still fit
    // (the coins with the least volume would otherwise get a tile too small to label).
    var floor=known.length?known[Math.floor(known.length/2)]*0.35:1,MIN_AREA=1600;
    for(var pass=0;pass<3;pass++){var sum=items.reduce(function(a,it){return a+Math.max(it.weight||0,floor)},0);floor=Math.max(floor,sum*MIN_AREA/(W*H))}
    var rects=Treemap.layout(items.map(function(it){return Math.max(it.weight||0,floor)}),W,H);
    if(box.children.length!==items.length||box.dataset.keys!==items.map(function(it){return it.key}).join()){
      box.innerHTML=items.map(function(it){return it.href?'<a href="'+it.href+'"><b></b><span></span></a>':"<div><b></b><span></span></div>"}).join("");box.dataset.keys=items.map(function(it){return it.key}).join()}
    items.forEach(function(it,i){var el=box.children[i],r=rects[i];
      el.style.left=r.x+"px";el.style.top=r.y+"px";el.style.width=r.w+"px";el.style.height=r.h+"px";el.style.background=it.bg;el.title=it.title;
      var fs=Math.max(9,Math.min(22,Math.sqrt(r.w*r.h)/5.5)),lw=function(f){return f*0.62*it.label.length+6};
      while(fs>9&&lw(fs)>r.w)fs-=1;
      // A two-word label (Nasdaq 100) may take two lines when one is too wide.
      var words2=it.label.split(" "),longest=Math.max.apply(null,words2.map(function(x){return x.length})),wrap=false;
      if(lw(fs)>r.w&&words2.length>1){fs=Math.max(9,Math.min(22,Math.sqrt(r.w*r.h)/5.5));while(fs>9&&fs*0.62*longest+6>r.w)fs-=1;wrap=fs*0.62*longest+6<=r.w}
      var lines=wrap?2:1,b=el.firstChild,sp=el.lastChild,fitsL=(wrap||lw(fs)<=r.w)&&r.h>=fs*1.15*lines+4,fitsV=fitsL&&r.h>=fs*(1.15*lines+1.15)+4&&fs*0.62*it.value.length*0.8+6<=r.w;
      // A tall, narrow tile whose name does not fit across: the text runs upwards instead.
      var vert=false;
      if(!fitsL&&r.h>r.w*1.5){var vf=Math.max(9,Math.min(16,r.w*0.55));if(vf*0.62*it.label.length+6<=r.h&&vf+4<=r.w){vert=true;fs=vf;fitsL=true;wrap=false;
        fitsV=r.w>=vf*2.3&&vf*0.62*(it.label.length+it.value.length)*0.9+12<=r.h}}
      el.style.writingMode=vert?"vertical-rl":"";el.style.transform="";b.style.transform=sp.style.transform=vert?"rotate(180deg)":"";
      b.style.whiteSpace=wrap?"normal":"";
      b.textContent=fitsL?it.label:"";sp.textContent=fitsV?it.value:"";b.style.fontSize=fs+"px";sp.style.fontSize=Math.max(9,fs*0.8)+"px"});
  }
  function group(g,items){var el=board.querySelector('[data-g="'+g+'"]');el.hidden=!items.length;if(items.length)tiles(el.querySelector(".hm-tiles"),items)}
  function range(){var w=W(),loc=MarketUI.locale(),P=closed.periods,o={timeZone:"UTC",day:"numeric",month:"short"},d=function(x){return new Date(x+"T00:00:00Z")};
    if(view==="live")return w.hmLiveRange;if(!P)return"";
    if(view==="day")return w.hmDayRange.replace("{d}",d(P.day.from).toLocaleDateString(loc,o));
    if(view==="week"){var a=d(P.week.from),b=new Date(d(P.week.to).getTime()-DAY);return w.hmWeekRange.replace("{n}",P.week.isoWeek).replace("{d}",a.toLocaleDateString(loc,o)+" – "+b.toLocaleDateString(loc,o))}
    return w.hmMonthRange.replace("{d}",d(P.month.from).toLocaleDateString(loc,{timeZone:"UTC",month:"long",year:"numeric"}))}
  function render(){
    if(!order().length)return;card.hidden=false;resize();remember();
    var w=W(),list=assets(),full=FULL[view];
    function item(s){var v=change(s),q=Q.get(s),base=MarketUI.baseOf(s)||s;
      return{key:s,label:base,value:txt(v),bg:fill(v,full),weight:sizes[s]||0,href:"bulletin.html?asset="+encodeURIComponent(s)+"&tf="+(MarketUI.isTokenized(s)?"4h":"1d"),
        title:MarketUI.nameOf(s)+" ("+base+") · "+txt(v)+(q&&q.volume?" · "+w.hmVol+" "+MarketUI.compact(q.volume)+" $":"")}}
    var stocks=list.filter(MarketUI.isTokenized);
    group("crypto",list.filter(function(s){return!MarketUI.isTokenized(s)}).map(item));group("stock",stocks.map(item));
    board.classList.toggle("no-stock",!stocks.length);
    // Macro: Live = the current session against the previous close; the others = the closed periods.
    var m=view==="live"?macro:closed.macro,has=m&&MACRO.some(function(k){return m[k[0]]}),mv=view==="live"?"day":view;
    group("macro",has?MACRO.map(function(k){var x=m[k[0]],bp=k[0]==="us10y",v=x&&x[mv]!=null?x[mv]:null,t=bp?bpTxt(v):txt(v);
      var when=view==="day"&&x&&x.dayDate?" · "+new Date(x.dayDate+"T00:00:00Z").toLocaleDateString(MarketUI.locale(),{timeZone:"UTC",weekday:"long",day:"numeric",month:"short"}):"";
      return{key:k[0],label:w[k[1]],value:t,bg:fill(v,bp?BP[view]:FULL[view]/5),weight:1,title:w[k[1]]+" · "+t+when}}):[]);
    document.getElementById("hm-range").textContent=range()+(vsBtc?" · "+w.hmVsBtc:"");
    document.querySelectorAll("#hm-view [data-view]").forEach(function(b){b.classList.toggle("active",b.dataset.view===view);b.setAttribute("aria-pressed",String(b.dataset.view===view))});
    var vs=document.getElementById("hm-vs");vs.setAttribute("aria-pressed",String(vsBtc));vs.title=w.hmVsTitle;
    breadth(w);
  }
  // Market breadth (README "Market breadth"): the followed crypto assets above each reference, at the live price.
  function breadth(w){
    var box=document.getElementById("br"),list=assets().filter(function(s){return!MarketUI.isTokenized(s)}),rows=[];
    function count(test){var n=0,of=0;list.forEach(function(s){var r=test(s);if(r==null)return;of++;if(r)n++});return{n:n,of:of}}
    function px(s){var q=Q.get(s);return q&&q.price>0?q:null}
    function emaAt(i){return function(s){var q=px(s),a=closed.assets[s],e=a&&a.ema&&a.ema[i];return q&&e?q.price>e:null}}
    function above(k){return function(s){var q=px(s);return q&&q[k]?q.price>q[k]:null}}
    rows.push([w.br24,count(above("live"))],[w.brDay,count(above("day"))],[w.brWeek,count(above("week"))],[w.brMonth,count(above("month"))],
      [w.brE20,count(emaAt(0))],[w.brE50,count(emaAt(1))],[w.brE200,count(emaAt(2))],[w.brAth,count(function(s){var q=px(s);return q&&q.ath?q.price>=q.ath*0.75:null})]);
    rows=rows.filter(function(r){return r[1].of>=Math.max(5,list.length*0.6)});
    box.hidden=!rows.length;if(!rows.length)return;
    document.getElementById("br-n").textContent=w.brOf.replace("{n}",list.length);
    document.getElementById("br-grid").innerHTML=rows.map(function(r){var f=r[1].n/r[1].of;
      return'<div class="br-item"><span>'+MarketUI.escape(r[0])+"</span><b>"+r[1].n+"/"+r[1].of+'</b><div class="br-bar"><i style="width:'+(f*100).toFixed(1)+"%;background:"+fill((f-0.5)*16,5).replace(/[\d.]+\)$/,"0.85)")+'"></i></div></div>'}).join("");
  }
  document.getElementById("hm-vs").addEventListener("click",function(){vsBtc=!vsBtc;try{localStorage.setItem("mlm-heatmap-vsbtc",vsBtc?"1":"0")}catch(e){}render()});
  function soon(){if(!timer)timer=setTimeout(function(){timer=null;render()},1000)}
  document.addEventListener("mlm-quotes",soon);
  document.getElementById("hm-view").addEventListener("click",function(e){var b=e.target.closest("[data-view]");if(!b||b.disabled)return;view=b.dataset.view;try{localStorage.setItem(KEY,view)}catch(_){}render()});
  if(window.ResizeObserver)new ResizeObserver(function(){if(!card.hidden)render()}).observe(board);else window.addEventListener("resize",render);
  new MutationObserver(render).observe(document.documentElement,{attributes:true,attributeFilter:["lang"]});
  function loadMacro(){fetch("/api/macro-change").then(function(r){return r.ok?r.json():null}).then(function(d){if(d&&d.macro){macro=d.macro;render()}}).catch(function(){})}
  loadMacro();setInterval(function(){if(!document.hidden)loadMacro()},300000);
  // The closed periods: four parts (the pairs in three, macro) so that no request needs too many outside sources.
  function loadClosed(){
    if(closed.v===2&&closed.periods&&closed.periods.day.to===new Date().toISOString().slice(0,10)&&closed.complete)return;
    var got={v:2,assets:{},macro:null,periods:null},n=0;
    ["0","1","2","macro"].forEach(function(part){fetch("/api/closed-changes?part="+part).then(function(r){return r.ok?r.json():null}).then(function(d){
      if(d){got.periods=d.periods||got.periods;if(d.assets)Object.keys(d.assets).forEach(function(k){got.assets[k]=d.assets[k]});if(d.macro)got.macro=d.macro}
    }).catch(function(){}).then(function(){if(++n<4||!got.periods)return;
      got.complete=Object.keys(got.assets).length>0&&!!got.macro;closed=got;try{localStorage.setItem(CLOSED,JSON.stringify(closed))}catch(e){}render()})});
  }
  loadClosed();setInterval(function(){if(!document.hidden)loadClosed()},600000);
  if(saved||closed.periods)render(); // at once, from the last figures

  }
  var style = document.createElement("style"); style.textContent = CSS; document.head.appendChild(style);
  function start() { var c = document.querySelector("[data-heatmap]"); if (c) mount(c); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
  window.HeatMap = { mount: mount };
})();
