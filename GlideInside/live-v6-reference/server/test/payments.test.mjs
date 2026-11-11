import { DatabaseSync } from "node:sqlite"; import assert from "node:assert/strict"; import crypto from "node:crypto"; import fs from "node:fs";
import test from "node:test";
import worker from "../worker.js";

const SCHEMA = fs.readFileSync(new URL("../schema.sql", import.meta.url), "utf8");
const WHSEC = "whsec_t";
function mk(over = {}) {
  const db = new DatabaseSync(":memory:"); db.exec(SCHEMA);
  const hooks = { failOn: null };
  const DB = { prepare: (sql) => { const st = db.prepare(sql); return { bind: (...a) => ({
    run: async () => { if (hooks.failOn && sql.includes(hooks.failOn)) { hooks.failOn = null; throw new Error("db down"); } const r = st.run(...a); return { meta: { changes: r.changes } }; },
    first: async () => st.get(...a) ?? null }) }; } };
  const env = { DB, SITE_URL: "https://x.test", APP_URL: "https://x.test/app/", STRIPE_WEBHOOK_SECRET: WHSEC, STRIPE_SECRET_KEY: "sk_test_x", ENTITLEMENT_SECRET: "s3cret", PLAN_PACK_CREDITS: "500", RESTORE_RATE_MAX: "100000", CHECKOUT_RATE_MAX: "100000", ...over };
  const call = (p, o = {}) => worker.fetch(new Request("https://x.test/api" + p, o), env);
  const sig = (raw, t = Math.floor(Date.now() / 1e3), secret = WHSEC) => crypto.createHmac("sha256", secret).update(t + "." + raw).digest("hex");
  const hookRaw = (raw, header) => call("/stripe/webhook", { method: "POST", body: raw, headers: { "stripe-signature": header } });
  const hook = (ev, t = Math.floor(Date.now() / 1e3)) => { const raw = JSON.stringify(ev); return hookRaw(raw, `t=${t},v1=${sig(raw, t)}`); };
  const restore = (email, ref, extra = {}) => call("/entitlement/restore", { method: "POST", body: JSON.stringify({ email, sessionOrReceipt: ref, ...extra }) });
  const rows = () => db.prepare("SELECT * FROM entitlements").all();
  return { db, env, call, sig, hook, hookRaw, restore, rows, hooks };
}
const done = (id = "evt_1", o = {}) => ({ id, type: "checkout.session.completed", data: { object: { id: "cs_1", mode: "payment", payment_status: "paid", client_reference_id: "p_job1", metadata: { projectId: "p_job1", app: "pocket-architect" }, payment_intent: "pi_1", amount_total: 3500, currency: "aud", customer_details: { email: "Buyer@Example.com" }, ...o } } });
const refund = (id, o = {}) => ({ id, type: "charge.refunded", data: { object: { payment_intent: "pi_1", amount: 3500, amount_refunded: 3500, refunded: true, ...o } } });
const j = (r) => r.json();

test("signature: multiple v1 values, timestamp tolerance, malformed headers", async () => {
  const m = mk(), raw = JSON.stringify(done()), t = Math.floor(Date.now() / 1e3);
  assert.equal((await m.hookRaw(raw, `t=${t},v1=${"0".repeat(64)},v1=${m.sig(raw, t)}`)).status, 200, "valid signature after an invalid one");
  const m2 = mk();
  assert.equal((await m2.hookRaw(raw, `t=${t},v1=${m2.sig(raw, t)},v1=${"0".repeat(64)}`)).status, 200, "valid signature before an invalid one");
  const m3 = mk();
  assert.equal((await m3.hookRaw(raw, `t=${t},v1=${"0".repeat(64)},v1=${"f".repeat(64)}`)).status, 400);
  assert.equal((await m3.hookRaw(raw, `t=${t},v1=${m3.sig(raw, t, "whsec_other")}`)).status, 400, "wrong secret");
  assert.equal((await m3.hookRaw(raw, `t=${t},v0=${m3.sig(raw, t)}`)).status, 400, "v0 only");
  assert.equal((await m3.hookRaw(raw, `v1=${m3.sig(raw, t)}`)).status, 400, "no timestamp");
  assert.equal((await m3.hookRaw(raw, `t=abc,v1=${m3.sig(raw, t)}`)).status, 400, "non numeric timestamp");
  assert.equal((await m3.hookRaw(raw, "garbage,,=,t=,v1")).status, 400);
  assert.equal((await m3.hookRaw(raw, "")).status, 400);
  assert.equal((await m3.hookRaw(raw + " ", `t=${t},v1=${m3.sig(raw, t)}`)).status, 400, "body altered after signing");
  const old = t - 400, future = t + 400;
  assert.equal((await m3.hookRaw(raw, `t=${old},v1=${m3.sig(raw, old)}`)).status, 400, "replayed old timestamp");
  assert.equal((await m3.hookRaw(raw, `t=${future},v1=${m3.sig(raw, future)}`)).status, 400, "future timestamp");
  const edge = t - 290; assert.equal((await m3.hookRaw(raw, `t=${edge},v1=${m3.sig(raw, edge)}`)).status, 200, "inside tolerance");
  assert.equal(m3.rows().length, 1);
});

