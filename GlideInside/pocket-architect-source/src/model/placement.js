// House placement on a real lot: the building footprint, the setback envelope check, the fall across the lot, and moving or
// rotating the whole house. Pure functions, no DOM. It only READS project.site.lot as written by src/site/model.js (branch
// claude/glide-site-lookup): boundary, terrain { cols, rows, cellMm, x0, y0, values }, contours [{ level, pts: [x, y, ...] }],
// floorRL and floorRLAuto, plus the setback stage's setbacks, envelope and frontEdges (all null or missing until loaded).
// Plan units are mm (x right, y down); setbacks and RL are in metres. Nothing here invents a setback.

import * as G from './geometry.js';

export const NOT_LOADED = 'Council setbacks are not loaded for this lot.';
const TOL_MM = 5; // encroachments under 5 mm are rounding noise
const m = (mm) => Math.round(mm) / 1000;
const finite = (v) => typeof v === 'number' && Number.isFinite(v);
const roundMm = (v) => Math.round(v);

/** The lot when the project has a usable one (a boundary of three or more points), otherwise null. */
export function lotOf(project) {
  const lot = project?.site?.lot;
  return lot && Array.isArray(lot.boundary) && lot.boundary.length >= 3 && lot.boundary.every((p) => finite(p?.x) && finite(p?.y)) ? lot : null;
}

// Footprint -------------------------------------------------------------------------------------------------------------
/**
 * Solid building outlines (rooms that are indoor or roofed, on every level, excluding demolished) plus the points of
 * exterior wall bodies. Returns { solids: [poly], points: [pt] } or null when nothing is built.
 */
export function footprint(project) {
  const solids = [];
  const points = [];
  for (const level of project?.levels || []) {
    for (const r of level.rooms || []) {
      if (r.status === 'demolish' || (r.outdoor && !r.roofed) || !Array.isArray(r.polygon) || r.polygon.length < 3) continue;
      solids.push(r.polygon);
      points.push(...r.polygon);
    }
    for (const w of level.walls || []) {
      if (w.kind !== 'exterior' || w.status === 'demolish') continue;
      points.push(...G.wallPolygon(w));
    }
  }
  return points.length ? { solids, points } : null;
}

// Setback sources and review flags ---------------------------------------------------------------------------------------
const RULES = ['front', 'side', 'rear', 'secondaryFront', 'garage'];
// A rule value in metres. Accepts a plain number, the setback stage's slot { minM, clause, page, dcp, edition, flag }
// (src/site/setbacks.js pickRules) or the older { value } form.
const metres = (v) => (finite(v) ? v : finite(v?.minM) ? v.minM : finite(v?.value) ? v.value : null);
const isFlag = (o) => !!o && (o.checkWithCouncil === true || o.check_with_council === true || o.needsReview === true || o.confidence === 'low' || o.flag === 'check_with_council');

/** Plain name of where a rule came from: the council DCP clause, the Codes SEPP Housing Code, or the QDC default. */
export function sourceLabel(src) {
  if (!src) return null;
  const kind = `${src.basis || ''} ${src.kind || src.type || src.instrument || ''} ${src.dcp || ''}`;
  const clause = src.clause ? `cl ${String(src.clause).replace(/^cl\.?\s+/i, '')}` : null;
  if (/inland code/i.test(kind)) return ['Codes SEPP Inland Code', clause].filter(Boolean).join(' ');
  if (/sepp|housing code|codes/i.test(kind)) return ['Codes SEPP Housing Code', clause].filter(Boolean).join(' ');
  if (/qdc|queensland development code/i.test(kind)) return ['QDC default', clause].filter(Boolean).join(' ');
  const name = src.dcp || src.name || 'council DCP';
  return [name, clause, src.page && `p${src.page}`].filter(Boolean).join(' ');
}

/**
 * The loaded setback rules with their source and whether they are flagged "check with council" (needsReview or low
 * confidence). Flagged rules are still used. Reads setbacks.checkWithCouncil (a list of rule names or an object of
 * booleans), a flag on a source entry (with `rule` naming it) and per rule objects. Returns [{ rule, valueM, flagged, source }].
 */
