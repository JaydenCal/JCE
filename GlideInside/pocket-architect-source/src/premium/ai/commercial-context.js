// Compact plan context for a commercial design. Plain text, one fact per line, in the order that survives truncation: the lot and its
// controls first, then what is on it, the numbers, the checks, the feasibility, and last the catalogue. The housing context (rooms,
// walls and openings of the generated model) is not sent: it runs to thousands of lines and tells the model nothing it can use.

import { lotOf, lotDimensions } from '../../model/placement.js';
import * as G from '../../model/geometry.js';
import { isCommercial } from '../../commercial/schema.js';
import { zoneClass, effectiveClass } from '../../commercial/zones.js';
import { commercialChecks } from '../../commercial/checks.js';
import { commercialStatus } from '../../commercial/card-model.js';
import { finishesOf } from '../../commercial/finishes.js';
import { layoutUnits } from '../../commercial/layout.js';
import { LAYOUT_LIST } from '../../commercial/layouts.js';
import { measure, buildingsOf } from './commercial-core.js';
import { commercialTypes, typeLine } from './commercial-catalogue.js';
import { money } from '../../commercial/feasibility.js';
import { estimateTokens, DEFAULT_TOKEN_CAP } from './context.js';
import { today } from './commercial-brief.js';

const int = (v) => String(Math.round(Number(v) || 0));
const text = (s, n = 60) => `"${String(s ?? '').replace(/"/g, "'").replace(/\s+/g, ' ').trim().slice(0, n)}"`;
const metre = (v) => (Math.round(v * 100) / 100).toString();
const pt = (q) => `(${int(q.x)},${int(q.y)})`;
const m2 = (v) => `${Math.round(v)}m2`;

function lotLines(p) {
  const lot = lotOf(p);
  if (!lot) return ['LOT none (no lot is loaded, ask for one before planning)'];
  const out = [];
  const d = lotDimensions(lot);
  const z = zoneClass(lot);
  const id = [lot.state, lot.address && text(lot.address), lot.lotLabel && `lot ${String(lot.lotLabel).slice(0, 20)}`, lot.planLabel && String(lot.planLabel).slice(0, 20), lot.lga && `lga=${text(lot.lga)}`].filter(Boolean);
  const zone = lot.zoning?.code || lot.zoning?.name ? `zone=${text([lot.zoning.code, lot.zoning.name].filter(Boolean).join(' '))} class=${effectiveClass(p) || 'unknown'}${p.commercial.zoneClass ? '(chosen)' : ''}${z.employment ? '' : ' NOT_EMPLOYMENT_ZONE'}` : 'zone=unknown';
  out.push(`LOT ${id.join(' ')} ${zone} area=${metre(d.areaM2)}m2 ${d.hasFront ? `frontage=${metre(d.frontageM)}m depth=${metre(d.depthM)}m` : `width=${metre(d.widthM)}m depth=${metre(d.depthM)}m (frontage not set)`}`);
  if (lot.boundary.length <= 12) out.push(`LOT_BOUNDARY ${lot.boundary.map((q) => pt({ x: Math.round(q.x / 10) * 10, y: Math.round(q.y / 10) * 10 })).join(' ')}${lot.frontEdges?.length ? ` front_edges=${lot.frontEdges.join(',')}` : ''}`);
  const sb = lot.setbacks;
  if (!sb) out.push('SETBACKS not loaded (state none and say council setbacks are not loaded)');
  else {
    const kinds = sb.sources || {};
    const slot = (k) => {
      const v = sb[k];
      if (!v || typeof v.minM !== 'number') return `${k}=n/a`;
      const src = kinds[k] === 'council' ? `council ${[v.dcp, v.clause && `cl ${v.clause}`, v.page != null && `p${v.page}`].filter(Boolean).join(' ')}`.trim() : kinds[k] === 'bca' ? 'BCA, no council figure' : 'default table';
      return `${k}=${metre(v.minM)}m[${src.slice(0, 60)}]`;
    };
    out.push(`SETBACKS ${['front', 'side', 'rear', 'secondaryFront'].map(slot).join(' ')} status=indicative_check_with_council`);
  }
  if (Array.isArray(lot.envelope) && lot.envelope.length >= 3) {
    const bb = G.bbox(lot.envelope);
    out.push(`ENVELOPE x=${int(bb.minX)}..${int(bb.maxX)} y=${int(bb.minY)}..${int(bb.maxY)} pts=${lot.envelope.length}`);
  }
  return out;
}

function rowLines(c) {
  const units = layoutUnits(c);
  const out = [];
  for (const r of c.rows) {
    const u = r.unit;
    const bits = [`ROW ${r.id} x=${int(r.x)} y=${int(r.y)} rot=${int(r.rotationDeg)} count=${r.count}`, `unit=${metre(u.widthMm / 1000)}x${metre(u.depthMm / 1000)}m h=${metre(u.heightMm / 1000)}`, `doors=${u.doors.count}@${u.doors.presetId}`, `office=${u.office.enabled ? 'y' : 'n'}`, `mezz=${u.mezzanine.enabled ? 'y' : 'n'}`, `front_windows=${u.windows.front}`];
    if (r.mirrorOf) bits.push(`mirror_of=${r.mirrorOf}`);
    if (r.bays === false) bits.push('no_bays');
    if (Object.keys(r.perUnit || {}).length) bits.push('per_unit_overrides');
    out.push(bits.join(' '));
  }
  if (!c.rows.length) out.push('ROWS none');
  return { out, n: units.length };
}

