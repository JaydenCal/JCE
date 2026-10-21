/**
 * AI first design (stage 10), the pure part: the types of the server answer, the safety guard for the batch, the live checks of a proposal and the operations of the checklist
 * (accept, reject, restore). Nothing is calculated here and nothing is invented: every number in a proposal came from a server engine, and the model never wrote one.
 */
import { designSig, type CheckEntry, type ChecksState } from './serverChecks';
import { OPS } from './ops';
import { ENGINE_DERIVED_PARAMS, ENGINE_REF_PREFIX } from './types';
import type { SiteDesign, SiteObject } from './types';

export interface FdStep { op: string; args: Record<string, unknown> }
export interface FdCheck { id: string; object_id: string | null; code: string; status: string; severity: 'blocking' | 'warning' | 'info'; message: string }
export interface FdProposal {
  id: string; set_id: string; kind: string; title: string; candidate_id: string; summary: string; reason: string; selected_by: string; selected_by_ai: boolean;
  steps: FdStep[]; revert_steps: FdStep[]; object_ids: string[]; edited_ids: string[]; checks: FdCheck[];
  counts: { blocking: number; fail: number; not_evaluated: number; total: number }; blocked: boolean; flags: string[]; required_inputs: string[];
  alternatives: { id: string; summary: string; blocked: boolean }[];
}
export interface FdSkipped { set_id: string; title: string; reason: string; skipped_by: string; required_inputs: string[]; notes: string[] }
export interface FdEstimate {
  calls: number; input_tokens: number; output_tokens: number; cost_usd: number; requires_confirm: boolean; confirm_usd: number; rounds: number; max_calls: number; max_cost_usd: number;
  model: string; uses_ai: boolean; reason: string;
}
export interface FdEstimateAnswer {
  schema: 'first_design_estimate.v1'; estimate: FdEstimate; ai_available: boolean; model: string;
  spend: { day_usd: number; day_cap_usd: number; month_usd: number; month_cap_usd: number }; sets: { id: string; title: string; candidates: number; skipped: string | null; asks_model: boolean }[];
}
export interface FdResult {
  schema: 'first_design.v1'; label: string; mode: 'ai' | 'rules'; selected_by: string; model: string | null; proposals: FdProposal[]; skipped: FdSkipped[]; batch: FdStep[];
  required_inputs: string[]; design_version: number; final_checks: { total: number; blocking: number; warning: number; blocking_list: { id: string; object_id: string | null; code: string; message: string }[] };
  usage: { calls: number; input_tokens: number; output_tokens: number; cost_usd: number }; ai_errors: string[]; refused_tool_calls: number; notes: string[]; estimate?: FdEstimate;
}

export const RULES_LABEL = 'SELECTED BY RULES, NO AI';
export const MAX_AI_BATCH_STEPS = 400;
/** The only operations an AI batch may contain. A building is never added, moved, rotated or deleted by it. The lists below are the same as in the backend (ai_batch_guard); a test compares them. */
export const AI_BATCH_OPS: readonly string[] = ['add_object', 'set_param', 'remove_param'];
/** The only parameters the batch may set on an object that already exists in the design (a link; a dimension is never set). */
export const AI_LINK_KEYS: readonly string[] = ['drains_to_id'];
/** The only parameters the batch may set on an object the batch itself adds (links; a role or a number is given when the object is added). */
export const AI_NEW_SET_KEYS: readonly string[] = ['building_id', 'drains_to_id', 'end_building_id', 'main_id', 'osd_id', 'roof_building_id', 'rwt_id', 'trench_id'];
/** The only numeric parameters a new object may carry, and only as basis derived: the crossover chainage along the kerb and the invert of a connection on a verified main. */
export const AI_NUMERIC_PARAMS: readonly string[] = ['driveway.crossover_chainage_m', 'service_node.invert_rl'];

