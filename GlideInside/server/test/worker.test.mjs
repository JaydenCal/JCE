import { DatabaseSync } from "node:sqlite"; import assert from "node:assert"; import crypto from "node:crypto";
import worker from "../worker.js";
const db = new DatabaseSync(":memory:"); db.exec(await (await import("node:fs/promises")).readFile(new URL("../schema.sql", import.meta.url), "utf8"));
const DB = { prepare: (sql) => { const st = db.prepare(sql); return { bind: (...a) => ({ run: async () => { const r = st.run(...a); return { meta: { changes: r.changes } }; }, first: async () => st.get(...a) ?? null }) }; } };
const files = new Map(); const FILES = { get: async (k) => files.has(k) ? { body: files.get(k) } : null, put: async (k, v) => files.set(k, v) };
const env = { DB, FILES, SITE_URL: "https://x.test", APP_URL: "https://x.test/app/", STRIPE_WEBHOOK_SECRET: "whsec_t", ENTITLEMENT_SECRET: "s3cret", PLAN_PACK_CREDITS: "500" };
const call = (p, o = {}) => worker.fetch(new Request("https://x.test/api" + p, o), env);
const hook = async (ev) => { const raw = JSON.stringify(ev), t = Math.floor(Date.now() / 1e3); const sig = crypto.createHmac("sha256", "whsec_t").update(t + "." + raw).digest("hex"); return call("/stripe/webhook", { method: "POST", body: raw, headers: { "stripe-signature": `t=${t},v1=${sig}` } }); };
const paid = { id: "evt_1", type: "checkout.session.completed", data: { object: { id: "cs_1", payment_status: "paid", client_reference_id: "p_job1", payment_intent: "pi_1", amount_total: 3500, currency: "aud", customer_details: { email: "Buyer@Example.com" } } } };
assert.equal((await call("/entitlement?session_id=cs_1&project=p_job1")).status, 404);                       // pending before webhook
assert.equal((await call("/stripe/webhook", { method: "POST", body: "{}", headers: { "stripe-signature": "t=1,v1=bad" } })).status, 400); // bad signature
assert.equal((await hook(paid)).status, 200); assert.equal((await (await hook(paid)).json()).duplicate, true);      // idempotent
const ent = await (await call("/entitlement?session_id=cs_1&project=p_job1")).json(); assert.ok(ent.token); assert.equal(ent.credits.remaining, 500);
assert.equal((await call("/entitlement?session_id=cs_1&project=OTHER")).status, 404);                           // wrong project
const rs = await call("/entitlement/restore", { method: "POST", body: JSON.stringify({ email: "buyer@example.com", sessionOrReceipt: "pi_1" }) }); assert.equal(rs.status, 200);
assert.equal((await call("/entitlement/restore", { method: "POST", body: JSON.stringify({ email: "bad@example.com", sessionOrReceipt: "pi_1" }) })).status, 404);
const A = { authorization: "Bearer " + ent.token, "content-type": "application/json" };
assert.equal((await call("/export/pdf", { method: "POST", body: "{}" })).status, 401);                          // no token
assert.equal((await call("/export/pdf", { method: "POST", body: "{}", headers: A })).status, 501);               // no generator installed: set NOT consumed
globalThis.generatePdf = async () => new TextEncoder().encode("%PDF-fake");
assert.equal((await call("/export/pdf", { method: "POST", body: JSON.stringify({ project: {} }), headers: A })).status, 200);   // first set
const again = await call("/export/pdf", { method: "POST", body: JSON.stringify({ project: {} }), headers: A }); assert.equal(again.status, 200); // same stored file
assert.equal(db.prepare("SELECT pdf_used FROM entitlements").get().pdf_used, 1);                                // still one set
// a failed generation must not burn the set, and a second concurrent set must be refused
db.prepare("UPDATE entitlements SET pdf_file=NULL").run(); assert.equal((await call("/export/pdf", { method: "POST", body: JSON.stringify({ project: {} }), headers: A })).status, 403);
await hook({ id: "evt_2", type: "charge.refunded", data: { object: { payment_intent: "pi_1" } } });
assert.equal((await call("/credits", { headers: A })).status, 401);                                             // refunded: access stops
console.log("worker tests passed");
