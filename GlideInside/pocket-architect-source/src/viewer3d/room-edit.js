// Room edit mode for the 3D viewer: pick a room and the building explodes out in a short cinematic (the camera pulls back and tilts,
// the roof lifts, the floors separate, the rooms slide outward, the others fade and lock) and the camera flies in to that room.
// Only that room can then be edited: size, walls, doors and windows, fixtures, finish, name. Done (or Esc) collapses the building
// back with the edits applied.
//
// This file is the thin three.js and DOM layer. The maths is in explode-logic.js (staged progress, offsets, poses) and the
// locking and shared wall rules are in room-edit-logic.js, both pure and unit tested.
//
// Wiring: createViewer3D (viewer.js) calls createRoomEdit(api, { guard }) and exposes it as viewer.roomEdit:
//   viewer.roomEdit.start(roomId)    explode and edit that room        .done()      collapse and leave
//   .explode() .collapse() .replay() .reset()   the animation buttons   .arm()       wait for a click on a room
//   .setLabels(bool)                 room labels                        .active / .busy / .roomId / .progress
//
// EXPORT HOOK (not built yet): a short clip of the explode animation. Drive it with  roomEdit.renderAt(p)  for p = 0..1
// (it applies the stage and the camera for that progress without any timing) and read frames from viewer.canvas.

import * as THREE from 'three';
import { exitCutaway, cancelFlight } from './rooms.js';
import { collectUnits, applyUnits, restoreUnits } from './explode-apply.js';
import {
  phases, stepProgress, explodeTargets, offsetFor, cinematicPoses, cameraAt, lerp3, smooth, findRoom,
} from './explode-logic.js';
import {
  roomScope, canTouchHit, describeRoom, planResize, planSetSize, planWallMove, suggestOpening, roomAtPlanPoint, SIDES, softMinSide,
} from './room-edit-logic.js';
import { ROOM_TYPES, ROOM_LABELS } from '../model/schema.js';
import { formatLength } from '../model/geometry.js';

