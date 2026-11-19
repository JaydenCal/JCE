// "See it on your block" website widget, the builder lead inbox and webhook (migration 0025, docs/WIDGET_LEADS.md).
//
// Public (no login; for the widget on a builder's own website, which is the Glide Inside app in an iframe):
//   GET  /api/widget/:id/config?host=<website origin>    builder branding, consent wording and the designs on offer (no design files)
//   GET  /api/widget/:id/designs?host=...                the designs themselves, for the lot card
//   POST /api/widget/:id/lead                            a visitor's name, email, optional phone, consent, block and chosen design
// Builder portal (signed in with the portal cookie, CSRF header on writes):
//   GET/PUT /api/portal/widget                           switch, allowed website origins, designs offered
//   GET /api/portal/leads, GET /api/portal/leads/export  inbox and CSV
//   PATCH/DELETE /api/portal/leads/:id                   status, note, delete
//   GET/PUT/DELETE /api/portal/webhook, POST .../rotate-secret, .../test, .../deliveries/:id/retry
//   GET/PUT/DELETE /api/portal/site-costs                the builder's default site cost rates
// Nothing here sends email. A new lead is shown in the portal inbox and, if the builder set a webhook, POSTed to it as signed JSON.
// :id is the builder's slug (or the organisation id when the builder has no slug).

import { HttpError, json, readJson, clientIp } from './http.js';
import { cleanSlug } from '../../src/portal/builders.js';

export const LEAD_CONSENT_VERSION = '2026-11-19';
export const consentTextFor = (name) => `I agree to ${name || 'this builder'} contacting me about this design and my block, using the details I have entered.`;
export const WEBHOOK_MAX_ATTEMPTS = 5;
const RETRY_DELAYS_MS = [60e3, 5 * 60e3, 30 * 60e3, 2 * 3600e3]; // after attempt 1, 2, 3, 4
const rid = (p) => `${p}_${[...crypto.getRandomValues(new Uint8Array(8))].map((x) => x.toString(16).padStart(2, '0')).join('')}`;
const emailOk = (e) => /^[^\s@]{1,64}@[^\s@]+\.[^\s@]{2,}$/.test(e) && e.length <= 200;
const str = (v, name, max, { required = false } = {}) => {
  if (v != null && typeof v !== 'string') throw new HttpError('BAD_REQUEST', `${name} must be text.`);
  const s = String(v || '').replace(/[\u0000-\u001f]/g, ' ').trim();
  if (required && !s) throw new HttpError('BAD_REQUEST', `${name} is required.`);
  if (s.length > max) throw new HttpError('BAD_REQUEST', `${name} is too long.`);
  return s;
};

/** A website origin from a URL typed by a builder or sent as ?host=. https only (http only for localhost in development is NOT allowed). */
export function cleanOrigin(v) {
  try {
    const u = new URL(String(v || '').trim());
    if (u.protocol !== 'https:' || u.username || u.password) return null;
    return u.origin;
  } catch { return null; }
}
const bare = (origin) => origin.replace(/^https:\/\/(www\.)?/, '');
/** The website (host origin) may show the widget: it is on the builder's list, or it is the Glide Inside site itself (preview). www and the bare name count as the same. */
export function originAllowed(list, host, siteOrigin) {
  const o = cleanOrigin(host);
  if (!o) return false;
  if (siteOrigin && o === siteOrigin) return true;
  return (list || []).some((a) => a === o || bare(a) === bare(o));
}

export const LEAD_RETENTION_MONTHS = 24;
export const DELIVERY_RETENTION_DAYS = 90;
export const CRON_DELIVERY_CAP = 25;
// Wildcard DNS services whose names resolve to whatever address is written in them (127.0.0.1.nip.io): a way round the IP address rule.
const REBINDING = /(^|\.)(nip\.io|sslip\.io|localtest\.me|lvh\.me|xip\.io|traefik\.me|workers\.dev)$/;

/** A webhook URL must be https on a public host name (no IP address, localhost or internal names), the standard port, and not this site.
 *  Workers cannot reach private address ranges at all (the platform refuses), which is the backstop if a public name resolves inwards. */
