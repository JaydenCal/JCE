/**
 * Stage 9: the stormwater helper. Types of the server answer (POST /projects/{id}/stormwater/analyse) and the pure functions that turn it into what the panel shows.
 *
 * The server is authoritative: nothing is calculated here. Every value carries its basis; a value the server could not resolve is shown as UNRESOLVED with how to
 * supply it; a calculation the server did not evaluate is shown as NOT EVALUATED with the inputs that are missing. No dash characters are used in the wording.
 */
export interface SwValue {
  value: number | string | boolean | null; unit?: string; basis: string; ref?: string; stamp?: string; key?: string; how?: string;
}
export interface SwMissing { id: string; area: string; what: string; key: string | null; how: string }
export interface SwRoute { to: string | null; path: string[]; basis: string; reason?: string }
export interface SwRow {
  id: string; object_id: string; object_type: string; label: string; status: string; phases: string[]; surface: string; surface_label: string; area_m2: number | null; area_basis: string;
  area_note: string; runoff: SwValue; ca_m2: number | null; split: string | null; route?: SwRoute;
}
export interface SwSurfaceTotal { surface: string; label: string; area_m2: number; ca_m2: number; area_unknown: number; coeff_unknown: number; objects: number }
export interface SwTotals { phase: string; by_surface: SwSurfaceTotal[]; area_m2: number; ca_m2: number; complete: boolean; weighted_c: number | null; objects: number; status?: string }
export interface SwUnclassified { status: string; message: string; lot_area_m2: number | null; covered_m2: number | null; unclassified_m2: number | null }
export interface SwComparison {
  pre: SwTotals; post: SwTotals; pre_status: 'OK' | 'NOT SET'; pre_message: string; pre_unclassified: SwUnclassified; post_unclassified: SwUnclassified;
  post_overlaps: { overlap_m2: number; pairs: { a: string; b: string; area_m2: number }[] };
}
export interface SwDestination { destination: string; type: string | null; area_m2: number; ca_m2: number; ca_unknown: number; rows: { id: string; object_id: string; surface: string; area_m2: number | null; split: string | null; path: string[]; basis: string; reason: string }[] }
export interface SwStepInput extends SwValue { name: string; symbol: string }
export interface SwStep { id: string; title: string; formula: string; inputs: SwStepInput[]; result: { value: number | null; unit: string; text: string } | null; table?: Record<string, number | string>[] }
export interface SwOsd {
  status: string; message?: string; osd_required: SwValue; method: SwValue & { recognised: boolean; implemented: string[]; name: string | null };
  inputs: SwStepInput[]; steps: SwStep[]; required_storage_m3: number | null; critical: { duration_min: number; storage_m3: number; qp_l_s: number; intensity_mm_h: number } | null;
  catchment: { basis: string; area_m2: number; ca_m2: number | null; rows: string[]; bypass: { id: string; object_id: string; area_m2: number | null; reason: string }[]; bypass_note: string; complete: boolean; unclassified_m2: number | null;
    unrouted?: { id: string; object_id: string; surface: string; area_m2: number | null; split: string | null; reason: string; how: string }[] };
  provided: { osd: { object_id: string; m3: number; basis: string }[]; osd_total_m3: number; osd_unset: string[]; tank_detention_m3: number; tanks_not_reaching_osd?: { object_id: string; m3: number }[]; tank_counted: boolean; total_m3: number; tank_note: string; tank_exclusion: SwValue } | null;
  comparison: { status: string; required_m3: number; provided_m3: number; difference_m3: number | null; message: string } | null;
  orifice: { status: string; diameter_mm: number | null; formula: string; inputs: SwStepInput[]; text?: string; missing: SwMissing[] } | null;
  notes: string[]; missing: SwMissing[]; ifd: { status: string; message: string; source: string };
}
export interface SwTrench {
  object_id: string; label: string; status: string; volume_m3: number | null; emptying_time_h: number | null; does_not_empty?: boolean; rate: SwValue; rate_label: string; steps: SwStep[]; check: { status: string; message: string }; missing: SwMissing[];
}
export interface SwInfiltration { status: string; message?: string; label: string; rate: SwValue | null; limit: SwValue; trenches: SwTrench[]; notes: string[]; missing: SwMissing[] }
export interface SwPeakPhase { phase: string; label: string; status: string; q_l_s: number | null; text: string; why: string[] }
export interface SwPeaks { status: string; message: string; formula: string; phases: SwPeakPhase[]; comparison_label?: string; comparison_note?: string }
export interface SwPath { max_area_m2: number; points: [number, number, number][] }
export interface SwPond { area_m2: number; max_depth_m: number; volume_m3: number; spill_level_rl: number; lowest_ground_rl: number; centroid: [number, number]; outline: [number, number][] }
export interface SwClosedBasin { id: string; status: string; area_m2: number; cells: number; lowest_rl: number; highest_rl: number; centroid: [number, number]; sink_count: number; sinks: { x: number; y: number; rl: number; contributing_area_m2: number }[]; outline: [number, number][] }
export interface SwOverland {
  status: string; message: string; label: string; labels: string[]; terrain_status: string; paths: SwPath[]; depressions: SwPond[]; depressions_total?: number; notes: string[]; paths_truncated?: boolean;
  grid: { cell_m: number; nx: number; ny: number; cells: number; valid_cells: number; obstacle_cells: number } | null; max_contributing_area_m2?: number;
  closed_basins?: SwClosedBasin[]; closed_basins_total?: number; enclosed_area_m2?: number; sinks?: { count: number; listed: { x: number; y: number; rl: number; contributing_area_m2: number; basin: string | null }[]; truncated: boolean };
  parameters: { cell_m: number; threshold_m2: number; surface: string; notes: Record<string, string> }; timing_ms: number; missing: SwMissing[];
}
export interface SwRainfall {
  status: string; message: string; source: string; table: { kind: string; durations: number; aeps_pct: number[]; first_duration_min: number; last_duration_min: number; provenance: Record<string, unknown>; warnings: string[] } | null;
  location: { status: string; message: string; km: number | null } | null; arr: Record<string, unknown> | null;
}
export interface StormwaterResult {
  schema: 'stormwater.v1'; generated_at: string; terrain_status: string; lot_area_m2: number | null;
  catchment: { rows: SwRow[]; post_rows: SwRow[]; comparison: SwComparison; routing: SwDestination[]; discharge_points: { id: string; label: string; kind: string | null; basis: string | null }[] };
  rainfall: SwRainfall; peak_flows: SwPeaks; osd: SwOsd; infiltration: SwInfiltration; overland: SwOverland | null; missing: SwMissing[]; notes: string[];
}

