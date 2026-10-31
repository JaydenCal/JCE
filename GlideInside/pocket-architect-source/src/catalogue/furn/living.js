// Living room furniture and dining sets.

import { B, Y, S, COL, TAU, across, box, line, circle, poly, thin, tint, dashed, item, model, addCabinet } from './kit.js';

const LIV = 'Living';
const DIN = 'Dining';

// ----- Sofas. +y is the seat edge, the back is against -y. -----
function drawSofa(ctx, w, d, seats, arm = 140, back = 230) {
  const hw = w / 2;
  const hd = d / 2;
  box(ctx, -hw, -hd, w, d, { r: 40 });
  tint(ctx, 0.1, () => box(ctx, -hw, -hd, w, back, { r: 40, stroke: false }));
  line(ctx, -hw, -hd + back, hw, -hd + back);
  line(ctx, -hw + arm, -hd + back, -hw + arm, hd);
  line(ctx, hw - arm, -hd + back, hw - arm, hd);
  const slot = (w - 2 * arm) / seats;
  for (let i = 0; i < seats; i++) {
    const x = -hw + arm + i * slot;
    box(ctx, x + 14, -hd + back + 14, slot - 28, d - back - 34, { r: 36, fill: false });
    thin(ctx, () => box(ctx, x + 30, -hd + 28, slot - 60, back - 56, { r: 40, fill: false }));
  }
}

function sofa3d(THREE, id, size, { seats, fabric, cushion, arm = 0.16 }) {
  return model(THREE, id, size, ({ W, D, H, mat, add }) => {
    const legH = 0.1;
    const baseTop = 0.28;
    const backT = 0.22;
    const seatH = 0.17;
    const armTop = 0.62;
    const lx = W / 2 - 0.07;
    const lz = D / 2 - 0.07;
    add(mat(COL.walnut, { rough: 0.6 }), [-1, 1].flatMap((sx) => [-1, 1].map((sz) => B(0.05, legH, 0.05, sx * lx, 0, sz * lz))));
    const frame = [
      B(W, baseTop - legH, D, 0, legH, 0),
      B(W, H - 0.02 - baseTop, backT, 0, baseTop, -D / 2 + backT / 2),
      B(arm, armTop - baseTop, D, -(W / 2 - arm / 2), baseTop, 0),
      B(arm, armTop - baseTop, D, W / 2 - arm / 2, baseTop, 0),
    ];
    add(mat(fabric), frame);
    const slot = (W - 2 * arm) / seats;
    const cush = [];
    for (let i = 0; i < seats; i++) {
      const x = -W / 2 + arm + (i + 0.5) * slot;
      cush.push(B(slot - 0.012, seatH, D - backT, x, baseTop, backT / 2));
      cush.push(B(slot - 0.012, H - baseTop - seatH, 0.14, x, baseTop + seatH, -D / 2 + backT + 0.07));
    }
    add(mat(cushion), cush);
  });
}

function drawSofaL(ctx, w, d) {
  const hw = w / 2;
  const hd = d / 2;
  const md = Math.min(950, d * 0.6);
  const cw = Math.min(950, w * 0.4);
  const arm = 140;
  const back = 230;
  poly(ctx, [[-hw, -hd], [hw, -hd], [hw, hd], [hw - cw, hd], [hw - cw, -hd + md], [-hw, -hd + md]]);
  tint(ctx, 0.1, () => box(ctx, -hw, -hd, w, back, { stroke: false }));
  line(ctx, -hw, -hd + back, hw, -hd + back);
  line(ctx, -hw + arm, -hd + back, -hw + arm, -hd + md);
  const slot = (w - arm - cw) / 2;
  for (let i = 0; i < 2; i++) box(ctx, -hw + arm + i * slot + 14, -hd + back + 14, slot - 28, md - back - 28, { r: 36, fill: false });
  box(ctx, hw - cw + 14, -hd + back + 14, cw - 28, d - back - 28, { r: 36, fill: false });
  const bs = (w - arm) / 3;
  for (let i = 0; i < 3; i++) thin(ctx, () => box(ctx, -hw + arm + i * bs + 30, -hd + 28, bs - 60, back - 56, { r: 40, fill: false }));
}

