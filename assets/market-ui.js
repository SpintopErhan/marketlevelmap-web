/* Formatting and publication helpers shared by the market table (index.html), the analysis page
   (bulletin.html) and the weekly events page. Numbers follow the page language (html[lang]). */
var MarketUI=(function(){
  var NAMES={BTC:"Bitcoin",ETH:"Ethereum",SOL:"Solana",XRP:"XRP",AVAX:"Avalanche",BNB:"BNB",DOGE:"Dogecoin",PAXG:"PAX Gold",ADA:"Cardano",LINK:"Chainlink",DOT:"Polkadot",LTC:"Litecoin",TRX:"TRON"};
  var TF_ORDER=["1m","3m","5m","15m","30m","1h","2h","4h","6h","8h","12h","1d","3d","1w","1M"];
  function lang(){return document.documentElement.lang==="tr"?"tr":"en"}
  function locale(){return lang()==="tr"?"tr-TR":"en-US"}
  // Decimals by price size, chosen once per asset by the caller so they do not flip on every tick.
  // Decimals by price size: >= $100 → 1, $1–100 → 2, below $1 → 3.
  // Decimals by price size: 100+ → 1, 1+ → 2, below 1 (e.g. DOGE 0,1834) → 4, below 0,01 → 6.
  function digitsFor(value){var n=Number(value);return n>=100?1:n>=1?2:n>=0.01?4:6}
  // Number formats are built once per locale and option set and reused: toLocaleString builds a new one on every
  // call, and these run for every price on every live tick.
  var formats={};
  function nf(kind,d){var loc=locale(),k=loc+"|"+kind+"|"+d;return formats[k]||(formats[k]=new Intl.NumberFormat(loc,kind==="compact"?{notation:"compact",maximumFractionDigits:2}:{minimumFractionDigits:d,maximumFractionDigits:d}))}
  function price(value,digits){var n=Number(value);if(!(n>0))return"—";var d=digits==null?digitsFor(n):digits;return nf("fixed",d).format(n)}
  // Ratio → "+1,23%" / "−4,01%" (same layout in both languages, like the design).
  function pct(ratio){if(!isFinite(ratio))return"—";var v=nf("fixed",2).format(Math.abs(ratio*100));return(ratio>0?"+":ratio<0?"−":"")+v+"%"}
  function signClass(ratio){return ratio>0?"up":ratio<0?"down":""}
  function compact(value){var n=Number(value);return n>0?nf("compact",0).format(n):"—"}
  // Tokenized US stocks (README "Tokenized stocks"): Coinbase's tokens on Base (NVDAc, AAPLc…) traded against USDC; candles
  // from on-chain swaps. A pair "<TICKER>CUSDC" is one; names for the known ones, the stock ticker otherwise.
  var STOCKS={NVDA:"NVIDIA",AAPL:"Apple",TSLA:"Tesla",MSFT:"Microsoft",AMZN:"Amazon",GOOGL:"Alphabet",META:"Meta",COIN:"Coinbase",MSTR:"Strategy",SPY:"SPDR S&P 500 ETF",QQQ:"Invesco QQQ"};
  function stockOf(symbol){var m=/^([A-Z]{1,6})CUSDC$/.exec(String(symbol));return m?m[1]:""}
  function isTokenized(symbol){return!!stockOf(symbol)}
  function category(symbol){return isTokenized(symbol)?"stock":"crypto"}
  // Ticker shown for a pair: BTC for BTCUSDT, NVDAc for NVDACUSDC (Coinbase's own spelling, so it is not taken for the stock).
  function baseOf(symbol){var st=stockOf(symbol);return st?st+"c":String(symbol).replace(/USDT$/,"")}
  function nameOf(symbol){var st=stockOf(symbol);if(st)return STOCKS[st]||st;var b=baseOf(symbol);return NAMES[b]||b}
  function dateTime(iso,withYear){var d=new Date(iso);if(isNaN(d))return"";return d.toLocaleString(locale(),{day:"numeric",month:"short",year:withYear===false?undefined:"numeric",hour:"2-digit",minute:"2-digit",hour12:false,timeZone:"UTC"})+" UTC"}
  function date(iso){var d=new Date(iso);if(isNaN(d))return"";return d.toLocaleDateString(locale(),{day:"numeric",month:"short",year:"numeric",timeZone:"UTC"})}
  function methodOf(entry){
    var key=(entry.graphicKey||"").toLowerCase(),extra=[entry.packageId,entry.sourceReleaseId].join(" ").toLowerCase();
    function match(text){if(/cz|critical/.test(text))return"cz";if(/(^|[^a-z])pa([^a-z]|$)|price[ _-]?action/.test(text))return"pa";return""}
    return match(key)||match(extra)||key.split(":")[0]||"other";
  }
  function assetOf(entry){return(entry.graphicKey||"").split(":")[1]||""}
  function timeframeOf(entry){return(entry.graphicKey||"").split(":")[2]||""}
  function tfRank(tf){var i=TF_ORDER.indexOf(tf);if(i<0)i=TF_ORDER.indexOf(String(tf).toLowerCase());return i<0?99:i}
  function byTimeframe(a,b){return tfRank(timeframeOf(a))-tfRank(timeframeOf(b))||String(a.graphicKey).localeCompare(String(b.graphicKey))}
  // Assets in the usual market order (BTC, ETH, SOL, XRP, …), unknown ones alphabetically after them.
  var POPULAR=["BTC","ETH","SOL","XRP","BNB","AVAX","DOGE","ADA","LINK","DOT","LTC","TRX"];
  // Crypto first (popular ones in that order, other coins alphabetically, PAXG last), then tokenized stocks alphabetically.
  function rankOf(s){if(isTokenized(s))return 200;var b=baseOf(s);if(b==="PAXG")return 150;var i=POPULAR.indexOf(b);return i<0?100:i}
  function byPopularity(a,b){return rankOf(a)-rankOf(b)||baseOf(a).localeCompare(baseOf(b))}
  function escape(text){return String(text).replace(/[&<>"']/g,function(c){return{"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]})}
  return{lang:lang,locale:locale,digitsFor:digitsFor,price:price,pct:pct,signClass:signClass,compact:compact,baseOf:baseOf,nameOf:nameOf,isTokenized:isTokenized,category:category,stockOf:stockOf,dateTime:dateTime,date:date,methodOf:methodOf,assetOf:assetOf,timeframeOf:timeframeOf,tfRank:tfRank,byTimeframe:byTimeframe,byPopularity:byPopularity,escape:escape};
})();
