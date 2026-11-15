// The failed payment banner: shown in commercial mode to a subscriber whose last card payment failed and who is still inside the grace period
// (the server decides, see server/lib/commercial.js). It links to Manage billing (the Stripe billing page).
//
//   createGraceBanner({ getState, manageBilling }) -> { el, render, dispose }    getState(): { csub, credits, commercial }

import { el } from '../util.js';
import { icon } from '../icons.js';
import { graceText } from '../credits.js';

export function createGraceBanner({ getState, manageBilling, host = typeof document !== 'undefined' ? document.body : null }) {
  const text = el('span', { class: 'psp-grace-text', dataset: { ps: 'grace-text' } });
  const link = el('button', { class: 'psp-btn psp-btn--link psp-grace-link', type: 'button', dataset: { ps: 'grace-billing' }, onclick: () => manageBilling() }, 'Manage billing');
  const root = el('div', { class: 'psp-scope psp-grace', role: 'alert', hidden: true, dataset: { ps: 'grace-banner' } }, icon('info', 16), text, link);
  host?.append(root);
  function render() {
    const st = getState();
    const g = st.csub?.kind === 'subscription' ? st.credits?.paymentGrace : null;
    root.hidden = !g;
    if (g) text.textContent = graceText(g.daysLeft);
  }
  return { el: root, render, dispose: () => root.remove() };
}