export function setbackNotes(lot) {
  const sb = lot?.setbacks;
  if (!sb) return [];
  const listed = Array.isArray(sb.checkWithCouncil) ? sb.checkWithCouncil : Object.entries(sb.checkWithCouncil || {}).filter(([, v]) => v).map(([k]) => k);
  const sources = Array.isArray(sb.sources) ? sb.sources : [];
  return RULES.filter((r) => metres(sb[r]) != null).map((rule) => {
    const src = sources.find((x) => x?.rule === rule) || (sources.length === 1 && !sources[0]?.rule ? sources[0] : null);
    const own = sb[rule] && typeof sb[rule] === 'object' ? sb[rule] : null;
    // With per rule objects the flag is per rule (sb.flag is only their roll-up); plain numbers take the set's flag.
    const flagged = listed.includes(rule) || isFlag(own) || (!!src && isFlag(src)) || (!own && isFlag(sb));
    const ownSrc = own?.source || (own && (own.clause || own.dcp) ? { ...own, basis: own.basis || sb.basis } : null);
    return { rule, valueM: metres(sb[rule]), flagged, source: sourceLabel(ownSrc || src) };
  });
}

/** One sentence naming the flagged rules and their sources, or '' when none are flagged. */
export function flaggedSentence(lot) {
  const f = setbackNotes(lot).filter((n) => n.flagged);
  if (!f.length) return '';
  const name = (r) => (r === 'secondaryFront' ? 'secondary front' : r);
  return `Flagged check with council: ${f.map((n) => `${name(n.rule)} (${n.source || 'source not recorded'})`).join('; ')}. They are still used.`;
}

// Lot edges -------------------------------------------------------------------------------------------------------------
const isConvex = (poly) => {
  let sign = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const c = poly[(i + 2) % poly.length];
    const z = G.cross(G.sub(b, a), G.sub(c, b));
    if (Math.abs(z) < 1e-6) continue;
    if (sign && Math.sign(z) !== sign) return false;
    sign = Math.sign(z);
  }
  return true;
};

/** Inward unit normal of edge a->b for a polygon of the given signed area (y down). */
function inwardNormal(a, b, area) {
  const d = G.norm(G.sub(b, a));
  const n = { x: -d.y, y: d.x }; // to the right of travel on screen (y down)
  // A positive signed area is clockwise on screen, so the interior is on the right of travel.
  return area > 0 ? n : { x: -n.x, y: -n.y };
}

/**
 * Classify each boundary edge: front, secondaryFront, rear or side. The rear edge is the non-front edge that most nearly
 * faces the first front edge. With no frontEdges nothing can be classified and every edge is 'unknown'.
 */
