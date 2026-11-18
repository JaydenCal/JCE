// SECTIONS for the commercial plan set (sheet family C300): one sheet per catalogue building or strata unit row, with a section across the short axis
// (A) and, when the footprint is 6 m or more each way, one along the long axis (B). The cut model is analytic and testable without a PDF:
// walls and slabs are cut where the plane crosses the 3D model's walls and rooms, the roof is the 3D roof along the cut line, props are cut where the plane
// passes through them, the ground is the levels model (natural and finished surface). Levels are indicative. Concept only.
//
// Everything here is in target local millimetres: x along the frontage, y from the street face to the rear, z up from the ground floor.
// The section is read with the front at the LEFT for an across cut and the left end at the left for an along cut.

import * as G from '../../../model/geometry.js';
import { facadeLayout, PARTY_WALL_MM, unitWidths } from '../../../commercial/layout.js';
import { PEN, haloText, dimLine, hatch, polygon, clean } from '../eng/kit.js';
import { VP } from './site.js';
import { viewTargets, toWorld, toLocal, roofRiseAt } from './commercial-targets.js';
import { rlText } from './levels.js';

export const SECTION_SCALES = [20, 25, 30, 40, 50, 75, 100, 125, 150, 200, 250, 300, 400];
const GREY = [120, 124, 132];
const TXT = 5.6;
const TAG_W = 40;
const SLAB_GROUND = 150;
const SLAB_UPPER = 300;
export const SECTION_NOTE = 'Indicative concept section. Structure, footings, slab thickness, roof framing and levels are assumed for presentation and are not designed. To be designed and checked by suitably qualified persons.';

const handed = (t) => Math.sign(t.frame.u.x * t.frame.rear.y - t.frame.u.y * t.frame.rear.x) || 1;
const hasMezz = (t) => (t.kind === 'row' ? !!t.mezz : t.floors.some((f) => f.upper));

/** The section planes of a target: [{ id: 0|1, axis, at, s0, s1, beyond, label }]. axis 'y' cuts across (the line runs front to rear at x = at). Letters are given by sheetLetters(). */
export function sectionPlanes(t) {
  const across = t.L >= t.D ? 'y' : 'x';
  const planes = [];
  const wallsLocal = localWalls(t);
  const nudge = (axis, want) => {
    // A plane never runs along an interior wall: within 300 mm of a parallel wall the cut moves by up to 1.2 m.
    const par = wallsLocal.filter((w) => w.kind === 'interior' && (axis === 'y' ? Math.abs(w.a.x - w.b.x) < 1 : Math.abs(w.a.y - w.b.y) < 1));
    const pos = (w) => (axis === 'y' ? w.a.x : w.a.y);
    for (const dlt of [0, 300, -300, 600, -600, 900, -900, 1200, -1200]) {
      const c = want + dlt;
      if (par.every((w) => Math.abs(pos(w) - c) > 300 + (w.thickness || 100) / 2)) return c;
    }
    return want;
  };
  const centreOf = (axis) => {
    const len = axis === 'y' ? t.L : t.D;
    // preference: through a mezzanine or upper floor, else the largest door, else the centre
    const up = (c) => (axis === 'y' ? c.x : c.y);
    if (t.kind === 'row' && t.mezz) {
      const m = t.mezz;
      if (axis === 'y') return m.x0Mm + m.widthMm / 2;
      return m.position === 'rear' ? t.D - m.depthMm / 2 : m.depthMm / 2;
    }
    if (t.kind === 'row' && axis === 'y') { const lay = facadeLayout({ ...t.unit, widthMm: t.unit.widthMm }); if (lay.doors[0]) return lay.doors[0].offset; }
    const upper = t.floors.find((f) => f.upper);
    if (upper) {
      const rooms = (upper.level.rooms || []).filter((r) => r.building === t.building?.id && r.polygon?.length >= 3);
      if (rooms.length) { const c = G.polygonCentroid(rooms[0].polygon.map((p) => toLocal(t, p))); if (up(c) > 0 && up(c) < len) return up(c); }
    }
    if (t.kind === 'building' && axis === 'y') {
      const front = (t.levels[0].level.openings || []).filter((o) => o.kind === 'roller_door' || o.kind === 'garage_door').sort((a, b) => b.width - a.width)[0];
      const w = front && (t.levels[0].level.walls || []).find((x) => x.id === front.wallId);
      if (w) { const p = toLocal(t, G.pointOnWall(w, front.offset)); if (Math.abs(p.y) < 1 && p.x > 0 && p.x < t.L) return p.x; }
    }
    return len / 2;
  };
  const make = (axis, i) => {
    const at = nudge(axis, centreOf(axis));
    const h = handed(t);
    const beyond = axis === 'y' ? (h > 0 ? 1 : -1) : (h > 0 ? -1 : 1); // the side of the cut (in the other axis) the view looks toward
    return { id: i, axis, at, beyond, along: axis === 'y' ? t.D : t.L };
  };
  planes.push(make(across, 0));
  if (t.L >= 6000 && t.D >= 6000) planes.push(make(across === 'y' ? 'x' : 'y', 1));
  return planes;
}

