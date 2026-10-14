'use client';
/**
 * Design tab sections for stage 7: the shared Checks list, the typed fields of the site objects, the per vertex levels of a retaining wall, the wall screening
 * result (SCREENING ONLY, NOT STRUCTURAL DESIGN), the values the server resolved for the selected object and the optional tank sizing.
 * Nothing here defaults a value: an empty field is NOT SET, an unresolved requirement is shown UNRESOLVED with its key.
 */
import { useState } from 'react';
import type { DesignController, DesignState } from '@/lib/site/designController';
import { collectChecks, type ListRow } from '@/lib/site/checkList';
import { computedFor, fieldsFor, type FieldSpec } from '@/lib/site/siteObjects';
import { OpError } from '@/lib/site/ops';
import { PARAM_ENUMS, PARAM_LINKS, BASIS_LABEL, OBJECT_KINDS, dimOf, wallHeightAt, type SiteDesign, type SiteObject } from '@/lib/site/types';
import type { CheckEntry, CheckValue } from '@/lib/site/serverChecks';

const basisClass = (b: string) => 'basis-' + b.toLowerCase().replace(/ /g, '_');
export const fmtIsoDate = (iso: string) => { const x = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso); return x ? `${x[3]}/${x[2]}/${x[1]}` : ''; };

// ---- the shared Checks list ----------------------------------------------------------------------------------------------------------
function Row({ r, onSelect }: { r: ListRow; onSelect: (id: string) => void }) {
  const status = r.status === 'ISSUE' ? '' : r.status;
  return (
    <li className={'ck-row sev-row-' + r.severity} key={r.id}>
      <button className="ck-hit" disabled={!r.objectId} onClick={() => r.objectId && onSelect(r.objectId)} title={r.objectId ? 'Select this object' : 'A check of the whole design'}>
        <span className={'badge sev-' + r.severity}>{r.severity === 'blocking' ? 'BLOCKING' : r.severity === 'warning' ? 'WARNING' : 'INFO'}</span>{' '}
        {status && <span className="badge ck-status">{status}</span>}{' '}
        <b>{r.title}</b> <span className="note">{r.objectName}</span>
        <div className="note ck-msg">{r.message}</div>
      </button>
      <div className="ck-meta">
        {r.keys.map((k) => { const q = r.requirements.find((x) => x.key === k)!; return <span key={k} className={'badge ' + basisClass(q.basis)} title={`${q.key} = ${q.value === null ? 'UNRESOLVED' : String(q.value)} ${q.unit} · ${q.basis}${q.stamp ? ' · ' + q.stamp : ''} · ${q.ref}`}>{k}</span>; })}
        {r.value && <span className="note">VALUE {r.value}</span>}{r.limit && <span className="note">LIMIT {r.limit}</span>}
        <span className={'badge ' + basisClass(r.basis)}>{r.basis}</span>
      </div>
    </li>
  );
}

