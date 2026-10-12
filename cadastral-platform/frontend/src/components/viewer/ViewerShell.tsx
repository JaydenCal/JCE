'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import './viewer.css';
import { ViewerEngine, type Opt } from '@/lib/viewer/engine';
import { fetchBundle, validateBundle } from '@/lib/viewer/loadBundle';
import { fetchProvider, type CatalogueProvider } from '@/lib/viewer/catalogue';
import { buildSampleBundle } from '@/lib/viewer/sampleBundle';
import { API_BASE } from '@/lib/api';
import type { PlaceState } from '@/lib/viewer/placeController';
import { DEFAULT_SETTINGS, type CatalogueItem, type PickInfo, type PlacedItem, type SceneBundle, type Settings } from '@/lib/viewer/types';
import { ReviewPanel } from './ReviewPanel';
import { PlacePanel } from './PlacePanel';
import { FpOverlay, SettingsPanel } from './FpOverlay';
import { AssistantPanel } from './AssistantPanel';
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
}
type Tab = 'review' | 'place' | 'walk' | 'assistant';
const VIEW_NAMES: Record<string, string> = { 'iso-sw': 'Iso SW', 'iso-ne': 'Iso NE', 'iso-se': 'Iso SE', plan: 'Plan', s: 'South', w: 'West', frontage: 'Frontage', dda: 'DDA bay', west: 'West driveway', lane: 'Lane', rear: 'Rear', street: 'Street', entry: 'Entry', service: 'Service area' };
const defaultProvider = fetchProvider(API_BASE);
const INIT_PLACE: PlaceState = { items: [], selectedId: null, ghostCatId: null, mode: 'idle', canUndo: false, canRedo: false, hint: '' };

function ViewerShell(props: ViewerShellProps) {
  const [bundle, setBundle] = useState<SceneBundle | null>(props.bundle ? validateBundle(props.bundle) : null);
  const [error, setError] = useState('');
  useEffect(() => {
    if (props.bundle) { try { setBundle(validateBundle(props.bundle)); } catch (e) { setError(String(e)); } return; }
    const url = props.bundleUrl ?? (props.projectId ? `${API_BASE}/projects/${encodeURIComponent(props.projectId)}/scene-bundle` : '');
    if (!url) { setBundle(buildSampleBundle()); return; }
    // no scene bundle yet (backend SA6 not run / endpoint absent): fall back to the synthetic demo model
    fetchBundle(url).then(setBundle).catch(() => { if (props.bundleUrl) setError(`Could not load scene bundle ${props.bundleUrl}`); else setBundle(buildSampleBundle()); });
  }, [props.bundle, props.bundleUrl, props.projectId]);
  if (error) return <div className="v3d" style={{ padding: 24 }}>{error}</div>;
  if (!bundle) return <div className="v3d" style={{ padding: 24 }}>Loading model…</div>;
  return <ViewerInner {...props} provider={props.provider ?? (props.projectId ? defaultProvider : undefined)} bundle={bundle} />;
}

