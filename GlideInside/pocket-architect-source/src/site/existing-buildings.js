// Existing buildings on the lot (project.site.existingBuildings): a plain rectangle with a name, placed by the person. They are drawn on the
// site plan sheets in an existing convention (grey hatch, labelled) and in 3D as a light grey block, so the new work reads against what is already
// there. Nothing else reads them: they never count towards coverage, floor area or the design itself. Plan mm in the lot's frame, y down.
// Pure: no DOM.

export const EXISTING_LABEL = 'EXISTING DWELLING';
const num = (v, lo, hi, d) => (Number.isFinite(Number(v)) ? Math.min(hi, Math.max(lo, Number(v))) : d);
let seq = 0;

/** A clean record: { id, name, x, y (centre), widthMm, depthMm, rotationDeg, heightMm }. */
export function cleanExisting(e) {
  return {
    id: String(e?.id || `exb_${Date.now().toString(36)}${(seq++).toString(36)}`),
    name: String(e?.name || EXISTING_LABEL).slice(0, 60),
    x: num(e?.x, -1e7, 1e7, 0),
    y: num(e?.y, -1e7, 1e7, 0),
    widthMm: num(e?.widthMm, 1000, 200000, 12000),
    depthMm: num(e?.depthMm, 1000, 200000, 9000),
    rotationDeg: num(e?.rotationDeg, -360, 360, 0),
    heightMm: num(e?.heightMm, 2000, 12000, 3000),
  };
}

/** The outline of one record as four plan points. */
export function existingPoly(e) {
  const c = Math.cos((e.rotationDeg * Math.PI) / 180);
  const s = Math.sin((e.rotationDeg * Math.PI) / 180);
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => {
    const u = (a * e.widthMm) / 2;
    const v = (b * e.depthMm) / 2;
    return { x: e.x + c * u - s * v, y: e.y + s * u + c * v };
  });
}

/** Every existing building of a project: [{ ...record, poly }]. Safe on a project that has none. */
export function existingBuildingsOf(project) {
  const list = project?.site?.existingBuildings;
  return Array.isArray(list) ? list.filter((e) => e && typeof e === 'object').map((e) => { const r = cleanExisting(e); return { ...r, poly: existingPoly(r) }; }) : [];
}

/** Add one to a project object (the caller wraps it in store.apply for undo). Returns the record. */
export function addExistingBuilding(project, spec = {}) {
  const rec = cleanExisting(spec);
  project.site = { ...(project.site || {}), existingBuildings: [...(project.site?.existingBuildings || []), rec] };
  return rec;
}

export function removeExistingBuilding(project, id) {
  const list = project?.site?.existingBuildings;
  if (!Array.isArray(list)) return false;
  const next = list.filter((e) => e.id !== id);
  project.site.existingBuildings = next;
  return next.length !== list.length;
}

/** Change fields of one record (only the fields that are given). Returns the new record, or null when the id is unknown. */
export function updateExistingBuilding(project, id, patch = {}) {
  const list = project?.site?.existingBuildings;
  const i = Array.isArray(list) ? list.findIndex((e) => e.id === id) : -1;
  if (i < 0) return null;
  const merged = { ...list[i] };
  for (const [k, v] of Object.entries(patch)) if (v != null) merged[k] = v;
  const rec = cleanExisting(merged);
  project.site.existingBuildings = list.map((e, j) => (j === i ? rec : e));
  return rec;
}

/** True when the plan point lies inside the building. */
export function pointInExisting(e, pt) {
  const poly = e.poly || existingPoly(e);
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if ((a.y > pt.y) !== (b.y > pt.y) && pt.x < ((b.x - a.x) * (pt.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}
