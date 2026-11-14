// Pavement markings and fixed items: bay lines, accessible bay symbol and shared zone hatch (AS/NZS 2890.6 style, check the edition),
// directional arrows, pedestrian crossing, give way and stop bars, wheel stops, speed humps, loading zone hatch and keep clear.
// Indicative concept symbology, line marking and signs are designed to the relevant AS 1742 and AS/NZS 2890 parts (check with council).
// Each marking is placed as { type, x, y, rotationDeg, ... } in plan mm; rotationDeg turns the local +u axis (the direction of travel for
// arrows) from plan +x towards plan +y, as rows do. markingGeometry() gives the paint polygons in plan coordinates, pure and DOM free.

import { stripePolys, strokePolys, toPlan, absArea } from './geom.js';

export const PAINT = Object.freeze({ white: '#f2f0e6', yellow: '#e8c21a', blue: '#1d5fb4' });

const M = (o) => Object.freeze(o);

export const MARKINGS = Object.freeze([
  M({ id: 'bay-lines', label: 'Bay lines', unit: 'bay', rateKey: 'bay-lines', colour: PAINT.white, note: 'Two side lines per bay, 100 mm wide, 5.4 m long' }),
  M({ id: 'accessible-symbol', label: 'Accessible bay symbol', unit: 'item', rateKey: 'accessible-symbol', colour: PAINT.blue, note: 'Blue square with the wheelchair symbol, painted in the bay' }),
  M({ id: 'accessible-hatch', label: 'Accessible shared zone hatch', unit: 'item', rateKey: 'accessible-hatch', colour: PAINT.yellow, note: 'Diagonal hatch in the shared zone between accessible bays' }),
  M({ id: 'arrow-straight', label: 'Directional arrow, straight', unit: 'item', rateKey: 'arrow', colour: PAINT.white }),
  M({ id: 'arrow-left', label: 'Directional arrow, left', unit: 'item', rateKey: 'arrow', colour: PAINT.white }),
  M({ id: 'arrow-right', label: 'Directional arrow, right', unit: 'item', rateKey: 'arrow', colour: PAINT.white }),
  M({ id: 'ped-crossing', label: 'Pedestrian crossing', unit: 'item', rateKey: 'ped-crossing', colour: PAINT.white, note: 'Stripes 400 mm wide at 1 m centres' }),
  M({ id: 'give-way', label: 'Give way line', unit: 'item', rateKey: 'give-way', colour: PAINT.white }),
  M({ id: 'stop-bar', label: 'Stop bar', unit: 'item', rateKey: 'stop-bar', colour: PAINT.white }),
  M({ id: 'wheel-stop', label: 'Wheel stop', unit: 'item', rateKey: 'wheel-stop', colour: '#d6d3c8', note: 'Precast concrete 1800 mm long, 600 mm from the end of the bay' }),
  M({ id: 'speed-hump', label: 'Speed hump', unit: 'item', rateKey: 'speed-hump', colour: PAINT.yellow, note: 'Low profile, 75 mm high' }),
  M({ id: 'loading-zone-hatch', label: 'Loading zone hatch', unit: 'item', rateKey: 'loading-zone-hatch', colour: PAINT.yellow }),
  M({ id: 'keep-clear', label: 'Keep clear marking', unit: 'item', rateKey: 'keep-clear', colour: PAINT.yellow }),
]);

const BY_ID = new Map(MARKINGS.map((m) => [m.id, m]));
export const markingById = (id) => BY_ID.get(id) || null;
export const isMarkingType = (id) => BY_ID.has(id);

export const BAY_LINE_MM = 100;
export const WHEEL_STOP = Object.freeze({ lengthMm: 1800, widthMm: 150, heightMm: 100, fromBayEndMm: 600 });
export const SPEED_HUMP = Object.freeze({ lengthMm: 3700, widthMm: 3000, heightMm: 75 });
export const ACCESSIBLE_SYMBOL_MM = 900;
const CROSSING = Object.freeze({ stripeMm: 400, pitchMm: 1000, widthMm: 2400 });

const P = (item, pts) => pts.map(([x, y]) => toPlan(item, x, y));
const rect = (item, x0, y0, x1, y1) => P(item, [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]);
const paint = (polygon, colour) => ({ polygon, colour, kind: 'paint' });

