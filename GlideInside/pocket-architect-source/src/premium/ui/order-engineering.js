// "Order engineering": the services JCE Infrastructure fulfils, with the owner's "from" prices (src/premium/engineering-services.js).
// Picking a service opens the existing enquiry form ("Send plans to a registered engineer") with the service filled in. This panel sends
// nothing: the form needs the person's consent tick and a press of Send, and it posts to the existing /api/enquiry/jce.

import { el } from '../util.js';
import { ENGINEERING_SERVICES, priceLabel, enquiryPrefill } from '../engineering-services.js';

export const ORDER_TITLE = 'Order engineering';

/**
 * openOrderEngineering({ layer, openEnquiry, services })
 *   openEnquiry({ prefill: { need, notes } })   opens the enquiry form (called after this panel closes)
 */
export function openOrderEngineering({ layer, openEnquiry, services = ENGINEERING_SERVICES } = {}) {
  let modal;
  const choose = (s) => {
    modal?.close('pick');
    return openEnquiry?.({ prefill: enquiryPrefill(s), service: s.id });
  };
  const list = el('div', { class: 'psp-order-list', role: 'list' }, ...services.map((s) => el('button', { class: 'psp-order-item', type: 'button', role: 'listitem', dataset: { service: s.id }, onclick: () => choose(s) },
    el('strong', null, s.label), el('span', { class: 'psp-order-price' }, priceLabel(s)), el('small', null, s.blurb))));
  const body = el('div', null,
    el('p', { style: { marginTop: 0 } }, 'Engineering for this lot, fulfilled by JCE Infrastructure, civil engineers. Pick a service and the enquiry form opens with it filled in. Nothing is sent until you tick the consent box and press Send.'),
    list,
    el('p', { class: 'psp-sc-note' }, 'Prices are indicative starting prices, GST excluded. Where a price is not yet confirmed, ask for a quote.'));
  modal = layer.openModal({ title: ORDER_TITLE, body: () => body, footer: (close) => el('button', { class: 'psp-btn', type: 'button', onclick: () => close('done') }, 'Close') });
  modal.choose = choose;
  return modal;
}
