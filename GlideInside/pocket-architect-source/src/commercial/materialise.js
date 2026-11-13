// Spec to model. Rewrites the generated walls, party walls, openings, rooms, stairs and the optional mezzanine level of a commercial
// project from project.commercial. Every generated entity carries generated: 'commercial' (and auto: true on openings and rooms) so
// the next run replaces it and anything the person drew by hand is left alone. Call inside store.apply so one edit is one undo step.

import * as S from '../model/schema.js';
import { layoutUnits, facadeLayout, rearWindow, mezzanineOf, rowFrame, rowLength, PARTY_WALL_MM } from './layout.js';
import { SLAB_MM } from './schema.js';

export const GEN = 'commercial';
export const MEZZ_LEVEL_ID = 'lvl_commercial_mezz';
const EXT_MM = 200;
const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y });
const mul = (a, k) => ({ x: a.x * k, y: a.y * k });
const at = (fr, along, depth) => add(add(fr.o, mul(fr.u, along)), mul(fr.f, depth));

const mark = (e) => { e.generated = GEN; return e; };
const isGen = (e) => e?.generated === GEN;

function wall(a, b, { kind, outside, thickness }) {
  const w = S.createWall({ a, b, thickness });
  w.kind = kind;
  w.outside = outside;
  w.auto = false;
  return mark(w);
}

/** Remove every generated entity (and the generated mezzanine level) from the project. */
export function clearGenerated(p) {
  p.levels = p.levels.filter((l) => l.id !== MEZZ_LEVEL_ID);
  for (const l of p.levels) {
    l.walls = l.walls.filter((w) => !isGen(w));
    const ids = new Set(l.walls.map((w) => w.id));
    l.openings = l.openings.filter((o) => !isGen(o) && ids.has(o.wallId));
    l.rooms = l.rooms.filter((r) => !isGen(r));
    l.stairs = l.stairs.filter((s) => !isGen(s));
  }
}

