/* Sample data for design previews ONLY.
   Used while the local engine does not yet publish report / archive / events JSON to R2, and only on
   preview hosts (*.pages.dev, localhost) or with ?demo=1 — never on marketlevelmap.com by default, so
   visitors are not shown made-up support/resistance figures. Every section filled from here shows a
   "Sample data" badge. Values are generated around the current price so the tables look realistic. */
var DemoData=(function(){
  var host=location.hostname,query=new URLSearchParams(location.search);
  var enabled=query.get("demo")==="1"||/\.pages\.dev$/.test(host)||host==="localhost"||host==="127.0.0.1";
  if(query.get("demo")==="0")enabled=false;
  var BASE={BTCUSDT:82500,ETHUSDT:3140,SOLUSDT:168,XRPUSDT:2.34,AVAXUSDT:24.9,BNBUSDT:612,DOGEUSDT:0.1834},DAY=86400000,anchors={};

  function step(price){return Math.pow(10,Math.floor(Math.log10(price))-2)}
  function round(value,price){var s=step(price);return Math.round(value/s)*s}
  // Fix the reference price per symbol the first time it is asked for, so figures stay put on updates.
  // Until a live price is known, use a typical price without fixing it.
  function anchor(symbol,price){if(!anchors[symbol]){if(!(Number(price)>0))return BASE[symbol]||100;anchors[symbol]=Number(price)}return anchors[symbol]}
  function daysAgo(n){return new Date(Date.now()-n*DAY).toISOString().slice(0,10)}

  // Long-range levels the engine will publish (the market table shows MO, YO and ATH).
  function levels(symbol,price){
    var p=anchor(symbol,price);
    return[{code:"ATH",price:round(p*1.328,p)},{code:"PWO",price:round(p*1.048,p)},{code:"MO",price:round(p*0.96,p)},{code:"YO",price:round(p*0.872,p)}];
  }

  // A report JSON in the shape the engine is expected to publish (README "Report JSON").
  function report(symbol,timeframe,price){
    var p=anchor(symbol,price),k={"1h":1,"4h":1.6,"1d":2.4}[timeframe]||1;
    function z(type,a,b,ago,drawn){return{type:type,low:round(p*(1+a*k/100),p),high:round(p*(1+b*k/100),p),formedAt:daysAgo(ago),drawn:drawn}}
    var zones=[z("resistance",4.4,5.3,25,true),z("resistance",7.6,8.2,48,false),z("resistance",1.2,1.9,10,true),z("support",-2.0,-1.2,19,true),z("support",-4.4,-3.9,33,false),z("support",-8.4,-6.7,31,true),z("support",-12.5,-12.0,58,true)];
    var near=zones[3],next=zones[5],res=zones[2];
    function fmt(v,locale){return v.toLocaleString(locale,{maximumFractionDigits:v>=100?0:v>=1?2:4})}
    return{
      symbol:symbol,timeframe:timeframe,method:"cz",analyzedAt:new Date(Date.now()-6*3600000).toISOString(),
      note:{
        tr:"Fiyat, "+fmt(near.low,"tr-TR")+"–"+fmt(near.high,"tr-TR")+" aralığındaki destek bölgesinin hemen üzerinde. Yukarıdaki ilk direnç "+fmt(res.low,"tr-TR")+"–"+fmt(res.high,"tr-TR")+" aralığında. Destek bölgesinin altında kapanış gelirse izlenecek sonraki alan "+fmt(next.low,"tr-TR")+"–"+fmt(next.high,"tr-TR")+".",
        en:"Price sits just above the support zone at "+fmt(near.low,"en-US")+"–"+fmt(near.high,"en-US")+". The first resistance above is "+fmt(res.low,"en-US")+"–"+fmt(res.high,"en-US")+". A close below support would bring the next area, "+fmt(next.low,"en-US")+"–"+fmt(next.high,"en-US")+", into focus."
      },
      zones:zones,levels:levels(symbol,price)
    };
  }

  function archive(symbol){
    // README "Archive JSON" list rows (no report: sample rows do not open).
    var items=[3,4,5].map(function(n,i){var d=new Date(Date.now()-n*DAY);d.setUTCHours(i?7:11,59,59,0);
      return{graphicKey:(i===1?"PA:":"CZ:")+symbol+":"+(i===2?"1d":"4h"),publicationId:"demo-"+n,analyzedAt:d.toISOString(),liveFrom:d.toISOString(),liveUntil:new Date(d.getTime()+DAY).toISOString()}});
    return{symbol:symbol,items:items};
  }

  // This week's (Monday-based, UTC) events, in the shape of README "Events JSON".
  function events(){
    var now=new Date(),monday=Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),now.getUTCDate())-((now.getUTCDay()+6)%7)*DAY;
    function at(day,h,m){return new Date(monday+day*DAY+(h*60+m)*60000).toISOString()}
    var list=[
      {id:"demo-cn-gdp",startAt:at(0,2,0),country:"CN",impact:"HIGH",title:{tr:"Çin GSYH (Ç3, yıllık)",en:"China GDP (Q3, y/y)"},actual:"4,8%",previous:"5,2%"},
      {id:"demo-us-housing",startAt:at(1,12,30),country:"US",impact:"MEDIUM",title:{tr:"ABD konut başlangıçları (Eylül)",en:"US housing starts (Sep)"}},
      {id:"demo-us-eia",startAt:at(2,14,30),country:"US",impact:"MEDIUM",title:{tr:"EIA ham petrol stokları",en:"EIA crude oil inventories"}},
      {id:"demo-tr-cbrt",startAt:at(3,11,0),country:"TR",impact:"HIGH",title:{tr:"TCMB faiz kararı",en:"CBRT interest-rate decision"}},
      {id:"demo-us-claims",startAt:at(3,12,30),country:"US",impact:"MEDIUM",title:{tr:"ABD haftalık işsizlik başvuruları",en:"US initial jobless claims"}},
      {id:"demo-us-pmi",startAt:at(4,13,45),country:"US",impact:"MEDIUM",title:{tr:"ABD S&P Global imalat PMI (öncü)",en:"US S&P Global manufacturing PMI (flash)"}}
    ];
    list.forEach(function(e){e.datePrecision="EXACT";e.category="MACRO";if(Date.parse(e.startAt)>Date.now()){e.actual=null}});
    return{updatedAt:new Date().toISOString(),events:list};
  }

  return{enabled:enabled,levels:levels,report:report,archive:archive,events:events};
})();
