/** Stage 4 review fixes. Each test here fails on the code as it was in commit 5cccafc. */
import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
vi.mock('@/lib/viewer/textures', async () => { const T = await import('three'); return { makeSprite: () => new T.Sprite(), makeTextures: () => ({}) }; });
import { DesignController, readoutFor, type DesignState, type PointerInfo } from '@/lib/site/designController';
import { disposeGroup } from '@/lib/site/siteScene';
import { OPS, OpError, runBatch, toolSchemas, applyOp } from '@/lib/site/ops';
import { SiteAutosave, SiteDesignSession, saveSiteDesign, loadSiteDesign, KEEPALIVE_MAX_BYTES, type Endpoint } from '@/lib/site/persist';
import { SiteDesignStore } from '@/lib/site/store';
import { designTerrainMeshes } from '@/lib/site/terrain';
import { emptyDesign, SITE_DESIGN_SCHEMA } from '@/lib/site/types';
import { designShortcutAllowed } from '@/lib/viewer/shortcuts';
import type { Built } from '@/lib/viewer/sceneBuilder';
import { at, seqCtx, doc0 } from './helpers';

const O: [number, number] = [496000, 6650000];
const zOf = (x: number, y: number) => 100 + 0.1 * x + 0.05 * y;
function terrainMesh() {
  const g = new THREE.PlaneGeometry(100, 100, 20, 20); const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) p.setZ(i, zOf(p.getX(i), p.getY(i)));
  g.computeVertexNormals(); const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide })); m.updateMatrixWorld(true); return m;
}
const LOT: [number, number][] = [[O[0] - 10, O[1] - 10], [O[0] + 30, O[1] - 10], [O[0] + 30, O[1] + 30], [O[0] - 10, O[1] + 30]];
function rig(over: { terrainAvailable?: boolean; meshes?: THREE.Mesh[]; mpp?: number; store?: SiteDesignStore } = {}) {
  const root = new THREE.Group(), states: DesignState[] = [], mpp = over.mpp ?? 0.1;
  const ctl = new DesignController({
    built: { root } as unknown as Built, origin: O, terrainMeshes: over.meshes ?? [terrainMesh()], lot: LOT, terrainAvailable: over.terrainAvailable ?? true,
    mpp: () => mpp, setOrbit: () => {}, store: over.store ?? new SiteDesignStore(emptyDesign('p'), seqCtx()), makeLabel: () => new THREE.Sprite(),
  });
  ctl.listener = (s) => states.push(s); ctl.setActive(true);
  const info = (lx: number, ly: number, o: Partial<PointerInfo> = {}): PointerInfo => ({ ray: new THREE.Ray(new THREE.Vector3(lx, ly, 500), new THREE.Vector3(0, 0, -1)), x: lx * 10, y: ly * 10, alt: false, shift: false, button: 0, ...o });
  const move = (lx: number, ly: number, o: Partial<PointerInfo> = {}) => { root.updateMatrixWorld(true); ctl.pointerMove(info(lx, ly, o)); };
  const click = (lx: number, ly: number, o: Partial<PointerInfo> = {}) => { move(lx, ly, o); ctl.pointerDown(info(lx, ly, o)); ctl.pointerUp(info(lx, ly, o), false); };
  return { ctl, root, move, click, info, last: () => states[states.length - 1], doc: () => ctl.store.doc };
}

describe('1. the D shortcut', () => {
  const key = (o: object = {}) => ({ code: 'KeyD', target: { tagName: 'DIV' }, ...o });
  it('toggles Design only outside first person, placing and typing', () => {
    expect(designShortcutAllowed(key(), { fpActive: false, placeActive: false })).toBe(true);
    expect(designShortcutAllowed(key(), { fpActive: true, placeActive: false })).toBe(false);          // D strafes right in first person
    expect(designShortcutAllowed(key(), { fpActive: false, placeActive: true })).toBe(false);
    expect(designShortcutAllowed(key({ target: { tagName: 'INPUT' } }), { fpActive: false, placeActive: false })).toBe(false);
    expect(designShortcutAllowed(key({ target: { tagName: 'TEXTAREA' } }), { fpActive: false, placeActive: false })).toBe(false);
    expect(designShortcutAllowed(key({ target: { tagName: 'DIV', isContentEditable: true } }), { fpActive: false, placeActive: false })).toBe(false);
    expect(designShortcutAllowed(key({ ctrlKey: true }), { fpActive: false, placeActive: false })).toBe(false);
    expect(designShortcutAllowed(key({ repeat: true }), { fpActive: false, placeActive: false })).toBe(false);
    expect(designShortcutAllowed(key(), null)).toBe(false);
    expect(designShortcutAllowed({ code: 'KeyF', target: null }, { fpActive: false, placeActive: false })).toBe(false);
  });
});