/** Letters run through the set: B1 has A-A and B-B, B2 has C-C and D-D. Returns Map(targetKey -> ['A', 'B']). */
export function sectionLetters(targets) {
  const m = new Map();
  let k = 0;
  const letter = (n) => String.fromCharCode(65 + (n % 26));
  for (const t of targets) { const ps = sectionPlanes(t); m.set(t.key, ps.map(() => letter(k++))); }
  return m;
}

/** The walls of a target in local mm: [{ a, b, thickness, kind, z0, z1, openings: [{ offset (centre along a to b), width, height, sill, kind }], level }]. */
export function localWalls(t) {
  const out = [];
  if (t.open) return out;
  if (t.kind === 'building') {
    for (const f of t.floors) {
      for (const w of (f.level.walls || []).filter((x) => x.building === t.building.id)) {
        const H = Number(w.height) || f.h;
        out.push({ a: toLocal(t, w.a), b: toLocal(t, w.b), thickness: Number(w.thickness) || 150, kind: w.kind === 'exterior' ? 'exterior' : 'interior', z0: f.z, z1: f.z + H, openings: (f.level.openings || []).filter((o) => o.wallId === w.id).map((o) => ({ offset: o.offset, width: o.width, height: o.height, sill: o.sill || 0, kind: o.kind })), level: f.name });
      }
    }
    return out;
  }
  // Strata rows: front, rear and end walls plus the party walls between units, from the unit specs.
  const H = t.levels[0].h;
  const ws = unitWidths(t.row, t.rows);
  const lay = facadeLayout({ ...t.unit, widthMm: ws[0] });
  const front = [...lay.doors.map((d) => ({ offset: d.offset, width: d.w, height: d.h, sill: 0, kind: 'roller_door' })), ...(lay.personnel ? [{ offset: lay.personnel.offset, width: lay.personnel.w, height: lay.personnel.h, sill: 0, kind: 'door' }] : []), ...(lay.window ? [{ offset: lay.window.offset, width: lay.window.w, height: lay.window.h, sill: lay.window.sill || 0, kind: 'window' }] : [])];
  out.push({ a: { x: 0, y: 0 }, b: { x: t.L, y: 0 }, thickness: 200, kind: 'exterior', z0: 0, z1: H, openings: front, level: 'Ground' });
  out.push({ a: { x: 0, y: t.D }, b: { x: t.L, y: t.D }, thickness: t.pair ? 2 * PARTY_WALL_MM : 200, kind: 'exterior', z0: 0, z1: H, openings: [], level: 'Ground' });
  let x = 0;
  for (let i = 0; i <= ws.length; i++) {
    out.push({ a: { x, y: 0 }, b: { x, y: t.D }, thickness: PARTY_WALL_MM, kind: i === 0 || i === ws.length ? 'exterior' : 'interior', z0: 0, z1: H, openings: [], level: 'Ground' });
    x += ws[i] || 0;
  }
  return out;
}

/** The room outlines of a target by floor, in local mm: [{ name, z, poly }]. */
function localRooms(t) {
  const out = [];
  if (t.kind === 'building') {
    for (const f of t.floors) for (const r of (f.level.rooms || []).filter((x) => x.building === t.building.id && x.polygon?.length >= 3)) out.push({ name: String(r.name || '').replace(/^PROPOSED /i, ''), z: f.z, poly: r.polygon.map((p) => toLocal(t, p)) });
  }
  return out;
}

/** Intervals [s0, s1] where a local polygon crosses a cut line (axis 'y': x = at, s = y; axis 'x': y = at, s = x). */
function polyCut(poly, axis, at) {
  const xs = [];
  const c = (p) => (axis === 'y' ? p.x : p.y);
  const s = (p) => (axis === 'y' ? p.y : p.x);
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]; const b = poly[(i + 1) % poly.length];
    if ((c(a) < at) === (c(b) < at)) continue;
    const k = (at - c(a)) / (c(b) - c(a));
    xs.push(s(a) + (s(b) - s(a)) * k);
  }
  xs.sort((p, q) => p - q);
  const out = [];
  for (let i = 0; i + 1 < xs.length; i += 2) out.push([xs[i], xs[i + 1]]);
  return out;
}

