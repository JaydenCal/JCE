// Tests for server hardening: stale AI reservations, atomic caps, webhook ordering and disputes, per-IP limits.
// Run: cd server && node --no-warnings test/hardening.test.mjs
import { DatabaseSync } from "node:sqlite"; import assert from "node:assert/strict"; import crypto from "node:crypto"; import fs from "node:fs";
import worker from "../worker.js";
console.warn = () => {};
const rd = (p) => fs.readFileSync(new URL(p, import.meta.url), "utf8"), WHSEC = "whsec_t";
let passed = 0; const ok = (n) => { passed++; console.log("  ok  " + n); };
function mk(over = {}) {
  const db = new DatabaseSync(":memory:"); db.exec(rd("../schema.sql")); db.exec(rd("../migrations/0003_ai.sql")); db.exec(rd("../migrations/0004_hardening.sql"));
  const hooks = { failOn: null };
  const DB = { prepare: (sql) => { const st = db.prepare(sql); return { bind: (...a) => ({
    run: async () => { if (hooks.failOn && sql.includes(hooks.failOn)) { hooks.failOn = null; throw new Error("db down"); } const r = st.run(...a); return { meta: { changes: Number(r.changes) } }; },
    first: async () => st.get(...a) ?? null }) }; } };
  const env = { DB, SITE_URL: "https://x.test", APP_URL: "https://x.test/app/", STRIPE_WEBHOOK_SECRET: WHSEC, STRIPE_SECRET_KEY: "sk_test_x", ENTITLEMENT_SECRET: "s3cret", PLAN_PACK_CREDITS: "500", IP_HASH_SALT: "salt", TEST_CODES: "FRIENDS", ANTHROPIC_API_KEY: "sk-test", AI_RATE_PER_MIN: "100000", RESTORE_RATE_MAX: "100000", CHECKOUT_RATE_MAX: "100000", ...over };
  const call = (p, o = {}) => worker.fetch(new Request("https://x.test/api" + p, o), env);
  const hook = (ev) => { const raw = JSON.stringify(ev), t = Math.floor(Date.now() / 1e3); return call("/stripe/webhook", { method: "POST", body: raw, headers: { "stripe-signature": `t=${t},v1=${crypto.createHmac("sha256", WHSEC).update(t + "." + raw).digest("hex")}` } }); };
  const restore = (email, ref, ip, extra = {}) => call("/entitlement/restore", { method: "POST", headers: ip ? { "cf-connecting-ip": ip } : {}, body: JSON.stringify({ email, sessionOrReceipt: ref, ...extra }) });
  return { db, env, call, hook, restore, hooks };
}
const done = (id = "evt_1") => ({ id, type: "checkout.session.completed", data: { object: { id: "cs_1", mode: "payment", payment_status: "paid", client_reference_id: "p_job1", metadata: { projectId: "p_job1", app: "pocket-architect" }, payment_intent: "pi_1", amount_total: 3500, currency: "aud", customer_details: { email: "buyer@example.com" } } } });
const ev = (id, type, o) => ({ id, type, data: { object: { payment_intent: "pi_1", ...o } } });
const tokenFor = async (m) => (await (await m.call("/entitlement?session_id=cs_1&project=p_job1")).json()).token;
const status = (m) => m.db.prepare("SELECT status FROM entitlements").get()?.status;

