// The enlarged TOP VIEW: opened from the mini map at the bottom right of the lot card (housing and commercial). A large, vector plan of the lot
// (boundary, setback line, house or units and buildings, parking, north arrow, scale bar) that zooms (wheel, pinch, buttons, keys) and pans
// (drag, arrow keys). It is drawn as SVG from the same project data as the mini map, so it stays sharp at any zoom, and it redraws when the
// layout or design changes while it is open.
//
// The pure parts (scene builders, view maths, SVG text) have no DOM, so they are unit tested in node (tests/topview.test.mjs).
// createTopView() is the dialog: role="dialog" aria-modal, focus moves in and returns to the button that opened it, Escape closes.

import { h } from '../ui/dom.js';
import { snapMove, moveWarnings, turnRing, shiftRing, boxCentre, inside, turnSnap } from './topview-move.js';
import { lotOf, houseCentre } from '../model/placement.js';
import { buildingRings, deriveDriveway } from '../site/lotplan.js';
import { schemeColours } from '../model/colour-schemes.js';
import { createAerialToggle } from '../ui/aerial-toggle.js';

// Scene ----------------------------------------------------------------------------------------------------------------------------
const num = Number.isFinite;
/** A ring as clean { x, y } points (plan mm), dropping anything that is not a finite coordinate. */
export const ringPts = (ring) => (Array.isArray(ring) ? ring.filter((q) => num(q?.x) && num(q?.y)).map((q) => ({ x: q.x, y: q.y })) : []);
const area = (v) => `${Math.round(v).toLocaleString('en-AU')} m²`;
const centroid = (r) => ({ x: r.reduce((a, q) => a + q.x, 0) / r.length, y: r.reduce((a, q) => a + q.y, 0) / r.length });

/**
 * The plain data the top view draws. kinds: house, driveway, building, unit, canopy, extra, bay, accessible.
 * { boundary, neighbours: [{ ring, isRoad }], envelope, shapes: [{ kind, ring, fill? }], labels: [{ x, y, text, widthMm }], northDeg, areaM2, summary,
 *   aerial: { key, extent, href? } | null }   aerial is set only while the lot's Aerial layer is on; href is the picture once it is read back
 */
export function baseScene(project, shapes, labels, what) {
  const lot = lotOf(project);
  const boundary = ringPts(lot?.boundary);
  if (boundary.length < 3) return null;
  const envelope = ringPts(lot.envelope);
  const areaM2 = Number(lot.areaM2) || 0;
  const name = lot.lotLabel || (lot.demo ? 'Sample lot' : 'Lot');
  return {
    boundary,
    neighbours: (lot.neighbours || []).map((n) => ({ ring: ringPts(n.ring), isRoad: !!n.isRoad })).filter((n) => n.ring.length >= 3),
    envelope: envelope.length >= 3 ? envelope : null,
    shapes: shapes.filter((s) => s.ring.length >= 3),
    labels,
    northDeg: Number(project.site?.northDeg) || 0,
    aerial: lot.aerial?.extent && lot.aerial.key && lot.layers?.aerial !== false ? { key: lot.aerial.key, extent: lot.aerial.extent } : null,
    areaM2,
    summary: [name, areaM2 ? area(areaM2) : '', what].filter(Boolean).join(', '),
  };
}

/** Housing lot: the lot, setback line, driveway and the house roof. */
export function housingScene(project) {
  const shapes = [];
  let dw = null;
  try { dw = deriveDriveway(project); } catch { dw = null; }
  if (dw?.ok) for (const poly of [dw.polygon, dw.crossover?.polygon]) if (poly) shapes.push({ kind: 'driveway', ring: ringPts(poly) });
  const roof = schemeColours(project)?.roof || '#6b7178';
  const rings = buildingRings(project).map(ringPts).filter((r) => r.length >= 3);
  for (const ring of rings) shapes.push({ kind: 'house', ring, fill: roof });
  // The rings are the rooms and the garage of one house.
  const sc = baseScene(project, shapes, [], rings.length ? 'house placed' : 'no house placed');
  if (sc && rings.length) sc.movables = [{ id: 'house', label: 'House', rings, centre: houseCentre(project) }];
  return sc;
}

// View maths -----------------------------------------------------------------------------------------------------------------------
/** Bounds of what the scene draws (not the neighbours): { minX, minY, maxX, maxY }. */
export function sceneBounds(scene) {
  const pts = [...scene.boundary, ...(scene.envelope || []), ...scene.shapes.flatMap((s) => s.ring)];
  const xs = pts.map((q) => q.x);
  const ys = pts.map((q) => q.y);
  return { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) };
}

export const ZOOM_OUT = 0.6; // of the fitted scale
export const ZOOM_IN = 80; // times the fitted scale

const RAD = Math.PI / 180;
/** Rotate the vector (x, y) by `deg` degrees clockwise on screen (SVG rotate, y down). */
export const rotVec = (x, y, deg) => { const c = Math.cos(deg * RAD); const s = Math.sin(deg * RAD); return { x: x * c - y * s, y: x * s + y * c }; };
/** Keep an angle in degrees within [0, 360). */
export const wrapDeg = (d) => ((d % 360) + 360) % 360;