function sofaL3d(THREE, size) {
  return model(THREE, 'sofa_l', size, ({ W, D, H, mat, add }) => {
    const md = Math.min(0.95, D * 0.6);
    const cw = Math.min(0.95, W * 0.4);
    const arm = 0.16;
    const legH = 0.1;
    const baseTop = 0.28;
    const backT = 0.22;
    const seatH = 0.17;
    const mainZ = -D / 2 + md / 2;
    const chaiseD = D - md;
    add(mat(COL.walnut, { rough: 0.6 }), [
      B(0.05, legH, 0.05, -W / 2 + 0.07, 0, -D / 2 + 0.07), B(0.05, legH, 0.05, W / 2 - 0.07, 0, -D / 2 + 0.07),
      B(0.05, legH, 0.05, -W / 2 + 0.07, 0, -D / 2 + md - 0.07), B(0.05, legH, 0.05, W / 2 - cw + 0.07, 0, -D / 2 + md - 0.07),
      B(0.05, legH, 0.05, W / 2 - 0.07, 0, D / 2 - 0.07), B(0.05, legH, 0.05, W / 2 - cw + 0.07, 0, D / 2 - 0.07),
    ]);
    add(mat('#6f7c86'), [
      B(W, baseTop - legH, md, 0, legH, mainZ),
      B(cw, baseTop - legH, chaiseD, W / 2 - cw / 2, legH, -D / 2 + md + chaiseD / 2),
      B(W, H - 0.02 - baseTop, backT, 0, baseTop, -D / 2 + backT / 2),
      B(arm, 0.62 - baseTop, md, -(W / 2 - arm / 2), baseTop, mainZ),
    ]);
    const slot = (W - arm - cw) / 2;
    const cush = [];
    for (let i = 0; i < 2; i++) cush.push(B(slot - 0.012, seatH, md - backT, -W / 2 + arm + (i + 0.5) * slot, baseTop, -D / 2 + backT + (md - backT) / 2));
    cush.push(B(cw - 0.012, seatH, D - backT, W / 2 - cw / 2, baseTop, -D / 2 + backT + (D - backT) / 2));
    const bs = (W - arm) / 3;
    for (let i = 0; i < 3; i++) cush.push(B(bs - 0.012, H - baseTop - seatH, 0.14, -W / 2 + arm + (i + 0.5) * bs, baseTop + seatH, -D / 2 + backT + 0.07));
    add(mat('#7e8b95'), cush);
  });
}

// ----- Coffee table, TV unit, rug, plant. -----
function drawCoffee(ctx, w, d) {
  box(ctx, -w / 2, -d / 2, w, d, { r: 30 });
  thin(ctx, () => box(ctx, -w / 2 + 45, -d / 2 + 45, w - 90, d - 90, { r: 15, fill: false }));
  tint(ctx, 0.05, () => box(ctx, -w / 2 + 45, -d / 2 + 45, w - 90, d - 90, { r: 15, stroke: false }));
}

function coffee3d(THREE, size) {
  return model(THREE, 'coffee_table', size, ({ W, D, H, mat, add }) => {
    const t = 0.035;
    const lx = W / 2 - 0.06;
    const lz = D / 2 - 0.06;
    add(mat('#b08a5a', { rough: 0.5 }), [B(W, t, D, 0, H - t, 0), B(W - 0.16, 0.025, D - 0.16, 0, 0.1, 0)]);
    add(mat(COL.walnut, { rough: 0.6 }), [-1, 1].flatMap((sx) => [-1, 1].map((sz) => B(0.045, H - t, 0.045, sx * lx, 0, sz * lz))));
  });
}

