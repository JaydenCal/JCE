import { describe, it, expect } from 'vitest';
import { OPS, OpError, applyOp, runBatch, toolSchemas, parseParam } from '@/lib/site/ops';
import { applyPatch } from '@/lib/site/patch';
import { OBJECT_TYPES, OBJECT_KINDS, type SiteDesign } from '@/lib/site/types';
import { at, doc0, rect, seqCtx } from './helpers';

const ctx = () => seqCtx();
/** Apply an op and check that its inverse restores the previous document exactly. */
function roundTrip(doc: SiteDesign, name: string, args: Record<string, unknown>, c = ctx()) {
  const before = structuredClone(doc), r = applyOp(doc, name, args, c);
  expect(doc).toEqual(before);                                   // run never mutates
  expect(r.patch.length).toBeGreaterThan(0);
  expect(applyPatch(r.doc, r.inverse).doc).toEqual(before);
  return r;
}
function seeded() {
  let d = doc0(); const c = ctx();
  d = applyOp(d, 'add_object', { type: 'tree', points: [at(5, 5)], yaw_deg: 30 }, c).doc;                          // tree_1
  d = applyOp(d, 'add_object', { type: 'retaining_wall', points: [at(0, 0), at(10, 0), at(10, 10)] }, c).doc;      // retaining_wall_2
  d = applyOp(d, 'add_object', { type: 'landscape_area', points: rect(0, 0, 10, 10) }, c).doc;                     // landscape_area_3
  d = applyOp(d, 'add_object', { type: 'osd', points: [at(2, 2)], origin: 'ai_proposal' }, c).doc;                  // osd_4
  return d;
}

const STAGE5 = ['building', 'pool', 'footpath', 'furniture', 'driveway', 'service_existing', 'sewer_drain', 'service_node', 'water_service'];       // later stages: their own tests below
describe('add_object', () => {
  it('adds each of the eleven stage 4 types with the right geometry and no invented parameters', () => {
    for (const type of OBJECT_TYPES.filter((t) => !STAGE5.includes(t))) {
      const kind = OBJECT_KINDS[type].geometry;
      const pts = kind === 'point' ? [at(1, 1)] : kind === 'polyline' ? [at(0, 0), at(3, 0)] : rect(0, 0, 3, 3);
      const r = roundTrip(doc0(), 'add_object', { type, points: pts });
      const o = r.doc.objects[0];
      expect(o.type).toBe(type); expect(o.geometry.kind).toBe(kind); expect(o.params).toEqual({}); expect(o.issues).toEqual([]);
      expect(o.status).toBe('proposed'); expect(o.origin).toBe('user'); expect(o.verified).toBe(false); expect(o.accepted).toBeUndefined();
    }
  });
  it('stores MGA metres with optional z and a point yaw', () => {
    const r = applyOp(doc0(), 'add_object', { type: 'tree', points: [{ e: 1, n: 2, z: 3 }], yaw_deg: 375 }, ctx());
    expect(r.doc.objects[0].geometry).toEqual({ kind: 'point', p: [1, 2, 3], yaw_deg: 15 });
  });
  it('ai_proposal starts pending; params keep their basis', () => {
    const r = applyOp(doc0(), 'add_object', { type: 'tree', points: [at(0, 0)], origin: 'ai_proposal', params: { height_m: { value: 6, basis: 'lga_rule', ref: 'tree.h' }, canopy_diameter_m: { basis: 'unresolved' } } }, ctx());
    const o = r.doc.objects[0];
    expect(o.accepted).toBe('pending'); expect(o.params.height_m).toEqual({ value: 6, basis: 'lga_rule', ref: 'tree.h' }); expect(o.params.canopy_diameter_m).toEqual({ value: null, basis: 'unresolved' });
  });
  it('drops a repeated closing vertex of a polygon', () => {
    const ring = rect(0, 0, 4, 4); const r = applyOp(doc0(), 'add_object', { type: 'landscape_area', points: [...ring, ring[0]] }, ctx());
    expect((r.doc.objects[0].geometry as { ring: unknown[] }).ring).toHaveLength(4);
  });
  it('refuses wrong vertex counts, bad numbers, bad params, duplicate ids', () => {
    const bad: Record<string, unknown>[] = [
      { type: 'house', points: [at(0, 0)] }, { type: 'tree', points: [] }, { type: 'tree', points: [at(0, 0), at(1, 1)] },
      { type: 'retaining_wall', points: [at(0, 0)] }, { type: 'landscape_area', points: [at(0, 0), at(1, 1)] },
      { type: 'tree', points: [{ e: 'x', n: 1 }] }, { type: 'tree', points: [{ e: NaN, n: 1 }] }, { type: 'tree', points: 'nope' },
      { type: 'retaining_wall', points: [at(0, 0), at(1, 1)], yaw_deg: 10 },
      { type: 'tree', points: [at(0, 0)], origin: 'dbyd' }, { type: 'tree', points: [at(0, 0)], status: 'gone' },
      { type: 'tree', points: [at(0, 0)], params: { H: { value: 1, basis: 'user' } } },
      { type: 'tree', points: [at(0, 0)], params: { h: { value: 1, basis: 'lga_rule' } } },
      { type: 'tree', points: [at(0, 0)], params: { h: { value: 1, basis: 'unresolved' } } },
      { type: 'tree', points: [at(0, 0)], params: { h: { basis: 'user' } } },
      { type: 'tree', points: [at(0, 0)], id: 'bad id' },
    ];
    for (const a of bad) expect(() => applyOp(doc0(), 'add_object', a, ctx()), JSON.stringify(a)).toThrow(OpError);
    const d = seeded();
    expect(() => applyOp(d, 'add_object', { type: 'tree', points: [at(0, 0)], id: 'tree_1' }, ctx())).toThrow(/already in use/);
  });
  it('never reuses an id that is taken', () => {
    const d = seeded(), c = { newId: (() => { const q = ['tree_1', 'tree_1', 'fresh']; return () => q.shift()!; })() };
    expect(applyOp(d, 'add_object', { type: 'tree', points: [at(0, 0)] }, c).result.id).toBe('fresh');
  });
});

