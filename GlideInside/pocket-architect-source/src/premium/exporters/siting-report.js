// One click siting report and proposal: A4 portrait, 2 to 4 pages, branded with the builder's logo and colours when the portal supplies
// them (else Glide Inside). Pages: 1 cover (3D render of the home on the lot, key figures), 2 site summary and siting plan with setbacks and
// dimensions, 3 home design summary and the indicative site cost estimate, 4 next steps and contact.
//   toSitingReport(project, { jsPDF, image, builder, logo, settings, estimate, contact, date }) -> Uint8Array (with a non enumerable `layout`)
// Wording is indicative throughout. never a compliance claim (clean() removes it). Dates DD/MM/YYYY. No dashes in the text. Node compatible.

import * as G from '../../model/geometry.js';
import { buildingRings, buildingHull, clearances, boundaryDims, roadReserve, deriveDriveway, titleLotDp, lotLabelLines } from '../../site/lotplan.js';
import { houseStats, areaBreakdown, sizeLabel } from '../../portal/house-stats.js';
import { schemeById, effectiveSchemeId, schemeLine } from '../../model/colour-schemes.js';
import { BRAND, LOGO_PNG } from '../brand/logo.js';
import { imageInfo, northArrow, placeImage, polygon, polyline, ink } from './pdf.js';
import { PEN, clean, wrap, hatchSegments, clipPolygon, withSuperscripts } from './eng/kit.js';
import { OVERLAY_STYLE } from '../../site/overlays.js';
import { ddmmyyyy, projectTitle, attribution } from './eng/brand.js';
import { siteAreaOf, fmtArea } from './eng/area.js';
import { estimateSiteCosts, frontageM, fmtAud } from '../site-costs/estimate.js';
import { ENGINEERING_SERVICES } from '../engineering-services.js';
import { NOT_FOUND } from '../site-costs/council.js';
import { lotFacts, constraintFacts, lotFall, fallSentence, buildingFacts, REPORT_LIMITATIONS, CHECK_WITH_COUNCIL } from './siting-facts.js';
import { estimateForProject, fmtAUD as fmtAUD2, ESTIMATE_NOTE } from '../site-costs/commercial-estimate.js';

export const PAGE_W = 210;
export const PAGE_H = 297;
const M = 16;
const CW = PAGE_W - 2 * M;
const FOOT_Y = PAGE_H - 12;

export const REPORT_DISCLAIMER = 'Indicative only. Prepared from public lot and elevation data and the design as drawn. Not a survey, not a development application and not a quote. Setbacks, levels and costs are to be confirmed by the council, a registered surveyor and a suitably qualified person before any use for approval or construction.';

const hexRgb = (hex, fallback) => {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim());
  if (!m) return fallback;
  return [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16));
};
const lum = ([r, g, b]) => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
const WHITE = [255, 255, 255];

/** Brand for the report: builder colours and logo from the portal, else Glide Inside. */
export function reportBrand(options = {}) {
  let builder = options.builder;
  if (builder === undefined) { try { builder = typeof window !== 'undefined' ? window.__ps?.builder : null; } catch { builder = null; } }
  const glide = imageInfo(LOGO_PNG);
  const asImg = (u) => { const i = u ? imageInfo(u) : null; return i && i.w > 0 && i.h > 0 ? i : null; };
  const own = !!(builder && (builder.name || builder.logo));
  const primary = hexRgb(own ? builder.colours?.primary : null, hexRgb(BRAND.ink, [20, 48, 74]));
  const accent = hexRgb(own ? builder.colours?.accent || builder.colours?.primary : null, hexRgb(BRAND.accent, [11, 122, 133]));
  return {
    own, name: own ? clean(builder.name) || 'Your builder' : 'Glide Inside', logo: own ? asImg(builder.logo) : glide, glide,
    primary, accent, primaryInk: lum(primary) > 0.6 ? [18, 20, 24] : WHITE, soft: mix(accent, WHITE, 0.88),
    credit: own ? `Prepared with ${BRAND.name}` : '', contact: own ? builder.contact || null : null,
  };
}

