// Re-sampling a web mercator aerial into a north up MGA image. Used only when the imagery service could not draw directly in MGA
// (the server then sends georef 'web-mercator'). Web mercator north is not MGA grid north (a rotation of up to about 1.5 degrees across
// a zone), so the picture has to be re-sampled, not just stretched.

import { mgaToWeb } from './geo.js';
import { makeWorkingCanvas, maxAerialSide } from './device-limits.js';

// Source pixel (fractional, pixel centres at +0.5) for the centre of output pixel (ox, oy).
export function sourcePixelFor(meta, ox, oy) {
  const b = meta.bbox;
  const e = b.minE + ((ox + 0.5) / meta.outWidthPx) * (b.maxE - b.minE);
  const n = b.maxN - ((oy + 0.5) / meta.outHeightPx) * (b.maxN - b.minN);
  const w = mgaToWeb(e, n, meta.zone);
  const wb = meta.webBbox;
  return { x: ((w.x - wb.minX) / (wb.maxX - wb.minX)) * meta.widthPx, y: ((wb.maxY - w.y) / (wb.maxY - wb.minY)) * meta.heightPx };
}

/**
 * warpToMga(blob, meta) -> { blob (JPEG), meta (georef 'mga') }
 * Both canvases are kept inside what the device can draw (a phone: 2048 px a side, and never over the iOS canvas pixel limit), so the output
 * can be smaller than meta.outWidthPx x outHeightPx; the returned meta says the size it really has. opts.side / opts.make are for tests.
 */
export async function warpToMga(blob, meta, { side = maxAerialSide(), make } = {}) {
  if (typeof createImageBitmap !== 'function') throw new Error('This browser cannot re-sample the aerial image');
  const bmp = await createImageBitmap(blob);
  const mk = make ? { make } : {};
  const sw = makeWorkingCanvas(bmp.width, bmp.height, { side, ...mk });
  sw.ctx.drawImage(bmp, 0, 0, sw.width, sw.height);
  bmp.close?.();
  const srcW = sw.width;
  const srcH = sw.height;
  const sd = sw.ctx.getImageData(0, 0, srcW, srcH).data;
  try { sw.canvas.width = 0; sw.canvas.height = 0; } catch { /* the picture is read: let the browser take the memory back */ }
  const ow = makeWorkingCanvas(meta.outWidthPx, meta.outHeightPx, { side, ...mk });
  const W = ow.width;
  const H = ow.height;
  const out = ow.canvas;
  const octx = ow.ctx;
  const od = octx.createImageData(W, H);
  const m = { ...meta, outWidthPx: W, outHeightPx: H, widthPx: srcW, heightPx: srcH };
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const p = sourcePixelFor(m, x, y);
      const fx = p.x - 0.5;
      const fy = p.y - 0.5;
      const x0 = Math.floor(fx);
      const y0 = Math.floor(fy);
      const tx = fx - x0;
      const ty = fy - y0;
      const o = (y * W + x) * 4;
      for (let c = 0; c < 3; c++) {
        const at = (xx, yy) => sd[(Math.min(srcH - 1, Math.max(0, yy)) * srcW + Math.min(srcW - 1, Math.max(0, xx))) * 4 + c];
        od.data[o + c] = (at(x0, y0) * (1 - tx) + at(x0 + 1, y0) * tx) * (1 - ty) + (at(x0, y0 + 1) * (1 - tx) + at(x0 + 1, y0 + 1) * tx) * ty;
      }
      od.data[o + 3] = 255;
    }
  }
  octx.putImageData(od, 0, 0);
  const jpeg = out.convertToBlob ? await out.convertToBlob({ type: 'image/jpeg', quality: 0.95 }) : await new Promise((r) => out.toBlob(r, 'image/jpeg', 0.95));
  const next = { ...meta, georef: 'mga', widthPx: W, heightPx: H, mmPerPx: ((meta.bbox.maxE - meta.bbox.minE) / W) * 1000, warped: true };
  delete next.webBbox;
  return { blob: jpeg, meta: next };
}