/** The entries the user makes in the panel (strings, as typed). Empty means not entered. */
export interface InputsForm {
  design_aep_pct: string; tc_pre_min: string; tc_post_min: string; osd_method: string; ssr_m3: string; ssr_m3_per_ha: string; ssr_area_basis: '' | 'lot' | 'osd_catchment';
  psd_l_s: string; rainwater_tank_excluded: '' | 'true' | 'false'; discharge_coefficient: string; orifice_head_m: string; search_max_duration_min: string;
  runoff: Record<string, string>;
  infil_source: '' | 'site_test' | 'indicative' | 'soil_table'; infil_rate: string; infil_date: string; infil_method: string; infil_note: string; infil_soil_unit: string;
}
export const EMPTY_FORM: InputsForm = {
  design_aep_pct: '', tc_pre_min: '', tc_post_min: '', osd_method: '', ssr_m3: '', ssr_m3_per_ha: '', ssr_area_basis: '', psd_l_s: '', rainwater_tank_excluded: '', discharge_coefficient: '', orifice_head_m: '',
  search_max_duration_min: '', runoff: {}, infil_source: '', infil_rate: '', infil_date: '', infil_method: '', infil_note: '', infil_soil_unit: '',
};
export interface InputsPayload {
  design_aep_pct?: number; tc_pre_min?: number; tc_post_min?: number; osd_method?: string; ssr_m3?: number; ssr_m3_per_ha?: number; ssr_area_basis?: 'lot' | 'osd_catchment'; psd_l_s?: number;
  rainwater_tank_excluded?: boolean; discharge_coefficient?: number; orifice_head_m?: number; search_max_duration_min?: number; runoff_coefficients?: Record<string, number>;
  infiltration?: { source: 'site_test' | 'indicative' | 'soil_table'; rate_mm_h?: number; test_date?: string; test_method?: string; source_note?: string; soil_unit?: string };
}

