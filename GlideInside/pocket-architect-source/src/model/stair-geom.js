// Stair geometry shared by the editor, the 3D model, the plan sheets and the walk mode. Pure, millimetres, no DOM.
//
// A stair is { x, y, width, length, rotation } and starts on the level that owns it. Three shapes:
//   straight (default): one flight of `length` that rises the whole floor (as before).
//   L and U: a set number of risers (`risers`) of a set height (`riser`, mm; default floor to floor / risers), a going of `going` mm,
//            a flat landing that is tread number `landingAt`, then a second flight that turns left or right (`turn`, as the climber sees it).
//            An L turns through 90 degrees; a U returns beside the first flight (`gap` mm between the flights).
// For L and U, (x, y) is the centre of the FIRST flight, `length` is that flight's length ((landingAt - 1) x going) and the landing follows its
// top end. The landing is `landingDepth` deep (default the width); the second flight is as wide as the landing is deep.
//
// Local frame: v climbs the first flight (plan direction (-sin r, cos r)), u runs across it ((cos r, sin r), to the climber's LEFT).
// Tread k (1 .. risers - 1) has its top k x riser above the level; the last riser (number `risers`) arrives on the floor above.

import { rotatePoint } from './geometry.js';

export const STAIR_SHAPES = ['straight', 'L', 'U'];
export const STAIR_TURNS = ['left', 'right'];

export const isShaped = (s) => s?.shape === 'L' || s?.shape === 'U';

/** The defaults an L or U stair needs, from what was given. Throws Error with a plain message when the numbers cannot work. */
export function shapedParams(a, floorRise = 3000) {
  const shape = a.shape;
  const risers = Math.round(Number(a.risers) || Math.round(floorRise / 187.5));
  const riser = Number(a.riser) > 0 ? Number(a.riser) : Math.round((floorRise / risers) * 10) / 10;
  const going = Number(a.going) > 0 ? Number(a.going) : 250;
  const landingAt = Math.round(Number(a.landingAt) || Math.round(risers / 2));
  if (risers < 4 || risers > 40) throw new Error('A stair needs 4 to 40 risers');
  if (riser < 120 || riser > 220) throw new Error('A riser is between 120 and 220 mm');
  if (going < 180 || going > 400) throw new Error('A going is between 180 and 400 mm');
  if (landingAt < 2 || landingAt > risers - 2) throw new Error('The landing must be at tread 2 or higher and two treads or more below the top');
  return { shape, risers, riser, going, landingAt, turn: a.turn === 'right' ? 'right' : 'left', gap: Number(a.gap) >= 0 ? Number(a.gap) : 100, width: Number(a.width) || 1000, landingDepth: Number(a.landingDepth) > 0 ? Number(a.landingDepth) : null, length: null };
}

/**
 * The layout of a stair: its treads as plan polygons with the height of their top surface, the plan outline rectangles, the void the floor
 * above needs, and the walking line. `floorRise` is the floor to floor height in mm (used by straight stairs and as the default riser).
 */
