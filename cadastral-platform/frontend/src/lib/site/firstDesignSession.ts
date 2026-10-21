/**
 * The state of AI first design in the Design tab (stage 10): the estimate shown before anything runs, the confirm step, the server answer and the checklist (accept, edit,
 * reject, restore, accept all passing). The batch is run through the store's `runBatch` with `atomic`, so it is ONE undo step and any failing operation applies nothing.
 *
 * The checklist state (which proposal is accepted or rejected) lives in this session. The objects keep their own accepted state in the document (pending, accepted, rejected), so
 * a reload keeps the objects and their state; a link edit has no object to mark, so after a reload it is simply part of the design.
 *
 * Nothing is calculated here. The server is authoritative, the checks are asked for again after every change (`documentChanged`).
 */
import { FirstDesignHttpError, postFirstDesign, postFirstDesignEstimate } from './firstDesignApi';
import {
  acceptSteps, assertAiBatch, dependents, liveChecksFor, rejectSteps, restoreSteps, type FdEstimateAnswer, type FdProposal, type FdResult, type LiveView,
} from './firstDesign';
import type { Endpoint } from './persist';
import { designSig, type ChecksState } from './serverChecks';
import type { SiteDesignStore } from './store';
import type { SiteDesign } from './types';

export type FdPhase = 'idle' | 'estimating' | 'ready' | 'confirm' | 'running' | 'review' | 'error' | 'no_server';
export type ItemStatus = 'pending' | 'accepted' | 'rejected';
export interface FdItem { id: string; status: ItemStatus; edited: boolean; notice: string }
export interface FdState {
  phase: FdPhase; useAi: boolean; estimate: FdEstimateAnswer | null; result: FdResult | null; items: FdItem[]; index: number; error: string; errorCode: string; message: string; applied: boolean;
}
export interface FdHooks { checks(): ChecksState; select(id: string | null): void; requestChecks(): void }
export const BATCH_LABEL = 'AI first design';
/** The reason the store gives while a request runs (read only), and the answer when the design changed under it. */
export const RUNNING_NOTE = 'AI DESIGN RUNNING';
export const CHANGED_NOTE = 'DESIGN CHANGED, RUN AGAIN';

export class FirstDesignSession {
  /** Saves the design now and returns why it could not be saved (null when saved). The server computes from the SAVED design and refuses (409 DESIGN_NOT_SAVED) a design that is not the saved one. */
  flush: (() => Promise<string | null>) | null = null;
  state: FdState = { phase: 'idle', useAi: true, estimate: null, result: null, items: [], index: 0, error: '', errorCode: '', message: '', applied: false };
  listener: (s: FdState) => void = () => {};
  private abort: AbortController | null = null;
  private dead = false;
  constructor(private ep: Endpoint | null, private getDoc: () => SiteDesign, private store: SiteDesignStore, private hooks: FdHooks) {
    if (!ep) this.state = { ...this.state, phase: 'no_server', error: 'NO SERVER: THIS VIEW HAS NO CONNECTION TO AI FIRST DESIGN' };
  }
  private put(p: Partial<FdState>) { this.state = { ...this.state, ...p }; if (!this.dead) this.listener(this.state); }
  private fail(err: unknown) {
    if ((err as { name?: string })?.name === 'AbortError') return;
    if (err instanceof FirstDesignHttpError) this.put({ phase: err.code === 'CONFIRM_REQUIRED' ? 'confirm' : 'error', error: err.message, errorCode: err.code });
    else this.put({ phase: 'error', error: err instanceof Error ? err.message : String(err), errorCode: 'ERROR' });
  }
  private begin() { this.abort?.abort(); const ac = this.abort = new AbortController(); return ac; }

  setUseAi(on: boolean) { this.put({ useAi: on, phase: this.state.phase === 'ready' || this.state.phase === 'confirm' ? 'idle' : this.state.phase, estimate: null, error: '', errorCode: '' }); }

  /** Save first. Returns false (and shows why) when the design could not be saved. */
  private async saved(): Promise<boolean> {
    if (!this.flush) return true;
    let why: string | null;
    try { why = await this.flush(); } catch (e) { why = e instanceof Error ? e.message : String(e); }
    if (why === null || this.dead) return why === null;
    this.put({ phase: 'error', error: `THE DESIGN COULD NOT BE SAVED, SO AI FIRST DESIGN WAS NOT RUN: ${why}`, errorCode: 'NOT_SAVED' });
    return false;
  }

