// Operations registry. Every edit (editor, templates, AI) goes through these functions.
// Each op: { label, description, params, required, run(project, args, ctx) }.
// ctx: { activeLevelId, catalogue } where catalogue (optional) validates ids.

import * as S from './schema.js';
import { stairLayout, shapedParams, isShaped, STAIR_SHAPES, STAIR_TURNS } from './stair-geom.js';
import * as G from './geometry.js';
import * as SITE from './placement.js';
import { fitHouse } from '../site/fit-house.js';
import { settleSiteItems } from '../site/site-items.js';
import { COMMERCIAL_OPS, commercialToolSchemas } from '../premium/ai/commercial-schemas.js';
import { addExistingBuilding, removeExistingBuilding, updateExistingBuilding } from '../site/existing-buildings.js';

export class OpError extends Error {
  constructor(message) {
    super(message);
    this.name = 'OpError';
  }
}
const fail = (m) => {
  throw new OpError(m);
};

const MIN_WALL = 10; // mm
const MIN_ROOM = 300; // mm, minimum room side

function num(v, name, { min = -1e7, max = 1e7, optional = false } = {}) {
  if (v === undefined || v === null || v === '') {
    if (optional) return undefined;
    fail(`${name} is required`);
  }
  const n = Number(v);
  if (!Number.isFinite(n)) fail(`${name} must be a number`);
  if (n < min || n > max) fail(`${name} must be between ${min} and ${max}`);
  return n;
}
function oneOf(v, list, name, optional = false) {
  if (v === undefined || v === null) {
    if (optional) return undefined;
    fail(`${name} is required`);
  }
  if (!list.includes(v)) fail(`${name} must be one of: ${list.join(', ')}`);
  return v;
}
const r1 = (p) => G.roundPt(p, 1);

// Lookup ----------------------------------------------------------------------
export function findEntity(project, id) {
  if (!id) return null;
  for (const level of project.levels) {
    if (level.id === id) return { kind: 'level', item: level, level, list: project.levels };
    for (const [kind, key] of [
      ['wall', 'walls'],
      ['opening', 'openings'],
      ['room', 'rooms'],
      ['furniture', 'furniture'],
      ['stair', 'stairs'],
      ['void', 'voids'],
    ]) {
      const item = (level[key] || []).find((e) => e.id === id);
      if (item) return { kind, item, level, list: level[key] };
    }
  }
  const t = (project.site?.tanks || []).find((e) => e.id === id);
  if (t) return { kind: 'tank', item: t, level: project.levels[0], list: project.site.tanks };
  return null;
}

function need(project, id, kind) {
  const f = findEntity(project, id);
  if (!f) fail(`No element with id ${id}`);
  if (kind && f.kind !== kind) fail(`${id} is a ${f.kind}, not a ${kind}`);
  return f;
}

export function getLevel(project, ref, ctx = {}) {
  if (ref) {
    const l = project.levels.find((x) => x.id === ref) || project.levels.find((x) => x.name.toLowerCase() === String(ref).toLowerCase());
    if (!l) fail(`No level ${ref}`);
    return l;
  }
  return project.levels.find((x) => x.id === ctx.activeLevelId) || project.levels[0];
}

// Wall topology ---------------------------------------------------------------
export function splitWallAt(level, wall, p) {
  const L = G.wallLength(wall);
  const s = G.projectToSegment(p, wall.a, wall.b).along;
  if (s < MIN_WALL || L - s < MIN_WALL) return null;
  const ops = level.openings.filter((o) => o.wallId === wall.id);
  if (ops.some((o) => {
    const sp = G.openingSpan(o);
    return sp.start < s && sp.end > s;
  })) return null; // never cut through an opening
  const cut = r1(G.pointOnWall(wall, s));
  const w2 = { ...structuredClone(wall), id: S.uid('w'), a: { ...cut } };
  wall.b = { ...cut };
  level.walls.splice(level.walls.indexOf(wall) + 1, 0, w2);
  for (const o of ops) {
    if (o.offset > s) {
      o.wallId = w2.id;
      o.offset -= s;
    }
  }
  return [wall, w2];
}

export function splitWallsAtPoints(level, points) {
  for (const p of points) {
    for (const w of [...level.walls]) {
      const r = G.projectToSegment(p, w.a, w.b);
      if (r.d <= G.TOL && r.along > MIN_WALL && G.wallLength(w) - r.along > MIN_WALL) splitWallAt(level, w, p);
    }
  }
}

// Split walls at every wall end and indoor room corner lying on them, drop tiny and duplicate walls.
export function normaliseWalls(level) {
  const pts = [];
  for (const w of level.walls) pts.push({ ...w.a }, { ...w.b });
  for (const r of level.rooms) if (!r.outdoor) pts.push(...r.polygon.map((p) => ({ ...p })));
  splitWallsAtPoints(level, pts);
  level.walls = level.walls.filter((w) => G.wallLength(w) >= MIN_WALL);
  const kept = [];
  level.walls = level.walls.filter((w) => {
    const dup = kept.find((k) => (G.samePoint(k.a, w.a) && G.samePoint(k.b, w.b)) || (G.samePoint(k.a, w.b) && G.samePoint(k.b, w.a)));
    if (!dup) {
      kept.push(w);
      return true;
    }
    for (const o of level.openings) {
      if (o.wallId !== w.id) continue;
      o.wallId = dup.id;
      if (G.samePoint(dup.a, w.b)) o.offset = G.wallLength(dup) - o.offset;
    }
    return false;
  });
  const ids = new Set(level.walls.map((w) => w.id));
  level.openings = level.openings.filter((o) => ids.has(o.wallId));
}

// Add a wall from a to b, skipping any length already covered by a collinear wall.
export function addWallSegment(level, a, b, opts = {}) {
  a = r1(a);
  b = r1(b);
  const L = G.dist(a, b);
  if (L < MIN_WALL) return [];
  const dir = G.norm(G.sub(b, a));
  const covered = [];
  for (const w of level.walls) {
    if (!G.collinear(a, b, w.a, w.b)) continue;
    const ov = G.overlapOnSegment(a, b, w.a, w.b);
    if (ov) covered.push(ov);
  }
  covered.sort((p, q) => p[0] - q[0]);
  const pieces = [];
  let cur = 0;
  for (const [s0, s1] of covered) {
    if (s0 > cur + MIN_WALL) pieces.push([cur, s0]);
    cur = Math.max(cur, s1);
  }
  if (L - cur > MIN_WALL) pieces.push([cur, L]);
  const created = [];
  for (const [s0, s1] of pieces) {
    const w = S.createWall({
      a: r1(G.add(a, G.mul(dir, s0))),
      b: r1(G.add(a, G.mul(dir, s1))),
      thickness: opts.thickness ?? null,
      height: opts.height ?? null,
      status: opts.status || 'new',
    });
    level.walls.push(w);
    created.push(w);
  }
  return created;
}

// Decide interior or exterior, which side is outdoors, and auto thickness.
export function classifyWalls(project, level) {
  const indoor = level.rooms.filter((r) => !r.outdoor && r.polygon.length >= 3);
  const bb = G.levelBounds(level);
  const centre = bb ? { x: bb.cx, y: bb.cy } : { x: 0, y: 0 };
  for (const w of level.walls) {
    if (G.wallLength(w) < MIN_WALL) continue;
    const n = G.wallNormal(w);
    const m = G.wallMid(w);
    const off = (w.thickness || 100) / 2 + 60;
    const inPlus = indoor.some((r) => G.pointInPolygon(G.add(m, G.mul(n, off)), r.polygon));
    const inMinus = indoor.some((r) => G.pointInPolygon(G.add(m, G.mul(n, -off)), r.polygon));
    let kind = 'exterior';
    let outside;
    if (inPlus && inMinus) {
      kind = 'interior';
      outside = 0;
    } else if (inPlus) outside = -1;
    else if (inMinus) outside = 1;
    else outside = G.dot(n, G.sub(m, centre)) >= 0 ? 1 : -1;
    w.kind = kind;
    w.outside = outside;
    if (w.auto !== false) w.thickness = kind === 'interior' ? project.settings.intWall : project.settings.extWall;
  }
}