test("webhook: body limits, bad payloads, missing secret", async () => {
  const m = mk(), t = Math.floor(Date.now() / 1e3);
  const big = JSON.stringify({ id: "evt_big", type: "x", data: { object: { pad: "a".repeat(1.1e6) } } });
  assert.equal((await m.hookRaw(big, `t=${t},v1=${m.sig(big, t)}`)).status, 413);
  const lie = await m.call("/stripe/webhook", { method: "POST", body: "{}", headers: { "stripe-signature": "t=1,v1=x", "content-length": "5000000" } });
  assert.equal(lie.status, 413);
  const notJson = "not json"; assert.equal((await m.hookRaw(notJson, `t=${t},v1=${m.sig(notJson, t)}`)).status, 400);
  for (const bad of [{}, { id: 5, type: "x", data: { object: {} } }, { id: "e", type: "x" }, { id: "e", type: "x", data: { object: 7 } }, null]) {
    const raw = JSON.stringify(bad); assert.equal((await m.hookRaw(raw, `t=${t},v1=${m.sig(raw, t)}`)).status, 400, raw);
  }
  const m2 = mk({ STRIPE_WEBHOOK_SECRET: undefined }); const r = await m2.hook(done()); assert.equal(r.status, 503); assert.equal((await j(r)).error.code, "PAYMENTS_UNAVAILABLE");
  assert.equal((await m.call("/stripe/webhook", { method: "GET" })).status, 401);
});

test("idempotency: duplicates, same session via different events, concurrent deliveries", async () => {
  const m = mk();
  assert.equal((await j(await m.hook(done("evt_a")))).duplicate, undefined);
  assert.equal((await j(await m.hook(done("evt_a")))).duplicate, true);
  assert.equal((await m.hook(done("evt_b"))).status, 200);
  assert.equal(m.rows().length, 1, "same session twice under two event ids");
  const m2 = mk(), batch = [];
  for (let i = 0; i < 50; i++) batch.push(m2.hook(done("evt_c" + (i % 5), { id: "cs_" + (i % 3), payment_intent: "pi_" + (i % 3), client_reference_id: "p_job" + (i % 3), metadata: { projectId: "p_job" + (i % 3), app: "pocket-architect" } })));
  const res = await Promise.all(batch); assert.ok(res.every((r) => r.status === 200));
  assert.equal(m2.rows().length, 3, "one entitlement per session");
  assert.equal(m2.db.prepare("SELECT COUNT(*) n FROM webhook_events").get().n, 5);
});

test("webhook failure is retryable: event not marked seen when processing throws", async () => {
  const m = mk(); m.hooks.failOn = "INSERT OR IGNORE INTO entitlements";
  assert.equal((await m.hook(done("evt_r"))).status, 500); assert.equal(m.rows().length, 0);
  assert.equal((await m.hook(done("evt_r"))).status, 200); assert.equal(m.rows().length, 1, "Stripe retry grants access");
});

test("which sessions grant access", async () => {
  const m = mk(); let n = 0; const go = async (o, type = "checkout.session.completed") => { const ev = done("evt_g" + ++n, { id: "cs_g" + n, payment_intent: "pi_g" + n, ...o }); ev.type = type; await m.hook(ev); return m.rows().length; };
  assert.equal(await go({ payment_status: "unpaid" }), 0, "unpaid (delayed method) waits");
  assert.equal(await go({}, "checkout.session.async_payment_succeeded"), 1, "async payment succeeded grants");
  assert.equal(await go({ currency: "usd" }), 1, "wrong currency");
  assert.equal(await go({ amount_total: 500 }), 1, "A$5 add-on payment is not a plan");
  assert.equal(await go({ amount_total: 3499 }), 1);
  assert.equal(await go({ client_reference_id: undefined, metadata: {} }), 1, "other product, no project");
  assert.equal(await go({ client_reference_id: "x" }), 1, "invalid project id");
  assert.equal(await go({ client_reference_id: "p_job9", metadata: { projectId: "p_other", app: "pocket-architect" } }), 1, "project mismatch");
  assert.equal(await go({ metadata: { projectId: "p_job1", app: "fly-through" } }), 1, "other app");
  assert.equal(await go({ mode: "subscription" }), 1, "not a one-off payment");
  assert.equal(await go({}, "checkout.session.expired"), 1);
  assert.equal(await go({}, "checkout.session.async_payment_failed"), 1);
  assert.equal(await go({ amount_total: 4000, currency: "AUD" }), 2, "higher amount, upper case currency");
  const r = m.rows().at(-1); assert.equal(r.currency, "aud"); assert.equal(r.credits_total, 500); assert.equal(r.status, "active"); assert.match(r.id, /^ent_/);
  const m2 = mk({ PLAN_PRICE_CENTS: "4900" }); await m2.hook(done()); assert.equal(m2.rows().length, 0, "configured price is enforced");
  const m3 = mk(); await m3.hook(done("e", { customer_details: undefined, customer_email: "Alt@X.com" })); assert.equal(m3.rows()[0].email, "alt@x.com");
});

