// Site constraint overlays (indicative): flood planning, bushfire prone land, heritage and easements from open NSW and QLD data.
// Shared by the server (clipping, shaping) and the browser (plan mm model, summary card). Pure functions, no DOM.
//
// Wire format (GET /api/site/overlays), metres relative to the lot origin, y = northing (the same as /api/site/lot):
//   { state, srid, origin {e, n}, retrieved, layers: [{ id, label, source, attribution, date, status, note,
//       features: [{ label, detail, polygons: [{ outer: [[x, y]...], holes: [[[x, y]...]] }] }] }], warnings: [] }
//   status: 'ok' (queried, features may be empty), 'unavailable' (no open service known for that state), 'error' (service did not answer).
// site.lot.overlays (plan mm, y down):
//   { retrieved, layers: [{ id, label, source, attribution, date, status, note, features: [{ label, detail, rings: [{ outer: [{x, y}], holes: [[{x, y}]] }] }] }], warnings }
//
// Wording rule: this is context, never a planning or compliance statement. Every line says "check with council".

import { siteToPlan, pointInRing } from './geo.js';

export const OVERLAY_IDS = ['flood', 'bushfire', 'heritage', 'easement'];

// Colours: RGB triples so the 2D plan, the 3D tint and the PDF can each use their own alpha.
export const OVERLAY_STYLE = {
  flood: { rgb: [37, 99, 235], hatch: 'diag', title: 'Flood planning area' },
  bushfire: { rgb: [234, 88, 12], hatch: 'cross', title: 'Bushfire prone land' },
  heritage: { rgb: [147, 51, 234], hatch: 'dots', title: 'Heritage' },
  easement: { rgb: [22, 163, 74], hatch: 'horiz', title: 'Easement' },
};

export const OVERLAY_LAYER_KEY = (id) => `ov_${id}`;
/** Overlay layers are OFF until the person turns them on (the other site layers default on). */
export const overlayOn = (lot, id) => !!lot && lot.layers?.[OVERLAY_LAYER_KEY(id)] === true;

export const CHECK_WITH_COUNCIL = 'Indicative only, from open government mapping. Check with council and the relevant authority.';

// Clipping ------------------------------------------------------------------------------------------------------------------------

/** Sutherland-Hodgman clip of a ring ([[x, y]...]) to a box { minX, minY, maxX, maxY }. Returns [] when nothing is left. */
export function clipRingToBox(ring, box) {
  let pts = ring.length > 1 && ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1] ? ring.slice(0, -1) : ring.slice();
  const edges = [
    [(p) => p[0] >= box.minX, (a, b) => { const t = (box.minX - a[0]) / (b[0] - a[0]); return [box.minX, a[1] + t * (b[1] - a[1])]; }],
    [(p) => p[0] <= box.maxX, (a, b) => { const t = (box.maxX - a[0]) / (b[0] - a[0]); return [box.maxX, a[1] + t * (b[1] - a[1])]; }],
    [(p) => p[1] >= box.minY, (a, b) => { const t = (box.minY - a[1]) / (b[1] - a[1]); return [a[0] + t * (b[0] - a[0]), box.minY]; }],
    [(p) => p[1] <= box.maxY, (a, b) => { const t = (box.maxY - a[1]) / (b[1] - a[1]); return [a[0] + t * (b[0] - a[0]), box.maxY]; }],
  ];
  for (const [inside, cut] of edges) {
    if (!pts.length) return [];
    const out = [];
    for (let i = 0; i < pts.length; i++) {
      const cur = pts[i];
      const prev = pts[(i + pts.length - 1) % pts.length];
      const ci = inside(cur);
      const pi = inside(prev);
      if (ci) {
        if (!pi) out.push(cut(prev, cur));
        out.push(cur);
      } else if (pi) out.push(cut(prev, cur));
    }
    pts = out;
  }
  if (pts.length < 3) return [];
  return pts;
}

const ringAbs = (r) => { let s = 0; for (let i = 0; i < r.length; i++) { const a = r[i]; const b = r[(i + 1) % r.length]; s += a[0] * b[1] - b[0] * a[1]; } return Math.abs(s / 2); };

