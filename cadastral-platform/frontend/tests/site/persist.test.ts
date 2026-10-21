import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SiteAutosave, loadSiteDesign, saveSiteDesign, VersionConflict, SiteDesignHttpError, type Endpoint } from '@/lib/site/persist';
import { SiteDesignStore } from '@/lib/site/store';
import { emptyDesign, parseDesign, SITE_DESIGN_SCHEMA, OBJECT_TYPES } from '@/lib/site/types';
import { applyOp } from '@/lib/site/ops';
import { at, seqCtx } from './helpers';

const FIXTURE = join(__dirname, '../../../backend/tests/fixtures/site_design_v1.json');

/** A tiny in-memory server that follows the backend contract. */
function server() {
  let version = 0, stored: unknown = null; const calls: string[] = [];
  const f = vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET'; calls.push(method);
    if (method === 'GET') return new Response(JSON.stringify(stored ?? { schema: SITE_DESIGN_SCHEMA, version, objects: [] }), { status: 200 });
    const body = JSON.parse(String(init!.body));
    if (body.version !== version) return new Response(JSON.stringify({ code: 'VERSION_CONFLICT', current_version: version }), { status: 409 });
    version += 1; stored = { ...body, version, updated_at: '2026-10-15T00:00:00+00:00' }; return new Response(JSON.stringify(stored), { status: 200 });
  });
  return { f: f as unknown as typeof fetch, calls, bump: () => { version += 1; }, get version() { return version; }, get stored() { return stored as { objects: unknown[]; version: number }; } };
}
const ep = (s: ReturnType<typeof server>): Endpoint => ({ base: 'http://api', projectId: 'abc', headers: { 'X-User-Id': 'u' }, fetchImpl: s.f });

describe('shared schema fixture', () => {
  it('the backend fixture parses into the frontend types (nulls become absent fields, unresolved keeps null)', () => {
    const d = parseDesign(JSON.parse(readFileSync(FIXTURE, 'utf8')));
    expect(d.version).toBe(3); expect(d.objects.map((o) => o.type)).toEqual(['tree', 'retaining_wall', 'landscape_area']); expect(OBJECT_TYPES).toContain(d.objects[0].type);
    expect(d.objects[0].params.canopy_diameter_m).toEqual({ value: null, basis: 'unresolved' });
    expect(d.objects[1].accepted).toBe('pending'); expect(d.objects[1].geometry).toMatchObject({ kind: 'polyline' }); expect(d.objects[2].verified_on).toBe('2026-10-14');
    // and the registry can edit a loaded document and undo it
    const s = new SiteDesignStore(d, seqCtx()); s.run('move_object', { id: 'obj_tree1', dx: 1, dy: 1 }); s.undo(); expect(s.doc.objects.map((o) => o.geometry)).toEqual(d.objects.map((o) => o.geometry));
  });
  it('parseDesign refuses other documents', () => {
    for (const bad of [null, {}, { schema: 'site_design.v2', objects: [] }, { schema: SITE_DESIGN_SCHEMA }, { schema: SITE_DESIGN_SCHEMA, objects: [{ id: 'x', type: 'house', geometry: {} }] }]) expect(() => parseDesign(bad)).toThrow();
  });
});

describe('load and save', () => {
  it('loads an empty document for a new project and saves with version increments', async () => {
    const s = server(), d = await loadSiteDesign(ep(s));
    expect(d.version).toBe(0); expect(d.objects).toEqual([]);
    const withObj = applyOp(d, 'add_object', { type: 'tree', points: [at(1, 1)] }, seqCtx()).doc;
    const saved = await saveSiteDesign(ep(s), withObj);
    expect(saved.version).toBe(1); expect(s.stored.objects).toHaveLength(1);
    const call = (s.f as unknown as ReturnType<typeof vi.fn>).mock.calls.at(-1)!; expect((call[1] as RequestInit).headers).toMatchObject({ 'X-User-Id': 'u', 'Content-Type': 'application/json' }); expect(call[0]).toBe('http://api/projects/abc/site-design');
  });
  it('a stale save throws VersionConflict with the current version; other failures are SiteDesignHttpError', async () => {
    const s = server(); s.bump();
    await expect(saveSiteDesign(ep(s), emptyDesign())).rejects.toMatchObject({ name: 'VersionConflict', currentVersion: 1 });
    const bad = { ...ep(s), fetchImpl: (async () => new Response('x', { status: 500 })) as unknown as typeof fetch };
    await expect(saveSiteDesign(bad, emptyDesign())).rejects.toBeInstanceOf(SiteDesignHttpError);
    await expect(loadSiteDesign({ ...ep(s), fetchImpl: (async () => { throw new Error('offline'); }) as unknown as typeof fetch })).rejects.toMatchObject({ status: 0 });
    expect(new VersionConflict(null).currentVersion).toBeNull();
  });
});

