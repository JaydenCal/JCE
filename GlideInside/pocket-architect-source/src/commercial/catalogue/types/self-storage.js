// Self storage: rows of lockups either side of covered internal drive aisles, roller door per lockup, an office and reception wing with
// a secure gate, optional second storey (gallery access, lift and stair core) and an optional climate controlled block at one end.
// Layout across the depth (y): office wing in front at the left, then per aisle [row][aisle][row], pairs back to back. Local plan mm.

import { Plan, num, sel, bool, makeType, mm, rectPoly, M } from './_kitB.js';

const MIX = {
  compact: [1.5, 1.5, 3, 1.5, 3], // 1.5 x 1.5 up to 3 m wide
  standard: [3, 3, 4.5, 1.5, 3, 6],
  large: [6, 3, 4.5, 6, 3],
};
const MIX_LABEL = { compact: 'Compact (1.5 to 3 m wide)', standard: 'Standard mix (1.5 to 6 m wide)', large: 'Large (3 to 6 m wide)' };
export const SIZES_NOTE = 'Lockup sizes run from 1.5 x 1.5 m to 6 x 3 m (width x depth), depth set by the row depth';

export const PARAMS = [
  num('lengthM', 'Building length', 'm', 20, 120, 1.5, 48),
  sel('lockupDepthM', 'Lockup row depth', [1.5, 3, 4.5, 6], 3),
  sel('lockupMix', 'Lockup size mix', Object.keys(MIX).map((k) => ({ value: k, label: MIX_LABEL[k] })), 'standard'),
  num('aislesCount', 'Internal drive aisles', 'no.', 1, 3, 1, 1),
  num('aisleWidthM', 'Drive aisle width', 'm', 6, 7, 0.5, 6.5),
  sel('storeys', 'Storeys', [{ value: 1, label: 'Single storey' }, { value: 2, label: 'Two storey with lift' }], 1),
  bool('climateBlock', 'Climate controlled block', false),
  num('climateBlockLengthM', 'Climate controlled block length', 'm', 6, 40, 1.5, 12),
  num('officeAreaM2', 'Office and reception area', 'm2', 20, 80, 2, 36),
  bool('secureGate', 'Secure entry gate', true),
  num('eaveHeightM', 'Eave height per storey', 'm', 2.7, 3.6, 0.1, 3.2),
  num('roofPitchDeg', 'Roof pitch', 'deg', 2, 10, 0.5, 3),
];

const OFFICE_W = mm(6);

// Widths (mm) filling [0, L] exactly from the mix; the last lockup takes the remainder (a remainder under 1.5 m joins the previous one).
export function fillWidths(L, mix, start = 0) {
  const pat = MIX[mix] || MIX.standard;
  const out = [];
  let x = start;
  let i = 0;
  while (L - x > 1e-6) {
    const w = mm(pat[i++ % pat.length]);
    const rest = L - x;
    if (w >= rest - mm(1.5) + 1e-6) { // this one would leave under 1.5 m: take the rest
      if (rest >= mm(1.5)) out.push(rest); else if (out.length) out[out.length - 1] += rest; else out.push(rest);
      break;
    }
    out.push(w);
    x += w;
  }
  return out;
}

