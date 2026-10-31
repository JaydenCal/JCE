// Site and furnishing parts of the model: ground, decks, stairs, rainwater tanks, furniture.
// Pure model assembly, no DOM access. ctx is created in build.js.

import * as THREE from 'three';
import * as G from '../model/geometry.js';
import { GeoBuilder, addBox, addOrientedBox, addCylinder } from './mesh-builder.js';
import { makeMesh, flattenGroup } from './model-util.js';

const DEG = Math.PI / 180;

// Triangulated horizontal polygon (plan mm) at height y, facing up (or down).
export function addFloorPoly(b, slot, polygon, y, up = true, holes = []) {
  const contour = polygon.map((p) => new THREE.Vector2(p.x / 1000, p.y / 1000));
  const holeV = holes.map((h) => h.map((p) => new THREE.Vector2(p.x / 1000, p.y / 1000)));
  let tris;
  try {
    tris = THREE.ShapeUtils.triangulateShape(contour, holeV);
  } catch {
    tris = [];
  }
  const all = contour.concat(...holeV);
  const hint = up ? [0, 1, 0] : [0, -1, 0];
  for (const t of tris) {
    const [a, c, d] = t.map((i) => all[i]);
    b.tri(slot, [a.x, y, a.y], [c.x, y, c.y], [d.x, y, d.y], [a.x, a.y], [c.x, c.y], [d.x, d.y], hint);
  }
}

export function addGround(ctx, root, bounds) {
  const cx = bounds ? (bounds.min.x + bounds.max.x) / 2 : 0;
  const cz = bounds ? (bounds.min.z + bounds.max.z) / 2 : 0;
  const R = Math.max(150, bounds ? Math.hypot(bounds.max.x - bounds.min.x, bounds.max.z - bounds.min.z) * 6 : 0);
  const b = new GeoBuilder();
  const seg = 48;
  const y = ctx.groundY;
  for (let i = 0; i < seg; i++) {
    const a0 = (i / seg) * Math.PI * 2;
    const a1 = ((i + 1) / seg) * Math.PI * 2;
    const p0 = [cx + R * Math.cos(a0), y, cz + R * Math.sin(a0)];
    const p1 = [cx + R * Math.cos(a1), y, cz + R * Math.sin(a1)];
    b.tri('ground', [cx, y, cz], p0, p1, [cx, cz], [p0[0], p0[2]], [p1[0], p1[2]], [0, 1, 0]);
  }
  const mat = ctx.lib.get('grass', '#76895f');
  const mesh = makeMesh(b.build(), { ground: mat }, { ground: true }, { cast: false, receive: true, name: 'ground' });
  if (mesh) root.add(mesh);
  return R;
}

