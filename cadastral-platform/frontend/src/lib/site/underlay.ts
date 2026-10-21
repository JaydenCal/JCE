/**
 * Stage 8: the plan underlay of the Trace service tool.
 *
 * A plan page (a PNG or JPEG image, or one page of an uploaded PDF rendered by the server) is placed in the model by a TWO POINT calibration: two points picked
 * on the image (pixels) and the two MGA points they stand for (typed, or two lot boundary corners). From those two pairs the image is scaled, rotated and moved
 * (a similarity transform: no shear, no mirror). The image y axis points down; the transform accounts for it.
 *
 * Nothing is invented: an underlay with no calibration is not drawn in the model, a calibration with coincident points is refused, and the scale and rotation are
 * reported so the user can see whether they are plausible. The underlay is a tracing aid for this session and is NOT part of the saved design.
 */
import * as THREE from 'three';
import type { Pos } from './types';

export type Pt2 = [number, number];
export interface Calibration {
  /** MGA metres per image pixel */
  scale: number;
  /** clockwise rotation of the image x axis from grid east, degrees (0 = the image is square to the grid) */
  rotation_deg: number;
  /** a = scale * (cos, sin) of the rotation (complex multiplier on (x, -y) pixels), b = MGA position of pixel (0, 0) */
  a: Pt2; b: Pt2;
}
export class CalibrationError extends Error {}
export const MIN_PICK_PX = 5, MIN_PICK_M = 0.5;

/** The MGA position of an image pixel. */
export function pxToMga(c: Calibration, px: number, py: number): Pt2 {
  const x = px, y = -py;                                               // image y points down, MGA north points up
  return [c.a[0] * x - c.a[1] * y + c.b[0], c.a[1] * x + c.a[0] * y + c.b[1]];
}
/** The image pixel at an MGA position. */
export function mgaToPx(c: Calibration, e: number, n: number): Pt2 {
  const dx = e - c.b[0], dy = n - c.b[1], d = c.a[0] * c.a[0] + c.a[1] * c.a[1];
  const x = (dx * c.a[0] + dy * c.a[1]) / d, y = (dy * c.a[0] - dx * c.a[1]) / d;
  return [x, -y];
}
/** Calibrate from two image points and the two MGA points they stand for. */
export function calibrate(img: readonly [Pt2, Pt2], mga: readonly [Pt2, Pt2]): Calibration {
  for (const p of [...img, ...mga]) if (!p.every((v) => typeof v === 'number' && Number.isFinite(v))) throw new CalibrationError('EVERY CALIBRATION POINT MUST BE A NUMBER');
  const ix = img[1][0] - img[0][0], iy = -(img[1][1] - img[0][1]), mx = mga[1][0] - mga[0][0], my = mga[1][1] - mga[0][1];
  const il = Math.hypot(ix, iy), ml = Math.hypot(mx, my);
  if (il < MIN_PICK_PX) throw new CalibrationError('THE TWO POINTS ON THE PLAN ARE TOO CLOSE TOGETHER (PICK POINTS FAR APART)');
  if (ml < MIN_PICK_M) throw new CalibrationError('THE TWO MODEL POINTS ARE TOO CLOSE TOGETHER (PICK POINTS FAR APART)');
  const d = il * il, ar = (mx * ix + my * iy) / d, ai = (my * ix - mx * iy) / d;       // a = m / i as complex numbers
  const scale = Math.hypot(ar, ai);
  const x0 = img[0][0], y0 = -img[0][1];
  const b: Pt2 = [mga[0][0] - (ar * x0 - ai * y0), mga[0][1] - (ai * x0 + ar * y0)];
  // the rotation of the image x axis, clockwise from grid east (a negative angle of the complex multiplier)
  return { scale, rotation_deg: normDeg(-Math.atan2(ai, ar) * 180 / Math.PI), a: [ar, ai], b };
}
const normDeg = (d: number) => ((d % 360) + 360) % 360;

