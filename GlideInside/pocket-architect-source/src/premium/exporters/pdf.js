// PDF plan set export: A3 landscape, one sheet per level to scale, schedules and an optional cover.
// Pure function, Node compatible. The jsPDF class is passed in, so this module imports nothing from jsPDF.
// See docs/SCOPE.md 8.1. At 1:100 a 10,000 mm wall measures 100 mm on the sheet.

import * as G from '../../model/geometry.js';
import {
  ascii, levelsSorted, levelTitle, wallShapes, doorGeometry, openingLines, stairGeometry, furnitureSize,
  furnitureCorners, scheduleData,
} from './shared.js';
import { BRAND, LOGO_PNG } from '../brand/logo.js';
import {
  AREA, SCALE_LIST, paperOf, ddmmyyyy, levelContent, chooseScale, scaleBarSpec, barLabel, titleBlockValues, sheetList,
} from './drawing.js';
import { furnitureStrokes, placeLabel, placeBeside, boxOf } from './symbols.js';

export { ddmmyyyy, AREA };
export const SHEET_W = 420; // the A3 design sheet; A1 is the same layout multiplied by 2
export const SHEET_H = 297;
export const SCALES = SCALE_LIST;
const M = 10; // inner frame margin
const OUT = 4; // outer border
const TB_TOP = 243; // title block strip top
const TB_BOTTOM = SHEET_H - M;
const TB_DISC = TB_BOTTOM - 6; // the disclaimer band sits below this line
const DEFAULT_DISCLAIMER = 'Concept design only. Not for construction. Not a development application drawing. Verify all dimensions on site.';
const ROWS_PER_PAGE = 33;
const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const ACCENT = rgb(BRAND.accent);
const INK = rgb(BRAND.ink);
const GREY = [128, 132, 140];
const LIGHT = [205, 208, 214];
const BAND = [240, 242, 245];
const NEW_FILL = [38, 40, 46];
const EXIST_FILL = [158, 160, 166];
const DEMO = [196, 48, 48];

/** Width, height and format of a PNG or JPEG data URL, or null. */
export function imageInfo(dataUrl) {
  try {
    const m = /^data:image\/(png|jpe?g);base64,([A-Za-z0-9+/=]+)/i.exec(dataUrl || '');
    if (!m) return null;
    const png = m[1].toLowerCase() === 'png';
    const bin = atob(m[2].slice(0, png ? 48 : 87380));
    const u32 = (o) => ((bin.charCodeAt(o) << 24) | (bin.charCodeAt(o + 1) << 16) | (bin.charCodeAt(o + 2) << 8) | bin.charCodeAt(o + 3)) >>> 0;
    if (png) return { w: u32(16), h: u32(20), fmt: 'PNG', url: dataUrl };
    let o = 2;
    while (o + 9 < bin.length) {
      if (bin.charCodeAt(o) !== 0xff) { o++; continue; }
      const mk = bin.charCodeAt(o + 1);
      const len = (bin.charCodeAt(o + 2) << 8) | bin.charCodeAt(o + 3);
      if (mk >= 0xc0 && mk <= 0xcf && mk !== 0xc4 && mk !== 0xc8 && mk !== 0xcc) {
        return { h: (bin.charCodeAt(o + 5) << 8) | bin.charCodeAt(o + 6), w: (bin.charCodeAt(o + 7) << 8) | bin.charCodeAt(o + 8), fmt: 'JPEG', url: dataUrl };
      }
      o += 2 + len;
    }
    return { w: 4, h: 3, fmt: 'JPEG', url: dataUrl };
  } catch {
    return null;
  }
}

function getLogo(options) {
  let url = options.logo;
  if (url === undefined) {
    try {
      url = typeof window !== 'undefined' ? window.__ps?.getLogo?.() : null;
    } catch {
      url = null;
    }
  }
  const info = url ? imageInfo(url) : null;
  return info && info.w > 0 && info.h > 0 ? info : null;
}

/** Sheet plan: scale, paper, the ordered pages and their content. No drawing happens here. */
export function planSheets(project, { image = null, scale = null, paper = null, catalogue = null } = {}) {
  const levels = levelsSorted(project);
  const contents = levels.map((level, i) => levelContent(project, level, i === 0, catalogue));
  const p = paperOf(paper || project.drawing?.paper);
  const picked = chooseScale(contents, scale ?? project.drawing?.scale ?? 'auto', p.name);
  const data = scheduleData(project);
  const roomRows = buildRoomRows(data);
  const schedPages = Math.max(1, Math.ceil(roomRows.length / ROWS_PER_PAGE), Math.ceil(data.openings.length / ROWS_PER_PAGE));
  const sheets = sheetList(project, { hasSchedulePages: schedPages, scale: picked.scale, hasView: !!image });
  const pages = [{ kind: 'title' }];
  for (const c of contents) pages.push({ kind: 'level', content: c });
  if (image) pages.push({ kind: 'view' });
  for (let i = 0; i < schedPages; i++) pages.push({ kind: 'schedule', index: i, count: schedPages });
  pages.forEach((pg, i) => { pg.sheet = sheets[i]; });
  return { ...picked, paper: p.name, pages, sheets, data, roomRows, image };
}

