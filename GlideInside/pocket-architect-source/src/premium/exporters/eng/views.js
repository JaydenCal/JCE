// Elevations, section and roof plan drawn from the same 3D model the viewer shows (buildModel), as line drawings: triangles are
// sorted far to near (painter's algorithm), filled in light tones, and only feature edges are stroked (outline, openings, creases),
// so coplanar triangulation never shows. The section is the model sliced by a vertical plane, with heavy cut lines.

import * as G from '../../../model/geometry.js';
import { terrainAt } from '../../../site/model.js';
import { buildingHull, orientedBox } from '../../../site/lotplan.js';
import { PEN, TXT, clean, ink, viewTitle, wrap, polygon, hatch, LabelField, haloText, alongLabel, vtext } from './kit.js';
import { scaleBar } from '../pdf.js';

const KINDS = [['wall', 'wall'], ['opening', 'opening'], ['leaf', 'leaf'], ['roof', 'roof'], ['slab', 'slab'], ['floor', 'floor'], ['stair', 'stair']];
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
    polys.push({ ...t, p: pts, src: t });
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

// Standard drawing scales for building views (printed 1:n on A3).
const SCALES = [20, 50, 100, 200, 250, 500];
const fitScale = (w, h, cellW, cellH, k) => SCALES.find((n) => w / (n * k) <= cellW && h / (n * k) <= cellH) || 500;

const cap = (t) => { const s = String(t ?? ''); return s ? s[0].toUpperCase() + s.slice(1) : s; };
/** Compass words such as "sw" are written in capitals ("SW"). */
export const compassWord = (t) => (/^[nsew]{1,3}$/i.test(String(t || '').trim()) ? String(t).trim().toUpperCase() : cap(t));

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

const rlText = (floor, z) => (floor != null ? ` RL ${(floor + z / 1000).toFixed(2)}` : '');

/** One source of truth for the building height: the highest point of the model above the ground floor level, plus the height above the lowest natural surface at the house corners. */
export function heightFacts(project, tris, unalign = null) {
  let topZ = 0;
  if (tris && tris.length) for (const sp of elevationSpecs(project)) topZ = Math.max(topZ, -renderView(null, tris, { f: sp.f }).bounds.y0);
  const lot = project.site?.lot;
  const floor = lot?.floorRL ?? null;
  const ax = buildingAxes(project);
  let nslMin = null;
  if (ax && lot?.terrain) {
    const { centre: c, u, v, w, d } = ax.box;
    for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      const q = { x: c.x + u.x * (w / 2) * a + v.x * (d / 2) * b, y: c.y + u.y * (w / 2) * a + v.y * (d / 2) * b };
      const uq = unalign ? unalign(q) : q;
      const rl = terrainAt(lot.terrain, uq.x, uq.y);
      if (rl != null && (nslMin == null || rl < nslMin)) nslMin = rl;
    }
  }
  const ridgeRL = floor != null ? floor + topZ / 1000 : null;
  return { topZ, floor, ridgeRL, nslMin, aboveNsl: ridgeRL != null && nslMin != null ? ridgeRL - nslMin : null };
}

// Elevations -------------------------------------------------------------------------------------------------------------------
const ELEV_MARGIN = { l: 17, r: 21, top: 10, bottom: 21 };

function elevationLayout(doc, project, tris, area, k) {
  const specs = elevationSpecs(project);
  const cw = (area.x1 - area.x0) / 2;
  const ch = (area.y1 - area.y0) / 2;
  const views = specs.map((s) => ({ s, r: renderView(doc, tris, { f: s.f }) }));
  let w = 0;
  let h = 0;
  for (const v of views) { w = Math.max(w, v.r.bounds.x1 - v.r.bounds.x0); h = Math.max(h, v.r.bounds.y1 - v.r.bounds.y0); }
  const n = fitScale(w, h + 900, cw - ELEV_MARGIN.l - ELEV_MARGIN.r - 2, ch - ELEV_MARGIN.top - ELEV_MARGIN.bottom, k);
  return { specs, views, cw, ch, n, ds: n * k };
}

export function elevationScale(doc, project, tris, area, k = 1) { return elevationLayout(doc, project, tris, area, k).n; }

