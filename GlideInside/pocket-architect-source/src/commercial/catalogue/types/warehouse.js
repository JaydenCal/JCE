// Warehouse with loading docks: clear span, 1 to 8 docks (levellers, canopy), flush or recessed docks, an office pod at a front corner (single or
// two storey), a B-double or articulated truck apron, roller doors at grade and skylights. Local frame: front edge on y = 0, body in y >= 0,
// the street and the apron toward -y. Built with the Plan kit (see _kitB.js); the car park sits in front of the office pod, the apron beside it.

import { Plan, num, sel, bool, makeType, rectPoly, emit3d } from './_kitB.js';

const TRUCKS = { MRV: { label: 'Medium rigid truck (MRV)', apron: 16000 }, HRV: { label: 'Heavy rigid truck (HRV)', apron: 22000 }, AV: { label: 'Articulated vehicle (AV)', apron: 28000 }, B99: { label: 'B-double (B99)', apron: 36000 } };

const defs = [
  num('spanMm', 'Clear span (building width)', 'mm', 15000, 60000, 500, 30000),
  num('depthMm', 'Building length', 'mm', 20000, 120000, 500, 50000),
  num('eaveHeightMm', 'Eave height', 'mm', 5000, 14000, 500, 9000),
  sel('roofType', 'Roof', [{ value: 'gable', label: 'Gable, falls to each side' }, { value: 'skillion', label: 'Skillion, falls to the rear' }, { value: 'flat', label: 'Flat with parapet' }], 'gable'),
  num('roofPitchDeg', 'Roof pitch', 'deg', 2, 15, 1, 5),
  num('docks', 'Loading docks', '', 1, 8, 1, 4),
  num('dockSpacingMm', 'Dock spacing (centre to centre)', 'mm', 3500, 5000, 100, 3500),
  sel('dockType', 'Dock type', [{ value: 'flush', label: 'Flush with the wall' }, { value: 'recessed', label: 'Recessed bays' }], 'flush'),
  bool('levellers', 'Dock levellers', true),
  bool('dockCanopy', 'Dock canopy', true),
  num('groundDoors', 'Roller doors at grade', '', 0, 4, 1, 1),
  sel('officePod', 'Office pod at a front corner', [{ value: 'none', label: 'None' }, { value: 'single', label: 'Single storey' }, { value: 'two', label: 'Two storey' }], 'two'),
  sel('podSide', 'Office pod corner', [{ value: 'left', label: 'Left, seen from the street' }, { value: 'right', label: 'Right, seen from the street' }], 'left'),
  num('officeWidthMm', 'Office pod width', 'mm', 6000, 20000, 500, 8000),
  num('officeDepthMm', 'Office pod depth', 'mm', 6000, 16000, 500, 8000),
  sel('truckDesign', 'Design truck on the apron', Object.entries(TRUCKS).map(([value, t]) => ({ value, label: t.label })), 'B99'),
  num('apronDepthMm', 'Truck apron depth from the dock face', 'mm', 10000, 45000, 500, 36000),
  num('skylightPct', 'Skylights, percent of roof', '%', 0, 10, 1, 4),
];

const DOCK_W = 2500;
const DOCK_H = 2800;
const DOCK_SILL = 1300;
const GRADE_W = 4500;
const GRADE_H = 5000;
const MARGIN = 1000;
const RECESS_MM = 1800;
const CANOPY_D = 4000;
const CANOPY_Z = 4800;
const CAR_ZONE_MM = 9000;
const AISLE = 5800;
const FLOOR_TO_FLOOR = 3600;

export const WAREHOUSE_PRESETS = [
  { id: 'small', label: 'Small, 20 x 36 m, 2 docks', params: { spanMm: 20000, depthMm: 36000, docks: 2, officePod: 'single', officeWidthMm: 8000, officeDepthMm: 8000, eaveHeightMm: 8000, apronDepthMm: 28000, truckDesign: 'AV' } },
  { id: 'medium', label: 'Medium, 30 x 50 m, 4 docks', params: {} },
  { id: 'large', label: 'Large, 40 x 70 m, 6 docks', params: { spanMm: 40000, depthMm: 70000, docks: 6, eaveHeightMm: 10000, officeWidthMm: 12000 } },
];