/** One parameter of an AI object: NOT SET, or a derived value of an engine pair whose ref names the engine. Text, except the two numeric pairs when `numericOk`. */
function assertDerived(type: string, key: string, p: unknown, at: string, numericOk: boolean): void {
  const q = (p ?? {}) as { value?: unknown; basis?: unknown; ref?: unknown };
  if (typeof p !== 'object' || p === null) throw new Error(`${at}: THE PARAMETER ${key.toUpperCase()} IS NOT AN OBJECT`);
  if (q.value === null || q.value === undefined) {
    if (q.basis !== 'unresolved') throw new Error(`${at}: ${key.toUpperCase()} HAS NO VALUE BUT IS NOT NOT SET`);
    return;
  }
  if (q.basis !== 'derived' || !ENGINE_DERIVED_PARAMS.includes(`${type}.${key}`)) throw new Error(`${at}: ${key.toUpperCase()} OF A ${type.toUpperCase()} MAY NOT CARRY A VALUE IN AN AI BATCH`);
  if (typeof q.ref !== 'string' || !q.ref.startsWith(ENGINE_REF_PREFIX)) throw new Error(`${at}: ${key.toUpperCase()} MUST NAME THE ENGINE THAT DERIVED IT`);
  if (typeof q.value === 'boolean') throw new Error(`${at}: ${key.toUpperCase()} MAY NOT BE TRUE OR FALSE`);
  if (typeof q.value === 'number') {
    if (!(numericOk && AI_NUMERIC_PARAMS.includes(`${type}.${key}`) && Number.isFinite(q.value))) throw new Error(`${at}: THE AI MAY NOT SET THE NUMBER ${key.toUpperCase()} ON A ${type.toUpperCase()}`);
  } else if (typeof q.value !== 'string') throw new Error(`${at}: ${key.toUpperCase()} MUST BE TEXT`);
}

/** Refuse a batch that is not an AI first design batch. Throws an Error that says why (the document is untouched: nothing was run yet). */
export function assertAiBatch(steps: readonly FdStep[], doc: SiteDesign): void {
  if (!Array.isArray(steps) || steps.length > MAX_AI_BATCH_STEPS) throw new Error(`THE BATCH HAS MORE THAN ${MAX_AI_BATCH_STEPS} OPERATIONS`);
  const existing = new Map(doc.objects.map((o) => [o.id, o]));
  const added = new Map<string, string>();
  for (const [n, s] of steps.entries()) {
    const at = `OPERATION ${n + 1} (${String(s?.op)})`;
    if (!s || typeof s.op !== 'string' || !AI_BATCH_OPS.includes(s.op)) throw new Error(`${at} IS NOT ALLOWED IN AN AI BATCH`);
    const def = OPS[s.op];
    if (!def || def.ai === false) throw new Error(`${at} IS NOT AVAILABLE TO THE AI`);
    const a = s.args ?? {};
    if (s.op === 'add_object') {
      if (a.type === 'building') throw new Error(`${at}: THE AI NEVER CREATES A BUILDING`);
      if (a.origin !== 'ai_proposal') throw new Error(`${at}: AN AI OBJECT MUST HAVE THE ORIGIN AI PROPOSAL`);
      if (a.status !== 'proposed') throw new Error(`${at}: AN AI OBJECT MUST HAVE THE STATUS PROPOSED`);
      if (typeof a.id !== 'string' || existing.has(a.id) || added.has(a.id)) throw new Error(`${at}: THE OBJECT ID IS MISSING OR ALREADY IN USE`);
      for (const [k, p] of Object.entries((a.params ?? {}) as Record<string, unknown>)) assertDerived(String(a.type), k, p, at, true);
      added.set(a.id, String(a.type));
    } else {
      const id = String(a.id ?? ''), key = String(a.key ?? '');
      const newType = added.get(id);
      if (newType !== undefined) {
        if (!AI_NEW_SET_KEYS.includes(key)) throw new Error(`${at}: THE AI MAY NOT CHANGE ${key.toUpperCase()} OF A NEW OBJECT`);
      } else {
        const o = existing.get(id);
        if (!o) throw new Error(`${at}: THERE IS NO OBJECT ${id}`);
        if (!AI_LINK_KEYS.includes(key)) throw new Error(`${at}: THE AI MAY ONLY SET A LINK ON AN EXISTING OBJECT, NOT ${key.toUpperCase()}`);
      }
      if (s.op === 'set_param') {
        if (a.value === null || a.value === undefined) throw new Error(`${at}: A SET PARAMETER NEEDS A VALUE`);
        assertDerived(newType ?? existing.get(id)!.type, key, { value: a.value, basis: a.basis, ref: a.ref }, at, false);
      }
    }
  }
}

// ---- the checks of a proposal, live ------------------------------------------------------------------------------------------------
export interface LiveView {
  /** live: the server answer is for the document as it is now; pending: being asked; stale: an older answer; none: no answer (no server or failed) */
  state: 'live' | 'pending' | 'stale' | 'none';
  checks: CheckEntry[]; blocking: number; warning: number; passing: boolean;
}
const touches = (c: { id: string; object_id: string | null }, ids: ReadonlySet<string>) => (c.object_id !== null && ids.has(c.object_id)) || (c.id.split(':').length >= 3 && ids.has(c.id.split(':')[2]));

