// Browser client for the free profile routes (server/lib/profiles.js). Plain fetch with the session cookie (gi_profile, Path=/api) and the
// CSRF header on every call. Every failure becomes a ProfileError with a stable `code`. No passwords are kept here: they are passed through
// to the request body and never stored, logged or returned.

import { CONFIG } from '../config.js';

export class ProfileError extends Error {
  constructor(code, message, { status = 0, details = {}, retryAfter = null } = {}) {
    super(message);
    this.name = 'ProfileError';
    this.code = code;
    this.status = status;
    this.details = details;
    this.retryAfter = retryAfter;
  }
}

export function createProfileApi({ base = CONFIG.apiBase, fetchImpl = null, timeoutMs = 30000 } = {}) {
  const root = String(base || '/api').replace(/\/+$/, '');
  async function call(method, path, { body, headers: extra } = {}) {
    const headers = { accept: 'application/json', 'x-gi-request': '1', ...(extra || {}) };
    if (body !== undefined) headers['content-type'] = 'application/json';
    const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = ctl ? setTimeout(() => ctl.abort(), timeoutMs) : null;
    let res;
    try {
      res = await (fetchImpl || globalThis.fetch).call(globalThis, `${root}/profile${path}`, {
        method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: ctl?.signal, credentials: 'same-origin', cache: 'no-store',
      });
    } catch (e) {
      throw e?.name === 'AbortError' ? new ProfileError('TIMEOUT', 'The server took too long to answer. Try again.') : new ProfileError('NETWORK', 'Could not reach the server. Check your connection and try again.');
    } finally {
      if (timer) clearTimeout(timer);
    }
    let data = null;
    if ((res.headers?.get?.('content-type') || '').includes('json')) data = await res.json().catch(() => null);
    if (!res.ok) {
      const e = data?.error && typeof data.error === 'object' ? data.error : data;
      if (!e?.code) throw new ProfileError('SERVER_UNAVAILABLE', 'Profiles are not available right now.', { status: res.status });
      const { code, message, retryAfter, ...details } = e;
      throw new ProfileError(code, message || 'Something went wrong.', { status: res.status, details, retryAfter: retryAfter ?? null });
    }
    if (!data) throw new ProfileError('SERVER_UNAVAILABLE', 'Profiles are not available right now.', { status: res.status });
    return data;
  }
  return {
    me: () => call('GET', '/me'),
    signUp: (form) => call('POST', '/signup', { body: form }),
    signIn: ({ email, password }) => call('POST', '/session', { body: { email, password } }),
    signOut: () => call('DELETE', '/session'),
    changePassword: ({ current, next }) => call('POST', '/password', { body: { current, next } }),
    setMarketing: (marketing) => call('PUT', '/preferences', { body: { marketing: !!marketing } }),
    deleteAccount: ({ password }) => call('DELETE', '', { body: { password } }),
    listDesigns: () => call('GET', '/designs'),
    saveDesign: (project, thumbnail) => call('POST', '/designs', { body: { project, ...(thumbnail ? { thumbnail } : {}) } }),
    updateDesign: (id, project, thumbnail) => call('PUT', `/designs/${encodeURIComponent(id)}`, { body: { project, ...(thumbnail ? { thumbnail } : {}) } }),
    getDesign: (id) => call('GET', `/designs/${encodeURIComponent(id)}`),
    renameDesign: (id, name) => call('PATCH', `/designs/${encodeURIComponent(id)}`, { body: { name } }),
    duplicateDesign: (id) => call('POST', `/designs/${encodeURIComponent(id)}/duplicate`, { body: {} }),
    deleteDesign: (id) => call('DELETE', `/designs/${encodeURIComponent(id)}`),
    /** Link the Plan Pack this browser holds for a design to the profile. `packToken` is the pack's own bearer token. */
    linkPack: (packToken) => call('POST', '/packs', { body: {}, headers: { authorization: `Bearer ${packToken}` } }),
  };
}
