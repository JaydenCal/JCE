// A bottom sheet: a scrim, a grab bar, a title with a Close button, and a scrolling body. Used by the phone menu, tools and the flow menu.
import { h } from '../ui/dom.js';

export function openSheet({ title, body, onClose = null, id = 'phone-sheet', host = document.body }) {
  const prev = document.activeElement;
  const close = () => {
    document.removeEventListener('keydown', onKey, true);
    scrim.remove();
    sheet.remove();
    try { prev?.focus?.({ preventScroll: true }); } catch { /* gone */ }
    onClose?.();
  };
  const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  const scrim = h('div', { class: 'ps-sheet-scrim', dataset: { ps: `${id}-scrim` }, onclick: close });
  const closeBtn = h('button', { class: 'ps-sheet-close', type: 'button', 'aria-label': 'Close', dataset: { ps: `${id}-close` }, onclick: close }, 'Close');
  const sheet = h('div', { class: 'ps-sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': title, dataset: { ps: id } },
    h('div', { class: 'ps-sheet-grab', 'aria-hidden': 'true' }),
    h('div', { class: 'ps-sheet-head' }, h('h2', null, title), closeBtn),
    h('div', { class: 'ps-sheet-body' }, body));
  host.append(scrim, sheet);
  document.addEventListener('keydown', onKey, true);
  closeBtn.focus({ preventScroll: true });
  return { close, el: sheet };
}

/** A big list button for a sheet. */
export const sheetButton = ({ label, hint = '', ps, onClick, pressed = null, ic = null }) => h('button', { class: 'ps-sheet-item', type: 'button', ...(pressed == null ? {} : { 'aria-pressed': String(pressed) }), dataset: ps ? { ps } : undefined, onclick: onClick },
  ic, h('span', { class: 'ps-sheet-item-t' }, h('b', null, label), hint ? h('small', null, hint) : null));
