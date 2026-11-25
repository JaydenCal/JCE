// 3D for catalogue buildings: the roofs of every building (the standard level roof skips catalogue walls), paved extras (truck apron, yard,
// dock recess), generic canopies, and the extras each type draws in view3d (dock levellers, seals, skylights, fuel canopies and the like).
// Both view3d conventions of the type modules are supported: draw into ctx.builder (the Plan kit types and the warehouse and showroom), or return
// { build(helpers) | builder } (the defineType kit). Windows, glass and boards are unlit MeshBasicMaterial so they stay crisp. No DOM.

import * as THREE from 'three';
import { GeoBuilder, addOrientedBox, addCylinder } from '../../viewer3d/mesh-builder.js';
import { makeMesh } from '../../viewer3d/model-util.js';
import { addFloorPoly } from '../../viewer3d/site.js';
import { buildingParking } from './bays.js';
import { textureFor } from './pavements/view3d.js';
import { buildingsOf, siteWorksOf } from './buildings.js';
import { runBuilding } from './materialise.js';
import { toWorld, dirToWorld, toLocal, bboxOf } from './frame.js';

const RAD = Math.PI / 180;

/** Colour and lighting of the named slots types draw with. unlit: MeshBasicMaterial; alpha: translucent. */
export const SLOT_STYLE = {
  canopy: { colour: '#e9ecef' }, steel: { colour: '#6b7480' }, concrete: { colour: '#b9bcc0' }, asphalt: { colour: '#3a3d42' }, panel: { colour: '#dfe4e8' },
  pump: { colour: '#c9ced4' }, board: { colour: '#2b2f36', unlit: true }, sign: { colour: '#dcdcd6' }, glass: { colour: '#9fc3d6', unlit: true, alpha: 0.55 },
  furniture: { colour: '#8a6d4e' }, plant: { colour: '#7d858f' }, foliage: { colour: '#4f8a4a', unlit: true }, seal: { colour: '#2b2f33' }, bumper: { colour: '#141414' },
  marking: { colour: '#f2f2ee', unlit: true }, accessible: { colour: '#2f6fd0', unlit: true }, zone: { colour: '#cfe0f5', unlit: true },
  roof: { colour: '#8a8f94' }, wall: { colour: '#aab0b5' }, vehicle: { colour: '#d8d8d2' }, pit: { colour: '#2b2f33' },
};

const pavedCache = new Map();
function pavedTexture(kind, hex) {
  const key = `${kind}:${hex}`;
  if (pavedCache.has(key)) return pavedCache.get(key);
  const base = textureFor(kind === 'concrete' ? { kind: 'concrete', base: hex, broom: true } : { kind: 'asphalt', base: hex });
  let tex = null;
  if (base) {
    tex = base.clone();
    const tile = kind === 'concrete' ? 4 : 3; // metres per tile; the extras carry texture coordinates in metres
    tex.repeat.set(1 / tile, 1 / tile);
    tex.needsUpdate = true;
  }
  pavedCache.set(key, tex);
  return tex;
}

const makeMaterial = (lib, key) => {
  const [name, colour] = String(key).split('|');
  const st = SLOT_STYLE[name] || { colour: '#9aa0a6' };
  const hex = colour || st.colour;
  // Paved extras (truck aprons, yards, forecourts, lanes) carry the same crisp canvas textures as the car park pavements: broom finished
  // concrete with 4 m control joints, and asphalt. The cached texture is cloned so its own repeat never disturbs the pavements.
  if (name === 'concrete' || name === 'asphalt') {
    const tex = pavedTexture(name, hex);
    if (tex) {
      const m = new THREE.MeshStandardMaterial({ color: '#ffffff', map: tex, roughness: 0.94, metalness: 0, envMapIntensity: 0.25 });
      m.userData.shared = false;
      m.userData.disposeMap = false;
      return m;
    }
  }
  if (st.unlit) return new THREE.MeshBasicMaterial({ color: new THREE.Color(hex), transparent: !!st.alpha, opacity: st.alpha ?? 1, side: st.alpha ? THREE.DoubleSide : THREE.FrontSide, depthWrite: !st.alpha });
  return lib.plain(hex, { rough: name === 'steel' ? 0.45 : 0.75, metal: name === 'steel' ? 0.35 : 0 });
};

