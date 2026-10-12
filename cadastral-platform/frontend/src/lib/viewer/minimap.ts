import type { BoxCollider, SceneBundle } from './types';

/** Draws a north-up minimap of buildings, colliders and the player. */
export function drawMinimap(cv: HTMLCanvasElement, b: SceneBundle, cols: BoxCollider[], bounds: [number, number, number, number], p: { x: number; y: number; yaw: number }, css: (n: string) => string) {
  const ctx = cv.getContext('2d'); if (!ctx) return; const W = cv.width, H = cv.height;
  ctx.clearRect(0, 0, W, H); ctx.fillStyle = css('--panel') || '#fff'; ctx.globalAlpha = 0.9; ctx.fillRect(0, 0, W, H); ctx.globalAlpha = 1;
  const [x0, y0, x1, y1] = bounds, k = Math.min((W - 8) / (x1 - x0), (H - 8) / (y1 - y0));
  const sx = (x: number) => W / 2 + (x - (x0 + x1) / 2) * k, sy = (y: number) => H / 2 - (y - (y0 + y1) / 2) * k;
  ctx.strokeStyle = css('--line') || '#999'; ctx.lineWidth = 1; ctx.strokeRect(sx(x0), sy(y1), (x1 - x0) * k, (y1 - y0) * k);
  ctx.fillStyle = css('--muted') || '#777';
  for (const c of cols) {
    const a = ((c.yaw ?? 0) * Math.PI) / 180; ctx.save(); ctx.translate(sx(c.c[0]), sy(c.c[1])); ctx.rotate(-a);
    ctx.fillRect((-c.s[0] / 2) * k, (-c.s[1] / 2) * k, Math.max(1.5, c.s[0] * k), Math.max(1.5, c.s[1] * k)); ctx.restore();
  }
  ctx.save(); ctx.translate(sx(p.x), sy(p.y)); ctx.rotate(p.yaw); ctx.fillStyle = css('--accent') || '#a8842f';
  ctx.beginPath(); ctx.moveTo(0, -7); ctx.lineTo(5, 5); ctx.lineTo(0, 2); ctx.lineTo(-5, 5); ctx.closePath(); ctx.fill(); ctx.restore();
  ctx.fillStyle = css('--fg') || '#000'; ctx.font = '10px sans-serif'; ctx.fillText('N', W - 12, 12); void b;
}
