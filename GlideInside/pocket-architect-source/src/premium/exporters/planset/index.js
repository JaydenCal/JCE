// Lot viewer plan set: ONE A3 landscape PDF.
//   kind 'site':  1. cover sheet (C000)  2. site plan (C100)  3. house plan (A100)
//   kind 'house': 1. cover sheet (C000)  2. house plan (A100)
//   kind 'commercial': C000 cover and locality, C100 existing site, C101 proposed layout, C102 mezzanine level plan, C103 yield summary
//     (the project is in commercial mode: project.mode 'commercial' with project.commercial; see ./commercial.js)
//
//   const { blob, filename } = await exportPlanSet({ project, lot, kind: 'site', builderName: 'Hunter Homes', download: true });
//
// `project` is a Glide Inside project (schema 2). `lot` is the lot the viewer holds: see the PlanSetLot typedef in ./lot.js (the schema 2
// site.lot in plan millimetres, or a plain metre lot). Omit `lot` to use project.site.lot. Text is vector text (standard PDF fonts).

import { trialJsPDF } from '../watermark.js';
import { schemeColours } from '../../../model/colour-schemes.js';
import { slugify, ascii } from '../shared.js';
import { projectCode, projectTitle } from '../eng/brand.js';
import { alignProject } from '../eng/index.js';
import { buildingAxes, collectTriangles, drawElevations as drawHouseElevations, drawSection as drawHouseSection, elevationScale, sectionScale, drawSectionMarker } from '../eng/views.js';
import { clean, cleanedDoc, withSuperscripts } from '../eng/kit.js';
import { titleLotDp } from '../../../site/lotplan.js';
import { prepare, toSiteLot } from './lot.js';
import { builderOf } from './titleblock.js';
import { drawStrip, drawConceptNote, drawWatermark, ddmmyyyy, ABN, ENTITY, AREA } from './frame.js';
import { drawCover, localityScale, localityView } from './cover.js';
import { resolveLocality } from './locality.js';
import { syncCurrency } from '../../../site/custom-rules.js';
import { sheetNotes } from '../../../site/upload/sheet-text.js';
import { drawSite, siteView } from './site.js';
import { levelsModel, loadTerrainModel } from './levels.js';
import { groundLegendBlock, intervalText } from './contours.js';
import { drawHouseSheet, houseSheets } from './house.js';
import { zoneMismatch, RESIDENTIAL_NOTE } from '../../../commercial/zones.js';
import { drawElevations } from './commercial-elevations.js';
import { drawSections, sectionLetters } from './commercial-sections.js';
import { drawUpperPlans } from './commercial-upper.js';
import { drawLevelsPlan } from './commercial-levels.js';
import { viewTargets } from './commercial-targets.js';
import { withLotIds, commercialModel, commercialSheetPlan, commercialTitle, drawExisting, existingScale, drawLayout, drawMezzanine, drawYield, drawFinancePage, coverThumbnail, commercialNotes, layoutKind, cap1 } from './commercial.js';
import { lotOf } from '../../../model/placement.js';

void schemeColours;

export const PREVIEW_TITLE = 'PREVIEW, NOT TO SCALE';
export const PREVIEW_FOOTER = 'Preview only, not to scale. A Plan Pack gives you the to-scale plan set.';

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
export function planSetSheets({ project, lot, kind, catalogue = null, feasibility = false, levels = null }) {
  if (kind === 'commercial') return commercialSheetPlan(project, toSiteLot(lot) || (lotOf(project) ? project.site.lot : null), { levels });
  const sheets = [{ id: 'cover', code: 'C000', title: 'COVER SHEET AND DRAWING INDEX', scale: 'AS SHOWN' }];
  if (kind === 'site') sheets.push({ id: 'site', code: 'C100', title: 'SITE PLAN', scale: lot ? `1:${siteView(project, lot).scale} @ A3` : 'NTS' });
  const hs = houseSheets(alignProject(project).project, catalogue);
  hs.forEach((h, i) => {
    const name = `${ascii(h.level.name) || 'Level'} FLOOR PLAN`.toUpperCase();
    const title = hs.length > 1 ? name : kind === 'site' ? 'HOUSE PLAN' : 'FLOOR PLAN';
    sheets.push({ id: 'house', code: `A${100 + i}`, title, scale: `1:${h.scale} @ A3`, house: h });
  });
  // Elevations and sections of the house (the same drawings as the engineering set): A200, then A300 across the short axis and A301 along the long axis.
  if (hs.length) {
    const axes = buildingAxes(alignProject(project).project);
    sheets.push({ id: 'elev', code: 'A200', title: 'ELEVATIONS', scale: 'AS SHOWN' });
    sheets.push({ id: 'sect', code: 'A300', title: 'SECTION A-A', scale: 'AS SHOWN', axis: 'short', letter: 'A' });
    if (axes && axes.widthMm >= 6000 && axes.lengthMm >= 6000) sheets.push({ id: 'sect', code: 'A301', title: 'SECTION B-B', scale: 'AS SHOWN', axis: 'long', letter: 'B' });
  }
  if (feasibility) sheets.push({ id: 'finance', code: 'F100', title: 'DEVELOPMENT FEASIBILITY', scale: 'NTS' });
  return sheets;
}

