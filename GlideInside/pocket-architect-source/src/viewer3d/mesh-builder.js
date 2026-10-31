// Accumulates flat-shaded triangles per material slot and builds one BufferGeometry with
// material groups. No DOM access. Positions are [x, y, z] arrays in metres.

import * as THREE from 'three';

const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const subv = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];

export class GeoBuilder {
  constructor() {
    this.slots = new Map(); // key -> { pos: [], nor: [], uv: [] }
  }

  _slot(key) {
    let s = this.slots.get(key);
    if (!s) {
      s = { pos: [], nor: [], uv: [] };
      this.slots.set(key, s);
    }
    return s;
  }

  get empty() {
    for (const s of this.slots.values()) if (s.pos.length) return false;
    return true;
  }

  // One triangle. hint is an optional outward normal; the winding is flipped to agree with it.
  tri(slot, a, b, c, ua = [0, 0], ub = [1, 0], uc = [0, 1], hint = null) {
    const n = cross(subv(b, a), subv(c, a));
    const len = Math.hypot(n[0], n[1], n[2]);
    if (len < 1e-9) return;
    let nx = n[0] / len;
    let ny = n[1] / len;
    let nz = n[2] / len;
    if (hint && nx * hint[0] + ny * hint[1] + nz * hint[2] < 0) {
      [b, c] = [c, b];
      [ub, uc] = [uc, ub];
      nx = -nx;
      ny = -ny;
      nz = -nz;
    }
    const s = this._slot(slot);
    s.pos.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
    s.nor.push(nx, ny, nz, nx, ny, nz, nx, ny, nz);
    s.uv.push(ua[0], ua[1], ub[0], ub[1], uc[0], uc[1]);
  }

  // Triangle with explicit vertex normals (smooth surfaces). Winding is corrected to agree with them.
  triN(slot, a, b, c, na, nb, nc, ua = [0, 0], ub = [1, 0], uc = [0, 1]) {
    const n = cross(subv(b, a), subv(c, a));
    const avg = [na[0] + nb[0] + nc[0], na[1] + nb[1] + nc[1], na[2] + nb[2] + nc[2]];
    if (Math.hypot(n[0], n[1], n[2]) < 1e-12) return;
    if (n[0] * avg[0] + n[1] * avg[1] + n[2] * avg[2] < 0) {
      [b, c] = [c, b];
      [nb, nc] = [nc, nb];
      [ub, uc] = [uc, ub];
    }
    const s = this._slot(slot);
    s.pos.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
    s.nor.push(na[0], na[1], na[2], nb[0], nb[1], nb[2], nc[0], nc[1], nc[2]);
    s.uv.push(ua[0], ua[1], ub[0], ub[1], uc[0], uc[1]);
  }

  // Quad a, b, c, d in order around the perimeter (either winding when a hint is given).
  quad(slot, a, b, c, d, uvs = [[0, 0], [1, 0], [1, 1], [0, 1]], hint = null) {
    this.tri(slot, a, b, c, uvs[0], uvs[1], uvs[2], hint);
    this.tri(slot, a, c, d, uvs[0], uvs[2], uvs[3], hint);
  }

  // Convex polygon (3 or more points) fanned from the first vertex.
  poly(slot, pts, uvs, hint = null) {
    for (let i = 1; i < pts.length - 1; i++) this.tri(slot, pts[0], pts[i], pts[i + 1], uvs[0], uvs[i], uvs[i + 1], hint);
  }

  // Merge the content of another builder (same slot keys) into this one.
  append(other) {
    for (const [k, s] of other.slots) {
      const t = this._slot(k);
      for (let i = 0; i < s.pos.length; i++) t.pos.push(s.pos[i]);
      for (let i = 0; i < s.nor.length; i++) t.nor.push(s.nor[i]);
      for (let i = 0; i < s.uv.length; i++) t.uv.push(s.uv[i]);
    }
  }

  // Returns { geometry, slotKeys } where slotKeys[i] is the slot key of material index i,
  // or null when there is nothing to draw. `order` optionally fixes the slot order.
  build(order = null) {
    const keys = [];
    const wanted = order || [...this.slots.keys()];
    for (const k of wanted) if (this.slots.get(k)?.pos.length) keys.push(k);
    if (!keys.length) return null;
    let total = 0;
    for (const k of keys) total += this.slots.get(k).pos.length;
    const pos = new Float32Array(total);
    const nor = new Float32Array(total);
    const uv = new Float32Array((total / 3) * 2);
    const geometry = new THREE.BufferGeometry();
    let p = 0;
    let u = 0;
    keys.forEach((k, mi) => {
      const s = this.slots.get(k);
      pos.set(s.pos, p);
      nor.set(s.nor, p);
      uv.set(s.uv, u);
      geometry.addGroup(p / 3, s.pos.length / 3, mi);
      p += s.pos.length;
      u += s.uv.length;
    });
    geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    return { geometry, slotKeys: keys };
  }
}

