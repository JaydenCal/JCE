// "Order engineering" from the export menu: tick the services, give contact details and send an order request for this job.
// The request is saved on the server for JCE Infrastructure and shows in the admin portal. Nothing is emailed by this site.
// If the site configuration carries a JCE address (GI_CONFIG.jceEmail) a "Prefer email" link is offered; otherwise there is none.
// No prices are shown here: the services list says "Request a quote" until the owner confirms a price.

import { el } from '../util.js';
import { ENGINEERING_SERVICES, priceLabel } from '../engineering-services.js';

export const ORDER_REQUEST_TITLE = 'Order engineering';
export const ORDER_CONSENT = 'I agree to my details and the job being sent to JCE Infrastructure so they can contact me about this order';
export const ORDER_PRIVACY = 'We keep your name, email, optional phone, the address and the design details you see here, and give them to JCE Infrastructure only. We keep them for 24 months. This site does not email you. Read the';

const nz = (...v) => v.find((x) => x != null && String(x).trim() !== '') || '';

/** The job as the order carries it: address, lot, design name and (only when this page already is a share link) the link. */
export function jobOf(project, { href = '', portalLot = {} } = {}) {
  const sl = project?.site?.lot || {};
  let link = '';
  try { const u = new URL(href); if (u.searchParams.get('share')) link = u.href; } catch { /* no link */ }
  return {
    address: nz(sl.address, portalLot.address),
    lotLabel: [nz(sl.lotNumber, portalLot.lot) && `Lot ${nz(sl.lotNumber, portalLot.lot)}`, nz(sl.planLabel, portalLot.dp)].filter(Boolean).join(' '),
    designName: nz(project?.name, project?.title),
    designLink: link,
  };
}

/** A mailto link to JCE, only when the site configuration has a JCE address. Returns '' otherwise. */
export function jceMailto(config = globalThis.GI_CONFIG, { job = {}, services = [] } = {}) {
  const to = typeof config?.jceEmail === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(config.jceEmail) ? config.jceEmail : '';
  if (!to) return '';
  const labels = services.map((id) => ENGINEERING_SERVICES.find((s) => s.id === id)?.label).filter(Boolean);
  const body = [`Services: ${labels.join(', ') || 'to confirm'}`, job.address && `Address: ${job.address}`, job.lotLabel && `Lot: ${job.lotLabel}`, job.designName && `Design: ${job.designName}`, job.designLink && `Design link: ${job.designLink}`].filter(Boolean).join('\n');
  return `mailto:${to}?subject=${encodeURIComponent('Engineering order request')}&body=${encodeURIComponent(body)}`;
}

/**
 * openOrderRequest({ layer, send, project, job, services, config, privacyUrl, prefill })
 *   send(body)   posts the order; resolves { ok, reference }
 *   job          { address, lotLabel, designName, designLink } (see jobOf)
 */
