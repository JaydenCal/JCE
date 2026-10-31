/* Glide Inside tracking. No dependencies. Loaded on every site page.
   Does nothing except UTM passthrough unless GI_CONFIG.ga4Id is set. Setup steps: docs/marketing/TRACKING.md.
   Events sent to GA4: design_started, purchase, generate_lead, start_design_click, plus ps_template_selected,
   ps_upgrade_click, ps_checkout_started and ps_export forwarded from the app. */
(function () {
  "use strict";
  var cfg = window.GI_CONFIG || {};
  var UTM_KEYS = ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content"];

  function store(kind) { try { return window[kind]; } catch (e) { return null; } }
  function get(kind, k) { try { var s = store(kind); return s ? s.getItem(k) : null; } catch (e) { return null; } }
  function set(kind, k, v) { try { var s = store(kind); if (s) s.setItem(k, v); } catch (e) {} }

  /* ---- UTM capture (first touch of the session) and passthrough on internal links ---- */
  var utm = {};
  (function () {
    var q = new URLSearchParams(location.search), found = false, k, i;
    for (i = 0; i < UTM_KEYS.length; i++) { k = UTM_KEYS[i]; if (q.get(k)) { utm[k] = q.get(k).slice(0, 100); found = true; } }
    if (found) { var s = JSON.stringify(utm); set("sessionStorage", "gi_utm", s); set("localStorage", "gi_utm", JSON.stringify({ t: Date.now(), v: utm })); return; }
    try {
      var saved = get("sessionStorage", "gi_utm");
      if (saved) { utm = JSON.parse(saved) || {}; return; }
      var ls = JSON.parse(get("localStorage", "gi_utm") || "null");
      if (ls && ls.v && Date.now() - ls.t < 7 * 864e5) utm = ls.v;
    } catch (e) { utm = {}; }
  })();

  function decorateLinks() {
    var keys = Object.keys(utm);
    if (!keys.length) return;
    document.querySelectorAll("a[href]").forEach(function (a) {
      var h = a.getAttribute("href");
      if (!h || /^(mailto:|tel:|#|javascript:)/i.test(h)) return;
      var u; try { u = new URL(a.href, location.href); } catch (e) { return; }
      if (u.origin !== location.origin) return;
      if (/\.(pdf|zip|png|jpe?g|webp|svg|mp4|xml|txt)$/i.test(u.pathname)) return;
      var changed = false;
      keys.forEach(function (k) { if (!u.searchParams.has(k)) { u.searchParams.set(k, utm[k]); changed = true; } });
      if (changed) a.setAttribute("href", u.pathname + u.search + u.hash);
    });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", function () { decorateLinks(); setTimeout(decorateLinks, 0); });
  else { decorateLinks(); setTimeout(decorateLinks, 0); }
  window.addEventListener("load", decorateLinks); // after framework.js has set data-cfg-href links

  /* ---- Everything below needs a GA4 id ---- */
  var gaId = cfg.ga4Id;
  if (!gaId) return;
  // Inside an iframe (the app within the launch page) the parent page reports. Avoid double counting.
  var framed = false; try { framed = window.parent !== window; } catch (e) { framed = true; }

  var adsId = cfg.adsConversion ? String(cfg.adsConversion).split("/")[0] : "";
  if (!framed) {
    window.dataLayer = window.dataLayer || [];
    window.gtag = window.gtag || function () { window.dataLayer.push(arguments); };
    window.gtag("js", new Date());
    window.gtag("config", gaId);
    if (adsId) window.gtag("config", adsId);
    var s = document.createElement("script");
    s.async = true; s.src = "https://www.googletagmanager.com/gtag/js?id=" + encodeURIComponent(gaId);
    document.head.appendChild(s);
  }

  function send(name, params) {
    if (framed || !window.gtag) return;
    window.gtag("event", name, params || {});
  }
  window.giTrack = send;

  function priceNumber(v, d) { var n = parseFloat(String(v == null ? "" : v).replace(/[^0-9.]/g, "")); return isFinite(n) && n > 0 ? n : d; }
  var PLAN_PRICE = priceNumber(cfg.planPackPrice, 35);

  /* ---- design_started: first meaningful edit, once per session ---- */
  function templateId() { try { return new URLSearchParams(location.search).get("template") || ""; } catch (e) { return ""; } }
  function designStarted(method, extra) {
    if (get("sessionStorage", "gi_ds")) return;
    set("sessionStorage", "gi_ds", "1");
    var p = { method: method, template: (extra && extra.template) || templateId() || "none" };
    send("design_started", p);
  }
  // Events the app raises that count as starting a design (a template pick alone does not).
  var STARTERS = { ps_design_type: 1, ps_ai_request: 1, ps_project_saved: 1, ps_export: 1 };
  var FORWARD = { ps_template_selected: 1, ps_upgrade_click: 1, ps_checkout_started: 1, ps_export: 1 };
  function onAppEvent(name, props) {
    if (!name) return;
    if (STARTERS[name]) designStarted(name, props && props.id ? { template: props.id } : null);
    if (FORWARD[name]) {
      var fp = {};
      if (props && props.id) fp.item_id = String(props.id).slice(0, 60);
      if (props && props.type) fp.export_type = String(props.type).slice(0, 20);
      send(name, fp);
    }
  }
  // The real edit signal: the app's store emits "history" after every change; canUndo is true after the first edit.
  function watchStore(win) {
    var tries = 0;
    (function poll() {
      var ps; try { ps = win.__ps; } catch (e) { return; } // cross origin: fall back to forwarded events only
      if (ps && ps.store && typeof ps.store.on === "function") {
        ps.store.on("history", function (h) { if (h && h.canUndo) designStarted("edit"); });
        return;
      }
      if (++tries < 120) setTimeout(poll, 500);
    })();
  }

  // Same window (the app page itself): CustomEvent.
  window.addEventListener("ps:analytics", function (e) { var d = e.detail || {}; onAppEvent(d.event, d.props); });
  if (!framed && (window.__ps || /\/plan-studio\/app\/(index\.html)?$/.test(location.pathname))) watchStore(window);
  // Embedded app: postMessage to this parent page.
  window.addEventListener("message", function (e) {
    if (e.origin !== location.origin || !e.data || typeof e.data !== "object") return;
    if (e.data.type === "ps:analytics") onAppEvent(e.data.event, e.data.props);
    if (e.data.type === "ps:ready") {
      var fr = document.querySelectorAll("iframe");
      for (var i = 0; i < fr.length; i++) { if (fr[i].contentWindow === e.source) { watchStore(fr[i].contentWindow); break; } }
    }
  });

  /* ---- purchase: checkout success return, once per Stripe session id ---- */
  (function () {
    var q = new URLSearchParams(location.search);
    if (q.get("checkout") !== "success") return;
    var sid = q.get("session_id");
    if (!sid) return;
    var key = "gi_purchase_" + sid.slice(0, 80);
    if (get("localStorage", key) || get("sessionStorage", key)) return;
    set("localStorage", key, "1"); set("sessionStorage", key, "1");
    var addon = q.get("addon"), value = PLAN_PRICE, name = "Pocket Architect Plan Pack", id = "plan_pack";
    var fly = priceNumber(cfg.addonFlyThroughPrice, 10), ren = priceNumber(cfg.addonRendersPrice, 10);
    if (addon === "fly") { value = fly; name = "3D fly-through"; id = "addon_fly_through"; }
    else if (addon === "renders") { value = ren; name = "Complex renderings"; id = "addon_renders"; }
    else if (addon === "both") { value = fly + ren; name = "3D fly-through and complex renderings"; id = "addon_both"; }
    var p = { transaction_id: sid, value: value, currency: "AUD", items: [{ item_id: id, item_name: name, price: value, quantity: 1 }] };
    Object.keys(utm).forEach(function (k) { p[k] = utm[k]; });
    send("purchase", p);
    if (cfg.adsConversion && window.gtag) window.gtag("event", "conversion", { send_to: cfg.adsConversion, value: value, currency: "AUD", transaction_id: sid });
  })();

  /* ---- generate_lead on mailto clicks; start_design_click on links into the tool ---- */
  document.addEventListener("click", function (e) {
    var a = e.target && e.target.closest ? e.target.closest("a[href]") : null;
    if (!a) return;
    var h = a.getAttribute("href") || "";
    if (/^mailto:/i.test(h)) {
      var type = /subdivision/i.test(h) ? "subdivision_quote" : /pocket/i.test(h) ? "pocket_architect_enquiry" : /@/.test(h) && !/subject=/i.test(h) ? "email_link" : "general_enquiry";
      var p = { lead_type: type, method: "mailto", link_text: (a.textContent || "").trim().slice(0, 60), page_path: location.pathname };
      Object.keys(utm).forEach(function (k) { p[k] = utm[k]; });
      send("generate_lead", p);
    } else if (/plan-studio\/(launch|app)\//.test(h)) {
      var m = /[?&]template=([a-z0-9_]+)/.exec(h);
      send("start_design_click", { template: m ? m[1] : "none", page_path: location.pathname });
    }
  }, true);
})();