// Axis-aligned box helper in world space. faces: { px, nx, py, ny, pz, nz } slot keys (null skips a face).
// UVs are in metres, planar per face, so textures tile at a real scale.
export function addBox(b, x0, x1, y0, y1, z0, z1, faces) {
  if (x1 - x0 < 1e-6 || y1 - y0 < 1e-6 || z1 - z0 < 1e-6) return;
  const f = typeof faces === 'string' ? { px: faces, nx: faces, py: faces, ny: faces, pz: faces, nz: faces } : faces;
  if (f.px) b.quad(f.px, [x1, y0, z0], [x1, y0, z1], [x1, y1, z1], [x1, y1, z0], [[z0, y0], [z1, y0], [z1, y1], [z0, y1]], [1, 0, 0]);
  if (f.nx) b.quad(f.nx, [x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [[z0, y0], [z1, y0], [z1, y1], [z0, y1]], [-1, 0, 0]);
  if (f.py) b.quad(f.py, [x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1], [[x0, z0], [x1, z0], [x1, z1], [x0, z1]], [0, 1, 0]);
  if (f.ny) b.quad(f.ny, [x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], [[x0, z0], [x1, z0], [x1, z1], [x0, z1]], [0, -1, 0]);
  if (f.pz) b.quad(f.pz, [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [[x0, y0], [x1, y0], [x1, y1], [x0, y1]], [0, 0, 1]);
  if (f.nz) b.quad(f.nz, [x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], [[x0, y0], [x1, y0], [x1, y1], [x0, y1]], [0, 0, -1]);
}

// Box in a rotated frame about Y: centre (cx, cz), half sizes along the frame's u and v axes.
// angle is the rotation of the u axis from +X towards +Z (radians).
export function addOrientedBox(b, cx, cz, hu, hv, angle, y0, y1, faces) {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const P = (u, v, y) => [cx + c * u - s * v, y, cz + s * u + c * v];
  const f = typeof faces === 'string' ? { pu: faces, nu: faces, pv: faces, nv: faces, py: faces, ny: faces } : faces;
  const uvTop = (p) => [p[0], p[2]];
  if (f.pu) b.quad(f.pu, P(hu, -hv, y0), P(hu, hv, y0), P(hu, hv, y1), P(hu, -hv, y1), [[0, y0], [2 * hv, y0], [2 * hv, y1], [0, y1]], [c, 0, s]);
  if (f.nu) b.quad(f.nu, P(-hu, -hv, y0), P(-hu, hv, y0), P(-hu, hv, y1), P(-hu, -hv, y1), [[0, y0], [2 * hv, y0], [2 * hv, y1], [0, y1]], [-c, 0, -s]);
  if (f.pv) b.quad(f.pv, P(-hu, hv, y0), P(hu, hv, y0), P(hu, hv, y1), P(-hu, hv, y1), [[0, y0], [2 * hu, y0], [2 * hu, y1], [0, y1]], [-s, 0, c]);
  if (f.nv) b.quad(f.nv, P(-hu, -hv, y0), P(hu, -hv, y0), P(hu, -hv, y1), P(-hu, -hv, y1), [[0, y0], [2 * hu, y0], [2 * hu, y1], [0, y1]], [s, 0, -c]);
  const top = [P(-hu, -hv, y1), P(hu, -hv, y1), P(hu, hv, y1), P(-hu, hv, y1)];
  const bot = [P(-hu, -hv, y0), P(hu, -hv, y0), P(hu, hv, y0), P(-hu, hv, y0)];
  if (f.py) b.quad(f.py, top[0], top[1], top[2], top[3], top.map(uvTop), [0, 1, 0]);
  if (f.ny) b.quad(f.ny, bot[0], bot[1], bot[2], bot[3], bot.map(uvTop), [0, -1, 0]);
}

// Vertical cylinder with smooth sides. uvScale: [metres per u turn, 1] so UVs are in metres.
export function addCylinder(b, cx, cz, r, y0, y1, seg, slots) {
  const f = typeof slots === 'string' ? { side: slots, top: slots, bottom: slots } : slots;
  const circ = 2 * Math.PI * r;
  for (let i = 0; i < seg; i++) {
    const a0 = (i / seg) * Math.PI * 2;
    const a1 = ((i + 1) / seg) * Math.PI * 2;
    const c0 = Math.cos(a0);
    const s0 = Math.sin(a0);
    const c1 = Math.cos(a1);
    const s1 = Math.sin(a1);
    const p00 = [cx + r * c0, y0, cz + r * s0];
    const p10 = [cx + r * c1, y0, cz + r * s1];
    const p11 = [cx + r * c1, y1, cz + r * s1];
    const p01 = [cx + r * c0, y1, cz + r * s0];
    const n0 = [c0, 0, s0];
    const n1 = [c1, 0, s1];
    const u0 = (i / seg) * circ;
    const u1 = ((i + 1) / seg) * circ;
    if (f.side) {
      b.triN(f.side, p00, p10, p11, n0, n1, n1, [u0, y0], [u1, y0], [u1, y1]);
      b.triN(f.side, p00, p11, p01, n0, n1, n0, [u0, y0], [u1, y1], [u0, y1]);
    }
    if (f.top) b.tri(f.top, [cx, y1, cz], p11, p01, [cx, cz], [p11[0], p11[2]], [p01[0], p01[2]], [0, 1, 0]);
    if (f.bottom) b.tri(f.bottom, [cx, y0, cz], p10, p00, [cx, cz], [p10[0], p10[2]], [p00[0], p00[2]], [0, -1, 0]);
  }
}
