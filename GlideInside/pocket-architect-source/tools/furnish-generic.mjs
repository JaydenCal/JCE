// Places furniture for the generic designs (src/catalogue/tpl/generic-specs.js) and bakes it into
// src/catalogue/tpl/generic-furniture.generated.js. The plan lint is the judge: an item stays only where it overlaps nothing,
// blocks no door swing and covers no window. Run after changing a spec:   node tools/furnish-generic.mjs [spec id ...]
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { assemble } from '../src/catalogue/tpl/generic.js';
import { SPECS } from '../src/catalogue/tpl/generic-specs.js';
import { lintProject } from '../src/catalogue/tpl/lint.js';
import { catalogue } from '../src/catalogue/index.js';
import * as G from '../src/model/geometry.js';

const root = resolve(dirname(new URL(import.meta.url).pathname), '..');
const OUT = resolve(root, 'src/catalogue/tpl/generic-furniture.generated.js');
const only = process.argv.slice(2);
const SIDE_ROT = { n: 0, s: 180, w: 270, e: 90 };
const OPP = { n: 's', s: 'n', e: 'w', w: 'e' };
const SIDES = ['n', 's', 'e', 'w'];

let existing = {};
if (existing && existsSync(OUT)) {
  const txt = readFileSync(OUT, 'utf8');
  const m = txt.match(/= (\{[\s\S]*\});\s*$/);
  if (m) existing = JSON.parse(m[1]);
}

