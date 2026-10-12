import * as THREE from 'three';
import type { Built } from './sceneBuilder';
import type { CatalogueItem, PlacedItem, Vec3 } from './types';
import { createItemObject, styleGhost } from './itemModels';
import { snapFromHit, stepYaw, normDeg } from './snapping';
import { makeSprite } from './textures';

export interface PlaceState { items: PlacedItem[]; selectedId: string | null; ghostCatId: string | null; mode: 'idle' | 'place' | 'move' | 'duplicate'; canUndo: boolean; canRedo: boolean; hint: string }
const SKIP_LAYERS = ['boundary', 'gradearrows', 'cutfill', 'context', 'dbyd', 'drainage'];
let uid = 0; const newId = () => `i${Date.now().toString(36)}${(uid++).toString(36)}`;

export class PlaceController {
  items: PlacedItem[] = []; selectedId: string | null = null;
  private objs = new Map<string, THREE.Group>(); private warn = new Map<string, THREE.Sprite>();
  private ghost: THREE.Group | null = null; private ghostCat: CatalogueItem | null = null; private movingId: string | null = null; private mode: PlaceState['mode'] = 'idle';
  private gp: { p: Vec3; yaw: number; surface: PlacedItem['surface'] } | null = null; private yaw = 0;
  private past: string[] = []; private future: string[] = []; private sel: THREE.Box3Helper | null = null;
  private ray = new THREE.Raycaster(); catalogue = new Map<string, CatalogueItem>();
  listener: (s: PlaceState) => void = () => {}; onChange: (items: PlacedItem[]) => void = () => {};
  check?: (item: PlacedItem, cat: Map<string, CatalogueItem>) => Promise<string[]> | string[];

  constructor(private built: Built, private groundAt: (x: number, y: number, zl: number) => number | null) {}

  state(): PlaceState {
    const hint = this.mode === 'idle' ? (this.selectedId ? 'Q/E rotate · G move · D duplicate · Del delete' : 'Pick an item, or click a placed item to select')
      : 'Click to place · Q/E or wheel rotate 15° · Esc cancel';
    return { items: this.items, selectedId: this.selectedId, ghostCatId: this.ghostCat?.id ?? null, mode: this.mode, canUndo: this.past.length > 0, canRedo: this.future.length > 0, hint };
  }
  private emit() { this.listener(this.state()); }
  get active() { return !!this.ghost; }

  setCatalogue(c: CatalogueItem[]) { this.catalogue = new Map(c.map((x) => [x.id, x])); this.sync(); }
  setItems(items: PlacedItem[]) { this.items = items.map((i) => ({ ...i })); this.past = []; this.future = []; this.sync(); this.emit(); }

  private rebuild(it: PlacedItem) {
    const old = this.objs.get(it.id); if (old) { this.built.itemsGroup.remove(old); this.objs.delete(it.id); }
    const c = this.catalogue.get(it.itemId); if (!c) return null;
    const o = createItemObject(c); o.userData.placedId = it.id; this.built.itemsGroup.add(o); this.objs.set(it.id, o); return o;
  }
  sync() {
    const live = new Set(this.items.map((i) => i.id));
    for (const [id, o] of this.objs) if (!live.has(id)) { this.built.itemsGroup.remove(o); this.objs.delete(id); }
    for (const [id, s] of this.warn) if (!live.has(id) || !this.items.find((i) => i.id === id)?.warnings?.length) { s.parent?.remove(s); this.warn.delete(id); }
    for (const it of this.items) {
      let o = this.objs.get(it.id); if (!o || o.userData.catId !== it.itemId) o = this.rebuild(it) ?? undefined; if (!o) continue;
      o.position.set(...it.p); o.rotation.z = -(it.yaw * Math.PI) / 180; o.visible = !(this.movingId === it.id && this.ghost);
      const c = this.catalogue.get(it.itemId);
      if (it.warnings?.length && c) {
        let s = this.warn.get(it.id); const text = it.warnings.join('\n');
        if (!s || s.userData.text !== text) { s?.parent?.remove(s); s = makeSprite('! ' + text, 0.7, '#c0392b'); s.userData.text = text; this.warn.set(it.id, s); this.built.itemsGroup.add(s); }
        s.position.set(it.p[0], it.p[1], it.p[2] + c.dims.h + 0.5);
      }
    }
    this.updateSelection();
  }
  private updateSelection() {
    if (this.sel) { this.built.itemsGroup.remove(this.sel); this.sel = null; }
    const o = this.selectedId ? this.objs.get(this.selectedId) : null; if (!o) return;
    o.updateMatrixWorld(true); const bb = new THREE.Box3().setFromObject(o); this.sel = new THREE.Box3Helper(bb, new THREE.Color('#c7a256')); this.built.itemsGroup.add(this.sel);
  }

  private snapshot() { return JSON.stringify(this.items); }
  private commit(next: PlacedItem[]) {
    this.past.push(this.snapshot()); if (this.past.length > 100) this.past.shift(); this.future = [];
    this.items = next; this.sync(); this.onChange(this.items); this.emit(); this.runChecks(next);
  }
  private async runChecks(list: PlacedItem[]) {
    if (!this.check) return; let changed = false;
    for (const it of list) { const w = [...(await this.check(it, this.catalogue))]; if (JSON.stringify(w) !== JSON.stringify(it.warnings ?? [])) { it.warnings = w.length ? w : undefined; changed = true; } }
    if (changed && list === this.items) { this.sync(); this.onChange(this.items); this.emit(); }
  }
  undo() { const s = this.past.pop(); if (s === undefined) return; this.future.push(this.snapshot()); this.items = JSON.parse(s); this.afterHistory(); }
  redo() { const s = this.future.pop(); if (s === undefined) return; this.past.push(this.snapshot()); this.items = JSON.parse(s); this.afterHistory(); }
  private afterHistory() { if (this.selectedId && !this.items.find((i) => i.id === this.selectedId)) this.selectedId = null; this.sync(); this.onChange(this.items); this.emit(); }

