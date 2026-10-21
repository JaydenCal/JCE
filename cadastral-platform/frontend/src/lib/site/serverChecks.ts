/**
 * The rule based checks of the whole design (stage 7). The SERVER is authoritative: POST /projects/{id}/site-design/check evaluates every check with the
 * resolved requirements and returns `site_checks.v1`. This module holds the types of that answer and `LiveChecks`, which asks for it the same way the
 * stage 6 engines are asked for (debounced, abortable, sequenced: an answer for an older document never replaces the answer for the latest one).
 *
 * Without an endpoint (the demo page) nothing is requested and the status says NO SERVER. Nothing is evaluated in the browser: a limit is a rule, and rules are
 * resolved on the server.
 */
import { postSiteCheck, EngineHttpError } from './engineApi';
import type { Endpoint } from './persist';
import type { SiteDesign } from './types';

export type CheckStatus = 'PASS' | 'FAIL' | 'NOT EVALUATED' | 'NOT APPLICABLE' | 'ACTION REQUIRED' | 'INFO';
export interface CheckRequirement { key: string; value: number | boolean | string | number[] | null; unit: string; basis: string; ref: string; stamp?: string }
export interface CheckEntry {
  id: string; object_id: string | null; object_type: string | null; object_label: string; code: string; title: string; status: CheckStatus;
  severity: 'blocking' | 'warning' | 'info'; message: string; requirements: CheckRequirement[]; basis: string; value: number | string | null; limit: number | string | null; unit: string;
  /** retaining wall screening detail (SCREENING ONLY, NOT STRUCTURAL DESIGN) */
  screening?: unknown;
}
export interface CheckValue { key: string; label: string; value: number | string | boolean | null; unit: string; basis: string; ref: string; stamp?: string }
export interface CheckResult {
  schema: 'site_checks.v1'; rules_for: string; jurisdiction: string | null; lga: string | null;
  terrain: { available: boolean; status: string }; lot_available: boolean; kerb_available: boolean;
  checks: CheckEntry[]; values: Record<string, CheckValue[]>;
  summary: { blocking: number; warning: number; info: number; total: number; by_status: Record<string, number> }; notes: string[];
}
export type ChecksStatus = 'idle' | 'pending' | 'ok' | 'error' | 'no_server';
export interface ChecksState { status: ChecksStatus; error: string; seq: number; sig: string; result: CheckResult | null; resultSig: string }

/** What the checks depend on: the objects without their derived issues. */
export const designSig = (d: SiteDesign) => JSON.stringify(d.objects.map((o) => { const { issues: _i, ...rest } = o; void _i; return rest; }));

export interface LiveChecksOptions { ep: Endpoint | null; debounceMs?: number; setTimer?: typeof setTimeout; clearTimer?: typeof clearTimeout }
export class LiveChecks {
  state: ChecksState = { status: 'idle', error: '', seq: 0, sig: '', result: null, resultSig: '' };
  listener: (s: ChecksState) => void = () => {};
  /** server calls started (tests and the debug HUD) */
  calls = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private abort: AbortController | null = null;
  private seq = 0;
  private dead = false;
  constructor(private o: LiveChecksOptions) {}
  get debounceMs() { return this.o.debounceMs ?? 400; }
  setEndpoint(ep: Endpoint | null) { this.o.ep = ep; }
  private put(s: ChecksState) { this.state = s; if (!this.dead) this.listener(s); }

  /** Ask for the checks of `doc`. A request for the same document that is pending or answered is not repeated. Returns the sequence number. */
  request(doc: SiteDesign, opts: { debounce?: boolean; force?: boolean } = {}): number {
    const sig = designSig(doc), cur = this.state;
    if (!opts.force && cur.sig === sig && (cur.status === 'pending' || cur.status === 'ok')) return cur.seq;
    const seq = ++this.seq;
    if (this.timer) { (this.o.clearTimer ?? clearTimeout)(this.timer); this.timer = null; }
    this.abort?.abort(); this.abort = null;
    if (!this.o.ep) { this.put({ status: 'no_server', error: 'NO SERVER: THIS VIEW HAS NO CONNECTION TO THE CHECKS', seq, sig, result: null, resultSig: '' }); return seq; }
    this.put({ status: 'pending', error: '', seq, sig, result: cur.result, resultSig: cur.resultSig });
    const run = async () => {
      this.timer = null;
      const ac = new AbortController(); this.abort = ac; this.calls++;
      try {
        const res = await postSiteCheck(this.o.ep!, doc, ac.signal);
        if (this.dead || this.state.seq !== seq) return;
        this.put({ status: 'ok', error: '', seq, sig, result: res, resultSig: sig });
      } catch (err) {
        if (this.dead || this.state.seq !== seq || (err as { name?: string })?.name === 'AbortError') return;
        this.put({ status: 'error', error: err instanceof EngineHttpError ? err.message : String(err), seq, sig, result: this.state.result, resultSig: this.state.resultSig });
      } finally { if (this.abort === ac) this.abort = null; }
    };
    const wait = opts.debounce ?? true;
    if (wait && this.debounceMs > 0) this.timer = (this.o.setTimer ?? setTimeout)(() => { void run(); }, this.debounceMs); else void run();
    return seq;
  }
  /** Forget the answer and any pending request (the design is empty). */
  reset() {
    if (this.timer) (this.o.clearTimer ?? clearTimeout)(this.timer);
    this.timer = null; this.abort?.abort(); this.abort = null; this.seq++;
    if (this.state.status !== 'idle' || this.state.result) this.put({ status: 'idle', error: '', seq: this.seq, sig: '', result: null, resultSig: '' });
  }
  /** The answer is for the document as it is now. */
  fresh(doc: SiteDesign): boolean { return this.state.status === 'ok' && this.state.resultSig === designSig(doc); }
  dispose() { this.dead = true; if (this.timer) (this.o.clearTimer ?? clearTimeout)(this.timer); this.timer = null; this.abort?.abort(); this.abort = null; }
}
