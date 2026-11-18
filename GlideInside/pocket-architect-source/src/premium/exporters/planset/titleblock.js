// Builder title block for the plan set and the engineering plans. A builder (or a client of that builder) exports sheets that carry THAT builder's
// identity: logo, name, licence, ABN, address, phone, email and website (whatever they filled in), with a small "Powered by Glide Inside" mark
// in the bottom corner. Glide Inside and JCE are never the main identity here, and the details come only from the exporting login's own org
// (window.__ps.builder / the `builder` option), so one builder's details cannot reach another builder's sheets.
// Public (portal free) users never reach this module: frame.js keeps the Glide Inside block when no builder is given.

import { clean, PEN, ink, wrap } from '../eng/kit.js';
import { imageInfo, placeImage } from '../pdf.js';
import { LOGO_PNG } from '../../brand/logo.js';
import { cleanDetails } from '../../../portal/brand-details.js';

export const POWERED_BY = 'Powered by Glide Inside';
/** Height of the brand cell in the plan set strip (the public one is 41 mm). */
export const BUILDER_BH = 48;
/** Height of the extra row at the foot of the strip that holds the Powered by mark. */
export const POWERED_H = 7;
const GREY = [95, 99, 106];

/**
 * Normalises what the portal publishes (app.builder) or a caller passes: { name, logo (data URL), details, client: { name, lotAddress } }.
 * A bare string is a name. Returns null when there is no builder at all (public user).
 */
export function builderOf(input) {
  if (!input) return null;
  const b = typeof input === 'string' ? { name: input } : input;
  const name = clean(b.name);
  const logo = b.logo ? imageInfo(b.logo) : null;
  const details = cleanDetails(b.details);
  if (!name && !(logo && logo.w > 0 && logo.h > 0) && !Object.values(details).some(Boolean)) return null;
  return { name, logo: logo && logo.w > 0 && logo.h > 0 ? logo : null, details, client: { name: clean(b.client?.name), lotAddress: clean(b.client?.lotAddress) } };
}

/** The detail lines in print order, each { text } already prefixed (Licence, ABN, address, Ph, email, web). Address wraps, so it comes as a raw string. */
export function detailRows(b) {
  const d = b.details || {};
  const rows = [];
  if (d.licence) rows.push(`Builder licence ${d.licence}`);
  if (d.abn) rows.push(`ABN ${d.abn}`);
  if (d.address) rows.push({ wrap: d.address });
  if (d.phone) rows.push(`Ph ${d.phone}`);
  if (d.email) rows.push(d.email);
  if (d.website) rows.push(d.website);
  return rows;
}

const cut = (doc, text, width) => {
  let s = clean(text);
  if (doc.getTextWidth(s) <= width) return s;
  while (s.length > 1 && doc.getTextWidth(`${s}...`) > width) s = s.slice(0, -1);
  return `${s}...`;
};

/** Short initials for the "by" column of the revision table. */
export const initialsOf = (name) => clean(name).split(/\s+/).filter((w) => /^[A-Za-z0-9]/.test(w) && !/^(pty|ltd|the|and|trading|as)$/i.test(w)).map((w) => w[0].toUpperCase()).join('').slice(0, 3);

/**
 * Brand cell: logo (scaled to fit), name, then the detail lines. box = { x, y, w, h } in mm; everything is kept inside the box. The logo takes
 * whatever height the text leaves (at most 30% of the box), so a long address or a six line block shrinks the logo, never clips text.
 */
export function drawBuilderBrand(doc, b, box) {
  const padX = 3;
  const tw = box.w - 2 * padX;
  const lead = 2.7;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(5.8);
  const lines = [];
  for (const r of detailRows(b)) {
    if (typeof r === 'string') lines.push(cut(doc, r, tw));
    else wrap(doc, r.wrap, tw).slice(0, 2).forEach((l) => lines.push(l));
  }
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.4);
  const nameLines = b.name ? wrap(doc, b.name, tw).slice(0, 2) : [];
  const nameH = nameLines.length * 3.6;
  const textH = nameH + (lines.length ? 1.2 + lines.length * lead : 0);
  const avail = box.h - 4 - textH - 1.5;
  const logoH = b.logo ? Math.max(4, Math.min(avail, box.h * 0.3)) : 0;
  let y = box.y + 2;
  if (b.logo) {
    placeImage(doc, b.logo, { x: box.x + padX, y, w: tw, h: logoH });
    y += logoH + 1.5;
  }
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.4);
  ink(doc, PEN.ink);
  nameLines.forEach((l) => { y += 3.1; doc.text(l, box.x + padX, y); y += 0.5; });
  if (lines.length) {
    y += 0.4;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(5.8);
    doc.setTextColor(...GREY);
    lines.forEach((l) => { y += lead; doc.text(l, box.x + padX, y); });
  }
}

/**
 * "Powered by Glide Inside": the small Glide Inside G mark (cropped from the wordmark PNG with a clip) then the words, right aligned in the box
 * (the bottom corner of the title block). The words are real text, so the credit can be searched and copied.
 */
export function drawPoweredBy(doc, box) {
  const logo = imageInfo(LOGO_PNG);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6.2);
  doc.setTextColor(...GREY);
  const right = box.x + box.w - 2.5;
  const cy = box.y + box.h / 2;
  doc.text(POWERED_BY, right, cy + 0.9, { align: 'right' });
  if (!logo) return;
  const iconW = 4;
  const fullW = (iconW * logo.w) / 170; // the G occupies the first 170 px of the 1586 px wordmark
  const fullH = fullW / (logo.w / logo.h);
  const x = right - doc.getTextWidth(POWERED_BY) - 1.6 - iconW;
  try {
    doc.saveGraphicsState();
    doc.rect(x, cy - fullH / 2, iconW, fullH, null);
    doc.clip();
    doc.discardPath();
    doc.addImage(logo.url, logo.fmt, x, cy - fullH / 2, fullW, fullH);
    doc.restoreGraphicsState();
  } catch { /* the words alone still credit Glide Inside */ }
}