// End margins of an opening along its wall (mm). Where the wall ends on another wall the opening may run right up to it (0), at a free
// end a small margin of 30 stays. These are small so that a door or window sits where the plan puts it.
export const FREE_END_MARGIN = 30;
export function endMargins(level, wall) {
  const touches = (pt) => level.walls.some((w) => w.id !== wall.id && G.wallLength(w) >= MIN_WALL && G.pointOnSegment(pt, w.a, w.b));
  return [touches(wall.a) ? 0 : FREE_END_MARGIN, touches(wall.b) ? 0 : FREE_END_MARGIN];
}

// Keep every opening inside its wall. Shrinks or drops openings that no longer fit.
function refitOpenings(level) {
  level.openings = level.openings.filter((o) => {
    const w = level.walls.find((x) => x.id === o.wallId);
    if (!w) return false;
    const L = G.wallLength(w);
    if (L < 500) return false;
    const [m0, m1] = endMargins(level, w);
    o.width = Math.min(o.width, L - m0 - m1);
    o.offset = G.clamp(o.offset, m0 + o.width / 2, L - m1 - o.width / 2);
    return true;
  });
}

// Fits an opening to its wall. By default the opening is nudged to fit (the editor wants that). With `exact` the opening is never moved or
// narrowed: one that does not fit, or overlaps another opening, is reported as a problem (an Error) instead.
export function fitOpening(level, wall, o, { exact = false } = {}) {
  const L = G.wallLength(wall);
  const [m0, m1] = endMargins(level, wall);
  if (L - m0 - m1 < 300) fail('That wall is too short for an opening');
  if (exact) {
    if (o.offset - o.width / 2 < m0 - 0.5 || o.offset + o.width / 2 > L - m1 + 0.5) fail(`That opening does not fit the wall (it needs ${Math.round(o.offset - o.width / 2)} to ${Math.round(o.offset + o.width / 2)} of a ${Math.round(L)} wall)`);
  } else {
    if (o.width > L - m0 - m1) o.width = Math.floor(L - m0 - m1);
    o.offset = G.clamp(o.offset, m0 + o.width / 2, L - m1 - o.width / 2);
  }
  const span = G.openingSpan(o);
  const clash = level.openings.find((q) => {
    if (q.wallId !== wall.id || q.id === o.id) return false;
    const s = G.openingSpan(q);
    return s.start < span.end - 0.5 && s.end > span.start + 0.5;
  });
  if (clash) fail(`That overlaps ${clash.kind.replace('_', ' ')} ${clash.id} on the same wall`);
  const top = wall.height ?? level.height;
  if (o.sill + o.height > top) o.height = Math.max(300, top - o.sill);
}

// Push or pull the segment A to B by `move`. Collinear walls inside the segment move,
// walls touching it stretch, rooms with an edge on it reshape, connector walls close gaps.
export function pushPull(project, level, A, B, move) {
  A = r1(A);
  B = r1(B);
  if (G.len(move) < 1) return;
  // 1. Split collinear walls that run past the segment ends.
  for (const E of [A, B]) {
    for (const w of [...level.walls]) {
      if (!G.collinear(A, B, w.a, w.b)) continue;
      const r = G.projectToSegment(E, w.a, w.b);
      if (r.d <= G.TOL && r.along > MIN_WALL && G.wallLength(w) - r.along > MIN_WALL) splitWallAt(level, w, E);
    }
  }
  const onSeg = (p) => G.pointOnSegment(p, A, B);
  const stretched = { A: false, B: false };
  const movedIds = new Set();
  for (const w of level.walls) {
    if (G.collinear(A, B, w.a, w.b)) {
      if (onSeg(w.a) && onSeg(w.b)) {
        w.a = r1(G.add(w.a, move));
        w.b = r1(G.add(w.b, move));
        movedIds.add(w.id);
      }
      continue;
    }
    for (const end of ['a', 'b']) {
      if (!onSeg(w[end])) continue;
      const old = { ...w[end] };
      const oldLen = G.wallLength(w);
      w[end] = r1(G.add(w[end], move));
      if (end === 'a') {
        const dl = G.wallLength(w) - oldLen;
        for (const o of level.openings) if (o.wallId === w.id) o.offset += dl;
      }
      if (G.samePoint(old, A)) stretched.A = true;
      if (G.samePoint(old, B)) stretched.B = true;
    }
  }
  // 2. Close gaps where a collinear wall continues past an end and nothing stretched there.
  for (const [key, E] of [['A', A], ['B', B]]) {
    if (stretched[key] || !movedIds.size) continue;
    const continues = level.walls.some((w) => !movedIds.has(w.id) && G.collinear(A, B, w.a, w.b) && (G.samePoint(w.a, E) || G.samePoint(w.b, E)));
    if (continues) addWallSegment(level, E, G.add(E, move), { status: 'new' });
  }
  // 3. Rooms with an edge lying along the segment.
  for (const r of level.rooms) {
    const hit = G.polygonEdges(r.polygon).some(([p, q]) => {
      if (!G.collinear(A, B, p, q)) return false;
      const ov = G.overlapOnSegment(A, B, p, q);
      return ov && ov[1] - ov[0] > G.TOL;
    });
    if (hit) r.polygon = r.polygon.map((p) => (onSeg(p) ? r1(G.add(p, move)) : p));
  }
  level.walls = level.walls.filter((w) => G.wallLength(w) >= MIN_WALL);
  normaliseWalls(level);
  refitOpenings(level);
  classifyWalls(project, level);
}

// Rooms -----------------------------------------------------------------------
export function addRoom(project, level, { name, type = 'other', polygon, walls, status = 'new', outdoor, roofed, balustrade }) {
  if (!Array.isArray(polygon) || polygon.length < 3) fail('A room needs at least 3 points');
  oneOf(type, S.ROOM_TYPES, 'type');
  if (G.polygonArea(polygon) < 0.25e6) fail('That room is too small (minimum 0.25 m²)');
  const room = S.createRoom({ name, type, polygon: polygon.map(r1), status, outdoor, roofed, balustrade });
  level.rooms.push(room);
  const makeWalls = walls ?? !room.outdoor;
  if (makeWalls) {
    splitWallsAtPoints(level, room.polygon);
    for (const [p, q] of G.polygonEdges(room.polygon)) addWallSegment(level, p, q, { status });
    normaliseWalls(level);
  }
  classifyWalls(project, level);
  return room;
}

const SIDES = ['north', 'south', 'east', 'west'];
export function resizeRoom(project, level, room, side, delta) {
  const bb = G.bbox(room.polygon);
  let A;
  let B;
  let n;
  if (side === 'north') [A, B, n] = [{ x: bb.minX, y: bb.minY }, { x: bb.maxX, y: bb.minY }, { x: 0, y: -1 }];
  else if (side === 'south') [A, B, n] = [{ x: bb.minX, y: bb.maxY }, { x: bb.maxX, y: bb.maxY }, { x: 0, y: 1 }];
  else if (side === 'east') [A, B, n] = [{ x: bb.maxX, y: bb.minY }, { x: bb.maxX, y: bb.maxY }, { x: 1, y: 0 }];
  else [A, B, n] = [{ x: bb.minX, y: bb.minY }, { x: bb.minX, y: bb.maxY }, { x: -1, y: 0 }];
  const span = side === 'north' || side === 'south' ? bb.h : bb.w;
  if (span + delta < MIN_ROOM) fail('That would make the room too small');
  pushPull(project, level, A, B, G.mul(n, delta));
}

function exclusiveBoundaryWalls(level, room) {
  const onBoundary = (w, poly) => G.polygonEdges(poly).some(([p, q]) => G.pointOnSegment(w.a, p, q) && G.pointOnSegment(w.b, p, q));
  const others = level.rooms.filter((r) => r !== room && !r.outdoor);
  return level.walls.filter((w) => onBoundary(w, room.polygon) && !others.some((r) => onBoundary(w, r.polygon)));
}

