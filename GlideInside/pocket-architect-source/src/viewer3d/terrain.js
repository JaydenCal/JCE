// Site for the 3D model, built from site.lot whenever a lot is loaded (the elevation grid and the aerial are optional):
//   * terrain mesh over the full aerial extent (a clean rectangle), with the aerial draped on it,
//   * a level building pad at floor RL under the house with a short 1:3 batter to the natural ground,
//   * a ring beyond the terrain that fades to a neutral ground colour (no fog, no pale haze),
//   * the lot boundary (bold red), neighbouring lots (thin), the dashed setback envelope, the street frontage and optional contours,
//     all draped on the drawn surface, plus lot and DP labels as billboards.
// No DOM access except the label canvas, which is skipped when there is no document (tests).
//
// Heights: plan mm to metres is x / 1000 = X and y / 1000 = Z. A ground RL (metres) becomes
//   Y = RL - floorRL + groundFloorElevation
// so the ground floor sits at the project's floor RL (default: lot centroid RL + 0.15 m) and, with the default, the
// ground at the lot centre is exactly groundY = floor - SLAB.ground.

import * as THREE from 'three';
import { terrainAt, floorRLOf } from '../site/model.js';
import * as S from './site-geom.js';
import * as G from '../model/geometry.js';
import { addSiteExtras } from './site-extras.js';
import { addConstraintTint } from './site-constraints.js';
import { LAWN_COLOUR } from './site.js';
import { planGrading, earthworks, clusterPolys, clipHalf } from './grading.js';
import { deriveDriveway, roadReserve, ROAD_DEFAULTS } from '../site/lotplan.js';
import { getWays, wayGeometry } from '../site/pavedways.js';
import { rowPoly } from '../commercial/layout.js';
import { buildingsOf } from '../commercial/catalogue/buildings.js';
import { pavementModel } from '../commercial/catalogue/pavements/logic.js';
import { addCommercialPavements } from '../commercial/catalogue/pavements/view3d.js';
import { addCommercialEntourage, addForecourtSlabs } from '../commercial/catalogue/entourage3d.js';
import { SUBGRADE, ROAD_BURY } from './levels.js';
import { polyDistM } from './fds.js';

export { PAD_MARGIN_M } from './site-geom.js';

const GRASS = '#6f8a58';
const PADDOCK = '#a89a62'; // dry grass beyond the lots when there is no aerial
const GREY_GROUND = '#8b8e92'; // uploaded site with no aerial available: a plain grey ground
const GREY_HORIZON = '#a7aaae';
const HORIZON = '#9aa88a'; // the far edge of the ground ring: a neutral ground colour, not a pale haze towards the sky

// Footprint (plan mm bbox) of the lowest level: walls and rooms. null when there is nothing drawn.
export function footprintBox(project) {
  const level = [...project.levels].sort((a, b) => a.elevation - b.elevation)[0];
  if (!level) return null;
  const pts = [];
  for (const w of level.walls) pts.push(w.a, w.b);
  for (const r of level.rooms) pts.push(...r.polygon);
  if (!pts.length) return null;
  return {
    minX: Math.min(...pts.map((p) => p.x)), maxX: Math.max(...pts.map((p) => p.x)),
    minY: Math.min(...pts.map((p) => p.y)), maxY: Math.max(...pts.map((p) => p.y)),
  };
}

// The building footprints that need a pad: the residential footprint box, or the commercial building outlines and strata rows (plan mm rings).
export function padPolygons(project, fp) {
  let polys = [];
  if (project.mode === 'commercial' && project.commercial) {
    polys = buildingsOf(project.commercial).map((b) => b.outline);
    const rowsList = project.commercial.rows || [];
    for (const r of rowsList) { try { polys.push(rowPoly(r, rowsList)); } catch { /* a row with no geometry has no pad */ } }
  } else if (fp) polys = [[{ x: fp.minX, y: fp.minY }, { x: fp.maxX, y: fp.minY }, { x: fp.maxX, y: fp.maxY }, { x: fp.minX, y: fp.maxY }]];
  return polys.filter((q) => Array.isArray(q) && q.length >= 3);
}

// Mean of a ground function (x, y) -> value over the interior of the polygons. null when none.
function meanOver(polys, at) {
  let sum = 0; let n = 0;
  for (const poly of polys) {
    const xs = poly.map((q) => q.x); const ys = poly.map((q) => q.y);
    const x0 = Math.min(...xs); const x1 = Math.max(...xs); const y0 = Math.min(...ys); const y1 = Math.max(...ys);
    const step = Math.max(500, Math.max(x1 - x0, y1 - y0) / 24);
    for (let x = x0 + step / 2; x < x1; x += step) for (let y = y0 + step / 2; y < y1; y += step) {
      if (!G.pointInPolygon({ x, y }, poly)) continue;
      const v = at(x, y);
      if (v != null) { sum += v; n++; }
    }
  }
  return n ? sum / n : null;
}

// Mean natural ground RL under the building pads. null when none.
export function meanPadRL(project, lot, fp) {
  return meanOver(padPolygons(project, fp), (x, y) => S.terrainAtClamped(lot.terrain, x, y));
}

const PAD_STEP_M = 0.05; // a pad level is a whole 50 mm
const PAD_GAP_MM = 1000; // footprints closer than this share one pad (a U shaped row, a building and its attached canopy)

/**
 * The building pads: footprints that touch share one flat pad, each group at the mean natural ground under it rounded to 50 mm, so separate
 * buildings (and separate rows) sit at their own level on a slope. [{ id, polys, y, dy }] where y is the model height of the pad and dy its
 * difference from the project pad level (the buildings are moved by dy, see applyPadShifts).
 */
export function padGroups(polys, rawY, padY, overrides = null, userSteps = null) {
  if (!polys.length) return [];
  const groups = polys.length > 1 ? clusterPolys(polys, PAD_GAP_MM) : [polys];
  return groups.map((g, i) => {
    const mean = meanOver(g, rawY);
    const dyAuto = mean == null ? 0 : Math.round((mean - padY) / PAD_STEP_M) * PAD_STEP_M;
    const ov = overrides ? overrides(g, i) : null;
    const base = Number.isFinite(ov) ? ov : dyAuto;
    const us = userSteps ? userSteps(g, i) : null; // metres added to the automatic level by the person
    const dy = base + (Number.isFinite(us) ? Math.round(us / PAD_STEP_M) * PAD_STEP_M : 0);
    return { id: `pad:${i}`, polys: g, y: padY + dy, dy, dyAuto: base };
  });
}

/**
 * Where a driveway crosses the verge: the part of a paved ring beyond the property line as a rectangle running to the kerb face, so the
 * crossover is a ramp from the layback at the kerb to the verge level at the property line (fds.js). null when the ring stays off the verge.
 */
