import { describe, it, expect } from 'vitest';
import { SiteDesignStore, HISTORY_LIMIT, diffIds, type ChangeEvent } from '@/lib/site/store';
import { OpError } from '@/lib/site/ops';
import type { CheckEnv } from '@/lib/site/checks';
import { emptyDesign } from '@/lib/site/types';
import { at, rect, seqCtx, E0, N0 } from './helpers';

const mk = () => new SiteDesignStore(emptyDesign('p1'), seqCtx());
const lotEnv = (): CheckEnv => ({ lot: [[E0, N0], [E0 + 20, N0], [E0 + 20, N0 + 20], [E0, N0 + 20]], terrain: { available: true, sample: () => 100 } });

describe('store: patch based undo and redo', () => {
  it('undo and redo round trip the document exactly through a long sequence', () => {
    const s = mk(), states = [structuredClone(s.doc)];
    const steps: [string, Record<string, unknown>][] = [
      ['add_object', { type: 'tree', points: [at(5, 5)] }], ['add_object', { type: 'retaining_wall', points: [at(1, 1), at(8, 1)] }],
      ['set_param', { id: 'tree_1', key: 'height_m', value: 7 }], ['move_object', { id: 'tree_1', dx: 1, dy: 1 }],
      ['edit_vertices', { id: 'retaining_wall_2', action: 'insert', index: 1, point: at(4, 2) }], ['rotate_object', { id: 'tree_1', angle_deg: 15 }],
      ['duplicate_object', { id: 'tree_1', dx: 2, dy: 0 }], ['set_status', { id: 'tree_1', status: 'existing' }], ['delete_object', { id: 'retaining_wall_2' }],
    ];
    for (const [op, args] of steps) { s.run(op, args); states.push(structuredClone(s.doc)); }
    for (let i = steps.length - 1; i >= 0; i--) { expect(s.undo()).toBe(true); expect(s.doc).toEqual(states[i]); }
    expect(s.undo()).toBe(false);
    for (let i = 1; i <= steps.length; i++) { expect(s.redo()).toBe(true); expect(s.doc).toEqual(states[i]); }
    expect(s.redo()).toBe(false);
  });
  it('a new edit clears the redo stack', () => {
    const s = mk(); s.run('add_object', { type: 'tree', points: [at(1, 1)] }); s.undo(); expect(s.canRedo()).toBe(true);
    s.run('add_object', { type: 'pit', points: [at(2, 2)] }); expect(s.canRedo()).toBe(false);
  });
  it('every step has a label; undo and redo report them', () => {
    const s = mk();
    s.run('add_object', { type: 'tree', points: [at(1, 1)] }); s.run('move_object', { id: 'tree_1', dx: 1, dy: 0 }, 'Drag tree');
    expect(s.history()).toMatchObject({ canUndo: true, canRedo: false, undoLabel: 'Drag tree', undoCount: 2 });
    expect(s.undoLabels()).toEqual(['Add object', 'Drag tree']);
    s.undo(); expect(s.history()).toMatchObject({ undoLabel: 'Add object', redoLabel: 'Drag tree', redoCount: 1 });
  });
  it('keeps 200 steps and drops the oldest', () => {
    expect(HISTORY_LIMIT).toBe(200);
    const s = mk(); s.run('add_object', { type: 'tree', points: [at(0, 0)] });
    for (let i = 0; i < 205; i++) s.run('move_object', { id: 'tree_1', dx: 1, dy: 0 });
    expect(s.history().undoCount).toBe(200);
    let n = 0; while (s.undo()) n++;
    expect(n).toBe(200);
    // 205 moves of 1 m were made; only the latest 200 can be undone, so 5 m of movement stays
    expect((s.doc.objects[0].geometry as { p: number[] }).p[0]).toBe(E0 + 5);
  });
  it('an invalid operation throws, changes nothing and records no step', () => {
    const s = mk(); s.run('add_object', { type: 'tree', points: [at(0, 0)] }); const before = s.doc, n = s.history().undoCount;
    expect(() => s.run('move_object', { id: 'nope', dx: 1, dy: 1 })).toThrow(OpError);
    expect(s.doc).toBe(before); expect(s.history().undoCount).toBe(n);
  });
  it('a no-op (empty patch) records no step', () => {
    const s = mk(); s.run('add_object', { type: 'tree', points: [at(0, 0)] }); s.run('move_object', { id: 'tree_1', dx: 0, dy: 0 });
    expect(s.history().undoCount).toBe(1);
  });
  it('a batch is ONE undo step with one label', () => {
    const s = mk();
    const res = s.runBatch('AI first design', [
      { op: 'add_object', args: { type: 'tree', points: [at(1, 1)], origin: 'ai_proposal', id: 'a' } },
      { op: 'add_object', args: { type: 'pit', points: [at(2, 2)], origin: 'ai_proposal', id: 'b' } },
      { op: 'add_object', args: { type: 'landscape_area', points: rect(0, 0, 3, 3), origin: 'ai_proposal', id: 'c' } },
      { op: 'delete_object', args: { id: 'missing' } },
    ]);
    expect(res.map((r) => r.ok)).toEqual([true, true, true, false]);
    expect(s.doc.objects).toHaveLength(3); expect(s.history().undoCount).toBe(1); expect(s.history().undoLabel).toBe('AI first design');
    s.undo(); expect(s.doc.objects).toHaveLength(0); s.redo(); expect(s.doc.objects.map((o) => o.id)).toEqual(['a', 'b', 'c']);
  });
  it('an all failing batch records nothing', () => {
    const s = mk(); s.runBatch('x', [{ op: 'delete_object', args: { id: 'q' } }]); expect(s.history().undoCount).toBe(0);
  });
});

