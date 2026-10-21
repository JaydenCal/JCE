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
import { dist2, drapePolyline, pointInRing, polygonArea, polylineLength, polylineLength3, ringCentroid, ringPerimeter, samePt, type Pt2 } from './geom';
import { OpError } from './ops';
import { buildTargets, normDeg, snapPoint, stepYaw15, type SnapResult, type SnapTargets } from './snap';
import { SiteScene, SELECT_COLOUR, type SceneTerrain } from './siteScene';
import { SiteDesignStore, type HistoryInfo } from './store';
import { heightFieldFromMeshes, type HeightField } from './terrain';
import {
  chainageOnKerb, drivewayGaps, effectiveDriveway, linkedBuilding, pointAtChainage, polylineChainages, previewProfile, projectToKerb,
  type GradingResult, type Kerb, type ProfileView, type RuleInfo,
} from './driveway';
import { LiveEngine, objectSig, type LiveStatus } from './liveEngine';
import { EngineHttpError, postRwtSize, postSewerRoute, postWaterRoute, type RouteProposal, type RwtSizeResult, type SewerRouteRequest, type WaterRouteRequest } from './engineApi';
import { CalibrationError, calibrate, calibrationLabel, clampOpacity, MAX_UNDERLAY_PX, type Calibration } from './underlay';
import { LiveChecks, type ChecksState } from './serverChecks';
import { zonesOf } from './checkList';
import { StormwaterSession, type SwState } from './stormwaterSession';
import { FirstDesignSession, type FdState } from './firstDesignSession';
import type { Endpoint } from './persist';
import { OBJECT_KINDS, dimOf, levelOf, minVertices, verticesOf, type GeometryKind, type ObjectType, type Pos, type SiteDesign, type SiteObject, type Status } from './types';