const mergeIntervals = (list) => {
  const a = list.slice().sort((p, q) => p[0] - q[0]);
  const out = [];
  for (const iv of a) { const l = out.at(-1); if (l && iv[0] <= l[1] + 1) l[1] = Math.max(l[1], iv[1]); else out.push([...iv]); }
  return out;
};

const fflOf = (t, levels) => (levels?.fflOf ? levels.fflOf(t.outline) : 100);

/**
 * The cut of one plane: { extent: { s0, s1, z0, z1 }, ground: { natural, design }, floors, walls, ceilings, roof, props, beyond, tags, dims, rooms }.
 * s runs left to right on the sheet in mm along the cut line (see the file header); z is mm above this target's floor level.
 */
export function sectionModel(t, plane, levels = null) {
  const { axis, at } = plane;
  const walls = localWalls(t);
  const sOf = (p) => (axis === 'y' ? p.y : p.x);
  const cOf = (p) => (axis === 'y' ? p.x : p.y);
  const alongLen = plane.along;
  const cut = [];
  const beyondWalls = [];
  for (const w of walls) {
    const dc = cOf(w.b) - cOf(w.a);
    const ds = sOf(w.b) - sOf(w.a);
    const len = Math.hypot(dc, ds);
    if (len < 1) continue;
    if (Math.abs(dc) < 1) {
      // The wall runs along the cut line: seen beyond the plane when it is on the viewing side.
      const side = Math.sign(cOf(w.a) - at);
      if (side === plane.beyond && w.kind === 'exterior') beyondWalls.push(w);
      continue;
    }
    const k = (at - cOf(w.a)) / dc;
    if (k < 0 || k > 1) continue;
    const s = sOf(w.a) + ds * k;
    const thk = (w.thickness || 150) / Math.max(0.3, Math.abs(dc) / len);
    const pos = k * len;
    const voids = w.openings.filter((o) => pos >= o.offset - o.width / 2 && pos <= o.offset + o.width / 2).map((o) => ({ z0: w.z0 + o.sill, z1: w.z0 + o.sill + o.height, kind: o.kind }));
    cut.push({ s0: s - thk / 2, s1: s + thk / 2, z0: w.z0, z1: w.z1, kind: w.kind, system: w.kind === 'exterior' ? t.spec.system : 'framed', openings: voids });
  }
  // Ground slab
  const ext = cut.filter((w) => w.kind === 'exterior');
  const sMinW = ext.length ? Math.min(...ext.map((w) => w.s0)) : 0;
  const sMaxW = ext.length ? Math.max(...ext.map((w) => w.s1)) : alongLen;
  const floors = [{ name: t.floors[0]?.name || 'Ground', z: 0, s0: sMinW, s1: sMaxW, slabMm: SLAB_GROUND, rl: null }];
  // Upper floors: partial slabs where a room of the level crosses the cut
  const rooms = localRooms(t);
  const sections = [];
  for (const f of t.floors.filter((x) => x.upper)) {
    const ivs = mergeIntervals(rooms.filter((r) => Math.abs(r.z - f.z) < 1).flatMap((r) => polyCut(r.poly, axis, at)));
    const hasRooms = rooms.some((r) => Math.abs(r.z - f.z) < 1);
    for (const [a, b] of ivs.length ? ivs : hasRooms ? [] : [[sMinW, sMaxW]]) floors.push({ name: f.name, z: f.z, s0: Math.max(sMinW, a), s1: Math.min(sMaxW, b), slabMm: SLAB_UPPER, rl: null });
  }
  if (t.kind === 'row' && t.mezz) {
    const m = t.mezz;
    if (axis === 'y' ? at >= m.x0Mm && at <= m.x0Mm + m.widthMm : true) {
      const s0 = axis === 'y' ? (m.position === 'rear' ? t.D - m.depthMm : 0) : m.x0Mm;
      const s1 = axis === 'y' ? (m.position === 'rear' ? t.D : m.depthMm) : m.x0Mm + m.widthMm;
      if (axis === 'y' || (at >= (m.position === 'rear' ? t.D - m.depthMm : 0) && at <= (m.position === 'rear' ? t.D : m.depthMm))) floors.push({ name: 'Mezzanine', z: m.level, s0, s1, slabMm: m.slabMm || SLAB_UPPER, rl: null });
    }
  }
  // Roof along the cut line
  const eave = t.wallTop;
  const N = 48;
  const profile = [];
  for (let i = 0; i <= N; i++) {
    const s = sMinW + ((sMaxW - sMinW) * i) / N;
    const p = axis === 'y' ? { x: at, y: s } : { x: s, y: at };
    const rise = roofRiseAt(t.roof, t.L, t.D, Math.min(t.L, Math.max(0, p.x)), Math.min(t.D, Math.max(0, p.y)));
    profile.push({ s, z: eave + (t.roof.type === 'flat' ? 140 : rise) });
  }
  const ridgeZ = Math.max(...profile.map((p) => p.z));
  const parapets = t.parapetMm > 0 ? [{ s: sMinW, z0: eave, z1: eave + t.parapetMm }, { s: sMaxW, z0: eave, z1: eave + t.parapetMm }] : [];
  const roof = { type: t.roof.type, pitchDeg: t.roof.pitchDeg, profile, sheetMm: 150, parapets, ridgeZ: Math.max(ridgeZ, eave + t.parapetMm), eaveZ: eave };
  // Props
  const props = [];
  for (const p of t.props) {
    const lo = axis === 'y' ? p.x0 : p.y0; const hi = axis === 'y' ? p.x1 : p.y1;
    const s0 = axis === 'y' ? p.y0 : p.x0; const s1 = axis === 'y' ? p.y1 : p.x1;
    const isCut = at >= lo && at <= hi;
    const mid = (lo + hi) / 2;
    const onView = Math.sign(mid - at) === plane.beyond;
    const inside = (p.x0 + p.x1) / 2 > 0 && (p.x0 + p.x1) / 2 < t.L && (p.y0 + p.y1) / 2 > 0 && (p.y0 + p.y1) / 2 < t.D;
    if (isCut) props.push({ s0, s1, z0: p.z0, z1: p.z1, slot: p.slot, cut: true });
    else if (onView && !inside) props.push({ s0, s1, z0: p.z0, z1: p.z1, slot: p.slot, cut: false });
  }
  // Beyond: openings of the exterior wall at the far end, drawn as an elevation behind the cut
  const beyond = [];
  for (const w of beyondWalls) {
    const sa = sOf(w.a); const sb = sOf(w.b);
    const dir = Math.sign(sb - sa) || 1;
    for (const o of w.openings) {
      const c0 = sa + dir * o.offset;
      beyond.push({ s0: c0 - o.width / 2, s1: c0 + o.width / 2, z0: w.z0 + o.sill, z1: w.z0 + o.sill + o.height, kind: o.kind });
    }
    beyond.push({ s0: Math.min(sa, sb), s1: Math.max(sa, sb), z0: w.z0, z1: w.z1, kind: 'wall' });
  }
  // Extent in s: the building plus cut props
  const allS = [sMinW, sMaxW, ...props.filter((p) => p.cut).flatMap((p) => [p.s0, p.s1])];
  const extent = { s0: Math.min(...allS), s1: Math.max(...allS), z0: -300, z1: roof.ridgeZ };
  // Ground
  const ffl = fflOf(t, levels);
  const ground = { natural: [], design: [] };
  const gs0 = extent.s0 - 6000; const gs1 = extent.s1 + 6000;
  const n = Math.max(12, Math.round((gs1 - gs0) / 1000));
  for (let i = 0; i <= n; i++) {
    const s = gs0 + ((gs1 - gs0) * i) / n;
    const w = axis === 'y' ? toWorld(t, at, s) : toWorld(t, s, at);
    const nat = levels?.has ? levels.natural(w) : null;
    const des = levels?.has ? levels.design(w) : null;
    ground.natural.push({ s, z: nat == null ? null : (nat - ffl) * 1000 });
    ground.design.push({ s, z: des == null ? (nat == null ? null : (nat - ffl) * 1000) : (des - ffl) * 1000 });
  }
  if (!levels?.has) { ground.natural = []; ground.design = [{ s: gs0, z: 0 }, { s: gs1, z: 0 }]; }
  else extent.z0 = Math.min(-300, ...ground.design.map((g) => g.z ?? 0), ...ground.natural.map((g) => g.z ?? 0)) - 100;
  // Tags and dimensions
  const assumed = !levels?.has && !levels?.floorSet;
  const rl = (z) => `RL ${rlText(ffl + z / 1000)}`;
  const tags = [{ z: 0, text: `FFL GROUND ${rl(0)}${assumed ? ' (ASSUMED DATUM)' : ''}` }];
  for (const f of [...new Map(floors.filter((x) => x.z > 1).map((x) => [x.z, x])).values()]) tags.push({ z: f.z, text: `FFL ${String(f.name).toUpperCase()} ${rl(f.z)}` });
  tags.push({ z: eave, text: `EAVE ${rl(eave)}` });
  if (t.parapetMm > 0) tags.push({ z: eave + t.parapetMm, text: `TOP OF PARAPET ${rl(eave + t.parapetMm)}` });
  else if (ridgeZ > eave + 80) tags.push({ z: ridgeZ, text: `${t.roof.type === 'gable' ? 'RIDGE' : 'HIGH EDGE OF ROOF'} ${rl(ridgeZ)}` });
  const roomsCut = rooms.flatMap((r) => polyCut(r.poly, axis, at).map(([a, b]) => ({ name: r.name, z: r.z, s0: a, s1: b })));
  if (t.kind === 'row') roomsCut.push({ name: 'UNIT', z: 0, s0: sMinW, s1: sMaxW });
  const extW = ext.slice().sort((a, b) => a.s0 - b.s0);
  const spans = [];
  const cutsAll = cut.slice().sort((a, b) => a.s0 - b.s0);
  for (let i = 0; i + 1 < cutsAll.length; i++) { const a = cutsAll[i].s1; const b = cutsAll[i + 1].s0; if (b - a > 800) spans.push([a, b]); }
  const dims = { overall: [extW[0]?.s0 ?? sMinW, extW.at(-1)?.s1 ?? sMaxW], spans: spans.slice(0, 6), heights: [[0, eave], [0, Math.max(ridgeZ, eave + t.parapetMm)]] };
  void sections; void polyCut;
  return { extent, ground, floors, walls: cut, ceilings: [], roof, props, beyond, tags, dims, rooms: roomsCut, ffl, assumed, axis, at };
}

