/** Stage 8: existing services, sewer drains, water services, the plan underlay, the point pick and the route proposals in the controller. */
import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
vi.mock('@/lib/viewer/textures', async () => { const T = await import('three'); return { makeSprite: () => new T.Sprite(), makeTextures: () => ({}) }; });
import { DesignController, type DesignState } from '@/lib/site/designController';
import { OPS, OpError, toolSchemas } from '@/lib/site/ops';
import { buildObject, SiteScene } from '@/lib/site/siteScene';
import { SiteDesignStore } from '@/lib/site/store';
import { EMPTY_CONNECTION, EMPTY_TRACE_FORM, buildingExits, connectable, connectionInput, optionalNumber, requiredNumber, traceFields } from '@/lib/site/serviceForm';
import { DASH_M, GAP_M, dashSegments, fmtDate, isUnverified, planExpired, serviceColour, serviceLabelLines } from '@/lib/site/services';
import { CalibrationError, calibrate, clampOpacity, clientToPixel, imageCorners, mgaToPx, pxToMga, underlayMesh } from '@/lib/site/underlay';
import { PLAN_EXPIRED, SERVICE_COLOUR, UNVERIFIED_LABEL, emptyDesign, dimensionsSet, type SiteObject } from '@/lib/site/types';
import type { Built } from '@/lib/viewer/sceneBuilder';
import { at, E0, N0, seqCtx } from './helpers';

const O: [number, number] = [E0, N0];
const u = (value: string | number | boolean) => ({ value, basis: 'user' as const });
function store() { return new SiteDesignStore(emptyDesign('p'), seqCtx()); }
function svc(s = store(), params: Record<string, unknown> = {}, pts = [at(0, 0), at(10, 0)]) {
  const id = s.run('add_object', { type: 'service_existing', points: pts, status: 'existing', params }).id as string;
  return { s, id, o: () => s.doc.objects.find((x) => x.id === id)! };
}
const ctxScene = { O, sample: () => 100, label: () => new THREE.Sprite() };

describe('existing service object', () => {
  it('starts with every field NOT SET (nothing defaulted)', () => {
    const { o } = svc();
    for (const k of ['service_kind', 'asset_owner', 'depth_m', 'depth_basis', 'depth_reference', 'position_tolerance_m', 'plan_expiry_date', 'verified_by']) expect(o().params[k]).toEqual({ value: null, basis: 'unresolved' });
    expect(o().verified).toBe(false); expect(o().status).toBe('existing');
  });
  it('a point service is allowed and starts NOT SET too', () => {
    const s = store();
    const id = s.run('add_object', { type: 'service_existing', shape: 'point', points: [at(3, 3)] }).id as string;
    expect(s.doc.objects[0].geometry.kind).toBe('point'); expect(s.doc.objects[0].params.depth_m.value).toBeNull(); expect(id).toBeTruthy();
  });
  it('typed parameters are checked: kind list, depth basis list, dates, numbers', () => {
    const { s, id } = svc();
    expect(() => s.run('set_param', { id, key: 'service_kind', value: 'steam' })).toThrow(/one of/);
    expect(() => s.run('set_param', { id, key: 'depth_basis', value: 'guessed' })).toThrow(/one of/);
    expect(() => s.run('set_param', { id, key: 'plan_date', value: '5/1/2026' })).toThrow(/YYYY-MM-DD/);
    expect(() => s.run('set_param', { id, key: 'depth_m', value: 'deep' })).toThrow(/number/);
    expect(() => s.run('set_param', { id, key: 'depth_m', value: 1.2, basis: 'platform_default' })).toThrow(/platform default/);
    s.run('set_param', { id, key: 'service_kind', value: 'gas' });
  });
  it('a footing depth can be entered on a building-like object and a tree', () => {
    const s = store(); const id = s.run('add_object', { type: 'tree', points: [at(1, 1)] }).id as string;
    s.run('set_param', { id, key: 'footing_depth_m', value: 0.9 }); expect(s.doc.objects[0].params.footing_depth_m.value).toBe(0.9);
    expect(() => s.run('set_param', { id, key: 'footing_depth_m', value: 'x' })).toThrow(/number/);
  });
});

