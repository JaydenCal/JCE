// A fixture of the Conadilly Street lot shape (Lot 1 DP 758492, 960 m2, 26.9 m x 50.6 m, frontage to the main road on the short side and
// a second road on a long side), built from the numbers. Nothing is fetched. Plan mm, y down, grid north is up.
import { migrate, createProject } from '../../src/model/schema.js';
import { demoLotResponse } from '../../src/site/demo-lot.js';
import { buildSiteLot } from '../../src/site/model.js';

export const W = 26900;
export const D = 50600;

/** A project holding the lot. `corner` adds the secondary frontage on the east long side. `setbacks` replaces the rule values. */
export function conadillyProject({ corner = true, width = W, depth = D, setbacks = null, envelope = 'derived' } = {}) {
  const p = migrate(createProject({ name: 'Lot' }));
  p.levels = [];
  const lot = buildSiteLot({ lot: demoLotResponse(), address: '27 Conadilly Street Gunnedah NSW', source: 'nsw' });
  lot.boundary = [{ x: 0, y: 0 }, { x: width, y: 0 }, { x: width, y: depth }, { x: 0, y: depth }]; // edge 0 is the road frontage (north side)
  lot.holes = [];
  lot.parts = [];
  lot.neighbours = [];
  lot.areaM2 = Math.round((width * depth) / 1e6);
  lot.lotLabel = 'Lot 1 DP 758492';
  lot.frontEdges = [0];
  lot.cornerLot = corner;
  lot.frontageConfirmed = true;
  lot.setbacks = setbacks || { front: 6, secondaryFront: corner ? 3 : null, side: 0.9, rear: 3, edgeKinds: ['front', corner ? 'secondaryFront' : 'side', 'rear', 'side'] };
  lot.envelope = envelope === 'derived' ? null : envelope;
  lot.setbacksKey = null;
  p.site.lot = lot;
  return p;
}
