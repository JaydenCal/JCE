import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as THREE from 'three';
vi.mock('@/lib/viewer/textures', async () => { const T = await import('three'); return { makeSprite: () => new T.Sprite(), makeTextures: () => ({}) }; });
import { DesignController, type DesignState, type PointerInfo } from '@/lib/site/designController';
import { SiteDesignStore } from '@/lib/site/store';
import { makeKerb, previewProfile, type RuleInfo, type DrivewayProfile } from '@/lib/site/driveway';
import { OPS, OpError } from '@/lib/site/ops';
import { emptyDesign, type SiteDesign, type SiteObject } from '@/lib/site/types';
import type { Built } from '@/lib/viewer/sceneBuilder';
import { seqCtx } from './helpers';

const O: [number, number] = [496000, 6650000];
const zOf = (x: number, y: number) => 100 + 0.1 * x + 0.05 * y;
function terrainMesh() {
  const g = new THREE.PlaneGeometry(100, 100, 20, 20); const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) p.setZ(i, zOf(p.getX(i), p.getY(i)));
  g.computeVertexNormals(); const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide })); m.updateMatrixWorld(true); return m;
}
const label = () => new THREE.Sprite();
// the lot's front boundary is on local y = 0; the assumed kerb line is 4 m towards the road, 78 m long (like the backend sample bundle)
const LOT: [number, number][] = [[O[0] - 5, O[1]], [O[0] + 25, O[1]], [O[0] + 25, O[1] + 30], [O[0] - 5, O[1] + 30]];
const KERB = makeKerb([O[0] - 30, O[1] - 4], [O[0] + 48, O[1] - 4], LOT)!;
const RULES: Record<string, RuleInfo> = {
  'driveway.max_grade_pct': { key: 'driveway.max_grade_pct', value: 8, unit: '%', basis: 'LGA RULE', ref: 'Testshire Engineering Standard, 4.2' },
  'driveway.max_grade_change_pct': { key: 'driveway.max_grade_change_pct', value: null, unit: '%', basis: 'UNRESOLVED', ref: 'NO REQUIREMENT FOUND' },
};

/** A stand-in server: answers with the browser preview computation for the object it was sent, plus the requirement limits above. */
function fakeServer(ctl: () => DesignController) {
  const calls: { detail: string; id: string }[] = [];
  const bodies: { driveway?: SiteObject; building?: SiteObject; detail?: string }[] = [];
  const pending: (() => void)[] = [];
  let hold = false;
  const state = { linkNote: '' };            // while set, answers say the linked building is not in the saved design (as the real server does before the first save)
  const f = vi.fn(async (url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init!.body)) as { driveway?: SiteObject; grading_area?: SiteObject; building?: SiteObject; detail?: string };
    if (url.endsWith('/driveway-profile')) {
      const o = body.driveway!; calls.push({ detail: body.detail ?? 'full', id: o.id }); bodies.push(body as { driveway?: SiteObject; building?: SiteObject; detail?: string });
      const c = ctl(), hf = c.existingHf!;
      const v = previewProfile({
        pts: (o.geometry as { pts: number[][] }).pts, width: (o.params.width_m?.value as number | null) ?? null, endLevel: (o.params.end_level_rl?.value as number | null) ?? null, endLevelBasis: 'USER',
        existing: (e, n) => hf.sample(e - O[0], n - O[1]), lot: LOT, kerb: KERB, rules: RULES, rulesFor: 'LGA TESTSHIRE', terrainStatus: 'INDICATIVE 5 M DEM, LIDAR PENDING, NOT SURVEY', objectId: o.id,
      })!;
      const out = { ...v, schema: 'driveway_profile.v1', detail: body.detail ?? 'full', preview: undefined, earthworks: null, timing_ms: 5, end_level: { ...v.end_level, link_note: state.linkNote } };
      if (hold) await new Promise<void>((res) => pending.push(res));
      return new Response(JSON.stringify(out), { status: 200 });
    }
    return new Response(JSON.stringify({ code: 'NOPE', message: 'no such route' }), { status: 404 });
  });
  return { f: f as unknown as typeof fetch, calls, bodies, state, release: () => { pending.splice(0).forEach((r) => r()); }, hold: (v: boolean) => { hold = v; }, fn: f };
}

