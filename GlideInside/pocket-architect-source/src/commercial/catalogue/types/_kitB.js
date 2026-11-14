// Shared helpers for the batch B building types (self storage, vehicle workshop, portal shed, transport depot, machinery dealership).
// Pure: no DOM, no three import. A type builds one local Plan (building at the origin, front edge along y = 0, depth into +y, plan mm,
// y down) holding walls, openings, rooms and roofs in the exact shapes of src/model/schema.js (as src/commercial/materialise.js emits
// them), plus extras for the 3D and 2D drawing helpers. The Plan is then moved to a place { x, y, rotationDeg }.

import * as S from '../../../model/schema.js';

export const GEN = 'commercial';
export const M = 1000;
export const BANNED_BRANDS = Object.freeze([]);

export const num = (key, label, unit, min, max, step, def) => ({ key, label, type: 'number', unit, min, max, step, default: def });
export const sel = (key, label, options, def) => ({ key, label, type: 'select', options: options.map((o) => (typeof o === 'object' ? o : { value: o, label: String(o) })), default: def });
export const bool = (key, label, def) => ({ key, label, type: 'bool', default: def });

export const defaultsOf = (defs) => Object.fromEntries(defs.map((d) => [d.key, d.default]));

/** Merge params over the defaults, clamp numbers to min/max, fall back on the default for an unknown select value. */
export function resolve(params, defs) {
  const out = {};
  for (const d of defs) {
    const raw = params?.[d.key];
    if (d.type === 'bool') out[d.key] = raw === undefined ? d.default : !!raw;
    else if (d.type === 'select') {
      const hit = d.options.find((o) => String(o.value) === String(raw));
      out[d.key] = hit ? hit.value : d.default;
    } else {
      let v = Number(raw);
      if (raw === undefined || raw === null || raw === '' || !Number.isFinite(v)) v = d.default;
      out[d.key] = Math.min(d.max, Math.max(d.min, v));
    }
  }
  return out;
}