// Drawing helpers ------------------------------------------------------------------------------------------------------------
function text(doc, s, x, y, { size = 9, bold = false, colour = PEN.ink, align = 'left', max = null } = {}) {
  doc.setFont('helvetica', bold ? 'bold' : 'normal');
  doc.setFontSize(size);
  doc.setTextColor(...colour);
  let t = clean(s);
  if (max) while (t.length > 1 && doc.getTextWidth(t) > max) t = t.slice(0, -1);
  doc.text(t, x, y, { align });
}
function para(doc, s, x, y, w, { size = 9, lead = 4.2, colour = PEN.ink, bold = false } = {}) {
  doc.setFont('helvetica', bold ? 'bold' : 'normal');
  doc.setFontSize(size);
  doc.setTextColor(...colour);
  const lines = wrap(doc, s, w);
  lines.forEach((l, i) => doc.text(l, x, y + i * lead));
  return y + lines.length * lead;
}
function heading(doc, brand, s, y) {
  text(doc, s.toUpperCase(), M, y, { size: 11, bold: true, colour: brand.primary });
  doc.setDrawColor(...brand.accent);
  doc.setLineWidth(0.6);
  doc.line(M, y + 1.8, M + CW, y + 1.8);
  return y + 7;
}
function band(doc, brand, title) {
  // A white header so any logo reads (builder logos and the Glide Inside wordmark are made for light backgrounds), with the brand colours as bars.
  if (brand.logo) { const h = 11; const w = Math.min(46, h * (brand.logo.w / brand.logo.h)); placeImage(doc, brand.logo, { x: M, y: 4, w, h }); }
  else text(doc, brand.name, M, 12, { size: 14, bold: true, colour: brand.primary });
  text(doc, title, PAGE_W - M, 12, { size: 10, bold: true, colour: brand.primary, align: 'right' });
  doc.setFillColor(...brand.primary);
  doc.rect(0, 17.5, PAGE_W, 3, 'F');
  doc.setFillColor(...brand.accent);
  doc.rect(0, 20.5, PAGE_W, 1, 'F');
}
function footer(doc, brand, n, total, dateText) {
  doc.setDrawColor(...PEN.light);
  doc.setLineWidth(0.2);
  doc.line(M, FOOT_Y - 9, M + CW, FOOT_Y - 9);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6.6);
  doc.setTextColor(...PEN.grey);
  doc.text(wrap(doc, REPORT_DISCLAIMER, CW), M, FOOT_Y - 5.6);
  doc.text(clean(`${brand.name}${brand.credit ? `. ${brand.credit}` : ''}  |  ${dateText}  |  Page ${n} of ${total}`), M + CW, FOOT_Y + 3, { align: 'right' });
}
function table(doc, brand, x, y, cols, rows, { size = 8.2, lead = 3.7, pad = 1.6, head = true } = {}) {
  const total = cols.reduce((a, c) => a + c.w, 0);
  if (head) {
    doc.setFillColor(...brand.soft);
    doc.rect(x, y, total, 6.4, 'F');
    let cx = x;
    for (const c of cols) { text(doc, c.head, c.align === 'right' ? cx + c.w - pad : cx + pad, y + 4.3, { size, bold: true, align: c.align === 'right' ? 'right' : 'left' }); cx += c.w; }
    y += 6.4;
  }
  for (const rIn of rows) {
    const row = Array.isArray(rIn) ? { cells: rIn } : rIn;
    doc.setFont('helvetica', row.bold ? 'bold' : 'normal');
    doc.setFontSize(size);
    const wr = row.cells.map((v, i) => wrap(doc, String(v ?? ''), cols[i].w - 2 * pad));
    const h = Math.max(1, ...wr.map((w) => w.length)) * lead + 2 * pad - 0.8;
    if (row.fill) { doc.setFillColor(...row.fill); doc.rect(x, y, total, h, 'F'); }
    let cx = x;
    wr.forEach((w, i) => {
      doc.setFont('helvetica', row.bold ? 'bold' : 'normal');
      doc.setFontSize(size);
      doc.setTextColor(...(row.colours?.[i] || PEN.ink));
      w.forEach((l, j) => doc.text(l, cols[i].align === 'right' ? cx + cols[i].w - pad : cx + pad, y + pad + 2 + j * lead, { align: cols[i].align === 'right' ? 'right' : 'left' }));
      cx += cols[i].w;
    });
    doc.setDrawColor(...PEN.light);
    doc.setLineWidth(0.15);
    doc.line(x, y + h, x + total, y + h);
    y += h;
  }
  return y;
}

