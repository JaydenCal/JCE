import * as THREE from 'three';

function rnd(seed: number) { let s = seed; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; }
function canvasTex(size: number, draw: (c: CanvasRenderingContext2D, s: number) => void, tileM: number) {
  const cv = document.createElement('canvas'); cv.width = cv.height = size; draw(cv.getContext('2d')!, size);
  const t = new THREE.CanvasTexture(cv); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(1 / tileM, 1 / tileM); t.anisotropy = 8; t.colorSpace = THREE.SRGBColorSpace; return t;
}
function noise(ctx: CanvasRenderingContext2D, s: number, seed: number, base: number, amp: number, tint: [number, number, number] = [0, 0, 0]) {
  const r = rnd(seed), img = ctx.createImageData(s, s);
  for (let i = 0; i < s * s; i++) { const v = base + Math.floor(r() * amp); img.data[i * 4] = v + tint[0]; img.data[i * 4 + 1] = v + tint[1]; img.data[i * 4 + 2] = v + tint[2]; img.data[i * 4 + 3] = 255; }
  ctx.putImageData(img, 0, 0);
}
function speckle(bg: string, dot: string, seed: number, n: number) {
  return (ctx: CanvasRenderingContext2D, s: number) => {
    ctx.fillStyle = bg; ctx.fillRect(0, 0, s, s); const r = rnd(seed); ctx.fillStyle = dot;
    for (let i = 0; i < n; i++) { const w = 1 + r() * 1.6; ctx.fillRect(r() * s, r() * s, w, w); }
    for (let i = 0; i < 26; i++) { const a = 3 + r() * 6; ctx.fillStyle = r() < 0.5 ? 'rgba(120,118,110,.25)' : 'rgba(255,255,255,.3)'; ctx.fillRect(r() * s, r() * s, a, a * 0.6); }
  };
}
/** Grey-scale procedural textures (metres per tile) so the material colour tints them. */
export function makeTextures(): Record<string, THREE.CanvasTexture> {
  const T: Record<string, THREE.CanvasTexture> = {
    trimclad: canvasTex(256, (ctx, s) => {
      ctx.fillStyle = '#e9e9e9'; ctx.fillRect(0, 0, s, s); const p = s / 4;
      for (let k = 0; k < 4; k++) { const x = k * p, g = ctx.createLinearGradient(x, 0, x + p, 0); g.addColorStop(0, '#d2d2d2'); g.addColorStop(0.08, '#ffffff'); g.addColorStop(0.16, '#b0b0b0'); g.addColorStop(0.3, '#e6e6e6'); g.addColorStop(1, '#eeeeee'); ctx.fillStyle = g; ctx.fillRect(x, 0, p, s); }
    }, 0.9),
    conc: canvasTex(256, speckle('#e8e6df', '#9c9a92', 7, 420), 1.6),
    conc_dark: canvasTex(256, speckle('#d2d0c8', '#8a887f', 11, 380), 1.6),
    asphalt: canvasTex(256, (c, s) => noise(c, s, 3, 150, 70), 2.0),
    grass: canvasTex(256, (c, s) => noise(c, s, 5, 160, 60, [-10, 0, -30]), 2.5),
  };
  T.rollerdoor = T.trimclad; return T;
}
export function makeSprite(text: string, scale: number, accent: string): THREE.Sprite {
  const lines = text.split('\n'), cv = document.createElement('canvas'), ctx = cv.getContext('2d')!, fs = 26;
  const font = `500 ${fs}px IBM Plex Sans, Segoe UI, sans-serif`; ctx.font = font;
  cv.width = Math.ceil(Math.max(...lines.map((l) => ctx.measureText(l).width)) + 24); cv.height = Math.ceil(lines.length * (fs + 6) + 16);
  ctx.font = font; ctx.fillStyle = 'rgba(255,255,255,0.93)'; ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(0, 0, cv.width, cv.height, 10); else ctx.rect(0, 0, cv.width, cv.height);
  ctx.fill(); ctx.strokeStyle = accent; ctx.lineWidth = 4; ctx.stroke();
  ctx.fillStyle = '#1e2024'; ctx.textBaseline = 'top'; lines.forEach((l, i) => ctx.fillText(l, 12, 8 + i * (fs + 6)));
  const tex = new THREE.CanvasTexture(cv); tex.minFilter = THREE.LinearFilter; tex.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  const k = 0.012 * scale; sp.scale.set(cv.width * k, cv.height * k, 1); sp.renderOrder = 10; return sp;
}
