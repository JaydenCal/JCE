// Site plan sheet (C100): lot boundary with bearings and lengths, setback line and dimensions, house footprint with rooms and roof outline,
// driveway to the kerb, road reserve with the centreline, DCDB context, legend, north point and scale bar. Matches the builder Lot Planner's
// A3 site plan PDF. Sheet units are millimetres on A3; plan units are millimetres on the ground (y down, plan up = grid north).

import * as G from '../../../model/geometry.js';
import { classifyEdges, requiredFor } from '../../../model/placement.js';
import { boundaryDims, roadReserve, deriveDriveway, clearances, buildingHull, lotLabelLines } from '../../../site/lotplan.js';
import { wallShapes } from '../shared.js';
import { planGeometry, scaleBar } from '../pdf.js';
import { PEN, PHANTOM, clipSegment, hatch, dimLine, haloText, alongLabel, ink } from '../eng/kit.js';
import { AREA } from './frame.js';
import { groundLevel, envelopePoly, groundFootprintM2 } from './lot.js';

export const SITE_SCALES = [100, 150, 200, 250, 300, 400, 500, 750, 1000, 1500, 2000];
const VP = { x0: AREA.x0 + 2, y0: AREA.y0 + 2, x1: AREA.x1 - 2, y1: AREA.y1 - 7 };
const GREYLINE = [120, 124, 132];
const roofRooms = (project) => (project.levels || []).flatMap((l) => (l.rooms || []).filter((r) => r.status !== 'demolish' && (!r.outdoor || r.roofed) && r.polygon?.length >= 3));

/** Convex outline pushed out by d (mm). Used for the eaves line. */
export function offsetHull(hull, d) {
  if (hull.length < 3) return hull;
  const sgn = Math.sign(G.signedArea(hull)) || 1;
  return hull.map((p, i) => {
    const a = hull[(i + hull.length - 1) % hull.length];
    const b = hull[(i + 1) % hull.length];
    const n1 = G.norm(G.sub(p, a));
    const n2 = G.norm(G.sub(b, p));
    const out = (u) => ({ x: u.y * sgn, y: -u.x * sgn });
    const o1 = out(n1);
    const o2 = out(n2);
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

/**
 * The eaves line (plan mm): each roofed room pushed out by the overhang, keeping only the stretches that are not inside another
 * room's eaves. Returns runs of points (polylines), so an L or T shaped house gets an L or T shaped roof line.
 */
export function eavesRuns(project) {
  const rooms = roofRooms(project).filter((r) => r.polygon.length >= 3);
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
        const keep = !inside(G.lerp(p, q, 0.5), gi);
        if (keep) { if (!cur) { cur = [p]; runs.push(cur); } cur.push(q); } else cur = null;
      }
    }
  });
  return runs;
}

/** Scale and transform for the lot: the largest standard scale at which lot, road frontage and house fit the viewport. */
export function siteView(project, lot) {
  const pts = [...lot.boundary];
  const hull = buildingHull(project);
  pts.push(...hull);
  const roads = roadReserve(lot);
  for (const r of roads) {
    const e = lot.boundary[r.edge];
    const f = lot.boundary[(r.edge + 1) % lot.boundary.length];
    const reach = (r.vergeM + r.gutterM + r.carriagewayM / 2) * 1000;
    pts.push(G.add(e, G.mul(r.outward, reach)), G.add(f, G.mul(r.outward, reach)));
  }
  const bb = G.bbox(pts);
  const padX = 9000;
  const padY = 3500;
  const w = bb.w + 2 * padX;
  const h = bb.h + 2 * padY;
  const vw = VP.x1 - VP.x0;
  const vh = VP.y1 - VP.y0;
  const scale = SITE_SCALES.find((n) => w / n <= vw && h / n <= vh) || SITE_SCALES.at(-1) * 2;
  const cx = bb.minX + bb.w / 2;
  const cy = bb.minY + bb.h / 2;
  const mx = (VP.x0 + VP.x1) / 2;
  const my = (VP.y0 + VP.y1) / 2;
  const T = (p) => ({ x: mx + (p.x - cx) / scale, y: my + (p.y - cy) / scale });
  return { scale, T, roads, bb };
}

const segLine = (doc, a, b) => { const s = clipSegment(a, b, VP); if (s) doc.line(s[0].x, s[0].y, s[1].x, s[1].y); };
const polyLine = (doc, pts, closed = true) => { const n = closed ? pts.length : pts.length - 1; for (let i = 0; i < n; i++) segLine(doc, pts[i], pts[(i + 1) % pts.length]); };
const inVP = (p) => p.x >= VP.x0 && p.x <= VP.x1 && p.y >= VP.y0 && p.y <= VP.y1;

