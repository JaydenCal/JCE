/* Glide Inside tracking. No dependencies. Loaded on every site page.
   Does nothing except UTM passthrough unless GI_CONFIG.ga4Id is set. Setup steps: docs/marketing/TRACKING.md.
   Events sent to GA4: book_demo, design_started, purchase, generate_lead, start_design_click, plus the app events forwarded from the framed app
   (app_opened, lot_loaded, house_placed, ps_profile_*, ps_share_*, ps_export, ps_upgrade_click, ps_checkout_*, ps_template_selected, ps_project_saved).
   Privacy (24/11/2026): page_location and page_referrer are cleaned (origin, path and a short allow list of plain query values; never ?address=),
   event values are checked, a checkout.stripe.com referrer is dropped, and ?gi_internal=1 tags the browser as internal exactly as src/ui/ga.js does. */
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

  /* ---- Privacy: what may leave the browser (same rules as src/ui/ga.js) ---- */
  var KEEP_PARAMS = { embed: 1, mode: 1, sample: 1, template: 1, view: 1, utm_source: 1, utm_medium: 1, utm_campaign: 1, utm_term: 1, utm_content: 1 };
  function cleanLocation(href) {
    try {
      var u = new URL(href, location.href), keep = new URLSearchParams();
      u.searchParams.forEach(function (v, k) { if (KEEP_PARAMS[k] && /^[a-z0-9_.-]{1,60}$/i.test(v)) keep.set(k, v); });
      var q = keep.toString();
      return u.origin + u.pathname + (q ? "?" + q : "");
    } catch (e) { return ""; }
  }
  function cleanReferrer(ref) {
    try {
      if (!ref) return "";
      var u = new URL(ref);
      if (u.hostname === "checkout.stripe.com") return ""; // Stripe must not take over attribution on the return from checkout
      return u.origin + u.pathname;
    } catch (e) { return ""; }
  }
  /* Any string value that looks like a page address is cut to origin and path; keys that could hold personal text are dropped. */
  var BAD_KEY = /address|street|email|phone|name$|^q$|query|search/i;
  function scrub(params) {
    var out = {};
    Object.keys(params || {}).forEach(function (k) {
      var v = params[k];
      if (BAD_KEY.test(k) && !/^(item_name|link_text)$/.test(k)) return;
      if (typeof v === "string") {
        if (/^https?:\/\//i.test(v)) v = cleanLocation(v);
        else if (/[?&](address|street|q|query)=/i.test(v)) v = v.split(/[?#]/)[0];
        else if (k === "link_text") v = v.slice(0, 60);
      }
      out[k] = v;
    });
    return out;
  }
  /* Internal traffic: ?gi_internal=1 tags this browser (localStorage, as in ga.js), ?gi_internal=0 clears it, automated browsers count as internal. */
  var internal = (function () {
    try {
      var f = new URLSearchParams(location.search).get("gi_internal");
      if (f === "1") set("localStorage", "gi_internal", "1");
      else if (f === "0") { try { window.localStorage.removeItem("gi_internal"); } catch (e) {} }
    } catch (e) {}
    if (get("localStorage", "gi_internal") === "1") return true;
    try { return navigator.webdriver === true; } catch (e) { return false; }
  })();
  var pageLoc = cleanLocation(location.href), pageRef = cleanReferrer(document.referrer);
  var viaApp = /\/plan-studio\/app\/(index\.html)?$/.test(location.pathname); // the app page reports for itself through src/ui/ga.js

  if (!framed && !viaApp) {
    window.dataLayer = window.dataLayer || [];
    window.gtag = window.gtag || function () { window.dataLayer.push(arguments); };
    window.gtag("js", new Date());
    var base = { page_location: pageLoc, page_referrer: pageRef };
    if (internal) base.traffic_type = "internal";
    window.gtag("set", base); // later events of this page use the cleaned address too, never the raw one
    window.gtag("config", gaId, base);
    if (adsId) window.gtag("config", adsId);
    // The gtag library (about 180 KB) is added as an async script once this deferred file runs (after the HTML is parsed),
    // so it never blocks the first paint but still loads early enough that quick visits and fast clicks from ads are counted.
    // Commands queued above are replayed when it arrives. Updated 23/11/2026.
    var s = document.createElement("script");
    s.async = true; s.src = "https://www.googletagmanager.com/gtag/js?id=" + encodeURIComponent(gaId);
    document.head.appendChild(s);
  }

  function send(name, params) {
    if (framed || viaApp || !window.gtag) return;
    var p = scrub(params);
    if (internal) p.traffic_type = "internal";
    window.gtag("event", name, p);
  }
  window.giTrack = send;

  /* ---- CONCIERGE: AI booking assistant events (added 15/11/2026, marked so the block is easy to find or remove) ----
     Fixed event names and a fixed parameter schema. Every value is checked against a list or a strict pattern, so no name, email, phone,
     chat text or booking reference can be sent even by mistake. `dedupe` is used for once-per-session events and is never sent. */
  var BK_ENUM = {
    booking_type: ["homeowner", "builder", "developer", "agent"],
    intent: ["homeowner", "builder", "developer", "agent"],
    qualifier: ["house", "granny", "unsure", "custom", "volume", "other", "commercial", "subdivision", "both", "land", "homes"],
    slot_count: ["none", "1_10", "11_30", "30_plus"],
    target: ["enquiry", "demo", "tool"],
    reason: ["slot_taken", "not_confirmed", "rate_limited", "expired", "other", "slots_calendar", "slots_error", "callback_error"]
  };
  var BK_EVENTS = {
    booking_agent_opened: ["page_path"],
    booking_agent_intent_selected: ["intent", "page_path"],
    booking_agent_qualification_completed: ["intent", "qualifier", "page_path"],
    booking_slots_viewed: ["booking_type", "slot_count"],
    booking_agent_booking_attempt: ["booking_type"],
    booking_agent_booking_confirmed: ["booking_type"],
    booking_agent_callback_requested: ["intent", "page_path"], /* default flow (owner decision 15/11/2026): sent only after the server accepted the request, once per request */
    booking_agent_booking_failed: ["booking_type", "reason"],
    booking_agent_handoff_requested: ["target", "page_path"]
  };
  var bkSent = {};
  window.giTrackBooking = function (name, params) {
    var allowed = BK_EVENTS[name];
    if (!allowed) return false;
    params = params || {};
    if (params.dedupe) {
      var dk = "gi_ev_" + String(params.dedupe).slice(0, 80);
      if (bkSent[dk] || get("sessionStorage", dk)) return false;
      bkSent[dk] = 1; set("sessionStorage", dk, "1");
    }
    var out = {}, i, k, v;
    for (i = 0; i < allowed.length; i++) {
      k = allowed[i]; v = params[k];
      if (v === undefined || v === null) continue;
      v = String(v);
      if (k === "page_path") { if (/^\/[a-z0-9\/_.-]{0,59}$/i.test(v)) out[k] = v; }
      else if (BK_ENUM[k] && BK_ENUM[k].indexOf(v) !== -1) out[k] = v;
    }
    Object.keys(utm).forEach(function (u) { out[u] = utm[u]; }); // attribution only
    send(name, out);
    return true;
  };
  /* ---- end CONCIERGE ---- */

  function priceNumber(v, d) { var n = parseFloat(String(v == null ? "" : v).replace(/[^0-9.]/g, "")); return isFinite(n) && n > 0 ? n : d; }
  var PLAN_PRICE = priceNumber(cfg.planPackPrice, 30);

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
  /* Events forwarded from the framed app. Same checks as mapEvent in src/ui/ga.js. The framed app never reports itself (isStandalonePage is false there),
     so each event is counted once, here. design_started goes through the once per session gate above. */
  var FORWARD = { app_opened: 1, lot_loaded: 1, house_placed: 1, ps_profile_prompt: 1, ps_profile_signup: 1, ps_template_selected: 1, ps_project_saved: 1,
    ps_share_copy: 1, ps_share_open: 1, ps_export: 1, ps_upgrade_click: 1, ps_checkout_started: 1, ps_checkout_completed: 1 };
  var PLAIN = /^[a-z0-9_.-]{1,40}$/i;
  function tok(v, list) { v = String(v == null ? "" : v).toLowerCase(); if (list) return list.indexOf(v) !== -1 ? v : null; return PLAIN.test(v) ? v : null; }
  function yn(v) { return v === true || v === "yes" ? "yes" : v === false || v === "no" ? "no" : null; }
  function whole(v, max) { var n = Math.round(Number(v)); return isFinite(n) && n >= 0 ? Math.min(n, max) : null; }
  function defd(o) { var r = {}; Object.keys(o).forEach(function (k) { if (o[k] != null) r[k] = o[k]; }); return r; }
  function once(key) {
    if (bkSent[key] || get("localStorage", key) || get("sessionStorage", key)) return false;
    bkSent[key] = 1; set("localStorage", key, "1"); set("sessionStorage", key, "1");
    return true;
  }
  function withUtm(p) { Object.keys(utm).forEach(function (k) { p[k] = utm[k]; }); return p; }
  function mapApp(name, p) {
    p = p && typeof p === "object" ? p : {};
    switch (name) {
      case "app_opened": return [["app_opened", defd({ entry: tok(p.entry, ["phone", "desktop"]), from: tok(p.from, ["home_search", "sample", "direct"]) })]];
      case "lot_loaded": return [["lot_loaded", defd({ result: p.success === false ? "fail" : "success", ms: whole(p.ms, 600000), sample: yn(p.sample) })]];
      case "house_placed": return [["house_placed", defd({ sample: yn(p.sample) })]];
      case "ps_profile_prompt": return [["ps_profile_prompt", defd({ reason: tok(p.reason), card: tok(p.card, ["compact", "full"]) })]];
      case "ps_profile_signup": {
        var o = [["ps_profile_signup", defd({ marketing: yn(p.marketing) })]];
        if (once("gi_lead_profile")) o.push(["generate_lead", withUtm({ lead_type: "free_profile", method: "app" })]);
        return o;
      }
      case "ps_template_selected": return [["ps_template_selected", defd({ item_id: tok(p.id) })]];
      case "ps_project_saved": case "ps_share_copy": case "ps_share_open": case "ps_checkout_started": return [[name, {}]];
      case "ps_export": return [["ps_export", defd({ export_type: tok(p.type) })]];
      case "ps_upgrade_click": return [["ps_upgrade_click", defd({ source: tok(p.source) })]];
      case "ps_checkout_completed": {
        var id = typeof p.sessionId === "string" && /^[A-Za-z0-9_-]{6,120}$/.test(p.sessionId) ? p.sessionId : null;
        var out = [["ps_checkout_completed", {}]];
        if (id && once("gi_purchase_" + id.slice(0, 80))) out.push(["purchase", withUtm({ transaction_id: id, value: PLAN_PRICE, currency: "AUD", items: [{ item_id: "plan_pack", item_name: "Glide Inside Plan Pack", price: PLAN_PRICE, quantity: 1 }] })]);
        return out;
      }
    }
    return [];
  }
  function onAppEvent(name, props) {
    if (!name) return;
    if (name === "design_started") { designStarted(tok(props && props.method) || "edit", props && props.template ? { template: tok(props.template) || "none" } : null); return; }
    if (STARTERS[name]) designStarted(name, props && props.id ? { template: props.id } : null);
    if (FORWARD[name]) mapApp(name, props).forEach(function (g) { send(g[0], g[1]); });
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
    var addon = q.get("addon"), value = PLAN_PRICE, name = "Glide Inside Plan Pack", id = "plan_pack";
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
    if (/book-a-demo\/?(\?|#|$)/i.test(h)) { send("book_demo", { page: location.pathname, button: "book_demo", link_text: (a.textContent || "").trim().slice(0, 60) }); }
    if (/^mailto:/i.test(h)) {
      // "Book a demo" and "Register interest" buttons (builder accounts): their own event, plus the generic lead below.
      var label = (a.textContent || "").trim();
      if (/builder(Demo|Interest)Url/.test(a.getAttribute("data-cfg-href") || "") || /book a demo|register interest/i.test(label)) {
        send("book_demo", { page: location.pathname, button: /interest/i.test(label + h) ? "register_interest" : "book_demo", link_text: label.slice(0, 60) });
      }
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

/* Book a demo click tracking (11/11/2026, kept from the live copy) */
document.addEventListener('click', function (e) {
  var el = e.target.closest && e.target.closest('.js-book-demo');
  if (!el || typeof gtag !== 'function') return;
  gtag('event', 'book_demo_click', { page_path: location.pathname });
});
