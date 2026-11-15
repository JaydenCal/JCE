// Plain language advice when a house does not fit its lot, and the one tap fixes. Pure: no DOM.
//
//   fitFacts(project)        cheap, safe to call on every frame: where the house breaches and by how much
//   fitPlan(project)         the search: the best pose (auto fit), the smallest turn that fits, square to the street. Memoised.
//   fitCardModel(project)    what the fit card says: { show, tone, title, lines, sides, actions, slope }
//   applyFix(store, id)      apply one fix as a single undo step (tanks and the driveway follow, src/site/site-items.js)
//   slopeUnderHouse(project) fall of the ground across the footprint, and the gentle note above SLOPE_NOTE_M
//
// The envelope is indicative and council decides, so the words are "fits" and "meets the setbacks", never an approval.

import * as G from '../model/geometry.js';
import { lotOf, envelopeOf, classifyEdges, checkSetbacks, houseCentre, rotateHouse, translateHouse } from '../model/placement.js';
import { buildingHull, orientedBox, clearances, garageDoor, deriveDriveway, inwardNormalOf } from './lotplan.js';
import { terrainAt } from './model.js';
import { settleSiteItems } from './site-items.js';

export const SLOPE_NOTE_M = 1.5;
export const ENGINEER_LABEL = 'Send to a registered engineer for a custom design';
const TOL = 5;
export const TIGHT_MM = 250; // under this much room all round the fit is called tight
const COMFORT_MM = 1000; // clearance beyond this is not worth moving the house further for
const m1 = (mm) => (Math.round(mm / 100) / 10).toFixed(1);
const normDeg = (d) => { const v = (((d % 360) + 540) % 360) - 180; return v === -180 ? 180 : v; };

// Geometry ---------------------------------------------------------------------------------------------------------------
const edgeDist = (p, poly) => { let d = Infinity; for (let i = 0; i < poly.length; i++) d = Math.min(d, G.projectToSegment(p, poly[i], poly[(i + 1) % poly.length]).d); return d; };

/**
 * Signed room (mm) of a convex outline inside a polygon. Positive: the least distance from the outline to the polygon's edge. Negative:
 * how far the outline pokes out (or an inside corner of the polygon pokes into it).
 */
export function marginIn(hull, poly) {
  let out = 0;
  let room = Infinity;
  for (const p of hull) {
    const d = edgeDist(p, poly);
    if (G.pointInPolygon(p, poly)) room = Math.min(room, d);
    else out = Math.max(out, d);
  }
  for (const v of poly) {
    const d = edgeDist(v, hull);
    if (G.pointInPolygon(v, hull)) out = Math.max(out, d);
    else room = Math.min(room, d);
  }
  return out > TOL ? -out : room;
}

/** The polygon the house has to stay inside: the setback envelope when the lot has one, else the lot boundary. */
export function buildableArea(project) {
  const lot = lotOf(project);
  if (!lot) return null;
  const env = envelopeOf(lot);
  if (env.polygon && env.polygon.length >= 3) return { polygon: env.polygon, kind: 'setbacks' };
  if (env.polygon && env.polygon.length < 3 && lot.setbacks) return { polygon: null, kind: 'none' };
  return { polygon: lot.boundary, kind: 'lot' };
}

/** The street frame of the lot: u along the frontage, n into the lot, right hand side as seen from the street. Null with no frontage. */
function streetFrame(lot) {
  const front = classifyEdges(lot).find((e) => e.kind === 'front');
  if (!front) return null;
  const n = inwardNormalOf(lot, front.index);
  return { front, n, u: G.norm(G.sub(front.b, front.a)), right: { x: -n.y, y: n.x }, mid: G.lerp(front.a, front.b, 0.5) };
}

const COMPASS = ['north', 'north east', 'east', 'south east', 'south', 'south west', 'west', 'north west'];

