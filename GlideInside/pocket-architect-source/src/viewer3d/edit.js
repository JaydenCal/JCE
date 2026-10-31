// Edit in 3D: move furniture, tanks and stairs on their level, drag walls sideways, and build walls,
// rooms, windows and doors by pointing at the ground or a wall. Every change goes through the store
// as one undo step (store.run). While dragging only the existing meshes move: nothing is rebuilt
// until the change is committed on release.
//
// Furniture, tanks and stairs need no Edit toggle: in the orbit view a click selects one (outline and a small
// action bar with Rotate left, Rotate right, Delete and Done), a drag moves it, and Delete removes it. The same
// selection, outline, bar and Delete work in Walk mode (the walk code picks the item under the crosshair).

import * as THREE from 'three';
import * as G from '../model/geometry.js';
import { DEFAULTS } from '../model/schema.js';
import { furnitureClashes } from '../model/ops.js';
import {
  footprintOf, clashingWall, dragPosition, wallDragMove, snapWallPoint, rectFromPoints,
  openingGhost, formatDims, formatSigned, nextRotation, MIN_WALL_MM, MIN_ROOM_MM,
} from './edit-logic.js';

const DRAG_START_PX = 4;
const CLICK_PX = 5;
const MOVABLE = ['furniture', 'tank', 'stair'];
const DELETABLE = ['furniture', 'tank', 'stair', 'wall', 'opening'];
const ROTATABLE = ['furniture', 'stair'];
export const TOOLS = [
  { id: 'select', label: 'Move', hint: 'Drag furniture, tanks, stairs or walls to move them. Comma and full stop rotate, Delete removes.' },
  { id: 'wall', label: 'Wall', hint: 'Click points on the ground to draw walls. Double click or Esc to finish.' },
  { id: 'room', label: 'Room', hint: 'Drag a rectangle on the ground to add a room. Right drag pans, scroll zooms.' },
  { id: 'window', label: 'Window', hint: 'Hover a wall to see the window, click to place it.' },
  { id: 'door', label: 'Door', hint: 'Hover a wall to see the door, click to place it.' },
];