export function classifyEdges(lot) {
  const b = lot.boundary;
  const fronts = (Array.isArray(lot.frontEdges) ? lot.frontEdges : []).filter((i) => Number.isInteger(i) && i >= 0 && i < b.length);
  const edge = (i) => ({ a: b[i], b: b[(i + 1) % b.length] });
  // The setback stage records its own classification (lot.setbacks.edgeKinds, one entry per boundary edge). Use it when
  // present so the check and the envelope agree edge for edge.
  const given = lot.setbacks?.edgeKinds;
  const KINDS = ['front', 'secondaryFront', 'side', 'rear'];
  const useGiven = Array.isArray(given) && given.length === b.length && given.every((k) => KINDS.includes(k));
  const kinds = useGiven ? [...given] : b.map(() => (fronts.length ? 'side' : 'unknown'));
  // Without it: on a corner lot the shortest street edge is the primary frontage (same rule as src/site/setbacks.js).
  const len = (i) => G.dist(b[i], b[(i + 1) % b.length]);
  const primary = fronts.length ? fronts.reduce((a, i) => (len(i) < len(a) ? i : a)) : -1;
  if (!useGiven) fronts.forEach((i) => (kinds[i] = i === primary ? 'front' : 'secondaryFront'));
  if (fronts.length && !useGiven) {
    const f = edge(primary);
    const df = G.norm(G.sub(f.b, f.a));
    let best = -1;
    let score = 0.7 * 0; // an edge must face the front within about 45 degrees
    b.forEach((_, i) => {
      if (kinds[i] !== 'side') return;
      const e = edge(i);
      const d = G.norm(G.sub(e.b, e.a));
      const facing = -G.dot(d, df);
      const s = facing >= 0.7 ? facing * G.dist(e.a, e.b) : 0;
      if (s > score) {
        score = s;
        best = i;
      }
    });
    if (best >= 0) kinds[best] = 'rear';
  }
  let sideNo = 0;
  return b.map((_, i) => {
    const kind = kinds[i];
    if (kind === 'side') sideNo += 1;
    const label = kind === 'front' ? 'front boundary' : kind === 'secondaryFront' ? 'secondary front boundary' : kind === 'rear' ? 'rear boundary' : kind === 'side' ? `side boundary ${sideNo}` : `boundary edge ${i + 1}`;
    return { index: i, kind, label, ...edge(i) };
  });
}

/** Required setback in metres for an edge kind, or null when the lot does not carry it. */
export function requiredFor(kind, setbacks) {
  if (!setbacks) return null;
  const v = kind === 'front' ? setbacks.front : kind === 'secondaryFront' ? setbacks.secondaryFront : kind === 'side' ? setbacks.side : kind === 'rear' ? setbacks.rear : null;
  return metres(v);
}

// Envelope --------------------------------------------------------------------------------------------------------------
function clipHalfPlane(poly, a, n, offset) {
  const out = [];
  const val = (p) => G.dot(G.sub(p, a), n) - offset;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    const vp = val(p);
    const vq = val(q);
    if (vp >= 0) out.push(p);
    if ((vp >= 0) !== (vq >= 0)) out.push(G.lerp(p, q, vp / (vp - vq)));
  }
  return out;
}

/**
 * The building envelope. Uses lot.envelope when given. Otherwise it is derived from the setbacks by moving each boundary
 * edge inward (convex lots only). Returns { polygon, source: 'lot'|'derived', missing: [kinds without a setback] } or
 * { polygon: null, reason }.
 */
export function envelopeOf(lot) {
  if (Array.isArray(lot.envelope) && lot.envelope.length >= 3) return { polygon: lot.envelope, source: 'lot', missing: [] };
  if (!lot.setbacks) return { polygon: null, reason: 'setbacks_not_loaded' };
  if (!isConvex(lot.boundary)) return { polygon: null, reason: 'envelope_missing' };
  const area = G.signedArea(lot.boundary);
  let poly = lot.boundary.map((p) => ({ ...p }));
  const missing = new Set();
  for (const e of classifyEdges(lot)) {
    const req = requiredFor(e.kind, lot.setbacks);
    if (req == null) {
      missing.add(e.kind);
      continue;
    }
    poly = clipHalfPlane(poly, e.a, inwardNormal(e.a, e.b, area), req * 1000);
    if (poly.length < 3) return { polygon: [], source: 'derived', missing: [...missing] };
  }
  return { polygon: poly, source: 'derived', missing: [...missing] };
}

const edgeDist = (p, poly) => Math.min(...G.polygonEdges(poly).map(([a, b]) => G.projectToSegment(p, a, b).d));
const inPoly = (p, poly) => poly.length >= 3 && G.pointInPolygon(p, poly);

// Which boundary edge does envelope edge (a, b) belong to: the nearest roughly parallel one.
function boundaryEdgeFor(a, b, edges) {
  const mid = G.lerp(a, b, 0.5);
  const d = G.norm(G.sub(b, a));
  let best = null;
  let bestD = Infinity;
  for (const e of edges) {
    const de = G.norm(G.sub(e.b, e.a));
    if (Math.abs(G.dot(d, de)) < 0.9) continue;
    const dist = G.projectToSegment(mid, e.a, e.b).d;
    if (dist < bestD) {
      bestD = dist;
      best = e;
    }
  }
  if (best) return best;
  for (const e of edges) {
    const dist = G.projectToSegment(mid, e.a, e.b).d;
    if (dist < bestD) {
      bestD = dist;
      best = e;
    }
  }
  return best;
}

