// Export tests. Part 1 (always): handleExport in Node against an in-memory sqlite D1 stand in: validation, limits, PDF rule, file validity.
// Part 2 (when SERVER_MINIFLARE=1 or by default if miniflare is installed): the real worker bundle inside workerd via Miniflare.
//   cd server && node test/exports.test.mjs          (set EXPORTS_SKIP_WORKERD=1 to skip part 2)
import { DatabaseSync } from "node:sqlite"; import assert from "node:assert"; import fs from "node:fs"; import crypto from "node:crypto";
import zlib from "node:zlib"; import { execFileSync } from "node:child_process"; import os from "node:os"; import path from "node:path";
import worker from "../worker.js"; import { handleExport } from "../exports.js";
const here = new URL(".", import.meta.url).pathname, rd = (p) => fs.readFileSync(path.join(here, p), "utf8");
const project = JSON.parse(rd("fixtures/exports-project-4bed.json"));
const crc = (b) => { let c, t = []; for (let n = 0; n < 256; n++) { c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } let r = 0xffffffff; for (const x of b) r = t[(r ^ x) & 255] ^ (r >>> 8); return (r ^ 0xffffffff) >>> 0; };
const chunk = (t, d) => { const b = Buffer.concat([Buffer.from(t), d]), o = Buffer.alloc(4); o.writeUInt32BE(d.length); const c = Buffer.alloc(4); c.writeUInt32BE(crc(b)); return Buffer.concat([o, b, c]); };
const png = (w, h) => { const ih = Buffer.alloc(13); ih.writeUInt32BE(w, 0); ih.writeUInt32BE(h, 4); ih[8] = 8; ih[9] = 2; const raw = Buffer.alloc((w * 3 + 1) * h, 0x80); for (let y = 0; y < h; y++) raw[y * (w * 3 + 1)] = 0; return "data:image/png;base64," + Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ih), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]).toString("base64"); };
const IMG = png(64, 40);
const mk = () => {
  const db = new DatabaseSync(":memory:"); db.exec(rd("../schema.sql") + rd("../migrations/0002_exports.sql"));
  const DB = { prepare: (sql) => { const st = db.prepare(sql); return { bind: (...a) => ({ run: async () => ({ meta: { changes: st.run(...a).changes } }), first: async () => st.get(...a) ?? null }) }; } };
  const files = new Map(); const FILES = { get: async (k) => files.has(k) ? { body: files.get(k), customMetadata: files.get(k + "#m") } : null, put: async (k, v, o) => { files.set(k, v); files.set(k + "#m", o?.customMetadata); } };
  return { db, files, env: { DB, FILES, SITE_URL: "https://x.test", ENTITLEMENT_SECRET: "s3cret", IP_HASH_SALT: "salt", EXPORT_RATE_PER_HOUR: "6" } };
};
const { db, files, env } = mk();
const ent = (id, allowed = 1) => { db.prepare("INSERT INTO entitlements(id,project_id,credits_total,pdf_allowed,status,created_at) VALUES(?,?,?,?,'active','x')").run(id, "p", 500, allowed); return { id }; };
const post = (type, body, e, extra = {}) => handleExport(new Request("https://x.test/api/export/" + type, { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body), headers: { "cf-connecting-ip": "203.0.113.9", ...extra } }), env, e, type);
const code = async (r) => (await r.json()).error.code;