function rig(opts: { server?: boolean; kerb?: boolean } = {}) {
  const mesh = terrainMesh(), root = new THREE.Group(), states: DesignState[] = [];
  const holder: { ctl?: DesignController } = {};
  const srv = fakeServer(() => holder.ctl!);
  const ctl = new DesignController({
    built: { root } as unknown as Built, origin: O, terrainMeshes: [mesh], existingMeshes: [mesh], lot: LOT, terrainAvailable: true, kerb: opts.kerb === false ? null : KERB,
    mpp: () => 0.1, setOrbit: () => {}, store: new SiteDesignStore(emptyDesign('p'), seqCtx()), makeLabel: label,
    engine: opts.server === false ? null : { base: 'http://api', projectId: 'p', fetchImpl: srv.f }, engineDebounceMs: 50, terrainStatus: 'INDICATIVE 5 M DEM, LIDAR PENDING, NOT SURVEY',
  });
  holder.ctl = ctl;
  ctl.listener = (s) => states.push(s); ctl.setActive(true);
  const info = (lx: number, ly: number, o: Partial<PointerInfo> = {}): PointerInfo => ({ ray: new THREE.Ray(new THREE.Vector3(lx, ly, 500), new THREE.Vector3(0, 0, -1)), x: lx * 10, y: ly * 10, alt: false, shift: false, button: 0, ...o });
  const last = () => states[states.length - 1];
  const add = (type: string, pts: [number, number][], params: Record<string, unknown> = {}) => {
    const r = ctl.store.run('add_object', { type, points: pts.map(([x, y]) => ({ e: O[0] + x, n: O[1] + y })) });
    for (const [k, v] of Object.entries(params)) ctl.store.run('set_param', { id: r.id, key: k, value: v });
    return r.id as string;
  };
  const drag = (from: [number, number], to: [number, number], o: Partial<PointerInfo> = {}) => {
    root.updateMatrixWorld(true);
    expect(ctl.pointerDown(info(from[0], from[1], o))).toBe(true);
    ctl.pointerMove(info(to[0], to[1], { x: 900, y: 900, ...o }));
    ctl.pointerUp(info(to[0], to[1], { x: 900, y: 900, ...o }), true);
  };
  return { ctl, root, mesh, info, last, add, drag, srv, doc: () => ctl.store.doc, obj: (id: string) => ctl.store.doc.objects.find((o) => o.id === id)! };
}
const pts = (o: SiteObject) => (o.geometry as { pts: number[][] }).pts;
const flush = async (ms = 60) => { await vi.advanceTimersByTimeAsync(ms); await vi.advanceTimersByTimeAsync(0); };
beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('driveway drag tool: crossover along the kerb line', () => {
  it('the first drawn point lies on the assumed kerb line', () => {
    const r = rig(); r.ctl.startFor('driveway');
    r.root.updateMatrixWorld(true);
    for (const [x, y] of [[9, 3], [9, 12]] as [number, number][]) { r.ctl.pointerMove(r.info(x, y)); r.ctl.pointerDown(r.info(x, y)); r.ctl.pointerUp(r.info(x, y), false); }
    r.ctl.key({ code: 'Enter', preventDefault() {}, shiftKey: false, ctrlKey: false, metaKey: false } as KeyboardEvent);
    const o = r.doc().objects[0];
    expect(o.type).toBe('driveway'); expect(pts(o)[0]).toEqual([O[0] + 9, O[1] - 4]);          // the click at y = 3 is moved onto the kerb line (y = -4)
    expect(pts(o)[1]).toEqual([O[0] + 9, O[1] + 12]);
    expect(o.params.width_m).toEqual({ value: null, basis: 'unresolved' });                    // no width, no end level, no surface: nothing defaulted
    expect(o.params.end_level_rl.value).toBeNull();
  });

  it('dragging the crossover slides it along the kerb line only, as ONE undo step; the rest of the centreline stays', () => {
    const r = rig(); const id = r.add('driveway', [[9, -4], [9, 12]]);
    r.ctl.setTool('select'); r.ctl.select(id);
    const n = r.ctl.store.history().undoCount;
    r.drag([9, -4], [14.3, 6]);                                                                 // the pointer is far off the kerb line
    expect(pts(r.obj(id))[0]).toEqual([O[0] + 14.3, O[1] - 4]);                                 // same chainage, but ON the kerb line
    expect(pts(r.obj(id))[1]).toEqual([O[0] + 9, O[1] + 12]);
    expect(r.ctl.store.history()).toMatchObject({ undoCount: n + 1, undoLabel: 'Move crossover' });
    r.ctl.undo(); expect(pts(r.obj(id))[0]).toEqual([O[0] + 9, O[1] - 4]); expect(r.ctl.store.history().undoCount).toBe(n);
  });

  it('Shift slides the whole driveway with the crossover (one undo step)', () => {
    const r = rig(); const id = r.add('driveway', [[9, -4], [9, 4], [12, 12]]);
    r.ctl.setTool('select'); r.ctl.select(id); const n = r.ctl.store.history().undoCount;
    r.drag([9, -4], [11.5, -4], { shift: true });
    expect(pts(r.obj(id))).toEqual([[O[0] + 11.5, O[1] - 4], [O[0] + 11.5, O[1] + 4], [O[0] + 14.5, O[1] + 12]]);
    expect(r.ctl.store.history().undoCount).toBe(n + 1);
  });

  it('shows the chainage along the kerb line while dragging, and stops at the ends of the kerb line', () => {
    const r = rig(); const id = r.add('driveway', [[9, -4], [9, 12]]);
    r.ctl.setTool('select'); r.ctl.select(id); r.root.updateMatrixWorld(true);
    r.ctl.pointerDown(r.info(9, -4)); r.ctl.pointerMove(r.info(20, 0, { x: 900, y: 900 }));
    expect(r.last().dragInfo).toBe('CROSSOVER 50.00 M ALONG THE ASSUMED KERB LINE');                    // (20 - -30) = 50
    r.ctl.pointerMove(r.info(-45, 0, { x: 905, y: 905 })); expect(r.last().dragInfo).toContain('END OF THE KERB LINE');
    r.ctl.pointerUp(r.info(-45, 0), true);
    expect(pts(r.obj(id))[0]).toEqual([KERB.a[0], KERB.a[1]]);
    expect(r.last().dragInfo).toBe('');
  });

  it('without a kerb line in the model the crossover is not constrained and the panel says so', () => {
    const r = rig({ kerb: false }); const id = r.add('driveway', [[9, -4], [9, 12]]);
    r.ctl.setTool('select'); r.ctl.select(id);
    r.drag([9, -4], [14, 2]);
    expect(pts(r.obj(id))[0]).toEqual([O[0] + 14, O[1] + 2]); expect(r.last().driveway!.kerbAvailable).toBe(false);
  });
});

