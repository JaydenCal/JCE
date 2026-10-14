'use client';
/**
 * Design tab, stage 9: the stormwater helper. The catchment table, the routing, the design rainfall, the OSD sizing steps, the infiltration check, the overland flow toggle and the
 * list of everything that is missing with how to supply it. Every value carries a basis badge. The server computes; this panel only shows what it answered.
 */
import { useState } from 'react';
import type { DesignController } from '@/lib/site/designController';
import {
  basisBadge, catchmentRows, infiltrationView, missingGroups, osdView, overlandView, peakView, prePostView, rainfallView, routingView,
  type StepView, type StormwaterResult, type Tone, type ValueView,
} from '@/lib/site/stormwater';
import type { SwState } from '@/lib/site/stormwaterSession';
import { FLOW_LABEL } from '@/lib/site/overlandScene';

const toneClass: Record<Tone, string> = { ok: 'basis-user', warn: 'basis-platform_default', bad: 'basis-unresolved', neutral: 'basis-derived' };
export function Badge({ basis, title }: { basis: string; title?: string }) {
  const b = basisBadge(basis);
  return <span className={'badge ' + toneClass[b.tone]} title={title}>{b.text}</span>;
}
function Val({ v, label }: { v: ValueView; label?: string }) {
  return (
    <span>
      {label ? <span className="note">{label} </span> : null}<b>{v.text}</b> <Badge basis={v.basis.text} title={v.ref} />
      {v.stamp ? <span className="note"> {v.stamp}</span> : null}
      {v.key ? <span className="note"> {v.key}</span> : null}
      {v.how ? <div className="note">HOW TO SUPPLY IT: {v.how}</div> : null}
    </span>
  );
}
function Steps({ steps }: { steps: StepView[] }) {
  if (!steps.length) return null;
  return (
    <ol className="sw-steps">
      {steps.map((s) => (
        <li key={s.id}>
          <b>{s.title}</b>
          <div className="note">FORMULA: {s.formula}</div>
          <table className="ck-table"><tbody>
            {s.inputs.map((i) => <tr key={i.symbol + i.name}><td>{i.name} ({i.symbol})</td><td><Val v={i} /></td></tr>)}
          </tbody></table>
          <div role="status">RESULT: <b>{s.result}</b></div>
          {s.table.length > 0 && (
            <details><summary className="note">Each duration searched</summary>
              <table className="ck-table"><thead><tr><th>Duration (min)</th><th>I (mm/h)</th><th>Qp (L/s)</th><th>Storage (m3)</th></tr></thead><tbody>
                {s.table.map((r, k) => <tr key={k}><td>{r.duration_min}</td><td>{r.intensity_mm_h}</td><td>{r.qp_l_s}</td><td>{r.storage_m3}</td></tr>)}
              </tbody></table></details>
          )}
        </li>
      ))}
    </ol>
  );
}

type Setter = <K extends keyof SwState['form']>(k: K, v: SwState['form'][K]) => void;
function Field({ id, label, unit, value, onChange, help, placeholder = 'NOT SET' }: { id: string; label: string; unit?: string; value: string; onChange: (v: string) => void; help?: string; placeholder?: string }) {
  return (
    <div className="dz-param dz-wide">
      <label htmlFor={id} title={help}>{label}{unit ? ` (${unit})` : ''}</label>
      <input id={id} className="search" value={value} placeholder={placeholder} inputMode="decimal" onChange={(e) => onChange(e.target.value)} />
      <span className="badge basis-user">{value.trim() === '' ? 'FROM RULE' : 'USER'}</span>
    </div>
  );
}