/** Clip polygons ({ outer, holes }) to the box; rings with no area are dropped, and a polygon whose outer ring is gone takes its holes with it. */
export function clipPolygonsToBox(polys, box, minAreaM2 = 0.05) {
  const out = [];
  for (const p of polys || []) {
    const outer = clipRingToBox(p.outer || [], box);
    if (outer.length < 3 || ringAbs(outer) < minAreaM2) continue;
    const holes = (p.holes || []).map((h) => clipRingToBox(h, box)).filter((h) => h.length >= 3 && ringAbs(h) >= minAreaM2);
    out.push({ outer, holes });
  }
  return out;
}

// Browser model ------------------------------------------------------------------------------------------------------------------

const toPlanRing = (ring) => ring.map(siteToPlan);

/** /api/site/overlays response -> site.lot.overlays (plan mm). Anything malformed is skipped, never thrown. */
export function buildOverlays(resp) {
  if (!resp || !Array.isArray(resp.layers)) return null;
  const layers = [];
  for (const l of resp.layers) {
    if (!OVERLAY_IDS.includes(l?.id)) continue;
    const features = [];
    for (const f of l.features || []) {
      if (!f) continue;
      const rings = (f.polygons || []).filter((p) => Array.isArray(p?.outer) && p.outer.length >= 3).map((p) => ({ outer: toPlanRing(p.outer), holes: (p.holes || []).map(toPlanRing) }));
      if (rings.length) features.push({ label: String(f.label || ''), detail: String(f.detail || ''), rings });
    }
    layers.push({ id: l.id, label: String(l.label || OVERLAY_STYLE[l.id].title), source: String(l.source || ''), attribution: String(l.attribution || ''), date: l.date || null, status: l.status || 'ok', note: l.note || '', features });
  }
  return { retrieved: resp.retrieved || null, layers, warnings: Array.isArray(resp.warnings) ? resp.warnings.map(String) : [] };
}

/** Layers that have something to draw (what the Layers panel offers). */
export const drawableLayers = (lot) => (lot?.overlays?.layers || []).filter((l) => l.features.length);

// Plan mm helpers ---------------------------------------------------------------------------------------------------------------------

const asPts = (ring) => ring.map((p) => [p.x, p.y]);
const inPoly = (pt, poly) => pointInRing(pt, asPts(poly.outer)) && !poly.holes.some((h) => pointInRing(pt, asPts(h)));

/**
 * How much of the lot a layer covers: { hit, fraction } by sampling the lot on a grid (plan mm). Fraction is 0 to 1.
 * `hit` is also true when a feature merely touches the lot (a feature vertex inside the lot) even if no sample falls in it.
 */
export function coverageOfLot(lot, layer, n = 24) {
  if (!lot?.boundary?.length || !layer) return { hit: false, fraction: 0 };
  const b = asPts(lot.boundary);
  const xs = b.map((p) => p[0]);
  const ys = b.map((p) => p[1]);
  const x0 = Math.min(...xs); const x1 = Math.max(...xs); const y0 = Math.min(...ys); const y1 = Math.max(...ys);
  const holes = (lot.holes || []).map(asPts);
  const polys = layer.features.flatMap((f) => f.rings);
  let inLot = 0;
  let inFeat = 0;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const pt = [x0 + ((i + 0.5) / n) * (x1 - x0), y0 + ((j + 0.5) / n) * (y1 - y0)];
      if (!pointInRing(pt, b) || holes.some((h) => pointInRing(pt, h))) continue;
      inLot++;
      if (polys.some((p) => inPoly(pt, p))) inFeat++;
    }
  }
  let touch = inFeat > 0;
  if (!touch) touch = polys.some((p) => p.outer.some((q) => pointInRing([q.x, q.y], b)));
  return { hit: touch, fraction: inLot ? inFeat / inLot : 0 };
}

const pct = (f) => (f >= 0.97 ? 'the whole lot' : f < 0.03 ? 'a small part of the lot' : `about ${Math.round(f * 100)} % of the lot`);

