// Bathroom and laundry fixtures.

import { B, Y, COL, across, box, line, circle, ellipse, thin, tint, item, model, addCabinet } from './kit.js';

const BATH = 'Bathroom';
const LAUN = 'Laundry';
const CERAMIC = { rough: 0.2 };
const CHROME = { rough: 0.25, metal: 0.9 };

// ----- Toilet. Cistern against -y, bowl towards +y. -----
function drawToilet(ctx, w, d) {
  const hw = w / 2;
  const hd = d / 2;
  const cis = Math.min(190, d * 0.27);
  box(ctx, -w * 0.46, -hd, w * 0.92, cis, { r: 25 });
  circle(ctx, 0, -hd + cis / 2, Math.min(22, w * 0.06));
  const ry = (d - cis) / 2;
  const cy = -hd + cis + ry - 12;
  ellipse(ctx, 0, cy, hw * 0.98, ry + 12);
  thin(ctx, () => ellipse(ctx, 0, cy + 10, hw * 0.7, ry * 0.8, { fill: false }));
}

function toilet3d(THREE, size) {
  return model(THREE, 'toilet', size, ({ W, D, H, mat, add }) => {
    const ceramic = mat(COL.ceramic, CERAMIC);
    const bl = D - 0.2;
    const zc = -D / 2 + 0.2 + bl / 2;
    add(ceramic, [
      B(W * 0.92, H - 0.405, 0.2, 0, 0.4, -D / 2 + 0.1),
      Y(0.5, 0.2, 0, 0.2, zc, { rb: 0.4, sx: W, sz: bl, seg: 24 }),
      Y(0.11, 0.2, 0, 0, -D / 2 + 0.3, { seg: 12 }),
    ]);
    add(mat('#fafaf8', CERAMIC), [Y(0.5, 0.025, 0, 0.4, zc, { sx: W, sz: bl, seg: 24 })]);
    add(mat('#dbe7ee', { rough: 0.1 }), [Y(0.5, 0.002, 0, 0.425, zc + 0.02, { sx: W * 0.62, sz: bl * 0.68, seg: 24 })]);
    add(mat(COL.chrome, CHROME), [Y(0.03, 0.005, 0, H - 0.005, -D / 2 + 0.1, { seg: 12 })]);
  });
}

// ----- Vanities. Back against -y. -----
function drawVanity(ctx, w, d, basins) {
  const hw = w / 2;
  const hd = d / 2;
  box(ctx, -hw, -hd, w, d, { r: 10 });
  const slot = w / basins;
  for (let i = 0; i < basins; i++) {
    const cx = -hw + (i + 0.5) * slot;
    const bw = Math.min(450, slot - 120);
    const bd = d * 0.62;
    box(ctx, cx - bw / 2, -hd + d * 0.26, bw, bd, { r: Math.min(bw, bd) * 0.4 });
    thin(ctx, () => {
      circle(ctx, cx, -hd + d * 0.26 + bd / 2, 18);
      circle(ctx, cx, -hd + 52, 16);
      line(ctx, cx, -hd + 52, cx, -hd + d * 0.26 + 40);
    });
  }
}

function vanity3d(THREE, id, size, basins) {
  return model(THREE, id, size, (m) => {
    const { W, D, H, mat, add } = m;
    const Hc = Math.max(0.5, H - 0.1);
    addCabinet({ ...m, H: Hc }, { plinth: 0.09, topT: 0.03, n: basins, rows: 2, handle: 'h', carcass: '#cfcbc2', front: '#e9e5dc', top: '#f2f1ee' });
    const slot = W / basins;
    const bw = Math.min(0.5, slot - 0.14);
    const ceramic = [];
    const chrome = [];
    for (let i = 0; i < basins; i++) {
      const cx = -W / 2 + (i + 0.5) * slot;
      ceramic.push(B(bw, 0.004, D * 0.62, cx, Hc, D * 0.1));
      chrome.push(Y(0.012, 0.088, cx, Hc, -D / 2 + 0.06, { seg: 10 }), B(0.012, 0.012, 0.12, cx, Hc + 0.088, -D / 2 + 0.11));
    }
    add(mat(COL.ceramic, CERAMIC), ceramic);
    add(mat(COL.chrome, CHROME), chrome);
  });
}

