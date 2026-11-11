import crypto from "node:crypto"; import assert from "node:assert/strict";
const BASE = "http://127.0.0.1:8810", WHSEC = "whsec_test_local_secret", out = { statuses: {} };
const sign = (raw, t = Math.floor(Date.now() / 1e3), secret = WHSEC) => `t=${t},v1=${crypto.createHmac("sha256", secret).update(t + "." + raw).digest("hex")}`;
const tally = (k, s) => { out.statuses[k] ??= {}; out.statuses[k][s] = (out.statuses[k][s] || 0) + 1; };
const hit = async (k, p, o) => { const r = await fetch(BASE + p, o); tally(k, r.status); return r; };
const send = (k, ev, hdr) => { const raw = typeof ev === "string" ? ev : JSON.stringify(ev); return hit(k, "/api/stripe/webhook", { method: "POST", body: raw, headers: { "stripe-signature": hdr ?? sign(raw) } }); };
const done = (id, n) => ({ id, type: "checkout.session.completed", data: { object: { id: "cs_s" + n, mode: "payment", payment_status: "paid", client_reference_id: "p_stress" + n, metadata: { projectId: "p_stress" + n, app: "pocket-architect" }, payment_intent: "pi_s" + n, amount_total: 3500, currency: "aud", customer_details: { email: `s${n}@x.com` } } } });
const refund = (id, n) => ({ id, type: "charge.refunded", data: { object: { payment_intent: "pi_s" + n, amount: 3500, amount_refunded: 3500, refunded: true } } });
const db = async (q) => (await fetch(BASE + "/_db?q=" + encodeURIComponent(q))).json();
const t0 = Date.now(), jobs = [];
// 50 deliveries: 10 sessions; sessions 0-9 each delivered 3x under 2 different event ids (dup + resend); sessions 0-2 have refund events, session 0 refund delivered FIRST (out of order)
for (let n = 0; n < 10; n++) { jobs.push(send("valid", done("evt_d" + n, n))); jobs.push(send("valid", done("evt_d" + n, n))); jobs.push(send("valid", done("evt_e" + n, n))); }
for (let n = 0; n < 3; n++) jobs.push(send("valid", refund("evt_r" + n, n)));
jobs.unshift(send("valid", refund("evt_r0early", 0)));
for (let i = 0; i < 16; i++) jobs.push(send("valid", done("evt_x" + i, 50 + i)));
// bad traffic mixed in: bad signature, replay (old ts), future ts, no header, wrong secret, invalid json signed, oversized (2 MB) and not signed oversized
const good = JSON.stringify(done("evt_bad", 99));
for (let i = 0; i < 10; i++) jobs.push(send("badsig", good, `t=${Math.floor(Date.now() / 1e3)},v1=${"0".repeat(64)}`));
for (let i = 0; i < 5; i++) jobs.push(send("replay", good, sign(good, Math.floor(Date.now() / 1e3) - 3600)));
for (let i = 0; i < 3; i++) jobs.push(send("future", good, sign(good, Math.floor(Date.now() / 1e3) + 3600)));
jobs.push(send("nohdr", good, "")); jobs.push(send("wrongsecret", good, sign(good, undefined, "whsec_other"))); jobs.push(send("badjson", "{not json"));
const big = JSON.stringify({ id: "evt_big", type: "x", data: { object: { pad: "a".repeat(2e6) } } });
jobs.push(send("oversize", big)); jobs.push(send("oversize-unsigned", big, "t=1,v1=zz"));
jobs.push(hit("get-webhook", "/api/stripe/webhook"));
const polls = []; for (let i = 0; i < 100; i++) polls.push(hit("poll", `/api/entitlement?session_id=cs_s${i % 12}&project=p_stress${i % 12}`));
const sent = await Promise.all([...jobs, ...polls]);
const ents = await db("select stripe_session_id s, status, count(*) n from entitlements group by stripe_session_id"), events = await db("select count(*) n from webhook_events");
const five = Object.entries(out.statuses).flatMap(([k, v]) => Object.keys(v).filter((s) => +s >= 500).map((s) => k + ":" + s));
console.log(JSON.stringify(out.statuses)); console.log("requests", sent.length, "elapsed ms", Date.now() - t0, "entitlement rows", ents.length, "max rows per session", Math.max(...ents.map((e) => e.n)), "webhook_events", events[0].n);
console.log("refunded:", ents.filter((e) => e.status === "refunded").map((e) => e.s).sort().join(","));
assert.equal(five.length, 0, "5xx responses: " + five); assert.equal(ents.length, 26); assert.ok(ents.every((e) => e.n === 1)); assert.deepEqual(ents.filter((e) => e.status === "refunded").map((e) => e.s).sort(), ["cs_s0", "cs_s1", "cs_s2"]);
assert.ok(!ents.some((e) => e.s === "cs_s99")); assert.deepEqual(Object.keys(out.statuses.badsig), ["400"]); assert.deepEqual(Object.keys(out.statuses.replay), ["400"]); assert.deepEqual(Object.keys(out.statuses.oversize), ["413"]);
// after the storm: pollers see active ones as 200 and refunded as 404
const a = await fetch(BASE + "/api/entitlement?session_id=cs_s5&project=p_stress5"); assert.equal(a.status, 200); const r = await fetch(BASE + "/api/entitlement?session_id=cs_s0&project=p_stress0"); assert.equal(r.status, 404);
// 100 concurrent restores + 100 polls against an active entitlement
const rs = await Promise.all(Array.from({ length: 100 }, (_, i) => fetch(BASE + (i % 2 ? "/api/entitlement?session_id=cs_s5&project=p_stress5" : "/api/entitlement/restore"), i % 2 ? {} : { method: "POST", body: JSON.stringify({ email: "s5@x.com", sessionOrReceipt: "pi_s5" }) }).then((x) => x.status)));
assert.ok(rs.every((s) => s === 200)); console.log("STRESS OK");
