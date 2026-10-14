import type { Citation, ComplianceRow, ComplianceStatus, ConstraintLayer, LayerState, PathwayState, RequirementStatus } from "./types";

/** Words for each layer state. "Not affected" is deliberately never "clear" or "no issues": the screening only covers mapped layers. */
export const LAYER_WORDS: Record<LayerState, string> = {
  affected: "Affected",
  not_affected: "No overlap found in this screened layer",
  not_checked: "Not checked",
};

/** Buffer-type layers use platform screening distances. They are not legal thresholds and the UI must say so. */
export const bufferNote = (l: Pick<ConstraintLayer, "buffer_m">) =>
  l.buffer_m ? `Screening distance used: ${l.buffer_m} m. This is a platform setting, not a legal threshold.` : null;

/** A not-checked layer must say why. Guards against a layer silently reading as clear. */
export function layerProblems(l: ConstraintLayer): string[] {
  const p: string[] = [];
  if (l.state === "not_checked" && !l.reason_not_checked) p.push("not_checked layer has no reason");
  if (l.state === "affected" && !l.figure) p.push("affected layer has no figure");
  if (!l.source) p.push("layer has no source");
  return p;
}

export const layerCounts = (ls: ConstraintLayer[]) => ({
  affected: ls.filter((l) => l.state === "affected").length,
  not_affected: ls.filter((l) => l.state === "not_affected").length,
  not_checked: ls.filter((l) => l.state === "not_checked").length,
});

export const hasCitation = (c?: Citation) => !!c && !!c.document && !!c.quote;

/** A requirement value may be shown only when it is cited or the user entered it. Otherwise it is UNRESOLVED. */
export function effectiveRequirementStatus(r: { status: RequirementStatus; value?: number; citation?: Citation }): RequirementStatus {
  if (r.value == null) return "unresolved";
  if (r.status === "user_confirmed") return "user_confirmed";
  return hasCitation(r.citation) ? "resolved" : "unresolved";
}

/** PASS and FAIL come only from a numeric comparison against a cited required value. Anything else is UNRESOLVED. */
export function complianceStatus(row: Pick<ComplianceRow, "proposed" | "required" | "compare" | "citation" | "status">): ComplianceStatus {
  if (row.status === "NOT_APPLICABLE") return "NOT_APPLICABLE";
  if (row.proposed == null || row.required == null || !row.compare || !hasCitation(row.citation)) return "UNRESOLVED";
  const ok = row.compare === "min" ? row.proposed >= row.required : row.proposed <= row.required;
  return ok ? "PASS" : "FAIL";
}

export const PATHWAY_WORDS: Record<PathwayState, string> = { ELIGIBLE: "Possible", NOT_ELIGIBLE: "Not eligible", UNRESOLVED: "Unresolved", NOT_APPLICABLE: "Not applicable" };

export const formatBytes = (n?: number) => (n == null ? "" : n > 1e6 ? (n / 1e6).toFixed(1) + " MB" : Math.max(1, Math.round(n / 1e3)) + " KB");
/** Australian date format, DD/MM/YYYY. Fixed locale so server and client agree. */
export const auDate = (iso?: string) => { if (!iso) return "n/a"; const d = new Date(iso); return isNaN(+d) ? "n/a" : d.toLocaleDateString("en-AU", { timeZone: "Australia/Sydney" }); };
