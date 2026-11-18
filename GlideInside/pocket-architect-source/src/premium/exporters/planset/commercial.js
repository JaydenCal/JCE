// Commercial plan set (kind 'commercial'): C000 cover and locality, C100 existing site, C101 proposed layout, C102 levels plan, C110 upper level
// plans, C200 elevations, C300 sections, C900 yield summary, C910 feasibility. The geometry comes from project.commercial through the same analysis the editor uses (src/commercial/analyse.js), so
// the sheets and the live stats strip always agree. Sheet units are millimetres on A3; plan units are millimetres on the ground (y down).
//
// Everything here is indicative: the sheets say so, every rate carries its source and status, and values that are UNVERIFIED in the
// dataset are listed on C103. Landscaping and the OSD placeholder are worked out here (the editor does not model them yet): landscaping is
// the lot area that is neither built nor paved, the OSD placeholder sits at the lowest ground in the open area (or at the front when the lot
// has no levels). Neither carries a volume or a design size.

import * as G from '../../../model/geometry.js';
import { classifyEdges, requiredFor } from '../../../model/placement.js';
import { inwardNormalOf, clearances } from '../../../site/lotplan.js';
import { analyse } from '../../../commercial/analyse.js';
import { mezzanineOf, officeOf, facadeLayout, onFacade, rowFrame, rowPoint } from '../../../commercial/layout.js';
import { doorStrips } from '../../../commercial/parking.js';
import { siteAccess } from '../../../commercial/access.js';
import { bayOffsetMm, doorSize } from '../../../commercial/schema.js';
import { ACCESSIBLE_BAY, defaultRulesFor } from '../../../commercial/rules.js';
import { effectiveRules } from '../../../site/custom-rules.js';
import { factsByStatus, facts, statusText } from '../../../commercial/dataset.js';
import { zoneClass, effectiveClass, zoneMismatch, RESIDENTIAL_NOTE } from '../../../commercial/zones.js';
import { feasibility, summaryRows, costRows, money, CAVEAT, GST_NOTE, RENT_NOTE, SOURCES_TEXT } from '../../../commercial/feasibility.js';
import { buildingsOf } from '../../../commercial/catalogue/buildings.js';
import { buildingParking } from '../../../commercial/catalogue/bays.js';
import { hardstandModel, labelPoint } from '../../../commercial/catalogue/pavements/hardstand.js';
import { pavementById } from '../../../commercial/catalogue/pavements/index.js';
import { buildingPolys, buildingScheduleRows, dockLines, extraLabel } from '../../../commercial/catalogue/planset.js';
import { scaleBar } from '../pdf.js';
import { PEN, PHANTOM, clipSegment, hatch, hatchSegments, dimLine, haloText, alongLabel, LabelField, boxOfPts, clean, wrap, polygon } from '../eng/kit.js';
import { COMMERCIAL_SHEET_LIST } from '../../../commercial/sheet-list.js';
import { compute as financeCompute, compareScenarios as financeCompare, COMPARE_ROWS as FIN_COMPARE_ROWS, DISCLAIMER as FIN_DISCLAIMER } from '../../../finance/model.js';
import { FINANCE_DATA as FIN_DATA } from '../../../finance/engine.js';
import { AREA, fit } from './frame.js';
import { drawSite, drawnContext, roadModel, siteView, fitView, northPoint, northDegOf, SITE_SCALES, SCALES_BEYOND, VP } from './site.js';
import { hasGround, groundLevelFn, drawGroundLayer, streamMark, outwardSpots, cornersOf, intervalText } from './contours.js';
import { levelsModel, fflText } from './levels.js';
import { envelopePoly } from './lot.js';
import { elevationScaleOf } from './commercial-elevations.js';
import { sectionScaleOf } from './commercial-sections.js';
import { viewTargets } from './commercial-targets.js';
import { pavementModel } from '../../../commercial/catalogue/pavements/logic.js';
import { hasUpperPlans, upperScaleOf } from './commercial-upper.js';

export const COMMERCIAL_SHEETS = COMMERCIAL_SHEET_LIST;

/** What the set shows, in words that fit the project: strata units, or a building and its site. */
export const layoutKind = (stats) => (stats?.units > 0 && !(stats?.buildingCount > 0) ? 'commercial unit layout' : 'commercial site layout');
export const cap1 = (t) => t.charAt(0).toUpperCase() + t.slice(1);

export const COMMERCIAL_NOTES = Object.freeze([
  'Concept only. This set shows a commercial unit layout sited on a lot for discussion. It is not a development application or construction drawing set.',
  'Boundaries are from the cadastre (DCDB) and are not a survey. Dimensions and areas must be confirmed by a registered surveyor.',
  'Setbacks, parking rates and planning controls shown are indicative, check with council. Each rate carries its source and status on C900.',
  'Unit areas are measured to the outside of the walls. GFA includes the mezzanine floors.',
  'Parking, truck apron, car aisle, bollards, landscaping and the OSD placeholder are indicative. Swept paths and stormwater design are not part of this set.',
  'Values that could not be verified against the source standard are listed on C900 and must be confirmed before they are relied on.',
]);

/** The general notes, with the first one worded for the project (units, or a building and its site) and the unit note only when there are units. */
export function commercialNotes(stats) {
  const kind = layoutKind(stats);
  return COMMERCIAL_NOTES.filter((n) => stats?.units > 0 || !/^Unit areas are measured/.test(n)).map((n) => n.replace('a commercial unit layout', `a ${kind}`).replace(/^Unit areas are measured to the outside of the walls\. GFA includes the mezzanine floors\./, 'Unit areas are measured to the outside of the walls. GFA includes the mezzanine floors.'));
}

const GREYLINE = [120, 124, 132];
const RED = [196, 28, 28];
const BLUE = [27, 95, 191];
const GREEN = [64, 138, 76];
const UNIT_FILL = [246, 240, 222];
const PAVE_FILL = [233, 234, 237];
const AISLE_FILL = [224, 225, 229];
const MM = 0.3528;
const TXT_MIN = 4.8;