  /** Ask what a run would cost. No model is called and nothing is spent. */
  async estimate(): Promise<boolean> {
    if (!this.ep) return false;
    const ac = this.begin();
    this.put({ phase: 'estimating', error: '', errorCode: '', message: '' });
    if (!(await this.saved())) { if (this.abort === ac) this.abort = null; return false; }
    if (this.dead || this.abort !== ac) return false;
    try {
      const est = await postFirstDesignEstimate(this.ep, this.getDoc(), this.state.useAi, ac.signal);
      if (this.dead || this.abort !== ac) return false;
      this.put({ phase: 'ready', estimate: est });
      return true;
    } catch (err) { if (this.abort === ac) this.fail(err); return false; }
    finally { if (this.abort === ac) this.abort = null; }
  }
  /** Run it. When the estimate is above the confirm threshold the first call stops at the confirm step (`confirm` false); calling again with `confirm` true runs it. */
  async run(confirm = false): Promise<boolean> {
    if (!this.ep) return false;
    if (this.store.locked) { this.put({ phase: 'error', error: this.store.locked, errorCode: 'LOCKED' }); return false; }
    const est = this.state.estimate?.estimate;
    if (!confirm && est?.uses_ai && est.requires_confirm) { this.put({ phase: 'confirm' }); return false; }
    const ac = this.begin();
    if (this.flush) this.put({ phase: 'running', error: '', errorCode: '', message: '' });          // shown while the design is saved
    if (!(await this.saved())) { if (this.abort === ac) this.abort = null; return false; }
    if (this.dead || this.abort !== ac) return false;
    const sent = this.getDoc();
    const sig = designSig(sent);                    // the design as it was sent: the answer is for this design and no other
    this.store.lock(RUNNING_NOTE);                  // read only while the request runs, so the design cannot change under it
    this.put({ phase: 'running', error: '', errorCode: '', message: '' });
    let res: FdResult, superseded = false;
    try {
      res = await postFirstDesign(this.ep, sent, { useAi: this.state.useAi, confirm }, ac.signal);
      superseded = this.dead || this.abort !== ac;
    } catch (err) { if (this.abort === ac) this.fail(err); return false; }
    finally {
      if (this.store.locked === RUNNING_NOTE) this.store.unlock();                      // always opened again, whatever happened (another lock, e.g. a reload, is left alone)
      if (this.abort === ac) this.abort = null;
    }
    if (superseded) return false;
    if (designSig(this.getDoc()) !== sig) { this.put({ phase: 'error', error: CHANGED_NOTE, errorCode: 'DESIGN_CHANGED' }); return false; }
    return this.apply(res);
  }
  /** Run the batch as ONE undo step, all or nothing. */
  private apply(res: FdResult): boolean {
    try { assertAiBatch(res.batch, this.getDoc()); }
    catch (e) { this.put({ phase: 'error', error: `THE ANSWER WAS REFUSED: ${e instanceof Error ? e.message : String(e)}`, errorCode: 'BATCH_REFUSED' }); return false; }
    if (res.batch.length) {
      let out;
      try { out = this.store.runBatch(`${BATCH_LABEL}: ${res.proposals.length} PROPOSAL(S)`, res.batch.map((s) => ({ op: s.op, args: s.args })), { atomic: true, engine: true }); }
      catch (e) { this.put({ phase: 'error', error: e instanceof Error ? e.message : String(e), errorCode: 'LOCKED' }); return false; }
      const bad = out.find((r) => !r.ok);
      if (bad && !bad.ok) { this.put({ phase: 'error', error: `NOTHING WAS APPLIED: ${bad.op}: ${bad.error}`, errorCode: 'BATCH_FAILED' }); return false; }
    }
    this.hooks.requestChecks();
    this.put({ phase: 'review', result: res, applied: res.batch.length > 0, index: 0, items: res.proposals.map((p) => ({ id: p.id, status: 'pending', edited: false, notice: '' })),
               message: res.batch.length ? '' : 'NOTHING COULD BE PROPOSED. THE REASONS ARE LISTED BELOW.' });
    return true;
  }

