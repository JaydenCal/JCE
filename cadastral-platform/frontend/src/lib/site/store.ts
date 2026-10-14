/**
 * Site design store: the document plus patch based undo and redo.
 *
 * - Every edit is a registry operation (or batch) that produces a patch. The store records the patch and its exact inverse, never a
 *   copy of the document. History is capped at 200 steps and every step has a label.
 * - Issues (geometry checks) are derived data. They are recomputed for the objects an edit, undo or redo touched and are NOT part
 *   of any undo step. Changing the check environment (lot, terrain) rechecks everything, also outside the history.
 * - The terrain and the scene bundle live outside the document and outside the history (`env`).
 * - The server `version` is bookkeeping for optimistic concurrency; edits and undo never change it.
 * - Events: 'change' after every document change (with the ids that changed, were added or removed), 'history' when undo or redo
 *   availability or labels change, and 'lock' when the store is locked or unlocked.
 * - The store can be LOCKED (read only) with a reason, e.g. while the saved design is still loading: run, runBatch, undo and redo then
 *   refuse, so an edit can never be lost to a document that arrives later. `replace` (a load) and `setEnv` are not edits and still work.
 */
import { checkObject, NO_ENV, sameIssues, type CheckEnv } from './checks';
import { applyPatch, type Patch } from './patch';
import { applyOp, defaultCtx, OpError, OPS, runBatch, type BatchStep, type OpCtx } from './ops';
import { emptyDesign, type SiteDesign, type SiteObject } from './types';

export const HISTORY_LIMIT = 200;

export interface HistoryStep { label: string; patch: Patch; inverse: Patch }
export type ChangeKind = 'edit' | 'undo' | 'redo' | 'replace' | 'checks' | 'saved';
export interface ChangeEvent { kind: ChangeKind; label?: string; doc: SiteDesign; changed: string[]; added: string[]; removed: string[] }
export interface HistoryInfo { canUndo: boolean; canRedo: boolean; undoLabel: string | null; redoLabel: string | null; undoCount: number; redoCount: number }

type Listener<T> = (e: T) => void;

/** Ids whose object differs (by identity) between two documents. Unchanged objects keep their identity through `applyPatch`. */
export function diffIds(before: SiteDesign, after: SiteDesign): { changed: string[]; added: string[]; removed: string[] } {
  const b = new Map(before.objects.map((o) => [o.id, o])), a = new Map(after.objects.map((o) => [o.id, o]));
  const changed: string[] = [], added: string[] = [], removed: string[] = [];
  for (const [id, o] of a) { const p = b.get(id); if (!p) added.push(id); else if (p !== o) changed.push(id); }
  for (const id of b.keys()) if (!a.has(id)) removed.push(id);
  return { changed, added, removed };
}

export class SiteDesignStore {
  private _doc: SiteDesign;
  private _env: CheckEnv = NO_ENV;
  private undoStack: HistoryStep[] = [];
  private redoStack: HistoryStep[] = [];
  private listeners = { change: new Set<Listener<ChangeEvent>>(), history: new Set<Listener<HistoryInfo>>(), lock: new Set<Listener<string | null>>() };
  private _lock: string | null = null;
  /** incremented on every document change that is not a 'saved' stamp; the autosave compares it with the last saved value */
  revision = 0;

  constructor(doc: SiteDesign = emptyDesign(), public ctx: OpCtx = defaultCtx, public limit = HISTORY_LIMIT) {
    this._doc = doc;
  }

  get doc(): SiteDesign { return this._doc; }
  get env(): CheckEnv { return this._env; }
  /** Why the store is read only, or null when it accepts edits. */
  get locked(): string | null { return this._lock; }
  lock(reason: string) { this._lock = reason; this.emitLock(); }
  unlock() { if (this._lock === null) return; this._lock = null; this.emitLock(); }
  private emitLock() { for (const cb of [...this.listeners.lock]) { try { cb(this._lock); } catch (err) { console.error('[site store] lock listener failed', err); } } }
  private assertOpen() { if (this._lock !== null) throw new OpError(this._lock); }

  on(evt: 'change', cb: Listener<ChangeEvent>): () => void;
  on(evt: 'history', cb: Listener<HistoryInfo>): () => void;
  on(evt: 'lock', cb: Listener<string | null>): () => void;
  on(evt: 'change' | 'history' | 'lock', cb: Listener<never>): () => void {
    const set = this.listeners[evt] as Set<Listener<never>>; set.add(cb); return () => { set.delete(cb); };
  }
  private emitChange(e: ChangeEvent) { for (const cb of [...this.listeners.change]) { try { cb(e); } catch (err) { console.error('[site store] change listener failed', err); } } }
  private emitHistory() { const h = this.history(); for (const cb of [...this.listeners.history]) { try { cb(h); } catch (err) { console.error('[site store] history listener failed', err); } } }