describe('2. design tools are read only until the saved design has loaded', () => {
  function deferredServer() {
    let resolve!: (r: Response) => void; const calls: string[] = [];
    const f = vi.fn((_u: string, init?: RequestInit) => { calls.push(init?.method ?? 'GET'); return new Promise<Response>((res) => { if ((init?.method ?? 'GET') === 'GET') resolve = res; else res(new Response(JSON.stringify({ schema: SITE_DESIGN_SCHEMA, version: 5, objects: [] }), { status: 200 })); }); });
    return { f: f as unknown as typeof fetch, calls, resolve: (r: Response) => resolve(r) };
  }
  const mk = (s: ReturnType<typeof deferredServer>) => {
    const ep: Endpoint = { base: 'http://api', projectId: 'abc', fetchImpl: s.f }, store = new SiteDesignStore(emptyDesign('abc'), seqCtx()), a = new SiteAutosave(store, ep, 5);
    return { store, a, ses: new SiteDesignSession(store, a, ep) };
  };
  it('edits are refused while loading, and the loaded document then replaces the empty one without losing anything', async () => {
    const s = deferredServer(), { store, ses } = mk(s);
    expect(store.locked).toBe('LOADING SAVED DESIGN');
    expect(() => store.run('add_object', { type: 'tree', points: [at(1, 1)] })).toThrow(OpError);
    expect(() => store.runBatch('x', [{ op: 'add_object', args: { type: 'tree', points: [at(1, 1)] } }])).toThrow(OpError);
    expect(store.undo()).toBe(false); expect(store.doc.objects).toHaveLength(0);
    const p = ses.load();
    s.resolve(new Response(JSON.stringify({ schema: SITE_DESIGN_SCHEMA, version: 5, objects: [] }), { status: 200 })); await p;
    expect(ses.state.phase).toBe('ready'); expect(store.locked).toBeNull(); expect(store.doc.version).toBe(5);
    expect(() => store.run('add_object', { type: 'tree', points: [at(1, 1)] })).not.toThrow();
  });
  it('a failed load keeps the tools read only and shows the error; a new local document needs the explicit confirmation', async () => {
    const s = deferredServer(), { store, a, ses } = mk(s);
    const p = ses.load(); s.resolve(new Response('boom', { status: 500 })); await p;
    expect(ses.state.phase).toBe('failed'); expect(ses.state.error).toContain('SAVED DESIGN COULD NOT BE LOADED'); expect(ses.state.error).toContain('500');
    expect(store.locked).toContain('COULD NOT BE LOADED'); expect(() => store.run('add_object', { type: 'tree', points: [at(1, 1)] })).toThrow(OpError);
    ses.confirmLocal();
    expect(ses.state).toMatchObject({ phase: 'ready', local: true }); expect(store.locked).toBeNull();
    store.run('add_object', { type: 'tree', points: [at(1, 1)] }); await a.flush();
    expect(s.calls).toEqual(['GET', 'PUT']);                                                     // autosave runs under the normal version check
    a.stop();
  });
  it('confirmLocal does nothing unless the load failed', async () => {
    const s = deferredServer(), { store, ses } = mk(s);
    ses.confirmLocal(); expect(store.locked).toBe('LOADING SAVED DESIGN');
  });
  it('the controller reports the lock, refuses drawing tools and dragging, and the panel state is updated', () => {
    const store = new SiteDesignStore(emptyDesign('p'), seqCtx()); store.lock('LOADING SAVED DESIGN');
    const r = rig({ store });
    expect(r.last().locked).toBe('LOADING SAVED DESIGN');
    r.ctl.startFor('tree'); expect(r.last().tool).toBe('select'); expect(r.last().message).toBe('LOADING SAVED DESIGN');
    r.ctl.undo(); expect(r.doc().objects).toHaveLength(0);
    store.unlock(); expect(r.last().locked).toBeNull();
    r.ctl.startFor('tree'); expect(r.last().tool).toBe('place');
    r.click(5, 5); expect(r.doc().objects).toHaveLength(1);
    store.lock('LOADING SAVED DESIGN'); r.ctl.setTool('select'); r.root.updateMatrixWorld(true);
    expect(r.ctl.pointerDown(r.info(5, 5))).toBe(false);                                         // selected, but no drag begins
  });
});

