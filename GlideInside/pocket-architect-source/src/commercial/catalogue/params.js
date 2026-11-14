// Parameter handling shared by every building type: option lists, clamping and the merge of stored values over a type's defaults.

/** [{ value, label }] from an options list that may hold plain strings, [value, label] pairs or { value, label } objects. */
export function optionList(p) {
  return (p.options || []).map((o) => (o && typeof o === 'object' && !Array.isArray(o) ? { value: o.value, label: o.label ?? String(o.value) } : Array.isArray(o) ? { value: o[0], label: o[1] ?? String(o[0]) } : { value: o, label: String(o) }));
}

const clampNum = (v, p, fallback) => {
  let n = Number(v);
  if (!Number.isFinite(n)) n = Number.isFinite(Number(fallback)) ? Number(fallback) : 0;
  if (Number.isFinite(p.min)) n = Math.max(p.min, n);
  if (Number.isFinite(p.max)) n = Math.min(p.max, n);
  return n;
};

/** One value coerced to what the param allows. */
export function coerceParam(p, v, fallback) {
  if (p.type === 'bool') return typeof v === 'boolean' ? v : v == null ? !!fallback : v === 'true' || v === 1 || v === '1';
  if (p.type === 'select') {
    const opts = optionList(p);
    const hit = opts.find((o) => String(o.value) === String(v));
    if (hit) return hit.value;
    const fb = opts.find((o) => String(o.value) === String(fallback));
    return fb ? fb.value : opts[0]?.value;
  }
  return clampNum(v, p, fallback);
}

/** A complete, valid params object: the type's defaults with the stored values on top, clamped. Unknown keys are dropped. */
export function paramsOf(def, raw = {}) {
  const base = def.defaults ? def.defaults() : {};
  const out = {};
  for (const p of def.params || []) {
    const fb = base[p.key] ?? p.default;
    out[p.key] = coerceParam(p, raw && p.key in raw ? raw[p.key] : fb, fb);
  }
  return out;
}

/** Display text of a value, for the parameter form and schedules. */
export const paramText = (p, v) => (p.type === 'select' ? optionList(p).find((o) => String(o.value) === String(v))?.label ?? String(v) : p.type === 'bool' ? (v ? 'Yes' : 'No') : `${v}${p.unit ? ` ${p.unit}` : ''}`);
