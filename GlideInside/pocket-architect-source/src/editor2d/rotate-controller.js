// The Rotate tool's behaviour, with no DOM and no canvas (residential and commercial plan). Pointer events arrive in plan coordinates (mm).
// Pick the building (the house, or in a commercial layout a building or unit row), then turn it about a visible pivot: drag the ring
// handle (free to 0.1 degree, Shift snaps to 15 degrees), type an angle, or use the align buttons. The pivot starts at the building
// centre and can be dragged.
//
// The project is changed live while a gesture runs, so the 3D view follows, and the gesture is ONE undo step: each update undoes the
// previous update of the same gesture and applies the new one from the same starting point (no drift). Escape cancels the gesture.
// The geometry lives in site/rotate.js.

import * as G from '../model/geometry.js';
import { rotateTarget, turnTarget, alignAngle, snapTurn, parseAngle, ringRadius, wrap180 } from '../site/rotate.js';

const DRAG_PX = 3;
const HANDLE_PX = 14;
const PIVOT_PX = 12;
const TOP = -90; // the handle starts at the top of the ring

export const ROTATE_HINT = 'Drag the gold handle to turn, Shift for 15 degree steps. Drag the cross to move the pivot. Type an angle or use the align buttons in the panel.';

export function createRotateController({ store, scale, toast = () => {}, redraw = () => {} }) {
  let pivot = null; // custom pivot (plan mm); null = the building centre
  let handleDeg = TOP; // where the handle sits on the ring (screen degrees)
  let last = null; // { from, deg, text } the swept arc of the last gesture, kept on screen until the next one
  let sess = null; // an open gesture: { target, pivot, base, deg, applied, a0, total, prev, moved, kind }
  let hover = null;
  const mmPerPx = () => 1 / Math.max(1e-6, scale());
  const say = (msg, kind = 'ok') => { try { toast(msg, { kind }); } catch { /* no toast host */ } };
  const target = () => (sess ? sess.target : rotateTarget(store.project, store.ui));
  const pivotOf = (t = target()) => (sess ? sess.pivot : t ? pivot || t.centre : null);

  // Gesture ------------------------------------------------------------------------------------------------------------------------
  function open(kind) {
    const t = rotateTarget(store.project, store.ui);
    if (!t) return null;
    sess = { kind, target: t, pivot: pivot || t.centre, deg: 0, applied: false, a0: null, total: 0, prev: null, moved: false };
    return sess;
  }

  // Apply the gesture's angle from the gesture's starting project. One undo step in all: an earlier update of this gesture is undone first.
  function live(deg) {
    if (!sess) return false;
    if (deg === sess.deg && sess.applied) return true;
    if (sess.applied && !store.undo()) { sess = null; return false; }
    sess.applied = false;
    sess.deg = deg;
    if (!deg) { redraw(); return true; }
    let res = {};
    try {
      store.apply(sess.label || 'Rotate', (p) => { res = turnTarget(p, sess.target, deg, sess.pivot); });
      sess.applied = true;
      sess.res = res;
    } catch (e) {
      say(e?.message || 'That turn was not possible.', 'warn');
      sess = null;
      return false;
    }
    redraw();
    return true;
  }

  function close() {
    const s = sess;
    sess = null;
    if (!s) return { ok: false };
    if (s.applied && s.deg) {
      handleDeg = wrap180(handleDeg + s.deg);
      last = { from: s.fromDeg, deg: s.deg, id: s.target.id };
      if (s.res?.driveRerouted) say('Driveway re-routed to suit the new position.', 'info');
    }
    redraw();
    return { ok: true, deg: s.applied ? s.deg : 0, res: s.res || {}, target: s.target };
  }

  function cancel() {
    if (!sess) return false;
    if (sess.applied) store.undo();
    sess = null;
    redraw();
    return true;
  }

  // Direct commands (panel buttons, typed angle) ---------------------------------------------------------------------------------------
  /** Turn by deg (clockwise) about the pivot, as ONE undo step. Returns { ok, deg }. */
  function turnBy(deg, label = 'Rotate') {
    if (!Number.isFinite(deg)) return { ok: false, reason: 'not_a_number' };
    const s = open('command');
    if (!s) { say('Select a building to turn first.', 'warn'); return { ok: false, reason: 'no_target' }; }
    s.label = label;
    s.fromDeg = handleDeg;
    const d = r1(wrap180(deg));
    if (!d) { sess = null; return { ok: true, deg: 0 }; }
    if (!live(d)) return { ok: false, reason: 'failed' };
    return { ...close(), ok: true };
  }

  /** The typed angle box: "37.5" turns 37.5 degrees clockwise, "-12" anticlockwise. */
  function typed(text) {
    const d = parseAngle(text);
    if (d == null) { say('Type an angle in degrees, for example 15 or -30.', 'warn'); return { ok: false, reason: 'not_a_number' }; }
    return turnBy(d, 'Rotate by typed angle');
  }

  function align(which) {
    const t = target();
    if (!t) { say('Select a building to align first.', 'warn'); return { ok: false, reason: 'no_target' }; }
    const d = alignAngle(store.project, t, which);
    const name = which === 'nearest' ? 'nearest boundary' : 'street frontage';
    if (d == null) { say(which === 'nearest' ? 'This lot has no boundary to align to.' : 'This lot has no street frontage marked.', 'warn'); return { ok: false, reason: 'no_edge' }; }
    if (!d) { say(`Already aligned to the ${name}.`, 'info'); return { ok: true, deg: 0 }; }
    const r = turnBy(d, which === 'nearest' ? 'Align to nearest boundary' : 'Align to street frontage');
    if (r.ok) say(`Aligned to the ${name}, turned ${fmtDeg(d)}.`, 'ok');
    return r;
  }

  const setPivot = (pt) => { pivot = { x: Math.round(pt.x), y: Math.round(pt.y) }; redraw(); };
  const resetPivot = () => { pivot = null; redraw(); };

  // Pointer ----------------------------------------------------------------------------------------------------------------------------
  const angleAt = (w, c) => (Math.atan2(w.y - c.y, w.x - c.x) * 180) / Math.PI;

  /** What is under the point: 'pivot' | 'handle' | null. */
  function hit(w) {
    const t = target();
    if (!t) return null;
    const c = pivotOf(t);
    const tol = mmPerPx();
    if (G.dist(w, c) <= PIVOT_PX * tol) return 'pivot';
    const R = ringRadius(t, c);
    const h = handlePoint(t, c);
    if (G.dist(w, h) <= HANDLE_PX * tol) return 'handle';
    if (Math.abs(G.dist(w, c) - R) <= 6 * tol) return 'handle'; // the ring itself also turns
    return null;
  }
  const handlePoint = (t, c) => { const R = ringRadius(t, c); const a = (handleDeg * Math.PI) / 180; return { x: c.x + Math.cos(a) * R, y: c.y + Math.sin(a) * R }; };

  function pointerDown(w, mods = {}) {
    const h = hit(w);
    if (!h) return false;
    if (h === 'pivot') { sess = null; drag = { kind: 'pivot', moved: false, screen: mods.screen || null }; return true; }
    const s = open('handle');
    if (!s) return false;
    s.label = 'Rotate';
    s.fromDeg = handleDeg;
    s.a0 = angleAt(w, s.pivot);
    drag = { kind: 'handle', moved: false, screen: mods.screen || null };
    last = null;
    return true;
  }
  let drag = null;

  function pointerMove(w, mods = {}) {
    if (!drag) {
      const next = hit(w);
      if (next !== hover) { hover = next; redraw(); }
      return;
    }
    if (!drag.moved) {
      const s = mods.screen;
      if (s && drag.screen && Math.hypot(s.x - drag.screen.x, s.y - drag.screen.y) < DRAG_PX) return;
      drag.moved = true;
    }
    if (drag.kind === 'pivot') { setPivot(w); return; }
    if (!sess) return;
    let d = angleAt(w, sess.pivot) - sess.a0;
    d = ((d + 540) % 360) - 180; // shortest way round, so crossing the back of the ring does not jump
    sess.total = sess.prev == null ? d : sess.total + (((d - sess.prev + 540) % 360) - 180);
    sess.prev = d;
    sess.raw = sess.total;
    live(snapTurn(sess.total, !!mods.shift));
  }

  function pointerUp() {
    if (!drag) return null;
    const d = drag;
    drag = null;
    if (d.kind === 'pivot') { redraw(); return null; }
    return d.moved ? close() : (cancel(), null);
  }

  function keyDown(e) {
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if (k === 'Escape') return cancel();
    if (!target()) return false;
    if (k === 'q' || k === 'e') { turnBy(k === 'e' ? 1 : -1); return true; }
    return false;
  }

  /** Everything the overlay draws: { target, pivot, custom, R, handle, arc: { from, deg } | null, live } */
  function draft() {
    const t = target();
    if (!t) return null;
    const c = pivotOf(t);
    const arc = sess && sess.deg ? { from: sess.fromDeg ?? handleDeg, deg: sess.deg } : !sess && last && last.id === t.id ? last : null;
    const hd = sess && sess.deg ? wrap180((sess.fromDeg ?? handleDeg) + sess.deg) : handleDeg;
    const R = ringRadius(t, c);
    const a = (hd * Math.PI) / 180;
    return { target: t, pivot: c, custom: !!pivot, R, handle: { x: c.x + Math.cos(a) * R, y: c.y + Math.sin(a) * R }, handleDeg: hd, arc, live: !!sess, hover };
  }

  const clear = () => { sess = null; drag = null; hover = null; };

  return {
    target, pivot: () => pivotOf(), setPivot, resetPivot, hasCustomPivot: () => !!pivot, hit, draft, turnBy, typed, align, pointerDown, pointerMove, pointerUp, cancel, keyDown, clear,
    lastTurn: () => (last ? last.deg : 0), active: () => !!sess, hint: () => ROTATE_HINT,
  };
}

const r1 = (d) => Math.round(d * 10) / 10;
export const fmtDeg = (d) => `${r1(Math.abs(d)).toFixed(1).replace(/\.0$/, '')}° ${d < 0 ? 'anticlockwise' : 'clockwise'}`;
