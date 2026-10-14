/** Stage 9: the stormwater panel data mapping, the entries, the session (server calls), the overland layer in 3D and the panel markup.
 *  The two JSON files in tests/fixtures are SYNTHETIC TEST FIXTURES written by the backend from a synthetic design, a synthetic rainfall table and fake rule values. */
import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
vi.mock('@/lib/viewer/textures', async () => { const T = await import('three'); return { makeSprite: () => new T.Sprite(), makeTextures: () => ({}) }; });
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  EMPTY_FORM, basisBadge, catchmentRows, formFromInputs, infiltrationView, inputsPayload, missingGroups, osdView, overlandView, peakView, prePostView, rainfallView, routingView, valueText, valueView,
  type StormwaterResult, type SwOverland,
} from '@/lib/site/stormwater';
import { StormwaterSession } from '@/lib/site/stormwaterSession';
import { postAnalyse, postUpload } from '@/lib/site/stormwaterApi';
import { buildOverlandLayer, overlandLabelText, ribbonWidth, FLOW_LABEL } from '@/lib/site/overlandScene';
import { SiteScene } from '@/lib/site/siteScene';
import { DesignController } from '@/lib/site/designController';
import { SiteDesignStore } from '@/lib/site/store';
import { emptyDesign, OBJECT_KINDS, PARAM_LINKS, PARAM_ENUMS, DISCHARGE_KINDS } from '@/lib/site/types';
import { fieldsFor, extraLabelLines } from '@/lib/site/siteObjects';
import { StormwaterSection } from '@/components/viewer/StormwaterPanel';
import type { Built } from '@/lib/viewer/sceneBuilder';
import { E0, N0, at, seqCtx } from './helpers';

const load = (n: string) => JSON.parse(readFileSync(join(__dirname, '../fixtures', n), 'utf8')) as StormwaterResult;
const FULL = load('stormwater_full.json'), UNRES = load('stormwater_unresolved.json');
const DASH = /[–—]/;
const strings = (x: unknown): string[] => (typeof x === 'string' ? [x] : Array.isArray(x) ? x.flatMap(strings) : x && typeof x === 'object' ? Object.values(x).flatMap(strings) : []);

describe('basis badges and value wording', () => {
  it('maps each basis to a tone: a platform default is a warning, UNRESOLVED is bad, a rule or an entry is ok', () => {
    expect(basisBadge('PLATFORM DEFAULT')).toEqual({ text: 'PLATFORM DEFAULT', tone: 'warn' });
    expect(basisBadge('UNRESOLVED').tone).toBe('bad');
    expect(basisBadge('LGA RULE').tone).toBe('ok'); expect(basisBadge('USER').tone).toBe('ok'); expect(basisBadge('DATA SOURCE').tone).toBe('ok');
    expect(basisBadge('CALCULATED').tone).toBe('neutral');
  });
  it('writes a value, a true or false value and an unresolved value; an unresolved value carries how to supply it', () => {
    expect(valueText({ value: 2, unit: 'L/s' })).toBe('2.000 L/s'); expect(valueText({ value: true })).toBe('YES'); expect(valueText({ value: null })).toBe('UNRESOLVED');
    const v = valueView({ value: null, basis: 'UNRESOLVED', ref: 'NOT FOUND', how: 'Load the key.', key: 'stormwater.psd_l_s' });
    expect(v.text).toBe('UNRESOLVED'); expect(v.how).toBe('Load the key.'); expect(v.key).toBe('stormwater.psd_l_s'); expect(v.basis.tone).toBe('bad');
  });
  it('a stamp of a platform default is kept beside the value', () => {
    const psd = FULL.osd.inputs.find((i) => i.symbol === 'PSD')!, v = valueView(psd);
    expect(v.text).toBe('2.000 L/s'); expect(v.basis.text).toBe('PLATFORM DEFAULT'); expect(v.stamp).toContain('PLATFORM DEFAULT'); expect(v.key).toBe('stormwater.psd_l_s');
  });
});

