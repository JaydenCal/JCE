// Drawing set helpers shared by the PDF and DXF exporters: paper sizes, scale choice, scale bar geometry and title block
// values. Pure functions, Node compatible. No company or product branding is ever produced here: every title block field
// comes from project.titleBlock and an empty field stays empty.

import * as G from '../../model/geometry.js';
import { ascii, levelsSorted, wallShapes, outlineBox, dimensionsFor, furnitureSize, furnitureCorners, stairGeometry } from './shared.js';

/** Standard scales (1:n). 'auto' walks this list from the smallest scale upwards. */
export const SCALE_LIST = [20, 50, 100, 200, 500, 1000, 2000];

/** Papers. Drawings are laid out on an A3 "design sheet" (420 by 297) and multiplied by k for A1 (k = 2). */
export const PAPERS = {
  A3: { name: 'A3', k: 1, format: 'a3', w: 420, h: 297 },
  A1: { name: 'A1', k: 2, format: 'a1', w: 840, h: 594 },
};
export const paperOf = (p) => PAPERS[String(p || '').toUpperCase()] || PAPERS.A3;

/** Drawing area on the design sheet (design millimetres). The scale bar and north arrow sit in the strip below it. */
export const AREA = { x: 20, y: 20, w: 380, h: 194 };

export const ddmmyyyy = (d = new Date()) => {
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`;
};

/** Plan content of one level: wall shapes, dimension strings and the bounding box that has to fit the sheet. */
export function levelContent(project, level, withSite, catalogue) {
  const shapes = wallShapes(level);
  const dims = dimensionsFor(level, shapes);
  const pts = [];
  const outline = outlineBox(level, shapes);
  if (outline) pts.push({ x: outline.minX, y: outline.minY }, { x: outline.maxX, y: outline.maxY });
  for (const r of level.rooms) pts.push(...r.polygon);
  for (const d of dims) {
    pts.push(d.a, d.b, { x: d.textAt.x - 250, y: d.textAt.y - 200 }, { x: d.textAt.x + 250, y: d.textAt.y + 200 });
  }
  for (const f of level.furniture) pts.push(...furnitureCorners(f, furnitureSize(catalogue, f)));
  for (const s of level.stairs) pts.push(...stairGeometry(s).corners);
  if (withSite) for (const t of project.site?.tanks || []) pts.push({ x: t.x - t.diameter / 2, y: t.y - t.diameter / 2 }, { x: t.x + t.diameter / 2, y: t.y + t.diameter / 2 });
  const box = pts.length ? G.bbox(pts) : { minX: 0, minY: 0, maxX: 10000, maxY: 8000, w: 10000, h: 8000 };
  return { level, shapes, dims, box };
}

/**
 * Choose the plan scale. `requested` is project.drawing.scale: 'auto' or a number n meaning 1:n.
 * Returns { scale, requested, fallback, note }. A requested scale that does not fit the paper falls back to the next
 * standard scale that does, and `note` says so in plain words.
 */
export function chooseScale(contents, requested, paper = 'A3') {
  const p = paperOf(paper);
  const fits = (n) => contents.every((c) => c.box.w / (n * p.k) <= AREA.w && c.box.h / (n * p.k) <= AREA.h);
  const next = (from) => {
    const hit = SCALE_LIST.find((n) => n > from && fits(n));
    if (hit) return hit;
    let n = SCALE_LIST.at(-1) * 2;
    while (!fits(n) && n < 1e7) n *= 2;
    return n;
  };
  const want = Number(requested);
  if (Number.isFinite(want) && want > 0 && requested !== 'auto') {
    if (fits(want)) return { scale: want, requested: want, fallback: false, note: '' };
    const used = next(want);
    return { scale: used, requested: want, fallback: true, note: `1:${want} does not fit on ${p.name}. Drawn at 1:${used}.` };
  }
  const auto = SCALE_LIST.find(fits) || next(SCALE_LIST.at(-1));
  return { scale: auto, requested: 'auto', fallback: false, note: '' };
}

// Scale bar ---------------------------------------------------------------------------
// total metres, number of equal segments. The bar is the shortest of these that measures at least 50 mm on paper.
const BARS = [[1, 4], [2, 4], [5, 5], [10, 5], [20, 4], [50, 5], [100, 5], [200, 4], [500, 5], [1000, 5]];
export const BAR_MIN_PAPER_MM = 50;

/** Scale bar for a printed scale 1:scale. paperMm is the length on paper (5 m at 1:100 is 50 mm, at 1:50 it is 100 mm). */
export function scaleBarSpec(scale) {
  const [metres, parts] = BARS.find(([m]) => (m * 1000) / scale >= BAR_MIN_PAPER_MM) || BARS.at(-1);
  return { metres, parts, segMetres: metres / parts, lengthMm: metres * 1000, paperMm: (metres * 1000) / scale };
}

/** Segment label such as 0, 0.5, 1 or 25. */
export const barLabel = (m) => String(Math.round(m * 100) / 100);

// Title block ---------------------------------------------------------------------------
export function drawingNumber(prefix, n) {
  const pre = ascii(prefix).replace(/-+$/, '');
  const num = String(999 + n); // sheet 1 is 1000, sheet 2 is 1001
  return pre ? `${pre}-${num}` : num;
}

/** Title block text for one sheet. Every value is plain ASCII; empty values stay as empty strings. */
export function titleBlockValues(project, { date = new Date(), sheetNo = 1, total = 1, sheetTitle = '', scaleLabel = '', paper = 'A3' } = {}) {
  const tb = project?.titleBlock || {};
  const t = (k) => ascii(tb[k]);
  return {
    project: t('projectName') || ascii(project?.name) || '',
    client: t('client'),
    address: t('address'),
    lotDp: t('lotDp'),
    council: t('council'),
    company: t('company'),
    drawn: t('drawnBy'),
    checked: t('checkedBy'),
    job: t('jobNumber'),
    prefix: t('drawingPrefix'),
    drawingNo: drawingNumber(tb.drawingPrefix, sheetNo),
    revision: t('revision'),
    issue: t('issuePurpose'),
    date: t('date') || ddmmyyyy(date),
    notes: t('notes'),
    sheetTitle: ascii(sheetTitle),
    scale: scaleLabel,
    sheet: `${sheetNo} of ${total}`,
    paper: paperOf(paper).name,
  };
}

/**
 * Plain list of the sheets of a plan set (kind, title, scale label) used by the cover register, the PDF and the preview.
 * Order: cover and register, one plan per level, a 3D view sheet when an image exists, then the schedules.
 */
export function sheetList(project, { hasSchedulePages = 1, scale, hasView = false } = {}) {
  const levels = levelsSorted(project);
  const out = [{ kind: 'title', title: 'COVER SHEET AND DRAWING REGISTER', scale: 'NTS' }];
  for (const l of levels) out.push({ kind: 'level', title: `${ascii(l.name) || 'Level'} floor plan`.toUpperCase(), scale: `1:${scale}` });
  if (hasView) out.push({ kind: 'view', title: '3D VIEW', scale: 'NTS' });
  for (let i = 0; i < hasSchedulePages; i++) out.push({ kind: 'schedule', title: 'SCHEDULES', scale: 'NTS' });
  return out;
}
