// Room snapping, pure logic (no three, no DOM): tab derivation, captions, eye viewpoints and cutaway poses.
// Units: the project is in millimetres (plan x, y); returned poses are in metres in world space (X = x / 1000, Z = y / 1000,
// Y = level elevation / 1000 plus height). rooms.js wraps these for the viewer.

import * as G from '../model/geometry.js';
import { getFurniture } from '../catalogue/furniture.js';

export const EYE_HEIGHT = 1.6; // m above the finished floor level
export const MIN_WALL_CLEAR = 0.4; // m from wall faces and room edges
export const ROOM_FOV = 70;
export const ORBIT_FOV = 38;

// Room grouping ------------------------------------------------------------------------------------
const AUX_TYPES = new Set(['bathroom', 'ensuite', 'wc', 'laundry', 'robe', 'pantry', 'store', 'hall', 'entry', 'workshop', 'study']);
const clean = (s) => String(s ?? '').replace(/[‐-―−-]+/g, ' ').replace(/\s+/g, ' ').trim();
const lower = (s) => clean(s).toLowerCase();

export function isGarage(r) {
  return r.type === 'garage' || /garage/.test(lower(r.name));
}
export function isAlfresco(r) {
  if (r.type === 'carport') return false;
  return ['alfresco', 'patio', 'deck', 'verandah'].includes(r.type) || /alfresco|patio|\bdeck\b|verandah|outdoor|terrace|balcony/.test(lower(r.name));
}
export function isBedroom(r) {
  if (AUX_TYPES.has(r.type) || isGarage(r) || isAlfresco(r)) return false;
  return r.type === 'bedroom' || (r.type === 'other' && /\bbed(room)?\b|master/.test(lower(r.name)));
}
const isMasterName = (r) => /master|main bed|primary|\bbed(room)? ?(no\.? ?)?1\b/.test(lower(r.name));

// The tab groups a room belongs to by type and name. An open plan room (e.g. "Kitchen, dining and family") belongs to several.
export function groupsOfRoom(r) {
  const g = [];
  const name = lower(r.name);
  if (isGarage(r)) return ['garage'];
  if (isAlfresco(r)) return ['alfresco'];
  if (isBedroom(r)) return ['bedroom'];
  if (['living', 'family', 'rumpus', 'media'].includes(r.type) || (!AUX_TYPES.has(r.type) && /living|lounge|family|rumpus|media|theatre|sitting/.test(name))) g.push('living');
  if (r.type === 'kitchen' || (!AUX_TYPES.has(r.type) && /kitchen/.test(name))) g.push('kitchen');
  if (r.type === 'dining' || (!AUX_TYPES.has(r.type) && /dining|meals/.test(name))) g.push('dining');
  return g;
}

const natural = (a, b) => String(a).localeCompare(String(b), undefined, { numeric: true });

function levelOf(project, room) {
  return project.levels.find((l) => l.rooms.some((r) => r.id === room.id));
}
function findRoom(project, roomId) {
  for (const level of project.levels) {
    const room = level.rooms.find((r) => r.id === roomId);
    if (room) return { room, level };
  }
  return null;
}
const sortedLevels = (project) => [...project.levels].sort((a, b) => a.elevation - b.elevation);
const polyOk = (r) => Array.isArray(r.polygon) && r.polygon.length >= 3;
const showable = (r) => r.status !== 'demolish';

export function roomNoun(r) {
  if (isAlfresco(r)) return lower(r.name) || r.type;
  const map = {
    living: 'living room', family: 'family area', kitchen: 'kitchen', dining: 'dining area', bedroom: 'bedroom', bathroom: 'bathroom',
    ensuite: 'ensuite', wc: 'toilet', laundry: 'laundry', garage: 'garage', study: 'study', entry: 'entry', hall: 'hallway', robe: 'robe',
    pantry: 'pantry', media: 'media room', rumpus: 'rumpus room', workshop: 'workshop', store: 'store room',
  };
  if (map[r.type]) return map[r.type];
  const n = lower(r.name);
  return n && !/[,&]| and /.test(n) && n.length <= 24 ? n : 'room';
}

const ORD = ['', 'first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth'];

