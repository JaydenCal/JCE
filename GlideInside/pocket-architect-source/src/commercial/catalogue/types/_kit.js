// Shared factory for the catalogue building types in this folder (types C). A type supplies params plus a pure spec(params) in
// LOCAL plan millimetres (building rectangle at origin, front edge on y = 0 facing the street, +y runs to the rear). The kit derives
// footprint, materialise, site, quantities, view3d and draw2d from that one spec so the outputs always agree with each other.
// Pure module: no DOM and no three import. view3d returns the extra boxes as data; pass ctx.helpers = { GeoBuilder, addOrientedBox } (from
// src/viewer3d/mesh-builder.js) to also get a ready GeoBuilder in the result, or call result.build(helpers) later.

import * as S from '../../../model/schema.js';

export const GEN = 'commercial';

/** Material slots used by view3d extras. unlit slots must be MeshBasicMaterial so they read crisp, never blurred or shaded. */
export const SLOT_STYLES = {
  canopy: { colour: '#e9ecef', unlit: false },
  steel: { colour: '#6b7480', unlit: false },
  concrete: { colour: '#b9bcc0', unlit: false },
  asphalt: { colour: '#3a3d42', unlit: false },
  panel: { colour: '#dfe4e8', unlit: false },
  pump: { colour: '#c9ced4', unlit: false },
  board: { colour: '#2b2f36', unlit: true },
  glass: { colour: '#9fc3d6', unlit: true },
  furniture: { colour: '#8a6d4e', unlit: false },
  plant: { colour: '#7d858f', unlit: false },
  foliage: { colour: '#4f8a4a', unlit: true },
};

const D2R = Math.PI / 180;

