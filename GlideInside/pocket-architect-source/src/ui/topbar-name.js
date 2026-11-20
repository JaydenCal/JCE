// The design name box in the top bar: wide enough for the name (up to a limit), never so wide that the bar wraps to a second row.
export const NAME_MIN_PX = 100;
export const NAME_MAX_PX = 260;
/** From 1280 px wide the name keeps at least this much room (the bar collapses lower priority buttons into More first). */
export const NAME_WIDE_MIN_PX = 180;
export const nameMinFor = (width) => (Number.isFinite(width) && width >= 1280 ? NAME_WIDE_MIN_PX : NAME_MIN_PX);
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
  const min = nameMinFor(window.innerWidth);
  const want = nameBoxWidth(textPx, { min });
  input.style.width = `${min}px`;
  const rowH = bar.offsetHeight;
  let w = want;
  input.style.width = `${w}px`;
  while (w > min && bar.offsetHeight > rowH + 2) { w = Math.max(min, w - 20); input.style.width = `${w}px`; }
}
