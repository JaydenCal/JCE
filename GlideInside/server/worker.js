// Pocket Architect API. Cloudflare Worker + D1. Web-standard fetch/WebCrypto only.
// Implements the contract the app expects (PS-SCOPE-001 section 11): checkout, webhook, entitlement, restore,
// credits, health, and a one-PDF-set-per-job export guard. AI and file generation are plug-in points (see hooks).
const J = (o, s = 200, h = {}) => new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json", ...h } });
const err = (s, code, message, extra = {}) => J({ error: { code, message, ...extra } }, s);
const b64u = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const hmac = async (secret, data) => {
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return crypto.subtle.sign("HMAC", k, new TextEncoder().encode(data));
};
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
const cors = (env) => ({ "access-control-allow-origin": env.SITE_URL, "access-control-allow-headers": "authorization,content-type", "access-control-allow-methods": "GET,POST,OPTIONS", vary: "origin" });

async function signToken(env, eid, pid) {
  const payload = b64u(new TextEncoder().encode(JSON.stringify({ eid, pid, exp: Date.now() + (+env.ENTITLEMENT_DAYS || 365) * 864e5 })));
  return payload + "." + b64u(await hmac(env.ENTITLEMENT_SECRET, payload));
}
async function auth(req, env) { // token grants nothing alone: the row is re-checked every call
  const t = (req.headers.get("authorization") || "").replace(/^Bearer /, "");
  const [p, s] = t.split(".");
  if (!p || !s || b64u(await hmac(env.ENTITLEMENT_SECRET, p)) !== s) return null;
  let d; try { d = JSON.parse(atob(p.replace(/-/g, "+").replace(/_/g, "/"))); } catch { return null; }
  if (d.exp < Date.now()) return null;
  const row = await env.DB.prepare("SELECT * FROM entitlements WHERE id=? AND project_id=? AND status='active'").bind(d.eid, d.pid).first();
  return row || null;
}
const credits = (e) => ({ total: e.credits_total, used: e.credits_used, remaining: e.credits_total - e.credits_used });

