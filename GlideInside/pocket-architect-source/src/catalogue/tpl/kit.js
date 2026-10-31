// Template builder. Every edit goes through the operations registry (applyOp), exactly like the
// editor and the AI do. Rooms are placed first, then openings, then furniture, so walls are final.
//
// Sides are compass letters on the plan: n (top, -y), s (bottom, +y), e (+x), w (-x).
// `at` positions an opening along a room side, in mm from the room's west (n, s) or north (e, w)
// corner of the polygon edge to the opening centre. 'c' is the middle, a negative number counts
// from the far end, and with { abs: true } `at` is the plan coordinate (x for n and s, y for e and w).

import { createProject, validate } from '../../model/schema.js';
import { applyOp } from '../../model/ops.js';
import * as G from '../../model/geometry.js';
import { catalogue } from '../core.js';
import { OPENING_PRESETS } from '../openings.js';

const LEVEL_OPS = new Set(['add_room', 'add_room_polygon', 'add_wall', 'add_furniture', 'set_roof', 'add_stair']);
const SIDE_ROT = { n: 0, s: 180, w: 270, e: 90 }; // item back to the wall, front into the room

const edgeSpan = (room, side) => {
  const bb = G.bbox(room.polygon);
  return side === 'n' || side === 's' ? bb.w : bb.h;
};

function edgePoint(room, side, at = 'c', abs = false) {
  const bb = G.bbox(room.polygon);
  const span = edgeSpan(room, side);
  const origin = side === 'n' || side === 's' ? bb.minX : bb.minY;
  const t = at === 'c' ? span / 2 : abs ? at - origin : at < 0 ? span + at : at;
  if (side === 'n') return { x: bb.minX + t, y: bb.minY };
  if (side === 's') return { x: bb.minX + t, y: bb.maxY };
  if (side === 'w') return { x: bb.minX, y: bb.minY + t };
  return { x: bb.maxX, y: bb.minY + t };
}

export class Plan {
  constructor({ name, type }) {
    this.project = createProject({ name, type });
    this.ctx = { catalogue };
    this.levelId = null;
  }

  run(op, args = {}) {
    const a = this.levelId && LEVEL_OPS.has(op) && args.level === undefined ? { ...args, level: this.levelId } : args;
    return applyOp(this.project, op, a, this.ctx);
  }

  use(levelId) {
    this.levelId = levelId;
    return this;
  }

  get lvl() {
    return this.project.levels.find((l) => l.id === this.levelId) || this.project.levels[0];
  }

  // Rooms -------------------------------------------------------------------------------------
  room(type, name, x, y, w, d, extra = {}) {
    const { id } = this.run('add_room', { type, name, x, y, width: w, depth: d, ...extra });
    return this.lvl.rooms.find((r) => r.id === id);
  }

  // Inner face of the walls around a room: { x0, y0, x1, y1 } (rectangular rooms).
  inner(room) {
    const bb = G.bbox(room.polygon);
    const half = (p) => {
      let t = 0;
      for (const w of this.lvl.walls) if (G.projectToSegment(p, w.a, w.b).d <= 3) t = Math.max(t, w.thickness / 2);
      return t;
    };
    return {
      x0: bb.minX + half({ x: bb.minX, y: bb.cy }),
      x1: bb.maxX - half({ x: bb.maxX, y: bb.cy }),
      y0: bb.minY + half({ x: bb.cx, y: bb.minY }),
      y1: bb.maxY - half({ x: bb.cx, y: bb.maxY }),
    };
  }

  // Openings ----------------------------------------------------------------------------------
  // preset: id from the opening presets. Doors swing into `room` unless `into` names another room
  // or swing is 'out'. Throws when the opening would be shrunk or moved by the model.
  opening(presetId, room, side, at = 'c', o = {}) {
    const pre = OPENING_PRESETS.find((p) => p.id === presetId);
    if (!pre) throw new Error(`Unknown opening preset ${presetId}`);
    const lvl = this.lvl;
    const p = edgePoint(room, side, at, !!o.abs);
    const hit = G.nearestWall(lvl, p, 60);
    if (!hit) throw new Error(`No wall on the ${side} side of ${room.name} at ${Math.round(p.x)}, ${Math.round(p.y)}`);
    const wall = hit.wall;
    const args = {
      level: lvl.id,
      wall: wall.id,
      offset: Math.round(hit.offset),
      kind: pre.kind,
      width: o.width ?? pre.width,
      height: o.height ?? pre.height,
      sill: o.sill ?? pre.sill,
      style: o.style ?? pre.style,
    };
    if (pre.kind === 'door') {
      const c = G.polygonCentroid((o.into || room).polygon);
      let s = G.dot(G.wallNormal(wall), G.sub(c, hit.point)) >= 0 ? 1 : -1;
      if (o.swing === 'out') s = -s;
      args.side = s;
      args.hinge = o.hinge ?? (hit.offset <= G.wallLength(wall) / 2 ? 'a' : 'b');
    }
    const { id } = this.run('add_opening', args);
    const made = lvl.openings.find((q) => q.id === id);
    if (Math.abs(made.offset - args.offset) > 1 || made.width !== args.width) {
      throw new Error(`Opening ${presetId} on the ${side} side of ${room.name} was adjusted by the model (offset ${args.offset} to ${made.offset}, width ${args.width} to ${made.width})`);
    }
    return made;
  }

