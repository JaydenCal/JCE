"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api, DEFAULT_DEVELOPMENT_TYPE, type DevelopmentType } from "@/lib/api";
import type { LotCandidate } from "@/lib/types";
import { saveDevelopmentType, DevelopmentTypeSelector } from "@/components/DevelopmentTypeSelector";
import { LotMap } from "@/components/LotMap";
import { SampleBanner } from "@/components/ui/Status";

const STEPS = ["Find the lot", "Development type", "Confirm"];

export default function NewProject() {
  const router = useRouter(), [step, setStep] = useState(0), [q, setQ] = useState(""), [busy, setBusy] = useState(false), [err, setErr] = useState("");
  const [cands, setCands] = useState<LotCandidate[] | null>(null), [sample, setSample] = useState(false), [lot, setLot] = useState<LotCandidate>(), [dt, setDt] = useState<DevelopmentType>(DEFAULT_DEVELOPMENT_TYPE);
  async function search(e: React.FormEvent) {
    e.preventDefault(); if (q.trim().length < 3) { setErr("Enter an address, or a lot and plan such as 2//DP227508."); return; }
    setBusy(true); setErr(""); setLot(undefined);
    try { const r = await api.lotSearch(q.trim()); setCands(r.data); setSample(r.sample); }
    catch (x) { setCands(null); setErr("The lot service could not be reached. Nothing was checked. Try again, or ask an engineer for help."); }
    finally { setBusy(false); }
  }
  async function create() {
    if (!lot) return; setBusy(true); setErr("");
    try { const r = await api.createProject({ title: lot.address, lotplan: lot.lotplan, development_type: dt, jurisdiction: lot.jurisdiction });
      saveDevelopmentType(r.data.project_id, dt); router.push(`/projects/${r.data.project_id}`); }
    catch (x) { setErr((x as Error).message); setBusy(false); }
  }
  return (<div className="py-10">
    <Link href="/projects" className="text-sm text-muted hover:text-ink">&larr; Projects</Link>
    <p className="h-eyebrow mt-4">New project</p><h1 className="mt-2 font-display text-4xl font-medium">Start from the lot</h1>
    <ol className="mt-6 flex flex-wrap gap-x-8 gap-y-2 border-y border-ink/20 py-3 font-mono text-[11px] uppercase tracking-wider" aria-label="Steps">{STEPS.map((s, i) => <li key={s} aria-current={i === step ? "step" : undefined} className={i === step ? "text-ink" : "text-muted"}><span className="text-gold">{String(i + 1).padStart(2, "0")}</span> {s}</li>)}</ol>
    {sample && <div className="mt-6"><SampleBanner what="Lot search" /></div>}

    {step === 0 && <section className="mt-8 max-w-3xl">
      <form onSubmit={search} className="flex flex-wrap items-end gap-3"><label className="min-w-[16rem] flex-1 text-sm font-medium">Address, or lot and plan<input className="input mt-1.5 block w-full" value={q} onChange={(e) => setQ(e.target.value)} placeholder="2//DP227508" autoComplete="off" /></label><button className="btn-primary" disabled={busy}>{busy ? "Searching..." : "Search"}</button></form>
      <p className="mt-2 text-xs text-muted">NSW lots are searched against public NSW services. Queensland has not been verified yet.</p>
      {err && <p role="alert" className="mt-4 text-danger">{err}</p>}
      {cands?.length === 0 && <div className="mt-6 hatch border border-ink/30 p-4 text-sm"><p className="font-medium">No match found.</p><p className="mt-1 text-muted">Check the lot and plan, or try the address. If your site is outside NSW and Queensland, see <Link href="/custom-municipality" className="font-medium text-gold underline underline-offset-4">custom municipality</Link>.</p></div>}
      {cands && cands.length > 0 && <ul className="mt-6 space-y-3" aria-label="Matches">{cands.map((c) => (
        <li key={c.lotplan}><button onClick={() => { setLot(c); setStep(1); }} className="block w-full border border-ink/30 bg-surface p-4 text-left hover:border-ink">
          <span className="font-mono text-xs text-gold">{c.jurisdiction} · {c.lotplan}</span><span className="mt-1 block font-medium">{c.address}</span><span className="mt-1 block text-sm text-muted">{c.lga} · {c.zone} · {c.area_m2} m²</span></button></li>))}</ul>}
    </section>}

    {step === 1 && lot && <section className="mt-8 grid gap-8 lg:grid-cols-[1.1fr_.9fr]">
      <div><h2 className="font-display text-2xl font-medium">What is being built?</h2><div className="mt-5"><DevelopmentTypeSelector value={dt} onChange={setDt} /></div>
        <div className="mt-6 flex gap-3"><button className="btn-ghost" onClick={() => setStep(0)}>Back</button><button className="btn-primary" onClick={() => setStep(2)}>Continue</button></div></div>
      {lot.ring && <LotMap ring={lot.ring} schematic={sample} label={`Outline of ${lot.lotplan}`} />}
    </section>}

    {step === 2 && lot && <section className="mt-8 grid gap-8 lg:grid-cols-[1.1fr_.9fr]">
      <div><h2 className="font-display text-2xl font-medium">Confirm the lot</h2>
        <dl className="titleblock mt-5 grid-cols-2 [&>div]:border-b [&>div:nth-child(odd)]:border-r">{[["Lot and plan", lot.lotplan], ["Council area", lot.lga], ["Zone", lot.zone], ["Area", `${lot.area_m2} m²`], ["Development", dt.replace(/_/g, " ")], ["State", lot.jurisdiction]].map(([k, v]) => <div key={k}><dt className="font-mono text-[10.5px] uppercase tracking-[.18em] text-muted">{k}</dt><dd className="mt-1 font-medium">{v}</dd></div>)}</dl>
        <p className="mt-4 text-sm leading-relaxed text-muted">The outline and area come from the public cadastre. They are indicative and are not a survey. After the project is created you can upload an architect&rsquo;s PDF and start the run.</p>
        {dt === "dual_occupancy" && <p className="mt-3 border border-warn/60 bg-warn/5 p-3 text-sm">Dual occupancy is not supported yet. Its requirements will be reported as unresolved.</p>}
        {err && <p role="alert" className="mt-4 text-danger">{err}</p>}
        <div className="mt-6 flex gap-3"><button className="btn-ghost" onClick={() => setStep(1)}>Back</button><button className="btn-primary" onClick={create} disabled={busy}>{busy ? "Creating..." : "Create project"}</button></div></div>
      {lot.ring && <LotMap ring={lot.ring} schematic={sample} label={`Outline of ${lot.lotplan}`} />}
    </section>}
  </div>);
}