const NUMERIC: { key: keyof InputsForm & keyof InputsPayload; label: string; min?: number; max?: number; positive?: boolean }[] = [
  { key: 'design_aep_pct', label: 'Design AEP', positive: true, max: 100 }, { key: 'tc_pre_min', label: 'Time of concentration, pre development', positive: true },
  { key: 'tc_post_min', label: 'Time of concentration, post development', positive: true }, { key: 'ssr_m3', label: 'Site storage requirement', positive: true },
  { key: 'ssr_m3_per_ha', label: 'Site storage requirement per hectare', positive: true }, { key: 'psd_l_s', label: 'Permissible site discharge', positive: true },
  { key: 'discharge_coefficient', label: 'Discharge coefficient', positive: true, max: 1 }, { key: 'orifice_head_m', label: 'Head to the orifice', positive: true },
  { key: 'search_max_duration_min', label: 'Longest duration searched', positive: true },
];
/** Convert what the user typed into the request entries. A field left empty is left out (the server then reads the requirement key). A bad entry is returned as an error text. */
export function inputsPayload(f: InputsForm): { inputs: InputsPayload; errors: string[] } {
  const inputs: InputsPayload = {}, errors: string[] = [];
  const num = (s: string): number | null => (s.trim() !== '' && Number.isFinite(Number(s)) ? Number(s) : null);
  for (const n of NUMERIC) {
    const s = String(f[n.key] ?? '').trim();
    if (s === '') continue;
    const v = num(s);
    if (v === null) errors.push(`${n.label} must be a number`);
    else if (n.positive && !(v > 0)) errors.push(`${n.label} must be above zero`);
    else if (n.max !== undefined && v > n.max) errors.push(`${n.label} must be at most ${n.max}`);
    else (inputs as Record<string, number>)[n.key] = v;
  }
  if (f.osd_method.trim()) inputs.osd_method = f.osd_method.trim();
  if (f.ssr_area_basis) inputs.ssr_area_basis = f.ssr_area_basis;
  if (f.rainwater_tank_excluded) inputs.rainwater_tank_excluded = f.rainwater_tank_excluded === 'true';
  const rc: Record<string, number> = {};
  for (const [k, s] of Object.entries(f.runoff)) {
    if (s.trim() === '') continue;
    const v = num(s);
    if (v === null || v < 0 || v > 1) errors.push(`The runoff coefficient of ${k.replace(/_/g, ' ')} must be a number from 0 to 1`); else rc[k] = v;
  }
  if (Object.keys(rc).length) inputs.runoff_coefficients = rc;
  if (f.infil_source) {
    const e: NonNullable<InputsPayload['infiltration']> = { source: f.infil_source };
    if (f.infil_rate.trim()) { const v = num(f.infil_rate); if (v === null || !(v > 0)) errors.push('The infiltration rate must be a number above zero'); else e.rate_mm_h = v; }
    if (f.infil_date.trim()) { if (/^\d{4}-\d{2}-\d{2}$/.test(f.infil_date.trim())) e.test_date = f.infil_date.trim(); else errors.push('The test date must be a date'); }
    if (f.infil_method.trim()) e.test_method = f.infil_method.trim();
    if (f.infil_note.trim()) e.source_note = f.infil_note.trim();
    if (f.infil_soil_unit.trim()) e.soil_unit = f.infil_soil_unit.trim();
    inputs.infiltration = e;
  }
  return { inputs, errors };
}
/** The form that shows saved entries (the server's saved inputs). */
export function formFromInputs(i: InputsPayload | null | undefined): InputsForm {
  if (!i) return { ...EMPTY_FORM, runoff: {} };
  const s = (v: number | undefined) => (v === undefined || v === null ? '' : String(v));
  const inf = i.infiltration;
  return {
    design_aep_pct: s(i.design_aep_pct), tc_pre_min: s(i.tc_pre_min), tc_post_min: s(i.tc_post_min), osd_method: i.osd_method ?? '', ssr_m3: s(i.ssr_m3), ssr_m3_per_ha: s(i.ssr_m3_per_ha),
    ssr_area_basis: i.ssr_area_basis ?? '', psd_l_s: s(i.psd_l_s), rainwater_tank_excluded: i.rainwater_tank_excluded === undefined ? '' : i.rainwater_tank_excluded ? 'true' : 'false',
    discharge_coefficient: s(i.discharge_coefficient), orifice_head_m: s(i.orifice_head_m), search_max_duration_min: s(i.search_max_duration_min),
    runoff: Object.fromEntries(Object.entries(i.runoff_coefficients ?? {}).map(([k, v]) => [k, String(v)])),
    infil_source: inf?.source ?? '', infil_rate: s(inf?.rate_mm_h), infil_date: inf?.test_date ?? '', infil_method: inf?.test_method ?? '', infil_note: inf?.source_note ?? '', infil_soil_unit: inf?.soil_unit ?? '',
  };
}

