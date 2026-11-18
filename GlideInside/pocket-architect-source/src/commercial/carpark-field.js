// Bay fill for the automatic commercial car park, worked out in the lot frame (s along the frontage, t inward from it), plain mm, no DOM.
//
// The car park is one comb: a spine aisle that runs inward from the street crossover, and cross aisles that leave the spine at right angles on
// both sides. Every cross aisle is double loaded (a row of bays on each side, 90 degrees to the aisle) and every row runs the same bay
// pitch outward from the spine edge, so bays are contiguous, square and in line from one aisle to the next. The rows are always parallel to
// the frontage (the frame is the lot's own), never skewed. A cross aisle that ends at a boundary or a building carries a 1 m turning
// extension past its last bay (AS/NZS 2890.1), so no aisle is a dead end a car cannot back out of. Rows shorter than MIN_ROW bays are not laid
// (no orphan strips), the module offset is searched so the rows sit flush against the first obstacle, and only as much of the comb as the
// bay demand needs is laid (rows are trimmed together to a common length, never ragged).
//
// fillField({ ok, ... }) -> { spine, aisles, rows, count, cols } (all in frame mm), or null when no aisle fits.
//   ok(s0, s1, t0, t1, spine) must say whether the axis aligned rectangle is free to pave (inside the lot margins, clear of buildings).

export const BAY_W = 2600;
export const BAY_L = 5400;
export const AISLE_CAR = 6200;
export const TURN_MM = 1000;
export const MIN_ROW = 3;

const cache = (fn) => { const m = new Map(); return (a, b, c, d, e) => { const k = `${Math.round(a)},${Math.round(b)},${Math.round(c)},${Math.round(d)},${e ? 1 : 0}`; let v = m.get(k); if (v === undefined) { v = !!fn(a, b, c, d, e); m.set(k, v); } return v; }; };

/**
 * One cross aisle at t = qa (centre line), on one side of the spine. side -1 runs toward smaller s, +1 toward larger s.
 * Returns { side, qa, up, down, len } : the bays in the row on the smaller t side (up) and the larger t side (down), and the aisle length
 * from the spine edge including the turning extension. Rows are contiguous from the spine edge outward.
 */
function sideOf(ok, side, qa, spEdge, { A, D, bayW, maxCols }) {
  let up = 0; let down = 0; let ais = 0;
  let upLive = true; let downLive = true;
  for (let k = 1; k <= maxCols; k++) {
    const a = side < 0 ? spEdge - k * bayW : spEdge + (k - 1) * bayW;
    const b = a + bayW;
    if (!ok(a, b, qa - A / 2, qa + A / 2)) break;
    ais = k;
    if (upLive && ok(a, b, qa - A / 2 - D, qa - A / 2)) up = k; else upLive = false;
    if (downLive && ok(a, b, qa + A / 2, qa + A / 2 + D)) down = k; else downLive = false;
    if (!upLive && !downLive) break;
  }
  return { side, qa, up, down, ais };
}

/** The side, with its rows shortened until the turning extension past the last bay is free; rows shorter than MIN_ROW are dropped. */
function settle(ok, sd, spEdge, { A, bayW }) {
  let { up, down } = sd;
  if (up < MIN_ROW) up = 0;
  if (down < MIN_ROW) down = 0;
  let n = Math.max(up, down);
  while (n > 0) {
    const end = sd.side < 0 ? spEdge - n * bayW : spEdge + n * bayW;
    const ext = sd.side < 0 ? [end - TURN_MM, end] : [end, end + TURN_MM];
    if (ok(ext[0], ext[1], sd.qa - A / 2, sd.qa + A / 2)) break;
    n--; up = Math.min(up, n); down = Math.min(down, n);
    if (up < MIN_ROW) up = 0;
    if (down < MIN_ROW) down = 0;
    n = Math.max(up, down);
  }
  if (n === 0) return { ...sd, up: 0, down: 0, n: 0 };
  return { ...sd, up, down, n };
}

/** True when field `a` is a better car park than `b`: it meets the demand, then it has double loaded aisles, then it paves less. */
export function betterField(a, b, wanted) {
  if (!a) return false;
  if (!b) return true;
  const ma = a.count >= wanted; const mb = b.count >= wanted;
  if (ma !== mb) return ma;
  if (!ma) return a.count > b.count;
  if ((a.double > 0) !== (b.double > 0)) return a.double > 0;
  return a.cost < b.cost;
}

