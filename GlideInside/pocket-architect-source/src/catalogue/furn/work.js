// Study, outdoor and garage items: desk, office chair, bookshelf, outdoor table, BBQ, sun lounge,
// cars, workbench and shelving.

import { B, Y, P, COL, box, line, circle, poly, thin, tint, dashed, item, model, frontPanels } from './kit.js';

const STUDY = 'Study';
const OUT = 'Outdoor';
const GAR = 'Garage and shed';

// ----- Desk. Chair side is +y; monitor and keyboard drawn on the top. -----
function drawDesk(ctx, w, d) {
  const hw = w / 2;
  const hd = d / 2;
  box(ctx, -hw, -hd, w, d, { r: 6 });
  const pw = Math.min(450, w * 0.3);
  thin(ctx, () => {
    box(ctx, hw - pw, -hd, pw, d, { fill: false });
    for (const f of [0.34, 0.67]) line(ctx, hw - pw, -hd + d * f, hw, -hd + d * f);
    box(ctx, -w * 0.22 - 260, -hd + 70, 520, 38, { r: 8, fill: false });
    box(ctx, -w * 0.22 - 200, -hd + 270, 400, 120, { r: 12, fill: false });
  });
}

function desk3d(THREE, size) {
  return model(THREE, 'desk', size, ({ W, D, H, mat, add }) => {
    const t = 0.03;
    const pw = Math.min(0.45, W * 0.3);
    const px = W / 2 - pw / 2;
    add(mat('#b08a5a', { rough: 0.5 }), [
      B(W, t, D, 0, H - t, 0),
      B(0.04, H - t, D - 0.1, -W / 2 + 0.02, 0, -0.02),
      B(W - pw - 0.1, 0.32, 0.015, -(pw + 0.1) / 2 + 0.05, H - t - 0.32, -D / 2 + 0.06),
    ]);
    const zf = D / 2 - 0.04;
    add(mat('#e6e3dc', { rough: 0.6 }), [B(pw, H - t, zf - 0.021 + D / 2 - 0.02, px, 0, (zf - 0.021 - D / 2 + 0.02) / 2)]);
    const f = frontPanels({ W: pw, x0: px - pw / 2, y0: 0.02, y1: H - t - 0.005, zFront: zf, n: 1, rows: 3, handle: 'h' });
    add(mat('#f0eee9', { rough: 0.55 }), f.panels);
    add(mat('#3a3d40', { rough: 0.4, metal: 0.6 }), f.handles);
  });
}

// ----- Office chair. The occupant faces +y. -----
function drawOfficeChair(ctx, w, d) {
  const hw = w / 2;
  const hd = d / 2;
  box(ctx, -w * 0.4, -d * 0.36, w * 0.8, d * 0.74, { r: w * 0.22 });
  box(ctx, -w * 0.4, -hd, w * 0.8, d * 0.2, { r: 70 });
  thin(ctx, () => {
    box(ctx, -hw, -d * 0.12, w * 0.1, d * 0.4, { r: 20, fill: false });
    box(ctx, hw - w * 0.1, -d * 0.12, w * 0.1, d * 0.4, { r: 20, fill: false });
    circle(ctx, 0, d * 0.02, w * 0.07);
  });
}

function officeChair3d(THREE, size) {
  return model(THREE, 'office_chair', size, ({ W, D, H, mat, add }) => {
    const base = [Y(0.03, 0.4, 0, 0.07, 0, { seg: 10 })];
    const tips = [];
    for (let i = 0; i < 5; i++) {
      const phi = (i * Math.PI * 2) / 5;
      const ar = 0.14;
      base.push(B(0.28, 0.035, 0.05, Math.sin(phi) * ar, 0.04, Math.cos(phi) * ar, { ry: phi - Math.PI / 2 }));
      tips.push(B(0.04, 0.04, 0.04, Math.sin(phi) * 0.27, 0, Math.cos(phi) * 0.27));
    }
    const sx = W / 2 - 0.02;
    add(mat('#2b2d30', { rough: 0.5, metal: 0.5 }), [
      ...base, ...tips,
      B(0.04, 0.03, 0.28, -sx, 0.68, -0.04), B(0.04, 0.03, 0.28, sx, 0.68, -0.04),
      B(0.03, 0.17, 0.03, -sx, 0.51, -0.06), B(0.03, 0.17, 0.03, sx, 0.51, -0.06),
    ]);
    add(mat('#2f3a44', { rough: 0.95 }), [B(0.5, 0.08, D - 0.02, 0, 0.45, 0.01), B(0.46, H - 0.52, 0.06, 0, 0.52, -D / 2 + 0.03)]);
  });
}

