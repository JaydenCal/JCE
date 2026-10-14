/**
 * Client for the stage 6 engines: POST /projects/{id}/site-design/driveway-profile and /grading. The server computes from the project's own scene
 * bundle terrain (existing ground), the requirement resolver and the object sent; it saves nothing. A failure is reported with the server's message,
 * never replaced by a made up result.
 */
import type { Endpoint } from './persist';
import type { DrivewayProfile, GradingResult } from './driveway';
import type { SiteObject } from './types';

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
