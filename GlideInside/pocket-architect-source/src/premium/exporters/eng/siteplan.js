// Site plan sheet and the locality map, in the manner of the JCESITE plan sets: the lot filling the viewport (turned so the street runs
// along the bottom where that gives a larger scale), a reduced resolution aerial underlay edge to edge, cadastre in red over the
// aerial, the lot boundary with bearings and distances, the indicative setback envelope, contours with RLs, the proposed dwelling
// hatched, driveway and crossover, road reserve with a red PHANTOM centreline, setback dimensions, FFL and NSL at the house corners,
// boxed call outs, a legend and notes on the right. Every label goes through one registry so that text never lands on text.

import * as G from '../../../model/geometry.js';
import { terrainAt } from '../../../site/model.js';
import {
  boundaryDims, roadReserve, buildingRings, buildingHull, orientedBox, deriveDriveway, clearances, lotLabelLines,
} from '../../../site/lotplan.js';
import { northArrow, scaleBar } from '../pdf.js';
import {
  PEN, PHANTOM, PHANTOM_LEN, TXT, clean, wrap, fit, ink, polygon, hatch, clippedPolyline, clipPolygon, dimLine, placeCallouts, drawCallouts,
  viewTitle, boxOfPts, overlap, inflate, haloText, alongLabel, LabelField, clipSegment,
} from './kit.js';
import { placeUnderlay } from './aerial.js';
import { nearestTown } from './towns.js';
import { BODY } from './frame.js';
import { siteAreaOf, fmtArea, lotIdLines } from './area.js';

export const SITE_SCALES = [100, 200, 250, 500, 1000, 2000];
/** A lot that needs a scale smaller than this to fit is a large lot: the site plan shows the house and its surrounds and the key plan shows the lot. */
export const FOCUS_ABOVE = 500;
export const PANEL_W = 100;
export const SITE_VP = { x0: BODY.x0, y0: BODY.y0, x1: BODY.x1 - PANEL_W - 3, y1: BODY.y1 };
// Right hand panel boxes (sheet mm), shared with the code that renders the aerial for the key plan.
export const NORTH_H = 36;
export const KEY_H = 52;
export const keyBox = () => ({ x0: SITE_VP.x1 + 3 + 2, y0: BODY.y0 + NORTH_H + 3 + 8, x1: BODY.x1 - 2, y1: BODY.y0 + NORTH_H + 3 + KEY_H - 2 });

/** Everything a site drawing needs about the lot, or null with no lot. */
export function siteFacts(project) {
  const lot = project.site?.lot;
  if (!lot?.boundary?.length) return null;
  const rings = buildingRings(project);
  const hull = buildingHull(project);
  const obox = orientedBox(hull);
  return { lot, rings, hull, obox, reserve: roadReserve(lot), drive: deriveDriveway(project), clear: clearances(project) };
}

const ptsOf = (flat) => {
  const out = [];
  for (let i = 0; i + 1 < flat.length; i += 2) out.push({ x: flat[i], y: flat[i + 1] });
  return out;
};
const dirOf = (a, b) => G.norm(G.sub(b, a));
const rad = (d) => (d * Math.PI) / 180;

function offsetPoly(poly, d) {
  // Outset a convex polygon by d (mm) edge by edge. Orientation independent.
  const sgn = G.signedArea(poly) >= 0 ? 1 : -1;
  const lines = poly.map((a, i) => {
    const b = poly[(i + 1) % poly.length];
    const u = G.norm(G.sub(b, a));
    const n = { x: u.y * sgn, y: -u.x * sgn };
    return { p: G.add(a, G.mul(n, d)), u };
  });
  return lines.map((l, i) => {
    const m = lines[(i + lines.length - 1) % lines.length];
    const den = G.cross(m.u, l.u);
    if (Math.abs(den) < 1e-9) return l.p;
    const t = G.cross(G.sub(l.p, m.p), l.u) / den;
    return G.add(m.p, G.mul(m.u, t));
  });
}

/** Points the site plan must show: the lot, the house and the street out to just past its centreline. */
export function fitPoints(facts) {
  const pts = [...facts.lot.boundary, ...facts.hull];
  for (const r of facts.reserve) {
    const reach = (r.vergeM + r.gutterM + r.carriagewayM / 2 + 1.6) * 1000;
    const e0 = facts.lot.boundary[r.edge];
    const e1 = facts.lot.boundary[(r.edge + 1) % facts.lot.boundary.length];
    pts.push(G.add(e0, G.mul(r.outward, reach)), G.add(e1, G.mul(r.outward, reach)));
  }
  return pts;
}

/**
 * Points for the site plan of a large lot: the house with a margin, the nearest stretch of the frontage road when it is close, and the
 * nearest boundary point when it is close. The whole lot is on the key plan.
 */
export function focusPoints(facts, marginMm = 15000) {
  const hull = facts.hull?.length ? facts.hull : [G.polygonCentroid(facts.lot.boundary)];
  const b = G.bbox(hull);
  const pts = [{ x: b.minX - marginMm, y: b.minY - marginMm }, { x: b.maxX + marginMm, y: b.minY - marginMm }, { x: b.maxX + marginMm, y: b.maxY + marginMm }, { x: b.minX - marginMm, y: b.maxY + marginMm }];
  const c = { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 };
  const nearestOn = (p, q) => {
    const d = G.sub(q, p);
    const L2 = d.x * d.x + d.y * d.y || 1;
    const t = G.clamp(((c.x - p.x) * d.x + (c.y - p.y) * d.y) / L2, 0, 1);
    return G.add(p, G.mul(d, t));
  };
  const ring = facts.lot.boundary;
  let near = null;
  ring.forEach((p, i) => {
    const q = nearestOn(p, ring[(i + 1) % ring.length]);
    const dist = Math.hypot(q.x - c.x, q.y - c.y);
    if (!near || dist < near.dist) near = { q, dist, edge: i };
  });
  if (near && near.dist < 45000) pts.push(near.q);
  for (const r of facts.reserve) {
    const e0 = ring[r.edge];
    const e1 = ring[(r.edge + 1) % ring.length];
    const q = nearestOn(e0, e1);
    if (Math.hypot(q.x - c.x, q.y - c.y) < 90000) {
      const reach = (r.vergeM + r.gutterM + r.carriagewayM / 2 + 1.6) * 1000;
      pts.push(q, G.add(q, G.mul(r.outward, reach)));
    }
  }
  return pts;
}

/** Bounds used by the analysis diagram (a little roomier than the site plan fit). */
export function lotBounds(project, facts) {
  const pts = fitPoints(facts);
  for (const r of facts.reserve) {
    const L = r.lines;
    pts.push(...L.farKerb.slice(0, 1), G.lerp(L.centreline[0], L.centreline[1], 0.5));
  }
  const b = G.bbox(pts);
  const pad = 3000;
  return G.bbox([{ x: b.minX - pad, y: b.minY - pad }, { x: b.maxX + pad, y: b.maxY + pad }]);
}

export function chooseSiteScale(pts, vp, k = 1) {
  const b = G.bbox(pts);
  const w = vp.x1 - vp.x0;
  const h = vp.y1 - vp.y0;
  // A very large lot goes past the usual scales (the analysis diagram shows the whole lot)
  const n = [...SITE_SCALES, 5000, 10000, 20000].find((s) => b.w / (s * k) <= w * 0.96 && b.h / (s * k) <= h * 0.96) || 20000;
  return { n, ds: n * k, box: b };
}

/** World to sheet transform centring `box` in `vp`. */
export const makeT = (box, vp, ds) => {
  const cx = (vp.x0 + vp.x1) / 2;
  const cy = (vp.y0 + vp.y1) / 2;
  const mx = (box.minX + box.maxX) / 2;
  const my = (box.minY + box.maxY) / 2;
  return (p) => ({ x: cx + (p.x - mx) / ds, y: cy + (p.y - my) / ds });
};

const turnBy = (deg) => { const c = Math.cos(rad(deg)); const s = Math.sin(rad(deg)); return (p) => ({ x: c * p.x - s * p.y, y: s * p.x + c * p.y }); };

