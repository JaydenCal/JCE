// The construction system of a commercial building: metal clad (the default), tilt-up concrete panels, precast panels, concrete panels below
// metal cladding, or blockwork. One set of parameters is shared by every catalogue type and by the strata unit rows, so the picker, the
// assistant tool schemas, the 3D model, the plan, the elevations and the feasibility cost all read the same record.
// Pure module: no DOM, no three.

import { CLADDING } from '../finishes.js';

export const DEFAULT_SYSTEM = 'metal_clad';

/** The systems in plain words. `panels` systems are drawn as discrete concrete panels with joints. */
export const SYSTEMS = Object.freeze([
  { id: 'metal_clad', label: 'Metal clad (steel frame with metal sheeting)', short: 'Metal clad', plain: 'Steel frame with metal sheet walls. The usual shed.', panels: false },
  { id: 'tilt_up', label: 'Tilt-up concrete panels (cast on site and lifted)', short: 'Tilt-up concrete panels', plain: 'Wall panels cast flat on the slab and tilted up with a crane.', panels: true },
  { id: 'precast', label: 'Precast concrete panels (cast off site)', short: 'Precast concrete panels', plain: 'Wall panels made in a factory and trucked to site.', panels: true },
  { id: 'tilt_up_metal_upper', label: 'Concrete panels below, metal cladding above', short: 'Concrete panels with metal above', plain: 'Concrete panels up to about 2.4 to 3.6 m with metal sheeting above.', panels: true },
  { id: 'blockwork', label: 'Concrete blockwork', short: 'Concrete blockwork', plain: 'Core-filled concrete blocks laid course by course.', panels: false },
]);
export const SYSTEM_IDS = SYSTEMS.map((s) => s.id);
export const systemById = (id) => SYSTEMS.find((s) => s.id === id) || SYSTEMS[0];
/** Systems drawn as separate concrete panels. */
export const isPanelSystem = (id) => !!systemById(id).panels;
/** Systems with a concrete wall (panels or blocks): they take a parapet. */
export const hasParapetSystem = (id) => id === 'tilt_up' || id === 'precast' || id === 'blockwork';

export const FINISHES = Object.freeze([
  { id: 'offform', label: 'Off-form grey concrete' },
  { id: 'painted', label: 'Painted' },
  { id: 'aggregate', label: 'Exposed aggregate' },
  { id: 'honed', label: 'Honed (ground smooth)' },
]);
export const REVEAL_MODES = Object.freeze([
  { value: 'none', label: 'None' },
  { value: 'one', label: 'One horizontal reveal' },
  { value: 'two', label: 'Two horizontal reveals' },
  { value: 'grooves', label: 'Fine grooves every 1.2 m' },
]);
export const ACCENT_MODES = Object.freeze([
  { value: 'none', label: 'None' },
  { value: 'corners', label: 'Corner panels' },
  { value: 'entry', label: 'Panels around the entry' },
  { value: 'both', label: 'Corners and entry' },
]);

const num = (key, label, unit, min, max, step, def, when) => ({ key, label, type: 'number', unit, min, max, step, default: def, when });
const sel = (key, label, options, def, when) => ({ key, label, type: 'select', unit: '', options, default: def, when });
const bool = (key, label, def, when) => ({ key, label, type: 'bool', unit: '', default: def, when });

const CONCRETE = ['tilt_up', 'precast', 'tilt_up_metal_upper'];
const PARAPET = ['tilt_up', 'precast', 'blockwork'];
const colourOptions = [{ value: 'project', label: 'Same as the wall colour chosen on the lot card' }, ...CLADDING.map((c) => ({ value: c.id, label: c.name }))];

