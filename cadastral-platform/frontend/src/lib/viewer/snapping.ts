import type { CatalogueItem, PlacedItem, Vec3 } from './types';

export const ROT_STEP = 15;
export const normDeg = (d: number) => ((d % 360) + 360) % 360;
export const stepYaw = (yaw: number, dir: 1 | -1, step = ROT_STEP) => normDeg(Math.round((yaw + dir * step) / step) * step);
export const snapYaw = (yaw: number, step = ROT_STEP) => normDeg(Math.round(yaw / step) * step);

export interface SnapInput { point: Vec3; normal: Vec3; layer: string; dims: CatalogueItem['dims']; mount?: 'floor' | 'wall'; yaw: number }
export interface SnapResult { p: Vec3; yaw: number; surface: 'ground' | 'floor' | 'wall'; needsDrop: boolean }
const GROUND_LAYERS = ['existing', 'surface', 'road', 'edgestrips', 'context', 'cutfill'];

/** Decide where an item sits given a raycast hit. Pure; `needsDrop` asks the caller to re-ground floor items placed against walls. */
export function snapFromHit(i: SnapInput, slopeLimitDeg = 45): SnapResult {
  const [nx, ny, nz] = i.normal;
  const isFloor = nz >= Math.cos((slopeLimitDeg * Math.PI) / 180);
  const isWall = Math.abs(nz) < 0.35;
  if (isWall && (nx !== 0 || ny !== 0)) {
    const h = Math.hypot(nx, ny), ux = nx / h, uy = ny / h;
    const yaw = normDeg((Math.atan2(ux, uy) * 180) / Math.PI); // item's front (+Y local) faces away from wall
    const off = i.dims.d / 2 + 0.005;
    const p: Vec3 = [i.point[0] + ux * off, i.point[1] + uy * off, i.mount === 'wall' ? i.point[2] - i.dims.h / 2 : i.point[2]];
    return { p, yaw, surface: 'wall', needsDrop: i.mount !== 'wall' };
  }
  const surface = GROUND_LAYERS.includes(i.layer) ? 'ground' : 'floor';
  return { p: [i.point[0], i.point[1], i.point[2]], yaw: snapYaw(i.yaw), surface: isFloor ? surface : 'ground', needsDrop: false };
}

/** Axis-aligned footprint (x0,y0,x1,y1) of an item rotated by yaw degrees. */
export function footprint(p: Vec3, dims: CatalogueItem['dims'], yawDeg: number): [number, number, number, number] {
  const a = (yawDeg * Math.PI) / 180, c = Math.abs(Math.cos(a)), s = Math.abs(Math.sin(a));
  const hx = (dims.w * c + dims.d * s) / 2, hy = (dims.w * s + dims.d * c) / 2;
  return [p[0] - hx, p[1] - hy, p[0] + hx, p[1] + hy];
}
export const rectsOverlap = (a: number[], b: number[]) => a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1];

export function shoppingList(items: PlacedItem[], cat: Map<string, CatalogueItem>) {
  const rows = new Map<string, { item: CatalogueItem; qty: number }>();
  for (const it of items) { const c = cat.get(it.itemId); if (!c) continue; const r = rows.get(c.id); if (r) r.qty++; else rows.set(c.id, { item: c, qty: 1 }); }
  const list = [...rows.values()];
  const total = list.reduce((a, r) => a + r.item.price * r.qty, 0);
  const asAt = list.map((r) => r.item.priceAsAt).filter(Boolean).sort().pop();
  return { rows: list, total, asAt };
}
const q = (v: string | number | undefined) => `"${String(v ?? '').replace(/"/g, '""')}"`;
export function shoppingCsv(items: PlacedItem[], cat: Map<string, CatalogueItem>): string {
  const { rows, total, asAt } = shoppingList(items, cat);
  const head = ['Item', 'Brand', 'Retailer', 'SKU', 'Qty', 'Unit price', 'Line total', 'Dimensions W x D x H (m)', 'Price as at', 'URL'];
  const lines = rows.map((r) => [r.item.title, r.item.brand, r.item.retailer, r.item.sku, r.qty, r.item.price.toFixed(2), (r.item.price * r.qty).toFixed(2),
    `${r.item.dims.w} x ${r.item.dims.d} x ${r.item.dims.h}`, r.item.priceAsAt, r.item.url].map(q).join(','));
  return [head.map(q).join(','), ...lines, ['Total', '', '', '', '', '', total.toFixed(2), '', asAt ?? '', ''].map(q).join(',')].join('\r\n');
}
