// Indicative parking for catalogue buildings, in the spirit of parking.js: bays in front of each building, an aisle (or the truck apron) away
// from its front edge, back to back pairs of rows when one row is not enough, accessible bays with a shared zone beside them. NOT the full
// parking design. Bays sit at offsetMm in front of the front edge, i.e. at local y = -offsetMm and beyond (the street is toward -y).

import { buildingsOf } from './buildings.js';
import { frameOf, toWorld } from './frame.js';
import { accessibleRequired, ACCESSIBLE_BAY } from '../rules.js';

const MAX_ROWS = 4;

/** The bay requirement of one building, unrounded: [{ use, m2, per, spaces }] and the raw sum. */
export function bayDemand(b) {
  const lines = (b.site?.parking?.ratePerM2 || []).filter((r) => Number(r.per) > 0).map((r) => {
    const m2 = Number.isFinite(r.m2) && r.m2 != null ? r.m2 : b.gfaM2;
    return { use: r.use, m2, per: r.per, spaces: m2 / r.per };
  });
  return { lines, raw: lines.reduce((s, l) => s + l.spaces, 0) };
}

/** The strip in front of a building where its car park goes, in local coordinates: { x0, x1, offsetMm }. */
export function bayZone(b, parking) {
  const ox = b.local.outline.map((q) => q.x);
  const z = b.site?.parking?.zone;
  const x0 = Number.isFinite(z?.x0) ? z.x0 : Math.min(...ox);
  const x1 = Number.isFinite(z?.x1) ? z.x1 : Math.max(...ox);
  const apron = Number(b.site?.vehicles?.apronDepthMm) || 0;
  const off = Number.isFinite(z?.offsetMm) ? z.offsetMm : Math.max(Number(parking?.aisleMm) || 0, apron);
  return { x0, x1, offsetMm: off };
}

/**
 * buildingParking(commercial) -> { rows: [{ rowId, buildingId, frame, length, depth: 0, offsetMm, x0, slots: [{ index, kind: 'bay'|'accessible'|'zone', poly, centre }] }],
 * totalBays, required, accessible: { required, provided }, perBuilding: [{ id, required, provided }] }. Bays needed are rounded up once per building.
 */
export function buildingParking(c) {
  const empty = { rows: [], totalBays: 0, required: 0, accessible: { required: 0, provided: 0 }, perBuilding: [], slotsTotal: 0 };
  if (!c?.buildings?.length || c.parking?.enabled === false) return { ...empty, required: c?.buildings?.length ? sumRequired(c) : 0 };
  const { bayW, bayL, aisleMm } = c.parking;
  const table = c.buildingClass || 'class_8';
  const rows = [];
  const perBuilding = [];
  let totalBays = 0;
  let slotsTotal = 0;
  let required = 0;
  let accReq = 0;
  let accProv = 0;
  for (const b of buildingsOf(c)) {
    const need = Math.ceil(bayDemand(b).raw - 1e-9);
    required += need;
    if (!(need > 0) && !b.site?.parking?.accessible) { perBuilding.push({ id: b.id, required: need, provided: 0 }); continue; }
    const z = bayZone(b, c.parking);
    const perRow = Math.max(0, Math.floor((z.x1 - z.x0) / bayW));
    const fr = frameOf(b.place);
    const at = (x, y) => toWorld(b.place, { x, y });
    // Accessible bays need a shared zone each pair, so the slot count to place is the bays plus the zones.
    let req = need >= 2 ? 1 : 0;
    const zonesFor = (a) => Math.floor(a / 2) + (a % 2);
    for (let k = 0; k < 6 && req > 0; k++) { const nx = accessibleRequired(need, table); if (nx === req) break; req = nx; }
    const slotsWanted = need + zonesFor(req);
    const nRows = perRow > 0 ? Math.min(MAX_ROWS, Math.ceil(slotsWanted / perRow)) : 0;
    const mine = [];
    let left = slotsWanted;
    for (let r = 0; r < nRows; r++) {
      const near = z.offsetMm + (r % 2 === 1 ? bayL : 0) + Math.floor(r / 2) * (2 * bayL + aisleMm);
      const n = Math.min(perRow, left);
      left -= n;
      const slots = [];
      for (let i = 0; i < n; i++) {
        const a = z.x0 + i * bayW;
        slots.push({ index: i, kind: 'bay', poly: [at(a, -near), at(a + bayW, -near), at(a + bayW, -(near + bayL)), at(a, -(near + bayL))], centre: at(a + bayW / 2, -(near + bayL / 2)) });
      }
      const row = { rowId: `${b.id}:${r}`, buildingId: b.id, frame: { o: fr.o, u: fr.u, v: fr.v, f: { x: -fr.v.x, y: -fr.v.y } }, length: z.x1 - z.x0, x0: z.x0, depth: 0, offsetMm: near, slots };
      rows.push(row);
      mine.push(row);
    }
    // Place the accessible groups on the first row, nearest the middle of the zone: [bay][zone][bay], then [bay][zone].
    let provided = 0;
    const home = mine[0];
    if (home && req > 0) {
      const pairs = Math.floor(req / 2);
      const single = req % 2;
      const used = pairs * 3 + single * 2;
      const fit = Math.min(used, home.slots.length);
      const start = Math.max(0, Math.min(Math.floor(home.slots.length / 2) - Math.floor(fit / 2), home.slots.length - fit));
      let k = start;
      let want = req;
      const mark = (i, kind) => { if (home.slots[i]) home.slots[i].kind = kind; };
      while (want > 0 && k < home.slots.length) {
        if (want >= 2 && k + 2 < home.slots.length) { mark(k, 'accessible'); mark(k + 1, 'zone'); mark(k + 2, 'accessible'); k += 3; want -= 2; provided += 2; }
        else if (k + 1 < home.slots.length) { mark(k, 'accessible'); mark(k + 1, 'zone'); k += 2; want -= 1; provided += 1; }
        else break;
      }
    }
    const zoneCount = mine.reduce((s, r) => s + r.slots.filter((x) => x.kind === 'zone').length, 0);
    const slotCount = mine.reduce((s, r) => s + r.slots.length, 0);
    totalBays += slotCount - zoneCount;
    slotsTotal += slotCount;
    accReq += req;
    accProv += provided;
    perBuilding.push({ id: b.id, required: need, provided: slotCount - zoneCount });
  }
  return { rows, totalBays, slotsTotal, required, accessible: { required: accReq, provided: accProv }, perBuilding };
}

const sumRequired = (c) => buildingsOf(c).reduce((s, b) => s + Math.ceil(bayDemand(b).raw - 1e-9), 0);

export { ACCESSIBLE_BAY };