  door(room, side, at, o = {}) {
    return this.opening(o.preset || 'door_internal', room, side, at, o);
  }

  // Several windows of one preset along a side.
  windows(presetId, room, side, ats, o = {}) {
    return ats.map((at) => this.opening(presetId, room, side, at, o));
  }

  // Furniture ---------------------------------------------------------------------------------
  place(item, x, y, rot = 0, o = {}) {
    if (!catalogue.getFurniture(item)) throw new Error(`Unknown furniture ${item}`);
    const { id } = this.run('add_furniture', { item, x: Math.round(x), y: Math.round(y), rotation: rot, w: o.w, d: o.d });
    return this.lvl.furniture.find((f) => f.id === id);
  }

  // Back against a room side, front into the room. o: { at, shift, margin, gap, rot, w, d }
  //   at: 'c' (default), 'start', 'end', or a number: item centre in mm from the inner start corner
  //   (negative counts from the inner end corner; with abs: true it is the plan coordinate of the centre).
  //   shift moves it along the wall; gap lifts it off the wall.
  against(item, room, side, o = {}) {
    const it = catalogue.getFurniture(item);
    if (!it) throw new Error(`Unknown furniture ${item}`);
    const w = o.w ?? it.w;
    const d = o.d ?? it.d;
    const inn = this.inner(room);
    const gap = o.gap ?? 0;
    const horizontal = side === 'n' || side === 's';
    const lo = horizontal ? inn.x0 : inn.y0;
    const hi = horizontal ? inn.x1 : inn.y1;
    const at = o.at ?? 'c';
    const margin = o.margin ?? 0;
    let t;
    if (at === 'c') t = (lo + hi) / 2;
    else if (at === 'start') t = lo + margin + w / 2;
    else if (at === 'end') t = hi - margin - w / 2;
    else if (o.abs) t = at; // absolute plan coordinate of the item centre along the wall
    else t = at < 0 ? hi + at : lo + at;
    t += o.shift || 0;
    let x;
    let y;
    if (side === 'n') [x, y] = [t, inn.y0 + gap + d / 2];
    else if (side === 's') [x, y] = [t, inn.y1 - gap - d / 2];
    else if (side === 'w') [x, y] = [inn.x0 + gap + d / 2, t];
    else [x, y] = [inn.x1 - gap - d / 2, t];
    return this.place(item, x, y, o.rot ?? SIDE_ROT[side], { w: o.w, d: o.d });
  }

  // Item centred in the room (inner face), moved by dx, dy.
  centred(item, room, o = {}) {
    const inn = this.inner(room);
    return this.place(item, (inn.x0 + inn.x1) / 2 + (o.dx || 0), (inn.y0 + inn.y1) / 2 + (o.dy || 0), o.rot || 0, { w: o.w, d: o.d });
  }

  // Walls -------------------------------------------------------------------------------------
  wallAt(x, y, tol = 30) {
    return G.nearestWall(this.lvl, { x, y }, tol)?.wall || null;
  }

  // Splits an existing wall at two points (add_wall over covered length makes no new wall).
  splitWall(x1, y1, x2, y2) {
    this.run('add_wall', { x1, y1, x2, y2 });
    return this.wallAt((x1 + x2) / 2, (y1 + y2) / 2, 5);
  }

  // Misc --------------------------------------------------------------------------------------
  tank(x, y, capacityL = 5000, colour) {
    return this.run('add_tank', { x, y, capacity_l: capacityL, colour });
  }

  stair(x, y, width, length, rotation = 0, levelId) {
    return this.run('add_stair', { x, y, width, length, rotation, level: levelId ?? this.levelId ?? undefined });
  }

  finish(target, material, colour) {
    return this.run('set_finish', { target, material, colour });
  }

  done() {
    const errors = validate(this.project);
    if (errors.length) throw new Error(`Template ${this.project.name} is invalid: ${errors.join('; ')}`);
    return this.project;
  }
}

export const plan = (opts) => new Plan(opts);
