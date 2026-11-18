// Car park and site works laid out in the building's own frame. Used by generateSiteWorks when a building is turned off the lot's grid:
// the car park is attached to one face of the building (footpath, bay row, aisle, optional second bay row), the aisle and bays run parallel to
// that face, the loading hardstand is joined by a truck lane, and one drive runs from the street crossover to the aisle. Pure geometry in plan mm.

import * as G from '../model/geometry.js';
import { bayDemand } from './catalogue/bays.js';
import { accessibleRequired } from './rules.js';
import { fillField, betterField, fieldGeometry, markAccessible, carportsOf, BAY_W, BAY_L } from './carpark-field.js';

const r0 = (v) => Math.round(v);
const FOOT = 1500;
const CAR_AISLE = 6200;
const SKEW_TOL_DEG = 1.5;

/** Degrees the building is turned off the lot's grid, folded to -45..45. */
export function skewDeg(rotationDeg, f) {
  const lotDeg = (Math.atan2(f.u.y, f.u.x) * 180) / Math.PI;
  let d = (((Number(rotationDeg) || 0) - lotDeg) % 90 + 90) % 90;
  if (d > 45) d -= 90;
  return d;
}
export const isSkewed = (rotationDeg, f) => Math.abs(skewDeg(rotationDeg, f)) > SKEW_TOL_DEG;

const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
function distSeg(p, a, b) {
  const dx = b.x - a.x; const dy = b.y - a.y;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
  return { d: Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy), t, x: a.x + t * dx, y: a.y + t * dy };
}
const edgeDist = (q, poly) => Math.min(...poly.map((a, i) => distSeg(q, a, poly[(i + 1) % poly.length]).d));

/** A rectangle polygon (world) for a strip of `width` centred on the line a to b, with its ends pushed out by `cap`. */
export function stripPoly(a, b, width, cap = 0) {
  const L = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  const u = { x: (b.x - a.x) / L, y: (b.y - a.y) / L };
  const n = { x: -u.y, y: u.x };
  const h = width / 2;
  const a2 = { x: a.x - u.x * cap, y: a.y - u.y * cap };
  const b2 = { x: b.x + u.x * cap, y: b.y + u.y * cap };
  return [
    { x: r0(a2.x + n.x * h), y: r0(a2.y + n.y * h) }, { x: r0(b2.x + n.x * h), y: r0(b2.y + n.y * h) },
    { x: r0(b2.x - n.x * h), y: r0(b2.y - n.y * h) }, { x: r0(a2.x - n.x * h), y: r0(a2.y - n.y * h) },
  ];
}

/** True when any of a polygon's corners, edge midpoints or centre falls inside `other`, or any of other's corners inside it. */
function overlaps(poly, other) {
  const c = { x: poly.reduce((s, q) => s + q.x, 0) / poly.length, y: poly.reduce((s, q) => s + q.y, 0) / poly.length };
  const pts = [c, ...poly, ...poly.map((q, i) => ({ x: (q.x + poly[(i + 1) % poly.length].x) / 2, y: (q.y + poly[(i + 1) % poly.length].y) / 2 }))];
  if (pts.some((q) => G.pointInPolygon(q, other))) return true;
  return other.some((q) => G.pointInPolygon(q, poly));
}
/** Sample interior of a (rectangular) strip every ~1 m and test whether any sample sits in a polygon. */
function sampleHits(poly, others) {
  const a = { x: (poly[0].x + poly[3].x) / 2, y: (poly[0].y + poly[3].y) / 2 };
  const b = { x: (poly[1].x + poly[2].x) / 2, y: (poly[1].y + poly[2].y) / 2 };
  const L = Math.hypot(b.x - a.x, b.y - a.y);
  const w = Math.hypot(poly[0].x - poly[3].x, poly[0].y - poly[3].y);
  const nL = Math.max(1, Math.ceil(L / 1000)); const nW = Math.max(1, Math.ceil(w / 1000));
  for (let i = 0; i <= nL; i++) for (let j = 0; j <= nW; j++) {
    const tL = i / nL; const tW = (j + 0.5) / (nW + 1);
    const q = { x: a.x + (b.x - a.x) * tL + (poly[0].x - a.x) * (2 * tW - 1) * 1, y: a.y + (b.y - a.y) * tL + (poly[0].y - a.y) * (2 * tW - 1) * 1 };
    if (others.some((o) => G.pointInPolygon(q, o))) return true;
  }
  return false;
}