function north(doc, cx, cy, deg) {
  const r = 8.5;
  const a = (deg * Math.PI) / 180;
  const d = { x: Math.sin(a), y: -Math.cos(a) };
  const p = { x: -d.y, y: d.x };
  ink(doc, PEN.ink);
  doc.setLineWidth(0.3);
  doc.setFillColor(255, 255, 255);
  doc.circle(cx, cy, r, 'FD');
  doc.setFillColor(...PEN.ink);
  const tip = { x: cx + d.x * (r - 1), y: cy + d.y * (r - 1) };
  const b1 = { x: cx - d.x * 3 + p.x * 2.6, y: cy - d.y * 3 + p.y * 2.6 };
  const b2 = { x: cx - d.x * 3 - p.x * 2.6, y: cy - d.y * 3 - p.y * 2.6 };
  doc.triangle(tip.x, tip.y, b1.x, b1.y, b2.x, b2.y, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(...PEN.ink);
  doc.text('N', cx + d.x * (r + 3.6), cy + d.y * (r + 3.6) + 1.2, { align: 'center' });
}

function legend(doc, x, y) {
  const items = [
    ['Lot boundary (DCDB)', (a, b) => { doc.setLineWidth(0.7); doc.setDrawColor(...PEN.ink); doc.line(a, b, a + 12, b); }],
    ['Adjoining lot boundary', (a, b) => { doc.setLineWidth(0.15); doc.setDrawColor(...GREYLINE); doc.line(a, b, a + 12, b); }],
    ['Road centreline', (a, b) => { doc.setLineWidth(0.3); doc.setDrawColor(...PEN.phantom); doc.setLineDashPattern([3, 0.8, 0.6, 0.8], 0); doc.line(a, b, a + 12, b); doc.setLineDashPattern([], 0); }],
    ['Building setback line', (a, b) => { doc.setLineWidth(0.2); doc.setDrawColor(...GREYLINE); doc.setLineDashPattern([1.6, 1], 0); doc.line(a, b, a + 12, b); doc.setLineDashPattern([], 0); }],
    ['Walls', (a, b) => { doc.setLineWidth(0.8); doc.setDrawColor(...PEN.ink); doc.line(a, b, a + 12, b); }],
    ['Roof line (eaves)', (a, b) => { doc.setLineWidth(0.25); doc.setDrawColor(...PEN.ink); doc.setLineDashPattern([3, 1.2], 0); doc.line(a, b, a + 12, b); doc.setLineDashPattern([], 0); }],
    ['Kerb and gutter', (a, b) => { doc.setLineWidth(0.25); doc.setDrawColor(...PEN.ink); doc.line(a, b - 0.5, a + 12, b - 0.5); doc.line(a, b + 0.5, a + 12, b + 0.5); }],
    ['Concrete driveway', (a, b) => { doc.setLineWidth(0.15); doc.setDrawColor(...GREYLINE); doc.rect(a, b - 1.4, 12, 2.8, 'S'); hatch(doc, [{ x: a, y: b - 1.4 }, { x: a + 12, y: b - 1.4 }, { x: a + 12, y: b + 1.4 }, { x: a, y: b + 1.4 }], 'concrete'); }],
  ];
  const h = 7 + items.length * 4.1;
  doc.setFillColor(255, 255, 255);
  doc.setDrawColor(...PEN.ink);
  doc.setLineWidth(0.25);
  doc.rect(x, y, 62, h, 'FD');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.2);
  doc.setTextColor(...PEN.ink);
  doc.text('LEGEND', x + 3, y + 4.6);
  items.forEach(([t, draw], i) => {
    const ly = y + 9 + i * 4.1;
    draw(x + 3, ly);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.2);
    doc.setTextColor(...PEN.ink);
    doc.text(t, x + 18, ly + 0.8);
  });
  return { x0: x, y0: y, x1: x + 62, y1: y + h };
}

