// Elevations, section and roof plan drawn from the same 3D model the viewer shows (buildModel), as line drawings: triangles are
// sorted far to near (painter's algorithm), filled in light tones, and only feature edges are stroked (outline, openings, creases),
// so coplanar triangulation never shows. The section is the model sliced by a vertical plane, with heavy cut lines.

import * as G from '../../../model/geometry.js';
import { terrainAt } from '../../../site/model.js';
import { buildingHull, orientedBox } from '../../../site/lotplan.js';
import { PEN, clean, ink, viewTitle, labelOn, wrap, polygon } from './kit.js';
import { scaleBar } from '../pdf.js';

const KINDS = [['wall', 'wall'], ['opening', 'opening'], ['leaf', 'leaf'], ['roof', 'roof'], ['slab', 'slab'], ['floor', 'floor'], ['stair', 'stair'], ['tank', 'tank']];
const kindOf = (name) => {
  if (name === 'slab') return 'slab';
  for (const [p, k] of KINDS) if (name.startsWith(`${p}:`) || name === p) return k;
  return null;
};
const BIAS = { opening: 90, leaf: 140, stair: 0, tank: 0 };

/** Triangles of the model in plan millimetres, y down: { p: [{x, y, z}], n, kind, inner }. z is up from the ground floor level. */
export async function collectTriangles(project, catalogue = null) {
  const { buildModel } = await import('../../../viewer3d/build.js');
  const g = buildModel(project, { catalogue, showRoof: true, statusView: 'proposed', levelFilter: 'all' });
  g.updateMatrixWorld(true);
  const tris = [];
  const e = (g.matrixWorld && g.matrixWorld.elements) || null;
  void e;
  g.traverse((o) => {
    if (!o.isMesh || !o.geometry?.attributes?.position) return;
    const kind = kindOf(o.name || '');
    if (!kind) return;
    const pos = o.geometry.attributes.position;
    const idx = o.geometry.index;
    const m = o.matrixWorld.elements;
    const P = (i) => {
      const x = pos.getX(i);
      const y = pos.getY(i);
      const z = pos.getZ(i);
      return { x: (m[0] * x + m[4] * y + m[8] * z + m[12]) * 1000, y: (m[2] * x + m[6] * y + m[10] * z + m[14]) * 1000, z: (m[1] * x + m[5] * y + m[9] * z + m[13]) * 1000 };
    };
    const count = idx ? idx.count : pos.count;
    for (let i = 0; i < count; i += 3) {
      const a = P(idx ? idx.getX(i) : i);
      const b = P(idx ? idx.getX(i + 1) : i + 1);
      const c = P(idx ? idx.getX(i + 2) : i + 2);
      const n = normalOf(a, b, c);
      if (!n) continue;
      tris.push({ p: [a, b, c], n, kind, inner: o.userData?.face === 'inside' });
    }
  });
  return tris;
}

function normalOf(a, b, c) {
  const u = { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z };
  const v = { x: c.x - a.x, y: c.y - a.y, z: c.z - a.z };
  const n = { x: u.y * v.z - u.z * v.y, y: u.z * v.x - u.x * v.z, z: u.x * v.y - u.y * v.x };
  const l = Math.hypot(n.x, n.y, n.z);
  if (l < 1e-6) return null;
  // Axes were swapped (three y up to plan z, three z to plan y), which reverses handedness: flip to the outward normal.
  return { x: -n.x / l, y: -n.y / l, z: -n.z / l };
}

const key = (p) => `${Math.round(p.x)},${Math.round(p.y)},${Math.round(p.z)}`;

