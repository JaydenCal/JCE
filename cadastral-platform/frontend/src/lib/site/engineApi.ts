/**
 * Client for the stage 6 engines: POST /projects/{id}/site-design/driveway-profile and /grading. The server computes from the project's own scene
 * bundle terrain (existing ground), the requirement resolver and the object sent; it saves nothing. A failure is reported with the server's message,
 * never replaced by a made up result.
 */
import type { Endpoint } from './persist';
import type { DrivewayProfile, GradingResult } from './driveway';
import type { SiteDesign, SiteObject } from './types';
import type { CheckEntry, CheckResult } from './serverChecks';

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

// ---- stage 8: sewer and water route proposals
export interface ConnectionInput {
  /** the id of a service_existing in the design (its depth must be known for an invert to be derived) */
  main_id?: string;
  /** a point entered by the user (MGA E, N). It is labelled NOT VERIFIED in the answer. */
  p?: [number, number];
  /** the invert level at the connection, when known (entered by the user) */
  invert_rl?: number;
}
export interface SewerRouteRequest {
  design: SiteDesign; building_id: string; exit_index?: number; start_invert_rl: number; diameter_mm: number;
  /** percent. Left out, the server uses the minimum grade of the requirement key for that diameter, or reports it UNRESOLVED. */
  grade_pct?: number | null; connection: ConnectionInput;
}
export interface WaterRouteRequest {
  design: SiteDesign; building_id: string; exit_index?: number; meter_p: [number, number]; diameter_mm: number; cover_m: number; rwt_id?: string | null; connection: ConnectionInput;
}
export interface RouteProposal {
  schema: 'sewer_proposal.v1' | 'water_proposal.v1'; label: string;
  /** ready to apply with the add_service_objects operation */
  objects: SiteObject[];
  route: { pts: [number, number][]; length_m: number };
  grade_pct?: number | null; grade_basis?: string | null; inspection_chainages_m?: number[];
  connection: { p: [number, number]; label: string; main_id: string | null; invert_rl?: number | null; arrival_invert_rl?: number | null; status?: string; message?: string };
  profile?: { chainage_m: number; x: number; y: number; ground_rl: number | null; invert_rl: number; crown_rl: number; cover_m: number | null; location: string }[];
  checks: CheckEntry[]; summary: Record<string, number> | string; notes: string[];
}
export const postSewerRoute = (e: Endpoint, body: SewerRouteRequest, signal?: AbortSignal) => post<RouteProposal>(e, 'sewer-route', body, signal);
export const postWaterRoute = (e: Endpoint, body: WaterRouteRequest, signal?: AbortSignal) => post<RouteProposal>(e, 'water-route', body, signal);
