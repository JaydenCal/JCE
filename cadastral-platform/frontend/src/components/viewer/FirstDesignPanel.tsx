'use client';
/**
 * Design tab, stage 10: "Design for me" and the proposal checklist. The server builds prepared options from the layout the client gave (placed buildings, terrain, verified
 * services, rules); a model (or the rules) chooses among them; the result is one batch applied as ONE undo step. Every number shown came from a server engine. The model never
 * writes a number. Each proposal is accepted, edited or rejected here, and its checks are asked for again after every change.
 */
import type { DesignController } from '@/lib/site/designController';
import { RUNNING_NOTE, type FdState } from '@/lib/site/firstDesignSession';
import { RULES_LABEL, dependents, type FdProposal } from '@/lib/site/firstDesign';
import type { SiteDesign } from '@/lib/site/types';

const usd = (v: number) => `${v < 0.01 ? v.toFixed(4) : v.toFixed(2)} USD`;
const badgeFor = (s: string) => (s === 'FAIL' ? 'sev-blocking' : s === 'NOT EVALUATED' || s === 'ACTION REQUIRED' ? 'sev-warning' : 'sev-info');

function EstimateBox({ fd }: { fd: FdState }) {
  const a = fd.estimate; if (!a) return null;
  const e = a.estimate;
  return (
    <div className="note" role="status" aria-label="Estimate">
      {e.uses_ai ? (
        <>
          <div><b>ESTIMATE BEFORE ANYTHING RUNS</b> · MODEL {a.model.toUpperCase()}</div>
          <div>{e.calls} MODEL CALL(S) EXPECTED, UP TO {e.max_calls} · ABOUT {e.input_tokens} TOKENS IN AND {e.output_tokens} OUT · {usd(e.cost_usd)} EXPECTED, {usd(e.max_cost_usd)} AT MOST</div>
          <div>SPENT TODAY {usd(a.spend.day_usd)} OF {usd(a.spend.day_cap_usd)} · THIS MONTH {usd(a.spend.month_usd)} OF {usd(a.spend.month_cap_usd)}</div>
          {e.requires_confirm && <div role="alert"><b>THIS IS ABOVE THE CONFIRM LEVEL OF {usd(e.confirm_usd)}. CONFIRM TO RUN IT.</b></div>}
        </>
      ) : <div>NO MODEL CALL WILL BE MADE AND NOTHING IS SPENT. {e.reason}</div>}
      <div>{a.sets.filter((s) => s.candidates > 0).length} OF {a.sets.length} DECISIONS HAVE OPTIONS{a.sets.some((s) => s.skipped) ? ': ' + a.sets.filter((s) => s.skipped).map((s) => `${s.title}: ${s.skipped}`).join('; ') : ''}</div>
    </div>
  );
}

function Checks({ ctl, p }: { ctl: DesignController; p: FdProposal }) {
  const v = ctl.firstDesign.view(p.id);
  if (!v) return null;
  const rows = v.checks.filter((c) => c.status !== 'PASS' && c.status !== 'NOT APPLICABLE').slice(0, 12);
  const passes = v.checks.filter((c) => c.status === 'PASS').length;
  const own = p.checks.filter((c) => c.code.startsWith('AI_'));
  return (
    <div>
      <div className="note">
        CHECKS NOW: {v.state === 'live' ? 'CURRENT' : v.state === 'pending' ? 'CHECKING WITH THE SERVER…' : v.state === 'stale' ? 'OUT OF DATE, WAITING FOR THE SERVER' : 'NOT AVAILABLE'}
        {v.state !== 'none' ? ` · ${v.blocking} BLOCKING · ${v.warning} WARNING · ${passes} PASS` : ''}
      </div>
      <ul className="dz-checks">
        {rows.map((c) => <li key={c.id}><span className={'badge ' + badgeFor(c.status)}>{c.status}</span> {c.title}: {c.message}</li>)}
        {own.map((c) => <li key={c.id}><span className={'badge ' + badgeFor(c.status)}>{c.status}</span> WHEN PROPOSED: {c.message}</li>)}
      </ul>
    </div>
  );
}