function meshFromBuilder(ctx, builder, name, userData = {}) {
  const res = builder.build();
  if (!res) return null;
  const mats = {};
  for (const k of res.slotKeys) mats[k] = makeMaterial(ctx.lib, k);
  return makeMesh(res, mats, { catalogue: true, decor: true, ...userData }, { name, cast: true, receive: true });
}

/** ctx handed to a type's view3d and used for the generic parts. */
export function extrasCtx(b, THREEns = THREE) {
  const place = b.place;
  const builder = new GeoBuilder();
  const box = (x0, y0, x1, y1, z0, z1, slot) => {
    const c = toWorld(place, { x: (x0 + x1) / 2, y: (y0 + y1) / 2 });
    addOrientedBox(builder, c.x / 1000, c.y / 1000, Math.abs(x1 - x0) / 2000, Math.abs(y1 - y0) / 2000, (place.rotationDeg || 0) * RAD, z0 / 1000, z1 / 1000, slot);
  };
  return {
    THREE: THREEns, builder, GeoBuilder, addOrientedBox, addCylinder, place, box,
    helpers: { GeoBuilder, addOrientedBox, addCylinder },
    slot: (slot, colour) => (colour ? `${slot}|${colour}` : slot),
  };
}

// Roofs -----------------------------------------------------------------------------------------------------------------------
const mkP = (place) => (lx, ly, h) => { const w = toWorld(place, { x: lx, y: ly }); return [w.x / 1000, h / 1000, w.y / 1000]; };
const mkN = (place) => (lx, ly, hz = 0) => { const d = dirToWorld(place, { x: lx, y: ly }); return [d.x, hz, d.y]; };

