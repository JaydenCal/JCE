// Engineering style plan set (A3 landscape, A1 option). Async because the elevations, section and roof plan come from the 3D model.
//   toEngineeringPDF(project, { jsPDF, image, aerial, config, catalogue, paper, date, scale, builder, logo }) -> Uint8Array
// The result has a non-enumerable `layout`: { paper, mode, sheets: [{ number, title, scale, kind }], pages: [kind] }.

import * as G from '../../../model/geometry.js';
import { schemeColours } from '../../../model/colour-schemes.js';
import { rotateHouse } from '../../../model/placement.js';
import { buildingHull, orientedBox } from '../../../site/lotplan.js';
import { paperOf, levelContent, chooseScale } from '../drawing.js';
import { levelsSorted, ascii, outlineBox } from '../shared.js';
import { scaledDoc, drawLevel } from '../pdf.js';
import { clean, viewTitle, cleanedDoc, withSuperscripts } from './kit.js';
import { brandOf, drawingNo, projectTitle } from './brand.js';
import { drawFrame, BODY } from './frame.js';
import { drawSitePlan, drawSitePanel, siteFacts, siteView, SITE_VP, keyBox, localityView } from './siteplan.js';
import { AREA } from '../pdf.js';
import { resolveAerial, renderUnderlay } from './aerial.js';
import { drawCover, drawAnalysis, drawSchedules, scheduleCount, COVER_BOX } from './sheets.js';
import { collectTriangles, drawElevations, drawSection, drawRoofPlan, roofAreaM2, roofScale, elevationScale, sectionScale, drawSectionMarker, sectionLinePlan } from './views.js';
import { drawRoomLabels } from './roomlabels.js';
import { stairGeometry } from '../shared.js';
import { drawLevelPanel, analysisScale } from './sheets.js';

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
  const list = [{ kind: 'cover', title: 'COVER SHEET AND DRAWING LIST', scale: 'AS SHOWN' }, { kind: 'site', title: 'SITE PLAN', scale: 'AS SHOWN' }];
  levels.forEach((l, i) => list.push({ kind: 'level', level: l, content: contents[i], title: `${ascii(l.name) || 'Level'} FLOOR PLAN`.toUpperCase(), scale: `1:${picked.scale} @ ${p.name}` }));
  list.push({ kind: 'roof', title: 'ROOF PLAN', scale: 'AS SHOWN' }, { kind: 'elevations', title: 'ELEVATIONS', scale: 'AS SHOWN' }, { kind: 'section', title: 'SECTION', scale: 'AS SHOWN' }, { kind: 'analysis', title: 'SITE ANALYSIS AND SETBACKS', scale: 'NTS' });
  const n = scheduleCount(project);
  for (let i = 0; i < n; i++) list.push({ kind: 'schedule', index: i, count: n, title: n > 1 ? `SCHEDULES (${i + 1} OF ${n})` : 'SCHEDULES', scale: 'NTS' });
  list.forEach((s, i) => { s.n = i + 1; s.number = drawingNo(project, i + 1); });
  return { list, scale: picked, paper: p };
}

/** Moves the figure of a dimension string along the string when the section line would run through it. */
function clearOfLine(d, sl, ds) {
  if (!sl || !d.textAt) return d;
  const vertical = d.textRot === 90;
  const ln = (u) => ({ x: sl.p0.x + (sl.p1.x - sl.p0.x) * u, y: sl.p0.y + (sl.p1.y - sl.p0.y) * u });
  const dx = sl.p1.x - sl.p0.x;
  const dy = sl.p1.y - sl.p0.y;
  const pos = (pt) => (vertical ? pt.y : pt.x);
  const across = vertical ? d.a.x : d.a.y;
  // Where the section line meets the string's own line
  const u = vertical ? (Math.abs(dx) < 1 ? null : (across - sl.p0.x) / dx) : (Math.abs(dy) < 1 ? null : (across - sl.p0.y) / dy);
  if (u == null || u < 0 || u > 1) return d;
  const at = pos(ln(u));
  const lo = Math.min(pos(d.a), pos(d.b));
  const hi = Math.max(pos(d.a), pos(d.b));
  const tp = pos(d.textAt);
  const clear = 5 * ds;
  if (at < lo || at > hi || Math.abs(tp - at) > clear) return d;
  const want = at + (tp >= at ? 1 : -1) * Math.min(clear, (hi - lo) / 2 + 0.6 * ds);
  const textAt = vertical ? { x: d.textAt.x, y: want } : { x: want, y: d.textAt.y };
  return { ...d, textAt };
}

