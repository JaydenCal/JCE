// What the siting report says, as plain data: lot details, setbacks used and their source, constraint rows, contours and fall, building summary.
// Pure functions (no jsPDF), so the wording and the maths are tested on their own. Wording rule: indicative, never a planning or building statement.

import * as G from '../../model/geometry.js';
import { constraintSummary, CHECK_WITH_COUNCIL } from '../../site/overlays.js';
import { clearances } from '../../site/lotplan.js';
import { buildingRings } from '../../site/lotplan.js';
import { designHeights } from '../../site/setback-stage.js';
import { fitPlane } from '../../viewer3d/grading.js';
import { terrainAt, floorRLOf } from '../../site/model.js';
import { ROOM_LABELS } from '../../model/schema.js';
import { siteAreaOf, fmtArea } from './eng/area.js';

export const REPORT_LIMITATIONS = [
  'This report is indicative only. It is a concept siting aid made from the design you drew in Glide Inside and from open data. It is not a survey, a planning or building approval, an engineering design or a certificate.',
  'The lot boundary comes from the state cadastre and can differ from the registered plan and from the fences on site. Ground levels come from an elevation model and can differ from a detail survey. Commission a survey before you rely on a boundary or a level.',
  'Setbacks are worked out from the council rules held by Glide Inside, or from the default state codes where a council rule is not held. They can be out of date and other controls can apply. Confirm the setbacks, the overlays and the controls for this lot with the council before you lodge or build.',
  'Flood, bushfire, heritage and easement layers come from open government mapping and are context only. Where a layer is marked as not available or not checked, check the council map. An area with none mapped is not an all clear.',
  'Quantities and costs are indicative allowances only and are not a quote. Services, easements and the position of authority assets must be confirmed with the relevant authority.',
];

const r1 = (v) => Math.round(v * 10) / 10;
const r2 = (v) => Math.round(v * 100) / 100;
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const clean = (s) => String(s ?? '').replace(/[‒–—―−]/g, '-').replace(/[^\x20-\x7e°±²³·]/g, '').replace(/\s+/g, ' ').trim();

const COMPASS = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];
export const compassOf = (deg) => COMPASS[Math.round((((deg % 360) + 360) % 360) / 45) % 8];

/**
 * Ground fall across the lot from the terrain grid: highest and lowest sampled point, relief, and the best fit plane
 * (percent fall and the way the ground falls, as a bearing from grid north). null when the lot has no ground levels.
 * Also falls relative to the street: positive `fromStreetPct` means the ground rises from the street into the lot.
 */
export function lotFall(lot, { stepM = 2 } = {}) {
  if (!lot?.boundary?.length || !lot.terrain) return null;
  const poly = lot.boundary;
  const bb = G.bbox(poly);
  const step = stepM * 1000;
  const samples = [];
  let hi = null; let lo = null;
  for (let x = bb.minX + step / 2; x < bb.maxX; x += step) {
    for (let y = bb.minY + step / 2; y < bb.maxY; y += step) {
      const p = { x, y };
      if (!G.pointInPolygon(p, poly) || (lot.holes || []).some((h) => G.pointInPolygon(p, h))) continue;
      const rl = terrainAt(lot.terrain, x, y);
      if (rl == null) continue;
      samples.push({ x: x / 1000, z: y / 1000, y: rl });
      if (!hi || rl > hi.rl) hi = { rl, x, y };
      if (!lo || rl < lo.rl) lo = { rl, x, y };
    }
  }
  if (samples.length < 3) return null;
  const pl = fitPlane(samples);
  const grad = Math.hypot(pl.gx, pl.gz);
  // Downhill is the negative gradient. x is east, plan y is south, so grid north is -y.
  const bearing = grad < 0.002 ? null : ((Math.atan2(-pl.gx, pl.gz) * 180) / Math.PI + 360) % 360;
  let fromStreetPct = null; let frontEdge = null;
  const fe = (lot.frontEdges || [])[0];
  if (fe != null && poly[fe]) {
    const a = poly[fe]; const b = poly[(fe + 1) % poly.length];
    const e = G.norm(G.sub(b, a));
    let n = { x: -e.y, y: e.x };
    const c = G.polygonCentroid(poly);
    if (G.dot(G.sub(c, a), n) < 0) n = { x: -n.x, y: -n.y }; // inward
    fromStreetPct = r1((pl.gx * n.x + pl.gz * n.y) * 100);
    frontEdge = fe;
  }
  const centreRL = terrainAt(lot.terrain, 0, 0);
  return {
    samples: samples.length, highRL: r2(hi.rl), lowRL: r2(lo.rl), reliefM: r2(hi.rl - lo.rl), high: { x: hi.x, y: hi.y }, low: { x: lo.x, y: lo.y },
    fallPct: r1(grad * 100), fallRatio: grad > 0.002 ? `1 in ${Math.round(1 / grad)}` : 'level', bearingDeg: bearing == null ? null : Math.round(bearing), direction: bearing == null ? 'practically level' : compassOf(bearing),
    fromStreetPct, frontEdge, centreRL: centreRL == null ? null : r2(centreRL),
    contourInterval: lot.contourInterval || null,
    source: lot.provenance?.elevation?.source || lot.provenance?.elevation?.name || '',
  };
}

