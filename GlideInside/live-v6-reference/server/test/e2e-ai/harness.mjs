// End-to-end harness for the AI assistant. Starts, all on 127.0.0.1:
//   mock Anthropic (MOCK_PORT 8805)   scripted tool-use replies derived from tools.json
//   Worker in Miniflare (D1 + R2 local, no listening port; reached through dispatchFetch)
//   web origin (WEB_PORT 8806)        serves site/ and forwards /api/* to the Worker, plus /__ctl/* test controls
// Usage: node server/test/e2e-ai/harness.mjs      (then drive http://127.0.0.1:8806/plan-studio/app/ with run_e2e.py)
import http from "node:http"; import fs from "node:fs"; import path from "node:path"; import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
const here = path.dirname(fileURLToPath(import.meta.url)), server = path.resolve(here, "../.."), site = path.resolve(server, "../site");
const req = createRequire(path.join(server, "package.json"));
const esbuild = req("esbuild"), { Miniflare } = req("miniflare");
const MOCK_PORT = +process.env.MOCK_PORT || 8805, WEB_PORT = +process.env.WEB_PORT || 8806;
const tools = JSON.parse(fs.readFileSync(path.join(server, "ai/tools.json"), "utf8"));

// ---- mock Anthropic ---------------------------------------------------------------------------------------------------
const mock = { log: [], mode: "normal", usage: { input_tokens: 6000, output_tokens: 200 } };
function lastText(body) { const m = body.messages.at(-1); return typeof m.content === "string" ? m.content : m.content.map((b) => b.text || "").join(""); }
function parsePlan(txt) { // read room rectangles out of the app's plan text without depending on its exact layout
  const rooms = []; for (const m of txt.matchAll(/(\d+)\.\.(\d+)[^\n]*?(\d+)\.\.(\d+)/g)) rooms.push([+m[1], +m[2], +m[3], +m[4]]);
  return rooms;
}
function script(body) {
  const txt = lastText(body), ask = (/User request: ([\s\S]*)$/.exec(txt) || [, ""])[1].trim().toLowerCase();
  for (const t of body.tools) if (!tools.some((x) => x.name === t.name)) throw new Error("mock got unknown tool " + t.name);
  if (/add a (\d+(?:\.\d+)?) x (\d+(?:\.\d+)?) m study on the east side/.test(ask)) {
    const [, w, d] = /add a (\d+(?:\.\d+)?) x (\d+(?:\.\d+)?) m study/.exec(ask), plan = txt.slice(txt.indexOf("<plan>"), txt.indexOf("</plan>"));
    const bounds = /BOUNDS x=(-?\d+)\.\.(-?\d+) y=(-?\d+)\.\.(-?\d+)/.exec(plan), x = (bounds ? +bounds[2] : 10000) + 400, y = bounds ? +bounds[3] + 4000 : 0; // east of the plan, level with the first rooms
    return { content: [{ type: "text", text: "I have added a study on the east side of the plan." }, { type: "tool_use", id: "tu_1", name: "add_room", input: { type: "study", name: "Study", x, y, width: Math.round(+w * 1000), depth: Math.round(+d * 1000) } }], stop_reason: "tool_use" };
  }
  if (/two changes/.test(ask)) return { content: [{ type: "text", text: "Done." }, { type: "tool_use", id: "tu_a", name: "add_room", input: { type: "study", name: "Study A", x: 30000, y: 0, width: 3000, depth: 3000 } }, { type: "tool_use", id: "tu_b", name: "add_room", input: { type: "study", name: "Study B", x: 34000, y: 0, width: 3000, depth: 3000 } }, { type: "tool_use", id: "tu_x", name: "delete_everything", input: {} }], stop_reason: "tool_use" };
  return { content: [{ type: "text", text: "Which part of the plan do you mean?" }], stop_reason: "end_turn" };
}
const mockSrv = http.createServer(async (rq, rs) => {
  let raw = ""; for await (const c of rq) raw += c;
  const body = JSON.parse(raw || "{}"); mock.last = lastText(body); mock.log.push({ url: rq.url, key: rq.headers["x-api-key"] ? "present" : "missing", version: rq.headers["anthropic-version"], tools: body.tools?.length, cached: !!body.system?.[0]?.cache_control });
  if (mock.mode === "busy") { rs.writeHead(529, { "content-type": "application/json" }); return rs.end(JSON.stringify({ type: "error", error: { type: "overloaded_error", message: "x" } })); }
  try { const r = script(body); rs.writeHead(200, { "content-type": "application/json" }); rs.end(JSON.stringify({ id: "msg_mock", type: "message", role: "assistant", model: body.model, ...r, usage: mock.usage })); }
  catch (e) { rs.writeHead(500, { "content-type": "application/json" }); rs.end(JSON.stringify({ error: { message: String(e) } })); }
}).listen(MOCK_PORT, "127.0.0.1");

