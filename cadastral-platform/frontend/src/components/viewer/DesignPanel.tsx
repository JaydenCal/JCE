'use client';
import { useState } from 'react';
import type { CatalogueItem } from '@/lib/viewer/types';
import type { DesignController, DesignState } from '@/lib/site/designController';
import type { ImportEndpoint, LotInfo } from '@/lib/site/buildingImport';
import { READ_ONLY_BUILDING_PARAMS } from '@/lib/site/buildings';
import { BuildingImportBox, BuildingInfo, FeatureTools } from './BuildingTools';
import { DrivewaySection, GradingSection } from './EngineSections';
import { ChecksSection, ObjectFields, RwtSizeSection, ScreeningBox, ValuesBox, WallLevels } from './ObjectSections';
import { fieldsFor } from '@/lib/site/siteObjects';
import { FFL_NOT_SET, HEIGHT_NOT_SET, POOL_BARRIER_LABEL, dimOf, levelOf } from '@/lib/site/types';
import { OpError } from '@/lib/site/ops';
import { LOADING_NOTE, type AutosaveState, type LoadState } from '@/lib/site/persist';
import { worstSeverity } from '@/lib/site/checks';
import {
  BASIS_LABEL, DIMENSIONS_NOT_SET, OBJECT_KINDS, ORIGIN_LABEL, PANEL_KEYS, PARAM_ENUMS, STATUSES, STATUS_LABEL, TARGET_NOT_SET, WIDTH_NOT_SET, dimKeys, dimensionsSet, verticesOf,
  type ObjectType, type SiteDesign, type SiteObject, type Status,
} from '@/lib/site/types';

export interface DesignPanelProps {
  ds: DesignState; doc: SiteDesign; ctl: DesignController;
  /** null = this view does not save (demo page): the design lives in memory only */
  save: AutosaveState | null;
  /** runs a conflict resolution; resolves to null on success or to the error text, which the panel shows */
  onResolve?: (how: 'reload' | 'keep') => Promise<string | null> | string | null | void;
  /** first load of the saved design (null on the demo page). The tools are read only until it is 'ready'. */
  gate?: LoadState | null;
  onRetryLoad?: () => void;
  /** the user confirmed editing a NEW local document after the saved design failed to load */
  onConfirmLocal?: () => void;
  /** where buildings are imported (the server route) and the lot a PDF is aligned to; null = no server on this page */
  importer?: { ep: ImportEndpoint; lot: LotInfo } | null;
  /** the retail catalogue, for outdoor furniture */
  catalogue?: CatalogueItem[];
}
const GROUPS: { title: string; types: ObjectType[] }[] = [
  { title: 'Points', types: ['tree', 'rwt', 'stormwater_pit', 'osd'] },
  { title: 'Lines', types: ['retaining_wall', 'infiltration_trench', 'stormwater_pipe', 'service_trace', 'driveway', 'pool_barrier', 'overflow_route'] },
  { title: 'Areas', types: ['landscape_area', 'grading_area', 'osd_basin'] },
];
const GRIDS = [0, 0.1, 0.25, 0.5, 1, 2, 5];
export const SURFACE_LENGTH_UNAVAILABLE = 'SURFACE LENGTH: DATA NOT AVAILABLE';
const m = (v: number | null, d = 2) => (v === null ? 'DATA NOT AVAILABLE' : `${v.toFixed(d)} m`);
export const fmtDate = (iso?: string) => { const x = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? ''); return x ? `${x[3]}/${x[2]}/${x[1]}` : ''; };

function Issues({ o }: { o: SiteObject }) {
  if (!o.issues.length) return null;
  return <>{o.issues.map((i) => <span key={i.code + i.message} className={'badge sev-' + i.severity} title={i.message}>{i.severity === 'blocking' ? 'BLOCKING' : i.severity === 'warning' ? 'WARNING' : 'INFO'}: {i.message}</span>)}</>;
}