// ---- wording of values --------------------------------------------------------------------------------------------------------------
export type Tone = 'ok' | 'warn' | 'bad' | 'neutral';
/** The basis badge: its text and tone. A platform default is a warning (a stamped placeholder); UNRESOLVED is bad; a user entry or a cited rule is ok. */
export function basisBadge(basis: string): { text: string; tone: Tone } {
  const b = basis.toUpperCase();
  if (b === 'UNRESOLVED') return { text: 'UNRESOLVED', tone: 'bad' };
  if (b === 'PLATFORM DEFAULT') return { text: 'PLATFORM DEFAULT', tone: 'warn' };
  if (b === 'LGA RULE' || b === 'STATE RULE' || b === 'USER' || b === 'DATA SOURCE') return { text: b, tone: 'ok' };
  return { text: b, tone: 'neutral' };
}
const trim = (n: number, d: number) => (Math.abs(n) >= 1000 ? n.toFixed(0) : n.toFixed(d));
export function numText(v: number, unit = '', d = 2): string { return `${trim(v, d)}${unit ? ` ${unit}` : ''}`; }
/** The value of a resolved item as text, or UNRESOLVED. A true or false value reads YES or NO. */
export function valueText(v: Pick<SwValue, 'value' | 'unit'>, d = 3): string {
  if (v.value === null || v.value === undefined) return 'UNRESOLVED';
  if (typeof v.value === 'boolean') return v.value ? 'YES' : 'NO';
  if (typeof v.value === 'number') return numText(v.value, v.unit ?? '', d);
  return String(v.value).toUpperCase();
}
export const NOT_SET_TEXT = 'NOT SET';
export const NOT_EVALUATED = 'NOT EVALUATED';

export interface ValueView { text: string; basis: { text: string; tone: Tone }; ref: string; stamp: string; how: string; key: string }
export function valueView(v: SwValue, d = 3): ValueView {
  return { text: valueText(v, d), basis: basisBadge(v.basis), ref: v.ref ?? '', stamp: v.stamp ?? '', how: v.value === null || v.value === undefined ? v.how ?? '' : '', key: v.key ?? '' };
}

