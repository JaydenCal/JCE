'use client';
/** Design tab pieces for stage 5: importing a building, the outdoor feature tools, and the building properties block. */
import { useRef, useState } from 'react';
import type { CatalogueItem } from '@/lib/viewer/types';
import type { DesignController, DesignState } from '@/lib/site/designController';
import { ACCEPT, ImportError, importFile, importFootprintRing, importFootprintSize, type ImportEndpoint, type LotInfo } from '@/lib/site/buildingImport';
import type { ImportPayload } from '@/lib/site/buildings';
import { furnitureChoices } from '@/lib/site/furniture';
import { ringCentroid } from '@/lib/site/geom';
import {
  BUILDING_USES, BUILDING_USE_LABEL, FFL_NOT_SET, HEIGHT_NOT_SET, NOT_SET, OBJECT_KINDS, dimOf, levelOf, type Pos, type SiteObject,
} from '@/lib/site/types';

const msg = (e: unknown) => (e instanceof ImportError ? e.message : e instanceof Error ? e.message : String(e));
type Importer = { ep: ImportEndpoint; lot: LotInfo };
interface Waiting { payload: ImportPayload; glb: File | null }

/** "Import building": a Plan Studio design, a PDF or a DXF, or a footprint typed in or drawn. The result follows the cursor until it is clicked. */
export function BuildingImportBox({ ds, ctl, importer }: { ds: DesignState; ctl: DesignController; importer: Importer | null }) {
  const [use, setUse] = useState(''), [busy, setBusy] = useState(false), [err, setErr] = useState('');
  const [w, setW] = useState(''), [d, setD] = useState(''), [waiting, setWaiting] = useState<Waiting | null>(null), [checked, setChecked] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const locked = ds.locked !== null;

  const start = async (payload: ImportPayload, glbFile: File | null) => {
    let glb: { object: import('three').Object3D; name: string } | null = null;
    if (glbFile) {
      try { glb = { object: await ctl.loadGlb(await glbFile.arrayBuffer()), name: glbFile.name }; }
      catch (e) { setErr(`${msg(e)} The building is placed without the GLB.`); }
    }
    setWaiting(null); setChecked(false); ctl.beginBuildingPlacement(payload, glb);
  };
  const accept = async (payload: ImportPayload, glbFile: File | null) => {
    if (payload.requires_confirmation) { setWaiting({ payload, glb: glbFile }); return; }      // low confidence or unverified alignment: the user checks it first
    await start(payload, glbFile);
  };
  const run = async (f: () => Promise<void>) => { setBusy(true); setErr(''); try { await f(); } catch (e) { setErr(msg(e)); } finally { setBusy(false); } };

  const onFiles = (files: FileList | null) => {
    if (!files || !files.length || !importer) return;
    const all = [...files], glbFile = all.find((x) => /\.glb$/i.test(x.name)) ?? null, main = all.find((x) => !/\.glb$/i.test(x.name)) ?? null;
    if (!main) { setErr('Choose the design file (.planstudio.json, .pdf or .dxf) as well as the GLB.'); return; }
    if (glbFile && !/\.json$/i.test(main.name)) { setErr('A GLB goes with a Plan Studio design file only.'); return; }
    void run(async () => { await accept(await importFile(importer.ep, main, use || null, importer.lot), glbFile); });
    if (fileRef.current) fileRef.current.value = '';
  };
  const size = () => {
    const wn = Number(w), dn = Number(d);
    if (!importer || !use || !(wn > 0) || !(dn > 0)) return;
    void run(async () => { await accept(await importFootprintSize(importer.ep, wn, dn, use), null); });
  };
  const draw = () => {
    if (!importer || !use) return;
    ctl.beginFootprintDrawing(use, (ring: Pos[], u: string) => {
      void run(async () => {
        const payload = await importFootprintRing(importer.ep, ring, u), c = ringCentroid(ring);
        ctl.placeBuildingAt(payload, [c[0], c[1]]);
      });
    });
  };

  return (
    <div className="dz-import" style={{ margin: '8px 0' }}>
      <div className="note"><b>Import building</b></div>
      <div className="note">A building is imported or entered as a footprint, never designed here.</div>
      {!importer && <div className="note">BUILDING IMPORT NEEDS A PROJECT: this page has no server connection.</div>}
      <div className="row dz-row"><label htmlFor="dz-use">Building use</label>
        <select id="dz-use" className="search" value={use} onChange={(e) => setUse(e.target.value)} disabled={locked}>
          <option value="">NOT GIVEN (FROM THE FILE)</option>
          {BUILDING_USES.map((u) => <option key={u} value={u}>{BUILDING_USE_LABEL[u]}</option>)}
        </select></div>
      <div className="row dz-row"><label htmlFor="dz-file">File</label>
        <input id="dz-file" ref={fileRef} type="file" accept={ACCEPT} multiple disabled={!importer || locked || busy} onChange={(e) => onFiles(e.target.files)} /></div>
      <div className="note">Plan Studio design (.planstudio.json, with its .glb if you have one), architectural PDF or plan DXF.</div>
      <div className="row dz-row">
        <label htmlFor="dz-fw">Footprint</label>
        <input id="dz-fw" className="search" inputMode="decimal" placeholder="width m" value={w} onChange={(e) => setW(e.target.value)} style={{ width: 80 }} aria-label="Footprint width in metres" />
        <input className="search" inputMode="decimal" placeholder="depth m" value={d} onChange={(e) => setD(e.target.value)} style={{ width: 80 }} aria-label="Footprint depth in metres" />
      </div>
      <div className="btns">
        <button className="view" disabled={!importer || locked || busy || !use || !(Number(w) > 0) || !(Number(d) > 0)} onClick={size}>Place footprint</button>
        <button className={'view' + (ds.footprintUse ? ' on' : '')} disabled={!importer || locked || busy || !use} onClick={draw} title={use ? '' : 'Choose the building use first'}>Draw footprint</button>
      </div>
      {!use && <div className="note">Choose the building use to enter or draw a footprint. The height and finished floor level are NOT SET until you enter them.</div>}
      {busy && <div className="note" aria-live="polite">Importing</div>}
      {err && <div className="note" style={{ color: 'var(--bad)' }} role="alert">{err}</div>}
      {waiting && (
        <div role="alert" style={{ marginTop: 6 }}>
          {waiting.payload.warnings.map((x) => <div className="note" key={x} style={{ color: 'var(--bad)' }}>{x}</div>)}
          {waiting.payload.alignment && <div className="note">Alignment: {waiting.payload.alignment.outcome.replace(/_/g, ' ').toUpperCase()}, RMSE {waiting.payload.alignment.rmse_m.toFixed(3)} m, scale 1:{waiting.payload.alignment.scale_denominator}.</div>}
          <label className="note"><input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} /> I have checked this footprint against the plan.</label>
          <div className="btns"><button className="view" disabled={!checked} onClick={() => { void start(waiting.payload, waiting.glb); }}>Continue to placement</button><button className="view" onClick={() => { setWaiting(null); setChecked(false); }}>Cancel</button></div>
        </div>
      )}
      {ds.pendingBuilding && (
        <div style={{ marginTop: 6 }} aria-live="polite">
          <div className="note"><b>Placing {ds.pendingBuilding.source_file}</b>: move the cursor over the terrain, R or Q/E turns it, click to place, Esc cancels.</div>
          {ds.pendingBuilding.glb && <div className="note">GLB {ds.pendingBuilding.glb} is shown once the floor level (FFL) is set.</div>}
          {ds.pendingBuilding.warnings.map((x) => <div className="note" key={x} style={{ color: 'var(--bad)' }}>{x}</div>)}
        </div>
      )}
    </div>
  );
}