describe('set_service_verified', () => {
  it('needs a name and a valid date, sets verified and the date, and one undo reverses it', () => {
    const { s, id, o } = svc();
    expect(() => s.run('set_service_verified', { id, verified: true, date: '2026-02-01' })).toThrow(/verified_by/);
    expect(() => s.run('set_service_verified', { id, verified: true, verified_by: 'JS', date: '1/2/2026' })).toThrow(/YYYY-MM-DD/);
    expect(() => s.run('set_service_verified', { id, verified: true, verified_by: 'JS', date: '2026-13-45' })).toThrow(/YYYY-MM-DD|date/);
    s.run('set_service_verified', { id, verified: true, verified_by: ' J Surveyor ', date: '2026-02-01' });
    expect(o().verified).toBe(true); expect(o().verified_on).toBe('2026-02-01'); expect(o().params.verified_by).toEqual({ value: 'J Surveyor', basis: 'user' });
    s.undo(); expect(o().verified).toBe(false); expect(o().verified_on).toBeUndefined();
  });
  it('removing the verification keeps the name and drops the date; the name cannot be cleared while verified', () => {
    const { s, id, o } = svc();
    s.run('set_service_verified', { id, verified: true, verified_by: 'JS', date: '2026-02-01' });
    expect(() => s.run('set_param', { id, key: 'verified_by', value: null })).toThrow(/verified_by/);
    expect(() => s.run('remove_param', { id, key: 'verified_by' })).toThrow(/verified_by/);
    s.run('set_service_verified', { id, verified: false });
    expect(o().verified).toBe(false); expect(o().verified_on).toBeUndefined(); expect(o().params.verified_by.value).toBe('JS');
  });
  it('is only for existing services and is not offered to the AI', () => {
    const s = store(); const t = s.run('add_object', { type: 'tree', points: [at(1, 1)] }).id as string;
    expect(() => s.run('set_service_verified', { id: t, verified: true, verified_by: 'x', date: '2026-02-01' })).toThrow(/not an existing service/);
    expect(OPS.set_service_verified.ai).toBe(false); expect(OPS.add_service_objects.ai).toBe(false);
    const names = toolSchemas().map((x) => x.name); expect(names).not.toContain('set_service_verified'); expect(names).not.toContain('add_service_objects');
  });
});

describe('add_service_objects', () => {
  const drain = { id: 'd1', type: 'sewer_drain', status: 'proposed', origin: 'user', geometry: { kind: 'polyline', pts: [[E0, N0], [E0 + 5, N0]] }, params: { diameter_mm: u(100), upstream_invert_rl: u(98), downstream_invert_rl: u(97.9) } };
  const node = { id: 'n1', type: 'service_node', status: 'proposed', geometry: { kind: 'point', p: [E0 + 5, N0] }, params: { node_kind: u('inspection_opening') } };
  it('adds the objects in ONE undo step, always unverified', () => {
    const s = store();
    s.run('add_service_objects', { objects: [drain, { ...node, verified: true }] });
    expect(s.doc.objects.map((o) => o.id)).toEqual(['d1', 'n1']); expect(s.doc.objects.every((o) => o.verified === false)).toBe(true);
    s.undo(); expect(s.doc.objects).toHaveLength(0);
  });
  it('accepts origin dbyd, refuses ai_proposal, other types, used ids and bad geometry (nothing is added)', () => {
    const s = store();
    s.run('add_service_objects', { objects: [{ ...drain, id: 'x', type: 'service_existing', origin: 'dbyd', params: { service_kind: u('gas') } }] });
    expect(s.doc.objects[0].origin).toBe('dbyd');
    expect(() => s.run('add_service_objects', { objects: [{ ...drain, id: 'y', origin: 'ai_proposal' }] })).toThrow(OpError);
    expect(() => s.run('add_service_objects', { objects: [{ ...drain, id: 'y', type: 'tree' }] })).toThrow(/type/);
    expect(() => s.run('add_service_objects', { objects: [{ ...drain, id: 'x' }] })).toThrow(/already in use/);
    expect(() => s.run('add_service_objects', { objects: [drain, { ...drain }] })).toThrow(/already in use/);
    expect(() => s.run('add_service_objects', { objects: [{ ...drain, id: 'z', geometry: { kind: 'polygon', ring: [] } }] })).toThrow(OpError);
    expect(() => s.run('add_service_objects', { objects: [{ ...drain, id: 'z', geometry: { kind: 'polyline', pts: [[1]] } }] })).toThrow(/E, N/);
    expect(() => s.run('add_service_objects', { objects: [] })).toThrow(/at least one/);
    expect(s.doc.objects).toHaveLength(1);
  });
  it('refuses a platform default parameter on a service (stage 7 rule)', () => {
    const s = store();
    expect(() => s.run('add_service_objects', { objects: [{ ...drain, params: { diameter_mm: { value: 100, basis: 'platform_default' } } }] })).toThrow(/platform default/);
  });
});

