/**
 * Client for the stage 6 engines: POST /projects/{id}/site-design/driveway-profile and /grading. The server computes from the project's own scene
 * bundle terrain (existing ground), the requirement resolver and the object sent; it saves nothing. A failure is reported with the server's message,
 * never replaced by a made up result.
 */
import type { Endpoint } from './persist';
import type { DrivewayProfile, GradingResult } from './driveway';
import type { SiteDesign, SiteObject } from './types';
import type { CheckResult } from './serverChecks';

export class EngineHttpError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); this.name = 'EngineHttpError'; }
}
const base = (e: Endpoint) => `${e.base}/projects/${encodeURIComponent(e.projectId)}/site-design`;

async function post<T>(e: Endpoint, path: string, body: unknown, signal?: AbortSignal): Promise<T> {
  const f = e.fetchImpl ?? fetch;
  let r: Response;
  try { r = await f(`${base(e)}/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...e.headers }, credentials: 'include', body: JSON.stringify(body), signal }); }
  catch (err) { if ((err as { name?: string })?.name === 'AbortError') throw err; throw new EngineHttpError(0, 'NETWORK', `the engine request failed: ${String(err)}`); }
  if (!r.ok) {
    let code = 'ERROR', msg = `the engine returned ${r.status}`;
    try { const b = await r.json(); if (b && typeof b.message === 'string') msg = b.message.slice(0, 400); if (b && typeof b.code === 'string') code = b.code; } catch { /* not JSON */ }
    throw new EngineHttpError(r.status, code, msg);
  }
  return (await r.json()) as T;
}
/** `detail` 'profile' stops after the long section and checks (fast); 'full' adds batters and cut and fill. `building` is the linked building as the browser has it:
 *  the server resolves `end_building_id` from the SAVED design and uses `building` only when the saved design holds that building. */
export const postDrivewayProfile = (e: Endpoint, driveway: SiteObject, detail: 'profile' | 'full' = 'full', signal?: AbortSignal, building: SiteObject | null = null) =>
  post<DrivewayProfile>(e, 'driveway-profile', { driveway, detail, ...(building ? { building } : {}) }, signal);
export const postGrading = (e: Endpoint, grading_area: SiteObject, signal?: AbortSignal) => post<GradingResult>(e, 'grading', { grading_area }, signal);

// ---- stage 7
/** The rule based checks of the whole design (the document in the body is NOT saved). */
export const postSiteCheck = (e: Endpoint, doc: SiteDesign, signal?: AbortSignal) => post<CheckResult>(e, 'check', doc, signal);

export interface RwtSizeRequest {
  rwt: SiteObject; building?: SiteObject | null;
  /** twelve monthly rainfall totals (mm) and the station they came from: entered by the user, there is no rainfall data source yet */
  rainfall_monthly_mm?: number[] | null; rainfall_station?: string | null; candidate_sizes_l?: number[] | null; garden_monthly_factor?: number[] | null;
}
export interface RwtSizeMissing { input: string; why: string }
export interface RwtSizeResult {
  status: 'SIZED' | 'UNRESOLVED'; label: string;
  /** UNRESOLVED: every input that is missing, with its key where it is a requirement */
  missing?: RwtSizeMissing[]; message?: string;
  target_reliability_pct?: number | null; target_met?: boolean | null;
  chosen?: { volume_l: number; reliability_pct: number; annual_yield_l: number; annual_demand_l: number; annual_inflow_l: number; annual_overflow_l: number };
  candidates?: { volume_l: number; reliability_pct: number }[]; diameter_m?: number | null; citations?: string[]; messages?: string[];
  inputs?: { roof_area_m2: number; rainfall_station: string; rainfall_basis: string; rainfall_monthly_mm: number[] };
  optional_unresolved?: RwtSizeMissing[]; placeholders: unknown[];
}
/** Run the optional mass balance sizing of a rainwater tank. It runs only when every input resolves; otherwise the answer lists what is UNRESOLVED. */
export const postRwtSize = (e: Endpoint, body: RwtSizeRequest, signal?: AbortSignal) => post<RwtSizeResult>(e, 'rwt-size', body, signal);