function Entries({ sw, ctl, res }: { sw: SwState; ctl: DesignController; res: StormwaterResult | null }) {
  const s = ctl.stormwater, f = sw.form, set: Setter = (k, v) => s.setField(k, v);
  const surfaces = res ? [...new Map(res.catchment.rows.filter((r) => r.surface !== 'not_set').map((r) => [r.surface, r.surface_label])).entries()] : [];
  return (
    <details open>
      <summary className="note"><b>Your entries</b></summary>
      <div className="note">A field left empty is read from its requirement key. If that is UNRESOLVED, the calculation that needs it is NOT EVALUATED and says so.</div>
      <Field id="sw-aep" label="Design AEP" unit="%" value={f.design_aep_pct} onChange={(v) => set('design_aep_pct', v)} help="Must be a column of the rainfall table." />
      <Field id="sw-tcpre" label="Time of concentration, pre development" unit="min" value={f.tc_pre_min} onChange={(v) => set('tc_pre_min', v)} />
      <Field id="sw-tcpost" label="Time of concentration, post development" unit="min" value={f.tc_post_min} onChange={(v) => set('tc_post_min', v)} />
      <Field id="sw-psd" label="Permissible site discharge (optional)" unit="L/s" value={f.psd_l_s} onChange={(v) => set('psd_l_s', v)} help="Left empty: the LGA rule, else the stamped platform default." />
      <div className="dz-param dz-wide"><label htmlFor="sw-method">OSD sizing method</label>
        <select id="sw-method" className="search" value={f.osd_method} onChange={(e) => set('osd_method', e.target.value)}>
          <option value="">FROM RULE (stormwater.osd_method)</option><option value="mass_balance_modified_rational">MASS BALANCE, MODIFIED RATIONAL</option><option value="user_ssr">SITE STORAGE REQUIREMENT AS ENTERED</option>
        </select><span className="badge basis-user">{f.osd_method ? 'USER' : 'FROM RULE'}</span></div>
      <Field id="sw-ssr" label="Site storage requirement" unit="m3" value={f.ssr_m3} onChange={(v) => set('ssr_m3', v)} />
      <Field id="sw-ssrha" label="Site storage requirement per hectare" unit="m3/ha" value={f.ssr_m3_per_ha} onChange={(v) => set('ssr_m3_per_ha', v)} />
      <div className="dz-param dz-wide"><label htmlFor="sw-ssrbasis">Per hectare value applies to</label>
        <select id="sw-ssrbasis" className="search" value={f.ssr_area_basis} onChange={(e) => set('ssr_area_basis', e.target.value as typeof f.ssr_area_basis)}>
          <option value="">NOT SET</option><option value="lot">THE LOT AREA</option><option value="osd_catchment">THE AREA DRAINING TO THE OSD</option></select></div>
      <div className="dz-param dz-wide"><label htmlFor="sw-tankex">Tank detention excluded from OSD volume</label>
        <select id="sw-tankex" className="search" value={f.rainwater_tank_excluded} onChange={(e) => set('rainwater_tank_excluded', e.target.value as typeof f.rainwater_tank_excluded)}>
          <option value="">FROM RULE</option><option value="true">EXCLUDED</option><option value="false">COUNTED</option></select></div>
      <Field id="sw-cd" label="Orifice discharge coefficient Cd" value={f.discharge_coefficient} onChange={(v) => set('discharge_coefficient', v)} help="No orifice size is given while Cd is UNRESOLVED." />
      <Field id="sw-head" label="Head to the orifice centre" unit="m" value={f.orifice_head_m} onChange={(v) => set('orifice_head_m', v)} help="Left empty: the top water level less the orifice invert of a single OSD." />
      <Field id="sw-tmax" label="Longest duration searched" unit="min" value={f.search_max_duration_min} onChange={(v) => set('search_max_duration_min', v)} placeholder="1440 (SEARCH RANGE OF THIS TOOL)" />
      <div className="note"><b>Runoff coefficients</b> (for the design event, as you supply them)</div>
      {!surfaces.length && <div className="note">Run the analysis once to list the surfaces of the design.</div>}
      {surfaces.map(([id, label]) => <Field key={id} id={'sw-c-' + id} label={label} value={f.runoff[id] ?? ''} onChange={(v) => s.setRunoff(id, v)} />)}
      <div className="btns"><button className="view" onClick={() => { void s.save(); }}>Save the entries</button></div>
    </details>
  );
}

