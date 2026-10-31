// Client side of the exports. Paid files come from the server (POST /api/export/:type with the bearer token).
// The local path exists only for the development unlock on localhost: it loads the exporters on demand.
// Nothing here imports the exporters statically, so a normal page load never carries them.

import { blobToDataUrl, downloadBlob } from './util.js';
import { ApiError } from './api.js';

export const EXPORT_ITEMS = [
  { type: 'pdf', label: 'PDF plans', hint: 'A3 sheets to scale, with schedules' },
  { type: 'dxf', label: 'DXF drawing', hint: 'Layered, for CAD software' },
  { type: 'glb', label: '3D model (GLB)', hint: 'Blender, Windows 3D Viewer, game engines' },
  { type: 'obj', label: '3D model (OBJ)', hint: 'With materials, in a zip' },
];

/** True on localhost only. The development unlock is never honoured anywhere else. */
export function isLocalHost(host = typeof window !== 'undefined' ? window.location?.hostname : '') {
  return ['localhost', '127.0.0.1', '[::1]', '::1'].includes(String(host || '').toLowerCase());
}

export const exportLabel = (type) => EXPORT_ITEMS.find((i) => i.type === type)?.label || type;

/** The project as sent to the server: the tracing underlay (a large image) is not needed for any export. */
export function exportPayload(project) {
  return { ...project, site: { ...(project.site || {}), underlay: null } };
}

const DEFAULT_JSPDF = new URL('../../vendor/jspdf/dist/jspdf.umd.min.js', import.meta.url).href;
let jspdfLoading = null;

/** Inject the jsPDF UMD build once and resolve the jsPDF class (window.jspdf.jsPDF). */
export function loadJsPDF(src = DEFAULT_JSPDF) {
  if (window.jspdf?.jsPDF) return Promise.resolve(window.jspdf.jsPDF);
  if (!jspdfLoading) {
    jspdfLoading = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = src;
      script.async = true;
      script.onload = () => (window.jspdf?.jsPDF ? resolve(window.jspdf.jsPDF) : reject(new Error('jsPDF loaded but did not register.')));
      script.onerror = () => reject(new Error('jsPDF could not be loaded.'));
      document.head.append(script);
    }).catch((e) => {
      jspdfLoading = null;
      throw e;
    });
  }
  return jspdfLoading;
}

/**
 * A PNG of the 3D model for the PDF cover, as a data URL, or null. Uses the viewer when one exists; never creates one
 * that is not already there unless the host offers getViewer.ensure(). Any failure just means no cover image.
 */
export async function coverImage(getViewer, { width = 1280, height = 800, maxChars = 1_500_000, timeoutMs = 5000 } = {}) {
  try {
    let viewer = getViewer?.() || null;
    if (!viewer && typeof getViewer?.ensure === 'function') {
      viewer = await Promise.race([getViewer.ensure(), new Promise((r) => setTimeout(() => r(null), timeoutMs))]);
    }
    if (!viewer || typeof viewer.snapshot !== 'function') return null;
    const blob = await Promise.race([viewer.snapshot({ width, height }), new Promise((r) => setTimeout(() => r(null), timeoutMs))]);
    const url = await blobToDataUrl(blob);
    return url && url.length <= maxChars ? url : null;
  } catch {
    return null;
  }
}

/** Build a file in this browser (development unlock only). Returns { blob, filename }. */
export async function buildLocal(type, project, { config, catalogue, image = null, jspdfUrl } = {}) {
  const { buildExport } = await import('./exporters/index.js');
  const file = await buildExport(type, project, {
    config,
    catalogue,
    image,
    loadJsPDF: type === 'pdf' ? () => loadJsPDF(jspdfUrl) : undefined,
  });
  return { blob: new Blob([file.bytes], { type: file.mime }), filename: file.filename };
}

/**
 * Produce one export and save it. Resolves { filename, bytes, source: 'server' | 'local' }.
 * options: { api, token, devUnlock, config, catalogue, getViewer, save }
 * `save(blob, filename)` defaults to a browser download and can be replaced in tests.
 */
export async function runExport(type, project, { api, token, devUnlock = false, config, catalogue, getViewer = null, save = downloadBlob } = {}) {
  const image = type === 'pdf' ? await coverImage(getViewer) : null;
  let file;
  let source;
  if (token) {
    // A Plan Pack token (bought, restored or the local development grant) always uses the server.
    const body = { project: exportPayload(project) };
    if (image) body.image = image;
    file = await api.exportFile(token, type, body, `${project.name || 'design'}.${type}`);
    source = 'server';
  } else if (devUnlock) {
    // Localhost with ?dev and no token: build in this browser so the exporters can be tried without a server.
    file = await buildLocal(type, exportPayload(project), { config, catalogue, image });
    source = 'local';
  } else {
    throw new ApiError('NOT_ENTITLED', 'A Plan Pack is needed for exports.');
  }
  save(file.blob, file.filename);
  return { filename: file.filename, bytes: file.blob.size, source };
}