// ---- catchment ----------------------------------------------------------------------------------------------------------------------
export interface CatchRowView {
  id: string; object: string; surface: string; status: string; area: string; areaBasis: string; runoff: ValueView; ca: string; split: string; route: string; routeBasis: string; note: string; unresolved: boolean;
}
const dest = (r: SwRow) => (r.route ? (r.route.to ? r.route.path.join(' to ') : 'NO ROUTE') : '');
export function catchmentRows(res: StormwaterResult, phase: 'post' | 'pre' = 'post'): CatchRowView[] {
  const rows = phase === 'post' ? res.catchment.post_rows : res.catchment.rows.filter((r) => r.phases.includes('pre'));
  return rows.map((r) => ({
    id: r.id, object: r.label, surface: r.surface_label, status: r.status.replace(/_/g, ' ').toUpperCase(), area: r.area_m2 === null ? NOT_SET_TEXT : numText(r.area_m2, 'm2', 1), areaBasis: r.area_basis,
    runoff: valueView(r.runoff), ca: r.ca_m2 === null ? NOT_EVALUATED : numText(r.ca_m2, 'm2', 2), split: r.split ?? '', route: phase === 'post' ? dest(r) : '', routeBasis: r.route?.basis ?? '',
    note: [r.area_note, r.route?.reason].filter(Boolean).join('. '), unresolved: r.area_m2 === null || r.runoff.value === null || (phase === 'post' && !r.route?.to),
  }));
}
export interface TotalsView { surface: string; area: string; ca: string; objects: number; incomplete: boolean }
export function totalsView(t: SwTotals): { rows: TotalsView[]; total: string; ca: string; c: string; complete: boolean } {
  return {
    rows: t.by_surface.map((b) => ({ surface: b.label, area: numText(b.area_m2, 'm2', 1), ca: b.coeff_unknown || b.area_unknown ? `${numText(b.ca_m2, 'm2', 2)} (INCOMPLETE)` : numText(b.ca_m2, 'm2', 2), objects: b.objects, incomplete: !!(b.coeff_unknown || b.area_unknown) })),
    total: numText(t.area_m2, 'm2', 1), ca: t.complete ? numText(t.ca_m2, 'm2', 2) : `${numText(t.ca_m2, 'm2', 2)} (INCOMPLETE)`, c: t.weighted_c === null ? NOT_EVALUATED : t.weighted_c.toFixed(3), complete: t.complete,
  };
}
export function prePostView(c: SwComparison): { pre: ReturnType<typeof totalsView> | null; preMessage: string; post: ReturnType<typeof totalsView>; lot: string; unclassified: string; overlap: string } {
  const un = c.post_unclassified;
  return {
    pre: c.pre_status === 'OK' ? totalsView(c.pre) : null, preMessage: c.pre_status === 'OK' ? '' : `PRE DEVELOPMENT ${NOT_SET_TEXT}. ${c.pre_message}`, post: totalsView(c.post),
    lot: un.lot_area_m2 === null ? 'LOT AREA NOT AVAILABLE' : numText(un.lot_area_m2, 'm2', 1),
    unclassified: un.unclassified_m2 === null ? un.message : un.unclassified_m2 > 0.05 ? `${numText(un.unclassified_m2, 'm2', 1)} OF THE LOT HAS NO SURFACE OBJECT` : 'NONE',
    overlap: c.post_overlaps.overlap_m2 > 0.05 ? `THE DRAWN SURFACES OVERLAP BY ${numText(c.post_overlaps.overlap_m2, 'm2', 1)}` : 'NONE',
  };
}
export interface RoutingView { destination: string; type: string; area: string; ca: string; rows: { id: string; surface: string; area: string; path: string; basis: string }[] }
export function routingView(res: StormwaterResult): RoutingView[] {
  const label = (id: string) => (id === 'UNROUTED' ? 'NO DESTINATION' : id.toUpperCase());
  return res.catchment.routing.map((d) => ({
    destination: label(d.destination), type: d.type ? d.type.replace(/_/g, ' ').toUpperCase() : '', area: numText(d.area_m2, 'm2', 1), ca: d.ca_unknown ? `${numText(d.ca_m2, 'm2', 2)} (INCOMPLETE)` : numText(d.ca_m2, 'm2', 2),
    rows: d.rows.map((r) => ({ id: r.id, surface: r.surface, area: r.area_m2 === null ? NOT_SET_TEXT : numText(r.area_m2, 'm2', 1), path: r.path.length ? r.path.join(' to ') : 'NO ROUTE', basis: r.basis })),
  }));
}

