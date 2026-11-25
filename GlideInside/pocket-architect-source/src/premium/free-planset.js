// Free plan set for homeowners, in exchange for contact details (25/11/2026). Pure helpers shared by the desktop dialog and the phone step,
// plus the desktop dialog. The lead is saved through the existing enquiry endpoint (POST /api/enquiry/jce) with source "planset-free" and need
// "planset"; the plan set then downloads in the browser. Nothing is emailed to the person. CONFIG.homeownerPlanSetFree switches it all off.

import { el, track } from './util.js';
import { CONFIG } from '../config.js';

export const LEAD_SOURCE = 'planset-free';
// Leads are stored for the owner only and are not forwarded to any builder (owner decision 25/11/2026), so the wording says the details MAY be passed on.
// The builder argument is kept for old callers and is ignored.
export const consentText = () => 'I agree to Glide Inside contacting me, and passing my details and design to a local builder in my area, so they can contact me about building it.';
export const LEAD_CONSENT = consentText(null); // the wording when no builder holds the area

/**
 * The builder that holds the area of the lot's postcode, or null. The data is CONFIG.areaBuilders = { '2340': { name: 'Example Homes' } },
 * filled in when builders are given areas; there is none yet, so today every lead reads "a local builder for my area".
 */
export function areaBuilderFor(project, config = {}) {
  const addr = String(project?.site?.lot?.address || '');
  const pc = (/\b(\d{4})\s*$/.exec(addr.trim()) || /\bNSW\s+(\d{4})\b|\bQLD\s+(\d{4})\b/i.exec(addr) || [])[1] || project?.site?.lot?.postcode || null;
  const hit = pc && config?.areaBuilders && Object.prototype.hasOwnProperty.call(config.areaBuilders, String(pc)) ? config.areaBuilders[String(pc)] : null;
  const name = typeof hit === 'string' ? hit : hit?.name;
  return name ? { name: String(name), postcode: String(pc) } : null;
}
export const TIMEFRAME_Q = 'When are you hoping to build?';
export const TIMEFRAMES = Object.freeze([['6m', 'Within 6 months'], ['12m', 'Within 12 months'], ['looking', 'Just looking']]);
export const OWNERSHIP_Q = 'Do you own the block?';
export const OWNERSHIPS = Object.freeze([['yes', 'Yes'], ['buying', 'Buying'], ['no', 'No']]);
export const PRIVACY_PATH = '/privacy.html';
export const PRIVACY_LINE = 'We use your details as set out in our privacy policy.';
export const GET_LABEL = 'Get my plan set, free';
export const QUOTE_LINE = 'Need stormwater, site classification or footings? Get a quote from JCE';
export const CONCEPT_LINE = 'Concept only. Not for construction or approval.';
export const FREE_WATERMARK = 'PREVIEW, free with your details';
const KEY = 'gi.planset.lead';

/** Pure: the problems with a lead form, as { field, message } (empty when fine). */
export function leadProblems({ name = '', email = '', suburb = '', timeframe = '', ownership = '', consent = false } = {}) {
  const out = [];
  if (!String(name).trim()) out.push({ field: 'name', message: 'Enter your name.' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email).trim())) out.push({ field: 'email', message: 'Enter a valid email address.' });
  if (!String(suburb).trim()) out.push({ field: 'suburb', message: 'Enter your suburb.' });
  if (!TIMEFRAMES.some(([v]) => v === timeframe)) out.push({ field: 'timeframe', message: 'Choose when you are hoping to build.' });
  if (!OWNERSHIPS.some(([v]) => v === ownership)) out.push({ field: 'ownership', message: 'Say whether you own the block.' });
  if (consent !== true) out.push({ field: 'consent', message: 'Tick the box so we can contact you about this design.' });
  return out;
}

