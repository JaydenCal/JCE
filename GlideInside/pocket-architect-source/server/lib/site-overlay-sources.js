// Config table for GET /api/site/overlays: which open government ArcGIS layer answers each constraint overlay, per state.
// To change an endpoint, change the table only (the route, clipping and the summary card read it). Full notes: docs/SITE_OVERLAYS.md.
//
// `verified` records what was actually seen. Service descriptions and test queries were read with WebFetch on 18/11/2026 (the build
// container cannot reach the government hosts directly):
//   'live'    the layer description (fields, geometry type) was read AND a real point query returned the expected JSON shape
//   'schema'  the layer description was read (fields, geometry type); no feature query was completed from the sandbox
//   'none'    no open service endpoint could be verified: the adapter reports the layer as unavailable and never guesses a URL
//
// A source may list more than one URL: they are tried in order and the first that answers is used (the NSW Planning Portal publishes
// the same hazard layers in two services).

const NSW_PP = 'NSW Department of Planning, Housing and Infrastructure (Planning Portal spatial services)';
const dateMs = (v) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : null);
const clean = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();

export const OVERLAY_SOURCES = [
  {
    id: 'flood', state: 'NSW', label: 'Flood planning area',
    source: `${NSW_PP}, Flood Planning Map (EPI)`,
    attribution: `${NSW_PP}, Flood Planning layer. Licence to be confirmed.`,
    urls: [
      'https://mapprod3.environment.nsw.gov.au/arcgis/rest/services/Planning/Hazard/MapServer/1',
      'https://mapprod3.environment.nsw.gov.au/arcgis/rest/services/ePlanning/Planning_Portal_Hazard/MapServer/230',
    ],
    outFields: 'EPI_NAME,LGA_NAME,LAY_CLASS,CURRENCY_DATE',
    verified: 'live', checked: '18/11/2026',
    // Fields (read from the layer): EPI_NAME, LGA_NAME, LAY_CLASS, EPI_TYPE, COMMENCED_DATE, CURRENCY_DATE. Polygon, SR 4283, maxRecordCount 1000.
    classify: (a) => ({ label: clean(a.LAY_CLASS) || 'Flood planning area', detail: clean([a.EPI_NAME, a.LGA_NAME].filter(Boolean).join(', ')), dateMs: dateMs(a.CURRENCY_DATE) }),
  },
  {
    id: 'bushfire', state: 'NSW', label: 'Bushfire prone land',
    source: 'NSW Rural Fire Service, Bush Fire Prone Land map (via NSW Planning Portal spatial services)',
    attribution: 'NSW Rural Fire Service, Bush Fire Prone Land. Licence to be confirmed.',
    urls: [
      'https://mapprod3.environment.nsw.gov.au/arcgis/rest/services/Fire/BFPL/MapServer/0',
      'https://mapprod3.environment.nsw.gov.au/arcgis/rest/services/ePlanning/Planning_Portal_Hazard/MapServer/229',
    ],
    outFields: 'Category,d_Category,Guideline,LastUpdate,VerDate',
    verified: 'schema', checked: '18/11/2026',
    // Fields: Category (code), d_Category (description), Guideline, d_Guidelin, LastUpdate, VerDate. Polygon, SR 4283, maxRecordCount 1000.
    // Category codes are the RFS vegetation categories: 1, 2, 3 and Vegetation Buffer. A point query on /Fire/BFPL answered with a server error from
    // the sandbox, so it is SUSPECTED that the layer works for envelope queries; the second URL is the same data in the Planning Portal service.
    classify: (a) => {
      const cat = clean(a.d_Category) || clean(a.Category);
      const label = /buffer/i.test(cat) ? 'Vegetation buffer' : /^\d$/.test(cat) ? `Vegetation Category ${cat}` : cat || 'Bush fire prone land';
      return { label, detail: '', dateMs: dateMs(a.LastUpdate) || dateMs(a.VerDate) };
    },
  },
  {
    id: 'heritage', state: 'NSW', label: 'Heritage',
    source: `${NSW_PP}, Heritage (EPI)`,
    attribution: `${NSW_PP}, Heritage layer of the local environmental plan. Licence to be confirmed.`,
    urls: ['https://mapprod3.environment.nsw.gov.au/arcgis/rest/services/Planning/EPI_Primary_Planning_Layers/MapServer/0'],
    outFields: 'H_ID,H_NAME,SIG,LAY_CLASS,EPI_NAME,LGA_NAME,CURRENCY_DATE',
    verified: 'live', checked: '18/11/2026',
    // Live point query at the Sydney Opera House returned { H_ID: "I1712", H_NAME: "Sydney Opera House", SIG: "State" }.
    // SUSPECTED: conservation areas carry LAY_CLASS text containing "Conservation" (the exact values were not listed); items carry H_NAME.
    classify: (a) => {
      const cls = clean(a.LAY_CLASS);
      const area = /conservation/i.test(cls) && !clean(a.H_ID);
      const name = clean(a.H_NAME);
      const sig = clean(a.SIG);
      return {
        label: area ? `Heritage conservation area${name ? `: ${name}` : ''}` : `Heritage item${name ? `: ${name}` : ''}`,
        detail: clean([sig ? `${sig} significance` : '', a.EPI_NAME, a.LGA_NAME].filter(Boolean).join(', ')),
        dateMs: dateMs(a.CURRENCY_DATE),
      };
    },
  },
  {
    id: 'easement', state: 'NSW', label: 'Easements',
    source: 'NSW cadastre', attribution: '', urls: [], outFields: '', verified: 'none', checked: '18/11/2026',
    note: 'NSW easements are not published as an open map layer. Check the registered plan and title, and the water, electricity and gas authorities for services across the lot.',
    classify: () => ({ label: 'Easement', detail: '', dateMs: null }),
  },
  // Queensland. Only easements have a verified open endpoint (same service as the cadastre). The state hazard layers (flood, bushfire prone area,
  // heritage register) were NOT found on the Queensland Spatial services directory (spatial-gis.information.qld.gov.au) on 18/11/2026: the
  // SPP interactive mapping host refuses automated access (robots) and the Queensland Heritage Register has no public REST layer there. Those
  // overlays are per council planning scheme in Queensland, so they are reported as unavailable rather than guessed.
  {
    id: 'easement', state: 'QLD', label: 'Easements',
    source: 'Queensland cadastre, Easement Parcels Only',
    attribution: 'State of Queensland (Department of Resources), cadastral parcels, CC BY 4.0',
    urls: ['https://spatial-gis.information.qld.gov.au/arcgis/rest/services/PlanningCadastre/LandParcelPropertyFramework/MapServer/9'],
    outFields: 'lotplan,lot,plan,feat_name,lot_area,parcel_typ',
    verified: 'schema', checked: '18/11/2026',
    // Fields: lot, plan, lotplan, tenure, lot_area, feat_name, alias_name, parcel_typ, locality, shire_name. Polygon, maxRecordCount 4000.
    classify: (a) => ({ label: clean(a.feat_name) || 'Easement', detail: clean([a.lotplan, Number.isFinite(Number(a.lot_area)) && Number(a.lot_area) > 0 ? `${Math.round(Number(a.lot_area))} m2` : ''].filter(Boolean).join(', ')), dateMs: null }),
  },
  { id: 'flood', state: 'QLD', label: 'Flood planning area', source: 'Queensland flood hazard (council planning scheme overlay)', attribution: '', urls: [], outFields: '', verified: 'none', checked: '18/11/2026', note: 'No open statewide flood overlay service was verified for Queensland. Check the council planning scheme flood overlay map and the Queensland Flood Check portal.', classify: () => ({ label: '', detail: '', dateMs: null }) },
  { id: 'bushfire', state: 'QLD', label: 'Bushfire prone land', source: 'Queensland bushfire prone area (State Planning Policy mapping)', attribution: '', urls: [], outFields: '', verified: 'none', checked: '18/11/2026', note: 'No open statewide bushfire prone area service was verified for Queensland. Check the State Planning Policy interactive mapping and the council bushfire hazard overlay.', classify: () => ({ label: '', detail: '', dateMs: null }) },
  { id: 'heritage', state: 'QLD', label: 'Heritage', source: 'Queensland Heritage Register', attribution: '', urls: [], outFields: '', verified: 'none', checked: '18/11/2026', note: 'No open Queensland Heritage Register map service was verified. Check the Queensland Heritage Register and the council local heritage overlay.', classify: () => ({ label: '', detail: '', dateMs: null }) },
];

export const overlaySourcesFor = (state) => OVERLAY_SOURCES.filter((s) => s.state === state);
