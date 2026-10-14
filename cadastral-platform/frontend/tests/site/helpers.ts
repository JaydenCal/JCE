import { defaultCtx, type OpCtx } from '@/lib/site/ops';
import { emptyDesign, type SiteDesign } from '@/lib/site/types';

/** Deterministic ids for tests. */
export function seqCtx(): OpCtx { let n = 0; return { newId: (t) => `${t}_${++n}` }; }
export const E0 = 496000, N0 = 6650000;
export const at = (de: number, dn: number) => ({ e: E0 + de, n: N0 + dn });
export const rect = (x0: number, y0: number, x1: number, y1: number) => [at(x0, y0), at(x1, y0), at(x1, y1), at(x0, y1)];
export const clone = <T,>(x: T): T => structuredClone(x);
export const doc0 = (): SiteDesign => emptyDesign('p1');
export { defaultCtx };
