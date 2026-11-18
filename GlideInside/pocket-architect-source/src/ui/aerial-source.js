// "Aerial source" chooser, shown under the Aerial on/off button: Standard (NSW/QLD) | My Nearmap key | My image file.
// A dialog with one panel per source. Everything runs in this browser: the Nearmap key goes only to Nearmap, the picture file is never uploaded.
import { h } from './dom.js';
import { openModal } from './modal.js';
import { toast } from './toast.js';
import { SOURCES, LICENCE_NOTE, aerialSourceOf, hasAerialStandard, crsChoices, defaultCrsId, loadOwnPicture, placeOnLot, encodeJpeg, applyUserAerial, useStandardAerial, FILE_ATTRIBUTION, SHARE_WARNING } from '../site/own-aerial.js';
import { fetchNearmapForLot, readKey, saveKey, forgetKey, validKey } from '../site/nearmap-aerial.js';

export const AERIAL_SOURCE_CSS = `
.ps-aerial-src{display:inline-flex;align-items:center;gap:6px;height:30px;padding:0 12px!important;border-radius:15px;border:1px solid rgba(255,255,255,.28)!important;background:rgba(10,10,12,.76)!important;-webkit-backdrop-filter:blur(16px);backdrop-filter:blur(16px);color:#fff;font:500 12px/1 system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif;cursor:pointer;white-space:nowrap}
.ps-aerial-src:hover{background:rgba(40,40,46,.88)!important}.ps-aerial-src:focus-visible{outline:2px solid #fff;outline-offset:2px}.ps-aerial-src[hidden]{display:none!important}
.lc-root .lc-aerial-src{position:absolute;right:64px;top:134px}
.lc-embed.is-compact .lc-aerial-src{right:12px;top:270px}
.lc-root[data-view="2d"] .lc-aerial-src,.lc-root[data-view="split"] .lc-aerial-src{display:none!important}
.ps-aerial-src-fab{position:absolute;left:12px;bottom:84px;z-index:15}
.ps-stage:has(.lc-root:not([hidden])) .ps-aerial-src-fab{display:none}
.tv-bar .ps-aerial-src{height:40px;border-radius:20px;padding:0 14px!important}
.as-dlg{display:grid;gap:12px;font-size:14px}
.as-seg{display:flex;flex-wrap:wrap;gap:8px}
.as-seg label{display:flex;align-items:center;gap:6px;border:1px solid var(--ps-border,#dcdde0);border-radius:999px;padding:7px 14px;cursor:pointer;font-weight:600}
.as-seg label:has(input:checked){border-color:var(--ps-accent,#1b4fd1);background:var(--ps-accent-soft,#e6ecfb)}
.as-seg input{margin:0}
.as-panel{display:grid;gap:10px}
.as-panel[hidden]{display:none}
.as-note{margin:0;color:var(--ps-muted,#5a5e66);font-size:13px}
.as-warn{margin:0;padding:8px 10px;border-radius:8px;background:var(--ps-warning-soft,#f7e9cc);color:var(--ps-warning,#7a4a00);font-size:13px}
.as-row{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
.as-dlg input[type=password],.as-dlg input[type=text],.as-dlg select{border:1px solid var(--ps-border,#dcdde0);border-radius:8px;padding:9px 11px;font:inherit;min-height:40px;background:var(--ps-field,#fff);color:var(--ps-text,#1a1c20);min-width:0}
.as-dlg input[type=password]{flex:1;min-width:200px}
.as-status{min-height:1.3em;font-weight:600}
.as-status--bad{color:var(--ps-danger,#b52828)}
.as-pts{display:grid;gap:10px;grid-template-columns:minmax(0,1.4fr) minmax(0,1fr)}
.as-pic{position:relative;border:1px solid var(--ps-border,#dcdde0);border-radius:8px;overflow:hidden;background:#eee;touch-action:none;cursor:crosshair;line-height:0}
.as-pic canvas{width:100%;height:auto;display:block}
.as-pin{position:absolute;width:26px;height:26px;margin:-13px 0 0 -13px;border-radius:50%;background:#ffc83d;border:2px solid #1b4fd1;color:#102;display:grid;place-items:center;font:700 13px/1 system-ui,sans-serif;cursor:grab;touch-action:none}
.as-lot{width:100%;height:auto;border:1px solid var(--ps-border,#dcdde0);border-radius:8px;background:#f3f6ef}
@media (max-width:640px){.as-pts{grid-template-columns:minmax(0,1fr)}}
`;
let cssDone = false;
function injectCss() {
  if (cssDone || typeof document === 'undefined') return;
  cssDone = true;
  if (document.getElementById('ps-aerial-src-css')) return;
  const st = document.createElement('style');
  st.id = 'ps-aerial-src-css';
  st.textContent = AERIAL_SOURCE_CSS;
  document.head.append(st);
}

