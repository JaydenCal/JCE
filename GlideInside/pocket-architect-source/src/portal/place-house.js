// Place a library house design (a project JSON, docs/SCOPE.md 9) onto a lot project.
//
//   const placement = placeHouse(project, house, { x, y, rotation });   // mutates `project`
//
// The house keeps its own geometry. Its levels are merged into the project by floor level (same elevation, within 1 mm):
// an existing level receives the walls, openings, rooms, furniture and stairs; a missing level is added. Every entity gets
// a new id, so the same house can be placed twice and everything stays editable with the normal tools afterwards.
// Pose: (x, y) is where the centre of the house footprint lands (mm, plan coordinates, y down); rotation is degrees
// clockwise as seen on the plan; `mirrored: true` flips the house left to right first (a mirrored plan, still the same rooms).
// Use `previewPlacement` while the person drags, and `placeHouse` inside store.apply to commit.

import { createLevel, uid } from '../model/schema.js';
import { mirrorPlan } from '../model/ops.js';
import { lowestLevel } from './house-stats.js';

const ELEV_TOL = 1;
const rad = (deg) => (deg * Math.PI) / 180;
const r1 = (n) => Math.round(n);

/** Footprint centre and size of a house (all levels, walls and rooms, indoor and outdoor), before any placement. */
export function houseBounds(house) {
  const pts = [];
  for (const l of house.levels) {
    for (const w of l.walls) pts.push(w.a, w.b);
    for (const r of l.rooms) pts.push(...r.polygon);
    for (const s of l.stairs) pts.push({ x: s.x, y: s.y });
  }
  for (const t of house.site?.tanks || []) pts.push({ x: t.x, y: t.y });
  if (!pts.length) return { minX: 0, minY: 0, maxX: 0, maxY: 0, cx: 0, cy: 0, width: 0, depth: 0 };
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  return { minX, minY, maxX, maxY, cx: (minX + maxX) / 2, cy: (minY + maxY) / 2, width: maxX - minX, depth: maxY - minY };
}

/** Bounds of everything already on the lot project (null when it is empty). */
export function projectBounds(project) {
  const probe = { levels: project.levels, site: project.site };
  const b = houseBounds(probe);
  return b.width === 0 && b.depth === 0 && !project.levels.some((l) => l.walls.length || l.rooms.length) ? null : b;
}

/** Corners of the placed footprint rectangle (the oriented bounding box), for drawing a ghost outline. */
export function footprintCorners(house, pose) {
  const b = houseBounds(house);
  const hw = b.width / 2;
  const hd = b.depth / 2;
  const th = rad(pose.rotation || 0);
  const c = Math.cos(th);
  const s = Math.sin(th);
  return [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]].map(([x, y]) => ({ x: r1(pose.x + x * c - y * s), y: r1(pose.y + x * s + y * c) }));
}

/** Where a house goes first: the middle of the existing plan's area, to the right of whatever is there, or the origin. */
export function defaultPose(project, house) {
  const b = houseBounds(house);
  const existing = projectBounds(project);
  if (!existing) return { x: r1(b.width / 2 + 3000), y: r1(b.depth / 2 + 3000), rotation: 0 };
  return { x: r1(existing.maxX + 6000 + b.width / 2), y: r1(existing.cy), rotation: 0 };
}

function transformer(house, pose) {
  const b = houseBounds(house);
  const th = rad(pose.rotation || 0);
  const c = Math.cos(th);
  const s = Math.sin(th);
  const pt = (p) => {
    const dx = p.x - b.cx;
    const dy = p.y - b.cy;
    return { x: r1(pose.x + dx * c - dy * s), y: r1(pose.y + dx * s + dy * c) };
  };
  const norm = (deg) => {
    const v = (((deg % 360) + 540) % 360) - 180; // -180..180
    return v === -180 ? 180 : v;
  };
  return { pt, rot: (deg) => norm((deg || 0) + (pose.rotation || 0)) };
}

const sameElevation = (a, b) => Math.abs(a - b) <= ELEV_TOL;

/**
 * Merge `house` into `project` (mutates it). Returns a placement record:
 *   { id, houseName, pose, levels: [{ levelId, added }], entityIds: [..], wallIds: [..] }
 */
