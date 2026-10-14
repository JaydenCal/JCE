/** Stage 8 panels render (server side markup) and the DBYD and route clients speak to the right URLs. */
import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
vi.mock('@/lib/viewer/textures', async () => { const T = await import('three'); return { makeSprite: () => new T.Sprite(), makeTextures: () => ({}) }; });
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { DesignController, type DesignState } from '@/lib/site/designController';
import { SiteDesignStore } from '@/lib/site/store';
import { emptyDesign } from '@/lib/site/types';
import { listEnquiries, listPlans, lodgeEnquiry, parsePlan, planPage, uploadPlan } from '@/lib/site/dbydApi';
import { postSewerRoute, postWaterRoute, EngineHttpError } from '@/lib/site/engineApi';
import { ServiceVerifyBox, TraceServiceSection } from '@/components/viewer/ServiceTools';
import { SewerSection, WaterSection, RouteResult } from '@/components/viewer/RouteTools';
import { DbydSection } from '@/components/viewer/DbydTools';
import type { Built } from '@/lib/viewer/sceneBuilder';
import { at, E0, N0, seqCtx } from './helpers';

function rig() {
  const states: DesignState[] = [];
  const g = new THREE.PlaneGeometry(100, 100, 2, 2); const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial()); m.updateMatrixWorld(true);
  const ctl = new DesignController({ built: { root: new THREE.Group() } as unknown as Built, origin: [E0, N0], terrainMeshes: [m], lot: [[E0, N0], [E0 + 20, N0], [E0 + 20, N0 + 20]], terrainAvailable: true, mpp: () => 0.1, setOrbit: () => {},
    store: new SiteDesignStore(emptyDesign('p'), seqCtx()), makeLabel: () => new THREE.Sprite() });
  ctl.listener = (s) => states.push(s); ctl.setActive(true);
  return { ctl, ds: () => ctl.state() };
}
const noop = () => {};

describe('stage 8 panels', () => {
  it('the Trace service section lists the steps, every field NOT SET and the UNVERIFIED wording', () => {
    const r = rig(), html = renderToStaticMarkup(h(TraceServiceSection, { ds: r.ds(), ctl: r.ctl, plans: [{ plan_id: 'a'.repeat(32), name: 'plan.pdf', kind: 'pdf' }], locked: false }));
    expect(html).toContain('Trace service'); expect(html).toContain('UNVERIFIED, INDICATIVE ONLY'); expect(html).toContain('PLAN PAGE'); expect(html).toContain('SERVICE DETAILS'); expect(html).toContain('PLAN.PDF');
    expect(html).toContain('Draw service line'); expect(html).not.toMatch(/[–—]/);
  });
  it('after a plan is loaded the calibration controls and the lot corners appear', () => {
    const r = rig(); r.ctl.loadUnderlay({ name: 'p.png', width: 100, height: 100, texture: null });
    // the preview image needs a browser URL, so the markup shows the loaded line and the NOT CALIBRATED note
    const html = renderToStaticMarkup(h(TraceServiceSection, { ds: r.ds(), ctl: r.ctl, plans: [], locked: false }));
    expect(html).toContain('LOADED: P.PNG'); expect(html).toContain('NOT CALIBRATED');
  });
  it('the Sewer and Water tools ask for the user inputs and say how limits are treated', () => {
    const r = rig(), sewer = renderToStaticMarkup(h(SewerSection, { ds: r.ds(), doc: r.ctl.store.doc, ctl: r.ctl, locked: false })), water = renderToStaticMarkup(h(WaterSection, { ds: r.ds(), doc: r.ctl.store.doc, ctl: r.ctl, locked: false }));
    expect(sewer).toContain('Start invert'); expect(sewer).toContain('FROM THE MINIMUM GRADE RULE'); expect(sewer).toContain('NOT VERIFIED'); expect(sewer).toContain('UNRESOLVED');
    expect(water).toContain('Meter easting'.replace('Meter easting', 'METER POSITION')); expect(water).toContain('Rainwater tank'); expect(water).toContain('Cover (m)');
  });
  it('a verification box shows PLAN EXPIRED and UNVERIFIED, INDICATIVE ONLY, then the verifier and date', () => {
    const r = rig(); const s = r.ctl.store;
    const id = s.run('add_object', { type: 'service_existing', points: [at(0, 0), at(5, 0)], params: { plan_expiry_date: { value: '2026-03-05', basis: 'user' } } }).id as string;
    const o = () => s.doc.objects.find((x) => x.id === id)!;
    let html = renderToStaticMarkup(h(ServiceVerifyBox, { o: o(), run: noop, locked: false, today: '2026-04-01' }));
    expect(html).toContain('PLAN EXPIRED'); expect(html).toContain('UNVERIFIED, INDICATIVE ONLY'); expect(html).toContain('05/03/2026'); expect(html).toContain('Mark verified');
    s.run('set_service_verified', { id, verified: true, verified_by: 'JS', date: '2026-02-01' });
    html = renderToStaticMarkup(h(ServiceVerifyBox, { o: o(), run: noop, locked: false, today: '2026-02-02' }));
    expect(html).toContain('VERIFIED</b> 01/02/2026 BY JS'); expect(html).not.toContain('PLAN EXPIRED'); expect(html).toContain('Remove verification');
  });
  it('the route result lists the checks with their requirement keys and the apply buttons', () => {
    const r = rig();
    const ds = { ...r.ds(), route: { kind: 'sewer' as const, status: 'ok' as const, error: '', applied: false, result: {
      schema: 'sewer_proposal.v1' as const, label: 'PROPOSAL', objects: [], route: { pts: [[0, 0], [5, 0]] as [number, number][], length_m: 5 }, grade_pct: 1.5, grade_basis: 'sewer.min_grade_pct', inspection_chainages_m: [2.5],
      connection: { p: [5, 0] as [number, number], label: 'NOT VERIFIED', main_id: null, status: 'FAIL', message: 'THE DRAIN ARRIVES 0.1 M BELOW THE INVERT' },
      profile: [{ chainage_m: 0, x: 0, y: 0, ground_rl: 100, invert_rl: 98, crown_rl: 98.1, cover_m: 1.9, location: 'open_ground' }], notes: ['A NOTE'], summary: { blocking: 1, warning: 0 },
      checks: [{ id: 'a', object_id: 'x', object_type: 'sewer_drain', object_label: '', code: 'DRAIN_GRADE', title: 'DRAIN GRADE', status: 'FAIL' as const, severity: 'blocking' as const, message: 'GRADE BELOW LIMIT', requirements: [{ key: 'sewer.min_grade_pct', value: 1, unit: '%', basis: 'LGA RULE', ref: '' }], basis: 'LGA RULE', value: 0.5, limit: 1, unit: '%' }] } } };
    const html = renderToStaticMarkup(h(RouteResult, { ds, ctl: r.ctl }));
    expect(html).toContain('DRAIN GRADE'); expect(html).toContain('sewer.min_grade_pct'); expect(html).toContain('1.50 %'); expect(html).toContain('LEAST COVER'); expect(html).toContain('1.90 m'); expect(html).toContain('Add to the design'); expect(html).toContain('AT 2.5 m');
  });
  it('the DBYD section says PRIVATE and UNCONFIRMED and needs the confirmation', () => {
    const r = rig(), html = renderToStaticMarkup(h(DbydSection, { ctl: r.ctl, locked: false, plans: [], setPlans: noop }));
    expect(html).toContain('PRIVATE'); expect(html).not.toContain('SANDBOX (MODE'); expect(html).toContain('UNCONFIRMED'); expect(html).toContain('NO SERVER'); expect(html).toContain('I confirm that a real DBYD enquiry');
  });
});

