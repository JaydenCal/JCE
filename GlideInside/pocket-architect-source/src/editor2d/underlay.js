// Underlay image storage. Images live in IndexedDB under 'ps.underlay.<projectId>', never in the project JSON.
// Every access is wrapped: if IndexedDB is blocked the image is kept in memory for the session.

const DB_NAME = 'ps.underlay';
const STORE = 'images';
const MAX_SIDE = 4096;
const memory = new Map();
const bitmaps = new Map();

export const underlayKey = (projectId) => `ps.underlay.${projectId}`;

function openDb() {
  return new Promise((resolve, reject) => {
    try {
      if (typeof indexedDB === 'undefined') return reject(new Error('IndexedDB unavailable'));
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
      req.onblocked = () => reject(new Error('IndexedDB blocked'));
    } catch (e) {
      reject(e);
    }
  });
}

async function withStore(mode, fn) {
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const result = fn(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(result?.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

export async function saveImage(key, blob) {
  memory.set(key, blob);
  bitmaps.delete(key);
  try {
    await withStore('readwrite', (s) => s.put(blob, key));
    return true;
  } catch {
    return false; // kept in memory for this session only
  }
}

export async function loadImageBlob(key) {
  if (memory.has(key)) return memory.get(key);
  try {
    const blob = await withStore('readonly', (s) => s.get(key));
    if (blob) memory.set(key, blob);
    return blob || null;
  } catch {
    return null;
  }
}

export async function removeImage(key) {
  memory.delete(key);
  bitmaps.delete(key);
  try {
    await withStore('readwrite', (s) => s.delete(key));
  } catch {
    /* nothing stored */
  }
}

async function decode(blob) {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(blob);
    } catch {
      /* fall through to an image element */
    }
  }
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

// Decoded image for drawing: { img, w, h } or null when missing.
export async function loadBitmap(key) {
  if (bitmaps.has(key)) return bitmaps.get(key);
  const blob = await loadImageBlob(key);
  if (!blob) return null;
  try {
    const img = await decode(blob);
    const entry = { img, w: img.width || img.naturalWidth, h: img.height || img.naturalHeight };
    bitmaps.set(key, entry);
    return entry;
  } catch {
    return null;
  }
}

// Validate a PNG or JPEG file and shrink very large images. Returns { blob, w, h }.
export async function prepareImage(file) {
  if (!file || !/^image\/(png|jpeg)$/.test(file.type)) throw new Error('Choose a PNG or JPG image');
  if (file.size > 25 * 1024 * 1024) throw new Error('That image is over 25 MB. Choose a smaller file');
  const img = await decode(file);
  const w = img.width || img.naturalWidth;
  const h = img.height || img.naturalHeight;
  if (!w || !h) throw new Error('That image could not be read');
  if (Math.max(w, h) <= MAX_SIDE) return { blob: file, w, h, srcW: w, srcH: h };
  const k = MAX_SIDE / Math.max(w, h);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(w * k);
  canvas.height = Math.round(h * k);
  canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, file.type, 0.92));
  if (!blob) return { blob: file, w, h, srcW: w, srcH: h };
  return { blob, w: canvas.width, h: canvas.height, srcW: w, srcH: h };
}

// Setting an image as the underlay -------------------------------------------------------------------------------
// The editor registers itself per store so these helpers can place the image at the middle of the visible plan,
// hand it the decoded bitmap and start calibration without importing the editor (which imports this file).
const editors = new WeakMap();

// Called by createEditor2D. hooks: { centre() -> {x, y}, setBitmap(entry), calibrate() }.
export function registerUnderlayEditor(store, hooks) {
  editors.set(store, hooks);
  return () => {
    if (editors.get(store) === hooks) editors.delete(store);
  };
}

/**
 * setUnderlayFromBlob(store, blob, { mmPerPx, calibrate = true }) -> Promise<{ key, width, height, mmPerPx, stored }>
 *
 * Makes a PNG or JPEG Blob (or File) the underlay of the current project, replacing any earlier one, and then
 * starts the two-point calibration so the person can set the true scale. Images over 4096 px are shrunk first and
 * `mmPerPx` (millimetres per source pixel) is adjusted to match. Without `mmPerPx` the image is fitted to 12 m wide.
 * The image is stored in IndexedDB (or kept in memory when the browser blocks it), never in the project JSON.
 * One undo step ("Set underlay"). Rejects with a readable Error when the image cannot be used.
 * Pass { calibrate: false } to skip calibration, for example when the scale is known exactly.
 */
export async function setUnderlayFromBlob(store, blob, { mmPerPx, calibrate = true } = {}) {
  const prepared = await prepareImage(blob);
  const key = underlayKey(store.project.id);
  const stored = await saveImage(key, prepared.blob);
  const bitmap = await loadBitmap(key);
  if (!bitmap) throw new Error('That image could not be read');
  const hooks = editors.get(store);
  const centre = hooks?.centre?.() || { x: 6000, y: 4500 };
  const prev = store.project.site.underlay;
  const scaleBack = prepared.srcW && prepared.w ? prepared.srcW / prepared.w : 1;
  const scale = Number(mmPerPx) > 0 ? Number(mmPerPx) * scaleBack : 12000 / prepared.w;
  const u = {
    key,
    x: Math.round(prev?.x ?? centre.x),
    y: Math.round(prev?.y ?? centre.y),
    mmPerPx: scale,
    rotation: prev?.rotation ?? 0,
    opacity: prev?.opacity ?? 0.5,
    locked: false,
  };
  hooks?.setBitmap?.(key, bitmap);
  store.apply('Set underlay', (p) => {
    p.site.underlay = u;
  });
  if (calibrate) hooks?.calibrate?.();
  return { key, width: prepared.w, height: prepared.h, mmPerPx: scale, stored };
}

// Same, from a canvas (for example a rendered PDF page). Resolves as setUnderlayFromBlob does.
export async function setUnderlayFromCanvas(store, canvas, opts = {}) {
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('That image could not be read');
  return setUnderlayFromBlob(store, blob, opts);
}