export function webhookUrlProblem(v, siteOrigin = '') {
  let u;
  try { u = new URL(String(v || '').trim()); } catch { return 'Enter the full address, starting with https://.'; }
  if (u.protocol !== 'https:') return 'The webhook address must start with https://.';
  if (u.username || u.password) return 'Leave the user name and password out of the address.';
  if (u.port && u.port !== '443') return 'Use the standard https port.';
  const host = u.hostname.toLowerCase().replace(/\.+$/, ''); // "localhost." is the same name as "localhost"
  try { if (siteOrigin && host === new URL(siteOrigin).hostname.toLowerCase().replace(/\.+$/, '')) return 'The webhook cannot point at Glide Inside itself.'; } catch { /* no site origin */ }
  if (!host.includes('.') || /^[\d.]+$/.test(host) || /^0x[0-9a-f]+/.test(host) || /\d+\.\d+\.\d+\.\d+/.test(host) || host.includes(':') || host.startsWith('[') || /(^|\.)(localhost|local|internal|lan|home|corp|intranet|test|invalid|example)$/.test(host)) return 'Use a public web address, not an IP address or a local name.';
  if (REBINDING.test(host)) return 'Use your own web address or your automation service address, not a wildcard name service.';
  if (String(v).length > 500) return 'That address is too long.';
  return null;
}

async function hmacHex(secret, data) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return [...new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data)))].map((x) => x.toString(16).padStart(2, '0')).join('');
}
export const signWebhook = (secret, ts, body) => hmacHex(secret, `${ts}.${body}`);
const newSecret = () => `whsec_${[...crypto.getRandomValues(new Uint8Array(24))].map((x) => x.toString(16).padStart(2, '0')).join('')}`;

const csvCell = (v) => {
  let s = String(v ?? '');
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; // a spreadsheet must never read a cell as a formula
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const ddmmyyyy = (iso) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? '' : `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${d.getUTCFullYear()}`; };
export const LEAD_CSV_HEADER = ['Date', 'Name', 'Email', 'Phone', 'Block address', 'Lot', 'Design', 'Website', 'Status', 'Note', 'Consent given', 'Reference'];
export const leadsToCsv = (leads) => `${[LEAD_CSV_HEADER, ...leads.map((l) => [ddmmyyyy(l.createdAt), l.name, l.email, l.phone, l.address, l.lotLabel, l.houseName, l.hostOrigin, l.status, l.note, ddmmyyyy(l.consentAt), l.id])].map((r) => r.map(csvCell).join(',')).join('\r\n')}\r\n`;

