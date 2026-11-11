import test from 'node:test';
import assert from 'node:assert/strict';
import { viewerEmbedRequested, addressFromSearch, fullEditorUrl } from '../src/ui/embed-viewer.js';
import { demoLotResponse } from '../src/site/demo-lot.js';
import { buildSiteLot } from '../src/site/model.js';

test('viewer mode is asked for by ?embed=1 or ?view=viewer only', () => {
  assert.equal(viewerEmbedRequested('?embed=1'), true);
  assert.equal(viewerEmbedRequested('?view=viewer'), true);
  assert.equal(viewerEmbedRequested('?embed=demo'), false);
  assert.equal(viewerEmbedRequested(''), false);
});

test('address parameter is read and trimmed', () => {
  assert.equal(addressFromSearch('?address=%2014%20Sample%20Street%20'), '14 Sample Street');
  assert.equal(addressFromSearch('?embed=1'), '');
});

test('full editor link carries the address of a real lot, not the demo lot', () => {
  assert.equal(fullEditorUrl(null), '/plan-studio/app/');
  assert.equal(fullEditorUrl({ site: { lot: { lotLabel: 'Sample lot', address: '' } } }), '/plan-studio/app/');
  assert.equal(fullEditorUrl({ site: { lot: { lotLabel: 'Lot 1 DP 2', address: '14 Sample Street Calala NSW' } } }), '/plan-studio/app/?address=14%20Sample%20Street%20Calala%20NSW');
});

test('the demo lot builds a rectangular site lot with a street frontage', () => {
  const lot = buildSiteLot({ lot: demoLotResponse(), address: '', source: 'sample' });
  assert.equal(lot.boundary.length, 4);
  assert.equal(lot.areaM2, 1080);
  assert.equal(lot.frontEdges.length, 1);
  assert.ok(lot.neighbours.length > 10);
});
