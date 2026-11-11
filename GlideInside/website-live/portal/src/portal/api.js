// Portal client API. Every call the dashboard and Pocket Architect need (docs/PORTAL_API.md 3).
// CONFIG.portalMock = true uses the in-browser mock (mock-api.js). Otherwise the same calls go to {apiBase}/portal/... over fetch
// with the HttpOnly session cookie. Both resolve plain data and reject with ApiError (src/premium/api.js).

import { CONFIG } from '../config.js';
import { ApiError } from '../premium/api.js';
import { createMockApi } from './mock-api.js';

export const CALLS = [
  'signIn', 'signOut', 'me', 'changePassword', 'requestPasswordReset', 'completePasswordReset',
  'listHouses', 'getHouse', 'saveHouse', 'duplicateHouse', 'archiveHouse', 'listGlideLibrary', 'getGlideModel',
  'listClients', 'issueClientLogin', 'updateClient', 'resetClientPassword', 'disableClient', 'enableClient', 'deleteClient', 'exportClientProjects',
  'listProjects', 'openProject', 'saveProject',
  'monthUsage', 'listInvoices', 'getInvoice', 'getBillingContact', 'setBillingContact',
  'aiBalance', 'aiTopUp',
  'listTeam', 'inviteStaff', 'updateStaff', 'resetStaffPassword', 'disableStaff', 'enableStaff',
  'setBranding', 'setOrgSettings', 'enquiryJce',
];

// method, path (":id" filled from the first argument), body from the arguments.
const ROUTES = {
  signIn: ['POST', '/portal/session'],
  signOut: ['DELETE', '/portal/session'],
  me: ['GET', '/portal/me'],
  changePassword: ['POST', '/portal/password'],
  requestPasswordReset: ['POST', '/portal/password/reset-request'],
  completePasswordReset: ['POST', '/portal/password/reset'],
  listHouses: ['GET', '/portal/houses'],
  getHouse: ['GET', '/portal/houses/:id'],
  saveHouse: ['POST', '/portal/houses'],
  duplicateHouse: ['POST', '/portal/houses/:id/duplicate'],
  archiveHouse: ['POST', '/portal/houses/:id/archive'],
  listGlideLibrary: ['GET', '/portal/glide-library'],
  getGlideModel: ['GET', '/portal/glide-library/:id'],
  listClients: ['GET', '/portal/clients'],
  issueClientLogin: ['POST', '/portal/clients'],
  updateClient: ['PATCH', '/portal/clients/:id'],
  resetClientPassword: ['POST', '/portal/clients/:id/reset-password'],
  deleteClient: ['DELETE', '/portal/clients/:id'],
  exportClientProjects: ['GET', '/portal/clients/:id/export'],
  disableClient: ['POST', '/portal/clients/:id/disable'],
  enableClient: ['POST', '/portal/clients/:id/enable'],
  listProjects: ['GET', '/portal/projects'],
  openProject: ['GET', '/portal/projects/:id'],
  saveProject: ['POST', '/portal/projects'],
  monthUsage: ['GET', '/portal/billing/usage'],
  listInvoices: ['GET', '/portal/billing/invoices'],
  getInvoice: ['GET', '/portal/billing/invoices/:id'],
  getBillingContact: ['GET', '/portal/billing/contact'],
  setBillingContact: ['PUT', '/portal/billing/contact'],
  aiBalance: ['GET', '/portal/ai'],
  aiTopUp: ['POST', '/portal/ai/top-up'],
  listTeam: ['GET', '/portal/team'],
  inviteStaff: ['POST', '/portal/team'],
  updateStaff: ['PATCH', '/portal/team/:id'],
  resetStaffPassword: ['POST', '/portal/team/:id/reset-password'],
  disableStaff: ['POST', '/portal/team/:id/disable'],
  enableStaff: ['POST', '/portal/team/:id/enable'],
  setBranding: ['PUT', '/portal/org/branding'],
  setOrgSettings: ['PATCH', '/portal/org/settings'],
  enquiryJce: ['POST', '/enquiry/jce'],
};
const ID_CALLS = new Set(['getHouse', 'duplicateHouse', 'getGlideModel', 'updateClient', 'resetClientPassword', 'disableClient', 'enableClient', 'deleteClient', 'exportClientProjects', 'getInvoice', 'openProject', 'updateStaff', 'resetStaffPassword', 'disableStaff', 'enableStaff']);

/** Real HTTP implementation of the same calls. `me` resolves null on 401. `archiveHouse(id, archived)` sends { archived }. */
export function createHttpApi({ base = CONFIG.apiBase, fetchImpl = null } = {}) {
  const root = String(base || '/api').replace(/\/+$/, '');
  const doFetch = (...a) => (fetchImpl || globalThis.fetch).call(globalThis, ...a);
  async function call(name, args) {
    const [method, tpl] = ROUTES[name];
    let path = tpl;
    let rest = args;
    if (ID_CALLS.has(name)) {
      path = tpl.replace(':id', encodeURIComponent(args[0]));
      rest = args.slice(1);
    }
    let body;
    let query = '';
    if (name === 'archiveHouse') body = { archived: rest[0] !== false };
    else if (method === 'GET') query = rest[0] && typeof rest[0] === 'object' ? `?${new URLSearchParams(Object.entries(rest[0]).filter(([, v]) => v != null && v !== false))}` : '';
    else body = rest[0] ?? {};
    let res;
    try {
      res = await doFetch(`${root}${path}${query}`, { method, headers: { accept: 'application/json', ...(body !== undefined ? { 'content-type': 'application/json' } : {}) }, body: body === undefined ? undefined : JSON.stringify(body), credentials: 'same-origin', cache: 'no-store' });
    } catch {
      throw new ApiError('NETWORK', 'Could not reach the Glide Inside server. Check your connection and try again.');
    }
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      if (name === 'me' && res.status === 401) return null;
      const e = data?.error && typeof data.error === 'object' ? data.error : data || {};
      throw new ApiError(e.code || 'ERROR', e.message || 'Something went wrong.', { status: res.status, details: e });
    }
    return data;
  }
  return Object.fromEntries(CALLS.map((n) => [n, (...args) => call(n, args)]));
}

let shared = null;
/** The API the screens use: the mock when CONFIG.portalMock is true, otherwise HTTP. */
export function getPortalApi() {
  if (!shared) shared = CONFIG.portalMock ? createMockApi({ latency: typeof document !== 'undefined' ? 120 : 0 }) : createHttpApi();
  return shared;
}
export const portalApi = new Proxy({}, { get: (_, name) => (...args) => getPortalApi()[name](...args) });
