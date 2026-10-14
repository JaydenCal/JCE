/**
 * three.js representation of the site design with INCREMENTAL rebuild: one THREE.Group per object id. A change event rebuilds only the
 * groups of the objects it names (changed and added) and removes the groups of removed objects; every other group is left untouched.
 *
 * Drawing rules (nothing is invented):
 *  - Points, polylines and polygon outlines are draped on the terrain (vertical samples of the terrain mesh, see terrain.ts).
 *  - An object whose dimension parameters are not all set is drawn as a marker or an outline, labelled DIMENSIONS NOT SET.
 *  - A vertex with an explicit z uses it; otherwise the terrain height. Where the terrain does not reach, the nearest known height is
 *    used for drawing only and the object carries a TERRAIN DATA NOT AVAILABLE issue.
 *  - Small constant offsets (LIFT, sizes of markers) are display conventions, not engineering values.
 */
import * as THREE from 'three';
import { makeSprite } from '@/lib/viewer/textures';
import { worstSeverity } from './checks';
import { drapePolyline, ringCentroid } from './geom';
import type { ChangeEvent } from './store';
import {
  BUILDING_USE_LABEL, DIMENSIONS_NOT_SET, FFL_NOT_SET, HEIGHT_NOT_SET, OBJECT_KINDS, POOL_BARRIER_LABEL, STATUS_LABEL, SURFACE_LABEL, dimOf, dimensionsSet, levelOf, verticesOf,
  type Pos, type SiteDesign, type SiteObject,
} from './types';

export const LIFT = 0.04;            // metres above the terrain for flat things, avoids z fighting
export const DRAPE_STEP = 1.0;       // metres between terrain samples along lines (display resolution)
export const MARKER_RADIUS = 0.4;    // metres, marker for an object without dimensions (no real size is implied)
export const OUTLINE_WIDTH = 0.14;   // metres, drawn width of an outline ribbon (lines are 1 pixel in WebGL, too thin to see)
export const SELECT_COLOUR = '#ffd24a';
/** Cut / fill colours of the scene bundle (backend sa6_site3d build.py cutfill_rgb): cut orange-red, fill blue, white at zero, saturating at 1.5 m. */
export const CUT_COLOUR = '#d9582b', FILL_COLOUR = '#2b6fd9', CUTFILL_SATURATION_M = 1.5;
/** Colour for cf = FFL minus existing ground, metres: negative is cut (the ground is above the floor), positive is fill. */
export function cutFillColour(cf: number): THREE.Color {
  const t = Math.min(1, Math.abs(cf) / CUTFILL_SATURATION_M);
  return new THREE.Color('#ffffff').lerp(new THREE.Color(cf < 0 ? CUT_COLOUR : FILL_COLOUR), t);
}
const RED = '#d11d1d', AMBER = '#e0a100', GREY = '#7b8087';

export interface SceneTerrain { available: boolean; sample(e: number, n: number): number | null }
export interface SiteSceneOptions {
  origin: readonly [number, number];
  terrain: SceneTerrain | null;
  /** injectable for tests (needs a DOM canvas otherwise) */
  makeLabel?: (text: string, scale: number, accent: string) => THREE.Sprite;
}

interface Ctx {
  O: readonly [number, number]; sample: (e: number, n: number) => number | null; label: (t: string, s: number, a: string) => THREE.Sprite;
  /** a loaded GLB visual for a building id (a fresh clone), or null */
  glb?: (id: string) => THREE.Object3D | null;
}
type V3 = [number, number, number];

const mix = (a: string, b: string, k: number) => new THREE.Color(a).lerp(new THREE.Color(b), k);
function baseColour(o: SiteObject): THREE.Color {
  const c = OBJECT_KINDS[o.type].colour;
  return o.status === 'proposed' ? new THREE.Color(c) : o.status === 'existing' ? mix(c, GREY, 0.55) : new THREE.Color(RED);
}
function outlineColour(o: SiteObject): THREE.Color {
  const w = worstSeverity(o.issues);
  return w === 'blocking' ? new THREE.Color(RED) : w === 'warning' ? new THREE.Color(AMBER) : baseColour(o);
}
const opacityOf = (o: SiteObject) => (o.status === 'to_be_removed' ? 0.5 : 1);

