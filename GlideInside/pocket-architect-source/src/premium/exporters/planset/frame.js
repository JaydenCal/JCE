// Sheet frame and right hand title block strip for the Glide Inside plan set (A3 landscape, 420 x 297 mm). The layout follows the JCESITE
// plan sets: double border, drawing area on the left, one strip on the right (brand, client, project, drawing title, data, notes, then
// revision table, status stamp, scale and dates, drawing number).

import { clean, PEN, ink, wrap } from '../eng/kit.js';
import { imageInfo, placeImage } from '../pdf.js';
import { LOGO_PNG } from '../../brand/logo.js';

export const SW = 420;
export const SH = 297;
export const AREA = { x0: 10, y0: 10, x1: 332, y1: 287 };
export const STRIP = { x0: 335, x1: 410 };
export const ENTITY = 'JCE Infrastructure Pty Ltd trading as Glide Inside';
export const ABN = 'ABN 29 699 165 663';
export const EMAIL = 'hello@glideinside.com.au';
export const WEBSITE = 'glideinside.com.au';
export const CONCEPT_NOTE = 'Concept only. Setbacks and planning controls shown are indicative and must be checked with the council and a suitably qualified person.';
export const REV_TEXT = 'Concept issue';
export const STAMP = 'CONCEPT ONLY. NOT FOR CONSTRUCTION';
const NAVY = [20, 48, 74];
const TEAL = [11, 122, 133];
const LABEL = [95, 99, 106];
const RED = [184, 26, 26];

/** Text cut to a width with "..." (counts a superscript digit as the doc does). Keeps the characters it is given. */
export function fit(doc, text, width) {
  let s = clean(text);
  if (doc.getTextWidth(s) <= width) return s;
  while (s.length > 1 && doc.getTextWidth(`${s}...`) > width) s = s.slice(0, -1);
  return `${s}...`;
}

