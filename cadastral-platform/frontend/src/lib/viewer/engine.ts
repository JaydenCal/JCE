import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { AERIAL_LAYER, aerialLegend, drawAerialNote, setAerialOpacity } from './aerial';
import { buildScene, xrayMeshes, XRAY_BUILDINGS, XRAY_GROUND, type Built } from './sceneBuilder';
import { FirstPersonController } from './fpController';
import { PlaceController, type PlaceState } from './placeController';
import { drawMinimap } from './minimap';
import { floorGround, maxGround } from './movement';
import { DesignController, type DesignState, type PointerInfo } from '../site/designController';
import { lotRingFromBundle, terrainAvailable } from '../site/lot';
import { designTerrainMeshes } from '../site/terrain';
import { metresPerPixelOrtho, metresPerPixelPerspective } from '../site/snap';
import type { SiteDesignStore } from '../site/store';
import { DEFAULT_SETTINGS, type CatalogueItem, type PickInfo, type PlacedItem, type SceneBundle, type Settings } from './types';

export interface EngineEvents {
  onHover?: (t: string) => void; onPick?: (p: PickInfo | null) => void; onFp?: (active: boolean, locked: boolean) => void;
  onPlace?: (s: PlaceState) => void; onItemsChange?: (items: PlacedItem[]) => void; onDesign?: (s: DesignState) => void;
}
export interface Hud { needle?: SVGElement | null; minimap?: HTMLCanvasElement | null }
export type Opt = 'cutfill' | 'xray' | 'sxray' | 'edges' | 'shadow' | 'exag';

export class ViewerEngine {
  readonly built: Built; readonly place: PlaceController; readonly design: DesignController; fp: FirstPersonController;
  renderer: THREE.WebGLRenderer; scene = new THREE.Scene(); camera!: THREE.Camera; controls!: OrbitControls; fpCam: THREE.PerspectiveCamera;
  cOn: Record<string, boolean> = {}; opts = { cutfill: false, edges: true, exag: false }; settings: Settings = { ...DEFAULT_SETTINGS };
  hud: Hud = {}; fpActive = false; placeActive = false;
  private marker: THREE.Mesh; private ptr = new THREE.Vector2(); private ray = new THREE.Raycaster(); private raf = 0; private disposed = false;
  private designDown: [number, number] | null = null; private hovered: THREE.Mesh | null = null; private downAt: [number, number] | null = null; private lastPtr: PointerEvent | null = null;
  private lamp = new THREE.PointLight(0xffd9a8, 0, 12, 2); private interior = 0; private walkMeshes: THREE.Mesh[];
  private bounds: [number, number, number, number]; private cleanups: Array<() => void> = [];

