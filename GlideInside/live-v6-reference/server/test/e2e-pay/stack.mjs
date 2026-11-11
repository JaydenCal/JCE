import http from "node:http"; import fs from "node:fs"; import path from "node:path"; import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
const require = createRequire(new URL("../../package.json", import.meta.url));
const { Miniflare } = require("miniflare"); const esbuild = require("esbuild");
const HERE = path.dirname(fileURLToPath(import.meta.url)), SERVER = path.resolve(HERE, "../.."), SITE = path.resolve(SERVER, "../site");
const PORT = +process.env.STACK_PORT || 8810, MF_PORT = +process.env.MF_PORT || 8812, STRIPE_PORT = +process.env.MOCK_STRIPE_PORT || 8811;
export const WHSEC = "whsec_test_local_secret", SECRETS = { STRIPE_SECRET_KEY: "sk_test_mock", STRIPE_WEBHOOK_SECRET: WHSEC, ENTITLEMENT_SECRET: "local-entitlement-secret", TEST_CODES: "PA-FRIENDS-TEST", TEST_CODE_MAX_USES: "3" };
const out = path.join(process.env.SCRATCH || "/tmp", "pa-worker-bundle.mjs");
await esbuild.build({ entryPoints: [path.join(SERVER, "worker.js")], bundle: true, format: "esm", outfile: out, platform: "neutral", logLevel: "error",
  plugins: [{ name: "stub", setup(b) {
    b.onResolve({ filter: /^\.\/(exports|ai)\.js$/ }, (a) => ({ path: a.path, namespace: "stub" }));
    b.onLoad({ filter: /.*/, namespace: "stub" }, () => ({ contents: 'const r = () => new Response(JSON.stringify({ error: { code: "EXPORT_NOT_CONFIGURED", message: "stub" } }), { status: 501, headers: { "content-type": "application/json" } }); export const handleExport = r, handleAI = r;', loader: "js" }));
  } }] });
const mf = new Miniflare({ modules: true, script: fs.readFileSync(out, "utf8"), compatibilityDate: "2025-01-01", port: MF_PORT, host: "127.0.0.1",
  d1Databases: { DB: "pa-db" }, r2Buckets: { FILES: "pa-files" },
  bindings: { ...SECRETS, SITE_URL: `http://127.0.0.1:${PORT}`, APP_URL: `http://127.0.0.1:${PORT}/plan-studio/app/`, STRIPE_API_BASE: `http://127.0.0.1:${STRIPE_PORT}`, PLAN_PRICE_CENTS: "3500", PLAN_PACK_CREDITS: "500", ENTITLEMENT_DAYS: "365" } });
await mf.ready;
const db = await mf.getD1Database("DB");
const sqlFiles = [path.join(SERVER, "schema.sql"), ...(fs.existsSync(path.join(SERVER, "migrations")) ? fs.readdirSync(path.join(SERVER, "migrations")).filter((f) => f.endsWith(".sql")).sort().map((f) => path.join(SERVER, "migrations", f)) : [])];
for (const f of sqlFiles) { const sql = fs.readFileSync(f, "utf8").replace(/--.*$/gm, ""); for (const st of sql.split(";").map((x) => x.replace(/\s+/g, " ").trim()).filter(Boolean)) await db.exec(st); }
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".webp": "image/webp", ".mp4": "video/mp4", ".xml": "application/xml", ".txt": "text/plain" };
http.createServer(async (req, res) => {
  const u = new URL(req.url, "http://x");
  if (u.pathname.startsWith("/api/")) {
    const chunks = []; for await (const c of req) chunks.push(c);
    const r = await mf.dispatchFetch(`http://127.0.0.1:${MF_PORT}${u.pathname}${u.search}`, { method: req.method, headers: req.headers, body: ["GET", "HEAD"].includes(req.method) ? undefined : Buffer.concat(chunks) });
    res.writeHead(r.status, Object.fromEntries(r.headers)); return res.end(Buffer.from(await r.arrayBuffer()));
  }
  if (u.pathname.startsWith("/_db")) { const r = await db.prepare(u.searchParams.get("q")).all(); res.writeHead(200, { "content-type": "application/json" }); return res.end(JSON.stringify(r.results)); }
  let p = path.join(SITE, decodeURIComponent(u.pathname)); if (!p.startsWith(SITE)) { res.writeHead(403); return res.end(); }
  if (fs.existsSync(p) && fs.statSync(p).isDirectory()) p = path.join(p, "index.html");
  if (!fs.existsSync(p)) { res.writeHead(404); return res.end("not found"); }
  if (process.env.PATCH_APP === "1" && u.pathname.endsWith("/plan-studio/app/index.html") || (process.env.PATCH_APP === "1" && u.pathname.endsWith("/plan-studio/app/"))) {
    let h = fs.readFileSync(path.join(SITE, "plan-studio/app/index.html"), "utf8"), n = 0;
    h = h.replace(/restore:\(\{email:(\w+),sessionOrReceipt:(\w+)\}\)=>(\w+)\("POST","\/entitlement\/restore",\{body:\{email:\w+,sessionOrReceipt:\w+\}/, (m, a, b, c) => (n++, `restore:({email:${a},sessionOrReceipt:${b},projectId:pj})=>${c}("POST","/entitlement/restore",{body:{email:${a},sessionOrReceipt:${b},projectId:pj}`));
    h = h.replace(/(\w+)\.restore\(\{email:(\w+),sessionOrReceipt:(\w+)\}\)/, (m, a, b, c) => (n++, `${a}.restore({email:${b},sessionOrReceipt:${c},projectId:window.__ps&&window.__ps.store&&window.__ps.store.project.id})`));
    if (n !== 2) throw new Error("app restore patch did not match");
    res.writeHead(200, { "content-type": "text/html" }); return res.end(h);
  }
  res.writeHead(200, { "content-type": types[path.extname(p)] || "application/octet-stream" }); fs.createReadStream(p).pipe(res);
}).listen(PORT, "127.0.0.1", () => console.log("stack on", PORT));
process.on("SIGTERM", async () => { await mf.dispose(); process.exit(0); });
