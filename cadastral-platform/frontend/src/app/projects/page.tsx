"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { api, type Project } from "@/lib/api";
export default function Projects() {
  const [ps, setPs] = useState<Project[] | null>(null); const [err, setErr] = useState("");
  useEffect(() => { api.projects().then(setPs).catch((e) => setErr(e.message)); }, []);
  return (<div className="py-12">
    <p className="h-eyebrow">Workspace</p><h1 className="mt-2 text-4xl font-display font-medium">Projects</h1>
    {err && <p className="mt-4 text-danger">{err}</p>}
    <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
      {ps?.map((p) => <Link key={p.project_id} href={`/projects/${p.project_id}`} className="card transition hover:-translate-y-0.5">
        <div className="text-xs font-semibold text-gold">{p.jurisdiction ?? ""} {p.lotplan ?? ""}</div><h3 className="mt-2 font-bold">{p.title}</h3>
        <p className="mt-3 text-xs text-muted">Updated {p.updated_at ? new Date(p.updated_at).toLocaleDateString("en-AU") : "n/a"}</p></Link>)}
      {ps === null && !err && <div className="card text-sm text-muted">Loading...</div>}
    </div></div>);
}
