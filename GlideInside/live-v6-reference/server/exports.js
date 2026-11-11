// Server side exports for Pocket Architect: PDF, DXF, GLB, OBJ zip and interactive HTML, built with the app's own export code
// (server/exporters/server-exporters.mjs, built by the app source and installed by tools/install_app.py) so files match the browser.
// Web-standard APIs only (runs in workerd). handleExport is called by worker.js after authentication.
const J = (o, s = 200, h = {}) => new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json", ...h } });
const err = (s, code, message, extra = {}, h = {}) => J({ error: { code, message, ...extra } }, s, h);
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
const TYPES = ["pdf", "dxf", "glb", "obj", "html"];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let engine = null; // { exporters, jsPDF, catalogue, config }, loaded once per isolate
async function load() {
  if (!engine) {
    const exporters = await import("./exporters/server-exporters.mjs");
    engine = { exporters, jsPDF: exporters.jsPDF, catalogue: exporters.getCatalogue(), config: exporters.getConfig() };
  }
  return engine;
}

const traceId = (eid) => "PA-" + String(eid).replace(/^[a-z]_/i, "").replace(/[^a-z0-9]/gi, "").slice(0, 8).toUpperCase();
const asciiName = (n) => String(n).replace(/[^\w.\- ]+/g, "_").slice(0, 80) || "export";
const disposition = (name) => `attachment; filename="${asciiName(name)}"; filename*=UTF-8''${encodeURIComponent(name)}`;
const MIME = { pdf: "application/pdf", dxf: "application/dxf", glb: "model/gltf-binary", obj: "application/zip", html: "text/html; charset=utf-8" };

// jsPDF's constructor returns its API object, so subclassing cannot add methods. Wrap the constructor instead:
// the instance's output() stamps a trace footer on every page and the PDF keywords just before serialising.
function tracedPDF(jsPDF, trace) {
  return function TracedPDF(...args) {
    const doc = new jsPDF(...args), out = doc.output;
    let done = false;
    doc.output = function (...a) {
      if (!done) {
        done = true;
        const n = doc.getNumberOfPages(), W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight();
        doc.setProperties({ keywords: "trace:" + trace });
        for (let p = 1; p <= n; p++) { doc.setPage(p); doc.setFont("helvetica", "normal"); doc.setFontSize(5); doc.setTextColor(120, 120, 120); doc.text(`Ref ${trace}`, W - 4, H - 1.6, { align: "right" }); }
      }
      return out.apply(doc, a);
    };
    return doc;
  };
}

async function ipHash(req, env) {
  const d = new TextEncoder().encode((env.IP_HASH_SALT || "") + (req.headers.get("cf-connecting-ip") || ""));
  return hex(await crypto.subtle.digest("SHA-256", d));
}

export async function handleExport(req, env, ent, type) {
  if (!TYPES.includes(type)) return err(404, "BAD_REQUEST", "Unknown export type.");
  if (req.method !== "POST") return err(405, "BAD_REQUEST", "Use POST.");
  // body: size cap, JSON, project shape
  const cap = +env.EXPORT_MAX_BODY_BYTES || 4000000;
  const declared = +req.headers.get("content-length");
  if (declared > cap) return err(413, "PAYLOAD_TOO_LARGE", "Project too large.");
  const raw = await req.arrayBuffer();
  if (raw.byteLength > cap) return err(413, "PAYLOAD_TOO_LARGE", "Project too large.");
  let body; try { body = JSON.parse(new TextDecoder().decode(raw)); } catch { return err(400, "BAD_REQUEST", "Body must be JSON."); }
  const project = body?.project;
  if (!project || typeof project !== "object" || Array.isArray(project) || !Array.isArray(project.levels)) return err(400, "BAD_REQUEST", "Missing project (an object with a levels array).");
  let image = null;
  if (type === "pdf" && typeof body.image === "string" && /^data:image\/(png|jpeg);base64,/i.test(body.image) && body.image.length <= 1.5e6) image = body.image;

  // rate limit: atomic insert only while fewer than N rows exist in the last hour
  const limit = +env.EXPORT_RATE_PER_HOUR || 20, now = new Date(), since = new Date(now - 36e5).toISOString();
  const ins = await env.DB.prepare("INSERT INTO export_log(entitlement_id,type,created_at,ip_hash) SELECT ?,?,?,? WHERE (SELECT COUNT(*) FROM export_log WHERE entitlement_id=? AND created_at>?)<?")
    .bind(ent.id, type, now.toISOString(), await ipHash(req, env), ent.id, since, limit).run();
  if (!ins.meta.changes) return err(429, "RATE_LIMITED", "Too many exports in the last hour. Please wait a few minutes and try again.", { limitPerHour: limit }, { "retry-after": "300" });

  if (type === "pdf") return pdf(env, ent, project, image);
  try {
    const out = await build(type, project, null);
    return new Response(out.bytes, { headers: { "content-type": MIME[type], "content-disposition": disposition(out.filename), "cache-control": "no-store", "x-content-type-options": "nosniff", ...(type === "html" ? { "content-security-policy": "sandbox" } : {}) } });
  } catch (x) {
    console.error("export failed", type, x?.stack || x);
    return err(500, "EXPORT_FAILED", "Could not build the file. Please try again.");
  }
}