  // ---- ghost
  startPlacing(catId: string) { const c = this.catalogue.get(catId); if (!c) return; this.beginGhost(c, 'place', null, 0); }
  startMove(id = this.selectedId) { const it = this.items.find((i) => i.id === id); const c = it && this.catalogue.get(it.itemId); if (it && c) this.beginGhost(c, 'move', it.id, it.yaw); }
  duplicateSelected() { const it = this.items.find((i) => i.id === this.selectedId); const c = it && this.catalogue.get(it.itemId); if (it && c) this.beginGhost(c, 'duplicate', null, it.yaw); }
  private beginGhost(c: CatalogueItem, mode: PlaceState['mode'], moving: string | null, yaw: number) {
    this.cancel(false); this.ghostCat = c; this.mode = mode; this.movingId = moving; this.yaw = yaw;
    this.ghost = createItemObject(c); styleGhost(this.ghost, true); this.ghost.visible = false; this.built.itemsGroup.add(this.ghost);
    if (moving) this.sync(); this.emit();
  }
  cancel(emit = true) {
    if (this.ghost) { this.built.itemsGroup.remove(this.ghost); this.ghost = null; }
    const was = this.movingId; this.ghostCat = null; this.mode = 'idle'; this.movingId = null; this.gp = null; if (was) this.sync(); if (emit) this.emit();
  }
  rotate(dir: 1 | -1) {
    if (this.ghost) { this.yaw = stepYaw(this.yaw, dir); if (this.gp) { this.gp.yaw = this.yaw; this.applyGhost(); } }
    else if (this.selectedId) { this.commit(this.items.map((i) => (i.id === this.selectedId ? { ...i, yaw: stepYaw(i.yaw, dir) } : i))); }
  }
  private applyGhost() {
    if (!this.ghost || !this.gp) return; this.ghost.visible = true; this.ghost.position.set(...this.gp.p); this.ghost.rotation.z = -(this.gp.yaw * Math.PI) / 180;
  }
  /** Update the ghost from a world-space ray (mouse or crosshair). */
  updateFromRay(origin: THREE.Vector3, dir: THREE.Vector3) {
    if (!this.ghost || !this.ghostCat) return;
    this.ray.set(origin, dir); this.ray.far = 80;
    const targets = this.built.meshes.filter((m) => m.visible && !SKIP_LAYERS.includes(m.userData.c) && !(m.material as THREE.Material).transparent);
    const h = this.ray.intersectObjects(targets, false)[0];
    if (!h || !h.face) { this.ghost.visible = false; this.gp = null; return; }
    const n = h.face.normal.clone().transformDirection(h.object.matrixWorld); if (n.dot(dir) > 0) n.negate();
    const pt = this.built.root.worldToLocal(h.point.clone());
    const s = snapFromHit({ point: [pt.x, pt.y, pt.z], normal: [n.x, n.y, n.z], layer: h.object.userData.c, dims: this.ghostCat.dims, mount: this.ghostCat.mount, yaw: this.yaw });
    if (s.needsDrop) { const g = this.groundAt(s.p[0], s.p[1], pt.z + 0.05); if (g !== null) s.p[2] = g; }
    this.gp = { p: s.p, yaw: s.surface === 'wall' ? s.yaw : this.yaw, surface: s.surface }; this.applyGhost();
  }
  /** Primary click: commit ghost, or select the item under the ray. Returns true if it consumed the click. */
  click(origin: THREE.Vector3, dir: THREE.Vector3): boolean {
    if (this.ghost && this.ghostCat) {
      if (!this.gp) return true; const g = this.gp;
      if (this.mode === 'move' && this.movingId) { const id = this.movingId; this.cancel(false); this.commit(this.items.map((i) => (i.id === id ? { ...i, p: g.p, yaw: g.yaw, surface: g.surface, warnings: undefined } : i))); }
      else { const it: PlacedItem = { id: newId(), itemId: this.ghostCat.id, p: g.p, yaw: g.yaw, surface: g.surface }; this.selectedId = it.id; this.commit([...this.items, it]); }
      return true;
    }
    this.ray.set(origin, dir); this.ray.far = 200;
    const hit = this.ray.intersectObjects([...this.objs.values()], true)[0];
    let o: THREE.Object3D | null = hit?.object ?? null; while (o && !o.userData.placedId) o = o.parent;
    this.select(o ? o.userData.placedId : null); return !!o;
  }
  select(id: string | null) { this.selectedId = id; this.updateSelection(); this.emit(); }
  deleteSelected() { if (this.selectedId) { const id = this.selectedId; this.selectedId = null; this.commit(this.items.filter((i) => i.id !== id)); } }
  removeItem(id: string) { this.selectedId = null; this.commit(this.items.filter((i) => i.id !== id)); }
  dispose() { this.cancel(false); for (const o of this.objs.values()) this.built.itemsGroup.remove(o); this.objs.clear(); }
  yawOf() { return normDeg(this.yaw); }
}