/** Positions of an object as local-metre vertices with a height each; heights fall back to the nearest known one (drawing only). */
function lift(ps: readonly Pos[], c: Ctx): V3[] {
  const raw = ps.map((p) => p[2] ?? c.sample(p[0], p[1]));
  const known = raw.filter((z): z is number => z !== null), fb = known.length ? known[0] : 0;
  let last = fb; return ps.map((p, i) => { const z = raw[i] ?? last; last = z; return [p[0] - c.O[0], p[1] - c.O[1], z]; });
}
function drapedPath(ps: readonly Pos[], closed: boolean, c: Ctx, dz = LIFT): V3[] {
  const d = drapePolyline(ps, c.sample, DRAPE_STEP, closed);
  const known = d.map((x) => x.p[2]).filter((z): z is number => z !== null), fb = known.length ? known[0] : 0;
  let last = fb; const out: V3[] = d.map((x) => { const z = x.p[2] ?? last; last = z; return [x.p[0] - c.O[0], x.p[1] - c.O[1], z + dz]; });
  if (closed && out.length) out.push(out[0]);
  return out;
}
function lineObj(pts: V3[], col: THREE.Color, op: number): THREE.Line {
  const g = new THREE.BufferGeometry().setFromPoints(pts.map((p) => new THREE.Vector3(...p)));
  const l = new THREE.Line(g, new THREE.LineBasicMaterial({ color: col, transparent: op < 1, opacity: op, depthTest: true }));
  l.userData.baseColour = col.getHex(); l.userData.pick = true; return l;
}
function dot(p: V3, col: THREE.Color, r = MARKER_RADIUS * 0.6): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.SphereGeometry(r, 12, 8), new THREE.MeshBasicMaterial({ color: col }));
  m.position.set(...p); m.userData.pick = true; m.userData.baseColour = col.getHex(); return m;
}
function solidMat(col: THREE.Color, op: number): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color: col, roughness: 0.8, transparent: op < 1, opacity: op, side: THREE.DoubleSide });
}
function flatMat(col: THREE.Color, op: number): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.35 * op, side: THREE.DoubleSide, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
}
function meshOf(pos: number[], mat: THREE.Material): THREE.Mesh {
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.computeVertexNormals();
  const m = new THREE.Mesh(g, mat); m.userData.pick = true; return m;
}
/** Outline of a draped path as a thin flat ribbon so it stays visible at any zoom. */
function outline(path: V3[], col: THREE.Color, op: number, c: Ctx): THREE.Mesh {
  const { left, right } = offsets(path, OUTLINE_WIDTH / 2, c), pos: number[] = [];
  strip(left, right, pos);
  const m = meshOf(pos, new THREE.MeshBasicMaterial({ color: col, transparent: op < 1, opacity: op, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
  m.userData.baseColour = col.getHex(); return m;
}
/** Strip of quads between two equally long paths. */
function strip(a: V3[], b: V3[], out: number[]) {
  for (let i = 0; i + 1 < a.length; i++) out.push(...a[i], ...b[i], ...a[i + 1], ...a[i + 1], ...b[i], ...b[i + 1]);
}
/** Left and right offset paths of a draped path, half a width either side (plan offset, heights re-sampled from the terrain). */
function offsets(path: V3[], half: number, c: Ctx): { left: V3[]; right: V3[] } {
  const left: V3[] = [], right: V3[] = [];
  for (let i = 0; i < path.length; i++) {
    const p0 = path[Math.max(0, i - 1)], p1 = path[Math.min(path.length - 1, i + 1)];
    let dx = p1[0] - p0[0], dy = p1[1] - p0[1]; const L = Math.hypot(dx, dy) || 1; dx /= L; dy /= L;
    const nx = -dy * half, ny = dx * half, p = path[i];
    const zl = c.sample(p[0] + nx + c.O[0], p[1] + ny + c.O[1]), zr = c.sample(p[0] - nx + c.O[0], p[1] - ny + c.O[1]);
    left.push([p[0] + nx, p[1] + ny, zl !== null ? zl + LIFT : p[2]]); right.push([p[0] - nx, p[1] - ny, zr !== null ? zr + LIFT : p[2]]);
  }
  return { left, right };
}
function tessellate(tri: [number, number][], maxEdge: number, out: [number, number][][], depth = 0) {
  const [a, b, c] = tri, e = Math.max(Math.hypot(a[0] - b[0], a[1] - b[1]), Math.hypot(b[0] - c[0], b[1] - c[1]), Math.hypot(c[0] - a[0], c[1] - a[1]));
  if (e <= maxEdge || depth >= 7) { out.push(tri); return; }
  const m = (p: [number, number], q: [number, number]): [number, number] => [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2], ab = m(a, b), bc = m(b, c), ca = m(c, a);
  for (const t of [[a, ab, ca], [ab, b, bc], [ca, bc, c], [ab, bc, ca]] as [number, number][][]) tessellate(t, maxEdge, out, depth + 1);
}
/** Polygon fill draped on the terrain: triangulate in plan, subdivide, lift each vertex onto the terrain. */
function fillMesh(ring: readonly Pos[], c: Ctx, mat: THREE.Material): THREE.Mesh | null {
  const loc = ring.map((p) => new THREE.Vector2(p[0] - c.O[0], p[1] - c.O[1]));
  const faces = THREE.ShapeUtils.triangulateShape(loc, []);
  if (!faces.length) return null;
  let area = 0; for (const f of faces) { const [a, b, d] = f.map((i) => loc[i]); area += Math.abs((b.x - a.x) * (d.y - a.y) - (d.x - a.x) * (b.y - a.y)) / 2; }
  const maxEdge = Math.max(2, Math.sqrt(area / 4000)), tris: [number, number][][] = [];
  for (const f of faces) tessellate(f.map((i) => [loc[i].x, loc[i].y] as [number, number]) as [number, number][], maxEdge, tris);
  const pos: number[] = [];
  let lastZ = ring.map((p) => p[2] ?? c.sample(p[0], p[1])).find((z): z is number => z !== null) ?? 0;
  for (const t of tris) for (const v of t) { const z = c.sample(v[0] + c.O[0], v[1] + c.O[1]); if (z !== null) lastZ = z; pos.push(v[0], v[1], lastZ + LIFT * 0.5); }
  return meshOf(pos, mat);
}

/**
 * Flat slab at the finished floor level `ffl`, vertex coloured by cut / fill against the terrain (cf = ffl minus the existing ground).
 * Where the terrain does not reach a vertex the slab is grey: nothing is invented for it.
 */
function slabMesh(ring: readonly Pos[], ffl: number, c: Ctx, op: number): THREE.Mesh | null {
  const loc = ring.map((p) => new THREE.Vector2(p[0] - c.O[0], p[1] - c.O[1]));
  const faces = THREE.ShapeUtils.triangulateShape(loc, []);
  if (!faces.length) return null;
  const maxEdge = 2, tris: [number, number][][] = [];
  for (const f of faces) tessellate(f.map((i) => [loc[i].x, loc[i].y] as [number, number]) as [number, number][], maxEdge, tris);
  const pos: number[] = [], col: number[] = [], grey = new THREE.Color(GREY);
  for (const t of tris) for (const v of t) {
    const g = c.sample(v[0] + c.O[0], v[1] + c.O[1]), k = g === null ? grey : cutFillColour(ffl - g);
    pos.push(v[0], v[1], ffl); col.push(k.r, k.g, k.b);
  }
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, transparent: op < 1, opacity: op }));
  m.userData.pick = true; m.userData.slab = true; return m;
}
/** Walls from the floor level up to `ffl + height` on every edge of a ring. */
function wallsMesh(ring: readonly Pos[], ffl: number, height: number, c: Ctx, col: THREE.Color, op: number): THREE.Mesh {
  const pos: number[] = [], n = ring.length;
  for (let i = 0; i < n; i++) {
    const a = ring[i], b = ring[(i + 1) % n], ax = a[0] - c.O[0], ay = a[1] - c.O[1], bx = b[0] - c.O[0], by = b[1] - c.O[1];
    pos.push(ax, ay, ffl, bx, by, ffl, bx, by, ffl + height, ax, ay, ffl, bx, by, ffl + height, ax, ay, ffl + height);
  }
  return meshOf(pos, solidMat(col, op));
}
/** Flat roof cap at the top of the block, drawn as an outline only (no roof form is implied). */
const roofOutline = (rings: readonly (readonly Pos[])[], z: number, col: THREE.Color, op: number, c: Ctx): THREE.Object3D[] =>
  rings.map((r) => lineObj([...r, r[0]].map((p) => [p[0] - c.O[0], p[1] - c.O[1], z] as V3), col, op));

