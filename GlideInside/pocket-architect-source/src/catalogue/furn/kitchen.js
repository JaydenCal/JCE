// Kitchen: straight bench run, island, fridge, oven, dishwasher, pantry unit.

import { B, Y, COL, across, box, line, circle, thin, tint, dashed, item, model, addCabinet, frontPanels } from './kit.js';

const CAT = 'Kitchen';

// ----- Straight bench run with sink and cooktop. Back against -y, front edge at +y. -----
function drawRings(ctx, cx, cy, spacingX, spacingY, r) {
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      circle(ctx, cx + sx * spacingX, cy + sy * spacingY, r);
      thin(ctx, () => circle(ctx, cx + sx * spacingX, cy + sy * spacingY, r * 0.5));
    }
  }
}

function drawBench(ctx, w, d) {
  const hw = w / 2;
  const hd = d / 2;
  box(ctx, -hw, -hd, w, d);
  thin(ctx, () => line(ctx, -hw, hd - 40, hw, hd - 40));
  const sx = -w * 0.22;
  const bw = Math.min(340, w * 0.12);
  const bd = Math.min(400, d * 0.68);
  for (const k of [-1, 1]) box(ctx, sx + k * (bw / 2 + 22) - bw / 2, -bd / 2 + 10, bw, bd, { r: 40 });
  thin(ctx, () => {
    circle(ctx, sx, -hd + 55, 22);
    line(ctx, sx, -hd + 55, sx, -hd + 55 + 90);
  });
  const cx = w * 0.22;
  const cw = Math.min(600, w * 0.2);
  const cd = Math.min(520, d * 0.86);
  box(ctx, cx - cw / 2, -cd / 2, cw, cd, { r: 12 });
  drawRings(ctx, cx, 0, cw * 0.24, cd * 0.23, Math.min(cw, cd) * 0.17);
}

function bench3d(THREE, size) {
  return model(THREE, 'kitchen_bench', size, (m) => {
    const { W, D, H, mat, add } = m;
    const Ht = Math.max(0.5, H - 0.15);
    addCabinet({ ...m, H: Ht }, { plinth: 0.1, topT: 0.035, n: across(W, 0.6, 2), handle: 'h', carcass: '#d9d6cf', front: '#f0eee9', top: COL.stone });
    const sx = -W * 0.22;
    const sw = Math.min(0.8, W * 0.27);
    const tz = -D / 2 + 0.07;
    add(mat(COL.steel, { rough: 0.35, metal: 0.8 }), [
      B(sw, 0.004, D * 0.76, sx, Ht, 0.02),
      Y(0.014, 0.136, sx, Ht, tz),
      B(0.014, 0.014, 0.17, sx, Ht + 0.136, tz + 0.078),
    ]);
    add(mat('#8d9398', { rough: 0.4, metal: 0.8 }), [-1, 1].map((k) => B(sw / 2 - 0.05, 0.002, D * 0.62, sx + k * (sw / 4), Ht + 0.004, 0.03)));
    const cx = W * 0.22;
    const cw = Math.min(0.6, W * 0.2);
    const cd = D * 0.86;
    add(mat('#16181a', { rough: 0.15, metal: 0.2 }), [B(cw, 0.004, cd, cx, Ht, 0)]);
    const rings = [];
    for (const kx of [-1, 1]) for (const kz of [-1, 1]) rings.push(Y(Math.min(cw, cd) * 0.17, 0.002, cx + kx * cw * 0.24, Ht + 0.004, kz * cd * 0.23, { seg: 18 }));
    add(mat('#5b6065', { rough: 0.4, metal: 0.7 }), rings);
  });
}

// ----- Island with a breakfast bar overhang on the front (+y). -----
function drawIsland(ctx, w, d) {
  const hw = w / 2;
  const hd = d / 2;
  box(ctx, -hw, -hd, w, d);
  thin(ctx, () => dashed(ctx, 90, 50, () => line(ctx, -hw + 30, -hd + d * 0.65, hw - 30, -hd + d * 0.65)));
  thin(ctx, () => box(ctx, -hw + 30, -hd + 30, w - 60, d * 0.65 - 60, { fill: false }));
  tint(ctx, 0.05, () => box(ctx, -hw, -hd + d * 0.65, w, d * 0.35, { stroke: false }));
}

function island3d(THREE, size) {
  return model(THREE, 'kitchen_island', size, (m) => {
    const { W, D, H, mat, add } = m;
    const cd = 0.65;
    addCabinet(m, { cd, plinth: 0.1, topT: 0.04, n: across(W, 0.6, 2), handle: 'h', carcass: '#d9d6cf', front: '#f0eee9', top: COL.stone });
    add(mat('#f0eee9', { rough: 0.55 }), [-1, 1].map((k) => B(0.04, H - 0.04, D - cd - 0.06, k * (W / 2 - 0.02), 0, -D / 2 + cd + (D - cd - 0.06) / 2)));
  });
}

// ----- Appliances. -----
function drawFridge(ctx, w, d) {
  const hw = w / 2;
  const hd = d / 2;
  box(ctx, -hw, -hd, w, d, { r: 10 });
  thin(ctx, () => {
    line(ctx, -hw, hd - 60, hw, hd - 60);
    line(ctx, 0, hd - 60, 0, hd);
    line(ctx, -w * 0.08, hd - 60, -w * 0.08, hd - 20);
    line(ctx, w * 0.08, hd - 60, w * 0.08, hd - 20);
  });
  tint(ctx, 0.05, () => box(ctx, -hw, -hd, w, d - 60, { stroke: false }));
}