function Rainfall({ sw, ctl, res }: { sw: SwState; ctl: DesignController; res: StormwaterResult | null }) {
  const s = ctl.stormwater, [units, setUnits] = useState('');
  const r = res ? rainfallView(res.rainfall) : null, ifd = sw.data?.ifd;
  return (
    <details open>
      <summary className="note"><b>Design rainfall</b></summary>
      <div className="row dz-row"><label htmlFor="sw-src">Source</label>
        <select id="sw-src" className="search" value={sw.rainfallSource} onChange={(e) => s.setRainfallSource(e.target.value as 'upload' | 'live')}>
          <option value="upload">UPLOADED BOM IFD TABLE</option><option value="live">LIVE PROVIDER (REQUEST FORMAT UNCONFIRMED)</option></select></div>
      {sw.rainfallSource === 'live' && <div className="note">The live request format of the BoM service is UNCONFIRMED and no client is connected, so the live provider returns no value. No rainfall is guessed.</div>}
      <div className="note">Upload the IFD table CSV exported from the Bureau of Meteorology IFD page. It is stored with its file name, issue date, location and hash.</div>
      <div className="row dz-row"><label htmlFor="sw-ifd">IFD table (CSV)</label>
        <input id="sw-ifd" type="file" accept=".csv,text/csv,text/plain" onChange={(e) => { const f = e.target.files?.[0]; if (f) void s.upload('ifd', f, f.name, { declared_units: units }); e.target.value = ''; }} /></div>
      <div className="row dz-row"><label htmlFor="sw-units">If the file does not say</label>
        <select id="sw-units" className="search" value={units} onChange={(e) => setUnits(e.target.value)}><option value="">NOTHING DECLARED</option><option value="intensity_mm_h">THE TABLE IS INTENSITY (MM/H)</option><option value="depth_mm">THE TABLE IS DEPTH (MM)</option></select></div>
      {ifd && <div className="note">STORED: {String(ifd.provenance.file_name ?? '').toUpperCase()}, {ifd.durations} DURATIONS <button className="view" onClick={() => { void s.remove('ifd'); }}>Remove</button></div>}
      <div className="row dz-row"><label htmlFor="sw-arr">ARR Data Hub export (optional)</label>
        <input id="sw-arr" type="file" accept=".txt,text/plain" onChange={(e) => { const f = e.target.files?.[0]; if (f) void s.upload('arr', f, f.name); e.target.value = ''; }} /></div>
      {sw.data?.arr && <div className="note">ARR EXPORT STORED. LOSSES AND TEMPORAL PATTERNS ARE RECORDED WITH PROVENANCE AND ARE NOT USED BY THE MODIFIED RATIONAL SIZING. <button className="view" onClick={() => { void s.remove('arr'); }}>Remove</button></div>}
      {r && <div role="status"><span className={'badge ' + toneClass[r.tone]}>{r.status}</span>{r.lines.map((l) => <div key={l} className="note">{l}</div>)}</div>}
    </details>
  );
}

function Catchment({ res }: { res: StormwaterResult }) {
  const rows = catchmentRows(res), pp = prePostView(res.catchment.comparison), routes = routingView(res);
  return (
    <details open>
      <summary className="note"><b>Catchment</b> (post development)</summary>
      {!rows.length && <div className="note">No surface object in the design.</div>}
      {rows.length > 0 && (
        <table className="ck-table"><thead><tr><th>Surface</th><th>Area</th><th>Runoff coefficient</th><th>C x A</th><th>Routes to</th></tr></thead><tbody>
          {rows.map((r) => (
            <tr key={r.id} className={r.unresolved ? 'ck-fail' : undefined}>
              <td>{r.object}<div className="note">{r.surface}{r.split ? ` · ${r.split}` : ''} · {r.status}</div></td>
              <td>{r.area}<div className="note">{r.areaBasis}</div></td>
              <td><Val v={r.runoff} /></td><td>{r.ca}</td>
              <td>{r.route || 'NO ROUTE'}<div className="note">{r.routeBasis}</div></td>
            </tr>
          ))}
        </tbody></table>
      )}
      <div className="readout">
        <span>POST DEVELOPMENT AREA</span><span>{pp.post.total}</span>
        <span>SUM OF C x A</span><span>{pp.post.ca}</span>
        <span>WEIGHTED C</span><span>{pp.post.c}</span>
        <span>LOT AREA</span><span>{pp.lot}</span>
        <span>UNCLASSIFIED</span><span>{pp.unclassified}</span>
        <span>OVERLAP</span><span>{pp.overlap}</span>
      </div>
      <div className="note"><b>Pre development versus post development</b></div>
      {pp.pre ? (
        <div className="readout"><span>PRE: AREA, C x A, C</span><span>{pp.pre.total}, {pp.pre.ca}, {pp.pre.c}</span><span>POST: AREA, C x A, C</span><span>{pp.post.total}, {pp.post.ca}, {pp.post.c}</span></div>
      ) : <div className="note" role="note">{pp.preMessage}</div>}
      <div className="note"><b>Routing</b> (list: surface to tank to storage to the legal point of discharge)</div>
      {routes.map((d) => (
        <div key={d.destination} className="sw-dest"><b>{d.destination}</b> <span className="note">{d.type} · {d.area} · C x A {d.ca}</span>
          <ul>{d.rows.map((r) => <li key={r.id}>{r.surface} {r.area}: {r.path} <span className="note">({r.basis})</span></li>)}</ul></div>
      ))}
      {res.catchment.discharge_points.map((d) => <div key={d.id} className="note">LEGAL POINT OF DISCHARGE {d.label}: {(d.kind ?? 'KIND NOT SET').replace(/_/g, ' ').toUpperCase()}; BASIS {d.basis ? d.basis.toUpperCase() : 'NOT STATED'}</div>)}
    </details>
  );
}

