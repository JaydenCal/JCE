"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { api, DEFAULT_DEVELOPMENT_TYPE, type DevelopmentType } from "@/lib/api";
import { useRemote } from "@/lib/useRemote";
import { layerCounts } from "@/lib/status";
import { effectiveRequirementStatus } from "@/lib/status";
import { PlanUpload } from "@/components/PlanUpload";
import { DevelopmentTypeSelector, loadDevelopmentType, saveDevelopmentType } from "@/components/DevelopmentTypeSelector";
import { PathwayTag, SampleBanner } from "@/components/ui/Status";
import { Section } from "@/components/ui/Layout";

const Card = ({ href, title, children }: { href: string; title: string; children: React.ReactNode }) => (
  <Link href={href} className="group block border border-ink/30 bg-surface p-5 transition-colors hover:border-ink">
    <p className="h-eyebrow">{title}</p><div className="mt-3 space-y-1 text-sm">{children}</div>
    <p className="mt-4 font-mono text-[11px] uppercase tracking-wider text-muted group-hover:text-gold">Open &rarr;</p>
  </Link>
);

export default function Overview({ params }: { params: { id: string } }) {
  const { id } = params, base = `/projects/${id}`, [dt, setDt] = useState<DevelopmentType>(DEFAULT_DEVELOPMENT_TYPE);
  useEffect(() => setDt(loadDevelopmentType(id)), [id]);
  const pick = (v: DevelopmentType) => { setDt(v); saveDevelopmentType(id, v); };
  const res = useRemote(() => api.resultsSampled(id), [id]), con = useRemote(() => api.constraints(id), [id]), req = useRemote(() => api.requirements(id), [id]),
    pw = useRemote(() => api.pathway(id), [id]), art = useRemote(() => api.artifacts(id), [id]);
  const sample = res.sample || con.sample || req.sample || pw.sample || art.sample;
  const lc = con.data ? layerCounts(con.data) : null, rs = req.data?.map(effectiveRequirementStatus) ?? [];
  const lot = res.data?.lot;
  return (<div className="space-y-12">
    {sample && <SampleBanner what="The overview" />}
    <Section eyebrow="Summary" title="Where this project stands">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Card href={`${base}/constraints`} title="Constraints">{lc ? <>
          <p><b>{lc.affected}</b> affected</p><p><b>{lc.not_affected}</b> with no overlap found</p><p><b>{lc.not_checked}</b> not checked</p></> : <p className="text-muted">Loading...</p>}</Card>
        <Card href={`${base}/requirements`} title="Requirements">{req.data ? <>
          <p><b>{rs.filter((s) => s === "resolved").length}</b> cited</p><p><b>{rs.filter((s) => s === "user_confirmed").length}</b> entered by you</p><p><b>{rs.filter((s) => s === "unresolved").length}</b> unresolved</p></> : <p className="text-muted">Loading...</p>}</Card>
        <Card href={`${base}/pathway`} title="Approval pathway">{pw.data ? <ul className="space-y-1.5">{pw.data.cards.map((c) => <li key={c.id} className="flex items-center justify-between gap-3"><span>{c.label.replace(/ \(.*\)/, "")}</span><PathwayTag s={c.state} pill={c.pill} /></li>)}</ul> : <p className="text-muted">Loading...</p>}</Card>
        <Card href={`${base}/plans`} title="Plans and reports">{art.data ? <><p><b>{art.data.filter((a) => a.status === "ready").length}</b> ready</p><p><b>{art.data.filter((a) => a.status !== "ready").length}</b> not yet produced</p></> : <p className="text-muted">Loading...</p>}</Card>
        <Card href={`${base}/services`} title="Services and driveway"><p className="text-muted">Crossover check, services conflicts and rainwater tank.</p></Card>
        <Card href={`${base}/download`} title="Acknowledge and download"><p className="text-muted">Nine acknowledgements release the downloads.</p></Card>
      </div>
    </Section>

    {lot && <Section eyebrow="The lot" title="Key facts" note="Boundaries are indicative and are not a survey.">
      <dl className="titleblock grid-cols-2 lg:grid-cols-4 [&>div]:border-b [&>div:nth-child(odd)]:border-r lg:[&>div]:border-b-0 lg:[&>div:not(:last-child)]:border-r">
        {[["Lot and plan", lot.lotplan], ["Council area", lot.lga], ["Zone", lot.zone], ["Area", `${lot.area_m2} m²`]].map(([k, v]) => <div key={k}><dt className="font-mono text-[10.5px] uppercase tracking-[.18em] text-muted">{k}</dt><dd className="mt-1.5 break-words font-display text-lg font-medium">{v}</dd></div>)}
      </dl></Section>}

    <Section eyebrow="Inputs" title="Development type and plan" note="Choose what is being built, then upload an architect's PDF to align it to the lot. You can also run without a plan.">
      <div className="space-y-5"><DevelopmentTypeSelector value={dt} onChange={pick} /><PlanUpload projectId={id} developmentType={dt} /></div>
    </Section>
  </div>);
}
