/** Stage 10: AI first design in the browser. The fixture is a REAL answer of the backend (rules mode, synthetic site with FAKE rule values): the batch is run through the store as
 *  one undo step, the checklist accepts, rejects and restores, and the safety guard refuses anything that is not an AI first design batch. */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { OPS, toolSchemas } from '@/lib/site/ops';
import { SiteDesignStore } from '@/lib/site/store';
import type { SiteDesign } from '@/lib/site/types';
import { ENGINE_REF_PREFIX } from '@/lib/site/types';
import { AI_BATCH_OPS, acceptSteps, assertAiBatch, dependents, liveChecksFor, rejectSteps, restoreSteps, type FdResult, type FdStep } from '@/lib/site/firstDesign';
import { FirstDesignSession } from '@/lib/site/firstDesignSession';
import { postFirstDesign } from '@/lib/site/firstDesignApi';
import { designSig, type ChecksState } from '@/lib/site/serverChecks';
import { seqCtx } from './helpers';

const FIX = JSON.parse(readFileSync(join(__dirname, '../../../backend/tests/fixtures/first_design_v1.json'), 'utf8')) as { design: SiteDesign; result: FdResult };
const fresh = () => structuredClone(FIX.design);
const result = () => structuredClone(FIX.result);
const DASH = /[‒-―−]/;

function storeWith(doc: SiteDesign) { const s = new SiteDesignStore(doc, seqCtx()); return s; }
const okChecks = (doc: SiteDesign, checks: unknown[] = []): ChecksState => ({
  status: 'ok', error: '', seq: 1, sig: designSig(doc), resultSig: designSig(doc),
  result: { schema: 'site_checks.v1', rules_for: '', jurisdiction: null, lga: null, terrain: { available: true, status: '' }, lot_available: true, kerb_available: true, checks: checks as never, values: {},
            summary: { blocking: 0, warning: 0, info: 0, total: 0, by_status: {} }, notes: [] },
});

function rig(over: { res?: FdResult; status?: number; body?: unknown; est?: object } = {}) {
  const store = storeWith(fresh());
  const calls: { url: string; body: Record<string, unknown> }[] = [];
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    calls.push({ url, body });
    if (over.status && over.status !== 200) return new Response(JSON.stringify(over.body ?? { code: 'ERROR', message: 'x' }), { status: over.status });
    if (body.estimate) return new Response(JSON.stringify({ schema: 'first_design_estimate.v1', estimate: { calls: 2, input_tokens: 3000, output_tokens: 3000, cost_usd: 0.0018, requires_confirm: false, confirm_usd: 0.01, rounds: 2, max_calls: 6, max_cost_usd: 0.006, model: 'claude-haiku-5-5', uses_ai: true, reason: '', ...over.est },
      ai_available: true, model: 'claude-haiku-5-5', spend: { day_usd: 0, day_cap_usd: 5, month_usd: 0, month_cap_usd: 50 }, sets: [] }), { status: 200 });
    return new Response(JSON.stringify(over.res ?? result()), { status: 200 });
  }) as unknown as typeof fetch;
  let checks: ChecksState = okChecks(store.doc);
  const selected: (string | null)[] = [], asked: number[] = [];
  const s = new FirstDesignSession({ base: 'http://api', projectId: 'p', fetchImpl }, () => store.doc, store, { checks: () => checks, select: (id) => selected.push(id), requestChecks: () => asked.push(1) });
  return { s, store, calls, selected, asked, setChecks: (c: ChecksState) => { checks = c; } };
}