const m1 = (mm) => (mm / 1000).toFixed(1);
const m2f = (v) => `${Math.round(v * 10) / 10}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
const lenOf = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

/** The lot with its lot number and plan label filled from a "Lot 1 DP 123456" label when they are missing (a copy, the input is not changed). */
export function withLotIds(lot) {
  if (!lot || (lot.lotNumber && lot.planLabel)) return lot;
  const m = /^Lot\s+(\S+?)(?:\s+Sec\s+\S+)?\s+([A-Za-z]{2,3}\s?\d+[A-Za-z]?)$/i.exec(String(lot.lotLabel || '').trim());
  return m ? { ...lot, lotNumber: lot.lotNumber || m[1], planLabel: lot.planLabel || m[2].replace(/\s+/g, '') } : lot;
}

/** The title used on the sheets: the project name, else a plain default (never the house default). */
export function commercialTitle(project) {
  const tb = project?.titleBlock || {};
  const t = clean(tb.projectName) || clean(project?.name) || '';
  return t && /[A-Za-z0-9]/.test(t) && !/^untitled( design)?$/i.test(t) && !/^lot$/i.test(t) ? t : 'Commercial site concept';
}

// Model ---------------------------------------------------------------------------------------------------------------------
function coveredFn(polys) {
  const bbs = polys.map((p) => G.bbox(p));
  return (p) => {
    for (let i = 0; i < polys.length; i++) {
      const b = bbs[i];
      if (p.x < b.minX || p.x > b.maxX || p.y < b.minY || p.y > b.maxY) continue;
      if (G.pointInPolygon(p, polys[i])) return true;
    }
    return false;
  };
}

const rectAt = (c, ax, ay, w, h) => {
  const px = { x: -ay.y, y: ay.x };
  void px;
  return [
    { x: c.x - ax.x * w / 2 - ay.x * h / 2, y: c.y - ax.y * w / 2 - ay.y * h / 2 },
    { x: c.x + ax.x * w / 2 - ay.x * h / 2, y: c.y + ax.y * w / 2 - ay.y * h / 2 },
    { x: c.x + ax.x * w / 2 + ay.x * h / 2, y: c.y + ax.y * w / 2 + ay.y * h / 2 },
    { x: c.x - ax.x * w / 2 + ay.x * h / 2, y: c.y - ax.y * w / 2 + ay.y * h / 2 },
  ];
};

/** The paved block of each parking row: facade to the back of the bays, the whole row length. */
function pavedPolys(c, a) {
  const off = bayOffsetMm(c.parking);
  const bayed = a.parking.rows.filter((pr) => pr.slots.length).map((pr) => {
    const fr = pr.frame;
    const far = pr.depth + (pr.off ?? off) + c.parking.bayL;
    return [rowPoint(fr, 0, pr.depth), rowPoint(fr, pr.length, pr.depth), rowPoint(fr, pr.length, far), rowPoint(fr, 0, far)];
  });
  return [...bayed, ...doorStrips(c, a.parking).map((s) => s.poly)];
}

const wastePoly = (w) => {
  const ang = ((w.rotationDeg || 0) * Math.PI) / 180;
  const ax = { x: Math.cos(ang), y: Math.sin(ang) };
  const ay = { x: -Math.sin(ang), y: Math.cos(ang) };
  return rectAt({ x: w.x, y: w.y }, ax, ay, w.widthMm, w.depthMm);
};

/** OSD placeholder: a rectangle (about 2.5 percent of the lot, 2:1) at the lowest ground in the open area, or the open area nearest the front. */
function placeOsd(lot, covered) {
  const area = G.polygonArea(lot.boundary) / 1e6;
  const target = Math.min(600, Math.max(60, area * 0.025));
  const w = Math.sqrt(target * 2) * 1000;
  const h = w / 2;
  const edges = classifyEdges(lot);
  const fe = edges.find((e) => e.kind === 'front') || edges[0];
  const dir = fe ? G.norm(G.sub(fe.b, fe.a)) : { x: 1, y: 0 };
  const inward = fe ? inwardNormalOf(lot, fe.index) : { x: 0, y: 1 };
  const fm = fe ? G.lerp(fe.a, fe.b, 0.5) : G.polygonCentroid(lot.boundary);
  const useZ = hasGround(lot);
  const zAt = useZ ? groundLevelFn(lot) : null;
  const bb = G.bbox(lot.boundary);
  const step = Math.max(1500, Math.min(4000, Math.round(Math.max(bb.w, bb.h) / 60 / 500) * 500));
  const pad = 1200;
  // The long side runs along the frontage; where the open ground is too narrow for that, the basin is turned a quarter.
  for (const [ax, ay] of [[dir, inward], [inward, dir]]) {
    const best = { score: Infinity, poly: null, c: null };
    for (let y = bb.minY; y <= bb.maxY; y += step) {
      for (let x = bb.minX; x <= bb.maxX; x += step) {
        const c = { x, y };
        if (!G.pointInPolygon(c, lot.boundary)) continue;
        const test = rectAt(c, ax, ay, w + 2 * pad, h + 2 * pad);
        const probes = [...test, c, ...test.map((p, i) => G.lerp(p, test[(i + 1) % 4], 0.5))];
        if (!probes.every((p) => G.pointInPolygon(p, lot.boundary) && !covered(p))) continue;
        const z = zAt ? zAt(c) : null;
        const front = Math.abs(G.dot(G.sub(c, fm), inward));
        const score = z != null ? z * 1e6 + front : front;
        if (score < best.score) { best.score = score; best.poly = rectAt(c, ax, ay, w, h); best.c = c; }
      }
    }
    if (best.poly) return { poly: best.poly, centre: best.c, basis: useZ ? 'levels' : 'assumed' };
  }
  return null;
}

/** Fraction of the lot that is neither built, paved, waste nor OSD, on a metre grid. */
function landscapeShare(lot, covered) {
  const bb = G.bbox(lot.boundary);
  const step = (bb.w * bb.h) / 1e6 > 60000 ? 2000 : 1000;
  let inLot = 0;
  let open = 0;
  for (let y = bb.minY + step / 2; y < bb.maxY; y += step) {
    for (let x = bb.minX + step / 2; x < bb.maxX; x += step) {
      const p = { x, y };
      if (!G.pointInPolygon(p, lot.boundary)) continue;
      inLot++;
      if (!covered(p)) open++;
    }
  }
  return inLot ? { pct: Math.round((open / inLot) * 1000) / 10, areaM2: Math.round((open * step * step) / 1e6) } : { pct: null, areaM2: null };
}

/** Everything the commercial sheets quote, computed once. */
export function commercialModel(project, lot, { levels = null } = {}) {
  const c = project.commercial;
  const a = analyse(project);
  const wp = { ...project, site: { ...(project.site || {}), lot } };
  const polys = [...a.units.map((u) => u.poly), ...pavedPolys(c, a), ...buildingPolys(c)];
  // The paving the 3D model and the levels sheet (C102) use: car park, apron and the links to the access. One source for C101 and C102.
  let pavingAreas = [];
  try { pavingAreas = (pavementModel(c, lot)?.areas || []).map((x) => x.polygon).filter((q) => q?.length >= 3); } catch { pavingAreas = []; }
  polys.push(...pavingAreas);
  const hs = hardstandModel(wp);
  const hardstand = (hs?.areas || []).filter((x) => x.role === 'hardstand');
  const hardstandKerbs = (hs?.kerbs || []).filter((k) => String(k.areaId || '').startsWith('hs_'));
  for (const x of hardstand) polys.push(x.polygon); // drawn hardstand is paved ground: not landscaping, not a place for the OSD
  if (c.waste) polys.push(wastePoly(c.waste));
  let osd = null;
  if (lot) {
    osd = placeOsd(lot, coveredFn(polys));
    if (osd) polys.push(osd.poly);
  }
  const covered = coveredFn(polys);
  const land = lot ? landscapeShare(lot, covered) : { pct: null, areaM2: null };
  const cls = effectiveClass(wp) || 'industrial';
  const rules = { ...defaultRulesFor(cls), ...effectiveRules(wp, cls) };
  const carparks = hs?.carparks || [];
  return { project: wp, c, a, lot, units: a.units, stats: a.stats, pavingAreas, osd, covered, land, cls, rules, off: bayOffsetMm(c.parking), hardstand, hardstandKerbs, carparks, levels: levels || (lot ? levelsModel(wp, lot) : null) };
}

// Sheet list ----------------------------------------------------------------------------------------------------------------
/** The scale the layout sheets use (C101): the largest standard scale at which the lot, the layout and the road frontage fit. */
export function layoutView(model) {
  const { lot, units, a, c } = model;
  const pts = [...lot.boundary];
  for (const u of units) pts.push(...u.poly);
  for (const pr of a.parking.rows) for (const sl of pr.slots) pts.push(...sl.poly);
  pts.push(...buildingPolys(c).flat());
  for (const x of model.hardstand || []) pts.push(...x.polygon);
  if (c.waste) pts.push(...wastePoly(c.waste));
  const roads = roadModel(lot);
  for (const r of roads) pts.push(...r.lines.centreline.slice(1, -1));
  return { ...fitView(pts, VP), roads };
}

function makeView(pts, vp, margin, roads = []) {
  const bb = G.bbox(pts);
  const w = bb.w + 2 * margin[0];
  const h = bb.h + 2 * margin[1];
  const vw = vp.x1 - vp.x0;
  const vh = vp.y1 - vp.y0;
  let scale = SITE_SCALES.find((n) => w / n <= vw && h / n <= vh);
  if (!scale) { scale = SITE_SCALES.at(-1); while (w / scale > vw || h / scale > vh) scale *= 2; }
  const cx = bb.minX + bb.w / 2;
  const cy = bb.minY + bb.h / 2;
  const mx = (vp.x0 + vp.x1) / 2;
  const my = (vp.y0 + vp.y1) / 2;
  return { scale, T: (p) => ({ x: mx + (p.x - cx) / scale, y: my + (p.y - cy) / scale }), Ti: (q) => ({ x: cx + (q.x - mx) * scale, y: cy + (q.y - my) * scale }), roads, bb, vp };
}

/** The mezzanine plan scale: the building footprint only, in the same viewport. */
export function mezzView(model) {
  const pts = [...model.units.flatMap((u) => u.poly), ...buildingsOf(model.c).flatMap((b) => b.outline)];
  return makeView(pts, VP, [3500, 2500]);
}

/** A copy of the project with no building and the lot written to project.site.lot, for the existing site sheet. */
export function blankProject(project, lot) {
  const q = structuredClone(project);
  q.site = { ...q.site, lot };
  q.levels = [{ ...(q.levels[0] || {}), walls: [], rooms: [], openings: [], stairs: [], furniture: [] }];
  return q;
}

/** The scale label of the existing site sheet (C100): the plan is turned only when there is no aerial under it. */
export function existingScale(project, lot, { aerial = false } = {}) {
  return `1:${siteView(blankProject(project, lot), lot, { turn: !aerial }).scale} @ A3`;
}

/**
 * [{ id, code, title, scale, target?, upper? }] for the commercial plan set, without drawing anything. `lot` is the site lot (plan mm) or null. The
 * list is dynamic: C000 cover, C100 existing site, C101 layout, then (when they have something to show) C102 levels plan and C110 upper level
 * plans, one elevation sheet (C200, C201...) and one section sheet (C300, C301...) for every building or unit row, then C900 yield and C910
 * feasibility. A sheet with nothing to draw is not issued.
 */
export function commercialSheetPlan(project, lot, { levels = null } = {}) {
  const out = [
    { id: 'cover', code: 'C000', title: 'COVER SHEET AND DRAWING INDEX', scale: 'AS SHOWN' },
    { id: 'existing', code: 'C100', title: 'EXISTING SITE AND LEVELS', scale: 'NTS' },
    { id: 'existingclean', code: 'C100A', title: 'EXISTING SITE AND LEVELS NO AERIAL', scale: 'NTS' },
    { id: 'layout', code: 'C101', title: 'PROPOSED LAYOUT', scale: 'NTS' },
  ];
  let model = null;
  if (lot && project?.commercial) {
    try {
      model = commercialModel(project, lot);
      out[1].scale = `1:${siteView(blankProject(project, lot), lot).scale} @ A3`;
      out[2].scale = out[1].scale;
      out[3].scale = `1:${layoutView(model).scale} @ A3`;
    } catch {
      model = null;
    }
  }
  if (model && levels?.has) out.push({ id: 'levels', code: 'C102', title: 'LEVELS AND GRADING PLAN (INDICATIVE)', scale: `1:${layoutView(model).scale} @ A3` });
  const targets = project?.commercial ? viewTargets(project) : [];
  const many = targets.length > 1;
  let up = 0;
  if (model && model.units.some((u) => mezzanineOf(u.spec).enabled)) out.push({ id: 'upper', code: `C${110 + up++}`, title: 'MEZZANINE LEVEL PLAN', scale: `1:${mezzView(model).scale} @ A3`, upper: 'mezz' });
  for (const t of targets) if (hasUpperPlans(t)) out.push({ id: 'upper', code: `C${110 + up++}`, title: many ? `UPPER LEVEL PLANS, ${t.tag}` : 'UPPER LEVEL PLANS', scale: upperScaleOf(t), upper: t.key, target: t.key });
  targets.forEach((t, i) => {
    let scale = 'NTS';
    try { scale = elevationScaleOf(project, t, levels); } catch { /* NTS */ }
    out.push({ id: 'elev', code: `C${200 + i}`, title: many ? `ELEVATIONS, ${t.tag}` : 'ELEVATIONS', scale, target: t.key });
  });
  targets.forEach((t, i) => {
    out.push({ id: 'sect', code: `C${300 + i}`, title: many ? `SECTIONS, ${t.tag}` : 'SECTIONS', scale: sectionScaleOf(t, levels), target: t.key });
  });
  out.push({ id: 'yield', code: 'C900', title: 'YIELD SUMMARY AND SCHEDULES', scale: 'NTS' }, { id: 'finance', code: 'C910', title: 'DEVELOPMENT FEASIBILITY', scale: 'NTS' });
  return out;
}

// Drawing helpers -----------------------------------------------------------------------------------------------------------
const inVP = (p, vp = VP) => p.x >= vp.x0 && p.x <= vp.x1 && p.y >= vp.y0 && p.y <= vp.y1;
const segLine = (doc, a, b) => { const s = clipSegment(a, b, VP); if (s) doc.line(s[0].x, s[0].y, s[1].x, s[1].y); };
const polyLine = (doc, pts, closed = true) => { const n = closed ? pts.length : pts.length - 1; for (let i = 0; i < n; i++) segLine(doc, pts[i], pts[(i + 1) % pts.length]); };
const dashOff = (doc) => doc.setLineDashPattern([], 0);
const setText = (doc, size, bold = false, colour = PEN.ink) => { doc.setFont('helvetica', bold ? 'bold' : 'normal'); doc.setFontSize(size); doc.setTextColor(...colour); };

function drawRoads(doc, view, lot, field, roadName) {
  for (const r of view.roads) {
    const L = (k) => r.lines[k].map(view.T);
    dashOff(doc);
    doc.setLineWidth(0.15);
    doc.setDrawColor(...GREYLINE);
    for (const k of ['footpathNear', 'footpathFar']) polyLine(doc, L(k), false);
    doc.setLineWidth(0.3);
    doc.setDrawColor(...PEN.ink);
    for (const k of ['kerb', 'gutter', 'farGutter', 'farKerb']) polyLine(doc, L(k), false);
    doc.setLineWidth(0.35);
    doc.setDrawColor(...PEN.phantom);
    doc.setLineDashPattern(PHANTOM.map((v) => v * 0.9), 0);
    polyLine(doc, L('centreline'), false);
    dashOff(doc);
  }
  const label = (chain, key, text, { size = 5.8, bold = false, offset = null, colour = [70, 74, 82] } = {}) => {
    const L = chain.lines[key].map(view.T);
    const segs = [[L[0], L[1]], [L.at(-1), L.at(-2)]];
    const h = size * MM;
    const cands = [];
    for (const [p, q] of segs) {
      const cc = clipSegment(p, q, VP);
      if (!cc || lenOf(cc[0], cc[1]) < 18) continue;
      const dir = G.norm(G.sub(cc[1], cc[0]));
      for (const f of [0.5, 0.3, 0.7, 0.2, 0.8]) cands.push(() => alongLabel(doc, text, G.lerp(cc[0], cc[1], f), dir, offset ?? -h / 2, { size, bold, colour, halo: 0.9 }));
    }
    field.place(cands, { lines: false });
  };
  for (const chain of view.roads) {
    label(chain, 'footpathNear', 'FOOTPATH');
    label(chain, 'kerb', 'KERB AND GUTTER');
    label(chain, 'centreline', (roadName || 'EXISTING ROAD').toUpperCase(), { size: 9.5, bold: true, offset: 2.6, colour: PEN.ink });
  }
}

export function legendBlock(items, rowMax = 3.7, avail = null) {
  const rowH = Math.min(rowMax, avail ? (avail - 6) / Math.max(1, items.length) : 52 / Math.max(1, items.length)); // 14 rows fit at 3.7 mm; with hardstand rows added the rows close up to keep the block on the sheet
  return {
    title: 'LEGEND',
    h: 4 + items.length * rowH + 2,
    // The title strip asks a legend that does not fit to close up its rows (down to 2.6 mm) instead of being dropped.
    fitTo: (h) => ((h - 6) / Math.max(1, items.length) >= 2.6 ? legendBlock(items, rowMax, h) : null),
    draw(doc, x, y) {
      items.forEach(([t, draw], i) => {
        const ly = y + 2.4 + i * rowH;
        doc.setLineDashPattern([], 0);
        draw(doc, x + 3, ly);
        doc.setLineDashPattern([], 0);
        setText(doc, 6, false);
        doc.text(t, x + 18, ly + 0.8);
      });
    },
  };
}

const hexRgb = (hex) => { const n = parseInt(String(hex).replace('#', ''), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const paleOf = (hex, k = 0.55) => hexRgb(hex).map((v) => Math.round(v + (255 - v) * k));
/** A pavement type's plan swatch: its pale fill with the hatch lines of its plan pattern. */
const pavementSwatch = (t) => (doc, a, b) => {
  doc.setFillColor(...paleOf(t.colour)); doc.rect(a, b - 1.2, 12, 2.4, 'F');
  doc.setDrawColor(...hexRgb(t.hatch2d.line)); doc.setLineWidth(0.08);
  for (let k = 0; k < 6; k++) { const x0 = a + k * 2; const x1 = Math.min(a + 12, x0 + 2.4); doc.line(x0, b + 1.2, x1, b + 1.2 - (x1 - x0)); }
  doc.setDrawColor(90, 94, 102); doc.setLineWidth(0.15); doc.rect(a, b - 1.2, 12, 2.4, 'S');
};
const swatch = (fill, line, dash = null) => (doc, a, b) => {
  if (fill) { doc.setFillColor(...fill); doc.rect(a, b - 1.2, 12, 2.4, 'F'); }
  if (line) { doc.setDrawColor(...line); doc.setLineWidth(0.2); if (dash) doc.setLineDashPattern(dash, 0); doc.rect(a, b - 1.2, 12, 2.4, 'S'); doc.setLineDashPattern([], 0); }
};
const lineSw = (colour, w, dash = null) => (doc, a, b) => { doc.setDrawColor(...colour); doc.setLineWidth(w); if (dash) doc.setLineDashPattern(dash, 0); doc.line(a, b, a + 12, b); doc.setLineDashPattern([], 0); };

/** Draw the aerial under the plan with the 60 percent white wash, clipped to the viewport. */
function aerialUnder(doc, aerial, T) {
  if (!aerial) return false;
  const e = aerial.extent;
  const p0 = T({ x: e.x0, y: e.y0 });
  const p1 = T({ x: e.x1, y: e.y1 });
  const R = VP;
  doc.saveGraphicsState();
  const k = doc.internal.scaleFactor;
  const H = doc.internal.pageSize.getHeight();
  const f = (v) => (v * k).toFixed(2);
  doc.internal.write(f(R.x0), f(H - R.y1), f(R.x1 - R.x0), f(R.y1 - R.y0), 're W n');
  try { doc.addImage(aerial.data, aerial.format, p0.x, p0.y, p1.x - p0.x, p1.y - p0.y, undefined, 'FAST'); } catch { /* the plain sheet shows */ }
  doc.setGState(new doc.GState({ opacity: 0.6 }));
  doc.setFillColor(255, 255, 255);
  doc.rect(R.x0, R.y0, R.x1 - R.x0, R.y1 - R.y0, 'F');
  doc.restoreGraphicsState();
  return true;
}

export function northAndScale(doc, field, project, scale, view) {
  const r = 15;
  const corners = [{ x: VP.x1 - r - 2, y: VP.y0 + r + 2 }, { x: VP.x0 + r + 2, y: VP.y0 + r + 2 }, { x: VP.x1 - r - 2, y: VP.y1 - r - 2 }, { x: VP.x0 + r + 2, y: VP.y1 - r - 2 }];
  const free = (cc, soft) => field.free({ x0: cc.x - r, y0: cc.y - r, x1: cc.x + r, y1: cc.y + r }, soft);
  const nc = corners.find((cc) => free(cc, { soft: false })) || corners.find((cc) => free(cc, { lines: false })) || corners[0];
  northPoint(doc, nc.x, nc.y, northDegOf(project, view));
  field.addBox({ x0: nc.x - r, y0: nc.y - r, x1: nc.x + r, y1: nc.y + r });
  doc.setDrawColor(...PEN.ink);
  const spec = scaleBar(doc, VP.x0 + 6, VP.y1 + 4.2, scale, scale);
  const barLen = (spec.segMetres * spec.parts * 1000) / scale;
  setText(doc, 7.5, true);
  doc.text(`1:${scale} @ A3`, VP.x0 + 6 + barLen + 14, VP.y1 + 6.2);
}

/**
 * Text lines centred in a rectangle of a row's frame ({ x0, x1 } along the row, { a0, a1 } depth), the largest size that fits. Tries the
 * lines along the row, then along its depth. `variants` are alternative line sets (fewest lines first). Returns the placed box or null.
 */
function labelInLocal(doc, field, { frame, T, scale, x0, x1, a0, a1, variants, maxSize = 7, bold = [true, false, false], colour = PEN.ink }) {
  const wp = (x1 - x0) / scale;
  const hp = (a1 - a0) / scale;
  if (wp < 3 || hp < 3) return null;
  const cl = rowPoint(frame, (x0 + x1) / 2, (a0 + a1) / 2);
  const C = T(cl);
  const eu = G.norm(G.sub(T(rowPoint(frame, (x0 + x1) / 2 + 1000, (a0 + a1) / 2)), C));
  const ef = G.norm(G.sub(T(rowPoint(frame, (x0 + x1) / 2, (a0 + a1) / 2 + 1000)), C));
  // Text reads horizontally where it fits: the row direction first when it runs across the sheet, else the depth direction.
  const horizontalFirst = Math.abs(eu.x) >= Math.abs(ef.x) ? ['u', 'f'] : ['f', 'u'];
  const tryOne = (size, lines, along) => {
    const lh = size * MM * 1.22;
    let bw = 0;
    lines.forEach((t, i) => { doc.setFont('helvetica', bold[i] ? 'bold' : 'normal'); doc.setFontSize(size); bw = Math.max(bw, doc.getTextWidth(t)); });
    bw += 1.2;
    const bh = lines.length * lh + 0.6;
    const fitsDims = along === 'u' ? bw <= wp && bh <= hp : bw <= hp && bh <= wp;
    if (!fitsDims) return null;
    const d = along === 'u' ? eu : ef;
    const capH = size * MM * 0.72;
    const items = lines.map((t, i) => {
      const off = bh / 2 - 0.3 - (i + 1) * lh + (lh - capH) / 2;
      return alongLabel(doc, t, C, d, off, { size, bold: bold[i], colour, halo: 0 });
    });
    const boxes = items.map((it) => it.box);
    if (!boxes.every((b) => field.free(b, { lines: false }))) return null;
    return { items, boxes };
  };
  for (let size = maxSize; size >= TXT_MIN - 1e-6; size -= 0.4) {
    for (const lines of variants) {
      for (const along of horizontalFirst) {
        const r = tryOne(size, lines, along);
        if (r) { r.items.forEach((it) => it.draw()); r.boxes.forEach((b) => field.addBox(b)); return r.boxes; }
      }
    }
  }
  return null;
}

const unitLines = (u, area) => [[`PROPOSED UNIT ${u.n}`, `${area.toFixed(0)} m²`], [`PROPOSED`, `UNIT ${u.n}`, `${area.toFixed(0)} m²`], [`PROPOSED UNIT ${u.n}`]];

/** The wall line along `from`..`to` with a gap. Local helper for balustrades. */
function lineBetween(doc, a, b) { doc.line(a.x, a.y, b.x, b.y); }

function arc(doc, centre, from, to, r, steps = 8) {
  const a0 = Math.atan2(from.y, from.x);
  let a1 = Math.atan2(to.y, to.x);
  while (a1 - a0 > Math.PI) a1 -= 2 * Math.PI;
  while (a1 - a0 < -Math.PI) a1 += 2 * Math.PI;
  let prev = { x: centre.x + Math.cos(a0) * r, y: centre.y + Math.sin(a0) * r };
  for (let i = 1; i <= steps; i++) {
    const a = a0 + ((a1 - a0) * i) / steps;
    const p = { x: centre.x + Math.cos(a) * r, y: centre.y + Math.sin(a) * r };
    lineBetween(doc, prev, p);
    prev = p;
  }
}

/** The units as filled outlines with their doors; `mezz` true omits the doors and labels (the mezzanine sheet draws its own). */
function drawUnitShells(doc, model, view, field, { doors = true } = {}) {
  const T = view.T;
  const { units } = model;
  doc.setLineDashPattern([], 0);
  for (const u of units) {
    const sp = u.poly.map(T);
    doc.setFillColor(...UNIT_FILL);
    polygon(doc, sp, 'F');
  }
  // Ground floor office or amenity beside the roller door, outlined lightly.
  for (const u of units) {
    const of = officeOf(u.spec);
    if (!of.fits) continue;
    const fr = u.frame;
    const ox = u.x0 + of.x0;
    const q = [rowPoint(fr, ox, u.d - of.depthMm), rowPoint(fr, u.x0 + u.w, u.d - of.depthMm), rowPoint(fr, u.x0 + u.w, u.d), rowPoint(fr, ox, u.d)].map(T);
    doc.setDrawColor(...GREYLINE);
    doc.setLineWidth(0.18);
    polygon(doc, q, 'S');
  }
  // Walls: party walls light, outer wall heavier. Drawn per unit; shared edges overlap.
  for (const u of units) {
    const sp = u.poly.map(T);
    doc.setDrawColor(...PEN.ink);
    doc.setLineWidth(0.22);
    polygon(doc, sp, 'S');
  }
  for (const u of units) {
    const sp = u.poly.map(T);
    for (const p of sp) field.addSeg(p, sp[(sp.indexOf(p) + 1) % 4], true);
  }
  if (!doors) return;
  for (const u of units) {
    const fr = u.frame;
    const fl = facadeLayout(u.spec);
    for (const dr of fl.doors) {
      if (!onFacade(dr, u.w)) continue;
      const a = T(rowPoint(fr, u.x0 + dr.offset - dr.w / 2, u.d));
      const b = T(rowPoint(fr, u.x0 + dr.offset + dr.w / 2, u.d));
      doc.setDrawColor(...RED);
      doc.setLineWidth(Math.max(0.7, Math.min(1.1, 280 / view.scale + 0.4)));
      lineBetween(doc, a, b);
    }
    const pd = fl.personnel;
    if (onFacade(pd, u.w)) {
      const a = T(rowPoint(fr, u.x0 + pd.offset - pd.w / 2, u.d));
      const b = T(rowPoint(fr, u.x0 + pd.offset + pd.w / 2, u.d));
      doc.setDrawColor(...BLUE);
      doc.setLineWidth(0.9);
      lineBetween(doc, a, b);
      // Door leaf and swing, outward from the hinge at the left jamb.
      const out = G.norm(G.sub(T(rowPoint(fr, u.x0 + pd.offset, u.d + 1000)), T(rowPoint(fr, u.x0 + pd.offset, u.d))));
      const r = lenOf(a, b);
      const tip = { x: a.x + out.x * r, y: a.y + out.y * r };
      doc.setLineWidth(0.15);
      lineBetween(doc, a, tip);
      doc.setLineDashPattern([0.6, 0.5], 0);
      arc(doc, a, { x: out.x, y: out.y }, G.norm(G.sub(b, a)), r);
      doc.setLineDashPattern([], 0);
    }
  }
}

/** Mezzanine outline of a unit in plan mm: [rear left, rear right, front right, front left] as 4 points. */
function mezzPoly(u, m) {
  const fr = u.frame;
  const [a0, a1] = m.position === 'front' ? [u.d - m.depthMm, u.d] : [0, m.depthMm];
  const x0 = u.x0 + m.x0Mm;
  const x1 = x0 + m.widthMm;
  return { poly: [rowPoint(fr, x0, a0), rowPoint(fr, x1, a0), rowPoint(fr, x1, a1), rowPoint(fr, x0, a1)], x0, x1, a0, a1 };
}

/** Stair rectangle of a unit in the row's frame, as the model places it (see materialise.js): { x0, x1, a0, a1, up } with `up` +1 toward +depth. */
function stairRect(u, m) {
  const sd = m.stair;
  const front = m.position === 'front';
  const x1m = u.x0 + m.x0Mm + m.widthMm;
  const x0m = u.x0 + m.x0Mm;
  const sideX = u.spec.mezzanine.stairSide === 'right' ? x1m - 300 - sd.widthMm / 2 : x0m + 300 + sd.widthMm / 2;
  const edge = front ? u.d - m.depthMm : m.depthMm;
  const [a0, a1] = front ? [edge - sd.lengthMm, edge] : [edge, edge + sd.lengthMm];
  return { x0: sideX - sd.widthMm / 2, x1: sideX + sd.widthMm / 2, a0, a1, up: front ? 1 : -1 };
}

// C100 existing site -------------------------------------------------------------------------------------------------------
function existingLegend(aerial, contours = [], lot = null) {
  const dc = drawnContext(lot);
  return legendBlock([
    ['Lot boundary (DCDB)', lineSw(aerial ? PEN.cadRed : PEN.ink, 0.7)],
    ...(dc.neighbours ? [['Adjoining lot boundary', lineSw(aerial ? [70, 74, 84] : GREYLINE, 0.18)]] : []),
    ...(dc.roads ? [['Road centreline', lineSw(PEN.phantom, 0.3, [3, 0.8, 0.6, 0.8])]] : []),
    ['Building setback line', lineSw(aerial ? PEN.envelopeAerial : GREYLINE, aerial ? 0.3 : 0.2, [1.6, 1])],
    ...(dc.roads ? [['Kerb and gutter', (doc, a, b) => { doc.setDrawColor(...PEN.ink); doc.setLineWidth(0.25); doc.line(a, b - 0.5, a + 12, b - 0.5); doc.line(a, b + 0.5, a + 12, b + 0.5); }]] : []),
    ...contours,
  ]);
}

export function drawExisting(doc, project, lot, { aerial = null, levels = null, clean: plain = false } = {}) {
  const q = blankProject(project, lot);
  // An aerial is placed as an upright image, so the sheet keeps north up when there is one (see existingScale in the set).
  const turn = !aerial;
  const view = siteView(q, lot, { turn });
  const over = aerialUnder(doc, aerial, view.T);
  const r = drawSite(doc, q, lot, { overAerial: over, turn, levels });
  const zone = lot.zoning ? [lot.zoning.code, lot.zoning.name].filter(Boolean).join(' ') : 'Not known';
  const sb = lot.setbacks || {};
  const mv = (v) => (typeof v === 'number' ? v : v?.minM);
  const kv = [
    r.kv.find((x) => x[0] === 'Lot area'),
    r.kv.find((x) => x[0] === 'Frontage / depth'),
    ['Zone', zone],
    ['Council', lot.lga || 'Not known'],
    ['Setbacks F / S / R', [mv(sb.front), mv(sb.side), mv(sb.rear)].map((v) => (typeof v === 'number' ? v.toFixed(2) : 'n/a')).join(' / ') + ' m'],
    r.kv.find((x) => x[0] === 'Contours'),
    ['Ground levels', hasGround(lot) ? 'Indicative, from the DEM' : 'None for this lot'],
  ].filter(Boolean);
  const notes = ['Boundaries from the cadastre (DCDB), subject to survey.', 'Bearings are grid bearings. Lengths are in metres.', 'Setback lines are indicative, check with council.'];
  if (r.groundNote) notes.push(r.groundNote);
  if (plain) notes.push('This sheet is the existing site sheet drawn without an aerial image.');
  else if (!over) notes.push('No aerial is shown for this lot.');
  return { scale: r.scale, scaleLabel: r.scaleLabel, kv, notes, blocks: [existingLegend(over, r.legendContours || [], lot)] };
}

// Catalogue buildings on C101: extras (apron, canopy, dock recess), walls, roller doors, the plan label with the GFA, dock and canopy lines,
// and the bay rows. The walls come from the materialised model so the sheet shows what the 3D model has.
function drawBuildingShells(doc, model, view, field) {
  const { c, project } = model;
  if (!c.buildings?.length) return;
  const { T, scale } = view;
  const bs = buildingsOf(c);
  for (const b of bs) {
    for (const e of b.extras) {
      const sp = e.polygon.map(T);
      if (e.kind === 'canopy' || e.kind === 'fuel-canopy') {
        doc.setDrawColor(...PEN.ink); doc.setLineWidth(0.18); doc.setLineDashPattern([1.6, 0.9], 0);
        polygon(doc, sp, 'S'); dashOff(doc);
      } else {
        doc.setFillColor(...(e.kind === 'dock-recess' ? [200, 203, 210] : e.kind === 'landscape' ? [222, 236, 218] : AISLE_FILL));
        polygon(doc, sp, 'F');
      }
    }
  }
  for (const pr of buildingParking(c).rows) {
    for (const sl of pr.slots) {
      const sp = sl.poly.map(T);
      if (sl.kind === 'accessible') { doc.setFillColor(196, 214, 244); doc.setDrawColor(...BLUE); doc.setLineWidth(0.3); polygon(doc, sp, 'FD'); }
      else if (sl.kind === 'zone') { doc.setFillColor(232, 240, 252); doc.setDrawColor(...BLUE); doc.setLineWidth(0.2); polygon(doc, sp, 'FD'); hatch(doc, sp, 'proposed', { spacing: 1.1, width: 0.07, colour: BLUE }); }
      else { doc.setDrawColor(...GREYLINE); doc.setLineWidth(0.15); polygon(doc, sp, 'S'); }
      field.addRing(sp);
      if (sl.kind === 'accessible') { const cc = T(sl.centre); if (c.parking.bayW / scale >= 2.2) haloText(doc, 'A', cc.x, cc.y + 0.9, { size: 6, bold: true, colour: BLUE, align: 'center', halo: 0.6 }); }
    }
  }
  for (const b of bs) {
    const sp = b.outline.map(T);
    doc.setFillColor(250, 250, 248);
    polygon(doc, sp, 'F');
    field.addRing(sp, true);
  }
  // Walls and roller doors from the model.
  const walls = (project.levels || []).flatMap((l) => l.walls || []).filter((w) => w.building);
  const doors = (project.levels || []).flatMap((l) => l.openings || []).filter((o) => o.building && o.kind === 'roller_door');
  doc.setDrawColor(...PEN.ink);
  for (const w of walls) {
    const a = T(w.a); const bb = T(w.b);
    doc.setLineWidth(Math.max(0.2, Math.min(0.9, (w.thickness || 200) / scale)));
    doc.line(a.x, a.y, bb.x, bb.y);
  }
  doc.setDrawColor(255, 255, 255);
  for (const o of doors) {
    const w = walls.find((x) => x.id === o.wallId);
    if (!w) continue;
    const len = Math.hypot(w.b.x - w.a.x, w.b.y - w.a.y) || 1;
    const u = { x: (w.b.x - w.a.x) / len, y: (w.b.y - w.a.y) / len };
    const p0 = T({ x: w.a.x + u.x * (o.offset - o.width / 2), y: w.a.y + u.y * (o.offset - o.width / 2) });
    const p1 = T({ x: w.a.x + u.x * (o.offset + o.width / 2), y: w.a.y + u.y * (o.offset + o.width / 2) });
    doc.setLineWidth(1.1); doc.line(p0.x, p0.y, p1.x, p1.y);
    doc.setDrawColor(...PEN.ink); doc.setLineWidth(0.2); doc.setLineDashPattern([1.2, 0.8], 0); doc.line(p0.x, p0.y, p1.x, p1.y); dashOff(doc);
    doc.setDrawColor(255, 255, 255);
  }
  // Labels: plan label and GFA in the building, extras by their own label, dock and canopy lines at the front.
  for (const b of bs) {
    const xs = b.local.outline.map((q) => q.x); const ys = b.local.outline.map((q) => q.y);
    const mid = T(b.frame ? { x: b.place.x + b.frame.u.x * (Math.min(...xs) + Math.max(...xs)) / 2 + b.frame.v.x * (Math.min(...ys) + Math.max(...ys)) / 2, y: b.place.y + b.frame.u.y * (Math.min(...xs) + Math.max(...xs)) / 2 + b.frame.v.y * (Math.min(...ys) + Math.max(...ys)) / 2 } : b.outline[0]);
    const w = (Math.max(...xs) - Math.min(...xs)) / scale;
    const size = Math.max(4.2, Math.min(7.5, w / 14));
    haloText(doc, b.planLabel, mid.x, mid.y - 0.6, { size, bold: true, align: 'center', halo: 0.8 });
    const gfaTxt = `B${b.n}  ${Math.round(b.gfaM2).toLocaleString('en-AU')} m2 GFA`;
    haloText(doc, gfaTxt, mid.x, mid.y + size * 0.42 + 0.6, { size: Math.max(4, size - 1.4), align: 'center', halo: 0.8 });
    // The labels are in the field so the FFL tag and the contour labels keep clear of them.
    setText(doc, size, true);
    const lw = doc.getTextWidth(clean(b.planLabel));
    setText(doc, Math.max(4, size - 1.4), false);
    const gw = doc.getTextWidth(clean(gfaTxt));
    field.addBox({ x0: mid.x - Math.max(lw, gw) / 2 - 0.5, y0: mid.y - 0.6 - size * MM - 0.4, x1: mid.x + Math.max(lw, gw) / 2 + 0.5, y1: mid.y + size * 0.42 + 1.4 });
    const centreOf = (poly) => { const q = poly.map(T); return { x: q.reduce((s, p) => s + p.x, 0) / q.length, y: q.reduce((s, p) => s + p.y, 0) / q.length }; };
    let k = 0;
    const lines = dockLines(b);
    for (const e of b.extras) {
      const txt = extraLabel(e);
      if (!txt) continue;
      const cc = centreOf(e.polygon);
      haloText(doc, txt, cc.x, cc.y + (k++ % 2) * 2.6, { size: 4.6, align: 'center', halo: 0.7, colour: [60, 64, 72] });
    }
    if (lines.length) {
      const fa = b.extras.find((e) => e.kind === 'apron' || e.kind === 'canopy' || e.kind === 'fuel-canopy');
      if (fa) { const cc = centreOf(fa.polygon); lines.forEach((t, i) => haloText(doc, t, cc.x, cc.y + 2.8 + 2.6 * (i + (k > 1 ? 1 : 0)), { size: 4.8, bold: i === 0, align: 'center', halo: 0.7 })); }
    }
  }
}

// C101 proposed layout -----------------------------------------------------------------------------------------------------
function layoutLegend(model = null, contours = [], lot = null) {
  const dc = drawnContext(lot);
  const hsTypes = [...new Set((model?.hardstand || []).map((x) => x.type))];
  // The legend lists only what this sheet draws.
  const units = model?.units || [];
  const c = model?.c || null;
  const slots = [...(model?.a?.parking?.rows || []), ...(c?.buildings?.length ? buildingParking(c).rows : [])].flatMap((r) => r.slots || []);
  const hasBay = slots.some((sl) => sl.kind !== 'accessible' && sl.kind !== 'zone');
  const hasAccessible = slots.some((sl) => sl.kind === 'accessible' || sl.kind === 'zone');
  const hasUnits = units.length > 0;
  const hasBuildingDoors = (model?.project?.levels || []).some((l) => (l.openings || []).some((o) => o.building && o.kind === 'roller_door'));
  const hasMezz = units.some((u) => mezzanineOf(u.spec).enabled);
  const hasBollards = (model?.a?.bollards || []).length > 0;
  return legendBlock([
    ['Lot boundary (existing)', lineSw(PEN.ink, 0.7)],
    ...(dc.neighbours ? [['Adjoining lot (DCDB)', lineSw(GREYLINE, 0.18)]] : []),
    ...(dc.roads ? [['Road centreline', lineSw(PEN.phantom, 0.3, [3, 0.8, 0.6, 0.8])]] : []),
    ['Building setback line', lineSw(GREYLINE, 0.2, [1.6, 1])],
    [model?.stats?.units > 0 ? 'PROPOSED UNIT' : 'PROPOSED BUILDING', swatch(UNIT_FILL, PEN.ink)],
    ...(hasMezz ? [['Mezzanine outline', lineSw(PEN.ink, 0.25, [1.6, 0.9])]] : []),
    ...(hasUnits ? [['Roller door', lineSw(RED, 0.9)], ['Personnel door', lineSw(BLUE, 0.9)]] : []),
    ...(hasBuildingDoors ? [['Roller or dock door', lineSw(PEN.ink, 0.25, [1.2, 0.8])]] : []),
    ['Truck apron and car aisle', swatch(AISLE_FILL, null)],
    ...(hasBay ? [['Parking bay', swatch([250, 250, 250], GREYLINE)]] : []),
    ...(hasAccessible ? [['Accessible bay and shared zone', swatch([196, 214, 244], BLUE)]] : []),
    ...(hasBollards ? [['Bollard', (doc, a, b) => { doc.setFillColor(224, 168, 0); doc.setDrawColor(29, 32, 36); doc.setLineWidth(0.15); doc.circle(a + 6, b, 0.9, 'FD'); }]] : []),
    ['Landscaping (indicative)', (doc, a, b) => { doc.setDrawColor(...GREEN); doc.setLineWidth(0.1); for (let k = 0; k < 6; k++) doc.line(a + k * 2, b + 1.2, a + k * 2 + 2, b - 1.2); }],
    ...hsTypes.map((id) => [`Hardstand: ${pavementById(id).short}, ${m2f((model.hardstand || []).filter((x) => x.type === id).reduce((s, x) => s + (x.areaM2 || 0), 0))} m2`, pavementSwatch(pavementById(id))]),
    ...((model?.hardstandKerbs || []).length ? [['Kerb, drawn hardstand', lineSw(PEN.ink, 0.45)]] : []),
    ...contours,
    ...(model?.osd ? [['OSD placeholder', (doc, a, b) => { doc.setDrawColor(...BLUE); doc.setLineWidth(0.2); doc.setLineDashPattern([1.2, 0.8], 0); doc.rect(a, b - 1.2, 5, 2.4, 'S'); doc.setLineDashPattern([], 0); }]] : []),
    ...(c?.waste ? [['Waste enclosure', (doc, a, b) => { doc.setFillColor(214, 196, 168); doc.setDrawColor(...PEN.ink); doc.setLineWidth(0.2); doc.rect(a, b - 1.2, 4, 2.4, 'FD'); }]] : []),
    ...(c?.hydrant ? [['Hydrant', (doc, a, b) => { doc.setFillColor(192, 57, 43); doc.circle(a + 3, b, 0.9, 'F'); }]] : []),
  ]);
}

function landscapeHatch(doc, model, view) {
  const { lot, covered } = model;
  const T = view.T;
  const lp = lot.boundary.map(T);
  const segs = hatchSegments(lp, 45, 3.2);
  doc.setDrawColor(150, 196, 156);
  doc.setLineWidth(0.08);
  dashOff(doc);
  const step = 0.8;
  for (const [a, b] of segs) {
    const len = lenOf(a, b);
    const n = Math.max(1, Math.ceil(len / step));
    let start = null;
    for (let i = 0; i <= n; i++) {
      const p = G.lerp(a, b, i / n);
      const open = i < n && !covered(view.Ti(p));
      if (open && !start) start = p;
      if (!open && start) { const e = G.lerp(a, b, Math.max(0, (i - 1) / n)); if (lenOf(start, e) > 0.3) doc.line(start.x, start.y, e.x, e.y); start = null; }
    }
  }
}

function placeNote(doc, field, text, cands, { size = 5.8, bold = false, colour = [60, 64, 72] } = {}) {
  setText(doc, size, bold, colour);
  const lines = text.split('\n');
  const w = Math.max(...lines.map((l) => doc.getTextWidth(l))) + 1.4;
  const h = lines.length * size * MM * 1.2 + 1;
  for (const c of cands) {
    const box = { x0: c.x - (c.align === 'left' ? 0 : w / 2), y0: c.y - h / 2, x1: c.x + (c.align === 'left' ? w : w / 2), y1: c.y + h / 2 };
    if (!field.free(box, { lines: false })) continue;
    lines.forEach((l, i) => haloText(doc, l, c.align === 'left' ? box.x0 + 0.7 : c.x, box.y0 + 0.5 + (i + 0.8) * size * MM * 1.2, { size, bold, colour, align: c.align === 'left' ? 'left' : 'center', halo: 0.9 }));
    field.addBox(box);
    return box;
  }
  return null;
}

/** Car park fill on a hardstand: bay lines, accessible bays and shared zone hatch, end islands, one way arrows and the bay count. */
function drawCarparkLines(doc, cp, view) {
  const T = view.T;
  const lay = cp.layout;
  if (!lay?.bays.length) return;
  dashOff(doc);
  doc.setFillColor(196, 214, 244);
  for (const b of lay.bays) if (b.kind !== 'bay') { doc.setFillColor(...(b.kind === 'zone' ? [255, 244, 190] : [196, 214, 244])); polygon(doc, b.poly.map(T), 'F'); }
  doc.setFillColor(176, 204, 160);
  for (const isl of lay.islands) polygon(doc, isl.map(T), 'F');
  doc.setDrawColor(...GREYLINE);
  doc.setLineWidth(0.1);
  for (const b of lay.bays) { const q = b.poly.map(T); doc.line(q[0].x, q[0].y, q[3].x, q[3].y); doc.line(q[1].x, q[1].y, q[2].x, q[2].y); if (b.kind !== 'zone') doc.line(q[0].x, q[0].y, q[1].x, q[1].y); }
  for (const b of lay.bays) if (b.kind === 'accessible' && cp.cfg.bayW / view.scale >= 2.2) { const c = T(b.centre); haloText(doc, 'A', c.x, c.y + 0.9, { size: 6, bold: true, colour: BLUE, align: 'center', halo: 0.6 }); }
  doc.setDrawColor(...PEN.ink);
  doc.setLineWidth(0.18);
  for (const a of lay.arrows) { const r = (a.rotationDeg * Math.PI) / 180; const p = T({ x: a.x - Math.cos(r) * 1200, y: a.y - Math.sin(r) * 1200 }); const q = T({ x: a.x + Math.cos(r) * 1200, y: a.y + Math.sin(r) * 1200 }); doc.line(p.x, p.y, q.x, q.y); const l = (d) => T({ x: a.x + Math.cos(r) * 1200 - Math.cos(r + d) * 700, y: a.y + Math.sin(r) * 1200 - Math.sin(r + d) * 700 }); const h1 = l(0.5); const h2 = l(-0.5); doc.line(q.x, q.y, h1.x, h1.y); doc.line(q.x, q.y, h2.x, h2.y); }
}

/** Hardstand drawn with the Hardstand tool: each area in the pale tint and hatch of its pavement type, its kerbs, and a label. */
function drawHardstandAreas(doc, model, view) {
  const T = view.T;
  const done = new Set();
  for (const x of model.hardstand || []) {
    const t = pavementById(x.type);
    if (!t) continue;
    const poly = x.polygon.map(T);
    doc.setFillColor(...paleOf(t.colour));
    polygon(doc, poly, 'F');
    const sp = Math.max(1.2, t.hatch2d.spacingMm / view.scale);
    doc.setDrawColor(...hexRgb(t.hatch2d.line));
    doc.setLineWidth(0.08);
    dashOff(doc);
    const angles = t.hatch2d.pattern === 'cross' || t.hatch2d.pattern === 'grid' ? [t.hatch2d.angleDeg, t.hatch2d.angleDeg + 90] : [t.hatch2d.angleDeg];
    for (const ang of angles) for (const [p, q] of hatchSegments(poly, ang, sp)) doc.line(p.x, p.y, q.x, q.y);
    doc.setDrawColor(...PEN.ink);
    doc.setLineWidth(0.15);
    polygon(doc, poly, 'S');
  }
  doc.setDrawColor(...PEN.ink);
  doc.setLineWidth(0.45);
  dashOff(doc);
  for (const k of model.hardstandKerbs || []) { const a = T(k.polyline[0]); const b = T(k.polyline[1]); doc.line(a.x, a.y, b.x, b.y); }
  for (const cp of model.carparks || []) drawCarparkLines(doc, cp, view);
  for (const x of model.hardstand || []) {
    const id = String(x.id).split('~')[0];
    if (done.has(id)) continue;
    done.add(id);
    const poly = x.polygon.map(T);
    const bb = boxOfPts(poly);
    if (bb.x1 - bb.x0 < 22 || bb.y1 - bb.y0 < 6) continue;
    const at = T(labelPoint(x.polygon));
    const t = pavementById(x.type);
    const cpl = (model.carparks || []).find((q) => q.id === id);
    haloText(doc, `${cpl ? 'CAR PARK, ' + cpl.layout.count + ' BAYS, ' : ''}${t.short.toUpperCase()} ${m2f(x.areaM2 || 0)} m2`, at.x, at.y, { size: 4.6, bold: true, align: 'center', halo: 0.7 });
  }
}

export function drawLayout(doc, model) {
  const { project, lot, c, a, units, stats, osd } = model;
  const view = layoutView(model);
  const { T, scale } = view;
  const field = new LabelField(VP);
  const cl = clearances(project);
  const edges = classifyEdges(lot);
  const roadName = (lot.roads && lot.roads[0]?.name) || lot.roadName || '';

  // DCDB context and the road reserve.
  dashOff(doc);
  doc.setLineWidth(0.15);
  doc.setDrawColor(...GREYLINE);
  const nlabels = [];
  for (const n of lot.neighbours || []) {
    if (!n.ring || n.ring.length < 3 || n.isRoad) continue;
    polyLine(doc, n.ring.map(T));
    if (n.lotNumber || n.planLabel) { const cc = T(G.polygonCentroid(n.ring)); if (inVP(cc)) nlabels.push({ cc, n }); }
  }
  drawRoads(doc, view, lot, field, roadName);

  // Setback line.
  const env = envelopePoly(lot);
  if (env) {
    doc.setLineWidth(0.2);
    doc.setDrawColor(...GREYLINE);
    doc.setLineDashPattern([1.8, 1.1], 0);
    polyLine(doc, env.map(T));
    dashOff(doc);
    field.addRing(env.map(T), true, true);
  }

  // Paving: truck apron, car aisle, then the bays.
  const offAll = model.off;
  const { aisleMm, bayW, bayL } = c.parking;
  for (const s of doorStrips(c, a.parking)) { doc.setFillColor(...PAVE_FILL); polygon(doc, s.poly.map(T), 'F'); } // bayless rows: apron in front of the roller doors
  const access = siteAccess(c, model.lot);
  let accessAnchor = null;
  if (access) {
    // Site access: the driveway from the boundary to the paving, and the crossover pad across the verge (always drawn).
    doc.setFillColor(...AISLE_FILL);
    if (access.driveway) polygon(doc, access.driveway.map(T), 'F');
    doc.setFillColor(...PAVE_FILL);
    polygon(doc, access.crossover.map(T), 'F');
    // The label is placed later, with the other call outs, so it avoids the lot boundary and the dimensions.
    accessAnchor = T({ x: (access.crossover[2].x + access.crossover[3].x) / 2, y: (access.crossover[2].y + access.crossover[3].y) / 2 });
  }
  // The model's own paving (links between the car park, the apron and the access) so C101 and C102 show the same pavement.
  for (const pa of model.pavingAreas || []) { doc.setFillColor(...PAVE_FILL); polygon(doc, pa.map(T), 'F'); }
  for (const pr of a.parking.rows) {
    if (!pr.slots.length) continue;
    const fr = pr.frame;
    const L = pr.length;
    const pt = (x, d) => T(rowPoint(fr, x, d));
    const off = pr.off ?? offAll;
    const apron = Math.max(0, off - aisleMm);
    doc.setFillColor(...PAVE_FILL);
    if (apron > 0) polygon(doc, [pt(0, pr.depth), pt(L, pr.depth), pt(L, pr.depth + apron), pt(0, pr.depth + apron)], 'F');
    doc.setFillColor(...AISLE_FILL);
    polygon(doc, [pt(0, pr.depth + apron), pt(L, pr.depth + apron), pt(L, pr.depth + off), pt(0, pr.depth + off)], 'F');
    doc.setFillColor(...PAVE_FILL);
    polygon(doc, [pt(0, pr.depth + off), pt(L, pr.depth + off), pt(L, pr.depth + off + bayL), pt(0, pr.depth + off + bayL)], 'F');
  }
  drawHardstandAreas(doc, model, view);
  // OSD placeholder, waste, then landscape hatch (so it never goes under the paving).
  landscapeHatch(doc, model, view);
  if (osd) {
    const sp = osd.poly.map(T);
    doc.setFillColor(214, 226, 244);
    polygon(doc, sp, 'F');
    hatch(doc, sp, 'proposed', { spacing: 1.4, width: 0.08, colour: BLUE });
    doc.setDrawColor(...BLUE);
    doc.setLineWidth(0.3);
    doc.setLineDashPattern([2, 1.2], 0);
    polygon(doc, sp, 'S');
    dashOff(doc);
    field.addRing(sp);
  }
  if (c.waste) {
    const sp = wastePoly(c.waste).map(T);
    doc.setFillColor(214, 196, 168);
    doc.setDrawColor(...PEN.ink);
    doc.setLineWidth(0.25);
    polygon(doc, sp, 'FD');
    field.addRing(sp);
  }

  // The existing ground contours sit here: over the paving and landscape, under the buildings and every other line.
  const levels = model.levels || levelsModel(project, lot);
  const gmark = streamMark(doc);

  // Units, doors, mezzanine outlines.
  drawUnitShells(doc, model, view, field);
  doc.setDrawColor(...PEN.ink);
  doc.setLineWidth(0.25);
  doc.setLineDashPattern([1.6, 0.9], 0);
  for (const u of units) {
    const m = mezzanineOf(u.spec);
    if (!m.enabled) continue;
    polygon(doc, mezzPoly(u, m).poly.map(T), 'S');
  }
  dashOff(doc);
  drawBuildingShells(doc, model, view, field);

  // Bays.
  for (const pr of a.parking.rows) {
    for (const sl of pr.slots) {
      const sp = sl.poly.map(T);
      if (sl.kind === 'accessible') {
        doc.setFillColor(196, 214, 244);
        doc.setDrawColor(...BLUE);
        doc.setLineWidth(0.3);
        polygon(doc, sp, 'FD');
      } else if (sl.kind === 'zone') {
        doc.setFillColor(232, 240, 252);
        doc.setDrawColor(...BLUE);
        doc.setLineWidth(0.2);
        polygon(doc, sp, 'FD');
        hatch(doc, sp, 'proposed', { spacing: 1.1, width: 0.07, colour: BLUE });
      } else {
        doc.setDrawColor(...GREYLINE);
        doc.setLineWidth(0.15);
        polygon(doc, sp, 'S');
      }
    }
  }
  // Accessible bay marks and the path of travel.
  for (const pr of a.parking.rows) {
    for (const sl of pr.slots) {
      if (sl.kind !== 'accessible') continue;
      const cc = T(sl.centre);
      const paper = bayW / scale;
      if (paper >= 2.2) haloText(doc, 'A', cc.x, cc.y + 0.9, { size: Math.min(7, paper * 2.4), bold: true, colour: BLUE, align: 'center', halo: 0.6 });
    }
  }
  if (a.parking.path) {
    const [p0, p1] = a.parking.path.map(T);
    doc.setDrawColor(...BLUE);
    doc.setLineWidth(0.35);
    doc.setLineDashPattern([1.4, 0.9], 0);
    lineBetween(doc, p0, p1);
    dashOff(doc);
    doc.setFillColor(...BLUE);
    doc.circle(p1.x, p1.y, 0.7, 'F');
  }
  // Bollards and the hydrant.
  doc.setFillColor(224, 168, 0);
  doc.setDrawColor(29, 32, 36);
  doc.setLineWidth(0.12);
  const br = Math.max(0.45, Math.min(0.9, 140 / scale * 2.2));
  for (const b of a.bollards) { const p = T(b); doc.circle(p.x, p.y, br, 'FD'); }
  if (c.hydrant) { const p = T(c.hydrant); doc.setFillColor(192, 57, 43); doc.circle(p.x, p.y, 1.1, 'F'); }

  // Lot boundary, corners.
  doc.setDrawColor(...PEN.ink);
  doc.setLineWidth(0.75);
  dashOff(doc);
  polyLine(doc, lot.boundary.map(T));
  doc.setFillColor(...PEN.ink);
  for (const p of lot.boundary) { const qq = T(p); if (inVP(qq)) doc.circle(qq.x, qq.y, 0.7, 'F'); }
  field.addRing(lot.boundary.map(T));

  // Unit labels.
  for (const u of units) {
    const of = officeOf(u.spec);
    const m = mezzanineOf(u.spec);
    const fb = Math.max(of.fits ? of.depthMm : 0, m.enabled && m.position === 'front' ? m.depthMm : 0);
    const a1 = Math.max(u.d / 2, u.d - fb - 300);
    const area = (u.w * u.d) / 1e6;
    const placed = labelInLocal(doc, field, { frame: u.frame, T, scale, x0: u.x0 + 200, x1: u.x0 + u.w - 200, a0: 300, a1, variants: unitLines(u, area), maxSize: 8.4 });
    if (!placed) {
      const cc = T(rowPoint(u.frame, u.x0 + u.w / 2, a1 / 2));
      setText(doc, 5, true);
      haloText(doc, String(u.n), cc.x, cc.y + 0.8, { size: 5, bold: true, align: 'center', halo: 0.8 });
    }
  }

  // Dimensions: each row's length along its facade and its depth at the left end.
  for (const row of c.rows) {
    const us = units.filter((u) => u.rowId === row.id);
    if (!us.length) continue;
    const fr = us[0].frame;
    const L = us.reduce((s, u) => s + u.w, 0);
    const d = us[0].d;
    const A = T(rowPoint(fr, 0, d));
    const B = T(rowPoint(fr, L, d));
    const fdir = G.norm(G.sub(T(rowPoint(fr, 0, d + 1000)), A));
    // Facade side: shift the dimension 5 mm out along the facade normal.
    const pa = { x: A.x + fdir.x * 5, y: A.y + fdir.y * 5 };
    const pb = { x: B.x + fdir.x * 5, y: B.y + fdir.y * 5 };
    const nrm = G.norm({ x: -(pb.y - pa.y), y: pb.x - pa.x });
    void nrm;
    const box = dimLine(doc, pa, pb, `${m1(L)} m`, { colour: PEN.dim, size: 7.5, textSide: G.dot({ x: -(pb.y - pa.y), y: pb.x - pa.x }, fdir) > 0 ? 1 : -1, field });
    if (box) field.addBox(box);
    field.addSeg(pa, pb);
    // Depth: at the left end, outside the row.
    const e0 = T(rowPoint(fr, 0, 0));
    const e1 = T(rowPoint(fr, 0, d));
    const udir = G.norm(G.sub(T(rowPoint(fr, -1000, 0)), e0));
    const qa = { x: e0.x + udir.x * 4, y: e0.y + udir.y * 4 };
    const qb = { x: e1.x + udir.x * 4, y: e1.y + udir.y * 4 };
    const box2 = dimLine(doc, qa, qb, `${m1(d)} m`, { colour: PEN.dim, size: 7.5, textSide: G.dot({ x: -(qb.y - qa.y), y: qb.x - qa.x }, udir) > 0 ? 1 : -1, field });
    if (box2) field.addBox(box2);
    field.addSeg(qa, qb);
  }
  // Apron and aisle: a dimension from the facade to the near edge of the bays, once per bay row, then labels along the paving.
  const bayRowsDone = new Set();
  for (const pr of a.parking.rows) {
    if (!pr.slots.length || bayRowsDone.size >= 2) continue;
    bayRowsDone.add(pr.rowId);
    const off = pr.off ?? offAll;
    const fr = pr.frame;
    const L = pr.length;
    const along = Math.max(bayW, Math.min(L - bayW, L * 0.18));
    const A = T(rowPoint(fr, along, pr.depth));
    const B = T(rowPoint(fr, along, pr.depth + off));
    if (lenOf(A, B) > 6) {
      const box = dimLine(doc, A, B, `${m1(off)} m`, { colour: PEN.dim, size: 7.5, textSide: 1, field });
      if (box) field.addBox(box);
      field.addSeg(A, B);
    }
    const lab = (txt, d0, d1, t, fs) => {
      const p = T(rowPoint(fr, 0, (d0 + d1) / 2));
      const q = T(rowPoint(fr, L, (d0 + d1) / 2));
      const dir = G.norm(G.sub(q, p));
      const cands = (fs || [t]).map((f) => () => alongLabel(doc, txt, G.lerp(p, q, f), dir, -6.8 * MM / 2, { size: 6.8, bold: true, colour: [70, 74, 82], halo: 0.9 }));
      field.place(cands, { lines: false });
    };
    const apron = Math.max(0, off - aisleMm);
    if (apron > 0) lab(`TRUCK APRON ${m1(off)} m CLEAR`, pr.depth, pr.depth + apron, 0.7, [0.7, 0.3, 0.85, 0.15, 0.5]);
    lab(`CAR AISLE ${m1(aisleMm)} m`, pr.depth + apron, pr.depth + off, 0.7, [0.7, 0.3, 0.85, 0.15, 0.5]);
    // Bay count, outside the back of the bays.
    const bays = pr.slots.filter((s) => s.kind !== 'zone').length;
    const kb0 = T(rowPoint(fr, 0, pr.depth + off + bayL));
    const kb1 = T(rowPoint(fr, pr.slots.length * bayW, pr.depth + off + bayL));
    const odir = G.norm(G.sub(kb1, kb0));
    const back = G.norm(G.sub(T(rowPoint(fr, 0, pr.depth + off + bayL + 1000)), kb0));
    const cand = [0.5, 0.3, 0.7].map((f) => () => {
      const p0 = G.lerp(kb0, kb1, f);
      const probe = alongLabel(doc, 'X', p0, odir, 0, { size: 6.8 });
      const sign = G.dot(probe.up, back) > 0 ? 1 : -1;
      const h = 6.8 * MM;
      return alongLabel(doc, `${bays} ${bays === 1 ? 'BAY' : 'BAYS'} ${m1(bayW)} x ${m1(bayL)} m`, p0, odir, sign > 0 ? 1.2 : -(1.2 + h), { size: 6.8, bold: true, colour: [70, 74, 82], halo: 0.9 });
    });
    field.place(cand, { lines: false });
  }

  // Setback labels and clearance dimensions (same method as the site plan).
  const sbSize = 7;
  for (const kind of ['front', 'secondaryFront', 'side', 'rear']) {
    const es = edges.filter((e) => e.kind === kind && requiredFor(kind, lot.setbacks) != null);
    if (!es.length) continue;
    const e = es.reduce((x, y) => (G.dist(y.a, y.b) > G.dist(x.a, x.b) ? y : x));
    const req = requiredFor(kind, lot.setbacks);
    const inn = inwardNormalOf(lot, e.index);
    for (const f of [0.5, 0.25, 0.75, 0.15, 0.85]) {
      const p0 = G.lerp(e.a, e.b, f);
      const p1 = G.add(p0, G.mul(inn, req * 1000));
      const A = T(p0);
      const B = T(p1);
      if (lenOf(A, B) < 5) {
        const dirS = G.norm(G.sub(T(e.b), T(e.a)));
        const l = alongLabel(doc, `${req.toFixed(2)} SB`, A, dirS, 1.2, { size: sbSize, colour: [90, 94, 102], halo: 0.9 });
        if (field.free(l.box, { lines: false })) { l.draw(); field.addBox(l.box); break; }
        continue;
      }
      if (!field.free(boxOfPts([A, B], 1.2), { soft: false, lines: true, ignoreSegs: field.segs.filter((sg) => sg.soft) })) continue;
      const box = dimLine(doc, A, B, `${req.toFixed(2)} SB`, { colour: [90, 94, 102], size: sbSize, textSide: 1, field });
      if (box) field.addBox(box);
      field.addSeg(A, B);
      break;
    }
  }
  for (const row of Object.values(cl.byKind || {})) {
    if (!row?.from || !row?.to) continue;
    const A = T(row.from);
    const B = T(row.to);
    if (lenOf(A, B) < 4) continue;
    if (row.requiredM != null && Math.abs(row.clearanceM - row.requiredM) < 0.005) continue;
    const over = row.status === 'outside';
    const box = dimLine(doc, A, B, `${Math.abs(row.clearanceM).toFixed(2)} m`, { colour: over ? RED : PEN.dim, size: 7, textSide: -1, field });
    if (box) field.addBox(box);
    field.addSeg(A, B);
  }

  // Lot and DP, adjoining lot labels.
  for (const { cc, n } of nlabels) {
    setText(doc, 5.6, false, GREYLINE);
    const w = Math.max(doc.getTextWidth(`LOT ${n.lotNumber || ''}`), doc.getTextWidth(String(n.planLabel || ''))) + 1;
    const box = { x0: cc.x - w / 2, y0: cc.y - 3.2, x1: cc.x + w / 2, y1: cc.y + 3 };
    if (!field.free(box, { lines: false })) continue;
    if (n.lotNumber) haloText(doc, `LOT ${n.lotNumber}`, cc.x, cc.y - 0.6, { size: 7, colour: GREYLINE, align: 'center', halo: 1 });
    if (n.planLabel) haloText(doc, String(n.planLabel), cc.x, cc.y + 2.2, { size: 7, colour: GREYLINE, align: 'center', halo: 1 });
    field.addBox(box);
  }
  const lotFirst = lot.lotNumber ? `${lot.proposed ? 'PROPOSED LOT' : 'LOT'} ${lot.lotNumber}` : 'SUBJECT LOT';
  const lotAspace = `${Math.round(lot.areaM2 || G.polygonArea(lot.boundary) / 1e6).toLocaleString('en-AU')} m²`;
  const lp = lot.boundary.map(T);
  const lb = G.bbox(lp);
  const lotCands = [];
  for (let x = lb.minX; x <= lb.maxX; x += 4) for (let y = lb.minY; y <= lb.maxY; y += 4) lotCands.push({ x, y });
  for (const [s1, s2] of [[11, 8], [9, 7], [7.5, 6.2]]) {
    setText(doc, s1, true);
    let w = doc.getTextWidth(lotFirst);
    setText(doc, s2, true);
    if (lot.planLabel) w = Math.max(w, doc.getTextWidth(String(lot.planLabel)));
    w = Math.max(w, doc.getTextWidth(lotAspace)) + 2;
    const h = (s1 + s2 * (lot.planLabel ? 2 : 1)) * MM + 5;
    const spot = lotCands.map((cc) => ({ ...cc, d: 0 })).find((cc) => {
      const box = { x0: cc.x - w / 2, y0: cc.y - h / 2, x1: cc.x + w / 2, y1: cc.y + h / 2 };
      return [[box.x0, box.y0], [box.x1, box.y0], [box.x1, box.y1], [box.x0, box.y1]].every(([x, y]) => G.pointInPolygon({ x, y }, lp)) && field.free(box, { soft: true, lines: true });
    });
    if (!spot) continue;
    let y = spot.y - h / 2 + 2 + s1 * MM * 0.9;
    haloText(doc, lotFirst, spot.x, y, { size: s1, bold: true, align: 'center', halo: 1.1 });
    if (lot.planLabel) { y += s2 * MM + 1.6; haloText(doc, String(lot.planLabel), spot.x, y, { size: s2, bold: true, align: 'center', halo: 1.1 }); }
    y += s2 * MM + 1.8;
    haloText(doc, lotAspace, spot.x, y, { size: s2, bold: false, align: 'center', halo: 1.1 });
    field.addBox({ x0: spot.x - w / 2, y0: spot.y - h / 2, x1: spot.x + w / 2, y1: spot.y + h / 2 });
    break;
  }

  // Call outs: accessible bay, OSD placeholder, landscaping, waste.
  const callout = (anchor, text, colour, clear = 0) => {
    const lines = text.split('\n');
    setText(doc, 5.6, false, colour);
    const w = Math.max(...lines.map((l) => doc.getTextWidth(l))) + 2;
    const h = lines.length * 5.6 * MM * 1.2 + 1.6;
    const tried = [];
    for (const r of [8, 14, 22, 32, 44].map((v) => v + clear)) for (const ang of [-90, 90, 0, 180, -45, 45, -135, 135]) {
      const rad = (ang * Math.PI) / 180;
      tried.push({ x: anchor.x + Math.cos(rad) * (r + w / 2 * Math.abs(Math.cos(rad))), y: anchor.y + Math.sin(rad) * (r + h / 2 * Math.abs(Math.sin(rad))) });
    }
    // First a spot clear of every line (lot boundary, dimensions), then one clear of other labels only.
    for (const cc of [...tried.map((t) => ({ ...t, lines: true })), ...tried.map((t) => ({ ...t, lines: false }))]) {
      const box = { x0: cc.x - w / 2, y0: cc.y - h / 2, x1: cc.x + w / 2, y1: cc.y + h / 2 };
      if (!field.free(box, { lines: cc.lines, soft: !cc.lines })) continue;
      doc.setFillColor(255, 255, 255);
      doc.setDrawColor(...colour);
      doc.setLineWidth(0.18);
      doc.rect(box.x0, box.y0, w, h, 'FD');
      const edgeP = { x: Math.max(box.x0, Math.min(box.x1, anchor.x)), y: Math.max(box.y0, Math.min(box.y1, anchor.y)) };
      doc.line(edgeP.x, edgeP.y, anchor.x, anchor.y);
      setText(doc, 5.6, false, colour);
      lines.forEach((l, i) => doc.text(l, box.x0 + 1, box.y0 + 0.8 + (i + 0.85) * 5.6 * MM * 1.2));
      field.addBox(box);
      return true;
    }
    return false;
  };
  const zone = a.parking.rows.flatMap((pr) => pr.slots).find((s) => s.kind === 'zone');
  if (zone) callout(T(zone.centre), `ACCESSIBLE BAYS (${a.parking.accessible.provided}) AND SHARED ZONE\nAS/NZS 2890.6, CENTRAL BOLLARD, INDICATIVE`, BLUE);
  if (osd) callout(T(osd.centre), `OSD BASIN PLACEHOLDER, NOT SIZED\n${osd.basis === 'levels' ? 'AT THE LOWEST GROUND (INDICATIVE LEVELS)' : 'LOW POINT ASSUMED, NO LEVELS'}`, BLUE, lenOf(T(osd.poly[0]), T(osd.poly[2])) / 2);
  if (c.waste) callout(T({ x: c.waste.x, y: c.waste.y }), 'WASTE ENCLOSURE', [70, 74, 82]);
  if (accessAnchor) callout(accessAnchor, 'SITE ACCESS AND CROSSOVER\n(INDICATIVE)', [70, 74, 82]);
  if (model.land.pct != null) {
    const lpts = lot.boundary.map(T);
    const front = edges.find((e) => e.kind === 'front');
    const target = front ? T(G.lerp(front.a, front.b, 0.5)) : lpts[0];
    const spots = [];
    const lbb = G.bbox(lpts);
    for (let y = lbb.minY; y <= lbb.maxY; y += 2.5) for (let x = lbb.minX; x <= lbb.maxX; x += 2.5) {
      const p = { x, y };
      if (G.pointInPolygon(p, lpts) && !model.covered(view.Ti(p))) spots.push({ x, y, d: Math.hypot(x - target.x, y - target.y) });
    }
    spots.sort((p, q) => p.d - q.d);
    placeNote(doc, field, 'LANDSCAPING', spots.slice(0, 120), { size: 7.5, bold: true, colour: [40, 100, 52] });
  }

  // Ground levels: FFL tag per building or row, spot levels at the lot corners, RL labels, then the contours under the linework.
  const bld = buildingsOf(c);
  const masks = [...units.map((u) => u.poly), ...buildingPolys(c), ...(c.waste ? [wastePoly(c.waste)] : []), ...(osd ? [osd.poly] : [])].map((poly) => poly.map(T));
  const ffl = bld.filter((b) => b.outline?.length >= 3).map((b) => ({ poly: b.outline.map(T), text: fflText(levels, levels.fflOf(b.outline)) }));
  for (const row of c.rows || []) {
    const pts = units.filter((u) => u.rowId === row.id).flatMap((u) => u.poly);
    if (!pts.length) continue;
    const bb = G.bbox(pts);
    const plan = [{ x: bb.minX, y: bb.minY }, { x: bb.maxX, y: bb.minY }, { x: bb.maxX, y: bb.maxY }, { x: bb.minX, y: bb.maxY }];
    ffl.push({ poly: plan.map(T), text: fflText(levels, levels.fflOf(plan)) });
  }
  const ground = drawGroundLayer(doc, { lot, levels, S: T, Si: view.Ti, rect: VP, field, masks, spots: outwardSpots(cornersOf(lot.boundary), T), ffl, mark: gmark });

  northAndScale(doc, field, project, scale, view);

  const ratio = stats.parking;
  const kv = [
    ['Lot area', `${m2f(stats.lotM2 ?? 0)} m²`],
    ...(stats.units ? [['Units', `${stats.units} (${stats.mix.map((x) => `${x.count} x ${x.label}`).join(', ')})`]] : []),
    ...(stats.buildingCount ? [['Buildings', `${stats.buildingCount} (${(stats.buildings || []).map((b) => b.label).join(', ')})`]] : []),
    ['GFA incl. mezzanine', `${m2f(stats.gfaM2)} m²`],
    ['Site coverage', stats.coveragePct != null ? `${stats.coveragePct} %` : 'n/a'],
    ['Landscaping (indicative)', model.land.pct != null ? `${model.land.pct} %` : 'n/a'],
    ['Bays, shown / required', `${ratio.provided} / ${ratio.required}`],
    ground.interval && ground.stroked ? ['Contours', intervalText(ground.interval)] : null,
    levels.has ? null : ['Ground levels', 'None for this lot'],
  ].filter(Boolean);
  const notes = [
    'Layout, parking and setbacks are indicative, check with council.',
    'Blue dimensions are the clearance from the buildings to the lot boundary.',
    'Site access and crossover are indicative and to be confirmed with council.',
  ];
  notes.push(levels.has ? ground.note : 'No ground levels for this lot. Floor levels are on an assumed datum.');
  return { scale, kv, notes, blocks: [layoutLegend(model, ground.legend, lot)], ground };
}

// C102 mezzanine level plan --------------------------------------------------------------------------------------------------
function mezzLegend(contours = []) {
  return legendBlock([
    ['PROPOSED UNIT wall', lineSw(PEN.ink, 0.5)],
    ['Mezzanine floor', swatch([228, 238, 252], PEN.ink)],
    ['Balustrade', (doc, a, b) => { doc.setDrawColor(60, 60, 60); doc.setLineWidth(0.18); doc.line(a, b - 0.5, a + 12, b - 0.5); doc.line(a, b + 0.5, a + 12, b + 0.5); }],
    ['Stair (up to the mezzanine)', (doc, a, b) => { doc.setDrawColor(...PEN.ink); doc.setLineWidth(0.12); doc.rect(a, b - 1.4, 12, 2.8, 'S'); for (let k = 1; k < 8; k++) doc.line(a + k * 1.5, b - 1.4, a + k * 1.5, b + 1.4); }],
    ['Ground floor office or amenity', swatch(null, GREYLINE)],
    ['Roller door (ground floor)', lineSw(RED, 0.9)],
    ['Personnel door (ground floor)', lineSw(BLUE, 0.9)],
    ...contours,
  ]);
}

export function drawMezzanine(doc, model) {
  const { project, units } = model;
  const view = mezzView(model);
  const { T, scale } = view;
  const field = new LabelField(VP);
  const lv = model.levels || levelsModel(project, model.lot);
  const gmark = streamMark(doc); // the existing contours sit under everything, outside the buildings
  drawUnitShells(doc, model, view, field);
  const balPad = 0.0;
  void balPad;
  const mezzUnits = [];
  for (const u of units) {
    const m = mezzanineOf(u.spec);
    if (!m.enabled) continue;
    mezzUnits.push({ u, m });
    const mp = mezzPoly(u, m);
    const sp = mp.poly.map(T);
    doc.setFillColor(228, 238, 252);
    doc.setDrawColor(...PEN.ink);
    doc.setLineWidth(0.4);
    polygon(doc, sp, 'FD');
    // Stair: outline with treads and an arrow toward the mezzanine.
    const st = stairRect(u, m);
    const sq = [rowPoint(u.frame, st.x0, st.a0), rowPoint(u.frame, st.x1, st.a0), rowPoint(u.frame, st.x1, st.a1), rowPoint(u.frame, st.x0, st.a1)].map(T);
    doc.setFillColor(255, 255, 255);
    doc.setDrawColor(...PEN.ink);
    doc.setLineWidth(0.2);
    polygon(doc, sq, 'FD');
    const treads = Math.max(4, Math.round((st.a1 - st.a0) / 250));
    doc.setLineWidth(0.1);
    for (let k = 1; k < treads; k++) {
      const aa = st.a0 + ((st.a1 - st.a0) * k) / treads;
      lineBetween(doc, T(rowPoint(u.frame, st.x0, aa)), T(rowPoint(u.frame, st.x1, aa)));
    }
    const xm = (st.x0 + st.x1) / 2;
    const from = st.up > 0 ? st.a0 + 300 : st.a1 - 300;
    const to = st.up > 0 ? st.a1 - 300 : st.a0 + 300;
    const ap = T(rowPoint(u.frame, xm, from));
    const bp = T(rowPoint(u.frame, xm, to));
    doc.setDrawColor(...PEN.ink);
    doc.setLineWidth(0.25);
    lineBetween(doc, ap, bp);
    const dd = G.norm(G.sub(bp, ap));
    const nn = { x: -dd.y, y: dd.x };
    doc.setFillColor(...PEN.ink);
    doc.triangle(bp.x, bp.y, bp.x - dd.x * 1.6 + nn.x * 0.8, bp.y - dd.y * 1.6 + nn.y * 0.8, bp.x - dd.x * 1.6 - nn.x * 0.8, bp.y - dd.y * 1.6 - nn.y * 0.8, 'F');
    field.addRing(sq);
  }
  // Balustrade on every mezzanine edge that is not a wall, leaving the stair opening.
  doc.setDrawColor(60, 60, 60);
  for (const { u, m } of mezzUnits) {
    if (!u.spec.mezzanine.balustrade) continue;
    const mp = mezzPoly(u, m);
    const st = stairRect(u, m);
    const edges = [
      { wall: mp.x0 - u.x0 <= 1, a: [mp.x0, mp.a0], b: [mp.x0, mp.a1], axis: 'a' },
      { wall: mp.x1 - u.x0 >= u.w - 1, a: [mp.x1, mp.a0], b: [mp.x1, mp.a1], axis: 'a' },
      { wall: mp.a0 <= 1, a: [mp.x0, mp.a0], b: [mp.x1, mp.a0], axis: 'x' },
      { wall: mp.a1 >= u.d - 1, a: [mp.x0, mp.a1], b: [mp.x1, mp.a1], axis: 'x' },
    ];
    const stairAtEdge = (e) => e.axis === 'x' && (Math.abs(e.a[1] - st.a0) < 5 || Math.abs(e.a[1] - st.a1) < 5);
    for (const e of edges) {
      if (e.wall) continue;
      const segs = [[e.a, e.b]];
      if (stairAtEdge(e)) {
        const lo = Math.min(st.x0, st.x1);
        const hi = Math.max(st.x0, st.x1);
        segs.length = 0;
        if (lo > mp.x0 + 1) segs.push([e.a, [lo, e.a[1]]]);
        if (hi < mp.x1 - 1) segs.push([[hi, e.a[1]], e.b]);
      }
      for (const [s0, s1] of segs) {
        const P0 = T(rowPoint(u.frame, s0[0], s0[1]));
        const P1 = T(rowPoint(u.frame, s1[0], s1[1]));
        const dir = G.norm(G.sub(P1, P0));
        const nrm = { x: -dir.y * 0.28, y: dir.x * 0.28 };
        doc.setLineWidth(0.16);
        lineBetween(doc, { x: P0.x + nrm.x, y: P0.y + nrm.y }, { x: P1.x + nrm.x, y: P1.y + nrm.y });
        lineBetween(doc, { x: P0.x - nrm.x, y: P0.y - nrm.y }, { x: P1.x - nrm.x, y: P1.y - nrm.y });
      }
    }
  }
  // Labels: mezzanine first (it is the subject), then the unit names in the workshop below.
  for (const { u, m } of mezzUnits) {
    const mp = mezzPoly(u, m);
    const use = m.use === 'storage' ? 'MEZZANINE STORAGE' : 'MEZZANINE OFFICE';
    const variants = [[use, `${m.areaM2.toFixed(1)} m²`], ['MEZZANINE', m.use === 'storage' ? 'STORAGE' : 'OFFICE', `${m.areaM2.toFixed(1)} m²`], [m.use === 'storage' ? 'STORE' : 'OFFICE', `${m.areaM2.toFixed(0)} m²`]];
    labelInLocal(doc, field, { frame: u.frame, T, scale, x0: mp.x0 + 100, x1: mp.x1 - 100, a0: mp.a0 + 100, a1: mp.a1 - 100, variants, maxSize: 7, bold: [true, false, false] });
  }
  for (const u of units) {
    const m = mezzanineOf(u.spec);
    const of = officeOf(u.spec);
    const fb = Math.max(of.fits ? of.depthMm : 0, m.enabled && m.position === 'front' ? m.depthMm : 0);
    const stairDepth = m.enabled ? m.stair.lengthMm : 0;
    const a1 = Math.max(u.d / 2, u.d - fb - stairDepth - 300);
    labelInLocal(doc, field, { frame: u.frame, T, scale, x0: u.x0 + 200, x1: u.x0 + u.w - 200, a0: 300, a1, variants: [[`PROPOSED UNIT ${u.n}`], [`PROPOSED`, `UNIT ${u.n}`]], maxSize: 6.4, bold: [true, true], colour: [70, 74, 82] });
  }
  // Mezzanine width dimension, once per row, outside the facade.
  const done = new Set();
  for (const { u, m } of mezzUnits) {
    if (done.has(u.rowId)) continue;
    done.add(u.rowId);
    const mp = mezzPoly(u, m);
    const fr = u.frame;
    const dd = m.position === 'front' ? u.d : 0;
    const A = T(rowPoint(fr, mp.x0, dd));
    const B = T(rowPoint(fr, mp.x1, dd));
    const out = G.norm(G.sub(T(rowPoint(fr, mp.x0, m.position === 'front' ? u.d + 1000 : -1000)), A));
    const pa = { x: A.x + out.x * 4, y: A.y + out.y * 4 };
    const pb = { x: B.x + out.x * 4, y: B.y + out.y * 4 };
    const box = dimLine(doc, pa, pb, `${(m.widthMm / 1000).toFixed(2)} m`, { colour: PEN.dim, size: 7.2, textSide: G.dot({ x: -(pb.y - pa.y), y: pb.x - pa.x }, out) > 0 ? 1 : -1, field });
    if (box) field.addBox(box);
    field.addSeg(pa, pb);
  }
  // Existing ground contours outside the buildings (the site context of the level plan), in pale pens.
  const mmasks = [...units.map((u) => u.poly), ...buildingsOf(model.c).map((b) => b.outline)].filter((q) => q?.length >= 3).map((poly) => poly.map(T));
  void mmasks; void gmark; // floor plans carry no ground contours
  const ground = { legend: [], interval: null, note: '' };
  northAndScale(doc, field, project, scale, view);
  const mz = model.stats;
  const levels = [...new Set(mezzUnits.map(({ m }) => m.level))];
  const kv = [
    ['Units with a mezzanine', `${mezzUnits.length} of ${units.length}`],
    ['Mezzanine area', `${m2f(mz.mezzGfaM2)} m²`],
    ['Mezzanine office area', `${m2f(mz.officeMezzM2)} m²`],
    ['Mezzanine floor level', levels.length ? levels.map((l) => `${(l / 1000).toFixed(2)} m above ground floor`).join(', ') : 'No mezzanine'],
    ['Clear height above / below', mezzUnits.length ? `${(mezzUnits[0].m.clearAbove / 1000).toFixed(2)} / ${(mezzUnits[0].m.clearBelow / 1000).toFixed(2)} m` : 'n/a'],
  ];
  const notes = [
    `Barrier ${facts('barrier').value?.min_mm ?? 1000} mm high at the mezzanine edge and ${facts('barrierStair').value?.min_mm ?? 865} mm at the stair, check the NCC.`,
    'The mezzanine may count as a storey above its area limit, check with council and the NCC.',
    'Clear height under the mezzanine is unverified, see C900.',
  ];
  return { scale, kv, notes, blocks: [mezzLegend(ground.legend)] };
}

// C103 yield summary --------------------------------------------------------------------------------------------------------
const X0 = AREA.x0 + 4;
const X1 = AREA.x1 - 4;

function sectionTitle(doc, text, x, y, w) {
  setText(doc, 8.4, true);
  doc.text(clean(text), x, y);
  doc.setDrawColor(...PEN.ink);
  doc.setLineWidth(0.3);
  doc.line(x, y + 1.6, x + w, y + 1.6);
  return y + 5.4;
}

/** A table: cols [{ w, align, t }], header cells, rows of strings. Returns the y after it. */
function table(doc, x, y, cols, header, rows, { rh = 4.1, size = 6.6, boldLast = false } = {}) {
  const W = cols.reduce((s, c) => s + c.w, 0);
  doc.setFillColor(238, 241, 246);
  doc.rect(x, y - 3.2, W, rh, 'F');
  setText(doc, size - 0.4, true, [60, 64, 72]);
  let cx = x;
  header.forEach((h, i) => { doc.text(clean(h), cols[i].align === 'right' ? cx + cols[i].w - 1.2 : cx + 1.2, y, { align: cols[i].align === 'right' ? 'right' : 'left' }); cx += cols[i].w; });
  y += rh;
  rows.forEach((r, k) => {
    const last = boldLast && k === rows.length - 1;
    if (last) { doc.setDrawColor(...PEN.ink); doc.setLineWidth(0.25); doc.line(x, y - 3.2, x + W, y - 3.2); }
    setText(doc, size, last);
    let xx = x;
    r.forEach((cell, i) => {
      const t = fit(doc, clean(cell), cols[i].w - 2);
      doc.text(t, cols[i].align === 'right' ? xx + cols[i].w - 1.2 : xx + 1.2, y, { align: cols[i].align === 'right' ? 'right' : 'left' });
      xx += cols[i].w;
    });
    doc.setDrawColor(210, 213, 219);
    doc.setLineWidth(0.1);
    doc.line(x, y + 0.9, x + W, y + 0.9);
    y += rh;
  });
  return y;
}

function kvTable(doc, x, y, w, rows, { size = 6.8, split = 0.4 } = {}) {
  const kw = w * split;
  for (const [k, v] of rows) {
    setText(doc, size, true, [90, 94, 102]);
    const kl = wrap(doc, k, kw - 2);
    setText(doc, size, false);
    const vl = wrap(doc, v, w - kw - 1);
    const n = Math.max(kl.length, vl.length);
    setText(doc, size, true, [90, 94, 102]);
    kl.forEach((l, i) => doc.text(l, x, y + i * 3.1));
    setText(doc, size, false);
    vl.forEach((l, i) => doc.text(l, x + kw, y + i * 3.1));
    doc.setDrawColor(215, 218, 224);
    doc.setLineWidth(0.1);
    doc.line(x, y + (n - 1) * 3.1 + 1.3, x + w, y + (n - 1) * 3.1 + 1.3);
    y += n * 3.1 + 1.5;
  }
  return y;
}

function paragraphs(doc, x, y, w, items, { size = 6.2, lead = 2.85, bullet = true } = {}) {
  setText(doc, size, false);
  for (const t of items) {
    const lines = wrap(doc, t, w - (bullet ? 3 : 0));
    lines.forEach((l, i) => { doc.text(l, x + (bullet ? 3 : 0), y); if (bullet && i === 0) doc.circle(x + 0.8, y - 0.9, 0.35, 'F'); y += lead; });
    y += 0.7;
  }
  return y;
}

/** The unit schedule rows and the totals row. */
export function unitScheduleRows(model) {
  const rows = model.units.map((u) => {
    const m = mezzanineOf(u.spec);
    const of = officeOf(u.spec);
    const ground = (u.w * u.d) / 1e6;
    const mz = m.enabled ? m.areaM2 : 0;
    const office = of.areaM2 + (m.enabled && m.use === 'office' ? m.areaM2 : 0);
    const ds = doorSize(u.spec.doors);
    const doors = `${u.spec.doors.count === 2 ? '2 x ' : ''}${(ds.w / 1000).toFixed(1)} x ${(ds.h / 1000).toFixed(1)}`;
    return { n: u.n, row: model.c.rows.findIndex((r) => r.id === u.rowId) + 1, size: `${(u.w / 1000).toFixed(1)} x ${(u.d / 1000).toFixed(1)}`, ground, mz, total: ground + mz, office, doors, count: u.spec.doors.count === 2 ? 2 : 1, ds };
  });
  return rows;
}


/** The feasibility section of C103: same figures and wording as the editor panel. Returns the y after it. */
export function drawFeasibility(doc, model, x, y, w) {
  const f = feasibility(model.c, model.lot);
  y = sectionTitle(doc, 'INDICATIVE YIELD AND VALUE', x, y, w);
  setText(doc, 6.4, true);
  for (const ln of wrap(doc, clean(CAVEAT), w)) { doc.text(ln, x, y); y += 2.9; } // wrapped to the column so it never runs into the schedules beside it
  y += 1.2;
  setText(doc, 6.2, false, [90, 94, 102]);
  for (const ln of wrap(doc, clean(`Area: ${f.areaLabel}, ${f.areaState}${f.areaKey !== f.detectedKey ? ' (chosen)' : f.detectedVia === 'default' ? ' (state default)' : ' (from the lot)'}. ${Object.values(f.inputs).some((i) => i?.status === 'PORTAL') ? `Portal data as at ${f.dataDate}, market data as at ${f.marketDate}.` : `Market data as at ${f.marketDate}.`} ${GST_NOTE}`), w)) { doc.text(ln, x, y); y += 2.9; }
  y += 1.5;
  if (f.mid.yieldOk === false) { setText(doc, 6.2, true, [160, 30, 30]); doc.text('Enter a yield to see the end value and the margin if the units are held and leased.', x, y); y += 4; }
  const cols = [{ w: 62 }, { w: 46, align: 'right' }, { w: w - 108, align: 'right' }];
  y = table(doc, x, y, cols, ['ITEM', 'AT THE VALUES IN USE', 'LOW TO HIGH'], summaryRows(f).map(([k, v, b]) => [k, v, b]), { rh: 4.1, size: 6.4 });
  y += 1.5;
  const i = f.inputs;
  const ev = f.defaults.inputs.saleRate.evidence;
  const items = [
    `Sale rate ${money(i.saleRate.value)} per m² GFA, rent ${money(i.rentRate.value)} per m² per year, net yield ${i.yieldPct.value}%. Status: ${i.saleRate.chip}; ${i.rentRate.chip}; yield ${i.yieldPct.chip.toLowerCase()}.${ev.askMedPsm || ev.soldMedPsm ? ` Portal asking median ${ev.askMedPsm ? money(ev.askMedPsm) : 'none'} (n ${ev.askN}), sold median ${ev.soldMedPsm ? money(ev.soldMedPsm) : 'none'} (n ${ev.soldN}).` : ''}`,
    `Cost basis: ${costRows(f).slice(0, 6).map(([k, v]) => `${k.replace(/ \(.*$/, '').toLowerCase()} ${v}`).join(', ')}. Build, site works, fees, contingency and land rates are estimates from published ranges.`,
    `${RENT_NOTE} Developed area ${m2f(f.devM2)} m² (building footprint plus hardstand) at the site works rate, rest of the lot ${m2f(f.restM2)} m² at the clearing and landscaping rate; driveways are not modelled. Low to high uses the ends of the published ranges: low revenue with high cost, and high revenue with low cost.`,
    SOURCES_TEXT,
  ];
  y = paragraphs(doc, x, y, w, items, { size: 5.9, lead: 2.7 });
  return y + 1;
}

export function drawYield(doc, model) {
  const { c, lot, stats, a, rules } = model;
  const rows = unitScheduleRows(model);
  const bsch = buildingScheduleRows(c);
  const cap = 62;
  const shown = rows.slice(0, cap);
  const tot = rows.reduce((s, r) => ({ ground: s.ground + r.ground, mz: s.mz + r.mz, total: s.total + r.total, office: s.office + r.office }), { ground: 0, mz: 0, total: 0, office: 0 });
  const big = shown.length <= 24;
  const rh = shown.length > 34 ? 3.3 : big ? 4.8 : 4.1;
  const fs = shown.length > 34 ? 5.8 : big ? 7.4 : 6.6;
  let yL = 20;
  if (rows.length || !bsch.rows.length) yL = sectionTitle(doc, 'UNIT SCHEDULE (AREAS IN m²)', X0, yL, 162);
  const cols = [{ w: 30 }, { w: 9, align: 'right' }, { w: 22 }, { w: 18, align: 'right' }, { w: 17, align: 'right' }, { w: 17, align: 'right' }, { w: 17, align: 'right' }, { w: 32 }];
  const body = shown.map((r) => [`PROPOSED UNIT ${r.n}`, String(r.row), r.size, r.ground.toFixed(1), r.mz ? r.mz.toFixed(1) : '0.0', r.total.toFixed(1), r.office.toFixed(1), r.doors]);
  body.push([`TOTAL, ${rows.length} UNITS`, '', '', tot.ground.toFixed(1), tot.mz.toFixed(1), tot.total.toFixed(1), tot.office.toFixed(1), '']);
  if (rows.length) yL = table(doc, X0, yL, cols, ['UNIT', 'ROW', 'SIZE (m)', 'GROUND', 'MEZZ.', 'TOTAL', 'OFFICE', 'ROLLER DOOR (m)'], body, { rh, size: fs, boldLast: true });
  if (bsch.rows.length) {
    yL += rows.length ? 3 : 0;
    yL = sectionTitle(doc, 'BUILDING SCHEDULE, GFA BY USE (AREAS IN m²)', X0, yL, 162);
    const bcols = [{ w: 44 }, { w: 22 }, { w: 16, align: 'right' }, { w: 14, align: 'right' }, { w: 16, align: 'right' }, { w: 50 }];
    const bbody = bsch.rows.map((r) => [r.name, r.size, r.ground.toFixed(1), r.upper ? r.upper.toFixed(1) : '0.0', r.total.toFixed(1), r.text || 'n/a']);
    bbody.push([`TOTAL, ${bsch.rows.length} BUILDING${bsch.rows.length === 1 ? '' : 'S'}`, '', bsch.tot.ground.toFixed(1), bsch.tot.upper.toFixed(1), bsch.tot.total.toFixed(1), '']);
    yL = table(doc, X0, yL, bcols, ['BUILDING', 'SIZE (m)', 'GROUND', 'UPPER', 'TOTAL', 'GFA BY USE'], bbody, { rh: 4.4, size: 6.6, boldLast: true });
    const ex = bsch.rows.flatMap((r) => r.extras.map((t) => `B${r.n}: ${t}`));
    if (ex.length) { setText(doc, 5.8, false, [90, 94, 102]); doc.text(ex.join('   '), X0, yL + 1); yL += 4; }
  }
  if (rows.length > shown.length) { setText(doc, 6, false, [90, 94, 102]); doc.text(`and ${rows.length - shown.length} more units, same type as above`, X0, yL); yL += 4; }
  setText(doc, 5.8, false, [90, 94, 102]);
  doc.text('Ground area is to the outside of the walls. OFFICE is the ground floor office or amenity plus any mezzanine office.', X0, yL);
  yL += 6;
  yL = drawFeasibility(doc, model, X0, yL, 162);

  // Right column: site summary.
  const XR = X0 + 172;
  const WR = X1 - XR;
  let yR = 20;
  yR = sectionTitle(doc, 'SITE SUMMARY', XR, yR, WR);
  const par = stats.parking;
  const rateSource = c.rates?.source || 'Not stated';
  const rateStatus = facts('parkingUnits').status;
  const zoneTxt = lot.zoning ? [lot.zoning.code, lot.zoning.name].filter(Boolean).join(' ') : 'Not known';
  const accCls = { class_5: 'Class 5', class_6: 'Class 6', class_7: 'Class 7', class_8: 'Class 8' }[c.buildingClass] || 'Class 8';
  const landMin = rules.landscapeMinPct;
  const summary = [
    ['Lot area', `${m2f(stats.lotM2 ?? 0)} m²`],
    ['Zone', `${zoneTxt}${lot.lga ? `, ${lot.lga}` : ''}`],
    ...(stats.units ? [['Units', `${stats.units} (${stats.mix.map((x) => `${x.count} x ${x.label}`).join(', ')})`]] : []),
    ...(stats.buildingCount ? [['Buildings', `${stats.buildingCount} (${(stats.buildings || []).map((b) => b.label).join(', ')})`]] : []),
    ['Ground floor area', `${m2f(stats.groundGfaM2)} m²`],
    ['Mezzanine area', `${m2f(stats.mezzGfaM2)} m²`],
    ['GFA (ground plus mezzanine)', `${m2f(stats.gfaM2)} m²`],
    ['Site coverage', stats.coveragePct != null ? `${stats.coveragePct} % of the lot (${rules.custom ? 'maximum set by you' : 'indicative maximum'} ${rules.coverageMaxPct} %${rules.custom ? '' : ', check with council'})` : 'n/a'],
    ['Landscaping (not built or paved, excluding the OSD placeholder)', model.land.pct != null ? `${model.land.pct} % of the lot, about ${m2f(model.land.areaM2)} m² (${rules.custom ? 'minimum set by you' : 'indicative minimum'} ${landMin} %${rules.custom ? '' : ', check with council'})` : 'n/a'],
    ['Parking required', stats.buildingCount ? `${par.required} ${par.required === 1 ? 'bay' : 'bays'}: ${stats.units ? `${par.required - par.buildingRequired} for the strata units plus ` : ''}${par.buildingRequired} for the ${stats.buildingCount === 1 ? 'building' : 'buildings'} at the rates per use shown on the building schedule, each rounded up once, check with council` : par.officeSplit
      ? `${par.required} ${par.required === 1 ? 'bay' : 'bays'}: workshop and other ${m2f(par.split.otherM2)} m² at 1 per ${Math.round(1 / par.ratePerM2)} m² (${par.split.otherSpaces.toFixed(2)}) plus office ${m2f(par.split.officeM2)} m² at 1 per ${Math.round(1 / par.officeRatePerM2)} m² (${par.split.officeSpaces.toFixed(2)}), rounded up once`
      : `${par.required} ${par.required === 1 ? 'bay' : 'bays'} at 1 per ${Math.round(1 / par.ratePerM2)} m² of GFA, rounded up`],
    ['Rate source', `${rateSource}. Indicative, check with council.`],
    ['Bays provided', `${par.provided} (${par.accessible.provided} accessible), ${par.provided >= par.required ? 'at or above' : 'below'} the ${par.required} indicated`],
    ['Accessible bays', `${par.accessible.required} indicated for ${accCls} (NCC D4D6), ${par.accessible.provided} provided, each with a ${m1(ACCESSIBLE_BAY.sharedZoneMm)} m shared zone and a central bollard`],
    ['Truck apron and car aisle', stats.buildingCount && !stats.units ? bsch.rows.map((r) => `B${r.n} ${m1(buildingsOf(c)[r.n - 1].site?.vehicles?.apronDepthMm || 0)} m`).join(', ') + ` apron from the front edge, car aisle ${m1(c.parking.aisleMm)} m` : `${m1(model.off)} m clear from the roller doors to the bays, car aisle ${m1(c.parking.aisleMm)} m`],
    ...(a.schedule.total > 0 ? [['Bollards (indicative)', `${a.schedule.total}`]] : []),
  ];
  yR = kvTable(doc, XR, yR, WR, summary, { size: big ? 7 : 6.4, split: 0.36 });
  yR += 2;

  // Roller door schedule.
  yR = sectionTitle(doc, 'ROLLER DOOR SCHEDULE', XR, yR, WR);
  const door = new Map();
  for (const r of rows) {
    const key = `${(r.ds.w / 1000).toFixed(1)} x ${(r.ds.h / 1000).toFixed(1)} m`;
    const e = door.get(key) || { n: 0, units: new Set() };
    e.n += r.count;
    e.units.add(r.n);
    door.set(key, e);
  }
  const dr = [...door].map(([k, e]) => [k, String(e.n), `${e.units.size} ${e.units.size === 1 ? 'unit' : 'units'}`]);
  for (const b of buildingsOf(c)) { const n = (b.q.doors?.roller || 0) + (b.q.doors?.dock || 0); if (n > 0) dr.push([`B${b.n} roller and dock doors`, String(n), b.label]); }
  dr.push(['Total', String(dr.reduce((s, r) => s + Number(r[1]), 0)), [rows.length ? `${rows.length} ${rows.length === 1 ? 'unit' : 'units'}` : null, c.buildings?.length ? `${c.buildings.length} ${c.buildings.length === 1 ? 'building' : 'buildings'}` : null].filter(Boolean).join(', ')]);
  yR = table(doc, XR, yR, [{ w: 36 }, { w: 14, align: 'right' }, { w: WR - 50 }], ['DOOR (W x H)', 'COUNT', 'SERVES'], dr, { rh: 4, size: 6.4, boldLast: true });
  yR += 2;
  if (a.schedule.total > 0) {
    yR = sectionTitle(doc, 'BOLLARD SCHEDULE (INDICATIVE)', XR, yR, WR);
    const bs = a.schedule.byKind.map((r) => [r.label, String(r.count)]);
    bs.push(['Total', String(a.schedule.total)]);
    yR = table(doc, XR, yR, [{ w: WR - 20 }, { w: 20, align: 'right' }], ['KIND', 'COUNT'], bs, { rh: 4, size: 6.4, boldLast: true });
    yR += 2;
  }

  // Notes: one customer facing line. The value status detail (unverified and secondary source values) is shown in the details panel on screen,
  // never on the plan set.
  const notes = [
    ...(zoneMismatch(lot) ? [RESIDENTIAL_NOTE] : []),
    'Indicative only. Rates and controls to be confirmed with council and a suitably qualified engineer.',
    'Every figure here is a concept value and not an approval or a design.',
    ...(a.schedule.total > 0 ? ['Bollard locations are indicative and to be confirmed in design.'] : []),
    'Landscaping is the lot area that is neither built nor paved. The OSD basin is a placeholder at the assumed low point and carries no size.',
    'The site access and crossover are indicative. Swept paths, stormwater design and services are not part of this set.',
  ];
  const blockH = (items, w, size = 6.2, lead = 2.85) => { setText(doc, size, false); return items.reduce((s2, t) => s2 + wrap(doc, t, w - 3).length * lead + 0.7, 0) + 10; };
  const leftRoom = 280 - yL;
  const rightRoom = 280 - yR;
  const useLeft = leftRoom >= blockH(notes, 162) || leftRoom >= rightRoom;
  const x = useLeft ? X0 : XR;
  let y = useLeft ? yL : yR;
  const w = useLeft ? 162 : WR;
  if (y + blockH(notes, w) < 281) { y = sectionTitle(doc, 'NOTES', x, y, w); y = paragraphs(doc, x, y, w, notes); y += 1; }
  void y;
  void zoneClass;

  const kv = [
    ['GFA incl. mezzanine', `${m2f(stats.gfaM2)} m²`],
    ...(stats.units ? [['Units', String(stats.units)]] : []),
    ['Site coverage', stats.coveragePct != null ? `${stats.coveragePct} %` : 'n/a'],
    ['Landscaping', model.land.pct != null ? `${model.land.pct} %` : 'n/a'],
    ['Bays, shown / required', `${par.provided} / ${par.required}`],
  ];
  return { scale: 'NTS', kv, notes: ['Indicative only. Rates and controls to be confirmed with council and a suitably qualified engineer.'], blocks: [] };
}

// C000 cover pieces ---------------------------------------------------------------------------------------------------------
/** The layout thumbnail for the cover: the units, bays and aprons at a small scale. */
export function coverThumbnail(model) {
  return {
    title: 'PROPOSED LAYOUT (OUTLINE)',
    draw(doc, rect) {
      const { units, a, c } = model;
      const bldgs = buildingsOf(c);
      const pts = [...units.flatMap((u) => u.poly), ...bldgs.flatMap((b) => [b.outline, ...b.extras.map((e) => e.polygon)].flat()), ...a.parking.rows.flatMap((pr) => pr.slots.flatMap((s) => s.poly))];
      if (!pts.length) return;
      const bb = G.bbox(pts);
      const bw = rect.x1 - rect.x0 - 10;
      const bh = rect.y1 - rect.y0 - 26;
      const ds = [...SITE_SCALES, ...SCALES_BEYOND].find((n) => bb.w / n <= bw && bb.h / n <= bh) || 10000;
      const ox = rect.x0 + (rect.x1 - rect.x0 - bb.w / ds) / 2;
      const oy = rect.y0 + 8 + (bh - bb.h / ds) / 2;
      const T = (p) => ({ x: ox + (p.x - bb.minX) / ds, y: oy + (p.y - bb.minY) / ds });
      for (const pr of a.parking.rows) for (const sl of pr.slots) {
        doc.setFillColor(...(sl.kind === 'bay' ? [244, 244, 246] : [196, 214, 244]));
        doc.setDrawColor(...GREYLINE);
        doc.setLineWidth(0.08);
        polygon(doc, sl.poly.map(T), 'FD');
      }
      for (const u of units) {
        doc.setFillColor(...UNIT_FILL);
        doc.setDrawColor(...PEN.ink);
        doc.setLineWidth(0.18);
        polygon(doc, u.poly.map(T), 'FD');
      }
      for (const b of bldgs) {
        for (const e of b.extras) { doc.setFillColor(236, 238, 242); doc.setDrawColor(...GREYLINE); doc.setLineWidth(0.1); polygon(doc, e.polygon.map(T), 'FD'); }
        doc.setFillColor(...UNIT_FILL); doc.setDrawColor(...PEN.ink); doc.setLineWidth(0.18); polygon(doc, b.outline.map(T), 'FD');
      }
      const s = model.stats;
      setText(doc, 7, false);
      [...(s.units ? [`${s.units} ${s.units === 1 ? 'unit' : 'units'}`] : []), `GFA ${m2f(s.gfaM2)} m²`, `Coverage ${s.coveragePct ?? 'n/a'} %`, `${s.parking.provided} ${s.parking.provided === 1 ? 'bay' : 'bays'}`].forEach((t, i) => doc.text(clean(t), rect.x0 + 4 + i * 28, rect.y1 - 4));
      setText(doc, 6, false, [90, 94, 102]);
      doc.text(`Outline at 1:${ds} @ A3`, rect.x1 - 4, rect.y0 + 5.5, { align: 'right' });
    },
  };
}

export const COMMERCIAL_STRIP = Object.freeze({
  cover: { subtitle: 'Commercial site layout', notes: ['Concept only, for discussion.', 'Boundaries are from the cadastre and are not a survey.'] },
});

// Development feasibility page (commercial C105, residential F100) ----------------------------------------------------------
const fmtM = (v) => `${v < 0 ? '-' : ''}$${Math.round(Math.abs(v)).toLocaleString('en-AU')}`;
const fmtP = (v) => `${(Math.round(v * 10) / 10).toFixed(1)}%`;
/**
 * The feasibility page: headline figures, the cost breakdown, every assumption with its value, status, as-at date and source, the price against
 * cost sensitivity grid, saved scenarios side by side, and the notes. Same figures as the Check it panel (src/finance). Returns { kv, notes, blocks }.
 */
export function drawFinancePage(doc, project) {
  const c = financeCompute(project);
  let y = 20;
  const r = c.result;
  y = sectionTitle(doc, 'INDICATIVE DEVELOPMENT FEASIBILITY', X0, y, X1 - X0);
  setText(doc, 6.4, true);
  for (const ln of wrap(doc, clean(FIN_DISCLAIMER), X1 - X0)) { doc.text(ln, X0, y); y += 2.9; }
  y += 1;
  if (!r) {
    setText(doc, 7, false);
    doc.text(clean(c.notes[0] || 'No figures could be worked out for this design.'), X0, y + 4);
    return { kv: [], notes: ['Indicative only.'], blocks: [] };
  }
  const W1 = 104; const W2 = 118; const XA = X0 + W1 + 6; const XB = XA + W2 + 6; const W3 = X1 - XB;
  const hold = r.mode === 'hold';
  // Left: headline and breakdown
  let yl = y + 1;
  yl = sectionTitle(doc, hold ? 'RESULT, HOLD AND LEASE' : 'RESULT, SELL', X0, yl, W1);
  yl = table(doc, X0, yl, [{ w: 62 }, { w: W1 - 62, align: 'right' }], ['MEASURE', 'AT THE VALUES IN USE'], [
    ['Indicative profit', fmtM(r.profit)], ['Margin on cost', fmtP(r.marginOnCostPct)], ['Margin on value (GDV)', fmtP(r.marginOnGdvPct)], ['Development yield on cost', fmtP(r.yieldOnCostPct)],
    [`Residual land value at ${fmtP(r.residual.targetPct)} margin`, r.residual.viable ? fmtM(r.residual.value) : 'Nil, target not reached'],
    ['Peak debt (incl. capitalised interest)', fmtM(r.peakDebt)], ['Equity needed', fmtM(r.peakEquity)], [hold ? 'End value by capitalisation' : 'Net revenue (GDV after GST option)', fmtM(r.revenue)],
  ], { rh: 4.1, size: 6.6 });
  yl += 2;
  yl = sectionTitle(doc, 'COST BREAKDOWN', X0, yl, W1);
  const L = (k, v) => (Math.abs(v) < 0.5 ? null : [k, fmtM(v), r.totalCost > 0 ? fmtP((v / r.totalCost) * 100) : '']);
  const rows = [L('Land', r.land), L(`Transfer duty (${r.state})`, r.duty), L('Legal and acquisition', r.acquisition), L('Design and professional fees', r.professional), L('Approvals and DA fees', r.approvals),
    L('Council and infrastructure contributions', r.contributions), L('Building', r.build), L('Site works', r.siteWorks), L('Earthworks', r.earthworks), L('Clearing and landscaping', r.landscape), L('Contingency', r.contingency),
    L('Holding costs (rates, insurance)', r.holding), L('Loan establishment fee', r.fee), L(`Capitalised interest (${r.months} months)`, r.interest), L(hold ? 'Leasing costs' : 'Selling costs', r.selling)].filter(Boolean);
  rows.push(['TOTAL COST', fmtM(r.totalCost), '100.0%']);
  yl = table(doc, X0, yl, [{ w: 62 }, { w: 22, align: 'right' }, { w: W1 - 84, align: 'right' }], ['ITEM', 'AMOUNT', '% OF COST'], rows, { rh: 4.1, size: 6.6, boldLast: true });
  yl += 2;
  if (r.gstMode !== 'none' && r.gstPayable) { setText(doc, 6.2, false); doc.text(clean(`GST ${r.gstMode === 'margin' ? 'on the margin scheme' : 'in full'}: ${fmtM(r.gstPayable)} payable on the sale. Indicative.`), X0, yl); yl += 4; }
  // Middle: assumptions
  let ym = y + 1;
  ym = sectionTitle(doc, 'ASSUMPTIONS (EVERY VALUE EDITABLE IN THE TOOL)', XA, ym, W2);
  const STAT = { VERIFIED_REPORT: 'Report', VERIFIED_SECONDARY: 'Report (2nd)', VERIFIED_LISTING: 'Listing', ESTIMATE: 'Estimate' };
  const ab = c.model.descs.map((d) => {
    const val = d.kind === 'select' ? (d.options.find(([v]) => v === d.value)?.[1] || d.value) : Number(d.value).toLocaleString('en-AU', { maximumFractionDigits: 2 });
    const u = d.kind === 'select' ? '' : String(d.unit || '');
    const shown = !u ? val : u === '$' ? `$${val}` : /^\$/.test(u) ? `$${val} ${u.slice(1).trim().replace(/^\//, 'per ')}` : `${val} ${u}`;
    return [d.label.replace(/ \(.*$/, ''), shown, d.edited ? 'Edited' : STAT[d.status] || d.status, d.asAt];
  });
  ym = table(doc, XA, ym, [{ w: 44 }, { w: 40, align: 'right' }, { w: 18 }, { w: W2 - 102 }], ['ASSUMPTION', 'VALUE', 'STATUS', 'AS AT'], ab, { rh: 3.55, size: 5.7 });
  // Right: sensitivity, scenarios, sources
  let yr = y + 1;
  yr = sectionTitle(doc, 'SENSITIVITY, MARGIN ON COST', XB, yr, W3);
  const g = r.sensitivity;
  const cw = (W3 - 24) / 3;
  yr = table(doc, XB, yr, [{ w: 24 }, ...g.steps.map(() => ({ w: cw, align: 'right' }))], ['PRICE / COST', ...g.steps.map((k) => `${k > 0 ? '+' : ''}${k}%`)], g.cells.map((row, i) => [`${g.steps[i] > 0 ? '+' : ''}${g.steps[i]}%`, ...row.map((x) => fmtP(x.margin))]), { rh: 4.1, size: 6.6 });
  yr += 2;
  const cols = financeCompare(project);
  if (cols.length > 1) {
    yr = sectionTitle(doc, 'SAVED SCENARIOS', XB, yr, W3);
    const sw = (W3 - 26) / (cols.length);
    const pick = (k) => FIN_COMPARE_ROWS.find((x) => x[0] === k);
    const rws = ['profit', 'marginOnCostPct', 'residual', 'peakDebt'].map((k) => { const [, lab, get, kind] = pick(k); return [lab, ...cols.map((x) => (x.result ? (kind === 'money' ? fmtM(get(x.result)) : fmtP(get(x.result))) : 'n/a'))]; });
    yr = table(doc, XB, yr, [{ w: 26 }, ...cols.map(() => ({ w: sw, align: 'right' }))], ['', ...cols.map((x) => x.name)], rws, { rh: 4.1, size: 6.2 });
    yr += 2;
  }
  yr = sectionTitle(doc, 'NOTES AND SOURCES', XB, yr, W3);
  const seen = new Set(); const srcs = [];
  for (const d of c.model.descs) { if (d.source && !seen.has(d.source) && /https?:/.test(d.source)) { seen.add(d.source); srcs.push(`${d.label}: ${d.asAt}. ${d.source}`); } }
  const duty = FIN_DATA.duty[c.model.state];
  srcs.push(`Transfer duty: ${duty.name}, as at ${duty.asAt}. ${duty.source}. ${duty.note}`);
  const items = [
    `Programme ${r.programme.pre} months approvals, ${r.programme.build} months construction, ${r.programme.tail} months ${hold ? 'lease up' : 'sell down'}. Loan to cost ${fmtP(c.model.input.a.lcrPct)} at ${fmtP(c.model.input.a.ratePct)} a year, drawn on an S-curve after equity, interest capitalised.`,
    ...c.notes, ...srcs,
    'Figures marked Estimate are analyst allowances, not quotes. Values come from the Check it panel and can be edited there.',
  ];
  yr = paragraphs(doc, XB, yr, W3, items, { size: 5.7, lead: 2.6 });
  void yl; void ym; void yr;
  return { kv: [['Profit', fmtM(r.profit)], ['Margin on cost', fmtP(r.marginOnCostPct)], ['Residual land value', r.residual.viable ? fmtM(r.residual.value) : 'Nil'], ['Peak debt', fmtM(r.peakDebt)]], notes: ['Indicative only, not a valuation or advice.', 'Check with a quantity surveyor, valuer and your accountant.'], blocks: [] };
}