function drawTvUnit(ctx, w, d) {
  const hw = w / 2;
  const hd = d / 2;
  box(ctx, -hw, -hd, w, d, { r: 10 });
  const n = across(w / 1000, 0.6, 2);
  thin(ctx, () => {
    for (let i = 1; i < n; i++) line(ctx, -hw + (i * w) / n, hd - 60, -hw + (i * w) / n, hd);
  });
  const tv = Math.min(w * 0.56, 1050);
  box(ctx, -tv / 2, -hd + 70, tv, 50, { r: 6 });
  thin(ctx, () => line(ctx, -120, -hd + 130, 120, -hd + 130));
}

function tvUnit3d(THREE, size) {
  return model(THREE, 'tv_unit', size, (m) => {
    const { W, D, H, mat, add } = m;
    const cab = 0.45;
    addCabinet({ ...m, H: cab }, { legH: 0.08, topT: 0.03, kick: 0.02, n: across(W, 0.6, 2), handle: null, carcass: '#8a6a4a', front: '#a07f58', top: '#a07f58', leg: '#3a3d40' });
    const tvH = Math.max(0.3, H - cab - 0.08);
    const tvW = Math.min(tvH * (16 / 9), W * 0.8);
    add(mat('#202225', { rough: 0.3, metal: 0.5 }), [B(0.4, 0.015, 0.2, 0, cab, 0), B(0.1, 0.065, 0.03, 0, cab + 0.015, -0.02), B(tvW, tvH, 0.04, 0, cab + 0.08, -0.02)]);
    add(mat('#0e1012', { rough: 0.15, metal: 0.2 }), [B(tvW - 0.03, tvH - 0.03, 0.005, 0, cab + 0.095, 0.0005)]);
  });
}

function drawRug(ctx, w, d) {
  const hw = w / 2;
  const hd = d / 2;
  box(ctx, -hw, -hd, w, d);
  tint(ctx, 0.07, () => box(ctx, -hw, -hd, w, d, { stroke: false }));
  thin(ctx, () => box(ctx, -hw + 90, -hd + 90, w - 180, d - 180, { fill: false }));
  thin(ctx, () => dashed(ctx, 40, 40, () => box(ctx, -hw + 180, -hd + 180, w - 360, d - 360, { fill: false })));
  thin(ctx, () => {
    for (let y = -hd + 60; y < hd - 40; y += 80) {
      line(ctx, -hw - 25, y, -hw, y);
      line(ctx, hw, y, hw + 25, y);
    }
  });
}

function drawPlant(ctx, w, d) {
  const R = Math.min(w, d) / 2;
  circle(ctx, 0, 0, R);
  const r0 = R * 0.2;
  const rm = R * 0.62;
  for (let i = 0; i < 8; i++) {
    const a = (i * TAU) / 8;
    const cos = Math.cos;
    const sin = Math.sin;
    ctx.beginPath();
    ctx.moveTo(cos(a) * r0, sin(a) * r0);
    ctx.quadraticCurveTo(cos(a - 0.4) * rm, sin(a - 0.4) * rm, cos(a) * R * 0.97, sin(a) * R * 0.97);
    ctx.quadraticCurveTo(cos(a + 0.4) * rm, sin(a + 0.4) * rm, cos(a) * r0, sin(a) * r0);
    ctx.stroke();
  }
  circle(ctx, 0, 0, R * 0.16, { fill: true });
}

