// Glide Inside app shell. Renders into #app: top bar, tools, plan editor, 3D host, right panel and status bar.
// The catalogue, 3D viewer and Plan Pack are separate modules, loaded on demand and allowed to fail.

import * as buildingOps from './commercial/catalogue/ops.js';
import { canMoveHouse } from './editor2d/tool-movehouse.js';
import { CONFIG } from './config.js';
import { createStore, loadAutosave } from './model/store.js';
import { createProject, migrate, validate } from './model/schema.js';
import { createEditor2D } from './editor2d/editor.js';
import { attachSetbacks } from './site/setback-stage.js';
import { h, isTyping } from './ui/dom.js';
import { initTheme } from './ui/theme.js';
import { buildShell } from './ui/shell.js';
import { mountToasts, toast } from './ui/toast.js';
import { mountModals, askConfirm } from './ui/modal.js';
import { createTopbar } from './ui/topbar.js';
import { createToolbox } from './ui/toolbox.js';
import { createDrawer } from './ui/drawer.js';
import { createPanel } from './ui/panel.js';
import { createStatusBar } from './ui/statusbar.js';
import { createStageChips, createWelcome, createMapCredit } from './ui/stage-ui.js';
import { openTemplatePicker } from './ui/templates.js';
import { openFindBlock } from './ui/find-block.js';
import { createFrontageBar } from './ui/frontage.js';
import { saveDesign, pickDesignFile } from './ui/files.js';
import { createEmbed } from './ui/embed.js';
import { initShare } from './ui/share.js';
import { initProfiles } from './profile/index.js';
import { createViewManager } from './ui/views.js';
import { createSampleProject, SAMPLE_TEMPLATE } from './ui/sample.js';
import { setTool } from './ui/toolstate.js';
import { createWheel } from './ui/wheel.js';
import { createInventory } from './ui/inventory.js';
import { openTitleBlockForm, getLogo } from './ui/titleblock.js';
import { TOOL_DEFS, DOOR_FAMILY, KIND_LABEL } from './editor2d/tools-meta.js';
import { track } from './ui/analytics.js';
import { designTypeOf, changeDesignType, applyDesignType } from './ui/design-type.js';
import { createAerialSourceButton } from './ui/aerial-source.js';
import { backTarget, backLabel } from './ui/back-target.js';
import { startView, readLastView } from './ui/view-mode.js';
import { portalUrl } from './portal/links.js';
import { createLotCard } from './lotcard/lot-card.js';
import { createAerialToggle } from './ui/aerial-toggle.js';
import { mountPanelHide } from './ui/panel-hide.js';
import { createCommercialCard } from './commercial/lotcard.js';
import { createCommercialPanel } from './commercial/ui/panel-commercial.js';
import { enterCommercial, offerCommercial, commercialUi, convertToCommercial } from './commercial/mode.js';
import { resolveTool, toolMode, toolName, toolOfProject, TOOL_INFO, PREV_AUTOSAVE_KEY } from './toolmode.js';
import { offerSwitch, openInTool } from './ui/tool-switch.js';
import { effectiveClass } from './commercial/zones.js';
import { initGuidedFlow, shouldStart, openFlow } from './flow/index.js';
import { flowInProgress } from './flow/state.js';
import { viewerEmbedRequested, addressFromSearch, openFullEditor, initEmbedViewer, loadAddress, mountViewerChrome, takeHandoff } from './ui/embed-viewer.js';

const demoMode = () => CONFIG.embedMode === 'demo';
// ?embed=1 or ?view=viewer: the cinematic single lot 3D view only (the home page frame). See src/ui/embed-viewer.js.
const VIEWER = viewerEmbedRequested();
const COMMERCIAL_VIEWER = VIEWER && new URLSearchParams(location.search).get('mode') === 'commercial';

async function loadCatalogue() {
  try {
    const m = await import('./catalogue/index.js');
    return m.catalogue || m.default || null;
  } catch (e) {
    console.warn('[catalogue] not available, using the built-in sample', e);
    return null;
  }
}

const templatesOf = (catalogue) => (Array.isArray(catalogue?.templates) && catalogue.templates.length ? catalogue.templates : [SAMPLE_TEMPLATE]);