/** The parameters every building type and strata unit row carries. `when` hides a parameter that does not apply to the chosen system. */
export const CONSTRUCTION_PARAMS = Object.freeze([
  sel('construction', 'Wall construction', SYSTEMS.map((s) => ({ value: s.id, label: s.label })), DEFAULT_SYSTEM),
  sel('panelFinish', 'Panel finish', FINISHES.map((f) => ({ value: f.id, label: f.label })), 'painted', { construction: CONCRETE }),
  sel('panelColour', 'Painted colour', colourOptions, 'project', { construction: CONCRETE, panelFinish: ['painted'] }),
  num('panelMaxWidthMm', 'Maximum panel width', 'mm', 2400, 6000, 100, 4000, { construction: CONCRETE }),
  num('panelThicknessMm', 'Panel thickness', 'mm', 150, 250, 10, 180, { construction: CONCRETE }),
  num('dadoHeightMm', 'Concrete height before the metal cladding', 'mm', 2400, 3600, 100, 3000, { construction: ['tilt_up_metal_upper'] }),
  bool('parapet', 'Parapet hiding the roof', true, { construction: PARAPET }),
  num('parapetHeightMm', 'Parapet height above the eaves', 'mm', 300, 2400, 100, 1200, { construction: PARAPET, parapet: [true] }),
  sel('panelReveals', 'Horizontal reveals and grooves', REVEAL_MODES, 'none', { construction: CONCRETE }),
  bool('featureBand', 'Feature band in the accent colour', false, { construction: CONCRETE }),
  sel('accentPanels', 'Accent panels', ACCENT_MODES, 'none', { construction: CONCRETE }),
  sel('accentColour', 'Accent colour', CLADDING.map((c) => ({ value: c.id, label: c.name })), 'charcoal', { construction: CONCRETE }),
  bool('signageBand', 'Signage band on the street frontage', false, { construction: CONCRETE }),
]);

export const CONSTRUCTION_KEYS = CONSTRUCTION_PARAMS.map((p) => p.key);
export const CONSTRUCTION_DEFAULTS = Object.freeze(Object.fromEntries(CONSTRUCTION_PARAMS.map((p) => [p.key, p.default])));

/** True when a parameter applies given the current values (used by the forms; the model always keeps every value). */
export function paramApplies(p, values) {
  if (!p.when) return true;
  return Object.entries(p.when).every(([k, list]) => list.includes(values?.[k]));
}

const numIn = (v, lo, hi, d) => { const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };
const pick = (v, list, d) => (list.includes(v) ? v : d);

/**
 * The normalised construction spec from a params object or a strata unit (same flat keys). Always complete:
 * { system, maxWidthMm, thicknessMm, finish, colour, parapetMm (0 for none), reveals, featureBand, accent, accentColour, signage, dadoMm }.
 */
export function constructionSpec(src = {}) {
  const system = pick(src?.construction, SYSTEM_IDS, DEFAULT_SYSTEM);
  const parapetOn = src?.parapet === undefined ? true : !!src.parapet;
  return {
    system,
    maxWidthMm: numIn(src?.panelMaxWidthMm, 2400, 6000, 4000),
    thicknessMm: numIn(src?.panelThicknessMm, 150, 250, 180),
    finish: pick(src?.panelFinish, FINISHES.map((f) => f.id), 'painted'),
    colour: src?.panelColour === 'project' || CLADDING.some((c) => c.id === src?.panelColour) ? src.panelColour : 'project',
    parapetMm: hasParapetSystem(system) && parapetOn ? numIn(src?.parapetHeightMm, 300, 2400, 1200) : 0,
    reveals: pick(src?.panelReveals, REVEAL_MODES.map((r) => r.value), 'none'),
    featureBand: !!src?.featureBand,
    accent: pick(src?.accentPanels, ACCENT_MODES.map((r) => r.value), 'none'),
    accentColour: CLADDING.some((c) => c.id === src?.accentColour) ? src.accentColour : 'charcoal',
    signage: !!src?.signageBand,
    dadoMm: numIn(src?.dadoHeightMm, 2400, 3600, 3000),
  };
}

/** The part of a spec that goes onto a model wall (w.panel). Null for metal clad. */
export function wallPanelOf(spec, { frontage = false } = {}) {
  return spec.system === DEFAULT_SYSTEM ? null : { ...spec, frontage };
}

