// SAMPLE constraint overlays in the /api/site/overlays wire shape (metres relative to the request origin). Invented, only for CONFIG.siteMock
// builds, tests and review screenshots: they say nothing about any real property.
import { clipPolygonsToBox } from '../overlays.js';

const rect = (x0, y0, x1, y1) => [[x0, y0], [x0, y1], [x1, y1], [x1, y0]];

export function mockOverlays(request) {
  const [minE, minN, maxE, maxN] = String(request.bbox).split(',').map(Number);
  const [oe, on] = String(request.origin).split(',').map(Number);
  const box = { minX: minE - oe, minY: minN - on, maxX: maxE - oe, maxY: maxN - on };
  const clip = (polys) => clipPolygonsToBox(polys, box);
  const retrieved = new Date().toISOString();
  const sample = ' (SAMPLE DATA)';
  const nsw = request.state !== 'QLD';
  const layers = nsw ? [
    { id: 'flood', label: 'Flood planning area', source: 'NSW Planning Portal, Flood Planning Map (EPI)' + sample, attribution: '', date: '01/10/2026', status: 'ok', note: '', features: [{ label: 'Flood planning area', detail: 'Sample LEP', polygons: clip([{ outer: rect(-200, -46, 200, -12), holes: [] }]) }] },
    { id: 'bushfire', label: 'Bushfire prone land', source: 'NSW RFS, Bush Fire Prone Land' + sample, attribution: '', date: '15/09/2026', status: 'ok', note: '', features: [{ label: 'Vegetation Category 1', detail: '', polygons: clip([{ outer: rect(6, 14, 200, 200), holes: [rect(60, 60, 90, 90)] }]) }, { label: 'Vegetation buffer', detail: '', polygons: clip([{ outer: rect(-30, 40, 6, 200), holes: [] }]) }] },
    { id: 'heritage', label: 'Heritage', source: 'NSW Planning Portal, Heritage (EPI)' + sample, attribution: '', date: '01/10/2026', status: 'ok', note: '', features: [{ label: 'Heritage conservation area: Sample Street', detail: 'Sample LEP', polygons: clip([{ outer: rect(-120, -30, -34, 30), holes: [] }]) }] },
    { id: 'easement', label: 'Easements', source: 'NSW cadastre', attribution: '', date: null, status: 'unavailable', note: 'NSW easements are not published as an open map layer. Check the registered plan and title.', features: [] },
  ] : [
    { id: 'flood', label: 'Flood planning area', source: 'Queensland flood overlay', attribution: '', date: null, status: 'unavailable', note: 'No open statewide flood overlay service was verified for Queensland. Check the council planning scheme flood overlay map.', features: [] },
    { id: 'bushfire', label: 'Bushfire prone land', source: 'Queensland bushfire prone area', attribution: '', date: null, status: 'unavailable', note: 'No open statewide bushfire prone area service was verified for Queensland.', features: [] },
    { id: 'heritage', label: 'Heritage', source: 'Queensland Heritage Register', attribution: '', date: null, status: 'unavailable', note: 'No open Queensland Heritage Register map service was verified.', features: [] },
    { id: 'easement', label: 'Easements', source: 'Queensland cadastre, Easement Parcels Only' + sample, attribution: 'State of Queensland (Department of Resources), CC BY 4.0', date: null, status: 'ok', note: '', features: [{ label: 'Easement', detail: 'Sample 2 m wide', polygons: clip([{ outer: rect(-200, 6, 200, 8.5), holes: [] }]) }] },
  ];
  return { state: nsw ? 'NSW' : 'QLD', srid: request.srid, origin: { e: oe, n: on }, retrieved, layers, warnings: [] };
}
