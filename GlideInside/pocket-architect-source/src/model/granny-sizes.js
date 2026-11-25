// Granny flat design with typed sizes: pure functions on the existing project model (rectangular rooms, shared walls), no DOM.
//
//   overallOf(project)            the outline of the enclosed rooms, { x, y, width, length } in mm
//   planOverall / setOverall      type the overall width and length: the east and south edges move, the rooms and walls along them follow
//   roomsOf(project)              the rooms with their typed sizes
//   planRoomSize / setRoomSize    type one room's width and length: the walls it shares with its neighbours move, so the neighbours adjust
//   ROOM_PRESETS / addPresetRoom  Add room presets the person can type over
//   checkDesign(project)          floor area against the 60 m2 granny flat limit, and rooms below a usable size (warnings only, never a block)
//
// Everything goes through the model's own operations (pushPull, resize_room, add_room), so walls, openings and undo behave as everywhere else.

import * as G from './geometry.js';
import { applyOp, pushPull } from './ops.js';
import { planSetSize, HARD_MIN_SIDE } from '../viewer3d/room-edit-logic.js';

export const GRANNY_MAX_M2 = 60;
export const MIN_BEDROOM_MM = 2400;
export const MIN_BATHROOM_MM = 1500;
export const MIN_OVERALL_MM = 2400;
export const MAX_OVERALL_MM = 30000;
export const NOT_FLOOR = ['garage', 'carport'];

/** Add room presets (sizes in mm, as the person types them in metres). */
export const ROOM_PRESETS = Object.freeze([
  { id: 'bedroom', label: 'Bedroom', type: 'bedroom', width: 3000, depth: 3000 },
  { id: 'bathroom', label: 'Bathroom', type: 'bathroom', width: 2400, depth: 2000 },
  { id: 'kitchen-living', label: 'Kitchen and living', type: 'living', width: 4500, depth: 5000 },
  { id: 'laundry', label: 'Laundry', type: 'laundry', width: 1800, depth: 2000 },
  { id: 'deck', label: 'Deck', type: 'deck', width: 3000, depth: 4000 },
]);

const ground = (project) => [...(project.levels || [])].sort((a, b) => (a.elevation || 0) - (b.elevation || 0))[0] || null;
const usable = (r) => Array.isArray(r.polygon) && r.polygon.length >= 3 && r.status !== 'demolish';
const isEnclosed = (r) => usable(r) && !r.outdoor;
const m = (mm) => `${(mm / 1000).toFixed(1)}`;