describe('services wording', () => {
  const mk = (extra: Partial<SiteObject> = {}, params: Record<string, unknown> = {}): SiteObject => {
    const { o } = svc(store(), params); return { ...o(), ...extra };
  };
  it('formats dates as DD/MM/YYYY and nothing else', () => { expect(fmtDate('2026-03-05')).toBe('05/03/2026'); expect(fmtDate('')).toBe(''); expect(fmtDate('x')).toBe(''); expect(fmtDate(undefined)).toBe(''); });
  it('PLAN EXPIRED only when a stored expiry is before today', () => {
    const o = mk({}, { plan_expiry_date: u('2026-03-05') });
    expect(planExpired(o, '2026-03-06')).toBe(true); expect(planExpired(o, '2026-03-05')).toBe(false); expect(planExpired(mk(), '2030-01-01')).toBe(false);
    expect(serviceLabelLines(o, '2026-03-06')).toContain(PLAN_EXPIRED); expect(serviceLabelLines(o, '2026-03-05')).not.toContain(PLAN_EXPIRED);
  });
  it('an unverified service is labelled UNVERIFIED, INDICATIVE ONLY; a verified one shows the date', () => {
    expect(serviceLabelLines(mk())).toContain(UNVERIFIED_LABEL); expect(UNVERIFIED_LABEL).toBe('UNVERIFIED, INDICATIVE ONLY');
    const v = mk({ verified: true, verified_on: '2026-02-01' }); expect(serviceLabelLines(v)).toContain('VERIFIED 01/02/2026'); expect(serviceLabelLines(v)).not.toContain(UNVERIFIED_LABEL);
    expect(isUnverified(mk())).toBe(true); expect(isUnverified(v)).toBe(false);
  });
  it('depth is shown only with a basis; otherwise DATA NOT AVAILABLE; owner NOT SET is said so', () => {
    expect(serviceLabelLines(mk())).toEqual(expect.arrayContaining(['SERVICE KIND NOT SET', 'OWNER NOT SET', 'DEPTH NOT AVAILABLE']));
    expect(serviceLabelLines(mk({}, { depth_m: u(1.5), depth_basis: u('potholed') }))).toContain('DEPTH 1.50 M POTHOLED');
    expect(serviceLabelLines(mk({}, { depth_m: u(1.5), depth_basis: u('unknown') }))).toContain('DEPTH NOT AVAILABLE');
  });
  it('labels contain no em or en dash and colours follow the kind', () => {
    for (const l of serviceLabelLines(mk({}, { service_kind: u('gas'), asset_owner: u('Jemena'), diameter_mm: u(80) }))) expect(l).not.toMatch(/[–—]/);
    expect(serviceColour(mk({}, { service_kind: u('gas') }))).toBe(SERVICE_COLOUR.gas); expect(serviceColour(mk())).toBe('#999999');
  });
  it('a sewer drain needs a diameter and both inverts to be dimensioned', () => {
    const s = store(); const id = s.run('add_object', { type: 'sewer_drain', points: [at(0, 0), at(5, 0)] }).id as string;
    expect(dimensionsSet(s.doc.objects[0])).toBe(false);
    for (const [k, v] of [['diameter_mm', 100], ['upstream_invert_rl', 98], ['downstream_invert_rl', 97.9]] as const) s.run('set_param', { id, key: k, value: v });
    expect(dimensionsSet(s.doc.objects[0])).toBe(true);
  });
});

describe('dashes', () => {
  const len = (s: number[][]) => s.slice(1).reduce((a, p, i) => a + Math.hypot(p[0] - s[i][0], p[1] - s[i][1]), 0);
  it('splits a straight line into dashes and gaps of the stated lengths', () => {
    const d = dashSegments([[0, 0], [10, 0]]);
    expect(d).toHaveLength(10); for (const s of d.slice(0, -1)) expect(len(s)).toBeCloseTo(DASH_M, 9);
    expect(d[1][0][0]).toBeCloseTo(DASH_M + GAP_M, 9);
  });
  it('carries the pattern around a corner and handles short or degenerate lines', () => {
    const d = dashSegments([[0, 0], [0.5, 0], [0.5, 5]]);
    expect(d.some((s) => s.length === 3)).toBe(true);                                      // a dash that turns the corner
    expect(dashSegments([[0, 0], [0, 0]])).toEqual([]); expect(dashSegments([[0, 0]])).toEqual([]);
    expect(dashSegments([[0, 0], [10, 0]], 1, 0)).toHaveLength(1);
    expect(dashSegments([[0, 0], [0.2, 0]])).toHaveLength(1);
  });
});

