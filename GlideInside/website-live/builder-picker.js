/* Glide Inside builder access: a private code or link, never a public list of builders.
   The code is the private portal link name your builder sent you. It is cleaned and sent to /portal/?builder=<code>;
   the portal checks it with the server and shows a polite message when it is not recognised. */
(function () {
  var form = document.getElementById("bp-form");
  if (!form) return;
  var input = document.getElementById("bp-input"), msg = document.getElementById("bp-msg");

  function clean(v) {
    v = String(v || "").trim();
    // accept a pasted private link as well as a bare code
    var m = v.match(/[?&](?:builder|b)=([^&#\s]+)/i);
    if (m) { try { v = decodeURIComponent(m[1]); } catch (_) { v = m[1]; } }
    v = v.toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40).replace(/-+$/, "");
    return v;
  }
  function say(t) { msg.textContent = t; msg.hidden = !t; }

  form.addEventListener("submit", function (ev) {
    ev.preventDefault();
    var code = clean(input.value);
    if (!code) { say("Enter the access code your builder gave you, or open the private link they sent."); input.focus(); return; }
    say("");
    try { if (window.gtag) window.gtag("event", "builder_code_continue", { role: "client" }); } catch (_) {}
    location.href = "/portal/?builder=" + encodeURIComponent(code) + "&role=client";
  });
  input.addEventListener("input", function () { say(""); });

  Array.prototype.forEach.call(document.querySelectorAll("[data-bp-link]"), function (a) {
    a.addEventListener("click", function (ev) {
      ev.preventDefault(); form.scrollIntoView({ behavior: "smooth", block: "center" });
      setTimeout(function () { try { input.focus({ preventScroll: true }); } catch (_) {} }, 450);
    });
  });
  try { localStorage.removeItem("gi.builderPick"); } catch (_) {}
})();