describe('the batch', () => {
  it('runs through the store as ONE undo step, all objects are AI proposals waiting for acceptance, and undo takes it all back', async () => {
    const r = rig();
    const before = structuredClone(r.store.doc);
    expect(await r.s.run()).toBe(true);
    expect(r.s.state.phase).toBe('review');
    const h = r.store.history();
    expect(h.undoCount).toBe(1); expect(h.undoLabel).toMatch(/^AI first design: 6 PROPOSAL/);
    const added = r.store.doc.objects.filter((o) => !before.objects.some((b) => b.id === o.id));
    expect(added.length).toBe(result().proposals.reduce((n, p) => n + p.object_ids.length, 0));
    expect(added.every((o) => o.origin === 'ai_proposal' && o.accepted === 'pending' && o.type !== 'building')).toBe(true);
    expect(r.asked.length).toBeGreaterThan(0);                                         // the checks are asked for again
    r.store.undo();
    expect(r.store.doc.objects.map((o) => o.id)).toEqual(before.objects.map((o) => o.id));
    expect(r.store.doc.objects.find((o) => o.id === 'osd1')).toEqual(before.objects.find((o) => o.id === 'osd1'));
    expect(r.store.history().undoCount).toBe(0);
  });
  it('is applied all or nothing: a step that fails rolls everything back and says why', async () => {
    const res = result();
    res.batch.push({ op: 'add_object', args: { ...(res.batch[0].args as object), id: 'ai_drive_2' } } as FdStep);       // a duplicate id
    const r = rig({ res });
    expect(await r.s.run()).toBe(false);
    expect(r.s.state.phase).toBe('error');
    expect(r.store.doc.objects.length).toBe(FIX.design.objects.length);
    expect(r.store.history().undoCount).toBe(0);
  });
  it('never creates or moves a building and never contains an operation the AI is not given', () => {
    const steps = result().batch;
    expect(steps.every((s) => AI_BATCH_OPS.includes(s.op) && OPS[s.op].ai !== false)).toBe(true);
    expect(steps.some((s) => s.op === 'add_object' && s.args.type === 'building')).toBe(false);
    expect(() => assertAiBatch(steps, FIX.design)).not.toThrow();
    const bad = (s: FdStep[]) => expect(() => assertAiBatch(s, FIX.design)).toThrow();
    bad([{ op: 'place_building', args: {} }]);
    bad([{ op: 'move_object', args: { id: 'house', dx: 1, dy: 0 } }]);
    bad([{ op: 'delete_object', args: { id: 'house' } }]);
    bad([{ op: 'accept_proposal', args: { id: 'x' } }]);
    bad([{ op: 'add_object', args: { type: 'building', id: 'b2', origin: 'ai_proposal', points: [] } }]);
    bad([{ op: 'add_object', args: { type: 'tree', id: 'tr1', origin: 'user', points: [{ e: 1, n: 1 }] } }]);
    bad([{ op: 'add_object', args: { type: 'tree', id: 'house', origin: 'ai_proposal', points: [{ e: 1, n: 1 }] } }]);
    bad([{ op: 'set_param', args: { id: 'house', key: 'ffl_rl', value: 5 } }]);                  // an existing object only ever gets a link
    bad([{ op: 'set_param', args: { id: 'nope', key: 'drains_to_id', value: 'dp1' } }]);
    bad(Array.from({ length: 401 }, (_x, i) => ({ op: 'add_object', args: { type: 'tree', id: `t${i}`, origin: 'ai_proposal', points: [{ e: 1, n: 1 }] } })));
    expect(() => assertAiBatch([{ op: 'set_param', args: { id: 'house', key: 'drains_to_id', value: 'dp1', basis: 'derived', ref: `${ENGINE_REF_PREFIX}: STORMWATER LINK GENERATOR FROM THE BUILDING` } }], FIX.design)).not.toThrow();
    bad([{ op: 'set_param', args: { id: 'house', key: 'drains_to_id', value: 'dp1' } }]);                                    // a link is derived by an engine, never USER
  });
  it('refuses a status other than proposed, a number on a new object (but for the two derived ones), and a set_param outside the allow list on a new object', () => {
    const base = result().batch;
    const drive = base.find((s) => s.op === 'add_object' && s.args.type === 'driveway')!;
    const withArgs = (patch: Record<string, unknown>, params?: Record<string, unknown>): FdStep[] => base.map((s) => (s === drive
      ? { op: 'add_object', args: { ...drive.args, ...patch, params: { ...(drive.args.params as object), ...(params ?? {}) } } } : s));
    const bad = (steps: FdStep[], re: RegExp) => expect(() => assertAiBatch(steps, FIX.design)).toThrow(re);
    expect(() => assertAiBatch(base, FIX.design)).not.toThrow();
    bad(withArgs({ status: 'existing' }), /STATUS PROPOSED/);
    bad(withArgs({ status: undefined }), /STATUS PROPOSED/);
    bad(withArgs({}, { width_m: { value: 3, basis: 'user' } }), /MAY NOT CARRY A VALUE/);
    bad(withArgs({}, { width_m: { value: 3, basis: 'derived', ref: `${ENGINE_REF_PREFIX}: X FROM Y` } }), /MAY NOT CARRY A VALUE/);
    bad(withArgs({}, { surface_kind: { value: 'concrete', basis: 'user' } }), /MAY NOT CARRY A VALUE/);
    bad(withArgs({}, { crossover_chainage_m: { value: 4, basis: 'derived', ref: 'ENTERED BY HAND' } }), /NAME THE ENGINE/);
    bad(withArgs({}, { end_building_id: { value: 7, basis: 'derived', ref: `${ENGINE_REF_PREFIX}: X FROM Y` } }), /NUMBER/);
    expect(() => assertAiBatch(withArgs({}, { crossover_chainage_m: { value: 4.5, basis: 'derived', ref: `${ENGINE_REF_PREFIX}: DRIVEWAY GENERATOR FROM THE KERB` } }), FIX.design)).not.toThrow();
    const id = String(drive.args.id);
    const setp = (key: string, value: unknown = 'dp1'): FdStep[] => [...base, { op: 'set_param', args: { id, key, value, basis: 'derived', ref: `${ENGINE_REF_PREFIX}: X FROM Y` } }];
    bad(setp('width_m'), /MAY NOT CHANGE WIDTH_M OF A NEW OBJECT/);
    bad(setp('crossover_chainage_m', 5), /MAY NOT CHANGE/);
    bad(setp('drains_to_id', 5), /NUMBER/);
    bad([...base, { op: 'remove_param', args: { id, key: 'width_m' } }], /MAY NOT CHANGE/);
  });
  it('is refused by the session before it runs when it breaks the guard', async () => {
    const res = result();
    res.batch.unshift({ op: 'move_object', args: { id: 'house', dx: 1, dy: 1 } });
    const r = rig({ res });
    expect(await r.s.run()).toBe(false);
    expect(r.s.state.errorCode).toBe('BATCH_REFUSED'); expect(r.store.history().undoCount).toBe(0);
  });
  it('the AI is not offered accept, reject or restore', () => {
    const names = toolSchemas().map((t) => t.name);
    for (const n of ['accept_proposal', 'reject_proposal', 'restore_proposal', 'place_building', 'add_service_objects']) expect(names).not.toContain(n);
    expect(OPS.restore_proposal.ai).toBe(false);
  });
});

