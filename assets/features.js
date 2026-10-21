/* Who may use which site feature. One place to switch a feature between everyone, premium members
   only, or nobody. There are no accounts yet, so nobody is premium: a "premium" feature shows as locked.
   This only shapes the page; it is not access control (anything drawn in the browser can be captured). */
var Features = (function () {
  var PLAN = {
    chartDownload: "all" // "all" | "premium" | "off"
  };
  function isPremium() { return false; } // hook for the future membership check
  function plan(feature) { return PLAN[feature] || "off"; }
  return {
    plan: plan,
    // "allowed": usable now; "locked": premium-only and this visitor is not premium; "off": hidden.
    state: function (feature) {
      var p = plan(feature);
      if (p === "all" || (p === "premium" && isPremium())) return "allowed";
      return p === "premium" ? "locked" : "off";
    }
  };
})();
