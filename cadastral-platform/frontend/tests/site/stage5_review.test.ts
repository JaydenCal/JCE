/** Stage 5 review fixes on the client: stored imports, AI exclusion, building use NOT SET, tank cap, to_be_removed rules. */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { OPS, OpError, applyOp, toolSchemas } from '@/lib/site/ops';
import { parseImportPayload } from '@/lib/site/buildings';
import type { SiteDesign, SiteObject } from '@/lib/site/types';
import { saveSiteDesign, SiteDesignHttpError } from '@/lib/site/persist';
import { IMPORT_ID, at, doc0, seqCtx } from './helpers';

const RAW = JSON.parse(readFileSync(join(__dirname, '../../../backend/tests/fixtures/building_import_planstudio.json'), 'utf8'));
const pay = () => structuredClone(RAW);
const AT = at(10, 20);
const run = (doc: SiteDesign, args: Record<string, unknown>) => applyOp(doc, 'place_building', { payload: pay(), at: AT, ...args }, seqCtx());
const bld = (d: SiteDesign): SiteObject => d.objects.find((o) => o.type === 'building')!;

describe('place_building needs a stored import', () => {
  it('refuses a call without a valid import_id', () => {
    for (const bad of [undefined, '', 'not-an-id', 'AB'.repeat(16), 'ab'.repeat(15), 42]) {
      expect(() => run(doc0(), { import_id: bad }), String(bad)).toThrow(OpError);
    }
    expect(() => run(doc0(), { import_id: IMPORT_ID, payload: { ...pay(), import_id: 'cd'.repeat(16) } })).toThrow(/does not match/);
  });
  it('stores the import id on the building so the server can check it against the stored import', () => {
    const d = run(doc0(), { import_id: IMPORT_ID }).doc;
    expect(bld(d).building!.import_id).toBe(IMPORT_ID);
    expect(bld(run(doc0(), { import_id: IMPORT_ID, payload: { ...pay(), import_id: IMPORT_ID } }).doc).building!.import_id).toBe(IMPORT_ID);
  });
  it('cannot invent levels, a roof area, a floor level or a height that look imported: only the payload facts are copied, FFL and height start NOT SET', () => {
    const p = pay();
    p.building.params.evil = { value: 99, basis: 'user', ref: 'IMPORTED FROM PLAN STUDIO' };
    const o = bld(run(doc0(), { import_id: IMPORT_ID, payload: p }).doc);
    expect(o.params.evil).toBeUndefined();
    expect(o.params.ffl_rl).toEqual({ value: null, basis: 'unresolved' });
    expect(o.params.height_m).toEqual({ value: null, basis: 'unresolved' });
  });
});

describe('the AI cannot place buildings', () => {
  it('place_building is in the registry for the mouse tools but not in the tool schemas; moving existing buildings stays', () => {
    expect(OPS.place_building).toBeTruthy();
    const names = toolSchemas().map((t) => t.name);
    expect(names).not.toContain('place_building');
    expect(names).toEqual(expect.arrayContaining(['move_object', 'rotate_object', 'set_param', 'set_status']));
  });
});

describe('building use', () => {
  it('a missing building use is NOT SET (unresolved), not other', () => {
    const p = pay(); delete p.building.params.building_use;
    const u = bld(run(doc0(), { import_id: IMPORT_ID, payload: p }).doc).params.building_use;
    expect(u).toEqual({ value: null, basis: 'unresolved' });
    const p2 = pay(); p2.building.params.building_use = { basis: 'unresolved' };
    expect(bld(run(doc0(), { import_id: IMPORT_ID, payload: p2 }).doc).params.building_use).toEqual({ value: null, basis: 'unresolved' });
    expect(bld(run(doc0(), { import_id: IMPORT_ID }).doc).params.building_use.value).toBe('house');            // a use the import gives is kept
  });
});

describe('tanks', () => {
  it('more than 64 tanks is refused with a message, never cut to 64', () => {
    const p = pay(); p.extras = Array.from({ length: 65 }, () => structuredClone(RAW.extras[0]));
    expect(() => parseImportPayload(p)).toThrow(/65 rainwater tanks.*64/);
    p.extras.length = 64;
    expect(parseImportPayload(p).extras).toHaveLength(64);
    expect(run(doc0(), { import_id: IMPORT_ID, payload: p }).doc.objects.filter((o) => o.type === 'rwt')).toHaveLength(64);
  });
  it('a Plan Studio estimate keeps its basis and label when placed', () => {
    const rwt = run(doc0(), { import_id: IMPORT_ID }).doc.objects.find((o) => o.type === 'rwt')!;
    expect(rwt.params.diameter_m.basis).toBe('platform_default');
    expect(rwt.params.diameter_m.ref).toMatch(/^PLAN STUDIO ESTIMATE/);
  });
});

describe('to_be_removed for a building', () => {
  it('place_building refuses it and set_status allows it for an existing building only', () => {
    expect(() => run(doc0(), { import_id: IMPORT_ID, status: 'to_be_removed' })).toThrow(OpError);
    const proposed = run(doc0(), { import_id: IMPORT_ID, status: 'proposed' }).doc, id = bld(proposed).id;
    expect(() => applyOp(proposed, 'set_status', { id, status: 'to_be_removed' }, seqCtx())).toThrow(/only an existing building/);
    const existing = run(doc0(), { import_id: IMPORT_ID, status: 'existing' }).doc, eid = bld(existing).id;
    const gone = applyOp(existing, 'set_status', { id: eid, status: 'to_be_removed' }, seqCtx()).doc;
    expect(bld(gone).status).toBe('to_be_removed');
    expect(bld(applyOp(gone, 'set_status', { id: eid, status: 'existing' }, seqCtx()).doc).status).toBe('existing');
    // other object types are unaffected
    const tree = applyOp(doc0(), 'add_object', { type: 'tree', points: [AT] }, seqCtx()).doc;
    expect(applyOp(tree, 'set_status', { id: tree.objects[0].id, status: 'to_be_removed' }, seqCtx()).doc.objects[0].status).toBe('to_be_removed');
  });
});

describe('saving', () => {
  it('shows the server reason when a building is refused on save', async () => {
    const body = { code: 'BUILDING_IMPORT_MISMATCH', message: 'BUILDING building_1 DOES NOT MATCH ITS IMPORT (levels).' };
    const fetchImpl = (async () => new Response(JSON.stringify(body), { status: 422 })) as unknown as typeof fetch;
    await expect(saveSiteDesign({ base: 'http://x', projectId: 'p', fetchImpl }, doc0())).rejects.toMatchObject({ status: 422, message: body.message });
    await expect(saveSiteDesign({ base: 'http://x', projectId: 'p', fetchImpl: (async () => new Response('nope', { status: 500 })) as unknown as typeof fetch }, doc0())).rejects.toBeInstanceOf(SiteDesignHttpError);
  });
});
