/**
 * Design tools for the viewer: point placement, polyline and polygon drawing, selection, vertex handles, whole object drag, delete.
 *
 * - Every pointer position is a ray cast against the TERRAIN MESH (never a flat plane). The hit is snapped (boundary and object
 *   vertices, then edges, then an optional grid; Alt disables snapping) and lifted back onto the terrain with the height field.
 * - Edits go through the operation registry via the store, so each finished gesture is exactly one undo step. While a drag is in
 *   progress only a transient preview of that one object is rebuilt; the document changes when the pointer is released.
 * - The controller never invents data: new objects carry no parameters and no dimensions.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { Built } from '@/lib/viewer/sceneBuilder';
import { localToMga, mapBuildingPositions, type ImportPayload, type Pt } from './buildings';
import { dist2, drapePolyline, polygonArea, polylineLength, polylineLength3, ringCentroid, ringPerimeter, samePt, type Pt2 } from './geom';
import { OpError } from './ops';
import { buildTargets, normDeg, snapPoint, stepYaw15, type SnapResult, type SnapTargets } from './snap';
import { SiteScene, SELECT_COLOUR, type SceneTerrain } from './siteScene';
import { SiteDesignStore, type HistoryInfo } from './store';
import { heightFieldFromMeshes, type HeightField } from './terrain';
import { OBJECT_KINDS, levelOf, minVertices, verticesOf, type GeometryKind, type ObjectType, type Pos, type SiteObject, type Status } from './types';

export const SNAP_PIXELS = 10;

/** Dispose the geometries and materials of an object tree built by this controller (ghost, preview). */
function disposeObject(o: THREE.Object3D) {
  o.traverse((x) => {
    const m = x as THREE.Mesh;
    m.geometry?.dispose?.();
    const mat = m.material as THREE.Material | THREE.Material[] | undefined;
    for (const k of Array.isArray(mat) ? mat : mat ? [mat] : []) k.dispose();
  });
}
const HANDLE_PX = 6, DRAG_PX = 4, MIN_SPACING = 0.01;

export interface PointerInfo { ray: THREE.Ray; x: number; y: number; alt: boolean; shift: boolean; button: number }
export type ToolMode = 'select' | 'place' | 'draw';
export interface Readout { kind: 'polyline' | 'polygon'; vertices: number; planLength: number; surfaceLength: number | null; perimeter: number | null; area: number | null; live: boolean }
export interface DesignState {
  active: boolean; tool: ToolMode; objectType: ObjectType | null;
  selectedId: string | null; selectedVertex: number | null;
  hint: string; message: string; snapLabel: string; grid: number; newStatus: Status;
  readout: Readout | null; history: HistoryInfo; dragging: boolean; drawing: boolean;
  lotAvailable: boolean; terrainAvailable: boolean;
  /** why the design is read only (e.g. LOADING SAVED DESIGN), or null when it can be edited */
  locked: string | null;
  /** an imported building waiting to be placed (it follows the cursor), or null */
  pendingBuilding: { source_file: string; warnings: string[]; glb: string | null } | null;
  /** furniture item that the next placed furniture object takes, or null */
  furnitureItem: FurnitureChoice | null;
  /** the footprint tool is on: the use the building will get */
  footprintUse: string | null;
}
/** A catalogue item chosen for outdoor furniture. Dimensions are metres from the catalogue; an absent one stays NOT SET. */
export interface FurnitureChoice { item_id: string; title: string; source_ref: string; width_m?: number; depth_m?: number; height_m?: number }
export type FootprintHandler = (ring: Pos[], use: string) => void;
interface PendingBuilding { payload: ImportPayload; glb: { object: THREE.Object3D; name: string } | null }
export interface DesignHooks {
  built: Built;
  origin: readonly [number, number];
  terrainMeshes: THREE.Mesh[];
  lot: Pt2[] | null;
  terrainAvailable: boolean;
  /** metres per screen pixel at a world point */
  mpp(p: THREE.Vector3): number;
  setOrbit(on: boolean): void;
  store?: SiteDesignStore;
  makeLabel?: (text: string, scale: number, accent: string) => THREE.Sprite;
}
type Drag =
  | { kind: 'vertex'; id: string; index: number; insert: boolean; px: [number, number]; moved: boolean; pos: Pos | null }
  | { kind: 'body'; id: string; px: [number, number]; moved: boolean; grab: Pt2; anchor: Pt2; delta: Pt2 };

/**
 * Lengths and area of a line or area being drawn or selected. The surface length needs real terrain: when `terrainAvailable` is false
 * (a placeholder ground) or the terrain does not reach every sample it is null and the panel says DATA NOT AVAILABLE. The plan length
 * does not depend on terrain and is always given.
 */
export function readoutFor(kind: 'polyline' | 'polygon', pts: readonly Pos[], sample: (e: number, n: number) => number | null, live: boolean, terrainAvailable = true): Readout | null {
  if (!pts.length) return null;
  const closed = kind === 'polygon';
  const plan = polylineLength(pts), per = closed && pts.length >= 3 ? ringPerimeter(pts) : null;
  let surface: number | null = null;
  if (pts.length >= 2 && terrainAvailable) {
    const d = drapePolyline(pts, sample, 1, closed), line: [number, number, number][] = [];
    for (const x of d) if (x.p[2] !== null) line.push([x.p[0], x.p[1], x.p[2]]);
    if (line.length === d.length) { if (closed) line.push(line[0]); surface = polylineLength3(line); }       // null when the terrain does not reach every sample
  }
  return { kind, vertices: pts.length, planLength: closed && per !== null ? per : plan, surfaceLength: surface, perimeter: per, area: closed && pts.length >= 3 ? polygonArea(pts) : null, live };
}