function Props({ o, doc, ds, ctl, locked }: { o: SiteObject; doc: SiteDesign; ds: DesignState; ctl: DesignController; locked: boolean }) {
  const [err, setErr] = useState(''), [k, setK] = useState(''), [v, setV] = useState('');
  const run = (name: string, args: Record<string, unknown>, label?: string) => { try { ctl.store.run(name, { id: o.id, ...args }, label); setErr(''); } catch (e) { setErr(e instanceof OpError ? e.message : String(e)); } };
  const typed = fieldsFor(o).length > 0, typedKeys = new Set(fieldsFor(o).map((f) => f.key));
  const keys = [...new Set([...(typed ? [] : dimKeys(o)), ...(PANEL_KEYS[o.type] ?? []), ...(o.type === 'building' ? ['building_use', 'ffl_rl', 'height_m'] : []), ...Object.keys(o.params)])].filter((k) => !typedKeys.has(k));
  const values = ds.checks.result?.values[o.id] ?? [], wall = ds.checks.result?.checks.find((c) => c.object_id === o.id && c.code === 'WALL_SCREENING');
  const parse = (s: string): unknown => (s.trim() === '' ? null : Number.isFinite(Number(s)) && s.trim() !== '' ? Number(s) : s.trim());
  const set = (key: string, s: string) => run('set_param', { key, value: parse(s) }, 'Set parameter');
  return (
    <fieldset className="sel dz-sel" style={{ minWidth: 0, margin: 0 }} disabled={locked}>
      <b>{OBJECT_KINDS[o.type].label}</b>{o.label ? <span className="note"> · {o.label.toUpperCase()}</span> : null}
      <div className="note">ID {o.id} · {ORIGIN_LABEL[o.origin]}{o.accepted ? ` · ${o.accepted.toUpperCase()}` : ''}{o.verified ? ` · VERIFIED ${fmtDate(o.verified_on)}` : ' · UNVERIFIED'}</div>
      <div className="row dz-row"><label htmlFor="dz-status">Status</label>
        <select id="dz-status" className="search" value={o.status} onChange={(e) => run('set_status', { status: e.target.value })}>{STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}</select></div>
      {typed && <ObjectFields o={o} doc={doc} run={run} />}
      <WallLevels o={o} run={run} />
      <div className="dz-params">
        {keys.map((key) => {
          const p = o.params[key], options = PARAM_ENUMS[`${o.type}.${key}`], ro = o.type === 'building' && READ_ONLY_BUILDING_PARAMS.has(key);
          const cur = p && p.value !== null ? String(p.value) : '';
          if (options) return (
            <div className="dz-param" key={key}>
              <label htmlFor={'dz-p-' + key}>{key}</label>
              <select id={'dz-p-' + key} className="search" value={cur} disabled={ro} onChange={(e) => set(key, e.target.value)}>
                <option value="">NOT SET</option>
                {options.map((v) => <option key={v} value={v}>{v.replace(/_/g, ' ').toUpperCase()}</option>)}
              </select>
              <span className={'badge basis-' + (p ? p.basis : 'unresolved')} title={p?.ref}>{BASIS_LABEL[p ? p.basis : 'unresolved']}</span>
            </div>
          );
          return (
            <div className="dz-param" key={key}>
              <label htmlFor={'dz-p-' + key}>{key}</label>
              <input id={'dz-p-' + key} className="search" defaultValue={p && p.value !== null ? String(p.value) : ''} key={o.id + key + JSON.stringify(p)} placeholder="NOT SET"
                disabled={ro || (!!p && (p.basis === 'lga_rule' || p.basis === 'platform_default'))}
                onBlur={(e) => { if (e.target.value !== (p && p.value !== null ? String(p.value) : '')) set(key, e.target.value); }}
                onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
              <span className={'badge basis-' + (p ? p.basis : 'unresolved')} title={p?.ref}>{BASIS_LABEL[p ? p.basis : 'unresolved']}</span>
            </div>
          );
        })}
        <div className="dz-param"><input className="search" aria-label="New parameter key" placeholder="new_key" value={k} onChange={(e) => setK(e.target.value)} />
          <input className="search" aria-label="New parameter value" placeholder="value" value={v} onChange={(e) => setV(e.target.value)} />
          <button className="view" disabled={!k} onClick={() => { set(k, v); setK(''); setV(''); }}>Add</button></div>
      </div>
      {!keys.length && !typed && <div className="note">No parameters set. Dimensions are never defaulted.</div>}
      {(o.type === 'pool' || o.type === 'pool_barrier') && <div className="note" role="note"><b>{POOL_BARRIER_LABEL}</b> <span className="badge basis-unresolved">UNRESOLVED</span></div>}
      <ValuesBox o={o} values={values} ctl={ctl} />
      <ScreeningBox check={wall} />
      {o.building && <BuildingInfo o={o} ctl={ctl} />}
      <div style={{ marginTop: 6 }}><Issues o={o} /></div>
      {err && <div className="note" style={{ color: 'var(--bad)' }} role="alert">{err}</div>}
      <div className="btns" style={{ marginTop: 8 }}>
        <button className="view" onClick={() => run('rotate_object', { angle_deg: -15 }, 'Rotate object')}>Rotate -15°</button>
        <button className="view" onClick={() => run('rotate_object', { angle_deg: 15 }, 'Rotate object')}>Rotate +15°<kbd>R</kbd></button>
        <button className="view" onClick={() => { try { const r = ctl.store.run('duplicate_object', { id: o.id, dx: 2, dy: 2 }); ctl.select(r.id as string); setErr(''); } catch (e) { setErr(String(e)); } }}>Duplicate (2 m offset)</button>
        <button className="view" onClick={() => ctl.deleteSelection()}>Delete<kbd>Del</kbd></button>
        {o.origin === 'ai_proposal' && <><button className="view" onClick={() => run('accept_proposal', {})}>Accept</button><button className="view" onClick={() => run('reject_proposal', {})}>Reject</button></>}
      </div>
      {o.geometry.kind !== 'point' && <div className="note" style={{ marginTop: 6 }}>{verticesOf(o.geometry).length} vertices. Drag a handle to move it, drag a diamond to add one, select a handle and press Del to remove it.</div>}
    </fieldset>
  );
}

