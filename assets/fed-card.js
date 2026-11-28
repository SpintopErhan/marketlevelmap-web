/* Fed and inflation (README "Fed meetings"), from /api/fed:
   - [data-fed="card"] (weekly events page): the coming FOMC meetings with the probabilities the market prices for each
     target range (stacked bars, the most likely outcome written out) and a chart of the Fed's target range since 2021,
     the path the probabilities imply, and US inflation (CPI and core PCE, year on year).
   - [data-fed="line"] (home page): one line on the next meeting, linking to the card.
   The probabilities' positions: 0 = the current target range, each next one 25 bp higher (checked against CME
   FedWatch, 28 Nov 2026). Descriptive only. Credit: SoSoValue (probabilities, inflation), FRED (target range). */
(function () {
  "use strict";
  var W = {
    en: { title: "Fed and inflation", now: "Current target range {r} · since {d}", meetings: "Coming FOMC meetings · probabilities priced by the market",
      likely: "most likely", same: "no change", chart: "Target range and inflation", target: "Fed target range", path: "Path implied by the probabilities",
      cpi: "CPI (YoY)", pce: "Core PCE (YoY)", today: "today", src: "Probabilities and inflation: SoSoValue · Target range: FRED (St. Louis Fed)",
      note: "For each coming meeting of the US Federal Reserve (FOMC), the probability that the market (fed funds futures) prices for each target range; the first range is the current one, each next one 25 basis points higher. The dashed line is the average of those probabilities for the upper bound. CPI: US consumer prices, year on year; core PCE: the measure the Fed follows, without food and energy. These figures describe what the market prices; they are not a forecast of this site.",
      next: "Next Fed meeting: {d} · most likely {r} ({c}) · {p}", more: "Fed and inflation →", unavailable: "The Fed data could not be loaded." },
    tr: { title: "Fed ve enflasyon", now: "Mevcut hedef aralık {r} · {d} tarihinden beri", meetings: "Gelecek Fed (FOMC) toplantıları · piyasanın fiyatladığı olasılıklar",
      likely: "en olası", same: "değişiklik yok", chart: "Hedef faiz ve enflasyon", target: "Fed hedef aralığı", path: "Olasılıkların işaret ettiği yol",
      cpi: "TÜFE (CPI, yıllık)", pce: "Çekirdek PCE (yıllık)", today: "bugün", src: "Olasılıklar ve enflasyon: SoSoValue · Hedef faiz: FRED (St. Louis Fed)",
      note: "ABD Merkez Bankası'nın (Fed, FOMC) her gelecek toplantısı için piyasanın (fed funds vadeli işlemleri) her hedef faiz aralığına verdiği olasılık; ilk aralık bugünkü aralıktır, sonrakiler 25'er baz puan yukarıdadır. Kesikli çizgi bu olasılıkların üst sınır için ortalamasıdır. TÜFE (CPI): ABD tüketici fiyatlarının yıllık değişimi; çekirdek PCE: gıda ve enerji hariç, Fed'in izlediği ölçü. Bu sayılar piyasanın fiyatladığı durumu anlatır; bu sitenin tahmini değildir.",
      next: "Sonraki Fed toplantısı: {d} · en olası {r} ({c}) · {p}", more: "Fed ve enflasyon →", unavailable: "Fed verisi yüklenemedi." }
  };
  var CSS = ".fed-card{margin:28px 0 0;padding:18px 20px;border-radius:16px;background:var(--panel);--fed-pce:#a78bfa}" +
    ":root[data-theme=light] .fed-card{--fed-pce:#6d4fd1}@media(prefers-color-scheme:light){:root:not([data-theme]) .fed-card{--fed-pce:#6d4fd1}}" +
    ".fed-card h2{display:flex;align-items:center;margin:0;font-size:20px;letter-spacing:-.3px}.fed-sub{margin:4px 0 14px;color:var(--muted);font-size:13px}" +
    ".fed-grid{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.15fr);gap:22px}@media(max-width:900px){.fed-grid{grid-template-columns:minmax(0,1fr)}}" +
    ".fed-card h3{margin:0 0 10px;color:var(--muted);font-size:11px;font-weight:700;letter-spacing:.05em;text-transform:uppercase}" +
    ".fed-row{display:grid;grid-template-columns:74px minmax(0,1fr);gap:4px 10px;align-items:center;padding:6px 0;border-top:1px solid var(--line);font-size:12.5px}" +
    ".fed-row:first-of-type{border-top:0}.fed-row b{font-weight:600;white-space:nowrap}.fed-bar{display:flex;height:14px;overflow:hidden;border-radius:4px;background:var(--raise)}" +
    ".fed-bar i{display:block;height:100%}.fed-row small{grid-column:2;color:var(--muted);font-size:11.5px}.fed-row small strong{color:var(--fg);font-weight:600}" +
    ".fed-legend{display:flex;flex-wrap:wrap;gap:4px 12px;margin:10px 0 0;color:var(--muted);font-size:11px}.fed-legend span{display:inline-flex;align-items:center;gap:5px}" +
    ".fed-legend i{display:inline-block;width:12px;height:8px;border-radius:2px}.fed-svg{display:block;width:100%;height:auto}" +
    ".fed-svg text{fill:var(--muted);font:10px Inter,system-ui,sans-serif}.fed-src{margin:14px 0 0;color:var(--muted);font-size:11.5px}" +
    ".fed-line{margin:10px 0 0;font-size:13px;color:var(--muted)}.fed-line a{color:var(--accent);font-weight:600;text-decoration:none}.fed-line[hidden],.fed-card[hidden]{display:none}";
  function w() { return W[document.documentElement.lang === "tr" ? "tr" : "en"]; }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function loc() { return document.documentElement.lang === "tr" ? "tr-TR" : "en-US"; }
  function n2(v) { return v.toLocaleString(loc(), { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function pctTxt(v, d) { var t = v.toLocaleString(loc(), { minimumFractionDigits: d == null ? 1 : d, maximumFractionDigits: d == null ? 1 : d }); return document.documentElement.lang === "tr" ? "%" + t : t + "%"; }
  function day(d, opts) { return new Date(d + "T00:00:00Z").toLocaleDateString(loc(), Object.assign({ timeZone: "UTC", day: "numeric", month: "short" }, opts || {})); }
  // Range of position i: from the current lower bound when FRED answered, else "+25 bp" style.
  function rangeOf(cur, i) { if (!cur) return i ? "+" + i * 25 + " bp" : w().same; var lo = cur.lower + 0.25 * i; return document.documentElement.lang === "tr" ? "%" + n2(lo) + "–" + n2(lo + 0.25) : n2(lo) + "–" + n2(lo + 0.25) + "%"; }
  function change(i) { return i ? "+" + i * 25 + " bp" : w().same; }
  // The current range grey, then one clearly different colour per 25 bp step.
  var COLORS = ["color-mix(in srgb,var(--muted) 55%,transparent)", "color-mix(in srgb,var(--accent) 45%,transparent)", "var(--accent)", "var(--cz)", "var(--fed-pce)", "var(--down)", "var(--fg)"];
  function color(i) { return COLORS[Math.min(i, COLORS.length - 1)]; }
  function top(probs) { var k = 0; probs.forEach(function (p, i) { if (p > probs[k]) k = i; }); return k; }
  var data = null, failed = false;

  function chart(d) {
    var target = d.target || [], cpi = d.cpi || [], pce = d.corePce || [], meetings = d.meetings || [], cur = target[target.length - 1];
    var X0 = Date.UTC(2021, 0, 1), last = meetings.length ? Date.parse(meetings[meetings.length - 1].date) : Date.now(), X1 = last + 30 * 864e5, now = Date.now();
    var vals = [6]; cpi.concat(pce).forEach(function (r) { vals.push(r.actual); }); target.forEach(function (r) { vals.push(r.upper); });
    var narrow = window.innerWidth < 600, Y1 = Math.ceil(Math.max.apply(null, vals) / 2) * 2, Wd = narrow ? 380 : 640, H = narrow ? 230 : 250, L = 34, R = 8, T = 10, B = 22;
    var x = function (t) { return L + (t - X0) / (X1 - X0) * (Wd - L - R); }, y = function (v) { return T + (1 - v / Y1) * (H - T - B); };
    var s = '<svg class="fed-svg" viewBox="0 0 ' + Wd + " " + H + '" role="img" aria-label="' + esc(w().chart) + '">';
    for (var v = 0; v <= Y1; v += 2) s += '<line x1="' + L + '" x2="' + (Wd - R) + '" y1="' + y(v) + '" y2="' + y(v) + '" stroke="var(--line)" stroke-width="1"/><text x="' + (L - 6) + '" y="' + (y(v) + 3) + '" text-anchor="end">' + esc(pctTxt(v, 0)) + "</text>";
    for (var yr = 2021; Date.UTC(yr, 0, 1) <= X1; yr++) { var tx = x(Date.UTC(yr, 0, 1)); s += '<line x1="' + tx + '" x2="' + tx + '" y1="' + T + '" y2="' + (H - B) + '" stroke="var(--line)" stroke-dasharray="2 4"/><text x="' + (tx + 3) + '" y="' + (H - 7) + '">' + yr + "</text>"; }
    // Target range: a band between the bounds, stepping on each decision, up to today.
    if (target.length) {
      var up = [], lo = [];
      target.forEach(function (r, i) { var t = Math.max(X0, Date.parse(r.date)), tn = i + 1 < target.length ? Date.parse(target[i + 1].date) : now; up.push([x(t), y(r.upper)], [x(tn), y(r.upper)]); lo.push([x(t), y(r.lower)], [x(tn), y(r.lower)]); });
      var pts = up.concat(lo.reverse()).map(function (p) { return p[0].toFixed(1) + "," + p[1].toFixed(1); }).join(" ");
      s += '<polygon points="' + pts + '" fill="color-mix(in srgb,var(--accent) 30%,transparent)" stroke="var(--accent)" stroke-width="1.2"/>';
    }
    // Implied path: the probability-weighted upper bound at each meeting, from today's.
    if (cur && meetings.length) {
      var path = [[x(now), y(cur.upper)]], dots = "";
      meetings.forEach(function (m) { var e = cur.upper; m.probs.forEach(function (p, i) { e += p / 100 * 0.25 * i; }); var px = x(Date.parse(m.date)), py = y(e); path.push([px, py]);
        dots += '<circle cx="' + px.toFixed(1) + '" cy="' + py.toFixed(1) + '" r="3" fill="var(--accent)"><title>' + esc(day(m.date, { year: "numeric" }) + " · " + pctTxt(e, 2)) + "</title></circle>"; });
      s += '<polyline points="' + path.map(function (p) { return p[0].toFixed(1) + "," + p[1].toFixed(1); }).join(" ") + '" fill="none" stroke="var(--accent)" stroke-width="1.6" stroke-dasharray="5 4"/>' + dots;
    }
    function line(rows, col) { var p = rows.filter(function (r) { return Date.parse(r.date) >= X0; }).map(function (r) { return x(Date.parse(r.date)).toFixed(1) + "," + y(r.actual).toFixed(1); }).join(" "); return p ? '<polyline points="' + p + '" fill="none" stroke="' + col + '" stroke-width="1.6" stroke-linejoin="round"/>' : ""; }
    s += line(cpi, "var(--cz)") + line(pce, "var(--fed-pce)");
    var tn2 = x(now); s += '<line x1="' + tn2 + '" x2="' + tn2 + '" y1="' + T + '" y2="' + (H - B) + '" stroke="var(--fg)" stroke-opacity=".35"/><text x="' + (tn2 + 3) + '" y="' + (T + 9) + '">' + esc(w().today) + "</text>";
    return s + "</svg>";
  }
  function legend(items) { return '<p class="fed-legend">' + items.map(function (it) { return '<span><i style="background:' + it[1] + (it[2] ? ";height:2px" : "") + '"></i>' + esc(it[0]) + "</span>"; }).join("") + "</p>"; }

  function renderCard(el) {
    var t = w();
    if (!data) { if (failed) { el.hidden = false; el.innerHTML = '<p class="fed-sub">' + esc(t.unavailable) + "</p>"; } return; }
    var target = data.target || [], cur = target[target.length - 1], meetings = data.meetings || [], used = 0;
    meetings.forEach(function (m) { m.probs.forEach(function (p, i) { if (p > 0 && i + 1 > used) used = i + 1; }); });
    var rows = meetings.map(function (m) {
      var k = top(m.probs), bar = m.probs.map(function (p, i) { return p > 0 ? '<i style="width:' + p + "%;background:" + color(i) + '" title="' + esc(rangeOf(cur, i) + " · " + pctTxt(p)) + '"></i>' : ""; }).join("");
      return '<div class="fed-row"><b>' + esc(day(m.date, { year: "2-digit" })) + '</b><div class="fed-bar" role="img" aria-label="' + esc(m.probs.map(function (p, i) { return rangeOf(cur, i) + " " + pctTxt(p); }).join(", ")) + '">' + bar +
        "</div><small>" + esc(t.likely) + ": <strong>" + esc(rangeOf(cur, k)) + "</strong>" + (cur ? " (" + esc(change(k)) + ")" : "") + " · " + esc(pctTxt(m.probs[k])) + "</small></div>";
    }).join("");
    var keys = []; for (var i = 0; i < Math.max(used, 1); i++) keys.push([rangeOf(cur, i), color(i)]);
    el.innerHTML = '<h2 id="fed-title">' + esc(t.title) + "</h2>" + '<p class="fed-sub">' + (cur ? esc(t.now.replace("{r}", rangeOf(cur, 0)).replace("{d}", day(cur.date, { year: "numeric" }))) : "") + "</p>" +
      '<p data-tip="#fed-title" id="fed-note">' + esc(t.note) + "</p>" +
      '<div class="fed-grid"><div><h3>' + esc(t.meetings) + "</h3>" + rows + legend(keys) + "</div>" +
      "<div><h3>" + esc(t.chart) + "</h3>" + chart(data) + legend([[t.target, "color-mix(in srgb,var(--accent) 40%,transparent)"], [t.path, "var(--accent)", 1], [t.cpi, "var(--cz)", 1], [t.pce, "var(--fed-pce)", 1]]) + "</div></div>" +
      '<p class="fed-src">' + esc(t.src) + "</p>";
    el.hidden = false;
    if (window.InfoTip) InfoTip.scan(el);
  }
  function renderLine(el) {
    var m = data && data.meetings && data.meetings[0]; if (!m) { el.hidden = true; return; }
    var t = w(), target = data.target || [], cur = target[target.length - 1], k = top(m.probs);
    el.innerHTML = esc(t.next.replace("{d}", day(m.date)).replace(" ({c})", cur ? " ({c})" : "").replace("{r}", rangeOf(cur, k)).replace("{c}", change(k)).replace("{p}", pctTxt(m.probs[k]))) + ' · <a href="weekly-events.html#fed">' + esc(t.more) + "</a>";
    el.hidden = false;
  }
  function render() {
    document.querySelectorAll('[data-fed="card"]').forEach(renderCard);
    document.querySelectorAll('[data-fed="line"]').forEach(renderLine);
  }
  var style = document.createElement("style"); style.textContent = CSS; document.head.appendChild(style);
  if (!document.querySelector("[data-fed]")) return;
  fetch("/api/fed").then(function (r) { return r.ok ? r.json() : null; }).then(function (d) {
    if (d && Array.isArray(d.meetings) && d.meetings.length) data = d; else failed = true;
    render();
    if (data && location.hash === "#fed") { var c = document.getElementById("fed"); if (c) c.scrollIntoView(); }
  }).catch(function () { failed = true; render(); });
  new MutationObserver(render).observe(document.documentElement, { attributes: true, attributeFilter: ["lang"] });
})();