// ---- 3. webhook: marker only after the writes succeed ------------------------------------------------------------
{ const m = mk(); m.hooks.failOn = "INSERT OR IGNORE INTO entitlements";
  assert.equal((await m.hook(done())).status, 500);
  assert.equal(m.db.prepare("SELECT COUNT(*) n FROM webhook_events").get().n, 0, "no marker after a failed write");
  assert.equal((await m.hook(done())).status, 200); assert.equal(status(m), "active"); // Stripe's retry succeeds
  assert.equal((await m.hook(done())).status, 200); assert.equal(m.db.prepare("SELECT COUNT(*) n FROM entitlements").get().n, 1);
  ok("webhook not marked processed when the DB write fails; retry succeeds"); }
{ const m = mk(); await m.hook(done()); const t = await tokenFor(m), A = { authorization: "Bearer " + t };
  assert.equal((await m.call("/credits", { headers: A })).status, 200);
  await m.hook(ev("e2", "charge.dispute.created", { status: "needs_response" })); assert.equal(status(m), "disputed");
  assert.equal((await m.call("/credits", { headers: A })).status, 401, "disputed revokes access");
  assert.equal((await m.call("/entitlement?session_id=cs_1&project=p_job1")).status, 404);
  await m.hook(ev("e3", "charge.dispute.closed", { status: "lost" })); assert.equal(status(m), "disputed", "lost stays revoked");
  await m.hook(ev("e4", "charge.dispute.closed", { status: "won" })); assert.equal(status(m), "active");
  assert.equal((await m.call("/credits", { headers: A })).status, 200, "won restores access"); ok("dispute created revokes, closed won restores, lost stays revoked"); }
{ const m = mk(); await m.hook(done()); const A = { authorization: "Bearer " + await tokenFor(m) };
  await m.hook(ev("e2", "charge.refunded", { amount: 3500, amount_refunded: 1000, refunded: false }));
  assert.equal(status(m), "active"); assert.equal((await m.call("/credits", { headers: A })).status, 200); ok("partial refund keeps access");
  await m.hook(ev("e3", "charge.refunded", { amount: 3500, amount_refunded: 3500, refunded: true })); await m.hook(ev("e4", "charge.dispute.closed", { status: "won" }));
  assert.equal(status(m), "refunded", "a won dispute never revives a refund"); ok("won dispute does not undo a full refund"); }
{ const m = mk(); await m.hook(ev("e1", "charge.dispute.created", {})); await m.hook(done("e2"));
  assert.equal(status(m), "disputed", "dispute arriving before the grant"); await m.hook(ev("e3", "charge.dispute.closed", { status: "won" })); assert.equal(status(m), "active"); ok("dispute before grant is honoured"); }

// ---- 4. per-IP limits --------------------------------------------------------------------------------------------
{ const m = mk({ RESTORE_RATE_MAX: "10" }); let calls = 0; const f = globalThis.fetch; globalThis.fetch = async () => { calls++; throw new Error("no network"); };
  for (let i = 0; i < 10; i++) assert.equal((await m.restore("a@x.com", "GUESS" + i, "1.2.3.4")).status, 404);
  const r = await m.restore("a@x.com", "GUESS11", "1.2.3.4"), b = await r.json();
  assert.equal(r.status, 429); assert.equal(b.error.code, "RATE_LIMITED"); assert.ok(b.error.retryAfter > 0 && b.error.retryAfter <= 600); assert.ok(r.headers.get("retry-after"));
  assert.equal((await m.restore("a@x.com", "GUESS", "9.9.9.9")).status, 404, "another IP is unaffected");
  const stored = m.db.prepare("SELECT key FROM ip_rate").all().map((x) => x.key).join(); assert.ok(!stored.includes("1.2.3.4"), "raw IP never stored");
  assert.equal((await m.restore("a@x.com", "FRIENDS", "1.2.3.4")).status, 429, "friends code guessing is limited too");
  assert.equal(calls, 0, "restore never calls Stripe"); globalThis.fetch = f; ok("restore: 10 per window per hashed IP, RATE_LIMITED + retryAfter, no Stripe call"); }
{ const m = mk({ CHECKOUT_RATE_MAX: "20" }); const f = globalThis.fetch; let calls = 0; globalThis.fetch = async () => { calls++; return new Response(JSON.stringify({ url: "https://checkout.stripe.com/x" }), { status: 200 }); };
  const co = (ip) => m.call("/checkout", { method: "POST", headers: { "cf-connecting-ip": ip }, body: JSON.stringify({ projectId: "p_job1" }) });
  const rs = await Promise.all(Array.from({ length: 30 }, () => co("5.5.5.5")));
  assert.equal(rs.filter((r) => r.status === 200).length, 20); assert.equal(rs.filter((r) => r.status === 429).length, 10); assert.equal(calls, 20, "no Stripe call once limited");
  assert.equal((await co("6.6.6.6")).status, 200); globalThis.fetch = f; ok("checkout: 20 per hour per IP"); }

