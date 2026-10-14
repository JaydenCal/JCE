"use client";
import Link from "next/link";
import { useState } from "react";
import { EngineerEnquiryButton } from "@/components/enquiry/EngineerEnquiryButton";
import { ENGINEER_BTN } from "@/components/styles";

const ROLES = [
  { k: "owners", t: "Owners and builders", h: "Know what you can build before you pay for drawings.", p: ["Start from the address. See the constraints that apply, what each may trigger, and which approval pathway looks likely.", "Get civil plans and an application pack assembled for lodgement, with every gap listed so nothing is a surprise at assessment."], cta: ["Start free trial", "/projects/new"] },
  { k: "designers", t: "Designers and drafters", h: "Put your plan on the lot and check it against the controls.", p: ["Upload your architect's PDF. It is aligned to the lot with a stated error, and you confirm the scale if it cannot be read with confidence.", "Setbacks, envelope and driveway are checked against cited values. Open the 3D model to walk the result with the client."], cta: ["Upload a plan", "/projects/new"] },
  { k: "councils", t: "Councils and certifiers", h: "Load your own documents and standards.", p: ["Custom municipality is in development: your engineering documents, your units and your design standards, with each requirement cited to your own text.", "Nothing is assumed from another council. Where a rule is missing the output says so."], cta: ["Read about custom municipality", "/custom-municipality"] },
] as const;
export function Roles() {
  const [i, setI] = useState(0), r = ROLES[i];
  return (
    <div>
      <div role="tablist" aria-label="Who it is for" className="flex flex-wrap gap-2">{ROLES.map((x, n) => <button key={x.k} role="tab" aria-selected={n === i} onClick={() => setI(n)} className={`rounded-sm border px-4 py-2 font-mono text-[11px] uppercase tracking-wider ${n === i ? "border-ink bg-ink text-bg" : "border-line text-muted hover:border-ink hover:text-ink"}`}>{x.t}</button>)}</div>
      <div role="tabpanel" className="mt-8 grid gap-8 border-t border-ink/30 pt-8 lg:grid-cols-[1fr_1fr]">
        <h3 className="h-display text-[clamp(1.8rem,3vw,2.6rem)]">{r.h}</h3>
        <div className="space-y-4 text-[17px] leading-relaxed text-muted">{r.p.map((x) => <p key={x}>{x}</p>)}
          <div className="flex flex-wrap gap-3 pt-2"><Link href={r.cta[1]} className="btn-primary">{r.cta[0]}</Link><EngineerEnquiryButton className={ENGINEER_BTN}>Talk to an engineer</EngineerEnquiryButton></div></div>
      </div>
    </div>
  );
}