function Osd({ res }: { res: StormwaterResult }) {
  const o = osdView(res.osd), pk = peakView(res.peak_flows);
  return (
    <details open>
      <summary className="note"><b>On site detention</b> <span className={'badge ' + toneClass[o.tone]}>{o.status}</span></summary>
      <div><Val v={o.required} label="OSD required:" /></div>
      <div><Val v={o.method} label="Method:" /></div>
      {o.message && <div className="note" role="note">{o.message}</div>}
      <table className="ck-table"><tbody>{o.inputs.map((i) => <tr key={i.symbol}><td>{i.name} ({i.symbol})</td><td><Val v={i} /></td></tr>)}</tbody></table>
      <Steps steps={o.steps} />
      <div className="readout"><span>REQUIRED STORAGE</span><span>{o.required_text}</span>{o.critical && <><span>CRITICAL DURATION</span><span>{o.critical}</span></>}</div>
      {o.provided.length > 0 && <ul>{o.provided.map((p) => <li key={p}>{p}</li>)}</ul>}
      {o.comparison && <div role="status"><span className={'badge ' + toneClass[o.comparison.tone]}>{o.comparison.tone === 'ok' ? 'ENOUGH' : o.comparison.tone === 'bad' ? 'SHORT' : 'NOT EVALUATED'}</span> {o.comparison.text}</div>}
      <div className="note"><b>Orifice</b></div>
      <div className="note">{o.orifice.formula}</div>
      <table className="ck-table"><tbody>{o.orifice.inputs.map((i) => <tr key={i.symbol}><td>{i.name} ({i.symbol})</td><td><Val v={i} /></td></tr>)}</tbody></table>
      <div role="status">{o.orifice.text}</div>
      {o.notes.map((n) => <div key={n} className="note">{n}</div>)}
      <div className="note"><b>Peak flows (rational method)</b></div>
      <div className="note">{pk.formula}</div>
      {pk.comparison && <div className="note"><b>{pk.comparison}</b></div>}
      {pk.lines.map((l) => <div key={l.label} className={l.ok ? undefined : 'note'}>{l.label}: {l.text}</div>)}
    </details>
  );
}