// Tabs ----------------------------------------------------------------------------------------------
// listRoomTabs(project, levelId?, { groupBedrooms }) -> [{ id, label, roomIds, caption, levelId }]
export function listRoomTabs(project, levelId = null, { groupBedrooms = false } = {}) {
  const levels = sortedLevels(project).filter((l) => !levelId || l.id === levelId);
  const rooms = [];
  for (const l of levels) for (const r of l.rooms) if (polyOk(r) && showable(r)) rooms.push({ room: r, level: l });
  const area = (x) => G.polygonArea(x.room.polygon);
  const tabs = [];
  const make = (id, label, list, extra = {}) => {
    const sorted = [...list].sort((a, b) => area(b) - area(a));
    const tab = { id, label, roomIds: sorted.map((x) => x.room.id), levelId: sorted[0].level.id, ...extra };
    tab.caption = captionFor(project, tab);
    tabs.push(tab);
  };
  const withGroup = (g) => rooms.filter((x) => groupsOfRoom(x.room).includes(g));
  const living = withGroup('living');
  const kitchen = withGroup('kitchen');
  const dining = withGroup('dining');
  if (living.length) make('living', 'Living', living);
  if (kitchen.length) make('kitchen', 'Kitchen', kitchen);
  if (dining.length) make('dining', 'Dining', dining);

  const beds = withGroup('bedroom');
  if (beds.length) {
    const master = beds.find((x) => isMasterName(x.room)) || beds[0];
    const rest = beds
      .filter((x) => x !== master)
      .sort((a, b) => {
        const na = Number(/(\d+)/.exec(a.room.name)?.[1] ?? Infinity);
        const nb = Number(/(\d+)/.exec(b.room.name)?.[1] ?? Infinity);
        return na - nb || a.level.elevation - b.level.elevation || natural(a.room.name, b.room.name);
      });
    if (groupBedrooms) make('bedrooms', 'Bedrooms', beds, { bedN: 0 });
    else {
      make('master', 'Master', [master], { bedN: 1 });
      rest.forEach((x, i) => make(`bed${i + 2}`, `Bed ${i + 2}`, [x], { bedN: i + 2 }));
    }
  }
  const alf = withGroup('alfresco');
  if (alf.length) make('alfresco', 'Alfresco', alf);
  const gar = withGroup('garage');
  if (gar.length) make('garage', 'Garage', gar);
  tabs.push({
    id: 'aerial', label: 'Aerial', roomIds: [], levelId: null,
    caption: 'Aerial view · The whole house and lot from above.',
  });
  return tabs;
}

function tabHead(project, tab) {
  const first = findRoom(project, tab.roomIds[0])?.room;
  switch (tab.id) {
    case 'living': return { head: 'Living area', noun: first && first.type === 'family' ? 'family area' : 'living room' };
    case 'kitchen': return { head: 'Kitchen', noun: 'kitchen' };
    case 'dining': return { head: 'Dining area', noun: 'dining area' };
    case 'master': return { head: 'Master bedroom', noun: 'master bedroom' };
    case 'bedrooms': return { head: 'Bedrooms', noun: 'bedroom' };
    case 'alfresco': return { head: first ? cap(lower(first.name) || 'alfresco') : 'Alfresco', noun: first ? roomNoun(first) : 'alfresco' };
    case 'garage': return { head: 'Garage', noun: 'garage' };
    default: {
      const n = tab.bedN || Number(/^bed(\d+)$/.exec(tab.id)?.[1] || 0);
      return { head: `Bedroom ${n}`, noun: `${ORD[n] || ''} bedroom`.trim() };
    }
  }
}
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);

function captionFor(project, tab) {
  const { head, noun } = tabHead(project, tab);
  const roomId = tab.roomIds[0];
  const group = ['kitchen', 'dining', 'living'].includes(tab.id) ? tab.id : null;
  const focus = roomId ? resolveFocus(project, roomId, group) : null;
  const found = roomId ? findRoom(project, roomId) : null;
  let tail = `A view across the ${noun}.`;
  if (focus?.furniture && found) tail = `A view across the open plan living area ${focus.text}.`;
  else if (focus?.text) tail = `A view across the ${noun} ${focus.text}.`;
  return `${head} · ${tail}`;
}

