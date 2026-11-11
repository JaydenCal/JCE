// Sheet frame for the engineering style plan set: double border, zone grid, and a full width title block with a footer band that
// carries the concept statement and the data attribution. Design units are millimetres on the A3 sheet (A1 is scaledDoc k = 2).

import { clean, PEN, fit, ink, wrap } from './kit.js';
import { placeImage } from '../pdf.js';
import { DISCLAIMER, ddmmyyyy, normDate, drawingNo, attribution } from './brand.js';

export const SW = 420;
export const SH = 297;
export const M = 10; // inner border
export const OUT = 4; // outer border
export const TB_TOP = 238;
export const TB_FOOT = 279; // the footer band is below this line
export const TB_BOTTOM = SH - M;
/** Usable drawing area inside the border and above the title block. */
export const BODY = { x0: M + 4, y0: M + 4, x1: SW - M - 4, y1: TB_TOP - 3 };

function cell(doc, x, y, w, h, label, value, { size = 9, bold = true, align = 'left', fill = null } = {}) {
  if (fill) doc.setFillColor(...fill);
  doc.setLineWidth(0.2);
  ink(doc, PEN.ink);
  doc.rect(x, y, w, h, fill ? 'FD' : 'S');
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(5.6);
  ink(doc, PEN.grey);
  if (label) doc.text(clean(label), x + 2, y + 2.9);
  if (value) {
    doc.setFont('helvetica', bold ? 'bold' : 'normal');
    doc.setFontSize(size);
    ink(doc, PEN.ink);
    const t = fit(doc, clean(value), w - 2.8);
    if (align === 'center') doc.text(t, x + w / 2, y + h - 2, { align: 'center' });
    else doc.text(t, x + 2, y + h - 2);
  }
}

function zoneGrid(doc) {
  ink(doc, PEN.ink);
  doc.setLineWidth(0.15);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(5.6);
  const w = SW - 2 * M;
  const h = SH - 2 * M;
  for (let i = 0; i < 8; i++) {
    const x0 = M + (w * i) / 8;
    if (i > 0) { doc.line(x0, OUT, x0, M); doc.line(x0, SH - M, x0, SH - OUT); }
    doc.text(String(i + 1), x0 + w / 16, OUT + 3.6, { align: 'center' });
    doc.text(String(i + 1), x0 + w / 16, SH - OUT - 1.2, { align: 'center' });
  }
  for (let i = 0; i < 6; i++) {
    const y0 = M + (h * i) / 6;
    if (i > 0) { doc.line(OUT, y0, M, y0); doc.line(SW - M, y0, SW - OUT, y0); }
    const L = String.fromCharCode(65 + i);
    doc.text(L, OUT + 3, y0 + h / 12 + 1.1, { align: 'center' });
    doc.text(L, SW - OUT - 3, y0 + h / 12 + 1.1, { align: 'center' });
  }
}

/**
 * Draw the border, grid and title block. ctx: { project, brand, date, total, paper, lot }.
 * sheet: { n (1 based), title, scaleLabel }. Returns the drawing number.
 */