// ---- 1, 2. AI reservations and caps ------------------------------------------------------------------------------
let queue = [], upstream = 0;
globalThis.fetch = async () => { upstream++; const n = queue.shift() || { status: 200, body: { content: [{ type: "text", text: "ok" }], stop_reason: "end_turn", usage: { input_tokens: 4000, output_tokens: 150 } } }; return new Response(JSON.stringify(n.body), { status: n.status }); };
async function user(m, credits = 500) { const r = await m.restore("u@x.test", "FRIENDS"); const j = await r.json(); const id = m.db.prepare("SELECT id FROM entitlements").get().id; m.db.prepare("UPDATE entitlements SET credits_total=? WHERE id=?").run(credits, id); return { id, token: j.token }; }
const ai = (m, u) => m.call("/ai/edit", { method: "POST", headers: { authorization: "Bearer " + u.token, "content-type": "application/json" }, body: JSON.stringify({ message: "Add a study", context: "PLAN", history: [] }) });
const used = (m, id) => m.db.prepare("SELECT credits_used u FROM entitlements WHERE id=?").get(id).u;
{ const m = mk(); const u = await user(m); const day = new Date().toISOString().slice(0, 10);
  // a crashed request left a hold of 100 credits and 100000 weighted tokens, 5 minutes ago; another is fresh
  m.db.prepare("UPDATE entitlements SET credits_used=150 WHERE id=?").run(u.id); m.db.prepare("INSERT INTO ai_daily(day,weighted) VALUES(?,?)").run(day, 150000);
  m.db.prepare("INSERT INTO ai_reservations(id,eid,credits,weighted,day,created_at,settled) VALUES('old',?,100,100000,?,?,0)").run(u.id, day, Date.now() - 300000);
  m.db.prepare("INSERT INTO ai_reservations(id,eid,credits,weighted,day,created_at,settled) VALUES('fresh',?,50,50000,?,?,0)").run(u.id, day, Date.now() - 1000);
  const r = await ai(m, u); assert.equal(r.status, 200);
  const charged = (await r.json()).credits.charged; assert.equal(used(m, u.id), 50 + charged, "stale hold released, fresh hold kept");
  assert.equal(m.db.prepare("SELECT settled s FROM ai_reservations WHERE id='old'").get().s, 2);
  assert.equal(m.db.prepare("SELECT settled s FROM ai_reservations WHERE id='fresh'").get().s, 0);
  const before = used(m, u.id); await ai(m, u); const after = used(m, u.id); assert.ok(after >= before, "a second sweep refunds nothing more"); assert.equal(m.db.prepare("SELECT COUNT(*) n FROM ai_reservations WHERE settled=0").get().n, 1);
  ok("stale reservations released once, fresh ones untouched, no double refund"); }
{ const m = mk(); const u = await user(m); queue = [{ status: 500, body: {} }]; const r = await ai(m, u); assert.notEqual(r.status, 200);
  assert.equal(used(m, u.id), 0, "failed call refunds in full"); assert.equal(m.db.prepare("SELECT weighted w FROM ai_daily").get().w, 0);
  assert.equal(m.db.prepare("SELECT COUNT(*) n FROM ai_reservations WHERE settled=0").get().n, 0, "no open holds after failure");
  const ok1 = await ai(m, u); assert.equal(ok1.status, 200); const c = (await ok1.json()).credits.charged; assert.equal(used(m, u.id), c);
  assert.equal(m.db.prepare("SELECT COUNT(*) n FROM ai_reservations WHERE settled=0").get().n, 0); ok("reservations settle on success and failure"); }
{ // a request swept as stale while still running must not be refunded a second time when it settles
  const m = mk(); const u = await user(m); const f = globalThis.fetch;
  let once = true;
  globalThis.fetch = async () => { if (once) { once = false; m.db.prepare("UPDATE ai_reservations SET created_at=created_at-300000").run(); const other = await user2(m); await ai(m, other); } return f(); };
  async function user2(m) { const r = await m.restore("v@x.test", "FRIENDS"); const j = await r.json(); return { token: j.token }; }
  const r = await ai(m, u); assert.equal(r.status, 200);
  const ids = m.db.prepare("SELECT id FROM entitlements WHERE email='u@x.test'").get().id; assert.equal(used(m, ids), 0, "released by the sweeper, not refunded twice (never negative)");
  globalThis.fetch = f; ok("late settle after a sweep does not double refund"); }
{ const m = mk({ AI_DAILY_TOKEN_CAP: "60000" }); const u = await user(m, 100000); const rs = await Promise.all(Array.from({ length: 25 }, () => ai(m, u)));
  const w = m.db.prepare("SELECT weighted w FROM ai_daily").get().w; assert.ok(w <= 60000, "daily total " + w + " within cap"); console.log("      statuses", rs.map((r) => r.status).join(" "));
  assert.ok(rs.some((r) => r.status === 200)); ok("daily cap holds under concurrent requests"); }
{ const m = mk({ AI_RATE_PER_MIN: "3" }); const u = await user(m); const rs = await Promise.all(Array.from({ length: 10 }, () => ai(m, u)));
  assert.equal(rs.filter((r) => r.status === 200).length, 3); assert.equal(rs.filter((r) => r.status === 429).length, 7); ok("per-minute limit is a single atomic upsert"); }
console.log(`hardening tests passed (${passed} groups)`);
