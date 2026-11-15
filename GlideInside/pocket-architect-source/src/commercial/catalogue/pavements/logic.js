// Pavement logic for a commercial layout: default pavement areas from the layout that exists today, kerbs along the pavement edges that
// meet landscaping, wheel stops and markings, quantities, cost from rates.json, the site works cost feasibility can call, and the plan set
// legend and schedule blocks (C101 and C103). Pure functions, no DOM, plan mm (y down).
//
// Defaults (each is a layout "role", overridable per area with project.commercial.pavements):
//   apron     truck apron in front of the roller doors (the depth by which the apron is wider than the car aisle)   heavy duty concrete
//   aisle     car aisle in front of the bays                                                                          asphalt AC10, car
//   bays      parking bays                                                                                            asphalt AC10, car
//   footpath  1.5 m footpath behind each bay row (project.commercial.pavementOptions.footpathMm, 0 for none)          concrete footpath
//   waste     waste enclosure pad                                                                                      heavy duty concrete
//   yard      project.commercial.yards [{ id?, polygon }] (none are generated)                                       gravel yard
// Overrides: project.commercial.pavements = [{ id, type, polygon? }]. An id that matches a default area changes its type (and polygon when
// given), type 'none' removes it; any other id with a polygon and a valid type adds an area. project.commercial.kerbs = [{ id?, type,
// polyline }] works the same way (kerb ids are stable for a given layout). project.commercial.crossovers = [{ x, y, widthMm }] places the
// driveway crossovers (layback kerb); when it is absent one is placed where the paved area is nearest the front boundary.
// project.commercial.markings = [{ type, x, y, rotationDeg, ... }] adds arrows, give way and stop bars, speed humps, loading zone hatch
// and keep clear marking.

import rates from './rates.json' with { type: 'json' };
import { layoutUnits, rowPoly, rowPoint } from '../../layout.js';
import { parkingLayout, estateOf } from '../../parking.js';
import { siteWorksOf } from '../buildings.js';
import { bayOffsetMm } from '../../schema.js';
import { PAVEMENTS, ROLE_DEFAULTS, MAKEUP_NOTE, pavementById, isPavementType, makeUpShort } from './pavements.js';
import { KERBS, KERB_DEFAULTS, kerbById, isKerbType } from './kerbs.js';
import { MARKINGS, WHEEL_STOP, markingById, isMarkingType } from './markings.js';
import { absArea, polyArea, pointInPoly, bbox, bboxOverlap, segCross, convexOverlap } from './geom.js';
import { boolean, holeFree, overlapArea } from './polybool.js';

export const RATES = rates;
export const DATA_DATE = rates._meta.asAt;
export const FOOTPATH_MM = 1500;
export const CROSSOVER_MM = 6000;
export const RATES_CAVEAT = 'Indicative supply and lay rates for regional NSW, status ESTIMATE, not a quote. Check with a quantity surveyor.';

const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
const len = (v) => Math.hypot(v.x, v.y);
const dot = (a, b) => a.x * b.x + a.y * b.y;
const lerp = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
const r1 = (v) => Math.round(v * 10) / 10;
const rowAngleDeg = (fr) => (Math.atan2(fr.u.y, fr.u.x) * 180) / Math.PI;

// Pavement areas ---------------------------------------------------------------------------------------------------------------------