export function fallSentence(f) {
  if (!f) return 'No ground levels are held for this lot.';
  const dir = f.bearingDeg == null ? 'The lot is practically level.' : `The ground falls towards the ${f.direction} at about ${f.fallPct} percent (${f.fallRatio}).`;
  const street = f.fromStreetPct == null ? '' : f.fromStreetPct > 0.5 ? ` From the street the ground rises into the lot at about ${Math.abs(f.fromStreetPct)} percent.` : f.fromStreetPct < -0.5 ? ` From the street the ground falls away into the lot at about ${Math.abs(f.fromStreetPct)} percent.` : ' The lot is close to level from the street.';
  return `${dir}${street} Highest sampled ground RL ${f.highRL.toFixed(2)} m, lowest ${f.lowRL.toFixed(2)} m, a relief of ${f.reliefM.toFixed(2)} m.`;
}

const SLOT_LABELS = [['front', 'Front'], ['secondaryFront', 'Secondary street'], ['side', 'Side'], ['rear', 'Rear'], ['garage', 'Garage']];

/** Setback rows: what was used, where it came from, and how the building sits. */
export function setbackFacts(project) {
  const lot = project?.site?.lot;
  const sb = lot?.setbacks;
  if (!sb) return { available: false, basis: '', source: '', rows: [], note: 'Setbacks are not available for this lot. Check with council.' };
  const cl = (() => { try { return clearances(project); } catch { return { rows: [], byKind: {} }; } })();
  const rows = [];
  for (const [k, label] of SLOT_LABELS) {
    const slot = sb[k];
    if (!slot) continue;
    const used = num(slot.minM) != null ? `${slot.minM.toFixed(2).replace(/\.?0+$/, '')} m` : slot.behindBuildingLineM != null ? 'behind the building line' : 'see note';
    const kind = k === 'garage' ? null : k;
    const c = kind ? cl.byKind?.[kind] : null;
    rows.push({
      id: k, label, used, clause: clean(slot.clause || ''), note: clean(slot.note || ''), check: slot.flag === 'check_with_council' || sb.flag === 'check_with_council',
      clearance: c ? `${c.clearanceM.toFixed(2)} m` : '', status: c ? (c.status === 'inside' ? 'Inside' : c.status === 'outside' ? 'Short by ' + c.shortByM.toFixed(2) + ' m' : 'Not checked') : '',
    });
  }
  const src = sb.source?.kind === 'council' ? (sb.source.dcp || sb.council || 'Council DCP') : `${sb.source?.name || sb.basis || ''}${sb.source?.edition ? `, ${sb.source.edition}` : ''}`;
  return { available: true, basis: clean(sb.basis || ''), source: clean(String(src).replace(/[.\s]+$/, '')), council: clean(sb.council || lot.lga || ''), rows, inputs: sb.inputs || null, custom: sb.flag === 'user_rule', note: 'Indicative only, check with council. These distances are not a planning or building approval.' };
}

/** Overlay rows. Anything not answered says to check the council map. */
export function constraintFacts(lot) {
  return constraintSummary(lot || {}).map((r) => {
    const unanswered = r.answer === 'Not available' || r.answer === 'Not checked';
    const detail = clean(r.detail || '');
    return {
      id: r.id, title: r.title, answer: r.answer, hit: r.hit, source: clean(r.source || ''), date: r.date || null,
      detail: unanswered && !/council map/i.test(detail) ? `${detail ? `${detail} ` : ''}Check the council map.` : detail,
      checkMap: unanswered || r.answer === 'No mapped',
    };
  });
}

const AREA = (poly) => Math.abs(G.polygonArea(poly)) / 1e6;

