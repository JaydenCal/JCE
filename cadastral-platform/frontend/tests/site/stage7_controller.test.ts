/** Stage 7 wiring in the DesignController: the whole design is sent to the server for checks after every change, tree zones come back from the server values, and the
 *  optional tank sizing is a server call that lists what is UNRESOLVED. */
import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
vi.mock('@/lib/viewer/textures', async () => { const T = await import('three'); return { makeSprite: () => new T.Sprite(), makeTextures: () => ({}) }; });
import { DesignController, type DesignState } from '@/lib/site/designController';
import { SiteDesignStore } from '@/lib/site/store';
import { emptyDesign } from '@/lib/site/types';
import type { Built } from '@/lib/viewer/sceneBuilder';
import { at, E0, N0, seqCtx } from './helpers';

const O: [number, number] = [E0, N0];
function mesh() {
  const g = new THREE.PlaneGeometry(100, 100, 4, 4); g.computeVertexNormals();
  const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide })); m.updateMatrixWorld(true); return m;
}
const checkBody = (zones: boolean) => ({
  schema: 'site_checks.v1', rules_for: 'Testshire (NSW)', jurisdiction: 'NSW', lga: 'Testshire', terrain: { available: true, status: 's' }, lot_available: true, kerb_available: true,
  checks: [{ id: 'tree_1:TREE_ZONES', object_id: 'tree_1', object_type: 'tree', object_label: '', code: 'TREE_ZONES', title: 'TREE PROTECTION ZONES', status: 'INFO', severity: 'info', message: 'm', requirements: [], basis: 'LGA RULE', value: 6, limit: null, unit: 'm' }],
  values: zones ? { tree_1: [{ key: 'tpz_radius_m', label: 'TPZ', value: 6, unit: 'm', basis: 'LGA RULE', ref: '' }, { key: 'srz_radius_m', label: 'SRZ', value: 1.5, unit: 'm', basis: 'LGA RULE', ref: '' }] } : {},
  summary: { blocking: 0, warning: 0, info: 1, total: 1, by_status: { INFO: 1 } }, notes: [],
});
function rig(zones = true) {
  const calls: { url: string; body: unknown }[] = [], states: DesignState[] = [];
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    calls.push({ url, body: JSON.parse(String(init?.body)) });
    if (url.endsWith('/rwt-size')) return new Response(JSON.stringify({ status: 'UNRESOLVED', label: 'NOT SIZED: INPUTS UNRESOLVED', missing: [{ input: 'rwt.candidate_sizes_l', why: 'x' }], placeholders: [] }), { status: 200 });
    return new Response(JSON.stringify(checkBody(zones)), { status: 200 });
  }) as unknown as typeof fetch;
  const root = new THREE.Group();
  const ctl = new DesignController({
    built: { root } as unknown as Built, origin: O, terrainMeshes: [mesh()], lot: null, terrainAvailable: true, mpp: () => 0.1, setOrbit: () => {}, store: new SiteDesignStore(emptyDesign('p'), seqCtx()),
    makeLabel: () => new THREE.Sprite(), engine: { base: 'http://api', projectId: 'p', fetchImpl }, engineDebounceMs: 0, checksDebounceMs: 0,
  });
  ctl.listener = (s) => states.push(s); ctl.setActive(true);
  return { ctl, calls, last: () => states[states.length - 1] };
}

describe('DesignController: server checks and tank sizing', () => {
  it('sends the whole document for checks after an edit, not for an empty design, and shows tree zones from the server values', async () => {
    const r = rig();
    expect(r.calls.filter((c) => c.url.endsWith('/check'))).toHaveLength(0);                          // nothing to check yet
    r.ctl.store.run('add_object', { type: 'tree', points: [at(5, 5)], status: 'existing' });
    await vi.waitFor(() => expect(r.last().checks.status).toBe('ok'));
    const c = r.calls.filter((x) => x.url.endsWith('/check')); expect(c).toHaveLength(1);
    expect((c[0].body as { objects: unknown[] }).objects).toHaveLength(1);
    expect(r.ctl.scene.zoneOf('tree_1')).toEqual({ tpz: 6, srz: 1.5 });
    r.ctl.store.run('set_param', { id: 'tree_1', key: 'height_m', value: 5 });
    await vi.waitFor(() => expect(r.calls.filter((x) => x.url.endsWith('/check')).length).toBe(2));
    r.ctl.store.run('delete_object', { id: 'tree_1' });
    await vi.waitFor(() => expect(r.last().checks.status).toBe('idle'));
    expect(r.ctl.scene.zoneOf('tree_1')).toEqual({ tpz: null, srz: null });
  });
  it('an edit that only changes derived issues does not ask again', async () => {
    const r = rig(false);
    r.ctl.store.run('add_object', { type: 'tree', points: [at(5, 5)] }); await vi.waitFor(() => expect(r.last().checks.status).toBe('ok'));
    const n = r.calls.length; r.ctl.store.setEnv({ lot: [[O[0], O[1]], [O[0] + 3, O[1]], [O[0] + 3, O[1] + 3]], terrain: { available: true, sample: () => 100 } });
    await new Promise((res) => setTimeout(res, 30)); expect(r.calls.length).toBe(n);
  });
  it('size this tank posts the tank and shows what the server says is UNRESOLVED', async () => {
    const r = rig();
    r.ctl.store.run('add_object', { type: 'rwt', points: [at(5, 5)] }); r.ctl.select('rwt_1');
    await r.ctl.sizeTank('rwt_1', { rainfall: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], station: 'S1' });
    const p = r.last().rwtSize!; expect(p.status).toBe('ok'); expect(p.result!.status).toBe('UNRESOLVED'); expect(p.result!.missing![0].input).toBe('rwt.candidate_sizes_l');
    const call = r.calls.find((x) => x.url.endsWith('/rwt-size'))!; expect(call.body).toMatchObject({ rainfall_station: 'S1', rwt: { id: 'rwt_1' } });
  });
  it('without a server the sizing says NO SERVER', async () => {
    const root = new THREE.Group(), states: DesignState[] = [];
    const ctl = new DesignController({ built: { root } as unknown as Built, origin: O, terrainMeshes: [mesh()], lot: null, terrainAvailable: true, mpp: () => 0.1, setOrbit: () => {}, store: new SiteDesignStore(emptyDesign('p'), seqCtx()), makeLabel: () => new THREE.Sprite() });
    ctl.listener = (s) => states.push(s); ctl.setActive(true); ctl.store.run('add_object', { type: 'rwt', points: [at(5, 5)] }); ctl.select('rwt_1');
    await ctl.sizeTank('rwt_1', { rainfall: null, station: '' });
    expect(states[states.length - 1].rwtSize!.error).toContain('NO SERVER'); expect(states[states.length - 1].checks.status).toBe('no_server');
  });
});