function buildingLines(p) {
  const list = buildingsOf(p);
  if (!list.length) return ['BUILDINGS none'];
  return list.map((b) => `BUILDING ${b.id} type=${b.type} params=${JSON.stringify(b.params || {})} place=(${int(b.place?.x)},${int(b.place?.y)},${int(b.place?.rotationDeg)}deg)`);
}

function render(p, tier) {
  const c = p.commercial;
  const lines = [];
  lines.push(`PROJECT ${text(p.name)} type=commercial mode=commercial units=mm x=right y=down(south) date=${today()}`);
  lines.push(...lotLines(p));
  lines.push(...rowLines(c).out);
  lines.push(...buildingLines(p));
  const ms = measure(p, { value: true });
  const stats = [`units=${ms.units}`, `gfa=${m2(ms.gfaM2)}`, `by_use=${Object.entries(ms.byUse).map(([k, v]) => `${k.replace(/\s+/g, '_')}:${m2(v)}`).join(',') || 'none'}`, `coverage=${ms.coveragePct ?? 'n/a'}%`];
  if (ms.unitMix.length) stats.push(`mix=${ms.unitMix.map((x) => `${x.count}x${x.label.replace(/\s/g, '')}`).join(',')}`);
  lines.push(`STATS ${stats.join(' ')}`);
  lines.push(`PARKING required=${ms.parking.required} provided=${ms.parking.provided} accessible_required=${ms.parking.accessible.required} accessible_provided=${ms.parking.accessible.provided} rate=1_per_${Math.round(1 / (ms.parking.ratePerM2 || 1 / 75))}m2 class=${c.buildingClass} vehicle=${c.vehicle?.code}`);
  const st = commercialStatus(p);
  if (st.setback.text) lines.push(`SETBACK_STATUS ${st.setback.state}: ${st.setback.text.slice(0, 120)}`);
  if (ms.issues.length) lines.push(`LAYOUT_ISSUES ${ms.issues.slice(0, 5).join('; ')}`);
  const f = finishesOf(p);
  lines.push(`FINISHES cladding=${f.cladding} doors=${f.door}`);
  lines.push(`LAYOUT current=${c.layout?.id || 'none'} ${c.layout?.label ? text(c.layout.label, 70) : ''} available=${LAYOUT_LIST.map((l) => l.id).join(',')}`);
  const checks = commercialChecks(p);
  const warns = checks.filter((x) => x.kind === 'warn');
  const shown = tier < 1 ? checks.slice(0, 14) : warns.slice(0, 8);
  lines.push(`CHECKS warnings=${warns.length} info=${checks.length - warns.length}`);
  for (const k of shown) lines.push(`CHECK ${k.kind}${k.status ? ` [${k.status}]` : ''} ${String(k.text).replace(/\s+/g, ' ').slice(0, tier < 1 ? 170 : 110)}`);
  const v = ms.value;
  if (v) {
    const inp = v.f.inputs;
    const bit = (k, label) => `${label}=${money(inp[k].value)}[${inp[k].status}]`;
    lines.push(`FEASIBILITY area=${text(v.areaLabel)} confidence=${v.confidence || 'n/a'} ex_gst indicative inputs: ${[bit('saleRate', 'sale_per_m2'), bit('rentRate', 'rent_per_m2'), `yield=${inp.yieldPct.value}%[${inp.yieldPct.status}]`, bit('landRate', 'land_per_m2'), bit('buildRate', 'build_per_m2'), bit('siteRate', 'site_per_m2'), `fees=${inp.feesPct.value}% contingency=${inp.contPct.value}%`, inp.landPrice.value ? `land_price=${money(inp.landPrice.value)}` : null].filter(Boolean).join(' ')}`);
    lines.push(`FEASIBILITY_OUT realisation=${money(v.realisation)} cost=${money(v.cost)} margin=${money(v.margin)}(${Math.round(v.marginPct)}%) gross_rent_pa=${money(v.grossRent)} end_value=${money(v.endValue)}`);
  } else lines.push('FEASIBILITY not available for this layout');
  const types = commercialTypes();
  if (!types.length) lines.push('TYPES none (building types are not available, plan strata units only)');
  else for (const t of types) lines.push(tier < 2 ? typeLine(t) : `TYPE ${t.id} "${t.label}" ${t.category}`);
  return lines;
}

/** Build the commercial context. Returns { text, tokens, trimmed }. Over the cap, the checks, then the catalogue detail, are cut down first. */
export function buildCommercialContext(project, { maxTokens = DEFAULT_TOKEN_CAP } = {}) {
  if (!isCommercial(project)) throw new Error('This design is not in commercial mode.');
  let tier = 0;
  let out = render(project, tier).join('\n');
  while (estimateTokens(out) > maxTokens && tier < 2) {
    tier += 1;
    out = render(project, tier).join('\n');
  }
  let trimmed = tier > 0;
  if (estimateTokens(out) > maxTokens) {
    const limit = Math.floor(maxTokens * 3.5) - 40;
    out = `${out.slice(0, Math.max(0, out.lastIndexOf('\n', limit)))}\nCONTEXT TRUNCATED`;
    trimmed = true;
  }
  return { text: out, tokens: estimateTokens(out), trimmed };
}

/** The context for whatever mode the design is in. */
export async function contextFor(project, opts, housing) {
  return isCommercial(project) ? buildCommercialContext(project, opts) : housing(project, opts);
}