/** Plain words for a boundary edge: "at the front", "at the rear", "on the left side (looking from the street)", "on the side street side". */
export function sideWords(lot, index) {
  const e = classifyEdges(lot)[index];
  if (!e) return 'on one side';
  if (e.kind === 'front') return 'at the front';
  if (e.kind === 'rear') return 'at the rear';
  if (e.kind === 'secondaryFront') return 'on the side street side';
  const f = streetFrame(lot);
  if (f) {
    const s = G.dot(G.sub(G.lerp(e.a, e.b, 0.5), G.polygonCentroid(lot.boundary)), f.right);
    return s >= 0 ? 'on the right side (looking from the street)' : 'on the left side (looking from the street)';
  }
  const n = inwardNormalOf(lot, index);
  const deg = (((Math.atan2(-n.x, n.y) * 180) / Math.PI) + 360) % 360;
  return `on the ${COMPASS[Math.round(deg / 45) % 8]} side`;
}

// Facts (cheap) ------------------------------------------------------------------------------------------------------------
/**
 * Where the house breaches now. Returns null with no lot or no building, else
 * { state: 'fits' | 'outside' | 'over-lot' | 'unchecked', issues: [{ edge, where, type: 'lot' | 'setback', overM, a, b }], hull, area }
 * issues are worst first; a and b are the ends of the boundary edge (for the highlight).
 */
export function fitFacts(project) {
  const lot = lotOf(project);
  if (!lot) return null;
  const hull = buildingHull(project);
  if (hull.length < 3) return null;
  const edges = classifyEdges(lot);
  const issues = [];
  const seen = new Set();
  for (const r of clearances(project).rows) {
    if (r.clearanceM < -0.005) { issues.push({ edge: r.edge, where: sideWords(lot, r.edge), type: 'lot', overM: -r.clearanceM, a: edges[r.edge].a, b: edges[r.edge].b }); seen.add(r.edge); }
  }
  const area = buildableArea(project);
  const chk = checkSetbacks(project);
  if (chk.status === 'breach') {
    for (const b of chk.breaches || []) {
      if (seen.has(b.edge) || !(b.breachM > 0.005)) continue;
      seen.add(b.edge);
      issues.push({ edge: b.edge, where: b.kind === 'garage' ? 'at the garage' : sideWords(lot, b.edge), type: 'setback', overM: b.breachM, a: edges[b.edge].a, b: edges[b.edge].b });
    }
  }
  issues.sort((p, q) => (p.type === q.type ? q.overM - p.overM : p.type === 'lot' ? -1 : 1));
  const overLot = issues.some((i) => i.type === 'lot');
  const state = overLot ? 'over-lot' : issues.length || chk.noRoom ? 'outside' : chk.status === 'ok' ? 'fits' : 'unchecked';
  return { state, issues, hull, area, noRoom: !!chk.noRoom };
}

// The search ---------------------------------------------------------------------------------------------------------------
const turned = (hull, c, deg) => (deg ? hull.map((p) => G.rotatePoint(p, c, deg)) : hull);
const moved = (hull, dx, dy) => hull.map((p) => ({ x: p.x + dx, y: p.y + dy }));

/**
 * Best move of an outline inside a polygon. Score: the room it has (capped at a comfortable metre), then the shortest move. A coarse grid
 * over the polygon, then three finer passes round the best cell. Returns { dx, dy, margin }.
 */