describe('store: events', () => {
  it('emits change with the ids that changed, were added or removed', () => {
    const s = mk(), ev: ChangeEvent[] = []; s.on('change', (e) => ev.push(e));
    s.run('add_object', { type: 'tree', points: [at(1, 1)] }); s.run('add_object', { type: 'pit', points: [at(2, 2)] });
    s.run('move_object', { id: 'tree_1', dx: 1, dy: 0 }); s.run('delete_object', { id: 'pit_2' }); s.undo(); s.redo();
    expect(ev.map((e) => e.kind)).toEqual(['edit', 'edit', 'edit', 'edit', 'undo', 'redo']);
    expect(ev[0]).toMatchObject({ added: ['tree_1'], changed: [], removed: [] });
    expect(ev[2]).toMatchObject({ added: [], changed: ['tree_1'], removed: [] });      // only the moved object, not pit_2
    expect(ev[3]).toMatchObject({ removed: ['pit_2'] });
    expect(ev[4]).toMatchObject({ added: ['pit_2'] });                                   // undo of the delete
    expect(ev[5]).toMatchObject({ removed: ['pit_2'], label: 'Delete object' });
  });
  it('emits history events and an unsubscribe works', () => {
    const s = mk(), seen: boolean[] = []; const off = s.on('history', (h) => seen.push(h.canUndo));
    s.run('add_object', { type: 'tree', points: [at(1, 1)] }); s.undo(); off(); s.redo();
    expect(seen).toEqual([true, false]);
  });
  it('a throwing listener does not break the others', () => {
    const s = mk(); let ok = 0; s.on('change', () => { throw new Error('x'); }); s.on('change', () => ok++);
    const orig = console.error; console.error = () => {}; try { s.run('add_object', { type: 'tree', points: [at(1, 1)] }); } finally { console.error = orig; }
    expect(ok).toBe(1);
  });
  it('diffIds works on identity', () => {
    const s = mk(); s.run('add_object', { type: 'tree', points: [at(1, 1)] }); const a = s.doc; s.run('add_object', { type: 'pit', points: [at(2, 2)] });
    expect(diffIds(a, s.doc)).toEqual({ changed: [], added: ['pit_2'], removed: [] });
  });
});

describe('store: derived issues and the environment', () => {
  it('issues are recomputed on edits and are not part of the history', () => {
    const s = mk(); s.setEnv(lotEnv());
    s.run('add_object', { type: 'tree', points: [at(5, 5)] });
    expect(s.doc.objects[0].issues).toEqual([]);
    s.run('move_object', { id: 'tree_1', dx: 100, dy: 0 });
    expect(s.doc.objects[0].issues.map((i) => i.code)).toEqual(['OUTSIDE_LOT']);
    s.undo(); expect(s.doc.objects[0].issues).toEqual([]);                               // checked again after the undo
    s.redo(); expect(s.doc.objects[0].issues.map((i) => i.code)).toEqual(['OUTSIDE_LOT']);
    expect(s.history().undoCount).toBe(2);
  });
  it('changing the environment rechecks everything and is not an undo step', () => {
    const s = mk(); s.run('add_object', { type: 'tree', points: [at(5, 5)] });
    expect(s.doc.objects[0].issues.map((i) => i.message)).toEqual(['TERRAIN DATA NOT AVAILABLE']);     // no environment yet: no terrain
    const ev: ChangeEvent[] = []; s.on('change', (e) => ev.push(e));
    s.setEnv(lotEnv()); expect(s.doc.objects[0].issues).toEqual([]);
    expect(ev).toHaveLength(1); expect(ev[0]).toMatchObject({ kind: 'checks', changed: ['tree_1'] });
    expect(s.history().undoCount).toBe(1);
    s.setEnv(lotEnv()); expect(ev).toHaveLength(1);                                        // nothing changed, nothing emitted
  });
  it('replace loads a document, rechecks and clears the history; markSaved leaves history and objects alone', () => {
    const s = mk(); s.setEnv(lotEnv()); s.run('add_object', { type: 'tree', points: [at(5, 5)] });
    const keep = s.doc.objects[0];
    s.markSaved(4, '2026-10-15T00:00:00+00:00'); expect(s.doc.version).toBe(4); expect(s.doc.objects[0]).toBe(keep); expect(s.history().undoCount).toBe(1);
    s.undo(); expect(s.doc.version).toBe(4);                                               // undo never touches the server version
    const loaded = { ...emptyDesign('p1'), version: 9, objects: [{ ...keep, issues: [] , geometry: { kind: 'point' as const, p: [E0 + 500, N0] as [number, number] } }] };
    s.replace(loaded);
    expect(s.history().undoCount).toBe(0); expect(s.doc.version).toBe(9); expect(s.doc.objects[0].issues.map((i) => i.code)).toEqual(['OUTSIDE_LOT']);
  });
});