function buildRoomRows(data) {
  const rows = data.rooms.map((r) => ({ cells: [r.level, r.name, r.type, r.area.toFixed(2)], status: r.status }));
  rows.push({ blank: true });
  for (const t of data.totals) {
    rows.push({ cells: [t.level, 'Total indoor area', '', t.indoor.toFixed(2)], bold: true });
    if (t.outdoor > 0) rows.push({ cells: [t.level, 'Total outdoor area', '', t.outdoor.toFixed(2)], bold: true });
  }
  const byStatus = { existing: 0, new: 0, demolish: 0 };
  let extension = false;
  for (const r of data.rooms) {
    if (r.outdoor) continue;
    byStatus[r.status] = (byStatus[r.status] || 0) + r.area;
    if (r.status !== 'new') extension = true;
  }
  if (extension) {
    rows.push({ blank: true });
    rows.push({ cells: ['', 'Existing floor area', '', byStatus.existing.toFixed(2)], bold: true });
    rows.push({ cells: ['', 'New floor area', '', byStatus.new.toFixed(2)], bold: true });
    rows.push({ cells: ['', 'Demolished floor area', '', byStatus.demolish.toFixed(2)], bold: true });
  }
  return rows;
}

// Drawing helpers ------------------------------------------------------------------
const ink = (doc, c = INK) => {
  doc.setDrawColor(c[0], c[1], c[2]);
  doc.setTextColor(c[0], c[1], c[2]);
};

function polygon(doc, pts, style) {
  const [p0, ...rest] = pts;
  const segs = rest.map((p, i) => [p.x - (i ? rest[i - 1].x : p0.x), p.y - (i ? rest[i - 1].y : p0.y)]);
  doc.lines(segs, p0.x, p0.y, [1, 1], style, true);
}

function polyline(doc, pts) {
  for (let i = 0; i < pts.length - 1; i++) doc.line(pts[i].x, pts[i].y, pts[i + 1].x, pts[i + 1].y);
}

function fit(doc, text, width) {
  let s = ascii(text);
  if (doc.getTextWidth(s) <= width) return s;
  while (s.length > 1 && doc.getTextWidth(`${s}...`) > width) s = s.slice(0, -1);
  return `${s}...`;
}

// Frame, grid references and the title block strip ---------------------------------------------------------------
function cell(doc, x, y, w, h, label, value, { size = 8.5, bold = true, align = 'left' } = {}) {
  doc.setLineWidth(0.2);
  ink(doc);
  doc.rect(x, y, w, h);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(5);
  ink(doc, GREY);
  if (label) doc.text(label, x + 1.5, y + 2.7);
  if (value) {
    doc.setFont('helvetica', bold ? 'bold' : 'normal');
    doc.setFontSize(size);
    ink(doc);
    const room = w - 3;
    if (align === 'center') doc.text(fit(doc, value, room), x + w / 2, y + h - 2.2, { align: 'center' });
    else doc.text(fit(doc, value, room), x + 1.5, y + h - 2.2);
  }
}

function gridRefs(doc) {
  doc.setLineWidth(0.15);
  ink(doc);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(5.5);
  const w = SHEET_W - 2 * M;
  const h = SHEET_H - 2 * M;
  for (let i = 0; i < 8; i++) {
    const x0 = M + (w * i) / 8;
    const cx = x0 + w / 16;
    if (i > 0) {
      doc.line(x0, OUT, x0, M);
      doc.line(x0, SHEET_H - M, x0, SHEET_H - OUT);
    }
    doc.text(String(i + 1), cx, OUT + 3.9, { align: 'center' });
    doc.text(String(i + 1), cx, SHEET_H - OUT - 1.4, { align: 'center' });
  }
  for (let i = 0; i < 6; i++) {
    const y0 = M + (h * i) / 6;
    const cy = y0 + h / 12;
    if (i > 0) {
      doc.line(OUT, y0, M, y0);
      doc.line(SHEET_W - M, y0, SHEET_W - OUT, y0);
    }
    const L = String.fromCharCode(65 + i);
    doc.text(L, OUT + 3, cy + 1.2, { align: 'center' });
    doc.text(L, SHEET_W - OUT - 3, cy + 1.2, { align: 'center' });
  }
}

