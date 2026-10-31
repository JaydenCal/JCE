// Plan sanity checks used by the tests and the visual check page. Returns a list of problems.
// These are the same kinds of things the editor's soft validation warns about, plus furniture checks.

import * as G from '../../model/geometry.js';

const HABITABLE = new Set(['living', 'family', 'kitchen', 'dining', 'bedroom', 'study', 'rumpus', 'media']);
const ACCESS = new Set(['door', 'sliding_door', 'garage_door', 'roller_door', 'opening']);
const LIGHT = new Set(['window', 'sliding_door']);

function corners(cx, cy, w, d, rotDeg, shrink = 0) {
  const hw = Math.max(1, w / 2 - shrink);
  const hd = Math.max(1, d / 2 - shrink);
  const r = (rotDeg * Math.PI) / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  return [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]].map(([x, y]) => ({ x: cx + x * c - y * s, y: cy + x * s + y * c }));
}

// Convex polygon overlap (separating axis). Touching edges do not count.
export function polysOverlap(a, b) {
  for (const poly of [a, b]) {
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i];
      const q = poly[(i + 1) % poly.length];
      const ax = { x: q.y - p.y, y: p.x - q.x };
      let minA = Infinity;
      let maxA = -Infinity;
      let minB = Infinity;
      let maxB = -Infinity;
      for (const v of a) {
        const t = v.x * ax.x + v.y * ax.y;
        minA = Math.min(minA, t);
        maxA = Math.max(maxA, t);
      }
      for (const v of b) {
        const t = v.x * ax.x + v.y * ax.y;
        minB = Math.min(minB, t);
        maxB = Math.max(maxB, t);
      }
      if (maxA <= minB + 1e-6 || maxB <= minA + 1e-6) return false;
    }
  }
  return true;
}

// Room outlines can be concave (an L shaped hall), so sample points inside both outlines.
export function roomsOverlap(a, b) {
  const ba = G.bbox(a);
  const bb = G.bbox(b);
  const x0 = Math.max(ba.minX, bb.minX);
  const x1 = Math.min(ba.maxX, bb.maxX);
  const y0 = Math.max(ba.minY, bb.minY);
  const y1 = Math.min(ba.maxY, bb.maxY);
  if (x1 - x0 < 50 || y1 - y0 < 50) return false;
  for (let x = x0 + 25; x < x1; x += 100) {
    for (let y = y0 + 25; y < y1; y += 100) {
      if (G.pointInPolygon({ x, y }, a) && G.pointInPolygon({ x, y }, b)) return true;
    }
  }
  return false;
}

const distToPolygon = (p, poly) => Math.min(...G.polygonEdges(poly).map(([a, b]) => G.projectToSegment(p, a, b).d));

