/**
 * Persistence for the site design: GET and PUT /projects/{id}/site-design with optimistic concurrency, plus a debounced autosave.
 * A stale save (HTTP 409) is never retried silently: the autosave stops in state 'conflict' until the user reloads the server copy
 * or chooses to keep their copy. The demo page does not use this module (in memory only).
 */
import type { SiteDesignStore } from './store';
import { parseDesign } from './types';
import type { SiteDesign } from './types';

export class VersionConflict extends Error {
  constructor(public currentVersion: number | null, message = 'The site design was saved from somewhere else since it was loaded.') { super(message); this.name = 'VersionConflict'; }
}
export class SiteDesignHttpError extends Error {
  constructor(public status: number, message: string) { super(message); this.name = 'SiteDesignHttpError'; }
}
export interface Endpoint { base: string; projectId: string; headers?: Record<string, string>; fetchImpl?: typeof fetch }
const url = (e: Endpoint) => `${e.base}/projects/${encodeURIComponent(e.projectId)}/site-design`;

export async function loadSiteDesign(e: Endpoint): Promise<SiteDesign> {
  const f = e.fetchImpl ?? fetch;
  let r: Response;
  try { r = await f(url(e), { headers: e.headers, credentials: 'include' }); } catch (err) { throw new SiteDesignHttpError(0, `site design request failed: ${String(err)}`); }
  if (!r.ok) throw new SiteDesignHttpError(r.status, `site design request returned ${r.status}`);
  return parseDesign(await r.json());
}

/** Browsers refuse a keepalive request whose body is over 64 KiB; stay safely under it and fall back to a normal request above it. */
export const KEEPALIVE_MAX_BYTES = 60_000;

/**
 * Save the document. `keepalive` lets the request outlive the page (used when the tab is closing); it keeps the Authorization style
 * headers, unlike sendBeacon, and is only set when the body fits the browser's keepalive limit.
 */
export async function saveSiteDesign(e: Endpoint, doc: SiteDesign, opts: { keepalive?: boolean } = {}): Promise<SiteDesign> {
  const f = e.fetchImpl ?? fetch;
  let r: Response;
  const body = JSON.stringify(doc);
  const keepalive = !!opts.keepalive && new TextEncoder().encode(body).length <= KEEPALIVE_MAX_BYTES;
  try { r = await f(url(e), { method: 'PUT', headers: { 'Content-Type': 'application/json', ...e.headers }, credentials: 'include', body, ...(keepalive ? { keepalive: true } : {}) }); }
  catch (err) { throw new SiteDesignHttpError(0, `site design save failed: ${String(err)}`); }
  if (r.status === 409) { let cur: number | null = null; try { cur = Number((await r.json()).current_version); } catch { /* ignore */ } throw new VersionConflict(Number.isFinite(cur) ? cur : null); }
  if (!r.ok) {
    let why = '';                                                    // the server explains a refused building (BUILDING_IMPORT_MISMATCH and the like): show it
    try { const b = await r.json(); if (b && typeof b.message === 'string') why = b.message.slice(0, 400); } catch { /* not JSON */ }
    throw new SiteDesignHttpError(r.status, why || `site design save returned ${r.status}`);
  }
  return parseDesign(await r.json());
}

export type AutosaveStatus = 'idle' | 'dirty' | 'saving' | 'saved' | 'conflict' | 'error';
export interface AutosaveState { status: AutosaveStatus; message: string; savedAt: string | null }

export class SiteAutosave {
  state: AutosaveState = { status: 'idle', message: '', savedAt: null };
  listener: (s: AutosaveState) => void = () => {};
  private timer: ReturnType<typeof setTimeout> | null = null;
  /** an edit has happened that the server has not seen */
  private pending = false;
  private saving = false; private off: (() => void) | null = null; private stopped = false;

  constructor(private store: SiteDesignStore, private ep: Endpoint, private delayMs = 1500) {}

  start() {
    this.stopped = false;
    this.off = this.store.on('change', (e) => { if (e.kind === 'edit' || e.kind === 'undo' || e.kind === 'redo') this.touch(); });
  }
  stop() { this.stopped = true; this.off?.(); this.off = null; if (this.timer) clearTimeout(this.timer); this.timer = null; }