export function createEdit({ rootEl, canvas, scene, camera, controls, store, catalogue, getModel, pickAt, invalidate, getMode, isActive, suspended = () => false }) {
  let enabled = false;
  let pinned = false; // selection outline kept on while Edit is off (an item just placed)
  let pinTimer = null;
  let tool = 'select';
  let drag = null; // active move or wall drag
  let press = null; // pointer down that may become a drag or a click
  let chain = null; // wall drawing { last }
  let roomDrag = null;
  let hoverAt = 0;
  let selBox = null; // world box of the selected item, for placing the action bar
  let ghostInfo = null;
  let msgTimer = null;
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const sizeOf = (id) => {
    try {
      const d = catalogue?.getFurniture?.(id);
      return d ? { w: d.w, d: d.d } : null;
    } catch {
      return null;
    }
  };

  // DOM ------------------------------------------------------------------------------------------
  const bar = document.createElement('div');
  bar.className = 'ps3d-editbar';
  bar.innerHTML = `
    <div class="ps3d-tools" role="toolbar" aria-label="3D edit tools" hidden>
      ${TOOLS.map((t) => `<button type="button" class="ps3d-tool" data-tool="${t.id}" aria-pressed="${t.id === 'select'}">${t.label}</button>`).join('')}
    </div>
    <button type="button" class="ps3d-edit" aria-pressed="false" title="Edit in 3D (B)">
      <span class="ps3d-edit-sw" aria-hidden="true"></span><span class="ps3d-edit-label">Edit</span><span class="ps3d-edit-state">Off</span><kbd class="ps3d-key">B</kbd>
    </button>
    <div class="ps3d-editmsg" role="status" hidden></div>`;
  rootEl.appendChild(bar);
  const toggleBtn = bar.querySelector('.ps3d-edit');
  const stateEl = bar.querySelector('.ps3d-edit-state');
  const toolsEl = bar.querySelector('.ps3d-tools');
  const msgEl = bar.querySelector('.ps3d-editmsg');
  const tip = document.createElement('div');
  tip.className = 'ps3d-tip';
  tip.hidden = true;
  rootEl.appendChild(tip);

  // Action bar for the selected furniture, tank or stairs.
  const itemBar = document.createElement('div');
  itemBar.className = 'ps3d-itembar';
  itemBar.setAttribute('role', 'toolbar');
  itemBar.setAttribute('aria-label', 'Selected item');
  itemBar.hidden = true;
  itemBar.innerHTML = `
    <span class="ps3d-itemname"></span>
    <button type="button" class="ps3d-itembtn" data-act="rotl" title="Rotate left (comma)">Rotate left</button>
    <button type="button" class="ps3d-itembtn" data-act="rotr" title="Rotate right (full stop)">Rotate right</button>
    <button type="button" class="ps3d-itembtn is-danger" data-act="del" title="Delete (Delete key)">Delete</button>
    <button type="button" class="ps3d-itembtn" data-act="done" title="Deselect">Done</button>`;
  rootEl.appendChild(itemBar);
  const itemName = itemBar.querySelector('.ps3d-itemname');
  const rotBtns = [...itemBar.querySelectorAll('[data-act="rotl"],[data-act="rotr"]')];
  itemBar.addEventListener('pointerdown', (e) => e.stopPropagation());
  itemBar.addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const found = selectedItem();
    if (b.dataset.act === 'done') store.select(null);
    else if (!found) return;
    else if (b.dataset.act === 'del') deleteSelected(found);
    else rotateSelected(found, b.dataset.act === 'rotl' ? -90 : 90);
    canvas.focus?.({ preventScroll: true });
  });

  toggleBtn.addEventListener('click', () => setEnabled(!enabled));
  toolsEl.addEventListener('click', (e) => {
    const b = e.target.closest('[data-tool]');
    if (b) setTool(b.dataset.tool);
  });

  function say(text, { error = false, ms = 4200 } = {}) {
    clearTimeout(msgTimer);
    msgEl.textContent = text || '';
    msgEl.hidden = !text;
    msgEl.classList.toggle('is-error', !!error);
    if (text && ms) msgTimer = setTimeout(() => say(''), ms);
  }
  function showTip(text, clientX, clientY) {
    if (!text) {
      tip.hidden = true;
      return;
    }
    const r = rootEl.getBoundingClientRect();
    tip.textContent = text;
    tip.style.left = `${Math.max(8, Math.min(r.width - 8, clientX - r.left + 16))}px`;
    tip.style.top = `${Math.max(8, Math.min(r.height - 8, clientY - r.top + 18))}px`;
    tip.hidden = false;
  }

  // Overlay objects (not part of the model, so rebuilds leave them alone) -----------------------------
  const overlay = new THREE.Group();
  overlay.name = 'edit-overlay';
  scene.add(overlay);
  const ACCENT = new THREE.Color('#1f6feb');
  const RED = new THREE.Color('#e5484d');
  const lineMat = new THREE.LineBasicMaterial({ color: ACCENT, depthTest: false, transparent: true, toneMapped: false });
  const fillMat = new THREE.MeshBasicMaterial({ color: ACCENT, depthTest: false, transparent: true, opacity: 0.18, side: THREE.DoubleSide, toneMapped: false });
  const ghostMat = new THREE.MeshBasicMaterial({ color: ACCENT, depthTest: false, transparent: true, opacity: 0.38, toneMapped: false });
  const ghostBad = new THREE.MeshBasicMaterial({ color: RED, depthTest: false, transparent: true, opacity: 0.38, toneMapped: false });
  const redMat = new THREE.MeshStandardMaterial({ color: RED, roughness: 0.6, metalness: 0, emissive: new THREE.Color('#5a0b0e') });
  const dotGeo = new THREE.CylinderGeometry(0.08, 0.08, 0.02, 20);
  const ghost = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), ghostMat);
  ghost.visible = false;
  ghost.renderOrder = 998;
  overlay.add(ghost);
  const dot = new THREE.Mesh(dotGeo, new THREE.MeshBasicMaterial({ color: ACCENT, depthTest: false, transparent: true, toneMapped: false }));
  dot.visible = false;
  dot.renderOrder = 999;
  overlay.add(dot);
  const rubber = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]), lineMat);
  rubber.visible = false;
  rubber.renderOrder = 997;
  rubber.frustumCulled = false;
  overlay.add(rubber);
  const rectLine = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints([0, 1, 2, 3].map(() => new THREE.Vector3())), lineMat);
  rectLine.visible = false;
  rectLine.renderOrder = 997;
  rectLine.frustumCulled = false;
  overlay.add(rectLine);
  const rectFill = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), fillMat);
  rectFill.rotation.x = -Math.PI / 2;
  rectFill.visible = false;
  rectFill.renderOrder = 996;
  overlay.add(rectFill);
  let selHelper = null;

  const levelElev = (level) => (level ? level.elevation / 1000 : 0);

  // Pointer maths --------------------------------------------------------------------------------
  function rayAt(clientX, clientY) {
    const r = canvas.getBoundingClientRect();
    ndc.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    return raycaster.ray;
  }
  // Plan point (mm) where the pointer ray meets the horizontal plane at height y (metres), or null.
  function planeAt(clientX, clientY, y) {
    const ray = rayAt(clientX, clientY);
    const pt = ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -y), new THREE.Vector3());
    if (!pt) return null;
    if (pt.distanceTo(camera.position) > 400) return null;
    return { x: pt.x * 1000, y: pt.z * 1000 };
  }
  const activeLevel = () => store.level();
  const canInteract = () => isActive() && getMode() === 'orbit' && !suspended();
  const canEdit = () => enabled && canInteract();

  // The selected furniture, tank or stairs (as store.find returns it), or null.
  function selectedItem() {
    const id = store.ui.selection;
    const found = id ? store.find(id) : null;
    return found && MOVABLE.includes(found.kind) ? found : null;
  }
  function labelOf(found) {
    if (!found) return '';
    if (found.kind === 'stair') return 'Stairs';
    if (found.kind === 'tank') return 'Tank';
    try {
      return catalogue?.getFurniture?.(found.item.item)?.name || 'Furniture';
    } catch {
      return 'Furniture';
    }
  }
  const setOrbit = (on) => {
    controls.enabled = on && getMode() === 'orbit';
  };

  // Finding what to move ------------------------------------------------------------------------------
  function objectsFor(kind, id) {
    const model = getModel();
    const out = [];
    if (!model) return out;
    const name = `${kind}:${id}`;
    model.traverse((o) => {
      if (o.name === name) out.push(o);
      else if (kind === 'wall' && o.isMesh && o.userData?.wallId === id) out.push(o);
    });
    return out;
  }
  function meshesOf(objs) {
    const meshes = [];
    for (const o of objs) o.traverse((m) => m.isMesh && meshes.push(m));
    return meshes;
  }
  function setRed(d, on) {
    if (d.red === on) return;
    d.red = on;
    for (const m of d.meshes) {
      if (on) {
        d.saved.set(m, m.material);
        m.material = Array.isArray(m.material) ? m.material.map(() => redMat) : redMat;
      } else if (d.saved.has(m)) {
        m.material = d.saved.get(m);
        d.saved.delete(m);
      }
    }
  }

  // Selection outline and action bar --------------------------------------------------------------------
  function refreshSelection() {
    if (selHelper) {
      overlay.remove(selHelper);
      selHelper.geometry?.dispose?.();
      selHelper.material?.dispose?.();
      selHelper = null;
    }
    selBox = null;
    const id = store.ui.selection;
    const model = getModel();
    const item = selectedItem();
    const walking = getMode() === 'walk';
    // Items show their outline whenever they are selected in the viewer; other things only while Edit is on.
    const show = !!id && !!model && ((enabled && !walking) || pinned || (!!item && isActive() && !suspended()));
    if (!show) {
      updateBar();
      invalidate();
      return;
    }
    const box = new THREE.Box3();
    let any = false;
    model.updateMatrixWorld(true);
    model.traverse((o) => {
      if (o.isMesh && o.userData?.id === id && !o.userData.ground) {
        box.union(new THREE.Box3().setFromObject(o));
        any = true;
      }
    });
    if (any && Number.isFinite(box.min.x)) {
      selBox = box.clone();
      selHelper = new THREE.Box3Helper(box.expandByScalar(0.03), ACCENT);
      selHelper.material.depthTest = walking; // in the walk-through the outline stays behind walls
      selHelper.material.toneMapped = false;
      selHelper.renderOrder = 995;
      overlay.add(selHelper);
    }
    updateBar();
    invalidate();
  }

  // The action bar follows the selected item in the orbit view and sits at the top of the screen when walking.
  function updateBar() {
    const found = selectedItem();
    const want = !!found && !!selBox && isActive() && !suspended() && !drag;
    if (!want) {
      if (!itemBar.hidden) itemBar.hidden = true;
      return;
    }
    const walking = getMode() === 'walk';
    itemName.textContent = labelOf(found);
    for (const b of rotBtns) b.hidden = !ROTATABLE.includes(found.kind);
    itemBar.classList.toggle('is-walk', walking);
    itemBar.hidden = false;
    placeBar();
  }
  function placeBar() {
    if (itemBar.hidden) return;
    if (getMode() === 'walk' || !selBox) {
      itemBar.style.left = '';
      itemBar.style.top = '';
      return;
    }
    const r = rootEl.getBoundingClientRect();
    const bw = itemBar.offsetWidth;
    const bh = itemBar.offsetHeight;
    const cx = (selBox.min.x + selBox.max.x) / 2;
    const cz = (selBox.min.z + selBox.max.z) / 2;
    const top = new THREE.Vector3(cx, selBox.max.y, cz).project(camera);
    const bottom = new THREE.Vector3(cx, selBox.min.y, cz).project(camera);
    const sx = ((top.x + 1) / 2) * r.width;
    const syTop = ((1 - top.y) / 2) * r.height;
    const syBottom = ((1 - bottom.y) / 2) * r.height;
    const left = Math.max(8, Math.min(r.width - bw - 8, sx - bw / 2));
    // above the item, or below it when there is no room above (the Edit controls sit along the top)
    let y = syTop - bh - 12;
    if (y < 56) y = syBottom + 12;
    y = Math.max(56, Math.min(r.height - bh - 8, y));
    itemBar.style.left = `${Math.round(left)}px`;
    itemBar.style.top = `${Math.round(y)}px`;
  }

  // Dragging an item or a wall --------------------------------------------------------------------------
  function beginDrag(hit, planStart) {
    const found = store.find(hit.id);
    if (!found) return null;
    const level = found.level || store.project.levels.find((l) => l.id === hit.levelId) || activeLevel();
    const objs = objectsFor(hit.kind, hit.id);
    if (!objs.length) return null;
    const meshes = meshesOf(objs);
    const d = {
      kind: hit.kind,
      id: hit.id,
      item: found.item,
      level,
      objs,
      bases: objs.map((o) => o.position.clone()),
      meshes,
      saved: new Map(),
      red: false,
      y: hit.kind === 'tank' ? levelElev(store.project.levels[0]) : levelElev(level),
      grab: planStart,
      start: hit.kind === 'wall' ? null : { x: found.item.x, y: found.item.y },
      pos: null,
      moved: false,
      dx: 0,
      dy: 0,
    };
    if (hit.kind === 'wall') d.y = hit.point ? hit.point.y : levelElev(level) + 1;
    return d;
  }

  function dragTo(d, plan) {
    let dxm;
    let dzm;
    if (d.kind === 'wall') {
      const w = wallDragMove(d.item, d.grab, plan);
      d.dx = w.dx;
      d.dy = w.dy;
      d.s = w.s;
      dxm = w.dx / 1000;
      dzm = w.dy / 1000;
    } else {
      const pos = dragPosition(d.start, d.grab, plan);
      d.pos = pos;
      dxm = (pos.x - d.start.x) / 1000;
      dzm = (pos.y - d.start.y) / 1000;
      d.dx = pos.x - d.start.x;
      d.dy = pos.y - d.start.y;
    }
    d.objs.forEach((o, i) => o.position.set(d.bases[i].x + dxm, d.bases[i].y, d.bases[i].z + dzm));
    if (selHelper) selHelper.visible = false;
    if (!itemBar.hidden) itemBar.hidden = true;
    d.moved = d.dx !== 0 || d.dy !== 0;
    if (d.kind !== 'wall') {
      const corners = footprintOf(d.kind, d.item, d.pos.x, d.pos.y, d.item.rotation, sizeOf);
      setRed(d, !!clashingWall(d.level, corners));
    }
    invalidate();
    return d;
  }

  function cancelDrag() {
    if (!drag) return;
    drag.objs.forEach((o, i) => o.position.copy(drag.bases[i]));
    setRed(drag, false);
    drag = null;
    press = null;
    if (selHelper) selHelper.visible = true;
    showTip('');
    setOrbit(true);
    canvas.style.cursor = '';
    updateBar();
    invalidate();
  }

  function commitDrag(d) {
    setRed(d, false);
    showTip('');
    if (!d.moved) {
      if (selHelper) selHelper.visible = true;
      return false;
    }
    try {
      if (d.kind === 'furniture') store.run('update_furniture', { id: d.id, x: d.pos.x, y: d.pos.y });
      else if (d.kind === 'tank') store.run('update_tank', { id: d.id, x: d.pos.x, y: d.pos.y });
      else if (d.kind === 'stair') store.run('update_stair', { id: d.id, x: d.pos.x, y: d.pos.y });
      else if (d.kind === 'wall') store.run('move_wall', { id: d.id, dx: d.dx, dy: d.dy });
      return true;
    } catch (e) {
      d.objs.forEach((o, i) => o.position.copy(d.bases[i]));
      if (selHelper) selHelper.visible = true;
      say(e.message || 'That change could not be made.', { error: true });
      updateBar();
      invalidate();
      return false;
    }
  }

  // Pointer handlers -------------------------------------------------------------------------------------
  function onDown(e) {
    if (!canInteract() || (e.button !== 0 && e.pointerType !== 'touch')) return;
    let first = null;
    if (!enabled) {
      // Edit is off: only furniture, tanks and stairs can be picked up. Anything else is left to the orbit
      // controls and the finish picker.
      first = pickAt(e.clientX, e.clientY);
      if (!first || !MOVABLE.includes(first.kind)) return;
    }
    press = { x: e.clientX, y: e.clientY, t: performance.now(), id: e.pointerId, moved: false, took: false, hit: null };
    if (tool === 'select') {
      const hit = first || pickAt(e.clientX, e.clientY);
      press.hit = hit && !hit.ground ? hit : null;
      if (hit && (MOVABLE.includes(hit.kind) || (enabled && hit.kind === 'wall'))) {
        const level = store.project.levels.find((l) => l.id === hit.levelId) || activeLevel();
        const y = hit.kind === 'tank' ? levelElev(store.project.levels[0]) : hit.kind === 'wall' ? hit.point.y : levelElev(level);
        const plan = planeAt(e.clientX, e.clientY, y);
        if (plan) {
          const d = beginDrag(hit, plan);
          if (d) {
            d.y = y;
            press.drag = d;
            press.took = true;
            if (store.ui.selection !== hit.id) store.select(hit.id);
            take(e);
          }
        }
      }
    } else if (tool === 'room' && enabled) {
      const level = activeLevel();
      const plan = planeAt(e.clientX, e.clientY, levelElev(level));
      if (plan) {
        const a = snapWallPoint(level, plan);
        roomDrag = { a, b: a, level };
        press.took = true;
        take(e);
      }
    }
  }
  function take(e) {
    e.stopImmediatePropagation();
    e.preventDefault();
    setOrbit(false);
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {
      /* synthetic pointer */
    }
  }

  function onMove(e) {
    if (!canInteract()) return;
    if (press) {
      if (Math.hypot(e.clientX - press.x, e.clientY - press.y) > DRAG_START_PX) press.moved = true;
    }
    if (press?.drag && press.moved) {
      drag = press.drag;
      const plan = planeAt(e.clientX, e.clientY, drag.y);
      if (plan) {
        dragTo(drag, plan);
        canvas.style.cursor = 'grabbing';
        showTip(drag.kind === 'wall' ? formatSigned(drag.s) : `${formatSigned(drag.dx)}, ${formatSigned(drag.dy)}`, e.clientX, e.clientY);
      }
      return;
    }
    if (!enabled) return;
    if (roomDrag) {
      const plan = planeAt(e.clientX, e.clientY, levelElev(roomDrag.level));
      if (plan) {
        roomDrag.b = snapWallPoint(roomDrag.level, plan);
        showRect(roomDrag.a, roomDrag.b, roomDrag.level);
        const r = rectFromPoints(roomDrag.a, roomDrag.b);
        showTip(`${formatDims(r.width, r.depth)}  ${((r.width * r.depth) / 1e6).toFixed(1)} m2`, e.clientX, e.clientY);
      }
      return;
    }
    if (e.buttons) return;
    const now = performance.now();
    if (now - hoverAt < 70 || e.pointerType === 'touch') return;
    hoverAt = now;
    hover(e.clientX, e.clientY);
  }

  function hover(cx, cy) {
    if (tool === 'select') {
      const hit = pickAt(cx, cy);
      canvas.style.cursor = hit && (MOVABLE.includes(hit.kind) || hit.kind === 'wall') ? 'grab' : '';
    } else if (tool === 'wall') {
      canvas.style.cursor = 'crosshair';
      const level = activeLevel();
      const plan = planeAt(cx, cy, levelElev(level));
      if (!plan) return;
      const p = snapWallPoint(level, plan, chain?.last);
      showDot(p, level);
      if (chain) {
        showRubber(chain.last, p, level);
        showTip(`${formatLen(G.dist(chain.last, p))}`, cx, cy);
      } else showTip('');
    } else if (tool === 'window' || tool === 'door') {
      canvas.style.cursor = 'crosshair';
      updateGhost(cx, cy);
    } else canvas.style.cursor = 'crosshair';
  }

  function onUp(e) {
    const p = press;
    press = null;
    if (!enabled && !p?.took && !drag) return;
    if (e.type === 'pointercancel') {
      cancelDrag();
      if (roomDrag) {
        roomDrag = null;
        rectLine.visible = rectFill.visible = false;
        showTip('');
        setOrbit(true);
      }
      return;
    }
    if (drag) {
      const d = drag;
      drag = null;
      commitDrag(d);
      setOrbit(true);
      canvas.style.cursor = '';
      updateBar();
      return;
    }
    if (roomDrag) {
      const rd = roomDrag;
      roomDrag = null;
      rectLine.visible = rectFill.visible = false;
      showTip('');
      setOrbit(true);
      const r = rectFromPoints(rd.a, rd.b);
      if (r.width >= MIN_ROOM_MM && r.depth >= MIN_ROOM_MM) addRoomRect(r, rd.level);
      invalidate();
      return;
    }
    if (p?.took) setOrbit(true);
    if (!canInteract() || !p) return;
    if (Math.hypot(e.clientX - p.x, e.clientY - p.y) > CLICK_PX || performance.now() - p.t > 700) return;
    click(e, p);
  }

  let lastClickT = 0;
  function click(e, p) {
    const now = performance.now();
    const dbl = now - lastClickT < 350;
    lastClickT = now;
    if (tool === 'select') {
      const hit = p.hit;
      if (hit && hit.kind !== 'roof') store.select(hit.id);
      else store.select(null);
      return;
    }
    if (tool === 'wall') {
      const level = activeLevel();
      const plan = planeAt(e.clientX, e.clientY, levelElev(level));
      if (!plan) return;
      const pt = snapWallPoint(level, plan, chain?.last);
      if (chain && (dbl || G.dist(pt, chain.last) < MIN_WALL_MM)) {
        finishChain();
        return;
      }
      addWallPoint(pt, level);
    } else if (tool === 'window' || tool === 'door') {
      updateGhost(e.clientX, e.clientY);
      placeGhost();
    }
  }

  // Wall drawing ----------------------------------------------------------------------------------------
  function addWallPoint(pt, level = activeLevel()) {
    if (!chain) {
      chain = { last: pt, level };
      showDot(pt, level);
      say('Click the next point. Double click or press Esc to finish.', { ms: 6000 });
      return true;
    }
    try {
      store.run('add_wall', { level: level.id, x1: chain.last.x, y1: chain.last.y, x2: pt.x, y2: pt.y });
      chain.last = pt;
      return true;
    } catch (e) {
      say(e.message || 'That wall could not be added.', { error: true });
      return false;
    }
  }
  function finishChain() {
    chain = null;
    rubber.visible = false;
    showTip('');
    say('');
    invalidate();
  }
  function showDot(p, level) {
    dot.position.set(p.x / 1000, levelElev(level) + 0.02, p.y / 1000);
    dot.visible = true;
    invalidate();
  }
  function showRubber(a, b, level) {
    const y = levelElev(level) + 0.03;
    rubber.geometry.setFromPoints([new THREE.Vector3(a.x / 1000, y, a.y / 1000), new THREE.Vector3(b.x / 1000, y, b.y / 1000)]);
    rubber.visible = true;
    invalidate();
  }
  const formatLen = (mm) => (mm >= 1000 ? `${(mm / 1000).toFixed(2)} m` : `${Math.round(mm)} mm`);

  // Room drawing ----------------------------------------------------------------------------------------
  function showRect(a, b, level) {
    const y = levelElev(level) + 0.03;
    const r = rectFromPoints(a, b);
    const x0 = r.x / 1000;
    const z0 = r.y / 1000;
    const x1 = (r.x + r.width) / 1000;
    const z1 = (r.y + r.depth) / 1000;
    rectLine.geometry.setFromPoints([new THREE.Vector3(x0, y, z0), new THREE.Vector3(x1, y, z0), new THREE.Vector3(x1, y, z1), new THREE.Vector3(x0, y, z1)]);
    rectLine.visible = true;
    rectFill.position.set((x0 + x1) / 2, y - 0.005, (z0 + z1) / 2);
    rectFill.scale.set(Math.max(0.001, x1 - x0), Math.max(0.001, z1 - z0), 1);
    rectFill.visible = true;
    invalidate();
  }
  function addRoomRect(r, level) {
    try {
      const res = store.run('add_room', { level: level.id, type: 'other', x: r.x, y: r.y, width: r.width, depth: r.depth });
      if (res?.id) store.select(res.id);
      say('Room added. Rename it in the properties panel.', { ms: 4000 });
      return res;
    } catch (e) {
      say(e.message || 'That room could not be added.', { error: true });
      return null;
    }
  }

  // Window and door ghost ------------------------------------------------------------------------------
  function updateGhost(cx, cy) {
    const level = activeLevel();
    const hit = pickAt(cx, cy);
    let wall = null;
    if (hit && (hit.kind === 'wall' || hit.kind === 'opening') && hit.levelId === level.id) {
      const wid = hit.kind === 'wall' ? hit.id : hit.wallId;
      wall = level.walls.find((w) => w.id === wid) || null;
    }
    if (!wall || !hit.point) {
      ghost.visible = false;
      ghostInfo = null;
      invalidate();
      return null;
    }
    const proj = G.projectToSegment({ x: hit.point.x * 1000, y: hit.point.z * 1000 }, wall.a, wall.b);
    const g = openingGhost(level, wall, tool === 'door' ? 'door' : 'window', proj.along, DEFAULTS.openings);
    ghostInfo = g;
    ghost.material = g.fits ? ghostMat : ghostBad;
    const elev = levelElev(level);
    ghost.scale.set(g.width / 1000, g.height / 1000, (g.thickness + 80) / 1000);
    ghost.position.set(g.centre.x / 1000, elev + (g.sill + g.height / 2) / 1000, g.centre.y / 1000);
    ghost.rotation.set(0, -g.angle, 0);
    ghost.visible = true;
    showTip(g.fits ? `${tool === 'door' ? 'Door' : 'Window'} ${formatLen(g.width)} wide` : 'Overlaps another opening', cx, cy);
    invalidate();
    return g;
  }
  function placeGhost() {
    const g = ghostInfo;
    if (!g) return null;
    if (!g.fits) {
      say('That overlaps another opening or the wall is too short.', { error: true });
      return null;
    }
    try {
      const res = store.run('add_opening', { level: activeLevel().id, wall: g.wallId, kind: g.kind, offset: g.offset });
      if (res?.id) store.select(res.id);
      return res;
    } catch (e) {
      say(e.message || 'That opening could not be added.', { error: true });
      return null;
    }
  }

  // Keys ------------------------------------------------------------------------------------------------
  function typing(e) {
    const t = e.target;
    return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
  }
  function eat(e) {
    e.preventDefault();
    e.stopImmediatePropagation();
  }
  function onKey(e) {
    if (e.ctrlKey || e.metaKey || e.altKey || typing(e) || !isActive() || getMode() !== 'orbit') return;
    if (e.code === 'KeyB') {
      eat(e);
      if (!e.repeat) setEnabled(!enabled);
      return;
    }
    const sel = store.ui.selection;
    const found = sel ? store.find(sel) : null;
    // With Edit off only a selected furniture item, tank or stairs answers the keys.
    if (!enabled && (!found || !MOVABLE.includes(found.kind) || suspended())) return;
    if (e.code === 'Escape') {
      if (drag) {
        eat(e);
        cancelDrag();
      } else if (!enabled) {
        store.select(null);
      } else if (roomDrag) {
        eat(e);
        roomDrag = null;
        rectLine.visible = rectFill.visible = false;
        showTip('');
        setOrbit(true);
        invalidate();
      } else if (chain) {
        eat(e);
        finishChain();
      } else if (tool !== 'select') {
        eat(e);
        setTool('select');
      }
      return;
    }
    if (drag || roomDrag) return;
    if (e.code === 'Comma' || e.code === 'Period') {
      if (!found || !ROTATABLE.includes(found.kind)) return;
      eat(e);
      rotateSelected(found, (e.code === 'Comma' ? -1 : 1) * (e.shiftKey ? 15 : 90));
      return;
    }
    if (e.code === 'Delete' || e.code === 'Backspace') {
      if (!found || !DELETABLE.includes(found.kind)) return;
      eat(e);
      deleteSelected(found);
    }
  }
  function rotateSelected(found, deg) {
    const rot = nextRotation(found.item.rotation, deg);
    try {
      store.run(found.kind === 'stair' ? 'update_stair' : 'update_furniture', { id: found.item.id, rotation: rot });
      return rot;
    } catch (err) {
      say(err.message || 'That could not be rotated.', { error: true });
      return null;
    }
  }
  function deleteSelected(found) {
    try {
      store.run('delete', { id: found.item.id });
      return true;
    } catch (err) {
      say(err.message || 'That could not be deleted.', { error: true });
      return false;
    }
  }
  window.addEventListener('keydown', onKey, true);

  // Enable and tools --------------------------------------------------------------------------------------
  function setTool(next) {
    if (!TOOLS.some((t) => t.id === next)) return;
    if (next !== tool) {
      finishChain();
      ghost.visible = false;
      ghostInfo = null;
      dot.visible = false;
      rectLine.visible = rectFill.visible = false;
      roomDrag = null;
      showTip('');
    }
    tool = next;
    for (const b of toolsEl.querySelectorAll('[data-tool]')) b.setAttribute('aria-pressed', String(b.dataset.tool === tool));
    canvas.style.cursor = tool === 'select' ? '' : 'crosshair';
    if (enabled) say(TOOLS.find((t) => t.id === tool).hint, { ms: 7000 });
    invalidate();
  }
  function setEnabled(on) {
    on = !!on && getMode() === 'orbit';
    if (on === enabled) return;
    if (!on) {
      cancelDrag();
      finishChain();
      roomDrag = null;
      ghost.visible = dot.visible = rectLine.visible = rectFill.visible = false;
      tool = 'select';
      for (const b of toolsEl.querySelectorAll('[data-tool]')) b.setAttribute('aria-pressed', String(b.dataset.tool === 'select'));
      showTip('');
      canvas.style.cursor = '';
      setOrbit(true);
    }
    enabled = on;
    toggleBtn.setAttribute('aria-pressed', String(on));
    toggleBtn.classList.toggle('is-on', on);
    stateEl.textContent = on ? 'On' : 'Off';
    toolsEl.hidden = !on;
    bar.classList.toggle('is-editing', on);
    rootEl.classList.toggle('is-editing', on);
    say(on ? TOOLS[0].hint : '', { ms: 7000 });
    refreshSelection();
    onChange?.(on);
  }
  let onChange = null;

  // Visibility follows the viewer mode: no editing in the walk-through.
  function onModeChange() {
    const orbit = getMode() === 'orbit';
    bar.hidden = !orbit;
    overlay.visible = true;
    ghost.visible = false;
    tip.hidden = true;
    if (!orbit && enabled) setEnabled(false);
    refreshSelection();
  }

  canvas.addEventListener('pointerdown', onDown, true);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onUp);
  // Keep the outline of the selected item on for a few seconds even with Edit off (used after placing an item).
  function pinSelection(ms = 5000) {
    pinned = true;
    clearTimeout(pinTimer);
    pinTimer = setTimeout(() => {
      pinned = false;
      refreshSelection();
    }, ms);
    refreshSelection();
  }
  const offSel = store.on('selection', () => {
    if (pinned && !enabled) {
      pinned = false;
      clearTimeout(pinTimer);
    }
    refreshSelection();
  });
  // A deleted or changed item: the model is rebuilt shortly after (onRebuild), but the bar must not linger.
  const offProject = store.on('project', () => updateBar());

  function dispose() {
    window.removeEventListener('keydown', onKey, true);
    canvas.removeEventListener('pointerdown', onDown, true);
    canvas.removeEventListener('pointermove', onMove);
    canvas.removeEventListener('pointerup', onUp);
    canvas.removeEventListener('pointercancel', onUp);
    offSel?.();
    offProject?.();
    clearTimeout(msgTimer);
    clearTimeout(pinTimer);
    cancelDrag();
    overlay.traverse((o) => {
      o.geometry?.dispose?.();
      if (o.material && o.material !== lineMat && o.material !== fillMat && o.material !== ghostMat && o.material !== ghostBad) o.material.dispose?.();
    });
    for (const m of [lineMat, fillMat, ghostMat, ghostBad, redMat]) m.dispose();
    scene.remove(overlay);
    bar.remove();
    itemBar.remove();
    tip.remove();
  }

  return {
    get enabled() {
      return enabled;
    },
    get tool() {
      return tool;
    },
    setEnabled,
    setTool,
    pinSelection,
    onModeChange,
    onRebuild: refreshSelection,
    onActiveChange: refreshSelection,
    onFrame: placeBar,
    // What the walk-through uses for the selected item.
    items: {
      selected: () => selectedItem(),
      name: (id) => labelOf(id ? store.find(id) : null),
      remove: () => {
        const found = selectedItem();
        return found ? deleteSelected(found) : false;
      },
      rotate: (deg) => {
        const found = selectedItem();
        return found && ROTATABLE.includes(found.kind) ? rotateSelected(found, deg) != null : false;
      },
    },
    set onChange(fn) {
      onChange = fn;
    },
    cancel: cancelDrag,
    dispose,
    // Internals exposed for tests: the same code paths the pointer handlers use.
    _test: {
      beginDrag: (kind, id, planMm) => {
        const lvl = store.find(id)?.level;
        const hit = { kind, id, levelId: lvl?.id, point: { y: levelElev(lvl) + 1 } };
        const d = beginDrag(hit, planMm);
        if (d) drag = d;
        return d;
      },
      dragTo: (planMm) => (drag ? dragTo(drag, planMm) : null),
      endDrag: () => {
        const d = drag;
        drag = null;
        return d ? commitDrag(d) : false;
      },
      get drag() {
        return drag;
      },
      addWallPoint: (p) => addWallPoint(snapWallPoint(activeLevel(), p, chain?.last)),
      finishChain,
      get chain() {
        return chain;
      },
      addRoomRect: (a, b) => addRoomRect(rectFromPoints(snapWallPoint(activeLevel(), a), snapWallPoint(activeLevel(), b)), activeLevel()),
      rotateSelected: (deg) => {
        const f = store.find(store.ui.selection);
        return f ? rotateSelected(f, deg) : null;
      },
      deleteSelected: () => {
        const f = store.find(store.ui.selection);
        return f ? deleteSelected(f) : false;
      },
      ghostFor: (wallId, offset) => {
        const level = activeLevel();
        const wall = level.walls.find((w) => w.id === wallId);
        if (!wall) return null;
        const g = openingGhost(level, wall, tool === 'door' ? 'door' : 'window', offset, DEFAULTS.openings);
        ghostInfo = g;
        return g;
      },
      placeGhost,
      get message() {
        return msgEl.hidden ? '' : msgEl.textContent;
      },
      get bar() {
        return itemBar.hidden ? null : { name: itemName.textContent, left: itemBar.style.left, top: itemBar.style.top, rotate: rotBtns.every((b) => !b.hidden) };
      },
      get selectionBox() {
        return selHelper ? selHelper.box.clone() : null;
      },
      clashes: () => furnitureClashes(store.project, sizeOf),
      get red() {
        return !!drag?.red;
      },
      get tipText() {
        return tip.hidden ? '' : tip.textContent;
      },
    },
  };
}
