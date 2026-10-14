/**
 * Stage 8: client of the project's DBYD routes (see backend app/api/dbyd.py). Plans and enquiries are PRIVATE to the project. A failure is reported with the
 * server's message. Nothing here carries the BYDA credentials: they exist only on the server.
 *
 * The BYDA endpoints behind the enquiry are UNCONFIRMED (the documentation could not be read); the server says so in its answers.
 */
import type { Endpoint } from './persist';
import { EngineHttpError } from './engineApi';
import type { SiteObject } from './types';

const root = (e: Endpoint) => `${e.base}/projects/${encodeURIComponent(e.projectId)}/dbyd`;
async function call<T>(e: Endpoint, path: string, init: RequestInit & { json?: unknown } = {}, kind: 'json' | 'blob' = 'json'): Promise<T> {
  const f = e.fetchImpl ?? fetch;
  const { json, ...rest } = init;
  const headers: Record<string, string> = { ...e.headers, ...(json !== undefined ? { 'Content-Type': 'application/json' } : {}) };
  let r: Response;
  try { r = await f(`${root(e)}${path}`, { ...rest, headers, credentials: 'include', ...(json !== undefined ? { body: JSON.stringify(json) } : {}) }); }
  catch (err) { throw new EngineHttpError(0, 'NETWORK', `the request failed: ${String(err)}`); }
  if (!r.ok) {
    let code = 'ERROR', msg = `the server returned ${r.status}`;
    try { const b = await r.json(); if (b && typeof b.message === 'string') msg = b.message.slice(0, 400); if (b && typeof b.code === 'string') code = b.code; } catch { /* not JSON */ }
    throw new EngineHttpError(r.status, code, msg);
  }
  return (kind === 'blob' ? await r.blob() : await r.json()) as T;
}

export interface PlanRecord { plan_id: string; name: string; kind: 'pdf' | 'image' | 'dwf' | 'dxf' | string; size_bytes?: number; uploaded_at?: string; job_number?: string | null; asset_owner?: string | null; plan_date?: string | null; plan_reference?: string | null }
export interface EnquiryRecord { enquiry_id?: string; id?: string; client_ref?: string; lodge_state?: 'pending' | 'unknown' | 'lodged' | 'failed' | string; status?: string; lodged_at?: string; margin_m?: number; mode?: string; job_number?: string | null; [k: string]: unknown }
export interface ParseInput {
  page?: number; scale_denominator?: number | null; control_points?: [[number, number], [number, number]][] | null; boundary_rgb?: string | null; tolerance_m?: number | null;
  job_number?: string | null; asset_owner?: string | null; plan_reference?: string | null; plan_date?: string | null; plan_expiry_date?: string | null;
}
export interface ParseResult { objects: SiteObject[]; code?: string; message?: string; label?: string; georeference?: { outcome: string; rmse_m: number | null; max_residual_m: number | null; control_points: number; messages: string[] }; tolerance_note?: string | null }

export const listPlans = (e: Endpoint) => call<{ plans: PlanRecord[] }>(e, '/plans');
export function uploadPlan(e: Endpoint, file: File, meta: { job_number?: string; asset_owner?: string; plan_date?: string; plan_reference?: string } = {}) {
  const fd = new FormData(); fd.append('file', file, file.name);
  for (const [k, v] of Object.entries(meta)) if (v) fd.append(k, v);
  return call<PlanRecord>(e, '/plans', { method: 'POST', body: fd });
}
/** One page of an uploaded PDF plan as a PNG blob (the underlay of the Trace service tool). */
export const planPage = (e: Endpoint, planId: string, page = 1, widthPx = 1600) => call<Blob>(e, `/plans/${encodeURIComponent(planId)}/page?page=${page}&width_px=${widthPx}`, {}, 'blob');
export const parsePlan = (e: Endpoint, planId: string, body: ParseInput) => call<ParseResult>(e, `/plans/${encodeURIComponent(planId)}/parse`, { method: 'POST', json: body });
export interface EnquiryList { enquiries: EnquiryRecord[]; mode: string; live_calls: boolean; unresolved_lodgement: string | null; refresh_error: string | null; files_note: string }
export const listEnquiries = (e: Endpoint, refresh = false) => call<EnquiryList>(e, `/enquiries${refresh ? '?refresh=true' : ''}`);
/** Record what the BYDA portal shows for a lodgement whose outcome is unknown. Nothing is sent to BYDA. */
export const resolveEnquiry = (e: Endpoint, clientRef: string, body: { outcome: 'lodged' | 'not_lodged'; job_number?: string | null; enquiry_id?: string | null }) =>
  call<EnquiryRecord>(e, `/enquiries/${encodeURIComponent(clientRef)}/resolve`, { method: 'POST', json: body });
/** Lodge a REAL enquiry with BYDA. `confirm` must be true: the caller shows the user a confirmation first. */
export const lodgeEnquiry = (e: Endpoint, body: { confirm: boolean; margin_m: number; work_description?: string | null; start_date?: string | null; end_date?: string | null }) => call<EnquiryRecord>(e, '/enquiry', { method: 'POST', json: body });