// Siting plan --------------------------------------------------------------------------------------------------------------
const PLAN_SCALES = [100, 150, 200, 250, 300, 400, 500, 750, 1000, 1500, 2000, 3000, 5000];
/** Draws the lot, setback envelope, house, driveway, street and dimensions into the box. Returns { scale } (1:n at A4). */
export function drawSitingPlan(doc, project, box, brand) {
  const lot = project.site?.lot;
  const rings = buildingRings(project);
  const reserves = roadReserve(lot);
  const dw = (() => { try { return deriveDriveway(project); } catch { return null; } })();
  const pts = [...lot.boundary, ...rings.flat()];
  for (const r of reserves) { for (const q of r.lines.property) pts.push(G.add(q, G.mul(r.outward, (r.vergeM + 1.2) * 1000))); } // the street out to just past the kerb, not the whole extended line
  const bb = G.bbox(pts);
  const padMm = 5500; // room for dimension strings and the street
  const w = bb.maxX - bb.minX + 2 * padMm; const h = bb.maxY - bb.minY + 2 * padMm;
  const bw = box.x1 - box.x0; const bh = box.y1 - box.y0;
  const scale = PLAN_SCALES.find((s) => w / s <= bw && h / s <= bh) || PLAN_SCALES.at(-1);
  const ox = box.x0 + (bw - (bb.maxX - bb.minX) / scale) / 2;
  const oy = box.y0 + (bh - (bb.maxY - bb.minY) / scale) / 2;
  const T = (p) => ({ x: ox + (p.x - bb.minX) / scale, y: oy + (p.y - bb.minY) / scale });
  doc.setFillColor(250, 251, 252);
  doc.rect(box.x0, box.y0, bw, bh, 'F');
  doc.setDrawColor(...PEN.light);
  doc.setLineWidth(0.3);
  doc.rect(box.x0, box.y0, bw, bh, 'S');
  // clip to the box so a long street never leaves the frame
  const clipLine = (a, b) => {
    let t0 = 0; let t1 = 1; const dx = b.x - a.x; const dy = b.y - a.y;
    for (const [p, q] of [[-dx, a.x - box.x0], [dx, box.x1 - a.x], [-dy, a.y - box.y0], [dy, box.y1 - a.y]]) {
      if (p === 0) { if (q < 0) return; } else { const t = q / p; if (p < 0) { if (t > t1) return; if (t > t0) t0 = t; } else { if (t < t0) return; if (t < t1) t1 = t; } }
    }
    doc.line(a.x + dx * t0, a.y + dy * t0, a.x + dx * t1, a.y + dy * t1);
  };
  // neighbours
  doc.setDrawColor(...PEN.neighbour);
  doc.setLineWidth(0.15);
  for (const nb of lot.neighbours || []) { if (nb.isRoad || !nb.ring) continue; const r = nb.ring.map(T); for (let i = 0; i < r.length; i++) clipLine(r[i], r[(i + 1) % r.length]); }
  // street: kerb lines and the red phantom centreline
  for (const r of reserves) {
    doc.setDrawColor(...PEN.road);
    doc.setLineWidth(0.3);
    doc.setLineDashPattern([], 0);
    clipLine(T(r.lines.kerb[0]), T(r.lines.kerb[1]));
    clipLine(T(r.lines.farKerb[0]), T(r.lines.farKerb[1]));
    doc.setDrawColor(...PEN.phantom);
    doc.setLineWidth(0.3);
    doc.setLineDashPattern([4, 0.8, 0.8, 0.8, 0.8, 0.8], 0);
    clipLine(T(r.lines.centreline[0]), T(r.lines.centreline[1]));
    doc.setLineDashPattern([], 0);
  }
  // lot boundary
  doc.setFillColor(...brand.soft);
  polygon(doc, lot.boundary.map(T), 'F');
  // overlay areas (hatched, indicative) and contours inside the lot
  for (const layer of lot.overlays?.layers || []) {
    const st = OVERLAY_STYLE[layer.id];
    if (!st || !layer.features?.length) continue;
    doc.setDrawColor(...st.rgb); doc.setLineWidth(0.12);
    const ang = { flood: 45, bushfire: 135, heritage: 90, easement: 0 }[layer.id] || 45;
    for (const f of layer.features) for (const r of f.rings || []) {
      const cp = clipPolygon(r.outer, { x0: bb.minX - padMm, y0: bb.minY - padMm, x1: bb.maxX + padMm, y1: bb.maxY + padMm });
      if (cp.length < 3) continue;
      for (const [a, c] of hatchSegments(cp.map(T), ang, 1.8)) clipLine(a, c);
    }
  }
  doc.setLineDashPattern([], 0);
  for (const c of lot.contours || []) {
    const flat = c.pts || []; doc.setDrawColor(...(c.major ? [150, 98, 40] : [205, 170, 125])); doc.setLineWidth(c.major ? 0.2 : 0.1);
    let prev = null;
    for (let i = 0; i + 1 < flat.length; i += 2) {
      const q = { x: flat[i], y: flat[i + 1] };
      const inside = G.pointInPolygon(q, lot.boundary);
      if (prev && inside) clipLine(T(prev), T(q));
      prev = inside ? q : null;
    }
  }
  // driveway
  if (dw?.ok && dw.polygon?.length > 2) { doc.setFillColor(205, 208, 214); doc.setDrawColor(...PEN.hard); doc.setLineWidth(0.15); polygon(doc, dw.polygon.map(T), 'FD'); }
  doc.setDrawColor(...PEN.boundary);
  doc.setLineWidth(0.7);
  polygon(doc, lot.boundary.map(T), 'S');
  // setback envelope
  if (lot.envelope?.length > 2) {
    doc.setDrawColor(...PEN.envelope);
    doc.setLineWidth(0.35);
    doc.setLineDashPattern([2.2, 1.2], 0);
    polygon(doc, lot.envelope.map(T), 'S');
    doc.setLineDashPattern([], 0);
  }
  // the house
  doc.setFillColor(...PEN.proposedFill);
  doc.setDrawColor(...PEN.proposed);
  doc.setLineWidth(0.5);
  for (const ring of rings) { polygon(doc, ring.map(T), 'FD'); }
  // boundary lengths
  for (const d of boundaryDims(lot)) {
    if (d.lengthM < 1.5) continue;
    const m = T(d.mid);
    const ang = (Math.atan2(d.b.y - d.a.y, d.b.x - d.a.x) * 180) / Math.PI;
    const a = ang > 90 ? ang - 180 : ang < -90 ? ang + 180 : ang;
    const inward = (() => { const n = G.norm(G.sub(G.lerp(d.a, d.b, 0.5), lot.boundary.reduce((s, p) => ({ x: s.x + p.x / lot.boundary.length, y: s.y + p.y / lot.boundary.length }), { x: 0, y: 0 }))); return n; })();
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.6);
    doc.setTextColor(...PEN.boundary);
    doc.text(`${d.length} m`, m.x + inward.x * 3.2, m.y + inward.y * 3.2 + 0.8, { align: 'center', angle: -a });
  }
  // setback dimension strings from the house to the boundary
  const cl = clearances(project);
  for (const row of cl.rows || []) {
    if (!row.from || !row.to || !(row.clearanceM > 0.2)) continue;
    const a = T(row.from); const b = T(row.to);
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len < 3) continue;
    const short = row.status === 'outside';
    doc.setDrawColor(...(short ? PEN.envelope : PEN.dim));
    doc.setLineWidth(0.2);
    doc.line(a.x, a.y, b.x, b.y);
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    doc.setFillColor(255, 255, 255);
    const label = `${row.clearanceM.toFixed(2)} m`;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(6.8);
    const tw = doc.getTextWidth(label) + 1.4;
    doc.rect(mid.x - tw / 2, mid.y - 1.9, tw, 3.2, 'F');
    doc.setTextColor(...(short ? PEN.envelope : PEN.dim));
    doc.text(label, mid.x, mid.y + 0.7, { align: 'center' });
  }
  // north point and scale bar
  northArrow(doc, box.x1 - 10, box.y0 + 11, project.site?.northDeg || 0);
  const barM = [1, 2, 5, 10, 20, 50].filter((m) => (m * 1000) / scale <= bw * 0.4).at(-1) || 1;
  const seg = (barM * 1000) / scale;
  for (let i = 0; i < 4; i++) { doc.setFillColor(...(i % 2 ? WHITE : PEN.ink)); doc.setDrawColor(...PEN.ink); doc.setLineWidth(0.15); doc.rect(box.x0 + 4 + (i * seg) / 4 * 1, box.y0 + 5, seg / 4, 1.6, 'FD'); }
  text(doc, `0`, box.x0 + 4, box.y0 + 10, { size: 6.6 });
  text(doc, `${barM} m`, box.x0 + 4 + seg, box.y0 + 10, { size: 6.6, align: 'center' });
  text(doc, `1:${scale} at A4`, box.x1 - 3, box.y1 - 2.4, { size: 7, bold: true, align: 'right' });
  return { scale };
}

