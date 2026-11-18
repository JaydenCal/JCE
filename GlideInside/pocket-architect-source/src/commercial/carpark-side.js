// Side aisle car park for the automatic commercial layout, worked out in the lot frame (s along the frontage, t inward from it), plain mm, no DOM.
//
// One drive runs straight in from the street crossover (it is the truck route when the building has a loading apron: the apron and the drive to it are
// never used for bays). Staff and visitor bays are then put on ONE aisle placed to suit the office door, in rows of 90 degree bays on both sides of it:
//   'v'  a side aisle that runs inward (along t) beside the drive, joined to it by a connector aisle. This is the usual answer on a lot with an apron:
//        the rows sit along a side setback, face the building and are reached without crossing the apron.
//   'h'  an aisle across the lot (along s) that the drive meets, so the rows lie across the front of the building (the usual answer on a small lot).
// The first QUEUE_MM of the drive from the street is clear: no bay and no aisle junction inside it. Candidates are scored on the walk from the bays to the
// door plus the paving needed, and the cheapest one that meets the demand wins.
//
// sideField({ ok, gate, driveW, driveEnd, A, D, bayW, wanted, door, win, truck }) -> field | null, field.count < wanted when the lot is short.
//   ok(s0, s1, t0, t1, spine) must say whether the axis aligned rectangle is free to pave (inside the lot margins, clear of buildings and the apron).
//   driveEnd is the t where the drive meets the truck apron, or null (the drive then ends at the aisle it feeds).

import { TURN_MM } from './carpark-field.js';

export const QUEUE_MM = 6000;

const key = (a, b, c, d, e) => `${Math.round(a)},${Math.round(b)},${Math.round(c)},${Math.round(d)},${e ? 1 : 0}`;
const hit = (a, b) => a.s0 < b.s1 - 1 && a.s1 > b.s0 + 1 && a.t0 < b.t1 - 1 && a.t1 > b.t0 + 1;

