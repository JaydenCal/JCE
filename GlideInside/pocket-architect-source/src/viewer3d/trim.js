// Building trim: the details that stop a 3D building reading as a plain box. One merged mesh per building set (a handful of material
// groups), no textures, no per-rib meshes (the cladding ribs are a texture). No DOM.
//   commercial: a precast base course under metal cladding, downpipes, awnings over personnel doors, a hood and jamb surround on roller
//               doors, window sills and a signage panel on the street frontage
//   residential: a front entry porch with posts, downpipes, window sills
// Windows stay flat and clean: nothing here touches glass. Everything is built to the outside of the wall face.

import * as G from '../model/geometry.js';
import { GeoBuilder, addOrientedBox } from './mesh-builder.js';
import { makeMesh } from './model-util.js';

const SLOTS = ['base', 'cap', 'pipe', 'awning', 'post', 'sill', 'sign', 'signbar', 'logo', 'slab', 'hood'];

/** Street direction (unit, plan mm): from the lot centroid to the middle of its first front edge. Null without a lot or frontage. */
function streetDir(project) {
  const lot = project.site?.lot;
  const b = lot?.boundary;
  const e = lot?.frontEdges?.[0];
  if (!b || b.length < 3 || !Number.isInteger(e) || e < 0 || e >= b.length) return null;
  const c = G.polygonCentroid(b);
  const mid = G.lerp(b[e], b[(e + 1) % b.length], 0.5);
  const d = G.sub(mid, c);
  const l = Math.hypot(d.x, d.y);
  return l > 1 ? { x: d.x / l, y: d.y / l } : null;
}

/** Free intervals [u0, u1] (m) along a wall of length L once the openings that reach below yMax (m above the wall base) are taken out. */
function freeIntervals(L, ops, yMaxMm, pad = 0.02) {
  const cuts = ops.filter((o) => (o.sill || 0) < yMaxMm).map((o) => [Math.max(0, (o.offset - o.width / 2) / 1000 - pad), Math.min(L, (o.offset + o.width / 2) / 1000 + pad)]).sort((p, q) => p[0] - q[0]);
  const out = [];
  let at = 0;
  for (const [c0, c1] of cuts) {
    if (c0 - at > 0.15) out.push([at, c0]);
    at = Math.max(at, c1);
  }
  if (L - at > 0.15) out.push([at, L]);
  return out;
}

/**
 * entries: [{ w, elev (m), H (m), outSide (+1 or -1), ops, li, ext }] for the exterior walls shown.
 * Returns nothing; adds up to one mesh named 'trim' to root.
 */
