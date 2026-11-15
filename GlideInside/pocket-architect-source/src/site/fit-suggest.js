// Suggestions when a house does not fit, or only just fits: ways to make this house smaller (each with its rough saving, ranked by how
// much of the shortfall it covers) and other sizes from whatever design catalogue is loaded (ranked by fit, then likeness). Pure: no DOM.
//
//   shrinkSuggestions(project, { needWideM, needDeepM })  -> [{ id, text, saveWideM, saveDeepM, oneTap, guide }]
//   applyShrink(store, id)                                 one undo step, for the suggestions the model can apply itself (oneTap)
//   sizeAlternatives(project, designs)                     -> { list: [{ id, name, design, fit, label, widthM }], fitCount }
//   swapKeeping(store, design)                             change the design, keeping the position and the way the house faces
//
// Savings are approximate (a concept tool): they come from the outline of the rooms, not from a redesign.

import * as G from '../model/geometry.js';
import { lotOf, classifyEdges } from '../model/placement.js';
import { buildingHull, garageDoor, inwardNormalOf, orientedBox } from './lotplan.js';
import { marginIn, buildableArea, fitPlan, fixPose, applyPose } from './fit-advice.js';
import { settleSiteItems } from './site-items.js';
import { placeHouse } from '../portal/place-house.js';
import { houseStats } from '../portal/house-stats.js';

const SINGLE_GARAGE_MM = 3200;
const OUTDOOR_LIVING = new Set(['alfresco', 'verandah', 'patio', 'porch', 'deck', 'pergola']);
const LIVING = new Set(['living', 'family', 'rumpus', 'media', 'lounge', 'dining']);
const m1 = (v) => (Math.round(v * 10) / 10).toFixed(1);
const ground = (project) => [...(project.levels || [])].sort((a, b) => a.elevation - b.elevation)[0] || null;
const counts = (r) => r.status !== 'demolish' && !(r.outdoor && !r.roofed) && Array.isArray(r.polygon) && r.polygon.length >= 3;

/** The house's own axes on the plan: `w` across the house (along the garage door wall, else the side facing the street), `d` front to back. */
export function houseAxes(project) {
  const door = garageDoor(project);
  if (door) return { w: { x: -door.normal.y, y: door.normal.x }, d: door.normal };
  const box = orientedBox(buildingHull(project));
  if (!box) return { w: { x: 1, y: 0 }, d: { x: 0, y: 1 } };
  const lot = lotOf(project);
  const front = lot ? classifyEdges(lot).find((e) => e.kind === 'front') : null;
  if (front) {
    const u = G.norm(G.sub(front.b, front.a));
    return Math.abs(G.dot(box.u, u)) >= Math.abs(G.dot(box.v, u)) ? { w: box.u, d: box.v } : { w: box.v, d: box.u };
  }
  return { w: box.u, d: box.v };
}

const extent = (pts, axis) => { if (!pts.length) return 0; const v = pts.map((p) => G.dot(p, axis)); return Math.max(...v) - Math.min(...v); };
function sizeWithout(project, ax, skip = () => false) {
  const pts = [];
  for (const l of project.levels || []) for (const r of l.rooms || []) if (counts(r) && !skip(r, l)) pts.push(...r.polygon);
  return { w: extent(pts, ax.w), d: extent(pts, ax.d) };
}

const savingWords = (w, d) => {
  const parts = [];
  if (w >= 0.2) parts.push(`${m1(w)} m of width`);
  if (d >= 0.2) parts.push(`${m1(d)} m of depth`);
  return parts.length ? `saves about ${parts.join(' and ')}` : '';
};

/**
 * Ways to make the placed house smaller, most useful first. `needWideM` and `needDeepM` are the shortfall (0 when unknown: then the biggest
 * saving comes first). Each: { id, text, saveWideM, saveDeepM, oneTap (the model can apply it), guide (what to do in the editor) }.
 */