/** Distinct feature labels that touch the lot (so "Vegetation Category 1" is not listed twice). */
function touchingLabels(lot, layer) {
  const out = new Set();
  const b = asPts(lot.boundary);
  for (const f of layer.features) {
    const touches = f.rings.some((p) => p.outer.some((q) => pointInRing([q.x, q.y], b)) || coverageOfLot(lot, { features: [{ rings: [p] }] }, 12).hit);
    if (touches && f.label) out.add(f.label);
  }
  return [...out];
}

/**
 * The summary card rows for "Site constraints (indicative)":
 * [{ id, title, answer: 'Yes' | 'No mapped' | 'Not available' | 'Not checked', detail, source, date, hit }]
 * Never states compliance. Layers with no open service return 'Not available' so the card never implies an all clear.
 */
export function constraintSummary(lot) {
  const ov = lot?.overlays;
  const rows = [];
  for (const id of OVERLAY_IDS) {
    const style = OVERLAY_STYLE[id];
    const layer = ov?.layers?.find((l) => l.id === id);
    if (!layer) {
      if (id === 'easement' && lot?.state === 'NSW') rows.push({ id, title: style.title === 'Easement' ? 'Easements' : style.title, answer: 'Not available', detail: 'NSW easements are not in the open cadastre service. Check the registered plan and title, and Sydney Water or other authority records.', source: '', date: null, hit: false });
      else rows.push({ id, title: id === 'easement' ? 'Easements' : style.title, answer: 'Not checked', detail: '', source: '', date: null, hit: false });
      continue;
    }
    const title = id === 'easement' ? 'Easements' : style.title;
    if (layer.status === 'unavailable') { rows.push({ id, title, answer: 'Not available', detail: layer.note || 'No open state service is wired for this layer. Check the council planning scheme overlay maps.', source: layer.source, date: layer.date, hit: false }); continue; }
    if (layer.status === 'error') { rows.push({ id, title, answer: 'Not checked', detail: layer.note || 'The government map service did not answer. Try again later.', source: layer.source, date: layer.date, hit: false }); continue; }
    const cov = coverageOfLot(lot, layer);
    if (cov.hit) {
      const labels = touchingLabels(lot, layer);
      const what = labels.length ? `${labels.slice(0, 3).join('; ')}${labels.length > 3 ? ` and ${labels.length - 3} more` : ''}. ` : '';
      rows.push({ id, title, answer: 'Yes', detail: `${what}Mapped over ${pct(cov.fraction)}.`, source: layer.source, date: layer.date, hit: true });
    } else {
      const near = layer.features.length ? 'Mapped nearby but not over the lot.' : 'None mapped over the lot or the area around it.';
      rows.push({ id, title, answer: 'No mapped', detail: near, source: layer.source, date: layer.date, hit: false });
    }
  }
  return rows;
}

/** Legend entries for whichever overlay layers are switched on and have data (2D plan, plan set sheet). */
export function legendEntries(lot) {
  return drawableLayers(lot).filter((l) => overlayOn(lot, l.id)).map((l) => ({ id: l.id, label: l.label, rgb: OVERLAY_STYLE[l.id].rgb, hatch: OVERLAY_STYLE[l.id].hatch }));
}

/** Request parameters for GET /api/site/overlays from a stored site.lot (plan mm): the lot box plus a margin, in MGA metres. */
export function overlayRequestFor(lot, marginM = 100) {
  if (!lot?.origin || !lot.srid || !lot.boundary?.length) return null;
  const xs = lot.boundary.map((p) => p.x / 1000);
  const ys = lot.boundary.map((p) => -p.y / 1000);
  const r = (v) => Math.round(v * 10) / 10;
  const minE = lot.origin.e + Math.min(...xs) - marginM;
  const maxE = lot.origin.e + Math.max(...xs) + marginM;
  const minN = lot.origin.n + Math.min(...ys) - marginM;
  const maxN = lot.origin.n + Math.max(...ys) + marginM;
  return { state: lot.state, srid: lot.srid, origin: `${lot.origin.e},${lot.origin.n}`, bbox: `${r(minE)},${r(minN)},${r(maxE)},${r(maxN)}` };
}