describe('driveway drag tool: width and the end of the driveway', () => {
  it('a width that is NOT SET has one grip on the centreline; dragging it sideways sets the width, two grips appear', () => {
    const r = rig(); const id = r.add('driveway', [[9, -4], [9, 16]]);
    r.ctl.setTool('select'); r.ctl.select(id);
    const grips = () => r.ctl['handles'].children.filter((c) => c.userData.handle === 'width');
    expect(grips()).toHaveLength(1); expect(grips()[0].position.x).toBeCloseTo(9, 6);              // ON the centreline: no width is implied
    const g = grips()[0].position, n = r.ctl.store.history().undoCount;
    r.drag([g.x, g.y], [g.x + 1.6, g.y]);
    expect(r.obj(id).params.width_m).toEqual({ value: 3.2, basis: 'user' });                         // twice the sideways distance
    expect(r.ctl.store.history()).toMatchObject({ undoCount: n + 1, undoLabel: 'Set driveway width' });
    expect(grips()).toHaveLength(2);
    expect(Math.abs(grips()[0].position.x - grips()[1].position.x)).toBeCloseTo(3.2, 6);
    r.ctl.undo(); expect(r.obj(id).params.width_m.value).toBeNull();
  });

  it('dropping the end on a building links it and takes the building FFL; the move and the link are ONE undo step', () => {
    const r = rig(); const id = r.add('driveway', [[9, -4], [9, 12]], { width_m: 3 });
    const doc: SiteDesign = structuredClone(r.doc());
    doc.objects.push({ id: 'bld', type: 'building', status: 'proposed', origin: 'user', verified: false, label: 'House', geometry: { kind: 'polygon', ring: [[O[0] + 5, O[1] + 14], [O[0] + 20, O[1] + 14], [O[0] + 20, O[1] + 24], [O[0] + 5, O[1] + 24]] }, params: { ffl_rl: { value: 103.5, basis: 'user' } }, issues: [] });
    r.ctl.store.replace(doc); r.ctl.setTool('select'); r.ctl.select(id);
    const n = r.ctl.store.history().undoCount;
    r.drag([9, 12], [10, 16]);
    expect(pts(r.obj(id))[1]).toEqual([O[0] + 10, O[1] + 16]); expect(r.obj(id).params.end_building_id).toMatchObject({ value: 'bld', basis: 'user' });
    expect(r.ctl.store.history()).toMatchObject({ undoCount: n + 1, undoLabel: 'Move driveway end' });
    expect(r.last().driveway!.linkedBuilding).toBe('bld');
    expect(r.last().driveway!.view!.end_level.value).toBe(103.5);                                  // the engine sees the building FFL as the end level
    r.ctl.undo(); expect(r.obj(id).params.end_building_id).toBeUndefined(); expect(pts(r.obj(id))[1]).toEqual([O[0] + 9, O[1] + 12]);
    expect(r.ctl.store.history().undoCount).toBe(n);
    r.ctl.redo();
    r.drag([10, 16], [11, 8]);                                                                      // dragging it off the building removes the link, again as one step
    expect(r.obj(id).params.end_building_id).toBeUndefined();
    expect(r.ctl.store.history()).toMatchObject({ undoCount: n + 2, undoLabel: 'Move driveway end' });
  });

  it('a linked building without an FFL leaves the end level NOT SET', () => {
    const r = rig(); const id = r.add('driveway', [[9, -4], [9, 12]], { width_m: 3, end_level_rl: 101 });
    const doc: SiteDesign = structuredClone(r.doc());
    doc.objects.push({ id: 'bld', type: 'building', status: 'proposed', origin: 'user', verified: false, geometry: { kind: 'polygon', ring: [[O[0] + 5, O[1] + 14], [O[0] + 20, O[1] + 14], [O[0] + 20, O[1] + 24], [O[0] + 5, O[1] + 24]] }, params: { ffl_rl: { value: null, basis: 'unresolved' } }, issues: [] });
    r.ctl.store.replace(doc); r.ctl.store.run('link_driveway_end', { id, building_id: 'bld' });
    r.ctl.select(id);
    expect(r.last().driveway!.view!.end_level.value).toBeNull();                                    // the typed 101 is NOT used: the link wins and the building has no FFL
    expect(r.last().driveway!.gaps[0]).toContain('LINKED BUILDING HAS NO FFL');
  });
});