const sectionExtentFor = (m) => ({ w: m.extent.s1 - m.extent.s0 + 2400, h: m.extent.z1 - m.extent.z0 + 900 });

/** Scale and layout of the section sheet: { scale, boxes: [...], models, planes }. */
export function sectionLayout(t, levels = null) {
  const planes = sectionPlanes(t);
  const models = planes.map((p) => sectionModel(t, p, levels));
  const vw = VP.x1 - VP.x0;
  const vh = VP.y1 - VP.y0;
  const stack = planes.length > 1;
  const cellH = stack ? vh / 2 : vh;
  const aw = vw - TAG_W - 28;
  const ah = cellH - 8 - 16 - 16;
  const need = models.map(sectionExtentFor);
  const scale = SECTION_SCALES.find((s) => need.every((e) => e.w / s <= aw && e.h / s <= ah)) || SECTION_SCALES.at(-1) * 2;
  const boxes = planes.map((_, i) => ({ x0: VP.x0, x1: VP.x1, y0: VP.y0 + (stack ? i * cellH : 0), y1: VP.y0 + (stack ? (i + 1) * cellH : vh) }));
  return { scale, boxes, models, planes };
}

export function sectionScaleOf(t, levels = null) {
  try { return `1:${sectionLayout(t, levels).scale} @ A3`; } catch { return 'NTS'; }
}

