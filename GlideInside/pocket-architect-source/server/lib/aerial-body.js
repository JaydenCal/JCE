// The lot's aerial pictures that come with a PDF export request. The browser keeps the picture in its own image store (the project JSON holds only its
// key), so a server built plan set has no aerial unless the browser sends it. Pictures are checked here: PNG or JPEG data URLs of a sane size, with an
// extent in the lot's plan millimetres. Anything else is dropped (the sheet then says there is no aerial); nothing here ever fails the export.

const DATA_URL = /^data:image\/(?:png|jpe?g);base64,[A-Za-z0-9+/]+={0,2}$/;

/** [{ image, extent: { x0, y0, x1, y1 }, attribution }] (at most `maxCount`, each under `maxEach` characters, together under `maxTotal`), or null. */
export function cleanAerials(input, { maxEach = 2_600_000, maxTotal = 4_500_000, maxCount = 2 } = {}) {
  const list = (Array.isArray(input) ? input : input ? [input] : []).slice(0, maxCount);
  const out = [];
  let total = 0;
  for (const a of list) {
    const img = a?.image;
    const e = a?.extent;
    if (typeof img !== 'string' || img.length < 200 || img.length > maxEach || total + img.length > maxTotal) continue;
    if (!e || ![e.x0, e.y0, e.x1, e.y1].every((v) => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) < 1e9) || !(e.x1 > e.x0) || !(e.y1 > e.y0)) continue;
    if (!DATA_URL.test(img)) continue;
    total += img.length;
    out.push({ image: img, extent: { x0: e.x0, y0: e.y0, x1: e.x1, y1: e.y1 }, attribution: String(a.attribution || '').slice(0, 200) });
  }
  return out.length ? out : null;
}
