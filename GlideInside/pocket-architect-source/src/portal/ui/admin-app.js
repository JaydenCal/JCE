// The owner's private admin page (/portal/admin/, not linked from the site, noindex). Protected by ADMIN_TOKEN, entered once and
// kept in sessionStorage for the tab. Lists trial requests and builder orgs; approving creates the org and its first admin login,
// shown once with Copy so the owner can pass it on himself. Nothing is emailed to the builder from here.

import { h, clear, openDialog, confirmDialog, field, busy, toast, chip, icon, errorMessage } from './kit.js';
import { credentialsCard } from './credentials-card.js';
import { createAdminApi } from '../admin-api.js';
import { ddmmyyyy, formatAud } from '../billing.js';

const KEY = 'gi.admin.token';
const store = {
  get() { try { return sessionStorage.getItem(KEY) || ''; } catch { return ''; } },
  set(v) { try { sessionStorage.setItem(KEY, v); } catch { /* private window: the token is just kept in memory */ } },
  clear() { try { sessionStorage.removeItem(KEY); } catch { /* nothing to clear */ } },
};

const STATUS_CHIP = { trial: ['Trial', 'warn'], trial_ended: ['Trial ended', 'warn'], active: ['Active', 'ok'], read_only: ['Read only', 'warn'] };