export function crossoverRing(poly, rv) {
  const a = rv.lines.property[0]; const out = rv.outward; const u = rv.u; const tk = rv.vergeM;
  const T = (q) => ((q.x - a.x) * out.x + (q.y - a.y) * out.y) / 1000;
  const ts = poly.map(T);
  if (!(Math.max(...ts) > 0.3 && Math.min(...ts) < tk - 0.3)) return null;
  const part = clipHalf(poly, a, { x: -out.x, y: -out.y }); // t >= 0
  if (part.length < 3) return null;
  const ss = part.map((q) => ((q.x - a.x) * u.x + (q.y - a.y) * u.y) / 1000);
  const s0 = Math.min(...ss); const s1 = Math.max(...ss);
  if (!(s1 - s0 > 0.3)) return null;
  const pt = (s, t) => ({ x: a.x + (u.x * s + out.x * t) * 1000, y: a.y + (u.y * s + out.y * t) * 1000 });
  return [pt(s0, 0), pt(s1, 0), pt(s1, tk), pt(s0, tk)];
}

/** A paved ring that stops short of the kerb across the verge is run on to the kerb face (3D only). The ring itself when it does not reach the verge. */
export function extendToKerb(poly, rv) {
  const a = rv.lines.property[0]; const out = rv.outward; const tk = rv.vergeM;
  const T = (q) => ((q.x - a.x) * out.x + (q.y - a.y) * out.y) / 1000;
  const ts = poly.map(T); const tmax = Math.max(...ts);
  if (!(tmax > 0.3 && Math.min(...ts) < tk - 0.3) || tmax >= tk - 0.02 || tmax < tk - 3) return poly;
  return poly.map((q, i) => (ts[i] >= tmax - 0.01 ? { x: q.x + out.x * (tk - ts[i]) * 1000, y: q.y + out.y * (tk - ts[i]) * 1000 } : q));
}

/**
 * terrainModel(project) -> { heightAt(xMm, yMm) -> Y metres, floorRL, base, padY, fds, pads, pavements } | null (no lot)
 * Defined everywhere (clamped to the elevation grid, flat at slab level when there is no grid), so the mesh never has a hole.
 * Pure: also used by tests. heightAt is the finished design surface (fds.js) when there is a terrain grid.
 */
export function terrainModel(project, opts = {}) {
  const lot = project.site?.lot;
  if (!lot) return null;
  let floorRL = floorRLOf(lot);
  const lowest = [...project.levels].sort((a, b) => a.elevation - b.elevation)[0];
  const base = (lowest ? lowest.elevation : 0) / 1000;
  const fp = footprintBox(project);
  const padY = base - 0.15; // SLAB.ground: the flat pad is the ground at slab level
  // The floor level is the mean of the natural ground under the pad (not the lot centre) unless the person set a floor RL.
  if (lot.terrain && !Number.isFinite(lot.floorRL)) {
    const mean = meanPadRL(project, lot, fp);
    if (mean != null) floorRL = mean + 0.15;
  }
  const rawY = (x, y) => {
    if (!lot.terrain) return padY;
    const rl = S.terrainAtClamped(lot.terrain, x, y);
    return rl == null ? padY : rl - floorRL + base;
  };
  const commercial = project.mode === 'commercial' && !!project.commercial;
  // The pavement model once per build (the 3D pavements, the extras and the grading all read it).
  let pavements = opts.pavements || null;
  if (commercial && !pavements) { try { pavements = pavementModel(project.commercial, lot); } catch { pavements = null; } }
  let pads = [];
  let crossoverRings = [];
  let grading = null;
  let reserves = [];
  if (S.layerOn(lot, 'road')) reserves = roadReserve(lot, { extendM: 60 });
  let pavements3d = pavements;
  // Auto grading: paving and driveways sit on gently graded design planes and the mesh is flattened under them (only with a terrain grid).
  if (lot.terrain) {
    try {
      // A house pad is raised towards the street where the drive would otherwise be steep: the drive aims at about 12 percent, the raise is at
      // most 0.6 m and a whole 50 mm. The natural ground at the street end plus the verge rise stands for the verge level at the property line.
      let driveRaise = null;
      if (!commercial && fp) {
        const dw0 = deriveDriveway(project);
        if (dw0?.ok && dw0.centre?.length >= 2) {
          const o = dw0.centre[0]; const e = dw0.centre[dw0.centre.length - 1];
          const dA = S.distToBox(fp, o.x, o.y); const dB = S.distToBox(fp, e.x, e.y);
          const [h, st] = dA <= dB ? [o, e] : [e, o];
          const run = Math.max(1, Math.hypot(st.x - h.x, st.y - h.y) / 1000);
          const need = rawY(st.x, st.y) + 0.25 - 0.12 * run - padY;
          if (need > 0.05) driveRaise = Math.min(0.6, Math.round(need / PAD_STEP_M) * PAD_STEP_M);
        }
      }
      // The person's grading controls (project.site.grading): a pad raised or lowered in whole 50 mm steps from the automatic level, and the batter.
      const gr = project.site?.grading || {};
      const userPad = (g, i) => { const n = Number(gr.pads?.[`pad:${i}`]); return Number.isFinite(n) && n !== 0 ? n : null; };
      const autoPad = opts.padOverride || (driveRaise ? (g, i) => (i === 0 ? driveRaise : null) : null);
      pads = padGroups(padPolygons(project, fp), rawY, padY, autoPad, userPad);
      const paving = []; const crossovers = [];
      const driveways = [];
      if (commercial && pavements) {
        const areas = pavements.areas.map((a) => {
          let poly = a.polygon;
          for (const rv of reserves) { const ring = crossoverRing(poly, rv); if (ring) { poly = extendToKerb(poly, rv); crossovers.push(crossoverRing(poly, rv) || ring); } }
          return poly === a.polygon ? a : { ...a, polygon: poly };
        });
        for (const a of areas) paving.push(a.polygon);
        pavements3d = { ...pavements, areas };
      } else if (!commercial) {
        const ways = [];
        if (fp) {
          const dw = deriveDriveway(project);
          if (dw?.ok && dw.polygon?.length >= 3 && dw.centre?.length >= 2) {
            const o = dw.centre[0]; const e = dw.centre[dw.centre.length - 1];
            const l = Math.hypot(e.x - o.x, e.y - o.y) || 1;
            // the house end is the centre end nearer the footprint
            const dA = S.distToBox(fp, o.x, o.y); const dB = S.distToBox(fp, e.x, e.y);
            const [h, st] = dA <= dB ? [o, e] : [e, o];
            driveways.push({ polys: [dw.polygon, ...(dw.extraPolygons || [])], dir: { o: h, u: { x: (st.x - h.x) / l, y: (st.y - h.y) / l } } });
            if (dw.crossover?.polygon?.length > 3) for (const rv of reserves) { const ring = crossoverRing(dw.crossover.polygon, rv); if (ring) crossovers.push(ring); }
            ways.push(dw.wayId);
          }
        }
        // Roads and driveways drawn with the Driveway and road tool, beyond the derived driveway: paved planes of their own.
        for (const way of getWays(project)) {
          if (ways.includes(way.id)) continue;
          const g = wayGeometry(project, way);
          for (const pc of g.pieces) {
            if (pc.role === 'crossover') { for (const rv of reserves) { const ring = crossoverRing(pc.ring, rv); if (ring) crossovers.push(ring); } } else paving.push(pc.ring);
          }
        }
      }
      // The road reserve (property line to far kerb) is the existing road: held, with its kerb, gutter and verge cross section.
      const corridors = [];
      for (const r of reserves) {
        const L = r.lines; const outq = r.outward;
        const p0 = { x: L.footpathNear[0].x - outq.x * ROAD_DEFAULTS.footpathNearM * 1000, y: L.footpathNear[0].y - outq.y * ROAD_DEFAULTS.footpathNearM * 1000 };
        const p1 = { x: L.footpathNear[1].x - outq.x * ROAD_DEFAULTS.footpathNearM * 1000, y: L.footpathNear[1].y - outq.y * ROAD_DEFAULTS.footpathNearM * 1000 };
        corridors.push({ poly: [p0, p1, L.farKerb[1], L.farKerb[0]].map((q) => ({ x: q.x, y: q.y })), u: r.u, outward: outq, meta: { vergeM: r.vergeM, gutterM: r.gutterM, carriagewayM: r.carriagewayM } });
      }
      crossoverRings = crossovers;
      grading = planGrading({ rawAt: rawY, padY, fp, pads: pads.flatMap((g) => g.polys.map((q, k) => ({ id: `${g.id}:${k}`, poly: q, y: g.y }))), paving, driveways, corridors, crossovers, cellM: opts.cellM || 0.75, lot: lot.boundary?.length > 2 ? lot.boundary : null, batterRun: project.site?.grading?.batter === 4 ? 4 : 3 });
    } catch (e) {
      console.warn('[viewer3d] auto grading skipped', e);
    }
  }
  const heightAt = (x, y) => {
    const raw = rawY(x, y);
    if (grading) return grading.heightAt(x, y, raw);
    if (!fp) return raw;
    return S.padHeight(raw, padY, S.distToBox(fp, x, y));
  };
  return { heightAt, rawAt: rawY, grading, fds: grading?.fds || null, floorRL, base, padY, pads, pavements: pavements3d, reserves, crossovers: crossoverRings };
}

