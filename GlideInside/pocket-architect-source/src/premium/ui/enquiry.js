// "Send to JCE for engineering and DA plans": a short form that sends the design and the PDF plan set to JCE Infrastructure.
// Nothing is sent until the person ticks the consent box and presses Send. The PDF is built in the browser when they press Send.

import { el } from '../util.js';

export const CONSENT_TEXT = 'I agree to my plans and details being sent to JCE Infrastructure Pty Ltd to prepare a quote';
const NEEDS = [['engineering', 'Engineering'], ['da', 'DA plans'], ['both', 'Both engineering and DA plans']];

/**
 * openEnquiry({ layer, send, buildPdf, project, lot, source, orgName, prefill })
 *   send(body)    posts the enquiry; resolves { ok, reference }. Throws on failure (error.status 503 means not set up yet).
 *   buildPdf()    resolves a base64 string of the PDF plan set (or null)
 *   lot           { address, lot, dp, lga, zone } when known; the person can fill in the rest
 */
export function openEnquiry({ layer, send, buildPdf, project, lot = {}, source = 'public', orgName = '', prefill = {} } = {}) {
  const input = (name, label, attrs = {}) => {
    const id = `jce-${name}`;
    const control = attrs.tag === 'textarea'
      ? el('textarea', { id, class: 'psp-input', rows: '3', maxlength: '4000', ...attrs.props })
      : el('input', { id, class: 'psp-input', type: attrs.type || 'text', autocomplete: attrs.autocomplete || 'off', maxlength: '200', ...attrs.props });
    return { control, row: el('div', { class: 'psp-field', style: { display: 'grid', gap: '4px', marginBottom: '10px' } }, el('label', { for: id }, label), control) };
  };
  const f = {
    name: input('name', 'Your name', { autocomplete: 'name', props: { required: true, value: prefill.name || '' } }),
    phone: input('phone', 'Phone', { type: 'tel', autocomplete: 'tel', props: { required: true, value: prefill.phone || '' } }),
    email: input('email', 'Email', { type: 'email', autocomplete: 'email', props: { required: true, value: prefill.email || '' } }),
    address: input('address', 'Lot address', { props: { value: lot.address || '' } }),
    lot: input('lot', 'Lot number', { props: { value: lot.lot || '' } }),
    dp: input('dp', 'DP or plan number', { props: { value: lot.dp || '' } }),
    lga: input('lga', 'Council (LGA)', { props: { value: lot.lga || '' } }),
    zone: input('zone', 'Zone', { props: { value: lot.zone || '' } }),
    notes: input('notes', 'Anything JCE should know', { tag: 'textarea', props: {} }),
  };
  let need = 'both';
  const needRow = el('fieldset', { style: { border: '0', padding: '0', margin: '0 0 10px' } }, el('legend', null, 'What do you need?'),
    ...NEEDS.map(([v, label]) => el('label', { style: { display: 'block', padding: '2px 0' } }, el('input', { type: 'radio', name: 'jce-need', value: v, checked: v === need, onchange: () => { need = v; } }), ` ${label}`)));
  const consent = el('input', { type: 'checkbox', id: 'jce-consent' });
  const status = el('p', { role: 'status', 'aria-live': 'polite', style: { margin: '8px 0 0' } });
  const sendBtn = el('button', { class: 'psp-btn psp-btn--primary', type: 'submit' }, 'Send to JCE');
  const form = el('form', { novalidate: true },
    el('p', { style: { marginTop: 0 } }, `We send your design, the PDF plans and the lot details to JCE Infrastructure Pty Ltd. They will be in touch with a quote.${orgName ? ` Sent from ${orgName}.` : ''}`),
    f.name.row, f.phone.row, f.email.row, needRow, f.address.row,
    el('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 10px' } }, f.lot.row, f.dp.row, f.lga.row, f.zone.row),
    f.notes.row,
    el('label', { style: { display: 'flex', gap: '8px', alignItems: 'flex-start', margin: '6px 0' } }, consent, el('span', null, CONSENT_TEXT)),
    el('div', { style: { display: 'flex', gap: '8px', marginTop: '10px' } }, sendBtn), status);

  let modal;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    status.textContent = '';
    const v = (k) => f[k].control.value.trim();
    if (!v('name') || !v('phone') || !v('email')) { status.textContent = 'Please fill in your name, phone and email.'; return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v('email'))) { status.textContent = 'That email address does not look right.'; return; }
    if (!consent.checked) { status.textContent = 'Please tick the box to agree to your plans and details being sent to JCE.'; return; }
    sendBtn.disabled = true;
    status.textContent = 'Preparing your plans...';
    try {
      const pdfBase64 = buildPdf ? await buildPdf() : null;
      status.textContent = 'Sending...';
      const out = await send({
        name: v('name'), phone: v('phone'), email: v('email'), need, notes: v('notes'), consent: true,
        lot: { address: v('address'), lot: v('lot'), dp: v('dp'), lga: v('lga'), zone: v('zone') },
        project, pdfBase64, source, orgName,
      });
      form.replaceWith(el('div', { class: 'psp-enquiry-done' },
        el('p', { style: { fontWeight: '600' } }, `Sent to JCE Infrastructure, reference ${out.reference}; JCE will be in touch.`),
        el('p', null, 'Keep the reference in case you call or email them.'),
        el('button', { class: 'psp-btn psp-btn--primary', type: 'button', onclick: () => modal.close('done') }, 'Close')));
    } catch (err) {
      sendBtn.disabled = false;
      if (err?.status === 503 || err?.code === 'ENQUIRY_NOT_CONFIGURED') status.textContent = 'Sending to JCE is not set up yet. Please try again later.';
      else if (err?.status === 429 || err?.code === 'RATE_LIMITED') status.textContent = 'You have sent several requests already. Please wait a while before sending another.';
      else if (err?.status === 502 && err?.details?.reference) status.textContent = `Your request was saved (reference ${err.details.reference}) but the email did not go through. JCE can still pick it up; please contact them quoting the reference.`;
      else status.textContent = err?.message || 'That could not be sent. Please try again.';
    }
  });
  modal = layer.openModal({ title: 'Send to JCE for engineering and DA plans', body: () => form });
  return modal;
}
