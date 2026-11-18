// Client for the owner's admin routes (/api/portal/admin/..., bearer ADMIN_TOKEN). Used only by the private page /portal/admin/.
// The token is held by the page for the session; nothing here stores it.

import { CONFIG } from '../config.js?v=20261119c';
import { ApiError } from '../premium/api.js?v=20261119c';

const contactQuery = (f) => {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(f || {})) if (v !== undefined && v !== null && String(v) !== '') q.set(k, String(v));
  const s = q.toString();
  return s ? `?${s}` : '';
};

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
    /** Every builder's client access requests (read only; the builder decides). */
    listClientRequests: () => call('GET', '/client-requests'),
    extendTrial: (id) => call('POST', `/orgs/${encodeURIComponent(id)}/extend-trial`, {}),
    convert: (id, note) => call('POST', `/orgs/${encodeURIComponent(id)}/convert`, { note }),
    /** Jobs charged to one org for a month (default this month), and the capped plan: setJobPlan(id, 'starter' | 'pro' | 'teams' | null). */
    orgJobs: (id, month) => call('GET', `/orgs/${encodeURIComponent(id)}/jobs${month ? `?month=${encodeURIComponent(month)}` : ''}`),
    setJobPlan: (id, plan) => call('POST', `/orgs/${encodeURIComponent(id)}/job-plan`, { plan }),
    setLoginRate: (id, cents) => call('POST', `/orgs/${encodeURIComponent(id)}/login-rate`, { cents }),
    setBrandColours: (id, colours) => call('POST', `/orgs/${encodeURIComponent(id)}/brand-colours`, { colours }),
    // Commercial mode (server/lib/commercial.js): the one shared trial login, and the actual AI usage and cost per account.
    commercialTrial: () => call('GET', '/trial', undefined, '/commercial/admin'),
    /** Create or reset the shared trial login. The owner types the username and password; the password is hashed on the server and never shown again. */
    saveCommercialTrial: ({ username, password, expiresAt }) => call('PUT', '/trial', { username, password, expiresAt: expiresAt || null }, '/commercial/admin'),
    commercialTrialSettings: (patch) => call('POST', '/trial/settings', patch, '/commercial/admin'),
    commercialUsage: () => call('GET', '/usage', undefined, '/commercial/admin'),
    /** Plan set terms: { currentVersion, versions: [{ version, count, firstAt, lastAt }] } (acceptances per version). */
    termsCounts: () => call('GET', '/admin/counts', undefined, '/terms'),
    /** Owner only: the internal test account. The owner types the username and password; the password is hashed on the server and never returned. */
    createInternal: ({ orgName, username, password }) => call('POST', '/internal-orgs', { orgName, username, password }),
    setInternal: (id, internal) => call('POST', `/orgs/${encodeURIComponent(id)}/internal`, { internal }),
    resetAdmin: (id) => call('POST', `/orgs/${encodeURIComponent(id)}/reset-admin`, {}),
    // Free profile contacts (server/lib/profiles.js). Filters: consent (yes|no), type, from, to (YYYY-MM-DD), designs (none|some), mode (residential|commercial|both), suburb, q.
    profileContacts: (filters = {}) => call('GET', `/contacts${contactQuery(filters)}`, undefined, '/profile/admin'),
    /** Owner only: flag a contact unsubscribed (removes their consent), or clear the flag. The export always leaves unsubscribed contacts out. */
    profileUnsubscribe: (id, unsubscribed) => call('POST', `/contacts/${encodeURIComponent(id)}/unsubscribe`, { unsubscribed: !!unsubscribed }, '/profile/admin'),
    /** CSV of contacts: scope 'marketing' is consenting contacts only, 'all' is every contact and is marked NOT FOR MARKETING. Resolves { text, filename, count }. */
    async profileCsv(scope, filters = {}) {
      let res;
      try {
        res = await doFetch(`${root}/profile/admin/contacts.csv${contactQuery({ ...filters, scope })}`, { headers: { authorization: `Bearer ${token}` }, cache: 'no-store' });
      } catch {
        throw new ApiError('NETWORK', 'Could not reach the Glide Inside server. Check your connection and try again.');
      }
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        const e = data?.error && typeof data.error === 'object' ? data.error : data || {};
        throw new ApiError(e.code || 'ERROR', e.message || 'Something went wrong.', { status: res.status, details: e });
      }
      const filename = /filename="?([^";]+)"?/.exec(res.headers.get('content-disposition') || '')?.[1] || `contacts-${scope}.csv`;
      return { text: await res.text(), filename, count: Number(res.headers.get('x-contact-count') || 0) };
    },
  };
}