/** Matrix from Plan Studio GLB space (metres, Y up, X = plan x, Z = plan y which points down the sheet) to scene space (E - O, N - O, up). */
export function glbMatrix(origin: readonly [number, number], yawDeg: number, northDeg: number, ffl: number, O: readonly [number, number]): THREE.Matrix4 {
  const n = (northDeg * Math.PI) / 180, cn = Math.cos(n), sn = Math.sin(n);
  const toLocal = new THREE.Matrix4().set(cn, 0, sn, 0, sn, 0, -cn, 0, 0, 1, 0, 0, 0, 0, 0, 1);       // (gx, gy, gz) -> (E, N, up): E = x cos n + y sin n, N = x sin n - y cos n
  const yaw = new THREE.Matrix4().makeRotationZ((-yawDeg * Math.PI) / 180);                               // a clockwise turn seen from above
  const place = new THREE.Matrix4().makeTranslation(origin[0] - O[0], origin[1] - O[1], ffl);
  return place.multiply(yaw).multiply(toLocal);
}

function labelLines(o: SiteObject): string {
  const k = OBJECT_KINDS[o.type], L = [o.label ? `${k.label}: ${o.label.toUpperCase()}` : k.label];
  const tags: string[] = [];
  if (o.status !== 'proposed') tags.push(STATUS_LABEL[o.status]);
  if (o.origin === 'ai_proposal') tags.push(o.accepted === 'accepted' ? 'AI PROPOSAL, ACCEPTED' : 'AI PROPOSAL, PENDING');
  if (tags.length) L.push(tags.join(' · '));
  if (o.type === 'building') {
    const u = o.params.building_use?.value;
    if (typeof u === 'string' && u in BUILDING_USE_LABEL) L[0] = `${L[0]} (${BUILDING_USE_LABEL[u as keyof typeof BUILDING_USE_LABEL]})`;
    if (levelOf(o, 'ffl_rl') === null) L.push(FFL_NOT_SET); else L.push(`FFL ${levelOf(o, 'ffl_rl')!.toFixed(2)} RL`);
    if (dimOf(o, 'height_m') === null) L.push(HEIGHT_NOT_SET);
    const ra = dimOf(o, 'roof_plan_area_m2'), rb = o.params.roof_area_basis?.value;
    L.push(ra !== null ? `ROOF ${ra.toFixed(1)} M2 ${typeof rb === 'string' ? rb : ''}`.trim() : 'ROOF AREA NOT SET');
  }
  if (o.type === 'pool') L.push(POOL_BARRIER_LABEL);
  if (o.type === 'footpath' || o.type === 'landscape_area') {
    const sk = o.params.surface_kind?.value;
    if (typeof sk === 'string') L.push(((SURFACE_LABEL as Record<string, string>)[sk] ?? sk.replace(/_/g, ' ').toUpperCase()));
    else if (o.type === 'footpath') L.push('SURFACE NOT SET');
  }
  if (o.type === 'furniture' && typeof o.params.catalogue_item?.value === 'string') L.push(String(o.params.catalogue_item.value).toUpperCase());
  if (!dimensionsSet(o)) L.push(DIMENSIONS_NOT_SET);
  return L.join('\n');
}