const hatchKind = (system) => (system === 'blockwork' ? 'cutBlock' : system === 'framed' ? 'cutFrame' : /metal_clad|metal/.test(system || '') ? 'cutMetal' : 'cutConcrete');

function drawOne(doc, t, model, plane, letter, box, scale, levels, keyPlan) {
  const px = (mm) => mm / scale;
  const ext = model.extent;
  const aw = box.x1 - box.x0 - TAG_W - 28;
  const wMm = ext.s1 - ext.s0;
  const X0 = box.x0 + 22 + Math.max(0, (aw - px(wMm + 2400)) / 2) + px(1200);
  const areaTop = box.y0 + 8;
  const areaBot = box.y1 - 16 - 13;
  const hMm = ext.z1 - ext.z0 + 900;
  const drawH = Math.min(areaBot - areaTop, px(hMm));
  const zeroY = areaTop + (areaBot - areaTop - drawH) / 2 + px(ext.z1 + 500);
  const X = (s) => X0 + px(s - ext.s0);
  const Y = (z) => zeroY - px(z);
  const bounds = { x0: X(ext.s0 - 1200), x1: X(ext.s1 + 1200), y0: Y(ext.z1 + 500), y1: Y(ext.z0) };
  const rectPts = (s0, s1, z0, z1) => [{ x: X(s0), y: Y(z1) }, { x: X(s1), y: Y(z1) }, { x: X(s1), y: Y(z0) }, { x: X(s0), y: Y(z0) }];
  doc.setLineDashPattern([], 0);
  const gx0 = ext.s0 - 1200; const gx1 = ext.s1 + 1200;
  const gz = (arr, s) => { const a = arr.filter((q) => q.z != null); if (!a.length) return 0; let best = a[0]; for (const q of a) if (Math.abs(q.s - s) < Math.abs(best.s - s)) best = q; return best.z; };

  // Ground: fill and cut hatched between natural and finished, earth ticks under the finished line
  const des = model.ground.design.filter((q) => q.s >= gx0 - 1500 && q.s <= gx1 + 1500 && q.z != null);
  const nat = model.ground.natural.filter((q) => q.s >= gx0 - 1500 && q.s <= gx1 + 1500 && q.z != null);
  if (levels?.has && des.length > 1 && nat.length > 1) {
    for (let i = 0; i + 1 < des.length; i++) {
      const a = des[i]; const b = des[i + 1];
      const na = gz(nat, a.s); const nb = gz(nat, b.s);
      if (a.z - na > 20 || b.z - nb > 20) { const q = [{ x: X(a.s), y: Y(a.z) }, { x: X(b.s), y: Y(b.z) }, { x: X(b.s), y: Y(nb) }, { x: X(a.s), y: Y(na) }]; hatch(doc, q, 'cutFill'); }
      else if (na - a.z > 20 || nb - b.z > 20) { const q = [{ x: X(a.s), y: Y(a.z) }, { x: X(b.s), y: Y(b.z) }, { x: X(b.s), y: Y(nb) }, { x: X(a.s), y: Y(na) }]; hatch(doc, q, 'cutCut'); }
    }
    doc.setDrawColor(...GREY); doc.setLineWidth(0.18); doc.setLineDashPattern([1.2, 0.9], 0);
    for (let i = 0; i + 1 < nat.length; i++) doc.line(X(nat[i].s), Y(nat[i].z), X(nat[i + 1].s), Y(nat[i + 1].z));
    doc.setLineDashPattern([], 0);
  }
  doc.setDrawColor(...PEN.ink); doc.setLineWidth(0.5);
  for (let i = 0; i + 1 < des.length; i++) doc.line(X(des[i].s), Y(des[i].z), X(des[i + 1].s), Y(des[i + 1].z));
  doc.setLineWidth(0.1);
  for (let i = 0; i < des.length; i += 1) for (let k = 0; k < 3; k++) { const s = des[i].s + k * 330; const x = X(s); if (x > X(gx0 - 1500) && x < X(gx1 + 1500)) doc.line(x, Y(gz(des, s)), x - 0.9, Y(gz(des, s)) + 1); }

  // Beyond: far wall openings, light
  for (const b of model.beyond) {
    if (b.kind === 'wall') { doc.setFillColor(246, 247, 249); doc.setDrawColor(...PEN.light); doc.setLineWidth(0.13); polygon(doc, rectPts(b.s0, b.s1, b.z0, b.z1), 'FD'); }
  }
  for (const b of model.beyond) {
    if (b.kind === 'wall') continue;
    doc.setFillColor(b.kind === 'window' ? 226 : 236, b.kind === 'window' ? 238 : 238, b.kind === 'window' ? 246 : 238); doc.setDrawColor(...GREY); doc.setLineWidth(0.13);
    polygon(doc, rectPts(b.s0, b.s1, b.z0, b.z1), 'FD');
  }
  for (const p of model.props.filter((q) => !q.cut)) { doc.setFillColor(236, 238, 241); doc.setDrawColor(...GREY); doc.setLineWidth(0.12); polygon(doc, rectPts(p.s0, p.s1, p.z0, p.z1), 'FD'); }

  // Cut: ground slab, floors
  doc.setLineWidth(0.5); doc.setDrawColor(...PEN.ink);
  const cutPoly = (s0, s1, z0, z1, kind) => {
    const q = rectPts(s0, s1, z0, z1);
    doc.setFillColor(255, 255, 255); doc.setDrawColor(...PEN.ink); doc.setLineWidth(0.5);
    polygon(doc, q, 'FD');
    if (px(s1 - s0) >= 1.1 && px(z1 - z0) >= 1.1) { hatch(doc, q, kind); doc.setDrawColor(...PEN.ink); doc.setLineWidth(0.5); polygon(doc, q, 'S'); }
  };
  for (const f of model.floors) cutPoly(f.s0, f.s1, f.z - f.slabMm + (f.z === 0 ? 0 : 0), f.z, 'cutConcrete');
  // Cut walls with openings
  for (const w of model.walls) {
    const kind = hatchKind(w.system);
    const cuts = w.openings.slice().sort((a, b) => a.z0 - b.z0);
    let z = w.z0;
    const parts = [];
    for (const o of cuts) { if (o.z0 > z) parts.push([z, o.z0]); z = Math.max(z, o.z1); }
    if (z < w.z1) parts.push([z, w.z1]);
    for (const [a, b] of parts) cutPoly(w.s0, w.s1, a, b, kind);
  }
  // Roof: the sheet along the profile
  const prof = model.roof.profile;
  const top = prof.map((q) => ({ x: X(q.s), y: Y(q.z) }));
  const bot = prof.slice().reverse().map((q) => ({ x: X(q.s), y: Y(q.z - Math.max(model.roof.sheetMm, 60)) }));
  doc.setFillColor(200, 204, 210); doc.setDrawColor(...PEN.ink); doc.setLineWidth(0.5);
  polygon(doc, [...top, ...bot], 'FD');
  for (const pr of model.roof.parapets) cutPoly(pr.s - 100, pr.s + 100, pr.z0, pr.z1, 'cutConcrete');
  // Roof framing lines (purlins) below the sheet for gable and skillion
  if (model.roof.type !== 'flat') {
    doc.setDrawColor(...GREY); doc.setLineWidth(0.1);
    for (let i = 1; i < prof.length - 1; i += 2) doc.line(X(prof[i].s), Y(prof[i].z - model.roof.sheetMm), X(prof[i].s), Y(prof[i].z - model.roof.sheetMm - 200));
  }
  // Cut props (canopy steel, pump islands, posts)
  for (const p of model.props.filter((q) => q.cut)) { doc.setFillColor(...(p.slot === 'canopy' ? [150, 156, 164] : [60, 64, 72])); doc.setDrawColor(...PEN.ink); doc.setLineWidth(0.3); polygon(doc, rectPts(p.s0, p.s1, p.z0, p.z1), 'FD'); }

  // Space labels
  for (const r of model.rooms.slice(0, 8)) {
    const wmm = r.s1 - r.s0;
    const txt = clean(r.name);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(TXT);
    if (px(wmm) < doc.getTextWidth(txt) + 3) continue;
    haloText(doc, txt, X((r.s0 + r.s1) / 2), Y(r.z + Math.min(1500, (t.wallTop - r.z) * 0.4)), { size: TXT, bold: true, colour: PEN.dim, align: 'center', halo: 0.9 });
  }
  // Level tags
  const lx = X(ext.s1 + 1200) + 4;
  let lastY = Infinity;
  for (const tg of model.tags.slice().sort((a, b) => a.z - b.z)) {
    const y = Y(tg.z);
    doc.setDrawColor(...PEN.dim); doc.setLineWidth(0.12); doc.line(X(ext.s1) + 1, y, lx - 1, y);
    doc.setFillColor(...PEN.dim); doc.triangle(lx - 1, y, lx + 1.2, y - 0.9, lx + 1.2, y + 0.9, 'F');
    const ty = Math.min(y + 1, lastY - 2.4);
    haloText(doc, tg.text, lx + 2.2, ty, { size: TXT, colour: PEN.dim, halo: 0 });
    lastY = ty - 1.4;
  }
  // Surface labels under the ground level tag at the right
  if (levels?.has) haloText(doc, 'NATURAL SURFACE (INDICATIVE), DASHED', lx + 2.2, Y(0) + 3.6, { size: TXT, colour: GREY, halo: 0 });
  haloText(doc, `FINISHED SURFACE (INDICATIVE)${levels?.has ? '' : ', ASSUMED LEVEL'}`, lx + 2.2, Y(0) + (levels?.has ? 7 : 3.6), { size: TXT, colour: PEN.ink, halo: 0 });
  // Dimensions: overall width, clear spans, heights
  const dy = Y(Math.min(ext.z0, -100)) + 3.4;
  dimLine(doc, { x: X(model.dims.overall[0]), y: dy + 6.4 }, { x: X(model.dims.overall[1]), y: dy + 6.4 }, `${((model.dims.overall[1] - model.dims.overall[0]) / 1000).toFixed(2)} m`, { size: TXT, textSide: 1 });
  model.dims.spans.forEach(([a, b], i) => { if (px(b - a) > 12) dimLine(doc, { x: X(a), y: dy }, { x: X(b), y: dy }, `${((b - a) / 1000).toFixed(2)} m clear`, { size: TXT, textSide: -1 }); void i; });
  const hx = X(ext.s0 - 1200) - 3;
  const hs = model.dims.heights;
  dimLine(doc, { x: hx, y: Y(hs[0][0]) }, { x: hx, y: Y(hs[0][1]) }, `${(hs[0][1] / 1000).toFixed(2)} m`, { size: TXT, textSide: -1 });
  for (const f of model.floors.filter((q) => q.z > 1).slice(0, 1)) dimLine(doc, { x: hx - 11, y: Y(0) }, { x: hx - 11, y: Y(f.z) }, `${(f.z / 1000).toFixed(2)} m`, { size: TXT, textSide: -1 });
  if (model.roof.type !== 'flat') haloText(doc, `ROOF PITCH ${model.roof.pitchDeg.toFixed(model.roof.pitchDeg % 1 ? 1 : 0)} DEG`, X((ext.s0 + ext.s1) / 2), Y(model.roof.ridgeZ) - 3, { size: TXT, colour: GREY, align: 'center', halo: 0 });
  // Title and key plan
  haloText(doc, `SECTION ${letter}-${letter}`, box.x0 + 4, box.y1 - 6.2, { size: 8, bold: true, halo: 0 });
  haloText(doc, `${t.tag} ${clean(t.short)}   |   1:${scale} @ A3`, box.x0 + 4, box.y1 - 2.2, { size: TXT, colour: GREY, halo: 0 });
  doc.setDrawColor(...PEN.tag); doc.setLineWidth(0.5); doc.line(box.x0 + 4, box.y1 - 4.8, box.x0 + 44, box.y1 - 4.8);
  keyPlan(doc, t, plane, letter, { x: box.x0 + 90, y: box.y1 - 14, w: 26, h: 12 });
  return bounds;
}