// validation
const e1 = ent("e_valid0001");
assert.equal((await post("dxf", "not json", e1)).status, 400);
assert.equal((await post("dxf", { project: { levels: "x" } }, e1)).status, 400);
assert.equal((await post("dxf", { nope: 1 }, e1)).status, 400);
assert.equal((await post("zip", { project }, e1)).status, 404);
env.EXPORT_MAX_BODY_BYTES = "100"; assert.equal((await post("dxf", { project }, e1)).status, 413); delete env.EXPORT_MAX_BODY_BYTES;
// the four types
const dxf = await post("dxf", { project }, e1); assert.equal(dxf.status, 200); assert.equal(dxf.headers.get("content-type"), "application/dxf");
assert.match(dxf.headers.get("content-disposition"), /^attachment; filename="[\w.\- ]+\.dxf"/);
const dtxt = await dxf.text(); assert.ok(/SECTION[\s\S]*ENTITIES[\s\S]*EOF/.test(dtxt));
const glb = await post("glb", { project }, e1); assert.equal(glb.headers.get("content-type"), "model/gltf-binary");
const gb = new Uint8Array(await glb.arrayBuffer()); assert.equal(new TextDecoder().decode(gb.subarray(0, 4)), "glTF"); assert.equal(new DataView(gb.buffer).getUint32(8, true), gb.length);
const obj = await post("obj", { project }, e1); assert.equal(obj.headers.get("content-type"), "application/zip");
const ob = new Uint8Array(await obj.arrayBuffer()); assert.equal(ob[0], 0x50); assert.ok(new TextDecoder("latin1").decode(ob).includes(".mtl"));
// export_log: 7 rows so far counted? 3 validation failures do not log (rejected before rate limit); 413 neither
assert.equal(db.prepare("SELECT COUNT(*) n FROM export_log WHERE entitlement_id='e_valid0001'").get().n, 3);
const row = db.prepare("SELECT * FROM export_log LIMIT 1").get(); assert.equal(row.ip_hash, crypto.createHash("sha256").update("salt203.0.113.9").digest("hex"));
// rate limit (6/hour)
for (let i = 0; i < 3; i++) assert.equal((await post("dxf", { project }, e1)).status, 200);
const rl = await post("dxf", { project }, e1); assert.equal(rl.status, 429); assert.equal(await code(rl), "RATE_LIMITED"); assert.ok(rl.headers.get("retry-after"));
assert.equal((await post("dxf", { project }, ent("e_valid0002"))).status, 200); // limit is per entitlement
// PDF: one set, stamped, re-delivered, given back on failure
const e2 = ent("e_pdfset0001");
const bad = await post("pdf", { project: { levels: [null] } }, e2); assert.equal(bad.status, 500);
assert.equal(db.prepare("SELECT pdf_used FROM entitlements WHERE id='e_pdfset0001'").get().pdf_used, 0);          // set given back
const [p1, p2] = await Promise.all([post("pdf", { project }, e2), post("pdf", { project }, e2)]);                  // simultaneous first requests
assert.deepEqual([p1.status, p2.status], [200, 200]);
const b1 = new Uint8Array(await p1.arrayBuffer()), b2 = new Uint8Array(await p2.arrayBuffer()); assert.equal(b1.length, b2.length);
assert.equal(db.prepare("SELECT pdf_used FROM entitlements WHERE id='e_pdfset0001'").get().pdf_used, 1);          // exactly one set
assert.equal(new TextDecoder().decode(b1.subarray(0, 5)), "%PDF-"); assert.ok(new TextDecoder("latin1").decode(b1).includes("trace:PA-PDFSET00"));
assert.equal(p1.headers.get("content-type"), "application/pdf");
const p3 = await post("pdf", { project }, e2); assert.equal(p3.status, 200); assert.equal((await p3.arrayBuffer()).byteLength, b1.length); // same stored file
// the wired worker still authenticates before exporting
const rw = await worker.fetch(new Request("https://x.test/api/export/dxf", { method: "POST", body: "{}" }), env); assert.equal(rw.status, 401);
const e3 = ent("e_pdfimg0001"); const pi = await post("pdf", { project, image: IMG }, e3); assert.equal(pi.status, 200);
const pib = new Uint8Array(await pi.arrayBuffer()); assert.ok(pib.length > b1.length, "snapshot adds a 3D view sheet");
console.log("exports tests (node) passed");