describe('3. surface length needs real terrain; design ground is terrain parts only', () => {
  it('readoutFor gives a null surface length when the terrain is not available, but keeps the plan length', () => {
    const r = readoutFor('polyline', [[0, 0], [3, 4]], () => 10, true, false)!;
    expect(r.surfaceLength).toBeNull(); expect(r.planLength).toBeCloseTo(5, 9);
    expect(readoutFor('polyline', [[0, 0], [3, 4]], () => 10, true, true)!.surfaceLength).toBeCloseTo(5, 9);
  });
  it('the controller passes the availability: a placeholder ground gives no surface length', () => {
    const r = rig({ terrainAvailable: false }); r.ctl.startFor('retaining_wall'); r.click(0, 0); r.click(10, 0); r.move(10, 10);
    expect(r.last().readout).toMatchObject({ kind: 'polyline' }); expect(r.last().readout!.surfaceLength).toBeNull(); expect(r.last().readout!.planLength).toBeCloseTo(20, 6);
  });
  it('terrain is unavailable when there is no terrain mesh', () => {
    const r = rig({ meshes: [] }); expect(r.last().terrainAvailable).toBe(false);
  });
  it('design ground is surface, existing and context parts only, never buildings, aerial or items; no fallback', () => {
    const mk = (c: string, name = c) => ({ userData: { c, name } });
    const all = [mk('surface'), mk('existing'), mk('context'), mk('buildings'), mk('aerial'), mk('items'), mk('cutfill'), mk('road'), mk('surface', 'Other_surface')];
    expect(designTerrainMeshes(all).map((m) => m.userData.c)).toEqual(['surface', 'existing', 'context', 'surface']);
    expect(designTerrainMeshes(all, ['Other_surface', 'buildings']).map((m) => m.userData.name)).toEqual(['Other_surface']);     // a named part must also be ground
    expect(designTerrainMeshes([mk('buildings'), mk('aerial'), mk('items')])).toEqual([]);                                     // none: terrain unavailable
  });
});

describe('4. a vertex drag keeps its RL', () => {
  it('moving a vertex that has z keeps z; a vertex without z stays draped', () => {
    const r = rig(); r.ctl.store.run('add_object', { type: 'retaining_wall', points: [at(0, 0), { ...at(10, 0), z: 150.5 }, at(10, 10)] });
    r.ctl.setTool('select'); r.ctl.select('retaining_wall_1'); r.ctl.setGrid(0); r.root.updateMatrixWorld(true);
    r.ctl.pointerDown(r.info(10, 0)); r.ctl.pointerMove(r.info(14, 3, { x: 400, y: 300 })); r.ctl.pointerUp(r.info(14, 3, { x: 400, y: 300 }), true);
    expect((r.doc().objects[0].geometry as { pts: number[][] }).pts[1]).toEqual([O[0] + 14, O[1] + 3, 150.5]);
    r.root.updateMatrixWorld(true);
    r.ctl.pointerDown(r.info(10, 10)); r.ctl.pointerMove(r.info(12, 12, { x: 400, y: 300 })); r.ctl.pointerUp(r.info(12, 12, { x: 400, y: 300 }), true);
    expect((r.doc().objects[0].geometry as { pts: number[][] }).pts[2]).toEqual([O[0] + 12, O[1] + 12]);
  });
});

