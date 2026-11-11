// Room snapping for the 3D viewer: room tabs, eye viewpoints, smooth camera flights, double click cutaway and the walk mode room bar.
//
// Calling from the lot card (or any other UI): the app's viewer is window.__ps.getViewer() (an async load: await window.__ps.getViewer.ensure()).
//   const v = await window.__ps.getViewer.ensure();
//   v.roomTabs()                       -> [{ id, label, roomIds, caption, levelId }]   ('aerial' is always the last tab)
//   await v.snapToRoom('living')       -> flies to that tab's eye viewpoint; 'aerial' returns to the site view; a room id also works
//   v.snapToRoom(id, { duration: 0 })  -> jump without the glide
// Orbit and walk mode both work (walking moves the walker, and snapping to 'aerial' leaves walk mode). The pure helpers are
// exported here too: listRoomTabs(project, levelId?), roomViewpoint(project, roomId), flyTo(viewer, pose, opts).
// See docs/ROOMS.md. Geometry and wording live in room-logic.js (no three, no DOM).

import { listRoomTabs, roomViewpoint, tabViewpoint, cutawayPose, roomAtPoint, ORBIT_FOV } from './room-logic.js';

export { listRoomTabs, roomViewpoint, tabViewpoint, cutawayPose, roomAtPoint };
export const roomTabs = listRoomTabs;

const easeInOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const lerp = (a, b, t) => (t >= 1 ? b : a + (b - a) * t);
const reduced = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
const clock = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
const schedule = (fn) => (typeof requestAnimationFrame === 'function' ? requestAnimationFrame(fn) : setTimeout(() => fn(clock()), 16));

// yaw and pitch of a look direction, three.js camera convention (yaw 0 looks along -Z)
function lookAngles(from, to) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dz = to.z - from.z;
  return { yaw: Math.atan2(-dx, -dz), pitch: Math.asin(Math.max(-1, Math.min(1, dy / (Math.hypot(dx, dy, dz) || 1)))) };
}
const shortest = (from, to) => {
  let d = (to - from) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return from + d;
};

const flights = new WeakMap();
const cutaways = new WeakMap();

export function cancelFlight(viewer) {
  const f = flights.get(viewer);
  if (f) f.cancel();
}

// flyTo(viewer, { position, target, fov?, levelId? }, { duration = 1.2, ease }) -> Promise<{ completed }>
// Glides the camera position and look target (orbit mode) or the walker's position and look direction (walk mode).
// Any pointer, wheel, touch or movement key press cancels it where it is.
export function flyTo(viewer, pose, { duration = 1.2, ease = easeInOutCubic, keepCutaway = false } = {}) {
  cancelFlight(viewer);
  if (!keepCutaway) exitCutaway(viewer);
  const cam = viewer.camera;
  const walking = viewer.mode === 'walk' && viewer.walk?.active;
  viewer.stopAnim?.();
  const to = { pos: { ...pose.position }, tgt: { ...pose.target } };
  let step;
  if (walking) {
    const from = { x: cam.position.x, y: cam.position.y, z: cam.position.z, yaw: viewer.walk.yaw, pitch: viewer.walk.pitch ?? 0 };
    const end = { ...to.pos, ...lookAngles(to.pos, to.tgt) };
    end.yaw = shortest(from.yaw, end.yaw);
    step = (k, last) => {
      viewer.walk.placeAt({
        x: lerp(from.x, end.x, k), y: lerp(from.y, end.y, k), z: lerp(from.z, end.z, k),
        yaw: lerp(from.yaw, end.yaw, k), pitch: lerp(from.pitch, end.pitch, k),
        levelId: last ? pose.levelId : null,
      });
    };
  } else {
    const controls = viewer.controls;
    const from = {
      p: { x: cam.position.x, y: cam.position.y, z: cam.position.z },
      t: { x: controls.target.x, y: controls.target.y, z: controls.target.z },
      fov: cam.fov,
    };
    const fovTo = pose.fov ?? cam.fov;
    step = (k) => {
      cam.position.set(lerp(from.p.x, to.pos.x, k), lerp(from.p.y, to.pos.y, k), lerp(from.p.z, to.pos.z, k));
      controls.target.set(lerp(from.t.x, to.tgt.x, k), lerp(from.t.y, to.tgt.y, k), lerp(from.t.z, to.tgt.z, k));
      if (Math.abs(fovTo - cam.fov) > 1e-4) {
        cam.fov = lerp(from.fov, fovTo, k);
        cam.updateProjectionMatrix();
      }
      controls.update();
    };
  }
  return new Promise((resolve) => {
    let done = false;
    const el = viewer.canvas;
    const finish = (completed) => {
      if (done) return;
      done = true;
      el?.removeEventListener?.('pointerdown', stopIt);
      el?.removeEventListener?.('wheel', stopIt);
      el?.removeEventListener?.('touchstart', stopIt);
      if (typeof window !== 'undefined') window.removeEventListener('keydown', onKey, true);
      if (flights.get(viewer) === flight) flights.delete(viewer);
      resolve({ completed });
    };
    const stopIt = () => finish(false);
    const onKey = (e) => {
      if (e.code === 'Escape' || /^(Key[WASD]|Arrow|Space|Page)/.test(e.code)) finish(false);
    };
    const flight = { cancel: () => finish(false) };
    flights.set(viewer, flight);
    el?.addEventListener?.('pointerdown', stopIt, { passive: true });
    el?.addEventListener?.('wheel', stopIt, { passive: true });
    el?.addEventListener?.('touchstart', stopIt, { passive: true });
    if (typeof window !== 'undefined') window.addEventListener('keydown', onKey, true);
    const ms = reduced() ? 0 : Math.max(0, duration * 1000);
    if (ms === 0) {
      step(1, true);
      viewer.invalidate?.();
      finish(true);
      return;
    }
    const t0 = clock();
    const tick = (now) => {
      if (done) return;
      const t = Math.min(1, ((typeof now === 'number' ? now : clock()) - t0) / ms);
      step(ease(t), t >= 1);
      viewer.invalidate?.();
      if (t >= 1) finish(true);
      else schedule(tick);
    };
    schedule(tick);
  });
}

