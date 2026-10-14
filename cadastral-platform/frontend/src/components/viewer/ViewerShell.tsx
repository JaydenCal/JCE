'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import './viewer.css';
import { ViewerEngine, type Opt } from '@/lib/viewer/engine';
import { fetchBundle, validateBundle } from '@/lib/viewer/loadBundle';
import { fetchProvider, type CatalogueProvider } from '@/lib/viewer/catalogue';
import { API_BASE, DEV_USER_ID } from '@/lib/api';
import type { PlaceState } from '@/lib/viewer/placeController';
import { DEFAULT_SETTINGS, type CatalogueItem, type PickInfo, type PlacedItem, type SceneBundle, type Settings } from '@/lib/viewer/types';
import { ReviewPanel } from './ReviewPanel';
import { PlacePanel } from './PlacePanel';
import { FpOverlay, SettingsPanel } from './FpOverlay';
import { AssistantPanel } from './AssistantPanel';
import { DesignPanel } from './DesignPanel';
import { lotRingFromBundle } from '@/lib/site/lot';
import type { DesignState } from '@/lib/site/designController';
import { SiteAutosave, SiteDesignSession, LOADING_NOTE, type AutosaveState, type LoadState } from '@/lib/site/persist';
import { designShortcutAllowed, isTypingTarget } from '@/lib/viewer/shortcuts';
import { SiteDesignStore } from '@/lib/site/store';
import { emptyDesign, type SiteDesign } from '@/lib/site/types';
import { aerialLegend, aerialNoteVisible } from '@/lib/viewer/aerial';
import { replaceBuildingParts, type AssistantProvider, type AssistantTurn } from '@/lib/assistant';

export interface ViewerShellProps {
  bundle?: SceneBundle; bundleUrl?: string; projectId?: string;
  catalogue?: CatalogueItem[]; provider?: CatalogueProvider;
  /** called with the full item list after every place/move/rotate/delete/undo/redo */
  onItemsChange?: (items: PlacedItem[]) => void;
  /** optional compliance check; returned strings become badges on the item (server warnings can also arrive in PlacedItem.warnings) */
  complianceCheck?: (item: PlacedItem, cat: Map<string, CatalogueItem>) => Promise<string[]> | string[];
  /** enables the 'Design assistant' dock tab (see lib/assistant.ts: httpAssistant / demoAssistant) */
  assistant?: AssistantProvider;
  /** the supplied bundle is synthetic demo data: labelled "DEMO DATA, NOT A REAL SITE" (set only by the demo page) */
  demo?: boolean;
}
type Tab = 'review' | 'place' | 'design' | 'walk' | 'assistant';
const VIEW_NAMES: Record<string, string> = { 'iso-sw': 'Iso SW', 'iso-ne': 'Iso NE', 'iso-se': 'Iso SE', plan: 'Plan', s: 'South', w: 'West', frontage: 'Frontage', dda: 'DDA bay', west: 'West driveway', lane: 'Lane', rear: 'Rear', street: 'Street', entry: 'Entry', service: 'Service area' };
const defaultProvider = fetchProvider(API_BASE);
const INIT_PLACE: PlaceState = { items: [], selectedId: null, ghostCatId: null, mode: 'idle', canUndo: false, canRedo: false, hint: '' };

const SAVE_DELAY_MS = 1500;
const DEMO_LABEL = 'DEMO DATA, NOT A REAL SITE';

