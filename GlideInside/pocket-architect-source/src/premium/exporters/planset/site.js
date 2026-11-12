// Site plan sheet (C100): lot boundary with bearings and lengths, setback line and dimensions, house footprint with roof outline, driveway to
// the kerb, road reserve with the red phantom centreline, DCDB context, north point and scale bar. Matches the builder Lot Planner's A3 site
// plan PDF. Sheet units are millimetres on A3; plan units are millimetres on the ground (y down, plan up = grid north).
//
// Collision rules: every label goes through one LabelField (walls, driveway, boundary, dimensions and the labels already placed), so text is
// never drawn over linework or other text. The legend lives in the title strip, the scale bar in a band below the viewport, and the north
// point in the emptiest corner of the viewport.

import * as G from '../../../model/geometry.js';
import { classifyEdges, requiredFor } from '../../../model/placement.js';
import { boundaryDims, roadReserve, ROAD_DEFAULTS, deriveDriveway, clearances, buildingHull, lotLabelLines, inwardNormalOf } from '../../../site/lotplan.js';
import { wallShapes } from '../shared.js';
import { planGeometry, scaleBar } from '../pdf.js';
import { hasGround, drawContours, placeContourLabels, drawSpotLevels, groundLevelFn, cornersOf, houseCorners } from './contours.js';
import { PEN, PHANTOM, clipSegment, hatch, dimLine, haloText, alongLabel, LabelField, boxOfPts, clean } from '../eng/kit.js';
import { AREA } from './frame.js';
import { groundLevel, envelopePoly, groundFootprintM2 } from './lot.js';

export const SITE_SCALES = [100, 150, 200, 250, 300, 400, 500, 750, 1000, 1500, 2000, 3000, 5000];
const BAND = 16;
export const VP = { x0: AREA.x0 + 2, y0: AREA.y0 + 2, x1: AREA.x1 - 2, y1: AREA.y1 - 7 - BAND };
const GREYLINE = [120, 124, 132];
const RED = [196, 28, 28];
const roofRooms = (project) => (project.levels || []).flatMap((l) => (l.rooms || []).filter((r) => r.status !== 'demolish' && (!r.outdoor || r.roofed) && r.polygon?.length >= 3));

// Geometry ----------------------------------------------------------------------------------------------------------------------
/** Convex outline pushed out by d (mm). */
export function offsetHull(hull, d) {
  if (hull.length < 3) return hull;
  const sgn = Math.sign(G.signedArea(hull)) || 1;
  return hull.map((p, i) => {
    const a = hull[(i + hull.length - 1) % hull.length];
    const b = hull[(i + 1) % hull.length];
    const out = (u) => ({ x: u.y * sgn, y: -u.x * sgn });
    const o1 = out(G.norm(G.sub(p, a)));
    const o2 = out(G.norm(G.sub(b, p)));
    const m = G.norm(G.add(o1, o2));
    const k = d / Math.max(0.3, G.dot(m, o1));
    return { x: p.x + m.x * k, y: p.y + m.y * k };
  });
}

function hull2(points) {
  const pts = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  const cr = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lo = [];
  for (const p of pts) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); }
  const up = [];
  for (const p of [...pts].reverse()) { while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], p) <= 0) up.pop(); up.push(p); }
  return [...lo.slice(0, -1), ...up.slice(0, -1)];
}

/** The eaves line (plan mm) as runs of points: each roofed room pushed out by the overhang, keeping the stretches not inside another room's eaves. */
export function eavesRuns(project) {
  const rooms = roofRooms(project);
  if (!rooms.length) return [];
  const over = Math.max(0, Number(groundLevel(project)?.roof?.overhang) || 450);
  const grown = rooms.map((r) => offsetHull(hull2(r.polygon), over));
  const inside = (p, skip) => grown.some((g, i) => i !== skip && G.pointInPolygon(p, g));
  const runs = [];
  grown.forEach((g, gi) => {
    let cur = null;
    for (let i = 0; i < g.length; i++) {
      const a = g[i];
      const b = g[(i + 1) % g.length];
      const n = Math.max(1, Math.ceil(G.dist(a, b) / 150));
      for (let k = 0; k < n; k++) {
        const p = G.lerp(a, b, k / n);
        const q = G.lerp(a, b, (k + 1) / n);
        if (!inside(G.lerp(p, q, 0.5), gi)) { if (!cur) { cur = [p]; runs.push(cur); } cur.push(q); } else cur = null;
      }
    }
  });
  return runs;
}

/** A polyline pushed out to one side by d (mm) with mitred joins, extended `ext` beyond both ends along the end segments. */
function offsetChain(pts, outward, d, ext) {
  const m = pts.length - 1;
  const out = [];
  for (let v = 0; v <= m; v++) {
    const n0 = v > 0 ? outward[v - 1] : null;
    const n1 = v < m ? outward[v] : null;
    if (n0 && n1) {
      const s = G.norm(G.add(n0, n1));
      const k = d / Math.max(0.35, G.dot(s, n0));
      out.push({ x: pts[v].x + s.x * k, y: pts[v].y + s.y * k });
    } else { const n = n0 || n1; out.push({ x: pts[v].x + n.x * d, y: pts[v].y + n.y * d }); }
  }
  const d0 = G.norm(G.sub(pts[1], pts[0]));
  const d1 = G.norm(G.sub(pts[m], pts[m - 1]));
  return [G.sub(out[0], G.mul(d0, ext)), ...out, G.add(out[m], G.mul(d1, ext))];
}

