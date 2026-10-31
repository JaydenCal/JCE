// 3D viewer: WebGL renderer, orbit camera, picking, finish picker and walk mode.
// createViewer3D(element, store, { catalogue }) -> { setActive, setMode, setEdit, resetCamera, getModel, snapshot, dispose }
// Edit in 3D (key B or the Edit toggle) is in edit.js; door animation for the walk-through is in doors.js.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { buildModel, disposeModel, modelBounds } from './build.js';
import { createMaterialLibrary } from './materials.js';
import { createPicker } from './picker.js';
import { createWalk } from './walk.js';
import { createDoors } from './doors.js';
import { createEdit } from './edit.js';
import { createAhead } from './ahead.js';
import { VIEWER_CSS } from './viewer-css.js';

const STYLE_ID = 'ps3d-style';
const RAD = Math.PI / 180;
const SUN_DIR = new THREE.Vector3(-0.45, 0.78, 0.65).normalize();
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
    return { setActive: noop, setMode: noop, setEdit: noop, placeItemAhead: () => null, armItemAhead: () => false, armOpeningAhead: () => false, resetCamera: noop, getModel: () => null, snapshot: async () => null, dispose: () => rootEl.remove(), unavailable: true };
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
  renderer.shadowMap.type = THREE.PCFShadowMap;

  const scene = new THREE.Scene();
  const sky = makeSky();
  scene.add(sky);
  scene.fog = new THREE.Fog(SKY.horizon, 120, 480);
  scene.fog.color.set(SKY.horizon);
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
  sun.shadow.mapSize.set(2048, 2048);
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
  const HINTS_DEFAULT = '<span class="ps3d-chip">Drag to orbit, scroll to zoom</span><span class="ps3d-chip">Click a surface to change its finish</span><span class="ps3d-chip">Click furniture to move or delete it</span><span class="ps3d-chip">Press B to edit walls and rooms</span>';
  hints.innerHTML = HINTS_DEFAULT;
  rootEl.appendChild(hints);
  let hintTimer = null;
  const fadeHints = () => hints.classList.add('is-faded');

  // State -----------------------------------------------------------------------------------------
  let active = false;
  let mode = store.ui.view === 'walk' ? 'walk' : 'orbit';
  let model = null;
  let bounds = null;
  let points = [];
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
    camera.updateProjectionMatrix();
    invalidate();
  }
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
  });
  walk.setItems(edit.items);
  const ahead = createAhead({
    scene, camera, canvas, rootEl, store, catalogue, controls, walk, edit,
    pickAt: (x, y) => pickAt(x, y),
    getMode: () => mode,
    isActive: () => active,
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
  function uiOptions() {
    const ui = store.ui;
    return {
      materials: lib,
      catalogue,
      levelFilter: mode === 'walk' ? 'all' : ui.levelFilter || 'all',
      showRoof: ui.showRoof !== false,
      statusView: ui.statusView || 'proposed',
      walk: mode === 'walk',
    };
  }

  function fitSun() {
    if (!bounds) return;
    const sphere = bounds.getBoundingSphere(new THREE.Sphere());
    const r = Math.max(sphere.radius, 4);
    sun.target.position.copy(sphere.center);
    sun.position.copy(sphere.center).addScaledVector(SUN_DIR, r * 3 + 20);
    const cam = sun.shadow.camera;
    const e = r * 1.25;
    cam.left = -e;
    cam.right = e;
    cam.top = e;
    cam.bottom = -e;
    cam.near = 1;
    cam.far = r * 7 + 60;
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
    scene.add(model);
    doors.attach(model);
    bounds = modelBounds(model);
    points = collectPoints(model);
    fitSun();
    applyLimits();
    const R = model.userData.groundR || 200;
    scene.fog.near = R * 0.3;
    scene.fog.far = R * 0.97;
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
  function collectPoints(group) {
    const out = [];
    const v = new THREE.Vector3();
    group.updateMatrixWorld(true);
    group.traverse((o) => {
      if (!o.isMesh || o.userData?.ground || !o.geometry?.attributes?.position) return;
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

  function frameCamera(animate) {
    const box = bounds || new THREE.Box3(new THREE.Vector3(-5, 0, -5), new THREE.Vector3(10, 4, 8));
    const pose = framedPose(camera, points, box);
    if (animate && !reduceMotion && active) {
      anim = { t0: performance.now(), dur: 520, fromPos: camera.position.clone(), toPos: pose.pos, fromTarget: controls.target.clone(), toTarget: pose.target };
    } else {
      anim = null;
      camera.position.copy(pose.pos);
      controls.target.copy(pose.target);
      controls.update();
    }
    invalidate();
  }

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
        camera.far = 600;
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
    hemi.intensity = w ? 1.7 : 1.2;
    hemi.groundColor.set(w ? '#d2d0c8' : '#8d8a7c');
    scene.environmentIntensity = w ? 0.3 : 0.45;
    headlight.intensity = w ? 7 : 0;
    camera.fov = w ? 70 : 38;
    camera.updateProjectionMatrix();
    controls.enabled = !w;
    hints.hidden = w;
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
      hintTimer = setTimeout(fadeHints, 16000);
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
    if (info?.label === 'Open project') framed = false;
    scheduleRebuild(120);
    if (mode === 'walk') walk.refresh();
  });
  const offUI = store.on('ui', (patch) => {
    if (!patch) return;
    if ('view' in patch) {
      if (patch.view === 'walk') setMode('walk');
      else if (patch.view === '3d') setMode('orbit');
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

  return {
    setActive,
    setMode,
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
  };
}