/** The layout along the frontage in the canonical frame (office pod at the left). */
function layout(p) {
  const W = p.spanMm;
  const pod = p.officePod !== 'none';
  const carW = pod ? p.officeWidthMm : CAR_ZONE_MM;
  const start = carW + MARGIN;
  const gradeStart = W - MARGIN - p.groundDoors * (GRADE_W + 1500) + 1500;
  const room = Math.max(0, gradeStart - 1500 - start);
  const spacing = Math.max(3300, Math.min(p.dockSpacingMm, room / Math.max(1, p.docks)));
  const span = p.docks * spacing;
  const dx0 = start;
  const dx1 = start + span;
  const issues = [];
  if (dx1 + MARGIN > W - (p.groundDoors ? p.groundDoors * (GRADE_W + 1500) : 0)) issues.push({ id: 'dockspan', kind: 'warn', text: `The ${p.docks} docks and ${p.groundDoors} grade doors do not fit along the ${(W / 1000).toFixed(1)} m frontage beside the ${pod ? 'office pod' : 'car park'}, widen the span or reduce the docks` });
  if (spacing < p.dockSpacingMm - 1) issues.push({ id: 'dockspacing', kind: 'info', text: `Dock spacing reduced to ${(spacing / 1000).toFixed(1)} m to fit the frontage` });
  const want = TRUCKS[p.truckDesign].apron;
  if (p.apronDepthMm < want) issues.push({ id: 'apron', kind: 'warn', text: `Apron depth ${(p.apronDepthMm / 1000).toFixed(0)} m is under the ${(want / 1000).toFixed(0)} m indicated for the ${TRUCKS[p.truckDesign].label.toLowerCase()}, check the swept path to AS 2890.2` });
  if (p.officePod !== 'none' && p.officeWidthMm + 2 * MARGIN > W) issues.push({ id: 'pod', kind: 'warn', text: 'The office pod is wider than the frontage allows' });
  if (p.eaveHeightMm < 7000 && p.docks > 0) issues.push({ id: 'clear', kind: 'info', text: 'Eave height under 7 m limits racking and dock canopy clearance, check the operator needs' });
  return { W, pod, carW, start, spacing, span, dx0, dx1, issues, gradeStart };
}