/** UP on the stair of the ground floor and DN on the same stair where it arrives on the upper floor, drawn as an outline with treads. */
function drawStairNotes(doc, project, level, T) {
  const boxes = [];
  const levels = levelsSorted(project);
  const idx = levels.findIndex((l) => l.id === level.id);
  const stairs = idx > 0 ? levels[idx - 1].stairs || [] : level.stairs || [];
  for (const st of stairs) {
    const g = stairGeometry(st);
    if (idx > 0) {
      doc.setDrawColor(90, 94, 102);
      doc.setLineWidth(0.18);
      doc.setLineDashPattern([2, 1], 0);
      const c = g.corners.map(T);
      for (let i = 0; i < 4; i++) doc.line(c[i].x, c[i].y, c[(i + 1) % 4].x, c[(i + 1) % 4].y);
      doc.setLineWidth(0.1);
      for (const t of g.treads) doc.line(T(t[0]).x, T(t[0]).y, T(t[1]).x, T(t[1]).y);
      doc.setLineDashPattern([], 0);
    }
    const c0 = g.corners.map(T);
    boxes.push({ x0: Math.min(...c0.map((q) => q.x)) - 0.5, y0: Math.min(...c0.map((q) => q.y)) - 0.5, x1: Math.max(...c0.map((q) => q.x)) + 0.5, y1: Math.max(...c0.map((q) => q.y)) + 0.5 });
    const mid = { x: c0.reduce((a, q) => a + q.x, 0) / 4, y: c0.reduce((a, q) => a + q.y, 0) / 4 };
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(40, 44, 52);
    const w = doc.getTextWidth(idx > 0 ? 'DN' : 'UP') + 1.6;
    doc.setFillColor(255, 255, 255);
    doc.rect(mid.x - w / 2, mid.y - 2.6, w, 4.4, 'F');
    doc.text(idx > 0 ? 'DN' : 'UP', mid.x, mid.y + 0.8, { align: 'center' });
  }
  return boxes;
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
    title: `${ascii(projectTitle(project)) || 'Design'} concept plan set`,
    subject: 'Concept design plans, to be verified by a suitably qualified person',
    author: brand.mode === 'builder' ? brand.name || 'Glide Inside' : ascii(tb.company) || 'Glide Inside',
    creator: 'Glide Inside Pocket Architect',
  });
  const doc = withSuperscripts(scaledDoc(raw, p.k));
  const total = plan.list.length;
  const ctx = { colours: schemeColours(project), project, brand, unalign: aligned.unalign, date, total, paper: p.name, k: p.k, lot: project.site?.lot || null, image, catalogue, config, underlays: {}, analysisNumber: plan.list.findIndex((s) => s.kind === 'analysis') + 1 || null };
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
    else if (s.kind === 'analysis') { const an = analysisScale(project, p.k); if (an) s.scale = `1:${an} ${paperTag}`; }
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
      // The transform drawLevel uses, so the section line, the room labels and the notes line up with the plan
      const ds = plan.scale.scale * p.k;
      const ox = AREA.x + (AREA.w - s.content.box.w / ds) / 2;
      const oy = AREA.y + (AREA.h - s.content.box.h / ds) / 2;
      const T = (q) => ({ x: ox + (q.x - s.content.box.minX) / ds, y: oy + (q.y - s.content.box.minY) / ds });
      // Half the length of the section line on this level: out past the walls of this level and its dimension strings
      let half = null;
      const pl0 = tris.length ? sectionLinePlan(aligned.project) : null;
      const ob = outlineBox(s.level, s.content.shapes);
      if (pl0 && ob) {
        const c = G.lerp(pl0.p0, pl0.p1, 0.5);
        const along = [[ob.minX, ob.minY], [ob.maxX, ob.minY], [ob.maxX, ob.maxY], [ob.minX, ob.maxY]].map(([x, y]) => (x - c.x) * pl0.right.x + (y - c.y) * pl0.right.y);
        half = { neg: Math.max(0, -Math.min(...along)) + 1750, pos: Math.max(0, Math.max(...along)) + 1750 };
      }
      const sl = tris.length ? sectionLinePlan(aligned.project, half) : null;
      // A dimension figure that the section line would cut through moves along its string to clear the line
      const content = { ...s.content, dims: (s.content.dims || []).map((d) => clearOfLine(d, sl, ds)) };
      drawLevel(cd, { project: aligned.project, catalogue, dscale: ds, scale: plan.scale.scale, paper: p.name, note: plan.scale.note, viewTitle, noRoomLabels: true }, content);
      if (sl) drawSectionMarker(doc, aligned.project, T, sectionSheet, half);
      const stairBoxes = drawStairNotes(doc, aligned.project, s.level, T);
      drawRoomLabels(doc, { extra: stairBoxes, content, T, catalogue, section: sl ? [T(sl.p0), T(sl.p1)] : null, bounds: { x0: BODY.x0, y0: BODY.y0, x1: BODY.x1, y1: BODY.y1 } });
      drawLevelPanel(doc, apr, s.level, ox, { sectionSheet });
    } else if (s.kind === 'roof') drawRoofPlan(doc, apr, tris, area);
    else if (s.kind === 'elevations') {
      if (tris.length) drawElevations(doc, apr, tris, area); else emptySheet(doc, area, 'Elevations need a building with walls.');
    } else if (s.kind === 'section') {
      if (tris.length) drawSection(doc, apr, tris, area); else emptySheet(doc, area, 'The section needs a building with walls.');
    } else if (s.kind === 'analysis') drawAnalysis(doc, ctx);
    else drawSchedules(doc, ctx, s, { roofM2, alignedProject: aligned.project });
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