/**
 * The terrain mesh node at a plan point: { design, mesh }. The mesh sits just under every design element (the exact surfaces are drawn on top,
 * see levels.js) and well under the road corridor; elsewhere it is the design surface (natural ground, shoulders and batters).
 */
export function nodeHeights(tm, x, y, cellM) {
  const r = tm.fds ? tm.fds.levelAt(x, y) : null;
  const design = r ? r.y : tm.heightAt(x, y);
  let mesh = design;
  if (r && r.id) {
    mesh = design - SUBGRADE;
    if (r.kind === 'road') { const f = Math.min(1, Math.max(0, (tm.fds.depthAt(x, y) - cellM) / cellM)); mesh -= ROAD_BURY * f * f * (3 - 2 * f); }
  }
  return { design, mesh };
}

/**
 * Retaining edges: where the design inside the lot boundary does not meet the natural ground at the boundary (a batter does not fit), the step
 * is a retaining edge. Sampled every metre along the boundary: [{ x, y, hi, lo, h }] (plan mm; hi and lo are the two levels in metres) where
 * the step is over 50 mm, plus { maxM, lengthM }. The road frontage is not a retaining edge (the road is held).
 */
export function retainingEdges(tm, lot, minM = 0.05) {
  const out = { samples: [], maxM: 0, lengthM: 0 };
  if (!tm?.fds || !lot?.boundary || lot.boundary.length < 3) return out;
  const ring = lot.boundary;
  const road = tm.fds.elements.filter((e) => e.road || e.kind === 'crossover');
  const onRoad = (q) => road.some((e) => G.pointInPolygon(q, e.polys[0]) || polyDistM(q, e.polys[0], G.bbox(e.polys[0])).d < 0.6);
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]; const b = ring[(i + 1) % ring.length];
    const L = Math.hypot(b.x - a.x, b.y - a.y); if (L < 1) continue;
    let nx = (b.y - a.y) / L; let ny = -(b.x - a.x) / L;
    if (!G.pointInPolygon({ x: (a.x + b.x) / 2 - nx * 100, y: (a.y + b.y) / 2 - ny * 100 }, ring)) { nx = -nx; ny = -ny; } // n points out of the lot
    for (let s = 500; s < L; s += 1000) {
      const q = { x: a.x + ((b.x - a.x) * Math.min(s, L)) / L, y: a.y + ((b.y - a.y) * Math.min(s, L)) / L };
      if (onRoad(q)) continue;
      const hi = tm.heightAt(q.x - nx * 60, q.y - ny * 60); const lo = tm.heightAt(q.x + nx * 60, q.y + ny * 60);
      const h = Math.abs(hi - lo);
      if (h > minM) { out.samples.push({ x: q.x, y: q.y, nx, ny, a: hi, b: lo, h }); out.lengthM += 1; if (h > out.maxM) out.maxM = h; }
    }
  }
  return out;
}

/**
 * Move each building to its pad: every vertex of the building meshes within reach of a pad group is raised by that pad's dy (so a building
 * on a slope sits on its own level, not the project's). Only meshes that are not ground; call before the ground is added. Returns the count.
 */
export function applyPadShifts(root, pads, margin = 1.6) {
  const moved = pads.filter((g) => Math.abs(g.dy) > 1e-6);
  if (!moved.length) return 0;
  const boxes = moved.map((g) => g.polys.map((p) => { const b = G.bbox(p); return { b, p }; }));
  const v = new THREE.Vector3();
  let n = 0;
  const m = margin * 1000;
  const dist = (pt, p, b) => {
    const dx = Math.max(b.minX - pt.x, 0, pt.x - b.maxX); const dy = Math.max(b.minY - pt.y, 0, pt.y - b.maxY);
    if (Math.hypot(dx, dy) > m) return Infinity;
    if (G.pointInPolygon(pt, p)) return 0;
    let best = Infinity;
    for (let i = 0; i < p.length; i++) { const a = p[i]; const c = p[(i + 1) % p.length]; const e = G.projectToSegment(pt, a, c).d; if (e < best) best = e; }
    return best;
  };
  root.updateWorldMatrix(true, true);
  root.traverse((o) => {
    if (!o.isMesh || o.userData?.ground || o.userData?.siteTerrain) return;
    const geo = o.geometry; const posA = geo?.attributes?.position;
    if (!posA) return;
    o.updateWorldMatrix(true, false);
    const mw = o.matrixWorld;
    let changed = false;
    const cache = new Map();
    for (let i = 0; i < posA.count; i++) {
      v.fromBufferAttribute(posA, i).applyMatrix4(mw);
      const pt = { x: v.x * 1000, y: v.z * 1000 };
      const key = `${Math.round(pt.x / 20)}:${Math.round(pt.y / 20)}`;
      let dy = cache.get(key);
      if (dy === undefined) {
        let best = Infinity; dy = 0;
        moved.forEach((g, gi) => { for (const { b, p } of boxes[gi]) { const d = dist(pt, p, b); if (d < best) { best = d; dy = g.dy; } } });
        cache.set(key, dy);
      }
      if (dy) { posA.setY(i, posA.getY(i) + dy); changed = true; }
    }
    if (changed) { posA.needsUpdate = true; geo.computeBoundingBox(); geo.computeBoundingSphere(); n++; }
  });
  return n;
}