/** Preview only: any printed scale ratio ("1:200 @ A3") becomes "NOT TO SCALE", so the free set never states a scale. */
const noScaleText = (t) => (typeof t === 'string' ? t.replace(/Scale 1:\d+ @ A3\.?/g, 'Not to scale.').replace(/Outline at 1:\d+ @ A3/g, 'Outline, not to scale').replace(/1:\d+ @ A3/g, 'NOT TO SCALE') : t);
function withoutScales(JsPDF) {
  function PreviewPDF(...args) {
    const doc = new JsPDF(...args);
    const text = doc.text.bind(doc);
    doc.text = (t, ...r) => text(Array.isArray(t) ? t.map(noScaleText) : noScaleText(t), ...r);
    return doc;
  }
  Object.assign(PreviewPDF, JsPDF);
  PreviewPDF.prototype = JsPDF.prototype;
  return PreviewPDF;
}

/**
 * @param {Object} o
 * @param {Object} o.project  Glide Inside project (schema 2), the house design.
 * @param {import('./lot.js').PlanSetLot} [o.lot]  The lot (see lot.js). Required for kind 'site'.
 * @param {'site'|'house'|'commercial'} o.kind
 * @param {string} [o.builderName]  Adds the diagonal watermark "Prepared for <builderName>" and the client field.
 * @param {boolean} [o.download=true]  Trigger the browser download.
 * @param {Object} [o.jsPDF]  jsPDF class (loaded on demand when omitted).
 * @param {Object} [o.catalogue]  Furniture catalogue for the plan symbols.
 * @param {Object} [o.aerial]  Real aerial for the cover locality plan: { image, extent | extentM, attribution? } (see ./locality.js). The lot's stored
 *   aerial (site.lot.aerialWide, then site.lot.aerial) is used when this is omitted and it covers the view.
 * @param {Function} [o.fetchSite]  async ({ lot, request }) => { aerial?, lot?: { neighbours, roads } } | null: fetches a wider aerial and the cadastre
 *   within `request.radius` metres (GET /api/site/lot?radius=). A browser export asks the site service itself when this is omitted; pass null to never fetch.
 * @param {Function} [o.loadImage]  async (key) => Blob, reads the lot's stored aerial (defaults to the browser image store).
 * @param {Object} [o.terms]  { version, acceptedAt }: the plan terms acceptance printed in every sheet's title block with the sheet note (src/legal).
 * @param {boolean} [o.includeAerial=true]  "Include aerial underlay": false prints the locality plan and the existing site sheet with no aerial (the cadastre and linework stay).
 * @param {Date} [o.date]
 * @returns {Promise<{ blob: Blob, filename: string, sheets: Array, pages: number }>}
 */
