// 3D model build: turns a project into a THREE.Group. No DOM access, so it also runs in Node for
// tests and server exports. Plan x,y (mm) map to world X = x / 1000, Z = y / 1000, Y = elevation / 1000.
//
// Every pickable mesh carries userData { kind, id, levelId, face? }. kind is one of
// wall, roof, opening, floor, tank, furniture, stair, deck.

import * as THREE from 'three';
import * as G from '../model/geometry.js';
import { DEFAULT_FINISHES } from '../model/schema.js';
import { createMaterialLibrary, resolveHex } from './materials.js';
import { GeoBuilder } from './mesh-builder.js';
import { buildWallBody, buildOpeningFittings, computeJoins } from './walls.js';
import { buildLevelRoof } from './roof.js';
import * as F from './footprint.js';
import { makeMesh, modelBounds } from './model-util.js';
import { addFloorPoly, addGround, addDeck, addStair, addTank, addFurniture, shade } from './site.js';

export { disposeModel, modelBounds } from './model-util.js';

export const SLAB = { ground: 0.15, upper: 0.3 };
const FACE_OF_SLOT = { out: 'outside', in: 'inside', edge: 'edge', roof: 'roof', fascia: 'fascia', gable: 'gable' };

const merge = (base, over) => ({ material: over?.material ?? base?.material, colour: over?.colour ?? base?.colour });

// Interior or exterior for the rooms shown in this view. A wall between a shown room and a hidden
// one (demolished work in the proposed view, new work in the existing view) faces outdoors.
function viewClass(w, shownIndoor) {
  if (w.kind !== 'interior') return { kind: w.kind, outside: w.outside || 0 };
  const n = G.wallNormal(w);
  const m = G.wallMid(w);
  const off = (w.thickness || 100) / 2 + 60;
  const plus = shownIndoor.some((r) => G.pointInPolygon(G.add(m, G.mul(n, off)), r.polygon));
  const minus = shownIndoor.some((r) => G.pointInPolygon(G.add(m, G.mul(n, -off)), r.polygon));
  if (plus && !minus) return { kind: 'exterior', outside: -1 };
  if (minus && !plus) return { kind: 'exterior', outside: 1 };
  return { kind: 'interior', outside: 0 };
}

export function floorTypeDefault(room) {
  switch (room.type) {
    case 'garage':
    case 'carport':
    case 'patio':
    case 'workshop':
      return 'polished_concrete';
    case 'deck':
    case 'verandah':
    case 'alfresco':
      return 'decking';
    default:
      return null;
  }
}

// The floor finish a room shows: its own choice, else the default for its type, else the house floors.
// Colour follows the material: the house colour only applies while the house material is used.
export function resolveFloorFinish(room, base, catalogue = null) {
  const material = room.floor?.material ?? floorTypeDefault(room) ?? base.material;
  let colour = room.floor?.colour;
  if (!colour) {
    if (material === base.material) colour = base.colour;
    else {
      let pick = null;
      try {
        pick = catalogue?.finishes?.defaultColour?.(material) || catalogue?.finishes?.coloursFor?.(material)?.[0];
      } catch {
        pick = null;
      }
      colour = pick?.id || pick || (material === 'polished_concrete' ? '#b3b2ad' : material === 'decking' ? '#a47c55' : base.colour);
    }
  }
  return { material, colour };
}

