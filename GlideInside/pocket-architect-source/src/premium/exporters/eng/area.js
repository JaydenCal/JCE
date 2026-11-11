// Site area for the plan set: one figure for every sheet.
// The area is taken from the lot as drawn (the boundary ring less any holes), since that is what the sheets show; the registered plan
// area is used when the figure on file is the same lot, so a stored 789 m2 cannot sit on a 50 ha lot.

import * as G from '../../../model/geometry.js';
import { lotLabelLines } from '../../../site/lotplan.js';

/** Area of the lot polygon in m2 from the ring (plan mm) less holes, or null. */
export function polygonAreaM2(lot) {
  if (!lot?.boundary || lot.boundary.length < 3) return null;
  let a = G.polygonArea(lot.boundary);
  for (const h of lot.holes || []) if (h?.length > 2) a -= G.polygonArea(h);
  return a > 0 ? a / 1e6 : null;
}

/**
 * { m2, source } for the lot. Order: registered area when it agrees with the drawn lot to 10 percent (the legal figure), else the drawn
 * polygon, else the stored cadastre area. A registered figure given in hectares is recognised. Never a stored figure that disagrees
 * with the drawn lot by more than 10 percent.
 */
export function siteAreaOf(lot) {
  const poly = polygonAreaM2(lot);
  const near = (a, b) => a > 0 && b > 0 && Math.abs(a - b) / b <= 0.1;
  let reg = Number(lot?.registeredAreaM2) || 0;
  if (poly && reg && !near(reg, poly) && near(reg * 10000, poly)) reg *= 10000;
  if (poly) {
    // The registered area wins when it agrees with the drawn lot, or when it is larger (the outline loaded is only part of the lot)
    if (reg && (near(reg, poly) || reg > poly * 1.1)) return { m2: reg, source: 'registered', polygonM2: poly, partial: !near(reg, poly) };
    return { m2: poly, source: 'cadastre', polygonM2: poly, registeredM2: reg || null };
  }
  const stored = Number(lot?.areaM2) || 0;
  if (reg) return { m2: reg, source: 'registered', polygonM2: null };
  return stored ? { m2: stored, source: 'cadastre', polygonM2: null } : { m2: 0, source: 'none', polygonM2: null };
}

/** "789 m²" below 1 ha (10,000 m²), "50.93 ha" above. */
export function fmtArea(m2) {
  const v = Number(m2) || 0;
  if (v > 10000) return `${(v / 10000).toFixed(2)} ha`;
  return `${Math.round(v)} m²`;
}

/** The area text for the site facts: the figure and, where a registered area differs from the drawn lot, both. */
export function siteAreaText(lot) {
  const s = siteAreaOf(lot);
  if (!s.m2) return 'Not stated';
  if (s.partial) return `${fmtArea(s.m2)} (registered area; the cadastre outline loaded shows part of the lot)`;
  if (s.source === 'registered') return `${fmtArea(s.m2)} (registered)`;
  const reg = s.registeredM2;
  return reg ? `${fmtArea(s.m2)} (from the cadastre; registered ${fmtArea(reg)})` : `${fmtArea(s.m2)} (from the cadastre)`;
}

/** "LOT 3" and "DP 263990" for the sheets. A lot and DP the user typed in the title block wins; else the lot as loaded. */
export function lotIdLines(project, lot = project?.site?.lot) {
  const t = String(project?.titleBlock?.lotDp || '').replace(/\s+/g, ' ').trim();
  const m = /^lot\s*([0-9a-z]+)\s*(?:,|-)?\s*((?:sec(?:tion)?\.?\s*\w+\s*)?)((?:dp|sp|ps|cp|rp|sp)\s*\d+\w*)?$/i.exec(t);
  if (m) return { first: `LOT ${m[1].toUpperCase()}`, second: (m[3] || '').toUpperCase().replace(/^([A-Z]+)\s*/, '$1 '), proposed: false };
  if (t) return { first: t.toUpperCase(), second: '', proposed: false };
  return lotLabelLines(lot || {});
}