/** A small key plan: the footprint with the cut line and arrows. */
function keyPlanAt(doc, t, plane, letter, r) {
  const L = t.L; const D = t.D;
  const k = Math.min((r.w - 2) / L, (r.h - 2) / D);
  const ox = r.x + (r.w - L * k) / 2; const oy = r.y + (r.h - D * k) / 2;
  doc.setDrawColor(...PEN.ink); doc.setLineWidth(0.25); doc.setFillColor(240, 242, 245);
  doc.rect(ox, oy, L * k, D * k, 'FD');
  doc.setDrawColor(...PEN.tag); doc.setLineWidth(0.4);
  if (plane.axis === 'y') doc.line(ox + plane.at * k, oy - 1, ox + plane.at * k, oy + D * k + 1); else doc.line(ox - 1, oy + plane.at * k, ox + L * k + 1, oy + plane.at * k);
  haloText(doc, letter, plane.axis === 'y' ? ox + plane.at * k : ox - 2.2, plane.axis === 'y' ? oy - 1.6 : oy + plane.at * k + 0.8, { size: TXT, bold: true, colour: PEN.tag, align: 'center', halo: 0 });
  haloText(doc, 'KEY PLAN', r.x + r.w + 2, r.y + r.h / 2 + 1, { size: TXT, colour: GREY, halo: 0 });
}

