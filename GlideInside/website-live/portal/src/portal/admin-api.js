// Client for the owner's admin routes (/api/portal/admin/..., bearer ADMIN_TOKEN). Used only by the private page /portal/admin/.
// The token is held by the page for the session; nothing here stores it.

import { CONFIG } from '../config.js';
import { ApiError } from '../premium/api.js';

export function createAdminApi({ token, base = CONFIG.apiBase, fetchImpl = null } = {}) {
  const root = String(base || '/api').replace(/\/+$/, '');
  const doFetch = (...a) => (fetchImpl || globalThis.fetch).call(globalThis, ...a);
  async function call(method, path, body) {
    let res;
    try {
      res = await doFetch(`${root}/portal/admin${path}`, {
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
    resetAdmin: (id) => call('POST', `/orgs/${encodeURIComponent(id)}/reset-admin`, {}),
  };
}