// The report ---------------------------------------------------------------------------------------------------------------
const cap = (t) => String(t || '').toLowerCase().replace(/\b([a-z])/g, (m) => m.toUpperCase());

/** Site facts used by the report and its tests. */
export function siteFactsOf(project) {
  const lot = project.site?.lot || null;
  const area = lot ? siteAreaOf(lot) : { m2: 0 };
  const lotLines = lot ? lotLabelLines(lot) : null;
  return {
    address: clean(project.titleBlock?.address || lot?.address || ''),
    lotDp: clean(titleLotDp(project) || (lotLines ? `${lotLines.first} ${lotLines.second}`.trim().replace(/^LOT/, 'Lot') : '')),
    areaM2: area.m2 ? Math.round(area.m2) : null,
    frontageM: lot ? frontageM(lot) : null,
    zone: lot?.zoning?.code ? `${lot.zoning.code}${lot.zoning.name ? ` ${lot.zoning.name}` : ''}` : '',
    council: lot?.lga ? cap(lot.lga) : clean(project.titleBlock?.council || ''),
    state: lot?.state || '',
  };
}

function setbackRows(project) {
  const c = clearances(project);
  const label = (r) => ({ front: 'Front', secondaryFront: 'Secondary front', rear: 'Rear', side: 'Side' }[r.kind] || 'Boundary');
  return (c.rows || []).map((r) => ({
    cells: [label(r), r.clearanceM.toFixed(2), r.requiredM != null ? r.requiredM.toFixed(2) : 'Not loaded', r.status === 'inside' ? 'Inside the indicative setback' : r.status === 'outside' ? `Short by ${r.shortByM.toFixed(2)} m` : 'Council rule to be confirmed'],
    colours: [null, null, null, r.status === 'outside' ? PEN.envelope : r.status === 'inside' ? PEN.boundary : PEN.grey],
  })).sort((a, b) => a.cells[0].localeCompare(b.cells[0]));
}

