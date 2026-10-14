import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as THREE from 'three';
vi.mock('@/lib/viewer/textures', async () => { const T = await import('three'); return { makeSprite: () => new T.Sprite(), makeTextures: () => ({}) }; });
import { SiteScene } from '@/lib/site/siteScene';
import { DesignController, type DesignState, type PointerInfo } from '@/lib/site/designController';
import { SiteDesignStore } from '@/lib/site/store';
import { HeightField } from '@/lib/site/terrain';
import { applyOp } from '@/lib/site/ops';
import { emptyDesign, type SiteObject } from '@/lib/site/types';
import type { Built } from '@/lib/viewer/sceneBuilder';
import { seqCtx } from './helpers';

const O: [number, number] = [496000, 6650000];
const zOf = (x: number, y: number) => 100 + 0.1 * x + 0.05 * y;
function terrainMesh() {
  const g = new THREE.PlaneGeometry(100, 100, 20, 20); const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) p.setZ(i, zOf(p.getX(i), p.getY(i)));
  g.computeVertexNormals(); const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide })); m.updateMatrixWorld(true); return m;
}
const texts: string[] = [];
const label = (t: string) => { texts.push(t); return new THREE.Sprite(); };
const LOT: [number, number][] = [[O[0] - 10, O[1] - 10], [O[0] + 30, O[1] - 10], [O[0] + 30, O[1] + 30], [O[0] - 10, O[1] + 30]];

function rig(over: { terrainAvailable?: boolean; lot?: [number, number][] | null } = {}) {
  const mesh = terrainMesh(), root = new THREE.Group(), states: DesignState[] = [];
  const ctl = new DesignController({
    built: { root } as unknown as Built, origin: O, terrainMeshes: [mesh], lot: over.lot === undefined ? LOT : over.lot, terrainAvailable: over.terrainAvailable ?? true,
    mpp: () => 0.1, setOrbit: () => {}, store: new SiteDesignStore(emptyDesign('p'), seqCtx()), makeLabel: label,
  });
  ctl.listener = (s) => states.push(s); ctl.setActive(true);
  const info = (lx: number, ly: number, o: Partial<PointerInfo> = {}): PointerInfo => ({ ray: new THREE.Ray(new THREE.Vector3(lx, ly, 500), new THREE.Vector3(0, 0, -1)), x: lx * 10, y: ly * 10, alt: false, shift: false, button: 0, ...o });
  const move = (lx: number, ly: number, o: Partial<PointerInfo> = {}) => { root.updateMatrixWorld(true); ctl.pointerMove(info(lx, ly, o)); };
  const click = (lx: number, ly: number, o: Partial<PointerInfo> = {}) => { move(lx, ly, o); ctl.pointerDown(info(lx, ly, o)); ctl.pointerUp(info(lx, ly, o), false); };
  const key = (code: string, o: Partial<KeyboardEvent> = {}) => ctl.key({ code, preventDefault() {}, shiftKey: false, ctrlKey: false, metaKey: false, ...o } as KeyboardEvent);
  const last = () => states[states.length - 1];
  return { ctl, root, mesh, move, click, key, info, last, doc: () => ctl.store.doc };
}
beforeEach(() => { texts.length = 0; });