/**
 * ctx: { c, lot, f, b, toFrame, toWorldF, fitToLot, frontLand, sideLand, truck, xoverW, aisleTruck, aisleMm }
 * Returns a siteWorks object (without version / key / generatedAt) or null when no connected layout can be made.
 */
export function orientedWorks(ctx) {
  const { c, lot, f, b, toFrame, toWorldF, fitToLot } = ctx;
  const bayW = Math.max(BAY_W, Number(c.parking?.bayW) || 0);
  const bayL = Math.max(BAY_L, Number(c.parking?.bayL) || 0);
  const aisleCar = Math.max(CAR_AISLE, Number(c.parking?.aisleMm) || 0);
  const frontLand = ctx.frontLand; const sideLand = ctx.sideLand;
  const frontEdges = new Set(lot.frontEdges);
  const edges = lot.boundary.map((a, i) => ({ a, b: lot.boundary[(i + 1) % lot.boundary.length], front: frontEdges.has(i) }));
  const inLotMargin = (q) => G.pointInPolygon(q, lot.boundary) && edges.every((e) => distSeg(q, e.a, e.b).d >= (e.front ? frontLand : sideLand) - 1);
  const polyInLot = (poly) => poly.every((q) => inLotMargin(q));

  // Building frame.
  const rot = ((b.place.rotationDeg || 0) * Math.PI) / 180;
  const ux = { x: Math.cos(rot), y: Math.sin(rot) }; const vy = { x: -Math.sin(rot), y: Math.cos(rot) };
  const xs = b.local.outline.map((q) => q.x); const ys = b.local.outline.map((q) => q.y);
  const x0 = Math.min(...xs); const x1 = Math.max(...xs); const y0 = Math.min(...ys); const y1 = Math.max(...ys);
  const lw = (x, y) => ({ x: b.place.x + ux.x * x + vy.x * y, y: b.place.y + ux.y * x + vy.y * y });
  const aprons = b.extras.filter((e) => e.kind === 'apron').map((e) => e.polygon);
  const obstacles = b.extras.filter((e) => !['canopy', 'fuel-canopy', 'truck-canopy', 'apron', 'yard', 'landscape', 'dock-recess', 'entry-canopy'].includes(e.kind)).map((e) => e.polygon);
  const solids = [b.outline, ...obstacles];
  const doorW = lw((x0 + x1) / 2, y0);

  const need = Math.ceil(bayDemand(b).raw - 1e-9);
  const accReq = need >= 2 ? accessibleRequired(need, c.buildingClass || 'class_8') : 0;
  const wanted = need + Math.floor(accReq / 2) + (accReq % 2);

  // Faces in preference order: the door face first, then the other faces nearest the street.
  const mk = (name, mid, nrm, len) => ({ name, m: mid, nrm, tan: { x: -nrm.y, y: nrm.x }, len });
  const faces = [
    mk('front', lw((x0 + x1) / 2, y0), { x: -vy.x, y: -vy.y }, x1 - x0),
    mk('rear', lw((x0 + x1) / 2, y1), vy, x1 - x0),
    mk('left', lw(x0, (y0 + y1) / 2), { x: -ux.x, y: -ux.y }, y1 - y0),
    mk('right', lw(x1, (y0 + y1) / 2), ux, y1 - y0),
  ];
  const e0 = lot.frontEdges[0] ?? 0;
  const eA = lot.boundary[e0]; const eB = lot.boundary[(e0 + 1) % lot.boundary.length];
  const edgeLen = Math.hypot(eB.x - eA.x, eB.y - eA.y);
  const order = [faces[0], ...faces.slice(1).sort((p, q) => distSeg(p.m, eA, eB).d - distSeg(q.m, eA, eB).d)];

  // The car park is laid out in the face's own frame: s along the face, t into the building (so the free ground is at t < 0), by the bay
  // fill of carpark-field.js. Every row is parallel to the face. A spine runs out from the face toward the street and the drive joins its end.
  const solidsM = [...obstacles.map((o) => [o, 500]), ...aprons.map((o) => [o, 0]), [b.outline, FOOT + 500]];
  const lotPts = lot.boundary;
  const tryFace = (face) => {
    const nrm = face.nrm; const tan = face.tan; const O = face.m;
    const toM = (q) => ({ s: (q.x - O.x) * tan.x + (q.y - O.y) * tan.y, t: -((q.x - O.x) * nrm.x + (q.y - O.y) * nrm.y) });
    const fromM = (s, t) => ({ x: r0(O.x + tan.x * s - nrm.x * t), y: r0(O.y + tan.y * s - nrm.y * t) });
    const blockers = solidsM.map(([poly, pad]) => { const m = poly.map(toM); return { s0: Math.min(...m.map((q) => q.s)) - pad, s1: Math.max(...m.map((q) => q.s)) + pad, t0: Math.min(...m.map((q) => q.t)) - pad, t1: Math.max(...m.map((q) => q.t)) + pad }; });
    const lm = lotPts.map(toM);
    const sMin = Math.min(...lm.map((q) => q.s)); const sMax = Math.max(...lm.map((q) => q.s));
    const tMin = Math.min(...lm.map((q) => q.t));
    const ok = (s0, s1, t0, t1) => {
      if (s1 - s0 < 1 || t1 - t0 < 1) return false;
      for (const a of blockers) if (s0 < a.s1 && s1 > a.s0 && t0 < a.t1 && t1 > a.t0) return false;
      const ss = [s0, (s0 + s1) / 2, s1]; const tt = [t0, (t0 + t1) / 2, t1];
      for (let x = s0 + 1500; x < s1; x += 1500) ss.push(x);
      for (let y = t0 + 1500; y < t1; y += 1500) tt.push(y);
      for (const s of ss) for (const t of tt) if (!inLotMargin(fromM(s, t))) return false;
      return true;
    };
    const attempt = (sp) => fillField({ ok, sp, spineW: aisleCar, aisleW: aisleCar, bayL, bayW, wanted, near: { s: 0, t: -500 }, tStart: tMin, tFirst: tMin, leadIn: 9000, tEnd: 0, sMin, sMax });
    let field = attempt(0);
    if (!field || field.count < wanted || !field.double) {
      let best = field;
      for (let k = 1; k <= 12; k++) for (const sg of [-1, 1]) {
        const alt = attempt(sg * k * 3000);
        if (betterField(alt, best, wanted)) best = alt;
      }
      field = best;
    }
    if (!field) return null;
    return { face, field, fromM, toM };
  };
  let layout = null;
  for (const face of order) { const l = tryFace(face); if (l && (!layout || betterField(l.field, layout.field, wanted))) { layout = l; if (l.field.count >= wanted && l.field.double) break; } }
  if (!layout) return null;
  const { face, field, fromM } = layout;
  const geo = fieldGeometry(field, fromM, { u: face.tan, n: { x: -face.nrm.x, y: -face.nrm.y } });
  const poly = (s0, s1, t0, t1) => [fromM(s0, t0), fromM(s1, t0), fromM(s1, t1), fromM(s0, t1)];
  const extent = geo.aisles.reduce((e, a) => ({ s0: Math.min(e.s0, ...a.polygon.map((q) => layout.toM(q).s)), s1: Math.max(e.s1, ...a.polygon.map((q) => layout.toM(q).s)), t0: Math.min(e.t0, ...a.polygon.map((q) => layout.toM(q).t)), t1: Math.max(e.t1, ...a.polygon.map((q) => layout.toM(q).t)) }), { s0: Infinity, s1: -Infinity, t0: Infinity, t1: -Infinity });
  for (const r of geo.rows) for (const sl of r.slots) for (const q of sl.poly) { const m = layout.toM(q); extent.s0 = Math.min(extent.s0, m.s); extent.s1 = Math.max(extent.s1, m.s); extent.t0 = Math.min(extent.t0, m.t); extent.t1 = Math.max(extent.t1, m.t); }
  const carPark = poly(extent.s0, extent.s1, extent.t0, extent.t1);
  const aisle = geo.aisles[0].polygon; // the spine
  const spineStart = { x: (geo.aisles[0].centre[0].x), y: (geo.aisles[0].centre[0].y) };

  // The drive: crossover on the first frontage edge, then one connected run to the street end of the spine.
  const xoverW = ctx.xoverW;
  const edgeU = { x: (eB.x - eA.x) / edgeLen, y: (eB.y - eA.y) / edgeLen };
  const sOf = (pt) => (pt.x - eA.x) * edgeU.x + (pt.y - eA.y) * edgeU.y;
  const corner = 6000;
  const sLo = xoverW / 2 + sideLand + 500 + (frontEdges.has((e0 - 1 + lot.boundary.length) % lot.boundary.length) ? corner : 0);
  const sHi = edgeLen - xoverW / 2 - sideLand - 500 - (frontEdges.has((e0 + 1) % lot.boundary.length) ? corner : 0);
  const bayPolys = geo.rows.flatMap((r) => r.slots.map((sl) => sl.poly));
  let drive = null;
  const lead = 9000; // the drive meets the spine end head on, along the spine's own axis, so it never cuts across a bay row (the spine starts 9 m before the first bay)
  const E = { x: r0(spineStart.x + face.nrm.x * lead), y: r0(spineStart.y + face.nrm.y * lead) };
  const tg = spineStart;
  const sxBase = Math.max(sLo, Math.min(sHi, sOf(E)));
  const sxList = [sxBase];
  for (let k = 1; k <= 20; k++) for (const sg of [-1, 1]) { const v = sxBase + sg * k * 2000; if (v >= sLo && v <= sHi) sxList.push(v); }
  for (const sx of sxList) {
    const X = { x: r0(eA.x + edgeU.x * sx), y: r0(eA.y + edgeU.y * sx) };
    const k = (E.x - X.x) * f.n.x + (E.y - X.y) * f.n.y;
    const mid = { x: r0(X.x + f.n.x * k), y: r0(X.y + f.n.y * k) };
    const options = [[X, E, tg], [X, mid, E, tg], [X, tg]];
    for (const pts of options) {
      const strips = [];
      for (let i = 0; i + 1 < pts.length; i++) if (Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].y - pts[i].y) > 100) strips.push(stripPoly(pts[i], pts[i + 1], aisleCar, aisleCar / 2));
      if (!strips.length) continue;
      const okLot = strips.every((sp) => sp.every((q) => G.pointInPolygon(q, lot.boundary) || edgeDist(q, lot.boundary) < 400 || (((q.x - eA.x) * f.n.x + (q.y - eA.y) * f.n.y) > -xoverW && sOf(q) > -xoverW && sOf(q) < edgeLen + xoverW && ((q.x - eA.x) * f.n.x + (q.y - eA.y) * f.n.y) < 0)));
      if (!okLot) continue;
      if (strips.some((sp) => sampleHits(sp, [...solids, ...aprons, ...bayPolys]))) continue;
      drive = { pts, strips, crossoverS: sx };
      break;
    }
    if (drive) break;
  }
  if (!drive) return null;
  const roads = [...geo.aisles.map((a) => a.polygon), ...drive.strips];

  // Truck lanes from each hardstand to the drive or aisle, so the hardstand is connected.
  const links = [];
  const warnings = [];
  const touches = (poly, others) => others.some((o) => overlaps(poly, o) || o.some((q) => edgeDist(q, poly) < 300) || poly.some((q) => edgeDist(q, o) < 300));
  for (const ap of aprons) {
    if (touches(ap, roads)) continue;
    const ac = { x: ap.reduce((s, q) => s + q.x, 0) / ap.length, y: ap.reduce((s, q) => s + q.y, 0) / ap.length };
    let nearest = null;
    for (const poly of roads) for (let i = 0; i < poly.length; i++) {
      const hit = distSeg(ac, poly[i], poly[(i + 1) % poly.length]);
      if (!nearest || hit.d < nearest.d) nearest = hit;
    }
    if (!nearest) continue;
    const tw = Math.min(ctx.aisleTruck, 7500);
    const tries = [[ac, { x: nearest.x, y: nearest.y }]];
    const lu = f.u; const ln = f.n;
    const dd = { x: nearest.x - ac.x, y: nearest.y - ac.y };
    const dn = dd.x * ln.x + dd.y * ln.y; const du = dd.x * lu.x + dd.y * lu.y;
    tries.push([ac, { x: ac.x + ln.x * dn, y: ac.y + ln.y * dn }, { x: nearest.x, y: nearest.y }]);
    tries.push([ac, { x: ac.x + lu.x * du, y: ac.y + lu.y * du }, { x: nearest.x, y: nearest.y }]);
    let done = false;
    for (const pts of tries) {
      const strips = [];
      for (let i = 0; i + 1 < pts.length; i++) if (Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].y - pts[i].y) > 100) strips.push(stripPoly(pts[i], pts[i + 1], tw, tw / 2));
      if (!strips.length) { done = true; break; }
      if (strips.some((sp) => sampleHits(sp, [b.outline, ...obstacles, ...bayPolys]))) continue;
      if (!strips.every((sp) => sp.every((q) => G.pointInPolygon(q, lot.boundary) || edgeDist(q, lot.boundary) < 400))) continue;
      links.push(...strips); done = true; break;
    }
    if (!done) warnings.push('The loading hardstand could not be linked to the drive inside the lot.');
  }

  // Outputs.
  const crossoverPt = drive.pts[0];
  const crossovers = [{ id: 'sw:xover:0', x: crossoverPt.x, y: crossoverPt.y, widthMm: xoverW, role: 'both', dir: { x: -f.n.x, y: -f.n.y }, polygon: stripPoly(crossoverPt, { x: crossoverPt.x - f.n.x * 3000, y: crossoverPt.y - f.n.y * 3000 }, xoverW, 0) }];
  const aislesOut = geo.aisles.map((a) => ({ ...a }));
  drive.strips.forEach((sp, k) => {
    const a = drive.pts[k]; const z = drive.pts[k + 1];
    aislesOut.push({ id: `sw:aisle:d${k}`, polygon: sp, centre: [a, z], widthMm: aisleCar, kind: 'aisle' });
  });
  const pavedAisles = [...geo.paved, ...drive.strips.map((p, k) => ({ id: `sw:paved:d${k}`, polygon: p })), ...links.map((p, k) => ({ id: `sw:paved:l${k}`, polygon: p }))];
  const apronsOut = []; const warn2 = [];
  for (const ap of aprons) {
    const r = fitToLot(ap, lot);
    if (r.clipped) warn2.push(r.lost ? 'The truck apron does not fit inside the lot.' : 'The truck apron was cut back to the lot boundary.');
    if (r.polygon) apronsOut.push({ id: `sw:apron:${apronsOut.length}`, buildingId: b.id, polygon: r.polygon });
  }
  const toW0 = (fc, p, q) => ({ x: r0(fc.m.x + fc.tan.x * p + fc.nrm.x * q), y: r0(fc.m.y + fc.tan.y * p + fc.nrm.y * q) });
  const footpaths = [{ id: 'sw:foot:0', buildingId: b.id, polygon: [toW0(face, -face.len / 2, 0), toW0(face, face.len / 2, 0), toW0(face, face.len / 2, FOOT), toW0(face, -face.len / 2, FOOT)] }];

  // Bay rows from the fill, accessible group nearest the door, then the bays handed to the building.
  const rowsOut = geo.rows;
  const doorM = { x: face.m.x, y: face.m.y };
  const accProvided = markAccessible(rowsOut, accReq, (sl) => Math.hypot(sl.centre.x - doorM.x, sl.centre.y - doorM.y));
  for (const r of rowsOut) { r.buildingId = b.id; delete r._fr; }
  const zones = rowsOut.reduce((s, r) => s + r.slots.filter((x) => x.kind === 'zone').length, 0);
  const provided = rowsOut.reduce((s, r) => s + r.slots.length, 0) - zones;
  const carports = c.parking?.covered ? carportsOf(rowsOut) : [];

  // Front landscape strip either side of the crossover.
  const landscape = [];
  const sx = drive.crossoverS;
  const mkStrip = (s0, s1) => {
    if (s1 - s0 < 1200) return;
    const poly = [0, 1, 2, 3].map((k) => { const s = k === 0 || k === 3 ? s0 : s1; const t = k < 2 ? 0 : frontLand - 300; return { x: r0(eA.x + edgeU.x * s + f.n.x * t), y: r0(eA.y + edgeU.y * s + f.n.y * t) }; });
    if (poly.every((q) => G.pointInPolygon(q, lot.boundary)) && !roads.some((rd) => overlaps(poly, rd))) landscape.push({ id: `sw:land:${landscape.length}`, polygon: poly });
  };
  mkStrip(0, sx - xoverW / 2 - 300); mkStrip(sx + xoverW / 2 + 300, edgeLen);
  void toFrame; void toWorldF; void sub;

  return {
    kind: 'general', aisleMm: aisleCar, crossovers, carports, field: { cols: field.cols, count: field.count, aisleMm: aisleCar, bayW, bayL }, aisles: aislesOut, pavedAisles, forecourts: [], aprons: apronsOut, footpaths, landscape,
    carPark: { id: 'sw:carpark:0', buildingId: b.id, polygon: carPark, face: face.name },
    drive: { id: 'sw:drive:0', points: drive.pts, widthMm: aisleCar, polygons: drive.strips, links },
    orientedTo: { buildingId: b.id, rotationDeg: b.place.rotationDeg, face: face.name },
    warnings: [...new Set([...warnings, ...warn2])], bayRows: rowsOut,
    summary: { required: need, provided, accessibleRequired: accReq, accessibleProvided: accProvided, limited: provided < need, perBuilding: [{ id: b.id, required: need, provided }], reachable: { [b.id]: true }, unreachable: [] },
  };
}