/** The view that frames the scene in a w x h pixel area with a margin: { cx, cy, k, rot } (plan centre, pixels per plan mm, degrees clockwise). */
export function fitView(scene, w, h, margin = 0.1, rot = 0) {
  const b = sceneBounds(scene);
  const cx = (b.minX + b.maxX) / 2;
  const cy = (b.minY + b.maxY) / 2;
  let bw = Math.max(1, b.maxX - b.minX);
  let bh = Math.max(1, b.maxY - b.minY);
  if (rot) {
    // the box that holds the scene once it is turned
    const cs = [[b.minX, b.minY], [b.maxX, b.minY], [b.maxX, b.maxY], [b.minX, b.maxY]].map(([x, y]) => rotVec(x - cx, y - cy, rot));
    bw = Math.max(1, Math.max(...cs.map((q) => q.x)) - Math.min(...cs.map((q) => q.x)));
    bh = Math.max(1, Math.max(...cs.map((q) => q.y)) - Math.min(...cs.map((q) => q.y)));
  }
  const k = Math.min(Math.max(1, w) / (bw * (1 + 2 * margin)), Math.max(1, h) / (bh * (1 + 2 * margin)));
  return { cx, cy, k, rot };
}

/** The plan point under pixel (sx, sy) of a w x h area. */
const planAt = (view, sx, sy, w, h) => { const d = rotVec(sx - w / 2, sy - h / 2, -(view.rot || 0)); return { x: view.cx + d.x / view.k, y: view.cy + d.y / view.k }; };

/** Zoom by `factor` keeping the plan point under pixel (sx, sy) where it is. `fit` bounds the zoom range. */
export function zoomAt(view, fit, factor, sx, sy, w, h) {
  const k = Math.min(fit.k * ZOOM_IN, Math.max(fit.k * ZOOM_OUT, view.k * factor));
  const p = planAt(view, sx, sy, w, h);
  const d = rotVec(sx - w / 2, sy - h / 2, -(view.rot || 0));
  return { ...view, cx: p.x - d.x / k, cy: p.y - d.y / k, k };
}

/** Turn the view by `deg` degrees (clockwise) about pixel (sx, sy), which keeps its plan point. */
export function rotateAt(view, deg, sx, sy, w, h) {
  const rot = wrapDeg((view.rot || 0) + deg);
  const p = planAt(view, sx, sy, w, h);
  const d = rotVec(sx - w / 2, sy - h / 2, -rot);
  return { ...view, cx: p.x - d.x / view.k, cy: p.y - d.y / view.k, rot };
}

/** Move the view by a drag of (dx, dy) pixels (screen directions, whatever the turn), keeping the centre within a lot width of the scene. */
export function panBy(view, dx, dy, scene) {
  const b = sceneBounds(scene);
  const bw = b.maxX - b.minX;
  const bh = b.maxY - b.minY;
  const d = rotVec(dx, dy, -(view.rot || 0));
  const cx = Math.min(b.maxX + bw, Math.max(b.minX - bw, view.cx - d.x / view.k));
  const cy = Math.min(b.maxY + bh, Math.max(b.minY - bh, view.cy - d.y / view.k));
  return { ...view, cx, cy };
}

/** The viewBox (plan mm) that shows `view` in a w x h pixel area. */
export const viewBoxOf = (view, w, h) => ({ x: view.cx - w / (2 * view.k), y: view.cy - h / (2 * view.k), w: w / view.k, h: h / view.k });

/** A round scale bar length (metres) and its width in pixels, at most about 150 px wide. */
export function scaleBarFor(k) {
  const pxPerM = k * 1000;
  let best = { m: 1, px: pxPerM };
  for (const m of [0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000]) if (m * pxPerM <= 150) best = { m, px: m * pxPerM };
  return best;
}

// SVG ------------------------------------------------------------------------------------------------------------------------------
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const f2 = (v) => (Math.round(v * 100) / 100).toString();
const dPath = (ring) => `M${ring.map((q) => `${f2(q.x)} ${f2(q.y)}`).join('L')}Z`;
const NS = 'vector-effect="non-scaling-stroke"';

const STYLE = {
  driveway: 'fill="#d9d8d2" stroke="#8d8f90" stroke-width="1"',
  house: (s) => `fill="${esc(s.fill || '#6b7178')}" stroke="#ffffff" stroke-width="1.4"`,
  building: (s) => `fill="${esc(s.fill || '#cfc9bd')}" stroke="#282c32" stroke-width="1.4"`,
  unit: (s) => `fill="${esc(s.fill || '#cfc9bd')}" stroke="#282c32" stroke-width="1.2"`,
  canopy: 'fill="#78828c" fill-opacity=".45" stroke="#4a5058" stroke-width="1"',
  extra: 'fill="#5a646e" fill-opacity=".35" stroke="#4a5058" stroke-width="1"',
  bay: 'fill="#f4f4f6" stroke="#6d747c" stroke-width="1"',
  accessible: 'fill="#9cc0f6" stroke="#3b82f6" stroke-width="1"',
};
const styleOf = (s) => { const v = STYLE[s.kind] || STYLE.extra; return typeof v === 'function' ? v(s) : v; };
// Draw order: the ground things first, buildings on top.
const ORDER = ['driveway', 'extra', 'bay', 'accessible', 'canopy', 'house', 'building', 'unit'];

/** Label text upright along an edge (reads left to right, or bottom to top on a vertical edge). */
function edgeAngle(a, b) {
  let ang = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
  if (ang >= 90) ang -= 180;
  if (ang < -90) ang += 180;
  return ang;
}