export class DesignController {
  readonly store: SiteDesignStore;
  readonly scene: SiteScene;
  readonly hf: HeightField;
  readonly terrain: SceneTerrain;
  active = false;
  listener: (s: DesignState) => void = () => {};

  private tool: ToolMode = 'select'; private type: ObjectType | null = null;
  private selected: string | null = null; private selVertex: number | null = null;
  private grid = 0; private newStatus: Status = 'proposed';
  private message = ''; private snapLabel = '';
  private yaw = 0;
  private verts: Pos[] = []; private cursor: Pos | null = null;
  private drag: Drag | null = null; private downPx: [number, number] | null = null;
  private rc = new THREE.Raycaster();
  private ghost: THREE.Group | null = null; private ghostAt: { local: THREE.Vector3 } | null = null;
  private preview: THREE.Line | null = null; private marker: THREE.Mesh;
  private handles = new THREE.Group(); private selRing: THREE.Mesh;
  private tcache: { doc: unknown; exclude: string | null; vis: boolean; t: SnapTargets } | null = null;
  private ringWanted = false;
  private off: Array<() => void> = [];
  private lastSnapAt: THREE.Vector3 | null = null;
  private pending: PendingBuilding | null = null; private pendingAt: Pt2 | null = null;
  private furniture: FurnitureChoice | null = null;
  /** a footpath drawn as an area, and parameters/label a preset tool (garden) gives the new object */
  private shape: 'polyline' | 'polygon' | null = null; private preset: { params?: Record<string, { value: string; basis: 'user' }>; label?: string } | null = null;
  private footprintUse: string | null = null; private footprintHandler: FootprintHandler | null = null;

