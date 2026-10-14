"use client";
import Link from "next/link";
import { api } from "@/lib/api";
import { useRemote } from "@/lib/useRemote";
import { auDate } from "@/lib/status";
import { RunTag, SampleBanner } from "@/components/ui/Status";
export default function Activity({ params }: { params: { id: string } }) {
  const ev = useRemote(() => api.activity(params.id), [params.id]), runs = useRemote(() => api.runs(params.id), [params.id]);
  return (<div>
    {(ev.sample || runs.sample) && <SampleBanner what="Activity" />}
    <p className="h-eyebrow">Activity</p><h2 className="mt-2 font-display text-3xl font-medium">Runs and acknowledgements</h2>
    <h3 className="mt-8 font-mono text-[11px] uppercase tracking-[.2em] text-gold">Runs</h3>
    <ul className="mt-3 divide-y divide-line border-y border-ink/30 bg-surface">{runs.data?.map((r) => <li key={r.run_id} className="flex flex-wrap items-center justify-between gap-3 p-4 text-sm"><span>{r.label ?? "Run"} <span className="font-mono text-xs text-muted">{auDate(r.started_at)}</span></span><span className="flex items-center gap-4"><RunTag s={r.status} /><Link href={`/projects/${params.id}/runs/${r.run_id}`} className="font-medium text-gold underline underline-offset-4">View</Link></span></li>)}</ul>
    {runs.data?.length === 0 && <p className="mt-3 text-muted">No runs yet.</p>}
    <h3 className="mt-10 font-mono text-[11px] uppercase tracking-[.2em] text-gold">History</h3>
    <ul className="mt-3 divide-y divide-line border-y border-ink/30 bg-surface">{ev.data?.map((e) => <li key={e.at + e.text} className="flex gap-4 p-4 text-sm"><span className="w-24 shrink-0 font-mono text-xs text-muted">{auDate(e.at)}</span><span>{e.text}</span></li>)}</ul>
    {ev.data?.length === 0 && <p className="mt-3 text-muted">Nothing yet.</p>}
  </div>);
}
