// Lot viewer plan set: ONE A3 landscape PDF.
//   kind 'site':  1. cover sheet (C000)  2. site plan (C100)  3. house plan (A100)
//   kind 'house': 1. cover sheet (C000)  2. house plan (A100)
//
//   const { blob, filename } = await exportPlanSet({ project, lot, kind: 'site', builderName: 'Hunter Homes', download: true });
//
// `project` is a Pocket Architect project (schema 2). `lot` is the lot the viewer holds: see the PlanSetLot typedef in ./lot.js (the schema 2
// site.lot in plan millimetres, or a plain metre lot). Omit `lot` to use project.site.lot. Text is vector text (standard PDF fonts).

import { schemeColours } from '../../../model/colour-schemes.js';
import { slugify, ascii } from '../shared.js';
import { projectCode, projectTitle } from '../eng/brand.js';
import { alignProject } from '../eng/index.js';
import { clean, cleanedDoc, withSuperscripts } from '../eng/kit.js';
import { titleLotDp } from '../../../site/lotplan.js';
import { prepare } from './lot.js';
import { drawStrip, drawConceptNote, drawWatermark, ddmmyyyy, ABN, ENTITY } from './frame.js';
import { drawCover, localityScale, localityView } from './cover.js';
import { resolveLocality } from './locality.js';
import { drawSite, siteView } from './site.js';
import { drawHouseSheet, houseSheets } from './house.js';

void schemeColours;

async function loadJsPDF(given) {
  if (typeof given === 'function') return given;
  try {
    if (typeof window !== 'undefined' && window.jspdf?.jsPDF) return window.jspdf.jsPDF;
    if (typeof document !== 'undefined') {
      const { loadJsPDF: load } = await import('../../export-client.js');
      return await load();
    }
  } catch {
    // fall through to the module import
  }
  const mod = await import('jspdf');
  return mod.jsPDF || mod.default;
}

/**
 * The sheet plan with no drawing done, so the cover's drawing list and the page count always agree.
 * Returns [{ id: 'cover'|'site'|'house', code: 'C000'|'C100'|'A100', title, scale }].
 */
export function planSetSheets({ project, lot, kind, catalogue = null }) {
  const sheets = [{ id: 'cover', code: 'C000', title: 'COVER SHEET AND DRAWING INDEX', scale: 'AS SHOWN' }];
  if (kind === 'site') sheets.push({ id: 'site', code: 'C100', title: 'SITE PLAN', scale: lot ? `1:${siteView(project, lot).scale} @ A3` : 'NTS' });
  const hs = houseSheets(alignProject(project).project, catalogue);
  hs.forEach((h, i) => {
    const name = `${ascii(h.level.name) || 'Level'} FLOOR PLAN`.toUpperCase();
    const title = hs.length > 1 ? name : kind === 'site' ? 'HOUSE PLAN' : 'FLOOR PLAN';
    sheets.push({ id: 'house', code: `A${100 + i}`, title, scale: `1:${h.scale} @ A3`, house: h });
  });
  return sheets;
}

/**
 * @param {Object} o
 * @param {Object} o.project  Pocket Architect project (schema 2), the house design.
 * @param {import('./lot.js').PlanSetLot} [o.lot]  The lot (see lot.js). Required for kind 'site'.
 * @param {'site'|'house'} o.kind
 * @param {string} [o.builderName]  Adds the diagonal watermark "Prepared for <builderName>" and the client field.
 * @param {boolean} [o.download=true]  Trigger the browser download.
 * @param {Object} [o.jsPDF]  jsPDF class (loaded on demand when omitted).
 * @param {Object} [o.catalogue]  Furniture catalogue for the plan symbols.
 * @param {Object} [o.aerial]  Real aerial for the cover locality plan: { image, extent | extentM, attribution? } (see ./locality.js). The lot's stored
 *   aerial (site.lot.aerialWide, then site.lot.aerial) is used when this is omitted and it covers the view.
 * @param {Function} [o.fetchSite]  async ({ lot, request }) => { aerial?, lot?: { neighbours, roads } } | null: fetches a wider aerial and the cadastre
 *   within `request.radius` metres (GET /api/site/lot?radius=). A browser export asks the site service itself when this is omitted; pass null to never fetch.
 * @param {Function} [o.loadImage]  async (key) => Blob, reads the lot's stored aerial (defaults to the browser image store).
 * @param {Date} [o.date]
 * @returns {Promise<{ blob: Blob, filename: string, sheets: Array, pages: number }>}
 */
