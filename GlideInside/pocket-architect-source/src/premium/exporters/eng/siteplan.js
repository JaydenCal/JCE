// Site plan sheet and the locality map, in the manner of the JCESITE plan sets: cadastre filling the viewport with the surrounding
// lots labelled, the lot boundary with bearings and distances, the indicative setback envelope, contours with RLs, the proposed
// dwelling hatched, driveway and crossover, road reserve with a red phantom centreline, setback dimensions, FFL and NSL at the
// house corners, boxed call outs, a legend and notes on the right.

import * as G from '../../../model/geometry.js';
import { terrainAt } from '../../../site/model.js';
import { setbackNotes } from '../../../model/placement.js';
import {
  boundaryDims, roadReserve, buildingRings, buildingHull, orientedBox, deriveDriveway, clearances, lotLabelLines,
} from '../../../site/lotplan.js';
import { contourNote } from '../../../site/credits.js';
import { northArrow, scaleBar, placeImage } from '../pdf.js';
import {
  PEN, clean, wrap, fit, ink, polygon, hatch, HATCH, clippedPolyline, clipPolygon, dimLine, placeCallouts, drawCallouts,
  viewTitle, labelOn, alongText, boxOfPts, overlap, inflate,
} from './kit.js';
import { BODY, SW, TB_TOP } from './frame.js';

export const SITE_SCALES = [100, 150, 200, 250, 300, 400, 500, 750, 1000, 2000];
const PANEL_W = 92;
export const SITE_VP = { x0: BODY.x0, y0: BODY.y0, x1: BODY.x1 - PANEL_W - 3, y1: BODY.y1 };

/** Everything a site drawing needs about the lot, or null with no lot. */
export function siteFacts(project) {
  const lot = project.site?.lot;
  if (!lot?.boundary?.length) return null;
  const rings = buildingRings(project);
  const hull = buildingHull(project);
  const obox = orientedBox(hull);
  return { lot, rings, hull, obox, reserve: roadReserve(lot), drive: deriveDriveway(project), clear: clearances(project) };
}

