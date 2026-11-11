// "Send to JCE for engineering and DA plans" (docs/PORTAL_API.md 9). POST /api/enquiry/jce.
// Validates the request, keeps a copy in the store (D1 table jce_enquiries) so nothing is lost if email fails, then emails
// JCE Infrastructure through the Resend REST API with the PDF plan set attached. Sent only when the person clicks Send.
// Web-standard fetch only, no SDK.

import { HttpError } from './http.js';
import { migrate, validate } from '../../src/model/schema.js';

export const NEEDS = ['engineering', 'da', 'both'];
const NEED_TEXT = { engineering: 'Engineering', da: 'DA plans', both: 'Engineering and DA plans' };
const REF_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0, 1, I or O: easy to read out
const randomRef = () => `GI-${Array.from(crypto.getRandomValues(new Uint8Array(5)), (b) => REF_ALPHABET[b % REF_ALPHABET.length]).join('')}`;
// Single line fields lose control characters and line breaks, so a name or project name cannot break the email subject or
// the summary lines. Notes keep their line breaks.
const text = (v, name, { max = 200, required = false, multiline = false } = {}) => {
  const raw = typeof v === 'string' ? v : '';
  const s = (multiline ? raw.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '') : raw.replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, ' ')).trim();
  if (required && !s) throw new HttpError('BAD_REQUEST', `${name} is required.`);
  if (s.length > max) throw new HttpError('BAD_REQUEST', `${name} is too long.`);
  return s;
};

/** Checks and cleans the request body. Throws HttpError BAD_REQUEST. Returns the enquiry without the PDF bytes. */
export function parseEnquiry(body, { maxProjectBytes = 2_000_000, maxPdfBytes = 6_000_000 } = {}) {
  if (body.consent !== true) throw new HttpError('BAD_REQUEST', 'Please tick the box to agree to your plans and details being sent to JCE Infrastructure Pty Ltd.');
  const name = text(body.name, 'Name', { required: true, max: 120 });
  const phone = text(body.phone, 'Phone', { required: true, max: 40 });
  const email = text(body.email, 'Email', { required: true, max: 200 }).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError('BAD_REQUEST', 'That email address does not look right.');
  if (!/[0-9]{6,}/.test(phone.replace(/[\s()+-]/g, ''))) throw new HttpError('BAD_REQUEST', 'That phone number does not look right.');
  const need = NEEDS.includes(body.need) ? body.need : null;
  if (!need) throw new HttpError('BAD_REQUEST', `need must be one of: ${NEEDS.join(', ')}.`);
  const lot = {};
  for (const k of ['address', 'lot', 'dp', 'lga', 'zone']) lot[k] = text(body.lot?.[k], `Lot ${k}`, { max: 200 });
  let project = null;
  if (body.project != null) {
    try {
      project = migrate(body.project);
    } catch (e) {
      throw new HttpError('BAD_REQUEST', `The project could not be read: ${e.message}`);
    }
    if (validate(project).length) throw new HttpError('BAD_REQUEST', 'The project has problems and cannot be sent.');
    if (JSON.stringify(project).length > maxProjectBytes) throw new HttpError('PAYLOAD_TOO_LARGE', 'This project is too large to send.');
  }
  let pdfBase64 = null;
  if (body.pdfBase64 != null) {
    pdfBase64 = String(body.pdfBase64).replace(/^data:application\/pdf;base64,/, '');
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(pdfBase64)) throw new HttpError('BAD_REQUEST', 'The plan set is not valid.');
    if (Math.floor((pdfBase64.length * 3) / 4) > maxPdfBytes) throw new HttpError('PAYLOAD_TOO_LARGE', 'The plan set is too large to send.');
    if (!pdfBase64.startsWith('JVBERi0')) throw new HttpError('BAD_REQUEST', 'The plan set is not a PDF.'); // "%PDF-"
  }
  return {
    name, phone, email, need, notes: text(body.notes, 'Notes', { max: 4000, multiline: true }), lot,
    source: ['public', 'builder', 'client'].includes(body.source) ? body.source : 'public',
    orgName: text(body.orgName, 'Builder', { max: 120 }),
    projectName: text(project?.name || body.projectName, 'Project name', { max: 120 }),
    project, pdfBase64,
  };
}

