/* Market data kept in the visitor's browser (localStorage), shared by the homepage strip and bulletin pages.
   - Latest 24h figures per symbol, so a bulletin opened from the homepage shows its summary at once.
   - This week's / month's opening price per symbol (they do not change until the next week / month).
   - Whether Binance was unreachable from this browser recently, so pages go straight to Coinbase
     instead of waiting for Binance to fail again. */
var MarketCache=(function(){
  var KEY="mlm-market-v1",BLOCK_MS=30*60000,DAY=86400000,state=null,flushTimer=null;
  function load(){if(state)return state;try{state=JSON.parse(localStorage.getItem(KEY)||"{}")}catch(e){state={}}if(!state||typeof state!=="object")state={};state.tickers=state.tickers||{};state.opens=state.opens||{};return state}
  function flush(){flushTimer=null;try{localStorage.setItem(KEY,JSON.stringify(state))}catch(e){}}
  function save(){if(!flushTimer)flushTimer=setTimeout(flush,2000)}
  function weekStart(now){var d=new Date(now);return Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),d.getUTCDate())-((d.getUTCDay()+6)%7)*DAY}
  function monthStart(now){var d=new Date(now);return Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),1)}
  window.addEventListener("pagehide",function(){if(flushTimer){clearTimeout(flushTimer);flush()}});
  return {
    // t: {c: last, o: 24h open, h: 24h high, l: 24h low, q: 24h quote volume, quote, source}
    // Fields missing from an update keep their previous value, but only from the same source:
    // Binance (USDT) and Coinbase (USD) figures are never mixed in one entry.
    putTicker:function(symbol,t){var s=load(),prev=s.tickers[symbol]||{},next={at:Date.now()};if(prev.source!==t.source)prev={};["c","o","h","l","q","quote","source"].forEach(function(k){next[k]=t[k]!=null&&t[k]!==""?String(t[k]):prev[k]});s.tickers[symbol]=next;save()},
    getTicker:function(symbol,maxAge){var t=load().tickers[symbol];return t&&Date.now()-t.at<maxAge&&Number(t.c)>0&&Number(t.q)>0&&Number(t.h)>0&&Number(t.l)>0?t:null},
    putOpens:function(symbol,weekOpen,monthOpen,source){var s=load(),now=Date.now(),o=s.opens[symbol]||{};if(weekOpen){o.week=weekStart(now);o.weekOpen=String(weekOpen)}if(monthOpen){o.month=monthStart(now);o.monthOpen=String(monthOpen)}o.source=source;s.opens[symbol]=o;save()},
    getOpens:function(symbol,source){var o=load().opens[symbol],now=Date.now();if(!o||o.source!==source)return{};return{weekOpen:o.week===weekStart(now)?o.weekOpen:null,monthOpen:o.month===monthStart(now)?o.monthOpen:null}},
    binanceBlocked:function(){var b=load().binanceBlockedAt;return !!b&&Date.now()-b<BLOCK_MS},
    markBinance:function(reachable){var s=load();if(reachable)delete s.binanceBlockedAt;else s.binanceBlockedAt=Date.now();flush()}
  };
})();