/** Building summary for the residential or the commercial editor. */
export async function buildingFacts(project) {
  const lot = project?.site?.lot;
  const lotM2 = lot ? (siteAreaOf(lot)?.m2 ?? lot.areaM2 ?? null) : null;
  if (project.mode === 'commercial' && project.commercial) {
    const { commercialStats } = await import('../../commercial/stats.js');
    const s = commercialStats(project);
    const items = [
      ['Type', 'Commercial layout'], ['Units', String(s.units || 0)], ['Catalogue buildings', String(s.buildingCount || 0)],
      ['Gross floor area', `${s.gfaM2} m²`], ['Ground floor footprint', `${s.footprintM2} m²`],
      ['Site coverage', s.coveragePct != null ? `${s.coveragePct} percent of the lot` : 'not worked out'],
      ['Car parking provided', `${s.parking.provided} bays (${s.parking.required} required at the rate used)`],
    ];
    return { kind: 'commercial', items, footprintM2: s.footprintM2, gfaM2: s.gfaM2, coveragePct: s.coveragePct };
  }
  const levels = [...(project.levels || [])].sort((a, b) => a.elevation - b.elevation).filter((l) => (l.rooms || []).length || (l.walls || []).length);
  let indoor = 0; let beds = 0; let baths = 0; let garage = 0; let roofedOut = 0;
  const perLevel = [];
  for (const l of levels) {
    let li = 0;
    for (const r of l.rooms || []) {
      if (r.status === 'demolish' || !Array.isArray(r.polygon) || r.polygon.length < 3) continue;
      const a = AREA(r.polygon);
      if (r.outdoor) { if (r.roofed) roofedOut += a; continue; }
      li += a; indoor += a;
      if (r.type === 'bedroom') beds++;
      if (r.type === 'bathroom' || r.type === 'ensuite') baths++;
      if (r.type === 'garage') garage++;
    }
    perLevel.push({ name: clean(l.name) || 'Level', areaM2: r1(li) });
  }
  const ground = levels[0];
  let footprint = 0;
  if (ground) for (const r of ground.rooms || []) if (r.status !== 'demolish' && Array.isArray(r.polygon) && r.polygon.length >= 3 && (!r.outdoor || r.roofed)) footprint += AREA(r.polygon);
  const heights = designHeights(project);
  const items = [
    ['Type', 'Residential'], ['Storeys', String(levels.length || 0)],
    ['Bedrooms', String(beds)], ['Bathrooms and ensuites', String(baths)], ['Garages', String(garage)],
    ['Indoor floor area', `${r1(indoor)} m²`], ['Roofed outdoor area', `${r1(roofedOut)} m²`],
    ['Ground floor footprint', `${r1(footprint)} m² (rooms and roofed outdoor areas)`],
    ['Site coverage', lotM2 ? `${r1((footprint / lotM2) * 100)} percent of the lot` : 'not worked out'],
  ];
  if (heights) items.push(['Overall height', `about ${heights.buildingHeightM.toFixed(2)} m (${heights.roofNote})`]);
  if (lot && Number.isFinite(lot.floorRL)) items.push(['Floor RL', `${lot.floorRL.toFixed(2)} m`]);
  else if (lot?.terrain) items.push(['Floor RL', `${floorRLOf(lot).toFixed(2)} m (from the ground under the building)`]);
  return { kind: 'residential', items, perLevel, footprintM2: r1(footprint), indoorM2: r1(indoor), coveragePct: lotM2 ? r1((footprint / lotM2) * 100) : null, hasBuilding: buildingRings(project).length > 0 };
}

/** Lot details rows: address, lot and DP, area, zoning, council, state. Unknowns say so. */
export function lotFacts(project) {
  const lot = project?.site?.lot;
  if (!lot) return { available: false, items: [] };
  const area = siteAreaOf(lot);
  const zone = lot.zoning?.code ? `${lot.zoning.code}${lot.zoning.name ? ` ${lot.zoning.name}` : ''}` : '';
  const items = [
    ['Address', clean(lot.address) || 'not given'],
    ['Lot and plan', [lot.lotNumber ? `Lot ${lot.lotNumber}` : '', lot.planLabel || ''].filter(Boolean).join(' ') || clean(lot.lotLabel) || 'not given'],
    ['Lot area', area ? `${fmtArea(area.m2)}${area.source === 'registered' ? ' (registered)' : ' (from the mapped boundary)'}` : lot.areaM2 ? `${Math.round(lot.areaM2)} m²` : 'not given'],
    ['Zoning', zone ? `${clean(zone)}${lot.zoning.instrument ? ` (${clean(lot.zoning.instrument)})` : ''}` : (lot.zoneNote ? clean(lot.zoneNote) : 'not known, check the council planning map')],
    ['Council', clean(lot.lga) || 'not given'], ['State', clean(lot.state) || 'not given'],
    ['Frontage', (lot.frontEdges || []).length ? `${lot.frontEdges.length} street edge${lot.frontEdges.length === 1 ? '' : 's'}${lot.cornerLot ? ', corner lot' : ''}${lot.frontageConfirmed ? '' : ' (not yet confirmed)'}` : 'not set'],
    ['Lot data', clean(lot.provenance?.lot?.attribution) || (lot.sample ? 'Sample lot' : lot.source || '')],
  ].filter((r) => r[1] !== '');
  return { available: true, items, sample: !!lot.sample || !!lot.demo };
}

export { CHECK_WITH_COUNCIL };
