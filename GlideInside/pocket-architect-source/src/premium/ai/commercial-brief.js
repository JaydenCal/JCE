// The written outputs of the commercial assistant: the explanation of the checks and parking, and the short development brief that
// goes with the plan set. Built from the project by code, so every figure comes from the model and every control carries its source and
// status. Wording rules: no em or en dashes, never "compliant", no builder or product brand names, "check with council", DD/MM/YYYY,
// and never a claim of approval.

import { lotOf } from '../../model/placement.js';
import { isCommercial } from '../../commercial/schema.js';
import { commercialChecks } from '../../commercial/checks.js';
import { commercialStatus } from '../../commercial/card-model.js';
import { zoneClass, effectiveClass } from '../../commercial/zones.js';
import { defaultRulesFor, ACCESSIBLE_RATE } from '../../commercial/rules.js';
import { facts, statusText } from '../../commercial/dataset.js';
import { money, pct1, CAVEAT, GST_NOTE, RENT_NOTE, DATA_DATE } from '../../commercial/feasibility.js';
import { lotDimensions } from '../../model/placement.js';
import { measure, indicative, buildingsOf, fail } from './commercial-core.js';
import { typeById } from './commercial-catalogue.js';

export const NOT_APPROVAL = 'This brief is a planning aid. It is not an approval and it does not confirm that the development is permitted. Check with council.';
const ACCESS_FACT = { class_5: 'accessibleClass5', class_6: 'accessibleClass6', class_7: 'accessibleClass7', class_8: 'accessibleClass8' };
const STATUS_WORDS = {
  VERIFIED_PRIMARY: 'VERIFIED_PRIMARY, read from the primary text',
  VERIFIED_SECONDARY: 'VERIFIED_SECONDARY, verify against the standard',
  UNVERIFIED: 'UNVERIFIED, do not rely on it',
  ESTIMATE: 'ESTIMATE',
  PORTAL: 'PORTAL, market listings',
  EDITED: 'EDITED by the person',
};
export const statusLabel = (s) => STATUS_WORDS[s] || String(s || 'UNVERIFIED');
const m = (v, d = 1) => (Math.round(v * 10 ** d) / 10 ** d).toString();
const m2 = (v) => `${Math.round(v).toLocaleString('en-AU')} m²`;

/** Today as DD/MM/YYYY. */
export function today(now = new Date()) {
  const d = String(now.getDate()).padStart(2, '0');
  const mo = String(now.getMonth() + 1).padStart(2, '0');
  return `${d}/${mo}/${now.getFullYear()}`;
}

/** Strip anything the wording rules forbid from text that came from elsewhere (dash characters become commas or plain hyphens). */
export function cleanWording(text) {
  return String(text ?? '')
    .replace(/\s[–—]\s/g, ', ')
    .replace(/[–—]/g, '-')
    .replace(/\bcompliant\b/gi, 'inside the indicative controls')
    .replace(/\bcompliance\b/gi, 'conformity');
}

/** Controls with their source and status: the lines of section 2 of the brief, and the basis the assistant quotes. */
export function controlLines(p) {
  const c = p.commercial;
  const lot = lotOf(p);
  const out = [];
  const z = zoneClass(lot);
  const cls = effectiveClass(p);
  if (lot?.zoning?.code || lot?.zoning?.name) {
    out.push(`Zone: ${[lot.zoning.code, lot.zoning.name].filter(Boolean).join(' ')}${c.zoneClass ? `, treated as ${c.zoneClass} (chosen by the person)` : z.employment ? ', looked up from the planning dataset' : ', not an employment zone, check with council'}. Status: looked up, check with council.`);
  } else out.push('Zone: not known for this lot. Choose the zone class and check with council. Status: UNVERIFIED.');
  const sb = lot?.setbacks;
  if (sb) {
    const kind = sb.sources || {};
    for (const [slot, label] of [['front', 'Front setback'], ['side', 'Side setback'], ['rear', 'Rear setback'], ['secondaryFront', 'Secondary frontage setback']]) {
      const v = sb[slot];
      if (!v || typeof v.minM !== 'number') continue;
      const src = kind[slot];
      const cite = src === 'council' ? [v.dcp, v.clause && `cl ${v.clause}`, v.page != null && `p${v.page}`].filter(Boolean).join(' ') : '';
      const status = src === 'council' ? 'council rule read from the DCP, check with council' : src === 'bca' ? 'no council figure, set by the BCA, check with council and the certifier' : 'indicative default table, not a confirmed control';
      out.push(`${label}: ${m(v.minM)} m${cite ? `. Source: ${cite}` : `. Source: ${v.basis || 'indicative default table'}`}. Status: ${status}.`);
    }
  } else out.push('Setbacks: not loaded for this lot, so none are stated. Check with council.');
  if (cls) out.push(`Site coverage: indicative maximum ${defaultRulesFor(cls).coverageMaxPct}% for the ${cls} class. Source: default table. Status: ESTIMATE, check with council.`);
  const rate = c.rates?.parkingPerM2Gfa;
  const pf = facts('parkingUnits');
  out.push(`Parking: 1 space per ${Math.round(1 / (rate || 1 / 75))} m² of GFA for unit complexes, office 1 per ${Math.round(1 / (c.rates?.officePerM2 || 1 / 40))} m². Source: ${pf.clause || 'council DCP'}. Status: ${statusLabel(pf.status)}, check with council.`);
  const af = facts(ACCESS_FACT[c.buildingClass] || 'accessibleClass8');
  out.push(`Accessible bays: ${ACCESSIBLE_RATE.basis}. Status: ${statusLabel(af.status)}.`);
  const mz = facts('mezzClear');
  if ((c.rows || []).some((r) => r.unit?.mezzanine?.enabled)) out.push(`Mezzanine clear heights: ${mz.clause || 'NCC 2022'}. Status: ${statusLabel(mz.status)}.`);
  return out;
}

