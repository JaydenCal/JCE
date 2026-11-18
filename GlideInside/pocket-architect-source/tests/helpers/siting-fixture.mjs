// A residential and a commercial project on the Tamworth sample lot, with ground levels and overlay results, for the siting report tests.
import fs from 'node:fs';
import { createProject } from '../../src/model/schema.js';
import { catalogue } from '../../src/catalogue/index.js';
import { buildSiteLot } from '../../src/site/model.js';
import { FIXTURES } from '../../src/site/fixtures/index.js';
import { siteLotSetbacks } from '../../src/site/setbacks.js';
import { autoPose } from '../../src/portal/auto-place.js';
import { placeHouse } from '../../src/portal/place-house.js';
import { buildOverlays } from '../../src/site/overlays.js';

const rules = JSON.parse(fs.readFileSync(new URL('../../../setbacks-data/setback-rules.json', import.meta.url), 'utf8'));

/** A fake /api/site/overlays response with a flood area over the back of the lot and a bushfire area, heritage unavailable, easements unavailable. */
export function overlaysFor(lot) {
  const b = lot.boundary;
  const xs = b.map((p) => p.x / 1000); const ys = b.map((p) => -p.y / 1000);
  const x0 = Math.min(...xs); const x1 = Math.max(...xs); const y0 = Math.min(...ys); const y1 = Math.max(...ys);
  const flood = [[x0 - 20, y0 - 20], [x1 + 20, y0 - 20], [x1 + 20, y0 + (y1 - y0) * 0.3], [x0 - 20, y0 + (y1 - y0) * 0.3]];
  return buildOverlays({
    retrieved: '2026-11-18T00:00:00Z',
    layers: [
      { id: 'flood', label: 'Flood planning area', source: 'NSW Flood Planning Area (test)', date: '2025-06-01', status: 'ok', features: [{ label: 'Flood planning area', detail: '', polygons: [{ outer: flood, holes: [] }] }] },
      { id: 'bushfire', label: 'Bushfire prone land', source: 'NSW Bush Fire Prone Land (test)', date: '2025-06-01', status: 'ok', features: [] },
      { id: 'heritage', label: 'Heritage', source: '', status: 'unavailable', note: '', features: [] },
    ],
  });
}

export function residential({ overlays = true, terrain = true } = {}) {
  const f = FIXTURES[0];
  const lot = buildSiteLot({ lot: f.lot, aerialMeta: f.aerial, aerialKey: null, contours: terrain ? f.contours : null, address: f.search[0].label, source: 'sample' });
  const r = siteLotSetbacks(lot, rules, { storeys: 2, wallHeightM: 5.4, buildingHeightM: 8 });
  lot.setbacks = r.setbacks; lot.envelope = r.envelope;
  if (overlays) lot.overlays = overlaysFor(lot);
  const p = createProject({ name: 'Sample Residence' });
  p.site.lot = lot;
  const h = catalogue.createFromTemplate('house_double');
  placeHouse(p, h, autoPose(p, h).pose);
  return p;
}
