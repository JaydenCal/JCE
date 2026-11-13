// A commercial test lot: 90 m x 100 m, frontage on edge 0, zoned IN1 General Industrial, with a two row back to back layout of 8 units each.
import { conadillyProject } from './conadilly-lot.mjs';
import { convertToCommercial } from '../../src/commercial/mode.js';
import { defaultRow } from '../../src/commercial/schema.js';
import { materialise } from '../../src/commercial/materialise.js';

export function commercialProject({ width = 90000, depth = 100000, zoning = { code: 'IN1', name: 'General Industrial' }, rows = 'pair', setbacks = null } = {}) {
  const p = conadillyProject({ corner: false, width, depth, setbacks: setbacks || { front: 10, secondaryFront: null, side: 3, rear: 3, edgeKinds: ['front', 'side', 'rear', 'side'] } });
  p.site.lot.zoning = zoning;
  p.site.lot.lga = 'TAMWORTH REGIONAL';
  p.site.lot.state = 'NSW';
  convertToCommercial(p, { useClass: 'industrial' });
  const base = p.commercial.rows[0];
  Object.assign(base, { x: 20000, y: 40000, rotationDeg: 0, count: 8 });
  base.unit.depthMm = 15000;
  materialise(p);
  if (rows === 'pair') {
    p.commercial.rows = [base, defaultRow({ mirrorOf: base.id, count: 8 })];
    p.commercial.rows[1].unit.depthMm = 15000;
    materialise(p);
  }
  return p;
}
