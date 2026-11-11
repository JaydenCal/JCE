// Save and share. Stores a Pocket Architect design (JSON) in R2 under a random id and keeps a small row in D1.
//   POST /api/projects            { project, email? }   -> { id, editKey, url, expiresAt }   (creates)
//   GET  /api/projects/:id                              -> { id, project, createdAt, updatedAt, expiresAt }  (read only, public link)
//   PUT  /api/projects/:id        header x-edit-key     -> { id, url, updatedAt, expiresAt }  (updates)
// No account. The edit key is shown once, kept by the browser that saved, and stored here only as a SHA-256 hash.
// The optional email is stored as a lead on the row. Nothing in this file sends email.
const DEF_MAX_BYTES = 2e6, DEF_TTL_DAYS = 365, ID_RE = /^[A-Za-z0-9_-]{16,40}$/;
const enc = new TextEncoder();
const b64u = (u8) => btoa(String.fromCharCode(...u8)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const rand = (n) => b64u(crypto.getRandomValues(new Uint8Array(n)));
const sha = async (s) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(s)))].map((b) => b.toString(16).padStart(2, "0")).join("");
const same = (a, b) => { a = String(a); b = String(b); let d = a.length ^ b.length; for (let i = 0; i < b.length; i++) d |= a.charCodeAt(i % (a.length || 1)) ^ b.charCodeAt(i); return d === 0; };
const maxBytes = (env) => +env.PROJECT_MAX_BYTES > 0 ? +env.PROJECT_MAX_BYTES : DEF_MAX_BYTES;
const ttlDays = (env) => +env.PROJECT_TTL_DAYS > 0 ? +env.PROJECT_TTL_DAYS : DEF_TTL_DAYS;
const expiryFrom = (env, from = Date.now()) => new Date(from + ttlDays(env) * 864e5).toISOString();
const shareUrl = (env, id) => `${String(env.APP_URL || "").split("?")[0]}?share=${id}`;
const r2key = (id) => `projects/${id}.json`;

