// Config table for GET /api/site/overlays: which open government ArcGIS layer answers each constraint overlay, per state.
// To change an endpoint, change the table only (the route, clipping and the summary card read it). Full notes: docs/SITE_OVERLAYS.md.
//
// NSW entries are taken from the JCESite constraints agent (branch claude/jcesite-stage8, cadastral-platform/backend/app/agents/sa9_constraints/
// endpoints_nsw.json), verified live on 12/10/2026: each layer's metadata read and a statewide count query returned features, and a point
// query over a Gunnedah lot returned valid JSON. `statewide` is that count. Notes are kept as JCESite wrote them.
//   kind 'area'   polygons are returned, clipped to the box, and can be drawn
//   kind 'value'  a planning control map (lot size, height, FSR): a point query at the lot centre returns values for the card, no polygons
// `fallbacks` are other URLs for the SAME data, tried in order when the first fails.
// Queensland: JCESite has no verified QLD endpoint (every QLD entry there has endpoint None), so QLD keeps the one cadastre layer already
// verified here (easements) and reports the rest as unavailable with a council overlay map note.

const H = 'https://mapprod3.environment.nsw.gov.au/arcgis/rest/services';
const NSW_PP = 'NSW Department of Planning, Housing and Infrastructure (Planning Portal spatial services)';
const dateMs = (v) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : null);
const clean = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const pick = (a, ...keys) => { for (const k of keys) { const v = clean(a?.[k]); if (v) return v; } return ''; };
const join = (...p) => clean(p.filter(Boolean).join(', '));
const newest = (a, fields) => { let m = null; for (const f of fields) { const d = dateMs(a?.[f]); if (d && (!m || d > m)) m = d; } return m; };

const nsw = (id, label, category, layer, o) => ({
  id, state: 'NSW', label, category, kind: 'area', source: `${NSW_PP}, ${o.layerName}`, attribution: `${NSW_PP}. Licence to be confirmed.`,
  urls: [`${H}/${layer}`, ...(o.fallbacks || [])], verified: 'jcesite', checked: '12/10/2026', ...o,
  classify: (a) => { const c = o.map(a); return { label: c.label, detail: c.detail || '', dateMs: newest(a, o.dateFields || ['CURRENCY_DATE']), ...(c.extra || {}) }; },
});