function frame(doc, ctx, { title, scaleLabel, sheet }) {
  const { project, config, date, total, paper } = ctx;
  const v = titleBlockValues(project, { date, sheetNo: sheet, total, sheetTitle: title, scaleLabel, paper });
  const tb = project.titleBlock || {};
  ink(doc);
  doc.setLineWidth(0.18);
  doc.rect(OUT, OUT, SHEET_W - 2 * OUT, SHEET_H - 2 * OUT);
  doc.setLineWidth(0.5);
  doc.rect(M, M, SHEET_W - 2 * M, SHEET_H - 2 * M);
  gridRefs(doc);

  const x0 = M;
  const y0 = TB_TOP;
  const h = TB_DISC - TB_TOP;
  doc.setLineWidth(0.4);
  doc.rect(x0, y0, SHEET_W - 2 * M, TB_BOTTOM - TB_TOP);
  doc.setLineWidth(0.2);
  doc.line(x0, TB_DISC, SHEET_W - M, TB_DISC);

  // Panel 1: Glide Inside logo and name.
  const w1 = 45;
  doc.rect(x0, y0, w1, h);
  if (ctx.brand) {
    const lw = w1 - 8;
    const lh = lw / (ctx.brand.w / ctx.brand.h);
    placeImage(doc, ctx.brand, { x: x0 + 4, y: y0 + h / 2 - lh - 1, w: lw, h: lh });
  }
  else {
    // The logo image carries the name; the text is only a fallback when the image is missing.
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    ink(doc);
    doc.text(BRAND.name, x0 + w1 / 2, y0 + h / 2, { align: 'center' });
  }
  if (v.company) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6);
    ink(doc, GREY);
    doc.text(doc.splitTextToSize(`Prepared by ${v.company}`, w1 - 4).slice(0, 2), x0 + w1 / 2, y0 + h / 2 + 5, { align: 'center' });
  }

  // Panel 2: project, client, drawing title stacked.
  const w2 = 105;
  const x2 = x0 + w1;
  const rh = h / 3;
  cell(doc, x2, y0, w2, rh * 1.25, 'PROJECT', '', {});
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  ink(doc);
  if (v.project) doc.text(fit(doc, v.project.toUpperCase(), w2 - 3), x2 + 1.5, y0 + 8.2);
  if (v.address) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.text(fit(doc, v.address.toUpperCase(), w2 - 3), x2 + 1.5, y0 + 12.4);
  }
  const rest = (h - rh * 1.25) / 2;
  cell(doc, x2, y0 + rh * 1.25, w2, rest, 'CLIENT', v.client, { size: 8 });
  if (ctx.logo) placeImage(doc, ctx.logo, { x: x2 + w2 - 22, y: y0 + rh * 1.25 + 1.5, w: 20, h: rest - 3 });
  cell(doc, x2, y0 + rh * 1.25 + rest, w2, rest, 'DRAWING TITLE', v.sheetTitle, { size: 8 });

  // Panel 3: revisions. The current revision row comes from the title block, then empty ruled rows.
  const x3 = x2 + w2;
  const cols = [['REV', 12], ['DATE', 20], ['DESCRIPTION', 38], ['DRN', 10], ['CHK', 10], ['APP', 10]];
  const w3 = cols.reduce((a, c) => a + c[1], 0);
  const rowH = h / 6;
  doc.setFillColor(BAND[0], BAND[1], BAND[2]);
  doc.rect(x3, y0, w3, rowH, 'FD');
  const row = [v.revision, v.date, v.issue, v.drawn, v.checked, ascii(tb.approvedBy)];
  for (let r = 0; r < 6; r++) {
    let cx = x3;
    cols.forEach(([name, w], c) => {
      doc.setLineWidth(0.2);
      ink(doc);
      if (r === 0) doc.setFillColor(BAND[0], BAND[1], BAND[2]);
      doc.rect(cx, y0 + r * rowH, w, rowH, r === 0 ? 'FD' : 'S');
      if (r === 0) {
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(5.5);
        ink(doc, GREY);
        doc.text(name, cx + 1.5, y0 + rowH - 1.8);
      } else if (r === 1 && row[c]) {
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(6.5);
        ink(doc);
        doc.text(fit(doc, row[c], w - 2), cx + 1.2, y0 + rowH * 2 - 1.8);
      }
      cx += w;
    });
  }

  // Panel 4: drawing number, revision, status, dates and sheet details.
  const x4 = x3 + w3;
  const w4 = SHEET_W - M - x4;
  const hA = 19;
  const hB = (h - hA) / 2;
  cell(doc, x4, y0, w4 - 65, hA, 'DRAWING NUMBER', v.drawingNo, { size: 17 });
  cell(doc, x4 + w4 - 65, y0, 30, hA, 'REV', v.revision, { size: 17, align: 'center' });
  cell(doc, x4 + w4 - 35, y0, 35, hA, 'STATUS', v.issue.toUpperCase(), { size: 9 });
  const b = w4 / 5;
  [['DATE', v.date], ['DRAWN', v.drawn], ['CHECKED', v.checked], ['APPROVED', ascii(tb.approvedBy)], ['JOB NO.', v.job]]
    .forEach(([l, val], i) => cell(doc, x4 + i * b, y0 + hA, b, hB, l, val, { size: 7.5 }));
  const c3 = w4 / 3;
  cell(doc, x4, y0 + hA + hB, c3, hB, 'SCALE', v.scale, { size: 8 });
  cell(doc, x4 + c3, y0 + hA + hB, c3, hB, 'SHEET', `${sheet} OF ${total}`, { size: 8 });
  cell(doc, x4 + 2 * c3, y0 + hA + hB, c3, hB, 'SIZE', v.paper, { size: 8 });

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(5.5);
  ink(doc, GREY);
  const note = ascii(config.disclaimer || DEFAULT_DISCLAIMER);
  doc.text(fit(doc, note, SHEET_W - 2 * M - 4), x0 + 2, TB_DISC + 3.9);
}