  private set(status: AutosaveStatus, message = '', savedAt = this.state.savedAt) { this.state = { status, message, savedAt }; this.listener(this.state); }
  private touch() {
    if (this.stopped) return;
    this.pending = true;
    if (this.state.status === 'conflict') return;
    if (!this.saving) this.set('dirty', 'CHANGES NOT YET SAVED');
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => { void this.flush(); }, this.delayMs);
  }
  /** Save now if there are unsaved changes. `keepalive` is for the page unload flush: the request is allowed to finish after the page is gone. */
  async flush(opts: { keepalive?: boolean } = {}): Promise<void> {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    if (!this.pending || this.stopped || this.state.status === 'conflict') return;
    if (this.saving) { this.timer = setTimeout(() => { void this.flush(); }, this.delayMs); return; }          // try again once the save in flight has finished
    this.saving = true; this.pending = false; this.set('saving', 'SAVING');
    try {
      const saved = await saveSiteDesign(this.ep, this.store.doc, opts);
      this.store.markSaved(saved.version, saved.updated_at);
      if (this.pending) this.set('dirty', 'CHANGES NOT YET SAVED', saved.updated_at ?? this.state.savedAt);
      else this.set('saved', 'SAVED', saved.updated_at ?? new Date().toISOString());
    } catch (e) {
      this.pending = true;
      if (e instanceof VersionConflict) this.set('conflict', 'NOT SAVED: THE DESIGN WAS CHANGED SOMEWHERE ELSE. RELOAD THE SAVED COPY, OR KEEP YOUR COPY AND SAVE OVER IT.');
      else this.set('error', `NOT SAVED: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      this.saving = false;
    }
  }
  /** Conflict resolution 1: discard local edits and load the server copy. */
  async reloadFromServer() {
    const doc = await loadSiteDesign(this.ep);
    this.pending = false; this.store.replace(doc);
    this.set('idle', '', doc.updated_at ?? null);
  }
  /** Conflict resolution 2: keep the local document, adopt the server's current version number, and save over it. */
  async keepMine() {
    const cur = await loadSiteDesign(this.ep);
    this.store.markSaved(cur.version);
    this.pending = true; this.set('dirty', 'CHANGES NOT YET SAVED');
    await this.flush();
  }
  /** Run a conflict resolution for the panel. Returns null on success or the error text to show; never throws, never swallows. */
  async resolve(how: 'reload' | 'keep'): Promise<string | null> {
    try { await (how === 'reload' ? this.reloadFromServer() : this.keepMine()); return null; }
    catch (e) { return `${how === 'reload' ? 'THE SAVED COPY COULD NOT BE RELOADED' : 'THE SAVED VERSION COULD NOT BE CHECKED'}: ${e instanceof Error ? e.message : String(e)}`; }
  }
}

export type LoadPhase = 'loading' | 'ready' | 'failed';
export interface LoadState { phase: LoadPhase; error: string; /** the user chose to edit a new local document after a failed load */ local: boolean }
export const LOADING_NOTE = 'LOADING SAVED DESIGN';

/**
 * First load of the saved design for a project. The store is LOCKED (read only) until the load resolves or fails, so an edit can never
 * be replaced by the document arriving later. After a failure the store stays locked until the user confirms (`confirmLocal`) that
 * they want to edit a NEW local document; autosave then runs under the normal version check, so it cannot overwrite a saved design
 * without the conflict choice (the server only accepts version 0 when nothing is stored).
 */
export class SiteDesignSession {
  state: LoadState = { phase: 'loading', error: '', local: false };
  listener: (s: LoadState) => void = () => {};
  private dead = false;

  constructor(private store: SiteDesignStore, private autosave: SiteAutosave, private ep: Endpoint) { this.store.lock(LOADING_NOTE); }

  private set(s: LoadState) { this.state = s; if (!this.dead) this.listener(s); }
  async load(): Promise<void> {
    this.set({ phase: 'loading', error: '', local: false }); this.store.lock(LOADING_NOTE);
    try {
      const d = await loadSiteDesign(this.ep);
      if (this.dead) return;
      this.store.replace(d); this.store.unlock(); this.autosave.start(); this.set({ phase: 'ready', error: '', local: false });
    } catch (e) {
      if (this.dead) return;
      const msg = `SAVED DESIGN COULD NOT BE LOADED: ${e instanceof Error ? e.message : String(e)}`;
      this.store.lock(msg); this.set({ phase: 'failed', error: msg, local: false });
    }
  }
  /** After a failed load, and only after the user confirmed in the panel: edit a new local document. */
  confirmLocal() {
    if (this.state.phase !== 'failed' || this.dead) return;
    this.store.unlock(); this.autosave.start(); this.set({ phase: 'ready', error: this.state.error, local: true });
  }
  dispose() { this.dead = true; }
}
