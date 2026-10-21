/**
 * Stage 8: turn what the user typed into the Trace service, Sewer and Water tool forms into the values the operations and the server take.
 * An empty entry stays NOT SET (it is left out): nothing is defaulted. A number that cannot be read is an error, never a silent zero.
 */
import { DEPTH_BASES, DEPTH_REFERENCES, ISO_DATE_RE, SERVICE_KINDS, type SiteObject } from './types';
import type { ConnectionInput } from './engineApi';
import type { ServiceFields } from './designController';

export interface TraceForm {
  service_kind: string; asset_owner: string; diameter_mm: string; material: string; depth_m: string; depth_basis: string; depth_reference: string;
  position_tolerance_m: string; dbyd_job_number: string; plan_reference: string; plan_date: string; plan_expiry_date: string; source_file: string; label: string;
}
export const EMPTY_TRACE_FORM: TraceForm = {
  service_kind: '', asset_owner: '', diameter_mm: '', material: '', depth_m: '', depth_basis: '', depth_reference: '', position_tolerance_m: '', dbyd_job_number: '', plan_reference: '', plan_date: '', plan_expiry_date: '', source_file: '', label: '',
};
const NUMERIC: [keyof TraceForm, string, boolean][] = [['diameter_mm', 'DIAMETER', false], ['depth_m', 'DEPTH', false], ['position_tolerance_m', 'POSITIONAL TOLERANCE', true]];
const TEXT: (keyof TraceForm)[] = ['asset_owner', 'material', 'dbyd_job_number', 'plan_reference', 'source_file'];

/** The fields of the new service. Only what was entered is included. A depth needs its basis (a depth with no basis is refused: the basis says how far it can be trusted). */
export function traceFields(f: TraceForm): { fields: ServiceFields; label: string | undefined; error: string | null } {
  const fields: ServiceFields = {};
  const put = (k: string, v: string | number) => { fields[k] = { value: v, basis: 'user' }; };
  const bad = (m: string) => ({ fields: {}, label: undefined, error: m });
  if (f.service_kind) { if (!(SERVICE_KINDS as readonly string[]).includes(f.service_kind)) return bad('SERVICE KIND IS NOT ONE OF THE LIST'); put('service_kind', f.service_kind); }
  for (const k of TEXT) { const v = f[k].trim(); if (v) { if (v.length > 200) return bad(`${k.toUpperCase()} IS TOO LONG`); put(k, v); } }
  for (const [k, name, zeroOk] of NUMERIC) {
    const raw = f[k].trim(); if (!raw) continue;
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0 || (!zeroOk && n === 0)) return bad(`${name} MUST BE A NUMBER ${zeroOk ? 'OF ZERO OR MORE' : 'ABOVE ZERO'}`);
    put(k, n);
  }
  if (f.depth_basis) { if (!(DEPTH_BASES as readonly string[]).includes(f.depth_basis)) return bad('DEPTH BASIS IS NOT ONE OF THE LIST'); put('depth_basis', f.depth_basis); }
  if (f.depth_reference) { if (!(DEPTH_REFERENCES as readonly string[]).includes(f.depth_reference)) return bad('DEPTH REFERENCE IS NOT ONE OF THE LIST'); put('depth_reference', f.depth_reference); }
  if (fields.depth_m && !fields.depth_basis) return bad('A DEPTH NEEDS ITS BASIS (PLAN INDICATED, POTHOLED, SURVEYED OR UNKNOWN)');
  for (const k of ['plan_date', 'plan_expiry_date'] as const) {
    const v = f[k].trim(); if (!v) continue;
    if (!ISO_DATE_RE.test(v) || Number.isNaN(Date.parse(v))) return bad(`${k === 'plan_date' ? 'PLAN DATE' : 'PLAN EXPIRY DATE'} MUST BE A VALID DATE`);
    put(k, v);
  }
  const label = f.label.trim();
  return { fields, label: label ? label.slice(0, 120) : undefined, error: null };
}

export interface ConnectionForm { mode: 'main' | 'point'; main_id: string; e: string; n: string; invert_rl: string }
export const EMPTY_CONNECTION: ConnectionForm = { mode: 'main', main_id: '', e: '', n: '', invert_rl: '' };
const num = (s: string): number | null => { const t = s.trim(); if (!t) return null; const n = Number(t); return Number.isFinite(n) ? n : NaN; };

/** The connection of a route request: a service in the design, or a point entered by the user (the answer labels it NOT VERIFIED). */
export function connectionInput(c: ConnectionForm): { value: ConnectionInput | null; error: string | null } {
  const inv = num(c.invert_rl);
  if (inv !== null && Number.isNaN(inv)) return { value: null, error: 'THE CONNECTION INVERT MUST BE A NUMBER' };
  if (c.mode === 'main') {
    if (!c.main_id) return { value: null, error: 'CHOOSE THE EXISTING SERVICE TO CONNECT TO, OR ENTER A POINT' };
    return { value: { main_id: c.main_id, ...(inv !== null ? { invert_rl: inv } : {}) }, error: null };
  }
  const e = num(c.e), n = num(c.n);
  if (e === null || n === null || Number.isNaN(e) || Number.isNaN(n)) return { value: null, error: 'ENTER THE EASTING AND NORTHING OF THE CONNECTION POINT' };
  return { value: { p: [e, n], ...(inv !== null ? { invert_rl: inv } : {}) }, error: null };
}
/** A required positive number from a form field. */
export function requiredNumber(s: string, name: string, opts: { positive?: boolean } = {}): { value: number | null; error: string | null } {
  const n = num(s);
  if (n === null || Number.isNaN(n)) return { value: null, error: `${name} MUST BE A NUMBER` };
  if (opts.positive && n <= 0) return { value: null, error: `${name} MUST BE ABOVE ZERO` };
  return { value: n, error: null };
}
export function optionalNumber(s: string, name: string): { value: number | null; error: string | null } {
  const n = num(s);
  if (n === null) return { value: null, error: null };
  return Number.isNaN(n) ? { value: null, error: `${name} MUST BE A NUMBER` } : { value: n, error: null };
}

/** Existing services of the design a route can connect to: of the kind (a service the user has not set a kind for is listed too, marked KIND NOT SET). */
export function connectable(objects: readonly SiteObject[], kind: 'sewer' | 'water'): SiteObject[] {
  return objects.filter((o) => o.type === 'service_existing' && o.accepted !== 'rejected' && o.geometry.kind === 'polyline' && (() => { const k = o.params.service_kind?.value; return k === kind || k === undefined || k === null; })());
}
/** The building exits of a kind as the select lists them. */
export function buildingExits(o: SiteObject, kind: 'sewer' | 'water'): [number, number][] {
  const ex = o.building?.exits?.[kind] ?? [];
  return ex.map((p) => [p[0], p[1]] as [number, number]);
}