describe('catchment, comparison and routing', () => {
  it('lists the post development rows with area, runoff, C x A and the route', () => {
    const rows = catchmentRows(FULL), roof = rows.find((r) => r.id === 'b1')!;
    expect(roof.area).toBe('360.0 m2'); expect(roof.runoff.text).toBe('1.000'); expect(roof.runoff.basis.text).toBe('USER'); expect(roof.ca).toBe('360.00 m2'); expect(roof.route).toBe('osd1 to dp1');
    expect(roof.routeBasis).toBe('LINKED'); expect(roof.areaBasis).toContain('FOOTPRINT');
  });
  it('an unresolved runoff coefficient and a missing route are flagged and C x A is NOT EVALUATED', () => {
    const rows = catchmentRows(UNRES), roof = rows.find((r) => r.id === 'b1')!;
    expect(roof.runoff.text).toBe('UNRESOLVED'); expect(roof.runoff.how).toContain('runoff coefficient'); expect(roof.ca).toBe('NOT EVALUATED'); expect(roof.unresolved).toBe(true);
  });
  it('the pre development set is shown when existing surfaces are marked and NOT SET otherwise', () => {
    const pp = prePostView(FULL.catchment.comparison);
    expect(pp.pre).not.toBeNull(); expect(pp.pre!.total).toBe('90.0 m2'); expect(pp.post.total).toBe('450.0 m2');
    const none = prePostView({ ...FULL.catchment.comparison, pre_status: 'NOT SET', pre_message: 'NO SURFACE IS MARKED EXISTING.' });
    expect(none.pre).toBeNull(); expect(none.preMessage).toContain('NOT SET');
  });
  it('totals say INCOMPLETE while a coefficient is unresolved', () => {
    const pp = prePostView(UNRES.catchment.comparison);
    expect(pp.post.complete).toBe(false); expect(pp.post.ca).toContain('INCOMPLETE'); expect(pp.post.c).toBe('NOT EVALUATED');
  });
  it('routing groups the rows by destination', () => {
    const r = routingView(FULL);
    expect(r.length).toBeGreaterThan(0); expect(r[0].destination).toBe('DP1'); expect(r[0].rows[0].path).toContain('to');
  });
});

