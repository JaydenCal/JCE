// From an uploaded outline to a normal lot (the same object a looked up lot becomes), so the lot card, layouts, Best fit, checks, 2D, 3D
// and the plan set work unchanged. The lot is marked source 'upload'. Nothing here is checked against a title.

import { buildSiteLot } from '../model.js';
import { toLonLat } from './crs.js';
import { frameFor, lonLatToFrame, frameToLonLat, sridOf } from './frame.js';
import { unitFactor } from './units.js';
import { UploadError, openRing } from './parsers.js';
import { newCustomRules, needsCustomRules } from '../custom-rules.js';

export const USER_BOUNDARY_NOTE = 'Boundary supplied by user, not checked against title';

const RAD = Math.PI / 180;
const r3 = (v) => Math.round(v * 1000) / 1000;

const signed = (r) => { let s = 0; for (let i = 0; i < r.length; i++) { const a = r[i]; const b = r[(i + 1) % r.length]; s += a[0] * b[1] - b[0] * a[1]; } return s / 2; };
export const ringAreaM2 = (r) => Math.abs(signed(r));

/**
 * Step 1: every polygon of the file as longitude and latitude rings.
 * parsed: a reader result. opts: { crs, units, scale (unit to metre factor for xy numbers when the system is metric), placement }
 *   placement { lon, lat, rotationDeg }: no coordinate system; the outline (in file units) is placed so its middle sits on lon, lat, turned
 *   clockwise by rotationDeg, at a true scale from `units`. Used for "place it by hand" and for bearings entered without a start point.
 */
export function toLonLatPolygons(polys, parsed, { crs = null, units = 'm', placement = null } = {}) {
  const warnings = [];
  const f = unitFactor(units);
  const conv = (ring) => ring.map(([x, y]) => [x, y]);
  if (placement) {
    // Local metres about the outline's own middle, rotated, then laid on the chosen point in a frame centred there.
    const all = polys.flatMap((p) => p.ring);
    const cx = all.reduce((s, q) => s + q[0], 0) / all.length;
    const cy = all.reduce((s, q) => s + q[1], 0) / all.length;
    const frame = frameFor(placement.lon, placement.lat, { forceLocal: true });
    const o = lonLatToFrame(frame, placement.lon, placement.lat);
    const th = (placement.rotationDeg || 0) * RAD;
    const put = ([x, y]) => {
      const dx = (x - cx) * f;
      const dy = (y - cy) * f;
      // Clockwise rotation on a north up map (y up).
      const e = dx * Math.cos(th) + dy * Math.sin(th);
      const n = -dx * Math.sin(th) + dy * Math.cos(th);
      const ll = frameToLonLat(frame, o.e + e, o.n + n);
      return [ll.lon, ll.lat];
    };
    return { polys: polys.map((p) => ({ ...p, ring: p.ring.map(put), holes: (p.holes || []).map((h) => h.map(put)) })), warnings };
  }
  if (parsed.coordKind === 'lonlat' && (!crs || crs === 'wgs84')) return { polys: polys.map((p) => ({ ...p, ring: conv(p.ring), holes: (p.holes || []).map(conv) })), warnings };
  if (!crs) throw new UploadError('Choose the coordinate system of these numbers, or place the outline by hand on the aerial.', 'NEED_CRS');
  const scale = parsed.format === 'DXF' || parsed.format === 'Coordinates' ? f : 1; // drawing units apply to a DXF and to pasted numbers
  const proj = ([x, y]) => toLonLat(crs, x * scale, y * scale);
  return { polys: polys.map((p) => ({ ...p, ring: p.ring.map(proj), holes: (p.holes || []).map((h) => h.map(proj)) })), warnings };
}

/** Plausibility of a longitude and latitude ring set: returns a message when the points are not on Earth or the outline is huge. */
export function sanityCheck(polys) {
  for (const p of polys) {
    for (const [lon, lat] of p.ring) {
      if (!(Math.abs(lon) <= 180 && Math.abs(lat) <= 85)) return 'The outline is not on Earth. Check the coordinate system.';
    }
  }
  return null;
}

