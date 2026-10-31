/* Glide Inside v4 framework behaviour. No dependencies. */
(function () {
  var cfg = window.GI_CONFIG || {};
  // data-cfg="key" fills text; data-cfg-href="key" sets links
  document.querySelectorAll("[data-cfg]").forEach(function (el) { var v = cfg[el.dataset.cfg]; if (v != null) el.textContent = v; });
  var fs = document.querySelector('script[src*="framework.js"]'), root = fs ? fs.src.replace(/framework\.js.*$/, "") : "";
  document.querySelectorAll("[data-cfg-href]").forEach(function (el) { var v = cfg[el.dataset.cfgHref]; if (!v) return; if (!/^(https?:|mailto:|tel:|#)/.test(v)) v = new URL(v, root || location.href).href; if (el.dataset.template) { var u = new URL(v, location.href); u.searchParams.set("template", el.dataset.template); v = u.href; } el.setAttribute("href", v); el.removeAttribute("aria-disabled"); });
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
  // add-ons: [data-addons] with input[data-addon=fly|renders], [data-total], a.btn[data-pay], [data-pay-note]
  document.querySelectorAll("[data-addons]").forEach(function (root) {
    var prices = { fly: cfg.addonFlyThroughPrice || 0, renders: cfg.addonRendersPrice || 0 };
    var links = { fly: cfg.stripeFlyThrough, renders: cfg.stripeRenders, both: cfg.stripeBoth };
    var total = root.querySelector("[data-total]"), pay = root.querySelector("[data-pay]"), note = root.querySelector("[data-pay-note]");
    function upd() {
      var f = root.querySelector('[data-addon=fly]').checked, r = root.querySelector('[data-addon=renders]').checked;
      var sum = (f ? prices.fly : 0) + (r ? prices.renders : 0);
      total.textContent = "A$" + sum;
      var url = f && r ? links.both : f ? links.fly : r ? links.renders : "";
      if (url) { pay.href = url; pay.setAttribute("aria-disabled", "false"); note.textContent = "Secure card payment by Stripe."; }
      else { pay.removeAttribute("href"); pay.setAttribute("aria-disabled", "true"); note.textContent = !f && !r ? "Choose an add-on." : "Payment link not set up yet."; }
    }
    root.addEventListener("change", upd); upd();
  });
  // reveal on scroll
  if ("IntersectionObserver" in window && !matchMedia("(prefers-reduced-motion: reduce)").matches) {
    document.documentElement.classList.add("js");
    var io = new IntersectionObserver(function (es) { es.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); } }); }, { threshold: .12 });
    document.querySelectorAll(".section-head,.card,.steps li,.faq details,.product-card").forEach(function (el) { el.classList.add("reveal"); io.observe(el); });
  }
})();
