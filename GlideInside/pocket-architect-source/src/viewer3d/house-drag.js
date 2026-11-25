// Moving and turning the house in the 3D view with a finger (phones only). The gesture rules are in src/phone/house-gesture.js; this file
// connects them to the 3D scene: it raycasts to the ground plane, moves the house's level groups live while the finger drags, shows a gold
// outline and a 44 px rotate handle on the selected house, and commits one undo step per move and per turn.

import * as THREE from 'three';
import { isPhoneMode } from '../phone/mode.js';
import { createHouseGestures, pairAngle, twistTotal, stepTurn, HANDLE_PX } from '../phone/house-gesture.js';
import { canMoveHouse } from '../editor2d/tool-movehouse.js';
import { houseCentre, lotOf, envelopeOf } from '../model/placement.js';
import { buildingRings } from '../site/lotplan.js';
import { moveHouseBy, turnHouseBy } from '../site/site-items.js';
import { lotChecks } from '../site/lot-checks.js';
import { confirmBreach, statusFromMessages } from '../flow/breach.js';

const HOUSE_KINDS = ['wall', 'floor', 'roof', 'deck', 'opening'];
const RAD = Math.PI / 180;
const worstShort = (project) => Math.max(0, ...lotChecks(project).messages.filter((m) => m.kind === 'envelope').map((m) => Number(m.shortByM) || 0));