function bestMove(hull, poly) {
  const hb = G.bbox(hull);
  const pb = G.bbox(poly);
  const span = (lo, hi) => (hi >= lo ? [lo, hi] : [(lo + hi) / 2, (lo + hi) / 2]);
  const [x0, x1] = span(pb.minX - hb.minX, pb.maxX - hb.maxX);
  const [y0, y1] = span(pb.minY - hb.minY, pb.maxY - hb.maxY);
  const score = (dx, dy) => {
    const mg = marginIn(moved(hull, dx, dy), poly);
    return { dx, dy, margin: mg, s: Math.min(mg, COMFORT_MM) - Math.hypot(dx, dy) * 0.01 };
  };
  let best = score(G.clamp(0, x0, x1), G.clamp(0, y0, y1));
  let step = Math.min(2500, Math.max(250, Math.max(x1 - x0, y1 - y0) / 22));
  for (let y = y0; y <= y1 + 1; y += step) for (let x = x0; x <= x1 + 1; x += step) { const c = score(x, y); if (c.s > best.s) best = c; }
  for (let pass = 0; pass < 4; pass++) {
    step /= 2;
    const c0 = best;
    for (let j = -2; j <= 2; j++) for (let i = -2; i <= 2; i++) {
      if (!i && !j) continue;
      const c = score(c0.dx + i * step, c0.dy + j * step);
      if (c.s > best.s) best = c;
    }
  }
  const snap = score(Math.round(best.dx / 50) * 50, Math.round(best.dy / 50) * 50);
  return snap.margin >= 0 || best.margin < 0 ? snap : best;
}

/** The turns worth trying (degrees clockwise from where the house is now): as it is, square to every lot edge, garage to the street, a sweep. */
function turnCandidates(project, lot, box) {
  const out = new Map();
  const add = (deg, tag) => { const d = Math.round(normDeg(deg) * 2) / 2; const k = String(d); if (!out.has(k)) out.set(k, { deg: d, tags: new Set() }); out.get(k).tags.add(tag); };
  add(0, 'asis');
  const f = streetFrame(lot);
  const door = garageDoor(project);
  if (f && door) {
    const from = (Math.atan2(door.normal.y, door.normal.x) * 180) / Math.PI;
    const to = (Math.atan2(-f.n.y, -f.n.x) * 180) / Math.PI;
    add(to - from, 'street');
  }
  if (box) {
    const lines = [...G.polygonEdges(lot.boundary)];
    for (const [a, b] of lines) {
      if (G.dist(a, b) < 3000) continue;
      const ang = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
      for (const k of [0, 90, 180, 270]) add(ang - box.angleDeg + k, 'square');
    }
    if (f) { const ang = (Math.atan2(f.u.y, f.u.x) * 180) / Math.PI; for (const k of [0, 90, 180, 270]) add(ang - box.angleDeg + k, 'street-square'); }
  }
  for (let d = -165; d <= 180; d += 15) add(d, 'sweep');
  return [...out.values()];
}

const planCache = new Map();
const keyOf = (hull, poly, extra) => `${hull.map((p) => `${Math.round(p.x)},${Math.round(p.y)}`).join(' ')}|${poly.map((p) => `${Math.round(p.x)},${Math.round(p.y)}`).join(' ')}|${extra}`;

/**
 * The search behind the fixes. Returns null with no lot, no building or no room at all, else
 * { now, auto, rotate, square, verdict, tooWideM, tooDeepM, buildable: { widthM, depthM }, house: { widthM, depthM } }
 *   now      { margin } the room the house has where it stands (mm, negative when it pokes out)
 *   auto     { deg, dx, dy, margin, fits, facing } the pose with the most room (garage to the street preferred when it fits)
 *   rotate   the smallest turn that fits (null when the house fits without turning, or never fits)
 *   square   garage to the street (or the house squared to the frontage), moved to where it has the most room
 *   verdict  'fits' | 'move' (fits as turned, somewhere else) | 'rotate' (fits only turned) | 'none' (does not fit this lot)
 */