export function buildModel(project, opts = {}) {
  const { levelFilter = 'all', showRoof = true, statusView = 'proposed', catalogue = null, walk = false } = opts;
  const lib = opts.materials || createMaterialLibrary({ textures: false, catalogue });
  const root = new THREE.Group();
  root.name = 'plan-model';
  const fin = {
    externalWalls: merge(DEFAULT_FINISHES.externalWalls, project.finishes?.externalWalls),
    internalWalls: merge(DEFAULT_FINISHES.internalWalls, project.finishes?.internalWalls),
    roof: merge(DEFAULT_FINISHES.roof, project.finishes?.roof),
    fascia: merge(DEFAULT_FINISHES.fascia, project.finishes?.fascia),
    frames: merge(DEFAULT_FINISHES.frames, project.finishes?.frames),
    floors: merge(DEFAULT_FINISHES.floors, project.finishes?.floors),
  };
  const hex = (id) => (lib.hex ? lib.hex(id) : resolveHex(catalogue, id));
  const levels = [...project.levels].sort((a, b) => a.elevation - b.elevation);
  const filterIdx = levelFilter === 'all' ? levels.length : levels.findIndex((l) => l.id === levelFilter);
  const cutIdx = filterIdx < 0 ? levels.length : filterIdx; // levels with index <= cutIdx are shown
  const levelShown = (i) => levelFilter === 'all' || filterIdx < 0 || i <= filterIdx;
  const vis = (status) => {
    const s = status || 'new';
    if (statusView === 'both') return true;
    if (statusView === 'existing') return s !== 'new';
    return s !== 'demolish';
  };
  const tint = (status) => {
    if (statusView !== 'both') return null;
    const s = status || 'new';
    return s === 'new' ? 'new' : s === 'demolish' ? 'demolish' : null;
  };

  const groundY = (levels[0] ? levels[0].elevation / 1000 : 0) - SLAB.ground;
  const grid = F.makeGrid(project);
  const fpCache = new Map();
  const fpOf = (level) => {
    if (!fpCache.has(level.id)) fpCache.set(level.id, F.rasteriseLevel(grid, level, vis));
    return fpCache.get(level.id);
  };

  const floorFinish = (room) => {
    const f = resolveFloorFinish(room, fin.floors, catalogue);
    return { ...f, hex: hex(f.colour) };
  };

  const ctx = {
    THREE, project, lib, catalogue, walk, statusView, groundY, grid, fin, hex, vis, tint, floorFinish,
  };

  // Level by level -----------------------------------------------------------------------------
  levels.forEach((level, li) => {
    if (!levelShown(li)) return;
    const upper = levels[li + 1] || null;
    const group = new THREE.Group();
    group.name = `level:${level.name}`;
    group.userData = { levelId: level.id, decor: true };
    const elev = level.elevation / 1000;
    const fp = fpOf(level);
    const upperFp = upper ? fpOf(upper) : null;
    const rooms = level.rooms.filter((r) => vis(r.status));
    const walls = level.walls.filter((w) => vis(w.status) && G.wallLength(w) >= 10 && Number.isFinite(w.a.x + w.a.y + w.b.x + w.b.y));
    const shownIndoor = rooms.filter((r) => !r.outdoor && r.polygon.length >= 3);

    // slab body under the level footprint
    if (fp.any) {
      const isGround = li === 0;
      const b = new GeoBuilder();
      const rects = F.disjointRects(grid, fp.footprint);
      const y1 = elev - 0.003;
      const y0 = isGround ? groundY - 0.12 : elev - SLAB.upper;
      for (const r of rects) {
        const X0 = r.x0 / 1000;
        const X1 = r.x1 / 1000;
        const Z0 = r.y0 / 1000;
        const Z1 = r.y1 / 1000;
        b.quad('slab', [X0, y1, Z0], [X1, y1, Z0], [X1, y1, Z1], [X0, y1, Z1], [[X0, Z0], [X1, Z0], [X1, Z1], [X0, Z1]], [0, 1, 0]);
        if (!isGround) b.quad('slab', [X0, y0, Z0], [X1, y0, Z0], [X1, y0, Z1], [X0, y0, Z1], [[X0, Z0], [X1, Z0], [X1, Z1], [X0, Z1]], [0, -1, 0]);
        slabSides(b, grid, fp.footprint, r, y0, y1);
      }
      const mesh = makeMesh(b.build(), { slab: lib.get('concrete', '#b9b7b1') }, { decor: true, levelId: level.id }, { name: 'slab' });
      if (mesh) group.add(mesh);
    }

    // floors: one mesh per room, plus a default floor on wall-enclosed area with no room
    rooms.forEach((room, ri) => {
      if (room.outdoor && !room.roofed) return;
      if (room.polygon.length < 3) return;
      const f = floorFinish(room);
      const b = new GeoBuilder();
      addFloorPoly(b, 'floor', room.polygon, elev + 0.0004 * (ri % 8));
      const mesh = makeMesh(b.build(), { floor: lib.get(f.material, f.hex, { tint: tint(room.status) }) }, { kind: 'floor', id: room.id, levelId: level.id, finish: { material: f.material, colour: f.colour } }, { cast: false, name: `floor:${room.id}` });
      if (mesh) group.add(mesh);
    });
    if (fp.any) {
      const leftover = new Uint8Array(grid.nx * grid.ny);
      let count = 0;
      for (let k = 0; k < leftover.length; k++) {
        if (fp.enclosed[k] && !fp.rooms[k]) {
          leftover[k] = 1;
          count++;
        }
      }
      if (count > 2) {
        const b = new GeoBuilder();
        for (const r of F.disjointRects(grid, leftover)) {
          const X0 = r.x0 / 1000;
          const X1 = r.x1 / 1000;
          const Z0 = r.y0 / 1000;
          const Z1 = r.y1 / 1000;
          b.quad('floor', [X0, elev, Z0], [X1, elev, Z0], [X1, elev, Z1], [X0, elev, Z1], [[X0, Z0], [X1, Z0], [X1, Z1], [X0, Z1]], [0, 1, 0]);
        }
        const f = floorFinish({ type: 'other', floor: null });
        const mesh = makeMesh(b.build(), { floor: lib.get(f.material, f.hex) }, { kind: 'floor', id: `${level.id}:floor`, levelId: level.id, finish: { material: f.material, colour: f.colour } }, { cast: false, name: 'floor:default' });
        if (mesh) group.add(mesh);
      }
    }

    // walls and openings
    const joins = computeJoins(walls);
    for (const w of walls) {
      let H = (w.height ?? level.height) / 1000;
      if (w.height == null && upper && upperFp?.any) {
        const target = (upper.elevation - level.elevation) / 1000 - SLAB.upper;
        if (target > H + 0.001) {
          const m = G.wallMid(w);
          const n = G.wallNormal(w);
          const off = (w.thickness || 100) / 2 + 150;
          if ([0, off, -off].some((o) => F.sampleMask(grid, upperFp.footprint, m.x + n.x * o, m.y + n.y * o))) H = target;
        }
      }
      const cls = statusView === 'both' ? { kind: w.kind, outside: w.outside || 0 } : viewClass(w, shownIndoor);
      const outSide = cls.kind === 'interior' ? 0 : cls.outside;
      const wallOpenings = level.openings.filter((o) => o.wallId === w.id && vis(o.status));
      const body = buildWallBody(w, { baseY: elev, H, outSide, openings: wallOpenings, join: joins.get(w.id) });
      const ext = merge(fin.externalWalls, cls.kind === 'interior' ? null : w.finish);
      const int = merge(fin.internalWalls, cls.kind === 'interior' ? w.finish : null);
      const t = tint(w.status);
      const extMat = lib.get(ext.material || 'paint', hex(ext.colour), { tint: t });
      const intMat = lib.get(int.material || 'paint', hex(int.colour), { tint: t });
      const edgeMat = intMat.map ? lib.get('paint', hex(int.colour), { tint: t, flat: true }) : intMat;
      const res = body.build(['out', 'in', 'edge']);
      const mesh = makeMesh(res, { out: extMat, in: intMat, edge: edgeMat }, {
        kind: 'wall', id: w.id, levelId: level.id, face: outSide ? 'outside' : 'inside',
      }, { name: `wall:${w.id}`, cast: t !== 'demolish', faceOf: FACE_OF_SLOT });
      if (mesh) group.add(mesh);

      for (const o of wallOpenings) {
        const fit = buildOpeningFittings(w, o, { baseY: elev, H });
        if (!fit) continue;
        const ot = tint(o.status) || (t === 'demolish' ? 'demolish' : null);
        const frameHex = hex(fin.frames.colour);
        const fasciaHex = hex(fin.fascia.colour);
        const exterior = cls.kind !== 'interior';
        const mats = {
          frame: o.kind === 'garage_door' || o.kind === 'roller_door' ? lib.plain(fasciaHex, { tint: ot, rough: 0.5, metal: 0.3 }) : lib.frame(frameHex, { tint: ot }),
          glass: lib.glass({ tint: ot }),
          leaf: exterior ? lib.frame(frameHex, { tint: ot }) : lib.plain('#e9e5dd', { tint: ot, rough: 0.6 }),
          handle: lib.plain('#b9bcc2', { tint: ot, rough: 0.35, metal: 0.8 }),
          panel: lib.plain(fasciaHex, { tint: ot, rough: 0.5, metal: 0.3 }),
          roller: lib.get('roller', fasciaHex, { tint: ot }),
          groove: lib.plain(shade(fasciaHex, 0.55), { tint: ot }),
        };
        const SLOTS = ['frame', 'leaf', 'panel', 'handle', 'roller', 'groove', 'glass'];
        const om = makeMesh(fit.build(SLOTS), mats, { kind: 'opening', id: o.id, levelId: level.id, openingKind: o.kind, wallId: w.id }, { name: `opening:${o.id}` });
        if (om) group.add(om);
        // The moving part (door leaf, sliding sash, rolling panel) is its own mesh so the walk-through can animate it.
        const mres = fit.moving?.build(SLOTS);
        if (mres && fit.motion) {
          const mo = fit.motion;
          const pivot = mo.pivot || [0, 0, 0];
          if (mo.pivot) mres.geometry.translate(-pivot[0], -pivot[1], -pivot[2]);
          const lm = makeMesh(mres, mats, { kind: 'opening', id: o.id, levelId: level.id, openingKind: o.kind, wallId: w.id, leaf: true, motion: { ...mo } }, { name: `leaf:${o.id}` });
          if (lm) {
            lm.position.set(pivot[0], pivot[1], pivot[2]);
            group.add(lm);
          }
        } else if (mres) {
          const lm = makeMesh(mres, mats, { kind: 'opening', id: o.id, levelId: level.id, openingKind: o.kind, wallId: w.id, leaf: true }, { name: `leaf:${o.id}` });
          if (lm) group.add(lm);
        }
      }
    }

    // decks, stairs, furniture
    for (const room of rooms) if (room.outdoor && !room.roofed && room.polygon.length >= 3) addDeck(ctx, group, level, room, walls);
    for (const s of level.stairs) {
      const rise = upper ? (upper.elevation - level.elevation) / 1000 : (project.settings?.floorToFloor || 3000) / 1000;
      addStair(ctx, group, level, s, rise);
    }
    for (const f of level.furniture) addFurniture(ctx, group, level, f);

    // ceilings in walk mode only
    if (walk) {
      const b = new GeoBuilder();
      const y = elev + level.height / 1000;
      for (const room of rooms) {
        if (room.outdoor) continue;
        addFloorPoly(b, 'ceil', room.polygon, y, false);
      }
      const mesh = makeMesh(b.build(), { ceil: lib.plain('#f4f2ee', { rough: 0.95 }) }, { decor: true, levelId: level.id }, { cast: false, name: 'ceiling' });
      if (mesh) group.add(mesh);
    }
    root.add(group);
  });

  // tanks (site items, shown with the ground level)
  for (const tank of project.site?.tanks || []) {
    if (!vis(tank.status)) continue;
    addTank(ctx, root, tank, levels[0]?.id);
  }

  // roofs
  if (showRoof) {
    levels.forEach((level, li) => {
      if (!levelShown(li)) return;
      if (levelFilter !== 'all' && filterIdx >= 0 && li >= filterIdx) return; // cutaway: no roof on the cut level or above
      if (level.roof?.enabled === false) return;
      const fp = fpOf(level);
      if (!fp.any) return;
      const upper = levels[li + 1] || null;
      const upperFp = upper ? fpOf(upper) : null;
      const { builder } = buildLevelRoof({
        grid, footprint: fp.footprint, above: upperFp?.any ? upperFp.footprint : null,
        H0: (level.elevation + level.height) / 1000, roof: level.roof || {},
      });
      const res = builder.build();
      if (!res) return;
      const ext = fin.externalWalls;
      const mats = {
        roof: lib.get(fin.roof.material || 'corrugated', hex(fin.roof.colour), { side: 'double' }),
        fascia: lib.plain(hex(fin.fascia.colour), { rough: 0.5, metal: 0.3 }),
        gable: lib.get(ext.material || 'paint', hex(ext.colour)),
      };
      const mesh = makeMesh(res, mats, {
        kind: 'roof', id: `${level.id}:roof`, levelId: level.id,
      }, { name: `roof:${level.name}`, cast: !walk, faceOf: FACE_OF_SLOT });
      if (mesh) root.add(mesh);
    });
  }

  // ground last so it can size itself to the model
  const bounds = modelBounds(root);
  const groundR = addGround(ctx, root, bounds);
  root.userData = { groundY, groundR, levelIds: levels.map((l) => l.id), cutIdx };
  return root;
}

