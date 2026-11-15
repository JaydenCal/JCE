// Source of the 3D viewer that is inlined into the interactive HTML export. Built by tools/build-html-viewer.mjs into
// src/premium/exporters/html-viewer.generated.js (a string of minified JavaScript, three.js included).
// Runs offline: no network access, no CDN. window.PA3D.start(container, base64, encoding) shows the embedded GLB.

import {
  WebGLRenderer, Scene, PerspectiveCamera, HemisphereLight, DirectionalLight, Box3, Vector3, Mesh, Group,
  CircleGeometry, PlaneGeometry, BoxGeometry, CylinderGeometry, IcosahedronGeometry, MeshStandardMaterial, MeshBasicMaterial,
  CanvasTexture, RepeatWrapping, LinearMipmapLinearFilter, Color, SRGBColorSpace, PCFSoftShadowMap, NeutralToneMapping, Raycaster, Vector2,
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

// The hero setting for a building with no lot: a striped mown lawn around it, dry paddock beyond, a timber post and rail fence on the
// two sides and the rear (the front faces the opening camera), and a few clear trunked trees that cast shadows but are not shaded
// themselves. Everything is drawn here, so the file stays self contained. Returns the half size of the lawn in metres.
function lawnTexture(aniso) {
  const n = 512;
  const c = document.createElement('canvas');
  c.width = n; c.height = n;
  const g = c.getContext('2d');
  g.fillStyle = '#879b54'; g.fillRect(0, 0, n / 2, n);
  g.fillStyle = '#819550'; g.fillRect(n / 2, 0, n / 2, n);
  let s = 12345;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (let i = 0; i < 14000; i++) {
    g.strokeStyle = `rgba(${rnd() < 0.6 ? '0,0,0' : '255,255,255'},${0.05 + rnd() * 0.1})`;
    const x = rnd() * n; const y = rnd() * n;
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + (rnd() - 0.5) * 3, y + 2 + rnd() * 3); g.stroke();
  }
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.wrapS = RepeatWrapping; t.wrapT = RepeatWrapping;
  t.minFilter = LinearMipmapLinearFilter;
  t.anisotropy = aniso;
  return t;
}

