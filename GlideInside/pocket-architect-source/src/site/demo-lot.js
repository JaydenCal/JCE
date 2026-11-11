// The demo lot for the embedded viewer on the home page: a generic 24 x 45 m rectangular lot (the Glide houses are 14 to 17 m wide, so a 15 m lot cannot hold one inside its setbacks) on a street, with lots either side,
// behind it and across the road. The response has the shape of GET /api/site/lot (site coordinates in metres east and north of the
// origin), so it goes through the same path as a looked up address (applySiteLookup with `prefetched`). No real parcel is described.

import { mgaSrid } from './geo.js';

export const DEMO_LOT_W = 24;
export const DEMO_LOT_D = 45;
const ROAD = 18; // road reserve width, metres
const REAR = 40;

const ring = (x0, y0, x1, y1) => [[x0, y1], [x1, y1], [x1, y0], [x0, y0]];
const info = (n, r) => ({
  lotNumber: String(n),
  planLabel: 'DP 1234567',
  lotLabel: `Lot ${n} DP 1234567`,
  areaM2: Math.round(Math.abs((r[1][0] - r[0][0]) * (r[1][1] - r[2][1]))),
  polygons: [{ outer: r, holes: [] }],
});

export function demoLotResponse() {
  const W = DEMO_LOT_W;
  const D = DEMO_LOT_D;
  const y0 = -D / 2;
  const y1 = D / 2;
  const subject = ring(-W / 2, y0, W / 2, y1);
  const nb = [];
  let n = 1;
  for (const k of [-3, -2, -1, 1, 2, 3]) nb.push(info(n++, ring(k * W - W / 2, y0, k * W + W / 2, y1)));
  for (const k of [-2, -1, 0, 1, 2]) nb.push(info(n++, ring(k * W - W / 2, y1, k * W + W / 2, y1 + REAR)));
  for (const k of [-3, -2, -1, 0, 1, 2, 3]) nb.push(info(n++, ring(k * W - W / 2, y0 - ROAD - D, k * W + W / 2, y0 - ROAD)));
  const origin = { e: 302577.528, n: 6558552.325 };
  return {
    sample: true,
    demo: true,
    state: 'NSW',
    srid: mgaSrid(56),
    zone: 56,
    origin,
    query: { lon: 150.930273, lat: -31.090267 },
    lot: {
      lotNumber: '',
      planLabel: '',
      lotLabel: 'Sample lot',
      areaM2: W * D,
      polygons: [{ outer: subject, holes: [] }],
      section: '',
      lotPlan: '',
      registeredAreaM2: W * D,
      bboxMga: { minE: origin.e - W / 2, minN: origin.n - D / 2, maxE: origin.e + W / 2, maxN: origin.n + D / 2 },
    },
    neighbours: nb,
    roads: [{ name: 'Sample Street', points: [[-6 * W, y0 - ROAD / 2], [6 * W, y0 - ROAD / 2]] }],
    lga: 'TAMWORTH REGIONAL',
    zoning: { code: 'R1', name: 'General Residential', instrument: 'Tamworth Regional Local Environmental Plan 2010' },
    zoneNote: null,
    attribution: 'Sample lot for illustration only.',
    retrieved: null,
  };
}

/** The prefetched result applySiteLookup takes in place of a network lookup: a lot with no aerial and no ground levels. */
export const demoSite = () => ({ lot: demoLotResponse(), aerial: null, contours: null, warnings: [] });
