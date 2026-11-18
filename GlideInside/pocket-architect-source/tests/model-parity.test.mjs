// Parity of the 3D model across residential and commercial, and across the viewer and the offline HTML export (18/11/2026).
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { commercialProject } from './helpers/commercial-fixture.mjs';
import { buildModel } from '../src/viewer3d/build.js';
import { kerbDropScale } from '../src/viewer3d/site-extras.js';
import { pavementModel } from '../src/commercial/catalogue/pavements/logic.js';
import { catalogue } from '../src/catalogue/index.js';
import { buildExport } from '../src/premium/exporters/index.js';

test('kerbDropScale takes several crossover spans, the lowest scale wins', () => {
  assert.equal(kerbDropScale(5, [[4, 6], [20, 24]]), 0);
  assert.equal(kerbDropScale(22, [[4, 6], [20, 24]]), 0);
  assert.equal(kerbDropScale(13, [[4, 6], [20, 24]]), 1);
  assert.ok(kerbDropScale(6.3, [[4, 6], [20, 24]], 0.6) < 1);
});

test('commercial: the street kerb is built and the pavement model has crossover (layback) kerbs to drop it across', () => {
  const p = commercialProject({ plain: false });
  const m = pavementModel(p.commercial, p.site.lot);
  assert.ok(m.kerbs.some((k) => k.crossover), 'a crossover kerb exists');
  const root = buildModel(p, { THREE, catalogue, showRoof: true, statusView: 'proposed', levelFilter: 'all' });
  assert.ok(root.getObjectByName('road'), 'the road with its kerbs is built');
});

test('model export bakes the lawn inside the lots and the paddock outside into vertex colours', () => {
  const p = commercialProject({ plain: false });
  const root = buildModel(p, { THREE, catalogue, showRoof: true, statusView: 'proposed', levelFilter: 'all', bakeGround: true });
  const t = root.getObjectByName('site-terrain');
  assert.ok(t?.geometry.getAttribute('color'), 'terrain carries vertex colours');
  assert.ok(t.material.vertexColors);
  const c = t.geometry.getAttribute('color');
  const seen = new Set();
  for (let i = 0; i < c.count; i += 7) seen.add(`${c.getX(i).toFixed(3)},${c.getY(i).toFixed(3)}`);
  assert.ok(seen.size >= 2, 'two ground tones');
  const plain = buildModel(p, { THREE, catalogue, showRoof: true, statusView: 'proposed', levelFilter: 'all' }).getObjectByName('site-terrain');
  assert.ok(!plain.geometry.getAttribute('color'), 'the online viewer keeps its own ground material');
});

test('html export of a commercial site carries the lot labels for the viewer', async () => {
  const p = commercialProject({ plain: false });
  p.site.lot.lotNumber = '12'; p.site.lot.planLabel = 'DP 1198432'; p.site.lot.areaM2 = 9000;
  const f = await buildExport('html', p, { catalogue, config: {}, date: new Date('2026-11-18T00:00:00Z') });
  const html = new TextDecoder().decode(f.bytes);
  const m = html.match(/<script id="pa-labels" type="application\/json">([\s\S]*?)<\/script>/);
  assert.ok(m, 'labels script present');
  const labels = JSON.parse(m[1]);
  assert.ok(labels.some((l) => l.k === 'lot' && l.t[0] === 'Lot 12'));
  p.site.lot.layers = { ...(p.site.lot.layers || {}), labels: false };
  const f2 = await buildExport('html', p, { catalogue, config: {}, date: new Date('2026-11-18T00:00:00Z') });
  assert.ok(!/id="pa-labels"/.test(new TextDecoder().decode(f2.bytes)), 'labels off stays off in the export');
});
