// Concrete panel walls in 3D (tilt-up, precast, and the concrete dado of the combination system). Each panel is real geometry: a slab with its
// own front, back and edge faces, a 20 mm vertical joint between panels with a darker backer strip set back in it, optional horizontal
// reveals and a recessed feature band, openings cut inside a panel or framed by a lintel and spandrel panels, parapets above the eaves and
// a blank signage board. One merged mesh per wall (a few material groups), so a whole warehouse is a handful of draw calls. No DOM, no textures
// here: the materials come from the library in build.js (small generated textures, no blur, no fog).
//
// Wall local frame (see walls.js): u along the wall from end a, v along the normal n = (-d.y, d.x), y up. Plan (x, y) mm maps to world
// (x / 1000, y, y / 1000). Texture coordinates are metres along the wall's canonical direction and metres up, so a finish lines up along a wall
// and the horizontal reveals meet across a corner.

import { GeoBuilder } from './mesh-builder.js';
import { wallFrame } from './walls.js';
import { panelWallLayout, JOINT_MM, REVEAL_MM, REVEAL_DEPTH_MM } from '../commercial/catalogue/panels.js';

export { panelEnds } from '../commercial/catalogue/panels.js';

const MM = 1 / 1000;
const BACKER_SETBACK_MM = 40;
const BAND_RECESS_MM = 20;
const SIGN_PROUD_MM = 40;

/** Slots of a panel wall mesh: face, accent, back, edge, cap, joint, sign. */
export const PANEL_SLOTS = ['face', 'accent', 'back', 'edge', 'cap', 'joint', 'sign'];

function bandsFor(layout, y0, y1) {
  // Horizontal strips inside [y0, y1]: reveals (recessed), the feature band (recessed, accent colour) and the plain faces between.
  const strips = [];
  for (const y of layout.reveals) strips.push({ y0: y - REVEAL_MM / 2, y1: y + REVEAL_MM / 2, recess: REVEAL_DEPTH_MM, accent: false });
  if (layout.band) {
    strips.push({ y0: layout.band.y0, y1: layout.band.y1, recess: BAND_RECESS_MM, accent: true });
  }
  strips.sort((a, b) => a.y0 - b.y0);
  const out = [];
  let cur = y0;
  for (const s of strips) {
    const a = Math.max(s.y0, cur);
    const b = Math.min(s.y1, y1);
    if (b <= a + 0.5 || a >= y1) continue;
    if (a > cur + 0.5) out.push({ y0: cur, y1: a, recess: 0, accent: false });
    out.push({ y0: a, y1: b, recess: s.recess, accent: s.accent, strip: !s.accent });
    cur = b;
  }
  if (cur < y1 - 0.5) out.push({ y0: cur, y1, recess: 0, accent: false });
  return out;
}

const intervalsAt = (panels, x, side) => {
  const out = [];
  for (const p of panels) {
    for (const r of p.rects) {
      if (side === 'left' ? Math.abs(r.x1 - x) < 1.5 : Math.abs(r.x0 - x) < 1.5) out.push([r.y0, r.y1]);
    }
  }
  return out;
};
const intersect = (A, B) => {
  const out = [];
  for (const a of A) for (const b of B) {
    const lo = Math.max(a[0], b[0]);
    const hi = Math.min(a[1], b[1]);
    if (hi > lo + 0.5) out.push([lo, hi]);
  }
  return out;
};

/**
 * The geometry of one wall as concrete panels.
 * w: the model wall (w.panel is its spec), o: { baseY (m), wallHeightMm, outSide (+1 or -1), openings (model openings), ends ({ a, b } from panelEnds), topLevel }.
 * Returns { builder, layout, span, top } where builder is a GeoBuilder (slots PANEL_SLOTS) and layout is the panel layout (see panels.js).
 */