// snapToRoom(viewer, project, tabOrRoomId, opts) -> Promise<{ completed, pose } | null>
// A tab id ('living', 'kitchen', 'dining', 'master', 'bed2', 'alfresco', 'garage', 'aerial'), or a room id.
export async function snapToRoom(viewer, project, tabOrRoomId, opts = {}) {
  if (!viewer || !project) return null;
  if (tabOrRoomId === 'aerial') {
    exitCutaway(viewer);
    if (viewer.mode === 'walk') viewer.leaveWalk?.();
    const a = viewer.aerialPose?.();
    if (!a) return null;
    const r = await flyTo(viewer, { position: a.position, target: a.target, fov: ORBIT_FOV }, opts);
    return { ...r, pose: a };
  }
  const tabs = listRoomTabs(project);
  const tab = tabs.find((t) => t.id === tabOrRoomId);
  const pose = tab ? tabViewpoint(project, tab) : roomViewpoint(project, tabOrRoomId);
  if (!pose) return null;
  const r = await flyTo(viewer, pose, opts);
  return { ...r, pose };
}

// Cutaway ---------------------------------------------------------------------------------------------------
export function exitCutaway(viewer) {
  cutaways.get(viewer)?.exit();
}

// enableRoomCutaway(viewer, project | () => project) -> disable()
// Double click a room floor, wall or window in the orbit view: fly to an angled view over that room with the roof and the levels above
// hidden. They come back when the camera leaves (another view, Escape, orbiting or zooming well away, walk mode).
export function enableRoomCutaway(viewer, projectOrGetter) {
  const getProject = typeof projectOrGetter === 'function' ? projectOrGetter : () => projectOrGetter;
  const store = viewer.store || null;
  let state = null; // { saved, token, armed, centre, dist0, r }
  let selfSet = 0;
  let token = 0;

  const setUI = (patch) => {
    if (!store) return;
    selfSet++;
    try {
      store.setUI(patch);
    } finally {
      selfSet--;
    }
  };
  function exit({ restore = true } = {}) {
    if (!state) return;
    const saved = state.saved;
    state = null;
    token++;
    if (restore && saved) setUI({ showRoof: saved.showRoof ?? true, levelFilter: saved.levelFilter || 'all' });
    viewer.invalidate?.();
  }
  cutaways.set(viewer, { exit: () => exit() });

  function enter(room, level) {
    if (viewer.mode !== 'orbit') return false;
    const project = getProject();
    const cam = viewer.camera;
    const pose = cutawayPose(project, room.id, { vfov: ORBIT_FOV, aspect: cam.aspect || 1.6 });
    if (!pose) return false;
    if (!state) state = { saved: { showRoof: store?.ui?.showRoof, levelFilter: store?.ui?.levelFilter } };
    state.armed = false;
    const my = ++token;
    setUI({ showRoof: false, levelFilter: level.id });
    const { cx, cz } = pose.extents;
    const centre = { x: cx, y: pose.target.y, z: cz };
    flyTo(viewer, pose, { duration: 1.1, keepCutaway: true }).then((r) => {
      if (!state || my !== token) return;
      if (!r.completed) return; // the person took over mid flight: leave the cutaway as it is, watched from here
      state.armed = true;
      state.centre = centre;
      state.r = pose.extents.r;
      state.dist0 = Math.hypot(cam.position.x - centre.x, cam.position.y - centre.y, cam.position.z - centre.z);
    });
    return true;
  }

  function watch() {
    if (!state?.armed) return;
    const cam = viewer.camera;
    const c = state.centre;
    const dx = cam.position.x - c.x;
    const dy = cam.position.y - c.y;
    const dz = cam.position.z - c.z;
    const d = Math.hypot(dx, dy, dz);
    const elev = Math.asin(Math.max(-1, Math.min(1, dy / (d || 1))));
    const t = viewer.controls.target;
    const drift = Math.hypot(t.x - c.x, t.z - c.z);
    if (d > state.dist0 * 1.7 || d < state.dist0 * 0.3 || elev < 0.3 || drift > state.r + 1.5) exit();
  }
  viewer.controls?.addEventListener?.('change', watch);

  const onKey = (e) => {
    if (e.code === 'Escape' && state) exit();
  };
  if (typeof window !== 'undefined') window.addEventListener('keydown', onKey);

  const offUI = store?.on?.('ui', (patch) => {
    if (!patch || selfSet || !state) return;
    if ('view' in patch && patch.view !== '3d' && patch.view !== 'split') exit();
    else if ('levelFilter' in patch || 'showRoof' in patch) exit({ restore: false }); // the person set these themselves
  });

  const offDbl = viewer.addDoubleClickHandler?.((e) => {
    if (viewer.mode !== 'orbit') return false;
    const hit = viewer.pickAt?.(e.clientX, e.clientY);
    if (!hit || hit.ground || !hit.point || !['floor', 'wall', 'roof', 'opening'].includes(hit.kind)) return false;
    const found = roomAtPoint(getProject(), hit.point.x, hit.point.z, hit.levelId || null, hit.point.y);
    if (!found) return false;
    return enter(found.room, found.level);
  });

  return function disable() {
    exit();
    offDbl?.();
    offUI?.();
    viewer.controls?.removeEventListener?.('change', watch);
    if (typeof window !== 'undefined') window.removeEventListener('keydown', onKey);
    cutaways.delete(viewer);
  };
}

