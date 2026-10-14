"use client";
import { api } from "@/lib/api";
import { useRemote } from "@/lib/useRemote";
import { complianceStatus } from "@/lib/status";
import { ComplianceTag, PathwayTag, SampleBanner } from "@/components/ui/Status";
import { SourceChip } from "@/components/ui/SourceChip";

export default function Pathway({ params }: { params: { id: string } }) {
  const { data, sample, error, loading } = useRemote(() => api.pathway(params.id), [params.id]);
  const rows = data?.compliance.map((r) => ({ ...r, st: complianceStatus(r) })) ?? [], unresolved = rows.filter((r) => r.st === "UNRESOLVED");
  return (
    <div>
      {sample && <SampleBanner what="The pathway and compliance table" />}
      <p className="h-eyebrow">Approval pathway</p>
      <h2 className="mt-2 font-display text-3xl font-medium">Exempt, CDC or DA</h2>
      <p className="mt-3 max-w-3xl text-sm leading-relaxed text-muted">The pathway is worked out from cited criteria. It must be verified with the council or a certifier. Where a criterion cannot be resolved the card says so and shows the criterion it could not resolve.</p>
      {error && <p role="alert" className="mt-4 text-danger">{error}</p>}
      {loading && !data && <p className="mt-6 text-muted">Loading...</p>}
      {data && <>
        <div className="mt-6 grid gap-4 md:grid-cols-3">{data.cards.map((c) => (
          <article key={c.id} className="border border-ink/30 bg-surface p-5">
            <h3 className="font-display text-xl font-medium leading-tight">{c.label}</h3><div className="mt-3"><PathwayTag s={c.state} pill={c.pill} /></div>
            {c.failing.length > 0 && <ul className="mt-4 space-y-2 border-t border-line pt-3 text-sm">{c.failing.map((f) => <li key={f.criterion}>{f.criterion}{f.citation && <div className="mt-1"><SourceChip c={f.citation} /></div>}</li>)}</ul>}
          </article>))}</div>

        <h3 className="mt-12 font-mono text-[11px] uppercase tracking-[.2em] text-gold">Compliance table</h3>
        <p className="mt-2 max-w-3xl text-sm text-muted">Pass and Fail appear only where a proposed value was compared with a cited required value. Everything else is Unresolved or Not applicable.</p>
        <div className="mt-4 overflow-x-auto border border-ink/30 bg-surface"><table className="w-full min-w-[40rem] text-sm">
          <caption className="sr-only">Compliance table</caption>
          <thead><tr className="border-b border-ink/30 text-left font-mono text-[10.5px] uppercase tracking-wider text-muted"><th className="p-3 font-medium">Control</th><th className="p-3 font-medium">Proposed</th><th className="p-3 font-medium">Required</th><th className="p-3 font-medium">Source</th><th className="p-3 font-medium">Result</th></tr></thead>
          <tbody className="divide-y divide-line">{rows.map((r) => <tr key={r.id}><th scope="row" className="p-3 text-left font-medium">{r.control}</th>
            <td className="p-3">{r.proposed != null ? `${r.proposed} ${r.unit ?? ""}` : <span className="text-muted">n/a</span>}</td>
            <td className="p-3">{r.required != null ? `${r.compare === "min" ? "≥" : "≤"} ${r.required} ${r.unit ?? ""}` : <span className="text-muted">n/a</span>}</td>
            <td className="p-3">{r.citation ? <SourceChip c={r.citation} /> : <span className="text-muted">None</span>}</td>
            <td className="p-3"><ComplianceTag s={r.st} /></td></tr>)}</tbody></table></div>
        {unresolved.length > 0 && <p className="mt-4 text-sm text-muted"><b className="text-ink">{unresolved.length}</b> rule{unresolved.length > 1 ? "s" : ""} unresolved: {unresolved.map((r) => r.control).join(", ")}. Resolve them on the Requirements tab.</p>}

        <h3 className="mt-12 font-mono text-[11px] uppercase tracking-[.2em] text-gold">Statement of Environmental Effects</h3>
        <p className="mt-3 max-w-3xl text-sm leading-relaxed">{data.soee.status === "draft" ? <>A <b>draft</b> is available with a DRAFT watermark. <b>{data.soee.to_be_completed}</b> lines are marked TO BE COMPLETED because the platform cannot know them. A planner must complete and check it.</> : "The draft Statement of Environmental Effects has not been produced yet."}</p>
      </>}
    </div>
  );
}
