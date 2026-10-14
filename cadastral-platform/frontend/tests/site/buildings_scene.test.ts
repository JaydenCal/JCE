/** Stage 5: drawing buildings and the new types in the scene, and the placement tools of the design controller (SYNTHETIC TEST FIXTURE payload). */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as THREE from 'three';
vi.mock('@/lib/viewer/textures', async () => { const T = await import('three'); return { makeSprite: () => new T.Sprite(), makeTextures: () => ({}) }; });
import { SiteScene, CUT_COLOUR, FILL_COLOUR, cutFillColour, glbMatrix } from '@/lib/site/siteScene';
import { DesignController, type DesignState, type PointerInfo } from '@/lib/site/designController';
import { SiteDesignStore } from '@/lib/site/store';
import { HeightField } from '@/lib/site/terrain';
import { parseImportPayload } from '@/lib/site/buildings';
import { emptyDesign, type Pos, type SiteObject } from '@/lib/site/types';
import type { Built } from '@/lib/viewer/sceneBuilder';
import { seqCtx } from './helpers';

const PAYLOAD = parseImportPayload(JSON.parse(readFileSync(join(__dirname, '../../../backend/tests/fixtures/building_import_planstudio.json'), 'utf8')));
const O: [number, number] = [496000, 6650000];
const zOf = (x: number, y: number) => 100 + 0.1 * x + 0.05 * y;
function terrainMesh() {
  const g = new THREE.PlaneGeometry(100, 100, 20, 20); const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) p.setZ(i, zOf(p.getX(i), p.getY(i)));
  g.computeVertexNormals(); const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide })); m.updateMatrixWorld(true); return m;
}
const texts: string[] = [];
const label = (t: string) => { texts.push(t); return new THREE.Sprite(); };
beforeEach(() => { texts.length = 0; });
const lastText = () => texts[texts.length - 1];
const bText = () => [...texts].reverse().find((t) => t.includes('BUILDING'))!;
const meshes = (g: THREE.Object3D) => { const out: THREE.Mesh[] = []; g.traverse((o) => { if ((o as THREE.Mesh).isMesh) out.push(o as THREE.Mesh); }); return out; };

describe('cut and fill colour (the scene bundle convention)', () => {
  it('white at zero, orange-red for cut, blue for fill, saturating at 1.5 m', () => {
    expect(cutFillColour(0).getHexString()).toBe('ffffff');
    expect(cutFillColour(-1.5).getHexString()).toBe(CUT_COLOUR.slice(1));
    expect(cutFillColour(-9).getHexString()).toBe(CUT_COLOUR.slice(1));
    expect(cutFillColour(1.5).getHexString()).toBe(FILL_COLOUR.slice(1));
    const half = cutFillColour(0.75), full = new THREE.Color(FILL_COLOUR);
    expect(half.r).toBeCloseTo((1 + full.r) / 2, 6);
  });
});

describe('GLB placement matrix', () => {
  it('maps Plan Studio GLB space (Y up, X = plan x, Z = plan y down the sheet) to the scene at the floor level', () => {
    const m = glbMatrix([O[0] + 5, O[1] + 7], 0, 0, 100, O);
    const p = new THREE.Vector3(2, 3, 4).applyMatrix4(m);         // 2 m east of the origin, 3 m above the floor, 4 m down the sheet (south)
    expect(p.x).toBeCloseTo(7, 9); expect(p.y).toBeCloseTo(3, 9); expect(p.z).toBeCloseTo(103, 9);
    expect(m.determinant()).toBeCloseTo(1, 9);                    // a proper rotation: no mirroring
    const n = glbMatrix([O[0], O[1]], 0, 90, 0, O), q = new THREE.Vector3(1, 0, 0).applyMatrix4(n);       // north arrow turned 90 degrees clockwise: plan x points south
    expect(q.x).toBeCloseTo(0, 9); expect(q.y).toBeCloseTo(1, 9);
  });
  it('a clockwise yaw turns the building clockwise seen from above', () => {
    const m = glbMatrix([O[0], O[1]], 90, 0, 0, O), p = new THREE.Vector3(1, 0, 0).applyMatrix4(m);
    expect(p.x).toBeCloseTo(0, 9); expect(p.y).toBeCloseTo(-1, 9);       // east turned 90 degrees clockwise is south
  });
});

