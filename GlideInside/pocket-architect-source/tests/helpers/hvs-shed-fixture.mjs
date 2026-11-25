// The Hastings Valley Sheds case (a portal builder account): a 15 x 9 m skillion shed (5 degree roof, 3.5 m low eave, 4.287 m high side, roller doors
// RD1 3849 x 3315 and RD2 3850 x 2925 with a 589 mm mullion between them on the high long wall, a PA door on the low long wall) turned about 100
// degrees on a 2,748 m2 R1 lot with an existing dwelling at the front. The lot is a synthetic rectangle (no real parcel) and the aerial is a drawn
// picture, so the tests need no network.
import zlib from 'node:zlib';
import { createStore } from '../../src/model/store.js';
import { addBuilding } from '../../src/commercial/catalogue/ops.js';
import { addExistingBuilding } from '../../src/site/existing-buildings.js';
import { commercialProject } from './commercial-fixture.mjs';
import { materialise } from '../../src/commercial/materialise.js';

export const LOT_W = 36000;
export const LOT_D = 76333; // 2,748 m2
export const SHED = Object.freeze({ W: 15000, D: 9000, H: 3500, roofPitchDeg: 5, doorCount: 2, doorW: 3849, doorH: 3315, door2W: 3850, door2H: 2925, mullionMm: 589, doorPos: 'centre', personnelDoors: 1, paWall: 'rear' });
export const BUILDER = Object.freeze({ name: 'Hastings Valley Sheds', logo: null, details: { phone: '02 5555 0100', email: 'office@example.com' }, client: null });

/** A commercial mode project holding the skillion shed on the R1 lot. `existing` adds the dwelling; `shed` overrides shed parameters. */
export function hvsShedProject({ rotationDeg = 100, existing = true, shed = {}, zoning = { code: 'R1', name: 'General Residential' } } = {}) {
  const p0 = commercialProject({ width: LOT_W, depth: LOT_D, zoning, rows: 'none', setbacks: { front: 6, secondaryFront: null, side: 0.9, rear: 3, edgeKinds: ['front', 'side', 'rear', 'side'] } });
  p0.site.lot.lga = 'PORT MACQUARIE-HASTINGS';
  p0.site.lot.lotLabel = 'Lot 2 DP 1234567';
  p0.site.lot.address = '123A Cameron Street Wauchope NSW';
  p0.titleBlock = { ...(p0.titleBlock || {}), address: '123A Cameron Street, Wauchope NSW', projectName: '15 x 9 m skillion shed' };
  p0.name = '15 x 9 m skillion shed';
  const store = createStore(p0, { autosaveKey: null });
  store.apply('No strata rows', (q) => { q.commercial.rows = []; materialise(q); });
  addBuilding(store, 'skillion-shed', { params: { ...SHED, ...shed }, place: { x: 27000, y: 34000, rotationDeg } });
  const p = store.project;
  if (existing) addExistingBuilding(p, { name: 'EXISTING DWELLING', x: 14000, y: 16000, widthMm: 15000, depthMm: 10000, rotationDeg: 0, heightMm: 3200 });
  return p;
}

// A tiny PNG writer (8 bit RGB), so the synthetic aerial is a real image file.
const crcTable = (() => { const t = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
export function pngOf(w, h, pixel) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 3 + 1)] = 0; for (let x = 0; x < w; x++) { const [r, g, b] = pixel(x, y); const o = y * (w * 3 + 1) + 1 + x * 3; raw[o] = r; raw[o + 1] = g; raw[o + 2] = b; } }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

/**
 * A drawn aerial of the lot and 120 m round it: grass, the road north of the frontage, a house roof where the existing dwelling is, tree crowns and
 * the track to the back. Returns { image (data URL), extent (plan mm), attribution }.
 */
export function syntheticAerial({ margin = 120000, px = 640 } = {}) {
  const x0 = -margin; const y0 = -margin; const x1 = LOT_W + margin; const y1 = LOT_D + margin;
  const sx = (x1 - x0) / px; const sy = (y1 - y0) / px;
  const trees = [[6000, 60000, 5000], [30000, 66000, 6000], [22000, 8000, 4500], [-20000, 40000, 7000], [60000, 30000, 8000], [8000, 28000, 4000]];
  const pixel = (ix, iy) => {
    const x = x0 + ix * sx; const y = y0 + iy * sy;
    const noise = ((ix * 7 + iy * 13) % 11) * 2;
    if (y < -9000 && y > -21000) return [96 + noise, 98 + noise, 100 + noise]; // road
    if (x > 6500 && x < 21500 && y > 11000 && y < 21000) return [150 + noise, 82, 66]; // dwelling roof
    for (const [tx, ty, r] of trees) if (Math.hypot(x - tx, y - ty) < r) return [38 + noise, 92 + noise, 44];
    const inLot = x >= 0 && x <= LOT_W && y >= 0 && y <= LOT_D;
    return inLot ? [128 + noise, 150 + noise, 84] : [112 + noise, 138 + noise, 78];
  };
  const png = pngOf(px, px, pixel);
  return { image: `data:image/png;base64,${png.toString('base64')}`, extent: { x0, y0, x1, y1 }, attribution: 'Synthetic aerial for tests' };
}