describe('5, 6, 15. operations', () => {
  const withTree = () => { const s = new SiteDesignStore(doc0(), seqCtx()); s.run('add_object', { type: 'tree', points: [at(1, 1)] }); return s; };
  it('refuses prototype keys with an OpError', () => {
    const s = withTree();
    for (const key of ['__proto__', 'constructor', 'prototype']) {
      expect(() => s.run('set_param', { id: 'tree_1', key, value: 1 })).toThrow(OpError);
      expect(() => s.run('remove_param', { id: 'tree_1', key })).toThrow(OpError);
    }
    expect(() => applyOp(s.doc, 'add_object', { type: 'tree', points: [at(2, 2)], params: { constructor: { value: 1, basis: 'user' } } })).toThrow(OpError);
    expect(Object.keys(s.doc.objects[0].params)).toEqual([]);
  });
  it('runBatch reports a PatchError or any other failure of one step and carries on', () => {
    const s = withTree();
    OPS.__bad_patch = { label: 'bad', description: '', params: {}, required: [], run: () => ({ patch: [{ op: 'replace', path: '/objects/9/status', value: 'x' }], result: {} }) };
    OPS.__throws = { label: 'bad', description: '', params: {}, required: [], run: () => { throw new TypeError('boom'); } };
    try {
      const r = runBatch(s.doc, [
        { op: 'set_param', args: { id: 'tree_1', key: 'height_m', value: 5 } }, { op: '__bad_patch' }, { op: 'set_param', args: { id: 'tree_1', key: 'constructor', value: 1 } },
        { op: '__throws' }, { op: 'set_param', args: { id: 'tree_1', key: 'canopy_diameter_m', value: 3 } },
      ], seqCtx());
      expect(r.results.map((x) => x.ok)).toEqual([true, false, false, false, true]);
      expect(r.results[1]).toMatchObject({ ok: false, error: expect.stringContaining('out of range') }); expect(r.results[3]).toMatchObject({ ok: false, error: 'boom' });
      expect(Object.keys(r.doc.objects[0].params)).toEqual(['height_m', 'canopy_diameter_m']);
    } finally { delete OPS.__bad_patch; delete OPS.__throws; }
  });
  it('allows 64 parameters and refuses the 65th (replacing an existing one is still fine)', () => {
    const s = withTree();
    for (let i = 0; i < 64; i++) s.run('set_param', { id: 'tree_1', key: `k${i}`, value: i });
    expect(Object.keys(s.doc.objects[0].params)).toHaveLength(64);
    expect(() => s.run('set_param', { id: 'tree_1', key: 'one_more', value: 1 })).toThrow(/at most 64/);
    expect(() => s.run('set_param', { id: 'tree_1', key: 'k3', value: 99 })).not.toThrow();
    expect(Object.keys(s.doc.objects[0].params)).toHaveLength(64);
  });
  it('remove_param removes a parameter as one undo step and undo restores it exactly', () => {
    const s = withTree(); s.run('set_param', { id: 'tree_1', key: 'height_m', value: 8, basis: 'lga_rule', ref: 'tree.h' });
    const before = s.doc.objects[0].params.height_m;
    s.run('remove_param', { id: 'tree_1', key: 'height_m' }); expect(s.doc.objects[0].params).toEqual({});
    expect(s.history().undoLabel).toBe('Remove parameter');
    s.undo(); expect(s.doc.objects[0].params.height_m).toEqual(before);
    s.redo(); expect(s.doc.objects[0].params).toEqual({});
    expect(() => s.run('remove_param', { id: 'tree_1', key: 'height_m' })).toThrow(/no parameter/);
  });
  it('the tool schemas list remove_param and give index an integer type', () => {
    const t = Object.fromEntries(toolSchemas().map((x) => [x.name, x]));
    expect(t.remove_param.input_schema.required).toEqual(['id', 'key']); expect(t.set_param).toBeTruthy();
    expect(t.edit_vertices.input_schema.properties.index.type).toBe('integer');
    for (const x of Object.values(t)) for (const [k, p] of Object.entries(x.input_schema.properties)) if (/index/.test(k)) expect(p.type).toBe('integer');
  });
});