export function deleteEntity(project, id, { keepWalls = false } = {}) {
  const { kind, item, level, list } = need(project, id);
  if (kind === 'level') {
    if (project.levels.length === 1) fail('A design needs at least one level');
    project.levels.splice(project.levels.indexOf(item), 1);
    return { deleted: id, kind };
  }
  if (kind === 'room') {
    level.furniture = level.furniture.filter((f) => !G.pointInPolygon(f, item.polygon));
    if (!keepWalls && !item.outdoor) {
      const gone = new Set(exclusiveBoundaryWalls(level, item).map((w) => w.id));
      level.walls = level.walls.filter((w) => !gone.has(w.id));
      level.openings = level.openings.filter((o) => !gone.has(o.wallId));
    }
  }
  list.splice(list.indexOf(item), 1);
  if (kind === 'wall') level.openings = level.openings.filter((o) => o.wallId !== id);
  if (kind === 'wall' || kind === 'room') classifyWalls(project, level);
  return { deleted: id, kind };
}

// Openings, furniture, site ----------------------------------------------------
export function addOpening(project, level, args) {
  const kind = oneOf(args.kind ?? 'window', S.OPENING_KINDS, 'kind');
  let wall;
  let offset;
  if (args.wall) {
    const f = need(project, args.wall, 'wall');
    wall = f.item;
    level = f.level;
    offset = args.offset != null ? num(args.offset, 'offset') : G.wallLength(wall) / 2;
  } else {
    const p = { x: num(args.x, 'x'), y: num(args.y, 'y') };
    const hit = G.nearestWall(level, p, 800);
    if (!hit) fail('There is no wall within 0.8 m of that point');
    wall = hit.wall;
    offset = args.offset != null ? num(args.offset, 'offset') : hit.offset;
  }
  const o = S.createOpening({
    wallId: wall.id,
    kind,
    offset,
    width: num(args.width, 'width', { min: 300, max: 12000, optional: true }),
    height: num(args.height, 'height', { min: 300, max: 6000, optional: true }),
    sill: num(args.sill, 'sill', { min: 0, max: 3000, optional: true }),
    style: args.style,
    hinge: args.hinge,
    side: args.side,
    status: args.status,
  });
  fitOpening(level, wall, o, { exact: args.exact === true });
  level.openings.push(o);
  return o;
}

function validateFinish(ctx, target, material, colour) {
  try {
    ctx.catalogue?.validateFinish?.(target, material, colour);
  } catch (e) {
    fail(e.message);
  }
}

const FINISH_TARGETS = {
  external_walls: 'externalWalls',
  internal_walls: 'internalWalls',
  roof: 'roof',
  fascia: 'fascia',
  frames: 'frames',
  floors: 'floors',
};

export function mirrorPlan(project, axis) {
  oneOf(axis, ['left_right', 'top_bottom'], 'axis');
  const bb = G.projectBounds(project);
  if (!bb) return;
  const lr = axis === 'left_right';
  const f = (p) => (lr ? { x: Math.round(2 * bb.cx - p.x), y: p.y } : { x: p.x, y: Math.round(2 * bb.cy - p.y) });
  for (const l of project.levels) {
    for (const w of l.walls) {
      w.a = f(w.a);
      w.b = f(w.b);
    }
    for (const o of l.openings) o.side = -(o.side || 1);
    for (const r of l.rooms) r.polygon = r.polygon.map(f);
    for (const it of [...l.furniture, ...l.stairs]) {
      const p = f(it);
      it.x = p.x;
      it.y = p.y;
      it.rotation = lr ? -it.rotation : 180 - it.rotation;
    }
    for (const st of l.stairs) if (st.turn) st.turn = st.turn === 'left' ? 'right' : 'left'; // a mirror swaps hands
    for (const v of l.voids || []) v.polygon = v.polygon.map(f);
    if (l.roof?.gablets) {
      const swap = lr ? { e: 'w', w: 'e' } : { n: 's', s: 'n' };
      l.roof.gablets = l.roof.gablets.map((g) => ({ ...g, ...f(g), ...(Array.isArray(g.ends) ? { ends: g.ends.map((e) => swap[e] || e) } : {}) }));
    }
    classifyWalls(project, l);
  }
  for (const t of project.site.tanks) {
    const p = f(t);
    t.x = p.x;
    t.y = p.y;
  }
}

// Registry ---------------------------------------------------------------------
// Floor to floor height of a level in mm: up to the next level, else the project default.
function floorRiseOf(project, level) {
  const up = project.levels.filter((l) => l.elevation > level.elevation).sort((x, y) => x.elevation - y.elevation)[0];
  return up ? up.elevation - level.elevation : project.settings.floorToFloor || 3000;
}

const HALF_WALL_MM = 1000;
// Half height walls along the void edges that are not already against a wall (90 mm thick, 1000 mm high).
function voidHalfWalls(project, level, v) {
  const n = v.polygon.length;
  for (let i = 0; i < n; i++) {
    const a = v.polygon[i];
    const b = v.polygon[(i + 1) % n];
    if (G.dist(a, b) < 300) continue;
    const mid = G.lerp(a, b, 0.5);
    const d = G.norm(G.sub(b, a));
    const against = level.walls.some((w) => Math.abs(G.dot(d, G.wallDir(w))) > 0.95 && G.projectToSegment(mid, w.a, w.b).d < (w.thickness || 100) / 2 + 150);
    if (against) continue;
    splitWallsAtPoints(level, [a, b]);
    addWallSegment(level, a, b, { thickness: 90, height: HALF_WALL_MM, status: v.status || 'new' });
  }
  normaliseWalls(level);
  classifyWalls(project, level);
}

// Cut the stair well in the floor of the level above a stair.
function cutStairVoid(project, level, stair, rail, rise) {
  const upper = project.levels.filter((l) => l.elevation > level.elevation).sort((x, y) => x.elevation - y.elevation)[0];
  if (!upper) fail('There is no level above for the stair void');
  if (!Array.isArray(upper.voids)) upper.voids = [];
  const v = S.createVoid({ polygon: stairLayout(stair, rise).voidPoly.map((q) => ({ x: Math.round(q.x), y: Math.round(q.y) })), rail, stairId: stair.id });
  upper.voids.push(v);
  if (rail === 'half_wall') voidHalfWalls(project, upper, v);
  return v;
}

const P = {
  num: (description) => ({ type: 'number', description }),
  str: (description) => ({ type: 'string', description }),
  bool: (description) => ({ type: 'boolean', description }),
  enm: (values, description) => ({ type: 'string', enum: values, description }),
  ids: (description) => ({ type: 'array', items: { type: 'string' }, description }),
  points: (description) => ({
    type: 'array',
    items: { type: 'object', properties: { x: { type: 'number' }, y: { type: 'number' } }, required: ['x', 'y'] },
    description,
  }),
};
const LEVEL = P.str('Level id or name. Defaults to the active level.');
const STATUS_P = P.enm(S.STATUS, 'Extension status. Default new.');