describe('scene', () => {
  const build = (o: SiteObject) => buildObject(o, ctxScene as never);
  it('an unverified service line is drawn dashed; a verified one solid', () => {
    const { s, id, o } = svc(store(), { service_kind: u('water') }, [at(0, 0), at(12, 0)]);
    const dashed = (g: THREE.Group) => { let n = false; g.traverse((x) => { if (x.userData.dashed) n = true; }); return n; };
    expect(dashed(build(o()))).toBe(true);
    s.run('set_service_verified', { id, verified: true, verified_by: 'JS', date: '2026-02-01' });
    expect(dashed(build(o()))).toBe(false);
  });
  it('the colour follows the service kind', () => {
    const { o } = svc(store(), { service_kind: u('electricity') });
    const g = build({ ...o(), issues: [] }); let hex = -1; g.traverse((x) => { if (x.userData.dashed) hex = x.userData.baseColour as number; });
    expect(new THREE.Color(SERVICE_COLOUR.electricity).getHex()).toBe(hex);
  });
  it('a positional tolerance draws a band; none draws no band', () => {
    const count = (g: THREE.Group) => { let n = 0; g.traverse((x) => { if ((x as THREE.Mesh).isMesh) n++; }); return n; };
    expect(count(build(svc(store(), { position_tolerance_m: u(0.5) }).o())) - count(build(svc().o()))).toBe(1);
  });
  it('a sewer drain with inverts is drawn as a pipe; a node and a point service are markers', () => {
    const s = store(); const id = s.run('add_object', { type: 'sewer_drain', points: [at(0, 0), at(6, 0)], params: { diameter_mm: u(100), upstream_invert_rl: u(98), downstream_invert_rl: u(97.9) } }).id as string;
    expect(build(s.doc.objects.find((x) => x.id === id)!).children.length).toBeGreaterThan(1);
    const n = s.run('add_object', { type: 'service_node', points: [at(2, 2)], params: { node_kind: u('water_meter') } }).id as string;
    const g = build(s.doc.objects.find((x) => x.id === n)!); expect(g.userData.type).toBe('service_node');
    const p = s.run('add_object', { type: 'service_existing', shape: 'point', points: [at(4, 4)] }).id as string;
    expect(build(s.doc.objects.find((x) => x.id === p)!).userData.type).toBe('service_existing');
  });
});