/** The checks list explained in plain words, with the parking working. Returns { report }. */
export function explainChecks(p) {
  if (!isCommercial(p)) fail('This design is not in commercial mode.');
  const c = p.commercial;
  const ms = measure(p);
  const st = commercialStatus(p);
  const lines = [];
  const pk = ms.parking;
  const rate = Math.round(1 / (c.rates?.parkingPerM2Gfa || 1 / 75));
  lines.push(`Parking: ${pk.required} bays indicated, ${pk.provided} shown. The units need ${pk.unitsRequired} at 1 space per ${rate} m² of GFA including mezzanine${c.rates?.officeSeparate !== false ? ' (office floor area at its own rate)' : ''}, fractions rounded up once on the total.${pk.required > pk.unitsRequired ? ` Buildings add ${pk.required - pk.unitsRequired}.` : ''} Accessible bays: ${pk.accessible.provided} shown of ${pk.accessible.required} indicated (${ACCESSIBLE_RATE.basis}).`);
  if (st.setback.text) lines.push(`Setbacks: ${st.setback.text}.`);
  const checks = commercialChecks(p);
  const warns = checks.filter((x) => x.kind === 'warn');
  lines.push(warns.length ? `${warns.length} item${warns.length === 1 ? '' : 's'} to look at:` : 'No warnings are showing.');
  for (const w of warns.slice(0, 10)) lines.push(`- ${w.text}${w.status ? ` (${statusLabel(w.status)})` : ''}`);
  const infos = checks.filter((x) => x.kind === 'info');
  for (const i of infos.slice(0, 6)) lines.push(`- Note: ${i.text}${i.status ? ` (${statusLabel(i.status)})` : ''}`);
  for (const i of ms.issues) if (!warns.some((w) => w.text.includes(i.slice(0, 20)))) lines.push(`- ${i}`);
  lines.push('All of these are indicative. Check with council.');
  return { report: cleanWording(lines.join('\n')) };
}

const buildingLine = (b) => {
  const t = typeById(b.type);
  const bits = Object.entries(b.params || {}).slice(0, 5).map(([k, v]) => `${k} ${v}`).join(', ');
  return `${t?.label || b.type}${bits ? ` (${bits})` : ''}`;
};

const STATE_NAMES = { NSW: 'New South Wales', VIC: 'Victoria', QLD: 'Queensland', SA: 'South Australia', WA: 'Western Australia', TAS: 'Tasmania', NT: 'Northern Territory', ACT: 'Australian Capital Territory' };

/** The address with the state added only when the address does not already end in or contain it. */
export function addressLine(lot) {
  const a = String(lot?.address || '').trim();
  if (!a) return 'not recorded';
  const st = String(lot?.state || '').trim();
  if (!st) return a;
  const names = [st, STATE_NAMES[st.toUpperCase()]].filter(Boolean).map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return new RegExp(`\\b(${names.join('|')})\\b`, 'i').test(a) ? a : `${a} ${st.toUpperCase()}`;
}

/** "Lot 12 DP 1198432": the plan label once, even when the lot label already carries it. */
export function lotPlanLine(lot) {
  const lotL = String(lot?.lotLabel || '').trim();
  const plan = String(lot?.planLabel || '').trim();
  if (lotL && plan) return lotL.toUpperCase().includes(plan.toUpperCase()) ? lotL : `${lotL} ${plan}`;
  return lotL || plan || 'not recorded';
}