export function shrinkSuggestions(project, { needWideM = 0, needDeepM = 0 } = {}) {
  const g = ground(project);
  if (!g || !buildingHull(project).length) return [];
  const ax = houseAxes(project);
  const full = sizeWithout(project, ax);
  const saveOf = (skip) => { const s = sizeWithout(project, ax, skip); return { w: Math.max(0, full.w - s.w) / 1000, d: Math.max(0, full.d - s.d) / 1000 }; };
  const out = [];
  const add = (id, lead, s, extra = {}) => { const words = savingWords(s.w, s.d); if (words) out.push({ id, text: `${lead} ${words}.`, saveWideM: s.w, saveDeepM: s.d, oneTap: false, guide: '', ...extra }); };

  // The alfresco (and other roofed outdoor areas).
  const alf = (r) => r.outdoor && r.roofed && OUTDOOR_LIVING.has(r.type);
  if ((project.levels || []).some((l) => l.rooms.some((r) => counts(r) && alf(r)))) {
    add('alfresco', 'Drop the alfresco:', saveOf(alf), { oneTap: true, guide: 'On the floor plan, select the alfresco and delete it.' });
  }
  // The garage: a single instead of a double, or parked in tandem or at the rear.
  const garages = g.rooms.filter((r) => counts(r) && (r.type === 'garage' || r.type === 'carport'));
  if (garages.length) {
    const isG = (r) => r.type === 'garage' || r.type === 'carport';
    const gone = saveOf(isG);
    const gw = Math.max(...garages.map((r) => extent(r.polygon, ax.w)));
    // A double garage on the side of the house: a single one narrows the house at the garage (the rooms behind it may still be wider, so
    // only part of it counts toward the shortfall).
    const allW = [];
    for (const l of project.levels || []) for (const r of l.rooms || []) if (counts(r)) allW.push(...r.polygon.map((p) => G.dot(p, ax.w)));
    const gW = garages.flatMap((r) => r.polygon.map((p) => G.dot(p, ax.w)));
    const onSide = Math.abs(Math.min(...gW) - Math.min(...allW)) < 400 || Math.abs(Math.max(...gW) - Math.max(...allW)) < 400;
    if (gw >= 5000 && (gone.w >= 0.2 || onSide)) {
      const single = (gw - SINGLE_GARAGE_MM) / 1000;
      const counted = gone.w >= 0.2 ? Math.min(gone.w, single) : single * 0.5;
      out.push({ id: 'garage-single', text: `A single garage instead of a double saves about ${m1(single)} m of width${gone.w >= single - 0.05 ? '' : ' at the garage'}.`, saveWideM: counted, saveDeepM: 0, oneTap: false, guide: `On the floor plan, drag the outer garage wall in by about ${m1(single)} m and change the door to a single door.` });
      if (gone.w > single + 0.3) add('garage-rear', 'Tandem parking, or the garage moved to the rear,', { w: gone.w, d: 0 }, { guide: 'On the floor plan, redraw the garage behind the house or one car deep and two long, then move the driveway to it.' });
      else if (gone.d >= 0.2) add('garage-rear', 'The garage moved to the rear', gone, { guide: 'On the floor plan, redraw the garage behind the house and move the driveway to it.' });
    } else if (gone.w >= 0.2 || gone.d >= 0.2) {
      add('garage-rear', 'The garage moved to the rear', gone, { guide: 'On the floor plan, redraw the garage behind the house and move the driveway to it.' });
    }
  }
  // One bedroom fewer: the ground floor bedroom whose removal helps most.
  const beds = g.rooms.filter((r) => counts(r) && r.type === 'bedroom');
  if (beds.length > 1) {
    let best = null;
    for (const b of beds) {
      const s = saveOf((r) => r === b);
      const rel = Math.min(s.w, needWideM || s.w) + Math.min(s.d, needDeepM || s.d);
      if (rel >= 0.2 && (!best || rel > best.rel)) best = { b, s, rel };
    }
    if (best) add('bedroom', `One bedroom fewer${best.b.name ? ` (${best.b.name})` : ''}`, best.s, { guide: `On the floor plan, delete ${best.b.name || 'the bedroom'} and its outside walls, then close the opening.` });
  }
  // A smaller living area: up to about a third off the living room on the outside of the house.
  const livs = g.rooms.filter((r) => counts(r) && LIVING.has(r.type));
  {
    let best = null;
    for (const lv of livs) {
      const gone = saveOf((r) => r === lv);
      const s = { w: Math.min(gone.w, (extent(lv.polygon, ax.w) / 1000) * 0.3), d: Math.min(gone.d, (extent(lv.polygon, ax.d) / 1000) * 0.3) };
      const rel = Math.min(s.w, needWideM || s.w) + Math.min(s.d, needDeepM || s.d);
      if (rel >= 0.2 && (!best || rel > best.rel)) best = { lv, s, rel };
    }
    if (best) add('living', 'A smaller living area', best.s, { guide: `On the floor plan, drag the outside wall of ${best.lv.name || 'the living area'} inward.` });
  }
  // Two storeys on the same floor area: about half the footprint. Shown as the saving on the side that is short.
  if ((project.levels || []).filter((l) => l.rooms.some(counts)).length === 1 && beds.length >= 2) {
    const deep = needDeepM > needWideM || (!needWideM && !needDeepM);
    const s = deep ? { w: 0, d: (full.d / 1000) * 0.4 } : { w: (full.w / 1000) * 0.4, d: 0 };
    add('two-storey', 'Two storeys on the same floor area', s, { guide: 'Choose a two storey design, or add a level in the editor and move the bedrooms upstairs.', designs: true });
  }
  const rel = (s) => (needWideM || needDeepM ? Math.min(s.saveWideM, needWideM) + Math.min(s.saveDeepM, needDeepM) : s.saveWideM + s.saveDeepM);
  return out.filter((s) => rel(s) >= 0.2 || (!needWideM && !needDeepM)).sort((a, b) => rel(b) - rel(a) || b.saveWideM + b.saveDeepM - (a.saveWideM + a.saveDeepM));
}