  history(): HistoryInfo {
    return { canUndo: this.undoStack.length > 0, canRedo: this.redoStack.length > 0, undoLabel: this.undoStack.at(-1)?.label ?? null, redoLabel: this.redoStack.at(-1)?.label ?? null, undoCount: this.undoStack.length, redoCount: this.redoStack.length };
  }
  canUndo() { return this.undoStack.length > 0; }
  canRedo() { return this.redoStack.length > 0; }
  undoLabels(): string[] { return this.undoStack.map((s) => s.label); }

  // ---- checks (derived data, outside the history)
  /** Recompute issues for the given ids on a document; returns the document with only changed issue lists replaced. */
  private recheck(doc: SiteDesign, ids: readonly string[]): SiteDesign {
    if (!ids.length) return doc;
    const want = new Set(ids);
    let changedAny = false;
    const objects = doc.objects.map((o): SiteObject => {
      if (!want.has(o.id)) return o;
      const issues = checkObject(o, this._env);
      if (sameIssues(issues, o.issues)) return o;
      changedAny = true; return { ...o, issues };
    });
    return changedAny ? { ...doc, objects } : doc;
  }
  /** Set the check environment (lot ring, terrain). Rechecks every object. Not an undo step. */
  setEnv(env: CheckEnv) {
    this._env = env;
    const before = this._doc, after = this.recheck(before, before.objects.map((o) => o.id));
    if (after !== before) { this._doc = after; this.revision++; this.emitChange({ kind: 'checks', doc: after, ...diffIds(before, after) }); }
  }

  /** Replace the whole document (load from the server or a file). Clears the history. */
  replace(doc: SiteDesign) {
    const before = this._doc;
    this._doc = this.recheck(doc, doc.objects.map((o) => o.id));
    this.undoStack = []; this.redoStack = []; this.revision++;
    const ids = diffIds(before, this._doc);
    this.emitChange({ kind: 'replace', doc: this._doc, changed: ids.changed, added: ids.added, removed: ids.removed });
    this.emitHistory();
  }
  /** Stamp the version and time the server returned after a save. Not an edit, not an undo step. */
  markSaved(version: number, updatedAt?: string) {
    this._doc = { ...this._doc, version, ...(updatedAt ? { updated_at: updatedAt } : {}) };
    this.emitChange({ kind: 'saved', doc: this._doc, changed: [], added: [], removed: [] });
  }

  // ---- editing
  private commit(label: string, next: SiteDesign, patch: Patch, inverse: Patch): boolean {
    if (!patch.length) return false;
    const before = this._doc, ids = diffIds(before, next);
    this._doc = this.recheck(next, [...ids.changed, ...ids.added]);
    this.undoStack.push({ label, patch, inverse });
    if (this.undoStack.length > this.limit) this.undoStack.shift();
    this.redoStack = []; this.revision++;
    this.emitChange({ kind: 'edit', label, doc: this._doc, ...ids });
    this.emitHistory();
    return true;
  }
  /** Run one registry operation as one undo step. Throws OpError and changes nothing when the arguments are invalid. */
  run(name: string, args: Record<string, unknown> = {}, label?: string): Record<string, unknown> {
    this.assertOpen();
    const r = applyOp(this._doc, name, args, this.ctx);
    this.commit(label ?? OPS[name]?.label ?? name, r.doc, r.patch, r.inverse);
    return r.result;
  }
  /** Run several operations as ONE undo step (used by the AI). Failed steps are reported and skipped. */
  runBatch(label: string, steps: BatchStep[]) {
    this.assertOpen();
    const r = runBatch(this._doc, steps, this.ctx);
    this.commit(label, r.doc, r.patch, r.inverse);
    return r.results;
  }

  undo(): boolean {
    if (this._lock !== null) return false;
    const s = this.undoStack.pop(); if (!s) return false;
    this.redoStack.push(s); this.step(s.inverse, 'undo', s.label); return true;
  }
  redo(): boolean {
    if (this._lock !== null) return false;
    const s = this.redoStack.pop(); if (!s) return false;
    this.undoStack.push(s); this.step(s.patch, 'redo', s.label); return true;
  }
  private step(patch: Patch, kind: 'undo' | 'redo', label: string) {
    const before = this._doc, next = applyPatch(before, patch).doc, ids = diffIds(before, next);
    this._doc = this.recheck(next, [...ids.changed, ...ids.added]); this.revision++;
    this.emitChange({ kind, label, doc: this._doc, ...ids });
    this.emitHistory();
  }
}
