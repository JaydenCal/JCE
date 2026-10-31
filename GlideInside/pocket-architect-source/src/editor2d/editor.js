// 2D plan editor. Canvas 2D, DPR aware, redraws batched with requestAnimationFrame.
// createEditor2D(element, store, { catalogue }) -> { setActive, zoomToFit, dispose, ... }

import * as G from '../model/geometry.js';
import { applyOp, findEntity } from '../model/ops.js';
import * as M from './math.js';
import { readTheme } from './theme.js';
import { buildScene, drawGrid, drawUnderlay, drawGhostLevel, drawRooms, drawRoomLabels, drawWalls } from './draw-plan.js';
import { drawOpenings, drawStairs, drawFurniture, drawTanks } from './draw-items.js';
import { drawOverallDims, drawSelection, drawHover, drawNorthArrow, drawScaleBar } from './draw-annot.js';
import { loadBitmap, removeImage, registerUnderlayEditor, setUnderlayFromBlob, setUnderlayFromCanvas } from './underlay.js';
import { clashIds, createClashNotifier } from './clash.js';
import { KEY_TO_TOOL } from './tools-meta.js';
import { createSelectTool } from './tool-select.js';
import { createDrawTools } from './tool-draw.js';
import { createPlaceTools } from './tool-place.js';
import { createMiscTools } from './tool-misc.js';
import { toast } from '../ui/toast.js';
import { openPopover } from '../ui/popover.js';
import { h, isTyping } from '../ui/dom.js';
import { setTool } from '../ui/toolstate.js';

const RIGHT_DRAG_PX = 4;