describe('OSD sizing, peak flows and infiltration views', () => {
  it('the evaluated sizing shows the steps with formula, inputs with basis and the result', () => {
    const o = osdView(FULL.osd);
    expect(o.status).toBe('EVALUATED'); expect(o.tone).toBe('ok'); expect(o.required_text).toBe('4.400 m3'); expect(o.critical).toBe('20 min');
    expect(o.steps.map((s) => s.id)).toEqual(['inflow', 'storage', 'critical']);
    const st = o.steps[1]; expect(st.formula).toContain('PSD'); expect(st.inputs.map((i) => i.symbol)).toContain('Tc'); expect(st.result).toContain('4.400 m3'); expect(st.table.length).toBe(5);
    expect(o.method.text).toBe('MASS_BALANCE_MODIFIED_RATIONAL'); expect(o.required.text).toBe('YES'); expect(o.required.stamp).toContain('PLATFORM DEFAULT');
  });
  it('the comparison with the placed storage is ok, short or not evaluated', () => {
    expect(osdView(FULL.osd).comparison).toEqual({ text: expect.stringContaining('PROVIDED 4.000 M3'), tone: 'bad' });
    const enough = osdView({ ...FULL.osd, comparison: { ...FULL.osd.comparison!, status: 'PROVIDED STORAGE IS ENOUGH' } });
    expect(enough.comparison!.tone).toBe('ok');
    expect(osdView({ ...FULL.osd, comparison: null }).comparison).toBeNull();
  });
  it('the orifice is given only when evaluated; otherwise NOT EVALUATED with what is missing', () => {
    expect(osdView(FULL.osd).orifice.text).toContain('mm');
    const un = osdView(UNRES.osd).orifice;
    expect(un.status).toBe('NOT EVALUATED'); expect(un.text.startsWith('NOT EVALUATED')).toBe(true);
    const miss = osdView({ ...FULL.osd, orifice: { status: 'NOT EVALUATED', diameter_mm: null, formula: 'F', inputs: [], missing: [{ what: 'DISCHARGE COEFFICIENT (Cd)', key: 'stormwater.discharge_coefficient', how: 'Enter it.' } as never] } }).orifice;
    expect(miss.text).toBe('NOT EVALUATED: DISCHARGE COEFFICIENT (Cd)');
  });
  it('a sizing that is not evaluated still shows the inputs that did resolve, each with a basis', () => {
    const o = osdView(UNRES.osd);
    expect(o.status).toBe('NOT EVALUATED'); expect(o.tone).toBe('bad'); expect(o.steps).toEqual([]); expect(o.required_text).toBe('NOT EVALUATED'); expect(o.message).toContain('NOT EVALUATED');
    const psd = o.inputs.find((i) => i.symbol === 'PSD')!; expect(psd.text).toBe('UNRESOLVED'); expect(psd.how).toContain('stormwater.psd_l_s');
  });
  it('peak flows show the rational method result or the reason it was not evaluated', () => {
    const p = peakView(FULL.peak_flows); expect(p.lines.every((l) => l.ok)).toBe(true); expect(p.lines[1].text).toContain('L/s');
    const u = peakView(UNRES.peak_flows); expect(u.lines.every((l) => !l.ok && l.text.startsWith('NOT EVALUATED'))).toBe(true);
  });
  it('the trench view gives storage, emptying time, the rate with its basis and the check', () => {
    const v = infiltrationView(FULL.infiltration), t = v.trenches[0];
    expect(t.volume).toBe('2.400 m3'); expect(t.time).toBe('11.11 h'); expect(t.rate.basis.text).toBe('USER'); expect(t.rate.ref).toContain('30/09/2026'); expect(t.check.tone).toBe('ok'); expect(t.steps.length).toBe(2);
  });
  it('an indicative rate carries INDICATIVE, SITE TESTING REQUIRED', () => {
    const base = FULL.infiltration, tr = { ...base.trenches[0], rate_label: 'INDICATIVE, SITE TESTING REQUIRED' };
    const v = infiltrationView({ ...base, label: 'INDICATIVE, SITE TESTING REQUIRED', trenches: [tr] });
    expect(v.label).toBe('INDICATIVE, SITE TESTING REQUIRED'); expect(v.trenches[0].rateLabel).toBe('INDICATIVE, SITE TESTING REQUIRED');
  });
  it('a trench without a rate is NOT EVALUATED', () => {
    const t = UNRES.infiltration.trenches[0];
    const v = infiltrationView(UNRES.infiltration).trenches[0];
    expect(t.emptying_time_h).not.toBeNull();            // the unresolved fixture still has the rate entered on the trench object
    expect(v.time).not.toBe('NOT EVALUATED');
    const none = infiltrationView({ ...UNRES.infiltration, trenches: [{ ...t, emptying_time_h: null, volume_m3: null, status: 'NOT EVALUATED', check: { status: 'NOT EVALUATED', message: '' } }] }).trenches[0];
    expect(none.time).toBe('NOT EVALUATED'); expect(none.volume).toBe('NOT EVALUATED');
  });
});

describe('missing inputs and rainfall', () => {
  it('groups the missing items by area with the key and how to supply them', () => {
    const g = missingGroups(UNRES.missing), areas = g.map((x) => x.area);
    expect(areas).toContain('RUNOFF'); expect(areas).toContain('OSD');
    const runoff = g.find((x) => x.area === 'RUNOFF')!.items[0]; expect(runoff.key).toContain('runoff_coefficient'); expect(runoff.how.length).toBeGreaterThan(10);
    expect(g.flatMap((x) => x.items).every((i) => i.how.length > 0)).toBe(true);
  });
  it('the rainfall view shows the provenance of the upload and NOT AVAILABLE without one', () => {
    const r = rainfallView(FULL.rainfall); expect(r.status).toBe('OK'); expect(r.lines.join(' ')).toContain('SYNTHETIC_IFD.CSV'); expect(r.lines.join(' ')).toContain('01/01/2016');
    const u = rainfallView(UNRES.rainfall); expect(u.tone).toBe('bad'); expect(u.lines[0]).toContain('UPLOADED');
  });
});