describe('move_object, rotate_object', () => {
  it('moves points, lines and areas, keeping explicit z', () => {
    const d = seeded();
    expect(roundTrip(d, 'move_object', { id: 'tree_1', dx: 2, dy: -1 }).doc.objects[0].geometry).toMatchObject({ p: [496007, 6650004] });
    const w = roundTrip(d, 'move_object', { id: 'retaining_wall_2', dx: 1, dy: 1 }).doc.objects[1].geometry as { pts: number[][] };
    expect(w.pts[1]).toEqual([496011, 6650001]);
    const z = applyOp(applyOp(doc0(), 'add_object', { type: 'retaining_wall', points: [{ e: 0, n: 0, z: 5 }, { e: 1, n: 0 }] }, ctx()).doc, 'move_object', { id: 'retaining_wall_1', dx: 1, dy: 1 }).doc;
    expect((z.objects[0].geometry as { pts: number[][] }).pts).toEqual([[1, 1, 5], [2, 1]]);
  });
  it('a zero move is an empty patch (no undo step)', () => {
    expect(applyOp(seeded(), 'move_object', { id: 'tree_1', dx: 0, dy: 0 }, ctx()).patch).toEqual([]);
  });
  it('rotates a point by changing its yaw (clockwise), and a line about its centre', () => {
    const d = seeded();
    expect((roundTrip(d, 'rotate_object', { id: 'tree_1', angle_deg: 15 }).doc.objects[0].geometry as { yaw_deg: number }).yaw_deg).toBe(45);
    expect((roundTrip(d, 'rotate_object', { id: 'tree_1', angle_deg: -45 }).doc.objects[0].geometry as { yaw_deg: number }).yaw_deg).toBe(345);
    const sq = applyOp(doc0(), 'add_object', { type: 'landscape_area', points: [{ e: 0, n: 0 }, { e: 2, n: 0 }, { e: 2, n: 2 }, { e: 0, n: 2 }] }, ctx()).doc;
    const r = applyOp(sq, 'rotate_object', { id: 'landscape_area_1', angle_deg: 90 }, ctx()).doc.objects[0].geometry as { ring: number[][] };
    // clockwise 90 about (1,1): (0,0) -> (0,2)
    expect(r.ring[0][0]).toBeCloseTo(0); expect(r.ring[0][1]).toBeCloseTo(2);
    roundTrip(seeded(), 'rotate_object', { id: 'retaining_wall_2', angle_deg: 15, about: { e: 496000, n: 6650000 } });
  });
});