export function openOrderRequest({ layer, send, project = null, job = null, services = ENGINEERING_SERVICES, config = globalThis.GI_CONFIG, privacyUrl = '/privacy.html', prefill = {} } = {}) {
  const jb = job || jobOf(project);
  const picked = new Set(Array.isArray(prefill.services) ? prefill.services : []);
  let modal;
  const checks = services.map((s) => {
    const box = el('input', { type: 'checkbox', id: `oe-${s.id}`, checked: picked.has(s.id), dataset: { service: s.id }, onchange: (e) => { if (e.target.checked) picked.add(s.id); else picked.delete(s.id); paintMail(); } });
    return el('label', { class: 'psp-order-item', for: `oe-${s.id}`, style: { display: 'flex', gap: '8px', alignItems: 'flex-start', textAlign: 'left' } }, box,
      el('span', null, el('strong', null, s.label), el('span', { class: 'psp-order-price' }, ` ${priceLabel(s)}`), el('br'), el('small', null, s.blurb)));
  });
  const field = (id, label, props = {}) => { const control = el('input', { class: 'psp-input', id: `oe-f-${id}`, type: 'text', ...props }); return { control, row: el('label', { style: { display: 'block', margin: '6px 0' } }, label, el('br'), control) }; };
  const f = { name: field('name', 'Your name', { autocomplete: 'name' }), email: field('email', 'Your email', { type: 'email', autocomplete: 'email' }), phone: field('phone', 'Phone (optional)', { type: 'tel', autocomplete: 'tel' }),
    address: field('address', 'Lot address', { value: jb.address || '' }), lot: field('lot', 'Lot and plan', { value: jb.lotLabel || '' }) };
  const notes = el('textarea', { class: 'psp-input', id: 'oe-notes', rows: '3', maxlength: '1500', 'aria-label': 'Anything else JCE should know' });
  const consent = el('input', { type: 'checkbox', id: 'oe-consent' });
  const hp = el('input', { type: 'text', name: 'website', tabindex: '-1', autocomplete: 'off', 'aria-hidden': 'true', style: { position: 'absolute', left: '-9999px', width: '1px', height: '1px' } });
  const status = el('p', { class: 'psp-sc-note', role: 'status', 'aria-live': 'polite' }, '');
  const sendBtn = el('button', { class: 'psp-btn psp-btn--primary', type: 'submit', dataset: { action: 'send-order' } }, 'Send order request');
  const mail = el('p', { class: 'psp-sc-note' });
  function paintMail() {
    const href = jceMailto(config, { job: jb, services: [...picked] });
    mail.replaceChildren(...(href ? ['Prefer email? ', el('a', { href, dataset: { action: 'mailto-jce' } }, 'Email JCE the same details'), '. Your email program opens with the details filled in; nothing is sent until you send it.'] : []));
  }
  const form = el('form', { novalidate: true, 'aria-label': 'Engineering order request' },
    el('p', { style: { marginTop: 0 } }, 'Engineering for this lot, fulfilled by JCE Infrastructure, civil engineers. Tick what you need. JCE will contact you about scope and a quote. Nothing is charged here.'),
    ...checks,
    el('p', { class: 'psp-sc-note' }, [jb.designName && `Design: ${jb.designName}.`, jb.designLink ? 'The design link is attached.' : 'No design link is attached. Share the design first if JCE should open it.'].filter(Boolean).join(' ')),
    f.name.row, f.email.row, f.phone.row, f.address.row, f.lot.row,
    el('label', { style: { display: 'block', margin: '6px 0' } }, 'Notes (optional)', el('br'), notes),
    el('label', { style: { display: 'flex', gap: '8px', alignItems: 'flex-start', margin: '6px 0' } }, consent, el('span', null, ORDER_CONSENT)),
    el('p', { class: 'psp-sc-note' }, ORDER_PRIVACY, ' ', el('a', { href: `${privacyUrl}#engineering-orders`, target: '_blank', rel: 'noopener' }, 'privacy page'), '.'),
    hp, status, el('div', { class: 'psp-sc-row' }, sendBtn, el('button', { class: 'psp-btn', type: 'button', onclick: () => modal?.close('cancel') }, 'Cancel')), mail);
  paintMail();
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const v = (k) => f[k].control.value.trim();
    if (!picked.size) { status.textContent = 'Tick at least one service.'; return; }
    if (!v('name')) { status.textContent = 'Please enter your name.'; return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v('email'))) { status.textContent = 'That email address does not look right.'; return; }
    if (!consent.checked) { status.textContent = 'Please tick the box to agree to your details being sent to JCE Infrastructure.'; return; }
    sendBtn.disabled = true;
    status.textContent = 'Sending...';
    try {
      const out = await send({ services: [...picked], name: v('name'), email: v('email'), phone: v('phone'), address: v('address'), lotLabel: v('lot'), designName: jb.designName || '', designLink: jb.designLink || '', notes: notes.value.trim(), consent: true, website: hp.value });
      form.replaceWith(el('div', { class: 'psp-enquiry-done', role: 'status' },
        el('p', { style: { fontWeight: '600' } }, `Order request sent. Your reference is ${out?.reference}.`),
        el('p', null, 'JCE will contact you about scope and a quote. Keep the reference in case you call or email.'),
        el('button', { class: 'psp-btn psp-btn--primary', type: 'button', onclick: () => modal.close('done') }, 'Close')));
    } catch (err) {
      sendBtn.disabled = false;
      status.textContent = err?.status === 429 || err?.code === 'RATE_LIMITED' ? 'You have sent several requests already. Please wait a while before sending another.' : (err?.message || 'That could not be sent. Please try again.');
    }
  });
  modal = layer.openModal({ title: ORDER_REQUEST_TITLE, body: () => form });
  return modal;
}
