// Opening presets: from the catalogue when it is present, otherwise the Appendix C defaults.

import { DEFAULTS, tankSize } from '../model/schema.js';
import { KIND_LABEL } from './tools-meta.js';

export function getPresets(catalogue, kind) {
  let list = [];
  try {
    list = catalogue?.openings?.presetsFor?.(kind) || [];
  } catch {
    list = [];
  }
  if (list.length) return list;
  const d = DEFAULTS.openings[kind] || DEFAULTS.openings.window;
  return [{ id: `default_${kind}`, kind, name: `${KIND_LABEL[kind] || 'Opening'} ${d.width} × ${d.height}`, width: d.width, height: d.height, sill: d.sill, style: d.style }];
}

// The armed preset for a tool, or the first one for that kind.
export function activePreset(catalogue, kind, presetId) {
  const list = getPresets(catalogue, kind);
  return list.find((p) => p.id === presetId) || list[0];
}

export function tankChoices(catalogue) {
  const fromCatalogue = catalogue?.tanks?.TANKS;
  if (Array.isArray(fromCatalogue) && fromCatalogue.length) return fromCatalogue.map((t) => ({ capacityL: t.capacityL, diameter: t.diameter, height: t.height, name: t.name || `${t.capacityL.toLocaleString('en-AU')} L` }));
  return DEFAULTS.tanks.map((t) => ({ ...t, name: `${t.capacityL.toLocaleString('en-AU')} L` }));
}

export function tankDims(capacityL) {
  return tankSize(capacityL);
}
