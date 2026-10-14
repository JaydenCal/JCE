/**
 * Height field built from the terrain mesh triangles themselves (vertical sampling of the real surface; no flat plane and no
 * resampled grid). A uniform cell index keeps sampling fast, so dragging an object does not raycast the whole mesh per sample.
 * Where several terrain meshes overlap (design surface above existing ground) the highest surface wins, the same as a ray from above.
 *
 * Coordinates are the scene's local metres. Callers convert from MGA by subtracting the bundle origin.
 */
export interface MeshLike { geometry: { attributes: { position?: { array: ArrayLike<number>; count: number; itemSize: number } }; index: { array: ArrayLike<number> } | null } }

export class HeightField {
  private tris: Float64Array;                       // x0 y0 z0 x1 y1 z1 x2 y2 z2 per triangle
  private cells = new Map<number, number[]>();
  private x0 = 0; private y0 = 0; private cell = 1; private nx = 1;
  readonly triangleCount: number;
  readonly bounds: [number, number, number, number] | null;

  constructor(positions: ArrayLike<number>[], indices: (ArrayLike<number> | null)[], targetCells = 64) {
    const t: number[] = [];
    positions.forEach((pos, m) => {
      const idx = indices[m], n = idx ? idx.length : Math.floor(pos.length / 3);
      for (let k = 0; k + 2 < n; k += 3) for (const q of [0, 1, 2]) { const v = idx ? idx[k + q] : k + q; t.push(pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]); }
    });
    this.tris = Float64Array.from(t);
    this.triangleCount = this.tris.length / 9;
    if (!this.triangleCount) { this.bounds = null; return; }
    let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
    for (let i = 0; i < this.tris.length; i += 3) { minx = Math.min(minx, this.tris[i]); maxx = Math.max(maxx, this.tris[i]); miny = Math.min(miny, this.tris[i + 1]); maxy = Math.max(maxy, this.tris[i + 1]); }
    this.bounds = [minx, miny, maxx, maxy];
    this.x0 = minx; this.y0 = miny;
    this.cell = Math.max((Math.max(maxx - minx, maxy - miny) || 1) / targetCells, 1e-3);
    this.nx = Math.floor((maxx - minx) / this.cell) + 1;
    for (let k = 0; k < this.triangleCount; k++) {
      const o = k * 9, xs = [this.tris[o], this.tris[o + 3], this.tris[o + 6]], ys = [this.tris[o + 1], this.tris[o + 4], this.tris[o + 7]];
      const i0 = this.ci(Math.min(...xs), this.x0), i1 = this.ci(Math.max(...xs), this.x0), j0 = this.ci(Math.min(...ys), this.y0), j1 = this.ci(Math.max(...ys), this.y0);
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) { const key = j * this.nx + i; let a = this.cells.get(key); if (!a) this.cells.set(key, (a = [])); a.push(k); }
    }
  }
  private ci(v: number, o: number) { return Math.floor((v - o) / this.cell); }

  /** Terrain height at (x, y), or null where no terrain triangle covers the point. */
  sample = (x: number, y: number): number | null => {
    if (!this.bounds) return null;
    const i = this.ci(x, this.x0), j = this.ci(y, this.y0);
    if (i < 0 || j < 0 || i >= this.nx) return null;
    const list = this.cells.get(j * this.nx + i); if (!list) return null;
    let best: number | null = null; const eps = 1e-9, T = this.tris;
    for (const k of list) {
      const o = k * 9, ax = T[o], ay = T[o + 1], bx = T[o + 3], by = T[o + 4], cx = T[o + 6], cy = T[o + 7];
      const d = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
      if (Math.abs(d) < 1e-14) continue;
      const u = ((by - cy) * (x - cx) + (cx - bx) * (y - cy)) / d, v = ((cy - ay) * (x - cx) + (ax - cx) * (y - cy)) / d, w = 1 - u - v;
      if (u < -eps || v < -eps || w < -eps) continue;
      const z = u * T[o + 2] + v * T[o + 5] + w * T[o + 8];
      if (best === null || z > best) best = z;
    }
    return best;
  };
}

export function heightFieldFromMeshes(meshes: MeshLike[]): HeightField {
  const pos: ArrayLike<number>[] = [], idx: (ArrayLike<number> | null)[] = [];
  for (const m of meshes) { const a = m.geometry.attributes.position; if (!a || a.itemSize < 3) continue; pos.push(a.array); idx.push(m.geometry.index ? m.geometry.index.array : null); }
  return new HeightField(pos, idx);
}

/** Part classes that are ground for design objects. Buildings, the aerial image, placed items, cut and fill and lines are never ground. */
export const DESIGN_GROUND_CLASSES = ['surface', 'existing', 'context'] as const;

/**
 * The meshes a design height field may be built from: terrain surface parts only. When the bundle names its walkable terrain parts
 * they are used only if they are also ground classes. There is NO fallback to "every other mesh": with no terrain surface part the
 * result is empty and the design reports TERRAIN DATA NOT AVAILABLE.
 */
export function designTerrainMeshes<M extends { userData: Record<string, unknown> }>(meshes: readonly M[], walkableNames: readonly string[] = []): M[] {
  const names = new Set(walkableNames), ground = new Set<string>(DESIGN_GROUND_CLASSES);
  return meshes.filter((m) => ground.has(String(m.userData.c)) && (names.size === 0 || names.has(String(m.userData.name))));
}