/** The default areas (before overrides): [{ id, role, rowId, type, polygon, auto: true }]. */
export function defaultAreas(commercial) {
  const c = commercial || {};
  const out = [];
  const park = parkingLayout(c);
  if (c.parking?.enabled !== false && park.rows.length) {
    const { aisleMm, bayW, bayL } = c.parking;
    const off = bayOffsetMm(c.parking);
    const apron = Math.max(0, off - (Number(aisleMm) || 0));
    const footW = Number.isFinite(Number(c.pavementOptions?.footpathMm)) ? Math.max(0, Number(c.pavementOptions.footpathMm)) : FOOTPATH_MM;
    const estate = !!estateOf(c); // an estate's aprons, aisles and footpaths are its own network (siteWorks); its bay strips only add the bays
    for (const pr of park.rows) {
      if (!pr.slots.length) continue;
      const fr = pr.frame;
      const L = pr.length;
      const B = pr.slots.length * bayW;
      const rowOff = pr.extra ? pr.off : off; // a bay strip in a spare area carries its own aisle
      const rowApron = pr.extra ? 0 : apron;
      const rowAisle = rowOff - rowApron;
      const quad = (x0, x1, d0, d1) => [rowPoint(fr, x0, d0), rowPoint(fr, x1, d0), rowPoint(fr, x1, d1), rowPoint(fr, x0, d1)];
      if (rowApron > 0 && !estate) out.push({ id: `${pr.rowId}:apron`, role: 'apron', rowId: pr.rowId, polygon: quad(0, L, pr.depth, pr.depth + rowApron) });
      if (rowAisle > 0 && !estate) out.push({ id: `${pr.rowId}:aisle`, role: 'aisle', rowId: pr.rowId, polygon: quad(0, L, pr.depth + rowApron, pr.depth + rowOff) });
      out.push({ id: `${pr.rowId}:bays`, role: 'bays', rowId: pr.rowId, polygon: quad(0, B, pr.depth + rowOff, pr.depth + rowOff + bayL) });
      if (footW > 0 && !estate) out.push({ id: `${pr.rowId}:footpath`, role: 'footpath', rowId: pr.rowId, polygon: quad(0, B, pr.depth + rowOff + bayL, pr.depth + rowOff + bayL + footW) });
    }
  }
  // The automatic site layout: crossover pads, aisles, forecourt and apron slabs, bay rows and footpaths (sitelayout.js).
  const sw = siteWorksOf(c);
  if (sw && c.parking?.enabled !== false) {
    for (const f of sw.forecourts || []) out.push({ id: f.id, role: 'apron', rowId: null, polygon: f.polygon });
    for (const a of sw.aprons || []) out.push({ id: a.id, role: 'apron', rowId: null, polygon: a.polygon });
    for (const x of sw.crossovers || []) if (x.polygon) out.push({ id: `${x.id}:pad`, role: 'aisle', rowId: null, polygon: x.polygon });
    for (const a of sw.pavedAisles || []) out.push({ id: a.id, role: 'aisle', rowId: null, polygon: a.polygon });
    for (const r of sw.bayRows || []) for (const b of r.bayAreas || []) out.push({ id: b.id, role: 'bays', rowId: r.rowId, polygon: b.polygon });
    for (const f of sw.footpaths || []) out.push({ id: f.id, role: 'footpath', rowId: null, polygon: f.polygon });
  }
  const w = c.waste;
  if (w && w.widthMm > 0 && w.depthMm > 0) {
    const a = ((w.rotationDeg || 0) * Math.PI) / 180;
    const ax = { x: Math.cos(a), y: Math.sin(a) };
    const ay = { x: -Math.sin(a), y: Math.cos(a) };
    const pt = (sx, sy) => ({ x: w.x + ax.x * sx * w.widthMm / 2 + ay.x * sy * w.depthMm / 2, y: w.y + ax.y * sx * w.widthMm / 2 + ay.y * sy * w.depthMm / 2 });
    out.push({ id: 'waste', role: 'waste', rowId: null, polygon: [pt(-1, -1), pt(1, -1), pt(1, 1), pt(-1, 1)] });
  }
  (Array.isArray(c.yards) ? c.yards : []).forEach((y, i) => {
    if (Array.isArray(y?.polygon) && y.polygon.length >= 3) out.push({ id: y.id || `yard:${i}`, role: 'yard', rowId: null, polygon: y.polygon });
  });
  for (const a of out) { a.type = ROLE_DEFAULTS[a.role]; a.auto = true; }
  return out;
}

/** The areas in use: defaults with project.commercial.pavements applied. Each has `type` (a PAVEMENTS id), `overridden` and `auto`. */
export function pavementAreas(commercial) {
  const base = defaultAreas(commercial);
  const over = Array.isArray(commercial?.pavements) ? commercial.pavements : [];
  const byId = new Map(base.map((a) => [a.id, a]));
  const removed = new Set();
  const extras = [];
  let n = 0;
  for (const o of over) {
    if (!o) continue;
    const a = o.id ? byId.get(o.id) : null;
    if (a) {
      if (o.type === 'none') { removed.add(a.id); continue; }
      if (isPavementType(o.type)) { a.type = o.type; a.overridden = true; }
      if (Array.isArray(o.polygon) && o.polygon.length >= 3) { a.polygon = o.polygon; a.overridden = true; }
    } else if (Array.isArray(o.polygon) && o.polygon.length >= 3 && isPavementType(o.type)) {
      const drawn = String(o.id || '').startsWith('hs_'); // drawn with the Hardstand tool (see hardstand.js)
      extras.push({ id: o.id || `extra:${n++}`, role: drawn ? 'hardstand' : 'extra', rowId: null, type: o.type, polygon: o.polygon, auto: false, overridden: true, drawn });
    }
  }
  const list = [...extras, ...base.filter((a) => !removed.has(a.id))];
  return list.some((a) => a.drawn) ? cutByDrawn(list) : list;
}

/**
 * Drawn hardstand areas sit on top: each one cuts every area behind it in the list (the newer drawn areas come first). An area that is cut
 * keeps its id on the largest piece and gets `id~1`, `id~2` for the others; one that is covered completely drops out of the model (it stays
 * in project.commercial.pavements, so it comes back when the area above it moves or goes).
 */
