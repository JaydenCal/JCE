import type { SceneBundle } from './types';

/** Validate a MODEL-compatible bundle; throws Error with the first problem found. */
export function validateBundle(j: unknown): SceneBundle {
  const b = j as Partial<SceneBundle> | null;
  const bad = (m: string): never => { throw new Error(`Invalid scene bundle: ${m}`); };
  if (!b || typeof b !== 'object') bad('not an object');
  const o = b as Partial<SceneBundle>;
  if (!o.info || !Array.isArray(o.info.origin) || o.info.origin.length < 2) bad('info.origin missing');
  if (!Array.isArray(o.layers)) bad('layers missing');
  if (!Array.isArray(o.parts)) bad('parts missing');
  for (const [i, p] of o.parts!.entries()) {
    if (!p.n || !p.c) bad(`part ${i} needs n and c`);
    const arr = p.lines ?? p.v; if (!Array.isArray(arr) || arr.length % 3) bad(`part ${p.n} has no valid v/lines`);
    if (p.v && !p.f && p.v.length % 9) bad(`part ${p.n} triangle soup length`);
    if (p.f && p.f.length % 3) bad(`part ${p.n} f length`);
  }
  const w = o.walkable; if (w && (!Array.isArray(w.colliders) || !w.spawn)) bad('walkable needs colliders and spawn');
  return { labels: [], views: {}, summary: [], notes: [], ...o, info: o.info!, layers: o.layers!, parts: o.parts! } as SceneBundle;
}
export function loadBundleFromJson(text: string | unknown): SceneBundle { return validateBundle(typeof text === 'string' ? JSON.parse(text) : text); }
export async function fetchBundle(url: string): Promise<SceneBundle> {
  const r = await fetch(url, { credentials: 'include' }); if (!r.ok) throw new Error(`bundle ${url}: ${r.status}`);
  return validateBundle(await r.json());
}
