// PDF plan preview (free and paid). Builds the plan set in this browser, rasterises every sheet with pdf.js at about
// 70 dpi and shows the sheets in a large dialog: thumbnails down the side, the chosen sheet large, zoom to fit.
//
// Free mode: a diagonal repeating "PREVIEW" watermark is drawn into every canvas, so what is on screen is low
// resolution and watermarked. The PDF bytes live only inside this function while the pages are drawn; no blob URL, no
// download and no data URL is created. Entitled mode: the same preview without the watermark, plus a Download button
// that runs the normal paid path.
//
//   const out = await openPdfPreview({ layer, project, config, catalogue, getViewer, entitled, onUnlock, onDownload });
//   out: { close, ready: Promise<{ pages, status }> , el }

import { el, clear, track, clamp } from './util.js';
import { icon } from './icons.js';
import { loadPdfjs } from './pdf-import.js';
import { loadJsPDF, coverImage, exportPayload } from './export-client.js';

export const PREVIEW_DPI = 70;
export const WATERMARK_TEXT = 'PREVIEW, Plan Pack required to download';

/** Pixels per PDF point for the preview render. */
export const previewScale = (dpi = PREVIEW_DPI) => dpi / 72;

/** Draw the diagonal repeating watermark over a canvas (baked into its pixels). */
export function drawWatermark(canvas, text = WATERMARK_TEXT) {
  const ctx = canvas.getContext('2d');
  const w = canvas.width;
  const h = canvas.height;
  const size = Math.max(14, Math.round(w / 34));
  ctx.save();
  ctx.font = `700 ${size}px system-ui, Arial, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.lineWidth = Math.max(2, size / 7);
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.55)';
  ctx.fillStyle = 'rgba(190, 30, 30, 0.30)';
  ctx.translate(w / 2, h / 2);
  ctx.rotate(-Math.PI / 6);
  const stepX = ctx.measureText(text).width + size * 2;
  const stepY = size * 4.2;
  const reach = Math.hypot(w, h) / 2 + stepX;
  let row = 0;
  for (let y = -reach; y <= reach; y += stepY, row++) {
    const shift = row % 2 ? stepX / 2 : 0;
    for (let x = -reach + shift; x <= reach; x += stepX) {
      ctx.strokeText(text, x, y);
      ctx.fillText(text, x, y);
    }
  }
  ctx.restore();
  return canvas;
}

async function renderPage(page, scale, watermark) {
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(viewport.width));
  canvas.height = Math.max(1, Math.round(viewport.height));
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport }).promise;
  if (watermark) drawWatermark(canvas);
  return canvas;
}

const sentence = (t) => String(t || '').toLowerCase().replace(/^./, (c) => c.toUpperCase());

function sheetNames(layout, count) {
  const names = [];
  for (let i = 0; i < count; i++) {
    const sh = layout?.sheets?.[i];
    const kind = layout?.pages?.[i];
    names.push(sh ? `${sh.number}, ${sentence(sh.title)}` : kind === 'title' ? 'Title sheet' : kind === 'schedule' ? 'Schedules' : kind === 'level' ? 'Plan' : '');
  }
  return names;
}

const SCALE_CHOICES = [['auto', 'Auto'], ['20', '1:20'], ['50', '1:50'], ['100', '1:100'], ['200', '1:200'], ['500', '1:500']];
const PAPER_CHOICES = ['A3', 'A1'];

/**
 * hooks (tests and host pages): { buildPdf(project) -> Uint8Array, loadPdf(bytes) -> doc, renderPage(page, scale, watermark) -> canvas }.
 */
export function openPdfPreview({ layer, project, store = null, config = {}, catalogue = null, getViewer = null, entitled = false, onUnlock = null, onDownload = null, hooks = {} } = {}) {
  const price = config.planPack?.priceAud ?? 30;
  const state = { index: 0, zoom: 'fit', pages: [], thumbs: [], names: [], total: 0, done: false, closed: false };
  const current = () => (store ? store.project : project);
  let image = null;
  let imageLoaded = false;
  let offProject = null;

  const stage = el('div', { class: 'psp-pv-stage', tabindex: '0', 'aria-label': 'Selected sheet' });
  const rail = el('div', { class: 'psp-pv-rail', role: 'listbox', 'aria-label': 'Sheets' });
  const status = el('p', { class: 'psp-pv-status', role: 'status', 'aria-live': 'polite' }, el('span', { class: 'psp-spin', 'aria-hidden': 'true' }), ' Preparing the preview');
  const label = el('span', { class: 'psp-pv-label' }, '');
  const zoomLabel = el('span', { class: 'psp-pv-zoomlabel' }, 'Fit');

  const btn = (text, onclick, extra = {}) => el('button', { class: 'psp-btn psp-btn--sm', type: 'button', onclick, ...extra }, text);
  const prev = btn('Previous', () => select(state.index - 1), { 'aria-label': 'Previous sheet' });
  const next = btn('Next', () => select(state.index + 1), { 'aria-label': 'Next sheet' });
  const zoomOut = btn('-', () => zoomBy(1 / 1.25), { 'aria-label': 'Zoom out' });
  const zoomIn = btn('+', () => zoomBy(1.25), { 'aria-label': 'Zoom in' });
  const fit = btn('Fit', () => setZoom('fit'), { 'aria-label': 'Zoom to fit' });
  const toolbar = el('div', { class: 'psp-pv-tools' }, prev, next, label, el('span', { class: 'psp-grow' }), zoomOut, zoomLabel, zoomIn, fit);
  const main = el('div', { class: 'psp-pv-main' }, toolbar, stage);
  const body = el('div', { class: 'psp-pv' }, rail, main);
  const drawing = () => ({ scale: 'auto', paper: 'A3', ...(current().drawing || {}) });
  const scaleSel = el('select', { class: 'psp-select', id: 'psp-pv-scale', 'aria-label': 'Drawing scale', onchange: (e) => changeDrawing({ scale: e.target.value === 'auto' ? 'auto' : Number(e.target.value) }) },
    SCALE_CHOICES.map(([v, t]) => el('option', { value: v }, t)));
  const paperSel = el('select', { class: 'psp-select', id: 'psp-pv-paper', 'aria-label': 'Paper size', onchange: (e) => changeDrawing({ paper: e.target.value }) },
    PAPER_CHOICES.map((v) => el('option', { value: v }, v)));
  const setupNote = el('span', { class: 'psp-pv-setupnote', role: 'status', 'aria-live': 'polite' }, '');
  const editTitle = btn('Edit title block', () => window.__ps?.openTitleBlock?.(), { dataset: { act: 'title-block' } });
  const setup = el('div', { class: 'psp-pv-setup', role: 'group', 'aria-label': 'Drawing setup' },
    el('strong', null, 'Drawing setup'),
    el('label', { for: 'psp-pv-scale' }, 'Scale'), scaleSel,
    el('label', { for: 'psp-pv-paper' }, 'Paper'), paperSel,
    editTitle, setupNote);
  function syncSetup() {
    const d = drawing();
    scaleSel.value = String(d.scale);
    paperSel.value = d.paper;
  }
  syncSetup();
  const root = el('div', { class: 'psp-pv-wrap' }, setup, status, body);
  body.hidden = true;

  let view = null; // the canvas shown large
  function layoutView() {
    if (!view) return;
    const src = state.pages[state.index];
    if (!src) return;
    if (state.zoom === 'fit') {
      const avail = Math.max(120, stage.clientWidth - 24);
      const availH = Math.max(120, stage.clientHeight - 24);
      const k = Math.min(avail / src.width, availH / src.height);
      view.style.width = `${Math.round(src.width * k)}px`;
      view.style.height = `${Math.round(src.height * k)}px`;
      zoomLabel.textContent = 'Fit';
    } else {
      view.style.width = `${Math.round(src.width * state.zoom)}px`;
      view.style.height = `${Math.round(src.height * state.zoom)}px`;
      zoomLabel.textContent = `${Math.round(state.zoom * 100)}%`;
    }
  }

  function currentFitZoom() {
    const src = state.pages[state.index];
    if (!src) return 1;
    return Math.min(Math.max(120, stage.clientWidth - 24) / src.width, Math.max(120, stage.clientHeight - 24) / src.height);
  }

  function setZoom(z) {
    state.zoom = z === 'fit' ? 'fit' : clamp(z, 0.2, 4);
    layoutView();
  }
  function zoomBy(f) {
    setZoom((state.zoom === 'fit' ? currentFitZoom() : state.zoom) * f);
  }

  function select(i) {
    if (!state.pages.length) return;
    state.index = clamp(i, 0, state.pages.length - 1);
    const src = state.pages[state.index];
    clear(stage);
    view = document.createElement('canvas');
    view.width = src.width;
    view.height = src.height;
    view.className = 'psp-pv-sheet';
    view.setAttribute('role', 'img');
    view.setAttribute('aria-label', `Sheet ${state.index + 1} of ${state.total}${state.names[state.index] ? `, ${state.names[state.index]}` : ''}`);
    view.getContext('2d').drawImage(src, 0, 0);
    if (!entitled) view.addEventListener('contextmenu', (e) => e.preventDefault());
    view.draggable = false;
    stage.append(view);
    label.textContent = `Sheet ${state.index + 1} of ${state.total}${state.names[state.index] ? `, ${state.names[state.index]}` : ''}`;
    prev.disabled = state.index === 0;
    next.disabled = state.index >= state.pages.length - 1;
    state.thumbs.forEach((t, n) => {
      t.setAttribute('aria-selected', n === state.index ? 'true' : 'false');
      t.classList.toggle('is-on', n === state.index);
    });
    stage.scrollTo?.(0, 0);
    layoutView();
  }

  function addThumb(canvas, n) {
    const t = document.createElement('canvas');
    const w = 132;
    t.width = w;
    t.height = Math.max(1, Math.round((canvas.height / canvas.width) * w));
    const tc = t.getContext('2d');
    tc.imageSmoothingQuality = 'high';
    tc.drawImage(canvas, 0, 0, t.width, t.height);
    t.setAttribute('aria-hidden', 'true');
    if (!entitled) t.addEventListener('contextmenu', (e) => e.preventDefault());
    const b = el('button', { class: 'psp-pv-thumb', type: 'button', role: 'option', 'aria-selected': 'false', 'aria-label': `Sheet ${n + 1}`, onclick: () => select(n) }, t, el('span', null, String(n + 1)));
    state.thumbs.push(b);
    rail.append(b);
  }

  const footer = (close) => [
    el('span', { class: 'psp-pv-note' }, entitled ? 'Preview at screen resolution. The download is the full quality plan set.' : 'Low resolution preview with a watermark. The download is the full quality plan set.'),
    el('span', { class: 'psp-grow' }),
    el('button', { class: 'psp-btn', type: 'button', onclick: () => close('done') }, 'Close'),
    entitled
      ? el('button', { class: 'psp-btn psp-btn--primary', type: 'button', dataset: { act: 'download' }, onclick: async () => { close('download'); await onDownload?.(); } }, icon('download', 14), 'Download')
      : el('button', { class: 'psp-btn psp-btn--primary', type: 'button', dataset: { act: 'unlock' }, onclick: () => { close('unlock'); onUnlock?.(); } }, icon('lock', 14), `Unlock to download, A$${price}`),
  ];

  const onResize = () => state.zoom === 'fit' && layoutView();
  const modal = layer.openModal({
    title: 'Plan set preview',
    body: root,
    footer,
    onClose: () => {
      state.closed = true;
      clearTimeout(rebuildTimer);
      offProject?.();
      offProject = null;
      window.removeEventListener('resize', onResize);
      state.pages = [];
      state.thumbs = [];
      view = null;
    },
  });
  modal.el.classList.add('psp-modal--xl');
  window.addEventListener('resize', onResize);

  let runId = 0;
  let rebuildTimer = null;

  async function build() {
    const id = ++runId;
    const progressive = state.pages.length === 0;
    const pages = [];
    let doc = null;
    const stale = () => state.closed || id !== runId;
    try {
      if (!imageLoaded) {
        image = hooks.image !== undefined ? hooks.image : await coverImage(getViewer);
        imageLoaded = true;
      }
      if (stale()) return { pages: 0, status: 'closed' };
      const payload = exportPayload(current());
      let bytes = hooks.buildPdf
        ? await hooks.buildPdf(payload, image)
        : await (async () => {
            const jsPDF = await loadJsPDF();
            const { toPDF } = await import('./exporters/pdf.js');
            return toPDF(payload, { jsPDF, image, config, catalogue });
          })();
      const layout = bytes.layout;
      setupNote.textContent = layout?.note || '';
      setupNote.classList.toggle('is-warn', !!layout?.note);
      if (hooks.loadPdf) doc = await hooks.loadPdf(bytes);
      else {
        const pdfjs = await loadPdfjs();
        doc = await pdfjs.getDocument({ data: bytes }).promise;
      }
      bytes = null; // nothing keeps the PDF once it is open in pdf.js
      const names = sheetNames(layout, doc.numPages);
      if (progressive) {
        state.total = doc.numPages;
        state.names = names;
      }
      for (let n = 1; n <= doc.numPages; n++) {
        if (stale()) return { pages: 0, status: 'closed' };
        status.hidden = false;
        status.lastChild.textContent = ` Drawing sheet ${n} of ${doc.numPages}`;
        const page = await doc.getPage(n);
        const canvas = await (hooks.renderPage || renderPage)(page, previewScale(), !entitled);
        if (stale()) return { pages: 0, status: 'closed' };
        if (progressive) {
          state.pages.push(canvas);
          addThumb(canvas, n - 1);
          if (n === 1) {
            body.hidden = false;
            select(0);
          }
        } else pages.push(canvas);
      }
      if (!progressive) {
        state.pages = pages;
        state.total = pages.length;
        state.names = names;
        state.thumbs = [];
        clear(rail);
        pages.forEach((c, n) => addThumb(c, n));
        select(Math.min(state.index, pages.length - 1));
      }
      status.hidden = true;
      status.classList.remove('is-error');
      state.done = true;
      layoutView();
      track('ps_pdf_preview', { pages: state.pages.length, entitled });
      return { pages: state.pages.length, status: 'ok' };
    } catch (e) {
      console.warn('[premium] preview failed', e);
      if (!stale()) {
        status.hidden = false;
        status.replaceChildren(icon('warning', 16), ' The preview could not be built. Try again in a moment.');
        status.classList.add('is-error');
      }
      return { pages: 0, status: 'error', error: e };
    } finally {
      try {
        doc?.destroy?.();
      } catch {
        /* already gone */
      }
    }
  }

  // Re-render after the scale, paper or title block changes. Changes arrive in bursts, so wait a moment.
  function rebuildSoon(delay = 120) {
    clearTimeout(rebuildTimer);
    rebuildTimer = setTimeout(() => {
      if (state.closed) return;
      syncSetup();
      status.hidden = false;
      status.classList.remove('is-error');
      if (!status.querySelector('.psp-spin')) status.replaceChildren(el('span', { class: 'psp-spin', 'aria-hidden': 'true' }), ' Updating the preview');
      build();
    }, delay);
  }
  function changeDrawing(args) {
    if (!store) return;
    try {
      store.run('set_drawing', args);
    } catch (e) {
      layer.notify?.(e.message || 'That setting could not be applied.', 'error');
    }
    rebuildSoon(0);
  }
  offProject = store?.on?.('project', () => rebuildSoon()) || null;

  const ready = build();
  modal.el.addEventListener('keydown', (e) => {
    if (e.target.matches?.('input, textarea')) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowRight') select(state.index + 1);
    else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') select(state.index - 1);
    else if (e.key === '+' || e.key === '=') zoomBy(1.25);
    else if (e.key === '-') zoomBy(1 / 1.25);
    else if (e.key === '0') setZoom('fit');
  });
  return {
    el: modal.el,
    close: modal.close,
    ready,
    get pages() {
      return state.pages.length;
    },
  };
}

export default openPdfPreview;
