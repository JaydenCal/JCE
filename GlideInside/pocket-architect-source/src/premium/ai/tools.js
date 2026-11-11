// Tool definitions for the assistant, generated from the operations registry (docs/SCOPE.md 7.5).
// The same list is sent by the server to the model, and used to check what comes back.

import { toolSchemas, OPS } from '../../model/ops.js';
import { lotOf, NOT_LOADED } from '../../model/site.js';

// Collect every `id` from an array, a palette object ({ steel: [{ id }], ... }) or nested mixes of both.
export function collectIds(source, out = new Set(), depth = 0) {
  if (!source || depth > 4) return out;
  if (Array.isArray(source)) {
    for (const item of source) collectIds(item, out, depth + 1);
  } else if (typeof source === 'string') {
    if (depth > 0) out.add(source);
  } else if (typeof source === 'object') {
    if (typeof source.id === 'string') out.add(source.id);
    else for (const value of Object.values(source)) collectIds(value, out, depth + 1);
  }
  return out;
}

/** Enumerations injected into the tool schemas. Missing catalogue parts are skipped. */
export function catalogueEnums(catalogue) {
  const enums = {};
  if (!catalogue) return enums;
  const finishes = catalogue.finishes || {};
  const furniture = [...collectIds(catalogue.FURNITURE ?? catalogue.furniture?.FURNITURE ?? catalogue.furniture)];
  const materials = [...collectIds(finishes.MATERIALS ?? finishes.materials)];
  const colours = [...collectIds(finishes.COLOURS ?? finishes.colours)];
  if (furniture.length) enums.furniture = furniture;
  if (materials.length) enums.materials = materials;
  if (colours.length) enums.colours = colours;
  return enums;
}

/** Anthropic tool list: one tool per registry operation. */
export function buildTools(catalogue) {
  return toolSchemas(catalogueEnums(catalogue));
}

export const OP_NAMES = Object.keys(OPS);

/** Operations that need a lot on the site, and those that only report (they change nothing). */
export const SITE_OP_NAMES = ['move_house', 'rotate_house', 'set_floor_level', 'check_setbacks', 'suggest_site_position'];
export const REPORT_OP_NAMES = ['check_setbacks'];

/**
 * Tool calls that make no sense for this design, checked in the browser before anything is applied. Returns an error
 * text or null. The server only sees the context text, so it cannot do this check; the operations repeat it when they run.
 */
export function siteCallProblem(name, project) {
  if (!SITE_OP_NAMES.includes(name)) return null;
  if (!lotOf(project)) return 'No lot is loaded for this design.';
  if ((name === 'check_setbacks' || name === 'suggest_site_position') && !project.site.lot.setbacks && !project.site.lot.envelope) return NOT_LOADED;
  return null;
}

const typeOk = (schema, v) => {
  switch (schema.type) {
    case 'number':
      return typeof v === 'number' && Number.isFinite(v);
    case 'string':
      return typeof v === 'string';
    case 'boolean':
      return typeof v === 'boolean';
    case 'array':
      return Array.isArray(v) && (schema.items?.type !== 'string' || v.every((x) => typeof x === 'string'));
    default:
      return true;
  }
};

/**
 * Check one tool call against the schemas. Returns { ok, args, error }. Unknown properties are
 * removed from args. Numbers sent as numeric strings are accepted.
 */
export function checkToolCall(name, input, tools = null) {
  const op = OPS[name];
  if (!op) return { ok: false, error: `Unknown operation ${name}` };
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { ok: false, error: `${name} needs an object of arguments` };
  const props = tools?.find((t) => t.name === name)?.input_schema?.properties || op.params;
  const args = {};
  for (const [key, value] of Object.entries(input)) {
    const schema = props[key];
    if (!schema || value === undefined) continue;
    let v = value;
    if (schema.type === 'number' && typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) v = Number(v);
    if (value === null && key === 'height') {
      args[key] = null;
      continue;
    }
    if (!typeOk(schema, v)) return { ok: false, error: `${name}: ${key} has the wrong type` };
    if (schema.enum && !schema.enum.includes(v)) return { ok: false, error: `${name}: ${key} must be one of the listed options` };
    if (schema.type === 'number' && ((schema.minimum != null && v < schema.minimum) || (schema.maximum != null && v > schema.maximum))) {
      return { ok: false, error: `${name}: ${key} must be between ${schema.minimum ?? '-infinity'} and ${schema.maximum ?? 'infinity'}` };
    }
    args[key] = v;
  }
  for (const key of op.required || []) {
    if (args[key] === undefined) return { ok: false, error: `${name}: ${key} is required` };
  }
  return { ok: true, args };
}

export default buildTools;
