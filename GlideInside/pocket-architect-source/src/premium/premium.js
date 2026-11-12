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
import { createMockApi } from './ai/mock.js';
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
import { openEnquiry, lotPrefill } from './ui/enquiry.js';

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
    // { kind: 'public'|'builder'|'client', org, credits, token? }. Builder and client logins include the AI.
    session = options.config?.session || null,
  } = options;

  injectStyles();
  // The back end switches the paid version on: when GET {apiBase}/health answers ok, premiumEnabled is true for this session.
  // A frozen host config is copied so the flag can still change.
  const cfg = Object.isFrozen(config) ? { ...config } : config;
  // Builder and client AI features sit behind CONFIG.portalEnabled; without it every session behaves as a public one.
  const orgSession = !!cfg.portalEnabled && !!session && (session.kind === 'builder' || session.kind === 'client');
  const effSession = orgSession ? session : { kind: 'public' };
  const mockOn = !!cfg.aiMock;
  const realApi = createApi({ base: cfg.apiBase, fetchImpl });
  // CONFIG.aiMock: canned assistant replies and credits in the browser, so nothing is spent. Everything else stays real.
  const mock = !apiOverride && mockOn ? createMockApi({ getProject: () => store.project, session: effSession }) : null;
  const api = apiOverride || (mock ? { ...realApi, health: mock.health, credits: mock.credits, estimate: mock.estimate, edit: mock.edit, topUp: mock.topUp, setClientTopUps: mock.setClientTopUps } : realApi);
  // The assistant token: a login's own token, or a placeholder in mock mode. Plan Pack tokens stay in state.token.
  const aiToken = () => (mockOn ? 'mock.token' : orgSession ? session.token || null : null) || state.token;
  const layer = createLayer(mounts.modalRoot);
  // Developer unlock is honoured on localhost only, whatever the host configuration says (docs/SCOPE.md 4.3).
  const dev = () => !!cfg.devUnlock && isLocalHost();
  // Until the back end is live (premiumEnabled false) nothing here talks to the network.
  const live = () => !!cfg.premiumEnabled;
  const storedToken = (projectId) => (live() ? loadToken(projectId) : null);

  const state = { projectId: store.project.id, token: null, credits: null, creditsError: false, notice: null, exporting: null, portal: null };
  let disposed = false;
  let topbar = null;
  let assistant = null;

  // A builder or client login (src/portal) includes the plans and the AI helper: the builder pays, so there is no A$30 step.
  // state.portal = { entitled, token (null in the mock), clientExports (mock: build files in this browser), orgName, credits }.
  const portalOn = () => !!state.portal?.entitled;
  // Which downloads this person may have. Public Plan Pack and builder staff: all. Client logins: the builder's choice (PDF only by default).
  const allowedExports = () => (portalOn() && Array.isArray(state.portal.exports) ? state.portal.exports : EXPORT_ITEMS.map((i) => i.type));
  // "Send to JCE": public Plan Pack users, builder staff, and clients when the builder allows it.
  const canEnquire = () => (portalOn() ? state.portal.enquiry !== false : isEntitled());
  // "Send plans to a registered engineer" on the lot viewer card: open to anyone who can see the plan set PDFs (the PDFs are free), except a
  // client login whose builder has turned sending off (allowClientEnquiries).
  const canSendPlans = () => (portalOn() ? state.portal.enquiry !== false : true);
  const isEntitled = () => dev() || !!state.token || portalOn();
  const view = () => ({ entitled: isEntitled(), token: state.token || state.portal?.token || null, devUnlock: dev(), credits: state.credits, creditsError: state.creditsError, notice: state.notice, portal: portalOn() ? { orgName: state.portal.orgName || '', exports: allowedExports(), enquiry: state.portal.enquiry !== false, watermark: !!state.portal.watermark } : null, enquiry: canEnquire() });
  // Builder and client logins have the AI included; mock mode lets the owner review it for any session.
  const aiEntitled = () => isEntitled() || orgSession || mockOn;
  const aiView = () => ({ ...view(), entitled: aiEntitled(), token: aiToken(), session: effSession });

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
    const token = aiToken();
    const pid = state.projectId;
    if (!token) return null;
    try {
      const c = normaliseCredits(await api.credits(token, pid));
      if (disposed || state.projectId !== pid || aiToken() !== token) return null;
      setCredits(c);
      return c;
    } catch (e) {
      if (disposed || state.projectId !== pid || aiToken() !== token) return null;
      if (isAuthLoss(e) && !orgSession) authLost(e);
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
    if (aiToken()) refreshCredits();
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
    if (!allowedExports().includes(type)) {
      layer.notify('Your builder provides the PDF plans. Ask them if you need other file types.', 'info', 6000);
      return null;
    }
    if (!isEntitled()) {
      flows.openUpgrade({ source: `export-${type}` });
      return null;
    }
    if (state.exporting) return null;
    state.exporting = type;
    topbar?.setBusy(type, `Preparing ${exportLabel(type)}`);
    try {
      const out = await runExport(type, store.project, { api, token: state.token || state.portal?.token || null, devUnlock: dev() || (portalOn() && !!state.portal.clientExports), portalServer: portalOn() && !!state.portal.serverExport, watermark: portalOn() && !!state.portal.watermark, config: cfg, catalogue, getViewer, save: saveFile });
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

  // Send to JCE ---------------------------------------------------------------------------------------------------------------
  async function pdfBase64() {
    let blob = null;
    await runExport('pdf', store.project, { api, token: state.token || state.portal?.token || null, devUnlock: dev() || (portalOn() && !!state.portal.clientExports), portalServer: portalOn() && !!state.portal.serverExport, watermark: portalOn() && !!state.portal.watermark, config: cfg, catalogue, getViewer, save: (b) => { blob = b; } });
    if (!blob) return null;
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  }
  function openEnquiryForm(extra = {}) {
    const { anyone = false, ...rest } = extra;
    if (!(anyone ? canSendPlans() : canEnquire())) {
      layer.notify(portalOn() ? 'Your builder has turned off sending to JCE.' : 'Sending to JCE comes with the Plan Pack.', 'info', 6000);
      return null;
    }
    const send = state.portal?.sendEnquiry || ((body) => api.enquiryJce(body));
    // The found lot (site.lot) first, then whatever the builder portal knows; the person fills in any gaps.
    const portalLot = (typeof window !== 'undefined' && window.__ps?.portal?.getLot?.()) || {};
    const lot = lotPrefill(store.project, portalLot);
    const user = (typeof window !== 'undefined' && window.__ps?.portal?.me?.user) || {};
    const prefill = { name: user.name || '', email: user.email || '', phone: user.phone || '' };
    track('ps_enquiry_open');
    return openEnquiry({
      layer, send, buildPdf: pdfBase64, project: store.project, lot, prefill,
      source: portalOn() ? (state.portal.role === 'client' ? 'client' : 'builder') : 'public', orgName: portalOn() ? state.portal.orgName || '' : '', ...rest,
    });
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
        details: () => (portalOn() ? layer.notify(`Plans and the AI helper are included with your login${state.portal.orgName ? ` by ${state.portal.orgName}` : ''}.`, 'info', 6000) : flows.openDetails()),
        restore: () => flows.openRestore(),
        exportAs,
        previewPdf: () => previewPdf(),
        enquiry: () => openEnquiryForm(),
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
      getState: aiView,
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
    if (aiToken()) refreshCredits();
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
    if (disposed || state.token || !(dev() || cfg.stagingGrant)) return null;
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
      if (h.paymentsConfigured === false) return null; // the back end says payments are off: the Plan Pack stays unavailable
      cfg.premiumEnabled = true;
      const back = activate();
      publish();
      if (h.devGrant) await devGrant();
      return back ? await back : null;
    } catch {
      return null; // no back end here: the Plan Pack stays unavailable
    }
  }

  // Switch the paid version off only when the back end explicitly says payments are not configured; a failed or silent health check leaves it on.
  async function checkPaymentsOff() {
    try {
      const h = await api.health();
      if (disposed || !h || h.paymentsConfigured !== false) return;
      cfg.premiumEnabled = false;
      publish();
    } catch { /* unreachable: leave it on */ }
  }
  if (live()) {
    ready = Promise.resolve(activate()).then((r) => r);
    if (probe && !mockOn) ready = ready.then(async (r) => { await checkPaymentsOff(); return r; });
  }
  else {
    publish();
    if (aiToken()) refreshCredits(); // a login or mock session needs no Plan Pack to show its credits
    if (probe && !mockOn) ready = probeBackend();
  }

  // The app api (window.__ps) is how the PDF import reaches the editor; the store is always ours.
  const psApp = () => ({ ...(typeof window !== 'undefined' ? window.__ps : null), store, premium: self });

  /**
   * Called by the portal (src/portal/client-mode.js) for a signed in builder or client: plans without the A$30 step, and the AI
   * helper entitlement with the login's credits. credits: { total, used, remaining } for the month plus any top-up.
   * Pass null to remove it (sign out). The AI panel is wired by its own module; it reads this through premium.state.
   */
  function setPortalEntitlement(ent) {
    state.portal = ent && ent.entitled ? { ...ent } : null;
    if (state.portal?.credits) state.credits = normaliseCredits(state.portal.credits);
    else if (!state.portal) state.credits = null;
    publish();
  }

  const self = {
    isEntitled,
    setPortalEntitlement,
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
    openEnquiry: openEnquiryForm,
    canEnquire,
    canSendPlans,
    importPdf: () => runImportPdf(psApp(), { isEntitled, openUpgrade: () => flows.openUpgrade({ source: 'pdf-import' }), layer, config: cfg }),
    openRestore: (prefill) => flows.openRestore({ prefill }),
    refreshCredits,
    mockApi: mock,
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