/** "A narrower lot width design": the last suggestion, pointing at the best alternative that fits. Null when there is none. */
export function narrowerDesignSuggestion(project, alternatives) {
  const ax = houseAxes(project);
  const now = sizeWithout(project, ax).w / 1000;
  // The first fitting design that is actually narrower (a wide acreage home can fit a deep lot without saving width).
  const best = alternatives?.list?.find((a) => a.fit > 0 && now - a.widthM >= 0.2);
  if (!best) return null;
  const save = now - best.widthM;
  if (!(save >= 0.2)) return null;
  return { id: 'narrower-design', text: `A narrower design: ${best.name} is ${m1(best.widthM)} m wide and saves about ${m1(save)} m of width.`, saveWideM: save, saveDeepM: 0, oneTap: false, guide: '', designId: best.id };
}

/** Apply a suggestion the model can do itself. One undo step. Only 'alfresco' for now: the roofed outdoor areas are removed. */
export function applyShrink(store, id) {
  if (id !== 'alfresco') return { ok: false };
  let n = 0;
  store.apply('Remove alfresco', (p) => {
    for (const l of p.levels) {
      const gone = l.rooms.filter((r) => r.outdoor && r.roofed && OUTDOOR_LIVING.has(r.type));
      if (!gone.length) continue;
      n += gone.length;
      l.rooms = l.rooms.filter((r) => !gone.includes(r));
      l.furniture = l.furniture.filter((f) => !gone.some((r) => G.pointInPolygon(f, r.polygon)));
    }
    settleSiteItems(p);
  });
  if (!n) { store.undo(); return { ok: false }; }
  return { ok: true, label: 'Alfresco removed' };
}

// Other sizes ----------------------------------------------------------------------------------------------------------------
const doorAngle = (project) => { const d = garageDoor(project); return d ? (Math.atan2(d.normal.y, d.normal.x) * 180) / Math.PI : null; };
const normDeg = (d) => { const v = (((d % 360) + 540) % 360) - 180; return v === -180 ? 180 : v; };

/** The pose (for placeHouse) that puts `house` where the placed house is, facing the same way. Null when either has no garage door to go by. */
export function keptPose(project, house) {
  const hull = buildingHull(project);
  const now = doorAngle(project);
  if (hull.length < 3 || now == null) return null;
  const base = structuredClone({ ...project, levels: [], site: { ...project.site, tanks: [] } });
  const probe = structuredClone(base);
  placeHouse(probe, house, { x: 0, y: 0, rotation: 0 });
  const own = doorAngle(probe);
  if (own == null) return null;
  const rotation = Math.round(normDeg(now - own) * 10) / 10;
  const c = G.polygonCentroid(hull);
  const trial = structuredClone(base);
  placeHouse(trial, house, { x: c.x, y: c.y, rotation });
  const th = buildingHull(trial);
  if (th.length < 3) return null;
  const tc = G.polygonCentroid(th);
  return { pose: { x: Math.round(2 * c.x - tc.x), y: Math.round(2 * c.y - tc.y), rotation }, base };
}

function similarity(cur, s, sameType) {
  const ratio = cur.floorAreaM2 > 0 && s.floorAreaM2 > 0 ? Math.abs(Math.log(s.floorAreaM2 / cur.floorAreaM2)) : 1;
  return 100 - 22 * Math.abs(s.bedrooms - cur.bedrooms) - (s.storeys !== cur.storeys ? 12 : 0) - 30 * ratio - (sameType ? 0 : 25);
}

const altCache = new Map();

/**
 * The other designs in the catalogue, the ones that fit this lot first, then by likeness to the placed house (bedrooms, storeys, floor
 * area, kind of home). `designs` is whatever is loaded: [{ id, name, project, frontageM?, fit? }].
 * Returns { list: [{ id, name, design, fit: 2 fits where the house stands | 1 fits moved or turned | 0 does not fit, similar, label, widthM, bedrooms }], fitCount }.
 */
