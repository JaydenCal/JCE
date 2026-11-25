// 3D renders for the plan sets: one large render on the cover (beside the drawing index) and a "3D VIEWS" sheet of four captioned views. The pictures come
// from the app's own 3D scene (src/viewer3d) drawn offscreen at print size: the building on the lot with the aerial underlay, fences and boundary, from a high
// angle, with no controls on it. Where WebGL is not available nothing is returned and the set simply leaves the sheet and the cover picture out.
//
//   renderSetViews(project, { catalogue })  -> { cover, views: [{ key, label, image }] } | null     (browser only; images are JPEG data URLs)
//   cleanViews3d(input)                     -> the same shape, checked, or null                      (the server takes the browser's pictures this way)

import { imageInfo, placeImage } from '../pdf.js';
import { AREA } from './frame.js';
import { PEN } from '../eng/kit.js';
import { isConstrainedDevice } from '../../../site/device-limits.js';
export { cleanViews3d } from './views3d-clean.js';

/** Camera for each picture: azOff turns the camera round the lot from the street side, elev is the angle down in degrees. */
export const COVER_VIEW = { key: 'cover', label: 'Front three quarter', azOff: 0, elev: 36 };
export const SHEET_VIEWS = [
  { key: 'front', label: 'FRONT THREE QUARTER VIEW', azOff: 0, elev: 36 },
  { key: 'rear', label: 'REAR THREE QUARTER VIEW', azOff: 180, elev: 36 },
  { key: 'corner', label: 'OTHER FRONT CORNER VIEW', azOff: -56, elev: 36 },
  { key: 'aerial', label: 'HIGH AERIAL VIEW', azOff: 20, elev: 62 },
];

/** Picture sizes: the cover picture is 2400 px wide on a desktop (2048 on a phone, the device canvas limit), the sheet views 1800 (1400 on a phone). */
export function viewSizes({ phone = isConstrainedDevice() } = {}) {
  const cw = phone ? 2048 : 2400;
  const vw = phone ? 1400 : 1800;
  return { cover: { width: cw, height: Math.round(cw * 0.875) }, view: { width: vw, height: Math.round(vw / 1.4) } };
}

/** The cover picture frame (mm) shares the place of the house thumbnail: the right column under the locality plan. */
export const COVER_BOX = { x0: 206, y0: 156, x1: AREA.x1 - 5, y1: 262 };

async function toJpeg(blob, quality = 0.9) {
  const bmp = await createImageBitmap(blob);
  const c = document.createElement('canvas');
  c.width = bmp.width;
  c.height = bmp.height;
  const g = c.getContext('2d');
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, c.width, c.height);
  g.drawImage(bmp, 0, 0);
  bmp.close?.();
  return c.toDataURL('image/jpeg', quality);
}

/**
 * Render the pictures from the app's 3D scene, offscreen. `project` is the design on its lot (the same one the sheets draw). Returns null when there is no
 * document or WebGL, when the design has no lot, or when any render fails (an empty frame is never printed).
 */
export async function renderSetViews(project, { catalogue = null, phone } = {}) {
  if (typeof document === 'undefined' || !project?.site?.lot?.boundary?.length) return null;
  let host = null;
  let viewer = null;
  try {
    const [{ createViewer3D }, { createStore }] = await Promise.all([import('../../../viewer3d/viewer.js'), import('../../../model/store.js')]);
    host = document.createElement('div');
    host.setAttribute('aria-hidden', 'true');
    host.style.cssText = 'position:fixed;left:-12000px;top:0;width:900px;height:640px;overflow:hidden;pointer-events:none;';
    document.body.appendChild(host);
    const store = createStore(structuredClone(project), {});
    viewer = createViewer3D(host, store, { catalogue, adaptive: false });
    if (!viewer || viewer.unavailable) return null;
    await viewer.ready?.().catch(() => null);
    const sz = viewSizes({ phone });
    const shot = async (v, size) => {
      const blob = await viewer.snapshot({ width: size.width, height: size.height, view: { azOff: v.azOff, elev: v.elev } });
      if (!blob || blob.size < 2000) throw new Error('blank render');
      return toJpeg(blob);
    };
    const cover = await shot(COVER_VIEW, sz.cover);
    const views = [];
    for (const v of SHEET_VIEWS) views.push({ key: v.key, label: v.label, image: await shot(v, sz.view) });
    return { cover, views };
  } catch {
    return null;
  } finally {
    try { viewer?.dispose?.(); } catch { /* gone */ }
    host?.remove();
  }
}

/** The cover render in the right column, with the frame title. Returns false (and draws nothing) when there is no cover picture. */
export function drawCover3d(doc, views3d) {
  const img = views3d?.cover ? imageInfo(views3d.cover) : null;
  if (!img) return false;
  const r = COVER_BOX;
  doc.setDrawColor(...PEN.ink);
  doc.setLineWidth(0.3);
  doc.rect(r.x0, r.y0, r.x1 - r.x0, r.y1 - r.y0);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(...PEN.ink);
  doc.text('3D VIEW, FRONT THREE QUARTER (INDICATIVE)', r.x0, r.y0 - 2.2);
  const k = Math.max((r.x1 - r.x0) / img.w, (r.y1 - r.y0) / img.h); // cover the frame, cropped at the edges
  const w = img.w * k;
  const h = img.h * k;
  doc.saveGraphicsState();
  const sf = doc.internal.scaleFactor;
  const H = doc.internal.pageSize.getHeight();
  const f = (v) => (v * sf).toFixed(2);
  doc.internal.write(f(r.x0), f(H - r.y1), f((r.x1 - r.x0)), f((r.y1 - r.y0)), 're W n');
  try { doc.addImage(img.url, img.fmt, r.x0 + (r.x1 - r.x0 - w) / 2, r.y0 + (r.y1 - r.y0 - h) / 2, w, h, undefined, 'FAST'); } catch { /* the plain frame stays */ }
  doc.restoreGraphicsState();
  return true;
}

/** The "3D VIEWS" sheet: the four pictures in a 2 by 2 grid, each captioned. Returns { kv, notes }. */
export function drawViews3dSheet(doc, views3d) {
  const views = views3d?.views || [];
  const gap = 8;
  const x0 = AREA.x0 + 3;
  const w = (AREA.x1 - AREA.x0 - 6 - gap) / 2;
  const h = w / 1.4;
  views.slice(0, 4).forEach((v, i) => {
    const x = x0 + (i % 2) * (w + gap);
    const y = AREA.y0 + 10 + Math.floor(i / 2) * (h + 16);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(...PEN.ink);
    doc.text(`${i + 1}. ${v.label}`, x, y - 2.2);
    doc.setDrawColor(...PEN.ink);
    doc.setLineWidth(0.3);
    doc.rect(x, y, w, h);
    const img = imageInfo(v.image);
    if (img) placeImage(doc, img, { x: x + 0.3, y: y + 0.3, w: w - 0.6, h: h - 0.6 });
  });
  return { kv: [['Views', String(views.length)], ['Source', 'App 3D model']], notes: ['Indicative 3D views of the concept design on the lot, from the 3D model.', 'Not to scale. Finishes, landscaping and levels are indicative.'] };
}
