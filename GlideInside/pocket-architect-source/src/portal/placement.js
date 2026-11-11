// Interactive placement of a library house on the lot: drag to move, rotate with the buttons or keys, then Place.
// The preview is drawn by the 2D editor from a copy (editor.previewProject); nothing changes in the design until Place,
// which commits placeHouse as ONE undo step. After that the house is ordinary walls, rooms and openings: fully editable.

import { h } from '../ui/dom.js';
import { placeHouse, defaultPose, fitsLot, houseBounds } from './place-house.js';

/**
 * startPlacement({ store, editor, house, lot, onDone, onCancel }) returns { setPose, getPose, commit, cancel }.
 * `lot` is optional { widthMm, depthMm } for the "does not fit" warning (the lot feature supplies it later).
 */
export function startPlacement({ store, editor, house, lot = null, host = document.getElementById('ps-stage'), onDone, onCancel, initialPose = null } = {}) {
  store.setUI({ view: '2d' });
  const base = structuredClone(store.project);
  // Start in the middle of what the person is looking at, or beside the existing plan.
  let pose = initialPose || defaultPose(base, house);
  if (!initialPose) {
    const v = editor.getView?.();
    const el = document.getElementById('ps-plan-host');
    if (v && el && v.scale) {
      const r = el.getBoundingClientRect();
      pose = { ...pose, x: Math.round((r.width / 2 - v.ox) / v.scale), y: Math.round((r.height / 2 - v.oy) / v.scale) };
    }
  }
  const b = houseBounds(house);
  const live = h('div', { class: 'pas-sr', role: 'status', 'aria-live': 'polite' });
  const warn = h('span', { class: 'pas-warn', hidden: true }, 'This house is larger than the lot.');
  const rotInput = h('input', { type: 'number', min: '-180', max: '180', step: '1', value: String(pose.rotation || 0), 'aria-label': 'Rotation in degrees clockwise', onchange: () => setPose({ rotation: normDeg(Number(rotInput.value) || 0) }) });
  const catcher = h('div', { class: 'pas-catch', 'aria-hidden': 'true' });
  const btn = (label, fn, cls = '') => h('button', { class: `pas-btn ${cls}`.trim(), type: 'button', onclick: fn }, label);
  const panel = h('div', { class: 'pas-place', role: 'group', 'aria-label': `Place ${house.name || 'house'}` },
    h('h3', null, `Place ${house.name || 'house'}`),
    h('p', { style: { margin: 0, color: 'var(--ps-muted,#5a5e66)' } }, `${(b.width / 1000).toFixed(1)} x ${(b.depth / 1000).toFixed(1)} m. Drag on the plan to move it. Arrow keys nudge (Shift for 1 m). , and . turn it.`),
    h('div', { class: 'pas-row' },
      btn('↶ 15°', () => setPose({ rotation: normDeg((pose.rotation || 0) - 15) })), btn('15° ↷', () => setPose({ rotation: normDeg((pose.rotation || 0) + 15) })),
      btn('Turn 90°', () => setPose({ rotation: normDeg((pose.rotation || 0) + 90) })),
      h('label', { style: { display: 'flex', alignItems: 'center', gap: '6px' } }, 'Rotation', rotInput, '°'), warn),
    h('div', { class: 'pas-row pas-end' }, btn('Cancel', () => cancel()), btn('Place house', () => commit(), 'pas-btn--primary')),
    live);
  host.append(catcher, panel);

  const normDeg = (d) => ((((d % 360) + 540) % 360) - 180 || 180);
  function draw() {
    editor.previewProject?.((p) => placeHouse(p, house, pose));
    rotInput.value = String(Math.round(pose.rotation || 0));
    warn.hidden = fitsLot(house, pose, lot);
  }
  function setPose(patch) {
    pose = { ...pose, ...patch };
    draw();
    live.textContent = `Position ${(pose.x / 1000).toFixed(1)} m, ${(pose.y / 1000).toFixed(1)} m, rotation ${Math.round(pose.rotation || 0)} degrees`;
  }

  // Drag anywhere on the plan to move the house by the pointer movement.
  let drag = null;
  catcher.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    drag = { x: e.clientX, y: e.clientY };
    catcher.setPointerCapture?.(e.pointerId);
    e.preventDefault();
  });
  catcher.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const v = editor.getView?.() || { scale: 0.05 };
    const dx = (e.clientX - drag.x) / v.scale;
    const dy = (e.clientY - drag.y) / v.scale;
    drag = { x: e.clientX, y: e.clientY };
    setPose({ x: Math.round(pose.x + dx), y: Math.round(pose.y + dy) });
  });
  const endDrag = () => { drag = null; };
  catcher.addEventListener('pointerup', endDrag);
  catcher.addEventListener('pointercancel', endDrag);

  const onKey = (e) => {
    const t = e.target;
    const typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT');
    const step = e.shiftKey ? 1000 : 100;
    const move = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
    if (e.key === 'Escape' && !document.querySelector('.pas-modal')) cancel();
    else if (!typing && move) setPose({ x: pose.x + move[0], y: pose.y + move[1] });
    else if (!typing && (e.key === ',' || e.key === '.')) setPose({ rotation: normDeg((pose.rotation || 0) + (e.key === '.' ? 1 : -1) * (e.shiftKey ? 1 : 15)) });
    else if (!typing && (e.key === 'r' || e.key === 'R')) setPose({ rotation: normDeg((pose.rotation || 0) + 90) });
    else if (!typing && e.key === 'Enter' && !(t && t.tagName === 'BUTTON')) commit();
    else return;
    e.preventDefault();
    e.stopPropagation();
  };
  document.addEventListener('keydown', onKey, true);

  function teardown() {
    document.removeEventListener('keydown', onKey, true);
    editor.clearPreview?.();
    catcher.remove();
    panel.remove();
  }
  function commit() {
    teardown();
    let record = null;
    store.apply('Place house', (p) => {
      record = placeHouse(p, house, pose);
    });
    onDone?.({ record, pose });
  }
  function cancel() {
    teardown();
    onCancel?.();
  }
  draw();
  panel.querySelector('.pas-btn--primary')?.focus({ preventScroll: true });
  return { setPose, getPose: () => ({ ...pose }), commit, cancel };
}
