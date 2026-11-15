// The building type catalogue as the assistant sees it: the real registry in src/commercial/catalogue/types (INTERFACE.md there), minus the
// strata unit type, which the assistant plans with its own row tools. The assistant works on the same types, building records, placement
// and bays as the catalogue, so a building it adds is drawn by the catalogue's materialise, plan symbols and 3D. Tests may override the
// list with setCommercialTypes. Every call into a type module is guarded, so a broken type never breaks the assistant.

import { TYPES as REGISTRY, STRATA_ID } from '../../commercial/catalogue/types/index.js';

let OVERRIDE = null;

const isType = (t) => t && typeof t === 'object' && typeof t.id === 'string' && typeof t.label === 'string' && Array.isArray(t.params);

/** Override the types (tests pass fixtures; null goes back to the real catalogue). */
export function setCommercialTypes(list) {
  OVERRIDE = Array.isArray(list) ? list.filter(isType) : null;
  return commercialTypes();
}
export const commercialTypes = () => OVERRIDE || REGISTRY.filter((t) => isType(t) && t.id !== STRATA_ID);
export const hasCatalogue = () => commercialTypes().length > 0;

/** Kept for the panel: the registry is imported with this module, so this resolves at once. */
export async function loadCommercialTypes() {
  return commercialTypes();
}

export const typeById = (id) => commercialTypes().find((t) => t.id === id) || null;

const guard = (fn, fallback) => {
  try {
    const v = fn();
    return v === undefined ? fallback : v;
  } catch {
    return fallback;
  }
};

/** Parameter defaults: the type's own defaults(lot), else the default of each parameter. */
export function defaultsOf(type, lot = null) {
  const own = guard(() => type.defaults(lot), null);
  if (own && typeof own === 'object') return { ...own };
  const out = {};
  for (const p of type.params) if (p.default !== undefined) out[p.key] = p.default;
  return out;
}

/** Check and merge parameters: { ok, params } or { ok: false, error }. Unknown keys are refused; numbers must sit inside min and max. */
export function resolveParams(type, given = {}, base = null, lot = null) {
  const out = { ...(base || defaultsOf(type, lot)) };
  for (const [key, raw] of Object.entries(given || {})) {
    const def = type.params.find((p) => p.key === key);
    if (!def) return { ok: false, error: `${type.label} has no parameter ${key}. Parameters are: ${type.params.map((p) => p.key).join(', ')}.` };
    let v = raw;
    if (def.type === 'number') {
      v = Number(raw);
      if (!Number.isFinite(v)) return { ok: false, error: `${key} must be a number.` };
      if ((def.min != null && v < def.min) || (def.max != null && v > def.max)) return { ok: false, error: `${key} must be between ${def.min ?? 'any'} and ${def.max ?? 'any'}${def.unit ? ` ${def.unit}` : ''}.` };
    } else if (def.type === 'bool') {
      if (typeof raw !== 'boolean') return { ok: false, error: `${key} must be true or false.` };
    } else if (def.type === 'select') {
      const opts = (def.options || []).map((o) => (typeof o === 'object' ? o.value ?? o.id : o));
      if (!opts.includes(raw)) return { ok: false, error: `${key} must be one of: ${opts.join(', ')}.` };
    }
    out[key] = v;
  }
  return { ok: true, params: out };
}

/** What the type works out for a building: outline (local), extras, quantities and site needs. Missing pieces come back null. */
export function typeFacts(type, params) {
  const fp = guard(() => type.footprint(params), null);
  const outline = Array.isArray(fp?.outline) && fp.outline.length >= 3 ? fp.outline.map((p) => ({ x: Number(p.x), y: Number(p.y) })) : null;
  return {
    outline,
    extras: Array.isArray(fp?.extras) ? fp.extras : [],
    quantities: guard(() => type.quantities(params), null),
    site: guard(() => type.site(params), null),
  };
}

const range = (p) => (p.min != null || p.max != null ? `${p.min ?? ''}..${p.max ?? ''}` : '');
const opt = (p) => (p.type === 'select' ? `{${(p.options || []).map((o) => (typeof o === 'object' ? o.value ?? o.id : o)).join('|')}}` : p.type === 'bool' ? 'bool' : range(p));

/** One line per type for the plan context. */
export function typeLine(type) {
  const params = type.params.map((p) => `${p.key}${opt(p) ? `(${opt(p)}${p.unit ? ` ${p.unit}` : ''})` : ''}=${p.default ?? ''}`).join(' ');
  const hint = Array.isArray(type.zonesHint) && type.zonesHint.length ? ` zones=${type.zonesHint.join('/')}` : '';
  return `TYPE ${type.id} "${String(type.label).slice(0, 50)}" ${type.category || 'other'}${hint} params: ${params}`;
}
