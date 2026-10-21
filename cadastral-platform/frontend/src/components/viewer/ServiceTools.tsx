'use client';
/**
 * Design tab, stage 8: the Trace service tool (plan underlay, two point calibration, service fields, drawing) and the verification box of an existing service.
 * Every field is the user's entry. An empty field stays NOT SET. A traced service is UNVERIFIED, INDICATIVE ONLY until the user verifies it.
 */
import { useRef, useState } from 'react';
import type { DesignController, DesignState } from '@/lib/site/designController';
import { planPage, type PlanRecord } from '@/lib/site/dbydApi';
import { EMPTY_TRACE_FORM, traceFields, type TraceForm } from '@/lib/site/serviceForm';
import { fmtDate, planExpired, todayIso } from '@/lib/site/services';
import { clientToPixel, MAX_UNDERLAY_BYTES, MAX_UNDERLAY_PX, textureOf, UNDERLAY_IMAGE_TYPES, type Pt2 } from '@/lib/site/underlay';
import { DEPTH_BASES, DEPTH_BASIS_LABEL, DEPTH_REFERENCES, DEPTH_REFERENCE_LABEL, PLAN_EXPIRED, SERVICE_KINDS, SERVICE_KIND_LABEL, UNVERIFIED_LABEL, textOf, type SiteObject } from '@/lib/site/types';

type Run = (name: string, args: Record<string, unknown>, label?: string) => void;

/** Load an image blob as the underlay (browser only). */
export function loadImageBlob(ctl: DesignController, name: string, blob: Blob): Promise<string | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob), img = new Image();
    img.onload = () => {
      const err = ctl.loadUnderlay({ name, width: img.naturalWidth, height: img.naturalHeight, texture: textureOf(img) });
      resolve(err);
    };
    img.onerror = () => { URL.revokeObjectURL(url); resolve('THE IMAGE COULD NOT BE READ'); };
    img.src = url;
  });
}

function Num({ id, label, v, set, ph = 'NOT SET' }: { id: string; label: string; v: string; set: (s: string) => void; ph?: string }) {
  return <div className="dz-param dz-wide"><label htmlFor={id}>{label}</label><input id={id} className="search" inputMode="decimal" value={v} placeholder={ph} onChange={(e) => set(e.target.value)} /></div>;
}

/** One calibration point: where on the plan, and which model point it stands for. */
function ModelPoint({ n, ctl, value, onChange }: { n: 1 | 2; ctl: DesignController; value: { e: string; n: string }; onChange: (v: { e: string; n: string }) => void }) {
  const corners = ctl.lotCorners();
  return (
    <div className="dz-param dz-wide" style={{ gridTemplateColumns: '1fr' }}>
      <div className="note"><b>MODEL POINT {n}</b> (MGA metres)</div>
      <div className="row dz-row">
        <input className="search" aria-label={`Model point ${n} easting`} inputMode="decimal" placeholder="EASTING" value={value.e} onChange={(e) => onChange({ ...value, e: e.target.value })} />
        <input className="search" aria-label={`Model point ${n} northing`} inputMode="decimal" placeholder="NORTHING" value={value.n} onChange={(e) => onChange({ ...value, n: e.target.value })} />
      </div>
      <div className="btns">
        <button className="view" onClick={() => ctl.pickPoint(`Click the model point that is plan point ${n}`, (p) => onChange({ e: p[0].toFixed(3), n: p[1].toFixed(3) }))}>Pick in the model</button>
        <button className="view" onClick={() => ctl.pickPoint(`Click lot corner ${n}`, (p) => onChange({ e: p[0].toFixed(3), n: p[1].toFixed(3) }), { lotCorner: true })} disabled={!corners.length}>Snap to a lot corner</button>
        {corners.length > 0 && (
          <select className="search" aria-label={`Lot corner for model point ${n}`} value="" onChange={(e) => { const c = corners[Number(e.target.value)]; if (c) onChange({ e: c[0].toFixed(3), n: c[1].toFixed(3) }); }}>
            <option value="">LOT CORNER…</option>{corners.map((c, i) => <option key={i} value={i}>{`CORNER ${i + 1}: ${c[0].toFixed(2)}, ${c[1].toFixed(2)}`}</option>)}
          </select>
        )}
      </div>
    </div>
  );
}

