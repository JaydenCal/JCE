// Source of the 3D viewer that is inlined into the interactive HTML export. Built by tools/build-html-viewer.mjs into
// src/premium/exporters/html-viewer.generated.js (a string of minified JavaScript, three.js included).
// Runs offline: no network access, no CDN. window.PA3D.start(container, base64, encoding) shows the embedded GLB.

import {
  WebGLRenderer, Scene, PerspectiveCamera, HemisphereLight, AmbientLight, DirectionalLight, Box3, Vector3, Mesh,
  CircleGeometry, MeshStandardMaterial, Color, SRGBColorSpace, PCFSoftShadowMap,
} from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

const state = { started: false, active: false };

function message(container, text) {
  const div = document.createElement('div');
  div.className = 'pa-msg';
  div.textContent = text;
  container.appendChild(div);
}

async function decode(base64, encoding) {
  const bin = atob(base64);
  let bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  if (encoding === 'deflate-raw') {
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    bytes = new Uint8Array(await new Response(stream).arrayBuffer());
  }
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

async function start(container, base64, encoding) {
  state.started = true;
  let renderer;
  try {
    renderer = new WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'default' });
    if (!renderer.getContext()) throw new Error('no context');
  } catch {
    message(container, 'The 3D view needs WebGL, which this browser or device does not provide. The floor plans on the Plan tab still work.');
    return;
  }
  // Sharp on high density screens: render at the device pixel ratio, up to 3.
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 3));
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFSoftShadowMap;
  container.insertBefore(renderer.domElement, container.firstChild);

  const scene = new Scene();
  const camera = new PerspectiveCamera(40, 1, 0.1, 2000);
  scene.add(new HemisphereLight(0xffffff, 0x9aa0a7, 1));
  scene.add(new AmbientLight(0xffffff, 0.35));
  const sun = new DirectionalLight(0xfff2e0, 2.2);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  scene.add(sun, sun.target);
  const fill = new DirectionalLight(0xdfe9ff, 0.7);
  fill.position.set(-30, 20, -25);
  scene.add(fill);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.maxPolarAngle = Math.PI * 0.495;
  controls.screenSpacePanning = true;

  const roofParts = [];
  let home = null;
  let dirty = true;

  function resize() {
    const w = container.clientWidth || 1;
    const h = container.clientHeight || 1;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    dirty = true;
  }
  function reset() {
    if (!home) return;
    camera.position.copy(home.pos);
    controls.target.copy(home.target);
    controls.update();
    dirty = true;
  }

  let buffer;
  try {
    buffer = await decode(base64, encoding);
  } catch {
    message(container, 'The 3D model could not be read from this file.');
    return;
  }
  new GLTFLoader().parse(buffer, '', (gltf) => {
    const model = gltf.scene;
    model.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
        for (const m of [].concat(o.material || [])) {
          if (m) {
            m.shadowSide = 1;
            // Textures stay crisp at a distance and at steep angles.
            if (m.map) m.map.anisotropy = renderer.capabilities.getMaxAnisotropy();
          }
        }
      }
      if (/^(roof|ceiling)/i.test(o.name || '')) roofParts.push(o);
    });
    scene.add(model);
    const box = new Box3().setFromObject(model);
    const size = box.getSize(new Vector3());
    const centre = box.getCenter(new Vector3());
    const span = Math.max(size.x, size.z, 4);
    const ground = new Mesh(new CircleGeometry(span * 2.2, 64), new MeshStandardMaterial({ color: new Color('#cfdcc0'), roughness: 1 }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(centre.x, box.min.y - 0.02, centre.z);
    ground.receiveShadow = true;
    scene.add(ground);
    sun.position.set(centre.x + span * 0.9, centre.y + span * 1.4, centre.z + span * 0.6);
    sun.target.position.copy(centre);
    const sc = sun.shadow.camera;
    const r = span * 1.2;
    sc.left = -r; sc.right = r; sc.top = r; sc.bottom = -r; sc.near = 0.5; sc.far = span * 6;
    sc.updateProjectionMatrix();
    const dist = span * 0.95 + size.y * 1.2;
    home = { pos: new Vector3(centre.x + dist * 0.62, centre.y + dist * 0.58, centre.z + dist * 0.78), target: centre.clone() };
    camera.near = Math.max(0.1, dist / 200);
    camera.far = dist * 40;
    camera.updateProjectionMatrix();
    controls.minDistance = Math.max(1.5, span * 0.15);
    controls.maxDistance = dist * 4;
    reset();
    const roofBtn = document.getElementById('pa-roof');
    if (roofBtn && roofParts.length) {
      roofBtn.hidden = false;
      roofBtn.onclick = () => {
        const on = roofBtn.getAttribute('aria-pressed') !== 'true';
        roofBtn.setAttribute('aria-pressed', String(on));
        roofBtn.textContent = on ? 'Roof on' : 'Roof off';
        for (const p of roofParts) p.visible = on;
        dirty = true;
      };
    }
    dirty = true;
  }, () => message(container, 'The 3D model could not be read from this file.'));

  const resetBtn = document.getElementById('pa-reset');
  if (resetBtn) resetBtn.onclick = reset;
  controls.addEventListener('change', () => { dirty = true; });
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(resize).observe(container);
  window.addEventListener('resize', resize);
  resize();
  function frame() {
    requestAnimationFrame(frame);
    if (!state.active) return;
    const moved = controls.update();
    if (dirty || moved) {
      renderer.render(scene, camera);
      dirty = false;
    }
  }
  state.active = true;
  frame();
  state.renderer = renderer;
}

state.start = start;
state.setActive = (on) => { state.active = !!on; };
window.PA3D = state;