// ----- Bookshelf. Open front on +y. -----
function drawBookshelf(ctx, w, d) {
  const hw = w / 2;
  const hd = d / 2;
  box(ctx, -hw, -hd, w, d);
  thin(ctx, () => {
    box(ctx, -hw + 18, -hd + 24, w - 36, d - 42, { fill: false });
    for (let x = -hw + 60; x < hw - 50; x += 36) line(ctx, x, hd - 22, x, hd - 62);
  });
  ctx.save();
  ctx.lineWidth = (ctx.lineWidth || 1) * 1.8;
  line(ctx, -hw, -hd, hw, -hd);
  ctx.restore();
}

function bookshelf3d(THREE, size) {
  return model(THREE, 'bookshelf', size, ({ W, D, H, mat, add }) => {
    const t = 0.025;
    const rows = 5;
    const ys = [];
    for (let i = 0; i <= rows; i++) ys.push(i === rows ? H - t : 0.06 + (i * (H - t - 0.06)) / rows);
    add(mat('#a98862', { rough: 0.6 }), [
      B(t, H, D, -W / 2 + t / 2, 0, 0), B(t, H, D, W / 2 - t / 2, 0, 0), B(W - 2 * t, 0.06, D - 0.03, 0, 0, 0.0),
      ...ys.slice(1).map((y) => B(W - 2 * t, t, D, 0, y, 0)), B(W - 2 * t, H, 0.01, 0, 0, -D / 2 + 0.005),
    ]);
    const colours = ['#8b3a3a', '#2f4057', '#c4a24a', '#5b7a56', '#d9d2c3'];
    const groups = colours.map(() => []);
    let seed = 7;
    const rnd = () => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };
    for (let r = 0; r < rows; r++) {
      const y0 = ys[r] + (r === 0 ? 0.0 : t);
      const room = ys[r + 1] - y0;
      let x = -W / 2 + t + 0.02;
      const xEnd = W / 2 - t - 0.02 - (r % 2 ? 0.14 : 0.0);
      while (x < xEnd - 0.05) {
        const bw = 0.025 + rnd() * 0.025;
        const bh = room * (0.62 + rnd() * 0.3);
        groups[Math.floor(rnd() * colours.length)].push(B(bw, bh, D - 0.06, x + bw / 2, y0, 0.0));
        x += bw + 0.002;
      }
    }
    colours.forEach((c, i) => add(mat(c, { rough: 0.85 }), groups[i]));
  });
}

// ----- Outdoor setting: slatted table with two benches. -----
function drawOutdoorTable(ctx, w, d) {
  const hw = w / 2;
  const bench = 300;
  const gap = 50;
  const td = d - 2 * (bench + gap);
  box(ctx, -hw, -td / 2, w, td, { r: 10 });
  thin(ctx, () => {
    for (let i = 1; i < 6; i++) line(ctx, -hw, -td / 2 + (i * td) / 6, hw, -td / 2 + (i * td) / 6);
  });
  for (const s of [-1, 1]) {
    const y = s > 0 ? td / 2 + gap : -td / 2 - gap - bench;
    box(ctx, -hw, y, w, bench, { r: 10 });
    thin(ctx, () => line(ctx, -hw, y + bench / 2, hw, y + bench / 2));
  }
}

function outdoorTable3d(THREE, size) {
  return model(THREE, 'outdoor_table', size, ({ W, D, H, mat, add }) => {
    const bench = 0.3;
    const gap = 0.05;
    const td = Math.max(0.4, D - 2 * (bench + gap));
    const topT = 0.04;
    const planks = [];
    const n = 6;
    const pd = (td - (n - 1) * 0.01) / n;
    for (let i = 0; i < n; i++) planks.push(B(W, topT, pd, 0, H - topT, -td / 2 + pd / 2 + i * (pd + 0.01)));
    const seatZ = td / 2 + gap + bench / 2;
    const seats = [-1, 1].map((s) => B(W, 0.04, bench, 0, 0.42, s * seatZ));
    add(mat('#9c7a52', { rough: 0.75 }), [...planks, ...seats]);
    const lx = W / 2 - 0.2;
    const frame = [];
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) frame.push(B(0.07, H - topT, 0.07, sx * lx, 0, sz * (td / 2 - 0.1)), B(0.06, 0.42, 0.06, sx * lx, 0, sz * seatZ));
      frame.push(B(0.05, 0.05, D - 0.1, sx * lx, 0.3, 0));
    }
    add(mat('#6e5438', { rough: 0.8 }), frame);
  });
}