/** The roof of a building as geometry in a builder with slots roof, fascia, gable. Returns the builder. */
export function roofGeometry(b, roof, rinfo, builder = new GeoBuilder()) {
  const place = b.place;
  const P = mkP(place);
  const N = mkN(place);
  const loc = roof.polygon.map((q) => toLocal(place, q));
  const bb = bboxOf(loc);
  const x0 = bb.minX; const x1 = bb.maxX; const y0 = bb.minY; const y1 = bb.maxY;
  const W = x1 - x0; const D = y1 - y0;
  const type = roof.type || 'skillion';
  const pitch = type === 'flat' ? 0 : Math.max(1, Math.min(45, Number(roof.pitchDeg) || 3));
  const tan = Math.tan(pitch * RAD);
  const o = Number.isFinite(roof.overhangMm) ? roof.overhangMm : 200;
  const base = rinfo.baseMm;
  const rot = (place.rotationDeg || 0) * RAD;
  const fbox = (ax0, ay0, ax1, ay1, z0, z1) => {
    const c = toWorld(place, { x: (ax0 + ax1) / 2, y: (ay0 + ay1) / 2 });
    addOrientedBox(builder, c.x / 1000, c.y / 1000, Math.abs(ax1 - ax0) / 2000, Math.abs(ay1 - ay0) / 2000, rot, z0 / 1000, z1 / 1000, 'fascia');
  };
  const uv = (u, v) => [u / 1000, v / 1000];
  if (type === 'flat') {
    const top = base + 150;
    builder.quad('roof', P(x0, y0, top), P(x1, y0, top), P(x1, y1, top), P(x0, y1, top), [uv(0, 0), uv(W, 0), uv(W, D), uv(0, D)], [0, 1, 0]);
    if (roof.noParapet) return builder; // concrete panel walls carry their own parapet
    const t = 150;
    const pz = base + 150 + 450;
    for (const [ax0, ay0, ax1, ay1] of [[x0 - t, y0 - t, x1 + t, y0], [x0 - t, y1, x1 + t, y1 + t], [x0 - t, y0, x0, y1], [x1, y0, x1 + t, y1]]) {
      const c = toWorld(place, { x: (ax0 + ax1) / 2, y: (ay0 + ay1) / 2 });
      addOrientedBox(builder, c.x / 1000, c.y / 1000, Math.abs(ax1 - ax0) / 2000, Math.abs(ay1 - ay0) / 2000, rot, (base - 100) / 1000, pz / 1000, { pu: 'gable', nu: 'gable', pv: 'gable', nv: 'gable', py: 'fascia', ny: null });
    }
    return builder;
  }
  if (type === 'gable') {
    const ridgeY = (roof.ridge || (W >= D ? 'x' : 'y')) === 'y'; // ridge along local y: the slopes fall to the left and right
    // Work in (u across, v along): u runs across the span, v along the ridge.
    const U0 = ridgeY ? x0 : y0; const U1 = ridgeY ? x1 : y1;
    const V0 = ridgeY ? y0 : x0; const V1 = ridgeY ? y1 : x1;
    const L = (u, v, h) => (ridgeY ? P(u, v, h) : P(v, u, h));
    const Ln = (du, dv, hz = 0) => (ridgeY ? N(du, dv, hz) : N(dv, du, hz));
    const span = U1 - U0;
    const um = (U0 + U1) / 2;
    const hr = base + (span / 2) * tan;
    const eU0 = U0 - o; const eU1 = U1 + o; const eV0 = V0 - o; const eV1 = V1 + o;
    const hEave = base - o * tan;
    builder.quad('roof', L(eU0, eV0, hEave), L(um, eV0, hr), L(um, eV1, hr), L(eU0, eV1, hEave), [uv(0, 0), uv(span, 0), uv(span, V1 - V0), uv(0, V1 - V0)], [0, 1, 0]);
    builder.quad('roof', L(eU1, eV0, hEave), L(um, eV0, hr), L(um, eV1, hr), L(eU1, eV1, hEave), [uv(0, 0), uv(span, 0), uv(span, V1 - V0), uv(0, V1 - V0)], [0, 1, 0]);
    for (const [v, sg] of [[V0, -1], [V1, 1]]) {
      const tri = [L(U0, v, base), L(U1, v, base), L(um, v, hr)];
      builder.poly('gable', tri, [uv(U0, base), uv(U1, base), uv(um, hr)], Ln(0, sg));
    }
    const f = (u0, u1) => (ridgeY ? fbox(Math.min(u0, u1), eV0, Math.max(u0, u1), eV1, hEave - 170, hEave + 30) : fbox(eV0, Math.min(u0, u1), eV1, Math.max(u0, u1), hEave - 170, hEave + 30));
    f(eU0 - 30, eU0);
    f(eU1, eU1 + 30);
    // gutters outside the fascia, soffits under the overhang and a ridge cap
    const g = (u0, u1) => (ridgeY ? fbox(Math.min(u0, u1), eV0, Math.max(u0, u1), eV1, hEave - 170, hEave - 60) : fbox(eV0, Math.min(u0, u1), eV1, Math.max(u0, u1), hEave - 170, hEave - 60));
    g(eU0 - 110, eU0 - 30);
    g(eU1 + 30, eU1 + 110);
    if (o > 120) { f(eU0, U0); f(U1, eU1); }
    if (ridgeY) fbox(um - 110, eV0, um + 110, eV1, hr - 30, hr + 70); else fbox(eV0, um - 110, eV1, um + 110, hr - 30, hr + 70);
    return builder;
  }
  // skillion: u runs from the high edge (0) to the low edge (U), v along the eave.
  const fall = roof.fall || 'rear';
  const horizontal = fall === 'left' || fall === 'right';
  const U = horizontal ? W : D;
  const V = horizontal ? D : W;
  const rise = U * tan;
  const M = (u, v) => {
    if (fall === 'rear') return { x: x0 + v, y: y0 + u };
    if (fall === 'front') return { x: x0 + v, y: y1 - u };
    if (fall === 'right') return { x: x0 + u, y: y0 + v };
    return { x: x1 - u, y: y0 + v };
  };
  const S = (u, v, h) => { const m = M(u, v); return P(m.x, m.y, h); };
  const dirU = (() => { const a = M(0, 0); const c = M(1, 0); return { x: c.x - a.x, y: c.y - a.y }; })();
  const dirV = (() => { const a = M(0, 0); const c = M(0, 1); return { x: c.x - a.x, y: c.y - a.y }; })();
  const hAt = (u) => base + (U - u) * tan;
  builder.quad('roof', S(0, -o, hAt(0)), S(0, V + o, hAt(0)), S(U + o, V + o, hAt(U + o)), S(U + o, -o, hAt(U + o)), [uv(0, 0), uv(V, 0), uv(V, U), uv(0, U)], [0, 1, 0]);
  builder.quad('gable', S(0, 0, base), S(0, V, base), S(0, V, base + rise), S(0, 0, base + rise), [uv(0, 0), uv(V, 0), uv(V, rise), uv(0, rise)], N(-dirU.x, -dirU.y));
  for (const [v, sg] of [[0, -1], [V, 1]]) builder.poly('gable', [S(0, v, base), S(U, v, base), S(0, v, base + rise)], [uv(0, base), uv(U, base), uv(0, base + rise)], N(sg * dirV.x, sg * dirV.y));
  const lowU = U + o;
  const cLow = M(lowU, V / 2);
  const along = Math.abs(dirU.x) > 0.5; // eave runs along y when the fall is horizontal
  if (along) fbox(cLow.x, y0 - o, cLow.x + (dirU.x > 0 ? 30 : -30), y1 + o, hAt(lowU) - 170, hAt(lowU) + 30);
  else fbox(x0 - o, cLow.y, x1 + o, cLow.y + (dirU.y > 0 ? 30 : -30), hAt(lowU) - 170, hAt(lowU) + 30);
  // gutter outside the low fascia
  if (along) fbox(cLow.x + (dirU.x > 0 ? 30 : -110), y0 - o, cLow.x + (dirU.x > 0 ? 110 : -30), y1 + o, hAt(lowU) - 170, hAt(lowU) - 60);
  else fbox(x0 - o, cLow.y + (dirU.y > 0 ? 30 : -110), x1 + o, cLow.y + (dirU.y > 0 ? 110 : -30), hAt(lowU) - 170, hAt(lowU) - 60);
  return builder;
}