export const hexOfCladding = (id, fallback = '#a7a8a3') => CLADDING.find((c) => c.id === id)?.hex || fallback;

/** One line for a card or the plan set schedule: "Tilt-up concrete panels, painted, up to 4.0 m wide". */
export function constructionLine(src) {
  const s = constructionSpec(src);
  const sys = systemById(s.system);
  if (s.system === DEFAULT_SYSTEM) return sys.short;
  if (s.system === 'blockwork') return `${sys.short}${s.parapetMm ? ', with parapet' : ''}`;
  const fin = FINISHES.find((f) => f.id === s.finish)?.label.toLowerCase() || s.finish;
  return `${sys.short}, ${fin}, up to ${(s.maxWidthMm / 1000).toFixed(1)} m wide${s.parapetMm ? ', with parapet' : ''}`;
}

// Types -------------------------------------------------------------------------------------------------------------------------

const perimeterM = (outline) => {
  let p = 0;
  for (let i = 0; i < outline.length; i++) { const a = outline[i]; const b = outline[(i + 1) % outline.length]; p += Math.hypot(b.x - a.x, b.y - a.y); }
  return p / 1000;
};

/** Wall areas for the cost: the external wall, and the part of it in concrete (panels and parapet, or the dado). */
export function wallBasis(spec, { wallM2 = 0, perimeterM: per = 0 }) {
  if (spec.system === DEFAULT_SYSTEM || !(wallM2 > 0)) return { system: spec.system, wallM2: Math.max(0, wallM2), panelWallM2: 0 };
  const h = per > 0 ? wallM2 / per : 0;
  if (spec.system === 'tilt_up_metal_upper') {
    const frac = h > 0 ? Math.min(1, spec.dadoMm / 1000 / h) : 1;
    return { system: spec.system, wallM2, panelWallM2: wallM2 * frac };
  }
  const par = spec.parapetMm > 0 ? (per * spec.parapetMm) / 1000 : 0;
  return { system: spec.system, wallM2, panelWallM2: wallM2 + par };
}

/** Wrap a catalogue type so it carries the construction parameters and reports its wall basis in quantities().construction. */
export function withConstruction(def) {
  if (!def || def.__construction) return def;
  const extra = CONSTRUCTION_PARAMS.filter((p) => !(def.params || []).some((q) => q.key === p.key));
  const baseDefaults = def.defaults;
  return {
    ...def,
    params: [...(def.params || []), ...extra],
    defaults(lot) {
      const own = typeof baseDefaults === 'function' ? baseDefaults.call(def, lot) : {};
      return { ...own, ...Object.fromEntries(extra.map((p) => [p.key, p.default])) };
    },
    quantities(params) {
      const q = def.quantities(params);
      let per = 0;
      try { per = perimeterM(def.footprint(params).outline); } catch { per = 0; }
      const spec = constructionSpec(params);
      return { ...q, construction: { ...wallBasis(spec, { wallM2: Number(q.wallM2) || 0, perimeterM: per }), line: constructionLine(params) } };
    },
    __construction: true,
  };
}

/** The wall basis of the strata rows of a commercial record: [{ system, wallM2, panelWallM2, rowId }] (front, rear and the two ends of each row). */
export function rowsWallBasis(commercial) {
  const out = [];
  for (const r of commercial?.rows || []) {
    const u = r.unit || {};
    const spec = constructionSpec(u);
    if (spec.system === DEFAULT_SYSTEM) continue;
    const count = Number(r.count) || 0;
    const W = count * (Number(u.widthMm) || 0);
    const D = Number(u.depthMm) || 0;
    const H = Number(u.heightMm) || 0;
    const per = (2 * (W + D)) / 1000;
    const wallM2 = (per * H) / 1000;
    out.push({ rowId: r.id, ...wallBasis(spec, { wallM2, perimeterM: per }) });
  }
  return out;
}
