// The four ways to look at a design and how the app remembers them. Pure helpers (no DOM), so they are unit tested.
//   2d     plan only
//   split  plan on the left, live 3D on the right (stacked on narrow screens)
//   3d     orbit view
//   walk   first person walk through

export const VIEWS = [['2d', 'Plan'], ['split', 'Split'], ['3d', '3D'], ['walk', 'Walk']];
export const VIEW_IDS = VIEWS.map(([id]) => id);
export const LAST_VIEW_KEY = 'ps.view.last';
export const SPLIT_FRAC_KEY = 'ps.split.frac';

export const isView = (v) => VIEW_IDS.includes(v);
/** The plan editor is on screen (and takes tools and keys). */
export const hasPlan = (v) => v === '2d' || v === 'split';
/** The 3D viewer is on screen. */
export const has3d = (v) => v === '3d' || v === 'walk' || v === 'split';
/** A view that has a way back to the plan (Back to plan button, Escape). */
export const canReturnToPlan = (v) => v === '3d' || v === 'walk' || v === 'split';

export const normalizeView = (v, fallback = '2d') => (isView(v) ? v : fallback);

/** Split position limits: the fraction of the stage the plan takes. */
export const SPLIT_MIN = 0.25;
export const SPLIT_MAX = 0.75;
export const SPLIT_DEFAULT = 0.5;
export const clampSplit = (f) => (Number.isFinite(f) ? Math.min(SPLIT_MAX, Math.max(SPLIT_MIN, f)) : SPLIT_DEFAULT);

/** Divider drag: pointer position within the stage rectangle -> plan fraction. vertical true when the panes are stacked. */
export function splitFromPointer(rect, x, y, vertical) {
  const f = vertical ? (y - rect.top) / Math.max(1, rect.height) : (x - rect.left) / Math.max(1, rect.width);
  return clampSplit(f);
}

/** Storage key for the remembered view: one per signed in user, else one shared by the browser. */
export const lastViewKey = (userId) => (userId ? `${LAST_VIEW_KEY}.${String(userId).replace(/[^\w.-]/g, '_').slice(0, 64)}` : LAST_VIEW_KEY);

/** Walk is never restored (it needs a click to capture the pointer); a remembered walk comes back as 3D. */
export const restorableView = (v) => (v === 'walk' ? '3d' : normalizeView(v, '2d'));

export function readLastView(storage, userId = null) {
  try {
    const raw = storage?.getItem(lastViewKey(userId));
    return raw && isView(raw) ? restorableView(raw) : null;
  } catch {
    return null;
  }
}

export function writeLastView(storage, view, userId = null) {
  try {
    if (isView(view)) storage?.setItem(lastViewKey(userId), view);
    return true;
  } catch {
    return false;
  }
}

export function readSplit(storage) {
  try {
    const v = parseFloat(storage?.getItem(SPLIT_FRAC_KEY));
    return Number.isFinite(v) ? clampSplit(v) : SPLIT_DEFAULT;
  } catch {
    return SPLIT_DEFAULT;
  }
}

export function writeSplit(storage, f) {
  try {
    storage?.setItem(SPLIT_FRAC_KEY, String(clampSplit(f)));
    return true;
  } catch {
    return false;
  }
}

/**
 * Which view to open with. An explicit ?view= wins, then a phone defaults to 3D, then the remembered view (not in the embedded demo,
 * which always starts on the plan).
 */
export function startView({ param, phone = false, remembered = null, demo = false }) {
  if (isView(param)) return param;
  if (phone) return '3d';
  if (demo) return '2d';
  return remembered && isView(remembered) ? remembered : '2d';
}

/**
 * Escape returns to the plan from 3D and split, but not while a tool, a selection, an edit or a modal still needs the key.
 * In walk the walk controller owns Escape (it returns to 3D); Escape again then reaches the plan.
 */
export function escapeLeavesView({ view, tool = 'select', selection = null, editing = false, modalOpen = false, typing = false, defaultPrevented = false }) {
  if (defaultPrevented || modalOpen || typing || editing) return false;
  if (view !== '3d' && view !== 'split') return false;
  return tool === 'select' && !selection;
}