// ----- BBQ trolley. Hood at the back (-y), knobs on the front. -----
function drawBbq(ctx, w, d) {
  const hw = w / 2;
  const hd = d / 2;
  box(ctx, -hw, -hd, w, d, { r: 12 });
  thin(ctx, () => {
    dashed(ctx, 80, 40, () => box(ctx, -hw + 40, -hd + 30, w - 80, d * 0.62, { fill: false }));
    for (let i = 0; i < 4; i++) {
      const cx = -hw + w * (0.14 + i * 0.24);
      circle(ctx, cx, hd - 60, 20);
    }
    for (let x = -hw + 80; x < hw - 60; x += 70) line(ctx, x, -hd + 70, x, -hd + 70 + d * 0.4);
  });
}

function bbq3d(THREE, size) {
  return model(THREE, 'bbq', size, ({ W, D, H, mat, add }) => {
    add(mat('#a9afb4', { rough: 0.4, metal: 0.7 }), [B(W, 0.62, D, 0, 0.2, 0), B(W - 0.1, H - 0.9, D * 0.75, 0, 0.9, -D / 2 + D * 0.375)]);
    const f = frontPanels({ W, y0: 0.22, y1: 0.8, zFront: D / 2, n: 2, handle: 'h' });
    add(mat('#8d9398', { rough: 0.4, metal: 0.7 }), f.panels);
    add(mat('#2b2d30', { rough: 0.5, metal: 0.4 }), [
      B(W, 0.08, D - 0.06, 0, 0.82, 0.01),
      ...f.handles,
      B(W - 0.3, 0.02, 0.025, 0, 1.0, -D / 2 + D * 0.75 + 0.0125),
      ...[-1, 1].map((s) => B(0.04, 0.2, 0.04, s * (W / 2 - 0.05), 0, D / 2 - 0.06)),
      ...[-1, 1].map((s) => Y(0.07, 0.04, s * (W / 2 - 0.05), 0.05, -D / 2 + 0.1, { rz: Math.PI / 2, seg: 12 })),
    ]);
    const knobs = [0.14, 0.38, 0.62, 0.86].map((f2) => Y(0.018, 0.02, -W / 2 + W * f2, 0.832, D / 2 - 0.01, { rx: Math.PI / 2, seg: 10 }));
    add(mat('#16181a', { rough: 0.4 }), knobs);
  });
}

// ----- Sun lounge. Head end against -y. -----
function drawLounge(ctx, w, d) {
  const hw = w / 2;
  const hd = d / 2;
  box(ctx, -hw, -hd, w, d, { r: 50 });
  tint(ctx, 0.07, () => box(ctx, -hw, -hd, w, d * 0.36, { r: 50, stroke: false }));
  line(ctx, -hw, -hd + d * 0.36, hw, -hd + d * 0.36);
  thin(ctx, () => {
    box(ctx, -w * 0.32, -hd + 70, w * 0.64, 150, { r: 45, fill: false });
    box(ctx, -hw + 40, -hd + d * 0.36 + 40, w - 80, d * 0.64 - 80, { r: 30, fill: false });
  });
}

function lounge3d(THREE, size) {
  return model(THREE, 'sun_lounge', size, ({ W, D, mat, add }) => {
    const th = (40 * Math.PI) / 180;
    const Lb = 0.66;
    const run = Lb * Math.cos(th);
    const zh = -D / 2 + run;
    const flat = D / 2 - zh;
    add(mat('#3a3d40', { rough: 0.5, metal: 0.4 }), [
      ...[-1, 1].flatMap((sx) => [-1, 1].map((sz) => B(0.04, 0.28, 0.04, sx * (W / 2 - 0.04), 0, sz * (D / 2 - 0.04)))),
      ...[-1, 1].map((sx) => B(0.035, 0.05, D, sx * (W / 2 - 0.0175), 0.25, 0)),
      ...[-1, 1].map((sx) => B(0.03, 0.03, 0.5, sx * (W / 2 - 0.04), 0.2, zh - 0.05, { rx: th })),
    ]);
    add(mat('#d9d5c8', { rough: 0.95 }), [
      B(W - 0.08, 0.06, flat, 0, 0.3, zh + flat / 2),
      B(W - 0.08, 0.06, Lb, 0, 0.33 + (Lb * Math.sin(th)) / 2 - 0.03, -D / 2 + run / 2, { rx: th }),
    ]);
  });
}