const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
// The camera aims at the part of the screen the panel leaves clear: a right hand panel on a wide viewer, a bottom sheet on a narrow one.
function clearInsets(rootEl, panel) {
  const rr = rootEl.getBoundingClientRect();
  if (panel.hidden || rr.width < 2) return { left: 0, right: 0, top: 0, bottom: 0 };
  const pr = panel.getBoundingClientRect();
  const sheet = pr.width > rr.width * 0.7;
  return sheet ? { left: 0, right: 0, top: 0, bottom: Math.round(Math.min(rr.bottom - pr.top, rr.height * 0.7) + 8) } : { left: 0, right: Math.round(rr.right - pr.left + 8), top: 0, bottom: 0 };
}
const NUDGE = 100; // mm per press of a side button
const SIDE_LABEL = { north: 'North', south: 'South', east: 'East', west: 'West' };
const KIND_LABEL = { window: 'Window', door: 'Door', sliding_door: 'Sliding door', garage_door: 'Garage door', roller_door: 'Roller door', opening: 'Opening' };
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function createRoomEdit(viewer, { guard = null, catalogue = null } = {}) {
  const { store, rootEl, canvas, camera, controls } = viewer;
  const st = {
    phase: 'off', // 'off' | 'armed' | 'active'
    roomId: null,
    p: 0,
    target: 0,
    labels: true,
    raf: 0,
    last: 0,
    units: [],
    poses: null,
    targets: null,
    camFree: false, // the person took the camera: the cinematic stops driving it
    blendFrom: null,
    blendT: 0,
    saved: null, // camera and ui before the mode
    savedInset: null,
    open: false, // compact (phone) layout: the tools are folded away until asked for
    scope: null,
  };
  let toastTimer = 0;
  const listeners = new Set();
  const emit = () => { for (const fn of listeners) { try { fn(api); } catch { /* listener */ } } };

  // DOM ---------------------------------------------------------------------------------------------------
  const armBtn = document.createElement('button');
  armBtn.type = 'button';
  armBtn.className = 'ps3d-edit ps3d-redit-arm';
  armBtn.dataset.ps = 'room-edit-arm';
  armBtn.setAttribute('aria-pressed', 'false');
  armBtn.title = 'Pick one room to edit. The building opens up and the other rooms lock.';
  armBtn.innerHTML = '<span class="ps3d-edit-label">Edit room</span>';
  const editBar = rootEl.querySelector('.ps3d-editbar');
  if (editBar) editBar.insertBefore(armBtn, editBar.querySelector('.ps3d-edit'));
  else rootEl.appendChild(armBtn);

  const toast = document.createElement('div');
  toast.className = 'ps3d-toast ps3d-redit-toast';
  toast.setAttribute('role', 'status');
  toast.hidden = true;
  rootEl.appendChild(toast);

  const labelsEl = document.createElement('div');
  labelsEl.className = 'ps3d-rlabels';
  labelsEl.hidden = true;
  rootEl.appendChild(labelsEl);

  const panel = document.createElement('aside');
  panel.className = 'ps3d-redit';
  panel.dataset.ps = 'room-edit-panel';
  panel.setAttribute('aria-label', 'Edit room');
  panel.hidden = true;
  rootEl.appendChild(panel);
  panel.addEventListener('pointerdown', (e) => e.stopPropagation());
  panel.addEventListener('keydown', (e) => { if (e.key !== 'Escape') e.stopPropagation(); });

  function say(text, { error = false, ms = 5000 } = {}) {
    clearTimeout(toastTimer);
    toast.textContent = text || '';
    toast.hidden = !text;
    toast.classList.toggle('is-error', !!error);
    if (text && ms) toastTimer = setTimeout(() => { toast.hidden = true; }, ms);
  }

  // Binding to the model -----------------------------------------------------------------------------------
  function unbind() {
    restoreUnits(st.units);
    st.units = [];
  }
  function bind() {
    unbind();
    const model = viewer.getModel();
    if (!model) return;
    st.units = collectUnits(model, store.project, st.roomId);
  }

  function apply() {
    st.stage = applyUnits(st.units, st.targets, st.roomId, st.p);
    const ph = st.stage;
    if (!st.camFree && st.poses) {
      const pose = cameraAt(ph, st.poses);
      let pos = pose.position;
      let tgt = pose.target;
      if (st.blendFrom && st.blendT < 1) {
        const k = smooth(st.blendT);
        pos = lerp3(st.blendFrom.position, pos, k);
        tgt = lerp3(st.blendFrom.target, tgt, k);
      }
      camera.position.set(pos.x, pos.y, pos.z);
      controls.target.set(tgt.x, tgt.y, tgt.z);
      controls.update();
    }
    syncLabels();
    viewer.invalidate();
  }
  // The same, for a progress of your choice with no timing: used by tests and by a future clip export.
  function renderAt(p) {
    st.p = Math.max(0, Math.min(1, p));
    st.camFree = false;
    st.blendFrom = null;
    apply();
  }

  // Animation loop -----------------------------------------------------------------------------------------
  function tick() {
    st.raf = 0;
    const t = now();
    const dt = Math.min(0.25, (t - st.last) / 1000); // real time, so a slow device still takes the same seconds
    st.last = t;
    st.blendT = Math.min(1, st.blendT + dt / 0.6);
    st.p = stepProgress(st.p, st.target, dt, { reduced: reducedMotion() });
    apply();
    if (st.p === st.target) {
      st.blendFrom = null;
      settled();
      return;
    }
    st.raf = requestAnimationFrame(tick);
  }
  function run(target) {
    st.target = target;
    st.last = now();
    // A camera the person moved is blended back into the cinematic instead of snapping.
    if (st.camFree) {
      st.blendFrom = { position: { x: camera.position.x, y: camera.position.y, z: camera.position.z }, target: { x: controls.target.x, y: controls.target.y, z: controls.target.z } };
      st.blendT = 0;
      st.camFree = false;
    }
    if (reducedMotion()) {
      st.p = target;
      st.blendFrom = null;
      apply();
      settled();
      return;
    }
    if (!st.raf) st.raf = requestAnimationFrame(tick);
    emit();
    syncPanel();
  }
  function settled() {
    if (st.phase === 'leaving' && st.p === 0) finishLeaving();
    emit();
    syncPanel();
  }
  const takeCamera = () => { if (st.phase === 'active' && st.p !== st.target) st.camFree = true; };
  for (const ev of ['pointerdown', 'wheel', 'touchstart']) canvas.addEventListener(ev, takeCamera, { passive: true });

  // Labels -------------------------------------------------------------------------------------------------
  function syncLabels() {
    if (st.phase === 'off' || st.phase === 'armed') { labelsEl.hidden = true; return; }
    labelsEl.hidden = !st.labels;
    if (!st.labels) return;
    const project = store.project;
    const w = rootEl.clientWidth;
    const h = rootEl.clientHeight;
    const ph = st.stage || phases(st.p);
    const v = new THREE.Vector3();
    let i = 0;
    const kids = labelsEl.children;
    for (const l of project.levels) {
      for (const r of l.rooms) {
        if (!r.polygon || r.polygon.length < 3 || r.status === 'demolish') continue;
        const off = offsetFor(st.targets, { role: 'room', roomId: r.id, levelId: l.id }, ph);
        const c = polyCentre(r.polygon);
        v.set(c.x / 1000 + off.x, l.elevation / 1000 + off.y + 0.15, c.y / 1000 + off.z).project(camera);
        let el = kids[i];
        if (!el) { el = document.createElement('div'); labelsEl.appendChild(el); }
        i++;
        const sel = r.id === st.roomId;
        const visible = v.z < 1 && v.z > -1 && Math.abs(v.x) < 1.05 && Math.abs(v.y) < 1.05;
        el.hidden = !visible;
        if (!visible) continue;
        const text = r.name || ROOM_LABELS[r.type] || 'Room';
        if (el.dataset.t !== text + sel) {
          el.dataset.t = text + sel;
          el.textContent = text;
          el.className = `ps3d-rlabel${sel ? ' is-sel' : ''}`;
        }
        el.style.transform = `translate(-50%,-50%) translate(${Math.round(((v.x + 1) / 2) * w)}px,${Math.round(((1 - v.y) / 2) * h)}px)`;
        el.style.opacity = sel ? '1' : String(1 - ph.fade * 0.45);
      }
    }
    for (let j = kids.length - 1; j >= i; j--) kids[j].remove();
  }
  const polyCentre = (poly) => {
    let x = 0; let y = 0;
    for (const q of poly) { x += q.x; y += q.y; }
    return { x: x / poly.length, y: y / poly.length };
  };

  // Guard for edit.js: only the room in front of you can be touched, and only once the animation has settled ---------
  const impl = {
    canTouch(hit) {
      if (st.phase !== 'active' || st.p !== st.target) return false;
      return canTouchHit(st.scope, hit);
    },
    onLocked(hit) {
      if (st.phase !== 'active' || !hit || hit.ground) return;
      if (st.p !== st.target) return;
      const name = findRoom(store.project, st.roomId)?.room.name || 'this room';
      say(`That is locked while you edit ${name}. Press Done to pick another room.`, { ms: 3500 });
    },
    lift: (levelId) => (st.phase === 'off' || !st.targets ? 0 : (st.targets.levels.get(levelId)?.y || 0) * (st.stage || phases(st.p)).levels),
    checkWallMove(id, dx, dy) {
      const plan = planWallMove(store.project, st.roomId, id, dx, dy);
      if (!plan.ok) return { ok: false, error: plan.error };
      const bits = [...plan.warnings];
      if (plan.neighbours.length) bits.unshift(`Also resizes ${plan.neighbours.map((n) => n.name).join(', ')}.`);
      return { ok: true, warnings: bits };
    },
    checkItemMove(kind, id, pos) {
      const f = findRoom(store.project, st.roomId);
      if (!f || !pos) return { ok: true };
      const inside = pointIn(pos, f.room.polygon);
      return inside ? { ok: true } : { ok: false, error: 'Keep it inside the room. The other rooms are locked.' };
    },
  };
  function pointIn(p, poly) {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const a = poly[i]; const b = poly[j];
      if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
    }
    return inside;
  }
  if (guard) guard.impl = impl;

  function aspectNow() {
    const ins = viewer.getInset?.() || { left: 0, right: 0, top: 0, bottom: 0 };
    const w = Math.max(1, rootEl.clientWidth - ins.left - ins.right);
    const h = Math.max(1, rootEl.clientHeight - ins.top - ins.bottom);
    return w / h || camera.aspect || 1.6;
  }
  const makePoses = () => cinematicPoses(store.project, st.roomId, st.saved, { fov: camera.fov, aspect: aspectNow() });

  // Starting, finishing ------------------------------------------------------------------------------------
  function canStart() {
    return viewer.mode === 'orbit' && !!viewer.getModel() && (store.ui.view === '3d' || store.ui.view === 'split');
  }
  function start(roomId, { instant = false } = {}) {
    if (!canStart()) return false;
    const found = findRoom(store.project, roomId);
    if (!found || found.room.status === 'demolish' || !found.room.polygon || found.room.polygon.length < 3) return false;
    if (st.phase === 'active' || st.phase === 'leaving') {
      if (roomId === st.roomId) return true;
      // Switch rooms: collapse at once, then explode the new one.
      cancelAnimationFrame(st.raf);
      st.raf = 0;
      unbind();
      st.p = 0;
      st.target = 0;
    }
    exitCutaway(viewer);
    cancelFlight(viewer);
    viewer.clearRoomTurntable?.();
    viewer.stopAnim?.();
    const firstEntry = st.phase !== 'active';
    if (firstEntry) {
      st.saved = {
        position: { x: camera.position.x, y: camera.position.y, z: camera.position.z },
        target: { x: controls.target.x, y: controls.target.y, z: controls.target.z },
        fov: camera.fov,
      };
    }
    st.phase = 'active';
    st.roomId = roomId;
    st.scope = roomScope(store.project, roomId);
    st.targets = explodeTargets(store.project, { selectedId: roomId });
    st.camFree = false;
    st.blendFrom = null;
    armBtn.setAttribute('aria-pressed', 'true');
    armBtn.classList.add('is-on');
    store.select(roomId);
    bind();
    viewer.edit.setEnabled(true);
    viewer.edit.setToolsAllowed(['select', 'window', 'door']);
    controls.minDistance = 0.8;
    panel.hidden = false;
    rootEl.classList.add('is-redit');
    st.open = false;
    buildPanel();
    if (firstEntry) st.savedInset = viewer.getInset?.() || null;
    viewer.setInset?.(clearInsets(rootEl, panel), { reframe: false });
    st.poses = makePoses();
    say('');
    st.p = 0;
    apply();
    run(1);
    if (instant) { st.p = 1; apply(); settled(); }
    return true;
  }
  function arm() {
    if (st.phase === 'active') return;
    if (!canStart()) return;
    st.phase = st.phase === 'armed' ? 'off' : 'armed';
    armBtn.setAttribute('aria-pressed', String(st.phase === 'armed'));
    armBtn.classList.toggle('is-on', st.phase === 'armed');
    if (st.phase === 'armed') {
      // A room already selected (from the plan or the panel) starts at once.
      const sel = store.ui.selection ? store.find(store.ui.selection) : null;
      const rid = sel?.kind === 'room' ? sel.item.id : sel ? roomAtItem(sel) : null;
      if (rid && start(rid)) return;
      say('Tap a room to edit it. Esc cancels.', { ms: 6000 });
    } else say('');
    emit();
  }
  function roomAtItem(found) {
    const it = found.item;
    if (found.kind === 'furniture' || found.kind === 'stair') return roomAtPlanPoint(store.project, it.x, it.y, found.level?.id)?.room.id || null;
    return null;
  }
  function done({ instant = false } = {}) {
    if (st.phase === 'armed') { arm(); return; }
    if (st.phase !== 'active') return;
    st.phase = 'leaving';
    viewer.edit.cancel?.();
    viewer.edit.setEnabled(false);
    viewer.edit.setToolsAllowed(null);
    panel.hidden = true;
    st.camFree = false;
    if (instant || reducedMotion()) {
      st.p = 0;
      apply();
      finishLeaving();
      return;
    }
    run(0);
  }
  function finishLeaving() {
    cancelAnimationFrame(st.raf);
    st.raf = 0;
    unbind();
    if (st.saved) {
      camera.position.set(st.saved.position.x, st.saved.position.y, st.saved.position.z);
      controls.target.set(st.saved.target.x, st.saved.target.y, st.saved.target.z);
      controls.update();
    }
    st.phase = 'off';
    st.roomId = null;
    st.scope = null;
    st.stage = null;
    st.poses = null;
    st.p = 0;
    st.target = 0;
    armBtn.setAttribute('aria-pressed', 'false');
    armBtn.classList.remove('is-on');
    rootEl.classList.remove('is-redit');
    labelsEl.hidden = true;
    controls.minDistance = 1.2;
    if (st.savedInset) viewer.setInset?.(st.savedInset, { reframe: false });
    st.savedInset = null;
    store.select(null);
    viewer.invalidate();
    emit();
  }
  const isActive = () => st.phase === 'active' || st.phase === 'leaving';

  // The animation buttons
  const explode = () => { if (st.phase === 'active') run(1); };
  const collapse = () => { if (st.phase === 'active') run(0); };
  const replay = () => {
    if (st.phase !== 'active') return;
    st.camFree = false;
    st.blendFrom = null;
    st.p = 0;
    apply();
    run(1);
  };
  const reset = () => {
    if (st.phase !== 'active') return;
    cancelAnimationFrame(st.raf);
    st.raf = 0;
    st.camFree = false;
    st.blendFrom = null;
    st.p = 1;
    st.target = 1;
    st.poses = makePoses();
    apply();
    settled();
  };
  function setLabels(on) {
    st.labels = !!on;
    syncLabels();
    syncPanel();
  }

  // The room a 3D pick belongs to. A floor is its room; furniture is in the room it stands in; a wall, opening or roof is judged a little
  // towards the camera so a click on a wall between two rooms picks the room that is facing you.
  function roomForHit(hit) {
    const project = store.project;
    if (hit.kind === 'floor' && findRoom(project, hit.id)) return hit.id;
    if (hit.kind === 'furniture' || hit.kind === 'stair') {
      const f = store.find(hit.id);
      const r = f ? roomAtPlanPoint(project, f.item.x, f.item.y, f.level?.id)?.room.id : null;
      if (r) return r;
    }
    const px = hit.point.x * 1000;
    const pz = hit.point.z * 1000;
    const dx = camera.position.x * 1000 - px;
    const dz = camera.position.z * 1000 - pz;
    const d = Math.hypot(dx, dz) || 1;
    const nudge = hit.kind === 'wall' || hit.kind === 'opening' ? 250 : 0;
    const found = roomAtPlanPoint(project, px + (dx / d) * nudge, pz + (dz / d) * nudge, hit.levelId || null) || roomAtPlanPoint(project, px, pz, hit.levelId || null);
    return found ? found.room.id : null;
  }

  // Picking a room while armed ------------------------------------------------------------------------------
  let down = null;
  canvas.addEventListener('pointerdown', (e) => { down = st.phase === 'armed' ? { x: e.clientX, y: e.clientY, t: now() } : null; }, true);
  canvas.addEventListener('pointerup', (e) => {
    const d = down;
    down = null;
    if (!d || st.phase !== 'armed') return;
    if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 6 || now() - d.t > 700) return;
    const hit = viewer.pickAt(e.clientX, e.clientY);
    if (!hit || hit.ground || !hit.point) { say('Tap inside a room.', { ms: 2500 }); return; }
    const rid = roomForHit(hit);
    if (rid) start(rid);
    else say('Tap inside a room.', { ms: 2500 });
  });
  armBtn.addEventListener('click', () => { if (st.phase === 'active') done(); else arm(); });

  // Esc is Done (or cancels picking). Captured early so the cutaway and the edit tools do not also answer.
  function onKey(e) {
    if (e.code !== 'Escape' || (st.phase !== 'active' && st.phase !== 'armed')) return;
    const t = e.target;
    if (t && t.tagName === 'INPUT') { t.blur(); e.preventDefault(); e.stopImmediatePropagation(); return; }
    if (st.phase === 'active' && viewer.edit.tool !== 'select') return; // the edit tools use Esc to drop the tool first
    e.preventDefault();
    e.stopImmediatePropagation();
    done();
  }
  window.addEventListener('keydown', onKey, true);
  let resizeTimer = 0;
  const onResize = () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(() => { if (st.phase === 'active') relayout(); }, 120); };
  window.addEventListener('resize', onResize);

  // Project and view changes -----------------------------------------------------------------------------------
  let panelTimer = 0;
  const offProject = store.on('project', () => {
    if (st.phase !== 'active') return;
    const f = findRoom(store.project, st.roomId);
    if (!f) { done({ instant: true }); return; }
    st.scope = roomScope(store.project, st.roomId);
    st.targets = explodeTargets(store.project, { selectedId: st.roomId });
    st.poses = makePoses();
    cancelAnimationFrame(panelTimer);
    panelTimer = requestAnimationFrame(buildPanel);
  });
  const offUI = store.on('ui', (patch) => {
    if (!patch || !('view' in patch) || st.phase === 'off') return;
    if (patch.view !== '3d' && patch.view !== 'split') hardStop();
  });
  function hardStop() {
    if (st.phase === 'armed') { arm(); return; }
    if (st.phase === 'active' || st.phase === 'leaving') { st.phase = 'active'; done({ instant: true }); }
  }
  // The viewer rebuilt the model (an edit, a finish change): bind the new meshes and keep the stage.
  function onBeforeRebuild() {
    if (st.units.length) unbind();
  }
  function onRebuild() {
    if (st.phase !== 'active' && st.phase !== 'leaving') return;
    bind();
    apply();
  }
  // Edit was switched off with the B key while editing a room: keep it on, the lock depends on it.
  function onEditToggled(on) {
    if (!on && st.phase === 'active') setTimeout(() => { if (st.phase === 'active') { viewer.edit.setEnabled(true); viewer.edit.setToolsAllowed(['select', 'window', 'door']); } }, 0);
  }

  // Panel ----------------------------------------------------------------------------------------------------
  const finishes = catalogue?.finishes;
  function furnitureOptions() {
    const list = catalogue?.FURNITURE || [];
    const cats = [...new Set(list.map((f) => f.category))];
    return cats.map((c) => `<optgroup label="${esc(c)}">${list.filter((f) => f.category === c).map((f) => `<option value="${esc(f.id)}">${esc(f.name)}</option>`).join('')}</optgroup>`).join('');
  }
  const nameOfItem = (id) => { try { return catalogue?.getFurniture?.(id)?.name || id; } catch { return id; } };
  let furnOpts = null;

  function buildPanel() {
    if (st.phase !== 'active') return;
    const d = describeRoom(store.project, st.roomId);
    if (!d) return;
    const typed = panel.querySelector('input:focus, select:focus');
    if (typed && panel.dataset.room === st.roomId) { panel.querySelector('.ps3d-redit-info') && updateInfo(d); return; }
    panel.dataset.room = st.roomId;
    furnOpts = furnOpts ?? furnitureOptions();
    const mats = (finishes?.materialsFor?.('floors') || []).map((m) => ({ id: m.id ?? m, name: m.name ?? m }));
    const curMat = d.floor?.material || '';
    const colours = curMat ? (finishes?.coloursFor?.(curMat) || []) : [];
    panel.innerHTML = `
      <header class="ps3d-redit-head">
        <div class="ps3d-redit-title"><span class="ps3d-redit-eyebrow">Editing room</span><strong class="ps3d-redit-name">${esc(d.name)}</strong></div>
        <button type="button" class="ps3d-itembtn ps3d-redit-more" data-act="more" aria-expanded="${st.open}" title="Show or hide the room tools">Tools</button>
        <button type="button" class="ps3d-btn is-primary ps3d-redit-done" data-act="done" title="Collapse the building with your edits (Esc)">Done <kbd class="ps3d-key">Esc</kbd></button>
      </header>
      <div class="ps3d-redit-body">
        <div class="ps3d-redit-anim" role="group" aria-label="Animation">
          <button type="button" class="ps3d-itembtn" data-act="explode" title="Open the building up">Explode</button>
          <button type="button" class="ps3d-itembtn" data-act="collapse" title="Close the building back up">Collapse</button>
          <button type="button" class="ps3d-itembtn" data-act="replay" title="Play the animation again">Replay</button>
          <button type="button" class="ps3d-itembtn" data-act="reset" title="Back to the exploded view of this room">Reset view</button>
          <button type="button" class="ps3d-itembtn" data-act="labels" aria-pressed="${st.labels}" title="Show or hide room names">Labels</button>
          <button type="button" class="ps3d-itembtn" data-act="undo" title="Undo (Ctrl Z)">Undo</button>
          <button type="button" class="ps3d-itembtn" data-act="redo" title="Redo">Redo</button>
        </div>
        <p class="ps3d-redit-info" role="status"></p>
        <section class="ps3d-redit-sec"><h3>Room</h3>
          <label class="ps3d-redit-f"><span>Name</span><input type="text" class="ps3d-redit-in" data-f="name" maxlength="60" value="${esc(d.name)}"></label>
          <label class="ps3d-redit-f"><span>Type</span><select class="ps3d-redit-in" data-f="type">${ROOM_TYPES.map((t) => `<option value="${t}"${t === d.type ? ' selected' : ''}>${esc(ROOM_LABELS[t])}</option>`).join('')}</select></label>
        </section>
        <section class="ps3d-redit-sec"><h3>Size</h3>
          <div class="ps3d-redit-size">
            <label class="ps3d-redit-f"><span>Width mm</span><input type="number" class="ps3d-redit-in" data-f="width" inputmode="numeric" step="50" min="500" value="${d.w}"></label>
            <label class="ps3d-redit-f"><span>Depth mm</span><input type="number" class="ps3d-redit-in" data-f="depth" inputmode="numeric" step="50" min="500" value="${d.d}"></label>
          </div>
          <div class="ps3d-redit-sides" role="group" aria-label="Move a wall">
            ${SIDES.map((s) => `<div class="ps3d-redit-side"><span>${SIDE_LABEL[s]} wall</span><button type="button" class="ps3d-itembtn" data-act="nudge" data-side="${s}" data-dir="-1" aria-label="${SIDE_LABEL[s]} wall in ${NUDGE} millimetres">In</button><button type="button" class="ps3d-itembtn" data-act="nudge" data-side="${s}" data-dir="1" aria-label="${SIDE_LABEL[s]} wall out ${NUDGE} millimetres">Out</button></div>`).join('')}
          </div>
          <p class="ps3d-redit-note">${d.neighbours.length ? `Shares walls with ${esc(d.neighbours.map((n) => n.name).join(', '))}. Moving a shared wall resizes them too.` : 'No other room shares a wall with this one.'}</p>
        </section>
        <section class="ps3d-redit-sec"><h3>Doors and windows</h3>
          <ul class="ps3d-redit-list">${d.openings.length ? d.openings.map((o) => `<li><span>${esc(KIND_LABEL[o.kind] || o.kind)} ${formatLength(o.width)}${o.side ? ` · ${SIDE_LABEL[o.side]}` : ''}</span><button type="button" class="ps3d-itembtn is-danger" data-act="del" data-id="${esc(o.id)}" aria-label="Delete this ${esc(KIND_LABEL[o.kind] || o.kind)}">Delete</button></li>`).join('') : '<li class="is-empty">None yet</li>'}</ul>
          <div class="ps3d-redit-row"><button type="button" class="ps3d-itembtn" data-act="add-open" data-kind="door">Add door</button><button type="button" class="ps3d-itembtn" data-act="add-open" data-kind="window">Add window</button></div>
          <p class="ps3d-redit-note">Or use the Door and Window tools and tap a wall of this room.</p>
        </section>
        <section class="ps3d-redit-sec"><h3>Fixtures</h3>
          <ul class="ps3d-redit-list">${d.fixtures.length ? d.fixtures.map((f) => `<li><span>${esc(nameOfItem(f.item))}</span><span class="ps3d-redit-btns"><button type="button" class="ps3d-itembtn" data-act="rot" data-id="${esc(f.id)}" aria-label="Rotate ${esc(nameOfItem(f.item))}">Rotate</button><button type="button" class="ps3d-itembtn is-danger" data-act="del" data-id="${esc(f.id)}" aria-label="Delete ${esc(nameOfItem(f.item))}">Delete</button></span></li>`).join('') : '<li class="is-empty">Empty room</li>'}</ul>
          ${furnOpts ? `<div class="ps3d-redit-row"><select class="ps3d-redit-in" data-f="furn" aria-label="Fixture to add">${furnOpts}</select><button type="button" class="ps3d-itembtn" data-act="add-furn">Add</button></div>` : ''}
          <p class="ps3d-redit-note">Drag a fixture in the 3D view to move it.</p>
        </section>
        ${mats.length ? `<section class="ps3d-redit-sec"><h3>Floor finish</h3>
          <label class="ps3d-redit-f"><span>Material</span><select class="ps3d-redit-in" data-f="floor_material"><option value="">House default</option>${mats.map((m) => `<option value="${esc(m.id)}"${m.id === curMat ? ' selected' : ''}>${esc(m.name)}</option>`).join('')}</select></label>
          ${colours.length ? `<label class="ps3d-redit-f"><span>Colour</span><select class="ps3d-redit-in" data-f="floor_colour">${colours.map((c) => `<option value="${esc(c.id)}"${c.id === d.floor?.colour ? ' selected' : ''}>${esc(c.name || c.id)}</option>`).join('')}</select></label>` : ''}
        </section>` : ''}
      </div>`;
    updateInfo(d);
    syncCompact();
    syncPanel();
  }
  // On a short, narrow viewer (a phone) the panel is a one line bar with a Tools button, so the room stays visible.
  const compactNow = () => rootEl.clientWidth <= 720 && rootEl.clientHeight < 620;
  function syncCompact() {
    const c = compactNow();
    panel.classList.toggle('is-compact', c);
    panel.classList.toggle('is-open', c && st.open);
    const more = panel.querySelector('[data-act="more"]');
    if (more) more.setAttribute('aria-expanded', String(c && st.open));
  }
  function relayout() {
    syncCompact();
    viewer.setInset?.(clearInsets(rootEl, panel), { reframe: false });
    st.poses = makePoses();
    if (st.phase === 'active' && st.p === st.target && !st.camFree) apply();
  }
  function updateInfo(d) {
    const el = panel.querySelector('.ps3d-redit-info');
    if (!el) return;
    el.textContent = `${(d.w / 1000).toFixed(2)} x ${(d.d / 1000).toFixed(2)} m, ${(d.area / 1e6).toFixed(1)} m2`;
  }
  function syncPanel() {
    const labelsBtn = panel.querySelector('[data-act="labels"]');
    if (labelsBtn) labelsBtn.setAttribute('aria-pressed', String(st.labels));
    const busy = st.p !== st.target;
    for (const b of panel.querySelectorAll('[data-act="explode"],[data-act="collapse"]')) b.disabled = (b.dataset.act === 'explode' ? st.target === 1 : st.target === 0) && !busy;
    panel.classList.toggle('is-moving', busy);
  }

  function report(plan, applied) {
    if (!plan.ok) { say(plan.error || 'That change is not possible.', { error: true }); return false; }
    const bits = [];
    if (plan.neighbours?.length) bits.push(`Also resized ${plan.neighbours.map((n) => n.name).join(', ')}.`);
    bits.push(...(plan.warnings || []));
    if (bits.length) say(bits.join(' '), { ms: 7000, error: false });
    else if (applied) say('');
    return true;
  }
  function doResize(side, delta) {
    const plan = planResize(store.project, st.roomId, side, delta);
    if (!report(plan, false)) return false;
    try { store.run(plan.op.name, plan.op.args); return true; } catch (e) { say(e.message, { error: true }); return false; }
  }
  function doSetSize(width, depth) {
    const plan = planSetSize(store.project, st.roomId, { width, depth });
    if (!report(plan, false)) return false;
    try {
      store.runBatch('Resize room', (plan.steps || []).map((s) => ({ op: 'resize_room', args: { id: st.roomId, ...s } })));
      return true;
    } catch (e) { say(e.message, { error: true }); return false; }
  }

  panel.addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]');
    if (!b || b.disabled) return;
    const act = b.dataset.act;
    try {
      if (act === 'done') done();
      else if (act === 'more') { st.open = !st.open; relayout(); }
      else if (act === 'explode') explode();
      else if (act === 'collapse') collapse();
      else if (act === 'replay') replay();
      else if (act === 'reset') reset();
      else if (act === 'labels') setLabels(!st.labels);
      else if (act === 'undo') { if (!store.undo()) say('Nothing to undo.', { ms: 1800 }); }
      else if (act === 'redo') { if (!store.redo()) say('Nothing to redo.', { ms: 1800 }); }
      else if (act === 'nudge') doResize(b.dataset.side, Number(b.dataset.dir) * NUDGE);
      else if (act === 'del') {
        const id = b.dataset.id;
        const f = store.find(id);
        if (f && canTouchHit(st.scope, { kind: f.kind, id })) store.run('delete', { id });
      } else if (act === 'rot') {
        const f = store.find(b.dataset.id);
        if (f && canTouchHit(st.scope, { kind: 'furniture', id: f.item.id })) store.run('update_furniture', { id: f.item.id, rotation: (((f.item.rotation || 0) + 90) % 360) });
      } else if (act === 'add-open') {
        const sug = suggestOpening(store.project, st.roomId, b.dataset.kind);
        if (!sug) say(`No room on the walls for a ${b.dataset.kind}.`, { error: true });
        else store.run('add_opening', { level: st.scope.level.id, wall: sug.wallId, kind: b.dataset.kind, offset: sug.offset });
      } else if (act === 'add-furn') {
        const item = panel.querySelector('[data-f="furn"]')?.value;
        if (item) store.run('add_furniture', { level: st.scope.level.id, item, room: st.roomId });
      }
    } catch (err) {
      say(err.message || 'That could not be done.', { error: true });
    }
  });
  panel.addEventListener('change', (e) => {
    const f = e.target.dataset?.f;
    if (!f) return;
    const v = e.target.value;
    try {
      if (f === 'name') store.run('update_room', { id: st.roomId, name: v.trim() || ROOM_LABELS[describeRoom(store.project, st.roomId).type] });
      else if (f === 'type') store.run('update_room', { id: st.roomId, type: v });
      else if (f === 'width' || f === 'depth') {
        const w = panel.querySelector('[data-f="width"]').value;
        const dd = panel.querySelector('[data-f="depth"]').value;
        if (!doSetSize(Number(w), Number(dd))) { panel.dataset.room = ''; buildPanel(); }
      } else if (f === 'floor_material') {
        if (!v) store.apply('Clear floor finish', (p) => { const r = findRoom(p, st.roomId); if (r) r.room.floor = null; });
        else store.run('update_room', { id: st.roomId, floor_material: v, floor_colour: finishes?.defaultColour?.(v) || undefined });
      } else if (f === 'floor_colour') store.run('update_room', { id: st.roomId, floor_colour: v });
    } catch (err) {
      say(err.message || 'That could not be changed.', { error: true });
      panel.dataset.room = '';
      buildPanel();
    }
  });
  panel.addEventListener('input', (e) => { if (e.target.dataset?.f === 'name') { const n = panel.querySelector('.ps3d-redit-name'); if (n) n.textContent = e.target.value; } });

  const api = {
    start, arm, done, roomForHit, explode, collapse, replay, reset, setLabels, renderAt, onBeforeRebuild, onRebuild, onEditToggled, onFrame: syncLabels,
    on: (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
    get active() { return isActive(); },
    get armed() { return st.phase === 'armed'; },
    get busy() { return st.phase !== 'off'; },
    get roomId() { return st.roomId; },
    get progress() { return st.p; },
    get settled() { return st.p === st.target; },
    get labels() { return st.labels; },
    get scope() { return st.scope; },
    get panel() { return panel; },
    dispose() {
      cancelAnimationFrame(st.raf);
      cancelAnimationFrame(panelTimer);
      clearTimeout(toastTimer);
      unbind();
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('resize', onResize);
      clearTimeout(resizeTimer);
      offProject?.();
      offUI?.();
      if (guard) guard.impl = null;
      for (const ev of ['pointerdown', 'wheel', 'touchstart']) canvas.removeEventListener(ev, takeCamera);
      armBtn.remove(); toast.remove(); labelsEl.remove(); panel.remove();
    },
    // for tests
    _test: { units: () => st.units, targets: () => st.targets, poses: () => st.poses, stage: () => st.stage, softMinSide },
  };
  return api;
}
