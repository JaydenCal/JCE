// The builder's lot planner controls for Pocket Architect: drag the whole house on the lot, turn it with a ring handle (1 degree
// steps, 15 with Shift), mirror it, face the garage to the street, and read the clearance to every boundary live (green inside
// the indicative setback envelope, red outside, grey when no setback is loaded). The lot, setbacks, road and driveway are drawn
// by the 2D editor from the project being previewed (src/editor2d/draw-lotplan.js), so they stay in step as the house moves.
//
// One session works for both uses:
//   startPlacement (placement.js)  merges a library house into the design:  apply = (p, pose) => placeHouse(p, house, pose)
//   startArrange   (arrange.js)    moves the design that is already open:    apply = (p, pose) => arrangeApply(p, base, pose)
// Nothing changes in the design until Place or Done, which commits ONE undo step. Mirroring changes the house only: the lot is
// not part of the design geometry, so it can never be mirrored with the house.

import { h } from '../ui/dom.js';
import { clearances, clearanceText, deriveDriveway, faceGarageAngle } from '../site/lotplan.js';
import { ringOf, OK, BAD, UNKNOWN } from '../editor2d/draw-lotplan.js';
import { lotOf } from '../model/placement.js';
import { injectStripStyles } from './app-strip-styles.js';

const CSS = `
.pas-pose{position:absolute;right:12px;top:12px;z-index:30;background:var(--ps-panel,#fff);border:1px solid var(--ps-border-strong,#b6b8bd);border-radius:var(--ps-radius-lg,6px);box-shadow:var(--ps-shadow,0 10px 30px rgba(0,0,0,.2));padding:10px 12px;display:grid;gap:8px;width:min(320px,calc(100% - 24px));font:500 13px var(--ps-font-ui,system-ui,sans-serif);color:var(--ps-text,#1a1c20)}
.pas-pose h3{margin:0;font:700 14px var(--ps-font-ui,system-ui,sans-serif)}
.pas-pose p{margin:0;color:var(--ps-muted,#5a5e66);font-size:12px}
.pas-pose .pas-row{justify-content:flex-start;align-items:center;gap:6px}
.pas-pose .pas-row.pas-end{justify-content:flex-end}
.pas-pose input[type=number]{width:70px;font:500 13px var(--ps-font-ui,system-ui,sans-serif);min-height:30px;border:1px solid var(--ps-border-strong,#b6b8bd);border-radius:5px;padding:0 6px}
.pas-clr{display:grid;gap:3px;margin:0;padding:0;list-style:none}
.pas-clr li{display:flex;justify-content:space-between;gap:8px;align-items:center;font-size:12.5px}
.pas-clr li b{font-weight:700;font-variant-numeric:tabular-nums}
.pas-dot{display:inline-block;width:9px;height:9px;border-radius:50%;margin-right:6px;vertical-align:baseline}
.pas-fit{font-weight:700;font-size:12.5px}
`;

const injectPoseStyles = () => {
  injectStripStyles();
  if (document.getElementById('pas-pose-styles')) return;
  const el = document.createElement('style');
  el.id = 'pas-pose-styles';
  el.textContent = CSS;
  document.head.append(el);
};

export const normDeg = (d) => {
  const v = (((d % 360) + 540) % 360) - 180; // -180 up to (not including) 180
  return v === -180 ? 180 : v;
};

/** Snap an angle in degrees: whole degrees, or multiples of 15 with Shift. */
export const snapAngle = (deg, shift = false) => (shift ? Math.round(deg / 15) * 15 : Math.round(deg));

const KIND_ORDER = { front: 0, secondaryFront: 1, side: 2, rear: 3, unknown: 4 };
const KIND_NAME = { front: 'Front', secondaryFront: 'Secondary front', side: 'Side', rear: 'Rear', unknown: 'Edge' };

/** Text and colour for the summary line under the clearances. */
export function fitSummary(c) {
  if (!c || c.status === 'no_lot' || c.status === 'no_building') return { text: '', colour: UNKNOWN, state: 'none' };
  if (c.status === 'unknown') return { text: 'Setbacks are not loaded for this lot. Distances are shown without a limit.', colour: UNKNOWN, state: 'unknown' };
  if (c.status === 'breach') {
    const over = c.rows.filter((r) => r.status === 'outside').map((r) => `${KIND_NAME[r.kind] || 'Edge'} by ${r.shortByM.toFixed(2)} m`);
    return { text: `Outside the indicative setback envelope: ${over.join('; ')}.`, colour: BAD, state: 'outside' };
  }
  return { text: 'Inside the indicative setback envelope.', colour: OK, state: 'inside' };
}

