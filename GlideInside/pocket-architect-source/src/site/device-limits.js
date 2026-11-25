// Size limits for the aerial picture on small devices. iOS Safari (and the in-app browsers built on it) allows about 16.7 million pixels in one
// canvas and about 384 MB of canvas memory in the whole page; past that a canvas draws nothing, with no error, and a picture made from it is blank.
// So on a phone every aerial canvas and request is kept to PHONE_MAX_SIDE a side, and a canvas that came out blank is made again smaller.

export const PHONE_MAX_SIDE = 2048;
export const DESKTOP_MAX_SIDE = 4096;
export const IOS_MAX_CANVAS_PIXELS = 16777216;

/** Is this a phone or tablet class device (iOS, or a touch device with a narrow window or little memory)? Safe without a window. */
export function isConstrainedDevice(win = globalThis) {
  try {
    const nav = win.navigator || {};
    const ua = String(nav.userAgent || '');
    if (/iPhone|iPad|iPod/i.test(ua)) return true;
    if (nav.platform === 'MacIntel' && Number(nav.maxTouchPoints) > 1) return true; // iPadOS asks for the desktop site
    const mm = win.matchMedia?.bind(win);
    const coarse = !!mm?.('(pointer: coarse)')?.matches;
    if (coarse && Number(nav.deviceMemory) > 0 && Number(nav.deviceMemory) <= 4) return true; // low memory counts only on a touch device: a desktop keeps full sharpness
    return coarse && Number(win.innerWidth || 1024) <= 900;
  } catch {
    return false;
  }
}

/** The longest side an aerial canvas or request may have on this device. */
export const maxAerialSide = (win = globalThis) => (isConstrainedDevice(win) ? PHONE_MAX_SIDE : DESKTOP_MAX_SIDE);

/** Scale (at most 1) that brings w x h under `side` on the long side and under the canvas pixel limit. */
export function fitScale(w, h, side = DESKTOP_MAX_SIDE, maxPixels = IOS_MAX_CANVAS_PIXELS) {
  const a = Math.max(1, w);
  const b = Math.max(1, h);
  return Math.min(1, side / Math.max(a, b), Math.sqrt(maxPixels / (a * b)));
}

const rawCanvas = (w, h) => {
  if (typeof OffscreenCanvas !== 'undefined') {
    try { return new OffscreenCanvas(w, h); } catch { /* fall through to a page canvas */ }
  }
  return Object.assign(document.createElement('canvas'), { width: w, height: h });
};

// A canvas over the limit gives a context that draws nothing: paint one pixel and read it back.
function canvasWorks(canvas) {
  try {
    const ctx = canvas.getContext('2d');
    if (!ctx) return false;
    ctx.fillStyle = '#010203';
    ctx.fillRect(0, 0, 1, 1);
    const d = ctx.getImageData(0, 0, 1, 1).data;
    ctx.clearRect(0, 0, 1, 1);
    return d[3] === 255;
  } catch {
    return false;
  }
}

/**
 * A 2D canvas of about w x h that is checked to draw. Too large for the device (or blank when tested) shrinks it by a quarter of its area
 * up to four times. Returns { canvas, ctx, scale (actual / asked width), width, height }. Throws when even the smallest one is blank.
 * `make(w, h)` is replaceable in tests.
 */
export function makeWorkingCanvas(w, h, { side = maxAerialSide(), make = rawCanvas, maxPixels = IOS_MAX_CANVAS_PIXELS } = {}) {
  let k = fitScale(w, h, side, maxPixels);
  for (let i = 0; i < 5; i++) {
    const cw = Math.max(16, Math.round(w * k));
    const ch = Math.max(16, Math.round(h * k));
    let canvas = null;
    try { canvas = make(cw, ch); } catch { canvas = null; }
    if (canvas && canvasWorks(canvas)) return { canvas, ctx: canvas.getContext('2d'), scale: cw / w, width: cw, height: ch };
    k *= 0.7;
  }
  throw new Error('This browser could not make a canvas for the aerial picture');
}