// ---- part 2: workerd via Miniflare, real tokens, concurrency -----------------------------------------------------------
if (!process.env.EXPORTS_SKIP_WORKERD) {
  const { Miniflare } = await import("miniflare");
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "exw-"));
  const toml = `name="t"\nmain="${path.resolve(here, "../worker.js")}"\ncompatibility_date="2026-01-01"\n[[d1_databases]]\nbinding="DB"\ndatabase_name="testdb"\ndatabase_id="00000000-0000-0000-0000-000000000000"\n[[r2_buckets]]\nbinding="FILES"\nbucket_name="testbucket"\n`;
  fs.writeFileSync(path.join(scratch, "wrangler.toml"), toml);
  execFileSync("npx", ["wrangler", "deploy", "-c", path.join(scratch, "wrangler.toml"), "--dry-run", "--outdir", path.join(scratch, "dist")], { cwd: path.resolve(here, ".."), env: { ...process.env, HOME: scratch }, stdio: "pipe" });
  const bundle = path.join(scratch, "dist/worker.js");
  const mf = new Miniflare({ modulesRoot: path.dirname(bundle), modules: [{ type: "ESModule", path: bundle, contents: fs.readFileSync(bundle) }], compatibilityDate: "2026-01-01", d1Databases: ["DB"], r2Buckets: ["FILES"], bindings: { SITE_URL: "https://x.test", APP_URL: "https://x.test/app/", ENTITLEMENT_SECRET: "s3", TEST_CODES: "T-CODE", TEST_CODE_MAX_USES: "50", EXPORT_RATE_PER_HOUR: "8", IP_HASH_SALT: "salt" }, d1Persist: false, r2Persist: false });
  try {
    const D = await mf.getD1Database("DB");
    for (const s of (rd("../schema.sql") + rd("../migrations/0002_exports.sql")).replace(/--.*$/gm, "").split(";").map((x) => x.trim()).filter(Boolean)) await D.prepare(s.replace(/\s+/g, " ")).run();
    const api = (p, o) => mf.dispatchFetch("https://x.test/api" + p, o);
    const token = async (m) => (await (await api("/entitlement/restore", { method: "POST", body: JSON.stringify({ email: m, sessionOrReceipt: "T-CODE" }) })).json()).token;
    const body = JSON.stringify({ project });
    const H = (t) => ({ authorization: "Bearer " + t, "content-type": "application/json" });
    const t0 = await token("a@x.com");
    for (const [type, magic, mime] of [["dxf", null, "application/dxf"], ["glb", "glTF", "model/gltf-binary"], ["obj", "PK", "application/zip"], ["pdf", "%PDF", "application/pdf"]]) {
      const r = await api("/export/" + type, { method: "POST", body, headers: H(t0) }); assert.equal(r.status, 200, type + " " + r.status); assert.equal(r.headers.get("content-type"), mime);
      const b = new Uint8Array(await r.arrayBuffer()); if (magic) assert.equal(new TextDecoder().decode(b.subarray(0, magic.length)), magic);
    }
    const ti = await token("img@x.com"); const ri = await api("/export/pdf", { method: "POST", body: JSON.stringify({ project, image: IMG }), headers: H(ti) });
    assert.equal(ri.status, 200); assert.ok((await ri.arrayBuffer()).byteLength > 1000);
    // concurrency: two first PDF requests on one fresh entitlement yield exactly one set
    const t1 = await token("b@x.com");
    const both = await Promise.all([1, 2].map(() => api("/export/pdf", { method: "POST", body, headers: H(t1) })));
    assert.deepEqual(both.map((r) => r.status), [200, 200]);
    assert.equal((await D.prepare("SELECT pdf_used u FROM entitlements WHERE email='b@x.com'").first()).u, 1);
    // 20 concurrent mixed requests over several entitlements: no crashes
    const toks = await Promise.all(["c", "d", "e", "f"].map((n) => token(n + "@x.com")));
    const rs = await Promise.all(Array.from({ length: 20 }, async (_, i) => { const r = await api("/export/" + ["dxf", "glb", "obj", "pdf"][i % 4], { method: "POST", body, headers: H(toks[i % 4]) }); return { status: r.status, bytes: (await r.arrayBuffer()).byteLength }; }));
    for (const [i, r] of rs.entries()) { assert.equal(r.status, 200, "concurrent " + i + " status " + r.status); assert.ok(r.bytes > 1000, "concurrent " + i + " empty body"); }
    // rate limit (8/hour): entitlement t0 already used 4
    let last; for (let i = 0; i < 6; i++) { last = await api("/export/dxf", { method: "POST", body, headers: H(t0) }); await last.arrayBuffer(); }
    assert.equal(last.status, 429);
    console.log("exports tests (workerd) passed");
  } finally { await mf.dispose(); fs.rmSync(scratch, { recursive: true, force: true }); }
}