// Geometry helpers ---------------------------------------------------------------------------------
function furnitureRects(level, pad = 0) {
  const out = [];
  for (const f of level.furniture || []) {
    const item = getFurniture(f.item);
    const w = f.w ?? item?.w ?? 600;
    const d = f.d ?? item?.d ?? 600;
    const c = { x: f.x, y: f.y };
    const hw = w / 2 + pad;
    const hd = d / 2 + pad;
    const poly = [
      { x: c.x - hw, y: c.y - hd }, { x: c.x + hw, y: c.y - hd }, { x: c.x + hw, y: c.y + hd }, { x: c.x - hw, y: c.y + hd },
    ].map((p) => G.rotatePoint(p, c, f.rotation || 0));
    const fr = G.rotatePoint({ x: 0, y: 1 }, { x: 0, y: 0 }, f.rotation || 0); // +y is the front of an item
    out.push({ id: f.id, item, poly, c, h: item?.h ?? 900, category: item?.category || '', front: fr, area: w * d });
  }
  return out;
}

const edgeDist = (p, poly) => Math.min(...G.polygonEdges(poly).map(([a, b]) => G.projectToSegment(p, a, b).d));
function wallClearance(p, walls) {
  let m = Infinity;
  for (const w of walls) {
    const d = G.projectToSegment(p, w.a, w.b).d - (w.thickness || 100) / 2;
    if (d < m) m = d;
  }
  return m;
}
export const clearanceAt = (level, p, poly) => Math.min(wallClearance(p, level.walls), edgeDist(p, poly));

const wallShown = (w) => w.status !== 'demolish';

// Openings and neighbours on each room edge ----------------------------------------------------------
const OPEN_W = { sliding_door: 1.6, opening: 1.2, window: 1.0, garage_door: 0.9, door: 0.7, roller_door: 0.8 };
const ADJ_W = (r) => (isAlfresco(r) ? 1.8 : groupsOfRoom(r).includes('living') ? 1.5 : groupsOfRoom(r).some((g) => g === 'kitchen' || g === 'dining') ? 1.3 : ['hall', 'entry'].includes(r.type) ? 0.6 : AUX_TYPES.has(r.type) ? 0.3 : isGarage(r) ? 0.4 : 1);

function inwardNormal(a, b, poly) {
  const d = G.norm(G.sub(b, a));
  const n = { x: -d.y, y: d.x };
  const m = G.lerp(a, b, 0.5);
  const probe = { x: m.x + n.x * 150, y: m.y + n.y * 150 };
  return G.pointInPolygon(probe, poly) ? n : { x: -n.x, y: -n.y };
}

// Candidate things to look at from inside `room`: openings in its edges and open or door linked neighbours.
export function focusCandidates(project, roomId) {
  const found = findRoom(project, roomId);
  if (!found) return [];
  const { room, level } = found;
  const poly = room.polygon;
  const others = level.rooms.filter((r) => r.id !== room.id && polyOk(r) && showable(r));
  const walls = level.walls.filter(wallShown);
  const out = [];
  for (const [a, b] of G.polygonEdges(poly)) {
    const L = G.dist(a, b);
    if (L < 300) continue;
    const inN = inwardNormal(a, b, poly);
    const outN = { x: -inN.x, y: -inN.y };
    // neighbours sharing the edge
    const shared = [];
    for (const o of others) {
      for (const [c, d] of G.polygonEdges(o.polygon)) {
        // wall centrelines and polygon edges may be offset by a wall thickness: accept near collinear edges
        const near = G.distToLine(c, a, b) <= 400 && G.distToLine(d, a, b) <= 400;
        if (!near) continue;
        const ov = G.overlapOnSegment(a, b, c, d);
        if (ov && ov[1] - ov[0] > 300) shared.push({ room: o, lo: ov[0], hi: ov[1] });
      }
    }
    // openings on this edge
    const edgeOpenings = [];
    for (const o of level.openings || []) {
      if (o.status === 'demolish') continue;
      const w = level.walls.find((x) => x.id === o.wallId);
      if (!w) continue;
      const c = G.pointOnWall(w, o.offset);
      const pr = G.projectToSegment(c, a, b);
      if (pr.d <= 400 && pr.tRaw > -0.001 && pr.tRaw < 1.001) edgeOpenings.push({ o, point: pr.point, along: pr.along });
    }
    const wallOnEdge = (pt) => walls.some((w) => G.projectToSegment(pt, w.a, w.b).d <= (w.thickness || 100) / 2 + 60);
    for (const e of edgeOpenings) {
      const adj = shared.find((s) => e.along >= s.lo - 50 && e.along <= s.hi + 50)?.room || null;
      // garage doors and entry doors on the outside are poor subjects; the weight keeps them low
      const w = (e.o.width || 900) * (OPEN_W[e.o.kind] ?? 1) * (adj ? ADJ_W(adj) : 1);
      out.push({ kind: 'opening', opening: e.o, adj, point: e.point, outward: outN, score: w });
    }
    for (const s of shared) {
      const mid = G.lerp(a, b, (s.lo + s.hi) / 2 / L);
      const covered = edgeOpenings.some((e) => e.along >= s.lo - 50 && e.along <= s.hi + 50);
      if (covered) continue;
      if (wallOnEdge(mid)) continue; // a solid wall between: nothing to look through
      out.push({ kind: 'room', adj: s.room, point: mid, outward: outN, score: (s.hi - s.lo) * ADJ_W(s.room) * 0.9 });
    }
  }
  return out.sort((x, y) => y.score - x.score);
}

