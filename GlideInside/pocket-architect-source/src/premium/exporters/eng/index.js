// Engineering style plan set (A3 landscape, A1 option). Async because the elevations, section and roof plan come from the 3D model.
//   toEngineeringPDF(project, { jsPDF, image, aerial, config, catalogue, paper, date, scale, builder, logo }) -> Uint8Array
// The result has a non-enumerable `layout`: { paper, mode, sheets: [{ number, title, scale, kind }], pages: [kind] }.

import * as G from '../../../model/geometry.js';
import { rotateHouse } from '../../../model/placement.js';
import { buildingHull, orientedBox } from '../../../site/lotplan.js';
import { paperOf, levelContent, chooseScale } from '../drawing.js';
import { levelsSorted, ascii } from '../shared.js';
import { scaledDoc, drawLevel } from '../pdf.js';
import { clean, viewTitle, cleanedDoc, withSuperscripts } from './kit.js';
import { brandOf, drawingNo } from './brand.js';
import { drawFrame, BODY } from './frame.js';
import { drawSitePlan, drawSitePanel, siteFacts, siteView, SITE_VP, keyBox, localityView } from './siteplan.js';
import { AREA } from '../pdf.js';
import { resolveAerial, renderUnderlay } from './aerial.js';
import { drawCover, drawAnalysis, drawSchedules, scheduleCount, COVER_BOX } from './sheets.js';
import { collectTriangles, drawElevations, drawSection, drawRoofPlan, roofAreaM2, roofScale, elevationScale, sectionScale, drawSectionMarker } from './views.js';
import { drawLevelPanel } from './sheets.js';

/**
 * The house turned square to the page for the floor plans, roof plan and elevations (a house turned on its lot would otherwise be
 * dimensioned on a slant). North on those sheets follows the turn. The site plan and analysis keep the true orientation.
 */
export function alignProject(project) {
  const box = orientedBox(buildingHull(project));
  if (!box) return { project, deg: 0, unalign: null };
  let m = ((box.angleDeg % 90) + 90) % 90;
  if (m > 45) m -= 90;
  if (Math.abs(m) < 0.5) return { project, deg: 0, unalign: null };
  const c = structuredClone(project);
  rotateHouse(c, -m, box.centre);
  c.site = { ...(c.site || {}), northDeg: (Number(c.site?.northDeg) || 0) - m };
  return { project: c, deg: -m, unalign: (p) => G.rotatePoint(p, box.centre, m) };
}

/** The ordered sheet plan. No drawing happens here, so the drawing list on the cover and the page count agree. */
export function engineeringSheets(project, { paper = 'A3', scale = null, catalogue = null } = {}) {
  project = alignProject(project).project;
  const levels = levelsSorted(project);
  const p = paperOf(paper || project.drawing?.paper);
  const contents = levels.map((l, i) => levelContent(project, l, i === 0, catalogue));
  const picked = chooseScale(contents, scale ?? project.drawing?.scale ?? 'auto', p.name);
  const list = [{ kind: 'cover', title: 'COVER SHEET AND DRAWING LIST', scale: 'NTS' }, { kind: 'site', title: 'SITE PLAN', scale: 'AS SHOWN' }];
  levels.forEach((l, i) => list.push({ kind: 'level', level: l, content: contents[i], title: `${ascii(l.name) || 'Level'} FLOOR PLAN`.toUpperCase(), scale: `1:${picked.scale} @ ${p.name}` }));
  list.push({ kind: 'roof', title: 'ROOF PLAN', scale: 'AS SHOWN' }, { kind: 'elevations', title: 'ELEVATIONS', scale: 'AS SHOWN' }, { kind: 'section', title: 'SECTION', scale: 'AS SHOWN' }, { kind: 'analysis', title: 'SITE ANALYSIS AND SETBACKS', scale: 'NTS' });
  const n = scheduleCount(project);
  for (let i = 0; i < n; i++) list.push({ kind: 'schedule', index: i, count: n, title: n > 1 ? `SCHEDULES (${i + 1} OF ${n})` : 'SCHEDULES', scale: 'NTS' });
  list.forEach((s, i) => { s.n = i + 1; s.number = drawingNo(project, i + 1); });
  return { list, scale: picked, paper: p };
}

