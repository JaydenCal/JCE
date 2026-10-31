// Wall bodies (piers, sills and lintels around openings, mitred corners) and opening fittings.
// Pure geometry, no DOM. Wall local frame: u along the wall from end a, v along the normal
// n = (-d.y, d.x) in plan, y up. Plan (x, y) in mm maps to world (x / 1000, y, y / 1000).

import * as G from '../model/geometry.js';
import { GeoBuilder } from './mesh-builder.js';

const TOL_JOIN = 3; // mm

export function wallFrame(w) {
  const d = G.wallDir(w);
  const n = { x: -d.y, y: d.x };
  const canon = d.x > 1e-6 || (Math.abs(d.x) <= 1e-6 && d.y > 0) ? d : { x: -d.x, y: -d.y };
  return {
    ax: w.a.x / 1000, az: w.a.y / 1000,
    dx: d.x, dz: d.y, nx: n.x, nz: n.y,
    dcx: canon.x, dcz: canon.y,
    t: (w.thickness || 100) / 1000,
    L: G.wallLength(w) / 1000,
  };
}

const P = (fr, u, v, y) => [fr.ax + fr.dx * u + fr.nx * v, y, fr.az + fr.dz * u + fr.nz * v];

// A prism with front (+v) and back (-v) faces, optional mitred ends and optional cap, top, bottom faces.
// spec: { u0f, u1f, u0b, u1b, y0, y1, vf, vb, front, back, cap0, cap1, top, bottom } (slot keys or null).
export function prism(b, fr, s) {
  const vf = s.vf ?? fr.t / 2;
  const vb = s.vb ?? -fr.t / 2;
  const u0b = s.u0b ?? s.u0f;
  const u1b = s.u1b ?? s.u1f;
  if (s.u1f - s.u0f < 1e-4 && u1b - u0b < 1e-4) return;
  if (s.y1 - s.y0 < 1e-4) return;
  const U = (p) => p[0] * fr.dcx + p[2] * fr.dcz;
  const F0 = (y) => P(fr, s.u0f, vf, y);
  const F1 = (y) => P(fr, s.u1f, vf, y);
  const B0 = (y) => P(fr, u0b, vb, y);
  const B1 = (y) => P(fr, u1b, vb, y);
  const n3 = [fr.nx, 0, fr.nz];
  const d3 = [fr.dx, 0, fr.dz];
  const { y0, y1 } = s;
  if (s.front) {
    const a = F0(y0);
    const c = F1(y0);
    b.quad(s.front, a, c, F1(y1), F0(y1), [[U(a), y0], [U(c), y0], [U(c), y1], [U(a), y1]], n3);
  }
  if (s.back) {
    const a = B0(y0);
    const c = B1(y0);
    b.quad(s.back, a, c, B1(y1), B0(y1), [[U(a), y0], [U(c), y0], [U(c), y1], [U(a), y1]], [-n3[0], 0, -n3[2]]);
  }
  if (s.cap0) {
    const len = Math.hypot(F0(0)[0] - B0(0)[0], F0(0)[2] - B0(0)[2]);
    b.quad(s.cap0, B0(y0), F0(y0), F0(y1), B0(y1), [[0, y0], [len, y0], [len, y1], [0, y1]], [-d3[0], 0, -d3[2]]);
  }
  if (s.cap1) {
    const len = Math.hypot(F1(0)[0] - B1(0)[0], F1(0)[2] - B1(0)[2]);
    b.quad(s.cap1, F1(y0), B1(y0), B1(y1), F1(y1), [[0, y0], [len, y0], [len, y1], [0, y1]], d3);
  }
  if (s.top) {
    const q = [F0(y1), F1(y1), B1(y1), B0(y1)];
    b.quad(s.top, q[0], q[1], q[2], q[3], q.map((p) => [p[0], p[2]]), [0, 1, 0]);
  }
  if (s.bottom) {
    const q = [F0(y0), F1(y0), B1(y0), B0(y0)];
    b.quad(s.bottom, q[0], q[1], q[2], q[3], q.map((p) => [p[0], p[2]]), [0, -1, 0]);
  }
}