const OPEN_TEXT = {
  window: 'towards the windows', sliding_door: 'towards the sliding doors', garage_door: 'towards the garage door', door: 'towards the doorway',
  opening: 'towards the opening', roller_door: 'towards the roller door',
};
function describeCandidate(c) {
  if (!c) return null;
  if (c.adj) {
    const n = roomNoun(c.adj);
    return { ...c, text: `to the ${n}` };
  }
  return { ...c, text: OPEN_TEXT[c.opening?.kind] || 'towards the far wall' };
}

export function defaultFocus(project, roomId) {
  const cands = focusCandidates(project, roomId);
  return describeCandidate(cands[0] || null);
}

// Eye viewpoint --------------------------------------------------------------------------------------
const GROUP_CATEGORY = { kitchen: 'Kitchen', dining: 'Dining', living: 'Living' };

function sightPenalty(from, to, poly, rects, skipIds, stepMm = 150) {
  const L = G.dist(from, to);
  const n = Math.max(2, Math.floor(L / stepMm));
  let pen = 0;
  const hit = new Set();
  for (let i = 1; i < n; i++) {
    const p = G.lerp(from, to, i / n);
    for (const r of rects) {
      if (skipIds.has(r.id) || r.h < 900 || hit.has(r.id)) continue;
      if (G.pointInPolygon(p, r.poly)) {
        hit.add(r.id);
        pen += 900;
      }
    }
  }
  // something solid right in front of the camera fills the view
  const near = Math.min(6, Math.floor(1500 / stepMm));
  for (let i = 1; i <= near && i < n; i++) {
    const p = G.lerp(from, to, (i * stepMm) / L);
    if (rects.some((r) => r.h >= 450 && G.pointInPolygon(p, r.poly))) {
      pen += 1500;
      break;
    }
  }
  // leaving the room before the focus point means a wall in the way (concave rooms)
  const lastIn = G.pointInPolygon(G.lerp(from, to, 0.9), poly);
  if (!lastIn) pen += 500;
  return pen;
}


// What a view of `room` is aimed at. In an open plan room the kitchen and dining tabs look at that furniture group;
// otherwise at the largest opening or adjacent living space. Returns { point, beyond?, text, furniture?, skip? } or null.
export function resolveFocus(project, roomId, group = null) {
  const found = findRoom(project, roomId);
  if (!found) return null;
  const { room, level } = found;
  const cat = GROUP_CATEGORY[group];
  if (cat && (group === 'kitchen' || group === 'dining') && groupsOfRoom(room).length > 1) {
    const hits = furnitureRects(level, 0).filter((r) => G.pointInPolygon(r.c, room.polygon) && r.category === cat);
    if (hits.length) {
      const c = { x: hits.reduce((s, r) => s + r.c.x, 0) / hits.length, y: hits.reduce((s, r) => s + r.c.y, 0) / hits.length };
      return { point: c, text: group === 'kitchen' ? 'to the kitchen' : 'to the dining area', furniture: true, skip: hits.map((r) => r.id) };
    }
  }
  const f = defaultFocus(project, roomId);
  if (!f) return null;
  return { point: f.point, beyond: { x: f.point.x + f.outward.x * 1800, y: f.point.y + f.outward.y * 1800 }, text: f.text };
}

