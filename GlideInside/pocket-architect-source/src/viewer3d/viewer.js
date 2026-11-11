// 3D viewer: WebGL renderer, orbit camera, picking, finish picker and walk mode.
// createViewer3D(element, store, { catalogue }) -> { setActive, setMode, setEdit, resetCamera, getModel, snapshot, dispose }
// Edit in 3D (key B or the Edit toggle) is in edit.js; door animation for the walk-through is in doors.js.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { buildModel, disposeModel, modelBounds } from './build.js';
import { addBreachOverlay } from './breach.js';
import { createMaterialLibrary } from './materials.js';
import { createPicker } from './picker.js';
import { createWalk } from './walk.js';
import { createDoors } from './doors.js';
import { createEdit } from './edit.js';
import { createAhead } from './ahead.js';
import { VIEWER_CSS } from './viewer-css.js';
import { loadBitmap } from '../editor2d/underlay.js';
import { edgeColourOf } from './terrain.js';
import { snapToRoom as snapRoom, flyTo as flyToPose, enableRoomCutaway, createRoomBar, roomTabs as roomTabsOf } from './rooms.js';

const STYLE_ID = 'ps3d-style';
const RAD = Math.PI / 180;
const SUN_DIR = new THREE.Vector3(-0.45, 0.78, 0.65).normalize();
// With a lot loaded plan up is grid north and the sun is in the northern sky (southern hemisphere), so a street frontage on the
// north side is lit. 'warm' is a low afternoon sun from the north west with longer shadows.
const SUN_PRESETS = {
  day: { dir: new THREE.Vector3(0.5, 0.72, -0.5).normalize(), color: '#fff3e0', intensity: 2.9, hemi: 1.2, exposure: 1.0 },
  warm: { dir: new THREE.Vector3(-0.72, 0.36, -0.58).normalize(), color: '#ffd9a8', intensity: 3.3, hemi: 0.95, exposure: 1.05 },
};
// Sky and ground are tuned for the white app theme: the horizon is a clear blue grey rather than near white,
// so the edge of the view reads against a white page and white overlay chips stand out on it.
const SKY = { top: '#5d92d8', horizon: '#c9dcee', ground: '#9aa28f' };

function injectStyle() {
  if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return;
  const el = document.createElement('style');
  el.id = STYLE_ID;
  el.textContent = VIEWER_CSS;
  document.head.appendChild(el);
}