function arrowPolys(item, kind) {
  const s = item.scale || 1;
  const shaftW = 150 * s;
  // The path is in local mm: starts behind, runs along +u, bends 40 degrees to the side for left or right.
  const side = kind === 'arrow-left' ? -1 : kind === 'arrow-right' ? 1 : 0;
  const a = [-1000 * s, 0];
  const b = side ? [-100 * s, 0] : [500 * s, 0];
  const bend = Math.PI / 4;
  const tip = side ? [b[0] + Math.cos(bend) * 900 * s, side * Math.sin(bend) * 900 * s] : [1100 * s, 0];
  const pathPts = side ? [a, b, [b[0] + Math.cos(bend) * 500 * s, side * Math.sin(bend) * 500 * s]] : [a, b];
  const last = pathPts[pathPts.length - 1];
  const dir = side ? { x: Math.cos(bend), y: side * Math.sin(bend) } : { x: 1, y: 0 };
  const nrm = { x: -dir.y, y: dir.x };
  const hw = 380 * s;
  const head = [[last[0] + nrm.x * hw, last[1] + nrm.y * hw], [tip[0], tip[1]], [last[0] - nrm.x * hw, last[1] - nrm.y * hw]];
  const out = strokePolys(pathPts.map(([x, y]) => toPlan(item, x, y)), shaftW).map((q) => paint(q, PAINT.white));
  out.push(paint(P(item, head), PAINT.white));
  return out;
}

/**
 * markingGeometry(item) -> { polygons: [{ polygon, colour, kind }], symbol?: { type, centre, sizeMm, rotationDeg }, solid?: { type, ... } }
 * Items of type 'bay-lines' carry { lines: [[a, b], ...] } (plan points) and are stroked here. A 'wheel-stop' and a 'speed-hump' also
 * return `solid`, an oriented box or prism for the 3D view.
 */