function Current({ fd, ctl, p, locked }: { fd: FdState; ctl: DesignController; p: FdProposal; locked: boolean }) {
  const it = fd.items.find((i) => i.id === p.id)!;
  const all = fd.result?.proposals ?? [];
  const dep = dependents(p, all);
  return (
    <div className="dz-prop" aria-label={`Proposal ${p.title}`}>
      <div><b>{p.title}</b> · OPTION {p.candidate_id} · <span className={'badge ' + (it.status === 'accepted' ? 'basis-user' : 'basis-platform_default')}>{it.status.toUpperCase()}</span></div>
      <div className="note">{p.selected_by}{p.flags.length ? ` · ${p.flags.join(', ')}` : ''}</div>
      <div>{p.summary}</div>
      <div className="note">WHY: {p.reason}</div>
      <Checks ctl={ctl} p={p} />
      {p.required_inputs.length > 0 && <details><summary>STILL NOT SET, FOR YOU TO ENTER ({p.required_inputs.length})</summary><ul>{p.required_inputs.map((r) => <li key={r}>{r}</li>)}</ul></details>}
      {p.alternatives.length > 0 && <details><summary>OTHER OPTIONS ({p.alternatives.length})</summary><ul>{p.alternatives.map((a) => <li key={a.id}>OPTION {a.id}{a.blocked ? ' (BLOCKED)' : ''}: {a.summary}</li>)}</ul></details>}
      {dep.length > 0 && <div className="note">OTHER PROPOSALS REFER TO THIS ONE: {dep.map((q) => q.title).join(', ')}</div>}
      {it.notice && <div className="note" role="alert">{it.notice}</div>}
      <fieldset className="dz-fs" disabled={locked}>
        <div className="btns">
          <button className="view" disabled={it.status === 'accepted'} onClick={() => ctl.firstDesign.accept(p.id)}>Accept</button>
          <button className="view" onClick={() => ctl.firstDesign.edit(p.id)}>Edit</button>
          <button className="view" onClick={() => ctl.firstDesign.reject(p.id)}>Reject</button>
        </div>
      </fieldset>
    </div>
  );
}

function Review({ fd, ctl, locked }: { fd: FdState; ctl: DesignController; locked: boolean }) {
  const res = fd.result!;
  const shown = res.proposals.filter((p) => fd.items.find((i) => i.id === p.id)?.status !== 'rejected');
  const hidden = res.proposals.filter((p) => fd.items.find((i) => i.id === p.id)?.status === 'rejected');
  const cur = res.proposals[fd.index];
  const curShown = cur && fd.items.find((i) => i.id === cur.id)?.status !== 'rejected' ? cur : shown[0];
  const pos = curShown ? shown.findIndex((p) => p.id === curShown.id) : -1;
  return (
    <div aria-label="Proposals">
      <div className="note"><b>{res.selected_by}</b> · {res.proposals.length} PROPOSAL(S) · {res.usage.calls} MODEL CALL(S){res.usage.calls ? ` · ${usd(res.usage.cost_usd)}` : ''}</div>
      <div className="note">{res.label}</div>
      {fd.applied && <div className="note">THE WHOLE BATCH IS ONE UNDO STEP: use Undo to take it all back. Each proposal below can also be rejected on its own.</div>}
      {res.ai_errors.length > 0 && <div className="note" role="alert">THE AI COULD NOT BE USED FOR PART OF THIS RUN, SO THE RULES DECIDED: {res.ai_errors.join('; ')}</div>}
      {res.notes.map((n) => <div key={n} className="note">{n}</div>)}
      {fd.message && <div className="note" role="status">{fd.message}</div>}
      {shown.length > 0 && (
        <>
          <div className="btns">
            <button className="view" disabled={locked} onClick={() => ctl.firstDesign.acceptAllPassing()}>Accept all passing</button>
            <button className="view" disabled={pos <= 0} onClick={() => curShown && ctl.firstDesign.go(res.proposals.findIndex((p) => p.id === shown[pos - 1].id))}>Previous</button>
            <button className="view" disabled={pos < 0 || pos >= shown.length - 1} onClick={() => curShown && ctl.firstDesign.go(res.proposals.findIndex((p) => p.id === shown[pos + 1].id))}>Next</button>
          </div>
          <div className="note">PROPOSAL {pos + 1} OF {shown.length}</div>
          <ol className="dz-steps">
            {shown.map((p) => {
              const st = fd.items.find((i) => i.id === p.id)?.status ?? 'pending';
              return <li key={p.id}><button className={'chip' + (curShown?.id === p.id ? ' on' : '')} aria-pressed={curShown?.id === p.id} onClick={() => ctl.firstDesign.go(res.proposals.findIndex((x) => x.id === p.id))}>{p.title} · {st.toUpperCase()}</button></li>;
            })}
          </ol>
          {curShown && <Current fd={fd} ctl={ctl} p={curShown} locked={locked} />}
        </>
      )}
      {hidden.length > 0 && (
        <details><summary>REJECTED, HIDDEN ({hidden.length})</summary>
          <ul>{hidden.map((p) => <li key={p.id}>{p.title} <button className="view" disabled={locked} onClick={() => ctl.firstDesign.restore(p.id)}>Restore</button></li>)}</ul>
        </details>
      )}
      {res.skipped.length > 0 && (
        <details><summary>NOT PROPOSED ({res.skipped.length})</summary>
          <ul>{res.skipped.map((s) => <li key={s.set_id}>{s.title}: {s.reason}{s.required_inputs.length ? ` · NEEDS: ${s.required_inputs.join(', ')}` : ''}</li>)}</ul>
        </details>
      )}
      {res.required_inputs.length > 0 && <details><summary>EVERYTHING STILL NOT SET ({res.required_inputs.length})</summary><ul>{res.required_inputs.map((r) => <li key={r}>{r}</li>)}</ul></details>}
      <div className="note">WHOLE DESIGN CHECK AT THE TIME OF THE RUN: {res.final_checks.blocking} BLOCKING, {res.final_checks.warning} WARNING OF {res.final_checks.total}</div>
      <div className="btns"><button className="view" onClick={() => ctl.firstDesign.close()}>Close the checklist</button></div>
    </div>
  );
}

