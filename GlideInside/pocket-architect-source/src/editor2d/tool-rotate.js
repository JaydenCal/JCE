// Rotate tool (key O), residential and commercial. Click an item (house, building, strata units or estate, car park, hardstand, road, driveway,
// waste enclosure, furniture) and drag round the pivot to turn it; the whole development is the A key or the panel button. Ctrl or Cmd and click
// adds or removes an item from the selection. A pivot marker, a protractor arc and a live angle readout follow the drag. The turn snaps to 15
// degrees, to 1 degree with Shift, and lands square to the nearest lot boundary or the street frontage when close (Shift turns that off).
// Alt and click (or the Pick pivot button) puts the pivot where you click. The panel types an exact angle and has -90, -15, +15, +90, Align to
// frontage and Align to nearest boundary. One undo step per turn. Comma and full stop turn 90 (15 with Shift), Q and E 1 degree, Shift and scroll
// 15 degrees a notch. Escape clears the pivot, then the selection, then leaves the tool. The maths is in rotate-logic.js.

import { tt } from '../phone/touch-text.js';
import { h } from '../ui/dom.js';
import { rotationStep } from './tools-meta.js';
import {
  accumulate, angleFrom, alignDelta, applyTurn, centreOf, describeSelection, expand, groupTargets, lotAlignments, orientationOf, pickTarget, pointsOf, sameTarget,
  selectionLabel, snapTurn,
} from './rotate-logic.js';

const DRAG_START_PX = 3;
const MIN_RADIUS_PX = 24;
const PIVOT_SNAP_PX = 14;
const GOLD = '#c7a256';
const GOLD_SOFT = 'rgba(199,162,86,0.22)';

const fmt = (d) => { const v = Math.round(d * 10) / 10; return `${v > 0 ? '+' : ''}${Number.isInteger(v) ? v.toFixed(0) : v.toFixed(1)}°`; };

function hullOf(pts) {
  const p = [...pts].sort((a, b) => a.x - b.x || a.y - b.y);
  if (p.length < 3) return p;
  const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lo = []; for (const q of p) { while (lo.length >= 2 && cross(lo.at(-2), lo.at(-1), q) <= 0) lo.pop(); lo.push(q); }
  const up = []; for (const q of [...p].reverse()) { while (up.length >= 2 && cross(up.at(-2), up.at(-1), q) <= 0) up.pop(); up.push(q); }
  return lo.slice(0, -1).concat(up.slice(0, -1));
}