describe('underlay calibration', () => {
  it('maps pixels to MGA by a similarity transform and back', () => {
    const c = calibrate([[0, 0], [100, 0]], [[E0, N0], [E0 + 50, N0]]);                  // 0.5 m per pixel, square to the grid, image y down
    expect(c.scale).toBeCloseTo(0.5, 12); expect(c.rotation_deg).toBeCloseTo(0, 9);
    const p = pxToMga(c, 40, 20); expect(p[0]).toBeCloseTo(E0 + 20, 9); expect(p[1]).toBeCloseTo(N0 - 10, 9);   // a lower pixel is further south
    const q = mgaToPx(c, p[0], p[1]); expect(q[0]).toBeCloseTo(40, 9); expect(q[1]).toBeCloseTo(20, 9);
  });
  it('a rotated plan reports its rotation and keeps the pair of points exact', () => {
    const c = calibrate([[10, 10], [110, 10]], [[E0 + 5, N0 + 5], [E0 + 5, N0 + 105]]);   // the image x axis points north: a quarter turn anticlockwise
    expect(c.rotation_deg).toBeCloseTo(270, 9); expect(c.scale).toBeCloseTo(1, 12);
    const a = pxToMga(c, 10, 10), b = pxToMga(c, 110, 10);
    expect(a[0]).toBeCloseTo(E0 + 5, 9); expect(a[1]).toBeCloseTo(N0 + 5, 9); expect(b[0]).toBeCloseTo(E0 + 5, 9); expect(b[1]).toBeCloseTo(N0 + 105, 9);
    const m = pxToMga(c, 60, 60), back = mgaToPx(c, m[0], m[1]); expect(back[0]).toBeCloseTo(60, 9); expect(back[1]).toBeCloseTo(60, 9);
  });
  it('refuses points that are too close or not numbers', () => {
    expect(() => calibrate([[0, 0], [2, 0]], [[0, 0], [10, 0]])).toThrow(CalibrationError);
    expect(() => calibrate([[0, 0], [100, 0]], [[0, 0], [0.1, 0]])).toThrow(/CLOSE/);
    expect(() => calibrate([[0, 0], [NaN, 0]], [[0, 0], [10, 0]])).toThrow(/NUMBER/);
  });
  it('image corners follow the calibration; opacity is clamped; clicks map to natural pixels', () => {
    const c = calibrate([[0, 0], [100, 0]], [[E0, N0], [E0 + 100, N0]]);
    const k = imageCorners(c, 200, 100); expect(k[0]).toEqual([E0, N0]); expect(k[2][0]).toBeCloseTo(E0 + 200, 9); expect(k[2][1]).toBeCloseTo(N0 - 100, 9);
    expect(clampOpacity(5)).toBe(1); expect(clampOpacity(-1)).toBe(0.05); expect(clampOpacity(NaN)).toBe(0.5);
    const box = { left: 10, top: 20, width: 100, height: 50 };
    expect(clientToPixel(60, 45, box, { width: 1000, height: 500 })).toEqual([500, 250]); expect(clientToPixel(5, 45, box, { width: 1000, height: 500 })).toBeNull(); expect(clientToPixel(5, 5, { ...box, width: 0 }, { width: 1, height: 1 })).toBeNull();
  });
  it('the draped quad sits on the terrain and cannot be picked', () => {
    const c = calibrate([[0, 0], [100, 0]], [[E0, N0], [E0 + 100, N0]]);
    const m = underlayMesh(imageCorners(c, 100, 100), null, 0.5, () => 100, O, 4);
    const pos = m.geometry.getAttribute('position'); expect(pos.count).toBe(25); expect(pos.getZ(0)).toBeCloseTo(100.04, 4);
    expect(m.userData.pick).toBeUndefined(); expect((m.material as THREE.MeshBasicMaterial).opacity).toBe(0.5);
  });
  it('the scene adds and removes the underlay', () => {
    const sc = new SiteScene({ origin: O, terrain: { available: true, sample: () => 100 }, makeLabel: () => new THREE.Sprite() });
    const c = calibrate([[0, 0], [100, 0]], [[E0, N0], [E0 + 100, N0]]);
    sc.setUnderlay({ texture: null, width: 100, height: 100, calibration: c, opacity: 0.4 }); expect(sc.hasUnderlay()).toBe(true); expect(sc.pickables()).toHaveLength(0);
    sc.setUnderlayOpacity(0.9); sc.setUnderlay(null); expect(sc.hasUnderlay()).toBe(false); expect(sc.group.children).toHaveLength(0);
  });
});