/**
 * A building: the draped footprint outline is always drawn (by the caller). With the finished floor level AND the height set, a block is drawn:
 * a slab at the FFL coloured by cut / fill and walls up to FFL plus height; a Plan Studio GLB, when one is loaded, replaces the block as the
 * visual and is placed at the FFL. With either missing there is only the outline and a draped fill, and the label says FFL NOT SET or HEIGHT NOT SET.
 * Returns the label rise when it drew a block.
 */
function buildingParts(o: SiteObject, g: THREE.Group, col: THREE.Color, oc: THREE.Color, op: number, c: Ctx): number | null {
  const b = o.building!, ffl = levelOf(o, 'ffl_rl'), h = dimOf(o, 'height_m');
  const datum = b.levels[b.datum_index];
  for (const r of datum.rings.slice(1)) g.add(outline(drapedPath(r, true, c), oc, op, c));                     // other separate parts of the ground floor
  if (ffl === null) {                                                                                         // no floor level: nothing is drawn above the terrain
    const f = fillMesh(datum.rings[0], c, flatMat(col, op)); if (f) g.add(f);
    return null;
  }
  const glb = c.glb?.(o.id) ?? null;
  if (glb) {
    glb.matrixAutoUpdate = false; glb.matrix.copy(glbMatrix(b.frame.origin, b.frame.yaw_deg, b.frame.north_deg ?? 0, ffl, c.O)); glb.matrixWorldNeedsUpdate = true;
    glb.traverse((x) => { x.userData.pick = true; x.userData.shared = true; }); glb.userData.glb = true; g.add(glb);      // shared: geometry and materials belong to the loaded template
    for (const r of datum.rings) { const sl = slabMesh(r, ffl, c, 0.5); if (sl) g.add(sl); }
    return (h ?? 6) + 1;
  }
  for (const r of datum.rings) { const sl = slabMesh(r, ffl, c, op); if (sl) g.add(sl); }
  if (h === null) return null;
  for (const r of datum.rings) g.add(wallsMesh(r, ffl, h, c, col, op));
  if (b.roof_outline) roofOutline(b.roof_outline, ffl + h, oc, op, c).forEach((l) => g.add(l));
  return h + 1;
}