/** Four elevations in a 2x2 grid filling `area`, at the smallest standard scale that fits. Returns { n }. */
export function drawElevations(doc, ctx, tris, area) {
  const { project, k = 1 } = ctx;
  const axes = buildingAxes(project);
  const { views, cw, ch, n, ds } = elevationLayout(doc, project, tris, area, k);
  const hf = heightFacts(project, tris, ctx.unalign);
  const lot = project.site?.lot;
  const floor = lot?.floorRL;
  const levels = [...project.levels].sort((a, b) => a.elevation - b.elevation);
  views.forEach((v, i) => {
    const cx0 = area.x0 + (i % 2) * cw;
    const cy0 = area.y0 + Math.floor(i / 2) * ch;
    const midX = (v.r.bounds.x0 + v.r.bounds.x1) / 2;
    const baseY = cy0 + ch - ELEV_MARGIN.bottom; // sheet y of the ground floor level
    const T = (sx, sy) => ({ x: cx0 + cw / 2 + (sx - midX) / ds, y: baseY + sy / ds });
    const gx0 = cx0 + 3;
    const gx1 = cx0 + cw - 3;
    doc.setDrawColor(...PEN.light);
    doc.setLineWidth(0.2);
    doc.rect(cx0 + 1, cy0 + 1, cw - 2, ch - 2);
    // Natural surface (dashed), clamped to the cell
    const prof = groundProfile(project, v.s, axes, v.r, ctx.unalign);
    doc.setDrawColor(...PEN.contourMajor);
    doc.setLineWidth(0.4);
    doc.setLineDashPattern([2.6, 1.4], 0);
    const pts = prof.filter((p) => p.z != null).map((p) => T(p.sx, -p.z));
    const cx = (x) => Math.min(gx1, Math.max(gx0, x));
    if (pts.length > 1) for (let a = 0; a + 1 < pts.length; a++) { const x1 = cx(pts[a].x); const x2 = cx(pts[a + 1].x); if (x2 > x1) doc.line(x1, pts[a].y, x2, pts[a + 1].y); }
    doc.setLineDashPattern([], 0);
    paintView(doc, v.r, T);
    // Ground floor line
    const xl = T(v.r.bounds.x0, 0).x;
    const xr = T(v.r.bounds.x1, 0).x;
    doc.setLineWidth(0.7);
    doc.setDrawColor(...PEN.ink);
    doc.line(Math.max(gx0, xl - 6), T(0, 150).y, Math.min(gx1, xr + 6), T(0, 150).y);
    // Levels at the left: a short dash-dot line from the building and "FFL 398.55" on it
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(TXT.small);
    levels.forEach((lv, li) => {
      const yy = T(0, -lv.elevation).y;
      doc.setDrawColor(...PEN.dim);
      doc.setLineWidth(0.15);
      doc.setLineDashPattern([4, 1, 0.8, 1], 0);
      doc.line(Math.max(gx0, xl - ELEV_MARGIN.l + 1), yy, xl + 2, yy);
      doc.setLineDashPattern([], 0);
      haloText(doc, `FFL${rlText(floor, lv.elevation)}`.replace('RL ', ''), xl - 1.2, yy - 1.4, { size: TXT.small, colour: PEN.dim, align: 'right', halo: 1.2 });
    });
    // Overall height at the right
    const topZ = hf.topZ || -v.r.bounds.y0;
    const dx = Math.min(gx1 - 12, xr + 4);
    doc.setDrawColor(...PEN.dim);
    doc.setLineWidth(0.15);
    doc.line(dx, T(0, 0).y, dx, T(0, -topZ).y);
    doc.setLineWidth(0.3);
    for (const z of [0, topZ]) doc.line(dx - 1.2, T(0, -z).y + 1.2 * (z ? 1 : -1) * 0, dx + 1.2, T(0, -z).y);
    doc.setLineWidth(0.15);
    doc.setFontSize(TXT.small);
    doc.setTextColor(...PEN.dim);
    vtext(doc, `${(topZ / 1000).toFixed(2)} m`, dx - 1.2, (T(0, 0).y + T(0, -topZ).y) / 2);
    if (floor != null) {
      doc.setLineDashPattern([4, 1, 0.8, 1], 0);
      doc.line(xr - 6, T(0, -topZ).y, dx + 3, T(0, -topZ).y);
      doc.setLineDashPattern([], 0);
      doc.text(clean(`RIDGE ${(floor + topZ / 1000).toFixed(2)}`), dx + 1.5, T(0, -topZ).y - 1.2);
    }
    viewTitle(doc, cx0 + 5, cy0 + ch - 5, `${cap(v.s.name.toLowerCase())} elevation`, `1:${n} @ ${ctx.paper || 'A3'}`, { size: TXT.head });
  });
  return { n };
}

// Section ----------------------------------------------------------------------------------------------------------------------
const SLAB_MM = { ground: 150, upper: 300 };

/** The section plane through the centre of the building across its short axis: { a (plane normal), c, right, axes }. */
export function sectionPlane(project) {
  const axes = buildingAxes(project);
  const a = axes ? axes.long : { x: 1, y: 0 };
  const c = axes ? G.dot(axes.centre, a) : 0;
  const right = { x: -a.y, y: a.x };
  return { a, c, right, axes };
}

// Intersection of a polygon with the line dot(p, a) = c: the sorted values of dot(p, right) where its boundary crosses.
function crossings(poly, pl) {
  const out = [];
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    const dp = G.dot(p, pl.a) - pl.c;
    const dq = G.dot(q, pl.a) - pl.c;
    if ((dp < 0) === (dq < 0)) continue;
    const t = dp / (dp - dq);
    out.push(G.dot(G.lerp(p, q, t), pl.right));
  }
  return out.sort((x, y) => x - y);
}

const mergeIntervals = (list) => {
  const s = [...list].sort((p, q) => p[0] - q[0]);
  const out = [];
  for (const iv of s) { if (out.length && iv[0] <= out[out.length - 1][1] + 1) out[out.length - 1][1] = Math.max(out[out.length - 1][1], iv[1]); else out.push([...iv]); }
  return out;
};