/**
 * Deepest encroachment (mm) of a footprint on an envelope, per envelope edge index. A footprint point outside the
 * envelope counts, and so does an envelope corner that pokes into a building solid (an L shaped envelope).
 */
function encroachments(points, solids, env) {
  const edges = G.polygonEdges(env);
  const out = new Array(edges.length).fill(0);
  const convex = isConvex(env);
  const area = G.signedArea(env);
  // Outside depth of p past edge j (mm, positive when outside). A convex envelope is the intersection of its half planes, so
  // a corner point is charged to each edge it is past. A concave one only counts points that project onto the edge.
  const past = (p, j) => {
    const [a, b] = edges[j];
    const depth = -G.dot(G.sub(p, a), inwardNormal(a, b, area));
    if (convex) return depth;
    const t = G.projectToSegment(p, a, b).tRaw;
    return t >= 0 && t <= 1 ? depth : -Infinity;
  };
  for (const p of points) {
    if (inPoly(p, env)) continue;
    const ds = edges.map((_, j) => past(p, j));
    if (convex) {
      ds.forEach((d, j) => {
        if (d > TOL_MM) out[j] = Math.max(out[j], d);
      });
      continue;
    }
    // Concave: the point is outside the nearest edge it projects onto, not every edge it happens to be past.
    let best = -1;
    ds.forEach((d, j) => {
      if (d > TOL_MM && (best < 0 || d < ds[best])) best = j;
    });
    if (best >= 0) out[best] = Math.max(out[best], ds[best]);
    else {
      // A corner region: charge the nearest edge by distance.
      let bj = 0;
      let bd = Infinity;
      edges.forEach(([a, b], j) => {
        const d = G.projectToSegment(p, a, b).d;
        if (d < bd) {
          bd = d;
          bj = j;
        }
      });
      if (bd > TOL_MM) out[bj] = Math.max(out[bj], bd);
    }
  }
  env.forEach((v, i) => {
    for (const s of solids) {
      if (!inPoly(v, s)) continue;
      const d = edgeDist(v, s);
      if (d <= TOL_MM) continue;
      const prev = (i + env.length - 1) % env.length;
      out[i] = Math.max(out[i], d); // edge i leaves this corner
      out[prev] = Math.max(out[prev], d); // edge prev arrives at it
    }
  });
  return out;
}

/** Deepest encroachment of the footprint on the envelope in mm, or 0. Used to rank candidate positions. */
export function worstEncroachment(points, solids, env) {
  return Math.max(0, ...encroachments(points, solids, env));
}

/**
 * Check the design against the setbacks. Returns
 * { status: 'ok'|'breach'|'no_lot'|'no_building'|'setbacks_not_loaded'|'envelope_missing', message, breaches, ... }.
 * breaches: [{ edge, kind, label, breachM, requiredM }] sorted deepest first, in metres.
 */
function ruleInfo(lot, kind) {
  const n = setbackNotes(lot).find((x) => x.rule === kind);
  return n ? { flagged: n.flagged, source: n.source } : { flagged: false, source: null };
}