export function FirstDesignSection({ fd, ctl, doc, locked }: { fd: FdState; ctl: DesignController; doc: SiteDesign; locked: boolean }) {
  const busy = fd.phase === 'estimating' || fd.phase === 'running';
  const empty = !doc.objects.some((o) => o.type === 'building');
  return (
    <section aria-label="AI first design">
      <h2>Design for me</h2>
      <div className="note">Builds a first pass from the buildings, terrain, verified services and rules you have already given. Every figure comes from the engines; the AI only chooses between prepared options. Sizes, widths, levels and surfaces stay NOT SET for you. Buildings are never created or moved.</div>
      {fd.phase === 'no_server' && <div className="note" role="note">{fd.error}</div>}
      {fd.phase !== 'no_server' && fd.phase !== 'review' && (
        <fieldset className="dz-fs" disabled={locked || busy}>
          <label className="row dz-row"><input type="checkbox" checked={fd.useAi} onChange={(e) => ctl.firstDesign.setUseAi(e.target.checked)} /> Let the AI choose between prepared options (otherwise the rules choose)</label>
          {empty && <div className="note">PLACE A BUILDING FIRST: there is nothing to design around yet.</div>}
          <div className="btns">
            {(fd.phase === 'idle' || fd.phase === 'error' || fd.phase === 'estimating') && <button className="view" disabled={busy} onClick={() => { void ctl.firstDesign.estimate(); }}>{fd.phase === 'estimating' ? 'Estimating…' : 'Design for me'}</button>}
            {fd.phase === 'ready' && <button className="view" onClick={() => { void ctl.firstDesign.run(false); }}>{fd.estimate?.estimate.requires_confirm ? 'Review the cost' : 'Run it'}</button>}
            {fd.phase === 'confirm' && <button className="view" onClick={() => { void ctl.firstDesign.run(true); }}>Confirm and run</button>}
            {(fd.phase === 'ready' || fd.phase === 'confirm') && <button className="view" onClick={() => ctl.firstDesign.close()}>Cancel</button>}
          </div>
        </fieldset>
      )}
      {(fd.phase === 'ready' || fd.phase === 'confirm' || fd.phase === 'running') && <EstimateBox fd={fd} />}
      {fd.phase === 'running' && <div className="note" role="status">{RUNNING_NOTE}. THE DESIGN IS READ ONLY UNTIL THE ANSWER ARRIVES.</div>}
      {fd.phase === 'error' && (
        <div role="alert" className="note" style={{ color: 'var(--bad)' }}>
          {fd.error}
          {(fd.errorCode === 'AI_PAUSED' || fd.errorCode === 'AI_CAP_WOULD_BE_EXCEEDED' || fd.errorCode === 'RATE_LIMITED') && (
            <div className="btns"><button className="view" onClick={() => { ctl.firstDesign.setUseAi(false); void ctl.firstDesign.estimate(); }}>Design by the rules instead</button></div>
          )}
        </div>
      )}
      {fd.phase === 'confirm' && fd.error && <div className="note" role="alert">{fd.error}</div>}
      {fd.phase === 'review' && fd.result && <Review fd={fd} ctl={ctl} locked={locked} />}
      <div className="note">{RULES_LABEL} marks a choice made without the AI.</div>
    </section>
  );
}
