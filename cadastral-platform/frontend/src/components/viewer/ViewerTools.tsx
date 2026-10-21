'use client';
import { useState } from 'react';
import { groupState, isOn, type LayerGroup } from '@/lib/viewer/layerGroups';
import { MEASURE_LABEL, MEASURE_MODES, type MeasureMode } from '@/lib/viewer/measure';
import type { MeasureSnapshot } from '@/lib/viewer/engine';
import { SHORTCUT_GROUPS } from '@/lib/viewer/shortcuts';
import { EXPORT_DEFS, ExportError, fetchExport, saveFile, uploadBuildingGlb, type DxfVersion, type ExportKind } from '@/lib/site/exportsApi';
import type { Endpoint } from '@/lib/site/persist';
import type { DesignController } from '@/lib/site/designController';

/** Layer toggles in groups: terrain, aerial, context, design objects by type, services by kind and stormwater results. */
export function LayerGroups({ groups, state, onToggle, onToggleGroup }: { groups: LayerGroup[]; state: Record<string, boolean>; onToggle(key: string, v: boolean): void; onToggleGroup(keys: string[], v: boolean): void }) {
  return (
    <div className="lgroups" data-layer-groups>
      {groups.map((g) => {
        const gs = groupState(g, state), keys = g.entries.map((e) => e.key);
        return (
          <fieldset key={g.id} className="lgroup" data-group={g.id}>
            <legend>
              <label><input type="checkbox" aria-label={`${g.title}, all`} checked={gs === true} ref={(el) => { if (el) el.indeterminate = gs === null; }} onChange={(e) => onToggleGroup(keys, e.target.checked)} />{g.title}</label>
            </legend>
            <div className="layers">
              {g.entries.map((e) => (
                <label key={e.key} className={e.label.length > 30 ? 'wide' : undefined} data-layer={e.key}>
                  <input type="checkbox" checked={isOn(state, e.key)} onChange={(ev) => onToggle(e.key, ev.target.checked)} />{e.label}{e.count !== undefined && <span className="cnt"> ({e.count})</span>}
                </label>
              ))}
            </div>
          </fieldset>
        );
      })}
    </div>
  );
}

/** The measurement bar over the stage: mode, readout, undo and clear. */
export function MeasureBar({ snap, onMode, onUndo, onClear, onClose }: { snap: MeasureSnapshot; onMode(m: MeasureMode): void; onUndo(): void; onClear(): void; onClose(): void }) {
  return (
    <div className="measurebar" role="group" aria-label="Measurement" data-measure>
      <div className="mrow">
        {MEASURE_MODES.map((m) => <button key={m} className={'view' + (snap.mode === m ? ' on' : '')} aria-pressed={snap.mode === m} onClick={() => onMode(m)}>{MEASURE_LABEL[m]}</button>)}
        <button className="view" disabled={!snap.canUndo} onClick={onUndo}>Undo point</button>
        <button className="view" disabled={!snap.canUndo} onClick={onClear}>Clear</button>
        <button className="view" onClick={onClose}>Done</button>
      </div>
      <div className="mhead" data-measure-result>{snap.result.headline}</div>
      {snap.result.lines.map((l, i) => <div className="mline" key={i}>{l}</div>)}
    </div>
  );
}

/** North arrow and scale bar of the top (plan) view. */
export function PlanOverlay({ bar }: { bar: { px: number; label: string } | null }) {
  return (
    <div className="planover" data-plan-overlay aria-label="Plan view scale and north">
      <svg className="northarrow" viewBox="0 0 40 52" aria-hidden="true"><polygon points="20,2 30,34 20,28 10,34" fill="currentColor" /><text x="20" y="49" textAnchor="middle" fontSize="13" fontWeight="700" fill="currentColor" fontFamily="sans-serif">N</text></svg>
      {bar && <div className="scalebar" data-scale-bar><div className="bar" style={{ width: bar.px }} /><span>{bar.label}</span></div>}
    </div>
  );
}

/** Keyboard shortcut help. */
export function ShortcutHelp({ onClose }: { onClose(): void }) {
  return (
    <div className="helpover" role="dialog" aria-modal="true" aria-label="Keyboard shortcuts" data-shortcut-help onClick={onClose}>
      <div className="helpbox" onClick={(e) => e.stopPropagation()}>
        <div className="helphead"><h2>Keyboard shortcuts</h2><button className="view" autoFocus onClick={onClose}>Close<kbd>Esc</kbd></button></div>
        <div className="helpgrid">
          {SHORTCUT_GROUPS.map((g) => (
            <section key={g.title}><h3>{g.title}</h3><table><tbody>{g.items.map((it) => <tr key={it.keys + it.action}><td><kbd>{it.keys}</kbd></td><td>{it.action}</td></tr>)}</tbody></table></section>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Downloads of the site model. The browser saves the design first; the server builds each file from the saved design and the scene bundle. */
export function SiteExports({ ep, flush, ctl, terrainStatus, canExport }: { ep: Endpoint | null; flush(): Promise<string | null>; ctl: DesignController; terrainStatus: string; canExport: boolean }) {
  const [busy, setBusy] = useState<string>(''), [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null), [dxf, setDxf] = useState<DxfVersion>('R2010'), [aerial, setAerial] = useState(false);
  const run = async (kind: ExportKind) => {
    if (!ep) return;
    setBusy(kind); setMsg(null);
    try {
      const problem = await flush();                             // save first: the server exports the SAVED design
      if (problem) throw new ExportError(0, 'NOT_SAVED', problem);
      await ctl.sendGlbs((id, bytes) => uploadBuildingGlb(ep, id, bytes));
      const file = await fetchExport(ep, kind, { version: dxf, aerial });
      saveFile(file);
      setMsg({ ok: true, text: `Saved ${file.filename}. Terrain status in the file: ${file.terrainStatus || 'DATA NOT AVAILABLE'}.` });
    } catch (e) { setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) }); }
    finally { setBusy(''); }
  };
  return (
    <section data-site-exports>
      <h2>Export the site model</h2>
      {!ep || !canExport ? <div className="note">EXPORTS NEED A SAVED PROJECT. This view has no connection to the server.</div> : (
        <>
          <div className="note" data-export-status>Every file carries the viewer status: {terrainStatus ? terrainStatus.toUpperCase() : 'TERRAIN STATUS DATA NOT AVAILABLE'}; UNVERIFIED services are marked; pending AI proposals are listed. INDICATIVE ONLY.</div>
          <div className="row" style={{ gridTemplateColumns: '1fr 1fr' }}>
            <label>DXF version <select aria-label="DXF version" value={dxf} onChange={(e) => setDxf(e.target.value as DxfVersion)}><option value="R2010">R2010</option><option value="R2000">R2000</option><option value="R12">R12</option></select></label>
            <label><input type="checkbox" checked={aerial} onChange={(e) => setAerial(e.target.checked)} />Include the aerial in the GLB</label>
          </div>
          <div className="exports">
            {EXPORT_DEFS.map((d) => (
              <div className="exrow" key={d.kind}>
                <button className="view" data-export={d.kind} disabled={!!busy} onClick={() => { void run(d.kind); }}>{busy === d.kind ? 'Preparing…' : d.label}</button>
                <small>{d.note}</small>
              </div>
            ))}
          </div>
        </>
      )}
      {msg && <div role={msg.ok ? 'status' : 'alert'} data-export-message style={msg.ok ? undefined : { color: 'var(--bad)' }}>{msg.text}</div>}
    </section>
  );
}