function plant3d(THREE, size) {
  return model(THREE, 'plant', size, ({ W, D, H, mat, add }) => {
    const R = Math.min(W, D) / 2;
    const potH = Math.min(0.32, H * 0.27);
    add(mat(COL.terracotta, { rough: 0.85 }), [Y(R * 0.62, potH, 0, 0, 0, { rb: R * 0.45 })]);
    add(mat('#4a3a2c'), [Y(R * 0.57, 0.01, 0, potH, 0)]);
    add(mat('#6b5a45'), [Y(R * 0.06, H * 0.5, 0, potH, 0, { rb: R * 0.08, seg: 6 })]);
    const f1 = R;
    const f2 = Math.min(R * 0.8, (H - (potH + H * 0.34)) / 2);
    add(mat(COL.leaf, { rough: 0.9 }), [S(f1, 0, potH + H * 0.2 + f1 * 0.9, 0, { sy: 0.9 })]);
    add(mat(COL.leafDark, { rough: 0.9 }), [S(f2, R * 0.05, H - f2, 0)]);
  });
}

// ----- Dining sets (table with chairs). Overall size includes the chairs. -----
const CHAIR_W = 0.42;
const CHAIR_D = 0.42;
const TUCK = 0.07;
const PROTRUDE = CHAIR_D - TUCK; // chair depth beyond the table edge: 0.35 m

function moveParts(parts, dx, dz, ang) {
  const c = Math.cos(ang);
  const s = Math.sin(ang);
  return parts.map((p) => ({ ...p, p: [p.p[0] * c + p.p[2] * s + dx, p.p[1], -p.p[0] * s + p.p[2] * c + dz], r: [p.r[0], p.r[1] + ang, p.r[2]] }));
}

function chairLocal(H) {
  const seatTop = H * 0.54;
  const lx = CHAIR_W / 2 - 0.02;
  const lz = CHAIR_D / 2 - 0.02;
  const frame = [-1, 1].flatMap((sx) => [-1, 1].map((sz) => B(0.03, seatTop - 0.04, 0.03, sx * lx, 0, sz * lz)));
  frame.push(B(CHAIR_W, H - seatTop, 0.03, 0, seatTop, -CHAIR_D / 2 + 0.015));
  return { frame, seat: [B(CHAIR_W, 0.04, CHAIR_D, 0, seatTop - 0.04, 0)] };
}

function diningLayout(w, d, sides, ends) {
  const e = ends ? 2 * PROTRUDE * 1000 : 0;
  const tw = Math.max(500, w - e);
  const td = Math.max(400, d - 2 * PROTRUDE * 1000);
  return { tw, td, sides, ends };
}

function drawDining(ctx, w, d, sides, ends) {
  const { tw, td } = diningLayout(w, d, sides, ends);
  const pm = PROTRUDE * 1000;
  const cw = CHAIR_W * 1000;
  box(ctx, -tw / 2, -td / 2, tw, td, { r: 30 });
  thin(ctx, () => box(ctx, -tw / 2 + 50, -td / 2 + 50, tw - 100, td - 100, { r: 15, fill: false }));
  for (let i = 0; i < sides; i++) {
    const cx = (i + 0.5) * (tw / sides) - tw / 2;
    box(ctx, cx - cw / 2, td / 2, cw, pm, { r: 50 });
    box(ctx, cx - cw / 2, -td / 2 - pm, cw, pm, { r: 50 });
    thin(ctx, () => {
      line(ctx, cx - cw / 2 + 40, td / 2 + pm - 38, cx + cw / 2 - 40, td / 2 + pm - 38);
      line(ctx, cx - cw / 2 + 40, -td / 2 - pm + 38, cx + cw / 2 - 40, -td / 2 - pm + 38);
    });
  }
  if (ends) {
    for (const sx of [-1, 1]) {
      box(ctx, sx > 0 ? tw / 2 : -tw / 2 - pm, -cw / 2, pm, cw, { r: 50 });
      thin(ctx, () => line(ctx, sx * (tw / 2 + pm - 38), -cw / 2 + 40, sx * (tw / 2 + pm - 38), cw / 2 - 40));
    }
  }
}

