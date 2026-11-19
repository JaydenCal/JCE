// One page siting summary (layout 'summary' of toSitingReport): the builder's branding, the site plan, the chosen design, the key setbacks,
// the mapped constraints, the indicative site costs and the next steps on a single A4 page. Concept only and indicative throughout.
// Called by siting-report.js with its drawing helpers (kit), so the two layouts look the same. Dates DD/MM/YYYY. No dashes in text.

import { PEN, clean } from './eng/kit.js';
import { placeImage } from './pdf.js';
import { sizeLabel } from '../../portal/house-stats.js';
import { fmtArea } from './eng/area.js';
import { fmtAud } from '../site-costs/estimate.js';
import { constraintFacts, CHECK_WITH_COUNCIL } from './siting-facts.js';
import { GST_NOTE, gstOf } from '../site-costs/gst.js';
import { ddmmyyyy } from './eng/brand.js';

export const SUMMARY_NOTE = 'Concept only. Indicative, prepared from public lot and elevation data and the design as drawn. Not a survey, not a development application and not a quote. Setbacks, levels, overlays and costs are for the council and suitably qualified people to confirm.';
export const SUMMARY_STEPS = [
  'Confirm the lot, boundaries and council controls with the council and a registered surveyor.',
  'Confirm the ground with a geotechnical report (site classification).',
  'Review this siting and the indicative site costs together and agree the design.',
  'Engineering is prepared by a registered engineer for the approval pathway.',
];
const M = 14;
const PAGE_W = 210;
const CW = PAGE_W - 2 * M;

