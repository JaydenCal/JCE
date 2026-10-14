"use client";
import { useState } from "react";
import { api } from "@/lib/api";
import { useRemote } from "@/lib/useRemote";
import { effectiveRequirementStatus } from "@/lib/status";
import type { Requirement } from "@/lib/types";
import { RequirementStatusTag, SampleBanner, Unresolved } from "@/components/ui/Status";
import { SourceChip } from "@/components/ui/SourceChip";

function EnterValue({ r, projectId, onDone }: { r: Requirement; projectId: string; onDone: () => void }) {
  const [v, setV] = useState(""), [err, setErr] = useState(""), [busy, setBusy] = useState(false);
  async function save(e: React.FormEvent) {
    e.preventDefault(); const n = Number(v); if (!v.trim() || !Number.isFinite(n)) { setErr("Enter a number."); return; }
    setBusy(true); setErr("");
    try { await api.confirmRequirement(projectId, r.id, n, r.unit ?? "m"); onDone(); }
    catch (x) { setErr((x as Error).message.includes("Request failed") ? "This could not be saved yet. The route for entering a value is not available." : (x as Error).message); } finally { setBusy(false); }
  }
  return <form onSubmit={save} className="mt-3 flex flex-wrap items-end gap-3"><label className="text-xs text-muted">Value you have confirmed ({r.unit ?? "m"})<input className="input mt-1 block w-32" inputMode="decimal" value={v} onChange={(e) => setV(e.target.value)} aria-label={`Confirmed value for ${r.control}`} /></label>
    <button className="btn-ghost !py-2" disabled={busy}>{busy ? "Saving..." : "Use this value"}</button>{err && <p role="alert" className="w-full text-xs text-danger">{err}</p>}</form>;
}

export default function Requirements({ params }: { params: { id: string } }) {
  const { data, sample, error, loading, reload } = useRemote(() => api.requirements(params.id), [params.id]);
  const groups = [...new Set((data ?? []).map((r) => r.group))];
  return (
    <div>
      {sample && <SampleBanner what="The requirements table" />}
      <p className="h-eyebrow">Requirements</p>
      <h2 className="mt-2 font-display text-3xl font-medium">Planning and engineering values, with their sources</h2>
      <p className="mt-3 max-w-3xl text-sm leading-relaxed text-muted">Every value below either has a source you can open (document, version, page and quote) or was entered by you. Where neither is true the value is <b className="text-ink">Unresolved</b>. The platform does not guess a setback, height or width.</p>
      {error && <p role="alert" className="mt-4 text-danger">{error}</p>}
      {loading && !data && <p className="mt-6 text-muted">Loading...</p>}
      {groups.map((g) => (
        <section key={g} className="mt-10" aria-labelledby={"g-" + g.replace(/\W/g, "")}>
          <h3 id={"g-" + g.replace(/\W/g, "")} className="font-mono text-[11px] uppercase tracking-[.2em] text-gold">{g}</h3>
          <ul className="mt-3 divide-y divide-line border-y border-ink/30 bg-surface">
            {data!.filter((r) => r.group === g).map((r) => { const st = effectiveRequirementStatus(r);
              return <li key={r.id} className="grid gap-3 p-4 sm:grid-cols-[1fr_auto] sm:items-start">
                <div className="min-w-0">
                  <p className="font-medium">{r.control}</p>
                  {st === "unresolved" ? <div className="mt-2"><Unresolved reason={r.unresolved_reason ?? "No cited source was found."} next={r.next_step ?? "Enter a value you have confirmed, or upload the document."}><EnterValue r={r} projectId={params.id} onDone={reload} /></Unresolved></div>
                    : <div className="mt-1 flex flex-wrap items-center gap-3"><span className="font-display text-2xl font-medium text-gold">{r.value} <span className="text-base text-muted">{r.unit}</span></span>
                      {st === "resolved" && r.citation ? <SourceChip c={r.citation} /> : <span className="text-xs text-muted">Entered by you. Not checked against a source.</span>}</div>}
                </div>
                <div className="sm:justify-self-end"><RequirementStatusTag s={st} /></div>
              </li>; })}
          </ul>
        </section>))}
    </div>
  );
}