describe('SiteScene: buildings', () => {
  const sample = new HeightField([terrainMesh().geometry.attributes.position.array as unknown as ArrayLike<number>], [terrainMesh().geometry.index!.array]).sample;
  function setup() {
    const s = new SiteDesignStore(emptyDesign('p'), seqCtx());
    const sc = new SiteScene({ origin: O, terrain: { available: true, sample: (e, n) => sample(e - O[0], n - O[1]) }, makeLabel: label });
    s.on('change', (e) => sc.apply(e));
    const r = s.run('place_building', { payload: PAYLOAD, at: { e: O[0] + 40, n: O[1] + 40 } });
    return { s, sc, id: r.id as string };
  }
  it('FFL NOT SET and HEIGHT NOT SET: only a draped outline and fill, no block', () => {
    const { sc, id } = setup();
    expect(bText()).toContain('FFL NOT SET'); expect(bText()).toContain('HEIGHT NOT SET'); expect(bText()).toContain('BUILDING (HOUSE)');
    expect(bText()).toContain('ROOF 54.0 M2 APPROXIMATE (PLAN STUDIO RASTER)');
    const ms = meshes(sc.groupOf(id)!);
    expect(ms.some((m) => m.userData.slab)).toBe(false);
    for (const m of ms) { const p = m.geometry.attributes.position; for (let i = 0; i < p.count; i++) expect(p.getZ(i)).toBeCloseTo(zOf(p.getX(i), p.getY(i)), 0); }       // everything sits on the terrain (outline lifts 0.04 m)
  });
  it('FFL set, height not set: a slab at the FFL coloured by cut / fill, no walls', () => {
    const { s, sc, id } = setup();
    s.run('set_param', { id, key: 'ffl_rl', value: 108.2 });
    expect(bText()).toContain('FFL 108.20 RL'); expect(bText()).toContain('HEIGHT NOT SET'); expect(bText()).not.toContain('FFL NOT SET');
    const slab = meshes(sc.groupOf(id)!).find((m) => m.userData.slab)!;
    const pos = slab.geometry.attributes.position, col = slab.geometry.attributes.color;
    for (let i = 0; i < pos.count; i++) expect(pos.getZ(i)).toBeCloseTo(108.2, 5);
    let cut = false, fill = false;
    for (let i = 0; i < pos.count; i++) {
      const ground = zOf(pos.getX(i), pos.getY(i)), cf = 108.2 - ground, want = cutFillColour(cf);
      expect(col.getX(i)).toBeCloseTo(want.r, 4); expect(col.getY(i)).toBeCloseTo(want.g, 4); expect(col.getZ(i)).toBeCloseTo(want.b, 4);
      if (cf < -0.05) cut = true; if (cf > 0.05) fill = true;
    }
    expect(cut || fill).toBe(true);
    expect(meshes(sc.groupOf(id)!).some((m) => !m.userData.slab && m.material instanceof THREE.MeshStandardMaterial)).toBe(false);          // no walls yet
  });
  it('FFL and height set: slab plus walls up to FFL + height; no NOT SET labels', () => {
    const { s, sc, id } = setup();
    s.run('set_param', { id, key: 'ffl_rl', value: 108 }); s.run('set_param', { id, key: 'height_m', value: 5.5 });
    expect(bText()).not.toContain('FFL NOT SET'); expect(bText()).not.toContain('HEIGHT NOT SET');
    const walls = meshes(sc.groupOf(id)!).find((m) => m.material instanceof THREE.MeshStandardMaterial)!;
    const zs = Array.from({ length: walls.geometry.attributes.position.count }, (_, i) => walls.geometry.attributes.position.getZ(i));
    expect(Math.min(...zs)).toBeCloseTo(108, 5); expect(Math.max(...zs)).toBeCloseTo(113.5, 5);
    expect(walls.geometry.attributes.position.count).toBe(6 * 6);                                    // six edges, two triangles each
    s.run('remove_param', { id, key: 'height_m' });
    expect(meshes(sc.groupOf(id)!).some((m) => m.material instanceof THREE.MeshStandardMaterial)).toBe(false);
    expect(bText()).toContain('HEIGHT NOT SET');
  });
  it('a GLB replaces the block as the visual, placed at the FFL; it is not placed without an FFL', () => {
    const { s, sc, id } = setup();
    const glb = new THREE.Group(); glb.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial()));
    sc.setGlb(id, glb);
    expect(sc.groupOf(id)!.children.some((c) => c.userData.glb)).toBe(false);
    s.run('set_param', { id, key: 'ffl_rl', value: 108 }); s.run('set_param', { id, key: 'height_m', value: 5 });
    const placed = sc.groupOf(id)!.children.find((c) => c.userData.glb)!;
    expect(placed).toBeTruthy(); expect(placed.matrixAutoUpdate).toBe(false);
    const o = s.doc.objects[0];
    const expected = glbMatrix(o.building!.frame.origin, o.building!.frame.yaw_deg, o.building!.frame.north_deg ?? 0, 108, O);
    expect(placed.matrix.equals(expected)).toBe(true);
    expect(new THREE.Vector3(0, 0, 0).applyMatrix4(placed.matrix).z).toBeCloseTo(108, 9);
    expect(meshes(sc.groupOf(id)!).some((m) => m.material instanceof THREE.MeshStandardMaterial && !m.userData.shared)).toBe(false);           // no wall block under the GLB
    s.run('move_object', { id, dx: 2, dy: 0 });
    expect(sc.groupOf(id)!.children.some((c) => c.userData.glb)).toBe(true);                       // a move rebuilds with the GLB
    expect(sc.hasGlb(id)).toBe(true);
    sc.setGlb(id, null); expect(sc.hasGlb(id)).toBe(false);
  });
  it('pool, footpath, garden and furniture are drawn with their NOT SET labels', () => {
    const s = new SiteDesignStore(emptyDesign('p'), seqCtx());
    const sc = new SiteScene({ origin: O, terrain: { available: true, sample: (e, n) => sample(e - O[0], n - O[1]) }, makeLabel: label });
    s.on('change', (e) => sc.apply(e));
    const sq = (x: number, y: number, w: number): { e: number; n: number }[] => [[0, 0], [w, 0], [w, w], [0, w]].map(([a, b]) => ({ e: O[0] + x + a, n: O[1] + y + b }));
    s.run('add_object', { type: 'pool', points: sq(10, 10, 5) });
    expect(lastText()).toContain('POOL BARRIER REQUIREMENTS: SEE RULES'); expect(lastText()).toContain('DIMENSIONS NOT SET');
    s.run('add_object', { type: 'footpath', points: [{ e: O[0] + 1, n: O[1] + 1 }, { e: O[0] + 21, n: O[1] + 1 }] });
    expect(lastText()).toContain('SURFACE NOT SET'); expect(lastText()).toContain('DIMENSIONS NOT SET');
    s.run('set_param', { id: 'footpath_2', key: 'width_m', value: 1.2 }); s.run('set_param', { id: 'footpath_2', key: 'surface_kind', value: 'pavers' });
    expect(lastText()).not.toContain('DIMENSIONS NOT SET'); expect(lastText()).toContain('PAVERS');
    const ribbon = meshes(sc.groupOf('footpath_2')!).find((m) => m.geometry.attributes.position.count > 60)!;      // the width strip, draped
    expect(ribbon).toBeTruthy();
    s.run('add_object', { type: 'landscape_area', points: sq(30, 10, 4), params: { surface_kind: { value: 'garden_bed', basis: 'user' } }, label: 'Garden' });
    expect(lastText()).toContain('GARDEN BED');
    const f = s.run('add_object', { type: 'furniture', points: [{ e: O[0] + 50, n: O[1] + 50 }] });
    expect(lastText()).toContain('DIMENSIONS NOT SET');
    s.run('set_catalogue_item', { id: f.id, item_id: 'plan_studio:bbq', source_ref: 'PLAN STUDIO CATALOGUE DEFAULT SIZE', width_m: 1.3, depth_m: 0.56, height_m: 1.15 });
    expect(lastText()).not.toContain('DIMENSIONS NOT SET'); expect(lastText()).toContain('PLAN_STUDIO:BBQ');
    const box = meshes(sc.groupOf(f.id as string)!).find((m) => m.geometry.type === 'BoxGeometry')!;
    expect((box.geometry as THREE.BoxGeometry).parameters).toMatchObject({ width: 1.3, height: 0.56, depth: 1.15 });          // width x, depth y (before the BoxGeometry axis mapping), height z
  });
});