export const OVERLAY_SOURCES = [
  nsw('flood', 'Flood planning area', 'flood', 'Planning/Hazard/MapServer/1', {
    layerName: 'Flood Planning (LEP flood planning map)', statewide: 629, fallbacks: [`${H}/ePlanning/Planning_Portal_Hazard/MapServer/230`],
    outFields: 'LAY_CLASS,EPI_NAME,LGA_NAME,CURRENCY_DATE',
    notes: 'LEP flood planning maps only (629 polygons statewide). Council flood studies are NOT covered, so "none mapped" does not mean flood free.',
    map: (a) => ({ label: pick(a, 'LAY_CLASS') || 'Flood planning area', detail: join(a.EPI_NAME, a.LGA_NAME) }),
  }),
  nsw('bushfire', 'Bushfire prone land', 'bushfire', 'Fire/BFPL/MapServer/0', {
    layerName: 'Bush Fire Prone Land (RFS)', statewide: 229946, fallbacks: [`${H}/ePlanning/Planning_Portal_Hazard/MapServer/229`],
    outFields: 'Category,d_Category,LastUpdate,VerDate', dateFields: ['LastUpdate', 'VerDate'],
    attribution: 'NSW Rural Fire Service, Bush Fire Prone Land (collated from certified local council maps). Licence to be confirmed.',
    notes: 'RFS Bush Fire Prone Land: vegetation Category 1, 2, 3 and buffer. Collated from individual council maps, so check the council map for the lot.',
    map: (a) => { const cat = pick(a, 'd_Category', 'Category'); return { label: /buffer/i.test(cat) ? 'Vegetation buffer' : /^\d$/.test(cat) ? `Vegetation Category ${cat}` : cat || 'Bush fire prone land' }; },
  }),
  nsw('heritage_item', 'Heritage item', 'heritage', 'Planning/EPI_Primary_Planning_Layers/MapServer/0', {
    layerName: 'Heritage (LEP heritage items)', statewide: 39217, where: "LAY_CLASS NOT LIKE 'Conservation Area%' AND LAY_CLASS <> 'Heritage Conservation Area'",
    outFields: 'H_NAME,SIG,LAY_CLASS,EPI_NAME,CURRENCY_DATE', notes: 'LEP heritage polygons (items), state and local. State Heritage Register listings can also apply.',
    map: (a) => ({ label: `Heritage item${pick(a, 'H_NAME') ? `: ${pick(a, 'H_NAME')}` : ''}`, detail: join(pick(a, 'SIG') ? `${pick(a, 'SIG')} significance` : '', a.EPI_NAME) }),
  }),
  nsw('heritage_conservation', 'Heritage conservation area', 'heritage', 'Planning/EPI_Primary_Planning_Layers/MapServer/0', {
    layerName: 'Heritage (LEP conservation areas)', statewide: 1123, where: "LAY_CLASS LIKE 'Conservation Area%' OR LAY_CLASS = 'Heritage Conservation Area'",
    outFields: 'H_NAME,LAY_CLASS,EPI_NAME,CURRENCY_DATE', notes: 'Same layer as heritage items, conservation area classes.',
    map: (a) => ({ label: `Heritage conservation area${pick(a, 'H_NAME') ? `: ${pick(a, 'H_NAME')}` : ''}`, detail: pick(a, 'EPI_NAME') }),
  }),
  nsw('acid_sulfate', 'Acid sulfate soils', 'acid_sulfate', 'Planning/Protection/MapServer/1', {
    layerName: 'Acid Sulfate Soils (LEP class maps)', statewide: 9089, outFields: 'LAY_CLASS,EPI_NAME,CURRENCY_DATE', notes: 'LEP acid sulfate soils class maps.',
    map: (a) => ({ label: pick(a, 'LAY_CLASS') || 'Acid sulfate soils', detail: pick(a, 'EPI_NAME') }),
  }),
  nsw('biodiversity', 'Biodiversity values', 'biodiversity', 'ePlanning/BiodiversityValuesMap/MapServer/1', {
    layerName: 'Biodiversity Values Map (BC Act)', statewide: 600625, outFields: 'BV_Category,Criteria,VerDate,Date_Added', dateFields: ['VerDate', 'Date_Added'],
    notes: 'Biodiversity Values Map under the Biodiversity Conservation Act.', map: (a) => ({ label: pick(a, 'BV_Category') || 'Biodiversity values', detail: pick(a, 'Criteria') }),
  }),
  nsw('coastal', 'Coastal wetlands', 'coastal', 'Planning/SEPP_Resilience_and_Hazards_2021/MapServer/3', {
    layerName: 'Coastal Wetlands (SEPP Resilience and Hazards)', statewide: 7795, outFields: 'LABEL,MAP_NAME,CURRENCY_DATE',
    notes: 'Coastal wetlands only. Coastal environment and coastal use areas are separate rows.', map: (a) => ({ label: pick(a, 'LABEL', 'MAP_NAME') || 'Coastal wetlands', detail: pick(a, 'MAP_NAME') }),
  }),
  nsw('coastal_env', 'Coastal environment area', 'coastal', 'Planning/SEPP_Resilience_and_Hazards_2021/MapServer/6', {
    layerName: 'Coastal Environment Area (SEPP Resilience and Hazards)', statewide: null, outFields: '*', verified: 'jcesite-alternate',
    notes: 'Listed by JCESite as a verified alternate (layer 6). Field names were not recorded, so the label is read from whichever of LABEL, LAY_CLASS, MAP_NAME is present.',
    map: (a) => ({ label: pick(a, 'LABEL', 'LAY_CLASS', 'MAP_NAME') || 'Coastal environment area', detail: pick(a, 'EPI_NAME') }),
  }),
  nsw('riparian', 'Riparian land and watercourses', 'water', 'Planning/Protection/MapServer/7', {
    layerName: 'Riparian Lands and Watercourses (LEP)', statewide: 95500, outFields: 'LAY_NAME,LAY_CLASS,EPI_NAME,CURRENCY_DATE', notes: 'LEP riparian lands and watercourses maps.',
    map: (a) => ({ label: pick(a, 'LAY_CLASS', 'LAY_NAME') || 'Riparian land', detail: pick(a, 'EPI_NAME') }),
  }),
  nsw('land_reservation', 'Land reservation for acquisition', 'reservation', 'Planning/EPI_Primary_Planning_Layers/MapServer/3', {
    layerName: 'Land Reservation Acquisition (LEP)', statewide: 5462, outFields: 'AUTHORITY,LRA_TYPE,LAY_CLASS,EPI_NAME,CURRENCY_DATE', notes: 'LEP land reservation acquisition.',
    map: (a) => ({ label: pick(a, 'LRA_TYPE', 'LAY_CLASS') || 'Land reservation acquisition', detail: join(pick(a, 'AUTHORITY') ? `Authority: ${pick(a, 'AUTHORITY')}` : '', a.EPI_NAME) }),
  }),
  nsw('airport', 'Airport noise (ANEF)', 'airport', 'Planning/Protection/MapServer/2', {
    layerName: 'Airport Noise (LEP)', statewide: 29, outFields: 'ANEF_CODE,LAY_NAME,EPI_NAME,CURRENCY_DATE', notes: 'LEP airport noise (29 polygons statewide).',
    map: (a) => ({ label: pick(a, 'ANEF_CODE') ? `ANEF ${pick(a, 'ANEF_CODE')}` : pick(a, 'LAY_NAME') || 'Airport noise', detail: pick(a, 'EPI_NAME') }),
  }),
  nsw('ols', 'Airport obstacle limitation surface', 'airport', 'Planning/Protection/MapServer/6', {
    layerName: 'Obstacle Limitation Surface', statewide: null, outFields: '*', verified: 'jcesite-alternate',
    notes: 'Listed by JCESite as a verified alternate (Protection layer 6). Field names were not recorded.', map: (a) => ({ label: pick(a, 'LAY_NAME', 'LAY_CLASS', 'LABEL') || 'Obstacle limitation surface', detail: pick(a, 'EPI_NAME') }),
  }),
  nsw('mine_subsidence', 'Mine subsidence district', 'mine_subsidence', 'ePlanning/Planning_Portal_Subsidence_Advisory/MapServer/248', {
    layerName: 'Mine Subsidence District (Subsidence Advisory NSW)', statewide: 30, outFields: 'DISTRICTNAME,LASTUPDATE,MODIFIEDDATE', dateFields: ['LASTUPDATE', 'MODIFIEDDATE'],
    notes: 'Subsidence Advisory NSW districts.', map: (a) => ({ label: pick(a, 'DISTRICTNAME') ? `${pick(a, 'DISTRICTNAME')} mine subsidence district` : 'Mine subsidence district' }),
  }),
  nsw('sepp_area', 'SEPP mapped area', 'sepp', 'Planning/SEPP_Resilience_and_Hazards_2021/MapServer/1', {
    layerName: 'Land Application Map (SEPP Resilience and Hazards)', statewide: 14889, outFields: 'EPI_NAME,LAY_CLASS,CURRENCY_DATE',
    notes: 'Only the Resilience and Hazards SEPP land application map. Other SEPP services are not combined.', map: (a) => ({ label: pick(a, 'LAY_CLASS', 'EPI_NAME') || 'SEPP mapped area', detail: pick(a, 'EPI_NAME') }),
  }),
  nsw('urban_release', 'Urban release area', 'urban_release', 'Planning/Development_Control/MapServer/7', {
    layerName: 'Urban Release Area (LEP)', statewide: 570, outFields: 'LABEL,LAY_CLASS,EPI_NAME,CURRENCY_DATE', notes: 'LEP urban release area.',
    map: (a) => ({ label: pick(a, 'LABEL', 'LAY_CLASS') || 'Urban release area', detail: pick(a, 'EPI_NAME') }),
  }),
  nsw('landslide', 'Landslide risk land', 'landslide', 'Planning/Hazard/MapServer/2', {
    layerName: 'Landslide Risk Land (LEP)', statewide: null, outFields: 'LAY_CLASS,EPI_NAME,CURRENCY_DATE', verified: 'jcesite-alternate', notes: 'Listed by JCESite as a verified alternate (Hazard layer 2).',
    map: (a) => ({ label: pick(a, 'LAY_CLASS') || 'Landslide risk land', detail: pick(a, 'EPI_NAME') }),
  }),
  // Planning control maps: values for the card from a point query at the lot centre, never drawn.
  nsw('lot_size', 'Minimum lot size', 'controls_map', 'Planning/EPI_Primary_Planning_Layers/MapServer/4', {
    kind: 'value', layerName: 'Lot Size (LEP)', statewide: 42648, outFields: 'LOT_SIZE,UNITS,LAY_CLASS,EPI_NAME,CURRENCY_DATE', notes: 'LEP minimum lot size map. Check the LEP clause and any exceptions.',
    map: (a) => ({ label: pick(a, 'LOT_SIZE') ? `${pick(a, 'LOT_SIZE')} ${pick(a, 'UNITS')}`.trim() : 'Mapped, size not stated', detail: pick(a, 'EPI_NAME') }),
  }),
  nsw('height', 'Height of buildings', 'controls_map', 'Planning/EPI_Primary_Planning_Layers/MapServer/5', {
    kind: 'value', layerName: 'Height of Building (LEP)', statewide: 41532, outFields: 'MAX_B_H,MAX_B_H_M,UNITS,LAY_CLASS,EPI_NAME,CURRENCY_DATE', notes: 'LEP height of buildings map.',
    map: (a) => ({ label: pick(a, 'MAX_B_H_M') ? `${pick(a, 'MAX_B_H_M')} m` : pick(a, 'MAX_B_H') ? `${pick(a, 'MAX_B_H')} ${pick(a, 'UNITS')}`.trim() : 'Mapped, height not stated', detail: pick(a, 'EPI_NAME') }),
  }),
  nsw('fsr', 'Floor space ratio', 'controls_map', 'Planning/EPI_Primary_Planning_Layers/MapServer/1', {
    kind: 'value', layerName: 'Floor Space Ratio (LEP)', statewide: 40432, outFields: 'FSR,LAY_CLASS,EPI_NAME,CURRENCY_DATE', notes: 'LEP floor space ratio map.',
    map: (a) => ({ label: pick(a, 'FSR') ? `${pick(a, 'FSR')}:1` : 'Mapped, ratio not stated', detail: pick(a, 'EPI_NAME') }),
  }),
  {
    id: 'easement', state: 'NSW', label: 'Easements', category: 'easement', kind: 'area', source: 'NSW cadastre', attribution: '', urls: [], outFields: '', verified: 'none', checked: '18/11/2026',
    note: 'NSW easements are not published as an open map layer. Check the registered plan and title, and the water, electricity and gas authorities for services across the lot.',
    classify: () => ({ label: 'Easement', detail: '', dateMs: null }),
  },
  // Not found by JCESite (12/10/2026) on the reachable hosts: contaminated land, transport corridors. Reported, not guessed.
  { id: 'contamination', state: 'NSW', label: 'Contaminated land', category: 'contamination', kind: 'area', source: 'NSW EPA contaminated land record', attribution: '', urls: [], outFields: '', verified: 'none', checked: '12/10/2026',
    note: 'No public map layer found (the EPA record is not an ArcGIS layer). Check the s10.7 certificate and the EPA contaminated land record.', classify: () => ({ label: '', detail: '', dateMs: null }) },
  { id: 'transport_corridor', state: 'NSW', label: 'Transport corridors', category: 'transport', kind: 'area', source: 'NSW transport corridors', attribution: '', urls: [], outFields: '', verified: 'none', checked: '12/10/2026',
    note: 'No statewide road or rail corridor layer found (only Sydney interim rail corridor maps). Check with Transport for NSW and council.', classify: () => ({ label: '', detail: '', dateMs: null }) },
  // Queensland: only easements has a verified open endpoint. See the header note.
  {
    id: 'easement', state: 'QLD', label: 'Easements', category: 'easement', kind: 'area', source: 'Queensland cadastre, Easement Parcels Only',
    attribution: 'State of Queensland (Department of Resources), cadastral parcels, CC BY 4.0',
    urls: ['https://spatial-gis.information.qld.gov.au/arcgis/rest/services/PlanningCadastre/LandParcelPropertyFramework/MapServer/9'],
    outFields: 'lotplan,lot,plan,feat_name,lot_area,parcel_typ', verified: 'schema', checked: '18/11/2026', notes: 'Cadastral easement parcels.',
    classify: (a) => ({ label: clean(a.feat_name) || 'Easement', detail: clean([a.lotplan, Number.isFinite(Number(a.lot_area)) && Number(a.lot_area) > 0 ? `${Math.round(Number(a.lot_area))} m2` : ''].filter(Boolean).join(', ')), dateMs: null }),
  },
  ...[
    ['flood', 'Flood planning area', 'flood', 'Queensland flood overlay', 'No open statewide flood overlay service was verified for Queensland. Check the council planning scheme flood overlay map and the Queensland Flood Check portal.'],
    ['bushfire', 'Bushfire prone land', 'bushfire', 'Queensland bushfire prone area (State Planning Policy mapping)', 'No open statewide bushfire prone area service was verified for Queensland. Check the State Planning Policy interactive mapping and the council bushfire hazard overlay.'],
    ['heritage_item', 'Heritage', 'heritage', 'Queensland Heritage Register', 'No open Queensland Heritage Register map service was verified. Check the Queensland Heritage Register and the council local heritage overlay.'],
    ['acid_sulfate', 'Acid sulfate soils', 'acid_sulfate', 'Queensland acid sulfate soils', 'No verified open service. Check the council acid sulfate soils overlay map and the State Planning Policy mapping.'],
    ['biodiversity', 'Biodiversity', 'biodiversity', 'Queensland MSES and local biodiversity overlay', 'No verified open service. Check the council biodiversity overlay and the State Planning Policy mapping.'],
    ['landslide', 'Landslide hazard', 'landslide', 'Queensland landslide hazard', 'No verified open service. Check the council landslide hazard overlay map.'],
  ].map(([id, label, category, source, note]) => ({ id, state: 'QLD', label, category, kind: 'area', source, attribution: '', urls: [], outFields: '', verified: 'none', checked: '18/11/2026', note, classify: () => ({ label: '', detail: '', dateMs: null }) })),
];

export const overlaySourcesFor = (state) => OVERLAY_SOURCES.filter((s) => s.state === state);
