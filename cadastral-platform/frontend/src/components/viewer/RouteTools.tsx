'use client';
/**
 * Design tab, stage 8: the Sewer tool and the Water tool. The SERVER proposes the route and runs every check from the requirement keys; this page only collects the
 * user's inputs, shows the answer and applies it (one undo step). Nothing is defaulted: a start invert, a diameter, a cover and a meter position are entered by the
 * user, and a limit that is not set in the rules is shown UNRESOLVED with its key.
 */
import { useState } from 'react';
import type { DesignController, DesignState } from '@/lib/site/designController';
import { EMPTY_CONNECTION, buildingExits, connectable, connectionInput, optionalNumber, requiredNumber, type ConnectionForm } from '@/lib/site/serviceForm';
import { textOf, type SiteDesign, type SiteObject } from '@/lib/site/types';

const sevClass = (s: string) => (s === 'blocking' ? 'badge sev-blocking' : s === 'warning' ? 'badge sev-warning' : 'badge sev-info');

function ConnectionFields({ doc, kind, c, set, ctl }: { doc: SiteDesign; kind: 'sewer' | 'water'; c: ConnectionForm; set: (c: ConnectionForm) => void; ctl: DesignController }) {
  const mains = connectable(doc.objects, kind), id = `cn-${kind}`;
  return (
    <div role="group" aria-label={`${kind} connection`}>
      <div className="note"><b>CONNECTION POINT</b></div>
      <div className="dz-param dz-wide"><label htmlFor={id + '-mode'}>Connect to</label>
        <select id={id + '-mode'} className="search" value={c.mode} onChange={(e) => set({ ...c, mode: e.target.value as 'main' | 'point' })}>
          <option value="main">AN EXISTING SERVICE IN THE DESIGN</option><option value="point">A POINT I ENTER (NOT VERIFIED)</option></select></div>
      {c.mode === 'main' ? (
        <div className="dz-param dz-wide"><label htmlFor={id + '-main'}>Service</label>
          <select id={id + '-main'} className="search" value={c.main_id} onChange={(e) => set({ ...c, main_id: e.target.value })}>
            <option value="">CHOOSE…</option>{mains.map((m) => <option key={m.id} value={m.id}>{(m.label ?? m.id).toUpperCase()}{m.verified ? '' : ' (UNVERIFIED)'}{textOf(m, 'service_kind') ? '' : ' (KIND NOT SET)'}</option>)}</select></div>
      ) : (
        <>
          <div className="row dz-row">
            <input className="search" aria-label="Connection easting" inputMode="decimal" placeholder="EASTING" value={c.e} onChange={(e) => set({ ...c, e: e.target.value })} />
            <input className="search" aria-label="Connection northing" inputMode="decimal" placeholder="NORTHING" value={c.n} onChange={(e) => set({ ...c, n: e.target.value })} />
          </div>
          <button className="view" onClick={() => ctl.pickPoint('Click the connection point', (p) => set({ ...c, e: p[0].toFixed(3), n: p[1].toFixed(3) }))}>Pick in the model</button>
          <div className="note">A point you enter is shown as NOT VERIFIED: the model does not know there is a main there.</div>
        </>
      )}
      <div className="dz-param dz-wide"><label htmlFor={id + '-inv'}>Invert at connection (m RL)</label>
        <input id={id + '-inv'} className="search" inputMode="decimal" placeholder={c.mode === 'main' ? 'FROM THE MAIN DEPTH, IF KNOWN' : 'NOT SET'} value={c.invert_rl} onChange={(e) => set({ ...c, invert_rl: e.target.value })} /></div>
    </div>
  );
}

