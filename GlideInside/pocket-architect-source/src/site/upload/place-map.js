// "Place it by hand": the outline over the aerial, drag it into position and turn it. The scale is fixed from the file units (the outline is
// never stretched). A small slippy map: drag the background to pan, the wheel or the buttons to zoom, drag the outline to move it.
// Without a Mapbox token the ground is plain grey with a grid and the words "Aerial not available for this location".

import { h } from '../../ui/dom.js';
import { tileUrl, mapboxToken, MAPBOX_ATTRIBUTION, NO_AERIAL_TEXT } from '../mapbox-aerial.js';
import { unitFactor } from './units.js';

const RAD = Math.PI / 180;
const TILE = 256;
export const mercator = (lon, lat, z) => {
  const n = TILE * 2 ** z;
  const s = Math.sin(lat * RAD);
  return { x: ((lon + 180) / 360) * n, y: (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n };
};
export const unmercator = (x, y, z) => {
  const n = TILE * 2 ** z;
  const lon = (x / n) * 360 - 180;
  const lat = (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n))) * 180) / Math.PI;
  return { lon, lat };
};
export const groundRes = (z, lat) => (156543.03392 * Math.cos(lat * RAD)) / 2 ** z; // metres per pixel on a 256 pixel tile

/** Parse "lat, lon" (or "lat lon") text. Returns { lat, lon } or null. */
export function parseLatLon(text) {
  const m = /^\s*(-?\d+(?:\.\d+)?)\s*[,;\s]\s*(-?\d+(?:\.\d+)?)\s*$/.exec(String(text || ''));
  if (!m) return null;
  const lat = Number(m[1]);
  const lon = Number(m[2]);
  return Math.abs(lat) <= 85 && Math.abs(lon) <= 180 ? { lat, lon } : null;
}

/** Outline points (metres east, north) about its own middle for rings in file units. */
export function outlineMetres(rings, units) {
  const f = unitFactor(units);
  const all = rings.flat();
  const cx = all.reduce((s, q) => s + q[0], 0) / all.length;
  const cy = all.reduce((s, q) => s + q[1], 0) / all.length;
  return rings.map((r) => r.map(([x, y]) => [(x - cx) * f, (y - cy) * f]));
}

/**
 * createPlaceMap({ rings, units, start: { lon, lat }, token, onChange, fetchImpl }) -> { el, placement(), setUnits(u), setStart(ll), destroy() }
 * placement(): { lon, lat, rotationDeg }.
 */
