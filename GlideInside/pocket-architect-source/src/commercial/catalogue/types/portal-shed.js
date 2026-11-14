// Portal frame shed or factory. Built in a canonical frame (u along the length, v across the clear span) then swapped when the gable
// faces the street. Optional mezzanine office at the u = 0 end, front awning, side lean-to and a hardstand yard. Local plan mm.

import { Plan, num, sel, bool, makeType, mm, rectPoly, polyArea } from './_kitB.js';

export const PARAMS = [
  num('spanM', 'Clear span', 'm', 12, 40, 1, 24),
  num('baySpacingM', 'Bay spacing', 'm', 6, 9, 0.5, 7.5),
  num('bays', 'Number of bays', 'no.', 1, 30, 1, 6),
  num('eaveHeightM', 'Eave height', 'm', 4, 10, 0.5, 6),
  num('roofPitchDeg', 'Roof pitch', 'deg', 2, 25, 0.5, 7.5),
  sel('frontage', 'Street frontage', [{ value: 'gable', label: 'Gable end to the street' }, { value: 'side', label: 'Long side to the street' }], 'gable'),
  num('sideDoorsPerSide', 'Roller doors per long side', 'no.', 0, 6, 1, 2),
  num('gableDoors', 'Roller doors in the gable end', 'no.', 0, 3, 1, 1),
  num('doorWidthM', 'Roller door width', 'm', 3.5, 6, 0.5, 4.5),
  num('doorHeightM', 'Roller door height', 'm', 3.5, 6, 0.5, 4.5),
  bool('mezzanineOffice', 'Mezzanine office', false),
  num('mezzanineBays', 'Mezzanine length', 'bays', 1, 4, 1, 2),
  bool('awning', 'Front awning', false),
  num('awningDepthM', 'Awning depth', 'm', 3, 6, 0.5, 4),
  bool('leanTo', 'Side lean-to', false),
  num('leanToWidthM', 'Lean-to width', 'm', 4, 10, 0.5, 6),
  num('yardDepthM', 'Hardstand yard depth', 'm', 0, 60, 1, 20),
];