// Average colour of the border of an image-like source, as a hex string, or null. Browser only.
export function edgeColourOf(source, fallback = GRASS) {
  try {
    const w = source?.width;
    const h = source?.height;
    if (!w || !h || typeof document === 'undefined') return fallback;
    const c = document.createElement('canvas');
    c.width = 16;
    c.height = 16;
    const g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(source, 0, 0, 16, 16);
    const d = g.getImageData(0, 0, 16, 16).data;
    let r = 0;
    let gg = 0;
    let b = 0;
    let n = 0;
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) {
        if (x > 1 && y > 1 && x < 14 && y < 14) continue;
        const k = (y * 16 + x) * 4;
        r += d[k];
        gg += d[k + 1];
        b += d[k + 2];
        n++;
      }
    }
    return `#${[r, gg, b].map((v) => Math.round(v / n).toString(16).padStart(2, '0')).join('')}`;
  } catch {
    return fallback;
  }
}

function plainMat(color, extra = {}) {
  const m = new THREE.MeshBasicMaterial({ color, ...extra });
  m.userData.shared = false;
  return m;
}

function addLines(root, name, groups, { half, color, lift = 0, userData = {}, order = 2 }) {
  const positions = [];
  const indices = [];
  for (const g of groups) {
    const r = S.ribbonGeometry(g.pts, half, g.closed);
    const base = positions.length / 3;
    for (const p of r.positions) positions.push(p);
    for (const i of r.indices) indices.push(base + i);
  }
  if (!indices.length) return null;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  const mat = plainMat(color, { side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2 - order, polygonOffsetUnits: -2 - order });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = name;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.renderOrder = order;
  mesh.userData = { ground: true, ...userData };
  root.add(mesh);
  return mesh;
}

function labelSprite(lines, kind) {
  if (typeof document === 'undefined') return null;
  const strong = kind === 'lot';
  const size = strong ? 34 : 28;
  const pad = 14;
  const font = (s, w) => `${w} ${s}px Barlow, "Helvetica Neue", Arial, sans-serif`;
  const c = document.createElement('canvas');
  const g = c.getContext('2d');
  g.font = font(size, 700);
  const width = Math.ceil(Math.max(...lines.map((l) => g.measureText(l).width)) + pad * 2);
  const lh = size * 1.25;
  const height = Math.ceil(lines.length * lh + pad * 2);
  c.width = width;
  c.height = height;
  g.font = font(size, 700);
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineJoin = 'round';
  // A rounded label plate (a pill for one line, a rounded rectangle for more), white at about 76% so the ground shows through a
  // little; the text on it is drawn solid and crisp. Same size and place as before.
  const rad = Math.min(height / 2 - 1, lines.length > 1 ? 20 : height / 2);
  g.beginPath();
  g.moveTo(1 + rad, 1);
  g.arcTo(width - 1, 1, width - 1, height - 1, rad);
  g.arcTo(width - 1, height - 1, 1, height - 1, rad);
  g.arcTo(1, height - 1, 1, 1, rad);
  g.arcTo(1, 1, width - 1, 1, rad);
  g.closePath();
  g.fillStyle = 'rgba(255,255,255,0.76)';
  g.fill();
  g.lineWidth = 1.5;
  g.strokeStyle = strong ? 'rgba(166,27,27,0.55)' : 'rgba(58,63,51,0.35)';
  g.stroke();
  lines.forEach((l, i) => {
    const y = pad + lh * (i + 0.5);
    g.font = font(i === 0 ? size : size * 0.86, i === 0 ? 700 : 600);
    g.fillStyle = strong ? '#a61b1b' : '#3a3f33';
    g.fillText(l, width / 2, y);
  });
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: true, depthWrite: false, sizeAttenuation: false, toneMapped: false });
  mat.userData.shared = false;
  mat.userData.disposeMap = true;
  const sp = new THREE.Sprite(mat);
  // Size is a fraction of the view height (sizeAttenuation off), so a label stays readable at any zoom.
  sp.scale.y = (strong ? 0.021 : 0.016) * lines.length + 0.01;
  sp.scale.x = sp.scale.y * (width / height);
  sp.renderOrder = 20;
  return sp;
}

// Crisp aerial ground. An aerial picture is about 0.1 m per pixel at best, so from eye level one texel covers many screen pixels and plain
// bilinear filtering smears it. This patches the ground material (no extra texture, no extra draw call):
//   * where the picture is magnified, texel edges are tightened (a smoothstep on the bilinear weights), so roof edges, kerbs and road lines
//     stay defined instead of bleeding into each other,
//   * a fine procedural grain in world space (three sizes, each fading out before it could alias) is laid over the picture, so close ground
//     reads as a sharp surface tinted by the aerial rather than a blur. From above (picture at or below 1:1) nothing changes.
// The same patch is used for the sharp inner tile and the wide outer tile.
export function sharpenAerial(mat, texture) {
  const img = texture?.image;
  const size = new THREE.Vector2(img?.width || 1024, img?.height || 1024);
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uAerialSize = { value: size };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vAerialW;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvAerialW = (modelMatrix * vec4(position, 1.0)).xz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
uniform vec2 uAerialSize;
varying vec2 vAerialW;
float aerialHash(vec2 p) { p = fract(p * vec2(0.1031, 0.1030)); p += dot(p, p.yx + 33.33); return fract((p.x + p.y) * p.x); }
float aerialNoise(vec2 p) { vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(aerialHash(i), aerialHash(i + vec2(1.0, 0.0)), f.x), mix(aerialHash(i + vec2(0.0, 1.0)), aerialHash(i + vec2(1.0, 1.0)), f.x), f.y); }`)
      .replace('#include <map_fragment>', `#ifdef USE_MAP
  vec2 aTx = vMapUv * uAerialSize - 0.5;
  vec2 aI = floor(aTx);
  vec2 aF = fract(aTx);
  float aFp = max(length(dFdx(aTx)), length(dFdy(aTx)));       // texels per screen pixel: below 1 the picture is magnified
  float aK = 1.0 - smoothstep(0.18, 0.75, aFp);                 // 0 at about 1:1, 1 when a texel covers five or more pixels
  vec2 aS = smoothstep(0.0, 1.0, smoothstep(0.0, 1.0, aF));
  vec2 aUv = (aI + mix(aF, aS, aK) + 0.5) / uAerialSize;
  vec4 sampledDiffuseColor = textureGrad(map, aUv, dFdx(vMapUv), dFdy(vMapUv));
  float aW = max(length(dFdx(vAerialW)), length(dFdy(vAerialW))); // metres per screen pixel
  float aG = (aerialHash(floor(vAerialW / 0.03)) - 0.5) * 0.20 * (1.0 - smoothstep(0.012, 0.03, aW))
           + (aerialNoise(vAerialW / 0.11) - 0.5) * 0.20 * (1.0 - smoothstep(0.04, 0.10, aW))
           + (aerialNoise(vAerialW / 0.42 + 17.0) - 0.5) * 0.14 * (1.0 - smoothstep(0.15, 0.38, aW));
  sampledDiffuseColor.rgb *= 1.0 + aG * aK;
  diffuseColor *= sampledDiffuseColor;