/** Roof descriptors with their wall top height resolved: [{ roof, baseMm }]. */
export function resolveRoofs(b, project) {
  const r = runBuilding(b, project);
  const levels = [...r.levels].sort((a, c) => (a.elevationMm || 0) - (c.elevationMm || 0));
  const top = levels.length ? levels[levels.length - 1] : { name: 'Ground', elevationMm: 0 };
  return r.roofs.map((roof) => {
    const name = roof.level || top.name || 'Ground';
    const lv = levels.find((l) => l.name === name) || { name, elevationMm: 0, heightMm: 3000 };
    const wallTops = r.walls.filter((w) => (w.level || 'Ground') === name && Number.isFinite(w.height)).map((w) => w.height);
    const h = Number.isFinite(roof.baseMm) ? roof.baseMm - (lv.elevationMm || 0) : wallTops.length ? Math.max(...wallTops) : lv.heightMm || 3000;
    return { roof, baseMm: (lv.elevationMm || 0) + h };
  });
}

// Extras --------------------------------------------------------------------------------------------------------------------
const CONCRETE_KINDS = ['apron', 'yard', 'hardstand', 'forecourt', 'display-yard', 'dock-apron', 'weighbridge'];
const ASPHALT_KINDS = ['service-lane', 'bypass-lane', 'queue-lane', 'drop-off-bays', 'bay'];