export function checkSetbacks(project) {
  const lot = lotOf(project);
  if (!lot) return { status: 'no_lot', message: 'No lot is loaded for this design, so there is nothing to check it against.', breaches: [] };
  const fp = footprint(project);
  if (!fp) return { status: 'no_building', message: 'There is no building on the plan to check.', breaches: [] };
  const env = envelopeOf(lot);
  if (!env.polygon) {
    return env.reason === 'setbacks_not_loaded'
      ? { status: 'setbacks_not_loaded', message: NOT_LOADED, breaches: [] }
      : { status: 'envelope_missing', message: 'The setback envelope is not available for this lot shape, so it cannot be checked.', breaches: [] };
  }
  if (env.polygon.length < 3) return { status: 'breach', message: 'The setbacks leave no room to build on this lot.', breaches: [], envelope: env.polygon, noRoom: true };

  const edges = classifyEdges(lot);
  const depths = encroachments(fp.points, fp.solids, env.polygon);
  const envEdges = G.polygonEdges(env.polygon);
  const byBoundary = new Map();
  depths.forEach((d, j) => {
    if (d <= TOL_MM) return;
    const be = boundaryEdgeFor(envEdges[j][0], envEdges[j][1], edges);
    if (!be) return;
    byBoundary.set(be.index, Math.max(byBoundary.get(be.index) || 0, d));
  });
  const breaches = [...byBoundary].map(([index, d]) => {
    const e = edges[index];
    return { edge: index, kind: e.kind, label: e.label, breachM: m(d), requiredM: requiredFor(e.kind, lot.setbacks), ...ruleInfo(lot, e.kind) };
  });

  // Garage to the front boundary, only when the lot carries a garage setback.
  const garageReq = lot.setbacks?.garage;
  if (finite(garageReq)) {
    for (const level of project.levels) {
      for (const r of level.rooms) {
        if (r.type !== 'garage' || r.status === 'demolish') continue;
        for (const e of edges.filter((x) => x.kind === 'front' || x.kind === 'secondaryFront')) {
          const n = inwardNormal(e.a, e.b, G.signedArea(lot.boundary));
          const gap = Math.min(...r.polygon.map((p) => G.dot(G.sub(p, e.a), n)));
          const short = garageReq * 1000 - gap;
          if (short > TOL_MM) breaches.push({ edge: e.index, kind: 'garage', label: `garage to ${e.label}`, breachM: m(short), requiredM: garageReq, ...ruleInfo(lot, 'garage') });
        }
      }
    }
  }
  breaches.sort((a, b) => b.breachM - a.breachM);
  const partial = (env.missing?.length ? ` Not checked, no setback loaded for: ${env.missing.join(', ')}.` : '') + (flaggedSentence(lot) ? ` ${flaggedSentence(lot)}` : '');
  return {
    status: breaches.length ? 'breach' : 'ok',
    message: breaches.length ? `Outside the indicative setback envelope: ${breaches.map((b) => `${b.label} by ${b.breachM.toFixed(2)} m`).join('; ')}.${partial}` : `Inside the indicative setback envelope.${partial}`,
    breaches,
    envelope: env.polygon,
    envelopeSource: env.source,
    missing: env.missing || [],
  };
}

// Moving and rotating the house ---------------------------------------------------------------------------------------
const houseThings = (level) => [...level.furniture, ...level.stairs];

/** Move walls, rooms, furniture and stairs on every level. Tanks and other site items stay where they are. */
export function translateHouse(project, dx, dy) {
  for (const l of project.levels) {
    for (const w of l.walls) {
      w.a = { x: roundMm(w.a.x + dx), y: roundMm(w.a.y + dy) };
      w.b = { x: roundMm(w.b.x + dx), y: roundMm(w.b.y + dy) };
    }
    for (const r of l.rooms) r.polygon = r.polygon.map((p) => ({ x: roundMm(p.x + dx), y: roundMm(p.y + dy) }));
    for (const it of houseThings(l)) {
      it.x = roundMm(it.x + dx);
      it.y = roundMm(it.y + dy);
    }
  }
}

/** Rotate the house clockwise on screen by deg about (cx, cy). */
export function rotateHouse(project, deg, c) {
  const rot = (p) => {
    const q = G.rotatePoint(p, c, deg);
    return { x: roundMm(q.x), y: roundMm(q.y) };
  };
  for (const l of project.levels) {
    for (const w of l.walls) {
      w.a = rot(w.a);
      w.b = rot(w.b);
    }
    for (const r of l.rooms) r.polygon = r.polygon.map(rot);
    for (const it of houseThings(l)) {
      const q = rot(it);
      it.x = q.x;
      it.y = q.y;
      it.rotation = (((Number(it.rotation) || 0) + deg) % 360 + 360) % 360;
    }
  }
}

