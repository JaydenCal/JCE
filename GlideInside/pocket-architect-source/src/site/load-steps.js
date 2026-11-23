// The steps of loading a lot ("Find my block") and a small tracker that turns the real onStep events into a progress state. Pure data and
// logic (no DOM), shared by the embed viewer, the guided flow, the editor's Find my block and the home page protocol (gi:status "step").

export const LOAD_STEPS = [
  { id: 'address', label: 'Finding the address' },
  { id: 'lot', label: 'Loading the lot boundary' },
  { id: 'aerial', label: 'Aerial photo' },
  { id: 'contours', label: 'Contours' },
  { id: 'setbacks', label: 'Setbacks' },
  { id: 'place', label: 'Placing the home' },
];
export const DONE_LABEL = 'Done';
/** The first step the tracker reports once it has started (the address search; a chosen suggestion starts at the lot). */
export const BUSY_LABEL = 'Busy, trying again';

/** Where progress stops short of the end until the load is really done. */
const CEILING = 0.96;

/**
 * createLoadTracker({ labels, onChange }) -> { start, step, busy, done, fail, state }.
 * state: { status: 'idle' | 'running' | 'done' | 'error', index, total, label, fraction, message, retrying }.
 * index is the number of the step in progress (0 based); steps before it are complete. fraction is index / total while running (never above
 * 0.96), 1 only when done. step(id) never moves backwards, so a late or repeated event cannot make the bar run back.
 */
export function createLoadTracker({ steps = LOAD_STEPS, labels = {}, onChange = null } = {}) {
  const total = steps.length;
  const labelOf = (s) => labels[s.id] || s.label;
  const state = { status: 'idle', index: 0, total, label: '', fraction: 0, message: '', retrying: false };
  const subs = new Set();
  const emit = () => {
    const snap = { ...state };
    try { onChange?.(snap); } catch { /* a painting error never stops the load */ }
    for (const f of subs) { try { f(snap); } catch { /* same */ } }
  };
  const at = (i) => {
    state.index = i;
    state.label = labelOf(steps[i]);
    state.fraction = Math.min(CEILING, i / total);
  };
  const api = {
    state,
    /** Call fn with the current state now and on every change. Returns the unsubscribe function. */
    subscribe(fn) { subs.add(fn); try { fn({ ...state }); } catch { /* ignore */ } return () => subs.delete(fn); },
    /** Begin at a step (default the first). */
    start(id = steps[0].id) {
      const i = Math.max(0, steps.findIndex((s) => s.id === id));
      state.status = 'running'; state.message = ''; state.retrying = false;
      at(i);
      emit();
    },
    /** A step has begun (the steps before it are complete). Unknown ids are ignored; 'busy' marks a quiet retry without moving. */
    step(id) {
      if (state.status === 'idle') api.start(steps[0].id);
      if (state.status !== 'running') return;
      if (id === 'busy') { state.retrying = true; state.label = BUSY_LABEL; emit(); return; }
      const i = steps.findIndex((s) => s.id === id);
      if (i < 0) return;
      state.retrying = false;
      if (i >= state.index) at(i);
      else state.label = labelOf(steps[state.index]);
      emit();
    },
    done() {
      if (state.status === 'error') return;
      state.status = 'done'; state.index = total; state.label = DONE_LABEL; state.fraction = 1; state.retrying = false;
      emit();
    },
    fail(message = '') {
      if (state.status === 'done') return;
      state.status = 'error'; state.message = String(message || ''); state.retrying = false;
      emit();
    },
    reset() {
      state.status = 'idle'; state.index = 0; state.label = ''; state.fraction = 0; state.message = ''; state.retrying = false;
      emit();
    },
  };
  return api;
}

/** The gi:status message for a tracker state (the home page reads it). `address` is passed through. */
export function statusMessage(state, address) {
  return { type: 'gi:status', state: 'step', step: Math.min(state.index, state.total - 1) + 1, total: state.total, label: state.label, ...(address ? { address } : {}) };
}

/** The most a lookup may take from start to finish before the caller stops waiting and says so (with a retry), so nothing spins forever. */
export const RUN_TIMEOUT_MS = 45000;
export const TOO_LONG_TEXT = 'This block is taking too long to load. Try again, or try a nearby address.';

/**
 * withDeadline(work, ms, { onTimeout }) -> Promise. Settles as `work` does, or rejects with a SLOW error (TOO_LONG_TEXT, timedOut true) after
 * ms. onTimeout() runs first so the caller can abort what is still in flight. A work that finishes later has nothing left to report.
 */
export function withDeadline(work, ms = RUN_TIMEOUT_MS, { onTimeout = null } = {}) {
  let timer = 0;
  Promise.resolve(work).catch(() => {});
  const limit = new Promise((_, reject) => {
    timer = setTimeout(() => { try { onTimeout?.(); } catch { /* ignore */ } reject(Object.assign(new Error(TOO_LONG_TEXT), { code: 'SLOW', timedOut: true })); }, ms);
  });
  return Promise.race([work, limit]).finally(() => clearTimeout(timer));
}
