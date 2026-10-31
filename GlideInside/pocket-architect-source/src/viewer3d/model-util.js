// Shared helpers for model assembly and disposal. No DOM access.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// result: { geometry, slotKeys } from GeoBuilder.build(); matBySlot maps slot key -> material.
// Adjacent groups that share a material are merged (fewer draw calls). flags.faceOf maps a slot key
// to a face name, stored per material index in userData.faceBySlot for picking.
export function makeMesh(result, matBySlot, userData = {}, flags = {}) {
  if (!result) return null;
  const { geometry } = result;
  let keys = result.slotKeys;
  let mats = keys.map((k) => matBySlot[k]);
  if (mats.length > 1) {
    const groups = geometry.groups.map((g) => ({ start: g.start, count: g.count, mi: g.materialIndex }));
    const outGroups = [];
    const outKeys = [];
    const outMats = [];
    for (const g of groups) {
      const last = outGroups.length - 1;
      if (last >= 0 && outMats[last] === mats[g.mi]) {
        outGroups[last].count += g.count;
      } else {
        outGroups.push({ start: g.start, count: g.count });
        outKeys.push(keys[g.mi]);
        outMats.push(mats[g.mi]);
      }
    }
    if (outGroups.length < groups.length) {
      geometry.clearGroups();
      outGroups.forEach((g, i) => geometry.addGroup(g.start, g.count, i));
      keys = outKeys;
      mats = outMats;
    }
  }
  const mesh = new THREE.Mesh(geometry, mats.length === 1 ? mats[0] : mats);
  mesh.userData = { ...userData, slotKeys: keys };
  if (flags.faceOf) mesh.userData.faceBySlot = keys.map((k) => flags.faceOf[k]);
  mesh.castShadow = flags.cast ?? true;
  mesh.receiveShadow = flags.receive ?? true;
  if (flags.name) mesh.name = flags.name;
  if (mats.some((m) => m?.transparent)) mesh.castShadow = false;
  return mesh;
}

export function disposeModel(group) {
  if (!group) return;
  group.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
    for (const m of mats) if (!m.userData?.shared) m.dispose();
  });
}

// Bounds of the model without the ground plane.
export function modelBounds(group) {
  const box = new THREE.Box3();
  let any = false;
  group.updateWorldMatrix(true, true);
  group.traverse((o) => {
    if (!o.isMesh || o.userData?.ground || !o.geometry) return;
    if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
    const b = o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld);
    if (!Number.isFinite(b.min.x + b.max.x + b.min.y + b.max.y + b.min.z + b.max.z)) return;
    box.union(b);
    any = true;
  });
  return any ? box : null;
}

// Collapse the meshes of a furniture group into few meshes (fewer draw calls). Plain coloured
// materials are baked into vertex colours and grouped by surface class (matt, gloss, metal, double
// sided); transparent, textured and emissive materials stay as they are, merged per material.
// Leaves the group untouched when it holds anything other than plain single-material meshes.
export function flattenGroup(g, lib = null) {
  const meshes = [];
  let plain = true;
  g.traverse((o) => {
    if (o === g) return;
    if (o.isMesh) {
      if (Array.isArray(o.material) || !o.geometry?.attributes?.position || o.isInstancedMesh || o.isSkinnedMesh) plain = false;
      else meshes.push(o);
    } else if (o.isLine || o.isPoints || o.isSprite) plain = false;
  });
  if (!plain || meshes.length < 2) return g;
  g.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(g.matrixWorld).invert();
  const buckets = new Map();
  const classOf = (m) => {
    if (!lib?.vertexColour || !m.color || m.map || m.normalMap || m.transparent || m.opacity < 1 || m.emissiveMap) return null;
    if (m.emissive && m.emissive.getHex() !== 0) return null;
    const metal = (m.metalness ?? 0) > 0.3;
    const gloss = (m.roughness ?? 0.8) < 0.45;
    return { key: `v|${metal ? 1 : 0}|${gloss ? 1 : 0}|${m.side === THREE.DoubleSide ? 1 : 0}`, rough: gloss ? 0.35 : 0.8, metal: metal ? 0.6 : 0, side: m.side === THREE.DoubleSide ? 'double' : 'front' };
  };
  try {
    for (const m of meshes) {
      const rel = new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld);
      let geo = m.geometry.clone();
      if (geo.index) geo = geo.toNonIndexed();
      geo.applyMatrix4(rel);
      for (const name of Object.keys(geo.attributes)) if (!['position', 'normal', 'uv'].includes(name)) geo.deleteAttribute(name);
      if (!geo.attributes.normal) geo.computeVertexNormals();
      if (!geo.attributes.uv) geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(geo.attributes.position.count * 2), 2));
      geo.clearGroups();
      const cls = classOf(m.material);
      const key = cls ? cls.key : `m|${m.material.uuid}`;
      if (cls) {
        const n = geo.attributes.position.count;
        const col = new Float32Array(n * 3);
        const c = m.material.color;
        for (let i = 0; i < n; i++) {
          col[i * 3] = c.r;
          col[i * 3 + 1] = c.g;
          col[i * 3 + 2] = c.b;
        }
        geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
      }
      if (!buckets.has(key)) buckets.set(key, { cls, material: m.material, geos: [], cast: m.castShadow, receive: m.receiveShadow });
      buckets.get(key).geos.push(geo);
    }
    const out = new THREE.Group();
    out.name = g.name;
    for (const bk of buckets.values()) {
      const merged = bk.geos.length > 1 ? mergeGeometries(bk.geos, false) : bk.geos[0];
      if (!merged) return g;
      const material = bk.cls ? lib.vertexColour(bk.cls) : bk.material;
      const mesh = new THREE.Mesh(merged, material);
      mesh.castShadow = bk.cast;
      mesh.receiveShadow = bk.receive;
      out.add(mesh);
    }
    for (const m of meshes) m.geometry.dispose();
    return out;
  } catch {
    return g;
  }
}