function fridge3d(THREE, size) {
  return model(THREE, 'fridge', size, ({ W, D, H, mat, add }) => {
    add(mat('#b3b8bc', { rough: 0.5, metal: 0.5 }), [B(W, H, D - 0.021, 0, 0, -0.0105)]);
    const split = H * 0.6;
    const up = frontPanels({ W, y0: split, y1: H - 0.005, zFront: D / 2, n: 2, handle: 'v' });
    const lo = frontPanels({ W, y0: 0.02, y1: split - 0.002, zFront: D / 2, n: 1, handle: 'h' });
    add(mat('#d6d9db', { rough: 0.35, metal: 0.7 }), [...up.panels, ...lo.panels]);
    add(mat('#3a3d40', { rough: 0.4, metal: 0.6 }), [...up.handles, ...lo.handles]);
  });
}

function drawOven(ctx, w, d) {
  const hw = w / 2;
  const hd = d / 2;
  box(ctx, -hw, -hd, w, d, { r: 8 });
  drawRings(ctx, 0, -d * 0.04, w * 0.22, d * 0.2, Math.min(w, d) * 0.15);
  thin(ctx, () => {
    line(ctx, -hw, hd - 55, hw, hd - 55);
    line(ctx, -w * 0.3, hd - 28, w * 0.3, hd - 28);
  });
}

function oven3d(THREE, size) {
  return model(THREE, 'oven', size, ({ W, D, H, mat, add }) => {
    const body = H - 0.1;
    const bd = D - 0.024;
    add(mat('#cfd2d4', { rough: 0.4, metal: 0.6 }), [B(W, body, bd, 0, 0, -0.012), B(W, H - body - 0.006, 0.05, 0, body + 0.006, -D / 2 + 0.025)]);
    add(mat('#16181a', { rough: 0.15, metal: 0.2 }), [B(W, 0.006, D, 0, body, 0)]);
    add(mat('#1a1c1e', { rough: 0.2, metal: 0.3 }), [B(W - 0.05, body * 0.62, 0.012, 0, body * 0.2, D / 2 - 0.018)]);
    add(mat(COL.chrome, { rough: 0.3, metal: 0.9 }), [B(W - 0.14, 0.02, 0.02, 0, body * 0.8, D / 2 - 0.01)]);
    const rings = [];
    for (const kx of [-1, 1]) for (const kz of [-1, 1]) rings.push(Y(Math.min(W, D) * 0.13, 0.003, kx * W * 0.22, body + 0.006, kz * D * 0.2 - D * 0.04, { seg: 18 }));
    add(mat('#5b6065', { rough: 0.4, metal: 0.7 }), rings);
    const knobs = [-1.5, -0.5, 0.5, 1.5].map((i) => Y(0.016, 0.014, i * W * 0.2, body + 0.03, -D / 2 + 0.057, { rx: Math.PI / 2 }));
    add(mat('#2b2d30', { rough: 0.5, metal: 0.5 }), knobs);
  });
}

function drawDishwasher(ctx, w, d) {
  const hw = w / 2;
  const hd = d / 2;
  box(ctx, -hw, -hd, w, d, { r: 6 });
  thin(ctx, () => {
    box(ctx, -hw + 40, -hd + 40, w - 80, d - 130, { r: 10, fill: false });
    for (const f of [0.3, 0.5, 0.7]) line(ctx, -hw + 70, -hd + 40 + (d - 130) * f, hw - 70, -hd + 40 + (d - 130) * f);
    line(ctx, -hw, hd - 55, hw, hd - 55);
  });
}

function dishwasher3d(THREE, size) {
  return model(THREE, 'dishwasher', size, ({ W, D, H, mat, add }) => {
    add(mat('#eceae6', { rough: 0.5 }), [B(W, H, D - 0.021, 0, 0, -0.0105)]);
    const f = frontPanels({ W, y0: 0.03, y1: H - 0.005, zFront: D / 2, n: 1, handle: 'h' });
    add(mat('#c3c7ca', { rough: 0.35, metal: 0.7 }), f.panels);
    add(mat('#3a3d40', { rough: 0.4, metal: 0.6 }), f.handles);
    add(mat('#1a1c1e', { rough: 0.3 }), [B(W - 0.06, 0.04, 0.004, 0, H - 0.075, D / 2 - 0.004)]);
  });
}

function drawPantry(ctx, w, d) {
  const hw = w / 2;
  const hd = d / 2;
  box(ctx, -hw, -hd, w, d);
  thin(ctx, () => dashed(ctx, 70, 40, () => box(ctx, -hw + 35, -hd + 35, w - 70, d - 100, { fill: false })));
  const n = across(w / 1000, 0.45, 2);
  const dw = w / n;
  for (let i = 0; i < n; i++) thin(ctx, () => box(ctx, -hw + i * dw + 6, hd - 24, dw - 12, 24, { fill: false }));
}

export const KITCHEN = [
  item('kitchen_bench', 'Kitchen bench with sink and cooktop', CAT, 3000, 600, 1050, drawBench, bench3d),
  item('kitchen_island', 'Kitchen island', CAT, 2400, 1000, 900, drawIsland, island3d),
  item('fridge', 'Fridge', CAT, 900, 700, 1800, drawFridge, fridge3d),
  item('oven', 'Freestanding oven', CAT, 600, 600, 1000, drawOven, oven3d),
  item('dishwasher', 'Dishwasher', CAT, 600, 600, 850, drawDishwasher, dishwasher3d),
  item('pantry_unit', 'Pantry cupboard', CAT, 900, 600, 2100, drawPantry, (THREE, size) => model(THREE, 'pantry_unit', size, (m) => {
    addCabinet(m, { plinth: 0.08, n: 2, handle: 'v', carcass: COL.carcass, front: '#ebe8e1' });
  })),
];