function genericExtras(b, builder, { showRoof = true } = {}) {
  const place = b.place;
  for (const e of b.extras) {
    const slot = CONCRETE_KINDS.includes(e.kind) ? 'concrete|#c9c7c0' : ASPHALT_KINDS.includes(e.kind) ? 'asphalt' : e.kind === 'dock-recess' ? 'concrete|#a9a69d' : null;
    if (slot) addFloorPoly(builder, slot, e.polygon, e.kind === 'dock-recess' ? 0.035 : 0.03, true);
    if (showRoof && Number.isFinite(e.heightMm) && ['canopy', 'awning', 'fuel-canopy', 'truck-canopy'].includes(e.kind)) {
      const loc = e.polygon.map((q) => toLocal(place, q));
      const bb = bboxOf(loc);
      const t = e.thicknessMm || 250;
      const c = toWorld(place, { x: (bb.minX + bb.maxX) / 2, y: (bb.minY + bb.maxY) / 2 });
      addOrientedBox(builder, c.x / 1000, c.y / 1000, (bb.maxX - bb.minX) / 2000, (bb.maxY - bb.minY) / 2000, (place.rotationDeg || 0) * RAD, e.heightMm / 1000, (e.heightMm + t) / 1000, { py: 'canopy', ny: 'canopy', pu: 'canopy', nu: 'canopy', pv: 'canopy', nv: 'canopy' });
      if (e.posts !== false) {
        const xs = [bb.minX + 200, bb.maxX - 200];
        const n = Math.max(0, Math.floor((bb.maxX - bb.minX) / 8000));
        for (let i = 1; i <= n; i++) xs.push(bb.minX + ((bb.maxX - bb.minX) * i) / (n + 1));
        const yOut = Math.min(bb.minY, bb.maxY) + 200;
        for (const x of xs) {
          const pc = toWorld(place, { x, y: yOut });
          addOrientedBox(builder, pc.x / 1000, pc.y / 1000, 0.1, 0.1, (place.rotationDeg || 0) * RAD, 0, e.heightMm / 1000, 'steel');
        }
      }
    }
  }
}

/** Run a type's view3d and put its output in the builder (supports both conventions). */
function typeExtras(b, project, builder, showRoof = true) {
  const c3 = extrasCtx(b);
  let res = null;
  try { res = b.def.view3d?.(b.params, { ...c3, project, showRoof }); } catch { res = null; }
  if (res && typeof res.build === 'function' && !res.builder) { try { res.builder = res.build(c3.helpers); } catch { /* the type draws nothing */ } }
  builder.append(c3.builder);
  if (res?.builder && res.builder !== c3.builder) builder.append(res.builder);
}

/** Add every catalogue building's roofs and extras to the model group. ctx is the build ctx of build.js. */
/** Bay rows of a building on the ground: asphalt for the aisle and bays, white side lines, blue accessible bays and shared zones. */
function bays3D(rows, builder) {
  const thin = (p, q, w) => {
    const dx = q.x - p.x; const dy = q.y - p.y; const L = Math.hypot(dx, dy) || 1;
    const nx = (-dy / L) * (w / 2); const ny = (dx / L) * (w / 2);
    return [{ x: p.x + nx, y: p.y + ny }, { x: q.x + nx, y: q.y + ny }, { x: q.x - nx, y: q.y - ny }, { x: p.x - nx, y: p.y - ny }];
  };
  rows.forEach((r) => {
    const sl = r.slots;
    if (!sl.length) return;
    const a = sl[0].poly; const z = sl[sl.length - 1].poly;
    addFloorPoly(builder, 'asphalt', [a[0], z[1], z[2], a[3]], 0.024, true);
    if (r.rowId.endsWith(':0')) {
      const v = r.frame.v;
      const off = r.offsetMm;
      const ext = (p) => ({ x: p.x + v.x * off, y: p.y + v.y * off });
      addFloorPoly(builder, 'asphalt', [ext(a[0]), ext(z[1]), z[1], a[0]], 0.024, true);
    }
    // Side lines are shared between neighbours (drawn once); the line across the far end is drawn along the whole row once, not boxed per bay.
    const seen = new Set();
    const key = (q) => `${Math.round(q.x / 20)},${Math.round(q.y / 20)}`;
    const line = (q0, q1) => { const k = [key(q0), key(q1)].sort().join('|'); if (seen.has(k)) return; seen.add(k); addFloorPoly(builder, 'marking', thin(q0, q1, 100), 0.04, true); };
    for (const s of sl) {
      const p = s.poly;
      if (s.kind === 'accessible') addFloorPoly(builder, 'accessible', p, 0.034, true);
      else if (s.kind === 'zone') addFloorPoly(builder, 'zone', p, 0.034, true);
      line(p[0], p[3]); line(p[1], p[2]);
      if (s.kind !== 'zone') line(p[3], p[2]);
    }
  });
}

