"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { api, ApiError, type RunDetail } from "@/lib/api";
import { isTerminal, stageStates, type StageState } from "@/lib/runs";
import { RunTag } from "@/components/ui/Status";

const STATE_WORDS: Record<StageState, string> = { waiting: "Waiting", running: "Running", done: "Done", failed: "Failed", held: "Held at export gate" };

export default function RunProgress({ params }: { params: { id: string; runId: string } }) {
  const { id, runId } = params, [run, setRun] = useState<RunDetail>(), [err, setErr] = useState(""), [busy, setBusy] = useState(false);
  const load = useCallback(() => api.run(runId).then((r) => { setRun(r); setErr(""); return r; }, (e) => { setErr(e instanceof ApiError && e.code === "RUN_NOT_FOUND" ? "This run was not found." : e instanceof TypeError ? "The API cannot be reached." : (e as Error).message); return undefined; }), [runId]);
  useEffect(() => { let on = true, t: ReturnType<typeof setTimeout>; const tick = async () => { const r = await load(); if (on && (!r || !isTerminal(r.status))) t = setTimeout(tick, 2000); }; tick(); return () => { on = false; clearTimeout(t); }; }, [load]);
  async function cancel() { setBusy(true); try { await api.cancelRun(runId); await load(); } catch (e) { setErr(e instanceof ApiError && e.code === "INVALID_RUN_STATE" ? "This run has already finished." : (e as Error).message); } finally { setBusy(false); } }
  const stages = run ? stageStates(run.invocations, run.status) : [];
  return (<div>
    <p className="h-eyebrow">Run progress</p>
    <div className="mt-2 flex flex-wrap items-center gap-4"><h2 className="font-display text-3xl font-medium">Building your outputs</h2>{run && <RunTag s={run.status} />}</div>
    {err && <p role="alert" className="mt-4 text-danger">{err}</p>}
    {!run && !err && <p className="mt-6 text-muted">Loading...</p>}
    {run && <>
      <ol className="mt-8 border-t border-ink/30">{stages.map((s) => (
        <li key={s.key} className="grid gap-2 border-b border-ink/20 py-4 sm:grid-cols-[3rem_1fr_auto] sm:items-baseline">
          <span className="font-mono text-sm text-gold">{s.key}</span>
          <div><p className="font-display text-lg font-medium">{s.title}</p><p className="mt-0.5 text-sm text-muted">{s.detail}</p>
            {s.errors.map((e) => <p key={e.invocation_id} role="alert" className="mt-2 border border-danger/50 bg-danger/5 p-2 text-sm text-danger">{e.agent} failed{e.error_code ? ` (${e.error_code})` : ""}{e.error_detail ? `: ${e.error_detail}` : ""}</p>)}</div>
          <span className={s.state === "done" ? "st-ok" : s.state === "failed" ? "st-bad" : s.state === "running" ? "st-info" : s.state === "held" ? "st-warn" : "st-muted"}>{STATE_WORDS[s.state]}</span>
        </li>))}</ol>
      {run.status === "waiting_user" && <p role="status" className="mt-6 border border-warn/60 bg-warn/5 p-4 text-sm"><b>The run needs your input.</b> {run.alignment?.messages?.join(" ") || "Check the plan scale on the Overview tab, then continue."}</p>}
      {run.status === "blocked_by_gate" && <p role="status" className="mt-6 border border-warn/60 bg-warn/5 p-4 text-sm"><b>Outputs are held.</b> Record the nine acknowledgements to release them. <Link className="font-medium text-gold underline underline-offset-4" href={`/projects/${id}/download`}>Go to acknowledgements</Link></p>}
      {run.status === "failed" && <p className="mt-6 text-sm text-muted">Stages that finished before the failure keep their results.</p>}
      <div className="mt-8 flex flex-wrap gap-3">
        {!isTerminal(run.status) && <button className="btn-ghost" onClick={cancel} disabled={busy}>{busy ? "Cancelling..." : "Cancel run"}</button>}
        {run.status === "succeeded" && <Link href={`/projects/${id}`} className="btn-primary">View results</Link>}
      </div></>}
  </div>);
}