// Merging adjoining outlines: edges shared by two outlines (same two end points to the nearest centimetre, opposite directions) cancel and
// the remaining edges are chained into rings. Works on local metres. Returns { rings: [ring], merged: boolean } largest first.
export function mergeAdjoining(rings, tolM = 0.01) {
  const q = (v) => Math.round(v / tolM);
  const key = (p) => `${q(p[0])},${q(p[1])}`;
  const edges = new Map();
  for (const r0 of rings) {
    const r = signed(r0) < 0 ? r0.slice().reverse() : r0; // all counter clockwise
    for (let i = 0; i < r.length; i++) {
      const a = r[i];
      const b = r[(i + 1) % r.length];
      const ka = key(a);
      const kb = key(b);
      if (ka === kb) continue;
      const rev = `${kb}|${ka}`;
      if (edges.has(rev)) edges.delete(rev);
      else edges.set(`${ka}|${kb}`, [a, b]);
    }
  }
  if (edges.size === rings.reduce((s, r) => s + r.length, 0)) return { rings: rings.slice().sort((a, b) => ringAreaM2(b) - ringAreaM2(a)), merged: false };
  const next = new Map();
  for (const [k, [a, b]] of edges) { const ka = k.split('|')[0]; (next.get(ka) || next.set(ka, []).get(ka)).push({ a, b, used: false }); }
  const out = [];
  for (const list of next.values()) {
    for (const e0 of list) {
      if (e0.used) continue;
      const ring = [e0.a];
      let e = e0;
      for (let guard = 0; guard < 100000; guard++) {
        e.used = true;
        const kb = key(e.b);
        if (kb === key(e0.a)) break;
        ring.push(e.b);
        const cand = (next.get(kb) || []).find((x) => !x.used);
        if (!cand) break;
        e = cand;
      }
      if (ring.length >= 3) out.push(ring);
    }
  }
  out.sort((a, b) => ringAreaM2(b) - ringAreaM2(a));
  return { rings: out, merged: true };
}

// The shortest edge that is at least a fifth of the longest: the usual street frontage of a rectangular lot. A guess the person confirms.
export function guessFrontEdge(ringMm) {
  const n = ringMm.length;
  const len = (i) => Math.hypot(ringMm[(i + 1) % n].x - ringMm[i].x, ringMm[(i + 1) % n].y - ringMm[i].y);
  const ls = ringMm.map((_, i) => len(i));
  const max = Math.max(...ls);
  let best = 0;
  let bl = Infinity;
  ls.forEach((l, i) => { if (l >= max * 0.2 && l < bl) { bl = l; best = i; } });
  return best;
}

/**
 * Step 2: a lot from polygons in longitude and latitude.
 * input: { polys: [{ name, ring, holes }], name, merge, forceLocal, currency }
 * Returns { resp, frame, centre: { lon, lat }, bbox (frame metres, whole lot), warnings, lotName, parts }
 * `resp` has the shape buildSiteLot takes (a looked up lot response).
 */