function furnish(spec) {
  const { b, levelIds, rooms, origin } = assemble(spec);
  b.origin = origin;
  const hints = spec.furn || {};
  const lintN = () => lintProject(b.project, catalogue).length;
  let base = lintN();
  if (base) throw new Error(`${spec.id}: bare plan has lint problems:\n${lintProject(b.project, catalogue).join('\n')}`);
  const lvl = () => b.lvl;
  const del = (f) => b.run('delete', { id: f.id });
  const accept = (f) => {
    const n = lintN();
    if (n > base) { del(f); return false; }
    return true;
  };
  const get = (item) => catalogue.getFurniture(item);

  // One item against a side of a room. `ats`: list of 'c' | 'start' | 'end' | absolute coordinate.
  const against = (item, room, sides, ats, o = {}) => {
    for (const side of sides) {
      for (const at of ats) {
        let f;
        try {
          f = b.against(item, room, side, { ...o, at: typeof at === 'number' ? at : at, abs: typeof at === 'number' });
        } catch { continue; }
        if (accept(f)) return { f, side, at };
      }
    }
    return null;
  };
  const alongRange = (room, side, w) => {
    const inn = b.inner(room);
    const h = side === 'n' || side === 's';
    const lo = (h ? inn.x0 : inn.y0) + w / 2;
    const hi = (h ? inn.x1 : inn.y1) - w / 2;
    const out = [];
    for (let t = lo; t <= hi + 1; t += 250) out.push(Math.round(t));
    return out;
  };
  const sweep = (room, side, w, first = ['c', 'start', 'end']) => [...first, ...alongRange(room, side, w)];
  const place = (item, x, y, rot, o = {}) => {
    let f;
    try { f = b.place(item, x, y, rot, o); } catch { return null; }
    return accept(f) ? f : (null);
  };
  const along = (side) => (side === 'n' || side === 's' ? 'x' : 'y');
  const inward = (side) => ({ n: [0, 1], s: [0, -1], w: [1, 0], e: [-1, 0] }[side]);

  const bedroom = (room, o = {}) => {
    const master = /master/i.test(room.name);
    const bedItem = o.bed || (master ? (G.bbox(room.polygon).w >= 4300 ? 'bed_king' : 'bed_queen') : 'bed_double');
    const bw = get(bedItem).w;
    let done = null;
    // Prefer a bed with both bedsides, then one, then none.
    for (const need of [2, 1, 0]) {
      for (const side of o.sides || SIDES) {
        for (const at of sweep(room, side, bw)) {
          let bed;
          try { bed = b.against(bedItem, room, side, { at, abs: typeof at === 'number' }); } catch { continue; }
          if (!accept(bed)) continue;
          const placed = [];
          if (master || need >= 1) {
            const h = along(side) === 'x';
            for (const sgn of [-1, 1]) {
              const t = (h ? bed.x : bed.y) + sgn * (bw / 2 + 280);
              const f = (() => { try { return b.against('bedside', room, side, { at: t, abs: true }); } catch { return null; } })();
              if (f && accept(f)) placed.push(f); else if (f) { /* removed */ }
            }
          }
          if (placed.length >= need) { done = { bed, side }; break; }
          for (const f of placed) del(f);
          del(bed);
          base = lintN();
        }
        if (done) break;
      }
      if (done) break;
    }
    base = lintN();
    if (!done) throw new Error(`${spec.id}: no bed fits in ${room.name}`);
    const wards = o.wardrobes ?? 1;
    for (let i = 0; i < wards; i++) {
      const w = o.wardW || 1800;
      let r = against('wardrobe', room, SIDES.filter((s) => s !== done.side), sweep(room, 'n', w, ['start', 'end', 'c']), { w });
      if (!r) r = against('wardrobe', room, SIDES.filter((s) => s !== done.side), sweep(room, 'n', 1200, ['start', 'end']), { w: 1200 });
      if (!r) r = against('wardrobe', room, SIDES.filter((s) => s !== done.side), sweep(room, 'n', 900, ['start', 'end']), { w: 900 });
      base = lintN();
    }
    if (master) { against('chest_drawers', room, SIDES, ['c', 'start', 'end']); base = lintN(); }
  };

  const wardrobes = (room, n = 2) => {
    for (let i = 0; i < n; i++) {
      for (const w of [1800, 1200, 900]) {
        const r = against('wardrobe', room, SIDES, sweep(room, 'n', w, ['c', 'start', 'end']), { w });
        if (r) break;
      }
      base = lintN();
    }
  };

  const bath = (room, o = {}) => {
    const area = G.polygonArea(room.polygon) / 1e6;
    const order = o.order || (area >= 7.2 ? ['bath', 'shower_900', 'vanity_single', 'toilet'] : ['shower_900', 'vanity_single', 'toilet']);
    for (const item of order) {
      const w = get(item).w;
      const r = against(item, room, SIDES, [...sweep(room, 'n', w, ['start', 'end', 'c'])]);
      if (!r && item === 'bath') continue;
      base = lintN();
    }
    if (/laundry/i.test(room.name)) {
      for (const item of ['washer', 'dryer']) { against(item, room, SIDES, sweep(room, 'n', 600, ['start', 'end', 'c'])); base = lintN(); }
    }
  };

  const laundry = (room) => {
    for (const item of ['laundry_tub', 'washer', 'dryer']) {
      against(item, room, SIDES, sweep(room, 'n', get(item).w, ['start', 'end', 'c']));
      base = lintN();
    }
  };

  const study = (room) => {
    const r = against('desk', room, SIDES, sweep(room, 'n', 1500, ['c', 'start', 'end']));
    if (r) {
      const [dx, dy] = inward(r.side);
      const d = get('desk').d;
      const f = place('office_chair', r.f.x + dx * (d / 2 + 350), r.f.y + dy * (d / 2 + 350), (SIDE_ROT[r.side] + 180) % 360);
      void f;
    }
    base = lintN();
    against('bookshelf', room, SIDES, sweep(room, 'n', 900, ['start', 'end', 'c']));
    base = lintN();
  };

  const lounge = (room, o = {}) => {
    const sides = o.tvSides || SIDES;
    // Candidate TV walls, farthest from the kitchen first (o.from), then the sofa faces it across the room.
    const cands = [];
    for (const side of sides) for (const at of alongRange(room, side, 1500)) cands.push({ side, at });
    const inn = b.inner(room);
    const pt = (c) => (c.side === 'n' ? [c.at, inn.y0] : c.side === 's' ? [c.at, inn.y1] : c.side === 'w' ? [inn.x0, c.at] : [inn.x1, c.at]);
    const from = o.from;
    cands.sort((a, c) => {
      const da = from ? Math.hypot(pt(a)[0] - from[0], pt(a)[1] - from[1]) : 0;
      const dc = from ? Math.hypot(pt(c)[0] - from[0], pt(c)[1] - from[1]) : 0;
      return dc - da;
    });
    for (const c of cands) {
      let tv;
      try { tv = b.against('tv_unit', room, c.side, { at: c.at, abs: true, w: 1500 }); } catch { continue; }
      if (!accept(tv)) continue;
      const [dx, dy] = inward(c.side);
      let sofa = null;
      for (const dist of [o.dist || 2900, 2600, 2300, 2000]) {
        sofa = place('sofa_3', tv.x + dx * dist, tv.y + dy * dist, (SIDE_ROT[c.side] + 180) % 360);
        if (sofa) break;
      }
      if (!sofa) { del(tv); base = lintN(); continue; }
      const mid = { x: tv.x + dx * 1650, y: tv.y + dy * 1650 };
      place('coffee_table', mid.x, mid.y, SIDE_ROT[c.side] % 180);
      place('rug', mid.x, mid.y, along(c.side) === 'x' ? 0 : 90, { w: 2400, d: 1600 });
      base = lintN();
      return true;
    }
    return false;
  };

  const openPlan = (room, o = {}) => {
    const kSides = o.kitchen || ['n', 'w', 'e', 's'];
    const bench = against('kitchen_bench', room, kSides, sweep(room, 'n', 3000, o.kAt || ['start', 'end', 'c']));
    if (!bench) throw new Error(`${spec.id}: no kitchen bench fits in ${room.name}`);
    base = lintN();
    const horiz = bench.side === 'n' || bench.side === 's';
    const bc = horiz ? bench.f.x : bench.f.y;
    // fridge and pantry beside the bench, on whichever end has room.
    const nextTo = (item, from, order) => {
      for (const sgn of order) {
        const wd = get(item).w;
        const t = from + sgn * (1500 + wd / 2);
        const r = against(item, room, [bench.side], [Math.round(t)]);
        if (r) return { sgn, t };
      }
      return null;
    };
    const fr = nextTo('fridge', bc, o.fridge || [1, -1]);
    base = lintN();
    if (fr) {
      const pt = fr.t + fr.sgn * (450 + 450);
      against('pantry_unit', room, [bench.side], [Math.round(pt)]);
      base = lintN();
    }
    if (o.studio) {
      const inn0 = b.inner(room);
      const cands0 = [];
      for (let x = inn0.x0 + 900; x <= inn0.x1 - 900; x += 300) for (let y = inn0.y0 + 900; y <= inn0.y1 - 900; y += 300) cands0.push({ x, y });
      const kc0 = { x: bench.f.x, y: bench.f.y };
      cands0.sort((a, c) => Math.abs(Math.hypot(a.x - kc0.x, a.y - kc0.y) - 2400) - Math.abs(Math.hypot(c.x - kc0.x, c.y - kc0.y) - 2400));
      for (const p of cands0.slice(0, 60)) { if (place('dining_4', p.x, p.y, 0) || place('dining_4', p.x, p.y, 90)) break; }
      base = lintN();
      bedroom(room, { bed: 'bed_queen', wardrobes: 1, wardW: 1200 });
      base = lintN();
      lounge(room, { from: [kc0.x, kc0.y], dist: 2300 });
      base = lintN();
      return;
    }
    // island 1.1 m in front of the bench, on its centre line.
    const [dx, dy] = inward(bench.side);
    const isl = get('kitchen_island');
    const rot = horiz ? 0 : 90;
    const dist = get('kitchen_bench').d + 1150 + isl.d / 2;
    const pos = { x: bench.f.x + dx * dist, y: bench.f.y + dy * dist };
    let ok = place('kitchen_island', pos.x, pos.y, rot);
    if (!ok) ok = place('kitchen_island', pos.x, pos.y, rot, { w: 1800 });
    base = lintN();
    // dining table in the free middle, far from the bench.
    const inn = b.inner(room);
    const cands = [];
    for (let x = inn.x0 + 1300; x <= inn.x1 - 1300; x += 300) for (let y = inn.y0 + 1300; y <= inn.y1 - 1300; y += 300) cands.push({ x, y });
    const kc = { x: bench.f.x, y: bench.f.y };
    const score = (p) => -Math.hypot(p.x - kc.x, p.y - kc.y) * (o.diningFar ? 1 : 0) + Math.hypot(p.x - kc.x, p.y - kc.y) * (o.diningFar ? 0 : 0) + (o.diningNear ? Math.hypot(p.x - o.diningNear[0], p.y - o.diningNear[1]) : Math.hypot(p.x - kc.x, p.y - kc.y) > 2600 ? Math.abs(p.x - (inn.x0 + inn.x1) / 2) + Math.abs(p.y - (inn.y0 + inn.y1) / 2) : 1e6);
    cands.sort((a, c) => score(a) - score(c));
    const table = o.table || 'dining_6';
    const tw = get(table);
    let din = null;
    for (const p of cands.slice(0, 80)) {
      for (const rotT of horiz ? [0, 90] : [90, 0]) {
        din = place(table, p.x, p.y, rotT, {});
        if (din) break;
      }
      if (din) break;
    }
    base = lintN();
    void tw;
    // lounge in the part of the room the kitchen does not use.
    lounge(room, { tvSides: o.tvSides, dist: o.dist, from: [kc.x, kc.y] });
    base = lintN();
  };

  const garage = (room, o = {}) => {
    const bb = G.bbox(room.polygon);
    const two = Math.min(bb.w, bb.h) >= 5400 || (bb.w >= 5400);
    const cars = o.cars ?? (two ? 2 : 1);
    const horiz = bb.h >= bb.w; // cars nose to the garage door at the south wall
    for (let i = 0; i < cars; i++) {
      const item = i === 1 && o.ute !== false ? 'car_ute' : 'car_sedan';
      const inn = b.inner(room);
      const cw = get(item).w;
      const span = inn.x1 - inn.x0;
      const cx = cars === 1 ? (inn.x0 + inn.x1) / 2 : inn.x0 + span * (i === 0 ? 0.27 : 0.73);
      const y = inn.y1 - 150 - get(item).d / 2 - (o.pull ?? 0);
      let f = place(item, Math.round(cx), Math.round(y), horiz ? 0 : 0);
      if (!f) for (let dy = 100; dy <= 600 && !f; dy += 100) f = place(item, Math.round(cx), Math.round(y - dy), 0);
      void cw;
    }
    base = lintN();
    if (bb.h > 7000 || bb.w > 7000) { against('workbench', room, ['n', 'w', 'e'], ['start', 'end', 'c']); base = lintN(); }
    against('shelving', room, ['w', 'e', 'n'], ['start', 'end', 'c']);
    base = lintN();
  };

  const alfresco = (room) => {
    const bb = G.bbox(room.polygon);
    const inn = { x0: bb.minX, x1: bb.maxX, y0: bb.minY, y1: bb.maxY };
    const t = place('outdoor_table', (inn.x0 + inn.x1) / 2, (inn.y0 + inn.y1) / 2 - 150, 0);
    base = lintN();
    against('bbq', room, ['n', 'w', 'e'], ['start', 'end', 'c']);
    base = lintN();
    void t;
  };

  const rumpus = (room) => lounge(room, { dist: 2400 });

  const handlers = {
    bedroom: (r) => bedroom(r, hints[r.name] || {}),
    bathroom: bath, ensuite: bath,
    wc: (r) => { against('toilet', r, SIDES, sweep(r, 'n', 400, ['c', 'start', 'end'])); base = lintN(); against('vanity_single', r, SIDES, sweep(r, 'n', 750, ['c', 'start', 'end'])); base = lintN(); },
    laundry, robe: (r) => wardrobes(r, 2), study, rumpus, media: rumpus, living: (r) => lounge(r, hints[r.name] || {}),
    garage: (r) => garage(r, hints[r.name] || {}), carport: (r) => garage(r, hints[r.name] || {}), alfresco,
    family: (r) => openPlan(r, hints[r.name] || {}),
    kitchen: (r) => openPlan(r, hints[r.name] || {}),
    store: (r) => { against('shelving', r, SIDES, sweep(r, 'n', 1800, ['start', 'end', 'c'])); base = lintN(); },
    workshop: (r) => { against('workbench', r, SIDES, ['c', 'start', 'end']); base = lintN(); },
  };
  const ghosts = [];
  spec.levels.forEach((L, li) => {
    b.use(levelIds[li]);
    for (const k of L.keepClear || []) {
      const [x0, y0, x1, y1] = k;
      const g = b.place('shelving', (x0 + x1) / 2 + b.origin[0], (y0 + y1) / 2 + b.origin[1], 0, { w: x1 - x0, d: y1 - y0 });
      ghosts.push(g);
    }
  });
  base = lintN();
  spec.levels.forEach((L, li) => {
    b.use(levelIds[li]);
    for (const r of L.rooms) {
      const room = rooms[li][r.key];
      const h = (r.furn === false) ? null : handlers[room.type];
      if (h) h(room);
    }
  });
  for (const g of ghosts) del(g);
  const out = [];
  spec.levels.forEach((L, li) => {
    const lv = b.project.levels[li];
    for (const f of lv.furniture) out.push([li, f.item, f.x, f.y, f.rotation, f.w ?? null, f.d ?? null]);
  });
  return out;
}

const result = { ...existing };
for (const spec of SPECS) {
  if (only.length && !only.includes(spec.id)) continue;
  result[spec.id] = furnish(spec);
  console.log(`${spec.id}: ${result[spec.id].length} items`);
}
for (const k of Object.keys(result)) if (!SPECS.some((s) => s.id === k)) delete result[k];
const body = '{\n' + Object.entries(result).map(([k, v]) => `  ${JSON.stringify(k)}: [\n${v.map((r) => '    ' + JSON.stringify(r)).join(',\n')}\n  ]`).join(',\n') + '\n}';
writeFileSync(OUT, `// GENERATED by tools/furnish-generic.mjs. Do not edit by hand.\nexport const GENERIC_FURNITURE = ${body};\n`);