/** The four corners of an image in MGA: top left, top right, bottom right, bottom left. */
export function imageCorners(c: Calibration, width: number, height: number): [Pos, Pos, Pos, Pos] {
  return [pxToMga(c, 0, 0), pxToMga(c, width, 0), pxToMga(c, width, height), pxToMga(c, 0, height)];
}
export const clampOpacity = (v: number): number => (Number.isFinite(v) ? Math.min(1, Math.max(0.05, v)) : 0.5);

/** Metres the calibration says one pixel is, as a label (no claim that this is the plan scale). */
export function calibrationLabel(c: Calibration): string {
  return `${c.scale.toFixed(4)} M PER PIXEL · ROTATION ${c.rotation_deg.toFixed(2)} DEG`;
}

export const UNDERLAY_GRID = 24;           // cells per side of the draped quad (a display resolution)
export const UNDERLAY_LIFT = 0.04;         // metres above the terrain (a display convention)
/**
 * The underlay as a quad draped on the terrain: a grid of cells, each vertex lifted onto the terrain where it reaches (the mean known height elsewhere).
 * The mesh is not pickable (a ray passes through it), so tracing clicks reach the terrain.
 */
export function underlayMesh(corners: readonly [Pos, Pos, Pos, Pos], texture: THREE.Texture | null, opacity: number, sample: (e: number, n: number) => number | null, O: readonly [number, number], n = UNDERLAY_GRID): THREE.Mesh {
  const [tl, tr, br, bl] = corners, pos: number[] = [], uv: number[] = [], idx: number[] = [];
  const zs: number[] = [], pts: [number, number, number | null][] = [];
  for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) {
    const u = i / n, v = j / n;
    const e = (1 - v) * ((1 - u) * tl[0] + u * tr[0]) + v * ((1 - u) * bl[0] + u * br[0]);
    const nn = (1 - v) * ((1 - u) * tl[1] + u * tr[1]) + v * ((1 - u) * bl[1] + u * br[1]);
    const z = sample(e, nn); if (z !== null) zs.push(z);
    pts.push([e, nn, z]); uv.push(u, 1 - v);
  }
  const fb = zs.length ? zs.reduce((a, b) => a + b, 0) / zs.length : 0;
  for (const [e, nn, z] of pts) pos.push(e - O[0], nn - O[1], (z ?? fb) + UNDERLAY_LIFT);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { const a = j * (n + 1) + i, b = a + 1, c = a + n + 1, d = c + 1; idx.push(a, b, c, b, d, c); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx);
  const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ map: texture ?? null, color: texture ? 0xffffff : 0xcccccc, transparent: true, opacity: clampOpacity(opacity), side: THREE.DoubleSide, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }));
  m.renderOrder = 2; m.name = 'plan_underlay'; return m;
}
export function setUnderlayOpacity(m: THREE.Mesh, opacity: number) { (m.material as THREE.MeshBasicMaterial).opacity = clampOpacity(opacity); }

/** A texture from a loaded image (browser only). */
export function textureOf(img: HTMLImageElement | ImageBitmap | HTMLCanvasElement): THREE.Texture {
  const t = new THREE.Texture(img as unknown as HTMLImageElement);
  t.colorSpace = THREE.SRGBColorSpace; t.needsUpdate = true; t.generateMipmaps = false; t.minFilter = THREE.LinearFilter; return t;
}
/** Image types the tool reads in the browser. A PDF is uploaded and rendered by the server instead. */
export const UNDERLAY_IMAGE_TYPES = ['image/png', 'image/jpeg'];
export const MAX_UNDERLAY_PX = 8000;
export const MAX_UNDERLAY_BYTES = 25 * 1024 * 1024;

/** The image pixel under a click: the click position inside the displayed box scaled to the natural size of the image. Null outside the box. */
export function clientToPixel(clientX: number, clientY: number, box: { left: number; top: number; width: number; height: number }, natural: { width: number; height: number }): Pt2 | null {
  if (!(box.width > 0 && box.height > 0)) return null;
  const u = (clientX - box.left) / box.width, v = (clientY - box.top) / box.height;
  if (u < 0 || u > 1 || v < 0 || v > 1) return null;
  return [u * natural.width, v * natural.height];
}