/** What the section plane cuts: wall pieces, slab and ceiling intervals and the roof profile, in (sx, z) millimetres. */
export function sectionCut(project, tris, pl) {
  const levels = [...project.levels].sort((p, q) => p.elevation - q.elevation);
  const walls = [];
  const slabs = [];
  const ceilings = [];
  levels.forEach((lv, li) => {
    const upper = levels[li + 1] || null;
    const upperRooms = (upper?.rooms || []).filter((r) => r.status !== 'demolish' && (!r.outdoor || r.roofed) && r.polygon?.length > 2);
    const inUpper = (p) => upperRooms.some((r) => G.pointInPolygon(p, r.polygon));
    const indoor = (lv.rooms || []).filter((r) => r.status !== 'demolish' && (!r.outdoor || r.roofed) && r.polygon?.length > 2);
    for (const wl of lv.walls || []) {
      if (wl.status === 'demolish') continue;
      const quad = G.wallPolygon(wl);
      const xs = crossings(quad, pl);
      if (xs.length < 2) continue;
      const dir = G.wallDir(wl);
      const dn = G.dot(dir, pl.a);
      if (Math.abs(dn) < 0.05) continue;
      const along = (pl.c - G.dot(wl.a, pl.a)) / dn;
      let H = wl.height ?? lv.height;
      if (wl.height == null && upper) {
        const target = upper.elevation - lv.elevation - SLAB_MM.upper;
        if (target > H + 1) {
          const m = G.wallMid(wl);
          const nn = G.wallNormal(wl);
          const off = (wl.thickness || 100) / 2 + 150;
          if ([0, off, -off].some((o) => inUpper({ x: m.x + nn.x * o, y: m.y + nn.y * o }))) H = target;
        }
      }
      const z0 = lv.elevation;
      const z1 = lv.elevation + H;
      const s0 = xs[0];
      const s1 = xs[xs.length - 1];
      let pieces = [[z0, z1]];
      for (const o of (lv.openings || []).filter((q) => q.wallId === wl.id && q.status !== 'demolish')) {
        if (Math.abs(along - o.offset) > o.width / 2) continue;
        const sill = o.kind === 'window' ? (o.sill ?? 900) : 0;
        const head = sill + (o.height || 2040);
        pieces = pieces.flatMap(([p, q]) => {
          const out = [];
          if (z0 + sill > p) out.push([p, Math.min(q, z0 + sill)]);
          if (z0 + head < q) out.push([Math.max(p, z0 + head), q]);
          return out;
        });
      }
      for (const [p, q] of pieces) if (q - p > 5) walls.push({ s0, s1, z0: p, z1: q, exterior: wl.kind === 'exterior' });
    }
    const spans = [];
    for (const r of indoor) {
      const xs = crossings(r.polygon, pl);
      for (let i = 0; i + 1 < xs.length; i += 2) spans.push([xs[i], xs[i + 1]]);
    }
    for (const [a, b] of mergeIntervals(spans)) {
      slabs.push({ s0: a, s1: b, z1: lv.elevation, z0: lv.elevation - (li === 0 ? SLAB_MM.ground : SLAB_MM.upper), level: li });
      ceilings.push({ s0: a, s1: b, z: lv.elevation + lv.height, level: li });
    }
  });
  // Roof profile: the upward faces of the roof mesh sliced by the plane.
  const segs = [];
  for (const t of tris) {
    if (t.kind !== 'roof' || t.n.z < 0.05) continue;
    const pts = [];
    for (let i = 0; i < 3; i++) {
      const p = t.p[i];
      const q = t.p[(i + 1) % 3];
      const dp = G.dot(p, pl.a) - pl.c;
      const dq = G.dot(q, pl.a) - pl.c;
      if ((dp < 0) === (dq < 0)) continue;
      const u = dp / (dp - dq);
      pts.push({ sx: G.dot({ x: p.x + (q.x - p.x) * u, y: p.y + (q.y - p.y) * u }, pl.right), z: p.z + (q.z - p.z) * u });
    }
    if (pts.length === 2 && Math.abs(pts[0].sx - pts[1].sx) > 1) segs.push(pts);
  }
  return { walls, slabs, ceilings, roof: segs };
}

export function sectionScale(project, tris, area, k = 1) {
  const pl = sectionPlane(project);
  const r = renderView(null, tris, { f: pl.a, clip: { a: pl.a, c: pl.c }, cull: false, skipInner: false });
  return fitScale(r.bounds.x1 - r.bounds.x0, r.bounds.y1 - r.bounds.y0 + 600, area.x1 - area.x0 - 78, area.y1 - area.y0 - 44, k);
}