// ---- OSD, peak flows, infiltration -----------------------------------------------------------------------------------------------------
export interface StepView { id: string; title: string; formula: string; inputs: (ValueView & { name: string; symbol: string })[]; result: string; table: Record<string, number | string>[] }
export const stepView = (s: SwStep): StepView => ({
  id: s.id, title: s.title, formula: s.formula, inputs: s.inputs.map((i) => ({ name: i.name, symbol: i.symbol, ...valueView(i) })), result: s.result ? s.result.text : NOT_EVALUATED, table: s.table ?? [],
});
export interface OsdView {
  status: string; tone: Tone; message: string; method: ValueView; required: ValueView; inputs: (ValueView & { name: string; symbol: string })[]; steps: StepView[]; required_text: string;
  comparison: { text: string; tone: Tone } | null; provided: string[]; orifice: { status: string; text: string; inputs: (ValueView & { name: string; symbol: string })[]; formula: string }; notes: string[];
  critical: string;
}
export function osdView(o: SwOsd): OsdView {
  const cmp = o.comparison;
  return {
    status: o.status, tone: o.status === 'EVALUATED' ? 'ok' : o.status === 'NOT REQUIRED' ? 'neutral' : 'bad', message: o.message ?? '', method: valueView(o.method), required: valueView(o.osd_required),
    inputs: o.inputs.map((i) => ({ name: i.name, symbol: i.symbol, ...valueView(i) })), steps: o.steps.map(stepView),
    required_text: o.required_storage_m3 === null ? NOT_EVALUATED : numText(o.required_storage_m3, 'm3', 3), critical: o.critical ? `${numText(o.critical.duration_min, 'min', 0)}` : '',
    comparison: cmp ? { text: cmp.message, tone: cmp.status === 'PROVIDED STORAGE IS ENOUGH' ? 'ok' : cmp.status === 'PROVIDED STORAGE IS SHORT' ? 'bad' : 'warn' } : null,
    provided: o.provided ? [
      ...o.provided.osd.map((p) => `${p.object_id.toUpperCase()}: ${numText(p.m3, 'm3', 3)} (${p.basis})`), ...o.provided.osd_unset.map((id) => `${id.toUpperCase()}: STORAGE VOLUME ${NOT_SET_TEXT}`),
      ...(o.provided.tank_note ? [o.provided.tank_note] : []), ...(o.provided.tank_counted ? [`TANK DETENTION COUNTED: ${numText(o.provided.tank_detention_m3, 'm3', 3)}`] : []),
    ] : [],
    orifice: o.orifice ? { status: o.orifice.status, text: o.orifice.status === 'EVALUATED' ? o.orifice.text ?? '' : `${NOT_EVALUATED}: ${o.orifice.missing.map((m) => m.what).join('; ')}`, inputs: o.orifice.inputs.map((i) => ({ name: i.name, symbol: i.symbol, ...valueView(i) })), formula: o.orifice.formula }
      : { status: NOT_EVALUATED, text: NOT_EVALUATED, inputs: [], formula: '' },
    notes: o.notes,
  };
}
export function peakView(p: SwPeaks): { status: string; lines: { label: string; text: string; ok: boolean }[]; formula: string; comparison: string } {
  return { status: p.status, formula: p.formula, comparison: p.comparison_label ? `${p.comparison_label}. ${p.comparison_note ?? ''}`.trim() : '', lines: p.phases.map((x) => ({ label: x.label, ok: x.status === 'EVALUATED', text: x.status === 'EVALUATED' ? x.text : `${NOT_EVALUATED}: ${x.why.join('; ')}` })) };
}
export interface TrenchView { id: string; label: string; status: string; rate: ValueView; rateLabel: string; volume: string; time: string; check: { text: string; tone: Tone }; steps: StepView[] }
export function infiltrationView(i: SwInfiltration): { status: string; message: string; label: string; trenches: TrenchView[]; limit: ValueView } {
  return {
    status: i.status, message: i.message ?? '', label: i.label, limit: valueView(i.limit),
    trenches: i.trenches.map((t) => ({
      id: t.object_id, label: t.label, status: t.status, rate: valueView(t.rate), rateLabel: t.rate_label, volume: t.volume_m3 === null ? NOT_EVALUATED : numText(t.volume_m3, 'm3', 3),
      time: t.does_not_empty ? 'DOES NOT EMPTY' : t.emptying_time_h === null ? NOT_EVALUATED : numText(t.emptying_time_h, 'h', 2),
      check: { text: t.check.message || t.check.status, tone: t.check.status === 'PASS' ? 'ok' : t.check.status === 'FAIL' ? 'bad' : 'warn' }, steps: t.steps.map(stepView),
    })),
  };
}

