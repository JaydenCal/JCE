/* Enquiry and demo booking forms. Posts to the existing POST /api/enquiry/jce endpoint (server/lib/enquiry.js), which saves
   the request first and returns { ok, reference, emailed }. No server change: a demo booking is marked in the free text
   notes ("DEMO BOOKING") and projectName ("Demo booking"). The endpoint needs consent, name, phone, email and a valid need. */
(function () {
  var FALLBACK_EMAIL = "enquiries@jceinfrastructure.com.au";
  function apiBase() { return (window.GI_CONFIG && window.GI_CONFIG.apiBase) || "/api"; }
  function ddmmyyyy(iso) { var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || ""); return m ? m[3] + "/" + m[2] + "/" + m[1] : iso || ""; }
  function bind(form) {
    var kind = form.getAttribute("data-enquiry-form"), wrap = form.parentNode;
    var err = form.querySelector(".ef-error"), btn = form.querySelector("button[type=submit]"), done = wrap.querySelector(".ef-done");
    function show(msg, withEmail) {
      err.textContent = msg || "";
      if (msg && withEmail) {
        err.appendChild(document.createTextNode(" You can email us at "));
        var s = document.createElement("span"); s.className = "ef-mail"; s.textContent = FALLBACK_EMAIL; err.appendChild(s);
        err.appendChild(document.createTextNode("."));
      }
      err.hidden = !msg;
    }
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var f = form.elements, g = function (n) { return f[n] ? (f[n].value || "").trim() : ""; };
      show("");
      if (!g("name")) return show("Enter your name.");
      if (kind === "demo" && !g("company")) return show("Enter your company name.");
      if (!/[0-9]{6,}/.test(g("phone").replace(/[\s()+-]/g, ""))) return show("Enter a valid phone number.");
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(g("email"))) return show("Enter a valid email address.");
      if (kind === "demo" && !g("day")) return show("Choose a preferred day.");
      if (kind === "demo" && !form.querySelector("input[name=time]:checked")) return show("Choose morning or afternoon.");
      if (kind === "general" && !g("message")) return show("Enter your message.");
      if (!f.consent.checked) return show("Tick the box so we can contact you.");
      var notes, projectName, orgName = "";
      if (kind === "demo") {
        var t = form.querySelector("input[name=time]:checked").value;
        notes = ["DEMO BOOKING (20 minutes on the client's own lots)", "Company: " + g("company"), "Preferred day: " + ddmmyyyy(g("day")), "Preferred time: " + t, g("note") ? "Note: " + g("note") : null].filter(Boolean).join("\n");
        projectName = "Demo booking"; orgName = g("company");
      } else {
        notes = "GENERAL ENQUIRY\n" + g("message"); projectName = "General enquiry";
      }
      var body = { name: g("name"), phone: g("phone"), email: g("email"), need: "engineering", notes: notes, consent: true, lot: {}, source: "public", orgName: orgName, projectName: projectName };
      btn.disabled = true;
      fetch(apiBase() + "/enquiry/jce", { method: "POST", headers: { "content-type": "application/json", "x-gi-request": "1" }, body: JSON.stringify(body) })
        .then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { return { ok: r.ok, d: d || {} }; }); })
        .then(function (x) {
          var ref = x.d.reference || (x.d.error && x.d.error.reference);
          // EMAIL_FAILED (502) still means the request was saved: show the reference.
          var saved = x.ok || x.d.saved || (x.d.error && x.d.error.saved);
          if (saved && ref) {
            form.hidden = true; done.hidden = false; done.querySelector(".ef-ref").textContent = ref;
            try { done.scrollIntoView({ block: "center", behavior: "smooth" }); } catch (_) {}
            try { if (window.gtag) window.gtag("event", kind === "demo" ? "book_demo_submit" : "enquiry_submit", { page: location.pathname }); } catch (_) {}
            return;
          }
          var m = (x.d.error && x.d.error.message) || x.d.message || "That did not send.";
          show(m, true); btn.disabled = false;
        })
        .catch(function () { show("Could not reach the server.", true); btn.disabled = false; });
    });
  }
  Array.prototype.forEach.call(document.querySelectorAll("[data-enquiry-form]"), bind);
})();