describe('SiteScene: incremental rebuild and drawing rules', () => {
  const sample = new HeightField([terrainMesh().geometry.attributes.position.array as unknown as ArrayLike<number>], [terrainMesh().geometry.index!.array]).sample;
  function setup() {
    const s = new SiteDesignStore(emptyDesign('p'), seqCtx()); const sc = new SiteScene({ origin: O, terrain: { available: true, sample: (e, n) => sample(e - O[0], n - O[1]) }, makeLabel: label });
    s.on('change', (e) => sc.apply(e));
    s.run('add_object', { type: 'tree', points: [{ e: O[0] + 5, n: O[1] + 5 }] });
    s.run('add_object', { type: 'retaining_wall', points: [{ e: O[0] + 1, n: O[1] + 1 }, { e: O[0] + 21, n: O[1] + 1 }] });
    s.run('add_object', { type: 'landscape_area', points: [{ e: O[0], n: O[1] }, { e: O[0] + 8, n: O[1] }, { e: O[0] + 8, n: O[1] + 8 }, { e: O[0], n: O[1] + 8 }] });
    return { s, sc };
  }
  it('rebuilds only the changed object, not the whole scene', () => {
    const { s, sc } = setup();
    expect(sc.ids().sort()).toEqual(['landscape_area_3', 'retaining_wall_2', 'tree_1']); const other = sc.groupOf('retaining_wall_2'), area = sc.groupOf('landscape_area_3');
    const before = sc.rebuildCount;
    s.run('move_object', { id: 'tree_1', dx: 1, dy: 1 });
    expect(sc.lastRebuilt).toEqual(['tree_1']); expect(sc.rebuildCount).toBe(before + 1);
    expect(sc.groupOf('retaining_wall_2')).toBe(other); expect(sc.groupOf('landscape_area_3')).toBe(area);          // the same three.js groups, untouched
    s.run('set_param', { id: 'retaining_wall_2', key: 'height_m', value: 1 }); expect(sc.lastRebuilt).toEqual(['retaining_wall_2']);
    s.undo(); expect(sc.lastRebuilt).toEqual(['retaining_wall_2']);
    s.run('delete_object', { id: 'tree_1' }); expect(sc.ids()).not.toContain('tree_1'); expect(sc.group.children).toHaveLength(2);
    s.undo(); expect(sc.ids()).toContain('tree_1'); expect(sc.lastRebuilt).toEqual(['tree_1']);
  });
  it('a derived issue change rebuilds that object only', () => {
    const { s, sc } = setup();
    s.setEnv({ lot: [[O[0], O[1]], [O[0] + 3, O[1]], [O[0] + 3, O[1] + 3], [O[0], O[1] + 3]], terrain: { available: true, sample: (e, n) => sample(e - O[0], n - O[1]) } });
    expect(sc.lastRebuilt.sort()).toEqual(['landscape_area_3', 'retaining_wall_2', 'tree_1']);      // all three leave the small lot
  });
  it('an object without dimensions is a marker labelled DIMENSIONS NOT SET; with all dimensions it is solid', () => {
    const { s, sc } = setup();
    expect(texts.some((t) => t.includes('TREE') && t.includes('DIMENSIONS NOT SET'))).toBe(true);
    const marker = sc.groupOf('tree_1')!; expect(marker.getObjectByProperty('type', 'Mesh')).toBeTruthy();
    const geoms = () => { const out: string[] = []; sc.groupOf('tree_1')!.traverse((o) => { const g = (o as THREE.Mesh).geometry; if (g) out.push(g.type); }); return out; };
    expect(geoms()).toContain('SphereGeometry');
    texts.length = 0;
    s.run('set_param', { id: 'tree_1', key: 'height_m', value: 8 }); s.run('set_param', { id: 'tree_1', key: 'canopy_diameter_m', value: 5 });
    expect(texts[texts.length - 1]).not.toContain('DIMENSIONS NOT SET');
    const sphere = sc.groupOf('tree_1')!.getObjectByProperty('type', 'Mesh') as THREE.Mesh; expect((sphere.geometry as THREE.SphereGeometry).parameters.radius).toBe(2.5);
  });
  it('lines and outlines drape on the terrain (z follows the surface, not a plane)', () => {
    const { sc } = setup();
    const ribbon = sc.groupOf('retaining_wall_2')!.getObjectByProperty('type', 'Mesh') as THREE.Mesh; const p = ribbon.geometry.attributes.position;
    expect(p.count).toBeGreaterThan(60);                                                 // sampled every metre along 20 m, two sides
    for (let i = 0; i < p.count; i++) expect(p.getZ(i)).toBeCloseTo(zOf(p.getX(i), p.getY(i)) + 0.04, 4);
    const zs = Array.from({ length: p.count }, (_, i) => p.getZ(i)); expect(Math.max(...zs) - Math.min(...zs)).toBeGreaterThan(0.1 * 20 - 0.5);   // follows the slope end to end
    const tree = sc.groupOf('tree_1')!; expect(tree.position.z).toBeCloseTo(zOf(5, 5), 5); expect(tree.position.x).toBeCloseTo(5, 6);
  });
  it('labels are upper case and a rejected AI proposal is hidden', () => {
    const { s, sc } = setup();
    s.run('add_object', { type: 'osd', points: [{ e: O[0] + 2, n: O[1] + 2 }], origin: 'ai_proposal', label: 'north' });
    expect(texts.some((t) => t.includes('AI PROPOSAL, PENDING') && t.includes('OSD TANK: NORTH'))).toBe(true);
    for (const t of texts) expect(t).toBe(t.toUpperCase());
    s.run('reject_proposal', { id: 'osd_4' }); expect(sc.groupOf('osd_4')!.visible).toBe(false); expect(sc.pickables().every((o) => SiteScene.idOf(o) !== 'osd_4')).toBe(true);
  });
  it('terrain missing under a vertex still draws (nearest height) and flags the object', () => {
    const s = new SiteDesignStore(emptyDesign('p'), seqCtx()); const sc = new SiteScene({ origin: O, terrain: { available: true, sample: (e) => (e < O[0] + 50 ? 100 : null) }, makeLabel: label });
    s.setEnv({ lot: null, terrain: { available: true, sample: (e) => (e < O[0] + 50 ? 100 : null) } }); s.on('change', (e) => sc.apply(e));
    s.run('add_object', { type: 'retaining_wall', points: [{ e: O[0] + 10, n: O[1] }, { e: O[0] + 60, n: O[1] }] });
    expect(s.doc.objects[0].issues[0].message).toContain('NO TERRAIN UNDER 1 OF 2');
    const pos = (sc.groupOf('retaining_wall_1')!.getObjectByProperty('type', 'Mesh') as THREE.Mesh).geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) expect(Number.isFinite(pos.getZ(i))).toBe(true);
  });
});