function dining3d(THREE, id, size, sides, ends) {
  return model(THREE, id, size, ({ W, D, H, mat, add }) => {
    const { tw, td } = diningLayout(W * 1000, D * 1000, sides, ends);
    const TW = tw / 1000;
    const TD = td / 1000;
    const ht = H * 0.833;
    const topT = 0.035;
    const lx = TW / 2 - 0.1;
    const lz = TD / 2 - 0.1;
    add(mat('#a67c52', { rough: 0.55 }), [
      B(TW, topT, TD, 0, ht - topT, 0),
      ...[-1, 1].flatMap((sx) => [-1, 1].map((sz) => B(0.06, ht - topT, 0.06, sx * lx, 0, sz * lz))),
    ]);
    const chair = chairLocal(H);
    const frame = [];
    const seat = [];
    const put = (cx, cz, ang) => {
      frame.push(...moveParts(chair.frame, cx, cz, ang));
      seat.push(...moveParts(chair.seat, cx, cz, ang));
    };
    const off = TD / 2 + CHAIR_D / 2 - TUCK;
    for (let i = 0; i < sides; i++) {
      const cx = (i + 0.5) * (TW / sides) - TW / 2;
      put(cx, off, Math.PI);
      put(cx, -off, 0);
    }
    if (ends) {
      const ox = TW / 2 + CHAIR_D / 2 - TUCK;
      put(ox, 0, -Math.PI / 2);
      put(-ox, 0, Math.PI / 2);
    }
    add(mat('#4a3a2f', { rough: 0.6 }), frame);
    add(mat('#cfc8bb', { rough: 0.9 }), seat);
  });
}

const dining = (id, name, w, d, sides, ends) => item(id, name, DIN, w, d, 900, (ctx, W, D) => drawDining(ctx, W, D, sides, ends), (THREE, size) => dining3d(THREE, id, size, sides, ends));

export const LIVING = [
  item('sofa_2', '2 seater sofa', LIV, 1700, 900, 800, (ctx, w, d) => drawSofa(ctx, w, d, 2), (THREE, size) => sofa3d(THREE, 'sofa_2', size, { seats: 2, fabric: '#7d8a94', cushion: '#8e9aa3' })),
  item('sofa_3', '3 seater sofa', LIV, 2200, 950, 800, (ctx, w, d) => drawSofa(ctx, w, d, 3), (THREE, size) => sofa3d(THREE, 'sofa_3', size, { seats: 3, fabric: '#8f8a82', cushion: '#a19b92' })),
  item('sofa_l', 'L shaped sofa', LIV, 2700, 1700, 800, drawSofaL, sofaL3d),
  item('armchair', 'Armchair', LIV, 850, 850, 800, (ctx, w, d) => drawSofa(ctx, w, d, 1, 110, 200), (THREE, size) => sofa3d(THREE, 'armchair', size, { seats: 1, fabric: '#9a7f66', cushion: '#ab917a', arm: 0.14 })),
  item('coffee_table', 'Coffee table', LIV, 1100, 600, 400, drawCoffee, coffee3d),
  item('tv_unit', 'TV unit', LIV, 1800, 450, 1100, drawTvUnit, tvUnit3d),
  item('rug', 'Rug', LIV, 2400, 1600, 20, drawRug, (THREE, size) => model(THREE, 'rug', size, ({ W, D, H, mat, add }) => {
    add(mat('#b9b2a4', { rough: 1 }), [B(W, H * 0.7, D, 0, 0, 0)]);
    add(mat('#9aa6a0', { rough: 1 }), [B(W - 0.24, H * 0.3, D - 0.24, 0, H * 0.7, 0)]);
  }), { flat: true }),
  item('plant', 'Indoor plant', LIV, 500, 500, 1200, drawPlant, plant3d),
];

export const DINING = [
  dining('dining_4', 'Dining table, 4 chairs', 1200, 1500, 2, false),
  dining('dining_6', 'Dining table, 6 chairs', 2500, 1600, 2, true),
  dining('dining_8', 'Dining table, 8 chairs', 3100, 1700, 3, true),
];