/** The inside of the SVG for `view` in a w x h pixel area (strokes and text keep their pixel size at any zoom). */
export function sceneInner(scene, view, w, h, deco = null) {
  const vb = viewBoxOf(view, w, h);
  const px = 1 / view.k; // one screen pixel in plan mm
  const rot = view.rot || 0; // the plan is drawn inside a group turned by this; text is turned back so it stays upright
  // Aerial off (or not read yet): a clean neutral ground with the boundary, neighbours, roads and setback line drawn crisply. Aerial on: the
  // picture under the same linework, in white so it reads on imagery.
  const img = scene.aerial?.href && scene.aerial.extent ? scene.aerial.extent : null;
  const out = [`<rect x="${f2(vb.x)}" y="${f2(vb.y)}" width="${f2(vb.w)}" height="${f2(vb.h)}" fill="#e8ece7"/>`];
  if (rot) out.push(`<g data-part="turn" transform="rotate(${f2(rot)} ${f2(view.cx)} ${f2(view.cy)})">`);
  if (img) out.push(`<image data-part="aerial" href="${esc(scene.aerial.href)}" x="${f2(img.x0)}" y="${f2(img.y0)}" width="${f2(img.x1 - img.x0)}" height="${f2(img.y1 - img.y0)}" preserveAspectRatio="none"/>`);
  for (const n of scene.neighbours) out.push(img ? `<path d="${dPath(n.ring)}" fill="none" stroke="#ffffff" stroke-opacity=".6" stroke-width="1" ${NS}/>` : `<path d="${dPath(n.ring)}" fill="${n.isRoad ? '#cfd4d8' : '#f6f7f4'}" stroke="#3c4650" stroke-opacity=".4" stroke-width="1" ${NS}/>`);
  out.push(`<path data-part="boundary" d="${dPath(scene.boundary)}" ${img ? 'fill="none"' : 'fill="#ffffff" fill-opacity=".92"'} stroke="#e53935" stroke-width="2.4" stroke-linejoin="round" ${NS}/>`);
  if (scene.envelope) out.push(`<path data-part="setback" d="${dPath(scene.envelope)}" fill="none" stroke="${img ? '#ffffff' : '#28323c'}" stroke-opacity="${img ? '.95' : '.8'}" stroke-width="1.5" stroke-dasharray="7 5" ${NS}/>`);
  for (const kind of ORDER) for (const s of scene.shapes) if (s.kind === kind) out.push(`<path data-part="${esc(kind)}" d="${dPath(s.ring)}" ${styleOf(s)} stroke-linejoin="round" ${NS}/>`);
  // The selected movable: its outline (gold, red when it has a warning), and the turn handle above it.
  if (deco?.rings) {
    for (const r of deco.rings) out.push(`<path data-part="selected" d="${dPath(r)}" fill="${deco.warn ? '#e53935' : '#c7a256'}" fill-opacity=".18" stroke="${deco.warn ? '#e53935' : '#c7a256'}" stroke-width="3" ${NS}/>`);
    if (deco.handle) out.push(`<line x1="${f2(deco.centre.x)}" y1="${f2(deco.centre.y)}" x2="${f2(deco.handle.x)}" y2="${f2(deco.handle.y)}" stroke="#c7a256" stroke-width="2" ${NS}/><circle data-part="turn-handle" cx="${f2(deco.handle.x)}" cy="${f2(deco.handle.y)}" r="${f2(9 * px)}" fill="#c7a256" stroke="#fff" stroke-width="2" ${NS}/>`);
  }
  const halo = `paint-order="stroke" stroke="#ffffff" stroke-width="${f2(3.2 * px)}" stroke-linejoin="round"`;
  // `turn` is the angle the text itself is set at on screen (0 = level); the group's turn is taken off so it lands there.
  const text = (x, y, t, size, extra = '', turn = 0) => `<text x="${f2(x)}" y="${f2(y)}" dy=".34em" font-size="${f2(size * px)}" text-anchor="middle" font-family="system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif" ${halo} ${extra}${turn - rot ? ` transform="rotate(${f2(turn - rot)} ${f2(x)} ${f2(y)})"` : ''}>${esc(t)}</text>`;
  // Boundary lengths, on the edges long enough on screen to hold them.
  const b = scene.boundary;
  for (let i = 0; i < b.length; i++) {
    const p = b[i];
    const q = b[(i + 1) % b.length];
    const len = Math.hypot(q.x - p.x, q.y - p.y);
    if (len * view.k < 84) continue;
    const mid = { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 };
    // Outside the lot: the side of the edge away from the centroid.
    const c = centroid(b);
    let nx = -(q.y - p.y) / len;
    let ny = (q.x - p.x) / len;
    if ((mid.x - c.x) * nx + (mid.y - c.y) * ny < 0) { nx = -nx; ny = -ny; }
    const at = { x: mid.x + nx * 12 * px, y: mid.y + ny * 12 * px };
    out.push(text(at.x, at.y, `${(len / 1000).toFixed(2)} m`, 11, 'fill="#2f3a44"', edgeAngle({ x: 0, y: 0 }, rotVec(q.x - p.x, q.y - p.y, rot))));
  }
  for (const l of scene.labels || []) if (l.widthMm * view.k >= 24) out.push(text(l.x, l.y, l.text, 12, 'fill="#1d242b" font-weight="700"'));
  if (scene.areaM2 && (Math.max(...b.map((q) => q.x)) - Math.min(...b.map((q) => q.x))) * view.k > 150) {
    const bx = sceneBounds({ boundary: b, envelope: null, shapes: [] });
    out.push(text((bx.minX + bx.maxX) / 2, bx.minY + 22 * px, `Lot ${area(scene.areaM2)}`, 13, 'fill="#c62828" font-weight="700"'));
  }
  if (rot) out.push('</g>');
  return out.join('');
}

/** A complete SVG document string (used by the tests, and handy for a print or export later). */
export function sceneSvg(scene, view, w, h) {
  const vb = viewBoxOf(view, w, h);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${f2(vb.x)} ${f2(vb.y)} ${f2(vb.w)} ${f2(vb.h)}" width="${w}" height="${h}" role="img" aria-label="${esc(scene.summary)}">${sceneInner(scene, view, w, h)}</svg>`;
}

