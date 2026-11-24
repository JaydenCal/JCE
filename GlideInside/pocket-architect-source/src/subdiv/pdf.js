// Subdivision check: the one page "Subdivision snapshot" PDF, A4 landscape. A real aerial with the rough layout, the facts, the one line caveat and the
// JCE Infrastructure contact details. Built in the browser with jsPDF (the same loader the plan set uses). No design numbers appear on it.

import { loadJsPDF } from '../premium/export-client.js';
import { drawCheck } from './render.js';
import { CAVEAT, DONE_LINE } from './lead.js';
import { rangeText } from './rules.js';
import { KIND_TEXT } from './layout.js';

export const CONTACT = Object.freeze({
  company: 'JCE Infrastructure Pty Ltd', abn: '29 699 165 663', person: 'Jayden Callen', phone: '0477 207 027', email: 'enquiries@jceinfrastructure.com.au',
});
const GOLD = [199, 162, 86];
const INK = [26, 32, 44];
const MUTE = [96, 104, 118];

export const ddmmyyyy = (d = new Date()) => `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
export const fileNameFor = (address) => `Subdivision-snapshot-${String(address || 'site').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'site'}.pdf`;

/** The plan image for the page: a JPEG data URL at about 300 dpi for its printed size. */
export function planImage({ lot, bitmap, layout, widthMm = 192, heightMm = 150, pxPerMm = 12, attribution = '' }) {
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(widthMm * pxPerMm);
  canvas.height = Math.round(heightMm * pxPerMm);
  drawCheck(canvas.getContext('2d'), { lot, bitmap, layout, width: canvas.width, height: canvas.height, showLayout: true, attribution });
  return canvas.toDataURL('image/jpeg', 0.92);
}

/**
 * buildSnapshotPdf({ lot, bitmap, result, date }) -> Blob
 *   result { rules, low, high, layout }  (indicativeYield + minLotFor)
 */
export async function buildSnapshotPdf({ lot, bitmap, result, date = new Date() }) {
  const JsPDF = await loadJsPDF();
  const doc = new JsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const W = 297;
  const H = 210;
  const M = 10;
  const { rules, low, high, layout } = result;
  const aerialAttr = lot.aerial?.attribution || lot.provenance?.aerial?.attribution || '';
  const att = [lot.provenance?.lot?.attribution, aerialAttr].filter(Boolean).join('  ');

  // header
  doc.setFillColor(...INK); doc.rect(0, 0, W, 17, 'F');
  doc.setFillColor(...GOLD); doc.rect(0, 17, W, 1.2, 'F');
  doc.setTextColor(255, 255, 255); doc.setFont('helvetica', 'bold'); doc.setFontSize(15);
  doc.text('SUBDIVISION SNAPSHOT', M, 11.2);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); doc.setTextColor(...GOLD);
  doc.text('JCE INFRASTRUCTURE', W - M, 8, { align: 'right' });
  doc.setTextColor(255, 255, 255); doc.setFontSize(8);
  doc.text(`Concept layout  |  ${ddmmyyyy(date)}`, W - M, 13, { align: 'right' });

  // plan
  const px = M; const py = 23; const pw = 192; const ph = 150;
  const img = planImage({ lot, bitmap, layout: layout.kind === 'none' ? null : layout, widthMm: pw, heightMm: ph, attribution: att.slice(0, 190) });
  doc.addImage(img, 'JPEG', px, py, pw, ph, undefined, 'FAST');
  doc.setDrawColor(...INK); doc.setLineWidth(0.3); doc.rect(px, py, pw, ph);

  // right column
  const cx = px + pw + 7; const cw = W - M - cx;
  let y = py + 1;
  doc.setTextColor(...INK); doc.setFont('helvetica', 'bold'); doc.setFontSize(11.5);
  const addr = doc.splitTextToSize(lot.address || 'Address not given', cw);
  doc.text(addr.slice(0, 3), cx, y + 4);
  y += 4 + 5.2 * Math.min(3, addr.length);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(...MUTE);
  doc.text([lot.lotNumber ? `Lot ${lot.lotNumber}` : null, lot.planLabel].filter(Boolean).join('   '), cx, y);
  y += 6;

  const fact = (label, value, sub = '') => {
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7.6); doc.setTextColor(...MUTE); doc.text(label.toUpperCase(), cx, y);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(10.5); doc.setTextColor(...INK); doc.text(String(value), cx, y + 4.8);
    y += 9.2;
    if (sub) {
      doc.setFont('helvetica', 'normal'); doc.setFontSize(7.4); doc.setTextColor(...MUTE);
      const l = doc.splitTextToSize(sub, cw);
      doc.text(l, cx, y - 0.6); y += 3.3 * l.length;
    }
  };
  fact('Lot area', `${Math.round(lot.areaM2).toLocaleString('en-AU')} sq m`);
  fact('Zone', [rules.zoneCode, rules.zoneName].filter(Boolean).join('  ') || 'Not found');
  fact('Minimum lot size used', `${rules.minM2.toLocaleString('en-AU')} sq m`, rules.basis === 'default' ? 'Default for this zone, not a council figure.' : rules.basis === 'user' ? 'Entered by the person preparing this snapshot.' : 'From the council planning controls.');

  // the answer
  doc.setFillColor(...INK); doc.roundedRect(cx, y, cw, 25, 1.5, 1.5, 'F');
  doc.setFont('helvetica', 'normal'); doc.setFontSize(7.6); doc.setTextColor(...GOLD); doc.text('INDICATIVE LOT COUNT', cx + 4, y + 6);
  doc.setFont('helvetica', 'bold'); doc.setFontSize(high >= 2 ? 15 : 11); doc.setTextColor(255, 255, 255);
  const rt = rangeText(low, high);
  doc.text(doc.splitTextToSize(rt, cw - 8), cx + 4, y + 14);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(7.6); doc.setTextColor(220, 224, 232);
  doc.text(doc.splitTextToSize(KIND_TEXT[layout.kind] || '', cw - 8).slice(0, 2), cx + 4, y + 20);
  y += 30;

  // proposed lots
  if (layout.lots.length) {
    doc.setFont('helvetica', 'bold'); doc.setFontSize(7.6); doc.setTextColor(...MUTE); doc.text('PROPOSED LOTS (INDICATIVE AREAS)', cx, y); y += 3.6;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8.2); doc.setTextColor(...INK);
    const shown = layout.lots.slice(0, 10);
    shown.forEach((l) => {
      doc.text(`PROPOSED LOT ${l.n}`, cx, y + 2.6);
      doc.text(`${l.areaM2.toLocaleString('en-AU')} sq m`, cx + cw, y + 2.6, { align: 'right' });
      doc.setDrawColor(225, 228, 234); doc.setLineWidth(0.15); doc.line(cx, y + 3.9, cx + cw, y + 3.9);
      y += 4.5;
    });
    if (layout.lots.length > shown.length) { doc.setTextColor(...MUTE); doc.text(`and ${layout.lots.length - shown.length} more`, cx, y + 2.6); y += 4.5; }
  }

  // next step
  doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.setTextColor(...INK);
  const next = doc.splitTextToSize(DONE_LINE, cw);
  const ny = Math.max(y + 3, py + ph - 8 - next.length * 3.7);
  doc.setFillColor(248, 243, 230); doc.rect(cx - 1.5, ny - 4.2, cw + 3, next.length * 3.7 + 6, 'F');
  doc.text(next, cx, ny);

  // caveat and footer
  const fy = py + ph + 5;
  doc.setFont('helvetica', 'italic'); doc.setFontSize(8.6); doc.setTextColor(...INK);
  doc.text(CAVEAT, M, fy + 1);
  doc.setFillColor(...GOLD); doc.rect(M, fy + 5, W - 2 * M, 0.5, 'F');
  doc.setFont('helvetica', 'bold'); doc.setFontSize(9.5); doc.setTextColor(...INK);
  doc.text(`${CONTACT.company}`, M, fy + 11.5);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
  doc.text(`${CONTACT.person}   ${CONTACT.phone}   ${CONTACT.email}`, M, fy + 16.5);
  doc.setFontSize(7); doc.setTextColor(...MUTE);
  doc.text(`ABN ${CONTACT.abn}. Civil, hydraulics and infrastructure engineering. Subdivision roads, stormwater and services.`, W - M, fy + 11.5, { align: 'right' });
  doc.text('Concept layout for discussion. Not a survey and not a development application.', W - M, fy + 16.5, { align: 'right' });
  return doc.output('blob');
}

/** Save a Blob as a file download. */
export function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; a.rel = 'noopener';
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