export function drawFrame(doc, ctx, sheet) {
  const { project, brand, date, total, paper = 'A3' } = ctx;
  const tb = project.titleBlock || {};
  const no = drawingNo(project, sheet.n);
  ink(doc, PEN.ink);
  doc.setLineWidth(0.18);
  doc.rect(OUT, OUT, SW - 2 * OUT, SH - 2 * OUT);
  doc.setLineWidth(0.6);
  doc.rect(M, M, SW - 2 * M, SH - 2 * M);
  zoneGrid(doc);

  const x0 = M;
  const y0 = TB_TOP;
  const h = TB_FOOT - TB_TOP;
  doc.setLineWidth(0.5);
  doc.rect(x0, y0, SW - 2 * M, TB_BOTTOM - TB_TOP);
  doc.setLineWidth(0.2);
  doc.line(x0, TB_FOOT, SW - M, TB_FOOT);

  // Panel 1: brand. Builder logins lead with the builder; everyone else with Glide Inside.
  const w1 = 52;
  doc.setLineWidth(0.3);
  doc.rect(x0, y0, w1, h);
  const place = (img, box) => img && placeImage(doc, img, box);
  if (brand.mode === 'builder') {
    if (brand.logo) place(brand.logo, { x: x0 + 4, y: y0 + 3, w: w1 - 8, h: h * 0.4 });
    if (brand.name) {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(brand.logo ? 9 : 11.5);
      ink(doc, PEN.ink);
      const lines = wrap(doc, brand.name, w1 - 6).slice(0, 2);
      lines.forEach((l, i) => doc.text(l, x0 + w1 / 2, y0 + (brand.logo ? h * 0.4 + 8 : h * 0.3) + i * 4, { align: 'center' }));
    }
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(5.8);
    ink(doc, PEN.grey);
    doc.text(clean(brand.credit), x0 + w1 / 2, y0 + h - 9.2, { align: 'center' });
    if (brand.glide) place(brand.glide, { x: x0 + w1 / 2 - 10, y: y0 + h - 8, w: 20, h: 20 / (brand.glide.w / brand.glide.h) });
  } else {
    if (brand.logo) {
      // The user's own logo sits above the Glide Inside mark.
      place(brand.logo, { x: x0 + 5, y: y0 + 2.5, w: w1 - 10, h: h * 0.33 });
    }
    if (brand.glide) {
      const lw = w1 - 12;
      place(brand.glide, { x: x0 + 6, y: y0 + (brand.logo ? h * 0.46 : h * 0.3), w: lw, h: lw / (brand.glide.w / brand.glide.h) });
    }
    if (brand.name) {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7);
      ink(doc, PEN.grey);
      wrap(doc, `Prepared by ${brand.name}`, w1 - 6).slice(0, 2).forEach((l, i) => doc.text(l, x0 + w1 / 2, y0 + h - 6.5 + i * 3.4, { align: 'center' }));
    }
  }

  // Panel 2: project, address, client and drawing title.
  const x2 = x0 + w1;
  const w2 = 112;
  const rh = h / 3;
  cell(doc, x2, y0, w2, rh * 1.6, 'PROJECT', '', {});
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  ink(doc, PEN.ink);
  const pname = clean(tb.projectName || project.name || 'Untitled design').toUpperCase();
  doc.text(fit(doc, pname, w2 - 5), x2 + 2.6, y0 + 9.2);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  const addr = clean(tb.address || project.site?.lot?.address || '');
  const lotdp = clean(tb.lotDp || [project.site?.lot?.lotLabel].filter(Boolean).join(' '));
  if (addr) doc.text(fit(doc, addr.toUpperCase(), w2 - 5), x2 + 2.6, y0 + 14.6);
  if (lotdp) doc.text(fit(doc, lotdp.toUpperCase(), w2 - 5), x2 + 2.6, y0 + 19.2);
  const rest = (h - rh * 1.6) / 2;
  cell(doc, x2, y0 + rh * 1.6, w2, rest, 'CLIENT', tb.client, { size: 9.5 });
  cell(doc, x2, y0 + rh * 1.6 + rest, w2, rest, 'DRAWING TITLE', sheet.title, { size: 11 });

  // Panel 3: revision table.
  const x3 = x2 + w2;
  const cols = [['REV', 11], ['DATE', 19], ['DESCRIPTION', 40], ['DRN', 11], ['CHK', 11], ['APP', 11]];
  const w3 = cols.reduce((a, c) => a + c[1], 0);
  const rowH = h / 6;
  const dateStr = clean(tb.date) ? normDate(tb.date) : ddmmyyyy(date);
  // Initials come only from the fields the user filled in. Nothing is invented: an unchecked sheet says so.
  const row = [clean(tb.revision) || 'A', dateStr, clean(tb.issuePurpose) || 'Concept', clean(tb.drawnBy), clean(tb.checkedBy), clean(tb.approvedBy)];
  const checked = !!(clean(tb.checkedBy) || clean(tb.approvedBy));
  for (let r = 0; r < 6; r++) {
    let cx = x3;
    cols.forEach(([name, w], c) => {
      doc.setLineWidth(0.2);
      ink(doc, PEN.ink);
      if (r === 0) doc.setFillColor(...PEN.band);
      doc.rect(cx, y0 + r * rowH, w, rowH, r === 0 ? 'FD' : 'S');
      doc.setFont('helvetica', r === 0 ? 'bold' : 'normal');
      doc.setFontSize(r === 0 ? 5.8 : 8);
      ink(doc, r === 0 ? PEN.grey : PEN.ink);
      if (r === 0) doc.text(name, cx + 1.4, y0 + rowH - 1.8);
      else if (r === 1 && row[c]) doc.text(fit(doc, row[c], w - 2), cx + 1.2, y0 + rowH * 2 - 1.8);
      cx += w;
    });
  }

  if (!checked) {
    // The last row of the revision table carries the note across its cells.
    doc.setFillColor(255, 255, 255);
    doc.rect(x3 + 0.2, y0 + rowH * 5 + 0.2, w3 - 0.4, rowH - 0.4, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7);
    ink(doc, PEN.grey);
    doc.text('NOT CHECKED. NOT APPROVED.', x3 + 2.4, y0 + rowH * 6 - 2);
  }

  // Panel 4: drawing number, revision, status and sheet details.
  const x4 = x3 + w3;
  const w4 = SW - M - x4;
  const hA = 19;
  const hB = (h - hA) / 2;
  cell(doc, x4, y0, w4 - 62, hA, 'DRAWING NUMBER', no, { size: 15 });
  cell(doc, x4 + w4 - 62, y0, 24, hA, 'REV', tb.revision || 'A', { size: 17, align: 'center' });
  cell(doc, x4 + w4 - 38, y0, 38, hA, 'STATUS', clean(tb.issuePurpose || 'Concept').toUpperCase(), { size: 10.5 });
  const b = w4 / 5;
  [['DATE', dateStr], ['DRAWN', tb.drawnBy], ['CHECKED', tb.checkedBy], ['APPROVED', tb.approvedBy], ['JOB NO.', tb.jobNumber]]
    .forEach(([l, val], i) => cell(doc, x4 + i * b, y0 + hA, b, hB, l, val, { size: i === 0 ? 8 : 9 }));
  const c3 = w4 / 3;
  cell(doc, x4, y0 + hA + hB, c3, hB, 'SCALE', sheet.scaleLabel || 'NTS', { size: 9.5 });
  cell(doc, x4 + c3, y0 + hA + hB, c3, hB, 'SHEET', `${sheet.n} OF ${total}`, { size: 9.5 });
  cell(doc, x4 + 2 * c3, y0 + hA + hB, c3, hB, 'SIZE', paper, { size: 9.5 });

  // Footer band: concept statement, then attribution.
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(6.6);
  ink(doc, PEN.tag);
  doc.text(fit(doc, DISCLAIMER, SW - 2 * M - 4), x0 + 2, TB_FOOT + 3.4);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(5.6);
  ink(doc, PEN.grey);
  const credit = `${attribution(ctx.lot, { aerial: !!ctx.hasAerial })} ${ctx.extraCredit || ''}`.trim();
  doc.text(fit(doc, credit, SW - 2 * M - 4), x0 + 2, TB_FOOT + 6.7);
  return no;
}