function Infiltration({ sw, ctl, res }: { sw: SwState; ctl: DesignController; res: StormwaterResult | null }) {
  const s = ctl.stormwater, f = sw.form, set: Setter = (k, v) => s.setField(k, v), v = res ? infiltrationView(res.infiltration) : null;
  const [src, setSrc] = useState(''), [srcDate, setSrcDate] = useState('');
  const soil = sw.data?.soil;
  return (
    <details open>
      <summary className="note"><b>Infiltration</b></summary>
      <div className="dz-param dz-wide"><label htmlFor="sw-isrc">Rate comes from</label>
        <select id="sw-isrc" className="search" value={f.infil_source} onChange={(e) => set('infil_source', e.target.value as typeof f.infil_source)}>
          <option value="">THE RATE ENTERED ON EACH TRENCH</option><option value="site_test">A SITE TEST</option><option value="indicative">AN INDICATIVE RATE FROM A STATED SOURCE</option><option value="soil_table">A ROW OF THE UPLOADED SOIL TABLE</option></select></div>
      {f.infil_source !== '' && <Field id="sw-irate" label="Rate" unit="mm/h" value={f.infil_rate} onChange={(x) => set('infil_rate', x)} />}
      {f.infil_source === 'site_test' && <>
        <div className="dz-param dz-wide"><label htmlFor="sw-idate">Test date</label><input id="sw-idate" type="date" className="search" value={f.infil_date} onChange={(e) => set('infil_date', e.target.value)} /></div>
        <div className="dz-param dz-wide"><label htmlFor="sw-imeth">Test method</label><input id="sw-imeth" className="search" value={f.infil_method} placeholder="NOT SET" onChange={(e) => set('infil_method', e.target.value)} /></div></>}
      {f.infil_source === 'indicative' && <div className="dz-param dz-wide"><label htmlFor="sw-inote">Source of the rate</label><input id="sw-inote" className="search" value={f.infil_note} placeholder="NOT SET" onChange={(e) => set('infil_note', e.target.value)} /></div>}
      {f.infil_source === 'soil_table' && (
        <div className="dz-param dz-wide"><label htmlFor="sw-isoil">Soil unit of the site</label>
          <select id="sw-isoil" className="search" value={f.infil_soil_unit} onChange={(e) => set('infil_soil_unit', e.target.value)}>
            <option value="">NOT SELECTED</option>{(soil?.rows ?? []).map((r) => <option key={r.soil_unit} value={r.soil_unit}>{r.soil_unit.toUpperCase()} ({r.rate_mm_h} MM/H)</option>)}</select></div>)}
      <div className="note">Soil table (CSV with soil_unit and rate_mm_h columns). Its rates are INDICATIVE, SITE TESTING REQUIRED.</div>
      <div className="dz-param dz-wide"><label htmlFor="sw-soilsrc">Source of the soil data</label><input id="sw-soilsrc" className="search" value={src} placeholder="NAME OF THE DATA SET" onChange={(e) => setSrc(e.target.value)} /></div>
      <div className="dz-param dz-wide"><label htmlFor="sw-soildate">Date of the soil data</label><input id="sw-soildate" type="date" className="search" value={srcDate} onChange={(e) => setSrcDate(e.target.value)} /></div>
      <div className="row dz-row"><label htmlFor="sw-soil">Soil table</label>
        <input id="sw-soil" type="file" accept=".csv,text/csv,text/plain" disabled={!src.trim()} onChange={(e) => { const fl = e.target.files?.[0]; if (fl) void s.upload('soil', fl, fl.name, { source: src, source_date: srcDate }); e.target.value = ''; }} /></div>
      {soil && <div className="note">STORED SOIL TABLE: {String(soil.provenance.source ?? '').toUpperCase()}, {soil.rows.length} ROWS. {soil.label} <button className="view" onClick={() => { void s.remove('soil'); }}>Remove</button></div>}
      {v && v.label && <div className="note"><span className="badge basis-platform_default">{v.label}</span></div>}
      {v && v.message && <div className="note" role="note">{v.message}</div>}
      {v && v.trenches.map((t) => (
        <div key={t.id} className="sw-trench"><b>TRENCH {t.label}</b> <Val v={t.rate} label="rate:" />{t.rateLabel && <div><span className="badge basis-platform_default">{t.rateLabel}</span></div>}
          <div className="readout"><span>STORAGE</span><span>{t.volume}</span><span>EMPTYING TIME</span><span>{t.time}</span></div>
          <Steps steps={t.steps} /><div role="status"><span className={'badge ' + toneClass[t.check.tone]}>{t.check.tone === 'ok' ? 'PASS' : t.check.tone === 'bad' ? 'FAIL' : 'NOT EVALUATED'}</span> {t.check.text}</div></div>
      ))}
      {v && v.status === 'NO TRENCH' && <div className="note">No infiltration trench is placed.</div>}
    </details>
  );
}