/** Pure: the body posted to /api/enquiry/jce. The design file and the PDF are not sent: this is a lead only. */
export function leadBody(lead, project, { now = () => new Date() } = {}) {
  const sl = project?.site?.lot || {};
  const design = project?.placedHouse?.name || project?.name || '';
  return {
    name: String(lead.name).trim(), email: String(lead.email).trim(), phone: '', need: 'planset', consent: true, source: LEAD_SOURCE,
    projectName: design,
    consentText: lead.consentText || consentText(), builder: null, consentAt: now().toISOString(), suburb: String(lead.suburb).trim(), timeframe: lead.timeframe, ownership: lead.ownership, designType: lead.designType || '',
    notes: [`FREE PLAN SET (${LEAD_SOURCE})`, `Suburb: ${String(lead.suburb).trim()}`, `Building: ${(TIMEFRAMES.find(([v]) => v === lead.timeframe) || [])[1] || ''}`, `Owns the block: ${(OWNERSHIPS.find(([v]) => v === lead.ownership) || [])[1] || ''}`, `Design: ${design || 'not named'}`, `Design type: ${lead.designType || 'not given'}`, `Surface: ${lead.surface || 'desktop'}`, `Consent: ${lead.consentText || consentText()}`, `Consent given: ${now().toISOString()}`].join('\n'),
    lot: { address: sl.address || '', lot: sl.lotNumber || '', dp: sl.planLabel || '', lga: sl.lga || '', zone: sl.zoning?.code ? `${sl.zoning.code}${sl.zoning.name ? ` ${sl.zoning.name}` : ''}` : '' },
  };
}

/** Details remembered in this browser, so a second design is prefilled and the same design is not asked for again. */
export function rememberedLead(storage = (() => { try { return globalThis.localStorage; } catch { return null; } })()) {
  try { return JSON.parse(storage?.getItem(KEY) || 'null') || null; } catch { return null; }
}
export function rememberLead(lead, projectId, storage = (() => { try { return globalThis.localStorage; } catch { return null; } })()) {
  try {
    const cur = rememberedLead(storage) || {};
    const projects = [...new Set([...(cur.projects || []), projectId].filter(Boolean))].slice(-20);
    storage?.setItem(KEY, JSON.stringify({ name: lead.name, email: lead.email, suburb: lead.suburb, projects }));
  } catch { /* not remembered */ }
}
/**
 * A small queue of leads the server did not take (network error, a 4xx or a 429). They are kept in this browser, tried again on the next load or
 * the next submit, at most QUEUE_MAX of them, and removed once the server accepts one. After QUEUE_TRIES failed tries an entry is dropped.
 */
const QUEUE_KEY = 'gi.planset.queue';
export const QUEUE_MAX = 3;
export const QUEUE_TRIES = 5;
const defStorage = () => { try { return globalThis.localStorage; } catch { return null; } };
export function queuedLeads(storage = defStorage()) {
  try { const q = JSON.parse(storage?.getItem(QUEUE_KEY) || '[]'); return Array.isArray(q) ? q.filter((e) => e && e.body && typeof e.body === 'object') : []; } catch { return []; }
}
const writeQueue = (q, storage) => { try { storage?.setItem(QUEUE_KEY, JSON.stringify(q)); } catch { /* storage blocked */ } };
export function queueLead(body, storage = defStorage()) {
  const key = `${String(body?.email || '').toLowerCase()}|${body?.projectName || ''}`;
  const q = queuedLeads(storage).filter((e) => e.key !== key);
  q.push({ key, body, tries: 0 });
  writeQueue(q.slice(-QUEUE_MAX), storage);
}
/** Try each queued lead once with send(body). Accepted ones are removed; the rest stay (until QUEUE_TRIES). Never throws. */
export async function flushLeadQueue(send, storage = defStorage()) {
  const left = [];
  for (const e of queuedLeads(storage)) {
    try { await send(e.body); } catch { if (e.tries + 1 < QUEUE_TRIES) left.push({ ...e, tries: e.tries + 1 }); }
  }
  writeQueue(left, storage);
  return left.length;
}
export const alreadyGave = (projectId, storage) => !!projectId && !!rememberedLead(storage)?.projects?.includes(projectId);