/** Edges worth stroking: open edges (one face), edges between different kinds, and creases above `deg` degrees. */
function featureEdges(polys, deg = 24) {
  const map = new Map();
  polys.forEach((t, ti) => {
    for (let i = 0; i < t.p.length; i++) {
      const a = t.p[i];
      const b = t.p[(i + 1) % t.p.length];
      const ka = key(a);
      const kb = key(b);
      const k = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
      const rec = map.get(k) || [];
      rec.push({ ti, n: t.n, kind: t.kind });
      map.set(k, rec);
    }
  });
  const cos = Math.cos((deg * Math.PI) / 180);
  const flagged = new Set();
  for (const [k, rec] of map) {
    let draw = rec.length === 1;
    if (!draw) {
      for (let i = 1; i < rec.length && !draw; i++) {
        const a = rec[0];
        const b = rec[i];
        if (a.kind !== b.kind) draw = true;
        else if (a.n.x * b.n.x + a.n.y * b.n.y + a.n.z * b.n.z < cos) draw = true;
      }
    }
    if (draw) flagged.add(k);
  }
  return { flagged, keyOf: (a, b) => { const ka = key(a); const kb = key(b); return ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`; } };
}

/** Axes of the building: unit vectors u (long side) and v, angleDeg of u, and the oriented box. */
export function buildingAxes(project) {
  const box = orientedBox(buildingHull(project));
  if (!box) return null;
  const long = box.w >= box.d ? box.u : box.v;
  const short = box.w >= box.d ? box.v : box.u;
  return { box, long, short, centre: box.centre, lengthMm: Math.max(box.w, box.d), widthMm: Math.min(box.w, box.d) };
}

const COMPASS = ['NORTH', 'EAST', 'SOUTH', 'WEST'];
/** The compass name of the side of the building that faces direction `out` (unit, plan, y down so north is -y). */
export function compassOf(out, northDeg = 0) {
  const th = (northDeg * Math.PI) / 180;
  const north = { x: Math.sin(th), y: -Math.cos(th) };
  const east = { x: Math.cos(th), y: Math.sin(th) };
  const bearing = ((Math.atan2(G.dot(out, east), G.dot(out, north)) * 180) / Math.PI + 360) % 360;
  return COMPASS[Math.round(bearing / 90) % 4];
}

/** Four elevation specs { name, f (looking direction, plan), out (face normal) } in the building's own axes. */
export function elevationSpecs(project) {
  const ax = buildingAxes(project);
  const u = ax ? ax.long : { x: 1, y: 0 };
  const v = ax ? ax.short : { x: 0, y: 1 };
  const outs = [{ x: -v.x, y: -v.y }, { x: u.x, y: u.y }, { x: v.x, y: v.y }, { x: -u.x, y: -u.y }];
  const seen = new Set();
  const specs = outs.map((out) => ({ name: compassOf(out, project.site?.northDeg || 0), out, f: { x: -out.x, y: -out.y } }));
  // Two faces can round to one compass name when the building is turned near 45 degrees: number them.
  for (const s of specs) { if (seen.has(s.name)) s.name = `${s.name} (${seen.size})`; seen.add(s.name); }
  const order = ['NORTH', 'EAST', 'SOUTH', 'WEST'];
  specs.sort((a, b) => order.indexOf(a.name.split(' ')[0]) - order.indexOf(b.name.split(' ')[0]));
  return specs;
}

const shade = (base, k) => base.map((c) => Math.max(0, Math.min(255, Math.round(c * k))));
function fillFor(t, light) {
  const k = 0.9 + 0.1 * Math.max(0, -(t.n.x * light.x + t.n.y * light.y + t.n.z * light.z));
  switch (t.kind) {
    case 'opening': return [198, 218, 232];
    case 'leaf': return [236, 238, 240];
    case 'roof': return shade([178, 182, 190], 0.78 + 0.28 * Math.max(0, -(t.n.x * light.x + t.n.y * light.y + t.n.z * light.z)));
    case 'slab': return [226, 224, 220];
    case 'tank': return [208, 226, 212];
    default: return shade([252, 250, 246], k);
  }
}

// Clip a polygon of 3D points to the half space dot(p, a) >= c.
function clipHalf(poly, a, c) {
  const d = (p) => p.x * a.x + p.y * a.y - c;
  const out = [];
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    const dp = d(p);
    const dq = d(q);
    if (dp >= 0) out.push(p);
    if ((dp >= 0) !== (dq >= 0)) {
      const t = dp / (dp - dq);
      out.push({ x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t, z: p.z + (q.z - p.z) * t });
    }
  }
  return out;
}

/**
 * Draw a projected view. view: { right: {x,y} plan unit vector, f: plan looking direction, top: bool, clip: { a, c } }.
 * map(x, y) gives the sheet point from view coordinates (mm to the right, mm up). Returns the view-space box drawn.
 */
export function renderView(doc, tris, { f, top = false, clip = null, sheet, cull = true, skipInner = true, light = { x: -0.4, y: -0.5, z: -0.75 }, cutKinds = ['wall', 'slab', 'roof', 'floor'] }) {
  const right = top ? { x: 1, y: 0 } : { x: -f.y, y: f.x };
  const items = [];
  const polys = [];
  for (const t of tris) {
    if (skipInner && t.inner && !clip) continue;
    if (t.kind === 'floor' && !clip) continue;
    if (t.kind === 'stair' && !clip) continue;
    if (top && t.kind !== 'roof') continue;
    // Facing: elevations show faces looking at the viewer.
    const facing = top ? t.n.z : -(t.n.x * f.x + t.n.y * f.y);
    if (cull && facing < -0.02 && t.kind !== 'opening' && t.kind !== 'leaf') continue;
    let pts = t.p;
    if (clip) {
      pts = clipHalf(pts, clip.a, clip.c);
      if (pts.length < 3) continue;
    }
    polys.push({ ...t, p: pts });
  }
  const fe = featureEdges(polys);
  const proj = (p) => (top ? { sx: p.x, sy: p.y, d: -p.z } : { sx: p.x * right.x + p.y * right.y, sy: -p.z, d: p.x * f.x + p.y * f.y });
  for (const t of polys) {
    const q = t.p.map(proj);
    const depth = q.reduce((a, b) => a + b.d, 0) / q.length - (BIAS[t.kind] || 0);
    items.push({ t, q, depth });
  }
  items.sort((a, b) => b.depth - a.depth); // far first
  const bounds = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  for (const it of items) for (const p of it.q) { bounds.x0 = Math.min(bounds.x0, p.sx); bounds.x1 = Math.max(bounds.x1, p.sx); bounds.y0 = Math.min(bounds.y0, p.sy); bounds.y1 = Math.max(bounds.y1, p.sy); }
  return { items, fe, bounds, right, proj };
}

/** Paint the sorted items through `T` (view mm to sheet). */
export function paintView(doc, r, T, { cutPlane = null } = {}) {
  for (const it of r.items) {
    const pts = it.q.map((p) => T(p.sx, p.sy));
    doc.setFillColor(...fillFor(it.t, { x: -0.4, y: -0.5, z: -0.75 }));
    doc.setDrawColor(...fillFor(it.t, { x: -0.4, y: -0.5, z: -0.75 }));
    doc.setLineWidth(0.05);
    polygon(doc, pts, 'FD');
    for (let i = 0; i < it.t.p.length; i++) {
      const a = it.t.p[i];
      const b = it.t.p[(i + 1) % it.t.p.length];
      const k = r.fe.keyOf(a, b);
      if (!r.fe.flagged.has(k)) continue;
      const onCut = cutPlane && Math.abs(a.x * cutPlane.a.x + a.y * cutPlane.a.y - cutPlane.c) < 2 && Math.abs(b.x * cutPlane.a.x + b.y * cutPlane.a.y - cutPlane.c) < 2;
      if (onCut) { doc.setLineWidth(0.55); doc.setDrawColor(...PEN.ink); }
      else { doc.setLineWidth(it.t.kind === 'opening' || it.t.kind === 'leaf' ? 0.1 : 0.16); doc.setDrawColor(...(it.t.kind === 'roof' ? [70, 74, 84] : PEN.ink)); }
      doc.line(pts[i].x, pts[i].y, pts[(i + 1) % pts.length].x, pts[(i + 1) % pts.length].y);
    }
  }
}

const SCALES = [20, 50, 100, 150, 200, 250, 500];
function fitScale(w, h, cellW, cellH, k) {
  return SCALES.find((n) => w / (n * k) <= cellW && h / (n * k) <= cellH) || 500;
}

/** Ground profile (view mm to the right, mm up from the ground floor) under the building: natural surface from the terrain grid. */
function groundProfile(project, spec, axes, view, unalign = null) {
  const lot = project.site?.lot;
  const floor = lot?.floorRL;
  const out = [];
  if (!axes) return out;
  const depth = (Math.abs(G.dot(spec.out, axes.long)) > 0.5 ? axes.lengthMm : axes.widthMm);
  const front = G.add(axes.centre, G.mul(spec.out, depth / 2 + 600));
  const span = (Math.abs(G.dot(spec.out, axes.long)) > 0.5 ? axes.widthMm : axes.lengthMm) / 2 + 3500;
  for (let i = -12; i <= 12; i++) {
    const s = (i / 12) * span;
    const p = G.add(front, G.mul(view.right, s));
    const q = unalign ? unalign(p) : p;
    const rl = lot?.terrain && floor != null ? terrainAt(lot.terrain, q.x, q.y) : null;
    out.push({ sx: p.x * view.right.x + p.y * view.right.y, z: rl != null ? (rl - floor) * 1000 : null });
  }
  return out;
}

/**
 * Draw four elevations in a 2x2 grid inside `area`. Returns { scale }.
 */
export function drawElevations(doc, ctx, tris, area) {
  const { project, k = 1 } = ctx;
  const specs = elevationSpecs(project);
  const axes = buildingAxes(project);
  const cw = (area.x1 - area.x0) / 2;
  const ch = (area.y1 - area.y0) / 2;
  const views = specs.map((s) => ({ s, r: renderView(doc, tris, { f: s.f }) }));
  let w = 0;
  let h = 0;
  for (const v of views) { w = Math.max(w, v.r.bounds.x1 - v.r.bounds.x0); h = Math.max(h, v.r.bounds.y1 - v.r.bounds.y0); }
  const n = fitScale(w + 6000, h + 3500, cw - 8, ch - 20, k);
  const ds = n * k;
  const lot = project.site?.lot;
  const floor = lot?.floorRL;
  views.forEach((v, i) => {
    const cx0 = area.x0 + (i % 2) * cw;
    const cy0 = area.y0 + Math.floor(i / 2) * ch;
    const midX = (v.r.bounds.x0 + v.r.bounds.x1) / 2;
    const baseY = cy0 + ch - 15; // sheet y of the ground floor level
    const T = (sx, sy) => ({ x: cx0 + cw / 2 + (sx - midX) / ds, y: baseY + sy / ds });
    // Cell frame
    doc.setDrawColor(...PEN.light);
    doc.setLineWidth(0.15);
    doc.rect(cx0 + 1, cy0 + 1, cw - 2, ch - 2);
    // Ground: natural surface (dashed) and the finished ground line at the slab edge
    const prof = groundProfile(project, v.s, axes, v.r, ctx.unalign);
    const gx0 = cx0 + 4;
    const gx1 = cx0 + cw - 4;
    doc.setDrawColor(...PEN.contourMajor);
    doc.setLineWidth(0.3);
    doc.setLineDashPattern([2.4, 1.2], 0);
    const pts = prof.filter((p) => p.z != null).map((p) => T(p.sx, -p.z));
    const clampX = (p) => ({ x: Math.min(gx1, Math.max(gx0, p.x)), y: p.y });
    if (pts.length > 1) for (let a = 0; a + 1 < pts.length; a++) doc.line(clampX(pts[a]).x, pts[a].y, clampX(pts[a + 1]).x, pts[a + 1].y);
    else doc.line(gx0, T(0, 150).y, gx1, T(0, 150).y);
    doc.setLineDashPattern([], 0);
    // Building
    paintView(doc, v.r, T);
    // Ground floor level mark and ridge height
    ink(doc, PEN.ink);
    const gy = T(0, 0).y;
    doc.setLineWidth(0.5);
    doc.setDrawColor(...PEN.ink);
    doc.line(T(v.r.bounds.x0 - 1500, 0).x, T(0, 150).y, T(v.r.bounds.x1 + 1500, 0).x, T(0, 150).y);
    const topZ = -v.r.bounds.y0;
    const xr = T(v.r.bounds.x1 + 1200, 0).x;
    doc.setLineWidth(0.13);
    doc.setDrawColor(...PEN.dim);
    doc.line(xr, T(0, 0).y, xr, T(0, -topZ).y);
    doc.line(xr - 1, T(0, 0).y, xr + 1, T(0, 0).y);
    doc.line(xr - 1, T(0, -topZ).y, xr + 1, T(0, -topZ).y);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(5.6);
    doc.setTextColor(...PEN.dim);
    doc.text(`${(topZ / 1000).toFixed(2)} m`, xr + 1.6, (T(0, 0).y + T(0, -topZ).y) / 2, { angle: 90 });
    // Levels
    const labelX = T(v.r.bounds.x0 - 1500, 0).x - 1;
    const levelsSorted = [...project.levels].sort((a, b) => a.elevation - b.elevation);
    doc.setFontSize(5.2);
    levelsSorted.forEach((lv, li) => {
      const yy = T(0, -lv.elevation).y;
      doc.setDrawColor(...PEN.dim);
      doc.setLineWidth(0.1);
      doc.setLineDashPattern([4, 1, 0.8, 1], 0);
      doc.line(labelX - 2, yy, T(v.r.bounds.x1 + 1200, 0).x, yy);
      doc.setLineDashPattern([], 0);
      const rl = floor != null ? ` RL ${(floor + lv.elevation / 1000).toFixed(2)}` : '';
      doc.setTextColor(...PEN.dim);
      doc.text(clean(`${li === 0 ? 'FFL' : `FFL ${lv.name}`}${rl}`), labelX - 2.5, yy - 0.8, { align: 'right' });
    });
    if (floor != null) {
      doc.setTextColor(...PEN.dim);
      doc.text(clean(`HIGH POINT RL ${(floor + topZ / 1000).toFixed(2)}`), xr + 1.6, T(0, -topZ).y - 0.6, { align: 'left' });
    }
    // Title
    const side = v.s.name;
    const turn = axes ? Math.abs(((axes.long.y !== undefined ? (Math.atan2(axes.long.y, axes.long.x) * 180) / Math.PI : 0) % 90)) : 0;
    void turn;
    viewTitle(doc, cx0 + 5, cy0 + ch - 4.5, `${side} elevation`, `1:${n} @ ${ctx.paper || 'A3'}`, { size: 8.5 });
  });
  return { n };
}

/** Section through the centre of the building across its short axis, looking along its long axis. */
export function drawSection(doc, ctx, tris, area) {
  const { project, k = 1 } = ctx;
  const axes = buildingAxes(project);
  const lot = project.site?.lot;
  const floor = lot?.floorRL;
  const a = axes ? axes.long : { x: 1, y: 0 }; // plane normal: cut perpendicular to the long axis
  const c = axes ? G.dot(axes.centre, a) : 0;
  const f = a; // look along +long axis: we keep the far half (dot >= c)
  const cut = { a, c };
  const r = renderView(doc, tris, { f, clip: cut, cull: false, skipInner: false });
  const w = r.bounds.x1 - r.bounds.x0;
  const h = r.bounds.y1 - r.bounds.y0;
  const aw = area.x1 - area.x0;
  const ah = area.y1 - area.y0;
  const n = fitScale(w + 7000, h + 3500, aw - 30, ah - 24, k);
  const ds = n * k;
  const midX = (r.bounds.x0 + r.bounds.x1) / 2;
  const baseY = area.y0 + 16 + (ah - 16 - 18) / 2 - ((r.bounds.y0 + r.bounds.y1) / 2) / ds;
  const T = (sx, sy) => ({ x: area.x0 + aw / 2 + (sx - midX) / ds, y: baseY + sy / ds });
  // Natural surface through the cut
  const spec = { out: { x: -a.x, y: -a.y } };
  const prof = axes ? groundProfile(project, { out: a }, axes, r, ctx.unalign) : [];
  const pts = prof.filter((p) => p.z != null).map((p) => T(p.sx, -p.z));
  doc.setDrawColor(...PEN.contourMajor);
  doc.setLineWidth(0.3);
  doc.setLineDashPattern([2.4, 1.2], 0);
  if (pts.length > 1) for (let i = 0; i + 1 < pts.length; i++) doc.line(pts[i].x, pts[i].y, pts[i + 1].x, pts[i + 1].y);
  doc.setLineDashPattern([], 0);
  void spec;
  paintView(doc, r, T, { cutPlane: cut });
  // Ground line, levels and heights
  ink(doc, PEN.ink);
  doc.setLineWidth(0.6);
  doc.line(T(r.bounds.x0 - 2500, 0).x, T(0, 150).y, T(r.bounds.x1 + 2500, 0).x, T(0, 150).y);
  const levelsSorted = [...project.levels].sort((q, p) => q.elevation - p.elevation);
  const xl = T(r.bounds.x0 - 2500, 0).x;
  const xr = T(r.bounds.x1 + 2500, 0).x;
  doc.setFontSize(5.8);
  levelsSorted.forEach((lv, li) => {
    const yy = T(0, -lv.elevation).y;
    doc.setDrawColor(...PEN.dim);
    doc.setLineWidth(0.12);
    doc.setLineDashPattern([4, 1, 0.8, 1], 0);
    doc.line(xl, yy, xr, yy);
    doc.setLineDashPattern([], 0);
    doc.setTextColor(...PEN.dim);
    doc.setFont('helvetica', 'normal');
    const rl = floor != null ? ` RL ${(floor + lv.elevation / 1000).toFixed(2)}` : '';
    doc.text(clean(`${li === 0 ? 'FFL GROUND' : `FFL ${lv.name}`}${rl}`), xl - 1, yy - 0.8, { align: 'right' });
    if (levelsSorted[li + 1]) {
      const up = T(0, -levelsSorted[li + 1].elevation).y;
      doc.setLineWidth(0.12);
      const dx = xr + 6 + li * 0;
      doc.line(dx, yy, dx, up);
      doc.line(dx - 1, yy, dx + 1, yy);
      doc.line(dx - 1, up, dx + 1, up);
      doc.text(`${((levelsSorted[li + 1].elevation - lv.elevation) / 1000).toFixed(2)} m`, dx + 1.8, (yy + up) / 2, { angle: 90 });
    }
  });
  const topZ = -r.bounds.y0;
  const hx = xr + 14;
  doc.setDrawColor(...PEN.dim);
  doc.line(hx, T(0, 0).y, hx, T(0, -topZ).y);
  doc.line(hx - 1, T(0, 0).y, hx + 1, T(0, 0).y);
  doc.line(hx - 1, T(0, -topZ).y, hx + 1, T(0, -topZ).y);
  doc.setTextColor(...PEN.dim);
  doc.text(`${(topZ / 1000).toFixed(2)} m overall`, hx + 1.8, (T(0, 0).y + T(0, -topZ).y) / 2, { angle: 90 });
  viewTitle(doc, area.x0 + 3, area.y0 + 6, 'Section A-A', `1:${n} @ ${ctx.paper || 'A3'}`);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6.2);
  doc.setTextColor(...PEN.grey);
  const from = compassOf({ x: -a.x, y: -a.y }, project.site?.northDeg || 0);
  doc.text(clean(`Cut across the centre of the house, looking ${from === 'NORTH' ? 'south' : from === 'SOUTH' ? 'north' : from === 'EAST' ? 'west' : 'east'}. Heavy lines are cut elements.`), area.x0 + 3, area.y0 + 11);
  scaleBar(doc, area.x0 + 6, area.y1 - 8, n, ds);
  return { n };
}

/** Roof plan from the roof mesh, in plan orientation, with falls and pitch notes. */
export function drawRoofPlan(doc, ctx, tris, area) {
  const { project, k = 1 } = ctx;
  const roofTris = tris.filter((t) => t.kind === 'roof');
  const aw = area.x1 - area.x0;
  const ah = area.y1 - area.y0;
  if (!roofTris.length) {
    viewTitle(doc, area.x0 + 3, area.y0 + 6, 'Roof plan', 'NTS');
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    ink(doc, PEN.grey);
    doc.text('No roof is modelled on this design.', area.x0 + aw / 2, area.y0 + ah / 2, { align: 'center' });
    return { n: null };
  }
  const r = renderView(doc, roofTris, { top: true, cull: true, skipInner: false });
  const w = r.bounds.x1 - r.bounds.x0;
  const h = r.bounds.y1 - r.bounds.y0;
  const n = fitScale(w + 4000, h + 4000, aw - 20, ah - 26, k);
  const ds = n * k;
  const T = (sx, sy) => ({ x: area.x0 + aw / 2 + (sx - (r.bounds.x0 + r.bounds.x1) / 2) / ds, y: area.y0 + 4 + (ah - 6) / 2 + (sy - (r.bounds.y0 + r.bounds.y1) / 2) / ds });
  // Walls under the roof, dashed
  const ground = [...project.levels].sort((a, b) => a.elevation - b.elevation);
  doc.setDrawColor(...PEN.grey);
  doc.setLineWidth(0.15);
  doc.setLineDashPattern([1.6, 1], 0);
  for (const lv of ground) for (const wl of lv.walls || []) {
    if (wl.kind !== 'exterior' || wl.status === 'demolish') continue;
    const pts = G.wallPolygon(wl).map((p) => T(p.x, p.y));
    for (let i = 0; i < pts.length; i++) doc.line(pts[i].x, pts[i].y, pts[(i + 1) % pts.length].x, pts[(i + 1) % pts.length].y);
  }
  doc.setLineDashPattern([], 0);
  // Roof surface (painted without the walls under it)
  const rr = r;
  for (const it of rr.items) {
    const pts = it.q.map((p) => T(p.sx, p.sy));
    doc.setFillColor(...fillFor(it.t, { x: -0.4, y: -0.5, z: -0.75 }));
    doc.setDrawColor(...fillFor(it.t, { x: -0.4, y: -0.5, z: -0.75 }));
    doc.setLineWidth(0.05);
    polygon(doc, pts, 'FD');
  }
  for (const it of rr.items) {
    const pts = it.q.map((p) => T(p.sx, p.sy));
    for (let i = 0; i < it.t.p.length; i++) {
      const a = it.t.p[i];
      const b = it.t.p[(i + 1) % it.t.p.length];
      if (!rr.fe.flagged.has(rr.fe.keyOf(a, b))) continue;
      doc.setLineWidth(0.22);
      doc.setDrawColor(...PEN.ink);
      doc.line(pts[i].x, pts[i].y, pts[(i + 1) % pts.length].x, pts[(i + 1) % pts.length].y);
    }
  }
  // Fall arrows, one per planar roof face of useful size
  const groups = roofFaces(roofTris);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(5.8);
  const pitch = project.levels.map((l) => l.roof?.pitch).filter((p) => p != null).at(-1);
  for (const g of groups) {
    if (g.areaM2 < 6) continue;
    const dir = G.norm({ x: g.n.x, y: g.n.y });
    if (G.len(dir) < 0.2) continue;
    const c = T(g.c.x, g.c.y);
    const a = { x: c.x - dir.x * 4, y: c.y - dir.y * 4 };
    const b = { x: c.x + dir.x * 4, y: c.y + dir.y * 4 };
    doc.setDrawColor(...PEN.dim);
    doc.setLineWidth(0.2);
    doc.line(a.x, a.y, b.x, b.y);
    const px = -dir.y;
    const py = dir.x;
    polygon(doc, [b, { x: b.x - dir.x * 1.8 + px * 0.9, y: b.y - dir.y * 1.8 + py * 0.9 }, { x: b.x - dir.x * 1.8 - px * 0.9, y: b.y - dir.y * 1.8 - py * 0.9 }], 'F');
    const slope = (Math.acos(Math.min(1, Math.abs(g.n.z))) * 180) / Math.PI;
    labelOn(doc, `${slope.toFixed(1)} deg`, c.x, c.y + 6, { size: 5.2, colour: PEN.dim });
  }
  const type = project.levels.map((l) => l.roof?.type).filter(Boolean).at(-1);
  const over = project.levels.map((l) => l.roof?.overhang).filter((v) => v != null).at(-1);
  viewTitle(doc, area.x0 + 3, area.y0 + 6, 'Roof plan', `1:${n} @ ${ctx.paper || 'A3'}`);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6.2);
  doc.setTextColor(...PEN.grey);
  const roofM2 = roofTris.reduce((s, t) => s + triArea(t.p), 0) / 1e6;
  doc.text(clean(`${type ? `${type} roof` : 'Roof'}${pitch ? `, ${pitch} degree pitch` : ''}${over != null ? `, ${over} mm eaves overhang` : ''}. Roof area from the model ${roofM2.toFixed(0)} m2. Arrows show the fall.`), area.x0 + 3, area.y0 + 11);
  scaleBar(doc, area.x0 + 6, area.y1 - 8, n, ds);
  return { n, roofM2 };
}

const triArea = (p) => {
  const u = { x: p[1].x - p[0].x, y: p[1].y - p[0].y, z: p[1].z - p[0].z };
  const v = { x: p[2].x - p[0].x, y: p[2].y - p[0].y, z: p[2].z - p[0].z };
  return 0.5 * Math.hypot(u.y * v.z - u.z * v.y, u.z * v.x - u.x * v.z, u.x * v.y - u.y * v.x);
};
export const roofAreaM2 = (tris) => tris.filter((t) => t.kind === 'roof').reduce((s, t) => s + triArea(t.p), 0) / 1e6;

// Group roof triangles into planar faces (connected, same normal).
function roofFaces(tris) {
  const parent = tris.map((_, i) => i);
  const find = (i) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  const edge = new Map();
  tris.forEach((t, i) => {
    for (let e = 0; e < 3; e++) {
      const a = key(t.p[e]);
      const b = key(t.p[(e + 1) % 3]);
      const k = a < b ? `${a}|${b}` : `${b}|${a}`;
      const j = edge.get(k);
      if (j == null) edge.set(k, i);
      else if (t.n.x * tris[j].n.x + t.n.y * tris[j].n.y + t.n.z * tris[j].n.z > 0.9995) parent[find(i)] = find(j);
    }
  });
  const g = new Map();
  tris.forEach((t, i) => {
    const r = find(i);
    const rec = g.get(r) || { areaM2: 0, cx: 0, cy: 0, n: t.n };
    const a = triArea(t.p) / 1e6;
    rec.areaM2 += a;
    rec.cx += (t.p[0].x + t.p[1].x + t.p[2].x) / 3 * a;
    rec.cy += (t.p[0].y + t.p[1].y + t.p[2].y) / 3 * a;
    g.set(r, rec);
  });
  return [...g.values()].map((r) => ({ areaM2: r.areaM2, n: r.n.z < 0 ? { x: -r.n.x, y: -r.n.y, z: -r.n.z } : r.n, c: { x: r.cx / r.areaM2, y: r.cy / r.areaM2 } }));
}
