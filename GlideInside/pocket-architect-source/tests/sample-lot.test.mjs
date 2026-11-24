// The sample lot with a real aerial: the loader, its fallbacks, the manifest the export tool writes, and the files shipped with the site.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { loadSampleSite, manifestProblem, sampleBase, sampleLotResponse, buildSampleManifest, SAMPLE_CREDIT, SAMPLE_SCHEMA } from '../src/site/sample-lot.js';
import { demoLotResponse } from '../src/site/demo-lot.js';
import { buildSiteLot } from '../src/site/model.js';
import { SRC, SITE } from './helpers/phone-harness.mjs';

const BASE = 'https://example.test/plan-studio/sample/';
const bbox = { minE: 302540, minN: 6558500, maxE: 302620, maxN: 6558600 };
const meta = (extra = {}) => ({ bbox, georef: 'mga', source: 'NSW Imagery', attribution: SAMPLE_CREDIT, captureDate: '2025-06-01', mmPerPx: 60, widthPx: 1334, heightPx: 1667, ...extra });
const ready = () => ({
  schema: SAMPLE_SCHEMA, status: 'ready', address: '1 Example Street, Estate NSW',
  lot: (({ sample, demo, ...r }) => r)(demoLotResponse()),
  aerial: { file: 'sample-lot-aerial.jpg', meta: meta() },
  aerialWide: { file: 'sample-lot-aerial-wide.jpg', meta: meta({ mmPerPx: 200 }) },
  contours: { minor: 1, major: 5, contours: [{ level: 1, major: false, closed: false, points: [{ x: -10, y: 0 }, { x: 10, y: 2 }] }], grid: null, provenance: { source: 'NSW 5 m' } },
});
const fakeFetch = (files, calls = []) => async (url) => {
  const f = new URL(url).pathname.split('/').pop();
  calls.push(f);
  if (!(f in files)) return { ok: false, status: 404 };
  const v = files[f];
  return { ok: true, status: 200, json: async () => v, blob: async () => ({ size: 10, type: 'image/jpeg', f }) };
};

test('the shipped sample files are an honest placeholder until a real lot is exported', () => {
  const dir = path.join(SITE, 'plan-studio/sample');
  const m = JSON.parse(fs.readFileSync(path.join(dir, 'sample-lot.json'), 'utf8'));
  if (m.status === 'ready') {
    assert.equal(manifestProblem(m), null, 'a ready manifest is complete');
    assert.ok(fs.existsSync(path.join(dir, m.aerial.file)), 'its aerial file is checked in');
    assert.ok(Number(m.aerial.meta.mmPerPx) <= 120, 'and sharp');
    assert.match(m.credit, /NSW Spatial Services/);
  } else {
    assert.equal(m.status, 'placeholder');
    assert.match(m.note, /PLACEHOLDER/);
    assert.match(m.note, /export-sample-lot\.mjs/, 'it says how to fill it in');
    assert.ok(manifestProblem(m));
  }
  assert.ok(fs.existsSync(path.join(SRC, 'tools/export-sample-lot.mjs')));
});

test('manifestProblem accepts a complete manifest and names what is wrong otherwise', () => {
  assert.equal(manifestProblem(ready()), null);
  assert.match(manifestProblem(null), /no manifest/);
  assert.match(manifestProblem({ ...ready(), schema: 9 }), /schema/);
  assert.match(manifestProblem({ ...ready(), status: 'placeholder' }), /placeholder/);
  assert.match(manifestProblem({ ...ready(), aerial: null }), /aerial/);
  assert.match(manifestProblem({ ...ready(), aerial: { file: 'a.jpg', meta: {} } }), /aerial/);
  assert.match(manifestProblem({ ...ready(), lot: {} }), /lot/);
  assert.match(manifestProblem({ ...ready(), aerialWide: { file: '' } }), /wide/);
});