/**
 * The site plan view: the plan turned by `turnDeg` (clockwise on the sheet) at the smallest standard scale that fits the lot, house and
 * street in the viewport. North up is tried first and the turned views (street along the bottom, or either side) only win on scale.
 * Returns { n, ds, turnDeg, T, label, northDeg, vp }.
 */
export function siteView(project, facts, k = 1) {
  const vp = SITE_VP;
  const inner = { x0: vp.x0 + 4, y0: vp.y0 + 4, x1: vp.x1 - 4, y1: vp.y1 - 4 };
  const cands = [0];
  const road = facts.reserve[0];
  let base = null;
  if (road) base = 90 - (Math.atan2(road.outward.y, road.outward.x) * 180) / Math.PI;
  else if (facts.obox) base = -facts.obox.angleDeg;
  if (base != null) {
    const norm = (d) => ((((d + 180) % 360) + 360) % 360) - 180;
    // The street stays within 45 degrees of horizontal so its name reads across the sheet, never up the page
    for (const d of road ? [base, base + 180] : [base, base + 90, base - 90, base + 180]) cands.push(norm(d));
  }
  const choose = (fp) => {
    let best = null;
    for (const turnDeg of cands) {
      const rot = turnBy(turnDeg);
      const b = G.bbox(fp.map(rot));
      const n = SITE_SCALES.find((s) => b.w / (s * k) <= inner.x1 - inner.x0 && b.h / (s * k) <= inner.y1 - inner.y0) || SITE_SCALES.at(-1);
      if (!best || n < best.n) best = { n, turnDeg, rot, b };
    }
    return best;
  };
  let best = choose(fitPoints(facts));
  let focus = false;
  if (best.n > FOCUS_ABOVE && facts.hull?.length) {
    const f = choose(focusPoints(facts));
    if (f.n < best.n) { best = f; focus = true; }
  }
  const ds = best.n * k;
  const cx = (vp.x0 + vp.x1) / 2;
  const cy = (vp.y0 + vp.y1) / 2;
  const bx = (best.b.minX + best.b.maxX) / 2;
  const by = (best.b.minY + best.b.maxY) / 2;
  const T = (p) => { const r = best.rot(p); return { x: cx + (r.x - bx) / ds, y: cy + (r.y - by) / ds }; };
  // The sheet viewport in plan mm (four corners), so the key plan can show what this sheet covers
  const o = T({ x: 0, y: 0 });
  const ex = T({ x: 1e4, y: 0 });
  const ey = T({ x: 0, y: 1e4 });
  const m = [[(ex.x - o.x) / 1e4, (ey.x - o.x) / 1e4], [(ex.y - o.y) / 1e4, (ey.y - o.y) / 1e4]];
  const det = m[0][0] * m[1][1] - m[0][1] * m[1][0];
  const inv = (s) => { const dx = s.x - o.x; const dy = s.y - o.y; return { x: (m[1][1] * dx - m[0][1] * dy) / det, y: (-m[1][0] * dx + m[0][0] * dy) / det }; };
  const windowPlan = [{ x: vp.x0, y: vp.y0 }, { x: vp.x1, y: vp.y0 }, { x: vp.x1, y: vp.y1 }, { x: vp.x0, y: vp.y1 }].map(inv);
  return { n: best.n, ds, turnDeg: Math.round(best.turnDeg * 1000) / 1000, T, vp, focus, windowPlan, northDeg: (Number(project.site?.northDeg) || 0) + best.turnDeg };
}

/** The palette: red cadastre over an aerial (owner convention), the JCE green without one. */
export const paletteFor = (hasAerial) => ({
  boundary: hasAerial ? PEN.cadRed : PEN.boundary,
  neighbour: hasAerial ? PEN.cadRed : PEN.neighbour,
  neighbourW: hasAerial ? 0.22 : 0.13,
  envelope: hasAerial ? PEN.envelopeAerial : PEN.envelope,
});

/** Dash pattern for the existing boundary is solid, for a proposed lot boundary long dash, dot (never the same as existing). */
const PROPOSED_BOUNDARY = [9, 2, 1, 2];

const STREET_TYPES = 'Street|St|Road|Rd|Avenue|Ave|Drive|Dr|Lane|Ln|Court|Ct|Place|Pl|Crescent|Cres|Close|Cl|Way|Parade|Pde|Highway|Hwy|Boulevard|Blvd|Terrace|Tce|Circuit|Cct|Esplanade|Esp|Grove|Gr';
/** The road name only: no house number, suburb, state or postcode. */
export const roadNameOnly = (raw) => {
  const t = clean(String(raw || '')).split(',')[0].replace(/^\s*(unit|lot)?\s*[\d/]+[a-z]?\s+/i, '').trim();
  const m = t.match(new RegExp(`^(.*?\\b(?:${STREET_TYPES}))\\b`, 'i'));
  return (m ? m[1] : t.replace(/\b(NSW|QLD|VIC|SA|WA|TAS|NT|ACT)\b.*$/i, '')).trim();
};
const segDist = (p, a, b) => {
  const d = G.sub(b, a);
  const L2 = d.x * d.x + d.y * d.y || 1;
  const t = G.clamp(((p.x - a.x) * d.x + (p.y - a.y) * d.y) / L2, 0, 1);
  return Math.hypot(p.x - (a.x + d.x * t), p.y - (a.y + d.y * t));
};
const pathDist = (p, pts) => { let m = Infinity; for (let i = 0; i + 1 < pts.length; i++) m = Math.min(m, segDist(p, pts[i], pts[i + 1])); return m; };
/**
 * The name of the road the lot fronts. The street in the address when the road of that name is nearby (or none is loaded); else the
 * named road nearest the middle of the frontage edge. Never just the first road the lookup returned.
 */
export function frontageRoadName(lot, facts = null) {
  const addr = roadNameOnly(lot?.address || '').toUpperCase();
  const roads = (lot?.roads || []).filter((r) => r.name && (r.pts?.length || 0) >= 4).map((r) => ({ name: clean(roadNameOnly(r.name) || r.name).toUpperCase(), pts: ptsOf(r.pts) }));
  if (!roads.length) return addr;
  const edge = facts?.reserve?.[0]?.edge ?? 0;
  const ring = lot.boundary || [];
  const mid = ring.length > 1 ? G.lerp(ring[edge], ring[(edge + 1) % ring.length], 0.5) : { x: 0, y: 0 };
  const ranked = roads.map((r) => ({ name: r.name, d: pathDist(mid, r.pts) })).sort((p, q) => p.d - q.d);
  const hit = addr && ranked.find((r) => r.name === addr);
  if (hit && hit.d < ranked[0].d + 60000) return addr;
  if (ranked[0].d < 150000) return ranked[0].name;
  return addr || ranked[0].name;
}
const ROAD_NAME = (lot, facts = null) => frontageRoadName(lot, facts);

/**
 * Draw the site plan into SITE_VP. Returns { n, ds, label, T, turnDeg, northDeg, facts }.
 * ctx: { project, k, paper, underlays: { site: { url, rect } } }.
 */