/** Pick the scale (printed 1:n) that fits the lot, its frontage road and the house into the viewport. */
export function chooseSiteScale(pts, vp, k = 1) {
  const b = G.bbox(pts);
  const w = vp.x1 - vp.x0;
  const h = vp.y1 - vp.y0;
  const n = SITE_SCALES.find((s) => b.w / (s * k) <= w * 0.94 && b.h / (s * k) <= h * 0.94) || SITE_SCALES.at(-1);
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

const ptsOf = (flat) => {
  const out = [];
  for (let i = 0; i + 1 < flat.length; i += 2) out.push({ x: flat[i], y: flat[i + 1] });
  return out;
};

const dirOf = (a, b) => G.norm(G.sub(b, a));

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

export function lotBounds(project, facts) {
  const pts = [...facts.lot.boundary];
  for (const r of facts.reserve) {
    // Show the kerb, gutter and the road centreline in front of the lot.
    const { lines } = r;
    const a = G.lerp(lines.centreline[0], lines.centreline[1], 0.5);
    pts.push(a, G.add(facts.lot.boundary[r.edge], G.mul(r.outward, (r.vergeM + 1.2) * 1000)));
    const e0 = facts.lot.boundary[r.edge];
    const e1 = facts.lot.boundary[(r.edge + 1) % facts.lot.boundary.length];
    pts.push(G.add(e0, G.mul(r.outward, (r.vergeM + r.gutterM + r.carriagewayM / 2 + 2) * 1000)), G.add(e1, G.mul(r.outward, (r.vergeM + r.gutterM + r.carriagewayM / 2 + 2) * 1000)));
  }
  for (const p of facts.hull) pts.push(p);
  const b = G.bbox(pts);
  const pad = 3000;
  return G.bbox([{ x: b.minX - pad, y: b.minY - pad }, { x: b.maxX + pad, y: b.maxY + pad }]);
}

/**
 * Draw the site plan into SITE_VP. Returns { n, ds, label, T, boxes } where boxes are the label boxes it placed.
 * ctx: { project, k, paper, brand }.
 */
export function drawSitePlan(doc, ctx) {
  const { project } = ctx;
  const vp = SITE_VP;
  const facts = siteFacts(project);
  const lot = facts?.lot || null;
  const taken = [];
  const rect = { x0: vp.x0, y0: vp.y0, x1: vp.x1, y1: vp.y1 };

  // Viewport frame
  ink(doc, PEN.ink);
  doc.setLineWidth(0.35);
  doc.rect(vp.x0, vp.y0, vp.x1 - vp.x0, vp.y1 - vp.y0);
  if (!facts) return noLotMessage(doc, ctx, vp);

  const bounds = lotBounds(project, facts);
  const { n, ds } = chooseSiteScale([{ x: bounds.minX, y: bounds.minY }, { x: bounds.maxX, y: bounds.maxY }], { x0: vp.x0, y0: vp.y0 + 8, x1: vp.x1, y1: vp.y1 }, ctx.k || 1);
  const T = makeT(bounds, { x0: vp.x0, y0: vp.y0 + 8, x1: vp.x1, y1: vp.y1 }, ds);
  const label = `1:${n} @ ${ctx.paper || 'A3'}`;
  doc.setLineDashPattern([], 0);

  const stroke = (pts, closed = true) => clippedPolyline(doc, pts.map(T), rect, closed);
  const inVp = (b) => b.x0 >= rect.x0 + 0.5 && b.y0 >= rect.y0 + 0.5 && b.x1 <= rect.x1 - 0.5 && b.y1 <= rect.y1 - 0.5;
  const reg = (b) => { if (b) taken.push(b); return b; };

  // 1. Contours (under everything)
  const contourLabels = [];
  const houseSheet = facts.hull.length ? boxOfPts(facts.hull.map(T), 1) : null;
  for (const c of lot.contours || []) {
    const pts = ptsOf(c.pts || []).map(T);
    if (pts.length < 2) continue;
    doc.setDrawColor(...(c.major ? PEN.contourMajor : PEN.contourMinor));
    doc.setLineWidth(c.major ? 0.22 : 0.1);
    doc.setLineDashPattern([], 0);
    clippedPolyline(doc, pts, rect, false);
    contourLabels.push({ c, pts });
  }

  // 2. Neighbours, with lot number and DP on separate lines (DP one size larger)
  doc.setDrawColor(...PEN.neighbour);
  doc.setLineWidth(0.13);
  for (const nb of lot.neighbours || []) {
    if (nb.isRoad) continue;
    stroke(nb.ring);
  }
  const nbLabels = [];
  for (const nb of lot.neighbours || []) {
    if (nb.isRoad || !nb.ring?.length) continue;
    const c = G.polygonCentroid(nb.ring);
    const s = T(c);
    const l1 = nb.lotNumber ? `LOT ${nb.lotNumber}` : '';
    const l2 = nb.planLabel || '';
    if (!l1 && !l2) continue;
    nbLabels.push({ s, l1, l2, ring: nb.ring });
  }

  // 3. Road reserve: footpath, kerb, gutter, bitumen, concrete footpath and the red phantom centreline
  for (const r of facts.reserve) {
    const L = r.lines;
    const quad = (A, B) => [A[0], A[1], B[1], B[0]];
    const bit = clipPolygon(quad(L.gutter, L.farGutter).map(T), rect);
    if (bit.length > 2) hatch(doc, bit, 'bitumen');
    const fp = clipPolygon(quad(L.footpathNear, L.footpathFar).map(T), rect);
    if (fp.length > 2) hatch(doc, fp, 'concrete');
    doc.setLineDashPattern([], 0);
    for (const [key, w, col] of [['footpathNear', 0.1, PEN.grey], ['footpathFar', 0.1, PEN.grey], ['kerb', 0.3, PEN.road], ['gutter', 0.1, PEN.grey], ['farGutter', 0.1, PEN.grey], ['farKerb', 0.3, PEN.road]]) {
      doc.setDrawColor(...col);
      doc.setLineWidth(w);
      const s = L[key].map(T);
      clippedPolyline(doc, s, rect, false);
    }
    doc.setDrawColor(...PEN.phantom);
    doc.setLineWidth(0.35);
    doc.setLineDashPattern([9, 1.6, 1.6, 1.6, 1.6, 1.6], 0);
    clippedPolyline(doc, L.centreline.map(T), rect, false);
    doc.setLineDashPattern([], 0);
    // Street name along the far side of the carriageway
    const name = clean(lot.roads?.find((x) => x.name)?.name || (lot.address || '').split(',')[0].replace(/^\d+\s*/, '')).toUpperCase();
    if (name) {
      const mid = T(G.lerp(L.centreline[0], L.centreline[1], 0.5));
      const d = dirOf(T(L.centreline[0]), T(L.centreline[1]));
      reg(alongText(doc, name, mid, d, -3.4, { size: 6, colour: PEN.road, bold: true }));
    }
  }

  // 4. Proposed works: driveway and crossover, then the dwelling
  const drive = facts.drive;
  if (drive?.ok) {
    const dp = clipPolygon(drive.polygon.map(T), rect);
    if (dp.length > 2) { hatch(doc, dp, 'hardstand'); }
    ink(doc, PEN.proposed);
    doc.setLineWidth(0.3);
    stroke(drive.polygon);
    const cp = clipPolygon(drive.crossover.polygon.map(T), rect);
    if (cp.length > 2) { hatch(doc, cp, 'concrete'); }
    doc.setLineWidth(0.3);
    stroke(drive.crossover.polygon);
  }
  // Eaves line (dashed) and the walls
  const overhang = Math.max(...project.levels.map((l) => l.roof?.overhang || 0), 0);
  if (facts.hull.length > 2 && overhang > 0) {
    doc.setDrawColor(...PEN.proposed);
    doc.setLineWidth(0.18);
    doc.setLineDashPattern([2.2, 1.2], 0);
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
  doc.setLineWidth(0.45);
  for (const w of ground?.walls || []) {
    if (w.kind !== 'exterior' || w.status === 'demolish') continue;
    stroke(G.wallPolygon(w));
  }

  // 5. Lot boundary: green, with bearings and distances
  doc.setDrawColor(...PEN.boundary);
  doc.setLineWidth(0.8);
  doc.setLineDashPattern([], 0);
  stroke(lot.boundary);
  const dims = boundaryDims(lot);
  const centre = T(G.polygonCentroid(lot.boundary));
  for (const d of dims) {
    const a = T(lot.boundary[d.index]);
    const b = T(lot.boundary[(d.index + 1) % lot.boundary.length]);
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const dir = dirOf(a, b);
    // Bearing outside the lot, distance inside.
    const up = { x: dir.y, y: -dir.x };
    let out = G.dot(up, G.sub(mid, centre)) > 0 ? 1 : -1; // which side of the line is away from the lot
    const lenMm = Math.hypot(b.x - a.x, b.y - a.y);
    if (lenMm < 14) continue;
    // alongText offsets to the "up" side of the reading direction, so choose the sign that puts it on the wanted side.
    const readDir = dir.x < 0 || (Math.abs(dir.x) < 1e-9 && dir.y > 0) ? { x: -dir.x, y: -dir.y } : dir;
    const readUp = { x: readDir.y, y: -readDir.x };
    const sideOut = G.dot(readUp, G.sub(mid, centre)) > 0 ? 1 : -1;
    const bearBox = alongText(doc, d.bearing, mid, dir, sideOut * 2.4, { size: 5.8, colour: PEN.boundary, bold: true });
    reg(bearBox);
    reg(alongText(doc, `${d.length} m`, mid, dir, -sideOut * 2.4, { size: 5.8, colour: PEN.boundary }));
    void out;
  }

  // 6. Envelope (indicative): red dashed
  if (lot.envelope?.length > 2) {
    doc.setDrawColor(...PEN.envelope);
    doc.setLineWidth(0.4);
    doc.setLineDashPattern([3, 1.6], 0);
    stroke(lot.envelope);
    doc.setLineDashPattern([], 0);
  }

  // 7. Setback dimensions to the house
  const dimBoxes = [];
  for (const row of facts.clear.rows) {
    if (!row.from || !row.to || row.clearanceM > 40) continue;
    const a = T(row.from);
    const b = T(row.to);
    if (Math.hypot(a.x - b.x, a.y - b.y) < 5) continue;
    const col = row.status === 'outside' ? PEN.envelope : PEN.dim;
    const txt = `${row.clearanceM.toFixed(2)} m`;
    const bx = dimLine(doc, a, b, txt, { colour: col, size: 5.8, textSide: 1 });
    if (bx) dimBoxes.push(reg(bx));
  }

  // 8. FFL and NSL at the four corners of the house
  const levelTags = [];
  if (facts.obox) {
    const floor = lot.floorRL;
    for (const c of facts.obox.corners) {
      const ground0 = lot.terrain ? terrainAt(lot.terrain, c.x, c.y) : null;
      if (floor == null && ground0 == null) continue;
      const s = T(c);
      const away = G.norm(G.sub(s, T(facts.obox.centre)));
      levelTags.push({ s, away, floor, nsl: ground0 });
    }
    for (const t of levelTags) {
      doc.setFillColor(...PEN.proposed);
      doc.circle(t.s.x, t.s.y, 0.6, 'F');
      const lines = [];
      if (t.floor != null) lines.push(`FFL ${t.floor.toFixed(2)}`);
      if (t.nsl != null) lines.push(`NSL ${t.nsl.toFixed(2)}`);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(5);
      const w = Math.max(...lines.map((l) => doc.getTextWidth(l))) + 2;
      const h = lines.length * 2.1 + 1;
      const cx = t.s.x - t.away.x * (w / 2 + 1.5);
      const cy = t.s.y - t.away.y * (h / 2 + 1.5);
      const box = { x0: cx - w / 2, y0: cy - h / 2, x1: cx + w / 2, y1: cy + h / 2 };
      doc.setFillColor(255, 255, 255);
      doc.setDrawColor(...PEN.proposed);
      doc.setLineWidth(0.15);
      doc.rect(box.x0, box.y0, w, h, 'FD');
      doc.setTextColor(...PEN.proposed);
      lines.forEach((l, i) => doc.text(l, box.x0 + 1, box.y0 + 2.3 + i * 2.1));
      reg(box);
    }
  }

  // 9. Contour RL labels (after the other labels so they step round them)
  const labelled = [];
  const clash = (b) => taken.some((o) => overlap(inflate(b, 0.5), o) > 0) || (houseSheet && overlap(b, houseSheet) > 0) || labelled.some((o) => overlap(b, o) > 0);
  for (const { c, pts } of contourLabels) {
    const segs = [];
    let total = 0;
    for (let i = 0; i + 1 < pts.length; i++) {
      const s = require2(pts[i], pts[i + 1], rect);
      if (s) { const len = Math.hypot(s[1].x - s[0].x, s[1].y - s[0].y); segs.push({ s, len }); total += len; }
    }
    if (total < 22) continue;
    for (const f of [0.5, 0.3, 0.7, 0.18, 0.82, 0.4, 0.6]) {
      let at = total * f;
      let seg = null;
      for (const g of segs) { if (at <= g.len) { seg = g; break; } at -= g.len; }
      if (!seg || seg.len < 9) continue;
      const t = at / seg.len;
      const p = { x: seg.s[0].x + (seg.s[1].x - seg.s[0].x) * t, y: seg.s[0].y + (seg.s[1].y - seg.s[0].y) * t };
      const d = dirOf(seg.s[0], seg.s[1]);
      const txt = Number(c.level).toFixed(c.level % 1 ? 1 : 1);
      doc.setFont('helvetica', c.major ? 'bold' : 'normal');
      doc.setFontSize(5);
      const w = doc.getTextWidth(txt) + 1.2;
      const b = boxOfPts([{ x: p.x - w / 2, y: p.y - 1.5 }, { x: p.x + w / 2, y: p.y + 1.5 }]);
      if (!inVp(b) || clash(b)) continue;
      labelled.push(b);
      doc.setFillColor(255, 255, 255);
      doc.rect(b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0, 'F');
      const ang = -(Math.atan2(d.y, d.x) * 180) / Math.PI;
      doc.setTextColor(...(c.major ? PEN.contourMajor : PEN.contourMinor));
      doc.text(txt, p.x, p.y + 0.9, { align: 'center' });
      void ang;
      break;
    }
  }

  // 10. Neighbour labels last of the lot data, only where they fit wholly in the viewport and clear of other labels
  for (const nl of nbLabels) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(6);
    const w1 = nl.l1 ? doc.getTextWidth(nl.l1) : 0;
    doc.setFontSize(7.4);
    const w2 = nl.l2 ? doc.getTextWidth(nl.l2) : 0;
    const w = Math.max(w1, w2);
    const h = (nl.l1 ? 2.6 : 0) + (nl.l2 ? 3.2 : 0);
    const b = { x0: nl.s.x - w / 2 - 0.5, y0: nl.s.y - h / 2 - 0.5, x1: nl.s.x + w / 2 + 0.5, y1: nl.s.y + h / 2 + 0.5 };
    if (!inVp(b) || clash(b)) continue;
    labelled.push(b);
    let y = b.y0 + 0.5;
    if (nl.l1) { doc.setFont('helvetica', 'bold'); doc.setFontSize(6); doc.setTextColor(...PEN.neighbour); doc.text(nl.l1, nl.s.x, y + 2, { align: 'center' }); y += 2.7; }
    if (nl.l2) { doc.setFont('helvetica', 'bold'); doc.setFontSize(7.4); doc.setTextColor(...PEN.neighbour); doc.text(nl.l2, nl.s.x, y + 2.4, { align: 'center' }); }
  }

  // 11. The lot's own label, inside the boundary, clear of the house
  const ll = lotLabelLines(lot);
  const lotLines = [ll.first, ll.second, lot.areaM2 ? `${Math.round(lot.areaM2)} m2` : ''].filter(Boolean);
  const cand = [0.12, 0.88, 0.5].flatMap((f) => [0.1, 0.9].map((g) => ({ f, g })));
  const lb = G.bbox(lot.boundary.map(T));
  let placedLabel = null;
  for (const c of [{ x: 0.5, y: 0.08 }, { x: 0.5, y: 0.93 }, { x: 0.2, y: 0.5 }, { x: 0.8, y: 0.5 }, { x: 0.25, y: 0.12 }, { x: 0.75, y: 0.12 }, { x: 0.25, y: 0.9 }, { x: 0.75, y: 0.9 }]) {
    const p = { x: lb.minX + lb.w * c.x, y: lb.minY + lb.h * c.y };
    if (!G.pointInPolygon(p, lot.boundary.map(T))) continue;
    const w = 26;
    const h = lotLines.length * 3.2 + 1;
    const b = { x0: p.x - w / 2, y0: p.y - h / 2, x1: p.x + w / 2, y1: p.y + h / 2 };
    const corners = [{ x: b.x0, y: b.y0 }, { x: b.x1, y: b.y0 }, { x: b.x1, y: b.y1 }, { x: b.x0, y: b.y1 }];
    if (!corners.every((q) => G.pointInPolygon(q, lot.boundary.map(T)))) continue;
    if (clash(b)) continue;
    placedLabel = b;
    break;
  }
  void cand;
  if (placedLabel) {
    labelled.push(placedLabel);
    taken.push(placedLabel);
    const cx = (placedLabel.x0 + placedLabel.x1) / 2;
    lotLines.forEach((l, i) => {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(i === 0 ? 7.2 : i === 1 ? 8.2 : 6);
      doc.setTextColor(...PEN.boundary);
      doc.text(clean(l), cx, placedLabel.y0 + 3 + i * 3.2, { align: 'center' });
    });
  }

  // 12. Call outs
  const items = [];
  const hc = facts.obox ? T(facts.obox.centre) : null;
  const footprint = footRings.reduce((a, r) => a + G.polygonArea(r) / 1e6, 0);
  if (hc) items.push({ id: 'house', lines: ['PROPOSED DWELLING', lot.floorRL != null ? `FFL ${lot.floorRL.toFixed(2)} (${lot.floorRLAuto ? 'assumed' : 'set'})` : 'FFL to be set', `Footprint ${footprint.toFixed(0)} m2`], at: hc, colour: PEN.proposed });
  if (drive?.ok) {
    const dc = T(drive.centre[Math.floor(drive.centre.length * 0.55)]);
    items.push({ id: 'drive', lines: ['PROPOSED DRIVEWAY', `${(drive.widthMm / 1000).toFixed(1)} m wide, concrete`], at: dc, colour: PEN.proposed });
    const cc = T(G.lerp(drive.crossover.from, drive.crossover.to, 0.5));
    items.push({ id: 'cross', lines: ['PROPOSED CROSSOVER', 'Council approval required'], at: cc, colour: PEN.proposed });
  }
  if (facts.reserve[0]) {
    const L = facts.reserve[0].lines;
    items.push({ id: 'phantom', lines: ['ROAD CENTRELINE', 'Indicative'], at: T(G.lerp(L.centreline[0], L.centreline[1], 0.82)), colour: PEN.phantom });
    items.push({ id: 'kerb', lines: ['KERB AND GUTTER', 'Existing, assumed'], at: T(G.lerp(L.kerb[0], L.kerb[1], 0.2)), colour: PEN.road });
  }
  if (lot.envelope?.length > 2) {
    const e = lot.envelope;
    const top = e.reduce((a, p) => (T(p).y < T(a).y ? p : a), e[0]);
    items.push({ id: 'env', lines: ['INDICATIVE SETBACK ENVELOPE', 'Check with council'], at: T(G.lerp(top, e[(e.indexOf(top) + 1) % e.length], 0.5)), colour: PEN.envelope });
  }
  const bd = dims.find((d) => d.index === (facts.reserve[0]?.edge ?? 0)) || dims[0];
  const bmid = T(G.lerp(lot.boundary[(bd.index + 2) % lot.boundary.length], lot.boundary[(bd.index + 3) % lot.boundary.length], 0.3));
  items.push({ id: 'bnd', lines: ['LOT BOUNDARY (EXISTING)', `${lot.lotLabel || ''} ${Math.round(lot.areaM2 || 0)} m2`.trim()], at: bmid, colour: PEN.boundary });
  const obstacles = [...taken, ...(houseSheet ? [houseSheet] : [])];
  const avoid = [];
  const addRing = (pts) => pts.forEach((q, i) => avoid.push([T(q), T(pts[(i + 1) % pts.length])]));
  addRing(lot.boundary);
  if (lot.envelope?.length > 2) addRing(lot.envelope);
  if (drive?.ok) { addRing(drive.polygon); addRing(drive.crossover.polygon); }
  const placed = placeCallouts(doc, items, { obstacles, avoid, area: { x0: rect.x0, y0: rect.y0 + 8, x1: rect.x1, y1: rect.y1 }, size: 6 });
  drawCallouts(doc, placed);

  // View title and scale bar below the title
  viewTitle(doc, vp.x0 + 3, vp.y0 + 6, 'Site plan', label);
  return { n, ds, label, T, taken, facts };
}

const require2 = (a, b, rect) => {
  const t0 = Math.max(0, 0);
  void t0;
  // Liang-Barsky clip in sheet space.
  let u0 = 0;
  let u1 = 1;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  for (const [p, q] of [[-dx, a.x - rect.x0], [dx, rect.x1 - a.x], [-dy, a.y - rect.y0], [dy, rect.y1 - a.y]]) {
    if (p === 0) { if (q < 0) return null; } else { const t = q / p; if (p < 0) { if (t > u1) return null; if (t > u0) u0 = t; } else { if (t < u0) return null; if (t < u1) u1 = t; } }
  }
  return [{ x: a.x + dx * u0, y: a.y + dy * u0 }, { x: a.x + dx * u1, y: a.y + dy * u1 }];
};

function noLotMessage(doc, ctx, vp) {
  const { project } = ctx;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  ink(doc, PEN.grey);
  doc.text('NO LOT LOADED', (vp.x0 + vp.x1) / 2, (vp.y0 + vp.y1) / 2 - 4, { align: 'center' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  doc.text('Use Find my block to load the lot, its setbacks and ground levels. This sheet then shows the site plan.', (vp.x0 + vp.x1) / 2, (vp.y0 + vp.y1) / 2 + 2, { align: 'center' });
  void project;
  viewTitle(doc, vp.x0 + 3, vp.y0 + 6, 'Site plan', 'NTS');
  return { n: null, ds: null, label: 'NTS', T: null, taken: [], facts: null };
}

// Right hand panel: north point, key plan, legend, notes ---------------------------------------------------------------------
export function drawSitePanel(doc, ctx, site) {
  const { project } = ctx;
  const lot = project.site?.lot || null;
  const x0 = SITE_VP.x1 + 3;
  const x1 = BODY.x1;
  const w = x1 - x0;
  let y = BODY.y0;

  // North point and scale text
  doc.setLineWidth(0.35);
  ink(doc, PEN.ink);
  doc.rect(x0, y, w, 34);
  northArrow(doc, x0 + 14, y + 12.5, project.site?.northDeg || 0);
  if (site?.n) scaleBar(doc, x0 + 6, y + 25, site.n, site.ds);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6);
  ink(doc, PEN.grey);
  doc.text(clean(site?.label ? `SCALE ${site.label}` : 'NOT TO SCALE'), x0 + 30, y + 8);
  doc.text('North is MGA grid north.', x0 + 30, y + 12.5);
  doc.text('Plan up is north.', x0 + 30, y + 16.5);
  y += 37;

  // Key plan
  const kh = 44;
  doc.setLineWidth(0.35);
  ink(doc, PEN.ink);
  doc.rect(x0, y, w, kh);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(6.5);
  doc.text('KEY PLAN', x0 + 2, y + 4);
  drawLocality(doc, { x0: x0 + 2, y0: y + 6, x1: x1 - 2, y1: y + kh - 2 }, ctx);
  y += kh + 3;

  // Legend
  const items = [
    ['Lot boundary (existing)', (cx, cy) => { doc.setDrawColor(...PEN.boundary); doc.setLineWidth(0.8); doc.line(cx, cy, cx + 12, cy); }],
    ['Neighbouring lot boundary', (cx, cy) => { doc.setDrawColor(...PEN.neighbour); doc.setLineWidth(0.13); doc.line(cx, cy, cx + 12, cy); }],
    ['Indicative setback envelope', (cx, cy) => { doc.setDrawColor(...PEN.envelope); doc.setLineWidth(0.4); doc.setLineDashPattern([3, 1.6], 0); doc.line(cx, cy, cx + 12, cy); doc.setLineDashPattern([], 0); }],
    ['Road centreline (indicative)', (cx, cy) => { doc.setDrawColor(...PEN.phantom); doc.setLineWidth(0.35); doc.setLineDashPattern([5, 1.2, 1.2, 1.2], 0); doc.line(cx, cy, cx + 12, cy); doc.setLineDashPattern([], 0); }],
    ['Kerb and gutter', (cx, cy) => { doc.setDrawColor(...PEN.road); doc.setLineWidth(0.3); doc.line(cx, cy, cx + 12, cy); }],
    ['Contour (minor, major)', (cx, cy) => { doc.setDrawColor(...PEN.contourMinor); doc.setLineWidth(0.1); doc.line(cx, cy - 0.8, cx + 5.5, cy - 0.8); doc.setDrawColor(...PEN.contourMajor); doc.setLineWidth(0.22); doc.line(cx + 6.5, cy + 0.8, cx + 12, cy + 0.8); }],
    ['Dimension to boundary', (cx, cy) => { doc.setDrawColor(...PEN.dim); doc.setLineWidth(0.13); doc.line(cx, cy, cx + 12, cy); doc.setLineWidth(0.25); doc.line(cx, cy - 1, cx, cy + 1); doc.line(cx + 12, cy - 1, cx + 12, cy + 1); }],
    ['Proposed works', (cx, cy) => { const p = [{ x: cx, y: cy - 1.8 }, { x: cx + 12, y: cy - 1.8 }, { x: cx + 12, y: cy + 1.8 }, { x: cx, y: cy + 1.8 }]; hatch(doc, p, 'proposed'); doc.setDrawColor(...PEN.proposed); doc.setLineWidth(0.3); polygon(doc, p, 'S'); }],
    ['Hardstand (driveway)', (cx, cy) => { const p = [{ x: cx, y: cy - 1.8 }, { x: cx + 12, y: cy - 1.8 }, { x: cx + 12, y: cy + 1.8 }, { x: cx, y: cy + 1.8 }]; hatch(doc, p, 'hardstand'); }],
    ['Concrete (crossover, footpath)', (cx, cy) => { const p = [{ x: cx, y: cy - 1.8 }, { x: cx + 12, y: cy - 1.8 }, { x: cx + 12, y: cy + 1.8 }, { x: cx, y: cy + 1.8 }]; hatch(doc, p, 'concrete'); }],
    ['Bitumen (road)', (cx, cy) => { const p = [{ x: cx, y: cy - 1.8 }, { x: cx + 12, y: cy - 1.8 }, { x: cx + 12, y: cy + 1.8 }, { x: cx, y: cy + 1.8 }]; hatch(doc, p, 'bitumen'); }],
  ];
  const lh = 5.1;
  const legH = 7 + items.length * lh;
  doc.setLineWidth(0.35);
  ink(doc, PEN.ink);
  doc.rect(x0, y, w, legH);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(6.5);
  doc.text('LEGEND', x0 + 2, y + 4);
  items.forEach(([name, draw], i) => {
    const cy = y + 8.6 + i * lh;
    draw(x0 + 3, cy);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(5.6);
    doc.setTextColor(...PEN.ink);
    doc.text(clean(name), x0 + 18, cy + 0.8);
  });
  y += legH + 3;

  // Notes
  const notes = siteNotes(project);
  doc.setLineWidth(0.35);
  const nh = BODY.y1 - y;
  ink(doc, PEN.ink);
  doc.rect(x0, y, w, nh);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(6.5);
  doc.text('NOTES', x0 + 2, y + 4);
  let ty = y + 8;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(5.1);
  for (let i = 0; i < notes.length; i++) {
    const lines = wrap(doc, `${i + 1}. ${notes[i]}`, w - 5);
    if (ty + lines.length * 2.1 > y + nh - 1) break;
    lines.forEach((l, j) => doc.text(l, x0 + 2 + (j ? 2 : 0), ty + j * 2.1));
    ty += lines.length * 2.1 + 1;
  }
}

export function siteNotes(project) {
  const lot = project.site?.lot || null;
  const out = [
    'Concept only. To be verified by a suitably qualified person before any use for approval or construction.',
    'Boundaries are from the cadastre, are indicative only, and are not a survey. A registered survey is required.',
  ];
  if (lot?.setbacks) {
    const s = lot.setbacks;
    out.push(`Setbacks: ${clean(s.council || '')} ${clean(s.basis || '')}. The red envelope is indicative. Where a rule is marked "check with council" the figure has not been confirmed with the council.`);
    for (const n of setbackNotes(lot)) out.push(`${n.rule === 'side' ? 'Side' : n.rule === 'rear' ? 'Rear' : n.rule === 'front' ? 'Front' : n.rule} ${n.valueM} m: ${clean(n.source)}${n.flagged ? ' (check with council)' : ''}.`);
  } else if (lot) out.push('Council setbacks are not loaded for this lot. The envelope is not shown.');
  if (lot?.terrain || lot?.contours?.length) out.push(contourNote(lot.provenance?.elevation));
  if (lot?.floorRL != null) out.push(`FFL ${lot.floorRL.toFixed(2)} m AHD ${lot.floorRLAuto ? 'is assumed from the ground level at the house, not designed' : 'as set by the designer'}. NSL is the natural surface level from the terrain model at each house corner.`);
  out.push('Services, easements, trees, flood and bushfire overlays are not shown. Dial Before You Dig plans and a section 10.7 or equivalent certificate are required.');
  out.push('Driveway and crossover are indicative. Crossover location, width and levels need council approval.');
  return out;
}

// Locality map ----------------------------------------------------------------------------------------------------------------
/** Surrounding lots, the subject lot filled and the house, drawn to fit `box`. With an aerial image the lots are drawn over it. */
export function drawLocality(doc, box, ctx) {
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
    doc.setFontSize(6);
    ink(doc, PEN.grey);
    doc.text('Locality not loaded', (box.x0 + box.x1) / 2, (box.y0 + box.y1) / 2, { align: 'center' });
    return;
  }
  const rings = [lot.boundary, ...(lot.neighbours || []).map((n) => n.ring)];
  // Focus on the lot and the lots near it.
  const lb = G.bbox(lot.boundary);
  const span = Math.max(lb.w, lb.h) * 3.2;
  const aspect = w / h;
  const cx = (lb.minX + lb.maxX) / 2;
  const cy = (lb.minY + lb.maxY) / 2;
  const vw = aspect >= 1 ? span * aspect : span;
  const vh = aspect >= 1 ? span : span / aspect;
  const T = (p) => ({ x: box.x0 + w / 2 + ((p.x - cx) / vw) * w, y: box.y0 + h / 2 + ((p.y - cy) / vh) * h });
  const rect = { x0: box.x0 + 0.3, y0: box.y0 + 0.3, x1: box.x1 - 0.3, y1: box.y1 - 0.3 };
  if (ctx.aerial && lot.aerial?.extent) {
    const e = lot.aerial.extent;
    const a = T({ x: e.x0, y: e.y0 });
    const b = T({ x: e.x1, y: e.y1 });
    // Only when the image lies wholly inside the box (jsPDF cannot clip images through the scaled proxy).
    if (a.x >= rect.x0 && b.x <= rect.x1 && a.y >= rect.y0 && b.y <= rect.y1) {
      try { doc.addImage(ctx.aerial, 'JPEG', a.x, a.y, b.x - a.x, b.y - a.y); } catch { /* unreadable image: schematic only */ }
    }
  }
  doc.setDrawColor(...PEN.neighbour);
  doc.setLineWidth(0.12);
  for (const r of rings.slice(1)) clippedPolyline(doc, r.map(T), rect, true);
  const own = clipPolygon(lot.boundary.map(T), rect);
  if (own.length > 2) { doc.setFillColor(205, 232, 214); polygon(doc, own, 'F'); }
  doc.setDrawColor(...PEN.boundary);
  doc.setLineWidth(0.5);
  clippedPolyline(doc, lot.boundary.map(T), rect, true);
  const hull = buildingHull(project);
  if (hull.length > 2) { doc.setFillColor(...PEN.proposed); polygon(doc, hull.map(T), 'F'); }
  const ll = lotLabelLines(lot);
  labelOn(doc, `${ll.first} ${ll.second}`.trim(), box.x0 + 2, box.y1 - 2, { size: 5.4, bold: true, colour: PEN.boundary, align: 'left', pad: 0.8 });
  labelOn(doc, 'NTS', box.x1 - 2, box.y1 - 2, { size: 5.4, colour: PEN.grey, align: 'right', pad: 0.8 });
}