export async function toSitingReport(project, options = {}) {
  const JsPDF = options.jsPDF;
  if (!JsPDF) throw new Error('jsPDF is required to build the siting report.');
  const doc = withSuperscripts(new JsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait', compress: true })); // m² prints with a raised 2 (some viewers lack the glyph)
  const brand = reportBrand(options);
  const dateText = options.date instanceof Date ? ddmmyyyy(options.date) : options.date || ddmmyyyy(new Date());
  const lot = project.site?.lot || null;
  const commercial = project.mode === 'commercial' && !!project.commercial;
  const facts = siteFactsOf(project);
  const stats = commercial ? null : (() => { try { return houseStats(project); } catch { return null; } })();
  const areas = commercial ? null : (() => { try { return areaBreakdown(project); } catch { return null; } })();
  const bfacts = commercial ? await buildingFacts(project) : null;
  // Commercial layouts have no house, so the house estimator does not apply: they use the plain allowance estimator (one figure, editable rates).
  const cest = commercial && lot ? await estimateForProject(project, { rates: options.rates }).catch(() => null) : null;
  const est = commercial ? { ok: false } : (options.estimate || (lot ? estimateSiteCosts(project, { settings: options.settings }) : { ok: false }));
  const title = projectTitle(project);
  const sections = [];
  const img = options.image ? imageInfo(options.image) : null;
  const contact = options.contact || brand.contact || null;

  // Page 1: cover ---------------------------------------------------------------------------------------------------------------
  sections.push('cover');
  band(doc, brand, 'SITING REPORT AND PROPOSAL');
  let y = 36;
  text(doc, title, M, y, { size: 22, bold: true, colour: brand.primary, max: CW });
  y += 8;
  if (facts.address) { text(doc, facts.address, M, y, { size: 12, max: CW }); y += 6; }
  if (facts.lotDp) { text(doc, facts.lotDp, M, y, { size: 10.5, colour: PEN.grey }); y += 5.5; }
  text(doc, `Prepared ${dateText}${brand.own ? ` by ${brand.name}` : ''}`, M, y, { size: 9, colour: PEN.grey });
  y += 6;
  const imgBox = { x: M, y, w: CW, h: 118 };
  doc.setFillColor(...brand.soft);
  doc.rect(imgBox.x, imgBox.y, imgBox.w, imgBox.h, 'F');
  if (img && placeImage(doc, img, imgBox)) {
    text(doc, 'Indicative 3D view of the home on the lot', imgBox.x + 2, imgBox.y + imgBox.h + 4, { size: 7, colour: PEN.grey });
  } else if (lot) {
    drawSitingPlan(doc, project, { x0: imgBox.x, y0: imgBox.y, x1: imgBox.x + imgBox.w, y1: imgBox.y + imgBox.h }, brand);
    text(doc, 'Indicative site plan (a 3D view was not available)', imgBox.x + 2, imgBox.y + imgBox.h + 4, { size: 7, colour: PEN.grey });
  } else text(doc, 'No lot has been loaded for this design.', imgBox.x + imgBox.w / 2, imgBox.y + imgBox.h / 2, { size: 10, colour: PEN.grey, align: 'center' });
  y = imgBox.y + imgBox.h + 11;
  // key figures
  const figs = [];
  if (facts.areaM2) figs.push([fmtArea(facts.areaM2), 'Lot area']);
  if (facts.frontageM) figs.push([`${facts.frontageM} m`, 'Frontage']);
  if (stats) { figs.push([`${stats.bedrooms} bed ${stats.bathrooms} bath`, 'Home']); figs.push([`${areas?.total ?? stats.floorAreaM2} m²`, 'Total area under roof']); }
  if (bfacts) { figs.push([`${bfacts.gfaM2} m²`, 'Gross floor area']); if (bfacts.coveragePct != null) figs.push([`${bfacts.coveragePct} %`, 'Site coverage']); }
  if (est.ok) figs.push([`${fmtAud(est.total.likely)}`, 'Indicative site costs']);
  else if (cest) figs.push([fmtAud(cest.estimate.total), 'Indicative site costs']);
  const cellW = CW / Math.max(1, figs.length);
  figs.forEach(([v, l], i) => {
    const x = M + i * cellW;
    doc.setFillColor(...brand.soft);
    doc.rect(x + 0.8, y, cellW - 1.6, 20, 'F');
    text(doc, v, x + cellW / 2, y + 9, { size: 12.5, bold: true, colour: brand.primary, align: 'center', max: cellW - 4 });
    text(doc, l, x + cellW / 2, y + 15.2, { size: 7.6, colour: PEN.grey, align: 'center' });
  });

  // Page 2: site summary and siting plan ----------------------------------------------------------------------------------------
  doc.addPage('a4', 'portrait');
  sections.push('site');
  band(doc, brand, 'SITE SUMMARY AND SITING PLAN');
  y = heading(doc, brand, 'Site summary', 32);
  const rowsS = [
    ['Address', facts.address || 'Not stated'], ['Lot and plan', facts.lotDp || 'Not stated'],
    ['Lot area', facts.areaM2 ? `${fmtArea(facts.areaM2)}${lot?.source === 'upload' ? ' (boundary supplied by the user)' : ''}` : 'Not stated'],
    ['Street frontage', facts.frontageM ? `${facts.frontageM} m` : 'Not stated'], ['Zone', facts.zone || 'Not loaded'], ['Council', facts.council || 'Not stated'],
  ];
  y = table(doc, brand, M, y, [{ w: 38, head: 'ITEM' }, { w: CW - 38, head: 'DETAIL' }], rowsS, { size: 8.4 }) + 5;
  y = heading(doc, brand, 'Siting plan', y);
  if (lot) {
    const plan = drawSitingPlan(doc, project, { x0: M, y0: y, x1: M + CW, y1: y + 112 }, brand);
    y += 112 + 4;
    const items = [['Lot boundary', PEN.boundary, []], ['Indicative setback envelope', PEN.envelope, [2.2, 1.2]], ['Distance from house to boundary', PEN.dim, []], ['Street centreline', PEN.phantom, [4, 0.8, 0.8, 0.8]], ['Contours', [150, 98, 40], []]];
    let lx = M;
    for (const [name, col, dash] of items) {
      doc.setDrawColor(...col); doc.setLineWidth(0.5); doc.setLineDashPattern(dash, 0); doc.line(lx, y, lx + 9, y); doc.setLineDashPattern([], 0);
      text(doc, name, lx + 11, y + 1, { size: 7, colour: PEN.grey });
      lx += 12 + doc.getTextWidth(clean(name)) + 6;
    }
    y += 5;
    void plan;
  } else { text(doc, 'No lot has been loaded, so there is no siting plan.', M, y + 6, { size: 9, colour: PEN.grey }); y += 14; }
  y = heading(doc, brand, 'Setbacks', y + 4);
  const sb = lot ? setbackRows(project) : [];
  if (sb.length) {
    y = table(doc, brand, M, y, [{ w: 36, head: 'BOUNDARY' }, { w: 30, head: 'SHOWN (m)', align: 'right' }, { w: 34, head: 'INDICATIVE (m)', align: 'right' }, { w: CW - 100, head: 'RESULT' }], sb, { size: 8 });
    y = para(doc, 'Setback figures are guidance from the planning data loaded for this council. The council holds the accurate controls and is to confirm them.', M, y + 3, CW, { size: 7.6, colour: PEN.grey });
  } else y = para(doc, lot?.setbacks ? 'The house is not placed on the lot yet, so setbacks are not shown.' : 'Council setbacks are not loaded for this lot. The council is to confirm the controls.', M, y + 1, CW, { size: 8.4 });

  // Ground page: site constraints, contours and fall, limitations -------------------------------------------------------------------
  doc.addPage('a4', 'portrait');
  sections.push('ground');
  band(doc, brand, 'SITE CONSTRAINTS AND GROUND');
  y = heading(doc, brand, 'Site constraints (indicative)', 32);
  const cf = constraintFacts(lot);
  y = table(doc, brand, M, y, [{ w: 34, head: 'CONSTRAINT' }, { w: 24, head: 'ANSWER' }, { w: CW - 34 - 24 - 40, head: 'WHAT WAS FOUND' }, { w: 40, head: 'SOURCE' }],
    cf.map((r) => [r.title, r.answer, r.detail || (r.checkMap ? 'Check the council map.' : ''), r.source ? `${r.source}${r.date ? `, dated ${r.date}` : ''}` : 'Council map']), { size: 7.6, lead: 3.4 });
  y = para(doc, `${CHECK_WITH_COUNCIL} A mapped area is context for your own planning enquiry, not a planning decision, and an area with none mapped is not an all clear.`, M, y + 3, CW, { size: 7.4, colour: PEN.grey, lead: 3.4 }) + 3;
  const fall = lotFall(lot);
  y = heading(doc, brand, 'Contours and fall across the lot', y);
  y = para(doc, fallSentence(fall), M, y, CW, { size: 8.6 }) + 1;
  if (fall) {
    const fr = [['Highest ground RL', `${fall.highRL.toFixed(2)} m`], ['Lowest ground RL', `${fall.lowRL.toFixed(2)} m`], ['Relief across the lot', `${fall.reliefM.toFixed(2)} m`], ['Average fall', `${fall.fallPct} % (${fall.fallRatio})${fall.bearingDeg == null ? '' : `, towards the ${fall.direction}`}`]];
    if (fall.fromStreetPct != null) fr.push(['From the street frontage', `${fall.fromStreetPct > 0 ? 'rises' : fall.fromStreetPct < 0 ? 'falls' : 'level'} ${Math.abs(fall.fromStreetPct)} % into the lot`]);
    if (lot?.contourInterval) fr.push(['Contour interval', `${lot.contourInterval.minor} m minor, ${lot.contourInterval.major} m major`]);
    y = table(doc, brand, M, y, [{ w: 50, head: 'ITEM' }, { w: CW - 50, head: 'DETAIL' }], fr, { size: 8 }) + 2;
    y = para(doc, `Ground levels come from an elevation model${fall.source ? ` (${fall.source})` : ''}. They are not a survey.`, M, y, CW, { size: 7.4, colour: PEN.grey, lead: 3.4 }) + 3;
  }
  y = heading(doc, brand, 'Limitations', y + 1);
  for (const l of REPORT_LIMITATIONS) y = para(doc, l, M, y, CW, { size: 7.6, lead: 3.5 }) + 1.6;

  // Page 3: home design summary and site costs -------------------------------------------------------------------------------
  doc.addPage('a4', 'portrait');
  sections.push('design');
  band(doc, brand, 'HOME DESIGN AND SITE COSTS');
  y = heading(doc, brand, commercial ? 'Building summary' : 'Home design summary', 32);
  const sid = effectiveSchemeId(project);
  const rowsD = commercial ? [['Design', title], ...bfacts.items] : [['Design', title]];
  if (stats) rowsD.push(['Bedrooms and bathrooms', `${stats.bedrooms} bedrooms, ${stats.bathrooms} bathrooms`], ['Garage', stats.garage ? `${stats.garage} car` : 'None'], ['Storeys', String(stats.storeys)], ['Building size', sizeLabel(stats)]);
  if (areas) rowsD.push(['Living area', `${areas.living} m²`], ['Total under roof (including garage and covered outdoor)', `${Math.round((areas.living + areas.garage + areas.alfresco + areas.porch + areas.otherRoofed) * 10) / 10} m²`]);
  if (sid) rowsD.push(['Colour scheme', schemeLine(schemeById(sid))]);
  y = table(doc, brand, M, y, [{ w: 78, head: 'ITEM' }, { w: CW - 78, head: 'DETAIL' }], rowsD, { size: 8.4 }) + 5;
  y = heading(doc, brand, 'Indicative site cost estimate', y);
  if (cest) {
    const ce = cest.estimate;
    const rowsC = ce.lines.filter((l) => l.qty > 0).map((l) => [l.label, `${fmtQty(l.qty)} ${l.unit}`, fmtAUD2(l.rate), fmtAUD2(l.amount)]);
    rowsC.push({ cells: [`Contingency ${ce.contingencyPct} %`, '', '', fmtAUD2(ce.contingency)] }, { cells: ['Indicative total, GST excluded', '', '', fmtAUD2(ce.total)], bold: true, fill: brand.soft });
    y = table(doc, brand, M, y, [{ w: 80, head: 'ITEM' }, { w: 32, head: 'QUANTITY' }, { w: 30, head: 'RATE', align: 'right' }, { w: CW - 142, head: 'ALLOWANCE', align: 'right' }], rowsC, { size: 7.6, lead: 3.4, pad: 1.3 });
    y = para(doc, `${ESTIMATE_NOTE} ${(cest.notes || []).join(' ')}`, M, y + 3, CW, { size: 7.4, colour: PEN.grey, lead: 3.4 });
  } else if (est.ok) {
    const groups = [];
    for (const l of [...est.lines, ...est.surcharges, est.contingency]) { let g = groups.find((x) => x.name === l.group); if (!g) { g = { name: l.group, low: 0, likely: 0, high: 0, rows: [] }; groups.push(g); } g.low += l.low; g.likely += l.likely; g.high += l.high; g.rows.push(l); }
    const rows = [];
    for (const g of groups) {
      rows.push({ cells: [g.name, '', fmtAud(g.low), fmtAud(g.likely), fmtAud(g.high)], bold: true, fill: brand.soft });
      // Earthworks, retaining and driveway show their lines; services are summed into one line
      if (g.name === 'Services') rows.push({ cells: [`Water, stormwater${est.rural ? ', power, telecommunications and on site wastewater' : ', sewer, power and telecommunications'} (building ${est.inputs.serviceRunM != null ? Math.round((est.inputs.serviceRunM - 2) * 10) / 10 : '?'} m from the street)`, '', '', '', ''] });
      else for (const l of g.rows) rows.push({ cells: [`${l.label}`, `${fmtQty(l.qty)} ${l.unit}`, fmtAud(l.low), fmtAud(l.likely), fmtAud(l.high)], colours: [PEN.ink, PEN.grey, PEN.grey, PEN.ink, PEN.grey] });
    }
    rows.push({ cells: ['Total, GST excluded', '', fmtAud(est.total.low), fmtAud(est.total.likely), fmtAud(est.total.high)], bold: true, fill: brand.soft });
    y = table(doc, brand, M, y, [{ w: 80, head: 'ITEM' }, { w: 30, head: 'QUANTITY' }, { w: 22, head: 'LOW', align: 'right' }, { w: 24, head: 'LIKELY', align: 'right' }, { w: CW - 156, head: 'HIGH', align: 'right' }], rows, { size: 7.6, lead: 3.4, pad: 1.3 });
    const basis = `Rates: ${est.ratesCustomised ? 'the builder\'s own rates where set, otherwise Glide Inside defaults' : 'Glide Inside defaults'} for ${est.regionLabel.toLowerCase()}, dated ${est.ratesDate}.`;
    y = para(doc, `${basis} ${est.assumptions.join(' ')}`, M, y + 3, CW, { size: 7.4, colour: PEN.grey, lead: 3.4 });
  } else y = para(doc, 'A site cost estimate needs a lot on the design. Find the lot first.', M, y + 1, CW, { size: 9 });

  // Page 4: next steps and contact ------------------------------------------------------------------------------------------------
  doc.addPage('a4', 'portrait');
  sections.push('next');
  band(doc, brand, 'NEXT STEPS');
  y = heading(doc, brand, 'Next steps', 32);
  const steps = [
    'Confirm the lot, the boundaries and the council controls. A registered surveyor provides a detail survey with levels.',
    'Confirm the site conditions. A geotechnical report gives the site classification and tells us whether rock or poor soil is present.',
    'Review this siting and the indicative site costs together, then agree the design and the site works allowance.',
    'Engineering for the footings, stormwater, driveway and any retaining is prepared by a registered engineer, ready for the approval pathway.',
    'Lodge the approval with the council or a private certifier, as the pathway for this lot requires.',
  ];
  steps.forEach((s, i) => {
    doc.setFillColor(...brand.accent);
    doc.circle(M + 3, y - 1.1, 3, 'F');
    text(doc, String(i + 1), M + 3, y, { size: 8.5, bold: true, colour: WHITE, align: 'center' });
    y = para(doc, s, M + 9, y, CW - 9, { size: 9.2, lead: 4.3 }) + 3.6;
  });
  // Council rules that apply, from the council's own documents (JCESite council database), with the clause cited.
  y = heading(doc, brand, 'Council rules used', y + 2);
  if (est.ok && est.council?.found) {
    const cut = (t, n) => (t.length > n ? `${t.slice(0, n - 3)}...` : t);
    const crow = est.checks.map((c) => ({
      cells: [c.label, c.status === 'not_found' ? NOT_FOUND : `${c.text} Council: ${cut(c.council, 120)}. ${c.cite} "${cut(c.quote, 110)}"`],
      colours: [null, c.status === 'exceeds' ? PEN.envelope : c.status === 'not_found' ? PEN.grey : PEN.ink],
    }));
    y = table(doc, brand, M, y, [{ w: 42, head: 'RULE' }, { w: CW - 42, head: `${est.council.council.toUpperCase()}` }], crow, { size: 6.8, lead: 3, pad: 1.1 });
    y = para(doc, `The council's own wording is quoted. The council is to confirm which rules apply to this development. Source: ${est.council.source}, ${est.council.built}.`, M, y + 2, CW, { size: 6.8, colour: PEN.grey, lead: 3 }) + 2;
  } else y = para(doc, `The council for this lot${lot?.lga ? ` (${cap(lot.lga)})` : ''} is not in the council rules database, so default values were used. ${NOT_FOUND}.`, M, y, CW, { size: 8.4 }) + 3;
  y = heading(doc, brand, 'Engineering for this lot', y + 1);
  y = para(doc, `Fulfilled by JCE Infrastructure, civil engineers: ${ENGINEERING_SERVICES.map((x) => x.label.toLowerCase()).join(', ')}. Ask for a quote from within the plan tool, or tell your builder.`, M, y, CW, { size: 8.4 }) + 3;
  y = heading(doc, brand, 'Contact', y);
  const cl = [];
  cl.push(brand.own ? brand.name : 'Glide Inside');
  if (contact?.phone) cl.push(`Phone: ${contact.phone}`);
  if (contact?.email) cl.push(`Email: ${contact.email}`);
  if (!contact?.phone && !contact?.email) cl.push(brand.own ? 'Please contact your builder using the details you were given.' : 'glideinside.com.au');
  cl.forEach((l, i) => { text(doc, l, M, y + i * 5, { size: i ? 9 : 11, bold: i === 0, colour: i === 0 ? brand.primary : PEN.ink }); });
  y += cl.length * 5 + 4;
  const attr = clean(attribution(lot, {}));
  para(doc, attr, M, y, CW, { size: 7, colour: PEN.grey, lead: 3.2 });

  const pages = doc.internal.getNumberOfPages();
  for (let n = 1; n <= pages; n++) { doc.setPage(n); footer(doc, brand, n, pages, dateText); }
  const bytes = new Uint8Array(doc.output('arraybuffer'));
  Object.defineProperty(bytes, 'layout', { value: { pages, sections, brand: { own: brand.own, name: brand.name, primary: brand.primary }, hasImage: !!img, estimate: est.ok ? est.total : null }, enumerable: false });
  return bytes;
}

const fmtQty = (n) => (Math.abs(n) >= 100 ? String(Math.round(n)) : String(Math.round(n * 10) / 10));
export const sitingReportFilename = (project) => `${String(project?.name || 'design').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'design'}-siting-report.pdf`;
