'use client';
/** Design tab sections for stage 6: the selected driveway (long section, checks, earthworks, building link) and the selected grading area (volumes). */
import { useState } from 'react';
import type { DesignController, DrivewayPanel, GradingPanel } from '@/lib/site/designController';
import type { Earthworks, ProfileCheck } from '@/lib/site/driveway';
import { OpError } from '@/lib/site/ops';
import { LongSection } from './LongSection';
import { gradingTargetSet, TARGET_NOT_SET, type SiteDesign, type SiteObject } from '@/lib/site/types';

const num = (v: number | null, d = 2, unit = '') => (v === null ? 'NOT SET' : `${v.toFixed(d)}${unit}`);

function CheckRow({ c }: { c: ProfileCheck }) {
  const unit = c.unit && c.unit !== 'H per V' ? ` ${c.unit}` : c.unit ? ' H:V' : '';
  const status = c.status === 'FAIL' ? 'sev-blocking' : c.status === 'PASS' ? 'sev-info' : 'sev-warning';
  return (
    <tr className={c.status === 'FAIL' ? 'ck-fail' : undefined} title={[c.ref, c.note].filter(Boolean).join(' · ')}>
      <td>{c.title}{c.requirement_key && <div className="note">{c.requirement_key}</div>}</td>
      <td>{c.value === null ? 'NOT EVALUATED' : `${c.value}${unit}`}</td>
      <td>{c.limit === null ? <span className="badge basis-unresolved">UNRESOLVED</span> : `${c.limit}${unit}`}<div className="note">{c.basis}</div></td>
      <td><span className={'badge ' + status}>{c.status}</span></td>
    </tr>
  );
}
function Checks({ checks }: { checks: ProfileCheck[] }) {
  return <table className="ck-table"><thead><tr><th>Check</th><th>Value</th><th>Limit and basis</th><th>Result</th></tr></thead><tbody>{checks.map((c) => <CheckRow key={c.id} c={c} />)}</tbody></table>;
}
function Volumes({ ew }: { ew: Earthworks }) {
  return (
    <div className="readout" aria-live="polite">
      <span>{ew.label}</span><span />
      <span>CUT</span><span>{ew.cut_m3.toFixed(1)} m³ over {ew.cut_area_m2.toFixed(1)} m²</span>
      <span>FILL</span><span>{ew.fill_m3.toFixed(1)} m³ over {ew.fill_area_m2.toFixed(1)} m²</span>
      <span>NET (CUT MINUS FILL)</span><span>{ew.net_m3.toFixed(1)} m³</span>
      <span>BATTERS</span><span>{ew.batters_computed ? `CUT ${ew.batters.cut.h_per_v} H:V (${ew.batters.cut.basis}), FILL ${ew.batters.fill.h_per_v} H:V (${ew.batters.fill.basis})` : 'NOT COMPUTED: SLOPE UNRESOLVED'}</span>
      <span>VOLUME UNCERTAINTY</span><span>{ew.uncertainty_m3 === null ? 'DATA NOT AVAILABLE' : `± ${ew.uncertainty_m3.toFixed(1)} m³`}</span>
    </div>
  );
}
const Status = ({ p }: { p: { status: string; error: string; stale: boolean } }) =>
  p.status === 'no_server' ? <div className="note">NO SERVER: the engines are not connected on this page, so only a browser PREVIEW is shown.</div>
    : p.status === 'error' ? <div className="note" style={{ color: 'var(--bad)' }} role="alert">ENGINE ERROR: {p.error}</div>
    : p.status === 'pending' ? <div className="note" role="status">CHECKING WITH THE SERVER…</div> : p.stale ? <div className="note">PREVIEW: waiting for the server.</div> : null;