export function drawSitePlan(doc, ctx) {
  const { project } = ctx;
  const vp = SITE_VP;
  const facts = siteFacts(project);
  const lot = facts?.lot || null;
  const rect = { x0: vp.x0, y0: vp.y0, x1: vp.x1, y1: vp.y1 };
  if (!facts) return noLotMessage(doc, ctx, vp);

  const view = siteView(project, facts, ctx.k || 1);
  const { n, ds, T } = view;
  const label = `1:${n} @ ${ctx.paper || 'A3'}`;
  const under = ctx.underlays?.site;
  const aerial = !!(under?.url && placeUnderlay(doc, under.url, under.rect || rect));
  const pal = paletteFor(aerial);
  const field = new LabelField(rect);
  doc.setLineDashPattern([], 0);
  // The view title sits in a white tab at the top left. It is drawn last (so nothing covers it) and reserved now.
  field.addBox({ x0: vp.x0, y0: vp.y0, x1: vp.x0 + 80, y1: vp.y0 + 13 });

  const stroke = (pts, closed = true) => clippedPolyline(doc, pts.map(T), rect, closed);
  const HALO = 1.0;

  // 1. Contours (under everything)
  const contourLabels = [];
  for (const c of lot.contours || []) {
    if (Math.abs(c.level - Math.round(c.level)) > 1e-6) continue; // contours at 1.0 m minimum (5 m DEM)
    const pts = ptsOf(c.pts || []).map(T);
    if (pts.length < 2) continue;
    doc.setDrawColor(...(c.major ? PEN.contourMajor : PEN.contourMinor));
    doc.setLineWidth(c.major ? 0.28 : 0.12);
    doc.setLineDashPattern([], 0);
    clippedPolyline(doc, pts, rect, false);
    contourLabels.push({ c, pts });
  }

  // 2. Neighbouring lots (DCDB)
  doc.setDrawColor(...pal.neighbour);
  doc.setLineWidth(pal.neighbourW);
  for (const nb of lot.neighbours || []) {
    if (nb.isRoad) continue;
    stroke(nb.ring);
  }

  // 3. Road reserve: footpath, kerb, gutter, pavement hatched along the road, concrete footpath, red PHANTOM centreline
  const roadBoxes = [];
  for (const r of facts.reserve) {
    const L = r.lines;
    const quad = (A, B) => [A[0], A[1], B[1], B[0]];
    const along = dirOf(T(L.centreline[0]), T(L.centreline[1]));
    const ang = (Math.atan2(along.y, along.x) * 180) / Math.PI;
    const bit = clipPolygon(quad(L.kerb, L.farKerb).map(T), rect);
    if (bit.length > 2) hatch(doc, bit, aerial ? 'roadAerial' : 'road', { angle: ang });
    const fp = clipPolygon(quad(L.footpathNear, L.footpathFar).map(T), rect);
    if (fp.length > 2) hatch(doc, fp, 'footpath', { angle: ang + 90 });
    doc.setLineDashPattern([], 0);
    for (const [key, w, col] of [['footpathNear', 0.14, PEN.grey], ['footpathFar', 0.14, PEN.grey], ['kerb', 0.4, aerial ? [255, 255, 255] : PEN.road], ['gutter', 0.14, PEN.grey], ['farGutter', 0.14, PEN.grey], ['farKerb', 0.4, aerial ? [255, 255, 255] : PEN.road]]) {
      doc.setDrawColor(...col);
      doc.setLineWidth(w);
      clippedPolyline(doc, L[key].map(T), rect, false);
    }
    doc.setDrawColor(...PEN.phantom);
    doc.setLineWidth(0.5);
    doc.setLineDashPattern(PHANTOM, 0);
    clippedPolyline(doc, L.centreline.map(T), rect, false);
    doc.setLineDashPattern([], 0);
    // Street name along the far half of the carriageway, in the largest clear stretch
    const name = ROAD_NAME(lot, facts);
    if (name) {
      const half = (r.carriagewayM / 2 + r.gutterM) * 1000 / ds;
      const c0 = T(L.centreline[0]);
      const c1 = T(L.centreline[1]);
      const nrm = { x: -along.y, y: along.x };
      const farSide = G.dot(nrm, G.sub(T(L.farGutter[0]), c0)) >= 0 ? 1 : -1;
      const off = Math.min(half * 0.5, 6);
      for (const f of [0.5, 0.3, 0.7, 0.2, 0.8]) {
        const mid = G.lerp(c0, c1, f);
        const at = { x: mid.x + nrm.x * farSide * off, y: mid.y + nrm.y * farSide * off };
        const lab = alongLabel(doc, name, at, along, -TXT.strong * 0.3528 / 2, { size: TXT.strong, colour: PEN.road, bold: true, halo: HALO });
        if (field.inside(lab.box)) { doc.setFillColor(...(aerial ? [90, 90, 94] : [255, 255, 255])); doc.rect(lab.box.x0, lab.box.y0, lab.box.x1 - lab.box.x0, lab.box.y1 - lab.box.y0, 'F'); lab.draw(); roadBoxes.push(field.addBox(lab.box)); break; }
      }
    }
  }

  // 4. Proposed works: driveway and crossover, eaves, then the dwelling
  const drive = facts.drive;
  if (drive?.ok) {
    const dp = clipPolygon(drive.polygon.map(T), rect);
    if (dp.length > 2) { doc.setFillColor(255, 255, 255); polygon(doc, dp, 'F'); hatch(doc, dp, 'hardstand'); }
    ink(doc, PEN.proposed);
    doc.setLineWidth(0.4);
    stroke(drive.polygon);
    const cp = clipPolygon(drive.crossover.polygon.map(T), rect);
    if (cp.length > 2) { doc.setFillColor(255, 255, 255); polygon(doc, cp, 'F'); hatch(doc, cp, 'concrete'); }
    doc.setLineWidth(0.4);
    stroke(drive.crossover.polygon);
  }
  const overhang = Math.max(...project.levels.map((l) => l.roof?.overhang || 0), 0);
  if (facts.hull.length > 2 && overhang > 0) {
    doc.setDrawColor(...PEN.proposed);
    doc.setLineWidth(0.25);
    doc.setLineDashPattern([2.6, 1.4], 0);
    stroke(offsetPoly(facts.hull, overhang));
    doc.setLineDashPattern([], 0);
  }
  const ground = [...project.levels].sort((a, b) => a.elevation - b.elevation)[0];
  const footRings = [];
  for (const r of ground?.rooms || []) if (r.status !== 'demolish' && (!r.outdoor || r.roofed) && r.polygon?.length > 2) footRings.push(r.polygon);
  doc.setFillColor(255, 255, 255);
  for (const ring of footRings) polygon(doc, ring.map(T), 'F');
  for (const ring of footRings) hatch(doc, ring.map(T), 'proposed');
  ink(doc, PEN.proposed);
  doc.setLineWidth(0.55);
  for (const w of ground?.walls || []) {
    if (w.kind !== 'exterior' || w.status === 'demolish') continue;
    stroke(G.wallPolygon(w));
  }
  const houseSheet = facts.hull.length ? boxOfPts(facts.hull.map(T), 1.2) : null;
  if (houseSheet) field.addBox(houseSheet);

  // 5. Lot boundary. Existing: solid, with a cross at each corner. A proposed lot: long dash, dot in blue (never the existing convention).
  const proposedLot = !!lot.proposed;
  doc.setDrawColor(...(proposedLot ? PEN.proposed : pal.boundary));
  doc.setLineWidth(proposedLot ? 0.9 : 1.1);
  doc.setLineDashPattern(proposedLot ? PROPOSED_BOUNDARY : [], 0);
  stroke(lot.boundary);
  doc.setLineDashPattern([], 0);
  if (!proposedLot) {
    doc.setLineWidth(0.3);
    for (const c of lot.boundary.map(T)) {
      if (c.x < rect.x0 + 2 || c.x > rect.x1 - 2 || c.y < rect.y0 + 2 || c.y > rect.y1 - 2) continue;
      doc.line(c.x - 1.3, c.y - 1.3, c.x + 1.3, c.y + 1.3);
      doc.line(c.x - 1.3, c.y + 1.3, c.x + 1.3, c.y - 1.3);
    }
  }

  // 6. Envelope (indicative)
  if (lot.envelope?.length > 2) {
    doc.setDrawColor(...pal.envelope);
    doc.setLineWidth(0.5);
    doc.setLineDashPattern([4, 2], 0);
    stroke(lot.envelope);
    doc.setLineDashPattern([], 0);
    field.addRing(lot.envelope.map(T), true, true);
  }

  // 7. Setback dimensions to the house
  for (const row of facts.clear.rows) {
    if (!row.from || !row.to || row.clearanceM > 40) continue;
    const a = T(row.from);
    const b = T(row.to);
    if (Math.hypot(a.x - b.x, a.y - b.y) < 9) continue;
    const col = row.status === 'outside' ? PEN.envelope : PEN.dim;
    const bx = dimLine(doc, a, b, `${row.clearanceM.toFixed(2)} m`, { colour: col, size: TXT.body, textSide: 1 });
    field.addSeg(a, b);
    if (bx) field.addBox(bx);
  }

  // 8. FFL and NSL at the four corners of the house, each in a box clear of everything else with a leader to its corner
  if (facts.obox) {
    const floor = lot.floorRL;
    const hc = T(facts.obox.centre);
    for (const c of facts.obox.corners) {
      const nsl = lot.terrain ? terrainAt(lot.terrain, c.x, c.y) : null;
      if (floor == null && nsl == null) continue;
      const s = T(c);
      const lines = [];
      if (floor != null) lines.push(`FFL ${floor.toFixed(2)}`);
      if (nsl != null) lines.push(`NSL ${nsl.toFixed(1)}`);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(TXT.small);
      const w = Math.max(...lines.map((l) => doc.getTextWidth(l))) + 2.4;
      const h = lines.length * 3.1 + 1.4;
      const away = G.norm(G.sub(s, hc));
      doc.setFillColor(...PEN.proposed);
      doc.circle(s.x, s.y, 0.7, 'F');
      let done = false;
      for (const turn of [0, 35, -35, 70, -70, 110, -110]) {
        const d = turnBy(turn)(away);
        for (const dist of [4, 7, 11]) {
          const cx = s.x + d.x * (dist + w / 2 * Math.abs(d.x) + 0.5);
          const cy = s.y + d.y * (dist + h / 2 * Math.abs(d.y) + 0.5);
          const box = { x0: cx - w / 2, y0: cy - h / 2, x1: cx + w / 2, y1: cy + h / 2 };
          if (!field.free(box, { lines: true })) continue;
          doc.setDrawColor(...PEN.proposed);
          doc.setLineWidth(0.15);
          const ax = G.clamp(s.x, box.x0, box.x1);
          const ay = G.clamp(s.y, box.y0, box.y1);
          doc.line(ax, ay, s.x, s.y);
          doc.setFillColor(255, 255, 255);
          doc.rect(box.x0, box.y0, w, h, 'FD');
          doc.setFont('helvetica', 'bold');
          doc.setFontSize(TXT.small);
          doc.setTextColor(...PEN.proposed);
          lines.forEach((l, i) => doc.text(l, box.x0 + 1.2, box.y0 + 3.3 + i * 3.1));
          field.addBox(box);
          done = true;
          break;
        }
        if (done) break;
      }
    }
  }

  // 9. Boundary bearings (outside the lot) and distances (inside). Each is tried at several places along the edge and on both
  // sides, and drawn only where it touches no other label or dimension.
  const dims = boundaryDims(lot);
  const lotPoly = lot.boundary.map(T);
  const centre = T(G.polygonCentroid(lot.boundary));
  const bcol = proposedLot ? PEN.proposed : pal.boundary;
  for (const d of dims) {
    const a = lotPoly[d.index];
    const b = lotPoly[(d.index + 1) % lotPoly.length];
    const lenMm = Math.hypot(b.x - a.x, b.y - a.y);
    if (lenMm < 12) continue;
    const dir = dirOf(a, b);
    const readDir = dir.x < 0 || (Math.abs(dir.x) < 1e-9 && dir.y > 0) ? { x: -dir.x, y: -dir.y } : dir;
    const readUp = { x: readDir.y, y: -readDir.x };
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const sideOut = G.dot(readUp, G.sub(mid, centre)) > 0 ? 1 : -1;
    const spec = (txt, side, bold, off) => (f) => () => {
      const m = G.lerp(a, b, f);
      return alongLabel(doc, txt, m, dir, side * off, { size: TXT.label, colour: bcol, bold, halo: HALO });
    };
    const offs = [1.4 + TXT.label * 0.3528 * 0.2, 1.4 + TXT.label * 0.3528 + 0.6];
    const fr = [0.5, 0.32, 0.68, 0.18, 0.82, 0.42, 0.58, 0.1, 0.9];
    const bearing = []; const length = [];
    for (const off of offs) for (const f of fr) { bearing.push(spec(d.bearing, sideOut, true, off + 1.2)(f)); length.push(spec(`${d.length} m`, -sideOut, false, off + 0.9)(f)); }
    // The length may also go on the bearing side, below it, when its own side is full.
    for (const f of fr) length.push(spec(`${d.length} m`, sideOut, false, offs[1] + 4.2)(f));
    field.place(bearing, { lines: true });
    field.place(length, { lines: true });
  }

  // 10. Contour RL labels
  for (const { c, pts } of contourLabels) {
    const segs = [];
    let total = 0;
    for (let i = 0; i + 1 < pts.length; i++) {
      const s = clipSegment(pts[i], pts[i + 1], rect);
      if (s) { const len = Math.hypot(s[1].x - s[0].x, s[1].y - s[0].y); segs.push({ s, len }); total += len; }
    }
    if (total < 26) continue;
    for (const f of [0.5, 0.3, 0.7, 0.18, 0.82, 0.4, 0.6]) {
      let at = total * f;
      let seg = null;
      for (const g of segs) { if (at <= g.len) { seg = g; break; } at -= g.len; }
      if (!seg || seg.len < 10) continue;
      const t = at / seg.len;
      const p = { x: seg.s[0].x + (seg.s[1].x - seg.s[0].x) * t, y: seg.s[0].y + (seg.s[1].y - seg.s[0].y) * t };
      const txt = Number(c.level).toFixed(1);
      doc.setFont('helvetica', c.major ? 'bold' : 'normal');
      doc.setFontSize(TXT.min);
      const w = doc.getTextWidth(txt) + 1.4;
      const box = boxOfPts([{ x: p.x - w / 2, y: p.y - 1.9 }, { x: p.x + w / 2, y: p.y + 1.9 }]);
      if (!field.free(box, { lines: false })) continue;
      field.addBox(box);
      haloText(doc, txt, p.x, p.y + 0.9, { size: TXT.min, bold: !!c.major, colour: c.major ? PEN.contourMajor : [150, 108, 50], align: 'center', halo: HALO });
      break;
    }
  }

  // 11. Neighbour labels: lot number, then the DP one size larger beneath it
  for (const nb of lot.neighbours || []) {
    if (nb.isRoad || !nb.ring?.length) continue;
    const l1 = nb.lotNumber ? `LOT ${nb.lotNumber}` : '';
    const l2 = nb.planLabel || '';
    if (!l1 && !l2) continue;
    const ring = nb.ring.map(T);
    const c0 = T(G.polygonCentroid(nb.ring));
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(TXT.label);
    const w1 = l1 ? doc.getTextWidth(l1) : 0;
    doc.setFontSize(TXT.strong);
    const w2 = l2 ? doc.getTextWidth(l2) : 0;
    const w = Math.max(w1, w2);
    const h = (l1 ? 3.6 : 0) + (l2 ? 4.2 : 0);
    const bb = G.bbox(ring);
    const cands = [[0, 0], [0, -0.18], [0, 0.18], [-0.18, 0], [0.18, 0], [-0.18, -0.18], [0.18, 0.18], [0.18, -0.18], [-0.18, 0.18]].map(([dx, dy]) => ({ x: c0.x + dx * bb.w, y: c0.y + dy * bb.h }));
    // Lots cut by the viewport edge (across the road, or behind the lot): try the visible part of the lot as well
    const vx0 = Math.max(bb.minX, rect.x0); const vx1 = Math.min(bb.maxX, rect.x1); const vy0 = Math.max(bb.minY, rect.y0); const vy1 = Math.min(bb.maxY, rect.y1);
    if (vx1 > vx0 && vy1 > vy0) for (const fx of [0.5, 0.3, 0.7, 0.15, 0.85]) for (const fy of [0.5, 0.3, 0.7, 0.15, 0.85]) cands.push({ x: vx0 + (vx1 - vx0) * fx, y: vy0 + (vy1 - vy0) * fy });
    for (const s of cands) {
      const b = { x0: s.x - w / 2 - 0.5, y0: s.y - h / 2 - 0.5, x1: s.x + w / 2 + 0.5, y1: s.y + h / 2 + 0.5 };
      if (!field.free(b, { lines: false })) continue;
      if (![{ x: b.x0, y: b.y0 }, { x: b.x1, y: b.y0 }, { x: b.x1, y: b.y1 }, { x: b.x0, y: b.y1 }].every((q) => G.pointInPolygon(q, ring))) continue;
      field.addBox(b);
      let y = b.y0 + 0.5;
      if (l1) { haloText(doc, l1, s.x, y + 3, { size: TXT.label, bold: true, colour: aerial ? [30, 30, 34] : PEN.neighbour, align: 'center', halo: HALO }); y += 3.6; }
      if (l2) haloText(doc, l2, s.x, y + 3.4, { size: TXT.strong, bold: true, colour: aerial ? [30, 30, 34] : PEN.neighbour, align: 'center', halo: HALO });
      break;
    }
  }

  // 12. The lot's own label, inside the boundary and clear of the house
  const ll = lotIdLines(project, lot);
  const lotLines = [ll.first, ll.second, siteAreaOf(lot).m2 ? fmtArea(siteAreaOf(lot).m2) : ''].filter(Boolean);
  const sizes = [TXT.strong + 3, TXT.strong + 4, TXT.label];
  const lb = G.bbox(lotPoly);
  let lotLabelBox = null;
  for (const c of [{ x: 0.5, y: 0.1 }, { x: 0.5, y: 0.92 }, { x: 0.5, y: 0.5 }, { x: 0.25, y: 0.12 }, { x: 0.75, y: 0.12 }, { x: 0.25, y: 0.9 }, { x: 0.75, y: 0.9 }, { x: 0.2, y: 0.5 }, { x: 0.8, y: 0.5 }]) {
    const p = { x: lb.minX + lb.w * c.x, y: lb.minY + lb.h * c.y };
    doc.setFont('helvetica', 'bold');
    const w = Math.max(...lotLines.map((l, i) => { doc.setFontSize(sizes[i] || TXT.label); return doc.getTextWidth(clean(l)); })) + 3;
    const h = lotLines.length * 5.6 + 1.4;
    const b = { x0: p.x - w / 2, y0: p.y - h / 2, x1: p.x + w / 2, y1: p.y + h / 2 };
    const corners = [{ x: b.x0, y: b.y0 }, { x: b.x1, y: b.y0 }, { x: b.x1, y: b.y1 }, { x: b.x0, y: b.y1 }];
    if (!corners.every((q) => G.pointInPolygon(q, lotPoly))) continue;
    if (!field.free(b, { soft: false })) continue;
    lotLabelBox = b;
    break;
  }
  if (lotLabelBox) {
    field.addBox(lotLabelBox);
    const cx = (lotLabelBox.x0 + lotLabelBox.x1) / 2;
    lotLines.forEach((l, i) => haloText(doc, l, cx, lotLabelBox.y0 + 5 + i * 5.6, { size: sizes[i] || TXT.label, bold: true, colour: bcol, align: 'center', halo: HALO }));
  }

  // 13. Call outs
  const items = [];
  const hc = facts.obox ? T(facts.obox.centre) : null;
  const footprint = footRings.reduce((a, r) => a + G.polygonArea(r) / 1e6, 0);
  if (hc) items.push({ id: 'house', lines: ['PROPOSED DWELLING', lot.floorRL != null ? `FFL ${lot.floorRL.toFixed(2)} (${lot.floorRLAuto ? 'assumed' : 'set'})` : 'FFL to be set', `Footprint ${footprint.toFixed(0)} m²`], at: hc, colour: PEN.proposed });
  if (drive?.ok) {
    items.push({ id: 'drive', lines: ['PROPOSED DRIVEWAY', `${(drive.widthMm / 1000).toFixed(1)} m wide, concrete`], at: T(drive.centre[Math.floor(drive.centre.length * 0.55)]), colour: PEN.proposed });
    items.push({ id: 'cross', lines: ['PROPOSED CROSSOVER', 'Council approval required'], at: T(G.lerp(drive.crossover.from, drive.crossover.to, 0.5)), colour: PEN.proposed });
  }
  if (facts.reserve[0]) {
    // Road call outs point at the part of the road that is on the sheet (the reserve lines run on past the viewport edge).
    const L = facts.reserve[0].lines;
    const visible = (line, f) => { const c = clipSegment(T(line[0]), T(line[1]), { x0: rect.x0 + 12, y0: rect.y0 + 12, x1: rect.x1 - 12, y1: rect.y1 - 12 }); return c ? G.lerp(c[0], c[1], f) : null; };
    const ph = visible(L.centreline, 0.8);
    const kb = visible(L.kerb, 0.2);
    if (ph) items.push({ id: 'phantom', lines: ['ROAD CENTRELINE', 'Indicative'], at: ph, colour: PEN.phantom });
    if (kb) items.push({ id: 'kerb', lines: ['KERB AND GUTTER', 'Existing, assumed'], at: kb, colour: aerial ? [40, 42, 48] : PEN.road });
  }
  if (lot.envelope?.length > 2) {
    const e = lot.envelope;
    const top = e.reduce((a, p) => (T(p).y < T(a).y ? p : a), e[0]);
    items.push({ id: 'env', lines: ['INDICATIVE SETBACK ENVELOPE', 'Check with council'], at: T(G.lerp(top, e[(e.indexOf(top) + 1) % e.length], 0.5)), colour: pal.envelope });
  }
  const bd = dims.find((d) => d.index === (facts.reserve[0]?.edge ?? 0)) || dims[0];
  if (bd) {
    const at = T(G.lerp(lot.boundary[(bd.index + 2) % lot.boundary.length], lot.boundary[(bd.index + 3) % lot.boundary.length], 0.3));
    items.push({ id: 'bnd', lines: [proposedLot ? 'LOT BOUNDARY (PROPOSED)' : 'LOT BOUNDARY (EXISTING)', `${ll.first} ${ll.second}`.trim()], at, colour: bcol });
  }
  const avoid = [...field.segs];
  const addRing = (pts) => pts.forEach((q, i) => avoid.push([T(q), T(pts[(i + 1) % pts.length])]));
  addRing(lot.boundary);
  if (drive?.ok) { addRing(drive.polygon); addRing(drive.crossover.polygon); }
  const placed = placeCallouts(doc, items.filter((it) => it.at.x > rect.x0 + 4 && it.at.x < rect.x1 - 4 && it.at.y > rect.y0 + 4 && it.at.y < rect.y1 - 4), { obstacles: [...field.boxes], avoid, area: rect, size: TXT.body });
  drawCallouts(doc, placed.map((p) => ({ ...p, size: TXT.body })));

  // View title in a white tab at the top left
  doc.setFillColor(255, 255, 255);
  doc.rect(vp.x0, vp.y0, 80, 13, 'F');
  viewTitle(doc, vp.x0 + 3, vp.y0 + 9, 'Site plan', label, { size: TXT.title });
  ink(doc, PEN.ink);
  doc.setLineDashPattern([], 0);
  doc.setLineWidth(0.5);
  doc.rect(vp.x0, vp.y0, vp.x1 - vp.x0, vp.y1 - vp.y0);
  return { n, ds, label, T, turnDeg: view.turnDeg, northDeg: view.northDeg, focus: view.focus, windowPlan: view.windowPlan, facts, aerial, palette: pal };
}

