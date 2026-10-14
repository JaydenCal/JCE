import { describe, it, expect } from 'vitest';
import { applyPatch, parsePtr, ptr, PatchError, type Patch } from '@/lib/site/patch';

const base = () => ({ a: 1, list: [{ id: 'x', v: [1, 2, 3] }, { id: 'y', v: [] as number[] }], o: { k: 'v' } });

describe('patch', () => {
  it('pointer helpers escape ~ and /', () => {
    expect(ptr('objects', 3, 'a/b', 'c~d')).toBe('/objects/3/a~1b/c~0d');
    expect(parsePtr('/objects/3/a~1b/c~0d')).toEqual(['objects', '3', 'a/b', 'c~d']);
    expect(parsePtr('')).toEqual([]);
  });
  it('add, replace, remove on objects and arrays, each with an exact inverse', () => {
    const patches: Patch[] = [
      [{ op: 'replace', path: '/a', value: 2 }],
      [{ op: 'add', path: '/b', value: { n: 1 } }],
      [{ op: 'add', path: '/a', value: 9 }],                                  // add over an existing key replaces it
      [{ op: 'remove', path: '/o/k' }],
      [{ op: 'add', path: '/list/-', value: { id: 'z', v: [] } }],
      [{ op: 'add', path: '/list/1', value: { id: 'w', v: [] } }],
      [{ op: 'remove', path: '/list/0' }],
      [{ op: 'add', path: '/list/0/v/1', value: 99 }],
      [{ op: 'replace', path: '/list/0/v/2', value: 'q' }],
      [{ op: 'remove', path: '/list/0/v/0' }, { op: 'add', path: '/list/-', value: 5 }, { op: 'replace', path: '/o', value: null }],
      [{ op: 'replace', path: '', value: { fresh: true } }],
    ];
    for (const p of patches) {
      const before = base(), snap = structuredClone(before);
      const r = applyPatch(before, p);
      expect(before).toEqual(snap);                                           // input is never mutated
      expect(r.doc).not.toEqual(snap);
      expect(applyPatch(r.doc, r.inverse).doc).toEqual(snap);                 // inverse restores exactly
    }
  });
  it('a multi operation patch inverts in reverse order', () => {
    const p: Patch = [{ op: 'add', path: '/list/-', value: { id: 'n', v: [] } }, { op: 'remove', path: '/list/0' }, { op: 'add', path: '/list/0/v/-', value: 1 }];
    const r = applyPatch(base(), p);
    expect(r.doc.list.map((x: { id: string }) => x.id)).toEqual(['y', 'n']);
    expect(applyPatch(r.doc, r.inverse).doc).toEqual(base());
  });
  it('keeps the identity of untouched nodes (structural sharing)', () => {
    const b = base(), r = applyPatch(b, [{ op: 'replace', path: '/list/1/id', value: 'yy' }]);
    expect(r.doc.list[0]).toBe(b.list[0]); expect(r.doc.o).toBe(b.o); expect(r.doc.list[1]).not.toBe(b.list[1]);
  });
  it('does not alias patch values into the document', () => {
    const v = { id: 'n', v: [1] }, r = applyPatch(base(), [{ op: 'add', path: '/list/-', value: v }]);
    v.v.push(2); expect(r.doc.list[2].v).toEqual([1]);
  });
  it('rejects bad paths', () => {
    for (const p of [{ op: 'replace', path: '/nope', value: 1 }, { op: 'remove', path: '/list/7' }, { op: 'add', path: '/list/9', value: 1 }, { op: 'replace', path: '/list/x', value: 1 }, { op: 'remove', path: '/a/b' }, { op: 'remove', path: '' }] as Patch) {
      expect(() => applyPatch(base(), [p])).toThrow(PatchError);
    }
  });
});
