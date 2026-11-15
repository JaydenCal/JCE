/* Glide Inside v4 framework behaviour. No dependencies. */
(function () {
  var cfg = window.GI_CONFIG || {};
  // data-cfg="key" fills text; data-cfg-href="key" sets links
  document.querySelectorAll("[data-cfg]").forEach(function (el) { var v = cfg[el.dataset.cfg]; if (v != null) el.textContent = v; });
  var fs = document.querySelector('script[src*="framework.js"]'), root = fs ? fs.src.replace(/framework\.js.*$/, "") : "";
  document.querySelectorAll("[data-cfg-href]").forEach(function (el) { var v = cfg[el.dataset.cfgHref]; if (!v) return; if (!/^(https?:|mailto:|tel:|#)/.test(v)) v = new URL(v, root || location.href).href; if (el.dataset.template) { var u = new URL(v, location.href); u.searchParams.set("template", el.dataset.template); v = u.href; } if (el.dataset.appMode) { var um = new URL(v, location.href); um.searchParams.set("mode", el.dataset.appMode); v = um.href; } el.setAttribute("href", v); el.removeAttribute("aria-disabled"); });
  // portal links (Builder login, Client login) show only when site.config.js sets portalLive: true
  document.querySelectorAll("[data-portal]").forEach(function (el) { el.hidden = !cfg.portalLive; });
  // mobile nav
  var t = document.querySelector(".nav-toggle"), n = document.querySelector(".site-nav");
  if (t && n) {
    t.addEventListener("click", function () { var o = n.classList.toggle("open"); t.setAttribute("aria-expanded", o); t.textContent = o ? "Close" : "Menu"; });
    n.addEventListener("click", function (e) { if (e.target.closest("a")) { n.classList.remove("open"); t.setAttribute("aria-expanded", "false"); t.textContent = "Menu"; } });
    document.addEventListener("keydown", function (e) { if (e.key === "Escape" && n.classList.contains("open")) { n.classList.remove("open"); t.setAttribute("aria-expanded", "false"); t.textContent = "Menu"; t.focus(); } });
  }
  // click-to-load live editor: button[data-live-src] fills its .live-stage with the app, so the 3 MB app never slows first paint
  document.querySelectorAll("[data-live-src]").forEach(function (b) {
    b.addEventListener("click", function () {
      var st = b.closest(".live-stage"); if (!st) return;
      var f = document.createElement("iframe");
      f.title = b.dataset.liveTitle || "Glide Inside";
      f.setAttribute("sandbox", "allow-scripts allow-same-origin allow-forms allow-modals allow-downloads allow-popups allow-pointer-lock");
      f.setAttribute("allow", "fullscreen; pointer-lock; clipboard-write");
      f.src = new URL(b.dataset.liveSrc, root || location.href).href;
      st.innerHTML = ""; st.appendChild(f);
      try { if (window.gtag) window.gtag("event", "live_editor_loaded", {}); } catch (e) {}
    });
  });
  // home live tool: lazy-loads the framed viewer near the viewport (desktop); on a phone the frame is a poster that opens the viewer full screen
  var APP = "/plan-studio/app/";
  var liveMode = (document.querySelector(".live-hero[data-mode]") || {}).dataset ? document.querySelector(".live-hero[data-mode]").dataset.mode : "";
  var appUrl = function (address) { return APP + "?embed=1" + (liveMode ? "&mode=" + encodeURIComponent(liveMode) : "") + (address ? "&address=" + encodeURIComponent(address) : ""); };
  var phoneMq = matchMedia("(max-width: 760px)");
  var live = { box: null, frame: null, stage: null, start: function () {}, ready: false, pending: null, last: "" };
  var searches = [];
  document.querySelectorAll(".live-hero").forEach(function (box) {
    var f = box.querySelector("iframe"), note = box.querySelector(".lh-poster p"), btn = box.querySelector("[data-live-open]");
    if (!f) return;
    var started = false;
    live.box = box; live.frame = f; live.stage = box.querySelector(".lh-stage");
    function go(address) {
      if (started) return false; started = true;
      var y = window.scrollY, x = window.scrollX;
      f.addEventListener("load", function () {
        // gi:ready can arrive before load fires, so do not reset live.ready here; if a find is still pending, send it now.
        if (live.ready && live.pending) { var pa = live.pending; live.pending = null; postFind(pa); }
        box.classList.add("is-live");
        try { if (document.activeElement === f) f.blur(); } catch (e) {}
        if (!address && !live.last) { window.scrollTo(x, y); setTimeout(function () { window.scrollTo(x, y); }, 400); }
        try { if (window.gtag) window.gtag("event", "live_editor_loaded", {}); } catch (e) {}
      });
      var u = new URL(f.dataset.src, root || location.href);
      if (address) u.searchParams.set("address", address);
      f.src = u.href;
      return true;
    }
    live.start = go;
    if (phoneMq.matches) {
      if (note) note.textContent = "Opens the live viewer full screen.";
      if (btn) btn.addEventListener("click", function () { location.assign(appUrl(live.last)); });
    }
    else {
      // The 3D viewer still starts by itself on desktop (owner decision 15/11/2026), but only once it is near the
      // viewport and after the page has finished loading and the browser is idle, so it does not hold up the first paint.
      if (note) note.textContent = "Loading the live viewer.";
      if (btn) btn.addEventListener("click", function () { go(); });
      var whenIdle = function (fn) { var run = function () { if ("requestIdleCallback" in window) requestIdleCallback(fn, { timeout: 1500 }); else setTimeout(fn, 300); }; if (document.readyState === "complete") run(); else window.addEventListener("load", run, { once: true }); };
      if ("IntersectionObserver" in window) { new IntersectionObserver(function (es, o) { if (es[0].isIntersecting) { o.disconnect(); whenIdle(function () { go(); }); } }, { rootMargin: "300px 0px" }).observe(box); }
      else whenIdle(function () { go(); });
    }
    // Full screen: the Fullscreen API on the frame wrapper; a new tab with the viewer where the browser has none (iPhone).
    var fsBtn = box.querySelector("[data-fs]"), exitBtn = box.querySelector("[data-fs-exit]"), st = live.stage;
    var fsOn = function () { return document.fullscreenElement || document.webkitFullscreenElement; };
    if (fsBtn && st) {
      var label = fsBtn.querySelector("span");
      fsBtn.addEventListener("click", function () {
        if (fsOn()) { (document.exitFullscreen || document.webkitExitFullscreen).call(document); return; }
        var req = st.requestFullscreen || st.webkitRequestFullscreen;
        if (!req || document.fullscreenEnabled === false) { window.open(appUrl(live.last), "_blank", "noopener"); return; }
        go();
        try { var p = req.call(st); if (p && p.catch) p.catch(function () { window.open(appUrl(live.last), "_blank", "noopener"); }); } catch (e) { window.open(appUrl(live.last), "_blank", "noopener"); }
      });
      var sync = function () { var on = !!fsOn(); box.classList.toggle("is-fs", on); if (label) label.textContent = on ? "Exit full screen" : "Full screen"; };
      document.addEventListener("fullscreenchange", sync); document.addEventListener("webkitfullscreenchange", sync);
      if (exitBtn) exitBtn.addEventListener("click", function () { (document.exitFullscreen || document.webkitExitFullscreen).call(document); });
    }
  });
  // Address search: one component for the bar above the frame and the field in step 1. Suggestions come from /api/site/search?q=
  // (the same call the app makes). Choosing one sends gi:find-address to the embedded viewer and scrolls it into view; on a phone it
  // opens the viewer full screen at that address instead.
  function postFind(address, pick) {
    var msg = { type: "gi:find-address", address: address };
    if (pick && isFinite(pick.lon) && isFinite(pick.lat)) msg.pick = { label: pick.label, state: pick.state, lon: pick.lon, lat: pick.lat };
    try { live.frame.contentWindow.postMessage(msg, location.origin); } catch (e) {}
  }
  // Suggestions already shown, by lower case label: submitting text that matches one uses its coordinates and makes no second search.
  var shown = {};
  function remember(list) { (list || []).forEach(function (r) { if (r && r.label) shown[r.label.toLowerCase().replace(/\s+/g, " ")] = r; }); }
  function shownFor(q) { return shown[String(q).toLowerCase().trim().replace(/\s+/g, " ")] || null; }
  // "Open full editor" carries the last searched address into the app.
  function syncEdit() {
    document.querySelectorAll(".lh-edit").forEach(function (a) {
      var u = new URL(APP, location.href);
      u.searchParams.set("mode", liveMode || "residential");
      if (live.last) u.searchParams.set("address", live.last);
      a.setAttribute("href", u.pathname + u.search);
    });
  }
  function openAddress(address, pick) {
    live.last = address; live.lastPick = pick || null; syncEdit();
    try { if (window.gtag) window.gtag("event", "address_search", {}); } catch (e) {}
    if (phoneMq.matches || !live.frame) { location.assign(appUrl(address)); return; }
    live.box.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
    setBusy(true);
    if (live.ready) { postFind(address, pick); return; }
    // Not ready: a frame that has not started loads straight at the address (?address=); one that is still starting gets it when it says gi:ready,
    // and is pointed at the address itself if that does not happen.
    if (live.start(address)) { live.pending = null; return; }
    live.pending = address; live.pendingPick = pick || null;
    clearTimeout(live.fallback);
    live.fallback = setTimeout(function () {
      if (!live.pending || live.ready) return;
      live.pending = null;
      var u = new URL(live.frame.src || appUrl(""), location.href); u.searchParams.set("address", address); live.frame.src = u.href;
    }, 5000);
  }
  function setBusy(on) {
    clearTimeout(live.busyT);
    searches.forEach(function (c) { if (!c.go) return; if (on) { c.go.dataset.label = c.go.dataset.label || c.go.textContent; c.go.textContent = "Finding your block..."; c.go.disabled = true; } else if (c.go.dataset.label) { c.go.textContent = c.go.dataset.label; c.go.disabled = false; } });
    if (on) live.busyT = setTimeout(function () { setBusy(false); }, 60000);
  }
  // A warning always ends the "Finding your block..." state, and may carry a Try again button.
  function setStatus(text, kind, retry) {
    if (kind === "warn") setBusy(false);
    searches.forEach(function (c) {
      c.status.textContent = text || ""; c.status.dataset.kind = kind || "";
      if (retry && text) {
        var b = document.createElement("button"); b.type = "button"; b.className = "as-retry"; b.textContent = "Try again";
        b.addEventListener("click", retry); c.status.appendChild(document.createTextNode(" ")); c.status.appendChild(b);
      }
    });
  }
  window.addEventListener("message", function (e) {
    if (e.origin !== location.origin || !live.frame || e.source !== live.frame.contentWindow) return;
    var m = e.data; if (!m || typeof m !== "object") return;
    if (m.type === "gi:ready") { live.ready = true; clearTimeout(live.fallback); if (live.pending) { var a = live.pending; live.pending = null; postFind(a, live.pendingPick); } }
    else if (m.type === "gi:status") {
      if (m.state === "loading") setStatus("Loading your block");
      else if (m.state === "done") { setBusy(false); if (m.address) { live.last = m.address; syncEdit(); } setStatus(m.address ? "Showing " + m.address : "", ""); }
      else if (m.state === "error") { setBusy(false); setStatus(m.message || "That address could not be loaded.", "warn", m.retry && live.last ? function () { setBusy(true); setStatus(""); postFind(live.last, live.lastPick); } : null); }
    }
  });
  var searchCache = {};
  document.querySelectorAll("[data-addr-search]").forEach(function (root) {
    var input = root.querySelector("[data-addr-input]"), list = root.querySelector(".as-list"), status = root.querySelector("[data-addr-status]");
    if (!input || !list) return;
    var max = Number(root.dataset.max) || 6, results = [], active = -1, ctl = null, timer = 0, seq = 0, searching = false, uid = "as" + searches.length + "-";
    var comp = { input: input, status: status || document.createElement("p"), go: root.querySelector(".as-go") };
    searches.push(comp);
    function close() { list.hidden = true; input.setAttribute("aria-expanded", "false"); input.removeAttribute("aria-activedescendant"); active = -1; }
    function paint() {
      list.textContent = "";
      results.slice(0, max).forEach(function (r, i) {
        var li = document.createElement("li"); li.className = "as-opt"; li.id = uid + i; li.setAttribute("role", "option"); li.setAttribute("aria-selected", String(i === active));
        li.appendChild(document.createTextNode(r.label));
        if (r.state) { var sm = document.createElement("small"); sm.textContent = r.state; li.appendChild(sm); }
        li.addEventListener("pointerdown", function (e) { e.preventDefault(); choose(i); });
        list.appendChild(li);
      });
      if (searching) { var sr = document.createElement("li"); sr.className = "as-opt as-searching"; sr.setAttribute("role", "presentation"); sr.textContent = "Searching..."; list.appendChild(sr); }
      list.hidden = !results.length && !searching;
      input.setAttribute("aria-expanded", String(!!results.length));
      if (active >= 0) input.setAttribute("aria-activedescendant", uid + active);
    }
    function search(q) {
      if (ctl) ctl.abort();
      var my = ++seq;
      if (!window.fetch) return Promise.resolve([]);
      ctl = window.AbortController ? new AbortController() : null;
      return fetch("/api/site/search?q=" + encodeURIComponent(q), ctl ? { signal: ctl.signal } : {})
        .then(function (res) { if (!res.ok) throw new Error("search " + res.status); return res.json(); })
        .then(function (body) {
          if (my !== seq) return null;
          if (body && body.unavailable) { var er = new Error("slow"); er.slow = true; throw er; }
          var r = (body && body.results) || []; r.hint = body && body.hint; remember(r); return r;
        })
        .catch(function (e) {
          if (e && e.name === "AbortError") return null;
          if (my === seq) {
            if (e && e.slow) setStatus("The address service is slow, try again.", "warn", function () { var q2 = input.value.trim(); if (q2.length >= 3) { setStatus(""); run(q2, true); } });
            else setStatus("The address search is not available right now. Try again soon.", "warn");
          }
          return null;
        });
    }
    function run(q, fresh) {
      var key = q.toLowerCase().replace(/\s+/g, " ");
      if (fresh) delete searchCache[key];
      if (searchCache[key]) { results = searchCache[key]; active = -1; searching = false; paint(); setStatus(""); return Promise.resolve(results); }
      searching = true; paint(); // the previous suggestions stay up while the new ones load
      return search(q).then(function (r) {
        searching = false;
        if (r == null) { paint(); return null; }
        searchCache[key] = r;
        results = r; active = -1; paint();
        setStatus(r.length ? (r.hint ? "Add a house number to find your exact address." : "") : (r.hint ? "Add a house number, for example 12 " + q.replace(/^\d+\s*/, "") + "." : "No matching address found. Check the spelling, or try the street name and suburb."), r.length && !r.hint ? "" : (r.length ? "" : "warn"));
        return r;
      });
    }
    function choose(i) {
      var r = results[i]; if (!r) return;
      close(); results = [];
      searches.forEach(function (c) { c.input.value = r.label; });
      setStatus("");
      openAddress(r.label, r);
    }
    function submit() {
      var q = input.value.trim();
      if (q.length < 3) { setStatus("Type your street address first.", "warn"); return; }
      if (active >= 0) { choose(active); return; }
      var known = shownFor(q); // exactly a suggestion already shown: use its coordinates, no second search
      if (known) { results = [known]; choose(0); return; }
      setBusy(true);
      run(q).then(function (r) { if (r && r.length) choose(0); else setBusy(false); });
    }
    input.addEventListener("input", function () {
      clearTimeout(timer); var q = input.value.trim();
      if (q.length < 3) { if (ctl) ctl.abort(); seq++; results = []; searching = false; paint(); setStatus(""); return; }
      timer = setTimeout(function () { run(q); }, 150);
    });
    input.addEventListener("focus", function () { if (results.length) paint(); });
    input.addEventListener("blur", function () { setTimeout(close, 140); });
    input.addEventListener("keydown", function (e) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        if (!results.length) return; e.preventDefault();
        var n = Math.min(results.length, max); active = (active + (e.key === "ArrowDown" ? 1 : -1) + n) % n; paint();
      } else if (e.key === "Enter") { e.preventDefault(); submit(); }
      else if (e.key === "Escape" && !list.hidden) { e.preventDefault(); close(); }
    });
    var go = root.querySelector(".as-go"); if (go) go.addEventListener("click", submit);
  });
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
      else if (f || r) {
        // No Stripe link yet: order by email instead, naming the chosen add-ons.
        var what = f && r ? "fly-through and renders" : f ? "fly-through" : "renders";
        var base = cfg.orderUrl || ("mailto:" + (cfg.email || ""));
        pay.href = base.split("?")[0] + "?subject=" + encodeURIComponent("Plan add-on order: " + what);
        pay.setAttribute("aria-disabled", "false"); pay.textContent = "Order by email"; note.textContent = "Email " + (cfg.email || "us") + ". We reply with a secure payment link.";
      }
      else { pay.removeAttribute("href"); pay.setAttribute("aria-disabled", "true"); pay.textContent = "Order by email"; note.textContent = "Choose an add-on, then order by email."; }
      if (url) pay.textContent = "Pay with Stripe";
    }
    root.addEventListener("change", upd); upd();
  });
  // builder login cost calculator: [data-login-calc] with [data-calc-range], [data-calc-topups], [data-calc-n], [data-calc-total], [data-calc-line]
  document.querySelectorAll("[data-login-calc]").forEach(function (root) {
    var range = root.querySelector("[data-calc-range]"), tops = root.querySelector("[data-calc-topups]"), nOut = root.querySelector("[data-calc-n]"), total = root.querySelector("[data-calc-total]"), line = root.querySelector("[data-calc-line]");
    function cost(n) { return n <= 15 ? n * 30 : 15 * 30 + (Math.min(n, 50) - 15) * 25; }
    function upd() {
      var n = Math.max(0, Math.min(60, parseInt(range.value, 10) || 0)), t = Math.max(0, Math.min(50, parseInt(tops.value, 10) || 0));
      var billed = Math.min(n, 50), sum = cost(n) + t * 10, parts = [];
      if (nOut) nOut.textContent = n;
      if (billed > 0) { parts.push(billed <= 15 ? billed + " logins at A$30" : "15 logins at A$30 and " + (billed - 15) + " at A$25"); }
      if (t > 0) parts.push(t + (t === 1 ? " top up" : " top ups") + " at A$10");
      total.textContent = "A$" + sum.toLocaleString("en-AU");
      var msg = parts.length ? parts.join(", ") + ". A$" + sum.toLocaleString("en-AU") + " in total." : "No client logins, nothing to pay.";
      if (n > 50) { total.textContent = "A$" + sum.toLocaleString("en-AU") + " for the first 50"; msg = "Above 50 logins in a month the price is custom, so the figure covers the first 50 only. " + msg; }
      line.textContent = msg;
    }
    range.addEventListener("input", upd); tops.addEventListener("input", upd); upd();
  });
  // reveal on scroll
  if ("IntersectionObserver" in window && !matchMedia("(prefers-reduced-motion: reduce)").matches) {
    document.documentElement.classList.add("js");
    var io = new IntersectionObserver(function (es) { es.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); } }); }, { threshold: .12 });
    document.querySelectorAll(".section-head,.sec-head,.feature,.audience .card,.price-card,.flow,.rules,.steps li,.seq li,.split>.shot,.sheets,.rooms-stage,.tiers,.rate,.trust").forEach(function (el) { el.classList.add("reveal"); io.observe(el); });
  }
  // home hero stage: address types in, the render settles, the card rises; then the card UI gently cycles colours and rooms
  var reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  document.querySelectorAll("[data-stage]").forEach(function (st) {
    document.documentElement.classList.add("js");
    var img = st.querySelector(".stage-img img"), typed = st.querySelector(".st-type");
    var sw = [].slice.call(st.querySelectorAll("[data-swatches] button")), nameEl = st.querySelector("[data-scheme-name]");
    var pills = [].slice.call(st.querySelectorAll("[data-pills] span")), carN = st.querySelector("[data-car-n]");
    var si = 0, pi = pills.length - 1, ci = 0, timer = null, visible = true;
    function pick(i) { si = (i + sw.length) % sw.length; sw.forEach(function (b, k) { b.setAttribute("aria-pressed", k === si); }); if (nameEl) nameEl.textContent = sw[si].dataset.name; }
    sw.forEach(function (b, k) { b.addEventListener("click", function () { pick(k); stop(); }); });
    st.querySelectorAll("[data-car]").forEach(function (b) { b.addEventListener("click", function () { ci = (ci + Number(b.dataset.car) + 3) % 3; if (carN) carN.textContent = ci + 1; pick(si + Number(b.dataset.car)); stop(); }); });
    function tick() { if (!visible) return; pick(si + 1); pills.forEach(function (p) { p.classList.remove("on"); }); pi = (pi + 1) % pills.length; pills[pi].classList.add("on"); }
    function start() { if (!reduce && !timer && sw.length) timer = setInterval(tick, 2600); }
    function stop() { clearInterval(timer); timer = null; }
    if ("IntersectionObserver" in window) new IntersectionObserver(function (es) { visible = es[0].isIntersecting; }).observe(st);
    function reveal() { st.classList.add("is-in"); setTimeout(start, 2200); }
    if (reduce || !typed) { if (img && !img.complete) img.addEventListener("load", reveal); else reveal(); return; }
    var full = typed.dataset.type || typed.textContent, n = 0; typed.textContent = ""; typed.classList.add("typing");
    reveal(); // the hero is visible at once; the typing is only a cosmetic flourish on the address text
    (function step() { n++; typed.textContent = full.slice(0, n); if (n < full.length) setTimeout(step, 38 + Math.random() * 40); else { setTimeout(function () { typed.classList.remove("typing"); }, 250); } })();
  });
  // rooms tabs: [data-rooms] buttons[data-room] switch img[data-room-img]
  document.querySelectorAll("[data-rooms]").forEach(function (tabs) {
    var sec = tabs.closest("section") || document;
    tabs.addEventListener("click", function (e) {
      var b = e.target.closest("[data-room]"); if (!b) return;
      tabs.querySelectorAll("[data-room]").forEach(function (x) { x.setAttribute("aria-selected", x === b); });
      sec.querySelectorAll("[data-room-img]").forEach(function (im) { im.hidden = im.dataset.roomImg !== b.dataset.room; if (!im.hidden) im.loading = "eager"; });
    });
  });
})();
