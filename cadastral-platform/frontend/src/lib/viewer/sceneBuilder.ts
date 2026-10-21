import * as THREE from 'three';
import type { PartDef, SceneBundle } from './types';
import { makeSprite, makeTextures } from './textures';
import { AERIAL_LAYER, XRAY_OPACITY } from './aerial';

export const LABEL_ACCENT: Record<string, string> = { lab_sw: '#1f5fd1', lab_grade: '#b8860b', lab_gen: '#6b6f75', labels: '#a8842f' };
export const DOUBLE = new Set(['road', 'surface', 'cutfill', 'boundary', 'context', 'existing', 'gradearrows', 'linemarking', 'edgestrips', 'water', 'dbyd', 'services']);
/** `services` (backend SA6 services) is treated exactly as `dbyd`; `dbyd` stays reserved for DBYD-sourced data. */
export const GHOST_SERVICE = new Set(['dbyd', 'services']);
export const XRAY_BUILDINGS = ['buildings', 'tanks'];
export const XRAY_GROUND = ['surface', 'road', 'context', 'existing', 'edgestrips', 'linemarking', 'walls', AERIAL_LAYER];
const NO_EDGE = ['RollerDoors', 'Door', 'Glazing'];

export interface Built {
  root: THREE.Group; itemsGroup: THREE.Group; lights: THREE.Group;
  meshes: THREE.Mesh[]; edgeLines: THREE.LineSegments[]; lineObjs: THREE.LineSegments[]; sprites: THREE.Sprite[];
  bbox: THREE.Box3; centre: THREE.Vector3; size: THREE.Vector3; radius: number; z0: number;
  sun: THREE.DirectionalLight; hemi: THREE.HemisphereLight; egMesh: THREE.Mesh | undefined;
  dispose(): void;
}

