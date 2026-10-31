// Project store: single source of truth, snapshot undo and redo, autosave.
// Always read store.project fresh; undo replaces the object.

import { migrate } from './schema.js';
import { applyOp, findEntity, OPS } from './ops.js';

export function createStore(project, opts = {}) {
  const listeners = new Map();
  const undoStack = [];
  const redoStack = [];
  const limit = opts.historyLimit ?? 100;
  let saveTimer = null;

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

    // Mutate the project with fn(project). One undo step. Restores on error and rethrows.
    apply(label, fn) {
      const before = structuredClone(store.project);
      let result;
      try {
        result = fn(store.project);
      } catch (e) {
        store.project = before;
        throw e;
      }
      undoStack.push({ label, snapshot: before });
      if (undoStack.length > limit) undoStack.shift();
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

    undo() {
      const e = undoStack.pop();
      if (!e) return false;
      redoStack.push({ label: e.label, snapshot: structuredClone(store.project) });
      store.project = e.snapshot;
      changed(`Undo ${e.label}`);
      return true;
    },
    redo() {
      const e = redoStack.pop();
      if (!e) return false;
      undoStack.push({ label: e.label, snapshot: structuredClone(store.project) });
      store.project = e.snapshot;
      changed(`Redo ${e.label}`);
      return true;
    },
    canUndo: () => undoStack.length > 0,
    canRedo: () => redoStack.length > 0,
    undoLabel: () => undoStack.at(-1)?.label || null,
    redoLabel: () => redoStack.at(-1)?.label || null,

    replace(next) {
      store.project = migrate(next);
      undoStack.length = 0;
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
  };

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
    if (!opts.autosaveKey || typeof localStorage === 'undefined') return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveNow, 1000);
  }

  function saveNow() {
    if (!opts.autosaveKey || typeof localStorage === 'undefined') return;
    try {
      localStorage.setItem(opts.autosaveKey, JSON.stringify(store.project));
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
