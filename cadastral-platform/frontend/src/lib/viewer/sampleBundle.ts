import type { BoxCollider, CatalogueItem, PartDef, PlacedItem, SceneBundle, Vec3 } from './types';
import { footprint, rectsOverlap } from './snapping';

/** Small synthetic bundle: sloping lot, gable-roof house, driveway, fence, pit and pipe, placed catalogue items. */
class PB {
  v: number[] = []; f: number[] = []; uv: number[] = []; vc: number[] = [];
  quad(a: Vec3, b: Vec3, c: Vec3, d: Vec3, uvs?: number[]) {
    const i = this.v.length / 3; this.v.push(...a, ...b, ...c, ...d); this.f.push(i, i + 1, i + 2, i, i + 2, i + 3);
    this.uv.push(...(uvs ?? [a[0], a[1], b[0], b[1], c[0], c[1], d[0], d[1]]));
  }
  tri(a: Vec3, b: Vec3, c: Vec3) { const i = this.v.length / 3; this.v.push(...a, ...b, ...c); this.f.push(i, i + 1, i + 2); this.uv.push(a[0], a[2], b[0], a[2], c[0], c[2]); }
  box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number) {
    this.quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]);
    this.quad([x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [x1, y0, z0]);
    this.quad([x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1], [y0, z0, y1, z0, y1, z1, y0, z1]);
    this.quad([x0, y1, z0], [x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [y1, z0, y0, z0, y0, z1, y1, z1]);
    this.quad([x1, y1, z0], [x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, z0, x0, z0, x0, z1, x1, z1]);
    this.quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], [x0, z0, x1, z0, x1, z1, x0, z1]);
  }
  part(n: string, c: string, col: string, o: Partial<PartDef> = {}): PartDef {
    return { n, c, col, v: this.v, f: this.f, uv: this.uv, ...(this.vc.length ? { vc: this.vc } : {}), ...o };
  }
}

const exist = (x: number, y: number) => 100 + 0.025 * (y + 20) + 0.01 * x + 0.06 * Math.sin(x * 0.5) * Math.cos(y * 0.4);
const PAD = { x0: -8, x1: 8, y0: -6, y1: 8, z: 100.75 };
const inPad = (x: number, y: number) => x >= PAD.x0 && x <= PAD.x1 && y >= PAD.y0 && y <= PAD.y1;
const design = (x: number, y: number) => (inPad(x, y) ? PAD.z : exist(x, y));
const FFL = 100.9, WALL_TOP = 103.4, T = 0.2;
const XS = Array.from({ length: 21 }, (_, i) => -20 + i * 2), YS = Array.from({ length: 25 }, (_, j) => -24 + j * 2);

function grid(fn: (x: number, y: number) => number, dz = 0, colour?: (x: number, y: number) => [number, number, number]) {
  const b = new PB();
  for (const y of YS) for (const x of XS) { b.v.push(x, y, fn(x, y) + dz); b.uv.push(x, y); if (colour) b.vc.push(...colour(x, y)); }
  const W = XS.length;
  for (let j = 0; j < YS.length - 1; j++) for (let i = 0; i < W - 1; i++) { const a = j * W + i; b.f.push(a, a + 1, a + W + 1, a, a + W + 1, a + W); }
  return b;
}
function tube(pts: Vec3[], r: number, sides = 10) {
  const b = new PB();
  pts.forEach((p) => { for (let s = 0; s < sides; s++) { const a = (s / sides) * Math.PI * 2; b.v.push(p[0] + Math.cos(a) * r, p[1], p[2] + Math.sin(a) * r); b.uv.push(p[1], s); } });
  for (let k = 0; k < pts.length - 1; k++) for (let s = 0; s < sides; s++) { const a = k * sides + s, c = k * sides + ((s + 1) % sides); b.f.push(a, c, a + sides, c, c + sides, a + sides); }
  return b;
}