function Overland({ sw, ctl, res }: { sw: SwState; ctl: DesignController; res: StormwaterResult | null }) {
  const s = ctl.stormwater, ov = sw.overland, v = overlandView(res?.overland ?? null);
  return (
    <details open>
      <summary className="note"><b>Overland flow</b></summary>
      <div className="note" role="note"><b>{FLOW_LABEL}</b></div>
      <label className="sw-toggle"><input type="checkbox" checked={ov.on} onChange={(e) => { s.setOverland({ on: e.target.checked }); if (e.target.checked) void s.run(); }} /> Show overland flow paths and ponding in 3D</label>
      <div className="dz-param dz-wide"><label htmlFor="sw-cell" title="Computation resolution of the raster">Cell size (m)</label><input id="sw-cell" className="search" value={ov.cell} inputMode="decimal" onChange={(e) => s.setOverland({ cell: e.target.value })} /></div>
      <div className="dz-param dz-wide"><label htmlFor="sw-thr" title="Display parameter: the contributing area at which a cell is drawn as a flow path">Flow path threshold (m2)</label><input id="sw-thr" className="search" value={ov.threshold} inputMode="decimal" onChange={(e) => s.setOverland({ threshold: e.target.value })} /></div>
      <div className="dz-param dz-wide"><label htmlFor="sw-surf">Surface</label>
        <select id="sw-surf" className="search" value={ov.surface} onChange={(e) => s.setOverland({ surface: e.target.value as 'design' | 'existing' })}><option value="design">EXISTING GROUND WITH THE DESIGN</option><option value="existing">EXISTING GROUND ONLY</option></select></div>
      {v && (
        <div role="status"><span className={'badge ' + toneClass[v.tone]}>{v.status}</span>
          {v.labels.map((l) => <div key={l} className="note"><b>{l}</b></div>)}{v.summary.map((l) => <div key={l} className="note">{l}</div>)}
          {v.closedBasins.length > 0 && <><div className="note"><b>Closed basins (no outlet, reported and not filled)</b></div><ul>{v.closedBasins.map((p) => <li key={p.id}>{p.text}</li>)}</ul></>}
          {v.ponds.length > 0 && <><div className="note"><b>Ponding (depressions are reported, not filled)</b></div><ul>{v.ponds.map((p) => <li key={p.id}>{p.text}</li>)}</ul></>}
          {v.notes.map((n) => <div key={n} className="note">{n}</div>)}
          <details><summary className="note">Parameters</summary>{v.params.map((p) => <div key={p} className="note">{p}</div>)}</details></div>
      )}
    </details>
  );
}

function Missing({ res }: { res: StormwaterResult }) {
  const g = missingGroups(res.missing);
  return (
    <details open>
      <summary className="note"><b>What is missing</b> ({res.missing.length})</summary>
      {!g.length && <div className="note">Nothing is missing for the calculations that were run.</div>}
      {g.map((x) => (
        <div key={x.area}><div className="note"><b>{x.area}</b></div>
          <ul>{x.items.map((i) => <li key={i.what}>{i.what}{i.key && <span className="note"> {i.key}</span>}<div className="note">HOW TO SUPPLY IT: {i.how}</div></li>)}</ul></div>
      ))}
    </details>
  );
}

export function StormwaterSection({ sw, ctl, locked }: { sw: SwState; ctl: DesignController; locked: boolean }) {
  const res = sw.result;
  return (
    <section aria-label="Stormwater helper">
      <h2>Stormwater</h2>
      <div className="note">Catchments, design rainfall, on site detention, infiltration and overland flow. Nothing is assumed: a value comes from your entry, a cited rule or an uploaded data source, and a missing one is listed below with how to supply it.</div>
      {sw.status === 'no_server' && <div className="note" role="note">{sw.error}</div>}
      <fieldset className="dz-fs" disabled={locked || sw.status === 'no_server'}>
        <div className="btns"><button className="view" disabled={sw.status === 'pending'} onClick={() => { void ctl.stormwater.run(); }}>{sw.status === 'pending' ? 'Analysing…' : 'Run the stormwater analysis'}</button></div>
        <Rainfall sw={sw} ctl={ctl} res={res} />
        <Entries sw={sw} ctl={ctl} res={res} />
        <Infiltration sw={sw} ctl={ctl} res={res} />
        <Overland sw={sw} ctl={ctl} res={res} />
      </fieldset>
      {sw.formErrors.map((e) => <div key={e} className="note" style={{ color: 'var(--bad)' }} role="alert">{e}</div>)}
      {sw.error && sw.status !== 'no_server' && <div className="note" style={{ color: 'var(--bad)' }} role="alert">STORMWATER ERROR: {sw.error}</div>}
      {sw.busy && <div className="note" role="status">{sw.busy}…</div>}
      {sw.message && <div className="note" role="status">{sw.message}</div>}
      {res && sw.stale && <div className="note" role="alert"><b>STALE:</b> the design or your entries changed since this answer. Run the analysis again.</div>}
      {res && (
        <>
          <div className="note">ANSWER OF {res.generated_at.slice(8, 10)}/{res.generated_at.slice(5, 7)}/{res.generated_at.slice(0, 4)} · TERRAIN: {res.terrain_status}</div>
          <Catchment res={res} /><Osd res={res} /><Missing res={res} />
        </>
      )}
    </section>
  );
}
