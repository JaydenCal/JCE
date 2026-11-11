// Aerial underlay for the engineering style plan set. The aerial is composited onto a raster the size of a viewport (rotated and
// cropped exactly as the drawing is), reduced in resolution and compressed, and placed as one image. That keeps the PDF small, lets
// the plan be turned on the sheet, and needs no clipping through the scaled jsPDF proxy.
//   resolveAerial(project, options)  -> data URL | null    (options.aerial: data URL, Blob or bytes; else the browser's stored image)
//   renderUnderlay({ src, extent, planToSheet, rect, ... }) -> data URL (JPEG) | null
// Works in the browser (OffscreenCanvas or a canvas element) and, for the sample generator and tests, in Node with @napi-rs/canvas.

const MAX_SOURCE_CHARS = 24 * 1024 * 1024;

const isNode = () => typeof process !== 'undefined' && !!process.versions?.node && typeof document === 'undefined';

async function toBytes(src) {
  if (!src) return null;
  if (typeof src === 'string') {
    const m = /^data:image\/(?:png|jpe?g|webp);base64,(.*)$/s.exec(src);
    if (!m || src.length > MAX_SOURCE_CHARS) return null;
    const bin = atob(m[1]);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  if (src instanceof Uint8Array) return src;
  if (src instanceof ArrayBuffer) return new Uint8Array(src);
  if (typeof Blob !== 'undefined' && src instanceof Blob) return new Uint8Array(await src.arrayBuffer());
  return null;
}

/** The aerial for this project as bytes, or null. options.aerial wins; else the image stored in the browser under lot.aerial.key. */
export async function resolveAerial(project, options = {}) {
  const lot = project?.site?.lot;
  if (!lot?.aerial?.extent) return null;
  if (lot.layers && lot.layers.aerial === false) return null;
  try {
    let bytes = await toBytes(options.aerial);
    if (!bytes && lot.aerial.key && typeof indexedDB !== 'undefined') {
      const { loadImageBlob } = await import('../../../editor2d/underlay.js');
      bytes = await toBytes(await loadImageBlob(lot.aerial.key));
    }
    return bytes;
  } catch {
    return null;
  }
}

async function makeCanvas(w, h) {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  if (typeof document !== 'undefined') return Object.assign(document.createElement('canvas'), { width: w, height: h });
  if (isNode()) {
    const spec = '@napi-rs/canvas';
    const lib = await import(/* @vite-ignore */ spec);
    return lib.createCanvas(w, h);
  }
  return null;
}

async function decode(bytes) {
  if (typeof createImageBitmap === 'function') return createImageBitmap(new Blob([bytes]));
  if (isNode()) {
    const spec = '@napi-rs/canvas';
    const lib = await import(/* @vite-ignore */ spec);
    return lib.loadImage(Buffer.from(bytes));
  }
  return null;
}

async function jpegDataUrl(canvas, quality) {
  if (typeof canvas.toBuffer === 'function') return `data:image/jpeg;base64,${Buffer.from(canvas.toBuffer('image/jpeg', Math.round(quality * 100))).toString('base64')}`;
  if (typeof canvas.convertToBlob === 'function') {
    const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality });
    const buf = new Uint8Array(await blob.arrayBuffer());
    let s = '';
    for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
    return `data:image/jpeg;base64,${btoa(s)}`;
  }
  return canvas.toDataURL('image/jpeg', quality);
}

/**
 * Composite the aerial for one viewport. `planToSheet` maps plan mm to sheet mm (affine: a turn, a scale and a shift), `rect` is the
 * viewport in sheet mm. The result is a JPEG of `rect` at `pxPerMm`, washed back towards white by `wash` so linework reads over it.
 */
export async function renderUnderlay({ bytes, extent, planToSheet, rect, pxPerMm = 4.2, quality = 0.5, wash = 0.2, desat = 0.4 }) {
  try {
    if (!bytes || !extent) return null;
    const w = Math.max(8, Math.round((rect.x1 - rect.x0) * pxPerMm));
    const h = Math.max(8, Math.round((rect.y1 - rect.y0) * pxPerMm));
    const [canvas, img] = await Promise.all([makeCanvas(w, h), decode(bytes)]);
    if (!canvas || !img) return null;
    const g = canvas.getContext('2d');
    g.fillStyle = 'rgb(255,255,255)'; // plain white where the picture does not reach, never a synthetic texture
    g.fillRect(0, 0, w, h);
    const o = planToSheet({ x: 0, y: 0 });
    const ex = planToSheet({ x: 1, y: 0 });
    const ey = planToSheet({ x: 0, y: 1 });
    g.setTransform((ex.x - o.x) * pxPerMm, (ex.y - o.y) * pxPerMm, (ey.x - o.x) * pxPerMm, (ey.y - o.y) * pxPerMm, (o.x - rect.x0) * pxPerMm, (o.y - rect.y0) * pxPerMm);
    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = 'low';
    g.drawImage(img, extent.x0, extent.y0, extent.x1 - extent.x0, extent.y1 - extent.y0);
    g.setTransform(1, 0, 0, 1, 0, 0);
    // Slightly desaturated, then lightened, so the linework reads over the photograph
    try {
      g.globalCompositeOperation = 'saturation';
      g.fillStyle = `rgba(128,128,128,${desat})`;
      g.fillRect(0, 0, w, h);
    } catch { /* a canvas without blend modes keeps its colour */ }
    g.globalCompositeOperation = 'source-over';
    g.fillStyle = `rgba(255,255,255,${wash})`;
    g.fillRect(0, 0, w, h);
    return await jpegDataUrl(canvas, quality);
  } catch {
    return null;
  }
}

/** Add a decoded underlay raster to the sheet, exactly filling `rect` (sheet mm). */
export function placeUnderlay(doc, url, rect) {
  if (!url) return false;
  try {
    doc.addImage(url, 'JPEG', rect.x0, rect.y0, rect.x1 - rect.x0, rect.y1 - rect.y0);
    return true;
  } catch {
    return false;
  }
}