describe('the user entries', () => {
  it('turns what was typed into the request entries and leaves empty fields out', () => {
    const f = { ...EMPTY_FORM, design_aep_pct: '10', tc_post_min: '5', osd_method: ' user_ssr ', runoff: { roof: '0.9', concrete: '' }, rainwater_tank_excluded: 'false' as const };
    const { inputs, errors } = inputsPayload(f);
    expect(errors).toEqual([]); expect(inputs).toEqual({ design_aep_pct: 10, tc_post_min: 5, osd_method: 'user_ssr', rainwater_tank_excluded: false, runoff_coefficients: { roof: 0.9 } });
  });
  it('refuses a bad entry with a plain message instead of sending it', () => {
    const { errors } = inputsPayload({ ...EMPTY_FORM, design_aep_pct: 'ten', psd_l_s: '-1', discharge_coefficient: '1.5', runoff: { roof: '2' }, infil_source: 'site_test', infil_rate: '0', infil_date: 'x' });
    expect(errors.length).toBe(6); expect(errors.join(' ')).toContain('Design AEP must be a number'); expect(errors.join(' ')).toContain('runoff coefficient of roof');
  });
  it('an infiltration site test entry carries the date and the method', () => {
    const { inputs } = inputsPayload({ ...EMPTY_FORM, infil_source: 'site_test', infil_rate: '36', infil_date: '2026-09-30', infil_method: 'Falling head' });
    expect(inputs.infiltration).toEqual({ source: 'site_test', rate_mm_h: 36, test_date: '2026-09-30', test_method: 'Falling head' });
  });
  it('shows saved entries back in the form', () => {
    const f = formFromInputs({ design_aep_pct: 10, rainwater_tank_excluded: true, runoff_coefficients: { roof: 0.9 }, infiltration: { source: 'soil_table', soil_unit: 'SYN-A' } });
    expect(f.design_aep_pct).toBe('10'); expect(f.rainwater_tank_excluded).toBe('true'); expect(f.runoff.roof).toBe('0.9'); expect(f.infil_soil_unit).toBe('SYN-A');
    expect(formFromInputs(null)).toEqual(EMPTY_FORM);
  });
});