/** The server checks that concern the objects of a proposal, from the latest answer. A proposal passes when that answer is for the current document and has no blocking check. */
export function liveChecksFor(p: FdProposal, st: ChecksState, doc: SiteDesign): LiveView {
  const ids = new Set(p.object_ids);
  const have = st.result !== null;
  const state: LiveView['state'] = !have ? (st.status === 'pending' ? 'pending' : 'none') : st.status === 'ok' && st.resultSig === designSig(doc) ? 'live' : st.status === 'pending' ? 'pending' : 'stale';
  const checks = have ? st.result!.checks.filter((c) => ids.size > 0 && touches(c, ids)) : [];
  const blocking = checks.filter((c) => c.severity === 'blocking').length;
  const live = doc.objects.filter((o) => ids.has(o.id) && o.accepted !== 'rejected');
  const geometry = live.reduce((n, o) => n + o.issues.filter((i) => i.severity === 'blocking').length, 0);
  return { state, checks, blocking: blocking + geometry, warning: checks.filter((c) => c.severity === 'warning').length, passing: state === 'live' && blocking + geometry === 0 };
}

// ---- the checklist operations ------------------------------------------------------------------------------------------------------
const present = (doc: SiteDesign, id: string): SiteObject | undefined => doc.objects.find((o) => o.id === id);
const paramOf = (o: SiteObject | undefined, key: string) => (o && Object.prototype.hasOwnProperty.call(o.params, key) ? o.params[key] : undefined);

/** Accept: every new object of the proposal that is waiting becomes accepted. A link edit has nothing to accept (it was applied with the batch). */
export function acceptSteps(p: FdProposal, doc: SiteDesign): FdStep[] {
  return p.object_ids.filter((id) => { const o = present(doc, id); return o && o.origin === 'ai_proposal' && o.accepted !== 'accepted'; }).map((id) => ({ op: 'accept_proposal', args: { id } }));
}
/** Reject: the new objects are marked rejected (hidden, kept) and a link edit is undone, but only where the parameter still holds the value the proposal set. */
export function rejectSteps(p: FdProposal, doc: SiteDesign): { steps: FdStep[]; kept: string[] } {
  const steps: FdStep[] = p.object_ids.filter((id) => { const o = present(doc, id); return o && o.origin === 'ai_proposal' && o.accepted !== 'rejected'; }).map((id) => ({ op: 'reject_proposal', args: { id } }));
  const kept: string[] = [];
  const sets = p.steps.filter((s) => s.op === 'set_param');
  for (const s of sets) {
    const id = String(s.args.id), key = String(s.args.key), cur = paramOf(present(doc, id), key);
    if (!present(doc, id)) continue;
    if (cur && cur.value === s.args.value) steps.push(...p.revert_steps.filter((r) => r.args.id === id && r.args.key === key));
    else if (cur) kept.push(`${id} ${key}`);
  }
  return { steps, kept };
}
/** Restore: the rejected objects come back as pending and the link edits are set again where the parameter is still NOT SET. */
export function restoreSteps(p: FdProposal, doc: SiteDesign): FdStep[] {
  const steps: FdStep[] = p.object_ids.filter((id) => present(doc, id)?.accepted === 'rejected').map((id) => ({ op: 'restore_proposal', args: { id } }));
  for (const s of p.steps.filter((x) => x.op === 'set_param')) {
    const o = present(doc, String(s.args.id));
    if (!o) continue;
    const cur = paramOf(o, String(s.args.key));
    if (!cur || cur.basis === 'unresolved' || cur.value === null) steps.push(s);
  }
  return steps;
}
/** Display label of a proposal's candidate. */
export const proposalName = (p: FdProposal) => `${p.title} (OPTION ${p.candidate_id})`;

/** The other proposals whose operations refer to an object of this one (rejecting this proposal leaves them pointing at a hidden object, so the panel says so). */
export function dependents(p: FdProposal, all: readonly FdProposal[]): FdProposal[] {
  const mine = new Set(p.object_ids);
  if (!mine.size) return [];
  const refers = (v: unknown): boolean => (typeof v === 'string' ? mine.has(v) : Array.isArray(v) ? v.some(refers) : v && typeof v === 'object' ? Object.values(v as object).some(refers) : false);
  return all.filter((q) => q.id !== p.id && q.steps.some((s) => (s.op === 'set_param' ? refers(s.args.value) || mine.has(String(s.args.id)) : s.op === 'add_object' ? refers(s.args.params) : false)));
}