/** Council area in title case with "Council" added: "TAMWORTH REGIONAL" becomes "Tamworth Regional Council". */
export function councilName(lga) {
  const raw = String(lga || '').trim().replace(/\s+/g, ' ');
  if (!raw) return 'not recorded';
  const t = raw.toLowerCase().replace(/(^|[\s'(-])([a-z])/g, (m, a, b) => a + b.toUpperCase());
  return /\b(council|shire|city|municipality)\b/i.test(t) ? t : `${t} Council`;
}

/** Sections of the development brief: [{ title, lines }]. */
export function briefSections(p) {
  const c = p.commercial;
  const lot = lotOf(p);
  const ms = measure(p, { value: true });
  const d = lot ? lotDimensions(lot) : null;
  const ind = ms.value || indicative(p);
  const sections = [];
  const site = [];
  site.push(`Address: ${addressLine(lot)}`);
  site.push(`Lot and plan: ${lotPlanLine(lot)}`);
  site.push(`Council area: ${councilName(lot?.lga)}`);
  site.push(`Lot area: ${ms.lotM2 ? m2(ms.lotM2) : 'not recorded'}${d?.hasFront ? `, frontage ${m(d.frontageM)} m, depth ${m(d.depthM)} m` : ''}`);
  site.push(`Date: ${today()}`);
  sections.push({ title: 'Site', lines: site });
  sections.push({ title: 'Controls, sources and status', lines: controlLines(p) });
  const mix = [];
  if (ms.units) mix.push(`Strata units: ${ms.units} (${ms.unitMix.map((x) => `${x.count} at ${x.label}`).join(', ')})`);
  for (const b of buildingsOf(p)) mix.push(`Building: ${buildingLine(b)}`);
  if (!mix.length) mix.push('No units or buildings are on the lot yet.');
  if (c.layout?.label) mix.push(`Layout: ${c.layout.label}`);
  sections.push({ title: 'Proposed mix', lines: mix });
  const yieldLines = [`Gross floor area: ${m2(ms.gfaM2)}`];
  for (const [k, v] of Object.entries(ms.byUse)) yieldLines.push(`- ${k}: ${m2(v)}`);
  yieldLines.push(`Site coverage: ${ms.coveragePct != null ? `${ms.coveragePct}%` : 'not worked out'} of the lot`);
  yieldLines.push(`Parking: ${ms.parking.provided} bays shown against ${ms.parking.required} indicated, ${ms.parking.accessible.provided} accessible of ${ms.parking.accessible.required} indicated`);
  sections.push({ title: 'Yield', lines: yieldLines });
  const fz = [];
  if (ind) {
    const f = ind.f;
    fz.push(`Market area used: ${ind.areaLabel} (confidence: ${ind.confidence || 'not stated'})`);
    fz.push(`Indicative gross realisation ${money(ind.realisation)}, indicative total cost ${money(ind.cost)}, indicative margin ${money(ind.margin)} (${pct1(ind.marginPct)} on cost)`);
    fz.push(`Indicative gross rent ${money(ind.grossRent)} per year`);
    for (const [k, label] of [['saleRate', 'Sale rate per m²'], ['rentRate', 'Rent rate per m²'], ['buildRate', 'Build rate per m²'], ['landRate', 'Land rate per m²']]) {
      const x = f.inputs[k];
      if (x) fz.push(`- ${label}: ${money(x.value)}. Status: ${statusLabel(x.status)}`);
    }
    if (buildingsOf(p).length) fz.push('Buildings are costed at the build rate of their type (status ESTIMATE) and valued at the unit sale and rent rates, so treat their figures as a rough guide only.');
    fz.push(`${CAVEAT} ${GST_NOTE} ${RENT_NOTE} Data as at ${DATA_DATE}.`);
  } else fz.push('Feasibility could not be worked out for this layout.');
  sections.push({ title: 'Indicative feasibility', lines: fz });
  const risks = [];
  for (const w of commercialChecks(p).filter((x) => x.kind === 'warn').slice(0, 5)) risks.push(w.text);
  for (const i of ms.issues.slice(0, 3)) risks.push(i);
  risks.push('Permissibility of the use in the zone and the planning pathway, check with council.');
  risks.push('Flooding and overland flow: flood level advice has not been sought.');
  risks.push('Access and traffic: the driveway, turning paths for the design vehicle and any traffic assessment are not resolved.');
  risks.push('Services capacity for water, sewer, power and stormwater is not confirmed.');
  risks.push('Ground conditions and any contamination are not known.');
  risks.push('The setbacks, parking rates and cost rates are indicative and may change.');
  sections.push({ title: 'Risks', lines: [...new Set(risks)] });
  sections.push({ title: 'Next steps', lines: [
    'Order Dial Before You Dig (BYDA) plans for the lot and the street frontage.',
    'Commission a detail and level survey.',
    'Commission a geotechnical investigation.',
    'Ask council for flood information and the flood planning level.',
    'Prepare a traffic and access assessment if council asks for one.',
    'Have a registered engineer review the civil design, drainage and pavement.',
    'Hold a pre lodgement meeting with council to confirm the controls above.',
  ] });
  return sections;
}

/** The brief as text and as sections. Stored on the project by the draft_brief operation. */
export function draftBrief(p, now = new Date()) {
  if (!isCommercial(p)) fail('This design is not in commercial mode.');
  const sections = briefSections(p).map((s) => ({ title: cleanWording(s.title), lines: s.lines.map(cleanWording) }));
  const nm = String(p.name || '').trim();
  const head = nm && !/^untitled/i.test(nm) ? `Development brief: ${cleanWording(nm)}` : 'Development brief';
  const text = [head, today(now), '', ...sections.flatMap((s, i) => [`${i + 1}. ${s.title}`, ...s.lines.map((l) => (/^- /.test(l) ? l : `- ${l}`)), '']), cleanWording(NOT_APPROVAL)].join('\n');
  return { date: today(now), text, sections, notApproval: NOT_APPROVAL };
}
