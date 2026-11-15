// The required tick box shown before a Stripe checkout starts (Plan Pack, commercial subscription, AI top ups).
// Unticked by default; the caller keeps its button disabled until `checked()` is true.
import { el } from '../premium/util.js';

export const ORDER_TERMS_URL = '/terms.html';
export const PLAN_TERMS_PAGE = '/plan-terms.html';

export function createCheckoutTick({ onChange = () => {} } = {}) {
  const box = el('input', { type: 'checkbox', 'data-ps': 'checkout-terms', required: true });
  const row = el('label', { class: 'psp-fine', style: 'display:flex;gap:10px;align-items:flex-start;cursor:pointer;margin:10px 0' }, box,
    el('span', null, 'I agree to the ', el('a', { href: ORDER_TERMS_URL, target: '_blank', rel: 'noopener' }, 'Order terms'), ' and the ', el('a', { href: PLAN_TERMS_PAGE, target: '_blank', rel: 'noopener' }, 'Plan set terms of use'), '.'));
  box.addEventListener('change', () => onChange(box.checked));
  return { el: row, checked: () => box.checked };
}