function build(p) {
  const pl = new Plan();
  const L = layout(p);
  const { W } = L;
  const D = p.depthMm;
  const H = p.eaveHeightMm;
  const flip = p.podSide === 'right';
  const X = (x) => (flip ? W - x : x);
  const P = (x, y) => ({ x: X(x), y });
  const R = (x0, y0, x1, y1) => { const a = X(x0); const b = X(x1); return rectPoly(Math.min(a, b), y0, Math.max(a, b), y1); };
  const recessed = p.dockType === 'recessed';
  const two = p.officePod === 'two';
  const podH = FLOOR_TO_FLOOR;
  pl.levels[0].heightMm = H;
  if (two) pl.level('Level 1', FLOOR_TO_FLOOR, 3200);

  // Walls ---------------------------------------------------------------------------------------------------------------
  const sides = pl.rect(0, 0, W, D, { height: H, skip: ['front'] });
  const out = (x, y) => ({ x, y });
  const frontSegs = [];
  const F = (x0, y0, x1, y1, ox, oy) => { const a = P(x0, y0); const b = P(x1, y1); const w = pl.wall(a, b, { height: H, out: out(flip ? -ox : ox, oy) }); return w; };
  let dockWall;
  let gradeWall;
  if (recessed && p.docks > 0) {
    const a0 = L.dx0 - 700;
    const a1 = L.dx1 + 700;
    const wl = F(0, 0, a0, 0, 0, -1);
    F(a0, 0, a0, RECESS_MM, 1, 0);
    dockWall = F(a0, RECESS_MM, a1, RECESS_MM, 0, -1);
    F(a1, RECESS_MM, a1, 0, -1, 0);
    const wr = F(a1, 0, W, 0, 0, -1);
    frontSegs.push(wl, wr);
    gradeWall = wr;
    pl.recessZone = { a0, a1 };
  } else {
    const w = F(0, 0, W, 0, 0, -1);
    dockWall = w;
    gradeWall = w;
    frontSegs.push(w);
  }
  const frontPod = frontSegs[0];
  const dockY = recessed && p.docks > 0 ? RECESS_MM : 0;

  // Office pod: ground and first floor partitions inside the footprint, glazing and the entry on the front wall.
  const podRooms = [];
  if (L.pod) {
    const pw = p.officeWidthMm;
    const pd = p.officeDepthMm;
    pl.wall(P(0, pd), P(pw, pd), { kind: 'interior', thickness: 150, height: podH });
    pl.wall(P(pw, pd), P(pw, 0), { kind: 'interior', thickness: 150, height: podH });
    if (two) {
      pl.wall(P(0, pd), P(pw, pd), { kind: 'interior', thickness: 150, height: 3200, level: 'Level 1' });
      pl.wall(P(pw, pd), P(pw, 0), { kind: 'interior', thickness: 150, height: 3200, level: 'Level 1' });
    }
    const g = pl.room('PROPOSED OFFICE', 'other', R(0, 0, pw, pd), { use: 'office' });
    g.ceilingMm = podH;
    if (two) { const u = pl.room('PROPOSED OFFICE FIRST FLOOR', 'other', R(0, 0, pw, pd), { use: 'office', level: 'Level 1' }); u.ceilingMm = 3200; }
    pl.openAt(frontPod, X(1500), 0, 'door', 1000, 2100, 0, { style: 'single' });
    const ww = Math.max(1500, pw - 3600);
    pl.openAt(frontPod, X(2800 + ww / 2), 0, 'window', ww, 1800, 900, { style: 'fixed' });
    if (two) pl.openAt(frontPod, X(pw / 2), 0, 'window', Math.max(2000, pw - 2000), 1800, FLOOR_TO_FLOOR + 900, { style: 'fixed' });
    podRooms.push(g);
    const stairX = pw - 1500;
    pl.stairs = [{ x: X(stairX), y: pd - 2200, width: 1000, length: 3600, rotation: 90 }];
  }

  // Rooms: the warehouse floor is the footprint less the pod and the dock recess.
  const front = [];
  const podW = L.pod ? p.officeWidthMm : 0;
  const walk = [];
  if (recessed && p.docks > 0) {
    const { a0, a1 } = pl.recessZone;
    front.push([a0, 0], [a0, RECESS_MM], [a1, RECESS_MM], [a1, 0]);
  }
  if (L.pod) { walk.push([podW, 0], ...front, [W, 0], [W, D], [0, D], [0, p.officeDepthMm], [podW, p.officeDepthMm]); } else { walk.push([0, 0], ...front, [W, 0], [W, D], [0, D]); }
  const whRoom = pl.room('PROPOSED WAREHOUSE', 'workshop', walk.map(([x, y]) => P(x, y)), { use: 'warehouse' });
  whRoom.ceilingMm = H;
  pl.outline = rectPoly(0, 0, W, D);

  // Dock and grade doors ------------------------------------------------------------------------------------------------
  const dockX = [];
  for (let i = 0; i < p.docks; i++) {
    const cx = L.dx0 + L.spacing * (i + 0.5);
    dockX.push(cx);
    pl.openAt(dockWall, X(cx), dockY, 'roller_door', DOCK_W, DOCK_H, DOCK_SILL, { tag: 'dock' });
  }
  for (let j = 0; j < p.groundDoors; j++) {
    const cx = W - MARGIN - GRADE_W / 2 - j * (GRADE_W + 1500);
    pl.openAt(gradeWall, X(cx), 0, 'roller_door', GRADE_W, GRADE_H, 0, { motorised: true });
  }

  // Roof ----------------------------------------------------------------------------------------------------------------
  pl.roofs.push({ polygon: rectPoly(0, 0, W, D), type: p.roofType, pitchDeg: p.roofType === 'flat' ? 2 : p.roofPitchDeg, level: 'Ground', baseMm: H, overhangMm: 300, ridge: 'y', fall: 'rear' });

  // Extras (plan) -------------------------------------------------------------------------------------------------------
  const apronX0 = L.carW;
  const A = p.apronDepthMm;
  pl.extras.push({ kind: 'apron', polygon: R(apronX0, -A, W, 0).map((q) => ({ ...q })), label: `TRUCK APRON ${(A / 1000).toFixed(0)} m, ${TRUCKS[p.truckDesign].label.toUpperCase()}` });
  if (recessed && p.docks > 0) pl.extras.push({ kind: 'dock-recess', polygon: R(pl.recessZone.a0, 0, pl.recessZone.a1, RECESS_MM) });
  if (p.dockCanopy && p.docks > 0 && !recessed) pl.extras.push({ kind: 'canopy', polygon: R(L.dx0 - 700, -CANOPY_D, L.dx1 + 700, 0), label: 'DOCK CANOPY', heightMm: CANOPY_Z, posts: true });
  pl.zone = flip ? { x0: W - L.carW, x1: W, offsetMm: AISLE } : { x0: 0, x1: L.carW, offsetMm: AISLE };

  // 3D props: seals, bumpers, levellers, canopy structure, skylights -------------------------------------------------------
  const S = (x) => X(x);
  const bx = (x0, y0, x1, y1, z0, z1, slot, colour) => { const a = S(x0); const b = S(x1); pl.box(slot, Math.min(a, b), y0, Math.max(a, b), y1, z0, z1, slot, colour); };
  const yf = dockY;
  dockX.forEach((cx, i) => {
    bx(cx - 1450, yf - 350, cx - 1250, yf, DOCK_SILL, DOCK_SILL + DOCK_H + 250, 'seal', '#2b2f33');
    bx(cx + 1250, yf - 350, cx + 1450, yf, DOCK_SILL, DOCK_SILL + DOCK_H + 250, 'seal', '#2b2f33');
    bx(cx - 1450, yf - 350, cx + 1450, yf, DOCK_SILL + DOCK_H, DOCK_SILL + DOCK_H + 250, 'seal', '#2b2f33');
    bx(cx - 1100, yf - 250, cx - 900, yf, 1150, 1500, 'bumper', '#141414');
    bx(cx + 900, yf - 250, cx + 1100, yf, 1150, 1500, 'bumper', '#141414');
    if (p.levellers) {
      bx(cx - 1150, yf - 1800, cx + 1150, yf, 1150, 1250, 'steel', '#7b8187');
      bx(cx - 1150, yf - 1800, cx + 1150, yf - 1650, 1150, 1260, 'steel', '#c9a227');
    }
    pl.sym({ pts: [P(cx - 1150, yf), P(cx + 1150, yf), P(cx + 1150, yf - 1800), P(cx - 1150, yf - 1800)], closed: true, stroke: '#555', fill: 'rgba(201,162,39,0.35)', w: 40 });
    pl.sym({ t: 'text', ...P(cx, yf - 2600), text: `D${i + 1}`, size: 700, fill: '#444' });
  });
  if (p.dockCanopy && p.docks > 0 && !recessed) {
    const c0 = L.dx0 - 700;
    const c1 = L.dx1 + 700;
    bx(c0, -CANOPY_D, c1, 0, CANOPY_Z, CANOPY_Z + 250, 'canopy', '#e9ecef');
    for (const x of [c0 + 150, c1 - 150]) bx(x - 125, -CANOPY_D + 100, x + 125, -CANOPY_D + 350, 0, CANOPY_Z, 'steel', '#6b7480');
  }
  if (p.skylightPct > 0 && p.roofType !== 'flat') {
    const n = Math.max(2, Math.ceil(((p.skylightPct / 100) * W * D) / 4.5e6));
    const perSide = Math.ceil(n / 2);
    const tan = Math.tan((p.roofPitchDeg * Math.PI) / 180);

    for (let k = 0; k < perSide; k++) {
      const y = (D / (perSide + 1)) * (k + 1);
      for (const x of p.roofType === 'gable' ? [W * 0.25, W * 0.75] : [W * 0.3, W * 0.7]) {
        const zz = p.roofType === 'gable' ? H + Math.min(x, W - x) * tan : H + (D - y) * tan;
        bx(x - 750, y - 1500, x + 750, y + 1500, zz + 20, zz + 140, 'glass', '#a8cfe0');
      }
    }
  }
  pl.meta = { layout: L, issues: L.issues, dockX, flip };
  return pl;
}