export function createEditor2D(element, store, { catalogue } = {}) {
  const canvas = h('canvas', { class: 'ps-plan-canvas', tabindex: '0', 'aria-label': 'Floor plan canvas' });
  canvas.style.touchAction = 'none';
  const overlay = h('div', { class: 'ps-plan-overlay' });
  element.append(canvas, overlay);
  const g2 = canvas.getContext('2d');

  const state = {
    view: { scale: M.DEFAULT_SCALE, ox: 60, oy: 60 },
    size: { w: 0, h: 0 },
    autoFit: false,
    dpr: 1,
    theme: readTheme(element),
    active: false,
    rev: 0,
    scene: null,
    sceneKey: '',
    pointer: null,
    hover: null,
    preview: null,
    space: false,
    pan: null,
    gesture: null,
    toolId: null,
    popover: null,
    underlayKey: null,
    underlayBitmap: null,
    underlayMissing: false,
    calibrating: false,
    rclick: null,
    rotAcc: 0,
    clashSet: new Set(),
    clashRev: -1,
    hadPreview: false,
    fitted: false,
    raf: 0,
    disposed: false,
  };
  const pointers = new Map();
  let current = null;
  let tools = {};

  // Context handed to every tool ------------------------------------------------------------------
  const ed = {
    store,
    catalogue,
    overlay,
    canvas,
    get view() {
      return state.view;
    },
    get size() {
      return state.size;
    },
    get theme() {
      return state.theme;
    },
    get state() {
      return state;
    },
    project: () => state.preview || store.project,
    level: () => store.level(),
    isGround: (level = store.level()) => M.groundLevel(store.project)?.id === level.id,
    visible: (status) => M.statusVisible(status, store.ui.statusView),
    def: (id) => catalogue?.getFurniture?.(id) || null,
    furnSize: (f) => M.furnitureSize(f, catalogue?.getFurniture?.(f.item)),
    toScreen: (p) => M.worldToScreen(state.view, p),
    toWorld: (s) => M.screenToWorld(state.view, s),
    snapOn: () => !!store.ui.snap,
    snapMm: () => store.project.settings?.snapMm || 50,
    // Snap a world point using grid, wall ends and extra points. Alt bypasses.
    snap(world, { alt = false, endpoints = true, extraPoints = [] } = {}) {
      return M.snapPoint(world, {
        level: store.level(),
        scale: state.view.scale,
        snapMm: ed.snapMm(),
        snapOn: ed.snapOn(),
        alt,
        endpoints,
        extraPoints,
        visible: (w) => ed.visible(w.status),
      });
    },
    hit(world, kinds) {
      return M.hitTest(store.project, store.level(), world, {
        scale: state.view.scale,
        kinds,
        visible: ed.visible,
        furnSize: ed.furnSize,
        tanks: ed.isGround(),
      });
    },
    // Run a registry operation; report failures in a toast instead of throwing.
    run(op, args, { quiet = false } = {}) {
      try {
        return store.run(op, args);
      } catch (e) {
        if (!quiet) toast(e?.message || 'That change was not possible', { kind: 'warn' });
        return null;
      }
    },
    apply(label, fn) {
      try {
        return store.apply(label, fn);
      } catch (e) {
        toast(e?.message || 'That change was not possible', { kind: 'warn' });
        return null;
      }
    },
    select: (id) => store.select(id),
    setHint(text) {
      store.emit('plan:hint', text || '');
    },
    draw: () => requestDraw(),
    setPreview(project) {
      state.preview = project;
      requestDraw();
    },
    // Show the result of `fn` on a copy of the project while a drag is in progress.
    previewFn(fn) {
      const copy = structuredClone(store.project);
      try {
        fn(copy);
        state.preview = copy;
      } catch {
        state.preview = null;
      }
      requestDraw();
      return state.preview;
    },
    previewOp(name, args) {
      return ed.previewFn((p) => applyOp(p, name, args, store.opContext()));
    },
    clearPreview() {
      if (state.preview) {
        state.preview = null;
        requestDraw();
      }
    },
    popover(opts) {
      state.popover?.close();
      state.popover = openPopover(overlay, { ...opts, onCancel: () => { state.popover = null; opts.onCancel?.(); } });
      return state.popover;
    },
    closePopover() {
      state.popover?.close();
      state.popover = null;
    },
    hasPopover: () => !!state.popover && !state.popover.closed,
    startPan(ev) {
      state.pan = { sx: ev.screen.x, sy: ev.screen.y, ox: state.view.ox, oy: state.view.oy };
      updateCursor();
    },
    setTool: (id, arg) => setTool(store, id, arg),
    toast,
    getUnderlayBitmap: () => state.underlayBitmap,
    startCalibration: () => api.startCalibration(),
  };

  // Rendering -------------------------------------------------------------------------------------------
  function requestDraw() {
    if (state.raf || state.disposed) return;
    state.raf = requestAnimationFrame(render);
  }

  function resize() {
    const w = element.clientWidth;
    const hgt = element.clientHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    if (w === state.size.w && hgt === state.size.h && dpr === state.dpr) return;
    state.size = { w, h: hgt };
    state.dpr = dpr;
    canvas.width = Math.max(1, Math.round(w * dpr));
    canvas.height = Math.max(1, Math.round(hgt * dpr));
    // A view the person has not moved follows the stage size (window resize, bottom sheet opening).
    if (state.active && w > 0 && (!state.fitted || state.autoFit)) zoomToFit();
    requestDraw();
  }

  function sceneFor(project, level) {
    const key = `${state.rev}|${level.id}|${store.ui.statusView}`;
    if (project === store.project && state.scene && state.sceneKey === key) return state.scene;
    const scene = buildScene(project, level, store.ui.statusView);
    if (project === store.project) {
      state.scene = scene;
      state.sceneKey = key;
    }
    return scene;
  }

  // Furniture clashes ---------------------------------------------------------------------------------------
  const notifier = createClashNotifier();
  const nameOf = (project, id) => {
    for (const l of project.levels) {
      const f = l.furniture.find((x) => x.id === id);
      if (f) return catalogue?.getFurniture?.(f.item)?.name || String(f.item).replace(/[_-]+/g, ' ');
    }
    return 'Furniture';
  };
  function announce(project, ids) {
    if (ids.length === 1) toast(`${nameOf(project, ids[0])} clips a wall`, { kind: 'warn', timeout: 3600 });
    else toast(`${ids.length} items clip walls`, { kind: 'warn', timeout: 3600 });
  }
  // The clash set for what is on screen. A drag preview is checked live; a settled project is cached per revision.
  function currentClashes(project) {
    if (project !== store.project) {
      state.hadPreview = true;
      const live = clashIds(project, catalogue);
      notifier.notify(live, (ids) => announce(project, ids));
      return live;
    }
    if (state.clashRev !== state.rev) {
      state.clashSet = clashIds(project, catalogue);
      state.clashRev = state.rev;
    }
    if (state.hadPreview) {
      state.hadPreview = false;
      notifier.notify(state.clashSet, (ids) => announce(project, ids));
    }
    return state.clashSet;
  }
  ed.clashes = (project) => clashIds(project || store.project, catalogue);

  function render() {
    state.raf = 0;
    if (state.disposed || !state.active || !state.size.w || !state.size.h) return;
    const project = ed.project();
    const level = project.levels.find((l) => l.id === store.ui.activeLevelId) || project.levels[0];
    const scene = sceneFor(project, level);
    const ground = M.groundLevel(project)?.id === level.id;
    const tanks = (project.site?.tanks || []).filter((t) => ed.visible(t.status));
    const st = {
      view: state.view,
      size: state.size,
      theme: state.theme,
      project,
      level,
      statusView: store.ui.statusView,
      tool: store.ui.tool,
      underlayBitmap: state.underlayBitmap,
      furnSize: ed.furnSize,
    };
    const clashes = currentClashes(project);
    const ctx = g2;
    ctx.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);
    ctx.fillStyle = state.theme.c.canvas;
    ctx.fillRect(0, 0, state.size.w, state.size.h);
    drawGrid(ctx, st);
    drawUnderlay(ctx, st);
    drawGhostLevel(ctx, st, M.levelBelow(project, level));
    drawRooms(ctx, st, scene);
    drawWalls(ctx, st, scene);
    drawOpenings(ctx, st, scene);
    drawStairs(ctx, st, level);
    drawFurniture(ctx, st, level, catalogue, clashes);
    drawTanks(ctx, st, tanks, { ghost: !ground });
    drawRoomLabels(ctx, st, scene);
    drawOverallDims(ctx, st, scene);
    const found = store.ui.selection ? findEntity(project, store.ui.selection) : null;
    const sel = found && found.kind !== 'level' ? { kind: found.kind, id: found.item.id, item: found.item } : null;
    if (state.hover && (!sel || state.hover.id !== sel.id) && !state.pan) drawHover(ctx, st, scene, state.hover);
    drawSelection(ctx, st, scene, sel);
    current?.draw?.(ctx, st, ed);
    drawNorthArrow(ctx, st);
    drawScaleBar(ctx, st);
  }

  // View ---------------------------------------------------------------------------------------------------
  function fitBounds() {
    const project = store.project;
    const level = store.level();
    const pts = [...G.levelPoints(level)];
    if (ed.isGround(level)) for (const t of project.site?.tanks || []) pts.push({ x: t.x - t.diameter / 2, y: t.y - t.diameter / 2 }, { x: t.x + t.diameter / 2, y: t.y + t.diameter / 2 });
    if (!pts.length) pts.push(...project.levels.flatMap(G.levelPoints));
    const u = project.site?.underlay;
    if (u && state.underlayBitmap) pts.push(...M.underlayCorners(u, state.underlayBitmap.w, state.underlayBitmap.h));
    return G.bbox(pts);
  }

  function zoomToFit() {
    if (!state.size.w) {
      state.fitted = false;
      return;
    }
    state.view = M.fitView(fitBounds(), state.size, { padding: Math.min(84, Math.max(54, state.size.w * 0.08)) });
    state.fitted = true;
    state.autoFit = true;
    emitZoom();
    requestDraw();
  }

  function emitZoom() {
    store.emit('plan:zoom', { scale: state.view.scale });
  }

  function zoomBy(factor, about) {
    state.autoFit = false;
    state.view = M.zoomAt(state.view, about || { x: state.size.w / 2, y: state.size.h / 2 }, factor);
    emitZoom();
    requestDraw();
  }

  function updateCursor() {
    canvas.style.cursor = state.pan ? 'grabbing' : state.space ? 'grab' : current?.cursor?.() || 'default';
  }

  // Pointer input ----------------------------------------------------------------------------------------------
  function evFrom(e) {
    const r = canvas.getBoundingClientRect();
    const screen = { x: e.clientX - r.left, y: e.clientY - r.top };
    return { world: M.screenToWorld(state.view, screen), screen, shift: e.shiftKey, alt: e.altKey, ctrl: e.ctrlKey || e.metaKey, button: e.button, type: e.pointerType, raw: e };
  }

  function setPointer(ev) {
    state.pointer = ev;
    store.emit('plan:cursor', { x: Math.round(ev.world.x), y: Math.round(ev.world.y) });
  }

  function beginGesture() {
    const pts = [...pointers.values()];
    const [a, b] = pts;
    state.gesture = { dist: Math.hypot(a.x - b.x, a.y - b.y) || 1, cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 };
    current?.cancel?.();
    state.pan = null;
    // A finger left over after a pinch must not act on the tool when it lifts.
    state.ignoreUntilUp = true;
  }

  function onPointerDown(e) {
    if (!state.active) return;
    canvas.focus({ preventScroll: true });
    const ev = evFrom(e);
    pointers.set(e.pointerId, ev.screen);
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {
      /* synthetic pointers have no capture */
    }
    if (pointers.size === 2) {
      beginGesture();
      return;
    }
    if (pointers.size > 2) return;
    setPointer(ev);
    if (e.button === 1 || (e.button === 0 && state.space)) {
      e.preventDefault();
      ed.startPan(ev);
      return;
    }
    if (e.button === 2) {
      // Right button: drag pans, a click without moving starts a quick measure.
      e.preventDefault();
      state.rclick = { sx: ev.screen.x, sy: ev.screen.y, moved: false };
      return;
    }
    if (e.button !== 0) return;
    if (ed.hasPopover()) {
      current?.cancel?.();
      ed.closePopover();
      return;
    }
    current?.pointerDown?.(ev);
  }

  function onPointerMove(e) {
    if (!state.active) return;
    const ev = evFrom(e);
    if (pointers.has(e.pointerId)) pointers.set(e.pointerId, ev.screen);
    if (state.gesture && pointers.size >= 2) {
      const [a, b] = [...pointers.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      const cx = (a.x + b.x) / 2;
      const cy = (a.y + b.y) / 2;
      state.autoFit = false;
      state.view = M.panBy(state.view, cx - state.gesture.cx, cy - state.gesture.cy);
      state.view = M.zoomAt(state.view, { x: cx, y: cy }, dist / state.gesture.dist);
      state.gesture = { dist, cx, cy };
      emitZoom();
      requestDraw();
      return;
    }
    if (state.ignoreUntilUp) return;
    setPointer(ev);
    if (state.rclick && !state.rclick.moved && !state.pan && Math.hypot(ev.screen.x - state.rclick.sx, ev.screen.y - state.rclick.sy) >= RIGHT_DRAG_PX) {
      state.rclick.moved = true;
      ed.startPan({ screen: { x: state.rclick.sx, y: state.rclick.sy } });
    }
    if (state.pan) {
      state.autoFit = false;
      state.view = { scale: state.view.scale, ox: state.pan.ox + (ev.screen.x - state.pan.sx), oy: state.pan.oy + (ev.screen.y - state.pan.sy) };
      requestDraw();
      return;
    }
    current?.pointerMove?.(ev);
    if (!e.buttons && store.ui.tool === 'select') {
      const hit = ed.hit(ev.world);
      if (hit?.id !== state.hover?.id) {
        state.hover = hit;
        updateCursor();
        requestDraw();
      }
    }
    requestDraw();
  }

  // A right click that did not drag: start the measure tool at that point. The next click finishes it.
  function quickMeasure(ev) {
    state.popover?.close();
    state.popover = null;
    if (store.ui.tool !== 'measure') setTool(store, 'measure');
    tools.measure?.startAt?.(ev);
  }

  function onPointerUp(e) {
    if (!state.active) return;
    const ev = evFrom(e);
    const had = pointers.delete(e.pointerId);
    try {
      canvas.releasePointerCapture(e.pointerId);
    } catch {
      /* not captured */
    }
    if (state.gesture) {
      if (pointers.size < 2) state.gesture = null;
      if (!pointers.size) state.ignoreUntilUp = false;
      return;
    }
    if (state.ignoreUntilUp) {
      if (!pointers.size) state.ignoreUntilUp = false;
      return;
    }
    if (!had) return;
    if (state.rclick && (e.button === 2 || e.type === 'pointercancel')) {
      const rc = state.rclick;
      state.rclick = null;
      if (rc.moved || e.type === 'pointercancel') {
        state.pan = null;
        updateCursor();
        requestDraw();
      } else quickMeasure(ev);
      return;
    }
    if (state.pan) {
      state.pan = null;
      updateCursor();
      requestDraw();
      return;
    }
    current?.pointerUp?.(ev);
    requestDraw();
  }

  function onPointerLeave() {
    state.hover = null;
    store.emit('plan:cursor', null);
    current?.pointerLeave?.();
    updateCursor();
    requestDraw();
  }

  function onWheel(e) {
    if (!state.active) return;
    e.preventDefault();
    const r = canvas.getBoundingClientRect();
    // Shift and scroll turns furniture (or stairs) while placing or selected, 15 degrees a notch.
    if (e.shiftKey && current?.canRotate?.()) {
      state.rotAcc += (e.deltaY || e.deltaX) * (e.deltaMode === 1 ? 16 : 1);
      if (Math.abs(state.rotAcc) >= 40) {
        current.rotateBy(state.rotAcc > 0 ? 15 : -15);
        state.rotAcc = 0;
      }
      return;
    }
    const scale = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 300 : 1;
    const k = e.ctrlKey ? 0.012 : 0.0016;
    zoomBy(Math.exp(-e.deltaY * scale * k), { x: e.clientX - r.left, y: e.clientY - r.top });
  }

  function onDblClick(e) {
    if (!state.active) return;
    current?.dblClick?.(evFrom(e));
  }

  // Keyboard -----------------------------------------------------------------------------------------------------------
  function onKeyDown(e) {
    if (!state.active || state.disposed || isTyping(e.target) || e.defaultPrevented) return;
    if (e.target.closest?.('.ps-modal, .ps-popover')) return;
    if (e.key === ' ') {
      if (!state.space) {
        state.space = true;
        updateCursor();
      }
      e.preventDefault();
      return;
    }
    if (e.ctrlKey || e.metaKey) return;
    if (current?.keyDown?.(e)) {
      e.preventDefault();
      return;
    }
    const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if (key === 'Escape') {
      if (current?.cancel?.()) return;
      if (store.ui.tool !== 'select') setTool(store, 'select');
      else if (store.ui.selection) store.select(null);
      return;
    }
    if (key === 'Delete' || key === 'Backspace') {
      const id = store.ui.selection;
      if (id && store.find(id)?.kind !== 'level') {
        e.preventDefault();
        ed.run('delete', { id });
      }
      return;
    }
    if (key === 'f' && e.shiftKey) {
      e.preventDefault();
      zoomToFit();
      return;
    }
    if (key === 'Home') {
      zoomToFit();
      return;
    }
    if (key === '+' || key === '=') return zoomBy(1.25);
    if (key === '-' || key === '_') return zoomBy(1 / 1.25);
    if (!e.altKey && KEY_TO_TOOL[key]) {
      e.preventDefault();
      setTool(store, KEY_TO_TOOL[key]);
    }
  }

  function onKeyUp(e) {
    if (e.key === ' ' && state.space) {
      state.space = false;
      updateCursor();
    }
    if (e.key === 'Shift' || e.key === 'Alt') current?.modifiersChanged?.();
  }

  // Store events ------------------------------------------------------------------------------------------------------------
  function syncTool() {
    const id = store.ui.tool;
    if (!tools[id]) {
      store.ui.tool = 'select';
      return syncTool();
    }
    if (id !== state.toolId) {
      state.popover?.close();
      state.popover = null;
      current?.deactivate?.();
      state.toolId = id;
      current = tools[id];
      current.activate?.();
      state.hover = null;
      ed.clearPreview();
    }
    ed.setHint(current.hint?.() || '');
    updateCursor();
    requestDraw();
  }

  function syncUnderlay() {
    const u = store.project.site?.underlay;
    if (!u) {
      state.underlayKey = null;
      state.underlayBitmap = null;
      state.underlayMissing = false;
      return;
    }
    if (u.key === state.underlayKey) return;
    state.underlayKey = u.key;
    state.underlayBitmap = null;
    const key = u.key;
    loadBitmap(key).then((bmp) => {
      if (state.underlayKey !== key || state.disposed) return;
      state.underlayBitmap = bmp;
      state.underlayMissing = !bmp;
      store.emit('plan:underlay', { missing: !bmp });
      requestDraw();
    });
  }

  const offs = [];
  offs.push(
    store.on('project', ({ label } = {}) => {
      state.rev++;
      state.preview = null;
      state.hover = null;
      syncUnderlay();
      state.clashSet = clashIds(store.project, catalogue);
      state.clashRev = state.rev;
      state.hadPreview = false;
      if (label === 'Open project') notifier.silent(state.clashSet);
      else notifier.notify(state.clashSet, (ids) => announce(store.project, ids));
      if (label === 'Open project') {
        state.fitted = false;
        state.calibrating = false;
        if (state.active) zoomToFit();
      }
      current?.projectChanged?.();
      requestDraw();
    }),
    store.on('ui', (patch = {}) => {
      if ('tool' in patch || 'toolArg' in patch) syncTool();
      if ('activeLevelId' in patch) {
        state.hover = null;
        ed.clearPreview();
        current?.cancel?.();
        state.rev++;
      }
      requestDraw();
    }),
    store.on('selection', () => {
      current?.selectionChanged?.();
      requestDraw();
    }),
  );

  // Underlay management ---------------------------------------------------------------------------------------------------------
  async function uploadUnderlay(file) {
    try {
      const res = await setUnderlayFromBlob(store, file, { calibrate: false });
      if (res.stored === false) toast('This browser would not store the image, so it is kept for this session only.', { kind: 'warn' });
      toast('Underlay added. Calibrate it by picking two points a known distance apart.', { kind: 'ok' });
    } catch (e) {
      toast(e?.message || 'That image could not be used', { kind: 'warn' });
    }
  }

  async function removeUnderlay() {
    const u = store.project.site.underlay;
    if (!u) return;
    store.apply('Remove underlay', (p) => {
      p.site.underlay = null;
    });
    await removeImage(u.key);
  }

  // Public API ----------------------------------------------------------------------------------------------------------------------
  const api = {
    setActive(on) {
      state.active = !!on;
      if (on) {
        state.theme = readTheme(element);
        resize();
        syncUnderlay();
        syncTool();
        if (!state.fitted) zoomToFit();
        requestDraw();
      } else {
        state.popover?.close();
        state.popover = null;
        current?.cancel?.();
        pointers.clear();
        state.pan = null;
        state.gesture = null;
        state.ignoreUntilUp = false;
      }
    },
    zoomToFit,
    zoomBy: (f) => zoomBy(f),
    getView: () => ({ ...state.view }),
    setView(v) {
      state.autoFit = false;
      state.view = { ...state.view, ...v };
      emitZoom();
      requestDraw();
    },
    // Client (page) coordinates of a plan point, for tests and tutorials.
    toClient(p) {
      const r = canvas.getBoundingClientRect();
      const s = M.worldToScreen(state.view, p);
      return { x: r.left + s.x, y: r.top + s.y };
    },
    uploadUnderlay,
    // Make a PNG or JPEG Blob or File the underlay and start calibration. See editor2d/underlay.js.
    setUnderlayFromBlob: (blob, opts) => setUnderlayFromBlob(store, blob, opts),
    setUnderlayFromCanvas: (canvasEl, opts) => setUnderlayFromCanvas(store, canvasEl, opts),
    removeUnderlay,
    previewProject: (fn) => ed.previewFn(fn),
    clearPreview: () => ed.clearPreview(),
    startCalibration() {
      if (!store.project.site.underlay) {
        toast('Add an underlay image first', { kind: 'warn' });
        return;
      }
      setTool(store, 'underlay');
      state.calibrating = true;
      tools.underlay?.beginCalibration?.();
      store.emit('plan:calibrating', true);
    },
    cancelCalibration() {
      state.calibrating = false;
      tools.underlay?.cancel?.();
      store.emit('plan:calibrating', false);
    },
    isCalibrating: () => state.calibrating,
    getUnderlayStatus: () => ({ loaded: !!state.underlayBitmap, missing: state.underlayMissing, width: state.underlayBitmap?.w || 0, height: state.underlayBitmap?.h || 0 }),
    get canvas() {
      return canvas;
    },
    redraw: requestDraw,
    dispose() {
      state.disposed = true;
      cancelAnimationFrame(state.raf);
      offs.forEach((off) => off?.());
      unregisterUnderlay();
      ro.disconnect();
      mo.disconnect();
      mq?.removeEventListener?.('change', onThemeChange);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      canvas.remove();
      overlay.remove();
    },
  };
  ed.api = api;
  const unregisterUnderlay = registerUnderlayEditor(store, {
    centre: () => M.screenToWorld(state.view, { x: state.size.w / 2, y: state.size.h / 2 }),
    setBitmap(key, bitmap) {
      state.underlayKey = key;
      state.underlayBitmap = bitmap;
      state.underlayMissing = false;
    },
    calibrate: () => api.startCalibration(),
  });

  // Tools need `ed` and, for the underlay tool, the calibration hooks above.
  tools = {
    ...createSelectTool(ed),
    ...createDrawTools(ed),
    ...createPlaceTools(ed),
    ...createMiscTools(ed, { onCalibrated: () => { state.calibrating = false; store.emit('plan:calibrating', false); } }),
  };

  // Listeners ---------------------------------------------------------------------------------------------------------------------------
  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerUp);
  canvas.addEventListener('pointerleave', onPointerLeave);
  canvas.addEventListener('wheel', onWheel, { passive: false });
  canvas.addEventListener('dblclick', onDblClick);
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  const ro = new ResizeObserver(() => resize());
  ro.observe(element);
  const onThemeChange = () => {
    state.theme = readTheme(element);
    requestDraw();
  };
  const mo = new MutationObserver(onThemeChange);
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'class'] });
  const mq = window.matchMedia?.('(prefers-color-scheme: dark)');
  mq?.addEventListener?.('change', onThemeChange);

  state.clashSet = clashIds(store.project, catalogue);
  notifier.silent(state.clashSet);
  syncUnderlay();
  syncTool();
  return api;
}