export function markingGeometry(item) {
  const id = item.type;
  const polys = [];
  const out = { polygons: polys };
  switch (id) {
    case 'bay-lines':
      for (const [a, b] of item.lines || []) for (const q of strokePolys([a, b], BAY_LINE_MM)) polys.push(paint(q, PAINT.white));
      break;
    case 'accessible-symbol': {
      const h = (item.sizeMm || ACCESSIBLE_SYMBOL_MM) / 2;
      polys.push(paint(rect(item, -h, -h, h, h), PAINT.blue));
      out.symbol = { type: 'accessible', centre: { x: item.x, y: item.y }, sizeMm: h * 2, rotationDeg: item.rotationDeg || 0 };
      break;
    }
    case 'accessible-hatch':
    case 'loading-zone-hatch': {
      const poly = item.polygon || (id === 'loading-zone-hatch' ? rect(item, -(item.lengthMm || 6000) / 2, -(item.widthMm || 3000) / 2, (item.lengthMm || 6000) / 2, (item.widthMm || 3000) / 2) : []);
      if (poly.length < 3) break;
      for (const q of stripePolys(poly, (item.rotationDeg || 0) + 45, 100, id === 'accessible-hatch' ? 200 : 300)) polys.push(paint(q, PAINT.yellow));
      // border lines of the zone
      const border = [...poly, poly[0]];
      for (const q of strokePolys(border, BAY_LINE_MM)) polys.push(paint(q, PAINT.yellow));
      break;
    }
    case 'arrow-straight':
    case 'arrow-left':
    case 'arrow-right':
      polys.push(...arrowPolys(item, id));
      break;
    case 'ped-crossing': {
      const len = item.lengthMm || 5800; // across the traffic, along v
      const wid = item.widthMm || CROSSING.widthMm; // stripe length, along u (the traffic direction)
      const n = Math.max(1, Math.floor((len - CROSSING.stripeMm) / CROSSING.pitchMm) + 1);
      const used = (n - 1) * CROSSING.pitchMm + CROSSING.stripeMm;
      for (let i = 0; i < n; i++) {
        const y0 = -used / 2 + i * CROSSING.pitchMm;
        polys.push(paint(rect(item, -wid / 2, y0, wid / 2, y0 + CROSSING.stripeMm), PAINT.white));
      }
      out.stripes = n;
      break;
    }
    case 'give-way': {
      const w = item.widthMm || 3000;
      const n = Math.floor(w / 600);
      const x0 = -(n * 600) / 2;
      for (let i = 0; i < n; i++) polys.push(paint(P(item, [[0, x0 + i * 600], [0, x0 + i * 600 + 600], [-900, x0 + i * 600 + 300]]), PAINT.white));
      break;
    }
    case 'stop-bar': {
      const w = item.widthMm || 3000;
      polys.push(paint(rect(item, -150, -w / 2, 150, w / 2), PAINT.white));
      break;
    }
    case 'wheel-stop': {
      const { lengthMm, widthMm, heightMm } = WHEEL_STOP;
      polys.push({ polygon: rect(item, -widthMm / 2, -lengthMm / 2, widthMm / 2, lengthMm / 2), colour: '#d6d3c8', kind: 'solid' });
      out.solid = { type: 'box', centre: { x: item.x, y: item.y }, rotationDeg: item.rotationDeg || 0, uMm: widthMm, vMm: lengthMm, heightMm };
      break;
    }
    case 'speed-hump': {
      const { lengthMm, widthMm, heightMm } = SPEED_HUMP;
      const L = item.lengthMm || lengthMm;
      const W = item.widthMm || widthMm;
      polys.push({ polygon: rect(item, -L / 2, -W / 2, L / 2, W / 2), colour: '#8d8a80', kind: 'solid' });
      // yellow chevrons across the hump
      const n = Math.floor(L / 700);
      for (let i = 0; i < n; i++) {
        const x = -L / 2 + 350 + i * 700;
        polys.push(paint(P(item, [[x - 120, -W / 2], [x + 120, -W / 2], [x + 120, W / 2], [x - 120, W / 2]]), PAINT.yellow));
      }
      out.solid = { type: 'hump', centre: { x: item.x, y: item.y }, rotationDeg: item.rotationDeg || 0, lengthMm: L, widthMm: W, heightMm };
      break;
    }
    case 'keep-clear': {
      const L = item.lengthMm || 3600;
      const W = item.widthMm || 3000;
      const border = P(item, [[-L / 2, -W / 2], [L / 2, -W / 2], [L / 2, W / 2], [-L / 2, W / 2], [-L / 2, -W / 2]]);
      for (const q of strokePolys(border, BAY_LINE_MM)) polys.push(paint(q, PAINT.yellow));
      for (const seg of [[[-L / 2, -W / 2], [L / 2, W / 2]], [[-L / 2, W / 2], [L / 2, -W / 2]]]) for (const q of strokePolys(seg.map(([x, y]) => toPlan(item, x, y)), BAY_LINE_MM)) polys.push(paint(q, PAINT.yellow));
      break;
    }
    default:
      break;
  }
  out.areaMm2 = polys.reduce((s, p) => s + absArea(p.polygon), 0);
  return out;
}

/**
 * Draws the accessible wheelchair symbol (white on the blue square) into a canvas 2D context, centred at (cx, cy), size = side of the
 * square in pixels. Used by the 3D decal texture and the plan view. Crisp vector drawing, no bitmap scaling.
 */
export function drawAccessibleIcon(g, cx, cy, size) {
  const u = size / 100;
  g.save();
  g.translate(cx - size / 2, cy - size / 2);
  g.fillStyle = PAINT.blue;
  g.fillRect(0, 0, size, size);
  g.strokeStyle = '#ffffff';
  g.fillStyle = '#ffffff';
  g.lineCap = 'round';
  g.lineJoin = 'round';
  g.lineWidth = 7 * u;
  g.beginPath(); g.arc(44 * u, 20 * u, 7 * u, 0, Math.PI * 2); g.fill(); // head
  g.beginPath(); g.moveTo(44 * u, 32 * u); g.lineTo(44 * u, 56 * u); g.lineTo(66 * u, 56 * u); g.lineTo(74 * u, 76 * u); g.stroke(); // body, thigh, shin
  g.beginPath(); g.moveTo(44 * u, 42 * u); g.lineTo(62 * u, 42 * u); g.stroke(); // arm
  g.beginPath(); g.arc(44 * u, 62 * u, 19 * u, Math.PI * 0.55, Math.PI * 1.9); g.stroke(); // wheel
  g.restore();
}

/** Counts by marking id for a list of placed items (an item may carry `count`, default 1). */
export function countMarkings(items) {
  const m = new Map();
  for (const it of items) m.set(it.type, (m.get(it.type) || 0) + (it.count ?? 1));
  return m;
}
