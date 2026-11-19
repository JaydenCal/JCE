// Engineering order requests from the export screen ("Order engineering", JCE Infrastructure). Saved for the owner and shown in the admin portal.
//   POST /api/order/engineering                         public: services, contact, the job (address, lot, design name, share link), consent
//   GET  /api/portal/admin/engineering-orders           owner token: the saved requests
//   POST /api/portal/admin/engineering-orders/:id/status  owner token: new, seen or closed
// Saving a request sends nothing: no email to the person and none to JCE. The owner reads the admin portal. The service list is
// src/premium/engineering-services.js (the one the order form shows).

import { HttpError, json, readJson, clientIp } from './http.js';
import { ENGINEERING_SERVICES } from '../../src/premium/engineering-services.js';

export const ORDER_CONSENT_TEXT = 'I agree to my details and the job being sent to JCE Infrastructure so they can contact me about this order';
export const ORDER_CONSENT_VERSION = '2026-11-19';
const B32 = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0, 1, I or O
const rid = () => { const b = crypto.getRandomValues(new Uint8Array(6)); return `EO-${[...b].map((x) => B32[x & 31]).join('')}`; }; // 30 bits, even characters
const clean = (v, name, max, required = false) => {
  if (v != null && typeof v !== 'string') throw new HttpError('BAD_REQUEST', `${name} must be text.`);
  const s = String(v || '').replace(/[\u0000-\u001f]/g, ' ').trim();
  if (required && !s) throw new HttpError('BAD_REQUEST', `${name} is required.`);
  if (s.length > max) throw new HttpError('BAD_REQUEST', `${name} is too long.`);
  return s;
};

export function createOrders({ lstore, portal, store, config, now = () => Date.now() }) {
  const iso = () => new Date(now()).toISOString();
  const IDS = new Set(ENGINEERING_SERVICES.map((s) => s.id));

  async function create(request) {
    // Same origin and the custom header only: another website cannot post here (a text/plain no-cors post carries neither).
    if (request.headers.get('x-gi-request') !== '1') throw new HttpError('FORBIDDEN', 'That request was blocked.');
    // Browsers always send Origin on a cross-site POST (and on a same-origin form post), so a post with none is not from the site: refused.
    const sent = request.headers.get('origin');
    if (!sent || (config.siteOrigin && sent !== config.siteOrigin)) throw new HttpError('FORBIDDEN', 'That request was blocked.');
    const b = await readJson(request, 12000);
    if (b.website) return json({ ok: true, reference: rid() }); // honeypot
    if ((await store.hitRate(`order:ip:${clientIp(request)}`, 3600, now())) > 6 || (await store.hitRate('order:all', 86400, now())) > 200) throw new HttpError('RATE_LIMITED', 'Too many requests. Please try again later.', { retryAfter: 3600 });
    if (b.consent !== true) throw new HttpError('BAD_REQUEST', 'Please tick the box to agree to your details being sent to JCE Infrastructure.');
    const services = [...new Set(Array.isArray(b.services) ? b.services.filter((x) => IDS.has(x)) : [])];
    if (!services.length) throw new HttpError('BAD_REQUEST', 'Choose at least one service.');
    const name = clean(b.name, 'Your name', 100, true);
    const email = clean(b.email, 'Your email', 200, true).toLowerCase();
    if (!/^[^\s@]{1,64}@[^\s@]+\.[^\s@]{2,}$/.test(email)) throw new HttpError('BAD_REQUEST', 'Enter a valid email address.');
    const phone = clean(b.phone, 'Your phone number', 30);
    if (phone && !/^[0-9 +()\-]{6,30}$/.test(phone)) throw new HttpError('BAD_REQUEST', 'Enter a valid phone number, or leave it blank.');
    // A share link must point at this site (a link to anywhere else is dropped, so the admin list never carries a stranger's link).
    let designLink = '';
    if (b.designLink) {
      try { const u = new URL(String(b.designLink)); if (u.protocol === 'https:' && config.siteOrigin && u.origin === config.siteOrigin && u.href.length <= 400) designLink = u.href; } catch { /* not a link */ }
    }
    let orgId = null; let orgName = '';
    try { const { org } = await portal.session(request, new URL(request.url), {}); orgId = org.id; orgName = org.displayName || org.name; } catch { /* a visitor with no login */ }
    const order = { id: rid(), createdAt: iso(), orgId, orgName, services, name, email, phone, address: clean(b.address, 'The address', 200), lotLabel: clean(b.lotLabel, 'The lot', 100), designName: clean(b.designName, 'The design', 120), designLink, notes: clean(b.notes, 'The notes', 1000), consentAt: iso(), consentText: ORDER_CONSENT_TEXT, consentVersion: ORDER_CONSENT_VERSION, status: 'new' };
    for (let i = 0; ; i += 1) { // a reference that is already taken is rare; try a fresh one
      try { await lstore.insertOrder(order); break; } catch (e) { if (i >= 3 || !/unique|constraint|primary/i.test(String(e?.message))) throw e; order.id = rid(); }
    }
    return json({ ok: true, reference: order.id });
  }
  const view = (o) => ({ ...o, serviceLabels: o.services.map((id) => ENGINEERING_SERVICES.find((s) => s.id === id)?.label || id) });
  async function list(request) {
    await portal.adminAuth(request);
    return json({ orders: (await lstore.listOrders()).map(view) });
  }
  async function setStatus(request, id) {
    await portal.adminAuth(request);
    const b = await readJson(request, 500).catch(() => ({}));
    if (!['new', 'seen', 'closed'].includes(b.status)) throw new HttpError('BAD_REQUEST', 'Status must be new, seen or closed.');
    if (!(await lstore.updateOrderStatus(id, b.status))) throw new HttpError('NOT_FOUND', 'That order was not found.');
    return json({ ok: true });
  }
  async function remove(request, id) {
    await portal.adminAuth(request);
    if (!(await lstore.deleteOrder(id))) throw new HttpError('NOT_FOUND', 'That order was not found.');
    return json({ ok: true });
  }
  async function route(request, url, path) {
    const del = /^\/portal\/admin\/engineering-orders\/([A-Za-z0-9-]{1,20})$/.exec(path);
    if (del) { if (request.method !== 'DELETE') throw new HttpError('BAD_REQUEST', 'Use DELETE for this endpoint.', {}, 405); return remove(request, del[1]); }
    if (path === '/order/engineering') { if (request.method !== 'POST') throw new HttpError('BAD_REQUEST', 'Use POST for this endpoint.', {}, 405); return create(request); }
    if (path === '/portal/admin/engineering-orders') { if (request.method !== 'GET') throw new HttpError('BAD_REQUEST', 'Use GET for this endpoint.', {}, 405); return list(request); }
    const m = /^\/portal\/admin\/engineering-orders\/([A-Za-z0-9-]{1,20})\/status$/.exec(path);
    if (m) { if (request.method !== 'POST') throw new HttpError('BAD_REQUEST', 'Use POST for this endpoint.', {}, 405); return setStatus(request, m[1]); }
    return null;
  }
  return { route };
}
