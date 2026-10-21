/**
 * The shared Checks list of the Design tab: every issue across the objects, grouped by severity. Two sources are merged:
 *  - the server checks (`site_checks.v1`): rule based, each with its requirement keys, value, limit and basis;
 *  - the geometry issues of stage 4 (degenerate geometry, outside the lot, terrain not available), basis MODEL CHECK.
 * Clicking a row selects its object (the panel does that with `objectId`). A check of the whole design has no object.
 */
import type { CheckEntry, CheckRequirement, CheckResult, CheckStatus } from './serverChecks';
import { OBJECT_KINDS, type SiteDesign, type SiteObject } from './types';

export type RowStatus = CheckStatus | 'ISSUE';
export interface ListRow {
  id: string; objectId: string | null; objectName: string; title: string; message: string; severity: 'blocking' | 'warning' | 'info'; status: RowStatus;
  /** requirement keys the check used, with their resolved value and basis (empty for a model check) */
  requirements: CheckRequirement[]; keys: string[]; basis: string; value: string; limit: string; source: 'server' | 'model';
}
export interface ListGroup { severity: 'blocking' | 'warning' | 'info'; label: string; rows: ListRow[] }
export interface CheckListOptions { showPassed?: boolean }
export interface CheckListResult { groups: ListGroup[]; total: number; hidden: number; counts: Record<'blocking' | 'warning' | 'info', number> }

export const SEVERITY_ORDER = ['blocking', 'warning', 'info'] as const;
export const SEVERITY_LABEL: Record<(typeof SEVERITY_ORDER)[number], string> = { blocking: 'BLOCKING', warning: 'WARNING', info: 'INFO' };
const HIDDEN_BY_DEFAULT: ReadonlySet<string> = new Set(['PASS', 'NOT APPLICABLE']);

export function objectName(o: SiteObject | undefined, fallback: string | null): string {
  if (!o) return fallback ? fallback.replace(/_/g, ' ').toUpperCase() : 'WHOLE DESIGN';
  const k = OBJECT_KINDS[o.type].label;
  return o.label ? `${k}: ${o.label.toUpperCase()}` : `${k} ${o.id}`;
}
const fmt = (v: number | string | null, unit: string) => (v === null || v === undefined ? '' : typeof v === 'number' ? `${Number.isInteger(v) ? v : Number(v.toFixed(3))}${unit ? ' ' + unit : ''}` : String(v));

export function rowOfCheck(c: CheckEntry, doc: SiteDesign): ListRow {
  const o = c.object_id ? doc.objects.find((x) => x.id === c.object_id) : undefined;
  return {
    id: c.id, objectId: c.object_id, objectName: objectName(o, c.object_type), title: c.title, message: c.message, severity: c.severity, status: c.status, requirements: c.requirements,
    keys: c.requirements.map((r) => r.key), basis: c.basis, value: fmt(c.value, c.unit), limit: fmt(c.limit, c.unit), source: 'server',
  };
}
export function rowsOfIssues(doc: SiteDesign): ListRow[] {
  const rows: ListRow[] = [];
  for (const o of doc.objects) {
    if (o.accepted === 'rejected') continue;
    for (const i of o.issues) rows.push({ id: `${o.id}:${i.code}`, objectId: o.id, objectName: objectName(o, null), title: i.code.replace(/_/g, ' '), message: i.message, severity: i.severity, status: 'ISSUE', requirements: [], keys: [], basis: 'MODEL CHECK', value: '', limit: '', source: 'model' });
  }
  return rows;
}

/** The merged list. `result` null (not asked yet, no server or failed) lists only the geometry issues. */
export function collectChecks(doc: SiteDesign, result: CheckResult | null, opts: CheckListOptions = {}): CheckListResult {
  const live = new Set(doc.objects.filter((o) => o.accepted !== 'rejected').map((o) => o.id));
  const all = [...(result ? result.checks.filter((c) => c.object_id === null || live.has(c.object_id)).map((c) => rowOfCheck(c, doc)) : []), ...rowsOfIssues(doc)];
  const shown = all.filter((r) => opts.showPassed || !HIDDEN_BY_DEFAULT.has(r.status));
  const order = (r: ListRow) => (r.objectId ? doc.objects.findIndex((o) => o.id === r.objectId) : -1);
  const counts = { blocking: 0, warning: 0, info: 0 };
  const groups = SEVERITY_ORDER.map((severity): ListGroup => {
    const rows = shown.filter((r) => r.severity === severity).sort((a, b) => order(a) - order(b) || a.title.localeCompare(b.title));
    counts[severity] = rows.length;
    return { severity, label: SEVERITY_LABEL[severity], rows };
  });
  return { groups, total: shown.length, hidden: all.length - shown.length, counts };
}

/** Tree protection zone radii from the server values, by tree id (an absent radius means the rule keys are UNRESOLVED). */
export function zonesOf(result: CheckResult | null): Record<string, { tpz: number | null; srz: number | null }> {
  const out: Record<string, { tpz: number | null; srz: number | null }> = {};
  if (!result) return out;
  for (const [id, vals] of Object.entries(result.values)) {
    const t = vals.find((v) => v.key === 'tpz_radius_m'), s = vals.find((v) => v.key === 'srz_radius_m');
    if (t || s) out[id] = { tpz: typeof t?.value === 'number' ? t.value : null, srz: typeof s?.value === 'number' ? s.value : null };
  }
  return out;
}