export function addBuildingTrim(ctx, root, entries, { detail = 'full' } = {}) {
  if (detail === 'low' || !entries.length) return;
  const { lib, hex, fin, project } = ctx;
  const commercial = project.mode === 'commercial';
  const b = new GeoBuilder();
  const fasciaHex = hex(fin.fascia.colour);
  const sd = streetDir(project);

  const box = (e, uc, hu, v0, v1, y0, y1, slot) => {
    if (hu < 0.004 || y1 - y0 < 0.004 || v1 - v0 < 0.002) return;
    const w = e.w;
    const d = G.wallDir(w);
    const n = { x: -d.y, y: d.x };
    const t = (w.thickness || 100) / 2000;
    const vc = e.outSide * (t + (v0 + v1) / 2);
    const cx = w.a.x / 1000 + d.x * uc + n.x * vc;
    const cz = w.a.y / 1000 + d.y * uc + n.y * vc;
    addOrientedBox(b, cx, cz, hu, (v1 - v0) / 2, Math.atan2(d.y, d.x), y0, y1, slot);
  };
  const outward = (e) => { const d = G.wallDir(e.w); return { x: -d.y * e.outSide, y: d.x * e.outSide }; };

  const pipeSeen = new Set();
  let porchDone = false;
  const ground = entries.filter((e) => e.li === 0);
  // The front door of a house: the personnel door whose wall faces the street best.
  let porchEntry = null;
  if (!commercial) {
    let best = -2;
    for (const e of ground) {
      if (e.w.bldg || G.wallLength(e.w) < 2400) continue;
      const o = e.ops.find((q) => q.kind === 'door');
      if (!o) continue;
      const out = outward(e);
      const s = sd ? out.x * sd.x + out.y * sd.y : 0;
      if (s > best) { best = s; porchEntry = { e, o }; }
    }
    if (best < (sd ? 0.2 : -2)) porchEntry = null;
  }
  const signed = new Set();

  for (const e of entries) {
    const { w, elev, H, ops } = e;
    const L = G.wallLength(w) / 1000;
    if (L < 0.5) continue;
    const isGround = e.li === 0;
    // Window sills: a pale ledge under every exterior window.
    for (const o of ops) {
      if (o.kind !== 'window') continue;
      const uc = o.offset / 1000;
      box(e, uc, o.width / 2000 + 0.04, 0, 0.07, elev + Math.max(0, o.sill / 1000) - 0.045, elev + Math.max(0, o.sill / 1000), 'sill');
    }
    if (!isGround) continue;

    // Base course: a precast concrete band at the foot of metal cladding, broken at the doors.
    if (commercial && !w.panel && H > 2.4) {
      const hb = Math.min(0.9, H * 0.24);
      for (const [u0, u1] of freeIntervals(L, ops, hb * 1000 - 20)) {
        box(e, (u0 + u1) / 2, (u1 - u0) / 2, 0, 0.035, elev, elev + hb, 'base');
        box(e, (u0 + u1) / 2, (u1 - u0) / 2, 0, 0.05, elev + hb, elev + hb + 0.05, 'cap');
      }
    }
    // Downpipes: near each end of a wall and every 12 m, kept clear of openings.
    if (!w.panel && H > 2.2 && L > 2.5) {
      const at = L > 4 ? [0.3, L - 0.3] : [L / 2];
      for (let u = 12; u < L - 4; u += 12) at.push(u);
      for (const u of at) {
        if (ops.some((o) => Math.abs(o.offset / 1000 - u) < o.width / 2000 + 0.2)) continue;
        const d = G.wallDir(w);
        const key = `${Math.round((w.a.x / 1000 + d.x * u) / 1.6)},${Math.round((w.a.y / 1000 + d.y * u) / 1.6)}`;
        if (pipeSeen.has(key)) continue;
        pipeSeen.add(key);
        box(e, u, 0.045, 0.012, 0.075, elev, elev + H - 0.12, 'pipe');
        box(e, u, 0.06, 0.012, 0.085, elev + H - 0.2, elev + H - 0.1, 'pipe'); // the head under the gutter
      }
    }
    for (const o of ops) {
      const uc = o.offset / 1000;
      const ow = o.width / 1000;
      const head = elev + (o.sill + o.height) / 1000;
      if (o.kind === 'roller_door' && commercial) {
        // Frame: a hood over the door and a jamb on each side, proud of the cladding.
        box(e, uc, ow / 2 + 0.16, 0, 0.16, head - 0.02, head + 0.34, 'hood');
        box(e, uc - ow / 2 - 0.07, 0.07, 0, 0.1, elev, head, 'hood');
        box(e, uc + ow / 2 + 0.07, 0.07, 0, 0.1, elev, head, 'hood');
      } else if (o.kind === 'door' && (commercial || w.bldg)) {
        // Awning over a personnel door.
        const aw = ow + 0.8;
        box(e, uc, aw / 2, 0, 1.0, head + 0.2, head + 0.26, 'awning');
        box(e, uc, aw / 2, 0.96, 1.0, head + 0.12, head + 0.26, 'awning');
        for (const s of [-1, 1]) box(e, uc + s * (aw / 2 - 0.1), 0.02, 0, 0.9, head + 0.04, head + 0.2, 'awning');
      } else if (o.kind === 'door' && porchEntry && porchEntry.e === e && porchEntry.o === o && !porchDone) {
        porchDone = true;
        const pw = Math.min(Math.max(2.4, ow + 1.1), L - 0.2);
        const dep = 1.5;
        const rf = head + 0.32;
        box(e, uc, pw / 2, 0, dep, elev - 0.14, elev + 0.004, 'slab');
        box(e, uc, pw / 2 + 0.1, 0, dep + 0.2, rf, rf + 0.12, 'awning');
        box(e, uc, pw / 2 + 0.1, dep + 0.17, dep + 0.2, rf - 0.1, rf + 0.12, 'awning');
        for (const s of [-1, 1]) box(e, uc + s * (pw / 2 - 0.12), 0.06, dep - 0.2, dep - 0.08, elev + 0.004, rf, 'post');
      }
    }
    // Signage panel on a street facing front wall: a pale board with a colour stripe and a logo mark. No text, nothing blank-grey.
    if (commercial && H >= 3.2 && L >= 5) {
      const out = outward(e);
      const s = sd ? out.x * sd.x + out.y * sd.y : 0;
      const key = w.bldg || w.building || '_rows';
      const faces = sd ? s > 0.8 : !signed.has(key);
      if (faces && (!w.bldg || !signed.has(`${key}:${w.id}`))) {
        const y1 = elev + H - 0.55;
        const y0 = y1 - 1.0;
        search: for (const sw of [Math.min(5, L * 0.5), 3.2, 2.2]) {
          const cands = [];
          for (let uc = sw / 2 + 0.3; uc <= L - sw / 2 - 0.3; uc += 0.5) cands.push(uc);
          cands.sort((p, q) => Math.abs(p - L / 2) - Math.abs(q - L / 2));
          for (const uc of cands) {
            if (ops.some((o) => Math.abs(o.offset / 1000 - uc) < o.width / 2000 + sw / 2 + 0.1 && elev + (o.sill + o.height) / 1000 + 0.36 > y0)) continue;
            box(e, uc, sw / 2, 0, 0.06, y0, y1, 'sign');
            box(e, uc, sw / 2, 0, 0.075, y0, y0 + 0.16, 'signbar');
            box(e, uc - sw / 2 + 0.5, 0.25, 0, 0.075, y0 + 0.3, y1 - 0.14, 'logo');
            box(e, uc - sw / 2 + 0.55 + sw * 0.28, sw * 0.2, 0, 0.075, y0 + 0.42, y0 + 0.54, 'logo');
            box(e, uc - sw / 2 + 0.55 + sw * 0.24, sw * 0.16, 0, 0.075, y0 + 0.62, y0 + 0.72, 'logo');
            signed.add(key);
            break search;
          }
        }
      }
    }
  }
  const mats = {
    base: lib.plain('#a9a9a5', { rough: 0.92 }), cap: lib.plain('#6d7073', { rough: 0.9 }), pipe: lib.plain('#cfd2d3', { rough: 0.5, metal: 0.25 }),
    awning: lib.plain('#c4c8ca', { rough: 0.5, metal: 0.3 }), hood: lib.plain(fasciaHex, { rough: 0.55, metal: 0.2 }), post: lib.plain('#f1f0eb', { rough: 0.7 }),
    sill: lib.plain('#e8e7e2', { rough: 0.8 }), sign: lib.plain('#eceeee', { rough: 0.8 }), signbar: lib.plain(fasciaHex, { rough: 0.6 }), logo: lib.plain('#2d3b4b', { rough: 0.7 }),
    slab: lib.plain('#bcbbb6', { rough: 0.95 }),
  };
  const res = b.build(SLOTS);
  const mesh = makeMesh(res, mats, { decor: true }, { name: 'trim', cast: true });
  if (mesh) root.add(mesh);
}