export const rect = (x0, y0, x1, y1) => [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
export function polyArea(poly) {
  let a = 0;
  for (let i = 0; i < poly.length; i++) { const p = poly[i]; const q = poly[(i + 1) % poly.length]; a += p.x * q.y - q.x * p.y; }
  return Math.abs(a) / 2;
}
export const m2 = (mm2) => mm2 / 1e6;
export const round1 = (n) => Math.round(n * 10) / 10;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export function xform(place) {
  const pl = place || { x: 0, y: 0, rotationDeg: 0 };
  const c = Math.cos((pl.rotationDeg || 0) * D2R);
  const s = Math.sin((pl.rotationDeg || 0) * D2R);
  return (p) => ({ x: (pl.x || 0) + c * p.x - s * p.y, y: (pl.y || 0) + s * p.x + c * p.y });
}

/** Merge with defaults and clamp numbers to min/max, selects to options, bools to booleans. Never throws. */
export function normalise(list, params) {
  const out = {};
  for (const d of list) {
    let v = params && params[d.key] !== undefined ? params[d.key] : d.default;
    if (d.type === 'number') { v = Number(v); if (!Number.isFinite(v)) v = d.default; v = clamp(v, d.min, d.max); if (d.step && d.step >= 1) v = Math.round(v / d.step) * d.step; }
    else if (d.type === 'bool') v = !!v;
    else if (d.type === 'select') { const vals = d.options.map((o) => (typeof o === 'object' ? o.value : o)); if (!vals.includes(v)) v = d.default; }
    out[d.key] = v;
  }
  return out;
}

/** Problems with a params object (empty array when valid). */
export function validate(list, params) {
  const bad = [];
  for (const d of list) {
    const v = params ? params[d.key] : undefined;
    if (d.type === 'number') { if (!Number.isFinite(v) || v < d.min || v > d.max) bad.push(d.key); }
    else if (d.type === 'bool') { if (typeof v !== 'boolean') bad.push(d.key); }
    else if (!d.options.map((o) => (typeof o === 'object' ? o.value : o)).includes(v)) bad.push(d.key);
  }
  return bad;
}

const WALL_DEFS = [
  { id: 'front', a: (W) => ({ x: 0, y: 0 }), b: (W) => ({ x: W, y: 0 }) },
  { id: 'right', a: (W) => ({ x: W, y: 0 }), b: (W, D) => ({ x: W, y: D }) },
  { id: 'rear', a: (W, D) => ({ x: 0, y: D }), b: (W, D) => ({ x: W, y: D }) },
  { id: 'left', a: () => ({ x: 0, y: 0 }), b: (W, D) => ({ x: 0, y: D }) },
];

function outsideSign(a, b, W, D) {
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  const out = { x: mid.x - W / 2, y: mid.y - D / 2 };
  const n = { x: -(b.y - a.y), y: b.x - a.x };
  return n.x * out.x + n.y * out.y >= 0 ? 1 : -1;
}

/**
 * Build a catalogue type module from a definition { id, label, category, zonesHint, params, planLabel, buildRateKey, costNotes, spec }.
 * spec(p) -> { W, D, storeys, wallH, extWallMm, levels, rooms, interior, openings, roofs, extras, boxes, symbols, upperM2, perUse,
 *   extraGlazingM2, site, notes }.
 */
export function defineType(def) {
  const norm = (p) => normalise(def.params, p);
  const specOf = (p) => { const n = norm(p); const s = def.spec(n); return { n, s }; };
  const levelsOf = (s) => s.levels || Array.from({ length: s.storeys || 1 }, (_, i) => ({ name: i === 0 ? 'Ground' : `Level ${i}`, elevationMm: i * (s.wallH || 3600) }));

  return {
    id: def.id,
    label: def.label,
    category: def.category,
    zonesHint: def.zonesHint,
    params: def.params,
    planLabel: def.planLabel,
    defaults(lot) {
      const d = norm({});
      if (lot && Number.isFinite(lot.widthMm) && d.plateW !== undefined) d.plateW = clamp(Math.min(d.plateW, lot.widthMm - 12000), def.params.find((x) => x.key === 'plateW').min, d.plateW);
      return d;
    },
    validate: (p) => validate(def.params, p),
    normalise: norm,
    costHints: { buildRateKey: def.buildRateKey, notes: def.costNotes },

    footprint(params) {
      const { s } = specOf(params);
      return { outline: rect(0, 0, s.W, s.D), extras: (s.extras || []).map((e) => ({ kind: e.kind, polygon: e.polygon.map((q) => ({ ...q })), label: e.label })) };
    },

    materialise(params, place, ctx) {
      const { s } = specOf(params);
      const T = xform(place);
      const levels = levelsOf(s);
      const ext = s.extWallMm || 200;
      const walls = [];
      const openings = [];
      const wallIndex = new Map();
      levels.forEach((lv, li) => {
        for (const wd of WALL_DEFS) {
          const a = wd.a(s.W, s.D);
          const b = wd.b(s.W, s.D);
          const w = S.createWall({ a: T(a), b: T(b), thickness: ext });
          w.kind = 'exterior'; w.outside = outsideSign(a, b, s.W, s.D); w.auto = false; w.generated = GEN; w.level = lv.name; w.side = wd.id;
          walls.push(w);
          wallIndex.set(`${li}:${wd.id}`, w);
        }
        for (const iw of (s.interior || []).filter((x) => (x.level ?? 0) === li)) {
          const w = S.createWall({ a: T(iw.a), b: T(iw.b), thickness: iw.thickness || 100 });
          w.kind = 'interior'; w.outside = 0; w.auto = false; w.generated = GEN; w.level = lv.name;
          walls.push(w);
        }
      });
      for (const op of s.openings || []) {
        const w = wallIndex.get(`${op.level ?? 0}:${op.wall}`);
        if (!w) continue;
        const o = S.createOpening({ wallId: w.id, kind: op.kind, offset: op.offset, width: op.width, height: op.height, sill: op.sill ?? 0, style: op.style });
        o.auto = true; o.generated = GEN; o.level = w.level;
        if (op.dock) o.dockDoor = true;
        if (op.seal) o.seal = true;
        if (op.shelter) o.shelter = true;
        openings.push(o);
      }
      const rooms = (s.rooms || []).map((r) => ({ name: r.name, polygon: r.poly.map(T), level: levels[r.level ?? 0].name, outdoor: !!r.outdoor, generated: GEN }));
      const roofs = (s.roofs || [{ type: 'flat', pitchDeg: 2 }]).map((r) => ({ polygon: (r.poly || rect(0, 0, s.W, s.D)).map(T), type: r.type, pitchDeg: r.pitchDeg }));
      return { walls, openings, rooms, levels: levels.map((l) => ({ ...l })), roofs, generated: GEN };
    },

    site(params) {
      const { n, s } = specOf(params);
      return s.site(n, s);
    },

    quantities(params) {
      const { s } = specOf(params);
      const ground = m2(s.W * s.D);
      const upper = s.upperM2 !== undefined ? s.upperM2 : ground * ((s.storeys || 1) - 1);
      const ops = s.openings || [];
      const glazing = ops.filter((o) => o.kind === 'window').reduce((a, o) => a + m2(o.width * o.height), 0) + (s.extraGlazingM2 || 0);
      const wall = (2 * (s.W + s.D) * s.wallH * (s.storeys || 1)) / 1e6;
      const pitch = (s.roofs && s.roofs[0] && s.roofs[0].pitchDeg) || 0;
      const roofKind = (s.roofs && s.roofs[0] && s.roofs[0].type) || 'flat';
      const roof = roofKind === 'flat' ? ground : ground / Math.cos(pitch * D2R);
      const doors = { roller: 0, personnel: 0, dock: 0 };
      for (const o of ops) {
        if (o.kind === 'roller_door' && o.dock) doors.dock += 1;
        else if (o.kind === 'roller_door') doors.roller += 1;
        else if (o.kind === 'door') doors.personnel += 1;
      }
      const gfa = ground + upper;
      return { gfaM2: round1(gfa), groundM2: round1(ground), upperM2: round1(upper), roofM2: round1(roof), wallM2: round1(wall), glazingM2: round1(glazing), doors, perUse: s.perUse(gfa), ...(s.extraQuantities || {}) };
    },

    view3d(params, ctx) {
      const { s } = specOf(params);
      const T = xform(ctx && ctx.place);
      const rot = ((ctx && ctx.place && ctx.place.rotationDeg) || 0) * D2R;
      const boxes = s.boxes || [];
      const build = (h) => {
        const b = new h.GeoBuilder();
        for (const bx of boxes) {
          const c = T({ x: (bx.x0 + bx.x1) / 2, y: (bx.y0 + bx.y1) / 2 });
          h.addOrientedBox(b, c.x / 1000, c.y / 1000, (bx.x1 - bx.x0) / 2000, (bx.y1 - bx.y0) / 2000, rot, bx.z0 / 1000, bx.z1 / 1000, bx.slot);
        }
        return b;
      };
      const out = { boxes, slotStyles: SLOT_STYLES, noBrands: true, build };
      if (ctx && ctx.helpers) out.builder = build(ctx.helpers);
      return out;
    },

    draw2d(params, ctx) {
      const { s } = specOf(params);
      const T = xform(ctx && ctx.place);
      const syms = (s.symbols || []).map((y) => ({ ...y, pts: y.pts ? y.pts.map(T) : undefined, at: y.at ? T(y.at) : undefined }));
      const g = ctx && ctx.g;
      const toS = (ctx && ctx.toScreen) || ((p) => p);
      if (g) {
        g.save();
        for (const y of syms) {
          g.strokeStyle = y.stroke || '#555'; g.fillStyle = y.fill || 'rgba(0,0,0,0)'; g.lineWidth = y.lw || 1;
          if (y.type === 'text' && y.at) { const q = toS(y.at); g.fillStyle = '#333'; g.fillText(y.label, q.x, q.y); continue; }
          if (!y.pts || !y.pts.length) continue;
          if (y.dash) g.setLineDash(y.dash); else g.setLineDash([]);
          g.beginPath();
          y.pts.forEach((p, i) => { const q = toS(p); if (i) g.lineTo(q.x, q.y); else g.moveTo(q.x, q.y); });
          if (y.type === 'poly') { g.closePath(); g.fill(); }
          g.stroke();
        }
        g.restore();
      }
      return syms;
    },
  };
}

export const NUM = (key, label, unit, min, max, step, dflt) => ({ key, label, type: 'number', unit, min, max, step, default: dflt });
export const SEL = (key, label, options, dflt) => ({ key, label, type: 'select', unit: '', options, default: dflt });
export const BOOL = (key, label, dflt) => ({ key, label, type: 'bool', unit: '', default: dflt });
export const poly = (kind, pts, label) => ({ kind, polygon: pts, label });
export const symPoly = (pts, stroke, fill, extra = {}) => ({ type: 'poly', pts, stroke, fill, ...extra });
export const symLine = (pts, stroke, extra = {}) => ({ type: 'line', pts, stroke, ...extra });
export const symText = (at, label) => ({ type: 'text', at, label });
export { clamp };
