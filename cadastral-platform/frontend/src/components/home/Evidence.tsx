"use client";
import { useState } from "react";
import { AppWindow } from "./AppWindow";
import { SOURCE_PLACEHOLDER } from "@/lib/sample";
import { RequirementStatusTag, Unresolved } from "@/components/ui/Status";
import type { Requirement } from "@/lib/types";

/** Interactive tour: click a control to see its source, or the honest gap. SAMPLE values, labelled as such. */
const ROWS: (Requirement & { blurb: string })[] = [
  { id: "front", control: "Front setback", group: "Setbacks", status: "resolved", value: 6, unit: "m", blurb: "A value with a source you can open.", citation: { document: SOURCE_PLACEHOLDER, version: "v0", page: 12, quote: "Sample quote: the minimum front setback is 6 m." } },
  { id: "side", control: "Side setback", group: "Setbacks", status: "resolved", value: 0.9, unit: "m", blurb: "Each one carries document, version and page.", citation: { document: SOURCE_PLACEHOLDER, version: "v0", page: 12, quote: "Sample quote: the minimum side setback is 0.9 m." } },
  { id: "rear", control: "Rear setback", group: "Setbacks", status: "user_confirmed", value: 3, unit: "m", blurb: "A value you entered is marked as yours." },
  { id: "height", control: "Maximum height", group: "Envelope", status: "unresolved", blurb: "No source found, so no number is shown.", unresolved_reason: "No cited source was found in the council documents loaded for this area.", next_step: "Enter a value you have confirmed, or upload the document." },
];
export function Evidence() {
  const [i, setI] = useState(0), r = ROWS[i];
  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,.9fr)_minmax(0,1.3fr)] lg:gap-12">
      <div role="tablist" aria-label="Controls" aria-orientation="vertical" className="space-y-1">
        {ROWS.map((x, n) => <button key={x.id} role="tab" aria-selected={n === i} onClick={() => setI(n)} className={`block w-full border-t border-ink/20 py-4 text-left ${n === i ? "text-ink" : "text-muted hover:text-ink"}`}>
          <span className="flex items-baseline gap-4"><span className={`font-mono text-xs ${n === i ? "text-gold" : ""}`}>0{n + 1}</span><span className="font-display text-xl font-medium">{x.control}</span></span>
          <span className="mt-1 block pl-8 text-sm text-muted">{x.blurb}</span></button>)}
      </div>
      <AppWindow title="Requirements" className="self-start"><div className="bg-scene p-5 sm:p-8" aria-live="polite">
        <p className="font-mono text-[10.5px] uppercase tracking-[.18em] text-muted">{r.group}</p>
        <div className="mt-1 flex flex-wrap items-center justify-between gap-3"><h3 className="font-display text-2xl font-medium">{r.control}</h3><RequirementStatusTag s={r.status} /></div>
        {r.status === "unresolved" ? <div className="mt-5"><Unresolved reason={r.unresolved_reason} next={r.next_step} /></div> : <>
          <p className="mt-4 font-display text-5xl font-medium text-gold">{r.value} <span className="text-2xl text-muted">{r.unit}</span></p>
          {r.citation ? <figure className="mt-5 border border-ink/30 bg-surface p-4"><p className="font-mono text-[10.5px] uppercase tracking-wider text-gold">{r.citation.document}</p><p className="mt-1 font-mono text-[10.5px] text-muted">Version {r.citation.version} · Page {r.citation.page}</p><blockquote className="mt-3 border-l-2 border-brand pl-3 text-[15px] leading-relaxed">&ldquo;{r.citation.quote}&rdquo;</blockquote></figure>
            : <p className="mt-5 text-sm text-muted">Entered by you. The platform has not checked it against a source.</p>}</>}
        <p className="mt-5 font-mono text-[10.5px] text-muted">Sample values for illustration. They are not a result for any lot.</p>
      </div></AppWindow>
    </div>
  );
}
