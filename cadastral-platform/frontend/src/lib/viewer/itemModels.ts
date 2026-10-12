import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { CatalogueItem } from './types';

const texCache = new Map<string, THREE.Texture>();
const gltfCache = new Map<string, Promise<THREE.Object3D>>();
let loader: GLTFLoader | null = null;

function imageTexture(url?: string): THREE.Texture | null {
  if (!url) return null;
  let t = texCache.get(url);
  if (!t) { t = new THREE.TextureLoader().load(url); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; texCache.set(url, t); }
  return t;
}
function proxyBox(c: CatalogueItem): THREE.Object3D {
  const { w, d, h } = c.dims, g = new THREE.BoxGeometry(w, d, h); g.translate(0, 0, h / 2);
  const mesh = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: 0xffffff, map: imageTexture(c.image), roughness: 0.75 }));
  mesh.castShadow = mesh.receiveShadow = true; mesh.name = 'proxy';
  const e = new THREE.LineSegments(new THREE.EdgesGeometry(g), new THREE.LineBasicMaterial({ color: 0x14161a, transparent: true, opacity: 0.45 })); mesh.add(e);
  return mesh;
}
/** Item group: base-centre at origin, +Z up, front faces +Y. Proxy box shows until a glTF finishes loading. */
export function createItemObject(c: CatalogueItem, onReady?: () => void): THREE.Group {
  const grp = new THREE.Group(); grp.userData.catId = c.id; grp.add(proxyBox(c));
  if ((c.model_kind === 'glb' || c.model_kind === 'gltf') && c.model_url) {
    const url = c.model_url; loader ??= new GLTFLoader();
    let p = gltfCache.get(url); if (!p) { p = loader.loadAsync(url).then((g) => g.scene); gltfCache.set(url, p); }
    p.then((scene) => {
      const o = scene.clone(true); o.rotation.x = Math.PI / 2; // glTF is Y-up
      const wrap = new THREE.Group(); wrap.add(o);
      const bb = new THREE.Box3().setFromObject(wrap), sz = bb.getSize(new THREE.Vector3()); // sz in z-up frame
      wrap.scale.set(c.dims.w / (sz.x || 1), c.dims.d / (sz.y || 1), c.dims.h / (sz.z || 1)); wrap.updateMatrixWorld(true);
      const b2 = new THREE.Box3().setFromObject(wrap); wrap.position.set(-(b2.min.x + b2.max.x) / 2, -(b2.min.y + b2.max.y) / 2, -b2.min.z);
      wrap.traverse((m) => { if ((m as THREE.Mesh).isMesh) m.castShadow = m.receiveShadow = true; });
      grp.clear(); grp.add(wrap); onReady?.();
    }).catch(() => { /* keep the proxy: honest fallback */ });
  }
  return grp;
}
/** Make an object translucent with a validity tint (ghost preview). Clones materials once. */
export function styleGhost(o: THREE.Object3D, ok: boolean) {
  o.traverse((m) => {
    const mesh = m as THREE.Mesh; if (!mesh.isMesh) return;
    if (!mesh.userData.ghostMat) { mesh.userData.ghostMat = true; mesh.material = (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).map((x) => { const y = (x as THREE.MeshStandardMaterial).clone(); y.transparent = true; y.opacity = 0.65; y.depthWrite = false; return y; }); }
    for (const x of mesh.material as THREE.MeshStandardMaterial[]) if (x.emissive) { x.emissive.set(ok ? 0x2a7a3a : 0xa02020); x.emissiveIntensity = 0.45; }
    mesh.castShadow = false;
  });
}