export function fillField(o) {
  const A = o.aisleW || AISLE_CAR; const D = o.bayL || BAY_L; const bayW = o.bayW || BAY_W;
  const spineW = o.spineW || A;
  const ok = cache(o.ok);
  const sp = o.sp;
  const spL = sp - spineW / 2; const spR = sp + spineW / 2;
  const tEnd = o.tEnd; const tStart = o.tStart ?? 0;
  const period = 2 * D + A;
  const maxCols = Math.max(1, Math.ceil(((o.sMax - o.sMin) || 100000) / bayW));
  const opts = { A, D, bayW, maxCols };
  // The spine runs from the street as far as it stays free.
  let reach = tStart; let t0 = null;
  for (let t = tStart; t < tEnd; t += 250) {
    if (ok(spL, spR, t, Math.min(tEnd, t + 250), true)) { if (t0 === null) t0 = t; reach = Math.min(tEnd, t + 250); } else if (t0 !== null) break;
  }
  if (t0 === null || (o.spineFromStart && t0 > tStart + 500)) return null; // the spine has to start at the street (or at the drive that feeds it), never beyond a building or apron
  const tFirst = Math.max(o.tFirst, t0 + (o.leadIn || 0));
  if (reach - tFirst < A) return null;
  const memo = new Map();
  const aisleAt = (qa) => {
    const k = Math.round(qa);
    if (memo.has(k)) return memo.get(k);
    let r = null;
    if (qa + A / 2 <= reach + 1 && qa - A / 2 >= tFirst - 1) {
      const sides = [-1, 1].map((sd) => settle(ok, sideOf(ok, sd, qa, sd < 0 ? spL : spR, opts), sd < 0 ? spL : spR, opts));
      const bays = sides.reduce((s, x) => s + x.up + x.down, 0);
      r = { qa, sides, bays };
    }
    memo.set(k, r);
    return r;
  };
  const nearT = (o.near && Number.isFinite(o.near.t)) ? o.near.t : tFirst;
  const colsOf = (a, cap) => a.sides.map((sd) => ({ ...sd, up: sd.up >= MIN_ROW ? Math.min(sd.up, cap) : 0, down: sd.down >= MIN_ROW ? Math.min(sd.down, cap) : 0 }));
  const baysOf = (a, cap) => colsOf(a, cap).reduce((s, x) => s + x.up + x.down, 0);
  const areaOf = (a, cap) => colsOf(a, cap).reduce((s, x) => { const n = Math.max(x.up, x.down); const ais = (n * bayW + TURN_MM) * A; return s + (n ? ais + (x.up + x.down) * bayW * D + (x.up && x.down ? 0 : ais) : 0); }, 0); // an aisle with a row on one side only is charged twice: double loaded wins
  /** The smallest part of an offset's aisles that meets the demand: nearest aisles first, rows cut together to a common length. */
  const plan = (list) => {
    const ordered = list.slice().sort((p, q) => Math.abs(p.qa - nearT) - Math.abs(q.qa - nearT));
    const maxCap = Math.max(...list.flatMap((a) => a.sides.map((sd) => Math.max(sd.up, sd.down))));
    let best = null;
    for (let k = 1; k <= ordered.length; k++) {
      const use = ordered.slice(0, k);
      let cap = MIN_ROW;
      while (cap < maxCap && use.reduce((s, a) => s + baysOf(a, cap), 0) < o.wanted) cap++;
      const count = use.reduce((s, a) => s + baysOf(a, cap), 0);
      const far = Math.max(...use.map((a) => a.qa + A / 2));
      const cost = use.reduce((s, a) => s + areaOf(a, cap), 0) + (far - tFirst) * spineW * 0.2;
      const score = Math.min(count, o.wanted) * 1e9 - cost;
      if (!best || score > best.score) best = { score, k, cap, count, cost, use };
    }
    return best;
  };
  const evalOff = (off) => {
    const qa0 = tFirst + A / 2 + off;
    const list = [];
    for (let qa = qa0; qa + A / 2 <= reach + 1; qa += period) { const a = aisleAt(qa); if (a && a.bays > 0) list.push(a); }
    if (!list.length) return { score: -Infinity, off, list, pl: null };
    const pl = plan(list);
    const dn = Math.min(...pl.use.map((a) => Math.abs(a.qa - nearT)));
    return { score: pl.score - dn * 3e3, off, list, pl };
  };
  let best = null;
  for (let off = 0; off < period; off += 400) { const r = evalOff(off); if (!best || r.score > best.score) best = r; }
  if (best && best.pl) { const c0 = best.off; for (let off = Math.max(0, c0 - 400); off <= Math.min(period - 100, c0 + 400); off += 100) { const r = evalOff(off); if (r.score > best.score) best = r; } }
  if (!best || !best.pl) return null;
  const pick = { k: best.pl.k, cap: best.pl.cap };
  const ordered = best.pl.use;
  // A cap that cuts a row below MIN_ROW on one side but not the other is raised, so no side is left with an orphan strip.
  const chosen = ordered.slice(0, pick.k).sort((p, q) => p.qa - q.qa);
  const aisles = []; const rows = [];
  let count = 0;
  for (const a of chosen) {
    const sides = colsOf(a, pick.cap).map((sd) => {
      const n = Math.max(sd.up, sd.down);
      return { ...sd, n };
    }).filter((sd) => sd.n > 0);
    if (!sides.length) continue;
    const entry = { qa: a.qa, sides: [] };
    for (const sd of sides) {
      const edge = sd.side < 0 ? spL : spR;
      const end = edge + sd.side * (sd.n * bayW + TURN_MM);
      entry.sides.push({ side: sd.side, n: sd.n, edge, end, s0: Math.min(edge, end), s1: Math.max(edge, end) });
      for (const [dir, cnt] of [[-1, sd.up], [1, sd.down]]) {
        if (!cnt) continue;
        const tA = dir < 0 ? a.qa - A / 2 - D : a.qa + A / 2; // far/near t of the row
        const bays = [];
        for (let i = 0; i < cnt; i++) {
          const s0 = sd.side < 0 ? edge - (i + 1) * bayW : edge + i * bayW;
          bays.push({ s0, s1: s0 + bayW, t0: tA, t1: tA + D, col: i });
        }
        rows.push({ qa: a.qa, side: sd.side, dir, t0: tA, t1: tA + D, aisleEdge: dir < 0 ? tA + D : tA, bays });
        count += cnt;
      }
    }
    if (entry.sides.length) aisles.push(entry);
  }
  if (!aisles.length) return null;
  const last = Math.max(...aisles.map((a) => a.qa + A / 2));
  // The spine meets the street at tStart and ends flush with the far edge of the last aisle.
  const double = aisles.reduce((n, a) => n + a.sides.filter((sd) => sd.up && sd.down).length, 0);
  return { spine: { s0: spL, s1: spR, t0, t1: Math.min(reach, last) }, aisles, rows, count, double, cost: best.pl.cost, cols: pick.cap, aisleW: A, bayL: D, bayW };
}

