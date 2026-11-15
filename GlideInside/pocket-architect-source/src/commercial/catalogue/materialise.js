// Catalogue buildings to model entities: runs each type's materialise(params, place, ctx), turns the descriptors into schema walls, openings,
// rooms and stairs, merges extra levels by name and elevation, and marks everything generated: 'commercial' (so the existing clearGenerated
// removes it on the next run) with the building id and bldg: true (the standard level roof skips catalogue walls, the 3D module roofs them).

import * as S from '../../model/schema.js';
import { buildingsOf } from './buildings.js';
import { toWorld, dirToWorld } from './frame.js';
import { constructionSpec, wallPanelOf } from './construction.js';

const GEN = 'commercial';
export const CAT_LEVEL_PREFIX = 'lvl_commercial_cat_';
const GROUND = 'Ground';
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
const pt = (q) => ({ x: Number(q.x), y: Number(q.y) });

/** The ctx handed to a type's materialise: place maths and short constructors that take LOCAL points and return world descriptors. */
export function materialiseCtx(b, project = null) {
  const { place } = b;
  const at = (lx, ly) => toWorld(place, { x: lx, y: ly });
  const dir = (lx, ly) => dirToWorld(place, { x: lx, y: ly });
  return {
    place, at, dir, S, buildingId: b.id, lot: project?.site?.lot || null, project,
    /** wall(a, b, { kind, thickness, height, outward: {x,y} local direction, key, level }) */
    wall(a, c, { kind = 'exterior', thickness = kind === 'exterior' ? 200 : 100, height, outward = null, key = null, level = GROUND } = {}) {
      return { key, a: at(a.x, a.y), b: at(c.x, c.y), kind, thickness, height, outward: outward && kind === 'exterior' ? dir(outward.x, outward.y) : null, level };
    },
    /** opening(wall, kind, offset, width, height, sill, extra): wall is the key or index of a wall; offset is the centre from the wall's first point. */
    opening(wall, kind, offset, width, height, sill = 0, extra = {}) {
      return { wall, kind, offset, width, height, sill, level: GROUND, ...extra };
    },
    /** room(name, localPolygon, { type, level, ceilingMm, balustrade }) */
    room(name, poly, { type = 'workshop', level = GROUND, ceilingMm = null, balustrade = false } = {}) {
      return { name, type, polygon: poly.map((q) => at(q.x, q.y)), level, ceilingMm, balustrade };
    },
  };
}

/** Run a building's type materialise and return the raw descriptors (used by the model merge and by the 3D module for roofs). */
export function runBuilding(b, project = null) {
  const r = b.def.materialise(b.params, b.place, materialiseCtx(b, project)) || {};
  return { walls: r.walls || [], openings: r.openings || [], rooms: r.rooms || [], levels: r.levels || [], stairs: r.stairs || [], roofs: r.roofs || [] };
}

function levelFor(p, name, elevationMm, heightMm, cache) {
  if (!name || name === GROUND) return p.levels[0];
  const key = `${slug(name)}_${Math.round(elevationMm ?? 0)}`;
  if (cache.has(key)) return cache.get(key);
  const id = `${CAT_LEVEL_PREFIX}${key}`;
  let lvl = p.levels.find((l) => l.id === id);
  if (!lvl) {
    lvl = S.createLevel({ id, name, elevation: elevationMm ?? 3000, height: heightMm ?? 3000 });
    lvl.generated = GEN;
    lvl.catalogue = true;
    lvl.roof.enabled = false;
    p.levels.push(lvl);
  } else if (heightMm) lvl.height = Math.max(lvl.height, heightMm);
  cache.set(key, lvl);
  return lvl;
}

