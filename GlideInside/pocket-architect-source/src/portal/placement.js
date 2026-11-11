// Interactive placement of a library house on the lot: drag to move, turn with the ring handle, mirror, face the garage to the
// street, then Place. The lot, setbacks, kerb, road centreline and driveway are drawn by the 2D editor from the previewed
// project (editor.previewProject) and the clearance to each boundary is read out live (pose-session.js).
// Nothing changes in the design until Place, which commits placeHouse as ONE undo step. After that the house is ordinary walls,
// rooms and openings: fully editable.

import { placeHouse, defaultPose, fitsLot, houseBounds } from './place-house.js';
import { runPoseSession } from './pose-session.js';
import { autoPose } from './auto-place.js';
import { lotOf } from '../model/placement.js';

/**
 * startPlacement({ store, editor, house, lot, onDone, onCancel, initialPose, fit }) returns { setPose, getPose, commit, cancel }.
 * `lot` is optional { widthMm, depthMm } for the "does not fit" warning. With a lot on the design (Find my block) and no
 * initialPose, the house starts turned so its garage faces the street, centred on the frontage behind the front setback
 * (auto-place.js). `fit` is the ranking entry from fit.js ({ badge, reason }) shown in the panel: rank first, then fine tune.
 */
export function startPlacement({ store, editor, house, lot = null, host = document.getElementById('ps-stage'), onDone, onCancel, initialPose = null, fit = null, design = null } = {}) {
  const base = structuredClone(store.project);
  let pose = initialPose || null;
  let note = '';
  if (!pose && lotOf(base)) {
    const auto = autoPose(base, house);
    if (auto.pose) {
      pose = auto.pose;
      if (auto.fits === false) note = ' It does not fit inside the setbacks at this size.';
      else if (!auto.facing) note = ' This design has no garage door to face the street.';
    }
  }
  pose = pose || defaultPose(base, house);
  if (!initialPose && !lotOf(base)) {
    // Start in the middle of what the person is looking at, or beside the existing plan.
    const v = editor.getView?.();
    const el = document.getElementById('ps-plan-host');
    if (v && el && v.scale) {
      const r = el.getBoundingClientRect();
      pose = { ...pose, x: Math.round((r.width / 2 - v.ox) / v.scale), y: Math.round((r.height / 2 - v.oy) / v.scale) };
    }
  }
  const b = houseBounds(house);
  const tooBig = lot ? !fitsLot(house, pose, lot) : false;
  const describe = `${(b.width / 1000).toFixed(1)} x ${(b.depth / 1000).toFixed(1)} m. Drag the house to move it. Drag the gold handle to turn it, Shift for 15 degree steps. Arrow keys nudge 0.5 m (Shift 0.1 m). Q and E turn 15 degrees (Shift 1 degree).${tooBig ? ' This house is larger than the lot.' : ''}${note}`;
  return runPoseSession({
    store, editor, host, reposeOnLot: (p) => (lotOf(p) ? autoPose(structuredClone(p), house).pose || null : null), title: `Place ${house.name || 'house'}`, describe, fit, initialPose: pose,
    apply: (p, ps) => { placeHouse(p, house, ps); if (design) p.placedHouse = { id: design.id ?? null, name: design.name || house.name || '' }; }, commitLabel: 'Place house', commitText: 'Place house', onDone, onCancel,
  });
}
