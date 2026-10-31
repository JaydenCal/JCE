// First person walk mode: pointer lock (with drag-to-look fallback), keyboard and touch input,
// collision against walls, level changes and a small HUD. Browser only.

import * as THREE from 'three';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';
import { WALK, buildColliders, chooseSpawn, resolveCollisions } from './colliders.js';
import { nudgeToFloor, footprintTester } from './place-logic.js';
import { findDoorTarget } from './doors.js';
import { stairInfos, stairColliders, stairZoneAt, canJoinStair, levelOnStair, chooseLanding, findStairTarget } from './stairs.js';

const KEYS = {
  forward: ['KeyW', 'ArrowUp'],
  back: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
};
const MAX_PITCH = Math.PI / 2 - 0.06;

export const LEVEL_MOVE_S = 0.3; // vertical glide between levels
const ITEM_KINDS = ['furniture', 'tank', 'stair'];
const LOOK_REACH = 3.5; // m: how far away an item can be selected from
const LOOK_EVERY_MS = 90;

export function createWalk({ camera, canvas, container, store, onExit, doors = null, lookAt = null }) {
  const controls = new PointerLockControls(camera, canvas);
  controls.pointerSpeed = 0.9;
  const held = new Set();
  const joy = { x: 0, y: 0 };
  let active = false;
  let colliders = [];
  let levelId = null;
  let eyeTarget = WALK.eye;
  let eyeY = WALK.eye;
  let glide = null; // { from, to, t } vertical move between levels
  let suspended = false; // the inventory wheel is open: no input, and losing the pointer lock is not an exit
  let hooks = {}; // { use(), cancel(), armed() } from the placement code
  let items = null; // { selected(), remove(), rotate(deg), name(id) } from the 3D editor: the selected furniture, tank or stairs
  let stairs = []; // stairInfos of the project
  let onStair = null; // the stair zone the player is on: { info, u, v, h, frac }
  let lookHit = null; // furniture, tank or stairs under the crosshair
  let lookT = 0;
  let target = null; // what E would use: { type: 'door' | 'stair' | 'item', ... }
  let lockFailed = false; // the browser refused the pointer lock: clicks act directly
  const reduceMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  let leaving = false;
  let lockAsked = 0;
  let dragLook = null;
  let suspendedFrames = 0;
  let hintTimer = null;
  let offUI = null;
  const touch = typeof matchMedia === 'function' && (matchMedia('(pointer: coarse)').matches || (navigator.maxTouchPoints || 0) > 0);

  // HUD ---------------------------------------------------------------------------------------
  const hud = document.createElement('div');
  hud.className = 'ps3d-hud';
  hud.hidden = true;
  hud.innerHTML = `
    <div class="ps3d-cross" aria-hidden="true"></div>
    <div class="ps3d-hudtop">
      <button type="button" class="ps3d-btn ps3d-exit">Exit walk</button>
      <span class="ps3d-hudhint"></span>
    </div>
    <div class="ps3d-start" role="status"></div>
    <button type="button" class="ps3d-prompt" hidden><kbd class="ps3d-key">E</kbd><span class="ps3d-prompt-text">Hold E to open</span></button>
    <div class="ps3d-levels" role="group" aria-label="Level">
      <button type="button" class="ps3d-btn ps3d-up" aria-label="Go up one level">Up</button>
      <span class="ps3d-levelname" aria-live="polite"></span>
      <button type="button" class="ps3d-btn ps3d-down" aria-label="Go down one level">Down</button>
    </div>
    <div class="ps3d-zone ps3d-zone-move" hidden></div>
    <div class="ps3d-zone ps3d-zone-look" hidden></div>
    <div class="ps3d-joy" hidden><div class="ps3d-joyknob"></div></div>`;
  container.appendChild(hud);
  const q = (s) => hud.querySelector(s);
  const hintEl = q('.ps3d-hudhint');
  const startEl = q('.ps3d-start');
  const levelEl = q('.ps3d-levelname');
  const upBtn = q('.ps3d-up');
  const downBtn = q('.ps3d-down');
  const joyEl = q('.ps3d-joy');
  const knob = q('.ps3d-joyknob');
  const zoneMove = q('.ps3d-zone-move');
  const zoneLook = q('.ps3d-zone-look');
  const promptEl = q('.ps3d-prompt');
  const promptText = q('.ps3d-prompt-text');
  let doorTarget = null;
  let doorVersion = -1;
  q('.ps3d-exit').addEventListener('click', () => leave());
  upBtn.addEventListener('click', () => changeLevel(1));
  downBtn.addEventListener('click', () => changeLevel(-1));
  hintEl.textContent = touch ? 'Left thumb to move, drag the right side to look' : 'W A S D or arrows to move, mouse to look, Shift to run, E to open doors, use stairs or select items, Q for the inventory wheel, Esc to leave';
  promptEl.addEventListener('click', () => useTarget());
  // keep the pointer events on the prompt from starting a look drag
  promptEl.addEventListener('pointerdown', (e) => e.stopPropagation());

  const sortedLevels = () => [...store.project.levels].sort((a, b) => a.elevation - b.elevation);
  const currentLevel = () => store.project.levels.find((l) => l.id === levelId) || store.project.levels[0];

  function rotate(dYaw, dPitch) {
    const e = new THREE.Euler().setFromQuaternion(camera.quaternion, 'YXZ');
    e.y += dYaw;
    e.x = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, e.x + dPitch));
    e.z = 0;
    camera.quaternion.setFromEuler(e);
  }

  function collidersFor(id) {
    return [
      ...buildColliders(store.project, id, {
        statusView: store.ui.statusView,
        blockingDoor: doors ? (o) => doors.blocks(o.id) : null,
      }),
      ...stairColliders(store.project, id, stairs),
    ];
  }
  function refreshColliders() {
    stairs = stairInfos(store.project);
    colliders = collidersFor(levelId);
    doorVersion = doors ? doors.version : -1;
  }

  // What E uses ---------------------------------------------------------------------------------------------
  function yawNow() {
    return new THREE.Euler().setFromQuaternion(camera.quaternion, 'YXZ').y;
  }
  function useDoor() {
    if (!active || !doors || !doorTarget) return false;
    const open = doors.toggle(doorTarget.opening.id);
    refreshColliders();
    showPrompt(target, open);
    return true;
  }
  // E, a click on the prompt, or a click while looking around: take the stair, select the item or work the door.
  function useTarget() {
    if (!active || suspended || !target) return false;
    if (target.type === 'door') return useDoor();
    if (target.type === 'stair') {
      takeStair(target.info);
      return true;
    }
    if (target.type === 'item') {
      if (store.ui.selection === target.id) store.select(null);
      else store.select(target.id);
      target = null; // the prompt text is rebuilt on the next frame
      promptEl.dataset.key = '';
      return true;
    }
    return false;
  }
  function setPrompt(text, key) {
    if (!text) {
      if (!promptEl.hidden) promptEl.hidden = true;
      promptEl.dataset.key = '';
      return;
    }
    if (promptEl.dataset.key === key && !promptEl.hidden) return;
    promptEl.dataset.key = key;
    promptText.textContent = text;
    promptEl.hidden = false;
  }
  function showPrompt(t, openNow) {
    if (!t || t.type !== 'door') return;
    const o = t.opening;
    const noun = o.kind === 'door' ? 'door' : o.kind === 'sliding_door' ? 'sliding door' : 'door';
    const open = openNow ?? doors.isOpen(o.id);
    const roll = o.kind === 'garage_door' || o.kind === 'roller_door';
    promptText.textContent = open ? (touch ? `Close ${noun}` : `Press E to close`) : touch ? `Open ${noun}` : roll ? 'Hold E to raise' : 'Hold E to open';
    promptEl.dataset.key = `door:${o.id}:${open}`;
    promptEl.hidden = false;
  }
  function refreshLook(now) {
    if (!lookAt || now - lookT < LOOK_EVERY_MS) return;
    lookT = now;
    let hit = null;
    try {
      hit = lookAt();
    } catch {
      hit = null;
    }
    lookHit = hit && ITEM_KINDS.includes(hit.kind) && hit.distance <= LOOK_REACH && (hit.kind !== 'furniture' || hit.levelId === levelId) ? hit : null;
  }
  function updateTarget() {
    refreshLook(performance.now());
    const pos = { x: camera.position.x, z: camera.position.z };
    let next = null;
    if (!onStair) {
      const geo = findStairTarget(stairs, levelId, pos, yawNow());
      const lookStair = lookHit?.kind === 'stair' ? stairs.find((i) => i.stair.id === lookHit.id) : null;
      if (lookStair?.connects && (lookStair.level.id === levelId || lookStair.upper.id === levelId)) next = { type: 'stair', info: lookStair, goes: lookStair.level.id === levelId ? 'up' : 'down' };
      else if (geo) next = { type: 'stair', info: geo.info, goes: geo.goes };
      else if (lookHit) next = { type: 'item', id: lookHit.id, kind: lookHit.kind };
      else if (doors) {
        const d = findDoorTarget(store.project, levelId, pos, yawNow(), { statusView: store.ui.statusView });
        if (d) next = { type: 'door', ...d };
      }
    }
    target = next;
    doorTarget = next?.type === 'door' ? next : null;
    if (!next) return setPrompt('');
    if (next.type === 'door') {
      const open = doors.isOpen(next.opening.id);
      const key = `door:${next.opening.id}:${open}`;
      if (promptEl.dataset.key !== key || promptEl.hidden) showPrompt(next);
    } else if (next.type === 'stair') {
      const up = next.goes === 'up';
      setPrompt(touch ? (up ? 'Go up the stairs' : 'Go down the stairs') : up ? 'Press E to go up' : 'Press E to go down', `stair:${next.info.stair.id}:${next.goes}`);
    } else {
      const sel = store.ui.selection === next.id;
      const label = items?.name?.(next.id) || 'item';
      setPrompt(touch ? (sel ? `Deselect ${label}` : `Select ${label}`) : sel ? `Press E to deselect ${label}` : `Press E to select ${label}`, `item:${next.id}:${sel}`);
    }
  }

  function updateHud() {
    const levels = sortedLevels();
    const i = levels.findIndex((l) => l.id === levelId);
    levelEl.textContent = currentLevel()?.name || '';
    upBtn.disabled = i >= levels.length - 1;
    downBtn.disabled = i <= 0;
    q('.ps3d-levels').hidden = levels.length < 2;
  }

  function placeAtSpawn() {
    const s = chooseSpawn(store.project, levelId, { statusView: store.ui.statusView });
    const lvl = currentLevel();
    camera.position.set(s.x, lvl.elevation / 1000 + WALK.eye, s.z);
    camera.quaternion.setFromEuler(new THREE.Euler(0, s.yaw, 0, 'YXZ'));
    eyeY = eyeTarget = lvl.elevation / 1000 + WALK.eye;
    glide = null;
    onStair = null;
  }

  // Start moving the eye to the height of the current level, gliding unless the move is tiny.
  function glideToLevelEye() {
    eyeTarget = currentLevel().elevation / 1000 + WALK.eye;
    if (reduceMotion() || Math.abs(eyeTarget - camera.position.y) < 0.001) {
      eyeY = eyeTarget;
      camera.position.y = eyeTarget;
      glide = null;
    } else {
      eyeY = camera.position.y;
      glide = { from: eyeY, to: eyeTarget, t: 0 };
    }
  }

  // Is (x, z) a good place to stand on level `id`: on its floor and clear of walls?
  function standable(id) {
    const cols = collidersFor(id);
    const inFoot = footprintTester(store.project, id, { statusView: store.ui.statusView });
    return (x, z) => {
      if (!inFoot(x, z)) return false;
      const f = resolveCollisions({ x, z }, cols);
      return Math.hypot(f.x - x, f.z - z) < 1e-3;
    };
  }

  // Move the player to another level, keeping x and z. The eye glides to the new level's eye height; if the spot
  // is off that level's floor or inside a wall the player is nudged to the nearest valid point.
  function goToLevel(id) {
    if (!active || id === levelId) return false;
    const next = store.project.levels.find((l) => l.id === id);
    if (!next) return false;
    const pos = { x: camera.position.x, z: camera.position.z };
    levelId = next.id;
    onStair = null;
    refreshColliders();
    const fixed = nudgeToFloor(store.project, levelId, pos.x, pos.z, { statusView: store.ui.statusView, colliders });
    camera.position.x = fixed.x;
    camera.position.z = fixed.z;
    // never leave the player standing inside a stair: step off it at the end that reaches this level
    const zone = stairZoneAt(stairs, levelId, fixed.x, fixed.z);
    if (zone) {
      const side = zone.info.upper?.id === levelId ? 'top' : 'bottom';
      const land = chooseLanding(zone.info, side, { valid: standable(levelId), colliders });
      camera.position.x = land.x;
      camera.position.z = land.z;
    }
    glideToLevelEye();
    doorTarget = null;
    target = null;
    updateHud();
    return true;
  }

  // The level changed because the player is climbing or descending: keep the position and tell the tabs.
  function setLevelOnStair(id) {
    if (id === levelId) return;
    levelId = id;
    refreshColliders();
    doorTarget = null;
    target = null;
    updateHud();
    if (store.ui.activeLevelId !== id) store.setUI({ activeLevelId: id }); // levelId is already set, so the listener ignores it
  }

  // E at a stair (or a click on it): stand on the landing of the other level.
  function takeStair(info) {
    if (!active || !info?.connects) return false;
    const side = levelId === info.level.id ? 'top' : 'bottom';
    const to = side === 'top' ? info.upper.id : info.level.id;
    const land = chooseLanding(info, side, { valid: standable(to), colliders: collidersFor(to) });
    levelId = to;
    onStair = null;
    refreshColliders();
    camera.position.x = land.x;
    camera.position.z = land.z;
    const e = new THREE.Euler().setFromQuaternion(camera.quaternion, 'YXZ');
    camera.quaternion.setFromEuler(new THREE.Euler(e.x, land.yaw, 0, 'YXZ'));
    glideToLevelEye();
    doorTarget = null;
    target = null;
    setPrompt('');
    updateHud();
    if (store.ui.activeLevelId !== to) store.setUI({ activeLevelId: to });
    return true;
  }

  // While the player is on a stair the eye follows the surface and the active level follows the climb.
  function updateStair(prev) {
    const pos = { x: camera.position.x, z: camera.position.z };
    let zone = null;
    if (onStair) zone = stairZoneAt([onStair.info], levelId, pos.x, pos.z, 0.1);
    else {
      const z = stairZoneAt(stairs, levelId, pos.x, pos.z);
      if (z && canJoinStair(z, levelId, { x: pos.x - prev.x, z: pos.z - prev.z })) zone = z;
    }
    if (!zone) {
      if (onStair) {
        onStair = null;
        glideToLevelEye();
      }
      return;
    }
    onStair = zone;
    const want = levelOnStair(zone.info, zone.frac, levelId);
    if (want !== levelId) setLevelOnStair(want);
    glide = null;
    eyeTarget = zone.info.base + zone.h + WALK.eye;
  }

  // Up and Down buttons and PageUp or PageDown: pick the neighbouring level and let the store tell everyone.
  function changeLevel(delta) {
    if (!active) return;
    const levels = sortedLevels();
    const i = levels.findIndex((l) => l.id === levelId);
    const next = levels[Math.max(0, Math.min(levels.length - 1, i + delta))];
    if (!next || next.id === levelId) return;
    if (store.ui.activeLevelId !== next.id) store.setUI({ activeLevelId: next.id }); // the listener below moves the player
    goToLevel(next.id);
  }

  function leave() {
    if (leaving) return;
    leaving = true;
    try {
      if (controls.isLocked) controls.unlock();
    } catch {
      /* ignore */
    }
    onExit?.();
    leaving = false;
  }

  // Input ---------------------------------------------------------------------------------------
  function onKeyDown(e) {
    if (!active) return;
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    if (suspended) return;
    if (e.code === 'Escape') {
      e.preventDefault();
      if (hooks.armed?.()) hooks.cancel?.();
      else leave();
      return;
    }
    if (e.code === 'KeyQ' && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      if (!e.repeat) openWheel();
      return;
    }
    if (e.code === 'PageUp') {
      e.preventDefault();
      changeLevel(1);
      return;
    }
    if (e.code === 'PageDown') {
      e.preventDefault();
      changeLevel(-1);
      return;
    }
    if (e.code === 'KeyE') {
      e.preventDefault();
      if (!e.repeat && !hooks.use?.()) useTarget();
      return;
    }
    if ((e.code === 'Delete' || e.code === 'Backspace') && items && !hooks.armed?.()) {
      if (!e.repeat && items.remove?.()) e.preventDefault();
      return;
    }
    if ((e.code === 'Comma' || e.code === 'Period') && items && !e.ctrlKey && !e.metaKey && !e.altKey) {
      if (items.rotate?.((e.code === 'Comma' ? -1 : 1) * (e.shiftKey ? 15 : 90))) e.preventDefault();
      return;
    }
    if (e.code.startsWith('Arrow') || e.code === 'Space') e.preventDefault();
    held.add(e.code);
    if (e.key === 'Shift') held.add('Shift');
  }
  function onKeyUp(e) {
    held.delete(e.code);
    if (e.key === 'Shift') held.delete('Shift');
  }
  function onBlur() {
    held.clear();
  }

  const pressed = (list) => list.some((k) => held.has(k));

  function onLock() {
    lockFailed = false;
    startEl.hidden = true;
    dragLook = null;
  }
  function onUnlock() {
    if (!active || leaving || suspended) return;
    // Esc while pointer locked releases the lock: it cancels an armed item first, otherwise it leaves walk mode
    if (Date.now() - lockAsked <= 200) return;
    if (hooks.armed?.()) {
      hooks.cancel?.();
      startEl.textContent = 'Click to look around';
      startEl.hidden = touch;
      return;
    }
    leave();
  }

  // Inventory wheel (Q): release the pointer, open the wheel, and wait for it to close. Then a click looks around again.
  const wheelApi = () => (typeof window !== 'undefined' ? window.__ps?.wheel : null);
  const wheelOpen = () => {
    const w = wheelApi();
    if (typeof w?.isOpen === 'function') return !!w.isOpen();
    return !!document.querySelector('[data-ps="wheel"]');
  };
  function openWheel() {
    const w = wheelApi();
    if (!active || suspended || typeof w?.open !== 'function') return false;
    held.clear();
    joy.x = joy.y = 0;
    suspended = true; // set first so the unlock event below is not taken as an exit
    let ok;
    try {
      ok = w.open({ mode: 'walk' });
    } catch {
      ok = false;
    }
    if (ok === false) {
      suspended = false;
      return false;
    }
    try {
      if (controls.isLocked) controls.unlock();
    } catch {
      /* ignore */
    }
    return true;
  }
  function resumeAfterWheel() {
    suspended = false;
    held.clear();
    dragLook = null;
    down = null;
    startEl.textContent = 'Click to look around';
    startEl.hidden = touch;
  }
  controls.addEventListener('lock', onLock);
  controls.addEventListener('unlock', onUnlock);
  const onLockError = () => {
    lockFailed = true; // from now on a click acts directly instead of asking for the lock again
    startEl.textContent = 'Drag to look around';
  };
  document.addEventListener('pointerlockerror', onLockError);

  // Mouse: click to lock, drag to look when the lock is not held
  let down = null;
  function onPointerDown(e) {
    if (!active || suspended || e.pointerType === 'touch' || e.button !== 0) return;
    down = { x: e.clientX, y: e.clientY, moved: false, armed: !!hooks.armed?.() };
    dragLook = { x: e.clientX, y: e.clientY };
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  }
  function onPointerMove(e) {
    if (!active || !dragLook || controls.isLocked) return;
    const dx = e.clientX - dragLook.x;
    const dy = e.clientY - dragLook.y;
    dragLook.x = e.clientX;
    dragLook.y = e.clientY;
    if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) > 4) down.moved = true;
    rotate(-dx * 0.004, -dy * 0.004);
  }
  function onPointerUp(e) {
    if (!active || e.pointerType === 'touch') return;
    const wasClick = down && !down.moved;
    const armedAtDown = down?.armed;
    down = null;
    dragLook = null;
    if (!wasClick) return;
    if (controls.isLocked || lockFailed) {
      // looking around already: a click uses what is under the crosshair (not when it just placed an armed item)
      if (!armedAtDown && !hooks.armed?.()) {
        refreshLook(Infinity);
        updateTarget();
        useTarget();
      }
      return;
    }
    lockAsked = Date.now();
    try {
      // Ask for the lock directly so a refusal (a rejected promise in current browsers) is handled here
      const asked = canvas.requestPointerLock?.();
      if (asked && typeof asked.catch === 'function') asked.catch(onLockError);
      else if (!canvas.requestPointerLock) onLockError();
    } catch {
      onLockError();
    }
  }

  // Touch: left half is a floating joystick, right half looks
  const touches = new Map();
  function zoneDown(kind) {
    return (e) => {
      if (!active) return;
      e.preventDefault();
      try {
        e.target.setPointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      touches.set(e.pointerId, { kind, x: e.clientX, y: e.clientY, ox: e.clientX, oy: e.clientY });
      if (kind === 'move') {
        const r = container.getBoundingClientRect();
        joyEl.hidden = false;
        joyEl.style.left = `${e.clientX - r.left}px`;
        joyEl.style.top = `${e.clientY - r.top}px`;
        knob.style.transform = 'translate(-50%, -50%)';
      }
    };
  }
  function zoneMoveEvt(e) {
    const t = touches.get(e.pointerId);
    if (!t || !active) return;
    e.preventDefault();
    if (t.kind === 'look') {
      rotate(-(e.clientX - t.x) * 0.005, -(e.clientY - t.y) * 0.005);
      t.x = e.clientX;
      t.y = e.clientY;
    } else {
      const R = 48;
      let dx = e.clientX - t.ox;
      let dy = e.clientY - t.oy;
      const l = Math.hypot(dx, dy);
      if (l > R) {
        dx = (dx / l) * R;
        dy = (dy / l) * R;
      }
      joy.x = dx / R;
      joy.y = dy / R;
      knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
    }
  }
  function zoneUp(e) {
    const t = touches.get(e.pointerId);
    if (!t) return;
    touches.delete(e.pointerId);
    if (t.kind === 'move') {
      joy.x = 0;
      joy.y = 0;
      joyEl.hidden = true;
    }
  }
  zoneMove.addEventListener('pointerdown', zoneDown('move'));
  zoneLook.addEventListener('pointerdown', zoneDown('look'));
  for (const z of [zoneMove, zoneLook]) {
    z.addEventListener('pointermove', zoneMoveEvt);
    z.addEventListener('pointerup', zoneUp);
    z.addEventListener('pointercancel', zoneUp);
  }

  // Lifecycle -----------------------------------------------------------------------------------
  function enter() {
    if (active) return;
    active = true;
    leaving = false;
    suspended = false;
    levelId = store.ui.activeLevelId || store.project.levels[0].id;
    onStair = null;
    target = null;
    lookHit = null;
    lockFailed = false;
    refreshColliders();
    placeAtSpawn();
    updateHud();
    hud.hidden = false;
    hintEl.classList.remove('is-faded');
    clearTimeout(hintTimer);
    hintTimer = setTimeout(() => hintEl.classList.add('is-faded'), touch ? 7000 : 14000);
    startEl.textContent = 'Click to look around';
    startEl.hidden = touch;
    zoneMove.hidden = !touch;
    zoneLook.hidden = !touch;
    offUI = store.on('ui', (patch) => {
      if (patch && 'activeLevelId' in patch && active && patch.activeLevelId !== levelId) goToLevel(patch.activeLevelId);
    });
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointercancel', onPointerUp);
    canvas.focus?.();
  }

  function exit() {
    if (!active) return;
    active = false;
    suspended = false;
    glide = null;
    offUI?.();
    offUI = null;
    clearTimeout(hintTimer);
    held.clear();
    touches.clear();
    joy.x = joy.y = 0;
    hud.hidden = true;
    joyEl.hidden = true;
    promptEl.hidden = true;
    promptEl.dataset.key = '';
    doorTarget = null;
    target = null;
    lookHit = null;
    onStair = null;
    window.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('keyup', onKeyUp);
    window.removeEventListener('blur', onBlur);
    canvas.removeEventListener('pointerdown', onPointerDown);
    canvas.removeEventListener('pointermove', onPointerMove);
    canvas.removeEventListener('pointerup', onPointerUp);
    canvas.removeEventListener('pointercancel', onPointerUp);
    try {
      if (controls.isLocked) {
        leaving = true;
        controls.unlock();
      }
    } catch {
      /* ignore */
    }
    leaving = false;
  }

  function update(dt) {
    if (!active) return false;
    if (suspended) {
      // wait for the wheel to close; give it a frame to appear first
      if (!wheelOpen() && ++suspendedFrames > 2) {
        suspendedFrames = 0;
        resumeAfterWheel();
      }
      return true;
    }
    if (!startEl.hidden && document.pointerLockElement === canvas) startEl.hidden = true;
    dt = Math.min(dt, 0.1);
    let fwd = (pressed(KEYS.forward) ? 1 : 0) - (pressed(KEYS.back) ? 1 : 0);
    let str = (pressed(KEYS.right) ? 1 : 0) - (pressed(KEYS.left) ? 1 : 0);
    fwd += -joy.y;
    str += joy.x;
    const mag = Math.hypot(fwd, str);
    if (mag > 1) {
      fwd /= mag;
      str /= mag;
    }
    const speed = held.has('Shift') || held.has('ShiftLeft') || held.has('ShiftRight') ? WALK.run : WALK.speed;
    let moved = false;
    const before = { x: camera.position.x, z: camera.position.z };
    if (mag > 0.01) {
      const e = new THREE.Euler().setFromQuaternion(camera.quaternion, 'YXZ');
      const fx = -Math.sin(e.y);
      const fz = -Math.cos(e.y);
      const rx = Math.cos(e.y);
      const rz = -Math.sin(e.y);
      const step = speed * dt;
      const nx = camera.position.x + (fx * fwd + rx * str) * step;
      const nz = camera.position.z + (fz * fwd + rz * str) * step;
      const fixed = resolveCollisions({ x: nx, z: nz }, colliders);
      camera.position.x = fixed.x;
      camera.position.z = fixed.z;
      moved = true;
    }
    if (doors && doors.version !== doorVersion) refreshColliders();
    updateStair(before);
    if (glide) {
      glide.t = Math.min(1, glide.t + dt / LEVEL_MOVE_S);
      const k = glide.t * glide.t * (3 - 2 * glide.t);
      eyeY = glide.from + (glide.to - glide.from) * k;
      camera.position.y = eyeY;
      if (glide.t >= 1) glide = null;
      moved = true;
    } else if (onStair) {
      camera.position.y = eyeTarget; // the eye is on the surface of the stair
    } else {
      camera.position.y = eyeTarget;
    }
    updateTarget();
    return moved || held.size > 0 || controls.isLocked;
  }

  function dispose() {
    exit();
    document.removeEventListener('pointerlockerror', onLockError);
    controls.dispose();
    hud.remove();
  }

  return {
    enter,
    exit,
    update,
    dispose,
    refresh() {
      if (active) {
        onStair = null;
        refreshColliders();
        updateHud();
      }
    },
    get active() {
      return active;
    },
    get levelId() {
      return levelId;
    },
    get locked() {
      return controls.isLocked;
    },
    get suspended() {
      return suspended;
    },
    get yaw() {
      return yawNow();
    },
    setHooks(h) {
      hooks = h || {};
    },
    setItems(api) {
      items = api || null;
    },
    goToLevel,
    openWheel,
    // test hooks
    _state: () => ({ x: camera.position.x, y: camera.position.y, z: camera.position.z, levelId }),
    _press: (code, on = true) => (on ? held.add(code) : held.delete(code)),
    _changeLevel: changeLevel,
    _glide: () => (glide ? { ...glide } : null),
    _resume: resumeAfterWheel,
    _doorTarget: () => doorTarget,
    _target: () => (target ? { type: target.type, id: target.id || target.info?.stair.id || target.opening?.id } : null),
    _onStair: () => (onStair ? { id: onStair.info.stair.id, v: onStair.v, h: onStair.h } : null),
    _useTarget: useTarget,
    _takeStair: (id) => takeStair(stairs.find((i) => i.stair.id === id)),
    _look: (yaw, pitch = 0) => camera.quaternion.setFromEuler(new THREE.Euler(pitch, yaw, 0, 'YXZ')),
    _teleport: (x, z, yaw) => {
      camera.position.x = x;
      camera.position.z = z;
      if (yaw != null) camera.quaternion.setFromEuler(new THREE.Euler(0, yaw, 0, 'YXZ'));
      onStair = null;
    },
    _useDoor: useDoor,
    _prompt: () => (promptEl.hidden ? null : promptText.textContent),
    _yaw: yawNow,
  };
}
