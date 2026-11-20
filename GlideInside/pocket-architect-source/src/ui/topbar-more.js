// A narrow screen (under 600 px) keeps the top bar to one or two rows: Back, the design name, undo and redo, the view switch and Save design stay;
// everything else (file buttons, Find my block, levels, status, roof, Exports, help) moves into a "More" menu. The same elements are moved, so
// every handler and later update keeps working, and they return to their places when the screen widens.
import { h } from './dom.js';
import { icon } from './icons.js';
import { onPhoneChange, isPhoneMode } from '../phone/mode.js';

export const MORE_QUERY = '(max-width: 599.98px)';

export function createTopbarMore(topbar, { keep = [], slot = null, collapse = [], matchMedia = globalThis.matchMedia?.bind(globalThis) } = {}) {
  if (!matchMedia || typeof document === 'undefined') return { dispose() {}, get narrow() { return false; } };
  const mq = matchMedia(MORE_QUERY);
  const btn = h('button', { class: 'ps-btn ps-more-btn', type: 'button', 'aria-haspopup': 'true', 'aria-expanded': 'false', title: 'More', 'aria-label': 'More', dataset: { ps: 'topbar-more' } },
    icon('more', { size: 18 }), h('span', { class: 'ps-btn-text' }, 'More'));
  const pop = h('div', { class: 'ps-more-pop', hidden: true, role: 'group', 'aria-label': 'More', dataset: { ps: 'topbar-more-menu' } });
  const wrap = h('div', { class: 'ps-more-wrap', hidden: true }, btn, pop);
  if (slot && slot.parentNode === topbar) slot.before(wrap); else topbar.append(wrap);
  let obs = null;
  const moved = new Map(); // node -> placeholder comment
  let applying = false;

  const stays = (n) => keep.includes(n) || n === wrap || n === slot || n.classList?.contains('ps-prof-save') || n.classList?.contains('ps-topbar-spacer') || n.classList?.contains('ps-brand') || n.classList?.contains('psp-bar') || n.classList?.contains('ps-phone-share');
  const containers = () => [topbar, ...(slot ? [slot, ...slot.querySelectorAll('.psp-bar')] : [])]; // the premium buttons sit in a .psp-bar inside the slot
  const candidates = () => containers().flatMap((c) => [...c.children]).filter((n) => !stays(n));
  const watched = new Set();
  const watch = () => { if (!obs) return; for (const c of containers()) if (!watched.has(c)) { watched.add(c); obs.observe(c, { childList: true }); } };
  function relocate() {
    if (applying) return;
    applying = true;
    try {
      // Save design stays on the bar even when the profile code puts it beside a button that has moved into the menu.
      for (const sv of pop.querySelectorAll('.ps-prof-save')) (slot?.querySelector('.psp-bar') || slot || topbar).append(sv);
      for (const n of candidates()) {
        const ph = document.createComment('more');
        n.before(ph);
        moved.set(n, ph);
        pop.append(n);
      }
    } finally { applying = false; }
    watch();
  }
  function restore() {
    applying = true;
    try {
      for (const [n, ph] of moved) { if (ph.parentNode) ph.replaceWith(n); else topbar.append(n); }
      moved.clear();
    } finally { applying = false; }
  }
  // Wide screens (600 px and up, no phone mode): the bar stays on ONE row. When it would wrap, the lowest priority buttons (`collapse`, first
  // to go first) move into the same More menu, one at a time, until it fits. They return as soon as there is room.
  const isWrapped = () => {
    const els = [...topbar.querySelectorAll(':scope > *, :scope .psp-bar > *')].filter((e) => !e.hidden && e.offsetParent !== null && !e.classList.contains('ps-topbar-spacer') && !e.classList.contains('psp-sr'));
    const cy = els.map((e) => e.getBoundingClientRect()).filter((r) => r.width > 0 && r.height > 0).map((r) => r.top + r.height / 2);
    return cy.length > 1 && Math.max(...cy) - Math.min(...cy) > 14;
  };
  const resolve = (c) => (typeof c === 'string' ? topbar.querySelector(c) : c);
  function fit(size) {
    if (wanted() || applying) return;
    applying = true;
    try {
      restore();
      wrap.hidden = true;
      size?.();
      for (const c of collapse) {
        if (!isWrapped()) break;
        const n = resolve(c);
        if (!n || n.hidden || !n.isConnected || pop.contains(n)) continue;
        const ph = document.createComment('more');
        n.before(ph);
        moved.set(n, ph);
        pop.append(n);
        wrap.hidden = false;
        topbar.dataset.moreCollapsed = String(moved.size);
        size?.();
      }
      if (!moved.size) delete topbar.dataset.moreCollapsed;
    } finally { applying = false; }
    obs?.takeRecords();
  }
  const setOpen = (on) => { pop.hidden = !on; btn.setAttribute('aria-expanded', String(on)); topbar.dataset.moreOpen = on ? '1' : '0'; };
  // Phone mode (a finger on a window up to 700 px) uses the menu too, so the bar is Back, the name, undo and Save design.
  const wanted = () => mq.matches || isPhoneMode();
  const apply = () => {
    if (wanted()) { topbar.dataset.more = '1'; wrap.hidden = false; relocate(); } else { setOpen(false); delete topbar.dataset.more; wrap.hidden = true; restore(); }
  };
  btn.addEventListener('click', () => setOpen(pop.hidden));
  const onDown = (e) => { if (!pop.hidden && !wrap.contains(e.target) && !e.target.closest?.('.psp-menu,.psp-modal,.ps-modal')) setOpen(false); };
  const onKey = (e) => { if (e.key === 'Escape' && !pop.hidden) { setOpen(false); btn.focus(); } };
  document.addEventListener('pointerdown', onDown, true);
  document.addEventListener('keydown', onKey);
  // Late arrivals (the premium buttons, the help button, a profile button) join the menu too.
  try { obs = new MutationObserver(() => { if (wanted() && !applying) relocate(); }); obs.observe(pop, { childList: true, subtree: true }); watch(); } catch { /* no observer: the next resize catches up */ }
  (mq.addEventListener ? mq.addEventListener('change', apply) : mq.addListener?.(apply));
  const offPhone = onPhoneChange(apply);
  apply();
  return { get narrow() { return wanted(); }, setOpen, fit, dispose() { offPhone(); obs?.disconnect(); document.removeEventListener('pointerdown', onDown, true); document.removeEventListener('keydown', onKey); restore(); wrap.remove(); } };
}
