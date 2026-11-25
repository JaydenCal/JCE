/* Glide Inside tracking. No dependencies. Loaded on every site page.
   Does nothing except UTM passthrough unless GI_CONFIG.ga4Id is set. Setup steps: docs/marketing/TRACKING.md.
   Events sent to GA4: book_demo, design_started, purchase, generate_lead, start_design_click, plus the app events forwarded from the embedded
   app (see FORWARD below: app_opened, lot_loaded, house_placed, ps_template_selected, ps_upgrade_click, ps_checkout_started, ps_checkout_completed,
   ps_export, ps_project_saved, ps_share_copy, ps_share_open, ps_profile_prompt, ps_profile_signup). A purchase follows ps_checkout_completed and a
   generate_lead follows ps_profile_signup. When the app is its own top level page (a phone visitor) it reports for itself (src/ui/ga.js).
   Internal traffic: ?gi_internal=1 sets a flag in this browser, ?gi_internal=0 clears it; while it is set every event carries
   traffic_type=internal. See docs/ANALYTICS-INTERNAL.md. */
(function () {
  "use strict";
  var cfg = window.GI_CONFIG || {};
  var UTM_KEYS = ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content"];

  function store(kind) { try { return window[kind]; } catch (e) { return null; } }
  function get(kind, k) { try { var s = store(kind); return s ? s.getItem(k) : null; } catch (e) { return null; } }
  function set(kind, k, v) { try { var s = store(kind); if (s) s.setItem(k, v); } catch (e) {} }
  function del(kind, k) { try { var s = store(kind); if (s) s.removeItem(k); } catch (e) {} }

  /* ---- Internal traffic flag (owner and our own testing). Automated browsers (navigator.webdriver) count as internal as well. ---- */
  var internal = (function () {
    try {
      var q = new URLSearchParams(location.search).get("gi_internal");
      if (q === "1") set("localStorage", "gi_internal", "1");
      else if (q === "0") del("localStorage", "gi_internal");
    } catch (e) {}
    if (get("localStorage", "gi_internal") === "1") return true;
    try { return typeof navigator !== "undefined" && navigator.webdriver === true; } catch (e) { return false; }
  })();

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
  var viaApp = /\/plan-studio\/app\/(index\.html)?$/.test(location.pathname); // the app page reports for itself through src/ui/ga.js, so this file stays quiet there

  var SAFE_Q = { utm_source: 1, utm_medium: 1, utm_campaign: 1, utm_term: 1, utm_content: 1, gclid: 1, gbraid: 1, wbraid: 1, dclid: 1, msclkid: 1, fbclid: 1, template: 1, mode: 1, sample: 1 };
  function safeLocation() {
    try {
      var u = new URL(location.href), keep = new URLSearchParams();
      u.searchParams.forEach(function (v, k) {
        if (!SAFE_Q[k]) return;
        if (/^(utm_|gclid|gbraid|wbraid|dclid|msclkid|fbclid)/.test(k) ? (v.length <= 150 && v.indexOf("@") === -1) : /^[a-z0-9_.-]{1,60}$/i.test(v)) keep.set(k, v);
      });
      var q = keep.toString();
      return u.origin + u.pathname + (q ? "?" + q : "");
    } catch (e) { return location.origin + location.pathname; }
  }
  function safeReferrer(r) { try { if (!r) return ""; var u = new URL(r); if (u.hostname === "checkout.stripe.com") return ""; return u.origin + u.pathname; } catch (e) { return ""; } } // the return from Stripe must not take over attribution

  var adsId = cfg.adsConversion ? String(cfg.adsConversion).split("/")[0] : "";
  if (!framed && !viaApp) {
    window.dataLayer = window.dataLayer || [];
    window.gtag = window.gtag || function () { window.dataLayer.push(arguments); };
    window.gtag("js", new Date());
    // The page address and referrer Google sees keep only a safe list of query parameters (attribution and harmless view switches), so an
    // address, email, share id or checkout reference in a link never reaches Google, on the page view or on any later event.
    var page = { page_location: safeLocation(), page_referrer: safeReferrer(document.referrer) };
    if (internal) page.traffic_type = "internal";
    window.gtag("set", page);
    window.gtag("config", gaId, page);
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
    params = params || {};
    if (internal) params.traffic_type = "internal";
    window.gtag("event", name, params);
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
  // App events forwarded from the embedded app. Only these names, and only the parameters below, each checked against a list or a strict pattern:
  // no address, email or other personal data can be forwarded even by mistake.
  var FORWARD = { app_opened: 1, lot_loaded: 1, house_placed: 1, ps_template_selected: 1, ps_upgrade_click: 1, ps_checkout_started: 1, ps_checkout_completed: 1, ps_export: 1, ps_project_saved: 1, ps_share_copy: 1, ps_share_open: 1, ps_profile_prompt: 1, ps_profile_signup: 1 };
  var WORD = /^[a-z0-9_.-]{1,40}$/i;
  var PHONE_EVENTS = { phone_step_address: 1, phone_lot_loaded: 1, phone_pick_type: 1, phone_house_placed: 1, phone_planset_preview: 1, phone_full_editor: 1, phone_planset_lead_submit: 1, phone_planset_download: 1, planset_lead_submit: 1, planset_download: 1 };
  function word(v, list) { var t = String(v == null ? "" : v).toLowerCase(); return list ? (list.indexOf(t) !== -1 ? t : null) : (WORD.test(t) ? t : null); }
  function yn(v) { return v === true || v === "yes" ? "yes" : v === false || v === "no" ? "no" : null; }
  function put(o, k, v) { if (v !== null && v !== undefined) o[k] = v; }
  function once(key) {
    if (get("localStorage", key) || get("sessionStorage", key)) return false;
    set("localStorage", key, "1"); set("sessionStorage", key, "1");
    return true;
  }
  function sendPurchase(sid, value, name, id) {
    var p = { transaction_id: sid, value: value, currency: "AUD", items: [{ item_id: id, item_name: name, price: value, quantity: 1 }] };
    Object.keys(utm).forEach(function (k) { p[k] = utm[k]; });
    send("purchase", p);
    if (cfg.adsConversion && !framed && !viaApp && window.gtag) window.gtag("event", "conversion", { send_to: cfg.adsConversion, value: value, currency: "AUD", transaction_id: sid });
  }
  var lastFwd = { k: "", t: 0 };
  function onAppEvent(name, props) {
    if (!name) return;
    props = props && typeof props === "object" ? props : {};
    if (STARTERS[name]) designStarted(name, props.id ? { template: props.id } : null);
    // The simple phone path (src/flow/phone-simple.js): one event per step, parameters checked against strict lists only.
    if (PHONE_EVENTS[name]) {
      var pe = {};
      put(pe, "design_type", word(props.type)); put(pe, "source", word(props.source)); put(pe, "from", word(props.from)); put(pe, "fits", yn(props.fits) || word(props.fits));
      send(name, pe);
      return;
    }
    if (!FORWARD[name]) return;
    // The same message twice within a moment is one action.
    var k = name + JSON.stringify(props), now = Date.now();
    if (lastFwd.k === k && now - lastFwd.t < 400) return;
    lastFwd = { k: k, t: now };
    var fp = {};
    if (name === "app_opened") { put(fp, "entry", word(props.entry, ["phone", "desktop"])); put(fp, "from", word(props.from, ["home_search", "sample", "direct"])); }
    else if (name === "lot_loaded") { fp.result = props.success === false ? "fail" : "success"; var ms = Math.round(Number(props.ms)); if (isFinite(ms) && ms >= 0) fp.ms = Math.min(ms, 600000); put(fp, "sample", yn(props.sample)); }
    else if (name === "house_placed") { put(fp, "sample", yn(props.sample)); }
    else if (name === "ps_profile_prompt") { put(fp, "reason", word(props.reason)); put(fp, "card", word(props.card, ["compact", "full"])); }
    else if (name === "ps_profile_signup") { put(fp, "marketing", yn(props.marketing)); }
    else if (name === "ps_export") { put(fp, "export_type", word(props.type)); }
    else if (name === "ps_upgrade_click") { put(fp, "source", word(props.source)); }
    else if (name === "ps_template_selected") { put(fp, "item_id", word(props.id)); }
    send(name, fp);
    if (name === "ps_profile_signup" && once("gi_lead_profile")) {
      var lp = { lead_type: "free_profile", method: "app" };
      Object.keys(utm).forEach(function (u) { lp[u] = utm[u]; });
      send("generate_lead", lp);
    }
    if (name === "ps_checkout_completed") {
      var sid = typeof props.sessionId === "string" && /^[A-Za-z0-9_-]{6,120}$/.test(props.sessionId) ? props.sessionId : "";
      // One purchase per Stripe session, shared with the checkout return handler below and with the app's own page (same storage key).
      if (sid && once("gi_purchase_" + sid.slice(0, 80))) sendPurchase(sid, PLAN_PRICE, "Glide Inside Plan Pack", "plan_pack");
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
    if (!once("gi_purchase_" + sid.slice(0, 80))) return;
    var addon = q.get("addon"), value = PLAN_PRICE, name = "Glide Inside Plan Pack", id = "plan_pack";
    var fly = priceNumber(cfg.addonFlyThroughPrice, 10), ren = priceNumber(cfg.addonRendersPrice, 10);
    if (addon === "fly") { value = fly; name = "3D fly-through"; id = "addon_fly_through"; }
    else if (addon === "renders") { value = ren; name = "Complex renderings"; id = "addon_renders"; }
    else if (addon === "both") { value = fly + ren; name = "3D fly-through and complex renderings"; id = "addon_both"; }
    sendPurchase(sid, value, name, id);
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