/**
 * The road in front of the lot. Contiguous street edges (a curved frontage, a corner) form ONE chain, offset as one polyline, so a cul de sac
 * bulb gives one road, not one road per edge. Returns [{ run: [edge], pts, vergeM, lines: { name: [pt] }, reach, outward: [vec] }].
 */
export function roadModel(lot) {
  const n = lot.boundary.length;
  const edges = classifyEdges(lot);
  const front = new Set(edges.filter((e) => e.kind === 'front' || e.kind === 'secondaryFront').map((e) => e.index));
  if (!front.size) return [];
  const reserves = roadReserve(lot);
  const used = new Set();
  const chains = [];
  for (const i of [...front].sort((a, b) => a - b)) {
    if (used.has(i)) continue;
    let s = i;
    let guard = 0;
    while (front.has((s + n - 1) % n) && (s + n - 1) % n !== i && guard++ < n) s = (s + n - 1) % n;
    const run = [];
    let k = s;
    do { run.push(k); used.add(k); k = (k + 1) % n; } while (front.has(k) && !used.has(k));
    chains.push(run);
  }
  const o = ROAD_DEFAULTS;
  return chains.map((run) => {
    const pts = [lot.boundary[run[0]], ...run.map((i) => lot.boundary[(i + 1) % n])];
    const outward = run.map((i) => { const v = inwardNormalOf(lot, i); return { x: -v.x, y: -v.y }; });
    const vergeM = Math.min(...run.map((i) => reserves.find((r) => r.edge === i)?.vergeM ?? o.vergeM));
    const half = o.carriagewayM / 2;
    const offs = { footpathNear: o.footpathNearM, footpathFar: o.footpathFarM, kerb: vergeM, gutter: vergeM + o.gutterM, farGutter: vergeM + o.gutterM + o.carriagewayM, farKerb: vergeM + 2 * o.gutterM + o.carriagewayM, centreline: vergeM + o.gutterM + half };
    const lines = {};
    for (const [k, mdist] of Object.entries(offs)) lines[k] = offsetChain(pts, outward, mdist * 1000, o.extendM * 1000);
    return { run, pts, vergeM, lines, reach: offs.centreline * 1000, outward };
  });
}

/** Scale and transform for the lot: the largest standard scale at which lot, road frontage and house fit the viewport. */
export function siteView(project, lot) {
  const pts = [...lot.boundary, ...buildingHull(project)];
  const roads = roadModel(lot);
  for (const r of roads) pts.push(...r.lines.centreline.slice(1, -1));
  const bb = G.bbox(pts);
  const w = bb.w + 2 * 9000;
  const h = bb.h + 2 * 3000;
  const vw = VP.x1 - VP.x0;
  const vh = VP.y1 - VP.y0;
  let scale = SITE_SCALES.find((n) => w / n <= vw && h / n <= vh);
  if (!scale) { scale = SITE_SCALES.at(-1); while (w / scale > vw || h / scale > vh) scale *= 2; }
  const cx = bb.minX + bb.w / 2;
  const cy = bb.minY + bb.h / 2;
  const mx = (VP.x0 + VP.x1) / 2;
  const my = (VP.y0 + VP.y1) / 2;
  return { scale, T: (p) => ({ x: mx + (p.x - cx) / scale, y: my + (p.y - cy) / scale }), roads, bb };
}

// Drawing helpers -----------------------------------------------------------------------------------------------------------------
const segLine = (doc, a, b) => { const s = clipSegment(a, b, VP); if (s) doc.line(s[0].x, s[0].y, s[1].x, s[1].y); };
const polyLine = (doc, pts, closed = true) => { const n = closed ? pts.length : pts.length - 1; for (let i = 0; i < n; i++) segLine(doc, pts[i], pts[(i + 1) % pts.length]); };
const inVP = (p) => p.x >= VP.x0 && p.x <= VP.x1 && p.y >= VP.y0 && p.y <= VP.y1;
const lenOf = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const regRing = (field, pts, closed = true, soft = false) => field.addRing(pts, closed, soft);

