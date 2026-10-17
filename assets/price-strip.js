/* Scrolling live price strip — NOT LOADED BY ANY PAGE (kept for later use; the market table replaced it).
   Markup it expects (place under the header):
     <div class="ticker" id="ticker" aria-label="Live prices" hidden><span class="ticker-live"><i></i><span data-tr="Canlı">Live</span></span>
     <div class="ticker-items" id="ticker-items"></div><span class="ticker-source" id="ticker-source" data-en="Source: Binance" data-tr="Kaynak: Binance">Source: Binance</span></div>
   plus assets/price-strip.css, assets/market-cache.js, and a call to startTicker(["BTCUSDT", ...]).
   It still carries its own copy of the stream logic; when it is shown again it should be rewired to
   assets/market-feed.js like the market table. */
/* Live price strip (homepage only).
   1. A snapshot from /api/prices (our Cloudflare function, edge-cached) paints prices straight away.
   2. The browser then opens a public price stream directly: Binance, or Coinbase where Binance is blocked
      (e.g. the Netherlands, the US). Live updates never go through Cloudflare, so they cost no quota.
   3. Only if no stream can be opened does the strip refresh from /api/prices, every 15 seconds.
   The row scrolls on its own in an endless loop; hovering, touching or scrolling it by hand pauses it. */