/** Pool, footpath (line or area), garden and outdoor furniture. Sheds, granny flats and units are buildings (imported above). */
export function FeatureTools({ ds, ctl, catalogue }: { ds: DesignState; ctl: DesignController; catalogue: CatalogueItem[] }) {
  const choices = furnitureChoices(catalogue);
  const on = (t: string) => ds.tool !== 'select' && ds.objectType === t;
  return (
    <div style={{ marginBottom: 8 }}>
      <div className="note">Site features</div>
      <div className="chips" style={{ margin: '4px 0' }}>
        <button className={'chip' + (on('pool') ? ' on' : '')} aria-pressed={on('pool')} onClick={() => ctl.startFor('pool')}>{OBJECT_KINDS.pool.label}</button>
        <button className="chip" onClick={() => ctl.startFor('footpath')}>{OBJECT_KINDS.footpath.label} LINE</button>
        <button className="chip" onClick={() => ctl.startFor('footpath', { shape: 'polygon' })}>{OBJECT_KINDS.footpath.label} AREA</button>
        <button className="chip" onClick={() => ctl.startFor('landscape_area', { params: { surface_kind: { value: 'garden_bed', basis: 'user' } }, label: 'Garden' })}>GARDEN</button>
        <button className={'chip' + (on('furniture') ? ' on' : '')} aria-pressed={on('furniture')} onClick={() => ctl.startFor('furniture')}>{OBJECT_KINDS.furniture.label}</button>
      </div>
      <div className="row dz-row"><label htmlFor="dz-furn">Furniture item</label>
        <select id="dz-furn" className="search" value={ds.furnitureItem?.item_id ?? ''} onChange={(e) => ctl.setFurnitureItem(choices.find((c) => c.item_id === e.target.value) ?? null)}>
          <option value="">NOT SET (DIMENSIONS NOT SET)</option>
          {choices.map((c) => <option key={c.item_id} value={c.item_id}>{c.title}{c.width_m === undefined || c.depth_m === undefined || c.height_m === undefined ? ' (DIMENSIONS NOT SET)' : ''}</option>)}
        </select></div>
      <div className="note">Furniture is sized from the catalogue dimensions only. Sheds, granny flats and units are buildings: import them or enter a footprint above.</div>
    </div>
  );
}