// ----- Showers. Walls assumed on the back (-y) and left (-x); glass on the front and right. -----
function drawShower(ctx, w, d) {
  const hw = w / 2;
  const hd = d / 2;
  box(ctx, -hw, -hd, w, d);
  thin(ctx, () => box(ctx, -hw + 45, -hd + 45, w - 90, d - 90, { fill: false }));
  circle(ctx, 0, 0, 38);
  thin(ctx, () => {
    line(ctx, -22, 0, 22, 0);
    line(ctx, 0, -22, 0, 22);
  });
  circle(ctx, -hw + 110, -hd + 110, 55);
  thin(ctx, () => circle(ctx, -hw + 110, -hd + 110, 25));
  ctx.save();
  ctx.lineWidth = (ctx.lineWidth || 1) * 1.8;
  line(ctx, -hw, hd, hw, hd);
  line(ctx, hw, -hd, hw, hd);
  ctx.restore();
}

function shower3d(THREE, id, size) {
  return model(THREE, id, size, ({ W, D, H, mat, add }) => {
    const t = 0.06;
    add(mat('#f0f0ee', CERAMIC), [B(W, t, D, 0, 0, 0)]);
    add(mat(COL.glass, { rough: 0.05, opacity: 0.22 }), [B(W - 0.02, H - t, 0.008, -0.01, t, D / 2 - 0.014), B(0.008, H - t, D - 0.02, W / 2 - 0.014, t, -0.01)]);
    add(mat(COL.chrome, CHROME), [
      B(W, 0.025, 0.02, 0, H - 0.025, D / 2 - 0.01), B(0.02, 0.025, D, W / 2 - 0.01, H - 0.025, 0),
      B(0.02, H - t - 0.025, 0.02, W / 2 - 0.01, t, D / 2 - 0.01),
      Y(0.04, 0.004, 0, t, 0, { seg: 12 }),
      Y(0.012, 1.7, -W / 2 + 0.1, 0.2, -D / 2 + 0.04, { seg: 8 }),
      B(0.015, 0.015, 0.15, -W / 2 + 0.1, 1.905, -D / 2 + 0.115),
      Y(0.1, 0.015, -W / 2 + 0.1, 1.9 - 0.0, -D / 2 + 0.2, { seg: 14 }),
    ]);
  });
}

// ----- Baths. Taps at the -x end. -----
function drawBath(ctx, w, d) {
  const hw = w / 2;
  const hd = d / 2;
  box(ctx, -hw, -hd, w, d, { r: 40 });
  thin(ctx, () => box(ctx, -hw + 65, -hd + 65, w - 130, d - 130, { r: Math.min(220, d * 0.3), fill: false }));
  tint(ctx, 0.05, () => box(ctx, -hw + 65, -hd + 65, w - 130, d - 130, { r: Math.min(220, d * 0.3), stroke: false }));
  circle(ctx, -hw + 175, 0, 26);
  for (const k of [-1, 1]) circle(ctx, -hw + 32, k * 70, 14);
}

function bath3d(THREE, size) {
  return model(THREE, 'bath', size, ({ W, D, H, mat, add }) => {
    const Hb = H - 0.05;
    const wall = 0.07;
    add(mat(COL.ceramic, CERAMIC), [
      B(W, 0.1, D, 0, 0, 0),
      B(W, Hb - 0.1, wall, 0, 0.1, D / 2 - wall / 2), B(W, Hb - 0.1, wall, 0, 0.1, -D / 2 + wall / 2),
      B(wall, Hb - 0.1, D - 2 * wall, W / 2 - wall / 2, 0.1, 0), B(wall, Hb - 0.1, D - 2 * wall, -W / 2 + wall / 2, 0.1, 0),
    ]);
    add(mat('#e4edf1', CERAMIC), [B(W - 2 * wall, 0.003, D - 2 * wall, 0, 0.1, 0)]);
    add(mat(COL.chrome, CHROME), [Y(0.014, 0.05, -W / 2 + 0.035, Hb, 0, { seg: 10 }), B(0.1, 0.012, 0.012, -W / 2 + 0.085, Hb + 0.038, 0)]);
  });
}