describe('the server calls', () => {
  const ep = (impl: typeof fetch) => ({ base: 'http://x', projectId: 'p1', fetchImpl: impl });
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
  it('posts the design, the entries and the overland settings to the stormwater route', async () => {
    const calls: { url: string; body: Record<string, unknown> }[] = [];
    const impl = (async (url: string, init: RequestInit) => { calls.push({ url, body: JSON.parse(String(init.body)) }); return json(FULL); }) as unknown as typeof fetch;
    const doc = emptyDesign('p1');
    const s = new StormwaterSession(ep(impl), () => doc);
    s.setField('design_aep_pct', '10'); s.setOverland({ on: true, cell: '1', threshold: '40', surface: 'existing' });
    expect(await s.run()).toBe(true);
    expect(calls[0].url).toBe('http://x/projects/p1/stormwater/analyse');
    expect(calls[0].body.inputs).toEqual({ design_aep_pct: 10 }); expect(calls[0].body.overland).toEqual({ enabled: true, cell_m: 1, threshold_m2: 40, surface: 'existing' }); expect(calls[0].body.rainfall_source).toBe('upload');
    expect(s.state.status).toBe('ok'); expect(s.state.result!.schema).toBe('stormwater.v1'); expect(s.state.stale).toBe(false);
  });
  it('an answer becomes STALE when an entry changes and is never shown as current', async () => {
    const s = new StormwaterSession(ep((async () => json(FULL)) as unknown as typeof fetch), () => emptyDesign('p1'));
    await s.run(); expect(s.state.stale).toBe(false);
    s.setField('tc_post_min', '7'); expect(s.state.stale).toBe(true);
  });
  it('a 422 from the server shows its message and keeps no result', async () => {
    const impl = (async () => json({ code: 'OVERLAND_INPUT_TOO_LARGE', message: 'THE OVERLAND FLOW RASTER WOULD HAVE 900,000 CELLS' }, 422)) as unknown as typeof fetch;
    const s = new StormwaterSession(ep(impl), () => emptyDesign('p1'));
    expect(await s.run()).toBe(false); expect(s.state.status).toBe('error'); expect(s.state.error).toContain('900,000 CELLS'); expect(s.state.result).toBeNull();
  });
  it('a request with a bad entry is not sent', async () => {
    const impl = vi.fn(async () => json(FULL)) as unknown as typeof fetch;
    const s = new StormwaterSession(ep(impl), () => emptyDesign('p1'));
    s.setField('design_aep_pct', 'abc'); expect(await s.run()).toBe(false); expect(impl).not.toHaveBeenCalled(); expect(s.state.formErrors.length).toBe(1);
  });
  it('without a server the session says so and sends nothing', async () => {
    const s = new StormwaterSession(null, () => emptyDesign('p1'));
    expect(s.state.status).toBe('no_server'); expect(await s.run()).toBe(false);
  });
  it('uploads a file with its form fields and reports a parse error as the server words it', async () => {
    const seen: { url: string; fields: Record<string, string> }[] = [];
    const impl = (async (url: string, init: RequestInit) => {
      const fd = init.body as FormData; seen.push({ url, fields: Object.fromEntries([...fd.entries()].filter(([, v]) => typeof v === 'string')) as Record<string, string> });
      return url.endsWith('/ifd') ? json({ code: 'NO_HEADER', message: 'NO HEADER ROW WITH EXCEEDANCE COLUMNS WAS FOUND' }, 422) : json({}, 201);
    }) as unknown as typeof fetch;
    await expect(postUpload(ep(impl), 'soil', new Blob(['a']), 'soil.csv', { source: 'Atlas', source_date: '' })).resolves.toEqual({});
    expect(seen[0].url).toBe('http://x/projects/p1/stormwater/soil'); expect(seen[0].fields).toEqual({ source: 'Atlas' });
    const s = new StormwaterSession(ep(impl), () => emptyDesign('p1'));
    expect(await s.upload('ifd', new Blob(['a']), 'bad.csv')).toBe(false); expect(s.state.error).toContain('NO HEADER ROW');
    await expect(postAnalyse(ep((async () => json({ detail: [{ loc: ['body', 'inputs', 'psd_l_s'], msg: 'Input should be greater than 0' }] }, 422)) as unknown as typeof fetch), { design: emptyDesign('p1') }))
      .rejects.toMatchObject({ status: 422, message: expect.stringContaining('psd_l_s') });
  });
});

