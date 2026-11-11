// Save and share, client side (no DOM, covered by tests/share.test.mjs). Same wire format and same storage as the live app
// (15/10/2026), so links and edit keys that are already out there keep working:
//   POST /api/projects            { project, email? }  -> { id, editKey, url, expiresAt }
//   GET  /api/projects/:id                              -> { id, project, updatedAt, expiresAt }
//   PUT  /api/projects/:id        header x-edit-key     -> { id, url, updatedAt, expiresAt }
// The link is <app page>?share=<id>. The edit key never leaves the browser that saved: it is kept in localStorage under
// "ps.share.<project id>" as { id, editKey, url, savedAt, expiresAt }. Whoever has the link can look; only the saver can update.

import { uid } from '../model/schema.js';

export class CloudError extends Error {
  constructor(code, message, { status = 0, details = {}, retryAfter = null } = {}) {
    super(message);
    this.name = 'CloudError';
    this.code = code;
    this.status = status;
    this.details = details;
    this.retryAfter = retryAfter;
  }
}

/** localStorage key that holds the edit rights for one project id (the live name). */
export const shareKey = (projectId) => `ps.share.${projectId}`;

const defaultStorage = () => {
  try {
    return globalThis.localStorage || null;
  } catch {
    return null;
  }
};

/** Edit rights this browser holds for a project: { id, editKey, url, savedAt, expiresAt } or null. */
export function readShare(projectId, storage = defaultStorage()) {
  try {
    const v = JSON.parse(storage?.getItem(shareKey(projectId)) || 'null');
    return v && typeof v.id === 'string' && typeof v.editKey === 'string' ? v : null;
  } catch {
    return null;
  }
}

export function writeShare(projectId, value, storage = defaultStorage()) {
  try {
    storage?.setItem(shareKey(projectId), JSON.stringify(value));
    return !!storage;
  } catch {
    return false;
  }
}

export function forgetShare(projectId, storage = defaultStorage()) {
  try {
    storage?.removeItem(shareKey(projectId));
  } catch {
    /* storage blocked */
  }
}

/** The tracing underlay is an image kept in the browser. It is never sent. */
export const forUpload = (project) => ({ ...project, site: { ...(project.site || {}), underlay: null } });

/** The shared design id in an address query string (the live link format, <page>?share=<id>), or null. */
export function shareIdFromSearch(search) {
  try {
    const id = new URLSearchParams(search || '').get('share');
    return id && id.trim() ? id.trim() : null;
  } catch {
    return null;
  }
}

/** HTTP client for /api/projects. fetchImpl is replaceable in tests. */
export function createCloud({ base = '/api', fetchImpl = null, timeoutMs = 30000 } = {}) {
  const root = String(base || '/api').replace(/\/+$/, '');
  async function call(method, path, { body, editKey } = {}) {
    const headers = { accept: 'application/json' };
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (editKey) headers['x-edit-key'] = editKey;
    const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = ctl ? setTimeout(() => ctl.abort(), timeoutMs) : null;
    let res;
    try {
      res = await (fetchImpl || globalThis.fetch).call(globalThis, root + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: ctl?.signal, cache: 'no-store' });
    } catch (e) {
      throw e?.name === 'AbortError' ? new CloudError('TIMEOUT', 'The server took too long to answer. Try again.') : new CloudError('NETWORK', 'Could not reach the server. Check your connection and try again.');
    } finally {
      if (timer) clearTimeout(timer);
    }
    let data = null;
    if ((res.headers?.get?.('content-type') || '').includes('json')) data = await res.json().catch(() => null);
    if (!res.ok) {
      if (!data?.error) throw new CloudError('SERVER_UNAVAILABLE', 'Saving online is not available right now.', { status: res.status });
      const { code, message, retryAfter, ...details } = data.error;
      throw new CloudError(code || 'ERROR', message || 'Something went wrong.', { status: res.status, details, retryAfter: retryAfter ?? null });
    }
    if (!data) throw new CloudError('SERVER_UNAVAILABLE', 'Saving online is not available right now.', { status: res.status });
    return data;
  }
  return {
    create: (project, { email } = {}) => call('POST', '/projects', { body: { project: forUpload(project), ...(email ? { email } : {}) } }),
    update: (id, editKey, project, { email } = {}) => call('PUT', `/projects/${encodeURIComponent(id)}`, { editKey, body: { project: forUpload(project), ...(email ? { email } : {}) } }),
    load: (id) => call('GET', `/projects/${encodeURIComponent(id)}`),
  };
}