describe('forms', () => {
  it('only what was entered is sent; a depth needs its basis; bad numbers and dates are refused', () => {
    expect(traceFields(EMPTY_TRACE_FORM)).toEqual({ fields: {}, label: undefined, error: null });
    const ok = traceFields({ ...EMPTY_TRACE_FORM, service_kind: 'gas', asset_owner: ' Jemena ', diameter_mm: '80', depth_m: '0.6', depth_basis: 'plan_indicated', plan_date: '2026-01-05', label: 'Gas main' });
    expect(ok.error).toBeNull(); expect(ok.fields).toEqual({ service_kind: u('gas'), asset_owner: u('Jemena'), diameter_mm: u(80), depth_m: u(0.6), depth_basis: u('plan_indicated'), plan_date: u('2026-01-05') }); expect(ok.label).toBe('Gas main');
    expect(traceFields({ ...EMPTY_TRACE_FORM, depth_m: '0.6' }).error).toMatch(/BASIS/);
    expect(traceFields({ ...EMPTY_TRACE_FORM, diameter_mm: 'x' }).error).toMatch(/DIAMETER/);
    expect(traceFields({ ...EMPTY_TRACE_FORM, diameter_mm: '0' }).error).toMatch(/ABOVE ZERO/);
    expect(traceFields({ ...EMPTY_TRACE_FORM, position_tolerance_m: '0' }).error).toBeNull();
    expect(traceFields({ ...EMPTY_TRACE_FORM, plan_date: '2026-02-31x' }).error).toMatch(/DATE/);
    expect(traceFields({ ...EMPTY_TRACE_FORM, service_kind: 'steam' }).error).toMatch(/LIST/);
  });
  it('the connection is a service in the design or an entered point; an invert must be a number', () => {
    expect(connectionInput(EMPTY_CONNECTION).error).toMatch(/CHOOSE/);
    expect(connectionInput({ ...EMPTY_CONNECTION, main_id: 'm1', invert_rl: '97.5' })).toEqual({ value: { main_id: 'm1', invert_rl: 97.5 }, error: null });
    expect(connectionInput({ mode: 'point', main_id: '', e: '1', n: '2', invert_rl: '' }).value).toEqual({ p: [1, 2] });
    expect(connectionInput({ mode: 'point', main_id: '', e: '1', n: '', invert_rl: '' }).error).toMatch(/EASTING/);
    expect(connectionInput({ mode: 'point', main_id: '', e: '1', n: '2', invert_rl: 'x' }).error).toMatch(/INVERT/);
    expect(requiredNumber('', 'THE START INVERT').error).toMatch(/START INVERT/); expect(requiredNumber('0', 'A', { positive: true }).error).toMatch(/ABOVE ZERO/);
    expect(optionalNumber('', 'G')).toEqual({ value: null, error: null }); expect(optionalNumber('abc', 'G').error).toMatch(/NUMBER/);
  });
  it('lists sewer-compatible services and building exits', () => {
    const s = store();
    s.run('add_object', { type: 'service_existing', points: [at(0, 0), at(5, 0)], params: { service_kind: u('sewer') } });
    s.run('add_object', { type: 'service_existing', points: [at(0, 1), at(5, 1)], params: { service_kind: u('gas') } });
    s.run('add_object', { type: 'service_existing', points: [at(0, 2), at(5, 2)] });
    expect(connectable(s.doc.objects, 'sewer').map((o) => o.id)).toEqual(['service_existing_1', 'service_existing_3']);
    expect(buildingExits(s.doc.objects[0], 'sewer')).toEqual([]);
  });
});

// ---- the controller ------------------------------------------------------------------------------------------------------------------
function mesh() {
  const g = new THREE.PlaneGeometry(100, 100, 4, 4); g.computeVertexNormals();
  const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide })); m.updateMatrixWorld(true); return m;
}
const LOT: [number, number][] = [[E0 - 10, N0 - 10], [E0 + 10, N0 - 10], [E0 + 10, N0 + 10], [E0 - 10, N0 + 10]];
function rig(responses: Record<string, () => Response> = {}) {
  const calls: { url: string; body: unknown }[] = [], states: DesignState[] = [];
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : null });
    const k = Object.keys(responses).find((x) => url.endsWith(x));
    if (k) return responses[k]();
    return new Response(JSON.stringify({ message: 'no route' }), { status: 404 });
  }) as unknown as typeof fetch;
  const root = new THREE.Group();
  const ctl = new DesignController({
    built: { root } as unknown as Built, origin: O, terrainMeshes: [mesh()], lot: LOT, terrainAvailable: true, mpp: () => 0.1, setOrbit: () => {}, store: new SiteDesignStore(emptyDesign('p'), seqCtx()),
    makeLabel: () => new THREE.Sprite(), engine: { base: 'http://api', projectId: 'p', fetchImpl }, engineDebounceMs: 0, checksDebounceMs: 0,
  });
  ctl.listener = (s) => states.push(s); ctl.setActive(true);
  return { ctl, root, calls, last: () => states[states.length - 1] };
}
const info = (x: number, y: number) => ({ ray: new THREE.Ray(new THREE.Vector3(x, y, 50), new THREE.Vector3(0, 0, -1)), x: 0, y: 0, alt: false, shift: false, button: 0 });