/** Section A-A through the house: cut walls hatched, slabs solid, floor and ceiling levels, roof pitch and the heights dimensioned. */
export function drawSection(doc, ctx, tris, area) {
  const { project, k = 1 } = ctx;
  const lot = project.site?.lot;
  const floor = lot?.floorRL;
  const pl = sectionPlane(project);
  const cut = sectionCut(project, tris, pl);
  const r = renderView(doc, tris, { f: pl.a, clip: { a: pl.a, c: pl.c }, cull: false, skipInner: false });
  const w = r.bounds.x1 - r.bounds.x0;
  const h = r.bounds.y1 - r.bounds.y0;
  const aw = area.x1 - area.x0;
  const ah = area.y1 - area.y0;
  const n = sectionScale(project, tris, area, k);
  const ds = n * k;
  const midX = (r.bounds.x0 + r.bounds.x1) / 2;
  const baseY = area.y1 - 26 - Math.max(0, r.bounds.y1) / ds; // sheet y of the ground floor level
  const T = (sx, sy) => ({ x: area.x0 + aw / 2 + (sx - midX) / ds, y: baseY + sy / ds });
  const P = (sx, z) => T(sx, -z);
  const levels = [...project.levels].sort((q, p) => q.elevation - p.elevation);
  const xl = P(r.bounds.x0, 0).x;
  const xr = P(r.bounds.x1, 0).x;

  // Natural surface through the cut
  const prof = pl.axes ? groundProfile(project, { out: pl.a }, pl.axes, r, ctx.unalign) : [];
  const gpts = prof.filter((p) => p.z != null).map((p) => T(p.sx, -p.z));
  // The beyond: the far half of the house in light tone
  paintView(doc, r, T);
  doc.setDrawColor(...PEN.contourMajor);
  doc.setLineWidth(0.45);
  doc.setLineDashPattern([2.6, 1.4], 0);
  const gx0 = area.x0 + 2;
  const gx1 = area.x1 - 2;
  if (gpts.length > 1) {
    for (let i = 0; i + 1 < gpts.length; i++) {
      let a = gpts[i];
      let b = gpts[i + 1];
      if (b.x === a.x || (a.x < gx0 && b.x < gx0) || (a.x > gx1 && b.x > gx1)) continue;
      const at = (x) => ({ x, y: a.y + ((x - a.x) / (b.x - a.x)) * (b.y - a.y) });
      if (a.x < gx0) a = at(gx0);
      if (b.x > gx1) b = at(gx1);
      doc.line(a.x, a.y, b.x, b.y);
    }
  }
  doc.setLineDashPattern([], 0);

  // Cut slabs: solid
  doc.setLineWidth(0.5);
  ink(doc, PEN.ink);
  for (const s of cut.slabs) {
    const a = P(s.s0, s.z1);
    const b = P(s.s1, s.z0);
    doc.setFillColor(...PEN.ink);
    doc.rect(a.x, a.y, b.x - a.x, b.y - a.y, 'FD');
  }
  // Cut walls: poche (hatched) with a heavy outline
  for (const wl of cut.walls) {
    const a = P(wl.s0, wl.z1);
    const b = P(wl.s1, wl.z0);
    const poly = [{ x: a.x, y: a.y }, { x: b.x, y: a.y }, { x: b.x, y: b.y }, { x: a.x, y: b.y }];
    doc.setFillColor(255, 255, 255);
    polygon(doc, poly, 'F');
    hatch(doc, poly, 'poche');
    doc.setDrawColor(...PEN.ink);
    doc.setLineWidth(0.55);
    polygon(doc, poly, 'S');
  }
  // Ceilings: a fine line under the roof or upper slab
  doc.setDrawColor(...PEN.dim);
  doc.setLineWidth(0.3);
  for (const c of cut.ceilings) { const a = P(c.s0, c.z); const b = P(c.s1, c.z); doc.line(a.x, a.y, b.x, b.y); }
  // Roof profile: the sliced upward faces as a heavy line with the rafter depth below it
  const rd = 140;
  doc.setDrawColor(...PEN.ink);
  for (const sg of cut.roof) {
    const a = P(sg[0].sx, sg[0].z);
    const b = P(sg[1].sx, sg[1].z);
    const a2 = P(sg[0].sx, sg[0].z - rd);
    const b2 = P(sg[1].sx, sg[1].z - rd);
    doc.setFillColor(60, 62, 68);
    polygon(doc, [a, b, b2, a2], 'F');
    doc.setLineWidth(0.5);
    doc.line(a.x, a.y, b.x, b.y);
  }
  // Heavy ground line
  doc.setLineWidth(0.9);
  doc.line(Math.max(area.x0 + 4, xl - 14), P(0, 0).y + 0.1, Math.min(area.x1 - 4, xr + 14), P(0, 0).y + 0.1);

  // Levels at the left: floor and ceiling of each storey, the ridge, with RLs
  const topZ = -r.bounds.y0;
  const hfs = heightFacts(project, tris, ctx.unalign);
  const marks = [];
  levels.forEach((lv, li) => {
    marks.push({ z: lv.elevation, text: `${li === 0 ? 'FFL GROUND' : 'FFL FIRST'}${rlText(floor, lv.elevation)}` });
    marks.push({ z: lv.elevation + lv.height, text: `CEILING${rlText(floor, lv.elevation + lv.height)}`, ceil: true });
  });
  marks.push({ z: topZ, text: `RIDGE${rlText(floor, topZ)}` });
  const lx = Math.max(area.x0 + 42, xl - 6);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(TXT.body);
  let lastY = Infinity;
  marks.sort((q, p) => q.z - p.z).forEach((m) => {
    const y = P(0, m.z).y;
    doc.setDrawColor(...PEN.dim);
    doc.setLineWidth(0.15);
    doc.setLineDashPattern([4, 1, 0.8, 1], 0);
    doc.line(lx - 40, y, lx, y);
    doc.setLineDashPattern([], 0);
    doc.setTextColor(...PEN.dim);
    const ty = lastY - y < 3.6 ? y + 3.6 : y - 1.2; // a label that would touch the one above goes under its line
    doc.text(clean(m.text), lx - 1, ty, { align: 'right' });
    lastY = Math.min(lastY, y);
  });

  // Vertical dimension chains at the right: storey heights, then the overall height
  const zs = [0, ...levels.slice(1).map((l) => l.elevation), ...(levels.length ? [levels.at(-1).elevation + levels.at(-1).height] : []), topZ];
  const uniq = [...new Set(zs.map((z) => Math.round(z)))].sort((q, p) => q - p);
  const dx1 = Math.min(area.x1 - 26, xr + 8);
  const dx2 = dx1 + 13;
  const vdim = (x, za, zb, text) => {
    const ya = P(0, za).y;
    const yb = P(0, zb).y;
    doc.setDrawColor(...PEN.dim);
    doc.setLineWidth(0.15);
    doc.line(x, ya, x, yb);
    doc.setLineWidth(0.3);
    doc.line(x - 1.4, ya + 1.4, x + 1.4, ya - 1.4);
    doc.line(x - 1.4, yb + 1.4, x + 1.4, yb - 1.4);
    doc.setLineWidth(0.15);
    doc.line(x - 3, ya, x + 1.4, ya);
    doc.line(x - 3, yb, x + 1.4, yb);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(TXT.body);
    doc.setTextColor(...PEN.dim);
    if (Math.abs(ya - yb) > 14) vtext(doc, text, x - 1.6, (ya + yb) / 2);
    else doc.text(text, x + 2.4, (ya + yb) / 2 + 1);
  };
  for (let i = 0; i + 1 < uniq.length; i++) vdim(dx1, uniq[i], uniq[i + 1], `${((uniq[i + 1] - uniq[i]) / 1000).toFixed(2)}`);
  vdim(dx2, 0, topZ, `${(topZ / 1000).toFixed(2)} m ABOVE FFL`);
  if (hfs.aboveNsl != null) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(TXT.small);
    doc.setTextColor(...PEN.dim);
    doc.text(`Max height above natural surface ${hfs.aboveNsl.toFixed(1)} m (lowest house corner)`, Math.min(area.x1 - 4, dx2 + 4), P(0, topZ).y - 6, { align: 'right' });
  }

  // Roof pitch: the slope triangle on the steepest cut roof segment, labelled in degrees
  const best = cut.roof.filter((sg) => Math.abs(sg[1].sx - sg[0].sx) > 800).sort((q, p) => Math.max(p[0].z, p[1].z) - Math.max(q[0].z, q[1].z))[0];
  const pitchDeg = project.levels.map((l) => l.roof?.pitch).filter((v) => v != null).at(-1);
  if (best) {
    const v = { x: P(best[1].sx, best[1].z).x - P(best[0].sx, best[0].z).x, y: P(best[1].sx, best[1].z).y - P(best[0].sx, best[0].z).y };
    const ang = (Math.atan2(Math.abs(best[1].z - best[0].z), Math.abs(best[1].sx - best[0].sx)) * 180) / Math.PI;
    const lo = best[0].z <= best[1].z ? best[0] : best[1];
    const M = { x: P(lo.sx, lo.z).x + v.x * (best[0].z <= best[1].z ? 0.38 : -0.38), y: P(lo.sx, lo.z).y + v.y * (best[0].z <= best[1].z ? 0.38 : -0.38) };
    const lab = alongLabel(doc, `ROOF PITCH ${(pitchDeg ?? ang).toFixed(1)}°`, M, v, 3.4, { size: TXT.label, bold: true, colour: PEN.dim, halo: 0.9 });
    lab.draw();
  }

  // Overall width below the ground line, and the natural surface label
  const wallsS = cut.walls.filter((q) => q.exterior);
  if (wallsS.length) {
    const s0 = Math.min(...wallsS.map((q) => q.s0));
    const s1 = Math.max(...wallsS.map((q) => q.s1));
    const y = P(0, 0).y + 12;
    doc.setDrawColor(...PEN.dim);
    doc.setLineWidth(0.15);
    doc.line(P(s0, 0).x, y, P(s1, 0).x, y);
    doc.line(P(s0, 0).x, P(0, 0).y + 3, P(s0, 0).x, y + 2);
    doc.line(P(s1, 0).x, P(0, 0).y + 3, P(s1, 0).x, y + 2);
    doc.setLineWidth(0.3);
    for (const s of [s0, s1]) doc.line(P(s, 0).x - 1.4, y + 1.4, P(s, 0).x + 1.4, y - 1.4);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(TXT.body);
    doc.setTextColor(...PEN.dim);
    haloText(doc, `${Math.round(s1 - s0)}`, (P(s0, 0).x + P(s1, 0).x) / 2, y - 1.4, { size: TXT.body, colour: PEN.dim, align: 'center', halo: 1.8 });
  }
  if (gpts.length > 1) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(TXT.small);
    doc.setTextColor(...PEN.contourMajor);
    const g = gpts[gpts.length - 2];
    doc.text('NATURAL SURFACE', Math.min(area.x1 - 4, g.x), g.y + 4.4, { align: 'right' });
  }

  viewTitle(doc, area.x0 + 3, area.y0 + 8.4, 'Section A-A', `1:${n} @ ${ctx.paper || 'A3'}`, { size: TXT.title });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(TXT.body);
  doc.setTextColor(...PEN.grey);
  const from = compassOf({ x: -pl.a.x, y: -pl.a.y }, project.site?.northDeg || 0);
  doc.text(clean(`Cut across the centre of the house, looking ${from === 'NORTH' ? 'south' : from === 'SOUTH' ? 'north' : from === 'EAST' ? 'west' : 'east'}. Cut walls are hatched, slabs solid. The section line is marked on the floor plans.`), area.x0 + 3, area.y0 + 15);
  scaleBar(doc, area.x0 + 6, area.y1 - 9, n, ds);
  return { n };
}