/** The desktop dialog: the short form, then the download, then the quote line. `submit(lead)` resolves { filename }; `orderEngineering()` opens the order path. */
export function openFreePlanSet({ layer, project, submit, orderEngineering = null, fileLabel = 'plan set', surface = 'desktop' } = {}) {
  const isSet = fileLabel === 'plan set';
  const getLabel = isSet ? GET_LABEL : 'Download my file, free';
  const mem = rememberedLead() || {};
  const field = (name, label, attrs = {}) => {
    const input = el('input', { id: `fps-${name}`, class: 'psp-input', type: attrs.type || 'text', autocomplete: attrs.autocomplete || 'off', maxlength: '120', value: mem[name] || '', required: true });
    return { input, row: el('div', { class: 'psp-field', style: { display: 'grid', gap: '4px', marginBottom: '10px' } }, el('label', { for: `fps-${name}` }, label), input) };
  };
  const f = { name: field('name', 'Your name', { autocomplete: 'name' }), email: field('email', 'Email', { type: 'email', autocomplete: 'email' }), suburb: field('suburb', 'Suburb', { autocomplete: 'address-level2' }) };
  const choice = (name, question, opts) => {
    const radios = opts.map(([v, label]) => el('label', { style: { display: 'inline-flex', gap: '6px', alignItems: 'center', marginRight: '12px' } }, el('input', { type: 'radio', name: `fps-${name}`, value: v, dataset: { ps: `planset-${name}` } }), label));
    return { get value() { return radios.map((r) => r.firstChild).find((i) => i.checked)?.value || ''; }, row: el('fieldset', { style: { border: '0', padding: '0', margin: '0 0 10px' } }, el('legend', null, question), ...radios) };
  };
  const timeframe = choice('timeframe', TIMEFRAME_Q, TIMEFRAMES);
  const ownership = choice('ownership', OWNERSHIP_Q, OWNERSHIPS);
  const builder = null; // no builder is named: leads are not forwarded to builders yet
  const shownConsent = consentText(builder);
  const consent = el('input', { type: 'checkbox', id: 'fps-consent' });
  const status = el('p', { role: 'alert', 'aria-live': 'polite', class: 'psp-error', hidden: true });
  const go = el('button', { class: 'psp-btn psp-btn--primary', type: 'submit' }, getLabel);
  const done = el('div', { hidden: true, dataset: { ps: 'planset-done' } });
  const form = el('form', { novalidate: true, dataset: { ps: 'planset-form' } },
    el('p', { style: { marginTop: 0 } }, `Your ${fileLabel} downloads straight away. Every other file for this design is free too, and you will not be asked again. Nothing is emailed to you.`),
    f.name.row, f.email.row, f.suburb.row, timeframe.row, ownership.row,
    el('label', { style: { display: 'flex', gap: '8px', alignItems: 'flex-start', margin: '6px 0' } }, consent, el('span', { dataset: { ps: 'planset-consent-text' } }, shownConsent)),
    status, el('div', { style: { display: 'flex', gap: '8px', marginTop: '10px' } }, go),
    el('p', { class: 'psp-fine' }, PRIVACY_LINE, ' ', el('a', { href: PRIVACY_PATH, target: '_blank', rel: 'noopener', dataset: { ps: 'planset-privacy' } }, 'Privacy policy')));
  let modal = null;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const lead = { name: f.name.input.value, email: f.email.input.value, suburb: f.suburb.input.value, timeframe: timeframe.value, ownership: ownership.value, designType: project?.placedHouse?.id || '', consentText: shownConsent, builder, consent: consent.checked, surface };
    const bad = leadProblems(lead);
    status.hidden = !bad.length; status.textContent = bad[0]?.message || '';
    if (bad.length) return;
    go.disabled = true; go.textContent = `Preparing your ${fileLabel}`;
    try {
      const out = await submit(lead);
      form.hidden = true; done.hidden = false;
      done.replaceChildren(el('p', { style: { marginTop: 0 } }, `Your ${fileLabel} has downloaded${out?.filename ? ` as ${out.filename}` : ''}.`), el('p', { class: 'psp-fine' }, CONCEPT_LINE),
        orderEngineering ? el('button', { class: 'psp-btn psp-btn--link', type: 'button', dataset: { ps: 'planset-quote' }, onclick: () => { modal?.close('quote'); orderEngineering(); } }, QUOTE_LINE) : null);
    } catch (err) {
      status.hidden = false; status.textContent = err?.message || 'That did not work. Try again.';
      go.disabled = false; go.textContent = getLabel;
    }
  });
  modal = layer.openModal({ title: getLabel, body: () => el('div', null, form, done), footer: (close) => el('button', { class: 'psp-btn', type: 'button', onclick: () => close('done') }, 'Close') });
  void project; void track;
  return modal;
}
