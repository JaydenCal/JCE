/* Glide Inside v4 framework behaviour. No dependencies. */
(function () {
  var cfg = window.GI_CONFIG || {};
  // data-cfg="key" fills text; data-cfg-href="key" sets links
  document.querySelectorAll("[data-cfg]").forEach(function (el) { var v = cfg[el.dataset.cfg]; if (v != null) el.textContent = v; });
  document.querySelectorAll("[data-cfg-href]").forEach(function (el) { var v = cfg[el.dataset.cfgHref]; if (v) el.setAttribute("href", v); });
  // mobile nav
  var t = document.querySelector(".nav-toggle"), n = document.querySelector(".site-nav");
  if (t && n) t.addEventListener("click", function () { var o = n.classList.toggle("open"); t.setAttribute("aria-expanded", o); });
  // tabs: [data-tabs] > [role=tab][data-tab=id]; panels [data-panel=id] anywhere inside the same [data-demo] or [data-tabs] root
  document.querySelectorAll("[data-tabs]").forEach(function (root) {
    var scope = root.closest("[data-demo]") || root;
    root.querySelectorAll("[data-tab]").forEach(function (b) {
      b.setAttribute("role", "tab");
      b.addEventListener("click", function () {
        root.querySelectorAll("[data-tab]").forEach(function (x) { x.setAttribute("aria-selected", x === b); });
        scope.querySelectorAll("[data-panel]").forEach(function (p) { p.hidden = p.dataset.panel !== b.dataset.tab; });
        scope.dispatchEvent(new CustomEvent("gi:tab", { detail: b.dataset.tab }));
      });
    });
  });
  // layer toggles: button[data-layer-toggle=name] shows/hides [data-layer=name] inside the same [data-demo]
  document.querySelectorAll("[data-layer-toggle]").forEach(function (b) {
    var demo = b.closest("[data-demo]");
    b.setAttribute("aria-pressed", b.getAttribute("aria-pressed") || "true");
    b.addEventListener("click", function () {
      var on = b.getAttribute("aria-pressed") !== "true";
      b.setAttribute("aria-pressed", on);
      demo.querySelectorAll('[data-layer="' + b.dataset.layerToggle + '"]').forEach(function (l) { l.classList.toggle("is-off", !on); });
    });
  });
  // click-to-inspect: any [data-info][data-title][data-body] fills .info-card h4/p inside the same demo
  document.querySelectorAll("[data-demo]").forEach(function (demo) {
    var card = demo.querySelector(".info-card"); if (!card) return;
    demo.addEventListener("click", function (e) {
      var el = e.target.closest("[data-info]"); if (!el) return;
      demo.querySelectorAll(".is-active").forEach(function (x) { x.classList.remove("is-active"); });
      el.classList.add("is-active");
      card.querySelector("h4").textContent = el.dataset.title || "";
      card.querySelector("p").textContent = el.dataset.body || "";
      demo.querySelectorAll("[data-kv]").forEach(function (k) { var v = el.dataset[k.dataset.kv]; if (v != null) k.textContent = v; });
    });
  });
})();