/**
 * Write a field out as plain world polygons. `world(s, t)` maps frame mm to plan mm and `frame` is { u, n } (world unit vectors of s and t).
 * Returns { aisles: [{ id, polygon, centre, widthMm, kind, turn? }], rows: [{ rowId, slots, bayAreas, frame, length, carport }], paved: [{ id, polygon }] }.
 * Bay polygons run aisle edge first: [aisle a, aisle b, back b, back a], so p0 p1 is the open end and p3 p2 the closed end.
 * Aisle polygons never overlap: the spine is one rectangle and each cross aisle is a rectangle on one side of it.
 */
export function fieldGeometry(field, world, frame, { spineKind = 'aisle' } = {}) {
  const R = (s0, s1, t0, t1) => [world(s0, t0), world(s1, t0), world(s1, t1), world(s0, t1)];
  const A = field.aisleW;
  const aisles = []; const paved = [];
  const sp = field.spine;
  const addAisle = (id, s0, s1, t0, t1, kind, extra = {}) => {
    const polygon = R(s0, s1, t0, t1);
    const wide = Math.abs(t1 - t0) < Math.abs(s1 - s0);
    const centre = wide ? [world(s0, (t0 + t1) / 2), world(s1, (t0 + t1) / 2)] : [world((s0 + s1) / 2, t0), world((s0 + s1) / 2, t1)];
    aisles.push({ id, polygon, centre, widthMm: wide ? t1 - t0 : s1 - s0, kind, ...extra });
    paved.push({ id: id.replace('sw:aisle:', 'sw:paved:'), polygon });
  };
  let k = 0;
  addAisle(`sw:aisle:${k++}`, sp.s0, sp.s1, sp.t0, sp.t1, spineKind, { spine: true });
  for (const a of field.aisles) for (const sd of a.sides) addAisle(`sw:aisle:${k++}`, sd.s0, sd.s1, a.qa - A / 2, a.qa + A / 2, 'aisle', { cross: true, turn: { atEnd: sd.side } });
  const rows = field.rows.map((r, i) => {
    const bays = r.bays.slice().sort((p, q) => p.s0 - q.s0);
    const slots = bays.map((b, j) => {
      const e = r.dir < 0 ? b.t1 : b.t0; const far = r.dir < 0 ? b.t0 : b.t1; // aisle edge and back of the bay
      const poly = [world(b.s0, e), world(b.s1, e), world(b.s1, far), world(b.s0, far)];
      return { index: j, kind: 'bay', poly, centre: world((b.s0 + b.s1) / 2, (b.t0 + b.t1) / 2) };
    });
    const s0 = bays[0].s0; const s1 = bays[bays.length - 1].s1;
    const bayAreas = [{ id: `sw:bays:${i}:0`, polygon: R(s0, s1, r.t0, r.t1) }];
    const o = world(s0, r.dir < 0 ? r.t1 : r.t0);
    const v = { x: frame.n.x * r.dir, y: frame.n.y * r.dir };
    return { rowId: `sw:bays:${i}`, buildingId: null, bayAreas, frame: { o, u: { x: frame.u.x, y: frame.u.y }, v, f: { x: -v.x, y: -v.y } }, length: slots.length * field.bayW, x0: 0, depth: 0, offsetMm: 0, slots, _fr: { s0, s1, t0: r.t0, t1: r.t1, dir: r.dir } };
  });
  return { aisles, rows, paved };
}

