/* Live market feed shared by the market table (index.html) and the analysis page (bulletin.html).
   For each symbol it keeps {c: last, o: 24h open, h, l, q: 24h quote volume, quote, source,
   day/week/month: current daily, weekly and monthly candle opens} and calls onData(symbol, data).

   Order of sources:
   1. Last figures seen by this browser (MarketCache), so the page fills in at once.
   2. A snapshot from /api/prices (Cloudflare, edge-cached; in practice Coinbase, since Binance refuses
      requests from Cloudflare).
   3. Binance's public stream opened from the browser: miniTicker plus 1d / 1w / 1M klines.
   4. Coinbase's public ticker stream where Binance is blocked (e.g. the Netherlands, the US).
   5. Only if no stream works: /api/prices every 15 seconds.
   Live updates never pass through Cloudflare, so they cost no Functions quota.
   Requires assets/market-cache.js. */
var MarketFeed=(function(){
  var STREAMS=[{kind:"binance",url:"wss://data-stream.binance.vision/stream?streams="},{kind:"binance",url:"wss://stream.binance.com:9443/stream?streams="},{kind:"coinbase",url:"wss://ws-feed.exchange.coinbase.com"}];
  var POLL_MS=15000,COINBASE_PAINT_MS=1000,CACHE_MAX_AGE=15*60000,KLINES={"1d":"day","1w":"week","1M":"month"};

  function start(list,handlers){
    var symbols=(list||[]).filter(function(s){return /^[A-Z0-9]{2,20}$/.test(s)});
    var state={},source=null,streaming=null,socket=null,streamIndex=0,retryTimer=null,pollTimer=null,polling=false,retryDelay=2000;
    var coinbasePairs={},rejectedPairs={},pending={},paintTimer=null,cache=window.MarketCache||null;
    if(!symbols.length)return{get:function(){return null},source:function(){return null}};

    function setSource(s){if(s&&source!==s){source=s;if(handlers.onSource)handlers.onSource(s)}}
    // Merge an update into the symbol's state. A change of source starts the state over (with that
    // source's cached opens) so Binance USDT and Coinbase USD figures are never mixed.
    function merge(symbol,d,from,persist){
      if(symbols.indexOf(symbol)<0)return;
      var cur=state[symbol];
      if(!cur||cur.source!==from){var opens=cache?cache.getOpens(symbol,from):{};cur={source:from,day:opens.day,week:opens.week,month:opens.month}}
      ["c","o","h","l","q","quote","day","week","month"].forEach(function(k){if(d[k]!=null&&d[k]!==""&&!(Number(d[k])<=0))cur[k]=String(d[k])});
      state[symbol]=cur;
      if(persist&&cache){cache.putTicker(symbol,{c:cur.c,o:cur.o,h:cur.h,l:cur.l,q:cur.q,quote:cur.quote,source:from});if(d.day||d.week||d.month)cache.putOpens(symbol,{day:d.day,week:d.week,month:d.month},from)}
      if(handlers.onData)handlers.onData(symbol,cur);
    }

    function snapshot(){
      return fetch("/api/prices?symbols="+symbols.join(","),{cache:"no-store"}).then(function(r){return r.ok?r.json():null}).then(function(body){
        var prices=body&&body.prices||[];
        // Use the snapshot unless a stream from another source is already delivering.
        var usable=!streaming||streaming===body.source;
        if(prices.length&&usable)setSource(body.source);
        prices.forEach(function(d){if(d.pair)coinbasePairs[d.s]=d.pair;if(usable)merge(d.s,d,body.source,true)});
        return prices.length>0;
      }).catch(function(){return false});
    }
    function startPolling(){if(polling)return;polling=true;schedulePoll()}
    function schedulePoll(){clearTimeout(pollTimer);if(!document.hidden&&polling)pollTimer=setTimeout(function(){snapshot().then(schedulePoll)},POLL_MS)}

    // Coinbase sends a message per trade; apply at most once a second.
    function queue(d){pending[d.s]=d;if(!paintTimer)paintTimer=setTimeout(function(){paintTimer=null;var batch=pending;pending={};Object.keys(batch).forEach(function(k){merge(k,batch[k],"coinbase",true)})},COINBASE_PAINT_MS)}
    function coinbaseProducts(){var bySymbol={};symbols.forEach(function(sym){var id=coinbasePairs[sym]||sym.replace(/USDT$/,"")+"-USD";if(!rejectedPairs[id])bySymbol[sym]=id});return bySymbol}

    function connect(){
      if(document.hidden||socket||polling)return;
      var stream=STREAMS[streamIndex],ws,ready=false,symbolOf={};
      var url=stream.kind==="binance"?stream.url+symbols.map(function(s){var l=s.toLowerCase();return [l+"@miniTicker",l+"@kline_1d",l+"@kline_1w",l+"@kline_1M"].join("/")}).join("/"):stream.url;
      try{ws=socket=new WebSocket(url)}catch(e){socket=null;return streamFailed()}
      var giveUp=setTimeout(function(){if(!ready)try{ws.close()}catch(e){}},6000);
      function opened(){if(ready)return;ready=true;streaming=stream.kind;clearTimeout(giveUp);setSource(stream.kind);if(stream.kind==="binance"&&cache)cache.markBinance(true)}
      ws.onopen=function(){
        if(stream.kind!=="coinbase")return;
        var products=coinbaseProducts();Object.keys(products).forEach(function(sym){symbolOf[products[sym]]=sym});
        // One subscription per product: an unknown pair is rejected on its own without dropping the others.
        Object.keys(symbolOf).forEach(function(id){ws.send(JSON.stringify({type:"subscribe",product_ids:[id],channels:["ticker"]}))});
      };
      ws.onmessage=function(event){
        var m;try{m=JSON.parse(event.data)}catch(e){return}
        if(stream.kind==="binance"){
          var d=m&&m.data;if(!d||!d.s)return;opened();retryDelay=2000;
          if(d.e==="kline"&&d.k&&KLINES[d.k.i]){var o={};o[KLINES[d.k.i]]=d.k.o;merge(d.s,o,"binance",true)}
          else if(d.e==="24hrMiniTicker"||d.e==="24hrTicker")merge(d.s,{c:d.c,o:d.o,h:d.h,l:d.l,q:d.q,quote:"USDT"},"binance",true);
          return;
        }
        if(m.type==="subscriptions")opened();
        else if(m.type==="ticker"&&symbolOf[m.product_id]){opened();retryDelay=2000;queue({s:symbolOf[m.product_id],c:m.price,o:m.open_24h,h:m.high_24h,l:m.low_24h,q:Number(m.volume_24h)*Number(m.price),quote:m.product_id.split("-")[1]})}
        else if(m.type==="error"){var why=String(m.reason||"")+" "+String(m.message||"");Object.keys(symbolOf).forEach(function(id){if(why.indexOf(id)>-1)rejectedPairs[id]=true})}
      };
      ws.onerror=function(){try{ws.close()}catch(e){}};
      ws.onclose=function(){clearTimeout(giveUp);if(socket===ws){socket=null;streaming=null}if(document.hidden)return;if(ready){retryTimer=setTimeout(connect,retryDelay);retryDelay=Math.min(30000,retryDelay*2)}else streamFailed()};
    }
    function streamFailed(){
      streamIndex++;
      // Both Binance hosts failed from this browser: remember it so the next pages start on Coinbase.
      if(STREAMS[streamIndex-1].kind==="binance"&&(!STREAMS[streamIndex]||STREAMS[streamIndex].kind!=="binance")&&cache)cache.markBinance(false);
      if(streamIndex>=STREAMS.length){streamIndex=0;startPolling()}else connect();
    }
    // Started on Coinbase because Binance was unreachable recently: check Binance quietly (the visitor may
    // have changed network) and switch back to it if it answers.
    function probeBinance(host){
      var binance=STREAMS.filter(function(s){return s.kind==="binance"}),probe;
      if(host>=binance.length)return;
      try{probe=new WebSocket(binance[host].url+symbols[0].toLowerCase()+"@miniTicker")}catch(e){return probeBinance(host+1)}
      var done=false,giveUp=setTimeout(function(){if(!done)try{probe.close()}catch(e){}},6000);
      probe.onmessage=function(){
        if(done)return;done=true;clearTimeout(giveUp);try{probe.close()}catch(e){}
        if(cache)cache.markBinance(true);clearTimeout(retryTimer);clearTimeout(pollTimer);polling=false;
        if(socket){var old=socket;socket=null;old.onclose=null;try{old.close()}catch(e){}}
        streamIndex=STREAMS.indexOf(binance[host]);connect();
      };
      probe.onerror=function(){try{probe.close()}catch(e){}};
      probe.onclose=function(){clearTimeout(giveUp);if(!done){done=true;probeBinance(host+1)}};
    }
    document.addEventListener("visibilitychange",function(){
      clearTimeout(retryTimer);clearTimeout(pollTimer);
      if(document.hidden){if(socket){var ws=socket;socket=null;ws.onclose=null;ws.close()}return}
      snapshot();if(polling)schedulePoll();else connect();
    });

    if(cache){
      var cachedSource=null;
      symbols.forEach(function(symbol){var t=cache.getTicker(symbol,CACHE_MAX_AGE);if(t){cachedSource=cachedSource||t.source;merge(symbol,{c:t.c,o:t.o,h:t.h,l:t.l,q:t.q,quote:t.quote},t.source,false)}});
      if(cachedSource)setSource(cachedSource);
      if(cache.binanceBlocked()){streamIndex=STREAMS.map(function(s){return s.kind}).indexOf("coinbase");probeBinance(0)}
    }
    snapshot();connect();
    return{get:function(symbol){return state[symbol]||null},source:function(){return source}};
  }
  return{start:start};
})();