describe('the checklist', () => {
  async function ready() { const r = rig(); await r.s.run(); return r; }
  const objs = (r: Awaited<ReturnType<typeof ready>>, id: string) => result().proposals.find((p) => p.id === id)!.object_ids.map((o) => r.store.doc.objects.find((x) => x.id === o)!);

  it('accept marks the objects of one proposal accepted, as one undo step', async () => {
    const r = await ready();
    const n = r.store.history().undoCount;
    expect(r.s.accept('driveway')).toBeNull();
    expect(objs(r, 'driveway').every((o) => o.accepted === 'accepted')).toBe(true);
    expect(objs(r, 'tank').every((o) => o.accepted === 'pending')).toBe(true);
    expect(r.store.history().undoCount).toBe(n + 1); expect(r.s.item('driveway')!.status).toBe('accepted');
    expect(r.store.history().undoLabel).toBe('Accept DRIVEWAY');
  });
  it('reject hides the objects (kept, marked rejected), restore brings them back as pending', async () => {
    const r = await ready();
    r.s.reject('tank');
    expect(objs(r, 'tank').every((o) => o.accepted === 'rejected')).toBe(true); expect(r.s.item('tank')!.status).toBe('rejected');
    expect(r.s.item('tank')!.notice).toMatch(/OTHER PROPOSALS REFER/);                  // the stormwater links point at the tank
    r.s.restore('tank');
    expect(objs(r, 'tank').every((o) => o.accepted === 'pending')).toBe(true); expect(r.s.item('tank')!.status).toBe('pending');
  });
  it('reject undoes a link edit and restore sets it again, but never overwrites a value the user changed', async () => {
    const r = await ready();
    const p = result().proposals.find((x) => x.id === 'stormwater')!;
    const e = p.steps.find((s) => s.op === 'set_param')!;
    const get = () => r.store.doc.objects.find((o) => o.id === e.args.id)!.params[String(e.args.key)];
    expect(get()?.value).toBe(e.args.value);
    r.s.reject('stormwater');
    expect(get() === undefined || get().basis === 'unresolved' || get().value === null).toBe(true);
    r.s.restore('stormwater');
    expect(get().value).toBe(e.args.value);
    r.store.run('set_param', { id: e.args.id, key: e.args.key, value: 'dp1' });
    const { kept } = rejectSteps(p, r.store.doc);
    if (e.args.value !== 'dp1') expect(kept.length).toBeGreaterThan(0);
  });
  it('accept all passing accepts only proposals whose live checks have no blocking check', async () => {
    const r = await ready();
    const tank = result().proposals.find((p) => p.id === 'tank')!;
    r.setChecks(okChecks(r.store.doc, [{ id: `${tank.object_ids[0]}:RWT_X`, object_id: tank.object_ids[0], object_type: 'rwt', object_label: '', code: 'RWT_X', title: 'T', status: 'FAIL', severity: 'blocking', message: 'm', requirements: [], basis: 'MODEL CHECK', value: null, limit: null, unit: '' }]));
    const out = r.s.acceptAllPassing();
    expect(out.left).toContain('tank'); expect(out.accepted).not.toContain('tank'); expect(out.accepted).toContain('driveway');
    expect(r.s.item('tank')!.status).toBe('pending'); expect(r.s.item('driveway')!.status).toBe('accepted');
    expect(r.s.state.message).toMatch(/ACCEPTED/);
  });
  it('accepts nothing while the checks are not current (an old answer is never trusted)', async () => {
    const r = await ready();
    const st = okChecks(r.store.doc); r.setChecks({ ...st, resultSig: 'older' });
    expect(r.s.acceptAllPassing().accepted).toEqual([]);
    expect(r.s.view('driveway')!.state).toBe('stale');
  });
  it('edit selects the first object of the proposal and keeps it waiting', async () => {
    const r = await ready();
    r.s.edit('landscape');
    expect(r.selected.at(-1)).toBe(result().proposals.find((p) => p.id === 'landscape')!.object_ids[0]);
    expect(r.s.item('landscape')).toMatchObject({ status: 'pending', edited: true });
  });
  it('steps through the proposals', async () => {
    const r = await ready();
    expect(r.s.state.index).toBe(0); r.s.next(); expect(r.s.state.index).toBe(1); r.s.go(99); expect(r.s.state.index).toBe(5); r.s.prev(); expect(r.s.state.index).toBe(4); r.s.go(-3); expect(r.s.state.index).toBe(0);
  });
  it('pure helpers: live view, dependents and the operations built from the document', async () => {
    const r = await ready();
    const res = result();
    const tank = res.proposals.find((p) => p.id === 'tank')!;
    expect(dependents(tank, res.proposals).map((p) => p.id)).toContain('stormwater');
    const v = liveChecksFor(tank, okChecks(r.store.doc), r.store.doc);
    expect(v).toMatchObject({ state: 'live', blocking: 0, passing: true });
    expect(liveChecksFor(tank, { ...okChecks(r.store.doc), status: 'pending' }, r.store.doc).state).toBe('pending');
    expect(liveChecksFor(tank, { status: 'idle', error: '', seq: 0, sig: '', result: null, resultSig: '' }, r.store.doc).state).toBe('none');
    expect(acceptSteps(tank, r.store.doc).every((s) => s.op === 'accept_proposal')).toBe(true);
    expect(restoreSteps(tank, r.store.doc)).toEqual([]);                                // nothing is rejected, nothing to restore
  });
});

