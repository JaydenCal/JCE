// Optional site constraint overlays on the plan set site sheet (hook only: the exporter is being reworked elsewhere).
// Only layers switched on in the Site panel (site.lot.layers.ov_*) are drawn. Outline only, in the layer colour, clipped to the viewport by
// the caller's `seg`; the legend gets one line per layer plus the caution. `S` maps plan mm to page mm.

import { legendEntries } from '../../../site/overlays.js';

const DASH = { flood: [2.4, 0.9], bushfire: [0.8, 0.8], heritage: [3.2, 0.7, 0.5, 0.7], easement: [1.4, 1.0] };

/** Draw the switched-on overlay outlines. seg(a, b) draws one clipped segment between page points. */
export function drawOverlayOutlines(doc, lot, S, seg) {
  const on = legendEntries(lot);
  if (!on.length) return 0;
  let n = 0;
  for (const e of on) {
    const layer = lot.overlays.layers.find((l) => l.id === e.id);
    doc.setDrawColor(...e.rgb);
    doc.setLineWidth(0.25);
    doc.setLineDashPattern(DASH[e.id] || [1, 1], 0);
    for (const f of layer.features) {
      for (const poly of f.rings) {
        for (const ring of [poly.outer, ...poly.holes]) {
          const pts = ring.map(S);
          for (let i = 0; i < pts.length; i++) { seg(pts[i], pts[(i + 1) % pts.length]); n++; }
        }
      }
    }
  }
  doc.setLineDashPattern([], 0);
  return n;
}

/** Legend rows ([label, draw(doc, a, b)]) in the shape legendBlock() uses, for the layers that are on. */
export function overlayLegendItems(lot) {
  return legendEntries(lot).map((e) => [`${e.label} (indicative)`, (doc, a, b) => {
    doc.setDrawColor(...e.rgb);
    doc.setLineWidth(0.3);
    doc.setLineDashPattern(DASH[e.id] || [1, 1], 0);
    doc.line(a, b, a + 12, b);
    doc.setLineDashPattern([], 0);
  }]);
}
