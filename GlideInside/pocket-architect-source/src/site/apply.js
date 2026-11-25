// "Find my block": look an address up and put the real lot into the open project (one undo step).

import { fetchSite, fetchOverlays } from './client.js';
import { buildOverlays, overlayRequestFor, autoShowOverlays } from './overlays.js';
import { planView } from '../ui/view-mode.js';
import { buildSiteLot, underlayFor, buildContours, buildTerrain, defaultFloorRL } from './model.js';
import { faceGarageAngle, buildingHull, orientedBox, roadReserve, AUTO_LOT_DP } from './lotplan.js';
import { rotateHouse, translateHouse } from '../model/placement.js';
import * as G from '../model/geometry.js';
import { offerCommercial } from '../commercial/mode.js';
import { saveImage, loadBitmap, removeImage, underlayKey } from '../editor2d/underlay.js';
import { track } from '../ui/analytics.js';

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
export async function applySiteLookup(store, selection, opts = {}) {
  // lot_loaded for analytics: whether the lookup worked and how long it took. Never the address.
  const t0 = Date.now();
  const sample = !!opts.prefetched?.lot?.sample;
  try {
    const out = await lookupAndCommit(store, selection, opts);
    track('lot_loaded', { success: true, ms: Date.now() - t0, sample: sample || out.lot?.source === 'sample' });
    return out;
  } catch (e) {
    if (e?.name !== 'AbortError') track('lot_loaded', { success: false, ms: Date.now() - t0, sample });
    throw e;
  }
}