/** The section sheet of one target. Returns { kv, notes, blocks, bounds, fill, models, scale } for the title strip. */
export function drawSections(doc, model, target, letters, levels = null) {
  const project = model.project;
  const t = target || viewTargets(project)[0];
  const lv = levels || model.levels || null;
  if (!t) return { kv: [], notes: [], blocks: [] };
  const lay = sectionLayout(t, lv);
  const bounds = lay.planes.map((p, i) => drawOne(doc, t, lay.models[i], p, letters?.[i] || String.fromCharCode(65 + i), lay.boxes[i], lay.scale, lv, keyPlanAt));
  const area = (VP.x1 - VP.x0) * (VP.y1 - VP.y0);
  const fill = bounds.reduce((s, b) => s + Math.max(0, b.x1 - b.x0) * Math.max(0, b.y1 - b.y0), 0) / area;
  const m0 = lay.models[0];
  const kv = [
    ['Building', clean(t.label)],
    ['Sections', lay.planes.map((_, i) => `${letters?.[i] || String.fromCharCode(65 + i)}-${letters?.[i] || String.fromCharCode(65 + i)}`).join(', ')],
    ['Scale', `1:${lay.scale} @ A3`],
    ['Floor level', `RL ${rlText(m0.ffl)}${m0.assumed ? ' (assumed)' : ''}`],
    ['Datum', lv?.datumNote || 'Assumed RL 100.00'],
  ];
  const notes = [SECTION_NOTE, m0.assumed ? 'Levels are on an assumed datum (floor level RL 100.00). A registered surveyor must confirm levels.' : 'Levels are indicative, interpolated from the state 5 m elevation model, not survey. A registered surveyor must confirm levels.', 'Section A-A is read with the front of the building at the left.'];
  return { kv, notes, blocks: [], bounds, fill, models: lay.models, scale: lay.scale };
}