function northArrow(doc, cx, cy, deg) {
  const r = 5;
  const a = (deg * Math.PI) / 180;
  const dir = { x: Math.sin(a), y: -Math.cos(a) };
  const perp = { x: -dir.y, y: dir.x };
  ink(doc);
  doc.setLineWidth(0.25);
  doc.circle(cx, cy, r, 'S');
  const tip = { x: cx + dir.x * (r + 2.5), y: cy + dir.y * (r + 2.5) };
  const base = { x: cx - dir.x * 1.5, y: cy - dir.y * 1.5 };
  doc.setFillColor(INK[0], INK[1], INK[2]);
  polygon(doc, [tip, { x: base.x + perp.x * 2.2, y: base.y + perp.y * 2.2 }, { x: base.x - perp.x * 2.2, y: base.y - perp.y * 2.2 }], 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.text('N', cx + dir.x * (r + 5.5), cy + dir.y * (r + 5.5) + 1, { align: 'center' });
}

/**
 * Graduated scale bar at the printed scale 1:scale, alternating black and white segments with labels in metres.
 * `dscale` is the real millimetres per design unit (scale times the paper factor), so the bar is the right length on paper.
 */
function scaleBar(doc, x, y, scale, dscale) {
  const spec = scaleBarSpec(scale);
  const seg = (spec.segMetres * 1000) / dscale;
  const h = 2;
  doc.setLineWidth(0.2);
  ink(doc);
  for (let i = 0; i < spec.parts; i++) {
    if (i % 2 === 0) doc.setFillColor(INK[0], INK[1], INK[2]);
    else doc.setFillColor(255, 255, 255);
    doc.rect(x + i * seg, y, seg, h, 'FD');
  }
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  for (let i = 0; i <= spec.parts; i++) doc.text(barLabel(spec.segMetres * i), x + i * seg, y + h + 3.2, { align: 'center' });
  doc.text('m', x + spec.parts * seg + 3.5, y + h + 3.2);
  return spec;
}

/** Rooms' outdoor areas, furniture, stairs, walls and doors and windows. `detail` false gives the small cover thumbnail. */
function planGeometry(doc, content, T, detail, catalogue) {
  const { level, shapes } = content;
  // Outdoor areas and furniture sit under the walls.
  for (const r of level.rooms) {
    if (!r.outdoor) continue;
    doc.setFillColor(240, 238, 228);
    ink(doc, GREY);
    doc.setLineWidth(0.15);
    doc.setLineDashPattern([1.5, 1], 0);
    polygon(doc, r.polygon.map(T), 'FD');
    doc.setLineDashPattern([], 0);
  }
  if (detail) for (const f of level.furniture) drawFurniture(doc, furnitureStrokes(catalogue, f), T, content.scale || 100);
  for (const st of level.stairs) {
    const g = stairGeometry(st);
    ink(doc);
    doc.setLineWidth(0.18);
    polygon(doc, g.corners.map(T), 'S');
    doc.setLineWidth(0.1);
    for (const t of g.treads) doc.line(T(t[0]).x, T(t[0]).y, T(t[1]).x, T(t[1]).y);
    doc.setLineWidth(0.2);
    for (const a of g.arrow) doc.line(T(a[0]).x, T(a[0]).y, T(a[1]).x, T(a[1]).y);
  }

  // Walls, poched by status.
  for (const s of shapes) {
    const status = s.wall.status;
    for (const piece of s.pieces) {
      const pts = piece.poly.map(T);
      doc.setLineWidth(0.18);
      if (status === 'demolish') {
        ink(doc, DEMO);
        doc.setLineDashPattern([1.2, 0.8], 0);
        polygon(doc, pts, 'S');
        doc.setLineDashPattern([], 0);
      } else {
        const fill = status === 'existing' ? EXIST_FILL : NEW_FILL;
        doc.setFillColor(fill[0], fill[1], fill[2]);
        doc.setDrawColor(fill[0], fill[1], fill[2]);
        polygon(doc, pts, 'FD');
      }
    }
  }

  // Doors and windows.
  doc.setLineWidth(0.2);
  ink(doc);
  for (const s of shapes) {
    for (const sp of s.spans) {
      const o = sp.opening;
      if (o.kind === 'door') {
        const g = doorGeometry(s, o);
        const H = T(g.H);
        const arc = [];
        const a0 = Math.atan2(g.F.y - g.H.y, g.F.x - g.H.x);
        let diff = Math.atan2(g.O.y - g.H.y, g.O.x - g.H.x) - a0;
        diff = Math.atan2(Math.sin(diff), Math.cos(diff));
        for (let i = 0; i <= 14; i++) {
          const a = a0 + (diff * i) / 14;
          arc.push(T({ x: g.H.x + Math.cos(a) * g.radius, y: g.H.y + Math.sin(a) * g.radius }));
        }
        doc.line(H.x, H.y, T(g.O).x, T(g.O).y);
        polyline(doc, arc);
      }
      for (const l of openingLines(s, o).lines) doc.line(T(l[0]).x, T(l[0]).y, T(l[1]).x, T(l[1]).y);
    }
  }

}

/** One furniture symbol from its recorded draw2d strokes (see symbols.js). Line weights are relative to 0.1 mm. */
function drawFurniture(doc, ops, T, scale) {
  const path = (p, style) => {
    const pts = p.pts.map(T);
    if (pts.length < 2) return;
    if (style === 'F') {
      if (pts.length > 2) polygon(doc, pts, 'F');
    } else if (p.closed && pts.length > 2) polygon(doc, pts, 'S');
    else polyline(doc, pts);
  };
  for (const o of ops) {
    if (o.op === 'fill') {
      // Paper fills mask what lies under the symbol; tinted fills are the light shading of the canvas symbol.
      const k = o.tint ? Math.min(1, o.alpha) : 0;
      const shade = (c) => Math.round(255 - (255 - c) * k);
      doc.setFillColor(shade(GREY[0]), shade(GREY[1]), shade(GREY[2]));
      for (const p of o.paths) path(p, 'F');
    } else {
      ink(doc, GREY);
      doc.setLineWidth(Math.max(0.05, Math.min(0.35, 0.1 * (o.width || 1))));
      if (o.dash?.length) doc.setLineDashPattern(o.dash.map((d) => Math.max(0.3, d / scale)), 0);
      for (const p of o.paths) path(p, 'S');
      if (o.dash?.length) doc.setLineDashPattern([], 0);
    }
  }
}

/** Sheet boxes of the dimension strings (lines, extension lines and the text), for label collision checks. */
/** Sheet box of the walls and rooms of a level (not the dimensions), or null. */
function levelOutlineBox(content, T) {
  const pts = [];
  for (const sh of content.shapes) for (const p of sh.pieces) pts.push(...p.poly);
  for (const r of content.level.rooms) pts.push(...r.polygon);
  return pts.length ? boxOf(pts.map(T), 0.5) : null;
}

function dimensionBoxes(doc, dims, T) {
  const out = [];
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  for (const d of dims) {
    out.push(boxOf([T(d.a), T(d.b)], 0.6));
    for (const e of d.ext) out.push(boxOf([T(e[0]), T(e[1])], 0.4));
    const at = T(d.textAt);
    const tw = doc.getTextWidth(d.text);
    out.push(d.textRot ? { x0: at.x - 2.8, y0: at.y - tw / 2 - 0.5, x1: at.x + 0.5, y1: at.y + tw / 2 + 0.5 } : { x0: at.x - tw / 2 - 0.5, y0: at.y - 2.8, x1: at.x + tw / 2 + 0.5, y1: at.y + 0.5 });
  }
  return out;
}

function drawLevel(doc, ctx, content) {
  const { project, catalogue } = ctx;
  const scale = ctx.dscale;
  const { level, shapes, dims, box } = content;
  const ox = AREA.x + (AREA.w - box.w / scale) / 2;
  const oy = AREA.y + (AREA.h - box.h / scale) / 2;
  const T = (p) => ({ x: ox + (p.x - box.minX) / scale, y: oy + (p.y - box.minY) / scale });
  const first = levelsSorted(project)[0] === level;

  planGeometry(doc, { ...content, scale }, T, true, catalogue);

  // Obstacles for labels: furniture boxes, dimension strings, tanks and the building outline (for tank labels).
  const dimBoxes = dimensionBoxes(doc, dims, T);
  const furnBoxes = level.furniture.map((f) => boxOf(furnitureCorners(f, furnitureSize(catalogue, f)).map(T), 0.3));
  const tanks = first ? (project.site?.tanks || []).map((t) => ({ t, c: T(t), r: t.diameter / 2 / scale })) : [];
  const tankBoxes = tanks.map(({ c, r }) => ({ x0: c.x - r, y0: c.y - r, x1: c.x + r, y1: c.y + r }));
  const labelBoxes = [];
  // Door swings: the box of hinge, closed and open leaf ends and the far corner of the quarter circle.
  const doorBoxes = [];
  for (const sh of shapes) {
    for (const sp of sh.spans) {
      if (sp.opening.kind !== 'door') continue;
      const g = doorGeometry(sh, sp.opening);
      const far = { x: g.F.x + g.O.x - g.H.x, y: g.F.y + g.O.y - g.H.y };
      doorBoxes.push(boxOf([g.H, g.F, g.O, far].map(T), 0.2));
    }
  }
  const wallBoxes = [];
  for (const sh of shapes) for (const pc of sh.pieces) wallBoxes.push(boxOf(pc.poly.map(T), 0.3));
  const wallInset = (Math.max(0, ...shapes.map((sh) => Number(sh.wall.thickness) || 0)) / 2) / scale + 0.5;

  // Room names and areas, in the largest clear part of each room.
  for (const r of level.rooms) {
    const centroid = T(G.polygonCentroid(r.polygon));
    const areaText = `${(G.polygonArea(r.polygon) / 1e6).toFixed(2)} m2`;
    const wMm = G.bbox(r.polygon).w / scale;
    const small = wMm < 22;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(small ? 6.5 : 8.5);
    const name = fit(doc, r.name || r.type, Math.max(wMm - 2, 8));
    const nameW = doc.getTextWidth(name);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(small ? 6 : 7.5);
    const areaW = doc.getTextWidth(areaText);
    const bw = Math.max(nameW, areaW) + 0.6;
    const bh = small ? 6.4 : 7.6;
    const obstacles = [...wallBoxes, ...furnBoxes, ...doorBoxes, ...dimBoxes, ...tankBoxes, ...labelBoxes];
    const poly = r.polygon.map(T);
    const spot = placeLabel({ poly, w: bw, h: bh, obstacles, prefer: centroid, inset: wallInset })
      || placeLabel({ poly, w: bw, h: bh, obstacles, prefer: centroid, inset: 0.2 })
      || { x: centroid.x, y: centroid.y };
    // Block centre to baselines: the name sits above the centre line and the area below it.
    const c = { x: spot.x, y: spot.y - 0.4 };
    labelBoxes.push({ x0: spot.x - bw / 2, y0: spot.y - bh / 2, x1: spot.x + bw / 2, y1: spot.y + bh / 2 });
    ink(doc);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(small ? 6.5 : 8.5);
    doc.text(name, c.x, c.y - 0.6, { align: 'center' });
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(small ? 6 : 7.5);
    doc.text(areaText, c.x, c.y + 3.2, { align: 'center' });
  }

  // Rainwater tanks, labelled clear of the dimension strings and the building.
  if (tanks.length) {
    const outline = content.box && levelOutlineBox(content, T);
    for (const { t, c, r } of tanks) {
      ink(doc);
      doc.setLineWidth(0.25);
      doc.circle(c.x, c.y, r, 'S');
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(6.5);
      const text = `RWT ${Math.round(t.capacityL)}L`;
      const w = doc.getTextWidth(text) + 0.6;
      const at = placeBeside({ c, r, w, h: 2.8, obstacles: [...dimBoxes, ...labelBoxes, ...(outline ? [outline] : [])] });
      doc.text(text, at.x, at.y + 1, { align: 'center' });
      labelBoxes.push({ x0: at.x - w / 2, y0: at.y - 1.4, x1: at.x + w / 2, y1: at.y + 1.4 });
    }
  }

  // Dimension strings.
  doc.setLineWidth(0.12);
  ink(doc, [60, 66, 90]);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  for (const d of dims) {
    for (const e of d.ext) doc.line(T(e[0]).x, T(e[0]).y, T(e[1]).x, T(e[1]).y);
    doc.line(T(d.a).x, T(d.a).y, T(d.b).x, T(d.b).y);
    doc.setLineWidth(0.25);
    for (const t of d.ticks) {
      const a = T(t[0]);
      const b = T(t[1]);
      const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
      const ux = ((b.x - a.x) / len) * 1.1;
      const uy = ((b.y - a.y) / len) * 1.1;
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      doc.line(mid.x - ux, mid.y - uy, mid.x + ux, mid.y + uy);
    }
    doc.setLineWidth(0.12);
    const at = T(d.textAt);
    if (d.textRot) doc.text(d.text, at.x, at.y, { align: 'center', angle: 90 });
    else doc.text(d.text, at.x, at.y, { align: 'center' });
  }

  // Plan title with its scale, the fallback note when the requested scale did not fit, scale bar and north arrow.
  const sy = AREA.y + AREA.h + 8;
  ink(doc);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text(`${levelTitle(level).toUpperCase()}  1:${ctx.scale} at ${ctx.paper}`, AREA.x + 2, sy + 3);
  if (ctx.note) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    ink(doc, GREY);
    doc.text(ascii(ctx.note), AREA.x + 2, sy + 9);
  }
  ink(doc);
  scaleBar(doc, 190, sy, ctx.scale, scale);
  northArrow(doc, SHEET_W - 30, sy + 4, project.site?.northDeg || 0);
}