export const polyArea = (poly) => Math.abs(poly.reduce((a, p, i) => { const q = poly[(i + 1) % poly.length]; return a + p.x * q.y - q.x * p.y; }, 0)) / 2;
export const rectPoly = (x0, y0, x1, y1) => [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
const pt = (p) => ({ x: p.x, y: p.y });

export class Plan {
  constructor() {
    this.walls = [];
    this.openings = [];
    this.rooms = [];
    this.roofs = [];
    this.levels = [{ name: 'Ground', elevationMm: 0, heightMm: 3000 }];
    this.outline = [];
    this.extras = []; // { kind, polygon }
    this.props = []; // 3D items, local mm
    this.syms = []; // 2D symbols, local mm
    this.uses = {}; // use -> m2 (indoor rooms)
  }

  level(name, elevationMm, heightMm) {
    const l = this.levels.find((x) => x.name === name);
    if (l) { l.elevationMm = elevationMm; l.heightMm = heightMm; } else this.levels.push({ name, elevationMm, heightMm });
  }

  /** One wall. out is the outward vector (exterior walls); outside is derived from it as in materialise.js. */
  wall(a, b, { kind = 'exterior', thickness = 200, level = 'Ground', height = null, out = null } = {}) {
    const w = S.createWall({ a, b, thickness, height });
    w.kind = kind;
    const n = { x: -(b.y - a.y), y: b.x - a.x };
    w.outside = kind === 'exterior' && out ? Math.sign(n.x * out.x + n.y * out.y) : 0;
    w.auto = false;
    w.generated = GEN;
    w.level = level;
    this.walls.push(w);
    return w;
  }

  /** A rectangle of four walls: front (y0), right, back, left. skip: sides to leave out; kinds: per side kind; heights as height. */
  rect(x0, y0, x1, y1, { kind = 'exterior', thickness = 200, level = 'Ground', height = null, skip = [], kinds = {} } = {}) {
    const side = (name, a, b, out) => (skip.includes(name) ? null : this.wall(a, b, { kind: kinds[name] || kind, thickness, level, height, out }));
    return {
      front: side('front', { x: x0, y: y0 }, { x: x1, y: y0 }, { x: 0, y: -1 }),
      right: side('right', { x: x1, y: y0 }, { x: x1, y: y1 }, { x: 1, y: 0 }),
      back: side('back', { x: x1, y: y1 }, { x: x0, y: y1 }, { x: 0, y: 1 }),
      left: side('left', { x: x0, y: y1 }, { x: x0, y: y0 }, { x: -1, y: 0 }),
    };
  }

  /** An opening centred at the point (px, py) projected onto wall w. Skipped (null) when it would run off the wall. */
  openAt(w, px, py, kind, width, height, sill = 0, extra = {}) {
    if (!w) return null;
    const dx = w.b.x - w.a.x;
    const dy = w.b.y - w.a.y;
    const len = Math.hypot(dx, dy);
    const centre = ((px - w.a.x) * dx + (py - w.a.y) * dy) / len;
    if (centre - width / 2 < -0.5 || centre + width / 2 > len + 0.5) return null;
    const { tag, style, ...rest } = extra;
    const o = S.createOpening({ wallId: w.id, kind, offset: centre, width, height, sill, ...(style ? { style } : {}), ...rest });
    o.auto = true;
    o.generated = GEN;
    o.level = w.level;
    if (tag) o.tag = tag;
    this.openings.push(o);
    return o;
  }

  room(name, type, polygon, { level = 'Ground', use = 'other', balustrade = false } = {}) {
    const r = S.createRoom({ name, type, polygon: polygon.map(pt), balustrade });
    r.auto = true;
    r.generated = GEN;
    r.level = level;
    r.use = use;
    this.rooms.push(r);
    this.uses[use] = (this.uses[use] || 0) + polyArea(polygon) / 1e6;
    return r;
  }

  roof(polygon, type, pitchDeg, level = 'Ground') { this.roofs.push({ polygon: polygon.map(pt), type, pitchDeg, level }); }
  extra(kind, polygon) { this.extras.push({ kind, polygon: polygon.map(pt) }); }
  box(kind, x0, y0, x1, y1, z0, z1, slot, colour) { this.props.push({ shape: 'box', kind, x0, y0, x1, y1, z0, z1, slot, colour }); }
  cyl(kind, cx, cy, r, z0, z1, slot, colour) { this.props.push({ shape: 'cyl', kind, cx, cy, r, z0, z1, slot, colour }); }
  sym(s) { this.syms.push(s); }

  /** Reflect across y = x (swap the axes), used by the portal shed to put the gable or the side on the street. */
  swapXY() {
    const sw = (p) => ({ x: p.y, y: p.x });
    const swPoly = (poly) => poly.map(sw).reverse();
    for (const w of this.walls) { w.a = sw(w.a); w.b = sw(w.b); w.outside = -w.outside; }
    for (const r of this.rooms) r.polygon = swPoly(r.polygon);
    for (const r of this.roofs) r.polygon = swPoly(r.polygon);
    for (const e of this.extras) e.polygon = swPoly(e.polygon);
    this.outline = swPoly(this.outline);
    for (const p of this.props) {
      if (p.shape === 'box') { [p.x0, p.y0, p.x1, p.y1] = [p.y0, p.x0, p.y1, p.x1]; } else [p.cx, p.cy] = [p.cy, p.cx];
    }
    for (const s of this.syms) { if (s.pts) s.pts = s.pts.map(sw); if (s.x !== undefined) [s.x, s.y] = [s.y, s.x]; }
  }

  /** Move the whole plan to place and return the materialise shape. Mutates: build a fresh Plan per call. */
  placed(place = {}) {
    const f = xform(place);
    for (const w of this.walls) { w.a = f(w.a); w.b = f(w.b); }
    for (const r of this.rooms) r.polygon = r.polygon.map(f);
    for (const r of this.roofs) r.polygon = r.polygon.map(f);
    return { walls: this.walls, openings: this.openings, rooms: this.rooms, levels: this.levels.map(({ name, elevationMm }) => ({ name, elevationMm })), roofs: this.roofs };
  }
}

export function xform(place = {}) {
  const a = ((place.rotationDeg || 0) * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  const ox = place.x || 0;
  const oy = place.y || 0;
  return (p) => ({ x: ox + p.x * c - p.y * s, y: oy + p.x * s + p.y * c });
}

/** quantities from a Plan. wallH(level) gives the wall height of a wall without its own height. */
export function quantitiesOf(plan) {
  const lvlH = (name) => plan.levels.find((l) => l.name === name)?.heightMm || 3000;
  const indoor = plan.rooms;
  const groundM2 = indoor.filter((r) => r.level === 'Ground').reduce((a, r) => a + polyArea(r.polygon) / 1e6, 0);
  const upperM2 = indoor.filter((r) => r.level !== 'Ground').reduce((a, r) => a + polyArea(r.polygon) / 1e6, 0);
  const roofM2 = plan.roofs.reduce((a, r) => a + polyArea(r.polygon) / 1e6 / Math.cos((r.pitchDeg * Math.PI) / 180), 0);
  const byId = new Map(plan.walls.map((w) => [w.id, w]));
  let wallM2 = 0;
  for (const w of plan.walls) if (w.kind === 'exterior') wallM2 += (Math.hypot(w.b.x - w.a.x, w.b.y - w.a.y) * (w.height || lvlH(w.level))) / 1e6;
  let glazingM2 = 0;
  const doors = { roller: 0, personnel: 0, dock: 0 };
  for (const o of plan.openings) {
    const w = byId.get(o.wallId);
    const area = (o.width * o.height) / 1e6;
    if (o.kind === 'window') { glazingM2 += area; if (w?.kind === 'exterior') wallM2 -= area; }
    else if (o.kind === 'roller_door' || o.kind === 'garage_door') { if (o.tag === 'dock') doors.dock += 1; else doors.roller += 1; if (w?.kind === 'exterior') wallM2 -= area; }
    else if (o.kind === 'door') { doors.personnel += 1; if (w?.kind === 'exterior') wallM2 -= area; }
  }
  const r1 = (v) => Math.round(v * 100) / 100;
  const perUse = Object.fromEntries(Object.entries(plan.uses).map(([k, v]) => [k, r1(v)]));
  return { gfaM2: r1(groundM2 + upperM2), groundM2: r1(groundM2), upperM2: r1(upperM2), roofM2: r1(roofM2), wallM2: r1(wallM2), glazingM2: r1(glazingM2), doors, perUse };
}

/** Emit 3D items. ctx may carry { builder, addBox, addOrientedBox, addCylinder, place, slot(slot, colour) } from src/viewer3d/mesh-builder.js. */
export function emit3d(plan, ctx = {}) {
  const f = xform(ctx.place || {});
  const ang = (((ctx.place || {}).rotationDeg || 0) * Math.PI) / 180;
  const items = plan.props.map((p) => ({ ...p }));
  let emitted = 0;
  if (ctx.builder && ctx.addOrientedBox) {
    for (const p of items) {
      const slot = ctx.slot ? ctx.slot(p.slot, p.colour) : p.slot;
      if (p.shape === 'box') {
        const c = f({ x: (p.x0 + p.x1) / 2, y: (p.y0 + p.y1) / 2 });
        ctx.addOrientedBox(ctx.builder, c.x / M, c.y / M, (p.x1 - p.x0) / 2 / M, (p.y1 - p.y0) / 2 / M, ang, p.z0 / M, p.z1 / M, slot);
        emitted += 1;
      } else if (ctx.addCylinder) {
        const c = f({ x: p.cx, y: p.cy });
        ctx.addCylinder(ctx.builder, c.x / M, c.y / M, p.r / M, p.z0 / M, p.z1 / M, 14, slot);
        emitted += 1;
      }
    }
  }
  return { items, emitted };
}

/** Return the 2D symbols moved to ctx.place; draw them when ctx.g (a 2D canvas context) is given. ctx.toScreen(p) and ctx.scale are optional. */
export function draw2d(plan, ctx = {}) {
  const f = xform(ctx.place || {});
  const syms = plan.syms.map((s) => ({ ...s, ...(s.pts ? { pts: s.pts.map(f) } : {}), ...(s.x !== undefined ? f(s) : {}) }));
  const g = ctx.g;
  if (g) {
    const T = ctx.toScreen || ((p) => p);
    const sc = ctx.scale || 1;
    g.save();
    for (const s of syms) {
      g.beginPath();
      if (s.t === 'text') { const q = T(s); g.fillStyle = s.fill || '#222'; g.font = `${Math.max(8, (s.size || 600) * sc)}px sans-serif`; g.textAlign = 'center'; g.fillText(s.text, q.x, q.y); continue; }
      if (s.t === 'circle') { const q = T(s); g.arc(q.x, q.y, (s.r || 300) * sc, 0, Math.PI * 2); } else s.pts.forEach((p, i) => { const q = T(p); if (i) g.lineTo(q.x, q.y); else g.moveTo(q.x, q.y); });
      if (s.closed) g.closePath();
      if (s.fill) { g.fillStyle = s.fill; g.fill(); }
      g.setLineDash(s.dash ? s.dash.map((d) => d * sc) : []);
      g.strokeStyle = s.stroke || '#333';
      g.lineWidth = Math.max(1, (s.w || 60) * sc);
      g.stroke();
    }
    g.restore();
  }
  return syms;
}

/** Common shape of a type module from a builder (params -> Plan) and its metadata. */
export function makeType(meta, defs, build, siteFn) {
  const plan = (params) => build(resolve(params, defs));
  return {
    id: meta.id,
    label: meta.label,
    category: meta.category,
    zonesHint: meta.zonesHint,
    params: defs,
    defaults: () => defaultsOf(defs),
    footprint(params) { const p = plan(params); return { outline: p.outline.map(pt), extras: p.extras.map((e) => ({ kind: e.kind, polygon: e.polygon.map(pt) })) }; },
    materialise(params, place) { return plan(params).placed(place); },
    site(params) { return siteFn(resolve(params, defs), plan(params)); },
    quantities(params) { const p = plan(params); const q = quantitiesOf(p); if (meta.extraQuantities) Object.assign(q, meta.extraQuantities(resolve(params, defs), p)); return q; },
    costHints: meta.costHints,
    view3d(params, ctx) { return emit3d(plan(params), ctx); },
    draw2d(params, ctx) { return draw2d(plan(params), ctx); },
    planLabel: meta.planLabel,
  };
}

export const fix = (n) => Math.round(n);
export const mm = (m) => Math.round(m * M);