function cutByDrawn(list) {
  const out = list.map((a) => ({ ...a }));
  for (let i = 0; i < out.length; i++) {
    if (!out[i].drawn) continue;
    const cut = out[i].polygon;
    const cb = bbox(cut);
    for (let j = i + 1; j < out.length; j++) {
      const t = out[j];
      if (!bboxOverlap(cb, bbox(t.polygon))) continue;
      if (overlapArea(t.polygon, cut) < 1e4) continue; // touching, or under 0.01 m2
      const pieces = holeFree(boolean([t.polygon], [cut], 'diff')).sort((p, q) => Math.abs(polyArea(q)) - Math.abs(polyArea(p)));
      const rest = pieces.map((poly, k) => ({ ...t, id: k === 0 ? t.id : `${t.id}~${k}`, polygon: poly, cut: true }));
      out.splice(j, 1, ...rest);
      j += rest.length - 1;
    }
  }
  return out;
}

const isVehicular = (type) => { const t = pavementById(type); return !!t && t.use.some((u) => u === 'car' || u === 'truck') && type !== 'gravel-yard'; };
const isPedestrianArea = (type) => { const t = pavementById(type); return !!t && t.use.length === 1 && t.use[0] === 'pedestrian'; };

const isConvex = (p) => { let sign = 0; for (let i = 0; i < p.length; i++) { const a = p[i]; const b = p[(i + 1) % p.length]; const c = p[(i + 2) % p.length]; const z = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x); if (Math.abs(z) < 1e-6) continue; const sg = z > 0 ? 1 : -1; if (sign && sg !== sign) return false; sign = sg; } return true; };
const polysOverlap = (a, b) => (isConvex(a) && isConvex(b) ? convexOverlap(a, b) : overlapArea(a, b) > 1e4);

/** Net area per area id in m2. Exact when no two areas overlap, else a 250 mm grid where the earlier area in the list wins. */
export function netAreasM2(areas) {
  const bbs = areas.map((a) => bbox(a.polygon));
  let overlap = false;
  for (let i = 0; i < areas.length && !overlap; i++) for (let j = i + 1; j < areas.length; j++) if (bboxOverlap(bbs[i], bbs[j]) && polysOverlap(areas[i].polygon, areas[j].polygon)) { overlap = true; break; }
  const out = new Map();
  if (!overlap) { for (const a of areas) out.set(a.id, absArea(a.polygon) / 1e6); return out; }
  const step = 250;
  areas.forEach((a, i) => {
    const b = bbs[i];
    let n = 0;
    for (let y = b.minY + step / 2; y < b.maxY; y += step) {
      for (let x = b.minX + step / 2; x < b.maxX; x += step) {
        const p = { x, y };
        if (!pointInPoly(p, a.polygon)) continue;
        let taken = false;
        for (let j = 0; j < i; j++) if (x >= bbs[j].minX && x <= bbs[j].maxX && y >= bbs[j].minY && y <= bbs[j].maxY && pointInPoly(p, areas[j].polygon)) { taken = true; break; }
        if (!taken) n++;
      }
    }
    out.set(a.id, (n * step * step) / 1e6);
  });
  return out;
}

// Kerbs -----------------------------------------------------------------------------------------------------------------------------

function distToSeg(p, a, b) {
  const v = sub(b, a);
  const l2 = dot(v, v) || 1;
  const t = Math.max(0, Math.min(1, dot(sub(p, a), v) / l2));
  const q = lerp(a, b, t);
  return { d: len(sub(p, q)), q, t };
}

/** Edge pieces of one area polygon with what lies outside each: [{ a, b, edge, out: 'open'|'pavement'|'building' }] split at every crossing. */
function classifyEdges(area, others, buildings) {
  const poly = area.polygon;
  const ccw = polyArea(poly) > 0;
  const pieces = [];
  poly.forEach((a, i) => {
    const b = poly[(i + 1) % poly.length];
    const e = sub(b, a);
    const L = len(e);
    if (L < 1) return;
    const outN = ccw ? { x: e.y / L, y: -e.x / L } : { x: -e.y / L, y: e.x / L };
    const ts = [0, 1];
    for (const other of [...others.map((o) => o.polygon), ...buildings]) {
      for (let j = 0; j < other.length; j++) {
        const c = other[j];
        const d = other[(j + 1) % other.length];
        const t = segCross(a, b, c, d);
        if (t != null && t > 0 && t < 1) ts.push(t);
      }
      for (const v of other) {
        const rel = sub(v, a);
        const t = dot(rel, e) / (L * L);
        if (t > 0 && t < 1 && Math.abs(rel.x * e.y - rel.y * e.x) / L < 5) ts.push(t);
      }
    }
    ts.sort((x, y) => x - y);
    const uniq = ts.filter((t, k) => k === 0 || (t - ts[k - 1]) * L > 2);
    for (let k = 0; k + 1 < uniq.length; k++) {
      const p0 = lerp(a, b, uniq[k]);
      const p1 = lerp(a, b, uniq[k + 1]);
      const mid = lerp(p0, p1, 0.5);
      const probe = { x: mid.x + outN.x * 30, y: mid.y + outN.y * 30 };
      let out = 'open';
      if (buildings.some((bp) => pointInPoly(probe, bp))) out = 'building';
      else if (others.some((o) => pointInPoly(probe, o.polygon))) out = 'pavement';
      pieces.push({ a: p0, b: p1, edge: i, out, outN });
    }
  });
  return pieces;
}

