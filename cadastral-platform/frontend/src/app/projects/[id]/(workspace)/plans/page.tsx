"use client";
import { api } from "@/lib/api";
import { useRemote } from "@/lib/useRemote";
import { SAMPLE_SHEETS, SHEET_STATUS } from "@/lib/sample";
import { ArtifactList, PageThumb } from "@/components/ArtifactList";
import { SampleBanner } from "@/components/ui/Status";

export default function Plans({ params }: { params: { id: string } }) {
  const { data, sample, error, loading } = useRemote(() => api.artifacts(params.id), [params.id]);
  const plan = data?.find((a) => a.kind === "planset_pdf"), items = data?.filter((a) => a.kind.startsWith("planset") || a.kind.startsWith("esc")) ?? [];
  return (
    <div>
      {sample && <SampleBanner what="The plan set" />}
      <p className="h-eyebrow">Civil plan set</p>
      <h2 className="mt-2 font-display text-3xl font-medium">Twelve sheets, drawn from the lot</h2>
      <p className="mt-3 max-w-3xl text-sm leading-relaxed text-muted">Every sheet reads <b className="text-ink">{SHEET_STATUS}</b>. The CHECKED and APPROVED fields are blank on purpose: nobody has signed these plans. A registered surveyor and engineer must check them on a real job.</p>
      {error && <p role="alert" className="mt-4 text-danger">{error}</p>}
      {loading && !data && <p className="mt-6 text-muted">Loading...</p>}
      {data && <div className="mt-6"><ArtifactList items={items} projectId={params.id} /></div>}
      <h3 className="mt-12 font-mono text-[11px] uppercase tracking-[.2em] text-gold">Sheet index</h3>
      <ol className="mt-4 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">{SAMPLE_SHEETS.map((s, i) => <li key={s.code}>{plan ? <PageThumb artifactId={plan.id} n={i + 1} label={`${s.code} ${s.title}`} /> : <div className="hatch aspect-[1.414] border border-ink/30 p-3"><span className="font-mono text-[11px] text-muted">{s.code} {s.title}</span></div>}</li>)}</ol>
      <p className="mt-6 max-w-3xl text-xs leading-relaxed text-muted">Sheets built on public terrain data (a 5 m grid) are labelled &ldquo;indicative, detail survey required&rdquo;. A sheet with data the platform does not have shows a DATA NOT AVAILABLE panel instead of an estimate.</p>
    </div>
  );
}