export function fitPlan(project) {
  const lot = lotOf(project);
  const area = buildableArea(project);
  const hull = buildingHull(project);
  if (!lot || !area?.polygon || hull.length < 3) return null;
  const door = garageDoor(project);
  const key = keyOf(hull, area.polygon, `${door ? `${Math.round(door.mid.x)},${Math.round(door.mid.y)}` : ''}|${(lot.frontEdges || []).join(',')}`);
  if (planCache.has(key)) return planCache.get(key);
  const poly = area.polygon;
  const c = G.polygonCentroid(hull);
  const box = orientedBox(hull);
  const f = streetFrame(lot);
  const doorDeg = door ? (Math.atan2(door.normal.y, door.normal.x) * 180) / Math.PI : null;
  const streetDeg = f ? (Math.atan2(-f.n.y, -f.n.x) * 180) / Math.PI : null;
  const facingAt = (deg) => doorDeg != null && streetDeg != null && Math.abs(normDeg(doorDeg + deg - streetDeg)) <= 35;
  const tries = turnCandidates(project, lot, box).map((t) => {
    const h = turned(hull, c, t.deg);
    const mv = bestMove(h, poly);
    return { deg: t.deg, tags: t.tags, dx: Math.round(mv.dx), dy: Math.round(mv.dy), margin: mv.margin, fits: mv.margin >= 0, facing: facingAt(t.deg) };
  });
  const nowMargin = marginIn(hull, poly);
  const score = (t) => (t.fits ? 10000 : 0) + Math.min(t.margin, COMFORT_MM) + (t.facing ? 500 : 0) - Math.abs(t.deg) * 2 - Math.hypot(t.dx, t.dy) * 0.01;
  const auto = tries.reduce((a, b) => (score(b) > score(a) ? b : a));
  const asis = tries.find((t) => t.deg === 0);
  const fitting = tries.filter((t) => t.fits && t.deg !== 0);
  const rotate = asis.fits || !fitting.length ? null : fitting.reduce((a, b) => (Math.abs(b.deg) + (b.tags.has('sweep') && b.tags.size === 1 ? 20 : 0) < Math.abs(a.deg) + (a.tags.has('sweep') && a.tags.size === 1 ? 20 : 0) ? b : a));
  const square = tries.find((t) => t.tags.has('street')) || tries.filter((t) => t.tags.has('street-square')).reduce((a, b) => (!a || Math.abs(b.deg) < Math.abs(a.deg) ? b : a), null);
  const verdict = nowMargin >= 0 ? 'fits' : asis.fits ? 'move' : fitting.length ? 'rotate' : 'none';

  // Sizes in the street frame (or the house's own axes with no frontage): how wide and deep the house is, and what the lot allows.
  const ax = f ? { u: f.u, n: f.n } : box ? { u: box.u, n: box.v } : { u: { x: 1, y: 0 }, n: { x: 0, y: 1 } };
  const ext = (pts, d) => { const v = pts.map((p) => G.dot(p, d)); return Math.max(...v) - Math.min(...v); };
  const house = { widthM: ext(hull, ax.u) / 1000, depthM: ext(hull, ax.n) / 1000 };
  const buildable = { widthM: ext(poly, ax.u) / 1000, depthM: ext(poly, ax.n) / 1000 };
  // How much has to come off: at the closest pose, the overhang on opposite sides of the house, across its width and along its depth.
  let tooWideM = 0;
  let tooDeepM = 0;
  if (verdict === 'none' && box) {
    const h = moved(turned(hull, c, auto.deg), auto.dx, auto.dy);
    const hu = G.rotatePoint(box.u, { x: 0, y: 0 }, auto.deg);
    const hv = G.rotatePoint(box.v, { x: 0, y: 0 }, auto.deg);
    const over = { up: 0, um: 0, vp: 0, vm: 0 };
    const hc = G.polygonCentroid(h);
    for (const p of h) {
      if (G.pointInPolygon(p, poly)) continue;
      const d = edgeDist(p, poly);
      const du = G.dot(G.sub(p, hc), hu);
      const dv = G.dot(G.sub(p, hc), hv);
      if (Math.abs(du) / Math.max(1, box.w) >= Math.abs(dv) / Math.max(1, box.d)) { if (du >= 0) over.up = Math.max(over.up, d); else over.um = Math.max(over.um, d); }
      else if (dv >= 0) over.vp = Math.max(over.vp, d); else over.vm = Math.max(over.vm, d);
    }
    const acrossU = (over.up + over.um) / 1000;
    const acrossV = (over.vp + over.vm) / 1000;
    // The house's short side is its width in plain speech when it stands long side to the street; keep to the street frame when there is one.
    const uIsWidth = f ? Math.abs(G.dot(hu, f.u)) >= Math.abs(G.dot(hv, f.u)) : true;
    tooWideM = uIsWidth ? acrossU : acrossV;
    tooDeepM = uIsWidth ? acrossV : acrossU;
    if (!(tooWideM > 0.05) && !(tooDeepM > 0.05)) tooWideM = Math.max(0.1, -auto.margin / 1000);
  }
  const plan = { now: { margin: nowMargin }, auto, rotate, square, verdict, tooWideM, tooDeepM, buildable, house, kind: area.kind };
  if (planCache.size > 40) planCache.clear();
  planCache.set(key, plan);
  return plan;
}