async function lookupAndCommit(store, selection, { onStep, signal, fetchImpl, prefetched = null, deferContours = true, deadlineAt = 0 } = {}) {
  // A run that was given up on (its deadline passed, or a newer search replaced it) must never land its lot over what is on screen now.
  const stale = () => { if (signal?.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' }); };
  const res = prefetched || (await fetchSite(selection, { onStep, signal, fetchImpl, deferContours, deadlineAt }));
  stale();
  const warnings = [...res.warnings];
  const { aerialKey, aerialWideKey } = await storeAerials(store, res, warnings);
  if (signal?.aborted) { if (aerialKey) removeImage(aerialKey); if (aerialWideKey) removeImage(aerialWideKey); stale(); }
  const lot = buildSiteLot({
    lot: res.lot,
    aerialMeta: aerialKey ? res.aerial.meta : null,
    aerialKey,
    aerialWideMeta: aerialWideKey ? res.aerialWide.meta : null,
    aerialWideKey,
    contours: res.contours,
    address: String(selection.label || '').replace(/\s*\(sample\)$/, ''),
    source: res.lot.sample ? 'sample' : String(res.lot.state || '').toLowerCase(),
    warnings,
  });
  commitLot(store, lot, { label: 'Find my block', aerialKey, aerialWideKey });
  res.contoursPromise?.then((c) => addContours(store, lot, c)).catch(() => {});
  refreshOverlays(store, lot, { fetchImpl }).catch(() => {}); // late, optional, never blocks or fails the lot
  return { lot, warnings, aerialSkipped: !!res.aerialSkipped };
}

// Put the aerial pictures of a lookup in the browser's image store. Returns the keys that could be read back (null when none).
export async function storeAerials(store, res, warnings) {
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
  let aerialWideKey = null;
  if (aerialKey && res.aerialWide?.blob) {
    aerialWideKey = `${aerialKey}.wide`;
    await saveImage(aerialWideKey, res.aerialWide.blob);
    if (!(await loadBitmap(aerialWideKey))) aerialWideKey = null;
  }
  return { aerialKey, aerialWideKey };
}

// Make `lot` the project's lot as one undo step: title block, underlay, frontage step and the commercial offer. Shared by a looked up lot
// and an uploaded boundary.
let commits = 0;
/** How many lots have been put on a project in this page view: a changed count means a lookup landed, even for the lot already shown. */
export const lotCommits = () => commits;
export function commitLot(store, lot, { label = 'Find my block', aerialKey = null, aerialWideKey = null, offer = true } = {}) {
  commits += 1;
  const oldKey = store.project.site?.underlay?.key;
  const oldWide = store.project.site?.lot?.aerialWide?.key || null;
  const first = !store.project.site?.lot;
  store.apply(label, (p) => {
    if (first) recentreDesign(p);
    p.site.lot = lot;
    if (first) faceHouseToStreet(p);
    p.site.northDeg = 0; // plan up is grid north
    const u = underlayFor(lot);
    if (u) p.site.underlay = u;
    else if (p.site.underlay?.site) p.site.underlay = null;
    const tb = p.titleBlock || (p.titleBlock = {});
    // Fields filled in by an earlier lookup are replaced; anything the person typed is kept.
    if (!tb.address || tb.address === tb.addressAuto) { tb.address = lot.address; tb.addressAuto = lot.address; }
    if (!tb.lotDp || tb.lotDp === tb.lotDpAuto || AUTO_LOT_DP.test(String(tb.lotDp).trim())) { tb.lotDp = lot.lotLabel; tb.lotDpAuto = lot.lotLabel; }
    const council = lot.lga ? titleCase(lot.lga) : '';
    if (council && (!tb.council || tb.council === tb.councilAuto)) { tb.council = council; tb.councilAuto = council; }
  });
  if (oldKey && oldKey !== aerialKey && store.project.site.underlay?.key === aerialKey) removeImage(oldKey);
  else if (oldKey && !aerialKey && !store.project.site.underlay) removeImage(oldKey); // a lot with no aerial replaced one that had it
  if (oldWide && oldWide !== aerialWideKey) removeImage(oldWide);
  // Next the person confirms which edges are the street frontage (setbacks depend on it).
  store.setUI({ view: planView(store.ui.view), frontageEdit: true });
  // The lot is on screen: the ground levels join it when they arrive (or never, silently, if the service fails or is over 30 s).
  if (offer) { try { offerCommercial(store); } catch { /* the offer is a convenience */ } }
}

/**
 * Add late ground levels to the lot already on the project (no undo step: derived data, like the setbacks). Skipped when the lot has been
 * replaced meanwhile. Returns true when they were added. The views redraw their ground and the setbacks stage rechecks on the project event.
 */
export function addContours(store, forLot, resp) {
  const cur = store.project.site?.lot;
  if (!resp || !cur || !forLot || cur.origin?.e !== forLot.origin?.e || cur.origin?.n !== forLot.origin?.n || cur.lotLabel !== forLot.lotLabel) return false;
  cur.contours = buildContours(resp);
  cur.contourInterval = { minor: resp.minor, major: resp.major };
  cur.terrain = buildTerrain(resp.grid);
  cur.provenance = { ...(cur.provenance || {}), elevation: resp.provenance || null };
  if (cur.floorRLAuto !== false) cur.floorRL = defaultFloorRL(cur);
  store.emit('project', { label: 'contours' });
  return true;
}

/**
 * Look up the site constraint overlays for the lot on the project and attach them as site.lot.overlays (no undo step: derived data, like the
 * contours). Never throws: a failed or empty lookup leaves the lot as it was. Skipped when the lot was replaced meanwhile. Returns true when added.
 */
export async function refreshOverlays(store, forLot = null, { fetchImpl } = {}) {
  const lot0 = forLot || store.project.site?.lot;
  const req = overlayRequestFor(lot0);
  if (!req) return false;
  let resp = null;
  try {
    resp = await fetchOverlays(req, { fetchImpl });
  } catch {
    resp = null;
  }
  const model = buildOverlays(resp);
  const cur = store.project.site?.lot;
  if (!model || !cur || cur.origin?.e !== lot0.origin?.e || cur.origin?.n !== lot0.origin?.n || cur.lotLabel !== lot0.lotLabel) return false;
  cur.overlays = model;
  autoShowOverlays(cur); // a layer mapped over the lot is shown on the plan straight away (the person can switch it off)
  store.emit('project', { label: 'overlays' });
  return true;
}

// Take the lot off the project again (one undo step). The aerial underlay goes with it.
export function removeSiteLot(store) {
  const u = store.project.site?.underlay;
  const drop = u?.site ? u.key : null;
  const dropWide = store.project.site?.lot?.aerialWide?.key || null;
  store.apply('Remove lot', (p) => {
    p.site.lot = null;
    if (p.site.underlay?.site) p.site.underlay = null;
  });
  store.setUI({ frontageEdit: false });
  if (drop) removeImage(drop);
  if (dropWide) removeImage(dropWide);
}