// ---- missing inputs -----------------------------------------------------------------------------------------------------------------
export function missingGroups(m: SwMissing[]): { area: string; items: { what: string; key: string; how: string }[] }[] {
  const out: { area: string; items: { what: string; key: string; how: string }[] }[] = [];
  for (const x of m) {
    let g = out.find((y) => y.area === x.area);
    if (!g) { g = { area: x.area, items: [] }; out.push(g); }
    g.items.push({ what: x.what, key: x.key ?? '', how: x.how });
  }
  return out;
}

// ---- rainfall, overland ------------------------------------------------------------------------------------------------------------
export function rainfallView(r: SwRainfall): { status: string; tone: Tone; lines: string[] } {
  if (!r.table) return { status: r.status, tone: 'bad', lines: [r.message || r.status] };
  const p = r.table.provenance as Record<string, unknown>;
  const issued = typeof p.issued === 'string' ? `${p.issued.slice(8, 10)}/${p.issued.slice(5, 7)}/${p.issued.slice(0, 4)}` : 'NOT STATED';
  const lines = [`SOURCE: ${String(p.source ?? '').toUpperCase()}`, `FILE: ${String(p.file_name ?? 'NOT STATED').toUpperCase()}`, `ISSUED: ${issued}`, `LOCATION: ${String(p.location_label ?? 'NOT STATED').toUpperCase()}`,
    `DURATIONS: ${r.table.durations} (${numText(r.table.first_duration_min, 'min', 0)} TO ${numText(r.table.last_duration_min, 'min', 0)}); AEP COLUMNS: ${r.table.aeps_pct.map((a) => `${+a.toFixed(3)}`).join(', ')} PERCENT`];
  if (r.location) lines.push(r.location.message);
  lines.push(...r.table.warnings);
  return { status: r.status, tone: r.location?.status === 'WARNING' || r.table.warnings.length ? 'warn' : 'ok', lines };
}
export interface OverlandView { status: string; tone: Tone; labels: string[]; summary: string[]; ponds: { id: string; text: string }[]; closedBasins: { id: string; text: string }[]; notes: string[]; params: string[] }
export function overlandView(o: SwOverland | null): OverlandView | null {
  if (!o) return null;
  const ev = o.status === 'EVALUATED';
  return {
    status: o.status, tone: ev ? 'warn' : 'bad', labels: o.labels,
    summary: ev && o.grid ? [`RASTER ${o.grid.nx} X ${o.grid.ny} CELLS AT ${o.grid.cell_m} M (${o.grid.cells} CELLS), ${o.timing_ms} MS`, `${o.paths.length} FLOW PATH(S) AT OR ABOVE ${o.parameters.threshold_m2} M2 CONTRIBUTING AREA`,
      `LARGEST CONTRIBUTING AREA ${numText(o.max_contributing_area_m2 ?? 0, 'm2', 1)}`, `${o.depressions_total ?? o.depressions.length} DEPRESSION(S) REPORTED`] : [o.message],
    ponds: o.depressions.map((p, i) => ({ id: `P${i + 1}`, text: `P${i + 1}: AREA ${numText(p.area_m2, 'm2', 1)}, DEPTH ${numText(p.max_depth_m, 'm', 2)}, VOLUME ${numText(p.volume_m3, 'm3', 2)}, SPILL ${p.spill_level_rl.toFixed(2)} RL` })),
    closedBasins: (o.closed_basins ?? []).map((b) => ({ id: b.id, text: `${b.id}: ${b.status}, AREA ${numText(b.area_m2, 'm2', 1)}, LOWEST GROUND ${b.lowest_rl.toFixed(2)} RL, ${b.sink_count} D8 SINK(S)` })),
    notes: o.notes, params: Object.entries(o.parameters.notes ?? {}).map(([k, v]) => `${k}: ${v}`),
  };
}