test("refunds: partial keeps access, full revokes, refund before grant stays revoked", async () => {
  const m = mk(); await m.hook(done());
  await m.hook(refund("evt_p", { refunded: false, amount_refunded: 1000 })); assert.equal(m.rows()[0].status, "active");
  await m.hook(refund("evt_f1", { refunded: false, amount_refunded: 3500 })); assert.equal(m.rows()[0].status, "refunded", "amount_refunded >= amount");
  const m2 = mk(); await m2.hook(done()); await m2.hook(refund("evt_f2")); assert.equal(m2.rows()[0].status, "refunded");
  const t = await j(await m2.call("/entitlement?session_id=cs_1&project=p_job1")); assert.equal(t.pending, undefined);
  const m3 = mk(); await m3.hook(refund("evt_early")); await m3.hook(done()); assert.equal(m3.rows()[0].status, "refunded", "out of order");
  assert.equal((await m3.call("/entitlement?session_id=cs_1&project=p_job1")).status, 404);
  const m4 = mk(); assert.equal((await m4.hook(refund("evt_n", { payment_intent: null }))).status, 200);
});

test("entitlement polling and token", async () => {
  const m = mk(); const p = "/entitlement?session_id=cs_1&project=p_job1";
  const pend = await m.call(p); assert.equal(pend.status, 404); const pj = await j(pend); assert.equal(pj.error.code, "NOT_ENTITLED"); assert.equal(pj.error.pending, true);
  assert.equal((await m.call("/entitlement")).status, 404); assert.equal((await m.call("/entitlement?session_id=cs_1")).status, 404);
  await m.hook(done()); const r = await m.call(p); assert.equal(r.status, 200); assert.equal(r.headers.get("cache-control"), "no-store");
  const e = await j(r); assert.equal(e.projectId, "p_job1"); assert.match(e.receipt, /^ent_/); assert.deepEqual(e.credits, { total: 500, used: 0, remaining: 500 }); assert.ok(Date.parse(e.expiresAt) > Date.now());
  const payload = JSON.parse(Buffer.from(e.token.split(".")[0], "base64url")); assert.equal(payload.pid, "p_job1"); assert.ok(payload.exp < 4e9 && payload.exp > Date.now() / 1e3, "exp is in seconds, as the app expects");
  assert.equal((await m.call("/entitlement?session_id=cs_1&project=other_p")).status, 404);
  const A = { authorization: "Bearer " + e.token };
  assert.equal((await m.call("/credits", { headers: A })).status, 200);
  assert.equal((await m.call("/credits", { headers: { authorization: "Bearer " + e.token.slice(0, -2) + "xx" } })).status, 401, "tampered signature");
  const forged = Buffer.from(JSON.stringify({ ...payload, eid: "ent_nope" })).toString("base64url"); assert.equal((await m.call("/credits", { headers: { authorization: "Bearer " + forged + "." + e.token.split(".")[1] } })).status, 401);
  assert.equal((await m.call("/credits")).status, 401); assert.equal((await m.call("/credits", { headers: { authorization: "Bearer a.b" } })).status, 401);
  m.db.prepare("UPDATE entitlements SET expires_at=?").run(new Date(Date.now() - 1000).toISOString());
  assert.equal((await m.call("/credits", { headers: A })).status, 401, "expired row"); assert.equal((await m.call(p)).status, 404);
  const polls = await Promise.all(Array.from({ length: 100 }, () => m.call("/entitlement?session_id=cs_1&project=p_job1"))); assert.ok(polls.every((x) => x.status === 404));
});

