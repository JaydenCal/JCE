// Plan Pack client (docs/SCOPE.md 4, 7, 8, 11). Everything paid goes through the server; this file wires the pieces:
// the locked and unlocked states, checkout return, restore, exports and the AI panel.
//
//   const premium = createPremium(store, { mounts: { topbar, aiPanel, modalRoot }, config, catalogue, getViewer });
//   premium.isEntitled(); premium.openUpgrade(); premium.openExports(); premium.dispose();
//
// The exporters are never imported here. Only the localhost development unlock loads them, on demand.

import { CONFIG as DEFAULT_CONFIG } from '../config.js';
import { injectStyles } from './styles.js';
import { createApi } from './api.js';
import { loadToken, saveToken, clearToken, tokenKey } from './entitlement.js';
import { createLayer } from './ui/modal.js';
import { createFlows } from './ui/flows.js';
import { createTopbarUI } from './ui/topbar.js';
import { createAssistant } from './ui/assistant.js';
import { runExport, exportLabel, EXPORT_ITEMS, isLocalHost } from './export-client.js';
import { normaliseCredits } from './credits.js';
import { friendlyError, isAuthLoss } from './messages.js';
import { ApiError } from './api.js';
import { el, track } from './util.js';
import { icon } from './icons.js';
import { importPdf as runImportPdf } from './pdf-import.js';
import { openPdfPreview } from './pdf-preview.js';

