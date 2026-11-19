/* Member alarms in the browser (README "Alarms"): web push on this device, the price and zone alarm windows of the
   analysis page and the alarm list of the account page. The alarm Worker checks the alarms every minute (OKX prices)
   and sends the notification; this file only sets them up. window.MLMAlarms:
     openPrice({ asset, price, digits })          — "BTC above / below a price"
     openZone({ asset, zone: { low, high, type }, tf, price, digits }) — "enters the zone" / "a candle closes beyond it"
     mountList(element)                           — the account page's list and this device's notification settings
     push.status() / push.enable() / push.test() */
(function () {
  "use strict";
  var W = {
    en: {
      priceTitle: "{base} price alarm", zoneTitle: "{base} zone alarm", above: "Rises to or above", below: "Falls to or below", level: "Price ($)",
      now: "Now: {p}", okx: "Checked every minute on OKX prices; the notification arrives within about a minute.",
      enter: "When the price enters the zone", breakSup: "When a {tf} candle closes below the zone", breakRes: "When a {tf} candle closes above the zone",
      zoneLine: "{type} zone {low} – {high}", support: "Support", resistance: "Resistance", insideNow: "The price is inside this zone now.",
      already: { above: "The price is already above this level.", below: "The price is already below this level." },
      create: "Set alarm", cancel: "Cancel", created: "Alarm set.", fail: "The alarm could not be set.", tooMany: "You have {max} active alarms, the most for now.",
      pushOff: "Notifications are off on this device.", pushOn: "Notifications are on for this device.", enable: "Turn on notifications",
      pushDenied: "Notifications are blocked for this site in the browser settings.", pushUnsupported: "This browser cannot receive notifications.",
      pushIos: "On iPhone: add the site to the Home Screen from Safari, open it from there and turn notifications on.",
      test: "Send a test notification", testSent: "Test notification sent.", testNone: "No device to send to yet.", pushNotReady: "Notifications are not set up on the site yet.",
      listTitle: "Alarms", listEmpty: "No alarms yet. Set them on an analysis page: the bell next to a zone, or \"Alarm\" above the chart.",
      active: "Active", fired: "Fired {when} · {p}", remove: "Delete", rearm: "Turn on again", openAnalysis: "Analysis →", membersOnly: "Alarms are for members.",
      kindPrice: { above: "{base} ≥ {p}", below: "{base} ≤ {p}" }, kindEnter: "{base} enters {type} zone {low} – {high}", kindBreak: "{base} {tf} closes {side} {type} zone {low} – {high}",
      sideBelow: "below", sideAbove: "above", count: "{n} / {max} active",
    },
    tr: {
      priceTitle: "{base} fiyat alarmı", zoneTitle: "{base} bölge alarmı", above: "Üstüne çıkınca", below: "Altına inince", level: "Fiyat ($)",
      now: "Şu an: {p}", okx: "OKX fiyatlarıyla her dakika kontrol edilir; bildirim en geç yaklaşık bir dakikada gelir.",
      enter: "Fiyat bölgeye girince", breakSup: "{tf} mumu bölgenin altında kapanınca", breakRes: "{tf} mumu bölgenin üstünde kapanınca",
      zoneLine: "{type} bölgesi {low} – {high}", support: "Destek", resistance: "Direnç", insideNow: "Fiyat şu an bu bölgenin içinde.",
      already: { above: "Fiyat zaten bu seviyenin üstünde.", below: "Fiyat zaten bu seviyenin altında." },
      create: "Alarm kur", cancel: "Vazgeç", created: "Alarm kuruldu.", fail: "Alarm kurulamadı.", tooMany: "Şimdilik en fazla {max} etkin alarm kurulabiliyor.",
      pushOff: "Bu cihazda bildirimler kapalı.", pushOn: "Bu cihazda bildirimler açık.", enable: "Bildirimleri aç",
      pushDenied: "Bu site için bildirimler tarayıcı ayarlarında engellenmiş.", pushUnsupported: "Bu tarayıcı bildirim alamıyor.",
      pushIos: "iPhone'da: siteyi Safari'den Ana Ekrana ekle, oradan aç ve bildirimleri aç.",
      test: "Test bildirimi gönder", testSent: "Test bildirimi gönderildi.", testNone: "Henüz bildirim gidecek bir cihaz yok.", pushNotReady: "Bildirimler sitede henüz kurulmadı.",
      listTitle: "Alarmlar", listEmpty: "Henüz alarm yok. Analiz sayfasında kurabilirsin: bir bölgenin yanındaki zil ya da grafiğin üstündeki \"Alarm\".",
      active: "Etkin", fired: "Tetiklendi {when} · {p}", remove: "Sil", rearm: "Yeniden kur", openAnalysis: "Analiz →", membersOnly: "Alarmlar üyelere özel.",
      kindPrice: { above: "{base} ≥ {p}", below: "{base} ≤ {p}" }, kindEnter: "{base} {type} bölgesine girince {low} – {high}", kindBreak: "{base} {tf} mumu {type} bölgesinin {side} kapanınca {low} – {high}",
      sideBelow: "altında", sideAbove: "üstünde", count: "{n} / {max} etkin",
    },
  };
  function lang() { return document.documentElement.lang === "tr" ? "tr" : "en"; }
  function w() { return W[lang()]; }
  function fill(t, o) { return String(t).replace(/\{(\w+)\}/g, function (_, k) { return o[k] == null ? "" : o[k]; }); }
  function base(a) { return String(a).replace(/USDT$/, ""); }
  function digitsFor(v) { return v >= 100 ? 1 : v >= 1 ? 2 : v >= 0.01 ? 4 : 6; }
  function money(v, d) { var n = Number(v); if (!(n > 0)) return "–"; var s = n.toLocaleString(lang() === "tr" ? "tr-TR" : "en-US", { minimumFractionDigits: d, maximumFractionDigits: d }); return lang() === "tr" ? s + " $" : "$" + s; }
  function num(v, d) { return Number(v).toLocaleString(lang() === "tr" ? "tr-TR" : "en-US", { minimumFractionDigits: d, maximumFractionDigits: d }); }
  function api(path, body) {
    return fetch("/api/auth/" + path, body ? { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : { credentials: "same-origin", cache: "no-store" })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { d._status = r.status; return d; }); });
  }
  var info = null, loading = null; // last GET alarms answer
  function load() { loading = api("alarms").then(function (d) { if (d._status === 200) info = d; return d; }); return loading; }
  // Alarms are offered once the site has its push keys (the alarm Worker is set up at the same time): until then
  // nothing would ever fire. ready() asks once per page.
  function available() { return !!(info && info.push && info.push.publicKey); }
  function ready() { return loading || load(); }

  // ---- web push on this device ----
  function b64ToBytes(s) { var b = s.replace(/-/g, "+").replace(/_/g, "/"), p = b.length % 4 ? "=".repeat(4 - b.length % 4) : "", bin = atob(b + p), out = new Uint8Array(bin.length); for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i); return out; }
  function isIos() { return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1); }
  function standalone() { return (window.matchMedia && matchMedia("(display-mode: standalone)").matches) || navigator.standalone === true; }
  var push = {
    // "on" | "off" | "denied" | "unsupported" | "ios-install"
    status: function () {
      if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) return Promise.resolve(isIos() && !standalone() ? "ios-install" : "unsupported");
      if (Notification.permission === "denied") return Promise.resolve("denied");
      return navigator.serviceWorker.getRegistration().then(function (reg) { return reg ? reg.pushManager.getSubscription() : null; })
        .then(function (sub) { return sub && Notification.permission === "granted" ? "on" : "off"; }).catch(function () { return "off"; });
    },
    // Must run from a click (iPhone asks for permission only then).
    enable: function () {
      return Promise.resolve(info || load()).then(function (d) {
        var key = d && d.push && d.push.publicKey;
        if (!key) throw new Error("not_ready");
        return Notification.requestPermission().then(function (p) {
          if (p !== "granted") throw new Error("denied");
          return navigator.serviceWorker.register("/sw.js").then(function () { return navigator.serviceWorker.ready; });
        }).then(function (reg) {
          return reg.pushManager.getSubscription().then(function (s) { return s || reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(key) }); });
        }).then(function (sub) { return api("push/subscribe", { subscription: sub.toJSON() }); })
          .then(function (r) { if (r._status !== 200) throw new Error(r.error || "server"); return load(); });
      });
    },
    test: function () { return api("push/test", { lang: lang() }); },
  };
  function pushLine(box, after) {
    var t = w(); box.textContent = "";
    push.status().then(function (s) {
      var p = document.createElement("p"); p.className = "mla-push " + s; box.appendChild(p);
      p.textContent = s === "on" ? t.pushOn : s === "denied" ? t.pushDenied : s === "unsupported" ? t.pushUnsupported : s === "ios-install" ? t.pushIos : t.pushOff;
      if (s === "off") {
        var b = document.createElement("button"); b.type = "button"; b.className = "mla-btn ghost"; b.textContent = t.enable; box.appendChild(b);
        b.addEventListener("click", function () {
          b.disabled = true;
          push.enable().then(function () { pushLine(box, after); if (after) after(); })
            .catch(function (e) { b.disabled = false; toast(e && e.message === "not_ready" ? t.pushNotReady : e && e.message === "denied" ? t.pushDenied : t.fail); });
        });
      }
      if (s === "on" && after) after();
    });
  }

  // ---- small UI pieces ----
  var CSS = ".mla-dlg{width:min(420px,calc(100vw - 32px));padding:0;border:1px solid var(--line);border-radius:14px;background:var(--panel);color:var(--fg)}" +
    ".mla-dlg::backdrop{background:rgba(5,10,14,.55)}.mla-body{padding:18px 18px 14px}.mla-body h3{margin:0 0 4px;font-size:17px}" +
    ".mla-sub{margin:0 0 12px;color:var(--muted);font-size:13px}.mla-opt{display:flex;align-items:center;gap:10px;padding:9px 10px;border:1px solid var(--line);border-radius:9px;margin:6px 0;font-size:14px;cursor:pointer}" +
    ".mla-opt input{accent-color:var(--accent)}.mla-opt.off{opacity:.5;cursor:default}.mla-field{display:block;margin:10px 0 2px;font-size:13px;color:var(--muted)}" +
    ".mla-input{width:100%;height:40px;padding:0 12px;border:1px solid var(--line);border-radius:9px;background:var(--bg);color:var(--fg);font-size:15px;font-variant-numeric:tabular-nums}" +
    ".mla-note{margin:10px 0 0;color:var(--muted);font-size:12px;line-height:1.45}.mla-warn{margin:8px 0 0;color:var(--down);font-size:13px}.mla-warn:empty{display:none}" +
    ".mla-pushbox{margin-top:12px;padding-top:10px;border-top:1px solid var(--line);display:flex;flex-wrap:wrap;gap:8px;align-items:center}.mla-push{margin:0;font-size:12.5px;color:var(--muted);flex:1 1 200px}.mla-push.on{color:var(--up)}" +
    ".mla-actions{display:flex;justify-content:flex-end;gap:8px;padding:12px 18px 16px}" +
    ".mla-btn{min-height:36px;padding:0 14px;border:0;border-radius:9px;background:var(--accent);color:var(--bg);font:inherit;font-size:13.5px;font-weight:700;cursor:pointer}" +
    ".mla-btn.ghost{border:1px solid var(--line);background:none;color:var(--fg);font-weight:600}.mla-btn:disabled{opacity:.5;cursor:default}" +
    ".mla-toast{position:fixed;left:50%;bottom:24px;z-index:2147483646;transform:translateX(-50%);padding:10px 16px;border-radius:10px;background:#18222c;color:#eef1f7;font-size:13.5px;box-shadow:0 10px 30px rgba(0,0,0,.35)}" +
    ".mla-list{list-style:none;margin:10px 0 0;padding:0}.mla-list li{display:flex;flex-wrap:wrap;align-items:center;gap:6px 10px;padding:10px 0;border-top:1px solid var(--line)}" +
    ".mla-what{flex:1 1 240px;font-size:14px;font-variant-numeric:tabular-nums}.mla-state{font-size:12px;color:var(--muted)}.mla-state.on{color:var(--up)}" +
    ".mla-list .mla-btn{min-height:30px;padding:0 10px;font-size:12.5px}.mla-list a{font-size:12.5px;color:var(--accent);text-decoration:none}" +
    ".mla-head{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:8px}.mla-count{font-size:12.5px;color:var(--muted)}";
  function css() { if (document.getElementById("mla-css")) return; var s = document.createElement("style"); s.id = "mla-css"; s.textContent = CSS; document.head.appendChild(s); }
  function toast(text) { css(); var t = document.createElement("div"); t.className = "mla-toast"; t.setAttribute("role", "status"); t.textContent = text; document.body.appendChild(t); setTimeout(function () { t.remove(); }, 3200); }
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }

  // A dialog with a body builder; resolve(payload) creates the alarm.
  function dialog(title, sub, build) {
    css();
    var t = w(), d = el("dialog", "mla-dlg"), body = el("div", "mla-body"), warn = el("p", "mla-warn");
    body.appendChild(el("h3", null, title)); if (sub) body.appendChild(el("p", "mla-sub", sub));
    var getPayload = build(body, warn);
    body.appendChild(warn); body.appendChild(el("p", "mla-note", t.okx));
    var pushBox = el("div", "mla-pushbox"); body.appendChild(pushBox); pushLine(pushBox);
    var actions = el("div", "mla-actions"), cancel = el("button", "mla-btn ghost", t.cancel), ok = el("button", "mla-btn", t.create);
    cancel.type = ok.type = "button"; actions.appendChild(cancel); actions.appendChild(ok);
    d.appendChild(body); d.appendChild(actions); document.body.appendChild(d);
    function close() { d.close(); d.remove(); }
    cancel.addEventListener("click", close); d.addEventListener("cancel", function (e) { e.preventDefault(); close(); });
    d.addEventListener("click", function (e) { if (e.target === d) close(); });
    ok.addEventListener("click", function () {
      var payload = getPayload(); if (!payload) return;
      ok.disabled = true; payload.lang = lang();
      api("alarms", payload).then(function (r) {
        ok.disabled = false;
        if (r._status === 200) { close(); toast(t.created); load(); }
        else warn.textContent = r.error === "too_many" ? fill(t.tooMany, { max: r.max || 20 }) : t.fail;
      }).catch(function () { ok.disabled = false; warn.textContent = t.fail; });
    });
    d.showModal();
    return d;
  }

  function openPrice(o) {
    var t = w(), now = Number(o.price) || null, d = o.digits != null ? o.digits : digitsFor(now || 1);
    return dialog(fill(t.priceTitle, { base: base(o.asset) }), now ? fill(t.now, { p: money(now, d) }) : "", function (body, warn) {
      var dir = "above", opts = {};
      ["above", "below"].forEach(function (k) {
        var l = el("label", "mla-opt"), r = el("input"); r.type = "radio"; r.name = "mla-dir"; r.value = k; r.checked = k === dir;
        r.addEventListener("change", function () { dir = k; check(); }); l.appendChild(r); l.appendChild(document.createTextNode(t[k])); body.appendChild(l); opts[k] = r;
      });
      var lab = el("label", "mla-field", t.level), input = el("input", "mla-input"); input.type = "text"; input.inputMode = "decimal"; input.autocomplete = "off";
      if (now) input.value = num(now, d); lab.appendChild(document.createElement("br")); body.appendChild(lab); body.appendChild(input);
      function value() { var s = input.value.trim(); s = lang() === "tr" ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, ""); var n = Number(s); return n > 0 ? n : null; }
      function check() {
        var v = value(); warn.textContent = "";
        if (v && now) { if (dir === "above" && now >= v) warn.textContent = t.already.above; if (dir === "below" && now <= v) warn.textContent = t.already.below; }
        return v && !warn.textContent;
      }
      input.addEventListener("input", function () { var v = value(); if (v && now) { dir = v > now ? "above" : "below"; opts[dir].checked = true; } check(); });
      setTimeout(function () { input.focus(); input.select(); }, 0);
      return function () { if (!check()) { if (!value()) input.focus(); return null; } return { kind: "price", cond: dir, asset: o.asset, price: value() }; };
    });
  }

  function openZone(o) {
    var t = w(), z = o.zone, d = o.digits != null ? o.digits : digitsFor(z.low), now = Number(o.price) || null, tf = String(o.tf || "1d").toLowerCase();
    var type = z.type === "resistance" ? "resistance" : "support", inside = now && now >= z.low && now <= z.high;
    return dialog(fill(t.zoneTitle, { base: base(o.asset) }), fill(t.zoneLine, { type: t[type], low: num(z.low, d), high: money(z.high, d) }) + (now ? " · " + fill(t.now, { p: money(now, d) }) : ""), function (body, warn) {
      var cond = inside ? "break" : "enter";
      [["enter", t.enter], ["break", fill(type === "support" ? t.breakSup : t.breakRes, { tf: tf.toUpperCase() })]].forEach(function (x) {
        var l = el("label", "mla-opt" + (x[0] === "enter" && inside ? " off" : "")), r = el("input"); r.type = "radio"; r.name = "mla-cond"; r.value = x[0]; r.checked = x[0] === cond; r.disabled = x[0] === "enter" && inside;
        r.addEventListener("change", function () { cond = x[0]; }); l.appendChild(r); l.appendChild(document.createTextNode(x[1])); body.appendChild(l);
      });
      if (inside) warn.textContent = t.insideNow;
      return function () { return { kind: "zone", cond: cond, asset: o.asset, zone: { low: z.low, high: z.high, type: type }, tf: tf }; };
    });
  }

  // ---- the account page list ----
  function describe(a) {
    var t = w(), d = digitsFor(a.kind === "price" ? a.price : a.zone.low);
    if (a.kind === "price") return fill(t.kindPrice[a.cond], { base: base(a.asset), p: money(a.price, d) });
    var o = { base: base(a.asset), type: t[a.zone.type].toLocaleLowerCase(lang() === "tr" ? "tr" : "en"), low: num(a.zone.low, d), high: money(a.zone.high, d), tf: (a.tf || "").toUpperCase(), side: a.zone.type === "support" ? t.sideBelow : t.sideAbove };
    return fill(a.cond === "enter" ? t.kindEnter : t.kindBreak, o);
  }
  function mountList(box) {
    css();
    function render() {
      var t = w(); box.textContent = "";
      if (!info) { box.appendChild(el("p", "mla-state", t.membersOnly)); return; }
      box.hidden = !available(); if (box.hidden) return;
      var head = el("div", "mla-head"); head.appendChild(el("h2", null, t.listTitle));
      var activeN = info.alarms.filter(function (a) { return a.active; }).length; head.appendChild(el("span", "mla-count", fill(t.count, { n: activeN, max: info.max })));
      box.appendChild(head);
      var pushBox = el("div", "mla-pushbox"); box.appendChild(pushBox);
      pushLine(pushBox, function () {
        if (pushBox.querySelector(".mla-test")) return;
        var tb = el("button", "mla-btn ghost mla-test", t.test); tb.type = "button"; pushBox.appendChild(tb);
        tb.addEventListener("click", function () { tb.disabled = true; push.test().then(function (r) { tb.disabled = false; toast(r.sent ? t.testSent : r.error === "push_not_configured" ? t.pushNotReady : t.testNone); }); });
      });
      if (!info.alarms.length) { box.appendChild(el("p", "mla-note", t.listEmpty)); return; }
      var ul = el("ul", "mla-list");
      info.alarms.forEach(function (a) {
        var li = el("li"), d = digitsFor(a.kind === "price" ? a.price : a.zone.low);
        li.appendChild(el("span", "mla-what", describe(a)));
        var when = a.triggeredAt ? new Date(a.triggeredAt).toLocaleString(lang() === "tr" ? "tr-TR" : "en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "";
        li.appendChild(el("span", "mla-state" + (a.active ? " on" : ""), a.active ? t.active : fill(t.fired, { when: when, p: money(a.triggeredPrice, d) })));
        var link = el("a", null, t.openAnalysis); link.href = "/bulletin?asset=" + encodeURIComponent(a.asset) + (a.tf ? "&tf=" + a.tf : ""); li.appendChild(link);
        if (!a.active) { var re = el("button", "mla-btn ghost", t.rearm); re.type = "button"; re.addEventListener("click", function () { re.disabled = true; api("alarms/rearm", { id: a.id }).then(function (r) { if (r._status !== 200) toast(r.error === "too_many" ? fill(t.tooMany, { max: info.max }) : t.fail); return load(); }).then(render); }); li.appendChild(re); }
        var rm = el("button", "mla-btn ghost", t.remove); rm.type = "button"; rm.addEventListener("click", function () { rm.disabled = true; api("alarms/remove", { id: a.id }).then(load).then(render); }); li.appendChild(rm);
        ul.appendChild(li);
      });
      box.appendChild(ul);
    }
    load().then(render).catch(render);
    new MutationObserver(render).observe(document.documentElement, { attributes: true, attributeFilter: ["lang"] });
  }

  window.MLMAlarms = { openPrice: openPrice, openZone: openZone, mountList: mountList, push: push, load: load, ready: ready, available: available, toast: toast };
})();
