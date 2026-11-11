// Figures for the lot card (src/lotcard/lot-card.js): the placed design's beds, baths, cars and areas, the lot's label, area and size,
// all derived from the project model. A figure that cannot be derived is left out, never shown as a placeholder. Pure: no DOM.

import { houseStats } from '../portal/house-stats.js';
import { lotOf } from '../model/placement.js';
import { orientedBox } from '../site/lotplan.js';
import { indoorTotalM2 } from '../ui/schedules.js';

const polyArea = (poly) => {
  let a = 0;
  for (let i = 0; i < poly.length; i += 1) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    a += p.x * q.y - q.x * p.y;
  }
  return Math.abs(a) / 2;
};

/** True when the project has a building (any wall or room that is not marked for demolition). */
export function hasBuilding(project) {
  return (project?.levels || []).some((l) => (l.walls || []).some((w) => w.status !== 'demolish') || (l.rooms || []).some((r) => r.status !== 'demolish'));
}

/** Roofed outdoor rooms (alfresco, verandah, carport, or any outdoor room marked roofed), in m2. Decks and open patios are not roofed. */
export function roofedOutdoorM2(project) {
  let mm2 = 0;
  for (const l of project?.levels || []) {
    for (const r of l.rooms || []) {
      if (r.status === 'demolish' || !r.outdoor || !Array.isArray(r.polygon) || r.polygon.length < 3) continue;
      if (r.roofed || ['alfresco', 'verandah', 'carport'].includes(r.type)) mm2 += polyArea(r.polygon);
    }
  }
  return mm2 / 1e6;
}

/**
 * INDOOR m2 is the figure the PDF and HTML exports and the status bar print (indoorTotalM2: all enclosed rooms, garage included).
 * TOTAL m2 is the roofed area: indoor plus the roofed outdoor rooms. One source, so the card, the status bar and the exports agree.
 */
export const indoorAreaM2 = (project) => indoorTotalM2(project);
export const roofedAreaM2 = (project) => Math.round(indoorTotalM2(project) + roofedOutdoorM2(project));

const fmt = (n) => Number(n).toLocaleString('en-AU');

/**
 * Real lot label for the header: "Lot 24 DP 1234567" for a registered lot, "Proposed Lot 1" for a builder or concept lot.
 * Returns '' when there is no lot on the design.
 */
export function lotHeading(lot) {
  if (!lot) return '';
  const num = lot.lotNumber ? String(lot.lotNumber).trim() : '';
  const dp = lot.planLabel ? String(lot.planLabel).trim() : '';
  if (lot.proposed || (!num && !dp)) return `Proposed Lot ${num || '1'}`;
  return `Lot ${num}${dp ? ` ${dp}` : ''}`.trim();
}

const hullOf = (pts) => {
  const p = pts.map((q) => ({ x: q.x, y: q.y })).sort((a, b) => a.x - b.x || a.y - b.y);
  if (p.length < 3) return p;
  const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower = [];
  for (const q of p) { while (lower.length >= 2 && cross(lower.at(-2), lower.at(-1), q) <= 0) lower.pop(); lower.push(q); }
  const upper = [];
  for (const q of [...p].reverse()) { while (upper.length >= 2 && cross(upper.at(-2), upper.at(-1), q) <= 0) upper.pop(); upper.push(q); }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
};

/** { areaM2, widthM, depthM } of the lot: the real registered area and the oriented bounding box of its boundary. */
export function lotSize(lot) {
  if (!lot?.boundary?.length) return null;
  let box = null;
  try { box = orientedBox(hullOf(lot.boundary)); } catch { box = null; }
  const area = Number.isFinite(lot.areaM2) && lot.areaM2 > 0 ? lot.areaM2 : box ? Math.round((polyArea(lot.boundary) / 1e6) * 10) / 10 : null;
  if (!area) return null;
  const dims = box ? [box.w, box.d].map((v) => Math.round(v / 100) / 10).sort((a, b) => a - b) : null;
  return { areaM2: area, widthM: dims ? dims[0] : null, depthM: dims ? dims[1] : null };
}

/** "Lot 24 DP 1234567 · 612 m² · 15.2 × 40.3 m" (or "Proposed Lot 1 · ..."). */
export function lotLine(lot) {
  const s = lotSize(lot);
  const parts = [lotHeading(lot)];
  if (s) {
    parts.push(`${fmt(Math.round(s.areaM2))} m²`);
    if (s.widthM && s.depthM) parts.push(`${s.widthM.toFixed(1)} × ${s.depthM.toFixed(1)} m`);
  }
  return parts.filter(Boolean).join(' · ');
}

/**
 * The stats row: [{ key, label, value }] for LOT m2, BEDS, BATHS, CARS, INDOOR m2 and TOTAL m2 in that order. A stat that cannot be
 * derived from the model (no lot, no bedrooms, no garage, no rooms) is omitted.
 */
export function cardStats(project) {
  const out = [];
  const lot = lotOf(project);
  const size = lotSize(lot);
  if (size) out.push({ key: 'lot', label: 'Lot m²', value: fmt(Math.round(size.areaM2)) });
  if (!hasBuilding(project) || !project.levels?.length) return out;
  let s = null;
  try { s = houseStats(project); } catch { s = null; }
  if (s) {
    if (s.bedrooms > 0) out.push({ key: 'beds', label: 'Beds', value: String(s.bedrooms) });
    if (s.bathrooms > 0) out.push({ key: 'baths', label: 'Baths', value: String(s.bathrooms) });
    if (s.garage > 0) out.push({ key: 'cars', label: 'Cars', value: String(s.garage) });
  }
  const indoor = indoorAreaM2(project);
  if (indoor > 0) out.push({ key: 'indoor', label: 'Indoor m²', value: fmt(Math.round(indoor)) });
  const total = roofedAreaM2(project);
  if (total > 0) out.push({ key: 'total', label: 'Total m²', value: fmt(total) });
  return out;
}
