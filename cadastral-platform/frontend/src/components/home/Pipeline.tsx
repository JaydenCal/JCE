"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AppWindow } from "./AppWindow";
import { ACK_KINDS } from "@/lib/acks";

import { STEPS, type Status } from "./data";
import { StatusPill } from "./Status";
import { EngineerEnquiryButton } from "@/components/enquiry/EngineerEnquiryButton";
import { ENGINEER_BTN } from "@/components/styles";
const Fig = ({ src, alt, w, h, cap }: { src: string; alt: string; w: number; h: number; cap?: string }) => (
  <figure className="m-0"><div className="sheet-img overflow-hidden rounded border border-line"><img src={src} alt={alt} width={w} height={h} loading="lazy" className="block h-auto w-full" /></div>{cap && <figcaption className="mt-2 font-mono text-[10.5px] leading-snug text-muted">{cap}</figcaption>}</figure>
);
const REAL = "Example output for Lot 2 DP227508, Gunnedah NSW (public cadastre, illustrative only)";
const Row = ({ t, s }: { t: string; s: Status }) => <li className="flex items-center justify-between gap-3 rounded border border-line bg-surface px-3 py-2 text-sm"><span>{t}</span><StatusPill s={s} /></li>;
const PATHWAYS: [string, string, string][] = [["Exempt development", "Not applicable", "border-line text-muted"], ["Complying development (CDC)", "Possible", "border-brand text-gold"], ["Development application (DA)", "Required", "border-ink text-ink"]];
function Visual({ i }: { i: number }) {
  if (i === 0) return <div className="grid gap-4 bg-scene p-4 sm:p-6 md:grid-cols-[1.1fr_.9fr]"><Fig src="/samples/report-map.webp" alt="Constraint overlay map showing a bushfire prone land layer and the lot, from a generated constraints report" w={925} h={606} cap={REAL + ". The report states when no aerial imagery is available." } />
    <ul className="space-y-2 self-center">{[["Lot boundary and cadastre", "Available"], ["Zoning and LEP maps", "Available"], ["Flood, bushfire, heritage", "Available"], ["Aerial imagery", "Available"]].map(([x, k], n) => <Row key={x} t={x + (n === 3 ? " (when available)" : "")} s={k as Status} />)}</ul></div>;
  if (i === 1) return <div className="bg-scene p-4 sm:p-6"><div className="grid gap-3 sm:grid-cols-3">{PATHWAYS.map(([t, p, c]) => <div key={t} className="rounded-lg border border-line bg-surface p-4"><p className="font-display text-lg font-medium leading-tight">{t}</p><span className={`pill mt-3 ${c}`}>{p}</span></div>)}</div>
    <p className="mt-3 font-mono text-[10.5px] leading-snug text-muted">Design mock-up of the pathway cards (In development). Pills shown are illustrative. Verify with the council or a certifier.</p>
    <div className="mt-4 max-w-md"><Fig src="/samples/report-triggers.webp" alt="Triggers and next steps page of a generated constraints report" w={954} h={736} cap={"Available now: triggers and next steps in the report. " + REAL} /></div></div>;
  if (i === 2) return <div className="grid gap-4 bg-scene p-4 sm:p-6 md:grid-cols-[1.2fr_.8fr]"><Fig src="/samples/gunnedah-plan-crop.webp" alt="Generated civil plan for Lot 2 DP227508 showing lot boundary, building envelope, setbacks, driveway crossover and swept path" w={1500} h={1352} cap={REAL} />
    <ul className="space-y-2 self-start">{[["Site plan and setbacks", "Available"], ["Driveway and swept path", "Available"], ["Services and exclusion buffers", "Available"], ["Levels and floor level above flood level", "In development"], ["Proposed ESCP", "In development"], ["Stormwater and rainwater tank", "In development"]].map(([x, k]) => <Row key={x} t={x} s={k as Status} />)}</ul></div>;
  if (i === 3) return <div className="grid gap-4 bg-scene p-4 sm:p-6 sm:grid-cols-2"><Fig src="/samples/viewer-orbit.webp" alt="3D viewer in orbit mode showing a lot, dwelling and driveway" w={1000} h={620} cap="Orbit view, live viewer demo" /><Fig src="/samples/viewer-walk.webp" alt="3D viewer in first-person walk mode" w={1000} h={620} cap="First-person walk-through" />
    <ul className="space-y-2 sm:col-span-2 sm:grid sm:grid-cols-2 sm:gap-2 sm:space-y-0"><Row t="Furnish from real products" s="Available" /><Row t="Change it by asking the Design Assistant" s="In development" /></ul><div className="sm:col-span-2"><Link href="/viewer-demo" className="btn-gold">Open the live 3D demo</Link></div></div>;
  if (i === 4) return <div className="grid gap-4 bg-scene p-4 sm:p-6 md:grid-cols-[1.2fr_.8fr]"><Fig src="/samples/report-summary.webp" alt="Summary of layers table from a constraints report listing each layer as affected, not affected or not checked" w={954} h={794} cap={REAL} />
    <ul className="space-y-2 self-start"><Row t="Compliance table, source cited per control" s="Available" /><Row t="Draft Statement of Environmental Effects" s="In development" /></ul></div>;
  if (i === 5) return <div className="bg-scene p-4 sm:p-6"><div className="grid gap-1.5 sm:grid-cols-3">{ACK_KINDS.map((a) => <div key={a.kind} className="flex items-start gap-2 rounded border border-line bg-surface p-2.5 text-xs leading-snug"><span className="mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-sm bg-ink text-bg" aria-hidden><svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M1.5 5.2 4 7.6l4.5-5" /></svg></span><span><b className="font-mono text-gold">{a.id}</b> <span className="text-muted">{a.kind.replace(/_/g, " ")}</span></span></div>)}</div>
    <ul className="mt-4 grid gap-2 sm:grid-cols-2"><Row t="DXF and PDF export" s="Available" /><Row t="Planning Portal lodgement pack: plans, reports, checklist, index" s="In development" /></ul></div>;
  return <div className="bg-scene p-6 sm:p-8"><p className="max-w-md font-display text-2xl font-medium leading-snug">Certification and engineering design by JCE Infrastructure.</p><p className="mt-3 max-w-md text-sm text-muted">Everything the tool produces is indicative until an engineer designs, checks and certifies the works.</p><EngineerEnquiryButton className={`${ENGINEER_BTN} mt-5 !px-6 !py-3`}>Talk to an engineer</EngineerEnquiryButton></div>;
}
export function Pipeline() {
  const [a, setA] = useState(0); const [auto, setAuto] = useState(true); const reduced = useRef(false);
  useEffect(() => { try { reduced.current = matchMedia("(prefers-reduced-motion: reduce)").matches; } catch { /* */ } if (reduced.current) setAuto(false); }, []);
  useEffect(() => { if (!auto) return; const t = setTimeout(() => setA((x) => (x + 1) % 7), 7000); return () => clearTimeout(t); }, [a, auto]);
  const pick = (i: number) => { setAuto(false); setA(i); };
  const s = STEPS[a];
  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,.9fr)_minmax(0,1.6fr)] lg:gap-12">
      <div>
        <div role="tablist" aria-label="Pipeline steps" aria-orientation="vertical" className="space-y-1">
          {STEPS.map((x, i) => <button key={x.n} role="tab" id={`tab-${i}`} aria-selected={i === a} aria-controls="step-panel" onClick={() => pick(i)}
            className={`group relative block w-full border-t border-ink/20 py-3.5 pr-2 text-left transition-colors ${i === a ? "text-ink" : "text-muted hover:text-ink"}`}>
            <span className="flex items-baseline gap-4"><span className={`font-mono text-xs ${i === a ? "text-gold" : ""}`}>{x.n}</span><span className="font-display text-xl font-medium">{x.t}</span>{x.s !== "Available" && <span className="ml-auto self-center"><StatusPill s={x.s} /></span>}</span>
            <span className="absolute inset-x-0 top-0 h-0.5 overflow-hidden" aria-hidden>{i === a && (auto ? <span key={a} className="fillbar block h-full w-full bg-brand" style={{ animationDuration: "7s" }} /> : <span className="block h-full w-full bg-brand" />)}{i < a && <span className="block h-full w-full bg-ink/40" />}</span>
          </button>)}
        </div>
        <div className="mt-2 border-t border-ink/20 pt-5"><p className="max-w-md text-[15px] leading-relaxed text-muted" aria-live="polite">{s.d}</p></div>
      </div>
      <div id="step-panel" role="tabpanel" aria-labelledby={`tab-${a}`} className="min-w-0"><AppWindow title={s.w}><div key={a} className="rise"><Visual i={a} /></div></AppWindow></div>
    </div>
  );
}
