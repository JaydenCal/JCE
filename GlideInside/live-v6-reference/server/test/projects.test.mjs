// Save and share routes: create, read, update with the edit key, size cap, rate limit, expiry, CORS, no email sent.
// Run: cd server && node --no-warnings --test test/projects.test.mjs
import test from "node:test"; import assert from "node:assert/strict"; import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import worker from "../worker.js";
const rd = (p) => fs.readFileSync(new URL(p, import.meta.url), "utf8");
const project = (over = {}) => ({ schema: 1, id: "p_abc12345", name: "My house", levels: [{ id: "l1", name: "Ground", walls: [], rooms: [] }], site: { northDeg: 0, underlay: { key: "x", data: "data:image/png;base64,AAAA" }, tanks: [] }, ...over });
function mk(over = {}) {
  const db = new DatabaseSync(":memory:"); db.exec(rd("../schema.sql")); db.exec(rd("../migrations/0005_projects.sql"));
  const DB = { prepare: (sql) => { const st = db.prepare(sql); return { bind: (...a) => ({ run: async () => { const r = st.run(...a); return { meta: { changes: Number(r.changes) } }; }, first: async () => st.get(...a) ?? null }) }; } };
  const files = new Map(); const FILES = { get: async (k) => files.has(k) ? { text: async () => files.get(k) } : null, put: async (k, v) => { files.set(k, v); }, delete: async (k) => { files.delete(k); } };
  const env = { DB, FILES, SITE_URL: "https://x.test", APP_URL: "https://x.test/plan-studio/app/", IP_HASH_SALT: "salt", ...over };
  const call = (p, o = {}) => worker.fetch(new Request("https://x.test/api" + p, o), env);
  const post = (body, ip = "1.1.1.1") => call("/projects", { method: "POST", headers: { "content-type": "application/json", "cf-connecting-ip": ip }, body: typeof body === "string" ? body : JSON.stringify(body) });
  const put = (id, body, key, ip = "1.1.1.1") => call("/projects/" + id, { method: "PUT", headers: { "content-type": "application/json", "cf-connecting-ip": ip, ...(key ? { "x-edit-key": key } : {}) }, body: JSON.stringify(body) });
  return { db, env, files, call, post, put };
}
const j = (r) => r.json();

