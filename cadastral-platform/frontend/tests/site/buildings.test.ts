/**
 * Stage 5: buildings and the new site object types, through the operation registry.
 * The payload is the backend importer's output for a SYNTHETIC TEST FIXTURE Plan Studio file (backend/tests/fixtures/building_import_planstudio.json;
 * backend/tests/test_building_import.py checks it against the importer, so the two sides cannot drift apart).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { OpError, applyOp, parseParam } from '@/lib/site/ops';
import { applyPatch } from '@/lib/site/patch';
import { parseImportPayload } from '@/lib/site/buildings';
import { SiteDesignStore } from '@/lib/site/store';
import { signedArea, polygonArea, rotateClockwise, ringCentroid } from '@/lib/site/geom';
import {
  BUILDING_USES, FOOTPATH_SURFACES, OBJECT_KINDS, SURFACE_KINDS, dimensionsSet, levelOf, parseDesign, emptyDesign, type Pos, type SiteDesign, type SiteObject,
} from '@/lib/site/types';
import { at, doc0, E0, IMPORT_ID, N0, rect, seqCtx } from './helpers';

const PAYLOAD = JSON.parse(readFileSync(join(__dirname, '../../../backend/tests/fixtures/building_import_planstudio.json'), 'utf8'));
const pay = () => structuredClone(PAYLOAD);
const ctx = () => seqCtx();
const AT = at(10, 20);

function place(args: Record<string, unknown> = {}, doc: SiteDesign = doc0()) {
  return applyOp(doc, 'place_building', { import_id: IMPORT_ID, payload: pay(), at: AT, ...args }, ctx());
}
const bld = (d: SiteDesign) => d.objects.find((o) => o.type === 'building')!;
const close = (a: readonly number[], b: readonly number[], tol = 1e-6) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i], -Math.log10(tol)));
function roundTrip(doc: SiteDesign, name: string, args: Record<string, unknown>) {
  const before = structuredClone(doc), r = applyOp(doc, name, args, ctx());
  expect(doc).toEqual(before);
  expect(applyPatch(r.doc, r.inverse).doc).toEqual(before);
  return r;
}

describe('import payload', () => {
  it('parses the importer output', () => {
    const p = parseImportPayload(pay());
    expect(p.schema).toBe('building_import.v1');
    expect(p.building.levels[0].rings[0]).toHaveLength(6);
    expect(p.extras).toHaveLength(1);
  });
  it('refuses a wrong schema, no levels, a bad point and a bad datum', () => {
    for (const mut of [
      (p: any) => { p.schema = 'x'; }, (p: any) => { p.building.levels = []; }, (p: any) => { p.building.levels[0].rings[0][0] = ['a', 1]; },
      (p: any) => { p.building.datum_index = 5; }, (p: any) => { p.building.levels[0].rings[0].length = 2; }, (p: any) => { p.ref = null; },
      (p: any) => { p.extras[0].type = 'tree'; }, (p: any) => { p.source = 'email'; },
    ]) { const p = pay(); mut(p); expect(() => parseImportPayload(p)).toThrow(OpError); }
    expect(() => parseImportPayload(null)).toThrow(OpError);
  });
});

describe('place_building', () => {
  it('places the footprint with the reference point at the clicked position, true north up, keeping size and shape', () => {
    const r = place(), o = bld(r.doc), p = PAYLOAD;
    expect(o.geometry.kind).toBe('polygon');
    const src = p.building.levels[0].rings[0] as [number, number][];
    const ring = (o.geometry as { ring: Pos[] }).ring;
    expect(ring).toHaveLength(src.length);
    ring.forEach((q, i) => close(q, [AT.e + src[i][0] - p.ref[0], AT.n + src[i][1] - p.ref[1]]));
    expect(polygonArea(ring)).toBeCloseTo(41.84, 6);
    expect(o.building!.frame.yaw_deg).toBe(0);
    close(o.building!.frame.origin, [AT.e - p.ref[0], AT.n - p.ref[1]]);
    expect(o.building!.frame.north_deg).toBe(30);
  });
  it('turns a building clockwise by yaw_deg about the reference point', () => {
    const r = place({ yaw_deg: 90 }), o = bld(r.doc), src = PAYLOAD.building.levels[0].rings[0] as [number, number][];
    (o.geometry as { ring: Pos[] }).ring.forEach((q, i) => {
      const dx = src[i][0] - PAYLOAD.ref[0], dy = src[i][1] - PAYLOAD.ref[1];
      close(q, [AT.e + dy, AT.n - dx]);                    // 90 degrees clockwise (east and north): (dx, dy) -> (dy, -dx)
    });
    expect(o.building!.frame.yaw_deg).toBe(90);
    expect(Math.abs(signedArea((o.geometry as { ring: Pos[] }).ring))).toBeCloseTo(41.84, 6);
  });
  it('copies levels, roof outline and exit points through the same transform, read only', () => {
    const o = bld(place({ yaw_deg: 30 }).doc), b = o.building!;
    expect(b.levels).toHaveLength(1);
    expect(b.levels[0].elevation_m).toBe(0);
    expect(b.roof_outline).toHaveLength(1);
    expect(b.exits.downpipes).toHaveLength(1);
    expect(b.exits.sewer).toHaveLength(1);
    expect(b.exits.water).toHaveLength(1);
    // an exit point has the same offset from the footprint centroid as in the payload, turned by the yaw
    const src = PAYLOAD.building.exits.downpipes[0] as [number, number];
    const expected = rotateClockwise([AT.e + src[0] - PAYLOAD.ref[0], AT.n + src[1] - PAYLOAD.ref[1]], AT.e, AT.n, 30);
    close(b.exits.downpipes[0], expected);
    expect(polygonArea(b.roof_outline![0])).toBeCloseTo(polygonArea(PAYLOAD.building.roof_outline[0]), 6);
  });
  it('never invents data: FFL, height unresolved; roof area and its basis from the source', () => {
    const o = bld(place().doc);
    expect(o.params.ffl_rl).toEqual({ value: null, basis: 'unresolved' });
    expect(o.params.height_m).toEqual({ value: null, basis: 'unresolved' });
    expect(levelOf(o, 'ffl_rl')).toBeNull();
    expect(o.params.roof_plan_area_m2.value).toBe(54);
    expect(o.params.roof_area_basis.value).toBe('APPROXIMATE (PLAN STUDIO RASTER)');
    expect(o.params.building_use.value).toBe('house');
    expect(o.origin).toBe('imported');
    expect(o.verified).toBe(false);
    expect(o.status).toBe('proposed');
    expect(o.building!.notes.join(' ')).toContain('NOT SET');
  });
  it('adds a tank that came with the building as an rwt with its capacity, in the same undo step', () => {
    const r = place({ yaw_deg: 0 });
    expect(r.doc.objects.map((o) => o.type)).toEqual(['building', 'rwt']);
    const t = r.doc.objects[1];
    expect(t.params.capacity_l.value).toBe(5000);
    expect(t.params.inlet_level_m).toBeUndefined();
    expect(t.origin).toBe('imported');
    close((t.geometry as { p: Pos }).p, [AT.e + 7.062177826491071 - PAYLOAD.ref[0], AT.n + 1.7679491924311221 - PAYLOAD.ref[1]]);
    expect(r.result.tanks).toEqual(['rwt_2']);
    expect(applyPatch(r.doc, r.inverse).doc).toEqual(doc0());
  });
  it('is one exact undo step and does not mutate the document', () => {
    roundTrip(doc0(), 'place_building', { import_id: IMPORT_ID, payload: pay(), at: AT, yaw_deg: 45, glb_name: 'house.glb' });
  });
  it('records the GLB name and a label, and refuses a bad payload, position, status and id', () => {
    const o = bld(place({ glb_name: 'house.glb', label: 'Main house' }).doc);
    expect(o.building!.glb_name).toBe('house.glb'); expect(o.label).toBe('Main house');
    expect(() => applyOp(doc0(), 'place_building', { import_id: IMPORT_ID, payload: { schema: 'x' }, at: AT }, ctx())).toThrow(OpError);
    expect(() => applyOp(doc0(), 'place_building', { import_id: IMPORT_ID, payload: pay() }, ctx())).toThrow(OpError);
    expect(() => place({ status: 'to_be_removed' })).toThrow(OpError);
    expect(() => place({ id: 'bad id' })).toThrow(OpError);
    const d = place({ id: 'b1' }).doc;
    expect(() => place({ id: 'b1' }, d)).toThrow(/already in use/);
  });
  it('takes the building use from the import, or leaves it NOT SET to be chosen (never other)', () => {
    const p = pay(); delete p.building.params.building_use;
    const o = bld(applyOp(doc0(), 'place_building', { import_id: IMPORT_ID, payload: p, at: AT }, ctx()).doc);
    expect(o.params.building_use).toEqual({ value: null, basis: 'unresolved' });
  });
  it('ignores parameters an import is not allowed to set', () => {
    const p = pay(); p.building.params.evil = { value: 1, basis: 'user' };
    expect(bld(applyOp(doc0(), 'place_building', { import_id: IMPORT_ID, payload: p, at: AT }, ctx()).doc).params.evil).toBeUndefined();
  });
});

describe('moving and turning a building', () => {
  const placed = () => place().doc;
  it('move_object moves the footprint, levels, roof, exits and frame together', () => {
    const d0 = placed(), o0 = bld(d0), r = roundTrip(d0, 'move_object', { id: o0.id, dx: 3, dy: -2 }), o = bld(r.doc);
    close((o.geometry as { ring: Pos[] }).ring[0], [(o0.geometry as { ring: Pos[] }).ring[0][0] + 3, (o0.geometry as { ring: Pos[] }).ring[0][1] - 2]);
    close(o.building!.levels[0].rings[0][2], [o0.building!.levels[0].rings[0][2][0] + 3, o0.building!.levels[0].rings[0][2][1] - 2]);
    close(o.building!.roof_outline![0][0], [o0.building!.roof_outline![0][0][0] + 3, o0.building!.roof_outline![0][0][1] - 2]);
    close(o.building!.exits.sewer[0], [o0.building!.exits.sewer[0][0] + 3, o0.building!.exits.sewer[0][1] - 2]);
    close(o.building!.frame.origin, [o0.building!.frame.origin[0] + 3, o0.building!.frame.origin[1] - 2]);
    expect(o.building!.levels[0].rings[0]).toHaveLength(o0.building!.levels[0].rings[0].length);
  });
  it('rotate_object turns everything about the footprint centre and adds to the frame yaw', () => {
    const d0 = placed(), o0 = bld(d0), r = roundTrip(d0, 'rotate_object', { id: o0.id, angle_deg: 30 }), o = bld(r.doc);
    expect(o.building!.frame.yaw_deg).toBeCloseTo(30, 9);
    expect(polygonArea((o.geometry as { ring: Pos[] }).ring)).toBeCloseTo(41.84, 6);
    expect(polygonArea(o.building!.roof_outline![0])).toBeCloseTo(polygonArea(o0.building!.roof_outline![0]), 6);
    const r2 = applyOp(r.doc, 'rotate_object', { id: o0.id, angle_deg: -30 }, ctx());
    const back = bld(r2.doc);
    expect(back.building!.frame.yaw_deg).toBeCloseTo(0, 9);
    close((back.geometry as { ring: Pos[] }).ring[1], (o0.geometry as { ring: Pos[] }).ring[1], 1e-7);
  });
  it('geometry is otherwise read only: no vertex edits, no add_object building', () => {
    const d = placed();
    expect(() => applyOp(d, 'edit_vertices', { id: bld(d).id, action: 'move', index: 0, point: { e: 1, n: 1 } }, ctx())).toThrow(/read only/);
    expect(() => applyOp(d, 'add_object', { type: 'building', points: rect(0, 0, 5, 5) }, ctx())).toThrow(/imported/);
  });
  it('duplicate copies the building block along with the footprint', () => {
    const d = placed(), r = applyOp(d, 'duplicate_object', { id: bld(d).id, dx: 5, dy: 5 }, ctx()), copy = r.doc.objects.find((o) => o.id === r.result.id)!;
    close(copy.building!.frame.origin, [bld(d).building!.frame.origin[0] + 5, bld(d).building!.frame.origin[1] + 5]);
    close(copy.building!.levels[0].rings[0][0], [bld(d).building!.levels[0].rings[0][0][0] + 5, bld(d).building!.levels[0].rings[0][0][1] + 5]);
    expect(copy.origin).toBe('user');
  });
});

describe('geometry precision at MGA magnitudes', () => {
  it('area and centroid of a ring at E 496000, N 6650000 are accurate to millimetres', () => {
    const ring: Pos[] = [[E0 + 0.5, N0 + 0.25], [E0 + 12.5, N0 + 0.25], [E0 + 12.5, N0 + 7.25], [E0 + 0.5, N0 + 7.25]];
    expect(polygonArea(ring)).toBeCloseTo(84, 9);
    close(ringCentroid(ring), [E0 + 6.5, N0 + 3.75], 1e-9);
  });
});

describe('building parameters', () => {
  const placed = () => place().doc;
  it('ffl_rl is set by the user as an absolute number and can be cleared', () => {
    const d = placed(), id = bld(d).id;
    const r = roundTrip(d, 'set_param', { id, key: 'ffl_rl', value: 101.35 });
    expect(levelOf(bld(r.doc), 'ffl_rl')).toBe(101.35);
    expect(bld(r.doc).params.ffl_rl.basis).toBe('user');
    expect(levelOf(bld(applyOp(r.doc, 'set_param', { id, key: 'ffl_rl', value: null }, ctx()).doc), 'ffl_rl')).toBeNull();
    expect(levelOf(bld(applyOp(d, 'set_param', { id, key: 'ffl_rl', value: -0.5 }, ctx()).doc), 'ffl_rl')).toBe(-0.5);      // an RL below datum is a number
  });
  it('typed parameters are checked: numbers must be numbers, text must be in its list', () => {
    const d = placed(), id = bld(d).id;
    expect(() => applyOp(d, 'set_param', { id, key: 'ffl_rl', value: 'high' }, ctx())).toThrow(/must be a number/);
    expect(() => applyOp(d, 'set_param', { id, key: 'height_m', value: true }, ctx())).toThrow(/must be a number/);
    expect(() => applyOp(d, 'set_param', { id, key: 'building_use', value: 'palace' }, ctx())).toThrow(/must be one of/);
    for (const u of BUILDING_USES) expect(bld(applyOp(d, 'set_param', { id, key: 'building_use', value: u }, ctx()).doc).params.building_use.value).toBe(u);
  });
  it('imported source facts cannot be edited by hand', () => {
    const d = placed(), id = bld(d).id;
    for (const key of ['roof_plan_area_m2', 'roof_area_basis', 'source', 'source_file']) {
      expect(() => applyOp(d, 'set_param', { id, key, value: 'x' }, ctx())).toThrow(OpError);
      expect(() => applyOp(d, 'remove_param', { id, key }, ctx())).toThrow(OpError);
    }
  });
  it('a building survives the document round trip (parseDesign) with its block intact', () => {
    const d = placed(), back = parseDesign(JSON.parse(JSON.stringify(d)));
    expect(back).toEqual(d);
  });
  it('checks run on the footprint through the store', () => {
    const s = new SiteDesignStore(emptyDesign('p'), ctx());
    s.setEnv({ lot: [[E0, N0], [E0 + 30, N0], [E0 + 30, N0 + 30], [E0, N0 + 30]], terrain: { available: true, sample: () => 100 } });
    s.run('place_building', { import_id: IMPORT_ID, payload: pay(), at: at(15, 15) });
    expect(s.doc.objects[0].issues.map((i) => i.code)).toEqual([]);
    s.run('move_object', { id: 'building_1', dx: 40, dy: 0 });
    expect(s.doc.objects[0].issues.map((i) => i.code)).toContain('OUTSIDE_LOT');
    s.undo(); s.undo();
    expect(s.doc.objects).toHaveLength(0);
  });
});

describe('pool, footpath, garden and furniture', () => {
  it('a pool starts with depth, coping width and barrier requirements UNRESOLVED', () => {
    const o = applyOp(doc0(), 'add_object', { type: 'pool', points: rect(0, 0, 8, 4) }, ctx()).doc.objects[0];
    expect(o.geometry.kind).toBe('polygon');
    for (const k of ['depth_m', 'coping_width_m', 'water_level_rl', 'barrier_requirements']) expect(o.params[k]).toEqual({ value: null, basis: 'unresolved' });
    expect(dimensionsSet(o)).toBe(false);
    const set = applyOp(doc0(), 'add_object', { type: 'pool', points: rect(0, 0, 8, 4), params: { depth_m: { value: 1.4, basis: 'user' } } }, ctx()).doc.objects[0];
    expect(dimensionsSet(set)).toBe(false);                                                                  // coping width and water level are still NOT SET
    const full = applyOp(doc0(), 'add_object', { type: 'pool', points: rect(0, 0, 8, 4), params: { depth_m: { value: 1.4, basis: 'user' }, coping_width_m: { value: 0.3, basis: 'user' }, water_level_rl: { value: 100.2, basis: 'user' } } }, ctx()).doc.objects[0];
    expect(dimensionsSet(full)).toBe(true);
    expect(() => applyOp(doc0(), 'add_object', { type: 'pool', points: rect(0, 0, 8, 4), params: { depth_m: { value: 'deep', basis: 'user' } } }, ctx())).toThrow(/must be a number/);
  });
  it('a footpath is a line with a width, or an area; the surface kind is NOT SET by default', () => {
    const line = applyOp(doc0(), 'add_object', { type: 'footpath', points: [at(0, 0), at(10, 0)] }, ctx()).doc.objects[0];
    expect(line.geometry.kind).toBe('polyline');
    expect(line.params.width_m).toEqual({ value: null, basis: 'unresolved' });
    expect(line.params.surface_kind).toEqual({ value: null, basis: 'unresolved' });
    expect(dimensionsSet(line)).toBe(false);
    const area = applyOp(doc0(), 'add_object', { type: 'footpath', shape: 'polygon', points: rect(0, 0, 10, 1.2) }, ctx()).doc.objects[0];
    expect(area.geometry.kind).toBe('polygon');
    expect(area.params.width_m).toBeUndefined();
    expect(dimensionsSet(area)).toBe(true);                                   // an area has no width to set
    expect(() => applyOp(doc0(), 'add_object', { type: 'tree', shape: 'polygon', points: rect(0, 0, 1, 1) }, ctx())).toThrow(OpError);   // only a footpath may change shape
    for (const k of FOOTPATH_SURFACES) expect(applyOp(doc0(), 'add_object', { type: 'footpath', points: [at(0, 0), at(5, 0)], params: { surface_kind: { value: k, basis: 'user' } } }, ctx()).doc.objects[0].params.surface_kind.value).toBe(k);
    expect(() => applyOp(doc0(), 'add_object', { type: 'footpath', points: [at(0, 0), at(5, 0)], params: { surface_kind: { value: 'lava', basis: 'user' } } }, ctx())).toThrow(/must be one of/);
    expect(FOOTPATH_SURFACES).toEqual(['concrete', 'pavers', 'gravel', 'permeable_pavers']);
  });
  it('a garden is a landscape area with surface kind garden_bed; all six kinds are accepted', () => {
    expect([...SURFACE_KINDS]).toEqual(['turf', 'garden_bed', 'mulch', 'gravel', 'permeable_paving', 'impervious_paving']);
    const d = applyOp(doc0(), 'add_object', { type: 'landscape_area', points: rect(0, 0, 6, 6) }, ctx()).doc;
    expect(d.objects[0].params).toEqual({});                                 // no default surface kind
    for (const k of SURFACE_KINDS) expect(applyOp(d, 'set_param', { id: d.objects[0].id, key: 'surface_kind', value: k }, ctx()).doc.objects[0].params.surface_kind.value).toBe(k);
    expect(() => applyOp(d, 'set_param', { id: d.objects[0].id, key: 'surface_kind', value: 'lawn' }, ctx())).toThrow(/must be one of/);
  });
  it('furniture is sized from the catalogue dimensions only; otherwise DIMENSIONS NOT SET', () => {
    const d = applyOp(doc0(), 'add_object', { type: 'furniture', points: [at(2, 2)], yaw_deg: 20 }, ctx()).doc, id = d.objects[0].id;
    expect(d.objects[0].params.catalogue_item).toEqual({ value: null, basis: 'unresolved' });
    expect(dimensionsSet(d.objects[0])).toBe(false);
    const r = roundTrip(d, 'set_catalogue_item', { id, item_id: 'plan_studio:bbq', source_ref: 'PLAN STUDIO CATALOGUE', width_m: 1.3, depth_m: 0.56, height_m: 1.15 });
    const o = r.doc.objects[0];
    expect(o.params.catalogue_item.value).toBe('plan_studio:bbq');
    expect(o.params.width_m).toEqual({ value: 1.3, basis: 'platform_default', ref: 'PLAN STUDIO CATALOGUE: plan_studio:bbq' });
    expect(dimensionsSet(o)).toBe(true);
    const partial = applyOp(d, 'set_catalogue_item', { id, item_id: 'x1', width_m: 1, depth_m: 0 }, ctx()).doc.objects[0];
    expect(partial.params.depth_m.basis).toBe('unresolved'); expect(partial.params.height_m.basis).toBe('unresolved');
    expect(dimensionsSet(partial)).toBe(false);
    const again = applyOp(r.doc, 'set_catalogue_item', { id, item_id: 'other' }, ctx()).doc.objects[0];                  // switching to an item with no dimensions clears them
    expect(again.params.width_m.basis).toBe('unresolved');
    expect(() => applyOp(doc0(), 'set_catalogue_item', { id: 'nope', item_id: 'x' }, ctx())).toThrow(OpError);
    const tree = applyOp(doc0(), 'add_object', { type: 'tree', points: [at(1, 1)] }, ctx()).doc;
    expect(() => applyOp(tree, 'set_catalogue_item', { id: tree.objects[0].id, item_id: 'x' }, ctx())).toThrow(/not a furniture/);
  });
  it('the new types are registered with the right geometry', () => {
    expect(OBJECT_KINDS.building.geometry).toBe('polygon'); expect(OBJECT_KINDS.pool.geometry).toBe('polygon');
    expect(OBJECT_KINDS.footpath.geometry).toBe('polyline'); expect(OBJECT_KINDS.footpath.alt).toBe('polygon');
    expect(OBJECT_KINDS.furniture.geometry).toBe('point');
    expect(parseParam('depth_m', { value: null, basis: 'unresolved' })).toEqual({ value: null, basis: 'unresolved' });
  });
});

describe('type guard on loaded documents', () => {
  it('parseDesign accepts the new types', () => {
    const o: SiteObject = { id: 'f1', type: 'furniture', status: 'proposed', origin: 'user', verified: false, geometry: { kind: 'point', p: [1, 2] }, params: {}, issues: [] };
    expect(parseDesign({ schema: 'site_design.v1', version: 1, objects: [o] }).objects[0].type).toBe('furniture');
  });
});
