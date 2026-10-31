// Guided first-use tour: spotlight cut-out, a small card and interactive steps detected from store events.

import { createAnim } from './anims.js';
import { findButton, h, isTyping, planCanvas, placeBeside, visible, clamp } from './util.js';

const lv = (ps) => ps.store.level();
const pickFurniture = (ps) => lv(ps).furniture[0] || null;

function furnitureRect(ps, f) {
  const ed = ps.editor;
  if (!f || !ed?.toClient) return null;
  const size = ed.furnSize?.(f) || { w: 800, d: 800 };
  const scale = ed.getView?.().scale || 0.1;
  const c = ed.toClient({ x: f.x, y: f.y });
  const half = Math.max(size.w, size.d) / 2 * scale + 8;
  return { left: c.x - half, top: c.y - half, width: half * 2, height: half * 2 };
}

function pickWall(ps) {
  const walls = lv(ps).walls;
  let best = null;
  let len = 0;
  for (const w of walls) {
    if (w.kind === 'interior') continue;
    const l = Math.hypot(w.b.x - w.a.x, w.b.y - w.a.y);
    if (l > len) { len = l; best = w; }
  }
  return best || walls[0] || null;
}

function wallRect(ps, w) {
  const ed = ps.editor;
  if (!w || !ed?.toClient) return null;
  const a = ed.toClient(w.a);
  const b = ed.toClient(w.b);
  const left = Math.min(a.x, b.x) - 14;
  const top = Math.min(a.y, b.y) - 14;
  return { left, top, width: Math.max(Math.abs(a.x - b.x) + 28, 44), height: Math.max(Math.abs(a.y - b.y) + 28, 44) };
}

const wallSig = (ps) => JSON.stringify(lv(ps).walls.map((w) => [w.a.x, w.a.y, w.b.x, w.b.y]));
const furnSig = (ps) => JSON.stringify(lv(ps).furniture.map((f) => [f.id, f.x, f.y]));
const rotSig = (ps) => JSON.stringify(lv(ps).furniture.map((f) => [f.id, f.rotation]));
const count = (ps, key, fn = () => true) => lv(ps)[key].filter(fn).length;

function canvasRect() {
  const c = planCanvas()?.getBoundingClientRect();
  if (!c) return null;
  const w = Math.min(c.width * 0.5, 420);
  const hh = Math.min(c.height * 0.5, 300);
  return { left: c.left + (c.width - w) / 2, top: c.top + (c.height - hh) / 2, width: w, height: hh };
}

export function buildSteps(ps) {
  const btn = (kind, id) => () => {
    const b = findButton(kind, id);
    return b && visible(b) ? b : null;
  };
  return [
    {
      id: 'move', anim: 'select', view: '2d', title: 'Move a piece of furniture',
      text: 'Click a piece of furniture to select it, then drag it somewhere new.',
      target: () => furnitureRect(ps, pickFurniture(ps)) || canvasRect(),
      init: () => furnSig(ps),
      test: (base) => furnSig(ps) !== base,
      events: ['project'],
    },
    {
      id: 'rotate', anim: 'furniture', view: '2d', title: 'Rotate it',
      text: 'With the piece selected, press comma to turn it one way and full stop to turn it the other way.',
      target: () => furnitureRect(ps, pickFurniture(ps)) || canvasRect(),
      init: () => rotSig(ps),
      test: (base) => rotSig(ps) !== base,
      events: ['project'],
    },
    {
      id: 'wheel', anim: 'wheel', view: '2d', title: 'Open the furniture wheel',
      text: 'Press Q over the plan to open the wheel of items already in your design, then pick one.',
      target: () => canvasRect(),
      init: () => 0,
      test: (_b, ev) => ev?.type === 'keydown' && ev.key?.toLowerCase() === 'q',
      events: [],
      keys: true,
    },
    {
      id: 'resize', view: '2d', title: 'Drag a wall to resize a room',
      text: 'With Select active, drag a wall to move it. Connected walls stretch with it. Drag a wall end to change its length.',
      target: () => wallRect(ps, pickWall(ps)) || canvasRect(),
      init: () => wallSig(ps),
      test: (base) => wallSig(ps) !== base,
      events: ['project'],
    },
    {
      id: 'room', anim: 'room', view: '2d', title: 'Draw a room',
      text: 'Choose the Room tool, then drag a rectangle on an empty part of the plan.',
      target: btn('tool', 'room'),
      init: () => count(ps, 'rooms'),
      test: (base) => count(ps, 'rooms') > base,
      events: ['project'],
    },
    {
      id: 'window', anim: 'window', view: '2d', title: 'Add a window',
      text: 'Choose the Window tool, hover a wall and click to place it.',
      target: btn('tool', 'window'),
      init: () => count(ps, 'openings', (o) => o.kind === 'window'),
      test: (base) => count(ps, 'openings', (o) => o.kind === 'window') > base,
      events: ['project'],
    },
    {
      id: 'view3d', anim: '3d', title: 'Switch to 3D',
      text: 'Choose 3D at the top. Drag to orbit and scroll to zoom.',
      target: btn('view', '3d'),
      init: () => 0,
      test: () => ps.store.ui.view === '3d',
      events: ['ui'],
    },
    {
      id: 'finish', view: '3d', title: 'Change a wall finish',
      text: 'Click a wall in the 3D view, then pick a new finish in the Properties panel.',
      target: () => {
        const r = document.getElementById('ps-3d-host')?.getBoundingClientRect();
        return r && r.width ? { left: r.left + r.width * 0.2, top: r.top + r.height * 0.2, width: r.width * 0.6, height: r.height * 0.6 } : canvasRect();
      },
      init: () => ps.store.ui.selection,
      test: (base, ev) => (ev?.type === 'selection' && !!ps.store.ui.selection && ps.store.ui.selection !== base) || (ev?.type === 'project' && /finish|colour|color|clad|material/i.test(ev.label || '')),
      events: ['selection', 'project'],
    },
    {
      id: 'walk', anim: 'walk', title: 'Walk through it',
      text: 'Choose Walk at the top, then use W, A, S and D to move. Hold E near a door to open it.',
      target: btn('view', 'walk'),
      init: () => 0,
      test: () => ps.store.ui.view === 'walk',
      events: ['ui'],
    },
  ];
}

