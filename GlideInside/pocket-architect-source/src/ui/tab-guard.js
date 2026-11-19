// Two tabs on one design: a non-blocking banner when another tab has saved the design since this tab last did (see the store's
// autosave version counter). Reload shows the other tab's design; Keep editing replaces the other tab's changes from the next save.

import { h } from './dom.js';

export const TAB_GUARD_TEXT = "This design was changed in another tab. Reload to see it, or keep editing here (the other tab's changes will be replaced).";

export function mountTabGuard(host, store) {
  let el = null;
  const hide = () => { el?.remove(); el = null; };
  const offs = [
    store.on('autosave-conflict', ({ reload, keep } = {}) => {
      if (el) return;
      el = h('div', { class: 'ps-tabguard', role: 'alert' },
        h('span', { class: 'ps-tabguard-text' }, TAB_GUARD_TEXT),
        h('button', { type: 'button', class: 'ps-btn ps-btn--sm ps-btn--primary', dataset: { action: 'tab-reload' }, onclick: () => { reload?.(); } }, 'Reload'),
        h('button', { type: 'button', class: 'ps-btn ps-btn--sm', dataset: { action: 'tab-keep' }, onclick: () => { keep?.(); hide(); } }, 'Keep editing'));
      host.append(el);
    }),
    store.on('autosave-resolved', hide),
  ];
  return () => { hide(); for (const o of offs) o(); };
}