function northPoint(doc, cx, cy, deg) {
  const r = 8.5;
  const a = (deg * Math.PI) / 180;
  const d = { x: Math.sin(a), y: -Math.cos(a) };
  const p = { x: -d.y, y: d.x };
  doc.setDrawColor(...PEN.ink);
  doc.setLineWidth(0.3);
  doc.setFillColor(255, 255, 255);
  doc.circle(cx, cy, r, 'FD');
  doc.setFillColor(...PEN.ink);
  doc.triangle(cx + d.x * (r - 1), cy + d.y * (r - 1), cx - d.x * 3 + p.x * 2.6, cy - d.y * 3 + p.y * 2.6, cx - d.x * 3 - p.x * 2.6, cy - d.y * 3 - p.y * 2.6, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(...PEN.ink);
  doc.text('N', cx + d.x * (r + 3.6), cy + d.y * (r + 3.6) + 1.2, { align: 'center' });
}

/** Legend block for the title strip. */
export function legendBlock({ contours = false } = {}) {
  const items = [
    ['Lot boundary (DCDB)', (doc, a, b) => { doc.setLineWidth(0.7); doc.setDrawColor(...PEN.ink); doc.line(a, b, a + 12, b); }],
    ['Adjoining lot boundary', (doc, a, b) => { doc.setLineWidth(0.15); doc.setDrawColor(...GREYLINE); doc.line(a, b, a + 12, b); }],
    ['Road centreline', (doc, a, b) => { doc.setLineWidth(0.3); doc.setDrawColor(...PEN.phantom); doc.setLineDashPattern([3, 0.8, 0.6, 0.8], 0); doc.line(a, b, a + 12, b); doc.setLineDashPattern([], 0); }],
    ['Building setback line', (doc, a, b) => { doc.setLineWidth(0.2); doc.setDrawColor(...GREYLINE); doc.setLineDashPattern([1.6, 1], 0); doc.line(a, b, a + 12, b); doc.setLineDashPattern([], 0); }],
    ['Walls', (doc, a, b) => { doc.setLineWidth(0.8); doc.setDrawColor(...PEN.ink); doc.line(a, b, a + 12, b); }],
    ['Roof line (eaves)', (doc, a, b) => { doc.setLineWidth(0.25); doc.setDrawColor(...PEN.ink); doc.setLineDashPattern([3, 1.2], 0); doc.line(a, b, a + 12, b); doc.setLineDashPattern([], 0); }],
    ['Kerb and gutter', (doc, a, b) => { doc.setLineWidth(0.25); doc.setDrawColor(...PEN.ink); doc.line(a, b - 0.5, a + 12, b - 0.5); doc.line(a, b + 0.5, a + 12, b + 0.5); }],
    ['Concrete driveway', (doc, a, b) => { doc.setLineWidth(0.15); doc.setDrawColor(...GREYLINE); doc.rect(a, b - 1.4, 12, 2.8, 'S'); hatch(doc, [{ x: a, y: b - 1.4 }, { x: a + 12, y: b - 1.4 }, { x: a + 12, y: b + 1.4 }, { x: a, y: b + 1.4 }], 'concrete'); }],
    ...(contours ? [['Contour (minor, major)', (doc, a, b) => { doc.setLineDashPattern([], 0); doc.setLineWidth(0.12); doc.setDrawColor(...PEN.contourMinor); doc.line(a, b - 0.7, a + 5.5, b - 0.7); doc.setLineWidth(0.26); doc.setDrawColor(...PEN.contourMajor); doc.line(a + 6.5, b + 0.7, a + 12, b + 0.7); }]] : []),
    ['Setback encroachment', (doc, a, b) => { doc.setLineWidth(0.3); doc.setDrawColor(...RED); doc.line(a, b, a + 12, b); }],
  ];
  return {
    title: 'LEGEND',
    h: 4 + items.length * 4 + 2.5,
    draw(doc, x, y) {
      items.forEach(([t, draw], i) => {
        const ly = y + 2.4 + i * 4;
        draw(doc, x + 3, ly);
        doc.setLineDashPattern([], 0);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(6.2);
        doc.setTextColor(...PEN.ink);
        doc.text(t, x + 18, ly + 0.8);
      });
    },
  };
}

function scheduleBlock(rows) {
  const shown = rows.slice(0, 14);
  return {
    title: 'BOUNDARY SCHEDULE (SHORT EDGES)',
    h: 4 + shown.length * 3.5 + (rows.length > shown.length ? 3.5 : 0) + 2,
    draw(doc, x, y) {
      doc.setFontSize(6.2);
      shown.forEach((r, i) => {
        const ry = y + 3 + i * 3.5;
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(...PEN.ink);
        doc.text(r.tag, x + 3, ry);
        doc.setFont('helvetica', 'normal');
        doc.text(r.bearing, x + 14, ry);
        doc.text(`${r.length} m`, x + 52, ry);
      });
      if (rows.length > shown.length) { doc.setFont('helvetica', 'normal'); doc.text(`and ${rows.length - shown.length} more edges`, x + 3, y + 3 + shown.length * 3.5); }
    },
  };
}

// The sheet ---------------------------------------------------------------------------------------------------------------------
/** Draws the site plan; returns { scale, scaleLabel, kv, blocks, notes, clearance, tooBig }. */
export function drawSite(doc, project, lot) {
  const view = siteView(project, lot);
  const { T: S, scale } = view;
  const field = new LabelField(VP);
  const bd = boundaryDims(lot);
  const edges = classifyEdges(lot);
  const inward = (i) => inwardNormalOf(lot, i);
  const cl = clearances(project);
  const tooBig = cl.status === 'breach';
  const dashOff = () => doc.setLineDashPattern([], 0);

  // Adjoining lots (DCDB context).
  dashOff();
  doc.setLineWidth(0.15);
  doc.setDrawColor(...GREYLINE);
  for (const n of lot.neighbours || []) {
    if (!n.ring || n.ring.length < 3 || n.isRoad) continue;
    polyLine(doc, n.ring.map(S));
  }
  const ground0 = hasGround(lot);
  const contourLines = ground0 ? drawContours(doc, lot, S, VP) : [];
  const neighbourLabels = [];
  for (const n of lot.neighbours || []) {
    if (!n.ring || n.ring.length < 3 || n.isRoad || (!n.lotNumber && !n.planLabel)) continue;
    const c = S(G.polygonCentroid(n.ring));
    if (inVP(c)) neighbourLabels.push({ c, n });
  }

  // Road reserve: footpath, kerb and gutter, carriageway and the red centreline. One chain per street frontage.
  const roadName = (lot.roads && lot.roads[0]?.name) || lot.roadName || '';
  for (const r of view.roads) {
    const L = (k) => r.lines[k].map(S);
    dashOff();
    doc.setLineWidth(0.15);
    doc.setDrawColor(...GREYLINE);
    for (const k of ['footpathNear', 'footpathFar']) polyLine(doc, L(k), false);
    doc.setLineWidth(0.3);
    doc.setDrawColor(...PEN.ink);
    for (const k of ['kerb', 'gutter', 'farGutter', 'farKerb']) polyLine(doc, L(k), false);
    doc.setLineWidth(0.35);
    doc.setDrawColor(...PEN.phantom);
    doc.setLineDashPattern(PHANTOM.map((v) => v * 0.9), 0);
    polyLine(doc, L('centreline'), false);
    dashOff();
  }

  // Too big for this block (placed early so nothing else takes its space).
  if (tooBig) {
    const w = 96;
    const h = 15;
    const spots = [{ x: VP.x0 + 4, y: VP.y0 + 4 }, { x: (VP.x0 + VP.x1) / 2 - w / 2, y: VP.y0 + 4 }, { x: VP.x1 - w - 4, y: VP.y0 + 4 }, { x: VP.x0 + 4, y: VP.y1 - h - 4 }];
    const spot = spots[0];
    doc.setFillColor(255, 255, 255);
    doc.setDrawColor(...RED);
    doc.setLineWidth(0.6);
    doc.rect(spot.x, spot.y, w, h, 'FD');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(...RED);
    doc.text('Too big for this block', spot.x + 3, spot.y + 6.2);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.6);
    doc.text('The house sits outside the setback lines. Choose a smaller design or a larger lot.', spot.x + 3, spot.y + 11.4);
    field.addBox({ x0: spot.x, y0: spot.y, x1: spot.x + w, y1: spot.y + h });
  }

  // Setback line.
  const env = envelopePoly(lot);
  if (env) {
    doc.setLineWidth(0.2);
    doc.setDrawColor(...GREYLINE);
    doc.setLineDashPattern([1.8, 1.1], 0);
    polyLine(doc, env.map(S));
    dashOff();
    regRing(field, env.map(S), true, true);
  }

  // House: floor shading, walls and doors, eaves line.
  const ground = groundLevel(project);
  const hullPoly = buildingHull(project);
  const shapes = wallShapes(ground);
  doc.setFillColor(238, 241, 246);
  for (const r of ground.rooms.filter((q) => q.status !== 'demolish' && (!q.outdoor || q.roofed) && q.polygon?.length >= 3)) {
    const sp = r.polygon.map(S);
    doc.lines(sp.slice(1).map((p, i) => [p.x - sp[i].x, p.y - sp[i].y]), sp[0].x, sp[0].y, [1, 1], 'F', true);
  }
  planGeometry(doc, { level: ground, shapes, scale }, S, false, null);
  doc.setLineWidth(0.25);
  doc.setDrawColor(...PEN.ink);
  doc.setLineDashPattern([3, 1.2], 0);
  const eaves = eavesRuns(project);
  for (const run of eaves) polyLine(doc, run.map(S), false);
  dashOff();
  for (const sh of shapes) for (const pc of sh.pieces) regRing(field, pc.poly.map(S));
  for (const run of eaves) regRing(field, run.map(S), false);

  // Driveway and crossover.
  const dw = deriveDriveway(project);
  let driveCentre = null;
  if (dw?.ok) {
    doc.setLineWidth(0.2);
    doc.setDrawColor(...GREYLINE);
    for (const poly of [dw.polygon, dw.crossover?.polygon].filter(Boolean)) {
      const sp = poly.map(S);
      doc.setFillColor(246, 246, 246);
      doc.lines(sp.slice(1).map((p, i) => [p.x - sp[i].x, p.y - sp[i].y]), sp[0].x, sp[0].y, [1, 1], 'FD', true);
      hatch(doc, sp, 'concrete');
      regRing(field, sp);
    }
    driveCentre = dw.centre.map(S);
  }

  // Room names, only for rooms of about 12 m2 or more, over a white halo. The rest are named on A100.
  for (const r of ground.rooms) {
    if (r.status === 'demolish' || r.outdoor || !r.polygon || r.polygon.length < 3 || G.polygonArea(r.polygon) / 1e6 < 12) continue;
    const c = G.polygonCentroid(r.polygon);
    if (!G.pointInPolygon(c, r.polygon)) continue;
    const sc = S(c);
    const nm = String(r.name || r.type || '').toUpperCase();
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(5.4);
    const w = doc.getTextWidth(nm);
    const rb = G.bbox(r.polygon.map(S));
    if (w + 1 > rb.w || scale > 500) continue;
    haloText(doc, nm, sc.x, sc.y + 0.8, { size: 5.4, bold: true, align: 'center', halo: 0.9 });
    field.addBox({ x0: sc.x - w / 2 - 0.5, y0: sc.y - 2, x1: sc.x + w / 2 + 0.5, y1: sc.y + 1.4 });
  }

  // Lot boundary and corners.
  doc.setDrawColor(...PEN.ink);
  doc.setLineWidth(0.75);
  if (lot.proposed) doc.setLineDashPattern([5, 2], 0);
  polyLine(doc, lot.boundary.map(S));
  dashOff();
  doc.setFillColor(...PEN.ink);
  for (const p of lot.boundary) { const q = S(p); if (inVP(q)) doc.circle(q.x, q.y, 0.7, 'F'); }

  // Bearings and lengths. An edge shorter than its label is tagged and listed in the boundary schedule instead.
  const short = [];
  const bsize = 6.4;
  const bh = bsize * 0.3528;
  for (const d of bd) {
    const a = S(d.a);
    const b = S(d.b);
    const dir = G.norm(G.sub(b, a));
    const out = G.mul(inward(d.index), -1);
    const lbl = `${d.bearing} ${d.length}`;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(bsize);
    const w = doc.getTextWidth(lbl);
    let placed = null;
    if (lenOf(a, b) >= w + 3) {
      const cands = [0.5, 0.35, 0.65, 0.22, 0.78, 0.12, 0.88].filter((f) => f === 0.5 || lenOf(a, b) * Math.min(f, 1 - f) >= w / 2 + 2).map((f) => () => {
        const mid = G.lerp(a, b, f);
        const probe = alongLabel(doc, lbl, mid, dir, 0, { size: bsize });
        const off = G.dot(probe.up, out) > 0 ? 1.4 : -(1.4 + bh);
        return alongLabel(doc, lbl, mid, dir, off, { size: bsize, colour: PEN.ink, halo: 0.9 });
      });
      placed = field.place(cands, { lines: false });
    }
    if (!placed) short.push(d);
  }
  const schedule = [];
  for (const d of short) {
    const tag = `E${d.index + 1}`;
    const mid = S(d.mid);
    const out = G.mul(inward(d.index), -1);
    const cands = [2.4, 3.6, 5].map((k) => () => {
      const c = { x: mid.x + out.x * k, y: mid.y + out.y * k };
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(5.2);
      const w = doc.getTextWidth(tag);
      return { box: { x0: c.x - w / 2 - 0.4, y0: c.y - 2.2, x1: c.x + w / 2 + 0.4, y1: c.y + 1 }, draw: () => haloText(doc, tag, c.x, c.y + 0.4, { size: 5.2, bold: true, align: 'center', halo: 0.9 }) };
    });
    field.place(cands, { lines: false });
    schedule.push({ tag, bearing: d.bearing, length: d.length });
  }
  // One setback label per edge kind, on its longest edge.
  const sbSize = 5.6;
  for (const kind of ['front', 'secondaryFront', 'side', 'rear']) {
    const es = edges.filter((e) => e.kind === kind && requiredFor(kind, lot.setbacks) != null);
    if (!es.length) continue;
    const e = es.reduce((a, b) => (G.dist(b.a, b.b) > G.dist(a.a, a.b) ? b : a));
    const req = requiredFor(kind, lot.setbacks);
    const txt = `${req.toFixed(2)} SB`;
    const inn = inward(e.index);
    const paper = (req * 1000) / scale;
    const dirS = G.norm(G.sub(S(e.b), S(e.a)));
    for (const f of [0.5, 0.25, 0.75, 0.15, 0.85]) {
      const p0 = G.lerp(e.a, e.b, f);
      const p1 = G.add(p0, G.mul(inn, req * 1000));
      if (paper < 8) {
        const probe = alongLabel(doc, txt, S(p0), dirS, 0, { size: sbSize });
        const gap = paper + 0.9;
        const off = G.dot(probe.up, inn) > 0 ? gap : -(gap + sbSize * 0.3528);
        const l = alongLabel(doc, txt, S(p0), dirS, off, { size: sbSize, colour: [90, 94, 102], halo: 0.9 });
        if (field.free(l.box, { lines: false })) { l.draw(); field.addBox(l.box); break; }
      } else {
        const a = S(p0);
        const b = S(p1);
        if (!field.free(boxOfPts([a, b], 1.2), { soft: false, lines: true, ignoreSegs: field.segs.filter((sg) => sg.soft) })) continue;
        const box = dimLine(doc, a, b, txt, { colour: [90, 94, 102], size: sbSize, textSide: 1, field });
        if (box) field.addBox(box);
        field.addSeg(a, b);
        break;
      }
    }
  }

  // One perpendicular clearance per edge kind at the tightest point. Dropped when it equals the setback (the label says it); an
  // encroachment is red and carries no minus sign.
  const clearDims = [];
  for (const row of Object.values(cl.byKind || {})) {
    if (!row?.from || !row?.to) continue;
    const a = S(row.from);
    const b = S(row.to);
    if (lenOf(a, b) < 4) continue;
    if (row.requiredM != null && Math.abs(row.clearanceM - row.requiredM) < 0.005) continue;
    const over = row.status === 'outside';
    const box = dimLine(doc, a, b, Math.abs(row.clearanceM).toFixed(2), { colour: over ? RED : PEN.dim, size: 5.6, textSide: -1, field });
    if (box) field.addBox(box);
    field.addSeg(a, b);
    clearDims.push(row);
  }

  regRing(field, lot.boundary.map(S));

  // Road labels, once per chain, on the stretches that run off to either side of the lot.
  const lineLabels = (chain, key, text, { size = 5.8, bold = false, offset = null, colour = [70, 74, 82] } = {}) => {
    const L = chain.lines[key].map(S);
    const segs = [[L[0], L[1]], [L.at(-1), L.at(-2)]];
    const h = size * 0.3528;
    const cands = [];
    for (const [p, q] of segs) {
      const c = clipSegment(p, q, VP);
      if (!c || lenOf(c[0], c[1]) < 18) continue;
      const dir = G.norm(G.sub(c[1], c[0]));
      for (const f of [0.5, 0.3, 0.7, 0.2, 0.8]) cands.push(() => alongLabel(doc, text, G.lerp(c[0], c[1], f), dir, offset ?? -h / 2, { size, bold, colour, halo: 0.9 }));
    }
    field.place(cands, { lines: false });
  };
  for (const chain of view.roads) {
    lineLabels(chain, 'footpathNear', 'FOOTPATH');
    lineLabels(chain, 'kerb', 'VERGE', { offset: -3.6 });
    lineLabels(chain, 'kerb', 'KERB AND GUTTER');
    lineLabels(chain, 'centreline', (roadName || 'EXISTING ROAD').toUpperCase(), { size: 8, bold: true, offset: 2.6, colour: PEN.ink });
    const L = chain.lines.centreline.map(S);
    for (const [p, q] of [[L.at(-1), L.at(-2)], [L[0], L[1]]]) {
      const c = clipSegment(p, q, VP);
      if (!c) continue;
      const dir = G.norm(G.sub(c[1], c[0]));
      const at = { x: c[0].x + dir.x * 6, y: c[0].y + dir.y * 6 };
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(6.5);
      doc.setTextColor(...PEN.phantom);
      doc.text('CL', at.x, at.y - 1.2, { align: 'center' });
      field.addBox({ x0: at.x - 3, y0: at.y - 4, x1: at.x + 3, y1: at.y });
      break;
    }
  }

  // Driveway label.
  if (driveCentre && driveCentre.length > 1) {
    const cands = [];
    for (const f of [0.5, 0.35, 0.65, 0.25]) {
      const i = Math.min(driveCentre.length - 2, Math.floor(f * (driveCentre.length - 1)));
      const p = driveCentre[i];
      const q = driveCentre[i + 1];
      if (lenOf(p, q) < 0.01) continue;
      cands.push(() => alongLabel(doc, 'CONC. DRIVEWAY', G.lerp(p, q, 0.5), G.norm(G.sub(q, p)), -5.4 * 0.3528 / 2, { size: 5.4, colour: [70, 74, 82], halo: 0.9 }));
    }
    field.place(cands, { lines: false });
  }
  for (const { c, n } of neighbourLabels) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(5.6);
    const w = Math.max(doc.getTextWidth(`LOT ${n.lotNumber || ''}`), doc.getTextWidth(String(n.planLabel || ''))) + 1;
    const box = { x0: c.x - w / 2, y0: c.y - 3.2, x1: c.x + w / 2, y1: c.y + 3 };
    if (!field.free(box, { lines: false })) continue;
    doc.setTextColor(...GREYLINE);
    const nt = (t, yy) => (ground0 ? haloText(doc, t, c.x, yy, { size: 5.6, colour: GREYLINE, align: 'center', halo: 1 }) : doc.text(t, c.x, yy, { align: 'center' }));
    if (n.lotNumber) nt(`LOT ${n.lotNumber}`, c.y - 0.6);
    if (n.planLabel) nt(String(n.planLabel), c.y + 2.2);
    field.addBox(box);
  }

  // Lot label, the largest type that fits the clear space (not over walls, dimensions, the driveway or other labels).
  const lb = lotLabelLines(lot);
  const first = lb.first || (lot.proposed ? 'PROPOSED LOT' : 'LOT');
  const areaTxt = `${Math.round(lot.areaM2).toLocaleString('en-AU')} m²`;
  const polyS = lot.boundary.map(S);
  const lbb = G.bbox(polyS);
  const hb = hullPoly.length ? G.bbox(hullPoly.map(S)) : null;
  const sizes = [[13, 8, 9.5], [11, 7.2, 8.5], [9, 6.4, 7.5], [7.5, 5.6, 6.5]];
  const cands = [];
  for (let x = lbb.minX; x <= lbb.maxX; x += 3) {
    for (let y = lbb.minY; y <= lbb.maxY; y += 3) {
      const p = { x, y };
      if (!G.pointInPolygon(p, polyS)) continue;
      const hd = hb ? Math.hypot(Math.max(hb.minX - x, 0, x - hb.maxX), Math.max(hb.minY - y, 0, y - hb.maxY)) : 100;
      const ed = Math.min(...polyS.map((q, i) => G.projectToSegment(p, q, polyS[(i + 1) % polyS.length]).d));
      cands.push({ x, y, score: Math.min(hd, 40) + 0.5 * Math.min(ed, 40) });
    }
  }
  cands.sort((a, b) => b.score - a.score);
  let lotPlaced = false;
  for (const [s1, s2, s3, strict] of [...sizes.map((z) => [...z, true]), ...sizes.map((z) => [...z, false])]) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(s1);
    let w = doc.getTextWidth(first);
    doc.setFontSize(s2);
    if (lb.second) w = Math.max(w, doc.getTextWidth(lb.second));
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(s3);
    w = Math.max(w, doc.getTextWidth(areaTxt)) + 2;
    const h = s1 * 0.3528 + (lb.second ? s2 * 0.3528 + 2 : 0) + s3 * 0.3528 + 4;
    for (const c of cands) {
      const box = { x0: c.x - w / 2, y0: c.y - h / 2, x1: c.x + w / 2, y1: c.y + h / 2 };
      if (![[box.x0, box.y0], [box.x1, box.y0], [box.x1, box.y1], [box.x0, box.y1]].every(([x, y]) => G.pointInPolygon({ x, y }, polyS))) continue;
      if (!field.free(box, { soft: strict })) continue;
      let y = box.y0 + 2 + s1 * 0.3528 * 0.9;
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(s1);
      doc.setTextColor(...PEN.ink);
      const ht = (t, yy, sz, bold) => (ground0 ? haloText(doc, t, c.x, yy, { size: sz, bold, align: 'center', halo: 1.1 }) : doc.text(t, c.x, yy, { align: 'center' }));
      ht(first, y, s1, true);
      if (lb.second) { y += s2 * 0.3528 + 1.6; doc.setFontSize(s2); ht(lb.second, y, s2, true); }
      y += s3 * 0.3528 + 1.8;
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(s3);
      ht(areaTxt, y, s3, false);
      field.addBox(box);
      lotPlaced = true;
      break;
    }
    if (lotPlaced) break;
  }
  if (!lotPlaced && cands[0]) {
    const [s1, , s3] = sizes.at(-1);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(s1);
    doc.setTextColor(...PEN.ink);
    doc.text(first, cands[0].x, cands[0].y, { align: 'center' });
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(s3);
    doc.text(areaTxt, cands[0].x, cands[0].y + 4, { align: 'center' });
  }

  // Ground levels: spot levels at the lot and house corners, then RL labels along the contours, in the space that is left.
  if (ground0) {
    const zAt = groundLevelFn(lot);
    const lc = S(G.polygonCentroid(lot.boundary));
    const unit = (a, b) => { const d = G.sub(a, b); const l = Math.hypot(d.x, d.y) || 1; return { x: d.x / l, y: d.y / l }; };
    const spots = cornersOf(lot.boundary).map((p) => ({ p, out: unit(S(p), lc) }));
    if (hullPoly.length) {
      const hc = S(G.polygonCentroid(hullPoly));
      for (const p of houseCorners(hullPoly)) spots.push({ p, out: unit(S(p), hc) });
    }
    drawSpotLevels(doc, field, spots, zAt, S);
    if (hullPoly.length) { const hb = G.bbox(hullPoly.map(S)); field.addBox({ x0: hb.minX, y0: hb.minY, x1: hb.maxX, y1: hb.maxY }); }
    placeContourLabels(doc, field, contourLines, VP);
  }

  // Enlarged house at 1:200 when the plan is too small to read the house (scale above 1:500).
  if (scale > 500 && hullPoly.length) {
    const hbm = G.bbox(hullPoly);
    let k = 200;
    let w = 0;
    let h = 0;
    let spot = null;
    for (const kk of [200, 250, 300, 400]) {
      k = kk;
      w = hbm.w / k + 8;
      h = hbm.h / k + 12;
      const spots = [{ x: VP.x0 + 4, y: VP.y0 + 4 }, { x: VP.x1 - w - 4, y: VP.y0 + 4 }, { x: VP.x0 + 4, y: VP.y1 - h - 4 }, { x: VP.x1 - w - 4, y: VP.y1 - h - 4 }];
      for (let gy = VP.y0 + 4; gy + h <= VP.y1 - 4; gy += 5) for (let gx = VP.x0 + 4; gx + w <= VP.x1 - 4; gx += 5) spots.push({ x: gx, y: gy });
      spot = spots.find((q) => field.free({ x0: q.x, y0: q.y, x1: q.x + w, y1: q.y + h }, { soft: false }));
      if (spot) break;
    }
    if (!spot) { k = 200; w = hbm.w / k + 8; h = hbm.h / k + 12; spot = { x: VP.x1 - w - 4, y: VP.y0 + 4 }; }
    doc.setFillColor(255, 255, 255);
    doc.setDrawColor(...PEN.ink);
    doc.setLineWidth(0.3);
    doc.rect(spot.x, spot.y, w, h, 'FD');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(6.8);
    doc.setTextColor(...PEN.ink);
    doc.text(`HOUSE AT 1:${k}`, spot.x + 3, spot.y + 5);
    const T2 = (p) => ({ x: spot.x + 4 + (p.x - hbm.minX) / k, y: spot.y + 8 + (p.y - hbm.minY) / k });
    doc.setFillColor(238, 241, 246);
    for (const r of ground.rooms.filter((q) => q.status !== 'demolish' && (!q.outdoor || q.roofed) && q.polygon?.length >= 3)) {
      const sp = r.polygon.map(T2);
      doc.lines(sp.slice(1).map((p, i) => [p.x - sp[i].x, p.y - sp[i].y]), sp[0].x, sp[0].y, [1, 1], 'F', true);
    }
    planGeometry(doc, { level: ground, shapes, scale: k }, T2, false, null);
    field.addBox({ x0: spot.x, y0: spot.y, x1: spot.x + w, y1: spot.y + h });
  }

  // North point in the emptiest corner of the viewport; scale bar in the band below it.
  const r = 15;
  const corners = [{ x: VP.x1 - r - 2, y: VP.y0 + r + 2 }, { x: VP.x0 + r + 2, y: VP.y0 + r + 2 }, { x: VP.x1 - r - 2, y: VP.y1 - r - 2 }, { x: VP.x0 + r + 2, y: VP.y1 - r - 2 }];
  const nc = corners.find((c) => field.free({ x0: c.x - r, y0: c.y - r, x1: c.x + r, y1: c.y + r }, { soft: false })) || corners.find((c) => field.free({ x0: c.x - r, y0: c.y - r, x1: c.x + r, y1: c.y + r }, { lines: false })) || corners[0];
  northPoint(doc, nc.x, nc.y, Number(project.site?.northDeg) || 0);
  field.addBox({ x0: nc.x - r, y0: nc.y - r, x1: nc.x + r, y1: nc.y + r });
  doc.setDrawColor(...PEN.ink);
  const spec = scaleBar(doc, VP.x0 + 6, VP.y1 + 4.2, scale, scale);
  const barLen = (spec.segMetres * spec.parts * 1000) / scale;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.5);
  doc.setTextColor(...PEN.ink);
  doc.text(`1:${scale} @ A3`, VP.x0 + 6 + barLen + 14, VP.y1 + 6.2);

  // Facts for the strip.
  const fp = groundFootprintM2(project);
  const sb = lot.setbacks || {};
  const m = (v) => (typeof v === 'number' ? v : v?.minM);
  const hb2 = hullPoly.length ? G.bbox(hullPoly) : null;
  const dimsLot = (() => {
    const f = edges.find((e) => e.kind === 'front');
    if (!f) return null;
    const n = inward(f.index);
    const ds = lot.boundary.map((p) => G.dot(G.sub(p, f.a), n));
    return { frontage: G.dist(f.a, f.b) / 1000, depth: (Math.max(...ds) - Math.min(...ds)) / 1000 };
  })();
  const kv = [
    ['Lot area', areaTxt],
    dimsLot ? ['Frontage / depth', `${dimsLot.frontage.toFixed(2)} / ${dimsLot.depth.toFixed(2)} m`] : null,
    ['House footprint', hb2 ? `${(hb2.w / 1000).toFixed(1)} x ${(hb2.h / 1000).toFixed(1)} m` : 'n/a'],
    ['Site coverage', lot.areaM2 ? `${((fp / lot.areaM2) * 100).toFixed(1)} %` : 'n/a'],
    ['Setbacks F / S / R', [m(sb.front), m(sb.side), m(sb.rear)].map((v) => (typeof v === 'number' ? v.toFixed(2) : 'n/a')).join(' / ') + ' m'],
    ['Setback check', cl.status === 'ok' ? 'Inside setbacks (indicative)' : cl.status === 'breach' ? 'Outside setbacks (indicative)' : 'Setbacks not loaded'],
  ].filter(Boolean);
  const blocks = [legendBlock({ contours: ground0 })];
  if (schedule.length) blocks.push(scheduleBlock(schedule));
  const notes = ['Boundaries from the cadastre (DCDB), subject to survey.', 'Bearings are grid bearings. Lengths are in metres.', 'Setback lines and dimensions are indicative.', 'Driveway and road reserve are typical values.'];
  notes.push(ground0 ? `Levels are indicative only, from the ${lot.state === 'QLD' ? 'Queensland' : 'NSW'} 5 m DEM, not survey. Contours at 1.0 m intervals. A registered survey is required.` : 'No ground levels for this lot.');
  if (schedule.length) notes.push('Edges too short to label are tagged E and listed in the boundary schedule.');
  void clean;
  return { scale, scaleLabel: `1:${scale} @ A3`, kv, blocks, notes, clearance: cl, tooBig };
}
