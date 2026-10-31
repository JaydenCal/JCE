// Shared helpers for furniture: 2D plan symbols (canvas) and low poly 3D models.
// This file must not import three. 3D code receives the THREE namespace as an argument.
// Units: 2D in millimetres, 3D in metres. +y (2D) and +z (3D) are the front of an item.

export const TAU = Math.PI * 2;

// ---------------------------------------------------------------------------------------------
// 2D drawing. The caller sets the transform, strokeStyle, fillStyle and lineWidth.
// ---------------------------------------------------------------------------------------------
export function rrect(ctx, x, y, w, h, r = 0) {
  const rr = Math.max(0, Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2));
  ctx.beginPath();
  if (!rr) {
    ctx.rect(x, y, w, h);
    return;
  }
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

// Rectangle from its top-left corner. o: { r, fill, stroke }.
export function box(ctx, x, y, w, h, o = {}) {
  rrect(ctx, x, y, w, h, o.r || 0);
  if (o.fill !== false) ctx.fill();
  if (o.stroke !== false) ctx.stroke();
}

// Rectangle from its centre.
export const cbox = (ctx, cx, cy, w, h, o) => box(ctx, cx - w / 2, cy - h / 2, w, h, o);

export function line(ctx, x1, y1, x2, y2) {
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}

export function poly(ctx, pts, o = {}) {
  ctx.beginPath();
  pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  if (o.close !== false) ctx.closePath();
  if (o.fill !== false && o.close !== false) ctx.fill();
  if (o.stroke !== false) ctx.stroke();
}

export function circle(ctx, cx, cy, r, o = {}) {
  ctx.beginPath();
  ctx.arc(cx, cy, Math.max(0, r), 0, TAU);
  if (o.fill) ctx.fill();
  if (o.stroke !== false) ctx.stroke();
}

export function ellipse(ctx, cx, cy, rx, ry, o = {}) {
  ctx.beginPath();
  if (ctx.ellipse) ctx.ellipse(cx, cy, Math.max(0, rx), Math.max(0, ry), 0, 0, TAU);
  else {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(Math.max(1e-6, rx), Math.max(1e-6, ry));
    ctx.arc(0, 0, 1, 0, TAU);
    ctx.restore();
  }
  if (o.fill !== false) ctx.fill();
  if (o.stroke !== false) ctx.stroke();
}

// Run fn with a thinner line, for interior detail.
export function thin(ctx, fn, k = 0.55) {
  ctx.save();
  ctx.lineWidth = (ctx.lineWidth || 1) * k;
  fn();
  ctx.restore();
}

// Run fn filling with the stroke colour at low opacity, for subtle shading.
export function tint(ctx, alpha, fn) {
  ctx.save();
  ctx.fillStyle = ctx.strokeStyle;
  ctx.globalAlpha = (ctx.globalAlpha || 1) * alpha;
  fn();
  ctx.restore();
}

export function dashed(ctx, on, off, fn) {
  ctx.save();
  if (ctx.setLineDash) ctx.setLineDash([on, off]);
  fn();
  ctx.restore();
}

// ---------------------------------------------------------------------------------------------
// 3D parts. Plain descriptors, merged per material into one mesh by kit(THREE).add().
// All sizes in metres. y is the bottom of boxes and cylinders, and the centre of spheres.
// ---------------------------------------------------------------------------------------------
export const B = (sx, sy, sz, x, y, z, o = {}) => ({ k: 'b', a: [sx, sy, sz], p: [x, y + sy / 2, z], r: [o.rx || 0, o.ry || 0, o.rz || 0], s: [1, 1, 1] });

export const Y = (r, h, x, y, z, o = {}) => ({
  k: 'c', a: [r, o.rb ?? r, h, o.seg || 14, o.open || false], p: [x, y + h / 2, z], r: [o.rx || 0, o.ry || 0, o.rz || 0], s: [o.sx || 1, 1, o.sz || 1],
});

// Prism: a side profile [[z, y], ...] (metres, +z front) extruded across `width` along x, centred on x.
export const P = (profile, width, x = 0, y = 0, z = 0) => ({ k: 'p', a: [profile, width], p: [x, y, z], r: [0, 0, 0], s: [1, 1, 1] });

export const S = (r, x, y, z, o = {}) => ({ k: 's', a: [r, o.detail ?? 1], p: [x, y, z], r: [0, 0, 0], s: [o.sx || 1, o.sy || 1, o.sz || 1] });