export function buildObject(o: SiteObject, c: Ctx): THREE.Group {
  const g = new THREE.Group(); g.userData = { siteId: o.id, type: o.type };
  const geom = o.geometry, kind = OBJECT_KINDS[o.type], col = baseColour(o), oc = outlineColour(o), op = opacityOf(o);
  const set = dimensionsSet(o);
  let labelAt: V3 = [0, 0, 0], labelRise = 1.2;

  if (geom.kind === 'point') {
    const [p] = lift([geom.p], c); g.position.set(...p); g.rotation.z = -((geom.yaw_deg ?? 0) * Math.PI) / 180;
    labelAt = p; const own = new THREE.Group(); g.add(own); // children are in the object's own frame (origin at the point)
    const pick = <T extends THREE.Object3D>(x: T) => { x.userData.pick = true; return x; };
    const add = (m: THREE.Mesh) => { m.castShadow = true; own.add(pick(m)); return m; };
    if (set && o.type === 'tree') {
      const h = dimOf(o, 'height_m')!, cd = dimOf(o, 'canopy_diameter_m')!, zc = Math.max(h - cd / 2, 0);
      const s = add(new THREE.Mesh(new THREE.SphereGeometry(cd / 2, 20, 14), solidMat(col, op))); s.position.z = zc;
      own.add(pick(lineObj([[0, 0, 0], [0, 0, zc]], oc, op))); labelRise = h + 0.6;
    } else if (set && o.type === 'rwt') {
      const d = dimOf(o, 'diameter_m')!, h = dimOf(o, 'height_m')!, cg = new THREE.CylinderGeometry(d / 2, d / 2, h, 28); cg.rotateX(Math.PI / 2); cg.translate(0, 0, h / 2);
      add(new THREE.Mesh(cg, solidMat(col, op))); labelRise = h + 0.6;
    } else if (set && o.type === 'osd') {
      const w = dimOf(o, 'width_m')!, l = dimOf(o, 'length_m')!, h = dimOf(o, 'height_m')!, bg = new THREE.BoxGeometry(w, l, h); bg.translate(0, 0, h / 2);
      add(new THREE.Mesh(bg, solidMat(col, op))); labelRise = h + 0.6;
    } else if (set && o.type === 'furniture') {
      const w = dimOf(o, 'width_m')!, d = dimOf(o, 'depth_m')!, h = dimOf(o, 'height_m')!, bg = new THREE.BoxGeometry(w, d, h); bg.translate(0, 0, h / 2);
      add(new THREE.Mesh(bg, solidMat(col, op))); labelRise = h + 0.6;
    } else if (set && o.type === 'pit') {
      const w = dimOf(o, 'width_m')!, l = dimOf(o, 'length_m')!, pg = new THREE.PlaneGeometry(w, l); pg.translate(0, 0, LIFT);
      add(new THREE.Mesh(pg, flatMat(col, 1))); const hw = w / 2, hl = l / 2;
      own.add(pick(lineObj([[-hw, -hl, LIFT], [hw, -hl, LIFT], [hw, hl, LIFT], [-hw, hl, LIFT], [-hw, -hl, LIFT]], oc, op)));
    } else {
      // marker: no dimensions are known, so no size is implied. Pole and heading tick show position and rotation only.
      add(new THREE.Mesh(new THREE.SphereGeometry(MARKER_RADIUS, 14, 10), new THREE.MeshBasicMaterial({ color: oc, transparent: op < 1, opacity: op }))).position.z = MARKER_RADIUS;
      own.add(pick(lineObj([[0, 0, 0], [0, 0, 2.2]], oc, op))); own.add(pick(lineObj([[0, 0, 0.05], [0, 1.2, 0.05]], oc, op))); labelRise = 2.6;
    }
  } else {
    const ps = verticesOf(geom), closed = geom.kind === 'polygon', path = drapedPath(ps, closed, c);
    g.add(outline(path, oc, op, c));
    const lifted = lift(ps, c);
    if (!set && o.type !== 'building') lifted.forEach((p) => g.add(dot([p[0], p[1], p[2] + LIFT], oc)));
    labelAt = closed ? (() => { const m = ringCentroid(ps); const z = c.sample(m[0], m[1]); return [m[0] - c.O[0], m[1] - c.O[1], z ?? lifted[0][2]] as V3; })() : lifted[Math.floor((lifted.length - 1) / 2)];
    if (o.type === 'building' && o.building) {
      labelRise = buildingParts(o, g, col, oc, op, c) ?? labelRise;
    } else if (closed) {
      const f = fillMesh(ps, c, flatMat(col, op)); if (f) g.add(f);
    } else if (set && (o.type === 'retaining_wall' || o.type === 'infiltration_trench' || o.type === 'stormwater_pipe' || o.type === 'footpath')) {
      const half = (o.type === 'retaining_wall' ? dimOf(o, 'thickness_m')! : o.type === 'infiltration_trench' || o.type === 'footpath' ? dimOf(o, 'width_m')! : dimOf(o, 'diameter_mm')! / 1000) / 2;
      const { left, right } = offsets(path, half, c), pos: number[] = [];
      if (o.type === 'retaining_wall') {
        const h = dimOf(o, 'height_m')!, up = (a: V3[]): V3[] => a.map((p) => [p[0], p[1], p[2] + h]);
        strip(up(left), up(right), pos); strip(left, up(left), pos); strip(right, up(right), pos); labelRise = h + 0.8;
      } else strip(left, right, pos);
      g.add(meshOf(pos, o.type === 'retaining_wall' ? solidMat(col, op) : flatMat(col, op)));
    }
    labelRise = Math.max(labelRise, 1.0);
  }
  const sp = c.label(labelLines(o), 1.1, `#${outlineColour(o).getHexString()}`);
  if (geom.kind === 'point') sp.position.set(0, 0, labelRise); else sp.position.set(labelAt[0], labelAt[1], labelAt[2] + labelRise);
  sp.userData.label = true; g.add(sp);
  if (o.accepted === 'rejected') g.visible = false;
  return g;
}