// roomViewpoint(project, roomId, { group }) -> { position, target, levelId, roomId, fov } in metres, or null.
// `group` ('kitchen' | 'dining' | 'living') looks towards that furniture group when the room holds one; otherwise towards the
// largest opening or adjacent living space.
export function roomViewpoint(project, roomId, opts = {}) {
  const found = findRoom(project, roomId);
  if (!found) return null;
  const { room, level } = found;
  const poly = room.polygon;
  const bb = G.bbox(poly);
  const rects = furnitureRects(level, 0);
  const keepOffBy = { 220: furnitureRects(level, 220), 0: rects };

  // what to look at
  const resolved = resolveFocus(project, roomId, opts.group);
  const focus = resolved;
  const focusSkip = new Set(resolved?.skip || []);
  const subject = focusSkip.size ? rects.filter((r) => focusSkip.has(r.id)) : [];
  const subjectArea = subject.reduce((t, r) => t + r.area, 0) || 1;
  const centroid = G.polygonCentroid(poly);
  const aim = focus?.point || centroid;

  // candidate standing points
  const step = Math.max(100, Math.min(250, Math.min(bb.w, bb.h) / 14));
  // preferred: 0.4 m from walls and 0.22 m off furniture; then give up the furniture margin before the wall clearance
  const tiers = [[MIN_WALL_CLEAR * 1000, 220], [MIN_WALL_CLEAR * 1000, 0], [300, 0], [200, 0], [100, 0], [0, 0]];
  let chosen = null;
  for (const [need, pad] of tiers) {
    const keepOff = keepOffBy[pad];
    const list = [];
    for (let x = bb.minX + step / 2; x < bb.maxX; x += step) {
      for (let y = bb.minY + step / 2; y < bb.maxY; y += step) {
        const p = { x, y };
        if (!G.pointInPolygon(p, poly)) continue;
        const cl = clearanceAt(level, p, poly);
        if (cl < need) continue;
        if (keepOff.some((r) => G.pointInPolygon(p, r.poly))) continue;
        const D = G.dist(p, aim);
        // far from the subject looks across the room; a corner is preferred to the middle of the floor
        // a subject in the room (furniture group): stand about 4.5 m off so it fills the view; otherwise look across the room
        // furniture subjects are best seen from their front: weight by how many of the items face the camera
        const facing = subject.reduce((t, r) => {
          const v = G.norm(G.sub(p, r.c));
          return t + r.area * Math.max(0, G.dot(v, r.front));
        }, 0) / subjectArea;
        list.push({ p, cl, score: focus?.furniture ? 6000 + 2500 * facing - Math.abs(D - 5000) - 0.15 * Math.min(cl, 2500) : Math.min(D, 8000) - 0.35 * Math.min(cl, 2500) });
      }
    }
    if (list.length) {
      list.sort((a, b) => b.score - a.score);
      let best = null;
      for (const c of list.slice(0, 80)) {
        // standing right beside a tall item (a fridge, a wardrobe) is poor too
        let crowd = 0;
        for (const r of rects) {
          if (r.h < 900) continue;
          const half = Math.max(...r.poly.map((q) => G.dist(q, r.c)));
          if (G.dist(c.p, r.c) - half < 1500) crowd += 900;
        }
        const pen = sightPenalty(c.p, aim, poly, rects, focusSkip) + crowd;
        const s = c.score - pen;
        if (!best || s > best.s) best = { ...c, s };
      }
      chosen = best.p;
      break;
    }
  }
  if (!chosen) {
    // tiny or odd room: the point furthest from every edge, even if it is close to a wall
    let bestD = -1;
    for (let x = bb.minX + 25; x < bb.maxX; x += 50) {
      for (let y = bb.minY + 25; y < bb.maxY; y += 50) {
        const p = { x, y };
        if (!G.pointInPolygon(p, poly)) continue;
        const d = clearanceAt(level, p, poly);
        if (d > bestD) {
          bestD = d;
          chosen = p;
        }
      }
    }
    if (!chosen) chosen = centroid;
  }

  const elev = level.elevation / 1000;
  const eye = elev + EYE_HEIGHT;
  const dir = G.norm(G.sub(focus?.beyond || aim, chosen));
  const dd = G.dist(chosen, focus?.beyond || aim);
  const t = { x: chosen.x + dir.x * Math.max(dd, 1500), y: chosen.y + dir.y * Math.max(dd, 1500) };
  const ty = Math.max(elev + 0.9, eye - Math.min(0.45, dd / 12000 * 1.0 + 0.1));
  return {
    position: { x: chosen.x / 1000, y: eye, z: chosen.y / 1000 },
    target: { x: t.x / 1000, y: ty, z: t.y / 1000 },
    levelId: level.id,
    roomId: room.id,
    fov: ROOM_FOV,
  };
}