export function summaryText(e, reference) {
  const lot = e.lot || {};
  return [
    `New engineering / DA enquiry from Glide Inside (Pocket Architect)`,
    `Reference: ${reference}`,
    '',
    `Name: ${e.name}`, `Phone: ${e.phone}`, `Email: ${e.email}`,
    `Needs: ${NEED_TEXT[e.need]}`,
    e.notes ? `Notes: ${e.notes}` : null,
    '',
    `Project: ${e.projectName || '(unnamed)'}`,
    `Lot address: ${lot.address || 'not given'}`, `Lot / DP: ${[lot.lot, lot.dp].filter(Boolean).join(' / ') || 'not given'}`,
    `LGA: ${lot.lga || 'not given'}`, `Zone: ${lot.zone || 'not given'}`,
    e.orgName ? `Sent from the builder portal of: ${e.orgName} (${e.source})` : `Sent by: ${e.source === 'public' ? 'a Plan Pack user' : e.source}`,
    '',
    'The person ticked: "I agree to my plans and details being sent to JCE Infrastructure Pty Ltd to prepare a quote".',
    'Attached: the PDF plan set and the design file (.json, opens in Pocket Architect).',
  ].filter((l) => l !== null).join('\n');
}

/** Sends the email through Resend. Resolves { id }. Throws HttpError (EMAIL_FAILED 502). */
export async function sendViaResend({ config, fetchImpl, enquiry, reference }) {
  const attachments = [];
  const safe = (enquiry.projectName || 'design').replace(/[^A-Za-z0-9._-]+/g, '-').slice(0, 60) || 'design';
  if (enquiry.pdfBase64) attachments.push({ filename: `${safe}-plans.pdf`, content: enquiry.pdfBase64 });
  if (enquiry.project) {
    const bytes = new TextEncoder().encode(JSON.stringify(enquiry.project));
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    attachments.push({ filename: `${safe}.planstudio.json`, content: btoa(bin) });
  }
  let res;
  try {
    res = await fetchImpl('https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: `Bearer ${config.resendApiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        from: config.enquiryFrom,
        to: [config.enquiryTo],
        reply_to: enquiry.email,
        subject: `[${reference}] ${NEED_TEXT[enquiry.need]} enquiry: ${enquiry.projectName || enquiry.lot.address || enquiry.name}`,
        text: summaryText(enquiry, reference),
        attachments,
      }),
    });
  } catch {
    throw new HttpError('EMAIL_FAILED', 'We could not reach the email service.', { saved: true, reference }, 502);
  }
  if (!res.ok) throw new HttpError('EMAIL_FAILED', 'The email service refused the message.', { saved: true, reference, upstreamStatus: res.status }, 502);
  const data = await res.json().catch(() => ({}));
  return { id: data?.id || null };
}

/**
 * The endpoint. Order: configured? (503 when RESEND_API_KEY is missing) -> validate -> rate limit -> save -> email -> mark.
 * Returns { ok: true, reference }. If the email fails the enquiry is already saved and EMAIL_FAILED carries the reference.
 */
export async function handleEnquiry({ body, request, store, config, fetchImpl, now, clientIp }) {
  if (!config.resendApiKey) throw new HttpError('ENQUIRY_NOT_CONFIGURED', 'Sending to JCE is not set up yet.', {}, 503);
  const enquiry = parseEnquiry(body, { maxProjectBytes: config.exportMaxProjectBytes, maxPdfBytes: config.enquiryMaxPdfBytes });
  const t = now();
  const byIp = await store.hitRate(`enquiry:ip:${clientIp(request)}`, 3600, t);
  const byEmail = await store.hitRate(`enquiry:email:${enquiry.email}`, 86400, t);
  if (byIp > 5 || byEmail > 3) throw new HttpError('RATE_LIMITED', 'You have sent several requests already. Please wait before sending another.', { retryAfter: 3600 });
  const reference = randomRef();
  const projectJson = enquiry.project ? JSON.stringify({ ...enquiry.project, site: { ...enquiry.project.site, underlay: null } }) : null;
  await store.saveEnquiry({
    id: reference, reference, createdAt: new Date(t).toISOString(), name: enquiry.name, phone: enquiry.phone, email: enquiry.email, need: enquiry.need,
    notes: enquiry.notes, lot: enquiry.lot, source: enquiry.source, orgName: enquiry.orgName, projectName: enquiry.projectName,
    projectJson: projectJson && projectJson.length <= 1_800_000 ? projectJson : null, pdfBytes: enquiry.pdfBase64 ? Math.floor((enquiry.pdfBase64.length * 3) / 4) : 0,
    consent: true, emailStatus: 'pending',
  });
  try {
    const sent = await sendViaResend({ config, fetchImpl, enquiry, reference });
    await store.markEnquiry(reference, { emailStatus: 'sent', emailId: sent.id, emailedAt: new Date(now()).toISOString() });
  } catch (e) {
    await store.markEnquiry(reference, { emailStatus: 'failed', emailError: `${e.message}${e.extra?.upstreamStatus ? ` (${e.extra.upstreamStatus})` : ''}` });
    throw e;
  }
  return { ok: true, reference };
}