/** Rebuild the generated model from p.commercial. Returns a summary { units, walls, openings, rooms, mezzanines }. */
export function materialise(p) {
  clearGenerated(p);
  if (p.mode !== 'commercial' || !p.commercial) return { units: 0, walls: 0, openings: 0, rooms: 0, mezzanines: 0 };
  const c = p.commercial;
  const level = p.levels[0];
  const units = layoutUnits(c);
  const rows = c.rows;
  const summary = { units: units.length, walls: 0, openings: 0, rooms: 0, mezzanines: 0 };
  const maxH = units.reduce((m, u) => Math.max(m, u.spec.heightMm), 0);
  if (maxH) level.height = maxH;
  const addWall = (w) => { level.walls.push(w); summary.walls += 1; return w; };
  const addOpening = (wallId, kind, offset, width, height, sill, extra = {}) => {
    const { motorised, ...rest } = extra;
    const o = S.createOpening({ wallId, kind, offset, width, height, sill, ...rest });
    if (motorised !== undefined) o.motorised = motorised;
    o.auto = true;
    mark(o);
    level.openings.push(o);
    summary.openings += 1;
    return o;
  };

  const byRow = new Map();
  for (const u of units) { if (!byRow.has(u.rowId)) byRow.set(u.rowId, []); byRow.get(u.rowId).push(u); }

  for (const row of rows) {
    const us = byRow.get(row.id) || [];
    if (!us.length) continue;
    const fr = rowFrame(row, rows);
    const L = rowLength(row, rows);
    const d = us[0].d;
    const sign = fr.mirrored ? -1 : 1; // outside is +1 on the side the wall normal (the row's v) points to
    // Front wall: one wall along the row, openings per unit.
    const front = addWall(wall(at(fr, 0, d), at(fr, L, d), { kind: 'exterior', outside: sign, thickness: EXT_MM }));
    // Rear wall: the source row owns it; a mirrored row shares it as a party wall.
    const mirrorOfThis = rows.some((r) => r.mirrorOf === row.id);
    const rearKind = mirrorOfThis ? 'interior' : 'exterior';
    let rear = null;
    if (!fr.mirrored) rear = addWall(wall(at(fr, 0, 0), at(fr, L, 0), { kind: rearKind, outside: rearKind === 'interior' ? 0 : -sign, thickness: mirrorOfThis ? PARTY_WALL_MM : EXT_MM }));
    // Side walls: ends are exterior, the walls between units are party walls.
    const sides = [];
    for (let i = 0; i <= us.length; i++) {
      const x = i === 0 ? 0 : us[i - 1].x0 + us[i - 1].w;
      const end = i === 0 || i === us.length;
      const kind = end ? 'exterior' : 'interior';
      // Wall direction is +f, whose normal is -u: outside is +1 at the left end, -1 at the right end.
      const outside = end ? sign * (i === 0 ? 1 : -1) : 0;
      sides.push(addWall(wall(at(fr, x, 0), at(fr, x, d), { kind, outside, thickness: end ? EXT_MM : PARTY_WALL_MM })));
    }
    us.forEach((u, i) => {
      const spec = u.spec;
      const fl = facadeLayout(spec);
      for (const dr of fl.doors) addOpening(front.id, 'roller_door', u.x0 + dr.offset, dr.w, dr.h, 0, { motorised: !!spec.doors.motorised });
      if (fl.personnel) addOpening(front.id, 'door', u.x0 + fl.personnel.offset, fl.personnel.w, fl.personnel.h, 0);
      for (const wd of [fl.window, fl.highlight]) if (wd) addOpening(front.id, 'window', u.x0 + wd.offset, wd.w, wd.h, wd.sill, { style: 'fixed' });
      if (rear && !fr.mirrored) {
        if (spec.doors.rear) addOpening(rear.id, 'roller_door', u.x0 + u.w / 2, fl.doors[0]?.w || 3000, fl.doors[0]?.h || 3500, 0, { motorised: !!spec.doors.motorised });
        const rw = rearWindow(spec);
        if (rw) addOpening(rear.id, 'window', u.x0 + rw.offset, rw.w, rw.h, rw.sill, { style: 'fixed' });
      }
      // Side windows only on end units, on the exterior end wall (never a party wall).
      if (spec.windows.side) {
        const sw = (u.first ? sides[0] : null) || null;
        const ew = (u.last ? sides[sides.length - 1] : null) || null;
        for (const w of [sw, ew]) if (w) addOpening(w.id, 'window', d / 2, 1800, 1200, 900, { style: 'sliding' });
      }
      // Rooms
      const poly = u.poly.map((q) => ({ ...q }));
      const room = S.createRoom({ name: `PROPOSED UNIT ${u.n}`, type: 'workshop', polygon: poly });
      room.auto = true;
      mark(room);
      level.rooms.push(room);
      summary.rooms += 1;
      if (spec.office.enabled) {
        const od = Math.min(spec.office.depthMm, d - 1000);
        const oc = [at(fr, u.x0, d - od), at(fr, u.x0 + u.w, d - od), at(fr, u.x0 + u.w, d), at(fr, u.x0, d)];
        const o = S.createRoom({ name: `PROPOSED UNIT ${u.n} OFFICE${spec.office.accessibleWc ? ' AND ACCESSIBLE WC' : ''}`, type: 'other', polygon: oc });
        o.auto = true;
        mark(o);
        level.rooms.push(o);
        summary.rooms += 1;
        // Office partition
        addWall(wall(at(fr, u.x0, d - od), at(fr, u.x0 + u.w, d - od), { kind: 'interior', outside: 0, thickness: 100 }));
      }
    });
  }

  // Mezzanine level: one level for the project, at the first enabled unit's level. Rooms carry the balustrade flag.
  const mezz = units.map((u) => ({ u, m: mezzanineOf(u.spec) })).filter((x) => x.m.enabled);
  if (mezz.length) {
    const lvl = S.createLevel({ id: MEZZ_LEVEL_ID, name: 'Mezzanine', elevation: mezz[0].m.level, height: Math.max(2400, maxH - mezz[0].m.level) });
    mark(lvl);
    lvl.roof.enabled = false;
    for (const { u, m } of mezz) {
      const fr = u.frame;
      const [a0, a1] = m.position === 'front' ? [u.d - m.depthMm, u.d] : [0, m.depthMm];
      const poly = [at(fr, u.x0, a0), at(fr, u.x0 + u.w, a0), at(fr, u.x0 + u.w, a1), at(fr, u.x0, a1)];
      const r = S.createRoom({ name: `PROPOSED UNIT ${u.n} MEZZANINE`, type: 'store', polygon: poly, balustrade: !!u.spec.mezzanine.balustrade });
      r.auto = true;
      mark(r);
      lvl.rooms.push(r);
      summary.rooms += 1;
      summary.mezzanines += 1;
      // Stair on the ground level beside the mezzanine edge, along the chosen side wall.
      const sd = m.stair;
      const sideX = u.spec.mezzanine.stairSide === 'right' ? u.x0 + u.w - 300 - sd.widthMm / 2 : u.x0 + 300 + sd.widthMm / 2;
      const edge = m.position === 'front' ? u.d - m.depthMm : m.depthMm;
      const centreDepth = m.position === 'front' ? edge - sd.lengthMm / 2 : edge + sd.lengthMm / 2;
      const ctr = at(fr, sideX, centreDepth);
      const ang = (Math.atan2(fr.f.y, fr.f.x) * 180) / Math.PI;
      const st = S.createStair({ x: ctr.x, y: ctr.y, width: sd.widthMm, length: sd.lengthMm, rotation: ang });
      mark(st);
      level.stairs.push(st);
    }
    p.levels.push(lvl);
  }
  return summary;
}

/** Rows' unit count for quick reading in tests and the stats strip. */
export const unitsOf = (p) => layoutUnits(p.commercial);