describe('edit_vertices', () => {
  it('inserts, moves and deletes a vertex; every step has an inverse', () => {
    const d = seeded();
    const ins = roundTrip(d, 'edit_vertices', { id: 'retaining_wall_2', action: 'insert', index: 1, point: at(5, 0) }).doc.objects[1].geometry as { pts: number[][] };
    expect(ins.pts).toHaveLength(4); expect(ins.pts[1]).toEqual([496005, 6650000]);
    expect((roundTrip(d, 'edit_vertices', { id: 'retaining_wall_2', action: 'insert', index: 3, point: at(10, 20) }).doc.objects[1].geometry as { pts: unknown[] }).pts).toHaveLength(4);   // append
    expect((roundTrip(d, 'edit_vertices', { id: 'landscape_area_3', action: 'move', index: 2, point: at(12, 12) }).doc.objects[2].geometry as { ring: number[][] }).ring[2]).toEqual([496012, 6650012]);
    expect((roundTrip(d, 'edit_vertices', { id: 'retaining_wall_2', action: 'delete', index: 0 }).doc.objects[1].geometry as { pts: unknown[] }).pts).toHaveLength(2);
    expect((roundTrip(d, 'edit_vertices', { id: 'landscape_area_3', action: 'delete', index: 3 }).doc.objects[2].geometry as { ring: unknown[] }).ring).toHaveLength(3);
  });
  it('refuses points, bad indices and deleting below the minimum', () => {
    const d = seeded();
    for (const a of [
      { id: 'tree_1', action: 'move', index: 0, point: at(0, 0) }, { id: 'retaining_wall_2', action: 'move', index: 3, point: at(0, 0) }, { id: 'retaining_wall_2', action: 'insert', index: 4, point: at(0, 0) },
      { id: 'retaining_wall_2', action: 'move', index: 0 }, { id: 'retaining_wall_2', action: 'spin', index: 0 }, { id: 'retaining_wall_2', action: 'delete', index: 1.5 }, { id: 'nope', action: 'delete', index: 0 },
    ]) expect(() => applyOp(d, 'edit_vertices', a, ctx()), JSON.stringify(a)).toThrow(OpError);
    const two = applyOp(d, 'edit_vertices', { id: 'retaining_wall_2', action: 'delete', index: 0 }, ctx()).doc;
    expect(() => applyOp(two, 'edit_vertices', { id: 'retaining_wall_2', action: 'delete', index: 0 }, ctx())).toThrow(/at least 2/);
    const tri = applyOp(d, 'edit_vertices', { id: 'landscape_area_3', action: 'delete', index: 0 }, ctx()).doc;
    expect(() => applyOp(tri, 'edit_vertices', { id: 'landscape_area_3', action: 'delete', index: 0 }, ctx())).toThrow(/at least 3/);
  });
});

describe('set_param, set_status, delete, duplicate, accept, reject', () => {
  it('set_param adds then replaces, defaults the basis, and unsets to UNRESOLVED', () => {
    const d = seeded();
    const a = roundTrip(d, 'set_param', { id: 'tree_1', key: 'height_m', value: 8.5 });
    expect(a.doc.objects[0].params.height_m).toEqual({ value: 8.5, basis: 'user' });
    const b = roundTrip(a.doc, 'set_param', { id: 'tree_1', key: 'height_m', value: 9 });
    expect(b.doc.objects[0].params.height_m.value).toBe(9);
    const c = roundTrip(b.doc, 'set_param', { id: 'tree_1', key: 'height_m' });
    expect(c.doc.objects[0].params.height_m).toEqual({ value: null, basis: 'unresolved' });
    const e = roundTrip(d, 'set_param', { id: 'tree_1', key: 'surface', value: 'turf', basis: 'lga_rule', ref: 'landscape.runoff_coefficient.turf' });
    expect(e.doc.objects[0].params.surface).toEqual({ value: 'turf', basis: 'lga_rule', ref: 'landscape.runoff_coefficient.turf' });
    expect(() => applyOp(d, 'set_param', { id: 'tree_1', key: 'x', value: 1, basis: 'lga_rule' }, ctx())).toThrow(OpError);
    expect(() => applyOp(d, 'set_param', { id: 'tree_1', key: 'Bad Key', value: 1 }, ctx())).toThrow(OpError);
    expect(() => applyOp(d, 'set_param', { id: 'tree_1', key: 'x', value: { a: 1 } }, ctx())).toThrow(OpError);
    expect(() => parseParam('k', null)).toThrow(OpError);
  });
  it('set_status', () => {
    const d = seeded();
    expect(roundTrip(d, 'set_status', { id: 'tree_1', status: 'to_be_removed' }).doc.objects[0].status).toBe('to_be_removed');
    expect(applyOp(d, 'set_status', { id: 'tree_1', status: 'proposed' }, ctx()).patch).toEqual([]);       // already proposed
    expect(() => applyOp(d, 'set_status', { id: 'tree_1', status: 'gone' }, ctx())).toThrow(OpError);
  });
  it('delete_object removes and the inverse restores it at the same place', () => {
    const d = seeded();
    const r = roundTrip(d, 'delete_object', { id: 'retaining_wall_2' });
    expect(r.doc.objects.map((o) => o.id)).toEqual(['tree_1', 'landscape_area_3', 'osd_4']);
    expect(() => applyOp(d, 'delete_object', { id: 'nope' }, ctx())).toThrow(/No object/);
  });
  it('duplicate_object copies parameters, offsets, and resets origin, verified and issues', () => {
    let d = seeded(); d = applyOp(d, 'set_param', { id: 'osd_4', key: 'width_m', value: 2 }, ctx()).doc;
    const r = roundTrip(d, 'duplicate_object', { id: 'osd_4', dx: 3, dy: 4 }, ctx());
    const o = r.doc.objects[4];
    expect(o.id).not.toBe('osd_4'); expect(o.origin).toBe('user'); expect(o.accepted).toBeUndefined(); expect(o.params.width_m.value).toBe(2); expect(o.geometry).toMatchObject({ p: [496005, 6650006] });
    expect(r.doc.objects[3].geometry).toMatchObject({ p: [496002, 6650002] });
  });
  it('accept and reject apply to AI proposals only', () => {
    const d = seeded();
    expect(roundTrip(d, 'accept_proposal', { id: 'osd_4' }).doc.objects[3].accepted).toBe('accepted');
    expect(roundTrip(d, 'reject_proposal', { id: 'osd_4' }).doc.objects[3].accepted).toBe('rejected');
    expect(() => applyOp(d, 'accept_proposal', { id: 'tree_1' }, ctx())).toThrow(/not an AI proposal/);
    const acc = applyOp(d, 'accept_proposal', { id: 'osd_4' }, ctx()).doc;
    expect(applyOp(acc, 'accept_proposal', { id: 'osd_4' }, ctx()).patch).toEqual([]);
    expect(roundTrip(acc, 'reject_proposal', { id: 'osd_4' }).doc.objects[3].accepted).toBe('rejected');
  });
  it('unknown operation', () => { expect(() => applyOp(doc0(), 'explode', {}, ctx())).toThrow(/Unknown operation/); });
});