// Walk mode room bar ----------------------------------------------------------------------------------------
// A slim row of room buttons along the bottom while walking. Keys 1 to 9 do the same (the pointer is captured while looking around).
export function createRoomBar(viewer, getProject) {
  const store = viewer.store;
  const root = viewer.rootEl;
  if (!store || !root || typeof document === 'undefined') return { dispose() {}, refresh() {} };
  const bar = document.createElement('div');
  bar.className = 'ps3d-roombar';
  bar.dataset.ps = 'room-bar';
  bar.setAttribute('role', 'group');
  bar.setAttribute('aria-label', 'Rooms');
  bar.hidden = true;
  root.appendChild(bar);
  let tabs = [];
  let sig = '';
  let timer = 0;

  const visible = () => store.ui.view === 'walk';
  function rebuild() {
    tabs = listRoomTabs(getProject()).filter((t) => t.id !== 'aerial');
    const next = tabs.map((t) => `${t.id}:${t.roomIds.join('+')}`).join('|');
    if (next === sig) return;
    sig = next;
    bar.replaceChildren(
      ...tabs.map((t, i) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'ps3d-chip ps3d-chip--btn';
        b.dataset.ps = `room-${t.id}`;
        b.dataset.room = t.id;
        b.textContent = t.label;
        b.title = i < 9 ? `${t.caption.split(' · ')[0]} (key ${i + 1})` : t.caption.split(' · ')[0];
        b.addEventListener('click', () => go(t.id));
        return b;
      }),
    );
  }
  function go(id) {
    const p = viewer.snapToRoom?.(id);
    for (const b of bar.children) b.setAttribute('aria-pressed', String(b.dataset.room === id));
    viewer.canvas?.focus?.();
    return p;
  }
  function highlight() {
    if (bar.hidden || !viewer.walk?.active) return;
    const s = viewer.walk._state?.();
    if (!s) return;
    const found = roomAtPoint(getProject(), s.x, s.z, s.levelId);
    for (const b of bar.children) {
      const t = tabs.find((x) => x.id === b.dataset.room);
      b.setAttribute('aria-pressed', String(!!found && !!t && t.roomIds.includes(found.room.id)));
    }
  }
  function sync() {
    rebuild();
    const show = visible() && tabs.length > 0;
    bar.hidden = !show;
    if (show && !timer) timer = setInterval(highlight, 500);
    if (!show && timer) {
      clearInterval(timer);
      timer = 0;
    }
  }
  const onKey = (e) => {
    if (bar.hidden || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    const m = /^Digit([1-9])$/.exec(e.code);
    if (!m) return;
    const tab = tabs[Number(m[1]) - 1];
    if (!tab) return;
    e.preventDefault();
    go(tab.id);
  };
  window.addEventListener('keydown', onKey);
  const offP = store.on('project', sync);
  const offU = store.on('ui', (patch) => {
    if (patch && 'view' in patch) sync();
  });
  sync();
  return {
    refresh: sync,
    dispose() {
      offP?.();
      offU?.();
      window.removeEventListener('keydown', onKey);
      if (timer) clearInterval(timer);
      bar.remove();
    },
  };
}