function autoCrossovers(runs, lot, c) {
  const swo = siteWorksOf(c);
  if (!Array.isArray(c.crossovers) && Array.isArray(swo?.crossovers) && swo.crossovers.length) return swo.crossovers.map((x) => ({ x: x.x, y: x.y, widthMm: x.widthMm, auto: true }));
  if (Array.isArray(c.crossovers)) return c.crossovers.filter((x) => Number.isFinite(x?.x) && Number.isFinite(x?.y)).map((x) => ({ x: x.x, y: x.y, widthMm: x.widthMm > 0 ? x.widthMm : CROSSOVER_MM, auto: false }));
  const b = lot?.boundary;
  const fe = lot?.frontEdges;
  if (!Array.isArray(b) || b.length < 3 || !Array.isArray(fe) || !fe.length) return [];
  let best = null;
  let bestAny = null;
  for (const run of runs) {
    const l = len(sub(run.b, run.a));
    const n = Math.max(1, Math.ceil(l / 500));
    for (let k = 0; k <= n; k++) {
      const p = lerp(run.a, run.b, k / n);
      for (const ei of fe) {
        const s0 = b[ei];
        const s1 = b[(ei + 1) % b.length];
        if (!s0 || !s1) continue;
        const { d, q } = distToSeg(p, s0, s1);
        if (!bestAny || d < bestAny.d) bestAny = { d, p, run };
        if (dot(run.outN, sub(q, p)) <= 0) continue; // prefer a kerb that faces the street
        if (!best || d < best.d) best = { d, p, run };
      }
    }
  }
  const pick = best || bestAny; // when no kerb faces the street the nearest one marks the access
  return pick ? [{ x: pick.p.x, y: pick.p.y, widthMm: CROSSOVER_MM, auto: true, run: pick.run }] : [];
}

/**
 * Kerbs along the vehicle pavement edges that meet open ground (landscaping): barrier kerb and gutter, with layback at crossovers.
 * Edges against a building, another pavement or a footpath get no kerb (footpath edges are flush, bays are protected by wheel stops).
 * Each kerb: { id, type, polyline: [a, b], areaId, lengthMm, auto, crossover }. Polyline convention: n = (-dy, dx) / length points to
 * the landscaping side, the pavement is on the other side.
 */