export const OPS = {
  add_room: {
    label: 'Add room',
    description: 'Add a rectangular room. (x, y) is the north-west (top-left) corner in mm; width runs east (+x), depth runs south (+y). Walls are created on edges that are not already walled. Decks, patios and carports get no walls by default.',
    params: {
      level: LEVEL,
      name: P.str('Room name, e.g. "Bed 2"'),
      type: P.enm(S.ROOM_TYPES, 'Room type'),
      x: P.num('West edge, mm'),
      y: P.num('North edge, mm'),
      width: P.num('East-west size, mm'),
      depth: P.num('North-south size, mm'),
      walls: P.bool('Create walls (default true for indoor rooms)'),
      status: STATUS_P,
    },
    required: ['type', 'x', 'y', 'width', 'depth'],
    run(p, a, ctx) {
      const level = getLevel(p, a.level, ctx);
      const poly = G.rectPolygon(num(a.x, 'x'), num(a.y, 'y'), num(a.width, 'width', { min: MIN_ROOM, max: 100000 }), num(a.depth, 'depth', { min: MIN_ROOM, max: 100000 }));
      return { id: addRoom(p, level, { name: a.name, type: a.type, polygon: poly, walls: a.walls, status: a.status }).id };
    },
  },
  add_room_polygon: {
    label: 'Add room',
    description: 'Add a room with any outline, given as corner points in mm in order.',
    params: { level: LEVEL, name: P.str('Room name'), type: P.enm(S.ROOM_TYPES, 'Room type'), points: P.points('Corner points in order'), walls: P.bool('Create walls'), status: STATUS_P },
    required: ['type', 'points'],
    run(p, a, ctx) {
      const level = getLevel(p, a.level, ctx);
      const pts = (a.points || []).map((q, i) => ({ x: num(q.x, `points[${i}].x`), y: num(q.y, `points[${i}].y`) }));
      return { id: addRoom(p, level, { name: a.name, type: a.type, polygon: pts, walls: a.walls, status: a.status }).id };
    },
  },
  update_room: {
    label: 'Edit room',
    description: 'Rename or retype a room, set its floor finish, or set deck options.',
    params: {
      id: P.str('Room id'),
      name: P.str('New name'),
      type: P.enm(S.ROOM_TYPES, 'New type'),
      floor_material: P.str('Floor material id'),
      floor_colour: P.str('Floor colour id'),
      roofed: P.bool('Outdoor area sits under the main roof'),
      balustrade: P.bool('Show a balustrade around a deck'),
      status: STATUS_P,
    },
    required: ['id'],
    run(p, a, ctx) {
      const { item: r } = need(p, a.id, 'room');
      if (a.name != null) r.name = String(a.name).slice(0, 60);
      if (a.type != null) r.type = oneOf(a.type, S.ROOM_TYPES, 'type');
      if (a.floor_material != null || a.floor_colour != null) {
        validateFinish(ctx, 'floors', a.floor_material, a.floor_colour);
        r.floor = { ...(r.floor || {}), ...(a.floor_material != null ? { material: a.floor_material } : {}), ...(a.floor_colour != null ? { colour: a.floor_colour } : {}) };
      }
      if (a.roofed != null) r.roofed = !!a.roofed;
      if (a.balustrade != null) r.balustrade = !!a.balustrade;
      if (a.status != null) r.status = oneOf(a.status, S.STATUS, 'status');
      return { id: r.id };
    },
  },
  resize_room: {
    label: 'Resize room',
    description: 'Push or pull one side of a room. Positive delta grows the room outward on that side. Walls on that side move and connected walls stretch; a neighbouring room on that side shrinks. north = top of plan (-y), south = +y, east = +x, west = -x.',
    params: { id: P.str('Room id'), side: P.enm(SIDES, 'Side to move'), delta: P.num('Distance in mm, positive grows the room') },
    required: ['id', 'side', 'delta'],
    run(p, a) {
      const { item, level } = need(p, a.id, 'room');
      resizeRoom(p, level, item, oneOf(a.side, SIDES, 'side'), num(a.delta, 'delta', { min: -50000, max: 50000 }));
      return { id: item.id };
    },
  },
  add_wall: {
    label: 'Add wall',
    description: 'Add a straight wall between two points (mm).',
    params: { level: LEVEL, x1: P.num('Start x'), y1: P.num('Start y'), x2: P.num('End x'), y2: P.num('End y'), thickness: P.num('Thickness in mm (default automatic)'), status: STATUS_P },
    required: ['x1', 'y1', 'x2', 'y2'],
    run(p, a, ctx) {
      const level = getLevel(p, a.level, ctx);
      const A = { x: num(a.x1, 'x1'), y: num(a.y1, 'y1') };
      const B = { x: num(a.x2, 'x2'), y: num(a.y2, 'y2') };
      if (G.dist(A, B) < 100) fail('Wall must be at least 100 mm long');
      splitWallsAtPoints(level, [A, B]);
      const made = addWallSegment(level, A, B, { thickness: num(a.thickness, 'thickness', { min: 50, max: 600, optional: true }), status: a.status });
      normaliseWalls(level);
      classifyWalls(p, level);
      return { ids: made.map((w) => w.id).filter((id) => level.walls.some((w) => w.id === id)) };
    },
  },
  update_wall: {
    label: 'Edit wall',
    description: 'Change a wall thickness, height, extension status or give it its own external finish.',
    params: {
      id: P.str('Wall id'),
      thickness: P.num('Thickness mm'),
      height: P.num('Wall height mm (omit to follow the level)'),
      status: STATUS_P,
      finish_material: P.str('Wall material id for this wall only'),
      finish_colour: P.str('Wall colour id for this wall only'),
      clear_finish: P.bool('Remove this wall’s own finish so it follows the house'),
    },
    required: ['id'],
    run(p, a, ctx) {
      const { item: w, level } = need(p, a.id, 'wall');
      if (a.thickness != null) {
        w.thickness = num(a.thickness, 'thickness', { min: 50, max: 600 });
        w.auto = false;
      }
      if (a.height !== undefined) w.height = a.height === null ? null : num(a.height, 'height', { min: 300, max: 9000 });
      if (a.status != null) w.status = oneOf(a.status, S.STATUS, 'status');
      if (a.clear_finish) w.finish = null;
      if (a.finish_material != null || a.finish_colour != null) {
        validateFinish(ctx, w.kind === 'interior' ? 'internal_walls' : 'external_walls', a.finish_material, a.finish_colour);
        w.finish = { ...(w.finish || {}), ...(a.finish_material != null ? { material: a.finish_material } : {}), ...(a.finish_colour != null ? { colour: a.finish_colour } : {}) };
      }
      classifyWalls(p, level);
      return { id: w.id };
    },
  },
  move_wall: {
    label: 'Move wall',
    description: 'Move a wall by (dx, dy) mm. Walls connected to it stretch and rooms bounded by it change shape.',
    params: { id: P.str('Wall id'), dx: P.num('mm east'), dy: P.num('mm south') },
    required: ['id'],
    run(p, a) {
      const { item: w, level } = need(p, a.id, 'wall');
      pushPull(p, level, { ...w.a }, { ...w.b }, { x: num(a.dx ?? 0, 'dx'), y: num(a.dy ?? 0, 'dy') });
      return { id: w.id };
    },
  },
  add_opening: {
    label: 'Add opening',
    description: 'Add a window, door, sliding door, garage door, roller door or plain opening to a wall. Give either the wall id (with optional offset of the opening centre from the wall start) or a point (x, y) near the wall.',
    params: {
      level: LEVEL,
      wall: P.str('Wall id'),
      x: P.num('Point near the wall, mm'),
      y: P.num('Point near the wall, mm'),
      kind: P.enm(S.OPENING_KINDS, 'Opening kind'),
      offset: P.num('Distance from wall start to opening centre, mm'),
      width: P.num('Width mm'),
      height: P.num('Height mm'),
      sill: P.num('Sill height mm (windows)'),
      style: P.str('Window style: sliding, awning, fixed, double_hung, louvre'),
      hinge: P.enm(['a', 'b'], 'Door hinge end'),
      side: P.num('Door swing side: 1 or -1'),
      exact: P.bool('Never move or narrow the opening: report a problem when it does not fit'),
      status: STATUS_P,
    },
    required: ['kind'],
    run(p, a, ctx) {
      return { id: addOpening(p, getLevel(p, a.level, ctx), a).id };
    },
  },
  update_opening: {
    label: 'Edit opening',
    description: 'Change an opening size, position along its wall, style or swing.',
    params: { id: P.str('Opening id'), width: P.num('Width mm'), height: P.num('Height mm'), sill: P.num('Sill mm'), offset: P.num('Centre offset from wall start mm'), style: P.str('Window style'), hinge: P.enm(['a', 'b'], 'Door hinge end'), side: P.num('1 or -1'), status: STATUS_P },
    required: ['id'],
    run(p, a) {
      const { item: o, level } = need(p, a.id, 'opening');
      const wall = level.walls.find((w) => w.id === o.wallId);
      if (a.width != null) o.width = num(a.width, 'width', { min: 300, max: 12000 });
      if (a.height != null) o.height = num(a.height, 'height', { min: 300, max: 6000 });
      if (a.sill != null) o.sill = num(a.sill, 'sill', { min: 0, max: 3000 });
      if (a.offset != null) o.offset = num(a.offset, 'offset');
      if (a.style != null) o.style = String(a.style);
      if (a.hinge != null) o.hinge = oneOf(a.hinge, ['a', 'b'], 'hinge');
      if (a.side != null) o.side = Number(a.side) < 0 ? -1 : 1;
      if (a.status != null) o.status = oneOf(a.status, S.STATUS, 'status');
      fitOpening(level, wall, o);
      return { id: o.id };
    },
  },
  add_furniture: {
    label: 'Add furniture',
    description: 'Place a furniture item from the catalogue at (x, y) mm, or in the middle of a room.',
    params: { level: LEVEL, item: P.str('Catalogue item id'), x: P.num('Centre x mm'), y: P.num('Centre y mm'), room: P.str('Room id to place it in'), rotation: P.num('Degrees clockwise'), w: P.num('Override width mm'), d: P.num('Override depth mm') },
    required: ['item'],
    run(p, a, ctx) {
      let level = getLevel(p, a.level, ctx);
      const item = String(a.item || '');
      if (!item) fail('item is required');
      if (ctx.catalogue?.getFurniture && !ctx.catalogue.getFurniture(item)) fail(`Unknown furniture item ${item}`);
      let { x, y } = a;
      if ((x == null || y == null) && a.room) {
        const r = need(p, a.room, 'room');
        level = r.level;
        const c = G.polygonCentroid(r.item.polygon);
        x = c.x;
        y = c.y;
      }
      const f = S.createFurniture({
        item,
        x: Math.round(num(x, 'x')),
        y: Math.round(num(y, 'y')),
        rotation: num(a.rotation ?? 0, 'rotation', { min: -3600, max: 3600 }),
        w: num(a.w, 'w', { min: 100, max: 20000, optional: true }) ?? null,
        d: num(a.d, 'd', { min: 100, max: 20000, optional: true }) ?? null,
      });
      level.furniture.push(f);
      return { id: f.id };
    },
  },
  update_furniture: {
    label: 'Edit furniture',
    description: 'Move, rotate or resize a furniture item.',
    params: { id: P.str('Furniture id'), x: P.num('Centre x mm'), y: P.num('Centre y mm'), rotation: P.num('Degrees clockwise'), w: P.num('Width mm'), d: P.num('Depth mm') },
    required: ['id'],
    run(p, a) {
      const { item: f } = need(p, a.id, 'furniture');
      if (a.x != null) f.x = Math.round(num(a.x, 'x'));
      if (a.y != null) f.y = Math.round(num(a.y, 'y'));
      if (a.rotation != null) f.rotation = num(a.rotation, 'rotation', { min: -3600, max: 3600 }) % 360;
      if (a.w != null) f.w = num(a.w, 'w', { min: 100, max: 20000 });
      if (a.d != null) f.d = num(a.d, 'd', { min: 100, max: 20000 });
      return { id: f.id };
    },
  },
  move: {
    label: 'Move',
    description: 'Move furniture, a tank, stairs, an opening (slides along its wall), a wall, or an outdoor room by (dx, dy) mm.',
    params: { id: P.str('Element id'), dx: P.num('mm east'), dy: P.num('mm south') },
    required: ['id'],
    run(p, a) {
      const dx = num(a.dx ?? 0, 'dx');
      const dy = num(a.dy ?? 0, 'dy');
      const { kind, item, level } = need(p, a.id);
      if (kind === 'furniture' || kind === 'tank' || kind === 'stair') {
        item.x = Math.round(item.x + dx);
        item.y = Math.round(item.y + dy);
      } else if (kind === 'opening') {
        const wall = level.walls.find((w) => w.id === item.wallId);
        item.offset += G.dot({ x: dx, y: dy }, G.wallDir(wall));
        fitOpening(level, wall, item);
      } else if (kind === 'wall') {
        pushPull(p, level, { ...item.a }, { ...item.b }, { x: dx, y: dy });
      } else if (kind === 'room') {
        const walled = level.walls.some((w) => G.polygonEdges(item.polygon).some(([q1, q2]) => G.pointOnSegment(w.a, q1, q2) && G.pointOnSegment(w.b, q1, q2)));
        if (walled && !item.outdoor) fail('Rooms with walls cannot be moved directly. Use resize_room or move_wall.');
        for (const f of level.furniture) {
          if (G.pointInPolygon(f, item.polygon)) {
            f.x = Math.round(f.x + dx);
            f.y = Math.round(f.y + dy);
          }
        }
        item.polygon = item.polygon.map((q) => r1({ x: q.x + dx, y: q.y + dy }));
      } else fail(`A ${kind} cannot be moved`);
      return { id: item.id };
    },
  },
  delete: {
    label: 'Delete',
    description: 'Delete any element by id. Deleting a room also removes walls that only bound that room, and the furniture inside it.',
    params: { id: P.str('Element id'), keep_walls: P.bool('Keep the room walls') },
    required: ['id'],
    run(p, a) {
      return deleteEntity(p, a.id, { keepWalls: !!a.keep_walls });
    },
  },
  set_finish: {
    label: 'Change finish',
    description: 'Set a material and or colour for the whole design: external walls, internal walls, roof, fascia and gutters, window and door frames, or default floors.',
    params: { target: P.enm(Object.keys(FINISH_TARGETS), 'What to change'), material: P.str('Material id'), colour: P.str('Colour id') },
    required: ['target'],
    run(p, a, ctx) {
      const key = FINISH_TARGETS[oneOf(a.target, Object.keys(FINISH_TARGETS), 'target')];
      if (a.material == null && a.colour == null) fail('Give a material or a colour');
      validateFinish(ctx, a.target, a.material, a.colour);
      const f = p.finishes[key] || (p.finishes[key] = {});
      if (a.material != null) f.material = String(a.material);
      if (a.colour != null) f.colour = String(a.colour);
      return { target: a.target };
    },
  },
  set_roof: {
    label: 'Change roof',
    description: 'Set the roof type (hip, dutch gable, gable, skillion, flat), pitch (degrees), eave overhang (mm) or turn the roof off for a level. A dutch gable roof is a hip with a small vertical gablet at each ridge end; gablet_size is the height of the gablet in mm. gablets picks wings and ends one by one: [{ x, y, ends, size }] where (x, y) is a plan point inside the roof wing, ends is a list of n, s, e, w ridge ends (or "ridge" for both, [] for none) and size is the gablet height in mm.',
    params: { level: LEVEL, type: P.enm(S.ROOF_TYPES, 'Roof type'), pitch: P.num('Degrees'), overhang: P.num('Eave overhang mm'), enabled: P.bool('Roof on or off'), gablet_size: P.num('Gablet height mm, 150 to 3000'), gablets: { type: 'array', description: 'Per wing gablets [{ x, y, ends, size }]; an empty list clears them', items: { type: 'object' } } },
    required: [],
    run(p, a, ctx) {
      const level = getLevel(p, a.level, ctx);
      if (a.type != null) level.roof.type = oneOf(a.type, S.ROOF_TYPES, 'type');
      if (a.pitch != null) level.roof.pitch = num(a.pitch, 'pitch', { min: 1, max: 60 });
      if (a.overhang != null) level.roof.overhang = num(a.overhang, 'overhang', { min: 0, max: 1500 });
      if (a.enabled != null) level.roof.enabled = !!a.enabled;
      if (a.gablet_size != null) level.roof.gabletSize = Math.round(num(a.gablet_size, 'gablet_size', { min: 150, max: 3000 }));
      if (a.gablets != null) {
        if (!Array.isArray(a.gablets)) fail('gablets must be a list');
        if (a.gablets.length > 24) fail('At most 24 gablet settings');
        level.roof.gablets = a.gablets.map((g, i) => {
          const o = { x: Math.round(num(g?.x, `gablets[${i}].x`)), y: Math.round(num(g?.y, `gablets[${i}].y`)) };
          if (g.ends != null) {
            if (Array.isArray(g.ends)) o.ends = g.ends.map((e) => oneOf(e, S.GABLET_ENDS, 'gablet end'));
            else o.ends = oneOf(g.ends, [...S.GABLET_ENDS, 'ridge', 'both'], 'gablet ends');
          }
          if (g.size != null) o.size = Math.round(num(g.size, `gablets[${i}].size`, { min: 0, max: 3000 }));
          return o;
        });
        if (!level.roof.gablets.length) delete level.roof.gablets;
      }
      return { level: level.id };
    },
  },
  add_tank: {
    label: 'Add rainwater tank',
    description: 'Add a round rainwater tank. Standard sizes 2000, 5000, 10000 and 22500 litres. Without x and y it is placed beside the building.',
    params: { x: P.num('Centre x mm'), y: P.num('Centre y mm'), capacity_l: P.num('Litres'), colour: P.str('Colour id'), status: STATUS_P },
    required: [],
    run(p, a) {
      const cap = Math.round(num(a.capacity_l ?? 5000, 'capacity_l', { min: 500, max: 100000 }));
      const size = S.tankSize(cap);
      let { x, y } = a;
      if (x == null || y == null) {
        const bb = G.projectBounds(p) || { maxX: 0, minY: 0 };
        x = bb.maxX + 600 + size.diameter / 2;
        y = bb.minY + 300 + size.diameter / 2;
      }
      const t = S.createTank({ x: Math.round(num(x, 'x')), y: Math.round(num(y, 'y')), capacityL: cap, colour: a.colour, status: a.status });
      p.site.tanks.push(t);
      return { id: t.id };
    },
  },
  update_tank: {
    label: 'Edit tank',
    description: 'Change a rainwater tank size, colour or position.',
    params: { id: P.str('Tank id'), capacity_l: P.num('Litres'), colour: P.str('Colour id'), x: P.num('Centre x mm'), y: P.num('Centre y mm') },
    required: ['id'],
    run(p, a) {
      const { item: t } = need(p, a.id, 'tank');
      if (a.capacity_l != null) {
        t.capacityL = Math.round(num(a.capacity_l, 'capacity_l', { min: 500, max: 100000 }));
        Object.assign(t, S.tankSize(t.capacityL));
      }
      if (a.colour != null) t.colour = String(a.colour);
      if (a.x != null) t.x = Math.round(num(a.x, 'x'));
      if (a.y != null) t.y = Math.round(num(a.y, 'y'));
      return { id: t.id };
    },
  },
  mirror_plan: {
    label: 'Flip plan',
    description: 'Mirror the whole design, e.g. to put the garage on the other side. left_right flips east and west; top_bottom flips north and south.',
    params: { axis: P.enm(['left_right', 'top_bottom'], 'Mirror direction') },
    required: ['axis'],
    run(p, a) {
      mirrorPlan(p, a.axis);
      return { axis: a.axis };
    },
  },
  add_level: {
    label: 'Add level',
    description: 'Add a storey above the top level. copy_outline copies the external walls of the level below as a starting point.',
    params: { name: P.str('Level name'), copy_outline: P.bool('Copy external walls from below (default true)') },
    required: [],
    run(p, a) {
      const top = [...p.levels].sort((x, y) => y.elevation - x.elevation)[0];
      const lvl = S.createLevel({
        name: a.name || (p.levels.length === 1 ? 'First' : `Level ${p.levels.length + 1}`),
        elevation: top.elevation + p.settings.floorToFloor,
        height: top.height,
        roof: { ...top.roof },
      });
      if (a.copy_outline !== false) {
        for (const w of top.walls) if (w.kind === 'exterior' && w.status !== 'demolish') lvl.walls.push(S.createWall({ a: { ...w.a }, b: { ...w.b } }));
      }
      p.levels.push(lvl);
      classifyWalls(p, lvl);
      return { id: lvl.id };
    },
  },
  update_level: {
    label: 'Edit level',
    description: 'Rename a level or change its ceiling height or floor level (mm).',
    params: { id: P.str('Level id or name'), name: P.str('New name'), ceiling_height: P.num('Ceiling height mm'), elevation: P.num('Floor level above ground floor mm') },
    required: ['id'],
    run(p, a) {
      const l = getLevel(p, a.id);
      if (a.name != null) l.name = String(a.name).slice(0, 40);
      if (a.ceiling_height != null) l.height = num(a.ceiling_height, 'ceiling_height', { min: 2100, max: 8000 });
      if (a.elevation != null) l.elevation = num(a.elevation, 'elevation', { min: -5000, max: 30000 });
      return { id: l.id };
    },
  },
  add_stair: {
    label: 'Add stairs',
    description: 'Add a stair. By default a straight flight: (x, y) is its centre and length runs along the climb. With shape "L" or "U" the stair has a flat landing and a turn: (x, y) is the centre of the FIRST flight, risers is the total riser count, riser the riser height in mm (default floor to floor / risers), going the tread depth in mm, landing_at the number of the tread that is the landing, turn left or right as the climber sees it, landing_depth the landing depth in mm (default the width) and gap the space between the flights of a U. The first flight length is worked out. void_rail ("balustrade", "half_wall" or "none") also cuts a stair void in the floor of the level above, with that edge protection.',
    params: {
      level: LEVEL, x: P.num('Centre x mm'), y: P.num('Centre y mm'), width: P.num('mm, default 1000'), length: P.num('mm, default 3600 (straight stairs)'), rotation: P.num('Degrees clockwise'),
      shape: P.enm(STAIR_SHAPES, 'straight (default), L or U'), risers: P.num('Total risers, L and U'), riser: P.num('Riser height mm'), going: P.num('Going mm'), landing_at: P.num('Tread number of the landing'),
      turn: P.enm(STAIR_TURNS, 'Turn direction as the climber sees it'), gap: P.num('Gap between the flights of a U, mm'), landing_depth: P.num('Landing depth mm'),
      void_rail: P.enm(S.VOID_RAILS, 'Cut a stair void in the floor above with this edge protection'),
    },
    required: ['x', 'y'],
    run(p, a, ctx) {
      const level = getLevel(p, a.level, ctx);
      const base = { x: Math.round(num(a.x, 'x')), y: Math.round(num(a.y, 'y')), width: num(a.width ?? 1000, 'width', { min: 600, max: 3000 }), rotation: num(a.rotation ?? 0, 'rotation', { min: -3600, max: 3600 }) };
      const shape = a.shape == null ? 'straight' : oneOf(a.shape, STAIR_SHAPES, 'shape');
      const rise = floorRiseOf(p, level);
      let s;
      if (shape === 'straight') s = S.createStair({ ...base, length: num(a.length ?? 3600, 'length', { min: 1000, max: 8000 }) });
      else {
        let P1;
        try { P1 = shapedParams({ shape, risers: a.risers, riser: a.riser, going: a.going, landingAt: a.landing_at, turn: a.turn, gap: a.gap, width: base.width, landingDepth: a.landing_depth }, rise); } catch (e) { fail(e.message); }
        s = S.createStair({ ...base, length: (P1.landingAt - 1) * P1.going, shape, risers: P1.risers, riser: P1.riser, going: P1.going, landingAt: P1.landingAt, turn: P1.turn, ...(shape === 'U' ? { gap: P1.gap } : {}), ...(P1.landingDepth ? { landingDepth: P1.landingDepth } : {}) });
      }
      level.stairs.push(s);
      const out = { id: s.id };
      if (a.void_rail != null) out.voidId = cutStairVoid(p, level, s, oneOf(a.void_rail, S.VOID_RAILS, 'void_rail'), rise).id;
      return out;
    },
  },
  add_void: {
    label: 'Add floor void',
    description: 'Cut an opening in the floor of a level (a stair void) given by its corner points. rail is balustrade (glass and rail on the open edges), half_wall (half height walls on the open edges) or none.',
    params: { level: LEVEL, points: P.points('Corner points in order'), rail: P.enm(S.VOID_RAILS, 'Edge protection, default balustrade') },
    required: ['points'],
    run(p, a, ctx) {
      const level = getLevel(p, a.level, ctx);
      if (!Array.isArray(a.points) || a.points.length < 3) fail('A void needs at least 3 corner points');
      const v = S.createVoid({ polygon: a.points.map((q) => ({ x: Math.round(num(q.x, 'x')), y: Math.round(num(q.y, 'y')) })), rail: a.rail == null ? 'balustrade' : oneOf(a.rail, S.VOID_RAILS, 'rail') });
      level.voids.push(v);
      if (v.rail === 'half_wall') voidHalfWalls(p, level, v);
      return { id: v.id };
    },
  },
  update_void: {
    label: 'Edit floor void',
    description: 'Change the corners or edge protection of a floor void.',
    params: { id: P.str('Void id'), points: P.points('Corner points in order'), rail: P.enm(S.VOID_RAILS, 'Edge protection') },
    required: ['id'],
    run(p, a) {
      const { item: v, level } = need(p, a.id, 'void');
      if (a.points != null) {
        if (!Array.isArray(a.points) || a.points.length < 3) fail('A void needs at least 3 corner points');
        v.polygon = a.points.map((q) => ({ x: Math.round(num(q.x, 'x')), y: Math.round(num(q.y, 'y')) }));
      }
      if (a.rail != null) v.rail = oneOf(a.rail, S.VOID_RAILS, 'rail');
      if (v.rail === 'half_wall') voidHalfWalls(p, level, v);
      return { id: v.id };
    },
  },
  set_status: {
    label: 'Set status',
    description: 'Mark walls, rooms, openings or tanks as existing, new or to be demolished. ids ["*"] means everything.',
    params: { ids: P.ids('Element ids, or ["*"] for all'), status: P.enm(S.STATUS, 'Status') },
    required: ['ids', 'status'],
    run(p, a) {
      const status = oneOf(a.status, S.STATUS, 'status');
      if (!Array.isArray(a.ids) || !a.ids.length) fail('ids must be a non-empty list');
      const all = a.ids.includes('*');
      let count = 0;
      for (const l of p.levels) {
        for (const key of ['walls', 'rooms', 'openings']) {
          for (const e of l[key]) {
            if (all || a.ids.includes(e.id)) {
              e.status = status;
              count++;
            }
          }
        }
      }
      for (const t of p.site.tanks) {
        if (all || a.ids.includes(t.id)) {
          t.status = status;
          count++;
        }
      }
      return { count };
    },
  },
  move_house: {
    label: 'Move house',
    description: 'Move the whole house (walls, rooms, furniture and stairs on every level) on the lot by dx east and dy south, in mm. Tanks beside the house move with it. Needs a lot on the site. Use check_setbacks afterwards when setbacks matter.',
    params: { dx: { ...P.num('mm east (+x), west is negative'), minimum: -100000, maximum: 100000 }, dy: { ...P.num('mm south (+y), north is negative'), minimum: -100000, maximum: 100000 } },
    required: ['dx', 'dy'],
    run(p, a) {
      if (!SITE.lotOf(p)) fail('No lot is loaded for this design, so the house cannot be positioned on a lot.');
      const dx = num(a.dx, 'dx', { min: -100000, max: 100000 });
      const dy = num(a.dy, 'dy', { min: -100000, max: 100000 });
      SITE.translateHouse(p, dx, dy);
      settleSiteItems(p);
      return { dx, dy };
    },
  },
  rotate_house: {
    label: 'Rotate house',
    description: 'Rotate the whole house about its centre by an angle in degrees clockwise on screen (negative is anticlockwise). Needs a lot on the site.',
    params: { degrees: { ...P.num('Degrees clockwise, between -360 and 360'), minimum: -360, maximum: 360 } },
    required: ['degrees'],
    run(p, a) {
      if (!SITE.lotOf(p)) fail('No lot is loaded for this design, so the house cannot be positioned on a lot.');
      const deg = num(a.degrees, 'degrees', { min: -360, max: 360 });
      SITE.rotateHouse(p, deg, SITE.houseCentre(p));
      settleSiteItems(p);
      return { degrees: deg };
    },
  },
  set_floor_level: {
    label: 'Floor level',
    description: 'Set the finished floor level (FFL) of the ground floor as a reduced level in metres (RL, m AHD) on the lot. Needs a lot on the site. Do not use millimetres.',
    params: { rl: { ...P.num('Reduced level in metres, e.g. 101.35'), minimum: -50, maximum: 3500 } },
    required: ['rl'],
    run(p, a) {
      const lot = SITE.lotOf(p);
      if (!lot) fail('No lot is loaded for this design, so a floor level cannot be set.');
      const rl = num(a.rl, 'rl', { min: -50, max: 3500 });
      const fall = SITE.fallAcross(p);
      if (fall && Math.abs(rl - fall.meanRL) > 5) fail(`A floor level of RL ${rl} m is more than 5 m from the ground on this lot (about RL ${fall.meanRL.toFixed(1)} m). Check the value is in metres.`);
      p.site.lot.floorRL = Math.round(rl * 1000) / 1000;
      p.site.lot.floorRLAuto = false;
      return { rl: p.site.lot.floorRL };
    },
  },
  check_setbacks: {
    label: 'Check setbacks',
    description: 'Check the design against the lot setback envelope and report any breach for each boundary in metres. Changes nothing. If the lot has no setbacks loaded it says so; never state setback values yourself.',
    params: {},
    required: [],
    run(p) {
      const r = SITE.checkSetbacks(p);
      return { changed: false, status: r.status, breaches: r.breaches, report: r.message };
    },
  },
  suggest_site_position: {
    label: 'Suggest site position',
    description: 'Find a position for the whole house inside the setback envelope. align is centre (default), front (as close to the front boundary as the setbacks allow) or rear. Set apply true to move the house there; otherwise it only reports the move. Needs setbacks or an envelope on the lot.',
    params: { align: P.enm(['centre', 'front', 'rear'], 'Where to sit the house in the envelope'), apply: P.bool('Move the house to the suggested position (default false)') },
    required: [],
    run(p, a) {
      if (!SITE.lotOf(p)) fail('No lot is loaded for this design, so there is no site position to suggest.');
      const s = SITE.suggestPosition(p, a.align || 'centre');
      if (!s.ok) {
        if (s.reason === 'setbacks_not_loaded') fail(SITE.NOT_LOADED);
        fail(s.reason === 'no_building' ? 'There is no building on the plan to position.' : s.reason === 'no_room' ? 'The setbacks leave no room to build on this lot.' : 'The setback envelope is not available for this lot shape.');
      }
      const mm = (v) => `${(Math.abs(v) / 1000).toFixed(2)} m`;
      const move = `${mm(s.dx)} ${s.dx >= 0 ? 'east' : 'west'} and ${mm(s.dy)} ${s.dy >= 0 ? 'south' : 'north'}`;
      if (s.fits) {
        if (a.apply === true) {
          SITE.translateHouse(p, s.dx, s.dy);
          settleSiteItems(p);
          return { fits: true, dx: s.dx, dy: s.dy, report: `Moved the house ${move} so it sits inside the setbacks.` };
        }
        return { changed: false, fits: true, dx: s.dx, dy: s.dy, report: `Moving the house ${move} puts it inside the setbacks.` };
      }
      // As drawn it does not fit: try turning it square to the lot and the lot planner's pose before giving up.
      const f = fitHouse(p);
      if (f.ok && f.fits) {
        if (a.apply === true) {
          if (f.rotateDeg) SITE.rotateHouse(p, f.rotateDeg, SITE.houseCentre(p));
          SITE.translateHouse(p, f.dx, f.dy);
          settleSiteItems(p);
          return { fits: true, dx: f.dx, dy: f.dy, rotateDeg: f.rotateDeg, report: f.message };
        }
        return { changed: false, fits: true, report: f.message.replace(/^Moved/, 'Moving') };
      }
      if (a.apply === true) fail(f.message || 'This house does not fit inside the setbacks.');
      return { changed: false, fits: false, report: f.message || 'This house does not fit inside the setbacks.' };
    },
  },
  set_project: {
    label: 'Project details',
    description: 'Rename the design or change its type.',
    params: { name: P.str('Design name'), type: P.enm(S.PROJECT_TYPES, 'Design type') },
    required: [],
    run(p, a) {
      if (a.name != null) {
        p.name = String(a.name).slice(0, 80);
        p.nameEdited = true; // a name the person typed is kept when they change the home
      }
      if (a.type != null) {
        const t = oneOf(a.type, S.PROJECT_TYPES, 'type');
        if (t !== p.type) delete p.designType; // the design type is read from the new type
        p.type = t;
      }
      return { id: p.id };
    },
  },
};

