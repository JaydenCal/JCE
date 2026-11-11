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
const same = (a, b) => { a = String(a); b = String(b); let d = a.length ^ b.length; for (let i = 0; i < b.length; i++) d |= a.charCodeAt(i % (a.length || 1)) ^ b.charCodeAt(i); return d === 0; };
const cors = (env) => ({ ...(env.SITE_URL ? { "access-control-allow-origin": env.SITE_URL } : {}), "access-control-allow-headers": "authorization,content-type,x-edit-key", "access-control-allow-methods": "GET,POST,PUT,OPTIONS", vary: "origin" });

async function signToken(env, row, pid = row.project_id) {
  const exp = row.expires_at ? Math.floor(Date.parse(row.expires_at) / 1e3) : Math.floor(Date.now() / 1e3) + (+env.ENTITLEMENT_DAYS || 365) * 86400;
  const payload = b64u(new TextEncoder().encode(JSON.stringify({ eid: row.id, pid, exp })));
  return payload + "." + b64u(await hmac(env.ENTITLEMENT_SECRET, payload));
}
async function auth(req, env) { // token grants nothing alone: the row is re-checked every call
  const t = (req.headers.get("authorization") || "").replace(/^Bearer /, "");
  const [p, s] = t.split(".");
  if (!p || !s || !env.ENTITLEMENT_SECRET || !same(b64u(await hmac(env.ENTITLEMENT_SECRET, p)), s)) return null;
  let d; try { d = JSON.parse(atob(p.replace(/-/g, "+").replace(/_/g, "/"))); } catch { return null; }
  if (!(d.exp * 1e3 > Date.now())) return null;
  const row = await env.DB.prepare("SELECT * FROM entitlements WHERE id=? AND (project_id=? OR project_id='*') AND status='active' AND (expires_at IS NULL OR expires_at>?)").bind(d.eid, d.pid, new Date().toISOString()).first();
  return row || null;
}
const credits = (e) => ({ total: e.credits_total, used: e.credits_used, remaining: e.credits_total - e.credits_used });