export function buildKerbs(commercial, areas, lot = null) {
  const c = commercial || {};
  const buildings = (c.rows || []).map((r) => rowPoly(r, c.rows));
  const runs = [];
  for (const area of areas) {
    if (!isVehicular(area.type)) continue;
    const others = areas.filter((o) => o !== area);
    const pieces = classifyEdges(area, others, buildings);
    // merge consecutive open pieces of the same edge into one run
    let cur = null;
    const flush = () => { if (cur) { runs.push(cur); cur = null; } };
    for (const p of pieces) {
      if (p.out !== 'open') { flush(); continue; }
      if (cur && cur.edge === p.edge && len(sub(cur.b, p.a)) < 2) { cur.b = p.b; continue; }
      flush();
      cur = { areaId: area.id, edge: p.edge, a: p.a, b: p.b, outN: p.outN };
    }
    flush();
  }
  const xovers = autoCrossovers(runs, lot, c);
  const kerbs = [];
  const counter = new Map();
  for (const run of runs) {
    // orient the run so that n = (-dy, dx) points outward
    const dir = { x: run.outN.y, y: -run.outN.x };
    const e = sub(run.b, run.a);
    const [a, b] = dot(dir, e) >= 0 ? [run.a, run.b] : [run.b, run.a];
    const L = len(sub(b, a));
    const u = { x: (b.x - a.x) / L, y: (b.y - a.y) / L };
    const cuts = [];
    for (const xo of xovers) {
      if (xo.run && xo.run !== run) continue; // an automatic crossover belongs to the one run it was placed on
      const rel = sub(xo, a);
      const along = dot(rel, u);
      const perp = Math.abs(rel.x * u.y - rel.y * u.x);
      if (perp > 4000) continue;
      let t0 = Math.max(0, along - xo.widthMm / 2);
      let t1 = Math.min(L, along + xo.widthMm / 2);
      if (xo.run) { t0 = Math.max(0, Math.min(along - xo.widthMm / 2, L - xo.widthMm)); t1 = Math.min(L, t0 + xo.widthMm); } // keep the whole width on the run
      if (t1 - t0 > 50) cuts.push([t0, t1, xo]);
    }
    cuts.sort((p, q) => p[0] - q[0]);
    const segs = [];
    let at = 0;
    for (const [t0, t1] of cuts) {
      if (t0 > at + 1) segs.push([at, t0, false]);
      segs.push([Math.max(t0, at), t1, true]);
      at = Math.max(at, t1);
    }
    if (at < L - 1) segs.push([at, L, false]);
    if (!segs.length) segs.push([0, L, false]);
    for (const [t0, t1, cross] of segs) {
      if (t1 - t0 < 1) continue;
      const k = counter.get(`${run.areaId}:${run.edge}`) || 0;
      counter.set(`${run.areaId}:${run.edge}`, k + 1);
      const pa = { x: a.x + u.x * t0, y: a.y + u.y * t0 };
      const pb = { x: a.x + u.x * t1, y: a.y + u.y * t1 };
      kerbs.push({ id: `kerb:${run.areaId}:${run.edge}:${k}`, type: cross ? KERB_DEFAULTS.crossover : KERB_DEFAULTS.edge, polyline: [pa, pb], areaId: run.areaId, lengthMm: t1 - t0, auto: true, crossover: cross });
    }
  }
  // overrides
  const over = Array.isArray(c.kerbs) ? c.kerbs : [];
  const byId = new Map(kerbs.map((k) => [k.id, k]));
  const removed = new Set();
  let n = 0;
  for (const o of over) {
    if (!o) continue;
    const k = o.id ? byId.get(o.id) : null;
    if (k) {
      if (o.type === 'none') { removed.add(k.id); continue; }
      if (isKerbType(o.type)) { k.type = o.type; k.overridden = true; }
      if (Array.isArray(o.polyline) && o.polyline.length >= 2) { k.polyline = o.polyline; k.lengthMm = polyLen(o.polyline); k.overridden = true; }
    } else if (isKerbType(o.type) && Array.isArray(o.polyline) && o.polyline.length >= 2) {
      kerbs.push({ id: o.id || `kerb:extra:${n++}`, type: o.type, polyline: o.polyline, areaId: null, lengthMm: polyLen(o.polyline), auto: false, overridden: true, crossover: false });
    }
  }
  return kerbs.filter((k) => !removed.has(k.id));
}

const polyLen = (pl) => { let s = 0; for (let i = 0; i + 1 < pl.length; i++) s += len(sub(pl[i + 1], pl[i])); return s; };

// Wheel stops and markings -----------------------------------------------------------------------------------------------------------

/** Wheel stops at every bay whose far end meets a footpath. */
export function buildWheelStops(commercial, areas) {
  const c = commercial || {};
  const park = parkingLayout(c);
  const foot = areas.filter((a) => isPedestrianArea(a.type));
  const items = [];
  if (!foot.length) return items;
  for (const pr of park.rows) {
    const fr = pr.frame;
    const ang = rowAngleDeg(fr);
    const off = pr.extra ? pr.off : bayOffsetMm(c.parking);
    pr.slots.forEach((s, i) => {
      if (s.kind === 'zone') return;
      const far = pr.depth + off + c.parking.bayL;
      const probe = rowPoint(fr, (i + 0.5) * c.parking.bayW, far + 100);
      if (!foot.some((a) => pointInPoly(probe, a.polygon))) return;
      const at = rowPoint(fr, (i + 0.5) * c.parking.bayW, far - WHEEL_STOP.fromBayEndMm);
      items.push({ id: `wheelstop:${pr.rowId}:${i}`, type: 'wheel-stop', x: at.x, y: at.y, rotationDeg: ang + 90, rowId: pr.rowId });
    });
  }
  return items;
}

