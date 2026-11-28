/* Squarified treemap (README "Market heat map"): Treemap.layout(weights, width, height) → [{ x, y, w, h }] in the
   order of the weights, each rectangle's area proportional to its weight, as close to square as it can be
   (Bruls, Huizing and van Wijk). Weights ≤ 0 get an empty rectangle. Works in browsers and in Node (module.exports). */
(function (root) {
  "use strict";
  function worst(row, side) {
    var s = 0, mx = 0, mn = Infinity;
    for (var i = 0; i < row.length; i++) { s += row[i].a; if (row[i].a > mx) mx = row[i].a; if (row[i].a < mn) mn = row[i].a; }
    var s2 = s * s, side2 = side * side;
    return Math.max(side2 * mx / s2, s2 / (side2 * mn));
  }
  function layout(weights, width, height) {
    var out = weights.map(function () { return { x: 0, y: 0, w: 0, h: 0 }; });
    var total = 0;
    weights.forEach(function (v) { if (v > 0) total += v; });
    if (!(total > 0) || !(width > 0) || !(height > 0)) return out;
    var scale = width * height / total;
    var items = weights.map(function (v, i) { return { i: i, a: v > 0 ? v * scale : 0 }; })
      .filter(function (it) { return it.a > 0; }).sort(function (p, q) { return q.a - p.a; });
    var x = 0, y = 0, w = width, h = height, row = [];
    function place() {
      var s = 0; row.forEach(function (it) { s += it.a; });
      if (w >= h) { // a column on the left
        var cw = s / h, cy = y;
        row.forEach(function (it) { var rh = it.a / cw; out[it.i] = { x: x, y: cy, w: cw, h: rh }; cy += rh; });
        x += cw; w -= cw;
      } else { // a row at the top
        var rh2 = s / w, cx = x;
        row.forEach(function (it) { var rw = it.a / rh2; out[it.i] = { x: cx, y: y, w: rw, h: rh2 }; cx += rw; });
        y += rh2; h -= rh2;
      }
      row = [];
    }
    var k = 0;
    while (k < items.length) {
      var side = Math.min(w, h), it = items[k];
      if (!row.length || worst(row.concat([it]), side) <= worst(row, side)) { row.push(it); k++; }
      else place();
    }
    if (row.length) place();
    return out;
  }
  var api = { layout: layout };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.Treemap = api;
})(this);
