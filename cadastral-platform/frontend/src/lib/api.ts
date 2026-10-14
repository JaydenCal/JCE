import { ALL_KINDS, missingAcks } from "./acks";
import { MOCK_PROJECT_ID, mockProjects, mockResults } from "./mock";
import { SAMPLE_ACTIVITY, SAMPLE_ARTIFACTS, SAMPLE_LAYERS, SAMPLE_LOTS, SAMPLE_PATHWAY, SAMPLE_REQUIREMENTS, SAMPLE_RUNS } from "./sample";
import type { ActivityEvent, Artifact, ConstraintLayer, LotCandidate, PathwayData, Requirement, RunSummary, Sampled } from "./types";

export const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:8000";
export const DEV_USER_ID = process.env.NEXT_PUBLIC_DEV_USER_ID ?? "00000000-0000-4000-8000-000000000001";
export const USE_MOCK = process.env.NEXT_PUBLIC_MOCK === "1";

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public extra: Record<string, unknown> = {}) { super(message); }
}
export type DevelopmentType = "dwelling_house" | "secondary_dwelling" | "shed" | "dual_occupancy";
export const DEFAULT_DEVELOPMENT_TYPE: DevelopmentType = "dwelling_house";
/** dual_occupancy is a stub: selectable, but no preset or rules are wired for it yet. */
export const DEVELOPMENT_TYPES: { value: DevelopmentType; label: string; note: string }[] = [
  { value: "dwelling_house", label: "Dwelling house", note: "Habitable dwelling (default)." },
  { value: "secondary_dwelling", label: "Secondary dwelling (granny flat)", note: "Small habitable building; adds sewer/water connection and occupant-based rainwater tank inputs." },
  { value: "shed", label: "Shed / outbuilding (Class 10a)", note: "Non-habitable shed or garage; optional rainwater roof catchment only." },
  { value: "dual_occupancy", label: "Dual occupancy (stub)", note: "Not yet supported: results will report requirements as unresolved." },
];
export const isDevelopmentType = (v: unknown): v is DevelopmentType => DEVELOPMENT_TYPES.some((d) => d.value === v);
export interface Terms { terms_version_id: string; version_label: string; effective_from: string; body_markdown: string; body_sha256: string; accepted: boolean | null }
export interface Project { project_id: string; title: string; development_type?: DevelopmentType; lotplan?: string; jurisdiction?: "NSW" | "QLD"; updated_at?: string }
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
  /** Number of Dial Before You Dig responses uploaded. 0 means services were not checked. Undefined means unknown. */
  dbyd_responses?: number;
}

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
  /** Like `optional`, but reports whether the data is sample data so the UI can say so. Never use the result as real. */
  const sampled = async <T>(fn: () => Promise<T>, sample: T): Promise<Sampled<T>> => {
    if (USE_MOCK) return { data: sample, sample: true };
    try { return { data: await fn(), sample: false }; } catch (e) { if (e instanceof ApiError ? e.status === 404 || e.status === 405 : e instanceof TypeError) return { data: sample, sample: true }; throw e; }
  };
  return {
    req,
    /** Proposed (brief 6.5, P0): GET /lots/search?q= */
    lotSearch: (q: string) => sampled(() => req<LotCandidate[]>(`/lots/search?q=${encodeURIComponent(q)}`), SAMPLE_LOTS),
    /** Proposed (P0): POST /projects */
    createProject: (b: { title: string; lotplan: string; development_type: DevelopmentType; jurisdiction: "NSW" | "QLD" }) =>
      sampled(() => post<Project>("/projects", b), { project_id: MOCK_PROJECT_ID, title: b.title, lotplan: b.lotplan, development_type: b.development_type, jurisdiction: b.jurisdiction }),
    /** Exists: POST /runs. Full body per brief 6.3. */
    startRun: (b: { project_id: string; development_type: DevelopmentType; params: Record<string, unknown>; upload_id?: string }) => post<{ run_id: string; status: string }>("/runs", b),
    cancelRun: (id: string) => post<{ status: string }>(`/runs/${id}/cancel`, {}),
    /** Proposed (P1): GET /projects/{id}/runs */
    runs: (pid: string) => sampled(() => req<RunSummary[]>(`/projects/${pid}/runs`), SAMPLE_RUNS),
    /** Proposed (P1): GET /projects/{id}/constraints */
    constraints: (pid: string) => sampled(() => req<ConstraintLayer[]>(`/projects/${pid}/constraints`), SAMPLE_LAYERS),
    /** Proposed (P1): GET /projects/{id}/requirements */
    requirements: (pid: string) => sampled(() => req<Requirement[]>(`/projects/${pid}/requirements`), SAMPLE_REQUIREMENTS),
    /** Proposed (P1): GET /projects/{id}/pathway (cards, compliance rows, SoEE state) */
    pathway: (pid: string) => sampled(() => req<PathwayData>(`/projects/${pid}/pathway`), SAMPLE_PATHWAY),
    /** Proposed (P0): GET /projects/{id}/results, reported with a sample flag. */
    resultsSampled: (pid: string) => sampled(() => req<ProjectResults>(`/projects/${pid}/results`), mockResults),
    /** Proposed (P0): GET /projects/{id}/artifacts */
    artifacts: (pid: string) => sampled(() => req<Artifact[]>(`/projects/${pid}/artifacts`), SAMPLE_ARTIFACTS),
    /** Proposed (P0): GET /artifacts/{id}/download. Gated by all nine acknowledgements; returns 403 with a `missing` list otherwise. */
    downloadUrl: (artifactId: string) => `${base}/artifacts/${artifactId}/download`,
    /** Proposed (P0): gated download. Resolves to a blob, or throws ApiError (403 carries `missing`). */
    async download(artifactId: string): Promise<Blob> {
      const res = await f(`${base}/artifacts/${artifactId}/download`, { headers: { "X-User-Id": uid } });
      if (res.ok) return res.blob();
      const { redirectToTerms, error } = interceptError(res.status, await res.json().catch(() => null));
      if (redirectToTerms) onTerms();
      throw error;
    },
    /** Proposed (P1): GET /artifacts/{id}/pages/{n}.png */
    pageImageUrl: (artifactId: string, n: number) => `${base}/artifacts/${artifactId}/pages/${n}.png`,
    /** Proposed (P1): activity feed */
    activity: (pid: string) => sampled(() => req<ActivityEvent[]>(`/projects/${pid}/activity`), SAMPLE_ACTIVITY),
    /** Proposed (P1): enter a user-confirmed requirement value */
    confirmRequirement: (pid: string, reqId: string, value: number, unit: string) => post<Requirement>(`/projects/${pid}/requirements/${reqId}/confirm`, { value, unit }),
    terms: () => req<Terms>("/legal/terms/current"),
    accept: (t: Terms, scrolled_to_end: boolean) => post<{ accepted: boolean }>("/legal/accept", { terms_version_id: t.terms_version_id, body_sha256: t.body_sha256, scrolled_to_end }),
    /** Documented: GET /projects (not yet implemented) -> Project[] */
    projects: () => optional(() => req<Project[]>("/projects"), mockProjects),
    project: async (id: string) => (await optional(() => req<Project[]>("/projects"), mockProjects)).find((p) => p.project_id === id) ?? { project_id: id, title: "Project " + id.slice(0, 8) },
    run: (id: string) => req<RunDetail>(`/runs/${id}`),
    createRun: (project_id: string, upload_id: string, scale?: number, development_type: DevelopmentType = DEFAULT_DEVELOPMENT_TYPE) =>
      post<{ run_id: string; status: string }>("/runs", { project_id, upload_id, targets: ["SA7"], development_type, params: scale ? { user_scale_denominator: scale } : {} }),
    acknowledge: (pid: string, kinds: string[]) => post<{ recorded: number; export_gate_missing: string[] }>(`/projects/${pid}/acknowledgements`, { kinds }),
    /** Documented: GET /projects/{id}/results (not yet implemented) */
    results: (pid: string) => optional(() => req<ProjectResults>(`/projects/${pid}/results`), mockResults),
    upload(pid: string, file: File, warranty: boolean, onProgress: (pct: number) => void, development_type: DevelopmentType = DEFAULT_DEVELOPMENT_TYPE): Promise<{ upload_id: string; run_id: string; page_count: number }> {
      return new Promise((resolve, reject) => {
        const fd = new FormData(); fd.append("file", file); fd.append("upload_rights_warranty", String(warranty)); fd.append("development_type", development_type);
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
export const api = createApi();
export { ALL_KINDS, missingAcks };