export async function exportPlanSet({ project, lot = null, kind = 'site', builderName = '', download = true, jsPDF = null, catalogue = null, date = new Date(), aerial = null, fetchSite = undefined, loadImage = null } = {}) {
  if (!project || !Array.isArray(project.levels)) throw new Error('exportPlanSet needs a Pocket Architect project');
  if (kind !== 'site' && kind !== 'house') throw new Error("exportPlanSet kind must be 'site' or 'house'");
  const prep = prepare(project, lot);
  if (kind === 'site' && !prep.lot) throw new Error('A site plan needs the lot (boundary polygon).');
  const wp = prep.project;
  const siteLot = kind === 'site' ? prep.lot : prep.lot; // the house plan also quotes the lot when there is one
  const JsPDF = await loadJsPDF(jsPDF);
  const builder = clean(builderName);
  const dateStr = clean(project.titleBlock?.date) || ddmmyyyy(date);
  const sheets = planSetSheets({ project: wp, lot: kind === 'site' ? siteLot : null, kind, catalogue });
  const aligned = alignProject(wp);
  const id = projectCode(wp);
  const title = projectTitle(wp);
  sheets.forEach((s, i) => { s.n = i + 1; s.no = `GI-${id}-${s.code}`; });

  const raw = new JsPDF({ orientation: 'landscape', unit: 'mm', format: 'a3', compress: true });
  raw.setProperties({ title: `${ascii(title)} concept plan set`, subject: 'Concept design plans, to be checked by a suitably qualified person', author: ENTITY, creator: 'Glide Inside lot viewer' });
  const doc = withSuperscripts(cleanedDoc(raw));
  const address = clean(wp.titleBlock?.address || siteLot?.address || '');
  const lotDp = clean(siteLot ? titleLotDp(wp) || siteLot.lotLabel || '' : '');
  const base = { project: wp, client: builder || 'Glide Inside customer', projectTitle: title, address, lotDp, total: sheets.length, dateStr, jobId: id };
  const facts = {};
  // Real aerial and the wider cadastre for the cover locality plan. Never fatal: without them the sheet says so.
  const locality = siteLot ? await resolveLocality({ lot: siteLot, aerial, fetchSite, loadImage, view: localityView(siteLot).view }) : { aerial: null };

  sheets.forEach((s, i) => {
    if (i > 0) raw.addPage('a3', 'landscape');
    doc.setLineDashPattern([], 0);
    let strip = { n: s.n, no: s.no, title: s.title, scale: s.scale, rev: 'A', kv: [], notes: [] };
    if (s.id === 'cover') {
      drawCover(doc, { project: wp, lot: siteLot, locality, projectTitle: title, address, lotDp, builderName: builder, dateStr, catalogue, index: sheets.map((x) => ({ no: x.no, title: x.title, scale: x.scale })) });
      strip = { ...strip, subtitle: kind === 'site' ? 'Site plan and house plan' : 'House plan', kvTitle: 'SITE DATA', kv: siteLot ? [['Lot area', `${Math.round(siteLot.areaM2).toLocaleString('en-AU')} m²`], ['Locality scale', `1:${localityScale(siteLot)} @ A3`]] : [], notes: ['Concept only, for discussion.', 'Boundaries are from the cadastre and are not a survey.'] };
    } else if (s.id === 'site') {
      Object.assign(facts, drawSite(doc, wp, siteLot));
      strip = { ...strip, subtitle: ascii(title), kvTitle: 'SITE DATA', kv: facts.kv, notes: facts.notes, blocks: facts.blocks };
    } else {
      const h = drawHouseSheet(doc, aligned.project, s.house, { catalogue, northDeg: Number(aligned.project.site?.northDeg) || 0 });
      strip = { ...strip, subtitle: ascii(title), kvTitle: 'AREAS (INDICATIVE)', kv: h.kv, blocks: h.blocks, notes: ['Dimensions in millimetres.', 'Room areas to internal wall faces.', 'Door swings and window positions are shown as designed.', 'Confirm all dimensions on site before ordering.'] };
    }
    drawConceptNote(doc);
    drawStrip(doc, base, strip);
    if (builder) drawWatermark(raw, `Prepared for ${builder}`);
  });

  const bytes = new Uint8Array(raw.output('arraybuffer'));
  const blob = new Blob([bytes], { type: 'application/pdf' });
  const filename = `Glide-Inside-${slugify(title, 'concept')}-${kind === 'site' ? 'site-plan-set' : 'house-plan-set'}.pdf`;
  if (download && typeof document !== 'undefined') {
    const { downloadBlob } = await import('../download.js');
    downloadBlob(blob, filename);
  }
  void ABN;
  return { blob, filename, sheets: sheets.map(({ n, no, title: t, scale }) => ({ n, no, title: t, scale })), pages: sheets.length };
}

export default exportPlanSet;