export function RouteResult({ ds, ctl }: { ds: DesignState; ctl: DesignController }) {
  const r = ds.route; if (!r) return null;
  if (r.status === 'pending') return <div className="note" role="status">PROPOSING THE ROUTE…</div>;
  if (r.status === 'error') return <div className="note" style={{ color: 'var(--bad)' }} role="alert">{r.error}</div>;
  const p = r.result!, c = p.connection, minCover = (p.profile ?? []).map((x) => x.cover_m).filter((x): x is number => x !== null);
  const s = p.summary as Record<string, number>;
  return (
    <div aria-label="Route proposal" aria-live="polite">
      <div className="note"><b>{p.label}</b></div>
      <div className="readout">
        <span>ROUTE LENGTH (PLAN)</span><span>{p.route.length_m.toFixed(2)} m</span>
        {r.kind === 'sewer' && <><span>GRADE</span><span>{p.grade_pct === null || p.grade_pct === undefined ? 'UNRESOLVED' : `${p.grade_pct.toFixed(2)} %`}{p.grade_basis ? <div className="note">{p.grade_basis}</div> : null}</span>
          <span>INSPECTION OPENINGS</span><span>{(p.inspection_chainages_m ?? []).length}{(p.inspection_chainages_m ?? []).length ? ` AT ${(p.inspection_chainages_m ?? []).map((x) => x.toFixed(1)).join(', ')} m` : ''}</span>
          <span>LEAST COVER</span><span>{minCover.length ? `${Math.min(...minCover).toFixed(2)} m` : 'DATA NOT AVAILABLE'}</span></>}
        <span>CONNECTION</span><span>{c.label}{c.status ? <div className="note">{c.status}: {c.message}</div> : null}</span>
      </div>
      {p.notes.map((n) => <div className="note" key={n}>{n}</div>)}
      <div className="note"><b>CHECKS</b> {s && typeof s === 'object' ? `${s.blocking ?? 0} BLOCKING, ${s.warning ?? 0} WARNING` : ''}</div>
      <ul className="ck-list">
        {p.checks.filter((k) => k.status !== 'NOT APPLICABLE').map((k) => (
          <li key={k.id} className={'ck-row sev-row-' + k.severity}>
            <span className={sevClass(k.severity)}>{k.status}</span> <b>{k.title}</b>
            <div className="note ck-msg">{k.message}</div>
            <div className="ck-meta">{k.requirements.map((q) => <span key={q.key} className={'badge basis-' + q.basis.toLowerCase().replace(/ /g, '_')} title={`${q.key} = ${q.value === null ? 'UNRESOLVED' : String(q.value)} ${q.unit}`}>{q.key}</span>)}</div>
          </li>
        ))}
      </ul>
      <div className="btns" style={{ marginTop: 6 }}>
        <button className="view" disabled={r.applied} onClick={() => ctl.applyRoute()}>{r.applied ? 'Applied' : 'Add to the design'}</button>
        <button className="view" onClick={() => ctl.clearRoute()}>{r.applied ? 'Close' : 'Discard'}</button>
      </div>
      <div className="note">Adding creates the objects in one step; Undo removes them. The route is a proposal for you to adjust, not the only or the best route.</div>
    </div>
  );
}

function BuildingSelect({ doc, kind, b, setB, ex, setEx }: { doc: SiteDesign; kind: 'sewer' | 'water'; b: string; setB: (s: string) => void; ex: string; setEx: (s: string) => void }) {
  const buildings = doc.objects.filter((o) => o.type === 'building' && o.accepted !== 'rejected');
  const sel = buildings.find((o) => o.id === b), exits = sel ? buildingExits(sel, kind) : [];
  return (
    <>
      <div className="dz-param dz-wide"><label htmlFor={'bs-' + kind}>Building</label>
        <select id={'bs-' + kind} className="search" value={b} onChange={(e) => { setB(e.target.value); setEx('0'); }}><option value="">CHOOSE…</option>
          {buildings.map((o) => <option key={o.id} value={o.id}>{(o.label ?? o.id).toUpperCase()}</option>)}</select></div>
      {sel && (exits.length === 0
        ? <div className="note" role="alert">THIS BUILDING HAS NO {kind.toUpperCase()} EXIT. THE IMPORT DID NOT GIVE ONE.</div>
        : <div className="dz-param dz-wide"><label htmlFor={'be-' + kind}>{kind === 'sewer' ? 'Sewer' : 'Water'} exit</label>
          <select id={'be-' + kind} className="search" value={ex} onChange={(e) => setEx(e.target.value)}>{exits.map((p, i) => <option key={i} value={i}>{`EXIT ${i + 1}: ${p[0].toFixed(2)}, ${p[1].toFixed(2)}`}</option>)}</select></div>)}
    </>
  );
}

export function SewerSection({ ds, doc, ctl, locked }: { ds: DesignState; doc: SiteDesign; ctl: DesignController; locked: boolean }) {
  const [b, setB] = useState(''), [ex, setEx] = useState('0'), [inv, setInv] = useState(''), [dia, setDia] = useState(''), [gr, setGr] = useState(''), [cn, setCn] = useState<ConnectionForm>(EMPTY_CONNECTION), [err, setErr] = useState('');
  const go = () => {
    const a = requiredNumber(inv, 'THE START INVERT'), d = requiredNumber(dia, 'THE DIAMETER', { positive: true }), g = optionalNumber(gr, 'THE GRADE'), c = connectionInput(cn);
    const e = !b ? 'CHOOSE THE BUILDING' : a.error ?? d.error ?? g.error ?? c.error;
    if (e) { setErr(e); return; }
    setErr(''); void ctl.proposeSewer({ building_id: b, exit_index: Number(ex), start_invert_rl: a.value!, diameter_mm: d.value!, grade_pct: g.value, connection: c.value! });
  };
  return (
    <section aria-label="Sewer tool">
      <h2>Sewer tool</h2>
      <div className="note">Proposes a property sewer drain from a building sewer exit to a connection. Grades, cover, depth, clearances, inspection openings and the zone of influence are checked against the rule keys; a key that is not set is shown UNRESOLVED. Connecting to a service that is not verified, or to a point you enter, is flagged.</div>
      <fieldset className="dz-fs" disabled={locked}>
        <BuildingSelect doc={doc} kind="sewer" b={b} setB={setB} ex={ex} setEx={setEx} />
        <div className="dz-param dz-wide"><label htmlFor="sw-inv">Start invert (m RL)</label><input id="sw-inv" className="search" inputMode="decimal" placeholder="REQUIRED" value={inv} onChange={(e) => setInv(e.target.value)} /></div>
        <div className="dz-param dz-wide"><label htmlFor="sw-dia">Diameter (mm)</label><input id="sw-dia" className="search" inputMode="decimal" placeholder="REQUIRED" value={dia} onChange={(e) => setDia(e.target.value)} /></div>
        <div className="dz-param dz-wide"><label htmlFor="sw-gr">Grade (%)</label><input id="sw-gr" className="search" inputMode="decimal" placeholder="FROM THE MINIMUM GRADE RULE" value={gr} onChange={(e) => setGr(e.target.value)} /></div>
        <ConnectionFields doc={doc} kind="sewer" c={cn} set={setCn} ctl={ctl} />
        <button className="view" disabled={ds.route?.status === 'pending'} onClick={go}>Propose sewer route</button>
      </fieldset>
      {err && <div className="note" style={{ color: 'var(--bad)' }} role="alert">{err}</div>}
      {ds.route?.kind === 'sewer' && <RouteResult ds={ds} ctl={ctl} />}
    </section>
  );
}