/** Draws the site plan; returns the facts for the title block strip and the scale label. */
export function drawSite(doc, project, lot, { watermarkSafe = true } = {}) {
  void watermarkSafe;
  const view = siteView(project, lot);
  const { T, scale } = view;
  const S = (p) => T(p);
  const bd = boundaryDims(lot);
  const edges = classifyEdges(lot);
  const inward = (i) => {
    const e = lot.boundary[i];
    const f = lot.boundary[(i + 1) % lot.boundary.length];
    const d = G.norm(G.sub(f, e));
    const n = { x: -d.y, y: d.x };
    return G.signedArea(lot.boundary) > 0 ? n : { x: -n.x, y: -n.y };
  };

  // Adjoining lots (DCDB context).
  doc.setLineDashPattern([], 0);
  doc.setLineWidth(0.15);
  doc.setDrawColor(...GREYLINE);
  for (const n of lot.neighbours || []) {
    if (!n.ring || n.ring.length < 3 || n.isRoad) continue;
    polyLine(doc, n.ring.map(S));
    const c = G.polygonCentroid(n.ring);
    const sc = S(c);
    if (inVP(sc) && (n.lotNumber || n.planLabel)) {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(5.6);
      doc.setTextColor(...GREYLINE);
      if (n.lotNumber) doc.text(`LOT ${n.lotNumber}`, sc.x, sc.y - 0.6, { align: 'center' });
      if (n.planLabel) doc.text(String(n.planLabel), sc.x, sc.y + 2.2, { align: 'center' });
    }
  }

  // Road reserve: footpath, verge, kerb and gutter, carriageway and the red centreline.
  const roadName = (lot.roads && lot.roads[0]?.name) || lot.roadName || '';
  for (const r of view.roads) {
    const L = (k) => r.lines[k].map(S);
    doc.setLineDashPattern([], 0);
    doc.setLineWidth(0.15);
    doc.setDrawColor(...GREYLINE);
    for (const k of ['footpathNear', 'footpathFar']) segLine(doc, ...L(k));
    doc.setLineWidth(0.3);
    doc.setDrawColor(...PEN.ink);
    for (const k of ['kerb', 'gutter', 'farGutter', 'farKerb']) segLine(doc, ...L(k));
    doc.setLineWidth(0.35);
    doc.setDrawColor(...PEN.phantom);
    doc.setLineDashPattern(PHANTOM.map((v) => v * 0.9), 0);
    segLine(doc, ...L('centreline'));
    doc.setLineDashPattern([], 0);
    // labels along the street, left of the lot
    const [a, b] = [S(lot.boundary[r.edge]), S(lot.boundary[(r.edge + 1) % lot.boundary.length])];
    const u = G.norm(G.sub(b, a));
    const out = r.outward;
    const at = (k, off) => { const l = r.lines[k]; const m = S(G.lerp(l[0], l[1], 0.5)); return G.add(G.add(m, G.mul(u, off)), { x: 0, y: 0 }); };
    const lab = (txt, k, off, dOut, size = 5.8, bold = false) => {
      const p = at(k, off);
      const q = { x: p.x + out.x * dOut, y: p.y + out.y * dOut };
      if (!inVP(q)) return;
      const l = alongLabel(doc, txt, q, u, 0, { size, bold, colour: [70, 74, 82], halo: 0.9 });
      l.draw();
    };
    const sp = Math.max(12, Math.min(45, (VP.x1 - VP.x0) / 5));
    lab('FOOTPATH', 'footpathNear', -sp * 2.2, 1.6);
    lab('VERGE', 'kerb', sp * 2.4, -1.8);
    lab('KERB AND GUTTER', 'kerb', -sp * 2.2, 2.4);
    lab((roadName || 'EXISTING ROAD').toUpperCase(), 'centreline', -sp * 2.2, -3.6, 8, true);
    const cl = S(G.lerp(r.lines.centreline[0], r.lines.centreline[1], 0.5));
    const clp = { x: VP.x1 - 8, y: cl.y };
    if (Math.abs(u.x) > 0.9) { doc.setFont('helvetica', 'bold'); doc.setFontSize(6.5); doc.setTextColor(...PEN.phantom); doc.text('CL', clp.x, cl.y - 1.2, { align: 'center' }); }
  }

  // Setback line (envelope) and the setback dimensions.
  const env = envelopePoly(lot);
  if (env) {
    doc.setLineWidth(0.2);
    doc.setDrawColor(...GREYLINE);
    doc.setLineDashPattern([1.8, 1.1], 0);
    polyLine(doc, env.map(S));
    doc.setLineDashPattern([], 0);
  }
  for (const e of edges) {
    const req = requiredFor(e.kind, lot.setbacks);
    if (req == null) continue;
    const f = e.kind === 'front' ? 0.18 : e.kind === 'rear' ? 0.82 : 0.3;
    const p0 = G.lerp(e.a, e.b, f);
    const p1 = G.add(p0, G.mul(inward(e.index), req * 1000));
    const lbl = `${req.toFixed(2)} SB`;
    if ((req * 1000) / scale < 8) {
      const dir = G.norm(G.sub(S(e.b), S(e.a)));
      const probe = alongLabel(doc, lbl, S(p0), dir, 0, { size: 5.6 });
      const h = 5.6 * 0.3528;
      const gap = (req * 1000) / scale + 0.9;
      const inn = inward(e.index);
      const off = G.dot(probe.up, inn) > 0 ? gap : -(gap + h);
      alongLabel(doc, lbl, S(p0), dir, off, { size: 5.6, colour: [90, 94, 102], halo: 0.9 }).draw();
    } else dimLine(doc, S(p0), S(p1), lbl, { colour: [90, 94, 102], size: 5.6, textSide: 1 });
  }

  // Lot boundary, corners, bearings and lengths.
  doc.setDrawColor(...PEN.ink);
  doc.setLineWidth(0.75);
  if (lot.proposed) doc.setLineDashPattern([5, 2], 0);
  polyLine(doc, lot.boundary.map(S));
  doc.setLineDashPattern([], 0);
  doc.setFillColor(...PEN.ink);
  for (const p of lot.boundary) { const q = S(p); if (inVP(q)) doc.circle(q.x, q.y, 0.7, 'F'); }
  for (const d of bd) {
    const a = S(d.a);
    const b = S(d.b);
    const dir = G.norm(G.sub(b, a));
    const inn = inward(d.index);
    const size = 6.4;
    const h = size * 0.3528;
    const lbl = `${d.bearing}  ${d.length}`;
    const l = alongLabel(doc, lbl, G.lerp(a, b, 0.5), dir, 0, { size });
    const sgn = G.dot(l.up, { x: -inn.x, y: -inn.y }) > 0 ? 1 : -1;
    const off = sgn > 0 ? 1.4 : -(1.4 + h);
    const placed = alongLabel(doc, lbl, G.lerp(a, b, 0.5), dir, off, { size, colour: PEN.ink, halo: 0.9 });
    placed.draw();
  }

  // Driveway and crossover.
  const dw = deriveDriveway(project);
  if (dw?.ok) {
    doc.setLineWidth(0.2);
    doc.setDrawColor(...GREYLINE);
    doc.setFillColor(255, 255, 255);
    for (const poly of [dw.polygon, dw.crossover?.polygon].filter(Boolean)) {
      const sp = poly.map(S);
      doc.setLineDashPattern([], 0);
      doc.setFillColor(246, 246, 246);
      doc.lines(sp.slice(1).map((p, i) => [p.x - sp[i].x, p.y - sp[i].y]), sp[0].x, sp[0].y, [1, 1], 'FD', true);
      hatch(doc, sp, 'concrete');
    }
    const mid = S(dw.centre[Math.floor(dw.centre.length / 2)] || dw.doorMid);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(5.6);
    haloText(doc, 'CONC. DRIVEWAY', mid.x + 4.6, mid.y, { size: 5.6, colour: [70, 74, 82], angle: 90, align: 'center' });
  }

  // House: floor shading, walls and doors, room names, eaves line.
  const ground = groundLevel(project);
  const hullPoly = buildingHull(project);
  if (hullPoly.length >= 3) {
    const rooms = roofRooms(project).filter((r) => ground.rooms.includes(r) || ground.rooms.some((g) => g.id === r.id));
    doc.setFillColor(238, 241, 246);
    for (const r of rooms) { const sp = r.polygon.map(S); doc.lines(sp.slice(1).map((p, i) => [p.x - sp[i].x, p.y - sp[i].y]), sp[0].x, sp[0].y, [1, 1], 'F', true); }
  }
  const shapes = wallShapes(ground);
  planGeometry(doc, { level: ground, shapes, scale }, S, false, null);
  doc.setLineWidth(0.25);
  doc.setDrawColor(...PEN.ink);
  doc.setLineDashPattern([3, 1.2], 0);
  for (const run of eavesRuns(project)) polyLine(doc, run.map(S), false);
  doc.setLineDashPattern([], 0);
  // Room names (areas for the larger rooms), only where the room is big enough to hold them.
  for (const r of ground.rooms) {
    if (r.status === 'demolish' || !r.polygon || r.polygon.length < 3) continue;
    const bb = G.bbox(r.polygon);
    const wMm = bb.w / scale;
    const hMm = bb.h / scale;
    if (wMm < 7 || hMm < 5) continue;
    const c = S(G.polygonCentroid(r.polygon));
    const size = wMm >= 20 ? 5.6 : 4.6;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(size);
    doc.setTextColor(...PEN.ink);
    const nm = String(r.name || r.type || '').toUpperCase();
    const t = doc.getTextWidth(nm) > wMm - 1 ? nm.slice(0, Math.max(3, Math.floor(nm.length * (wMm - 1) / doc.getTextWidth(nm)))) : nm;
    doc.text(t, c.x, c.y, { align: 'center' });
    if (wMm >= 14 && hMm >= 9 && !r.outdoor) {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(size - 0.8);
      doc.text(`${(G.polygonArea(r.polygon) / 1e6).toFixed(1)} m²`, c.x, c.y + size * 0.4, { align: 'center' });
    }
  }

  // Clearances from the house to each boundary.
  const cl = clearances(project);
  for (const row of cl.rows || []) {
    if (!row.from || !row.to) continue;
    const a = S(row.from);
    const b = S(row.to);
    if (Math.hypot(a.x - b.x, a.y - b.y) < 4) continue;
    dimLine(doc, a, b, row.clearanceM.toFixed(2), { colour: PEN.dim, size: 5.6, textSide: -1 });
  }

  // Lot label and area, in the clearest open ground.
  const lb = lotLabelLines(lot);
  const hullS = hullPoly.map(S);
  const hb = hullS.length ? G.bbox(hullS) : null;
  const polyS = lot.boundary.map(S);
  let best = null;
  const lbb = G.bbox(polyS);
  for (let x = lbb.minX; x <= lbb.maxX; x += 3) {
    for (let y = lbb.minY; y <= lbb.maxY; y += 3) {
      const p = { x, y };
      if (!G.pointInPolygon(p, polyS)) continue;
      const edgeD = Math.min(...polyS.map((q, i) => G.projectToSegment(p, q, polyS[(i + 1) % polyS.length]).d));
      if (edgeD < 14) continue;
      const hd = hb ? Math.hypot(Math.max(hb.minX - x, 0, x - hb.maxX), Math.max(hb.minY - y, 0, y - hb.maxY)) : 100;
      const score = Math.min(hd, 40) * 2 + edgeD * 0.2;
      if (!best || score > best.score) best = { x, y, score };
    }
  }
  if (best) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(13);
    doc.setTextColor(...PEN.ink);
    doc.text(lb.first || 'LOT', best.x, best.y, { align: 'center' });
    doc.setFontSize(8);
    if (lb.second) doc.text(lb.second, best.x, best.y + 4.8, { align: 'center' });
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9.5);
    doc.text(`${Math.round(lot.areaM2).toLocaleString('en-AU')} m²`, best.x, best.y + (lb.second ? 10 : 5.5), { align: 'center' });
  }

  // Legend, north point, scale bar.
  const lg = legend(doc, VP.x0 + 3, VP.y0 + 3);
  void lg;
  north(doc, VP.x1 - 14, VP.y0 + 15, Number(project.site?.northDeg) || 0);
  ink(doc, PEN.ink);
  scaleBar(doc, VP.x0 + 6, VP.y1 - 11, scale, scale);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.5);
  doc.setTextColor(...PEN.ink);
  doc.text(`1:${scale} @ A3`, VP.x0 + 6, VP.y1 - 15.5);

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
    ['Lot area', `${Math.round(lot.areaM2).toLocaleString('en-AU')} m²`],
    dimsLot ? ['Frontage / depth', `${dimsLot.frontage.toFixed(2)} / ${dimsLot.depth.toFixed(2)} m`] : null,
    ['House footprint', hb2 ? `${(hb2.w / 1000).toFixed(1)} x ${(hb2.h / 1000).toFixed(1)} m` : 'n/a'],
    ['Site coverage', lot.areaM2 ? `${((fp / lot.areaM2) * 100).toFixed(1)} %` : 'n/a'],
    ['Setbacks F / S / R', [m(sb.front), m(sb.side), m(sb.rear)].map((v) => (typeof v === 'number' ? v.toFixed(2) : 'n/a')).join(' / ') + ' m'],
    ['Setback check', cl.status === 'ok' ? 'Inside setbacks (indicative)' : cl.status === 'breach' ? 'Outside setbacks (indicative)' : 'Setbacks not loaded'],
  ].filter(Boolean);
  return { scale, scaleLabel: `1:${scale} @ A3`, kv, clearance: cl };
}