/** Builds the page. kit = { text, para, heading, band, table, footer, drawSitingPlan, setbackRows } from siting-report.js. */
export function buildSitingSummary({ doc, brand, project, kit, facts, stats, areas, est, img, contact, dateText, title, options = {} }) {
  const { text, para, band, table, footer, drawSitingPlan, setbackRows } = kit;
  const lot = project.site?.lot || null;
  band(doc, brand, 'SITING SUMMARY');
  let y = 30;
  text(doc, title, M, y, { size: 17, bold: true, colour: brand.primary, max: CW });
  y += 6;
  if (facts.address) { text(doc, facts.address, M, y, { size: 10, max: CW }); y += 4.6; }
  text(doc, [facts.lotDp, facts.areaM2 ? fmtArea(facts.areaM2) : '', facts.frontageM ? `${facts.frontageM} m frontage` : '', facts.zone ? `Zone ${facts.zone}` : ''].filter(Boolean).join('   |   '), M, y, { size: 8.2, colour: PEN.grey, max: CW });
  y += 4;

  // Site plan (left) and the chosen design (right)
  const planW = 112; const planH = 92; const sideX = M + planW + 5; const sideW = CW - planW - 5;
  doc.setFillColor(...brand.soft);
  doc.rect(M, y, planW, planH, 'F');
  if (lot) drawSitingPlan(doc, project, { x0: M, y0: y, x1: M + planW, y1: y + planH }, brand);
  else text(doc, 'No lot has been loaded for this design.', M + planW / 2, y + planH / 2, { size: 9, colour: PEN.grey, align: 'center' });
  text(doc, 'Indicative siting plan', M + 1.5, y + planH + 3.4, { size: 6.8, colour: PEN.grey });
  let sy = y;
  if (img && placeImage(doc, img, { x: sideX, y: sy, w: sideW, h: 38 })) { text(doc, 'Indicative 3D view', sideX, sy + 41, { size: 6.8, colour: PEN.grey }); sy += 44; } else sy += 1;
  text(doc, 'CHOSEN DESIGN', sideX, sy + 3, { size: 8, bold: true, colour: brand.primary });
  const rows = [['Design', title]];
  if (stats) rows.push(['Home', `${stats.bedrooms} bed, ${stats.bathrooms} bath, ${stats.garage ? `${stats.garage} car` : 'no garage'}`], ['Size', sizeLabel(stats)]);
  if (areas) rows.push(['Living area', `${areas.living} m²`]);
  sy = table(doc, brand, sideX, sy + 5, [{ w: 20, head: 'ITEM' }, { w: sideW - 20, head: 'DETAIL' }], rows, { size: 7.4, lead: 3.3, pad: 1.2 });
  y += planH + 7;

  // Key setbacks
  text(doc, 'KEY SETBACKS (INDICATIVE)', M, y, { size: 8, bold: true, colour: brand.primary });
  const sb = lot ? setbackRows(project).slice(0, 5) : [];
  y = sb.length
    ? table(doc, brand, M, y + 1.6, [{ w: 36, head: 'BOUNDARY' }, { w: 26, head: 'SHOWN (m)', align: 'right' }, { w: 34, head: 'INDICATIVE (m)', align: 'right' }, { w: CW - 96, head: 'RESULT' }], sb, { size: 7.4, lead: 3.3, pad: 1.1 })
    : para(doc, lot?.setbacks ? 'The house is not placed on the lot yet, so setbacks are not shown.' : 'Council setbacks are not loaded for this lot. The council is to confirm the controls.', M, y + 5, CW, { size: 7.6 }) - 1.5;
  y += 3.6;

  // Constraints (one line each) and costs side by side
  const colW = (CW - 5) / 2;
  text(doc, 'MAPPED CONSTRAINTS (INDICATIVE)', M, y, { size: 8, bold: true, colour: brand.primary });
  const cf = constraintFacts(lot);
  let cy = y + 1.6;
  cy = table(doc, brand, M, cy, [{ w: 30, head: 'LAYER' }, { w: colW - 30, head: 'ANSWER' }], cf.map((r) => [r.title, r.answer === 'Yes' ? 'Mapped over the lot' : r.answer === 'No mapped' ? 'None mapped' : 'Check the council map']), { size: 7.2, lead: 3.2, pad: 1 });
  text(doc, 'INDICATIVE SITE COSTS', M + colW + 5, y, { size: 8, bold: true, colour: brand.primary });
  let ky = y + 1.6;
  if (est?.ok) {
    const g = gstOf(est.total.likely);
    ky = table(doc, brand, M + colW + 5, ky, [{ w: colW - 30, head: 'ITEM' }, { w: 30, head: 'AMOUNT', align: 'right' }], [['Likely total, GST excluded', fmtAud(est.total.likely)], ['Range', `${fmtAud(est.total.low)} to ${fmtAud(est.total.high)}`], ['GST (10 percent)', fmtAud(g.gst)], { cells: ['Likely total, GST included', fmtAud(g.incl)], bold: true, fill: brand.soft }], { size: 7.2, lead: 3.2, pad: 1 });
  } else ky = para(doc, 'A site cost estimate needs a lot on the design.', M + colW + 5, ky + 4, colW, { size: 7.4 });
  y = Math.max(cy, ky) + 1;
  y = para(doc, `Concept only. ${CHECK_WITH_COUNCIL}${est?.ok ? ` ${GST_NOTE}` : ''}`, M, y + 1.6, CW, { size: 6.6, colour: PEN.grey, lead: 3 }) + 2.4;

  // Next steps and contact
  text(doc, 'NEXT STEPS', M, y, { size: 8, bold: true, colour: brand.primary });
  y += 4.2;
  SUMMARY_STEPS.forEach((s, i) => { y = para(doc, `${i + 1}.  ${s}`, M, y, CW * 0.62, { size: 7.6, lead: 3.5 }) + 0.6; });
  const cx = M + CW * 0.66; let cyy = y - SUMMARY_STEPS.length * 4.1;
  text(doc, brand.own ? brand.name : 'Glide Inside', cx, cyy, { size: 9, bold: true, colour: brand.primary, max: CW * 0.34 });
  const cl = [contact?.phone ? `Phone: ${contact.phone}` : '', contact?.email ? `Email: ${contact.email}` : '', contact?.website ? contact.website : '', contact?.licence ? `Licence: ${contact.licence}` : '', contact?.abn ? `ABN: ${contact.abn}` : ''].filter(Boolean);
  if (!cl.length) cl.push(brand.own ? 'Contact your builder using the details you were given.' : 'glideinside.com.au');
  cl.forEach((l) => { cyy += 3.9; text(doc, l, cx, cyy, { size: 7.6, max: CW * 0.34 }); });
  y = Math.max(y, cyy) + 2;
  footer(doc, brand, 1, 1, dateText);
  return { y, title, date: dateText || ddmmyyyy(new Date()) };
}
