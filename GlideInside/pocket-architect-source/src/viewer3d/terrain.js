// Site for the 3D model, built from site.lot whenever a lot is loaded (the elevation grid and the aerial are optional):
//   * terrain mesh over the full aerial extent (a clean rectangle), with the aerial draped on it,
//   * a level building pad at floor RL under the house with a short 1:3 batter to the natural ground,
//   * a ring beyond the terrain that fades to the horizon colour (no fog, no hard edge),
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
import { addSiteExtras } from './site-extras.js';

export { PAD_MARGIN_M } from './site-geom.js';

const GRASS = '#6f8a58';
const HORIZON = '#c9dcee'; // matches the sky horizon in viewer.js

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

/**
 * terrainModel(project) -> { heightAt(xMm, yMm) -> Y metres, floorRL, base, padY } | null (no lot)
 * Defined everywhere (clamped to the elevation grid, flat at slab level when there is no grid), so the mesh never has a hole.
 * Pure: also used by tests.
 */
export function terrainModel(project) {
  const lot = project.site?.lot;
  if (!lot) return null;
  const floorRL = floorRLOf(lot);
  const lowest = [...project.levels].sort((a, b) => a.elevation - b.elevation)[0];
  const base = (lowest ? lowest.elevation : 0) / 1000;
  const fp = footprintBox(project);
  const padY = base - 0.15; // SLAB.ground: the flat pad is the ground at slab level
  const rawY = (x, y) => {
    if (!lot.terrain) return padY;
    const rl = S.terrainAtClamped(lot.terrain, x, y);
    return rl == null ? padY : rl - floorRL + base;
  };
  const heightAt = (x, y) => {
    const raw = rawY(x, y);
    if (!fp) return raw;
    return S.padHeight(raw, padY, S.distToBox(fp, x, y));
  };
  return { heightAt, floorRL, base, padY };
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
  lines.forEach((l, i) => {
    const y = pad + lh * (i + 0.5);
    g.font = font(i === 0 ? size : size * 0.86, i === 0 ? 700 : 600);
    g.lineWidth = 7;
    g.strokeStyle = 'rgba(255,255,255,0.92)';
    g.strokeText(l, width / 2, y);
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
  sp.scale.y = (strong ? 0.026 : 0.019) * lines.length + 0.012;
  sp.scale.x = sp.scale.y * (width / height);
  sp.renderOrder = 20;
  return sp;
}

/**
 * addSiteTerrain(ctx, root, project, { texture, edgeColour, showContours }) -> { edgeY, extent, grid } | null
 * `texture` is a THREE.Texture of the aerial (north up, covering lot.aerial.extent), or null for a plain grass surface.
 */
export function addSiteTerrain(ctx, root, project, { texture = null, edgeColour = null, showContours = false } = {}) {
  const lot = project.site?.lot;
  const tm = terrainModel(project);
  if (!tm || !S.siteReady(project)) return null;
  const ext = S.terrainExtent(lot, 30);
  if (!ext) return null;
  const dims = S.gridDims(ext);
  const { cols, rows } = dims;
  const heights = new Float32Array(cols * rows);
  const pos = new Float32Array(cols * rows * 3);
  const uv = new Float32Array(cols * rows * 2);
  const hasAerial = !!(texture && lot.aerial?.extent && S.layerOn(lot, 'aerial'));
  const aw = ext.x1 - ext.x0;
  const ah = ext.y1 - ext.y0;
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const x = dims.x0 + i * dims.dx;
      const y = dims.y0 + j * dims.dy;
      const Y = tm.heightAt(x, y);
      const k = j * cols + i;
      heights[k] = Y;
      pos[k * 3] = x / 1000;
      pos[k * 3 + 1] = Y;
      pos[k * 3 + 2] = y / 1000;
      uv[k * 2] = i / (cols - 1);
      uv[k * 2 + 1] = 1 - j / (rows - 1);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setIndex(S.gridIndices(cols, rows));
  geo.computeVertexNormals();
  let mat;
  if (hasAerial) {
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
  } else {
    mat = ctx.lib.get('grass', '#76895f');
  }
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'site-terrain';
  mesh.receiveShadow = true;
  mesh.castShadow = false;
  mesh.userData = { ground: true, siteTerrain: true, frame: false };
  root.add(mesh);

  const grid = { cols, rows, x0: dims.x0, y0: dims.y0, dx: dims.dx, dy: dims.dy, heights };
  const surf = (x, y) => S.surfaceAt(grid, x, y);

  // Fade ring: from the terrain edge out to the horizon colour.
  const nodes = S.perimeterNodes(cols, rows).map((n) => ({ x: pos[(n.j * cols + n.i) * 3], y: heights[n.j * cols + n.i], z: pos[(n.j * cols + n.i) * 3 + 2], dir: n.dir }));
  let edgeSum = 0;
  for (const n of nodes) edgeSum += n.y;
  const edgeY = nodes.length ? edgeSum / nodes.length : tm.padY;
  const ring = S.fadeRing(nodes, edgeY - 0.05);
  // The aerial edge is often road, so lean on grass: the ring reads as open ground that fades to the horizon.
  const inner = new THREE.Color(edgeColour || GRASS).lerp(new THREE.Color(GRASS), 0.55).multiplyScalar(1.12);
  const outer = new THREE.Color(HORIZON);
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
  let extras = null;
  try {
    extras = addSiteExtras(ctx, root, project, surf, { extent: ext, tm });
  } catch (e) {
    console.warn('[viewer3d] site extras skipped', e);
  }
  return { extras, edgeY, extent: ext, grid, outerR: S.RING_OFFSETS_M[S.RING_OFFSETS_M.length - 1] + Math.max(aw, ah) / 2000 };
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
    addLines(group, 'setback-envelope', dashes, { half: 0.08, color: '#0b7a5b', userData: { setbackEnvelope: true }, order: 3 });
  }
  const fronts = S.frontagePolylines(lot);
  if (fronts.length) {
    addLines(group, 'street-frontage', fronts.map((e) => ({ pts: drape(e, false, 0.5, 0.04), closed: false })), { half: 0.55, color: '#1d5fd1', userData: { frontage: true }, order: 2 });
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
