// Plan Studio app shell. Renders into #app: top bar, tools, plan editor, 3D host, right panel and status bar.
// The catalogue, 3D viewer and Plan Pack are separate modules, loaded on demand and allowed to fail.

import { CONFIG } from './config.js';
import { createStore, loadAutosave } from './model/store.js';
import { createProject, migrate, validate } from './model/schema.js';
import { createEditor2D } from './editor2d/editor.js';
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
import { createStageChips, createWelcome } from './ui/stage-ui.js';
import { openTemplatePicker } from './ui/templates.js';
import { saveDesign, pickDesignFile } from './ui/files.js';
import { createEmbed } from './ui/embed.js';
import { createViewManager } from './ui/views.js';
import { createSampleProject, SAMPLE_TEMPLATE } from './ui/sample.js';
import { setTool } from './ui/toolstate.js';
import { createWheel } from './ui/wheel.js';
import { createInventory } from './ui/inventory.js';
import { openTitleBlockForm, getLogo } from './ui/titleblock.js';
import { TOOL_DEFS, DOOR_FAMILY, KIND_LABEL } from './editor2d/tools-meta.js';
import { track } from './ui/analytics.js';
import { designTypeOf, changeDesignType, applyDesignType } from './ui/design-type.js';

const demoMode = () => CONFIG.embedMode === 'demo';

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

function initialProject(catalogue) {
  if (!demoMode()) {
    const saved = loadAutosave(CONFIG.autosaveKey);
    if (saved) return { project: saved, fromAutosave: true };
  }
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
      return { project, fromAutosave: false, templateId: t.id };
    } catch (e) {
      console.warn(`[template] ${t.id} could not be loaded`, e);
    }
  }
  return { project: createProject({ name: 'Untitled design' }), fromAutosave: false };
}

async function main() {
  initTheme();
  const root = document.getElementById('app');
  if (!root) throw new Error('#app is missing');
  const refs = buildShell(root);
  mountToasts(refs.toasts);
  mountModals(refs.modalRoot);
  refs.shell.dataset.mode = demoMode() ? 'demo' : 'full';

  const catalogue = await loadCatalogue();
  const start = initialProject(catalogue);
  const state = { fromAutosave: start.fromAutosave };
  const narrow = window.matchMedia?.('(max-width: 899.98px)').matches;
  // On small screens the properties panel starts as a collapsed bottom sheet so the plan keeps the room.
  if (narrow) refs.panel.dataset.open = 'false';
  // A demo (teaser) never writes the autosave slot, so it cannot overwrite a visitor's real design.
  const noAutosave = demoMode();
  const store = createStore(start.project, { autosaveKey: noAutosave ? null : CONFIG.autosaveKey, opContext: { catalogue } });

  const editor = createEditor2D(refs.planHost, store, { catalogue });
  const views = createViewManager({ store, refs, editor, catalogue });
  const getViewer = views.getViewer;
  const panel = createPanel(refs, store, { catalogue, editor });
  const fileInput = h('input', { type: 'file', accept: 'application/json,.json', hidden: true, tabindex: '-1', 'aria-hidden': 'true' });
  refs.shell.append(fileInput);

  let embed = null;
  const hasEdits = () => store.canUndo() || state.fromAutosave;

  // Loading designs --------------------------------------------------------------------------------------------------------
  function replaceProject(project) {
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

  function openNew() {
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

  function save() {
    saveDesign(store);
    track('ps_project_saved');
  }

  // Chrome -------------------------------------------------------------------------------------------------------------------
  const topbar = createTopbar(refs.topbar, store, {
    demo: demoMode(),
    onNew: openNew,
    onOpen: openFile,
    onSave: save,
    onOpenFull: () => embed?.openFull(),
  });
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

  // Keyboard -------------------------------------------------------------------------------------------------------------------
  // After a mouse click on a bar button, drop focus so Space (pan) and Delete reach the plan, not the button.
  refs.shell.addEventListener('click', (e) => {
    if (e.detail === 0) return;
    const btn = e.target.closest?.('button');
    if (btn && btn.closest('.ps-topbar, .ps-toolbox, .ps-statusbar, .ps-panel-head')) btn.blur();
  });
  // I opens the Inventory (quick slots for the Q wheel). Not while walking, where the pointer is captured by the viewer.
  window.addEventListener('keydown', (e) => {
    if ((e.key !== 'i' && e.key !== 'I') || e.ctrlKey || e.metaKey || e.altKey || e.repeat || e.defaultPrevented) return;
    if (isTyping(e.target) || document.querySelector('.ps-modal') || store.ui.view === 'walk') return;
    e.preventDefault();
    openInventory();
  });
  window.addEventListener('keydown', (e) => {
    if (e.defaultPrevented || !(e.ctrlKey || e.metaKey) || e.altKey) return;
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
  const api = { changeDesignType: (id, opts) => changeDesignType(store, id, catalogue, opts), applyDesignType: (id) => applyDesignType(store, id, catalogue), designTypeOf: () => designTypeOf(store.project), tools, keys, setTool: (id, arg) => setTool(store, id, arg), wheel, inventory, openInventory, openTitleBlock: () => openTitleBlockForm(store), getLogo, store, editor, getViewer, premium: null, catalogue, CONFIG, embed, panel, topbar, toolbox, drawer, statusbar, chips, views, openNew, loadTemplate, loadBlank, replaceProject, setMode };
  window.__ps = api;

  // Start state ------------------------------------------------------------------------------------------------------------------
  const params = new URLSearchParams(location.search);
  const phone = window.matchMedia?.('(max-width: 599.98px) and (pointer: coarse)').matches;
  const wantedView = params.get('view');
  if (wantedView === '3d' || wantedView === 'walk' || wantedView === '2d') store.setUI({ view: wantedView });
  else if (phone) store.setUI({ view: '3d' });
  track('ps_open', { embedMode: CONFIG.embedMode });

  if (!state.fromAutosave && !demoMode() && !narrow) createWelcome(refs.stage, store, { onChoose: openNew });

  embed.ready();

  // Plan Pack (optional). Loaded after the first frame; the tool works without it.
  if (!demoMode()) await mountPremium();
  import('./ui/onboarding/index.js').then((m) => m.initOnboarding?.(window.__ps)).catch(() => {});
  return api;
}

main().catch((err) => {
  console.error('[app] failed to start', err);
  const root = document.getElementById('app');
  if (root) {
    root.replaceChildren(
      h('div', { style: { padding: '24px', maxWidth: '520px' } },
        h('h1', { style: { fontSize: '20px', margin: '0 0 8px' } }, 'Plan Studio could not start'),
        h('p', null, 'Please reload the page. If this keeps happening, try another browser or clear this site\'s stored data.'),
        h('button', { class: 'ps-btn', type: 'button', onclick: () => location.reload() }, 'Reload')));
  }
});
