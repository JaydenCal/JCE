/** Stage 7 review fixes: set_param basis rules, the platform default refusal on stage 7 parameters, the pit FAIL and the client and server parity fixture. */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SiteDesignStore } from '@/lib/site/store';
import { applyOp, OpError } from '@/lib/site/ops';
import { computedFor, fieldsFor } from '@/lib/site/siteObjects';
import { PARAM_NUMBERS, emptyDesign, parseDesign, platformDefaultRefused, type SiteObject } from '@/lib/site/types';
import { at, seqCtx } from './helpers';

const PARITY = JSON.parse(readFileSync(join(__dirname, '../../../backend/tests/fixtures/stage7_parity.json'), 'utf8'));

function withTank() {
  const s = new SiteDesignStore(emptyDesign('p'), seqCtx());
  const id = s.run('add_object', { type: 'rwt', points: [at(5, 5)] }).id as string;
  return { s, id };
}

describe('set_param basis rules', () => {
  it('refuses platform_default, with or without a ref, on any object', () => {
    const { s, id } = withTank();
    expect(() => s.run('set_param', { id, key: 'height_m', value: 2, basis: 'platform_default' })).toThrow(/platform default cannot be set/);
    expect(() => s.run('set_param', { id, key: 'height_m', value: 2, basis: 'platform_default', ref: 'PLATFORM DEFAULT, LGA RULE NOT LOADED' })).toThrow(OpError);
    const f = s.run('add_object', { type: 'furniture', points: [at(8, 8)] }).id as string;
    expect(() => s.run('set_param', { id: f, key: 'width_m', value: 1, basis: 'platform_default', ref: 'x' })).toThrow(OpError);
    expect(s.doc.objects[0].params.height_m).toBeUndefined();
  });
  it('requires a requirement key as the ref of an LGA rule, and a blank ref is no ref', () => {
    const { s, id } = withTank();
    expect(() => s.run('set_param', { id, key: 'runoff_coefficient', value: 0.8, basis: 'lga_rule' })).toThrow(/reference/);
    expect(() => s.run('set_param', { id, key: 'runoff_coefficient', value: 0.8, basis: 'lga_rule', ref: '   ' })).toThrow(/reference/);
    s.run('set_param', { id, key: 'runoff_coefficient', value: 0.8, basis: 'lga_rule', ref: ' rwt.runoff_coefficient ' });
    expect(s.doc.objects[0].params.runoff_coefficient).toEqual({ value: 0.8, basis: 'lga_rule', ref: 'rwt.runoff_coefficient' });
  });
  it('applyOp refuses platform_default on set_param (the registry operation the tools call)', () => {
    const { s, id } = withTank();
    expect(() => applyOp(s.doc, 'set_param', { id, key: 'height_m', value: 2, basis: 'platform_default' }, seqCtx())).toThrow(OpError);
  });
  it('add_object refuses a platform default on a stage 7 parameter, as the backend model does, but keeps the OSD psd, a tank size estimate and furniture', () => {
    const d = emptyDesign('p');
    const bad = { type: 'rwt', points: [at(1, 1)], params: { height_m: { value: 2, basis: 'platform_default', ref: 'SOMETHING ELSE' } } };
    expect(() => applyOp(d, 'add_object', bad, seqCtx())).toThrow(/platform default is not accepted/);
    const est = { type: 'rwt', points: [at(1, 1)], params: { height_m: { value: 2, basis: 'platform_default', ref: 'PLAN STUDIO ESTIMATE: size for a non standard capacity' } } };
    expect(applyOp(d, 'add_object', est, seqCtx()).doc.objects).toHaveLength(1);
    const psd = { type: 'osd', points: [at(1, 1)], params: { psd_l_s: { value: 2, basis: 'platform_default', ref: 'PLATFORM DEFAULT, LGA RULE NOT LOADED' } } };
    expect(applyOp(d, 'add_object', psd, seqCtx()).doc.objects).toHaveLength(1);
    expect(platformDefaultRefused('furniture', 'width_m', 'PLAN STUDIO CATALOGUE')).toBe(false);
    expect(platformDefaultRefused('tree', 'height_m', undefined)).toBe(true);
  });
});

describe('tank base level', () => {
  it('is a registered number parameter with a panel field', () => {
    expect(PARAM_NUMBERS.rwt).toContain('base_rl');
    const o = parseDesign({ schema: 'site_design.v1', version: 0, objects: [{ id: 't', type: 'rwt', status: 'proposed', origin: 'user', verified: false, geometry: { kind: 'point', p: [1, 1] }, params: {}, issues: [] }] }).objects[0];
    expect(fieldsFor(o).some((f) => f.key === 'base_rl')).toBe(true);
  });
});

describe('client and server parity (tests/fixtures/stage7_parity.json)', () => {
  const g = PARITY.ground as { origin_n: number; z0: number; slope_y: number };
  const sample = (_e: number, n: number) => g.z0 + g.slope_y * (n - g.origin_n);
  const doc = parseDesign(PARITY.doc);
  const byId = (id: string): SiteObject => doc.objects.find((o) => o.id === id)!;
  for (const x of PARITY.expected as { object: string; key: string; value?: number; tol?: number; status?: string }[]) {
    it(`${x.object} ${x.key}`, () => {
      const c = computedFor(byId(x.object), sample).find((v) => v.key === x.key);
      expect(c, 'a computed value').toBeTruthy();
      if (x.status) { expect(c!.status).toBe(x.status); expect(c!.amount).toBeUndefined(); } else { expect(c!.status).toBeUndefined(); expect(c!.amount).toBeCloseTo(x.value!, Math.round(-Math.log10(x.tol!))); }
    });
  }
});
