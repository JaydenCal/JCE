/** Stage 8 review fixes (frontend side). Each test here fails on the code as it was in commit a33f370. */
import { describe, it, expect } from 'vitest';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { OPS, checkTypedParam } from '@/lib/site/ops';
import { SiteDesignStore } from '@/lib/site/store';
import { todayIso } from '@/lib/site/services';
import { dbydModeText } from '@/components/viewer/DbydTools';
import { listEnquiries, resolveEnquiry } from '@/lib/site/dbydApi';
import { VERIFICATION_CLEARED_CODE, emptyDesign, type SiteObject } from '@/lib/site/types';
import { at, seqCtx } from './helpers';

const u = (value: string | number | boolean) => ({ value, basis: 'user' as const });
function verified(pts = [at(0, 0), at(10, 0), at(10, 10)]) {
  const s = new SiteDesignStore(emptyDesign('p'), seqCtx());
  const id = s.run('add_object', { type: 'service_existing', points: pts, status: 'existing', params: { service_kind: u('water'), depth_m: u(0.6), diameter_mm: u(100), material: u('PE'), asset_owner: u('Water Corp') } }).id as string;
  s.run('set_service_verified', { id, verified: true, verified_by: 'J Surveyor', date: '2026-02-01' });
  const o = () => s.doc.objects.find((x) => x.id === id)! as SiteObject;
  return { s, id, o };
}
const cleared = (o: SiteObject) => !o.verified && o.verified_on === undefined && o.issues.some((i) => i.code === VERIFICATION_CLEARED_CODE);

describe('5. today is the Sydney date', () => {
  it('a UTC instant late on the 14th is already the 15th in Sydney (AEDT); a UTC instant before Sydney midnight in winter is the same day', () => {
    expect(todayIso(new Date('2026-10-14T23:30:00Z'))).toBe('2026-10-15');
    expect(todayIso(new Date('2026-06-30T13:59:00Z'))).toBe('2026-06-30');       // AEST (UTC+10): 23:59 on the 30th
    expect(todayIso(new Date('2026-06-30T14:00:00Z'))).toBe('2026-07-01');
  });
});

describe('4. an edit clears the verification', () => {
  it('moving, rotating and every vertex edit clear verified, the date and the name, and say so; one undo restores them', () => {
    for (const [op, args] of [
      ['move_object', { dx: 1, dy: 0 }], ['rotate_object', { angle_deg: 10 }],
      ['edit_vertices', { action: 'move', index: 1, point: at(11, 1) }], ['edit_vertices', { action: 'insert', index: 1, point: at(5, 1) }], ['edit_vertices', { action: 'delete', index: 1 }],
    ] as const) {
      const { s, id, o } = verified();
      s.run(op, { id, ...args });
      expect(cleared(o()), op).toBe(true);
      expect(o().params.verified_by, op).toBeUndefined();
      expect(o().issues.find((i) => i.code === VERIFICATION_CLEARED_CODE)!.message).toContain('VERIFICATION CLEARED BY EDIT');
      s.undo(); expect(o().verified, op).toBe(true); expect(o().verified_on).toBe('2026-02-01'); expect(o().params.verified_by.value).toBe('J Surveyor');
    }
  });
  it('depth, reference, owner, kind, diameter and material clear it; the note and other parameters do not', () => {
    for (const [key, value] of [['depth_m', 0.9], ['depth_reference', 'invert'], ['asset_owner', 'Other'], ['service_kind', 'gas'], ['diameter_mm', 150], ['material', 'DICL']] as const) {
      const { s, id, o } = verified();
      s.run('set_param', { id, key, value });
      expect(cleared(o()), key).toBe(true);
    }
    const { s, id, o } = verified();
    s.run('set_param', { id, key: 'position_tolerance_m', value: 0.5 });
    expect(o().verified).toBe(true);
    s.run('set_param', { id, key: 'depth_m', value: 0.6 });                                    // the same value is no change
    expect(o().verified).toBe(true);
  });
  it('removing a verified parameter clears it', () => {
    const { s, id, o } = verified();
    s.run('remove_param', { id, key: 'depth_m' });
    expect(cleared(o())).toBe(true);
  });
  it('the name cannot be edited while verified, with any value', () => {
    const { s, id } = verified();
    expect(() => s.run('set_param', { id, key: 'verified_by', value: 'Someone else' })).toThrow(/verified_by/);
  });
  it('the cleared-by-edit issue survives the recheck, and verifying again drops it; an already verified service cannot be verified twice', () => {
    const { s, id, o } = verified();
    s.run('move_object', { id, dx: 1, dy: 1 });
    s.run('set_param', { id, key: 'position_tolerance_m', value: 0.4 });                        // a later edit rechecks the object
    expect(o().issues.some((i) => i.code === VERIFICATION_CLEARED_CODE)).toBe(true);
    s.run('set_service_verified', { id, verified: true, verified_by: 'J Surveyor', date: '2026-03-01' });
    expect(o().verified).toBe(true); expect(o().issues.some((i) => i.code === VERIFICATION_CLEARED_CODE)).toBe(false);
    expect(() => s.run('set_service_verified', { id, verified: true, verified_by: 'X', date: '2026-03-02' })).toThrow();
  });
  it('an unverified service is edited freely and gets no note', () => {
    const s = new SiteDesignStore(emptyDesign('p'), seqCtx());
    const id = s.run('add_object', { type: 'service_existing', points: [at(0, 0), at(5, 0)], status: 'existing' }).id as string;
    s.run('move_object', { id, dx: 1, dy: 0 });
    expect(s.doc.objects[0].issues.some((i) => i.code === VERIFICATION_CLEARED_CODE)).toBe(false);
  });
});

