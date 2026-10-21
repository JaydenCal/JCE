/**
 * Client for the stage 9 stormwater routes (/projects/{id}/stormwater/...). The server computes everything; this file only sends the design and the user's entries and the
 * uploads, and returns what the server answers. A failure is reported with the server's message, never replaced by a made up result.
 */
import type { Endpoint } from './persist';
import type { SiteDesign } from './types';
import { EngineHttpError } from './engineApi';
import type { InputsPayload, StormwaterResult } from './stormwater';

const base = (e: Endpoint) => `${e.base}/projects/${encodeURIComponent(e.projectId)}/stormwater`;

async function call<T>(e: Endpoint, path: string, init: RequestInit & { json?: unknown }, signal?: AbortSignal): Promise<T> {
  const f = e.fetchImpl ?? fetch;
  const headers: Record<string, string> = { ...e.headers };
  let body: BodyInit | undefined = init.body ?? undefined;
  if (init.json !== undefined) { headers['Content-Type'] = 'application/json'; body = JSON.stringify(init.json); }
  let r: Response;
  try { r = await f(`${base(e)}/${path}`, { method: init.method ?? 'GET', headers, credentials: 'include', body, signal }); }
  catch (err) { if ((err as { name?: string })?.name === 'AbortError') throw err; throw new EngineHttpError(0, 'NETWORK', `the stormwater request failed: ${String(err)}`); }
  if (!r.ok) {
    let code = 'ERROR', msg = `the server returned ${r.status}`;
    try {
      const b = await r.json();
      if (b && typeof b.message === 'string') msg = b.message.slice(0, 400);
      else if (b && Array.isArray(b.detail)) msg = b.detail.map((d: { loc?: unknown[]; msg?: string }) => `${(d.loc ?? []).slice(1).join('.')}: ${d.msg ?? ''}`).join('; ').slice(0, 400);
      if (b && typeof b.code === 'string') code = b.code;
    } catch { /* not JSON */ }
    throw new EngineHttpError(r.status, code, msg);
  }
  return (await r.json()) as T;
}

export interface OverlandRequest { enabled: boolean; cell_m?: number; threshold_m2?: number; surface?: 'design' | 'existing' }
export interface AnalyseRequest { design: SiteDesign; inputs?: InputsPayload | null; rainfall_source?: 'upload' | 'live'; overland?: OverlandRequest | null }
export interface StormwaterData {
  ifd: { provenance: Record<string, unknown>; kind: string; durations: number; aeps_pct: number[]; warnings: string[] } | null;
  arr: Record<string, unknown> | null;
  soil: { provenance: Record<string, unknown>; label: string; rows: { soil_unit: string; rate_mm_h: number; description: string }[] } | null;
  inputs: InputsPayload | null;
}
export const postAnalyse = (e: Endpoint, body: AnalyseRequest, signal?: AbortSignal) => call<StormwaterResult>(e, 'analyse', { method: 'POST', json: body }, signal);
export const getStormwaterData = (e: Endpoint, signal?: AbortSignal) => call<StormwaterData>(e, 'data', {}, signal);
export const putInputs = (e: Endpoint, inputs: InputsPayload) => call<InputsPayload>(e, 'inputs', { method: 'PUT', json: inputs });
export type UploadKind = 'ifd' | 'arr' | 'soil';
/** Upload a file. `fields` are the form fields of the upload: declared_units for an IFD table; source and source_date for a soil table. */
export function postUpload(e: Endpoint, kind: UploadKind, file: Blob, name: string, fields: Record<string, string> = {}) {
  const fd = new FormData();
  fd.append('file', file, name);
  for (const [k, v] of Object.entries(fields)) if (v !== '') fd.append(k, v);
  return call<Record<string, unknown>>(e, kind, { method: 'POST', body: fd });
}
export const deleteUpload = (e: Endpoint, kind: UploadKind) => call<{ deleted: boolean }>(e, kind, { method: 'DELETE' });