/**
 * The section line on a floor plan: chain line across the house at the section plane with an arrow at each end looking the way the
 * section looks, and a circle tag "A" at each end. `T` maps plan mm to sheet mm for that sheet.
 */
/** The section line in plan millimetres: { p0, p1, right }, or null. */
export function sectionLinePlan(project, halfMm = null) {
  const pl = sectionPlane(project);
  if (!pl.axes) return null;
  const e0 = halfMm?.neg ?? pl.axes.widthMm / 2 + 1750;
  const e1 = halfMm?.pos ?? pl.axes.widthMm / 2 + 1750;
  const mid = pl.axes.centre;
  return { p0: { x: mid.x - pl.right.x * e0, y: mid.y - pl.right.y * e0 }, p1: { x: mid.x + pl.right.x * e1, y: mid.y + pl.right.y * e1 }, right: pl.right };
}

export function drawSectionMarker(doc, project, T, sheetNo = null, halfMm = null) {
  const pl = sectionPlane(project);
  if (!pl.axes) return;
  const e0 = halfMm?.neg ?? pl.axes.widthMm / 2 + 1750;
  const e1 = halfMm?.pos ?? pl.axes.widthMm / 2 + 1750;
  const mid = pl.axes.centre;
  const p0 = { x: mid.x - pl.right.x * e0, y: mid.y - pl.right.y * e0 };
  const p1 = { x: mid.x + pl.right.x * e1, y: mid.y + pl.right.y * e1 };
  // Put the line on the plane (centre is on it already). Heads point along +a, the looking direction.
  const A = T(p0);
  const B = T(p1);
  const look = G.norm(G.sub(T({ x: mid.x + pl.a.x, y: mid.y + pl.a.y }), T(mid)));
  doc.setDrawColor(...PEN.tag);
  doc.setLineWidth(0.5);
  doc.setLineDashPattern([9, 1.8, 1.8, 1.8], 0);
  doc.line(A.x, A.y, B.x, B.y);
  doc.setLineDashPattern([], 0);
  doc.setFillColor(...PEN.tag);
  doc.setFont('helvetica', 'bold');
  for (const E of [A, B]) {
    const tip = { x: E.x + look.x * 7, y: E.y + look.y * 7 };
    doc.setLineWidth(0.7);
    doc.line(E.x, E.y, tip.x, tip.y);
    const px = -look.y;
    const py = look.x;
    polygon(doc, [{ x: tip.x + look.x * 2.4, y: tip.y + look.y * 2.4 }, { x: tip.x + px * 1.6, y: tip.y + py * 1.6 }, { x: tip.x - px * 1.6, y: tip.y - py * 1.6 }], 'F');
    const out = G.norm(G.sub(E, T(mid)));
    const c = { x: E.x + out.x * 5.4, y: E.y + out.y * 5.4 };
    doc.setFillColor(255, 255, 255);
    doc.setLineWidth(0.4);
    doc.circle(c.x, c.y, 3.6, 'FD');
    doc.setFontSize(TXT.strong);
    doc.setTextColor(...PEN.tag);
    doc.text('A', c.x, c.y + 1.4, { align: 'center' });
    doc.setFillColor(...PEN.tag);
  }
  if (sheetNo) {
    const E = A.x >= B.x ? A : B;
    const out = G.norm(G.sub(E, T(mid)));
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(TXT.small);
    doc.setTextColor(...PEN.tag);
    doc.text('SECTION A-A', E.x + out.x * 11, E.y + out.y * 11 - 1, { align: out.x >= 0 ? 'left' : 'right' });
    doc.setFont('helvetica', 'normal');
    doc.text(`SEE SHEET ${sheetNo}`, E.x + out.x * 11, E.y + out.y * 11 + 2.6, { align: out.x >= 0 ? 'left' : 'right' });
  }
}