const KITS = new WeakMap();

// Per THREE namespace: material cache plus mesh helpers.
export function kit(THREE) {
  let k = KITS.get(THREE);
  if (!k) {
    k = createKit(THREE);
    KITS.set(THREE, k);
  }
  return k;
}

function createKit(THREE) {
  const mats = new Map();
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const eu = new THREE.Euler();
  const v3 = new THREE.Vector3();
  const sc = new THREE.Vector3();

  // MeshStandardMaterial cached per colour and surface settings.
  function mat(hex, o = {}) {
    const rough = o.rough ?? 0.8;
    const metal = o.metal ?? 0;
    const opacity = o.opacity ?? 1;
    const key = `${hex}|${rough}|${metal}|${opacity}|${o.double ? 1 : 0}`;
    let m = mats.get(key);
    if (!m) {
      m = new THREE.MeshStandardMaterial({
        color: hex, roughness: rough, metalness: metal, transparent: opacity < 1, opacity, side: o.double ? THREE.DoubleSide : THREE.FrontSide,
      });
      mats.set(key, m);
    }
    return m;
  }

  function geometryFor(part) {
    let g;
    if (part.k === 'b') g = new THREE.BoxGeometry(...part.a);
    else if (part.k === 'c') g = new THREE.CylinderGeometry(part.a[0], part.a[1], part.a[2], part.a[3], 1, part.a[4]);
    else if (part.k === 'p') {
      const shape = new THREE.Shape();
      part.a[0].forEach(([zz, yy], i) => (i ? shape.lineTo(-zz, yy) : shape.moveTo(-zz, yy)));
      shape.closePath();
      g = new THREE.ExtrudeGeometry(shape, { depth: part.a[1], bevelEnabled: false });
      g.translate(0, 0, -part.a[1] / 2);
      g.rotateY(Math.PI / 2);
    }
    else g = new THREE.IcosahedronGeometry(part.a[0], part.a[1]);
    eu.set(part.r[0], part.r[1], part.r[2], 'XYZ');
    q.setFromEuler(eu);
    v3.set(part.p[0], part.p[1], part.p[2]);
    sc.set(part.s[0], part.s[1], part.s[2]);
    m4.compose(v3, q, sc);
    g.applyMatrix4(m4);
    return g;
  }

  function merge(parts) {
    const pos = [];
    const nor = [];
    const uv = [];
    const idx = [];
    let base = 0;
    for (const part of parts) {
      const g = geometryFor(part);
      const p = g.attributes.position;
      const n = g.attributes.normal;
      const u = g.attributes.uv;
      for (let i = 0; i < p.count; i++) {
        pos.push(p.getX(i), p.getY(i), p.getZ(i));
        nor.push(n.getX(i), n.getY(i), n.getZ(i));
        uv.push(u ? u.getX(i) : 0, u ? u.getY(i) : 0);
      }
      if (g.index) for (let i = 0; i < g.index.count; i++) idx.push(g.index.getX(i) + base);
      else for (let i = 0; i < p.count; i++) idx.push(i + base);
      base += p.count;
      g.dispose();
    }
    const out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    out.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    out.setIndex(idx);
    out.computeBoundingBox();
    out.computeBoundingSphere();
    return out;
  }

  // Merge `parts` into one mesh with `material` and add it to `group`.
  function add(group, material, parts) {
    if (!parts.length) return null;
    const mesh = new THREE.Mesh(merge(parts), material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    return mesh;
  }

  function group(name) {
    const g = new THREE.Group();
    g.name = name;
    return g;
  }

  return { mat, add, group };
}

// ---------------------------------------------------------------------------------------------
// Colours shared by the models.
// ---------------------------------------------------------------------------------------------
export const COL = {
  oak: '#c9a36b',
  timber: '#a67c52',
  darkTimber: '#6b4a33',
  walnut: '#5b4030',
  white: '#f1f0ec',
  ceramic: '#f4f4f1',
  laminate: '#e9e7e1',
  carcass: '#cfcdc6',
  linen: '#ece8df',
  stone: '#e3dfd6',
  steel: '#b8bdc1',
  darkSteel: '#6e7378',
  black: '#1f2124',
  glassDark: '#232b31',
  glass: '#bcd9e6',
  chrome: '#d0d4d7',
  terracotta: '#b5603f',
  leaf: '#4f7a46',
  leafDark: '#3d6238',
};

// Count of units across a width: at least `min`, about one per `each` metres.
export const across = (width, each, min = 1) => Math.max(min, Math.round(width / each));

// Catalogue entry: default size in mm, a plan symbol drawer and a 3D builder.
export const item = (id, name, category, w, d, h, draw2d, build3d, extra = {}) => ({ id, name, category, w, d, h, draw2d, build3d, ...extra });

// Door or drawer fronts across a width, as 3D part lists: { panels, handles }.
// The panels end 3 mm behind zFront and the handles stand 3 mm proud of the panels, so nothing
// passes the item footprint. n columns, rows rows, between heights y0 and y1.
export function frontPanels({ W, x0 = -W / 2, y0, y1, zFront, n = 1, rows = 1, t = 0.018, gap = 0.004, handle = 'v' }) {
  const panels = [];
  const handles = [];
  const pw = (W - gap * (n + 1)) / n;
  const ph = (y1 - y0 - gap * (rows + 1)) / rows;
  for (let r = 0; r < rows; r++) {
    for (let i = 0; i < n; i++) {
      const cx = x0 + gap + pw / 2 + i * (pw + gap);
      const yb = y0 + gap + r * (ph + gap);
      panels.push(B(pw, ph, t, cx, yb, zFront - 0.003 - t / 2));
      if (handle === 'v') {
        const hx = cx + (i % 2 === 0 ? 1 : -1) * (pw / 2 - 0.035);
        const hl = Math.min(0.35, ph * 0.45);
        handles.push(B(0.012, hl, 0.009, hx, yb + (rows === 1 ? ph * 0.42 : ph * 0.5 - hl / 2), zFront - 0.0045));
      } else if (handle === 'h') {
        const hl = Math.min(0.2, pw * 0.5);
        handles.push(B(hl, 0.012, 0.009, cx, yb + ph * 0.72, zFront - 0.0045));
      }
    }
  }
  return { panels, handles };
}

// Cabinet body for model bodies (m = the object passed to a model body). Options:
// cd carcass depth (default D, aligned to the back), legH (corner legs) or plinth (recessed kick board),
// topT, kick (gap above the base before the fronts start), carcass, front, top, leg colours,
// n columns, rows, handle ('v', 'h' or null).
export function addCabinet(m, o) {
  const { add, mat, W, D, H } = m;
  const cd = o.cd ?? D;
  const zBack = -D / 2;
  const legH = o.legH || 0;
  const plinth = o.plinth || 0;
  const base = legH || plinth;
  const topT = o.topT || 0;
  add(mat(o.carcass ?? COL.carcass, { rough: 0.7 }), [B(W, H - base - topT, cd - 0.021, 0, base, zBack + (cd - 0.021) / 2)]);
  if (legH) {
    const lx = W / 2 - 0.05;
    const lz = (cd - 0.021) / 2 - 0.05;
    const zc = zBack + (cd - 0.021) / 2;
    add(mat(o.leg ?? COL.darkSteel, { rough: 0.5, metal: 0.4 }), [-1, 1].flatMap((sx) => [-1, 1].map((sz) => B(0.04, legH, 0.04, sx * lx, 0, zc + sz * lz))));
  }
  if (plinth) add(mat(o.leg ?? '#2b2d30', { rough: 0.6 }), [B(W - 0.01, plinth, cd - 0.071, 0, 0, zBack + (cd - 0.071) / 2)]);
  const fp = frontPanels({ W, y0: base + (o.kick ?? 0.01), y1: H - topT - 0.005, zFront: zBack + cd, n: o.n ?? 1, rows: o.rows ?? 1, handle: o.handle ?? null });
  add(mat(o.front ?? COL.laminate, { rough: 0.55 }), fp.panels);
  if (fp.handles.length) add(mat('#3a3d40', { rough: 0.4, metal: 0.6 }), fp.handles);
  if (topT) add(mat(o.top ?? COL.stone, { rough: 0.45 }), [B(o.topW ?? W, topT, D, 0, H - topT, 0)]);
}

// Build a model: sizes arrive in mm, the body receives metres. Returns the group.
export function model(THREE, id, size, body) {
  const k = kit(THREE);
  const g = k.group(id);
  body({ k, g, THREE, W: size.w / 1000, D: size.d / 1000, H: size.h / 1000, mat: k.mat, add: (m, parts) => k.add(g, m, parts) });
  return g;
}