// Slope -----------------------------------------------------------------------------------------------------------------------
/** Fall of the ground across the house footprint in metres (null with no level data under the house). */
export function slopeUnderHouse(project) {
  const lot = lotOf(project);
  const hull = buildingHull(project);
  if (!lot?.terrain || hull.length < 3) return null;
  const bb = G.bbox(hull);
  const zs = [];
  const take = (p) => { const z = terrainAt(lot.terrain, p.x, p.y); if (Number.isFinite(z)) zs.push(z); };
  hull.forEach(take);
  const step = Math.max(500, Math.max(bb.w, bb.h) / 16);
  for (let y = bb.minY; y <= bb.maxY; y += step) for (let x = bb.minX; x <= bb.maxX; x += step) { const p = { x, y }; if (G.pointInPolygon(p, hull)) take(p); }
  if (zs.length < 3) return null;
  return { fallM: Math.round((Math.max(...zs) - Math.min(...zs)) * 10) / 10 };
}

/** The gentle slope note, or null at or under the threshold (about 1.5 m across the footprint). */
export function slopeNote(project) {
  const s = slopeUnderHouse(project);
  if (!s || !(s.fallM > SLOPE_NOTE_M)) return null;
  return {
    fallM: s.fallM,
    text: `The ground falls about ${s.fallM.toFixed(1)} m across this house. This is a concept only: a sloping site may need a split level design. Send it to a registered engineer for advice.`,
    short: `Sloping site: the ground falls about ${s.fallM.toFixed(1)} m across this house. Concept only, it may need a split level design.`,
  };
}

// The card ------------------------------------------------------------------------------------------------------------------
const turnWords = (deg) => `${Math.abs(Math.round(deg))} degrees ${deg > 0 ? 'clockwise' : 'anticlockwise'}`;

/** One sentence for the worst breach: "The house is 2.1 m over the boundary on the left side." */
export function issueSentence(issue) {
  if (!issue) return '';
  return issue.type === 'lot'
    ? `The house is ${m1(issue.overM * 1000)} m over the boundary ${issue.where}.`
    : `The house is ${m1(issue.overM * 1000)} m too close to the boundary ${issue.where}.`;
}

/**
 * What the fit card says and offers. `withPlan` false skips the search (while dragging): the text names the breach only.
 *   { show, tone: 'bad' | 'warn', title, lines[], sides[{ a, b, type }], actions[{ id, label, primary }], verdict, slope, driveway }
 * Action ids: 'auto', 'rotate', 'square', 'designs', 'narrower', 'engineer'.
 */