describe('DesignController: tools', () => {
  it('places a point object on the terrain mesh with a ghost, rotates it 15 degrees with R, one undo step', () => {
    const r = rig(); r.ctl.startFor('tree');
    r.move(5, 6); expect(r.ctl['ghost']!.visible).toBe(true); expect(r.ctl['ghost']!.position.z).toBeCloseTo(zOf(5, 6), 5);       // raycast onto the sloping mesh, not a flat plane
    r.key('KeyR'); r.key('KeyR'); r.key('KeyQ');
    r.click(5, 6);
    const o = r.doc().objects[0];
    expect(o.type).toBe('tree'); expect(o.geometry).toEqual({ kind: 'point', p: [O[0] + 5, O[1] + 6], yaw_deg: 15 }); expect(o.status).toBe('proposed'); expect(o.params).toEqual({});
    expect(r.ctl.store.history()).toMatchObject({ undoCount: 1, undoLabel: 'Place tree' }); expect(r.last().selectedId).toBe(o.id);
    r.key('KeyZ', { ctrlKey: true } as never); expect(r.doc().objects).toHaveLength(0);
    r.key('KeyZ', { ctrlKey: true, shiftKey: true } as never); expect(r.doc().objects).toHaveLength(1);
  });
  it('continues placing until Escape; the new status comes from the panel choice', () => {
    const r = rig(); r.ctl.setNewStatus('existing'); r.ctl.startFor('stormwater_pit'); r.click(1, 1); r.click(3, 3);
    expect(r.doc().objects.map((o) => o.status)).toEqual(['existing', 'existing']); expect(r.last().tool).toBe('place');
    r.key('Escape'); expect(r.last().tool).toBe('select');
  });
  it('draws a polyline: click adds vertices, live length, Backspace removes the last, Enter finishes', () => {
    const r = rig(); r.ctl.startFor('retaining_wall');
    r.click(0, 0); r.click(10, 0); r.move(10, 10);
    expect(r.last().readout).toMatchObject({ kind: 'polyline', vertices: 2, live: true }); expect(r.last().readout!.planLength).toBeCloseTo(20, 6); expect(r.last().readout!.surfaceLength!).toBeGreaterThan(20);
    r.click(10, 10); r.key('Backspace'); expect(r.last().drawing).toBe(true);
    r.click(10, 12); expect(r.doc().objects).toHaveLength(0);
    r.key('Enter');
    const o = r.doc().objects[0]; expect(o.geometry).toEqual({ kind: 'polyline', pts: [[O[0], O[1]], [O[0] + 10, O[1]], [O[0] + 10, O[1] + 12]] });
    expect(r.ctl.store.history().undoLabel).toBe('Draw retaining wall'); expect(r.last().drawing).toBe(false);
  });
  it('double click finishes without a duplicate final vertex', () => {
    const r = rig(); r.ctl.startFor('stormwater_pipe'); r.click(0, 0); r.click(8, 0); r.click(8, 0); r.ctl.doubleClick();
    expect((r.doc().objects[0].geometry as { pts: unknown[] }).pts).toHaveLength(2);
  });
  it('draws a polygon with live area; fewer than three points is refused; clicking the first point closes it; Escape cancels', () => {
    const r = rig(); r.ctl.startFor('landscape_area');
    r.click(0, 0); r.click(10, 0); r.key('Enter'); expect(r.doc().objects).toHaveLength(0); expect(r.last().message).toContain('at least 3');
    r.move(10, 10); expect(r.last().readout!.area).toBeCloseTo(50, 6);       // triangle (0,0) (10,0) (10,10)
    r.click(10, 10); r.move(0, 10); expect(r.last().readout!.area).toBeCloseTo(100, 6);
    r.click(0, 10); r.click(0, 0);                                            // back on the first vertex (snaps to it): closes
    expect(r.doc().objects[0].geometry).toEqual({ kind: 'polygon', ring: [[O[0], O[1]], [O[0] + 10, O[1]], [O[0] + 10, O[1] + 10], [O[0], O[1] + 10]] });
    r.click(20, 20); r.click(25, 20); r.key('Escape'); expect(r.last().drawing).toBe(false); expect(r.doc().objects).toHaveLength(1);
  });
  it('snaps to the lot boundary vertex, then to a boundary edge, then to the grid; Alt turns it all off', () => {
    const r = rig(); r.ctl.startFor('tree');
    r.move(-9.5, -9.7); expect(r.last().snapLabel).toBe('SNAP: BOUNDARY VERTEX'); r.click(-9.5, -9.7);
    expect(r.doc().objects[0].geometry).toMatchObject({ p: [LOT[0][0], LOT[0][1]] });
    r.move(10.2, -9.8); expect(r.last().snapLabel).toBe('SNAP: BOUNDARY EDGE'); r.click(10.2, -9.8);
    expect((r.doc().objects[1].geometry as { p: number[] }).p[1]).toBeCloseTo(LOT[0][1], 6);
    r.click(-9.5, -9.7, { alt: true });                                       // Alt: placed exactly where the ray hit
    expect(r.doc().objects[2].geometry).toMatchObject({ p: [O[0] - 9.5, O[1] - 9.7] });
    r.ctl.setGrid(2); r.move(13.4, 12.7); expect(r.last().snapLabel).toBe('SNAP: GRID 2 M'); r.click(13.4, 12.7);
    const p = (r.doc().objects[3].geometry as { p: number[] }).p;
    expect(p[0] % 2).toBe(0); expect(p[1] % 2).toBe(0);
    r.move(13.4, 12.7, { alt: true }); expect(r.last().snapLabel).toBe('');
  });
  it('snaps to another object vertex', () => {
    const r = rig(); r.ctl.startFor('retaining_wall'); r.click(0, 0); r.click(10, 0); r.key('Enter');
    r.ctl.startFor('infiltration_trench'); r.move(10.3, 0.2); expect(r.last().snapLabel).toBe('SNAP: OBJECT VERTEX');
  });
  it('no terrain under the pointer means nothing is placed', () => {
    const r = rig(); r.ctl.startFor('tree'); r.click(500, 500); expect(r.doc().objects).toHaveLength(0);
  });
});