function drawSchedule(doc, ctx, page, plan) {
  const { data, roomRows } = plan;
  const i0 = page.index * ROWS_PER_PAGE;
  const rooms = roomRows.slice(i0, i0 + ROWS_PER_PAGE);
  const openings = data.openings.slice(i0, i0 + ROWS_PER_PAGE);
  const table = (x, y, widths, heads, rows, rightCols, title) => {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    ink(doc);
    doc.text(title, x, y - 4);
    const total = widths.reduce((a, b) => a + b, 0);
    doc.setFillColor(232, 234, 238);
    doc.setLineWidth(0.15);
    doc.rect(x, y, total, 6, 'FD');
    doc.setFontSize(8);
    let cx = x;
    heads.forEach((h, k) => {
      if (rightCols.includes(k)) doc.text(h, cx + widths[k] - 1.5, y + 4.1, { align: 'right' });
      else doc.text(h, cx + 1.5, y + 4.1);
      cx += widths[k];
    });
    let ry = y + 6;
    for (const row of rows) {
      if (row.blank) {
        ry += 5.5;
        continue;
      }
      doc.setFont('helvetica', row.bold ? 'bold' : 'normal');
      doc.setFontSize(8);
      ink(doc);
      let px = x;
      row.cells.forEach((c, k) => {
        const txt = fit(doc, c, widths[k] - 3);
        if (rightCols.includes(k)) doc.text(txt, px + widths[k] - 1.5, ry + 3.9, { align: 'right' });
        else doc.text(txt, px + 1.5, ry + 3.9);
        px += widths[k];
      });
      ink(doc, LIGHT);
      doc.line(x, ry + 5.5, x + total, ry + 5.5);
      ry += 5.5;
    }
  };
  table(22, 32, [28, 54, 40, 24], ['Level', 'Room', 'Type', 'Area m2'], rooms, [3], page.count > 1 ? `Area schedule (${page.index + 1} of ${page.count})` : 'Area schedule');
  const orows = openings.map((o) => ({ cells: [o.type, o.style || '-', `${o.width} x ${o.height}`, o.sill ? String(o.sill) : '-', String(o.count)] }));
  table(206, 32, [32, 34, 44, 20, 14], ['Type', 'Style', 'Size mm (W x H)', 'Sill', 'Qty'], orows, [3, 4], 'Door and window schedule');
}