function build(p) {
  const pl = new Plan();
  const L = mm(p.lengthM);
  const rd = mm(p.lockupDepthM);
  const aw = mm(p.aisleWidthM);
  const A = p.aislesCount;
  const two = Number(p.storeys) === 2;
  const od = Math.round(mm(p.officeAreaM2 / (OFFICE_W / M)) / 100) * 100; // office wing depth
  const D = A * (2 * rd + aw);
  const y0 = od;
  const eave = mm(p.eaveHeightM);
  const clL = p.climateBlock ? Math.min(mm(p.climateBlockLengthM), L - mm(12)) : 0;
  const xc = L - clL; // climate block starts here
  const hasClimate = clL >= mm(6);
  const slab = 300;
  const levels = two ? ['Ground', 'Level 1'] : ['Ground'];
  pl.levels[0].heightMm = eave;
  if (two) pl.level('Level 1', eave + slab, eave);
  const totalH = two ? eave * 2 + slab : eave;

  pl.outline = [{ x: 0, y: 0 }, { x: OFFICE_W, y: 0 }, { x: OFFICE_W, y: y0 }, { x: L, y: y0 }, { x: L, y: y0 + D }, { x: 0, y: y0 + D }];
  // Walls: office wing and the main block share the wall at y0 for x in [0, OFFICE_W].
  pl.wall({ x: 0, y: 0 }, { x: OFFICE_W, y: 0 }, { out: { x: 0, y: -1 }, height: eave });
  pl.wall({ x: OFFICE_W, y: 0 }, { x: OFFICE_W, y: y0 }, { out: { x: 1, y: 0 }, height: eave });
  const wing = { left: pl.wall({ x: 0, y: y0 }, { x: 0, y: 0 }, { out: { x: -1, y: 0 }, height: eave }) };
  const front = pl.wall({ x: OFFICE_W, y: y0 }, { x: L, y: y0 }, { out: { x: 0, y: -1 }, height: totalH });
  const right = pl.wall({ x: L, y: y0 }, { x: L, y: y0 + D }, { out: { x: 1, y: 0 }, height: totalH });
  const back = pl.wall({ x: L, y: y0 + D }, { x: 0, y: y0 + D }, { out: { x: 0, y: 1 }, height: totalH });
  const left = pl.wall({ x: 0, y: y0 + D }, { x: 0, y: y0 }, { out: { x: -1, y: 0 }, height: totalH });
  // The office wall between the wing and the first lockup row is interior.
  pl.wall({ x: 0, y: y0 }, { x: OFFICE_W, y: y0 }, { kind: 'interior', thickness: 150, height: eave });

  // Office and reception.
  pl.room('PROPOSED SELF STORAGE OFFICE AND RECEPTION', 'other', rectPoly(0, 0, OFFICE_W, y0), { use: 'office' });
  pl.openAt(wing.left, 0, y0 / 2, 'window', Math.min(2400, y0 - 600), 1500, 900, { style: 'fixed' });
  const frontWing = pl.walls[0];
  pl.openAt(frontWing, 1400, 0, 'door', 1800, 2100, 0);
  pl.openAt(frontWing, 4000, 0, 'window', 2400, 2100, 300, { style: 'fixed' });

  // Aisles, rows, lockups.
  let n = 0;
  const lockups = [];
  const aisles = [];
  for (let a = 0; a < A; a++) {
    const ya = y0 + a * (2 * rd + aw);
    const rows = [{ y0: ya, y1: ya + rd, face: ya + rd, faceOut: 1 }, { y0: ya + rd + aw, y1: ya + 2 * rd + aw, face: ya + rd + aw, faceOut: -1 }];
    aisles.push({ y0: ya + rd, y1: ya + rd + aw });
    rows.forEach((row, ri) => {
      const coreHere = two && a === 0 && ri === 0;
      const start = coreHere ? mm(3) : 0;
      const ws = hasClimate
        ? [...fillWidths(xc, p.lockupMix, start), ...fillWidths(L, p.lockupMix, xc)]
        : fillWidths(L, p.lockupMix, start);
      let x = start;
      if (coreHere) lockups.push({ core: true, x0: 0, x1: start, row });
      for (const w of ws) {
        n += 1;
        lockups.push({ n, x0: x, x1: x + w, row, climate: hasClimate && x >= xc - 1 });
        x += w;
      }
    });
  }
  // Interior wall lines: row faces (with the doors), the party wall between pairs, and the lockup partitions.
  for (const lvl of levels) {
    for (let a = 0; a < A; a++) {
      const ya = y0 + a * (2 * rd + aw);
      const faceTop = pl.wall({ x: 0, y: ya + rd }, { x: L, y: ya + rd }, { kind: 'interior', thickness: 150, level: lvl, height: eave });
      const faceBot = pl.wall({ x: 0, y: ya + rd + aw }, { x: L, y: ya + rd + aw }, { kind: 'interior', thickness: 150, level: lvl, height: eave });
      faceTop.faceOf = faceBot.faceOf = lvl;
      if (a > 0) pl.wall({ x: 0, y: ya }, { x: L, y: ya }, { kind: 'interior', thickness: 200, level: lvl, height: eave });
      // Lockup doors and partitions for this aisle's two rows.
      for (const k of lockups) {
        const rowA = k.row.y0 >= ya && k.row.y1 <= ya + 2 * rd + aw;
        if (!rowA) continue;
        const top = k.row.faceOut === 1;
        const wallRef = top ? faceTop : faceBot;
        const cx = (k.x0 + k.x1) / 2;
        const faceY = top ? ya + rd : ya + rd + aw;
        if (!k.core) {
          const dw = Math.min(k.x1 - k.x0 - 300, 2400);
          if (k.climate) pl.openAt(wallRef, cx, faceY, 'door', Math.min(dw, 900), 2100, 0, { tag: 'lockup' });
          else pl.openAt(wallRef, cx, faceY, 'roller_door', dw, 2200, 0, { tag: 'lockup' });
        }
      }
      // Partitions (once per lockup edge).
      const edges = new Set();
      for (const k of lockups) if (k.row.y0 >= ya && k.row.y1 <= ya + 2 * rd + aw) { edges.add(`${k.row.y0}|${k.x0}`); edges.add(`${k.row.y0}|${k.x1}`); }
      for (const e of edges) {
        const [ry, ex] = e.split('|').map(Number);
        if (ex <= 0 || ex >= L) continue;
        const rowTop = ry === ya;
        const yA = rowTop ? ry : ry;
        pl.wall({ x: ex, y: yA }, { x: ex, y: yA + rd }, { kind: 'interior', thickness: 90, level: lvl, height: eave });
      }
    }
  }
  // Climate block partition across the full depth, with a door into each aisle corridor.
  if (hasClimate) {
    const part = pl.wall({ x: xc, y: y0 }, { x: xc, y: y0 + D }, { kind: 'interior', thickness: 200, height: eave });
    for (const ai of aisles) pl.openAt(part, xc, (ai.y0 + ai.y1) / 2, 'door', 1800, 2100, 0, { tag: 'climate' });
  }
  // Drive-in doors at the left end of each aisle and at the right end when there is no climate block.
  for (const ai of aisles) {
    const cy = (ai.y0 + ai.y1) / 2;
    pl.openAt(left, 0, cy, 'roller_door', 4500, 3500, 0, { tag: 'aisle' });
    if (!hasClimate) pl.openAt(right, L, cy, 'roller_door', 4500, 3500, 0, { tag: 'aisle' });
  }

  // Rooms.
  for (const lvl of levels) {
    for (const k of lockups) {
      const poly = rectPoly(k.x0, k.row.y0, k.x1, k.row.y1);
      if (k.core) { pl.room('LIFT AND STAIR CORE', 'hall', poly, { level: lvl, use: 'core' }); continue; }
      const w = ((k.x1 - k.x0) / M).toFixed(1);
      const d = ((k.row.y1 - k.row.y0) / M).toFixed(1);
      pl.room(`${k.climate ? 'CLIMATE CONTROLLED ' : ''}STORAGE UNIT ${k.n}${lvl === 'Level 1' ? ' L1' : ''} ${w} x ${d} m`, 'store', poly, { level: lvl, use: k.climate ? 'climateStorage' : 'storage' });
    }
  }
  for (const ai of aisles) {
    const xs = hasClimate ? [[0, xc, 'DRIVE AISLE'], [xc, L, 'CLIMATE CONTROLLED CORRIDOR']] : [[0, L, 'DRIVE AISLE']];
    for (const [a0, a1, nm] of xs) {
      if (two) { pl.room(`${nm} GALLERY`, 'hall', rectPoly(a0, ai.y0, a1, ai.y0 + 1500), { level: 'Level 1', use: 'circulation' }); pl.room(`${nm} GALLERY`, 'hall', rectPoly(a0, ai.y1 - 1500, a1, ai.y1), { level: 'Level 1', use: 'circulation' }); }
      pl.room(nm, 'other', rectPoly(a0, ai.y0, a1, ai.y1), { use: 'circulation' });
    }
  }
  // Roof: one skillion over the building, a small one over the office wing.
  pl.roof(rectPoly(0, 0, OFFICE_W, y0), 'skillion', p.roofPitchDeg);
  pl.roof(rectPoly(0, y0, L, y0 + D), 'skillion', p.roofPitchDeg, two ? 'Level 1' : 'Ground');

  // Extras and 3D.
  pl.extra('forecourt', rectPoly(OFFICE_W, 0, L, y0)); // the open forecourt beside the office wing, in front of the main block
  pl.extra('canopy', rectPoly(0, -2500, OFFICE_W, 0));
  pl.box('canopy', 0, -2500, OFFICE_W, 0, eave - 250, eave, 'roof', '#8a8f94');
  pl.box('sign', 600, 0, 5400, 120, eave - 1500, eave - 700, 'sign', '#d9d9d9');
  if (p.secureGate) {
    const gx = OFFICE_W + 3000;
    pl.box('gatePost', gx - 150, -4200, gx + 150, -3900, 0, 2200, 'steel', '#555a60');
    pl.box('gatePost', gx + 5700, -4200, gx + 6000, -3900, 0, 2200, 'steel', '#555a60');
    pl.box('gateLeaf', gx + 150, -4120, gx + 5700, -4000, 0, 1800, 'steel', '#7b8187'); // sliding leaf, closed
    pl.box('keypad', gx - 650, -4600, gx - 450, -4400, 0, 1200, 'steel', '#333a40');
    pl.sym({ t: 'line', pts: [{ x: gx, y: -4050 }, { x: gx + 6000, y: -4050 }], stroke: '#555', w: 80, dash: [200, 150] });
    pl.sym({ t: 'text', x: gx + 3000, y: -4800, text: 'SECURE GATE', size: 450 });
  }
  if (two) {
    pl.box('liftShaft', 200, y0 + 200, 2800, y0 + 200 + Math.min(rd, 2600), 0, totalH + 800, 'wall', '#9aa0a6');
  }
  if (hasClimate) pl.box('hvac', xc + 500, y0 - 1100, xc + 3000, y0 - 100, 0, 1800, 'steel', '#8d9399'), pl.sym({ t: 'text', x: xc + clL / 2, y: y0 + D / 2, text: 'CLIMATE CONTROLLED', size: 600 });
  pl.sym({ t: 'text', x: L / 2, y: y0 + D + 900, text: 'PROPOSED SELF STORAGE', size: 700 });
  for (const ai of aisles) pl.sym({ t: 'line', pts: [{ x: 600, y: (ai.y0 + ai.y1) / 2 }, { x: L - 600, y: (ai.y0 + ai.y1) / 2 }], stroke: '#888', w: 50, dash: [400, 300] });
  return pl;
}

export default makeType(
  { id: 'self-storage', label: 'Self storage', category: 'storage', zonesHint: ['E4', 'E5', 'IN1', 'IN2', 'B5', 'B6'], planLabel: 'PROPOSED SELF STORAGE', costHints: { buildRateKey: 'self-storage', notes: 'Rate depends on climate control and the second storey, check the build rate table' } },
  PARAMS,
  build,
  (p, pl) => {
    const a = pl.uses;
    return {
      parking: { ratePerM2: [{ use: 'self storage', per: 1, m2: 300, status: 'ESTIMATE' }, { use: 'office and reception', per: 1, m2: 40, status: 'ESTIMATE' }], accessible: true },
      vehicles: { design: 'MRV', apronDepthMm: 12000, docks: 0 },
      landscapeFrontMm: 3000,
      notes: ['Parking rate for self storage varies by council, check with council', 'Secure gate set back to hold one waiting vehicle clear of the street', `Storage area ${Math.round((a.storage || 0) + (a.climateStorage || 0))} m2 in ${pl.rooms.filter((r) => r.use === 'storage' || r.use === 'climateStorage').length} lockup rooms`],
    };
  },
);
