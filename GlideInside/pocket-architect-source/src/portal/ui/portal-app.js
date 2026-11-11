// The portal page: sign in, forced password change, builder dashboard, client home. One module, hash routes for the tabs.

import { h, clear, toast, icon, errorMessage } from './kit.js';
import { getPortalApi } from '../api.js';
import { appLink } from '../links.js';
import { signInView, forgotView, resetView, changePasswordView } from './auth-views.js';
import { renderHouses } from './houses-tab.js';
import { renderGlide } from './glide-tab.js';
import { renderClients } from './clients-tab.js';
import { renderBilling } from './billing-tab.js';
import { renderTeam } from './team-tab.js';
import { renderBranding } from './branding-tab.js';
import { ddmmyyyy } from '../billing.js';
import { trialBanner, handleBillingReturn } from './trial-ui.js';
import { CONFIG } from '../../config.js';

const TABS = [
  { id: 'houses', label: 'House designs', render: renderHouses },
  { id: 'glide', label: 'Glide Inside library', render: renderGlide },
  { id: 'clients', label: 'Clients', render: renderClients, perm: 'clients.read' },
  { id: 'billing', label: 'Billing', render: renderBilling, perm: 'billing.read' },
  { id: 'team', label: 'Team', render: renderTeam, perm: 'clients.read' },
  { id: 'branding', label: 'Branding', render: renderBranding },
];

