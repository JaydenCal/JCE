// Fixtures for the plan set tests and tools/planset-matrix.mjs: commercial and residential projects with a chosen terrain case, plus a
// recording jsPDF (text, line and path calls per page) so tests can check what a sheet drew without comparing pixels.
// Only generic designs are used (no builder houses, no brand names).
import { jsPDF } from 'jspdf';
import { createStore } from '../../src/model/store.js';
import { createProject } from '../../src/model/schema.js';
import { catalogue } from '../../src/catalogue/index.js';
import { placeHouse } from '../../src/portal/place-house.js';
import { lotEnvelope, portalLotToSiteLot, SAMPLE_LOT } from '../../src/portal/envelope.js';
import { autoPose } from '../../src/portal/auto-place.js';
import { applyBuildingChoice } from '../../src/commercial/catalogue/ops.js';
import { chooseBuilding } from '../../src/commercial/catalogue/fit.js';
import { commercialProject } from './commercial-fixture.mjs';

/** Terrain cases: the total fall (m) across the lot depth. `none` has no ground data at all. Gentle undulation only, so contours read as a DEM would. */
export const TERRAIN_CASES = Object.freeze({
  none: null,
  flat: { fall: 0.6, cross: 0.004, bump: 0.04 },
  mid: { fall: 3, cross: 0.01, bump: 0.12 },
  steep: { fall: 9, cross: 0.03, bump: 0.3 },
});

/** The lot elevation grid (metres RL) over the lot plus a margin, in the shape the site model stores (plan mm, row 0 at the north edge). */
export function withTerrain(p, { w, d, fall = 3, cross = 0.01, bump = 0.1, cellMm = 2000, base = 100, margin = 60000 } = {}) {
  const x0 = -margin;
  const y0 = -margin;
  const cols = Math.ceil((w + 2 * margin) / cellMm) + 1;
  const rows = Math.ceil((d + 2 * margin) / cellMm) + 1;
  const values = [];
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const x = (x0 + i * cellMm) / 1000;
      const y = (y0 + j * cellMm) / 1000;
      values.push(Math.round((base + (fall / (d / 1000)) * y + cross * x + bump * Math.sin(x * 0.045) * Math.cos(y * 0.035)) * 100) / 100);
    }
  }
  p.site.lot.terrain = { cols, rows, cellMm, x0, y0, values };
  return p;
}

/** A commercial project on a 60 m by 100 m lot (rows 'pair' for the strata pair, a catalogue type id otherwise) with a terrain case. */
export function commercialCase(type = 'warehouse', terrain = 'mid', { width = 60000, depth = 100000 } = {}) {
  let p;
  if (type === 'strata') p = commercialProject({ plain: false, width, depth });
  else {
    p = commercialProject({ width, depth, rows: 'none' });
    const s = createStore(p, { autosaveKey: null });
    applyBuildingChoice(s, chooseBuilding(s.project, type));
    p = s.project;
  }
  const t = TERRAIN_CASES[terrain];
  if (t) withTerrain(p, { w: width, d: depth, ...t });
  return p;
}

/** A residential project (generic double storey template) on the sample portal lot scaled to a 20 m by 45 m block, with a terrain case. */
export function residentialCase(terrain = 'mid', { width = 20000, depth = 45000 } = {}) {
  const portal = {
    name: 'Sample lot',
    polygonMm: [{ x: 0, y: 0 }, { x: width, y: 0 }, { x: width, y: depth }, { x: 0, y: depth }],
    frontEdgeIndices: [2],
    picked: SAMPLE_LOT.picked,
    lot: '7',
    dp: 'DP 99',
  };
  const p = createProject({ name: 'Sample home' });
  p.site.lot = portalLotToSiteLot(portal, lotEnvelope(portal));
  const h = catalogue.createFromTemplate('house_double');
  placeHouse(p, h, autoPose(p, h).pose);
  const t = TERRAIN_CASES[terrain];
  if (t) withTerrain(p, { w: width, d: depth, ...t, fall: t.fall * (depth / 100000) * 2.2, cellMm: 2000 });
  return p;
}

