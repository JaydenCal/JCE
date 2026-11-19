// A small SVG map of a lot (plan mm, y down): boundary, indicative setback envelope, the street and the frontage. Used by the Find your lot
// step of both flows. Pure string building apart from the optional aerial.

import { lotOf, classifyEdges, requiredFor } from '../model/placement.js';
import * as G from '../model/geometry.js';

const pts = (a) => a.map((p) => `${Math.round(p.x)},${Math.round(p.y)}`).join(' ');

/** The viewBox (mm) that shows the lot and its envelope with a margin. */
export function mapBox(lot, { margin = 0.18 } = {}) {
  const all = [...lot.boundary];
  const bb = G.bbox(all);
  const m = Math.max(bb.w, bb.h) * margin;
  return { x: bb.minX - m, y: bb.minY - m, w: bb.w + 2 * m, h: bb.h + 2 * m };
}

/** Frontage length in metres (the street edges together), or null. */
export function frontageM(lot) {
  const f = classifyEdges(lot).filter((e) => e.kind === 'front');
  return f.length ? f.reduce((t, e) => t + G.dist(e.a, e.b), 0) / 1000 : null;
}

/** The lot confirm map as an SVG string. `aerial` is { href, extent } or null. */
export function lotMapSvg(project, { aerial = null, width = 560 } = {}) {
  const lot = lotOf(project);
  if (!lot) return '';
  const box = mapBox(lot);
  const px = box.w / width; // mm per drawn pixel
  const edges = classifyEdges(lot);
  const front = edges.filter((e) => e.kind === 'front' || e.kind === 'secondaryFront');
  let s = `<svg class="gf-map" xmlns="http://www.w3.org/2000/svg" viewBox="${Math.round(box.x)} ${Math.round(box.y)} ${Math.round(box.w)} ${Math.round(box.h)}" role="img" aria-label="Your lot with its street frontage and setbacks">`;
  s += `<rect x="${box.x}" y="${box.y}" width="${box.w}" height="${box.h}" fill="#e3ead9"/>`;
  if (aerial?.href && aerial.extent) {
    const e = aerial.extent;
    s += `<image href="${aerial.href}" x="${e.x0}" y="${e.y0}" width="${e.x1 - e.x0}" height="${e.y1 - e.y0}" preserveAspectRatio="none" opacity="0.9"/>`;
  }
  s += `<polygon points="${pts(lot.boundary)}" fill="rgba(255,255,255,.28)" stroke="#d11f1f" stroke-width="${3 * px}"/>`;
  const env = Array.isArray(lot.envelope) && lot.envelope.length >= 3 ? lot.envelope : null;
  if (env) s += `<polygon points="${pts(env)}" fill="rgba(23,114,74,.12)" stroke="#17724a" stroke-width="${2 * px}" stroke-dasharray="${8 * px} ${5 * px}"/>`;
  for (const e of front) s += `<line x1="${e.a.x}" y1="${e.a.y}" x2="${e.b.x}" y2="${e.b.y}" stroke="#1b4fd1" stroke-width="${6 * px}" stroke-linecap="round"/>`;
  return `${s}</svg>`;
}

/** The aerial of the lot as a data URL (drawn from the stored image), or null. Never throws. */
export async function aerialOf(lot, maxPx = 1024) {
  try {
    const a = lot?.aerial;
    if (!a?.key || !a.extent) return null;
    const { loadBitmap } = await import('../editor2d/underlay.js');
    const bmp = await loadBitmap(a.key);
    if (!bmp) return null;
    // loadBitmap gives { img, w, h } (the decoded image and its size), not the image itself.
    const bw = bmp.w || bmp.width;
    const bh = bmp.h || bmp.height;
    const src = bmp.img || bmp;
    const k = Math.min(1, maxPx / Math.max(bw, bh));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(bw * k));
    c.height = Math.max(1, Math.round(bh * k));
    c.getContext('2d').drawImage(src, 0, 0, c.width, c.height);
    return { href: c.toDataURL('image/jpeg', 0.8), extent: a.extent };
  } catch {
    return null;
  }
}

export function setbacksText(lot) {
  if (!lot) return 'Not loaded';
  const sb = lot.setbacks;
  if (sb && (sb.front != null || sb.side != null || sb.rear != null)) {
    // Setback values can be plain metres or rule objects ({ minM } or { value }); requiredFor reads both.
    const f = (k) => { const v = requiredFor(k, sb); return Number.isFinite(v) ? `${v.toFixed(1)} m` : 'check with council'; };
    return `Indicative setbacks loaded. Front ${f('front')}, side ${f('side')}, rear ${f('rear')}`;
  }
  if (lot.setbacksDefault) return 'Council rules not loaded. Indicative setbacks are used';
  if (lot.setbacksStatus === 'error') return 'Council rules could not be loaded. Check with council';
  return 'Working out the setbacks';
}