describe('8, 9. persistence', () => {
  const doc = () => ({ ...emptyDesign('abc'), version: 0 });
  it('the unload flush uses a keepalive request; a normal flush does not', async () => {
    const calls: RequestInit[] = [];
    const f = vi.fn(async (_u: string, init?: RequestInit) => { calls.push(init!); return new Response(JSON.stringify({ schema: SITE_DESIGN_SCHEMA, version: 1, objects: [] }), { status: 200 }); });
    const ep: Endpoint = { base: 'http://api', projectId: 'abc', headers: { 'X-User-Id': 'u' }, fetchImpl: f as unknown as typeof fetch };
    const store = new SiteDesignStore(emptyDesign('abc'), seqCtx()), a = new SiteAutosave(store, ep, 10_000); a.start();
    store.run('add_object', { type: 'tree', points: [at(1, 1)] }); await a.flush({ keepalive: true });
    expect(calls[0].keepalive).toBe(true); expect(calls[0].headers).toMatchObject({ 'X-User-Id': 'u' });                // the auth header is kept
    store.run('add_object', { type: 'tree', points: [at(2, 2)] }); await a.flush(); expect(calls[1].keepalive).toBeUndefined(); a.stop();
  });
  it('a body over the keepalive size limit falls back to a normal request', async () => {
    const calls: RequestInit[] = []; const f = (async (_u: string, init?: RequestInit) => { calls.push(init!); return new Response(JSON.stringify({ schema: SITE_DESIGN_SCHEMA, version: 1, objects: [] }), { status: 200 }); }) as unknown as typeof fetch;
    const big = { ...doc(), project_id: 'x'.repeat(KEEPALIVE_MAX_BYTES + 10) };
    await saveSiteDesign({ base: 'b', projectId: 'abc', fetchImpl: f }, big, { keepalive: true }); expect(calls[0].keepalive).toBeUndefined();
  });
  it('resolve() returns the error text instead of swallowing it, and null on success', async () => {
    const fail = (async () => new Response('x', { status: 503 })) as unknown as typeof fetch;
    const store = new SiteDesignStore(emptyDesign('abc'), seqCtx()), a = new SiteAutosave(store, { base: 'b', projectId: 'abc', fetchImpl: fail }, 10);
    const e1 = await a.resolve('reload'); expect(e1).toContain('COULD NOT BE RELOADED'); expect(e1).toContain('503');
    const e2 = await a.resolve('keep'); expect(e2).toContain('COULD NOT BE CHECKED');
    const ok = (async () => new Response(JSON.stringify({ schema: SITE_DESIGN_SCHEMA, version: 2, objects: [] }), { status: 200 })) as unknown as typeof fetch;
    const b = new SiteAutosave(store, { base: 'b', projectId: 'abc', fetchImpl: ok }, 10); expect(await b.resolve('reload')).toBeNull();
    await expect(loadSiteDesign({ base: 'b', projectId: 'abc', fetchImpl: fail })).rejects.toThrow();
  });
});

describe('10, 11. disposal', () => {
  it('cancelling a tool disposes the ghost geometries and materials', () => {
    const r = rig(); r.ctl.startFor('tree');
    const ghost = r.ctl['ghost']!, geoms: THREE.BufferGeometry[] = [], mats: THREE.Material[] = [];
    ghost.traverse((o) => { const m = o as THREE.Mesh; if (m.geometry) geoms.push(m.geometry); if (m.material) mats.push(m.material as THREE.Material); });
    expect(geoms.length).toBeGreaterThanOrEqual(3);
    const gs = geoms.map((g) => vi.spyOn(g, 'dispose')), ms = mats.map((m) => vi.spyOn(m, 'dispose'));
    r.ctl.setTool('select');
    for (const s of [...gs, ...ms]) expect(s).toHaveBeenCalled();
    expect(r.ctl['ghost']).toBeNull();
  });
  it('disposeGroup keeps the shared Sprite geometry but frees the sprite material and texture', () => {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.Texture() })), shared = vi.spyOn(sp.geometry, 'dispose');
    const mat = vi.spyOn(sp.material, 'dispose'), tex = vi.spyOn(sp.material.map!, 'dispose');
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial()), own = vi.spyOn(mesh.geometry, 'dispose');
    const g = new THREE.Group(); g.add(sp, mesh); disposeGroup(g);
    expect(shared).not.toHaveBeenCalled(); expect(mat).toHaveBeenCalled(); expect(tex).toHaveBeenCalled(); expect(own).toHaveBeenCalled();
  });
});

