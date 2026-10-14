"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { api, USE_MOCK, type Project } from "@/lib/api";
import { auDate } from "@/lib/status";
import { SampleBanner } from "@/components/ui/Status";
export default function Projects() {
  const [ps, setPs] = useState<Project[] | null>(null), [err, setErr] = useState(""), [sample, setSample] = useState(USE_MOCK);
  useEffect(() => { api.projects().then((p) => { setPs(p); if (p.some((x) => x.project_id === "11111111-1111-4111-8111-111111111111")) setSample(true); }).catch((e) => setErr(e.message)); }, []);
  return (<div className="py-12">
    <div className="flex flex-wrap items-end justify-between gap-4"><div><p className="h-eyebrow">Workspace</p><h1 className="mt-2 font-display text-4xl font-medium">Projects</h1></div><Link href="/projects/new" className="btn-primary">New project</Link></div>
    {sample && <div className="mt-6"><SampleBanner what="The project list" /></div>}
    {err && <p role="alert" className="mt-4 text-danger">{err}</p>}
    <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
      {ps?.map((p) => <Link key={p.project_id} href={`/projects/${p.project_id}`} className="block border border-ink/30 bg-surface p-5 transition-colors hover:border-ink">
        <p className="font-mono text-xs text-gold">{p.jurisdiction ?? ""} {p.lotplan ?? ""}</p><h3 className="mt-2 font-display text-xl font-medium">{p.title}</h3>
        <p className="mt-4 font-mono text-[11px] text-muted">Updated {auDate(p.updated_at)}</p></Link>)}
      {ps === null && !err && <div className="border border-line p-5 text-sm text-muted">Loading...</div>}
      {ps?.length === 0 && <div className="hatch border border-ink/30 p-6 text-sm sm:col-span-2 lg:col-span-3"><p className="font-medium">No projects yet.</p><p className="mt-1 text-muted">Start from a lot to produce plans and an application pack.</p></div>}
    </div></div>);
}
