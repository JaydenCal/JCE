'use client';
import type { LayerDef, PickInfo, SceneBundle } from '@/lib/viewer/types';
import type { Opt } from '@/lib/viewer/engine';
import { AERIAL_LAYER, aerialLegend, terrainLegend } from '@/lib/viewer/aerial';

export interface ReviewProps {
  bundle: SceneBundle; layers: LayerDef[]; on: Record<string, boolean>; opts: Record<Opt, boolean>; pick: PickInfo | null; hasCutFill: boolean;
  setLayer(c: string, v: boolean): void; setOpt(o: Opt, v: boolean): void;
  /** aerial imagery opacity 0 to 1 (default 1) */
  aerialOpacity?: number; setAerialOpacity?(v: number): void;
}
const OPTS: [Opt, string][] = [['cutfill', 'Colour surface by cut / fill'], ['xray', 'Buildings see-through'], ['sxray', 'Ground see-through (pits and pipes)'], ['edges', 'Edge lines'], ['shadow', 'Shadows'], ['exag', 'Exaggerate levels ×3']];

export function ReviewPanel(p: ReviewProps) {
  const f = (v: number) => v.toFixed(3);
  const aer = aerialLegend(p.bundle), terr = terrainLegend(p.bundle), op = p.aerialOpacity ?? 1;
  const ds = p.bundle.info.data_status;
  return (
    <>
      {ds && <section className="note" data-data-status><h2>Data status</h2><p style={{ margin: 0, fontWeight: 600 }}>{ds}</p></section>}
      <section><h2>Layers</h2><div className="layers">
        {p.layers.map((L) => (
          <label key={L.c} className={L.n.length > 30 ? 'wide' : undefined}><input type="checkbox" checked={!!p.on[L.c]} onChange={(e) => p.setLayer(L.c, e.target.checked)} />{L.n}</label>
        ))}
      </div>
      {terr && <small className="legend-note" data-terrain-note>{terr}</small>}
      {aer && (
        <div className="aerial-legend" data-aerial-legend>
          <small className="legend-note" data-aerial-note>{aer.note}</small>
          <small className="legend-src">SOURCE: {aer.source.toUpperCase()}. CAPTURE DATE: {aer.capture}.</small>
          {p.setAerialOpacity && <div className="row"><span>Aerial opacity</span><input type="range" aria-label="Aerial imagery opacity" min={0} max={1} step={0.05} value={op} disabled={!p.on[AERIAL_LAYER]} onChange={(e) => p.setAerialOpacity!(+e.target.value)} /><output>{Math.round(op * 100)}%</output></div>}
        </div>
      )}</section>
      <section><h2>Display</h2><div className="opts">
        {OPTS.filter(([o]) => o !== 'cutfill' || p.hasCutFill).map(([o, t]) => (
          <label key={o}><input type="checkbox" checked={p.opts[o]} onChange={(e) => p.setOpt(o, e.target.checked)} />{t}</label>
        ))}
      </div></section>
      <section><h2>Picked point</h2><div className="readout">
        <span>Easting</span><span>{p.pick ? f(p.pick.e) : '–'}</span><span>Northing</span><span>{p.pick ? f(p.pick.n) : '–'}</span>
        <span>RL (AHD)</span><span>{p.pick ? f(p.pick.rl) + (p.pick.depth !== null ? ` · ${p.pick.depth >= 0 ? 'fill' : 'cut'} ${Math.abs(p.pick.depth).toFixed(2)} m vs existing` : '') : '–'}</span>
        <span>Part</span><span>{p.pick?.part ?? '–'}</span>
      </div></section>
      {!!p.bundle.summary?.length && <section><h2>Design summary</h2><table><tbody>{p.bundle.summary!.map(([k, v], i) => <tr key={i}><td>{k}</td><td className="v">{v}</td></tr>)}</tbody></table></section>}
      {!!p.bundle.notes?.length && <section className="note"><h2>Review notes</h2><ul style={{ margin: 0, paddingLeft: 18 }}>{p.bundle.notes!.map((n, i) => <li key={i}>{n}</li>)}</ul></section>}
    </>
  );
}