describe('11. the plan_indicated and derived bases', () => {
  it('plan_indicated is allowed only for the plan values of a service, derived only for inverts with a ref', () => {
    expect(checkTypedParam('service_existing', 'depth_m', { value: 0.6, basis: 'plan_indicated' }).basis).toBe('plan_indicated');
    expect(() => checkTypedParam('service_existing', 'asset_owner', { value: 'X', basis: 'plan_indicated' })).toThrow();
    expect(() => checkTypedParam('sewer_drain', 'diameter_mm', { value: 100, basis: 'plan_indicated' })).toThrow();
    expect(checkTypedParam('sewer_drain', 'upstream_invert_rl', { value: 98, basis: 'derived', ref: 'sewer.min_grade_pct' }).basis).toBe('derived');
    expect(() => checkTypedParam('sewer_drain', 'diameter_mm', { value: 100, basis: 'derived', ref: 'sewer.min_grade_pct' })).toThrow();
  });
  it('set_param refuses both (they come from the server, not from the user)', () => {
    const { s, id } = verified();
    expect(() => s.run('set_param', { id, key: 'depth_m', value: 1, basis: 'plan_indicated' })).toThrow();
    expect(() => s.run('set_param', { id, key: 'depth_m', value: 1, basis: 'derived', ref: 'x' })).toThrow();
  });
  it('add_service_objects accepts a draft with plan_indicated values and a drain with derived inverts', () => {
    const s = new SiteDesignStore(emptyDesign('p'), seqCtx());
    s.run('add_service_objects', { objects: [
      { id: 'dbyd_1', type: 'service_existing', status: 'existing', origin: 'dbyd', geometry: { kind: 'polyline', pts: [[496000, 6650000], [496010, 6650000]] }, params: { service_kind: { value: 'gas', basis: 'plan_indicated' }, depth_m: { value: 0.6, basis: 'plan_indicated' } } },
      { id: 'drain_1', type: 'sewer_drain', status: 'proposed', geometry: { kind: 'polyline', pts: [[496000, 6650005], [496006, 6650005]] }, params: { diameter_mm: u(100), upstream_invert_rl: u(98), downstream_invert_rl: { value: 97.91, basis: 'derived', ref: 'sewer.min_grade_pct' } } },
    ] });
    expect(s.doc.objects.find((o) => o.id === 'dbyd_1')!.params.depth_m.basis).toBe('plan_indicated');
    expect(s.doc.objects.find((o) => o.id === 'drain_1')!.params.downstream_invert_rl).toEqual({ value: 97.91, basis: 'derived', ref: 'sewer.min_grade_pct' });
    expect(() => s.run('add_service_objects', { objects: [{ id: 'bad', type: 'service_existing', status: 'existing', origin: 'dbyd', geometry: { kind: 'point', p: [496000, 6650000] }, params: { asset_owner: { value: 'X', basis: 'plan_indicated' } } }] })).toThrow();
    expect(OPS.set_param.params.basis).toBeDefined();
  });
});

describe('3. the panel states the BYDA mode accurately', () => {
  it('commercial is not called a sandbox; sandbox says whether live calls are on', () => {
    expect(dbydModeText('COMMERCIAL', true)).not.toContain('SANDBOX');
    expect(dbydModeText('commercial', true)).toContain('COMMERCIAL');
    expect(dbydModeText('SANDBOX', false)).toContain('SANDBOX'); expect(dbydModeText('SANDBOX', false)).toContain('OFF');
    expect(dbydModeText('SANDBOX', true)).toContain('ON');
    expect(dbydModeText('', null)).not.toContain('SANDBOX');
    for (const t of [dbydModeText('SANDBOX', false), dbydModeText('COMMERCIAL', true), dbydModeText('', null)]) expect(t).not.toMatch(/[–—]|\(MODE /);
  });
  it('the clients speak to the list and resolve routes', async () => {
    const seen: { url: string; body?: unknown }[] = [];
    const e = { base: 'http://api', projectId: 'p1', fetchImpl: (async (u: string, i: RequestInit) => { seen.push({ url: u, body: i.body }); return new Response(JSON.stringify({ enquiries: [], mode: 'SANDBOX', live_calls: false, unresolved_lodgement: null, refresh_error: null, files_note: '' }), { status: 200 }); }) as unknown as typeof fetch };
    const q = await listEnquiries(e); expect(q.live_calls).toBe(false);
    await resolveEnquiry(e, 'abc 1', { outcome: 'lodged', job_number: 'J1' });
    expect(seen[1].url).toBe('http://api/projects/p1/dbyd/enquiries/abc%201/resolve'); expect(JSON.parse(String(seen[1].body))).toEqual({ outcome: 'lodged', job_number: 'J1' });
    expect(h).toBeDefined(); expect(renderToStaticMarkup).toBeDefined();
  });
});