/** Marking items from the layout: bay lines, accessible symbols and zone hatch, the pedestrian crossing, plus project.commercial.markings. */
export function buildMarkings(commercial) {
  const c = commercial || {};
  const park = parkingLayout(c);
  const items = [];
  if (c.parking?.enabled !== false && park.rows.length) {
    const offAll = bayOffsetMm(c.parking);
    const { bayW, bayL, aisleMm } = c.parking;
    const apron = Math.max(0, offAll - (Number(aisleMm) || 0));
    for (const pr of park.rows) {
      if (!pr.slots.length) continue;
      const off = pr.extra ? pr.off : offAll;
      const fr = pr.frame;
      const ang = rowAngleDeg(fr);
      const n = pr.slots.length;
      const lines = [];
      for (let i = 0; i <= n; i++) lines.push([rowPoint(fr, i * bayW, pr.depth + off), rowPoint(fr, i * bayW, pr.depth + off + bayL)]);
      const bays = pr.slots.filter((s) => s.kind !== 'zone').length;
      items.push({ id: `baylines:${pr.rowId}`, type: 'bay-lines', lines, count: bays, rowId: pr.rowId });
      pr.slots.forEach((s, i) => {
        if (s.kind === 'accessible') {
          // symbol near the rear half of the bay, upright to the row
          const at = rowPoint(fr, (i + 0.5) * bayW, pr.depth + off + bayL * 0.55);
          items.push({ id: `access:${pr.rowId}:${i}`, type: 'accessible-symbol', x: at.x, y: at.y, rotationDeg: ang, rowId: pr.rowId });
        } else if (s.kind === 'zone') {
          items.push({ id: `zone:${pr.rowId}:${i}`, type: 'accessible-hatch', polygon: s.poly, x: s.centre.x, y: s.centre.y, rotationDeg: ang, rowId: pr.rowId });
        }
      });
    }
    // pedestrian crossing over the car aisle on the accessible path of travel
    const aisleDepth = offAll - apron;
    const home = park.entry ? park.rows.find((r) => r.rowId === park.entry.rowId) : null;
    if (home && park.path && aisleDepth >= 3000) {
      const fr = home.frame;
      const along = (park.path[0].x - fr.o.x) * fr.u.x + (park.path[0].y - fr.o.y) * fr.u.y;
      const at = rowPoint(fr, along, home.depth + apron + aisleDepth / 2);
      items.push({ id: `crossing:${home.rowId}`, type: 'ped-crossing', x: at.x, y: at.y, rotationDeg: rowAngleDeg(fr), lengthMm: aisleDepth, widthMm: 2400, rowId: home.rowId });
    }
  }
  const swm = siteWorksOf(c);
  if (swm?.bayRows && c.parking?.enabled !== false) {
    for (const r of swm.bayRows) {
      if (!r.slots.length) continue;
      const lines = [];
      for (const sl of r.slots) {
        const [p0, p1, p2, p3] = sl.poly;
        const long01 = len(sub(p1, p0)) > len(sub(p3, p0));
        lines.push(long01 ? [p0, p1] : [p0, p3], long01 ? [p3, p2] : [p1, p2]);
      }
      items.push({ id: `baylines:${r.rowId}`, type: 'bay-lines', lines, count: r.slots.filter((x) => x.kind !== 'zone').length, rowId: r.rowId });
      r.slots.forEach((sl, i) => {
        if (sl.kind === 'accessible') items.push({ id: `access:${r.rowId}:${i}`, type: 'accessible-symbol', x: sl.centre.x, y: sl.centre.y, rotationDeg: 0, rowId: r.rowId });
        else if (sl.kind === 'zone') items.push({ id: `zone:${r.rowId}:${i}`, type: 'accessible-hatch', polygon: sl.poly, x: sl.centre.x, y: sl.centre.y, rotationDeg: 0, rowId: r.rowId });
      });
    }
  }
  (Array.isArray(c.markings) ? c.markings : []).forEach((m, i) => {
    if (m && isMarkingType(m.type) && Number.isFinite(m.x) && Number.isFinite(m.y)) items.push({ id: m.id || `marking:${i}`, rotationDeg: 0, ...m, manual: true });
  });
  return items;
}

// The whole model -------------------------------------------------------------------------------------------------------------------

/**
 * pavementModel(commercial, lot?) -> { areas, kerbs, markings, wheelStops, items, quantities }.
 * `items` is markings plus wheel stops (everything drawn as a marking or fixed item). Quantities: area by type, kerb length by type and
 * marking counts, each with the rate key.
 */
export function pavementModel(commercial, lot = null) {
  const c = commercial || {};
  const areas = pavementAreas(c);
  const kerbs = buildKerbs(c, areas, lot);
  const wheelStops = buildWheelStops(c, areas);
  const markings = buildMarkings(c);
  const items = [...markings, ...wheelStops];
  const net = netAreasM2(areas);
  for (const a of areas) a.areaM2 = net.get(a.id) || 0;
  const byType = new Map();
  for (const a of areas) {
    const t = pavementById(a.type);
    const e = byType.get(a.type) || { type: a.type, label: t.label, rateKey: t.rateKey, areaM2: 0, areas: 0 };
    e.areaM2 += a.areaM2; e.areas += 1;
    byType.set(a.type, e);
  }
  const kByType = new Map();
  for (const k of kerbs) {
    const t = kerbById(k.type);
    const e = kByType.get(k.type) || { type: k.type, label: t.label, rateKey: t.rateKey, lengthM: 0, count: 0 };
    e.lengthM += k.lengthMm / 1000; e.count += 1;
    kByType.set(k.type, e);
  }
  const mByType = new Map();
  for (const it of items) {
    const m = markingById(it.type);
    const rateKey = m.rateKey;
    const key = it.type;
    const e = mByType.get(key) || { type: key, label: m.label, rateKey, unit: m.unit, count: 0 };
    e.count += it.count ?? 1;
    mByType.set(key, e);
  }
  const order = (list, ids) => [...list.values()].sort((p, q) => ids.indexOf(p.type) - ids.indexOf(q.type));
  const quantities = {
    byType: order(byType, PAVEMENTS.map((p) => p.id)),
    totalAreaM2: [...byType.values()].reduce((s, e) => s + e.areaM2, 0),
    kerbByType: order(kByType, KERBS.map((k) => k.id)),
    totalKerbM: [...kByType.values()].reduce((s, e) => s + e.lengthM, 0),
    markings: order(mByType, MARKINGS.map((m) => m.id)),
    wheelStops: wheelStops.length,
  };
  return { areas, kerbs, markings, wheelStops, items, quantities };
}