export function stairLayout(stair, floorRise = 3000) {
  const rot = stair.rotation || 0;
  const c = { x: stair.x, y: stair.y };
  const W = (u, v) => rotatePoint({ x: c.x + u, y: c.y + v }, c, rot); // local (u across, v along) to plan; the same convention as stairGeometry
  const rect = (u0, u1, v0, v1) => [W(u0, v0), W(u1, v0), W(u1, v1), W(u0, v1)];
  const tread = (k, poly, top, flight, nose) => ({ k, poly, top, landing: false, flight, nose: [poly[nose[0]], poly[nose[1]]] }); // nose: the two corners of the edge where the next riser stands
  const w = stair.width;
  const len = stair.length;
  if (!isShaped(stair)) {
    const nr = Math.max(3, Math.round(floorRise / 180));
    const riser = floorRise / nr;
    const going = len / nr;
    const treads = [];
    for (let k = 1; k < nr; k++) treads.push(tread(k, rect(-w / 2, w / 2, -len / 2 + (k - 1) * going, -len / 2 + k * going), k * riser, 1, [3, 2]));
    return { shape: 'straight', risers: nr, riser, going, width: w, treads, outlines: [rect(-w / 2, w / 2, -len / 2, len / 2)], walk: [W(0, -len / 2 + len * 0.2), W(0, len / 2 - len * 0.08)], voidPoly: rect(-w / 2, w / 2, -len / 2, len / 2), solid: true };
  }
  const P = shapedParams({ ...stair, landingAt: stair.landingAt, width: w }, floorRise);
  const { risers, riser, going, landingAt, turn, gap } = P;
  const dl = stair.landingDepth > 0 ? stair.landingDepth : w;
  const n1 = landingAt - 1; // treads in the first flight
  const n2 = risers - 1 - landingAt; // treads in the second flight
  const sgn = turn === 'left' ? 1 : -1; // +u is the climber's left
  const treads = [];
  const outlines = [];
  const v0 = -len / 2;
  for (let k = 1; k <= n1; k++) treads.push(tread(k, rect(-w / 2, w / 2, v0 + (k - 1) * going, v0 + k * going), k * riser, 1, [3, 2]));
  outlines.push(rect(-w / 2, w / 2, v0, len / 2));
  const lv0 = len / 2;
  const lv1 = len / 2 + dl;
  const walk = [W(0, v0 + going * 0.5)];
  if (P.shape === 'L') {
    const u0 = sgn > 0 ? -w / 2 : -w / 2; // the landing sits over the first flight's width
    treads.push({ k: landingAt, poly: rect(u0, u0 + w, lv0, lv1), top: landingAt * riser, landing: true, flight: 1, nose: null });
    outlines.push(rect(u0, u0 + w, lv0, lv1));
    // second flight leaves the landing sideways along +u (left) or -u (right), as wide as the landing is deep
    for (let j = 1; j <= n2; j++) {
      const a = sgn > 0 ? w / 2 + (j - 1) * going : -w / 2 - j * going;
      treads.push(tread(landingAt + j, rect(a, a + going, lv0, lv1), (landingAt + j) * riser, 2, sgn > 0 ? [1, 2] : [0, 3]));
    }
    const l2 = n2 * going;
    outlines.push(sgn > 0 ? rect(w / 2, w / 2 + l2, lv0, lv1) : rect(-w / 2 - l2, -w / 2, lv0, lv1));
    walk.push(W(0, (lv0 + lv1) / 2), W(sgn * (w / 2 + l2 - going * 0.5), (lv0 + lv1) / 2));
    const uEnd = sgn * (w / 2 + l2);
    const voidU = [Math.min(-w / 2, uEnd), Math.max(w / 2, uEnd)];
    const colU = [-w / 2, w / 2];
    // L shaped void: the first flight and landing column plus the second flight row
    const poly = sgn > 0
      ? [W(colU[0], v0), W(colU[1], v0), W(colU[1], lv0), W(voidU[1], lv0), W(voidU[1], lv1), W(colU[0], lv1)]
      : [W(colU[0], v0), W(colU[1], v0), W(colU[1], lv1), W(voidU[0], lv1), W(voidU[0], lv0), W(colU[0], lv0)];
    return { shape: 'L', risers, riser, going, width: w, landingAt, turn, treads, outlines, walk, voidPoly: poly, solid: false };
  }
  // U: the landing spans both flights, the second flight returns beside the first
  const uA = sgn > 0 ? -w / 2 : -w / 2 - gap - w;
  const uB = sgn > 0 ? w / 2 + gap + w : w / 2;
  treads.push({ k: landingAt, poly: rect(uA, uB, lv0, lv1), top: landingAt * riser, landing: true, flight: 1, nose: null });
  outlines.push(rect(uA, uB, lv0, lv1));
  const f2a = sgn > 0 ? w / 2 + gap : -w / 2 - gap - w; // across the second flight
  for (let j = 1; j <= n2; j++) treads.push(tread(landingAt + j, rect(f2a, f2a + w, lv0 - j * going, lv0 - (j - 1) * going), (landingAt + j) * riser, 2, [0, 1]));
  outlines.push(rect(f2a, f2a + w, lv0 - n2 * going, lv0));
  walk.push(W(0, (lv0 + lv1) / 2), W(sgn * (w + gap), (lv0 + lv1) / 2), W(sgn * (w + gap), lv0 - n2 * going + going * 0.5));
  const vTop = Math.min(v0, lv0 - n2 * going);
  return { shape: 'U', risers, riser, going, width: w, landingAt, turn, treads, outlines, walk, voidPoly: rect(Math.min(uA, f2a), Math.max(uB, f2a + w), vTop, lv1), solid: false };
}

/** Height of the top of the last riser, i.e. the floor above, from the level below: risers x riser. */
export const stairRise = (stair, floorRise = 3000) => { const l = stairLayout(stair, floorRise); return l.risers * l.riser; };