describe('DesignController: placing an imported building', () => {
  function rig() {
    const mesh = terrainMesh(), root = new THREE.Group(), states: DesignState[] = [];
    const ctl = new DesignController({
      built: { root } as unknown as Built, origin: O, terrainMeshes: [mesh], lot: null, terrainAvailable: true,
      mpp: () => 0.1, setOrbit: () => {}, store: new SiteDesignStore(emptyDesign('p'), seqCtx()), makeLabel: label,
    });
    ctl.listener = (s) => states.push(s); ctl.setActive(true);
    const info = (lx: number, ly: number, o: Partial<PointerInfo> = {}): PointerInfo => ({ ray: new THREE.Ray(new THREE.Vector3(lx, ly, 500), new THREE.Vector3(0, 0, -1)), x: lx * 10, y: ly * 10, alt: false, shift: false, button: 0, ...o });
    const move = (lx: number, ly: number) => { root.updateMatrixWorld(true); ctl.pointerMove(info(lx, ly)); };
    const click = (lx: number, ly: number) => { move(lx, ly); ctl.pointerDown(info(lx, ly)); ctl.pointerUp(info(lx, ly), false); };
    const key = (code: string) => ctl.key({ code, preventDefault() {}, shiftKey: false, ctrlKey: false, metaKey: false } as KeyboardEvent);
    return { ctl, root, move, click, key, info, last: () => states[states.length - 1], doc: () => ctl.store.doc };
  }
  const ghostLines = (root: THREE.Group) => { const out: THREE.Line[] = []; root.traverse((o) => { if ((o as THREE.Line).isLine && o.renderOrder === 18) out.push(o as THREE.Line); }); return out; };

  it('the footprint follows the cursor on the terrain until it is clicked; R and Q/E turn it; one undo step', () => {
    const r = rig();
    r.ctl.beginBuildingPlacement(PAYLOAD);
    expect(r.last().pendingBuilding?.source_file).toBe(PAYLOAD.source_file); expect(r.last().tool).toBe('place'); expect(r.last().hint).toContain('place the building');
    r.move(20, 20);
    let lines = ghostLines(r.root); expect(lines).toHaveLength(1);
    const p = lines[0].geometry.attributes.position; expect(p.count).toBeGreaterThan(6);                       // draped: extra sample points along the edges
    for (let i = 0; i < p.count; i++) expect(p.getZ(i)).toBeCloseTo(zOf(p.getX(i), p.getY(i)) + 0.12, 0);
    const cx = (a: Float32Array | ArrayLike<number>) => { let s = 0; for (let i = 0; i < p.count; i++) s += a[i * 3]; return s / p.count; };
    const x0 = cx(p.array);
    r.move(30, 20); lines = ghostLines(r.root); expect(lines).toHaveLength(1);                                // rebuilt, not accumulated
    expect(cx(lines[0].geometry.attributes.position.array)).toBeGreaterThan(x0 + 5);                           // it followed the cursor
    r.key('KeyR'); r.key('KeyR'); r.key('KeyQ');
    r.click(30, 20);
    const o = r.doc().objects.find((x) => x.type === 'building')!;
    expect(o.building!.frame.yaw_deg).toBe(15);
    expect(o.origin).toBe('imported');
    expect(r.last().pendingBuilding).toBeNull(); expect(r.last().tool).toBe('select'); expect(r.last().selectedId).toBe(o.id);
    expect(r.doc().objects.map((x) => x.type)).toEqual(['building', 'rwt']);
    expect(ghostLines(r.root)).toHaveLength(0);
    expect(r.ctl.store.history().undoLabel).toBe('Place building');
    r.ctl.undo(); expect(r.doc().objects).toHaveLength(0);
  });
  it('Escape and a locked store cancel the placement', () => {
    const r = rig(); r.ctl.beginBuildingPlacement(PAYLOAD); r.move(20, 20); r.key('Escape');
    expect(r.last().pendingBuilding).toBeNull(); expect(r.last().tool).toBe('select'); expect(ghostLines(r.root)).toHaveLength(0);
    r.ctl.store.lock('LOADING SAVED DESIGN'); r.ctl.beginBuildingPlacement(PAYLOAD);
    expect(r.last().pendingBuilding).toBeNull(); expect(r.last().message).toBe('LOADING SAVED DESIGN');
  });
  it('a placed building has no vertex handles; a body drag moves it with its block as one undo step', () => {
    const r = rig(); r.ctl.beginBuildingPlacement(PAYLOAD); r.click(40, 40);
    const id = r.doc().objects[0].id; r.root.updateMatrixWorld(true);
    expect(r.root.children.filter((c) => c.userData.handle).length).toBe(0);
    r.ctl.select(id);
    const o0 = r.doc().objects[0];
    expect(r.ctl.pointerDown(r.info(40, 40))).toBe(true);
    r.ctl.pointerMove(r.info(46, 40, { x: 600, y: 600 })); r.ctl.pointerUp(r.info(46, 40, { x: 600, y: 600 }), true);
    const o1 = r.doc().objects.find((x) => x.id === id)!;
    expect(o1.building!.frame.origin[0] - o0.building!.frame.origin[0]).toBeCloseTo(6, 4);
    expect((o1.geometry as { ring: Pos[] }).ring[0][0] - (o0.geometry as { ring: Pos[] }).ring[0][0]).toBeCloseTo(6, 4);
    r.ctl.undo(); expect(r.doc().objects.find((x) => x.id === id)).toEqual(o0);
  });
  it('the footprint tool hands the drawn ring to the page, which places it where it was drawn', () => {
    const r = rig(); let got: { ring: Pos[]; use: string } | null = null;
    r.ctl.beginFootprintDrawing('shed', (ring, use) => { got = { ring, use }; });
    expect(r.last().footprintUse).toBe('shed'); expect(r.last().hint).toContain('footprint');
    r.click(20, 20); r.click(30, 20); r.click(30, 28); r.click(20, 28); r.key('Enter');
    expect(got).not.toBeNull(); expect(got!.use).toBe('shed'); expect(got!.ring).toHaveLength(4);
    expect(r.doc().objects).toHaveLength(0);                                                    // nothing is added until the import answers
    expect(r.last().tool).toBe('select');
    const payload = parseImportPayload({ ...JSON.parse(readFileSync(join(__dirname, '../../../backend/tests/fixtures/building_import_planstudio.json'), 'utf8')), extras: [] });
    const id = r.ctl.placeBuildingAt(payload, [O[0] + 25, O[1] + 24]);
    expect(id).not.toBeNull(); expect(r.doc().objects[0].type).toBe('building');
    expect(r.ctl.placeBuildingAt({ ...payload, building: { ...payload.building, levels: [] } } as never, [0, 0])).toBeNull(); expect(r.last().message).not.toBe('');
  });
  it('furniture takes the chosen catalogue item and its dimensions in one undo step; an item without dimensions stays DIMENSIONS NOT SET', () => {
    const r = rig();
    r.ctl.setFurnitureItem({ item_id: 'plan_studio:sun_lounge', title: 'Sun lounge', source_ref: 'PLAN STUDIO CATALOGUE DEFAULT SIZE', width_m: 0.65, depth_m: 1.95, height_m: 0.8 });
    r.ctl.startFor('furniture'); r.click(20, 20);
    const f = r.doc().objects[0] as SiteObject;
    expect(f.type).toBe('furniture'); expect(f.params.catalogue_item.value).toBe('plan_studio:sun_lounge'); expect(f.params.depth_m.value).toBe(1.95);
    expect(r.ctl.store.history().undoCount).toBe(1);
    r.ctl.setFurnitureItem({ item_id: 'retail:1', title: 'Chair', source_ref: 'RETAIL CATALOGUE' });
    r.ctl.startFor('furniture'); r.click(30, 30);
    expect(r.doc().objects[1].params.width_m.basis).toBe('unresolved');
    r.ctl.setFurnitureItem(null); r.ctl.startFor('furniture'); r.click(35, 35);
    expect(r.doc().objects[2].params.catalogue_item.basis).toBe('unresolved');
  });
  it('a footpath area, a garden and a pool are drawn through the same tools', () => {
    const r = rig();
    r.ctl.startFor('footpath', { shape: 'polygon' }); r.click(10, 10); r.click(20, 10); r.click(20, 12); r.key('Enter');
    expect(r.doc().objects[0].type).toBe('footpath'); expect(r.doc().objects[0].geometry.kind).toBe('polygon');
    r.ctl.startFor('landscape_area', { params: { surface_kind: { value: 'garden_bed', basis: 'user' } }, label: 'Garden' });
    r.click(25, 10); r.click(35, 10); r.click(35, 20); r.key('Enter');
    expect(r.doc().objects[1].params.surface_kind.value).toBe('garden_bed'); expect(r.doc().objects[1].label).toBe('Garden');
    r.ctl.startFor('landscape_area'); r.click(41, 10); r.click(47, 10); r.click(47, 20); r.key('Enter');
    expect(r.doc().objects[2].params).toEqual({});                                           // a plain landscape area is not turned into a garden
    r.ctl.startFor('footpath'); r.click(10, 30); r.click(20, 30); r.key('Enter');
    expect(r.doc().objects[3].geometry.kind).toBe('polyline');
    r.ctl.startFor('pool'); r.click(10, 40); r.click(18, 40); r.click(18, 46); r.key('Enter');
    expect(r.doc().objects[4].type).toBe('pool'); expect(r.doc().objects[4].params.depth_m.basis).toBe('unresolved');
  });
  it('a building floor level is compared with the ground at the footprint corners', () => {
    const r = rig(); r.ctl.beginBuildingPlacement(PAYLOAD); r.click(40, 40);
    const id = r.doc().objects[0].id;
    expect(r.ctl.buildingCutFill(id)).toBeNull();
    r.ctl.store.run('set_param', { id, key: 'ffl_rl', value: 108 });
    const cf = r.ctl.buildingCutFill(id)!;
    expect(cf.sampled).toBe(6); expect(cf.missing).toBe(0); expect(cf.min).toBeLessThanOrEqual(cf.max);
    const ring = (r.doc().objects[0].geometry as { ring: Pos[] }).ring, grounds = ring.map((p) => zOf(p[0] - O[0], p[1] - O[1]));
    expect(cf.min).toBeCloseTo(108 - Math.max(...grounds), 3); expect(cf.max).toBeCloseTo(108 - Math.min(...grounds), 3);
  });
});