describe('controller: point pick', () => {
  it('returns the snapped point once and changes nothing in the design', () => {
    const r = rig(); const got: number[][] = [];
    r.ctl.pickPoint('Click point 1', (p) => got.push(p));
    expect(r.last().tool).toBe('pick'); expect(r.last().pickPrompt).toBe('Click point 1'); expect(r.last().hint).toContain('Click point 1');
    r.ctl.pointerUp(info(3.3, 4.4), false);
    expect(got).toHaveLength(1); expect(got[0][0]).toBeCloseTo(E0 + 3.3, 6); expect(got[0][1]).toBeCloseTo(N0 + 4.4, 6);
    expect(r.last().tool).toBe('select'); expect(r.ctl.store.doc.objects).toHaveLength(0);
    r.ctl.pointerUp(info(3.3, 4.4), false); expect(got).toHaveLength(1);
  });
  it('a lot corner pick returns the corner itself and refuses a click far from every corner', () => {
    const r = rig(); const got: number[][] = [];
    expect(r.ctl.lotCorners()).toHaveLength(4);
    r.ctl.pickPoint('Corner', (p) => got.push(p), { lotCorner: true });
    r.ctl.pointerUp(info(0, 0), false); expect(got).toHaveLength(0); expect(r.last().message).toContain('LOT CORNER'); expect(r.last().tool).toBe('pick');
    r.ctl.pointerUp(info(9.95, 10.05), false); expect(got).toEqual([[E0 + 10, N0 + 10]]);
  });
  it('Escape cancels the pick', () => {
    const r = rig(); const got: number[][] = [];
    r.ctl.pickPoint('x', (p) => got.push(p)); r.ctl.key({ code: 'Escape', ctrlKey: false, metaKey: false, shiftKey: false } as KeyboardEvent);
    expect(r.last().tool).toBe('select'); r.ctl.pointerUp(info(1, 1), false); expect(got).toHaveLength(0);
  });
});

describe('controller: underlay and tracing', () => {
  it('a loaded plan is not shown until calibrated, then shows and takes an opacity', () => {
    const r = rig();
    expect(r.ctl.loadUnderlay({ name: 'plan.png', width: 0, height: 10, texture: null })).toMatch(/PIXELS/);
    expect(r.ctl.loadUnderlay({ name: 'plan.png', width: 1000, height: 800, texture: null })).toBeNull();
    expect(r.last().underlay).toMatchObject({ name: 'plan.png', calibrated: false }); expect(r.last().underlay!.label).toContain('NOT CALIBRATED'); expect(r.ctl.scene.hasUnderlay()).toBe(false);
    expect(r.ctl.calibrateUnderlay([[0, 0], [1, 0]], [[E0, N0], [E0 + 10, N0]])).toMatch(/CLOSE/);
    expect(r.ctl.calibrateUnderlay([[0, 0], [100, 0]], [[E0, N0], [E0 + 50, N0]])).toBeNull();
    expect(r.ctl.scene.hasUnderlay()).toBe(true); expect(r.last().underlay!.calibrated).toBe(true); expect(r.last().underlay!.label).toContain('0.5000 M PER PIXEL');
    r.ctl.setUnderlayOpacity(2); expect(r.last().underlay!.opacity).toBe(1);
    r.ctl.clearUnderlay(); expect(r.ctl.scene.hasUnderlay()).toBe(false); expect(r.last().underlay).toBeNull();
    expect(r.ctl.calibrateUnderlay([[0, 0], [100, 0]], [[E0, N0], [E0 + 50, N0]])).toMatch(/LOAD/);
  });
  it('traces a service line with the entered fields, unverified, and a service point', () => {
    const r = rig();
    const t = traceFields({ ...EMPTY_TRACE_FORM, service_kind: 'sewer', asset_owner: 'Water Corp', label: 'Trace 1' });
    r.ctl.traceService(t.fields, { label: t.label }); expect(r.last().tool).toBe('draw');
    r.ctl.pointerUp(info(0, 0), false); r.ctl.pointerUp(info(10, 0), false); r.ctl.finishDrawing();
    const o = r.ctl.store.doc.objects[0];
    expect(o.type).toBe('service_existing'); expect(o.verified).toBe(false); expect(o.label).toBe('Trace 1'); expect(o.params.service_kind.value).toBe('sewer'); expect(o.params.depth_m).toEqual({ value: null, basis: 'unresolved' });
    r.ctl.traceService({ service_kind: u('water') }, { point: true }); expect(r.last().tool).toBe('place');
    r.ctl.pointerUp(info(5, 5), false);
    const p = r.ctl.store.doc.objects[1]; expect(p.geometry.kind).toBe('point'); expect(p.params.service_kind.value).toBe('water');
  });
});