/**
 * runPoseSession({ store, editor, host, title, apply, initialPose, getBase, lot, fit, commitLabel, onDone, onCancel })
 * apply(project, pose) mutates a copy to show the pose; pose is { x, y, rotation, mirrored }.
 * Returns { setPose, getPose, commit, cancel, preview }.
 */
export function runPoseSession({ store, editor, host = document.getElementById('ps-stage'), title, apply, initialPose, describe = '', fit = null, commitLabel = 'Place house', commitText = 'Place house', onDone, onCancel }) {
  injectPoseStyles();
  store.setUI({ view: '2d' });
  let pose = { rotation: 0, mirrored: false, ...initialPose };
  let preview = null;
  const hasLot = () => !!lotOf(store.project);

  const live = h('div', { class: 'pas-sr', role: 'status', 'aria-live': 'polite' });
  const catcher = h('div', { class: 'pas-catch', 'aria-hidden': 'true' });
  const rotInput = h('input', { type: 'number', min: '-180', max: '180', step: '1', value: String(pose.rotation || 0), 'aria-label': 'Rotation in degrees clockwise', onchange: () => setPose({ rotation: normDeg(Number(rotInput.value) || 0) }) });
  const btn = (label, fn, cls = '', attrs = {}) => h('button', { class: `pas-btn ${cls}`.trim(), type: 'button', onclick: fn, ...attrs }, label);
  const clrList = h('ul', { class: 'pas-clr', 'aria-label': 'Clearance to each boundary' });
  const fitLine = h('div', { class: 'pas-fit' });
  const driveLine = h('p');
  const fitBadge = fit?.badge ? h('p', null, `Fit ranking: ${fit.badge}${fit.reason ? `. ${fit.reason}.` : '.'}`) : null;
  const mirrorBtn = btn('Mirror', () => setPose({ mirrored: !pose.mirrored }), '', { 'aria-pressed': 'false' });
  const faceBtn = btn('Face garage to street', () => {
    const a = faceGarageAngle(preview || store.project);
    if (a == null) { live.textContent = 'No garage door or street frontage to face.'; return; }
    setPose({ rotation: normDeg((pose.rotation || 0) + a) });
  });
  const panel = h('div', { class: 'pas-pose', role: 'group', 'aria-label': title },
    h('h3', null, title),
    h('p', null, describe || 'Drag the house to move it. Drag the gold handle to turn it. Arrow keys nudge 0.5 m (Shift 0.1 m). Q and E turn 15 degrees.'),
    h('div', { class: 'pas-row' }, btn('↶ 15°', () => turn(-15)), btn('15° ↷', () => turn(15)), btn('↶ 1°', () => turn(-1)), btn('1° ↷', () => turn(1))),
    h('div', { class: 'pas-row' }, btn('Turn 90°', () => turn(90)), mirrorBtn, h('label', { style: { display: 'flex', alignItems: 'center', gap: '4px' } }, rotInput, '°')),
    h('div', { class: 'pas-row' }, faceBtn),
    clrList, fitLine, driveLine, fitBadge,
    h('div', { class: 'pas-row pas-end' }, btn('Cancel', () => cancel()), btn(commitText, () => commit(), 'pas-btn--primary')),
    live);
  host.append(catcher, panel);

  const turn = (d) => setPose({ rotation: normDeg(Math.round(pose.rotation || 0) + d) });

  function paint() {
    rotInput.value = String(Math.round(pose.rotation || 0));
    mirrorBtn.setAttribute('aria-pressed', String(!!pose.mirrored));
    mirrorBtn.style.background = pose.mirrored ? 'var(--ps-accent-soft,#e6ecfb)' : '';
    while (clrList.firstChild) clrList.firstChild.remove();
    if (!preview || !hasLot()) {
      fitLine.textContent = '';
      driveLine.textContent = '';
      return;
    }
    const c = clearances(preview);
    const rows = [...c.rows].sort((a, b) => (KIND_ORDER[a.kind] ?? 9) - (KIND_ORDER[b.kind] ?? 9) || a.edge - b.edge).filter((r) => r.kind !== 'unknown' || c.rows.every((x) => x.kind === 'unknown'));
    for (const r of rows) {
      const col = r.status === 'outside' ? BAD : r.status === 'inside' ? OK : UNKNOWN;
      clrList.append(h('li', null,
        h('span', null, h('i', { class: 'pas-dot', style: { background: col } }), KIND_NAME[r.kind] || 'Edge'),
        h('span', null, h('b', { style: { color: col } }, `${r.clearanceM.toFixed(2)} m`), r.requiredM != null ? ` of ${r.requiredM.toFixed(1)} m${r.flagged ? ' (check)' : ''}` : '')));
    }
    const s = fitSummary(c);
    fitLine.textContent = s.text;
    fitLine.style.color = s.colour;
    const d = deriveDriveway(preview);
    driveLine.textContent = d?.ok ? `Driveway ${(d.widthMm / 1000).toFixed(1)} m wide, ${(d.lengthMm / 1000).toFixed(1)} m long to the kerb.` : d?.reason === 'door_faces_away' ? 'The garage door does not face the street.' : '';
  }

  function draw() {
    preview = editor.previewProject?.((p) => apply(p, pose)) || null;
    editor.setOverlay?.({ arrange: true, rotation: pose.rotation || 0 });
    paint();
  }
  function setPose(patch) {
    pose = { ...pose, ...patch };
    draw();
    live.textContent = `Position ${(pose.x / 1000).toFixed(1)} m, ${(pose.y / 1000).toFixed(1)} m, rotation ${Math.round(pose.rotation || 0)} degrees${pose.mirrored ? ', mirrored' : ''}`;
  }

  // Pointer: drag the ring handle to turn, drag anywhere else to move.
  let drag = null;
  const rel = (e) => {
    const r = catcher.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  catcher.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    const v = editor.getView?.() || { scale: 0.05, ox: 0, oy: 0 };
    const ring = preview && ringOf(preview, pose.rotation || 0);
    const s = rel(e);
    if (ring) {
      const hs = { x: ring.handle.x * v.scale + v.ox, y: ring.handle.y * v.scale + v.oy };
      if (Math.hypot(hs.x - s.x, hs.y - s.y) <= 16) drag = { mode: 'rotate' };
    }
    if (!drag) drag = { mode: 'move', x: e.clientX, y: e.clientY };
    catcher.setPointerCapture?.(e.pointerId);
    e.preventDefault();
  });
  catcher.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const v = editor.getView?.() || { scale: 0.05, ox: 0, oy: 0 };
    if (drag.mode === 'rotate') {
      const ring = preview && ringOf(preview, pose.rotation || 0);
      if (!ring) return;
      const s = rel(e);
      const c = { x: ring.centre.x * v.scale + v.ox, y: ring.centre.y * v.scale + v.oy };
      const a = (Math.atan2(s.y - c.y, s.x - c.x) * 180) / Math.PI; // handle sits at -90 degrees when the rotation is 0
      setPose({ rotation: normDeg(snapAngle(a + 90, e.shiftKey)) });
      return;
    }
    const dx = (e.clientX - drag.x) / v.scale;
    const dy = (e.clientY - drag.y) / v.scale;
    drag = { mode: 'move', x: e.clientX, y: e.clientY };
    setPose({ x: Math.round(pose.x + dx), y: Math.round(pose.y + dy) });
  });
  const endDrag = () => { drag = null; };
  catcher.addEventListener('pointerup', endDrag);
  catcher.addEventListener('pointercancel', endDrag);

  const onKey = (e) => {
    const t = e.target;
    const typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT');
    const step = e.shiftKey ? 100 : 500;
    const move = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
    if (e.key === 'Escape' && !document.querySelector('.pas-modal')) cancel();
    else if (!typing && move) setPose({ x: pose.x + move[0], y: pose.y + move[1] });
    else if (!typing && (e.key === 'q' || e.key === 'Q')) turn(e.shiftKey ? -1 : -15);
    else if (!typing && (e.key === 'e' || e.key === 'E')) turn(e.shiftKey ? 1 : 15);
    else if (!typing && (e.key === ',' || e.key === '.')) turn((e.key === '.' ? 1 : -1) * (e.shiftKey ? 1 : 15));
    else if (!typing && (e.key === 'r' || e.key === 'R')) turn(90);
    else if (!typing && e.key === 'Enter' && !(t && t.tagName === 'BUTTON')) commit();
    else return;
    e.preventDefault();
    e.stopPropagation();
  };
  document.addEventListener('keydown', onKey, true);

  function teardown() {
    document.removeEventListener('keydown', onKey, true);
    editor.clearPreview?.();
    editor.setOverlay?.(null);
    catcher.remove();
    panel.remove();
  }
  function commit() {
    teardown();
    let record = null;
    store.apply(commitLabel, (p) => { record = apply(p, pose); });
    onDone?.({ record, pose });
  }
  function cancel() {
    teardown();
    onCancel?.();
  }
  draw();
  panel.querySelector('.pas-btn--primary')?.focus({ preventScroll: true });
  return { setPose, getPose: () => ({ ...pose }), commit, cancel, preview: () => preview, text: () => clearanceText(clearances(preview || store.project).byKind.front) };
}