test('a ready manifest gives the real aerial and contours, flagged as the sample lot', async () => {
  const calls = [];
  const site = await loadSampleSite({}, { base: BASE, fetchImpl: fakeFetch({ 'sample-lot.json': ready(), 'sample-lot-aerial.jpg': 1, 'sample-lot-aerial-wide.jpg': 1 }, calls) });
  assert.equal(site.real, true);
  assert.equal(site.aerial.blob.f, 'sample-lot-aerial.jpg');
  assert.equal(site.aerialWide.blob.f, 'sample-lot-aerial-wide.jpg');
  assert.equal(site.lot.sample, true);
  assert.equal(site.lot.demo, true);
  assert.equal(site.lot.lot.lotLabel, 'Sample lot', 'no real lot number or plan is shown');
  assert.equal(site.contours.contours.length, 1);
  assert.ok(calls.every((c) => /^sample-lot/.test(c)), 'only the shipped files are fetched, never a NSW service');
  const lot = buildSiteLot({ lot: site.lot, aerialMeta: site.aerial.meta, aerialKey: 'k', contours: site.contours, address: '', source: 'sample' });
  assert.equal(lot.aerial.key, 'k');
  assert.equal(lot.provenance.aerial.attribution, SAMPLE_CREDIT, 'NSW Spatial Services is credited');
  assert.equal(lot.contours.length, 1);
});

test('the sample falls back to the synthetic lot when the files are missing, a placeholder, broken or commercial', async () => {
  const synthetic = (s) => assert.equal(s.lot.lot.lotLabel, 'Sample lot') || assert.equal(s.aerial, null) || assert.equal(s.real, undefined);
  synthetic(await loadSampleSite({}, { base: BASE, fetchImpl: fakeFetch({}) }));
  synthetic(await loadSampleSite({}, { base: BASE, fetchImpl: fakeFetch({ 'sample-lot.json': { schema: 1, status: 'placeholder', note: 'x' } }) }));
  synthetic(await loadSampleSite({}, { base: BASE, fetchImpl: fakeFetch({ 'sample-lot.json': ready() }) })); // the aerial file would not load
  synthetic(await loadSampleSite({}, { base: BASE, fetchImpl: async () => { throw new Error('offline'); } }));
  synthetic(await loadSampleSite({}, { base: null, fetchImpl: fakeFetch({}) }));
  const calls = [];
  const c = await loadSampleSite({ commercial: true }, { base: BASE, fetchImpl: fakeFetch({ 'sample-lot.json': ready(), 'sample-lot-aerial.jpg': 1 }, calls) });
  assert.equal(c.lot.zoning.code, 'E4', 'commercial keeps its synthetic lot');
  assert.deepEqual(calls, [], 'and does not even ask');
});

test('the wide ring is optional', async () => {
  const site = await loadSampleSite({}, { base: BASE, fetchImpl: fakeFetch({ 'sample-lot.json': ready(), 'sample-lot-aerial.jpg': 1 }) });
  assert.equal(site.real, true);
  assert.equal(site.aerialWide, null);
});

test('the sample files are found next to the app page', () => {
  assert.equal(sampleBase('https://glideinside.com.au/plan-studio/app/?embed=1'), 'https://glideinside.com.au/plan-studio/sample/');
  assert.equal(sampleBase('https://glideinside.com.au/plan-studio/app/index.html'), 'https://glideinside.com.au/plan-studio/sample/');
  assert.equal(sampleBase(null), null);
});

test('the export tool builds a manifest the app accepts, and refuses a lookup with no aerial', () => {
  const site = { lot: demoLotResponse(), aerial: { blob: {}, meta: meta() }, aerialWide: { blob: {}, meta: meta({ mmPerPx: 200 }) }, contours: ready().contours, warnings: [] };
  const m = buildSampleManifest(site, { address: '1 Example Street', exportedOn: '2026-11-25' });
  assert.equal(manifestProblem(m), null);
  assert.equal(m.lot.sample, undefined, 'the sample flags are added by the app, not stored');
  assert.equal(sampleLotResponse(m).sample, true);
  assert.equal(m.credit, SAMPLE_CREDIT);
  assert.throws(() => buildSampleManifest({ ...site, aerial: null }), /no aerial/);
  assert.throws(() => buildSampleManifest({}), /no lot/);
});

test('the sample lot copy has no dashes and never says compliant', () => {
  for (const f of ['src/site/sample-lot.js', 'tools/export-sample-lot.mjs']) {
    const t = fs.readFileSync(path.join(SRC, f), 'utf8');
    assert.ok(!/[–—]/.test(t), `${f} has a dash`);
    assert.ok(!/compliant/i.test(t), `${f} says compliant`);
  }
});