export function ChecksSection({ doc, ds, ctl }: { doc: SiteDesign; ds: DesignState; ctl: DesignController }) {
  const [passed, setPassed] = useState(false);
  const st = ds.checks, list = collectChecks(doc, st.result, { showPassed: passed });
  const stale = st.status === 'ok' && st.sig !== st.resultSig;
  return (
    <section aria-label="Checks">
      <h2>Checks ({list.total})</h2>
      {st.status === 'no_server' && <div className="note">NO SERVER: the rule based checks are not run on this page. Only the geometry checks are listed.</div>}
      {st.status === 'pending' && <div className="note" role="status">CHECKING WITH THE SERVER…</div>}
      {st.status === 'error' && <div className="note" style={{ color: 'var(--bad)' }} role="alert">CHECK ERROR: {st.error}</div>}
      {stale && <div className="note">The list is for an earlier version of the design. Waiting for the server.</div>}
      {st.result && <div className="note">RULES FOR {st.result.rules_for.toUpperCase()}. {st.result.terrain.available ? '' : 'TERRAIN DATA NOT AVAILABLE. '}{st.result.lot_available ? '' : 'LOT BOUNDARY NOT AVAILABLE. '}{st.result.kerb_available ? '' : 'ASSUMED KERB LINE NOT AVAILABLE.'}</div>}
      <div className="btns" style={{ margin: '4px 0' }}>
        <label className="note"><input type="checkbox" checked={passed} onChange={(e) => setPassed(e.target.checked)} /> Show passed and not applicable checks</label>
        <button className="view" onClick={() => ctl.requestChecks(true)} disabled={!doc.objects.length}>Check now</button>
      </div>
      {!doc.objects.length ? <div className="note">No objects to check.</div> : list.total === 0 ? <div className="note">{st.result ? 'NO ISSUES.' : 'No issues so far.'}{list.hidden ? ` ${list.hidden} passed or not applicable checks are hidden.` : ''}</div> : (
        list.groups.filter((g) => g.rows.length).map((g) => (
          <div key={g.severity} className="ck-group" aria-label={g.label}>
            <div className="note"><b>{g.label}</b> ({g.rows.length})</div>
            <ul className="ck-list">{g.rows.map((r) => <Row key={r.id} r={r} onSelect={(id) => ctl.select(id)} />)}</ul>
          </div>
        ))
      )}
      {list.hidden > 0 && list.total > 0 && <div className="note">{list.hidden} passed or not applicable checks are hidden.</div>}
    </section>
  );
}

// ---- typed fields ----------------------------------------------------------------------------------------------------------------------
type Run = (name: string, args: Record<string, unknown>, label?: string) => void;
const parseNum = (s: string): unknown => (s.trim() === '' ? null : Number.isFinite(Number(s)) ? Number(s) : s.trim());

function FieldRow({ o, spec, doc, run }: { o: SiteObject; spec: FieldSpec; doc: SiteDesign; run: Run }) {
  const p = o.params[spec.key], cur = p && p.value !== null ? String(p.value) : '', id = `dz-p-${spec.key}`;
  const set = (value: unknown) => run('set_param', { key: spec.key, value }, 'Set parameter');
  const badge = <span className={'badge basis-' + (p ? p.basis : 'unresolved')} title={p?.ref}>{BASIS_LABEL[p ? p.basis : 'unresolved']}</span>;
  const ro = (!!p && (p.basis === 'lga_rule' || p.basis === 'platform_default')) || (o.type === 'service_existing' && o.verified && spec.key === 'verified_by');
  const lab = <label htmlFor={id} title={spec.help}>{spec.label}{spec.unit ? ` (${spec.unit})` : ''}</label>;
  if (spec.kind === 'enum') {
    const options = PARAM_ENUMS[`${o.type}.${spec.key}`] ?? [];
    return <div className="dz-param dz-wide">{lab}<select id={id} className="search" value={cur} onChange={(e) => set(e.target.value || null)}><option value="">NOT SET</option>{options.map((v) => <option key={v} value={v}>{v.replace(/_/g, ' ').toUpperCase()}</option>)}</select>{badge}</div>;
  }
  if (spec.kind === 'bool') {
    return <div className="dz-param dz-wide">{lab}<select id={id} className="search" value={cur} onChange={(e) => set(e.target.value === '' ? null : e.target.value === 'true')}><option value="">NOT SET</option><option value="true">TRUE</option><option value="false">FALSE</option></select>{badge}</div>;
  }
  if (spec.kind === 'date') {
    return <div className="dz-param dz-wide">{lab}<input id={id} className="search" type="date" value={cur} onChange={(e) => set(e.target.value || null)} />{badge}{cur && <span className="note">{fmtIsoDate(cur)}</span>}</div>;
  }
  if (spec.kind === 'link') {
    const types = PARAM_LINKS[`${o.type}.${spec.key}`] ?? [], targets = doc.objects.filter((x) => (types as readonly string[]).includes(x.type) && x.id !== o.id);
    return <div className="dz-param dz-wide">{lab}<select id={id} className="search" value={cur} onChange={(e) => set(e.target.value || null)}><option value="">NOT LINKED</option>{targets.map((t) => <option key={t.id} value={t.id}>{OBJECT_KINDS[t.type].label} {(t.label ?? t.id).toUpperCase()}</option>)}</select>{badge}</div>;
  }
  return (
    <div className="dz-param dz-wide">{lab}
      <input id={id} className="search" defaultValue={cur} key={o.id + spec.key + JSON.stringify(p)} placeholder="NOT SET" disabled={ro} inputMode={spec.kind === 'number' ? 'decimal' : undefined}
        onBlur={(e) => { if (e.target.value !== cur) set(spec.kind === 'number' ? parseNum(e.target.value) : e.target.value.trim() === '' ? null : e.target.value.trim()); }}
        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />{badge}
    </div>
  );
}