#endif`);
  };
  mat.customProgramCacheKey = () => 'aerial-sharp-1';
  return mat;
}

// Ground with no aerial (the homepage hero look): mown, striped lawn on the lot and its neighbours, a dry paddock tone beyond them.
// One material: the tiling lawn texture in metres, and a small mask picture of the lots over the terrain extent that turns the lawn
// into paddock outside them (a soft 10 cm edge, as on real ground). No extra geometry or draw call. Returns null without a DOM.
const PADDOCK_TINT = [1.3, 1.0, 1.04]; // lawn green -> dry tan grass
// With a real aerial the 3D view keeps the clean lawn and paddock look and lets the picture through only subtly (this share, and at 55%
// of its own colour), so the ground reads as real land without the muddy cast, the baked shadows and the roofs of the photograph.
const AERIAL_BLEND = 0.6; // share of the aerial beyond the near zone (the full aerial stays within nearK of the lot)
// Owner 16/11/2026: with Aerial on, the real photograph shows in full on and around our lot and fades out with distance into the
// clean lawn and paddock look (a fade scale), so the lot reads as the real site while the far ground stays tidy.
const AERIAL_NEAR_MIN_M = 150; // full photograph out to at least this far from the lot centre
const AERIAL_FAR_FACTOR = 2.0; // fully faded to the subtle blend at this multiple of the near radius
function lawnGroundMaterial(ctx, lot, ext, aerial = null, hasWide = false) {
  if (typeof document === 'undefined') return null;
  const base = ctx.lib.get('grass', LAWN_COLOUR);
  if (!base?.map) return null;
  const w = (ext.x1 - ext.x0) / 1000; const h = (ext.y1 - ext.y0) / 1000;
  const k = 1024 / Math.max(w, h);
  const c = document.createElement('canvas');
  c.width = Math.max(8, Math.round(w * k)); c.height = Math.max(8, Math.round(h * k));
  const g = c.getContext('2d');
  g.fillStyle = '#000'; g.fillRect(0, 0, c.width, c.height);
  g.fillStyle = '#fff';
  const rings = [lot.boundary, ...(lot.neighbours || []).filter((n) => !n.isRoad && n.ring?.length > 2).map((n) => n.ring)];
  for (const r of rings) {
    g.beginPath();
    r.forEach((q, i) => { const x = ((q.x - ext.x0) / 1000) * k; const y = ((q.y - ext.y0) / 1000) * k; if (i) g.lineTo(x, y); else g.moveTo(x, y); });
    g.closePath(); g.fill();
  }
  const mask = new THREE.CanvasTexture(c);
  mask.flipY = false; // row 0 is the top of the canvas = the lowest plan y, the same way the terrain's own coordinates run
  mask.magFilter = THREE.LinearFilter; mask.minFilter = THREE.LinearMipmapLinearFilter; mask.anisotropy = 8;
  const map = base.map.clone();
  const tx = 1 / (base.map.repeat.x || 1); const ty = 1 / (base.map.repeat.y || 1); // metres per tile
  map.repeat.set(w / tx, h / ty); // the terrain's texture coordinates run 0 to 1 over the extent, so the lawn tiles in metres
  map.needsUpdate = true;
  const mat = new THREE.MeshStandardMaterial({ color: base.color.clone(), map, roughness: 1, metalness: 0, envMapIntensity: 0.25 });
  mat.userData.shared = false;
  mat.userData.disposeMap = true;
  mat.userData.lotMask = mask;
  mat.addEventListener('dispose', () => mask.dispose());
  if (aerial) {
    aerial.colorSpace = THREE.SRGBColorSpace;
    aerial.wrapS = THREE.ClampToEdgeWrapping;
    aerial.wrapT = THREE.ClampToEdgeWrapping;
    aerial.magFilter = THREE.LinearFilter;
    aerial.generateMipmaps = true;
    aerial.minFilter = THREE.LinearMipmapLinearFilter;
    aerial.anisotropy = Math.max(aerial.anisotropy || 1, 8);
    aerial.needsUpdate = true;
  }
  // the lot centre in the terrain's texture coordinates, and the fade radii in metres
  const pts = lot.boundary || [];
  const cx = pts.reduce((a, q) => a + q.x, 0) / Math.max(1, pts.length);
  const cy = pts.reduce((a, q) => a + q.y, 0) / Math.max(1, pts.length);
  const lotR = pts.reduce((a, q) => Math.max(a, Math.hypot(q.x - cx, q.y - cy)), 0) / 1000;
  const nearR = Math.max(AERIAL_NEAR_MIN_M, lotR * 1.15); // the whole lot and a margin past it in full, on large sites too
  const fadeC = new THREE.Vector2((cx - ext.x0) / 1000 / w, 1 - (cy - ext.y0) / 1000 / h);
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uLotMask = { value: mask };
    shader.uniforms.uFadeC = { value: fadeC };
    shader.uniforms.uFadeR = { value: new THREE.Vector2(nearR, nearR * AERIAL_FAR_FACTOR) };
    shader.uniforms.uExtM = { value: new THREE.Vector2(w, h) };
    if (aerial) shader.uniforms.uAerialTex = { value: aerial };
    shader.uniforms.uPaddock = { value: new THREE.Vector3(...PADDOCK_TINT) };
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying vec2 vLotUv;\nvarying vec2 vAerUv;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvLotUv = vec2(uv.x, 1.0 - uv.y);\nvAerUv = uv;');
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nuniform sampler2D uLotMask;\nuniform vec3 uPaddock;\nvarying vec2 vLotUv;\nvarying vec2 vAerUv;' + (aerial ? '\nuniform sampler2D uAerialTex;\nuniform vec2 uFadeC;\nuniform vec2 uFadeR;\nuniform vec2 uExtM;' : ''))
      .replace('#include <map_fragment>', `#include <map_fragment>
  float lotM = texture2D(uLotMask, vLotUv).r;
  // outside the lots: the dry paddock tone, with the mowing bands flattened (fine grain kept)
  vec3 lawnC = diffuseColor.rgb;
  float lawnL = dot(lawnC, vec3(0.3333));
  vec3 padC = diffuse * uPaddock * mix(0.9, lawnL / max(dot(diffuse, vec3(0.3333)), 0.001), 0.25);
  ${aerial ? 'lawnC = diffuse * mix(1.0, lawnL / max(dot(diffuse, vec3(0.3333)), 0.001), 0.2); // weak mowing stripes under a real aerial' : ''}
  diffuseColor.rgb = mix(padC, lawnC, lotM);
${aerial ? `  vec3 aerC = texture2D(uAerialTex, vAerUv).rgb;
  float dM = length((vAerUv - uFadeC) * uExtM);
  float nearK = 1.0 - smoothstep(uFadeR.x, uFadeR.y, dM);
  vec3 aerSoft = mix(vec3(dot(aerC, vec3(0.3333))), aerC, 0.85) * 1.08;
  vec3 aerFull = aerC * 1.06;
  diffuseColor.rgb = mix(mix(diffuseColor.rgb, aerSoft, ${(hasWide ? 0.92 : AERIAL_BLEND).toFixed(2)}), aerFull, nearK);` : ''}`);
  };
  mat.customProgramCacheKey = () => (aerial ? (hasWide ? 'lawn-ground-aerial-5w' : 'lawn-ground-aerial-5') : 'lawn-ground-2');
  return mat;
}