// Decks and other outdoor rooms with no roof: platform, posts and optional balustrade.
export function addDeck(ctx, parent, level, room, walls) {
  const elev = level.elevation / 1000;
  const b = new GeoBuilder();
  const poly = room.polygon;
  const thick = 0.14;
  const top = elev;
  addFloorPoly(b, 'top', poly, top);
  const n = poly.length;
  const lowLevel = level.elevation <= 1000;
  const postBottom = ctx.groundY;
  const postTop = top - thick;
  const post = (x, z) => {
    if (!lowLevel || postTop - postBottom < 0.08) return;
    addBox(b, x - 0.05, x + 0.05, postBottom, postTop, z - 0.05, z + 0.05, { px: 'post', nx: 'post', pz: 'post', nz: 'post', py: null, ny: null });
  };
  for (let i = 0; i < n; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % n];
    const a = [p.x / 1000, 0, p.y / 1000];
    const c = [q.x / 1000, 0, q.y / 1000];
    const out = outwardNormal(poly, p, q);
    b.quad('side', [a[0], top - thick, a[2]], [c[0], top - thick, c[2]], [c[0], top, c[2]], [a[0], top, a[2]], [[0, 0], [1, 0], [1, 1], [0, 1]], [out.x, 0, out.y]);
    const len = G.dist(p, q) / 1000;
    const cnt = Math.max(1, Math.ceil(len / 2.4));
    for (let k = 0; k < cnt; k++) post(a[0] + ((c[0] - a[0]) * k) / cnt, a[2] + ((c[2] - a[2]) * k) / cnt);
  }
  addFloorPoly(b, 'under', poly, top - thick, false);
  if (room.balustrade) {
    for (let i = 0; i < n; i++) {
      const p = poly[i];
      const q = poly[(i + 1) % n];
      if (edgeAgainstWall(p, q, walls)) continue;
      const len = G.dist(p, q) / 1000;
      if (len < 0.3) continue;
      const ang = Math.atan2(q.y - p.y, q.x - p.x);
      const mx = (p.x + q.x) / 2000;
      const mz = (p.y + q.y) / 2000;
      addOrientedBox(b, mx, mz, len / 2, 0.02, ang, top + 0.95, top + 1.0, 'rail');
      addOrientedBox(b, mx, mz, len / 2, 0.006, ang, top + 0.1, top + 0.95, { pu: 'glass', nu: 'glass', pv: 'glass', nv: 'glass', py: null, ny: null });
      const cnt = Math.max(1, Math.ceil(len / 1.2));
      for (let k = 0; k <= cnt; k++) {
        const t = k / cnt;
        const x = (p.x + (q.x - p.x) * t) / 1000;
        const z = (p.y + (q.y - p.y) * t) / 1000;
        addBox(b, x - 0.03, x + 0.03, top, top + 1.0, z - 0.03, z + 0.03, 'rail');
      }
    }
  }
  const tint = ctx.tint(room.status);
  const fin = ctx.floorFinish(room, 'decking');
  const wood = ctx.lib.get(fin.material, fin.hex, { tint });
  const dark = ctx.lib.plain(shade(fin.hex, 0.62), { tint, rough: 0.8 });
  const res = b.build();
  const mesh = makeMesh(res, {
    top: wood, side: dark, under: dark, post: dark, rail: ctx.lib.frame(ctx.hex(ctx.fin.frames.colour), { tint }), glass: ctx.lib.glass({ tint }),
  }, { kind: 'deck', id: room.id, levelId: level.id }, { name: `deck:${room.id}` });
  if (mesh) parent.add(mesh);
}

function outwardNormal(poly, p, q) {
  const d = G.norm(G.sub(q, p));
  const nrm = { x: d.y, y: -d.x };
  const m = G.lerp(p, q, 0.5);
  const test = { x: m.x + nrm.x * 20, y: m.y + nrm.y * 20 };
  return G.pointInPolygon(test, poly) ? { x: -nrm.x, y: -nrm.y } : nrm;
}

function edgeAgainstWall(p, q, walls) {
  const d = G.norm(G.sub(q, p));
  const m = G.lerp(p, q, 0.5);
  for (const w of walls) {
    const wd = G.wallDir(w);
    if (Math.abs(G.dot(d, wd)) < 0.95) continue;
    if (G.projectToSegment(m, w.a, w.b).d < (w.thickness || 100) / 2 + 200) return true;
  }
  return false;
}

export function shade(hex, f) {
  const c = new THREE.Color(hex);
  c.multiplyScalar(f);
  return `#${c.getHexString()}`;
}

// Stairs as solid stepped blocks climbing along local +y to the next level.
export function addStair(ctx, parent, level, stair, rise) {
  const elev = level.elevation / 1000;
  const b = new GeoBuilder();
  const nr = Math.max(3, Math.round(rise / 0.18));
  const riser = rise / nr;
  const going = stair.length / 1000 / nr;
  const w = stair.width / 1000;
  const ang = (stair.rotation || 0) * DEG;
  const cx = stair.x / 1000;
  const cz = stair.y / 1000;
  const c = Math.cos(ang);
  const s = Math.sin(ang);
  for (let k = 1; k < nr; k++) {
    const v0 = -stair.length / 2000 + (k - 1) * going;
    const v1 = v0 + going;
    const vm = (v0 + v1) / 2;
    // centre of this step in plan: local (0, vm) rotated by the plan rotation
    const sx = cx - s * vm;
    const sz = cz + c * vm;
    addOrientedBox(b, sx, sz, w / 2, going / 2, ang, elev, elev + k * riser, { pu: 'step', nu: 'step', pv: 'step', nv: 'step', py: 'tread', ny: null });
  }
  const fin = ctx.floorFinish({ type: 'living', floor: null }, 'timber');
  const mat = ctx.lib.get(fin.material, fin.hex);
  const mesh = makeMesh(b.build(), { step: ctx.lib.plain(shade(fin.hex, 0.78), { rough: 0.7 }), tread: mat }, { kind: 'stair', id: stair.id, levelId: level.id }, { name: `stair:${stair.id}` });
  if (mesh) parent.add(mesh);
}

