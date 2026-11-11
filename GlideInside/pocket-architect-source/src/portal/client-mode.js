// Pocket Architect when someone is signed in through the builder portal (builder staff or a client login).
// app.js calls initPortalMode(window.__ps) after the Plan Pack layer has mounted. With no portal session, or with
// CONFIG.portalEnabled false, it does nothing at all and the public app is untouched.
//
// What it adds: a strip with the builder's branding, "Find my block", a "House designs" dropdown (the builder's designs and the
// Glide Inside library, ranked by how well each fits the lot), PDF plans (no A$30 step), the AI credits chip, and a user menu.
// Hooks for other modules:
//   window.openSiteSearch()                 if present, "Find my block" calls it (the site's lot search)
//   window.__ps.portal.setLot(lot)          { name, polygonMm, frontEdgeIndices, picked, address, lot, dp, lga, zone }: the lot and its setbacks
//   window.__ps.portal.getLot()             the lot details for the JCE enquiry form

import { CONFIG } from '../config.js';
import { h, clear } from '../ui/dom.js';
import { toast } from '../ui/toast.js';
import { getPortalApi } from './api.js';
import { injectStripStyles } from './app-strip-styles.js';
import { applyBrandTheme, clearBrandTheme } from './theme-css.js';
import { signInUrl, portalUrl } from './links.js';
import { designMode as isDesignMode, clientLike as isClientLike, wantsGlide, fullEditorHref, designNewHref } from './design-mode.js';
import { SAMPLE_LOT, lotEnvelope, portalLotToSiteLot } from './envelope.js';
import { rankDesigns } from './fit.js';
import { startPlacement } from './placement.js';
import { defaultPose } from './place-house.js';
import { autoPose } from './auto-place.js';
import { lotOf } from '../model/placement.js';
import { orientedBox } from '../site/lotplan.js';
import { projectToSvg, svgDataUri } from './thumbnail.js';
import { createProject } from '../model/schema.js';
import { builderDesigns } from '../lotcard/designs.js';

const LOGO_KEY = 'ps.logo';
const AUTOSAVE = () => CONFIG.autosaveKey;
const OWNER_KEY = 'ps.portal.owner';
const EMPTY_LIBRARY = 'Your builder has not added house designs yet. Ask them to add one, or draw your own with Edit floor plan.';