export function houseCentre(project) {
  const fp = footprint(project);
  const bb = fp ? G.bbox(fp.points) : G.projectBounds(project, { includeTanks: false });
  return bb ? { x: bb.cx, y: bb.cy } : { x: 0, y: 0 };
}

/**
 * Suggest where the house could sit. align: 'centre' | 'front' | 'rear'. Searches translations on a 250 mm grid for one
 * that puts the footprint inside the envelope, preferring the one closest to the alignment target. Returns
 * { fits, dx, dy } in mm. When nothing fits it returns the least bad position with fits false and residualM.
 */
export function suggestPosition(project, align = 'centre') {
  const lot = lotOf(project);
  const fp = footprint(project);
  if (!lot || !fp) return { ok: false, reason: lot ? 'no_building' : 'no_lot' };
  const env = envelopeOf(lot);
  if (!env.polygon) return { ok: false, reason: env.reason };
  if (env.polygon.length < 3) return { ok: false, reason: 'no_room' };
  const step = 250;
  const ebb = G.bbox(env.polygon);
  const fbb = G.bbox(fp.points);
  const edges = classifyEdges(lot);
  const wantKind = align === 'rear' ? 'rear' : 'front';
  const target = edges.find((e) => e.kind === wantKind) || null;
  const envCentre = G.polygonCentroid(env.polygon);
  const crit = (dx, dy) => {
    if ((align === 'front' || align === 'rear') && target) {
      let d = Infinity;
      for (const p of fp.points) d = Math.min(d, G.projectToSegment({ x: p.x + dx, y: p.y + dy }, target.a, target.b).d);
      return d;
    }
    return Math.hypot(fbb.cx + dx - envCentre.x, fbb.cy + dy - envCentre.y);
  };
  const dx0 = ebb.minX - fbb.minX;
  const dy0 = ebb.minY - fbb.minY;
  const nx = Math.floor((ebb.w - fbb.w) / step);
  const ny = Math.floor((ebb.h - fbb.h) / step);
  let best = null;
  let bestWorst = null;
  const move = (pts, dx, dy) => pts.map((p) => ({ x: p.x + dx, y: p.y + dy }));
  for (let i = Math.min(0, nx); i <= Math.max(0, nx) + 1; i++) {
    for (let j = Math.min(0, ny); j <= Math.max(0, ny) + 1; j++) {
      const dx = roundMm(dx0 + i * step);
      const dy = roundMm(dy0 + j * step);
      const worst = worstEncroachment(move(fp.points, dx, dy), fp.solids.map((s) => move(s, dx, dy)), env.polygon);
      if (worst <= TOL_MM) {
        const c = crit(dx, dy);
        if (!best || c < best.c) best = { dx, dy, c };
      } else if (!bestWorst || worst < bestWorst.worst) bestWorst = { dx, dy, worst };
    }
  }
  if (best) return { ok: true, fits: true, dx: best.dx, dy: best.dy, align };
  return { ok: true, fits: false, dx: bestWorst?.dx ?? 0, dy: bestWorst?.dy ?? 0, residualM: m(bestWorst?.worst ?? 0), align };
}

