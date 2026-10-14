'use client';
/**
 * Design tab, stage 8: DBYD enquiries and plans. Plans and enquiries are PRIVATE to the project. The BYDA connection is a SANDBOX: the owner expects consent before
 * any commercial use. A real enquiry is lodged only after the user ticks a confirmation. The BYDA endpoints are UNCONFIRMED (the documentation could not be read).
 * Services read from a plan are DRAFTS: UNVERIFIED, INDICATIVE ONLY, with no owner, tolerance, expiry or depth reference unless the user gives them.
 */
import { useCallback, useEffect, useState } from 'react';
import type { DesignController } from '@/lib/site/designController';
import { listEnquiries, listPlans, lodgeEnquiry, parsePlan, resolveEnquiry, uploadPlan, type EnquiryRecord, type ParseResult, type PlanRecord } from '@/lib/site/dbydApi';
import { fmtDate } from '@/lib/site/services';
import { UNVERIFIED_LABEL } from '@/lib/site/types';

/** What the panel says about the BYDA connection. SANDBOX is stated only for the sandbox, and whether live calls are on is stated as it is (never guessed). */
export function dbydModeText(mode: string, live: boolean | null): string {
  const m = mode.toUpperCase();
  if (!m) return 'The BYDA connection state is NOT AVAILABLE until the server answers.';
  if (m === 'COMMERCIAL') return 'The BYDA connection is COMMERCIAL: an enquiry is a real, billable request to BYDA.';
  const calls = live === null ? '' : live ? ' Live calls to BYDA are ON (BYDA_ALLOW_LIVE), so an enquiry here is a real request.' : ' Live calls to BYDA are OFF: nothing is sent until BYDA_ALLOW_LIVE is set on the server.';
  return `The BYDA connection is in SANDBOX mode (${m}).${calls} Confirm consent with BYDA before commercial use.`;
}