/**
 * addSiteTerrain(ctx, root, project, { texture, edgeColour, showContours }) -> { edgeY, extent, grid } | null
 * `texture` is a THREE.Texture of the aerial (north up, covering lot.aerial.extent), or null for a plain grass surface.
 */
// One cached terrain build: the design surface (fds), the pads and the mesh node heights, keyed by everything they depend on (the lot, its
// elevation grid, the buildings, pavements, drawn ways and levels). A change that touches none of them (colours, interior edits) reuses it.
let terrainCache = null;
const gridIds = new WeakMap(); let gridSeq = 0;
const gridId = (t) => { if (!t) return 0; let k = gridIds.get(t); if (!k) { k = ++gridSeq; gridIds.set(t, k); } return k; };
export function terrainKey(project, dims, detail = 1) {
  const lot = project.site?.lot || {};
  const c = project.commercial ? { ...project.commercial, finishes: undefined, name: undefined } : null;
  return JSON.stringify([lot.boundary, lot.layers, lot.floorRL, lot.frontEdges, lot.roads, gridId(lot.terrain), project.mode, c, (project.levels || []).map((l) => [l.id, l.elevation, l.walls?.length, l.rooms?.length]), project.site?.grading, footprintBox(project), getWays(project), project.site?.driveway, dims, detail]);
}