export function mountPortal(root, { api = getPortalApi() } = {}) {
  const params = new URLSearchParams(location.search);
  let me = null;

  // Launch gating: builder features stay closed until CONFIG.portalEnabled (or GI_CONFIG.portalEnabled) is true.
  if (!CONFIG.portalEnabled) {
    clear(root);
    root.append(h('section', { class: 'pp-card', style: { maxWidth: '520px', margin: '48px auto' } }, h('h2', null, 'Builder and client logins are not open yet'), h('p', null, 'Glide Inside accounts for builders and their clients are coming soon. Pocket Architect is still free to use without a login.')));
    return;
  }

  const setView = (node) => { clear(root); root.append(node); document.title = `${node.dataset?.title || 'Portal'} | Glide Inside`; };
  const toSignIn = () => { history.replaceState(null, '', location.pathname + (params.get('client') ? '?client=1' : '')); setView(signInView({ api, client: !!params.get('client'), onSignedIn: start, goForgot: () => setView(forgotView({ api, goBack: toSignIn, goReset: (t) => setView(resetView({ api, token: t, goBack: toSignIn })) })) })); };

  async function signOut() {
    await api.signOut();
    me = null;
    toSignIn();
  }

  async function start(next) {
    me = next === undefined ? await api.me() : next;
    if (!me) return toSignIn();
    if (me.user.mustChangePassword) return setView(changePasswordView({ api, me, onDone: start, onSignOut: signOut }));
    if (me.user.role === 'client') return setView(clientHome());
    setView(dashboard());
  }

  const brandBar = (right) => h('div', { class: 'pp-brandbar' },
    h('div', { class: 'pp-brand' }, me.org.branding.logoDataUrl ? h('img', { src: me.org.branding.logoDataUrl, alt: '', class: 'pp-brand-logo' }) : null, h('div', null, h('strong', null, me.org.branding.displayName), h('small', null, me.user.role === 'client' ? 'Client area' : 'Builder dashboard'))),
    h('div', { class: 'pp-who' }, h('span', null, icon('user', 16), `${me.user.name} (${me.user.role})`), right, h('button', { class: 'pp-btn pp-btn--sm', type: 'button', onclick: signOut }, icon('logout', 15), 'Sign out')));

  // Client home: normally a client goes straight into the app; this page lists their projects and links in.
  function clientHome() {
    const list = h('ul', { class: 'pp-list' });
    api.listProjects().then((ps) => list.replaceChildren(...(ps.length ? ps.map((p) => h('li', null, h('div', null, h('strong', null, p.name), h('div', { class: 'pp-sub' }, `${p.lotAddress || 'No lot address'} · updated ${ddmmyyyy(p.updatedAt)}`)), h('a', { class: 'pp-btn pp-btn--sm', href: appLink({ project: p.id }) }, 'Open'))) : [h('li', { class: 'pp-empty' }, 'No saved projects yet. Open Pocket Architect to start your first.')]))).catch((e) => toast(errorMessage(e), { kind: 'error' }));
    const ai = me.ai;
    return h('div', { dataset: { title: 'My designs' } }, brandBar(), h('main', { class: 'pp-main pp-main--narrow' },
      h('h1', null, `Welcome, ${me.user.name}`),
      h('p', { class: 'pp-lead' }, `${me.org.branding.displayName} has set you up with Pocket Architect. Find your block, place one of their house designs on it and produce plans, with no charge to you.`),
      h('p', null, h('a', { class: 'pp-btn pp-btn--primary pp-btn--lg', href: appLink({ signin: 1 }) }, 'Open Pocket Architect')),
      h('section', { class: 'pp-card' }, h('h2', null, 'My projects'), list),
      h('section', { class: 'pp-card' }, h('h2', null, 'AI helper'), h('p', null, `${ai.remaining} credits left this month (${ai.used} of ${ai.monthlyCap} used${ai.topUpBalance ? `, plus ${ai.topUpBalance} top-up` : ''}).`))));
  }

  function dashboard() {
    const tabs = TABS.filter((t) => !t.perm || me.permissions.includes(t.perm));
    const panel = h('div', { class: 'pp-panel', id: 'pp-panel', role: 'tabpanel', tabindex: '-1' });
    const tablist = h('div', { class: 'pp-tabs', role: 'tablist', 'aria-label': 'Dashboard sections' });
    let current = null;
    let token = 0;

    const bannerSlot = h('div', { id: 'trial-slot' });
    const goBilling = () => { location.hash = '/billing'; };
    function paintBanner() {
      bannerSlot.replaceChildren(...[trialBanner(me, api, { goBilling })].filter(Boolean));
    }
    async function refreshMe() {
      me = await api.me();
      paintBanner();
    }
    async function show(id, { focus = false } = {}) {
      const tab = tabs.find((t) => t.id === id) || tabs[0];
      current = tab.id;
      const mine = ++token;
      for (const b of tablist.children) {
        const on = b.dataset.tab === tab.id;
        b.setAttribute('aria-selected', String(on));
        b.tabIndex = on ? 0 : -1;
      }
      panel.setAttribute('aria-labelledby', `tab-${tab.id}`);
      clear(panel);
      panel.append(h('p', { class: 'pp-sub', role: 'status' }, 'Loading'));
      const inner = h('div');
      try {
        await tab.render(inner, { api, me, refreshMe, refreshBilling: () => {}, goBilling });
      } catch (e) {
        if (e?.code === 'UNAUTHORISED') return signOut();
        inner.replaceChildren(h('p', { class: 'pp-error', role: 'alert' }, errorMessage(e)));
      }
      if (mine !== token) return;
      clear(panel);
      panel.append(inner);
      if (focus) panel.focus();
    }
    for (const t of tabs) {
      tablist.append(h('button', { class: 'pp-tab', role: 'tab', type: 'button', id: `tab-${t.id}`, 'aria-controls': 'pp-panel', dataset: { tab: t.id }, onclick: () => { location.hash = `/${t.id}`; } }, t.label));
    }
    tablist.addEventListener('keydown', (e) => {
      const btns = [...tablist.children];
      const i = btns.indexOf(document.activeElement);
      if (i < 0) return;
      const to = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: btns.length - 1 }[e.key];
      if (to === undefined) return;
      e.preventDefault();
      const b = btns[(to + btns.length) % btns.length];
      b.focus();
      location.hash = `/${b.dataset.tab}`;
    });
    const route = () => show((location.hash.match(/^#\/(\w+)/) || [])[1] || 'houses');
    window.addEventListener('hashchange', route);
    paintBanner();
    queueMicrotask(async () => {
      if (new URLSearchParams(location.search).get('billing')) {
        if (!location.hash.startsWith('#/billing')) location.hash = '/billing';
        await handleBillingReturn(api, refreshMe);
      }
      route();
    });
    return h('div', { dataset: { title: 'Dashboard' } }, brandBar(h('a', { class: 'pp-btn pp-btn--sm', href: appLink(), target: '_blank', rel: 'noopener' }, icon('open', 15), 'Open Pocket Architect')),
      h('main', { class: 'pp-main' }, bannerSlot, tablist, panel));
  }

  // Reset links: portal/#reset=<token>
  const reset = location.hash.match(/^#reset=([0-9a-f]+)$/);
  if (reset) setView(resetView({ api, token: reset[1], goBack: toSignIn }));
  else start();
  return { start, signOut };
}
