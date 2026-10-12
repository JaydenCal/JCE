"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { api, type Project, type ProjectResults } from "@/lib/api";
import { PlanUpload } from "@/components/PlanUpload";
import { Results } from "@/components/Results";
import { Acknowledgements, ExportPanel, useAcks } from "@/components/Acknowledgements";
export default function Workspace({ params }: { params: { id: string } }) {
  const { id } = params, [p, setP] = useState<Project>(), [r, setR] = useState<ProjectResults>(), [err, setErr] = useState(""), { present, save } = useAcks(id);
  useEffect(() => { api.project(id).then(setP).catch((e) => setErr(e.message)); api.results(id).then(setR).catch((e) => setErr(e.message)); }, [id]);
  return (<div className="space-y-10 py-12">
    <div className="flex flex-wrap items-end justify-between gap-4"><div><Link href="/projects" className="text-sm text-muted">&larr; Projects</Link><h1 className="mt-2 text-3xl font-extrabold">{p?.title ?? "Project"}</h1></div>
      <Link href={`/projects/${id}/viewer`} className="btn-ghost">Open 3D viewer</Link></div>
    {err && <p role="alert" className="text-danger">{err}</p>}
    <section><h2 className="mb-4 text-xl font-bold">1. Upload plan</h2><PlanUpload projectId={id} /></section>
    <section><h2 className="mb-4 text-xl font-bold">2. Results</h2>{r ? <Results r={r} /> : <p className="text-muted">Loading...</p>}</section>
    <section><h2 className="mb-4 text-xl font-bold">3. Acknowledge and export</h2>
      <div className="grid gap-6 lg:grid-cols-[2fr_1fr]"><Acknowledgements projectId={id} present={present} onChange={save} /><div className="lg:sticky lg:top-24 lg:self-start"><ExportPanel projectId={id} present={present} /></div></div></section>
  </div>);
}
