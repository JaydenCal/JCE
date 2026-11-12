/* Glide Inside builder picker: searchable combobox, then Client / Builder representative routing. */
(function () {
  var BUILDERS = [
    ["McDonald Jones Homes", "mcdonald-jones"], ["Hunter Homes", "hunter-homes"], ["Masterton Homes", "masterton"],
    ["Coral Homes", "coral-homes"], ["Hotondo Homes", "hotondo"], ["MOJO Homes", "mojo"],
    ["Montgomery Homes", "montgomery"], ["Allworth Homes", "allworth"], ["Tulliplan Homes", "tulliplan"],
    ["G.J. Gardner Homes", "gj-gardner"]
  ];
  var OPTS = BUILDERS.map(function (b) { return { name: b[0], slug: b[1] }; });
  OPTS.push({ name: "Other builder", slug: "other", sep: true });
  OPTS.push({ name: "I don't have a builder", slug: "none" });
  var KEY = "gi.builderPick";

  function route(slug, role) {
    if (slug === "none") return "/plan-studio/app/";
    if (slug === "other") return role === "builder" ? "/for-builders/#trial" : "/portal/?role=client";
    return "/portal/?builder=" + encodeURIComponent(slug) + "&role=" + role;
  }
  function load() { try { return JSON.parse(localStorage.getItem(KEY) || "null"); } catch (_) { return null; } }
  function save(o) { try { localStorage.setItem(KEY, JSON.stringify(o)); } catch (_) {} }

  var root = document.getElementById("builder-picker");
  if (!root) return;
  var input = root.querySelector(".bp-input"), list = root.querySelector(".bp-list"), toggle = root.querySelector(".bp-toggle");
  var acts = root.querySelector(".bp-acts"), btnClient = root.querySelector("[data-role=client]"), btnRep = root.querySelector("[data-role=builder]");
  var chosen = null, shown = [], active = -1, lastRole = null;

  function track(slug, role) { try { if (window.gtag) window.gtag("event", "builder_pick", { builder: slug, role: role }); } catch (_) {} }

  function render() {
    var q = input.value.trim().toLowerCase();
    if (chosen && input.value === chosen.name) q = "";
    // rank: name prefix, then word prefix, then substring, then slug match; original order within a rank
    function rank(o) {
      var n = o.name.toLowerCase();
      if (n.indexOf(q) === 0) return 0;
      if (n.split(/[^a-z0-9']+/).some(function (w) { return w.indexOf(q) === 0; })) return 1;
      if (n.indexOf(q) !== -1) return 2;
      if (o.slug.indexOf(q.replace(/\s+/g, "-")) !== -1) return 3;
      return -1;
    }
    shown = !q ? OPTS.slice() : OPTS.map(function (o, i) { return { o: o, i: i, r: rank(o) }; })
      .filter(function (x) { return x.r >= 0; })
      .sort(function (a, b) { return a.r - b.r || a.i - b.i; })
      .map(function (x) { return x.o; });
    list.innerHTML = "";
    if (!shown.length) { var e = document.createElement("li"); e.className = "bp-empty"; e.setAttribute("role", "presentation"); e.textContent = "No match. Choose Other builder below."; list.appendChild(e); shown = [OPTS[OPTS.length - 2]]; }
    shown.forEach(function (o, i) {
      var li = document.createElement("li");
      li.id = "bp-o-" + i; li.setAttribute("role", "option"); li.className = "bp-opt" + (o.sep ? " sep" : "");
      li.setAttribute("aria-selected", chosen && chosen.slug === o.slug ? "true" : "false");
      li.textContent = o.name;
      li.addEventListener("mousedown", function (ev) { ev.preventDefault(); pick(o); });
      list.appendChild(li);
    });
    if (!list.querySelector(".bp-empty")) { /* keep list order */ }
    setActive(shown.length && q ? 0 : -1);
  }
  function setActive(i) {
    active = i;
    var kids = list.querySelectorAll(".bp-opt");
    Array.prototype.forEach.call(kids, function (k, n) { k.classList.toggle("is-active", n === i); });
    if (i >= 0 && kids[i]) { input.setAttribute("aria-activedescendant", kids[i].id); kids[i].scrollIntoView({ block: "nearest" }); }
    else input.removeAttribute("aria-activedescendant");
  }
  function open() { render(); list.hidden = false; input.setAttribute("aria-expanded", "true"); toggle.setAttribute("aria-expanded", "true"); }
  function close() { list.hidden = true; input.setAttribute("aria-expanded", "false"); toggle.setAttribute("aria-expanded", "false"); input.removeAttribute("aria-activedescendant"); }

  function showActions() {
    if (!chosen) { acts.hidden = true; return; }
    acts.hidden = false;
    var none = chosen.slug === "none";
    acts.classList.toggle("one", none);
    if (none) {
      btnClient.hidden = true; btnRep.hidden = false;
      btnRep.innerHTML = "Open Pocket Architect<span>Free to draw. No account needed.</span>";
      btnRep.href = route("none", "client"); btnRep.className = "bp-btn primary";
      return;
    }
    btnClient.hidden = false; btnRep.hidden = false;
    btnClient.innerHTML = "I'm a client<span>Sign in to design on your own block.</span>";
    btnRep.innerHTML = "I'm a builder representative<span>Sign in to manage your house library.</span>";
    btnClient.href = route(chosen.slug, "client"); btnRep.href = route(chosen.slug, "builder");
    btnClient.className = "bp-btn" + (lastRole === "client" ? " primary last" : "");
    btnRep.className = "bp-btn" + (lastRole === "builder" ? " primary last" : "");
    if (!lastRole) btnClient.className = "bp-btn primary";
  }
  function pick(o) {
    chosen = o; input.value = o.name; close(); showActions();
    save({ slug: o.slug, role: lastRole });
    try { acts.querySelector("a:not([hidden])").scrollIntoView({ block: "nearest", behavior: "smooth" }); } catch (_) {}
  }

  input.addEventListener("focus", function () { if (list.hidden) { input.select(); open(); } });
  input.addEventListener("click", function () { if (list.hidden) open(); });
  input.addEventListener("input", function () { chosen = null; showActions(); if (list.hidden) open(); else render(); });
  input.addEventListener("blur", function () { setTimeout(close, 120); });
  toggle.addEventListener("mousedown", function (ev) { ev.preventDefault(); });
  toggle.addEventListener("click", function () { if (list.hidden) { input.focus(); open(); } else close(); });
  input.addEventListener("keydown", function (ev) {
    var k = ev.key;
    if (k === "ArrowDown") { ev.preventDefault(); if (list.hidden) open(); setActive(Math.min(shown.length - 1, active + 1)); }
    else if (k === "ArrowUp") { ev.preventDefault(); if (list.hidden) open(); setActive(Math.max(0, active - 1)); }
    else if (k === "Enter") { if (!list.hidden && active >= 0) { ev.preventDefault(); pick(shown[active]); } }
    else if (k === "Escape") { close(); }
    else if (k === "Home" && !list.hidden) { ev.preventDefault(); setActive(0); }
    else if (k === "End" && !list.hidden) { ev.preventDefault(); setActive(shown.length - 1); }
  });
  acts.addEventListener("click", function (ev) {
    var a = ev.target.closest("a"); if (!a || !chosen) return;
    var role = a.getAttribute("data-role") || "client";
    save({ slug: chosen.slug, role: role }); track(chosen.slug, role);
  });

  Array.prototype.forEach.call(document.querySelectorAll("[data-bp-link]"), function (a) {
    a.addEventListener("click", function (ev) {
      ev.preventDefault(); root.scrollIntoView({ behavior: "smooth", block: "center" });
      setTimeout(function () { try { input.focus({ preventScroll: true }); } catch (_) {} }, 450);
    });
  });

  var prev = load();
  if (prev && prev.slug) {
    var o = OPTS.filter(function (x) { return x.slug === prev.slug; })[0];
    if (o) { lastRole = prev.role === "builder" || prev.role === "client" ? prev.role : null; chosen = o; input.value = o.name; showActions(); }
  }
})();