export function createHouseDrag({ canvas, rootEl, scene, camera, controls, store, pickAt, getModel, isEnabled, invalidate }) {
  let selected = false;
  let outline = null;
  let shownPreview = null;
  let keep = false; // a commit was made: the groups stay where they were put until the model is rebuilt, so the house does not flick back
  const ndc = new THREE.Vector2();
  const raycaster = new THREE.Raycaster();
  const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

  // The handle and the 15 degree buttons.
  const doc = rootEl.ownerDocument;
  const handle = doc.createElement('button');
  handle.type = 'button';
  handle.className = 'ps3d-rot-handle';
  handle.dataset.ps = 'house-rotate-handle';
  handle.setAttribute('aria-label', 'Turn the house. Drag round, or use the buttons for 15 degree steps.');
  handle.innerHTML = '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 12a8 8 0 1 1-2.6-5.9"/><path d="M20 4v5h-5"/></svg>';
  handle.style.cssText = `width:${HANDLE_PX}px;height:${HANDLE_PX}px`;
  const bar = doc.createElement('div');
  bar.className = 'ps3d-house-bar';
  bar.dataset.ps = 'house-bar';
  bar.setAttribute('role', 'group');
  bar.setAttribute('aria-label', 'Turn the house');
  const stepBtn = (dir, text, aria) => {
    const b = doc.createElement('button');
    b.type = 'button'; b.className = 'ps3d-house-step'; b.dataset.ps = dir < 0 ? 'house-turn-left' : 'house-turn-right';
    b.setAttribute('aria-label', aria); b.textContent = text;
    b.addEventListener('click', () => { if (canMoveHouse(store.project)) store.apply('Rotate house', (p) => { turnHouseBy(p, stepTurn(dir), houseCentre(p)); }); });
    return b;
  };
  bar.append(stepBtn(-1, '↺ 15°', 'Turn the house 15 degrees anticlockwise'), stepBtn(1, '15° ↻', 'Turn the house 15 degrees clockwise'));
  handle.hidden = true; bar.hidden = true;
  rootEl.append(handle, bar);

  const mmToWorld = (p) => new THREE.Vector3(p.x / 1000, 0, p.y / 1000);
  // Everything of the house: its level groups, roof, trim and the tanks that stand with it. The lot, terrain and site extras stay put.
  const groups = () => (getModel()?.children || []).filter((o) => !(typeof o.name === 'string' && o.name.startsWith('site')) && !o.userData?.ground);

  function planPoint(x, y) {
    const r = canvas.getBoundingClientRect();
    ndc.set(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    const pt = raycaster.ray.intersectPlane(plane, new THREE.Vector3());
    if (!pt || pt.distanceTo(camera.position) > 400) return null;
    return { x: pt.x * 1000, y: pt.z * 1000 };
  }

  function hitHouse(x, y) {
    const h = pickAt(x, y);
    return !!h && !h.ground && HOUSE_KINDS.includes(h.kind);
  }

  function applyPreview(p) {
    if (!p && keep) { shownPreview = null; placeHandle(); return; }
    if (p) keep = false;
    const c = houseCentre(store.project);
    for (const g of groups()) {
      if (!p) { g.position.set(0, 0, 0); g.rotation.y = 0; continue; }
      if (p.deg) {
        const th = -p.deg * RAD;
        const cx = c.x / 1000; const cz = c.y / 1000;
        g.rotation.y = th;
        g.position.set(cx - (cx * Math.cos(th) + cz * Math.sin(th)), 0, cz - (-cx * Math.sin(th) + cz * Math.cos(th)));
      } else { g.rotation.y = 0; g.position.set(p.dx / 1000, 0, p.dy / 1000); }
    }
    shownPreview = p;
    placeHandle();
    invalidate();
  }

  async function afterCommit(before) {
    const checks = lotChecks(store.project);
    const status = statusFromMessages(checks.messages);
    if (!status || worstShort(store.project) <= before + 0.05) return;
    if (!(await confirmBreach(status, { what: store.project.mode === 'commercial' ? 'building' : 'house' }))) store.undo();
  }

  const machine = createHouseGestures({
    canvas, controls, hitHouse, planPoint,
    enabled: () => isPhoneMode() && isEnabled() && canMoveHouse(store.project),
    state: () => {
      const p = store.project;
      const lot = lotOf(p);
      const env = lot ? envelopeOf(lot).polygon : null;
      const targets = [env && env.length >= 3 ? env : null, lot?.boundary?.length >= 3 ? lot.boundary : null].filter(Boolean);
      return { centre: houseCentre(p), rings: buildingRings(p), targets };
    },
    preview: applyPreview,
    commit: (c) => {
      const before = worstShort(store.project);
      keep = true;
      if (c.kind === 'move') store.apply('Move house', (p) => { moveHouseBy(p, c.dx, c.dy); });
      else store.apply('Rotate house', (p) => { turnHouseBy(p, c.deg, houseCentre(p)); });
      setSelected(true);
      afterCommit(before);
    },
    select: (on) => setSelected(on),
  });
  const onDown = (e) => { machine.down(e); };
  const onMove = (e) => { machine.move(e); };
  const onUp = (e) => { machine.up(e); };
  const onCancel = (e) => { machine.up(e, { cancelled: true }); };
  canvas.addEventListener('pointerdown', onDown, true);
  canvas.addEventListener('pointermove', onMove, true);
  canvas.addEventListener('pointerup', onUp, true);
  canvas.addEventListener('pointercancel', onCancel, true);

  // The rotate handle: drag round the house centre.
  let hd = null;
  const centreScreen = () => {
    const r = canvas.getBoundingClientRect();
    const v = mmToWorld(houseCentre(store.project)).project(camera);
    return { x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height };
  };
  handle.addEventListener('pointerdown', (e) => {
    e.preventDefault(); e.stopPropagation();
    try { handle.setPointerCapture(e.pointerId); } catch { /* no capture */ }
    const c = centreScreen();
    hd = { id: e.pointerId, c, prev: pairAngle(c, { x: e.clientX, y: e.clientY }), total: 0, deg: 0, was: controls.enabled };
    controls.enabled = false;
  });
  handle.addEventListener('pointermove', (e) => {
    if (!hd || e.pointerId !== hd.id) return;
    e.preventDefault();
    const a = pairAngle(hd.c, { x: e.clientX, y: e.clientY });
    hd.total = twistTotal(hd.total, hd.prev, a);
    hd.prev = a;
    hd.deg = Math.round(hd.total);
    applyPreview({ dx: 0, dy: 0, deg: hd.deg, snapped: false });
  });
  const endHandle = (e, ok) => {
    if (!hd || e.pointerId !== hd.id) return;
    const d = hd; hd = null;
    controls.enabled = d.was;
    const before = worstShort(store.project);
    if (ok && d.deg) keep = true;
    applyPreview(null);
    if (ok && d.deg) { store.apply('Rotate house', (p) => { turnHouseBy(p, d.deg, houseCentre(p)); }); afterCommit(before); }
  };
  handle.addEventListener('pointerup', (e) => endHandle(e, true));
  handle.addEventListener('pointercancel', (e) => endHandle(e, false));

  function placeHandle() {
    const show = selected && isPhoneMode() && isEnabled() && canMoveHouse(store.project);
    handle.hidden = !show; bar.hidden = !show;
    if (!show) return;
    const r = canvas.getBoundingClientRect();
    const rr = rootEl.getBoundingClientRect();
    const c = houseCentre(store.project);
    const v = new THREE.Vector3(c.x / 1000 + (shownPreview?.dx || 0) / 1000, 5.2, c.y / 1000 + (shownPreview?.dy || 0) / 1000).project(camera);
    const x = r.left - rr.left + ((v.x + 1) / 2) * r.width;
    const y = r.top - rr.top + ((1 - v.y) / 2) * r.height;
    const pad = HANDLE_PX / 2 + 4;
    handle.style.left = `${Math.min(rr.width - pad, Math.max(pad, x)) - HANDLE_PX / 2}px`;
    handle.style.top = `${Math.min(rr.height - 140, Math.max(60, y)) - HANDLE_PX / 2}px`;
  }

  function drawOutline() {
    if (outline) { scene.remove(outline); outline.traverse((o) => { o.geometry?.dispose?.(); o.material?.dispose?.(); }); outline = null; }
    if (!selected || !isEnabled() || !canMoveHouse(store.project)) return;
    outline = new THREE.Group();
    outline.name = 'house-outline';
    for (const ring of buildingRings(store.project)) {
      const pts = ring.map((q) => new THREE.Vector3(q.x / 1000, 0.08, q.y / 1000));
      outline.add(new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0xc7a256 })));
    }
    scene.add(outline);
  }

  function setSelected(on) {
    selected = !!on;
    drawOutline();
    placeHandle();
    invalidate();
  }

  return {
    get selected() { return selected; },
    onRebuild() { keep = false; shownPreview = null; drawOutline(); placeHandle(); },
    refresh() { shownPreview = null; if (!isEnabled()) selected = false; drawOutline(); placeHandle(); },
    reposition: placeHandle,
    select: setSelected,
    machine,
    dispose() {
      machine.cancel();
      canvas.removeEventListener('pointerdown', onDown, true);
      canvas.removeEventListener('pointermove', onMove, true);
      canvas.removeEventListener('pointerup', onUp, true);
      canvas.removeEventListener('pointercancel', onCancel, true);
      if (outline) scene.remove(outline);
      handle.remove(); bar.remove();
    },
  };
}
