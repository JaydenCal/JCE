/**
 * Drift check between the TypeScript operation registry and the Pydantic model, in both directions:
 *  - this test builds a document ONLY through registry operations and compares it with the committed golden file
 *    backend/tests/fixtures/site_design_v1_frontend.json (so a change in what the frontend produces fails here until the golden file is
 *    regenerated with UPDATE_SITE_FIXTURE=1);
 *  - backend/tests/test_site_design.py validates that golden file with the Pydantic model (so a change the backend would refuse fails there);
 *  - the existing backend fixture is parsed and edited by the frontend in persist.test.ts.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { SiteDesignStore } from '@/lib/site/store';
import { emptyDesign, OBJECT_TYPES } from '@/lib/site/types';
import { at, IMPORT_ID, seqCtx } from './helpers';

const GOLDEN = join(__dirname, '../../../backend/tests/fixtures/site_design_v1_frontend.json');
const PAYLOAD = join(__dirname, '../../../backend/tests/fixtures/building_import_planstudio.json');
const LOT: [number, number][] = [[496000, 6650000], [496030, 6650000], [496030, 6650030], [496000, 6650030]];

function build() {
  const s = new SiteDesignStore(emptyDesign('11111111-1111-4111-8111-111111111111'), seqCtx());
  s.setEnv({ lot: LOT, terrain: { available: true, sample: () => 100 } });
  const pts = (n: number) => Array.from({ length: n }, (_, i) => at(2 + 3 * i, 2 + (i % 2) * 4));
  const ring = [at(1, 1), at(9, 1), at(9, 9), at(1, 9)];
  s.run('add_object', { type: 'tree', points: [at(5, 5)], yaw_deg: 380, label: 'Existing tree', status: 'existing' });
  s.run('add_object', { type: 'rwt', points: [at(7, 5)] });
  s.run('add_object', { type: 'stormwater_pit', points: [at(8, 5)], origin: 'ai_proposal' });
  s.run('add_object', { type: 'osd', points: [at(9, 5)], status: 'to_be_removed' });
  s.run('add_object', { type: 'retaining_wall', points: [at(1, 20), { ...at(10, 20), z: 21.5 }, at(10, 25)], status: 'proposed' });
  s.run('add_object', { type: 'infiltration_trench', points: pts(3) });
  s.run('add_object', { type: 'stormwater_pipe', points: pts(2) });
  s.run('add_object', { type: 'service_trace', points: pts(4) });
  s.run('add_object', { type: 'landscape_area', points: ring });
  s.run('add_object', { type: 'grading_area', points: ring });
  s.run('add_object', { type: 'osd_basin', points: [at(40, 40), at(50, 40), at(50, 50)] });                  // outside the lot: carries an OUTSIDE_LOT issue
  s.run('set_param', { id: 'tree_1', key: 'height_m', value: 8.5 });
  s.run('set_param', { id: 'tree_1', key: 'canopy_diameter_m', value: null });                                 // UNRESOLVED keeps an explicit null
  s.run('set_param', { id: 'tree_1', key: 'species', value: 'Eucalyptus' });
  s.run('set_param', { id: 'tree_1', key: 'protected', value: true });
  s.run('set_param', { id: 'retaining_wall_5', key: 'height_m', value: 0.6, basis: 'lga_rule', ref: 'retaining_wall.max_height_m' });
  s.run('set_param', { id: 'landscape_area_9', key: 'surface_kind', value: 'turf' });                 // a platform default cannot be set (set_param refuses it)
  s.run('set_param', { id: 'stormwater_pit_3', key: 'text_at_limit', value: 'x'.repeat(200) });
  s.run('duplicate_object', { id: 'tree_1', dx: 1, dy: 1 });
  s.run('reject_proposal', { id: 'stormwater_pit_3' });
  s.run('move_object', { id: 'osd_4', dx: 0.5, dy: -0.25 });
  s.run('rotate_object', { id: 'rwt_2', angle_deg: 45 });
  s.run('edit_vertices', { id: 'infiltration_trench_6', action: 'insert', index: 1, point: at(6, 6) });
  s.run('remove_param', { id: 'tree_1', key: 'protected' });
  // stage 5: a building from the importer payload (SYNTHETIC TEST FIXTURE), moved and turned; a pool, two footpaths and an item of furniture
  const payload = JSON.parse(readFileSync(PAYLOAD, 'utf8'));
  const placed = s.run('place_building', { import_id: IMPORT_ID, payload, at: at(15, 14), yaw_deg: 20, glb_name: 'house.glb' });
  s.run('set_param', { id: placed.id, key: 'ffl_rl', value: 101.35 });
  s.run('move_object', { id: placed.id, dx: 0.5, dy: 0.25 });
  s.run('rotate_object', { id: placed.id, angle_deg: 10 });
  s.run('add_object', { type: 'pool', points: [at(20, 2), at(26, 2), at(26, 6), at(20, 6)] });
  s.run('add_object', { type: 'footpath', points: [at(2, 28), at(12, 28), at(12, 26)], params: { width_m: { value: 1.2, basis: 'user' }, surface_kind: { value: 'permeable_pavers', basis: 'user' } } });
  s.run('add_object', { type: 'footpath', shape: 'polygon', points: [at(14, 26), at(20, 26), at(20, 28), at(14, 28)] });
  const f = s.run('add_object', { type: 'furniture', points: [at(22, 10)], yaw_deg: 15 });
  s.run('set_catalogue_item', { id: f.id, item_id: 'plan_studio:bbq', source_ref: 'PLAN STUDIO CATALOGUE', width_m: 1.3, depth_m: 0.56, height_m: 1.15 });
  s.run('set_param', { id: 'landscape_area_9', key: 'surface_kind', value: 'garden_bed' });
  // stage 6: a driveway from the kerb to the building (width, surface, a user batter), its crossover moved, its end linked to the building; a grading area with a target
  const dv = s.run('add_object', { type: 'driveway', points: [at(6, 0), at(6, 8), at(14, 12)] });
  s.run('set_param', { id: dv.id, key: 'width_m', value: 3.2 });
  s.run('set_param', { id: dv.id, key: 'surface_kind', value: 'concrete' });
  s.run('set_param', { id: dv.id, key: 'batter_fill_h_per_v', value: 3 });
  s.run('set_driveway_crossover', { id: dv.id, point: at(7, 0), translate: false });
  s.run('link_driveway_end', { id: dv.id, building_id: placed.id });
  s.run('set_param', { id: 'grading_area_10', key: 'target_level_m', value: 100.5 });
  s.run('set_param', { id: 'grading_area_10', key: 'batter_cut_h_per_v', value: 2 });
  // stage 7: typed parameters (shape, true or false, ISO date, object links), per vertex wall levels, a pool barrier and an overflow route
  s.run('set_param', { id: 'rwt_2', key: 'shape', value: 'slimline' });
  for (const [k, v] of [['length_m', 2.4], ['width_m', 0.6], ['height_m', 1.9], ['capacity_l', 2000], ['inlet_rl', 100.4], ['connected_roof_area_m2', 60]] as const) s.run('set_param', { id: 'rwt_2', key: k, value: v });
  s.run('set_param', { id: 'rwt_2', key: 'reuse_toilet', value: true });
  s.run('set_param', { id: 'rwt_2', key: 'reuse_garden', value: false });
  s.run('set_param', { id: 'rwt_2', key: 'roof_building_id', value: placed.id });
  s.run('set_param', { id: 'retaining_wall_5', key: 'wall_type', value: 'block' });
  s.run('set_vertex_rl', { id: 'retaining_wall_5', index: 0, top: 101.5, bottom: 100.2 });
  s.run('set_vertex_rl', { id: 'retaining_wall_5', index: 2, top: 101.0 });                                  // a level that is NOT SET stays null
  s.run('set_param', { id: 'infiltration_trench_6', key: 'infiltration_basis', value: 'site_test' });
  s.run('set_param', { id: 'infiltration_trench_6', key: 'test_date', value: '2026-03-04' });
  s.run('set_param', { id: 'infiltration_trench_6', key: 'void_ratio', value: 0.35 });
  s.run('set_param', { id: 'osd_4', key: 'form', value: 'below_ground' });
  s.run('set_param', { id: 'tree_1', key: 'trunk_diameter_mm', value: 450 });
  s.run('set_param', { id: 'stormwater_pipe_7', key: 'diameter_mm', value: 225 });
  s.run('set_param', { id: 'stormwater_pipe_7', key: 'upstream_invert_rl', value: 99.2 });
  const pool = s.doc.objects.find((o) => o.type === 'pool')!;
  const bar = s.run('add_object', { type: 'pool_barrier', points: [at(19, 1), at(27, 1), at(27, 7), at(19, 7)], params: { height_m: { value: 1.2, basis: 'user' } } });
  s.run('set_param', { id: bar.id, key: 'pool_id', value: pool.id });
  const ov = s.run('add_object', { type: 'overflow_route', points: [at(9, 5), at(9, 12), at(12, 20)] });
  s.run('set_param', { id: ov.id, key: 'osd_id', value: 'osd_4' });
  const fp = s.doc.objects.find((o) => o.type === 'footpath' && o.geometry.kind === 'polyline')!;
  s.run('set_param', { id: fp.id, key: 'impervious', value: false });
  s.run('set_param', { id: fp.id, key: 'crossfall_pct', value: 2 });
  // stage 8: a traced and verified sewer main, a DBYD draft (origin dbyd, unverified), a water main as a point, a drain with inspection openings, a water service, and a footing depth
  const sm = s.run('add_object', { type: 'service_existing', points: [at(2, 15), at(28, 15)], status: 'existing', label: 'Sewer main', params: {
    service_kind: { value: 'sewer', basis: 'user' }, asset_owner: { value: 'Water Corp', basis: 'user' }, diameter_mm: { value: 225, basis: 'user' }, material: { value: 'VC', basis: 'user' },
    depth_m: { value: 2.4, basis: 'user' }, depth_basis: { value: 'potholed', basis: 'user' }, depth_reference: { value: 'invert', basis: 'user' }, position_tolerance_m: { value: 0.3, basis: 'user' },
    dbyd_job_number: { value: 'DBYD-TEST-1', basis: 'user' }, plan_date: { value: '2026-01-05', basis: 'user' }, plan_expiry_date: { value: '2026-03-05', basis: 'user' }, source_file: { value: 'plan.pdf', basis: 'user' } } });
  s.run('set_service_verified', { id: sm.id, verified: true, verified_by: 'J Surveyor', date: '2026-02-01' });
  s.run('add_service_objects', { objects: [
    { id: 'dbyd_a1', type: 'service_existing', status: 'existing', origin: 'dbyd', label: 'GAS (DBYD DRAFT)', geometry: { kind: 'polyline', pts: [[496002, 6650005], [496028, 6650005]] },
      params: { service_kind: { value: 'gas', basis: 'plan_indicated', ref: 'DBYD PLAN PARSE, UNVERIFIED DRAFT' }, depth_m: { value: 0.6, basis: 'plan_indicated' }, depth_basis: { value: 'plan_indicated', basis: 'plan_indicated' }, source_file: { value: 'plan.pdf', basis: 'plan_indicated' } } },
    { id: 'dbyd_a2', type: 'service_existing', status: 'existing', origin: 'dbyd', geometry: { kind: 'point', p: [496010, 6650020] }, params: { service_kind: { value: 'water', basis: 'plan_indicated' } } },
    { id: 'drain_a', type: 'sewer_drain', status: 'proposed', geometry: { kind: 'polyline', pts: [[496012, 6650012], [496016, 6650015]] }, params: { diameter_mm: { value: 100, basis: 'user' }, upstream_invert_rl: { value: 98.6, basis: 'user' }, downstream_invert_rl: { value: 98.5, basis: 'derived', ref: 'sewer.min_grade_pct' }, building_id: { value: placed.id, basis: 'user' } } },
    { id: 'node_a', type: 'service_node', status: 'proposed', geometry: { kind: 'point', p: [496016, 6650015] }, params: { node_kind: { value: 'sewer_connection', basis: 'user' }, main_id: { value: sm.id, basis: 'user' }, invert_rl: { value: 98.5, basis: 'user' } } },
    { id: 'water_a', type: 'water_service', status: 'proposed', geometry: { kind: 'polyline', pts: [[496010, 6650020], [496012, 6650014]] }, params: { diameter_mm: { value: 20, basis: 'user' }, cover_m: { value: 0.5, basis: 'user' }, main_id: { value: 'dbyd_a1', basis: 'user' }, rwt_id: { value: 'rwt_2', basis: 'user' } } },
  ] });
  s.run('set_param', { id: 'tree_1', key: 'footing_depth_m', value: 0.8 });
  return s.doc;
}

describe('frontend output vs the Pydantic model (golden file)', () => {
  it('covers all twenty two object types, a vertex z, every basis and an issue', () => {
    const d = build();
    expect(OBJECT_TYPES).toHaveLength(22);
    expect(new Set(d.objects.map((o) => o.type))).toEqual(new Set(OBJECT_TYPES));
    expect(d.objects.some((o) => o.type === 'footpath' && o.geometry.kind === 'polygon')).toBe(true);
    expect(d.objects.some((o) => o.geometry.kind === 'polyline' && o.geometry.pts.some((p) => p.length === 3))).toBe(true);
    expect(new Set(d.objects.flatMap((o) => Object.values(o.params).map((p) => p.basis)))).toEqual(new Set(['user', 'lga_rule', 'platform_default', 'unresolved', 'plan_indicated', 'derived']));
    expect(d.objects.some((o) => o.issues.length > 0)).toBe(true);
  });
  it('matches the committed golden file the backend test validates (UPDATE_SITE_FIXTURE=1 regenerates it)', () => {
    const text = JSON.stringify(build(), null, 2) + '\n';
    if (process.env.UPDATE_SITE_FIXTURE === '1') writeFileSync(GOLDEN, text);
    expect(readFileSync(GOLDEN, 'utf8')).toBe(text);
  });
});