describe('controller: route proposals', () => {
  const proposal = () => ({
    schema: 'sewer_proposal.v1', label: 'PROPOSAL: CHECK EVERY VALUE', route: { pts: [[E0, N0], [E0 + 8, N0]], length_m: 8 }, grade_pct: 1.2, grade_basis: 'sewer.min_grade_pct', inspection_chainages_m: [],
    connection: { p: [E0 + 8, N0], label: 'NOT VERIFIED', main_id: null, status: 'NOT EVALUATED', message: 'x' }, checks: [], summary: { blocking: 0, warning: 0 }, notes: ['n'],
    objects: [{ id: 'sewer_1', type: 'sewer_drain', status: 'proposed', origin: 'user', geometry: { kind: 'polyline', pts: [[E0, N0], [E0 + 8, N0]] }, params: { diameter_mm: u(100), upstream_invert_rl: u(98), downstream_invert_rl: u(97.9) } }],
  });
  const body = { building_id: 'b1', start_invert_rl: 98, diameter_mm: 100, connection: { p: [E0 + 8, N0] as [number, number] } };
  it('posts the design and the inputs, shows the answer and a preview line, and applies it in ONE undo step', async () => {
    const r = rig({ '/sewer-route': () => new Response(JSON.stringify(proposal()), { status: 200 }), '/check': () => new Response(JSON.stringify({ schema: 'site_checks.v1', checks: [], values: {}, summary: { blocking: 0, warning: 0, info: 0, total: 0, by_status: {} }, rules_for: 'x', terrain: { available: true, status: 's' }, lot_available: true, kerb_available: true, notes: [] }), { status: 200 }) });
    r.ctl.store.run('add_object', { type: 'tree', points: [at(5, 5)] });
    const before = r.root.children.length;
    await r.ctl.proposeSewer(body);
    const call = r.calls.find((c) => c.url.endsWith('/sewer-route'))!;
    expect(call.body).toMatchObject({ building_id: 'b1', start_invert_rl: 98, diameter_mm: 100, design: { objects: [{ id: 'tree_1' }] } });
    expect(r.last().route).toMatchObject({ kind: 'sewer', status: 'ok', applied: false }); expect(r.root.children.length).toBe(before + 1);        // the white preview line
    expect(r.ctl.applyRoute()).toBeNull();
    expect(r.ctl.store.doc.objects.map((o) => o.id)).toEqual(['tree_1', 'sewer_1']); expect(r.last().route!.applied).toBe(true); expect(r.last().selectedId).toBe('sewer_1'); expect(r.root.children.length).toBe(before);
    expect(r.ctl.applyRoute()).toMatch(/NO PROPOSAL/);
    r.ctl.undo(); expect(r.ctl.store.doc.objects.map((o) => o.id)).toEqual(['tree_1']);
  });
  it('shows the server message when the route is refused, and says NO SERVER without an endpoint', async () => {
    const r = rig({ '/water-route': () => new Response(JSON.stringify({ code: 'NO_EXIT', message: 'THE BUILDING HAS NO WATER EXIT' }), { status: 422 }) });
    await r.ctl.proposeWater({ building_id: 'b', meter_p: [E0, N0], diameter_mm: 20, cover_m: 0.5, connection: { p: [E0, N0 + 5] } });
    expect(r.last().route).toMatchObject({ kind: 'water', status: 'error', error: 'THE BUILDING HAS NO WATER EXIT' });
    const root = new THREE.Group(), states: DesignState[] = [];
    const bare = new DesignController({ built: { root } as unknown as Built, origin: O, terrainMeshes: [mesh()], lot: null, terrainAvailable: true, mpp: () => 0.1, setOrbit: () => {}, store: new SiteDesignStore(emptyDesign('p'), seqCtx()), makeLabel: () => new THREE.Sprite() });
    bare.listener = (s) => states.push(s); await bare.proposeSewer(body);
    expect(states[states.length - 1].route!.error).toContain('NO SERVER');
  });
  it('an id that is no longer free refuses the whole step and keeps the design', async () => {
    const r = rig({ '/sewer-route': () => new Response(JSON.stringify(proposal()), { status: 200 }) });
    await r.ctl.proposeSewer(body);
    r.ctl.store.run('add_service_objects', { objects: [{ ...proposal().objects[0] }] });
    expect(r.ctl.applyRoute()).toMatch(/already in use/); expect(r.ctl.store.doc.objects).toHaveLength(1);
  });
  it('DBYD drafts are added as unverified objects of origin dbyd in one step', () => {
    const r = rig();
    const draft = { id: 'dbyd_1', type: 'service_existing', status: 'existing', origin: 'dbyd', verified: true, geometry: { kind: 'polyline', pts: [[E0, N0], [E0 + 5, N0]] }, params: { service_kind: u('gas') }, issues: [] } as unknown as SiteObject;
    expect(r.ctl.addDbydDrafts([draft])).toBeNull();
    expect(r.ctl.store.doc.objects[0]).toMatchObject({ id: 'dbyd_1', origin: 'dbyd', verified: false });
    expect(r.ctl.addDbydDrafts([draft])).toMatch(/already in use/);
  });
});
