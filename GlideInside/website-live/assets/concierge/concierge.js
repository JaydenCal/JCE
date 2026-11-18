/* Glide Inside AI booking assistant: the panel. Fetched by launcher.js on first click. Vanilla JS, no dependencies.
   Default flow (owner decision 15/11/2026): "Request a call back". The details go to Jayden through the existing enquiry pipeline. Nothing is
   booked and no time is promised. The calendar screens below only appear when the server says bookingAvailable (BOOKING_PROVIDER=calcom).
   Privacy: the chat lives only in this page (nothing is stored in the browser or sent to analytics). GA4 events carry no personal data
   (window.giTrackBooking in analytics.js enforces a fixed schema). */
(function () {
  "use strict";
  var cfgSite = window.GI_CONFIG || {};
  var API = (cfgSite.conciergeApiBase || cfgSite.apiBase || "/api").replace(/\/+$/, "") + "/concierge";
  var state = null;

  function el(tag, attrs, kids) {
    var n = document.createElement(tag), k;
    for (k in attrs || {}) { if (k === "text") n.textContent = attrs[k]; else if (k === "class") n.className = attrs[k]; else if (k.slice(0, 2) === "on") n.addEventListener(k.slice(2), attrs[k]); else if (attrs[k] !== false && attrs[k] != null) n.setAttribute(k, attrs[k] === true ? "" : attrs[k]); }
    (kids || []).forEach(function (c) { if (c) n.appendChild(typeof c === "string" ? document.createTextNode(c) : c); });
    return n;
  }
  function track(name, params) { try { if (window.giTrackBooking) window.giTrackBooking(name, params || {}); } catch (e) {} }
  function ddmmyyyy(label) { return label; }

  function api(path, body, method) {
    var opts = { method: method || "POST", headers: { accept: "application/json", "x-gi-request": "1" }, credentials: "same-origin" };
    if (opts.method === "POST") { opts.headers["content-type"] = "application/json"; opts.body = JSON.stringify(body || {}); }
    var ctl = typeof AbortController !== "undefined" ? new AbortController() : null;
    var timer = ctl ? setTimeout(function () { ctl.abort(); }, 20000) : null;
    if (ctl) opts.signal = ctl.signal;
    return fetch(API + path, opts).then(function (r) { if (timer) clearTimeout(timer); return r.json().catch(function () { return {}; }).then(function (j) { return { status: r.status, body: j }; }); })
      .catch(function (e) { if (timer) clearTimeout(timer); return { status: 0, body: { code: e && e.name === "AbortError" ? "TIMEOUT" : "NETWORK" } }; });
  }

  // ---- Turnstile (only when the server hands back a site key) ----
  function loadTurnstile(siteKey) {
    return new Promise(function (ok) {
      function go() {
        var host = el("div", { class: "gic-ts" }); state.panel.appendChild(host);
        try { window.turnstile.render(host, { sitekey: siteKey, appearance: "interaction-only", callback: function (t) { ok(t); }, "error-callback": function () { ok(""); } }); } catch (e) { ok(""); }
      }
      if (window.turnstile) return go();
      var s = el("script", { src: "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit", async: true });
      s.onload = go; s.onerror = function () { ok(""); }; document.head.appendChild(s);
    });
  }
  function ensureSession() {
    if (state.conv) return Promise.resolve(true);
    if (state.sessionP) return state.sessionP;
    state.sessionP = (state.cfg.turnstileSiteKey ? loadTurnstile(state.cfg.turnstileSiteKey) : Promise.resolve("")).then(function (tok) {
      return api("/session", { turnstileToken: tok });
    }).then(function (r) { state.sessionP = null; if (r.status === 200 && r.body.conv) { state.conv = r.body.conv; return true; } state.sessionError = r.body.code || "ERR"; return false; });
    return state.sessionP;
  }

  // ---- layout ----
  function build(ctx) {
    var panel = el("div", { class: "gic-panel", role: "dialog", "aria-modal": "true", "aria-labelledby": "gic-title" });
    var close = el("button", { type: "button", class: "gic-x", "aria-label": "Close assistant", text: "×", onclick: function () { closePanel(); } });
    var head = el("div", { class: "gic-head" }, [el("h2", { id: "gic-title", text: "Glide Inside assistant" }), el("span", { class: "gic-badge", text: "AI" }), close]);
    var priv = el("p", { class: "gic-privacy" }, ["You are chatting with an AI assistant. We do not keep this chat. A call back request sends your name, phone and email to Jayden. ", el("a", { href: ctx.root + "privacy.html", target: "_blank", rel: "noopener", text: "Privacy" }), "."]);
    var live = el("div", { class: "gic-sr", "aria-live": "polite", "aria-atomic": "true" });
    var body = el("div", { class: "gic-body" });
    panel.appendChild(head); panel.appendChild(priv); panel.appendChild(body); panel.appendChild(live);
    state.panel = panel; state.body = body; state.live = live;
    panel.addEventListener("keydown", function (e) {
      if (e.key === "Escape") { e.stopPropagation(); closePanel(); return; }
      if (e.key !== "Tab") return;
      var f = panel.querySelectorAll("a[href],button:not([disabled]),input:not([disabled]),[tabindex]:not([tabindex='-1'])");
      if (!f.length) return;
      var first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      else if (!panel.contains(document.activeElement)) { e.preventDefault(); first.focus(); }
    });
    document.body.appendChild(panel);
  }
  function say(text, who) {
    if (!state.log) return null;
    var m = el("div", { class: "gic-msg " + (who === "you" ? "you" : "bot") }, [who === "you" ? null : el("span", { class: "gic-who", text: "AI assistant" }), document.createTextNode(text)]);
    state.log.appendChild(m); state.log.scrollTop = state.log.scrollHeight;
    if (who !== "you") state.live.textContent = text;
    return m;
  }
  function chips(items) {
    var row = el("div", { class: "gic-chips" });
    items.forEach(function (c) { row.appendChild(c); });
    state.log.appendChild(row); state.log.scrollTop = state.log.scrollHeight; return row;
  }
  function linkFor(key) {
    var l = state.cfg.links && state.cfg.links[key]; if (!l) return null;
    var href = state.ctx.root + String(l.href).replace(/^\//, "");
    var a = el("a", { class: "gic-link", href: href, text: l.label });
    if (key === "enquiry" || key === "demo") a.addEventListener("click", function () { track("booking_agent_handoff_requested", { target: key, page_path: state.ctx.page }); });
    return a;
  }
  function footer() {
    var f = el("div", { class: "gic-foot" });
    f.appendChild(el("span", { text: "Prefer not to use AI?" }));
    var d = linkFor("demo"), e = linkFor("enquiry");
    [d, e].forEach(function (a) { if (a) { a.className = ""; a.textContent = a.textContent; f.appendChild(a); } });
    f.appendChild(el("a", { href: "mailto:" + (state.cfg.contact && state.cfg.contact.email || "hello@glideinside.com.au"), text: "Email us" }));
    return f;
  }
  function screen(name, nodes, opts) {
    state.view = name; state.body.textContent = "";
    var s = el("div", { class: "gic-screen", "data-view": name }, nodes);
    state.body.appendChild(s); state.body.appendChild(footer());
    var h = s.querySelector("h3"); if (h) { h.setAttribute("tabindex", "-1"); h.focus({ preventScroll: true }); }
    if (opts && opts.say) state.live.textContent = opts.say;
    return s;
  }

  // ---- screens ----
  function chatScreen(first) {
    state.body.textContent = ""; state.view = "chat";
    var log = el("div", { class: "gic-log", role: "log", "aria-label": "Conversation" });
    state.log = log;
    var input = el("input", { type: "text", maxlength: "600", "aria-label": "Type your question", placeholder: "Ask a question", autocomplete: "off" });
    var send = el("button", { type: "submit", class: "gic-btn", text: "Send" });
    var form = el("form", { class: "gic-compose", onsubmit: function (e) { e.preventDefault(); var v = input.value.trim(); if (!v) return; input.value = ""; ask(v); } }, [input, send]);
    state.input = input;
    state.body.appendChild(log); state.body.appendChild(form); state.body.appendChild(footer());
    if (first) intro(); else state.history.forEach(function (h) { say(h.text, h.who); });
    return input;
  }
  function intro() {
    say("Hello, I am the Glide Inside AI assistant. I can answer questions about what the site says and pass a call back request to Jayden. I cannot give planning, engineering or approval advice. Who are you?");
    var items = (state.cfg.intents || []).map(function (i) {
      return el("button", { type: "button", class: "gic-chip gic-intent", onclick: function () { pickIntent(i.id); } }, [i.label, el("small", { text: i.blurb })]);
    });
    state.introChips = chips(items);
    state.history.push({ who: "bot", text: "Who are you?" });
  }
  function typeFor(intent) { var i = (state.cfg.intents || []).filter(function (x) { return x.id === intent; })[0]; return i ? i.bookingType : null; }
  function typeInfo(id) { return (state.cfg.types || []).filter(function (t) { return t.id === id; })[0] || null; }

  function pickIntent(id) {
    state.intent = id;
    track("booking_agent_intent_selected", { intent: id, page_path: state.ctx.page });
    if (state.introChips) state.introChips.remove();
    var label = (state.cfg.intents.filter(function (i) { return i.id === id; })[0] || {}).label;
    say(label, "you");
    ensureSession().then(function (ok) {
      if (!ok) return sessionFailed();
      return api("/message", { conv: state.conv, intent: id, page: state.ctx.page }).then(function (r) {
        if (r.status !== 200) return apiError(r);
        say(r.body.reply); showLinks(r.body.links);
        qualify(id);
      });
    });
  }
  function qualify(id) {
    var i = state.cfg.intents.filter(function (x) { return x.id === id; })[0]; if (!i || !i.qualifier) return;
    say(i.qualifier.q);
    var row = chips(i.qualifier.options.map(function (o) {
      return el("button", { type: "button", class: "gic-chip", onclick: function () {
        row.remove(); say(o[1], "you"); state.qualifier = o[0];
        track("booking_agent_qualification_completed", { intent: id, qualifier: o[0], page_path: state.ctx.page });
        offerNext();
      } }, [o[1]]);
    }));
  }
  function offerNext() {
    var t = typeInfo(typeFor(state.intent)), nodes = [];
    if (state.cfg.callbackAvailable) {
      say("Thanks. Would you like Jayden to call you back? You send your details and he will call you, usually within one business day. Or ask a question first.");
      nodes.push(el("button", { type: "button", class: "gic-btn", onclick: function () { callbackScreen(); } }, ["Request a call back"]));
      if (t && state.cfg.bookingAvailable) nodes.push(el("button", { type: "button", class: "gic-chip", onclick: function () { showSlots(t.id); } }, ["See available times"]));
    } else {
      say("Thanks. The call back request is not open right now. You can ask a question here, use the demo form, or send an enquiry and the team will reply.");
      ["demo", "enquiry"].forEach(function (k) { var a = linkFor(k); if (a) nodes.push(a); });
    }
    nodes.push(el("button", { type: "button", class: "gic-chip", onclick: function () { state.input.focus(); } }, ["Ask a question"]));
    var faq = [["What does it cost?", "How much does it cost?"], ["Is it approved?", "Are the plans approved by council?"]];
    faq.forEach(function (q) { nodes.push(el("button", { type: "button", class: "gic-chip", onclick: function () { ask(q[1], q[0]); } }, [q[0]])); });
    chips(nodes);
  }
  function showLinks(keys) {
    var nodes = (keys || []).map(linkFor).filter(Boolean);
    if (nodes.length) chips(nodes);
  }
  function ask(text, shown) {
    say(shown || text, "you"); state.history.push({ who: "you", text: shown || text }); state.prior.push(text);
    var pending = say("Thinking");
    ensureSession().then(function (ok) {
      if (!ok) { pending.remove(); return sessionFailed(); }
      return api("/message", { conv: state.conv, intent: state.intent || undefined, message: text, page: state.ctx.page, history: state.prior.slice(-3, -1) }).then(function (r) {
        pending.remove();
        if (r.status !== 200) return apiError(r);
        say(r.body.reply); state.history.push({ who: "bot", text: r.body.reply });
        showLinks(r.body.links);
        if (r.body.ops && r.body.ops.some(function (o) { return o.op === "callback"; }) && state.cfg.callbackAvailable) chips([el("button", { type: "button", class: "gic-btn", onclick: function () { callbackScreen(); } }, ["Request a call back"])]);
        if (r.body.slots && r.body.slots.slots && r.body.slots.slots.length) renderSlots(r.body.slots.type, r.body.slots.slots, r.body.slots.durationMin);
        else if (r.body.ops && r.body.ops.some(function (o) { return o.op === "choose_intent"; })) { var ch = (state.cfg.intents || []).map(function (i) { return el("button", { type: "button", class: "gic-chip", onclick: function () { state.intent = i.id; showSlots(i.bookingType); } }, [i.label]); }); chips(ch); }
      });
    });
  }
  function apiError(r) {
    var c = r.body && r.body.code;
    if (c === "RATE_LIMITED") say("That is a lot of messages. Please wait a moment, or use the demo form or enquiry form.");
    else if (c === "SESSION_EXPIRED") { state.conv = null; say("This chat timed out. Please send your message again."); }
    else say("Something went wrong. Please try again, or use the demo form or enquiry form.");
    showLinks(["demo", "enquiry"]);
  }
  function sessionFailed() {
    var f = state.sessionError;
    screen("fallback", [el("h3", { text: f === "TURNSTILE_FAILED" ? "We could not check that you are a person" : "The assistant is not available right now" }),
      el("p", { class: "gic-note", text: "You can still book a demo or send an enquiry and the team will reply." }),
      el("div", { class: "gic-row" }, [linkFor("demo"), linkFor("enquiry")].filter(Boolean)),
      el("button", { type: "button", class: "gic-btn gic-quiet", onclick: function () { state.sessionError = null; chatScreen(false); } }, ["Back"])]);
  }

  // ---- request a call back (default flow) ----
  function campaignParam() { try { var m = /[?&]utm_campaign=([^&#]*)/.exec(location.search); var v = m ? decodeURIComponent(m[1]) : ""; return /^[A-Za-z0-9._-]{1,60}$/.test(v) ? v : ""; } catch (e) { return ""; } }
  var TIME_OPTS = [["morning", "Morning"], ["afternoon", "Afternoon"], ["evening", "Evening"], ["note", "Another time (add a note)"]];
  function callbackScreen(errMsg) {
    var d = state.cb || (state.cb = {});
    var name = el("input", { type: "text", id: "gic-cb-name", autocomplete: "name", maxlength: "120", required: true, value: d.name || "" });
    var phone = el("input", { type: "tel", id: "gic-cb-phone", autocomplete: "tel", maxlength: "40", required: true, value: d.phone || "" });
    var email = el("input", { type: "email", id: "gic-cb-email", autocomplete: "email", maxlength: "200", required: true, value: d.email || "" });
    var when = el("select", { id: "gic-cb-when" }, TIME_OPTS.map(function (o) { var op = el("option", { value: o[0], text: o[1] }); if (d.bestTime === o[0]) op.selected = true; return op; }));
    var whenNote = el("input", { type: "text", id: "gic-cb-note", maxlength: "120", placeholder: "For example, weekdays after 3pm", value: d.bestTimeNote || "" });
    var types = [["homeowner", "Homeowner"], ["builder", "Builder"], ["developer", "Developer or estate"], ["agent", "Real estate agent"], ["other", "Other"]];
    var type = el("select", { id: "gic-cb-type" }, types.map(function (o) { var op = el("option", { value: o[0], text: o[1] }); if ((d.type || state.intent || "other") === o[0]) op.selected = true; return op; }));
    var notes = el("textarea", { id: "gic-cb-notes", maxlength: "1000", rows: "3", text: d.notes || "" });
    var consent = el("input", { type: "checkbox", id: "gic-cb-consent" }); // never ticked for the visitor
    var mk = el("input", { type: "checkbox", id: "gic-cb-mk" }); // never ticked for the visitor
    var err = el("p", { class: "gic-err", role: "alert", text: errMsg || "" });
    var sub = el("button", { type: "submit", class: "gic-btn", text: "Review request" });
    var form = el("form", { class: "gic-screen", novalidate: true, "data-view": "callback", style: "padding:0;overflow:visible", onsubmit: function (e) {
      e.preventDefault(); err.textContent = "";
      var n = name.value.trim(), p = phone.value.trim(), m = email.value.trim();
      if (n.length < 2) { err.textContent = "Enter your name."; name.focus(); return; }
      if (!/[0-9]{6,}/.test(p.replace(/[\s()+-]/g, ""))) { err.textContent = "Enter a phone number Jayden can call."; phone.focus(); return; }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(m)) { err.textContent = "Enter a valid email address."; email.focus(); return; }
      if (when.value === "note" && !whenNote.value.trim()) { err.textContent = "Add a note about the best time to call."; whenNote.focus(); return; }
      if (!consent.checked) { err.textContent = "Tick the box to agree to Glide Inside calling you back about your request."; consent.focus(); return; }
      state.cb = { name: n, phone: p, email: m, bestTime: when.value, bestTimeNote: whenNote.value.trim(), type: type.value, notes: notes.value.trim(), marketing: mk.checked };
      callbackReview();
    } }, [
      el("h3", { text: "Request a call back" }),
      el("p", { class: "gic-note", text: "Jayden at Glide Inside will call you, usually within one business day. No time is booked and nothing is scheduled until you speak." }),
      el("label", { class: "gic-field", for: "gic-cb-name" }, ["Name", name]),
      el("label", { class: "gic-field", for: "gic-cb-phone" }, ["Phone (required)", phone]),
      el("label", { class: "gic-field", for: "gic-cb-email" }, ["Email", email]),
      el("label", { class: "gic-field", for: "gic-cb-type" }, ["I am a", type]),
      el("label", { class: "gic-field", for: "gic-cb-when" }, ["Best time to call", when]),
      el("label", { class: "gic-field", for: "gic-cb-note" }, ["Note about the time (optional)", whenNote]),
      el("label", { class: "gic-field", for: "gic-cb-notes" }, ["Anything Jayden should know (optional)", notes]),
      el("label", { class: "gic-check", for: "gic-cb-consent" }, [consent, el("span", { text: "I agree to Glide Inside, calling me back about my request using these details." })]),
      el("label", { class: "gic-check", for: "gic-cb-mk" }, [mk, el("span", { text: "Optional: send me occasional Glide Inside updates and offers. You can say no and still ask for a call." })]),
      err,
    ]);
    form.appendChild(el("div", { class: "gic-row" }, [sub, el("button", { type: "button", class: "gic-btn gic-quiet", onclick: function () { chatScreen(false); } }, ["Back to chat"])]));
    state.view = "callback"; state.body.textContent = ""; state.body.appendChild(el("div", { class: "gic-screen" }, [form])); state.body.appendChild(footer());
    name.focus();
  }
  function callbackReview() {
    var d = state.cb;
    var tl = { morning: "Morning", afternoon: "Afternoon", evening: "Evening", note: "" };
    var when = [tl[d.bestTime], d.bestTimeNote].filter(Boolean).join(": ");
    var typeLabel = ({ homeowner: "Homeowner", builder: "Builder", developer: "Developer or estate", agent: "Real estate agent", other: "Other" })[d.type] || "Other";
    var btn = el("button", { type: "button", class: "gic-btn", id: "gic-cb-send", text: "Send call back request", onclick: function () { sendCallback(btn); } });
    var rows = [["Name", d.name], ["Phone", d.phone], ["Email", d.email], ["I am a", typeLabel], ["Best time to call", when], ["Notes", d.notes || "None"], ["Updates", d.marketing ? "Yes, occasional updates" : "No marketing"]];
    var dl = el("dl", { class: "gic-summary" }); rows.forEach(function (r) { dl.appendChild(el("dt", { text: r[0] })); dl.appendChild(el("dd", { text: r[1] })); });
    screen("callback-confirm", [el("h3", { text: "Check and send" }), dl,
      el("p", { class: "gic-note", text: "Nothing is sent until you press Send call back request. This sends your details to Jayden. It does not book a time." }),
      el("div", { class: "gic-row" }, [btn, el("button", { type: "button", class: "gic-btn gic-quiet", onclick: function () { callbackScreen(); } }, ["Back"])])]);
    btn.focus();
  }
  function sendCallback(btn) {
    if (state.sending) return; // duplicate click protection
    state.sending = true; btn.disabled = true; btn.textContent = "Sending";
    state.cbKey = state.cbKey || newKey(); // one key per attempt; a network retry reuses it, any definite error gets a new one
    var d = state.cb;
    api("/callback", { conv: state.conv, idemKey: state.cbKey, confirm: true, consent: true, type: d.type, name: d.name, phone: d.phone, email: d.email, bestTime: d.bestTime === "note" ? undefined : d.bestTime, bestTimeNote: d.bestTimeNote, notes: d.notes, marketingOptIn: d.marketing, page: state.ctx.page, campaign: campaignParam() }).then(function (r) {
      state.sending = false;
      var b = r.body || {};
      if (r.status === 0) { btn.disabled = false; btn.textContent = "Send call back request"; state.live.textContent = "We could not reach the server. Press Send again; it will not send twice."; var p = btn.parentNode; if (p && !p.querySelector(".gic-err")) p.parentNode.insertBefore(el("p", { class: "gic-err", role: "alert", text: "We could not reach the server. Press Send again. It will not send twice." }), p); return; }
      if (b.state === "callback_requested") return callbackDone(b);
      state.cbKey = null;
      track("booking_agent_booking_failed", { booking_type: typeFor(state.intent) || undefined, reason: b.code === "RATE_LIMITED" ? "rate_limited" : "callback_error" });
      if (b.code === "SESSION_EXPIRED") { state.conv = null; }
      var bad = b.code === "BAD_REQUEST" || b.code === "CONFIRM_REQUIRED";
      if (bad) return callbackScreen(b.message || "Please check your details.");
      screen("error", [el("h3", { text: "We could not send your request" }), el("p", { text: (b.message || "Something went wrong.") + " Your request was not sent. You can try again later, or use the enquiry form or email." }),
        el("div", { class: "gic-row" }, [linkFor("enquiry"), el("a", { href: "mailto:" + ((state.cfg.contact || {}).email || "hello@glideinside.com.au"), text: "Email us" })].filter(Boolean)),
        el("button", { type: "button", class: "gic-btn gic-quiet", onclick: function () { callbackScreen(); } }, ["Back to the form"])], { say: "Your request was not sent." });
    });
  }
  function callbackDone(b) {
    if (!state.sent[b.reference]) { state.sent[b.reference] = 1; track("booking_agent_callback_requested", { intent: state.intent || undefined, page_path: state.ctx.page, dedupe: "gi_cb_" + b.reference }); }
    state.cb = null; state.cbKey = null;
    screen("callback-done", [el("h3", { text: "Request received" }),
      el("p", { class: "gic-ok", text: "Thanks, your request is with Jayden at Glide Inside. He will call you, usually within one business day." }),
      el("dl", { class: "gic-summary" }, [el("dt", { text: "Reference" }), el("dd", { text: b.reference })]),
      el("button", { type: "button", class: "gic-btn", onclick: closePanel }, ["Done"])], { say: "Request received. Jayden will call you, usually within one business day." });
  }

  // ---- slots (only when the server says a calendar is on) ----
  function showSlots(type) {
    var t = typeInfo(type);
    if (!t) { say("That booking type is not open yet. Please use the demo form or enquiry form."); showLinks(["demo", "enquiry"]); return; }
    state.type = type;
    screen("slots", [el("h3", { text: "Choose a time" }), el("p", { class: "gic-note", text: "Loading available times." })]);
    ensureSession().then(function (ok) {
      if (!ok) return sessionFailed();
      return api("/slots", { conv: state.conv, type: type, days: 10 }).then(function (r) {
        if (r.status !== 200) return slotsError(r);
        renderSlotsScreen(type, r.body.slots, r.body.durationMin || t.durationMin);
      });
    });
  }
  function renderSlots(type, slots, dur) { // inline from chat: jump to the slots screen
    state.type = type; renderSlotsScreen(type, slots, dur);
  }
  function slotsError(r) {
    track("booking_agent_booking_failed", { booking_type: state.type, reason: "slots_" + (r.body.code === "CALENDAR_UNAVAILABLE" ? "calendar" : "error") });
    screen("error", [el("h3", { text: "Times are not available right now" }), el("p", { class: "gic-note", text: "The calendar could not be reached. Nothing has been booked. You can use the demo form or send an enquiry." }),
      el("div", { class: "gic-row" }, [linkFor("demo"), linkFor("enquiry")].filter(Boolean)), el("button", { type: "button", class: "gic-btn gic-quiet", onclick: function () { chatScreen(false); } }, ["Back to chat"])]);
  }
  function renderSlotsScreen(type, slots, dur) {
    var t = typeInfo(type) || { label: "Booking", durationMin: dur };
    track("booking_slots_viewed", { booking_type: type, slot_count: slots.length > 30 ? "30_plus" : slots.length > 10 ? "11_30" : slots.length ? "1_10" : "none" });
    var nodes = [el("h3", { text: "Choose a time" }), el("p", { class: "gic-note", text: t.label + ", " + dur + " minutes. Times are Sydney time (AEST or AEDT)." })];
    if (!slots.length) nodes.push(el("p", { text: "There are no times free in the next few days. You can use the demo form or send an enquiry." }), el("div", { class: "gic-row" }, [linkFor("demo"), linkFor("enquiry")].filter(Boolean)));
    var day = null, group = null;
    slots.forEach(function (s) {
      if (s.dayLabel !== day) { day = s.dayLabel; nodes.push(el("div", { class: "gic-day", text: day })); group = el("div", { class: "gic-slots", role: "group", "aria-label": day }); nodes.push(group); }
      group.appendChild(el("button", { type: "button", class: "gic-chip gic-slot", "aria-label": day + " at " + s.timeLabel, onclick: function () { state.slot = s; detailsScreen(); } }, [s.timeLabel]));
    });
    nodes.push(el("button", { type: "button", class: "gic-btn gic-quiet", onclick: function () { chatScreen(false); } }, ["Back to chat"]));
    screen("slots", nodes, { say: slots.length + " times available" });
  }

  // ---- details and confirm ----
  function detailsScreen(errMsg) {
    var t = typeInfo(state.type) || {};
    var name = el("input", { type: "text", id: "gic-name", name: "name", autocomplete: "name", maxlength: "100", required: true, value: state.name || "" });
    var email = el("input", { type: "email", id: "gic-email", name: "email", autocomplete: "email", maxlength: "254", required: true, value: state.email || "" });
    var consent = el("input", { type: "checkbox", id: "gic-consent" });
    var mk = el("input", { type: "checkbox", id: "gic-mk" }); // never ticked for the visitor
    var err = el("p", { class: "gic-err", role: "alert", text: errMsg || "" });
    var form = el("form", { class: "gic-screen", novalidate: true, "data-view": "details", style: "padding:0;overflow:visible", onsubmit: function (e) {
      e.preventDefault(); err.textContent = "";
      var n = name.value.trim(), m = email.value.trim();
      if (n.length < 2) { err.textContent = "Enter your name."; name.focus(); return; }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(m)) { err.textContent = "Enter a valid email address."; email.focus(); return; }
      if (!consent.checked) { err.textContent = "Tick the box to agree to your name and email being used to make this booking."; consent.focus(); return; }
      state.name = n; state.email = m; state.marketing = mk.checked;
      sub.disabled = true;
      api("/propose", { conv: state.conv, type: state.type, slotStart: state.slot.start, name: n, email: m, bookingConsent: true, marketingOptIn: mk.checked }).then(function (r) {
        sub.disabled = false;
        if (r.status === 200) { state.proposal = r.body; state.attemptKey = null; confirmScreen(); return; }
        var c = r.body.code;
        if (c === "SLOT_TAKEN" || c === "SLOT_EXPIRED") { track("booking_agent_booking_failed", { booking_type: state.type, reason: "slot_taken" }); say("That time is no longer free. Here are the current times."); chatScreen(false); showSlots(state.type); }
        else err.textContent = r.body.message || "That did not work. Please check your details.";
      });
    } }, [
      el("h3", { text: "Your details" }),
      el("p", { class: "gic-note", text: (t.label || "Booking") + ": " + state.slot.dayLabel + ", " + state.slot.timeLabel }),
      el("label", { class: "gic-field", for: "gic-name" }, ["Name", name]),
      el("label", { class: "gic-field", for: "gic-email" }, ["Email", email]),
      el("label", { class: "gic-check", for: "gic-consent" }, [consent, el("span", { text: "I agree to Glide Inside, using my name and email to make and confirm this booking." })]),
      el("label", { class: "gic-check", for: "gic-mk" }, [mk, el("span", { text: "Optional: send me occasional Glide Inside updates and offers. You can say no and still book." })]),
      err,
    ]);
    var sub = el("button", { type: "submit", class: "gic-btn", text: "Review booking" });
    form.appendChild(el("div", { class: "gic-row" }, [sub, el("button", { type: "button", class: "gic-btn gic-quiet", onclick: function () { showSlots(state.type); } }, ["Back"])]));
    state.view = "details"; state.body.textContent = ""; state.body.appendChild(el("div", { class: "gic-screen" }, [form])); state.body.appendChild(footer());
    name.focus();
  }
  function confirmScreen() {
    var s = state.proposal.summary, t = typeInfo(state.type) || {};
    var btn = el("button", { type: "button", class: "gic-btn", id: "gic-confirm", text: "Confirm booking", onclick: function () { doConfirm(btn); } });
    screen("confirm", [
      el("h3", { text: "Check and confirm" }),
      el("dl", { class: "gic-summary" }, [el("dt", { text: "Booking" }), el("dd", { text: s.label + " (" + s.durationMin + " min)" }), el("dt", { text: "When" }), el("dd", { text: s.dayLabel + ", " + s.timeLabel }), el("dt", { text: "Name" }), el("dd", { text: s.name }), el("dt", { text: "Email" }), el("dd", { text: s.email }), el("dt", { text: "Updates" }), el("dd", { text: s.marketingOptIn ? "Yes, occasional updates" : "No marketing" })]),
      el("p", { class: "gic-note", text: "Nothing is booked until you press Confirm booking and the calendar confirms it." }),
      el("div", { class: "gic-row" }, [btn, el("button", { type: "button", class: "gic-btn gic-quiet", onclick: function () { detailsScreen(); } }, ["Back"])]),
    ]);
    btn.focus();
  }
  function newKey() { var a = new Uint8Array(16); (window.crypto || {}).getRandomValues ? crypto.getRandomValues(a) : a.forEach(function (_, i) { a[i] = Math.floor(Math.random() * 256); }); return "k" + Array.prototype.map.call(a, function (b) { return b.toString(16).padStart(2, "0"); }).join(""); }
  function doConfirm(btn) {
    if (state.confirming) return; // duplicate click protection
    state.confirming = true; btn.disabled = true; btn.textContent = "Confirming";
    state.attemptKey = state.attemptKey || newKey(); // one key per attempt; a network retry reuses it
    track("booking_agent_booking_attempt", { booking_type: state.type });
    api("/confirm", { conv: state.conv, proposalToken: state.proposal.proposalToken, idemKey: state.attemptKey, confirm: true }).then(function (r) {
      state.confirming = false;
      var b = r.body || {};
      if (r.status === 0 || b.state === "unknown" || b.state === "in_progress") return unknownScreen();
      if (b.state === "confirmed" || b.state === "requested") return successScreen(b);
      failedScreen(b, r.status);
    });
  }
  function successScreen(b) {
    var key = "gi_bk_conf_" + b.ref;
    if (b.state === "confirmed" && !state.sent[b.ref]) { state.sent[b.ref] = 1; track("booking_agent_booking_confirmed", { booking_type: b.type || state.type, dedupe: key }); }
    var nodes = [el("h3", { text: b.state === "confirmed" ? "Booking confirmed" : "Request received" })];
    if (b.testMode) nodes.push(el("p", { class: "gic-test", text: "This is a test booking. Nothing was scheduled with the real calendar." }));
    nodes.push(el("dl", { class: "gic-summary" }, [el("dt", { text: "Reference" }), el("dd", { text: b.ref }), el("dt", { text: "When" }), el("dd", { text: b.dayLabel + ", " + b.timeLabel })]));
    nodes.push(el("p", { class: b.state === "confirmed" ? "gic-ok" : "gic-note", text: b.state === "confirmed" ? "The calendar has confirmed this booking. A confirmation email comes from the calendar." : "The host still has to accept this request. It is not confirmed yet." }));
    if (b.ownerToken) {
      var link = location.origin + location.pathname + "#gi-manage=" + b.ref + "." + b.ownerToken;
      state.manage = { ref: b.ref, token: b.ownerToken };
      nodes.push(el("p", { class: "gic-note", text: "Keep this private link to check or cancel the booking. Anyone with it can cancel." }));
      nodes.push(el("input", { type: "text", readonly: true, value: link, "aria-label": "Private booking link", onfocus: function (e) { e.target.select(); } }));
      nodes.push(el("button", { type: "button", class: "gic-btn gic-quiet", onclick: function (e) { cancelFlow(e.target); } }, ["Cancel this booking"]));
    }
    nodes.push(el("button", { type: "button", class: "gic-btn", onclick: closePanel }, ["Done"]));
    screen("success", nodes, { say: b.state === "confirmed" ? "Booking confirmed" : "Request received" });
  }
  function cancelFlow(btn) {
    if (!state.manage) return; btn.disabled = true;
    api("/manage", { ref: state.manage.ref, ownerToken: state.manage.token, action: "cancel" }).then(function (r) {
      if (r.status === 200 && r.body.state === "cancelled") screen("success", [el("h3", { text: "Booking cancelled" }), el("p", { class: "gic-note", text: "Reference " + r.body.ref + " has been cancelled." }), el("button", { type: "button", class: "gic-btn", onclick: closePanel }, ["Done"])]);
      else { btn.disabled = false; btn.textContent = "Could not cancel. Try the link in your email"; }
    });
  }
  function failedScreen(b, status) {
    track("booking_agent_booking_failed", { booking_type: state.type, reason: b.code === "SLOT_TAKEN" ? "slot_taken" : b.code === "CONFIRM_REQUIRED" ? "not_confirmed" : b.code === "RATE_LIMITED" ? "rate_limited" : b.code === "PROPOSAL_EXPIRED" ? "expired" : "other" });
    var nodes = [el("h3", { text: b.code === "SLOT_TAKEN" ? "That time was just taken" : "We could not book that" }), el("p", { text: (b.message || "Something went wrong.") + " Nothing was booked." })];
    var row = [];
    if (b.alternatives && b.alternatives.length) {
      nodes.push(el("p", { class: "gic-note", text: "Other times:" }));
      b.alternatives.slice(0, 4).forEach(function (s) { row.push(el("button", { type: "button", class: "gic-chip", onclick: function () { state.slot = s; detailsScreen(); } }, [s.dayLabel.replace(/^\w+ /, "") + " " + s.timeLabel])); });
      nodes.push(el("div", { class: "gic-slots" }, row));
    }
    nodes.push(el("div", { class: "gic-row" }, [el("button", { type: "button", class: "gic-btn", onclick: function () { showSlots(state.type); } }, ["Choose another time"]), linkFor("demo"), linkFor("enquiry")].filter(Boolean)));
    state.attemptKey = null;
    screen("error", nodes, { say: "Booking failed. Nothing was booked." });
  }
  function unknownScreen() {
    var tries = 0;
    var msg = el("p", { class: "gic-note", text: "We are checking whether your booking went through. Please do not book again." });
    screen("unknown", [el("h3", { text: "Checking your booking" }), msg]);
    setTimeout(function poll() {
      tries++;
      api("/status", { conv: state.conv, proposalToken: state.proposal.proposalToken }).then(function (r) {
        var b = r.body || {};
        if (b.state === "confirmed" || b.state === "requested") return successScreen(b);
        if (b.state === "failed" || b.state === "none") return failedScreen(b, r.status);
        if (tries < 8) return setTimeout(poll, 4000);
        screen("error", [el("h3", { text: "We could not confirm this yet" }), el("p", { text: "We could not tell whether this booking was made. Please do not book again. Email " + ((state.cfg.contact || {}).email || "hello@glideinside.com.au") + " and we will check it for you." }),
          el("button", { type: "button", class: "gic-btn gic-quiet", onclick: closePanel }, ["Close"])]);
      });
    }, 2500);
  }

  // ---- manage link ----
  function manageScreen(m) {
    var out = el("p", { class: "gic-note", text: "Checking your booking." });
    screen("manage", [el("h3", { text: "Your booking" }), out]);
    api("/manage", { ref: m.ref, ownerToken: m.token, action: "status" }).then(function (r) {
      if (r.status !== 200) { out.textContent = "That booking link is not valid."; return; }
      state.manage = m;
      out.textContent = "Reference " + r.body.ref + ": " + r.body.dayLabel + ", " + r.body.timeLabel + ". Status: " + r.body.state + ".";
      if (r.body.state === "confirmed" || r.body.state === "requested") state.body.querySelector(".gic-screen").appendChild(el("button", { type: "button", class: "gic-btn gic-quiet", onclick: function (e) { cancelFlow(e.target); } }, ["Cancel this booking"]));
    });
  }

  // ---- open and close ----
  var lastFocus = null;
  function closePanel() {
    if (!state || !state.panel) return;
    state.panel.remove(); var cb = state.ctx.onClose; state.panel = null; state.open = false;
    if (lastFocus && lastFocus.focus) try { lastFocus.focus(); } catch (e) {}
    if (cb) cb();
  }
  function open(ctx) {
    if (state && state.panel) { state.input && state.input.focus(); return; }
    lastFocus = document.activeElement;
    state = { ctx: ctx, cfg: null, conv: null, intent: null, type: null, slot: null, history: [], prior: [], sent: (state && state.sent) || {}, open: true };
    build(ctx);
    track("booking_agent_opened", { page_path: ctx.page });
    state.body.appendChild(el("div", { class: "gic-screen" }, [el("p", { class: "gic-note", text: "Starting." })]));
    var close = state.panel.querySelector(".gic-x"); close.focus();
    fetch(API + "/config", { headers: { accept: "application/json" }, credentials: "same-origin" }).then(function (r) { return r.json(); }).then(function (c) {
      if (!state.panel) return;
      if (!c || !c.enabled) throw new Error("off");
      state.cfg = c;
      if (ctx.manage) return manageScreen(ctx.manage);
      var input = chatScreen(true); input.focus();
    }).catch(function () {
      if (!state.panel) return;
      state.cfg = { links: { demo: { label: "Book a demo (form)", href: "/book-a-demo/" }, enquiry: { label: "Send an enquiry", href: "/#enquiry" } }, contact: { email: "hello@glideinside.com.au" }, intents: [] };
      screen("fallback", [el("h3", { text: "The assistant is not available right now" }), el("p", { class: "gic-note", text: "You can still book a demo or send an enquiry and the team will reply." }),
        el("div", { class: "gic-row" }, [linkFor("demo"), linkFor("enquiry")].filter(Boolean))]);
    });
  }
  window.GIConcierge = { open: open, close: closePanel };
})();
