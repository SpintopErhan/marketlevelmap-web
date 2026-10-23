/* Installable app (PWA) support shared by every page:
   - registers the service worker (/sw.js);
   - shows an "offline – data may not be up to date" notice when the device is offline or the service worker
     had to answer a data request from its cache;
   - offers installation: a small "Install app" button where the browser supports it (Android/Chrome), or a
     "Share → Add to Home Screen" hint in Safari on iPhone/iPad. Not shown when already running as an app;
     once dismissed it stays away (localStorage).
   - keeps the browser bar colour (theme-color) in step with the site's light/dark theme.
   Texts follow the page language (html[lang]). */
(function(){
  var DISMISS_KEY="mlm-install-dismissed";
  var copy={
    en:{offline:"Offline – data may not be up to date",install:"Install app",close:"Close",ios:"To install: tap Share, then Add to Home Screen"},
    tr:{offline:"Çevrimdışı – veriler güncel olmayabilir",install:"Uygulama olarak ekle",close:"Kapat",ios:"Uygulama olarak eklemek için: Paylaş → Ana Ekrana Ekle"}
  };
  function t(){return copy[document.documentElement.lang]||copy.en}
  function standalone(){return (window.matchMedia&&matchMedia("(display-mode: standalone)").matches)||navigator.standalone===true}
  function dismissed(){try{return localStorage.getItem(DISMISS_KEY)==="1"}catch(e){return false}}
  function dismiss(){try{localStorage.setItem(DISMISS_KEY,"1")}catch(e){}}

  var style=document.createElement("style");
  style.textContent=
    ".pwa-bar{position:fixed;left:50%;transform:translateX(-50%);bottom:calc(14px + env(safe-area-inset-bottom));z-index:50;display:flex;align-items:center;gap:8px;max-width:calc(100vw - 24px);padding:8px 8px 8px 14px;border:1px solid var(--line);border-radius:999px;background:var(--panel);color:var(--fg);box-shadow:0 10px 30px rgba(0,0,0,.25);font-size:13px}"+
    ".pwa-bar[hidden]{display:none}"+
    ".pwa-bar button{font:inherit;cursor:pointer}"+
    ".pwa-install{border:1px solid var(--accent);border-radius:999px;background:none;color:var(--accent);padding:5px 12px;font-weight:600}"+
    ".pwa-close{width:28px;height:28px;border:0;border-radius:50%;background:none;color:var(--muted);font-size:18px;line-height:1}"+
    ".pwa-close:hover{color:var(--fg)}"+
    ".pwa-offline{position:fixed;left:0;right:0;top:0;z-index:60;padding:calc(6px + env(safe-area-inset-top)) 12px 6px;background:#b4542d;color:#fff;font-size:12px;font-weight:600;text-align:center}"+
    ".pwa-offline[hidden]{display:none}";
  document.head.appendChild(style);

  // ---- theme colour follows the site theme (also a manual light/dark switch)
  function syncThemeColor(){
    var bg=getComputedStyle(document.body).backgroundColor;
    document.querySelectorAll('meta[name="theme-color"]').forEach(function(m){m.setAttribute("content",bg)});
  }

  // ---- offline notice
  var offline=document.createElement("div");offline.className="pwa-offline";offline.setAttribute("role","status");offline.hidden=true;
  function showOffline(on){offline.textContent=t().offline;offline.hidden=!on}

  // ---- install offer
  var bar=document.createElement("div");bar.className="pwa-bar";bar.hidden=true;
  var deferred=null,mode=null;
  function renderBar(){
    var w=t();bar.textContent="";
    if(mode==="prompt"){var b=document.createElement("button");b.className="pwa-install";b.type="button";b.textContent=w.install;b.addEventListener("click",install);bar.appendChild(b)}
    else if(mode==="ios"){var s=document.createElement("span");s.textContent=w.ios;bar.appendChild(s)}
    var x=document.createElement("button");x.className="pwa-close";x.type="button";x.setAttribute("aria-label",w.close);x.textContent="×";
    x.addEventListener("click",function(){dismiss();bar.hidden=true});bar.appendChild(x);
  }
  function offer(kind){if(standalone()||dismissed())return;mode=kind;renderBar();bar.hidden=false}
  function install(){
    if(!deferred)return;bar.hidden=true;deferred.prompt();
    deferred.userChoice.then(function(choice){if(choice&&choice.outcome==="accepted")dismiss()}).catch(function(){});deferred=null;
  }
  window.addEventListener("beforeinstallprompt",function(e){e.preventDefault();deferred=e;offer("prompt")});
  window.addEventListener("appinstalled",function(){dismiss();bar.hidden=true});

  function start(){
    document.body.appendChild(offline);document.body.appendChild(bar);
    syncThemeColor();
    if(!navigator.onLine)showOffline(true);
    // Safari on iPhone/iPad has no install prompt; other iOS browsers (Chrome, Firefox …) cannot add apps.
    var ua=navigator.userAgent,ios=/iPhone|iPad|iPod/.test(ua)||(navigator.platform==="MacIntel"&&navigator.maxTouchPoints>1);
    if(ios&&/Safari/.test(ua)&&!/CriOS|FxiOS|EdgiOS|OPiOS/.test(ua))offer("ios");
    new MutationObserver(function(){if(!offline.hidden)showOffline(true);if(!bar.hidden)renderBar()}).observe(document.documentElement,{attributes:true,attributeFilter:["lang"]});
    new MutationObserver(syncThemeColor).observe(document.documentElement,{attributes:true,attributeFilter:["data-theme"]});
  }
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",start);else start();
  window.addEventListener("offline",function(){showOffline(true)});
  window.addEventListener("online",function(){showOffline(false)});

  if("serviceWorker" in navigator){
    window.addEventListener("load",function(){navigator.serviceWorker.register("/sw.js").catch(function(){})});
    navigator.serviceWorker.addEventListener("message",function(e){if(e.data&&e.data.type==="mlm-offline-data")showOffline(true)});
  }
})();
