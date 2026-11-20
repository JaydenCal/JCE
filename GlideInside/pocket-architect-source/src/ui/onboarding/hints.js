// First-use tool hints: a small floating card beside the button with a looping animation, once per tool.

import { createAnim, hasScene, HINT_TEXT, HINT_TITLE } from './anims.js';
import { isPhoneMode } from '../../phone/mode.js';
import { HINT_TEXT_TOUCH } from '../../phone/touch-text.js';
import { findButton, h, placeBeside, planCanvas, readSeen, writeSeen, visible } from './util.js';

export function createHints(ps, { isEnabled, isBusy, layer }) {
  const { store } = ps;
  let card = null;
  let anim = null;
  let anchorEl = null;
  let timer = 0;
  let last = { tool: store.ui.tool, view: store.ui.view };
  const offs = [];

  function close() {
    clearTimeout(timer);
    anim?.stop();
    anim = null;
    card?.remove();
    card = null;
    anchorEl = null;
  }

  function anchorFor(id) {
    if (id === '3d' || id === 'walk') return findButton('view', id);
    if (id === 'wheel') return null;
    const base = ['sliding_door', 'garage_door', 'roller_door', 'opening'].includes(id) ? 'door' : id;
    return findButton('tool', id) || findButton('tool', base);
  }

  // The lot card (its header and body), the fit tips and the other floating cards: a tip never stands over them.
  const avoidRects = () => [...document.querySelectorAll('.lc-root:not([hidden]) .lc-card, .lc-root:not([hidden]) .lc-head, .lc-root:not([hidden]) .lc-pager, .fitcoach, .ps-credit, .ps3d-editbar, .ps-topbar')]
    .filter((n) => n.offsetParent !== null).map((n) => n.getBoundingClientRect()).filter((r) => r.width > 4 && r.height > 4);

  // Place the card clear of the avoid rects. With no room for the full card, the animation goes (the text and Got it stay) and it tries again.
  function placeClear(rect, prefer) {
    card.classList.remove('pso-hint--compact');
    anim?.svg && (anim.svg.style.display = '');
    let side = placeBeside(card, rect, prefer, 14, avoidRects());
    if (side === 'free' && anim?.svg) {
      card.classList.add('pso-hint--compact');
      anim.svg.style.display = 'none';
      side = placeBeside(card, rect, prefer, 14, avoidRects());
    }
    return side;
  }

  function position() {
    if (!card) return;
    const a = anchorEl && visible(anchorEl) ? anchorEl.getBoundingClientRect() : null;
    if (a) {
      const isView = !!anchorEl.dataset?.view;
      placeClear(a, isView ? ['below', 'left'] : ['right', 'below']);
    } else {
      const c = planCanvas()?.getBoundingClientRect();
      const r = c ? { left: c.left + c.width / 2, right: c.left + c.width / 2, top: c.top + 60, bottom: c.top + 60, width: 0, height: 0 } : { left: 300, right: 300, top: 120, bottom: 120, width: 0, height: 0 };
      placeClear(r, ['below']);
    }
  }

  function show(id, { force = false } = {}) {
    if (!hasScene(id)) return false;
    if (!force) {
      if (store.ui.tool === 'drivepi') return false; // the Driveway PI tool has its own hint line: no "Select and move" card over it
      if (!isEnabled() || isBusy() || readSeen().includes(id)) return false;
    }
    close();
    anchorEl = anchorFor(id);
    anim = createAnim(id);
    const gotIt = h('button', { class: 'pso-btn pso-btn--primary', type: 'button', onclick: close }, 'Got it');
    card = h('div', { class: 'pso-card pso-hint', role: 'status', 'aria-label': `${HINT_TITLE[id] || id} tip` },
      anim.svg,
      h('p', { class: 'pso-title' }, HINT_TITLE[id] || id),
      h('p', { class: 'pso-text' }, (isPhoneMode() ? HINT_TEXT_TOUCH[id] : null) || HINT_TEXT[id] || ''),
      h('div', { class: 'pso-row' }, h('span', { class: 'pso-grow' }), gotIt));
    layer.append(card);
    position();
    writeSeen([...readSeen(), id]);
    timer = setTimeout(close, 45000);
    return true;
  }

  const kick = (id) => setTimeout(() => show(id), 0);

  offs.push(store.on('ui', (patch = {}) => {
    if ('tool' in patch && patch.tool !== last.tool) {
      last.tool = patch.tool;
      if (patch.tool === 'drivepi') close(); // a card for the tool just left (e.g. Select and move) goes
      kick(patch.tool);
    }
    if ('view' in patch && patch.view !== last.view) {
      last.view = patch.view;
      // No how-to card over the 3D view (it blocks the model): the tips stay as the small chips at the bottom of the viewer.
      close();
    }
  }));

  const onClick = (e) => {
    const b = e.target.closest?.('[data-tool]');
    if (b && b.dataset.tool) kick(b.dataset.tool);
  };
  document.addEventListener('click', onClick, true);
  const onKey = (e) => {
    if (e.key === 'Escape' && card) close();
  };
  window.addEventListener('keydown', onKey);
  window.addEventListener('resize', position);

  return {
    show,
    close,
    dispose() {
      close();
      offs.forEach((o) => o?.());
      document.removeEventListener('click', onClick, true);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', position);
    },
  };
}
