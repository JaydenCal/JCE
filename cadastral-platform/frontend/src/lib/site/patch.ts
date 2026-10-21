/**
 * JSON Patch (RFC 6902 subset: add, remove, replace) with exact inverses.
 *
 * `applyPatch` never mutates its input. It copies only the nodes along each changed path, so untouched objects keep their identity
 * (the incremental rebuild relies on that). The inverse of a patch is computed from the state it was applied to, so applying the
 * inverse to the result restores the original exactly, provided patches are undone in last-in-first-out order (the undo stack).
 */
export type PatchOp =
  | { op: 'add'; path: string; value: unknown }
  | { op: 'replace'; path: string; value: unknown }
  | { op: 'remove'; path: string };
export type Patch = PatchOp[];

export class PatchError extends Error {
  constructor(message: string) { super(message); this.name = 'PatchError'; }
}

const esc = (s: string | number) => String(s).replace(/~/g, '~0').replace(/\//g, '~1');
export const ptr = (...segs: (string | number)[]) => segs.map((s) => '/' + esc(s)).join('');
export function parsePtr(p: string): string[] {
  if (p === '') return [];
  if (p[0] !== '/') throw new PatchError(`bad path ${p}`);
  return p.slice(1).split('/').map((s) => s.replace(/~1/g, '/').replace(/~0/g, '~'));
}

const isArr = Array.isArray;
function arrIndex(seg: string, len: number, allowEnd: boolean): number {
  if (seg === '-' && allowEnd) return len;
  if (!/^(0|[1-9]\d*)$/.test(seg)) throw new PatchError(`bad array index ${seg}`);
  const i = Number(seg);
  if (i > len || (i === len && !allowEnd)) throw new PatchError(`array index ${i} out of range`);
  return i;
}

/** Apply one operation. Returns the new root and the inverse operation. */
function applyOne(root: unknown, op: PatchOp): { root: unknown; inverse: PatchOp } {
  const segs = parsePtr(op.path);
  if (segs.length === 0) {
    if (op.op === 'remove') throw new PatchError('cannot remove the document root');
    return { root: structuredClone((op as { value: unknown }).value), inverse: { op: 'replace', path: '', value: root } };
  }
  let inverse: PatchOp | null = null;
  const walk = (node: unknown, i: number): unknown => {
    const seg = segs[i], last = i === segs.length - 1;
    if (isArr(node)) {
      const copy = node.slice();
      if (!last) {
        const k = arrIndex(seg, node.length, false);
        copy[k] = walk(node[k], i + 1); return copy;
      }
      if (op.op === 'add') {
        const k = arrIndex(seg, node.length, true);
        copy.splice(k, 0, structuredClone(op.value));
        inverse = { op: 'remove', path: ptr(...segs.slice(0, -1), k) };
      } else {
        const k = arrIndex(seg, node.length, false);
        if (op.op === 'remove') { copy.splice(k, 1); inverse = { op: 'add', path: ptr(...segs.slice(0, -1), k), value: node[k] }; }
        else { copy[k] = structuredClone(op.value); inverse = { op: 'replace', path: op.path, value: node[k] }; }
      }
      return copy;
    }
    if (node && typeof node === 'object') {
      const rec = node as Record<string, unknown>, copy: Record<string, unknown> = { ...rec };
      if (!last) {
        if (!(seg in rec)) throw new PatchError(`path ${op.path} does not exist`);
        copy[seg] = walk(rec[seg], i + 1); return copy;
      }
      const has = Object.prototype.hasOwnProperty.call(rec, seg);
      if (op.op === 'add') {
        copy[seg] = structuredClone(op.value);
        inverse = has ? { op: 'replace', path: op.path, value: rec[seg] } : { op: 'remove', path: op.path };
      } else {
        if (!has) throw new PatchError(`path ${op.path} does not exist`);
        if (op.op === 'remove') { delete copy[seg]; inverse = { op: 'add', path: op.path, value: rec[seg] }; }
        else { copy[seg] = structuredClone(op.value); inverse = { op: 'replace', path: op.path, value: rec[seg] }; }
      }
      return copy;
    }
    throw new PatchError(`path ${op.path} does not exist`);
  };
  const next = walk(root, 0);
  return { root: next, inverse: inverse! };
}

/** Apply a patch in order. The returned inverse patch undoes it (its operations are already in reverse order). */
export function applyPatch<T>(doc: T, patch: Patch): { doc: T; inverse: Patch } {
  let cur: unknown = doc;
  const inv: PatchOp[] = [];
  for (const op of patch) { const r = applyOne(cur, op); cur = r.root; inv.push(r.inverse); }
  return { doc: cur as T, inverse: inv.reverse() };
}