export function mountAdmin(root, { createApi = createAdminApi } = {}) {
  let api = null;
  let requests = [];
  let orgs = [];
  let filter = 'pending';

  function gate(message = '') {
    clear(root);
    const input = h('input', { type: 'password', name: 'token', autocomplete: 'off', required: true, 'aria-label': 'Admin token' });
    const err = h('p', { class: 'pp-error', role: 'alert', hidden: !message }, message);
    const form = h('form', { class: 'pp-form', novalidate: true, onsubmit: async (e) => {
      e.preventDefault();
      const token = input.value.trim();
      if (!token) return;
      const next = createApi({ token });
      try {
        await next.listRequests();
      } catch (ex) {
        err.textContent = ex?.status === 401 ? 'That token was not accepted.' : errorMessage(ex);
        err.hidden = false;
        return;
      }
      api = next;
      store.set(token);
      start();
    } },
    field('Admin token', () => input, { required: true, hint: 'The ADMIN_TOKEN secret. It is kept for this browser tab only.' }), err,
    h('button', { class: 'pp-btn pp-btn--primary', type: 'submit' }, 'Open admin'));
    root.append(h('section', { class: 'pp-auth' }, h('div', { class: 'pp-auth-card' }, h('h1', null, 'Glide Inside admin'), h('p', { class: 'pp-lead pp-lead--sm' }, 'Trial requests and builder accounts.'), form)));
    input.focus();
  }

  async function load() {
    [requests, orgs] = await Promise.all([api.listRequests(), api.listOrgs()]);
  }
  async function reload() {
    try {
      await load();
      paint();
    } catch (e) {
      if (e?.status === 401) return signOut('Your token was not accepted. Enter it again.');
      toast(errorMessage(e), { kind: 'error' });
    }
  }
  function signOut(message = '') {
    store.clear();
    api = null;
    gate(message);
  }
  async function start() {
    try {
      await load();
    } catch (e) {
      return signOut(e?.status === 401 ? 'Your token was not accepted. Enter it again.' : errorMessage(e));
    }
    paint();
  }

  const td = (label, ...kids) => h('td', { dataset: { label } }, ...kids);
  const when = (iso) => (iso ? ddmmyyyy(iso) : '');

  function showCredentials(title, who, r) {
    openDialog({
      title, size: 'md',
      body: h('div', null, credentialsCard({ username: r.credentials.username, password: r.credentials.password, who, signInUrl: r.signInUrl || new URL('../', location.href).href, expiryDays: 7 }),
        h('p', { class: 'pp-notice pp-notice--quiet' }, icon('info', 18), 'Nothing has been sent to the builder. Pass these details on yourself.')),
      footer: (d) => h('button', { class: 'pp-btn pp-btn--primary', type: 'button', onclick: () => d.close() }, 'Done'),
    });
  }

  async function approve(q, btn) {
    const ok = await confirmDialog({ title: `Approve ${q.companyLegalName}?`, confirmLabel: 'Approve and create account',
      message: `This creates the builder account and a first admin login for ${q.firstName} ${q.lastName}, with a free 14 day trial starting today. The login is shown once so you can pass it on yourself. No email is sent to the builder.` });
    if (!ok) return;
    await busy(btn, async () => {
      const r = await api.approve(q.id);
      await reload();
      showCredentials(`Account for ${q.companyLegalName}`, `${q.firstName} ${q.lastName}`, r);
    });
  }
  function decline(q) {
    const note = h('textarea', { rows: '3', maxlength: '500', 'aria-label': 'Note' });
    openDialog({
      title: `Decline ${q.companyLegalName}?`,
      body: h('div', { class: 'pp-form' }, h('p', null, 'The builder is not told by this page. Keep a short note for your own records.'), field('Note', () => note, { hint: 'For example: not building in our regions.' })),
      footer: (d) => [h('button', { class: 'pp-btn', type: 'button', onclick: () => d.close() }, 'Cancel'), h('button', { class: 'pp-btn pp-btn--danger', type: 'button', onclick: (e) => busy(e.currentTarget, async () => { await api.decline(q.id, note.value); d.close(); toast('Declined.', { kind: 'ok' }); await reload(); }) }, 'Decline request')],
    });
  }

  function requestCard(q) {
    const line = (k, v) => (v ? h('div', { class: 'pp-adm-kv' }, h('span', null, k), h('strong', null, v)) : null);
    const actions = q.status === 'pending'
      ? h('div', { class: 'pp-actions pp-actions--tight' }, h('button', { class: 'pp-btn pp-btn--primary pp-btn--sm', type: 'button', onclick: (e) => approve(q, e.currentTarget) }, icon('check', 15), 'Approve'), h('button', { class: 'pp-btn pp-btn--sm', type: 'button', onclick: () => decline(q) }, 'Decline'))
      : h('p', { class: 'pp-sub' }, q.status === 'approved' ? `Approved ${when(q.decidedAt)}` : `Declined ${when(q.decidedAt)}${q.decisionNote ? `: ${q.decisionNote}` : ''}`);
    return h('article', { class: 'pp-card pp-adm-req', dataset: { id: q.id } },
      h('div', { class: 'pp-card-head' }, h('h3', null, q.companyLegalName), h('span', { class: 'pp-sub' }, `Received ${when(q.createdAt)}`)),
      h('div', { class: 'pp-adm-grid' },
        line('ABN', q.abn), line('Trading name', q.tradingName), line('Contact', `${q.firstName} ${q.lastName}`), line('Email', q.email), line('Mobile', q.mobile), line('Region', q.region),
        line('Homes per year', q.homesPerYear != null ? String(q.homesPerYear) : ''), line('Heard about us', q.howHeard), line('Trial terms', q.termsVersion ? `Accepted ${when(q.consentAt)} (version ${q.termsVersion})` : '')),
      actions);
  }

  async function extend(o, btn) {
    await busy(btn, async () => {
      await api.extendTrial(o.id);
      toast(`Trial extended by 7 days for ${o.name}.`, { kind: 'ok' });
      await reload();
    });
  }
  async function convert(o, btn) {
    const ok = await confirmDialog({ title: `Convert ${o.name} to paid?`, confirmLabel: 'Convert to paid',
      message: 'Client logins unlock and normal pricing applies from now. Use this for a builder who pays you another way. A builder who adds a card converts automatically.' });
    if (!ok) return;
    await busy(btn, async () => {
      await api.convert(o.id);
      toast(`${o.name} is now on a paid account.`, { kind: 'ok' });
      await reload();
    });
  }
  async function resetAdmin(o, btn) {
    const ok = await confirmDialog({ title: `New password for ${o.admin?.name || 'the admin'}?`, confirmLabel: 'Generate new password', message: 'The old password stops working. The new one is shown once so you can pass it on. No email is sent.' });
    if (!ok) return;
    await busy(btn, async () => {
      const r = await api.resetAdmin(o.id);
      showCredentials(`New password for ${o.name}`, r.admin.name, { ...r, signInUrl: new URL('../', location.href).href });
    });
  }

  function orgRow(o) {
    const [label, kind] = STATUS_CHIP[o.account.status] || [o.account.status, 'muted'];
    const last = o.invoices[0];
    const owed = o.invoices.filter((i) => i.status !== 'paid' && i.status !== 'void').reduce((s, i) => s + i.totalCents, 0);
    return h('tr', { dataset: { id: o.id } },
      td('Builder', h('strong', null, o.name), h('div', { class: 'pp-sub' }, o.legalName ? `${o.legalName}${o.abn ? `, ABN ${o.abn}` : ''}` : ''), o.admin ? h('div', { class: 'pp-sub' }, `${o.admin.name} (${o.admin.username})${o.admin.mustChangePassword ? ', has not signed in' : ''}`) : null),
      td('Status', chip(label, kind), o.account.status === 'trial' ? h('div', { class: 'pp-sub' }, `${o.account.daysLeft} ${o.account.daysLeft === 1 ? 'day' : 'days'} left, ends ${o.account.lastTrialDay}`) : null,
        o.account.status === 'trial_ended' ? h('div', { class: 'pp-sub' }, `Ended ${when(o.account.trialEndsAt)}. Data kept until ${when(o.account.dataKeptUntil)}`) : null,
        o.account.card ? h('div', { class: 'pp-sub' }, `Card: ${o.account.card.brand} ending ${o.account.card.last4}`) : o.convertedHow === 'manual' ? h('div', { class: 'pp-sub' }, 'Converted manually') : null,
        o.trialExtendedDays ? h('div', { class: 'pp-sub' }, `Extended ${o.trialExtendedDays} days`) : null),
      td('Client logins', h('strong', null, String(o.clientLogins.issued)), h('div', { class: 'pp-sub' }, `${o.clientLogins.generated} generated`)),
      td('AI this month', `${o.ai.creditsUsed} credits used`, h('div', { class: 'pp-sub' }, `${o.ai.topUps} ${o.ai.topUps === 1 ? 'top-up' : 'top-ups'}`)),
      td('Invoices', o.invoices.length ? `${o.invoices.length}, last ${last.number} ${last.status}` : 'None', owed ? h('div', { class: 'pp-sub' }, `${formatAud(owed)} open`) : null, last?.error ? h('div', { class: 'pp-sub pp-adm-err' }, last.error) : null),
      td('Actions', h('div', { class: 'pp-actions pp-actions--tight' },
        o.account.status !== 'active' ? h('button', { class: 'pp-btn pp-btn--sm', type: 'button', onclick: (e) => extend(o, e.currentTarget) }, 'Extend 7 days') : null,
        o.account.status !== 'active' ? h('button', { class: 'pp-btn pp-btn--sm', type: 'button', onclick: (e) => convert(o, e.currentTarget) }, 'Convert to paid') : null,
        h('button', { class: 'pp-btn pp-btn--sm', type: 'button', onclick: (e) => resetAdmin(o, e.currentTarget) }, icon('key', 14), 'New admin password'))));
  }

  function paint() {
    clear(root);
    const count = (s) => requests.filter((r) => r.status === s).length;
    const shown = requests.filter((r) => r.status === filter);
    const tabs = h('div', { class: 'pp-tabs', role: 'tablist', 'aria-label': 'Trial requests' }, ...['pending', 'approved', 'declined'].map((s) => h('button', { class: 'pp-tab', role: 'tab', type: 'button', 'aria-selected': String(filter === s), dataset: { tab: s }, onclick: () => { filter = s; paint(); } }, `${s.charAt(0).toUpperCase()}${s.slice(1)} (${count(s)})`)));
    const orgTable = orgs.length
      ? h('div', { class: 'pp-table-wrap' }, h('table', { class: 'pp-table pp-table--stack' }, h('thead', null, h('tr', null, ...['Builder', 'Status', 'Client logins issued', 'AI use', 'Invoices', 'Actions'].map((t) => h('th', { scope: 'col' }, t)))), h('tbody', null, ...orgs.map(orgRow))))
      : h('p', { class: 'pp-empty' }, 'No builder accounts yet.');
    root.append(h('div', { class: 'pp-brandbar' }, h('div', { class: 'pp-brand' }, h('div', null, h('strong', null, 'Glide Inside admin'), h('small', null, 'Trial requests and builder accounts'))), h('div', { class: 'pp-who' }, h('button', { class: 'pp-btn pp-btn--sm', type: 'button', onclick: () => reload() }, 'Refresh'), h('button', { class: 'pp-btn pp-btn--sm', type: 'button', onclick: () => signOut() }, icon('logout', 15), 'Lock'))),
      h('main', { class: 'pp-main' },
        h('div', { class: 'pp-head' }, h('div', null, h('h2', null, 'Trial requests'), h('p', { class: 'pp-lead pp-lead--sm' }, 'Each request waits for your approval. Approving creates the account; nothing is emailed to the builder.'))),
        tabs,
        h('div', { class: 'pp-adm-list' }, ...(shown.length ? shown.map(requestCard) : [h('p', { class: 'pp-empty' }, `No ${filter} requests.`)])),
        h('div', { class: 'pp-head', style: { marginTop: '32px' } }, h('div', null, h('h2', null, 'Builder accounts'), h('p', { class: 'pp-lead pp-lead--sm' }, 'Trial, trial ended, active and read only.'))),
        orgTable));
  }

  const saved = store.get();
  if (saved) {
    api = createApi({ token: saved });
    start();
  } else gate();
  return { reload };
}
