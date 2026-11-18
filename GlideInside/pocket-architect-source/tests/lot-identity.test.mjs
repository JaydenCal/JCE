// The lot card heading and the address pill come from one function of the loaded lot.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { lotIdentity } from '../src/lotcard/stats.js';

test('lotIdentity names the loaded lot for both the heading and the pill', () => {
  const lot = { lotNumber: '79', planLabel: 'DP 707719', lotLabel: 'Lot 79 DP 707719', address: '39 River Drive, Karabar', areaM2: 612.4 };
  const id = lotIdentity(lot);
  assert.equal(id.heading, 'Lot 79 DP 707719');
  assert.equal(id.address, '39 River Drive, Karabar');
  assert.match(id.pill, /^39 River Drive, Karabar · 612 m²$/);
  assert.deepEqual(lotIdentity(null), { heading: '', address: '', pill: '' });
  assert.equal(lotIdentity({ demo: true, lotLabel: 'Sample lot', address: 'x' }).pill, '');
});

test('the address pill is rewritten from the loaded lot after every search outcome and while the card is hidden', () => {
  const s = fs.readFileSync(new URL('../src/lotcard/lot-card.js', import.meta.url), 'utf8');
  assert.match(s, /syncPill\(lotOf\(store\.project\)\)/);
  const render = s.slice(s.indexOf('function render()'));
  assert.ok(render.indexOf('syncPill(lot)') > 0 && render.indexOf('syncPill(lot)') < render.indexOf('const show ='));
});