var startTicker=(function(){
  var STREAMS=[{kind:"binance",url:"wss://data-stream.binance.vision/stream?streams="},{kind:"binance",url:"wss://stream.binance.com:9443/stream?streams="},{kind:"coinbase",url:"wss://ws-feed.exchange.coinbase.com"}];
  var POLL_MS=15000,SPEED=28,RESUME_MS=3000,COINBASE_PAINT_MS=1000;
  var box=document.getElementById("ticker"),track=document.getElementById("ticker-items"),items={},symbols=[],socket=null,streamIndex=0,retryTimer=null,pollTimer=null,polling=false,coinbasePairs={};
  var reduceMotion=window.matchMedia("(prefers-reduced-motion: reduce)").matches,loopWidth=0,copies=1,holdUntil=0,hovering=false,lastFrame=0,offset=0;
  function locale(){return document.documentElement.lang==="tr"?"tr-TR":"en-US"}
  // Decimals are fixed per asset from its first price, so a price moving across 10 or 1 (e.g. AVAX near 10)
  // does not flip between "10.01" and "9.9900" on every tick.
  function formatPrice(value,item){var n=Number(value);if(item.digits==null)item.digits=n>=10?2:n>=1?4:6;return n.toLocaleString(locale(),{minimumFractionDigits:item.digits,maximumFractionDigits:item.digits})}
  function paint(item){
    var d=item.data;if(!d)return;
    var close=Number(d.c),open=Number(d.o),change=open?(close-open)/open*100:0,price=formatPrice(close,item),text=(change>=0?"+":"")+change.toLocaleString(locale(),{minimumFractionDigits:2,maximumFractionDigits:2})+"%";
    var appeared=false;
    item.nodes.forEach(function(n){n.price.textContent=price;n.change.textContent=text;n.change.className="ticker-change "+(change>=0?"up":"down");if(n.el.hidden){n.el.hidden=false;appeared=true}});
    box.hidden=false;
    // The loop width depends on which items are visible; re-measure once new items show up.
    if(appeared){clearTimeout(layout.t);layout.t=setTimeout(layout,60)}
  }
  // d: {s, c: last, o: 24h open, h, l, q: 24h quote volume, quote}. Every update is also kept in
  // MarketCache so bulletin pages and the next visit can show it straight away.
  function update(d,flash,source){
    var item=items[d.s];if(!item||!(Number(d.c)>0))return;
    if(source&&window.MarketCache)MarketCache.putTicker(d.s,{c:d.c,o:d.o,h:d.h,l:d.l,q:d.q,quote:d.quote,source:source});
    var previous=item.data&&Number(item.data.c);item.data={c:d.c,o:d.o};paint(item);
    if(flash&&previous&&previous!==Number(d.c)){var cls=Number(d.c)>previous?"tick-up":"tick-down";item.nodes.forEach(function(n){n.el.classList.remove("tick-up","tick-down");void n.el.offsetWidth;n.el.classList.add(cls);setTimeout(function(){n.el.classList.remove(cls)},120)})}
  }
  // The label names whichever source the prices currently come from.
  var sourceLabel=document.getElementById("ticker-source"),SOURCE_NAMES={binance:"Binance",coinbase:"Coinbase"};
  function setSource(source){var name=SOURCE_NAMES[source];if(!name)return;sourceLabel.dataset.en="Source: "+name;sourceLabel.dataset.tr="Kaynak: "+name;sourceLabel.textContent=document.documentElement.lang==="tr"?sourceLabel.dataset.tr:sourceLabel.dataset.en}
  function snapshot(){
    return fetch("/api/prices?symbols="+symbols.join(","),{cache:"no-store"}).then(function(r){return r.ok?r.json():null}).then(function(body){
      var prices=body&&body.prices||[];if(prices.length&&!socket)setSource(body.source);
      prices.forEach(function(d){if(d.pair)coinbasePairs[d.s]=d.pair;update(d,polling,body.source)});return prices.length>0;
    }).catch(function(){return false});
  }
  function startPolling(){if(polling)return;polling=true;schedulePoll()}
  function schedulePoll(){clearTimeout(pollTimer);if(!document.hidden)pollTimer=setTimeout(function(){snapshot().then(schedulePoll)},POLL_MS)}

  // Coinbase sends a message per trade; repaint at most once a second.
  var pending={},paintTimer=null;
  function queue(d){pending[d.s]=d;if(!paintTimer)paintTimer=setTimeout(function(){paintTimer=null;var batch=pending;pending={};Object.keys(batch).forEach(function(k){update(batch[k],true,"coinbase")})},COINBASE_PAINT_MS)}
  var rejectedPairs={},retryDelay=2000;
  function coinbaseProducts(){var bySymbol={};symbols.forEach(function(sym){var id=coinbasePairs[sym]||sym.replace(/USDT$/,"")+"-USD";if(!rejectedPairs[id])bySymbol[sym]=id});return bySymbol}

  function connect(){
    if(document.hidden||socket||polling||!symbols.length)return;
    var stream=STREAMS[streamIndex],ws,ready=false,products=null,symbolOf={};
    var url=stream.kind==="binance"?stream.url+symbols.map(function(s){return s.toLowerCase()+"@miniTicker"}).join("/"):stream.url;
    try{ws=socket=new WebSocket(url)}catch(e){socket=null;return streamFailed()}
    function opened(){if(ready)return;ready=true;clearTimeout(giveUp);setSource(stream.kind);if(stream.kind==="binance"&&window.MarketCache)MarketCache.markBinance(true)}
    var giveUp=setTimeout(function(){if(!ready)try{ws.close()}catch(e){}},6000);
    ws.onopen=function(){
      if(stream.kind!=="coinbase")return;
      products=coinbaseProducts();Object.keys(products).forEach(function(sym){symbolOf[products[sym]]=sym});
      // One subscription per product: an unknown pair is rejected on its own without dropping the others.
      Object.keys(symbolOf).forEach(function(id){ws.send(JSON.stringify({type:"subscribe",product_ids:[id],channels:["ticker"]}))});
    };
    ws.onmessage=function(event){
      var m;try{m=JSON.parse(event.data)}catch(e){return}
      if(stream.kind==="binance"){var d=m.data||m;if(d&&d.s){opened();retryDelay=2000;d.quote="USDT";update(d,true,"binance")}return}
      if(m.type==="subscriptions")opened();
      else if(m.type==="ticker"&&symbolOf[m.product_id]){opened();retryDelay=2000;queue({s:symbolOf[m.product_id],c:m.price,o:m.open_24h,h:m.high_24h,l:m.low_24h,q:Number(m.volume_24h)*Number(m.price),quote:m.product_id.split("-")[1]})}
      else if(m.type==="error"){var why=String(m.reason||"")+" "+String(m.message||"");Object.keys(symbolOf).forEach(function(id){if(why.indexOf(id)>-1)rejectedPairs[id]=true})}
    };
    ws.onerror=function(){try{ws.close()}catch(e){}};
    ws.onclose=function(){clearTimeout(giveUp);if(socket===ws)socket=null;if(document.hidden)return;if(ready){retryTimer=setTimeout(connect,retryDelay);retryDelay=Math.min(30000,retryDelay*2)}else streamFailed()};
  }
  // Binance was unreachable from this browser recently, so the strip started on Coinbase. Check Binance
  // quietly in the background (the visitor may have changed network) and switch back if it answers.
  function probeBinance(host){
    var binance=STREAMS.filter(function(s){return s.kind==="binance"}),probe;
    if(host>=binance.length)return;
    try{probe=new WebSocket(binance[host].url+symbols[0].toLowerCase()+"@miniTicker")}catch(e){return probeBinance(host+1)}
    var done=false,giveUp=setTimeout(function(){if(!done)try{probe.close()}catch(e){}},6000);
    probe.onmessage=function(){
      if(done)return;done=true;clearTimeout(giveUp);try{probe.close()}catch(e){}
      MarketCache.markBinance(true);clearTimeout(retryTimer);clearTimeout(pollTimer);polling=false;
      if(socket){var old=socket;socket=null;old.onclose=null;try{old.close()}catch(e){}}
      streamIndex=STREAMS.indexOf(binance[host]);connect();
    };
    probe.onerror=function(){try{probe.close()}catch(e){}};
    probe.onclose=function(){clearTimeout(giveUp);if(!done){done=true;probeBinance(host+1)}};
  }
  // Try the next stream; after the last one, fall back to /api/prices.
  function streamFailed(){
    streamIndex++;
    // Both Binance hosts failed from this browser: remember it so the next pages go straight to Coinbase.
    if(STREAMS[streamIndex-1].kind==="binance"&&(!STREAMS[streamIndex]||STREAMS[streamIndex].kind!=="binance")&&window.MarketCache)MarketCache.markBinance(false);
    if(streamIndex>=STREAMS.length){streamIndex=0;startPolling()}else connect();
  }
  document.addEventListener("visibilitychange",function(){
    clearTimeout(retryTimer);clearTimeout(pollTimer);
    if(document.hidden){if(socket){var ws=socket;socket=null;ws.onclose=null;ws.close()}return}
    if(!symbols.length)return;
    snapshot();if(polling)schedulePoll();else connect();
  });
  new MutationObserver(function(){Object.keys(items).forEach(function(k){paint(items[k])});layout()}).observe(document.documentElement,{attributes:true,attributeFilter:["lang"]});

  // Endless scroll: enough copies of the item row to fill the strip twice; wrap by one row width.
  function makeRow(copy){
    var row=document.createElement("div");row.className="ticker-row";if(copy)row.setAttribute("aria-hidden","true");
    symbols.forEach(function(symbol){
      var el=document.createElement("a");el.className="ticker-item";el.hidden=!items[symbol].data;el.href="bulletin.html?asset="+encodeURIComponent(symbol)+"&method=cz";if(copy)el.tabIndex=-1;
      el.innerHTML='<b></b><span class="ticker-price"></span><span class="ticker-change"></span>';el.firstChild.textContent=symbol.replace(/USDT$/,"");
      row.appendChild(el);items[symbol].nodes.push({el:el,price:el.querySelector(".ticker-price"),change:el.querySelector(".ticker-change")});
    });
    return row;
  }
  function layout(){
    if(box.hidden||!symbols.length)return;
    var first=track.firstChild;if(!first)return;
    while(track.children.length>1)track.removeChild(track.lastChild);
    Object.keys(items).forEach(function(k){items[k].nodes=items[k].nodes.slice(0,1)});
    loopWidth=first.getBoundingClientRect().width;
    if(reduceMotion||!loopWidth){track.classList.remove("is-looping");return}
    copies=Math.ceil(track.clientWidth/loopWidth)+1;
    for(var i=0;i<copies;i++)track.appendChild(makeRow(true));
    Object.keys(items).forEach(function(k){paint(items[k])});
    track.classList.add("is-looping");
  }
  function hold(){holdUntil=performance.now()+RESUME_MS}
  track.addEventListener("pointerenter",function(e){if(e.pointerType==="mouse")hovering=true});
  track.addEventListener("pointerleave",function(){hovering=false});
  ["wheel","touchstart","pointerdown","keydown"].forEach(function(type){track.addEventListener(type,hold,{passive:true})});
  track.addEventListener("scroll",function(){if(Math.abs(track.scrollLeft-offset)>1)hold();if(loopWidth&&track.classList.contains("is-looping")){if(track.scrollLeft>=loopWidth)track.scrollLeft-=loopWidth;else if(track.scrollLeft<=0&&holdUntil>performance.now())track.scrollLeft+=loopWidth}offset=track.scrollLeft},{passive:true});
  function frame(now){
    var dt=lastFrame?Math.min(64,now-lastFrame):0;lastFrame=now;
    if(!box.hidden&&loopWidth&&!reduceMotion&&!hovering&&now>holdUntil&&!document.hidden&&track.classList.contains("is-looping")){
      offset+=SPEED*dt/1000;if(offset>=loopWidth)offset-=loopWidth;track.scrollLeft=offset;
    }
    requestAnimationFrame(frame);
  }
  window.addEventListener("resize",function(){clearTimeout(layout.t);layout.t=setTimeout(layout,150)});

  return function(assets){
    symbols=assets.filter(function(a){return /^[A-Z0-9]{2,20}$/.test(a)});if(!symbols.length)return;
    items={};symbols.forEach(function(symbol){items[symbol]={nodes:[],data:null}});
    track.textContent="";track.appendChild(makeRow(false));
    // Paint the last known prices from this browser at once; live data replaces them within a second.
    if(window.MarketCache){var cachedSource=null;symbols.forEach(function(symbol){var t=MarketCache.getTicker(symbol,15*60000);if(t){cachedSource=cachedSource||t.source;update({s:symbol,c:t.c,o:t.o},false)}});if(cachedSource)setSource(cachedSource);
      if(MarketCache.binanceBlocked()){streamIndex=STREAMS.map(function(s){return s.kind}).indexOf("coinbase");probeBinance(0)}}
    snapshot();connect();requestAnimationFrame(frame);
  };
})();
