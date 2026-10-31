// Placing things where the player is looking: furniture 1.5 m ahead, and windows or doors on the wall in view.
// Works in Walk mode (ahead of the player, wall under the crosshair) and in orbit mode (ahead of the orbit
// target, wall under the pointer). Every change goes through store.run as one undo step.

import * as THREE from 'three';
import * as G from '../model/geometry.js';
import { DEFAULTS } from '../model/schema.js';
import { openingGhost } from './edit-logic.js';
import { aheadPlacement, yawToDir } from './place-logic.js';

const DEG = Math.PI / 180;
const HINT_PLACED = 'Drag it to move it. Rotate with comma and full stop, Delete removes it.';
const KIND_NAME = { window: 'Window', door: 'Door', sliding_door: 'Sliding door', garage_door: 'Garage door', roller_door: 'Roller door', opening: 'Opening' };

export function createAhead({ scene, camera, canvas, rootEl, store, catalogue, controls, walk, edit, pickAt, getMode, isActive, invalidate }) {
  let armed = null; // { type: 'item', itemId, def } | { type: 'opening', preset, kind }
  let ghostInfo = null; // last ghost for an armed opening, or the last placement for an armed item
  let toastTimer = null;
  let lastPtr = null;
  let lastProbe = 0;
  let press = null;

  const def = (id) => {
    try {
      return catalogue?.getFurniture?.(id) || null;
    } catch {
      return null;
    }
  };

  // DOM ------------------------------------------------------------------------------------------
  const toast = document.createElement('div');
  toast.className = 'ps3d-toast';
  toast.setAttribute('role', 'status');
  toast.hidden = true;
  rootEl.appendChild(toast);
  const bar = document.createElement('div');
  bar.className = 'ps3d-armbar';
  bar.hidden = true;
  bar.innerHTML = '<span class="ps3d-armtext"></span><button type="button" class="ps3d-btn ps3d-armgo">Place</button><button type="button" class="ps3d-btn ps3d-armstop">Cancel</button>';
  rootEl.appendChild(bar);
  const armText = bar.querySelector('.ps3d-armtext');
  bar.querySelector('.ps3d-armgo').addEventListener('click', () => placeArmed());
  bar.querySelector('.ps3d-armstop').addEventListener('click', () => disarm());
  bar.addEventListener('pointerdown', (e) => e.stopPropagation());

  function say(text, { error = false, ms = 5000 } = {}) {
    clearTimeout(toastTimer);
    toast.textContent = text || '';
    toast.hidden = !text;
    toast.classList.toggle('is-error', !!error);
    if (text && ms) toastTimer = setTimeout(() => say(''), ms);
  }

  // Ghost (not part of the model, so rebuilds leave it alone) --------------------------------------
  const ACCENT = new THREE.Color('#1f6feb');
  const RED = new THREE.Color('#e5484d');
  const okMat = new THREE.MeshBasicMaterial({ color: ACCENT, depthTest: false, transparent: true, opacity: 0.38, toneMapped: false });
  const badMat = new THREE.MeshBasicMaterial({ color: RED, depthTest: false, transparent: true, opacity: 0.42, toneMapped: false });
  const ghost = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), okMat);
  ghost.visible = false;
  ghost.renderOrder = 998;
  ghost.name = 'ahead-ghost';
  scene.add(ghost);

  // Where "ahead" is: the player in Walk mode, the orbit target otherwise. Plan mm, with a unit plan direction.
  function viewOrigin() {
    if (getMode() === 'walk') {
      const d = yawToDir(walk.yaw);
      return { origin: { x: camera.position.x * 1000, y: camera.position.z * 1000 }, dir: { x: d.x, y: d.z } };
    }
    const t = controls.target;
    let dx = t.x - camera.position.x;
    let dz = t.z - camera.position.z;
    const l = Math.hypot(dx, dz);
    if (l < 1e-6) {
      dx = 0;
      dz = -1;
    } else {
      dx /= l;
      dz /= l;
    }
    return { origin: { x: t.x * 1000, y: t.z * 1000 }, dir: { x: dx, y: dz } };
  }

  function itemSpot(itemId, size) {
    const { origin, dir } = viewOrigin();
    return aheadPlacement(origin, dir, itemId, { sizeOf: (id) => (id === itemId ? size : def(id)), level: store.level(), size });
  }

  // Furniture ----------------------------------------------------------------------------------------
  function addItem(itemId, spot) {
    const level = store.level();
    try {
      const res = store.run('add_furniture', { level: level.id, item: itemId, x: spot.x, y: spot.y, rotation: spot.rotation });
      store.select(res.id);
      edit.pinSelection(6000);
      say(HINT_PLACED, { ms: 6000 });
      invalidate();
      return { id: res.id, x: spot.x, y: spot.y, rotation: spot.rotation, level: level.id };
    } catch (e) {
      say(e.message || 'That item could not be placed.', { error: true });
      return null;
    }
  }

  function placeItemAhead(itemId) {
    const d = def(itemId);
    if (catalogue?.getFurniture && !d) {
      say('That item is not in the catalogue.', { error: true });
      return null;
    }
    disarm();
    return addItem(itemId, itemSpot(itemId, d ? { w: d.w, d: d.d } : null));
  }

  function armItemAhead(itemId) {
    const d = def(itemId);
    if (catalogue?.getFurniture && !d) {
      say('That item is not in the catalogue.', { error: true });
      return false;
    }
    arm({ type: 'item', itemId, def: d });
    return true;
  }

  // Openings -----------------------------------------------------------------------------------------
  function openingProbe(clientX, clientY) {
    const level = store.level();
    const hit = pickAt(clientX, clientY);
    if (!hit || !hit.point || !(hit.kind === 'wall' || hit.kind === 'opening') || hit.levelId !== level.id) return null;
    if (getMode() === 'walk' && hit.distance > 9) return null;
    const wall = level.walls.find((w) => w.id === (hit.kind === 'wall' ? hit.id : hit.wallId));
    if (!wall) return null;
    const along = G.projectToSegment({ x: hit.point.x * 1000, y: hit.point.z * 1000 }, wall.a, wall.b).along;
    const p = armed.preset || {};
    return openingGhost(level, wall, armed.kind, along, DEFAULTS.openings, { width: p.width, height: p.height, sill: p.sill });
  }

  function armOpeningAhead(preset) {
    const p = typeof preset === 'string' ? { kind: preset } : { ...(preset || {}) };
    const kind = p.kind || 'window';
    arm({ type: 'opening', preset: p, kind });
    return true;
  }

  // Armed state --------------------------------------------------------------------------------------
  function arm(next) {
    armed = next;
    ghostInfo = null;
    ghost.visible = false;
    if (edit.enabled) edit.cancel();
    const name = next.type === 'item' ? next.def?.name || 'item' : (next.preset?.name || KIND_NAME[next.kind] || 'Opening').toLowerCase();
    armText.textContent = next.type === 'item' ? `Placing ${name}. Click or press E to place, Esc to cancel.` : `Placing ${name}. Look at a wall, then click or press E. Esc cancels.`;
    bar.hidden = false;
    say('');
    update(true);
    invalidate();
  }

  function disarm() {
    if (!armed) return false;
    armed = null;
    ghostInfo = null;
    ghost.visible = false;
    bar.hidden = true;
    invalidate();
    return true;
  }

  function placeArmed() {
    if (!armed) return null;
    update(true);
    if (armed.type === 'item') {
      const spot = ghostInfo;
      if (!spot) return null;
      if (spot.clashes) {
        say('That would overlap a wall. Step back or turn and try again.', { error: true });
        return null;
      }
      const itemId = armed.itemId;
      const out = addItem(itemId, spot);
      if (out) disarm();
      return out;
    }
    const g = ghostInfo;
    if (!g) {
      say('Look at a wall to place it.', { error: true });
      return null;
    }
    if (!g.fits) {
      say('That overlaps another opening or the wall is too short.', { error: true });
      return null;
    }
    const p = armed.preset || {};
    const args = { level: store.level().id, wall: g.wallId, kind: g.kind, offset: g.offset };
    if (p.width != null) args.width = g.width;
    if (p.height != null) args.height = p.height;
    if (p.sill != null) args.sill = p.sill;
    if (p.style) args.style = p.style;
    try {
      const res = store.run('add_opening', args);
      if (res?.id) store.select(res.id);
      say(`${KIND_NAME[g.kind] || 'Opening'} added.`, { ms: 3500 });
      disarm();
      return res;
    } catch (e) {
      say(e.message || 'That opening could not be added.', { error: true });
      return null;
    }
  }

  // Per frame (Walk) or per pointer move (orbit): keep the ghost on the thing being targeted.
  function update(force = false) {
    if (!armed || !isActive()) return;
    const now = performance.now();
    if (armed.type === 'item') {
      const d = armed.def;
      const size = d ? { w: d.w, d: d.d } : { w: 600, d: 600 };
      const spot = itemSpot(armed.itemId, size);
      ghostInfo = spot;
      const level = store.level();
      const h = (d?.h || 800) / 1000;
      ghost.material = spot.clashes ? badMat : okMat;
      ghost.scale.set(size.w / 1000, h, size.d / 1000);
      ghost.position.set(spot.x / 1000, level.elevation / 1000 + h / 2, spot.y / 1000);
      ghost.rotation.set(0, -spot.rotation * DEG, 0);
      ghost.visible = true;
      invalidate();
      return;
    }
    if (!force && now - lastProbe < 60) return;
    lastProbe = now;
    let cx;
    let cy;
    const r = canvas.getBoundingClientRect();
    if (getMode() === 'walk') {
      cx = r.left + r.width / 2;
      cy = r.top + r.height / 2;
    } else if (lastPtr) {
      cx = lastPtr.x;
      cy = lastPtr.y;
    } else {
      ghost.visible = false;
      return;
    }
    const g = openingProbe(cx, cy);
    ghostInfo = g;
    if (!g) {
      ghost.visible = false;
      invalidate();
      return;
    }
    const level = store.level();
    ghost.material = g.fits ? okMat : badMat;
    ghost.scale.set(g.width / 1000, g.height / 1000, (g.thickness + 80) / 1000);
    ghost.position.set(g.centre.x / 1000, level.elevation / 1000 + (g.sill + g.height / 2) / 1000, g.centre.y / 1000);
    ghost.rotation.set(0, -g.angle, 0);
    ghost.visible = true;
    invalidate();
  }

  // Input ----------------------------------------------------------------------------------------------
  const typing = (e) => {
    const t = e.target;
    return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
  };
  function onKey(e) {
    // Walk mode keys come through the walk hooks. This is the orbit mode path.
    if (!armed || getMode() !== 'orbit' || !isActive() || typing(e) || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.code === 'Escape') {
      e.preventDefault();
      e.stopImmediatePropagation();
      disarm();
    } else if (e.code === 'KeyE') {
      e.preventDefault();
      e.stopImmediatePropagation();
      if (!e.repeat) placeArmed();
    }
  }
  window.addEventListener('keydown', onKey, true);

  function onMove(e) {
    lastPtr = { x: e.clientX, y: e.clientY };
    if (armed && getMode() === 'orbit') update();
  }
  function onDown(e) {
    press = armed && e.button === 0 ? { x: e.clientX, y: e.clientY, t: performance.now() } : null;
    if (armed && e.button === 0 && getMode() === 'orbit') lastPtr = { x: e.clientX, y: e.clientY };
  }
  function onUp(e) {
    const p = press;
    press = null;
    if (!armed || !p || e.button !== 0 || !isActive()) return;
    if (getMode() === 'walk') {
      if (!walk.locked) return; // the first click only resumes looking around
    } else if (Math.hypot(e.clientX - p.x, e.clientY - p.y) > 5 || performance.now() - p.t > 700) return;
    placeArmed();
  }
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointerup', onUp);

  walk.setHooks({
    use: () => {
      if (!armed) return false;
      placeArmed();
      return true;
    },
    cancel: () => disarm(),
    armed: () => !!armed,
  });

  function dispose() {
    window.removeEventListener('keydown', onKey, true);
    canvas.removeEventListener('pointermove', onMove);
    canvas.removeEventListener('pointerdown', onDown);
    canvas.removeEventListener('pointerup', onUp);
    clearTimeout(toastTimer);
    scene.remove(ghost);
    ghost.geometry.dispose();
    okMat.dispose();
    badMat.dispose();
    toast.remove();
    bar.remove();
  }

  return {
    placeItemAhead,
    armItemAhead,
    armOpeningAhead,
    placeArmed,
    disarm,
    update,
    dispose,
    say,
    get armed() {
      return armed ? { ...armed } : null;
    },
    get isArmed() {
      return !!armed;
    },
    get ghost() {
      return { visible: ghost.visible, red: ghost.material === badMat, position: ghost.position.clone(), info: ghostInfo };
    },
    get message() {
      return toast.hidden ? '' : toast.textContent;
    },
  };
}