describe('autosave', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });
  const mk = (s: ReturnType<typeof server>) => { const store = new SiteDesignStore(emptyDesign('abc'), seqCtx()), a = new SiteAutosave(store, ep(s), 1000), states: string[] = []; a.listener = (x) => states.push(x.status); a.start(); return { store, a, states }; };

  it('debounces: many edits make one PUT after the delay, and the server version is stamped on the document', async () => {
    const s = server(), { store, a, states } = mk(s);
    store.run('add_object', { type: 'tree', points: [at(1, 1)] }); store.run('move_object', { id: 'tree_1', dx: 1, dy: 1 }); store.undo();
    expect(states).toEqual(['dirty', 'dirty', 'dirty']); await vi.advanceTimersByTimeAsync(900); expect(s.calls).toEqual([]);
    await vi.advanceTimersByTimeAsync(200);
    expect(s.calls).toEqual(['PUT']); expect(store.doc.version).toBe(1); expect(a.state.status).toBe('saved'); expect(store.history().canRedo).toBe(true);        // history survives a save
    store.run('set_status', { id: 'tree_1', status: 'existing' }); await vi.advanceTimersByTimeAsync(1100);
    expect(s.calls).toEqual(['PUT', 'PUT']); expect(store.doc.version).toBe(2);
  });
  it('does not save on load, on derived issue changes or when nothing changed', async () => {
    const s = server(), { store, a } = mk(s);
    store.replace({ ...emptyDesign('abc'), version: 3 }); store.setEnv({ lot: null, terrain: null }); await vi.advanceTimersByTimeAsync(5000); await a.flush();
    expect(s.calls).toEqual([]);
  });
  it('an edit made while a save is in flight is saved afterwards, with the new version', async () => {
    const s = server(), { store, a } = mk(s);
    store.run('add_object', { type: 'tree', points: [at(1, 1)] });
    const first = a.flush(); store.run('move_object', { id: 'tree_1', dx: 1, dy: 0 }); await first;
    expect(a.state.status).toBe('dirty'); await vi.advanceTimersByTimeAsync(1100);
    expect(s.calls).toEqual(['PUT', 'PUT']); expect(s.version).toBe(2); expect(a.state.status).toBe('saved');
  });
  it('a 409 stops saving until resolved; reload takes the server copy, keep mine saves over it', async () => {
    const s = server(), { store, a } = mk(s);
    s.bump();                                                                                  // someone else saved
    store.run('add_object', { type: 'tree', points: [at(1, 1)] }); await vi.advanceTimersByTimeAsync(1100);
    expect(a.state.status).toBe('conflict'); expect(a.state.message).toContain('RELOAD'); expect(s.version).toBe(1);
    store.run('add_object', { type: 'stormwater_pit', points: [at(2, 2)] }); await vi.advanceTimersByTimeAsync(5000); expect(s.calls.filter((c) => c === 'PUT')).toHaveLength(1);   // no retry loop
    await a.keepMine(); expect(s.version).toBe(2); expect(s.stored.objects).toHaveLength(2); expect(a.state.status).toBe('saved');

    const s2 = server(), m2 = mk(s2); s2.bump();
    m2.store.run('add_object', { type: 'tree', points: [at(1, 1)] }); await vi.advanceTimersByTimeAsync(1100); expect(m2.a.state.status).toBe('conflict');
    await m2.a.reloadFromServer(); expect(m2.store.doc.objects).toEqual([]); expect(m2.store.history().canUndo).toBe(false); expect(m2.a.state.status).toBe('idle');
    m2.store.run('add_object', { type: 'tree', points: [at(1, 1)] }); await vi.advanceTimersByTimeAsync(1100); expect(s2.version).toBe(2);
  });
  it('a network failure is reported, keeps the changes pending and retries on the next edit', async () => {
    let fail = true; const s = server(), real = s.f;
    const flaky: Endpoint = { ...ep(s), fetchImpl: (async (u: string, i?: RequestInit) => { if (fail) throw new Error('offline'); return (real as unknown as (u: string, i?: RequestInit) => Promise<Response>)(u, i); }) as unknown as typeof fetch };
    const store = new SiteDesignStore(emptyDesign('abc'), seqCtx()), a = new SiteAutosave(store, flaky, 1000); a.start();
    store.run('add_object', { type: 'tree', points: [at(1, 1)] }); await vi.advanceTimersByTimeAsync(1100);
    expect(a.state.status).toBe('error'); expect(a.state.message).toContain('NOT SAVED');
    fail = false; store.run('move_object', { id: 'tree_1', dx: 1, dy: 0 }); await vi.advanceTimersByTimeAsync(1100);
    expect(a.state.status).toBe('saved'); expect(s.stored.objects).toHaveLength(1);
  });
  it('stop prevents further saves', async () => {
    const s = server(), { store, a } = mk(s); store.run('add_object', { type: 'tree', points: [at(1, 1)] }); a.stop(); await vi.advanceTimersByTimeAsync(3000); expect(s.calls).toEqual([]);
  });
});
