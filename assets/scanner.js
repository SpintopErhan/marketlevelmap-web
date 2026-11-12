/* Zone scanner (README "Zone scanner"). Members-only page (scanner.html): every analysed asset's live price against
   the bands of its latest Critical Zones report (timeframe chosen on the page), zone alarms, and big spot trades
   across all assets. Prices come from assets/market-feed.js; big trades from Binance's public aggTrade streams,
   opened by the visitor's browser. Nothing is stored on our side: alarms live in this browser (localStorage). */
(function () {
  "use strict";
  var W = {
    en: {
      title: "Scanner", sub: "live · Critical Zones", lead: "Where each asset's price stands against its analysis zones.", tf: "Timeframe",
      assets: "Assets", byNear: "nearest first", asset: "Asset", price: "Price", status: "Status", position: "Position", res: "Nearest resistance", sup: "Nearest support",
      inS: "Inside the support zone", inR: "Inside the resistance zone", nearR: "{p} below resistance", nearS: "{p} above support", between: "Between zones", noZones: "No zones",
      inside: "inside", loading: "Loading…", noAnalysis: "No Critical Zones analysis on this timeframe",
      alarms: "Alarms", alarmsNone: "No alarms. Use the bell on a row.", alarmsNote: "Alarms ring while this page is open (also in a background tab) and are kept only in this browser.",
      enter: "When the price enters a zone", exit: "When the price leaves a zone", remove: "Remove",
      entered: "{asset} entered the {type} zone", left: "{asset} left the {type} zone", support: "support", resistance: "resistance", priceNow: "price {p}",
      big: "Big trades", bigSub: "all assets · spot · Binance", bigNote: "A print is at least the chosen multiple of the asset's average trade and $10K. Click a row for the live flow.",
      buy: "BUY", sell: "SELL", bigWait: "Waiting for big trades…", bigOff: "Binance cannot be reached from here.",
      gateGuest: "The scanner is for members. Sign in with Google to apply for membership.", signIn: "Sign in with Google",
      gateMember: "The scanner is for members. It opens once your membership is approved.", profile: "Your profile",
      notifyOff: "Browser notifications are blocked; alarms show on the page only."
    },
    tr: {
      title: "Tarayıcı", sub: "canlı · Kritik Bölgeler", lead: "Her varlığın fiyatının analiz bölgelerine göre nerede durduğu.", tf: "Zaman dilimi",
      assets: "Varlıklar", byNear: "yakınlık sırasına göre", asset: "Varlık", price: "Fiyat", status: "Durum", position: "Konum", res: "En yakın direnç", sup: "En yakın destek",
      inS: "Destek bölgesinin içinde", inR: "Direnç bölgesinin içinde", nearR: "Dirence {p} uzakta", nearS: "Desteğe {p} uzakta", between: "Bölgeler arası", noZones: "Bölge yok",
      inside: "içinde", loading: "Yükleniyor…", noAnalysis: "Bu zaman diliminde Kritik Bölgeler analizi yok",
      alarms: "Alarmlar", alarmsNone: "Alarm yok. Satırdaki zili kullanın.", alarmsNote: "Alarmlar bu sayfa açıkken çalar (arka plandaki sekmede de) ve yalnızca bu tarayıcıda tutulur.",
      enter: "Fiyat bölgeye girince", exit: "Fiyat bölgeden çıkınca", remove: "Kaldır",
      entered: "{asset} {type} bölgesine girdi", left: "{asset} {type} bölgesinden çıktı", support: "destek", resistance: "direnç", priceNow: "fiyat {p}",
      big: "Büyük işlemler", bigSub: "tüm varlıklar · spot · Binance", bigNote: "İşlem, varlığın ortalama işleminin seçilen katı ve en az 10 B $ olmalıdır. Satıra tıklayınca canlı akış açılır.",
      buy: "ALIŞ", sell: "SATIŞ", bigWait: "Büyük işlem bekleniyor…", bigOff: "Buradan Binance'e ulaşılamıyor.",
      gateGuest: "Tarayıcı üyelere özeldir. Üyelik başvurusu için Google ile giriş yapın.", signIn: "Google ile giriş yap",
      gateMember: "Tarayıcı üyelere özeldir. Üyeliğiniz onaylandığında açılır.", profile: "Profiliniz",
      notifyOff: "Tarayıcı bildirimleri engelli; alarmlar yalnızca sayfada görünür."
    }
  };
  function lang() { var s = document.getElementById("lang"); return s && s.value === "tr" ? "tr" : "en"; }
  function w() { return W[lang()]; }
  function fill(t, o) { return String(t).replace(/\{(\w+)\}/g, function (_, k) { return o[k] == null ? "" : o[k]; }); }
  function $(id) { return document.getElementById(id); }
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function locale() { return MarketUI.locale(); }
  function nf(v, d) { return Number(v).toLocaleString(locale(), { minimumFractionDigits: d, maximumFractionDigits: d }); }
  function pct(r, d) { var s = nf(Math.abs(r) * 100, d == null ? 1 : d); return lang() === "tr" ? "%" + s : s + "%"; }
  function price(p) { return MarketUI.price(p); }
  var TF_ORDER = ["1h", "4h", "1d", "1w"], NEAR = 0.01;

  var entries = {}, assets = [], tf = "1d", zonesBy = {}, loads = {}, prices = {}, opens = {}, last = {}, alarms = {}, dirty = true;
  try { alarms = JSON.parse(localStorage.getItem("mlm-zone-alarms") || "{}") || {}; } catch (e) { alarms = {}; }
  function saveAlarms() { try { localStorage.setItem("mlm-zone-alarms", JSON.stringify(alarms)); } catch (e) {} }

  // ─── Zones ───────────────────────────────────────────────────────────────
  function normZones(rep) {
    return (rep && Array.isArray(rep.zones) ? rep.zones : []).map(function (z) { var a = Number(z.low), b = Number(z.high); return { low: Math.min(a, b), high: Math.max(a, b), type: z.type === "support" ? "support" : "resistance" }; })
      .filter(function (z) { return z.low > 0 && z.high > 0; });
  }
  function loadTf(t) {
    if (loads[t]) return loads[t];
    zonesBy[t] = zonesBy[t] || {};
    loads[t] = Promise.all(assets.map(function (a) {
      var e = entries[a] && entries[a][t];
      if (!e) { zonesBy[t][a] = null; return null; }
      return fetch(e.report.url, { cache: "no-store" }).then(function (r) { return r.ok ? r.json() : null; }).then(function (rep) { zonesBy[t][a] = rep && !rep.locked ? normZones(rep) : null; dirty = true; }).catch(function () { zonesBy[t][a] = null; });
    }));
    return loads[t];
  }
  function narrowest(list) { return list.sort(function (a, b) { return (a.high - a.low) - (b.high - b.low); })[0] || null; }
  function state(p, zones) {
    if (!(p > 0) || !zones) return null;
    var inside = narrowest(zones.filter(function (z) { return p >= z.low && p <= z.high; }));
    var res = zones.filter(function (z) { return z.type === "resistance" && z.low > p; }).sort(function (a, b) { return a.low - b.low; })[0] || null;
    var sup = zones.filter(function (z) { return z.type === "support" && z.high < p; }).sort(function (a, b) { return b.high - a.high; })[0] || null;
    var dr = res ? res.low / p - 1 : Infinity, ds = sup ? 1 - sup.high / p : Infinity;
    return { inside: inside, res: res, sup: sup, dr: dr, ds: ds, near: Math.min(dr, ds), zones: zones };
  }

  // ─── Table ───────────────────────────────────────────────────────────────
  function statusPill(st) {
    var t = w();
    if (!st) return el("span", "pill far", t.loading);
    if (!st.zones.length) return el("span", "pill far", t.noZones);
    if (st.inside) return el("span", "pill " + (st.inside.type === "support" ? "in-s" : "in-r"), "● " + (st.inside.type === "support" ? t.inS : t.inR));
    if (st.near <= NEAR) return el("span", "pill near", st.dr <= st.ds ? fill(t.nearR, { p: pct(st.dr) }) : fill(t.nearS, { p: pct(st.ds) }));
    return el("span", "pill far", t.between);
  }
  // Position bar: from the support zone below (or the one the price is in) to the resistance zone above.
  function meter(st, p) {
    var box = el("div", "meter");
    if (!st || !st.zones.length) return box;
    var lo = st.inside && st.inside.type === "support" ? st.inside : st.sup, hi = st.inside && st.inside.type === "resistance" ? st.inside : st.res;
    if (st.inside && !lo) lo = st.inside; if (st.inside && !hi) hi = st.inside;
    var a = lo ? lo.low : p * 0.95, b = hi ? hi.high : p * 1.05; if (!(b > a)) return box;
    function x(v) { return Math.max(0, Math.min(100, (v - a) / (b - a) * 100)); }
    [lo, hi].forEach(function (z) { if (!z) return; var s = el("s", z.type === "support" ? "s" : "r"); s.style.left = x(z.low) + "%"; s.style.width = Math.max(1.5, x(z.high) - x(z.low)) + "%"; box.appendChild(s); });
    var i = el("i"); i.style.left = x(p) + "%"; box.appendChild(i);
    return box;
  }
  function zoneText(z, d) { return z ? price(z.low) + " – " + price(z.high) : "—"; }
  function render() {
    if (!dirty) return; dirty = false;
    var t = w(), body = $("sc-rows"), zones = zonesBy[tf] || {};
    var rows = assets.map(function (a) { return { a: a, p: prices[a], st: zones[a] === undefined ? undefined : state(prices[a], zones[a]), has: !!(entries[a] && entries[a][tf]) }; })
      .filter(function (r) { return r.has; })
      .sort(function (x, y) { function k(r) { return !r.st ? 9 : r.st.inside ? -1 + 1e-6 * (r.st.inside.high - r.st.inside.low) / r.p : r.st.near; } return k(x) - k(y) || MarketUI.byPopularity(x.a, y.a); });
    body.textContent = "";
    $("sc-empty").hidden = rows.length > 0;
    rows.forEach(function (r) {
      var tr = el("tr"), o = opens[r.a], ch = r.p && o ? r.p / o - 1 : NaN;
      var c0 = el("td"); var link = el("a", "", MarketUI.baseOf(r.a)); link.href = "flow?asset=" + encodeURIComponent(r.a); c0.appendChild(el("b")).appendChild(link); tr.appendChild(c0);
      var c1 = el("td", "r num", r.p ? price(r.p) : "—"); if (isFinite(ch)) { c1.appendChild(document.createTextNode(" ")); c1.appendChild(el("small", MarketUI.signClass(ch), (ch >= 0 ? "+" : "−") + pct(ch))); } tr.appendChild(c1);
      var c2 = el("td"); c2.appendChild(zones[r.a] === null ? el("span", "pill far", t.noZones) : !r.st ? el("span", "pill far", t.loading) : statusPill(r.st)); tr.appendChild(c2);
      var c3 = el("td", "hide-m"); c3.appendChild(meter(r.st, r.p)); tr.appendChild(c3);
      tr.appendChild(el("td", "r num hide-m", r.st && r.st.res ? price(r.st.res.low) + " · +" + pct(r.st.dr) : r.st && r.st.inside && r.st.inside.type === "resistance" ? t.inside : "—"));
      tr.appendChild(el("td", "r num hide-m", r.st && r.st.sup ? price(r.st.sup.high) + " · −" + pct(r.st.ds) : r.st && r.st.inside && r.st.inside.type === "support" ? t.inside : "—"));
      var c6 = el("td", "r"), key = r.a + "|" + tf, al = alarms[key], bell = el("button", "bell" + (al && (al.enter || al.exit) ? " on" : ""));
      bell.type = "button"; bell.dataset.key = key; bell.setAttribute("aria-label", t.alarms + " · " + r.a); bell.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4zM10 20a2 2 0 0 0 4 0"/></svg>';
      c6.appendChild(bell); tr.appendChild(c6);
      body.appendChild(tr);
    });
    renderAlarmList();
  }
  function renderAlarmList() {
    var t = w(), box = $("sc-alarms"); box.textContent = "";
    var keys = Object.keys(alarms).filter(function (k) { return alarms[k] && (alarms[k].enter || alarms[k].exit); });
    if (!keys.length) { box.appendChild(el("span", "muted", t.alarmsNone)); return; }
    keys.sort().forEach(function (k) {
      var parts = k.split("|"), a = alarms[k], chip = el("span", "chip");
      chip.appendChild(el("b", "", MarketUI.baseOf(parts[0]) + " · " + parts[1].toUpperCase()));
      chip.appendChild(document.createTextNode(" " + [a.enter ? "↘ " + t.enter.toLowerCase() : "", a.exit ? "↗ " + t.exit.toLowerCase() : ""].filter(Boolean).join(", ")));
      var x = el("button", "x", "×"); x.type = "button"; x.title = t.remove; x.addEventListener("click", function () { delete alarms[k]; saveAlarms(); dirty = true; render(); });
      chip.appendChild(x); box.appendChild(chip);
    });
  }

  // ─── Alarms ──────────────────────────────────────────────────────────────
  var menu = null;
  function openMenu(bell) {
    closeMenu();
    var t = w(), key = bell.dataset.key, al = alarms[key] || {};
    menu = el("div", "alarm-menu"); menu.setAttribute("role", "dialog");
    menu.appendChild(el("b", "", MarketUI.baseOf(key.split("|")[0]) + " · " + key.split("|")[1].toUpperCase()));
    [["enter", t.enter], ["exit", t.exit]].forEach(function (o) {
      var lab = el("label"), cb = el("input"); cb.type = "checkbox"; cb.checked = !!al[o[0]];
      cb.addEventListener("change", function () {
        var cur = alarms[key] || {}; cur[o[0]] = cb.checked; if (!cur.enter && !cur.exit) delete alarms[key]; else alarms[key] = cur;
        saveAlarms(); askPermission(); loadTf(key.split("|")[1]); dirty = true; render();
      });
      lab.appendChild(cb); lab.appendChild(document.createTextNode(" " + o[1])); menu.appendChild(lab);
    });
    menu.appendChild(el("small", "muted", t.alarmsNote));
    document.body.appendChild(menu);
    var r = bell.getBoundingClientRect(), mw = Math.min(280, innerWidth - 24);
    menu.style.width = mw + "px"; menu.style.top = (r.bottom + scrollY + 6) + "px"; menu.style.left = Math.max(12, Math.min(innerWidth - mw - 12, r.right - mw)) + scrollX + "px";
  }
  function closeMenu() { if (menu) { menu.remove(); menu = null; } }
  function askPermission() {
    if (!("Notification" in window)) return;
    if (Notification.permission === "default") try { Notification.requestPermission().then(function () { syncNotify(); }); } catch (e) {}
    syncNotify();
  }
  function syncNotify() { $("sc-notify").hidden = !("Notification" in window) || Notification.permission !== "denied" || !Object.keys(alarms).length; }
  function notify(text, sub, asset) {
    var box = $("sc-toasts"), card = el("a", "toast"); card.href = "flow?asset=" + encodeURIComponent(asset);
    card.appendChild(el("b", "", "🔔 " + text)); card.appendChild(el("span", "", sub));
    box.prepend(card); setTimeout(function () { card.classList.add("out"); setTimeout(function () { card.remove(); }, 400); }, 20000);
    while (box.children.length > 4) box.lastChild.remove();
    if ("Notification" in window && Notification.permission === "granted") try { var n = new Notification(text, { body: sub, tag: asset + text, icon: "/assets/icons/icon-192.png" }); n.onclick = function () { window.focus(); location.href = "flow?asset=" + encodeURIComponent(asset); }; } catch (e) {}
  }
  // Each alarmed asset/timeframe remembers the zone the price was last in; a change rings once.
  function checkAlarms(a) {
    var p = prices[a]; if (!(p > 0)) return;
    Object.keys(alarms).forEach(function (key) {
      var parts = key.split("|"); if (parts[0] !== a) return;
      var zones = zonesBy[parts[1]] && zonesBy[parts[1]][a]; if (!zones) return;
      var st = state(p, zones), now = st.inside, prev = last[key], al = alarms[key], t = w(), tfL = parts[1].toUpperCase();
      last[key] = now;
      function zk(z) { return z ? z.low + "-" + z.high : ""; }
      if (prev === undefined || zk(prev) === zk(now)) return;
      if (prev && al.exit) notify(fill(t.left, { asset: MarketUI.baseOf(a), type: prev.type === "support" ? t.support : t.resistance }), price(prev.low) + " – " + price(prev.high) + " · " + fill(t.priceNow, { p: price(p) }) + " · " + tfL, a);
      if (now && al.enter) notify(fill(t.entered, { asset: MarketUI.baseOf(a), type: now.type === "support" ? t.support : t.resistance }), price(now.low) + " – " + price(now.high) + " · " + fill(t.priceNow, { p: price(p) }) + " · " + tfL, a);
    });
  }

  // ─── Big trades (Binance aggTrade for every USDT asset) ──────────────────
  var BIG_URLS = ["wss://data-stream.binance.vision/stream?streams=", "wss://stream.binance.com:9443/stream?streams="];
  var big = [], bigMult = 10, stats = {}, pend = {}, bigWs = null, bigUrl = 0, bigRetry = 0, bigGot = false;
  function bigStart(list) {
    var syms = list.filter(function (a) { return /USDT$/.test(a); }); if (!syms.length) return;
    var url = BIG_URLS[bigUrl % BIG_URLS.length] + syms.map(function (a) { return a.toLowerCase() + "@aggTrade"; }).join("/"), ws;
    try { ws = new WebSocket(url); } catch (e) { return; }
    bigWs = ws; var got = false;
    ws.onmessage = function (e) { got = bigGot = true; bigRetry = 0; var m; try { m = JSON.parse(e.data); } catch (_) { return; } var d = m && m.data; if (d && d.e === "aggTrade") onAgg(d); };
    ws.onclose = function () { if (bigWs !== ws) return; bigWs = null; if (!got) bigUrl++; if (!bigGot && bigUrl >= BIG_URLS.length * 2) { $("sc-big-wait").textContent = w().bigOff; return; } setTimeout(function () { bigStart(list); }, Math.min(30000, 1000 * Math.pow(2, bigRetry++))); };
    ws.onerror = function () {};
  }
  // aggTrades of one taker order share the time and side: they are added up into one print first.
  function onAgg(d) {
    var s = d.s, buy = !d.m, q = +d.q, p = +d.p, cur = pend[s];
    if (cur && (cur.T !== d.T || cur.buy !== buy)) { flush(s); cur = null; }
    if (!cur) { cur = pend[s] = { s: s, T: d.T, buy: buy, q: 0, n: 0, p: p, at: Date.now() }; setTimeout(function () { if (pend[s] === cur) flush(s); }, 250); }
    cur.q += q; cur.n += q * p; cur.p = p;
  }
  function flush(s) {
    var o = pend[s]; delete pend[s]; if (!o) return;
    var st = stats[s] || (stats[s] = { buf: [], sum: 0 });
    var avg = st.buf.length ? st.sum / st.buf.length : 0, warm = st.buf.length >= 50;
    st.buf.push(o.q); st.sum += o.q; if (st.buf.length > 500) st.sum -= st.buf.shift();
    if (warm && o.q >= avg * 5 && o.n >= 10000) { o.x = o.q / avg; big.unshift(o); if (big.length > 200) big.pop(); bigDirty = true; }
  }
  var bigDirty = true;
  function renderBig() {
    if (!bigDirty) return; bigDirty = false;
    var t = w(), box = $("sc-big"), list = big.filter(function (o) { return o.x >= bigMult; }).slice(0, 20);
    box.textContent = "";
    $("sc-big-wait").hidden = list.length > 0;
    list.forEach(function (o) {
      var a = el("a", o.x >= bigMult * 3 ? "huge" : ""); a.href = "flow?asset=" + encodeURIComponent(o.s);
      var d = new Date(o.T); a.appendChild(el("span", "num muted", String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0") + ":" + String(d.getSeconds()).padStart(2, "0")));
      a.appendChild(el("b", "", MarketUI.baseOf(o.s)));
      a.appendChild(el("span", "num " + (o.buy ? "up" : "down"), (o.buy ? t.buy : t.sell) + " " + price(o.p)));
      a.appendChild(el("span", "num r", o.n.toLocaleString(locale(), { notation: "compact", maximumFractionDigits: o.n >= 1e6 ? 2 : 0 }) + " $"));
      a.appendChild(el("span", "num r muted", nf(o.x, 0) + "×"));
      box.appendChild(a);
    });
  }

  // ─── Page ────────────────────────────────────────────────────────────────
  function applyWords() {
    var t = w();
    document.querySelectorAll("[data-sc]").forEach(function (e) { var v = t[e.dataset.sc]; if (typeof v === "string") e.textContent = v; });
    document.title = "MarketLevelMap — " + t.title;
    dirty = bigDirty = true; if (assets.length) { render(); renderBig(); }
  }
  function gate(user) {
    var t = w(), msg = $("sc-gate-msg"), link = $("sc-gate-link");
    $("sc-gate").hidden = false;
    if (!user) { msg.dataset.sc = "gateGuest"; link.dataset.sc = "signIn"; link.href = "/api/auth/google/start?return=" + encodeURIComponent(location.pathname + location.search); }
    else { msg.dataset.sc = "gateMember"; link.dataset.sc = "profile"; link.href = "/account"; }
    msg.textContent = t[msg.dataset.sc]; link.textContent = t[link.dataset.sc];
  }
  function setTf(next) {
    tf = next; dirty = true;
    $("sc-tf").querySelectorAll("button").forEach(function (b) { b.setAttribute("aria-pressed", String(b.dataset.tf === tf)); });
    try { localStorage.setItem("mlm-scanner-tf", tf); } catch (e) {}
    loadTf(tf).then(function () { dirty = true; render(); }); render();
  }
  function boot() {
    $("lang").addEventListener("change", function () { setTimeout(applyWords, 0); });
    applyWords();
    (window.MLMAccount ? MLMAccount.ready : Promise.resolve(null)).then(function (user) {
      if (!(user && (user.status === "approved" || user.isAdmin))) { gate(user); return; }
      $("sc-app").hidden = false;
      fetch("/api/publication", { cache: "no-store" }).then(function (r) { return r.ok ? r.json() : null; }).then(function (body) {
        ((body && body.entries) || []).forEach(function (e) {
          if (MarketUI.methodOf(e) !== "cz" || !e.report) return;
          var a = MarketUI.assetOf(e), f = MarketUI.timeframeOf(e).toLowerCase(); if (!/^[A-Z0-9]{2,20}$/.test(a) || TF_ORDER.indexOf(f) < 0) return;
          (entries[a] || (entries[a] = {}))[f] = e;
        });
        assets = Object.keys(entries).sort(MarketUI.byPopularity);
        var tfs = TF_ORDER.filter(function (f) { return assets.some(function (a) { return entries[a][f]; }); }), seg = $("sc-tf");
        seg.textContent = "";
        tfs.forEach(function (f) { var b = el("button", "", f.toUpperCase()); b.type = "button"; b.dataset.tf = f; seg.appendChild(b); });
        var saved; try { saved = localStorage.getItem("mlm-scanner-tf"); } catch (e) {}
        seg.addEventListener("click", function (e) { var b = e.target.closest("button[data-tf]"); if (b) setTf(b.dataset.tf); });
        setTf(tfs.indexOf(saved) > -1 ? saved : tfs.indexOf("1d") > -1 ? "1d" : tfs[0] || "1d");
        Object.keys(alarms).forEach(function (k) { var f = k.split("|")[1]; if (TF_ORDER.indexOf(f) > -1) loadTf(f); });
        if (assets.length) MarketFeed.start(assets, { background: true, onData: function (sym, d) { var p = Number(d.c); if (!(p > 0)) return; prices[sym] = p; if (Number(d.o) > 0) opens[sym] = Number(d.o); dirty = true; checkAlarms(sym); } });
        bigStart(assets);
        syncNotify();
      });
      $("sc-rows").addEventListener("click", function (e) { var b = e.target.closest("button.bell"); if (b) { e.stopPropagation(); openMenu(b); } });
      document.addEventListener("click", function (e) { if (menu && !menu.contains(e.target)) closeMenu(); });
      document.addEventListener("keydown", function (e) { if (e.key === "Escape") closeMenu(); });
      $("sc-mult").addEventListener("click", function (e) { var b = e.target.closest("button[data-x]"); if (!b) return; bigMult = +b.dataset.x; this.querySelectorAll("button").forEach(function (x) { x.setAttribute("aria-pressed", String(x === b)); }); bigDirty = true; renderBig(); });
      setInterval(function () { if (document.hidden) return; render(); renderBig(); }, 500);
    });
  }
  window.MLMScanner = { _state: function () { return { assets: assets, prices: prices, zonesBy: zonesBy, alarms: alarms, big: big, stats: stats, tf: tf }; }, _check: checkAlarms };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();
})();