export function buildPanelWall(w, o) {
  const spec = w.panel;
  const fr = wallFrame(w);
  const { span, top, layout } = panelWallLayout(w, o.openings, { ends: o.ends, wallHeightMm: o.wallHeightMm, topLevel: o.topLevel !== false });
  const b = new GeoBuilder();
  const out = o.outSide >= 0 ? 1 : -1;
  const wt = (w.thickness || 200) * MM;
  const T = spec.thicknessMm * MM;
  const vo = out * (wt / 2);
  const vi = vo - out * T;
  const P = (u, v, y) => [fr.ax + fr.dx * u + fr.nx * v, y, fr.az + fr.dz * u + fr.nz * v];
  const Uw = (p) => p[0] * fr.dcx + p[2] * fr.dcz;
  const nOut = [fr.nx * out, 0, fr.nz * out];
  const dir = [fr.dx, 0, fr.dz];
  const jointSet = layout.joints;
  const isJoint = (x) => jointSet.some((j) => Math.abs(j - x) < 1.5);
  const u = (x) => (span.start + x) * MM;
  const y = (v) => o.baseY + v * MM;

  const slab = (x0, x1, y0, y1, faceSlot, recessMm) => {
    const rec = (recessMm || 0) * MM;
    const vf = vo - out * rec;
    const ua = u(x0);
    const ub = u(x1);
    const ya = y(y0);
    const yb = y(y1);
    const quad = (slot, a, c, d, e, uvs, hint) => b.quad(slot, a, c, d, e, uvs, hint);
    // front
    const f = [P(ua, vf, ya), P(ub, vf, ya), P(ub, vf, yb), P(ua, vf, yb)];
    quad(faceSlot, f[0], f[1], f[2], f[3], f.map((p, i) => [Uw(p), i < 2 ? ya : yb]), nOut);
    // back
    const k = [P(ua, vi, ya), P(ub, vi, ya), P(ub, vi, yb), P(ua, vi, yb)];
    quad('back', k[0], k[1], k[2], k[3], k.map((p, i) => [Uw(p), i < 2 ? ya : yb]), [-nOut[0], 0, -nOut[2]]);
    // ends (left and right), top and bottom edges
    const L = [P(ua, vi, ya), P(ua, vf, ya), P(ua, vf, yb), P(ua, vi, yb)];
    quad('edge', L[0], L[1], L[2], L[3], [[0, ya], [T, ya], [T, yb], [0, yb]], [-dir[0], 0, -dir[2]]);
    const R = [P(ub, vi, ya), P(ub, vf, ya), P(ub, vf, yb), P(ub, vi, yb)];
    quad('edge', R[0], R[1], R[2], R[3], [[0, ya], [T, ya], [T, yb], [0, yb]], dir);
    const t = [P(ua, vi, yb), P(ub, vi, yb), P(ub, vf, yb), P(ua, vf, yb)];
    quad('cap', t[0], t[1], t[2], t[3], t.map((p) => [Uw(p), 0]), [0, 1, 0]);
    const bt = [P(ua, vi, ya), P(ub, vi, ya), P(ub, vf, ya), P(ua, vf, ya)];
    quad('edge', bt[0], bt[1], bt[2], bt[3], bt.map((p) => [Uw(p), 0]), [0, -1, 0]);
  };

  for (const p of layout.panels) {
    for (const r of p.rects) {
      // The joint is cut out of the panel on each side of it; no gap at a wall end.
      const x0 = r.x0 + (Math.abs(r.x0 - p.x0) < 1.5 && isJoint(p.x0) ? JOINT_MM / 2 : 0);
      const x1 = r.x1 - (Math.abs(r.x1 - p.x1) < 1.5 && isJoint(p.x1) ? JOINT_MM / 2 : 0);
      if (x1 - x0 < 1) continue;
      for (const band of bandsFor(layout, r.y0, r.y1)) {
        // A reveal is a recessed strip in the darker edge tone, so the horizontal lines read crisply at any distance.
        const slot = band.strip ? 'edge' : band.accent ? (p.accent ? 'face' : 'accent') : p.accent ? 'accent' : 'face';
        slab(x0, x1, band.y0, band.y1, slot, band.recess);
      }
    }
  }
  // Joints: a darker backer strip set back in the 20 mm gap, only where there is panel on both sides.
  for (const jx of layout.joints) {
    const spans = intersect(intervalsAt(layout.panels, jx, 'left'), intervalsAt(layout.panels, jx, 'right'));
    for (const [y0, y1] of spans) {
      const ua = u(jx - JOINT_MM / 2);
      const ub = u(jx + JOINT_MM / 2);
      const v = vo - out * BACKER_SETBACK_MM * MM;
      const q = [P(ua, v, y(y0)), P(ub, v, y(y0)), P(ub, v, y(y1)), P(ua, v, y(y1))];
      b.quad('joint', q[0], q[1], q[2], q[3], q.map((p, i) => [Uw(p), i < 2 ? y(y0) : y(y1)]), nOut);
    }
  }
  // Signage band: a blank board standing proud of the wall (no lettering, no brand).
  if (layout.signage) {
    const s = layout.signage;
    const ua = u(s.x0);
    const ub = u(s.x1);
    const vf = vo + out * SIGN_PROUD_MM * MM;
    const ya = y(s.y0);
    const yb = y(s.y1);
    const q = [P(ua, vf, ya), P(ub, vf, ya), P(ub, vf, yb), P(ua, vf, yb)];
    b.quad('sign', q[0], q[1], q[2], q[3], q.map((p, i) => [Uw(p), i < 2 ? ya : yb]), nOut);
    const sides = [[P(ua, vo, ya), P(ua, vf, ya), P(ua, vf, yb), P(ua, vo, yb), [-dir[0], 0, -dir[2]]], [P(ub, vo, ya), P(ub, vf, ya), P(ub, vf, yb), P(ub, vo, yb), dir]];
    for (const [a, c, d, e, h] of sides) b.quad('sign', a, c, d, e, [[0, ya], [1, ya], [1, yb], [0, yb]], h);
    const tp = [P(ua, vo, yb), P(ub, vo, yb), P(ub, vf, yb), P(ua, vf, yb)];
    b.quad('sign', tp[0], tp[1], tp[2], tp[3], [[0, 0], [1, 0], [1, 1], [0, 1]], [0, 1, 0]);
    const bm = [P(ua, vo, ya), P(ub, vo, ya), P(ub, vf, ya), P(ua, vf, ya)];
    b.quad('sign', bm[0], bm[1], bm[2], bm[3], [[0, 0], [1, 0], [1, 1], [0, 1]], [0, -1, 0]);
  }
  return { builder: b, layout, span, top };
}

/**
 * The metal clad upper part of the combination system: the model openings clipped to the part of the wall above the concrete. Returns copies
 * with the sill and height measured from the dado, and only the openings that reach above it.
 */
export function openingsAbove(openings, dadoMm) {
  const out = [];
  for (const op of openings) {
    const sill = Number(op.sill) || 0;
    const head = sill + (Number(op.height) || 0);
    if (head <= dadoMm + 50) continue;
    const s2 = Math.max(0, sill - dadoMm);
    out.push({ ...op, sill: s2, height: head - dadoMm - s2 });
  }
  return out;
}

/** The panel spec in force for a model building or row group, from any of its walls (null when none carries one). */
export function panelSpecOfWalls(walls) {
  for (const w of walls) if (w.panel) return w.panel;
  return null;
}
