"use client";
import { useEffect, useRef, useState } from "react";
import { api, TERMINAL, type AlignmentResult, type RunDetail } from "@/lib/api";
export const MAX_BYTES = 200 * 1024 * 1024;
export function checkFile(f: { name: string; size: number }): string | null {
  if (!/\.(pdf|dxf)$/i.test(f.name)) return "Only PDF or DXF files are accepted.";
  if (f.size > MAX_BYTES) return "File is larger than the 200 MB limit.";
  if (f.size === 0) return "File is empty."; return null;
}
export function AlignmentCard({ a, onScale }: { a: AlignmentResult; onScale: (n: number) => void }) {
  const [s, setS] = useState(""); const tone = a.outcome === "refused" ? "text-danger" : a.outcome === "needs_user_confirmation" ? "text-warn" : "text-ok";
  return (<div className="card"><h3 className="font-bold">Alignment result</h3>
    <dl className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
      {[["Scale", "1:" + a.scale_denominator_used], ["Source", a.scale_source.replace(/_/g, " ")], ["Confidence", (a.scale_confidence * 100).toFixed(0) + "%"], ["RMSE", a.rmse_m.toFixed(3) + " m"]].map(([k, v]) => <div key={k}><dt className="text-xs text-muted">{k}</dt><dd className="font-semibold">{v}</dd></div>)}
    </dl>
    <p className={`mt-3 text-sm font-semibold ${tone}`}>{a.outcome.replace(/_/g, " ")}</p>
    <ul className="mt-1 list-disc pl-5 text-sm text-muted">{a.messages.map((m, i) => <li key={i}>{m}</li>)}</ul>
    {a.outcome !== "accepted_unverified" && <form className="mt-4 flex flex-wrap items-end gap-3" onSubmit={(e) => { e.preventDefault(); const n = Number(s); if (n > 0) onScale(n); }}>
      <label className="text-sm">Confirm scale 1:<input value={s} onChange={(e) => setS(e.target.value)} inputMode="numeric" placeholder="200" className="ml-2 w-24 rounded-lg border border-line bg-bg px-3 py-1.5" /></label>
      <button className="btn-primary" disabled={!(Number(s) > 0)}>Re-run alignment</button></form>}
  </div>);
}
export function PlanUpload({ projectId }: { projectId: string }) {
  const [file, setFile] = useState<File | null>(null), [warranty, setW] = useState(false), [err, setErr] = useState(""), [pct, setPct] = useState(0), [busy, setBusy] = useState(false);
  const [upload, setUpload] = useState<string>(), [runId, setRunId] = useState<string>(), [run, setRun] = useState<RunDetail>(), [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const pick = (f?: File) => { if (!f) return; const e = checkFile(f); setErr(e ?? ""); setFile(e ? null : f); };
  useEffect(() => {
    if (!runId) return; let stop = false;
    const tick = async () => { try { const r = await api.run(runId); if (stop) return; setRun(r); if (!TERMINAL.includes(r.status)) setTimeout(tick, 2000); } catch (e) { setErr((e as Error).message); } };
    tick(); return () => { stop = true; };
  }, [runId]);
  async function go() {
    if (!file) return; setBusy(true); setErr(""); setPct(0);
    try { const r = await api.upload(projectId, file, warranty, setPct); setUpload(r.upload_id); setRunId(r.run_id); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }
  async function rerun(n: number) { if (!upload) return; try { setRun(undefined); setRunId((await api.createRun(projectId, upload, n)).run_id); } catch (e) { setErr((e as Error).message); } }
  return (<div className="space-y-5">
    <div className="card">
      <div onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)} onDrop={(e) => { e.preventDefault(); setOver(false); pick(e.dataTransfer.files[0]); }}
        onClick={() => input.current?.click()} role="button" tabIndex={0} onKeyDown={(e) => e.key === "Enter" && input.current?.click()}
        className={`cursor-pointer rounded-xl border-2 border-dashed p-10 text-center ${over ? "border-brand bg-brand-soft/40" : "border-line"}`}>
        <p className="font-semibold">{file ? file.name : "Drop a plan here, or click to browse"}</p><p className="mt-1 text-xs text-muted">PDF or DXF, up to 200 MB</p>
        <input ref={input} type="file" accept=".pdf,.dxf,application/pdf" hidden onChange={(e) => pick(e.target.files?.[0])} /></div>
      <label className="mt-4 flex gap-3 text-sm"><input type="checkbox" className="mt-1 accent-[rgb(var(--brand))]" checked={warranty} onChange={(e) => setW(e.target.checked)} />
        I warrant that I have all rights, licences and consents (including client and confidentiality consents) to upload this material and to allow the Operator and its service providers, including AI providers that may be located overseas, to process it.</label>
      {busy && <div className="mt-4 h-2 overflow-hidden rounded-full bg-subtle"><div className="h-full bg-brand transition-all" style={{ width: pct + "%" }} /></div>}
      {err && <p role="alert" className="mt-3 text-sm text-danger">{err}</p>}
      <button className="btn-primary mt-4" disabled={!file || !warranty || busy} onClick={go}>{busy ? `Uploading ${pct}%` : "Upload and align"}</button>
    </div>
    {runId && <div className="card"><h3 className="font-bold">Run status</h3>
      <p className="mt-2 text-sm">{run ? <><span className="font-semibold">{run.status}</span> <span className="text-muted">({run.invocations.length} agent steps)</span></> : "Waiting..."}</p>
      {run?.invocations.filter((i) => i.error_code).map((i) => <p key={i.invocation_id} className="mt-1 text-sm text-danger">{i.agent}: {i.error_code} {i.error_detail}</p>)}</div>}
    {run?.alignment && <AlignmentCard a={run.alignment} onScale={rerun} />}
  </div>);
}