function drawFreestanding(ctx, w, d) {
  const hw = w / 2;
  const hd = d / 2;
  const x0 = -hw + 140;
  box(ctx, x0, -hd, w - 140, d, { r: d / 2 });
  thin(ctx, () => box(ctx, x0 + 60, -hd + 60, w - 140 - 120, d - 120, { r: (d - 120) / 2, fill: false }));
  tint(ctx, 0.05, () => box(ctx, x0 + 60, -hd + 60, w - 140 - 120, d - 120, { r: (d - 120) / 2, stroke: false }));
  circle(ctx, x0 + 190, 0, 24);
  circle(ctx, -hw + 45, 0, 20);
  thin(ctx, () => line(ctx, -hw + 45, 0, x0 + 20, 0));
}

function freestanding3d(THREE, size) {
  return model(THREE, 'bath_freestanding', size, ({ W, D, H, mat, add }) => {
    const L = W - 0.14;
    const cx = 0.07;
    add(mat(COL.ceramic, { rough: 0.2, double: true }), [Y(0.5, 0.55, cx, 0.05, 0, { rb: 0.4, sx: L, sz: D, open: true, seg: 32 })]);
    add(mat('#e4edf1', CERAMIC), [Y(0.5, 0.01, cx, 0.1, 0, { sx: L * 0.8, sz: D * 0.8, seg: 24 })]);
    add(mat('#6e7378', { rough: 0.4, metal: 0.6 }), [Y(0.38, 0.05, cx, 0, 0, { rb: 0.34, sx: L, sz: D, seg: 24 })]);
    add(mat(COL.chrome, CHROME), [Y(0.012, H - 0.012, -W / 2 + 0.045, 0, 0, { seg: 10 }), B(0.1, 0.012, 0.012, -W / 2 + 0.095, H - 0.012, 0)]);
  });
}

// ----- Laundry. -----
function drawTub(ctx, w, d) {
  const hw = w / 2;
  const hd = d / 2;
  box(ctx, -hw, -hd, w, d, { r: 8 });
  box(ctx, -hw + 55, -hd + 70, w - 110, d - 130, { r: 40 });
  thin(ctx, () => {
    circle(ctx, 0, 20, 28);
    circle(ctx, 0, -hd + 40, 16);
    line(ctx, 0, -hd + 40, 0, -hd + 80);
  });
}

function tub3d(THREE, size) {
  return model(THREE, 'laundry_tub', size, (m) => {
    const { W, D, H, mat, add } = m;
    const Hc = 0.85;
    const wallH = Math.max(0.1, H - Hc - 0.05);
    addCabinet({ ...m, H: Hc }, { plinth: 0.08, n: across(W, 0.5, 2), handle: 'v', carcass: '#d9d6cf', front: '#f0eee9' });
    const t = 0.02;
    add(mat(COL.steel, { rough: 0.35, metal: 0.8 }), [
      B(W, wallH, t, 0, Hc, D / 2 - t / 2), B(W, wallH, t, 0, Hc, -D / 2 + t / 2),
      B(t, wallH, D - 2 * t, W / 2 - t / 2, Hc, 0), B(t, wallH, D - 2 * t, -W / 2 + t / 2, Hc, 0),
      B(W - 2 * t, 0.004, D - 2 * t, 0, Hc, 0),
      Y(0.014, 0.05, 0, Hc + wallH, -D / 2 + 0.05, { seg: 10 }), B(0.012, 0.012, 0.15, 0, Hc + wallH + 0.038, -D / 2 + 0.12),
    ]);
  });
}

