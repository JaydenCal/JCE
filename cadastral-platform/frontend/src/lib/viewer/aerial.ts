import * as THREE from 'three';
import type { SceneBundle } from './types';

/** Persistent wording shown on the layer legend whenever a bundle carries aerial imagery (stage 3, owner decision D). */
export const AERIAL_NOTE = 'AERIAL IMAGERY FOR INFORMATION ONLY, TO BE CONFIRMED ON SITE';
export const CAPTURE_DATE_NOT_STATED = 'CAPTURE DATE NOT STATED';
export const AERIAL_LAYER = 'aerial';
/** Opacity of a see-through (ground x-ray) material; the aerial layer follows it multiplied by its own opacity. */
export const XRAY_OPACITY = 0.28;

export interface AerialLegend { note: string; source: string; capture: string; licence?: string }

/** Legend lines for the aerial layer, or null when the bundle has no aerial image. Source is NOT STATED and the date CAPTURE DATE NOT STATED when the bundle gives none. */
export function aerialLegend(b: SceneBundle): AerialLegend | null {
  const i = b.info;
  if (!i.ground_texture && !b.layers.some((l) => l.c === AERIAL_LAYER)) return null;
  return {
    note: i.ground_texture_note || AERIAL_NOTE,
    source: i.ground_texture_source || 'SOURCE NOT STATED',
    capture: i.ground_texture_date || CAPTURE_DATE_NOT_STATED,
    licence: i.ground_texture_licence,
  };
}

/** Terrain status line for the legend (null when the bundle carries no terrain provenance). */
export function terrainLegend(b: SceneBundle): string | null {
  return b.info.terrain?.status ? `TERRAIN: ${b.info.terrain.status}` : null;
}

/** Opacity of the aerial meshes (0 to 1). Below 1 the material is transparent and stops writing depth so the ground shows through. */
export function setAerialOpacity(meshes: THREE.Mesh[], v: number) {
  const o = Math.min(1, Math.max(0, v));
  for (const m of meshes) {
    if (m.userData.c !== AERIAL_LAYER) continue;
    const mat = (m.userData.mat ?? m.material) as THREE.Material;     // the normal material, also while the ground see-through material is in use
    mat.transparent = o < 1; mat.opacity = o; mat.depthWrite = o >= 1; mat.needsUpdate = true;
    const xm = m.userData.xmat as THREE.Material | null | undefined;
    if (xm) xm.opacity = XRAY_OPACITY * o;
  }
}

/** True when the bundle carries aerial imagery and the aerial layer is switched on with an opacity above zero: the persistent aerial wording must then be shown on the stage (every tab, walk mode included). */
export function aerialNoteVisible(b: SceneBundle, on: Record<string, boolean>, opacity = 1): boolean {
  return aerialLegend(b) !== null && !!on[AERIAL_LAYER] && opacity > 0;
}

/** Burns the aerial wording into a 2D canvas (screenshot export): a dark band along the bottom edge with the note in white, wrapped to the canvas width. */
export function drawAerialNote(ctx: CanvasRenderingContext2D, w: number, h: number, note: string = AERIAL_NOTE, extra?: string) {
  const px = Math.max(12, Math.round(w / 70)), pad = Math.round(px * 0.6);
  ctx.save();
  ctx.font = `600 ${px}px sans-serif`;
  const lines: string[] = [];
  for (const text of [note, extra].filter(Boolean) as string[]) {
    let cur = '';
    for (const word of text.split(' ')) {
      const t = cur ? `${cur} ${word}` : word;
      if (cur && ctx.measureText(t).width > w - 2 * pad) { lines.push(cur); cur = word; } else cur = t;
    }
    if (cur) lines.push(cur);
  }
  const lh = Math.round(px * 1.3), bh = lines.length * lh + 2 * pad;
  ctx.fillStyle = 'rgba(0,0,0,0.72)'; ctx.fillRect(0, h - bh, w, bh);
  ctx.fillStyle = '#ffffff'; ctx.textBaseline = 'top';
  lines.forEach((t, i) => ctx.fillText(t, pad, h - bh + pad + i * lh));
  ctx.restore();
}
