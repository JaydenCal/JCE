// Touch gestures for moving and turning the house: pure maths plus a small state machine with no three.js and no store, so it is unit tested in node.
//
//   One finger that lands ON the house drags it. The grab offset is kept (the house does not jump to the finger), the movement is lightly smoothed,
//   a corner within about 0.3 m of a setback line snaps onto it with a short haptic. Orbit is switched off for the whole gesture.
//   A finger that lands OFF the house is left to the camera orbit.
//   Two fingers on the house twist it. Orbit stays off while both are down. Each move and each turn is one commit, so Undo takes it back in one step.

import { snapMove } from '../lotcard/topview-move.js';

export const SNAP_TOL_MM = 300;
export const DRAG_START_PX = 4;
export const STEP_DEG = 15;
export const HANDLE_PX = 44;
export const SMOOTH = 0.55;

/** Where the pointer is, relative to the house centre, at the moment the finger lands. */
export const grabOffset = (centre, grab) => ({ x: grab.x - centre.x, y: grab.y - centre.y });

/** The house centre that keeps the same offset under the finger. */
export const centreFor = (pointer, offset) => ({ x: pointer.x - offset.x, y: pointer.y - offset.y });

/** The move (dx, dy in mm) from where the house stood to where the finger now drags it, keeping the grab offset. */
export function moveFor({ centre, offset, pointer }) {
  const c = centreFor(pointer, offset);
  return { dx: c.x - centre.x, dy: c.y - centre.y };
}

/** Light smoothing between the last shown move and the wanted one. alpha 1 is no smoothing. */
export const smoothMove = (prev, next, alpha = SMOOTH) => ({ dx: prev.dx + (next.dx - prev.dx) * alpha, dy: prev.dy + (next.dy - prev.dy) * alpha });

/** Snap a move to the setback lines (and the lot boundary) within `tol` mm. Returns { dx, dy, snapped }. */
export function snapToSetbacks(rings, move, targets, tol = SNAP_TOL_MM) {
  if (!rings?.length || !targets?.length) return { dx: Math.round(move.dx / 50) * 50, dy: Math.round(move.dy / 50) * 50, snapped: false };
  return snapMove(rings, move.dx, move.dy, targets, tol);
}

/** A short tick on phones that have a vibration motor. Silent where it is not supported. */
export function haptic(nav = globalThis.navigator, ms = 10) {
  try { if (typeof nav?.vibrate === 'function') { nav.vibrate(ms); return true; } } catch { /* not allowed */ }
  return false;
}

