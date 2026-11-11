// Where the building sits against the lot boundary and the indicative setback envelope, in plain words, plus the ids of the
// walls that breach (drawn red in 2D and 3D). Pure: no DOM, no three.js. Wording never says "compliant": the envelope is
// indicative and council decides.
//
//   const c = lotChecks(project)
//   c.crossesBoundary  true when any part of the building is over a boundary line
//   c.messages         [{ kind: 'boundary' | 'envelope', edge, text }]
//   c.breachWallIds    Set of exterior wall ids over the boundary or inside the setback

import { clearances, clearanceToEdge, inwardNormalOf } from './lotplan.js';
import { classifyEdges, lotOf, checkSetbacks } from '../model/placement.js';
import * as G from '../model/geometry.js';

const TOL_M = 0.005;
const POINTS = ['north', 'north east', 'east', 'south east', 'south', 'south west', 'west', 'north west'];

/** Compass point (grid north is plan up) the boundary edge faces outward, e.g. "north east". */
export function edgeCompass(lot, i) {
  const n = inwardNormalOf(lot, i);
  const deg = (((Math.atan2(-n.x, n.y) * 180) / Math.PI) + 360) % 360; // outward = -n; bearing clockwise from north (-y)
  return POINTS[Math.round(deg / 45) % 8];
}

/** "north east boundary", or "front boundary (north east)" style words for an edge. */
export function edgeWords(lot, i) {
  return `${edgeCompass(lot, i)} boundary`;
}

const wallRing = (w) => { try { return G.wallPolygon(w); } catch { return null; } };

export function lotChecks(project) {
  const none = { status: 'none', crossesBoundary: false, messages: [], breachWallIds: new Set(), edges: [] };
  const lot = lotOf(project);
  if (!lot) return none;
  const c = clearances(project);
  if (c.status === 'no_building' || c.status === 'no_lot') return { ...none, status: c.status };
  const edges = classifyEdges(lot);
  const messages = [];
  const rows = c.rows.map((r) => ({ ...r, words: edgeWords(lot, r.edge) }));
  for (const r of rows) {
    if (r.clearanceM < -TOL_M) messages.push({ kind: 'boundary', edge: r.edge, overM: -r.clearanceM, text: `House crosses the lot boundary, ${(-r.clearanceM).toFixed(2)} m over the ${r.words}.` });
  }
  const crossed = new Set(messages.map((m) => m.edge));
  for (const r of rows) {
    if (r.status === 'outside' && !crossed.has(r.edge)) {
      messages.push({ kind: 'envelope', edge: r.edge, shortByM: r.shortByM, text: `Outside the indicative setback envelope by ${r.shortByM.toFixed(2)} m at the ${r.words}, check with council.` });
    }
  }
  const breachWallIds = new Set();
  const bad = new Map(rows.filter((r) => r.clearanceM < -TOL_M || r.status === 'outside').map((r) => [r.edge, r]));
  if (bad.size) {
    for (const level of project.levels || []) {
      for (const w of level.walls || []) {
        if (w.kind !== 'exterior' || w.status === 'demolish') continue;
        const ring = wallRing(w);
        if (!ring) continue;
        for (const [edge, r] of bad) {
          const d = clearanceToEdge([ring], lot, edge).d / 1000;
          if (d < -TOL_M || (r.requiredM != null && d < r.requiredM - TOL_M)) { breachWallIds.add(w.id); break; }
        }
      }
    }
  }
  return {
    status: messages.length ? 'breach' : c.status, crossesBoundary: messages.some((m) => m.kind === 'boundary'), messages, breachWallIds,
    edges: edges.map((e) => ({ index: e.index, kind: e.kind, words: edgeWords(lot, e.index) })),
  };
}

/** Plain words for why setbacks are missing, never a raw rule string. */
export function setbackUnavailableText(lot) {
  const sb = lot?.setbacks;
  if (!lot) return 'Setbacks appear once you have found a lot.';
  if (sb && (sb.front || sb.side || sb.rear)) return '';
  const council = lot.lga ? `${lot.lga} Council` : 'the council';
  return `Setbacks not available for this lot, check with ${council}. This design tool has no setback rule for this zone, use or lot size.`;
}

/** Replace raw "not determinable: front (no rule ...)" style strings with plain words. */
export function plainSetbackReason(text) {
  if (!text) return '';
  let t = String(text);
  if (/not determinable|no rule for this/i.test(t)) return 'Setbacks not available for this lot, check with council. There is no rule loaded for this zone, use or lot size.';
  t = t.replace(/\bnull\b|\bundefined\b/g, '').replace(/\s{2,}/g, ' ').trim();
  return t;
}

const KIND_WORD = { front: 'front', secondaryFront: 'secondary front', side: 'side', rear: 'rear', unknown: 'boundary' };

/**
 * The one line on the lot card: where the house sits against the setback envelope. Pure.
 *   { state: 'none' | 'inside' | 'outside' | 'check', text }
 * 'outside' is red: "Outside the setbacks: front, side". 'inside' is green: "Fits the setbacks". 'check' is amber and used when no
 * setback rule is loaded or the rule is flagged for council confirmation ("check with council"); it never reads as a pass or a fail.
 * The envelope is indicative, council decides, so the wording never claims approval.
 */
export function setbackStatusLine(project) {
  const lot = lotOf(project);
  if (!lot) return { state: 'none', text: '' };
  const c = clearances(project);
  if (c.status === 'no_building' || c.status === 'no_lot') return { state: 'none', text: '' };
  const crosses = c.rows.some((r) => r.clearanceM < -TOL_M);
  const outside = c.rows.filter((r) => r.status === 'outside');
  if (crosses || outside.length) {
    const words = [...new Set(c.rows.filter((r) => r.status === 'outside' || r.clearanceM < -TOL_M).map((r) => KIND_WORD[r.kind] || 'boundary'))];
    return { state: 'outside', text: `Outside the setbacks: ${words.join(', ')}` };
  }
  const flagged = c.rows.some((r) => r.flagged) || !!lot.setbacks?.flag;
  if (c.status === 'unknown' || !lot.setbacks) {
    // No per edge rules, but an indicative envelope is loaded: the placement panel checks against it, so the card agrees with it.
    if (Array.isArray(lot.envelope) && lot.envelope.length >= 3) {
      const chk = checkSetbacks(project);
      if (chk.status === 'ok') return { state: 'inside', text: 'Fits the setbacks' };
      if (chk.status === 'breach' && chk.breaches.length) {
        const words = [...new Set(chk.breaches.map((b) => KIND_WORD[b.kind] || 'boundary'))];
        return { state: 'outside', text: `Outside the setbacks: ${words.join(', ')}` };
      }
    }
    return { state: 'check', text: 'Setbacks not confirmed, check with council' };
  }
  if (flagged) return { state: 'check', text: 'Fits the setbacks, check with council' };
  return { state: 'inside', text: 'Fits the setbacks' };
}