// Simple box in the wall frame: u in [u0, u1], v in [v0, v1], y in [y0, y1], one slot for all faces
// (or an object of per-face slots as for prism).
export function boxLocal(b, fr, u0, u1, v0, v1, y0, y1, slots) {
  const all = typeof slots === 'string';
  prism(b, fr, {
    u0f: u0, u1f: u1, y0, y1, vf: v1, vb: v0,
    front: all ? slots : slots.front,
    back: all ? slots : slots.back,
    cap0: all ? slots : slots.cap0,
    cap1: all ? slots : slots.cap1,
    top: all ? slots : slots.top,
    bottom: all ? slots : slots.bottom,
  });
}

// Wall end joins ---------------------------------------------------------------------------
// Returns Map(wallId -> { a: { f, b }, b: { f, b } }): outward extension (mm) of the front (+n)
// and back (-n) corner at each end. Zero means a plain square end.
export function computeJoins(walls) {
  const joins = new Map();
  const slot = (w) => {
    let j = joins.get(w.id);
    if (!j) {
      j = { a: { f: 0, b: 0 }, b: { f: 0, b: 0 } };
      joins.set(w.id, j);
    }
    return j;
  };
  const ends = [];
  for (const w of walls) {
    if (G.wallLength(w) < 10) continue;
    const d = G.wallDir(w);
    ends.push({ w, end: 'a', P: w.a, e: d });
    ends.push({ w, end: 'b', P: w.b, e: { x: -d.x, y: -d.y } });
  }
  const used = new Set();
  for (let i = 0; i < ends.length; i++) {
    if (used.has(i)) continue;
    const cluster = [i];
    for (let k = i + 1; k < ends.length; k++) {
      if (!used.has(k) && ends[k].w.id !== ends[i].w.id && G.dist(ends[k].P, ends[i].P) <= TOL_JOIN) cluster.push(k);
    }
    if (cluster.length < 2) continue;
    cluster.forEach((k) => used.add(k));
    const P0 = ends[i].P;
    const group = cluster.map((k) => ends[k]);
    const ids = new Set(group.map((g) => g.w.id));
    // a wall passing through the junction means the others simply butt against it
    const through = walls.some((w) => {
      if (ids.has(w.id)) return false;
      const r = G.projectToSegment(P0, w.a, w.b);
      return r.d <= TOL_JOIN && r.along > TOL_JOIN && G.wallLength(w) - r.along > TOL_JOIN;
    });
    if (through) continue;
    let collinear = false;
    let parallel = false;
    for (let x = 0; x < group.length; x++) {
      for (let y = x + 1; y < group.length; y++) {
        const dp = G.dot(group[x].e, group[y].e);
        const cr = Math.abs(G.cross(group[x].e, group[y].e));
        if (dp < -0.995) collinear = true;
        if (cr < 0.17) parallel = true; // under about 10 degrees apart: leave square
      }
    }
    if (collinear || parallel) continue;
    group.sort((p, q) => Math.atan2(p.e.y, p.e.x) - Math.atan2(q.e.y, q.e.x));
    const n = group.length;
    const corners = new Array(n); // corner between group[k] and group[k + 1]
    let ok = true;
    for (let k = 0; k < n && ok; k++) {
      const gi = group[k];
      const gj = group[(k + 1) % n];
      const mi = { x: -gi.e.y, y: gi.e.x };
      const mj = { x: -gj.e.y, y: gj.e.x };
      const ti = (gi.w.thickness || 100) / 2;
      const tj = (gj.w.thickness || 100) / 2;
      const p1 = { x: P0.x + mi.x * ti, y: P0.y + mi.y * ti };
      const p2 = { x: P0.x - mj.x * tj, y: P0.y - mj.y * tj };
      const den = G.cross(gi.e, gj.e);
      if (Math.abs(den) < 1e-6) {
        ok = false;
        break;
      }
      const s = G.cross(G.sub(p2, p1), gj.e) / den;
      const q = { x: p1.x + gi.e.x * s, y: p1.y + gi.e.y * s };
      corners[k] = q;
      const maxT = Math.max(ti, tj) * 2;
      if (G.dist(q, P0) > maxT * 3) ok = false; // spike on very acute angles
    }
    if (!ok) continue;
    group.forEach((g, k) => {
      const plus = corners[k]; // on the +m side of this end
      const minus = corners[(k - 1 + n) % n]; // on the -m side
      const ext = (q) => -G.dot(G.sub(q, P0), g.e);
      const j = slot(g.w)[g.end];
      // end a: +m side is the front (+n); end b: +m side is the back
      if (g.end === 'a') {
        j.f = ext(plus);
        j.b = ext(minus);
      } else {
        j.b = ext(plus);
        j.f = ext(minus);
      }
    });
  }
  return joins;
}