export function sideField(o) {
  const { A, D, bayW, wanted, door, win, gate, driveW } = o;
  const queue = o.queue ?? QUEUE_MM;
  const connMin = o.connMin ?? 4500; // an aisle (no bays) may leave the drive a little inside the queue length when the apron starts close to the street
  const memo = new Map();
  const ok = (s0, s1, t0, t1, sp) => { const k = key(s0, s1, t0, t1, sp); let v = memo.get(k); if (v === undefined) { v = !!o.ok(s0, s1, t0, t1, sp); memo.set(k, v); } return v; };
  const okR = (r, sp) => ok(r.s0, r.s1, r.t0, r.t1, sp);
  const gs0 = gate - driveW / 2; const gs1 = gate + driveW / 2;
  const truckEnd = Number.isFinite(o.driveEnd) ? o.driveEnd : null;
  const dist = (s, t) => Math.hypot(s - door.s, t - door.t) / 1000;
  const sLo = win.s0; const sHi = win.s1; const tHi = win.t1;
  const rectOf = (axis, p0, p1, q0, q1) => (axis === 'h' ? { s0: p0, s1: p1, t0: q0, t1: q1 } : { s0: q0, s1: q1, t0: p0, t1: p1 });
  const pOf = (axis, r) => (axis === 'h' ? [r.s0, r.s1] : [r.t0, r.t1]);

  /** Free runs [lo, hi] of the aisle strip at q (centre), along p, scanned every 250 mm. */
  const runsCache = new Map();
  const runsOf = (axis, q) => {
    const k = `${axis}${Math.round(q)}`;
    let runs = runsCache.get(k);
    if (runs) return runs;
    runs = [];
    const p0 = axis === 'h' ? sLo : Math.max(queue - A, 0); const p1 = axis === 'h' ? sHi : tHi;
    let a = null;
    for (let p = p0; p < p1; p += 250) {
      const r = rectOf(axis, p, Math.min(p1, p + 250), q - A / 2, q + A / 2);
      if (okR(r, false)) { if (a === null) a = p; } else if (a !== null) { runs.push([a, p]); a = null; }
    }
    if (a !== null) runs.push([a, p1]);
    runsCache.set(k, runs);
    return runs;
  };
  const runAround = (runs, lo, hi) => runs.find((r) => r[0] <= lo + 1 && r[1] >= hi - 1) || null;

  /** Bay slots of both rows of the aisle at q, absolute grid with one of PHASES offsets. Cached per (axis, q, phase). */
  const slotCache = new Map();
  const slotsOf = (axis, q, ph) => {
    const k = `${axis}${Math.round(q)}:${Math.round(ph)}`;
    let list = slotCache.get(k);
    if (list) return list;
    list = [];
    const p0 = (axis === 'h' ? sLo : 0) + ph; const p1 = axis === 'h' ? sHi : tHi;
    for (const row of [-1, 1]) {
      const q0 = row < 0 ? q - A / 2 - D : q + A / 2; const q1 = q0 + D;
      // Across the lot the rows are anchored on the drive edges (west rows end flush against the west edge of the drive, east rows start flush against the east edge),
      // so no strip of ground is left between a bay and the drive.
      const starts = [];
      if (axis === 'h') {
        for (let p = gs0; p - bayW >= sLo - 1; p -= bayW) starts.push(p - bayW);
        for (let p = gs1; p + bayW <= sHi + 1; p += bayW) starts.push(p);
      } else for (let p = p0; p + bayW <= p1 + 1; p += bayW) starts.push(p);
      for (const p of starts) {
        const r = rectOf(axis, p, p + bayW, q0, q1);
        if (r.t0 < queue) continue;
        if (!okR(r, false)) continue;
        const cs = (r.s0 + r.s1) / 2; const ct = (r.t0 + r.t1) / 2;
        list.push({ row, p0: p, p1: p + bayW, r, d: dist(cs, ct), q0, q1 });
      }
    }
    slotCache.set(k, list);
    return list;
  };

  let best = null; let bestShort = null;
  const evaluate = (c) => {
    // c: { axis, q, parts: [{kind, r, ...}], junction: [p0, p1] (the stretch of the aisle that the connector or drive uses), runs, others (rects bays must avoid) }
    const runs = runsOf(c.axis, c.q);
    const run = runAround(runs, c.junction[0], c.junction[1]);
    if (!run) return;
    const phases = new Set(c.axis === 'h' ? [0] : [0, 1, 2, 3, 4, 5].map((k) => Math.round((k * bayW) / 6)));
    // Down the lot the rows start flush against the connector (above or below it).
    if (c.axis === 'v') for (const e of c.junction) phases.add(Math.round(((e % bayW) + bayW) % bayW));
    for (const ph of phases) {
      const all = slotsOf(c.axis, c.q, ph).filter((x) => x.p0 >= run[0] + TURN_MM - 1 && x.p1 <= run[1] - TURN_MM + 1 && !c.avoid.some((a) => hit(a, x.r)));
      if (all.length < MIN_SLOTS) continue;
      const sorted = all.slice().sort((p, q) => p.d - q.d);
      const take = sorted.slice(0, Math.min(wanted, sorted.length));
      const lo = Math.min(...take.map((x) => x.p0)); const hi = Math.max(...take.map((x) => x.p1));
      let slots = all.filter((x) => x.p0 >= lo - 1 && x.p1 <= hi + 1);
      // A row of fewer than 3 bays is not laid (no orphan strips).
      const byRun = [];
      for (const row of [-1, 1]) {
        const s = slots.filter((x) => x.row === row).sort((p, q) => p.p0 - q.p0);
        let cur = [];
        for (const x of s) { if (cur.length && Math.abs(cur[cur.length - 1].p1 - x.p0) > 1) { byRun.push(cur); cur = []; } cur.push(x); }
        if (cur.length) byRun.push(cur);
      }
      const keepRuns = byRun.filter((rn) => rn.length >= MIN_SLOTS);
      slots = keepRuns.flat();
      if (!slots.length) continue;
      const count = slots.length;
      const pLo = Math.min(...slots.map((x) => x.p0)) - TURN_MM; const pHi = Math.max(...slots.map((x) => x.p1)) + TURN_MM;
      const aLo = Math.min(pLo, c.junction[0]); const aHi = Math.max(pHi, c.junction[1]);
      if (aLo < run[0] - 1 || aHi > run[1] + 1) continue;
      const aisleRect = rectOf(c.axis, aLo, aHi, c.q - A / 2, c.q + A / 2);
      const sumD = slots.slice().sort((p, q) => p.d - q.d).slice(0, wanted).reduce((s, x) => s + x.d, 0);
      const paved = (aHi - aLo) / 1000 + c.extraLen / 1000;
      const used = new Set(slots.map((x) => x.row)).size;
      // Rows that stop short of the drive leave a ragged gap beside it: charge for it so rows sit flush against the drive.
      let gap = 0;
      if (c.axis === 'h') for (const row of [-1, 1]) {
        const rs = slots.filter((x) => x.row === row);
        const w = rs.filter((x) => x.p1 <= gs0 + 1); const e = rs.filter((x) => x.p0 >= gs1 - 1);
        if (w.length) gap += (gs0 - Math.max(...w.map((x) => x.p1))) / 1000;
        if (e.length) gap += (Math.min(...e.map((x) => x.p0)) - gs1) / 1000;
      }
      if (c.axis === 'v') {
        const side = c.connSide; // the row on the connector side (-1 west of the drive's aisle, i.e. the east row of a west aisle)
        const rs = slots.filter((x) => x.row === side);
        const above = rs.filter((x) => x.p0 >= c.junction[1] - 1); const below = rs.filter((x) => x.p1 <= c.junction[0] + 1);
        if (above.length) gap += (Math.min(...above.map((x) => x.p0)) - c.junction[1]) / 1000;
        if (below.length) gap += (c.junction[0] - Math.max(...below.map((x) => x.p1))) / 1000;
      }
      const cost = sumD + 1.6 * paved + (used === 1 ? 20 : 0) + Math.max(0, count - wanted) * 1.5 + gap * 2;
      const cand = { cost, count, axis: c.axis, q: c.q, ph, slots, aisleRect, aLo, aHi, parts: c.parts, runs: keepRuns };
      if (count >= wanted) { if (!best || cost < best.cost) best = cand; } else if (!bestShort || count > bestShort.count || (count === bestShort.count && cost < bestShort.cost)) bestShort = cand;
    }
  };

  const driveRect = (t1) => ({ s0: gs0, s1: gs1, t0: 0, t1 });

  // 'v': a side aisle beside the drive, joined by a connector ---------------------------------------------------------------------------------
  const saList = new Set();
  for (let s = sLo + A / 2; s <= sHi - A / 2; s += 1500) saList.add(Math.round(s));
  for (const s of [sLo + D + A / 2, sLo + A / 2, sHi - D - A / 2, sHi - A / 2, gs0 - A / 2, gs1 + A / 2, gs0 - D - A / 2 - 1000, gs1 + D + A / 2 + 1000]) saList.add(Math.round(s));
  for (const e of o.faces || []) { saList.add(Math.round(e.s0 - D - A / 2)); saList.add(Math.round(e.s1 + D + A / 2)); saList.add(Math.round(e.s0 - A / 2)); saList.add(Math.round(e.s1 + A / 2)); }
  for (const sa of saList) {
    const side = sa < gate ? -1 : 1;
    if (side < 0 ? sa + A / 2 > gs0 + 1 : sa - A / 2 < gs1 - 1) continue;
    if (sa - A / 2 < sLo - 1 || sa + A / 2 > sHi + 1) continue;
    const runs = runsOf('v', sa);
    if (!runs.length) continue;
    const tcLo = connMin + A / 2; const tcHi = (truckEnd ?? tHi) - A / 2;
    const tcs = []; for (let tc = tcLo; tc <= tcHi + 1; tc += 1000) tcs.push(tc); if (truckEnd && tcHi >= tcLo) tcs.push(tcHi);
    for (const tc of tcs) {
      const conn = side < 0 ? { s0: sa + A / 2, s1: gs0, t0: tc - A / 2, t1: tc + A / 2 } : { s0: gs1, s1: sa - A / 2, t0: tc - A / 2, t1: tc + A / 2 };
      const connLen = conn.s1 - conn.s0;
      if (connLen < 0 || (connLen > 1 && connLen < A - 1)) continue; // the aisle meets the drive, or a connector at least as long as an aisle is wide
      if (connLen > 1 && !okR(conn, false)) continue;
      const dTop = truckEnd ?? (tc + A / 2);
      const drive = driveRect(dTop);
      if (!okR(drive, true)) continue;
      const parts = [
        { kind: 'drive', r: drive, truckDrive: !!truckEnd },
        ...(connLen > 1 ? [{ kind: 'connector', r: conn }] : []),
      ];
      evaluate({ axis: 'v', q: sa, connSide: side < 0 ? 1 : -1, junction: [tc - A / 2, tc + A / 2], parts, avoid: [drive, ...(connLen > 1 ? [conn] : [])], extraLen: connLen + dTop });
    }
  }

  // 'h': an aisle across the lot that the drive meets -----------------------------------------------------------------------------------------
  const tcSet = new Set();
  for (let t = connMin + A / 2; t <= (truckEnd ?? tHi) - A / 2 + 1; t += 1500) tcSet.add(Math.round(t));
  if (truckEnd) tcSet.add(Math.round(truckEnd - A / 2));
  for (const t of o.tFaces || []) { tcSet.add(Math.round(t - D - A / 2)); tcSet.add(Math.round(t + D + A / 2)); }
  for (const tc of tcSet) {
    if (tc - A / 2 < connMin - 1 || tc + A / 2 > (truckEnd ?? tHi) + 1) continue;
    const south = { s0: gs0, s1: gs1, t0: 0, t1: tc - A / 2 };
    if (!okR(south, true)) continue;
    const parts = [{ kind: 'drive', r: south, truckDrive: !!truckEnd }];
    const avoid = [south];
    if (truckEnd) {
      const north = { s0: gs0, s1: gs1, t0: tc + A / 2, t1: truckEnd };
      if (north.t1 - north.t0 > 1) { if (!okR(north, true)) continue; parts.push({ kind: 'drive', r: north, truckDrive: true }); avoid.push(north); }
    }
    evaluate({ axis: 'h', q: tc, junction: [gs0, gs1], parts, avoid, extraLen: (tc - A / 2) + (truckEnd ? truckEnd - tc - A / 2 : 0) });
  }

  const pick = best || bestShort;
  if (!pick) return null;
  return buildField(pick, { A, D, bayW, gs0, gs1 });
}