function siteFn(p, plan) {
  const L = plan.meta.layout;
  const u = plan.uses;
  return {
    parking: { ratePerM2: [{ use: 'warehouse', per: 300, m2: Math.round((u.warehouse || 0) * 10) / 10 }, { use: 'office', per: 40, m2: Math.round((u.office || 0) * 10) / 10 }], accessible: true, zone: plan.zone },
    vehicles: { design: p.truckDesign, apronDepthMm: p.apronDepthMm, docks: p.docks },
    landscapeFrontMm: 3000,
    notes: [
      'Parking rates are indicative: 1 per 300 m2 of warehouse floor and 1 per 40 m2 of office floor, check with council.',
      `Truck apron ${(p.apronDepthMm / 1000).toFixed(0)} m deep for the ${TRUCKS[p.truckDesign].label.toLowerCase()}, check the swept path to AS 2890.2.`,
      ...(L.issues.filter((i) => i.kind === 'info').map((i) => i.text)),
    ],
  };
}

const base = makeType({
  id: 'warehouse', label: 'Warehouse with loading docks', category: 'industrial', zonesHint: ['E4', 'E5', 'IN1', 'IN2'], planLabel: 'PROPOSED WAREHOUSE',
  costHints: { buildRateKey: 'warehouse', notes: 'Metal clad portal frame warehouse with docks, an office pod and a truck apron. ESTIMATE, check with a quantity surveyor.' },
}, defs, build, siteFn);

export default {
  ...base,
  presets: WAREHOUSE_PRESETS,
  footprint(params) {
    const pl = build(resolveParams(params));
    return { outline: pl.outline.map((q) => ({ ...q })), extras: pl.extras.map((e) => ({ ...e, polygon: e.polygon.map((q) => ({ ...q })) })) };
  },
  checks(params) { return build(resolveParams(params)).meta.issues; },
  view3d(params, ctx = {}) { return emit3d(build(resolveParams(params)), ctx); },
};

import { resolve as resolveP } from './_kitB.js';
function resolveParams(params) { return resolveP(params, defs); }
