// Indicative parking, accessible bays and the accessible path of travel. One bay row runs parallel to each building row, an aisle
// away from its front facade. This is NOT the full parking design (aisles, circulation and swept paths come in the next stage): it
// gives a bay count and a place for the accessible bays. Bay 2.4 x 5.4 m, accessible bay with a 2.4 m shared zone beside it.

import { layoutUnits, rowFrame, rowLength, rowPoint, facadeLayout, onFacade } from './layout.js';
import { accessibleRequired, ACCESSIBLE_BAY } from './rules.js';
import { bayOffsetMm } from './schema.js';

const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y });
const mul = (a, k) => ({ x: a.x * k, y: a.y * k });

/** The accessible entry: the personnel door of the first unit with an accessible WC, else with an office, else unit 1. */
export function accessibleEntry(units) {
  const pick = units.find((u) => u.spec.office.enabled && u.spec.office.accessibleWc) || units.find((u) => u.spec.office.enabled) || units[0];
  if (!pick) return null;
  const fl = facadeLayout(pick.spec);
  const along = pick.x0 + (onFacade(fl.personnel, pick.w) ? fl.personnel.offset : pick.w / 2);
  const fr = pick.frame;
  return { unit: pick, rowId: pick.rowId, along, point: rowPoint(fr, along, pick.d) };
}

/**
 * parkingLayout(commercial) -> { rows: [{ rowId, frame, slots:[{ index, kind: 'bay'|'accessible'|'zone', poly, centre }] }], totalBays,
 * accessible: { required, provided, override }, path: [pt, pt] | null, entry }.
 */
export function parkingLayout(commercial) {
  const empty = { rows: [], totalBays: 0, accessible: { required: 0, provided: 0, override: null }, path: null, entry: null, slotsTotal: 0 };
  if (!commercial || commercial.parking?.enabled === false || !commercial.rows?.length) return empty;
  const { bayW, bayL } = commercial.parking;
  const offsetMm = bayOffsetMm(commercial.parking); // the truck apron in front of the roller doors, or the car aisle when that is wider
  const units = layoutUnits(commercial);
  const rows = commercial.rows;
  const entry = accessibleEntry(units);
  const out = [];
  let slotsTotal = 0;
  for (const row of rows) {
    const fr = rowFrame(row, rows);
    const L = rowLength(row, rows);
    const d = units.find((u) => u.rowId === row.id)?.d || 0;
    const n = row.bays === false ? 0 : Math.floor(L / bayW); // an inner row (its front faces another row across a shared apron) has no bays of its own
    const slots = [];
    for (let i = 0; i < n; i++) {
      const a = i * bayW;
      const near = d + offsetMm;
      const poly = [rowPoint(fr, a, near), rowPoint(fr, a + bayW, near), rowPoint(fr, a + bayW, near + bayL), rowPoint(fr, a, near + bayL)];
      slots.push({ index: i, kind: 'bay', poly, centre: rowPoint(fr, a + bayW / 2, near + bayL / 2), aisleEnd: rowPoint(fr, a + bayW / 2, near + ACCESSIBLE_BAY.bollardFromEntryMm) });
    }
    slotsTotal += n;
    out.push({ rowId: row.id, frame: fr, length: L, depth: d, slots });
  }
  // Extra bay strips (spare areas and boundaries): { x, y, rotationDeg, count } with the bays running along u from the origin and
  // extending bayL along f; the car aisle lies on the other side, so the strip carries its own offset (off = aisle, depth = -aisle).
  const aisle = Number(commercial.parking.aisleMm) || 0;
  (commercial.parking.extra || []).forEach((e, k) => {
    const a = ((Number(e.rotationDeg) || 0) * Math.PI) / 180;
    const u = { x: Math.cos(a), y: Math.sin(a) };
    const f = { x: -Math.sin(a), y: Math.cos(a) };
    const fr = { o: { x: Number(e.x) || 0, y: Number(e.y) || 0 }, u, v: f, f, src: null, mirrored: false };
    const cnt = Math.max(0, Math.round(Number(e.count) || 0));
    const slots = [];
    for (let i = 0; i < cnt; i++) {
      const a0 = i * bayW;
      slots.push({ index: i, kind: 'bay', poly: [rowPoint(fr, a0, 0), rowPoint(fr, a0 + bayW, 0), rowPoint(fr, a0 + bayW, bayL), rowPoint(fr, a0, bayL)], centre: rowPoint(fr, a0 + bayW / 2, bayL / 2), aisleEnd: rowPoint(fr, a0 + bayW / 2, 0) });
    }
    slotsTotal += cnt;
    out.push({ rowId: `extra-${k + 1}`, frame: fr, length: cnt * bayW, depth: -aisle, off: aisle, extra: true, slots });
  });
  // Required accessible bays: fixpoint, because the shared zones take slots that are not bays.
  const table = Number.isFinite(commercial.parking?.accessiblePerBays) && commercial.parking.accessiblePerBays > 0 ? { perBays: commercial.parking.accessiblePerBays } : (commercial.buildingClass || 'class_8');
  const override = Number.isInteger(commercial.parking.accessibleOverride) ? commercial.parking.accessibleOverride : null;
  let req = slotsTotal >= 2 ? 1 : 0;
  const zonesFor = (a) => Math.floor(a / 2) + (a % 2);
  for (let k = 0; k < 6 && req > 0; k++) {
    const bays = slotsTotal - zonesFor(req);
    const next = accessibleRequired(bays, table);
    if (next === req) break;
    req = next;
  }
  const want = override == null ? req : override;
  // Place the groups [bay][zone][bay] and [bay][zone] on the entry row, nearest the entry.
  let provided = 0;
  let path = null;
  const home = out.find((r) => r.rowId === entry?.rowId && r.slots.length >= 3) || out.find((r) => !r.extra && r.slots.length >= 3) || out.find((r) => r.slots.length) || out[0];
  if (home && want > 0) {
    const pairs = Math.floor(want / 2);
    const single = want % 2;
    const usedLen = pairs * 3 + single * 2;
    const fit = Math.min(usedLen, home.slots.length);
    const e = Math.floor((entry?.along ?? 0) / bayW);
    const start = Math.max(0, Math.min(e - Math.floor(fit / 2), home.slots.length - fit));
    let k = start;
    const mark = (i, kind) => { if (home.slots[i]) home.slots[i].kind = kind; };
    let left = want;
    while (left > 0 && k < home.slots.length) {
      if (left >= 2 && k + 2 < home.slots.length) { mark(k, 'accessible'); mark(k + 1, 'zone'); mark(k + 2, 'accessible'); k += 3; left -= 2; provided += 2; }
      else if (k + 1 < home.slots.length) { mark(k, 'accessible'); mark(k + 1, 'zone'); k += 2; left -= 1; provided += 1; }
      else break;
    }
    const zones = home.slots.filter((s) => s.kind === 'zone');
    if (zones.length && entry) {
      const best = zones.reduce((a, b) => (Math.hypot(a.centre.x - entry.point.x, a.centre.y - entry.point.y) <= Math.hypot(b.centre.x - entry.point.x, b.centre.y - entry.point.y) ? a : b));
      path = [best.aisleEnd, entry.point];
    }
  }
  const zoneCount = out.reduce((s, r) => s + r.slots.filter((x) => x.kind === 'zone').length, 0);
  return { rows: out, totalBays: slotsTotal - zoneCount, slotsTotal, accessible: { required: req, provided, override }, path, entry };
}

export { ACCESSIBLE_BAY };
