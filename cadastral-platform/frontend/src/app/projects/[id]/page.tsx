"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { api, DEFAULT_DEVELOPMENT_TYPE, type DevelopmentType, type Project, type ProjectResults } from "@/lib/api";
import { PlanUpload } from "@/components/PlanUpload";
import { Results } from "@/components/Results";
import { DevelopmentTypeSelector, loadDevelopmentType, saveDevelopmentType } from "@/components/DevelopmentTypeSelector";
import { EngineerEnquiryButton } from "@/components/enquiry/EngineerEnquiryButton";
import { Acknowledgements, ExportPanel, useAcks } from "@/components/Acknowledgements";
export default function Workspace({ params }: { params: { id: string } }) {
  const { id } = params, [p, setP] = useState<Project>(), [r, setR] = useState<ProjectResults>(), [err, setErr] = useState(""), { present, save } = useAcks(id), [dt, setDt] = useState<DevelopmentType>(DEFAULT_DEVELOPMENT_TYPE);
  useEffect(() => setDt(loadDevelopmentType(id)), [id]);
  const pickDt = (v: DevelopmentType) => { setDt(v); saveDevelopmentType(id, v); };
  useEffect(() => { api.project(id).then(setP).catch((e) => setErr(e.message)); api.results(id).then(setR).catch((e) => setErr(e.message)); }, [id]);
  return (<div className="space-y-10 py-12">
    <div className="flex flex-wrap items-end justify-between gap-4"><div><Link href="/projects" className="text-sm text-muted">&larr; Projects</Link><h1 className="mt-2 text-3xl font-display font-medium">{p?.title ?? "Project"}</h1></div>
      <div className="flex flex-wrap gap-3"><EngineerEnquiryButton projectId={id} context="project" className="inline-flex items-center rounded-md border border-brand-strong px-4 py-2.5 text-sm font-semibold text-gold transition-colors hover:bg-brand-strong hover:text-brand-fg">Talk to an engineer</EngineerEnquiryButton><Link href={`/projects/${id}/viewer`} className="btn-ghost">Open 3D viewer</Link></div></div>
    {err && <p role="alert" className="text-danger">{err}</p>}
    <section><h2 className="mb-4 font-display text-2xl font-medium">1. Development type and plan</h2><div className="space-y-5"><DevelopmentTypeSelector value={dt} onChange={pickDt} /><PlanUpload projectId={id} developmentType={dt} /></div></section>
    <section><h2 className="mb-4 font-display text-2xl font-medium">2. Results</h2>{r ? <Results r={r} /> : <p className="text-muted">Loading...</p>}
      <p className="mt-5 text-sm text-muted">Need an engineer to certify or design it? <EngineerEnquiryButton projectId={id} context="results" className="font-medium text-gold underline underline-offset-4">Talk to an engineer</EngineerEnquiryButton></p></section>
    <section><h2 className="mb-4 font-display text-2xl font-medium">3. Acknowledge and export</h2>
      <div className="grid gap-6 lg:grid-cols-[2fr_1fr]"><Acknowledgements projectId={id} present={present} onChange={save} /><div className="lg:sticky lg:top-24 lg:self-start"><ExportPanel projectId={id} present={present} /></div></div></section>
  </div>);
}
