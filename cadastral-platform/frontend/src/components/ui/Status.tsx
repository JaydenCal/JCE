import type { ReactNode } from "react";
import { LAYER_WORDS, PATHWAY_WORDS } from "@/lib/status";
import type { ComplianceStatus, LayerState, PathwayState, RequirementStatus } from "@/lib/types";

/** Shape-coded glyphs so status never depends on colour alone. */
const G = {
  tick: <path d="M2 6.2 4.8 9 10 3" />, cross: <path d="M3 3l6 6M9 3 3 9" />, q: <path d="M4.6 4.4a1.5 1.5 0 1 1 2.2 1.3c-.5.3-.8.6-.8 1.2M6 9.3v.1" />,
  bang: <path d="M6 3v3.8M6 9.2v.1" />, dash: <path d="M3 6h6" />, dots: <circle cx="6" cy="6" r="4" strokeDasharray="1.6 1.8" />, hand: <path d="M3.5 8.5 8.5 3.5M5 3.5h3.5V7" />,
};
const Icon = ({ g }: { g: keyof typeof G }) => <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{G[g]}</svg>;
const Tag = ({ cls, g, children }: { cls: string; g: keyof typeof G; children: ReactNode }) => <span className={cls}><Icon g={g} />{children}</span>;

export const LayerStatus = ({ s }: { s: LayerState }) =>
  s === "affected" ? <Tag cls="st-bad" g="bang">Affected</Tag> : s === "not_checked" ? <Tag cls="st-nc" g="dots">Not checked</Tag> : <Tag cls="st-muted" g="dash">No overlap found</Tag>;
export { LAYER_WORDS };

export const RequirementStatusTag = ({ s }: { s: RequirementStatus }) =>
  s === "resolved" ? <Tag cls="st-ok" g="tick">Cited</Tag> : s === "user_confirmed" ? <Tag cls="st-info" g="hand">You entered this</Tag> : <Tag cls="st-warn" g="q">Unresolved</Tag>;

export const ComplianceTag = ({ s }: { s: ComplianceStatus }) =>
  s === "PASS" ? <Tag cls="st-ok" g="tick">Pass</Tag> : s === "FAIL" ? <Tag cls="st-bad" g="cross">Fail</Tag> : s === "UNRESOLVED" ? <Tag cls="st-warn" g="q">Unresolved</Tag> : <Tag cls="st-muted" g="dash">Not applicable</Tag>;

export const PathwayTag = ({ s, pill }: { s: PathwayState; pill?: string }) =>
  <Tag cls={s === "ELIGIBLE" ? "st-info" : s === "UNRESOLVED" ? "st-warn" : s === "NOT_ELIGIBLE" ? "st-bad" : "st-muted"} g={s === "UNRESOLVED" ? "q" : s === "NOT_ELIGIBLE" ? "cross" : s === "ELIGIBLE" ? "tick" : "dash"}>{pill ?? PATHWAY_WORDS[s]}</Tag>;

export const RUN_WORDS: Record<string, string> = { queued: "Queued", running: "Running", waiting_user: "Needs your input", succeeded: "Finished", failed: "Failed", cancelled: "Cancelled", blocked_by_gate: "Held at export gate" };
export const RunTag = ({ s }: { s: string }) =>
  <Tag cls={s === "succeeded" ? "st-ok" : s === "failed" ? "st-bad" : s === "waiting_user" || s === "blocked_by_gate" ? "st-warn" : s === "running" ? "st-info" : "st-muted"} g={s === "succeeded" ? "tick" : s === "failed" ? "cross" : s === "waiting_user" || s === "blocked_by_gate" ? "q" : s === "running" ? "dots" : "dash"}>{RUN_WORDS[s] ?? s}</Tag>;

/** Persistent on result views and next to every download (brief rule 3). */
export const DraftBadge = ({ className = "" }: { className?: string }) => <span className={`st-warn ${className}`}><Icon g="bang" />Indicative draft</span>;

/** Shown wherever sample data is rendered. Sample values are never real results. */
export const SampleBanner = ({ what = "This page" }: { what?: string }) =>
  <div role="note" className="hatch mb-6 border border-warn/50 px-4 py-3 text-sm"><b className="font-mono text-[11px] uppercase tracking-wider text-warn">Sample data</b><span className="ml-3 text-ink">{what} is showing placeholder values because the matching API endpoint is not available yet. Nothing here is a result for your lot.</span></div>;

/** UNRESOLVED block: reason plus the next step (brief rule 5). */
export function Unresolved({ reason, next, children }: { reason?: string; next?: string; children?: ReactNode }) {
  return <div className="border border-warn/60 bg-warn/5 p-3 text-sm"><div className="flex items-center gap-2"><span className="st-warn"><Icon g="q" />Unresolved</span></div>
    {reason && <p className="mt-2 text-ink">{reason}</p>}{next && <p className="mt-1 text-muted"><b className="font-medium text-ink">Next step:</b> {next}</p>}{children}</div>;
}