export async function initPortalMode(app, { api = getPortalApi(), location: loc = globalThis.location } = {}) {
  if (!CONFIG.portalEnabled) return null;
  let me;
  try {
    me = await api.me();
  } catch (e) {
    if (e?.code === 'PASSWORD_CHANGE_REQUIRED') {
      loc.href = signInUrl('?change=1');
      return null;
    }
    me = null;
  }
  // A login that still has a temporary password must finish the password change first; otherwise every design call fails.
  if (me?.user?.mustChangePassword) { loc.href = signInUrl('?change=1'); return null; }
  const params = new URLSearchParams(loc.search);
  if (!me) {
    if (params.has('signin') || params.has('house') || params.has('project') || params.has('glide')) loc.href = signInUrl(`?return=${encodeURIComponent(loc.href)}`);
    return null;
  }

  injectStripStyles();
  const { store, editor } = app;
  const premium = app.premium;
  const isClient = me.user.role === 'client';
  // Builder or staff login using "Design on a lot" (?design=new, or ?design=1&project=<id> from Open as client view): the same experience a client
  // gets (the builder's branding and own houses only, Find my block, place, colours, rooms, walk inside, lot card, send, exports), plus the staff extras.
  const designMode = isDesignMode(me.user.role, params);
  const clientLike = isClientLike(me.user.role, params);
  let reviewOwner = null; // the client whose saved project staff opened as that client sees it
  const brand = me.org.branding || {};
  applyBrandTheme(brand.colours); // builder colour scheme over the app chrome; the 3D scene, aerial and setback states keep their own colours
  // A real client starts with no lot: the sample lot only exists in the review (mock) build, so designs are never ranked against it.
  let lot = CONFIG.portalMock ? { ...SAMPLE_LOT, address: me.lotAddress || '' } : null;
  let lotIsSample = !!lot;
  let envelope = null;
  let currentProjectId = null;
  let credits = me.ai;

  // Branding: the builder's logo in the title block and the PDF.
  if (brand.logoDataUrl) {
    try { localStorage.setItem(LOGO_KEY, brand.logoDataUrl); } catch { /* storage blocked */ }
    app.getLogo = () => brand.logoDataUrl;
  }
  // The PDF plan set leads with the builder's name and logo and credits Glide Inside in small print.
  app.builder = { name: brand.displayName || me.org.name, logo: brand.logoDataUrl || null };
  document.querySelector('.ps-welcome')?.remove();
  const entitlement = () => ({
    entitled: true, token: null, clientExports: true, role: me.user.role, orgName: brand.displayName || me.org.name, credits: toCredits(credits),
    exports: me.exports, enquiry: me.enquiry, watermark: me.exportWatermark === true, serverExport: me.exportWatermark === true, sendEnquiry: (body) => api.enquiryJce(body),
  });
  premium?.setPortalEntitlement?.(entitlement());
  function toCredits(b) { return b ? { total: b.total, used: b.total - b.remaining, remaining: b.remaining } : null; }

  async function refreshEnvelope() {
    envelope = lot?.polygonMm ? await lotEnvelope(lot.polygonMm, lot.frontEdgeIndices, lot.picked) : null;
  }
  await refreshEnvelope();

  // Clients start on an empty lot; staff keep whatever they have open.
  if (designMode && params.get('design') === 'new' && !params.has('project') && !params.has('house') && !params.has('glide')) {
    app.replaceProject?.(createProject({ name: 'My home' })); // a new design on a blank lot; a reload then keeps the design (design=1)
    try { const u = new URL(loc.href); u.searchParams.set('design', '1'); globalThis.history?.replaceState?.(null, '', u.href); } catch { /* not a browser */ }
  } else if (isClient && !params.has('project') && !params.has('house') && !params.has('glide')) {
    // A different person last used this browser: start on a blank lot rather than showing their design.
    let last = null;
    try { last = localStorage.getItem(OWNER_KEY); localStorage.setItem(OWNER_KEY, me.user.id); } catch { /* storage blocked */ }
    if (last !== me.user.id) app.replaceProject?.(createProject({ name: 'My home' }));
  }

  // Strip -----------------------------------------------------------------------------------------------------------------------
  const strip = h('div', { class: 'pas-strip', role: 'region', 'aria-label': 'Builder tools' });
  const shell = document.querySelector('.ps-shell');
  if (shell) {
    shell.insertBefore(strip, shell.querySelector('.ps-main'));
    shell.style.gridTemplateRows = 'auto auto minmax(0, 1fr) auto'; // the strip is one more row under the top bar
  }
  // Signed in users are professionals or have been walked through by their builder: no demo tour.
  try { localStorage.setItem('ps.tour.done', '1'); } catch { /* storage blocked */ }
  const statusLine = h('span', { class: 'pas-status', role: 'status', 'aria-live': 'polite' });
  const aiChip = h('button', { class: 'pas-chip', type: 'button', onclick: aiDialog });
  const housesBtn = h('button', { class: 'pas-btn pas-btn--primary', type: 'button', 'aria-haspopup': 'dialog', onclick: () => openPicker() }, 'House designs');
  const findBtn = h('button', { class: 'pas-btn', type: 'button', onclick: findMyBlock }, 'Find my block');
  const fullBtn = h('button', { class: 'pas-btn', type: 'button', id: 'pas-full-editor', title: 'Leave the client view and use the whole editor', onclick: () => { loc.href = fullEditorHref(loc.href); } }, 'Full editor');
  const designBtn = h('button', { class: 'pas-btn', type: 'button', id: 'pas-design-on-lot', title: 'Design on a lot the way your clients do', onclick: () => { loc.href = designNewHref(loc.href); } }, 'Design on a lot');
  const plansBtn = h('button', { class: 'pas-btn', type: 'button', onclick: () => premium?.previewPdf?.() }, 'Plans (PDF)');
  const userMenu = menu(me.user.name || me.user.username, [
    ['Save project', () => saveProject()],
    ['My projects', () => projectsDialog()],
    ...(!isClient ? [['Save to house library', () => saveToLibrary()]] : []),
    ...(designMode ? [['Open full editor', () => { loc.href = fullEditorHref(loc.href); }]] : []),
    ...(!isClient && !designMode ? [['Design on a lot', () => { loc.href = designNewHref(loc.href); }]] : []),
    ...(me.enquiry ? [['Send to JCE for engineering and DA plans', () => premium?.openEnquiry?.()]] : []),
    ...(!isClient ? [['Builder dashboard', () => { loc.href = portalUrl(); }]] : []),
    ['Sign out', signOut],
  ]);
  const renderStrip = () => {
    clear(strip);
    strip.append(...[
      h('div', { class: 'pas-brand' }, brand.logoDataUrl ? h('img', { src: brand.logoDataUrl, alt: '' }) : null, h('div', null, h('strong', null, brand.displayName || me.org.name), h('small', null, isClient ? 'Client login' : designMode ? 'Design on a lot' : 'Builder staff'))),
      findBtn, housesBtn, plansBtn, ...(designMode ? [fullBtn] : !isClient ? [designBtn] : []), statusLine, h('span', { class: 'pas-spacer' }), brand.colours?.primary ? h('span', { class: 'gi-powered' }, 'Powered by Glide Inside') : null, aiChip, userMenu].filter(Boolean)); // native append would print null
    paintAi();
  };
  function paintAi() {
    const r = credits?.remaining ?? 0;
    aiChip.textContent = `AI credits: ${r}`;
    aiChip.dataset.level = r <= 0 ? 'out' : r < 20 ? 'low' : '';
    aiChip.title = `${credits?.monthlyRemaining ?? 0} of ${credits?.monthlyCap ?? 0} monthly credits left, plus ${credits?.topUpBalance ?? 0} top-up credits`;
  }
  renderStrip();
  async function refreshCredits() {
    try { credits = await api.aiBalance(); premium?.setPortalEntitlement?.(entitlement()); paintAi(); } catch { /* signed out */ }
  }
  const timer = setInterval(refreshCredits, 20000);

  function menu(label, items) {
    const list = h('div', { class: 'pas-menu-list', hidden: true, role: 'menu' }, ...items.map(([t, fn]) => h('button', { type: 'button', role: 'menuitem', onclick: () => { list.hidden = true; fn(); } }, t)));
    const btn = h('button', { class: 'pas-btn', type: 'button', 'aria-haspopup': 'menu', 'aria-expanded': 'false', onclick: () => { list.hidden = !list.hidden; btn.setAttribute('aria-expanded', String(!list.hidden)); } }, label, ' ▾');
    document.addEventListener('click', (e) => { if (!list.hidden && !e.target.closest?.('.pas-menu')) list.hidden = true; });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') list.hidden = true; });
    return h('div', { class: 'pas-menu' }, btn, list);
  }

  // Modal and popover helpers ------------------------------------------------------------------------------------------------
  function modal(title, body, actions = []) {
    const close = () => scrim.remove();
    const scrim = h('div', { class: 'pas-modal-scrim', onclick: (e) => { if (e.target === scrim) close(); } },
      h('div', { class: 'pas-modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': title }, h('h2', null, title), body,
        h('div', { class: 'pas-row' }, ...actions.map((a) => h('button', { class: `pas-btn${a.primary ? ' pas-btn--primary' : ''}`, type: 'button', onclick: () => { a.fn?.(close); if (!a.keep) close(); } }, a.label)), h('button', { class: 'pas-btn', type: 'button', onclick: close }, 'Close'))));
    document.body.append(scrim);
    scrim.querySelector('input,button')?.focus();
    return { close };
  }

  // Find my block -------------------------------------------------------------------------------------------------------------
  function findMyBlock() {
    if (typeof globalThis.openSiteSearch === 'function') return globalThis.openSiteSearch();
    // The real Find my block (NSW and QLD cadastre). The sample lot stays as a fallback only if the dialog cannot load.
    return import('../ui/find-block.js').then((m) => m.openFindBlock(store, { onDone: onBlockFound })).catch(() => (CONFIG.portalMock ? sampleLotDialog() : toast('Could not open Find my block. Check your connection and try again.', { kind: 'error' })));
  }
  // The block was found: the strip follows it and the House designs picker opens (or says the library is empty).
  async function onBlockFound(found) {
    const sl = lotOf(store.project);
    const label = sl?.address || found?.address || found?.lotLabel || sl?.lotLabel || '';
    statusLine.textContent = label ? `Lot: ${label}` : '';
    if (sl) lotIsSample = false; // the found lot now stands in for the sample; the design carries it, so no portal lot is faked
    let count = null;
    try { count = (await loadDesigns()).length; } catch { /* the picker reports the error itself */ }
    if (count === 0) toast(EMPTY_LIBRARY, { kind: 'warn', timeout: 7000 });
    else openPicker();
  }
  function sampleLotDialog() {
    modal('Find my block', h('div', null,
      h('p', null, 'Searching for your block by address will be available here soon. Until then you can try the tool on a sample lot.'),
      h('p', null, h('small', null, `${SAMPLE_LOT.name}`))),
    [{ label: 'Use a sample lot', primary: true, fn: async () => { lot = { ...SAMPLE_LOT, address: me.lotAddress || '' }; lotIsSample = true; await refreshEnvelope(); statusLine.textContent = `Lot: ${SAMPLE_LOT.name}`; toast('Sample lot ready. Choose a house design to see which ones fit.', { kind: 'ok' }); } }]);
  }
  app.portal = {
    async setLot(next) { lot = { ...next }; lotIsSample = false; await refreshEnvelope(); paintLot(); },
    getLot: () => ({ address: lot?.address || '', lot: lot?.lot || '', dp: lot?.dp || '', lga: lot?.lga || '', zone: lot?.zone || '' }),
    me, refreshCredits,
  };
  // The strip text always follows the lot on the open design (Find my block), else the portal lot, else says so.
  function paintLot() {
    if (reviewOwner) return;
    const sl = lotOf(store.project);
    const label = sl ? (sl.address || sl.lotLabel || '') : (lot?.address || '');
    statusLine.textContent = label ? `Lot: ${label}` : lotIsSample && lot ? SAMPLE_LOT.name : 'No block yet';
  }
  paintLot();
  store.on?.('project', paintLot);

  // House designs -------------------------------------------------------------------------------------------------------------
  async function loadDesigns() {
    const [mine, glide] = await Promise.all([api.listHouses(), (wantsGlide(me, params) ? api.listGlideLibrary().catch(() => []) : Promise.resolve([]))]);
    const full = async (list, getter, group) => Promise.all(list.map(async (x) => {
      const r = await getter(x.id);
      return { id: x.id, name: x.name, group, project: r.project, meta: x, source: group === 'glide' ? 'glide' : 'house' };
    }));
    return [...(await full(mine, (id) => api.getHouse(id), 'builder')), ...(await full(glide, (id) => api.getGlideModel(id), 'glide'))];
  }
  // The lot card carousel: the builder's own library ranked by fit on the client's lot (never other builders' designs).
  app.lotDesigns = async (project) => {
    const all = await loadDesigns();
    return builderDesigns(project || store.project, all, { allowGlide: !clientLike });
  };
  async function openPicker() {
    const list = h('div', { class: 'pas-list' }, h('p', { class: 'pas-empty' }, 'Loading designs...'));
    // A client with no block yet is asked to find it first: designs are never ranked against a sample lot.
    const noLot = clientLike && !lotOf(store.project) && !envelope;
    const m = modal('House designs', h('div', null, noLot ? null : h('p', null, envelopeNow() ? `Ranked for ${lotOf(store.project)?.address || (lotIsSample ? SAMPLE_LOT.name : lot.address) || 'your lot'}. Designs that do not fit can still be placed.` : lotOf(store.project) ? 'Setbacks are not available for this lot, so designs are not ranked. Check with council.' : 'Find your block to see which designs fit.'), list), []);
    let designs;
    try { designs = await loadDesigns(); } catch (e) { list.replaceChildren(h('p', { class: 'pas-empty' }, e.message || 'Could not load designs.')); return; }
    if (!designs.length) {
      list.replaceChildren(designMode
        ? h('p', { class: 'pas-empty' }, h('a', { href: portalUrl('#/houses'), target: '_blank', rel: 'noopener' }, 'Add a house in the Houses tab'), '.')
        : h('p', { class: 'pas-empty' }, EMPTY_LIBRARY));
      return;
    }
    if (noLot) {
      list.replaceChildren(h('div', { class: 'pas-findfirst' },
        h('p', { class: 'pas-empty' }, h('strong', null, 'Find your block first'), ' so the designs can be checked against your lot and setbacks.'),
        h('button', { class: 'pas-btn pas-btn--primary', type: 'button', onclick: () => { m.close(); findMyBlock(); } }, 'Find my block')));
      return;
    }
    // The builder's own designs first, then the Glide Inside library; within each, best fit first.
    const byGroup = (g) => (envelopeNow() ? rankDesigns(designs.filter((d) => d.group === g), envelopeNow()) : designs.filter((d) => d.group === g).map((d) => ({ ...d, fit: null })));
    const ranked = [...byGroup('builder'), ...byGroup('glide')];
    clear(list);
    let lastGroup = null;
    for (const d of ranked) {
      if (d.group !== lastGroup) { list.append(h('div', { class: 'pas-group' }, d.group === 'glide' ? 'Glide Inside library' : `${brand.displayName || me.org.name} designs`)); lastGroup = d.group; }
      const svg = (() => { try { return svgDataUri(projectToSvg(d.project)); } catch { return ''; } })();
      list.append(h('button', { class: 'pas-item', type: 'button', onclick: () => { m.close(); choose(d); } },
        svg ? h('img', { src: svg, alt: '' }) : null,
        h('span', null, h('strong', null, d.name),
          h('small', null, d.fit?.badge ? h('span', { class: 'pas-badge', 'data-fit': d.fit.status }, d.fit.badge) : null, d.fit?.reason || '', d.fit?.reason ? '' : ''))));
    }
  }
  // The envelope that applies now: the lot on the design (Find my block) when it carries one, else the portal lot.
  const envelopeNow = () => {
    const sl = lotOf(store.project);
    if (sl) return sl.envelope?.length >= 3 ? sl.envelope : null; // a found lot is never ranked against the sample lot
    return envelope;
  };
  function choose(d) {
    const house = structuredClone(d.project);
    house.name = d.name;
    const fit = d.fit;
    // A builder lot (no Find my block) becomes the design's lot, so the road, setbacks, clearances and driveway draw under the house.
    if (!lotOf(store.project) && !lotIsSample && lot?.polygonMm && envelope) {
      store.apply('Set lot', (p) => { p.site.lot = portalLotToSiteLot(lot, envelope); p.site.northDeg = 0; });
      editor.zoomToFit?.();
    }
    const base = defaultPose(store.project, house);
    // Rank first, then fine tune: garage to the street where the house fits that way, else the ranking's own pose.
    const auto = lotOf(store.project) ? autoPose(store.project, house) : null;
    const rankPose = fit?.pose && fit.status !== 'too-big' ? { x: fit.pose.x, y: fit.pose.y, rotation: fit.rotationDeg || 0, mirrored: !!fit.mirrored } : null;
    let initialPose = null;
    if (auto?.pose && auto.fits !== false) initialPose = auto.pose;
    else if (rankPose) initialPose = { ...base, ...rankPose };
    else if (auto?.pose) initialPose = auto.pose;
    const env = envelopeNow();
    const sl0 = lotOf(store.project);
    const hull = sl0?.boundary?.length >= 3 ? orientedBox(sl0.boundary) : null;
    const lotBox = hull ? { widthMm: hull.w, depthMm: hull.d } : env ? { widthMm: Math.max(...env.map((p) => p.x)) - Math.min(...env.map((p) => p.x)), depthMm: Math.max(...env.map((p) => p.y)) - Math.min(...env.map((p) => p.y)) } : null;
    startPlacement({
      store, editor, house, lot: lotBox, initialPose, fit, design: { id: d.id, name: d.name },
      onDone: () => { store.setUI({ placedDesign: { id: d.id, name: d.name } }); toast(`${d.name} placed. Every wall, room and opening is editable.`, { kind: 'ok' }); },
    });
  }

  // Projects ----------------------------------------------------------------------------------------------------------------------
  async function saveProject() {
    try {
      const saved = await api.saveProject({ id: currentProjectId || undefined, name: store.project.name, project: store.project, lotAddress: lotOf(store.project)?.address || lot?.address || '' });
      currentProjectId = saved.id;
      toast(reviewOwner ? `Saved to ${reviewOwner}'s project. It is recorded as edited by staff.` : 'Project saved to your account.', { kind: 'ok' });
    } catch (e) { toast(e.message || 'Could not save.', { kind: 'error' }); }
  }
  async function saveToLibrary() {
    try {
      await api.saveHouse({ name: store.project.name || 'Untitled house', project: store.project });
      toast('Saved to the house library.', { kind: 'ok' });
    } catch (e) { toast(e.message || 'Could not save.', { kind: 'error' }); }
  }
  async function projectsDialog() {
    const body = h('div', { class: 'pas-list' }, h('p', { class: 'pas-empty' }, 'Loading...'));
    const m = modal('My projects', body);
    const list = await api.listProjects().catch(() => []);
    clear(body);
    if (!list.length) body.append(h('p', { class: 'pas-empty' }, 'No saved projects yet. Use Save project in the menu.'));
    for (const p of list) body.append(h('button', { class: 'pas-item', type: 'button', onclick: () => { m.close(); openProject(p.id); } }, h('span', null, h('strong', null, p.name), h('small', null, !isClient && p.ownerId && p.ownerId !== me.user.id ? `Client: ${p.ownerName}${p.editedByStaff ? ' (edited by staff)' : ''}` : ''))));
  }
  async function openProject(id) {
    try {
      const p = await api.openProject(id);
      app.replaceProject(p.project);
      currentProjectId = p.id;
      reviewOwner = !isClient && p.ownerId && p.ownerId !== me.user.id ? p.ownerName || 'the client' : null;
      if (p.lotAddress) { lot = { ...(lot || {}), address: p.lotAddress }; lotIsSample = false; }
      statusLine.textContent = `${reviewOwner ? `Client view of ${reviewOwner}'s project. ` : ''}${p.lotAddress ? `Lot: ${p.lotAddress}` : ''}`;
    } catch (e) { toast(e.message || 'Could not open that project.', { kind: 'error' }); }
  }

  // AI credits ----------------------------------------------------------------------------------------------------------------------
  function aiDialog() {
    const note = h('p', null, `${credits.monthlyRemaining} of ${credits.monthlyCap} monthly credits left, plus ${credits.topUpBalance} top-up credits. Monthly credits reset on the 1st; the AI helper stops at zero.`);
    const actions = me.canTopUp ? [{ label: 'Top up 300 credits, A$10 incl. GST', primary: true, keep: true, fn: async (close) => { try { await api.aiTopUp(); await refreshCredits(); toast(`Added 300 credits. ${isClient ? 'Charged to your builder.' : 'Charged on your end of month invoice.'}`, { kind: 'ok' }); close(); } catch (e) { toast(e.message, { kind: 'error' }); } } }] : [];
    modal('AI credits', h('div', null, note, me.canTopUp ? h('p', null, 'Top-ups are added at once and billed on the builder end of month invoice.') : h('p', null, 'Your builder has turned off top-ups.')), actions);
  }

  async function signOut() {
    clearInterval(timer);
    clearBrandTheme();
    try { await api.signOut(); } catch { /* already signed out */ }
    try { localStorage.removeItem(AUTOSAVE()); localStorage.removeItem(LOGO_KEY); localStorage.removeItem(OWNER_KEY); } catch { /* ignore */ }
    loc.href = signInUrl();
  }

  // Deep links ----------------------------------------------------------------------------------------------------------------------
  try {
    if (params.get('project')) await openProject(params.get('project'));
    else if (params.get('house')) { const r = await api.getHouse(params.get('house')); app.replaceProject(r.project); }
    else if (params.get('glide') && wantsGlide(me, params)) { const r = await api.getGlideModel(params.get('glide')); app.replaceProject(r.project); }
  } catch (e) { toast(e.message || 'Could not open that design.', { kind: 'error' }); }
  return { strip, openPicker, refreshCredits };
}