describe('clients', () => {
  const ep = (fn: (url: string, init: RequestInit) => Response) => ({ base: 'http://api', projectId: 'p 1', fetchImpl: (async (u: string, i: RequestInit) => fn(u, i)) as unknown as typeof fetch });
  it('DBYD calls use the project private routes', async () => {
    const seen: { url: string; method?: string; body?: unknown }[] = [];
    const e = ep((url, init) => { seen.push({ url, method: init.method, body: init.body }); return url.includes('/page') ? new Response(new Blob(['png']), { status: 200 }) : new Response(JSON.stringify({ plans: [], enquiries: [], objects: [], mode: 'SANDBOX', refresh_error: null, files_note: '' }), { status: 200 }); });
    await listPlans(e); await listEnquiries(e, true); await lodgeEnquiry(e, { confirm: true, margin_m: 5 }); await parsePlan(e, 'abc', { page: 2 }); await planPage(e, 'abc', 3, 1200);
    await uploadPlan(e, new File(['x'], 'p.pdf', { type: 'application/pdf' }), { job_number: 'J1', asset_owner: '' });
    expect(seen.map((s) => s.url)).toEqual(['http://api/projects/p%201/dbyd/plans', 'http://api/projects/p%201/dbyd/enquiries?refresh=true', 'http://api/projects/p%201/dbyd/enquiry', 'http://api/projects/p%201/dbyd/plans/abc/parse', 'http://api/projects/p%201/dbyd/plans/abc/page?page=3&width_px=1200', 'http://api/projects/p%201/dbyd/plans']);
    expect(JSON.parse(String(seen[2].body))).toEqual({ confirm: true, margin_m: 5 }); expect(seen[5].body).toBeInstanceOf(FormData);
    const fd = seen[5].body as FormData; expect(fd.get('job_number')).toBe('J1'); expect(fd.has('asset_owner')).toBe(false);
  });
  it('an error response carries the server message and code', async () => {
    const e = ep(() => new Response(JSON.stringify({ code: 'BYDA_NOT_CONFIGURED', message: 'BYDA CREDENTIALS ARE NOT CONFIGURED' }), { status: 503 }));
    await expect(lodgeEnquiry(e, { confirm: true, margin_m: 1 })).rejects.toMatchObject({ status: 503, code: 'BYDA_NOT_CONFIGURED', message: 'BYDA CREDENTIALS ARE NOT CONFIGURED' });
    await expect(postSewerRoute(e, { design: emptyDesign('p'), building_id: 'b', start_invert_rl: 1, diameter_mm: 100, connection: {} })).rejects.toBeInstanceOf(EngineHttpError);
  });
  it('route calls post the design to the site-design routes', async () => {
    const urls: string[] = [];
    const e = ep((url) => { urls.push(url); return new Response('{}', { status: 200 }); });
    await postSewerRoute(e, { design: emptyDesign('p'), building_id: 'b', start_invert_rl: 1, diameter_mm: 100, connection: { p: [1, 2] } });
    await postWaterRoute(e, { design: emptyDesign('p'), building_id: 'b', meter_p: [1, 2], diameter_mm: 20, cover_m: 0.5, connection: { main_id: 'm' } });
    expect(urls).toEqual(['http://api/projects/p%201/site-design/sewer-route', 'http://api/projects/p%201/site-design/water-route']);
  });
});
