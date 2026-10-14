"use client";
import { api } from "@/lib/api";
import { useRemote } from "@/lib/useRemote";
import { ArtifactList } from "@/components/ArtifactList";
import { SampleBanner } from "@/components/ui/Status";
const CONTENTS = ["Numbered index and cover sheet", "Lodgement checklist", "Cited Planning Portal guidance", "Statement of Environmental Effects (DOCX and PDF, DRAFT watermark)", "manifest.json with a sha256 for every file"];
export default function Pack({ params }: { params: { id: string } }) {
  const { data, sample, error, loading } = useRemote(() => api.artifacts(params.id), [params.id]);
  const items = data?.filter((a) => a.kind === "application_pack_zip" || a.kind.startsWith("soee")) ?? [];
  return (<div>
    {sample && <SampleBanner what="The application pack" />}
    <p className="h-eyebrow">Application pack</p><h2 className="mt-2 font-display text-3xl font-medium">Assembled for the NSW Planning Portal</h2>
    <p className="mt-3 max-w-3xl text-sm leading-relaxed text-muted">The pack gathers the documents for lodgement. <b className="text-ink">JCE Site Planner does not lodge anything for you.</b> Lines the platform cannot know are marked TO BE COMPLETED, and a planner must check the pack before it is lodged.</p>
    {error && <p role="alert" className="mt-4 text-danger">{error}</p>}
    {loading && !data && <p className="mt-6 text-muted">Loading...</p>}
    {data && <div className="mt-6">{items.length ? <ArtifactList items={items} projectId={params.id} /> : <p className="hatch border border-ink/30 p-4 text-sm">The pack has not been produced yet.</p>}</div>}
    <h3 className="mt-12 font-mono text-[11px] uppercase tracking-[.2em] text-gold">What the pack contains</h3>
    <ul className="mt-4 grid gap-2 sm:grid-cols-2">{CONTENTS.map((c) => <li key={c} className="border border-line bg-surface px-4 py-3 text-sm">{c}</li>)}</ul>
  </div>);
}