export function applyOp(project, name, args = {}, ctx = {}) {
  const op = OPS[name] || COMMERCIAL_OPS[name];
  if (!op) fail(`Unknown operation ${name}`);
  const res = op.run(project, args || {}, ctx) ?? {};
  project.updatedAt = new Date().toISOString();
  return res;
}

// Anthropic tool definitions generated from the registry.
// enums: { furniture: [...ids], materials: [...ids], colours: [...ids] } are injected when given.
export function toolSchemas(enums = {}, mode = null) {
  if (mode === 'commercial') return commercialToolSchemas();
  return Object.entries(OPS).map(([name, op]) => {
    const properties = structuredClone(op.params);
    if (enums.furniture && properties.item) properties.item.enum = enums.furniture;
    for (const key of ['material', 'floor_material', 'finish_material']) if (enums.materials && properties[key]) properties[key].enum = enums.materials;
    for (const key of ['colour', 'floor_colour', 'finish_colour']) if (enums.colours && properties[key]) properties[key].enum = enums.colours;
    return { name, description: op.description, input_schema: { type: 'object', properties, required: op.required || [] } };
  });
}

// Furniture that clips a wall on its level. sizeOf(item) => { w, d } from the catalogue.
// Returns [{ furnitureId, wallId, levelId }]. Overlaps under 15 mm are ignored.
export function furnitureClashes(project, sizeOf = () => null) {
  const out = [];
  for (const level of project.levels) {
    for (const f of level.furniture) {
      const def = sizeOf(f.item) || {};
      const w = f.w ?? def.w;
      const d = f.d ?? def.d;
      if (!w || !d) continue;
      const box = G.rectCorners(f.x, f.y, w, d, f.rotation || 0);
      for (const wall of level.walls) {
        if (wall.status === 'demolish') continue;
        if (G.convexOverlap(box, G.wallPolygon(wall), 15)) {
          out.push({ furnitureId: f.id, wallId: wall.id, levelId: level.id });
          break;
        }
      }
    }
  }
  return out;
}