export async function toEngineeringPDF(project, options = {}) {
  const { jsPDF, image = null, aerial = null, config = {}, catalogue = null, date = new Date(), paper = null, scale = null } = options;
  if (typeof jsPDF !== 'function') throw new Error('toEngineeringPDF needs the jsPDF class (options.jsPDF)');
  const plan = engineeringSheets(project, { paper, scale, catalogue });
  const aligned = alignProject(project);
  const p = plan.paper;
  const raw = new jsPDF({ orientation: 'landscape', unit: 'mm', format: p.format, compress: true });
  const brand = brandOf(project, options);
  const tb = project.titleBlock || {};
  raw.setProperties({
    title: `${ascii(tb.projectName || project.name) || 'Design'} concept plan set`,
    subject: 'Concept design plans, to be verified by a suitably qualified person',
    author: brand.mode === 'builder' ? brand.name || 'Glide Inside' : ascii(tb.company) || 'Glide Inside',
    creator: 'Glide Inside Pocket Architect',
  });
  const doc = withSuperscripts(scaledDoc(raw, p.k));
  const total = plan.list.length;
  const ctx = { project, brand, unalign: aligned.unalign, date, total, paper: p.name, k: p.k, lot: project.site?.lot || null, image, catalogue, config, underlays: {}, analysisNumber: plan.list.findIndex((s) => s.kind === 'analysis') + 1 || null };
  // The aerial is composited once per view (the site plan, the key plan and the cover locality), turned and cropped as each is drawn.
  const bytes0 = await resolveAerial(project, { aerial });
  const lotA = project.site?.lot;
  if (bytes0 && lotA?.aerial?.extent) {
    const facts = siteFacts(project);
    const jobs = [];
    if (facts) { const v = siteView(project, facts, p.k); jobs.push(['site', v.T, SITE_VP, 4.4, 0.5]); }
    const kb = keyBox();
    const kv = localityView(project, kb, { minSpanM: 400, k: p.k });
    if (kv) jobs.push(['key', kv.T, kb, 6, 0.5]);
    const cv = localityView(project, COVER_BOX(ctx), { minSpanM: 280, k: p.k });
    if (cv) jobs.push(['cover', cv.T, COVER_BOX(ctx), 3.6, 0.5]);
    for (const [name, T, rect, pxPerMm, quality] of jobs) {
      const url = await renderUnderlay({ bytes: bytes0, extent: lotA.aerial.extent, planToSheet: T, rect, pxPerMm, quality, wash: 0.18 });
      if (url) ctx.underlays[name] = { url, rect };
    }
    ctx.hasAerial = Object.keys(ctx.underlays).length > 0;
  }
  const hasBuilding = levelsSorted(project).some((l) => l.walls.length);
  let tris = [];
  if (hasBuilding) {
    try { tris = await collectTriangles(aligned.project, catalogue); } catch (e) { tris = []; ctx.meshError = e; }
  }
  const roofM2 = tris.length ? roofAreaM2(tris) : null;
  const area = { x0: BODY.x0, y0: BODY.y0, x1: BODY.x1, y1: BODY.y1 };
  // Scales are known before any sheet is drawn, so the drawing list on the cover is exact.
  const apr = { ...ctx, project: aligned.project };
  const paperTag = `@ ${p.name}`;
  const siteFacts0 = siteFacts(project);
  for (const s of plan.list) {
    if (s.kind === 'site') s.scale = siteFacts0 ? `1:${siteView(project, siteFacts0, p.k).n} ${paperTag}` : 'NTS';
    else if (s.kind === 'roof' && tris.length) { const n = roofScale(tris, area, p.k); if (n) s.scale = `1:${n} ${paperTag}`; }
    else if (s.kind === 'elevations' && tris.length) s.scale = `1:${elevationScale(doc, aligned.project, tris, area, p.k)} ${paperTag}`;
    else if (s.kind === 'section' && tris.length) s.scale = `1:${sectionScale(aligned.project, tris, area, p.k)} ${paperTag}`;
  }
  const sectionSheet = plan.list.find((s) => s.kind === 'section')?.n || null;
  let site = null;
  plan.list.forEach((s, i) => {
    if (i > 0) raw.addPage(p.format, 'landscape');
    doc.setLineDashPattern([], 0);
    drawFrame(doc, ctx, { n: s.n, title: s.title, scaleLabel: s.scale });
    if (s.kind === 'cover') drawCover(doc, ctx, plan.list);
    else if (s.kind === 'site') {
      site = drawSitePlan(doc, ctx);
      drawSitePanel(doc, ctx, site);
      s.scale = site?.label || 'NTS';
    } else if (s.kind === 'level') {
      const cd = cleanedDoc(doc);
      drawLevel(cd, { project: aligned.project, catalogue, dscale: plan.scale.scale * p.k, scale: plan.scale.scale, paper: p.name, note: plan.scale.note, viewTitle }, s.content);
      // The section line and the notes beside the plan, placed with the same transform drawLevel used
      const ds = plan.scale.scale * p.k;
      const ox = AREA.x + (AREA.w - s.content.box.w / ds) / 2;
      const oy = AREA.y + (AREA.h - s.content.box.h / ds) / 2;
      const T = (q) => ({ x: ox + (q.x - s.content.box.minX) / ds, y: oy + (q.y - s.content.box.minY) / ds });
      if (tris.length) drawSectionMarker(doc, aligned.project, T, sectionSheet);
      drawLevelPanel(doc, apr, s.level, ox, { sectionSheet });
    } else if (s.kind === 'roof') drawRoofPlan(doc, apr, tris, area);
    else if (s.kind === 'elevations') {
      if (tris.length) drawElevations(doc, apr, tris, area); else emptySheet(doc, area, 'Elevations need a building with walls.');
    } else if (s.kind === 'section') {
      if (tris.length) drawSection(doc, apr, tris, area); else emptySheet(doc, area, 'The section needs a building with walls.');
    } else if (s.kind === 'analysis') drawAnalysis(doc, ctx);
    else drawSchedules(doc, ctx, s, { roofM2 });
  });
  const bytes = new Uint8Array(raw.output('arraybuffer'));
  Object.defineProperty(bytes, 'layout', {
    value: {
      style: 'engineering', paper: p.name, mode: brand.mode, scale: plan.scale.scale, note: plan.scale.note,
      pages: plan.list.map((s) => s.kind), sheets: plan.list.map((s) => ({ number: s.number, title: s.title, scale: s.scale, kind: s.kind })),
    },
    enumerable: false,
  });
  return bytes;
}

function emptySheet(doc, area, text) {
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(118, 122, 130);
  doc.text(clean(text), (area.x0 + area.x1) / 2, (area.y0 + area.y1) / 2, { align: 'center' });
}

export default toEngineeringPDF;