test("restore purchase", async () => {
  const m = mk(); await m.hook(done()); const id = m.rows()[0].id;
  for (const ref of [id, "pi_1", "cs_1"]) { const r = await m.restore("  BUYER@example.com ", ref); assert.equal(r.status, 200, ref); const b = await j(r); assert.equal(b.project, "p_job1"); assert.equal(b.projectId, "p_job1"); assert.equal(b.receipt, id); assert.ok(b.token); }
  assert.equal((await m.restore("other@example.com", "pi_1")).status, 404);
  assert.equal((await m.restore("buyer@example.com", "pi_x")).status, 404);
  assert.equal((await m.restore("buyer@example.com", "")).status, 404);
  assert.equal((await m.restore("", "pi_1")).status, 400); assert.equal((await m.restore("notanemail", "pi_1")).status, 400);
  assert.equal((await m.call("/entitlement/restore", { method: "POST", body: "{bad" })).status, 400);
  m.db.prepare("UPDATE entitlements SET status='refunded'").run(); assert.equal((await m.restore("buyer@example.com", "pi_1")).status, 404);
  const m2 = mk(); await m2.hook(done("e1", { customer_details: {} })); assert.equal((await m2.restore("", "cs_1")).status, 400, "no email on file cannot be matched by an empty email");
  const m3 = mk(); await m3.hook(done()); m3.db.prepare("UPDATE entitlements SET expires_at=?").run(new Date(Date.now() - 1000).toISOString()); assert.equal((await m3.restore("buyer@example.com", "pi_1")).status, 404);
});

test("friends code: unlimited projects, per-person reuse, atomic cap, expiry, off switch", async () => {
  const m = mk({ TEST_CODES: "PA-FRIENDS-TEST, OTHER-CODE", TEST_CODE_MAX_USES: "2" });
  assert.equal((await m.restore("f@x.com", "WRONG")).status, 404); assert.equal((await m.restore("bad", "PA-FRIENDS-TEST")).status, 400);
  const a = await m.restore("f1@x.com", "PA-FRIENDS-TEST"); assert.equal(a.status, 200); const aj = await j(a); assert.equal(aj.projectId, "*"); assert.equal(aj.credits.remaining, 500);
  assert.equal((await m.call("/credits", { headers: { authorization: "Bearer " + aj.token } })).status, 200);
  const bound = await j(await m.restore("f1@x.com", "PA-FRIENDS-TEST", { projectId: "p_mine1" })); assert.equal(bound.projectId, "p_mine1");
  assert.equal((await m.call("/credits", { headers: { authorization: "Bearer " + bound.token } })).status, 200, "token bound to the open project works");
  assert.equal(m.rows().length, 1, "same friend, no extra use");
  assert.equal((await m.restore("F1@x.com", "PA-FRIENDS-TEST")).status, 200);
  const rest = await Promise.all(["a", "b", "c", "d", "e"].map((x) => m.restore(x + "@x.com", "PA-FRIENDS-TEST"))); assert.equal(rest.filter((r) => r.status === 200).length, 1, "cap of 2 people holds under concurrency");
  assert.deepEqual(rest.filter((r) => r.status !== 200).map((r) => r.status), [403, 403, 403, 403]); assert.equal((await j(rest.find((r) => r.status === 403))).error.code, "CODE_EXHAUSTED");
  assert.equal((await m.restore("g@x.com", "OTHER-CODE")).status, 200, "second code has its own cap");
  m.db.prepare("UPDATE entitlements SET expires_at=? WHERE email='f1@x.com'").run(new Date(Date.now() - 1000).toISOString());
  const again = await m.restore("f1@x.com", "PA-FRIENDS-TEST"); assert.equal(again.status, 200); assert.equal((await m.call("/credits", { headers: { authorization: "Bearer " + (await j(again)).token } })).status, 200, "expired friend is renewed while code is live");
  m.env.TEST_CODES = ""; assert.equal((await m.restore("z@x.com", "PA-FRIENDS-TEST")).status, 404, "code removed");
});