function addSetting(scene, box, aniso) {
  const size = box.getSize(new Vector3());
  const c = box.getCenter(new Vector3());
  const y = box.min.y - 0.02;
  const hx = size.x / 2 + 9; const hz = size.z / 2 + 10;
  const g = new Group();
  const paddock = new Mesh(new CircleGeometry(Math.max(hx, hz) * 14, 48), new MeshStandardMaterial({ color: new Color('#a5a57c'), roughness: 1 }));
  paddock.rotation.x = -Math.PI / 2; paddock.position.set(c.x, y - 0.02, c.z); paddock.receiveShadow = true;
  const tex = lawnTexture(aniso);
  tex.repeat.set((hx * 2) / 6, (hz * 2) / 6); // one tile is 6 m: two 3 m mowing bands
  const lawn = new Mesh(new PlaneGeometry(hx * 2, hz * 2), new MeshStandardMaterial({ map: tex, roughness: 1 }));
  lawn.rotation.x = -Math.PI / 2; lawn.position.set(c.x, y, c.z); lawn.receiveShadow = true;
  g.add(paddock, lawn);
  // timber post and rail fence: left, right and rear (the rear is the low z side, away from the opening camera)
  const wood = new MeshStandardMaterial({ color: new Color('#8a6b47'), roughness: 0.9 });
  const run = (x0, z0, x1, z1) => {
    const len = Math.hypot(x1 - x0, z1 - z0);
    const k = Math.max(1, Math.round(len / 2.7));
    const ang = Math.atan2(z1 - z0, x1 - x0);
    for (let i = 0; i <= k; i++) {
      const p = new Mesh(new BoxGeometry(0.11, 1.2, 0.11), wood);
      p.position.set(x0 + ((x1 - x0) * i) / k, y + 0.6, z0 + ((z1 - z0) * i) / k);
      p.castShadow = true; g.add(p);
    }
    for (const h of [0.5, 0.98]) {
      const rail = new Mesh(new BoxGeometry(len, 0.09, 0.045), wood);
      rail.position.set((x0 + x1) / 2, y + h, (z0 + z1) / 2); rail.rotation.y = -ang;
      rail.castShadow = true; g.add(rail);
    }
  };
  run(c.x - hx, c.z - hz, c.x + hx, c.z - hz);
  run(c.x - hx, c.z - hz, c.x - hx, c.z + hz);
  run(c.x + hx, c.z - hz, c.x + hx, c.z + hz);
  // trees: unlit, with a clear trunk, casting long shadows
  const greens = ['#3f7436', '#4d8340', '#35692f', '#5b8f44'];
  const tree = (x, z, h, k) => {
    const trunk = new Mesh(new CylinderGeometry(0.1, 0.16, h * 0.62, 7), new MeshBasicMaterial({ color: new Color('#5c4533') }));
    trunk.position.set(x, y + h * 0.31, z); trunk.castShadow = true; g.add(trunk);
    const col = new Color(greens[k % greens.length]);
    for (const [dx, dy, dz, r, tone] of [[0, 0.72, 0, 0.36, 0.95], [0.26, 0.64, 0.1, 0.28, 0.85], [-0.24, 0.67, -0.12, 0.29, 0.9], [0.03, 0.9, 0.03, 0.26, 1.12], [-0.1, 0.6, 0.27, 0.22, 0.8], [0.17, 0.8, -0.23, 0.23, 1.02]]) {
      const b = new Mesh(new IcosahedronGeometry(r * h * 0.85, 2), new MeshBasicMaterial({ color: col.clone().multiplyScalar(tone) }));
      b.position.set(x + dx * h * 0.85, y + dy * h, z + dz * h * 0.85); b.scale.y = 0.88; b.castShadow = true; g.add(b);
    }
  };
  tree(c.x - hx + 2.2, c.z - hz + 2.4, 6.2, 0);
  tree(c.x + hx - 2.6, c.z - hz + 2.0, 5.4, 1);
  tree(c.x - hx - 4.5, c.z + hz * 0.2, 6.8, 2);
  tree(c.x + hx + 4.0, c.z - hz * 0.3, 6.0, 3);
  tree(c.x - hx * 0.2, c.z - hz - 5.0, 7.0, 1);
  scene.add(g);
  return Math.max(hx, hz) + 8;
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
  // The same look as the online viewers (the homepage hero render): a warm afternoon sun about 34 degrees up with long soft shadows,
  // a gentle warm sky light, neutral tone mapping. No fog.
  renderer.toneMapping = NeutralToneMapping;
  renderer.toneMappingExposure = 1.02;
  // (this viewer has no sky reflection map, so the light is set a little less warm than online to land on the same picture)
  scene.add(new HemisphereLight(0xeef0f2, 0xa7a59a, 1.25));
  const sun = new DirectionalLight(0xfff0dc, 2.8);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.04;
  sun.shadow.radius = 1.6;
  scene.add(sun, sun.target);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.maxPolarAngle = Math.PI * 0.495;
  controls.screenSpacePanning = true;
  controls.zoomToCursor = true;
  // Orbit about the point under the cursor for each drag; the camera stays where it is.
  const ray = new Raycaster();
  const ndc = new Vector2();
  renderer.domElement.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || !home) return;
    const r = renderer.domElement.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const hit = ray.intersectObjects(scene.children, true).find((h) => h.object.isMesh && h.object.visible);
    if (hit) { controls.target.copy(hit.point); controls.update(); }
  }, true);

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
    // A model exported with its lot already carries its own ground; a building on its own gets the hero setting around it.
    let hasSite = false;
    model.traverse((o) => { if (/^site-terrain/.test(o.name || '')) hasSite = true; });
    const pad = hasSite ? 0 : addSetting(scene, box, renderer.capabilities.getMaxAnisotropy());
    const sd = new Vector3(-0.56, 0.56, 0.61).normalize();
    sun.position.copy(centre).addScaledVector(sd, span * 3 + 20);
    sun.target.position.copy(centre);
    const sc = sun.shadow.camera;
    const r = Math.max(span * 1.2, pad);
    sc.left = -r; sc.right = r; sc.top = r; sc.bottom = -r; sc.near = 0.5; sc.far = span * 7 + 80;
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