describe('the overland flow layer in 3D', () => {
  const O: [number, number] = [E0, N0];
  const ov = FULL.overland as SwOverland;
  const pond = { area_m2: 6.25, max_depth_m: 0.4, volume_m3: 1.2, spill_level_rl: 100.5, lowest_ground_rl: 100.1, centroid: [E0 + 5, N0 + 5] as [number, number], outline: [[E0 + 4, N0 + 4], [E0 + 6, N0 + 4], [E0 + 6, N0 + 6], [E0 + 4, N0 + 6], [E0 + 4, N0 + 4]] as [number, number][] };
  it('draws one ribbon per flow path, a polygon and an outline per pond, and a label with the terrain status and the not a flood study wording', () => {
    const texts: string[] = [];
    const g = buildOverlandLayer({ ...ov, depressions: [pond] }, O, (t) => { texts.push(t); return new THREE.Sprite(); });
    const meshes: THREE.Object3D[] = []; g.traverse((o) => meshes.push(o));
    expect(meshes.filter((o) => typeof o.userData.flowPath === 'number').length).toBe(ov.paths.length);
    expect(meshes.filter((o) => o.userData.pond).length).toBe(1);
    expect(meshes.filter((o) => (o as THREE.Line).isLine).length).toBe(1);
    expect(texts[0].split('\n')).toEqual([ov.terrain_status, FLOW_LABEL]); expect(texts[0]).toContain('NOT A FLOOD STUDY');
    expect(meshes.some((o) => o.userData.pick === true)).toBe(false);          // never pickable
  });
  it('draws nothing for an answer that was not evaluated and the ribbon grows with the area on a log scale up to a cap', () => {
    expect(buildOverlandLayer({ ...ov, status: 'NOT EVALUATED' }, O).children.length).toBe(0); expect(buildOverlandLayer(null, O).children.length).toBe(0);
    expect(ribbonWidth(1)).toBeCloseTo(0.12); expect(ribbonWidth(1000)).toBeCloseTo(0.48); expect(ribbonWidth(1e9)).toBe(0.8);
    expect(overlandLabelText({ labels: [], terrain_status: 'T' })).toBe('T\n' + FLOW_LABEL);
  });
  it('the scene shows the layer, keeps it when the same answer is set again and removes it with null', () => {
    const sc = new SiteScene({ origin: O, terrain: { available: true, sample: () => 100 }, makeLabel: () => new THREE.Sprite() });
    expect(sc.hasOverland()).toBe(false); sc.setOverland(ov); expect(sc.hasOverland()).toBe(true);
    const first = sc.group.children.find((c) => c.name === 'overland_flow');
    sc.setOverland(ov); expect(sc.group.children.find((c) => c.name === 'overland_flow')).toBe(first);
    sc.setOverland(null); expect(sc.hasOverland()).toBe(false); expect(sc.group.children.some((c) => c.name === 'overland_flow')).toBe(false);
  });
  it('the summary view lists the label, the parameters with their documented basis and the ponds', () => {
    const v = overlandView({ ...ov, depressions: [pond], depressions_total: 1 })!;
    expect(v.labels).toContain(FLOW_LABEL); expect(v.ponds[0].text).toContain('VOLUME 1.20 m3'); expect(v.params.some((p) => p.startsWith('threshold_m2: DISPLAY PARAMETER'))).toBe(true);
    expect(overlandView(null)).toBeNull();
    expect(overlandView({ ...ov, status: 'NOT EVALUATED', message: 'NOT EVALUATED: THE 3D MODEL HAS NO TERRAIN' })!.summary).toEqual(['NOT EVALUATED: THE 3D MODEL HAS NO TERRAIN']);
  });
});

describe('the discharge point object and the links', () => {
  it('there is a discharge point type with its kinds, fields and label', () => {
    expect(OBJECT_KINDS.discharge_point.geometry).toBe('point'); expect(PARAM_ENUMS['discharge_point.discharge_kind']).toEqual(DISCHARGE_KINDS);
    const o = { id: 'd', type: 'discharge_point', status: 'proposed', origin: 'user', verified: false, geometry: { kind: 'point', p: [E0, N0] }, params: { discharge_kind: { value: 'kerb_outlet', basis: 'user' } }, issues: [] } as never;
    expect(fieldsFor(o).map((f) => f.key)).toEqual(['discharge_kind', 'discharge_basis']); expect(extraLabelLines(o)).toEqual(['KERB OUTLET', 'BASIS NOT STATED']);
  });
  it('surfaces and storage can name where they drain; an overflow route can start at a tank and end at a trench', () => {
    expect(PARAM_LINKS['driveway.drains_to_id']).toContain('discharge_point'); expect(PARAM_LINKS['osd.drains_to_id']).toEqual(['discharge_point']);
    expect(PARAM_LINKS['overflow_route.rwt_id']).toEqual(['rwt']); expect(PARAM_LINKS['overflow_route.trench_id']).toEqual(['infiltration_trench']);
  });
  it('the design store accepts a discharge point and a drains to link, and refuses a link to the wrong type', () => {
    const s = new SiteDesignStore(emptyDesign('p'), seqCtx());
    const dp = s.run('add_object', { type: 'discharge_point', points: [at(5, 0)] }).id as string, dv = s.run('add_object', { type: 'driveway', points: [at(5, 0), at(5, 8)] }).id as string;
    s.run('set_param', { id: dv, key: 'drains_to_id', value: dp });
    expect(s.doc.objects.find((o) => o.id === dv)!.params.drains_to_id.value).toBe(dp);
    const tree = s.run('add_object', { type: 'tree', points: [at(8, 8)] }).id as string;
    expect(() => s.run('set_param', { id: dv, key: 'drains_to_id', value: tree })).toThrow();
  });
});

