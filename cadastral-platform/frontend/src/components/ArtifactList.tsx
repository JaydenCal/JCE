"use client";
import Link from "next/link";
import { useState } from "react";
import { missingAcks } from "@/lib/acks";
import { api, ApiError } from "@/lib/api";
import { auDate, formatBytes } from "@/lib/status";
import type { Artifact } from "@/lib/types";
import { useAcks } from "@/components/Acknowledgements";
import { DraftBadge } from "@/components/ui/Status";

const FILE_EXT: Record<string, string> = { PDF: "pdf", DXF: "dxf", ZIP: "zip", DOCX: "docx", JSON: "json" };

/** Download is held back until all nine acknowledgements are recorded. The API enforces the same gate (403 with a `missing` list). */
export function DownloadButton({ a, projectId }: { a: Artifact; projectId: string }) {
  const { present } = useAcks(projectId), missing = missingAcks(present), [busy, setBusy] = useState(false), [err, setErr] = useState("");
  async function go() {
    setBusy(true); setErr("");
    try { const blob = await api.download(a.id), url = URL.createObjectURL(blob), el = document.createElement("a");
      el.href = url; el.download = `${a.name.toLowerCase().replace(/\W+/g, "-")}.${FILE_EXT[a.format] ?? a.format.toLowerCase()}`; el.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
    catch (e) { const m = e instanceof ApiError && Array.isArray(e.extra.missing) ? `${e.extra.missing.length} acknowledgement(s) still missing.` : e instanceof ApiError && e.status === 404 ? "This file cannot be downloaded yet. The download route is not available." : (e as Error).message; setErr(m); }
    finally { setBusy(false); }
  }
  if (a.status !== "ready") return <span className="st-muted">{a.status === "pending" ? "Not yet produced" : "Unavailable"}</span>;
  return (<div className="flex flex-col items-end gap-1">
    {missing.length > 0 ? <Link href={`/projects/${projectId}/download`} className="btn-ghost !py-1.5 !text-xs" title={`${missing.length} of 9 acknowledgements missing`}>Acknowledge to download</Link>
      : <button className="btn-primary !py-1.5 !text-xs" onClick={go} disabled={busy}>{busy ? "Preparing..." : `Download ${a.format}`}</button>}
    {err && <p role="alert" className="max-w-[16rem] text-right text-xs text-danger">{err}</p>}
  </div>);
}

export function ArtifactList({ items, projectId }: { items: Artifact[]; projectId: string }) {
  return (<ul className="divide-y divide-line border-y border-ink/30 bg-surface">{items.map((a) => (
    <li key={a.id} className="flex flex-wrap items-center justify-between gap-4 p-4">
      <div className="min-w-0"><p className="font-medium">{a.name} <span className="font-mono text-xs text-muted">{a.format}</span></p>
        <p className="mt-1 font-mono text-[11px] text-muted">{[a.pages && `${a.pages} page${a.pages > 1 ? "s" : ""}`, formatBytes(a.bytes), a.produced_at && `produced ${auDate(a.produced_at)}`].filter(Boolean).join(" · ") || a.note}</p></div>
      <div className="flex items-center gap-3"><DraftBadge /><DownloadButton a={a} projectId={projectId} /></div>
    </li>))}</ul>);
}

/** Page thumbnails come from GET /artifacts/{id}/pages/{n}.png (proposed). Until it exists we draw an honest placeholder. */
export function PageThumb({ artifactId, n, label }: { artifactId: string; n: number; label: string }) {
  const [bad, setBad] = useState(false);
  return (<figure className="m-0"><div className="aspect-[1.414] overflow-hidden border border-ink/30 bg-white">
    {bad ? <div className="hatch grid h-full place-items-center p-3 text-center"><span className="font-mono text-[11px] uppercase tracking-wider text-muted">Preview not available yet</span></div>
      : <img src={api.pageImageUrl(artifactId, n)} alt={`Page ${n}: ${label}`} loading="lazy" className="h-full w-full object-contain" onError={() => setBad(true)} />}
  </div><figcaption className="mt-1.5 font-mono text-[10.5px] text-muted">{label}</figcaption></figure>);
}