// ----- Cars. The nose points to +y. -----
function drawCar(ctx, w, d, ute) {
  const hw = w / 2;
  const hd = d / 2;
  box(ctx, -hw, -hd, w, d, { r: w * 0.3 });
  const roofBack = ute ? d * 0.0 : -d * 0.2;
  const roofFront = ute ? d * 0.2 : d * 0.12;
  box(ctx, -w * 0.36, roofBack, w * 0.72, roofFront - roofBack, { r: 50, fill: false });
  const glass = (pts) => tint(ctx, 0.16, () => poly(ctx, pts));
  const front = [[-w * 0.36, roofFront], [w * 0.36, roofFront], [w * 0.4, roofFront + d * 0.13], [-w * 0.4, roofFront + d * 0.13]];
  const rear = [[-w * 0.36, roofBack], [w * 0.36, roofBack], [w * 0.4, roofBack - d * (ute ? 0.03 : 0.09)], [-w * 0.4, roofBack - d * (ute ? 0.03 : 0.09)]];
  glass(front);
  glass(rear);
  thin(ctx, () => {
    poly(ctx, front, { fill: false });
    poly(ctx, rear, { fill: false });
    for (const s of [-1, 1]) {
      box(ctx, s * (hw - 140) - 110, hd - 75, 220, 38, { r: 14, fill: false });
      box(ctx, s * (hw - 140) - 90, -hd + 40, 180, 34, { r: 14, fill: false });
    }
    if (ute) {
      box(ctx, -w * 0.4, -hd + 70, w * 0.8, roofBack - (-hd + 70) - d * 0.05, { r: 20, fill: false });
      for (let i = 1; i < 5; i++) {
        const y = -hd + 70 + (i * (roofBack - (-hd + 70) - d * 0.05)) / 5;
        line(ctx, -w * 0.4, y, w * 0.4, y);
      }
    }
  });
}

// Wheel arch along the underside of a side profile, nose to tail (z decreasing): a half circle on y0.
function arch(zc, r, y0) {
  return [0, 30, 60, 90, 120, 150, 180].map((a) => [zc + r * Math.cos((a * Math.PI) / 180), y0 + r * Math.sin((a * Math.PI) / 180)]);
}

// Side profiles in metres for a 4.8 x 1.85 x 1.45 sedan and a 5.3 x 1.9 x 1.8 ute. Nose at +z.
// top: outline from the tail bottom over the body to the nose bottom. cabin: glass house. roof: [z0, z1, y0, y1].
const CARS = {
  sedan: {
    D: 4.8, H: 1.45, wheelR: 0.32, wheelZ: 1.45, base: 0.28,
    top: [[-2.4, 0.28], [-2.4, 0.72], [-2.26, 0.95], [1.2, 0.97], [2.3, 0.86], [2.4, 0.7], [2.4, 0.28]],
    cabin: [[-1.38, 0.95], [-0.72, 1.4], [0.55, 1.4], [1.18, 0.96]],
    roof: [-0.74, 0.57, 1.4, 1.45],
  },
  ute: {
    D: 5.3, H: 1.8, wheelR: 0.38, wheelZ: 1.65, base: 0.34,
    top: [[-2.65, 0.34], [-2.65, 1.0], [-0.95, 1.0], [-0.95, 1.12], [1.25, 1.14], [2.5, 1.02], [2.65, 0.86], [2.65, 0.34]],
    cabin: [[-0.95, 1.12], [-0.8, 1.74], [0.5, 1.75], [1.2, 1.14]],
    roof: [-0.84, 0.55, 1.75, 1.8],
  },
};