/**
 * A jsPDF subclass that records every text, line and path call per page: { texts: [{ s, x, y, size, angle, align }],
 * lines: [{ x1, y1, x2, y2, colour, width, dash }] }. Paths drawn with doc.lines() are recorded as their segments.
 */
export function recordingPDF() {
  const pages = [];
  const cur = () => {
    const n = ref.doc?.internal.getCurrentPageInfo().pageNumber || 1;
    while (pages.length < n) pages.push({ texts: [], lines: [], images: [] });
    return pages[n - 1];
  };
  const ref = { doc: null };
  class Rec extends jsPDF {
    constructor(...a) {
      super(...a);
      ref.doc = this;
      let size = 10;
      let colour = [0, 0, 0];
      let width = 0.2;
      let dash = [];
      const wrap = (name, fn) => { const o = this[name].bind(this); this[name] = (...args) => { fn(...args); return o(...args); }; };
      wrap('setFontSize', (n) => { size = n; });
      wrap('setDrawColor', (...c) => { colour = c.length === 1 && Array.isArray(c[0]) ? c[0] : c; });
      wrap('setLineWidth', (w) => { width = w; });
      wrap('setLineDashPattern', (d) => { dash = d || []; });
      wrap('addImage', (...a) => { const o = a[0] && typeof a[0] === 'object' && !(typeof a[0] === 'string') && !a[0].length ? a[0] : null; cur().images.push(o ? { x: o.x, y: o.y, w: o.w, h: o.h } : { x: a[2], y: a[3], w: a[4], h: a[5] }); });
      wrap('text', (t, x, y, o = {}) => { cur().texts.push({ s: Array.isArray(t) ? t.join(' ') : String(t), x, y, size, angle: o.angle || 0, align: o.align || 'left' }); });
      wrap('line', (x1, y1, x2, y2) => { cur().lines.push({ x1, y1, x2, y2, colour: [...colour], width, dash: [...dash] }); });
      wrap('lines', (segs, x, y, scale = [1, 1], style) => {
        if (style && style !== 'S') return;
        let cx = x;
        let cy = y;
        for (const sg of segs) {
          if (sg.length !== 2) return;
          const nx = cx + sg[0] * scale[0];
          const ny = cy + sg[1] * scale[1];
          cur().lines.push({ x1: cx, y1: cy, x2: nx, y2: ny, colour: [...colour], width, dash: [...dash] });
          cx = nx;
          cy = ny;
        }
      });
    }
  }
  return { Rec, pages, texts: () => pages.flatMap((p) => p.texts.map((t) => t.s)) };
}

// Contour strokes on a recorded page ---------------------------------------------------------------------------------------------------
import { contourPen } from '../../src/premium/exporters/planset/contours.js';

const PENS = [false, true].flatMap((design) => [false, true].flatMap((major) => [false, true].map((light) => contourPen({ design, major, light }))));
const same = (a, b) => a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) < 1e-6);
/** True when a recorded line was drawn with one of the contour pens (colour, width and dash all match). */
export const isContourLine = (l) => PENS.some((p) => same(p.colour, l.colour) && Math.abs(p.width - l.width) < 1e-6 && same(p.dash, l.dash));
/** The contour polylines of a recorded page: consecutive segments of one pen that join end to end are one polyline. */
export function contourChains(page) {
  const chains = [];
  let cur = null;
  for (const l of page.lines) {
    if (!isContourLine(l)) { cur = null; continue; }
    if (cur && Math.abs(cur.at(-1).x - l.x1) < 1e-4 && Math.abs(cur.at(-1).y - l.y1) < 1e-4) cur.push({ x: l.x2, y: l.y2 });
    else { cur = [{ x: l.x1, y: l.y1 }, { x: l.x2, y: l.y2 }]; chains.push(cur); }
  }
  return chains;
}
/** RL labels on a recorded page: "103.25", "103.2", "103.0". */
export const rlLabels = (page) => page.texts.filter((t) => /^\d{2,4}\.\d{1,2}$/.test(t.s));
