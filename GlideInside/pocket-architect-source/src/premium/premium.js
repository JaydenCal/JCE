// Plan Pack client (docs/SCOPE.md 4, 7, 8, 11). Everything paid goes through the server; this file wires the pieces:
// the locked and unlocked states, checkout return, restore, exports and the AI panel.
//
//   const premium = createPremium(store, { mounts: { topbar, aiPanel, modalRoot }, config, catalogue, getViewer });
//   premium.isEntitled(); premium.openUpgrade(); premium.openExports(); premium.dispose();
//
// The exporters are never imported here. Only the localhost development unlock loads them, on demand.

import { CONFIG as DEFAULT_CONFIG } from '../config.js';
import { isCommercialTool } from '../toolmode.js';
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
import { createCommercialBilling } from './ui/commercial-billing.js';
import { createGraceBanner } from './ui/grace-banner.js';
import { storage } from './util.js';
import { planTermsGate, termsForExport } from '../legal/terms-gate.js';

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
  const aiToken = () => (mockOn ? 'mock.token' : orgSession ? session.token || null : null) || (portalOn() ? state.portal.aiToken || null : null) || (csubOn() ? state.csub.token : null) || state.token;
  const layer = createLayer(mounts.modalRoot);
  // Developer unlock is honoured on localhost only, whatever the host configuration says (docs/SCOPE.md 4.3).
  const dev = () => !!cfg.devUnlock && isLocalHost();
  // Until the back end is live (premiumEnabled false) nothing here talks to the network.
  const live = () => !!cfg.premiumEnabled;
  const storedToken = (projectId) => (live() ? loadToken(projectId) : null);

  // csub: the Commercial Developer subscription or the commercial trial login, { token, kind: 'subscription' | 'trial' }, kept in this browser.
  // It only applies while the open design is a commercial layout (the server holds it to that as well).
  const CSUB_KEY = 'ps.cs.token';
  const readCsub = () => {
    try {
      const v = JSON.parse(storage.get(CSUB_KEY) || 'null');
      return v && typeof v.token === 'string' && ['subscription', 'trial'].includes(v.kind) ? { token: v.token, kind: v.kind } : null;
    } catch {
      return null;
    }
  };
  const state = { portalPending: !!cfg.portalEnabled && !cfg.portalMock, projectId: store.project.id, token: null, credits: null, creditsError: false, notice: null, exporting: null, portal: null, csub: readCsub() };
  const commercialNow = () => store.project?.mode === 'commercial' || isCommercialTool(); // the commercial tool always shows the subscription, never the Plan Pack
  const csubOn = () => !!state.csub?.token && commercialNow();
  // The token the server should see: the commercial login in commercial mode, otherwise the Plan Pack or portal token.
  const bearer = () => (csubOn() ? state.csub.token : state.token || state.portal?.token || null);
  // Plan set terms (src/legal): who is accepting, and where a signed in acceptance is recorded. A bearer token (Plan Pack, commercial login)
  // or a portal session is recorded on the server (POST /api/terms/accept); an anonymous visitor is remembered in this browser only.
  const tokenSubject = (t) => {
    try {
      const p = JSON.parse(atob(String(t).split('.')[0].replace(/-/g, '+').replace(/_/g, '/')));
      return p.eid || p.tid || null;
    } catch {
      return null;
    }
  };
  function termsIdentity() {
    if (csubOn()) return { subject: `csub:${tokenSubject(state.csub.token) || state.csub.kind}`, record: live() };
    if (state.token) return { subject: `pack:${tokenSubject(state.token) || 'token'}`, record: live() };
    if (portalOn()) {
      const u = (typeof window !== 'undefined' && window.__ps?.portal?.me?.user) || {};
      return { subject: `portal:${u.id || state.portal.orgName || 'login'}`, record: !cfg.portalMock };
    }
    return { subject: 'anon', record: false };
  }
  // Account before PDF: anyone without a free Glide Inside profile is asked to create one (or sign in) first. A Plan Pack, a builder or
  // client login and a trial are already identified, so they are not asked again. Where the page has no profile service nothing is asked.
  const profilesUi = () => (typeof window !== 'undefined' ? window.__ps?.profiles : null);
  planTermsGate.configure({
    accountMissing: () => {
      const pr = profilesUi();
      if (!pr?.ui?.requireAccount || termsIdentity().subject !== 'anon') return false;
      return pr.controller?.state?.status !== 'in' && pr.controller?.state?.status !== 'unavailable';
    },
    ensureAccount: ({ context }) => profilesUi().ui.requireAccount({ reason: context }),
    getIdentity: termsIdentity,
    record: (version, context) => api.acceptTerms({ version, context }, { token: csubOn() ? state.csub.token : state.token || null }),
  });
  let disposed = false;
  let topbar = null;
  let graceBanner = null;
  let assistant = null;

  // A builder or client login (src/portal) includes the plans and the AI design assistant: the builder pays, so there is no A$30 step.
  // state.portal = { entitled, token (null in the mock), clientExports (mock: build files in this browser), orgName, credits }.
  const portalOn = () => !!state.portal?.entitled;
  // Which downloads this person may have. Public Plan Pack and builder staff: all. Client logins: the builder's choice (PDF only by default).
  const allowedExports = () => (portalOn() && Array.isArray(state.portal.exports) ? state.portal.exports : EXPORT_ITEMS.map((i) => i.type));
  // "Send to JCE": public Plan Pack users, builder staff, and clients when the builder allows it.
  const canEnquire = () => (portalOn() ? state.portal.enquiry !== false : isEntitled());
  // "Send plans to a registered engineer" on the lot viewer card: open to anyone who can see the plan set PDFs (the PDFs are free), except a
  // client login whose builder has turned sending off (allowClientEnquiries).
  const canSendPlans = () => (portalOn() ? state.portal.enquiry !== false : true);
  const isEntitled = () => dev() || !!state.token || portalOn() || csubOn();
  const view = () => ({ entitled: isEntitled(), token: bearer(), csub: csubOn() ? { kind: state.csub.kind } : null, devUnlock: dev(), portalPending: !!state.portalPending, credits: state.credits, creditsError: state.creditsError, notice: state.notice, portal: portalOn() ? { orgName: state.portal.orgName || '', exports: allowedExports(), enquiry: state.portal.enquiry !== false, watermark: !!state.portal.watermark } : null, enquiry: canEnquire(), commercial: commercialNow() });
  // Builder and client logins have the AI included; mock mode lets the owner review it for any session.
  const aiEntitled = () => isEntitled() || orgSession || mockOn;
  const aiView = () => ({ ...view(), entitled: aiEntitled(), token: aiToken(), session: effSession });

  // State ---------------------------------------------------------------------------------------------------------------
  function publish() {
    if (disposed) return;
    const c = state.credits;
    store.setUI({ premium: { entitled: isEntitled(), credits: c ? { total: c.total, used: c.used, remaining: c.remaining } : null } });
    topbar?.render();
    graceBanner?.render();
    assistant?.render();
  }

  function setCredits(next) {
    state.credits = normaliseCredits(next);
    state.creditsError = false;
    if (disposed) return;
    const c = state.credits;
    store.setUI({ premium: { entitled: isEntitled(), credits: c ? { total: c.total, used: c.used, remaining: c.remaining } : null } });
    topbar?.render();
    graceBanner?.render();
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
    if (csubOn()) clearCsub();
    else clearToken(state.projectId);
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

  // Commercial mode is priced differently (Commercial Developer, A$50 per month): its own gate, account page and sign in.
  function setCsub(next) {
    state.csub = next;
    if (next) storage.set(CSUB_KEY, JSON.stringify(next));
    else storage.remove(CSUB_KEY);
    state.notice = null;
    state.creditsError = false;
    state.credits = null;
    assistant?.reset?.();
    publish();
    if (aiToken()) refreshCredits();
  }
  function clearCsub() {
    setCsub(null);
  }
  const commercialUi = createCommercialBilling({
    layer, api, store, config: cfg, getCsub: () => state.csub, setCsub, clearCsub, getCredits: () => state.credits,
    refreshCredits: () => refreshCredits(), navigate, timing,
    onReplace: (project) => store.replace?.(project),
  });
  if (mounts.topbar) {
    graceBanner = createGraceBanner({
      getState: view,
      manageBilling: () => commercialUi.openPortal().catch((e) => layer.notify(friendlyError(e, { area: 'checkout' }), 'error', 8000)),
    });
    graceBanner.render();
  }
  /** Every "unlock" entry point: the commercial gate in commercial mode, the A$30 Plan Pack otherwise. */
  const openUpgrade = (o) => (commercialNow() ? commercialUi.openGate(o) : flows.openUpgrade(o));
  const openRestore = (o) => (commercialNow() ? commercialUi.openRestore() : flows.openRestore(o));

  async function exportAs(type) {
    if (!EXPORT_ITEMS.some((i) => i.type === type)) return null;
    if (store.readOnly) { layer.notify('This shared design is view only, so nothing can be exported from it. Use Make your own to start a design of your own.', 'info', 6000); return null; } // a view only share link never exports
    if (!allowedExports().includes(type)) {
      layer.notify('Your builder provides the PDF plans. Ask them if you need other file types.', 'info', 6000);
      return null;
    }
    if (!isEntitled()) {
      openUpgrade({ source: `export-${type}` });
      return null;
    }
    if (state.exporting) return null;
    // Every export: the terms come first (src/legal). Nothing is generated until they are accepted for the current version (the server gates
    // html, glb and obj as well as pdf and dxf since the 15/11/2026 security review). Only the PDF and DXF carry the terms note inside the file.
    const gated = true;
    const planFile = type === 'pdf' || type === 'dxf';
    if (gated && !(await planTermsGate.require({ context: `export-${type}` }))) return null;
    state.exporting = type;
    topbar?.setBusy(type, `Preparing ${exportLabel(type)}`);
    try {
      const go = () => runExport(type, store.project, { api, token: bearer(), devUnlock: dev() || (portalOn() && !!state.portal.clientExports), portalServer: portalOn() && !!state.portal.serverExport, watermark: portalOn() && !!state.portal.watermark, config: cfg, catalogue, getViewer, save: saveFile, terms: planFile ? termsForExport() : null });
      let out;
      try {
        out = await go();
      } catch (e) {
        // The server has no acceptance on record for this account (accepted on another device, or the record failed): ask and record again, once.
        if (!(gated && e?.code === 'TERMS_REQUIRED')) throw e;
        planTermsGate.forget();
        if (!(await planTermsGate.require({ context: `export-${type}` }))) return null;
        out = await go();
      }
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
    // The PDF attached to a "Send to JCE" request is a plan PDF too: the terms come first. Declined, it goes without the PDF.
    if (!(await planTermsGate.require({ context: 'send-to-jce' }))) return null;
    await runExport('pdf', store.project, { api, token: bearer(), devUnlock: dev() || (portalOn() && !!state.portal.clientExports), portalServer: portalOn() && !!state.portal.serverExport, watermark: portalOn() && !!state.portal.watermark, config: cfg, catalogue, getViewer, save: (b) => { blob = b; }, terms: termsForExport() });
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
    if (store.readOnly) { layer.notify('This shared design is view only, so plans cannot be made from it.', 'info', 6000); return null; }
    if (previewing && !previewing.el.isConnected) previewing = null;
    if (previewing) return previewing;
    // The free preview builds a plan PDF in this browser too, so it is behind the terms (remembered after the first time).
    if (!planTermsGate.isAccepted() || planTermsGate.needsAccount()) {
      return planTermsGate.require({ context: 'pdf-preview' }).then((ok) => (ok ? previewPdf(hooks) : null));
    }
    const entitled = isEntitled();
    previewing = openPdfPreview({
      layer, project: store.project, store, config: cfg, catalogue, getViewer, entitled, hooks,
      onUnlock: () => openUpgrade({ source: 'export-pdf-preview' }),
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
            else if (locked) openUpgrade({ source: `export-${item.type}` });
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
        unlock: (source) => openUpgrade({ source }),
        details: () => (csubOn() ? commercialUi.openAccount() : portalOn() ? layer.notify(`Plans and the AI design assistant are included with your login${state.portal.orgName ? ` by ${state.portal.orgName}` : ''}.`, 'info', 6000) : flows.openDetails()),
        restore: () => openRestore(),
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
        unlock: (source) => openUpgrade({ source }),
        restore: () => openRestore(),
        buyMore: () => commercialUi.buyMore(),
        setCredits,
        authLost,
      },
    });
  }

  // Events ----------------------------------------------------------------------------------------------------------------------
  let wasCommercialMode = store.project?.mode === 'commercial';
  const offProject = store.on('project', () => {
    if (store.project.id !== state.projectId) loadProjectState();
    const comm = store.project?.mode === 'commercial';
    if (comm !== wasCommercialMode) {
      wasCommercialMode = comm;
      state.credits = null;
      if (aiToken()) refreshCredits();
      publish();
    } // Exports and Unlock plans change wording in commercial mode
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

  // Commercial return: ?csub=success|topup|cancel&session_id=... (the commercial landing hand off keeps its own ?mode=commercial).
  function readCsubReturn() {
    const params = new URLSearchParams(window.location.search);
    const status = params.get('csub');
    if (!['success', 'topup', 'cancel'].includes(status)) return null;
    const sessionId = params.get('session_id');
    params.delete('csub');
    params.delete('session_id');
    const qs = params.toString();
    try {
      window.history.replaceState(window.history.state, '', `${window.location.pathname}${qs ? `?${qs}` : ''}${window.location.hash}`);
    } catch {
      /* the address bar is not essential */
    }
    return status === 'cancel' || sessionId ? { status, sessionId } : null;
  }

  // Called once the back end is known to be there (premiumEnabled true from the start, or after the health check).
  function activate() {
    state.token = storedToken(state.projectId);
    publish();
    if (aiToken()) refreshCredits();
    if (checkoutReturn) {
      const cs = readCsubReturn();
      if (cs) commercialUi.handleReturn(cs);
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
  /** True until the sign-in check finishes, so a signed-in builder client never sees the A$30 button flash. */
  function setPortalPending(v) { state.portalPending = !!v; publish(); }
  function setPortalEntitlement(ent) {
    state.portalPending = false;
    state.portal = ent && ent.entitled ? { ...ent } : null;
    if (state.portal?.credits) state.credits = normaliseCredits(state.portal.credits);
    else if (!state.portal) state.credits = null;
    publish();
  }

  const self = {
    isEntitled,
    setPortalEntitlement,
    setPortalPending,
    openUpgrade: () => openUpgrade({ source: 'api' }),
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
      graceBanner?.dispose();
      layer.dispose();
    },
    // Extras for the host page and tests.
    exportAs,
    previewPdf,
    openEnquiry: openEnquiryForm,
    canEnquire,
    canSendPlans,
    importPdf: () => runImportPdf(psApp(), { isEntitled, openUpgrade: () => openUpgrade({ source: 'pdf-import' }), layer, config: cfg }),
    openRestore: (prefill) => openRestore({ prefill }),
    commercial: commercialUi,
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