// Wall body -----------------------------------------------------------------------------------
// opts: { baseY, H (m), outSide (-1, 0, 1), openings (visible), join }. Slots: out, in, edge.
export function buildWallBody(wall, opts) {
  const fr = wallFrame(wall);
  const b = new GeoBuilder();
  const { baseY, H } = opts;
  const topY = baseY + H;
  const join = opts.join || { a: { f: 0, b: 0 }, b: { f: 0, b: 0 } };
  const outSide = opts.outSide || 0;
  const frontSlot = outSide === 1 ? 'out' : 'in';
  const backSlot = outSide === -1 ? 'out' : 'in';
  const L = fr.L;
  const items = [...(opts.openings || [])]
    .map((o) => ({ o, s0: Math.max(0, (o.offset - o.width / 2) / 1000), s1: Math.min(L, (o.offset + o.width / 2) / 1000) }))
    .filter((x) => x.s1 - x.s0 > 0.001)
    .sort((p, q) => p.s0 - q.s0);
  const piers = [];
  let cursor = 0;
  for (const it of items) {
    if (it.s1 <= cursor + 0.001) continue;
    it.s0 = Math.max(it.s0, cursor);
    if (it.s0 > cursor + 0.001) piers.push([cursor, it.s0]);
    cursor = it.s1;
  }
  if (L > cursor + 0.001) piers.push([cursor, L]);
  for (const [p0, p1] of piers) {
    const first = p0 <= 0.0005;
    const last = p1 >= L - 0.0005;
    prism(b, fr, {
      u0f: first ? -join.a.f / 1000 : p0,
      u0b: first ? -join.a.b / 1000 : p0,
      u1f: last ? L + join.b.f / 1000 : p1,
      u1b: last ? L + join.b.b / 1000 : p1,
      y0: baseY, y1: topY,
      front: frontSlot, back: backSlot, cap0: 'edge', cap1: 'edge', top: 'edge',
    });
  }
  for (const it of items) {
    const sill = Math.max(0, it.o.sill / 1000);
    const head = Math.min(H, (it.o.sill + it.o.height) / 1000);
    if (sill > 0.003) {
      prism(b, fr, { u0f: it.s0, u1f: it.s1, y0: baseY, y1: baseY + Math.min(sill, H), front: frontSlot, back: backSlot, top: 'edge' });
    }
    if (head < H - 0.003) {
      prism(b, fr, { u0f: it.s0, u1f: it.s1, y0: baseY + head, y1: topY, front: frontSlot, back: backSlot, top: 'edge', bottom: 'edge' });
    }
  }
  return b;
}