test("checkout session parameters", async () => {
  const m = mk(), seen = []; const real = globalThis.fetch;
  globalThis.fetch = async (u, o) => { seen.push({ u: String(u), o, form: Object.fromEntries(new URLSearchParams(String(o.body))) }); return new Response(JSON.stringify({ id: "cs_x", url: "https://checkout.stripe.com/c/pay/cs_x" }), { status: 200, headers: { "content-type": "application/json" } }); };
  try {
    const body = (b) => ({ method: "POST", body: JSON.stringify(b) });
    const r = await m.call("/checkout", body({ projectId: "p_job1", projectName: "x".repeat(200), email: "a@b.com" })); assert.equal(r.status, 200); assert.equal((await j(r)).url, "https://checkout.stripe.com/c/pay/cs_x");
    const { u, o, form: f } = seen[0]; assert.equal(u, "https://api.stripe.com/v1/checkout/sessions"); assert.equal(o.headers.authorization, "Bearer sk_test_x");
    assert.equal(f.mode, "payment"); assert.equal(f["line_items[0][price_data][unit_amount]"], "3500"); assert.equal(f["line_items[0][price_data][currency]"], "aud"); assert.equal(f["line_items[0][price_data][tax_behavior]"], "inclusive");
    assert.equal(f.client_reference_id, "p_job1"); assert.equal(f["metadata[projectId]"], "p_job1"); assert.equal(f["metadata[app]"], "pocket-architect"); assert.equal(f["invoice_creation[enabled]"], "true");
    assert.equal(f.success_url, "https://x.test/app/?checkout=success&session_id={CHECKOUT_SESSION_ID}&project=p_job1"); assert.equal(f.cancel_url, "https://x.test/app/?checkout=cancel");
    assert.equal(f.customer_email, "a@b.com"); assert.equal(f.locale, "en-AU"); assert.ok(f["payment_intent_data[description]"].length < 100);
    seen.length = 0; await m.call("/checkout", body({ projectId: "p_job1", email: "not an email" })); assert.equal(seen[0].form.customer_email, undefined);
    seen.length = 0; m.env.STRIPE_PRICE_ID = "price_123"; m.env.STRIPE_API_BASE = "http://127.0.0.1:9/"; await m.call("/checkout", body({ projectId: "p_job1" }));
    assert.equal(seen[0].u, "http://127.0.0.1:9/v1/checkout/sessions"); assert.equal(seen[0].form["line_items[0][price]"], "price_123"); assert.equal(seen[0].form["line_items[0][price_data][unit_amount]"], undefined);
    for (const bad of [{}, { projectId: "a" }, { projectId: "has space" }, { projectId: "x".repeat(65) }, { projectId: "p_ok1&evil=1" }]) assert.equal((await m.call("/checkout", body(bad))).status, 400, JSON.stringify(bad));
    assert.equal((await m.call("/checkout", { method: "POST", body: "{bad" })).status, 400);
    assert.equal((await mk({ STRIPE_SECRET_KEY: undefined }).call("/checkout", body({ projectId: "p_job1" }))).status, 503);
  } finally { globalThis.fetch = real; }
});

test("checkout when Stripe is down or misbehaving", async () => {
  const m = mk(), real = globalThis.fetch, body = JSON.stringify({ projectId: "p_job1" });
  try {
    const modes = [() => { throw new TypeError("fetch failed"); }, () => new Response("<html>bad gateway</html>", { status: 502 }), () => new Response(JSON.stringify({ error: { message: "Invalid API Key" } }), { status: 401 }), () => new Response(JSON.stringify({ id: "cs", url: "javascript:alert(1)" }), { status: 200 }), () => new Response("null", { status: 200 }), () => new Response(JSON.stringify({ id: "cs" }), { status: 200 })];
    for (const mode of modes) { globalThis.fetch = async () => mode(); const r = await m.call("/checkout", { method: "POST", body }); assert.equal(r.status, 502); const e = (await j(r)).error; assert.equal(e.code, "PAYMENTS_UNAVAILABLE"); assert.ok(!/Invalid API Key/.test(e.message)); assert.equal(r.headers.get("access-control-allow-origin"), "https://x.test"); }
  } finally { globalThis.fetch = real; }
});

test("CORS and health", async () => {
  const m = mk(); const pre = await m.call("/checkout", { method: "OPTIONS" }); assert.equal(pre.status, 204);
  assert.equal(pre.headers.get("access-control-allow-origin"), "https://x.test"); assert.match(pre.headers.get("access-control-allow-headers"), /authorization/); assert.match(pre.headers.get("access-control-allow-methods"), /POST/);
  for (const r of [await m.call("/entitlement?session_id=a&project=b"), await m.call("/credits"), await m.call("/health")]) assert.equal(r.headers.get("access-control-allow-origin"), "https://x.test");
  const h = await j(await m.call("/health")); assert.equal(h.ok, true); assert.equal(h.paymentsConfigured, true);
  const bare = mk({ SITE_URL: undefined, STRIPE_SECRET_KEY: undefined }); const r = await bare.call("/health"); assert.equal(r.headers.get("access-control-allow-origin"), null, "no literal 'undefined' origin"); assert.equal((await j(r)).paymentsConfigured, false);
});