// Dialog ---------------------------------------------------------------------------------------------------------------------------
export const TOPVIEW_CSS = `
.tv-ov{position:absolute;inset:0;z-index:8;background:rgba(6,8,10,.55);display:block}
.tv-dlg{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:76%;height:76%;min-width:0;display:flex;flex-direction:column;overflow:hidden;border-radius:14px;background:rgba(14,16,18,.96);border:1px solid rgba(255,255,255,.22);box-shadow:0 18px 60px rgba(0,0,0,.55);color:#fff}
.tv-bar{flex:none;display:flex;align-items:center;gap:10px;padding:8px 10px 8px 14px;border-bottom:1px solid rgba(255,255,255,.14)}
.tv-title{margin:0;font:600 11px/1 var(--lc-sans,system-ui,sans-serif);letter-spacing:.2em;white-space:nowrap}
.tv-sub{flex:1;min-width:0;font:400 12px/1.3 var(--lc-sans,system-ui,sans-serif);color:rgba(255,255,255,.7);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.tv-btns{flex:none;display:flex;gap:6px}
.tv-btn{min-width:40px;height:40px;padding:0 10px!important;border-radius:20px;border:1px solid rgba(255,255,255,.3)!important;background:rgba(255,255,255,.06)!important;color:#fff;font:600 18px/1 var(--lc-sans,system-ui,sans-serif);display:inline-flex;align-items:center;justify-content:center;cursor:pointer}
.tv-btn:hover{background:rgba(255,255,255,.16)!important}
.tv-btn:focus-visible,.tv-svg:focus-visible{outline:2px solid #fff;outline-offset:2px}
.tv-btn.tv-fit,.tv-btn.tv-n{font-size:12px;letter-spacing:.06em}
.tv-btn[aria-pressed="true"].tv-n{background:rgba(255,255,255,.22)!important}
.tv-warn{flex:none;margin:0;padding:6px 14px;font:600 12px/1.3 var(--lc-sans,system-ui,sans-serif);color:#bfe3c5;background:rgba(40,90,50,.35)}
.tv-warn[data-state="warn"]{color:#ffd0cc;background:rgba(190,40,40,.4)}
.tv-btn.tv-mode{font-size:12px;border-radius:20px;white-space:nowrap}
.tv-btn.tv-t90{font-size:13px;white-space:nowrap}
.tv-btn[hidden]{display:none}
.tv-btn:disabled{opacity:.4;cursor:default}
.tv-stage{position:relative;flex:1;min-height:0;background:#e8ece7}
.tv-svg{position:absolute;inset:0;width:100%;height:100%;display:block;touch-action:none;cursor:grab;user-select:none;-webkit-user-select:none}
.tv-svg.is-drag{cursor:grabbing}
.tv-north{position:absolute;right:12px;top:12px;width:48px;height:48px;pointer-events:none}
.tv-scale{position:absolute;left:12px;bottom:12px;pointer-events:none;font:600 11px var(--lc-sans,system-ui,sans-serif);color:#1d242b;text-shadow:0 0 3px #fff,0 0 3px #fff}
.tv-scale i{display:block;height:6px;border:2px solid #1d242b;border-top:0;margin-top:2px;box-sizing:border-box}
.tv-help{flex:none;margin:0;padding:6px 14px 8px;font:400 11px/1.3 var(--lc-sans,system-ui,sans-serif);color:rgba(255,255,255,.62)}
.tv-live{position:absolute;width:1px;height:1px;margin:-1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
.lc-mini{cursor:grab;touch-action:none}
.lc-mini-reset{position:absolute;left:6px;bottom:6px;width:30px;height:30px;border-radius:50%;background:rgba(10,10,12,.78)!important;border:1px solid rgba(255,255,255,.55)!important;display:flex;align-items:center;justify-content:center;color:#fff;padding:0;cursor:pointer}
.lc-mini-reset[hidden]{display:none}
.lc-mini-reset svg{width:15px;height:15px}
.lc-mini-x{position:absolute;right:6px;bottom:6px;width:30px;height:30px;border-radius:50%;background:rgba(10,10,12,.78)!important;border:1px solid rgba(255,255,255,.55)!important;display:flex;align-items:center;justify-content:center;color:#fff}
.lc-mini-x:hover{background:rgba(10,10,12,.95)!important}
.lc-mini-x svg{width:14px;height:14px}
.lc-root.is-compact .lc-mini-x{width:26px;height:26px;right:4px;bottom:4px}
.lc-mini-hint{padding-right:40px!important}
@media (max-width:640px){.tv-sub{display:none}.tv-btns{margin-left:auto;gap:3px;flex-wrap:wrap;justify-content:flex-end}.tv-btn{min-width:34px;height:34px;padding:0 6px!important}.tv-bar{gap:6px;padding:8px}.tv-bar .ps-aerial{height:34px;padding:0 10px 0 8px!important}}
@media (max-width:640px),(max-height:480px){.tv-dlg{left:0;top:0;transform:none;width:100%;height:100%;border-radius:0;border:0}.tv-help{padding-bottom:calc(8px + env(safe-area-inset-bottom,0px))}}
@media (prefers-reduced-motion:no-preference){.tv-ov{animation:tvfade .16s ease-out}@keyframes tvfade{from{opacity:0}to{opacity:1}}}
`;

const EXPAND_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M14 4h6v6M10 20H4v-6M20 4l-7 7M4 20l7-7" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
/** The expand button that sits on the mini map (a real button; the mini itself is not one, so buttons are never nested). */
export function expandButton(onclick) {
  const b = h('button', { class: 'lc-mini-x', type: 'button', title: 'Enlarge the top view', 'aria-label': 'Enlarge top view', 'aria-haspopup': 'dialog', dataset: { ps: 'lc-mini-expand' }, onclick });
  b.innerHTML = EXPAND_ICON;
  return b;
}

const aerialUrls = new Map();
/** The stored aerial as an object URL (cached per image key), or null when it cannot be read. */
export function aerialUrl(key) {
  if (!aerialUrls.has(key)) {
    aerialUrls.set(key, import('../editor2d/underlay.js').then((m) => m.loadImageBlob(key)).then((b) => (b && typeof URL !== 'undefined' ? URL.createObjectURL(b) : null)).catch(() => null));
  }
  return aerialUrls.get(key);
}