Object.assign(OPS, {
  update_stair: {
    label: 'Edit stairs',
    description: 'Move, resize or rotate stairs. For an L or U stair the riser, going, landing, turn and gap can be changed too.',
    params: { id: P.str('Stair id'), x: P.num('Centre x mm'), y: P.num('Centre y mm'), width: P.num('mm'), length: P.num('mm'), rotation: P.num('Degrees clockwise'), risers: P.num('Total risers (L and U)'), riser: P.num('Riser height mm (L and U)'), going: P.num('Going mm (L and U)'), landing_at: P.num('Landing tread number (L and U)'), turn: P.enm(STAIR_TURNS, 'Turn direction'), gap: P.num('Gap between U flights mm'), landing_depth: P.num('Landing depth mm') },
    required: ['id'],
    run(p, a) {
      const { item: s, level } = need(p, a.id, 'stair');
      if (a.x != null) s.x = Math.round(num(a.x, 'x'));
      if (a.y != null) s.y = Math.round(num(a.y, 'y'));
      if (a.width != null) s.width = num(a.width, 'width', { min: 600, max: 3000 });
      if (a.length != null && !isShaped(s)) s.length = num(a.length, 'length', { min: 1000, max: 8000 });
      if (a.rotation != null) s.rotation = num(a.rotation, 'rotation', { min: -3600, max: 3600 }) % 360;
      if (isShaped(s) && ['risers', 'riser', 'going', 'landing_at', 'turn', 'gap', 'landing_depth'].some((k) => a[k] != null)) {
        const merged = { shape: s.shape, risers: a.risers ?? s.risers, riser: a.riser ?? s.riser, going: a.going ?? s.going, landingAt: a.landing_at ?? s.landingAt, turn: a.turn ?? s.turn, gap: a.gap ?? s.gap, width: s.width, landingDepth: a.landing_depth ?? s.landingDepth };
        let P1;
        try { P1 = shapedParams(merged, floorRiseOf(p, level)); } catch (e) { fail(e.message); }
        Object.assign(s, { risers: P1.risers, riser: P1.riser, going: P1.going, landingAt: P1.landingAt, turn: P1.turn, length: (P1.landingAt - 1) * P1.going });
        if (s.shape === 'U') s.gap = P1.gap;
        if (P1.landingDepth) s.landingDepth = P1.landingDepth;
      } else if (isShaped(s) && a.width != null) s.length = (s.landingAt - 1) * s.going;
      return { id: s.id };
    },
  },
  set_site: {
    label: 'Site settings',
    description: 'Set the north arrow direction in degrees clockwise from the top of the plan.',
    params: { north_deg: P.num('Degrees') },
    required: [],
    run(p, a) {
      if (a.north_deg != null) p.site.northDeg = num(a.north_deg, 'north_deg', { min: -360, max: 360 });
      return {};
    },
  },
  set_wall_defaults: {
    label: 'Wall thickness',
    description: 'Set the default external and internal wall thickness in mm. Every wall that has not been given its own thickness updates.',
    params: { external: P.num('External wall mm, e.g. 250 brick veneer, 150 weatherboard'), internal: P.num('Internal wall mm, e.g. 100') },
    required: [],
    run(p, a) {
      if (a.external != null) p.settings.extWall = num(a.external, 'external', { min: 50, max: 600 });
      if (a.internal != null) p.settings.intWall = num(a.internal, 'internal', { min: 50, max: 400 });
      for (const l of p.levels) classifyWalls(p, l);
      return {};
    },
  },
});