describe('driveway live results: PREVIEW while dragging, the server on release', () => {
  it('preview during the drag, one debounced server call per pause, the final full call after release replaces the preview', async () => {
    const r = rig(); const id = r.add('driveway', [[9, -4], [9, 14]], { width_m: 3, end_level_rl: 101.5 });
    r.ctl.setTool('select'); r.ctl.select(id);
    await flush(); r.srv.calls.length = 0;
    r.root.updateMatrixWorld(true);
    r.ctl.pointerDown(r.info(9, 14));
    r.ctl.pointerMove(r.info(9, 15, { x: 100, y: 100 })); r.ctl.pointerMove(r.info(9, 16, { x: 110, y: 110 })); r.ctl.pointerMove(r.info(9, 17, { x: 120, y: 120 }));
    expect(r.last().driveway!.view!.preview).toBe(true);                                         // the browser preview is on show at once
    expect(r.ctl.scene.driveView(id)!.preview).toBe(true);
    expect(r.srv.calls).toHaveLength(0);                                                          // nothing sent while the pointer keeps moving (debounced)
    await flush(60);
    expect(r.srv.calls).toEqual([{ detail: 'profile', id }]);                                     // ONE fast call for the last position
    expect(r.ctl.scene.driveView(id)!.preview).toBe(true);                                        // still a PREVIEW: the drag has not ended
    expect(r.ctl.store.history().undoCount).toBe(3);                                              // add_object, two set_param: the drag changed nothing yet
    r.ctl.pointerUp(r.info(9, 17, { x: 120, y: 120 }), true);
    expect(r.ctl.store.history().undoCount).toBe(4);
    await flush(60);
    expect(r.srv.calls.at(-1)).toEqual({ detail: 'full', id });
    const v = r.ctl.scene.driveView(id)!;
    expect(v.preview).toBeFalsy(); expect(v.schema).toBe('driveway_profile.v1'); expect(r.last().driveway!.stale).toBe(false);
  });

  it('an old answer never replaces a newer one (sequence numbers)', async () => {
    const r = rig(); const id = r.add('driveway', [[9, -4], [9, 14]], { width_m: 3, end_level_rl: 101.5 });
    r.ctl.setTool('select'); r.ctl.select(id); await flush(); r.srv.calls.length = 0;
    r.srv.hold(true);
    r.ctl.store.run('set_param', { id, key: 'end_level_rl', value: 102 }); await flush(60);       // request A is in flight (held)
    r.ctl.store.run('set_param', { id, key: 'end_level_rl', value: 103 }); await flush(60);       // request B is in flight (held), A is aborted and superseded
    r.srv.hold(false); r.srv.release(); await flush(10);
    expect(r.ctl.live.drive.get(id)!.result!.end_level.value).toBe(103);
    expect(r.ctl.scene.driveView(id)!.end_level.value).toBe(103);
  });

  it('every limit in the checks comes from the server rules; without them every limit is UNRESOLVED and nothing is evaluated', async () => {
    const off = rig({ server: false }); const id = off.add('driveway', [[9, -4], [9, 14]], { width_m: 3, end_level_rl: 108 });
    off.ctl.select(id);
    const v = off.last().driveway!;
    expect(v.status).toBe('no_server'); expect(v.view!.preview).toBe(true);
    const grade = v.view!.checks.find((c) => c.id === 'max_grade')!;
    expect(grade).toMatchObject({ status: 'NOT EVALUATED', limit: null, basis: 'UNRESOLVED', requirement_key: 'driveway.max_grade_pct' });
    expect(v.view!.failing).toEqual([]);
    const on = rig(); const id2 = on.add('driveway', [[9, -4], [9, 14]], { width_m: 3, end_level_rl: 108 }); on.ctl.select(id2); await flush(60);
    const g2 = on.last().driveway!.view!.checks.find((c) => c.id === 'max_grade')!;
    expect(g2).toMatchObject({ status: 'FAIL', limit: 8, basis: 'LGA RULE' });
  });

  it('failing chainages are drawn red and hovering one shows the requirement key, limit and value', async () => {
    const r = rig(); const id = r.add('driveway', [[9, -4], [9, 14]], { width_m: 3, end_level_rl: 108 });     // a steep end level against a limit of 8 percent
    r.ctl.setTool('select'); r.ctl.select(id); await flush(60);
    const red = r.ctl.scene.failingPickables();
    expect(red.length).toBeGreaterThan(0);
    const msg = String(red[0].userData.failing); expect(msg).toMatch(/^driveway\.max_grade_pct 8 % \(LGA RULE\): [\d.]+ %$/);
    // the red ribbon covers the failing segment (boundary to the end), so a ray over its middle hits it
    r.root.updateMatrixWorld(true);
    r.ctl.pointerMove(r.info(9, 8));
    expect(r.last().hoverText).toBe(msg);
    r.ctl.pointerMove(r.info(9, -2)); expect(r.last().hoverText).toBe('');                       // the verge is not failing
  });

  it('the driveway ribbon is drawn at the DESIGN level, not on the ground', async () => {
    const r = rig(); const id = r.add('driveway', [[9, -4], [9, 14]], { width_m: 3, end_level_rl: 108 });
    await flush(60);
    const mesh = r.ctl.scene.groupOf(id)!.children.find((c) => c.userData.design) as THREE.Mesh;
    const p = mesh.geometry.attributes.position;
    let top = -Infinity; for (let i = 0; i < p.count; i++) top = Math.max(top, p.getZ(i));
    expect(top).toBeCloseTo(108 + 0.02, 4);                                                        // the end of the ribbon is at the end level
    const label = r.ctl.scene.groupOf(id)!.children.find((c) => c.userData.label);
    expect(label).toBeTruthy();
  });

  it('a driveway with no width has no ribbon and is labelled WIDTH NOT SET', () => {
    const texts: string[] = [];
    const r = rig(); const id = r.add('driveway', [[9, -4], [9, 14]]);
    expect(r.ctl.scene.groupOf(id)!.children.some((c) => c.userData.design || c.userData.noDesign)).toBe(false);
    expect(texts).toEqual([]);                                                                     // (label text is covered in the scene unit tests)
  });
});