/** Never falls back to demo data: a project whose bundle cannot be loaded gets an explicit error state. */
function ViewerShell(props: ViewerShellProps) {
  const [state, setState] = useState<{ bundle: SceneBundle | null; error: string }>(() => {
    if (!props.bundle) return { bundle: null, error: '' };
    try { return { bundle: validateBundle(props.bundle), error: '' }; } catch (e) { return { bundle: null, error: (e as Error).message }; }
  });
  useEffect(() => {
    if (props.bundle) { try { setState({ bundle: validateBundle(props.bundle), error: '' }); } catch (e) { setState({ bundle: null, error: (e as Error).message }); } return; }
    const url = props.bundleUrl ?? (props.projectId ? `${API_BASE}/projects/${encodeURIComponent(props.projectId)}/scene-bundle` : '');
    if (!url) { setState({ bundle: null, error: 'DATA NOT AVAILABLE: no scene bundle, bundle URL or project was supplied' }); return; }
    let dead = false; setState({ bundle: null, error: '' });
    fetchBundle(url, { 'X-User-Id': DEV_USER_ID }).then((b) => !dead && setState({ bundle: b, error: '' }))
      .catch((e) => !dead && setState({ bundle: null, error: e instanceof Error ? e.message : String(e) }));
    return () => { dead = true; };
  }, [props.bundle, props.bundleUrl, props.projectId]);
  const { bundle, error } = state;
  if (error) return <div className="v3d" role="alert"><div className="errstate"><h2>3D model not available</h2><p>{error}</p><p>No substitute or demonstration model is shown for a project.</p></div></div>;
  if (!bundle) return <div className="v3d" aria-busy="true"><div style={{ padding: 24 }}>Loading model…</div></div>;
  return <ViewerInner {...props} provider={props.provider ?? (props.projectId ? defaultProvider : undefined)} bundle={bundle} />;
}

