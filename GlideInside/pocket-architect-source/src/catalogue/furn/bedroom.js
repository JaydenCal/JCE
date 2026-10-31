// Bedroom furniture: beds, bedside table, wardrobe, chest of drawers.

import { B, COL, across, box, line, circle, thin, tint, dashed, item, model, addCabinet } from './kit.js';

const CAT = 'Bedroom';

// ----- Beds. +y is the foot of the bed, the head is against the -y wall. -----
function drawBed(ctx, w, d, pillows) {
  const hw = w / 2;
  const hd = d / 2;
  box(ctx, -hw, -hd, w, d, { r: 20 });
  tint(ctx, 0.14, () => box(ctx, -hw, -hd, w, 70, { r: 20, stroke: false }));
  line(ctx, -hw, -hd + 70, hw, -hd + 70);
  const margin = 80;
  const gap = 50;
  const pw = (w - 2 * margin - (pillows - 1) * gap) / pillows;
  for (let i = 0; i < pillows; i++) box(ctx, -hw + margin + i * (pw + gap), -hd + 110, pw, 380, { r: 70 });
  const top = -hd + 520;
  box(ctx, -hw + 45, top, w - 90, hd - 45 - top, { r: 30, fill: false });
  tint(ctx, 0.1, () => box(ctx, -hw + 45, top, w - 90, 230, { stroke: false }));
  thin(ctx, () => line(ctx, -hw + 45, top + 230, hw - 45, top + 230));
}

function bed3d(THREE, id, size, pillows) {
  return model(THREE, id, size, ({ W, D, H, mat, add }) => {
    const legH = 0.12;
    const frame = 0.2;
    const base = legH + frame;
    const mt = 0.22;
    const top = base + mt;
    const hx = W / 2 - 0.05;
    const hz = D / 2 - 0.05;
    add(mat('#8a6a4a', { rough: 0.7 }), [
      B(0.06, legH, 0.06, -hx, 0, -hz), B(0.06, legH, 0.06, hx, 0, -hz),
      B(0.06, legH, 0.06, -hx, 0, hz), B(0.06, legH, 0.06, hx, 0, hz),
      B(W, frame, D, 0, legH, 0),
      B(W, H - legH, 0.07, 0, legH, -D / 2 + 0.035),
    ]);
    add(mat('#efece5'), [B(W - 0.06, mt, D - 0.1, 0, base, 0)]);
    const dz = D * 0.64;
    add(mat('#7d8f9c'), [B(W - 0.04, 0.07, dz, 0, top, D / 2 - 0.02 - dz / 2)]);
    add(mat('#b9a98c'), [B(W - 0.03, 0.075, 0.34, 0, top, D / 2 - 0.02 - 0.17)]);
    const pw = Math.min(0.64, (W - 0.12) / pillows - 0.04);
    const parts = [];
    for (let i = 0; i < pillows; i++) parts.push(B(pw, 0.13, 0.4, (i - (pillows - 1) / 2) * ((W - 0.1) / pillows), top, -D / 2 + 0.29));
    add(mat('#f4f1eb'), parts);
  });
}

const bed = (id, name, w, d, pillows) => item(id, name, CAT, w, d, 900, (ctx, W, D) => drawBed(ctx, W, D, pillows), (THREE, size) => bed3d(THREE, id, size, pillows));

// ----- Bedside table. -----
function drawBedside(ctx, w, d) {
  const hw = w / 2;
  const hd = d / 2;
  box(ctx, -hw, -hd, w, d, { r: 15 });
  thin(ctx, () => box(ctx, -hw + 35, -hd + 35, w - 70, d - 70, { r: 10, fill: false }));
  circle(ctx, 0, -d * 0.15, Math.min(w, d) * 0.2);
  circle(ctx, 0, -d * 0.15, Math.min(w, d) * 0.09);
}

// ----- Wardrobe. Hanging rail and door leaves along the front (+y). -----
function drawWardrobe(ctx, w, d) {
  const hw = w / 2;
  const hd = d / 2;
  box(ctx, -hw, -hd, w, d);
  const n = across(w / 1000, 0.6, 2);
  const dw = w / n;
  for (let i = 0; i < n; i++) thin(ctx, () => box(ctx, -hw + i * dw + 6, hd - 24, dw - 12, 24, { fill: false }));
  const railY = -hd + d * 0.42;
  thin(ctx, () => dashed(ctx, 60, 40, () => line(ctx, -hw + 40, railY, hw - 40, railY)));
  thin(ctx, () => {
    for (let x = -hw + 110; x < hw - 110; x += 130) line(ctx, x, railY - 85, x + 45, railY + 85);
  });
}

// ----- Chest of drawers. -----
function drawChest(ctx, w, d) {
  const hw = w / 2;
  const hd = d / 2;
  box(ctx, -hw, -hd, w, d, { r: 12 });
  thin(ctx, () => box(ctx, -hw + 30, -hd + 30, w - 60, d - 60, { r: 8, fill: false }));
  thin(ctx, () => line(ctx, -hw + 30, hd - 60, hw - 30, hd - 60));
  for (const x of [-w * 0.25, w * 0.25]) circle(ctx, x, hd - 45, 14);
}

export const BEDROOM = [
  bed('bed_single', 'Single bed', 920, 1880, 1),
  bed('bed_king_single', 'King single bed', 1070, 2030, 1),
  bed('bed_double', 'Double bed', 1380, 1880, 2),
  bed('bed_queen', 'Queen bed', 1530, 2030, 2),
  bed('bed_king', 'King bed', 1830, 2030, 2),
  item('bedside', 'Bedside table', CAT, 450, 400, 550, drawBedside, (THREE, size) => model(THREE, 'bedside', size, (m) => {
    addCabinet(m, { legH: 0.1, topT: 0.025, kick: 0.02, rows: 2, handle: 'h', carcass: '#a98862', front: '#c3a37a', top: '#c3a37a', leg: '#8a6a4a' });
  })),
  item('wardrobe', 'Wardrobe', CAT, 1800, 600, 2100, drawWardrobe, (THREE, size) => model(THREE, 'wardrobe', size, (m) => {
    addCabinet(m, { kick: 0.07, n: across(m.W, 0.6, 2), handle: 'v', carcass: COL.carcass, front: '#ebe8e1' });
  })),
  item('chest_drawers', 'Chest of drawers', CAT, 900, 450, 1100, drawChest, (THREE, size) => model(THREE, 'chest_drawers', size, (m) => {
    addCabinet(m, { legH: 0.08, topT: 0.03, kick: 0.02, rows: 5, handle: 'h', carcass: '#8a6a4a', front: '#a07f58', top: '#a07f58', leg: '#6b4a33' });
  })),
];
