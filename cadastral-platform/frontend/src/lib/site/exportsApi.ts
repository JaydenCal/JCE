/** Client for GET /projects/{id}/exports/{kind} and PUT /projects/{id}/exports/building-glb/{object id} (stage 11). The server builds every export from the SAVED design and bundle. */
import type { Endpoint } from './persist';

export type ExportKind = 'glb' | 'dxf' | 'objects.csv' | 'objects.json' | 'checks.csv' | 'checks.json' | 'stormwater.csv' | 'stormwater.json';
export interface ExportDef { kind: ExportKind; label: string; note: string }
export const EXPORT_DEFS: readonly ExportDef[] = [
  { kind: 'glb', label: '3D model (GLB)', note: 'Terrain, optional aerial, every design object and the imported buildings. Object names are the object ids.' },
  { kind: 'dxf', label: 'Plan (DXF)', note: 'The design in plan on the JCS layers, with contours, boundary, services (dashed while UNVERIFIED) and MGA coordinates.' },
  { kind: 'objects.csv', label: 'Objects schedule (CSV)', note: 'Every object with its parameters and the basis of each.' },
  { kind: 'objects.json', label: 'Objects schedule (JSON)', note: 'The same schedule as data.' },
  { kind: 'checks.csv', label: 'Checks list (CSV)', note: 'The rule based checks of the saved design.' },
  { kind: 'checks.json', label: 'Checks list (JSON)', note: 'The same list as data.' },
  { kind: 'stormwater.csv', label: 'Stormwater summary (CSV)', note: 'The summary of the saved stormwater entries.' },
  { kind: 'stormwater.json', label: 'Stormwater summary (JSON)', note: 'The same summary as data.' },
];
/** R2010 (the default) stores text as UTF-8; R2000 and R12 use a code page and write letters outside it as \U+XXXX. */
export type DxfVersion = 'R2010' | 'R2000' | 'R12';
export interface ExportOptions { version?: DxfVersion; aerial?: boolean }
export interface ExportFile { blob: Blob; filename: string; terrainStatus: string; kind: string }

export class ExportError extends Error { constructor(public status: number, public code: string, message: string) { super(message); this.name = 'ExportError'; } }

export function exportUrl(ep: Endpoint, kind: ExportKind, o: ExportOptions = {}): string {
  const q = new URLSearchParams();
  if (kind === 'dxf' && o.version) q.set('version', o.version);
  if (kind === 'glb' && o.aerial) q.set('aerial', 'true');
  const s = q.toString();
  return `${ep.base}/projects/${encodeURIComponent(ep.projectId)}/exports/${kind}${s ? `?${s}` : ''}`;
}
export function filenameFrom(disposition: string | null, fallback: string): string {
  const m = /filename="?([^";]+)"?/i.exec(disposition ?? '');
  return m ? m[1] : fallback;
}
async function failure(r: Response): Promise<ExportError> {
  let b: { code?: string; message?: string; detail?: unknown } = {};
  try { b = await r.json(); } catch { /* not JSON */ }
  return new ExportError(r.status, b.code ?? `HTTP_${r.status}`, b.message ?? (typeof b.detail === 'string' ? b.detail : `THE EXPORT WAS REFUSED (HTTP ${r.status})`));
}
export async function fetchExport(ep: Endpoint, kind: ExportKind, o: ExportOptions = {}): Promise<ExportFile> {
  const f = ep.fetchImpl ?? fetch;
  let r: Response;
  try { r = await f(exportUrl(ep, kind, o), { headers: ep.headers, credentials: 'include' }); } catch (e) { throw new ExportError(0, 'NETWORK', `THE EXPORT REQUEST FAILED: ${e instanceof Error ? e.message : String(e)}`); }
  if (!r.ok) throw await failure(r);
  const ext = kind.includes('.') ? kind.split('.')[1] : kind;
  return { blob: await r.blob(), filename: filenameFrom(r.headers.get('content-disposition'), `site_${kind.replace('.', '_')}.${ext}`), terrainStatus: r.headers.get('x-terrain-status') ?? '', kind };
}
/** Store the Plan Studio GLB of a building so the GLB export can include it. The building must be in the SAVED design. */
export async function uploadBuildingGlb(ep: Endpoint, objectId: string, bytes: ArrayBuffer): Promise<void> {
  const f = ep.fetchImpl ?? fetch;
  let r: Response;
  try { r = await f(`${ep.base}/projects/${encodeURIComponent(ep.projectId)}/exports/building-glb/${encodeURIComponent(objectId)}`, { method: 'PUT', headers: { ...(ep.headers ?? {}), 'Content-Type': 'model/gltf-binary' }, body: bytes, credentials: 'include' }); }
  catch (e) { throw new ExportError(0, 'NETWORK', `THE BUILDING GLB COULD NOT BE SENT: ${e instanceof Error ? e.message : String(e)}`); }
  if (!r.ok) throw await failure(r);
}
/** Hand a file to the browser as a download. */
export function saveFile(file: ExportFile): void {
  const url = URL.createObjectURL(file.blob), a = document.createElement('a');
  a.href = url; a.download = file.filename; a.rel = 'noopener'; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
