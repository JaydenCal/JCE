// Subdivision check: the lead that goes to JCE Infrastructure, and the analytics events. Pure apart from submitLead (one fetch) and trackSubdiv.
// The lead uses the existing enquiry route (POST /api/enquiry/jce, server/lib/enquiry.js) with source "subdivision-check". That route saves the lead
// and emails the owner only. Nothing is ever sent to the person who filled the form in.

import { CONFIG } from '../config.js';
import { track } from '../ui/analytics.js';

export const SOURCE = 'subdivision-check';
export const ROLES = Object.freeze(['Landowner', 'Agent', 'Developer', 'Buyer']);
export const CONSENT_TEXT = 'I agree to Glide Inside and JCE Infrastructure contacting me about this site.';
export const CAVEAT = 'Indicative only. Yield depends on council controls, access, services, flooding and the final survey.';
export const DONE_LINE = 'Want this done properly? JCE Infrastructure designs subdivisions: roads, stormwater and services.';
export const EVENTS = Object.freeze({
  start: 'subdiv_check_start',
  lotLoaded: 'subdiv_lot_loaded',
  resultShown: 'subdiv_result_shown',
  leadSubmit: 'subdiv_lead_submit',
  pdfDownload: 'subdiv_pdf_download',
});

/** Send an analytics event to the host page (it forwards to GA4 through its own consent rules). No address or personal detail is ever included. */
export function trackSubdiv(event, props = {}) {
  const safe = {};
  for (const k of ['role', 'lots_low', 'lots_high', 'layout', 'min_basis', 'state', 'owner']) if (props[k] !== undefined && props[k] !== null) safe[k] = props[k];
  track(event, safe);
}

const clean = (s, n = 200) => String(s ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, n);
export const emailOk = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(e || '').trim());
export const phoneOk = (p) => !String(p || '').trim() || /[0-9]{6,}/.test(String(p).replace(/[\s()+-]/g, ''));

/** Check the form. Returns an error message, or '' when it is fine. */
export function validateLead({ name, email, phone, role, consent }) {
  if (!clean(name)) return 'Enter your name.';
  if (!emailOk(email)) return 'Enter a valid email address.';
  if (!phoneOk(phone)) return 'That phone number does not look right.';
  if (!ROLES.includes(role)) return 'Choose which describes you best.';
  if (consent !== true) return 'Tick the box so we can contact you about this site.';
  return '';
}

/**
 * The body of POST /api/enquiry/jce for this lead.
 *   lot     site.lot (address, lotNumber, planLabel, lga, zoning, areaM2)
 *   result  { rules: { minM2, basis }, low, high, layout: { kind } }
 */
export function buildLeadPayload({ name, email, phone, role, consent }, lot, result) {
  const zone = [lot?.zoning?.code, lot?.zoning?.name].filter(Boolean).join(' ');
  return {
    name: clean(name, 120), email: clean(email, 200).toLowerCase(), phone: clean(phone, 40), need: 'engineering', consent: consent === true,
    source: SOURCE, projectName: 'Subdivision check', orgName: '',
    notes: `Subdivision check lead. Role: ${role}. Indicative lots: ${result.low < result.high ? `${result.low} to ${result.high}` : result.high}.`,
    lot: { address: clean(lot?.address), lot: clean(lot?.lotNumber, 40), dp: clean(lot?.planLabel, 40), lga: clean(lot?.lga), zone: clean(zone) },
    subdivision: {
      role, lotAreaM2: Math.round(Number(lot?.areaM2) || 0), lotsLow: result.low, lotsHigh: result.high, minLotM2: result.rules.minM2,
      minBasis: result.rules.basis, layout: clean(result.layout?.kind, 40),
    },
  };
}

/** Post the lead. Resolves { reference }. Throws an Error with a readable message. A 502 that says it was saved still counts as saved. */
export async function submitLead(payload, { fetchImpl = globalThis.fetch, apiBase = CONFIG.apiBase } = {}) {
  let res;
  try {
    res = await fetchImpl(`${String(apiBase).replace(/\/+$/, '')}/enquiry/jce`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-gi-request': '1' }, body: JSON.stringify(payload) });
  } catch {
    throw new Error('We could not reach the server. Check your connection and try again.');
  }
  const d = await res.json().catch(() => ({}));
  const e = d?.error && typeof d.error === 'object' ? d.error : d;
  const ref = d?.reference || e?.reference;
  if (res.ok || e?.saved || d?.saved) return { reference: ref || '' };
  throw new Error(e?.message || 'That did not send. Please try again.');
}
