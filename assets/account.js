/* Header account control (every page): "Sign in" for guests; the Google picture with a small menu
   (Profile, Sign out) once signed in. The server is asked only when the readable hint cookie (mlm_li) says a
   session exists, so guests cost no extra requests. window.MLMAccount.ready resolves with the user or null. */
(function () {
  var WORDS = {
    en: { signIn: "Sign in", profile: "Profile", admin: "Admin panel", signOut: "Sign out", menu: "Account menu",
      status: { registered: "Registered", pending: "Waiting for verification", approved: "Approved", rejected: "Rejected", suspended: "Suspended" } },
    tr: { signIn: "Giriş yap", profile: "Profil", admin: "Admin paneli", signOut: "Çıkış yap", menu: "Hesap menüsü",
      status: { registered: "Kayıtlı", pending: "Doğrulama bekliyor", approved: "Onaylı", rejected: "Reddedildi", suspended: "Askıda" } }
  };
  var hinted = /(?:^|;\s*)mlm_li=1/.test(document.cookie);
  var user = null, box = null, resolveReady, drawn = "";
  var ready = new Promise(function (r) { resolveReady = r; });
  window.MLMAccount = { ready: ready, user: function () { return user; } };

  function lang() {
    var sel = document.getElementById("lang");
    var v = (sel && sel.value) || document.documentElement.lang || "en";
    return v.slice(0, 2) === "tr" ? "tr" : "en";
  }
  function w() { return WORDS[lang()]; }
  function returnPath() { return location.pathname + location.search; }

  function css() {
    var s = document.createElement("style");
    s.textContent =
      // The header's shell must stack above the page content (the home page gives both z-index:1) so the menu is not covered.
      "body>.shell:has(>header){position:relative;z-index:30}" +
      ".acct{position:relative;display:flex;align-items:center}" +
      ".acct-in{display:inline-flex;align-items:center;height:30px;padding:0 12px;border:1px solid var(--line);border-radius:999px;background:var(--panel);color:var(--fg);font-size:12px;font-weight:600;text-decoration:none;white-space:nowrap}" +
      ".acct-in:hover{border-color:var(--accent);color:var(--accent)}" +
      ".acct-btn{display:flex;align-items:center;justify-content:center;width:30px;height:30px;padding:0;border:1px solid var(--line);border-radius:50%;background:var(--panel);overflow:hidden;cursor:pointer;color:var(--fg);font-size:13px;font-weight:700}" +
      ".acct-btn img{width:100%;height:100%;object-fit:cover}" +
      ".acct-btn:hover,.acct-btn[aria-expanded=true]{border-color:var(--accent)}" +
      ".acct-menu{position:absolute;top:38px;right:0;z-index:60;min-width:220px;padding:6px;border:1px solid var(--line);border-radius:12px;background:var(--panel);box-shadow:0 12px 32px rgba(0,0,0,.28)}" +
      ".acct-menu[hidden]{display:none}" +
      ".acct-who{padding:8px 10px 10px;border-bottom:1px solid var(--line);margin-bottom:4px}" +
      ".acct-who b{display:block;font-size:13px}.acct-who span{display:block;color:var(--muted);font-size:12px;overflow:hidden;text-overflow:ellipsis}" +
      ".acct-who i{display:inline-block;margin-top:6px;padding:1px 8px;border-radius:999px;background:var(--raise,var(--panel-2));font-size:11px;font-style:normal;font-weight:600}" +
      ".acct-who i.approved{color:var(--up)}.acct-who i.rejected,.acct-who i.suspended{color:var(--down)}" +
      ".acct-menu a,.acct-menu button{display:block;width:100%;padding:8px 10px;border:0;border-radius:8px;background:none;color:var(--fg);font-size:13px;text-align:left;text-decoration:none;cursor:pointer}" +
      ".acct-menu a:hover,.acct-menu button:hover{background:var(--raise,var(--panel-2))}";
    document.head.appendChild(s);
  }

  function render() {
    if (!box) return;
    var key = lang() + "|" + (user ? user.email + user.status + user.picture + user.isAdmin : hinted ? "hint" : "guest");
    if (key === drawn) return; // the analysis page sets <html lang> often; redraw only on a real change
    drawn = key;
    var t = w();
    box.textContent = "";
    if (!user && !hinted) {
      var a = document.createElement("a");
      a.className = "acct-in"; a.href = "/api/auth/google/start?return=" + encodeURIComponent(returnPath()); a.textContent = t.signIn;
      box.appendChild(a);
      return;
    }
    var btn = document.createElement("button");
    btn.type = "button"; btn.className = "acct-btn"; btn.setAttribute("aria-haspopup", "true"); btn.setAttribute("aria-expanded", "false");
    btn.setAttribute("aria-label", t.menu);
    if (user && user.picture) { var img = document.createElement("img"); img.src = user.picture; img.alt = ""; img.referrerPolicy = "no-referrer"; btn.appendChild(img); }
    else btn.textContent = user ? (user.name || user.email || "?").trim().charAt(0).toUpperCase() : "";
    var menu = document.createElement("div");
    menu.className = "acct-menu"; menu.hidden = true;
    if (user) {
      var who = document.createElement("div"); who.className = "acct-who";
      var n = document.createElement("b"); n.textContent = user.name || user.email;
      var e = document.createElement("span"); e.textContent = user.email;
      var st = document.createElement("i"); st.className = user.status; st.textContent = t.status[user.status] || user.status;
      who.appendChild(n); who.appendChild(e); who.appendChild(st); menu.appendChild(who);
    }
    var prof = document.createElement("a"); prof.href = "/account"; prof.textContent = t.profile; menu.appendChild(prof);
    if (user && user.isAdmin) { var adm = document.createElement("a"); adm.href = "/admin"; adm.textContent = t.admin; menu.appendChild(adm); }
    var out = document.createElement("button"); out.type = "button"; out.textContent = t.signOut;
    out.addEventListener("click", function () {
      fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" }).finally(function () { location.reload(); });
    });
    menu.appendChild(out);
    btn.addEventListener("click", function (ev) { ev.stopPropagation(); menu.hidden = !menu.hidden; btn.setAttribute("aria-expanded", String(!menu.hidden)); });
    box.appendChild(btn); box.appendChild(menu);
  }

  function mount() {
    var controls = document.querySelector("header .controls");
    if (!controls || controls.querySelector(".acct")) return;
    css();
    box = document.createElement("div"); box.className = "acct";
    controls.appendChild(box);
    render();
    function close() { var m = box.querySelector(".acct-menu"), b = box.querySelector(".acct-btn"); if (m) m.hidden = true; if (b) b.setAttribute("aria-expanded", "false"); }
    document.addEventListener("click", function (ev) { if (!box.contains(ev.target)) close(); });
    document.addEventListener("keydown", function (ev) { if (ev.key === "Escape") close(); });
    var sel = document.getElementById("lang");
    if (sel) sel.addEventListener("change", function () { setTimeout(render, 0); });
    new MutationObserver(function () { render(); }).observe(document.documentElement, { attributes: true, attributeFilter: ["lang"] });
  }

  function load() {
    if (!hinted) { resolveReady(null); return; }
    fetch("/api/auth/me", { credentials: "same-origin", cache: "no-store" })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (data) { user = data && data.user ? data.user : null; })
      .catch(function () { user = null; })
      .then(function () { if (!user) hinted = false; render(); resolveReady(user); });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", function () { mount(); load(); });
  else { mount(); load(); }
})();