export function createTour(ps, { layer, onFinish, onActive }) {
  const { store } = ps;
  const steps = buildSteps(ps);
  let i = -1;
  let spot = null;
  let card = null;
  let anim = null;
  let poll = 0;
  let advTimer = 0;
  let detach = [];
  let active = false;

  const cleanupStep = () => {
    clearTimeout(advTimer);
    detach.forEach((d) => d());
    detach = [];
    anim?.stop();
    anim = null;
  };

  function end(completed) {
    if (!active) return;
    active = false;
    cleanupStep();
    clearInterval(poll);
    window.removeEventListener('resize', place);
    window.removeEventListener('keydown', onKey, true);
    spot?.remove();
    card?.remove();
    spot = card = null;
    onActive?.(false);
    onFinish?.(completed);
  }

  function onKey(e) {
    if (e.key === 'Escape' && !isTyping(e.target)) {
      e.stopPropagation();
      end(false);
    }
  }

  function place() {
    if (!active || !card) return;
    const step = steps[i];
    let r = null;
    try {
      const t = step.target?.();
      if (t?.getBoundingClientRect) r = t.getBoundingClientRect();
      else if (t) r = { left: t.left, top: t.top, width: t.width, height: t.height, right: t.left + t.width, bottom: t.top + t.height };
    } catch { r = null; }
    if (r && (r.width <= 0 || r.height <= 0)) r = null;
    if (!r) {
      spot.dataset.none = 'true';
      card.dataset.centre = 'true';
      card.style.left = card.style.top = '';
      return;
    }
    spot.dataset.none = 'false';
    const pad = 6;
    const left = clamp(r.left - pad, -4, window.innerWidth);
    const top = clamp(r.top - pad, -4, window.innerHeight);
    spot.style.left = `${left}px`;
    spot.style.top = `${top}px`;
    spot.style.width = `${r.width + pad * 2}px`;
    spot.style.height = `${r.height + pad * 2}px`;
    delete card.dataset.centre;
    placeBeside(card, { left, top, right: left + r.width + pad * 2, bottom: top + r.height + pad * 2, width: r.width + pad * 2, height: r.height + pad * 2 }, ['right', 'left', 'below', 'above']);
  }

  function go(n) {
    cleanupStep();
    if (n >= steps.length) return end(true);
    i = Math.max(0, n);
    const step = steps[i];
    if (step.view && store.ui.view !== step.view) store.setUI({ view: step.view });
    const base = step.init?.();
    anim = step.anim ? createAnim(step.anim) : null;
    const last = i === steps.length - 1;
    const next = h('button', { class: 'pso-btn pso-btn--primary', type: 'button', onclick: () => go(i + 1) }, last ? 'Finish' : 'Next');
    const back = h('button', { class: 'pso-btn', type: 'button', disabled: i === 0, onclick: () => go(i - 1) }, 'Back');
    const skip = h('button', { class: 'pso-link', type: 'button', onclick: () => end(false) }, 'Skip');
    const nc = h('div', { class: 'pso-card', role: 'dialog', 'aria-label': 'Guided tour' },
      h('p', { class: 'pso-step' }, h('span', null, `Step ${i + 1} of ${steps.length}`), h('span', { class: 'pso-tick' }, 'Done')),
      anim?.svg,
      h('p', { class: 'pso-title' }, step.title),
      h('p', { class: 'pso-text' }, step.text),
      h('div', { class: 'pso-row' }, skip, h('span', { class: 'pso-grow' }), back, next));
    card?.replaceWith(nc);
    if (!card) layer.append(nc);
    card = nc;
    place();
    const fire = (ev) => {
      if (!active || steps[i] !== step || card.dataset.done === 'true') return;
      let ok = false;
      try { ok = step.test(base, ev); } catch { ok = false; }
      if (!ok) return;
      card.dataset.done = 'true';
      advTimer = setTimeout(() => active && steps[i] === step && go(i + 1), 1100);
    };
    for (const evt of step.events || []) detach.push(store.on(evt, (d) => fire({ type: evt, ...(d && typeof d === 'object' ? d : {}) })));
    if (step.keys) {
      const kd = (e) => !isTyping(e.target) && fire({ type: 'keydown', key: e.key });
      window.addEventListener('keydown', kd);
      detach.push(() => window.removeEventListener('keydown', kd));
    }
    next.focus({ preventScroll: true });
  }

  return {
    start() {
      if (active) end(false);
      active = true;
      onActive?.(true);
      spot = h('div', { class: 'pso-spot', 'data-none': 'true' });
      layer.append(spot);
      window.addEventListener('resize', place);
      window.addEventListener('keydown', onKey, true);
      poll = setInterval(place, 250);
      go(0);
    },
    stop: () => end(false),
    isActive: () => active,
    stepCount: steps.length,
    goTo: (n) => active && go(n),
    dispose: () => end(false),
  };
}