/**
 * Save the design online. Updates the copy this browser owns (same link, extends the expiry); when that copy is gone or the key
 * is refused it makes a new one. Resolves { id, url, created, expiresAt, savedAt }.
 */
export async function saveShared(cloud, project, { email, storage = defaultStorage() } = {}) {
  const own = readShare(project.id, storage);
  if (own) {
    try {
      const out = await cloud.update(own.id, own.editKey, project, { email });
      const next = { ...own, url: out.url || own.url, savedAt: out.updatedAt, expiresAt: out.expiresAt };
      writeShare(project.id, next, storage);
      return { id: own.id, url: next.url, created: false, expiresAt: next.expiresAt, savedAt: next.savedAt };
    } catch (e) {
      if (!(e instanceof CloudError) || !['BAD_EDIT_KEY', 'EXPIRED', 'NOT_FOUND'].includes(e.code)) throw e;
      forgetShare(project.id, storage);
    }
  }
  const out = await cloud.create(project, { email });
  const saved = { id: out.id, editKey: out.editKey, url: out.url, savedAt: new Date().toISOString(), expiresAt: out.expiresAt };
  const kept = writeShare(project.id, saved, storage);
  return { id: out.id, url: out.url, created: true, expiresAt: out.expiresAt, savedAt: saved.savedAt, keyKept: kept };
}

/** A person's own copy of a shared design: new id, "(copy)" name, no link to the original. */
export function forkProject(project, { id, now = new Date() } = {}) {
  const copy = structuredClone(project);
  copy.id = id || uid('p');
  copy.name = `${String(project.name || 'Shared design').slice(0, 70)} (copy)`;
  copy.createdAt = copy.updatedAt = now.toISOString();
  if (copy.site) copy.site.underlay = null;
  return copy;
}

/** Plain words for a failed save. */
export function saveErrorMessage(err) {
  if (!(err instanceof CloudError)) return 'The design could not be saved online. Try again.';
  if (err.code === 'PROJECT_TOO_LARGE') return `This design is too large to save online${err.details?.maxBytes ? ` (the limit is ${Math.round(err.details.maxBytes / 1e6)} MB)` : ''}. Use Save to keep a file instead.`;
  if (err.code === 'RATE_LIMITED') {
    const min = err.retryAfter ? Math.max(1, Math.ceil(err.retryAfter / 60)) : null;
    return `That is a lot of saves from this connection. ${min ? `Try again in about ${min} ${min === 1 ? 'minute' : 'minutes'}.` : 'Try again in a little while.'}`;
  }
  if (err.code === 'SHARING_UNAVAILABLE' || err.code === 'SERVER_UNAVAILABLE') return 'Saving online is not available right now. Use Save to keep a file.';
  if (err.code === 'NETWORK') return 'You appear to be offline, or the server cannot be reached. Check your connection and try again. Use Save to keep a file in the meantime.';
  return err.message || 'The design could not be saved online. Try again.';
}

/** Plain words for a failed open of a shared link. */
export function loadErrorMessage(err) {
  if (err?.code === 'EXPIRED') return 'That shared link has expired.';
  if (err?.code === 'NOT_FOUND') return 'That shared design was not found. Check that the link was copied in full.';
  if (err?.code === 'RATE_LIMITED') return 'Too many people have opened shared links from this connection. Try again in a little while.';
  if (err?.code === 'NETWORK' || err?.code === 'TIMEOUT') return err.message;
  return err?.message || 'That shared design could not be opened.';
}

export const ddmmyyyyOf = (iso) => {
  const d = new Date(iso);
  if (Number.isNaN(+d)) return '';
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`;
};
