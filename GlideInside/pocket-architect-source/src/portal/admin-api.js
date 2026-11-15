// Client for the owner's admin routes (/api/portal/admin/..., bearer ADMIN_TOKEN). Used only by the private page /portal/admin/.
// The token is held by the page for the session; nothing here stores it.

import { CONFIG } from '../config.js';
import { ApiError } from '../premium/api.js';

export function createAdminApi({ token, base = CONFIG.apiBase, fetchImpl = null } = {}) {
  const root = String(base || '/api').replace(/\/+$/, '');
  const doFetch = (...a) => (fetchImpl || globalThis.fetch).call(globalThis, ...a);
  async function call(method, path, body, prefix = '/portal/admin') {
    let res;
    try {
      res = await doFetch(`${root}${prefix}${path}`, {
        method, headers: { accept: 'application/json', authorization: `Bearer ${token}`, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body), cache: 'no-store',
      });
    } catch {
      throw new ApiError('NETWORK', 'Could not reach the Glide Inside server. Check your connection and try again.');
    }
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      const e = data?.error && typeof data.error === 'object' ? data.error : data || {};
      throw new ApiError(e.code || 'ERROR', e.message || 'Something went wrong.', { status: res.status, details: e });
    }
    return data;
  }
  return {
    listRequests: (status) => call('GET', `/trial-requests${status ? `?status=${encodeURIComponent(status)}` : ''}`),
    approve: (id) => call('POST', `/trial-requests/${encodeURIComponent(id)}/approve`, {}),
    decline: (id, note) => call('POST', `/trial-requests/${encodeURIComponent(id)}/decline`, { note }),
    listOrgs: () => call('GET', '/orgs'),
    extendTrial: (id) => call('POST', `/orgs/${encodeURIComponent(id)}/extend-trial`, {}),
    convert: (id, note) => call('POST', `/orgs/${encodeURIComponent(id)}/convert`, { note }),
    setLoginRate: (id, cents) => call('POST', `/orgs/${encodeURIComponent(id)}/login-rate`, { cents }),
    setBrandColours: (id, colours) => call('POST', `/orgs/${encodeURIComponent(id)}/brand-colours`, { colours }),
    // Commercial mode (server/lib/commercial.js): the one shared trial login, and the actual AI usage and cost per account.
    commercialTrial: () => call('GET', '/trial', undefined, '/commercial/admin'),
    /** Create or reset the shared trial login. The owner types the username and password; the password is hashed on the server and never shown again. */
    saveCommercialTrial: ({ username, password, expiresAt }) => call('PUT', '/trial', { username, password, expiresAt: expiresAt || null }, '/commercial/admin'),
    commercialTrialSettings: (patch) => call('POST', '/trial/settings', patch, '/commercial/admin'),
    commercialUsage: () => call('GET', '/usage', undefined, '/commercial/admin'),
    resetAdmin: (id) => call('POST', `/orgs/${encodeURIComponent(id)}/reset-admin`, {}),
  };
}