const fmtEl = (v: number | undefined) => (v === undefined ? NOT_SET : `${v >= 0 ? '+' : ''}${v.toFixed(2)} m`);

/** Properties block of a building: roof area and its basis, levels, FFL against the ground, exits, import notes and the GLB. */
export function BuildingInfo({ o, ctl }: { o: SiteObject; ctl: DesignController }) {
  const b = o.building!, ffl = levelOf(o, 'ffl_rl'), h = dimOf(o, 'height_m'), roof = dimOf(o, 'roof_plan_area_m2'), basis = o.params.roof_area_basis?.value;
  const cf = ctl.buildingCutFill(o.id), hasGlb = ctl.scene.hasGlb(o.id), [glbErr, setGlbErr] = useState('');
  const attach = async (f: File | null | undefined) => {
    if (!f) return; setGlbErr('');
    try { ctl.attachGlb(o.id, await ctl.loadGlb(await f.arrayBuffer())); } catch (e) { setGlbErr(msg(e)); }
  };
  return (
    <div className="dz-building" style={{ marginTop: 6 }}>
      <div className="readout">
        <span>ROOF PLAN AREA</span><span>{roof !== null ? `${roof.toFixed(1)} m²` : NOT_SET}</span>
        <span>ROOF AREA BASIS</span><span>{typeof basis === 'string' ? basis : NOT_SET}</span>
        <span>FFL</span><span>{ffl !== null ? `${ffl.toFixed(2)} m RL` : FFL_NOT_SET}</span>
        <span>HEIGHT</span><span>{h !== null ? `${h.toFixed(2)} m` : HEIGHT_NOT_SET}</span>
        <span>EXITS</span><span>{b.exits.sewer.length} sewer · {b.exits.water.length} water · {b.exits.downpipes.length} downpipes</span>
        {cf && <><span>FLOOR VS GROUND</span><span>{cf.sampled ? `${cf.min.toFixed(2)} to ${cf.max.toFixed(2)} m (negative is cut) at ${cf.sampled} footprint corners${cf.missing ? `, TERRAIN DATA NOT AVAILABLE at ${cf.missing}` : ''}` : 'TERRAIN DATA NOT AVAILABLE'}</span></>}
      </div>
      {typeof basis === 'string' && basis.startsWith('APPROXIMATE') && <div className="note">The roof area is an approximate value from Plan Studio (a 100 mm raster), not a measured area.</div>}
      <table style={{ marginTop: 4 }}><thead><tr><th>Level</th><th>Elevation above the ground floor</th></tr></thead><tbody>
        {b.levels.map((l, i) => <tr key={l.name + i}><td>{l.name}{i === b.datum_index ? ' (FFL datum)' : ''}</td><td>{fmtEl(l.elevation_m)}</td></tr>)}
      </tbody></table>
      {b.glb_name && (
        <div className="note" style={{ marginTop: 4 }}>
          GLB {b.glb_name}: {hasGlb ? (ffl === null ? 'loaded, shown once FFL is set' : 'shown') : 'NOT LOADED (the file is not stored in the design). Attach it again to see it.'}
          {!hasGlb && <input type="file" accept=".glb" aria-label="Attach the GLB again" onChange={(e) => { void attach(e.target.files?.[0]); }} />}
          {glbErr && <div style={{ color: 'var(--bad)' }} role="alert">{glbErr}</div>}
        </div>
      )}
      {!b.glb_name && <div className="note" style={{ marginTop: 4 }}>No GLB. <input type="file" accept=".glb" aria-label="Attach a Plan Studio GLB" onChange={(e) => { void attach(e.target.files?.[0]); }} /></div>}
      {b.notes.map((n) => <div className="note" key={n}>{n}</div>)}
    </div>
  );
}
