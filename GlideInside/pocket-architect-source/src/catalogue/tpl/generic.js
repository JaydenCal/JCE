// Builder for the generic (public) design set. A design is a plain spec: levels of rooms, doors, windows and stairs in local
// millimetre coordinates (north is -y, the street is south). The spec is turned into a project through the operations registry,
// exactly like the older hand written templates. Furniture is not in the specs: tools/furnish-generic.mjs places it with the
// plan lint as the judge and bakes the result into generic-furniture.generated.js, so building a design never searches.
//
// Every design here is original work. Typical proportions, frontage widths and Australian planning conventions only.

import { plan } from './kit.js';

/** Room: R(key, type, name, x0, y0, x1, y1, extra). */
export const R = (key, type, name, x0, y0, x1, y1, extra = {}) => ({ key, type, name, rect: [x0, y0, x1, y1], extra });
/** Room with any outline: P(key, type, name, [[x, y], ...]). */
export const P = (key, type, name, pts, extra = {}) => ({ key, type, name, pts, extra });
/** Opening: O(preset, room, side, at, o). `at` is the plan coordinate along the wall (x for n and s, y for e and w). */
export const O = (preset, room, side, at, o = {}) => ({ preset, room, side, at, o });
/** Door swinging into `room` (or into `into`). */
export const D = (room, side, at, preset = 'door_internal', into = null, o = {}) => O(preset, room, side, at, { ...o, ...(into ? { into } : {}) });

/** Rooms, walls and openings only. Returns { b, levelIds, rooms } where rooms[levelIndex][key] is the room. */
export function assemble(spec) {
  const b = plan({ name: spec.name, type: spec.type || 'house' });
  const [OX, OY] = spec.origin || [2400, 4400];
  const levelIds = [];
  const roomsByLevel = [];
  spec.levels.forEach((L, i) => {
    const id = i === 0 ? b.project.levels[0].id : b.run('add_level', { name: L.name || 'First', copy_outline: false }).id;
    levelIds.push(id);
    b.use(id);
    if (L.height) b.run('update_level', { id, ceiling_height: L.height });
    if (L.elevation != null) b.run('update_level', { id, elevation: L.elevation });
    if (L.roof || spec.roof) b.run('set_roof', L.roof || spec.roof);
    const rooms = {};
    roomsByLevel.push(rooms);
    for (const r of L.rooms) {
      if (r.rect) {
        const [x0, y0, x1, y1] = r.rect;
        rooms[r.key] = b.room(r.type, r.name, x0 + OX, y0 + OY, x1 - x0, y1 - y0, r.extra);
      } else {
        const { id: rid } = b.run('add_room_polygon', { type: r.type, name: r.name, points: r.pts.map(([x, y]) => ({ x: x + OX, y: y + OY })) });
        rooms[r.key] = b.lvl.rooms.find((q) => q.id === rid);
      }
      if (r.extra?.roofed === false || r.extra?.balustrade) b.run('update_room', { id: rooms[r.key].id, roofed: r.extra.roofed, balustrade: r.extra.balustrade });
    }
    for (const o of L.openings || []) {
      const room = rooms[o.room];
      if (!room) throw new Error(`${spec.id}: unknown room ${o.room}`);
      const at = o.side === 'n' || o.side === 's' ? o.at + OX : o.at + OY;
      const opts = { abs: true, ...o.o };
      if (opts.into) opts.into = rooms[opts.into];
      if (!opts.into) delete opts.into;
      try {
        b.opening(o.preset, room, o.side, at, opts);
      } catch (e) {
        throw new Error(`${spec.id} ${L.name || 'ground'}: ${e.message}`);
      }
    }
    for (const s of L.stairs || []) b.stair(s[0] + OX, s[1] + OY, s[2], s[3], s[4] || 0, id);
  });
  b.use(levelIds[0]);
  return { b, levelIds, rooms: roomsByLevel, origin: [OX, OY] };
}

/** Build the project for a spec. `furniture` is the baked list for this design: [levelIndex, item, x, y, rotation, w, d]. */
export function buildSpec(spec, furniture = []) {
  const { b, levelIds, origin: [OX, OY] } = assemble(spec);
  for (const [li, item, x, y, rot, w, d] of furniture) {
    b.use(levelIds[li]);
    b.place(item, x, y, rot, { w: w ?? undefined, d: d ?? undefined });
  }
  b.use(levelIds[0]);
  for (const t of spec.tanks || []) b.tank(t[0] + OX, t[1] + OY, t[2], t[3]);
  for (const f of spec.finishes || []) b.run('set_finish', { target: f[0], material: f[1], colour: f[2] });
  return b.done();
}