  constructor(private h: DesignHooks) {
    this.store = h.store ?? new SiteDesignStore();
    this.hf = heightFieldFromMeshes(h.terrainMeshes);
    const O = h.origin;
    this.terrain = { available: h.terrainAvailable && this.hf.triangleCount > 0, sample: (e, n) => this.hf.sample(e - O[0], n - O[1]) };
    this.scene = new SiteScene({ origin: O, terrain: this.terrain, makeLabel: h.makeLabel });
    h.built.root.add(this.scene.group, this.handles);
    this.marker = new THREE.Mesh(new THREE.RingGeometry(0.7, 1, 28), new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false, transparent: true, side: THREE.DoubleSide }));
    this.marker.renderOrder = 20; this.marker.visible = false; h.built.root.add(this.marker);
    this.selRing = new THREE.Mesh(new THREE.RingGeometry(0.85, 1, 32), new THREE.MeshBasicMaterial({ color: new THREE.Color(SELECT_COLOUR), depthTest: false, transparent: true, side: THREE.DoubleSide }));
    this.selRing.renderOrder = 20; this.selRing.visible = false; h.built.root.add(this.selRing);
    this.store.setEnv({ lot: h.lot, terrain: this.terrain });
    this.scene.syncAll(this.store.doc);
    this.off.push(this.store.on('change', (ev) => {
      this.scene.apply(ev);
      if (this.selected && !ev.doc.objects.some((o) => o.id === this.selected)) { this.selected = null; this.selVertex = null; }
      if (this.selVertex !== null) { const o = this.selObj(); if (!o || this.selVertex >= verticesOf(o.geometry).length) this.selVertex = null; }
      this.scene.setSelected(this.selected); this.syncHandles(); this.emit();
    }), this.store.on('history', () => this.emit()), this.store.on('lock', () => { if (this.store.locked && this.drag) this.cancelDrag(); this.emit(); }));
    this.emit();
  }

  // ---- state
  private selObj(): SiteObject | null { return this.selected ? this.store.doc.objects.find((o) => o.id === this.selected) ?? null : null; }
  private hint(): string {
    if (this.tool === 'place' && this.pending) return 'Click to place the building · R or Q/E rotate 15° · Alt turns snapping off · Esc cancel';
    if (this.tool === 'draw' && this.footprintUse) return 'Click the corners of the footprint · double click or Enter to finish · Backspace removes the last point · Esc cancel';
    if (this.tool === 'place') return 'Click to place · R or Q/E rotate 15° · Alt turns snapping off · Esc cancel';
    if (this.tool === 'draw') return 'Click to add points · double click or Enter to finish · Backspace removes the last point · Esc cancel';
    return this.selected ? 'Drag to move · drag a handle to edit · R rotate 15° · Del delete · Esc deselect' : 'Click an object to select it';
  }
  state(): DesignState {
    let readout: Readout | null = null;
    if (this.tool === 'draw' && this.type && this.verts.length) {
      const k = this.drawKind() as 'polyline' | 'polygon';
      readout = readoutFor(k, this.cursor ? [...this.verts, this.cursor] : this.verts, this.terrain.sample, true, this.terrain.available);
      if (readout) readout = { ...readout, vertices: this.verts.length };          // points placed so far; the moving cursor point is included in the lengths and area
    } else {
      const o = this.selObj();
      if (o && o.geometry.kind !== 'point') readout = readoutFor(o.geometry.kind, verticesOf(o.geometry), this.terrain.sample, false, this.terrain.available);
    }
    return {
      active: this.active, tool: this.tool, objectType: this.type, selectedId: this.selected, selectedVertex: this.selVertex,
      hint: this.hint(), message: this.message, snapLabel: this.snapLabel, grid: this.grid, newStatus: this.newStatus, readout,
      history: this.store.history(), dragging: !!this.drag?.moved, drawing: this.verts.length > 0,
      lotAvailable: !!this.h.lot, terrainAvailable: this.terrain.available, locked: this.store.locked,
      pendingBuilding: this.pending ? { source_file: this.pending.payload.source_file, warnings: this.pending.payload.warnings, glb: this.pending.glb?.name ?? null } : null,
      furnitureItem: this.furniture, footprintUse: this.footprintUse,
    };
  }
  private emit() { this.listener(this.state()); }
  private say(m: string) { this.message = m; this.emit(); }

  // ---- mode and tools
  setActive(on: boolean) {
    if (on === this.active) return;
    this.active = on;
    if (!on) { this.cancelAll(); this.tool = 'select'; this.type = null; this.handles.visible = false; this.selRing.visible = false; this.ringWanted = false; this.marker.visible = false; }
    else { this.handles.visible = true; this.syncHandles(); }
    this.emit();
  }
  setTool(mode: ToolMode, type: ObjectType | null = null) {
    if (mode !== 'select' && this.store.locked) { this.cancelAll(); this.tool = 'select'; this.type = null; this.syncHandles(); this.say(this.store.locked); return; }       // read only: no drawing or placing tools
    this.cancelAll(); this.tool = mode; this.type = mode === 'select' ? null : type; this.message = '';
    if (this.type && mode !== 'select' && OBJECT_KINDS[this.type].geometry === 'point' !== (mode === 'place')) { this.tool = 'select'; this.type = null; }   // place for points, draw for lines and areas
    if (this.tool === 'place' && this.type) this.makeGhost(this.type);
    this.syncHandles(); this.emit();
  }
  /** Start the right tool for an object type. */
  startFor(type: ObjectType, opts: { shape?: 'polyline' | 'polygon'; params?: Record<string, { value: string; basis: 'user' }>; label?: string } = {}) {
    const geometry = opts.shape ?? OBJECT_KINDS[type].geometry;
    this.setTool(geometry === 'point' ? 'place' : 'draw', type);
    if (this.type === type) { this.shape = opts.shape && opts.shape !== OBJECT_KINDS[type].geometry ? opts.shape : null; this.preset = opts.params || opts.label ? { params: opts.params, label: opts.label } : null; this.emit(); }
  }
  /** Geometry kind being drawn: the type's own, or the area shape of a footpath. */
  private drawKind(): GeometryKind | null { return this.type ? this.shape ?? OBJECT_KINDS[this.type].geometry : null; }
  /** Choose the catalogue item for the next outdoor furniture placed (null clears it). */
  setFurnitureItem(c: FurnitureChoice | null) { this.furniture = c; this.emit(); }

  // ---- buildings (imported, never designed here)
  /** Parse a Plan Studio GLB (metres, Y up) into an object that can be shown as the building visual. */
  loadGlb(buf: ArrayBuffer): Promise<THREE.Object3D> {
    return new Promise((resolve, reject) => new GLTFLoader().parse(buf, '', (g) => resolve(g.scene), (e) => reject(new Error(`THE GLB COULD NOT BE READ: ${e instanceof Error ? e.message : String(e)}`))));
  }
  /** Show a loaded GLB for an existing building (also used to attach it again after a reload; the bytes are not saved in the design). */
  attachGlb(id: string, obj: THREE.Object3D) { this.scene.setGlb(id, obj); this.emit(); }
  /** The imported footprint follows the cursor on the terrain until it is clicked. R, Q and E turn it. */
  beginBuildingPlacement(payload: ImportPayload, glb: { object: THREE.Object3D; name: string } | null = null) {
    if (this.store.locked) { this.cancelAll(); this.tool = 'select'; this.type = null; this.say(this.store.locked); return; }
    this.cancelAll(); this.tool = 'place'; this.type = 'building'; this.pending = { payload, glb }; this.message = ''; this.yaw = 0;
    const g = new THREE.Group(); g.visible = false; this.ghost = g; this.h.built.root.add(g);
    this.syncHandles(); this.emit();
  }
  /** Draw a footprint polygon on the terrain; `handler` gets the ring when it is finished (the page then imports it and places the building). */
  beginFootprintDrawing(use: string, handler: FootprintHandler) {
    if (this.store.locked) { this.cancelAll(); this.tool = 'select'; this.type = null; this.say(this.store.locked); return; }
    this.cancelAll(); this.tool = 'draw'; this.type = 'building'; this.footprintUse = use; this.footprintHandler = handler; this.message = '';
    this.syncHandles(); this.emit();
  }
  /** Place an imported building at once (no cursor step), e.g. a footprint that was drawn in place. */
  placeBuildingAt(payload: ImportPayload, at: Pt2, yaw = 0, glb: { object: THREE.Object3D; name: string } | null = null): string | null {
    try {
      const r = this.store.run('place_building', { payload, at: { e: at[0], n: at[1] }, yaw_deg: yaw, status: this.newStatus, ...(glb ? { glb_name: glb.name } : {}) }, 'Place building');
      const id = r.id as string; if (glb) this.scene.setGlb(id, glb.object);
      this.selected = id; this.scene.setSelected(id); this.message = ''; this.syncHandles(); this.emit(); return id;
    } catch (e) { this.message = e instanceof OpError ? e.message : String(e); this.emit(); return null; }
  }
  /**
   * Finished floor level against the existing ground at the footprint vertices (cf = FFL minus ground; negative is cut, positive is fill).
   * Vertices only, not a volume. Null when the building has no FFL; `missing` counts vertices the terrain does not reach.
   */
  buildingCutFill(id: string): { min: number; max: number; sampled: number; missing: number } | null {
    const o = this.store.doc.objects.find((x) => x.id === id), ffl = o ? levelOf(o, 'ffl_rl') : null;
    if (!o?.building || ffl === null) return null;
    let min = Infinity, max = -Infinity, sampled = 0, missing = 0;
    for (const p of o.building.levels[o.building.datum_index].rings.flat()) {
      const g = this.terrain.sample(p[0], p[1]);
      if (g === null) { missing++; continue; }
      sampled++; min = Math.min(min, ffl - g); max = Math.max(max, ffl - g);
    }
    return sampled ? { min, max, sampled, missing } : { min: NaN, max: NaN, sampled: 0, missing };
  }
  private updateBuildingGhost(at: Pt2) {
    const pb = this.pending, g = this.ghost; if (!pb || !g) return;
    for (const c of [...g.children]) { g.remove(c); disposeObject(c); }
    const O = this.h.origin, b = pb.payload.building, datum = b.levels[b.datum_index];
    for (const ring of datum.rings) {
      const pts = ring.map((p) => localToMga(p, pb.payload.ref, at, this.yaw)), d = drapePolyline(pts, this.terrain.sample, 1, true);
      let last = d.map((x) => x.p[2]).find((z): z is number => z !== null) ?? 0;
      const v = d.map((x) => { if (x.p[2] !== null) last = x.p[2]; return new THREE.Vector3(x.p[0] - O[0], x.p[1] - O[1], last + 0.12); }); v.push(v[0].clone());
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(v), new THREE.LineBasicMaterial({ color: new THREE.Color(OBJECT_KINDS.building.colour), depthTest: false }));
      line.renderOrder = 18; g.add(line);
    }
    g.visible = true; this.pendingAt = at;
  }
  setGrid(g: number) { this.grid = Number.isFinite(g) && g > 0 ? g : 0; this.emit(); }
  setNewStatus(s: Status) { this.newStatus = s; this.emit(); }
  select(id: string | null) { this.selected = id; this.selVertex = null; this.scene.setSelected(id); this.syncHandles(); this.emit(); }
  private cancelAll() {
    if (this.drag) this.cancelDrag();
    this.verts = []; this.cursor = null; this.clearPreview();
    if (this.ghost) { this.h.built.root.remove(this.ghost); disposeObject(this.ghost); this.ghost = null; }
    this.ghostAt = null; this.marker.visible = false; this.snapLabel = '';
    this.pendingAt = null; this.footprintUse = null; this.footprintHandler = null; this.shape = null; this.preset = null;
    if (this.pending?.glb) disposeObject(this.pending.glb.object);
    this.pending = null;
  }
  private cancelDrag() {
    const d = this.drag; this.drag = null; this.h.setOrbit(true);
    if (d) { this.scene.restore(d.id); this.syncHandles(); }
  }

  // ---- ghost, preview, markers
  private makeGhost(type: ObjectType) {
    const col = new THREE.Color(OBJECT_KINDS[type].colour), g = new THREE.Group();
    const s = new THREE.Mesh(new THREE.SphereGeometry(0.25, 14, 10), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.6 })); s.position.z = 0.25;
    const pole = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, 1.5)]), new THREE.LineBasicMaterial({ color: col }));
    const tick = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0.05), new THREE.Vector3(0, 1, 0.05)]), new THREE.LineBasicMaterial({ color: col }));
    g.add(s, pole, tick); g.visible = false; this.ghost = g; this.h.built.root.add(g);
  }
  private clearPreview() { if (this.preview) { this.h.built.root.remove(this.preview); this.preview.geometry.dispose(); (this.preview.material as THREE.Material).dispose(); this.preview = null; } }
  private updatePreview() {
    this.clearPreview();
    if (this.tool !== 'draw' || !this.type || !this.verts.length) return;
    const closed = this.drawKind() === 'polygon', pts = this.cursor ? [...this.verts, this.cursor] : this.verts;
    const d = drapePolyline(pts, this.terrain.sample, 1, closed && pts.length >= 3), O = this.h.origin;
    let last = d.map((x) => x.p[2]).find((z): z is number => z !== null) ?? 0;
    const v = d.map((x) => { if (x.p[2] !== null) last = x.p[2]; return new THREE.Vector3(x.p[0] - O[0], x.p[1] - O[1], last + 0.08); });
    if (closed && pts.length >= 3) v.push(v[0].clone());
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(v), new THREE.LineBasicMaterial({ color: new THREE.Color(OBJECT_KINDS[this.type].colour), depthTest: false }));
    line.renderOrder = 15; this.preview = line; this.h.built.root.add(line);
  }
  private showSnap(local: THREE.Vector3 | null, snap: SnapResult | null) {
    this.snapLabel = snap && snap.kind !== 'none' ? `SNAP: ${snap.label}` : '';
    this.lastSnapAt = local;
    if (local && snap && snap.kind !== 'none') { this.marker.position.copy(local); this.marker.position.z += 0.1; this.marker.visible = true; } else this.marker.visible = false;
  }

  // ---- hit testing and snapping
  private hitTerrain(ray: THREE.Ray): { local: THREE.Vector3; world: THREE.Vector3 } | null {
    this.rc.set(ray.origin, ray.direction); this.rc.far = 5000;
    const h = this.rc.intersectObjects(this.h.terrainMeshes, false)[0];
    return h ? { local: this.h.built.root.worldToLocal(h.point.clone()), world: h.point } : null;
  }
  /** False while the design layer is switched off: its objects are then not pickable, not draggable and not snap targets. */
  private designVisible(): boolean { return this.scene.group.visible; }
  private targets(exclude: string | null): SnapTargets {
    const doc = this.store.doc, vis = this.designVisible();
    if (!this.tcache || this.tcache.doc !== doc || this.tcache.exclude !== exclude || this.tcache.vis !== vis) {
      const others = (vis ? doc.objects : []).filter((o) => o.id !== exclude && o.accepted !== 'rejected').map((o) => ({ id: o.id, closed: o.geometry.kind === 'polygon', pts: verticesOf(o.geometry) }));
      this.tcache = { doc, exclude, vis, t: buildTargets(this.h.lot, others) };
    }
    const t = this.tcache.t;
    if (!this.verts.length) return t;
    const own = this.verts, closed = this.drawKind() === 'polygon';
    return { vertices: [...t.vertices, ...own.map((p) => ({ p: [p[0], p[1]] as Pt2, source: 'object' as const }))], edges: [...t.edges, ...own.slice(1).map((p, i) => ({ a: [own[i][0], own[i][1]] as Pt2, b: [p[0], p[1]] as Pt2, source: 'object' as const })), ...(closed && own.length > 2 ? [{ a: [own[own.length - 1][0], own[own.length - 1][1]] as Pt2, b: [own[0][0], own[0][1]] as Pt2, source: 'object' as const }] : [])] };
  }
  /** Snap an MGA E, N. `world` is the world point used to convert the pixel capture radius to metres. */
  private snapMga(mga: Pt2, alt: boolean, world: THREE.Vector3, exclude: string | null): SnapResult {
    if (alt) return { p: mga, kind: 'none', label: '' };
    return snapPoint(mga, this.targets(exclude), { tol: SNAP_PIXELS * this.h.mpp(world), grid: this.grid });
  }
  /** Terrain hit, snapped, with the local point lifted onto the terrain. */
  private aim(info: PointerInfo, exclude: string | null): { mga: Pt2; local: THREE.Vector3; snap: SnapResult } | null {
    const hit = this.hitTerrain(info.ray); if (!hit) return null;
    const O = this.h.origin, s = this.snapMga([hit.local.x + O[0], hit.local.y + O[1]], info.alt, hit.world, exclude);
    const local = hit.local.clone();
    if (s.kind !== 'none') { local.x = s.p[0] - O[0]; local.y = s.p[1] - O[1]; local.z = this.hf.sample(local.x, local.y) ?? hit.local.z; }
    return { mga: s.p, local, snap: s };
  }
  private pickObject(ray: THREE.Ray, world: THREE.Vector3 | null): string | null {
    if (!this.designVisible()) return null;
    this.rc.set(ray.origin, ray.direction); this.rc.far = 5000;
    const mpp = world ? this.h.mpp(world) : 0.05;
    this.rc.params.Line = { threshold: Math.max(0.15, 6 * mpp) };
    const hit = this.rc.intersectObjects(this.scene.pickables(), false)[0];
    return hit ? SiteScene.idOf(hit.object) : null;
  }
  private pickHandle(ray: THREE.Ray): { kind: 'vertex' | 'mid'; index: number } | null {
    if (!this.handles.children.length || !this.designVisible()) return null;
    this.rc.set(ray.origin, ray.direction); this.rc.far = 5000;
    const hit = this.rc.intersectObjects(this.handles.children, false)[0];
    return hit ? { kind: hit.object.userData.handle, index: hit.object.userData.index } : null;
  }

  // ---- handles
  private syncHandles(objOverride?: SiteObject) {
    for (const c of [...this.handles.children]) { this.handles.remove(c); (c as THREE.Mesh).geometry.dispose(); ((c as THREE.Mesh).material as THREE.Material).dispose(); }
    this.selRing.visible = false; this.ringWanted = false;
    const o = objOverride ?? this.selObj();
    if (!this.active || this.tool !== 'select' || !o) return;
    const O = this.h.origin, ps = verticesOf(o.geometry), at = (p: readonly number[]) => new THREE.Vector3(p[0] - O[0], p[1] - O[1], (p[2] ?? this.terrain.sample(p[0], p[1]) ?? 0) + 0.1);
    if (o.geometry.kind === 'point') { this.selRing.position.copy(at(o.geometry.p)); this.ringWanted = true; this.selRing.visible = this.designVisible(); return; }
    if (o.building) return;                                    // a building footprint is read only: no vertex handles, only move and turn
    const gv = new THREE.SphereGeometry(1, 12, 8), gm = new THREE.BoxGeometry(1.4, 1.4, 1.4);
    ps.forEach((p, i) => {
      const m = new THREE.Mesh(gv.clone(), new THREE.MeshBasicMaterial({ color: new THREE.Color(i === this.selVertex ? '#ff5a3c' : SELECT_COLOUR), depthTest: false, transparent: true }));
      m.position.copy(at(p)); m.renderOrder = 30; m.userData = { handle: 'vertex', index: i }; this.handles.add(m);
    });
    const n = ps.length, segs = o.geometry.kind === 'polygon' ? n : n - 1;
    for (let i = 0; i < segs; i++) {
      const a = ps[i], b = ps[(i + 1) % n], mid: Pos = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      const m = new THREE.Mesh(gm.clone(), new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false, transparent: true, opacity: 0.8 }));
      m.position.copy(at(mid)); m.rotation.z = Math.PI / 4; m.renderOrder = 29; m.userData = { handle: 'mid', index: i + 1 }; this.handles.add(m);
    }
    gv.dispose(); gm.dispose();
  }
  /** Per frame: keep handles and markers a constant size on screen. */
  frame() {
    if (!this.active) return;
    const vis = this.designVisible();
    this.handles.visible = vis; this.selRing.visible = this.ringWanted && vis;       // handles and the selection ring follow the design layer
    for (const m of this.handles.children) { const w = m.getWorldPosition(new THREE.Vector3()); m.scale.setScalar(this.h.mpp(w) * HANDLE_PX * (m.userData.handle === 'mid' ? 0.6 : 1)); }
    if (this.selRing.visible) this.selRing.scale.setScalar(this.h.mpp(this.selRing.getWorldPosition(new THREE.Vector3())) * 14);
    if (this.marker.visible) this.marker.scale.setScalar(this.h.mpp(this.marker.getWorldPosition(new THREE.Vector3())) * 9);
    if (this.ghost?.visible) { const s = 1; this.ghost.scale.setScalar(s); }
  }

  // ---- pointer events (called by the engine)
  pointerMove(info: PointerInfo) {
    if (!this.active) return;
    if (this.drag) { this.dragMove(info); return; }
    if (this.tool === 'place' && this.pending && this.ghost) {
      const a = this.aim(info, null);
      if (!a) { this.ghost.visible = false; this.pendingAt = null; this.showSnap(null, null); this.emit(); return; }
      this.updateBuildingGhost(a.mga); this.showSnap(a.local, a.snap); this.emit();
    } else if (this.tool === 'place' && this.ghost) {
      const a = this.aim(info, null);
      if (!a) { this.ghost.visible = false; this.ghostAt = null; this.showSnap(null, null); this.emit(); return; }
      this.ghost.position.copy(a.local); this.ghost.rotation.z = -(this.yaw * Math.PI) / 180; this.ghost.visible = true; this.ghostAt = { local: a.local };
      this.showSnap(a.local, a.snap); this.cursor = [a.mga[0], a.mga[1]]; this.emit();
    } else if (this.tool === 'draw') {
      const a = this.aim(info, null);
      if (!a) { this.cursor = null; this.showSnap(null, null); this.updatePreview(); this.emit(); return; }
      this.cursor = [a.mga[0], a.mga[1]]; this.showSnap(a.local, a.snap); this.updatePreview(); this.emit();
    }
  }
  /** Returns true when a drag has begun (the engine then disables orbiting). */
  pointerDown(info: PointerInfo): boolean {
    this.downPx = [info.x, info.y];
    if (!this.active || this.tool !== 'select' || info.button !== 0) return false;
    const hh = this.pickHandle(info.ray), ro = this.store.locked !== null;       // read only: selecting still works, dragging does not
    if (hh && this.selected && !ro) {
      this.drag = { kind: 'vertex', id: this.selected, index: hh.index, insert: hh.kind === 'mid', px: [info.x, info.y], moved: false, pos: null };
      this.h.setOrbit(false); return true;
    }
    const t = this.hitTerrain(info.ray), id = this.pickObject(info.ray, t?.world ?? null);
    if (!id) return false;
    if (id !== this.selected) this.select(id);
    const o = this.selObj(); if (!t || !o || ro) return false;
    const O = this.h.origin, grab: Pt2 = [t.local.x + O[0], t.local.y + O[1]];
    let anchor: Pt2 = [grab[0], grab[1]], best = Infinity;
    for (const p of verticesOf(o.geometry)) { const d = dist2(p, grab); if (d < best) { best = d; anchor = [p[0], p[1]]; } }
    this.drag = { kind: 'body', id, px: [info.x, info.y], moved: false, grab, anchor, delta: [0, 0] };
    this.h.setOrbit(false); return true;
  }
  private dragMove(info: PointerInfo) {
    const d = this.drag!; if (!d.moved && Math.hypot(info.x - d.px[0], info.y - d.px[1]) <= DRAG_PX && !(d.kind === 'vertex' && d.insert && false)) return;
    d.moved = true;
    const o = this.store.doc.objects.find((x) => x.id === d.id); if (!o) return;
    const t = this.hitTerrain(info.ray); if (!t) return;
    const O = this.h.origin, cur: Pt2 = [t.local.x + O[0], t.local.y + O[1]];
    if (d.kind === 'vertex') {
      const s = this.snapMga(cur, info.alt, t.world, d.id);
      const z = d.insert ? undefined : verticesOf(o.geometry)[d.index]?.[2];                  // moving a vertex keeps an RL it already had
      d.pos = z === undefined ? [s.p[0], s.p[1]] : [s.p[0], s.p[1], z]; this.showSnap(new THREE.Vector3(s.p[0] - O[0], s.p[1] - O[1], this.hf.sample(s.p[0] - O[0], s.p[1] - O[1]) ?? t.local.z), s);
      this.previewObject(o, (ps) => (d.insert ? [...ps.slice(0, d.index), d.pos!, ...ps.slice(d.index)] : ps.map((p, i) => (i === d.index ? d.pos! : p))));
    } else {
      const want: Pt2 = [d.anchor[0] + (cur[0] - d.grab[0]), d.anchor[1] + (cur[1] - d.grab[1])];
      const s = this.snapMga(want, info.alt, t.world, d.id);
      d.delta = [s.p[0] - d.anchor[0], s.p[1] - d.anchor[1]]; this.showSnap(null, s);
      this.previewObject(o, (ps) => ps.map((p) => (p.length === 3 ? [p[0] + d.delta[0], p[1] + d.delta[1], p[2]] : [p[0] + d.delta[0], p[1] + d.delta[1]]) as Pos));
    }
    this.emit();
  }
  private previewObject(o: SiteObject, f: (ps: Pos[]) => Pos[]) {
    const ps = f(verticesOf(o.geometry) as Pos[]), g = o.geometry;
    const geometry = g.kind === 'point' ? { ...g, p: ps[0] } : g.kind === 'polyline' ? { kind: 'polyline' as const, pts: ps } : { kind: 'polygon' as const, ring: ps };
    const pv: SiteObject = { ...o, geometry, ...(o.building ? { building: { ...mapBuildingPositions(o.building, (p) => f([p])[0]), frame: { ...o.building.frame, origin: [f([o.building.frame.origin])[0][0], f([o.building.frame.origin])[0][1]] as [number, number] } } } : {}) };
    this.scene.preview(pv); this.syncHandles(pv);
    if (g.kind !== 'point') this.listener({ ...this.state(), readout: readoutFor(g.kind, ps, this.terrain.sample, true, this.terrain.available) });
  }
  pointerUp(info: PointerInfo, moved: boolean) {
    if (!this.active) return;
    const wasDrag = this.drag; this.downPx = null;
    if (wasDrag) {
      this.drag = null; this.h.setOrbit(true); this.marker.visible = false; this.snapLabel = '';
      try {
        if (wasDrag.kind === 'vertex') {
          if (wasDrag.moved && wasDrag.pos) {
            this.store.run('edit_vertices', { id: wasDrag.id, action: wasDrag.insert ? 'insert' : 'move', index: wasDrag.index, point: { e: wasDrag.pos[0], n: wasDrag.pos[1], ...(wasDrag.pos.length === 3 ? { z: wasDrag.pos[2] } : {}) } }, wasDrag.insert ? 'Insert vertex' : 'Move vertex');
          } else if (wasDrag.insert) {
            const o = this.selObj(); if (o) { const ps = verticesOf(o.geometry), a = ps[(wasDrag.index - 1 + ps.length) % ps.length], b = ps[wasDrag.index % ps.length]; this.store.run('edit_vertices', { id: wasDrag.id, action: 'insert', index: wasDrag.index, point: { e: (a[0] + b[0]) / 2, n: (a[1] + b[1]) / 2 } }, 'Insert vertex'); }
          } else { this.selVertex = this.selVertex === wasDrag.index ? null : wasDrag.index; this.scene.restore(wasDrag.id); this.syncHandles(); this.emit(); return; }
        } else if (wasDrag.moved && (wasDrag.delta[0] !== 0 || wasDrag.delta[1] !== 0)) {
          this.store.run('move_object', { id: wasDrag.id, dx: wasDrag.delta[0], dy: wasDrag.delta[1] }, 'Move object');
        } else { this.scene.restore(wasDrag.id); this.syncHandles(); this.emit(); return; }
        this.message = '';
      } catch (e) {
        this.scene.restore(wasDrag.id); this.syncHandles(); this.say(e instanceof OpError ? e.message : String(e)); return;
      }
      return;
    }
    if (moved || info.button === 1) return;
    if (info.button === 2) { if (this.tool !== 'select') { if (this.verts.length) { this.verts = []; this.updatePreview(); this.emit(); } else this.setTool('select'); } return; }
    if (info.button !== 0) return;
    if (this.tool === 'place' && this.type) this.placeAt(info);
    else if (this.tool === 'draw' && this.type) this.addVertex(info);
    else if (this.tool === 'select') {
      const t = this.hitTerrain(info.ray), id = this.pickObject(info.ray, t?.world ?? null);
      if (!id && this.selected) this.select(null);
    }
  }
  doubleClick() {
    if (!this.active || this.tool !== 'draw') return;
    this.dropNearDuplicateLast();
    this.finishDrawing();
  }
  /**
   * The second click of a double click can land a pixel or two from the first and add a near duplicate last vertex. A final vertex
   * within the pixel capture radius (converted to metres at the current camera scale) of the one before it is dropped.
   */
  private dropNearDuplicateLast() {
    const n = this.verts.length; if (n < 2) return;
    const a = this.verts[n - 1], b = this.verts[n - 2], O = this.h.origin;
    const world = this.h.built.root.localToWorld(new THREE.Vector3(a[0] - O[0], a[1] - O[1], a[2] ?? this.terrain.sample(a[0], a[1]) ?? 0));
    if (dist2(a, b) <= SNAP_PIXELS * this.h.mpp(world)) { this.verts.pop(); this.updatePreview(); }
  }

  private placeAt(info: PointerInfo) {
    const a = this.aim(info, null); if (!a || !this.type) return;
    if (this.pending) {
      const pb = this.pending;
      try {
        const r = this.store.run('place_building', { payload: pb.payload, at: { e: a.mga[0], n: a.mga[1] }, yaw_deg: this.yaw, status: this.newStatus, ...(pb.glb ? { glb_name: pb.glb.name } : {}) }, 'Place building');
        const id = r.id as string;
        if (pb.glb) { this.scene.setGlb(id, pb.glb.object); this.pending = { ...pb, glb: null }; }          // the scene owns the GLB now
        this.setTool('select'); this.selected = id; this.scene.setSelected(id); this.syncHandles(); this.message = '';
      } catch (e) { this.message = e instanceof OpError ? e.message : String(e); }
      this.emit(); return;
    }
    if (this.type === 'furniture' && this.furniture) {
      const f = this.furniture, taken = new Set(this.store.doc.objects.map((o) => o.id));
      let id = this.store.ctx.newId('furniture'); while (taken.has(id)) id = this.store.ctx.newId('furniture');
      const res = this.store.runBatch('Place outdoor furniture', [
        { op: 'add_object', args: { id, type: 'furniture', points: [{ e: a.mga[0], n: a.mga[1] }], yaw_deg: this.yaw, status: this.newStatus } },
        { op: 'set_catalogue_item', args: { id, item_id: f.item_id, source_ref: f.source_ref, width_m: f.width_m, depth_m: f.depth_m, height_m: f.height_m } },
      ]);
      const bad = res.find((x) => !x.ok);
      if (bad && !bad.ok) this.message = bad.error; else { this.selected = id; this.scene.setSelected(id); this.message = ''; }
      this.emit(); return;
    }
    try {
      const r = this.store.run('add_object', { type: this.type, points: [{ e: a.mga[0], n: a.mga[1] }], yaw_deg: this.yaw, status: this.newStatus }, `Place ${OBJECT_KINDS[this.type].label.toLowerCase()}`);
      this.selected = r.id as string; this.scene.setSelected(this.selected); this.message = '';
    } catch (e) { this.message = e instanceof OpError ? e.message : String(e); }
    this.emit();
  }
  private addVertex(info: PointerInfo) {
    const a = this.aim(info, null); if (!a || !this.type) return;
    const last = this.verts[this.verts.length - 1], p: Pos = [a.mga[0], a.mga[1]];
    const closed = this.drawKind() === 'polygon';
    if (closed && this.verts.length >= 3 && samePt(p, this.verts[0])) { this.finishDrawing(); return; }       // click on the first point closes the area
    if (last && dist2(last, p) < MIN_SPACING) return;                                                           // the second click of a double click
    this.verts.push(p); this.message = ''; this.updatePreview(); this.emit();
  }
  /** Finish the line or area being drawn and add it to the design. */
  finishDrawing() {
    if (!this.type || !this.verts.length) return;
    const need = minVertices(this.drawKind()!);
    if (this.verts.length < need) { this.say(`A ${OBJECT_KINDS[this.type].label.toLowerCase()} needs at least ${need} points`); return; }
    if (this.footprintUse && this.footprintHandler) {                       // a drawn building footprint is imported, not added
      const ring = this.verts.slice(), use = this.footprintUse, handler = this.footprintHandler;
      this.setTool('select'); this.message = 'Importing the footprint'; this.emit(); handler(ring, use); return;
    }
    try {
      const r = this.store.run('add_object', {
        type: this.type, points: this.verts.map((p) => ({ e: p[0], n: p[1] })), status: this.newStatus, ...(this.shape ? { shape: this.shape } : {}),
        ...(this.preset?.params ? { params: this.preset.params } : {}), ...(this.preset?.label ? { label: this.preset.label } : {}),
      }, `Draw ${(this.preset?.label ?? OBJECT_KINDS[this.type].label).toLowerCase()}`);
      this.verts = []; this.cursor = null; this.clearPreview(); this.selected = r.id as string; this.scene.setSelected(this.selected); this.message = '';
    } catch (e) { this.message = e instanceof OpError ? e.message : String(e); }
    this.emit();
  }

  // ---- keys (called by the engine; returns true when handled)
  key(e: KeyboardEvent): boolean {
    if (!this.active) return false;
    const ctrl = e.ctrlKey || e.metaKey;
    if (ctrl && e.code === 'KeyZ') { e.preventDefault(); e.shiftKey ? this.redo() : this.undo(); return true; }
    if (ctrl && e.code === 'KeyY') { e.preventDefault(); this.redo(); return true; }
    if (ctrl) return false;
    switch (e.code) {
      case 'Escape':
        if (this.drag) this.cancelDrag();
        else if (this.verts.length) { this.verts = []; this.cursor = null; this.clearPreview(); }
        else if (this.tool !== 'select') this.setTool('select');
        else if (this.selVertex !== null) { this.selVertex = null; this.syncHandles(); }
        else if (this.selected) this.select(null);
        else return false;
        this.emit(); return true;
      case 'Enter': if (this.tool === 'draw') { this.finishDrawing(); return true; } return false;
      case 'Backspace':
        if (this.tool === 'draw' && this.verts.length) { e.preventDefault(); this.verts.pop(); this.updatePreview(); this.emit(); return true; }
        return this.deleteSelection();
      case 'Delete': return this.deleteSelection();
      case 'KeyR': case 'KeyE': return this.rotate(e.shiftKey ? -1 : 1);
      case 'KeyQ': return this.rotate(-1);
      default: return false;
    }
  }
  private rotate(dir: 1 | -1): boolean {
    if (this.tool === 'place') {
      this.yaw = stepYaw15(this.yaw, dir);
      if (this.pending) { if (this.pendingAt) this.updateBuildingGhost(this.pendingAt); }
      else if (this.ghost) this.ghost.rotation.z = -(this.yaw * Math.PI) / 180;
      this.emit(); return true;
    }
    if (this.tool === 'select' && this.selected) { try { this.store.run('rotate_object', { id: this.selected, angle_deg: 15 * dir }, 'Rotate object'); } catch (e) { this.say(String(e)); } return true; }
    return false;
  }
  /** Delete the selected vertex, or the selected object. */
  deleteSelection(): boolean {
    if (this.tool !== 'select' || !this.selected) return false;
    try {
      if (this.selVertex !== null) { this.store.run('edit_vertices', { id: this.selected, action: 'delete', index: this.selVertex }, 'Delete vertex'); this.selVertex = null; this.syncHandles(); }
      else { this.store.run('delete_object', { id: this.selected }, 'Delete object'); }
      this.message = '';
    } catch (e) { this.message = e instanceof OpError ? e.message : String(e); }
    this.emit(); return true;
  }
  undo() { this.cancelDrag(); this.store.undo(); this.emit(); }
  redo() { this.cancelDrag(); this.store.redo(); this.emit(); }
  yawDeg() { return normDeg(this.yaw); }

  dispose() {
    this.cancelAll(); this.off.forEach((f) => f()); this.off = [];
    this.h.built.root.remove(this.scene.group, this.handles, this.marker, this.selRing); this.scene.dispose();
    this.marker.geometry.dispose(); (this.marker.material as THREE.Material).dispose(); this.selRing.geometry.dispose(); (this.selRing.material as THREE.Material).dispose();
  }
}