export function buildSampleBundle(): SceneBundle {
  const parts: PartDef[] = []; const colliders: BoxCollider[] = [];
  const addCol = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, kind: string) =>
    colliders.push({ c: [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2], s: [x1 - x0, y1 - y0, z1 - z0], kind });

  parts.push(grid(exist).part('EG_survey_TIN', 'existing', '#8a8f78', { ro: 0.95 }));
  const cf = grid(design, 0.01, (x, y) => { const d = design(x, y) - exist(x, y), k = Math.min(1, Math.abs(d) / 0.6); return d > 0 ? [1 - 0.75 * k, 1 - 0.65 * k, 1] : [1, 1 - 0.65 * k, 1 - 0.75 * k]; });
  parts.push(cf.part('CutFill', 'cutfill', '#ffffff', { cs: false, ro: 0.95 }));
  parts.push(grid(design).part('Design_surface', 'surface', '#9fb07a', { tex: 'grass', ro: 0.95 }));

  // driveway draped on the design surface
  const dr = new PB(); for (let y = -20; y < -4; y += 2) dr.quad([-2, y, design(-2, y) + 0.03], [2, y, design(2, y) + 0.03], [2, y + 2, design(2, y + 2) + 0.03], [-2, y + 2, design(-2, y + 2) + 0.03]);
  parts.push(dr.part('Driveway', 'road', '#9a9893', { tex: 'conc', ro: 0.9 }));
  // DBYD buffer strip
  const bf = new PB(); bf.quad([10, -12, design(10, -12) + 0.05], [13, -12, design(13, -12) + 0.05], [13, 0, design(13, 0) + 0.05], [10, 0, design(10, 0) + 0.05]);
  parts.push(bf.part('DBYD_buffer', 'dbyd', '#f08a24', { a: 0.45, ro: 1 }));

  // house
  const slab = new PB(); slab.box(-6.2, -3.2, PAD.z - 0.3, 6.2, 5.2, FFL); parts.push(slab.part('Slab', 'buildings', '#b9b6ae', { tex: 'conc', cs: true }));
  const walls = new PB(), cl = (x0: number, y0: number, x1: number, y1: number, z0 = FFL, z1 = WALL_TOP) => { walls.box(x0, y0, z0, x1, y1, z1); addCol(x0, y0, z0, x1, y1, z1, 'wall'); };
  const o = (a: number, b: number, sill: number, head: number): [number, number, number, number] => [a, b, sill, head];
  const wallLine = (y: number, list: [number, number, number, number][]) => {
    let x = -6;
    for (const [a, b, sill, head] of list) {
      walls.box(x, y - T / 2, FFL, a, y + T / 2, WALL_TOP); addCol(x, y - T / 2, FFL, a, y + T / 2, WALL_TOP, 'wall');
      if (sill > 0) { walls.box(a, y - T / 2, FFL, b, y + T / 2, FFL + sill); addCol(a, y - T / 2, FFL, b, y + T / 2, FFL + sill, 'wall'); }
      walls.box(a, y - T / 2, FFL + head, b, y + T / 2, WALL_TOP); x = b;
    }
    walls.box(x, y - T / 2, FFL, 6, y + T / 2, WALL_TOP); addCol(x, y - T / 2, FFL, 6, y + T / 2, WALL_TOP, 'wall');
  };
  wallLine(-3, [o(-0.5, 0.5, 0, 2.1), o(2.5, 4.5, 0.9, 2.1)]);
  wallLine(5, [o(-4, -2, 0.9, 2.1)]);
  cl(-6 - T / 2, -3 - T / 2, -6 + T / 2, 5 + T / 2); cl(6 - T / 2, -3 - T / 2, 6 + T / 2, 5 + T / 2);
  cl(-6, 1.4, -1.5, 1.6); // partition
  walls.tri([6, -3, WALL_TOP], [6, 5, WALL_TOP], [6, 1, 105.2]); walls.tri([-6, 5, WALL_TOP], [-6, -3, WALL_TOP], [-6, 1, 105.2]);
  parts.push(walls.part('Walls', 'buildings', '#e6e1d6', { cs: true, ro: 0.85, ds: true }));
  const roof = new PB();
  roof.quad([-6.5, -3.5, WALL_TOP], [6.5, -3.5, WALL_TOP], [6.5, 1, 105.2], [-6.5, 1, 105.2], [-6.5, 0, 6.5, 0, 6.5, 4.8, -6.5, 4.8]);
  roof.quad([6.5, 5.5, WALL_TOP], [-6.5, 5.5, WALL_TOP], [-6.5, 1, 105.2], [6.5, 1, 105.2], [6.5, 0, -6.5, 0, -6.5, 4.8, 6.5, 4.8]);
  parts.push(roof.part('Roof_gable', 'buildings', '#5b6770', { tex: 'trimclad', cs: true, ds: true, me: 0.3, ro: 0.55 }));
  const ceil = new PB(); ceil.quad([-5.9, -2.9, WALL_TOP - 0.02], [5.9, -2.9, WALL_TOP - 0.02], [5.9, 4.9, WALL_TOP - 0.02], [-5.9, 4.9, WALL_TOP - 0.02]);
  parts.push(ceil.part('Ceiling', 'buildings', '#f2f0ea', { ds: true }));
  const glaze = new PB(); glaze.quad([2.5, -3, FFL + 0.9], [4.5, -3, FFL + 0.9], [4.5, -3, FFL + 2.1], [2.5, -3, FFL + 2.1]); glaze.quad([-4, 5, FFL + 0.9], [-2, 5, FFL + 0.9], [-2, 5, FFL + 2.1], [-4, 5, FFL + 2.1]);
  parts.push(glaze.part('Glazing', 'buildings', '#9cc7e0', { a: 0.35, ro: 0.1, ds: true }));

  // fence (east, west, north full height; south low with gate gap)
  const fence = new PB(); const FH = 1.8;
  const run = (x0: number, y0: number, x1: number, y1: number, h = FH) => {
    const n = Math.max(1, Math.round(Math.hypot(x1 - x0, y1 - y0) / 3)); let lo = 1e9;
    for (let k = 0; k <= n; k++) lo = Math.min(lo, exist(x0 + ((x1 - x0) * k) / n, y0 + ((y1 - y0) * k) / n));
    for (let k = 0; k < n; k++) {
      const ax = x0 + ((x1 - x0) * k) / n, ay = y0 + ((y1 - y0) * k) / n, bx = x0 + ((x1 - x0) * (k + 1)) / n, by = y0 + ((y1 - y0) * (k + 1)) / n;
      const zl = Math.min(exist(ax, ay), exist(bx, by)) - 0.05, t = 0.05;
      fence.box(Math.min(ax, bx) - t, Math.min(ay, by) - t, zl, Math.max(ax, bx) + t, Math.max(ay, by) + t, zl + h + 0.05);
    }
    addCol(Math.min(x0, x1) - 0.05, Math.min(y0, y1) - 0.05, lo - 0.1, Math.max(x0, x1) + 0.05, Math.max(y0, y1) + 0.05, lo + h, 'fence');
  };
  run(-15, -20, -15, 20); run(15, -20, 15, 20); run(-15, 20, 15, 20);
  run(-15, -20, -2, -20, 1.2); run(2, -20, 15, -20, 1.2);
  parts.push(fence.part('Fence_boundary', 'walls', '#8c7b66', { cs: true, ro: 0.8 }));

  // drainage: pit + pipe (below ground)
  const pit = new PB(); pit.box(7.7, 5.7, 99.6, 8.3, 6.3, exist(8, 6) + 0.02); parts.push(pit.part('Pit_P1', 'drainage', '#4a4f55', { ds: true, ro: 0.7 }));
  const pipe = tube([[8, 6, 99.9], [8, -2, 99.82], [8, -10, 99.75], [8, -18, 99.65]], 0.15); parts.push(pipe.part('Pipe_150', 'drainage', '#2d6cdf', { ds: true, ro: 0.5 }));

  // contours on the existing surface
  const cn: number[] = [];
  for (let L = 100.25; L < 101.2; L += 0.25) for (let x = -20; x < 20; x += 2) {
    const y = (L - 100 - 0.01 * x) / 0.025 - 20, y2 = (L - 100 - 0.01 * (x + 2)) / 0.025 - 20;
    if (Math.abs(y) < 24 && Math.abs(y2) < 24) cn.push(x, y, exist(x, y) + 0.04, x + 2, y2, exist(x + 2, y2) + 0.04);
  }
  parts.push({ n: 'Contours_0.25m', c: 'contours', col: '#8a6d3b', lines: cn });
  const bnd0 = [-15, -20, 0, 15, -20, 0, 15, -20, 0, 15, 20, 0, 15, 20, 0, -15, 20, 0, -15, 20, 0, -15, -20, 0];
  const bl: number[] = []; for (let k = 0; k < bnd0.length; k += 3) bl.push(bnd0[k], bnd0[k + 1], exist(bnd0[k], bnd0[k + 1]) + 0.08);
  parts.push({ n: 'Lot_boundary', c: 'boundary', col: '#c0392b', lines: bl });

  const catalogue = sampleCatalogue();
  const items: PlacedItem[] = [
    { id: 'p1', itemId: 'sofa3', p: [-3.2, 3.9, FFL], yaw: 180, surface: 'floor' },
    { id: 'p2', itemId: 'table6', p: [2.5, 2.5, FFL], yaw: 0, surface: 'floor' },
    { id: 'p3', itemId: 'fridge', p: [5.2, 4.3, FFL], yaw: 180, surface: 'floor' },
    { id: 'p4', itemId: 'shed', p: [11.5, -6, design(11.5, -6)], yaw: 0, surface: 'ground', warnings: ['over DBYD buffer'] },
    { id: 'p5', itemId: 'letterbox', p: [3.2, -19, design(3.2, -19)], yaw: 0, surface: 'ground' },
  ];
  return {
    info: { title: 'Demo Lot 12 Sample Street', subtitle: 'DEMO DATA, NOT A REAL SITE (synthetic bundle for the viewer demo, not survey data)', FFL, origin: [768000, 6407000, 0], z0: 100 },
    layers: [
      { c: 'surface', n: 'Design surface', on: true }, { c: 'contours', n: 'Contours (0.25 m)', on: true }, { c: 'existing', n: 'Existing ground TIN', on: false },
      { c: 'buildings', n: 'Buildings', on: true }, { c: 'drainage', n: 'Drainage (pit and pipe)', on: true }, { c: 'road', n: 'Driveway', on: true },
      { c: 'walls', n: 'Fences', on: true }, { c: 'boundary', n: 'Lot boundary', on: true }, { c: 'dbyd', n: 'DBYD service buffer', on: true }, { c: 'lab_gen', n: 'Labels', on: true },
    ],
    parts,
    labels: [
      { t: 'House FFL 100.90', p: [0, 1, 106.2], c: 'lab_gen', s: 2 }, { t: 'Driveway 4.0 m', p: [0, -14, design(0, -14) + 1.2], c: 'lab_gen', s: 2 },
      { t: 'Pit P1\nIL 99.60', p: [8, 6, 102], c: 'lab_gen', s: 2 }, { t: 'DBYD buffer\n(telecom duct)', p: [11.5, -6, 102.3], c: 'lab_gen', s: 2 },
    ],
    views: {
      'iso-sw': { dir: [-1, -1, 0.8] }, 'iso-ne': { dir: [1, 1, 0.8] }, plan: { dir: [0, 0, 1], ortho: true }, s: { dir: [0, -1, 0], ortho: true },
      frontage: { dir: [0, -1, 0.15], target: [0, -18, 101.5], dist: 24 }, entry: { dir: [0.3, -1, 0.12], target: [0, -3, 102], dist: 12 },
    },
    summary: [['Lot area', '1,200 m2'], ['House footprint', '12.0 x 8.0 m'], ['FFL', '100.90 m AHD'], ['Pad', '100.75 m AHD'], ['Max fall across lot', '1.2 m']],
    notes: ['Synthetic geometry for UI testing only.', 'Cut/fill is design surface minus existing TIN.', 'Items are illustrative; dimensions as supplied by retailers.'],
    walkable: { terrain: ['Design_surface'], colliders, floors: [{ n: 'House floor', min: [-5.8, -2.8], max: [5.8, 4.8], z: FFL }], spawn: { p: [0, -17, design(0, -17)], yaw: 0 } },
    items, catalogue,
  };
}

