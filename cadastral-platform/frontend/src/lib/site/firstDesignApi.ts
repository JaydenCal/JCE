/**
 * Client for AI first design (stage 10): POST /projects/{id}/ai/first-design. The server builds the candidates, the model (or the rules) chooses among them and the answer is ONE
 * batch of registry operations plus the proposals. This file sends the design and returns what the server answers; a failure is reported with the server's message and code (the
 * session needs them: AI_PAUSED, CONFIRM_REQUIRED and RATE_LIMITED are not the same remedy).
 */
import type { Endpoint } from './persist';
import type { SiteDesign } from './types';
import type { FdEstimateAnswer, FdResult } from './firstDesign';

export class FirstDesignHttpError extends Error {
  constructor(public status: number, public code: string, message: string, public extra: Record<string, unknown> = {}) { super(message); this.name = 'FirstDesignHttpError'; }
}
const url = (e: Endpoint) => `${e.base}/projects/${encodeURIComponent(e.projectId)}/ai/first-design`;

async function post<T>(e: Endpoint, body: unknown, signal?: AbortSignal): Promise<T> {
  const f = e.fetchImpl ?? fetch;
  let r: Response;
  try { r = await f(url(e), { method: 'POST', headers: { 'Content-Type': 'application/json', ...e.headers }, credentials: 'include', body: JSON.stringify(body), signal }); }
  catch (err) { if ((err as { name?: string })?.name === 'AbortError') throw err; throw new FirstDesignHttpError(0, 'NETWORK', `the request failed: ${String(err)}`); }
  if (!r.ok) {
    let code = 'ERROR', msg = `the server returned ${r.status}`, extra: Record<string, unknown> = {};
    try {
      const b = await r.json();
      if (b && typeof b.message === 'string') msg = b.message.slice(0, 400);
      else if (b && Array.isArray(b.detail)) msg = b.detail.map((d: { loc?: unknown[]; msg?: string }) => `${(d.loc ?? []).slice(1).join('.')}: ${d.msg ?? ''}`).join('; ').slice(0, 400);
      if (b && typeof b.code === 'string') code = b.code;
      if (b && typeof b === 'object') extra = b as Record<string, unknown>;
    } catch { /* not JSON */ }
    throw new FirstDesignHttpError(r.status, code, msg, extra);
  }
  return (await r.json()) as T;
}
/** The estimate only: no model call, nothing spent. */
export const postFirstDesignEstimate = (e: Endpoint, design: SiteDesign, useAi: boolean, signal?: AbortSignal) => post<FdEstimateAnswer>(e, { design, estimate: true, use_ai: useAi }, signal);
export const postFirstDesign = (e: Endpoint, design: SiteDesign, opts: { useAi: boolean; confirm: boolean }, signal?: AbortSignal) =>
  post<FdResult>(e, { design, estimate: false, use_ai: opts.useAi, confirm_large: opts.confirm }, signal);
