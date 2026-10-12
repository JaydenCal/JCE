import { ALL_KINDS, missingAcks } from "./acks";
import { mockProjects, mockResults } from "./mock";

export const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:8000";
export const DEV_USER_ID = process.env.NEXT_PUBLIC_DEV_USER_ID ?? "00000000-0000-4000-8000-000000000001";
export const USE_MOCK = process.env.NEXT_PUBLIC_MOCK === "1";

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public extra: Record<string, unknown> = {}) { super(message); }
}
export interface Terms { terms_version_id: string; version_label: string; effective_from: string; body_markdown: string; body_sha256: string; accepted: boolean | null }
export interface Project { project_id: string; title: string; lotplan?: string; jurisdiction?: "NSW" | "QLD"; updated_at?: string }
export interface Invocation { invocation_id: string; agent: string; attempt: number; status: string; error_code?: string | null; error_detail?: string | null }
export interface AlignmentResult {
  scale_denominator_used: number; scale_source: "title_block_text" | "scale_bar_measure" | "dimension_string" | "user_entered";
  scale_confidence: number; rmse_m: number; max_residual_m: number; reflection_applied: boolean;
  outcome: "accepted_unverified" | "needs_user_confirmation" | "refused"; messages: string[];
}
export interface RunDetail { run_id: string; project_id: string; status: string; tokens_used: number; invocations: Invocation[]; plan: unknown[];
  /** Documented extension: orchestrator should surface the SA7 PlanOverlay here. */ alignment?: AlignmentResult | null }
export const TERMINAL = ["succeeded", "failed", "cancelled"];
export interface ProjectResults {
  lot: { lotplan: string; jurisdiction: string; lga: string; zone: string; area_m2: number; frontage_m: number; road: string };
  setbacks: { control: string; value_m: number; citation: string }[];
  driveway: { status: string; width_m: number; max_grade_pct: number; design_vehicle: string; notes: string[] };
  services: { service: string; label: string; conflict: boolean; detail: string }[];
  rwt: { tank_volume_l: number; diameter_m: number; regime: string; note: string };
}
/** Documented (not yet implemented server-side): POST /projects/{id}/export -> ExportResult */
export interface ExportResult { dxf_url: string | null; pdf_url: string | null }

/** Decide what the interceptor should do with a failed response. Pure, unit-tested. */
export function interceptError(status: number, body: any): { redirectToTerms: boolean; error: ApiError } {
  const err = new ApiError(status, body?.code ?? "HTTP_" + status, body?.message ?? "Request failed", body ?? {});
  return { redirectToTerms: status === 403 && err.code === "TERMS_NOT_ACCEPTED", error: err };
}
export const defaultRedirect = () => {
  if (typeof window === "undefined" || window.location.pathname.startsWith("/legal/terms")) return;
  try { document.cookie = "jce_terms=; Max-Age=0; path=/"; } catch { /* ignore */ }
  window.location.assign("/legal/terms?next=" + encodeURIComponent(window.location.pathname));
};

export interface ClientOpts { baseUrl?: string; userId?: string; fetchImpl?: typeof fetch; onTermsRequired?: () => void }
export function createApi(o: ClientOpts = {}) {
  const base = o.baseUrl ?? API_BASE, uid = o.userId ?? DEV_USER_ID;
  const f = (...a: Parameters<typeof fetch>) => (o.fetchImpl ?? fetch)(...a);
  const onTerms = o.onTermsRequired ?? defaultRedirect;
  async function req<T>(path: string, init: RequestInit = {}): Promise<T> {
    const headers = new Headers(init.headers); headers.set("X-User-Id", uid);
    if (init.body && !(init.body instanceof FormData)) headers.set("Content-Type", "application/json");
    const res = await f(base + path, { ...init, headers });
    if (res.ok) return (res.status === 204 ? undefined : await res.json()) as T;
    const { redirectToTerms, error } = interceptError(res.status, await res.json().catch(() => null));
    if (redirectToTerms) onTerms();
    throw error;
  }
  const post = <T>(p: string, body: unknown) => req<T>(p, { method: "POST", body: JSON.stringify(body) });
  const optional = async <T>(fn: () => Promise<T>, mock: T): Promise<T> => {
    if (USE_MOCK) return mock;
    try { return await fn(); } catch (e) { if (e instanceof ApiError ? e.status === 404 || e.status === 405 : e instanceof TypeError) return mock; throw e; }
  };
  return {
    req,
    terms: () => req<Terms>("/legal/terms/current"),
    accept: (t: Terms, scrolled_to_end: boolean) => post<{ accepted: boolean }>("/legal/accept", { terms_version_id: t.terms_version_id, body_sha256: t.body_sha256, scrolled_to_end }),
    /** Documented: GET /projects (not yet implemented) -> Project[] */
    projects: () => optional(() => req<Project[]>("/projects"), mockProjects),
    project: async (id: string) => (await optional(() => req<Project[]>("/projects"), mockProjects)).find((p) => p.project_id === id) ?? { project_id: id, title: "Project " + id.slice(0, 8) },
    run: (id: string) => req<RunDetail>(`/runs/${id}`),
    createRun: (project_id: string, upload_id: string, scale?: number) =>
      post<{ run_id: string; status: string }>("/runs", { project_id, upload_id, targets: ["SA7"], params: scale ? { user_scale_denominator: scale } : {} }),
    acknowledge: (pid: string, kinds: string[]) => post<{ recorded: number; export_gate_missing: string[] }>(`/projects/${pid}/acknowledgements`, { kinds }),
    /** Documented: GET /projects/{id}/results (not yet implemented) */
    results: (pid: string) => optional(() => req<ProjectResults>(`/projects/${pid}/results`), mockResults),
    /** Documented: POST /projects/{id}/export {formats} -> ExportResult. Mocked with text blobs when absent. */
    exportFiles: (pid: string) => optional(() => post<ExportResult>(`/projects/${pid}/export`, { formats: ["dxf", "pdf"] }), mockExport()),
    upload(pid: string, file: File, warranty: boolean, onProgress: (pct: number) => void): Promise<{ upload_id: string; run_id: string; page_count: number }> {
      return new Promise((resolve, reject) => {
        const fd = new FormData(); fd.append("file", file); fd.append("upload_rights_warranty", String(warranty));
        const x = new XMLHttpRequest(); x.open("POST", `${base}/projects/${pid}/plans`); x.setRequestHeader("X-User-Id", uid);
        x.upload.onprogress = (e) => e.lengthComputable && onProgress(Math.round((e.loaded / e.total) * 100));
        x.onload = () => {
          let b: any = null; try { b = JSON.parse(x.responseText); } catch { /* */ }
          if (x.status >= 200 && x.status < 300) return resolve(b);
          const { redirectToTerms, error } = interceptError(x.status, b); if (redirectToTerms) onTerms(); reject(error);
        };
        x.onerror = () => reject(new ApiError(0, "NETWORK", "Network error")); x.send(fd);
      });
    },
  };
}
function mockExport(): ExportResult {
  const mk = (t: string, type: string) => URL.createObjectURL(new Blob([t], { type }));
  return typeof URL === "undefined" || !URL.createObjectURL ? { dxf_url: null, pdf_url: null } : { dxf_url: mk("0\nSECTION\n2\nENTITIES\n0\nENDSEC\n0\nEOF\n", "application/dxf"), pdf_url: mk("%PDF-1.1 mock", "application/pdf") };
}
export const api = createApi();
export { ALL_KINDS, missingAcks };