export async function exportPlanSet({ project, lot = null, kind = 'site', feasibility = false, builderName = '', builder: builderIn = null, download = true, preview = false, includeAerial = true, jsPDF = null, catalogue = null, date = new Date(), aerial = null, fetchSite = undefined, loadImage = null, terms = null } = {}) {
  syncCurrency(project);
  if (!project || !Array.isArray(project.levels)) throw new Error('exportPlanSet needs a Glide Inside project');
  if (kind !== 'site' && kind !== 'house' && kind !== 'commercial') throw new Error("exportPlanSet kind must be 'site', 'house' or 'commercial'");
  const commercial = kind === 'commercial';
  if (commercial && !(project.mode === 'commercial' && project.commercial)) throw new Error('A commercial plan set needs a project in commercial mode.');
  // A commercial layout is never moved onto the lot (the house placement would drag its generated walls away from the spec).
  const prep = commercial ? { project: structuredClone(project), lot: withLotIds(toSiteLot(lot) || (lotOf(project) ? project.site.lot : null)) } : prepare(project, lot);
  if ((kind === 'site' || commercial) && !prep.lot) throw new Error(`A ${commercial ? 'commercial plan set' : 'site plan'} needs the lot (boundary polygon).`);
  const wp = prep.project;
  if (commercial) wp.site = { ...(wp.site || {}), lot: prep.lot };
  const siteLot = prep.lot; // the house plan also quotes the lot when there is one
  // The free preview: every page is stamped "PREVIEW, NOT TO SCALE" and the scale labels say so. The to-scale set needs a Plan Pack, a builder
  // or client login, a commercial subscription or an internal account (the caller decides, see src/lotcard/lot-card.js).
  const baseJsPDF = await loadJsPDF(jsPDF);
  const JsPDF = preview ? trialJsPDF(withoutScales(baseJsPDF), PREVIEW_TITLE, PREVIEW_FOOTER) : baseJsPDF;
  // Builder logins (and clients of a builder) get that builder's own title block; the object comes only from the exporting login's org.
  const bld = builderOf(builderIn || builderName);
  const builder = clean(bld?.name || builderName);
  const dateStr = clean(project.titleBlock?.date) || ddmmyyyy(date);
  // Ground and floor levels, from the same model the 3D uses (loaded on demand; none when the lot has no ground data).
  const levels = siteLot ? levelsModel(wp, siteLot, { tm: await loadTerrainModel(wp) }) : null;
  const sheets = planSetSheets({ project: wp, lot: kind === 'site' || commercial ? siteLot : null, kind, catalogue, feasibility, levels });
  const aligned = commercial ? { project: wp } : alignProject(wp);
  const id = projectCode(wp);
  const title = commercial ? commercialTitle(wp) : projectTitle(wp);
  const cmodel = commercial ? commercialModel(wp, siteLot, { levels }) : null;
  const targets = commercial ? viewTargets(wp) : [];
  const targetsByKey = new Map(targets.map((x) => [x.key, x]));
  const letters = sectionLetters(targets);
  sheets.forEach((s, i) => { s.n = i + 1; s.no = `GI-${id}-${s.code}`; if (preview) s.scale = 'NOT TO SCALE'; });

  const raw = new JsPDF({ orientation: 'landscape', unit: 'mm', format: 'a3', compress: true });
  raw.setProperties({ title: `${ascii(title)} concept plan set`, subject: 'Concept design plans, to be checked by a suitably qualified person', author: bld?.name || ENTITY, creator: bld ? `${bld.name || 'Builder'} plan set` : commercial ? 'Glide Inside commercial layout' : 'Glide Inside lot viewer' });
  const doc = withSuperscripts(cleanedDoc(raw));
  // House elevations and sections (A200, A300, A301): one pass over the 3D model, the sheet scales follow what fits.
  const viewArea = { x0: AREA.x0 + 2, y0: AREA.y0 + 2, x1: AREA.x1 - 2, y1: AREA.y1 - 8 };
  let tris = [];
  if (!commercial && sheets.some((x) => x.id === 'elev' || x.id === 'sect')) {
    try { tris = await collectTriangles(aligned.project, catalogue); } catch { tris = []; }
    for (const x of sheets.filter(() => !preview)) {
      if (x.id === 'elev') x.scale = tris.length ? `1:${elevationScale(doc, aligned.project, tris, viewArea, 1)} @ A3` : 'NTS';
      else if (x.id === 'sect') x.scale = tris.length ? `1:${sectionScale(aligned.project, tris, viewArea, 1, x.axis)} @ A3` : 'NTS';
    }
  }
  const viewCtx = { project: aligned.project, k: 1, colours: schemeColours(wp), unalign: aligned.unalign || null, paper: 'A3', ground: levels ? { lot: siteLot, levels, align: aligned.align || null, unalign: aligned.unalign || null } : null, levels };
  const address = clean(wp.titleBlock?.address || siteLot?.address || '');
  const lotDp = clean(siteLot ? titleLotDp(wp) || siteLot.lotLabel || '' : '');
  const base = { project: wp, builder: bld, client: bld ? bld.client.name || 'Not stated' : 'Glide Inside customer', projectTitle: title, address, lotDp, total: sheets.length, dateStr, jobId: id, terms };
  const facts = {};
  // Real aerial and the wider cadastre for the cover locality plan. Never fatal: without them the sheet says so.
  const locality = siteLot ? await resolveLocality({ lot: siteLot, aerial, fetchSite, loadImage, view: localityView(siteLot).view, includeAerial }) : { aerial: null };

  // The existing site sheet cannot be turned under an aerial (the image stays upright), so its scale label follows the aerial.
  if (commercial && !preview && locality.aerial) {
    const ex = sheets.find((x) => x.id === 'existing');
    if (ex) ex.scale = existingScale(wp, siteLot, { aerial: true });
  }

  sheets.forEach((s, i) => {
    if (i > 0) raw.addPage('a3', 'landscape');
    doc.setLineDashPattern([], 0);
    let strip = { n: s.n, no: s.no, title: s.title, scale: s.scale, rev: 'A', kv: [], notes: [] };
    if (commercial) {
      let r = null;
      if (s.id === 'cover') {
        const z = siteLot.zoning ? [siteLot.zoning.code && `Zone ${siteLot.zoning.code}`, siteLot.zoning.name].filter(Boolean).join(' ') : '';
        drawCover(doc, { terms, project: wp, lot: siteLot, locality, projectTitle: title, address, lotDp, builderName: builder, dateStr, catalogue, notes: sheetNotes([...(zoneMismatch(siteLot) ? [`${RESIDENTIAL_NOTE}.`] : []), ...commercialNotes(cmodel.stats)], siteLot, { aerialShown: !!locality.aerial, aerial: locality.aerial }), lotLine: [siteLot.lga, z, siteLot.areaM2 && `${Math.round(siteLot.areaM2).toLocaleString('en-AU')} m²`].filter(Boolean).join('   |   '), thumbnail: coverThumbnail(cmodel), index: sheets.map((x) => ({ no: x.no, title: x.title, scale: x.scale })) });
        strip = { ...strip, subtitle: cap1(layoutKind(cmodel.stats)), kvTitle: 'SITE DATA', kv: [['Lot area', `${Math.round(siteLot.areaM2).toLocaleString('en-AU')} m²`], ['Locality scale', `1:${localityScale(siteLot)} @ A3`], ...(cmodel.stats.units ? [['Units', String(cmodel.stats.units)]] : [])], notes: ['Concept only, for discussion.', 'Boundaries are from the cadastre and are not a survey.'] };
      } else {
        if (s.id === 'existing') r = drawExisting(doc, wp, siteLot, { aerial: locality.aerial || null, levels });
        else if (s.id === 'layout') r = drawLayout(doc, cmodel);
        else if (s.id === 'levels') r = drawLevelsPlan(doc, cmodel, levels);
        else if (s.id === 'upper') r = s.upper === 'mezz' ? drawMezzanine(doc, cmodel) : drawUpperPlans(doc, cmodel, targetsByKey.get(s.target), levels);
        else if (s.id === 'elev') r = drawElevations(doc, cmodel, targetsByKey.get(s.target), levels);
        else if (s.id === 'sect') r = drawSections(doc, cmodel, targetsByKey.get(s.target), letters.get(s.target), levels);
        else if (s.id === 'finance') r = drawFinancePage(doc, wp);
        else r = drawYield(doc, cmodel);
        strip = { ...strip, subtitle: ascii(title), kvTitle: s.id === 'existing' ? 'SITE DATA' : s.id === 'yield' || s.id === 'finance' ? 'KEY FIGURES' : s.id === 'upper' ? 'UPPER LEVEL DATA' : s.id === 'levels' ? 'LEVELS DATA' : s.id === 'elev' ? 'ELEVATION DATA' : s.id === 'sect' ? 'SECTION DATA' : 'LAYOUT DATA', kv: r.kv, notes: r.notes, blocks: r.blocks };
      }
    } else if (s.id === 'cover') {
      drawCover(doc, { terms, project: wp, lot: siteLot, locality, projectTitle: title, address, lotDp, builderName: builder, dateStr, catalogue, index: sheets.map((x) => ({ no: x.no, title: x.title, scale: x.scale })) });
      strip = { ...strip, subtitle: kind === 'site' ? 'Site plan and house plan' : 'House plan', kvTitle: 'SITE DATA', kv: siteLot ? [['Lot area', `${Math.round(siteLot.areaM2).toLocaleString('en-AU')} m²`], ['Locality scale', `1:${localityScale(siteLot)} @ A3`]] : [], notes: ['Concept only, for discussion.', 'Boundaries are from the cadastre and are not a survey.'] };
    } else if (s.id === 'site') {
      Object.assign(facts, drawSite(doc, wp, siteLot, { levels }));
      strip = { ...strip, subtitle: ascii(title), kvTitle: 'SITE DATA', kv: facts.kv, notes: facts.notes, blocks: facts.blocks };
    } else if (s.id === 'elev' || s.id === 'sect') {
      const empty = !tris.length;
      if (empty) { doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.text('The elevations and sections need a building with walls.', viewArea.x0 + 10, viewArea.y0 + 12); }
      else if (s.id === 'elev') drawHouseElevations(doc, viewCtx, tris, viewArea);
      else drawHouseSection(doc, { ...viewCtx, sectionAxis: s.axis, sectionLetter: s.letter }, tris, viewArea);
      strip = { ...strip, subtitle: ascii(title), kvTitle: s.id === 'elev' ? 'ELEVATION DATA' : 'SECTION DATA', kv: [['Scale', s.scale]], notes: s.id === 'elev' ? ['Indicative concept elevations from the 3D model.', 'Levels are indicative, from the state 5 m elevation model, not survey.'] : [`Indicative concept section ${s.letter}-${s.letter}. Structure and levels are assumed for presentation and are not designed.`] };
    } else if (s.id === 'finance') {
      const r = drawFinancePage(doc, wp);
      strip = { ...strip, subtitle: ascii(title), kvTitle: 'KEY FIGURES', kv: r.kv, notes: r.notes, blocks: r.blocks };
    } else {
      const h = drawHouseSheet(doc, aligned.project, s.house, { catalogue, northDeg: Number(aligned.project.site?.northDeg) || 0, sections: tris.length ? sheets.filter((x) => x.id === 'sect').map((x) => ({ axis: x.axis, letter: x.letter, sheet: x.code })) : [], ground: levels ? { lot: siteLot, levels, align: aligned.align || null, unalign: aligned.unalign || null } : null });
      const notes = ['Dimensions in millimetres.', 'Room areas to internal wall faces.', 'Door swings and window positions are shown as designed.', 'Confirm all dimensions on site before ordering.'];
      const kv = [...h.kv];
      const lg = groundLegendBlock(h.ground);
      if (h.ground?.stroked) { notes.push(h.ground.note); kv.push(['Contours', intervalText(h.ground.interval)]); }
      strip = { ...strip, subtitle: ascii(title), kvTitle: 'AREAS (INDICATIVE)', kv, blocks: [...(lg ? [lg] : []), ...h.blocks], notes };
    }
    strip.notes = sheetNotes(strip.notes, siteLot, { aerialShown: !!locality.aerial && ['cover', 'existing', 'site'].includes(s.id), aerial: locality.aerial });
    drawConceptNote(doc);
    drawStrip(doc, base, strip);
    if (builder) drawWatermark(raw, `Prepared for ${builder}`);
  });

  const bytes = new Uint8Array(raw.output('arraybuffer'));
  const blob = new Blob([bytes], { type: 'application/pdf' });
  const filename = `${bld?.name ? slugify(bld.name, 'builder') : 'Glide-Inside'}-${slugify(title, 'concept')}-${commercial ? 'commercial-plan-set' : kind === 'site' ? 'site-plan-set' : 'house-plan-set'}${preview ? '-preview' : ''}.pdf`;
  if (download && typeof document !== 'undefined') {
    const { downloadBlob } = await import('../download.js');
    downloadBlob(blob, filename);
  }
  void ABN;
  return { blob, filename, sheets: sheets.map(({ n, no, title: t, scale }) => ({ n, no, title: t, scale })), pages: sheets.length };
}

export default exportPlanSet;
