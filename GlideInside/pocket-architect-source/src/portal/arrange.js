// Arrange the house that is already in the design on the lot: the same controls as placing a library house (drag, ring handle,
// mirror, face the garage to the street, live clearances), for people who started from a template and used Find my block.
//
//   startArrange({ store, editor, onDone, onCancel })
//
// The pose is relative to the design when the session starts: (x, y) is where the centre of the smallest rectangle round the
// building lands, rotation is degrees clockwise from the starting orientation, mirrored flips the house left to right.
// Only the house moves. The lot, its boundary and the road are not part of the design geometry, so mirroring the house can
// never mirror the lot (a fault seen in an earlier builder lot planner).

import { rotateHouse, translateHouse, lotOf } from '../model/placement.js';
import { mirrorPlan } from '../model/ops.js';
import { buildingHull, orientedBox, clearances, faceGarageAngle } from '../site/lotplan.js';
import * as G from '../model/geometry.js';
import { runPoseSession } from './pose-session.js';

/** Centre of the smallest rectangle round the building (unchanged by turning the house), or null with no building. */
export function houseBoxCentre(project) {
  const box = orientedBox(buildingHull(project));
  return box ? box.centre : null;
}

/** Starting pose: where the house is now. */
export function startingPose(project) {
  const c = houseBoxCentre(project);
  return c ? { x: Math.round(c.x), y: Math.round(c.y), rotation: 0, mirrored: false } : { x: 0, y: 0, rotation: 0, mirrored: false };
}

/**
 * Apply a pose to a design that is in its starting state (a preview copy, or the live project on commit). Mutates `project`.
 * Order: mirror, turn about the centre of the building, then move that centre to (x, y).
 */
export function arrangeApply(project, pose) {
  if (pose.mirrored) mirrorPlan(project, 'left_right');
  const c = houseBoxCentre(project);
  if (!c) return null;
  if (pose.rotation) rotateHouse(project, pose.rotation, c);
  const c1 = houseBoxCentre(project);
  translateHouse(project, Math.round(pose.x - c1.x), Math.round(pose.y - c1.y));
  return { pose: { ...pose } };
}

/**
 * First pose for a house that is already in the design. Where it already sits inside the setbacks that is where it stays.
 * Otherwise (it crosses a boundary or sits outside the envelope) the nearest pose with the garage turned to the street that
 * clears every setback is found by search; null when none exists, and the house then starts where it is.
 */
export function fitStartPose(project) {
  const lot = lotOf(project);
  const here = startingPose(project);
  if (!lot?.boundary) return here;
  const now = clearances(project);
  if (now.status === 'ok' || now.status === 'no_building' || !now.hasSetbacks) return here;
  const face = faceGarageAngle(project) ?? 0;
  const bb = G.bbox(lot.boundary);
  const centre = G.polygonCentroid(lot.boundary);
  const cands = [];
  for (let x = bb.minX; x <= bb.maxX; x += 1000) for (let y = bb.minY; y <= bb.maxY; y += 1000) {
    if (G.pointInPolygon({ x, y }, lot.boundary)) cands.push({ x, y, d: Math.hypot(x - centre.x, y - centre.y) });
  }
  cands.sort((a, b) => a.d - b.d);
  for (const rot of [...new Set([face, 0])]) {
    for (const c of cands.slice(0, 400)) {
      const trial = structuredClone(project);
      const pose = { x: Math.round(c.x), y: Math.round(c.y), rotation: rot, mirrored: false };
      if (!arrangeApply(trial, pose)) continue;
      if (clearances(trial).allInside) return pose;
    }
  }
  return here;
}

export function startArrange({ store, editor, host = document.getElementById('ps-stage'), onDone, onCancel } = {}) {
  if (!lotOf(store.project)) throw new Error('Find your block first: there is no lot to arrange the house on.');
  return runPoseSession({
    store, editor, host, title: 'Arrange house on lot', commitLabel: 'Arrange house on lot', commitText: 'Done',
    initialPose: fitStartPose(store.project),
    apply: (p, pose) => arrangeApply(p, pose), onDone, onCancel,
  });
}