// Fall across the lot -----------------------------------------------------------------------------------------------
function samples(lot) {
  const out = [];
  const t = lot.terrain;
  if (t && Array.isArray(t.values) && t.cols > 0 && t.rows > 0 && finite(t.cellMm)) {
    for (let r = 0; r < t.rows; r++) {
      for (let c = 0; c < t.cols; c++) {
        const z = t.values[r * t.cols + c];
        if (finite(z)) out.push({ x: t.x0 + c * t.cellMm, y: t.y0 + r * t.cellMm, z });
      }
    }
  }
  if (!out.length && Array.isArray(lot.contours)) {
    for (const line of lot.contours) {
      const pts = line.pts || [];
      for (let i = 0; i + 1 < pts.length; i += 2) if (finite(line.level) && finite(pts[i]) && finite(pts[i + 1])) out.push({ x: pts[i], y: pts[i + 1], z: line.level });
    }
  }
  const inside = out.filter((p) => G.pointInPolygon(p, lot.boundary));
  const use = inside.length >= 3 ? inside : out;
  if (use.length > 2000) {
    const k = Math.ceil(use.length / 2000);
    return use.filter((_, i) => i % k === 0);
  }
  return use;
}

const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

/**
 * Fall across the lot from the levels grid, or the contours when there is no grid. A plane is fitted to the samples.
 * Returns null when there is no level data, otherwise { minRL, maxRL, fallM, slopePct, direction, bearingDeg }.
 */
export function fallAcross(project) {
  const lot = lotOf(project);
  if (!lot) return null;
  const s = samples(lot);
  if (s.length < 3) return null;
  const n = s.length;
  const mx = s.reduce((a, p) => a + p.x, 0) / n;
  const my = s.reduce((a, p) => a + p.y, 0) / n;
  const mz = s.reduce((a, p) => a + p.z, 0) / n;
  let sxx = 0, sxy = 0, syy = 0, sxz = 0, syz = 0;
  for (const p of s) {
    const x = (p.x - mx) / 1000;
    const y = (p.y - my) / 1000;
    const z = p.z - mz;
    sxx += x * x; sxy += x * y; syy += y * y; sxz += x * z; syz += y * z;
  }
  const det = sxx * syy - sxy * sxy;
  const gx = Math.abs(det) > 1e-9 ? (sxz * syy - syz * sxy) / det : 0; // m of RL per m of plan x
  const gy = Math.abs(det) > 1e-9 ? (syz * sxx - sxz * sxy) / det : 0;
  const slope = Math.hypot(gx, gy);
  const rls = s.map((p) => p.z);
  let fallM = 0;
  if (slope > 0) {
    const along = lot.boundary.map((p) => gx * ((p.x - mx) / 1000) + gy * ((p.y - my) / 1000));
    fallM = Math.max(...along) - Math.min(...along);
  }
  let direction = null;
  let bearingDeg = null;
  if (slope > 0.002) {
    const th = (((Number(project.site?.northDeg) || 0) * Math.PI) / 180);
    const down = { x: -gx, y: -gy };
    const north = { x: Math.sin(th), y: -Math.cos(th) };
    const east = { x: Math.cos(th), y: Math.sin(th) };
    bearingDeg = (((Math.atan2(G.dot(down, east), G.dot(down, north)) * 180) / Math.PI) + 360) % 360;
    direction = COMPASS[Math.round(bearingDeg / 45) % 8];
  }
  return {
    minRL: Math.min(...rls),
    maxRL: Math.max(...rls),
    meanRL: mz,
    fallM: Math.round(fallM * 100) / 100,
    slopePct: Math.round(slope * 1000) / 10,
    direction,
    bearingDeg: bearingDeg == null ? null : Math.round(bearingDeg),
  };
}

/** Lot area, frontage and depth in metres from the boundary (frontage from the first front edge). */
export function lotDimensions(lot) {
  const b = lot.boundary;
  const area = finite(lot.areaM2) ? lot.areaM2 : G.polygonArea(b) / 1e6;
  const edges = classifyEdges(lot);
  const front = edges.find((e) => e.kind === 'front');
  if (!front) {
    const bb = G.bbox(b);
    return { areaM2: area, widthM: m(bb.w), depthM: m(bb.h), hasFront: false };
  }
  const n = inwardNormal(front.a, front.b, G.signedArea(b));
  const ds = b.map((p) => G.dot(G.sub(p, front.a), n));
  return { areaM2: area, frontageM: m(G.dist(front.a, front.b)), depthM: m(Math.max(...ds) - Math.min(...ds)), hasFront: true };
}