function ViewerInner({ bundle, projectId, catalogue, provider, onItemsChange, complianceCheck, assistant }: ViewerShellProps & { bundle: SceneBundle }) {
  const root = useRef<HTMLDivElement>(null), stage = useRef<HTMLDivElement>(null), canvas = useRef<HTMLCanvasElement>(null), needle = useRef<SVGGElement>(null);
  const [eng, setEng] = useState<ViewerEngine | null>(null);
  const [theme, setTheme] = useState<'auto' | 'light' | 'dark'>('auto');
  const [tab, setTab] = useState<Tab>('review');
  const layers = useMemo(() => [...bundle.layers, ...(bundle.layers.some((l) => l.c === 'items') ? [] : [{ c: 'items', n: 'Placed items', on: true }])], [bundle]);
  const [on, setOn] = useState<Record<string, boolean>>(() => Object.fromEntries(layers.map((l) => [l.c, l.on])));
  const [opts, setOpts] = useState<Record<Opt, boolean>>({ cutfill: false, xray: false, sxray: false, edges: true, shadow: true, exag: false });
  const [hover, setHover] = useState(''), [pick, setPick] = useState<PickInfo | null>(null);
  const [fpOn, setFpOn] = useState(false), [locked, setLocked] = useState(false), [placeOn, setPlaceOn] = useState(false);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [pl, setPl] = useState<PlaceState>(INIT_PLACE);
  const [cat, setCat] = useState<CatalogueItem[]>(catalogue ?? bundle.catalogue ?? []);
  const [loading, setLoading] = useState('');
  const [touch, setTouch] = useState(false);
  const cb = useRef({ onItemsChange, complianceCheck }); cb.current = { onItemsChange, complianceCheck };

  useEffect(() => { try { setTouch(matchMedia('(pointer: coarse)').matches); } catch { /* ignore */ } }, []);
  useEffect(() => {
    const e = new ViewerEngine(canvas.current!, stage.current!, root.current!, bundle, {
      onHover: setHover, onPick: setPick, onFp: (a, l) => { setFpOn(a); setLocked(l); }, onPlace: setPl, onItemsChange: (i) => cb.current.onItemsChange?.(i),
    });
    e.hud.needle = needle.current; e.place.check = (i, c) => cb.current.complianceCheck?.(i, c) ?? [];
    (window as unknown as { __viewer?: ViewerEngine }).__viewer = e; setEng(e); setPl(e.place.state());
    return () => { e.dispose(); setEng(null); };
  }, [bundle]);
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
  const togglePlace = useCallback(() => { if (!eng) return; const v = !eng.placeActive; eng.setPlace(v); setPlaceOn(v); setTab(v ? 'place' : fpOn ? 'walk' : 'review'); if (v) setOpts((o) => ({ ...o, exag: false })); }, [eng, fpOn]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => { const t = e.target as HTMLElement; if (['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName) || e.ctrlKey || e.metaKey) return; if (e.code === 'KeyF') toggleFp(); else if (e.code === 'KeyP') togglePlace(); };
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k);
  }, [toggleFp, togglePlace]);

  const setLayer = (c: string, v: boolean) => { setOn((o) => ({ ...o, [c]: v })); eng?.setLayer(c, v); };
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
      <div className="top">
        <div className="brand"><h1>{bundle.info.title}</h1><span>{bundle.info.subtitle}</span></div>
        <div className="grp"><span className="lab">View</span>{views.map((k) => <button key={k} className="view" onClick={() => eng?.setView(k)}>{VIEW_NAMES[k] ?? k}</button>)}</div>
        <div className="grp right">
          {bundle.walkable && <button className={'view' + (fpOn ? ' on' : '')} aria-pressed={fpOn} onClick={toggleFp}>Walk<kbd>F</kbd></button>}
          <button className={'view' + (placeOn ? ' on' : '')} aria-pressed={placeOn} onClick={togglePlace}>Place<kbd>P</kbd></button>
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
          {fpOn && <FpOverlay fp={eng?.fp ?? null} locked={locked} touch={touch} onExit={() => eng?.setFirstPerson(false)} />}
        </div>
        <aside className="dock">
          <div className="tabs" role="tablist">
            {(['review', 'place', ...(assistant ? ['assistant'] : []), ...(fpOn ? ['walk'] : [])] as Tab[]).map((t) => <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>{t === 'review' ? 'Review' : t === 'place' ? 'Place items' : t === 'assistant' ? 'Design assistant' : 'Walk'}</button>)}
          </div>
          {tab === 'review' && <ReviewPanel bundle={bundle} layers={layers} on={on} opts={opts} pick={pick} hasCutFill={hasCF} setLayer={setLayer} setOpt={setOpt} />}
          {tab === 'assistant' && assistant && <AssistantPanel provider={assistant} picked={pick?.part ?? null} buildingParts={buildingParts} onTurn={onAssistantTurn} />}
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
