// The "Upload boundary" dialog: a file (KML, KMZ, GeoJSON, zipped shapefile, DXF, CSV), pasted coordinates, or a bearings and distances
// entry; the coordinate system; one outline or several; a place by hand step; then the boundary becomes the lot (onApply).

import { h, clear } from '../../ui/dom.js';
import { openModal } from '../../ui/modal.js';
import { injectUploadCss } from './css.js';
import { readUpload, parseCoordinateText, UploadError } from './parsers.js';
import { searchCrs, resolveCrs, guessProjected, WGS84_ID } from './crs.js';
import { UNITS } from './units.js';
import { parseLegs, walkLegs, miscloseText, formatBearing } from './bearings.js';
import { toLonLatPolygons, lotResponseFromPolygons, ringAreaM2 } from './lot.js';
import { frameFor, frameToLonLat, lonLatToFrame } from './frame.js';
import { createPlaceMap, parseLatLon } from './place-map.js';
import { mapboxToken, NO_AERIAL_TEXT } from '../mapbox-aerial.js';

export const ACCEPT = '.kml,.kmz,.geojson,.json,.zip,.shp,.dbf,.prj,.shx,.dxf,.dwg,.csv,.txt';
export const FORMAT_CHIPS = ['KML', 'KMZ', 'GeoJSON', 'Shapefile (zip)', 'DXF', 'CSV'];
export const DWG_HELP = 'DWG files cannot be read here. In your CAD software choose Save As, pick DXF and upload that.';

const fmtArea = (m2) => (m2 >= 10000 ? `${(m2 / 10000).toFixed(2)} ha (${Math.round(m2).toLocaleString('en-AU')} m²)` : `${Math.round(m2).toLocaleString('en-AU')} m²`);

/** Draw rings (any units) fitted into a canvas. */
export function drawPreview(cv, rings) {
  const ctx = cv.getContext('2d');
  const W = cv.width;
  const H = cv.height;
  ctx.clearRect(0, 0, W, H);
  const pts = rings.flat();
  if (!pts.length) return;
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const minX = Math.min(...xs); const maxX = Math.max(...xs); const minY = Math.min(...ys); const maxY = Math.max(...ys);
  const s = Math.min((W - 20) / Math.max(maxX - minX, 1e-9), (H - 20) / Math.max(maxY - minY, 1e-9));
  const ox = (W - (maxX - minX) * s) / 2;
  const oy = (H - (maxY - minY) * s) / 2;
  ctx.lineWidth = 2;
  ctx.strokeStyle = '#ffc83d';
  ctx.fillStyle = 'rgba(255,200,61,.22)';
  for (const r of rings) {
    ctx.beginPath();
    r.forEach(([x, y], i) => { const px = ox + (x - minX) * s; const py = H - (oy + (y - minY) * s); if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py); });
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }
}

/**
 * openUploadDialog({ store, commercial, onApply, readers }) -> { close, el }
 * onApply(input, { onStep }) -> Promise: input is { polys (longitude, latitude), name, merge, customRules, forceMapbox }. It throws a readable
 * Error to keep the dialog open. `readers` is for tests (replaces readUpload).
 */