export function lintProject(project, catalogue) {
  const out = [];
  const tag = (l, msg) => out.push(project.levels.length > 1 ? `${l.name}: ${msg}` : msg);
  for (const l of project.levels) {
    const wallById = new Map(l.walls.map((w) => [w.id, w]));
    const indoor = l.rooms.filter((r) => !r.outdoor);
    const pos = (o) => {
      const w = wallById.get(o.wallId);
      return { w, c: G.pointOnWall(w, o.offset), d: G.wallDir(w), n: G.wallNormal(w) };
    };

    // Rooms must not overlap.
    for (let i = 0; i < l.rooms.length; i++) {
      for (let j = i + 1; j < l.rooms.length; j++) {
        if (roomsOverlap(l.rooms[i].polygon, l.rooms[j].polygon)) tag(l, `rooms overlap: ${l.rooms[i].name} and ${l.rooms[j].name}`);
      }
    }

    // A door into every enclosed room; windows on external walls of habitable rooms.
    for (const r of indoor) {
      const near = (o) => distToPolygon(pos(o).c, r.polygon) <= 150;
      if (!l.openings.some((o) => ACCESS.has(o.kind) && near(o))) tag(l, `no door into ${r.name}`);
      if (HABITABLE.has(r.type) && !l.openings.some((o) => LIGHT.has(o.kind) && near(o) && pos(o).w.kind === 'exterior')) tag(l, `no external window in ${r.name}`);
    }

    // Furniture checks.
    const items = l.furniture.map((f) => {
      const it = catalogue.getFurniture(f.item);
      const w = f.w ?? it.w;
      const d = f.d ?? it.d;
      return { f, it, w, d, tall: it.h >= 1300, poly: corners(f.x, f.y, w, d, f.rotation, 8), name: `${f.item} at ${f.x},${f.y}` };
    });
    for (const a of items) {
      const probe = corners(a.f.x, a.f.y, a.w, a.d, a.f.rotation, 12);
      if (!l.rooms.some((r) => probe.every((p) => G.pointInPolygon(p, r.polygon)))) tag(l, `${a.name} is not inside one room`);
      for (const w of l.walls) {
        const t = w.thickness / 2;
        const n = G.wallNormal(w);
        const wp = [G.add(w.a, G.mul(n, t)), G.add(w.b, G.mul(n, t)), G.add(w.b, G.mul(n, -t)), G.add(w.a, G.mul(n, -t))];
        if (polysOverlap(a.poly, wp)) tag(l, `${a.name} overlaps a wall`);
      }
    }
    for (let i = 0; i < items.length; i++) {
      for (let j = i + 1; j < items.length; j++) {
        const a = items[i];
        const b = items[j];
        if (a.f.item === 'rug' || b.f.item === 'rug') continue;
        if (polysOverlap(a.poly, b.poly)) tag(l, `furniture overlaps: ${a.name} and ${b.name}`);
      }
    }
    const solid = items.filter((a) => a.f.item !== 'rug');

    // Door swings and openings must stay clear; tall furniture must not cover windows.
    for (const o of l.openings) {
      const { c, d, n } = pos(o);
      const hw = o.width / 2;
      const P = (u, v) => G.add(G.add(c, G.mul(d, u)), G.mul(n, v));
      if (o.kind === 'door' && o.style !== 'cavity') {
        const hu = o.hinge === 'a' ? -hw : hw;
        const H = P(hu, 0);
        const closed = G.mul(d, hu < 0 ? 1 : -1);
        const open = G.mul(n, o.side >= 0 ? 1 : -1);
        for (const a of solid) {
          let hit = false;
          for (const rr of [0.35, 0.65, 0.97]) {
            for (let deg = 0; deg <= 90 && !hit; deg += 15) {
              const t = (deg * Math.PI) / 180;
              const p = G.add(H, G.mul(G.add(G.mul(closed, Math.cos(t)), G.mul(open, Math.sin(t))), rr * o.width));
              if (G.pointInPolygon(p, a.poly)) hit = true;
            }
          }
          if (hit) tag(l, `${a.name} blocks the swing of door ${o.id}`);
        }
      } else if (['door', 'sliding_door', 'opening'].includes(o.kind)) {
        for (const side of [-1, 1]) {
          const zone = [P(-hw, side * 60), P(hw, side * 60), P(hw, side * 700), P(-hw, side * 700)];
          for (const a of solid) if (polysOverlap(zone, a.poly)) tag(l, `${a.name} blocks ${o.kind} ${o.id}`);
        }
      } else if (o.kind === 'window') {
        for (const side of [-1, 1]) {
          const zone = [P(-hw, 0), P(hw, 0), P(hw, side * 350), P(-hw, side * 350)];
          for (const a of solid) if (a.tall && a.f.item !== 'plant' && polysOverlap(zone, a.poly)) tag(l, `${a.name} covers window ${o.id}`);
        }
      }
    }
  }

  // At least one external door or garage door in a building.
  const hasEntry = project.levels.some((l) => l.openings.some((o) => ['door', 'sliding_door', 'garage_door', 'roller_door'].includes(o.kind) && l.walls.find((w) => w.id === o.wallId)?.kind === 'exterior'));
  if (project.levels.some((l) => l.rooms.length) && !hasEntry) out.push('no external door');
  return out;
}
