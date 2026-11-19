// The design name box in the top bar: wide enough for the name (up to a limit), never so wide that the bar wraps to a second row.
export const NAME_MIN_PX = 100;
export const NAME_MAX_PX = 260;
const NAME_PAD_PX = 26; // the input's own padding and border

/** The box width for a name whose text is textPx wide: the text and padding, kept between the minimum and maximum. */
export const nameBoxWidth = (textPx, { min = NAME_MIN_PX, max = NAME_MAX_PX } = {}) => Math.max(min, Math.min(max, Math.ceil((Number.isFinite(textPx) ? textPx : 0) + NAME_PAD_PX)));

/** Sizes the input to its text, then steps it back until the top bar is as tall as it was at the minimum width (i.e. it did not wrap). The full name is always the tooltip. */
export function fitNameBox(input, bar) {
  if (!input || typeof document === 'undefined') return;
  input.title = input.value;
  if (typeof window === 'undefined' || window.innerWidth <= 900 || !input.offsetParent || !bar) return;
  let textPx = input.value.length * 8;
  try {
    const cs = getComputedStyle(input);
    const c = (fitNameBox.canvas ||= document.createElement('canvas')).getContext('2d');
    if (c) { c.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`; textPx = c.measureText(input.value).width; }
  } catch { /* the estimate stands */ }
  const want = nameBoxWidth(textPx);
  input.style.width = `${NAME_MIN_PX}px`;
  const rowH = bar.offsetHeight;
  let w = want;
  input.style.width = `${w}px`;
  while (w > NAME_MIN_PX && bar.offsetHeight > rowH + 2) { w = Math.max(NAME_MIN_PX, w - 20); input.style.width = `${w}px`; }
}
