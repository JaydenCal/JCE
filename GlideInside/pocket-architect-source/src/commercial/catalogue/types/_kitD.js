// Helpers shared by the batch D types (sheds, industrial sheds, attached housing, business parks, mixed use). Pure, no DOM.
import { NUM, SEL, rect, symPoly, symLine, symText } from './_kit.js';

export const DOOR_POS = [
  { value: 'centre', label: 'Centred' },
  { value: 'left', label: 'To the left' },
  { value: 'right', label: 'To the right' },
  { value: 'spread', label: 'Spread evenly' },
];

/** Offsets (mm along a wall of length len) of n doors of width dw: centred, to one end, or spread evenly. */
export function doorOffsets(n, len, dw, pos = 'spread', margin = 600) {
  const out = [];
  if (n <= 0) return out;
  const gap = 300;
  const run = n * dw + (n - 1) * gap;
  if (pos === 'spread') {
    const slot = (len - 2 * margin) / n;
    for (let i = 0; i < n; i++) out.push(Math.max(margin, Math.round((margin + slot * i + (slot - dw) / 2) / 50) * 50));
    return out;
  }
  const start = pos === 'left' ? margin : pos === 'right' ? len - margin - run : (len - run) / 2;
  for (let i = 0; i < n; i++) out.push(Math.max(100, Math.round((start + i * (dw + gap)) / 50) * 50));
  return out;
}

/** How many doors of width dw fit along len, so a parameter never asks for overlapping doors. */
export const fitDoors = (n, len, dw, margin = 600) => Math.max(0, Math.min(n, Math.floor((len - 2 * margin + 300) / (dw + 300))));

/** The door parameters shared by sheds: count, width, height, position. */
export const doorParams = (count, w, h, maxCount = 6) => [
  NUM('doorCount', 'Roller doors in the front wall', '', 0, maxCount, 1, count),
  NUM('doorW', 'Roller door width', 'mm', 2400, 6000, 100, w),
  NUM('doorH', 'Roller door height', 'mm', 2100, 5000, 100, h),
  SEL('doorPos', 'Door positions', DOOR_POS, 'centre'),
];

/** Plan symbols common to the shed types: outline, label, front mark and bay lines. */
export const planSymbols = (W, D, label, extra = []) => [
  symPoly(rect(0, 0, W, D), '#555', 'rgba(120,120,120,0.10)'),
  symText({ x: W * 0.1, y: D / 2 }, label),
  symLine([{ x: W / 2, y: -1500 }, { x: W / 2, y: 500 }], '#c33', { lw: 2 }),
  ...extra,
];

/** Site block for types that need no customer parking. */
export const noParkingSite = (notes, { design = 'B99', apron = 0, landscape = 1500 } = {}) => () => ({
  parking: { ratePerM2: [], accessible: false },
  vehicles: { design, apronDepthMm: apron, docks: 0 },
  landscapeFrontMm: landscape,
  notes,
});
