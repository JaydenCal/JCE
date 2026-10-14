"use client";
import { useState } from "react";
import { api } from "@/lib/api";
import { useRemote } from "@/lib/useRemote";
import { auDate, bufferNote, layerCounts } from "@/lib/status";
import type { ConstraintLayer, LayerState } from "@/lib/types";
import { LayerStatus, SampleBanner } from "@/components/ui/Status";

const FILTERS: [LayerState | "all", string][] = [["all", "All layers"], ["affected", "Affected"], ["not_affected", "No overlap found"], ["not_checked", "Not checked"]];

function Layer({ l }: { l: ConstraintLayer }) {
  const note = bufferNote(l);
  return (
    <li className={`border p-5 ${l.state === "not_checked" ? "hatch border-ink/30" : l.state === "affected" ? "border-danger/50 bg-surface" : "border-line bg-surface"}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><p className="font-mono text-[10.5px] uppercase tracking-[.18em] text-muted">{l.group}</p><h3 className="mt-1 font-display text-xl font-medium">{l.name}</h3></div>
        <LayerStatus s={l.state} />
      </div>
      {l.figure && <p className="mt-3 font-medium">{l.figure}</p>}
      <dl className="mt-3 grid gap-x-8 gap-y-3 text-sm sm:grid-cols-2">
        <div><dt className="font-mono text-[10.5px] uppercase tracking-wider text-muted">What it is</dt><dd className="mt-1 leading-relaxed">{l.what}</dd></div>
        {l.may_trigger && <div><dt className="font-mono text-[10.5px] uppercase tracking-wider text-muted">What it may trigger</dt><dd className="mt-1 leading-relaxed">{l.may_trigger}</dd></div>}
        {l.next_step && <div><dt className="font-mono text-[10.5px] uppercase tracking-wider text-muted">Next step</dt><dd className="mt-1 leading-relaxed">{l.next_step}</dd></div>}
        {l.state === "not_checked" && <div className="sm:col-span-2"><dt className="font-mono text-[10.5px] uppercase tracking-wider text-muted">Why it was not checked</dt><dd className="mt-1 leading-relaxed">{l.reason_not_checked ?? "No reason was recorded."} The platform makes no statement either way for this layer.</dd></div>}
      </dl>
      {note && <p className="mt-3 border-l-2 border-brand pl-3 text-xs leading-relaxed text-muted">{note}</p>}
      <p className="mt-4 font-mono text-[10.5px] text-muted">Source: {l.source}{l.data_date ? ` · data date ${auDate(l.data_date)}` : ""}</p>
    </li>
  );
}

export default function Constraints({ params }: { params: { id: string } }) {
  const { data, sample, error, loading } = useRemote(() => api.constraints(params.id), [params.id]);
  const [f, setF] = useState<LayerState | "all">("all");
  const shown = (data ?? []).filter((l) => f === "all" || l.state === f), c = data ? layerCounts(data) : null;
  return (
    <div>
      {sample && <SampleBanner what="The constraints list" />}
      <p className="h-eyebrow">Constraints screening</p>
      <h2 className="mt-2 font-display text-3xl font-medium">What the mapped layers say about this lot</h2>
      <p className="mt-3 max-w-3xl text-sm leading-relaxed text-muted">This is a screening against public mapped layers. &ldquo;No overlap found&rdquo; means the mapped layer does not touch the lot. It is not a clearance. A layer that could not be queried is shown as <b className="text-ink">Not checked</b> and the platform says nothing either way.</p>
      {error && <p role="alert" className="mt-4 text-danger">{error}</p>}
      {loading && !data && <p className="mt-6 text-muted">Loading...</p>}
      {c && <>
        <div role="group" aria-label="Filter layers" className="mt-6 flex flex-wrap gap-2">
          {FILTERS.map(([k, t]) => <button key={k} aria-pressed={f === k} onClick={() => setF(k)} className={`rounded-sm border px-3 py-1.5 font-mono text-[11px] uppercase tracking-wider ${f === k ? "border-ink bg-ink text-bg" : "border-line text-muted hover:border-ink hover:text-ink"}`}>{t}{k !== "all" && <span className="ml-2">{c[k]}</span>}</button>)}
        </div>
        <ul className="mt-6 space-y-4">{shown.map((l) => <Layer key={l.id} l={l} />)}</ul>
        {shown.length === 0 && <p className="mt-6 text-muted">No layers in this state.</p>}
      </>}
    </div>
  );
}