// Cost ------------------------------------------------------------------------------------------------------------------------------

const rateOf = (group, key, overrides) => {
  const r = rates[group]?.[key];
  if (!r) return null;
  const ov = overrides?.[key];
  return { low: r.low, value: Number.isFinite(ov) && ov >= 0 ? ov : r.value, high: r.high, unit: r.unit, status: Number.isFinite(ov) && ov >= 0 ? 'EDITED' : r.status, basis: r.basis, sources: r.sources || [] };
};

/** Footprint of the buildings in m2 (ground floor, from the layout). */
export const footprintM2 = (commercial) => layoutUnits(commercial).reduce((s, u) => s + (u.w * u.d) / 1e6, 0);

/**
 * pavementCost(commercial, { lot, rates }) -> { lines, groups: { pavements, kerbs, markings, allowances }, value, low, high, model }.
 * Each line: { group, key, label, qty, unit, rate, low, high, status, cost, costLow, costHigh }. `rates` overrides rate values by key.
 * The allowances (drainage and detention per m2 of hardstand, building pad and services per m2 of footprint) are included so the total can
 * stand in for a flat site works rate.
 */
export function pavementCost(commercial, { lot = null, rates: ov = null, model = null, allowances = true } = {}) {
  const m = model || pavementModel(commercial, lot);
  const lines = [];
  const add = (group, key, label, qty, unit, rk, groupKey) => {
    const r = rateOf(groupKey, rk, ov);
    if (!r || !(qty > 0)) return;
    lines.push({ group, key, label, qty, unit, rate: r.value, low: r.low, high: r.high, status: r.status, cost: qty * r.value, costLow: qty * r.low, costHigh: qty * r.high });
  };
  for (const e of m.quantities.byType) add('pavements', e.type, e.label, e.areaM2, 'm2', e.rateKey, 'pavements');
  for (const e of m.quantities.kerbByType) add('kerbs', e.type, e.label, e.lengthM, 'm', e.rateKey, 'kerbs');
  for (const e of m.quantities.markings) add('markings', e.type, e.label, e.count, e.unit, e.rateKey, 'markings');
  const hard = m.quantities.totalAreaM2;
  const foot = footprintM2(commercial);
  if (allowances) {
    add('allowances', 'drainage-detention', 'Drainage and detention allowance', hard, 'm2 hardstand', 'drainage-detention', 'allowances');
    add('allowances', 'pad-services', 'Building pad and services allowance', foot, 'm2 footprint', 'pad-services', 'allowances');
  }
  const sum = (g, k = 'cost') => lines.filter((l) => !g || l.group === g).reduce((s, l) => s + l[k], 0);
  const groups = { pavements: sum('pavements'), kerbs: sum('kerbs'), markings: sum('markings'), allowances: sum('allowances') };
  return { lines, groups, value: sum(null), low: sum(null, 'costLow'), high: sum(null, 'costHigh'), hardstandM2: hard, footprintM2: foot, model: m };
}

/**
 * Site works cost for feasibility, to replace the flat `siteRate x developed area` line when a layout has pavements:
 *   { available, value, low, high, perM2: value / (hardstand + footprint), lines, groups, hardstandM2, footprintM2, status, note }
 * `available` is false when the layout has nothing to price. Values are AUD ex GST and carry status ESTIMATE.
 */
export function siteWorksCost(commercial, lot = null, opts = {}) {
  const pc = pavementCost(commercial, { lot, rates: opts.rates || null });
  const base = pc.hardstandM2 + pc.footprintM2;
  const available = pc.lines.length > 0 && pc.hardstandM2 > 0;
  return {
    available,
    value: pc.value,
    low: pc.low,
    high: pc.high,
    perM2: base > 0 ? pc.value / base : 0,
    lines: pc.lines,
    groups: pc.groups,
    hardstandM2: pc.hardstandM2,
    footprintM2: pc.footprintM2,
    status: 'ESTIMATE',
    dataDate: DATA_DATE,
    note: `Built up from pavement, kerb and marking quantities with allowances for drainage, detention, the building pad and services. ${RATES_CAVEAT}`,
  };
}

// Plan set blocks -------------------------------------------------------------------------------------------------------------------

