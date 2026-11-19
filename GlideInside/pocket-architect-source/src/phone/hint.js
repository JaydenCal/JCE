// The status bar help line for a phone: short, in touch words, never cut off. The desktop line stays as it is.
export const MOVE_HINT = 'Drag to move. Twist with two fingers to turn.';
const KEYS = /\b(shift|ctrl|cmd|alt|esc|escape|enter|arrow|keys?|hover|right[- ]click|scroll|wheel|press|hold|space|delete|backspace|tab)\b|\([A-Z]\)/i;
const touchWords = (s) => s.replace(/\bdouble[- ]click(s|ing)?\b/gi, (m) => (m[0] === 'D' ? 'Double tap' : 'double tap')).replace(/\bClick(ing)?\b/g, (m, i) => (i ? 'Tapping' : 'Tap')).replace(/\bclick(ing)?\b/g, (m, i) => (i ? 'tapping' : 'tap')).replace(/\bmouse\b/gi, 'finger');

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
  return out;
}