export function openUploadDialog({ store = null, commercial = false, onApply, readers = null } = {}) {
  injectUploadCss();
  const S = { tab: 'file', parsed: null, picked: new Set(), merge: false, crsId: null, crsText: '', crsMode: 'list', units: 'm', mode: 'crs', name: '', customRules: false, busy: false, view: 'form', result: null, error: '', hand: null };
  const reader = readers || readUpload;
  let modal = null;
  let placeMap = null;

  const root = h('div', { class: 'up-wrap', dataset: { ps: 'upload-dialog' } });
  const tabsEl = h('div', { class: 'up-tabs', role: 'tablist' });
  const inputArea = h('div');
  const reviewArea = h('div', { class: 'up-wrap', dataset: { ps: 'upload-review' } });
  const msg = h('div', { role: 'status', 'aria-live': 'polite' });
  root.append(tabsEl, inputArea, msg, reviewArea);

  const say = (text, kind = 'warn') => { clear(msg); if (text) msg.append(h('p', { class: kind === 'err' ? 'up-err' : kind === 'ok' ? 'up-ok' : 'up-warn' }, text)); };

  // Tabs ---------------------------------------------------------------------------------------------------------------------------
  const TABS = [['file', 'Upload a file'], ['paste', 'Paste coordinates'], ['bearings', 'Bearings and distances']];
  function paintTabs() {
    clear(tabsEl);
    for (const [id, label] of TABS) tabsEl.append(h('button', { class: 'up-tab', type: 'button', role: 'tab', 'aria-selected': String(S.tab === id), dataset: { tab: id }, onclick: () => { S.tab = id; say(''); paintTabs(); paintInput(); } }, label));
  }

  // File tab -----------------------------------------------------------------------------------------------------------------------
  const fileInput = h('input', { type: 'file', accept: ACCEPT, multiple: true, hidden: true, 'aria-label': 'Choose a boundary file', dataset: { ps: 'upload-file' } });
  fileInput.addEventListener('change', () => { if (fileInput.files?.length) onFiles([...fileInput.files]); fileInput.value = ''; });
  async function onFiles(files) {
    say('');
    try {
      const bytes = await Promise.all(files.map(async (f) => ({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) })));
      setParsed(reader(bytes), files[0].name);
    } catch (e) {
      S.parsed = null; S.result = null; paintReview();
      say(e instanceof UploadError || e?.message ? e.message : 'That file could not be read.', 'err');
    }
  }
  function fileTab() {
    const drop = h('div', { class: 'up-drop', tabindex: '0', role: 'button', 'aria-label': 'Choose a file or drop it here', dataset: { ps: 'upload-drop' }, onclick: () => fileInput.click(), onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); } } },
      h('b', null, 'Drop a boundary file here, or click to choose'),
      h('div', { class: 'up-formats' }, ...FORMAT_CHIPS.map((c) => h('span', null, c))),
      h('p', { class: 'up-hint' }, 'A shapefile needs its .shp, .dbf and .prj files together (select them all), or one zip. ' + DWG_HELP));
    drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('is-over'); });
    drop.addEventListener('dragleave', () => drop.classList.remove('is-over'));
    drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('is-over'); if (e.dataTransfer?.files?.length) onFiles([...e.dataTransfer.files]); });
    return h('div', { class: 'up-wrap' }, drop, fileInput, h('p', { class: 'up-hint' }, 'Files stay in your browser. They are not uploaded anywhere.'));
  }

  // Paste tab ----------------------------------------------------------------------------------------------------------------------
  function pasteTab() {
    const ta = h('textarea', { class: 'ps-input up-ta', placeholder: 'One point per line, around the boundary.\n-36.9000, 174.8100\n-36.9000, 174.8110\n-36.9010, 174.8110\n-36.9010, 174.8100\n\nor easting, northing in metres:\n340000.00, 6250000.00', 'aria-label': 'Coordinates', spellcheck: 'false', dataset: { ps: 'upload-paste' } });
    ta.addEventListener('keydown', (e) => e.stopPropagation());
    const order = h('select', { class: 'ps-input', 'aria-label': 'Order of the numbers' },
      h('option', { value: 'auto' }, 'Order: detect (latitude then longitude, or easting then northing)'),
      h('option', { value: 'latlon' }, 'Latitude, longitude'), h('option', { value: 'lonlat' }, 'Longitude, latitude'), h('option', { value: 'en' }, 'Easting, northing (a coordinate system is chosen next)'));
    const go = h('button', { class: 'ps-btn ps-btn--primary', type: 'button', dataset: { ps: 'upload-paste-go' }, onclick: () => {
      try { say(''); setParsed(parseCoordinateText(ta.value, { order: order.value }), 'Pasted boundary'); } catch (e) { S.parsed = null; S.result = null; paintReview(); say(e.message, 'err'); }
    } }, 'Read these points');
    return h('div', { class: 'up-wrap' }, ta, h('div', { class: 'up-row' }, order, go), h('p', { class: 'up-hint' }, 'Latitude and longitude in decimal degrees (WGS 84, GDA2020 or GDA94 degrees), or easting and northing in metres. Spreadsheet columns with a header row (lat, lon, easting, northing) also work.'));
  }

  // Bearings tab -------------------------------------------------------------------------------------------------------------------
  const B = { startMode: 'latlon', start: '', legs: '', dotted: true, adjust: 'none' };
  function bearingsTab() {
    const mode = h('select', { class: 'ps-input', 'aria-label': 'Start point type' },
      h('option', { value: 'latlon' }, 'Start point: latitude, longitude'), h('option', { value: 'en' }, 'Start point: easting, northing (choose the coordinate system next)'), h('option', { value: 'hand' }, 'No start point: place it by hand on the aerial'));
    mode.value = B.startMode;
    const start = h('input', { type: 'text', class: 'ps-input', placeholder: B.startMode === 'en' ? '340000.00, 6250000.00' : '-36.9000, 174.8100', 'aria-label': 'Start point', value: B.start, dataset: { ps: 'bearings-start' } });
    const legs = h('textarea', { class: 'ps-input up-ta', placeholder: 'One leg per line: bearing, distance in metres\nN 45°30\'00" E  25.40\n135°00\'00"  60.00\nS 12-30-00 W  40.20', 'aria-label': 'Bearings and distances', spellcheck: 'false', dataset: { ps: 'bearings-legs' } });
    legs.value = B.legs;
    const dotted = h('input', { type: 'checkbox', checked: B.dotted });
    const adjust = h('select', { class: 'ps-input', 'aria-label': 'Misclose handling' }, h('option', { value: 'none' }, 'Close with a straight line (no adjustment)'), h('option', { value: 'bowditch' }, 'Spread the misclose over the legs (Bowditch)'));
    adjust.value = B.adjust;
    const out = h('div', { dataset: { ps: 'bearings-out' } });
    const run = () => {
      B.startMode = mode.value; B.start = start.value; B.legs = legs.value; B.dotted = dotted.checked; B.adjust = adjust.value;
      start.placeholder = B.startMode === 'en' ? '340000.00, 6250000.00' : '-36.9000, 174.8100';
      start.hidden = B.startMode === 'hand';
      clear(out);
      const { legs: ls, errors } = parseLegs(B.legs, { dotted: B.dotted });
      for (const er of errors) out.append(h('p', { class: 'up-err' }, `Line ${er.line}: ${er.reason}`));
      if (ls.length < 3) { if (B.legs.trim()) out.append(h('p', { class: 'up-hint' }, 'Enter at least three legs.')); S.parsed = null; S.result = null; paintReview(); return; }
      let s = { e: 0, n: 0 };
      let ll = null;
      if (B.startMode === 'latlon') { ll = parseLatLon(B.start); if (!ll) { out.append(h('p', { class: 'up-hint' }, 'Enter the start point as latitude, longitude.')); S.parsed = null; S.result = null; paintReview(); return; } }
      if (B.startMode === 'en') { const m = /^\s*(-?\d+(?:\.\d+)?)\s*[,;\s]\s*(-?\d+(?:\.\d+)?)\s*$/.exec(B.start); if (!m) { out.append(h('p', { class: 'up-hint' }, 'Enter the start point as easting, northing in metres.')); S.parsed = null; S.result = null; paintReview(); return; } s = { e: Number(m[1]), n: Number(m[2]) }; }
      let frame = null;
      if (ll) { frame = frameFor(ll.lon, ll.lat, { forceLocal: true }); const o = lonLatToFrame(frame, ll.lon, ll.lat); s = { e: o.e, n: o.n }; }
      const w = walkLegs(s, ls, { adjust: B.adjust });
      out.append(
        h('p', { class: w.misclose.distance < 0.05 ? 'up-ok' : 'up-warn', dataset: { ps: 'bearings-misclose' } }, `${miscloseText(w.misclose)}. Perimeter ${w.perimeter.toFixed(2)} m${w.misclose.distance > 1e-6 ? `, closing line ${w.misclose.distance.toFixed(3)} m at ${formatBearing(w.misclose.bearing)}` : ''}.`),
        h('table', { class: 'up-table' }, h('thead', null, h('tr', null, h('th', null, '#'), h('th', null, 'Bearing'), h('th', null, 'Distance (m)'))), h('tbody', null, ...ls.map((l, i) => h('tr', null, h('td', null, i + 1), h('td', null, formatBearing(l.bearing)), h('td', null, l.distance.toFixed(3)))))));
      const ring = w.ring.map((p) => [p.e, p.n]);
      const poly = { name: 'Bearings and distances', ring, holes: [] };
      if (ll) {
        const lonlat = ring.map(([e, n]) => { const q = frameToLonLat(frame, e, n); return [q.lon, q.lat]; });
        setParsed({ format: 'Bearings and distances', polygons: [{ ...poly, ring: lonlat }], coordKind: 'lonlat', crs: WGS84_ID, needsCrs: false, warnings: [] }, 'Bearings and distances', { keepInput: true });
      } else if (B.startMode === 'en') setParsed({ format: 'Bearings and distances', polygons: [poly], coordKind: 'xy', crs: null, needsCrs: true, warnings: ['The bearings are taken as grid bearings in the coordinate system you choose.'] }, 'Bearings and distances', { keepInput: true });
      else { S.mode = 'hand'; setParsed({ format: 'Bearings and distances', polygons: [poly], coordKind: 'xy', crs: null, needsCrs: false, warnings: [] }, 'Bearings and distances', { keepInput: true, hand: true }); }
    };
    for (const el of [mode, start, legs, dotted, adjust]) el.addEventListener(el.tagName === 'TEXTAREA' || el.type === 'text' ? 'input' : 'change', run);
    for (const el of [start, legs]) el.addEventListener('keydown', (e) => e.stopPropagation());
    queueMicrotask(run);
    return h('div', { class: 'up-wrap' }, h('div', { class: 'up-row' }, mode, start), legs,
      h('label', { class: 'up-row' }, dotted, h('span', { class: 'up-lbl' }, 'A bare number like 45.3015 means 45°30\'15" (survey plan style). Untick for decimal degrees.')), h('div', { class: 'up-row' }, adjust), out);
  }

  function paintInput() { clear(inputArea); inputArea.append(S.tab === 'file' ? fileTab() : S.tab === 'paste' ? pasteTab() : bearingsTab()); if (S.tab !== 'bearings') { /* keep the last parse on screen */ } }

  // The review section ---------------------------------------------------------------------------------------------------------------
  const crsSearch = h('input', { type: 'search', class: 'ps-input', placeholder: 'Search: MGA 56, UTM 32N, 7856, GDA94', 'aria-label': 'Search coordinate systems', dataset: { ps: 'crs-search' } });
  crsSearch.addEventListener('keydown', (e) => e.stopPropagation());
  const crsList = h('div', { class: 'up-crs', role: 'listbox', 'aria-label': 'Coordinate systems', dataset: { ps: 'crs-list' } });
  const crsCustom = h('textarea', { class: 'ps-input up-ta', style: { minHeight: '64px' }, placeholder: '+proj=utm +zone=56 +south +ellps=GRS80 +units=m +no_defs   (or the text of a .prj file)', 'aria-label': 'Custom proj4 string', spellcheck: 'false', dataset: { ps: 'crs-custom' } });
  crsCustom.addEventListener('keydown', (e) => e.stopPropagation());
  const nameIn = h('input', { type: 'text', class: 'ps-input', placeholder: 'Name for this lot', 'aria-label': 'Lot name', maxlength: '60', dataset: { ps: 'upload-name' } });
  nameIn.addEventListener('keydown', (e) => e.stopPropagation());
  nameIn.addEventListener('input', () => { S.name = nameIn.value; });
  const paintCrsList = () => {
    clear(crsList);
    const hits = searchCrs(crsSearch.value, 60);
    if (!hits.length) crsList.append(h('p', { class: 'up-hint', style: { padding: '6px 10px' } }, 'No match. Use a custom proj4 string below.'));
    for (const c of hits) crsList.append(h('button', { type: 'button', role: 'option', 'aria-selected': String(S.crsId === c.id), dataset: { crs: c.id }, onclick: () => { S.crsId = c.id; S.crsMode = 'list'; paintCrsList(); refresh(); } }, c.label));
  };
  crsSearch.addEventListener('input', paintCrsList);
  crsCustom.addEventListener('input', () => { S.crsText = crsCustom.value; S.crsMode = 'custom'; refresh(); });

  function setParsed(parsed, fileName = '', { keepInput = false, hand = false } = {}) {
    S.parsed = parsed;
    S.picked = new Set(parsed.polygons.length ? [0] : []);
    S.merge = false;
    if (!hand) S.mode = 'crs';
    S.units = parsed.units && UNITS.some((u) => u.id === parsed.units) ? parsed.units : 'm';
    S.name = parsed.polygons.length === 1 ? parsed.polygons[0].name || '' : '';
    nameIn.value = S.name;
    S.crsId = typeof parsed.crs === 'string' ? parsed.crs : S.crsId;
    if (parsed.crs && typeof parsed.crs === 'object') { S.crsText = parsed.crs.wkt || parsed.crs.proj4 || ''; S.crsMode = 'custom'; crsCustom.value = S.crsText; }
    if (parsed.coordKind === 'xy' && !S.crsId && !hand) {
      const sample = parsed.polygons[0]?.ring?.[0];
      const g = sample ? guessProjected(sample[0], sample[1]) : null;
      S.crsId = g && g !== WGS84_ID ? g : null;
    }
    paintCrsList();
    if (!parsed.polygons.length) { say(`No closed outline was found in that ${parsed.format || 'file'}. ${parsed.warnings?.[0] || 'Check that the boundary is a closed shape.'}`, 'err'); S.result = null; paintReview(); return; }
    if (!keepInput) say('');
    refresh();
  }

  function selectedPolys() { return [...S.picked].sort((a, b) => a - b).map((i) => S.parsed.polygons[i]).filter(Boolean); }

  function refresh() {
    S.result = null; S.error = '';
    const parsed = S.parsed;
    if (!parsed) { paintReview(); return; }
    const polys = selectedPolys();
    if (!polys.length) { S.error = 'Tick at least one outline.'; paintReview(); return; }
    try {
      let ll;
      if (S.mode === 'hand') {
        if (!S.hand) S.hand = { lon: 151.2093, lat: -33.8688 };
        S.result = { hand: true, polys };
      } else {
        const crs = parsed.coordKind === 'lonlat' ? WGS84_ID : S.crsMode === 'custom' ? (S.crsText.trim() ? { proj4: S.crsText.trim() } : null) : S.crsId;
        ll = toLonLatPolygons(polys, parsed, { crs, units: S.units });
        const built = lotResponseFromPolygons({ polys: ll.polys, name: S.name, merge: S.merge && polys.length > 1 });
        S.result = { built, polys: ll.polys, warnings: [...ll.warnings, ...built.warnings] };
      }
    } catch (e) { S.error = e?.message || 'That outline could not be used.'; }
    paintReview();
  }

  function paintReview() {
    clear(reviewArea);
    const parsed = S.parsed;
    if (!parsed) return;
    const xy = parsed.coordKind === 'xy';
    reviewArea.append(h('h3', { class: 'up-lbl', style: { margin: 0 } }, `${parsed.format}: ${parsed.polygons.length} outline${parsed.polygons.length === 1 ? '' : 's'} found`));
    for (const w of parsed.warnings || []) reviewArea.append(h('p', { class: 'up-warn' }, w));
    if (parsed.polygons.length > 1) {
      const items = parsed.polygons.map((p, i) => {
        const a = ringAreaM2(p.ring);
        const ck = h('input', { type: S.merge ? 'checkbox' : 'radio', name: 'up-poly', checked: S.picked.has(i), dataset: { poly: i } });
        ck.addEventListener('change', () => { if (S.merge) { ck.checked ? S.picked.add(i) : S.picked.delete(i); } else S.picked = new Set([i]); refresh(); });
        const approx = xy ? '' : `about ${fmtArea(approxAreaLL(p.ring))}`;
        return h('label', { class: 'up-item' }, ck, h('span', null, p.name || `Outline ${i + 1}`), h('small', null, xy ? `${a.toLocaleString('en-AU', { maximumFractionDigits: 0 })} sq units` : approx));
      });
      reviewArea.append(h('div', { class: 'up-sec' }, h('h3', null, 'Which outline is the lot?'), h('div', { class: 'up-list' }, ...items),
        h('label', { class: 'up-row' }, h('input', { type: 'checkbox', checked: S.merge, dataset: { ps: 'upload-merge' }, onchange: (e) => { S.merge = e.target.checked; if (!S.merge) S.picked = new Set([[...S.picked][0] ?? 0]); else S.picked = new Set(parsed.polygons.map((_, i) => i)); refresh(); paintReview(); } }), h('span', { class: 'up-lbl' }, 'Join the outlines that touch into one lot (pick the ones to join)'))));
    }
    if (xy) {
      const modeBtns = h('div', { class: 'up-row' },
        h('label', { class: 'up-row' }, h('input', { type: 'radio', name: 'up-mode', checked: S.mode === 'crs', dataset: { ps: 'mode-crs' }, onchange: () => { S.mode = 'crs'; refresh(); } }), h('span', null, 'Use a coordinate system')),
        h('label', { class: 'up-row' }, h('input', { type: 'radio', name: 'up-mode', checked: S.mode === 'hand', dataset: { ps: 'mode-hand' }, onchange: () => { S.mode = 'hand'; refresh(); } }), h('span', null, 'Place it by hand on the aerial')));
      const unitSel = h('select', { class: 'ps-input', 'aria-label': 'File units', dataset: { ps: 'upload-units' }, onchange: (e) => { S.units = e.target.value; refresh(); } }, ...UNITS.map((u) => h('option', { value: u.id }, u.label)));
      unitSel.value = S.units;
      const sec = h('div', { class: 'up-sec' }, h('h3', null, 'Where are these coordinates?'), modeBtns, h('div', { class: 'up-row' }, h('span', { class: 'up-lbl' }, 'Units in the file'), unitSel));
      if (S.mode === 'crs') {
        sec.append(crsSearch, crsList, h('details', { open: S.crsMode === 'custom' }, h('summary', { class: 'up-lbl' }, 'Custom proj4 string or .prj text'), crsCustom));
        if (S.crsMode === 'list' && S.crsId) sec.append(h('p', { class: 'up-hint' }, `Using ${resolveCrs(S.crsId).label}.`));
      } else sec.append(h('p', { class: 'up-hint' }, 'The outline keeps its true size from the file units. You drag it into position and turn it on the next step. Choose the units carefully: millimetres, metres and feet are very different sizes.'));
      reviewArea.append(sec);
    }
    reviewArea.append(h('div', { class: 'up-sec' }, h('h3', null, 'Lot'), nameIn));
    if (S.error) reviewArea.append(h('p', { class: 'up-err', dataset: { ps: 'upload-error' } }, S.error));
    const r = S.result;
    if (r && !r.hand) {
      const b = r.built;
      const where = b.frame.kind === 'mga' ? `Inside ${b.frame.state === 'NSW' ? 'NSW' : 'Queensland'}: the state imagery is used.` : (mapboxToken() ? 'Outside NSW and Queensland: Mapbox Satellite is used for the aerial and you set the site rules.' : `Outside NSW and Queensland. ${NO_AERIAL_TEXT}, a plain grey ground is shown. You set the site rules.`);
      reviewArea.append(h('div', { class: 'up-sec', dataset: { ps: 'upload-summary' } }, h('h3', null, 'Result'), h('p', { class: 'up-ok', style: { margin: 0 } }, `Area ${fmtArea(b.resp.lot.areaM2)}, ${r.polys.length === 1 ? b.resp.lot.polygons[0].outer.length : 'several'} corners. ${where}`),
        h('canvas', { class: 'up-prev', width: 600, height: 150, dataset: { ps: 'upload-preview' } })));
      for (const w of r.warnings || []) reviewArea.append(h('p', { class: 'up-warn' }, w));
      if (b.frame.kind === 'mga') reviewArea.append(h('label', { class: 'up-row' }, h('input', { type: 'checkbox', checked: S.customRules, dataset: { ps: 'upload-custom' }, onchange: (e) => { S.customRules = e.target.checked; } }), h('span', { class: 'up-lbl' }, 'Use custom rules (no council lookup)')));
      requestAnimationFrame(() => { const cv = reviewArea.querySelector('canvas.up-prev'); if (cv) drawPreview(cv, b.resp.lot.polygons.map((p) => p.outer)); });
    } else if (r?.hand) {
      const rings = r.polys.map((p) => p.ring);
      reviewArea.append(h('div', { class: 'up-sec' }, h('h3', null, 'Preview (file units)'), h('canvas', { class: 'up-prev', width: 600, height: 150 })));
      requestAnimationFrame(() => { const cv = reviewArea.querySelector('canvas.up-prev'); if (cv) drawPreview(cv, rings); });
    }
    updateFooter();
  }

  const approxAreaLL = (ring) => { const lat = ring.reduce((s, p) => s + p[1], 0) / ring.length; const kx = 111320 * Math.cos((lat * Math.PI) / 180); const ky = 110574; return ringAreaM2(ring.map(([x, y]) => [x * kx, y * ky])); };

  // Footer and the final step -----------------------------------------------------------------------------------------------------
  const cancelBtn = h('button', { class: 'ps-btn', type: 'button', onclick: () => modal.close('cancel') }, 'Cancel');
  const useBtn = h('button', { class: 'ps-btn ps-btn--primary', type: 'button', disabled: true, dataset: { ps: 'upload-use' }, onclick: () => use() }, 'Use this boundary');
  const backBtn = h('button', { class: 'ps-btn', type: 'button', hidden: true, onclick: () => { S.view = 'form'; showForm(); } }, 'Back');
  function updateFooter() {
    useBtn.disabled = S.busy || !(S.result && (S.result.hand || S.result.built));
    useBtn.textContent = S.view === 'place' ? 'Use this position' : S.result?.hand ? 'Next: place it on the aerial' : 'Use this boundary';
  }
  function showForm() {
    root.hidden = false; placeHost.hidden = true; backBtn.hidden = true; placeMap?.destroy(); placeMap = null; clear(placeHost); updateFooter();
  }
  const placeHost = h('div', { hidden: true, dataset: { ps: 'upload-place' } });

  async function use() {
    if (S.busy) return;
    const r = S.result;
    if (!r) return;
    if (r.hand && S.view !== 'place') {
      S.view = 'place';
      root.hidden = true; placeHost.hidden = false; backBtn.hidden = false;
      clear(placeHost);
      const start = S.hand || { lon: 151.2093, lat: -33.8688 };
      placeMap = createPlaceMap({ rings: r.polys.map((p) => p.ring), units: S.units, start, token: mapboxToken(), onChange: (p) => { S.hand = { lon: p.lon, lat: p.lat }; } });
      placeHost.append(h('p', { class: 'up-hint' }, 'Go to the site, then drag the outline over the lot and turn it to match. The size is fixed from the file units.'), placeMap.el);
      updateFooter();
      return;
    }
    let polys;
    let merge = false;
    try {
      if (r.hand) {
        const pl = placeMap.placement();
        polys = toLonLatPolygons(r.polys, S.parsed, { placement: { lon: pl.lon, lat: pl.lat, rotationDeg: pl.rotationDeg }, units: S.units }).polys;
        merge = S.merge;
      } else { polys = r.polys; merge = S.merge && r.polys.length > 1; }
    } catch (e) { say(e.message, 'err'); return; }
    S.busy = true; useBtn.disabled = true; useBtn.textContent = 'Working';
    try {
      await onApply({ polys, name: S.name, merge, customRules: S.customRules, forceMapbox: false }, { onStep: (s) => { useBtn.textContent = s === 'aerial' ? 'Loading the aerial' : 'Working'; } });
      modal.close('done');
    } catch (e) {
      if (S.view === 'place') { S.view = 'form'; showForm(); }
      say(e?.message || 'The boundary could not be used.', 'err');
    } finally { S.busy = false; updateFooter(); }
  }

  paintTabs();
  paintInput();
  modal = openModal({
    title: 'Upload boundary',
    size: 'lg',
    body: h('div', null,
      h('p', { class: 'up-hint', style: { marginBottom: '8px' } }, `Use your own lot boundary, in Australia or anywhere in the world. ${commercial ? 'Units' : 'The house'} and the checks work on it like any other lot. The boundary is shown as supplied by you and is not checked against title.`),
      root, placeHost),
    footer: () => [backBtn, cancelBtn, useBtn],
    onClose: () => { placeMap?.destroy(); },
  });
  return modal;
}