export function createLeads({ lstore, pstore, portal, store, config, fetchImpl, now = () => Date.now() }) {
  const siteHost = (() => { try { return new URL(config.siteOrigin).origin; } catch { return ''; } })();
  const iso = (ms = now()) => new Date(ms).toISOString();
  const leadView = (l) => ({ id: l.id, createdAt: l.createdAt, source: l.source, name: l.name, email: l.email, phone: l.phone, address: l.address, lotLabel: l.lotLabel, houseId: l.houseId, houseName: l.houseName, hostOrigin: l.hostOrigin, status: l.status, note: l.note, consentAt: l.consentAt });

  async function orgOfWidget(id) {
    const clean = cleanSlug(String(id || '').toLowerCase());
    const org = (clean && (await pstore.getOrgBySlug(clean))) || (/^org_[a-z0-9]+$/.test(String(id || '')) ? await pstore.getOrg(id) : null);
    if (!org) throw new HttpError('NOT_FOUND', 'That builder is not on Glide Inside.');
    return org;
  }
  async function widgetFor(request, url, id, host) {
    if ((await store.hitRate(`widget:cfg:${clientIp(request)}`, 600, now())) > 240) throw new HttpError('RATE_LIMITED', 'Too many requests. Please wait a moment.', { retryAfter: 600 });
    const org = await orgOfWidget(id);
    const w = await lstore.getWidget(org.id);
    if (!w?.enabled) throw new HttpError('NOT_FOUND', 'This builder has not switched the website widget on.');
    if (!originAllowed(w.origins, host || url.searchParams.get('host'), config.siteOrigin)) throw new HttpError('FORBIDDEN', 'This website is not on the builder\'s list of websites that may show the widget.', { code: 'ORIGIN_NOT_ALLOWED' });
    return { org, w };
  }
  const offered = async (org, w) => (await pstore.listHouses(org.id)).filter((h) => !h.archived && h.sourceType !== 'glide' && (!w.houseIds.length || w.houseIds.includes(h.id))).slice(0, 24);

  // Public ---------------------------------------------------------------------------------------------------------------------
  async function widgetConfig(request, url, id) {
    const { org, w } = await widgetFor(request, url, id);
    const list = await offered(org, w);
    const brand = portal.brandOf(org);
    const res = json({ id: org.slug || org.id, name: brand.displayName, logoDataUrl: brand.logoDataUrl, colours: brand.colours, details: { phone: brand.details?.phone || '', email: brand.details?.email || '', website: brand.details?.website || '' },
      consentText: consentTextFor(brand.displayName), consentVersion: LEAD_CONSENT_VERSION, designs: list.map((h) => ({ id: h.id, name: h.name, thumbnail: h.thumbnail || null })) });
    res.headers.set('cache-control', 'no-store');
    return res;
  }
  async function widgetDesigns(request, url, id) {
    const { org, w } = await widgetFor(request, url, id);
    const out = [];
    for (const h of await offered(org, w)) { const full = await pstore.getHouse(org.id, h.id); if (full?.project) { const p = JSON.parse(JSON.stringify(full.project)); p.name = full.name; out.push({ id: full.id, name: full.name, project: p }); } }
    const res = json({ designs: out });
    res.headers.set('cache-control', 'no-store');
    return res;
  }
  async function widgetLead(request, url, id, ctx) {
    if (request.method !== 'POST') throw new HttpError('BAD_REQUEST', 'Use POST for this endpoint.', {}, 405);
    if (request.headers.get('x-gi-request') !== '1') throw new HttpError('FORBIDDEN', 'That request was blocked.'); // the custom header forces a CORS check, so another website cannot post here
    // The widget is the Glide Inside app in an iframe, so its posts come from this site's own origin. Another site cannot post here.
    const sent = request.headers.get('origin');
    if (siteHost && sent !== siteHost) throw new HttpError('FORBIDDEN', 'That request was blocked.');
    const b = await readJson(request, 8000);
    const { org, w } = await widgetFor(request, url, id, b.host);
    if ((await store.hitRate(`widget:lead:ip:${clientIp(request)}`, 3600, now())) > 10 || (await store.hitRate(`widget:lead:org:${org.id}`, 86400, now())) > 300) throw new HttpError('RATE_LIMITED', 'Too many requests. Please try again later.', { retryAfter: 3600 });
    if (b.website) return json({ ok: true, reference: rid('lead') }); // honeypot: a bot filled the hidden field, say nothing
    if (b.consent !== true) throw new HttpError('BAD_REQUEST', 'Please tick the box to agree to the builder contacting you.');
    const name = str(b.name, 'Your name', 100, { required: true });
    const email = str(b.email, 'Your email', 200, { required: true }).toLowerCase();
    if (!emailOk(email)) throw new HttpError('BAD_REQUEST', 'Enter a valid email address.');
    const phone = str(b.phone, 'Your phone number', 30);
    if (phone && !/^[0-9 +()\-]{6,30}$/.test(phone)) throw new HttpError('BAD_REQUEST', 'Enter a valid phone number, or leave it blank.');
    const address = str(b.address, 'The address', 200);
    const lotLabel = str(b.lotLabel, 'The lot', 100);
    let house = null;
    if (b.designId != null && b.designId !== '') {
      const did = str(b.designId, 'The design', 120);
      if (!(await offered(org, w)).some((x) => x.id === did)) throw new HttpError('BAD_REQUEST', 'That design is not on offer.');
      house = await pstore.getHouse(org.id, did);
      if (!house || house.archived) throw new HttpError('BAD_REQUEST', 'That design is not on offer.');
    }
    const houseId = house?.id || '';
    const dup = await lstore.findRecentLead(org.id, email, houseId, iso(now() - 10 * 60e3));
    if (dup) return json({ ok: true, reference: dup.id, duplicate: true }); // a double press: one lead, and the visitor gets that lead's reference
    const brand = portal.brandOf(org);
    const lead = { id: rid('lead'), orgId: org.id, createdAt: iso(), source: 'widget', name, email, phone, address, lotLabel, houseId, houseName: house?.name || '', hostOrigin: cleanOrigin(b.host) || '', consentAt: iso(), consentText: consentTextFor(brand.displayName), consentVersion: LEAD_CONSENT_VERSION, status: 'new', note: '' };
    await lstore.insertLead(lead);
    await background(ctx, queueWebhook(org, lead));
    return json({ ok: true, reference: lead.id });
  }

  // Webhook delivery -----------------------------------------------------------------------------------------------------------
  const payloadFor = (org, lead, event = 'lead.created') => ({ event, id: lead.id, createdAt: lead.createdAt, builder: { id: org.slug || org.id, name: portal.brandOf(org).displayName },
    lead: { name: lead.name, email: lead.email, phone: lead.phone, address: lead.address, lot: lead.lotLabel, design: { id: lead.houseId, name: lead.houseName }, website: lead.hostOrigin, source: lead.source, consentAt: lead.consentAt, consentVersion: lead.consentVersion || '', consentText: lead.consentText } });

  /** Run a delivery after the visitor's response has gone (Workers: ctx.waitUntil). Without a ctx (tests, other platforms) it is awaited. */
  async function background(ctx, promise) {
    const safe = promise.catch((e) => console.error(JSON.stringify({ event: 'webhook_queue_failed', message: e?.message })));
    if (ctx?.waitUntil) { ctx.waitUntil(safe); return; }
    await safe;
  }

  /** One attempt. Records the outcome on the delivery row (unless it is a test) and returns { ok, status, error }. */
  async function attempt(org, hook, delivery, payload, { timeoutMs = 4000 } = {}) {
    const body = JSON.stringify(payload);
    const ts = Math.floor(now() / 1000);
    let ok = false; let status = null; let error = '';
    const problem = webhookUrlProblem(hook.url, config.siteOrigin); // checked again on every attempt: the rules may have been tightened since the address was saved
    if (problem) error = problem;
    else {
      try {
        const res = await fetchImpl(hook.url, { method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(timeoutMs), headers: { 'content-type': 'application/json', 'user-agent': 'GlideInside-Webhook/1', 'x-glideinside-event': payload.event, 'x-glideinside-delivery': delivery?.id || 'test', 'x-glideinside-signature': `t=${ts},v1=${await signWebhook(hook.secret, ts, body)}` }, body });
        status = res.status;
        ok = res.status >= 200 && res.status < 300;
        if (!ok) error = `The address answered HTTP ${res.status}.`;
      } catch (e) { error = e?.name === 'TimeoutError' ? 'The address did not answer in time.' : 'The address could not be reached.'; }
    }
    if (delivery) {
      const n = delivery.attempts + 1;
      const done = ok || n >= WEBHOOK_MAX_ATTEMPTS || !!problem;
      await lstore.updateDelivery(delivery.id, { attempts: n, status: ok ? 'delivered' : done ? 'failed' : 'pending', lastStatus: status, lastError: ok ? '' : error, lastAttemptAt: iso(), nextAttemptAt: done ? null : iso(now() + RETRY_DELAYS_MS[Math.min(n - 1, RETRY_DELAYS_MS.length - 1)]) });
    }
    return { ok, status, error };
  }
  async function queueWebhook(org, lead) {
    const hook = await lstore.getWebhook(org.id);
    if (!hook?.enabled) return;
    const delivery = { id: rid('dlv'), orgId: org.id, leadId: lead.id, createdAt: iso(), attempts: 0, status: 'pending', nextAttemptAt: iso() };
    await lstore.insertDelivery(delivery);
    await attempt(org, hook, delivery, payloadFor(org, lead));
  }
  /** The Worker cron: retry due deliveries for every builder, oldest first, at most CRON_DELIVERY_CAP in total so one run stays short. */
  async function retryAllDue() {
    let n = 0;
    const orgs = new Map();
    for (const d of await lstore.listDueDeliveriesAll(iso(), CRON_DELIVERY_CAP)) {
      if (!orgs.has(d.orgId)) { const org = await pstore.getOrg(d.orgId); orgs.set(d.orgId, org ? { org, hook: await lstore.getWebhook(d.orgId) } : null); }
      const ctxOrg = orgs.get(d.orgId);
      if (!ctxOrg) { await lstore.updateDelivery(d.id, { ...d, status: 'failed', lastError: 'The builder no longer exists.', nextAttemptAt: null }); continue; }
      if (!ctxOrg.hook?.enabled) { await lstore.updateDelivery(d.id, { ...d, status: 'failed', lastError: 'The webhook is off or was removed.', nextAttemptAt: null }); continue; }
      const lead = await lstore.getLead(d.orgId, d.leadId);
      if (!lead) { await lstore.updateDelivery(d.id, { ...d, status: 'failed', lastError: 'The lead was deleted.', nextAttemptAt: null }); continue; }
      await attempt(ctxOrg.org, ctxOrg.hook, d, payloadFor(ctxOrg.org, lead));
      n += 1;
    }
    return n;
  }
  /** Retention: delivery logs after 90 days, leads (with their deliveries) after 24 months. Run by the cron. */
  async function purgeOld() {
    const d = new Date(now());
    const leadsBefore = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - LEAD_RETENTION_MONTHS, d.getUTCDate())).toISOString();
    const deliveriesBefore = new Date(now() - DELIVERY_RETENTION_DAYS * 86400e3).toISOString();
    return lstore.purgeOld({ leadsBefore, deliveriesBefore, ordersBefore: leadsBefore });
  }

  // Portal ---------------------------------------------------------------------------------------------------------------------
  const staff = async (r, need, write = false) => { const a = await portal.session(r.request, r.url, { need, write }); if (a.setCookie) r.setCookie = a.setCookie; return a; }; // keeps the sliding session cookie refresh
  const snippetId = (org) => org.slug || org.id;

  async function getWidget(r) {
    const { org } = await staff(r, 'clients.read');
    const w = (await lstore.getWidget(org.id)) || { enabled: false, origins: [], houseIds: [] };
    const houses = (await pstore.listHouses(org.id)).filter((h) => !h.archived && h.sourceType !== 'glide');
    return json({ id: snippetId(org), enabled: w.enabled, origins: w.origins, houseIds: w.houseIds, houses: houses.map((h) => ({ id: h.id, name: h.name })), consentText: consentTextFor(portal.brandOf(org).displayName), leadCount: await lstore.countLeads(org.id) });
  }
  async function putWidget(r) {
    const { org } = await staff(r, 'branding.write', true);
    const b = await readJson(r.request, 8000);
    const origins = [];
    for (const raw of Array.isArray(b.origins) ? b.origins.slice(0, 10) : []) {
      if (!String(raw || '').trim()) continue;
      const o = cleanOrigin(String(raw).trim().replace(/^(?!https?:\/\/)/i, 'https://'));
      if (!o) throw new HttpError('BAD_REQUEST', `"${String(raw).slice(0, 80)}" is not a website address. Use the form https://www.example.com.au.`);
      if (!origins.includes(o)) origins.push(o);
    }
    const mine = new Set((await pstore.listHouses(org.id)).map((h) => h.id));
    const houseIds = (Array.isArray(b.houseIds) ? b.houseIds : []).filter((x) => mine.has(x)).slice(0, 24);
    await lstore.putWidget(org.id, { enabled: b.enabled === true, origins, houseIds }, iso());
    return getWidget(r);
  }

  async function listLeads(r) {
    const { org } = await staff(r, 'clients.read');
    const leads = await lstore.listLeads(org.id);
    return json({ leads: leads.map(leadView), total: await lstore.countLeads(org.id), newCount: leads.filter((l) => l.status === 'new').length });
  }
  async function exportLeads(r) {
    const { org } = await staff(r, 'clients.write'); // the full list with email and phone: the builder admin, not a designer
    const csv = leadsToCsv(await lstore.listLeads(org.id, { limit: 5000 }));
    return new Response(csv, { headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="leads-${iso().slice(0, 10)}.csv"`, 'cache-control': 'no-store' } });
  }
  async function patchLead(r, id) {
    const { org } = await staff(r, 'clients.write', true);
    const b = await readJson(r.request, 4000);
    const patch = {};
    if (b.status !== undefined) { if (!['new', 'contacted', 'closed'].includes(b.status)) throw new HttpError('BAD_REQUEST', 'Status must be new, contacted or closed.'); patch.status = b.status; }
    if (b.note !== undefined) patch.note = str(b.note, 'The note', 1000);
    if (!(await lstore.updateLead(org.id, id, patch))) throw new HttpError('NOT_FOUND', 'That lead was not found.');
    return json(leadView(await lstore.getLead(org.id, id)));
  }
  async function deleteLead(r, id) {
    const { org } = await staff(r, 'clients.write', true);
    if (!(await lstore.deleteLead(org.id, id))) throw new HttpError('NOT_FOUND', 'That lead was not found.');
    return json({ ok: true });
  }

  const hookView = async (org) => {
    const h = await lstore.getWebhook(org.id);
    // The signing secret is never sent with the settings: only its first characters, to tell secrets apart. It is returned in full by rotate, by the first save and by reveal-secret.
    return { configured: !!h, url: h?.url || '', enabled: !!h?.enabled, secretHint: h?.secret ? `${h.secret.slice(0, 10)}...` : '', deliveries: (await lstore.listDeliveries(org.id, 20)).map((d) => ({ id: d.id, leadId: d.leadId, createdAt: d.createdAt, attempts: d.attempts, status: d.status, lastStatus: d.lastStatus, lastError: d.lastError, nextAttemptAt: d.nextAttemptAt })), maxAttempts: WEBHOOK_MAX_ATTEMPTS };
  };
  async function getWebhook(r) {
    const { org } = await staff(r, 'branding.write');
    return json(await hookView(org));
  }
  async function putWebhook(r) {
    const { org } = await staff(r, 'branding.write', true);
    const b = await readJson(r.request, 2000);
    const problem = webhookUrlProblem(b.url, config.siteOrigin);
    if (problem) throw new HttpError('BAD_REQUEST', problem);
    const cur = await lstore.getWebhook(org.id);
    await lstore.putWebhook(org.id, { url: String(b.url).trim(), secret: cur?.secret || newSecret(), enabled: b.enabled !== false }, iso());
    const view = await hookView(org);
    return json(cur ? view : { ...view, secret: (await lstore.getWebhook(org.id)).secret }); // the first save shows the secret once
  }
  async function revealSecret(r) {
    const { org } = await staff(r, 'branding.write', true);
    if ((await store.hitRate(`webhook:reveal:${org.id}`, 600, now())) > 20) throw new HttpError('RATE_LIMITED', 'Too many requests. Wait a few minutes.', { retryAfter: 600 });
    const cur = await lstore.getWebhook(org.id);
    if (!cur) throw new HttpError('BAD_REQUEST', 'Save a webhook address first.');
    const res = json({ secret: cur.secret });
    res.headers.set('cache-control', 'no-store');
    return res;
  }
  async function rotateSecret(r) {
    const { org } = await staff(r, 'branding.write', true);
    const cur = await lstore.getWebhook(org.id);
    if (!cur) throw new HttpError('BAD_REQUEST', 'Save a webhook address first.');
    await lstore.putWebhook(org.id, { ...cur, secret: newSecret() }, iso());
    return json({ ...(await hookView(org)), secret: (await lstore.getWebhook(org.id)).secret });
  }
  async function removeWebhook(r) {
    const { org } = await staff(r, 'branding.write', true);
    await lstore.deleteWebhook(org.id);
    return json(await hookView(org));
  }
  async function testWebhook(r) {
    const { org } = await staff(r, 'branding.write', true);
    if ((await store.hitRate(`webhook:test:${org.id}`, 600, now())) > 10) throw new HttpError('RATE_LIMITED', 'Too many tests. Wait a few minutes.', { retryAfter: 600 });
    const hook = await lstore.getWebhook(org.id);
    if (!hook) throw new HttpError('BAD_REQUEST', 'Save a webhook address first.');
    const sample = { id: 'lead_test', createdAt: iso(), source: 'test', name: 'Sample Person', email: 'sample@example.com', phone: '', address: '1 Example Street, Sampletown NSW', lotLabel: 'Lot 1 DP 000000', houseId: '', houseName: 'Sample design', hostOrigin: '', consentAt: iso(), consentText: consentTextFor(portal.brandOf(org).displayName) };
    const out = await attempt(org, hook, null, payloadFor(org, sample, 'lead.test'), { timeoutMs: 8000 });
    return json({ ok: out.ok, status: out.status, error: out.error });
  }
  async function retryDelivery(r, id) {
    const { org } = await staff(r, 'branding.write', true);
    if ((await store.hitRate(`webhook:test:${org.id}`, 600, now())) > 10) throw new HttpError('RATE_LIMITED', 'Too many tries. Wait a few minutes.', { retryAfter: 600 });
    const d = await lstore.getDelivery(org.id, id);
    const hook = await lstore.getWebhook(org.id);
    if (!d || !hook) throw new HttpError('NOT_FOUND', 'That delivery was not found.');
    const lead = await lstore.getLead(org.id, d.leadId);
    if (!lead) throw new HttpError('NOT_FOUND', 'The lead for that delivery was deleted.');
    await attempt(org, hook, { ...d, attempts: Math.min(d.attempts, WEBHOOK_MAX_ATTEMPTS - 1) }, payloadFor(org, lead), { timeoutMs: 8000 });
    return json(await hookView(org));
  }

  // The builder's default site cost rates (the Site costs panel). Any staff login reads them; the builder admin sets them.
  async function getCosts(r) {
    const { user, org } = await staff(r, null);
    if (user.role === 'client') throw new HttpError('FORBIDDEN', 'Your role does not allow that.');
    return json({ settings: await lstore.getSiteCostDefaults(org.id) });
  }
  async function putCosts(r) {
    const { org } = await staff(r, 'branding.write', true);
    const b = await readJson(r.request, 20000);
    const s = b.settings;
    if (!s || typeof s !== 'object' || (s.region && !['auto', 'nsw', 'qld'].includes(s.region))) throw new HttpError('BAD_REQUEST', 'Those rates could not be read.');
    const rates = {};
    for (const [k, v] of Object.entries(s.rates || {})) {
      if (!/^[a-z_]{2,40}$/.test(k) || !v || typeof v !== 'object') continue;
      for (const reg of ['nsw', 'qld']) if (Number.isFinite(v[reg]) && v[reg] >= 0 && v[reg] < 1e7) (rates[k] ||= {})[reg] = v[reg];
    }
    const clean = { region: s.region || 'auto', rates, rock: { enabled: s.rock?.enabled === true, fractionOfCut: Number.isFinite(s.rock?.fractionOfCut) ? Math.min(1, Math.max(0, s.rock.fractionOfCut)) : 0.3 } };
    await lstore.putSiteCostDefaults(org.id, clean, iso());
    return json({ settings: clean });
  }
  async function deleteCosts(r) {
    const { org } = await staff(r, 'branding.write', true);
    await lstore.deleteSiteCostDefaults(org.id);
    return json({ settings: null });
  }

  const P = '([A-Za-z0-9_:.%-]{1,120})';
  const ROUTES = [
    ['GET', `/widget/${P}/config`, widgetConfig, 'public'], ['GET', `/widget/${P}/designs`, widgetDesigns, 'public'], ['POST', `/widget/${P}/lead`, widgetLead, 'public'],
    ['GET', '/portal/widget', getWidget], ['PUT', '/portal/widget', putWidget],
    ['GET', '/portal/leads', listLeads], ['GET', '/portal/leads/export', exportLeads], ['PATCH', `/portal/leads/${P}`, patchLead], ['DELETE', `/portal/leads/${P}`, deleteLead],
    ['GET', '/portal/webhook', getWebhook], ['PUT', '/portal/webhook', putWebhook], ['DELETE', '/portal/webhook', removeWebhook], ['POST', '/portal/webhook/rotate-secret', rotateSecret], ['POST', '/portal/webhook/reveal-secret', revealSecret], ['POST', '/portal/webhook/test', testWebhook], ['POST', `/portal/webhook/deliveries/${P}/retry`, retryDelivery],
    ['GET', '/portal/site-costs', getCosts], ['PUT', '/portal/site-costs', putCosts], ['DELETE', '/portal/site-costs', deleteCosts],
  ].map(([method, p, handler, kind]) => ({ method, re: new RegExp(`^${p}$`), handler, kind }));

  /** Returns a Response, or null when the path is not one of these routes. */
  async function route(request, url, path, ctx) {
    let matched = false;
    for (const rt of ROUTES) {
      const m = rt.re.exec(path);
      if (!m) continue;
      matched = true;
      if (rt.method !== request.method && !(rt.kind === 'public' && request.method === 'POST' && rt.method === 'POST')) continue;
      if (rt.kind !== 'public' && !portal.portalOpen()) throw new HttpError('PORTAL_NOT_CONFIGURED', 'The builder portal is not open yet.');
      const args = m.slice(1).map((v) => { try { return decodeURIComponent(v); } catch { throw new HttpError('NOT_FOUND', 'No such endpoint.'); } });
      if (rt.kind === 'public') return rt.handler(request, url, ...args, ctx);
      const r = { request, url, setCookie: null };
      const res = await rt.handler(r, ...args);
      if (r.setCookie) res.headers.append('set-cookie', r.setCookie);
      return res;
    }
    if (matched) throw new HttpError('BAD_REQUEST', 'That method is not allowed for this endpoint.', {}, 405);
    return null;
  }
  return { route, retryAllDue, purgeOld };
}