export const ddmmyyyy = (d = new Date()) => {
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`;
};

const box = (doc, x0, y0, x1, y1, lw = 0.25) => { doc.setLineWidth(lw); ink(doc, PEN.ink); doc.rect(x0, y0, x1 - x0, y1 - y0, 'S'); };
const label = (doc, text, x, y) => { doc.setFont('helvetica', 'normal'); doc.setFontSize(5.2); doc.setTextColor(...LABEL); doc.text(clean(text), x, y); };
const value = (doc, text, x, y, { size = 8, bold = true, maxW = 70 } = {}) => {
  doc.setFont('helvetica', bold ? 'bold' : 'normal');
  doc.setFontSize(size);
  doc.setTextColor(...PEN.ink);
  doc.text(fit(doc, clean(text), maxW), x, y);
};

/** Frame lines only (no strip). */
export function drawBorder(doc) {
  ink(doc, PEN.ink);
  doc.setLineWidth(0.5);
  doc.rect(5, 5, SW - 10, SH - 10);
  doc.setLineWidth(0.35);
  doc.rect(10, 10, SW - 20, SH - 20);
  doc.setLineWidth(0.25);
  doc.rect(AREA.x0, AREA.y0, AREA.x1 - AREA.x0, AREA.y1 - AREA.y0);
}

/**
 * Draws the border and the strip. ctx: { project, client, date, total, jobId }. sheet: { n, no, title, subtitle, scale, kv: [[k, v]], notes: [text] }.
 */
export function drawStrip(doc, ctx, sheet) {
  drawBorder(doc);
  const { x0, x1 } = STRIP;
  const W = x1 - x0;
  const tb = ctx.project.titleBlock || {};
  const lot = ctx.project.site?.lot;
  let y = 10;

  // Brand: Glide Inside wordmark, entity, ABN and contact.
  const bh = 41;
  box(doc, x0, y, x1, y + bh);
  const logo = imageInfo(LOGO_PNG);
  if (logo) placeImage(doc, logo, { x: x0 + 3, y: y + 3, w: W - 6, h: 11 });
  doc.setFillColor(...TEAL);
  doc.rect(x0 + 3, y + 15.4, W - 6, 0.6, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.2);
  doc.setTextColor(...NAVY);
  wrap(doc, ENTITY, W - 6).slice(0, 2).forEach((l, i) => doc.text(l, x0 + 3, y + 20.5 + i * 3.1));
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6.4);
  doc.setTextColor(...PEN.ink);
  doc.text(ABN, x0 + 3, y + 28.2);
  doc.text(EMAIL, x0 + 3, y + 32);
  doc.setTextColor(...TEAL);
  doc.text(WEBSITE, x0 + 3, y + 35.8);
  y += bh;

  // Client.
  box(doc, x0, y, x1, y + 12);
  label(doc, 'CLIENT', x0 + 2, y + 3.2);
  value(doc, ctx.client, x0 + 2, y + 8.6, { size: 9, maxW: W - 4 });
  y += 12;

  // Project.
  const ph = 33;
  box(doc, x0, y, x1, y + ph);
  label(doc, 'PROJECT', x0 + 2, y + 3.2);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  doc.setTextColor(...PEN.ink);
  let yy = y + 8.2;
  wrap(doc, ctx.projectTitle, W - 4).slice(0, 2).forEach((l) => { doc.text(l, x0 + 2, yy); yy += 4.2; });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6.8);
  for (const t of [ctx.address, ctx.lotDp, [lot?.lga, lot?.zoning?.code].filter(Boolean).join('  ')]) {
    if (!t) continue;
    wrap(doc, t, W - 4).slice(0, 2).forEach((l) => { if (yy < y + ph - 1) { doc.text(l, x0 + 2, yy); yy += 3; } });
  }
  y += ph;

  // Drawing title.
  const th = 19;
  box(doc, x0, y, x1, y + th);
  label(doc, 'DRAWING TITLE', x0 + 2, y + 3.2);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10.5);
  doc.setTextColor(...PEN.ink);
  wrap(doc, sheet.title, W - 4).slice(0, 2).forEach((l, i) => doc.text(l, x0 + 2, y + 8.6 + i * 4.6));
  if (sheet.subtitle) { doc.setFont('helvetica', 'normal'); doc.setFontSize(7.4); doc.text(fit(doc, clean(sheet.subtitle), W - 4), x0 + 2, y + th - 2); }
  y += th;

  // Bottom up fixed blocks.
  let yb = SH - 10;
  const dh = 15;
  yb -= dh;
  box(doc, x0, yb, x1, yb + dh);
  doc.setLineWidth(0.25);
  doc.line(x0 + 55, yb, x0 + 55, yb + dh);
  label(doc, 'DRAWING NUMBER', x0 + 2, yb + 3.2);
  value(doc, sheet.no, x0 + 2, yb + 10, { size: 12, maxW: 51 });
  label(doc, 'REV', x0 + 57, yb + 3.2);
  value(doc, sheet.rev || 'A', x0 + 57, yb + 11, { size: 13 });
  label(doc, 'SHEET', x0 + 66, yb + 3.2);
  value(doc, `${sheet.n} of ${ctx.total}`, x0 + 66 - 0.5, yb + 11, { size: 7, maxW: 9.5 });

  const sh = 21;
  yb -= sh;
  box(doc, x0, yb, x1, yb + sh);
  doc.setLineWidth(0.18);
  doc.line(x0, yb + sh / 3, x1, yb + sh / 3);
  doc.line(x0, yb + (2 * sh) / 3, x1, yb + (2 * sh) / 3);
  doc.line(x0 + W / 2, yb, x0 + W / 2, yb + sh);
  const date = clean(tb.date) || ctx.dateStr;
  const rows = [['SCALE (A3)', sheet.scale || 'NTS', 'DATE', date], ['DRAWN', clean(tb.drawnBy) || 'Glide Inside', 'CHECKED', clean(tb.checkedBy) || 'Not checked'], ['SHEET SIZE', 'A3 LANDSCAPE', 'JOB NO.', clean(tb.jobNumber) || ctx.jobId]];
  rows.forEach((r, i) => {
    const top = yb + (i * sh) / 3;
    label(doc, r[0], x0 + 1.8, top + 2.4);
    value(doc, r[1], x0 + 1.8, top + 6.2, { size: 6.8, maxW: W / 2 - 3 });
    label(doc, r[2], x0 + W / 2 + 1.8, top + 2.4);
    value(doc, r[3], x0 + W / 2 + 1.8, top + 6.2, { size: 6.8, maxW: W / 2 - 3 });
  });

  const stH = 9;
  yb -= stH;
  doc.setDrawColor(...RED);
  doc.setLineWidth(0.5);
  doc.rect(x0, yb, W, stH);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(6.4);
  doc.setTextColor(...RED);
  doc.text(STAMP, x0 + W / 2, yb + 5.4, { align: 'center' });

  // Revision table.
  const rh = 16;
  yb -= rh;
  box(doc, x0, yb, x1, yb + rh);
  const cols = [x0, x0 + 8, x0 + 27, x0 + 62, x1];
  doc.setLineWidth(0.13);
  cols.slice(1, -1).forEach((c) => doc.line(c, yb, c, yb + rh));
  [1, 2, 3].forEach((r) => doc.line(x0, yb + (r * rh) / 4, x1, yb + (r * rh) / 4));
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(5.4);
  doc.setTextColor(...LABEL);
  ['REV', 'DATE', 'DESCRIPTION', 'BY'].forEach((t, i) => doc.text(t, cols[i] + 1.2, yb + 2.9));
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6.2);
  doc.setTextColor(...PEN.ink);
  [sheet.rev || 'A', date, clean(tb.issuePurpose) || REV_TEXT, 'GI'].forEach((t, i) => doc.text(fit(doc, clean(t), cols[i + 1] - cols[i] - 2), cols[i] + 1.2, yb + (rh / 4) * 1.5 + 1.2));

  // Data and notes in the space between.
  const top = y;
  const bot = yb;
  let cy = top;
  const kv = sheet.kv || [];
  if (kv.length) {
    const h = 5 + kv.length * 3.7 + 1.5;
    box(doc, x0, cy, x1, cy + h);
    label(doc, sheet.kvTitle || 'DATA', x0 + 2, cy + 3.2);
    doc.setFontSize(6.6);
    kv.forEach(([k, v], i) => {
      const ry = cy + 7.4 + i * 3.7;
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(...LABEL);
      doc.text(fit(doc, clean(k), 30), x0 + 2, ry);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(...PEN.ink);
      doc.text(fit(doc, clean(v), W - 36), x0 + 34, ry);
    });
    cy += h;
  }
  const notes = sheet.notes || [];
  if (notes.length && bot - cy > 12) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6);
    const lines = [];
    notes.forEach((n, i) => { wrap(doc, `${i + 1}. ${n}`, W - 5).forEach((l, j) => lines.push(j ? `   ${l}` : l)); lines.push(null); });
    const h = Math.min(bot - cy, 7 + lines.reduce((a, l) => a + (l === null ? 0.8 : 2.7), 0) + 1);
    box(doc, x0, cy, x1, cy + h);
    label(doc, 'NOTES', x0 + 2, cy + 3.2);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6);
    doc.setTextColor(...PEN.ink);
    let ny = cy + 7;
    for (const l of lines) {
      if (l === null) { ny += 0.8; continue; }
      if (ny > cy + h - 0.8) break;
      doc.text(l, x0 + 2, ny);
      ny += 2.7;
    }
    cy += h;
  }
  // Blocks (legend, boundary schedule): each { title, h, draw(doc, x, y, w) }, stacked while they fit.
  for (const blk of sheet.blocks || []) {
    if (cy + blk.h > bot) break;
    box(doc, x0, cy, x1, cy + blk.h);
    label(doc, blk.title, x0 + 2, cy + 3.2);
    blk.draw(doc, x0, cy + 4, W);
    cy += blk.h;
  }
}

/** The concept statement along the foot of the drawing area (one line, so it reads as one string). */
export function drawConceptNote(doc) {
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(6.6);
  doc.setTextColor(...PEN.ink);
  doc.text(CONCEPT_NOTE, AREA.x0 + 3, AREA.y1 - 2.2);
}

/** Faint diagonal watermark across the drawing area. */
export function drawWatermark(doc, text) {
  const raw = doc.raw || doc;
  const cx = (AREA.x0 + AREA.x1) / 2;
  const cy = (AREA.y0 + AREA.y1) / 2;
  const diag = Math.hypot(AREA.x1 - AREA.x0, AREA.y1 - AREA.y0);
  const ang = (Math.atan2(AREA.y1 - AREA.y0, AREA.x1 - AREA.x0) * 180) / Math.PI;
  const t = clean(text);
  raw.saveGraphicsState();
  raw.setGState(new raw.GState({ opacity: 0.09 }));
  raw.setFont('helvetica', 'bold');
  raw.setFontSize(100);
  const w100 = raw.getTextWidth(t);
  const size = Math.min(46, (100 * diag * 0.72) / w100);
  raw.setFontSize(size);
  const w = raw.getTextWidth(t);
  const a = (ang * Math.PI) / 180;
  raw.setTextColor(60, 66, 76);
  raw.text(t, cx - (w / 2) * Math.cos(a), cy + (w / 2) * Math.sin(a), { angle: ang });
  raw.restoreGraphicsState();
}
