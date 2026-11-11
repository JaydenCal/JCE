// "Fit this house inside the setbacks": one honest answer. Tries the house as drawn, turned square to the lot, and the lot
// planner's autoPose (garage to the street). Reports the shortfall per boundary when nothing fits. Pure: works on copies.
//
//   const r = fitHouse(project)
//   r = { ok: true, fits: true, rotateDeg, dx, dy, message }                      the move to apply (rotate about the house centre, then translate)
//     | { ok: true, fits: false, shortfalls: [{ side, shortByM }], message }       cannot fit; no change should be made
//     | { ok: false, reason, message }                                             no lot, no building or no setbacks

import { lotOf, houseCentre, rotateHouse, translateHouse, suggestPosition, classifyEdges, NOT_LOADED } from '../model/placement.js';
import { buildingHull, orientedBox } from './lotplan.js';
import { lotChecks, edgeWords } from './lot-checks.js';
import { autoPose } from '../portal/auto-place.js';

const norm90 = (d) => ((((d + 45) % 90) + 90) % 90) - 45; // -45..45

const sideNames = (lot) => {
  const k = { front: 'front', secondaryFront: 'secondary street', side: 'side', rear: 'rear', unknown: 'edge' };
  const out = {};
  for (const e of classifyEdges(lot)) out[e.index] = `${k[e.kind] || 'edge'} (${edgeWords(lot, e.index)})`;
  return out;
};

function trial(project, rotateDeg) {
  const p = structuredClone(project);
  if (rotateDeg) rotateHouse(p, rotateDeg, houseCentre(p));
  const s = suggestPosition(p, 'centre');
  return { p, s };
}

export function fitHouse(project) {
  const lot = lotOf(project);
  if (!lot) return { ok: false, reason: 'no_lot', message: 'No lot is loaded for this design.' };
  if (!lot.setbacks && !lot.envelope) return { ok: false, reason: 'setbacks_not_loaded', message: `${NOT_LOADED} I can still move or rotate the house, but I will not make any setback claims.` };
  const hull = buildingHull(project);
  if (hull.length < 3) return { ok: false, reason: 'no_building', message: 'There is no building on the plan to position.' };
  const box = orientedBox(hull);
  const front = classifyEdges(lot).find((e) => e.kind === 'front') || classifyEdges(lot).find((e) => e.kind === 'secondaryFront');
  const cands = [0];
  if (box && front) {
    const edgeAngle = (Math.atan2(front.b.y - front.a.y, front.b.x - front.a.x) * 180) / Math.PI;
    const aligned = Math.round(norm90(edgeAngle - box.angleDeg) * 10) / 10;
    if (Math.abs(aligned) > 0.5) cands.push(aligned);
    cands.push(aligned + 90, aligned - 90);
  }
  try {
    const house = structuredClone(project);
    const auto = autoPose(project, { ...house, name: 'This house' });
    if (auto?.pose && Number.isFinite(auto.pose.rotation)) { cands.push(Math.round(auto.pose.rotation * 10) / 10); }
  } catch { /* autoPose needs a frontage; the other candidates still run */ }
  let best = null;
  const seen = new Set();
  for (const deg of cands) {
    const key = Math.round(deg * 10);
    if (seen.has(key)) continue;
    seen.add(key);
    const { p, s } = trial(project, deg);
    if (!s.ok) {
      if (s.reason === 'no_room') return { ok: true, fits: false, shortfalls: [], message: 'The setbacks leave no room to build on this lot. Check with council.' };
      continue;
    }
    const score = s.fits ? Math.abs(deg) : 1000 + (s.residualM ?? 0) * 1000;
    if (!best || score < best.score) best = { deg, s, p, score };
    if (s.fits && deg === 0) break; // as drawn is best
  }
  if (!best) return { ok: false, reason: 'no_envelope', message: 'The setback envelope is not available for this lot shape.' };
  const mm = (v) => `${(Math.abs(v) / 1000).toFixed(2)} m`;
  if (best.s.fits) {
    const move = `${mm(best.s.dx)} ${best.s.dx >= 0 ? 'east' : 'west'} and ${mm(best.s.dy)} ${best.s.dy >= 0 ? 'south' : 'north'}`;
    const turn = best.deg ? ` and turned ${Math.abs(best.deg)} degrees ${best.deg > 0 ? 'clockwise' : 'anticlockwise'} to square it to the lot` : '';
    return { ok: true, fits: true, rotateDeg: best.deg, dx: best.s.dx, dy: best.s.dy, message: `Moved the house ${move}${turn}, so it sits inside the indicative setback envelope.` };
  }
  // Shortfall per boundary at the least bad position.
  translateHouse(best.p, best.s.dx, best.s.dy);
  const names = sideNames(lot);
  const checks = lotChecks(best.p);
  const shortfalls = checks.messages.map((m) => ({ side: names[m.edge] || edgeWords(lot, m.edge), shortByM: m.kind === 'boundary' ? m.overM : m.shortByM, kind: m.kind }));
  const list = shortfalls.map((x) => `${x.side} by ${x.shortByM.toFixed(2)} m`).join(', ');
  return {
    ok: true, fits: false, shortfalls,
    message: `This house does not fit inside the indicative setbacks, even turned square to the lot or with the garage to the street. Closest position is short at the ${list || 'boundary'}. A narrower or shallower design would fit better. Check with council.`,
  };
}