export function createRotateTool(ed) {
  const { store } = ed;
  let sel = []; // [{ kind, id? }]
  let pivot = null; // world point; null until the selection is made, then the middle of it
  let custom = false; // the pivot was picked by hand
  let picking = false; // the next click sets the pivot
  let drag = null;
  let over = false;
  let box = null;
  let chip = null;
  let els = {};

  const ctx = () => ({ furnSize: ed.furnSize, tolMm: 12 / ed.view.scale, hitFurniture: (w) => ed.hit(w, ['furniture', 'stairs']) });
  const project = () => ed.project();
  const lines = () => lotAlignments(store.project);
  const primaryBase = () => { const t = expand(store.project, sel)[0]; return t ? orientationOf(store.project, t) : 0; };
  const selected = (t) => expand(store.project, sel).some((x) => sameTarget(x, t));
  const ensurePivot = () => { if (!pivot && sel.length) pivot = centreOf(store.project, sel, ctx()); return pivot; };
  const angleAt = (s) => { const c = ed.toScreen(pivot); return angleFrom(c, s); };
  const labelFor = () => selectionLabel(store.project, sel);

  function setSel(next, { keepPivot = false } = {}) {
    sel = next;
    if (!keepPivot) { pivot = null; custom = false; }
    if (sel.length) ensurePivot();
    sync();
    ed.draw();
  }

  // Turning ---------------------------------------------------------------------------------------------------------------------------
  function commit(deg, why = 'Rotate') {
    if (!sel.length || !Number.isFinite(deg) || Math.abs(deg) < 1e-9) return false;
    const pv = ensurePivot();
    const ok = ed.apply(`${why} ${labelFor().toLowerCase()}`, (p) => { applyTurn(p, sel, deg, pv, ctx()); });
    sync();
    return ok !== null;
  }

  function snapPivotPoint(ev) {
    const pts = [...expand(store.project, sel).flatMap((t) => pointsOf(store.project, t, ctx())), ...(store.project.site?.lot?.boundary || [])];
    const c = sel.length ? centreOf(store.project, sel, ctx()) : null;
    if (c) pts.push(c);
    let best = null;
    for (const q of pts) {
      const s = ed.toScreen(q);
      const d = Math.hypot(s.x - ev.screen.x, s.y - ev.screen.y);
      if (d <= PIVOT_SNAP_PX && (!best || d < best.d)) best = { d, q };
    }
    const w = best ? best.q : ev.world;
    return { x: Math.round(w.x), y: Math.round(w.y) };
  }

  function turnFromPointer(ev) {
    const raw = accumulate(drag.total, drag.prev, angleAt(ev.screen) - drag.a0);
    drag.total = raw.total;
    drag.prev = raw.prev;
    const s = snapTurn(drag.total, { shift: ev.shift, base: drag.base, lines: drag.lines });
    drag.snap = s.snap;
    drag.screen = ev.screen;
    drag.snapIndex = s.index;
    if (s.deg !== drag.deg) {
      // Live: the project itself turns while dragging, so the 3D view follows. Each update undoes the last one of this drag and applies the
      // new angle from the same start, so the whole drag stays ONE undo step and does not drift.
      if (drag.applied) { store.undo(); drag.applied = false; }
      drag.deg = s.deg;
      if (s.deg) drag.applied = ed.apply(`Rotate ${labelFor().toLowerCase()}`, (p) => { applyTurn(p, sel, s.deg, pivot, ctx()); }) !== null;
    }
    updateChip();
  }

  // Panel and readout -----------------------------------------------------------------------------------------------------------------
  function button(label, onclick, attrs = {}) {
    return h('button', { type: 'button', class: 'ps-rot-btn', onclick, ...attrs }, label);
  }
  function build() {
    const input = h('input', { type: 'number', step: '0.1', min: '-360', max: '360', inputmode: 'decimal', placeholder: '0', class: 'ps-rot-input', 'aria-label': 'Turn by degrees, clockwise', dataset: { ps: 'rotate-angle' } });
    const apply = () => {
      const v = Number(input.value);
      if (!Number.isFinite(v) || input.value === '') return;
      commit(v, 'Rotate');
      input.value = '';
    };
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') { e.preventDefault(); apply(); } else if (e.key === 'Escape') { input.value = ''; input.blur(); ed.canvas.focus({ preventScroll: true }); }
    });
    const mk = (deg) => button(`${deg > 0 ? '+' : '−'}${Math.abs(deg)}`, () => commit(deg), { 'aria-label': `Turn ${Math.abs(deg)} degrees ${deg > 0 ? 'clockwise' : 'anticlockwise'}`, dataset: { ps: `rotate-${deg > 0 ? 'plus' : 'minus'}-${Math.abs(deg)}` } });
    const alignBtn = (mode, label) => button(label, () => {
      const a = alignDelta(store.project, sel, mode);
      if (!a) { ed.toast('No lot edge to line up with', { kind: 'warn' }); return; }
      if (Math.abs(a.deg) < 0.05) { ed.toast(`Already square to the ${a.label}`, { kind: 'ok', timeout: 1800 }); return; }
      commit(a.deg, `Align to ${a.label}`);
    }, { dataset: { ps: `rotate-align-${mode}` } });
    els = {
      title: h('span', { class: 'ps-rot-sel', dataset: { ps: 'rotate-selection' } }),
      facing: h('span', { class: 'ps-rot-facing', dataset: { ps: 'rotate-facing' } }),
      input,
      apply: button('Turn', apply, { dataset: { ps: 'rotate-apply' }, title: 'Turn by the typed angle, clockwise' }),
      steps: [mk(-90), mk(-15), mk(15), mk(90)],
      front: alignBtn('frontage', 'Align to frontage'),
      bound: alignBtn('boundary', 'Align to nearest boundary'),
      pick: button('Pick pivot', () => { picking = !picking; sync(); ed.canvas.style.cursor = picking ? 'crosshair' : tool.cursor(); }, { title: 'Click the plan to set the pivot. Alt and click does the same.', dataset: { ps: 'rotate-pick-pivot' } }),
      all: button('Whole development', () => { const g = groupTargets(store.project); if (g.length) setSel([{ kind: 'group' }]); else ed.toast('Nothing to turn yet', { kind: 'warn' }); }, { title: 'Select everything on the site (A)', dataset: { ps: 'rotate-all' } }),
      hint: h('div', { class: 'ps-rot-hint', dataset: { ps: 'rotate-hint' } }),
    };
    box = h('div', { class: 'ps-rot-box', role: 'group', 'aria-label': 'Rotate', dataset: { ps: 'rotate-box' } },
      h('div', { class: 'ps-rot-row ps-rot-head' }, h('strong', null, 'Rotate'), els.title, els.facing),
      h('div', { class: 'ps-rot-row' },
        h('label', { class: 'ps-rot-label' }, 'Turn by', els.input, h('span', null, '°')), els.apply, ...els.steps),
      h('div', { class: 'ps-rot-row' }, els.front, els.bound),
      h('div', { class: 'ps-rot-row' }, els.pick, els.all),
      els.hint);
    box.addEventListener('pointerdown', (e) => e.stopPropagation());
    ed.overlay.append(box);
  }
  function sync() {
    if (!box) return;
    const has = sel.length > 0;
    const d = has ? describeSelection(store.project, sel, ctx()) : null;
    els.title.textContent = has ? d.label : 'Nothing selected';
    els.facing.textContent = has && d.facing != null ? `facing ${d.facing.toFixed(1)}°` : '';
    for (const b of [els.input, els.apply, ...els.steps, els.front, els.bound, els.pick]) b.disabled = !has;
    els.pick.setAttribute('aria-pressed', String(picking));
    els.pick.textContent = picking ? 'Click the plan…' : custom ? 'Pivot set (reset)' : 'Pick pivot';
    els.pick.onclick = () => {
      if (custom && !picking) { custom = false; pivot = null; ensurePivot(); sync(); ed.draw(); return; }
      picking = !picking; sync(); ed.canvas.style.cursor = picking ? 'crosshair' : tool.cursor();
    };
    els.hint.textContent = !has
      ? tt('Click an item, then drag around it to turn it. Or choose Whole development.', 'Tap an item, then drag round it or twist with two fingers to turn it. Or choose Whole development.')
      : tt('Drag to turn. Snaps to 15° and to lot edges. Shift for 1°. Alt and click sets the pivot. Ctrl and click adds items.', 'Drag or twist with two fingers to turn. Snaps to 15° and to lot edges.');
  }
  function updateChip() {
    if (!drag?.moved) { chip?.remove(); chip = null; return; }
    if (!chip) { chip = h('div', { class: 'ps-rot-chip', role: 'status', 'aria-live': 'off', dataset: { ps: 'rotate-readout' } }); ed.overlay.append(chip); }
    const tag = drag.snap === 'frontage' ? 'square to frontage' : drag.snap === 'lot' ? 'square to boundary' : drag.snap === 'fine' ? 'free, 1° steps' : '15° steps';
    chip.replaceChildren(h('strong', null, fmt(drag.deg)), h('small', null, tag));
    chip.dataset.snap = drag.snap || '';
    const s = drag.screen || ed.toScreen(pivot);
    const w = ed.size.w;
    chip.style.left = `${Math.max(8, Math.min(w - 120, s.x + 18))}px`;
    chip.style.top = `${Math.max(8, s.y - 44)}px`;
  }

  // Drawing ---------------------------------------------------------------------------------------------------------------------------
  function draw(g, st) {
    if (!sel.length) return;
    const proj = st.project;
    const S = (p) => ed.toScreen(p);
    // the selection: a gold dashed hull round each target
    g.save();
    for (const t of expand(proj, sel)) {
      const hull = hullOf(pointsOf(proj, t, ctx()));
      if (hull.length < 3) { const c = hull[0]; if (c) { const s = S(c); g.beginPath(); g.arc(s.x, s.y, 14, 0, Math.PI * 2); g.strokeStyle = GOLD; g.lineWidth = 2; g.stroke(); } continue; }
      g.beginPath();
      hull.forEach((q, i) => { const s = S(q); if (i) g.lineTo(s.x, s.y); else g.moveTo(s.x, s.y); });
      g.closePath();
      g.fillStyle = GOLD_SOFT; g.fill();
      g.strokeStyle = GOLD; g.lineWidth = 2; g.setLineDash([8, 5]); g.stroke(); g.setLineDash([]);
    }
    if (!pivot) { g.restore(); return; }
    const c = S(pivot);
    if (drag?.moved) {
      const dist = Math.hypot((drag.screen?.x ?? c.x) - c.x, (drag.screen?.y ?? c.y) - c.y);
      const R = Math.max(70, Math.min(170, dist));
      const a0 = (drag.a0 * Math.PI) / 180;
      const a1 = ((drag.a0 + drag.deg) * Math.PI) / 180;
      // protractor: ticks every 15 degrees round the pivot, longer at 90
      g.strokeStyle = 'rgba(120,110,80,0.55)'; g.lineWidth = 1;
      g.beginPath(); g.arc(c.x, c.y, R, 0, Math.PI * 2); g.stroke();
      for (let k = 0; k < 24; k++) {
        const a = a0 + (k * 15 * Math.PI) / 180; const len = k % 6 === 0 ? 14 : 7;
        g.beginPath(); g.moveTo(c.x + Math.cos(a) * (R - len), c.y + Math.sin(a) * (R - len)); g.lineTo(c.x + Math.cos(a) * R, c.y + Math.sin(a) * R); g.stroke();
      }
      // a lot snap: the lot edge direction through the pivot
      if (drag.snap === 'lot' || drag.snap === 'frontage') {
        const dir = drag.lotDir;
        if (dir) { g.strokeStyle = drag.snap === 'frontage' ? '#1b7a50' : '#2c6bd1'; g.lineWidth = 1.6; g.setLineDash([3, 4]); g.beginPath(); g.moveTo(c.x - dir.x * (R + 40), c.y - dir.y * (R + 40)); g.lineTo(c.x + dir.x * (R + 40), c.y + dir.y * (R + 40)); g.stroke(); g.setLineDash([]); }
      }
      // the swept arc
      g.beginPath(); g.moveTo(c.x, c.y); g.arc(c.x, c.y, R * 0.8, a0, a1, drag.deg < 0); g.closePath();
      g.fillStyle = 'rgba(199,162,86,0.30)'; g.fill(); g.strokeStyle = GOLD; g.lineWidth = 2; g.stroke();
      g.setLineDash([4, 4]); g.beginPath(); g.moveTo(c.x, c.y); g.lineTo(c.x + Math.cos(a0) * R, c.y + Math.sin(a0) * R); g.strokeStyle = 'rgba(90,80,50,0.8)'; g.lineWidth = 1.4; g.stroke(); g.setLineDash([]);
      g.beginPath(); g.moveTo(c.x, c.y); g.lineTo(c.x + Math.cos(a1) * R, c.y + Math.sin(a1) * R); g.strokeStyle = GOLD; g.lineWidth = 2.6; g.stroke();
    }
    // the pivot marker
    g.beginPath(); g.arc(c.x, c.y, 9, 0, Math.PI * 2); g.fillStyle = '#fff'; g.fill(); g.strokeStyle = GOLD; g.lineWidth = 2.6; g.stroke();
    g.beginPath(); g.moveTo(c.x - 15, c.y); g.lineTo(c.x + 15, c.y); g.moveTo(c.x, c.y - 15); g.lineTo(c.x, c.y + 15); g.strokeStyle = GOLD; g.lineWidth = 1.6; g.stroke();
    g.beginPath(); g.arc(c.x, c.y, 2.6, 0, Math.PI * 2); g.fillStyle = custom ? '#b52828' : GOLD; g.fill();
    g.restore();
  }

  // Tool ------------------------------------------------------------------------------------------------------------------------------
  const tool = {
    id: 'rotate',
    cursor: () => (picking ? 'crosshair' : drag?.moved ? 'grabbing' : over ? 'grab' : sel.length ? 'alias' : 'default'),
    hint: () => 'Click an item, then drag round it to turn it. Snaps to 15 degrees and to lot edges, Shift for 1 degree, Alt and click to set the pivot. A selects the whole development, comma and full stop turn 90 degrees, Esc leaves.',
    activate() { if (!box) build(); sync(); },
    deactivate() {
      drag = null; picking = false; over = false; sel = []; pivot = null; custom = false;
      box?.remove(); box = null; chip?.remove(); chip = null; els = {};
      ed.clearPreview();
    },
    projectChanged() {
      // an undo or an outside edit may have removed what was selected
      if (!drag) { sel = sel.filter((t) => t.kind === 'group' ? groupTargets(store.project).length : pointsOf(store.project, t, ctx()).length); if (!sel.length) { pivot = null; custom = false; } sync(); }
    },
    pointerDown(ev) {
      if (ev.alt || picking) {
        if (!sel.length) { picking = false; sync(); return; }
        pivot = snapPivotPoint(ev); custom = true; picking = false; sync(); ed.canvas.style.cursor = tool.cursor(); ed.draw();
        return;
      }
      if (sel.length && pivot) {
        const pc = ed.toScreen(pivot);
        if (Math.hypot(ev.screen.x - pc.x, ev.screen.y - pc.y) <= PIVOT_SNAP_PX) { drag = { pivotDrag: true, startScreen: ev.screen, moved: false }; return; } // drag the pivot cross
      }
      const hit = pickTarget(store.project, ev.world, ctx());
      if (hit && ev.ctrl) {
        const cur = expand(store.project, sel);
        setSel(cur.some((x) => sameTarget(x, hit)) ? cur.filter((x) => !sameTarget(x, hit)) : [...cur, hit]);
        return;
      }
      let clickedEmpty = false;
      if (hit) { if (!selected(hit)) setSel([hit]); } else if (sel.length) clickedEmpty = true; else { ed.startPan(ev); return; }
      ensurePivot();
      drag = { startScreen: ev.screen, a0: null, total: 0, prev: null, deg: 0, snap: 'step', moved: false, clickedEmpty, base: primaryBase(), lines: lines() };
      const c = ed.toScreen(pivot);
      if (Math.hypot(ev.screen.x - c.x, ev.screen.y - c.y) >= MIN_RADIUS_PX) drag.a0 = angleAt(ev.screen);
    },
    pointerMove(ev) {
      if (!drag) {
        const next = !!pickTarget(ed.project(), ev.world, ctx());
        if (next !== over) { over = next; ed.canvas.style.cursor = tool.cursor(); }
        return;
      }
      if (!(ev.raw.buttons & 1)) return;
      if (!drag.moved) {
        if (Math.hypot(ev.screen.x - drag.startScreen.x, ev.screen.y - drag.startScreen.y) < DRAG_START_PX) return;
        drag.moved = true;
        if (!drag.pivotDrag && drag.a0 == null) drag.a0 = angleAt(ev.screen); // pressed on the pivot: the turn is measured from where the drag begins
        ed.canvas.style.cursor = 'grabbing';
      }
      if (drag.pivotDrag) { pivot = snapPivotPoint(ev); custom = true; sync(); ed.draw(); return; }
      turnFromPointer(ev);
      // the lot edge the turn is square to, for the guide line
      const l = drag.snap === 'lot' || drag.snap === 'frontage' ? drag.lines.find((x) => x.index === drag.snapIndex) : null;
      drag.lotDir = l ? { x: Math.cos((l.deg * Math.PI) / 180), y: Math.sin((l.deg * Math.PI) / 180) } : null;
      ed.draw();
    },
    pointerUp() {
      if (!drag) return;
      const d = drag;
      drag = null;
      chip?.remove(); chip = null;
      if (d.moved) {
        if (d.pivotDrag) sync();
        else { ed.clearPreview(); sync(); } // the turn was applied live, as one undo step
      } else if (d.clickedEmpty) setSel([]);
      ed.canvas.style.cursor = tool.cursor();
      ed.draw();
    },
    modifiersChanged() { if (drag?.moved && drag.screen) turnFromPointer({ screen: drag.screen, shift: !!ed.state.pointer?.shift }); },
    cancel() {
      if (drag) { if (drag.applied) store.undo(); drag = null; chip?.remove(); chip = null; ed.clearPreview(); ed.draw(); return true; }
      if (picking) { picking = false; sync(); ed.canvas.style.cursor = tool.cursor(); return true; }
      if (custom) { custom = false; pivot = null; ensurePivot(); sync(); ed.draw(); return true; }
      if (sel.length) { setSel([]); return true; }
      return false;
    },
    keyDown(e) {
      const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      if (e.altKey) return false;
      if (k === 'a') { const g = groupTargets(store.project); if (g.length) setSel([{ kind: 'group' }]); return true; }
      if (!sel.length) return false;
      const step = rotationStep(e);
      if (step) return commit(step), true;
      if (k === 'q' || k === 'e') return commit(k === 'e' ? 1 : -1), true;
      if (k === 'Enter') { els.input?.focus(); return true; }
      return false;
    },
    // Shift and scroll turns the selection 15 degrees a notch (the editor's wheel hook)
    canRotate: () => sel.length > 0 && !drag,
    rotateBy: (deg) => { commit(deg); },
    draw,
    // for tests
    _state: () => ({ sel, pivot, custom, drag }),
    _select: (t) => setSel(t),
  };
  return { rotate: tool };
}