const svg = (label: string, col: string) => `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'><rect width='160' height='160' fill='${col}'/><rect x='6' y='6' width='148' height='148' fill='none' stroke='white' stroke-opacity='.6' stroke-width='3'/><text x='80' y='86' font-family='sans-serif' font-size='20' text-anchor='middle' fill='white'>${label}</text></svg>`)}`;
export function sampleCatalogue(): CatalogueItem[] {
  const base = { retailer: 'Demo Retailer', currency: 'AUD', priceAsAt: '2026-10-01', model_kind: 'proxy' as const };
  return [
    { ...base, id: 'sofa3', title: '3-seater fabric sofa', brand: 'Demo Living', category: 'Living', price: 1299, dims: { w: 2.1, d: 0.9, h: 0.85 }, image: svg('SOFA', '#6d7f8c'), sku: 'DL-SOFA3', url: 'https://example.com/sofa3' },
    { ...base, id: 'table6', title: 'Dining table, 6 seat', brand: 'Demo Living', category: 'Living', price: 899, dims: { w: 1.6, d: 0.9, h: 0.75 }, image: svg('TABLE', '#a47c52'), sku: 'DL-TBL6', url: 'https://example.com/table6' },
    { ...base, id: 'fridge', title: 'French door fridge 600 L', brand: 'Demo Appliance', category: 'Kitchen', price: 2199, dims: { w: 0.9, d: 0.75, h: 1.8 }, image: svg('FRIDGE', '#9aa1a8'), sku: 'DA-FR600', url: 'https://example.com/fridge' },
    { ...base, id: 'tv', title: '65 in wall-mount TV', brand: 'Demo Appliance', category: 'Living', price: 1499, dims: { w: 1.45, d: 0.06, h: 0.84 }, image: svg('TV', '#22272e'), mount: 'wall', sku: 'DA-TV65' },
    { ...base, retailer: 'Demo Hardware', id: 'shed', title: 'Garden shed 2.4 x 1.8 m', brand: 'Demo Outdoor', category: 'Outdoor', price: 749, dims: { w: 2.4, d: 1.8, h: 2.1 }, image: svg('SHED', '#7b8f6a'), sku: 'DO-SHED24' },
    { ...base, retailer: 'Demo Hardware', id: 'tank', title: 'Poly rainwater tank 2000 L', brand: 'Demo Outdoor', category: 'Outdoor', price: 1190, dims: { w: 1.4, d: 1.4, h: 1.7 }, image: svg('TANK', '#506c8a'), sku: 'DO-TK2000' },
    { ...base, retailer: 'Demo Hardware', id: 'bbq', title: '4-burner BBQ on trolley', brand: 'Demo Outdoor', category: 'Outdoor', price: 599, dims: { w: 1.4, d: 0.6, h: 1.0 }, image: svg('BBQ', '#3a3d42'), sku: 'DO-BBQ4' },
    { ...base, retailer: 'Demo Hardware', id: 'letterbox', title: 'Letterbox post-mount', brand: 'Demo Outdoor', category: 'Outdoor', price: 89, dims: { w: 0.3, d: 0.2, h: 1.2 }, image: svg('MAIL', '#b3412f'), sku: 'DO-LB1' },
  ];
}

/** Demo compliance rules: DBYD buffer rectangle and 0.9 m boundary setback for items taller than 1 m. */
export function sampleComplianceCheck(item: PlacedItem, cat: Map<string, CatalogueItem>): string[] {
  const c = cat.get(item.itemId); if (!c) return [];
  const fp = footprint(item.p, c.dims, item.yaw); const out: string[] = [];
  if (rectsOverlap(fp, [10, -12, 13, 0])) out.push('over DBYD buffer');
  if (c.dims.h > 1 && (fp[0] < -14.1 || fp[2] > 14.1 || fp[3] > 19.1 || fp[1] < -19.1)) out.push('inside 0.9 m boundary setback');
  return out;
}
