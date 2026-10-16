/* Information and risk notice shared by every page.
   Shown once on the first visit (any page) and from the footer link. Follows the page language (html[lang]). */
(function(){
  var STORAGE_KEY="mlm-disclaimer-v2";
  var copy={
    en:{
      eyebrow:"Important notice",
      title:"Information and Risk Notice",
      body:[
        "Charts, analyses, bulletins and other content published on MarketLevelMap are provided for general information purposes only. They do not constitute investment advice, personalised investment recommendations or a recommendation to buy or sell any asset. The content has not been prepared with regard to your personal financial situation or risk preferences.",
        "The price strip on the homepage and the market summary on bulletin pages show current data from Binance, or from Coinbase where Binance is not available. Charts and analyses, however, are static publications that reflect the data and assessment times stated on them; they are not updated automatically as prices move. The zones, levels and scenarios shown carry no certainty about future price movements and no guarantee of returns.",
        "The data sources used may contain errors, omissions or delays. The accuracy, completeness and timeliness of the content are not guaranteed. Past price movements and analysis results are not an indication of future results.",
        "Crypto assets carry significant risks, including high price volatility and the loss of the entire amount invested. Do not make investment decisions based solely on the content of this site; verify information with independent sources and, where appropriate, seek professional advice from authorised institutions."
      ],
      accept:"I understand",
      link:"Information and Risk Notice"
    },
    tr:{
      eyebrow:"Önemli bilgilendirme",
      title:"Bilgilendirme ve Risk Bildirimi",
      body:[
        "MarketLevelMap’te yayımlanan grafikler, analizler, bültenler ve diğer içerikler genel bilgilendirme amacı taşır; yatırım danışmanlığı, kişiye özel yatırım tavsiyesi veya herhangi bir varlık için alım-satım önerisi niteliğinde değildir. İçerikler, kişisel mali durumunuz ve risk tercihleriniz dikkate alınarak hazırlanmamıştır.",
        "Ana sayfadaki fiyat şeridi ve bülten sayfalarındaki piyasa özeti, Binance’ten (Binance’e erişilemeyen bölgelerde Coinbase’ten) alınan güncel verileri gösterir. Grafikler ve analizler ise üzerlerinde belirtilen veri ve değerlendirme zamanlarını yansıtan statik yayınlardır; yeni fiyat hareketleriyle otomatik olarak güncellenmez. Gösterilen bölgeler, seviyeler ve senaryolar gelecekteki fiyat hareketlerine ilişkin kesinlik veya getiri garantisi taşımaz.",
        "Kullanılan veri kaynaklarında hata, eksiklik veya gecikme bulunabilir. İçeriklerin doğruluğu, eksiksizliği ve güncelliği garanti edilmez. Geçmiş fiyat hareketleri ve analiz sonuçları gelecekteki sonuçların göstergesi değildir.",
        "Kripto varlıklar yüksek fiyat oynaklığı ve yatırılan tutarın tamamının kaybedilmesi dâhil önemli riskler taşır. Yatırım kararlarınızı yalnızca bu sitedeki içeriklere dayanarak vermeyin; bilgileri bağımsız kaynaklardan doğrulayın ve gerektiğinde yetkili kuruluşlardan profesyonel danışmanlık alın."
      ],
      accept:"Anladım",
      link:"Bilgilendirme ve Risk Bildirimi"
    }
  };

  var style=document.createElement("style");
  style.textContent=
    "#disclaimer{width:min(640px,calc(100vw - 32px));max-width:none;max-height:min(88vh,760px);padding:0;border:1px solid var(--line);border-radius:16px;background:var(--panel);color:var(--fg);box-shadow:0 24px 60px rgba(0,0,0,.35);overflow:hidden}"+
    "#disclaimer[open]{display:flex;flex-direction:column}"+
    "#disclaimer::backdrop{background:rgba(4,8,11,.7);backdrop-filter:blur(3px)}"+
    "#disclaimer .disclaimer-head{padding:26px 30px 16px;border-bottom:1px solid var(--line)}"+
    "#disclaimer .disclaimer-eyebrow{display:flex;align-items:center;gap:10px;color:var(--accent);font-size:11px;font-weight:700;letter-spacing:1.6px;text-transform:uppercase}"+
    "#disclaimer .disclaimer-eyebrow:before{content:\"\";width:24px;height:1px;background:currentColor}"+
    "#disclaimer h2{margin:10px 0 0;font-size:24px;font-weight:500;letter-spacing:-.4px;line-height:1.25}"+
    "#disclaimer .disclaimer-body{padding:18px 30px;overflow-y:auto;overscroll-behavior:contain}"+
    "#disclaimer .disclaimer-body p{margin:0 0 14px;color:var(--muted);font-size:13px;line-height:1.75}"+
    "#disclaimer .disclaimer-body p:last-child{margin-bottom:0}"+
    "#disclaimer .disclaimer-actions{display:flex;justify-content:flex-end;padding:16px 30px 22px;border-top:1px solid var(--line)}"+
    "#disclaimer .disclaimer-accept{border:0;background:var(--accent);color:var(--bg);font:inherit;font-size:13px;font-weight:700;border-radius:999px;padding:10px 20px;cursor:pointer}"+
    ".disclaimer-link{border:0;background:none;padding:0;color:inherit;font:inherit;text-decoration:underline;text-underline-offset:2px;cursor:pointer}"+
    ".disclaimer-link:hover{color:var(--fg)}"+
    "footer .footnote{max-width:560px}"+
    "@media(max-width:520px){#disclaimer .disclaimer-head{padding:22px 20px 14px}#disclaimer h2{font-size:20px}#disclaimer .disclaimer-body{padding:16px 20px}#disclaimer .disclaimer-actions{padding:14px 20px 18px}}";
  document.head.appendChild(style);

  var dialog=document.createElement("dialog");
  dialog.id="disclaimer";dialog.setAttribute("aria-labelledby","disclaimer-title");
  dialog.innerHTML='<form method="dialog"></form>';
  var form=dialog.firstChild;form.style.display="contents";
  form.innerHTML='<div class="disclaimer-head"><div class="disclaimer-eyebrow"></div><h2 id="disclaimer-title"></h2></div><div class="disclaimer-body"></div><div class="disclaimer-actions"><button class="disclaimer-accept" value="accept" autofocus></button></div>';
  document.body.appendChild(dialog);

  function render(){
    var t=copy[document.documentElement.lang]||copy.en;
    dialog.querySelector(".disclaimer-eyebrow").textContent=t.eyebrow;
    dialog.querySelector("h2").textContent=t.title;
    var body=dialog.querySelector(".disclaimer-body");body.textContent="";
    t.body.forEach(function(text){var p=document.createElement("p");p.textContent=text;body.appendChild(p)});
    dialog.querySelector(".disclaimer-accept").textContent=t.accept;
    document.querySelectorAll("[data-disclaimer]").forEach(function(el){el.textContent=t.link});
  }
  render();
  new MutationObserver(render).observe(document.documentElement,{attributes:true,attributeFilter:["lang"]});

  function open(){if(!dialog.open){dialog.showModal();dialog.querySelector(".disclaimer-body").scrollTop=0}}
  document.querySelectorAll("[data-disclaimer]").forEach(function(el){el.addEventListener("click",open)});
  dialog.addEventListener("close",function(){try{localStorage.setItem(STORAGE_KEY,"accepted")}catch(e){}});
  try{if(!localStorage.getItem(STORAGE_KEY))open()}catch(e){}
})();