export function buildScene(b: SceneBundle, edgeColour: string): Built {
  const TEX = makeTextures();
  const root = new THREE.Group(), itemsGroup = new THREE.Group(), lights = new THREE.Group(); root.add(itemsGroup);
  const meshes: THREE.Mesh[] = [], edgeLines: THREE.LineSegments[] = [], lineObjs: THREE.LineSegments[] = [], sprites: THREE.Sprite[] = [];
  const bbox = new THREE.Box3();
  // Aerial imagery (information only): an unlit textured copy of the ground, loaded from the bundle's data URI / URL.
  const aerialMats: THREE.Material[] = []; let aerialTex: THREE.Texture | null = null;
  if (b.info.ground_texture && typeof document !== 'undefined') {
    aerialTex = new THREE.TextureLoader().load(b.info.ground_texture, () => aerialMats.forEach((m) => { m.needsUpdate = true; }));
    aerialTex.colorSpace = THREE.SRGBColorSpace; aerialTex.anisotropy = 8; aerialTex.wrapS = aerialTex.wrapT = THREE.ClampToEdgeWrapping;
  }
  const mkMat = (p: PartDef): THREE.Material => {
    if (p.c === AERIAL_LAYER) {
      const m = new THREE.MeshBasicMaterial({ color: 0xffffff, map: aerialTex, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
      aerialMats.push(m); return m;
    }
    const a = p.a ?? 1, dbl = a < 1 || p.ds || DOUBLE.has(p.c);
    const m = new THREE.MeshStandardMaterial({ color: new THREE.Color(p.col), roughness: p.ro ?? 0.8, metalness: p.me ?? 0, transparent: a < 1, opacity: a, side: dbl ? THREE.DoubleSide : THREE.FrontSide, vertexColors: !!p.vc });
    if (p.tex && TEX[p.tex] && p.uv) m.map = TEX[p.tex];
    if (p.eml) { m.emissive = new THREE.Color(p.col); m.emissiveIntensity = p.eml; }
    if (GHOST_SERVICE.has(p.c)) m.depthWrite = false;
    return m;
  };
  for (const p of b.parts) {
    if (p.lines) {
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(p.lines, 3));
      const l = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: new THREE.Color(p.col), transparent: true, opacity: p.c === 'contours' ? 0.55 : p.a ?? 1 }));
      l.userData = { name: p.n, c: p.c }; root.add(l); lineObjs.push(l); continue;
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(p.v!, 3));
    if (p.vc) g.setAttribute('color', new THREE.Float32BufferAttribute(p.vc, 3));
    if (p.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(p.uv, 2));
    if (p.f) g.setIndex(p.f);
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, mkMat(p)); m.castShadow = !!p.cs && p.c !== AERIAL_LAYER; m.receiveShadow = p.c !== 'water' && p.c !== AERIAL_LAYER;
    m.userData = { name: p.n, c: p.c, mat: m.material, xmat: null, eml: !!p.eml };
    root.add(m); meshes.push(m);
    if (p.c !== 'cutfill' && p.c !== 'context') { g.computeBoundingBox(); bbox.union(g.boundingBox!); }
    if (p.c === 'buildings' && !NO_EDGE.some((s) => p.n.includes(s))) {
      const e = new THREE.LineSegments(new THREE.EdgesGeometry(g, 28), new THREE.LineBasicMaterial({ color: edgeColour, transparent: true, opacity: 0.28 }));
      e.userData = { c: p.c, owner: m }; root.add(e); edgeLines.push(e);
    }
  }
  for (const L of b.labels ?? []) { const sp = makeSprite(L.t, L.s ?? 1, LABEL_ACCENT[L.c] ?? '#a8842f'); sp.position.set(...L.p); sp.userData = { c: L.c }; root.add(sp); sprites.push(sp); }
  if (bbox.isEmpty()) bbox.set(new THREE.Vector3(-10, -10, 0), new THREE.Vector3(10, 10, 5));
  const centre = bbox.getCenter(new THREE.Vector3()), size = bbox.getSize(new THREE.Vector3()), radius = size.length() / 2;
  const z0 = b.info.z0 ?? bbox.min.z;

  const hemi = new THREE.HemisphereLight(0xffffff, 0x8a8f99, 0.8 * Math.PI);
  const sun = new THREE.DirectionalLight(0xffffff, 0.9 * Math.PI);
  sun.position.set(centre.x + 25, centre.y + 45, centre.z + 70); sun.target.position.copy(centre);
  sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera, ext = Math.max(40, Math.min(radius * 1.2, 120)); sc.left = -ext; sc.right = ext; sc.top = ext; sc.bottom = -ext; sc.near = 1; sc.far = 300;
  sun.shadow.bias = -0.0008; sun.shadow.normalBias = 0.03; lights.add(hemi, sun, sun.target);
  const egMesh = meshes.find((m) => m.userData.name === 'EG_survey_TIN') ?? meshes.find((m) => m.userData.c === 'existing');
  return {
    root, itemsGroup, lights, meshes, edgeLines, lineObjs, sprites, bbox, centre, size, radius, z0, sun, hemi, egMesh,
    dispose() { aerialTex?.dispose(); root.traverse((o: any) => { o.geometry?.dispose?.(); const m = o.material; (Array.isArray(m) ? m : m ? [m] : []).forEach((x: any) => { x.map?.dispose?.(); x.dispose?.(); }); }); Object.values(TEX).forEach((t) => t.dispose()); },
  };
}

export function xrayMeshes(meshes: THREE.Mesh[], cats: string[], on: boolean) {
  for (const m of meshes) {
    if (!cats.includes(m.userData.c)) continue;
    if (on) {
      if (!m.userData.xmat && m.userData.c === AERIAL_LAYER) {       // the aerial stays unlit and keeps its texture and polygon offset; only its opacity drops
        const o = m.userData.mat as THREE.MeshBasicMaterial;
        m.userData.xmat = new THREE.MeshBasicMaterial({ color: 0xffffff, map: o.map ?? null, side: THREE.DoubleSide, transparent: true, opacity: XRAY_OPACITY * o.opacity, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
      } else if (!m.userData.xmat) { const o = m.userData.mat as THREE.MeshStandardMaterial; m.userData.xmat = new THREE.MeshStandardMaterial({ color: o.color, map: o.map ?? null, roughness: 0.9, transparent: true, opacity: XRAY_OPACITY, side: THREE.DoubleSide, depthWrite: false, vertexColors: o.vertexColors }); }
      m.material = m.userData.xmat;
    } else m.material = m.userData.mat;
  }
}