// Side faces of a slab rectangle where the neighbouring cell is outside the footprint.
function slabSides(b, grid, mask, r, y0, y1) {
  const out = (i, j) => {
    if (i < 0 || j < 0 || i >= grid.nx || j >= grid.ny) return true;
    return !mask[j * grid.nx + i];
  };
  const runs = (count, test) => {
    const res = [];
    let s = -1;
    for (let k = 0; k <= count; k++) {
      const hit = k < count && test(k);
      if (hit && s < 0) s = k;
      if (!hit && s >= 0) {
        res.push([s, k]);
        s = -1;
      }
    }
    return res;
  };
  const c = grid.cell;
  const nI = r.i1 - r.i0 + 1;
  const nJ = r.j1 - r.j0 + 1;
  for (const [s, e] of runs(nI, (k) => out(r.i0 + k, r.j0 - 1))) {
    const xa = (r.x0 + s * c) / 1000;
    const xb = (r.x0 + e * c) / 1000;
    const z = r.y0 / 1000;
    b.quad('slab', [xa, y0, z], [xb, y0, z], [xb, y1, z], [xa, y1, z], [[xa, y0], [xb, y0], [xb, y1], [xa, y1]], [0, 0, -1]);
  }
  for (const [s, e] of runs(nI, (k) => out(r.i0 + k, r.j1 + 1))) {
    const xa = (r.x0 + s * c) / 1000;
    const xb = (r.x0 + e * c) / 1000;
    const z = r.y1 / 1000;
    b.quad('slab', [xa, y0, z], [xb, y0, z], [xb, y1, z], [xa, y1, z], [[xa, y0], [xb, y0], [xb, y1], [xa, y1]], [0, 0, 1]);
  }
  for (const [s, e] of runs(nJ, (k) => out(r.i0 - 1, r.j0 + k))) {
    const za = (r.y0 + s * c) / 1000;
    const zb = (r.y0 + e * c) / 1000;
    const x = r.x0 / 1000;
    b.quad('slab', [x, y0, za], [x, y0, zb], [x, y1, zb], [x, y1, za], [[za, y0], [zb, y0], [zb, y1], [za, y1]], [-1, 0, 0]);
  }
  for (const [s, e] of runs(nJ, (k) => out(r.i1 + 1, r.j0 + k))) {
    const za = (r.y0 + s * c) / 1000;
    const zb = (r.y0 + e * c) / 1000;
    const x = r.x1 / 1000;
    b.quad('slab', [x, y0, za], [x, y0, zb], [x, y1, zb], [x, y1, za], [[za, y0], [zb, y0], [zb, y1], [za, y1]], [1, 0, 0]);
  }
}