// Accepts the body, returns { ok: json text, name, email } or { error: Response }.
async function readBody(req, env, { err }) {
  const cap = maxBytes(env), declared = +req.headers.get("content-length");
  // The wrapper adds a little around the project, so allow a small margin before the exact check below.
  if (declared > cap + 4096) return { error: err(413, "PROJECT_TOO_LARGE", "This design is too large to save online.", { maxBytes: cap }) };
  const raw = await req.text();
  if (enc.encode(raw).length > cap + 4096) return { error: err(413, "PROJECT_TOO_LARGE", "This design is too large to save online.", { maxBytes: cap }) };
  let body; try { body = JSON.parse(raw); } catch { return { error: err(400, "BAD_REQUEST", "Bad request.") }; }
  const p = body?.project;
  if (!p || typeof p !== "object" || Array.isArray(p) || typeof p.schema !== "number" || !Array.isArray(p.levels) || !p.levels.length || (p.id != null && typeof p.id !== "string"))
    return { error: err(400, "BAD_PROJECT", "That is not a Pocket Architect design.") };
  // The tracing underlay is an image kept in the browser. It is never stored online.
  if (p.site && typeof p.site === "object") p.site.underlay = null;
  const text = JSON.stringify(p), size = enc.encode(text).length;
  if (size > cap) return { error: err(413, "PROJECT_TOO_LARGE", "This design is too large to save online.", { maxBytes: cap, bytes: size }) };
  let email = null;
  if (typeof body.email === "string" && body.email.trim()) {
    email = body.email.toLowerCase().trim();
    if (email.length > 254 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { error: err(400, "BAD_EMAIL", "Enter a valid email or leave it blank.") };
  }
  return { text, size, email, name: String(p.name || "").slice(0, 80) };
}

async function drop(env, id) {
  try { await env.FILES.delete(r2key(id)); } catch { /* the row is the source of truth; an orphan file is harmless */ }
  await env.DB.prepare("DELETE FROM projects WHERE id=?").bind(id).run();
}
async function sweep(env) { // occasional tidy of expired designs, a few at a time
  if (Math.random() >= 0.02) return;
  const now = new Date().toISOString();
  for (let i = 0; i < 10; i++) {
    const row = await env.DB.prepare("SELECT id FROM projects WHERE expires_at<=?").bind(now).first().catch(() => null);
    if (!row) break;
    await drop(env, row.id).catch(() => null);
  }
}

export async function handleProjects(req, env, path, { J, err, ipLimit }) {
  if (!env.FILES || !env.DB) return err(503, "SHARING_UNAVAILABLE", "Saving online is not available right now.");
  const id = path === "/projects" ? null : path.slice("/projects/".length);
  if (id !== null && !ID_RE.test(id)) return err(404, "NOT_FOUND", "That shared design was not found.");
  const now = new Date().toISOString();

  if (id === null && req.method === "POST") {
    const lim = await ipLimit(env, req, "projsave", +env.PROJECT_SAVE_RATE_MAX || 20, 3600); if (lim) return lim;
    const b = await readBody(req, env, { err }); if (b.error) return b.error;
    const nid = rand(15), key = rand(24), ip = req.headers.get("cf-connecting-ip") || "", exp = expiryFrom(env);
    await env.FILES.put(r2key(nid), b.text, { httpMetadata: { contentType: "application/json" } });
    try {
      await env.DB.prepare("INSERT INTO projects(id,edit_key_hash,name,email,bytes,created_at,updated_at,expires_at,ip_hash) VALUES(?,?,?,?,?,?,?,?,?)")
        .bind(nid, await sha(key), b.name, b.email, b.size, now, now, exp, ip ? await sha((env.IP_HASH_SALT || "") + ip) : null).run();
    } catch (x) { try { await env.FILES.delete(r2key(nid)); } catch { /* ignore */ } throw x; }
    await sweep(env);
    return J({ id: nid, editKey: key, url: shareUrl(env, nid), expiresAt: exp, bytes: b.size }, 201);
  }

  if (id !== null && req.method === "GET") {
    const lim = await ipLimit(env, req, "projget", +env.PROJECT_READ_RATE_MAX || 600, 3600); if (lim) return lim;
    const row = await env.DB.prepare("SELECT * FROM projects WHERE id=?").bind(id).first();
    if (!row) return err(404, "NOT_FOUND", "That shared design was not found. The link may be wrong.");
    if (row.expires_at <= now) { await drop(env, id).catch(() => null); return err(410, "EXPIRED", "That shared link has expired."); }
    const obj = await env.FILES.get(r2key(id));
    if (!obj) return err(404, "NOT_FOUND", "That shared design was not found.");
    const text = typeof obj.text === "function" ? await obj.text() : String(obj.body ?? "");
    return J({ id, project: JSON.parse(text), name: row.name, createdAt: row.created_at, updatedAt: row.updated_at, expiresAt: row.expires_at }, 200, { "cache-control": "no-store" });
  }

  if (id !== null && req.method === "PUT") {
    const lim = await ipLimit(env, req, "projsave", +env.PROJECT_SAVE_RATE_MAX || 20, 3600); if (lim) return lim;
    const row = await env.DB.prepare("SELECT * FROM projects WHERE id=?").bind(id).first();
    if (!row) return err(404, "NOT_FOUND", "That shared design was not found.");
    const given = req.headers.get("x-edit-key") || "";
    if (!given || !same(await sha(given), row.edit_key_hash)) return err(403, "BAD_EDIT_KEY", "This browser does not have permission to change that design.");
    if (row.expires_at <= now) { await drop(env, id).catch(() => null); return err(410, "EXPIRED", "That shared link has expired. Save again to make a new link."); }
    const b = await readBody(req, env, { err }); if (b.error) return b.error;
    await env.FILES.put(r2key(id), b.text, { httpMetadata: { contentType: "application/json" } });
    const exp = expiryFrom(env);
    await env.DB.prepare("UPDATE projects SET name=?, bytes=?, updated_at=?, expires_at=?, email=COALESCE(?, email) WHERE id=?").bind(b.name, b.size, now, exp, b.email, id).run();
    return J({ id, url: shareUrl(env, id), updatedAt: now, expiresAt: exp, bytes: b.size });
  }
  return err(405, "BAD_REQUEST", "Not supported.");
}
