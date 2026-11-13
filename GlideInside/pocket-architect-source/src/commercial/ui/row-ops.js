// Row operations on the spec: add a row, mirror a row, delete a row. Each is one undo step and regenerates the model.

import { defaultRow, deepMerge } from '../schema.js';
import { rowFrame, rowLength } from '../layout.js';
import { commercialEdit } from '../mode.js';

/** Add a row beside the selected one (or the last), one aisle and a bay row away from its front, copying its unit settings. */
export function addRow(store, fromId = null) {
  let id = null;
  commercialEdit(store, 'Add row', (c) => {
    const base = c.rows.find((r) => r.id === fromId && !r.mirrorOf) || [...c.rows].reverse().find((r) => !r.mirrorOf);
    const row = defaultRow({ count: base?.count || 6 });
    if (base) {
      row.unit = structuredClone(base.unit);
      row.rotationDeg = base.rotationDeg;
      const fr = rowFrame(base, c.rows);
      const step = base.unit.depthMm + c.parking.aisleMm + c.parking.bayL + 6000;
      row.x = Math.round(base.x + fr.v.x * step);
      row.y = Math.round(base.y + fr.v.y * step);
    }
    c.rows.push(row);
    id = row.id;
  });
  store.setUI({ commercialRow: id });
  return id;
}

/** Add the back to back partner of a row (sharing its rear party wall). Does nothing when the row is already mirrored or has one. */
export function mirrorRow(store, id) {
  let out = null;
  commercialEdit(store, 'Mirror row', (c) => {
    const base = c.rows.find((r) => r.id === id && !r.mirrorOf);
    if (!base || c.rows.some((r) => r.mirrorOf === base.id)) return;
    const row = defaultRow({ mirrorOf: base.id, count: base.count });
    row.unit = structuredClone(base.unit);
    row.perUnit = deepMerge({}, structuredClone(base.perUnit || {}));
    c.rows.push(row);
    out = row.id;
  });
  if (out) store.setUI({ commercialRow: out });
  return out;
}

/** Delete a row; deleting a source row also deletes its mirrored partner. */
export function deleteRow(store, id) {
  commercialEdit(store, 'Delete row', (c) => {
    c.rows = c.rows.filter((r) => r.id !== id && r.mirrorOf !== id);
  });
  store.setUI({ commercialRow: store.project.commercial?.rows[0]?.id || null });
}

export { rowLength };