describe('DesignController: select, handles, drag, delete', () => {
  function withWall() {
    const r = rig(); r.ctl.startFor('retaining_wall'); r.click(0, 0); r.click(10, 0); r.click(10, 10); r.key('Enter'); r.ctl.setGrid(0);
    r.root.updateMatrixWorld(true); return r;
  }
  it('selects an object by clicking its line and shows vertex handles and midpoint handles', () => {
    const r = withWall(); r.ctl.select(null); r.ctl.setTool('select');
    r.click(5, 0); expect(r.last().selectedId).toBe('retaining_wall_1');
    expect(r.ctl['handles'].children.filter((c) => c.userData.handle === 'vertex')).toHaveLength(3);
    expect(r.ctl['handles'].children.filter((c) => c.userData.handle === 'mid')).toHaveLength(2);
    r.click(40, 40); expect(r.last().selectedId).toBeNull();                       // empty ground deselects
  });
  it('dragging a vertex handle moves that vertex as one undo step, following the terrain', () => {
    const r = withWall(); r.ctl.setTool('select'); r.ctl.select('retaining_wall_1'); r.root.updateMatrixWorld(true);
    const n = r.ctl.store.history().undoCount;
    expect(r.ctl.pointerDown(r.info(10, 0))).toBe(true);
    r.ctl.pointerMove(r.info(14, 3, { x: 400, y: 300 }));
    expect(r.ctl.store.history().undoCount).toBe(n);                               // preview only: the document has not changed yet
    expect(r.ctl.scene.lastRebuilt).toEqual(['retaining_wall_1']);
    r.ctl.pointerUp(r.info(14, 3, { x: 400, y: 300 }), true);
    expect((r.doc().objects[0].geometry as { pts: number[][] }).pts[1]).toEqual([O[0] + 14, O[1] + 3]);
    expect(r.ctl.store.history()).toMatchObject({ undoCount: n + 1, undoLabel: 'Move vertex' });
    r.ctl.undo(); expect((r.doc().objects[0].geometry as { pts: number[][] }).pts[1]).toEqual([O[0] + 10, O[1]]);
  });
  it('clicking a handle selects the vertex; Delete removes it, then the object', () => {
    const r = withWall(); r.ctl.setTool('select'); r.ctl.select('retaining_wall_1'); r.root.updateMatrixWorld(true);
    r.ctl.pointerDown(r.info(10, 10)); r.ctl.pointerUp(r.info(10, 10), false); expect(r.last().selectedVertex).toBe(2);
    r.key('Delete'); expect((r.doc().objects[0].geometry as { pts: unknown[] }).pts).toHaveLength(2); expect(r.last().selectedVertex).toBeNull();
    r.key('Delete'); expect(r.doc().objects).toHaveLength(0);                       // no vertex selected: deletes the object
    r.ctl.undo(); r.ctl.undo(); expect((r.doc().objects[0].geometry as { pts: unknown[] }).pts).toHaveLength(3);
  });
  it('deleting below the minimum vertex count is refused with a message', () => {
    const r = withWall(); r.ctl.setTool('select'); r.ctl.select('retaining_wall_1'); r.root.updateMatrixWorld(true);
    r.ctl.store.run('edit_vertices', { id: 'retaining_wall_1', action: 'delete', index: 2 }); r.ctl['selVertex'] = 0; r.key('Delete');
    expect(r.last().message).toContain('at least 2'); expect(r.doc().objects).toHaveLength(1);
  });
  it('dragging a midpoint handle inserts a vertex', () => {
    const r = withWall(); r.ctl.setTool('select'); r.ctl.select('retaining_wall_1'); r.root.updateMatrixWorld(true);
    expect(r.ctl.pointerDown(r.info(5, 0))).toBe(true);
    r.ctl.pointerMove(r.info(5, -4, { x: 50, y: -40 })); r.ctl.pointerUp(r.info(5, -4, { x: 50, y: -40 }), true);
    expect((r.doc().objects[0].geometry as { pts: number[][] }).pts).toEqual([[O[0], O[1]], [O[0] + 5, O[1] - 4], [O[0] + 10, O[1]], [O[0] + 10, O[1] + 10]]);
    expect(r.ctl.store.history().undoLabel).toBe('Insert vertex');
  });
  it('dragging the body moves the whole object by one offset, snapping, one undo step', () => {
    const r = withWall(); r.ctl.setTool('select'); r.ctl.select(null); r.root.updateMatrixWorld(true);
    expect(r.ctl.pointerDown(r.info(5, 0))).toBe(true); expect(r.last().selectedId).toBe('retaining_wall_1');
    r.ctl.pointerMove(r.info(8, 3, { x: 80, y: 30 })); r.ctl.pointerUp(r.info(8, 3, { x: 80, y: 30 }), true);
    expect((r.doc().objects[0].geometry as { pts: number[][] }).pts[0]).toEqual([O[0] + 3, O[1] + 3]);
    expect(r.ctl.store.history().undoLabel).toBe('Move object');
    // a press without movement (away from the handles) is only a selection
    const n = r.ctl.store.history().undoCount; r.root.updateMatrixWorld(true); r.ctl.pointerDown(r.info(5, 3)); r.ctl.pointerUp(r.info(5, 3), false);
    expect(r.ctl.store.history().undoCount).toBe(n);
  });
  it('a body drag of a point object, then incremental rebuild touches only that object', () => {
    const r = rig(); r.ctl.startFor('tree'); r.click(5, 5); r.ctl.startFor('stormwater_pit'); r.click(20, 20); r.ctl.setTool('select'); r.root.updateMatrixWorld(true);
    const pitGroup = r.ctl.scene.groupOf('stormwater_pit_2');
    r.ctl.pointerDown(r.info(5, 5)); r.ctl.pointerMove(r.info(7, 5, { x: 90, y: 90 })); r.ctl.pointerUp(r.info(7, 5, { x: 90, y: 90 }), true);
    expect(r.doc().objects[0].geometry).toMatchObject({ p: [O[0] + 7, O[1] + 5] });
    expect(r.ctl.scene.lastRebuilt).toEqual(['tree_1']); expect(r.ctl.scene.groupOf('stormwater_pit_2')).toBe(pitGroup);
  });
  it('R rotates the selected object 15 degrees; Escape cancels a drag and leaves the document alone', () => {
    const r = rig(); r.ctl.startFor('tree'); r.click(5, 5); r.ctl.setTool('select'); r.ctl.select('tree_1'); r.key('KeyR');
    expect(r.doc().objects[0].geometry).toMatchObject({ yaw_deg: 15 });
    r.root.updateMatrixWorld(true); r.ctl.pointerDown(r.info(5, 5)); r.ctl.pointerMove(r.info(9, 9, { x: 500, y: 500 })); r.key('Escape'); r.ctl.pointerUp(r.info(9, 9), true);
    expect(r.doc().objects[0].geometry).toMatchObject({ p: [O[0] + 5, O[1] + 5] });
  });
  it('geometry issues appear on the object: outside the lot, and no terrain', () => {
    const r = rig(); r.ctl.startFor('tree'); r.click(35, 5, { alt: true });
    expect(r.doc().objects[0].issues.map((i) => i.code)).toEqual(['OUTSIDE_LOT']);
    const q = rig({ terrainAvailable: false }); q.ctl.startFor('tree'); q.click(5, 5);
    expect(q.doc().objects[0].issues).toEqual([{ code: 'TERRAIN_UNAVAILABLE', severity: 'warning', message: 'TERRAIN DATA NOT AVAILABLE' }]);
    expect(q.last().terrainAvailable).toBe(false);
  });
  it('leaving design mode cancels any drawing and drag', () => {
    const r = rig(); r.ctl.startFor('retaining_wall'); r.click(0, 0); r.ctl.setActive(false);
    expect(r.ctl.active).toBe(false); expect(r.last().drawing).toBe(false);
  });
});