export function createPremium(store, options = {}) {
  const {
    mounts = {},
    config = DEFAULT_CONFIG,
    catalogue = null,
    getViewer = null,
    // Hooks for tests and host pages. Normal use never sets these.
    api: apiOverride = null,
    fetchImpl = null,
    navigate = undefined,
    timing = {},
    saveFile = undefined,
    checkoutReturn = true,
    probe = true,
  } = options;

  injectStyles();
  // The back end switches the paid version on: when GET {apiBase}/health answers ok, premiumEnabled is true for this session.
  // A frozen host config is copied so the flag can still change.
  const cfg = Object.isFrozen(config) ? { ...config } : config;
  const api = apiOverride || createApi({ base: cfg.apiBase, fetchImpl });
  const layer = createLayer(mounts.modalRoot);
  // Developer unlock is honoured on localhost only, whatever the host configuration says (docs/SCOPE.md 4.3).
  const dev = () => !!cfg.devUnlock && isLocalHost();
  // Until the back end is live (premiumEnabled false) nothing here talks to the network.
  const live = () => !!cfg.premiumEnabled;
  const storedToken = (projectId) => (live() ? loadToken(projectId) : null);

  const state = { projectId: store.project.id, token: null, credits: null, creditsError: false, notice: null, exporting: null };
  let disposed = false;
  let topbar = null;
  let assistant = null;

  const isEntitled = () => dev() || !!state.token;
  const view = () => ({ entitled: isEntitled(), token: state.token, devUnlock: dev(), credits: state.credits, creditsError: state.creditsError, notice: state.notice });

  // State ---------------------------------------------------------------------------------------------------------------
  function publish() {
    if (disposed) return;
    const c = state.credits;
    store.setUI({ premium: { entitled: isEntitled(), credits: c ? { total: c.total, used: c.used, remaining: c.remaining } : null } });
    topbar?.render();
    assistant?.render();
  }

  function setCredits(next) {
    state.credits = normaliseCredits(next);
    state.creditsError = false;
    if (disposed) return;
    const c = state.credits;
    store.setUI({ premium: { entitled: isEntitled(), credits: c ? { total: c.total, used: c.used, remaining: c.remaining } : null } });
    topbar?.render();
    assistant?.refreshCredits();
  }

  async function refreshCredits() {
    const token = state.token;
    const pid = state.projectId;
    if (!token) return null;
    try {
      const c = normaliseCredits(await api.credits(token, pid));
      if (disposed || state.projectId !== pid || state.token !== token) return null;
      setCredits(c);
      return c;
    } catch (e) {
      if (disposed || state.projectId !== pid || state.token !== token) return null;
      if (isAuthLoss(e)) authLost(e);
      else {
        state.creditsError = true;
        assistant?.refreshCredits();
      }
      return null;
    }
  }

  function loadProjectState() {
    state.projectId = store.project.id;
    state.token = storedToken(state.projectId);
    state.credits = null;
    state.creditsError = false;
    state.notice = null;
    assistant?.reset();
    publish();
    if (state.token) refreshCredits();
  }

  // The server said this token no longer works (refunded, expired, unknown). Forget it and offer to restore.
  const authText = (e) => {
    const said = typeof e?.message === 'string' ? e.message.trim() : '';
    if (!said) return 'Your Plan Pack could not be verified. Restore your purchase to continue.';
    return /restore/i.test(said) ? said : `${said} If you think this is a mistake, restore your purchase.`;
  };

  function authLost(why) {
    clearToken(state.projectId);
    state.token = null;
    state.credits = null;
    state.notice = typeof why === 'string' ? why : authText(why);
    layer.notify(state.notice, 'warn', 8000);
    publish();
  }

  /** A purchase was confirmed or restored. Keep the token for its project; unlock now if that design is open. */
  function accept(res) {
    saveToken(res.projectId, res.token);
    if (res.projectId !== store.project.id) return { active: false, projectId: res.projectId };
    state.token = res.token;
    state.notice = null;
    state.creditsError = false;
    state.credits = normaliseCredits(res.credits);
    publish();
    if (!state.credits) refreshCredits();
    return { active: true, projectId: res.projectId };
  }

  // Flows and UI --------------------------------------------------------------------------------------------------------
  const flows = createFlows({ layer, store, config: cfg, api, accept, getState: view, navigate, timing });

  async function exportAs(type) {
    if (!EXPORT_ITEMS.some((i) => i.type === type)) return null;
    if (!isEntitled()) {
      flows.openUpgrade({ source: `export-${type}` });
      return null;
    }
    if (state.exporting) return null;
    state.exporting = type;
    topbar?.setBusy(type, `Preparing ${exportLabel(type)}`);
    try {
      const out = await runExport(type, store.project, { api, token: state.token, devUnlock: dev(), config: cfg, catalogue, getViewer, save: saveFile });
      track('ps_export', { type });
      layer.notify(`${exportLabel(type)} downloaded as ${out.filename}.`, 'ok');
      topbar?.announce(`${exportLabel(type)} downloaded`);
      return out;
    } catch (e) {
      if (isAuthLoss(e) && !dev()) authLost(e);
      else if (e instanceof ApiError) layer.notify(friendlyError(e, { area: 'export', dev: dev() }), 'error', 8000);
      else {
        console.warn('[premium] export failed', e);
        layer.notify('That file could not be built. Try again, or try a different format.', 'error', 8000);
      }
      return null;
    } finally {
      state.exporting = null;
      topbar?.setBusy(null, '');
    }
  }

  // PDF plans: everyone sees the sheets first (watermarked and low resolution when free). Download is the paid path.
  let previewing = null;
  function previewPdf(hooks = {}) {
    if (previewing && !previewing.el.isConnected) previewing = null;
    if (previewing) return previewing;
    const entitled = isEntitled();
    previewing = openPdfPreview({
      layer, project: store.project, store, config: cfg, catalogue, getViewer, entitled, hooks,
      onUnlock: () => flows.openUpgrade({ source: 'export-pdf-preview' }),
      onDownload: () => exportAs('pdf'),
    });
    track('ps_pdf_preview_open', { entitled });
    return previewing;
  }

  // Used when the host gave no top bar slot: the same choices in a small dialog.
  function openExportsFallback() {
    const locked = !isEntitled();
    return layer.openModal({
      title: 'Exports',
      size: 'sm',
      body: (close) => el('div', { class: 'psp-menu', style: { position: 'static', width: 'auto', border: '0', boxShadow: 'none', padding: '0' } },
        EXPORT_ITEMS.map((item) => el('button', {
          class: 'psp-menu-item', type: 'button',
          onclick: () => {
            close('pick');
            if (item.type === 'pdf') previewPdf();
            else if (locked) flows.openUpgrade({ source: `export-${item.type}` });
            else exportAs(item.type);
          },
        }, el('span', null, item.label), icon(locked ? 'lock' : 'download', 16), el('small', null, locked ? `${item.hint}. Locked.` : item.hint)))),
      footer: (close) => el('button', { class: 'psp-btn', type: 'button', onclick: () => close('done') }, 'Close'),
    });
  }

  if (mounts.topbar) {
    topbar = createTopbarUI({
      root: mounts.topbar,
      config: cfg,
      getState: view,
      actions: {
        unlock: (source) => flows.openUpgrade({ source }),
        details: () => flows.openDetails(),
        restore: () => flows.openRestore(),
        exportAs,
        previewPdf: () => previewPdf(),
      },
    });
  }
  if (mounts.aiPanel) {
    assistant = createAssistant({
      root: mounts.aiPanel,
      store,
      api,
      config: cfg,
      catalogue,
      layer,
      getState: view,
      actions: {
        unlock: (source) => flows.openUpgrade({ source }),
        restore: () => flows.openRestore(),
        setCredits,
        authLost,
      },
    });
  }

  // Events ----------------------------------------------------------------------------------------------------------------------
  const offProject = store.on('project', () => {
    if (store.project.id !== state.projectId) loadProjectState();
  });
  const onStorage = (e) => {
    if (e.key === tokenKey(state.projectId)) loadProjectState();
  };
  window.addEventListener('storage', onStorage);

  // Checkout return: ?checkout=success&session_id=...&project=...
  let ready = Promise.resolve(null);
  function readReturn() {
    const params = new URLSearchParams(window.location.search);
    const status = params.get('checkout');
    if (!status) return null;
    const sessionId = params.get('session_id');
    const projectId = params.get('project');
    for (const k of ['checkout', 'session_id', 'project']) params.delete(k);
    const qs = params.toString();
    try {
      window.history.replaceState(window.history.state, '', `${window.location.pathname}${qs ? `?${qs}` : ''}${window.location.hash}`);
    } catch {
      /* the address bar is not essential */
    }
    return { status, sessionId, projectId };
  }

  // Called once the back end is known to be there (premiumEnabled true from the start, or after the health check).
  function activate() {
    state.token = storedToken(state.projectId);
    publish();
    if (state.token) refreshCredits();
    if (checkoutReturn) {
      const back = readReturn();
      if (back?.status === 'success' && back.sessionId && back.projectId) return flows.handleReturn({ sessionId: back.sessionId, projectId: back.projectId });
      if (back?.status === 'cancel') layer.notify('Checkout cancelled. You have not been charged.', 'info');
    }
    return null;
  }

  // Local testing without Stripe: the site's development server offers a test entitlement (PLAN_STUDIO_DEV_GRANT=1).
  // Only asked for on localhost with ?dev in the address.
  async function devGrant() {
    if (disposed || state.token || !dev()) return null;
    const pid = state.projectId;
    try {
      const res = await api.devGrant(pid);
      if (disposed || !res?.token || store.project.id !== pid) return null;
      accept({ ...res, projectId: res.projectId || pid });
      return res;
    } catch (e) {
      console.warn('[premium] dev grant not available', e?.code || e);
      return null;
    }
  }

  async function probeBackend() {
    try {
      const h = await api.health();
      if (disposed || !h || h.ok !== true) return null;
      cfg.premiumEnabled = true;
      const back = activate();
      publish();
      if (h.devGrant) await devGrant();
      return back ? await back : null;
    } catch {
      return null; // no back end here: the Plan Pack stays "coming soon"
    }
  }

  if (live()) ready = Promise.resolve(activate()).then((r) => r);
  else {
    publish();
    if (probe) ready = probeBackend();
  }

  // The app api (window.__ps) is how the PDF import reaches the editor; the store is always ours.
  const psApp = () => ({ ...(typeof window !== 'undefined' ? window.__ps : null), store, premium: self });

  const self = {
    isEntitled,
    openUpgrade: () => flows.openUpgrade({ source: 'api' }),
    openExports() {
      if (topbar) topbar.open();
      else openExportsFallback();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      offProject?.();
      window.removeEventListener('storage', onStorage);
      assistant?.dispose();
      topbar?.dispose();
      layer.dispose();
    },
    // Extras for the host page and tests.
    exportAs,
    previewPdf,
    importPdf: () => runImportPdf(psApp(), { isEntitled, openUpgrade: () => flows.openUpgrade({ source: 'pdf-import' }), layer, config: cfg }),
    openRestore: (prefill) => flows.openRestore({ prefill }),
    refreshCredits,
    ready,
    get state() {
      return { ...view(), projectId: state.projectId, exporting: state.exporting };
    },
  };
  // Hosts reach the PDF import through window.__ps.premium.importPdf.
  try {
    if (typeof window !== 'undefined' && window.__ps) window.__ps.premium = window.__ps.premium || self;
  } catch {
    /* not essential */
  }
  return self;
}

export default createPremium;
