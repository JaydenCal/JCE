// The owner's private admin page (/portal/admin/, not linked from the site, noindex). Protected by ADMIN_TOKEN, entered once and
// kept in sessionStorage for the tab. Lists trial requests and builder orgs; approving creates the org and its first admin login,
// shown once with Copy so the owner can pass it on himself. Nothing is emailed to the builder from here.

import { h, clear, openDialog, confirmDialog, field, busy, toast, chip, icon, errorMessage, downloadText } from './kit.js';
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
  let trial = null; // the shared commercial trial login, or null
  let usage = null; // commercial AI usage and cost
  let termsStats = null; // plan set terms acceptances per version
  let contacts = null; // free profile contacts: { contacts, total, matching, marketable }
  const contactFilters = { consent: '', type: '', from: '', to: '', designs: '', mode: '', suburb: '' };

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
    // The commercial sections are extras: a failure there must not lock the owner out of trial requests.
    [trial, usage, termsStats, contacts] = await Promise.all([api.commercialTrial?.().catch(() => null) ?? null, api.commercialUsage?.().catch(() => null) ?? null, api.termsCounts?.().catch(() => null) ?? null, api.profileContacts?.(contactFilters).catch(() => null) ?? null]);
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
        line('ABN', q.abn || 'ABN needed before billing'), line('Trading name', q.tradingName), line('Contact', `${q.firstName} ${q.lastName}`.trim()), line('Email', q.email), line('Phone', q.mobile), line('Region', q.region),
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
  async function setRate(o) {
    const input = h('input', { type: 'number', min: '1', max: '1000', step: '0.01', 'aria-label': 'Price per client login in dollars including GST', value: o.loginPricing?.customRateCents ? String(o.loginPricing.customRateCents / 100) : '' });
    openDialog({
      title: `Client login price for ${o.name}`,
      body: h('div', { class: 'pp-form' },
        h('p', null, 'Standard pricing: logins 1 to 15 in a month are A$30 each incl. GST, logins 16 to 50 are A$25 each, above 50 is set here. A custom price applies to every login that first signs in this month, including ones already charged.'),
        field('Price per client login (A$ incl. GST)', () => input, { hint: 'Leave empty and press Clear to go back to the standard pricing.' })),
      footer: (d) => [
        h('button', { class: 'pp-btn', type: 'button', onclick: () => d.close() }, 'Cancel'),
        h('button', { class: 'pp-btn', type: 'button', onclick: (e) => busy(e.currentTarget, async () => { await api.setLoginRate(o.id, null); d.close(); toast('Custom rate cleared.', { kind: 'ok' }); await reload(); }) }, 'Clear custom rate'),
        h('button', { class: 'pp-btn pp-btn--primary', type: 'button', onclick: (e) => busy(e.currentTarget, async () => {
          const cents = Math.round(Number(input.value) * 100);
          if (!Number.isFinite(cents) || cents < 100) { toast('Enter a price of A$1 or more.', { kind: 'error' }); return; }
          await api.setLoginRate(o.id, cents); d.close(); toast(`Custom rate set to ${formatAud(cents)} per login.`, { kind: 'ok' }); await reload();
        }) }, 'Save custom rate')],
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

  async function toggleInternal(o, btn) {
    const next = !o.internal;
    const ok = await confirmDialog({ title: next ? `Mark ${o.name} as internal?` : `Make ${o.name} an ordinary account?`, confirmLabel: next ? 'Mark internal' : 'Make ordinary',
      message: next ? 'No charges are ever raised for an internal test account. It has no trial and no pause, it is left out of usage, revenue and trial reporting, and it can browse every builder\'s designs read only.' : 'The account goes back to its stored trial or paid state and is included in reporting and billing again.' });
    if (!ok) return;
    await busy(btn, async () => {
      await api.setInternal(o.id, next);
      toast(next ? `${o.name} is now an internal test account.` : `${o.name} is an ordinary account again.`, { kind: 'ok' });
      await reload();
    });
  }
  function openInternalForm() {
    const orgName = h('input', { type: 'text', name: 'orgName', autocomplete: 'off', maxlength: '120', value: 'Glide Inside Internal Test', 'aria-label': 'Organisation name' });
    const user = h('input', { type: 'text', name: 'username', autocomplete: 'off', spellcheck: 'false', required: true, 'aria-label': 'Builder admin username' });
    const pass = h('input', { type: 'password', name: 'password', autocomplete: 'new-password', required: true, 'aria-label': 'Builder admin password' });
    const err = h('p', { class: 'pp-error', role: 'alert', hidden: true });
    openDialog({
      title: 'Create internal test account', size: 'md',
      body: h('div', { class: 'pp-form' },
        h('p', null, 'An internal test account is never charged, has no trial, and is left out of usage, revenue and trial reporting. Its logins can browse every builder\'s designs read only. You choose the username and password here. The password is stored hashed and is never shown again, so keep a note of it yourself.'),
        field('Organisation name', () => orgName, { hint: 'Shown to the account only.' }),
        field('Builder admin username', () => user, { required: true, hint: 'Letters, numbers, dot, dash or underscore, 3 to 40 characters.' }),
        field('Builder admin password', () => pass, { required: true, hint: 'At least 10 characters.' }),
        err),
      footer: (d) => [h('button', { class: 'pp-btn', type: 'button', onclick: () => d.close() }, 'Cancel'),
        h('button', { class: 'pp-btn pp-btn--primary', type: 'button', onclick: (e) => busy(e.currentTarget, async () => {
          try {
            await api.createInternal({ orgName: orgName.value.trim(), username: user.value.trim(), password: pass.value });
            pass.value = '';
            d.close();
            toast('Internal test account created.', { kind: 'ok' });
            await reload();
          } catch (ex) {
            err.textContent = errorMessage(ex);
            err.hidden = false;
          }
        }) }, 'Create account')],
    });
  }
  function orgRow(o) {
    const [label, kind] = STATUS_CHIP[o.account.status] || [o.account.status, 'muted'];
    const last = o.invoices[0];
    const owed = o.invoices.filter((i) => i.status !== 'paid' && i.status !== 'void').reduce((s, i) => s + i.totalCents, 0);
    return h('tr', { dataset: { id: o.id } },
      td('Builder', h('strong', null, o.name), o.internal ? chip('INTERNAL', 'warn') : null, o.billingSkipRisk ? chip('Month end will skip: billing details missing', 'warn') : null, h('div', { class: 'pp-sub' }, o.legalName ? `${o.legalName}${o.abn ? `, ABN ${o.abn}` : ''}` : ''), o.admin ? h('div', { class: 'pp-sub' }, `${o.admin.name} (${o.admin.username})${o.admin.mustChangePassword ? ', has not signed in' : ''}`) : null),
      td('Status', chip(label, kind), o.account.status === 'trial' ? h('div', { class: 'pp-sub' }, `${o.account.daysLeft} ${o.account.daysLeft === 1 ? 'day' : 'days'} left, ends ${o.account.lastTrialDay}`) : null,
        o.account.status === 'trial_ended' ? h('div', { class: 'pp-sub' }, `Ended ${when(o.account.trialEndsAt)}. Data kept until ${when(o.account.dataKeptUntil)}`) : null,
        o.account.card ? h('div', { class: 'pp-sub' }, `Card: ${o.account.card.brand} ending ${o.account.card.last4}`) : o.convertedHow === 'manual' ? h('div', { class: 'pp-sub' }, 'Converted manually') : null,
        o.trialExtendedDays ? h('div', { class: 'pp-sub' }, `Extended ${o.trialExtendedDays} days`) : null),
      td('Client logins', h('strong', null, String(o.clientLogins.issued)), h('div', { class: 'pp-sub' }, `${o.clientLogins.generated} generated`),
        o.loginPricing && !o.internal ? h('div', { class: 'pp-sub' }, `${o.loginPricing.count} this month, next ${formatAud(o.loginPricing.currentRateCents)}${o.loginPricing.customRateCents ? ' (custom rate)' : ''}`) : null,
        o.loginPricing?.over50Flag && !o.internal ? h('div', { class: 'pp-sub pp-adm-err' }, o.loginPricing.over50Flag) : null),
      td('AI this month', o.internal ? 'Not reported' : `${o.ai.creditsUsed} credits used`, o.internal ? null : h('div', { class: 'pp-sub' }, `${o.ai.topUps} ${o.ai.topUps === 1 ? 'top-up' : 'top-ups'}`)),
      td('Invoices', o.internal ? 'Never invoiced' : o.invoices.length ? `${o.invoices.length}, last ${last.number} ${last.status}` : 'None', owed ? h('div', { class: 'pp-sub' }, `${formatAud(owed)} open`) : null, last?.error ? h('div', { class: 'pp-sub pp-adm-err' }, last.error) : null),
      td('Actions', h('div', { class: 'pp-actions pp-actions--tight' },
        h('button', { class: 'pp-btn pp-btn--sm', type: 'button', onclick: (e) => toggleInternal(o, e.currentTarget) }, o.internal ? 'Make ordinary' : 'Mark internal'),
        !o.internal && o.account.status !== 'active' ? h('button', { class: 'pp-btn pp-btn--sm', type: 'button', onclick: (e) => extend(o, e.currentTarget) }, 'Extend 7 days') : null,
        !o.internal && o.account.status !== 'active' ? h('button', { class: 'pp-btn pp-btn--sm', type: 'button', onclick: (e) => convert(o, e.currentTarget) }, 'Convert to paid') : null,
        o.internal ? null : h('button', { class: 'pp-btn pp-btn--sm', type: 'button', onclick: () => setRate(o) }, 'Login price'),
        o.internal ? null : h('button', { class: 'pp-btn pp-btn--sm', type: 'button', onclick: (e) => resetAdmin(o, e.currentTarget) }, icon('key', 14), 'New admin password'))));
  }

  // Commercial trial login ----------------------------------------------------------------------------------------------------
  function openTrialForm() {
    const user = h('input', { type: 'text', name: 'username', autocomplete: 'off', spellcheck: 'false', required: true, value: trial?.username || '', 'aria-label': 'Trial username' });
    const pass = h('input', { type: 'password', name: 'password', autocomplete: 'new-password', required: true, 'aria-label': 'Trial password' });
    const exp = h('input', { type: 'date', name: 'expiresAt', 'aria-label': 'Expiry date (optional)', value: trial?.expiresAt ? new Date(Date.parse(trial.expiresAt) - 3600000).toLocaleDateString('en-CA', { timeZone: 'Australia/Sydney' }) : '' });
    const err = h('p', { class: 'pp-error', role: 'alert', hidden: true });
    openDialog({
      title: trial?.exists ? 'Reset the trial login' : 'Create the trial login', size: 'md',
      body: h('div', { class: 'pp-form' },
        h('p', null, 'This is the one login you can hand to friends to try commercial mode. You choose the username and password here. The password is stored hashed and is never shown again, so keep a note of it yourself.'),
        field('Username', () => user, { required: true, hint: 'Letters, numbers, dot, dash or underscore, 3 to 40 characters.' }),
        field('Password', () => pass, { required: true, hint: 'At least 10 characters. Resetting signs out everyone using the old login.' }),
        field('Expiry date (optional)', () => exp, { hint: 'Leave blank for no expiry. The login works through the whole of that day.' }),
        err),
      footer: (d) => [h('button', { class: 'pp-btn', type: 'button', onclick: () => d.close() }, 'Cancel'),
        h('button', { class: 'pp-btn pp-btn--primary', type: 'button', onclick: (e) => busy(e.currentTarget, async () => {
          try {
            trial = await api.saveCommercialTrial({ username: user.value.trim(), password: pass.value, expiresAt: exp.value });
            pass.value = '';
            d.close();
            toast('Trial login saved.', { kind: 'ok' });
            paint();
          } catch (ex) {
            err.textContent = errorMessage(ex);
            err.hidden = false;
          }
        }) }, trial?.exists ? 'Reset login' : 'Create login')],
    });
  }
  async function trialSettings(patch, message) {
    trial = await api.commercialTrialSettings(patch);
    toast(message, { kind: 'ok' });
    paint();
  }
  function setTrialExpiry() {
    const exp = h('input', { type: 'date', 'aria-label': 'Expiry date', value: '' });
    openDialog({
      title: 'Trial expiry date', size: 'sm',
      body: h('div', { class: 'pp-form' }, field('Expiry date', () => exp, { hint: 'The login works through the whole of that day. Press Clear for no expiry.' })),
      footer: (d) => [h('button', { class: 'pp-btn', type: 'button', onclick: () => d.close() }, 'Cancel'),
        h('button', { class: 'pp-btn', type: 'button', onclick: (e) => busy(e.currentTarget, async () => { await trialSettings({ expiresAt: null }, 'Expiry cleared.'); d.close(); }) }, 'Clear'),
        h('button', { class: 'pp-btn pp-btn--primary', type: 'button', onclick: (e) => busy(e.currentTarget, async () => { if (!exp.value) return; await trialSettings({ expiresAt: exp.value }, 'Expiry saved.'); d.close(); }) }, 'Save')],
    });
  }
  function trialSection() {
    const head = h('div', { class: 'pp-head', style: { marginTop: '32px' } }, h('div', null, h('h2', null, 'Commercial trial login'), h('p', { class: 'pp-lead pp-lead--sm' }, 'One shared login for friends to try commercial mode. Unlimited plan sets, watermarked, with a small AI message allowance.')));
    if (!trial) return h('div', null, head, h('p', { class: 'pp-empty' }, 'The trial login settings could not be loaded.'));
    if (!trial.exists) return h('div', null, head, h('div', { class: 'pp-card' }, h('p', null, 'There is no trial login yet.'), h('button', { class: 'pp-btn pp-btn--primary', type: 'button', onclick: openTrialForm }, 'Create trial login')));
    const line = (k, v) => h('div', { class: 'pp-adm-kv' }, h('span', null, k), h('strong', null, v));
    const status = trial.disabled ? chip('Disabled', 'warn') : trial.expired ? chip('Expired', 'warn') : chip('Active', 'ok');
    return h('div', null, head, h('article', { class: 'pp-card', id: 'trial-card' },
      h('div', { class: 'pp-card-head' }, h('h3', null, trial.username), status),
      h('div', { class: 'pp-adm-grid' },
        line('Expiry', trial.expiresAt ? ddmmyyyy(Date.parse(trial.expiresAt) - 3600000) : 'None'),
        line('Last used', trial.lastUsedAt ? `${ddmmyyyy(trial.lastUsedAt)} ${new Date(trial.lastUsedAt).toLocaleTimeString('en-AU', { timeZone: 'Australia/Sydney', hour: '2-digit', minute: '2-digit' })}` : 'Never'),
        line('Sign ins', String(trial.usage.logins)),
        line('Plan set PDFs', `${trial.usage.pdf} (${trial.today.pdf} today)`),
        line('DXF files', String(trial.usage.dxf)),
        line('AI messages', `${trial.ai.used} of ${trial.ai.total} used`),
        line('Plan set watermark', trial.watermark ? 'On' : 'Off'),
        line('Saved designs', `${trial.projectCount}, kept ${trial.keepDays} days`)),
      h('div', { class: 'pp-actions pp-actions--tight' },
        h('button', { class: 'pp-btn pp-btn--sm', type: 'button', onclick: openTrialForm }, icon('key', 14), 'Reset username and password'),
        h('button', { class: 'pp-btn pp-btn--sm', type: 'button', onclick: (e) => busy(e.currentTarget, () => trialSettings({ resetAi: true }, 'AI messages reset.')) }, 'Reset AI messages'),
        h('button', { class: 'pp-btn pp-btn--sm', type: 'button', onclick: setTrialExpiry }, 'Set expiry'),
        h('button', { class: 'pp-btn pp-btn--sm', type: 'button', onclick: (e) => busy(e.currentTarget, () => trialSettings({ disabled: !trial.disabled }, trial.disabled ? 'Trial login enabled.' : 'Trial login disabled.')) }, trial.disabled ? 'Enable' : 'Disable'))));
  }

  function usageSection() {
    const head = h('div', { class: 'pp-head', style: { marginTop: '32px' } }, h('div', null, h('h2', null, 'Commercial AI cost'), h('p', { class: 'pp-lead pp-lead--sm' }, usage ? `Actual tokens used by each account on ${usage.model}, priced at US$${usage.priceUsdPerMtok.input} in and US$${usage.priceUsdPerMtok.output} out per million tokens (cache reads at a tenth of the input price).` : 'Usage could not be loaded.')));
    if (!usage || !usage.months.length) return h('div', null, head, h('p', { class: 'pp-empty' }, 'No commercial AI messages yet.'));
    const fmt = (n) => Number(n).toLocaleString('en-AU');
    const rows = usage.months.flatMap((m) => [
      ...m.accounts.map((a) => h('tr', null, h('td', null, m.month), h('td', null, a.kind === 'trial' ? 'Trial login' : a.email || a.account), h('td', null, fmt(a.messages)), h('td', null, fmt(a.input)), h('td', null, fmt(a.cacheRead)), h('td', null, fmt(a.output)), h('td', null, `US$${a.costUsd.toFixed(4)}`))),
      h('tr', { class: 'pp-adm-total' }, h('td', null, m.month), h('td', null, h('strong', null, 'Total')), h('td', null, fmt(m.totals.messages)), h('td', null, fmt(m.totals.input)), h('td', null, fmt(m.totals.cacheRead)), h('td', null, fmt(m.totals.output)), h('td', null, h('strong', null, `US$${m.totals.costUsd.toFixed(4)}`)))]);
    return h('div', null, head, h('div', { class: 'pp-table-wrap' }, h('table', { class: 'pp-table' },
      h('thead', null, h('tr', null, ...['Month', 'Account', 'Messages', 'Input tokens', 'Cache read tokens', 'Output tokens', 'Cost'].map((t) => h('th', { scope: 'col' }, t)))), h('tbody', null, ...rows))));
  }


  // Plan set terms: how many accounts have accepted each version (signed in accounts only; free previews are recorded in the browser).
  function termsSection() {
    const head = h('div', { class: 'pp-head', style: { marginTop: '32px' } }, h('div', null, h('h2', null, 'Plan set terms acceptances'), h('p', { class: 'pp-lead pp-lead--sm' }, termsStats ? `Current version ${termsStats.currentVersion}. Counts are accounts that accepted each version (signed in accounts and Plan Packs; anonymous free previews are recorded in the browser only).` : 'Acceptances could not be loaded.')));
    if (!termsStats || !termsStats.versions.length) return h('div', { dataset: { ps: 'terms-admin' } }, head, h('p', { class: 'pp-empty' }, 'No acceptances recorded yet.'));
    const day = (iso) => (iso ? ddmmyyyy(iso) : '');
    return h('div', { dataset: { ps: 'terms-admin' } }, head, h('div', { class: 'pp-table-wrap' }, h('table', { class: 'pp-table' },
      h('thead', null, h('tr', null, ...['Version', 'Acceptances', 'First', 'Latest'].map((t) => h('th', { scope: 'col' }, t)))),
      h('tbody', null, ...termsStats.versions.map((v) => h('tr', null, h('td', null, v.version === termsStats.currentVersion ? `${v.version} (current)` : v.version), h('td', null, String(v.count)), h('td', null, day(v.firstAt)), h('td', null, day(v.lastAt))))))));
  }

  // Free profile contacts -------------------------------------------------------------------------------------------------------
  // Everyone who made a free profile. Only contacts who ticked the marketing box (and have not unsubscribed) can be exported for marketing.
  async function refreshContacts() {
    try {
      contacts = await api.profileContacts(contactFilters);
      paint();
    } catch (e) {
      toast(errorMessage(e), { kind: 'error' });
    }
  }
  async function exportContacts(scope, btn, { includeUnverified = false } = {}) {
    if (includeUnverified && !globalThis.confirm?.('WARNING: this export includes contacts whose marketing consent has NOT been verified.\n\nThe Spam Act 2003 requires consent to be demonstrable. Someone may have typed another person\'s email address, and an unverified tick box does not prove consent.\n\nExport them anyway?')) return;
    await busy(btn, async () => {
      const out = await api.profileCsv(scope, includeUnverified ? { ...contactFilters, includeUnverified: 1 } : contactFilters);
      downloadText(out.text, out.filename, 'text/csv');
      toast(`${out.count} ${out.count === 1 ? 'contact' : 'contacts'} exported to ${out.filename}.`, { kind: 'ok', timeout: 8000 });
    });
  }
  function contactsSection() {
    const head = h('div', { class: 'pp-head', style: { marginTop: '32px' } }, h('div', null, h('h2', null, 'Contacts'),
      h('p', { class: 'pp-lead pp-lead--sm' }, contacts ? `${contacts.total} free ${contacts.total === 1 ? "profile" : "profiles"}, ${contacts.marketable} can be marketed to (ticked the box, address verified, not unsubscribed)${contacts.consentedUnverified ? `, and ${contacts.consentedUnverified} ticked the box but are unverified (nothing confirms the address is theirs, so they are left out of the export)` : ''}. Marketing is opt in. Nothing is emailed from here.` : 'Free profile contacts could not be loaded. The profile service may not be switched on yet.')));
    if (!contacts) return h('div', { id: 'contacts-section' }, head);
    const sel = (key, label, options) => h('label', { class: 'pp-sub', style: { display: 'grid', gap: '2px', fontSize: '12px' } }, label,
      h('select', { 'aria-label': label, dataset: { filter: key }, onchange: (e) => { contactFilters[key] = e.target.value; refreshContacts(); } },
        ...options.map(([v, t]) => h('option', { value: v, selected: contactFilters[key] === v ? true : null }, t))));
    const txt = (key, label, type = 'text') => h('label', { class: 'pp-sub', style: { display: 'grid', gap: '2px', fontSize: '12px' } }, label,
      h('input', { type, 'aria-label': label, value: contactFilters[key], dataset: { filter: key }, style: { minHeight: '40px' }, onchange: (e) => { contactFilters[key] = e.target.value.trim(); refreshContacts(); } }));
    const filters = h('div', { class: 'pp-actions pp-actions--tight', style: { alignItems: 'end', flexWrap: 'wrap', gap: '10px' } },
      sel('consent', 'Marketing', [['', 'Any'], ['yes', 'Can market (consented)'], ['no', 'Cannot market']]),
      sel('type', 'I am a', [['', 'Any'], ['homeowner', 'Homeowner'], ['builder', 'Builder'], ['developer', 'Developer'], ['other', 'Other'], ['unspecified', 'Not said']]),
      txt('from', 'Joined from', 'date'), txt('to', 'Joined to', 'date'),
      sel('designs', 'Designs saved', [['', 'Any'], ['none', 'None'], ['some', 'One or more']]),
      sel('mode', 'Design type', [['', 'Any'], ['residential', 'Residential'], ['commercial', 'Commercial'], ['both', 'Both']]),
      txt('suburb', 'Suburb or postcode'));
    const buttons = h('div', { class: 'pp-actions pp-actions--tight', style: { margin: '12px 0' } },
      h('button', { class: 'pp-btn pp-btn--primary pp-btn--sm', type: 'button', id: 'export-marketing', onclick: (e) => exportContacts('marketing', e.currentTarget) }, icon('check', 15), 'Export for marketing (verified consent only)'),
      h('button', { class: 'pp-btn pp-btn--sm', type: 'button', id: 'export-unverified', title: 'Includes contacts whose consent is unverified. The Spam Act 2003 requires consent to be demonstrable.', onclick: (e) => exportContacts('marketing', e.currentTarget, { includeUnverified: true }) }, 'Export including UNVERIFIED consent (Spam Act risk)'),
      h('button', { class: 'pp-btn pp-btn--sm', type: 'button', id: 'export-all', onclick: (e) => exportContacts('all', e.currentTarget) }, 'Export everyone (not for marketing)'));
    const flag = (c, btn) => busy(btn, async () => {
      await api.profileUnsubscribe(c.id, !c.unsubscribed);
      toast(c.unsubscribed ? 'Unsubscribe flag cleared. They are not marketable until they opt in again.' : 'Marked unsubscribed. They are left out of the marketing export.', { kind: 'ok' });
      await refreshContacts();
    });
    const status = (c) => (c.unsubscribed ? chip('Unsubscribed', 'warn') : c.marketingConsent ? (c.marketingConsentVerified ? chip('Consented', 'ok') : chip('Consented, unverified', 'warn')) : chip('No consent', 'muted'));
    const rows = contacts.contacts.map((c) => h('tr', { dataset: { contact: c.id } },
      td('Name', c.name), td('Email', c.email), td('Phone', c.phone), td('Suburb or postcode', c.postcode), td('I am a', c.role), td('Joined', when(c.createdAt)),
      td('Designs', `${c.designs}${c.commercialDesigns ? ` (${c.commercialDesigns} commercial)` : ''}`), td('Marketing', status(c), c.marketingConsentAt ? h('small', { style: { display: 'block' } }, `${when(c.marketingConsentAt)} ${c.marketingTextVersion || ''}`) : null),
      td('Actions', h('button', { class: 'pp-btn pp-btn--sm', type: 'button', dataset: { action: 'flag-unsub' }, onclick: (e) => flag(c, e.currentTarget) }, c.unsubscribed ? 'Clear flag' : 'Mark unsubscribed'))));
    return h('div', { id: 'contacts-section' }, head, filters, h('p', { class: 'pp-sub', style: { marginTop: '8px' } }, `${contacts.matching} shown`), buttons,
      contacts.contacts.length ? h('div', { class: 'pp-table-wrap' }, h('table', { class: 'pp-table pp-table--stack' }, h('thead', null, h('tr', null, ...['Name', 'Email', 'Phone', 'Suburb or postcode', 'I am a', 'Joined', 'Designs', 'Marketing', 'Actions'].map((t) => h('th', { scope: 'col' }, t)))), h('tbody', null, ...rows)))
        : h('p', { class: 'pp-empty' }, 'No contacts match.'));
  }

  function paint() {
    clear(root);
    const count = (s) => requests.filter((r) => r.status === s).length;
    const shown = requests.filter((r) => r.status === filter);
    const tabs = h('div', { class: 'pp-tabs', role: 'tablist', 'aria-label': 'Trial requests' }, ...['pending', 'approved', 'declined'].map((s) => h('button', { class: 'pp-tab', role: 'tab', type: 'button', 'aria-selected': String(filter === s), dataset: { tab: s }, onclick: () => { filter = s; paint(); } }, `${s.charAt(0).toUpperCase()}${s.slice(1)} (${count(s)})`)));
    const skipped = orgs.filter((o) => o.billingSkipRisk);
    const skipNote = skipped.length ? h('p', { class: 'pp-notice pp-adm-skip', role: 'status' }, icon('info', 18), `Month end will skip ${skipped.length === 1 ? 'this builder' : 'these builders'} until legal name, ABN and billing email are saved: ${skipped.map((o) => o.name).join(', ')}.`) : null;
    const orgTable = orgs.length
      ? h('div', { class: 'pp-table-wrap' }, h('table', { class: 'pp-table pp-table--stack' }, h('thead', null, h('tr', null, ...['Builder', 'Status', 'Client logins issued', 'AI use', 'Invoices', 'Actions'].map((t) => h('th', { scope: 'col' }, t)))), h('tbody', null, ...orgs.map(orgRow))))
      : h('p', { class: 'pp-empty' }, 'No builder accounts yet.');
    root.append(h('div', { class: 'pp-brandbar' }, h('div', { class: 'pp-brand' }, h('div', null, h('strong', null, 'Glide Inside admin'), h('small', null, 'Trial requests and builder accounts'))), h('div', { class: 'pp-who' }, h('button', { class: 'pp-btn pp-btn--sm', type: 'button', onclick: () => reload() }, 'Refresh'), h('button', { class: 'pp-btn pp-btn--sm', type: 'button', onclick: () => signOut() }, icon('logout', 15), 'Lock'))),
      h('main', { class: 'pp-main' },
        h('div', { class: 'pp-head' }, h('div', null, h('h2', null, 'Trial requests'), h('p', { class: 'pp-lead pp-lead--sm' }, 'Each request waits for your approval. Approving creates the account; nothing is emailed to the builder.'))),
        tabs,
        h('div', { class: 'pp-adm-list' }, ...(shown.length ? shown.map(requestCard) : [h('p', { class: 'pp-empty' }, `No ${filter} requests.`)])),
        h('div', { class: 'pp-head', style: { marginTop: '32px' } }, h('div', null, h('h2', null, 'Builder accounts'), h('p', { class: 'pp-lead pp-lead--sm' }, 'Trial, trial ended, active and read only.'))),
        skipNote, orgTable,
        h('div', { class: 'pp-actions pp-actions--tight', style: { marginTop: '12px' } }, h('button', { class: 'pp-btn pp-btn--sm', type: 'button', id: 'create-internal', onclick: openInternalForm }, 'Create internal test account')),
        trialSection(),
        usageSection(),
        termsSection(),
        contactsSection()));
  }

  const saved = store.get();
  if (saved) {
    api = createApi({ token: saved });
    start();
  } else gate();
  return { reload };
}