/** mm from a typed number of metres ("6", "6.0", "6,5"); null when it is not a usable number. */
export function mmFromMetres(text) {
  const n = Number(String(text ?? '').trim().replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? Math.round(n * 1000) : null;
}
export const metresText = (mm) => (Math.round(mm) / 1000).toFixed(1);

/** The ground floor rooms that are enclosed (not decks or carports). */
export const enclosedRooms = (project) => (ground(project)?.rooms || []).filter((r) => isEnclosed(r) && !NOT_FLOOR.includes(r.type));

/** The outline box of the enclosed rooms: { x, y, width, length } in mm, or null when there are none. */
export function overallOf(project) {
  const rooms = enclosedRooms(project);
  if (!rooms.length) return null;
  const b = G.bbox(rooms.flatMap((r) => r.polygon));
  return { x: Math.round(b.minX), y: Math.round(b.minY), width: Math.round(b.maxX - b.minX), length: Math.round(b.maxY - b.minY) };
}

/** Every room (indoor and outdoor) with its typed size: { id, name, type, width, depth, outdoor, area }. */
export function roomsOf(project) {
  return (ground(project)?.rooms || []).filter(usable).map((r) => {
    const b = G.bbox(r.polygon);
    return { id: r.id, name: r.name || r.type, type: r.type, outdoor: !!r.outdoor, x: Math.round(b.minX), y: Math.round(b.minY), width: Math.round(b.w), depth: Math.round(b.h), area: G.polygonArea(r.polygon) / 1e6 };
  });
}

/** Floor area in m2 of the enclosed rooms (decks, patios, carports and garages are not counted). Unrounded. */
export function floorAreaM2(project) {
  return enclosedRooms(project).reduce((s, r) => s + G.polygonArea(r.polygon), 0) / 1e6;
}

const clone = (p) => structuredClone(p);

// Overall size -----------------------------------------------------------------------------------------------------------------
function overallSteps(project, size) {
  const o = overallOf(project);
  const lvl = ground(project);
  if (!o || !lvl) return { error: 'There are no rooms to resize.' };
  const w = Math.round(size.width ?? o.width);
  const l = Math.round(size.length ?? o.length);
  if (!(w >= MIN_OVERALL_MM && w <= MAX_OVERALL_MM) || !(l >= MIN_OVERALL_MM && l <= MAX_OVERALL_MM)) return { error: `Type a width and a length between ${m(MIN_OVERALL_MM)} m and ${m(MAX_OVERALL_MM)} m.` };
  const steps = [];
  if (w !== o.width) steps.push({ A: { x: o.x + o.width, y: o.y }, B: { x: o.x + o.width, y: o.y + o.length }, move: { x: w - o.width, y: 0 } });
  if (l !== o.length) steps.push({ A: { x: o.x, y: o.y + o.length }, B: { x: o.x + (w !== o.width ? w : o.width), y: o.y + o.length }, move: { x: 0, y: l - o.length } });
  return { steps, o, width: w, length: l, levelId: lvl.id };
}

function applySteps(p, plan) {
  const level = p.levels.find((x) => x.id === plan.levelId);
  for (const s of plan.steps) pushPull(p, level, s.A, s.B, s.move);
}

/** Check what the new overall size would do, on a copy. { ok, error?, warnings, result } */
export function planOverall(project, size) {
  const plan = overallSteps(project, size);
  if (plan.error) return { ok: false, error: plan.error, warnings: [] };
  if (!plan.steps.length) return { ok: true, warnings: checkDesign(project).warnings, result: project };
  const result = clone(project);
  try { applySteps(result, plan); } catch (e) { return { ok: false, error: e.message || 'That size could not be made.', warnings: [] }; }
  const squashed = roomsOf(result).find((r) => !r.outdoor && Math.min(r.width, r.depth) < HARD_MIN_SIDE);
  if (squashed) return { ok: false, error: `That would squash ${squashed.name} to ${m(Math.min(squashed.width, squashed.depth))} m. Make the outline bigger, or resize that room first.`, warnings: [] };
  const o = overallOf(result);
  if (o && (Math.abs(o.width - plan.width) > 5 || Math.abs(o.length - plan.length) > 5)) return { ok: false, error: 'That is smaller than the rooms inside it. Resize the rooms first, or type a bigger size.', warnings: [] };
  return { ok: true, warnings: checkDesign(result).warnings, result };
}

/** Apply a new overall size to `project` in place (call inside store.apply). Throws with a plain message when it cannot be done. */
export function setOverall(project, size) {
  const plan = planOverall(project, size);
  if (!plan.ok) throw new Error(plan.error);
  const steps = overallSteps(project, size);
  applySteps(project, steps);
}

// One room -----------------------------------------------------------------------------------------------------------------------
/** Check what typing this room's width and depth would do. { ok, error?, warnings, neighbours, result } */
export function planRoomSize(project, roomId, size) {
  const lvl = ground(project);
  const room = lvl?.rooms.find((r) => r.id === roomId);
  if (!room) return { ok: false, error: 'That room no longer exists.', warnings: [], neighbours: [] };
  const width = size.width == null ? null : Math.round(size.width);
  const depth = size.depth == null ? null : Math.round(size.depth);
  if ((width != null && width < HARD_MIN_SIDE) || (depth != null && depth < HARD_MIN_SIDE)) return { ok: false, error: `A room needs to be at least ${m(HARD_MIN_SIDE)} m each way.`, warnings: [], neighbours: [] };
  if ((width != null && width > MAX_OVERALL_MM) || (depth != null && depth > MAX_OVERALL_MM)) return { ok: false, error: 'That is bigger than a granny flat site can take.', warnings: [], neighbours: [] };
  const sim = planSetSize(project, roomId, { width, depth });
  if (!sim.ok) return { ok: false, error: sim.error, warnings: [], neighbours: [] };
  return { ok: true, warnings: checkDesign(sim.result).warnings, neighbours: (sim.neighbours || []).map((n) => ({ id: n.roomId, name: n.name, after: n.after })), result: sim.result, steps: sim.steps };
}

/** Apply a typed room size in place (call inside store.apply). The room's east and south walls move; rooms that share them adjust. */
export function setRoomSize(project, roomId, size) {
  const plan = planRoomSize(project, roomId, size);
  if (!plan.ok) throw new Error(plan.error);
  for (const s of plan.steps || []) applyOp(project, 'resize_room', { id: roomId, ...s });
}

// Add room --------------------------------------------------------------------------------------------------------------------------
const rectsOverlap = (a, b) => a.x < b.x + b.width - 1 && b.x < a.x + a.width - 1 && a.y < b.y + b.depth - 1 && b.y < a.y + a.depth - 1;

/** Where a new room of this size goes: against the east side of the building first (decks the south side first), clear of every room. */
export function placeNewRoom(project, size, { type = 'other' } = {}) {
  const o = overallOf(project);
  const rooms = roomsOf(project);
  if (!o) return { x: 0, y: 0 };
  const east = { x: o.x + o.width, y: o.y };
  const south = { x: o.x, y: o.y + o.length };
  const west = { x: o.x - size.width, y: o.y };
  const north = { x: o.x, y: o.y - size.depth };
  const order = type === 'deck' || type === 'patio' ? [south, east, west, north] : [east, south, west, north];
  for (const c of order) {
    const r = { x: c.x, y: c.y, width: size.width, depth: size.depth };
    if (!rooms.some((x) => rectsOverlap(r, x))) return c;
  }
  return { x: o.x + o.width, y: o.y + o.length };
}

/** A name that is not used yet: "Bedroom", "Bedroom 2", "Bedroom 3". */
export function nextName(project, label) {
  const names = new Set(roomsOf(project).map((r) => r.name));
  if (!names.has(label)) return label;
  for (let i = 2; i < 50; i++) if (!names.has(`${label} ${i}`)) return `${label} ${i}`;
  return label;
}

/** Add a preset room (sizes may be typed over) in place. Returns the new room id. */
export function addPresetRoom(project, presetId, size = {}) {
  const preset = ROOM_PRESETS.find((x) => x.id === presetId);
  if (!preset) throw new Error('Pick one of the room types.');
  const width = Math.round(size.width ?? preset.width);
  const depth = Math.round(size.depth ?? preset.depth);
  if (!(width >= HARD_MIN_SIDE) || !(depth >= HARD_MIN_SIDE)) throw new Error(`A room needs to be at least ${m(HARD_MIN_SIDE)} m each way.`);
  const at = placeNewRoom(project, { width, depth }, { type: preset.type });
  const lvl = ground(project);
  const out = applyOp(project, 'add_room', { level: lvl.id, name: nextName(project, preset.label), type: preset.type, x: at.x, y: at.y, width, depth });
  return out.id;
}

// Checks --------------------------------------------------------------------------------------------------------------------------------
/** Floor area against 60 m2 and rooms under a usable size. Warnings only. { areaM2, overArea, rooms: [{ id, name, warning }], warnings } */
export function checkDesign(project) {
  const areaM2 = floorAreaM2(project);
  const overArea = areaM2 > GRANNY_MAX_M2 + 1e-9;
  const warnings = [];
  const rooms = [];
  if (overArea) warnings.push(`The floor area is ${areaM2.toFixed(1)} m2. A granny flat is limited to ${GRANNY_MAX_M2} m2, so this is over by ${(areaM2 - GRANNY_MAX_M2).toFixed(1)} m2. You can keep designing, but check it before you rely on it.`);
  for (const r of roomsOf(project)) {
    const small = Math.min(r.width, r.depth);
    let w = null;
    if (r.type === 'bedroom' && small < MIN_BEDROOM_MM) w = `${r.name} is ${m(r.width)} x ${m(r.depth)} m. A bedroom is usable from ${m(MIN_BEDROOM_MM)} m each way.`;
    else if (r.type === 'bathroom' && small < MIN_BATHROOM_MM) w = `${r.name} is ${m(r.width)} x ${m(r.depth)} m. A bathroom is usable from ${m(MIN_BATHROOM_MM)} m each way.`;
    if (w) { rooms.push({ id: r.id, name: r.name, warning: w }); warnings.push(w); }
  }
  return { areaM2: Math.round(areaM2 * 100) / 100, overArea, rooms, warnings };
}

/** True for the granny flat designs (the library's granny flat plans, or a design the person named one). */
export const isGrannyDesign = (project) => /granny/i.test(`${project?.placedHouse?.id || ''} ${project?.placedHouse?.name || ''} ${project?.name || ''}`);