// Roof plan ----------------------------------------------------------------------------------------------------------------------
const ROOF_PANEL_W = 104;

// Connected groups of roof triangles (by shared edges), each with its highest point, so a roof is painted whole before the next.
function roofGroups(tris) {
  const parent = tris.map((_, i) => i);
  const find = (i) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  const edge = new Map();
  tris.forEach((t, i) => {
    for (let e = 0; e < 3; e++) {
      const a = key(t.p[e]);
      const b = key(t.p[(e + 1) % 3]);
      const kk = a < b ? `${a}|${b}` : `${b}|${a}`;
      const j = edge.get(kk);
      if (j == null) edge.set(kk, i); else parent[find(i)] = find(j);
    }
  });
  const groups = new Map();
  tris.forEach((t, i) => {
    const g = groups.get(find(i)) || { idx: [], top: -Infinity };
    g.idx.push(i);
    g.top = Math.max(g.top, ...t.p.map((p) => p.z));
    groups.set(find(i), g);
  });
  return [...groups.values()].sort((a, b) => a.top - b.top);
}

export function roofScale(tris, area, k = 1) {
  const roofTris = tris.filter((t) => t.kind === 'roof');
  if (!roofTris.length) return null;
  const r = renderView(null, roofTris, { top: true, cull: true, skipInner: false });
  const w = r.bounds.x1 - r.bounds.x0;
  const h = r.bounds.y1 - r.bounds.y0;
  return fitScale(w + 1800, h + 1800, area.x1 - area.x0 - ROOF_PANEL_W - 22, area.y1 - area.y0 - 22, k);
}

