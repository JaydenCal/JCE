// The designs the lot card carousel steps through, ranked by how well each fits the lot's setback envelope (src/portal/fit.js).
//   Builder portal: the builder's own library first (never another builder's designs); the Glide Inside library only when the builder
//                   has none. client-mode.js registers this as window.__ps.lotDesigns.
//   Public app:     the template designs (house, granny flat, duplex).
// A design is { id, name, project, fit? }. Pure apart from the optional catalogue call.

import { rankDesigns } from '../portal/fit.js';
import { lotOf } from '../model/placement.js';

export const PUBLIC_TEMPLATE_IDS = ['house_single', 'house_double', 'granny_flat', 'duplex'];

/** Envelope polygon (plan mm) of the lot on the design, or null when none is loaded. */
export const envelopeOfProject = (project) => {
  const e = lotOf(project)?.envelope;
  return Array.isArray(e) && e.length >= 3 ? e : null;
};

/** Rank when an envelope is known, else keep the order given. */
export function rankFor(project, designs) {
  const env = envelopeOfProject(project);
  if (!env) return designs.map((d) => ({ ...d, fit: null }));
  return rankDesigns(designs, env);
}

/**
 * The builder's own designs, ranked for the lot. Builder staff with an empty library fall back to the Glide Inside library so the
 * carousel is never blank; a client login never sees the Glide library (allowGlide false), only the builder's designs.
 */
export function builderDesigns(project, all, { allowGlide = true } = {}) {
  const mine = all.filter((d) => d.group === 'builder');
  return rankFor(project, mine.length || !allowGlide ? mine : all.filter((d) => d.group === 'glide'));
}

export function publicDesigns(catalogue, project) {
  const list = Array.isArray(catalogue?.templates) ? catalogue.templates.filter((t) => PUBLIC_TEMPLATE_IDS.includes(t.id)) : [];
  const out = [];
  for (const t of list) {
    let proj = null;
    try { proj = catalogue.createFromTemplate ? catalogue.createFromTemplate(t.id) : t.create?.(); } catch { proj = null; }
    if (proj?.levels?.length) out.push({ id: t.id, name: t.name || t.id, project: proj, group: 'public' });
  }
  return rankFor(project, out);
}

/** Index of the design that is placed now, by saved id, else by name. -1 when the placed house is not one of the designs (never guess the first). */
export function currentIndex(designs, project, uiPlaced = null) {
  const placed = uiPlaced || project?.placedHouse || null;
  if (placed) {
    const i = designs.findIndex((d) => (placed.id && d.id === placed.id) || (placed.name && d.name === placed.name));
    if (i >= 0) return i;
  }
  const j = designs.findIndex((d) => d.name === project?.name);
  return j;
}

/** The carousel title: "NAME · 1 / 4". */
/** The carousel title: "NAME · 1 / 4". When the placed house is not one of the designs (i < 0) it is the placed house's own name and the count. */
export const pagerText = (designs, i, placedName = '') => (!designs.length ? '' : i < 0 ? `${placedName ? `${placedName} · ` : ''}${designs.length} designs` : `${designs[i].name} · ${i + 1} / ${designs.length}`);

export const stepIndex = (n, i, dir) => (!n ? 0 : i < 0 ? (dir > 0 ? 0 : n - 1) : (((i + dir) % n) + n) % n);