Object.assign(OPS, {
  set_titleblock: {
    label: 'Title block',
    description: 'Fill in drawing title block fields: projectName, client, address, lotDp, council, company, drawnBy, checkedBy, jobNumber, drawingPrefix, revision, issuePurpose, date, notes.',
    params: Object.fromEntries(S.TITLE_BLOCK_FIELDS.map(([k, label]) => [k, P.str(label)])),
    required: [],
    run(p, a) {
      p.titleBlock = { ...S.defaultTitleBlock(), ...(p.titleBlock || {}) };
      for (const [k] of S.TITLE_BLOCK_FIELDS) if (a[k] != null) p.titleBlock[k] = String(a[k]).slice(0, 200);
      return {};
    },
  },
  add_existing_building: {
    label: 'Existing building',
    description: 'Place an existing building on the lot as a named rectangle (an existing dwelling, for instance). It is drawn on the site plan sheets as existing work and in 3D as a light grey block. x and y are the centre in plan mm; width, depth and height are in mm.',
    params: { name: P.str('Label, e.g. EXISTING DWELLING'), x: P.num('Centre x, plan mm'), y: P.num('Centre y, plan mm'), width: P.num('Width mm'), depth: P.num('Depth mm'), rotation: P.num('Rotation degrees'), height: P.num('Height mm') },
    required: ['x', 'y'],
    run(p, a) {
      const rec = addExistingBuilding(p, { name: a.name, x: a.x, y: a.y, widthMm: a.width, depthMm: a.depth, rotationDeg: a.rotation, heightMm: a.height });
      return { id: rec.id };
    },
  },
  update_existing_building: {
    label: 'Change existing building',
    description: 'Change an existing building placed on the lot: its name, centre (x, y in plan mm), width, depth (mm) and rotation (degrees). Only the fields given change.',
    params: { id: P.str('Existing building id'), name: P.str('Label'), x: P.num('Centre x, plan mm'), y: P.num('Centre y, plan mm'), width: P.num('Width mm'), depth: P.num('Depth mm'), rotation: P.num('Rotation degrees') },
    required: ['id'],
    run(p, a) {
      if (!updateExistingBuilding(p, a.id, { name: a.name, x: a.x, y: a.y, widthMm: a.width, depthMm: a.depth, rotationDeg: a.rotation })) fail('No existing building has that id');
      return {};
    },
  },
  remove_existing_building: {
    label: 'Remove existing building',
    description: 'Remove an existing building placed on the lot, by id.',
    params: { id: P.str('Existing building id') },
    required: ['id'],
    run(p, a) {
      if (!removeExistingBuilding(p, a.id)) fail('No existing building has that id');
      return {};
    },
  },
  set_drawing: {
    label: 'Drawing settings',
    description: 'Set the drawing scale (auto, 20, 50, 100, 200 or 500 meaning 1:n) and paper size (A3 or A1) for exported plans.',
    params: { scale: P.str('auto or 1:n as a number'), paper: P.enm(S.PAPER_SIZES, 'Paper size'), includeAerial: P.bool('Include the aerial underlay on exported plan sheets (default on)') },
    required: [],
    run(p, a) {
      p.drawing = { scale: 'auto', paper: 'A3', ...(p.drawing || {}) };
      if (a.scale != null) {
        const v = a.scale === 'auto' ? 'auto' : Number(a.scale);
        if (!S.DRAWING_SCALES.includes(v)) fail('scale must be auto, 20, 50, 100, 200 or 500');
        p.drawing.scale = v;
      }
      if (a.paper != null) p.drawing.paper = oneOf(a.paper, S.PAPER_SIZES, 'paper');
      if (a.includeAerial != null) p.drawing.includeAerial = a.includeAerial !== false;
      return {};
    },
  },
});