/**
 * Accessible bays with their shared zone, [bay][zone][bay], on the rows (slot lists) nearest `near` (frame mm, tested on slot centres in `frameOf`).
 * Returns the number of accessible bays provided. Groups of three first, then pairs, as the earlier layouts did.
 */
export function markAccessible(rows, want, distOf) {
  let provided = 0;
  if (want <= 0) return 0;
  const taken = new Set();
  const groups = [];
  for (const row of rows) for (let i = 0; i + 2 < row.slots.length; i++) groups.push({ row, i, size: 3, d: distOf(row.slots[i + 1]) });
  groups.sort((p, q) => p.d - q.d);
  for (const gr of groups) {
    if (provided + 2 > want && want - provided < 2) break;
    if (provided >= want) break;
    const ids = [0, 1, 2].map((k) => `${gr.row.rowId}:${gr.i + k}`);
    if (ids.some((x) => taken.has(x))) continue;
    ids.forEach((x) => taken.add(x));
    gr.row.slots[gr.i].kind = 'accessible'; gr.row.slots[gr.i + 1].kind = 'zone'; gr.row.slots[gr.i + 2].kind = 'accessible';
    provided += 2;
  }
  if (provided < want) {
    const pairs = [];
    for (const row of rows) for (let i = 0; i + 1 < row.slots.length; i++) pairs.push({ row, i, d: distOf(row.slots[i]) });
    pairs.sort((p, q) => p.d - q.d);
    for (const pr of pairs) {
      if (provided >= want) break;
      const a = `${pr.row.rowId}:${pr.i}`; const b = `${pr.row.rowId}:${pr.i + 1}`;
      if (taken.has(a) || taken.has(b)) continue;
      taken.add(a); taken.add(b);
      pr.row.slots[pr.i].kind = 'accessible'; pr.row.slots[pr.i + 1].kind = 'zone'; provided += 1;
    }
  }
  return provided;
}

/**
 * One continuous carport canopy per bay row: a single rectangle that runs the whole row, so neighbouring canopies sit hard against each other
 * (back to back rows share an edge) and the slab under it is the bay slab of the same rows. Posts stand on the closed (back) edge at every
 * second bay line and at both ends. `rows` are fieldGeometry rows (bay polygons run aisle edge first, back edge last).
 */
export function carportsOf(rows, heightMm = 2700) {
  return rows.filter((r) => r.slots.length).map((r, i) => {
    const sl = r.slots;
    const a = sl[0].poly; const z = sl[sl.length - 1].poly;
    const posts = [];
    sl.forEach((x, j) => { if (j % 2 === 0) posts.push({ x: x.poly[3].x, y: x.poly[3].y }); });
    posts.push({ x: z[2].x, y: z[2].y });
    const polygon = r.bayAreas[0].polygon;
    return { id: `sw:carport:${i}`, rowId: r.rowId, polygon, bays: sl.length, heightMm, posts, backEdge: [{ x: a[3].x, y: a[3].y }, { x: z[2].x, y: z[2].y }] };
  });
}