export function TraceServiceSection({ ds, ctl, plans, locked }: { ds: DesignState; ctl: DesignController; plans: PlanRecord[]; locked: boolean }) {
  const [form, setForm] = useState<TraceForm>(EMPTY_TRACE_FORM), [err, setErr] = useState(''), [busy, setBusy] = useState(false);
  const [imgPts, setImgPts] = useState<Pt2[]>([]), [mp, setMp] = useState([{ e: '', n: '' }, { e: '', n: '' }]), [url, setUrl] = useState('');
  const [planId, setPlanId] = useState(''), [page, setPage] = useState('1');
  const imgRef = useRef<HTMLImageElement | null>(null);
  const u = ds.underlay;
  const f = (k: keyof TraceForm) => (v: string) => setForm((x) => ({ ...x, [k]: v }));
  const pdfs = plans.filter((p) => p.kind === 'pdf');

  const setBlob = async (name: string, blob: Blob) => {
    setErr(''); setImgPts([]);
    const e = await loadImageBlob(ctl, name, blob);
    if (e) setErr(e); else { setUrl((old) => { if (old) URL.revokeObjectURL(old); return URL.createObjectURL(blob); }); }
  };
  const onFile = async (file: File | undefined) => {
    if (!file) return;
    if (!UNDERLAY_IMAGE_TYPES.includes(file.type)) { setErr('USE A PNG OR JPEG IMAGE OF THE PLAN PAGE. FOR A PDF, UPLOAD IT AS A DBYD PLAN AND CHOOSE ITS PAGE'); return; }
    if (file.size > MAX_UNDERLAY_BYTES) { setErr(`THE IMAGE IS LARGER THAN ${MAX_UNDERLAY_BYTES / (1024 * 1024)} MB`); return; }
    await setBlob(file.name, file);
  };
  const onPdfPage = async () => {
    const ep = ctl.endpoint, p = pdfs.find((x) => x.plan_id === planId), pg = Number(page);
    if (!ep) { setErr('NO SERVER: THIS VIEW CANNOT RENDER A PDF PAGE'); return; }
    if (!p || !Number.isInteger(pg) || pg < 1) { setErr('CHOOSE A PDF PLAN AND A PAGE NUMBER (1 OR MORE)'); return; }
    setBusy(true); setErr('');
    try { await setBlob(`${p.name} PAGE ${pg}`, await planPage(ep, p.plan_id, pg, Math.min(2400, MAX_UNDERLAY_PX))); }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };
  const onImgClick = (e: React.MouseEvent<HTMLImageElement>) => {
    const im = imgRef.current; if (!im) return;
    const r = im.getBoundingClientRect(), p = clientToPixel(e.clientX, e.clientY, r, { width: im.naturalWidth, height: im.naturalHeight });
    if (p) setImgPts((x) => (x.length >= 2 ? [p] : [...x, p]));
  };
  const doCalibrate = () => {
    if (imgPts.length < 2) { setErr('CLICK TWO POINTS ON THE PLAN IMAGE FIRST'); return; }
    const m = mp.map((q) => [Number(q.e), Number(q.n)] as Pt2);
    if (mp.some((q) => q.e.trim() === '' || q.n.trim() === '') || m.some((q) => !Number.isFinite(q[0]) || !Number.isFinite(q[1]))) { setErr('ENTER OR PICK BOTH MODEL POINTS'); return; }
    setErr(ctl.calibrateUnderlay([imgPts[0], imgPts[1]], [m[0], m[1]]) ?? '');
  };
  const draw = (point: boolean) => {
    const r = traceFields(form); if (r.error) { setErr(r.error); return; }
    setErr(''); ctl.traceService(r.fields, { point, label: r.label });
  };

  return (
    <section aria-label="Trace service">
      <h2>Trace service</h2>
      <div className="note">Place a plan page under the model, then draw each service over it. Every service you draw is {UNVERIFIED_LABEL} until you verify it. The plan image stays in this browser session and is not saved with the design.</div>
      <fieldset className="dz-fs" disabled={locked}>
        <div className="note"><b>1. PLAN PAGE</b></div>
        <div className="dz-param dz-wide"><label htmlFor="tr-file">Image (PNG or JPEG)</label><input id="tr-file" type="file" accept="image/png,image/jpeg" onChange={(e) => { void onFile(e.target.files?.[0]); e.target.value = ''; }} /></div>
        {pdfs.length > 0 && (
          <div className="dz-param dz-wide" style={{ gridTemplateColumns: '1fr auto auto' }}>
            <select className="search" aria-label="Uploaded PDF plan" value={planId} onChange={(e) => setPlanId(e.target.value)}><option value="">UPLOADED PDF PLAN…</option>{pdfs.map((p) => <option key={p.plan_id} value={p.plan_id}>{p.name.toUpperCase()}</option>)}</select>
            <input className="search" aria-label="PDF page number" style={{ width: 56 }} inputMode="numeric" value={page} onChange={(e) => setPage(e.target.value)} />
            <button className="view" disabled={busy || !planId} onClick={() => { void onPdfPage(); }}>Use page</button>
          </div>
        )}
        {u && <div className="note" role="status">LOADED: {u.name.toUpperCase()} ({u.width} x {u.height} PIXELS). {u.label}</div>}
        {u && url && (
          <div>
            <div className="note"><b>2. CALIBRATE</b> Click two points on the plan that you can find in the model (for example two lot corners). {imgPts.length}/2 picked.</div>
            <div style={{ position: 'relative', maxHeight: 260, overflow: 'auto', border: '1px solid var(--line, #888)' }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img ref={imgRef} src={url} alt="Plan page for calibration" style={{ width: '100%', cursor: 'crosshair', display: 'block' }} onClick={onImgClick} />
              {imgPts.map((p, i) => <span key={i} className="badge" style={{ position: 'absolute', left: `${(p[0] / u.width) * 100}%`, top: `${(p[1] / u.height) * 100}%`, transform: 'translate(-50%,-50%)' }}>{i + 1}</span>)}
            </div>
            <ModelPoint n={1} ctl={ctl} value={mp[0]} onChange={(v) => setMp((x) => [v, x[1]])} />
            <ModelPoint n={2} ctl={ctl} value={mp[1]} onChange={(v) => setMp((x) => [x[0], v])} />
            <div className="btns" style={{ marginTop: 6 }}>
              <button className="view" onClick={doCalibrate}>Calibrate and show in the model</button>
              <button className="view" onClick={() => setImgPts([])}>Clear plan points</button>
              <button className="view" onClick={() => { ctl.clearUnderlay(); setImgPts([]); if (url) URL.revokeObjectURL(url); setUrl(''); }}>Remove the plan</button>
            </div>
            <div className="dz-param dz-wide"><label htmlFor="tr-op">Opacity</label>
              <input id="tr-op" type="range" min={0.05} max={1} step={0.05} value={u.opacity} onChange={(e) => ctl.setUnderlayOpacity(Number(e.target.value))} /><span className="note">{Math.round(u.opacity * 100)} %</span></div>
          </div>
        )}
        <div className="note" style={{ marginTop: 8 }}><b>3. SERVICE DETAILS</b> Enter only what the plan states. A field left empty is NOT SET.</div>
        <div className="dz-param dz-wide"><label htmlFor="tr-kind">Service kind</label>
          <select id="tr-kind" className="search" value={form.service_kind} onChange={(e) => f('service_kind')(e.target.value)}><option value="">NOT SET</option>{SERVICE_KINDS.map((k) => <option key={k} value={k}>{SERVICE_KIND_LABEL[k]}</option>)}</select></div>
        {([['asset_owner', 'Asset owner'], ['material', 'Material'], ['dbyd_job_number', 'DBYD job number'], ['plan_reference', 'Plan reference'], ['source_file', 'Source file']] as const).map(([k, l]) => (
          <div className="dz-param dz-wide" key={k}><label htmlFor={'tr-' + k}>{l}</label><input id={'tr-' + k} className="search" placeholder="NOT SET" value={form[k]} onChange={(e) => f(k)(e.target.value)} /></div>
        ))}
        <Num id="tr-dia" label="Diameter (mm)" v={form.diameter_mm} set={f('diameter_mm')} />
        <Num id="tr-depth" label="Depth (m)" v={form.depth_m} set={f('depth_m')} />
        <div className="dz-param dz-wide"><label htmlFor="tr-basis">Depth basis</label>
          <select id="tr-basis" className="search" value={form.depth_basis} onChange={(e) => f('depth_basis')(e.target.value)}><option value="">NOT SET</option>{DEPTH_BASES.map((k) => <option key={k} value={k}>{DEPTH_BASIS_LABEL[k]}</option>)}</select></div>
        <div className="dz-param dz-wide"><label htmlFor="tr-ref">Depth is to</label>
          <select id="tr-ref" className="search" value={form.depth_reference} onChange={(e) => f('depth_reference')(e.target.value)}><option value="">NOT SET</option>{DEPTH_REFERENCES.map((k) => <option key={k} value={k}>{DEPTH_REFERENCE_LABEL[k]}</option>)}</select></div>
        <Num id="tr-tol" label="Tolerance (m)" v={form.position_tolerance_m} set={f('position_tolerance_m')} />
        <div className="dz-param dz-wide"><label htmlFor="tr-pd">Plan date</label><input id="tr-pd" className="search" type="date" value={form.plan_date} onChange={(e) => f('plan_date')(e.target.value)} /></div>
        <div className="dz-param dz-wide"><label htmlFor="tr-pe">Plan expiry date</label><input id="tr-pe" className="search" type="date" value={form.plan_expiry_date} onChange={(e) => f('plan_expiry_date')(e.target.value)} /></div>
        <div className="dz-param dz-wide"><label htmlFor="tr-lab">Label</label><input id="tr-lab" className="search" placeholder="OPTIONAL" value={form.label} onChange={(e) => f('label')(e.target.value)} /></div>
        <div className="btns">
          <button className={'view' + (ds.objectType === 'service_existing' && ds.tool === 'draw' ? ' on' : '')} onClick={() => draw(false)}>Draw service line</button>
          <button className="view" onClick={() => draw(true)}>Place service point (pit, valve, pole)</button>
        </div>
        <div className="note">Click the points of the service over the plan. Double click or Enter finishes. Snaps apply as for any line.</div>
      </fieldset>
      {err && <div className="note" style={{ color: 'var(--bad)' }} role="alert">{err}</div>}
    </section>
  );
}

/** The verification box of an existing service: PLAN EXPIRED, UNVERIFIED, INDICATIVE ONLY, and who verified it and when. */
export function ServiceVerifyBox({ o, run, locked, today }: { o: SiteObject; run: Run; locked: boolean; today?: string }) {
  const t = today ?? todayIso();
  const [by, setBy] = useState(textOf(o, 'verified_by') ?? ''), [on, setOn] = useState(o.verified_on ?? t);
  if (o.type !== 'service_existing') return null;
  return (
    <div role="group" aria-label="Service verification" style={{ marginTop: 8 }}>
      {planExpired(o, t) && <div className="note" style={{ color: 'var(--bad)' }} role="alert"><b>{PLAN_EXPIRED}</b> (EXPIRED {fmtDate(textOf(o, 'plan_expiry_date') ?? '')})</div>}
      {o.verified
        ? <div className="note" role="status"><b>VERIFIED</b> {fmtDate(o.verified_on)} BY {(textOf(o, 'verified_by') ?? '').toUpperCase()}</div>
        : <div className="note" role="status"><b>{UNVERIFIED_LABEL}</b></div>}
      <fieldset className="dz-fs" disabled={locked}>
        {!o.verified && <>
          <div className="dz-param dz-wide"><label htmlFor="sv-by">Verified by</label><input id="sv-by" className="search" value={by} placeholder="NAME" onChange={(e) => setBy(e.target.value)} /></div>
          <div className="dz-param dz-wide"><label htmlFor="sv-on">Date</label><input id="sv-on" className="search" type="date" value={on} onChange={(e) => setOn(e.target.value)} /></div>
          <div className="note">Verify only after the position and depth are checked against the plan, a pothole or a survey. Verification is your statement. It is never set automatically.</div>
          <button className="view" onClick={() => run('set_service_verified', { verified: true, verified_by: by, date: on }, 'Verify service')}>Mark verified</button>
        </>}
        {o.verified && <button className="view" onClick={() => run('set_service_verified', { verified: false }, 'Remove verification')}>Remove verification</button>}
      </fieldset>
    </div>
  );
}