// Viewpoint for a tab: the tab's largest room, looking towards the tab's subject.
export function tabViewpoint(project, tab) {
  if (!tab?.roomIds?.length) return null;
  const group = ['kitchen', 'dining', 'living'].includes(tab.id) ? tab.id : null;
  return roomViewpoint(project, tab.roomIds[0], { group });
}

// Cutaway --------------------------------------------------------------------------------------------
// Angled view over a room (about 45 degrees), the room centred. aspect and vfov (degrees) size the framing.
export function cutawayPose(project, roomId, { vfov = ORBIT_FOV, aspect = 1.6, pitchDeg = 52 } = {}) {
  const found = findRoom(project, roomId);
  if (!found) return null;
  const { room, level } = found;
  const bb = G.bbox(room.polygon);
  const elev = level.elevation / 1000;
  const cx = bb.cx / 1000;
  const cz = bb.cy / 1000;
  const r = Math.hypot(bb.w, bb.h) / 2000;
  // camera on the outer side of the house, looking in
  const lb = G.levelBounds(level);
  let ax = cx - (lb ? lb.cx / 1000 : cx);
  let az = cz - (lb ? lb.cy / 1000 : cz);
  if (Math.hypot(ax, az) < 1.2) {
    ax = 0;
    az = 1;
  }
  const al = Math.hypot(ax, az);
  ax /= al;
  az /= al;
  const vt = Math.tan((vfov * Math.PI) / 360);
  const ht = vt * aspect;
  const dist = Math.max(5, (r * 1.15) / Math.min(vt, ht) + 1.2);
  const pitch = (pitchDeg * Math.PI) / 180;
  const target = { x: cx, y: elev + 0.5, z: cz };
  const position = {
    x: cx + ax * Math.cos(pitch) * dist,
    y: target.y + Math.sin(pitch) * dist,
    z: cz + az * Math.cos(pitch) * dist,
  };
  return { position, target, levelId: level.id, roomId: room.id, fov: vfov, extents: { cx, cz, r, dist, minX: bb.minX / 1000, maxX: bb.maxX / 1000, minZ: bb.minY / 1000, maxZ: bb.maxY / 1000 } };
}

// The room under a world point (metres) on a level (or the nearest within 0.6 m, for wall hits). Returns { room, level } or null.
export function roomAtPoint(project, x, z, levelId = null, elevationY = null) {
  const levels = sortedLevels(project);
  let list = levels;
  if (levelId) list = levels.filter((l) => l.id === levelId);
  else if (elevationY != null) {
    // highest level whose floor is at or below the point
    const below = levels.filter((l) => l.elevation / 1000 <= elevationY + 0.3);
    list = below.length ? [below[below.length - 1]] : levels;
  }
  const p = { x: x * 1000, y: z * 1000 };
  for (const level of list) {
    const rooms = level.rooms.filter((r) => polyOk(r) && showable(r));
    const inside = rooms.filter((r) => G.pointInPolygon(p, r.polygon));
    if (inside.length) return { room: inside.sort((a, b) => G.polygonArea(a.polygon) - G.polygonArea(b.polygon))[0], level };
    let best = null;
    for (const r of rooms) {
      const d = edgeDist(p, r.polygon);
      if (d <= 600 && (!best || d < best.d)) best = { d, room: r };
    }
    if (best) return { room: best.room, level };
  }
  return null;
}
