// Site terrain for the 3D model: a mesh from the lot's elevation grid (site.lot.terrain), draped with the aerial image when
// one is supplied, a pad under the house, and the lot boundary laid on the ground. No DOM access.
//
// Heights: plan mm to metres is x / 1000 = X and y / 1000 = Z. A ground RL (metres) becomes
//   Y = RL - floorRL + groundFloorElevation
// so the ground floor sits at the project's floor RL (default: lot centroid RL + 0.15 m) and, with the default, the
// ground at the lot centre is exactly groundY = floor - SLAB.ground.

import * as THREE from 'three';
import { terrainAt, floorRLOf } from '../site/model.js';

const PAD_MARGIN_M = 1.0; // flat pad beyond the footprint
const PAD_BLEND_M = 3.0; // then the ground rises or falls back to the natural surface over this distance
const smooth = (t) => t * t * (3 - 2 * t);

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
 * terrainHeights(project) -> { heightAt(xMm, yMm) -> Y metres | null, groundFloor, floorRL }
 * Pure: also used by tests.
 */
export function terrainModel(project) {
  const lot = project.site?.lot;
  if (!lot?.terrain) return null;
  const floorRL = floorRLOf(lot);
  const lowest = [...project.levels].sort((a, b) => a.elevation - b.elevation)[0];
  const base = (lowest ? lowest.elevation : 0) / 1000;
  const fp = footprintBox(project);
  const rawY = (x, y) => {
    const rl = terrainAt(lot.terrain, x, y);
    return rl == null ? null : rl - floorRL + base;
  };
  const padY = base - 0.15; // SLAB.ground: the flat pad is the ground at slab level
  const heightAt = (x, y) => {
    const raw = rawY(x, y);
    if (raw == null || !fp) return raw;
    const dx = Math.max(fp.minX - x, 0, x - fp.maxX) / 1000;
    const dy = Math.max(fp.minY - y, 0, y - fp.maxY) / 1000;
    const d = Math.hypot(dx, dy) - PAD_MARGIN_M;
    if (d <= 0) return padY;
    if (d >= PAD_BLEND_M) return raw;
    const t = smooth(d / PAD_BLEND_M);
    return padY + (raw - padY) * t;
  };
  return { heightAt, floorRL, base, padY };
}

/**
 * addSiteTerrain(ctx, root, project, { texture }) -> { edgeY } | null
 * `texture` is a THREE.Texture of the aerial (north up, covering lot.aerial.extent), or null for a plain grass surface.
 */
export function addSiteTerrain(ctx, root, project, { texture = null } = {}) {
  const lot = project.site?.lot;
  const tm = terrainModel(project);
  if (!tm) return null;
  const t = lot.terrain;
  const cols = t.cols;
  const rows = t.rows;
  const pos = new Float32Array(cols * rows * 3);
  const uv = new Float32Array(cols * rows * 2);
  const ext = lot.aerial?.extent;
  let edgeSum = 0;
  let edgeN = 0;
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const x = t.x0 + i * t.cellMm;
      const y = t.y0 + j * t.cellMm;
      const Y = tm.heightAt(x, y);
      const k = j * cols + i;
      pos[k * 3] = x / 1000;
      pos[k * 3 + 1] = Y;
      pos[k * 3 + 2] = y / 1000;
      if (ext) {
        uv[k * 2] = Math.min(1, Math.max(0, (x - ext.x0) / (ext.x1 - ext.x0)));
        uv[k * 2 + 1] = 1 - Math.min(1, Math.max(0, (y - ext.y0) / (ext.y1 - ext.y0)));
      }
      if (i === 0 || j === 0 || i === cols - 1 || j === rows - 1) {
        edgeSum += Y;
        edgeN++;
      }
    }
  }
  const idx = [];
  for (let j = 0; j < rows - 1; j++) {
    for (let i = 0; i < cols - 1; i++) {
      const a = j * cols + i;
      const b = a + 1;
      const c = a + cols;
      const d = c + 1;
      idx.push(a, c, b, b, c, d); // counter clockwise seen from above (+Y)
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  let mat;
  if (texture && ext) {
    // Sharp: the aerial at full resolution, no bilinear blur when magnified, mipmaps and anisotropy when minified.
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.magFilter = THREE.LinearFilter;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.anisotropy = 8;
    texture.needsUpdate = true;
    mat = new THREE.MeshStandardMaterial({ map: texture, roughness: 1, metalness: 0 });
    mat.userData.shared = false;
  } else {
    mat = ctx.lib.get('grass', '#76895f');
  }
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'site-terrain';
  mesh.receiveShadow = true;
  mesh.castShadow = false;
  mesh.userData = { ground: true, siteTerrain: true };
  root.add(mesh);
  addBoundaryRibbon(root, lot, tm);
  return { edgeY: edgeN ? edgeSum / edgeN : tm.padY };
}

// The lot boundary as a thin red ribbon lying on the terrain (a plain line would be one pixel wide).
function addBoundaryRibbon(root, lot, tm) {
  if (!lot.boundary?.length || lot.layers?.boundary === false) return;
  const half = 0.07;
  const lift = 0.04;
  const pts = [];
  const ring = lot.boundary;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 1000));
    for (let s = 0; s < n; s++) {
      const x = a.x + ((b.x - a.x) * s) / n;
      const y = a.y + ((b.y - a.y) * s) / n;
      pts.push([x / 1000, (tm.heightAt(x, y) ?? tm.padY) + lift, y / 1000]);
    }
  }
  const verts = [];
  const index = [];
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    const pr = pts[(i - 1 + pts.length) % pts.length];
    let dx = q[0] - pr[0];
    let dz = q[2] - pr[2];
    const l = Math.hypot(dx, dz) || 1;
    dx /= l;
    dz /= l;
    verts.push(p[0] - dz * half, p[1], p[2] + dx * half, p[0] + dz * half, p[1], p[2] - dx * half);
    const a = i * 2;
    const b = ((i + 1) % pts.length) * 2;
    index.push(a, a + 1, b, a + 1, b + 1, b);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  geo.setIndex(index);
  const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: '#d62828', side: THREE.DoubleSide }));
  mesh.name = 'lot-boundary';
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.userData = { ground: true, lotBoundary: true };
  root.add(mesh);
}