class StripeError extends Error {}
async function stripe(env, path, form) {
  let r, j;
  try {
    r = await fetch((env.STRIPE_API_BASE || "https://api.stripe.com").replace(/\/+$/, "") + "/v1/" + path, { method: "POST", headers: { authorization: "Bearer " + env.STRIPE_SECRET_KEY, "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(form), signal: AbortSignal.timeout(15000) });
    j = await r.json();
  } catch { throw new StripeError("Stripe unreachable"); }
  if (!r.ok || !j || typeof j !== "object") throw new StripeError(j?.error?.message || "Stripe error");
  return j;
}
async function verifyStripe(env, raw, header) {
  let t = "", sigs = [];
  for (const part of String(header || "").split(",")) { const i = part.indexOf("="); if (i < 0) continue; const k = part.slice(0, i).trim(), v = part.slice(i + 1).trim(); if (k === "t") t = v; else if (k === "v1") sigs.push(v); }
  if (!/^\d{1,12}$/.test(t) || !sigs.length || Math.abs(Date.now() / 1e3 - +t) > 300) return false;
  const want = hex(await hmac(env.STRIPE_WEBHOOK_SECRET, t + "." + raw));
  return sigs.reduce((ok, v) => same(want, v) || ok, false);
}
const PID_RE = /^[\w-]{4,64}$/, WEBHOOK_MAX_BYTES = 1e6;
const planCents = (env) => +env.PLAN_PRICE_CENTS || 3500;
async function grantSession(env, o) {
  const pid = o.client_reference_id;
  if ((o.mode && o.mode !== "payment") || o.payment_status !== "paid" || (o.metadata?.app && o.metadata.app !== "pocket-architect") || !PID_RE.test(pid || "") || (o.metadata?.projectId && o.metadata.projectId !== pid)) return "ignored";
  if (String(o.currency).toLowerCase() !== "aud" || !(o.amount_total >= planCents(env))) return "ignored";
  const refunded = await env.DB.prepare("SELECT 1 AS x FROM webhook_events WHERE id=?").bind("refund:" + o.payment_intent).first();
  const disputed = await env.DB.prepare("SELECT 1 AS x FROM webhook_events WHERE id=?").bind("dispute:" + o.payment_intent).first();
  const now = new Date(), days = +env.ENTITLEMENT_DAYS || 365;
  await env.DB.prepare("INSERT OR IGNORE INTO entitlements(id,project_id,email,stripe_session_id,payment_intent,amount_cents,currency,credits_total,pdf_used,pdf_allowed,status,created_at,expires_at) VALUES(?,?,?,?,?,?,?,?,0,1,?,?,?)")
    .bind("ent_" + crypto.randomUUID().replace(/-/g, "").slice(0, 16), pid, String(o.customer_details?.email || o.customer_email || "").toLowerCase().trim(), o.id, o.payment_intent || null, o.amount_total, "aud", +env.PLAN_PACK_CREDITS || 500, refunded ? "refunded" : disputed ? "disputed" : "active", now.toISOString(), new Date(+now + days * 864e5).toISOString()).run();
  return "granted";
}
async function refundCharge(env, c) {
  if (!c.payment_intent || !(c.refunded === true || (c.amount > 0 && c.amount_refunded >= c.amount))) return "ignored";
  await env.DB.prepare("INSERT OR IGNORE INTO webhook_events(id,type,received_at) VALUES(?,?,?)").bind("refund:" + c.payment_intent, "refund-marker", new Date().toISOString()).run();
  await env.DB.prepare("UPDATE entitlements SET status='refunded' WHERE payment_intent=?").bind(c.payment_intent).run();
  return "refunded";
}
async function disputeEvent(env, d, opened) { // opened: charge.dispute.created. Closed in our favour: restore. Lost: stays disputed.
  const pi = d.payment_intent; if (!pi || typeof pi !== "string") return "ignored";
  if (opened) {
    await env.DB.prepare("INSERT OR IGNORE INTO webhook_events(id,type,received_at) VALUES(?,?,?)").bind("dispute:" + pi, "dispute-marker", new Date().toISOString()).run();
    await env.DB.prepare("UPDATE entitlements SET status='disputed' WHERE payment_intent=? AND status='active'").bind(pi).run();
    return "disputed";
  }
  if (d.status !== "won") return "ignored";
  await env.DB.prepare("DELETE FROM webhook_events WHERE id=?").bind("dispute:" + pi).run();
  await env.DB.prepare("UPDATE entitlements SET status='active' WHERE payment_intent=? AND status='disputed'").bind(pi).run();
  return "restored";
}
// Per-IP fixed-window limiter in D1. One atomic upsert: the WHERE stops the counter at max, so concurrent calls cannot exceed it.
async function ipLimit(env, req, scope, max, windowSec) {
  const ip = req.headers.get("cf-connecting-ip") || "", d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode((env.IP_HASH_SALT || "") + ip));
  const key = scope + ":" + hex(d), nowS = Math.floor(Date.now() / 1e3), win = Math.floor(nowS / windowSec);
  const u = await env.DB.prepare("INSERT INTO ip_rate(key, win, n) VALUES(?, ?, 1) ON CONFLICT(key, win) DO UPDATE SET n = n + 1 WHERE n < ?").bind(key, win, max).run();
  if (Math.random() < 0.02) await env.DB.prepare("DELETE FROM ip_rate WHERE win < ?").bind(win - 1).run().catch(() => null);
  if (u.meta.changes) return null;
  const ra = Math.max(1, (win + 1) * windowSec - nowS);
  return J({ error: { code: "RATE_LIMITED", message: "Too many attempts. Please wait a while and try again.", retryAfter: ra } }, 429, { "retry-after": String(ra) });
}
const entView = (e) => ({ projectId: e.project_id, receipt: e.id, expiresAt: e.expires_at, credits: credits(e) });

export default {
  async fetch(req, env) {
    const url = new URL(req.url), path = url.pathname.replace(/^\/api/, ""), C = cors(env);
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: C });
    const out = async () => {
      if (path === "/health") return J({ ok: true, sharing: !!env.FILES, aiPaused: !env.ANTHROPIC_API_KEY, paymentsConfigured: !!(env.STRIPE_SECRET_KEY && env.STRIPE_WEBHOOK_SECRET && env.ENTITLEMENT_SECRET) });

      if (path === "/checkout" && req.method === "POST") {
        const lim = await ipLimit(env, req, "checkout", +env.CHECKOUT_RATE_MAX || 20, 3600); if (lim) return lim;
        const { projectId, projectName, email } = await req.json().catch(() => ({}));
        if (!PID_RE.test(projectId || "")) return err(400, "BAD_REQUEST", "Missing project.");
        if (!env.STRIPE_SECRET_KEY || !env.APP_URL) return err(503, "PAYMENTS_UNAVAILABLE", "Payments are not available right now.");
        const label = String(projectName || projectId).slice(0, 60);
        const f = { mode: "payment", "payment_method_types[0]": "card", customer_creation: "always", client_reference_id: projectId, locale: "auto", "metadata[projectId]": projectId, "metadata[app]": "pocket-architect",
          success_url: `${env.APP_URL}?checkout=success&session_id={CHECKOUT_SESSION_ID}&project=${projectId}`, cancel_url: `${env.APP_URL}?checkout=cancel`,
          "line_items[0][quantity]": "1", "payment_intent_data[description]": `Pocket Architect plan: ${label}`, "payment_intent_data[metadata][projectId]": projectId,
          "invoice_creation[enabled]": "true", "invoice_creation[invoice_data][description]": `Pocket Architect plan (one job): ${label}`, "invoice_creation[invoice_data][metadata][projectId]": projectId };
        if (typeof email === "string" && email.length <= 254 && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) f.customer_email = email.trim();
        if (env.STRIPE_PRICE_ID) f["line_items[0][price]"] = env.STRIPE_PRICE_ID;
        else Object.assign(f, { "line_items[0][price_data][currency]": "aud", "line_items[0][price_data][unit_amount]": String(planCents(env)), "line_items[0][price_data][tax_behavior]": "inclusive", "line_items[0][price_data][product_data][name]": "Pocket Architect plan (one job)" });
        let s; try { s = await stripe(env, "checkout/sessions", f); } catch { return err(502, "PAYMENTS_UNAVAILABLE", "Payments are not available right now. Please try again soon."); }
        if (typeof s.url !== "string" || !s.url.startsWith("https://")) return err(502, "PAYMENTS_UNAVAILABLE", "Payments are not available right now. Please try again soon.");
        return J({ url: s.url });
      }

      if (path === "/stripe/webhook" && req.method === "POST") {
        if (!env.STRIPE_WEBHOOK_SECRET) return err(503, "PAYMENTS_UNAVAILABLE", "Webhook is not configured.");
        if (+req.headers.get("content-length") > WEBHOOK_MAX_BYTES) return err(413, "PAYLOAD_TOO_LARGE", "Body too large.");
        const raw = await req.text();
        if (raw.length > WEBHOOK_MAX_BYTES) return err(413, "PAYLOAD_TOO_LARGE", "Body too large.");
        if (!(await verifyStripe(env, raw, req.headers.get("stripe-signature")))) return err(400, "BAD_REQUEST", "Bad signature.");
        let ev; try { ev = JSON.parse(raw); } catch { return err(400, "BAD_REQUEST", "Bad payload."); }
        const o = ev?.data?.object;
        if (typeof ev?.id !== "string" || typeof ev.type !== "string" || !o || typeof o !== "object") return err(400, "BAD_REQUEST", "Bad payload.");
        if (await env.DB.prepare("SELECT 1 AS x FROM webhook_events WHERE id=?").bind(ev.id).first()) return J({ ok: true, duplicate: true });
        if (ev.type === "checkout.session.completed" || ev.type === "checkout.session.async_payment_succeeded") await grantSession(env, o);
        else if (ev.type === "charge.refunded") await refundCharge(env, o);
        else if (ev.type === "charge.dispute.created") await disputeEvent(env, o, true);
        else if (ev.type === "charge.dispute.closed") await disputeEvent(env, o, false);
        // the processed marker is written only after every write above succeeded; a throw gives a 500 and Stripe retries
        await env.DB.prepare("INSERT OR IGNORE INTO webhook_events(id,type,received_at) VALUES(?,?,?)").bind(ev.id, ev.type, new Date().toISOString()).run();
        return J({ ok: true });
      }

      if (path === "/entitlement" && req.method === "GET") {
        const sid = url.searchParams.get("session_id"), pid = url.searchParams.get("project");
        const e = sid && pid && await env.DB.prepare("SELECT * FROM entitlements WHERE stripe_session_id=? AND project_id=? AND status='active' AND (expires_at IS NULL OR expires_at>?)").bind(sid, pid, new Date().toISOString()).first();
        if (!e) return err(404, "NOT_ENTITLED", "Payment not confirmed yet.", { pending: true });
        return J({ token: await signToken(env, e), ...entView(e) }, 200, { "cache-control": "no-store" });
      }

      if (path === "/entitlement/restore" && req.method === "POST") { // never calls Stripe; guessing is limited per IP
        const lim = await ipLimit(env, req, "restore", +env.RESTORE_RATE_MAX || 10, 600); if (lim) return lim; // email + (Stripe session id, payment intent or receipt reference) must both match
        const { email, sessionOrReceipt, projectId } = await req.json().catch(() => ({}));
        const code = String(sessionOrReceipt || "").trim().slice(0, 200), mail = String(email || "").toLowerCase().trim();
        if (mail.length > 254 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(mail)) return err(400, "BAD_REQUEST", "Enter a valid email.");
        const now = new Date().toISOString(), codes = (env.TEST_CODES || "").split(",").map((c) => c.trim()).filter(Boolean);
        if (code && codes.includes(code)) { // friends/testing code: works from the same Restore box, project-agnostic ('*')
          const key = `code:${code}:${mail}`;
          await env.DB.prepare("INSERT OR IGNORE INTO entitlements(id,project_id,email,stripe_session_id,amount_cents,currency,credits_total,pdf_used,pdf_allowed,status,created_at,expires_at) SELECT ?,'*',?,?,0,'aud',?,0,?,'active',?,? WHERE (SELECT COUNT(*) FROM entitlements WHERE stripe_session_id LIKE ?) < ?")
            .bind("ent_" + crypto.randomUUID().replace(/-/g, "").slice(0, 16), mail, key, +env.PLAN_PACK_CREDITS || 500, +env.TEST_CODE_PDF_SETS || 20, now, new Date(Date.now() + 30 * 864e5).toISOString(), `code:${code}:%`, +env.TEST_CODE_MAX_USES || 25).run();
          let r = await env.DB.prepare("SELECT * FROM entitlements WHERE stripe_session_id=?").bind(key).first();
          if (!r) return err(403, "CODE_EXHAUSTED", "That code has been used too many times.");
          if (r.expires_at <= now) { await env.DB.prepare("UPDATE entitlements SET expires_at=? WHERE id=?").bind(new Date(Date.now() + 30 * 864e5).toISOString(), r.id).run(); r = await env.DB.prepare("SELECT * FROM entitlements WHERE id=?").bind(r.id).first(); }
          const pid = PID_RE.test(projectId || "") ? projectId : "*";
          return J({ token: await signToken(env, r, pid), ...entView(r), projectId: pid });
        }
        const e = code && await env.DB.prepare("SELECT * FROM entitlements WHERE email=? AND (stripe_session_id=? OR payment_intent=? OR id=?) AND status='active' AND (expires_at IS NULL OR expires_at>?) ORDER BY created_at DESC").bind(mail, code, code, code, now).first();
        if (!e) return err(404, "NOT_ENTITLED", "We could not find a matching purchase.");
        return J({ token: await signToken(env, e), ...entView(e), project: e.project_id });
      }

      if (path === "/projects" || path.startsWith("/projects/")) return (await import("./projects.js")).handleProjects(req, env, path, { J, err, ipLimit }); // save and share: no entitlement needed

      const e = await auth(req, env);
      if (!e) return err(401, "UNAUTHORISED", "Please restore your purchase.");
      if (path === "/credits") return J({ ...credits(e), warnLevel: 0 });

      if (path.startsWith("/export/")) return (await import("./exports.js")).handleExport(req, env, e, path.slice(8));
      if (path.startsWith("/ai/")) return (await import("./ai.js")).handleAI(req, env, e, path);
      return err(404, "BAD_REQUEST", "Not found.");
    };
    try { const r = await out(); Object.entries(C).forEach(([k, v]) => r.headers.set(k, v)); return r; }
    catch (x) { console.error("api error", path, x?.stack || x); const r = err(500, "ERROR", "Something went wrong."); Object.entries(C).forEach(([k, v]) => r.headers.set(k, v)); return r; }
  },
};
