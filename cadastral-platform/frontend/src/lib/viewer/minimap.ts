import { OBJECT_KINDS, type SiteDesign } from '../site/types';
import type { BoxCollider, SceneBundle } from './types';

/** Local metres (E and N minus the scene origin) to minimap pixels, north up. `k` is pixels per metre. */
export interface MiniProjection { k: number; sx(x: number): number; sy(y: number): number; /** pixels back to local metres */ inv(px: number, py: number): [number, number] }
export function minimapProjection(bounds: readonly [number, number, number, number], W: number, H: number, pad = 4): MiniProjection {
  const [x0, y0, x1, y1] = bounds, w = Math.max(1e-6, x1 - x0), h = Math.max(1e-6, y1 - y0);
  const k = Math.min((W - 2 * pad) / w, (H - 2 * pad) / h), cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  return { k, sx: (x) => W / 2 + (x - cx) * k, sy: (y) => H / 2 - (y - cy) * k, inv: (px, py) => [cx + (px - W / 2) / k, cy - (py - H / 2) / k] };
}
/** Bounds (x0, y0, x1, y1) that hold the scene box and the lot ring, with a margin in metres. */
export function minimapBounds(scene: readonly [number, number, number, number], lot: readonly (readonly [number, number])[] | null, margin = 2): [number, number, number, number] {
  let [x0, y0, x1, y1] = scene;
  if (lot) for (const p of lot) { x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]); }
  return [x0 - margin, y0 - margin, x1 + margin, y1 + margin];
}

export interface MiniShape { id: string; type: string; kind: 'point' | 'polyline' | 'polygon'; pts: [number, number][]; colour: string }
/** The design objects as minimap shapes in local metres. A rejected proposal is left out. */
export function miniShapes(doc: SiteDesign | null, O: readonly [number, number]): MiniShape[] {
  const out: MiniShape[] = [];
  for (const o of doc?.objects ?? []) {
    if (o.accepted === 'rejected') continue;
    const g = o.geometry, pts: [number, number][] = g.kind === 'point' ? [[g.p[0] - O[0], g.p[1] - O[1]]] : (g.kind === 'polyline' ? g.pts : g.ring).map((p) => [p[0] - O[0], p[1] - O[1]] as [number, number]);
    out.push({ id: o.id, type: o.type, kind: g.kind, pts, colour: OBJECT_KINDS[o.type]?.colour ?? '#888888' });
  }
  return out;
}
export interface MiniExtras { /** the lot boundary ring in local metres */ lot?: readonly (readonly [number, number])[] | null; shapes?: readonly MiniShape[] }

/** Draws a north-up minimap of the lot boundary, the design objects, buildings and colliders, and the player. */
export function drawMinimap(cv: HTMLCanvasElement, b: SceneBundle, cols: readonly BoxCollider[], bounds: [number, number, number, number], p: { x: number; y: number; yaw: number }, css: (n: string) => string, extra: MiniExtras = {}) {
  const ctx = cv.getContext('2d'); if (!ctx) return; const W = cv.width, H = cv.height;
  ctx.clearRect(0, 0, W, H); ctx.fillStyle = css('--panel') || '#fff'; ctx.globalAlpha = 0.9; ctx.fillRect(0, 0, W, H); ctx.globalAlpha = 1;
  const pr = minimapProjection(bounds, W, H), { k, sx, sy } = pr, [x0, y0, x1, y1] = bounds;
  ctx.strokeStyle = css('--line') || '#999'; ctx.lineWidth = 1; ctx.strokeRect(sx(x0), sy(y1), (x1 - x0) * k, (y1 - y0) * k);
  if (extra.lot && extra.lot.length > 2) {
    ctx.strokeStyle = css('--accent') || '#a8842f'; ctx.lineWidth = 2; ctx.setLineDash([6, 3]); ctx.beginPath();
    extra.lot.forEach((q, i) => (i ? ctx.lineTo(sx(q[0]), sy(q[1])) : ctx.moveTo(sx(q[0]), sy(q[1])))); ctx.closePath(); ctx.stroke(); ctx.setLineDash([]); ctx.lineWidth = 1;
  }
  for (const s of extra.shapes ?? []) {
    ctx.strokeStyle = s.colour; ctx.fillStyle = s.colour;
    if (s.kind === 'point') { ctx.beginPath(); ctx.arc(sx(s.pts[0][0]), sy(s.pts[0][1]), 3, 0, Math.PI * 2); ctx.fill(); continue; }
    ctx.beginPath(); s.pts.forEach((q, i) => (i ? ctx.lineTo(sx(q[0]), sy(q[1])) : ctx.moveTo(sx(q[0]), sy(q[1]))));
    if (s.kind === 'polygon') { ctx.closePath(); ctx.globalAlpha = 0.25; ctx.fill(); ctx.globalAlpha = 1; }
    ctx.lineWidth = 1.5; ctx.stroke(); ctx.lineWidth = 1;
  }
  ctx.fillStyle = css('--muted') || '#777';
  for (const c of cols) {
    const a = ((c.yaw ?? 0) * Math.PI) / 180; ctx.save(); ctx.translate(sx(c.c[0]), sy(c.c[1])); ctx.rotate(-a);
    ctx.fillRect((-c.s[0] / 2) * k, (-c.s[1] / 2) * k, Math.max(1.5, c.s[0] * k), Math.max(1.5, c.s[1] * k)); ctx.restore();
  }
  ctx.save(); ctx.translate(sx(p.x), sy(p.y)); ctx.rotate(p.yaw); ctx.fillStyle = css('--accent') || '#a8842f';
  ctx.beginPath(); ctx.moveTo(0, -7); ctx.lineTo(5, 5); ctx.lineTo(0, 2); ctx.lineTo(-5, 5); ctx.closePath(); ctx.fill(); ctx.restore();
  ctx.fillStyle = css('--fg') || '#000'; ctx.font = '10px sans-serif'; ctx.fillText('N', W - 12, 12); void b;
}