  // ---- the checklist
  proposal(id: string): FdProposal | undefined { return this.state.result?.proposals.find((p) => p.id === id); }
  item(id: string): FdItem | undefined { return this.state.items.find((i) => i.id === id); }
  private setItem(id: string, patch: Partial<FdItem>) { this.put({ items: this.state.items.map((i) => (i.id === id ? { ...i, ...patch } : i)) }); }
  private runSteps(label: string, steps: { op: string; args: Record<string, unknown> }[]): string | null {
    if (!steps.length) return null;
    try {
      const out = this.store.runBatch(label, steps, { atomic: true, engine: true });
      const bad = out.find((r) => !r.ok);
      this.hooks.requestChecks();
      return bad && !bad.ok ? `${bad.op}: ${bad.error}` : null;
    } catch (e) { return e instanceof Error ? e.message : String(e); }
  }
  accept(id: string): string | null {
    const p = this.proposal(id); if (!p) return 'NO SUCH PROPOSAL';
    const err = this.runSteps(`Accept ${p.title}`, acceptSteps(p, this.getDoc()));
    if (err) { this.setItem(id, { notice: err }); return err; }
    this.setItem(id, { status: 'accepted', notice: '' });
    return null;
  }
  reject(id: string): string | null {
    const p = this.proposal(id); if (!p) return 'NO SUCH PROPOSAL';
    const { steps, kept } = rejectSteps(p, this.getDoc());
    const err = this.runSteps(`Reject ${p.title}`, steps);
    if (err) { this.setItem(id, { notice: err }); return err; }
    const dep = dependents(p, this.state.result?.proposals ?? []).map((q) => q.title);
    this.setItem(id, { status: 'rejected', notice: [kept.length ? `KEPT, CHANGED SINCE: ${kept.join(', ')}` : '', dep.length ? `OTHER PROPOSALS REFER TO THIS ONE: ${dep.join(', ')}` : ''].filter(Boolean).join('. ') });
    return null;
  }
  restore(id: string): string | null {
    const p = this.proposal(id); if (!p) return 'NO SUCH PROPOSAL';
    const err = this.runSteps(`Restore ${p.title}`, restoreSteps(p, this.getDoc()));
    if (err) { this.setItem(id, { notice: err }); return err; }
    this.setItem(id, { status: 'pending', notice: '' });
    return null;
  }
  /** Select the proposal's first object so it can be edited with the normal tools. It stays in the list, still waiting for acceptance. */
  edit(id: string) {
    const p = this.proposal(id); if (!p) return;
    const target = p.object_ids.find((o) => this.getDoc().objects.some((x) => x.id === o && x.accepted !== 'rejected')) ?? p.edited_ids[0];
    if (target) this.hooks.select(target);
    this.setItem(id, { edited: true });
  }
  view(id: string): LiveView | null {
    const p = this.proposal(id); return p ? liveChecksFor(p, this.hooks.checks(), this.getDoc()) : null;
  }
  /** Accept every proposal that is waiting, has no blocking failure of its own and whose live checks (for the document as it is now) have no blocking check. */
  acceptAllPassing(): { accepted: string[]; left: string[] } {
    const accepted: string[] = [], left: string[] = [];
    for (const it of this.state.items) {
      if (it.status !== 'pending') continue;
      const p = this.proposal(it.id), v = p && this.view(it.id);
      if (p && v && !p.blocked && v.passing && !this.accept(it.id)) accepted.push(it.id); else left.push(it.id);
    }
    this.put({ message: `${accepted.length} ACCEPTED${left.length ? `, ${left.length} LEFT FOR YOU TO CHECK` : ''}` });
    return { accepted, left };
  }
  go(i: number) { const n = this.state.result?.proposals.length ?? 0; if (n) this.put({ index: Math.max(0, Math.min(n - 1, i)) }); }
  next() { this.go(this.state.index + 1); }
  prev() { this.go(this.state.index - 1); }
  /** Leave the review (the objects stay as they are) and go back to the start. */
  close() { this.abort?.abort(); if (this.store.locked === RUNNING_NOTE) this.store.unlock(); this.put({ phase: this.ep ? 'idle' : 'no_server', result: null, items: [], estimate: null, index: 0, message: '', error: '', errorCode: '', applied: false }); }
  /** The document changed: the controller asks for the checks again and the panel reads them live, so there is nothing to recompute here; the listener is told so the panel redraws. */
  documentChanged() { if (this.state.phase === 'review' && !this.dead) this.listener(this.state); }
  dispose() { this.dead = true; this.abort?.abort(); this.abort = null; if (this.store.locked === RUNNING_NOTE) this.store.unlock(); }
}