  constructor(private canvas: HTMLCanvasElement, private stage: HTMLElement, private theme: HTMLElement, private bundle: SceneBundle, private ev: EngineEvents = {}, opts: { store?: SiteDesignStore } = {}) {
    const css = (n: string) => getComputedStyle(this.theme).getPropertyValue(n).trim();
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2)); this.renderer.shadowMap.enabled = true; this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.built = buildScene(bundle, css('--edge') || '#14161a'); this.scene.add(this.built.root, this.built.lights); this.built.lights.add(this.lamp);
    for (const L of bundle.layers) this.cOn[L.c] = L.on; this.cOn.items ??= true;
    this.marker = new THREE.Mesh(new THREE.SphereGeometry(0.15, 16, 12), new THREE.MeshBasicMaterial({ color: css('--accent') || '#a8842f' })); this.marker.visible = false; this.scene.add(this.marker);
    const w = bundle.walkable, names = new Set(w?.terrain ?? []);
    this.walkMeshes = this.built.meshes.filter((m) => (names.size ? names.has(m.userData.name) : ['surface', 'existing'].includes(m.userData.c)));
    if (!this.walkMeshes.length) this.walkMeshes = this.built.meshes.filter((m) => m.userData.c !== 'cutfill');
    const bb = this.built.bbox; this.bounds = [bb.min.x, bb.min.y, bb.max.x, bb.max.y];
    this.fpCam = new THREE.PerspectiveCamera(this.settings.fov, 1, 0.05, 1500); this.fpCam.up.set(0, 0, 1);
    const spawn = w?.spawn ?? { p: [this.built.centre.x, this.built.centre.y, this.built.bbox.max.z] as [number, number, number] };
    this.fp = new FirstPersonController(this.fpCam, canvas, { colliders: w?.colliders ?? [], ground: (x, y, zl) => this.groundAt(x, y, zl) }, spawn, this.settings, this.built.bbox.min.z);
    this.fp.onExit = () => this.setFirstPerson(false); this.fp.onLockChange = (l) => this.ev.onFp?.(this.fpActive, l);
    this.place = new PlaceController(this.built, (x, y, zl) => this.groundAt(x, y, zl));
    this.place.listener = (s) => this.ev.onPlace?.(s); this.place.onChange = (i) => this.ev.onItemsChange?.(i);
    this.place.setCatalogue(bundle.catalogue ?? []); this.place.setItems(bundle.items ?? []);
    const O = bundle.info.origin;
    // Design ground is terrain surface parts only (never the walkMeshes fallback of "every other mesh", which can include buildings, the aerial or items)
    const designGround = designTerrainMeshes(this.built.meshes, w?.terrain ?? []);
    this.design = new DesignController({
      built: this.built, origin: [O[0], O[1]], terrainMeshes: designGround, lot: lotRingFromBundle(bundle), terrainAvailable: designGround.length > 0 && terrainAvailable(bundle), store: opts.store,
      mpp: (p) => this.metresPerPixel(p), setOrbit: (on) => { if (this.controls) this.controls.enabled = on && !this.fpActive; },
    });
    this.design.listener = (s) => { this.canvas.style.cursor = s.active && s.tool !== 'select' ? 'crosshair' : ''; this.ev.onDesign?.(s); };
    this.cOn.design = true;
    this.setView('iso-sw'); this.applyTheme(); this.applyVis(); this.bindEvents(); this.resize(); this.loop();
  }

  groundAt = (x: number, y: number, zl: number): number | null => {
    this.ray.set(new THREE.Vector3(x, y, zl), new THREE.Vector3(0, 0, -1)); this.ray.far = 400;
    const h = this.ray.intersectObjects(this.walkMeshes, false)[0];
    return maxGround(h ? h.point.z : null, floorGround(this.bundle.walkable?.floors ?? [], x, y, zl));
  };
  private css = (n: string) => getComputedStyle(this.theme).getPropertyValue(n).trim();

  // ---- views
  setView(name: string) {
    if (this.fpActive) this.setFirstPerson(false);
    const { size, centre, radius } = this.built, VIEWS = this.bundle.views ?? {}, vd = VIEWS[name] ?? VIEWS['iso-sw'] ?? { dir: [-1, -1, 0.8] as [number, number, number] };
    const w = this.stage.clientWidth || 800, h = this.stage.clientHeight || 600;
    let cam: THREE.Camera;
    if (vd.ortho) {
      const a = w / h; const ext = name === 'plan' || vd.dir[2] > 0.9 ? [size.x, size.y] : Math.abs(vd.dir[1]) > Math.abs(vd.dir[0]) ? [size.x, size.z * 4] : [size.y, size.z * 4];
      const s = 0.55 * Math.max(ext[0] / a, ext[1]); cam = new THREE.OrthographicCamera(-s * a, s * a, s, -s, -300, 300);
    } else cam = new THREE.PerspectiveCamera(42, w / h, 1, 1200);
    cam.up.set(0, 0, 1);
    const v = new THREE.Vector3(...vd.dir).normalize(); let tgt = centre.clone(), d = radius * 2;
    if (vd.target) { tgt = new THREE.Vector3(...vd.target); d = vd.dist ?? 20; }
    cam.position.copy(tgt).addScaledVector(v, d); cam.lookAt(tgt);
    this.controls?.dispose(); this.camera = cam;
    this.controls = new OrbitControls(cam, this.canvas); this.controls.target.copy(tgt); this.controls.enableDamping = true; this.controls.dampingFactor = 0.12; this.controls.maxPolarAngle = Math.PI; this.controls.update();
    this.controls.enableZoom = !this.place.active; this.resize();
  }

  /** Metres per screen pixel at a world point (for snap radii and constant size handles). */
  metresPerPixel(p: THREE.Vector3): number {
    const h = this.stage.clientHeight || 600, cam = this.camera as THREE.PerspectiveCamera & THREE.OrthographicCamera;
    if (!cam) return 0.05;
    if ((cam as THREE.OrthographicCamera).isOrthographicCamera) return metresPerPixelOrtho(cam.top - cam.bottom, cam.zoom, h);
    return metresPerPixelPerspective(cam.position.distanceTo(p), cam.fov, h);
  }
  private info(ev: PointerEvent): PointerInfo {
    const r = this.rayFromEvent(ev); return { ray: r.ray.clone(), x: ev.clientX, y: ev.clientY, alt: ev.altKey, shift: ev.shiftKey, button: ev.button };
  }
  get designActive() { return this.design.active; }
  /** Design mode: site object tools. Leaves place mode and first person; exaggeration is switched off so heights stay true. */
  setDesign(on: boolean) {
    if (on === this.design.active) return;
    if (on) { if (this.placeActive) this.setPlace(false); if (this.fpActive) this.setFirstPerson(false); this.setOpt('exag', false); }
    this.design.setActive(on); this.controls.enableZoom = true;
  }

  // ---- visibility / modes
  applyVis() {
    const { meshes, lineObjs, edgeLines, sprites, itemsGroup } = this.built, on = this.cOn;
    for (const m of meshes) { const c = m.userData.c; m.visible = c === 'cutfill' ? this.opts.cutfill && !!on.surface : c === 'surface' ? !!on.surface && !this.opts.cutfill : !!on[c]; }
    for (const l of lineObjs) l.visible = !!on[l.userData.c];
    for (const e of edgeLines) e.visible = this.opts.edges && e.userData.owner.visible;
    for (const s of sprites) s.visible = !!on[s.userData.c];
    itemsGroup.visible = !!on.items;
    if (this.design) this.design.scene.group.visible = on.design !== false;
  }
  /** Aerial imagery opacity, 0 to 1 (the layer toggle is separate). */
  setAerialOpacity(v: number) { setAerialOpacity(this.built.meshes, v); }
  setLayer(c: string, v: boolean) { this.cOn[c] = v; this.applyVis(); }
  setOpt(o: Opt, v: boolean) {
    const b = this.built;
    if (o === 'cutfill') { this.opts.cutfill = v; this.applyVis(); }
    else if (o === 'edges') { this.opts.edges = v; this.applyVis(); }
    else if (o === 'shadow') { this.renderer.shadowMap.enabled = v; this.built.sun.castShadow = v; b.root.traverse((x: any) => { if (x.material) (Array.isArray(x.material) ? x.material : [x.material]).forEach((m: THREE.Material) => (m.needsUpdate = true)); }); }
    else if (o === 'xray') xrayMeshes(b.meshes, XRAY_BUILDINGS, v);
    else if (o === 'sxray') xrayMeshes(b.meshes, XRAY_GROUND, v);
    else if (o === 'exag') { this.opts.exag = v; const k = v && !this.fpActive && !this.place.active ? 3 : 1; b.root.scale.set(1, 1, k); b.root.position.z = b.z0 * (1 - k); }
  }
  applyTheme() {
    this.scene.background = new THREE.Color(this.css('--scene-bg') || '#e3e6e8');
    for (const e of this.built.edgeLines) (e.material as THREE.LineBasicMaterial).color.set(this.css('--edge') || '#14161a');
    (this.marker.material as THREE.MeshBasicMaterial).color.set(this.css('--accent') || '#a8842f');
  }
  setSettings(p: Partial<Settings>) { Object.assign(this.settings, p); this.fp.applySettings(); }

  setFirstPerson(on: boolean) {
    if (on === this.fpActive) return;
    if (on && this.design.active) this.design.setActive(false);
    this.fpActive = on;
    if (on) { this.fp.enable(); this.camera = this.fpCam; this.controls.enabled = false; this.setOpt('exag', false); this.marker.visible = false; }
    else { this.fp.disable(); this.controls.enabled = true; const c = this.controls.object; this.camera = c; this.interiorTarget(0); }
    this.ev.onFp?.(on, this.fp.locked); this.resize();
  }
  setPlace(on: boolean) {
    if (on && this.design.active) this.design.setActive(false);
    this.placeActive = on; if (!on) { this.place.cancel(); this.place.select(null); }
    this.controls.enableZoom = !(on && this.place.active);
    if (on) this.setOpt('exag', false);
  }
  private interiorTarget(v: number) { this.interior = v; this.built.hemi.intensity = (0.8 + 0.5 * v) * Math.PI; this.built.sun.intensity = (0.9 - 0.55 * v) * Math.PI; this.lamp.intensity = 0; }

  // ---- input
  private rayFromEvent(ev: { clientX: number; clientY: number }) {
    const r = this.canvas.getBoundingClientRect(); this.ptr.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1); this.ray.setFromCamera(this.ptr, this.camera); return this.ray;
  }
  private cast(ev: { clientX: number; clientY: number }) {
    const r = this.rayFromEvent(ev); r.far = 5000;
    return r.intersectObjects(this.built.meshes.filter((m) => m.visible && !['boundary', 'gradearrows', 'aerial'].includes(m.userData.c)), false)[0] ?? null;
  }
  private centreRay() { this.ray.setFromCamera(new THREE.Vector2(0, 0), this.camera); return this.ray; }
  private bindEvents() {
    const c = this.canvas, add = (t: EventTarget, e: string, f: (x: any) => void, o?: AddEventListenerOptions) => { t.addEventListener(e, f, o); this.cleanups.push(() => t.removeEventListener(e, f, o)); };
    add(c, 'pointermove', (ev: PointerEvent) => {
      if (this.fpActive) return; this.lastPtr = ev;
      if (this.design.active) { this.design.pointerMove(this.info(ev)); return; }
      if (this.place.active) { const r = this.rayFromEvent(ev); this.place.updateFromRay(r.ray.origin, r.ray.direction); return; }
      const h = this.cast(ev);
      if (this.hovered && (!h || h.object !== this.hovered)) { const m = this.hovered.material as THREE.MeshStandardMaterial; if (m.emissive && !this.hovered.userData.eml) m.emissive.setHex(0); this.hovered = null; }
      if (h) { this.hovered = h.object as THREE.Mesh; const m = this.hovered.material as THREE.MeshStandardMaterial; if (m.emissive && !this.hovered.userData.eml) m.emissive.setHex(0x222211); this.ev.onHover?.(String(this.hovered.userData.name).replace(/_/g, ' ')); }
      else this.ev.onHover?.('');
    });
    add(c, 'pointerdown', (ev: PointerEvent) => { this.downAt = [ev.clientX, ev.clientY]; });
    // design tools: captured on the stage so they run before OrbitControls, which a grabbed handle or object must be able to disable
    add(this.stage, 'pointerdown', (ev: PointerEvent) => { if (this.design.active && !this.fpActive && ev.target === c) { this.designDown = [ev.clientX, ev.clientY]; this.design.pointerDown(this.info(ev)); } }, { capture: true });
    add(window, 'pointerup', (ev: PointerEvent) => {
      if (!this.design.active || this.fpActive || (!this.design.state().dragging && !this.designDown && ev.target !== c)) return;
      const d = this.designDown; this.designDown = null; this.design.pointerUp(this.info(ev), !!d && Math.hypot(ev.clientX - d[0], ev.clientY - d[1]) > 4);
    });
    add(c, 'dblclick', () => { if (this.design.active) this.design.doubleClick(); });
    add(c, 'pointerup', (ev: PointerEvent) => {
      const d = this.downAt; this.downAt = null; if (this.design.active) return; if (ev.button === 2 && this.place.active) { this.place.cancel(); this.controls.enableZoom = true; return; }
      if (this.fpActive) { if (this.placeActive && this.fp.locked) { const r = this.centreRay(); this.place.click(r.ray.origin, r.ray.direction); } return; }
      if (!d || Math.hypot(ev.clientX - d[0], ev.clientY - d[1]) > 4) return;
      if (this.placeActive) { const r = this.rayFromEvent(ev); this.place.click(r.ray.origin, r.ray.direction); this.controls.enableZoom = !this.place.active; return; }
      this.pick(ev);
    });
    add(c, 'contextmenu', (e: Event) => { if (this.place.active || (this.design.active && this.design.state().tool !== 'select')) e.preventDefault(); });
    add(c, 'wheel', (e: WheelEvent) => { if (this.place.active) { e.preventDefault(); this.place.rotate(e.deltaY > 0 ? 1 : -1); } }, { passive: false });
    add(window, 'keydown', (e: KeyboardEvent) => this.onKey(e));
    add(window, 'resize', () => this.resize());
    const ro = new ResizeObserver(() => this.resize()); ro.observe(this.stage); this.cleanups.push(() => ro.disconnect());
    const mo = new MutationObserver(() => this.applyTheme()); mo.observe(this.theme, { attributes: true, attributeFilter: ['data-theme'] }); this.cleanups.push(() => mo.disconnect());
    try { const mq = matchMedia('(prefers-color-scheme: dark)'); const f = () => this.applyTheme(); mq.addEventListener('change', f); this.cleanups.push(() => mq.removeEventListener('change', f)); } catch { /* ignore */ }
  }
  private onKey(e: KeyboardEvent) {
    const t = e.target as HTMLElement | null; if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return;
    if (this.design.active) { this.design.key(e); return; }
    const ctrl = e.ctrlKey || e.metaKey;
    if (ctrl && e.code === 'KeyZ') { e.preventDefault(); e.shiftKey ? this.place.redo() : this.place.undo(); return; }
    if (ctrl && e.code === 'KeyY') { e.preventDefault(); this.place.redo(); return; }
    if (!this.placeActive || ctrl) return;
    if (e.code === 'KeyQ') this.place.rotate(-1); else if (e.code === 'KeyE') this.place.rotate(1);
    else if (e.code === 'Escape') { if (this.place.active) { this.place.cancel(); this.controls.enableZoom = true; } else this.place.select(null); }
    else if (e.code === 'Delete' || e.code === 'Backspace') this.place.deleteSelected();
    else if (e.code === 'KeyG' && !this.place.active) this.place.startMove();
    else if (e.code === 'KeyD' && !this.place.active && !this.fpActive) this.place.duplicateSelected();
  }
  private pick(ev: PointerEvent) {
    const h = this.cast(ev); if (!h) return; const k = this.built.root.scale.z, O = this.bundle.info.origin;
    const pz = (h.point.z - this.built.root.position.z) / k; this.marker.position.copy(h.point); this.marker.visible = true;
    let depth: number | null = null; const eg = this.built.egMesh;
    if (eg) { const r2 = new THREE.Raycaster(new THREE.Vector3(h.point.x, h.point.y, h.point.z + 1000), new THREE.Vector3(0, 0, -1)); const hh = r2.intersectObject(eg, false)[0]; if (hh) depth = pz - (hh.point.z - this.built.root.position.z) / k; }
    this.ev.onPick?.({ e: h.point.x + O[0], n: h.point.y + O[1], rl: pz, depth, part: String(h.object.userData.name).replace(/_/g, ' ') });
  }
  resize() {
    const w = this.stage.clientWidth, h = this.stage.clientHeight; if (!w || !h || !this.camera) return; this.renderer.setSize(w, h, false);
    for (const cam of [this.camera, this.fpCam]) {
      if ((cam as THREE.PerspectiveCamera).isPerspectiveCamera) (cam as THREE.PerspectiveCamera).aspect = w / h;
      else { const o = cam as THREE.OrthographicCamera, a = w / h, s = o.top; o.left = -s * a; o.right = s * a; }
      (cam as THREE.PerspectiveCamera).updateProjectionMatrix();
    }
  }

  // ---- loop
  private last = performance.now();
  private loop = () => {
    if (this.disposed) return; this.raf = requestAnimationFrame(this.loop);
    const now = performance.now(), dt = Math.min(0.1, (now - this.last) / 1000); this.last = now;
    let heading = 0;
    if (this.fpActive) {
      this.fp.update(dt); heading = this.fp.yaw;
      const s = this.fp.state, inside = floorGround(this.bundle.walkable?.floors ?? [], s.x, s.y, s.z + 1.2) !== null;
      this.interior += ((inside ? 1 : 0) - this.interior) * Math.min(1, dt * 4);
      this.built.hemi.intensity = (0.8 + 0.5 * this.interior) * Math.PI; this.built.sun.intensity = (0.9 - 0.5 * this.interior) * Math.PI;
      this.lamp.intensity = 14 * this.interior; this.lamp.position.set(s.x, s.y, s.z + 2.2);
      if (this.placeActive) { const r = this.centreRay(); this.place.updateFromRay(r.ray.origin, r.ray.direction); }
      const mm = this.hud.minimap; if (mm) drawMinimap(mm, this.bundle, this.bundle.walkable?.colliders ?? [], this.bounds, { x: s.x, y: s.y, yaw: this.fp.yaw }, this.css);
    } else {
      this.controls.update(); this.design.frame(); const n = new THREE.Vector3(0, 1, 0).applyQuaternion(this.camera.quaternion.clone().invert()); heading = -Math.atan2(n.x, n.y);
    }
    if (this.hud.needle) this.hud.needle.setAttribute('transform', `rotate(${(-heading * 180) / Math.PI} 27 27)`);
    this.renderer.render(this.scene, this.camera);
  };
  /** Screenshot export path: renders the current frame (PNG data URL). */
  snapshotPng(): string {
    this.renderer.render(this.scene, this.camera);
    if (!this.aerialVisible()) return this.canvas.toDataURL('image/png');
    // the aerial layer is visible: the information-only wording is burned into the exported image
    const out = document.createElement('canvas'); out.width = this.canvas.width; out.height = this.canvas.height;
    const ctx = out.getContext('2d');
    if (!ctx) return this.canvas.toDataURL('image/png');
    ctx.drawImage(this.canvas, 0, 0);
    const lg = aerialLegend(this.bundle);
    drawAerialNote(ctx, out.width, out.height, lg?.note, lg ? `SOURCE: ${lg.source}. CAPTURE DATE: ${lg.capture}.` : undefined);
    return out.toDataURL('image/png');
  }
  /** True when an aerial mesh is switched on and not fully transparent (the wording must then appear on screen and in exports). */
  aerialVisible(): boolean {
    return !!this.cOn[AERIAL_LAYER] && this.built.meshes.some((m) => m.userData.c === AERIAL_LAYER && m.visible && (m.material as THREE.Material).opacity > 0);
  }
  snapshotState() { const s = this.fp.state; return { fpActive: this.fpActive, x: s.x, y: s.y, z: s.z, yaw: this.fp.yaw, grounded: s.grounded }; }
  dispose() {
    this.disposed = true; cancelAnimationFrame(this.raf); this.cleanups.forEach((f) => f()); this.fp.disable(); this.controls?.dispose(); this.place.dispose(); this.design.dispose(); this.built.dispose(); this.renderer.dispose();
  }
  setCatalogue(c: CatalogueItem[]) { this.place.setCatalogue(c); }
}
