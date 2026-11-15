/* Glide Inside AI booking assistant: LAUNCHER STUB (about 4 KB). Loaded on marketing pages only, and only when site.config.js sets
   conciergeEnabled: true. The panel (concierge.css and concierge.js) is fetched on first click, never before.
   It never runs inside the Glide Inside app, the builder portal or any iframe, and it hides itself while an embedded viewer is on screen. */
(function () {
  "use strict";
  var cfg = window.GI_CONFIG || {};
  if (!cfg.conciergeEnabled) return;
  var path = location.pathname;
  if (/\/(plan-studio|portal)(\/|$)/.test(path)) return;
  try { if (window.parent !== window) return; } catch (e) { return; }

  var src = (document.currentScript && document.currentScript.src) || "";
  var base = src ? src.replace(/[^\/]*$/, "") : new URL("assets/concierge/", location.href).href;
  var root = base.replace(/assets\/concierge\/$/, "");
  var LABELS = [[/book-a-demo/, "Book a time"], [/for-builders/, "Builder questions"], [/commercial/, "Commercial questions"], [/pricing/, "Pricing questions"]];
  var label = "Ask our AI assistant";
  for (var i = 0; i < LABELS.length; i++) if (LABELS[i][0].test(path)) { label = LABELS[i][1]; break; }

  var btn = document.createElement("button");
  btn.type = "button"; btn.className = "gic-launcher"; btn.setAttribute("aria-haspopup", "dialog");
  btn.setAttribute("aria-label", label + " (AI assistant)");
  btn.innerHTML = '<span class="gic-dot" aria-hidden="true"></span><span class="gic-lt">' + label + '</span><span class="gic-ai" aria-hidden="true">AI</span>';
  var style = document.createElement("style");
  style.textContent = ".gic-launcher{position:fixed;right:16px;bottom:16px;z-index:60;display:inline-flex;align-items:center;gap:9px;padding:10px 14px;border-radius:999px;border:1px solid rgba(255,255,255,.14);background:#0a111e;color:#eef1f6;font:700 14px/1 Manrope,'Segoe UI',Arial,sans-serif;cursor:pointer;box-shadow:0 14px 34px -14px rgba(6,11,22,.7)}.gic-launcher:hover{background:#121b2b}.gic-launcher:focus-visible{outline:3px solid #4f8fe0;outline-offset:3px}.gic-launcher .gic-dot{width:9px;height:9px;border-radius:50%;background:#e9b66f}.gic-launcher .gic-ai{font-size:10px;letter-spacing:.06em;border:1px solid rgba(233,182,111,.6);color:#e9b66f;border-radius:5px;padding:2px 4px}.gic-launcher[hidden]{display:none}.gic-launcher.gic-compact{width:48px;height:48px;padding:0;justify-content:center}.gic-launcher.gic-compact .gic-lt,.gic-launcher.gic-compact .gic-dot{display:none}.gic-launcher.gic-compact .gic-ai{font-size:12px;border:0;padding:0}@media(max-width:480px){.gic-launcher .gic-lt{max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}}";
  document.head.appendChild(style);
  document.body.appendChild(btn);

  // Never cover an embedded viewer. If the full pill would overlap one, shrink to a small round button; if that still overlaps, hide until
  // the viewer has scrolled away. Also hidden while anything is full screen.
  var viewers = document.querySelectorAll(".viewport, #live-tool, iframe[src*='plan-studio']");
  var open = false, tick = 0;
  function overlaps() {
    var b = btn.getBoundingClientRect();
    for (var i = 0; i < viewers.length; i++) {
      var r = viewers[i].getBoundingClientRect();
      if (r.width && r.height && b.left < r.right + 8 && b.right > r.left - 8 && b.top < r.bottom + 8 && b.bottom > r.top - 8) return true;
    }
    return false;
  }
  function sync() {
    tick = 0;
    if (open || document.fullscreenElement) { btn.hidden = true; return; }
    btn.hidden = false; btn.classList.remove("gic-compact");
    if (!viewers.length || !overlaps()) return;
    btn.classList.add("gic-compact");
    if (overlaps()) btn.hidden = true;
  }
  function soon() { if (!tick) tick = requestAnimationFrame(sync); }
  window.addEventListener("scroll", soon, { passive: true }); window.addEventListener("resize", soon);
  document.addEventListener("fullscreenchange", soon); window.addEventListener("load", soon);
  if ("ResizeObserver" in window) { var ro = new ResizeObserver(soon); viewers.forEach(function (v) { ro.observe(v); }); }
  sync();

  var loading = null;
  function load() {
    if (loading) return loading;
    loading = new Promise(function (ok, fail) {
      var l = document.createElement("link"); l.rel = "stylesheet"; l.href = base + "concierge.css?v=20261115a"; document.head.appendChild(l);
      var s = document.createElement("script"); s.src = base + "concierge.js?v=20261115a"; s.onload = ok; s.onerror = fail; document.head.appendChild(s);
    });
    return loading;
  }
  function openPanel(manage) {
    load().then(function () { open = true; sync(); window.GIConcierge.open({ root: root, page: path, label: label, manage: manage || null, onClose: function () { open = false; sync(); btn.focus(); } }); })
      .catch(function () { loading = null; location.href = root + "book-a-demo/"; }); // the panel could not load: use the ordinary form
  }
  btn.addEventListener("click", function () { openPanel(); });
  var m = /^#gi-manage=([A-Z0-9-]{6,20})\.([A-Za-z0-9_-]{20,80})$/.exec(location.hash);
  if (m) openPanel({ ref: m[1], token: m[2] });
})();
