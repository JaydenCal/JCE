// Material library for the 3D model. Procedural CanvasTextures when a DOM exists and textures are
// wanted, plain colours otherwise (Node tests and server exports). Materials are cached by key and
// shared across rebuilds; model disposal must not dispose them (userData.shared is set).

import * as THREE from 'three';
import { TEXTURE_SPECS, makeTextures } from './textures.js';

const UNKNOWN_COLOUR = '#c8c8c8';

// Used only when the catalogue is absent (tests, tools). The catalogue is the source of truth.
export const FALLBACK_COLOURS = {
  'brick-light-grey': '#b9b3a9',
  'paint-white': '#f1efe9',
  'steel-charcoal': '#42474c',
  'frame-black': '#25272a',
  'floor-natural-oak': '#c49a6c',
  'steel-off-white': '#e8e6df',
  'floor-concrete': '#b3b2ad',
  'steel-dune': '#a69a85',
};

export function resolveHex(catalogue, colourId) {
  if (!colourId) return UNKNOWN_COLOUR;
  if (/^#[0-9a-f]{6}$/i.test(colourId)) return colourId;
  let hex = null;
  try {
    hex = catalogue?.finishes?.getColour?.(colourId)?.hex ?? null;
  } catch {
    hex = null;
  }
  if (hex) return hex;
  if (!catalogue?.finishes?.getColour && FALLBACK_COLOURS[colourId]) return FALLBACK_COLOURS[colourId];
  return UNKNOWN_COLOUR;
}

const TINT = {
  new: { colour: new THREE.Color('#4f9bd9'), amount: 0.16 },
  demolish: { colour: new THREE.Color('#d9453d'), amount: 0.6 },
};

const PROPS = {
  paint: { rough: 0.9, metal: 0 },
  plain: { rough: 0.85, metal: 0 },
};

export function createMaterialLibrary({ textures = true, catalogue = null } = {}) {
  const useTextures = !!textures && typeof document !== 'undefined';
  const texCache = new Map();
  const matCache = new Map();
  let disposed = false;

  function texturesFor(materialId) {
    if (!useTextures) return null;
    let key = materialId;
    try {
      const def = catalogue?.finishes?.getMaterial?.(materialId);
      if (def?.texture && TEXTURE_SPECS[def.texture]) key = def.texture;
    } catch {
      key = materialId;
    }
    const spec = TEXTURE_SPECS[key];
    if (!spec) return null;
    if (!texCache.has(key)) {
      let t = null;
      try {
        t = makeTextures(THREE, key, spec);
      } catch {
        t = null;
      }
      texCache.set(key, t ? { ...t, spec } : null);
    }
    return texCache.get(key);
  }

  function applyTint(material, tint) {
    if (!tint || !TINT[tint]) return;
    const t = TINT[tint];
    material.color.lerp(t.colour, t.amount);
    if (tint === 'demolish') {
      material.transparent = true;
      material.opacity = 0.5;
      material.depthWrite = false;
    }
  }

  function remember(key, material) {
    material.userData.shared = true;
    matCache.set(key, material);
    return material;
  }

  // materialId: wall, roof or floor material id (or 'paint'); colourHex: '#rrggbb'.
  function get(materialId, colourHex = UNKNOWN_COLOUR, opts = {}) {
    const key = `m|${materialId}|${colourHex}|${opts.tint || ''}|${opts.side || ''}|${opts.flat ? 1 : 0}`;
    const hit = matCache.get(key);
    if (hit) return hit;
    const tex = opts.flat ? null : texturesFor(materialId);
    const spec = TEXTURE_SPECS[materialId] || tex?.spec;
    const props = PROPS[materialId] || { rough: spec?.rough ?? 0.85, metal: spec?.metal ?? 0 };
    const m = new THREE.MeshStandardMaterial({
      color: new THREE.Color(colourHex),
      roughness: props.rough,
      metalness: props.metal,
      side: opts.side === 'double' ? THREE.DoubleSide : THREE.FrontSide,
    });
    if (tex?.map) {
      m.map = tex.map;
      if (tex.normal) m.normalMap = tex.normal;
    }
    applyTint(m, opts.tint);
    return remember(key, m);
  }

  function plain(colourHex = UNKNOWN_COLOUR, opts = {}) {
    const key = `p|${colourHex}|${opts.tint || ''}|${opts.side || ''}|${opts.rough ?? ''}|${opts.metal ?? ''}`;
    const hit = matCache.get(key);
    if (hit) return hit;
    const m = new THREE.MeshStandardMaterial({
      color: new THREE.Color(colourHex),
      roughness: opts.rough ?? PROPS.plain.rough,
      metalness: opts.metal ?? 0,
      side: opts.side === 'double' ? THREE.DoubleSide : THREE.FrontSide,
    });
    applyTint(m, opts.tint);
    return remember(key, m);
  }

  // One shared material for objects whose colours are baked into vertex colours (furniture).
  function vertexColour(opts = {}) {
    const rough = opts.rough ?? 0.8;
    const metal = opts.metal ?? 0;
    const key = `v|${rough}|${metal}|${opts.side === 'double' ? 1 : 0}`;
    const hit = matCache.get(key);
    if (hit) return hit;
    const m = new THREE.MeshStandardMaterial({
      vertexColors: true,
      color: 0xffffff,
      roughness: rough,
      metalness: metal,
      side: opts.side === 'double' ? THREE.DoubleSide : THREE.FrontSide,
    });
    return remember(key, m);
  }

  function frame(colourHex = '#25272a', opts = {}) {
    return plain(colourHex, { rough: 0.5, metal: 0.35, ...opts });
  }

  function glass(opts = {}) {
    const key = `g|${opts.tint || ''}`;
    const hit = matCache.get(key);
    if (hit) return hit;
    const m = new THREE.MeshStandardMaterial({
      color: new THREE.Color('#9cc7de'),
      roughness: 0.05,
      metalness: 0.1,
      transparent: true,
      opacity: 0.34,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    if (opts.tint === 'demolish') m.color.lerp(TINT.demolish.colour, 0.5);
    return remember(key, m);
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    for (const m of matCache.values()) m.dispose();
    matCache.clear();
    for (const t of texCache.values()) {
      if (!t) continue;
      t.map?.dispose();
      t.normal?.dispose();
    }
    texCache.clear();
  }

  return {
    get,
    plain,
    frame,
    vertexColour,
    glass,
    dispose,
    hex: (id) => resolveHex(catalogue, id),
    hasTextures: useTextures,
  };
}