/** The typed fields of a stage 7 object, grouped. Returns the keys it lists so the caller can leave them out of the generic list. */
export function ObjectFields({ o, doc, run }: { o: SiteObject; doc: SiteDesign; run: Run }) {
  const specs = fieldsFor(o), groups: { title: string; items: FieldSpec[] }[] = [];
  for (const s of specs) { const t = s.group ?? ''; const g = groups.find((x) => x.title === t); if (g) g.items.push(s); else groups.push({ title: t, items: [s] }); }
  const link = o.type === 'rwt' && typeof o.params.roof_building_id?.value === 'string' ? doc.objects.find((x) => x.id === o.params.roof_building_id.value && x.type === 'building') : undefined;
  const roof = link ? dimOf(link, 'roof_plan_area_m2') : null, basis = link && typeof link.params.roof_area_basis?.value === 'string' ? String(link.params.roof_area_basis.value) : 'NOT SET';
  return (
    <div className="dz-groups">
      {groups.map((g) => (
        <details key={g.title} open={!g.title.includes('(optional)')}>
          <summary className="note"><b>{g.title || 'Parameters'}</b></summary>
          {g.items.map((s) => <FieldRow key={s.key} o={o} spec={s} doc={doc} run={run} />)}
          {g.title === 'Roof and reuse' && link && (
            <div className="note">
              LINKED ROOF AREA {roof === null ? 'NOT SET' : `${roof.toFixed(1)} m²`} · BASIS {basis}
              {roof !== null && <> <button className="view" onClick={() => run('set_param', { key: 'connected_roof_area_m2', value: roof, basis: 'user', ref: `ROOF PLAN AREA OF ${link.id}, ${basis}` }, 'Use linked roof area')}>Connect the whole roof</button></>}
            </div>
          )}
        </details>
      ))}
    </div>
  );
}

// ---- retaining wall: levels per vertex and the screening -----------------------------------------------------------------------------
export function WallLevels({ o, run }: { o: SiteObject; run: Run }) {
  if (o.type !== 'retaining_wall' || o.geometry.kind !== 'polyline') return null;
  const n = o.geometry.pts.length, r = o.vertex_rls;
  const cell = (i: number, which: 'top' | 'bottom') => {
    const v = r ? r[which][i] : null;
    return <input className="search" aria-label={`${which} RL at vertex ${i + 1}`} placeholder="NOT SET" defaultValue={v === null || v === undefined ? '' : String(v)} key={`${o.id}${which}${i}${v}`}
      onBlur={(e) => { const cur = v === null || v === undefined ? '' : String(v); if (e.target.value !== cur) run('set_vertex_rl', { index: i, [which]: e.target.value.trim() === '' ? null : e.target.value }, 'Set wall levels'); }}
      onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />;
  };
  return (
    <details open>
      <summary className="note"><b>Levels at each vertex (m RL)</b></summary>
      <table className="ck-table"><thead><tr><th>Vertex</th><th>Top RL</th><th>Bottom RL</th><th>Height</th></tr></thead><tbody>
        {Array.from({ length: n }, (_, i) => { const h = wallHeightAt(o, i); return <tr key={i}><td>{i + 1}</td><td>{cell(i, 'top')}</td><td>{cell(i, 'bottom')}</td><td>{h === null ? 'NOT SET' : `${h.toFixed(2)} m`}</td></tr>; })}
      </tbody></table>
      <div className="note">The retained height at a vertex is the top RL minus the bottom RL. A vertex with no levels uses the uniform height above, or is NOT SET.</div>
      {r && <button className="view" onClick={() => run('clear_vertex_rls', {}, 'Clear wall levels')}>Clear vertex levels</button>}
    </details>
  );
}