function car3d(THREE, id, size, o) {
  return model(THREE, id, size, ({ W, D, H, mat, add }) => {
    const c = CARS[o.kind];
    const kz = D / c.D;
    const ky = H / c.H;
    const sc = (pts) => pts.map(([z, y]) => [z * kz, y * ky]);
    const wz = c.wheelZ * kz;
    const wr = c.wheelR;
    const ww = 0.23;
    const bodyPts = [...sc(c.top), ...arch(wz, wr + 0.06, c.base * ky).map(([z, y]) => [z, y]), ...arch(-wz, wr + 0.06, c.base * ky)];
    const paint = [P(bodyPts, W), B(W - 0.18, (c.roof[3] - c.roof[2]) * ky, (c.roof[1] - c.roof[0]) * kz, 0, c.roof[2] * ky, ((c.roof[0] + c.roof[1]) / 2) * kz)];
    if (o.kind === 'ute') {
      const wall = 0.3;
      paint.push(
        B(0.05, wall, 1.7 * kz, -(W / 2 - 0.025), 1.0 * ky, -1.8 * kz), B(0.05, wall, 1.7 * kz, W / 2 - 0.025, 1.0 * ky, -1.8 * kz),
        B(W - 0.04, wall, 0.05, 0, 1.0 * ky, -2.625 * kz), B(W - 0.1, wall, 0.05, 0, 1.0 * ky, -0.98 * kz),
      );
    }
    add(mat(o.paint, { rough: 0.3, metal: 0.55 }), paint);
    add(mat('#1c2830', { rough: 0.08, metal: 0.4 }), [P(sc(c.cabin), W - 0.2)]);
    add(mat('#2a2c2f', { rough: 0.6 }), [B(W - 0.08, 0.14, 0.1, 0, c.base * ky + 0.04, D / 2 - 0.05), B(W - 0.08, 0.14, 0.1, 0, c.base * ky + 0.04, -D / 2 + 0.05)]);
    const wheels = [];
    const hubs = [];
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        wheels.push(Y(wr, ww, sx * (W / 2 - 0.02 - ww / 2), wr - ww / 2, sz * wz, { rz: Math.PI / 2, seg: 24 }));
        hubs.push(Y(wr * 0.55, 0.02, sx * (W / 2 - 0.025), wr - 0.01, sz * wz, { rz: Math.PI / 2, seg: 14 }));
      }
    }
    add(mat('#18191b', { rough: 0.9 }), wheels);
    add(mat('#aeb3b8', { rough: 0.3, metal: 0.9 }), hubs);
    add(mat('#f6f2df', { rough: 0.2 }), [-1, 1].map((s) => B(0.3, 0.1, 0.03, s * (W / 2 - 0.3), c.base * ky + 0.4, D / 2 - 0.012)));
    add(mat('#a02020', { rough: 0.3 }), [-1, 1].map((s) => B(0.28, 0.08, 0.03, s * (W / 2 - 0.28), c.base * ky + 0.44, -D / 2 + 0.012)));
  });
}

// ----- Workbench. Front (+y) is where you stand. -----
function drawWorkbench(ctx, w, d) {
  const hw = w / 2;
  const hd = d / 2;
  box(ctx, -hw, -hd, w, d, { r: 4 });
  thin(ctx, () => {
    dashed(ctx, 70, 40, () => box(ctx, -hw + 50, -hd + 50, w - 850, d - 100, { fill: false }));
    box(ctx, hw - 700, -hd + 50, 600, d - 100, { fill: false });
    for (const f of [0.25, 0.5, 0.75]) line(ctx, hw - 700, -hd + 50 + (d - 100) * f, hw - 100, -hd + 50 + (d - 100) * f);
    box(ctx, -hw + 100, hd - 120, 170, 120, { r: 10 });
  });
}