async function stripe(env, path, form) {
  const r = await fetch("https://api.stripe.com/v1/" + path, { method: "POST", headers: { authorization: "Bearer " + env.STRIPE_SECRET_KEY, "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(form) });
  const j = await r.json(); if (!r.ok) throw new Error(j.error?.message || "Stripe error"); return j;
}
async function verifyStripe(env, raw, header) {
  const p = Object.fromEntries((header || "").split(",").map((x) => x.split("=")));
  if (!p.t || !p.v1 || Math.abs(Date.now() / 1e3 - +p.t) > 300) return false;
  return hex(await hmac(env.STRIPE_WEBHOOK_SECRET, p.t + "." + raw)) === p.v1;
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url), path = url.pathname.replace(/^\/api/, ""), C = cors(env);
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: C });
    const out = async () => {
      if (path === "/health") return J({ ok: true, aiPaused: !env.ANTHROPIC_API_KEY });

      if (path === "/checkout" && req.method === "POST") {
        const { projectId, projectName } = await req.json().catch(() => ({}));
        if (!/^[\w-]{4,64}$/.test(projectId || "")) return err(400, "BAD_REQUEST", "Missing project.");
        const f = { mode: "payment", "payment_method_types[0]": "card", customer_creation: "always", client_reference_id: projectId, "metadata[projectId]": projectId,
          success_url: `${env.APP_URL}?checkout=success&session_id={CHECKOUT_SESSION_ID}&project=${projectId}`, cancel_url: `${env.APP_URL}?checkout=cancel`,
          "line_items[0][quantity]": "1", "payment_intent_data[description]": `Pocket Architect plan: ${String(projectName || projectId).slice(0, 60)}` };
        if (env.STRIPE_PRICE_ID) f["line_items[0][price]"] = env.STRIPE_PRICE_ID;
        else Object.assign(f, { "line_items[0][price_data][currency]": "aud", "line_items[0][price_data][unit_amount]": env.PLAN_PRICE_CENTS || "3500", "line_items[0][price_data][product_data][name]": "Pocket Architect plan (one job)" });
        const s = await stripe(env, "checkout/sessions", f); return J({ url: s.url });
      }

      if (path === "/stripe/webhook" && req.method === "POST") {
        const raw = await req.text();
        if (!(await verifyStripe(env, raw, req.headers.get("stripe-signature")))) return err(400, "BAD_REQUEST", "Bad signature.");
        const ev = JSON.parse(raw);
        const seen = await env.DB.prepare("INSERT OR IGNORE INTO webhook_events(id,type,received_at) VALUES(?,?,?)").bind(ev.id, ev.type, new Date().toISOString()).run();
        if (!seen.meta.changes) return J({ ok: true, duplicate: true });
        const o = ev.data.object;
        if (ev.type === "checkout.session.completed" && o.payment_status === "paid") {
          const pid = o.client_reference_id || o.metadata?.projectId;
          await env.DB.prepare("INSERT OR IGNORE INTO entitlements(id,project_id,email,stripe_session_id,payment_intent,amount_cents,currency,credits_total,pdf_used,pdf_allowed,status,created_at,expires_at) VALUES(?,?,?,?,?,?,?,?,0,1,'active',?,?)")
            .bind("e_" + crypto.randomUUID().slice(0, 12), pid, (o.customer_details?.email || "").toLowerCase(), o.id, o.payment_intent, o.amount_total, o.currency, +env.PLAN_PACK_CREDITS || 500, new Date().toISOString(), new Date(Date.now() + (+env.ENTITLEMENT_DAYS || 365) * 864e5).toISOString()).run();
        } else if (ev.type === "charge.refunded") {
          await env.DB.prepare("UPDATE entitlements SET status='refunded' WHERE payment_intent=?").bind(o.payment_intent).run();
        }
        return J({ ok: true });
      }

      if (path === "/entitlement" && req.method === "GET") {
        const sid = url.searchParams.get("session_id"), pid = url.searchParams.get("project");
        const e = await env.DB.prepare("SELECT * FROM entitlements WHERE stripe_session_id=? AND project_id=? AND status='active'").bind(sid, pid).first();
        if (!e) return err(404, "NOT_ENTITLED", "Payment not confirmed yet.", { pending: true });
        return J({ token: await signToken(env, e.id, pid), credits: credits(e) });
      }

      if (path === "/entitlement/restore" && req.method === "POST") { // email + Stripe session id or receipt (payment intent) must both match
        const { email, sessionOrReceipt } = await req.json().catch(() => ({}));
        const e = await env.DB.prepare("SELECT * FROM entitlements WHERE email=? AND (stripe_session_id=? OR payment_intent=?) AND status='active'").bind((email || "").toLowerCase().trim(), sessionOrReceipt || "", sessionOrReceipt || "").first();
        if (!e) return err(404, "NOT_ENTITLED", "We could not find a matching purchase.");
        return J({ token: await signToken(env, e.id, e.project_id), project: e.project_id, credits: credits(e) });
      }

      const e = await auth(req, env);
      if (!e) return err(401, "UNAUTHORISED", "Please restore your purchase.");
      if (path === "/credits") return J({ ...credits(e), warnLevel: 0 });

      if (path === "/export/pdf" && req.method === "POST") {
        // ONE PDF set per job. Single atomic UPDATE; zero rows changed means the set was already issued.
        const body = await req.text(); if (body.length > (+env.EXPORT_MAX_PROJECT_BYTES || 2e6)) return err(413, "PAYLOAD_TOO_LARGE", "Project too large.");
        const own = await env.DB.prepare("SELECT pdf_file FROM entitlements WHERE id=?").bind(e.id).first();
        if (own?.pdf_file) { const f = await env.FILES.get(own.pdf_file); if (f) return new Response(f.body, { headers: { "content-type": "application/pdf", "content-disposition": 'attachment; filename="plans.pdf"', ...C } }); } // same stored file, not a new set
        const u = await env.DB.prepare("UPDATE entitlements SET pdf_used=pdf_used+1 WHERE id=? AND pdf_used<pdf_allowed").bind(e.id).run();
        if (!u.meta.changes) return err(403, "PDF_LIMIT_REACHED", "The PDF plan set for this job has already been issued.");
        if (!globalThis.generatePdf) { await env.DB.prepare("UPDATE entitlements SET pdf_used=pdf_used-1 WHERE id=?").bind(e.id).run(); return err(501, "EXPORT_NOT_CONFIGURED", "PDF generator not installed on the server."); }
        let bytes; try { bytes = await globalThis.generatePdf(JSON.parse(body).project); } catch (x) { await env.DB.prepare("UPDATE entitlements SET pdf_used=pdf_used-1 WHERE id=?").bind(e.id).run(); return err(500, "EXPORT_FAILED", "Could not build the PDF. You have not been charged a set."); }
        const key = `pdf/${e.id}.pdf`; await env.FILES.put(key, bytes); await env.DB.prepare("UPDATE entitlements SET pdf_file=? WHERE id=?").bind(key, e.id).run();
        return new Response(bytes, { headers: { "content-type": "application/pdf", "content-disposition": 'attachment; filename="plans.pdf"' } });
      }
      if (path.startsWith("/export/")) return err(501, "EXPORT_NOT_CONFIGURED", "This export is not installed on the server yet.");
      if (path.startsWith("/ai/")) return err(503, "AI_PAUSED", "The AI assistant is not available yet.");
      return err(404, "BAD_REQUEST", "Not found.");
    };
    try { const r = await out(); Object.entries(C).forEach(([k, v]) => r.headers.set(k, v)); return r; }
    catch (x) { return err(500, "ERROR", "Something went wrong."); }
  },
};