// ---- Worker in Miniflare ------------------------------------------------------------------------------------------------
const tmp = fs.mkdtempSync(path.join(process.env.TMPDIR || "/tmp", "ai-e2e-"));
// The export module (three.js, pdf.js) is irrelevant to the assistant and cannot be loaded by Miniflare's module scanner, so stub it.
const stubExports = { name: "stub-exports", setup(b) { b.onResolve({ filter: /exports\.js$/ }, () => ({ path: "stub-exports", namespace: "stub" })); b.onLoad({ filter: /.*/, namespace: "stub" }, () => ({ contents: "export const handleExport = async () => new Response(JSON.stringify({error:{code:'EXPORT_NOT_CONFIGURED',message:'stub'}}),{status:501,headers:{'content-type':'application/json'}});", loader: "js" })); } };
await esbuild.build({ plugins: [stubExports], entryPoints: [path.join(server, "worker.js")], bundle: true, format: "esm", outfile: path.join(tmp, "worker.mjs"), logLevel: "error", target: "es2022" });
const mf = new Miniflare({
  modules: true, script: fs.readFileSync(path.join(tmp, "worker.mjs"), "utf8"), compatibilityDate: "2025-01-01", d1Databases: { DB: "e2e-db" }, r2Buckets: { FILES: "e2e-files" },
  bindings: { SITE_URL: `http://127.0.0.1:${WEB_PORT}`, APP_URL: `http://127.0.0.1:${WEB_PORT}/plan-studio/app/`, ENTITLEMENT_SECRET: "e2e-secret", PLAN_PACK_CREDITS: "500", TEST_CODES: "PA-FRIENDS-E2E",
    ANTHROPIC_API_KEY: "sk-ant-MOCK-NOT-REAL", ANTHROPIC_BASE_URL: `http://127.0.0.1:${MOCK_PORT}`, AI_RATE_PER_MIN: "100", AI_CONFIRM_ABOVE: "40", AI_MODEL: "mock-model" },
});
const DB = await mf.getD1Database("DB");
const stmts = (f) => fs.readFileSync(path.join(server, f), "utf8").replace(/--.*$/gm, "").split(";").map((s) => s.replace(/\s+/g, " ").trim()).filter(Boolean);
for (const f of ["schema.sql", "migrations/0003_ai.sql"]) for (const s of stmts(f)) await DB.prepare(s).run();

// ---- web origin ----------------------------------------------------------------------------------------------------------
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".webp": "image/webp", ".mp4": "video/mp4", ".woff2": "font/woff2" };
const web = http.createServer(async (rq, rs) => { try {
  const u = new URL(rq.url, "http://x"); let raw = Buffer.alloc(0); for await (const c of rq) raw = Buffer.concat([raw, c]);
  const json = (o, s = 200) => { rs.writeHead(s, { "content-type": "application/json" }); rs.end(JSON.stringify(o)); };
  if (u.pathname === "/__ctl/sql") { const { sql, args = [] } = JSON.parse(raw.toString()); const r = /^\s*select/i.test(sql) ? await DB.prepare(sql).bind(...args).all() : await DB.prepare(sql).bind(...args).run(); return json(r.results ?? { ok: true }); }
  if (u.pathname === "/__ctl/mock") { Object.assign(mock, JSON.parse(raw.toString() || "{}")); return json({ ok: true, mode: mock.mode }); }
  if (u.pathname === "/__ctl/mocklast") return json({ text: mock.last || "" });
  if (u.pathname === "/__ctl/mocklog") return json(mock.log);
  if (u.pathname.startsWith("/api/")) {
    const r = await mf.dispatchFetch(`http://worker.test${u.pathname}${u.search}`, { method: rq.method, headers: Object.fromEntries(Object.entries(rq.headers).filter(([k]) => ["authorization", "content-type", "stripe-signature"].includes(k))), body: ["GET", "HEAD"].includes(rq.method) ? undefined : raw });
    rs.writeHead(r.status, Object.fromEntries(r.headers)); return rs.end(Buffer.from(await r.arrayBuffer()));
  }
  let f = path.join(site, decodeURIComponent(u.pathname)); if (!f.startsWith(site)) { rs.writeHead(403); return rs.end(); }
  if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, "index.html");
  if (!fs.existsSync(f)) { rs.writeHead(404); return rs.end("not found"); }
  rs.writeHead(200, { "content-type": MIME[path.extname(f)] || "application/octet-stream" }); fs.createReadStream(f).pipe(rs);
} catch (e) { console.error("web error", e); rs.writeHead(500, { "content-type": "application/json" }); rs.end(JSON.stringify({ error: String(e) })); } }).listen(WEB_PORT, "127.0.0.1");
console.log(`READY web http://127.0.0.1:${WEB_PORT}/plan-studio/app/ mock :${MOCK_PORT}`);
const stop = async () => { web.close(); mockSrv.close(); await mf.dispose(); process.exit(0); };
process.on("SIGTERM", stop); process.on("SIGINT", stop);