export function DrivewaySection({ p, o, doc, ctl, locked }: { p: DrivewayPanel; o: SiteObject; doc: SiteDesign; ctl: DesignController; locked: boolean }) {
  const [err, setErr] = useState('');
  const v = p.view, buildings = doc.objects.filter((b) => b.type === 'building');
  const link = (id: string) => { try { ctl.store.run('link_driveway_end', { id: o.id, building_id: id || null }, id ? 'Link driveway end' : 'Unlink driveway end'); setErr(''); } catch (e) { setErr(e instanceof OpError ? e.message : String(e)); } };
  return (
    <section aria-label="Driveway long section">
      <h2>Driveway long section{v?.preview ? ' · PREVIEW' : ''}</h2>
      <Status p={p} />
      {p.gaps.map((g) => <div key={g} className="note" role="note"><b>{g}</b>: no value is assumed.</div>)}
      {!p.kerbAvailable && <div className="note">ASSUMED KERB LINE NOT AVAILABLE IN THE 3D MODEL: the crossover cannot be placed by chainage.</div>}
      <div className="row dz-row"><label htmlFor="dz-link">End of driveway</label>
        <select id="dz-link" className="search" disabled={locked} value={p.linkedBuilding ?? ''} onChange={(e) => link(e.target.value)}>
          <option value="">NOT LINKED (END LEVEL ENTERED BELOW)</option>
          {buildings.map((b) => <option key={b.id} value={b.id}>{(b.label ?? b.id).toUpperCase()}</option>)}
        </select></div>
      {err && <div className="note" style={{ color: 'var(--bad)' }} role="alert">{err}</div>}
      {v && (
        <>
          <div className="readout">
            <span>CROSSOVER</span><span>{v.crossover.chainage_m === null ? v.crossover.frontage_offset_note || 'DATA NOT AVAILABLE' : `${num(v.crossover.chainage_m, 2, ' m')} along the assumed kerb line (of ${num(v.crossover.kerb_length_m, 1, ' m')})`}</span>
            <span>LENGTH</span><span>{num(v.length_m, 2, ' m')}</span>
            <span>WIDTH</span><span>{num(v.width.value, 2, ' m')} {v.width.value !== null && <span className="note">({v.width.basis})</span>}</span>
            <span>END LEVEL</span><span>{num(v.end_level.value, 2, ' RL')} {v.end_level.value !== null && <span className="note">({v.end_level.basis}{p.linkedBuilding ? `, FFL OF ${p.linkedBuilding.toUpperCase()}` : ''})</span>}</span>
            <span>REQUIREMENTS</span><span>{v.rules_for}</span>
          </div>
          <LongSection view={v} />
          {v.status !== 'OK' && <div className="note" role="note">{v.status}</div>}
          <Checks checks={v.checks} />
          {v.earthworks ? <><h2 style={{ marginTop: 10 }}>Cut and fill (indicative)</h2><Volumes ew={v.earthworks} /></> : v.preview ? null : <div className="note">CUT AND FILL: {v.width.value === null ? 'WIDTH NOT SET' : v.end_level.value === null ? 'END LEVEL NOT SET' : 'NOT COMPUTED'}</div>}
          {v.notes.map((n) => <div className="note" key={n}>{n}</div>)}
          <div className="note">TERRAIN: {v.terrain.status}</div>
        </>
      )}
    </section>
  );
}

export function GradingSection({ p, o, locked }: { p: GradingPanel; o: SiteObject; locked: boolean }) {
  const r = p.result;
  return (
    <section aria-label="Grading area">
      <h2>Grading area · cut and fill</h2>
      <Status p={p} />
      {!gradingTargetSet(o) && <div className="note" role="note"><b>{TARGET_NOT_SET}</b>: enter a target level, or a target grade with its fall direction. No level is assumed.</div>}
      {r && r.status !== 'OK' && <div className="note" role="note">{r.status}</div>}
      {r && r.design && r.status === 'OK' && (
        <div className="readout">
          <span>DESIGN</span><span>{r.design.mode === 'level' ? `LEVEL ${num(r.design.target_level_m, 2, ' RL')}` : `GRADE ${r.design.target_grade_pct}% FALLING TO ${r.design.fall_direction_deg} DEG, THROUGH ${num(r.design.pivot_level_m, 2, ' RL')} (${r.design.pivot_basis})`}</span>
        </div>
      )}
      {r?.earthworks && <Volumes ew={r.earthworks} />}
      {r && r.checks.length > 0 && <Checks checks={r.checks} />}
      {r?.notes.map((n) => <div className="note" key={n}>{n}</div>)}
      {r && <div className="note">TERRAIN: {r.terrain.status}</div>}
      {locked && <div className="note">The design is read only.</div>}
    </section>
  );
}