/** Text of the status line: the first load comes before the save state. */
export function statusLine(save: AutosaveState | null, gate: LoadState | null | undefined): string {
  if (gate?.phase === 'loading') return LOADING_NOTE;
  if (gate?.phase === 'failed') return gate.error;
  if (gate?.local) return `EDITING A NEW LOCAL DOCUMENT. ${gate.error}`;
  if (save === null) return 'IN MEMORY ONLY: this design is not saved.';
  const base = save.status === 'idle' ? 'NO CHANGES' : save.message || save.status.toUpperCase();
  return save.status === 'saved' && save.savedAt ? `${base} ${fmtDate(save.savedAt)}` : base;
}

export function DesignPanel({ ds, doc, ctl, save, onResolve, gate, onRetryLoad, onConfirmLocal, importer, catalogue }: DesignPanelProps) {
  const sel = doc.objects.find((o) => o.id === ds.selectedId) ?? null, h = ds.history, r = ds.readout, locked = ds.locked !== null;
  const [resolveErr, setResolveErr] = useState(''), [busy, setBusy] = useState(false), [confirming, setConfirming] = useState(false);
  const resolve = async (how: 'reload' | 'keep') => {
    setBusy(true); setResolveErr('');
    try { const e = await onResolve?.(how); if (typeof e === 'string' && e) setResolveErr(e); }
    catch (e) { setResolveErr(`${how === 'reload' ? 'THE SAVED COPY COULD NOT BE RELOADED' : 'THE SAVED VERSION COULD NOT BE CHECKED'}: ${e instanceof Error ? e.message : String(e)}`); }
    finally { setBusy(false); }
  };
  return (
    <>
      <section>
        <h2>Site design</h2>
        <div className="note" role="status">{statusLine(save, gate)}</div>
        {gate?.phase === 'loading' && <div className="note">The design tools are read only until the saved design has loaded.</div>}
        {gate?.phase === 'failed' && (
          <div style={{ marginTop: 6 }} role="alert">
            <div className="note">The design tools stay read only. Try again, or start a new local document.</div>
            {!confirming ? (
              <div className="btns" style={{ marginTop: 6 }}>
                <button className="view" onClick={() => onRetryLoad?.()}>Try loading again</button>
                <button className="view" onClick={() => setConfirming(true)}>Edit a new local document</button>
              </div>
            ) : (
              <>
                <div className="note">A new, empty document will be edited. The saved design is not shown and is not replaced unless you later choose to keep your copy after a version conflict. Continue?</div>
                <div className="btns" style={{ marginTop: 6 }}>
                  <button className="view" onClick={() => { setConfirming(false); onConfirmLocal?.(); }}>Yes, edit a new local document</button>
                  <button className="view" onClick={() => setConfirming(false)}>Cancel</button>
                </div>
              </>
            )}
          </div>
        )}
        {save?.status === 'conflict' && onResolve && <div className="btns" style={{ marginTop: 6 }}><button className="view" disabled={busy} onClick={() => { void resolve('reload'); }}>Reload saved copy</button><button className="view" disabled={busy} onClick={() => { void resolve('keep'); }}>Keep my copy and save</button></div>}
        {resolveErr && <div className="note" style={{ color: 'var(--bad)' }} role="alert">{resolveErr}</div>}
        {!ds.terrainAvailable && <div className="note">TERRAIN DATA NOT AVAILABLE: objects sit on a placeholder ground.</div>}
        {!ds.lotAvailable && <div className="note">LOT BOUNDARY NOT AVAILABLE: the outside lot check is not run.</div>}
      </section>
      <section>
        <h2>Tools</h2>
        <fieldset className="dz-fs" disabled={locked}>
        <div className="btns">
          <button className={'view' + (ds.tool === 'select' ? ' on' : '')} aria-pressed={ds.tool === 'select'} onClick={() => ctl.setTool('select')}>Select<kbd>Esc</kbd></button>
          <button className="view" onClick={() => ctl.undo()} disabled={!h.canUndo} title={h.undoLabel ?? ''}>Undo<kbd>Ctrl+Z</kbd></button>
          <button className="view" onClick={() => ctl.redo()} disabled={!h.canRedo} title={h.redoLabel ?? ''}>Redo<kbd>Ctrl+Shift+Z</kbd></button>
        </div>
        <div className="note" style={{ margin: '4px 0 8px' }}>{h.undoLabel ? `Next undo: ${h.undoLabel}` : 'Nothing to undo'}{h.redoLabel ? ` · next redo: ${h.redoLabel}` : ''}</div>
        {GROUPS.map((g) => (
          <div key={g.title} style={{ marginBottom: 8 }}>
            <div className="note">{g.title}</div>
            <div className="chips" style={{ margin: '4px 0' }}>
              {g.types.map((t) => <button key={t} className={'chip' + (ds.objectType === t && ds.tool !== 'select' ? ' on' : '')} aria-pressed={ds.objectType === t && ds.tool !== 'select'} onClick={() => ctl.startFor(t)}>{OBJECT_KINDS[t].label}</button>)}
            </div>
          </div>
        ))}
        <FeatureTools ds={ds} ctl={ctl} catalogue={catalogue ?? []} />
        <BuildingImportBox ds={ds} ctl={ctl} importer={importer ?? null} />
        <div className="row dz-row"><label htmlFor="dz-grid">Grid snap</label>
          <select id="dz-grid" className="search" value={ds.grid} onChange={(e) => ctl.setGrid(Number(e.target.value))}>{GRIDS.map((g) => <option key={g} value={g}>{g === 0 ? 'OFF' : `${g} m`}</option>)}</select></div>
        <div className="row dz-row"><label htmlFor="dz-new">New objects</label>
          <select id="dz-new" className="search" value={ds.newStatus} onChange={(e) => ctl.setNewStatus(e.target.value as Status)}>{STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}</select></div>
        <div className="note">{ds.hint}</div>
        <div className="note">Snaps to boundary and object vertices, then edges, then the grid. Hold Alt to turn snapping off.{ds.snapLabel ? ` ${ds.snapLabel}` : ''}</div>
        {ds.message && <div className="note" style={{ color: 'var(--bad)' }} role="alert">{ds.message}</div>}
        {(ds.dragInfo || ds.hoverText) && <div className="note" role="status" aria-live="polite" style={ds.hoverText && !ds.dragInfo ? { color: 'var(--bad)' } : undefined}>{ds.dragInfo || ds.hoverText}</div>}
        {r && (
          <div style={{ marginTop: 8 }} aria-live="polite">
            <div className="readout">
              <span>{r.live ? 'DRAWING' : 'SELECTED'}</span><span>{r.vertices} points</span>
              <span>{r.kind === 'polygon' ? 'PERIMETER' : 'LENGTH (PLAN)'}</span><span>{m(r.planLength)}</span>
              {r.surfaceLength !== null && <><span>SURFACE LENGTH</span><span>{m(r.surfaceLength)}</span></>}
              {r.kind === 'polygon' && <><span>AREA (PLAN)</span><span>{r.area === null ? 'NEEDS 3 POINTS' : `${r.area.toFixed(2)} m²`}</span></>}
            </div>
            {r.surfaceLength === null && <div className="note" style={{ marginTop: 2 }}>{SURFACE_LENGTH_UNAVAILABLE}</div>}
          </div>
        )}
        </fieldset>
      </section>
      <section>
        <h2>Objects ({doc.objects.length})</h2>
        {!doc.objects.length ? <div className="note">No objects yet. Choose a tool and click in the model.</div> : (
          <table><thead><tr><th>Type</th><th>Status</th><th>Origin</th><th>Issues</th></tr></thead><tbody>
            {doc.objects.map((o) => {
              const w = worstSeverity(o.issues);
              return (
                <tr key={o.id} className={'dz-obj' + (o.id === ds.selectedId ? ' on' : '')} onClick={() => ctl.select(o.id)}>
                  <td><button className="chip" aria-pressed={o.id === ds.selectedId} onClick={(e) => { e.stopPropagation(); ctl.select(o.id); }}>{OBJECT_KINDS[o.type].label}</button>{!dimensionsSet(o) ? <div className="note">{o.type === 'driveway' ? WIDTH_NOT_SET : o.type === 'grading_area' ? TARGET_NOT_SET : DIMENSIONS_NOT_SET}</div> : null}{o.type === 'building' ? <>{levelOf(o, 'ffl_rl') === null && <div className="note">{FFL_NOT_SET}</div>}{dimOf(o, 'height_m') === null && <div className="note">{HEIGHT_NOT_SET}</div>}</> : null}</td>
                  <td>{STATUS_LABEL[o.status]}</td>
                  <td>{ORIGIN_LABEL[o.origin]}{o.accepted ? <div className="note">{o.accepted.toUpperCase()}</div> : null}</td>
                  <td>{o.issues.length ? <span className={'badge sev-' + w}>{o.issues.length}</span> : <span className="note">NONE</span>}</td>
                </tr>
              );
            })}
          </tbody></table>
        )}
      </section>
      <ChecksSection doc={doc} ds={ds} ctl={ctl} />
      {sel && <section><h2>Properties</h2><Props o={sel} doc={doc} ds={ds} ctl={ctl} key={sel.id} locked={locked} /></section>}
      {sel && sel.type === 'rwt' && <RwtSizeSection o={sel} ds={ds} ctl={ctl} locked={locked} key={'rs' + sel.id} />}
      {sel && ds.driveway && ds.driveway.id === sel.id && <DrivewaySection p={ds.driveway} o={sel} doc={doc} ctl={ctl} locked={locked} key={'dv' + sel.id} />}
      {sel && ds.grading && ds.grading.id === sel.id && <GradingSection p={ds.grading} o={sel} locked={locked} key={'gr' + sel.id} />}
    </>
  );
}
