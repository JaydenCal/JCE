"use client";
import { useEffect, useState } from "react";
import { ACK_KINDS, missingAcks, type AckKind } from "@/lib/acks";
import { api } from "@/lib/api";
const key = (p: string) => "acks:" + p;
export function useAcks(projectId: string) {
  const [present, setPresent] = useState<string[]>([]);
  useEffect(() => { try { setPresent(JSON.parse(localStorage.getItem(key(projectId)) || "[]")); } catch { /* */ } }, [projectId]);
  const save = (p: string[]) => { setPresent(p); try { localStorage.setItem(key(projectId), JSON.stringify(p)); } catch { /* */ } };
  return { present, save };
}
export function Acknowledgements({ projectId, present, onChange }: { projectId: string; present: string[]; onChange: (p: string[]) => void }) {
  const [err, setErr] = useState("");
  async function tick(kind: AckKind) {
    setErr("");
    try { const r = await api.acknowledge(projectId, [kind]); onChange(missingAcks([]).filter((k) => !r.export_gate_missing.includes(k))); }
    catch (e) { setErr((e as Error).message); }
  }
  return (<div className="space-y-3">{ACK_KINDS.map((a) => { const done = present.includes(a.kind);
    return (<label key={a.kind} className={`flex gap-3 rounded-xl border p-4 text-sm ${done ? "border-brand/50 bg-brand-soft/40" : "border-line"}`}>
      <input type="checkbox" className="mt-1 h-4 w-4 shrink-0 accent-[rgb(var(--brand))]" checked={done} disabled={done} onChange={() => tick(a.kind)} />
      <span><span className="mr-2 font-bold text-brand">{a.id}</span>{a.text}</span></label>); })}
    {err && <p role="alert" className="text-sm text-danger">{err}</p>}</div>);
}
export function ExportPanel({ projectId, present }: { projectId: string; present: string[] }) {
  const missing = missingAcks(present), [busy, setBusy] = useState(false), [err, setErr] = useState("");
  async function go() {
    setBusy(true); setErr("");
    try { const r = await api.exportFiles(projectId);
      for (const [u, n] of [[r.dxf_url, "site-plan.dxf"], [r.pdf_url, "site-plan.pdf"]] as const) if (u) { const a = document.createElement("a"); a.href = u; a.download = n; a.click(); } }
    catch (e) { setErr((e as Error).message); } finally { setBusy(false); } }
  return (<div className="card">
    <h3 className="font-bold">Export DXF and PDF</h3>
    {missing.length === 0 ? <p className="mt-2 text-sm text-ok">All 9 acknowledgements given.</p>
      : <div className="mt-2 text-sm"><p className="text-warn">{missing.length} of 9 acknowledgements missing:</p><ul className="mt-2 list-disc pl-5 text-muted" data-testid="missing">{ACK_KINDS.filter((a) => missing.includes(a.kind)).map((a) => <li key={a.kind}>{a.id} <code>{a.kind}</code></li>)}</ul></div>}
    <div className="mt-4 flex flex-wrap gap-3"><button className="btn-primary" disabled={missing.length > 0 || busy} onClick={go}>{busy ? "Preparing..." : "Export DXF + PDF"}</button></div>
    {err && <p role="alert" className="mt-2 text-sm text-danger">{err}</p>}</div>);
}
