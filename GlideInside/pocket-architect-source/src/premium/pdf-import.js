// PDF plan import (Plan Pack). Picks a PDF, lets the person choose a page, renders it with pdf.js at about 200 dpi
// and makes it the tracing underlay of the open design, then starts the two-point calibration.
//
//   const out = await importPdf(window.__ps);          // ps = the app api: { store, editor?, premium? }
//   out.status: 'ok' | 'locked' | 'cancelled' | 'error'
//
// The Plan Pack gate: ps.premium.isEntitled() (which includes the localhost developer unlock) or CONFIG.devUnlock.
// Not entitled: the upgrade dialog opens and nothing is read. pdf.js is loaded on demand, so a normal page load
// never carries it. Every external step can be replaced through `hooks`, which is how the tests run it without a browser.

import { CONFIG as SITE_CONFIG } from '../config.js';
import { el, track } from './util.js';
import { createLayer } from './ui/modal.js';
import { isLocalHost } from './export-client.js';

export const PDF_DPI = 200;
export const MAX_SIDE_PX = 4096; // the editor shrinks anything larger anyway
export const MAX_PDF_BYTES = 40 * 1024 * 1024;
export const MAX_THUMBS = 60;
const THUMB_PX = 150;

// Loading pdf.js -------------------------------------------------------------------------------------------------------
let pdfjsLoading = null;

/** Load pdf.js once and point it at its worker. */
export function loadPdfjs() {
  if (!pdfjsLoading) {
    pdfjsLoading = (async () => {
      const pdfjs = await import('pdfjs-dist');
      const lib = pdfjs.GlobalWorkerOptions ? pdfjs : pdfjs.default;
      const win = typeof window !== 'undefined' ? window : {};
      if (lib.GlobalWorkerOptions && !lib.GlobalWorkerOptions.workerSrc) {
        lib.GlobalWorkerOptions.workerSrc = win.__PS_PDF_WORKER__ || new URL('../../vendor/pdfjs/build/pdf.worker.min.mjs', import.meta.url).href;
      }
      return lib;
    })().catch((e) => {
      pdfjsLoading = null;
      throw e;
    });
  }
  return pdfjsLoading;
}

// Helpers ------------------------------------------------------------------------------------------------------------------
/** Pixels per PDF point for the render: 200 dpi, reduced so the longest side stays within MAX_SIDE_PX. */
export function renderScale(pageWidthPt, pageHeightPt, dpi = PDF_DPI, maxSide = MAX_SIDE_PX) {
  const wanted = dpi / 72;
  const longest = Math.max(pageWidthPt, pageHeightPt) || 1;
  return Math.min(wanted, maxSide / longest);
}

/** Pick a PDF with a hidden file input. Resolves the File, or null when the picker is cancelled. */
export function pickPdfFile() {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/pdf,.pdf';
    input.hidden = true;
    input.setAttribute('aria-label', 'Choose a PDF plan');
    let settled = false;
    const finish = (file) => {
      if (settled) return;
      settled = true;
      input.remove();
      resolve(file || null);
    };
    input.addEventListener('change', () => finish(input.files?.[0] || null));
    input.addEventListener('cancel', () => finish(null));
    document.body.append(input);
    input.click();
  });
}

function canvasToBlob(canvas, type, quality) {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

async function renderPageToCanvas(page, scale) {
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(viewport.width));
  canvas.height = Math.max(1, Math.round(viewport.height));
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff'; // pdf.js leaves the page transparent
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport }).promise;
  return canvas;
}

function readableError(e) {
  const name = e?.name || '';
  if (name === 'PasswordException') return 'That PDF is password protected. Remove the password and try again.';
  if (name === 'InvalidPDFException' || name === 'FormatError') return 'That file does not look like a valid PDF.';
  if (name === 'MissingPDFException') return 'That PDF could not be read.';
  if (typeof e?.message === 'string' && e.message && e.message.length < 140 && !/^\w*Error: /.test(e.message)) return e.message;
  return 'That PDF could not be imported. Try another file, or export the page as a PNG and use Upload image.';
}