const MIN_SLOTS = 3;

function buildField(c, { A, D, bayW, gs0, gs1 }) {
  const parts = c.parts.map((p) => ({ ...p }));
  const aisle = { kind: 'aisle', r: c.aisleRect, cross: true, axis: c.axis };
  const rows = [];
  for (const run of c.runs) {
    const row = run[0].row;
    const bays = run.map((x) => ({ s0: x.r.s0, s1: x.r.s1, t0: x.r.t0, t1: x.r.t1 }));
    rows.push({ axis: c.axis, row, q: c.q, bays });
  }
  const count = rows.reduce((n, r) => n + r.bays.length, 0);
  const sides = new Set(rows.map((r) => r.row)).size;
  const all = [...parts.map((p) => p.r), aisle.r];
  const spineTop = Math.max(...c.parts.filter((p) => p.kind === 'drive').map((p) => p.r.t1));
  return {
    kind: 'side', axis: c.axis, spine: { s0: gs0, s1: gs1, t0: 0, t1: spineTop },
    parts: [...parts, aisle], rows, count, double: sides === 2 ? 1 : 0, cost: c.cost, cols: Math.max(...rows.map((r) => r.bays.length)),
    aisleW: A, bayL: D, bayW, rects: all, rectsInfo: [...parts.map((p) => ({ ...p.r, truckDrive: !!p.truckDrive })), { ...aisle.r, truckDrive: false }],
  };
}