function projectFromTemplate(catalogue, t) {
  if (t === SAMPLE_TEMPLATE) return createSampleProject();
  let project = null;
  try {
    project = catalogue?.createFromTemplate ? catalogue.createFromTemplate(t.id) : null;
  } catch (e) {
    console.warn(`[template] createFromTemplate(${t.id}) failed`, e);
  }
  return project || t.create();
}

const hasContent = (p) => p.levels.some((l) => l.rooms.length || l.walls.length);

// A fresh commercial start is an empty commercial layout, never a house template.
const freshCommercial = () => convertToCommercial(createProject({ name: 'Commercial units' }), { name: 'Commercial units' });

function initialProject(catalogue) {
  let loaded = null;
  let switchFrom = null;
  if (!demoMode() && !VIEWER) {
    const handed = takeHandoff();
    if (handed) loaded = { project: handed.project, fromAutosave: true, previous: handed.previous };
    else {
      const saved = loadAutosave(CONFIG.autosaveKey);
      if (saved) loaded = { project: saved, fromAutosave: true };
    }
  }
  // ?address= asks for a specific lot. A design kept in this browser for a DIFFERENT address must not open in its place (it put a 50 ha
  // rural lot under a town address, 15/11/2026). Start fresh for the asked address and keep the saved design as the earlier design.
  const askedAddress = addressFromSearch();
  if (loaded && askedAddress && !loaded.previous) {
    const norm = (a) => String(a || '').toUpperCase().replace(/\b(NSW|QLD|NEW SOUTH WALES|QUEENSLAND|AUSTRALIA)\b/g, '').replace(/[^A-Z0-9]+/g, ' ').trim();
    const savedAddr = loaded.project?.site?.lot?.address || '';
    if (!savedAddr || norm(savedAddr) !== norm(askedAddress)) {
      try { localStorage.setItem(PREV_AUTOSAVE_KEY, JSON.stringify(loaded.project)); } catch { /* storage blocked */ }
      loaded = { previousOnly: loaded.project };
    }
  }
  const previousOnly = loaded?.previousOnly || null;
  if (previousOnly) loaded = null;
  const res = resolveTool({ search: location.search, project: loaded?.project, fromSaved: !!loaded });
  toolMode.current = res.tool;
  if (loaded && res.mismatch) {
    // The page asks for one tool and the design kept in this browser belongs to the other. It is not opened here and not lost: it stays in
    // the autosave slot until the first edit here, is kept as the earlier design, and the person is offered the other tool.
    const other = loaded.project;
    try { localStorage.setItem(PREV_AUTOSAVE_KEY, JSON.stringify(other)); } catch { /* storage blocked */ }
    loaded = null;
    switchFrom = other;
  }
  if (loaded) return { ...loaded, tool: res.tool };
  const prevX = previousOnly ? { previous: previousOnly } : {};
  if (res.tool === 'commercial' && !demoMode() && !VIEWER) return { project: freshCommercial(), fromAutosave: false, tool: res.tool, switchFrom, ...prevX };
  const wanted = new URLSearchParams(location.search).get('template') || 'house_single';
  const list = templatesOf(catalogue);
  // The first frame must show a real plan, so empty templates are skipped.
  const tries = [list.find((t) => t.id === wanted), list.find((t) => t.id === 'house_single'), ...list.filter((t) => t.id !== 'blank'), SAMPLE_TEMPLATE];
  for (const t of tries) {
    if (!t) continue;
    try {
      const project = migrate(projectFromTemplate(catalogue, t));
      if (!hasContent(project) && t.id !== wanted) continue;
      const problems = validate(project);
      if (problems.length) console.warn(`[template] ${t.id} has problems`, problems);
      return { project, fromAutosave: false, templateId: t.id, tool: res.tool, switchFrom, ...prevX };
    } catch (e) {
      console.warn(`[template] ${t.id} could not be loaded`, e);
    }
  }
  return { project: createProject({ name: 'Untitled design' }), fromAutosave: false, tool: res.tool, switchFrom, ...prevX };
}