/** Add every building of p.commercial to the project's levels. Returns { buildings, walls, openings, rooms, stairs }. */
export function materialiseBuildings(p, baseHeight = 0) {
  const out = { buildings: 0, walls: 0, openings: 0, rooms: 0, stairs: 0 };
  const c = p.commercial;
  const bs = buildingsOf(c);
  if (!bs.length) return out;
  const cache = new Map();
  const ground = p.levels[0];
  let maxH = 0;
  const tag = (e, b) => { e.generated = GEN; e.building = b.id; e.bldg = true; return e; };
  for (const b of bs) {
    const r = runBuilding(b, p);
    out.buildings += 1;
    const panel = wallPanelOf(constructionSpec(b.params));
    // The front of the building faces the street: its outward normal is the frame's -v.
    const frontDir = { x: -b.frame.v.x, y: -b.frame.v.y };
    const sorted = [...r.levels].sort((a, c) => (a.elevationMm || 0) - (c.elevationMm || 0));
    const lv = new Map(sorted.map((l, i) => [l.name, { ...l, heightMm: l.heightMm > 0 ? l.heightMm : sorted[i + 1] ? sorted[i + 1].elevationMm - (l.elevationMm || 0) : 3000 }]));
    const heightOf = (name) => lv.get(name || GROUND)?.heightMm || null;
    const L = (name) => {
      if (!name || name === GROUND) return ground;
      const d = lv.get(name) || { name, elevationMm: 3000, heightMm: 3000 };
      return levelFor(p, d.name, d.elevationMm, d.heightMm, cache);
    };
    const byKey = new Map();
    const wallsOut = [];
    r.walls.forEach((d, i) => {
      let w = d;
      if (!d.id) {
        w = S.createWall({ a: pt(d.a), b: pt(d.b), thickness: d.thickness ?? 200, height: d.height ?? heightOf(d.level) });
        w.kind = d.kind || 'exterior';
        w.auto = false;
        let outside = 0;
        if (w.kind === 'exterior') {
          if (d.outward) {
            const dx = w.b.x - w.a.x;
            const dy = w.b.y - w.a.y;
            const len = Math.hypot(dx, dy) || 1;
            const dot = (-dy / len) * d.outward.x + (dx / len) * d.outward.y; // wall normal is (-dy, dx), outside is +1 on that side
            outside = dot >= 0 ? 1 : -1;
          } else outside = Number(d.outside) || 0;
        }
        w.outside = outside;
      }
      if (w.height == null) w.height = heightOf(d.level);
      tag(w, b);
      if (panel && w.kind === 'exterior' && w.outside) {
        const len = Math.hypot(w.b.x - w.a.x, w.b.y - w.a.y) || 1;
        const nx = (-(w.b.y - w.a.y) / len) * w.outside;
        const ny = ((w.b.x - w.a.x) / len) * w.outside;
        w.panel = { ...panel, frontage: nx * frontDir.x + ny * frontDir.y > 0.9 };
      }
      const level = L(d.level);
      level.walls.push(w);
      out.walls += 1;
      if (level === ground && Number.isFinite(w.height)) maxH = Math.max(maxH, w.height);
      byKey.set(i, { w, level });
      if (d.key != null) byKey.set(d.key, { w, level });
      wallsOut.push(w);
    });
    for (const d of r.openings) {
      let o = d;
      let ref = null;
      if (d.id) ref = wallsOut.find((w) => w.id === d.wallId) ? { w: wallsOut.find((w) => w.id === d.wallId), level: null } : null;
      else ref = byKey.get(d.wall);
      if (!ref) continue;
      if (!d.id) {
        const { motorised, ...rest } = d;
        o = S.createOpening({ wallId: ref.w.id, kind: d.kind, offset: d.offset, width: d.width, height: d.height, sill: d.sill, style: d.style, hinge: d.hinge, side: d.side, ...(rest.status ? { status: rest.status } : {}) });
        if (motorised !== undefined) o.motorised = motorised;
      }
      o.auto = true;
      tag(o, b);
      const level = ref.level || L(d.level);
      level.openings.push(o);
      out.openings += 1;
    }
    for (const d of r.rooms) {
      let rm = d;
      if (!d.id) {
        const type = d.type || (/OFFICE|CORE|AMENIT|RECEPTION|KIOSK|WC|STAFF|MEETING|CAFE/i.test(d.name) ? 'other' : 'workshop');
        const poly = d.polygon || d.poly;
        rm = S.createRoom({ name: d.name, type, polygon: poly.map(pt), balustrade: !!d.balustrade, ...(d.outdoor ? { outdoor: true } : {}) });
        if (d.use) rm.use = d.use;
      }
      const ceil = Number.isFinite(d.ceilingMm) ? d.ceilingMm : heightOf(d.level);
      if (ceil && rm.ceilingMm == null) rm.ceilingMm = ceil;
      rm.auto = true;
      tag(rm, b);
      L(d.level).rooms.push(rm);
      out.rooms += 1;
    }
    for (const d of r.stairs) {
      const st = d.id ? d : S.createStair({ x: d.x, y: d.y, width: d.width, length: d.length, rotation: d.rotation });
      tag(st, b);
      L(d.level).stairs.push(st);
      out.stairs += 1;
    }
  }
  if (Math.max(maxH, baseHeight) > 0) ground.height = Math.max(maxH, baseHeight);
  return out;
}

/** The roof descriptors of a building in local coordinates, for the 3D module. */
export const roofsOf = (b, project = null) => runBuilding(b, project).roofs;