describe('12. a hidden design layer cannot be picked, dragged or snapped to', () => {
  it('no pick, no handles, no drag and no object snap targets while the layer is off', () => {
    const r = rig(); r.ctl.startFor('retaining_wall'); r.click(0, 0); r.click(10, 0); r.ctl.finishDrawing(); r.ctl.setGrid(0);
    r.ctl.setTool('select'); r.ctl.select(null); r.root.updateMatrixWorld(true);
    r.ctl.scene.group.visible = false;
    expect(r.ctl.pointerDown(r.info(5, 0))).toBe(false); r.ctl.pointerUp(r.info(5, 0), false); expect(r.last().selectedId).toBeNull();      // not pickable
    r.ctl.scene.group.visible = true; r.ctl.select('retaining_wall_1'); r.root.updateMatrixWorld(true); r.ctl.frame();
    expect(r.ctl['handles'].visible).toBe(true);
    r.ctl.scene.group.visible = false; r.ctl.frame(); expect(r.ctl['handles'].visible).toBe(false);
    expect(r.ctl.pointerDown(r.info(10, 0))).toBe(false);                                                      // handle not draggable
    r.ctl.startFor('tree'); r.move(10.3, 0.2); expect(r.last().snapLabel).toBe('');                            // not a snap target
    r.ctl.scene.group.visible = true; r.move(10.3, 0.2); expect(r.last().snapLabel).toBe('SNAP: OBJECT VERTEX');
  });
  it('the lot boundary stays a snap target while the layer is off', () => {
    const r = rig(); r.ctl.scene.group.visible = false; r.ctl.startFor('tree'); r.move(-9.5, -9.7); expect(r.last().snapLabel).toBe('SNAP: BOUNDARY VERTEX');
  });
});

describe('13. double click finishing', () => {
  it('drops a final vertex within the pixel capture radius of the previous one, keeps a farther one', () => {
    const r = rig({ mpp: 0.1 });                                                       // 10 px = 1 m
    r.ctl.startFor('stormwater_pipe'); r.click(0, 0, { alt: true }); r.click(8, 0, { alt: true }); r.click(8.4, 0.2, { alt: true }); r.ctl.doubleClick();
    expect((r.doc().objects[0].geometry as { pts: unknown[] }).pts).toHaveLength(2);
    r.ctl.startFor('stormwater_pipe'); r.click(0, 5, { alt: true }); r.click(8, 5, { alt: true }); r.click(10, 5, { alt: true }); r.ctl.doubleClick();
    expect((r.doc().objects[1].geometry as { pts: unknown[] }).pts).toHaveLength(3);          // 2 m away: a real vertex
  });
  it('scales with the camera: the same pixel gap is a larger distance when zoomed out', () => {
    const r = rig({ mpp: 0.5 });                                                       // 10 px = 5 m
    r.ctl.startFor('stormwater_pipe'); r.click(0, 0, { alt: true }); r.click(8, 0, { alt: true }); r.click(11, 0, { alt: true }); r.ctl.doubleClick();
    expect((r.doc().objects[0].geometry as { pts: unknown[] }).pts).toHaveLength(2);
  });
  it('a polygon closed by double click also loses a near duplicate last vertex', () => {
    const r = rig({ mpp: 0.1 });
    r.ctl.startFor('landscape_area'); for (const [x, y] of [[0, 0], [10, 0], [10, 10], [10.3, 10.2]]) r.click(x, y, { alt: true });
    r.ctl.doubleClick(); expect((r.doc().objects[0].geometry as { ring: unknown[] }).ring).toHaveLength(3);
  });
});
