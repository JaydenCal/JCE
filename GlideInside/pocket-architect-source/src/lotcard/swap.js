// Change the design placed on the lot (the lot card carousel). The previous design is cleared and the new one goes in with the same
// auto placement as the portal's first placement (src/portal/auto-place.js): garage to the street, centred on the frontage behind
// the front setback, inside the envelope where it can. One undo step. The lot, the colour scheme and the title block stay.

import { placeHouse, defaultPose } from '../portal/place-house.js';
import { autoPose } from '../portal/auto-place.js';
import { lotOf } from '../model/placement.js';

/** The pose a design would take on this project's lot (same rules as autoPose, with defaultPose when there is no lot). */
export function poseFor(project, house) {
  const base = structuredClone(project);
  base.levels = base.levels.map((l) => ({ ...l, walls: [], openings: [], rooms: [], furniture: [], stairs: [] }));
  base.site = { ...(base.site || {}), tanks: [] };
  if (lotOf(base)) {
    const a = autoPose(base, house);
    if (a.pose) return { pose: a.pose, fits: a.fits, tooBig: !!a.tooBig };
  }
  return { pose: defaultPose(base, house), fits: null, tooBig: false };
}

/**
 * swapHouse(store, house, { id, name }) replaces what is on the lot with `house` (a project JSON). Returns { fits, tooBig } where fits is
 * true, false or null (unknown) as autoPose reports it and tooBig is true when no position or turn fits the setbacks.
 */
export function swapHouse(store, house, { id = null, name = '' } = {}) {
  const h = structuredClone(house);
  h.name = name || h.name || 'House';
  const { pose, fits, tooBig } = poseFor(store.project, h);
  store.apply('Change house design', (p) => {
    p.levels = [];
    p.site.tanks = [];
    placeHouse(p, h, pose);
    p.placedHouse = tooBig ? { id, name: h.name, tooBig: true } : { id, name: h.name };
  });
  const first = [...store.project.levels].sort((a, b) => a.elevation - b.elevation)[0];
  if (first) store.setUI({ activeLevelId: first.id, selection: null });
  return { fits, tooBig };
}