async function build(type, project, opts) {
  const { exporters, jsPDF, catalogue, config } = await load();
  const o = { catalogue, config };
  if (type === "pdf") { o.jsPDF = tracedPDF(jsPDF, opts.trace); o.image = opts.image; }
  return exporters.buildExport(type, project, o);
}

async function pdf(env, ent, project, image) {
  // ONE PDF set per job. Single atomic UPDATE; zero rows changed means the set was already issued.
  const redeliver = async () => {
    const own = await env.DB.prepare("SELECT pdf_file FROM entitlements WHERE id=?").bind(ent.id).first();
    if (!own?.pdf_file) return null;
    const f = await env.FILES.get(own.pdf_file); if (!f) return null;
    const name = f.customMetadata?.filename || "plans.pdf";
    return new Response(f.body, { headers: { "content-type": "application/pdf", "content-disposition": disposition(name), "cache-control": "no-store" } });
  };
  const again = await redeliver(); if (again) return again;
  const u = await env.DB.prepare("UPDATE entitlements SET pdf_used=pdf_used+1 WHERE id=? AND pdf_used<pdf_allowed").bind(ent.id).run();
  if (!u.meta.changes) {
    // A simultaneous first request may still be generating the one set: wait briefly for it and give that file.
    const waitMs = env.EXPORT_PDF_WAIT_MS === undefined ? 10000 : +env.EXPORT_PDF_WAIT_MS;
    for (let t = 0; t < waitMs; t += 500) { await sleep(500); const r = await redeliver(); if (r) return r; }
    return err(403, "PDF_LIMIT_REACHED", "The PDF plan set for this job has already been issued.");
  }
  const giveBack = () => env.DB.prepare("UPDATE entitlements SET pdf_used=pdf_used-1 WHERE id=? AND pdf_used>0").bind(ent.id).run();
  let out;
  try { out = await build("pdf", project, { trace: traceId(ent.id), image }); }
  catch (x) { console.error("pdf failed", x?.stack || x); await giveBack(); return err(500, "EXPORT_FAILED", "Could not build the PDF. You have not been charged a set."); }
  const key = `pdf/${ent.id}.pdf`;
  try {
    await env.FILES.put(key, out.bytes, { httpMetadata: { contentType: "application/pdf" }, customMetadata: { filename: out.filename } });
    await env.DB.prepare("UPDATE entitlements SET pdf_file=? WHERE id=?").bind(key, ent.id).run();
  } catch (x) { console.error("pdf store failed", x?.stack || x); await giveBack(); return err(500, "EXPORT_FAILED", "Could not store the PDF. You have not been charged a set."); }
  return new Response(out.bytes, { headers: { "content-type": "application/pdf", "content-disposition": disposition(out.filename), "cache-control": "no-store" } });
}