function drawWasher(ctx, w, d, dryer) {
  const hw = w / 2;
  const hd = d / 2;
  box(ctx, -hw, -hd, w, d, { r: 14 });
  const r = Math.min(w, d) * 0.34;
  const cy = -d * 0.04;
  circle(ctx, 0, cy, r);
  thin(ctx, () => circle(ctx, 0, cy, r * 0.68));
  if (dryer) {
    thin(ctx, () => {
      for (const k of [-0.28, 0, 0.28]) line(ctx, -r * 0.4, cy + r * k, r * 0.4, cy + r * k);
    });
  }
  thin(ctx, () => {
    line(ctx, -hw, hd - 80, hw, hd - 80);
    circle(ctx, w * 0.28, hd - 40, 14);
    box(ctx, -w * 0.3, hd - 58, w * 0.3, 36, { fill: false });
  });
}

function laundry3d(THREE, id, size, dryer) {
  return model(THREE, id, size, ({ W, D, H, mat, add }) => {
    const zf = D / 2 - 0.012;
    add(mat('#f1f0ec', { rough: 0.35 }), [B(W, H, D - 0.012, 0, 0, -0.006)]);
    const cy = H * 0.46;
    const rr = Math.min(W * 0.4, 0.23);
    add(mat(dryer ? '#d8dadc' : '#9ea3a7', { rough: 0.3, metal: 0.8 }), [Y(rr, 0.012, 0, cy - 0.006, zf + 0.002, { rx: Math.PI / 2, seg: 24 })]);
    add(mat(dryer ? '#7d8e99' : '#1d2a33', { rough: 0.05, metal: 0.3 }), [Y(rr * 0.78, 0.012, 0, cy - 0.006, zf + 0.006, { rx: Math.PI / 2, seg: 24 })]);
    add(mat('#202326', { rough: 0.3 }), [B(W - 0.12, 0.055, 0.004, -0.02, H - 0.09, zf + 0.002), Y(0.025, 0.012, W / 2 - 0.08, H - 0.0925, zf + 0.002, { rx: Math.PI / 2, seg: 14 })]);
  });
}

export const BATHROOM = [
  item('toilet', 'Toilet', BATH, 400, 700, 800, drawToilet, toilet3d),
  item('vanity_single', 'Vanity, single basin', BATH, 750, 470, 950, (ctx, w, d) => drawVanity(ctx, w, d, 1), (THREE, size) => vanity3d(THREE, 'vanity_single', size, 1)),
  item('vanity_double', 'Vanity, double basin', BATH, 1500, 470, 950, (ctx, w, d) => drawVanity(ctx, w, d, 2), (THREE, size) => vanity3d(THREE, 'vanity_double', size, 2)),
  item('shower_900', 'Shower 900', BATH, 900, 900, 2000, drawShower, (THREE, size) => shower3d(THREE, 'shower_900', size)),
  item('shower_1200', 'Shower 1200', BATH, 1200, 900, 2000, drawShower, (THREE, size) => shower3d(THREE, 'shower_1200', size)),
  item('bath', 'Bath', BATH, 1700, 800, 600, drawBath, bath3d),
  item('bath_freestanding', 'Freestanding bath', BATH, 1700, 800, 700, drawFreestanding, freestanding3d),
];

export const LAUNDRY = [
  item('laundry_tub', 'Laundry tub', LAUN, 1000, 550, 1050, drawTub, tub3d),
  item('washer', 'Washing machine', LAUN, 600, 650, 850, (ctx, w, d) => drawWasher(ctx, w, d, false), (THREE, size) => laundry3d(THREE, 'washer', size, false)),
  item('dryer', 'Clothes dryer', LAUN, 600, 650, 850, (ctx, w, d) => drawWasher(ctx, w, d, true), (THREE, size) => laundry3d(THREE, 'dryer', size, true)),
];
