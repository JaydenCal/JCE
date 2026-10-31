// ASCII DXF R12 (AC1009) export. Pure function, Node compatible. See docs/SCOPE.md 8.2 and Appendix B.
// Units millimetres. DXF Y = minus plan y so the plan reads the same way up. Levels sit side by side.

import { furnitureStrokes } from './symbols.js';
import * as G from '../../model/geometry.js';
import {
  ascii, levelsSorted, levelTitle, wallShapes, doorGeometry, openingLines, stairGeometry, furnitureSize,
  furnitureCorners, outlineBox, eavesBox, dimensionsFor,
} from './shared.js';
import { planSheets } from './pdf.js';
import { BRAND } from '../brand/logo.js';
import { scaleBarSpec, barLabel, titleBlockValues, paperOf } from './drawing.js';

export const LEVEL_GAP_MM = 5000;

// Appendix B. `key` is the default layer name; layerMap renames them.
export const DXF_LAYERS = [
  { key: 'PS-WALL-NEW', aci: 7, ltype: 'CONTINUOUS', note: 'New walls' },
  { key: 'PS-WALL-EXIST', aci: 8, ltype: 'CONTINUOUS', note: 'Existing walls' },
  { key: 'PS-WALL-DEMO', aci: 1, ltype: 'DASHED', note: 'Walls to be demolished' },
  { key: 'PS-DOOR', aci: 3, ltype: 'CONTINUOUS', note: 'Door leaves and swings' },
  { key: 'PS-WIN', aci: 4, ltype: 'CONTINUOUS', note: 'Windows' },
  { key: 'PS-ROOM', aci: 9, ltype: 'CONTINUOUS', note: 'Room outlines' },
  { key: 'PS-TEXT', aci: 2, ltype: 'CONTINUOUS', note: 'Room names and areas, titles' },
  { key: 'PS-DIM', aci: 6, ltype: 'CONTINUOUS', note: 'Dimension lines and text' },
  { key: 'PS-FURN', aci: 8, ltype: 'CONTINUOUS', note: 'Furniture' },
  { key: 'PS-STAIR', aci: 5, ltype: 'CONTINUOUS', note: 'Stairs' },
  { key: 'PS-SITE', aci: 30, ltype: 'CONTINUOUS', note: 'Tanks and decks' },
  { key: 'PS-ROOF', aci: 1, ltype: 'DASHED', note: 'Roof outline at eaves' },
  { key: 'PS-TITLE', aci: 5, ltype: 'CONTINUOUS', note: 'Title block text and scale bar' },
  { key: 'PS-ANNO', aci: 7, ltype: 'CONTINUOUS', note: 'Notes, north arrow, level titles' },
];