export function DbydSection({ ctl, locked, plans, setPlans }: { ctl: DesignController; locked: boolean; plans: PlanRecord[]; setPlans: (p: PlanRecord[]) => void }) {
  const ep = ctl.endpoint;
  const [err, setErr] = useState(''), [busy, setBusy] = useState(false), [rows, setRows] = useState<EnquiryRecord[]>([]), [mode, setMode] = useState(''), [live, setLive] = useState<boolean | null>(null), [note, setNote] = useState('');
  const [jobs, setJobs] = useState<Record<string, string>>({});
  const [margin, setMargin] = useState(''), [desc, setDesc] = useState(''), [start, setStart] = useState(''), [end, setEnd] = useState(''), [confirm, setConfirm] = useState(false);
  const [meta, setMeta] = useState({ job_number: '', asset_owner: '', plan_date: '', plan_reference: '' });
  const [parse, setParse] = useState({ id: '', page: '1', scale: '', tol: '', expiry: '' }), [result, setResult] = useState<ParseResult | null>(null), [added, setAdded] = useState(false);

  const refresh = useCallback(async (remote = false) => {
    if (!ep) return;
    try {
      const [p, q] = await Promise.all([listPlans(ep), listEnquiries(ep, remote)]);
      setPlans(p.plans); setRows(q.enquiries); setMode(q.mode); setLive(typeof q.live_calls === 'boolean' ? q.live_calls : null); setNote(q.refresh_error ?? '');
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
  }, [ep, setPlans]);
  useEffect(() => { void refresh(false); }, [refresh]);

  const run = async (f: () => Promise<void>) => { setBusy(true); setErr(''); try { await f(); } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); } };
  const lodge = () => run(async () => {
    const m = Number(margin);
    if (!ep) throw new Error('NO SERVER: THIS VIEW HAS NO CONNECTION TO THE SERVER');
    if (margin.trim() === '' || !Number.isFinite(m) || m < 0) throw new Error('ENTER THE MARGIN AROUND THE LOT IN METRES (0 OR MORE)');
    if (!confirm) throw new Error('TICK THE CONFIRMATION: A REAL ENQUIRY WILL BE LODGED WITH BYDA');
    await lodgeEnquiry(ep, { confirm: true, margin_m: m, work_description: desc.trim() || null, start_date: start || null, end_date: end || null });
    setConfirm(false); await refresh(false);
  });
  const resolve = (ref: string, outcome: 'lodged' | 'not_lodged') => run(async () => {
    if (!ep) throw new Error('NO SERVER: THIS VIEW HAS NO CONNECTION TO THE SERVER');
    const job = (jobs[ref] ?? '').trim();
    if (outcome === 'lodged' && !job) throw new Error('ENTER THE JOB NUMBER SHOWN ON THE BYDA PORTAL');
    await resolveEnquiry(ep, ref, { outcome, job_number: outcome === 'lodged' ? job : null });
    await refresh(false);
  });
  const upload = (file: File | undefined) => run(async () => {
    if (!file || !ep) return;
    await uploadPlan(ep, file, Object.fromEntries(Object.entries(meta).filter(([, v]) => v)));
    await refresh(false);
  });
  const doParse = () => run(async () => {
    if (!ep || !parse.id) throw new Error('CHOOSE A PLAN');
    const page = Number(parse.page), scale = parse.scale.trim() === '' ? null : Number(parse.scale), tol = parse.tol.trim() === '' ? null : Number(parse.tol);
    if (!Number.isInteger(page) || page < 1) throw new Error('THE PAGE MUST BE A WHOLE NUMBER, 1 OR MORE');
    if ((scale !== null && !(scale > 0)) || (tol !== null && !(tol >= 0))) throw new Error('THE SCALE AND TOLERANCE MUST BE NUMBERS (SCALE ABOVE 0)');
    setAdded(false);
    setResult(await parsePlan(ep, parse.id, { page, scale_denominator: scale, tolerance_m: tol, plan_expiry_date: parse.expiry || null }));
  });
  const addDrafts = () => { if (!result) return; const e = ctl.addDbydDrafts(result.objects); if (e) setErr(e); else { setAdded(true); setErr(''); } };

  return (
    <section aria-label="DBYD services">
      <h2>DBYD services</h2>
      <div className="note">PLANS AND ENQUIRIES ARE PRIVATE TO THIS PROJECT. {dbydModeText(mode, live)} The BYDA endpoints are UNCONFIRMED until their documentation is checked.</div>
      {!ep && <div className="note">NO SERVER: DBYD plans and enquiries are not available on this page.</div>}
      <fieldset className="dz-fs" disabled={locked || !ep || busy}>
        <div className="note"><b>ENQUIRY</b></div>
        <div className="dz-param dz-wide"><label htmlFor="db-m">Margin (m)</label><input id="db-m" className="search" inputMode="decimal" placeholder="REQUIRED" value={margin} onChange={(e) => setMargin(e.target.value)} /></div>
        <div className="dz-param dz-wide"><label htmlFor="db-d">Work description</label><input id="db-d" className="search" placeholder="OPTIONAL" value={desc} onChange={(e) => setDesc(e.target.value)} /></div>
        <div className="dz-param dz-wide"><label htmlFor="db-s">Start date</label><input id="db-s" className="search" type="date" value={start} onChange={(e) => setStart(e.target.value)} /></div>
        <div className="dz-param dz-wide"><label htmlFor="db-e">End date</label><input id="db-e" className="search" type="date" value={end} onChange={(e) => setEnd(e.target.value)} /></div>
        <label className="note"><input type="checkbox" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} /> I confirm that a real DBYD enquiry for this lot is to be lodged with BYDA</label>
        <div className="btns"><button className="view" onClick={() => { void lodge(); }}>Lodge enquiry</button><button className="view" onClick={() => { void run(() => refresh(true)); }}>Refresh from BYDA</button></div>
        {note && <div className="note">REFRESH: {note}</div>}
        {rows.length > 0 && <table className="ck-table"><thead><tr><th>Job</th><th>Status</th><th>Lodged</th></tr></thead><tbody>
          {rows.map((r, i) => <tr key={String(r.client_ref ?? r.id ?? r.job_number ?? i)}><td>{String(r.job_number ?? r.id ?? '').toUpperCase() || 'NOT AVAILABLE'}</td><td>{String(r.status ?? 'NOT AVAILABLE').toUpperCase()}</td><td>{fmtDate(typeof r.lodged_at === 'string' ? r.lodged_at : '')}</td></tr>)}
        </tbody></table>}
        {rows.filter((r) => r.lodge_state === 'unknown' && r.client_ref).map((r) => {
          const ref = String(r.client_ref);
          return (
            <div key={ref} className="note" role="alert">
              <b>LODGEMENT OUTCOME UNKNOWN, CHECK BYDA PORTAL.</b> No new enquiry can be lodged for this project until you record what the portal shows.
              <div className="dz-param dz-wide"><label htmlFor={'rs-' + ref}>Job number on the portal</label><input id={'rs-' + ref} className="search" placeholder="ONLY IF LODGED" value={jobs[ref] ?? ''} onChange={(e) => setJobs({ ...jobs, [ref]: e.target.value })} /></div>
              <div className="btns"><button className="view" onClick={() => { void resolve(ref, 'lodged'); }}>It was lodged</button><button className="view" onClick={() => { void resolve(ref, 'not_lodged'); }}>It was not lodged</button></div>
            </div>
          );
        })}
        <div className="note" style={{ marginTop: 8 }}><b>PLANS</b> (PDF, DWF or DXF, up to 25 MB). Response files may arrive by email: upload them here.</div>
        {(['job_number', 'asset_owner', 'plan_reference'] as const).map((k) => (
          <div className="dz-param dz-wide" key={k}><label htmlFor={'dbp-' + k}>{k === 'job_number' ? 'Job number' : k === 'asset_owner' ? 'Asset owner' : 'Plan reference'}</label><input id={'dbp-' + k} className="search" placeholder="OPTIONAL" value={meta[k]} onChange={(e) => setMeta({ ...meta, [k]: e.target.value })} /></div>
        ))}
        <div className="dz-param dz-wide"><label htmlFor="dbp-date">Plan date</label><input id="dbp-date" className="search" type="date" value={meta.plan_date} onChange={(e) => setMeta({ ...meta, plan_date: e.target.value })} /></div>
        <div className="dz-param dz-wide"><label htmlFor="dbp-file">Plan file</label><input id="dbp-file" type="file" accept=".pdf,.dwf,.dxf,application/pdf" onChange={(e) => { void upload(e.target.files?.[0]); e.target.value = ''; }} /></div>
        {plans.length > 0 && (
          <>
            <table className="ck-table"><thead><tr><th>Plan</th><th>Type</th><th>Date</th></tr></thead><tbody>
              {plans.map((p) => <tr key={p.plan_id}><td>{p.name.toUpperCase()}</td><td>{p.kind.toUpperCase()}</td><td>{fmtDate(p.plan_date ?? '') || 'NOT SET'}</td></tr>)}
            </tbody></table>
            <div className="note"><b>READ SERVICES FROM A PLAN</b> A vector PDF is read automatically. A scan, DWF or DXF is traced by hand with the Trace service tool.</div>
            <div className="dz-param dz-wide"><label htmlFor="pp-id">Plan</label><select id="pp-id" className="search" value={parse.id} onChange={(e) => { setParse({ ...parse, id: e.target.value }); setResult(null); }}><option value="">CHOOSE…</option>{plans.map((p) => <option key={p.plan_id} value={p.plan_id}>{p.name.toUpperCase()}</option>)}</select></div>
            <div className="dz-param dz-wide"><label htmlFor="pp-pg">Page</label><input id="pp-pg" className="search" inputMode="numeric" value={parse.page} onChange={(e) => setParse({ ...parse, page: e.target.value })} /></div>
            <div className="dz-param dz-wide"><label htmlFor="pp-sc">Scale 1 to</label><input id="pp-sc" className="search" inputMode="decimal" placeholder="IF PRINTED ON THE PLAN" value={parse.scale} onChange={(e) => setParse({ ...parse, scale: e.target.value })} /></div>
            <div className="dz-param dz-wide"><label htmlFor="pp-tl">Tolerance (m)</label><input id="pp-tl" className="search" inputMode="decimal" placeholder="NOT SET" value={parse.tol} onChange={(e) => setParse({ ...parse, tol: e.target.value })} /></div>
            <div className="dz-param dz-wide"><label htmlFor="pp-ex">Plan expiry date</label><input id="pp-ex" className="search" type="date" value={parse.expiry} onChange={(e) => setParse({ ...parse, expiry: e.target.value })} /></div>
            <button className="view" disabled={!parse.id} onClick={() => { void doParse(); }}>Read services</button>
          </>
        )}
      </fieldset>
      {err && <div className="note" style={{ color: 'var(--bad)' }} role="alert">{err}</div>}
      {result && (
        <div role="status" aria-live="polite">
          {result.message && <div className="note" role="alert">{result.message}</div>}
          {result.objects.length > 0 && <>
            <div className="note"><b>{result.label ?? UNVERIFIED_LABEL}</b></div>
            {result.georeference && <div className="note">PLACEMENT: {result.georeference.outcome.toUpperCase()}{result.georeference.rmse_m !== null ? `, RMSE ${result.georeference.rmse_m.toFixed(2)} m` : ''}. {result.georeference.messages.join(' ')}</div>}
            {result.tolerance_note && <div className="note">{result.tolerance_note}</div>}
            <div className="note">{result.objects.length} DRAFT SERVICE{result.objects.length === 1 ? '' : 'S'} FOUND.</div>
            <button className="view" disabled={locked || added} onClick={addDrafts}>{added ? 'Added' : `Add ${result.objects.length} draft services to the design`}</button>
          </>}
        </div>
      )}
    </section>
  );
}