function build(p) {
  const pl = new Plan();
  const S = mm(p.spanM);
  const bay = mm(p.baySpacingM);
  const L = bay * p.bays;
  const eave = mm(p.eaveHeightM);
  const ridge = eave + Math.round((S / 2) * Math.tan((p.roofPitchDeg * Math.PI) / 180));
  pl.levels[0].heightMm = eave;
  pl.outline = rectPoly(0, 0, L, S); // u along x, v along y until swapped
  const ext = pl.rect(0, 0, L, S, { height: eave, thickness: 150 });
  // ext.front is the v = 0 long side, ext.back the v = S long side, ext.left the u = 0 gable, ext.right the u = L gable.
  const dw = mm(p.doorWidthM);
  const dh = Math.min(mm(p.doorHeightM), eave - 400);
  const place = (wall, n, along, perp) => {
    for (let i = 0; i < n; i++) {
      const c = ((i + 0.5) / n) * along;
      if (wall === ext.front) pl.openAt(wall, c, 0, 'roller_door', dw, dh, 0, { tag: 'side' });
      else if (wall === ext.back) pl.openAt(wall, c, perp, 'roller_door', dw, dh, 0, { tag: 'side' });
      else if (wall === ext.right) pl.openAt(wall, perp, c, 'roller_door', dw, dh, 0, { tag: 'gable' });
    }
  };
  place(ext.front, p.sideDoorsPerSide, L, 0);
  place(ext.back, p.sideDoorsPerSide, L, S);
  // Gable doors on the u = L end; the u = 0 end has a personnel door each side and keeps clear for the office.
  const gd = Math.min(p.gableDoors, Math.max(0, Math.floor(S / (dw + 3000))));
  place(ext.right, gd, S, L);
  pl.openAt(ext.left, 0, 2500, 'door', 920, 2040, 0);
  pl.openAt(ext.right, L, S - 2500, 'door', 920, 2040, 0);
  pl.openAt(ext.front, 3000, 0, 'door', 920, 2040, 0);

  // Mezzanine office.
  let mezzL = 0;
  const mezzD = Math.min(S, mm(6));
  if (p.mezzanineOffice) {
    mezzL = Math.min(p.mezzanineBays, p.bays) * bay;
    pl.level('Mezzanine', 3300, Math.max(2400, eave - 3300));
    pl.room('PROPOSED MEZZANINE OFFICE', 'other', rectPoly(0, 0, mezzL, mezzD), { level: 'Mezzanine', use: 'office', balustrade: true });
    pl.room('PROPOSED STORE AND AMENITIES UNDER MEZZANINE', 'store', rectPoly(0, 0, mezzL, mezzD), { use: 'amenities' });
    pl.wall({ x: mezzL, y: 0 }, { x: mezzL, y: mezzD }, { kind: 'interior', thickness: 100, height: 3000 });
    pl.wall({ x: 0, y: mezzD }, { x: mezzL, y: mezzD }, { kind: 'interior', thickness: 100, height: 3000 });
    pl.openAt(ext.front, mezzL / 2, 0, 'window', 2400, 1200, 1100, { style: 'fixed' });
    pl.openAt(ext.front, 3000 + 1500, 0, 'window', 1800, 1200, 1100, { style: 'fixed' });
    pl.box('mezzSlab', 0, 0, mezzL, mezzD, 3150, 3300, 'concrete', '#b9b6ad');
    pl.box('mezzRail', 0, mezzD - 40, mezzL, mezzD, 3300, 4300, 'steel', '#7d8389');
    pl.room('PROPOSED SHED', 'workshop', [{ x: mezzL, y: 0 }, { x: L, y: 0 }, { x: L, y: S }, { x: 0, y: S }, { x: 0, y: mezzD }, { x: mezzL, y: mezzD }], { use: 'shed' });
  } else {
    pl.room('PROPOSED SHED', 'workshop', rectPoly(0, 0, L, S), { use: 'shed' });
  }
  pl.roof(rectPoly(0, 0, L, S), 'gable', p.roofPitchDeg);

  // Frames: a column pair at every bay line.
  for (let i = 0; i <= p.bays; i++) {
    const u = i * bay;
    const a = Math.min(Math.max(u, 150), L - 150);
    for (const v of [150, S - 150]) pl.box('column', a - 150, v - 150, a + 150, v + 150, 0, eave, 'steel', '#6c7379');
    pl.box('eaveBeam', a - 100, 0, a + 100, S, eave - 200, eave, 'steel', '#6c7379'); // rafter line at eave level, pitched rafters are the roof
  }
  // Awning on the street face of the building (v = 0 side is the front when the side faces the street, the u = 0 gable otherwise).
  const awD = mm(p.awningDepthM);
  if (p.awning) {
    if (p.frontage === 'side') { pl.extra('awning', rectPoly(0, -awD, L, 0)); pl.box('awning', 0, -awD, L, 0, 3700, 3850, 'roof', '#8a8f94'); for (let i = 0; i <= p.bays; i++) pl.box('awningPost', i * bay - 80 + (i === 0 ? 80 : 0), -awD, i * bay + 80 + (i === 0 ? 80 : 0), -awD + 160, 0, 3700, 'steel', '#6c7379'); } else { pl.extra('awning', rectPoly(-awD, 0, 0, S)); pl.box('awning', -awD, 0, 0, S, 3700, 3850, 'roof', '#8a8f94'); for (let k = 0; k <= 4; k++) pl.box('awningPost', -awD, (S - 160) * (k / 4), -awD + 160, (S - 160) * (k / 4) + 160, 0, 3700, 'steel', '#6c7379'); }
  }
  if (p.leanTo) {
    const lw = mm(p.leanToWidthM);
    pl.extra('lean-to', rectPoly(0, S, L, S + lw));
    pl.roof(rectPoly(0, S, L, S + lw), 'skillion', 5);
    pl.box('leanRoof', 0, S, L, S + lw, eave - 600, eave - 450, 'roof', '#8a8f94');
    for (let i = 0; i <= p.bays; i++) pl.box('leanPost', i * bay - 100 + (i === 0 ? 100 : 0), S + lw - 200, i * bay + 100 + (i === 0 ? 100 : 0), S + lw, 0, eave - 600, 'steel', '#6c7379');
  }
  // Yard in front of the roller doors on the side opposite the lean-to (the v = 0 side), or in front of the gable.
  const yd = mm(p.yardDepthM);
  if (yd > 0) {
    if (p.frontage === 'side') pl.extra('yard', rectPoly(0, -yd - (p.awning ? awD : 0), L, -(p.awning ? awD : 0)));
    else pl.extra('yard', rectPoly(-yd - (p.awning ? awD : 0), 0, -(p.awning ? awD : 0), S));
  }
  pl.sym({ t: 'text', x: L / 2, y: S / 2, text: `PROPOSED SHED ${p.spanM} x ${(L / 1000).toFixed(1)} m`, size: 800 });
  for (let i = 1; i < p.bays; i++) pl.sym({ t: 'line', pts: [{ x: i * bay, y: 0 }, { x: i * bay, y: S }], stroke: '#999', w: 25, dash: [300, 400] });
  void ridge;
  if (p.frontage === 'gable') pl.swapXY();
  return pl;
}

export default makeType(
  {
    id: 'portal-shed', label: 'Portal frame shed or factory', category: 'industrial', zonesHint: ['E4', 'E5', 'IN1', 'IN2', 'RU1', 'RU5'], planLabel: 'PROPOSED SHED',
    costHints: { buildRateKey: 'shed', notes: 'Clear span and eave height drive the rate, add the mezzanine and lean-to separately' },
    extraQuantities: (p) => ({ bayCount: p.bays, lengthM: p.baySpacingM * p.bays, spanM: p.spanM, ridgeHeightM: Math.round((p.eaveHeightM + (p.spanM / 2) * Math.tan((p.roofPitchDeg * Math.PI) / 180)) * 10) / 10 }),
  },
  PARAMS,
  build,
  (p, pl) => {
    const gfa = polyArea(pl.outline) / 1e6;
    return {
      parking: { ratePerM2: [{ use: 'industry or factory', per: 1, m2: 100, status: 'ESTIMATE' }, { use: 'warehouse', per: 1, m2: 300, status: 'ESTIMATE' }, { use: 'mezzanine office', per: 1, m2: 40, status: 'ESTIMATE' }], accessible: true },
      vehicles: { design: p.spanM >= 24 || p.gableDoors > 0 ? 'HRV' : 'MRV', apronDepthMm: Math.max(15000, mm(p.yardDepthM)), docks: 0 },
      landscapeFrontMm: 3000,
      notes: ['Parking rate depends on whether the council treats the use as industry or warehouse, check with council', `Shed floor ${Math.round(gfa)} m2`],
    };
  },
);