export function WaterSection({ ds, doc, ctl, locked }: { ds: DesignState; doc: SiteDesign; ctl: DesignController; locked: boolean }) {
  const [b, setB] = useState(''), [ex, setEx] = useState('0'), [me, setMe] = useState(''), [mn, setMn] = useState(''), [dia, setDia] = useState(''), [cov, setCov] = useState(''), [rwt, setRwt] = useState('');
  const [cn, setCn] = useState<ConnectionForm>(EMPTY_CONNECTION), [err, setErr] = useState('');
  const tanks = doc.objects.filter((o) => o.type === 'rwt' && o.accepted !== 'rejected');
  const go = () => {
    const e1 = requiredNumber(me, 'THE METER EASTING'), n1 = requiredNumber(mn, 'THE METER NORTHING'), d = requiredNumber(dia, 'THE SIZE', { positive: true }), v = requiredNumber(cov, 'THE COVER', { positive: true }), c = connectionInput(cn);
    const e = !b ? 'CHOOSE THE BUILDING' : e1.error ?? n1.error ?? d.error ?? v.error ?? c.error;
    if (e) { setErr(e); return; }
    setErr(''); void ctl.proposeWater({ building_id: b, exit_index: Number(ex), meter_p: [e1.value!, n1.value!], diameter_mm: d.value!, cover_m: v.value!, rwt_id: rwt || null, connection: c.value! });
  };
  return (
    <section aria-label="Water tool">
      <h2>Water tool</h2>
      <div className="note">Proposes a water service from a main connection, through the meter position you give, to the building water exit. The size and cover are your entries; the minimum cover is checked against its rule key. Link a rainwater tank to check its mains backup.</div>
      <fieldset className="dz-fs" disabled={locked}>
        <BuildingSelect doc={doc} kind="water" b={b} setB={setB} ex={ex} setEx={setEx} />
        <ConnectionFields doc={doc} kind="water" c={cn} set={setCn} ctl={ctl} />
        <div className="note"><b>METER POSITION</b></div>
        <div className="row dz-row">
          <input className="search" aria-label="Meter easting" inputMode="decimal" placeholder="EASTING" value={me} onChange={(e) => setMe(e.target.value)} />
          <input className="search" aria-label="Meter northing" inputMode="decimal" placeholder="NORTHING" value={mn} onChange={(e) => setMn(e.target.value)} />
        </div>
        <button className="view" onClick={() => ctl.pickPoint('Click the meter position', (p) => { setMe(p[0].toFixed(3)); setMn(p[1].toFixed(3)); })}>Pick in the model</button>
        <div className="dz-param dz-wide"><label htmlFor="wt-dia">Size (mm)</label><input id="wt-dia" className="search" inputMode="decimal" placeholder="REQUIRED" value={dia} onChange={(e) => setDia(e.target.value)} /></div>
        <div className="dz-param dz-wide"><label htmlFor="wt-cov">Cover (m)</label><input id="wt-cov" className="search" inputMode="decimal" placeholder="REQUIRED" value={cov} onChange={(e) => setCov(e.target.value)} /></div>
        <div className="dz-param dz-wide"><label htmlFor="wt-rwt">Rainwater tank</label>
          <select id="wt-rwt" className="search" value={rwt} onChange={(e) => setRwt(e.target.value)}><option value="">NOT LINKED</option>{tanks.map((t: SiteObject) => <option key={t.id} value={t.id}>{(t.label ?? t.id).toUpperCase()}</option>)}</select></div>
        <button className="view" disabled={ds.route?.status === 'pending'} onClick={go}>Propose water service</button>
      </fieldset>
      {err && <div className="note" style={{ color: 'var(--bad)' }} role="alert">{err}</div>}
      {ds.route?.kind === 'water' && <RouteResult ds={ds} ctl={ctl} />}
    </section>
  );
}