export function sizeAlternatives(project, designs, { placedId = project?.placedHouse?.id || null } = {}) {
  const area = buildableArea(project);
  const hull = buildingHull(project);
  if (!Array.isArray(designs) || !designs.length || !area?.polygon || hull.length < 3) return { list: [], fitCount: 0 };
  const key = `${placedId}|${designs.map((d) => d.id).join(',')}|${hull.map((p) => `${Math.round(p.x)},${Math.round(p.y)}`).join(' ')}|${area.polygon.length}|${Math.round(area.polygon[0].x)},${Math.round(area.polygon[0].y)}`;
  if (altCache.has(key)) return altCache.get(key);
  const cur = houseStats(project);
  const list = [];
  for (const d of designs) {
    if (!d?.project?.levels?.length || d.id === placedId) continue;
    let fit = 0;
    try {
      const kp = keptPose(project, d.project);
      if (kp) {
        const t = structuredClone(kp.base);
        placeHouse(t, d.project, kp.pose);
        const mg = marginIn(buildingHull(t), area.polygon);
        if (mg >= 0) fit = 2;
        else if (d.fit && d.fit.status === 'too-big') fit = 0;
        else fit = fitPlan(t)?.auto?.fits ? 1 : 0; // confirmed by an actual auto fit, never promised on the card's rough check alone
      } else if (d.fit && d.fit.status === 'too-big') fit = 0;
      else {
        const t = structuredClone({ ...project, levels: [], site: { ...project.site, tanks: [] } });
        const c = G.polygonCentroid(hull);
        placeHouse(t, d.project, { x: c.x, y: c.y, rotation: 0 });
        fit = fitPlan(t)?.auto?.fits ? 1 : 0;
      }
    } catch { fit = 0; }
    const s = houseStats(d.project);
    const sameType = (d.project.type || 'house') === (project.type || 'house');
    const sim = similarity(cur, s, sameType);
    const widthM = Math.round(s.widthMm / 100) / 10;
    const similar = sim >= 55 && s.bedrooms > 0;
    const label = fit > 0 ? (similar ? `Similar ${s.bedrooms} bedroom that fits: ${m1(widthM)} m wide` : `${d.name}: fits, ${m1(widthM)} m wide`) : `${d.name}: ${m1(widthM)} m wide`;
    list.push({ id: d.id, name: d.name, design: d, fit, sim, similar, label, widthM, bedrooms: s.bedrooms, storeys: s.storeys });
  }
  list.sort((a, b) => (b.fit > 0) - (a.fit > 0) || b.sim - a.sim || b.fit - a.fit);
  const res = { list, fitCount: list.filter((a) => a.fit > 0).length };
  if (altCache.size > 20) altCache.clear();
  altCache.set(key, res);
  return res;
}

/**
 * Change the design in one undo step, keeping the position and the way the house faces. Where the new house does not fit there it is
 * moved (and only then turned) into the buildable area. Returns { ok, fits, kept }.
 */
export function swapKeeping(store, design) {
  const house = structuredClone(design.project);
  house.name = design.name || house.name || 'House';
  const kp = keptPose(store.project, house);
  let res = { ok: true, fits: null, kept: !!kp };
  store.apply('Change house design', (p) => {
    const hull = buildingHull(p);
    const c = hull.length >= 3 ? G.polygonCentroid(hull) : null;
    p.levels = [];
    p.site.tanks = [];
    placeHouse(p, house, kp ? kp.pose : { ...(c ? { x: c.x, y: c.y } : {}), rotation: 0 });
    const area = buildableArea(p);
    if (area?.polygon && marginIn(buildingHull(p), area.polygon) < 0) {
      const plan = fitPlan(p);
      const asis = plan && plan.verdict === 'move' ? fixPose(p, 'auto') : null;
      const pose = asis && asis.fits && Math.abs(asis.deg) < 0.5 ? asis : fixPose(p, 'auto');
      if (pose) applyPose(p, pose);
    }
    settleSiteItems(p, { quiet: true });
    const fits = area?.polygon ? marginIn(buildingHull(p), area.polygon) >= 0 : null;
    p.placedHouse = fits === false ? { id: design.id, name: house.name, tooBig: true } : { id: design.id, name: house.name };
    res = { ok: true, fits, kept: !!kp };
  });
  const first = [...store.project.levels].sort((a, b) => a.elevation - b.elevation)[0];
  if (first) store.setUI({ activeLevelId: first.id, selection: null });
  return res;
}

/** The street frame's inward normal, exported for callers that label width and depth. */
export const frontNormal = (lot) => { const f = classifyEdges(lot).find((e) => e.kind === 'front'); return f ? inwardNormalOf(lot, f.index) : null; };
