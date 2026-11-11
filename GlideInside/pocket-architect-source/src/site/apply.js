// "Find my block": look an address up and put the real lot into the open project (one undo step).

import { fetchSite } from './client.js';
import { buildSiteLot, underlayFor } from './model.js';
import { faceGarageAngle, buildingHull, orientedBox, roadReserve } from './lotplan.js';
import { rotateHouse, translateHouse } from '../model/placement.js';
import * as G from '../model/geometry.js';
import { saveImage, loadBitmap, removeImage, underlayKey } from '../editor2d/underlay.js';

// Move the whole design so the middle of its footprint sits on the lot centroid (plan 0, 0). Only for the first lot.
export function recentreDesign(p) {
  const pts = [];
  for (const l of p.levels) {
    for (const w of l.walls) pts.push(w.a, w.b);
    for (const r of l.rooms) pts.push(...r.polygon);
  }
  if (!pts.length) return false;
  const xs = pts.map((q) => q.x);
  const ys = pts.map((q) => q.y);
  const dx = -Math.round((Math.min(...xs) + Math.max(...xs)) / 2 / 50) * 50; // keep the snap grid
  const dy = -Math.round((Math.min(...ys) + Math.max(...ys)) / 2 / 50) * 50;
  if (!dx && !dy) return false;
  const move = (q) => { q.x += dx; q.y += dy; };
  for (const l of p.levels) {
    for (const w of l.walls) { move(w.a); move(w.b); }
    for (const r of l.rooms) r.polygon.forEach(move);
    for (const f of l.furniture) move(f);
    for (const s of l.stairs) move(s);
  }
  for (const t of p.site?.tanks || []) move(t);
  return true;
}

/**
 * First lot only: turn the house so its garage (or, without one, its entrance side) faces the street, and bring it forward so it
 * sits about 12 m behind the street boundary on a deep lot. The person can still change this with "Arrange house on lot".
 */
export function faceHouseToStreet(p) {
  const lot = p.site?.lot;
  if (!lot || (lot.frontEdges || []).length !== 1) return false;
  const rs = roadReserve(lot)[0];
  if (!rs) return false;
  let hull = buildingHull(p);
  let box = orientedBox(hull);
  if (!box) return false;
  const ang = faceGarageAngle(p);
  if (ang) {
    rotateHouse(p, ang, box.centre);
    hull = buildingHull(p);
    box = orientedBox(hull);
  }
  const prop = rs.lines.property;
  const inward = { x: -rs.outward.x, y: -rs.outward.y };
  const near = Math.min(...hull.map((q) => G.dot(G.sub(q, prop[0]), inward))) / 1000;
  const shift = near - 12;
  if (shift > 0.5) translateHouse(p, Math.round(-inward.x * shift * 1000 / 50) * 50, Math.round(-inward.y * shift * 1000 / 50) * 50);
  return true;
}

const titleCase = (s) => String(s || '').toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());

/**
 * applySiteLookup(store, selection, { onStep, signal }) -> { lot, warnings }
 * Throws SiteError (readable message) when the lot cannot be found. A missing aerial or elevation grid only adds warnings.
 */
export async function applySiteLookup(store, selection, { onStep, signal, fetchImpl } = {}) {
  const res = await fetchSite(selection, { onStep, signal, fetchImpl });
  const warnings = [...res.warnings];
  let aerialKey = null;
  if (res.aerial?.blob) {
    aerialKey = `${underlayKey(store.project.id)}.site.${Date.now().toString(36)}`;
    const stored = await saveImage(aerialKey, res.aerial.blob);
    if (!stored) warnings.push('This browser would not store the aerial image, so it is kept for this session only.');
    if (!(await loadBitmap(aerialKey))) {
      aerialKey = null;
      warnings.push('The aerial image could not be read.');
    }
  }
  const lot = buildSiteLot({
    lot: res.lot,
    aerialMeta: aerialKey ? res.aerial.meta : null,
    aerialKey,
    contours: res.contours,
    address: String(selection.label || '').replace(/\s*\(sample\)$/, ''),
    source: res.lot.sample ? 'sample' : String(res.lot.state || '').toLowerCase(),
    warnings,
  });
  const oldKey = store.project.site?.underlay?.key;
  const first = !store.project.site?.lot;
  store.apply('Find my block', (p) => {
    if (first) recentreDesign(p);
    p.site.lot = lot;
    if (first) faceHouseToStreet(p);
    p.site.northDeg = 0; // plan up is MGA grid north
    const u = underlayFor(lot);
    if (u) p.site.underlay = u;
    const tb = p.titleBlock || (p.titleBlock = {});
    if (!tb.address) tb.address = lot.address;
    if (!tb.lotDp) tb.lotDp = lot.lotLabel;
    if (!tb.council && lot.lga) tb.council = titleCase(lot.lga);
  });
  if (oldKey && oldKey !== aerialKey && store.project.site.underlay?.key === aerialKey) removeImage(oldKey);
  // Next the person confirms which edges are the street frontage (setbacks depend on it).
  store.setUI({ view: '2d', frontageEdit: true });
  return { lot, warnings };
}

// Take the lot off the project again (one undo step). The aerial underlay goes with it.
export function removeSiteLot(store) {
  const u = store.project.site?.underlay;
  const drop = u?.site ? u.key : null;
  store.apply('Remove lot', (p) => {
    p.site.lot = null;
    if (p.site.underlay?.site) p.site.underlay = null;
  });
  store.setUI({ frontageEdit: false });
  if (drop) removeImage(drop);
}
