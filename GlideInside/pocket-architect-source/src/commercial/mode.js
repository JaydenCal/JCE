// Commercial mode: switching a design into it, first row placement, spec edits (one undo step each) and the zone offer toast.

import * as S from '../model/schema.js';
import { lotOf } from '../model/placement.js';
import { defaultCommercial, defaultRow, normaliseCommercial, isCommercial, bayOffsetMm } from './schema.js';
import { materialise } from './materialise.js';
import { zoneClass, effectiveClass, RESIDENTIAL_NOTE } from './zones.js';
import { defaultRulesFor } from './rules.js';
import { siteLotCommercialSetbacks } from './setbacks.js';
import { toast as realToast } from '../ui/toast.js';

export { isCommercial };

const round = (v, step) => Math.round(v / step) * step;

/** Where the first row goes: parallel to the street frontage, rear against the rear of the envelope, doors facing the frontage. */
export function firstRow(p, cls = 'industrial') {
  const row = defaultRow({ count: 6 });
  const lot = lotOf(p);
  if (!lot) return row;
  const n = lot.boundary.length;
  const e0 = (lot.frontEdges || [])[0] ?? 0;
  const a = lot.boundary[e0];
  const b = lot.boundary[(e0 + 1) % n];
  const el = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  const e = { x: (b.x - a.x) / el, y: (b.y - a.y) / el };
  let nrm = { x: -e.y, y: e.x };
  const cx = lot.boundary.reduce((s, q) => s + q.x, 0) / n;
  const cy = lot.boundary.reduce((s, q) => s + q.y, 0) / n;
  if ((cx - a.x) * nrm.x + (cy - a.y) * nrm.y < 0) nrm = { x: -nrm.x, y: -nrm.y }; // inward
  const u = { x: -nrm.y, y: nrm.x };
  const env = Array.isArray(lot.envelope) && lot.envelope.length >= 3 ? lot.envelope : null;
  const pts = env || lot.boundary;
  const su = pts.map((q) => q.x * u.x + q.y * u.y);
  const tn = pts.map((q) => q.x * nrm.x + q.y * nrm.y);
  let [sMin, sMax, tMin, tMax] = [Math.min(...su), Math.max(...su), Math.min(...tn), Math.max(...tn)];
  if (!env) {
    const sb = defaultRulesFor(cls).setbacks;
    sMin += sb.side * 1000; sMax -= sb.side * 1000; tMin += sb.front * 1000; tMax -= sb.rear * 1000;
  }
  const unit = row.unit;
  const count = Math.max(1, Math.min(8, Math.floor((sMax - sMin) / unit.widthMm)));
  row.count = count;
  const room = tMax - tMin - (bayOffsetMm(defaultCommercial(cls).parking) + 5400); // truck apron (12 m) and a row of bays (5.4 m)
  unit.depthMm = Math.max(6000, Math.min(18000, round(room, 500)));
  const o = { x: u.x * sMin + nrm.x * tMax, y: u.y * sMin + nrm.y * tMax };
  row.x = round(o.x, 50);
  row.y = round(o.y, 50);
  row.rotationDeg = Math.round(((Math.atan2(u.y, u.x) * 180) / Math.PI) * 10) / 10;
  return row;
}

/** Turn project p (mutated in place) into a commercial layout. Keeps the lot, the title block and the drawing setup. */
export function convertToCommercial(p, { useClass, name = null } = {}) {
  const cls = useClass || effectiveClass(p) || 'industrial';
  p.mode = 'commercial';
  p.type = 'commercial';
  p.designType = 'commercial';
  if (name) p.name = name;
  p.finishes = { ...structuredClone(S.DEFAULT_FINISHES_SHED) };
  p.levels = [S.createLevel({ name: 'Ground', elevation: 0, height: 6000, roof: S.roofDefaults('commercial') })];
  p.site.tanks = [];
  delete p.placedHouse;
  // The lot may still carry housing setbacks (a council dwelling rule, the Housing Code or the default housing envelope). They are
  // replaced at once by the indicative commercial table so the first row is never placed against a housing envelope; the setback
  // stage then loads the council file (setbacksKey is cleared so it runs).
  const lot = lotOf(p) ? p.site.lot : null;
  if (lot) {
    const r = siteLotCommercialSetbacks(lot, { councils: [] }, { cls });
    lot.setbacks = r.setbacks;
    lot.envelope = r.envelope;
    lot.setbacksKey = null;
    lot.setbacksDefault = false;
    lot.setbacksStatus = r.setbacks ? 'ok' : 'none';
    lot.setbacksAttempts = [];
  }
  p.commercial = defaultCommercial(cls);
  p.commercial.rows = [firstRow(p, cls)];
  materialise(p);
  return p;
}

/** Switch the open design to commercial mode as one undo step. */
export function enterCommercial(store, opts = {}) {
  return store.apply('Switch to commercial layout', (p) => convertToCommercial(p, opts));
}

/** Edit the spec and regenerate the model as ONE undo step. fn(commercial, project). */
export function commercialEdit(store, label, fn) {
  return store.apply(label, (p) => {
    if (!isCommercial(p)) throw new Error('This design is not in commercial mode.');
    fn(p.commercial, p);
    p.commercial = normaliseCommercial(p.commercial);
    materialise(p);
  });
}

/** Regenerate in place (inside a previewFn or an apply that changed the spec itself). */
export function regenerate(p) {
  if (isCommercial(p)) { p.commercial = normaliseCommercial(p.commercial); materialise(p); }
  return p;
}

/** Whether this screen has the commercial dock. The app switches it off for the embedded viewer and the demo, where a lot lookup must not offer the switch. */
export const commercialUi = { enabled: true };

/**
 * After a lot lookup: on an industrial or commercial zone, offer the switch (never switch silently). On a residential zone with a
 * commercial project, say so. Returns the toast handle or null.
 */
export function offerCommercial(store, { toast = realToast, available = commercialUi.enabled } = {}) {
  if (!available) return null; // no commercial dock on this screen (the embedded viewer, the demo): nothing to offer
  const p = store.project;
  const z = zoneClass(lotOf(p) ? p.site.lot : null);
  if (isCommercial(p)) {
    if ((z.cls === 'residential' || z.cls === 'other') && !p.commercial.zoneClass) return toast(RESIDENTIAL_NOTE, { kind: 'warn', timeout: 9000 });
    return null;
  }
  if (!z.employment) return null;
  return toast(`This lot is zoned ${z.text}. Plan industrial or commercial units here?`, {
    kind: 'info',
    timeout: 20000,
    action: { label: 'Switch to commercial layout', onClick: () => enterCommercial(store, { useClass: z.cls }) },
  });
}
