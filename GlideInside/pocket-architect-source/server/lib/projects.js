// Save and share, carried over from the live Pocket Architect API (Worker "pocket-architect-api", deployed 15/10/2026).
// Same paths, same request and response bodies, same error codes, same storage, so every share link already handed out keeps working:
//   POST /api/projects            { project, email? }   -> 201 { id, editKey, url, expiresAt, bytes }        (creates)
//   GET  /api/projects/:id                              -> { id, project, name, createdAt, updatedAt, expiresAt }  (public, read only)
//   PUT  /api/projects/:id        header x-edit-key     -> { id, url, updatedAt, expiresAt, bytes }        (updates, extends the expiry)
// The design is JSON in R2 under projects/<id>.json (the FILES binding, passed in as `files`). The D1 table "projects" holds the lookup,
// the SHA-256 of the edit key, the optional lead email and the expiry. No account is needed. Nothing here sends email.
//
// Injected: store (createSharedProject and friends in lib/store.js), files (R2 bucket binding: put, get, delete), config, now.

import { HttpError, json, readText, clientIp } from './http.js';

export const SHARE_ID_RE = /^[A-Za-z0-9_-]{16,40}$/;
const enc = new TextEncoder();
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
const b64u = (u8) => btoa(String.fromCharCode(...u8)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const rand = (n) => b64u(crypto.getRandomValues(new Uint8Array(n)));
const sha = async (s) => hex(await crypto.subtle.digest('SHA-256', enc.encode(s)));
const same = (a, b) => {
  a = String(a);
  b = String(b);
  let d = a.length ^ b.length;
  for (let i = 0; i < b.length; i++) d |= a.charCodeAt(i % (a.length || 1)) ^ b.charCodeAt(i);
  return d === 0;
};
const r2key = (id) => `projects/${id}.json`;

export function createProjects({ store, files, config, now = () => Date.now() }) {
  const iso = (ms = now()) => new Date(ms).toISOString();
  const expiryFrom = (ms = now()) => iso(ms + config.projectTtlDays * 86400000);
  const shareUrl = (id) => `${String(config.appUrl || '').split('?')[0]}?share=${id}`;
  const available = () => !!files && typeof store.createSharedProject === 'function';

  // Per visitor address limit, counted in the shared rate_limits table (the live Worker used its own ip_rate table).
  async function limit(request, scope, max, windowSec) {
    const ip = clientIp(request);
    const key = `${scope}:${await sha(config.ipHashSalt + ip)}`;
    if ((await store.hitRate(key, windowSec, now())) > max) {
      const retryAfter = Math.max(1, windowSec - (Math.floor(now() / 1000) % windowSec));
      throw new HttpError('RATE_LIMITED', 'Too many attempts. Please wait a while and try again.', { retryAfter });
    }
  }

  // Reads the body and returns { text, size, email, name }. Mirrors the live checks and messages.
  async function readBody(request) {
    const cap = config.projectMaxBytes;
    const tooLarge = (extra = {}) => new HttpError('PROJECT_TOO_LARGE', 'This design is too large to save online.', { maxBytes: cap, ...extra });
    let raw;
    try {
      raw = await readText(request, cap + 4096); // the wrapper adds a little around the project
    } catch (e) {
      if (e?.code === 'PAYLOAD_TOO_LARGE') throw tooLarge();
      throw e;
    }
    let body;
    try {
      body = JSON.parse(raw);
    } catch {
      throw new HttpError('BAD_REQUEST', 'Bad request.');
    }
    const p = body?.project;
    if (!p || typeof p !== 'object' || Array.isArray(p) || typeof p.schema !== 'number' || !Array.isArray(p.levels) || !p.levels.length || (p.id != null && typeof p.id !== 'string')) {
      throw new HttpError('BAD_PROJECT', 'That is not a Pocket Architect design.');
    }
    // The tracing underlay is an image kept in the browser. It is never stored online.
    if (p.site && typeof p.site === 'object') p.site.underlay = null;
    const text = JSON.stringify(p);
    const size = enc.encode(text).length;
    if (size > cap) throw tooLarge({ bytes: size });
    let email = null;
    if (typeof body.email === 'string' && body.email.trim()) {
      email = body.email.toLowerCase().trim();
      if (email.length > 254 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new HttpError('BAD_EMAIL', 'Enter a valid email or leave it blank.');
    }
    return { text, size, email, name: String(p.name || '').slice(0, 80) };
  }

  async function drop(id) {
    try {
      await files.delete(r2key(id));
    } catch {
      /* the row is the source of truth; an orphan file is harmless */
    }
    await store.deleteSharedProject(id);
  }

  async function sweep() { // occasional tidy of expired designs, a few at a time
    if (Math.random() >= 0.02) return;
    for (let i = 0; i < 10; i++) {
      const id = await store.firstExpiredSharedProject(iso()).catch(() => null);
      if (!id) break;
      await drop(id).catch(() => null);
    }
  }

  async function create(request) {
    await limit(request, 'projsave', config.projectSaveRateMax, 3600);
    const b = await readBody(request);
    const id = rand(15);
    const editKey = rand(24);
    const ip = clientIp(request);
    const at = iso();
    const exp = expiryFrom();
    await files.put(r2key(id), b.text, { httpMetadata: { contentType: 'application/json' } });
    try {
      await store.createSharedProject({
        id, editKeyHash: await sha(editKey), name: b.name, email: b.email, bytes: b.size, createdAt: at, updatedAt: at, expiresAt: exp,
        ipHash: ip && ip !== 'unknown' ? await sha(config.ipHashSalt + ip) : null,
      });
    } catch (e) {
      try {
        await files.delete(r2key(id));
      } catch {
        /* ignore */
      }
      throw e;
    }
    await sweep();
    return json({ id, editKey, url: shareUrl(id), expiresAt: exp, bytes: b.size }, 201);
  }

  async function read(request, id) {
    await limit(request, 'projget', config.projectReadRateMax, 3600);
    const row = await store.getSharedProject(id);
    if (!row) throw new HttpError('NOT_FOUND', 'That shared design was not found. The link may be wrong.');
    if (row.expiresAt <= iso()) {
      await drop(id).catch(() => null);
      throw new HttpError('EXPIRED', 'That shared link has expired.');
    }
    const obj = await files.get(r2key(id));
    if (!obj) throw new HttpError('NOT_FOUND', 'That shared design was not found.');
    const text = typeof obj.text === 'function' ? await obj.text() : String(obj.body ?? '');
    return json({ id, project: JSON.parse(text), name: row.name, createdAt: row.createdAt, updatedAt: row.updatedAt, expiresAt: row.expiresAt });
  }

  async function update(request, id) {
    await limit(request, 'projsave', config.projectSaveRateMax, 3600);
    const row = await store.getSharedProject(id);
    if (!row) throw new HttpError('NOT_FOUND', 'That shared design was not found.');
    const given = request.headers.get('x-edit-key') || '';
    if (!given || !same(await sha(given), row.editKeyHash)) throw new HttpError('BAD_EDIT_KEY', 'This browser does not have permission to change that design.');
    if (row.expiresAt <= iso()) {
      await drop(id).catch(() => null);
      throw new HttpError('EXPIRED', 'That shared link has expired. Save again to make a new link.');
    }
    const b = await readBody(request);
    await files.put(r2key(id), b.text, { httpMetadata: { contentType: 'application/json' } });
    const at = iso();
    const exp = expiryFrom();
    await store.updateSharedProject(id, { name: b.name, bytes: b.size, updatedAt: at, expiresAt: exp, email: b.email });
    return json({ id, url: shareUrl(id), updatedAt: at, expiresAt: exp, bytes: b.size });
  }

  return {
    available,
    async handle(request, path) {
      if (!available()) throw new HttpError('SHARING_UNAVAILABLE', 'Saving online is not available right now.');
      const id = path === '/projects' ? null : path.slice('/projects/'.length);
      if (id !== null && !SHARE_ID_RE.test(id)) throw new HttpError('NOT_FOUND', 'That shared design was not found.');
      if (id === null && request.method === 'POST') return create(request);
      if (id !== null && request.method === 'GET') return read(request, id);
      if (id !== null && request.method === 'PUT') return update(request, id);
      throw new HttpError('BAD_REQUEST', 'Not supported.', {}, 405);
    },
  };
}