export function createPlaceMap({ rings, units = 'm', start = { lon: 151.2093, lat: -33.8688 }, token = mapboxToken(), onChange = null, fetchImpl = globalThis.fetch } = {}) {
  let u = units;
  let metres = outlineMetres(rings, u);
  const size = Math.max(...metres.flat().map((p) => Math.hypot(p[0], p[1])), 1) * 2;
  const W = 640;
  const H = 380;
  let z = 17;
  const pickZoom = (lat) => { for (let k = 20; k >= 3; k--) if (size / groundRes(k, lat) <= H * 0.55) return k; return 3; };
  z = pickZoom(start.lat);
  const place = { lon: start.lon, lat: start.lat, rot: 0 };
  let centre = { lon: start.lon, lat: start.lat };
  const cv = h('canvas', { class: 'up-map-cv', width: W, height: H, tabindex: '0', 'aria-label': 'Map with the outline. Drag the outline to move it.' });
  const ctx = cv.getContext('2d');
  const tiles = new Map(); // memory only, this dialog
  const wantRedraw = () => requestAnimationFrame(draw);
  const note = h('div', { class: 'up-map-note', role: 'status' });
  const getTile = (zz, x, y) => {
    const key = `${zz}/${x}/${y}`;
    if (tiles.has(key)) return tiles.get(key);
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = wantRedraw;
    img.onerror = () => { note.textContent = 'Some aerial tiles did not load.'; };
    img.src = tileUrl(zz, x, y, token);
    tiles.set(key, img);
    return img;
  };
  const toScreen = (lon, lat) => { const c = mercator(centre.lon, centre.lat, z); const p = mercator(lon, lat, z); return { x: W / 2 + (p.x - c.x), y: H / 2 + (p.y - c.y) }; };
  const toLonLat = (sx, sy) => { const c = mercator(centre.lon, centre.lat, z); return unmercator(c.x + (sx - W / 2), c.y + (sy - H / 2), z); };
  const ringScreen = (ring) => {
    const mpp = groundRes(z, place.lat);
    const c = toScreen(place.lon, place.lat);
    const th = place.rot * RAD;
    return ring.map(([e, n]) => {
      const x = e * Math.cos(th) + n * Math.sin(th);
      const y = -e * Math.sin(th) + n * Math.cos(th);
      return { x: c.x + x / mpp, y: c.y - y / mpp };
    });
  };
  function draw() {
    ctx.fillStyle = '#8b8e92';
    ctx.fillRect(0, 0, W, H);
    let drewTiles = false;
    if (token) {
      const c = mercator(centre.lon, centre.lat, z);
      const x0 = Math.floor((c.x - W / 2) / TILE);
      const x1 = Math.floor((c.x + W / 2) / TILE);
      const y0 = Math.floor((c.y - H / 2) / TILE);
      const y1 = Math.floor((c.y + H / 2) / TILE);
      const n = 2 ** z;
      for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) {
        if (ty < 0 || ty >= n) continue;
        const img = getTile(z, ((tx % n) + n) % n, ty);
        if (img.complete && img.naturalWidth) { ctx.drawImage(img, W / 2 + tx * TILE - c.x, H / 2 + ty * TILE - c.y, TILE, TILE); drewTiles = true; }
      }
    } else {
      ctx.strokeStyle = 'rgba(255,255,255,.18)';
      ctx.lineWidth = 1;
      for (let x = 0; x < W; x += 40) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
      for (let y = 0; y < H; y += 40) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
    }
    ctx.fillStyle = 'rgba(255,255,255,.9)';
    ctx.font = '12px system-ui, sans-serif';
    ctx.textAlign = 'right';
    if (drewTiles) ctx.fillText(MAPBOX_ATTRIBUTION, W - 8, H - 8);
    else if (!token) { ctx.textAlign = 'center'; ctx.fillText(NO_AERIAL_TEXT, W / 2, 20); ctx.textAlign = 'right'; }
    // Scale bar
    const mpp = groundRes(z, place.lat);
    const nice = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000].reduce((b, v) => (v / mpp <= 140 ? v : b), 1);
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(10, H - 14); ctx.lineTo(10 + nice / mpp, H - 14); ctx.stroke();
    ctx.textAlign = 'left'; ctx.fillText(`${nice} m`, 10, H - 20);
    // Outline
    for (const ring of metres) {
      const pts = ringScreen(ring);
      ctx.beginPath();
      pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
      ctx.closePath();
      ctx.fillStyle = 'rgba(255, 200, 61, .22)';
      ctx.fill();
      ctx.strokeStyle = '#ffc83d';
      ctx.lineWidth = 2.5;
      ctx.stroke();
    }
  }
  const inside = (sx, sy) => metres.some((ring) => { const pts = ringScreen(ring); let c = false; for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) { if (pts[i].y > sy !== pts[j].y > sy && sx < ((pts[j].x - pts[i].x) * (sy - pts[i].y)) / (pts[j].y - pts[i].y) + pts[i].x) c = !c; } return c; });
  let drag = null;
  const pos = (e) => { const r = cv.getBoundingClientRect(); return { x: ((e.clientX - r.left) / r.width) * W, y: ((e.clientY - r.top) / r.height) * H }; };
  cv.addEventListener('pointerdown', (e) => {
    const p = pos(e);
    drag = { mode: inside(p.x, p.y) ? 'outline' : 'pan', x: p.x, y: p.y };
    cv.setPointerCapture(e.pointerId);
    cv.style.cursor = drag.mode === 'outline' ? 'move' : 'grabbing';
  });
  cv.addEventListener('pointermove', (e) => {
    const p = pos(e);
    if (!drag) { cv.style.cursor = inside(p.x, p.y) ? 'move' : 'grab'; return; }
    const dx = p.x - drag.x;
    const dy = p.y - drag.y;
    drag.x = p.x; drag.y = p.y;
    if (drag.mode === 'outline') {
      const s = toScreen(place.lon, place.lat);
      const ll = toLonLat(s.x + dx, s.y + dy);
      place.lon = ll.lon; place.lat = ll.lat;
      changed();
    } else {
      const c = mercator(centre.lon, centre.lat, z);
      centre = unmercator(c.x - dx, c.y - dy, z);
    }
    wantRedraw();
  });
  const end = () => { drag = null; cv.style.cursor = 'grab'; };
  cv.addEventListener('pointerup', end);
  cv.addEventListener('pointercancel', end);
  cv.addEventListener('wheel', (e) => { e.preventDefault(); zoomBy(e.deltaY < 0 ? 1 : -1); }, { passive: false });
  function zoomBy(d) { z = Math.max(2, Math.min(20, z + d)); wantRedraw(); }
  function changed() { onChange?.({ lon: place.lon, lat: place.lat, rotationDeg: place.rot }); coords.textContent = `${place.lat.toFixed(6)}, ${place.lon.toFixed(6)}`; }
  const coords = h('span', { class: 'up-map-coords' });
  const rot = h('input', { type: 'range', min: '-180', max: '180', step: '0.1', value: '0', 'aria-label': 'Rotate the outline' });
  const rotNum = h('input', { type: 'number', class: 'ps-input up-num', min: '-180', max: '180', step: '0.1', value: '0', 'aria-label': 'Rotation in degrees clockwise' });
  const setRot = (v) => { place.rot = Math.max(-180, Math.min(180, Number(v) || 0)); rot.value = String(place.rot); rotNum.value = String(Math.round(place.rot * 10) / 10); changed(); wantRedraw(); };
  rot.addEventListener('input', () => setRot(rot.value));
  rotNum.addEventListener('change', () => setRot(rotNum.value));
  const go = h('input', { type: 'text', class: 'ps-input', placeholder: token ? 'Go to: lat, lon or a place name' : 'Go to: lat, lon (for example -36.85, 174.76)', 'aria-label': 'Go to a place', maxlength: '120' });
  const goBtn = h('button', { class: 'ps-btn', type: 'button', onclick: () => goTo() }, 'Go');
  async function goTo() {
    const q = go.value.trim();
    if (!q) return;
    const ll = parseLatLon(q);
    if (ll) { jump(ll); note.textContent = ''; return; }
    if (!token || typeof fetchImpl !== 'function') { note.textContent = 'Type latitude and longitude, for example -36.85, 174.76.'; return; }
    note.textContent = 'Searching';
    try {
      const r = await fetchImpl(`https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(q)}.json?limit=1&access_token=${encodeURIComponent(token)}`);
      const j = r.ok ? await r.json() : null;
      const c = j?.features?.[0]?.center;
      if (c) { jump({ lon: c[0], lat: c[1] }); note.textContent = ''; } else note.textContent = 'No place found. Try latitude and longitude.';
    } catch { note.textContent = 'The place search could not be reached.'; }
  }
  go.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') { e.preventDefault(); goTo(); } });
  function jump(ll) { centre = { ...ll }; place.lon = ll.lon; place.lat = ll.lat; z = pickZoom(ll.lat); changed(); wantRedraw(); }
  const zin = h('button', { class: 'ps-btn up-zoom', type: 'button', 'aria-label': 'Zoom in', onclick: () => zoomBy(1) }, '+');
  const zout = h('button', { class: 'ps-btn up-zoom', type: 'button', 'aria-label': 'Zoom out', onclick: () => zoomBy(-1) }, '−');
  const el = h('div', { class: 'up-map' },
    h('div', { class: 'up-map-bar' }, go, goBtn),
    h('div', { class: 'up-map-wrap' }, cv, h('div', { class: 'up-map-zoom' }, zin, zout)),
    h('div', { class: 'up-map-bar' }, h('label', { class: 'up-lbl' }, 'Rotate (degrees clockwise)'), rot, rotNum),
    h('div', { class: 'up-map-bar up-map-foot' }, coords, note));
  changed();
  wantRedraw();
  return {
    el,
    placement: () => ({ lon: place.lon, lat: place.lat, rotationDeg: place.rot }),
    setUnits(nu) { u = nu; metres = outlineMetres(rings, u); wantRedraw(); },
    setStart(ll) { jump(ll); },
    destroy() { tiles.clear(); },
  };
}