interface Screening { label: string; status: string; reason: string; max_height_m: number | null; notes: string[]; missing: { key: string; ref: string }[]; used: { key: string; value: number; unit: string; basis: string }[];
  segments: { index: number; length_m: number; height_m: number | null; ka: number | null; active_force_kn_per_m: number | null; fs_sliding: number | null; fs_overturning: number | null; screening_ok: boolean | null }[]; limits?: { min_fs_sliding: number; min_fs_overturning: number } }
export function ScreeningBox({ check }: { check: CheckEntry | undefined }) {
  const s = check?.screening as Screening | undefined;
  if (!s) return null;
  const f = (v: number | null, d = 2) => (v === null ? 'NOT SET' : v.toFixed(d));
  return (
    <div className="screen-box" role="note" aria-label="Retaining wall screening">
      <div><b>{s.label}</b></div>
      {s.status !== 'SCREENED' ? <div className="note">NOT EVALUATED: {s.reason}</div> : (
        <table className="ck-table"><thead><tr><th>Seg</th><th>Length</th><th>Height</th><th>Ka</th><th>FS slide</th><th>FS overturn</th><th>Result</th></tr></thead><tbody>
          {s.segments.map((g) => <tr key={g.index} className={g.screening_ok === false ? 'ck-fail' : undefined}><td>{g.index + 1}</td><td>{f(g.length_m)}</td><td>{f(g.height_m)}</td><td>{f(g.ka, 3)}</td><td>{f(g.fs_sliding)}</td><td>{f(g.fs_overturning)}</td><td>{g.screening_ok === null ? 'NOT SCREENED' : g.screening_ok ? 'WITHIN LIMITS' : 'BELOW LIMIT'}</td></tr>)}
        </tbody></table>
      )}
      {s.missing.length > 0 && <div className="note">UNRESOLVED: {s.missing.map((m) => m.key).join(', ')}</div>}
      {s.used.length > 0 && <div className="note">USED: {s.used.map((u) => `${u.key} ${u.value} ${u.unit} (${u.basis})`).join(' · ')}</div>}
      {s.notes.map((n) => <div className="note" key={n}>{n}</div>)}
    </div>
  );
}

// ---- values the server resolved, and values computed in the browser -----------------------------------------------------------------------
export function ValuesBox({ o, values, ctl }: { o: SiteObject; values: CheckValue[]; ctl: DesignController }) {
  const comp = computedFor(o, ctl.terrain.available ? ctl.terrain.sample : null);
  const server = values.filter((v) => !comp.some((c) => c.key === v.key));
  if (!comp.length && !server.length) return null;
  return (
    <div className="readout" style={{ marginTop: 8 }} aria-live="polite">
      {comp.map((c) => <div key={c.key} style={{ display: 'contents' }}><span title={c.calc}>{c.label}</span><span className={c.status === 'FAIL' ? 'ck-fail' : undefined}>{c.status === 'FAIL' ? <b>FAIL</b> : c.value}{c.calc && <div className="note">{c.calc}</div>}</span></div>)}
      {server.map((v) => <div key={v.key} style={{ display: 'contents' }}><span>{v.label}</span><span>{typeof v.value === 'number' ? `${v.value} ${v.unit}` : String(v.value)} <span className={'badge ' + basisClass(v.basis)} title={v.ref}>{v.basis}</span>{v.stamp && <div className="note">{v.stamp}</div>}</span></div>)}
    </div>
  );
}