function ViewerInner({ bundle, projectId, catalogue, provider, onItemsChange, complianceCheck, assistant, demo }: ViewerShellProps & { bundle: SceneBundle }) {
  const root = useRef<HTMLDivElement>(null), stage = useRef<HTMLDivElement>(null), canvas = useRef<HTMLCanvasElement>(null), needle = useRef<SVGGElement>(null);
  const [eng, setEng] = useState<ViewerEngine | null>(null);
  const [theme, setTheme] = useState<'auto' | 'light' | 'dark'>('auto');
  const [tab, setTab] = useState<Tab>('review');
  const layers = useMemo(() => [...bundle.layers, ...(bundle.layers.some((l) => l.c === 'items') ? [] : [{ c: 'items', n: 'Placed items', on: true }]), ...(bundle.layers.some((l) => l.c === 'design') ? [] : [{ c: 'design', n: 'Site design objects', on: true }])], [bundle]);
  const [on, setOn] = useState<Record<string, boolean>>(() => Object.fromEntries(layers.map((l) => [l.c, l.on])));
  const [opts, setOpts] = useState<Record<Opt, boolean>>({ cutfill: false, xray: false, sxray: false, edges: true, shadow: true, exag: false });
  const [aerialOp, setAerialOp] = useState(1);
  const [hover, setHover] = useState(''), [pick, setPick] = useState<PickInfo | null>(null);
  const [fpOn, setFpOn] = useState(false), [locked, setLocked] = useState(false), [placeOn, setPlaceOn] = useState(false);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [pl, setPl] = useState<PlaceState>(INIT_PLACE);
  const [cat, setCat] = useState<CatalogueItem[]>(catalogue ?? bundle.catalogue ?? []);
  const [loading, setLoading] = useState('');
  const [touch, setTouch] = useState(false);
  const cb = useRef({ onItemsChange, complianceCheck }); cb.current = { onItemsChange, complianceCheck };
  // site design: the store outlives the engine; saved to the server only when a project id is present and this is not the demo page
  const persistent = !!projectId && !demo;
  // a persistent store starts LOCKED (read only) until the saved design has loaded, so an edit can never be replaced by it
  const store = useMemo(() => { const s = new SiteDesignStore(emptyDesign(persistent ? projectId : undefined)); if (persistent) s.lock(LOADING_NOTE); return s; }, [projectId, persistent]);
  const [ds, setDs] = useState<DesignState | null>(null);
  // building import needs the server route, so it exists only for a saved project (not the demo page); a PDF is aligned to the lot in the bundle's CRS
  const importer = useMemo(() => (persistent && projectId ? { ep: { base: API_BASE, projectId, headers: { 'X-User-Id': DEV_USER_ID } }, lot: { ring: lotRingFromBundle(bundle), srid: typeof bundle.info.srid === 'number' ? bundle.info.srid : null } } : null), [persistent, projectId, bundle]);
  const [doc, setDoc] = useState<SiteDesign>(store.doc);
  const [save, setSave] = useState<AutosaveState | null>(persistent ? { status: 'idle', message: '', savedAt: null } : null);
  const [gate, setGate] = useState<LoadState | null>(persistent ? { phase: 'loading', error: '', local: false } : null);
  const autosave = useRef<SiteAutosave | null>(null), session = useRef<SiteDesignSession | null>(null);
  useEffect(() => { setDoc(store.doc); return store.on('change', (e) => setDoc(e.doc)); }, [store]);
  useEffect(() => {
    if (!persistent || !projectId) return;
    const ep = { base: API_BASE, projectId, headers: { 'X-User-Id': DEV_USER_ID } };
    let dead = false; const a = new SiteAutosave(store, ep, SAVE_DELAY_MS); a.listener = (s) => !dead && setSave(s); autosave.current = a;
    const ses = new SiteDesignSession(store, a, ep); ses.listener = (g) => { if (!dead) { setGate(g); if (g.phase === 'ready') setSave({ status: 'idle', message: '', savedAt: store.doc.updated_at ?? null }); } }; session.current = ses;
    void ses.load();
    // closing the tab: keepalive lets the save finish after the page is gone (sendBeacon cannot carry the auth header)
    const bye = () => { void a.flush({ keepalive: true }); }; window.addEventListener('beforeunload', bye);
    return () => { dead = true; ses.dispose(); window.removeEventListener('beforeunload', bye); void a.flush(); a.stop(); autosave.current = null; session.current = null; };
  }, [store, persistent, projectId]);

  useEffect(() => { try { setTouch(matchMedia('(pointer: coarse)').matches); } catch { /* ignore */ } }, []);
  useEffect(() => {
    const e = new ViewerEngine(canvas.current!, stage.current!, root.current!, bundle, {
      onHover: setHover, onPick: setPick, onFp: (a, l) => { setFpOn(a); setLocked(l); }, onPlace: setPl, onItemsChange: (i) => cb.current.onItemsChange?.(i), onDesign: setDs,
    }, { store, engine: persistent && projectId ? { base: API_BASE, projectId, headers: { 'X-User-Id': DEV_USER_ID } } : null });
    e.hud.needle = needle.current; e.place.check = (i, c) => cb.current.complianceCheck?.(i, c) ?? [];
    (window as unknown as { __viewer?: ViewerEngine }).__viewer = e; setEng(e); setPl(e.place.state()); setDs(e.design.state());
    return () => { e.dispose(); setEng(null); };
  }, [bundle, store, persistent, projectId]);
  // catalogue + persisted items from provider
  useEffect(() => {
    if (catalogue) { setCat(catalogue); return; }
    if (!provider) return; let dead = false; setLoading('Loading catalogue…');
    provider.list().then((c) => !dead && (setCat(c), setLoading(''))).catch((e) => !dead && setLoading(`Catalogue unavailable: ${e.message}`));
    if (projectId && provider.listPlaced) provider.listPlaced(projectId).then((i) => !dead && eng?.place.setItems(i)).catch(() => {});
    return () => { dead = true; };
  }, [catalogue, provider, projectId, eng]);
  useEffect(() => { eng?.setCatalogue(cat); }, [eng, cat]);
  useEffect(() => { if (eng) eng.hud.minimap = fpOn ? stage.current!.querySelector<HTMLCanvasElement>('[data-minimap]') : null; }, [eng, fpOn]);
  useEffect(() => { eng?.setSettings(settings); }, [eng, settings]);
  useEffect(() => { const t = setTimeout(() => eng?.applyTheme(), 0); return () => clearTimeout(t); }, [eng, theme]);

  const toggleFp = useCallback(() => { if (!eng) return; const v = !eng.fpActive; eng.setFirstPerson(v); if (v) setTab('walk'); else setTab((t) => (t === 'walk' ? 'review' : t)); }, [eng]);
  const toggleDesign = useCallback(() => { if (!eng) return; const v = !eng.designActive; eng.setDesign(v); if (v) { setPlaceOn(false); setOpts((o) => ({ ...o, exag: false })); } setTab(v ? 'design' : 'review'); }, [eng]);
  const togglePlace = useCallback(() => { if (!eng) return; const v = !eng.placeActive; eng.setPlace(v); setPlaceOn(v); setTab(v ? 'place' : fpOn ? 'walk' : 'review'); if (v) setOpts((o) => ({ ...o, exag: false })); }, [eng, fpOn]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target) || e.ctrlKey || e.metaKey) return;
      if (e.code === 'KeyF') toggleFp(); else if (e.code === 'KeyP') togglePlace();
      else if (designShortcutAllowed(e, eng)) toggleDesign();          // never in first person: D is strafe right there
    };
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k);
  }, [toggleFp, togglePlace, toggleDesign, eng]);

  const setLayer = (c: string, v: boolean) => { setOn((o) => ({ ...o, [c]: v })); eng?.setLayer(c, v); };
  useEffect(() => { eng?.setAerialOpacity(aerialOp); }, [eng]);   // eslint-disable-line react-hooks/exhaustive-deps
  const setAerialOpacity = (v: number) => { setAerialOp(v); eng?.setAerialOpacity(v); };
  const setOpt = (o: Opt, v: boolean) => { setOpts((s) => ({ ...s, [o]: v })); eng?.setOpt(o, v); };
  const hasCF = bundle.parts.some((p) => p.c === 'cutfill');
  const views = Object.keys(bundle.views ?? {});
  const P = eng?.place;
  const buildingParts = useMemo(() => new Set(bundle.parts.filter((p) => p.c === 'buildings').map((p) => p.n.replace(/_/g, ' '))), [bundle]);
  const onAssistantTurn = useCallback((t: AssistantTurn) => {
    if (!eng) return;
    for (const p of t.parts) buildingParts.add(p.n.replace(/_/g, ' '));
    const O = bundle.info.origin;
    replaceBuildingParts(eng, t.parts, [t.parts_origin[0] - O[0], t.parts_origin[1] - O[1]], getComputedStyle(root.current!).getPropertyValue('--edge').trim() || '#14161a');
  }, [eng, bundle, buildingParts]);

  return (
    <div className="v3d" ref={root} data-theme={theme === 'auto' ? undefined : theme}>
      {demo && <div className="flags"><div className="demo-flag" role="note">{DEMO_LABEL}</div></div>}
      <div className="top">
        <div className="brand"><h1>{bundle.info.title}</h1><span>{bundle.info.subtitle}</span></div>
        <div className="grp"><span className="lab">View</span>{views.map((k) => <button key={k} className="view" onClick={() => eng?.setView(k)}>{VIEW_NAMES[k] ?? k}</button>)}</div>
        <div className="grp right">
          {bundle.walkable && <button className={'view' + (fpOn ? ' on' : '')} aria-pressed={fpOn} onClick={toggleFp}>Walk<kbd>F</kbd></button>}
          <button className={'view' + (placeOn ? ' on' : '')} aria-pressed={placeOn} onClick={togglePlace}>Place<kbd>P</kbd></button>
          <button className={'view' + (ds?.active ? ' on' : '')} aria-pressed={!!ds?.active} onClick={toggleDesign}>Design<kbd>D</kbd></button>
          <button className="view" aria-label="Toggle theme" onClick={() => setTheme((t) => (t === 'dark' ? 'light' : t === 'light' ? 'auto' : 'dark'))}>Theme: {theme}</button>
        </div>
      </div>
      <div className="main">
        <div className="stage" ref={stage}>
          <canvas className="scene" ref={canvas} tabIndex={0} aria-label="3D model" />
          <svg className="compass" viewBox="0 0 54 54" aria-hidden="true"><circle cx="27" cy="27" r="25" fill="none" stroke="currentColor" strokeOpacity=".35" /><g ref={needle}><polygon points="27,5 32,27 27,23 22,27" fill="currentColor" /><text x="27" y="42" textAnchor="middle" fontSize="9" fill="currentColor" fontFamily="sans-serif">N</text></g></svg>
          {!fpOn && <div className="hud"><div className="tag">{hover || 'Hover for part name · click for E, N, RL and depth to existing ground'}</div>
            {pick && <div className="tag">E <b>{pick.e.toFixed(3)}</b>  N <b>{pick.n.toFixed(3)}</b>  RL <b>{pick.rl.toFixed(3)}</b>{pick.depth !== null && <> · {pick.depth >= 0 ? 'fill' : 'cut'} <b>{Math.abs(pick.depth).toFixed(2)} m</b> vs existing</>}</div>}</div>}
          <div className={'legend' + (opts.cutfill ? ' show' : '')}><div>Cut / fill vs existing</div><div className="bar" /><div className="lbl"><span>cut 0.6</span><span>0</span><span>fill 0.6 m</span></div></div>
          {placeOn && <div className="placehint">{pl.hint}</div>}
          {ds?.active && <div className="placehint">{ds.snapLabel ? `${ds.hint} · ${ds.snapLabel}` : ds.hint}</div>}
          {aerialNoteVisible(bundle, on, aerialOp) && <div className="aerial-note" role="note" data-aerial-stage-note>{aerialLegend(bundle)!.note}</div>}
          {fpOn && <FpOverlay fp={eng?.fp ?? null} locked={locked} touch={touch} onExit={() => eng?.setFirstPerson(false)} />}
        </div>
        <aside className="dock">
          <div className="tabs" role="tablist">
            {(['review', 'place', 'design', ...(assistant ? ['assistant'] : []), ...(fpOn ? ['walk'] : [])] as Tab[]).map((t) => <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>{t === 'review' ? 'Review' : t === 'place' ? 'Place items' : t === 'design' ? 'Design' : t === 'assistant' ? 'Design assistant' : 'Walk'}</button>)}
          </div>
          {tab === 'review' && <ReviewPanel bundle={bundle} layers={layers} on={on} opts={opts} pick={pick} hasCutFill={hasCF} setLayer={setLayer} setOpt={setOpt} aerialOpacity={aerialOp} setAerialOpacity={setAerialOpacity} />}
          {tab === 'assistant' && assistant && <AssistantPanel provider={assistant} picked={pick?.part ?? null} buildingParts={buildingParts} onTurn={onAssistantTurn} />}
          {tab === 'design' && eng && ds && <DesignPanel ds={ds} doc={doc} ctl={eng.design} save={save} importer={importer} catalogue={cat} gate={gate} onRetryLoad={() => { void session.current?.load(); }} onConfirmLocal={() => session.current?.confirmLocal()} onResolve={(how) => autosave.current?.resolve(how) ?? Promise.resolve('NOT SAVING: there is no save connection for this view')} />}
          {tab === 'walk' && <SettingsPanel s={settings} set={(p) => setSettings((s) => ({ ...s, ...p }))} />}
          {tab === 'place' && (
            <PlacePanel catalogue={cat} state={pl} loading={loading}
              onPick={(id) => { if (!placeOn) togglePlace(); P?.startPlacing(id); eng?.setPlace(true); if (eng) eng.controls.enableZoom = false; }}
              onMove={() => P?.startMove()} onDuplicate={() => P?.duplicateSelected()} onDelete={() => P?.deleteSelected()} onSelect={(id) => P?.select(id)}
              onUndo={() => P?.undo()} onRedo={() => P?.redo()} onCancel={() => { P?.cancel(); if (eng) eng.controls.enableZoom = true; }} />
          )}
        </aside>
      </div>
    </div>
  );
}
export { ViewerShell };
export default ViewerShell;
