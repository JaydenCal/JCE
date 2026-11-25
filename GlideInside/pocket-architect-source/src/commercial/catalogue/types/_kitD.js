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

/**
 * Roller doors of one wall with their own size and place (sheds). Door 1 uses doorW x doorH; doors 2 to 4 use doorNW x doorNH, where 0 means "as door 1".
 * doorX, door2X ... are the left edge of a door along the wall in mm (0 = automatic). Doors side by side are separated by a mullion (mullionMm), a
 * spread run by even slots. Returns [{ mark: 'RD1', offset (left edge), width, height }] sorted left to right; doors that do not fit the wall are dropped.
 */
export function rollerDoors(p, W, { margin = 600, maxHeight = 5000 } = {}) {
  const want = Math.max(0, Math.round(p.doorCount || 0));
  const mull = Number.isFinite(p.mullionMm) ? p.mullionMm : 300;
  const size = (i) => {
    const w = i === 0 ? p.doorW : p[`door${i + 1}W`] || p.doorW;
    const h = i === 0 ? p.doorH : p[`door${i + 1}H`] || p.doorH;
    return { w: Math.min(Math.round(w), W - 2 * margin), h: Math.min(Math.round(h), maxHeight) };
  };
  const sizes = Array.from({ length: want }, (_, i) => size(i));
  let n = want;
  const run = (k) => sizes.slice(0, k).reduce((a, s) => a + s.w, 0) + Math.max(0, k - 1) * mull;
  while (n > 1 && run(n) > W - 2 * margin) n -= 1;
  if (n <= 0) return [];
  const used = sizes.slice(0, n);
  const out = [];
  if (p.doorPos === 'spread') {
    const slot = (W - 2 * margin) / n;
    used.forEach((s, i) => out.push({ offset: Math.max(margin, Math.round((margin + slot * i + (slot - s.w) / 2) / 10) * 10) }));
  } else {
    const total = run(n);
    let x = p.doorPos === 'left' ? margin : p.doorPos === 'right' ? W - margin - total : (W - total) / 2;
    used.forEach((s, i) => { out.push({ offset: Math.round(x / 1) }); x += s.w + mull; });
  }
  return used.map((s, i) => {
    const key = i === 0 ? 'doorX' : `door${i + 1}X`;
    const fixed = Number(p[key]) > 0 ? Number(p[key]) : null;
    const offset = Math.max(100, Math.min(W - s.w - 100, fixed ?? out[i].offset));
    return { mark: `RD${i + 1}`, offset, width: s.w, height: s.h };
  }).sort((a, b) => a.offset - b.offset);
}

/** The extra door parameters of a shed with per door sizes and places (see rollerDoors). */
export const perDoorParams = (maxCount = 4) => {
  const list = [NUM('doorX', 'Door 1 position from the left', 'mm', 0, 60000, 10, 0)];
  for (let i = 2; i <= maxCount; i++) {
    list.push(NUM(`door${i}W`, `Door ${i} width (0 = as door 1)`, 'mm', 0, 6000, 1, 0), NUM(`door${i}H`, `Door ${i} height (0 = as door 1)`, 'mm', 0, 5000, 1, 0), NUM(`door${i}X`, `Door ${i} position from the left (0 = automatic)`, 'mm', 0, 60000, 10, 0));
  }
  list.push(NUM('mullionMm', 'Mullion between doors side by side', 'mm', 100, 3000, 1, 589));
  return list;
};

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