async function main() {
  initTheme();
  const root = document.getElementById('app');
  if (!root) throw new Error('#app is missing');
  const refs = buildShell(root);
  mountToasts(refs.toasts);
  mountModals(refs.modalRoot);
  refs.shell.dataset.mode = demoMode() ? 'demo' : 'full';
  if (VIEWER) refs.shell.dataset.embedViewer = '1';
  const catalogue = await loadCatalogue();
  const start = initialProject(catalogue);
  // Two tools, one address: ?mode=residential or ?mode=commercial (src/toolmode.js). Each has its own name, tab title, start screen and price.
  const TOOL = toolMode.current;
  const COMMERCIAL_TOOL = TOOL === 'commercial' && !VIEWER && !demoMode();
  commercialUi.enabled = COMMERCIAL_TOOL;
  CONFIG.productName = toolName(TOOL);
  refs.shell.dataset.tool = TOOL;
  if (!VIEWER && !demoMode()) { try { document.title = TOOL_INFO[TOOL].tabTitle; } catch { /* no document title */ } }
  const state = { fromAutosave: start.fromAutosave };
  let earlierDesign = start.previous || null;
  const narrow = window.matchMedia?.('(max-width: 899.98px)').matches;
  // On small screens the properties panel starts as a collapsed bottom sheet so the plan keeps the room.
  if (narrow) refs.panel.dataset.open = 'false';
  // A demo (teaser) never writes the autosave slot, so it cannot overwrite a visitor's real design.
  const noAutosave = demoMode() || VIEWER;
  const store = createStore(start.project, { autosaveKey: noAutosave ? null : CONFIG.autosaveKey, opContext: { catalogue } });

  // Undo floor: once a lot is loaded, undo can walk back to "lot loaded" and no further, so it can never remove the lot (and the house with it).
  { const keyOf = (p) => { const l = p.site?.lot; return l ? `${l.address || ''}|${l.lotLabel || ''}|${l.boundary?.length || 0}` : null; };
    let floorKey = keyOf(store.project);
    store.on('project', () => { const k = keyOf(store.project); if (k && k !== floorKey) store.setUndoFloor(); floorKey = k; }); }

  // Indicative setbacks and building envelope for a looked-up lot, loaded per council (src/site/setback-stage.js).
  if (CONFIG.siteLookupEnabled) attachSetbacks(store);

  const editor = createEditor2D(refs.planHost, store, { catalogue });
  // The 3D code waits for the start screen decision (below): behind the start screen it would only slow the first screen down.
  let openStartGate = () => {};
  const startGate = new Promise((r) => { openStartGate = r; setTimeout(r, 12000); });
  const views = createViewManager({ store, refs, editor, catalogue, startGate });
  const getViewer = views.getViewer;
  const panel = createPanel(refs, store, { catalogue, editor });
  mountPanelHide(refs, { panel }); // hide or show the whole side panel (remembered per browser); also where the builder's "Show AI design assistant" setting lands
  const fileInput = h('input', { type: 'file', accept: 'application/json,.json', hidden: true, tabindex: '-1', 'aria-hidden': 'true' });
  refs.shell.append(fileInput);

  let embed = null;
  const hasEdits = () => store.canUndo() || state.fromAutosave;

  let share = null; // Save and share, created below
  // Loading designs --------------------------------------------------------------------------------------------------------
  function replaceProject(project) {
    // A design made in the other tool is not opened here: the person is offered the other tool (it carries the design across).
    if (!VIEWER && !demoMode() && toolOfProject(project) !== TOOL) { offerSwitch(project, TOOL); return false; }
    if (share?.state.id) share.leave(); // another design replaces the shared one: the read only notice goes
    try {
      store.replace(project);
    } catch (e) {
      toast(e?.message || 'That design could not be opened.', { kind: 'error' });
      return false;
    }
    state.fromAutosave = false;
    store.setUI({ tool: 'select', toolArg: null, levelFilter: 'all', statusView: 'proposed' });
    return true;
  }

  function loadTemplate(t) {
    let project;
    try {
      project = migrate(projectFromTemplate(catalogue, t));
    } catch (e) {
      console.warn('[template] failed', e);
      toast('That template could not be loaded. Try another one.', { kind: 'error' });
      return false;
    }
    track('ps_template_selected', { id: t.id });
    return replaceProject(project);
  }

  function loadBlank() {
    if (!replaceProject(createProject({ name: 'Untitled design' }))) return;
    setTool(store, 'room');
    track('ps_template_selected', { id: 'blank' });
    toast('Blank design. Drag on the plan to draw your first room.', { kind: 'info' });
  }

  // Commercial tool: "New" starts a fresh commercial layout at the first screen, with no house templates.
  async function newCommercial() {
    if (hasEdits()) {
      const ok = await askConfirm({ title: 'Start a new commercial layout?', message: `Your current layout "${store.project.name}" has changes that will be replaced. Save a copy first if you want to keep it.`, confirmLabel: 'Start a new layout', danger: true });
      if (!ok) return;
    }
    if (!replaceProject(freshCommercial())) return;
    track('ps_new_commercial');
    refs.shell.dataset.flow = '';
    try { await openFlow({ api, store, refs, catalogue, kind: 'commercial', step: 1 }); } catch (e) { console.warn('[flow] could not start', e); }
  }

  function openNew() {
    if (COMMERCIAL_TOOL) { newCommercial(); return; }
    openTemplatePicker({
      templates: templatesOf(catalogue).filter((t) => t.id !== 'blank'),
      hasEdits: hasEdits(),
      designName: store.project.name,
      onPick: loadTemplate,
      onBlank: loadBlank,
      onSaveCopy: () => saveDesign(store),
      currentType: designTypeOf(store.project),
      onDesignType: (id) => changeDesignType(store, id, catalogue).then((ok) => ok && track('ps_design_type', { id })),
    });
  }

  function openFile() {
    pickDesignFile(fileInput, async (project, fileName) => {
      if (hasEdits()) {
        const ok = await askConfirm({
          title: 'Replace the current design?',
          message: `Open "${fileName}"? Your current design has changes that will be replaced. Save a copy first if you want to keep it.`,
          confirmLabel: 'Open file',
          danger: true,
        });
        if (!ok) return;
      }
      if (replaceProject(project)) toast(`Opened ${project.name}.`, { kind: 'ok' });
    });
  }

  let profiles = null; // free user profiles, started after the first frame (below)
  function save() {
    if (store.readOnly) { toast('This shared design is view only. Use Make your own to start one of your own.', { kind: 'info' }); return; }
    saveDesign(store);
    track('ps_project_saved');
    profiles?.promptSave(); // signed out: a friendly, non blocking offer of a free profile (the file save carries on)
  }

  // Chrome -------------------------------------------------------------------------------------------------------------------
  const topbar = createTopbar(refs.topbar, store, {
    demo: demoMode(),
    onNew: openNew,
    onOpen: openFile,
    onSave: save,
    onOpenFull: () => embed?.openFull(),
    onFindBlock: () => openFindBlock(store),
    onBack: () => goBack(),
  });
  const backFacts = () => ({ here: location.href, referrer: document.referrer, back: new URLSearchParams(location.search).get('back'), portalUrl: portalUrl(), homeUrl: CONFIG.homeUrl });
  const backBtn = refs.topbar.querySelector('[data-action="back"]');
  if (backBtn) {
    const bt = backTarget(backFacts());
    backBtn.title = backLabel(bt.kind);
    const bl = bt.kind === 'home' ? 'Main page' : bt.kind === 'portal' ? 'Dashboard' : 'Back';
    backBtn.setAttribute('aria-label', bl);
    const tx = backBtn.querySelector('.ps-btn-text');
    if (tx) { tx.textContent = bl; tx.style.display = 'inline'; }
  }
  // Back keeps the work (autosave) and returns to the page that launched the app. A signed in builder or client with no launching page
  // goes to the portal dashboard, anyone else to the Glide Inside home page.
  async function goBack() {
    try {
      store.saveNow?.();
    } catch {
      /* the autosave already ran on the last edit */
    }
    const facts = backFacts();
    let target = backTarget(facts);
    if (target.kind === 'home' && CONFIG.portalEnabled) {
      try {
        const { getPortalApi } = await import('./portal/api.js');
        const me = await getPortalApi().me();
        target = backTarget({ ...facts, role: me?.user?.role || null });
      } catch {
        /* signed out or no portal: the home page */
      }
    }
    location.assign(target.url);
  }
  let wheel = null;
  const inventory = createInventory({ store, catalogue });
  const openInventory = () => {
    wheel?.close();
    inventory.open();
  };
  const toolbox = createToolbox(refs.toolbox, store, { onWheel: (o) => wheel?.open({ ...o, tap: true }) });
  wheel = createWheel({ store, catalogue, host: refs.shell, getViewer, openInventory });
  const drawer = createDrawer(refs.drawer, store, { catalogue, onInventory: openInventory });
  const statusbar = createStatusBar(refs.statusbar, store, { editor });
  const chips = createStageChips(refs.chips, store);
  createFrontageBar(refs.stage, store);
  statusbar.setAutosave(!noAutosave);

  let premiumLoading = null;
  function mountPremium() {
    if (api.premium || premiumLoading) return premiumLoading;
    premiumLoading = import('./premium/premium.js')
      .then((mod) => {
        api.premium = mod.createPremium(store, {
          mounts: { topbar: topbar.premiumSlot, aiPanel: refs.aiMount, modalRoot: refs.premiumRoot },
          config: CONFIG,
          catalogue,
          getViewer,
        });
        refs.aiFallback.hidden = true;
      })
      .catch((e) => {
        console.warn('[premium] not available', e);
        api.premium = null;
        refs.aiFallback.hidden = false;
      });
    return premiumLoading;
  }

  function setMode(mode) {
    CONFIG.embedMode = mode;
    const demo = mode === 'demo';
    refs.shell.dataset.mode = mode;
    topbar.setDemo(demo);
    if (demo && panel.getTab() === 'ai') panel.setTab('props', { open: false });
    if (!demo) mountPremium();
  }

  embed = createEmbed({
    handlers: {
      loadTemplate: (id) => {
        const t = templatesOf(catalogue).find((x) => x.id === id);
        if (id === 'blank') loadBlank();
        else if (t) loadTemplate(t);
        else console.warn(`[embed] unknown template ${id}`);
      },
      setMode,
      getProjectId: () => store.project.id,
    },
  });

  // Save and share (the live app's Share button and ?share=<id> links). The link is opened after the first frame, below.
  share = initShare({ store, refs, config: CONFIG, replaceProject, hasEdits, setAutosaveShown: (on) => statusbar.setAutosave(on) });
  const shareId = demoMode() || VIEWER ? null : share.linkFromAddress();

  // Keyboard -------------------------------------------------------------------------------------------------------------------
  // After a mouse click on a bar button, drop focus so Space (pan) and Delete reach the plan, not the button.
  refs.shell.addEventListener('click', (e) => {
    if (e.detail === 0) return;
    const btn = e.target.closest?.('button');
    if (btn && btn.closest('.ps-topbar, .ps-toolbox, .ps-statusbar, .ps-panel-head')) btn.blur();
  });
  // I opens the Inventory (quick slots for the Q wheel). Not while walking, where the pointer is captured by the viewer.
  window.addEventListener('keydown', (e) => {
    if (VIEWER || (e.key !== 'i' && e.key !== 'I') || e.ctrlKey || e.metaKey || e.altKey || e.repeat || e.defaultPrevented) return;
    if (isTyping(e.target) || document.querySelector('.ps-modal') || store.ui.view === 'walk') return;
    e.preventDefault();
    openInventory();
  });
  window.addEventListener('keydown', (e) => {
    if (VIEWER || e.defaultPrevented || !(e.ctrlKey || e.metaKey) || e.altKey) return;
    if (isTyping(e.target) || e.target.closest?.('.ps-modal')) return;
    const k = e.key.toLowerCase();
    if (k === 'z') {
      e.preventDefault();
      if (e.shiftKey) store.redo();
      else store.undo();
    } else if (k === 'y') {
      e.preventDefault();
      store.redo();
    } else if (k === 's' && !demoMode()) {
      e.preventDefault();
      save();
    }
  });

  // Keep work safe when the tab closes inside the autosave delay.
  const flush = () => store.saveNow?.();
  window.addEventListener('pagehide', flush);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush();
  });

  // Unexpected errors: log the stack for diagnosis and tell the person once in a while, never block the tool.
  // Pointer lock refusals (the browser says no, or the person pressed Esc while the request was pending) are
  // normal in Walk mode, which falls back to drag to look, so they are not errors.
  let lastReport = 0;
  const isPointerLockRefusal = (err) => {
    const name = err?.name || '';
    if (!['NotSupportedError', 'WrongDocumentError', 'SecurityError', 'InvalidStateError'].includes(name)) return false;
    return /pointer ?lock|exited the lock/i.test(err?.message || '');
  };
  const report = (err, where = 'error') => {
    if (!err || isPointerLockRefusal(err)) return false;
    if (err.name === 'ReadOnlyError') {
      toast(err.message, { kind: 'info' });
      return true;
    }
    console.error(`[app] unexpected ${where}`, err?.stack || err?.message || err);
    const now = Date.now();
    if (now - lastReport < 10000) return true;
    lastReport = now;
    toast('Something went wrong. Your design is saved in this browser. If it keeps happening, reload the page.', { kind: 'error' });
    return true;
  };
  window.addEventListener('error', (e) => {
    if (e.error) report(e.error, 'error');
  });
  window.addEventListener('unhandledrejection', (e) => {
    if (!report(e.reason, 'rejection')) e.preventDefault();
  });

  // Analytics for views.
  store.on('ui', (patch = {}) => {
    if (patch.view === '3d') track('ps_view_3d');
    if (patch.view === 'walk') track('ps_walk_start');
  });

  // Public handle for tests and the host page -------------------------------------------------------------------------------------
  // Tools other modules (onboarding, tutorials, the assistant) can arm: id, label and the keys that select them.
  const tools = [
    ...TOOL_DEFS.map((t) => ({ id: t.id, label: t.label, keys: [t.key] })),
    ...DOOR_FAMILY.filter((id) => id !== 'door').map((id) => ({ id, label: KIND_LABEL[id], keys: [] })),
  ];
  const keys = { wheel: 'Q', inventory: 'I', rotateLeft: ',', rotateRight: '.', rotateFine: 'Shift', pan: 'Right drag', quickMeasure: 'Right click' };
  const api = { changeDesignType: (id, opts) => changeDesignType(store, id, catalogue, opts), share, applyDesignType: (id) => applyDesignType(store, id, catalogue), designTypeOf: () => designTypeOf(store.project), tools, keys, setTool: (id, arg) => setTool(store, id, arg), wheel, inventory, openInventory, openTitleBlock: () => openTitleBlockForm(store), getLogo, store, editor, getViewer, premium: null, catalogue, CONFIG, embed, panel, topbar, toolbox, drawer, statusbar, chips, views, openNew, loadTemplate, loadBlank, replaceProject, setMode, buildingOps };
  window.__ps = api;

  // Start state ------------------------------------------------------------------------------------------------------------------
  const params = new URLSearchParams(location.search);
  const addressParam = addressFromSearch();
  // ?mode=commercial[&address=...]: the commercial landing page hands off here. The switch is the person's own request, so it is made without a toast.
  const wantCommercial = COMMERCIAL_TOOL;
  const phone = window.matchMedia?.('(max-width: 599.98px)').matches;
  let owner = null;
  try {
    owner = localStorage.getItem('ps.portal.owner') || null;
  } catch {
    owner = null;
  }
  let remembered = null;
  try {
    remembered = readLastView(sessionStorage, owner) || readLastView(sessionStorage, null);
  } catch {
    remembered = null;
  }
  const first = VIEWER ? '3d' : startView({ param: params.get('view'), phone, remembered, demo: demoMode() });
  if (first !== '2d') store.setUI({ view: first });
  // With a lot loaded and the house placed, the plan opens on Move house (drag the whole house, ring to turn). It becomes the active tool
  // when a lot first appears on the design; wall and room reshaping stays one click away on Edit (B).
  let lotSeen = null;
  const lotKeyOf = (p) => { const l = p.site?.lot; return l ? `${l.address || ''}|${l.lotLabel || ''}|${l.boundary?.length || 0}` : null; };
  let wasCommercial = false;
  const defaultTool = () => {
    if (store.project.mode === 'commercial') {
      // The commercial tool becomes active when a design enters commercial mode, not after every edit: a person who picked Select keeps it.
      if (!wasCommercial && (store.ui.tool === 'select' || store.ui.tool === 'movehouse')) store.setUI({ tool: 'commercial', toolArg: null });
      wasCommercial = true;
      if (!store.ui.commercialRow && store.project.commercial?.rows.length) store.ui.commercialRow = store.project.commercial.rows[0].id;
      return;
    }
    wasCommercial = false;
    if (store.ui.tool === 'commercial') store.setUI({ tool: 'select', toolArg: null });
    const key = lotKeyOf(store.project);
    if (key === lotSeen) return;
    lotSeen = key;
    if (key && canMoveHouse(store.project) && store.ui.tool === 'select') store.setUI({ tool: 'movehouse', toolArg: null });
    else if (!key && store.ui.tool === 'movehouse') store.setUI({ tool: 'select', toolArg: null });
  };
  store.on('project', defaultTool);
  defaultTool();
  track('ps_open', { embedMode: CONFIG.embedMode });

  const openFull = () => openFullEditor(store.project);
  // The home page card's call to action starts the guided flow at step 2 (choose a home) with the lot already set; "Open full editor" goes straight to the editor.
  const openGuided = () => {
    const p = store.project;
    const kind = p.mode === 'commercial' ? 'commercial' : 'residential';
    openFullEditor({ ...p, flow: { kind, step: p.site?.lot ? 2 : 1, designId: p.placedHouse?.id || null } });
  };
  const openEditorDirect = () => openFullEditor({ ...store.project, flow: { kind: store.project.mode === 'commercial' ? 'commercial' : 'residential', step: 5 } });
  const lotCard = COMMERCIAL_VIEWER
    ? createCommercialCard({ store, host: refs.stage, viewerHost: refs.host3d, getViewer, getApp: () => api, onEdit: openGuided, onFullEditor: openGuided, onFind: (a) => api.embedViewer?.run(a) })
    : createLotCard({ store, host: refs.stage, viewerHost: refs.host3d, catalogue, getViewer, ...(VIEWER ? { onEdit: openGuided, onFullEditor: openEditorDirect, onFind: (a) => api.embedViewer?.run(a), onMini: () => {}, embed: true } : {}) });
  api.lotCard = lotCard;
  // The home page's "Open full editor" link asks the embedded viewer to hand over everything (lot, address, house, placement, colours) and open the editor itself.
  if (VIEWER) {
    window.addEventListener('message', (ev) => {
      if (ev.origin !== location.origin || ev.source !== window.parent) return;
      if (ev.data && typeof ev.data === 'object' && ev.data.type === 'gi:open-editor') (COMMERCIAL_VIEWER ? openGuided : openEditorDirect)(); // commercial goes through the guided steps first, as the address links do
    });
  }
  if (COMMERCIAL_TOOL) api.commercial = createCommercialPanel({ store, host: refs.stage, editor }); // the residential tool has no commercial panel
  createMapCredit(refs.stage, store);
  { const fab = createAerialToggle({ store, className: 'ps-aerial-fab', dataPs: 'aerial-toggle-stage' }); refs.stage.append(fab.el); const own = createAerialSourceButton({ store, className: 'ps-aerial-src-fab', dataPs: 'aerial-source-stage' }); refs.stage.append(own.el); } // Aerial on/off over the 2D plan and the 3D view (hidden while the lot card shows its own)
  // The guided start flow (src/flow/) replaces the welcome card for a fresh open and for a flow that was part way through.
  const startsFlow = shouldStart({ project: store.project, search: location.search, viewer: VIEWER, demo: demoMode(), shareId, fromAutosave: state.fromAutosave }) && !params.get('template');
  if (!state.fromAutosave && !demoMode() && !narrow && !shareId && !VIEWER && !addressParam && !wantCommercial && !startsFlow) createWelcome(refs.stage, store, { onChoose: openNew });

  // The commercial handoff. A layout already in commercial mode is left as it is (the link must not reset its rows). A design kept
  // from an earlier visit is switched as one undo step and the person is told how to get it back; a starter design is renamed.
  const goCommercial = (opts = {}) => {
    if (store.project.mode === 'commercial') return;
    const kept = state.fromAutosave;
    enterCommercial(store, { ...opts, name: kept ? null : 'Commercial units' });
    if (kept) toast('Your design was switched to a commercial layout. Undo brings it back.', { kind: 'info', timeout: 15000, action: { label: 'Undo', onClick: () => store.undo() } });
  };
  embed.ready();
  if (start.switchFrom) {
    // The design kept in this browser belongs to the other tool: offer to carry on there.
    const own = toolOfProject(start.switchFrom);
    toast(`Your saved design was made in ${TOOL_INFO[own].name}.`, { kind: 'info', timeout: 20000, action: { label: `Open in ${TOOL_INFO[own].name}`, onClick: () => openInTool(start.switchFrom, own) } });
  } else if (earlierDesign) {
    const prev = earlierDesign;
    earlierDesign = null;
    toast('Your earlier design is kept in this browser.', { kind: 'info', timeout: 12000, action: { label: 'Open earlier design', onClick: () => replaceProject(prev) } });
  }
  if (VIEWER) {
    mountViewerChrome(refs.stage, store);
    // Signed in? The first placement waits for this (src/ui/embed-viewer.js designPool), so the viewer opens on the person's own first design.
    if (!demoMode() && CONFIG.portalEnabled) api.portalReady = import('./portal/viewer-mode.js').then((m) => m.initPortalViewer(api)).catch((e) => { console.warn('[portal] viewer mode not available', e); return null; });
    const ev = initEmbedViewer({ store, catalogue, shell: refs.shell, viewerMode: true, getViewer, commercial: COMMERCIAL_VIEWER });
    api.embedViewer = ev;
    if (addressParam) ev.run(addressParam);
    else ev.startDemo();
  } else if (addressParam) {
    initEmbedViewer({ store, catalogue, shell: refs.shell, viewerMode: false }); // also answers gi:find-address
    api.addressLoad = loadAddress(store, catalogue, addressParam, { place: !startsFlow });
    api.addressLoad
      .then(({ lot }) => {
        if (!startsFlow) toast(`${lot.lotLabel} added to your design (${Math.round(lot.areaM2)} m²).`, { kind: 'ok' });
        if (wantCommercial) { goCommercial({ useClass: effectiveClass(store.project) || 'industrial' }); offerCommercial(store); }
      })
      .catch((e) => toast(e?.message || 'That address could not be loaded.', { kind: 'warn' }));
  }
  if (wantCommercial && !addressParam) goCommercial();
  if (shareId) await share.openLink(shareId);

  // Plan Pack (optional). Loaded after the first frame; the tool works without it.
  if (!demoMode()) await mountPremium();
  if (!demoMode() && !VIEWER && CONFIG.portalEnabled) await import('./portal/client-mode.js').then((m) => m.initPortalMode(window.__ps)).catch((e) => console.warn('[portal] client mode not available', e)).finally(() => window.__ps?.premium?.setPortalPending?.(false));
  else window.__ps?.premium?.setPortalPending?.(false);
  // Free user profiles: save designs to an account. Hidden for builder and client logins, subscribers and internal accounts, and when the server has no profile service.
  if (!demoMode() && !VIEWER) api.profilesReady = initProfiles(window.__ps, { refs }).then((p) => { profiles = p; window.__ps.profiles = p; return p; }).catch((e) => { console.warn('[profile] not available', e); return null; });
  // The guided flow opens before the tour: the tour starts when the person reaches the editor.
  let flowOpen = false;
  if (startsFlow && !VIEWER && !demoMode()) {
    try { flowOpen = !!(await initGuidedFlow({ api, store, refs, catalogue, viewer: VIEWER, demo: demoMode(), shareId, fromAutosave: state.fromAutosave, wantCommercial, hasAddress: !!addressParam })); } catch (e) { console.warn('[flow] could not start', e); }
  } else if (!VIEWER && !demoMode()) initGuidedFlow({ api, store, refs, catalogue, viewer: VIEWER, demo: demoMode(), shareId, fromAutosave: state.fromAutosave, wantCommercial }).catch(() => {});
  openStartGate();
  const startTour = () => import('./ui/onboarding/index.js').then((m) => m.initOnboarding?.(window.__ps)).catch(() => {});
  if (!VIEWER) {
    if (flowOpen && flowInProgress(store.project)) { const off = store.on('project', (e) => { if (e?.label === 'flow' && !flowInProgress(store.project)) { off(); startTour(); } }); }
    else startTour();
  }
  return api;
}

main().catch((err) => {
  console.error('[app] failed to start', err);
  const root = document.getElementById('app');
  if (root) {
    root.replaceChildren(
      h('div', { style: { padding: '24px', maxWidth: '520px' } },
        h('h1', { style: { fontSize: '20px', margin: '0 0 8px' } }, 'Glide Inside could not start'),
        h('p', null, 'Please reload the page. If this keeps happening, try another browser or clear this site\'s stored data.'),
        h('button', { class: 'ps-btn', type: 'button', onclick: () => location.reload() }, 'Reload')));
  }
});