// Opening fittings ----------------------------------------------------------------------------
// Slots: frame, glass, leaf, handle, panel, roller, groove. Returns a GeoBuilder or null.
export function buildOpeningFittings(wall, o, opts) {
  const fr = wallFrame(wall);
  const b = new GeoBuilder();
  // Parts that animate in the walk-through (door leaves, sliding sashes, rolling panels) go to their own
  // builder: b.moving, with b.motion describing how they move. World space positions throughout.
  const mv = new GeoBuilder();
  b.moving = mv;
  b.motion = null;
  const { baseY, H } = opts;
  const s0 = Math.max(0, (o.offset - o.width / 2) / 1000);
  const s1 = Math.min(fr.L, (o.offset + o.width / 2) / 1000);
  if (s1 - s0 < 0.1) return null;
  const yb = baseY + Math.max(0, o.sill / 1000);
  const yt = baseY + Math.min(H, (o.sill + o.height) / 1000);
  if (yt - yb < 0.1) return null;
  const uc = (s0 + s1) / 2;
  const W = s1 - s0;
  const HH = yt - yb;
  const bar = (u0, u1, y0, y1, v0, v1, slot = 'frame') => boxLocal(b, fr, u0, u1, v0, v1, y0, y1, slot);
  const mbar = (u0, u1, y0, y1, v0, v1, slot = 'frame') => boxLocal(mv, fr, u0, u1, v0, v1, y0, y1, slot);
  const ring = (u0, u1, y0, y1, w, v0, v1, slot = 'frame', bottomW = w) => {
    bar(u0, u0 + w, y0, y1, v0, v1, slot);
    bar(u1 - w, u1, y0, y1, v0, v1, slot);
    bar(u0 + w, u1 - w, y1 - w, y1, v0, v1, slot);
    bar(u0 + w, u1 - w, y0, y0 + bottomW, v0, v1, slot);
  };
  const mring = (u0, u1, y0, y1, w, v0, v1, slot = 'frame', bottomW = w) => {
    mbar(u0, u0 + w, y0, y1, v0, v1, slot);
    mbar(u1 - w, u1, y0, y1, v0, v1, slot);
    mbar(u0 + w, u1 - w, y1 - w, y1, v0, v1, slot);
    mbar(u0 + w, u1 - w, y0, y0 + bottomW, v0, v1, slot);
  };
  const pane = (u0, u1, y0, y1, v) => bar(u0, u1, y0, y1, v - 0.004, v + 0.004, 'glass');
  const kind = o.kind;

  if (kind === 'window') {
    const fw = 0.05;
    const fd = Math.min(0.09, fr.t * 0.8);
    ring(s0, s1, yb, yt, fw, -fd / 2, fd / 2);
    const iu0 = s0 + fw;
    const iu1 = s1 - fw;
    const iy0 = yb + fw;
    const iy1 = yt - fw;
    const style = o.style || 'sliding';
    const sw = 0.034;
    const sash = (u0, u1, y0, y1, v) => {
      ring(u0, u1, y0, y1, sw, v - 0.012, v + 0.012);
      pane(u0 + sw, u1 - sw, y0 + sw, y1 - sw, v);
    };
    if (style === 'fixed') {
      pane(iu0, iu1, iy0, iy1, 0);
    } else if (style === 'awning') {
      sash(iu0, iu1, iy0, iy1, 0);
      bar(uc - 0.04, uc + 0.04, iy0 + (iy1 - iy0) * 0.45, iy0 + (iy1 - iy0) * 0.45 + 0.02, 0.012, 0.04, 'handle');
    } else if (style === 'double_hung') {
      const mid = (iy0 + iy1) / 2;
      sash(iu0, iu1, mid - 0.02, iy1, -0.016);
      sash(iu0, iu1, iy0, mid + 0.02, 0.016);
    } else if (style === 'louvre') {
      const n = Math.max(3, Math.floor((iy1 - iy0) / 0.1));
      const step = (iy1 - iy0) / n;
      for (let i = 0; i < n; i++) bar(iu0, iu1, iy0 + i * step + step * 0.12, iy0 + (i + 1) * step - step * 0.12, -0.012, 0.012, 'glass');
    } else {
      const ov = 0.03;
      sash(iu0, uc + ov, iy0, iy1, -0.016);
      sash(uc - ov, iu1, iy0, iy1, 0.016);
    }
  } else if (kind === 'door') {
    const fw = 0.05;
    const fd = Math.min(0.1, fr.t * 0.9);
    bar(s0, s0 + fw, yb, yt, -fd / 2, fd / 2);
    bar(s1 - fw, s1, yb, yt, -fd / 2, fd / 2);
    bar(s0 + fw, s1 - fw, yt - fw, yt, -fd / 2, fd / 2);
    bar(s0 + fw, s1 - fw, yb, yb + 0.012, -fd / 2, fd / 2);
    mbar(s0 + fw, s1 - fw, yb + 0.012, yt - fw, -0.02, 0.02, 'leaf');
    // raised panels on both faces
    const pw = (W - 2 * fw) * 0.62;
    const pu0 = uc - pw / 2;
    for (const f of [0.34, 0.74]) {
      const py = yb + HH * f;
      const ph = HH * (f < 0.5 ? 0.28 : 0.3);
      for (const side of [1, -1]) mbar(pu0, pu0 + pw, py - ph / 2, py + ph / 2, side > 0 ? 0.02 : -0.024, side > 0 ? 0.024 : -0.02, 'leaf');
    }
    const hingeA = o.hinge !== 'b';
    const hu = hingeA ? s1 - fw - 0.09 : s0 + fw + 0.09;
    const hy = yb + Math.min(1.0, HH * 0.48);
    for (const side of [1, -1]) {
      mbar(hu - 0.07, hu + 0.07, hy - 0.01, hy + 0.01, side > 0 ? 0.03 : -0.05, side > 0 ? 0.05 : -0.03, 'handle');
      mbar(hu - 0.075, hu - 0.045, hy - 0.04, hy + 0.04, side > 0 ? 0.024 : -0.03, side > 0 ? 0.03 : -0.024, 'handle');
    }
    const hu0 = hingeA ? s0 + fw : s1 - fw;
    b.motion = { type: 'hinged', pivot: P(fr, hu0, 0, yb), angle: doorSwingAngle(o) };
  } else if (kind === 'sliding_door') {
    const fw = 0.055;
    const fd = Math.min(0.1, fr.t * 0.9);
    ring(s0, s1, yb, yt, fw, -fd / 2, fd / 2, 'frame', 0.09);
    const iu0 = s0 + fw;
    const iu1 = s1 - fw;
    const iy0 = yb + 0.09;
    const iy1 = yt - fw;
    const ov = 0.04;
    const sw = 0.045;
    const sash = (u0, u1, v) => {
      ring(u0, u1, iy0, iy1, sw, v - 0.014, v + 0.014, 'frame', 0.1);
      pane(u0 + sw, u1 - sw, iy0 + 0.1, iy1 - sw, v);
    };
    sash(iu0, uc + ov, -0.02);
    // the front sash slides over the back one
    const sashMv = (u0, u1, v) => {
      mring(u0, u1, iy0, iy1, sw, v - 0.014, v + 0.014, 'frame', 0.1);
      mbar(u0 + sw, u1 - sw, iy0 + 0.1, iy1 - sw, v - 0.004, v + 0.004, 'glass');
    };
    sashMv(uc - ov, iu1, 0.02);
    for (const side of [1, -1]) mbar(uc - 0.03, uc + 0.03 + 0.04, iy0 + (iy1 - iy0) * 0.45, iy0 + (iy1 - iy0) * 0.45 + 0.14, side > 0 ? 0.035 : -0.049, side > 0 ? 0.049 : -0.035, 'handle');
    const slide = uc - ov - iu0;
    b.motion = { type: 'slide', dir: [-fr.dx, 0, -fr.dz], distance: slide };
  } else if (kind === 'garage_door') {
    mbar(s0, s1, yb, yt, -0.03, 0.03, 'panel');
    const n = Math.max(2, Math.round(HH / 0.5));
    for (let i = 1; i < n; i++) {
      const y = yb + (HH * i) / n;
      mbar(s0, s1, y - 0.006, y + 0.006, -0.0335, 0.0335, 'groove');
    }
    b.motion = { type: 'roll', pivot: P(fr, uc, 0, yt) };
    bar(s0 - 0.001, s0 + 0.07, yb, yt, -0.04, 0.04, 'panel');
    bar(s1 - 0.07, s1 + 0.001, yb, yt, -0.04, 0.04, 'panel');
    bar(s0, s1, yt - 0.07, yt, -0.04, 0.04, 'panel');
  } else if (kind === 'roller_door') {
    mbar(s0 + 0.06, s1 - 0.06, yb, yt - 0.02, -0.02, 0.02, 'roller');
    b.motion = { type: 'roll', pivot: P(fr, uc, 0, yt) };
    bar(s0, s0 + 0.08, yb, yt, -0.045, 0.045, 'panel');
    bar(s1 - 0.08, s1, yb, yt, -0.045, 0.045, 'panel');
    bar(s0, s1, yt - 0.1, yt, -0.06, 0.06, 'panel');
  } else {
    return null;
  }
  return b.empty && mv.empty ? null : b;
}

// Swing of a hinged leaf about a vertical axis at its hinge, in radians (three.js rotation.y at fully open).
// The leaf opens toward the wall normal side when o.side is 1, and the other way when it is -1.
export function doorSwingAngle(o) {
  const hingeA = o.hinge !== 'b';
  return -(o.side === -1 ? -1 : 1) * (hingeA ? 1 : -1) * (Math.PI / 2);
}