let cssDone = false;
function injectCss() {
  if (cssDone || typeof document === 'undefined') return;
  cssDone = true;
  if (document.getElementById('ps-topview-css')) return;
  const st = document.createElement('style');
  st.id = 'ps-topview-css';
  st.textContent = TOPVIEW_CSS;
  document.head.append(st);
}

const FOCUSABLE = 'button:not([disabled]),[href],input,select,textarea,[tabindex]:not([tabindex="-1"])';
const HELP = 'Scroll or pinch to zoom, drag to pan. Right-drag, Shift and drag, or twist two fingers to rotate. Drag a building to move it (it snaps to setback lines and other buildings), use its gold handle to turn it. Keyboard: arrow keys pan, Alt and arrow keys move the selected building, R turns it 90 degrees, plus and minus zoom, [ and ] rotate, N puts north up, 0 fits the lot, Escape closes.';

/**
 * @param {Object} o
 * @param {HTMLElement|Function} o.root  The lot card root (or a function returning it, for when it is made after the top view) (the overlay sits inside it, over the viewer).
 * @param {Function} o.getScene  () => scene | null | Promise (see housingScene).
 * @param {Object} [o.store]  When given, the view redraws on project changes while it is open.
 * @param {HTMLElement} [o.trigger]  Focus returns here on close.
 * @param {Function} [o.onChange]  (open) => void, after it opens or closes.
 */
/**
 * `movers` (optional) lets the person move buildings from the top view: { can(project) -> bool, move(id, dx, dy, label), turn(id, deg, centre, label) }.
 * Each call is one store.apply; a drag replaces its own previous step so the whole drag is one undo step.
 */
