// The 3D render pictures that come with a PDF export request (no imports, so the server can take them without the PDF drawing code).

const MAX_IMAGE_CHARS = 3_500_000;
/** Checked pictures from the browser: JPEG or PNG data URLs only, a size cap each, at most four sheet views. */
export function cleanViews3d(input) {
  if (!input || typeof input !== 'object') return null;
  const ok = (u) => typeof u === 'string' && u.length < MAX_IMAGE_CHARS && /^data:image\/(png|jpe?g);base64,[A-Za-z0-9+/=]+$/.test(u);
  const cover = ok(input.cover) ? input.cover : null;
  const views = (Array.isArray(input.views) ? input.views : []).filter((v) => v && ok(v.image)).slice(0, 4).map((v) => ({ key: String(v.key || '').slice(0, 20), label: String(v.label || '').replace(/[^\x20-\x7e]/g, '').slice(0, 60).toUpperCase(), image: v.image }));
  return cover || views.length ? { cover, views } : null;
}