const label = (project) => (SOURCES.find(([id]) => id === aerialSourceOf(project)) || SOURCES[0])[1];

/** The "Aerial source" button. Opens the chooser dialog for the lot in the store. */
export function createAerialSourceButton({ store, className = '', dataPs = 'aerial-source' }) {
  injectCss();
  const el = h('button', { class: `ps-aerial-src ${className}`.trim(), type: 'button', dataset: { ps: dataPs }, 'aria-haspopup': 'dialog', onclick: () => openAerialSource({ store }) });
  function sync() {
    const lot = store.project?.site?.lot;
    el.hidden = !lot;
    if (!lot) return;
    el.textContent = 'Use my own aerial';
    el.title = 'Use my own aerial (image or GeoTIFF file). It stays in this browser.';
    el.setAttribute('aria-label', `Use my own aerial (image or GeoTIFF file). Currently ${label(store.project)}.`);
  }
  const off = store.on('project', sync);
  sync();
  return { el, sync, dispose: () => off?.() };
}

/** Open the chooser. Returns the modal handle. */
export function openAerialSource({ store, deps = {} }) {
  injectCss();
  const lot = store.project.site?.lot;
  if (!lot) { toast('Find your lot first.', { kind: 'info' }); return null; }
  let current = aerialSourceOf(store.project);
  let prepared = null; // { src, how, note }
  const status = h('p', { class: 'as-status', role: 'status', 'aria-live': 'polite', dataset: { ps: 'aerial-src-status' } });
  const say = (t, bad = false) => { status.textContent = t; status.classList.toggle('as-status--bad', bad); };
  let close = () => {};
  const busyBtn = async (btn, fn) => { btn.disabled = true; try { await fn(); } finally { btn.disabled = false; } };
  const finish = (what) => { toast(`Aerial source: ${what}.`, { kind: 'ok' }); close('done'); };

  // Standard panel -----------------------------------------------------------------------------------------------------
  const stdBtn = h('button', { class: 'ps-btn ps-btn--primary', type: 'button', dataset: { ps: 'aerial-src-use-standard' }, onclick: () => { useStandardAerial(store); finish('Standard (NSW/QLD)'); } }, 'Use the standard aerial');
  const pStd = h('div', { class: 'as-panel', dataset: { panel: 'standard' } },
    h('p', { class: 'as-note' }, current === 'standard' ? 'This lot is using the standard state imagery (NSW and Queensland).' : 'Go back to the standard state imagery for this lot. Your own picture is removed from this browser.'),
    current === 'standard' ? null : stdBtn);

  // Nearmap panel ------------------------------------------------------------------------------------------------------
  const keyIn = h('input', { type: 'password', autocomplete: 'off', spellcheck: 'false', 'aria-label': 'Your Nearmap API key', placeholder: 'Paste your own Nearmap API key', dataset: { ps: 'aerial-src-key' } });
  const remember = h('input', { type: 'checkbox', checked: true, dataset: { ps: 'aerial-src-remember' } });
  const saved = () => !!readKey();
  const forget = h('button', { class: 'ps-btn', type: 'button', dataset: { ps: 'aerial-src-forget' }, hidden: !saved(), onclick: () => { forgetKey(); keyIn.value = ''; forget.hidden = true; savedNote.hidden = true; say('Key forgotten. It has been removed from this browser.'); } }, 'Forget my key');
  const savedNote = h('p', { class: 'as-note', hidden: !saved() }, 'A key is saved in this browser. It is used when you press Use my Nearmap key.');
  const nmBtn = h('button', { class: 'ps-btn ps-btn--primary', type: 'button', dataset: { ps: 'aerial-src-use-nearmap' }, onclick: () => busyBtn(nmBtn, async () => {
    const key = (keyIn.value || readKey()).trim();
    if (!validKey(key)) { say('Paste your own Nearmap API key first.', true); return; }
    say('Asking Nearmap for tiles over your lot');
    try {
      const out = await (deps.fetchNearmap || fetchNearmapForLot)({ lot: store.project.site.lot, key });
      if (remember.checked) saveKey(key);
      await applyUserAerial(store, out);
      finish('My Nearmap key');
    } catch (e) { say(e?.message || 'The Nearmap picture could not be loaded.', true); }
  }) }, 'Use my Nearmap key');
  const pNm = h('div', { class: 'as-panel', dataset: { panel: 'nearmap' }, hidden: true },
    h('p', { class: 'as-note' }, 'Paste your own Nearmap API key. It stays in this browser and is sent only to Nearmap to fetch the tiles for this lot. It is never sent to Glide Inside.'),
    h('div', { class: 'as-row' }, keyIn, forget), savedNote,
    h('label', { class: 'as-row', style: { gap: '8px' } }, remember, h('span', { class: 'as-note' }, 'Remember my key in this browser')),
    h('p', { class: 'as-note' }, 'Imagery is shown as "Nearmap imagery, your licence".'),
    h('p', { class: 'as-warn', dataset: { ps: 'aerial-src-nm-terms' } }, 'Your Nearmap subscription terms apply. Exported and shared plans will include the imagery.'), nmBtn);

  // File panel ---------------------------------------------------------------------------------------------------------
  const fileIn = h('input', { type: 'file', multiple: true, accept: '.tif,.tiff,.jpg,.jpeg,.png,.jgw,.jpgw,.pgw,.pngw,.tfw,.tifw,.wld', 'aria-label': 'Your picture and world file', dataset: { ps: 'aerial-src-file' } });
  const crsSel = h('select', { 'aria-label': 'Coordinate system of the picture', dataset: { ps: 'aerial-src-crs' } }, ...crsChoices().map((c) => h('option', { value: c.id }, c.label)));
  crsSel.value = defaultCrsId(lot);
  const crsRow = h('label', { class: 'as-row', hidden: true }, h('span', { class: 'as-note' }, 'Coordinate system'), crsSel);
  const fileNote = h('p', { class: 'as-note', dataset: { ps: 'aerial-src-filenote' } }, 'Choose a GeoTIFF, or a JPG or PNG with its world file (choose both files together). A plain picture can be fitted by placing two points on lot corners.');
  const ptsHost = h('div', { class: 'as-pts', hidden: true, dataset: { ps: 'aerial-src-points' } });
  const fileBtn = h('button', { class: 'ps-btn ps-btn--primary', type: 'button', disabled: true, dataset: { ps: 'aerial-src-use-file' }, onclick: () => busyBtn(fileBtn, async () => {
    if (!prepared) return;
    say('Fitting the picture to your lot');
    try {
      const how = prepared.how ? { ...prepared.how, crsId: prepared.how.crsId || crsSel.value } : pointsHow();
      const r = placeOnLot({ lot: store.project.site.lot, src: prepared.src, how });
      const blob = await encodeJpeg(r.rgba, r.outW, r.outH, deps);
      await applyUserAerial(store, { blob, meta: { kind: 'file', source: 'Your own image', attribution: FILE_ATTRIBUTION, extent: r.extent, mmPerPx: r.mmPerPx } });
      finish('My image file');
    } catch (e) { say(e?.message || 'That picture could not be placed on your lot.', true); }
  }) }, 'Use this picture');
  fileIn.addEventListener('change', async () => {
    prepared = null; fileBtn.disabled = true; ptsHost.hidden = true; crsRow.hidden = true;
    if (!fileIn.files?.length) return;
    say('Reading the picture');
    try {
      prepared = await (deps.loadOwnPicture || loadOwnPicture)(fileIn.files, deps);
      say(prepared.note);
      if (prepared.how) { crsRow.hidden = !!prepared.how.crsId; if (prepared.how.crsId) crsSel.value = prepared.how.crsId; fileBtn.disabled = false; } else { showPoints(prepared.src); }
    } catch (e) { say(e?.message || 'That file could not be read.', true); }
  });

  // Two point fit ------------------------------------------------------------------------------------------------------
  const pins = []; // picture pixel coordinates
  let c1 = h('select', { 'aria-label': 'Lot corner for pin 1', dataset: { ps: 'aerial-src-corner1' } });
  let c2 = h('select', { 'aria-label': 'Lot corner for pin 2', dataset: { ps: 'aerial-src-corner2' } });
  const corners = lot.boundary;
  const opt = (sel) => corners.forEach((_, i) => sel.append(h('option', { value: String(i) }, `Corner ${i + 1}`)));
  opt(c1); opt(c2);
  c1.value = '0'; c2.value = String(Math.min(corners.length - 1, Math.max(1, Math.floor(corners.length / 2))));
  const pointsHow = () => {
    if (pins.length < 2) throw new Error('Place both points on the picture first.');
    if (c1.value === c2.value) throw new Error('Choose two different lot corners.');
    return { kind: 'points', img: pins.map((p) => ({ x: p.x, y: p.y })), plan: [corners[Number(c1.value)], corners[Number(c2.value)]] };
  };
  function lotSvg() {
    const xs = corners.map((p) => p.x); const ys = corners.map((p) => p.y);
    const x0 = Math.min(...xs); const y0 = Math.min(...ys); const w = Math.max(...xs) - x0 || 1; const hh = Math.max(...ys) - y0 || 1; const m = Math.max(w, hh) * 0.14;
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', `${x0 - m} ${y0 - m} ${w + 2 * m} ${hh + 2 * m}`);
    svg.setAttribute('class', 'as-lot'); svg.setAttribute('role', 'img'); svg.setAttribute('aria-label', 'Your lot with numbered corners');
    const poly = document.createElementNS(NS, 'polygon');
    poly.setAttribute('points', corners.map((p) => `${p.x},${p.y}`).join(' ')); poly.setAttribute('fill', 'rgba(255,255,255,.7)'); poly.setAttribute('stroke', '#d11f1f'); poly.setAttribute('stroke-width', String(Math.max(w, hh) * 0.012));
    svg.append(poly);
    corners.forEach((p, i) => {
      const t = document.createElementNS(NS, 'text');
      t.setAttribute('x', p.x); t.setAttribute('y', p.y); t.setAttribute('font-size', String(Math.max(w, hh) * 0.075)); t.setAttribute('font-weight', '700'); t.setAttribute('text-anchor', 'middle'); t.setAttribute('dominant-baseline', 'middle');
      t.setAttribute('fill', '#102'); t.setAttribute('stroke', '#fff'); t.setAttribute('stroke-width', String(Math.max(w, hh) * 0.02)); t.setAttribute('paint-order', 'stroke'); t.textContent = String(i + 1);
      svg.append(t);
    });
    return svg;
  }
  function showPoints(src) {
    pins.length = 0;
    const cv = document.createElement('canvas');
    const k = Math.min(1, 900 / Math.max(src.width, src.height));
    cv.width = Math.round(src.width * k); cv.height = Math.round(src.height * k);
    const full = document.createElement('canvas'); full.width = src.width; full.height = src.height;
    const id = full.getContext('2d').createImageData(src.width, src.height); id.data.set(src.data); full.getContext('2d').putImageData(id, 0, 0);
    cv.getContext('2d').drawImage(full, 0, 0, cv.width, cv.height);
    const pic = h('div', { class: 'as-pic', dataset: { ps: 'aerial-src-pic' } }, cv);
    const draw = () => {
      pic.querySelectorAll('.as-pin').forEach((n) => n.remove());
      pins.forEach((p, i) => {
        const pin = h('div', { class: 'as-pin', dataset: { pin: String(i + 1) }, 'aria-label': `Point ${i + 1}` }, String(i + 1));
        pin.style.left = `${(p.x / src.width) * 100}%`; pin.style.top = `${(p.y / src.height) * 100}%`;
        pin.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); pin.setPointerCapture(e.pointerId); pin.dataset.drag = '1'; });
        pin.addEventListener('pointermove', (e) => { if (pin.dataset.drag) { set(i, e); } });
        pin.addEventListener('pointerup', () => { delete pin.dataset.drag; });
        pic.append(pin);
      });
      fileBtn.disabled = pins.length < 2;
      hint.textContent = pins.length < 2 ? `Click the picture to place point ${pins.length + 1} on a lot corner you can recognise.` : 'Choose which lot corner each point is on, then press Use this picture. Drag a point to adjust it.';
    };
    const at = (e) => { const r = cv.getBoundingClientRect(); return { x: Math.max(0, Math.min(src.width, ((e.clientX - r.left) / r.width) * src.width)), y: Math.max(0, Math.min(src.height, ((e.clientY - r.top) / r.height) * src.height)) }; };
    const set = (i, e) => { pins[i] = at(e); draw(); };
    pic.addEventListener('pointerdown', (e) => { if (e.target.closest('.as-pin') || pins.length >= 2) return; pins.push(at(e)); draw(); });
    const hint = h('p', { class: 'as-note' });
    ptsHost.replaceChildren(h('div', null, pic, hint), h('div', { style: { display: 'grid', gap: '8px' } }, lotSvg(),
      h('label', { class: 'as-row' }, h('span', { class: 'as-note' }, 'Point 1 is on'), c1), h('label', { class: 'as-row' }, h('span', { class: 'as-note' }, 'Point 2 is on'), c2),
      h('button', { class: 'ps-btn ps-btn--sm', type: 'button', onclick: () => { pins.length = 0; draw(); } }, 'Reset points')));
    ptsHost.hidden = false;
    draw();
  }
  const pFile = h('div', { class: 'as-panel', dataset: { panel: 'file' }, hidden: true },
    h('p', { class: 'as-note' }, 'Your picture is read on this device and kept with this project in this browser. It is never uploaded to our server.'),
    h('p', { class: 'as-warn', dataset: { ps: 'aerial-src-rights' } }, 'You must hold the rights to this imagery. Exported and shared plans will include it, so check your licence allows that.'),
    fileIn, crsRow, fileNote, ptsHost, fileBtn);

  // Frame --------------------------------------------------------------------------------------------------------------
  const panels = { standard: pStd, nearmap: pNm, file: pFile };
  const radios = SOURCES.map(([id, text]) => h('label', null, h('input', { type: 'radio', name: 'as-src', value: id, checked: id === current, dataset: { ps: `aerial-src-${id}` }, onchange: () => show(id) }), text));
  function show(id) { Object.entries(panels).forEach(([k, p]) => { p.hidden = k !== id; }); say(''); }
  show(current);
  const shareWarn = h('p', { class: 'as-warn', dataset: { ps: 'aerial-src-sharewarn' }, hidden: current === 'standard' }, SHARE_WARNING);
  const body = h('div', { class: 'as-dlg', dataset: { ps: 'aerial-source-dialog' } },
    h('div', { class: 'as-seg', role: 'radiogroup', 'aria-label': 'Aerial source' }, ...radios),
    h('p', { class: 'as-note', dataset: { ps: 'aerial-src-licence' } }, LICENCE_NOTE),
    pStd, pNm, pFile, shareWarn, status);
  return openModal({ title: 'Aerial source', size: 'lg', body, footer: (c) => { close = c; return h('button', { class: 'ps-btn', type: 'button', onclick: () => c('done') }, 'Close'); } });
}