export function disposeGroup(g: THREE.Object3D) {
  g.traverse((o: THREE.Object3D) => {
    if (o.userData.shared) return;                                           // a GLB clone shares its geometry and materials with the loaded template
    const a = o as THREE.Mesh;
    // every THREE.Sprite shares ONE static geometry: disposing it would drop the buffers of every label in the viewer
    if (!(o as THREE.Sprite).isSprite) a.geometry?.dispose?.();
    const m = a.material as THREE.Material | THREE.Material[] | undefined;
    for (const x of Array.isArray(m) ? m : m ? [m] : []) { (x as THREE.SpriteMaterial).map?.dispose?.(); x.dispose(); }
  });
}

export class SiteScene {
  readonly group = new THREE.Group();
  private groups = new Map<string, THREE.Group>();
  private ctx: Ctx;
  private doc: SiteDesign | null = null;
  private selected: string | null = null;
  /** ids rebuilt by the most recent sync, and the running total (used by tests and the debug HUD) */
  lastRebuilt: string[] = [];
  rebuildCount = 0;

  constructor(private opts: SiteSceneOptions) {
    this.group.name = 'site_design';
    this.ctx = { O: opts.origin, sample: (e, n) => (opts.terrain ? opts.terrain.sample(e, n) : null), label: opts.makeLabel ?? makeSprite, glb: (id) => this.glbs.get(id)?.clone(true) ?? null };
  }
  /** Loaded Plan Studio GLBs by building id. The bytes are not part of the document: after a reload the visual is missing until it is attached again. */
  private glbs = new Map<string, THREE.Object3D>();
  hasGlb(id: string) { return this.glbs.has(id); }
  setGlb(id: string, obj: THREE.Object3D | null) {
    const old = this.glbs.get(id);
    if (old) { this.glbs.delete(id); old.traverse((x) => { const m = x as THREE.Mesh; m.geometry?.dispose?.(); for (const k of Array.isArray(m.material) ? m.material : m.material ? [m.material] : []) k.dispose(); }); }
    if (obj) this.glbs.set(id, obj);
    const o = this.doc?.objects.find((x) => x.id === id); if (o) { this.lastRebuilt = []; this.put(o); }
  }
  setTerrain(t: SceneTerrain | null) { this.opts.terrain = t; }

