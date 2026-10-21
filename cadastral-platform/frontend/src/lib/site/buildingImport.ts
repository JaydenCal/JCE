/** Client for POST /projects/{id}/site-design/import-building (multipart). The server parses; nothing is saved until the building is placed. */
import { parseImportPayload, type ImportPayload } from './buildings';
import type { Pos } from './types';

export class ImportError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); this.name = 'ImportError'; }
}
export interface ImportEndpoint { base: string; projectId: string; headers?: Record<string, string>; fetchImpl?: typeof fetch }
/** What the page knows that a PDF import needs: the lot ring (MGA) and the projected CRS. */
export interface LotInfo { ring: [number, number][] | null; srid: number | null }

/** Client side file cap, the same as the server (15 MB): refuse early with a clear message instead of uploading. */
export const MAX_IMPORT_BYTES = 15 * 1024 * 1024;
export const ACCEPT = '.json,.planstudio.json,.pdf,.dxf,.glb';

export function lotWkt(ring: readonly (readonly number[])[]): string {
  const pts = [...ring, ring[0]].map((p) => `${p[0]} ${p[1]}`).join(', ');
  return `POLYGON((${pts}))`;
}

async function send(ep: ImportEndpoint, form: FormData): Promise<ImportPayload> {
  const f = ep.fetchImpl ?? fetch;
  let r: Response;
  try { r = await f(`${ep.base}/projects/${encodeURIComponent(ep.projectId)}/site-design/import-building`, { method: 'POST', headers: ep.headers, body: form, credentials: 'include' }); }
  catch (e) { throw new ImportError(0, 'NETWORK', `THE IMPORT REQUEST FAILED: ${e instanceof Error ? e.message : String(e)}`); }
  let body: unknown = null;
  try { body = await r.json(); } catch { /* not JSON */ }
  if (!r.ok) {
    const b = (body ?? {}) as { code?: string; message?: string; detail?: unknown };
    const detail = typeof b.detail === 'string' ? b.detail : '';
    throw new ImportError(r.status, b.code ?? `HTTP_${r.status}`, b.message ?? (detail || `The import was refused (HTTP ${r.status}).`));
  }
  try { return parseImportPayload(body); } catch (e) { throw new ImportError(r.status, 'BAD_RESPONSE', e instanceof Error ? e.message : String(e)); }
}

/** A .planstudio.json, .pdf or .dxf file. A PDF also needs the lot (it is aligned to it). */
export function importFile(ep: ImportEndpoint, file: File, use: string | null, lot: LotInfo | null = null, scaleDenominator?: number): Promise<ImportPayload> {
  if (file.size > MAX_IMPORT_BYTES) return Promise.reject(new ImportError(413, 'FILE_TOO_LARGE', `THE FILE IS LARGER THAN ${MAX_IMPORT_BYTES / (1024 * 1024)} MB`));
  const form = new FormData();
  form.append('file', file, file.name);
  if (use) form.append('building_use', use);
  if (/\.pdf$/i.test(file.name)) {
    if (!lot || !lot.ring || lot.ring.length < 3 || lot.srid === null) return Promise.reject(new ImportError(422, 'LOT_REQUIRED', 'A PDF is aligned to the lot boundary: LOT BOUNDARY NOT AVAILABLE for this project.'));
    form.append('lot_wkt', lotWkt(lot.ring)); form.append('srid', String(lot.srid));
    if (scaleDenominator) form.append('scale_denominator', String(scaleDenominator));
  }
  return send(ep, form);
}
export function importFootprintSize(ep: ImportEndpoint, widthM: number, depthM: number, use: string | null): Promise<ImportPayload> {
  const form = new FormData(); form.append('source', 'footprint_entry'); form.append('width_m', String(widthM)); form.append('depth_m', String(depthM)); if (use) form.append('building_use', use);
  return send(ep, form);
}
export function importFootprintRing(ep: ImportEndpoint, ring: readonly Pos[], use: string | null): Promise<ImportPayload> {
  const form = new FormData(); form.append('source', 'footprint_entry'); form.append('ring', JSON.stringify(ring.map((p) => [p[0], p[1]]))); if (use) form.append('building_use', use);
  return send(ep, form);
}
