import type { SceneBundle } from './types';

/** Accept the backend scene builder's walkable format (SA6) as well as the viewer's native one. */
function normalizeWalkable(o: any): void {
  const w = o?.walkable; if (!w) return;
  if (!Array.isArray(w.terrain)) {
    const named: string[] = Array.isArray(w.terrain_parts) ? w.terrain_parts.map((t: any) => (typeof t === 'string' ? t : t?.n)).filter(Boolean) : [];
    w.terrain = named.length ? named : (o.parts || []).filter((p: any) => p.c === 'surface').map((p: any) => p.n);
  }
  w.colliders = (w.colliders || []).map((c: any) => ({ ...c, s: c.s ?? c.size, yaw: c.yaw ?? c.yaw_deg, c: c.c }));
  w.floors = (w.floors || []).map((f: any) => {
    if (f.min && f.max) return f;
    const ring: number[][] = f.ring || []; if (!ring.length) return null;
    const xs = ring.map((r) => r[0]), ys = ring.map((r) => r[1]);
    return { n: f.id ?? f.n, min: [Math.min(...xs), Math.min(...ys)], max: [Math.max(...xs), Math.max(...ys)], z: f.z ?? f.level ?? 0 };
  }).filter(Boolean);
  const sp = w.spawn;
  if (sp && !sp.p && sp.pos) { w.spawn = { p: sp.pos, yaw: sp.yaw ?? sp.yaw_deg, eye_height_m: sp.eye_height_m }; }
}

/** Validate a MODEL-compatible bundle; throws Error with the first problem found. */
export function validateBundle(j: unknown): SceneBundle {
  normalizeWalkable(j);
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
