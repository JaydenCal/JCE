/** Domain types for the contract proposed in docs/website brief section 6.5 / 10.3. None of these endpoints exist yet;
 *  the client falls back to clearly labelled sample data (see lib/sample.ts). */

export interface Citation { document: string; version?: string; page?: number | string; quote: string; url?: string }

/** Constraint layer states. `not_checked` means the source could not be queried: it is NOT a clear result. */
export type LayerState = "affected" | "not_affected" | "not_checked";
export interface ConstraintLayer {
  id: string; name: string; group: string; state: LayerState;
  /** Figure for an affected layer, e.g. "Vegetation Category 1" or "12 m to nearest feature". */
  figure?: string;
  /** Plain English: what the layer is. */
  what: string; may_trigger?: string; next_step?: string;
  /** Screening distance set in the platform for buffer-type layers. Not a legal threshold. */
  buffer_m?: number;
  source: string; data_date?: string;
  /** Required when state is not_checked. */
  reason_not_checked?: string;
}

export type RequirementStatus = "resolved" | "user_confirmed" | "unresolved";
export interface Requirement {
  id: string; control: string; group: string; status: RequirementStatus;
  value?: number; unit?: string; citation?: Citation;
  unresolved_reason?: string; next_step?: string;
}

export type PathwayState = "ELIGIBLE" | "NOT_ELIGIBLE" | "UNRESOLVED" | "NOT_APPLICABLE";
export type PathwayPill = "Required" | "Possible" | "Not applicable" | "Unresolved";
export interface PathwayCard { id: "exempt" | "cdc" | "da"; label: string; state: PathwayState; pill: PathwayPill; failing: { criterion: string; citation?: Citation }[] }

export type ComplianceStatus = "PASS" | "FAIL" | "UNRESOLVED" | "NOT_APPLICABLE";
export interface ComplianceRow { id: string; control: string; proposed?: number; required?: number; unit?: string; compare?: "min" | "max"; status: ComplianceStatus; citation?: Citation }

export interface PathwayData { cards: PathwayCard[]; compliance: ComplianceRow[]; soee: { status: "draft" | "pending" | "unavailable"; to_be_completed: number } }

export type ArtifactKind = "planset_pdf" | "planset_dxf" | "site_report_pdf" | "constraints_report_pdf" | "esc_pdf" | "esc_dxf" | "application_pack_zip" | "soee_pdf" | "soee_docx" | "scene_bundle";
export interface Artifact { id: string; kind: ArtifactKind; name: string; format: string; status: "ready" | "pending" | "unavailable"; pages?: number; bytes?: number; produced_at?: string; note?: string }

export interface PlanSheet { code: string; title: string }

export interface LotCandidate { lotplan: string; address: string; lga: string; zone: string; area_m2: number; jurisdiction: "NSW" | "QLD"; ring?: [number, number][] }

export interface RunSummary { run_id: string; status: string; started_at?: string; label?: string }
export interface ActivityEvent { at: string; kind: "run" | "acknowledgement" | "upload" | "terms"; text: string }

export type Sampled<T> = { data: T; sample: boolean };
