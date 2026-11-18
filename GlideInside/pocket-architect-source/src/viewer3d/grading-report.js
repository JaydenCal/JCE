// What the grading did, for the panel, step 4 and the plan set: indicative cut and fill, the retaining edges and the grade check lines.
// Pure (no DOM, no three.js). Wording is indicative throughout: "within typical guidance" or "steeper than typical guidance, check with your
// engineer and council". Volumes are indicative: no topsoil strip, bulking or pavement boxing.
import * as G from '../model/geometry.js';
import * as S from './site-geom.js';
import { terrainModel, retainingEdges } from './terrain.js';
import { LIMITS, GRADE_CHANGE_SPAN_M } from './grade-limits.js';

/** Cut and fill (m3) over the points of a grid that pass inside(x, y): design above the natural ground is fill. */
export function volumesOver(box, stepMm, rawAt, designAt, inside) {
  let cut = 0; let fill = 0; let maxCut = 0; let maxFill = 0;
  const a = (stepMm / 1000) ** 2;
  for (let x = box.minX + stepMm / 2; x < box.maxX; x += stepMm) for (let y = box.minY + stepMm / 2; y < box.maxY; y += stepMm) {
    if (inside && !inside(x, y)) continue;
    const d = designAt(x, y) - rawAt(x, y);
    if (d > 0.005) { fill += d * a; if (d > maxFill) maxFill = d; } else if (d < -0.005) { cut += -d * a; if (-d > maxCut) maxCut = -d; }
  }
  return { cutM3: Math.round(cut), fillM3: Math.round(fill), netM3: Math.round(fill - cut), deepestCutM: Math.round(maxCut * 100) / 100, deepestFillM: Math.round(maxFill * 100) / 100 };
}

const pct = (v) => `${(Math.abs(v) * 100).toFixed(1)} percent`;

/** Grade check lines for the design elements: { id, kind, fall, within, text }. Indicative; the limits are in grade-limits.js. */
export function gradeLines(tm) {
  const out = [];
  if (!tm?.fds) return out;
  for (const e of tm.fds.elements) {
    if (e.kind === 'paving') {
      const steep = e.fall > LIMITS.carParkAlongBays + 1e-9;
      const flat = e.fall < LIMITS.minDrainageFall - 1e-9;
      const tb = !!e.towardsBuilding;
      const within = !steep && !tb;
      out.push({ id: e.id, kind: e.kind, fall: e.fall, within, text: `Paved area ${e.id.split(':')[1] * 1 + 1}: fall ${pct(e.fall)}${flat && e.fall > 0 ? ', flatter than the typical drainage fall' : ''}, ${within ? 'within typical guidance' : tb ? 'falls towards a building, check drainage with your engineer' : 'steeper than typical guidance, check with your engineer and council'}.` });
    } else if (e.kind === 'drive') {
      const steep = e.fall > LIMITS.drivewayMax + 1e-9;
      const change = e.fall > LIMITS.gradeChangeCrest * 1.0; // a drive that starts flat on the pad changes grade by its full fall at the pad
      const within = !steep && !change;
      out.push({ id: e.id, kind: e.kind, fall: e.fall, within, text: `Driveway: grade ${pct(e.fall)}, ${within ? 'within typical guidance' : 'steeper than typical guidance, check with your engineer and council'}.` });
    }
  }
  return out;
}

/**
 * gradingReport(project, { stepMm }) -> { volumes, retaining, lines, pads, hasGrading } | null (no terrain or no design surface).
 * Volumes are counted inside the lot boundary only, and the held existing road is excluded.
 */
export function gradingReport(project, { stepMm = 1000, tm = null } = {}) {
  const lot = project.site?.lot;
  if (!lot?.terrain || !lot.boundary || lot.boundary.length < 3) return null;
  const model = tm || terrainModel(project, { cellM: stepMm / 1000 });
  if (!model?.grading) return null;
  const ring = lot.boundary;
  const roads = model.grading.elements.filter((e) => e.road);
  const inside = (x, y) => G.pointInPolygon({ x, y }, ring) && !roads.some((r) => G.pointInPolygon({ x, y }, r.polys[0]));
  const bb = G.bbox(ring);
  const volumes = volumesOver(bb, stepMm, model.rawAt, (x, y) => model.heightAt(x, y), inside);
  const ret = retainingEdges(model, lot);
  const lines = gradeLines(model);
  if (ret.maxM > 0.3) lines.push({ id: 'retaining', kind: 'retaining', within: false, text: `A retaining edge up to ${ret.maxM.toFixed(1)} m high is needed along ${Math.round(ret.lengthM)} m of the boundary where the grading does not fit, check with your engineer.` });
  return { volumes, retaining: { maxM: Math.round(ret.maxM * 100) / 100, lengthM: Math.round(ret.lengthM) }, lines, pads: model.pads.map((p) => ({ id: p.id, dy: p.dy, dyAuto: p.dyAuto })), hasGrading: true, span: GRADE_CHANGE_SPAN_M };
}

/** The lines step 4 and the plan set print: cut, fill, net and the grade lines. */
export function gradingTextLines(rep) {
  if (!rep) return [];
  const v = rep.volumes;
  return [`Indicative earthworks inside the lot: cut ${v.cutM3} m³, fill ${v.fillM3} m³, net ${v.netM3 >= 0 ? 'fill' : 'cut'} ${Math.abs(v.netM3)} m³; deepest cut ${v.deepestCutM} m, deepest fill ${v.deepestFillM} m. No topsoil strip, bulking or pavement boxing.`, ...rep.lines.map((l) => l.text)];
}