function noLotMessage(doc, ctx, vp) {
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  ink(doc, PEN.grey);
  doc.text('NO LOT LOADED', (vp.x0 + vp.x1) / 2, (vp.y0 + vp.y1) / 2 - 4, { align: 'center' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(TXT.body);
  doc.text('Use Find my block to load the lot, its setbacks and ground levels. This sheet then shows the site plan.', (vp.x0 + vp.x1) / 2, (vp.y0 + vp.y1) / 2 + 3, { align: 'center' });
  doc.setLineWidth(0.5);
  doc.rect(vp.x0, vp.y0, vp.x1 - vp.x0, vp.y1 - vp.y0);
  viewTitle(doc, vp.x0 + 3, vp.y0 + 8.4, 'Site plan', 'NTS', { size: TXT.title });
  return { n: null, ds: null, label: 'NTS', T: null, turnDeg: 0, northDeg: ctx.project.site?.northDeg || 0, facts: null, aerial: false };
}

// Right hand panel: north point, key plan, legend, notes ---------------------------------------------------------------------
export function drawSitePanel(doc, ctx, site) {
  const { project } = ctx;
  const x0 = SITE_VP.x1 + 3;
  const x1 = BODY.x1;
  const w = x1 - x0;
  let y = BODY.y0;
  const aerial = !!site?.aerial;
  const pal = site?.palette || paletteFor(false);

  // North point, scale text and scale bar
  doc.setLineWidth(0.5);
  ink(doc, PEN.ink);
  doc.rect(x0, y, w, NORTH_H);
  northArrow(doc, x0 + 16, y + 17, site?.northDeg ?? (project.site?.northDeg || 0));
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(TXT.strong);
  doc.text(clean(site?.label ? `SCALE ${site.label}` : 'NOT TO SCALE'), x0 + 34, y + 9);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(TXT.small);
  ink(doc, PEN.grey);
  doc.text('North is MGA grid north.', x0 + 34, y + 14.5);
  doc.text(Math.abs(site?.turnDeg || 0) < 0.5 ? 'Plan up is north.' : 'Plan is turned to the street. See north point.', x0 + 34, y + 19);
  if (site?.n) {
    // A bar of four parts that fits the panel beside the north arrow
    const maxW = x1 - (x0 + 34) - 8;
    const segM = [1, 2, 5, 10, 20, 25, 50].filter((m) => (m * 1000 * 4) / site.ds <= maxW).at(-1) || 1;
    const seg = (segM * 1000) / site.ds;
    doc.setLineWidth(0.2);
    for (let i = 0; i < 4; i++) { doc.setFillColor(...(i % 2 ? [255, 255, 255] : PEN.ink)); ink(doc, PEN.ink); doc.rect(x0 + 34 + i * seg, y + 25, seg, 2, 'FD'); }
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(TXT.small);
    doc.setTextColor(...PEN.ink);
    for (let i = 0; i <= 4; i++) doc.text(String(segM * i), x0 + 34 + i * seg, y + 31, { align: 'center' });
    doc.text('m', x0 + 34 + 4 * seg + 3.5, y + 31);
  }
  y += NORTH_H + 3;

  // Key plan
  doc.setLineWidth(0.5);
  ink(doc, PEN.ink);
  doc.rect(x0, y, w, KEY_H);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(TXT.label);
  doc.text('KEY PLAN', x0 + 2, y + 5.4);
  drawLocality(doc, keyBox(), ctx, { key: true, window: site?.focus ? site.windowPlan : null });
  y += KEY_H + 3;

  // Legend
  const sw = 14;
  const sample = (fn) => (cx, cy) => fn(cx, cy);
  const rectP = (cx, cy) => [{ x: cx, y: cy - 1.8 }, { x: cx + sw, y: cy - 1.8 }, { x: cx + sw, y: cy + 1.8 }, { x: cx, y: cy + 1.8 }];
  const items = [
    [site?.facts?.lot?.proposed ? 'Lot boundary (proposed)' : 'Lot boundary (existing)', sample((cx, cy) => { doc.setDrawColor(...(site?.facts?.lot?.proposed ? PEN.proposed : pal.boundary)); doc.setLineWidth(site?.facts?.lot?.proposed ? 0.9 : 1.1); doc.setLineDashPattern(site?.facts?.lot?.proposed ? PROPOSED_BOUNDARY : [], 0); doc.line(cx, cy, cx + sw, cy); doc.setLineDashPattern([], 0); })],
    [aerial ? 'Neighbouring lots (cadastre)' : 'Neighbouring lot boundary', sample((cx, cy) => { doc.setDrawColor(...pal.neighbour); doc.setLineWidth(pal.neighbourW + 0.1); doc.line(cx, cy, cx + sw, cy); })],
    ['Indicative setback envelope', sample((cx, cy) => { doc.setDrawColor(...pal.envelope); doc.setLineWidth(0.5); doc.setLineDashPattern([4, 2], 0); doc.line(cx, cy, cx + sw, cy); doc.setLineDashPattern([], 0); })],
    ['Road centreline (phantom, indicative)', sample((cx, cy) => { doc.setDrawColor(...PEN.phantom); doc.setLineWidth(0.5); doc.setLineDashPattern([5, 1.2, 1.2, 1.2, 1.2, 1.2], 0); doc.line(cx, cy, cx + sw, cy); doc.setLineDashPattern([], 0); })],
    ['Kerb and gutter', sample((cx, cy) => { doc.setDrawColor(...PEN.road); doc.setLineWidth(0.4); doc.line(cx, cy, cx + sw, cy); })],
    ['Contour (minor, major)', sample((cx, cy) => { doc.setDrawColor(...PEN.contourMinor); doc.setLineWidth(0.12); doc.line(cx, cy - 0.9, cx + 6, cy - 0.9); doc.setDrawColor(...PEN.contourMajor); doc.setLineWidth(0.28); doc.line(cx + 7, cy + 0.9, cx + sw, cy + 0.9); })],
    ['Dimension to boundary', sample((cx, cy) => { doc.setDrawColor(...PEN.dim); doc.setLineWidth(0.13); doc.line(cx, cy, cx + sw, cy); doc.setLineWidth(0.25); doc.line(cx, cy - 1, cx, cy + 1); doc.line(cx + sw, cy - 1, cx + sw, cy + 1); })],
    ['Proposed works', sample((cx, cy) => { const p = rectP(cx, cy); hatch(doc, p, 'proposed'); doc.setDrawColor(...PEN.proposed); doc.setLineWidth(0.4); polygon(doc, p, 'S'); })],
    ['Hardstand (driveway)', sample((cx, cy) => hatch(doc, rectP(cx, cy), 'hardstand'))],
    ['Concrete (crossover)', sample((cx, cy) => hatch(doc, rectP(cx, cy), 'concrete'))],
    ['Road pavement', sample((cx, cy) => { const q = rectP(cx, cy); hatch(doc, q, 'road', { angle: 0, width: 0.12, colour: [90, 94, 102] }); doc.setDrawColor(...PEN.road); doc.setLineWidth(0.3); doc.line(cx, cy - 1.8, cx + sw, cy - 1.8); doc.line(cx, cy + 1.8, cx + sw, cy + 1.8); })],
    ['Footpath', sample((cx, cy) => hatch(doc, rectP(cx, cy), 'footpath'))],
  ];
  const lh = 5.2;
  const legH = 9 + items.length * lh;
  doc.setLineWidth(0.5);
  ink(doc, PEN.ink);
  doc.rect(x0, y, w, legH);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(TXT.label);
  doc.text('LEGEND', x0 + 2, y + 5.4);
  items.forEach(([name, draw], i) => {
    const cy = y + 10 + i * lh;
    draw(x0 + 3, cy);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(TXT.small);
    doc.setTextColor(...PEN.ink);
    doc.text(clean(name), x0 + 3 + sw + 3, cy + 0.9);
  });
  y += legH + 3;

  // Notes
  const notes = siteNotes(project, { aerial, sheet: ctx.analysisNumber, focus: !!site?.focus });
  const nh = BODY.y1 - y;
  doc.setLineWidth(0.5);
  ink(doc, PEN.ink);
  doc.rect(x0, y, w, nh);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(TXT.label);
  doc.text('NOTES', x0 + 2, y + 5.4);
  let ty = y + 10;
  const lineH = 2.75;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(TXT.min);
  for (let i = 0; i < notes.length; i++) {
    const lines = wrap(doc, `${i + 1}. ${notes[i]}`, w - 5);
    if (ty + lines.length * lineH > y + nh - 1) break;
    lines.forEach((l, j) => doc.text(l, x0 + 2 + (j ? 2.4 : 0), ty + j * lineH));
    ty += lines.length * lineH + 1.1;
  }
}

export function siteNotes(project, { aerial = false, sheet = null, focus = false } = {}) {
  const lot = project.site?.lot || null;
  const out = [
    'Concept only. To be verified by a suitably qualified person before any use for approval or construction.',
    'Boundaries are from the cadastre, are indicative only, and are not a survey. A registered survey is required.',
  ];
  if (focus) out.push('Large lot: this sheet shows the house and its surrounds. The whole lot is shown on the key plan, with the area covered by this sheet outlined.');
  if (aerial) out.push('The aerial underlay is reduced in resolution and is for orientation only. It is not for measurement. Cadastre drawn in red over the aerial.');
  if (lot?.setbacks) out.push(`Setbacks are indicative${lot.setbacks.council ? ` (${clean(lot.setbacks.council)})` : ''}. The sources, the figures provided and the items to confirm are on ${sheet ? `sheet ${sheet}` : 'the site analysis sheet'}. A figure marked check with council is not confirmed.`);
  else if (lot) out.push('Council setbacks are not loaded for this lot. The envelope is not shown.');
  if (lot?.terrain || lot?.contours?.length) out.push(`Levels are indicative only, from the ${lot.state === 'QLD' ? 'Queensland' : 'NSW'} 5 m DEM, and are not survey. Contours are at 1.0 m intervals and spot levels are to 0.1 m. A registered survey is required.`);
  if (lot?.floorRL != null) out.push(`FFL ${lot.floorRL.toFixed(2)} m AHD ${lot.floorRLAuto ? 'is assumed from the ground level at the house, not designed' : 'as set by the designer'}. NSL is the natural surface level from the terrain model at each house corner.`);
  if (lot?.floorRL != null && lot?.terrain) {
    const bx = orientedBox(buildingHull(project));
    if (bx) {
      const hw = bx.w / 2; const hd = bx.d / 2;
      const cut = [[-1, -1], [1, -1], [1, 1], [-1, 1]].some(([a, b]) => {
        const rl = terrainAt(lot.terrain, bx.centre.x + bx.u.x * hw * a + bx.v.x * hd * b, bx.centre.y + bx.u.y * hw * a + bx.v.y * hd * b);
        return rl != null && rl > lot.floorRL + 0.05;
      });
      if (cut) out.push('FFL is below the natural surface at one or more house corners. Cut is required at those corners: refer to site works.');
    }
  }
  out.push('Services, easements, trees, flood and bushfire overlays are not shown. Before You Dig Australia plans and a section 10.7 or equivalent certificate are required.');
  out.push('Driveway and crossover are indicative. Crossover location, width and levels need council approval.');
  return out;
}

// Locality map ----------------------------------------------------------------------------------------------------------------
const LOCALITY_SCALES = [500, 1000, 2000, 2500, 5000, 10000, 20000, 25000, 50000];

/**
 * The locality view for a box: north up, zoomed out to take in the surrounding cadastre (at least minSpanM across) at a standard scale.
 * Large lots set the scale from the lot itself. opts.extent (plan mm) is the aerial that exists: the view then stays inside it so the
 * frame is full of picture. opts.ideal true ignores the extent and returns the view the map would like, with `window` (plan mm) as the
 * ground it covers, so a wider aerial can be requested for it.
 * Returns { T, n, ds, box, window }.
 */
export function localityView(project, box, { minSpanM = 280, k = 1, extent = null, ideal = false } = {}) {
  const lot = project.site?.lot;
  if (!lot?.boundary?.length) return null;
  const w = box.x1 - box.x0;
  const h = box.y1 - box.y0;
  const lb = G.bbox(lot.boundary);
  const lc = G.polygonCentroid(lot.boundary);
  // The context cadastre sets the scale for a small lot; a long run of lots must not push the map out to a tiny scale
  const near = (lot.neighbours || []).filter((q) => q.ring?.length && Math.hypot(...Object.values(G.sub(G.polygonCentroid(q.ring), lc))) < Math.max(minSpanM * 600, lb.w + lb.h));
  const nb = G.bbox([...lot.boundary, ...near.flatMap((q) => q.ring)]);
  const bigLot = Math.max(lb.w, lb.h) > minSpanM * 1000 * 0.6;
  // A large lot is shown whole with a border of its own size; a small one is shown with the street around it
  const needW = bigLot ? Math.max(lb.w * 1.18, lb.w + 60000) : Math.max(minSpanM * 1000, nb.w * 1.15);
  const needH = bigLot ? Math.max(lb.h * 1.18, lb.h + 60000 * (h / w)) : Math.max(minSpanM * 1000 * (h / w), nb.h * 1.15);
  let n = LOCALITY_SCALES.find((s) => needW / (s * k) <= w && needH / (s * k) <= h) || LOCALITY_SCALES.at(-1);
  if (extent && !ideal) {
    // Stay inside the picture: the largest standard scale whose window fits the aerial, but never one that cuts the lot off
    const ew = extent.x1 - extent.x0;
    const eh = extent.y1 - extent.y0;
    const fits = (s) => w * s * k <= ew * 1.001 && h * s * k <= eh * 1.001;
    const lotFits = (s) => (lb.w * 1.02) / (s * k) <= w && (lb.h * 1.02) / (s * k) <= h;
    if (!fits(n)) {
      const ok = LOCALITY_SCALES.filter((s) => fits(s) && lotFits(s));
      n = ok.length ? Math.max(...ok) : LOCALITY_SCALES.filter(lotFits).find((s) => s >= 1) || n;
    }
  }
  const ds = n * k;
  const cx = (box.x0 + box.x1) / 2;
  const cy = (box.y0 + box.y1) / 2;
  const span = { x: (w * ds) / 2, y: (h * ds) / 2 };
  // Centre on the middle of the cadastre (the lot for a large lot), keeping the subject lot well inside the view
  const mid = bigLot ? { x: (lb.minX + lb.maxX) / 2, y: (lb.minY + lb.maxY) / 2 } : { x: (nb.minX + nb.maxX) / 2, y: (nb.minY + nb.maxY) / 2 };
  const c = { x: G.clamp(mid.x, lc.x - span.x * 0.4, lc.x + span.x * 0.4), y: G.clamp(mid.y, lc.y - span.y * 0.4, lc.y + span.y * 0.4) };
  if (extent && !ideal) {
    if (extent.x1 - extent.x0 >= 2 * span.x) c.x = G.clamp(c.x, extent.x0 + span.x, extent.x1 - span.x);
    if (extent.y1 - extent.y0 >= 2 * span.y) c.y = G.clamp(c.y, extent.y0 + span.y, extent.y1 - span.y);
  }
  return { n, ds, T: (p) => ({ x: cx + (p.x - c.x) / ds, y: cy + (p.y - c.y) / ds }), box, window: { x0: c.x - span.x, y0: c.y - span.y, x1: c.x + span.x, y1: c.y + span.y } };
}

/**
 * Surrounding lots (DCDB), street names, the subject lot and the house, with the aerial under them when one was supplied, and an
 * arrow towards the nearest town centre. Drawn to fit `box`. opts.key gives the small key plan on the site sheet.
 */
export function drawLocality(doc, box, ctx, { key = false, window: win = null } = {}) {
  const { project } = ctx;
  const lot = project.site?.lot;
  const w = box.x1 - box.x0;
  const h = box.y1 - box.y0;
  doc.setFillColor(248, 249, 250);
  doc.setDrawColor(...PEN.light);
  doc.setLineWidth(0.15);
  doc.rect(box.x0, box.y0, w, h, 'FD');
  if (!lot) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(TXT.body);
    ink(doc, PEN.grey);
    doc.text('Locality not loaded', (box.x0 + box.x1) / 2, (box.y0 + box.y1) / 2, { align: 'center' });
    return null;
  }
  const view = localityView(project, box, { minSpanM: key ? 400 : 280, k: ctx.k || 1, extent: ctx.locExtent || null });
  const { T } = view;
  const under = ctx.underlays?.[key ? 'key' : 'cover'];
  const aerial = !!(under?.url && placeUnderlay(doc, under.url, box));
  const pal = paletteFor(aerial);
  const rect = { x0: box.x0 + 0.3, y0: box.y0 + 0.3, x1: box.x1 - 0.3, y1: box.y1 - 0.3 };
  const field = new LabelField(rect);
  const small = key ? TXT.min : TXT.body;

  // Streets: the frontage road through the box, and any named roads the lookup returned
  const facts = siteFacts(project);
  const streets = [];
  for (const r of facts?.reserve || []) {
    const c0 = r.lines.centreline[0];
    const c1 = r.lines.centreline[1];
    const dir = G.norm(G.sub(c1, c0));
    const mid = G.lerp(c0, c1, 0.5);
    const reach = (view.ds * Math.max(w, h)) * 1.2;
    streets.push({ name: ROAD_NAME(lot, facts), pts: [G.add(mid, G.mul(dir, -reach)), G.add(mid, G.mul(dir, reach))], widthMm: (r.vergeM * 2 + r.gutterM * 2 + r.carriagewayM) * 1000 });
  }
  for (const rd of (ctx.locRoads || lot.roads || [])) {
    const pts = ptsOf(rd.pts || []);
    if (pts.length > 1 && rd.name && rd.name.toUpperCase() !== (streets[0]?.name || '')) streets.push({ name: clean(rd.name).toUpperCase(), pts, widthMm: 18000 });
  }
  for (const s of streets) {
    const strip = [];
    const L = s.pts;
    for (let i = 0; i + 1 < L.length; i++) {
      const d = G.norm(G.sub(L[i + 1], L[i]));
      const nrm = { x: -d.y, y: d.x };
      const a = G.add(L[i], G.mul(nrm, s.widthMm / 2));
      const b = G.add(L[i + 1], G.mul(nrm, s.widthMm / 2));
      const c = G.add(L[i + 1], G.mul(nrm, -s.widthMm / 2));
      const e = G.add(L[i], G.mul(nrm, -s.widthMm / 2));
      const q = clipPolygon([a, b, c, e].map(T), rect);
      if (q.length > 2) { doc.setFillColor(aerial ? 255 : 226, aerial ? 255 : 228, aerial ? 255 : 232); polygon(doc, q, 'F'); }
    }
  }
  // Surrounding cadastre (the wider set when the host supplied one for the locality)
  doc.setDrawColor(...pal.neighbour);
  doc.setLineWidth(key ? 0.12 : pal.neighbourW);
  for (const nb of ctx.locNeighbours || lot.neighbours || []) clippedPolyline(doc, (nb.ring || []).map(T), rect, true);
  const own = clipPolygon(lot.boundary.map(T), rect);
  if (own.length > 2 && !aerial) { doc.setFillColor(205, 232, 214); polygon(doc, own, 'F'); }
  doc.setDrawColor(...(lot.proposed ? PEN.proposed : pal.boundary));
  doc.setLineWidth(key ? 0.6 : 0.9);
  clippedPolyline(doc, lot.boundary.map(T), rect, true);
  const hull = buildingHull(project);
  if (hull.length > 2) { doc.setFillColor(...PEN.proposed); polygon(doc, hull.map(T), 'F'); }

  // Street names along the road, in a clear stretch
  if (!key) {
    for (const s of streets) {
      if (!s.name) continue;
      const a = T(s.pts[0]);
      const b = T(s.pts[1]);
      const clip = clipSegment(a, b, rect);
      if (!clip) continue;
      const dir = dirOf(clip[0], clip[1]);
      for (const f of [0.22, 0.78, 0.5, 0.1, 0.9]) {
        const m = G.lerp(clip[0], clip[1], f);
        const lab = alongLabel(doc, s.name, m, dir, -TXT.body * 0.3528 / 2, { size: TXT.body, bold: true, colour: PEN.road, halo: 1.1 });
        if (field.free(lab.box, { lines: false })) { lab.draw(); field.addBox(lab.box); break; }
      }
    }
  }

  // Direction to the nearest town centre
  const q = lot.query || null;
  const town = q ? nearestTown(q.lon, q.lat) : null;
  if (town && town.km >= 0.4 && !key) {
    const north = rad(Number(project.site?.northDeg) || 0);
    // Bearing is from true north; the plan's up is MGA grid north (the difference is under a degree here).
    const th = rad(town.bearingDeg) - north;
    const d = { x: Math.sin(th), y: -Math.cos(th) };
    const c = { x: (box.x0 + box.x1) / 2, y: (box.y0 + box.y1) / 2 };
    const reachX = Math.abs(d.x) > 1e-6 ? (w / 2 - 14) / Math.abs(d.x) : 1e9;
    const reachY = Math.abs(d.y) > 1e-6 ? (h / 2 - 12) / Math.abs(d.y) : 1e9;
    const r0 = Math.min(reachX, reachY);
    const tip = { x: c.x + d.x * r0, y: c.y + d.y * r0 };
    const tail = { x: tip.x - d.x * 18, y: tip.y - d.y * 18 };
    doc.setDrawColor(...PEN.ink);
    doc.setLineWidth(0.8);
    doc.line(tail.x, tail.y, tip.x, tip.y);
    const px = -d.y;
    const py = d.x;
    doc.setFillColor(...PEN.ink);
    polygon(doc, [{ x: tip.x + d.x * 4, y: tip.y + d.y * 4 }, { x: tip.x + px * 2.2, y: tip.y + py * 2.2 }, { x: tip.x - px * 2.2, y: tip.y - py * 2.2 }], 'F');
    const txt = `${clean(town.name).toUpperCase()} TOWN CENTRE, ${town.km.toFixed(1)} km ${town.compass}`;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(TXT.body);
    const tw = doc.getTextWidth(txt) + 4;
    const bx = G.clamp(tail.x - tw / 2, rect.x0 + 1, rect.x1 - tw - 1);
    const by = G.clamp(tail.y - d.y * 6, rect.y0 + 8, rect.y1 - 9);
    doc.setFillColor(255, 255, 255);
    doc.setDrawColor(...PEN.ink);
    doc.setLineWidth(0.25);
    doc.rect(bx, by - 4.6, tw, 6.8, 'FD');
    doc.setTextColor(...PEN.ink);
    doc.text(txt, bx + 2, by);
  }

  // The ground the site plan sheet covers, on the key plan of a large lot
  if (win && win.length > 2) {
    const q = win.map(T);
    doc.setDrawColor(255, 255, 255);
    doc.setLineWidth(1.3);
    clippedPolyline(doc, q, rect, true);
    doc.setDrawColor(...PEN.ink);
    doc.setLineWidth(0.5);
    doc.setLineDashPattern([2, 1], 0);
    clippedPolyline(doc, q, rect, true);
    doc.setLineDashPattern([], 0);
  }

  // Captions: "LOT 3" and, on the next line one size larger, "DP 263990"
  const ll = lotIdLines(project, lot);
  const sz1 = small;
  const sz2 = small + (key ? 0.8 : 1.6);
  const lines = [[ll.first, sz1], [ll.second, sz2]].filter((q) => q[0]);
  doc.setFont('helvetica', 'bold');
  let cw = 0;
  for (const [t, z] of lines) { doc.setFontSize(z); cw = Math.max(cw, doc.getTextWidth(clean(t))); }
  const lh1 = sz1 * 0.3528 * 1.25;
  const lh2 = sz2 * 0.3528 * 1.25;
  const ch = (lines[0] ? lh1 : 0) + (lines[1] ? lh2 : 0) + 1.6;
  doc.setFillColor(255, 255, 255);
  doc.rect(box.x0 + 1, box.y1 - 1 - ch, cw + 2.4, ch, 'F');
  doc.setTextColor(...(lot.proposed ? PEN.proposed : pal.boundary));
  let ty = box.y1 - 1 - ch + 0.8;
  for (const [t, z] of lines) { doc.setFontSize(z); ty += z * 0.3528 * 1.0; doc.text(clean(t), box.x0 + 2.2, ty); ty += z * 0.3528 * 0.25; }
  const scaleText = key ? 'NTS' : `1:${view.n} @ ${ctx.paper || 'A3'}`;
  doc.setFont('helvetica', 'normal');
  const sw2 = doc.getTextWidth(scaleText) + 2.4;
  doc.setFillColor(255, 255, 255);
  doc.rect(box.x1 - sw2 - 1, box.y1 - 7, sw2, 6, 'F');
  doc.setTextColor(...PEN.grey);
  doc.text(scaleText, box.x1 - 2.2, box.y1 - 2.7, { align: 'right' });
  return view;
}

export { PHANTOM_LEN, fit, overlap, inflate };