export function lotResponseFromPolygons({ polys, name = '', merge = false, forceLocal = false }) {
  const warnings = [];
  if (!polys?.length) throw new UploadError('There is no outline to use.', 'NO_AREA');
  const bad = sanityCheck(polys);
  if (bad) throw new UploadError(bad, 'OFF_EARTH');
  const flat = polys.flatMap((p) => p.ring);
  const lon0 = flat.reduce((s, q) => s + q[0], 0) / flat.length;
  const lat0 = flat.reduce((s, q) => s + q[1], 0) / flat.length;
  const frame = frameFor(lon0, lat0, { forceLocal });
  const abs = (ring) => ring.map(([lon, lat]) => { const p = lonLatToFrame(frame, lon, lat); return [p.e, p.n]; });
  let rings = polys.map((p) => ({ outer: abs(p.ring), holes: (p.holes || []).map(abs) }));
  if (merge && rings.length > 1) {
    const m = mergeAdjoining(rings.map((r) => r.outer));
    if (m.merged && m.rings.length === 1) rings = [{ outer: m.rings[0], holes: rings.flatMap((r) => r.holes) }];
    else if (m.merged) { rings = m.rings.map((r) => ({ outer: r, holes: [] })); warnings.push('The outlines were joined where they touch, but some are separate. The largest is the lot and the others are shown as further parts.'); }
    else warnings.push('The outlines do not share an edge, so they could not be joined. The largest is the lot and the others are shown as further parts.');
  }
  rings.sort((a, b) => ringAreaM2(b.outer) - ringAreaM2(a.outer));
  const main = rings[0];
  const cx = main.outer.reduce((s, q) => s + q[0], 0) / main.outer.length;
  const cy = main.outer.reduce((s, q) => s + q[1], 0) / main.outer.length;
  const origin = { e: r3(cx), n: r3(cy) };
  const rel = (ring) => ring.map(([e, n]) => [r3(e - origin.e), r3(n - origin.n)]);
  const polygons = rings.map((r) => ({ outer: rel(r.outer), holes: r.holes.map(rel) }));
  const area = rings.reduce((s, r) => s + ringAreaM2(r.outer) - r.holes.reduce((a, h) => a + ringAreaM2(h), 0), 0);
  const all = rings.flatMap((r) => r.outer);
  const bbox = { minE: Math.min(...all.map((q) => q[0])), maxE: Math.max(...all.map((q) => q[0])), minN: Math.min(...all.map((q) => q[1])), maxN: Math.max(...all.map((q) => q[1])) };
  const centre = frameToLonLat(frame, origin.e, origin.n);
  const { srid, zone } = sridOf(frame);
  const lotName = String(name || polys[0].name || '').trim() || 'Uploaded boundary';
  const resp = {
    state: frame.state || '', srid, zone, origin, lga: '', zoning: null,
    zoneNote: frame.kind === 'mga' ? 'Zone and council were not looked up for an uploaded boundary. Choose the zone class if asked.' : 'No zone or council lookup outside NSW and Queensland. Set the site rules yourself.',
    attribution: USER_BOUNDARY_NOTE, retrieved: new Date().toISOString(),
    lot: { lotLabel: lotName, lotNumber: '', planLabel: '', areaM2: Math.round(area * 10) / 10, registeredAreaM2: null, polygons, bboxMga: bbox },
    neighbours: [], roads: [],
  };
  return { resp, frame, centre, bbox, warnings, lotName, parts: polygons.length };
}

/**
 * Step 3: the lot object. `aerial` is { meta, key } pairs from the aerial step (may be null). The frontage edge is a guess until the person
 * clicks one (the existing frontage step confirms it). Returns the site.lot object.
 */
export function buildUploadedLot(built, { aerialMeta = null, aerialKey = null, aerialWideMeta = null, aerialWideKey = null, warnings = [], commercial = false, forceCustom = false, currency = 'AUD' } = {}) {
  const lot = buildSiteLot({ lot: built.resp, aerialMeta, aerialKey, aerialWideMeta, aerialWideKey, contours: null, address: built.lotName, source: 'upload', warnings: [...built.warnings, ...warnings] });
  lot.frame = built.frame;
  lot.lonLat = { lon: built.centre.lon, lat: built.centre.lat };
  lot.userBoundary = true;
  lot.boundaryNote = USER_BOUNDARY_NOTE;
  lot.provenance = { ...lot.provenance, lot: { attribution: USER_BOUNDARY_NOTE, retrieved: built.resp.retrieved } };
  lot.frontEdges = [guessFrontEdge(lot.boundary)];
  lot.cornerLot = false;
  lot.frontageMethod = 'guess';
  lot.frontageConfirmed = false;
  if (forceCustom || needsCustomRules(lot)) lot.customRules = newCustomRules({ commercial, on: true, currency });
  return lot;
}