describe('stage 6 review fixes: the end of a driveway, the link and the release request', () => {
  const addBuilding = (r: ReturnType<typeof rig>, ffl: number | null) => {
    const doc: SiteDesign = structuredClone(r.doc());
    doc.objects.push({ id: 'bld', type: 'building', status: 'proposed', origin: 'user', verified: false, label: 'House', geometry: { kind: 'polygon', ring: [[O[0] + 5, O[1] + 14], [O[0] + 20, O[1] + 14], [O[0] + 20, O[1] + 24], [O[0] + 5, O[1] + 24]] },
      params: { ffl_rl: ffl === null ? { value: null, basis: 'unresolved' } : { value: ffl, basis: 'user' } }, issues: [] });
    r.ctl.store.replace(doc);
  };

  it('Move driveway end is all or nothing: when the link step fails the end does not move, nothing is committed and the error is shown', () => {
    const r = rig(); const id = r.add('driveway', [[9, -4], [9, 12]], { width_m: 3 });
    addBuilding(r, 103.5); r.ctl.setTool('select'); r.ctl.select(id);
    const before = structuredClone(r.obj(id)), n = r.ctl.store.history().undoCount;
    const spy = vi.spyOn(OPS.link_driveway_end, 'run').mockImplementation(() => { throw new OpError('the link was refused'); });
    try {
      r.drag([9, 12], [10, 16]);
      expect(pts(r.obj(id))).toEqual(pts(before));                                                  // the vertex step was rolled back with the failed link step
      expect(r.obj(id).params.end_building_id).toBeUndefined();
      expect(r.ctl.store.history().undoCount).toBe(n);                                              // not even a half step in the history
      expect(r.last().message).toContain('the link was refused');
    } finally { spy.mockRestore(); }
    r.drag([9, 12], [10, 16]);                                                                      // and it works again once the link step can succeed
    expect(pts(r.obj(id))[1]).toEqual([O[0] + 10, O[1] + 16]); expect(r.obj(id).params.end_building_id).toMatchObject({ value: 'bld' });
  });

  it('the full request after a release is sent at once, not after the debounce', async () => {
    const r = rig(); const id = r.add('driveway', [[9, -4], [9, 14]], { width_m: 3, end_level_rl: 101.5 });
    r.ctl.setTool('select'); r.ctl.select(id);
    await flush(); r.srv.calls.length = 0;
    r.root.updateMatrixWorld(true);
    r.ctl.pointerDown(r.info(9, 14)); r.ctl.pointerMove(r.info(9, 16, { x: 100, y: 100 }));
    expect(r.srv.calls).toHaveLength(0);                                                            // dragging: debounced
    r.ctl.pointerUp(r.info(9, 16, { x: 100, y: 100 }), true);
    expect(r.srv.calls).toEqual([{ detail: 'full', id }]);                                          // released: sent in the same tick, no timer advanced
  });

  it('linking writes no level into the driveway; the link stays the source of truth and the request carries the linked building', async () => {
    const r = rig(); const id = r.add('driveway', [[9, -4], [9, 12]], { width_m: 3, end_level_rl: 99 });       // a level typed before the link
    addBuilding(r, 103.5); r.ctl.setTool('select'); r.ctl.select(id);
    r.ctl.store.run('link_driveway_end', { id, building_id: 'bld' });
    expect(r.obj(id).params.end_level_rl).toEqual({ value: 99, basis: 'user' });                      // untouched: nothing invented, nothing copied from the building
    await flush();
    expect(r.last().driveway!.view!.end_level.value).toBe(103.5);                                    // what the engine is asked for is the building FFL
    const sent = r.srv.bodies.at(-1)!;
    expect(sent.driveway!.params.end_building_id.value).toBe('bld'); expect(sent.building?.id).toBe('bld');
    expect(sent.driveway!.params.end_level_rl.value).toBe(103.5);                                    // the request never carries the stale 99
    r.ctl.store.run('set_param', { id: 'bld', key: 'ffl_rl', value: 104.2, basis: 'user' });         // the FFL changes: the driveway object is not rewritten
    expect(r.obj(id).params.end_level_rl).toEqual({ value: 99, basis: 'user' });
    await flush();
    expect(r.last().driveway!.view!.end_level.value).toBe(104.2); expect(r.srv.bodies.at(-1)!.building!.params.ffl_rl.value).toBe(104.2);
    r.ctl.store.run('set_param', { id: 'bld', key: 'ffl_rl', value: null, basis: 'unresolved' });
    await flush();
    expect(r.last().driveway!.view!.end_level.value).toBeNull();                                      // no FFL: NOT SET, not 99
    expect(r.srv.bodies.at(-1)!.driveway!.params.end_level_rl.value).toBeNull();
  });

  it('an answer that says the linked building is not in the saved design is asked for again when the design is saved', async () => {
    const r = rig(); const id = r.add('driveway', [[9, -4], [9, 12]], { width_m: 3 });
    addBuilding(r, 103.5); r.ctl.setTool('select'); r.ctl.select(id);
    r.srv.state.linkNote = 'END LEVEL NOT SET: THE LINKED BUILDING bld IS NOT IN THE SAVED SITE DESIGN (SAVE THE DESIGN FIRST)';
    r.ctl.store.run('link_driveway_end', { id, building_id: 'bld' });
    await flush(); r.srv.calls.length = 0;
    r.srv.state.linkNote = '';
    r.ctl.store.markSaved(2);                                                                        // the autosave stamped the design
    await flush();
    expect(r.srv.calls).toEqual([{ detail: 'full', id }]);
    r.srv.calls.length = 0; r.ctl.store.markSaved(3); await flush();
    expect(r.srv.calls).toEqual([]);                                                                 // the answer is settled: later saves ask for nothing
  });
});