test("create returns id, editKey and a share url; the key is stored only as a hash", async () => {
  const m = mk(); const r = await m.post({ project: project(), email: "Lead@Example.com" }); assert.equal(r.status, 201);
  const b = await j(r); assert.match(b.id, /^[\w-]{16,}$/); assert.ok(b.editKey.length >= 24); assert.equal(b.url, `https://x.test/plan-studio/app/?share=${b.id}`);
  const row = m.db.prepare("SELECT * FROM projects").get(); assert.equal(row.id, b.id); assert.notEqual(row.edit_key_hash, b.editKey); assert.match(row.edit_key_hash, /^[0-9a-f]{64}$/);
  assert.equal(row.email, "lead@example.com", "email stored as a lead"); assert.ok(!JSON.stringify(row).includes("1.1.1.1"), "raw IP never stored");
  assert.equal(r.headers.get("access-control-allow-origin"), "https://x.test"); assert.equal(JSON.stringify(b).includes("lead@"), false, "email never echoed");
});
test("read returns the project read only, with the underlay stripped", async () => {
  const m = mk(); const { id } = await j(await m.post({ project: project() }));
  const r = await m.call("/projects/" + id); assert.equal(r.status, 200); const b = await j(r);
  assert.equal(b.project.name, "My house"); assert.equal(b.project.site.underlay, null); assert.equal(r.headers.get("cache-control"), "no-store");
  assert.equal((await m.call("/projects/" + id, { method: "DELETE" })).status, 405, "no delete route");
  assert.equal((await m.call("/projects/nope")).status, 404); assert.equal((await m.call("/projects/" + "a".repeat(20))).status, 404);
});
test("update needs the edit key", async () => {
  const m = mk(); const { id, editKey } = await j(await m.post({ project: project() }));
  assert.equal((await m.put(id, { project: project({ name: "New" }) })).status, 403, "no key");
  assert.equal((await m.put(id, { project: project({ name: "New" }) }, "wrong-key")).status, 403, "wrong key");
  assert.equal((await j(await m.call("/projects/" + id))).project.name, "My house", "unchanged after refused updates");
  const ok = await m.put(id, { project: project({ name: "New" }) }, editKey); assert.equal(ok.status, 200);
  assert.equal((await j(await m.call("/projects/" + id))).project.name, "New"); assert.equal(m.db.prepare("SELECT name FROM projects").get().name, "New");
  assert.equal((await m.put("a".repeat(22), { project: project() }, editKey)).status, 404);
  assert.equal(m.db.prepare("SELECT email FROM projects").get().email, null, "no email given, none stored");
  await m.put(id, { project: project(), email: "a@b.co" }, editKey); await m.put(id, { project: project() }, editKey); assert.equal(m.db.prepare("SELECT email FROM projects").get().email, "a@b.co", "a later save without an email keeps it");
});
test("size cap: default 2 MB, PROJECT_MAX_BYTES overrides, same cap on update", async () => {
  const big = (n) => project({ notes: "x".repeat(n) });
  const m = mk(); assert.equal((await m.post({ project: big(2_100_000) })).status, 413);
  const e = await j(await m.post({ project: big(2_100_000) })); assert.equal(e.error.code, "PROJECT_TOO_LARGE"); assert.equal(e.error.maxBytes, 2e6);
  assert.equal((await m.post({ project: big(1_500_000) })).status, 201);
  const s = mk({ PROJECT_MAX_BYTES: "5000" }); assert.equal((await s.post({ project: big(6000) })).status, 413);
  const { id, editKey } = await j(await s.post({ project: big(100) })); assert.equal((await s.put(id, { project: big(6000) }, editKey)).status, 413);
  assert.equal(s.db.prepare("SELECT COUNT(*) n FROM projects").get().n, 1); assert.equal(s.files.size, 1, "nothing stored for refused saves");
  const huge = await s.call("/projects", { method: "POST", headers: { "content-length": "99999999" }, body: "{}" }); assert.equal(huge.status, 413);
});
test("bad input is refused", async () => {
  const m = mk();
  assert.equal((await m.post("not json")).status, 400); assert.equal((await m.post({})).status, 400); assert.equal((await m.post({ project: { schema: 1 } })).status, 400);
  assert.equal((await m.post({ project: [] })).status, 400); assert.equal((await m.post({ project: project(), email: "nope" })).status, 400);
  assert.equal(m.files.size, 0);
});
test("rate limit per IP on saves (20 an hour by default), other IPs unaffected", async () => {
  const m = mk({ PROJECT_SAVE_RATE_MAX: "3" });
  for (let i = 0; i < 3; i++) assert.equal((await m.post({ project: project() }, "9.9.9.9")).status, 201);
  const r = await m.post({ project: project() }, "9.9.9.9"); assert.equal(r.status, 429); const b = await j(r); assert.equal(b.error.code, "RATE_LIMITED"); assert.ok(r.headers.get("retry-after"));
  assert.equal((await m.post({ project: project() }, "8.8.8.8")).status, 201);
  const d = mk(); const rs = await Promise.all(Array.from({ length: 25 }, () => d.post({ project: project() }, "7.7.7.7"))); assert.equal(rs.filter((x) => x.status === 201).length, 20);
});
test("expiry: PROJECT_TTL_DAYS, extended by a save, expired links are 410 and cleaned up", async () => {
  const m = mk({ PROJECT_TTL_DAYS: "10" }); const { id, editKey, expiresAt } = await j(await m.post({ project: project() }));
  const days = (Date.parse(expiresAt) - Date.now()) / 864e5; assert.ok(days > 9.99 && days <= 10);
  assert.equal(((await j(await mk().post({ project: project() }))).expiresAt > new Date(Date.now() + 360 * 864e5).toISOString()), true, "default 365 days");
  m.db.prepare("UPDATE projects SET expires_at=?").run(new Date(Date.now() + 1000).toISOString());
  assert.equal((await m.put(id, { project: project() }, editKey)).status, 200); const ext = m.db.prepare("SELECT expires_at e FROM projects").get().e; assert.ok(Date.parse(ext) - Date.now() > 9 * 864e5, "save extends the expiry");
  m.db.prepare("UPDATE projects SET expires_at=?").run(new Date(Date.now() - 1000).toISOString());
  const g = await m.call("/projects/" + id); assert.equal(g.status, 410); assert.equal((await j(g)).error.code, "EXPIRED");
  assert.equal(m.db.prepare("SELECT COUNT(*) n FROM projects").get().n, 0); assert.equal(m.files.size, 0, "row and file removed");
  const { id: id2, editKey: k2 } = await j(await m.post({ project: project() })); m.db.prepare("UPDATE projects SET expires_at=?").run(new Date(Date.now() - 1000).toISOString());
  assert.equal((await m.put(id2, { project: project() }, k2)).status, 410, "an expired design cannot be updated");
});
test("CORS, preflight and health report; unavailable without storage", async () => {
  const m = mk(); const pre = await m.call("/projects/abc", { method: "OPTIONS" }); assert.equal(pre.status, 204);
  assert.match(pre.headers.get("access-control-allow-headers"), /x-edit-key/); assert.match(pre.headers.get("access-control-allow-methods"), /PUT/);
  assert.equal((await j(await m.call("/health"))).sharing, true);
  const bare = mk(); delete bare.env.FILES; assert.equal((await bare.post({ project: project() })).status, 503); assert.equal((await j(await bare.call("/health"))).sharing, false);
});
test("nothing in the share code sends email or contacts anyone", () => {
  const src = rd("../projects.js"); assert.ok(!/fetch\(|sendmail|smtp|mailgun|resend|sendgrid/i.test(src));
});