/**
 * Write a side field out as plain world polygons, the same shape as fieldGeometry (carpark-field.js).
 * Aisle parts never overlap. Bay polygons run aisle edge first: [aisle a, aisle b, back b, back a].
 */
export function sideGeometry(field, world, frame) {
  const R = (s0, s1, t0, t1) => [world(s0, t0), world(s1, t0), world(s1, t1), world(s0, t1)];
  const aisles = []; const paved = [];
  let k = 0;
  for (const p of field.parts) {
    const id = `sw:aisle:${k++}`;
    const r = p.r;
    const wide = r.t1 - r.t0 < r.s1 - r.s0;
    const polygon = R(r.s0, r.s1, r.t0, r.t1);
    const centre = wide ? [world(r.s0, (r.t0 + r.t1) / 2), world(r.s1, (r.t0 + r.t1) / 2)] : [world((r.s0 + r.s1) / 2, r.t0), world((r.s0 + r.s1) / 2, r.t1)];
    aisles.push({ id, polygon, centre, widthMm: wide ? r.t1 - r.t0 : r.s1 - r.s0, kind: 'aisle', ...(p.kind === 'drive' ? { spine: true, truckDrive: !!p.truckDrive } : { cross: true }) });
    paved.push({ id: id.replace('sw:aisle:', 'sw:paved:'), polygon });
  }
  const rows = field.rows.map((r, i) => {
    const bays = r.bays.slice().sort((p, q) => (r.axis === 'h' ? p.s0 - q.s0 : p.t0 - q.t0));
    const slots = bays.map((b, j) => {
      let poly;
      if (r.axis === 'h') {
        const open = r.row < 0 ? b.t1 : b.t0; const back = r.row < 0 ? b.t0 : b.t1;
        poly = [world(b.s0, open), world(b.s1, open), world(b.s1, back), world(b.s0, back)];
      } else {
        const open = r.row < 0 ? b.s1 : b.s0; const back = r.row < 0 ? b.s0 : b.s1;
        poly = [world(open, b.t0), world(open, b.t1), world(back, b.t1), world(back, b.t0)];
      }
      return { index: j, kind: 'bay', poly, centre: world((b.s0 + b.s1) / 2, (b.t0 + b.t1) / 2) };
    });
    const first = bays[0]; const last = bays[bays.length - 1];
    const area = R(first.s0, r.axis === 'h' ? last.s1 : first.s1, first.t0, r.axis === 'h' ? first.t1 : last.t1);
    let o; let u; let v;
    if (r.axis === 'h') {
      o = world(first.s0, r.row < 0 ? first.t1 : first.t0); u = { x: frame.u.x, y: frame.u.y }; v = { x: frame.n.x * r.row, y: frame.n.y * r.row };
    } else {
      o = world(r.row < 0 ? first.s1 : first.s0, first.t0); u = { x: frame.n.x, y: frame.n.y }; v = { x: frame.u.x * r.row, y: frame.u.y * r.row };
    }
    return { rowId: `sw:bays:${i}`, buildingId: null, bayAreas: [{ id: `sw:bays:${i}:0`, polygon: area }], frame: { o, u, v, f: { x: -v.x, y: -v.y } }, length: slots.length * field.bayW, x0: 0, depth: 0, offsetMm: 0, slots };
  });
  return { aisles, rows, paved };
}