export function addTank(ctx, root, tank, levelId) {
  const r = tank.diameter / 2000;
  const h = tank.height / 1000;
  const cx = tank.x / 1000;
  const cz = tank.y / 1000;
  const y0 = ctx.groundY;
  const b = new GeoBuilder();
  addCylinder(b, cx, cz, r, y0, y0 + h, 48, { side: 'body', top: null, bottom: null });
  addCylinder(b, cx, cz, r * 1.01, y0, y0 + 0.05, 48, { side: 'rim', top: 'rim', bottom: null });
  addCylinder(b, cx, cz, r * 0.98, y0 + h, y0 + h + 0.07, 48, { side: 'lid', top: 'lid', bottom: 'lid' });
  addCylinder(b, cx + r * 0.45, cz, 0.18, y0 + h + 0.07, y0 + h + 0.13, 20, { side: 'lid', top: 'lid', bottom: null });
  addCylinder(b, cx + r + 0.04, cz, 0.04, y0 + 0.25, y0 + 0.5, 12, { side: 'pipe', top: 'pipe', bottom: null });
  const tint = ctx.tint(tank.status);
  const hex = ctx.hex(tank.colour);
  const mesh = makeMesh(b.build(), {
    body: ctx.lib.get('tank', hex, { tint }),
    rim: ctx.lib.plain(shade(hex, 0.8), { tint }),
    lid: ctx.lib.plain(shade(hex, 0.72), { tint, rough: 0.6 }),
    pipe: ctx.lib.plain('#2d3034', { tint }),
  }, { kind: 'tank', id: tank.id, levelId }, { name: `tank:${tank.id}` });
  if (mesh) root.add(mesh);
}

// Furniture ---------------------------------------------------------------------------------------
function greyBox(w, d, h, material) {
  const g = new THREE.Group();
  const m = new THREE.Mesh(new THREE.BoxGeometry(w / 1000, h / 1000, d / 1000), material);
  m.position.y = h / 2000;
  g.add(m);
  return g;
}

export function addFurniture(ctx, parent, level, f) {
  let def = null;
  try {
    def = ctx.catalogue?.getFurniture?.(f.item) || null;
  } catch {
    def = null;
  }
  const w = f.w ?? def?.w ?? 600;
  const d = f.d ?? def?.d ?? 600;
  const h = def?.h ?? 700;
  let g = null;
  if (def?.build3d) {
    try {
      g = def.build3d(THREE, { w, d, h });
    } catch {
      g = null;
    }
  }
  if (!g || !(g.isObject3D)) g = greyBox(w, d, h, ctx.lib.plain('#a9aeb3', { rough: 0.8 }));
  // unit guard: the catalogue should return metres; fix up millimetre or oversized output
  const box = new THREE.Box3().setFromObject(g);
  const size = box.getSize(new THREE.Vector3());
  const expected = Math.max(w, d, h) / 1000;
  const got = Math.max(size.x, size.y, size.z);
  if (got > expected * 40) g.scale.multiplyScalar(0.001);
  else if (got > 0 && got < expected / 40) g.scale.multiplyScalar(1000);
  g.updateMatrixWorld(true);
  if (g.scale.x !== 1) {
    // bake the correction so flattening sees the right size
    const wrap = new THREE.Group();
    wrap.add(g);
    g = wrap;
  }
  g = flattenGroup(g, ctx.lib);
  const wrapper = new THREE.Group();
  wrapper.add(g);
  wrapper.position.set(f.x / 1000, level.elevation / 1000, f.y / 1000);
  wrapper.rotation.y = -(f.rotation || 0) * DEG;
  wrapper.name = `furniture:${f.id}`;
  const ud = { kind: 'furniture', id: f.id, levelId: level.id };
  wrapper.userData = ud;
  wrapper.traverse((o) => {
    if (o.isMesh) {
      o.userData = { ...ud };
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });
  parent.add(wrapper);
}