export function fitCardModel(project, { withPlan = true, canDesigns = true, canNarrower = true, canEngineer = true } = {}) {
  const facts = fitFacts(project);
  const slope = slopeNote(project);
  const none = { show: false, tone: 'ok', title: '', lines: [], sides: [], actions: [], verdict: 'fits', slope, driveway: null };
  if (!facts) return none;
  const dw = (() => { try { return deriveDriveway(project); } catch { return null; } })();
  const driveway = dw && !dw.ok && garageDoor(project) ? { blocked: true, text: 'There is no room for a driveway to the garage from here. Turn the house so the garage faces the street.' } : dw?.ok && dw.routed ? { routed: true, text: 'The garage faces away from the street, so the driveway runs round the house.' } : null;
  if (facts.state === 'fits' || facts.state === 'unchecked') {
    // A tight fit: it meets the setbacks with next to nothing to spare, and moving it does not find more room.
    if (!driveway?.blocked && withPlan && facts.state === 'fits') {
      const plan = fitPlan(project);
      if (plan && plan.now.margin < TIGHT_MM && plan.auto.margin < TIGHT_MM + 150) {
        return { ...none, show: true, tone: 'note', title: 'A tight fit', lines: [`The house fits with about ${m1(Math.max(0, plan.now.margin))} m to spare. There are smaller options below if you want more room.`], verdict: 'tight', plan, driveway };
      }
    }
    if (!driveway?.blocked) return { ...none, driveway };
    return { ...none, show: true, tone: 'warn', title: 'No driveway yet', lines: [driveway.text], actions: [{ id: 'square', label: 'Square to the street', primary: true }], driveway };
  }
  const sides = facts.issues.map((i) => ({ a: i.a, b: i.b, type: i.type, edge: i.edge }));
  const worst = facts.issues[0];
  const lines = [];
  const actions = [];
  let title = 'The house does not fit here';
  let verdict = 'unknown';
  if (facts.noRoom) {
    lines.push('The setbacks leave no room to build on this lot.', 'A registered engineer can look at what is possible here.');
    if (canEngineer) actions.push({ id: 'engineer', label: ENGINEER_LABEL, primary: true });
    return { show: true, tone: 'bad', title: 'No buildable area', lines, sides, actions, verdict: 'none', slope, driveway };
  }
  const plan = withPlan ? fitPlan(project) : null;
  if (!plan) {
    lines.push(issueSentence(worst));
    return { show: true, tone: 'bad', title, lines, sides, actions, verdict, slope, driveway };
  }
  verdict = plan.verdict;
  const areaWords = plan.kind === 'lot' ? 'the lot' : 'the buildable area';
  if (verdict === 'move' || verdict === 'fits') {
    title = 'The house is outside the buildable area';
    lines.push(issueSentence(worst), `There is room for it on this lot. Auto fit moves it inside ${areaWords}.`);
    actions.push({ id: 'auto', label: 'Auto fit', primary: true });
    if (plan.square && Math.abs(plan.square.deg) > 0.5) actions.push({ id: 'square', label: 'Square to the street' });
  } else if (verdict === 'rotate') {
    title = 'The house fits if it is turned';
    const w = plan.house.widthM - plan.buildable.widthM;
    lines.push(w > 0.05 ? `The house is ${w.toFixed(1)} m too wide for ${areaWords} the way it is turned. It overhangs ${worst.where}.` : issueSentence(worst));
    lines.push(`Turned ${turnWords(plan.rotate.deg)} it fits. Auto fit turns and moves it for the most room.`);
    actions.push({ id: 'auto', label: 'Auto fit', primary: true }, { id: 'rotate', label: 'Rotate to fit' });
    if (plan.square && plan.square.fits && Math.abs(plan.square.deg) > 0.5) actions.push({ id: 'square', label: 'Square to the street' });
  } else {
    title = 'This house is too big for this lot';
    const wide = plan.tooWideM > 0.05;
    const deep = plan.tooDeepM > 0.05;
    const size = wide && deep ? `${plan.tooWideM.toFixed(1)} m too wide and ${plan.tooDeepM.toFixed(1)} m too deep` : deep ? `${plan.tooDeepM.toFixed(1)} m too deep` : `${plan.tooWideM.toFixed(1)} m too wide`;
    lines.push(`The house is ${size} for ${areaWords}, however it is turned.`);
    lines.push(`It overhangs most ${worst.where}. ${canDesigns ? 'A smaller design will fit, or a registered engineer can design one for this lot.' : 'A registered engineer can design a home for this lot.'}`);
    if (canDesigns) actions.push({ id: 'designs', label: 'Show designs that fit', primary: true });
    if (canNarrower) actions.push({ id: 'narrower', label: wide || !deep ? 'Make it narrower' : 'Make it shallower' });
    actions.push({ id: 'auto', label: 'Closest fit', extra: true });
    if (canEngineer) actions.push({ id: 'engineer', label: ENGINEER_LABEL, primary: !canDesigns });
  }
  if (verdict !== 'none' && canDesigns) actions.push({ id: 'designs', label: 'Show designs that fit' });
  return { show: true, tone: 'bad', title, lines, sides, actions, verdict, plan, slope, driveway };
}