const fmt = (n) => {
  const v = Number(n);
  if (!Number.isFinite(v)) return '0';
  const s = v.toFixed(4).replace(/0+$/, '').replace(/\.$/, '');
  return s === '-0' || s === '' ? '0' : s;
};
const cleanName = (s) => ascii(s).replace(/[<>/\\":;?*|=`,]/g, '_') || '0';
const norm360 = (a) => ((a % 360) + 360) % 360;
const norm180 = (a) => {
  const v = norm360(a);
  return v > 180 ? v - 360 : v;
};

class Writer {
  constructor(layerMap = {}) {
    this.layerMap = layerMap || {};
    this.lines = [];
    this.ext = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
    this.count = 0;
  }

  layer(key) {
    return cleanName(this.layerMap[key] || key);
  }

  pair(code, value) {
    this.lines.push(String(code).padStart(3, ' '), typeof value === 'number' ? fmt(value) : String(value));
  }

  grow(x, y) {
    if (x < this.ext.minX) this.ext.minX = x;
    if (x > this.ext.maxX) this.ext.maxX = x;
    if (y < this.ext.minY) this.ext.minY = y;
    if (y > this.ext.maxY) this.ext.maxY = y;
  }

  point(code, p) {
    this.pair(code, p.x);
    this.pair(code + 10, -p.y);
    this.pair(code + 20, 0);
  }

  begin(type, layerKey) {
    this.count += 1;
    this.pair(0, type);
    this.pair(8, this.layer(layerKey));
  }

  line(layerKey, a, b) {
    if (G.dist(a, b) < 0.01) return;
    this.begin('LINE', layerKey);
    this.point(10, a);
    this.point(11, b);
    this.grow(a.x, a.y);
    this.grow(b.x, b.y);
  }

  poly(layerKey, pts, closed = true) {
    if (pts.length < 2) return;
    this.begin('POLYLINE', layerKey);
    this.pair(66, 1);
    this.point(10, { x: 0, y: 0 });
    this.pair(70, closed ? 1 : 0);
    for (const p of pts) {
      this.pair(0, 'VERTEX');
      this.pair(8, this.layer(layerKey));
      this.point(10, p);
      this.grow(p.x, p.y);
    }
    this.pair(0, 'SEQEND');
    this.pair(8, this.layer(layerKey));
  }

  // Filled quadrilateral (R12 SOLID: corners in the order 1, 2, 4, 3).
  solid(layerKey, a, b, c, d) {
    this.begin('SOLID', layerKey);
    this.point(10, a);
    this.point(11, b);
    this.point(12, d);
    this.point(13, c);
    for (const t of [a, b, c, d]) this.grow(t.x, t.y);
  }

  circle(layerKey, c, r) {
    this.begin('CIRCLE', layerKey);
    this.point(10, c);
    this.pair(40, r);
    this.grow(c.x - r, c.y - r);
    this.grow(c.x + r, c.y + r);
  }

  // A 90 degree swing about c from plan point p to plan point q (angles are taken in DXF space, counter-clockwise).
  arcBetween(layerKey, c, p, q) {
    const r = G.dist(c, p);
    const ang = (t) => (Math.atan2(-(t.y - c.y), t.x - c.x) * 180) / Math.PI;
    const aP = ang(p);
    const aQ = ang(q);
    const [start, end] = norm180(aQ - aP) >= 0 ? [aP, aQ] : [aQ, aP];
    this.begin('ARC', layerKey);
    this.point(10, c);
    this.pair(40, r);
    this.pair(50, norm360(start));
    this.pair(51, norm360(end));
    for (const t of [p, q]) this.grow(t.x, t.y);
  }

  text(layerKey, at, height, value, { rot = 0, center = false } = {}) {
    const s = ascii(value);
    if (!s) return;
    this.begin('TEXT', layerKey);
    this.point(10, at);
    this.pair(40, height);
    this.pair(1, s);
    if (rot) this.pair(50, rot);
    if (center) {
      this.pair(72, 1);
      this.pair(73, 2);
      this.point(11, at);
    }
    this.grow(at.x, at.y);
  }
}

const wallLayer = (status) => (status === 'existing' ? 'PS-WALL-EXIST' : status === 'demolish' ? 'PS-WALL-DEMO' : 'PS-WALL-NEW');
const shift = (p, dx) => ({ x: p.x + dx, y: p.y });

function emitLevel(w, project, level, dx, { catalogue, withSite, sheet }) {
  const S = (p) => shift(p, dx);
  const shapes = wallShapes(level);
  for (const s of shapes) {
    const layer = wallLayer(s.wall.status);
    for (const piece of s.pieces) {
      w.line(layer, S(piece.plus[0]), S(piece.plus[1]));
      w.line(layer, S(piece.minus[0]), S(piece.minus[1]));
      for (const j of [piece.jambStart, piece.jambEnd]) if (j) w.line(layer, S(j[0]), S(j[1]));
    }
    for (const cap of s.caps) w.line(layer, S(cap[0]), S(cap[1]));
    for (const sp of s.spans) {
      const o = sp.opening;
      if (o.kind === 'door') {
        const g = doorGeometry(s, o);
        w.line('PS-DOOR', S(g.H), S(g.O));
        w.arcBetween('PS-DOOR', S(g.H), S(g.F), S(g.O));
      }
      const ol = openingLines(s, o);
      for (const l of ol.lines) w.line(ol.layer === 'win' ? 'PS-WIN' : 'PS-DOOR', S(l[0]), S(l[1]));
    }
  }
  for (const r of level.rooms) {
    w.poly(r.outdoor ? 'PS-SITE' : 'PS-ROOM', r.polygon.map(S), true);
    const c = S(G.polygonCentroid(r.polygon));
    w.text('PS-TEXT', { x: c.x, y: c.y - 120 }, 200, r.name || r.type, { center: true });
    w.text('PS-TEXT', { x: c.x, y: c.y + 180 }, 160, `${(G.polygonArea(r.polygon) / 1e6).toFixed(2)} m2`, { center: true });
  }
  for (const st of level.stairs) {
    const g = stairGeometry(st);
    w.poly('PS-STAIR', g.corners.map(S), true);
    for (const t of g.treads) w.line('PS-STAIR', S(t[0]), S(t[1]));
    for (const a of g.arrow) w.line('PS-STAIR', S(a[0]), S(a[1]));
  }
  for (const f of level.furniture) {
    // The catalogue's plan symbol (strokes only; fills have no meaning in CAD).
    for (const o of furnitureStrokes(catalogue, f)) {
      if (o.op !== 'stroke') continue;
      for (const pth of o.paths) if (pth.pts.length > 1) w.poly('PS-FURN', pth.pts.map(S), pth.closed && pth.pts.length > 2);
    }
  }
  if (withSite) {
    for (const t of project.site?.tanks || []) {
      w.circle('PS-SITE', S(t), t.diameter / 2);
      w.text('PS-SITE', S(t), 160, `RWT ${Math.round(t.capacityL)}L`, { center: true });
    }
  }
  const eaves = eavesBox(level);
  if (eaves) {
    w.poly('PS-ROOF', [
      { x: eaves.minX, y: eaves.minY }, { x: eaves.maxX, y: eaves.minY },
      { x: eaves.maxX, y: eaves.maxY }, { x: eaves.minX, y: eaves.maxY },
    ].map(S), true);
  }
  for (const d of dimensionsFor(level, shapes)) {
    for (const e of d.ext) w.line('PS-DIM', S(e[0]), S(e[1]));
    w.line('PS-DIM', S(d.a), S(d.b));
    for (const t of d.ticks) w.line('PS-DIM', S(t[0]), S(t[1]));
    w.text('PS-DIM', S(d.textAt), 150, d.text, { rot: d.textRot, center: true });
  }
  const box = outlineBox(level, shapes) || eaves || { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  // North arrow at the top right, title below the plan.
  const north = ((Number(project.site?.northDeg) || 0) * Math.PI) / 180;
  const dir = { x: Math.sin(north), y: -Math.cos(north) };
  const c = S({ x: box.maxX + 2600, y: box.minY - 1500 });
  const tip = { x: c.x + dir.x * 650, y: c.y + dir.y * 650 };
  const tail = { x: c.x - dir.x * 400, y: c.y - dir.y * 400 };
  const perp = { x: -dir.y, y: dir.x };
  w.circle('PS-ANNO', c, 450);
  w.line('PS-ANNO', tail, tip);
  w.line('PS-ANNO', tip, { x: c.x + dir.x * 250 + perp.x * 160, y: c.y + dir.y * 250 + perp.y * 160 });
  w.line('PS-ANNO', tip, { x: c.x + dir.x * 250 - perp.x * 160, y: c.y + dir.y * 250 - perp.y * 160 });
  w.text('PS-ANNO', { x: c.x + dir.x * 950, y: c.y + dir.y * 950 }, 250, 'N', { center: true });
  const cx = (box.minX + box.maxX) / 2;
  w.text('PS-ANNO', S({ x: cx, y: box.maxY + 2400 }), 400, levelTitle(level).toUpperCase(), { center: true });

  // Graduated scale bar at the drawing scale, in true millimetres (5 m is 5000 drawing units).
  const spec = scaleBarSpec(sheet.scale);
  const barH = 2 * sheet.scale; // 2 mm on paper
  const bx = box.minX;
  const by = box.maxY + 3300;
  const seg = spec.segMetres * 1000;
  for (let i = 0; i < spec.parts; i++) {
    const a = S({ x: bx + i * seg, y: by });
    const b = S({ x: bx + (i + 1) * seg, y: by });
    const c2 = S({ x: bx + (i + 1) * seg, y: by + barH });
    const d = S({ x: bx + i * seg, y: by + barH });
    if (i % 2 === 0) w.solid('PS-TITLE', a, b, c2, d);
    w.poly('PS-TITLE', [a, b, c2, d], true);
  }
  for (let i = 0; i <= spec.parts; i++) w.text('PS-TITLE', S({ x: bx + i * seg, y: by + barH + 150 + 90 }), 150, barLabel(spec.segMetres * i), { center: true });
  w.text('PS-TITLE', S({ x: bx + spec.metres * 1000 + 400, y: by + barH + 150 + 90 }), 150, 'm');

  // Title block text for this sheet. Empty fields keep their label so they can be filled by hand.
  const v = titleBlockValues(project, { date: sheet.date, sheetNo: sheet.no, total: sheet.total, sheetTitle: levelTitle(level).toUpperCase(), scaleLabel: `1:${sheet.scale} at ${sheet.paper}`, paper: sheet.paper });
  const rows = [
    ['PREPARED WITH', `${BRAND.name} Plan Studio`],
    ['PROJECT', v.project], ['CLIENT', v.client], ['SITE ADDRESS', v.address], ['LOT AND DP', v.lotDp], ['COUNCIL', v.council],
    ['PREPARED BY', v.company], ['DRAWN', v.drawn], ['CHECKED', v.checked], ['JOB NO.', v.job], ['DRAWING NO.', v.drawingNo],
    ['REVISION', v.revision], ['ISSUE PURPOSE', v.issue], ['DATE', v.date], ['SHEET TITLE', v.sheetTitle],
    ['SCALE', `${v.scale} (drawn full size in mm)`], ['SHEET', v.sheet],
  ];
  const ty = by + barH + 900;
  rows.forEach(([label, value], i) => w.text('PS-TITLE', S({ x: box.minX, y: ty + i * 280 }), 170, `${label}: ${value}`));
  return { ...box, bottom: ty + rows.length * 280 };
}

/**
 * Build the DXF text for a project.
 * options: { layerMap, catalogue, notes: [string] }
 */
export function toDXF(project, options = {}) {
  const { layerMap = {}, catalogue = null, notes = [] } = options;
  const levels = levelsSorted(project);
  const body = new Writer(layerMap);
  const plan = planSheets(project, { catalogue });
  const paper = paperOf(plan.paper);
  const date = options.date || new Date();
  // The lowest level keeps its plan coordinates. Each level above sits to the right of the one before it.
  let cursor = 0;
  let noteY = 0;
  let noteX = 0;
  levels.forEach((level, i) => {
    const sheet = { scale: plan.scale, paper: paper.name, no: i + 2, total: plan.pages.length, date };
    const probe = new Writer(layerMap);
    emitLevel(probe, project, level, 0, { catalogue, withSite: i === 0, sheet });
    const ext = probe.ext;
    if (!Number.isFinite(ext.minX)) return;
    const dx = i === 0 ? 0 : cursor - ext.minX;
    const box = emitLevel(body, project, level, dx, { catalogue, withSite: i === 0, sheet });
    if (i === 0) noteX = ext.minX;
    noteY = Math.max(noteY, box.bottom + 600);
    cursor = ext.maxX + dx + LEVEL_GAP_MM;
  });
  const noteLines = ['Units: millimetres', 'Concept design only. Not for construction.', ...notes.map(ascii)].filter(Boolean);
  noteLines.forEach((line, i) => body.text('PS-ANNO', { x: noteX, y: noteY + i * 300 }, 200, line));

  const head = new Writer(layerMap);
  const e = Number.isFinite(body.ext.minX) ? body.ext : { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  head.pair(0, 'SECTION');
  head.pair(2, 'HEADER');
  head.pair(9, '$ACADVER');
  head.pair(1, 'AC1009');
  head.pair(9, '$INSBASE');
  head.point(10, { x: 0, y: 0 });
  head.pair(9, '$EXTMIN');
  head.point(10, { x: e.minX, y: e.maxY });
  head.pair(9, '$EXTMAX');
  head.point(10, { x: e.maxX, y: e.minY });
  head.pair(9, '$LIMMIN');
  head.pair(10, e.minX);
  head.pair(20, -e.maxY);
  head.pair(9, '$LIMMAX');
  head.pair(10, e.maxX);
  head.pair(20, -e.minY);
  head.pair(9, '$LTSCALE');
  head.pair(40, 1);
  head.pair(9, '$TEXTSIZE');
  head.pair(40, 200);
  head.pair(0, 'ENDSEC');

  head.pair(0, 'SECTION');
  head.pair(2, 'TABLES');
  head.pair(0, 'TABLE');
  head.pair(2, 'LTYPE');
  head.pair(70, 2);
  head.pair(0, 'LTYPE');
  head.pair(2, 'CONTINUOUS');
  head.pair(70, 0);
  head.pair(3, 'Solid line');
  head.pair(72, 65);
  head.pair(73, 0);
  head.pair(40, 0);
  head.pair(0, 'LTYPE');
  head.pair(2, 'DASHED');
  head.pair(70, 0);
  head.pair(3, 'Dashed');
  head.pair(72, 65);
  head.pair(73, 2);
  head.pair(40, 600);
  head.pair(49, 400);
  head.pair(49, -200);
  head.pair(0, 'ENDTAB');
  head.pair(0, 'TABLE');
  head.pair(2, 'LAYER');
  head.pair(70, DXF_LAYERS.length + 1);
  const layerRow = (name, aci, ltype) => {
    head.pair(0, 'LAYER');
    head.pair(2, name);
    head.pair(70, 0);
    head.pair(62, aci);
    head.pair(6, ltype);
  };
  layerRow('0', 7, 'CONTINUOUS');
  for (const l of DXF_LAYERS) layerRow(head.layer(l.key), l.aci, l.ltype);
  head.pair(0, 'ENDTAB');
  head.pair(0, 'TABLE');
  head.pair(2, 'STYLE');
  head.pair(70, 1);
  head.pair(0, 'STYLE');
  head.pair(2, 'STANDARD');
  head.pair(70, 0);
  head.pair(40, 0);
  head.pair(41, 1);
  head.pair(50, 0);
  head.pair(71, 0);
  head.pair(42, 200);
  head.pair(3, 'txt');
  head.pair(4, '');
  head.pair(0, 'ENDTAB');
  head.pair(0, 'ENDSEC');
  head.pair(0, 'SECTION');
  head.pair(2, 'ENTITIES');

  const tail = new Writer(layerMap);
  tail.pair(0, 'ENDSEC');
  tail.pair(0, 'EOF');
  return `${[...head.lines, ...body.lines, ...tail.lines].join('\n')}\n`;
}

/** Parse DXF text into [{ code, value }] pairs. Used by tests and by callers that want to check a file. */
export function parseDXF(text) {
  const rows = String(text).split(/\r?\n/);
  if (rows.at(-1) === '') rows.pop();
  if (rows.length % 2) throw new Error('DXF has an odd number of lines');
  const pairs = [];
  for (let i = 0; i < rows.length; i += 2) {
    const code = Number(rows[i].trim());
    if (!Number.isInteger(code)) throw new Error(`Bad group code on line ${i + 1}: ${rows[i]}`);
    pairs.push({ code, value: rows[i + 1] });
  }
  return pairs;
}

export default toDXF;
