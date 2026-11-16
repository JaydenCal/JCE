// Car park and site works laid out in the building's own frame. Used by generateSiteWorks when a building is turned off the lot's grid:
// the car park is attached to one face of the building (footpath, bay row, aisle, optional second bay row), the aisle and bays run parallel to
// that face, the loading hardstand is joined by a truck lane, and one drive runs from the street crossover to the aisle. Pure geometry in plan mm.

import * as G from '../model/geometry.js';
import { bayDemand } from './catalogue/bays.js';
import { accessibleRequired } from './rules.js';

const r0 = (v) => Math.round(v);
const FOOT = 1500;
const CAR_AISLE = 6000;
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
  const bayW = Number(c.parking?.bayW) || 2400;
  const bayL = Number(c.parking?.bayL) || 5400;
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
  const streetPt = lot.boundary[(lot.frontEdges[0] ?? 0)];
  const e0 = lot.frontEdges[0] ?? 0;
  const eA = lot.boundary[e0]; const eB = lot.boundary[(e0 + 1) % lot.boundary.length];
  const edgeLen = Math.hypot(eB.x - eA.x, eB.y - eA.y);
  void streetPt;
  const order = [faces[0], ...faces.slice(1).sort((p, q) => distSeg(p.m, eA, eB).d - distSeg(q.m, eA, eB).d)];

  const toW = (face, p, q) => ({ x: r0(face.m.x + face.tan.x * p + face.nrm.x * q), y: r0(face.m.y + face.tan.y * p + face.nrm.y * q) });
  const rectF = (face, p0, p1, q0, q1) => [toW(face, p0, q0), toW(face, p1, q0), toW(face, p1, q1), toW(face, p0, q1)];

  const tryFace = (face) => {
    const qA0 = FOOT; const qA1 = FOOT + bayL; const qAis1 = qA1 + aisleCar; const qB1 = qAis1 + bayL;
    let best = null;
    for (let ext = 0; ext <= 60000; ext += bayW * 2) {
      const half = face.len / 2 + ext;
      const nSlots = Math.floor((2 * half) / bayW);
      const pStart = -((nSlots * bayW) / 2);
      const cand = [];
      for (let i = 0; i < nSlots; i++) {
        const p0 = pStart + i * bayW;
        const pc = p0 + bayW / 2;
        for (const row of ['A', 'B']) {
          const poly = row === 'A' ? rectF(face, p0, p0 + bayW, qA0, qA1) : rectF(face, p0, p0 + bayW, qAis1, qB1);
          if (!polyInLot(poly)) continue;
          if (solids.some((s) => overlaps(poly, s)) || aprons.some((s) => overlaps(poly, s))) continue;
          const aisleCell = rectF(face, p0, p0 + bayW, qA1, qAis1);
          if (!polyInLot(aisleCell) || solids.some((s) => overlaps(aisleCell, s)) || aprons.some((s) => overlaps(aisleCell, s))) continue;
          cand.push({ row, p0, pc, poly, d: Math.abs(pc) + (row === 'B' ? 1 : 0) });
        }
      }
      cand.sort((p, q) => p.d - q.d);
      const chosen = cand.slice(0, wanted);
      if (!best || chosen.length > best.chosen.length) best = { chosen, nSlots, pStart, face, ext };
      if (chosen.length >= wanted) break;
    }
    if (!best || !best.chosen.length) return null;
    const ch = best.chosen;
    const pMin = Math.min(...ch.map((s) => s.p0)); const pMax = Math.max(...ch.map((s) => s.p0 + bayW));
    const useB = ch.some((s) => s.row === 'B');
    const rowsUsed = { A: ch.some((s) => s.row === 'A'), B: useB };
    // Row B only makes sense next to the aisle, which always runs across the full width.
    const qTop = useB ? qB1 : rowsUsed.A ? qAis1 : qAis1;
    const aisle = rectF(face, pMin, pMax, qA1, qAis1);
    const carPark = rectF(face, pMin, pMax, 0, qTop);
    if (!polyInLot(aisle)) return null;
    return { face, ch, pMin, pMax, aisle, carPark, qA1, qAis1, qTop, useB };
  };

  let layout = null;
  for (const face of order) { layout = tryFace(face); if (layout) break; }
  if (!layout) return null;
  const { face, ch, pMin, pMax, aisle, carPark, qA1, qAis1 } = layout;

  // The drive: crossover on the first frontage edge, then one connected run to the nearest end of the aisle.
  const xoverW = ctx.xoverW;
  const edgeU = { x: (eB.x - eA.x) / edgeLen, y: (eB.y - eA.y) / edgeLen };
  const aisleMid = (p) => toW(face, p, (qA1 + qAis1) / 2);
  const ends = [aisleMid(pMin), aisleMid(pMax)];
  const sOf = (pt) => (pt.x - eA.x) * edgeU.x + (pt.y - eA.y) * edgeU.y;
  const corner = 6000;
  const sLo = xoverW / 2 + sideLand + 500 + (frontEdges.has((e0 - 1 + lot.boundary.length) % lot.boundary.length) ? corner : 0);
  const sHi = edgeLen - xoverW / 2 - sideLand - 500 - (frontEdges.has((e0 + 1) % lot.boundary.length) ? corner : 0);
  const bayPolys = ch.map((s) => s.poly);
  let drive = null;
  const lead = 9000; // the drive meets the aisle end head on, along the aisle's own axis, so it never cuts across a bay row
  const endsOut = [{ tg: ends[0], dir: -1 }, { tg: ends[1], dir: 1 }].map((e) => ({ ...e, E: { x: r0(e.tg.x + face.tan.x * e.dir * lead), y: r0(e.tg.y + face.tan.y * e.dir * lead) } }));
  for (const { tg, E } of endsOut.sort((p, q) => Math.abs(sOf(p.E) - (sLo + sHi) / 2) - Math.abs(sOf(q.E) - (sLo + sHi) / 2))) {
    const sx = Math.max(sLo, Math.min(sHi, sOf(E)));
    const X = { x: r0(eA.x + edgeU.x * sx), y: r0(eA.y + edgeU.y * sx) };
    const k = (E.x - X.x) * f.n.x + (E.y - X.y) * f.n.y;
    const mid = { x: r0(X.x + f.n.x * k), y: r0(X.y + f.n.y * k) };
    const options = [[X, mid, E, tg], [X, E, tg]];
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
  const roads = [aisle, ...drive.strips];

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
  const aisleCentre = [aisleMid(pMin), aisleMid(pMax)];
  const aislesOut = [{ id: 'sw:aisle:0', polygon: aisle, centre: aisleCentre, widthMm: aisleCar, kind: 'aisle' }];
  drive.strips.forEach((sp, k) => {
    const a = drive.pts[k]; const z = drive.pts[k + 1];
    aislesOut.push({ id: `sw:aisle:${k + 1}`, polygon: sp, centre: [a, z], widthMm: aisleCar, kind: 'aisle' });
  });
  const pavedAisles = [{ id: 'sw:paved:0', polygon: aisle }, ...drive.strips.map((p, k) => ({ id: `sw:paved:${k + 1}`, polygon: p })), ...links.map((p, k) => ({ id: `sw:paved:l${k}`, polygon: p }))];
  const apronsOut = []; const warn2 = [];
  for (const ap of aprons) {
    const r = fitToLot(ap, lot);
    if (r.clipped) warn2.push(r.lost ? 'The truck apron does not fit inside the lot.' : 'The truck apron was cut back to the lot boundary.');
    if (r.polygon) apronsOut.push({ id: `sw:apron:${apronsOut.length}`, buildingId: b.id, polygon: r.polygon });
  }
  const footpaths = [{ id: 'sw:foot:0', buildingId: b.id, polygon: rectF(face, -face.len / 2, face.len / 2, 0, FOOT) }];

  // Bay rows (one per bay row used), accessible group nearest the door, bays in order along the face.
  const rowsOut = [];
  for (const rowKey of ['A', 'B']) {
    const slotsR = ch.filter((s) => s.row === rowKey).sort((p, q) => p.p0 - q.p0);
    if (!slotsR.length) continue;
    const qEdge = rowKey === 'A' ? qA1 : qAis1;
    const vSign = rowKey === 'A' ? -1 : 1;
    const o = toW(face, slotsR[0].p0, qEdge);
    const slots = slotsR.map((s, i) => ({ index: i, kind: 'bay', poly: s.poly, centre: { x: r0(s.poly.reduce((a, q) => a + q.x, 0) / 4), y: r0(s.poly.reduce((a, q) => a + q.y, 0) / 4) }, _p: s.p0 + bayW / 2 }));
    const runs = []; let cur = null;
    slotsR.forEach((s) => { if (cur && Math.abs(s.p0 - cur.last - bayW) < 5) { cur.list.push(s); cur.last = s.p0; } else { cur = { list: [s], last: s.p0 }; runs.push(cur); } });
    const bayAreas = runs.map((rn, q) => ({ id: `sw:bays:${rowKey === 'A' ? 0 : 1}:${q}`, polygon: rowKey === 'A' ? rectF(face, rn.list[0].p0, rn.last + bayW, qA1 - bayL, qA1) : rectF(face, rn.list[0].p0, rn.last + bayW, qAis1, qAis1 + bayL) }));
    const vv = { x: face.nrm.x * vSign, y: face.nrm.y * vSign };
    rowsOut.push({ rowId: `sw:bays:${rowKey === 'A' ? 0 : 1}`, buildingId: b.id, bayAreas, frame: { o, u: { x: face.tan.x, y: face.tan.y }, v: vv, f: { x: -vv.x, y: -vv.y } }, length: slots.length * bayW, x0: 0, depth: 0, offsetMm: 0, slots });
  }
  let accProvided = 0;
  if (accReq > 0) {
    const groups = [];
    for (const row of rowsOut) for (let i = 0; i + 2 < row.slots.length; i++) groups.push({ row, i, d: Math.abs(row.slots[i + 1]._p) });
    groups.sort((p, q) => p.d - q.d);
    const taken = new Set();
    for (const gr of groups) {
      if (accProvided >= accReq) break;
      const ids = [0, 1, 2].map((k) => `${gr.row.rowId}:${gr.i + k}`);
      if (ids.some((x) => taken.has(x))) continue;
      ids.forEach((x) => taken.add(x));
      gr.row.slots[gr.i].kind = 'accessible'; gr.row.slots[gr.i + 1].kind = 'zone'; gr.row.slots[gr.i + 2].kind = 'accessible';
      accProvided += 2;
    }
    for (const row of rowsOut) for (let i = 0; i + 1 < row.slots.length && accProvided < accReq; i++) {
      const a = `${row.rowId}:${i}`; const z = `${row.rowId}:${i + 1}`;
      if (taken.has(a) || taken.has(z) || row.slots[i].kind !== 'bay' || row.slots[i + 1].kind !== 'bay') continue;
      taken.add(a); taken.add(z);
      row.slots[i].kind = 'accessible'; row.slots[i + 1].kind = 'zone'; accProvided += 1;
    }
  }
  for (const row of rowsOut) for (const s of row.slots) delete s._p;
  const zones = rowsOut.reduce((s, r) => s + r.slots.filter((x) => x.kind === 'zone').length, 0);
  const provided = rowsOut.reduce((s, r) => s + r.slots.length, 0) - zones;

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
    kind: 'general', aisleMm: aisleCar, crossovers, aisles: aislesOut, pavedAisles, forecourts: [], aprons: apronsOut, footpaths, landscape,
    carPark: { id: 'sw:carpark:0', buildingId: b.id, polygon: carPark, face: face.name },
    drive: { id: 'sw:drive:0', points: drive.pts, widthMm: aisleCar, polygons: drive.strips, links },
    orientedTo: { buildingId: b.id, rotationDeg: b.place.rotationDeg, face: face.name },
    warnings: [...new Set([...warnings, ...warn2])], bayRows: rowsOut,
    summary: { required: need, provided, accessibleRequired: accReq, accessibleProvided: accProvided, limited: provided < need, perBuilding: [{ id: b.id, required: need, provided }], reachable: { [b.id]: true }, unreachable: [] },
  };
}