export const SNAP_PIXELS = 10;
/** the label of a building that was placed where SA7 aligned the PDF (the user still checks it) */
export const ALIGNED_LABEL = 'PLACED BY PDF ALIGNMENT, CHECK';

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
/** `pick` (stage 8): one click returns a snapped model point to a caller (the calibration points of a plan underlay); it changes nothing in the design. */
export type ToolMode = 'select' | 'place' | 'draw' | 'pick';
/** The plan underlay of the Trace service tool (a session aid, not saved with the design). */
export interface UnderlayInfo { name: string; width: number; height: number; opacity: number; calibrated: boolean; label: string }
/** A sewer or water route proposal from the server, waiting to be applied (one undo step) or discarded. */
export interface RoutePanel { kind: 'sewer' | 'water'; status: 'pending' | 'ok' | 'error'; error: string; result: RouteProposal | null; applied: boolean }
export type ServiceFields = Record<string, { value: string | number | boolean; basis: 'user' }>;
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
  /** stage 6: the long section of the selected driveway (server result, or a PREVIEW while dragging), its state, and the selected grading area's result */
  driveway: DrivewayPanel | null;
  grading: GradingPanel | null;
  /** hover text of a failing chainage (requirement key, limit and value), or '' */
  hoverText: string;
  /** one line about the handle being dragged (crossover chainage along the kerb line, width) */
  dragInfo: string;
  /** stage 7: the rule based checks of the whole design (server answer) and the state of the optional tank sizing for the selected tank */
  checks: ChecksState;
  rwtSize: RwtSizePanel | null;
  /** stage 8: the plan underlay, the route proposal and the prompt of a point pick in progress */
  underlay: UnderlayInfo | null;
  route: RoutePanel | null;
  pickPrompt: string | null;
  /** stage 9: the stormwater helper (entries, the last server answer, uploads, the overland flow toggle) */
  stormwater: SwState;
  /** stage 10: AI first design (the estimate, the confirm step and the checklist of proposals) */
  firstDesign: FdState;
}
export interface RwtSizePanel { id: string; status: 'idle' | 'pending' | 'ok' | 'error'; error: string; result: RwtSizeResult | null }
export interface EnginePanel { status: LiveStatus; error: string; /** the result on show is a PREVIEW or stale */ stale: boolean }
export interface DrivewayPanel extends EnginePanel { id: string; view: ProfileView | null; gaps: string[]; kerbAvailable: boolean; linkedBuilding: string | null }
export interface GradingPanel extends EnginePanel { id: string; result: GradingResult | null }
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
  /** stage 6: the EXISTING ground meshes (survey / DEM parts only, never the design surface) for the driveway preview and cut / fill colours */
  existingMeshes?: THREE.Mesh[];
  /** the assumed kerb line of the 3D model (the crossover is dragged along it); null = not in the bundle */
  kerb?: Kerb | null;
  /** where the engines are (POST driveway-profile and grading); null / absent = no server on this page */
  engine?: Endpoint | null;
  engineDebounceMs?: number;
  /** debounce of the whole design check (stage 7), milliseconds */
  checksDebounceMs?: number;
  /** terrain status text of the bundle, shown on the preview */
  terrainStatus?: string;
}
type Drag =
  | { kind: 'vertex'; id: string; index: number; insert: boolean; px: [number, number]; moved: boolean; pos: Pos | null; translate?: boolean; link?: string | null }
  | { kind: 'width'; id: string; px: [number, number]; moved: boolean; width: number | null }
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
  /** height field of the EXISTING ground only (survey / DEM parts), or null; the driveway preview and cut / fill colours use it, never the design surface */
  readonly existingHf: HeightField | null;
  readonly live: LiveEngine;
  /** stage 7: the server checks of the whole design, asked for after every document change */
  readonly checks: LiveChecks;
  /** stage 9: the stormwater helper. The server computes; the overland flow layer of its answer is drawn by `scene` while the toggle is on. */
  readonly stormwater: StormwaterSession;
  /** stage 10: AI first design. The server builds and chooses; the batch is run as one undo step and the proposals are accepted, edited or rejected one by one. */
  readonly firstDesign: FirstDesignSession;
  private sizing = new Map<string, RwtSizePanel>();
  private sizeAbort: AbortController | null = null;
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
  private shape: 'polyline' | 'polygon' | 'point' | null = null; private preset: { params?: ServiceFields; label?: string } | null = null;
  private footprintUse: string | null = null; private footprintHandler: FootprintHandler | null = null;
  private hoverText = ''; private dragInfo = '';
  /** stage 8 */
  private underlayData: { name: string; width: number; height: number; opacity: number; texture: THREE.Texture | null; calib: Calibration | null } | null = null;
  private pickHandler: ((p: Pt2) => void) | null = null; private pickText = ''; private pickLot = false;
  private routePanel: RoutePanel | null = null; private routeAbort: AbortController | null = null; private routeLine: THREE.Line | null = null;
  /** the limits of the last server answer (the same resolved requirements), used by the browser preview */
  private lastRules: Record<string, RuleInfo> | null = null; private lastRulesFor = '';
  /** the object being dragged as the preview shows it, and the signature of the server request made for it */
  private dragPv: SiteObject | null = null; private dragSig = '';

  constructor(private h: DesignHooks) {
    this.store = h.store ?? new SiteDesignStore();
    // the operations validate a crossover against the SAME assumed kerb line the tool slides it along (the kerb of this 3D model, or none)
    this.store.ctx = { ...this.store.ctx, kerb: () => (this.h.kerb ? { a: this.h.kerb.a, u: this.h.kerb.u, length: this.h.kerb.length } : null) };
    this.hf = heightFieldFromMeshes(h.terrainMeshes);
    const O = h.origin;
    this.terrain = { available: h.terrainAvailable && this.hf.triangleCount > 0, sample: (e, n) => this.hf.sample(e - O[0], n - O[1]) };
    this.existingHf = h.existingMeshes?.length ? heightFieldFromMeshes(h.existingMeshes) : null;
    const ex = this.existingHf, existing = ex && ex.triangleCount > 0 ? (e: number, n: number) => ex.sample(e - O[0], n - O[1]) : undefined;
    this.live = new LiveEngine({ ep: h.engine ?? null, debounceMs: h.engineDebounceMs });
    this.live.listener = (kind, id) => this.onLive(kind, id);
    this.checks = new LiveChecks({ ep: h.engine ?? null, debounceMs: h.checksDebounceMs });
    this.checks.listener = (st) => { this.scene.setZones(st.result ? zonesOf(st.result) : {}); this.emit(); };
    this.scene = new SiteScene({ origin: O, terrain: this.terrain, makeLabel: h.makeLabel, existing });
    this.stormwater = new StormwaterSession(h.engine ?? null, () => this.store.doc);
    this.stormwater.listener = (st) => { this.scene.setOverland(st.overland.on && st.result ? st.result.overland : null); this.emit(); };
    this.firstDesign = new FirstDesignSession(h.engine ?? null, () => this.store.doc, this.store, { checks: () => this.checks.state, select: (id) => this.select(id), requestChecks: () => this.requestChecks(true) });
    this.firstDesign.listener = () => this.emit();
    h.built.root.add(this.scene.group, this.handles);
    this.marker = new THREE.Mesh(new THREE.RingGeometry(0.7, 1, 28), new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false, transparent: true, side: THREE.DoubleSide }));
    this.marker.renderOrder = 20; this.marker.visible = false; h.built.root.add(this.marker);
    this.selRing = new THREE.Mesh(new THREE.RingGeometry(0.85, 1, 32), new THREE.MeshBasicMaterial({ color: new THREE.Color(SELECT_COLOUR), depthTest: false, transparent: true, side: THREE.DoubleSide }));
    this.selRing.renderOrder = 20; this.selRing.visible = false; h.built.root.add(this.selRing);
    this.store.setEnv({ lot: h.lot, terrain: this.terrain });
    this.scene.syncAll(this.store.doc);
    this.refreshAll(); this.requestChecks();
    this.off.push(this.store.on('change', (ev) => {
      this.scene.apply(ev); this.afterChange(ev); this.stormwater.documentChanged(); this.firstDesign.documentChanged();
      if (this.selected && !ev.doc.objects.some((o) => o.id === this.selected)) { this.selected = null; this.selVertex = null; }
      if (this.selVertex !== null) { const o = this.selObj(); if (!o || this.selVertex >= verticesOf(o.geometry).length) this.selVertex = null; }
      this.scene.setSelected(this.selected); this.syncHandles(); this.emit();
    }), this.store.on('history', () => this.emit()), this.store.on('lock', () => { if (this.store.locked && this.drag) this.cancelDrag(); this.emit(); }));
    this.emit();
  }

  // ---- state
  private selObj(): SiteObject | null { return this.selected ? this.store.doc.objects.find((o) => o.id === this.selected) ?? null : null; }
  private hint(): string {
    if (this.tool === 'pick') return `${this.pickText} · Esc cancel`;
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
      driveway: this.drivewayPanel(), grading: this.gradingPanel(), hoverText: this.hoverText, dragInfo: this.dragInfo,
      checks: this.checks.state, rwtSize: this.selected ? this.sizing.get(this.selected) ?? null : null,
      underlay: this.underlayInfo(), route: this.routePanel, pickPrompt: this.tool === 'pick' ? this.pickText : null,
      stormwater: this.stormwater.state, firstDesign: this.firstDesign.state,
    };
  }

  // ---- stage 7: server checks and the optional tank sizing -------------------------------------------------------------------------------
  /** Ask the server for the checks of the document as it is now (no request for an empty design: there is nothing to check). */
  requestChecks(force = false) {
    if (!this.store.doc.objects.length) { this.checks.reset(); return; }
    this.checks.request(this.store.doc, { force, debounce: !force });
  }
  /**
   * Run the optional "size this tank" action for a tank. The server runs the SA4 mass balance ONLY when every input resolves (entered on the tank, or a
   * requirement key); otherwise the answer lists what is UNRESOLVED and nothing is sized. The rainfall is entered by the user (no rainfall data source yet).
   */
  async sizeTank(id: string, input: { rainfall: number[] | null; station: string; candidates?: number[] | null; gardenFactor?: number[] | null }) {
    const o = this.store.doc.objects.find((x) => x.id === id);
    if (!o || o.type !== 'rwt') return;
    const ep = this.h.engine ?? null;
    if (!ep) { this.sizing.set(id, { id, status: 'error', error: 'NO SERVER: THIS VIEW HAS NO CONNECTION TO THE ENGINES', result: null }); this.emit(); return; }
    this.sizeAbort?.abort(); const ac = this.sizeAbort = new AbortController();
    this.sizing.set(id, { id, status: 'pending', error: '', result: this.sizing.get(id)?.result ?? null }); this.emit();
    const linkId = o.params.roof_building_id?.value, building = typeof linkId === 'string' ? this.store.doc.objects.find((x) => x.id === linkId && x.type === 'building') ?? null : null;
    try {
      const res = await postRwtSize(ep, { rwt: o, building, rainfall_monthly_mm: input.rainfall, rainfall_station: input.station, candidate_sizes_l: input.candidates ?? null, garden_monthly_factor: input.gardenFactor ?? null }, ac.signal);
      if (ac.signal.aborted) return;
      this.sizing.set(id, { id, status: 'ok', error: '', result: res });
    } catch (err) {
      if ((err as { name?: string })?.name === 'AbortError') return;
      this.sizing.set(id, { id, status: 'error', error: err instanceof EngineHttpError ? err.message : String(err), result: null });
    }
    this.emit();
  }

  // ---- stage 6: engine results for driveways and grading areas -------------------------------------------------------------------------
  private drivewayPanel(): DrivewayPanel | null {
    const o = this.selObj(); if (!o || o.type !== 'driveway') return null;
    const doc = this.store.doc, eff = effectiveDriveway(doc, o), e = this.live.drive.get(o.id), view = this.scene.driveView(o.id);
    const fresh = !!e && !!e.result && e.resultSig === objectSig(eff) && e.resultDetail === 'full' && !view?.preview;
    return { id: o.id, view, status: e?.status ?? 'idle', error: e?.error ?? '', stale: !fresh, gaps: drivewayGaps(doc, o), kerbAvailable: !!this.h.kerb, linkedBuilding: linkedBuilding(doc, o)?.id ?? null };
  }
  private gradingPanel(): GradingPanel | null {
    const o = this.selObj(); if (!o || o.type !== 'grading_area') return null;
    const e = this.live.grade.get(o.id), fresh = !!e && !!e.result && e.resultSig === objectSig(o);
    return { id: o.id, result: this.scene.gradingResult(o.id), status: e?.status ?? 'idle', error: e?.error ?? '', stale: !fresh };
  }
  /** The browser PREVIEW long section of a driveway as the engine would see it (end level from a linked building), or null without existing ground. */
  previewView(eff: SiteObject): ProfileView | null {
    const hf = this.existingHf, O = this.h.origin;
    if (!hf || !hf.triangleCount || eff.geometry.kind !== 'polyline') return null;
    const ev = levelOf(eff, 'end_level_rl'), lv = eff.params.end_level_rl;
    return previewProfile({
      pts: eff.geometry.pts, width: dimOf(eff, 'width_m'), endLevel: ev, endLevelBasis: ev === null || !lv ? 'NOT SET' : lv.basis.toUpperCase().replace(/_/g, ' '),
      existing: (e, n) => hf.sample(e - O[0], n - O[1]), lot: this.h.lot, kerb: this.h.kerb ?? null, rules: this.lastRules, rulesFor: this.lastRulesFor || undefined,
      terrainStatus: this.h.terrainStatus ?? 'TERRAIN STATUS NOT STATED', objectId: eff.id,
    });
  }
  /** Put the best known result on show for an object: the server answer for exactly this object, else (driveway) the browser preview, else none. */
  private settle(id: string) {
    const doc = this.store.doc, o = doc.objects.find((x) => x.id === id); if (!o) return;
    if (o.type === 'driveway') {
      const eff = effectiveDriveway(doc, o), e = this.live.drive.get(id);
      // a 'profile' answer (made while dragging) has no earthworks: it stays a PREVIEW until the 'full' answer for the same object arrives
      const mine = e?.result && e.resultSig === objectSig(eff) ? e : null;
      this.scene.setDriveView(id, mine ? (mine.resultDetail === 'full' ? mine.result : { ...mine.result!, preview: true }) : this.previewView(eff));
    } else if (o.type === 'grading_area') {
      const e = this.live.grade.get(id);
      this.scene.setGradingResult(id, e?.result && e.resultSig === objectSig(o) ? e.result : null);
    }
  }
  private refresh(o: SiteObject) {
    if (o.type === 'driveway') {
      const eff = effectiveDriveway(this.store.doc, o), e = this.live.drive.get(o.id);
      this.settle(o.id);
      if (!(e && e.sig === objectSig(eff) && e.detail === 'full' && (e.status === 'ok' || e.status === 'pending'))) this.live.requestDrive(eff, { detail: 'full', building: linkedBuilding(this.store.doc, o) });
    } else if (o.type === 'grading_area') {
      const e = this.live.grade.get(o.id);
      this.settle(o.id);
      if (!(e && e.sig === objectSig(o) && (e.status === 'ok' || e.status === 'pending'))) this.live.requestGrade(o);
    }
  }
  private refreshAll() { for (const o of this.store.doc.objects) this.refresh(o); }
  private afterChange(ev: { kind: string; doc: SiteDesign; changed: string[]; added: string[]; removed: string[] }) {
    if (ev.kind !== 'saved' && ev.kind !== 'checks') this.requestChecks();       // 'checks' only changed derived issues; 'saved' only the version
    for (const id of ev.removed) this.sizing.delete(id);
    if (ev.kind === 'saved') {
      // the server resolves a building link from the SAVED design: an answer that said the linked building was not saved yet is asked for again now it is
      for (const o of ev.doc.objects) {
        const e = this.live.drive.get(o.id);
        if (o.type === 'driveway' && typeof o.params.end_building_id?.value === 'string' && e?.status === 'ok' && e.result?.end_level.link_note) {
          this.live.requestDrive(effectiveDriveway(ev.doc, o), { detail: 'full', building: linkedBuilding(ev.doc, o) });
        }
      }
      return;
    }
    for (const id of ev.removed) this.live.clear(id);
    const touched = new Set([...ev.changed, ...ev.added]);
    for (const o of ev.doc.objects) {
      const link = o.type === 'driveway' ? o.params.end_building_id?.value : null;
      if (ev.kind === 'replace' || touched.has(o.id) || (typeof link === 'string' && touched.has(link))) this.refresh(o);
    }
    this.emit();
  }
  private onLive(kind: 'drive' | 'grade', id: string) {
    if (kind === 'drive') {
      const e = this.live.drive.get(id);
      if (e?.status === 'ok' && e.result) { this.lastRules = e.result.rules; this.lastRulesFor = e.result.rules_for; }
      const dragging = this.drag && 'id' in this.drag && this.drag.id === id && this.drag.moved;
      if (dragging) {
        // an answer for the position being dragged (detail 'profile'): shown as a PREVIEW; an answer for an older position is ignored
        if (e?.status === 'ok' && e.result && e.resultSig === this.dragSig && this.dragPv) this.scene.preview(this.dragPv, { drive: { ...e.result, preview: true } });
      } else this.settle(id);
    } else this.settle(id);
    this.emit();
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
  setTool(mode: ToolMode, type: ObjectType | null = null, shape: GeometryKind | null = null) {
    if (mode !== 'select' && this.store.locked) { this.cancelAll(); this.tool = 'select'; this.type = null; this.syncHandles(); this.say(this.store.locked); return; }       // read only: no drawing or placing tools
    this.cancelAll(); this.tool = mode; this.type = mode === 'select' ? null : type; this.message = '';
    if (this.type && mode !== 'select' && (shape ?? OBJECT_KINDS[this.type].geometry) === 'point' !== (mode === 'place')) { this.tool = 'select'; this.type = null; }   // place for points, draw for lines and areas
    if (this.tool === 'place' && this.type) this.makeGhost(this.type);
    this.syncHandles(); this.emit();
  }
  /** Start the right tool for an object type. */
  startFor(type: ObjectType, opts: { shape?: 'polyline' | 'polygon' | 'point'; params?: ServiceFields; label?: string } = {}) {
    const geometry = opts.shape ?? OBJECT_KINDS[type].geometry;
    this.setTool(geometry === 'point' ? 'place' : 'draw', type, opts.shape ?? null);
    if (this.type === type) { this.shape = opts.shape && opts.shape !== OBJECT_KINDS[type].geometry ? opts.shape : null; this.preset = opts.params || opts.label ? { params: opts.params, label: opts.label } : null; this.emit(); }
  }
  /** Geometry kind being drawn: the type's own, or the area shape of a footpath. */
  private drawKind(): GeometryKind | null { return this.type ? this.shape ?? OBJECT_KINDS[this.type].geometry : null; }
  /** Choose the catalogue item for the next outdoor furniture placed (null clears it). */
  setFurnitureItem(c: FurnitureChoice | null) { this.furniture = c; this.emit(); }

  // ---- buildings (imported, never designed here)
  /** Parse a Plan Studio GLB (metres, Y up) into an object that can be shown as the building visual. */
  loadGlb(buf: ArrayBuffer): Promise<THREE.Object3D> {
    return new Promise((resolve, reject) => new GLTFLoader().parse(buf, '', (g) => { this.glbSource.set(g.scene, buf); resolve(g.scene); }, (e) => reject(new Error(`THE GLB COULD NOT BE READ: ${e instanceof Error ? e.message : String(e)}`))));
  }
  /** Show a loaded GLB for an existing building (also used to attach it again after a reload; the bytes are not saved in the design). */
  attachGlb(id: string, obj: THREE.Object3D) { this.scene.setGlb(id, obj); this.rememberGlb(id, obj); this.emit(); }

  // ---- stage 11: the GLB bytes of a building go to the server when an export is asked for, so the exported GLB holds the building. The bytes are not part of the design document.
  private glbSource = new WeakMap<THREE.Object3D, ArrayBuffer>();
  private glbById = new Map<string, ArrayBuffer>();
  private glbSent = new Map<string, ArrayBuffer>();
  private rememberGlb(id: string, obj: THREE.Object3D) { const b = this.glbSource.get(obj); if (b) this.glbById.set(id, b); }
  /** Building ids whose GLB has been loaded in this session and not yet sent to the server (or was replaced). */
  glbUnsent(): string[] { return [...this.glbById].filter(([id, b]) => this.glbSent.get(id) !== b && this.store.doc.objects.some((o) => o.id === id && o.type === 'building')).map(([id]) => id); }
  /** Send the unsent GLBs. The design must have been saved first. Returns the ids sent; stops with the error of the first one that fails. */
  async sendGlbs(send: (id: string, bytes: ArrayBuffer) => Promise<void>): Promise<string[]> {
    const done: string[] = [];
    for (const id of this.glbUnsent()) { const b = this.glbById.get(id)!; await send(id, b); this.glbSent.set(id, b); done.push(id); }
    return done;
  }
  /**
   * The imported footprint follows the cursor on the terrain until it is clicked. R, Q and E turn it.
   * A PDF import that SA7 aligned to the lot (`aligned_at`) is not placed by the cursor: the footprint already is in MGA orientation (yaw 0) and
   * `aligned_at` is the MGA position of its reference point, so it is placed there at once, labelled PLACED BY PDF ALIGNMENT, CHECK. It stays
   * an ordinary building: select it and drag or turn it as usual.
   */
  beginBuildingPlacement(payload: ImportPayload, glb: { object: THREE.Object3D; name: string } | null = null) {
    if (this.store.locked) { this.cancelAll(); this.tool = 'select'; this.type = null; this.say(this.store.locked); return; }
    if (payload.aligned_at) {
      this.cancelAll(); this.tool = 'select'; this.type = null; this.syncHandles();
      this.placeBuildingAt(payload, payload.aligned_at, 0, glb, ALIGNED_LABEL);
      return;
    }
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
  placeBuildingAt(payload: ImportPayload, at: Pt2, yaw = 0, glb: { object: THREE.Object3D; name: string } | null = null, label?: string): string | null {
    try {
      const r = this.store.run('place_building', { payload, import_id: payload.import_id, at: { e: at[0], n: at[1] }, yaw_deg: yaw, status: this.newStatus, ...(glb ? { glb_name: glb.name } : {}), ...(label ? { label } : {}) }, 'Place building');
      const id = r.id as string; if (glb) { this.scene.setGlb(id, glb.object); this.rememberGlb(id, glb.object); }
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
    this.ghostAt = null; this.marker.visible = false; this.snapLabel = ''; this.pickHandler = null;
    this.pendingAt = null; this.footprintUse = null; this.footprintHandler = null; this.shape = null; this.preset = null;
    if (this.pending?.glb) disposeObject(this.pending.glb.object);
    this.pending = null;
  }
  private cancelDrag() {
    const d = this.drag; this.drag = null; this.h.setOrbit(true);
    if (d) this.restoreAfterDrag(d.id, undefined, false);
  }
  /** Put an object back as the document has it (a drag that ended without a change, was refused or was cancelled), with its own results. */
  private restoreAfterDrag(id: string, error?: string, emit = true) {
    this.dragInfo = ''; this.dragPv = null; this.dragSig = '';
    this.scene.restore(id); this.settle(id); this.syncHandles();
    if (error !== undefined) this.say(error); else if (emit) this.emit();
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
  private pickHandle(ray: THREE.Ray): { kind: 'vertex' | 'mid' | 'width'; index: number } | null {
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
    if (o.type === 'driveway' && o.geometry.kind === 'polyline') this.addWidthHandles(o, at);
  }
  /**
   * Width grips of a driveway: one either side of the centreline at half the width when the width is set; a single grip ON the centreline when it is
   * NOT SET (no width is implied: dragging it sideways sets the width to twice the distance). Placed at the property boundary, else mid length.
   */
  private widthFrame(o: SiteObject): { p: Pt2; n: Pt2 } | null {
    if (o.geometry.kind !== 'polyline') return null;
    const pts = o.geometry.pts, cum = polylineChainages(pts), L = cum[cum.length - 1];
    if (!(L > 0)) return null;
    const bc = this.scene.driveView(o.id)?.geometry?.boundary_chainage_m ?? L / 2, edge = Math.min(1, L / 4), t = Math.min(Math.max(bc, edge), L - edge);
    const p = pointAtChainage(pts, cum, t), a = pointAtChainage(pts, cum, t - 0.2), b = pointAtChainage(pts, cum, t + 0.2);
    let dx = b[0] - a[0], dy = b[1] - a[1]; const n = Math.hypot(dx, dy) || 1; dx /= n; dy /= n;
    return { p, n: [-dy, dx] };
  }
  private addWidthHandles(o: SiteObject, at: (p: readonly number[]) => THREE.Vector3) {
    const f = this.widthFrame(o); if (!f) return;
    const w = dimOf(o, 'width_m'), sides = w === null ? [0] : [1, -1];
    for (const sd of sides) {
      const q: Pos = [f.p[0] + f.n[0] * sd * (w ?? 0) / 2, f.p[1] + f.n[1] * sd * (w ?? 0) / 2];
      const m = new THREE.Mesh(new THREE.BoxGeometry(1.5, 1.5, 1.5), new THREE.MeshBasicMaterial({ color: 0x00c2a8, depthTest: false, transparent: true }));
      m.position.copy(at(q)); m.renderOrder = 31; m.userData = { handle: 'width', index: sd }; this.handles.add(m);
    }
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
    if (this.tool === 'select') this.hoverFailing(info);
    if (this.tool === 'place' && this.pending && this.ghost) {
      const a = this.aim(info, null);
      if (!a) { this.ghost.visible = false; this.pendingAt = null; this.showSnap(null, null); this.emit(); return; }
      this.updateBuildingGhost(a.mga); this.showSnap(a.local, a.snap); this.emit();
    } else if (this.tool === 'place' && this.ghost) {
      const a = this.aim(info, null);
      if (!a) { this.ghost.visible = false; this.ghostAt = null; this.showSnap(null, null); this.emit(); return; }
      this.ghost.position.copy(a.local); this.ghost.rotation.z = -(this.yaw * Math.PI) / 180; this.ghost.visible = true; this.ghostAt = { local: a.local };
      this.showSnap(a.local, a.snap); this.cursor = [a.mga[0], a.mga[1]]; this.emit();
    } else if (this.tool === 'pick') {
      const a = this.aim(info, null);
      if (!a) { this.showSnap(null, null); this.emit(); return; }
      this.showSnap(a.local, a.snap); this.emit();
    } else if (this.tool === 'draw') {
      const a = this.aim(info, null);
      if (!a) { this.cursor = null; this.showSnap(null, null); this.updatePreview(); this.emit(); return; }
      this.cursor = this.drawPoint(a.mga); this.showSnap(a.local, a.snap); this.updatePreview(); this.emit();
    }
  }
  /** Red failing chainages: the hover text is the requirement key, its limit and the value. */
  private hoverFailing(info: PointerInfo) {
    let txt = '';
    if (this.designVisible()) {
      this.rc.set(info.ray.origin, info.ray.direction); this.rc.far = 5000;
      const hit = this.rc.intersectObjects(this.scene.failingPickables(), false)[0];
      if (hit) txt = String(hit.object.userData.failing);
    }
    if (txt !== this.hoverText) { this.hoverText = txt; this.emit(); }
  }
  /** The first point of a driveway is the crossover and lies on the assumed kerb line (when the 3D model has one). */
  private drawPoint(mga: Pt2): Pos {
    if (this.type === 'driveway' && !this.verts.length && this.h.kerb) { const p = projectToKerb(this.h.kerb, mga).p; return [p[0], p[1]]; }
    return [mga[0], mga[1]];
  }
  /** Returns true when a drag has begun (the engine then disables orbiting). */
  pointerDown(info: PointerInfo): boolean {
    this.downPx = [info.x, info.y];
    if (!this.active || this.tool !== 'select' || info.button !== 0) return false;
    const hh = this.pickHandle(info.ray), ro = this.store.locked !== null;       // read only: selecting still works, dragging does not
    if (hh && hh.kind === 'width' && this.selected && !ro) {
      this.drag = { kind: 'width', id: this.selected, px: [info.x, info.y], moved: false, width: null };
      this.h.setOrbit(false); return true;
    }
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
  /** The building whose footprint contains an MGA point (a driveway end dropped on it links to the building's FFL), or null. */
  private buildingAt(p: readonly number[], exclude?: string): SiteObject | null {
    return this.store.doc.objects.find((b) => b.type === 'building' && b.id !== exclude && b.accepted !== 'rejected' && b.geometry.kind === 'polygon' && pointInRing(p, b.geometry.ring)) ?? null;
  }
  private dragMove(info: PointerInfo) {
    const d = this.drag!; if (!d.moved && Math.hypot(info.x - d.px[0], info.y - d.px[1]) <= DRAG_PX) return;
    d.moved = true;
    const o = this.store.doc.objects.find((x) => x.id === d.id); if (!o) return;
    const t = this.hitTerrain(info.ray); if (!t) return;
    const O = this.h.origin, cur: Pt2 = [t.local.x + O[0], t.local.y + O[1]];
    if (d.kind === 'width') {
      const f = this.widthFrame(o); if (!f) return;
      const dist = Math.abs((cur[0] - f.p[0]) * f.n[0] + (cur[1] - f.p[1]) * f.n[1]), step = info.alt ? 0.01 : 0.05;
      d.width = Math.max(0.1, Math.round((2 * dist) / step) * step);
      this.dragInfo = `WIDTH ${d.width.toFixed(2)} M`; this.marker.visible = false;
      this.previewObject(o, (ps) => ps, (pv) => ({ ...pv, params: { ...pv.params, width_m: { value: d.width, basis: 'user' } } }));
    } else if (d.kind === 'vertex') {
      const drive = o.type === 'driveway' && !d.insert, n = verticesOf(o.geometry).length, kerb = this.h.kerb ?? null;
      let s = this.snapMga(cur, info.alt, t.world, d.id), pos: Pt2 = s.p, mod: ((pv: SiteObject) => SiteObject) | undefined;
      this.dragInfo = '';
      if (drive && d.index === 0 && kerb) {                                          // the crossover slides along the assumed kerb line only
        const pr = projectToKerb(kerb, cur), ch = Math.round(pr.chainage * 100) / 100;
        pos = pr.clamped ? pr.p : [kerb.a[0] + kerb.u[0] * ch, kerb.a[1] + kerb.u[1] * ch];
        s = { p: pos, kind: 'none', label: '' };
        d.translate = info.shift;
        this.dragInfo = `CROSSOVER ${ch.toFixed(2)} M ALONG THE ASSUMED KERB LINE${d.translate ? ' · WHOLE DRIVEWAY MOVES' : ''}${pr.clamped ? ' · END OF THE KERB LINE' : ''}`;
      } else if (drive && d.index === 0) this.dragInfo = 'ASSUMED KERB LINE NOT AVAILABLE: THE CROSSOVER IS NOT CONSTRAINED';
      if (drive && n >= 2 && d.index === n - 1) {                                    // the garage end snaps to a placed building and takes its FFL
        const b = this.buildingAt(pos, o.id); d.link = b ? b.id : null;
        mod = (pv) => {
          const params = { ...pv.params };
          if (b) params.end_building_id = { value: b.id, basis: 'user', ref: 'END SNAPPED TO THE BUILDING; END LEVEL IS ITS FFL' }; else delete params.end_building_id;
          return { ...pv, params };
        };
        this.dragInfo = b ? `END SNAPS TO ${b.label ? b.label.toUpperCase() : b.id.toUpperCase()}: END LEVEL IS ITS FFL${levelOf(b, 'ffl_rl') === null ? ' (FFL NOT SET)' : ''}` : '';
      }
      const z = d.insert ? undefined : verticesOf(o.geometry)[d.index]?.[2];                  // moving a vertex keeps an RL it already had
      d.pos = z === undefined ? [pos[0], pos[1]] : [pos[0], pos[1], z]; this.showSnap(new THREE.Vector3(pos[0] - O[0], pos[1] - O[1], this.hf.sample(pos[0] - O[0], pos[1] - O[1]) ?? t.local.z), s);
      const dx = d.translate && d.index === 0 ? pos[0] - verticesOf(o.geometry)[0][0] : 0, dy = d.translate && d.index === 0 ? pos[1] - verticesOf(o.geometry)[0][1] : 0;
      this.previewObject(o, (ps) => (d.translate && d.index === 0 ? ps.map((p) => (p.length === 3 ? [p[0] + dx, p[1] + dy, p[2]] : [p[0] + dx, p[1] + dy]) as Pos)
        : d.insert ? [...ps.slice(0, d.index), d.pos!, ...ps.slice(d.index)] : ps.map((p, i) => (i === d.index ? d.pos! : p))), mod);
    } else {
      const want: Pt2 = [d.anchor[0] + (cur[0] - d.grab[0]), d.anchor[1] + (cur[1] - d.grab[1])];
      const s = this.snapMga(want, info.alt, t.world, d.id);
      d.delta = [s.p[0] - d.anchor[0], s.p[1] - d.anchor[1]]; this.showSnap(null, s);
      this.previewObject(o, (ps) => ps.map((p) => (p.length === 3 ? [p[0] + d.delta[0], p[1] + d.delta[1], p[2]] : [p[0] + d.delta[0], p[1] + d.delta[1]]) as Pos));
    }
    this.emit();
  }
  private previewObject(o: SiteObject, f: (ps: Pos[]) => Pos[], mod?: (pv: SiteObject) => SiteObject) {
    const ps = f(verticesOf(o.geometry) as Pos[]), g = o.geometry;
    const geometry = g.kind === 'point' ? { ...g, p: ps[0] } : g.kind === 'polyline' ? { kind: 'polyline' as const, pts: ps } : { kind: 'polygon' as const, ring: ps };
    let pv: SiteObject = { ...o, geometry, ...(o.building ? { building: { ...mapBuildingPositions(o.building, (p) => f([p])[0]), frame: { ...o.building.frame, origin: [f([o.building.frame.origin])[0][0], f([o.building.frame.origin])[0][1]] as [number, number] } } } : {}) };
    if (mod) pv = mod(pv);
    if (o.type === 'driveway') {
      // a driveway previews its long section too: the browser PREVIEW now, and the server answer (detail 'profile') once the pointer pauses
      const eff = effectiveDriveway(this.store.doc, pv);
      this.dragPv = pv; this.dragSig = objectSig(eff);
      this.live.requestDrive(eff, { detail: 'profile', building: linkedBuilding(this.store.doc, pv) });
      this.scene.preview(pv, { drive: this.previewView(eff) });
    } else this.scene.preview(pv);
    this.syncHandles(pv);
    if (g.kind !== 'point') this.listener({ ...this.state(), readout: readoutFor(g.kind, ps, this.terrain.sample, true, this.terrain.available) });
  }
  pointerUp(info: PointerInfo, moved: boolean) {
    if (!this.active) return;
    const wasDrag = this.drag; this.downPx = null;
    if (wasDrag) {
      this.drag = null; this.h.setOrbit(true); this.marker.visible = false; this.snapLabel = ''; this.dragInfo = ''; this.dragPv = null; this.dragSig = '';
      try {
        if (wasDrag.kind === 'width') {
          if (wasDrag.moved && wasDrag.width !== null) this.store.run('set_param', { id: wasDrag.id, key: 'width_m', value: wasDrag.width, basis: 'user' }, 'Set driveway width');
          else { this.restoreAfterDrag(wasDrag.id); return; }
        } else if (wasDrag.kind === 'vertex') {
          if (wasDrag.moved && wasDrag.pos) {
            const o = this.store.doc.objects.find((x) => x.id === wasDrag.id), n = o ? verticesOf(o.geometry).length : 0;
            const pt = { e: wasDrag.pos[0], n: wasDrag.pos[1], ...(wasDrag.pos.length === 3 ? { z: wasDrag.pos[2] } : {}) };
            if (o?.type === 'driveway' && !wasDrag.insert && wasDrag.index === 0 && this.h.kerb) {
              this.store.run('set_driveway_crossover', { id: wasDrag.id, point: pt, translate: !!wasDrag.translate }, 'Move crossover');
            } else if (o?.type === 'driveway' && !wasDrag.insert && n >= 2 && wasDrag.index === n - 1) {
              // the end moves and the link to the building follows where it was dropped: ONE undo step
              // ALL OR NOTHING: if either step fails the whole batch is rolled back (the end does not move without its link), and the error is shown
              const res = this.store.runBatch('Move driveway end', [
                { op: 'edit_vertices', args: { id: wasDrag.id, action: 'move', index: wasDrag.index, point: pt } },
                { op: 'link_driveway_end', args: { id: wasDrag.id, building_id: wasDrag.link ?? null } },
              ], { atomic: true });
              const bad = res.find((x) => !x.ok); if (bad && !bad.ok) throw new OpError(bad.error);
            } else this.store.run('edit_vertices', { id: wasDrag.id, action: wasDrag.insert ? 'insert' : 'move', index: wasDrag.index, point: pt }, wasDrag.insert ? 'Insert vertex' : 'Move vertex');
          } else if (wasDrag.insert) {
            const o = this.selObj(); if (o) { const ps = verticesOf(o.geometry), a = ps[(wasDrag.index - 1 + ps.length) % ps.length], b = ps[wasDrag.index % ps.length]; this.store.run('edit_vertices', { id: wasDrag.id, action: 'insert', index: wasDrag.index, point: { e: (a[0] + b[0]) / 2, n: (a[1] + b[1]) / 2 } }, 'Insert vertex'); }
          } else { this.selVertex = this.selVertex === wasDrag.index ? null : wasDrag.index; this.restoreAfterDrag(wasDrag.id); return; }
        } else if (wasDrag.moved && (wasDrag.delta[0] !== 0 || wasDrag.delta[1] !== 0)) {
          this.store.run('move_object', { id: wasDrag.id, dx: wasDrag.delta[0], dy: wasDrag.delta[1] }, 'Move object');
        } else { this.restoreAfterDrag(wasDrag.id); return; }
        this.message = '';
      } catch (e) {
        this.restoreAfterDrag(wasDrag.id, e instanceof OpError ? e.message : String(e)); return;
      }
      return;
    }
    if (moved || info.button === 1) return;
    if (info.button === 2) { if (this.tool !== 'select') { if (this.verts.length) { this.verts = []; this.updatePreview(); this.emit(); } else this.setTool('select'); } return; }
    if (info.button !== 0) return;
    if (this.tool === 'pick') this.pickAt(info);
    else if (this.tool === 'place' && this.type) this.placeAt(info);
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
        const r = this.store.run('place_building', { payload: pb.payload, import_id: pb.payload.import_id, at: { e: a.mga[0], n: a.mga[1] }, yaw_deg: this.yaw, status: this.newStatus, ...(pb.glb ? { glb_name: pb.glb.name } : {}) }, 'Place building');
        const id = r.id as string;
        if (pb.glb) { this.scene.setGlb(id, pb.glb.object); this.rememberGlb(id, pb.glb.object); this.pending = { ...pb, glb: null }; }          // the scene owns the GLB now
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
      const r = this.store.run('add_object', {
        type: this.type, points: [{ e: a.mga[0], n: a.mga[1] }], status: this.newStatus, ...(this.shape === 'point' ? { shape: 'point' } : {}), ...(this.type === 'service_existing' || this.type === 'service_node' ? {} : { yaw_deg: this.yaw }),
        ...(this.preset?.params ? { params: this.preset.params } : {}), ...(this.preset?.label ? { label: this.preset.label } : {}),
      }, `Place ${(this.preset?.label ?? OBJECT_KINDS[this.type].label).toLowerCase()}`);
      this.selected = r.id as string; this.scene.setSelected(this.selected); this.message = '';
    } catch (e) { this.message = e instanceof OpError ? e.message : String(e); }
    this.emit();
  }
  private addVertex(info: PointerInfo) {
    const a = this.aim(info, null); if (!a || !this.type) return;
    const last = this.verts[this.verts.length - 1], p: Pos = this.drawPoint(a.mga);
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

  // ---- stage 8: point pick, plan underlay, route proposals, DBYD drafts ------------------------------------------------------------------
  /** The server endpoint of this view (the engines and the DBYD routes), or null on a page with no server. */
  get endpoint(): Endpoint | null { return this.h.engine ?? null; }
  /** The corners of the lot boundary (MGA), without the closing repeat; empty when the model has no lot. */
  lotCorners(): Pt2[] {
    const l = this.h.lot ? this.h.lot.map((p) => [p[0], p[1]] as Pt2) : [];
    return l.length > 1 && samePt(l[0], l[l.length - 1]) ? l.slice(0, -1) : l;
  }
  /** Ask for one click in the model: `handler` receives the snapped MGA point. With `lotCorner` only a click near a lot corner is accepted and the corner itself is returned. Changes nothing in the design. */
  pickPoint(prompt: string, handler: (p: Pt2) => void, opts: { lotCorner?: boolean } = {}) {
    this.cancelAll(); this.tool = 'pick'; this.type = null; this.message = ''; this.pickHandler = handler; this.pickText = prompt; this.pickLot = !!opts.lotCorner;
    this.syncHandles(); this.emit();
  }
  private pickAt(info: PointerInfo) {
    const a = this.aim(info, null), h = this.pickHandler; if (!a || !h) return;
    let p: Pt2 = a.mga;
    if (this.pickLot) {
      const corners = this.lotCorners(), hit = this.hitTerrain(info.ray);
      const tol = SNAP_PIXELS * 2 * this.h.mpp(hit ? hit.world : new THREE.Vector3());
      let best = Infinity, at: Pt2 | null = null;
      for (const c of corners) { const d = dist2(c, a.mga); if (d < best) { best = d; at = c; } }
      if (!at || best > tol) { this.say(corners.length ? 'CLICK NEARER A LOT CORNER' : 'THIS MODEL HAS NO LOT BOUNDARY: ENTER THE POINT AS E AND N'); return; }
      p = at;
    }
    this.pickHandler = null; this.setTool('select'); h([p[0], p[1]]);
  }

  private underlayInfo(): UnderlayInfo | null {
    const u = this.underlayData; if (!u) return null;
    return { name: u.name, width: u.width, height: u.height, opacity: u.opacity, calibrated: u.calib !== null, label: u.calib ? calibrationLabel(u.calib) : 'NOT CALIBRATED: THE PLAN IS NOT SHOWN IN THE MODEL' };
  }
  underlayCalibration(): Calibration | null { return this.underlayData?.calib ?? null; }
  /** Load a plan page image as the underlay (replaces any earlier one). It is not shown in the model until it is calibrated. Returns an error text or null. */
  loadUnderlay(src: { name: string; width: number; height: number; texture: THREE.Texture | null }): string | null {
    if (!(src.width > 0 && src.height > 0) || src.width > MAX_UNDERLAY_PX || src.height > MAX_UNDERLAY_PX) return `THE PLAN IMAGE MUST BE BETWEEN 1 AND ${MAX_UNDERLAY_PX} PIXELS ON EACH SIDE`;
    this.clearUnderlay(false);
    this.underlayData = { name: src.name.slice(0, 200), width: src.width, height: src.height, opacity: 0.6, texture: src.texture, calib: null };
    this.emit(); return null;
  }
  /** Place the loaded plan from two image points (pixels) and the two model points (MGA) they stand for. Returns an error text or null. */
  calibrateUnderlay(img: readonly [Pt2, Pt2], mga: readonly [Pt2, Pt2]): string | null {
    const u = this.underlayData; if (!u) return 'LOAD A PLAN IMAGE FIRST';
    try { u.calib = calibrate(img, mga); } catch (e) { if (e instanceof CalibrationError) return e.message; throw e; }
    this.scene.setUnderlay({ texture: u.texture, width: u.width, height: u.height, calibration: u.calib, opacity: u.opacity });
    this.emit(); return null;
  }
  setUnderlayOpacity(v: number) { const u = this.underlayData; if (!u) return; u.opacity = clampOpacity(v); this.scene.setUnderlayOpacity(u.opacity); this.emit(); }
  clearUnderlay(emit = true) {
    this.scene.setUnderlay(null);
    this.underlayData?.texture?.dispose();
    this.underlayData = null;
    if (emit) this.emit();
  }
  /** Start drawing an existing service (a traced line, or a point for a pit, valve or pole) with the fields the user entered. Every field is the user's entry; nothing is defaulted. */
  traceService(fields: ServiceFields, opts: { point?: boolean; label?: string } = {}) {
    this.startFor('service_existing', { shape: opts.point ? 'point' : 'polyline', params: fields, label: opts.label });
  }

  /** Ask the server for a sewer drain route. Nothing is added until `applyRoute`. */
  proposeSewer(input: Omit<SewerRouteRequest, 'design'>) { return this.propose('sewer', (ep, sig) => postSewerRoute(ep, { ...input, design: this.store.doc }, sig)); }
  proposeWater(input: Omit<WaterRouteRequest, 'design'>) { return this.propose('water', (ep, sig) => postWaterRoute(ep, { ...input, design: this.store.doc }, sig)); }
  private async propose(kind: 'sewer' | 'water', call: (ep: Endpoint, sig: AbortSignal) => Promise<RouteProposal>) {
    this.clearRoute(false);
    const ep = this.h.engine ?? null;
    if (!ep) { this.routePanel = { kind, status: 'error', error: 'NO SERVER: THIS VIEW HAS NO CONNECTION TO THE ENGINES', result: null, applied: false }; this.emit(); return; }
    const ac = this.routeAbort = new AbortController();
    this.routePanel = { kind, status: 'pending', error: '', result: null, applied: false }; this.emit();
    try {
      const res = await call(ep, ac.signal);
      if (ac.signal.aborted) return;
      this.routePanel = { kind, status: 'ok', error: '', result: res, applied: false };
      this.showRoute(res.route.pts);
    } catch (err) {
      if ((err as { name?: string })?.name === 'AbortError') return;
      this.routePanel = { kind, status: 'error', error: err instanceof EngineHttpError ? err.message : String(err), result: null, applied: false };
    }
    this.emit();
  }
  private showRoute(pts: readonly (readonly number[])[]) {
    this.removeRouteLine();
    const O = this.h.origin, d = drapePolyline(pts as Pos[], this.terrain.sample, 1, false);
    let last = d.map((x) => x.p[2]).find((z): z is number => z !== null) ?? 0;
    const v = d.map((x) => { if (x.p[2] !== null) last = x.p[2]; return new THREE.Vector3(x.p[0] - O[0], x.p[1] - O[1], last + 0.1); });
    if (v.length < 2) return;
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(v), new THREE.LineBasicMaterial({ color: 0xffffff, depthTest: false }));
    line.renderOrder = 16; this.routeLine = line; this.h.built.root.add(line);
  }
  private removeRouteLine() { if (this.routeLine) { this.h.built.root.remove(this.routeLine); this.routeLine.geometry.dispose(); (this.routeLine.material as THREE.Material).dispose(); this.routeLine = null; } }
  /** Add the objects of the proposal to the design: ONE undo step. An id that is no longer free (the design changed) refuses the whole step. */
  applyRoute(): string | null {
    const r = this.routePanel;
    if (!r || r.status !== 'ok' || !r.result || r.applied) return 'THERE IS NO PROPOSAL TO APPLY';
    try {
      const out = this.store.run('add_service_objects', { objects: r.result.objects }, r.kind === 'sewer' ? 'Add sewer route' : 'Add water service');
      this.routePanel = { ...r, applied: true }; this.removeRouteLine();
      const first = (out.ids as string[])[0]; if (first) this.select(first);
      this.requestChecks(true); this.emit(); return null;
    } catch (e) { const m = e instanceof OpError ? e.message : String(e); this.say(m); return m; }
  }
  clearRoute(emit = true) { this.routeAbort?.abort(); this.routeAbort = null; this.routePanel = null; this.removeRouteLine(); if (emit) this.emit(); }
  /** Add the draft services read from a DBYD plan (origin dbyd, UNVERIFIED): ONE undo step. */
  addDbydDrafts(objects: SiteObject[]): string | null {
    try { this.store.run('add_service_objects', { objects }, 'Add DBYD services'); this.message = ''; this.requestChecks(true); this.emit(); return null; }
    catch (e) { const m = e instanceof OpError ? e.message : String(e); this.say(m); return m; }
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
    this.cancelAll(); this.live.dispose(); this.checks.dispose(); this.stormwater.dispose(); this.firstDesign.dispose(); this.sizeAbort?.abort(); this.clearRoute(false); this.clearUnderlay(false); this.off.forEach((f) => f()); this.off = [];
    this.h.built.root.remove(this.scene.group, this.handles, this.marker, this.selRing); this.scene.dispose();
    this.marker.geometry.dispose(); (this.marker.material as THREE.Material).dispose(); this.selRing.geometry.dispose(); (this.selRing.material as THREE.Material).dispose();
  }
}
