// Regression (owner 18/11/2026): changing the design type must keep the site (lot, address, aerial, neighbours, roads) and the building's place.
import test from 'node:test';
import assert from 'node:assert/strict';
import { catalogue } from '../src/catalogue/index.js';
import { buildDesignType, applyDesignType } from '../src/ui/design-type.js';
import { createStore } from '../src/model/store.js';
import { houseCentre, lotOf, translateHouse } from '../src/model/placement.js';

test('design type change keeps the lot, address, aerial, roads and the house position', () => {
  const store = createStore(catalogue.createFromTemplate('house_single'), { opContext: { catalogue } });
  const p = store.project;
  p.site.lot = { source: 'address', address: '39 River Street Macksville NSW', boundary: [{ x: -5000, y: -8000 }, { x: 25000, y: -8000 }, { x: 25000, y: 30000 }, { x: -5000, y: 30000 }],
    neighbours: [{ ring: [{ x: 26000, y: 0 }, { x: 40000, y: 0 }, { x: 40000, y: 20000 }] }], aerial: { extent: { x0: -100000, y0: -100000, x1: 150000, y1: 150000 }, source: 'mapbox' }, aerialWide: { extent: { x0: -400000, y0: -400000, x1: 500000, y1: 500000 } } };
  p.site.paved = [{ id: 'way1', kind: 'driveway', points: [{ x: 0, y: -8000 }, { x: 0, y: 0 }] }];
  translateHouse(p, 7000, 9000);
  const lotBefore = JSON.stringify(lotOf(p));
  const centreBefore = houseCentre(p);
  const out = buildDesignType(p, 'granny_flat', catalogue);
  assert.equal(JSON.stringify(lotOf(out)), lotBefore, 'lot, address, aerial and neighbours unchanged');
  assert.equal(out.site.lot.address, '39 River Street Macksville NSW');
  assert.ok(out.site.lot.aerial && out.site.lot.aerialWide);
  assert.deepEqual(out.site.paved, p.site.paved);
  const c = houseCentre(out);
  assert.ok(Math.hypot(c.x - centreBefore.x, c.y - centreBefore.y) < 50, 'new building is centred where the old one stood');
  applyDesignType(store, 'granny_flat', catalogue);
  assert.equal(store.project.site.lot.address, '39 River Street Macksville NSW');
});