/** Carports over the bay rows: one continuous flat canopy per row (neighbouring canopies touch) on posts along the closed edge. */
function carports3D(list, builder) {
  for (const cp of list) {
    const p = cp.polygon;
    const hu = Math.hypot(p[1].x - p[0].x, p[1].y - p[0].y) / 2000; const hv = Math.hypot(p[3].x - p[0].x, p[3].y - p[0].y) / 2000;
    const ang = Math.atan2(p[1].y - p[0].y, p[1].x - p[0].x);
    const cx = (p[0].x + p[2].x) / 2000; const cz = (p[0].y + p[2].y) / 2000;
    const h = (cp.heightMm || 2700) / 1000;
    addOrientedBox(builder, cx, cz, hu, hv, ang, h - 0.18, h, { py: 'canopy', ny: 'steel', pu: 'steel', nu: 'steel', pv: 'steel', nv: 'steel' });
    for (const q of cp.posts || []) addOrientedBox(builder, q.x / 1000, q.y / 1000, 0.06, 0.06, ang, 0, h - 0.18, 'steel');
  }
}

export function addCatalogue3D(ctx, root, project, { showRoof = true } = {}) {
  const c = project.commercial;
  if (!c?.buildings?.length || project.mode !== 'commercial') return 0;
  const lib = ctx.lib;
  let n = 0;
  const parkingRows = buildingParking(c).rows;
  // Concrete walls with a parapet hide the roof: it is drawn as a flat concealed roof inside the parapet (the walls draw the parapet).
  const parapetOf = new Map();
  for (const l of project.levels || []) for (const w of l.walls || []) if (w.building && w.panel && w.panel.parapetMm > 0 && !parapetOf.has(w.building)) parapetOf.set(w.building, w.panel.parapetMm);
  for (const b of buildingsOf(c)) {
    // Roofs: wall material for gable ends, roof sheet and fascia as the project finishes.
    const rb = new GeoBuilder();
    // Roof off: no roof sheet, so the building (and its mezzanine floor) can be seen into.
    if (showRoof) for (const { roof, baseMm } of resolveRoofs(b, project)) roofGeometry(b, parapetOf.has(b.id) ? { ...roof, type: 'flat', noParapet: true } : roof, { baseMm }, rb);
    const res = showRoof ? rb.build() : null;
    if (res) {
      // A shed with its own cladding colour carries it on the gable infill too (the walls carry it as w.finish).
      const own = b.def.wallFinish ? b.def.wallFinish(b.params) : null;
      const ext = own ? { ...ctx.fin.externalWalls, material: own.material, colour: own.colour } : ctx.fin.externalWalls;
      const mats = { roof: lib.get(ctx.fin.roof.material || 'corrugated', ctx.hex(ctx.fin.roof.colour), { side: 'double' }), fascia: lib.plain(ctx.hex(ctx.fin.fascia.colour), { rough: 0.5, metal: 0.3 }), gable: lib.get(ext.material || 'paint', ctx.hex(ext.colour)) };
      const mesh = makeMesh(res, mats, { kind: 'roof', id: `${b.id}:roof`, levelId: project.levels[0]?.id, building: b.id }, { name: `roof:${b.id}`, cast: !ctx.walk });
      if (mesh) { root.add(mesh); n += 1; }
    }
    const eb = new GeoBuilder();
    genericExtras(b, eb, { showRoof });
    bays3D(parkingRows.filter((r) => r.buildingId === b.id), eb);
    typeExtras(b, project, eb, showRoof);
    const em = meshFromBuilder(ctx, eb, `extras:${b.id}`, { building: b.id });
    if (em) { root.add(em); n += 1; }
  }
  const swc = siteWorksOf(c)?.carports || [];
  if (swc.length) {
    const cb = new GeoBuilder();
    carports3D(swc, cb);
    const cm = meshFromBuilder(ctx, cb, 'carports', {});
    if (cm) { root.add(cm); n += 1; }
  }
  return n;
}