function makeSky() {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: false,
    fog: false,
    uniforms: {
      top: { value: new THREE.Color(SKY.top) },
      horizon: { value: new THREE.Color(SKY.horizon) },
      ground: { value: new THREE.Color(SKY.ground) },
    },
    vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `uniform vec3 top; uniform vec3 horizon; uniform vec3 ground; varying vec3 vDir;
      void main(){ float h = vDir.y; vec3 c = h > 0.0 ? mix(horizon, top, pow(h, 0.5)) : mix(horizon, ground, smoothstep(0.0, -0.3, h));
      gl_FragColor = vec4(c, 1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(500, 24, 16), mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = -100;
  mesh.name = 'sky';
  return mesh;
}

export function createViewer3D(element, store, { catalogue = null, adaptive = true } = {}) {
  injectStyle();
  if (getComputedStyle(element).position === 'static') element.style.position = 'relative';
  const rootEl = document.createElement('div');
  rootEl.className = 'ps3d-root';
  element.appendChild(rootEl);
  const reduceMotion = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  } catch (e) {
    const note = document.createElement('div');
    note.className = 'ps3d-note';
    note.textContent = '3D view needs WebGL, which is not available in this browser. The 2D plan still works.';
    rootEl.appendChild(note);
    const noop = () => {};
    return { setActive: noop, setMode: noop, setEdit: noop, placeItemAhead: () => null, armItemAhead: () => false, armOpeningAhead: () => false, resetCamera: noop, getModel: () => null, snapshot: async () => null, snapToRoom: async () => null, roomTabs: () => [], dispose: () => rootEl.remove(), unavailable: true };
  }
  const canvas = renderer.domElement;
  canvas.className = 'ps3d-canvas';
  canvas.tabIndex = 0;
  canvas.setAttribute('role', 'application');
  canvas.setAttribute('aria-label', '3D view of the design. Drag to orbit, scroll to zoom, arrow keys to move the view.');
  rootEl.appendChild(canvas);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  const sky = makeSky();
  scene.add(sky);
  // No fog: the owner wants a sharp model. The site fades to the horizon colour by itself (terrain.js, fade ring).
  const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 2000);
  camera.position.set(14, 10, 16);

  // Image based lighting from the same sky gradient, so metal roofs, glass and gloss pick up the sky.
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envScene = new THREE.Scene();
  envScene.add(makeSky());
  const envTarget = pmrem.fromScene(envScene, 0, 0.1, 1000);
  scene.environment = envTarget.texture;
  scene.environmentIntensity = 0.45;
  envScene.traverse((o) => {
    o.geometry?.dispose?.();
    o.material?.dispose?.();
  });

  const hemi = new THREE.HemisphereLight('#dbe8f8', '#8d8a7c', 1.2);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight('#fff3e0', 2.9);
  sun.castShadow = true;
  sun.shadow.mapSize.set(3072, 3072);
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.04;
  sun.shadow.radius = 3;
  scene.add(sun, sun.target);
  const headlight = new THREE.PointLight('#fff1dd', 0, 16, 1.6);
  scene.add(headlight);

  const lib = createMaterialLibrary({ textures: true, catalogue });
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.09;
  controls.maxPolarAngle = Math.PI / 2 - 0.02;
  controls.screenSpacePanning = true;
  controls.zoomToCursor = true;
  controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
  controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
  controls.target.set(5, 1.2, 4);
  controls.keyPanSpeed = 14;
  controls.listenToKeyEvents(canvas); // arrow keys pan while the view has focus

  const picker = createPicker({ container: rootEl, store, catalogue });
  const doors = createDoors({ invalidate: () => invalidate() });
  const walk = createWalk({
    camera, canvas, container: rootEl, store, doors,
    onExit: () => store.setUI({ view: '3d' }),
    // the furniture, tank or stairs under the crosshair
    lookAt: () => {
      const r = canvas.getBoundingClientRect();
      return pickAt(r.left + r.width / 2, r.top + r.height / 2);
    },
  });

  const hints = document.createElement('div');
  hints.className = 'ps3d-hints';
  // No how-to panel over the model: one short chip that fades on its own. The view buttons sit at the bottom left.
  const HINTS_DEFAULT = '<span class="ps3d-chip">Drag to orbit, scroll to zoom</span>';
  hints.innerHTML = HINTS_DEFAULT;
  rootEl.appendChild(hints);
  let hintTimer = null;
  const fadeHints = () => hints.classList.add('is-faded');

  // State -----------------------------------------------------------------------------------------
  // In the split view the plan editor and this viewer are on screen together: the viewer only takes keys while the pointer is over it
  // or it has focus, so a key press is never answered twice.
  const keysOk = () => store.ui.view !== 'split' || rootEl.matches(':hover') || rootEl.contains(document.activeElement);
  let active = false;
  let mode = store.ui.view === 'walk' ? 'walk' : 'orbit';
  let model = null;
  let bounds = null;
  let points = [];
  let housePoints = [];
  let dirtyModel = true;
  let framed = false;
  let lastProjectId = null;
  let rebuildTimer = null;
  let raf = 0;
  let needsRender = true;
  let anim = null;
  let savedOrbit = null;
  let disposed = false;
  let lastTime = performance.now();
  const perf = { ema: 0.016, slow: 0, frames: 0, shadows: true };
  const stats = { buildMs: 0, builds: 0, frames: 0 };
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();

  const invalidate = () => {
    needsRender = true;
  };
  controls.addEventListener('change', invalidate);

  function resize() {
    const w = rootEl.clientWidth;
    const h = rootEl.clientHeight;
    if (w < 2 || h < 2) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    applyInset();
    camera.updateProjectionMatrix();
    invalidate();
  }

  // Inset: screen margins that overlay cards cover (lot card, minimap). The lot is framed in the clear area: the projection is shifted
  // by half the difference and the camera pulled back so the whole lot fits inside what is left.
  let inset = { l: 0, r: 0, t: 0, b: 0 };
  let userMoved = false;
  let lastKind = null;
  function insetScale() {
    const w = rootEl.clientWidth;
    const h = rootEl.clientHeight;
    if (mode === 'walk' || w < 2 || h < 2) return 1;
    const fx = w / Math.max(w * 0.4, w - inset.l - inset.r);
    const fy = h / Math.max(h * 0.4, h - inset.t - inset.b);
    return Math.min(2.2, Math.max(1, fx, fy));
  }
  function applyInset() {
    const w = rootEl.clientWidth;
    const h = rootEl.clientHeight;
    const none = !inset.l && !inset.r && !inset.t && !inset.b;
    if (none || mode === 'walk' || w < 2 || h < 2) {
      if (camera.view) camera.clearViewOffset();
      return;
    }
    camera.setViewOffset(w, h, -(inset.l - inset.r) / 2, (inset.b - inset.t) / 2, w, h);
  }
  function setInset(next = {}) {
    const n = { l: Math.max(0, next.left || 0), r: Math.max(0, next.right || 0), t: Math.max(0, next.top || 0), b: Math.max(0, next.bottom || 0) };
    if (n.l === inset.l && n.r === inset.r && n.t === inset.t && n.b === inset.b) return;
    inset = n;
    applyInset();
    camera.updateProjectionMatrix();
    if (!userMoved && framed && bounds) frameCamera(false, lastKind);
    invalidate();
  }
  controls.addEventListener('start', () => { userMoved = true; });
  const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(resize) : null;
  ro?.observe(rootEl);
  window.addEventListener('resize', resize);

  const edit = createEdit({
    rootEl, canvas, scene, camera, controls, store, catalogue,
    getModel: () => model,
    pickAt: (x, y) => pickAt(x, y),
    invalidate,
    getMode: () => mode,
    isActive: () => active,
    suspended: () => !!ahead?.isArmed,
    keysOk: () => keysOk(),
  });
  walk.setItems(edit.items);
  const ahead = createAhead({
    scene, camera, canvas, rootEl, store, catalogue, controls, walk, edit,
    pickAt: (x, y) => pickAt(x, y),
    getMode: () => mode,
    isActive: () => active,
    keysOk: () => keysOk(),
    invalidate,
  });
  // Editing needs a clear view of the rooms, so the roof is hidden while Edit is on and restored after.
  let roofHiddenByEdit = false;
  edit.onChange = (on) => {
    picker.close();
    if (on && store.ui.showRoof !== false) {
      roofHiddenByEdit = true;
      store.setUI({ showRoof: false });
    } else if (!on && roofHiddenByEdit) {
      roofHiddenByEdit = false;
      if (store.ui.showRoof === false) store.setUI({ showRoof: true });
    }
    hints.innerHTML = on
      ? '<span class="ps3d-chip">Edit is on: drag items and walls to move them, or draw walls, rooms and openings</span><span class="ps3d-chip">Comma and full stop rotate, Delete removes, B turns edit off</span>'
      : HINTS_DEFAULT;
    hints.classList.remove('is-faded');
    clearTimeout(hintTimer);
    hintTimer = setTimeout(fadeHints, 9000);
  };

  // Model ---------------------------------------------------------------------------------------------
  // Site layers the person can switch in the 3D view (a small chip at the bottom). Remembered per browser.
  const LAYERS_KEY = 'ps.view3d.layers';
  const layers = { contours: false };
  try {
    const saved = JSON.parse(localStorage.getItem(LAYERS_KEY) || 'null');
    if (saved && typeof saved.contours === 'boolean') layers.contours = saved.contours;
  } catch {
    /* storage unavailable: defaults */
  }
  const contoursChip = document.createElement('button');
  contoursChip.type = 'button';
  contoursChip.className = 'ps3d-chip ps3d-chip--toggle';
  contoursChip.dataset.ps = 'contours-toggle';
  const syncContoursChip = () => {
    const lot = store.project.site?.lot;
    contoursChip.hidden = !lot?.contours?.length;
    contoursChip.setAttribute('aria-pressed', String(layers.contours));
    contoursChip.textContent = layers.contours ? 'Contours on' : 'Contours off';
  };
  contoursChip.addEventListener('click', () => {
    layers.contours = !layers.contours;
    try {
      localStorage.setItem(LAYERS_KEY, JSON.stringify(layers));
    } catch {
      /* ignore */
    }
    syncContoursChip();
    scheduleRebuild(10);
  });
  rootEl.appendChild(contoursChip);
  // View buttons (bottom left): fly to the street view, the front of the house or the whole lot, and switch the light.
  const viewBar = document.createElement('div');
  viewBar.className = 'ps3d-viewbar';
  const mkBtn = (label, key, title) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'ps3d-chip ps3d-chip--btn';
    b.dataset.ps = `view3d-${key}`;
    b.textContent = label;
    b.title = title;
    return b;
  };
  const vbHero = mkBtn('Street view', 'hero', 'Three quarter view from the street');
  const vbFront = mkBtn('Front', 'front', 'Close up of the front of the house');
  const vbAerial = mkBtn('Aerial', 'aerial', 'The whole lot from above');
  const vbSun = mkBtn('Warm light', 'sun', 'Switch between midday and late afternoon light');
  vbSun.setAttribute('aria-pressed', 'false');
  viewBar.append(vbHero, vbFront, vbAerial, vbSun);
  rootEl.appendChild(viewBar);
  let sunKey = 'day';
  try {
    sunKey = localStorage.getItem('ps.view3d.sun') === 'warm' ? 'warm' : 'day';
  } catch {
    /* storage unavailable */
  }
  vbSun.setAttribute('aria-pressed', String(sunKey === 'warm'));
  // Aerial texture for the site terrain: loaded from the underlay store, rebuilt when the image changes.
  const site = { key: null, texture: null, edgeColour: null, loading: null };
  function syncSiteTexture() {
    const key = store.project.site?.lot?.aerial?.key || null;
    if (key === site.key) return;
    site.key = key;
    site.texture?.dispose();
    site.texture = null;
    site.edgeColour = null;
    if (!key) return;
    site.loading = loadBitmap(key).then((bmp) => {
      if (!bmp || site.key !== key) return;
      // A canvas copy keeps the usual flipY behaviour (an ImageBitmap cannot be flipped) and is drawn 1:1 for a sharp texture.
      // Full resolution, scaled down only when the GPU cannot take it. No smoothing beyond the resample itself.
      const maxTex = renderer.capabilities.maxTextureSize || 4096;
      const k = Math.min(1, maxTex / Math.max(bmp.w, bmp.h));
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(bmp.w * k));
      c.height = Math.max(1, Math.round(bmp.h * k));
      const cg = c.getContext('2d');
      cg.imageSmoothingEnabled = true;
      cg.imageSmoothingQuality = 'high';
      cg.drawImage(bmp.img, 0, 0, c.width, c.height);
      site.edgeColour = edgeColourOf(c);
      site.texture = new THREE.CanvasTexture(c);
      site.texture.anisotropy = renderer.capabilities.getMaxAnisotropy?.() || 8;
      scheduleRebuild(20);
    });
  }

  function uiOptions() {
    const ui = store.ui;
    return {
      materials: lib,
      catalogue,
      levelFilter: mode === 'walk' ? 'all' : ui.levelFilter || 'all',
      showRoof: ui.showRoof !== false,
      statusView: ui.statusView || 'proposed',
      walk: mode === 'walk',
      siteTexture: site.texture,
      siteEdgeColour: site.edgeColour,
      showContours: layers.contours,
    };
  }

  function lotRadiusM() {
    const bd = store.project.site?.lot?.boundary;
    if (!bd?.length) return 0;
    const xs = bd.map((q) => q.x);
    const ys = bd.map((q) => q.y);
    return Math.hypot(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) / 2000;
  }

  function fitSun() {
    if (!bounds) return;
    const hasLot = !!store.project.site?.lot?.boundary?.length;
    const preset = hasLot ? SUN_PRESETS[sunKey] : { dir: SUN_DIR, color: '#fff3e0', intensity: 2.9, hemi: 1.2, exposure: 1.0 };
    sun.color.set(preset.color);
    sun.intensity = preset.intensity;
    hemi.intensity = mode === 'walk' ? 1.7 : preset.hemi;
    renderer.toneMappingExposure = preset.exposure;
    const sphere = bounds.getBoundingSphere(new THREE.Sphere());
    const r = Math.max(sphere.radius, 4);
    // The shadow box covers the house and, with a lot loaded, the lot itself (fences, trees and the neighbours' boundary sides),
    // so shadows stay sharp (about 4 cm per texel on a 2,000 m2 block) without a second light.
    const e = Math.min(70, Math.max(r * 1.25, lotRadiusM() * 1.02));
    sun.target.position.copy(sphere.center);
    sun.position.copy(sphere.center).addScaledVector(preset.dir, e * 3 + 20);
    const cam = sun.shadow.camera;
    cam.left = -e;
    cam.right = e;
    cam.top = e;
    cam.bottom = -e;
    cam.near = 1;
    cam.far = e * 7 + 60;
    cam.updateProjectionMatrix();
    sun.target.updateMatrixWorld();
  }

  function applyLimits() {
    if (!bounds) return;
    const r = Math.max(bounds.getSize(new THREE.Vector3()).length() / 2, 3);
    controls.minDistance = 1.2;
    controls.maxDistance = r * 9 + 20;
  }

  function rebuild() {
    clearTimeout(rebuildTimer);
    rebuildTimer = null;
    const t0 = performance.now();
    let next;
    try {
      next = buildModel(store.project, uiOptions());
    } catch (e) {
      console.error('[viewer3d] model build failed', e);
      return;
    }
    if (model) {
      scene.remove(model);
      disposeModel(model);
    }
    model = next;
    try { addBreachOverlay(model, store.project); } catch (e) { console.warn('[viewer3d] breach overlay failed', e); }
    scene.add(model);
    doors.attach(model);
    bounds = modelBounds(model);
    points = collectPoints(model);
    housePoints = collectPoints(model, true);
    fitSun();
    applyLimits();
    if (!framed || lastProjectId !== store.project.id) {
      frameCamera(false);
      framed = true;
      lastProjectId = store.project.id;
    }
    dirtyModel = false;
    edit.onRebuild();
    stats.buildMs = performance.now() - t0;
    stats.builds++;
    invalidate();
  }

  function scheduleRebuild(delay = 120) {
    dirtyModel = true;
    if (!active) return;
    clearTimeout(rebuildTimer);
    rebuildTimer = setTimeout(rebuild, delay);
  }

  // Camera ------------------------------------------------------------------------------------------
  // World space vertices of the model (without the ground), used to frame the camera tightly.
  function collectPoints(group, houseOnly = false) {
    const out = [];
    const v = new THREE.Vector3();
    group.updateMatrixWorld(true);
    group.traverse((o) => {
      if (!o.isMesh || (o.userData?.ground && !o.userData?.frame) || !o.geometry?.attributes?.position) return;
      if (houseOnly && o.userData?.frame) return;
      const pos = o.geometry.attributes.position;
      const step = Math.max(1, Math.floor(pos.count / 4000));
      for (let i = 0; i < pos.count; i += step) {
        v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);
        out.push(v.x, v.y, v.z);
      }
    });
    return out;
  }

  // Camera pose that frames the model points from a given azimuth and elevation (degrees). The target is
  // the middle of the projected extents and the distance comes from the extreme points, so wide, tall
  // and narrow (phone) viewports all fit the whole model with an even margin.
  function framedPose(cam, pts, box, azimuthDeg = 38, elevationDeg = 30) {
    const az = azimuthDeg * RAD;
    const el = elevationDeg * RAD;
    const dir = new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el));
    const right = new THREE.Vector3().crossVectors(dir.clone().negate(), new THREE.Vector3(0, 1, 0)).normalize();
    const up = new THREE.Vector3().crossVectors(right, dir.clone().negate()).normalize();
    const list = pts && pts.length >= 9 ? pts : [box.min.x, box.min.y, box.min.z, box.max.x, box.max.y, box.max.z];
    const c0 = box.getCenter(new THREE.Vector3());
    let minR = Infinity;
    let maxR = -Infinity;
    let minU = Infinity;
    let maxU = -Infinity;
    for (let i = 0; i < list.length; i += 3) {
      const x = list[i] - c0.x;
      const y = list[i + 1] - c0.y;
      const z = list[i + 2] - c0.z;
      const r = x * right.x + y * right.y + z * right.z;
      const u = x * up.x + y * up.y + z * up.z;
      if (r < minR) minR = r;
      if (r > maxR) maxR = r;
      if (u < minU) minU = u;
      if (u > maxU) maxU = u;
    }
    const target = c0.clone().addScaledVector(right, (minR + maxR) / 2).addScaledVector(up, (minU + maxU) / 2);
    if (target.y < 0.4) target.y = 0.4;
    const tanV = Math.tan((cam.fov * RAD) / 2);
    const tanH = tanV * cam.aspect;
    let dist = 3;
    for (let i = 0; i < list.length; i += 3) {
      const x = list[i] - target.x;
      const y = list[i + 1] - target.y;
      const z = list[i + 2] - target.z;
      const along = x * dir.x + y * dir.y + z * dir.z;
      const r = Math.abs(x * right.x + y * right.y + z * right.z);
      const u = Math.abs(x * up.x + y * up.y + z * up.z);
      dist = Math.max(dist, r / tanH + along, u / tanV + along);
    }
    return { pos: target.clone().addScaledVector(dir, dist * 1.06), target };
  }

  // Street side of the first frontage edge: { n: outward unit normal (world X, Z), u: along the street, mid } or null.
  function streetFrame() {
    const lot = store.project.site?.lot;
    const bd = lot?.boundary;
    const fe = (lot?.frontEdges || []).find((i) => Number.isInteger(i) && i >= 0 && i < (bd?.length || 0));
    if (!bd || fe == null) return null;
    const a = bd[fe];
    const b = bd[(fe + 1) % bd.length];
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const u = { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const c = { x: bd.reduce((t, q) => t + q.x, 0) / bd.length, y: bd.reduce((t, q) => t + q.y, 0) / bd.length };
    let n = { x: -u.y, y: u.x };
    if (n.x * (mid.x - c.x) + n.y * (mid.y - c.y) < 0) n = { x: -n.x, y: -n.y };
    return { n, u, mid };
  }

  // kind: 'hero' (three quarter from the street, slightly low), 'front' (close, square on), 'aerial' (the whole lot), 'fit' (old default)
  function poseFor(kind) {
    const box = bounds || new THREE.Box3(new THREE.Vector3(-5, 0, -5), new THREE.Vector3(10, 4, 8));
    const sf = kind === 'fit' ? null : streetFrame();
    if (!sf || !housePoints.length) {
      const k = kind === 'aerial';
      return framedPose(camera, points, box, k ? 30 : 38, k ? 48 : 30);
    }
    const ang = ((kind === 'front' ? 8 : kind === 'aerial' ? 28 : 34) * RAD);
    const side = Math.cos(ang);
    const dx = sf.n.x * side + sf.u.x * Math.sin(ang);
    const dz = sf.n.y * side + sf.u.y * Math.sin(ang);
    const az = (Math.atan2(dx, dz) * 180) / Math.PI;
    if (kind === 'aerial') {
      const pose = framedPose(camera, points, box, az, 46);
      return pose;
    }
    const pose = framedPose(camera, housePoints, box, az, kind === 'front' ? 9 : 19);
    const k = kind === 'front' ? 1.12 : 1.55;
    pose.pos.sub(pose.target).multiplyScalar(k).add(pose.target);
    return pose;
  }

  function frameCamera(animate, kind = null) {
    const hasLot = !!store.project.site?.lot?.boundary?.length;
    lastKind = kind;
    userMoved = false;
    const pose = poseFor(kind || (hasLot ? 'hero' : 'fit'));
    const k = insetScale();
    if (k > 1.001) pose.pos.sub(pose.target).multiplyScalar(k).add(pose.target);
    if (animate && !reduceMotion && active) {
      anim = { t0: performance.now(), dur: 650, fromPos: camera.position.clone(), toPos: pose.pos, fromTarget: controls.target.clone(), toTarget: pose.target };
    } else {
      anim = null;
      camera.position.copy(pose.pos);
      controls.target.copy(pose.target);
      controls.update();
    }
    invalidate();
  }

  vbHero.addEventListener('click', () => frameCamera(true, 'hero'));
  vbFront.addEventListener('click', () => frameCamera(true, 'front'));
  vbAerial.addEventListener('click', () => frameCamera(true, 'aerial'));
  vbSun.addEventListener('click', () => {
    sunKey = sunKey === 'warm' ? 'day' : 'warm';
    try {
      localStorage.setItem('ps.view3d.sun', sunKey);
    } catch {
      /* ignore */
    }
    vbSun.setAttribute('aria-pressed', String(sunKey === 'warm'));
    fitSun();
    invalidate();
  });
  const syncViewBar = () => {
    const hasLot = !!store.project.site?.lot?.boundary?.length;
    viewBar.hidden = !hasLot || mode === 'walk';
  };

  function stepAnim(now) {
    if (!anim) return false;
    const t = Math.min(1, (now - anim.t0) / anim.dur);
    const e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    camera.position.lerpVectors(anim.fromPos, anim.toPos, e);
    controls.target.lerpVectors(anim.fromTarget, anim.toTarget, e);
    if (t >= 1) anim = null;
    return true;
  }

  function adaptClip() {
    if (mode === 'walk') {
      if (camera.near !== 0.05) {
        camera.near = 0.05;
        camera.far = 1600;
        camera.updateProjectionMatrix();
      }
      return;
    }
    const d = camera.position.distanceTo(controls.target);
    const near = Math.min(4, Math.max(0.1, d * 0.012));
    const far = Math.max(1500, d * 40);
    if (Math.abs(near - camera.near) > near * 0.2 || Math.abs(far - camera.far) > far * 0.2) {
      camera.near = near;
      camera.far = far;
      camera.updateProjectionMatrix();
    }
  }

  // Picking -------------------------------------------------------------------------------------------
  function pickAt(clientX, clientY) {
    if (!model) return null;
    const r = canvas.getBoundingClientRect();
    ndc.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    const hits = raycaster.intersectObject(model, true);
    for (const h of hits) {
      const ud = h.object.userData || {};
      if (ud.ground) return { ground: true, point: h.point };
      if (!ud.kind) continue;
      const mi = h.face?.materialIndex ?? 0;
      const slot = ud.slotKeys?.[mi] ?? null;
      const face = ud.faceBySlot?.[mi] ?? ud.face;
      return { kind: ud.kind, id: ud.id, levelId: ud.levelId, wallId: ud.wallId, face, slot, finish: ud.finish, point: h.point, distance: h.distance };
    }
    return null;
  }

  let downInfo = null;
  let lastClick = null;
  const dblHandlers = [];
  function onPointerDown(e) {
    downInfo = e.button === 0 ? { x: e.clientX, y: e.clientY, t: performance.now() } : null;
  }
  function onPointerUp(e) {
    const d = downInfo;
    downInfo = null;
    if (!d || mode !== 'orbit' || !active || edit.enabled || ahead.isArmed) return; // edit mode handles its own clicks
    if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 5 || performance.now() - d.t > 700) return;
    const now = performance.now();
    const double = lastClick && now - lastClick.t < 350 && Math.hypot(e.clientX - lastClick.x, e.clientY - lastClick.y) < 24;
    lastClick = { t: now, x: e.clientX, y: e.clientY };
    if (double) {
      lastClick = null;
      picker.close();
      if (edit.items.selected()) store.select(null); // a double click on furniture with Edit off must not open Rotate and Delete
      // room cutaway (rooms.js) and other handlers may take the double click before the zoom to point
      if (dblHandlers.some((fn) => fn(e) === true)) return;
      focusAt(e.clientX, e.clientY);
      return;
    }
    const hit = pickAt(e.clientX, e.clientY);
    const selectedAnItem = () => !!edit.items.selected();
    if (!hit || hit.ground) {
      picker.close();
      if (selectedAnItem()) store.select(null);
      return;
    }
    if (hit.kind === 'furniture' || hit.kind === 'stair' || hit.kind === 'tank') {
      picker.close();
      store.select(hit.id);
      return;
    }
    if (selectedAnItem()) store.select(null); // the click moved on to a surface: the item is done with
    const r = rootEl.getBoundingClientRect();
    if (picker.open(hit, e.clientX - r.left, e.clientY - r.top)) fadeHints();
  }
  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointerup', onPointerUp);
  const onContextLost = (e) => e.preventDefault();
  const onContextRestored = () => invalidate();
  canvas.addEventListener('webglcontextlost', onContextLost);
  canvas.addEventListener('webglcontextrestored', onContextRestored);

  function focusAt(x, y) {
    const hit = pickAt(x, y);
    if (!hit?.point) return;
    const dist = camera.position.distanceTo(controls.target);
    const want = Math.max(2.5, Math.min(dist, camera.position.distanceTo(hit.point) * 0.55));
    const dir = camera.position.clone().sub(hit.point).normalize();
    const toPos = hit.point.clone().addScaledVector(dir, want);
    if (reduceMotion) {
      camera.position.copy(toPos);
      controls.target.copy(hit.point);
      controls.update();
      invalidate();
      return;
    }
    anim = { t0: performance.now(), dur: 450, fromPos: camera.position.clone(), toPos, fromTarget: controls.target.clone(), toTarget: hit.point.clone() };
  }

  let hoverAt = 0;
  function onPointerMove(e) {
    if (mode !== 'orbit' || e.buttons || e.pointerType === 'touch' || edit.enabled) return;
    const now = performance.now();
    if (now - hoverAt < 90) return;
    hoverAt = now;
    const hit = pickAt(e.clientX, e.clientY);
    canvas.style.cursor = hit && !hit.ground ? (['furniture', 'tank', 'stair'].includes(hit.kind) ? 'grab' : 'pointer') : 'default';
  }
  canvas.addEventListener('pointermove', onPointerMove);

  // Modes ---------------------------------------------------------------------------------------------
  function applyModeLighting() {
    const w = mode === 'walk';
    hemi.intensity = w ? 1.7 : (store.project.site?.lot ? SUN_PRESETS[sunKey].hemi : 1.2);
    hemi.groundColor.set(w ? '#d2d0c8' : '#8d8a7c');
    scene.environmentIntensity = w ? 0.3 : 0.45;
    headlight.intensity = w ? 7 : 0;
    camera.fov = w ? 70 : 38;
    applyInset();
    camera.updateProjectionMatrix();
    controls.enabled = !w;
    hints.hidden = w;
    contoursChip.dataset.walk = String(w);
    syncViewBar();
    edit.onModeChange();
  }

  function setMode(next) {
    const m = next === 'walk' ? 'walk' : 'orbit';
    if (m === mode) {
      // same mode: just make sure the walk controller matches whether the viewer is showing
      if (m === 'walk' && active && !walk.active) walk.enter();
      applyModeLighting();
      return;
    }
    picker.close();
    anim = null;
    if (m === 'walk') {
      savedOrbit = framed ? { pos: camera.position.clone(), target: controls.target.clone() } : null;
      mode = 'walk';
      applyModeLighting();
      if (active) {
        rebuild();
        walk.enter();
      } else dirtyModel = true;
    } else {
      walk.exit();
      mode = 'orbit';
      applyModeLighting();
      if (savedOrbit) {
        camera.position.copy(savedOrbit.pos);
        controls.target.copy(savedOrbit.target);
        controls.update();
      } else {
        framed = false; // frame the model on the next build
      }
      camera.near = 0.1;
      if (active) rebuild();
      else dirtyModel = true;
    }
    invalidate();
  }

  // Loop ----------------------------------------------------------------------------------------------
  function loop(now) {
    raf = requestAnimationFrame(loop);
    const dt = Math.min(0.1, (now - lastTime) / 1000);
    lastTime = now;
    let need = needsRender;
    if (mode === 'orbit') {
      if (stepAnim(now)) need = true;
      if (controls.update(dt)) need = true;
    } else {
      // Walk mode renders every frame: look and move input arrive from several sources.
      walk.update(dt);
      ahead.update();
      doors.update(dt);
      headlight.position.copy(camera.position);
      need = true;
    }
    if (!need) return;
    needsRender = false;
    adaptClip();
    sky.position.copy(camera.position);
    edit.onFrame();
    renderer.render(scene, camera);
    stats.frames++;
    if (adaptive) monitor(dt);
  }

  // Switch shadows off when the device cannot keep up (sustained slow frames while animating).
  function monitor(dt) {
    if (!perf.shadows) return;
    perf.frames++;
    if (perf.frames < 30 || dt > 0.25) return;
    perf.ema = perf.ema * 0.9 + dt * 0.1;
    if (perf.ema > 0.05) perf.slow++;
    else perf.slow = Math.max(0, perf.slow - 1);
    if (perf.slow > 40) {
      perf.shadows = false;
      renderer.shadowMap.enabled = false;
      sun.castShadow = false;
      scene.traverse((o) => {
        const ms = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
        ms.forEach((m) => {
          m.needsUpdate = true;
        });
      });
      invalidate();
    }
  }

  function start() {
    if (raf || disposed) return;
    lastTime = performance.now();
    raf = requestAnimationFrame(loop);
  }
  function stop() {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
  }

  function setActive(v) {
    const on = !!v;
    if (on === active) return;
    active = on;
    if (active) {
      resize();
      applyModeLighting();
      if (dirtyModel || !model) rebuild();
      if (mode === 'walk') walk.enter();
      clearTimeout(hintTimer);
      hints.classList.remove('is-faded');
      hintTimer = setTimeout(fadeHints, 6000);
      start();
      invalidate();
      edit.onActiveChange();
    } else {
      stop();
      clearTimeout(rebuildTimer);
      rebuildTimer = null;
      clearTimeout(hintTimer);
      picker.close();
      walk.exit();
      edit.onActiveChange();
    }
  }

  // Store events --------------------------------------------------------------------------------------
  const offProject = store.on('project', (info) => {
    if (info?.label === 'Open project' || info?.label === 'Find my block') framed = false;
    syncSiteTexture();
    syncContoursChip();
    syncViewBar();
    scheduleRebuild(120);
    if (mode === 'walk') walk.refresh();
  });
  syncSiteTexture();
  syncContoursChip();
  syncViewBar();
  const offUI = store.on('ui', (patch) => {
    if (!patch) return;
    if ('view' in patch) {
      if (patch.view === 'walk') setMode('walk');
      else if (patch.view === '3d' || patch.view === 'split') setMode('orbit');
    }
    if ('levelFilter' in patch || 'showRoof' in patch || 'statusView' in patch) {
      scheduleRebuild(20);
      if (mode === 'walk') walk.refresh();
    }
  });

  // Snapshot ------------------------------------------------------------------------------------------
  async function snapshot({ width = 1600, height = 1000, current = false } = {}) {
    if (!model || dirtyModel) rebuild();
    const cam = new THREE.PerspectiveCamera(38, width / height, 0.1, 2000);
    if (current) {
      cam.copy(camera);
      cam.clearViewOffset();
      cam.aspect = width / height;
      cam.near = camera.near;
      cam.far = camera.far;
    } else {
      const box = bounds || new THREE.Box3(new THREE.Vector3(-5, 0, -5), new THREE.Vector3(10, 4, 8));
      const pose = framedPose(cam, points, box, 35, 28);
      cam.position.copy(pose.pos);
      cam.lookAt(pose.target);
      cam.near = Math.max(0.1, pose.pos.distanceTo(pose.target) * 0.01);
    }
    cam.updateProjectionMatrix();
    const prevSize = renderer.getSize(new THREE.Vector2());
    const prevRatio = renderer.getPixelRatio();
    renderer.setPixelRatio(1);
    renderer.setSize(width, height, false);
    sky.position.copy(cam.position);
    renderer.render(scene, cam);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    renderer.setPixelRatio(prevRatio);
    renderer.setSize(prevSize.x, prevSize.y, false);
    sky.position.copy(camera.position);
    invalidate();
    return blob;
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    stop();
    clearTimeout(rebuildTimer);
    clearTimeout(hintTimer);
    offProject?.();
    offUI?.();
    ro?.disconnect();
    window.removeEventListener('resize', resize);
    canvas.removeEventListener('pointerdown', onPointerDown);
    canvas.removeEventListener('pointerup', onPointerUp);
    canvas.removeEventListener('pointermove', onPointerMove);
    canvas.removeEventListener('webglcontextlost', onContextLost);
    canvas.removeEventListener('webglcontextrestored', onContextRestored);
    ahead.dispose();
    edit.dispose();
    walk.dispose();
    picker.dispose();
    controls.dispose();
    if (model) {
      scene.remove(model);
      disposeModel(model);
      model = null;
    }
    site.texture?.dispose();
    sky.geometry.dispose();
    sky.material.dispose();
    envTarget.dispose();
    pmrem.dispose();
    lib.dispose();
    renderer.dispose();
    try {
      renderer.forceContextLoss();
    } catch {
      /* ignore */
    }
    rootEl.remove();
  }

  applyModeLighting();
  resize();

  const api = {
    setActive,
    setMode,
    setInset,
    resetCamera: () => frameCamera(true),
    getModel: () => model,
    snapshot,
    dispose,
    // extras for tests and tools
    get stats() {
      return { ...stats, shadows: perf.shadows };
    },
    get mode() {
      return mode;
    },
    get info() {
      const r = renderer.info;
      return { calls: r.render.calls, triangles: r.render.triangles, geometries: r.memory.geometries, textures: r.memory.textures };
    },
    pickAt,
    camera,
    controls,
    scene,
    walk,
    picker,
    doors,
    edit,
    setEdit: (on) => edit.setEnabled(on),
    ahead,
    placeItemAhead: (itemId) => ahead.placeItemAhead(itemId),
    armItemAhead: (itemId) => ahead.armItemAhead(itemId),
    armOpeningAhead: (preset) => ahead.armOpeningAhead(preset),
    get editing() {
      return edit.enabled;
    },
    flush: () => {
      if (active && (dirtyModel || rebuildTimer)) rebuild();
    },
    // Room snapping (rooms.js). snapToRoom('living' | 'kitchen' | 'master' | 'bed2' | 'alfresco' | 'garage' | 'aerial' | a room id) -> Promise.
    snapToRoom: (tab, opts) => snapRoom(api, store.project, tab, opts),
    roomTabs: (levelId, opts) => roomTabsOf(store.project, levelId, opts),
    flyTo: (pose, opts) => flyToPose(api, pose, opts),
    // plumbing for rooms.js
    store,
    rootEl,
    canvas,
    invalidate,
    stopAnim: () => {
      anim = null;
    },
    aerialPose: () => {
      const pose = poseFor('aerial');
      return { position: pose.pos.clone(), target: pose.target.clone() };
    },
    // The opening site view (whole lot, framed in the clear area beside the lot card): what the lot card's Aerial tab returns to.
    sitePose: () => {
      const pose = poseFor(store.project.site?.lot?.boundary?.length ? 'hero' : 'fit');
      const k = insetScale();
      if (k > 1.001) pose.pos.sub(pose.target).multiplyScalar(k).add(pose.target);
      return { position: pose.pos.clone(), target: pose.target.clone() };
    },
    leaveWalk: () => store.setUI({ view: '3d' }),
    addDoubleClickHandler: (fn) => {
      dblHandlers.push(fn);
      return () => {
        const i = dblHandlers.indexOf(fn);
        if (i >= 0) dblHandlers.splice(i, 1);
      };
    },
  };
  const offCutaway = enableRoomCutaway(api, () => store.project);
  const roomBar = createRoomBar(api, () => store.project);
  api.dispose = () => {
    offCutaway();
    roomBar.dispose();
    dispose();
  };
  return api;
}