describe('the panel', () => {
  function rig() {
    const g = new THREE.PlaneGeometry(100, 100, 2, 2), m = new THREE.Mesh(g, new THREE.MeshBasicMaterial()); m.updateMatrixWorld(true);
    return new DesignController({ built: { root: new THREE.Group() } as unknown as Built, origin: [E0, N0], terrainMeshes: [m], lot: [[E0, N0], [E0 + 20, N0], [E0 + 20, N0 + 20]], terrainAvailable: true, mpp: () => 0.1, setOrbit: () => {},
      store: new SiteDesignStore(emptyDesign('p'), seqCtx()), makeLabel: () => new THREE.Sprite(), engine: { base: 'http://x', projectId: 'p', fetchImpl: (async () => new Response('{}')) as unknown as typeof fetch } });
  }
  it('renders the entries, the rainfall section and the overland toggle before any answer, with no dash characters', () => {
    const ctl = rig(), html = renderToStaticMarkup(h(StormwaterSection, { sw: ctl.stormwater.state, ctl, locked: false }));
    expect(html).toContain('Run the stormwater analysis'); expect(html).toContain('Design rainfall'); expect(html).toContain('UNCONFIRMED'); expect(html).toContain('Show overland flow paths and ponding in 3D'); expect(html).toContain(FLOW_LABEL);
    expect(html).toContain('Time of concentration, post development'); expect(html).toContain('FROM RULE'); expect(html).not.toMatch(DASH);
  });
  it('renders the answer: catchment table, OSD steps with formulas, basis badges, the comparison and the missing list with how to supply each item', () => {
    const ctl = rig(); ctl.stormwater.state = { ...ctl.stormwater.state, status: 'ok', result: FULL, resultSig: 'x' };
    const html = renderToStaticMarkup(h(StormwaterSection, { sw: ctl.stormwater.state, ctl, locked: false }));
    expect(html).toContain('Catchment'); expect(html).toContain('Routing'); expect(html).toContain('FORMULA: S = (Qp - PSD)'); expect(html).toContain('PLATFORM DEFAULT'); expect(html).toContain('REQUIRED STORAGE');
    expect(html).toContain('4.400 m3'); expect(html).toContain('Orifice'); expect(html).toContain('EMPTYING TIME'); expect(html).toContain('NOT A FLOOD STUDY'); expect(html).not.toMatch(DASH);
    const u = rig(); u.stormwater.state = { ...u.stormwater.state, status: 'ok', result: UNRES, resultSig: 'x' };
    const h2 = renderToStaticMarkup(h(StormwaterSection, { sw: u.stormwater.state, ctl: u, locked: false }));
    expect(h2).toContain('What is missing'); expect(h2).toContain('HOW TO SUPPLY IT'); expect(h2).toContain('NOT EVALUATED'); expect(h2).toContain('stormwater.osd_method'); expect(h2).not.toMatch(DASH);
  });
  it('marks a stale answer', () => {
    const ctl = rig(); ctl.stormwater.state = { ...ctl.stormwater.state, status: 'ok', result: FULL, resultSig: 'old', stale: true };
    expect(renderToStaticMarkup(h(StormwaterSection, { sw: ctl.stormwater.state, ctl, locked: false }))).toContain('STALE');
  });
  it('the controller state carries the stormwater state and the overland layer follows the toggle', () => {
    const ctl = rig(); expect(ctl.state().stormwater.status).toBe('idle');
    ctl.stormwater.state = { ...ctl.stormwater.state, result: FULL, overland: { ...ctl.stormwater.state.overland, on: true } }; ctl.stormwater.listener(ctl.stormwater.state);
    expect(ctl.scene.hasOverland()).toBe(true);
    ctl.stormwater.setOverland({ on: false }); expect(ctl.scene.hasOverland()).toBe(false);
  });
});

describe('wording of everything the mapping produces', () => {
  it('has no em or en dash in any view of the two answers', () => {
    for (const r of [FULL, UNRES]) {
      const all = [catchmentRows(r), prePostView(r.catchment.comparison), routingView(r), osdView(r.osd), peakView(r.peak_flows), infiltrationView(r.infiltration), missingGroups(r.missing), rainfallView(r.rainfall), overlandView(r.overland)];
      const bad = strings(all).filter((s) => DASH.test(s)); expect(bad).toEqual([]);
    }
  });
});