describe('the estimate, the confirm step and the errors', () => {
  it('asks for the estimate without running anything, and shows tokens and cost', async () => {
    const r = rig();
    expect(await r.s.estimate()).toBe(true);
    expect(r.s.state.phase).toBe('ready'); expect(r.s.state.estimate!.estimate).toMatchObject({ input_tokens: 3000, cost_usd: 0.0018, model: 'claude-haiku-5-5' });
    expect(r.calls.map((c) => c.body.estimate)).toEqual([true]); expect(r.store.history().undoCount).toBe(0);
  });
  it('stops at a confirm step above the threshold and runs only after the confirmation', async () => {
    const r = rig({ est: { requires_confirm: true, cost_usd: 0.5 } });
    await r.s.estimate();
    expect(await r.s.run(false)).toBe(false);
    expect(r.s.state.phase).toBe('confirm'); expect(r.calls.filter((c) => !c.body.estimate)).toHaveLength(0);
    expect(await r.s.run(true)).toBe(true);
    expect(r.calls.at(-1)!.body).toMatchObject({ estimate: false, confirm_large: true, use_ai: true });
  });
  it('locks the store (read only, AI DESIGN RUNNING) while the request runs and opens it again, also after a failure', async () => {
    const seen: (string | null)[] = [];
    let attempt: string | null = null;
    const store = storeWith(fresh());
    let calls = 0;
    const fetchImpl = (async () => {
      seen.push(store.locked);
      try { store.run('set_param', { id: 'house', key: 'ffl_rl', value: 5 }); } catch (e) { attempt = e instanceof Error ? e.message : String(e); }
      calls += 1;
      return calls === 1 ? new Response(JSON.stringify(result()), { status: 200 }) : new Response(JSON.stringify({ code: 'AI_PAUSED', message: 'paused' }), { status: 503 });
    }) as unknown as typeof fetch;
    const s = new FirstDesignSession({ base: 'http://api', projectId: 'p', fetchImpl }, () => store.doc, store, { checks: () => okChecks(store.doc), select: () => {}, requestChecks: () => {} });
    const states: string[] = [];
    s.listener = (st) => { if (st.phase === 'running') states.push(String(store.locked)); };
    expect(await s.run()).toBe(true);
    expect(seen).toEqual(['AI DESIGN RUNNING']); expect(attempt).toBe('AI DESIGN RUNNING'); expect(states).toEqual(['AI DESIGN RUNNING']);
    expect(store.locked).toBeNull(); expect(store.history().undoCount).toBe(1);
    const t = rig({ status: 503, body: { code: 'AI_PAUSED', message: 'paused' } });
    expect(await t.s.run()).toBe(false); expect(t.store.locked).toBeNull();
    s.close(); store.undo();
    expect(await s.run()).toBe(false); expect(store.locked).toBeNull(); expect(s.state.errorCode).toBe('AI_PAUSED');
  });
  it('refuses to apply an answer when the design changed since it was sent: DESIGN CHANGED, RUN AGAIN', async () => {
    const store = storeWith(fresh());
    const fetchImpl = (async () => {
      const moved = structuredClone(store.doc); moved.objects.find((o) => o.id === 'osd1')!.params.width_m = { value: 9, basis: 'user' };      // the saved design is replaced while the request runs
      store.replace(moved);
      return new Response(JSON.stringify(result()), { status: 200 });
    }) as unknown as typeof fetch;
    const s = new FirstDesignSession({ base: 'http://api', projectId: 'p', fetchImpl }, () => store.doc, store, { checks: () => okChecks(store.doc), select: () => {}, requestChecks: () => {} });
    const before = store.history().undoCount;
    expect(await s.run()).toBe(false);
    expect(s.state).toMatchObject({ phase: 'error', errorCode: 'DESIGN_CHANGED', error: 'DESIGN CHANGED, RUN AGAIN' });
    expect(store.history().undoCount).toBe(before); expect(store.doc.objects.some((o) => o.origin === 'ai_proposal')).toBe(false); expect(store.locked).toBeNull();
  });
  it('a request without the AI sends use_ai false', async () => {
    const r = rig(); r.s.setUseAi(false);
    await r.s.run();
    expect(r.calls.at(-1)!.body.use_ai).toBe(false);
  });
  it('reports the server refusals with their code and applies nothing', async () => {
    for (const [status, code] of [[503, 'AI_PAUSED'], [429, 'RATE_LIMITED'], [422, 'AI_INPUT_TOO_LARGE']] as const) {
      const r = rig({ status, body: { code, message: `refused ${code}` } });
      expect(await r.s.run()).toBe(false);
      expect(r.s.state).toMatchObject({ phase: 'error', errorCode: code, error: `refused ${code}` });
      expect(r.store.history().undoCount).toBe(0);
    }
    const c = rig({ status: 409, body: { code: 'CONFIRM_REQUIRED', message: 'confirm' } });
    await c.s.run(); expect(c.s.state.phase).toBe('confirm');
  });
  it('is read only while the design is locked, and says there is no server on a page without one', async () => {
    const r = rig(); r.store.lock('LOADING SAVED DESIGN');
    expect(await r.s.run()).toBe(false); expect(r.s.state.errorCode).toBe('LOCKED');
    const n = new FirstDesignSession(null, () => FIX.design, storeWith(fresh()), { checks: () => okChecks(FIX.design), select: () => {}, requestChecks: () => {} });
    expect(n.state.phase).toBe('no_server'); expect(await n.run()).toBe(false); expect(await n.estimate()).toBe(false);
  });
  it('the client posts the design to the route of the project', async () => {
    const f = vi.fn(async (_u: string, _i?: RequestInit) => new Response(JSON.stringify(result()), { status: 200 }));
    await postFirstDesign({ base: 'http://api', projectId: 'a b', fetchImpl: f as unknown as typeof fetch }, fresh(), { useAi: true, confirm: false });
    expect(f.mock.calls[0][0]).toBe('http://api/projects/a%20b/ai/first-design');
  });
  it('no user facing text of a proposal contains a dash', () => {
    const texts = result().proposals.flatMap((p) => [p.title, p.reason, p.selected_by, ...p.required_inputs]);
    expect(texts.filter((t) => DASH.test(t))).toEqual([]);
  });
});
