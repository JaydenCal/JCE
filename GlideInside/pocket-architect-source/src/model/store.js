// Project store: single source of truth, snapshot undo and redo, autosave.
// Always read store.project fresh; undo replaces the object.

import { migrate } from './schema.js';
import { applyOp, findEntity, OPS } from './ops.js';

/**
 * A deep copy of the project that SHARES the lot's elevation grid (site.lot.terrain). The grid is large, read only and replaced as a whole when it
 * changes, so copying it on every change and every undo step only costs time and memory.
 */
export function cloneProject(project) {
  const lot = project?.site?.lot;
  const t = lot?.terrain;
  if (!t) return structuredClone(project);
  lot.terrain = undefined;
  let c;
  try { c = structuredClone(project); } finally { lot.terrain = t; }
  c.site.lot.terrain = t;
  return c;
}

export function createStore(project, opts = {}) {
  const listeners = new Map();
  const undoStack = [];
  let floor = 0; // undo cannot go below this many steps (set when a lot is loaded)
  const redoStack = [];
  const limit = opts.historyLimit ?? 100;
  let saveTimer = null;
  let autosaveOn = true;
  // Two tabs on one design: each tab has an id, and every autosave carries a version counter in a small side key. A tab whose last
  // known version is older than the stored one (another tab saved since) does not overwrite it until the person chooses to keep editing here.
  const tabId = `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  const metaKey = opts.autosaveKey ? `${opts.autosaveKey}.meta` : null;
  const readMeta = () => {
    try {
      const m = JSON.parse(localStorage.getItem(metaKey) || 'null');
      return m && typeof m === 'object' ? { tab: String(m.tab || ''), v: Number(m.v) || 0 } : { tab: '', v: 0 };
    } catch { return { tab: '', v: 0 }; }
  };
  let knownV = 0;
  let stale = false;
  const hasStorage = () => !!metaKey && typeof localStorage !== 'undefined';
  if (hasStorage()) knownV = readMeta().v;
  const markStale = () => {
    if (stale) return;
    stale = true;
    clearTimeout(saveTimer);
    store.emit('autosave-conflict', { reload: () => { if (typeof location !== 'undefined') location.reload(); }, keep: () => store.keepEditing() });
  };

  const store = {
    project: migrate(project),
    ui: {
      view: '2d', // '2d' | '3d' | 'walk'
      tool: 'select',
      toolArg: null, // e.g. furniture item id or opening preset
      activeLevelId: null,
      levelFilter: 'all', // 'all' | level id (3D cutaway)
      showRoof: true,
      statusView: 'proposed', // 'proposed' | 'existing' | 'both'
      selection: null,
      snap: true,
      premium: { entitled: false, credits: null },
    },

    on(evt, cb) {
      if (!listeners.has(evt)) listeners.set(evt, new Set());
      listeners.get(evt).add(cb);
      return () => listeners.get(evt)?.delete(cb);
    },
    emit(evt, data) {
      for (const cb of listeners.get(evt) || []) {
        try {
          cb(data);
        } catch (e) {
          console.error(`[store] ${evt} listener failed`, e);
        }
      }
    },

    // A shared design opened from a link is read only: every change is refused until the person makes their own copy.
    readOnly: false,

    // Autosave can be switched off (a read only shared design must not overwrite the design saved in this browser).
    setAutosave(on) {
      autosaveOn = !!on;
      if (!autosaveOn) clearTimeout(saveTimer);
    },

    // Mutate the project with fn(project). One undo step. Restores on error and rethrows.
    apply(label, fn) {
      if (store.readOnly) {
        const err = new Error('This is a shared design and it is read only. Use "Copy this design" or "Make your own" to change it.');
        err.name = 'ReadOnlyError';
        throw err;
      }
      const before = cloneProject(store.project);
      let result;
      try {
        result = fn(store.project);
      } catch (e) {
        store.project = before;
        throw e;
      }
      undoStack.push({ label, snapshot: before });
      if (undoStack.length > limit) { undoStack.shift(); if (floor > 0) floor -= 1; }
      redoStack.length = 0;
      store.project.updatedAt = new Date().toISOString();
      changed(label);
      return result;
    },

    // Run one registry operation as an undo step.
    run(name, args = {}) {
      return store.apply(OPS[name]?.label || name, (p) => applyOp(p, name, args, ctx()));
    },

    // Run several operations as one undo step. Failed steps are reported, not thrown.
    runBatch(label, steps) {
      return store.apply(label, (p) =>
        steps.map((s) => {
          try {
            return { ok: true, op: s.op, result: applyOp(p, s.op, s.args || {}, ctx()) };
          } catch (e) {
            if (e.name === 'OpError') return { ok: false, op: s.op, error: e.message };
            throw e;
          }
        }),
      );
    },

    // Nothing below the floor can be undone. The app sets it when a lot is loaded, so undo can never take the lot away.
    setUndoFloor() {
      floor = undoStack.length;
      store.emit('history', { canUndo: store.canUndo(), canRedo: store.canRedo() });
    },
    undoFloor: () => floor,

    undo() {
      if (undoStack.length <= floor) return false;
      const e = undoStack.pop();
      if (!e) return false;
      redoStack.push({ label: e.label, snapshot: cloneProject(store.project) });
      store.project = e.snapshot;
      changed(`Undo ${e.label}`);
      return true;
    },
    redo() {
      const e = redoStack.pop();
      if (!e) return false;
      undoStack.push({ label: e.label, snapshot: cloneProject(store.project) });
      store.project = e.snapshot;
      changed(`Redo ${e.label}`);
      return true;
    },
    canUndo: () => undoStack.length > floor,
    canRedo: () => redoStack.length > 0,
    undoLabel: () => (undoStack.length > floor ? undoStack.at(-1)?.label || null : null),
    redoLabel: () => redoStack.at(-1)?.label || null,

    replace(next) {
      store.project = migrate(next);
      undoStack.length = 0;
      floor = 0;
      redoStack.length = 0;
      store.ui.selection = null;
      store.ui.activeLevelId = store.project.levels[0].id;
      changed('Open project');
    },

    setUI(patch) {
      Object.assign(store.ui, patch);
      store.emit('ui', patch);
    },
    select(id) {
      store.ui.selection = id || null;
      store.emit('selection', store.ui.selection);
    },
    level(id = store.ui.activeLevelId) {
      return store.project.levels.find((l) => l.id === id) || store.project.levels[0];
    },
    find(id) {
      return findEntity(store.project, id);
    },
    opContext: ctx,
    saveNow,
    tabId,
    get autosaveStale() { return stale; },
    /** The person chose to keep editing in this tab: its design replaces the stored one from the next save. */
    keepEditing() {
      if (!stale) return;
      stale = false;
      if (hasStorage()) knownV = readMeta().v;
      store.emit('autosave-resolved', {});
      scheduleSave();
    },
  };
  if (hasStorage() && typeof window !== 'undefined' && window.addEventListener) {
    window.addEventListener('storage', (e) => {
      if (e.key !== opts.autosaveKey && e.key !== metaKey) return;
      if (!autosaveOn) return;
      const m = readMeta();
      if (m.tab && m.tab !== tabId && m.v > knownV) markStale();
    });
  }

  store.ui.activeLevelId = store.project.levels[0].id;

  function ctx() {
    return { activeLevelId: store.ui.activeLevelId, ...(opts.opContext || {}) };
  }

  function changed(label) {
    if (!store.project.levels.some((l) => l.id === store.ui.activeLevelId)) store.ui.activeLevelId = store.project.levels[0].id;
    if (store.ui.selection && !findEntity(store.project, store.ui.selection)) store.ui.selection = null;
    store.emit('project', { label });
    store.emit('history', { canUndo: store.canUndo(), canRedo: store.canRedo() });
    scheduleSave();
  }

  function scheduleSave() {
    if (!autosaveOn || !opts.autosaveKey || typeof localStorage === 'undefined') return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveNow, 1000);
  }

  function saveNow() {
    if (!autosaveOn || !opts.autosaveKey || typeof localStorage === 'undefined') return;
    if (hasStorage()) {
      const m = readMeta();
      if (m.tab && m.tab !== tabId && m.v > knownV) { markStale(); return; } // a newer save from another tab: wait for the person's choice
    }
    try {
      const v = Math.max(knownV, hasStorage() ? readMeta().v : 0) + 1;
      localStorage.setItem(opts.autosaveKey, JSON.stringify(store.project));
      if (hasStorage()) { localStorage.setItem(metaKey, JSON.stringify({ tab: tabId, v })); knownV = v; }
      store.emit('saved', { at: Date.now() });
    } catch (e) {
      store.emit('autosave-error', e);
    }
  }

  return store;
}

export function loadAutosave(key) {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(key) : null;
    return raw ? migrate(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}
