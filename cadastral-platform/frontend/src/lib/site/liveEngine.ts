/**
 * Live results of the stage 6 engines for the objects being edited: debounced server calls with sequence numbers and aborts.
 *
 * - `request(obj, ...)` schedules a call; a newer request for the same object id aborts and supersedes the older one, so a slow answer for an
 *   old position can never replace the answer for the latest one (stale answers are dropped).
 * - During a drag the caller asks with `detail 'profile'`, which is DEBOUNCED by default (one call per pause of the pointer). A `detail 'full'` request
 *   (the release of a drag, or any edit that is not a drag) is sent IMMEDIATELY by default: the person has stopped, so there is nothing to wait for. Either
 *   default can be overridden with `debounce`. Grading areas have no drag preview and keep the debounce.
 * - A driveway request may carry the linked `building` as the browser has it (current FFL and footprint); the server checks it against the saved design.
 * - Results are kept outside the document and outside the undo history. A result is tied to the signature of the object it was computed for.
 * - Without an endpoint (the demo page) nothing is requested and the status says NO SERVER.
 */
import { postDrivewayProfile, postGrading, EngineHttpError } from './engineApi';
import type { DrivewayProfile, GradingResult } from './driveway';
import type { Endpoint } from './persist';
import type { SiteObject } from './types';

export type LiveStatus = 'idle' | 'pending' | 'ok' | 'error' | 'no_server';
export interface LiveEntry<T> {
  status: LiveStatus; error: string; seq: number;
  /** signature of the object the latest REQUEST is for, and the detail asked for */
  sig: string; detail: 'profile' | 'full' | null;
  /** the latest answer, the signature of the object it is for and the detail it has (an older answer is kept while a newer request is pending) */
  result: T | null; resultSig: string; resultDetail: 'profile' | 'full' | null;
}
export interface LiveOptions { ep: Endpoint | null; debounceMs?: number; setTimer?: typeof setTimeout; clearTimer?: typeof clearTimeout }

/** What the engines depend on: geometry and parameters (not issues, not the label). */
export const objectSig = (o: SiteObject) => JSON.stringify([o.type, o.geometry, o.params]);

export class LiveEngine {
  readonly drive = new Map<string, LiveEntry<DrivewayProfile>>();
  readonly grade = new Map<string, LiveEntry<GradingResult>>();
  listener: (kind: 'drive' | 'grade', id: string) => void = () => {};
  /** counts of server calls started (tests and the debug HUD) */
  calls = 0;
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  private aborts = new Map<string, AbortController>();
  private seq = 0;
  private dead = false;

  constructor(private o: LiveOptions) {}
  get debounceMs() { return this.o.debounceMs ?? 150; }
  setEndpoint(ep: Endpoint | null) { this.o.ep = ep; }

  private key = (kind: string, id: string) => `${kind}:${id}`;
  private put<T>(map: Map<string, LiveEntry<T>>, kind: 'drive' | 'grade', id: string, e: LiveEntry<T>) { map.set(id, e); if (!this.dead) this.listener(kind, id); }

  /** Ask the server for the long section of a driveway. Returns the sequence number of the request. */
  requestDrive(obj: SiteObject, opts: { detail?: 'profile' | 'full'; debounce?: boolean; building?: SiteObject | null } = {}): number {
    const detail = opts.detail ?? 'full';
    return this.schedule('drive', obj, this.drive, detail, opts.debounce ?? detail === 'profile', (ep, o, d, s) => postDrivewayProfile(ep, o, d, s, opts.building ?? null));
  }
  requestGrade(obj: SiteObject, opts: { debounce?: boolean } = {}): number {
    return this.schedule('grade', obj, this.grade, 'full', opts.debounce ?? true, (ep, o, _d, s) => postGrading(ep, o, s));
  }
  private schedule<T>(kind: 'drive' | 'grade', obj: SiteObject, map: Map<string, LiveEntry<T>>, detail: 'profile' | 'full', debounce: boolean,
    call: (ep: Endpoint, o: SiteObject, d: 'profile' | 'full', s: AbortSignal) => Promise<T>): number {
    const id = obj.id, k = this.key(kind, id), seq = ++this.seq, sig = objectSig(obj), prev = map.get(id);
    if (this.timers.has(k)) { (this.o.clearTimer ?? clearTimeout)(this.timers.get(k)!); this.timers.delete(k); }
    this.aborts.get(k)?.abort(); this.aborts.delete(k);
    if (!this.o.ep) { this.put(map, kind, id, { status: 'no_server', result: null, resultSig: '', resultDetail: null, error: 'NO SERVER: THIS VIEW HAS NO CONNECTION TO THE ENGINES', sig, seq, detail: null }); return seq; }
    this.put(map, kind, id, { status: 'pending', result: prev?.result ?? null, resultSig: prev?.resultSig ?? '', resultDetail: prev?.resultDetail ?? null, error: '', sig, seq, detail });
    const run = async () => {
      this.timers.delete(k);
      const ac = new AbortController(); this.aborts.set(k, ac); this.calls++;
      try {
        const res = await call(this.o.ep!, obj, detail, ac.signal);
        if (this.dead || map.get(id)?.seq !== seq) return;                       // a newer request exists: drop this answer
        this.put(map, kind, id, { status: 'ok', result: res, resultSig: sig, resultDetail: detail, error: '', sig, seq, detail });
      } catch (err) {
        if (this.dead || map.get(id)?.seq !== seq || (err as { name?: string })?.name === 'AbortError') return;
        this.put(map, kind, id, { status: 'error', result: null, resultSig: '', resultDetail: null, error: err instanceof EngineHttpError ? err.message : String(err), sig, seq, detail });
      } finally { if (this.aborts.get(k) === ac) this.aborts.delete(k); }
    };
    if (debounce && this.debounceMs > 0) this.timers.set(k, (this.o.setTimer ?? setTimeout)(() => { void run(); }, this.debounceMs)); else void run();
    return seq;
  }
  /** Forget the results of an object (it was deleted). */
  clear(id: string) {
    for (const [kind, map] of [['drive', this.drive], ['grade', this.grade]] as const) {
      const k = this.key(kind, id);
      if (this.timers.has(k)) { (this.o.clearTimer ?? clearTimeout)(this.timers.get(k)!); this.timers.delete(k); }
      this.aborts.get(k)?.abort(); this.aborts.delete(k);
      if (map.delete(id) && !this.dead) this.listener(kind, id);
    }
  }
  dispose() { this.dead = true; for (const t of this.timers.values()) (this.o.clearTimer ?? clearTimeout)(t); this.timers.clear(); for (const a of this.aborts.values()) a.abort(); this.aborts.clear(); }
}
