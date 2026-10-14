import type { PlacedItem, SceneBundle, Vec3 } from './types';

/** Backend (SA6 ItemOut) item: t = base-centre, yaw_deg, catalogue_id. The viewer shape is PlacedItem (id, itemId, p, yaw). */
export function normalizeItem(raw: any): PlacedItem {
  if (raw && typeof raw === 'object' && Array.isArray(raw.p) && typeof raw.itemId === 'string') return raw as PlacedItem;   // already the viewer shape
  const t = raw?.t ?? raw?.p;
  if (!raw || typeof raw.id !== 'string' || !Array.isArray(t) || t.length < 3) throw new Error('Invalid scene bundle: item needs id and t (x, y, z)');
  const out: PlacedItem = { id: raw.id, itemId: String(raw.itemId ?? raw.catalogue_id ?? raw.id), p: [t[0], t[1], t[2]] as Vec3, yaw: Number(raw.yaw ?? raw.yaw_deg ?? 0) };
  if (typeof raw.level === 'string') out.level = raw.level;
  if (Array.isArray(raw.warnings) && raw.warnings.length) out.warnings = raw.warnings.map(String);
  if (typeof raw.name === 'string') out.name = raw.name;
  const dm = raw.dims_m;
  if (Array.isArray(dm) && dm.length >= 3 && dm.slice(0, 3).every((v: unknown) => typeof v === 'number' && Number.isFinite(v) && v > 0)) out.dims_m = [dm[0], dm[1], dm[2]] as Vec3;
  if (typeof raw.scale === 'number' && Number.isFinite(raw.scale) && raw.scale > 0) out.scale = raw.scale;
  if (typeof raw.model_url === 'string' && raw.model_url) out.model_url = raw.model_url;
  if (raw.surface === 'ground' || raw.surface === 'floor' || raw.surface === 'wall') out.surface = raw.surface;
  return out;
}
function normalizeItems(o: any): void { if (Array.isArray(o?.items)) o.items = o.items.map(normalizeItem); }

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
  normalizeItems(j);
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
/** A bundle request that did not return a bundle; `status` is the HTTP status (0 = network failure). 404 means no bundle exists for the project. */
export class BundleLoadError extends Error {
  constructor(public status: number, message: string) { super(message); this.name = 'BundleLoadError'; }
}
export async function fetchBundle(url: string, headers: Record<string, string> = {}): Promise<SceneBundle> {
  let r: Response;
  try { r = await fetch(url, { headers, credentials: 'include' }); } catch (e) { throw new BundleLoadError(0, `scene bundle request failed: ${String(e)}`); }
  if (!r.ok) throw new BundleLoadError(r.status, r.status === 404 ? 'DATA NOT AVAILABLE: no scene bundle for this project' : `scene bundle request returned ${r.status}`);
  return validateBundle(await r.json());
}
