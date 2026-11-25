// The status bar help line for a phone: short, in touch words, never cut off. The desktop line stays as it is.
export const MOVE_HINT = 'Drag to move. Twist with two fingers to turn.';
const KEYS = /\b(shift|ctrl|cmd|alt|esc|escape|enter|arrow|keys?|hover|right[- ]click|scroll|wheel|press|hold|space|delete|backspace|tab)\b|\([A-Z]\)/i;
const touchWords = (s) => s.replace(/\bdouble[- ]click(s|ing)?\b/gi, (m) => (m[0] === 'D' ? 'Double tap' : 'double tap')).replace(/\bClick(ing)?\b/g, (m, i) => (i ? 'Tapping' : 'Tap')).replace(/\bclick(ing)?\b/g, (m, i) => (i ? 'tapping' : 'tap')).replace(/\bmouse\b/gi, 'finger');

// When every sentence of a tool's hint is about keys (e.g. "hold Q for the inventory wheel"), this touch line stands in for it.
export const TOUCH_HINTS = {
  select: 'Tap a piece, then drag it to move it.',
  rotate: 'Tap an item, then drag round it or twist with two fingers to turn it.',
  room: 'Drag a rectangle to draw a room.',
  wall: 'Tap each corner in turn. Double tap to finish.',
  door: 'Tap a wall to place it.', sliding_door: 'Tap a wall to place it.', garage_door: 'Tap a wall to place it.', roller_door: 'Tap a wall to place it.', opening: 'Tap a wall to place it.', window: 'Tap a wall to place it.',
  furniture: 'Pick an item from the furniture drawer, then tap the plan to place it.',
  stairs: 'Drag a rectangle where the stairs should go.',
  deck: 'Drag a rectangle for the deck or patio.',
  tank: 'Tap the plan to place a tank.',
  measure: 'Tap two points to read the distance.',
  underlay: 'Tap two known points to set the scale.',
  status: 'Tap walls or rooms to mark them.',
};

/** The hint to show on a phone for the tool's full (keyboard and mouse) hint. */
export function phoneHint(text, tool) {
  const full = String(text || '').trim();
  if (!full) return '';
  if (tool === 'movehouse') return MOVE_HINT;
  const sentences = full.split(/(?<=[.!?])\s+/).filter(Boolean);
  const clean = sentences.filter((s) => !KEYS.test(s));
  const pick = (clean.length ? clean : sentences).slice(0, 2);
  let out = touchWords(pick.join(' ')).trim();
  if (out.length > 90 && pick.length > 1) out = touchWords(pick[0]).trim();
  if (tool && TOUCH_HINTS[tool] && KEYS.test(out)) return TOUCH_HINTS[tool];
  return out;
}

export const HINT_MS = 3000;
export const HINT_KEY = 'ps.phone3d.hinted';

/**
 * A hint that shows once and hides itself after 3 seconds (the phone editor 3D view, owner 25/11/2026). Returns the element, or null when it
 * has been shown before (or storage says so). `storage` is localStorage; a blocked storage shows it once per page load.
 */
let shownThisLoad = false;
export function showHintOnce({ host, text = MOVE_HINT, ms = HINT_MS, storage = globalThis.localStorage, doc = globalThis.document } = {}) {
  if (!host || !doc) return null;
  let remembered = null; // true when storage says it was shown, null when storage cannot say
  try { remembered = storage?.getItem(HINT_KEY) === '1'; } catch { remembered = null; }
  if (remembered === true || (remembered === null && shownThisLoad)) return null;
  shownThisLoad = true;
  try { storage?.setItem(HINT_KEY, '1'); } catch { /* not remembered: once per page load */ }
  const el = doc.createElement('div');
  el.className = 'ps-phone-hint';
  el.dataset.ps = 'phone-hint';
  el.setAttribute('role', 'status');
  el.textContent = text;
  host.append(el);
  requestAnimationFrame?.(() => el.classList.add('is-on'));
  setTimeout(() => { el.classList.remove('is-on'); setTimeout(() => el.remove(), 300); }, ms);
  return el;
}
export const resetHintOnce = () => { shownThisLoad = false; };