export function addSiteTerrain(ctx, root, project, { texture = null, edgeColour = null, wideTexture = null, wideEdgeColour = null, showContours = false, detail = 1 } = {}) {
  const lot = project.site?.lot;
  const ext0 = S.terrainExtent(lot, 30);
  const dq = Math.min(1, Math.max(0.25, Number.isFinite(detail) ? detail : 1)); // detail below 1: a coarser grid and no contours
  if (dq < 1) showContours = false;
  const dims = ext0 ? S.gridDims(ext0, S.MIN_CELL_MM / dq, Math.round(S.MAX_GRID_CELLS * dq)) : null;
  const ckey = dims ? terrainKey(project, dims, dq) : null;
  const hit = ckey && terrainCache && terrainCache.key === ckey ? terrainCache : null;
  const tm = hit ? hit.tm : terrainModel(project, { cellM: dims ? Math.max(dims.dx, dims.dy) / 1000 : 0.75 });
  if (!tm || !S.siteReady(project)) return null;
  const ext = ext0;
  if (!ext) return null;
  const { cols, rows } = dims;
  if (tm.pads?.length) { try { applyPadShifts(root, tm.pads); } catch (e) { console.warn('[viewer3d] pad shift skipped', e); } }
  const heights = new Float32Array(cols * rows);
  const design = new Float32Array(cols * rows); // the finished design surface at each node (the mesh is a little under it where the design is exact)
  const cellM = Math.max(dims.dx, dims.dy) / 1000;
  const pos = new Float32Array(cols * rows * 3);
  const uv = new Float32Array(cols * rows * 2);
  const hasAerial = !!(texture && lot.aerial?.extent && S.layerOn(lot, 'aerial'));
  const grey = !hasAerial && lot.aerialSource === 'none';
  const aw = ext.x1 - ext.x0;
  const ah = ext.y1 - ext.y0;
  if (hit) { heights.set(hit.heights); design.set(hit.design); pos.set(hit.pos); uv.set(hit.uv); } else {
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const x = dims.x0 + i * dims.dx;
      const y = dims.y0 + j * dims.dy;
      const nm = nodeHeights(tm, x, y, cellM);
      const Y = nm.design;
      const k = j * cols + i;
      design[k] = Y;
      const Ym = nm.mesh;
      heights[k] = Ym;
      pos[k * 3] = x / 1000;
      pos[k * 3 + 1] = Ym;
      pos[k * 3 + 2] = y / 1000;
      uv[k * 2] = i / (cols - 1);
      uv[k * 2 + 1] = 1 - j / (rows - 1);
    }
  }
    terrainCache = { key: ckey, tm, heights: heights.slice(), design: design.slice(), pos: pos.slice(), uv: uv.slice() };
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setIndex(S.gridIndices(cols, rows));
  geo.computeVertexNormals();
  let mat = null;
  const blended = hasAerial ? lawnGroundMaterial(ctx, lot, ext, texture, !!wideTexture) : null; // the clean lawn with the aerial let through subtly
  if (blended) mat = blended;
  else if (hasAerial) {
    // Sharp: the aerial at full resolution, bilinear when magnified, trilinear mipmaps and anisotropy when minified.
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.magFilter = THREE.LinearFilter;
    texture.generateMipmaps = true;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.anisotropy = Math.max(texture.anisotropy || 1, 16);
    texture.needsUpdate = true;
    mat = new THREE.MeshStandardMaterial({ map: texture, roughness: 1, metalness: 0, envMapIntensity: 0.25 });
    mat.userData.shared = false;
    sharpenAerial(mat, texture);
  } else {
    mat = grey ? ctx.lib.get('grass', GREY_GROUND, { flat: true }) : lawnGroundMaterial(ctx, lot, ext) || ctx.lib.get('grass', LAWN_COLOUR);
  }
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'site-terrain';
  mesh.receiveShadow = true;
  mesh.castShadow = false;
  mesh.userData = { ground: true, siteTerrain: true, frame: false };
  root.add(mesh);

  const grid = { cols, rows, x0: dims.x0, y0: dims.y0, dx: dims.dx, dy: dims.dy, heights };
  const meshAt = (x, y) => S.surfaceAt(grid, x, y);
  // The ground as seen: the exact design surface inside a design element, the mesh elsewhere. Everything that stands on or is laid on the
  // ground reads this one function (the lines, labels, fences, trees, pavements, kerbs), and the surfaces made from the design read fdsAt.
  const fdsAt = tm.fds ? (x, y) => tm.fds.levelAt(x, y).y : meshAt;
  // Kerb height scale: 0 over a crossover (a layback flush with the gutter), rising to full over 600 mm (the kerb returns taper, never stand up).
  const xr = (tm.crossovers || []).map((ring) => ({ ring, bb: G.bbox(ring) }));
  const kerbScale = xr.length ? (q) => { let d = Infinity; for (const c of xr) d = Math.min(d, polyDistM(q, c.ring, c.bb).d); return Math.min(1, d / 0.6); } : null;
  const surf = tm.fds ? (x, y) => { const r = tm.fds.levelAt(x, y); return r.id ? r.y : meshAt(x, y); } : meshAt;

  // Wide outer tile: a lower resolution aerial on a frame of ground around the sharp inner tile, so the visible ground is real imagery
  // well past the lot. Only the far edge of this tile fades (the ring below), into the neutral ground colour.
  const wide = hasAerial && wideTexture ? addWideGround(root, lot, tm, ext, wideTexture) : null;
  const nodes = wide ? wide.nodes : S.perimeterNodes(cols, rows).map((n) => ({ x: pos[(n.j * cols + n.i) * 3], y: heights[n.j * cols + n.i], z: pos[(n.j * cols + n.i) * 3 + 2], dir: n.dir }));
  let edgeSum = 0;
  for (const n of nodes) edgeSum += n.y;
  const edgeY = nodes.length ? edgeSum / nodes.length : tm.padY;
  const ring = S.fadeRing(nodes, edgeY - 0.05);
  // The aerial edge is often road, so lean on grass: the ring reads as open ground that fades to the horizon.
  // With the wide tile the ring starts from that picture's own edge colour (no seam); without it the old grass lean applies.
  const inner = grey ? new THREE.Color(GREY_GROUND) : wide ? new THREE.Color(wideEdgeColour || GRASS) : (!hasAerial || blended) ? new THREE.Color(PADDOCK) : new THREE.Color(edgeColour || GRASS).lerp(new THREE.Color(GRASS), 0.55).multiplyScalar(1.12);
  const outer = new THREE.Color(grey ? GREY_HORIZON : (!hasAerial || blended) ? PADDOCK : HORIZON);
  const rc = [];
  for (const t of ring.colourT) {
    const c = inner.clone().lerp(outer, t);
    rc.push(c.r, c.g, c.b);
  }
  const rgeo = new THREE.BufferGeometry();
  rgeo.setAttribute('position', new THREE.Float32BufferAttribute(ring.positions, 3));
  rgeo.setAttribute('color', new THREE.Float32BufferAttribute(rc, 3));
  rgeo.setIndex(ring.indices);
  const rmat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide });
  rmat.userData.shared = false;
  const rmesh = new THREE.Mesh(rgeo, rmat);
  rmesh.name = 'site-horizon';
  rmesh.userData = { ground: true, horizon: true };
  rmesh.frustumCulled = false;
  root.add(rmesh);

  addSiteOverlays(root, lot, surf, { showContours });
  try { addConstraintTint(root, lot, surf); } catch (e) { console.warn('[viewer3d] constraint tint skipped', e); } // optional overlays, never break the model
  let extras = null;
  try {
    extras = addSiteExtras(ctx, root, project, surf, { extent: ext, tm, fds: fdsAt, realAerial: !!texture || !!(lot.aerial?.extent && S.layerOn(lot, 'aerial')) }); // a stored aerial hides the stand-in neighbours even while its picture is still loading
  } catch (e) {
    console.warn('[viewer3d] site extras skipped', e);
  }
  try {
    if (project.mode === 'commercial') addCommercialPavements(root, project, fdsAt, { model: tm.pavements, kerbScale }); // pavements, kerbs and markings of a commercial layout
  } catch (e) {
    console.warn('[viewer3d] commercial pavements skipped', e);
  }
  try {
    if (project.mode === 'commercial') { addForecourtSlabs(root, project, fdsAt); addCommercialEntourage(root, project, fdsAt); } // a few parked cars and a truck at the dock, for scale
  } catch (e) {
    console.warn('[viewer3d] commercial entourage skipped', e);
  }
  // Cut and fill heat map (project.site.grading.heat): the same grid as the ground in vertex colours, red where the design is cut below the natural
  // ground, blue where it is filled, strongest at 1 m; the held road is left clear. A transparent overlay just above the ground.
  try {
    if (project.site?.grading?.heat && tm.grading) {
      const col = new Float32Array(cols * rows * 3); const hp = new Float32Array(pos);
      const roadsH = tm.grading.elements.filter((e) => e.road);
      for (let k = 0; k < cols * rows; k++) {
        const x = pos[k * 3] * 1000; const y = pos[k * 3 + 2] * 1000;
        const d = roadsH.some((e) => G.pointInPolygon({ x, y }, e.polys[0])) ? 0 : design[k] - tm.rawAt(x, y);
        const t = Math.min(1, Math.abs(d) / 1.0); const on = Math.abs(d) > 0.02 ? 1 : 0;
        const c = d < 0 ? [0.86, 0.18, 0.14] : [0.16, 0.38, 0.85];
        col[k * 3] = 1 - (1 - c[0]) * t * on; col[k * 3 + 1] = 1 - (1 - c[1]) * t * on; col[k * 3 + 2] = 1 - (1 - c[2]) * t * on;
        hp[k * 3 + 1] = pos[k * 3 + 1] + 0.05;
      }
      const hg = new THREE.BufferGeometry();
      hg.setAttribute('position', new THREE.BufferAttribute(hp, 3));
      hg.setAttribute('color', new THREE.BufferAttribute(col, 3));
      hg.setIndex(S.gridIndices(cols, rows));
      const hm = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.55, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
      hm.userData.shared = false;
      const hmesh = new THREE.Mesh(hg, hm);
      hmesh.name = 'grading-heat';
      hmesh.userData = { ground: true, gradingHeat: true };
      hmesh.renderOrder = 5;
      root.add(hmesh);
    }
  } catch (e) { console.warn('[viewer3d] heat map skipped', e); }
  let retaining = null;
  try {
    retaining = retainingEdges(tm, lot);
    if (retaining.samples.length) {
      const pos2 = []; const idx2 = [];
      for (const r of retaining.samples) {
        const tx = -r.ny; const ty = r.nx; // along the boundary
        for (const sg of [-1, 1]) {
          const cx = r.x + tx * 500 * sg; const cy = r.y + ty * 500 * sg;
          pos2.push(cx / 1000, r.a, cy / 1000, cx / 1000, r.b, cy / 1000);
        }
        const k = pos2.length / 3 - 4;
        idx2.push(k, k + 1, k + 3, k, k + 3, k + 2, k, k + 3, k + 1, k, k + 2, k + 3);
      }
      const g2 = new THREE.BufferGeometry();
      g2.setAttribute('position', new THREE.Float32BufferAttribute(pos2, 3));
      g2.setIndex(idx2);
      g2.computeVertexNormals();
      const m2 = new THREE.Mesh(g2, new THREE.MeshStandardMaterial({ color: '#9b9a94', roughness: 0.9, side: THREE.DoubleSide }));
      m2.material.userData.shared = false;
      m2.name = 'retaining-edge';
      m2.userData = { ground: true, retaining: true };
      root.add(m2);
    }
  } catch (e) { console.warn('[viewer3d] retaining edge skipped', e); }
  const ow = wide ? wide.extent.x1 - wide.extent.x0 : aw;
  const oh = wide ? wide.extent.y1 - wide.extent.y0 : ah;
  let works = null;
  if (tm.grading) {
    try {
      const roads = tm.grading.elements.filter((e) => e.road);
      const inRoad = (x, y) => roads.some((e) => G.pointInPolygon({ x, y }, e.polys[0])); // the existing road is held, not graded
      works = earthworks({ ...grid, heights: design }, tm.rawAt, (dims.dx / 1000) * (dims.dy / 1000), inRoad);
    } catch { works = null; }
  }
  return { extras, earthworks: works, retaining: retaining ? { maxM: retaining.maxM, lengthM: retaining.lengthM } : null, fds: tm.fds, pads: tm.pads, edgeY, extent: ext, wideExtent: wide ? wide.extent : null, grid, outerR: S.RING_OFFSETS_M[S.RING_OFFSETS_M.length - 1] + Math.max(ow, oh) / 2000 };
}