function workbench3d(THREE, size) {
  return model(THREE, 'workbench', size, ({ W, D, H, mat, add }) => {
    const t = 0.05;
    add(mat('#b08a5a', { rough: 0.6 }), [B(W, t, D, 0, H - t, 0)]);
    const lx = W / 2 - 0.05;
    const lz = D / 2 - 0.05;
    add(mat('#4a4f55', { rough: 0.5, metal: 0.6 }), [
      ...[-1, 1].flatMap((sx) => [-1, 1].map((sz) => B(0.06, H - t, 0.06, sx * lx, 0, sz * lz))),
      B(W - 0.12, 0.05, 0.03, -0.0, H - t - 0.07, D / 2 - 0.05), B(W - 0.12, 0.05, 0.03, 0, H - t - 0.07, -D / 2 + 0.05),
    ]);
    add(mat('#c9ae7e', { rough: 0.8 }), [B(W - 0.85, 0.03, D - 0.1, -0.375, 0.18, 0)]);
    add(mat('#a33a2e', { rough: 0.5, metal: 0.3 }), [B(0.6, H - t - 0.2, D - 0.12, W / 2 - 0.4, 0.18, -0.01)]);
    const f = frontPanels({ W: 0.6, x0: W / 2 - 0.7, y0: 0.2, y1: H - t - 0.02, zFront: D / 2 - 0.05, n: 1, rows: 4, handle: 'h' });
    add(mat('#b64336', { rough: 0.5 }), f.panels);
    add(mat(COL.chrome, { rough: 0.3, metal: 0.9 }), f.handles);
  });
}

// ----- Steel shelving with boxes. -----
function drawShelving(ctx, w, d) {
  const hw = w / 2;
  const hd = d / 2;
  box(ctx, -hw, -hd, w, d);
  thin(ctx, () => {
    line(ctx, -hw, -hd, hw, hd);
    line(ctx, -hw, hd, hw, -hd);
    box(ctx, -hw + 30, -hd + 30, w - 60, d - 60, { fill: false });
  });
}

function shelving3d(THREE, size) {
  return model(THREE, 'shelving', size, ({ W, D, H, mat, add }) => {
    const ux = W / 2 - 0.025;
    const uz = D / 2 - 0.025;
    add(mat('#2f5e8a', { rough: 0.5, metal: 0.3 }), [-1, 1].flatMap((sx) => [-1, 1].map((sz) => B(0.05, H, 0.05, sx * ux, 0, sz * uz))));
    const levels = [0.15, 0.15 + (H - 0.3) / 3, 0.15 + (2 * (H - 0.3)) / 3, H - 0.3].map((y) => Math.round(y * 1000) / 1000);
    add(mat('#c9b48d', { rough: 0.85 }), levels.map((y) => B(W - 0.1, 0.03, D - 0.02, 0, y, 0)));
    const cards = [];
    const tubs = [];
    levels.forEach((y, i) => {
      const room = (levels[i + 1] ?? H) - y - 0.06;
      const bh = Math.min(0.34, room * 0.8);
      cards.push(B(W * 0.28, bh, D - 0.1, -W * 0.3, y + 0.03, 0));
      if (i % 2 === 0) cards.push(B(W * 0.16, bh * 0.8, D - 0.12, W * 0.02, y + 0.03, 0));
      tubs.push(B(W * 0.2, bh * 0.9, D - 0.1, W * 0.28, y + 0.03, 0));
    });
    add(mat('#b8956a', { rough: 0.9 }), cards);
    add(mat('#3b6aa0', { rough: 0.5 }), tubs);
  });
}

export const WORK = [
  item('desk', 'Desk', STUDY, 1500, 750, 750, drawDesk, desk3d),
  item('office_chair', 'Office chair', STUDY, 600, 600, 1000, drawOfficeChair, officeChair3d),
  item('bookshelf', 'Bookshelf', STUDY, 900, 300, 1800, drawBookshelf, bookshelf3d),
  item('outdoor_table', 'Outdoor table with benches', OUT, 1800, 1500, 780, drawOutdoorTable, outdoorTable3d),
  item('bbq', 'BBQ', OUT, 1300, 560, 1150, drawBbq, bbq3d),
  item('sun_lounge', 'Sun lounge', OUT, 650, 1950, 800, drawLounge, lounge3d),
  item('car_sedan', 'Sedan', GAR, 1850, 4800, 1450, (ctx, w, d) => drawCar(ctx, w, d, false), (THREE, size) => car3d(THREE, 'car_sedan', size, { kind: 'sedan', paint: '#6e7f91' })),
  item('car_ute', 'Ute', GAR, 1900, 5300, 1800, (ctx, w, d) => drawCar(ctx, w, d, true), (THREE, size) => car3d(THREE, 'car_ute', size, { kind: 'ute', paint: '#eceae5' })),
  item('workbench', 'Workbench', GAR, 2400, 700, 900, drawWorkbench, workbench3d),
  item('shelving', 'Steel shelving', GAR, 1800, 450, 1800, drawShelving, shelving3d),
];