// The page picker ----------------------------------------------------------------------------------------------------------
async function choosePage({ doc, layer, renderThumb }) {
  const count = doc.numPages;
  return new Promise((resolve) => {
    let chosen = null;
    let closed = false;
    const shown = Math.min(count, MAX_THUMBS);
    const grid = el('div', { class: 'psp-pdf-grid', role: 'listbox', 'aria-label': 'PDF pages', style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(112px, 1fr))', gap: '10px', maxHeight: '55vh', overflowY: 'auto' } });
    const cards = [];
    for (let n = 1; n <= shown; n++) {
      const holder = el('div', { class: 'psp-pdf-thumb', style: { display: 'grid', placeItems: 'center', minHeight: '120px', background: '#f3f3f3', borderRadius: '6px' } });
      const card = el('button', {
        class: 'psp-btn', type: 'button', role: 'option', dataset: { page: String(n) }, 'aria-label': `Page ${n}`,
        style: { display: 'grid', gap: '6px', padding: '6px', height: 'auto' },
        onclick: () => {
          chosen = n;
          api.close('chosen');
        },
      }, holder, el('span', null, `Page ${n}`));
      cards.push({ n, holder });
      grid.append(card);
    }
    const body = [
      el('p', { style: { margin: '0 0 10px' } }, `This PDF has ${count} pages. Choose the one to trace over.`),
      grid,
    ];
    if (count > shown) {
      const input = el('input', { type: 'number', min: '1', max: String(count), value: '1', 'aria-label': 'Page number', style: { width: '5em' } });
      body.push(el('p', { class: 'psp-fine', style: { margin: '10px 0 0' } }, `Previews show the first ${shown} pages. Or enter a page number up to ${count}: `, input,
        el('button', { class: 'psp-btn', type: 'button', style: { marginLeft: '6px' }, onclick: () => {
          const n = Math.round(Number(input.value));
          if (n >= 1 && n <= count) {
            chosen = n;
            api.close('chosen');
          }
        } }, 'Use this page')));
    }
    const api = layer.openModal({
      title: 'Choose a page',
      body: el('div', null, body),
      footer: (close) => el('button', { class: 'psp-btn', type: 'button', onclick: () => close('cancel') }, 'Cancel'),
      onClose: () => {
        closed = true;
        resolve(chosen);
      },
    });
    // Thumbnails one after another, so a large set does not freeze the page.
    (async () => {
      for (const { n, holder } of cards) {
        if (closed) return;
        try {
          const canvas = await renderThumb(n);
          if (closed) return;
          canvas.style.maxWidth = '100%';
          canvas.style.height = 'auto';
          holder.replaceChildren(canvas);
        } catch {
          holder.textContent = 'No preview';
        }
      }
    })();
  });
}

// The import ---------------------------------------------------------------------------------------------------------------
/**
 * importPdf(ps, hooks)
 *   ps:    { store, editor?, premium? }  (window.__ps)
 *   hooks: { isEntitled(), openUpgrade(), layer, config, pickFile(), loadPdf(), choosePage({ doc, layer }), renderPage(page, scale),
 *            setUnderlay(blob, opts), notify(text, kind) }  all optional, for the host page and tests.
 */
export async function importPdf(ps = (typeof window !== 'undefined' ? window.__ps : null), hooks = {}) {
  const store = ps?.store;
  if (!store) throw new Error('importPdf needs the app (window.__ps) with a store');
  const config = hooks.config || ps?.CONFIG || SITE_CONFIG;
  const entitled = hooks.isEntitled
    ? !!hooks.isEntitled()
    : !!(ps?.premium?.isEntitled?.() || (config.devUnlock && isLocalHost()));
  if (!entitled) {
    if (hooks.openUpgrade) hooks.openUpgrade({ source: 'pdf-import' });
    else ps?.premium?.openUpgrade?.();
    return { status: 'locked' };
  }

  let ownLayer = null;
  const layer = hooks.layer || (ownLayer = createLayer());
  const notify = hooks.notify || ((text, kind) => layer.notify(text, kind, kind === 'error' ? 8000 : 6000));
  const done = (result) => {
    ownLayer?.dispose();
    return result;
  };

  let file;
  try {
    file = await (hooks.pickFile || pickPdfFile)();
  } catch (e) {
    notify(readableError(e), 'error');
    return done({ status: 'error', error: e });
  }
  if (!file) return done({ status: 'cancelled' });
  if (file.size > MAX_PDF_BYTES) {
    notify('That PDF is over 40 MB. Choose a smaller file, or export just the plan page.', 'error');
    return done({ status: 'error', error: new Error('too large') });
  }

  let busy = null;
  let doc = null;
  try {
    busy = layer.notify('Reading the PDF', 'info', 60000);
    const data = new Uint8Array(await file.arrayBuffer());
    if (hooks.loadPdf) doc = await hooks.loadPdf(data);
    else {
      const pdfjs = await loadPdfjs();
      doc = await pdfjs.getDocument({ data }).promise;
    }
    const pages = doc.numPages;
    if (!pages) throw new Error('That PDF has no pages.');
    busy?.remove();
    busy = null;

    const renderThumb = async (n) => {
      const page = await doc.getPage(n);
      const base = page.getViewport({ scale: 1 });
      return renderPageToCanvas(page, THUMB_PX / Math.max(base.width, base.height));
    };
    let pageNumber = 1;
    if (pages > 1) {
      pageNumber = await (hooks.choosePage || choosePage)({ doc, layer, renderThumb });
      if (!pageNumber) return done({ status: 'cancelled' });
    }

    busy = layer.notify(`Rendering page ${pageNumber}`, 'info', 60000);
    const page = await doc.getPage(pageNumber);
    const base = page.getViewport({ scale: 1 });
    const scale = renderScale(base.width, base.height);
    const canvas = await (hooks.renderPage || renderPageToCanvas)(page, scale);
    let blob = await canvasToBlob(canvas, 'image/png');
    if (blob && blob.size > 20 * 1024 * 1024) blob = await canvasToBlob(canvas, 'image/jpeg', 0.9);
    if (!blob) throw new Error('The page could not be drawn.');
    busy?.remove();
    busy = null;

    const set = hooks.setUnderlay || ((b, opts) => setUnderlay(ps, b, opts));
    await set(blob, { calibrate: true });
    track('ps_pdf_import', { pages });
    notify(`Page ${pageNumber} imported. Pick two points a known distance apart to set the scale.`, 'ok');
    return done({ status: 'ok', page: pageNumber, pages, width: canvas.width, height: canvas.height, dpi: Math.round(scale * 72) });
  } catch (e) {
    busy?.remove();
    console.warn('[premium] PDF import failed', e);
    notify(readableError(e), 'error');
    return done({ status: 'error', error: e });
  } finally {
    try {
      doc?.destroy?.();
    } catch {
      /* already gone */
    }
  }
}

/** Hand the rendered page to the editor's underlay helper, falling back to the older editor API. */
async function setUnderlay(ps, blob, opts) {
  let mod = null;
  try {
    mod = await import('../editor2d/underlay.js');
  } catch {
    mod = null;
  }
  if (typeof mod?.setUnderlayFromBlob === 'function') return mod.setUnderlayFromBlob(ps.store, blob, opts);
  const editor = ps.editor;
  if (editor?.uploadUnderlay) {
    const file = new File([blob], 'plan.png', { type: blob.type || 'image/png' });
    await editor.uploadUnderlay(file);
    if (opts?.calibrate !== false) editor.startCalibration?.();
    return null;
  }
  throw new Error('This version of the editor cannot take an underlay from a PDF.');
}

export default importPdf;