/** Roof plan from the roof mesh: each roof painted whole, higher roofs over lower, falls and pitch, dimensions, and a notes panel. */
export function drawRoofPlan(doc, ctx, tris, area) {
  const { project, k = 1 } = ctx;
  const roofTris = tris.filter((t) => t.kind === 'roof');
  const aw = area.x1 - area.x0;
  const ah = area.y1 - area.y0;
  if (!roofTris.length) {
    viewTitle(doc, area.x0 + 3, area.y0 + 8.4, 'Roof plan', 'NTS', { size: TXT.title });
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(TXT.label);
    ink(doc, PEN.grey);
    doc.text('No roof is modelled on this design.', area.x0 + aw / 2, area.y0 + ah / 2, { align: 'center' });
    return { n: null };
  }
  const r = renderView(doc, roofTris, { top: true, cull: true, skipInner: false });
  const n = roofScale(tris, area, k);
  const ds = n * k;
  const dw = aw - ROOF_PANEL_W - 6;
  const T = (sx, sy) => ({ x: area.x0 + dw / 2 + (sx - (r.bounds.x0 + r.bounds.x1) / 2) / ds, y: area.y0 + 10 + (ah - 10) / 2 + (sy - (r.bounds.y0 + r.bounds.y1) / 2) / ds });
  // Roofs, lowest first; every triangle is filled and its own feature edges stroked at once, so a higher roof hides the outline of a
  // lower one and no outline shows through another roof
  const groups = roofGroups(roofTris);
  const order = new Map(r.items.map((it, i) => [it.t.src, i]));
  for (const g of groups) {
    const items = g.idx.map((i) => r.items[order.get(roofTris[i])]).filter(Boolean).sort((p, q) => order.get(p.t.src) - order.get(q.t.src));
    for (const it of items) {
      const pts = it.q.map((p) => T(p.sx, p.sy));
      doc.setFillColor(...fillFor(it.t, { x: -0.4, y: -0.5, z: -0.75 }));
      doc.setDrawColor(...fillFor(it.t, { x: -0.4, y: -0.5, z: -0.75 }));
      doc.setLineWidth(0.08);
      polygon(doc, pts, 'FD');
      doc.setDrawColor(...PEN.ink);
      doc.setLineWidth(0.3);
      for (let i = 0; i < it.t.p.length; i++) {
        if (!r.fe.flagged.has(r.fe.keyOf(it.t.p[i], it.t.p[(i + 1) % it.t.p.length]))) continue;
        doc.line(pts[i].x, pts[i].y, pts[(i + 1) % pts.length].x, pts[(i + 1) % pts.length].y);
      }
    }
  }
  // Walls under the roof, dashed
  doc.setDrawColor(...PEN.grey);
  doc.setLineWidth(0.18);
  doc.setLineDashPattern([1.8, 1.2], 0);
  for (const lv of project.levels) for (const wl of lv.walls || []) {
    if (wl.kind !== 'exterior' || wl.status === 'demolish') continue;
    const pts = G.wallPolygon(wl).map((p) => T(p.x, p.y));
    for (let i = 0; i < pts.length; i++) doc.line(pts[i].x, pts[i].y, pts[(i + 1) % pts.length].x, pts[(i + 1) % pts.length].y);
  }
  doc.setLineDashPattern([], 0);

  // Fall arrows (one per planar face of useful size) with the pitch written beside each, clear of the other labels
  const faces = roofFaces(roofTris);
  const pitch = project.levels.map((l) => l.roof?.pitch).filter((p) => p != null).at(-1);
  const field = new LabelField({ x0: area.x0, y0: area.y0, x1: area.x0 + dw, y1: area.y1 });
  const arrows = [];
  for (const g of faces.filter((f) => f.areaM2 >= 6)) {
    const dir = G.norm({ x: g.n.x, y: g.n.y });
    if (G.len(dir) < 0.2) continue;
    arrows.push({ g, dir, c: T(g.c.x, g.c.y) });
  }
  arrows.sort((a, b) => b.g.areaM2 - a.g.areaM2);
  for (const A of arrows) {
    const len = Math.min(9, Math.max(5, Math.sqrt(A.g.areaM2) * 1.4 / (ds / 100)));
    const a = { x: A.c.x - A.dir.x * len, y: A.c.y - A.dir.y * len };
    const b = { x: A.c.x + A.dir.x * len, y: A.c.y + A.dir.y * len };
    doc.setDrawColor(...PEN.dim);
    doc.setLineWidth(0.3);
    doc.line(a.x, a.y, b.x, b.y);
    const px = -A.dir.y;
    const py = A.dir.x;
    doc.setFillColor(...PEN.dim);
    polygon(doc, [{ x: b.x + A.dir.x * 2.6, y: b.y + A.dir.y * 2.6 }, { x: b.x + px * 1.5, y: b.y + py * 1.5 }, { x: b.x - px * 1.5, y: b.y - py * 1.5 }], 'F');
    field.addSeg(a, b);
    const slope = (Math.acos(Math.min(1, Math.abs(A.g.n.z))) * 180) / Math.PI;
    const txt = `${slope.toFixed(1)}°`;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(TXT.body);
    const tw = doc.getTextWidth(txt) + 2;
    // beside the arrow shaft, then either end
    let done = false;
    for (const [ox, oy] of [[px * (tw / 2 + 2), py * 4.5], [-px * (tw / 2 + 2), -py * 4.5], [px * (tw / 2 + 2), py * 9], [-px * (tw / 2 + 2), -py * 9]]) {
      const c0 = { x: A.c.x + ox, y: A.c.y + oy };
      const box = { x0: c0.x - tw / 2, y0: c0.y - 3.4, x1: c0.x + tw / 2, y1: c0.y + 1.6 };
      if (!field.free(box, { lines: true })) continue;
      field.addBox(box);
      haloText(doc, txt, c0.x, c0.y, { size: TXT.body, bold: true, colour: PEN.dim, align: 'center', halo: 0.9 });
      done = true;
      break;
    }
    void done;
  }

  // Overall dimensions of the eaves outline
  const bx0 = T(r.bounds.x0, 0).x;
  const bx1 = T(r.bounds.x1, 0).x;
  const by0 = T(0, r.bounds.y0).y;
  const by1 = T(0, r.bounds.y1).y;
  doc.setDrawColor(...PEN.dim);
  doc.setLineWidth(0.15);
  const ty = by1 + 7;
  doc.line(bx0, ty, bx1, ty);
  doc.line(bx0, by1 + 1, bx0, ty + 2);
  doc.line(bx1, by1 + 1, bx1, ty + 2);
  doc.setLineWidth(0.3);
  for (const x of [bx0, bx1]) doc.line(x - 1.4, ty + 1.4, x + 1.4, ty - 1.4);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(TXT.body);
  doc.setTextColor(...PEN.dim);
  doc.text(`${Math.round(r.bounds.x1 - r.bounds.x0)}`, (bx0 + bx1) / 2, ty - 1.4, { align: 'center' });
  const tx = bx1 + 7;
  doc.setLineWidth(0.15);
  doc.line(tx, by0, tx, by1);
  doc.line(bx1 + 1, by0, tx + 2, by0);
  doc.line(bx1 + 1, by1, tx + 2, by1);
  doc.setLineWidth(0.3);
  for (const y of [by0, by1]) doc.line(tx - 1.4, y + 1.4, tx + 1.4, y - 1.4);
  vtext(doc, `${Math.round(r.bounds.y1 - r.bounds.y0)}`, tx - 1.6, (by0 + by1) / 2);

  viewTitle(doc, area.x0 + 3, area.y0 + 8.4, 'Roof plan', `1:${n} @ ${ctx.paper || 'A3'}`, { size: TXT.title });
  scaleBar(doc, area.x0 + 6, area.y1 - 9, n, ds);

  // Notes panel
  const px0 = area.x1 - ROOF_PANEL_W;
  const type = project.levels.map((l) => l.roof?.type).filter(Boolean).at(-1);
  const over = project.levels.map((l) => l.roof?.overhang).filter((v) => v != null).at(-1);
  const roofM2 = roofTris.reduce((s, t) => s + triArea(t.p), 0) / 1e6;
  const mat = project.levels.map((l) => l.roof?.material).filter(Boolean).at(-1);
  const hfr = heightFacts(project, tris, ctx.unalign);
  const topZ = hfr.topZ;
  const floor = project.site?.lot?.floorRL;
  doc.setLineWidth(0.5);
  ink(doc, PEN.ink);
  doc.rect(px0, area.y0, ROOF_PANEL_W, ah);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(TXT.label);
  doc.text('ROOF DATA', px0 + 3, area.y0 + 7);
  const rows = [
    ['Roof form', type ? `${cap(type)} roof` : 'Not stated'],
    ['Pitch', pitch != null ? `${Number(pitch).toFixed(1)}°` : 'Not stated'],
    ['Eaves overhang', over != null ? `${over} mm` : 'Not stated'],
    ['Roof area (sloped)', `${roofM2.toFixed(0)} m²`],
    ['Roof sheeting', mat ? cap(String(mat)) : 'Not stated'],
    ['Highest point', `${(topZ / 1000).toFixed(2)} m above FFL${floor != null ? `, RL ${(floor + topZ / 1000).toFixed(2)}` : ''}`],
    ...(hfr.aboveNsl != null ? [['Above natural surface', `${hfr.aboveNsl.toFixed(1)} m at the lowest house corner`]] : []),
  ];
  let y = area.y0 + 13;
  doc.setFontSize(TXT.body);
  for (const [a, b] of rows) {
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...PEN.grey);
    doc.text(a, px0 + 3, y);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...PEN.ink);
    const lines = wrap(doc, b, ROOF_PANEL_W - 46);
    lines.forEach((l, i) => doc.text(l, px0 + 42, y + i * 3.6));
    y += Math.max(1, lines.length) * 3.6 + 2.6;
  }
  y += 3;
  doc.setDrawColor(...PEN.light);
  doc.setLineWidth(0.2);
  doc.line(px0 + 3, y - 4, px0 + ROOF_PANEL_W - 3, y - 4);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(TXT.label);
  doc.setTextColor(...PEN.ink);
  doc.text('LEGEND', px0 + 3, y + 2);
  y += 8;
  const sample = (label, fn) => { fn(px0 + 4, y); doc.setFont('helvetica', 'normal'); doc.setFontSize(TXT.body); doc.setTextColor(...PEN.ink); doc.text(label, px0 + 22, y + 1); y += 6.4; };
  sample('Ridge, hip and valley', (x, yy) => { doc.setDrawColor(...PEN.ink); doc.setLineWidth(0.3); doc.line(x, yy, x + 14, yy); });
  sample('Direction of fall, with pitch', (x, yy) => { doc.setDrawColor(...PEN.dim); doc.setLineWidth(0.3); doc.line(x, yy, x + 11, yy); doc.setFillColor(...PEN.dim); polygon(doc, [{ x: x + 14, y: yy }, { x: x + 11, y: yy - 1.5 }, { x: x + 11, y: yy + 1.5 }], 'F'); });
  sample('Exterior walls below', (x, yy) => { doc.setDrawColor(...PEN.grey); doc.setLineWidth(0.18); doc.setLineDashPattern([1.8, 1.2], 0); doc.line(x, yy, x + 14, yy); doc.setLineDashPattern([], 0); });
  y += 2;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(TXT.min);
  doc.setTextColor(...PEN.grey);
  wrap(doc, 'Roof geometry is taken from the same model as the 3D view. Sheeting, gutters, downpipes, battens and roof framing are not designed here and are to be confirmed by the builder and a structural engineer. Dimensions are in millimetres.', ROOF_PANEL_W - 8).forEach((l, i) => doc.text(l, px0 + 4, y + i * 2.9));
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