const spaced = (t) => ascii(t).toUpperCase().split(' ').map((w) => w.split('').join(' ')).join('   ');

function placeImage(doc, img, box) {
  const k = Math.min(box.w / img.w, box.h / img.h);
  const w = img.w * k;
  const h = img.h * k;
  try {
    doc.addImage(img.url, img.fmt, box.x + (box.w - w) / 2, box.y + (box.h - h) / 2, w, h);
    return true;
  } catch {
    return false;
  }
}

/** Sheet 1: logo, caption, project name, address, client, status, a small site plan and the drawing register. */
function drawCover(doc, ctx, plan) {
  const { project, date, total, paper } = ctx;
  const v = titleBlockValues(project, { date, sheetNo: 1, total, sheetTitle: plan.sheets[0].title, scaleLabel: 'NTS', paper });
  const cx = SHEET_W / 2;
  ink(doc);
  if (ctx.brand) placeImage(doc, ctx.brand, { x: cx - 45, y: 17, w: 90, h: 90 / (ctx.brand.w / ctx.brand.h) });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  ink(doc, GREY);
  doc.text(spaced('Concept design drawings'), cx, 46, { align: 'center' });
  ink(doc);
  doc.setFont('helvetica', 'bold');
  let size = 38;
  const name = (v.project || 'Untitled design').toUpperCase();
  doc.setFontSize(size);
  while (size > 14 && doc.getTextWidth(name) > 380) {
    size -= 2;
    doc.setFontSize(size);
  }
  doc.text(name, cx, 66, { align: 'center' });
  doc.setFillColor(ACCENT[0], ACCENT[1], ACCENT[2]);
  doc.rect(cx - 20, 71, 40, 1.4, 'F');
  let y = 81;
  if (v.address) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(12);
    ink(doc);
    doc.text(fit(doc, v.address.toUpperCase(), 380), cx, y, { align: 'center' });
    y += 8;
  }
  if (v.client) {
    doc.setFontSize(10);
    ink(doc, GREY);
    doc.text(fit(doc, `PREPARED FOR ${v.client.toUpperCase()}`, 380), cx, y, { align: 'center' });
    y += 8;
  }
  const by = y + 2;
  doc.setLineWidth(0.3);
  ink(doc);
  doc.rect(cx - 40, by, 80, 19);
  doc.setFillColor(ACCENT[0], ACCENT[1], ACCENT[2]);
  doc.rect(cx - 40, by, 3.5, 19, 'F');
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6);
  ink(doc, GREY);
  doc.text('STATUS', cx - 34, by + 5);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  ink(doc);
  if (v.issue) doc.text(fit(doc, v.issue.toUpperCase(), 70), cx - 34, by + 14.5);

  // Site plan panel, lower left.
  const py = 124;
  const ph = TB_TOP - 12 - py;
  const px = 14;
  const pw = 184;
  doc.setLineWidth(0.4);
  ink(doc);
  doc.rect(px, py, pw, ph);
  doc.setFillColor(INK[0], INK[1], INK[2]);
  doc.rect(px, py, pw, 7, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(255, 255, 255);
  doc.text('SITE PLAN', px + 3, py + 4.9);
  const first = plan.pages.find((pg) => pg.kind === 'level');
  if (first) {
    const box = first.content.box;
    const inner = { x: px + 8, y: py + 12, w: pw - 16, h: ph - 20 };
    const k = Math.max(box.w / inner.w, box.h / inner.h, 1e-6);
    const ox = inner.x + (inner.w - box.w / k) / 2;
    const oy = inner.y + (inner.h - box.h / k) / 2;
    const T = (pt) => ({ x: ox + (pt.x - box.minX) / k, y: oy + (pt.y - box.minY) / k });
    planGeometry(doc, first.content, T, false, ctx.catalogue);
    northArrow(doc, px + pw - 14, py + 24, project.site?.northDeg || 0);
  }
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  ink(doc);
  doc.text('NTS', px + pw / 2, py + ph + 4.5, { align: 'center' });

  // Drawing register, right.
  const rx = 212;
  const widths = [38, 112, 34];
  const tw = widths.reduce((a, b) => a + b, 0);
  const rh = 7;
  doc.setFillColor(INK[0], INK[1], INK[2]);
  doc.rect(rx, py, tw, 8, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(255, 255, 255);
  ['DRAWING No.', 'DRAWING TITLE', 'REV'].forEach((h, i) => doc.text(h, rx + widths.slice(0, i).reduce((a, b) => a + b, 0) + 2.5, py + 5.4));
  const cap = Math.floor((ph - 8) / rh);
  const rows = plan.sheets.length > cap ? plan.sheets.slice(0, cap - 1) : plan.sheets;
  rows.forEach((sh, i) => {
    const ry = py + 8 + i * rh;
    if (i % 2 === 0) {
      doc.setFillColor(BAND[0], BAND[1], BAND[2]);
      doc.rect(rx, ry, tw, rh, 'F');
    }
    const cells = [titleBlockValues(project, { date, sheetNo: i + 1, total }).drawingNo, sh.title, v.revision];
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    ink(doc);
    let x = rx;
    cells.forEach((c, k) => {
      doc.text(fit(doc, c, widths[k] - 4), x + 2.5, ry + 4.8);
      x += widths[k];
    });
  });
  if (plan.sheets.length > rows.length) {
    ink(doc, GREY);
    doc.setFontSize(8);
    doc.text(`and ${plan.sheets.length - rows.length} more sheets`, rx + 2.5, py + 8 + rows.length * rh + 4.8);
  }
  doc.setLineWidth(0.3);
  ink(doc);
  doc.rect(rx, py, tw, 8 + Math.min(plan.sheets.length, cap) * rh);
}

/** The 3D view sheet: the snapshot as large as the drawing area allows. */
function drawView(doc, ctx, image) {
  const img = imageInfo(image) || { w: 16, h: 9, fmt: 'PNG', url: image };
  if (!placeImage(doc, img, { x: AREA.x, y: AREA.y, w: AREA.w, h: AREA.h + 10 })) {
    doc.setFontSize(9);
    ink(doc, GREY);
    doc.text('3D view not available.', AREA.x, AREA.y + 6);
  }
}

// jsPDF works in the units of the page. The drawing is laid out on an A3 design sheet, so for A1 every length, line
// width, font size and dash is multiplied by k before it reaches jsPDF. Real millimetres on paper stay exact.
function scaledDoc(doc, k) {
  if (k === 1) return doc;
  const sc = (a) => a.map((n) => (typeof n === 'number' ? n * k : n));
  return {
    raw: doc,
    setLineWidth: (w) => doc.setLineWidth(w * k),
    setFontSize: (n) => doc.setFontSize(n * k),
    setLineDashPattern: (arr, ph) => doc.setLineDashPattern(sc(arr), ph * k),
    setFont: (...a) => doc.setFont(...a),
    setDrawColor: (...a) => doc.setDrawColor(...a),
    setFillColor: (...a) => doc.setFillColor(...a),
    setTextColor: (...a) => doc.setTextColor(...a),
    line: (x1, y1, x2, y2) => doc.line(x1 * k, y1 * k, x2 * k, y2 * k),
    rect: (x, y, w, h, st) => doc.rect(x * k, y * k, w * k, h * k, st),
    circle: (x, y, r, st) => doc.circle(x * k, y * k, r * k, st),
    lines: (segs, x, y, scl, st, closed) => doc.lines(segs.map(sc), x * k, y * k, scl, st, closed),
    text: (t, x, y, opts) => doc.text(t, x * k, y * k, opts),
    getTextWidth: (t) => doc.getTextWidth(t) / k,
    splitTextToSize: (t, w) => doc.splitTextToSize(t, w * k),
    addImage: (img, fmt, x, y, w, h) => doc.addImage(img, fmt, x * k, y * k, w * k, h * k),
  };
}

/**
 * Build the plan set. options: { jsPDF, image, config, scale, paper, date, catalogue }.
 * scale and paper default to project.drawing. Returns a Uint8Array with a non-enumerable `layout` property:
 * { scale, requested, fallback, note, paper, pages: ['title'|'level'|'view'|'schedule'], sheets: [{ number, title, scale }] }.
 */
export function toPDF(project, options = {}) {
  const { jsPDF, image = null, config = {}, scale = null, paper = null, date = new Date(), catalogue = null } = options;
  if (typeof jsPDF !== 'function') throw new Error('toPDF needs the jsPDF class (options.jsPDF)');
  const plan = planSheets(project, { image, scale, paper, catalogue });
  const p = paperOf(plan.paper);
  const raw = new jsPDF({ orientation: 'landscape', unit: 'mm', format: p.format, compress: false });
  const tb = project.titleBlock || {};
  raw.setProperties({
    title: `${ascii(tb.projectName || project.name) || 'Design'} plan set`,
    subject: 'Concept design plans',
    author: ascii(tb.company) || BRAND.name,
    creator: 'Plan Studio',
  });
  const doc = scaledDoc(raw, p.k);
  const total = plan.pages.length;
  const ctx = { brand: imageInfo(LOGO_PNG), logo: getLogo(options), project, config, scale: plan.scale, dscale: plan.scale * p.k, note: plan.note, paper: p.name, date, total, catalogue };
  plan.pages.forEach((page, i) => {
    if (i > 0) raw.addPage(p.format, 'landscape');
    doc.setLineDashPattern([], 0);
    if (page.kind === 'title') {
      frame(doc, ctx, { title: page.sheet.title, scaleLabel: 'NTS', sheet: i + 1 });
      drawCover(doc, ctx, plan);
    } else if (page.kind === 'view') {
      frame(doc, ctx, { title: page.sheet.title, scaleLabel: 'NTS', sheet: i + 1 });
      drawView(doc, ctx, image);
    } else if (page.kind === 'level') {
      frame(doc, ctx, { title: page.sheet.title, scaleLabel: `1:${plan.scale}`, sheet: i + 1 });
      drawLevel(doc, ctx, page.content);
    } else {
      frame(doc, ctx, { title: page.sheet.title, scaleLabel: 'NTS', sheet: i + 1 });
      drawSchedule(doc, ctx, page, plan);
    }
  });
  const bytes = new Uint8Array(raw.output('arraybuffer'));
  const sheets = plan.sheets.map((sh, i) => ({ number: titleBlockValues(project, { date, sheetNo: i + 1, total }).drawingNo, title: sh.title, scale: sh.scale }));
  Object.defineProperty(bytes, 'layout', {
    value: { scale: plan.scale, requested: plan.requested, fallback: plan.fallback, note: plan.note, paper: p.name, pages: plan.pages.map((pg) => pg.kind), sheets },
    enumerable: false,
  });
  return bytes;
}

export default toPDF;