// The wide tile as a frame of ground around the inner extent (cells wholly inside it are left out). Sits just below the inner mesh with a
// polygon offset, so the seam never z-fights. Returns { extent, nodes } (perimeter nodes for the fade ring) or null.
export function addWideGround(root, lot, tm, inner, texture) {
  const w = lot.aerialWide?.extent;
  if (!w || ![w.x0, w.y0, w.x1, w.y1].every(Number.isFinite) || !(w.x1 > w.x0 && w.y1 > w.y0)) return null;
  if (!(w.x0 <= inner.x0 && w.y0 <= inner.y0 && w.x1 >= inner.x1 && w.y1 >= inner.y1)) return null; // must surround the inner tile
  if (!S.layerOn(lot, 'aerial')) return null;
  const dims = S.gridDims(w, 4000, 170);
  const { cols, rows } = dims;
  const pos = new Float32Array(cols * rows * 3);
  const uv = new Float32Array(cols * rows * 2);
  const hs = new Float32Array(cols * rows);
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const x = dims.x0 + i * dims.dx;
      const y = dims.y0 + j * dims.dy;
      const Y = tm.heightAt(x, y);
      const k = j * cols + i;
      hs[k] = Y;
      pos[k * 3] = x / 1000;
      pos[k * 3 + 1] = Y - 0.08;
      pos[k * 3 + 2] = y / 1000;
      uv[k * 2] = i / (cols - 1);
      uv[k * 2 + 1] = 1 - j / (rows - 1);
    }
  }
  const all = S.gridIndices(cols, rows);
  const idx = [];
  const e = 1; // mm
  for (let t = 0; t < all.length; t += 3) {
    // keep a triangle unless all three corners are inside the inner extent
    let inside = true;
    for (let q = 0; q < 3; q++) {
      const k = all[t + q];
      const x = pos[k * 3] * 1000;
      const y = pos[k * 3 + 2] * 1000;
      if (!(x >= inner.x0 - e && x <= inner.x1 + e && y >= inner.y0 - e && y <= inner.y1 + e)) { inside = false; break; }
    }
    if (!inside) idx.push(all[t], all[t + 1], all[t + 2]);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = true;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.anisotropy = Math.max(texture.anisotropy || 1, 16);
  texture.needsUpdate = true;
  const mat = new THREE.MeshStandardMaterial({ map: texture, roughness: 1, metalness: 0, envMapIntensity: 0.25, polygonOffset: true, polygonOffsetFactor: 2, polygonOffsetUnits: 2 });
  mat.userData.shared = false;
  sharpenAerial(mat, texture);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'site-terrain-wide';
  mesh.receiveShadow = true;
  mesh.castShadow = false;
  mesh.userData = { ground: true, siteTerrain: true, siteTerrainWide: true, frame: false };
  root.add(mesh);
  const nodes = S.perimeterNodes(cols, rows).map((n) => ({ x: pos[(n.j * cols + n.i) * 3], y: hs[n.j * cols + n.i], z: pos[(n.j * cols + n.i) * 3 + 2], dir: n.dir }));
  return { extent: { x0: w.x0, y0: w.y0, x1: w.x1, y1: w.y1 }, nodes };
}

// Lines and labels on the surface ---------------------------------------------------------------------------------------------
function addSiteOverlays(root, lot, surf, { showContours }) {
  const group = new THREE.Group();
  group.name = 'site-overlays';
  root.add(group);
  const lift = 0.07;
  const drape = (pts, closed, step = 0.5, l = lift) => S.drapePolyline(pts, surf, { step, lift: l, closed });

  if (S.layerOn(lot, 'neighbours') && lot.neighbours?.length) {
    const groups = lot.neighbours.filter((n) => n.ring?.length > 2).map((n) => ({ pts: drape(n.ring, true, 1.0, 0.05), closed: true }));
    addLines(group, 'neighbour-boundaries', groups, { half: 0.06, color: '#fff2b3', userData: { neighbourBoundary: true }, order: 1 });
  }
  if (S.layerOn(lot, 'boundary')) {
    const groups = [{ pts: drape(lot.boundary, true), closed: true }];
    for (const h of lot.holes || []) if (h.length > 2) groups.push({ pts: drape(h, true), closed: true });
    // frame: the camera frames the lot, not only the house
    addLines(group, 'lot-boundary', groups, { half: 0.15, color: '#e01b1b', userData: { lotBoundary: true, frame: true }, order: 4 });
  }
  if (S.layerOn(lot, 'setbacks') && Array.isArray(lot.envelope) && lot.envelope.length > 2) {
    const solid = drape(lot.envelope, true, 0.4, 0.09);
    const dashes = S.dashPolyline(solid, 1.8, 1.1, true).map((pts) => ({ pts, closed: false }));
    addLines(group, 'setback-envelope', dashes, { half: 0.055, color: '#0b7a5b', userData: { setbackEnvelope: true }, order: 3 });
  }
  const fronts = S.frontagePolylines(lot);
  if (fronts.length) {
    addLines(group, 'street-frontage', fronts.map((e) => ({ pts: drape(e, false, 0.5, 0.04), closed: false })), { half: 0.22, color: '#1d5fd1', userData: { frontage: true }, order: 2 });
  }
  if (showContours && S.layerOn(lot, 'contours') && lot.contours?.length) {
    const minor = [];
    const major = [];
    for (const c of lot.contours) {
      const pts = [];
      for (let i = 0; i + 1 < c.pts.length; i += 2) pts.push({ x: c.pts[i], y: c.pts[i + 1] });
      if (pts.length < 2) continue;
      (c.major ? major : minor).push({ pts: drape(pts, !!c.closed, 1.5, 0.12), closed: false });
    }
    addLines(group, 'site-contours-minor', minor, { half: 0.05, color: '#b0763a', userData: { contours: true }, order: 2 });
    addLines(group, 'site-contours-major', major, { half: 0.1, color: '#8a4c16', userData: { contours: true }, order: 2 });
  }
  if (S.layerOn(lot, 'labels')) {
    for (const l of S.siteLabels(lot)) {
      const sp = labelSprite(l.lines, l.kind);
      if (!sp) continue;
      const y = surf(l.x, l.y);
      sp.position.set(l.x / 1000, y + (l.kind === 'lot' ? 9 : 4), l.y / 1000);
      sp.name = `label:${l.kind}`;
      sp.userData = { label: true };
      group.add(sp);
    }
    const f = fronts[0];
    if (f) {
      const mid = { x: (f[0].x + f[1].x) / 2, y: (f[0].y + f[1].y) / 2 };
      const sp = labelSprite(['Street frontage'], 'neighbour');
      if (sp) {
        sp.position.set(mid.x / 1000, surf(mid.x, mid.y) + 2.2, mid.y / 1000);
        sp.name = 'label:frontage';
        sp.userData = { label: true };
        group.add(sp);
      }
    }
  }
}