/** When no design in the list fits either: the kind last word. */
export const NOTHING_FITS = 'None of these designs fits this lot. That is common on narrow or irregular lots. A registered engineer can design a home to suit it.';

/** Guidance for the editor after "Make it narrower". */
export function narrowerGuidance(project) {
  const plan = fitPlan(project);
  const wide = plan && (plan.tooWideM > 0.05 || !(plan.tooDeepM > 0.05));
  const by = plan ? (wide ? plan.tooWideM : plan.tooDeepM) : 0;
  const amount = by > 0.05 ? ` It needs to come in by about ${by.toFixed(1)} m.` : '';
  return `To make the house ${wide ? 'narrower' : 'shallower'}, drag ${wide ? 'a side' : 'the front or rear'} wall inward on the floor plan.${amount} Rooms on that wall get smaller with it.`;
}

// The fixes -----------------------------------------------------------------------------------------------------------------
const FIX_LABEL = { auto: 'Auto fit', rotate: 'Rotate to fit', square: 'Square to the street' };

/** The pose change for a fix: { deg, dx, dy } or null when the fix does not apply. Pure. */
export function fixPose(project, id) {
  const plan = fitPlan(project);
  if (!plan) return null;
  const t = id === 'auto' ? plan.auto : id === 'rotate' ? plan.rotate : id === 'square' ? plan.square : null;
  return t ? { deg: t.deg, dx: t.dx, dy: t.dy, fits: t.fits, margin: t.margin } : null;
}

/** Apply a pose change to a project (mutates): turn about the centre of the outline, then move. Tanks and the driveway follow. */
export function applyPose(project, pose) {
  const hull = buildingHull(project);
  const c = hull.length >= 3 ? G.polygonCentroid(hull) : houseCentre(project);
  if (pose.deg) rotateHouse(project, pose.deg, c);
  if (pose.dx || pose.dy) translateHouse(project, Math.round(pose.dx), Math.round(pose.dy));
  return settleSiteItems(project);
}

/**
 * Apply fix `id` ('auto' | 'rotate' | 'square') as one undo step. Returns { ok, label, fits, changed } (changed false: already there).
 */
export function applyFix(store, id) {
  const pose = fixPose(store.project, id);
  if (!pose) return { ok: false, label: FIX_LABEL[id] || '', fits: false, changed: false };
  if (Math.abs(pose.deg) < 0.05 && Math.hypot(pose.dx, pose.dy) < 25) return { ok: true, label: FIX_LABEL[id], fits: pose.fits, changed: false };
  store.apply(FIX_LABEL[id], (p) => { applyPose(p, pose); if (pose.fits && p.placedHouse?.tooBig) delete p.placedHouse.tooBig; });
  return { ok: true, label: FIX_LABEL[id], fits: pose.fits, changed: true };
}