const money = (v) => `$${Math.round(v).toLocaleString('en-AU')}`;
const fmt = (v, d = 1) => (Math.round(v * 10 ** d) / 10 ** d).toLocaleString('en-AU', { minimumFractionDigits: d, maximumFractionDigits: d });

/**
 * Plan legend for C101: the pavement types, kerb types and markings in use, each with the swatch data the sheet draws.
 * { title, note, items: [{ kind, id, label, swatch }] } where swatch is { fill, line, hatch } for pavements, { lines } for kerbs and
 * { colour } for markings.
 */
export function planLegend(commercial, lot = null, model = null) {
  const m = model || pavementModel(commercial, lot);
  const items = [];
  for (const e of m.quantities.byType) {
    const p = pavementById(e.type);
    items.push({ kind: 'pavement', id: p.id, label: p.short, swatch: { fill: p.hatch2d.fill, line: p.hatch2d.line, hatch: p.hatch2d.pattern, colour: p.colour } });
  }
  for (const e of m.quantities.kerbByType) {
    const k = kerbById(e.type);
    items.push({ kind: 'kerb', id: k.id, label: k.short, swatch: { lines: k.plan.lines, label: k.plan.label, colour: k.colour } });
  }
  for (const e of m.quantities.markings) {
    const mk = markingById(e.type);
    items.push({ kind: 'marking', id: mk.id, label: mk.label, swatch: { colour: mk.colour } });
  }
  return { title: 'PAVEMENT LEGEND', note: MAKEUP_NOTE, items };
}

/**
 * Pavement schedule for C101 (quantities) and C103 (with cost). { title, note, sections: [{ id, title, head, rows, total }], lines, notes }.
 * opts.costs adds the rate and cost columns. Rows are arrays of strings ready for a table.
 */
export function pavementSchedule(commercial, lot = null, opts = {}) {
  const model = opts.model || pavementModel(commercial, lot);
  const q = model.quantities;
  const costs = !!opts.costs;
  const pc = costs ? pavementCost(commercial, { lot, model }) : null;
  const line = (key, group) => pc?.lines.find((l) => l.group === group && l.key === key) || null;
  const sections = [];
  const pavRows = q.byType.map((e) => {
    const l = line(e.type, 'pavements');
    return [pavementById(e.type).short, makeUpShort(e.type), fmt(e.areaM2), ...(costs ? [l ? money(l.rate) : '', l ? money(l.cost) : ''] : [])];
  });
  sections.push({ id: 'pavements', title: 'Pavements', head: ['Type', 'Make-up (indicative), mm', 'Area m2', ...(costs ? ['Rate per m2', 'Cost'] : [])], rows: pavRows, total: ['Total', '', fmt(q.totalAreaM2), ...(costs ? ['', money(pc.groups.pavements)] : [])] });
  const kRows = q.kerbByType.map((e) => {
    const l = line(e.type, 'kerbs');
    return [kerbById(e.type).short, `${fmt(e.lengthM)} m`, ...(costs ? [l ? money(l.rate) : '', l ? money(l.cost) : ''] : [])];
  });
  sections.push({ id: 'kerbs', title: 'Kerbs', head: ['Type', 'Length', ...(costs ? ['Rate per m', 'Cost'] : [])], rows: kRows, total: ['Total', `${fmt(q.totalKerbM)} m`, ...(costs ? ['', money(pc.groups.kerbs)] : [])] });
  const mRows = q.markings.map((e) => {
    const l = line(e.type, 'markings');
    return [e.label, `${e.count} ${e.unit === 'bay' ? 'bays' : 'items'}`, ...(costs ? [l ? money(l.rate) : '', l ? money(l.cost) : ''] : [])];
  });
  sections.push({ id: 'markings', title: 'Markings and fixed items', head: ['Item', 'Count', ...(costs ? ['Rate each', 'Cost'] : [])], rows: mRows, total: costs ? ['Total', '', '', money(pc.groups.markings)] : null });
  if (costs) {
    const al = pc.lines.filter((l) => l.group === 'allowances');
    sections.push({ id: 'allowances', title: 'Allowances', head: ['Item', 'Quantity', 'Rate', 'Cost'], rows: al.map((l) => [l.label, `${fmt(l.qty)} ${l.unit}`, money(l.rate), money(l.cost)]), total: ['Total site works', '', '', money(pc.value)] });
  }
  const notes = [MAKEUP_NOTE + '.', 'Kerb and marking lengths and counts are taken from the layout, check with council for the kerb and line marking standards.'];
  if (costs) notes.push(`${RATES_CAVEAT} Rates as at ${DATA_DATE}, ex GST.`);
  return { title: 'PAVEMENT SCHEDULE', note: MAKEUP_NOTE, sections, notes, cost: pc ? { value: pc.value, low: pc.low, high: pc.high } : null, model };
}

export { PAVEMENTS, KERBS, MARKINGS };