/** The angle of the line from finger a to finger b, in degrees (screen axes, y down, so clockwise is positive). */
export const pairAngle = (a, b) => (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;

/** The shortest signed turn from angle `from` to angle `to`, in degrees (-180 to 180). */
export const angleDelta = (from, to) => ((((to - from) % 360) + 540) % 360) - 180;

/** How far two fingers have twisted since they landed: the sum of the small steps, so crossing the top does not jump. */
export function twistTotal(prevTotal, prevAngle, nextAngle) {
  return prevTotal + angleDelta(prevAngle, nextAngle);
}

/** The next angle for a Rotate button: a whole 15 degree step from where the house stands (dir 1 clockwise, -1 anticlockwise). */
export function stepRotation(currentDeg, dir) {
  const d = dir < 0 ? -1 : 1;
  const k = currentDeg / STEP_DEG;
  const next = d > 0 ? Math.floor(k + 1e-9) + 1 : Math.ceil(k - 1e-9) - 1;
  return next * STEP_DEG;
}

/** The turn a button applies, in degrees: always one step of 15. */
export const stepTurn = (dir) => (dir < 0 ? -STEP_DEG : STEP_DEG);

/**
 * The gesture state machine for one canvas.
 *   hitHouse(x, y)       true when the screen point is on the house
 *   planPoint(x, y)      the plan point (mm) under the screen point on the ground plane, or null
 *   state()              { centre, rings, targets } of the house now (plan mm)
 *   preview(p)           { dx, dy, deg, snapped } while moving or turning; null when the preview is cleared
 *   commit(c)            { kind: 'move', dx, dy } or { kind: 'turn', deg }: one call per gesture, the caller makes one undo step
 *   select(on)           the house was tapped (true) or the person tapped away from it (false)
 *   enabled()            gestures apply now (phone, orbit view, nothing else being edited)
 */
export function createHouseGestures({ canvas, controls, hitHouse, planPoint, state, preview = () => {}, commit = () => {}, select = () => {}, enabled = () => true, nav = globalThis.navigator, snapTol = SNAP_TOL_MM, alpha = SMOOTH }) {
  const pointers = new Map();
  let mode = null; // 'move' | 'twist' | 'orbit' | 'done' | null
  let g = null; // the move being made
  let tw = null; // the twist being made
  let locked = null;
  let orb = null; // a finger that landed off the house: a tap there puts the house away

  const lock = () => {
    if (locked) return;
    locked = { enabled: controls ? controls.enabled : true, touchAction: canvas?.style ? canvas.style.touchAction : '' };
    if (controls) controls.enabled = false;
    if (canvas?.style) canvas.style.touchAction = 'none';
  };
  const unlock = () => {
    if (!locked) return;
    if (controls) controls.enabled = locked.enabled;
    if (canvas?.style) canvas.style.touchAction = locked.touchAction || '';
    locked = null;
  };
  const take = (e) => { try { e.stopImmediatePropagation?.(); e.preventDefault?.(); } catch { /* synthetic */ } };

  function beginMove(e) {
    const s = state();
    const p = planPoint(e.clientX, e.clientY);
    if (!s || !p) return false;
    g = { id: e.pointerId, centre: s.centre, rings: s.rings, targets: s.targets, offset: grabOffset(s.centre, p), sx: e.clientX, sy: e.clientY, started: false, shown: { dx: 0, dy: 0 }, final: { dx: 0, dy: 0 }, snapped: false };
    mode = 'move';
    lock();
    return true;
  }

  function wanted(e) {
    const p = planPoint(e.clientX, e.clientY);
    if (!p) return null;
    return moveFor({ centre: g.centre, offset: g.offset, pointer: p });
  }

  function finishMove(doCommit) {
    const d = g; g = null;
    if (!d) return;
    if (doCommit && d.started && (d.final.dx || d.final.dy)) commit({ kind: 'move', dx: d.final.dx, dy: d.final.dy });
    preview(null);
  }

  function beginTwist() {
    const [a, b] = [...pointers.values()];
    tw = { prev: pairAngle(a, b), total: 0, deg: 0, started: false };
    mode = 'twist';
    lock();
  }

  function finishTwist(doCommit) {
    const t = tw; tw = null;
    if (!t) return;
    if (doCommit && t.deg) commit({ kind: 'turn', deg: t.deg });
    preview(null);
  }

  const api = {
    get mode() { return mode; },
    get locked() { return !!locked; },
    down(e) {
      if (!enabled() || e.pointerType !== 'touch') return false;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 1) {
        if (hitHouse(e.clientX, e.clientY) && beginMove(e)) { take(e); return true; }
        mode = 'orbit';
        orb = { sx: e.clientX, sy: e.clientY, moved: false };
        return false;
      }
      if (pointers.size === 2) {
        if (orb) orb.moved = true;
        if (mode === 'move') { // a second finger joins a drag that began on the house: turn it
          finishMove(true);
          beginTwist();
          take(e);
          return true;
        }
        if (mode === 'orbit') {
          // The first finger was off the house: the camera keeps both fingers (pinch and pan).
          return false;
        }
        return false;
      }
      if (mode === 'twist' || mode === 'move' || mode === 'done') { take(e); return true; }
      return false;
    },
    move(e) {
      if (!pointers.has(e.pointerId)) return false;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (mode === 'move' && g && e.pointerId === g.id) {
        take(e);
        if (!g.started) {
          if (Math.hypot(e.clientX - g.sx, e.clientY - g.sy) < DRAG_START_PX) return true;
          g.started = true;
        }
        const raw = wanted(e);
        if (!raw) return true;
        const snap = snapToSetbacks(g.rings, raw, g.targets, snapTol);
        if (snap.snapped && !g.snapped) haptic(nav);
        g.snapped = snap.snapped;
        g.final = { dx: snap.dx, dy: snap.dy };
        g.shown = snap.snapped ? { dx: snap.dx, dy: snap.dy } : smoothMove(g.shown, raw, alpha);
        preview({ dx: g.shown.dx, dy: g.shown.dy, deg: 0, snapped: snap.snapped });
        return true;
      }
      if (mode === 'twist' && tw && pointers.size >= 2) {
        take(e);
        const [a, b] = [...pointers.values()];
        const ang = pairAngle(a, b);
        tw.total = twistTotal(tw.total, tw.prev, ang);
        tw.prev = ang;
        const deg = Math.round(tw.total);
        if (!tw.started && Math.abs(tw.total) < 2) return true;
        tw.started = true;
        tw.deg = deg;
        preview({ dx: 0, dy: 0, deg, snapped: false });
        return true;
      }
      if (mode === 'orbit' && orb && Math.hypot(e.clientX - orb.sx, e.clientY - orb.sy) >= DRAG_START_PX) orb.moved = true;
      return mode === 'done';
    },
    up(e, { cancelled = false } = {}) {
      const had = pointers.delete(e.pointerId);
      if (!had) return false;
      let took = false;
      if (mode === 'move') {
        took = true; take(e);
        const tapped = g && !g.started;
        finishMove(!cancelled);
        if (tapped && !cancelled) select(true);
        mode = null; unlock();
      } else if (mode === 'twist') {
        took = true; take(e);
        if (pointers.size < 2) { finishTwist(!cancelled); mode = pointers.size ? 'done' : null; if (!pointers.size) unlock(); }
      } else if (mode === 'done') {
        took = true;
        if (!pointers.size) { mode = null; unlock(); }
      } else if (mode === 'orbit' && !pointers.size) {
        if (orb && !orb.moved && !cancelled) select(false);
        orb = null; mode = null;
      }
      if (!pointers.size && mode !== null && mode !== 'orbit') { mode = null; unlock(); }
      return took;
    },
    cancel() { finishMove(false); finishTwist(false); pointers.clear(); mode = null; unlock(); },
  };
  return api;
}