export function createTopView({ root: rootRef, getScene, store = null, trigger = null, onChange = null, movers = null }) {
  injectCss();
  const rootEl = () => (typeof rootRef === 'function' ? rootRef() : rootRef);
  let ov = null;
  let svg = null;
  let scene = null;
  let view = null;
  let fit = null;
  let size = { w: 0, h: 0 };
  let raf = 0;
  let token = 0;
  let off = null;
  let inerted = [];
  let opener = null;
  const ptrs = new Map();
  let gesture = null;
  const els = {};
  let sel = null; // id of the selected movable
  let moveMode = true; // drag a building to move it (false: every drag pans)
  let drag = null; // { kind: 'move' | 'turn', id, ... } while a building is being moved or turned
  let flushAt = 0;
  const canMove = () => !!(movers && store && (!movers.can || movers.can(store.project)));
  const selected = () => (scene?.movables || []).find((m) => m.id === sel) || null;
  const others = (id) => (scene?.movables || []).filter((m) => m.id !== id).flatMap((m) => m.rings);
  const upDir = () => { const a = ((view?.rot || 0) * Math.PI) / 180; return { x: Math.sin(a), y: -Math.cos(a) }; }; // screen up in plan axes

  const measure = () => { const r = svg.getBoundingClientRect(); size = { w: Math.round(r.width), h: Math.round(r.height) }; return size.w > 0 && size.h > 0; };
  const announce = (t) => { if (els.live) els.live.textContent = t; };

  function paint() {
    raf = 0;
    if (!ov || !svg || !scene || !measure()) return;
    if (!fit) { fit = fitView(scene, size.w, size.h); view = { ...fit }; }
    const vb = viewBoxOf(view, size.w, size.h);
    svg.setAttribute('viewBox', `${f2(vb.x)} ${f2(vb.y)} ${f2(vb.w)} ${f2(vb.h)}`);
    svg.innerHTML = sceneInner(scene, view, size.w, size.h, decoOf());
    svg.setAttribute('aria-label', `Top view. ${scene.summary}`);
    els.sub.textContent = scene.summary;
    const sb = scaleBarFor(view.k);
    els.scaleBar.style.width = `${Math.round(sb.px)}px`;
    els.scaleText.textContent = sb.m >= 1 ? `${sb.m} m` : `${Math.round(sb.m * 100)} cm`;
    const nd = wrapDeg(scene.northDeg + (view.rot || 0)); // the arrow turns with the view, so it stays right at any rotation
    els.north.style.transform = `rotate(${f2(nd)}deg)`;
    els.north.setAttribute('aria-label', nd > 0.5 && nd < 359.5 ? `North arrow, north is ${Math.round(nd)} degrees clockwise from the top of the view` : 'North arrow, north is at the top');
    if (els.northUp) els.northUp.setAttribute('aria-pressed', String(nd < 0.5 || nd > 359.5));
  }
  function warnOf(m) {
    if (!m) return [];
    return moveWarnings(m.rings, { envelope: scene.envelope, boundary: scene.boundary, others: others(m.id) });
  }
  function decoOf() {
    const m = canMove() ? selected() : null;
    if (!m) return null;
    const up = upDir();
    const reach = Math.max(...m.rings.flat().map((q) => (q.x - m.centre.x) * up.x + (q.y - m.centre.y) * up.y), 0);
    const d = reach + 26 / view.k;
    return { rings: m.rings, warn: warnOf(m).length > 0, centre: m.centre, handle: { x: m.centre.x + up.x * d, y: m.centre.y + up.y * d } };
  }
  function paintMoveUi() {
    if (!els.warn) return;
    const on = canMove();
    els.moveBtn.hidden = !on;
    els.turnL.hidden = els.turnR.hidden = !on;
    const m = on ? selected() : null;
    els.turnL.disabled = els.turnR.disabled = !m;
    els.moveBtn.setAttribute('aria-pressed', String(moveMode));
    els.moveBtn.textContent = moveMode ? 'Move buildings' : 'Pan the view';
    const w = m ? warnOf(m) : [];
    els.warn.hidden = !m;
    els.warn.dataset.state = w.length ? 'warn' : 'ok';
    els.warn.textContent = m ? `${m.label}: ${w.length ? w.join('. ') : 'inside the setbacks, clear of other buildings'}` : '';
  }
  const schedule = () => { if (!raf) raf = requestAnimationFrame(paint); };

  function refresh() {
    const mine = ++token;
    Promise.resolve()
      .then(() => getScene())
      .then((sc) => {
        if (mine !== token || !ov) return;
        scene = sc;
        if (!scene) { close(); return; }
        if (sel && !selected()) sel = null;
        paintMoveUi();
        schedule();
        if (sc.aerial) aerialUrl(sc.aerial.key).then((href) => { if (href && mine === token && scene === sc) { sc.aerial.href = href; schedule(); } });
      })
      .catch(() => { /* the last scene stays on screen */ });
  }

  const zoomBy = (factor, sx = size.w / 2, sy = size.h / 2) => {
    if (!view) return;
    view = zoomAt(view, fit, factor, sx, sy, size.w, size.h);
    announce(`Zoom ${Math.round((view.k / fit.k) * 100)} percent`);
    schedule();
  };
  const resetView = () => { if (!scene) return; const rot = view?.rot || 0; fit = fitView(scene, size.w, size.h); view = fitView(scene, size.w, size.h, 0.1, rot); announce('Whole lot in view'); schedule(); };
  const turnBy = (deg, sx = size.w / 2, sy = size.h / 2) => {
    if (!view) return;
    view = rotateAt(view, deg, sx, sy, size.w, size.h);
    announce(`Rotated, north is ${Math.round(wrapDeg(scene.northDeg + view.rot))} degrees clockwise from the top`);
    schedule();
  };
  // North up: turn the view so the north arrow points to the top, and frame the whole lot.
  const northUp = () => { if (!scene) return; const rot = wrapDeg(-scene.northDeg); fit = fitView(scene, size.w, size.h); view = fitView(scene, size.w, size.h, 0.1, rot); announce('North is at the top, whole lot in view'); schedule(); };
  const panPx = (dx, dy) => { if (!view) return; view = panBy(view, dx, dy, scene); schedule(); };

  // Pointer handling: one pointer pans; right-drag (or Shift and drag) turns the view; two pointers pinch to zoom, twist to turn and drag to pan.
  const pt = (e) => { const r = svg.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const ang = (a, b) => (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
  const wrap180 = (d) => ((d + 540) % 360) - 180;
  let turning = false;
  const planPt = (p) => { const d = rotVec(p.x - size.w / 2, p.y - size.h / 2, -(view.rot || 0)); return { x: view.cx + d.x / view.k, y: view.cy + d.y / view.k }; };
  const hitMovable = (pp) => (scene.movables || []).slice().reverse().find((m) => m.rings.some((r) => inside(pp, r))) || null;
  const handleHit = (p) => {
    const d = decoOf();
    if (!d) return false;
    const hp = { x: (d.handle.x - view.cx) * view.k, y: (d.handle.y - view.cy) * view.k };
    const sp = rotVec(hp.x, hp.y, view.rot || 0);
    return Math.hypot(size.w / 2 + sp.x - p.x, size.h / 2 + sp.y - p.y) <= 16;
  };
  function flush(final = false) {
    if (!drag || !movers) return;
    const now = performance.now();
    if (!final && now - flushAt < 60) { if (!drag.raf) drag.raf = setTimeout(() => { if (drag) { drag.raf = 0; flush(); } }, 60); return; }
    flushAt = now;
    const key = drag.kind === 'move' ? `${drag.dx}|${drag.dy}` : `${drag.deg}`;
    if (key === drag.key) return;
    drag.key = key;
    try {
      if (drag.applied) store.undo();
      drag.applied = false;
      if (drag.kind === 'move' ? (drag.dx || drag.dy) : drag.deg) {
        if (drag.kind === 'move') movers.move(drag.id, drag.dx, drag.dy, drag.label);
        else movers.turn(drag.id, drag.deg, drag.centre, drag.label);
        drag.applied = true;
      }
    } catch { drag.applied = false; }
  }
  function endDrag() {
    if (!drag) return;
    clearTimeout(drag.raf);
    flush(true);
    const m = drag;
    drag = null;
    paintMoveUi();
    if (m.applied) announce(`${m.label} ${m.kind === 'move' ? 'moved' : 'turned'}. ${els.warn?.textContent || ''}`);
  }
  // One step on the model: used by the 90 degree buttons and the keyboard.
  function stepMove(dx, dy) { const m = selected(); if (!m || !canMove()) return; try { movers.move(m.id, dx, dy, m.label); } catch { /* the move was not possible */ } }
  function stepTurn(deg) { const m = selected(); if (!m || !canMove()) return; try { movers.turn(m.id, deg, m.centre, m.label); } catch { /* the turn was not possible */ } }
  function onDown(e) {
    if (e.button === 0 && !e.shiftKey && ptrs.size === 0 && canMove() && moveMode && scene) {
      const p0 = pt(e);
      const pp = planPt(p0);
      const m = selected();
      if (m && handleHit(p0)) {
        const a0 = (Math.atan2(pp.y - m.centre.y, pp.x - m.centre.x) * 180) / Math.PI;
        drag = { kind: 'turn', id: m.id, label: m.label, centre: m.centre, a0, total: 0, prev: null, deg: 0, key: '', applied: false, raf: 0 };
      } else {
        const hit = hitMovable(pp);
        if (hit) {
          sel = hit.id;
          drag = { kind: 'move', id: hit.id, label: hit.label, rings: hit.rings, targets: [...others(hit.id), ...(scene.envelope ? [scene.envelope] : []), scene.boundary], x0: pp.x, y0: pp.y, dx: 0, dy: 0, key: '', applied: false, raf: 0 };
        } else if (sel) { sel = null; }
      }
      if (drag) {
        ptrs.set(e.pointerId, p0);
        try { svg.setPointerCapture(e.pointerId); } catch { /* no capture */ }
        svg.classList.add('is-drag');
        paintMoveUi();
        schedule();
        e.preventDefault();
        return;
      }
      paintMoveUi();
      schedule();
    }
    if (e.button > 1) { if (e.button === 2) turning = true; else return; }
    ptrs.set(e.pointerId, pt(e));
    if (e.button === 0 && e.shiftKey) turning = true;
    try { svg.setPointerCapture(e.pointerId); } catch { /* no capture */ }
    svg.classList.add('is-drag');
    if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; turning = false; gesture = { d: dist(a, b), a: ang(a, b), mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } }; }
    e.preventDefault();
  }
  function onMove(e) {
    if (!ptrs.has(e.pointerId)) return;
    if (drag && ptrs.size === 1) {
      const p = pt(e);
      const pp = planPt(p);
      if (drag.kind === 'move') {
        const r = snapMove(drag.rings, pp.x - drag.x0, pp.y - drag.y0, drag.targets, 12 / view.k);
        drag.dx = r.dx; drag.dy = r.dy;
      } else {
        let d = (Math.atan2(pp.y - drag.centre.y, pp.x - drag.centre.x) * 180) / Math.PI - drag.a0;
        d = ((d + 540) % 360) - 180;
        drag.total = drag.prev == null ? d : drag.total + (((d - drag.prev + 540) % 360) - 180);
        drag.prev = d;
        drag.deg = turnSnap(drag.total, e.altKey);
      }
      flush();
      return;
    }
    const p = pt(e);
    const prev = ptrs.get(e.pointerId);
    ptrs.set(e.pointerId, p);
    if (ptrs.size === 1) {
      if (turning) { const c = { x: size.w / 2, y: size.h / 2 }; turnBy(wrap180(ang(c, p) - ang(c, prev))); return; }
      panPx(p.x - prev.x, p.y - prev.y);
      return;
    }
    if (ptrs.size === 2 && gesture) {
      const [a, b] = [...ptrs.values()];
      const d = dist(a, b);
      const an = ang(a, b);
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      if (gesture.d > 0 && d > 0) zoomBy(d / gesture.d, mid.x, mid.y);
      const da = wrap180(an - gesture.a);
      if (Math.abs(da) > 0.05) { view = rotateAt(view, da, mid.x, mid.y, size.w, size.h); schedule(); }
      panPx(mid.x - gesture.mid.x, mid.y - gesture.mid.y);
      gesture = { d, a: an, mid };
    }
  }
  function onUp(e) {
    if (drag) endDrag();
    ptrs.delete(e.pointerId);
    try { svg.releasePointerCapture(e.pointerId); } catch { /* not captured */ }
    if (ptrs.size < 2) gesture = null;
    if (!ptrs.size) { svg.classList.remove('is-drag'); turning = false; }
  }
  function onWheel(e) {
    e.preventDefault();
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 300 : 1;
    const p = pt(e);
    zoomBy(Math.exp((-e.deltaY * unit) * (e.ctrlKey ? 0.01 : 0.0016)), p.x, p.y);
  }
  function onKey(e) {
    if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); close(); return; }
    if (e.key === 'Tab' && ov) {
      const f = [...ov.querySelectorAll(FOCUSABLE)].filter((n) => !n.hidden && n.offsetParent !== null);
      if (!f.length) return;
      const first = f[0];
      const last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      else if (!ov.contains(document.activeElement)) { e.preventDefault(); first.focus(); }
      return;
    }
    if (e.target !== svg) return;
    if (canMove() && selected()) {
      if (e.altKey && e.key.startsWith('Arrow')) {
        const n = e.shiftKey ? 1000 : 100;
        const v = { ArrowLeft: [-n, 0], ArrowRight: [n, 0], ArrowUp: [0, -n], ArrowDown: [0, n] }[e.key];
        e.preventDefault(); stepMove(v[0], v[1]); return;
      }
      if (e.key === 'r' || e.key === 'R') { e.preventDefault(); stepTurn(e.shiftKey ? -90 : 90); return; }
      if (e.key === 'Escape') { /* handled above */ }
    }
    const step = e.shiftKey ? 200 : 60;
    const k = { ArrowLeft: [step, 0], ArrowRight: [-step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] }[e.key];
    if (k) { e.preventDefault(); panPx(k[0], k[1]); return; }
    if (e.key === '+' || e.key === '=') { e.preventDefault(); zoomBy(1.4); }
    else if (e.key === '-' || e.key === '_') { e.preventDefault(); zoomBy(1 / 1.4); }
    else if (e.key === '0') { e.preventDefault(); resetView(); }
    else if (e.key === '[') { e.preventDefault(); turnBy(-15); }
    else if (e.key === ']') { e.preventDefault(); turnBy(15); }
    else if (e.key === 'n' || e.key === 'N') { e.preventDefault(); northUp(); }
  }

  function build() {
    const btn = (label, text, cls, fn, extra = {}) => h('button', { class: `tv-btn ${cls}`, type: 'button', 'aria-label': label, title: label, onclick: fn, ...extra }, text);
    els.sub = h('span', { class: 'tv-sub' });
    els.close = btn('Close top view', '×', 'tv-close', () => close(), { dataset: { ps: 'topview-close' } });
    els.close.style.fontSize = '24px';
    svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'tv-svg');
    svg.setAttribute('role', 'img');
    svg.setAttribute('tabindex', '0');
    svg.setAttribute('aria-describedby', 'tv-help');
    svg.dataset.ps = 'topview-svg';
    els.north = (() => {
      const ns = 'http://www.w3.org/2000/svg';
      const s = document.createElementNS(ns, 'svg');
      s.setAttribute('class', 'tv-north');
      s.setAttribute('viewBox', '-24 -24 48 48');
      s.setAttribute('role', 'img');
      s.innerHTML = '<circle r="22" fill="#fff" fill-opacity=".92" stroke="#1d242b" stroke-width="1.6"/><path d="M0-18 L6 4 L0 0 L-6 4Z" fill="#1d242b"/><text x="0" y="17" font-size="11" font-weight="700" text-anchor="middle" fill="#1d242b" font-family="system-ui,Arial,sans-serif">N</text>';
      return s;
    })();
    els.scaleBar = h('i');
    els.scaleText = h('span');
    els.live = h('div', { class: 'tv-live', 'aria-live': 'polite', role: 'status' });
    const stage = h('div', { class: 'tv-stage' }, svg, els.north, h('div', { class: 'tv-scale', 'aria-hidden': 'true' }, els.scaleText, els.scaleBar));
    const dlg = h('div', { class: 'tv-dlg', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'tv-title', dataset: { ps: 'topview-dialog' } },
      h('div', { class: 'tv-bar' },
        h('h2', { class: 'tv-title', id: 'tv-title' }, 'TOP VIEW'),
        els.sub,
        ...(store ? [(els.aerial = createAerialToggle({ store, dataPs: 'topview-aerial' })).el] : []),
        h('div', { class: 'tv-btns' },
          btn('Zoom out', '−', 'tv-out', () => zoomBy(1 / 1.4), { dataset: { ps: 'topview-zoom-out' } }),
          btn('Zoom in', '+', 'tv-in', () => zoomBy(1.4), { dataset: { ps: 'topview-zoom-in' } }),
          (els.moveBtn = btn('Drag a building to move it, drag empty ground to pan. Press to switch to panning only', 'Move buildings', 'tv-mode', () => { moveMode = !moveMode; if (!moveMode) sel = null; paintMoveUi(); schedule(); }, { dataset: { ps: 'topview-move-mode' }, 'aria-pressed': 'true', hidden: true })),
          (els.turnL = btn('Turn the selected building 90 degrees anticlockwise', '\u21B6 90', 'tv-t90', () => stepTurn(-90), { dataset: { ps: 'topview-turn-left' }, hidden: true, disabled: true })),
          (els.turnR = btn('Turn the selected building 90 degrees clockwise', '90 \u21B7', 'tv-t90', () => stepTurn(90), { dataset: { ps: 'topview-turn-right' }, hidden: true, disabled: true })),
          btn('Rotate anticlockwise 15 degrees', '\u21BA', 'tv-rl', () => turnBy(-15), { dataset: { ps: 'topview-rotate-left' } }),
          btn('Rotate clockwise 15 degrees', '\u21BB', 'tv-rr', () => turnBy(15), { dataset: { ps: 'topview-rotate-right' } }),
          (els.northUp = btn('North up: turn the view so north is at the top', 'N', 'tv-n', () => northUp(), { dataset: { ps: 'topview-north-up' }, 'aria-pressed': 'false' })),
          btn('Fit the whole lot in view', 'Fit', 'tv-fit', () => resetView(), { dataset: { ps: 'topview-fit' } }),
          els.close)),
      (els.warn = h('p', { class: 'tv-warn', role: 'status', hidden: true, dataset: { ps: 'topview-warning' } })),
      stage,
      h('p', { class: 'tv-help', id: 'tv-help' }, HELP),
      els.live);
    ov = h('div', { class: 'tv-ov', dataset: { ps: 'topview-overlay' }, onclick: (e) => { if (e.target === ov) close(); } }, dlg);
    ov.addEventListener('keydown', onKey);
    svg.addEventListener('pointerdown', onDown);
    svg.addEventListener('pointermove', onMove);
    svg.addEventListener('pointerup', onUp);
    svg.addEventListener('pointercancel', onUp);
    svg.addEventListener('wheel', onWheel, { passive: false });
    svg.addEventListener('contextmenu', (e) => e.preventDefault());
    svg.addEventListener('dblclick', (e) => { const p = pt(e); zoomBy(2, p.x, p.y); });
  }

  function open() {
    if (ov) return;
    opener = (typeof document !== 'undefined' && document.activeElement && document.activeElement !== document.body) ? document.activeElement : trigger;
    build();
    const root = rootEl();
    root.append(ov);
    inerted = [...root.children].filter((c) => c !== ov && !c.inert);
    for (const c of inerted) c.inert = true;
    fit = null;
    view = null;
    sel = null;
    drag = null;
    moveMode = true;
    refresh();
    if (store) off = store.on('project', () => refresh());
    // Focus the plan so the arrow keys work straight away.
    svg.focus({ preventScroll: true });
    announce(`Top view open. ${HELP}`);
    onChange?.(true);
  }

  function close() {
    if (!ov) return;
    cancelAnimationFrame(raf);
    raf = 0;
    token++;
    off?.();
    off = null;
    for (const c of inerted) c.inert = false;
    inerted = [];
    els.aerial?.dispose();
    els.aerial = null;
    ov.remove();
    ov = null;
    svg = null;
    scene = null;
    ptrs.clear();
    gesture = null;
    // Focus returns to the expand button on the mini map (or whatever had focus when it opened).
    const back = trigger && document.contains(trigger) ? trigger : opener;
    try { back?.focus({ preventScroll: true }); } catch { /* gone */ }
    onChange?.(false);
  }

  return { open, close, toggle: () => (ov ? close() : open()), isOpen: () => !!ov, refresh, el: () => ov, dispose: close };
}