// ---- optional tank sizing ----------------------------------------------------------------------------------------------------------------
const nums = (s: string): number[] | null => { const t = s.split(/[\s,;]+/).filter(Boolean).map(Number); return t.length && t.every((x) => Number.isFinite(x)) ? t : null; };
export function RwtSizeSection({ o, ds, ctl, locked }: { o: SiteObject; ds: DesignState; ctl: DesignController; locked: boolean }) {
  const [station, setStation] = useState(''), [rain, setRain] = useState(''), [cands, setCands] = useState(''), [gf, setGf] = useState('');
  const p = ds.rwtSize && ds.rwtSize.id === o.id ? ds.rwtSize : null, r = p?.result ?? null;
  const rainNums = nums(rain);
  return (
    <section aria-label="Size this tank">
      <h2>Size this tank (optional)</h2>
      <div className="note">Runs the daily mass balance only when EVERY input is entered on the tank or resolves from a requirement key. Otherwise it lists what is UNRESOLVED and sizes nothing. No rainfall source is loaded: enter the twelve monthly totals and the station.</div>
      <fieldset className="dz-fs" disabled={locked}>
        <div className="dz-param dz-wide"><label htmlFor="rs-station">Rainfall station</label><input id="rs-station" className="search" value={station} onChange={(e) => setStation(e.target.value)} placeholder="NOT SET" /></div>
        <div className="dz-param dz-wide"><label htmlFor="rs-rain">Monthly rainfall (mm, 12 values)</label><input id="rs-rain" className="search" value={rain} onChange={(e) => setRain(e.target.value)} placeholder="NOT SET" /></div>
        <div className="dz-param dz-wide"><label htmlFor="rs-cands">Candidate sizes (L, optional)</label><input id="rs-cands" className="search" value={cands} onChange={(e) => setCands(e.target.value)} placeholder="FROM rwt.candidate_sizes_l" /></div>
        <div className="dz-param dz-wide"><label htmlFor="rs-gf">Garden monthly factors (12, optional)</label><input id="rs-gf" className="search" value={gf} onChange={(e) => setGf(e.target.value)} placeholder="FROM rwt.demand.garden_monthly_factor" /></div>
        <button className="view" disabled={p?.status === 'pending'} onClick={() => { void ctl.sizeTank(o.id, { rainfall: rainNums && rainNums.length === 12 ? rainNums : null, station, candidates: nums(cands), gardenFactor: nums(gf) }); }}>Size this tank</button>
      </fieldset>
      {p?.status === 'pending' && <div className="note" role="status">SIZING…</div>}
      {p?.status === 'error' && <div className="note" style={{ color: 'var(--bad)' }} role="alert">SIZING ERROR: {p.error}</div>}
      {r && r.status === 'UNRESOLVED' && (
        <div role="note"><b>{r.label}</b>
          <ul className="ck-list">{(r.missing ?? []).map((m) => <li key={m.input}><span className="badge basis-unresolved">UNRESOLVED</span> <b>{m.input}</b><div className="note">{m.why}</div></li>)}</ul></div>
      )}
      {r && r.status === 'SIZED' && r.chosen && (
        <div className="readout" aria-live="polite">
          <span>{r.label}</span><span />
          <span>CHOSEN TANK</span><span>{r.chosen.volume_l} L, RELIABILITY {r.chosen.reliability_pct.toFixed(1)} %</span>
          <span>TARGET</span><span>{r.target_reliability_pct === null || r.target_reliability_pct === undefined ? 'UNRESOLVED' : `${r.target_reliability_pct} %`}{r.target_met === false ? ' · NOT MET BY ANY CANDIDATE' : ''}</span>
          <span>ANNUAL YIELD / DEMAND</span><span>{r.chosen.annual_yield_l.toFixed(0)} L / {r.chosen.annual_demand_l.toFixed(0)} L</span>
          <span>RAINFALL</span><span>{r.inputs?.rainfall_station} · {r.inputs?.rainfall_basis}</span>
        </div>
      )}
      {r && (r.optional_unresolved ?? []).length > 0 && <div className="note">NOT USED (UNRESOLVED): {(r.optional_unresolved ?? []).map((m) => m.input).join(', ')}</div>}
    </section>
  );
}

export { OpError };