  /** Rebuild everything (first load, or the terrain changed). */
  syncAll(doc: SiteDesign) {
    this.doc = doc;
    for (const id of [...this.groups.keys()]) this.drop(id);
    this.lastRebuilt = [];
    for (const o of doc.objects) this.put(o);
  }
  /** Apply a store change event: rebuild only the changed and added objects, remove the removed ones. */
  apply(ev: ChangeEvent) {
    this.doc = ev.doc; this.lastRebuilt = [];
    for (const id of ev.removed) this.drop(id);
    const byId = new Map(ev.doc.objects.map((o) => [o.id, o]));
    for (const id of [...ev.changed, ...ev.added]) { const o = byId.get(id); if (o) this.put(o); }
  }
  private drop(id: string) { const g = this.groups.get(id); if (g) { this.group.remove(g); disposeGroup(g); this.groups.delete(id); } }
  private put(o: SiteObject) {
    this.drop(o.id);
    const g = buildObject(o, this.ctx); this.group.add(g); this.groups.set(o.id, g);
    this.lastRebuilt.push(o.id); this.rebuildCount++;
    if (o.id === this.selected) this.paint(g, true);
  }
  /** Show an object in a transient state (during a drag) without touching the document. */
  preview(o: SiteObject) { this.lastRebuilt = []; this.put(o); }
  /** Rebuild one object from the document (drag cancelled). */
  restore(id: string) { this.lastRebuilt = []; const o = this.doc?.objects.find((x) => x.id === id); if (o) this.put(o); else this.drop(id); }

  groupOf(id: string) { return this.groups.get(id) ?? null; }
  ids() { return [...this.groups.keys()]; }
  /** Objects that can be hit by a pick ray. */
  pickables(): THREE.Object3D[] {
    const out: THREE.Object3D[] = [];
    if (!this.group.visible) return out;                                       // the design layer is switched off
    for (const g of this.groups.values()) if (g.visible) g.traverse((o) => { if (o.userData.pick) out.push(o); });
    return out;
  }
  setSelected(id: string | null) {
    if (this.selected && this.groups.has(this.selected)) this.paint(this.groups.get(this.selected)!, false);
    this.selected = id;
    if (id && this.groups.has(id)) this.paint(this.groups.get(id)!, true);
  }
  private paint(g: THREE.Group, on: boolean) {
    g.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.Material | undefined;
      if (!m || !('color' in m) || o.userData.baseColour === undefined) return;
      (m as THREE.LineBasicMaterial).color.setHex(on ? new THREE.Color(SELECT_COLOUR).getHex() : (o.userData.baseColour as number));
    });
  }
  /** The object id a hit object belongs to. */
  static idOf(o: THREE.Object3D | null): string | null { let x = o; while (x) { if (x.userData?.siteId) return x.userData.siteId as string; x = x.parent; } return null; }
  dispose() { for (const id of [...this.groups.keys()]) this.drop(id); for (const id of [...this.glbs.keys()]) { const o = this.glbs.get(id)!; this.glbs.delete(id); o.traverse((x) => { const m = x as THREE.Mesh; m.geometry?.dispose?.(); for (const k of Array.isArray(m.material) ? m.material : m.material ? [m.material] : []) k.dispose(); }); } }
}