describe('runBatch', () => {
  it('one combined patch and inverse, later steps see earlier ones, failures are reported and skipped', () => {
    const d = seeded(), before = structuredClone(d);
    const r = runBatch(d, [
      { op: 'add_object', args: { type: 'rwt', points: [at(7, 7)], id: 'tank_a' } },
      { op: 'set_param', args: { id: 'tank_a', key: 'diameter_m', value: 2 } },        // uses the id created one step earlier
      { op: 'move_object', args: { id: 'nope', dx: 1, dy: 1 } },                        // fails
      { op: 'delete_object', args: { id: 'tree_1' } },
    ], ctx());
    expect(r.results.map((x) => x.ok)).toEqual([true, true, false, true]);
    expect(r.results[2]).toMatchObject({ ok: false, error: expect.stringContaining('No object') });
    expect(r.doc.objects.map((o) => o.id)).toEqual(['retaining_wall_2', 'landscape_area_3', 'osd_4', 'tank_a']);
    expect(r.doc.objects[3].params.diameter_m.value).toBe(2);
    expect(d).toEqual(before);
    expect(applyPatch(r.doc, r.inverse).doc).toEqual(before);                           // the single inverse undoes the whole batch
  });
  it('an empty or all failing batch has an empty patch', () => {
    expect(runBatch(seeded(), [], ctx()).patch).toEqual([]);
    expect(runBatch(seeded(), [{ op: 'delete_object', args: { id: 'zz' } }], ctx()).patch).toEqual([]);
  });
});

describe('toolSchemas', () => {
  const tools = toolSchemas();
  it('has one Anthropic tool definition per registry operation', () => {
    expect(tools.map((t) => t.name).sort()).toEqual(['add_object', 'delete_object', 'duplicate_object', 'edit_vertices', 'link_driveway_end', 'move_object', 'remove_param', 'rotate_object', 'set_catalogue_item', 'set_driveway_crossover', 'set_param', 'set_status', 'set_vertex_rl', 'clear_vertex_rls'].sort());
    expect(tools.map((t) => t.name)).toEqual(Object.keys(OPS).filter((k) => OPS[k].ai !== false));       // place_building, set_service_verified and add_service_objects are not offered to the AI
  });
  it('each tool has name, description and an object input_schema whose required keys are properties', () => {
    for (const t of tools) {
      expect(t.name).toMatch(/^[a-z_]+$/); expect(t.description.length).toBeGreaterThan(10);
      expect(t.input_schema.type).toBe('object');
      for (const k of t.input_schema.required) expect(Object.keys(t.input_schema.properties)).toContain(k);
      expect(JSON.parse(JSON.stringify(t))).toEqual(t);                                   // plain JSON, ready for the API
    }
    const add = tools.find((t) => t.name === 'add_object')!;
    expect(add.input_schema.properties.type.enum).toEqual(OBJECT_TYPES.filter((t) => t !== 'building'));       // a building is imported, not added
    expect(add.input_schema.required).toEqual(['type', 'points']);
  });
  it('returns copies: mutating a schema does not change the registry', () => {
    tools[0].input_schema.properties.zzz = { type: 'string' };
    expect(toolSchemas()[0].input_schema.properties.zzz).toBeUndefined();
  });
});
