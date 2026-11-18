// Site items that follow the house: the rainwater tanks beside it and the driveway to the street. Pure: no DOM.
//
// translateHouse and rotateHouse (src/model/placement.js) carry the tanks that stand beside the house with it, so a tank keeps its place
// against its wall. settleSiteItems then tidies up after a move, a turn, a change of design or Auto fit: a tank that has ended up outside
// the lot or the setbacks, in the house or on the driveway is put beside the nearest wall where there is room, and a driveway edit that
// no longer works for the new position is dropped so the driveway is routed again (src/site/lotplan.js deriveDriveway).
// Other site equipment (a hot water unit, an air conditioner) is furniture on a level, so it already moves with the house.

import * as G from '../model/geometry.js';
import { lotOf, envelopeOf, translateHouse, rotateHouse, classifyEdges, ATTACH_REACH_MM } from '../model/placement.js';
import { buildingRings, deriveDriveway, storedDriveway, setStoredDriveway, inwardNormalOf } from './lotplan.js';

export const DRIVEWAY_REROUTED = 'Driveway re-routed to suit the new position.';
const GAP = 250; // clear space between a tank and the wall

const edgeDist = (p, poly) => { let d = Infinity; for (let i = 0; i < poly.length; i++) d = Math.min(d, G.projectToSegment(p, poly[i], poly[(i + 1) % poly.length]).d); return d; };
const within = (p, poly, r) => poly.length >= 3 && G.pointInPolygon(p, poly) && edgeDist(p, poly) >= r;
const ringsGap = (p, rings) => { let d = Infinity; for (const ring of rings) { if (ring.length >= 3 && G.pointInPolygon(p, ring)) return -1; d = Math.min(d, edgeDist(p, ring)); } return d; };

// Notes for the fit card ("Driveway re-routed ... Undo"). One listener list for the page.
const listeners = new Set();
export function onSiteNote(fn) { listeners.add(fn); return () => listeners.delete(fn); }
const say = (note) => { for (const fn of [...listeners]) { try { fn(note); } catch { /* a card that has gone */ } } };

/** Where a tank may stand: 0 inside the setbacks, 1 inside the lot only, -1 not allowed (outside the lot, in the house, on the driveway, on another tank). */
export function tankSpot(project, tank, at = tank, ctx = context(project)) {
  const r = (tank.diameter || 2000) / 2;
  if (!ctx.lot || !within(at, ctx.lot.boundary, r + 100)) return -1;
  if (ringsGap(at, ctx.rings) < r + 50) return -1;
  if (ctx.drive && (G.pointInPolygon(at, ctx.drive) || edgeDist(at, ctx.drive) < r + 200)) return -1;
  for (const o of project.site?.tanks || []) if (o !== tank && o.id !== tank.id && G.dist(o, at) < r + (o.diameter || 2000) / 2 + 100) return -1;
  return !ctx.env || within(at, ctx.env, r) ? 0 : 1;
}

function context(project) {
  const lot = lotOf(project);
  const env = lot ? envelopeOf(lot).polygon : null;
  const dw = (() => { try { return deriveDriveway(project); } catch { return null; } })();
  return { lot, env: env && env.length >= 3 ? env : null, rings: buildingRings(project), drive: dw?.ok ? dw.polygon : null };
}

/** Candidate spots beside the outside walls of the ground floor. */
function wallSpots(project, r) {
  const g = [...(project.levels || [])].sort((a, b) => a.elevation - b.elevation)[0];
  const out = [];
  for (const w of g?.walls || []) {
    if (w.kind !== 'exterior' || w.status === 'demolish') continue;
    const len = G.dist(w.a, w.b);
    if (len < 600) continue;
    const t = G.norm(G.sub(w.b, w.a));
    const n = { x: -t.y, y: t.x };
    const off = (w.thickness || 150) / 2 + r + GAP;
    const steps = Math.max(1, Math.round(len / 500));
    for (let i = 0; i <= steps; i++) {
      const p = G.lerp(w.a, w.b, i / steps);
      for (const s of [1, -1]) out.push({ x: Math.round(p.x + n.x * off * s), y: Math.round(p.y + n.y * off * s) });
    }
  }
  return out;
}

/**
 * Tidy the site items after the house has moved (mutates `project`). Returns { tanksMoved, drivewayRerouted }.
 * `quiet` skips the note to the fit card (live drags, previews).
 */
export function settleSiteItems(project, { quiet = false } = {}) {
  const res = { tanksMoved: 0, drivewayRerouted: false };
  const lot = lotOf(project);
  if (!lot || !project.site) return res;
  // The driveway: an edit that no longer works here is dropped; the automatic route takes over.
  if (storedDriveway(project)) {
    let dw = null;
    try { dw = deriveDriveway(project); } catch { dw = null; }
    if (dw && (dw.storedInvalid || !dw.ok)) { setStoredDriveway(project, null); res.drivewayRerouted = true; }
  }
  const tanks = project.site.tanks || [];
  if (tanks.length) {
    const ctx = context(project);
    if (ctx.rings.length) {
      const f = classifyEdges(lot).find((e) => e.kind === 'front');
      const fn = f ? inwardNormalOf(lot, f.index) : null;
      const depth = (p) => (fn ? G.dot(G.sub(p, f.a), fn) : 0);
      const houseFront = fn ? Math.min(...ctx.rings.flat().map(depth)) : 0;
      for (const t of tanks) {
        const r = (t.diameter || 2000) / 2;
        const gap = ringsGap(t, ctx.rings);
        if (gap > ATTACH_REACH_MM + r) continue; // a tank that stands on its own (by a shed, down the back) is left alone
        const tier = tankSpot(project, t, t, ctx);
        if (tier === 0) continue;
        let best = null;
        for (const s of wallSpots(project, r)) {
          const k = tankSpot(project, t, s, ctx);
          if (k < 0 || (tier === 1 && k !== 0)) continue;
          // Nearest spot wins; a spot between the house and the street costs a little, so tanks keep to the sides and the back.
          const cost = k * 1e6 + G.dist(s, t) + (fn && depth(s) < houseFront ? 4000 : 0);
          if (!best || cost < best.cost) best = { s, cost };
        }
        if (best) { t.x = best.s.x; t.y = best.s.y; res.tanksMoved += 1; }
      }
    }
  }
  if (res.drivewayRerouted && !quiet) say({ kind: 'driveway', text: DRIVEWAY_REROUTED });
  return res;
}

/** Move the house and let the tanks and the driveway follow. Use these when a move is committed. */
export function moveHouseBy(project, dx, dy, opts) { translateHouse(project, dx, dy); return settleSiteItems(project, opts); }
export function turnHouseBy(project, deg, c, opts) {
  rotateHouse(project, deg, c);
  // An edited driveway (the Driveway PI tool, project.site.driveway) turns with the house, so its PIs keep their place against the garage.
  // The kerb end stays on the frontage. settleSiteItems then drops the edit only if it no longer works, and the automatic route takes over.
  const sd = storedDriveway(project);
  if (sd) setStoredDriveway(project, { ...sd, pis: sd.pis.map((q) => G.rotatePoint(q, c, deg)) });
  return settleSiteItems(project, opts);
}