export function placeHouse(project, house, pose = {}) {
  if (!house?.levels?.length) throw new Error('That house design has no levels.');
  if (pose.mirrored) {
    house = structuredClone(house);
    mirrorPlan(house, 'left_right');
  }
  const p = { ...defaultPose(project, house), ...pose };
  delete p.mirrored;
  if (pose.mirrored) p.mirrored = true;
  const T = transformer(house, p);
  const record = { id: uid('pl'), houseName: house.name || 'House', pose: p, mirrored: !!pose.mirrored, levels: [], entityIds: [], wallIds: [], tankIds: [] };
  const wasEmpty = !project.levels.some((l) => l.walls.length || l.rooms.length || l.furniture.length || l.stairs.length);

  for (const src of [...house.levels].sort((a, b) => a.elevation - b.elevation)) {
    let target = project.levels.find((l) => sameElevation(l.elevation, src.elevation));
    let added = false;
    if (!target) {
      target = createLevel({ name: src.name, elevation: src.elevation, height: src.height, roof: structuredClone(src.roof) });
      project.levels.push(target);
      added = true;
    } else if (!target.walls.length && !target.rooms.length) {
      // An empty level takes the house's roof and ceiling height; a level with content keeps its own.
      target.roof = structuredClone(src.roof);
      target.height = src.height;
    }
    record.levels.push({ levelId: target.id, added });

    const wallMap = new Map();
    for (const w of src.walls) {
      const nw = structuredClone(w);
      nw.id = uid('w');
      nw.a = T.pt(w.a);
      nw.b = T.pt(w.b);
      wallMap.set(w.id, nw.id);
      target.walls.push(nw);
      record.wallIds.push(nw.id);
      record.entityIds.push(nw.id);
    }
    for (const o of src.openings) {
      if (!wallMap.has(o.wallId)) continue;
      const no = structuredClone(o);
      no.id = uid('o');
      no.wallId = wallMap.get(o.wallId);
      target.openings.push(no);
      record.entityIds.push(no.id);
    }
    for (const r of src.rooms) {
      const nr = structuredClone(r);
      nr.id = uid('r');
      nr.polygon = r.polygon.map(T.pt);
      target.rooms.push(nr);
      record.entityIds.push(nr.id);
    }
    for (const f of src.furniture) {
      const nf = structuredClone(f);
      nf.id = uid('f');
      Object.assign(nf, T.pt(f));
      nf.rotation = T.rot(f.rotation);
      target.furniture.push(nf);
      record.entityIds.push(nf.id);
    }
    for (const s of src.stairs) {
      const ns = structuredClone(s);
      ns.id = uid('s');
      Object.assign(ns, T.pt(s));
      ns.rotation = T.rot(s.rotation);
      target.stairs.push(ns);
      record.entityIds.push(ns.id);
    }
  }
  for (const t of house.site?.tanks || []) {
    const nt = structuredClone(t);
    nt.id = uid('t');
    Object.assign(nt, T.pt(t));
    (project.site.tanks ||= []).push(nt);
    record.tankIds.push(nt.id);
    record.entityIds.push(nt.id);
  }
  if (wasEmpty) {
    // A blank lot takes the house's finishes and design type so the 3D model looks as the builder drew it.
    project.finishes = structuredClone(house.finishes || project.finishes);
    project.type = house.type || project.type;
    project.settings = { ...project.settings, ...(house.settings || {}) };
  }
  // Keep levels in floor order.
  project.levels.sort((a, b) => a.elevation - b.elevation);
  return record;
}

/** A placed copy on a clone, for the live preview while dragging. Never touches `project`. */
export function previewPlacement(project, house, pose) {
  const copy = structuredClone(project);
  placeHouse(copy, house, pose);
  return copy;
}

/** Size check against a lot: does the rotated footprint fit within lot width x depth (mm)? Used for a gentle warning. */
export function fitsLot(house, pose, lot) {
  if (!lot?.widthMm || !lot?.depthMm) return true;
  const xs = footprintCorners(house, pose).map((c) => c.x);
  const ys = footprintCorners(house, pose).map((c) => c.y);
  return Math.max(...xs) - Math.min(...xs) <= lot.widthMm && Math.max(...ys) - Math.min(...ys) <= lot.depthMm;
}

export { lowestLevel };
