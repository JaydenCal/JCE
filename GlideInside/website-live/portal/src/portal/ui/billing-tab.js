// Billing: this month's issued logins and AI top-ups with the running total, past tax invoices, billing details, top-up setting.

import { h, openDialog, field, busy, toast, chip, icon, errorMessage } from './kit.js';
import { formatAud, ddmmyyyyTime, ddmmyyyy, monthLabel } from '../billing.js';
import { CHARGE_NOTICE } from './clients-tab.js';
import { accountOf, isReadOnly, addBillingButton, TRIAL_PRICING_TEXT } from './trial-ui.js';

export async function renderBilling(host, { api, me, refreshMe, goBilling }) {
  const acct = accountOf(me);
  const canWrite = me.permissions.includes('billing.write');
  const canSettings = canWrite && !isReadOnly(me);
  const [usage, invoices, contact] = await Promise.all([api.monthUsage(), api.listInvoices(), api.getBillingContact()]);
  const t = usage.totals;
  const missingDetails = !contact.legalName || !contact.abn;

  const table = (cols, rows, emptyText) => rows.length
    ? h('div', { class: 'pp-table-wrap' }, h('table', { class: 'pp-table' }, h('thead', null, h('tr', null, ...cols.map((c) => h('th', { scope: 'col', class: c.num ? 'pp-num' : '' }, c.label)))), h('tbody', null, ...rows)))
    : h('p', { class: 'pp-empty' }, emptyText);

  const loginRows = usage.logins.map((i) => h('tr', null, h('td', null, i.clientName), h('td', null, ddmmyyyyTime(i.firstSignInAt)), h('td', { class: 'pp-num' }, formatAud(i.amountCents))));
  const topRows = usage.topUps.map((x) => h('tr', null, h('td', null, x.clientName), h('td', null, ddmmyyyyTime(x.createdAt)), h('td', null, `${x.credits} credits`), h('td', { class: 'pp-num' }, formatAud(x.amountCents))));

  function invoiceDialog(id) {
    api.getInvoice(id).then((inv) => {
      const line = (l) => h('tr', null, h('td', null, l.description), h('td', { class: 'pp-num' }, String(l.quantity)), h('td', { class: 'pp-num' }, formatAud(l.unitCents)), h('td', { class: 'pp-num' }, formatAud(l.totalCents)));
      openDialog({ title: 'Tax invoice', size: 'lg', body: h('div', { class: 'pp-invoice', id: 'pp-invoice' },
        h('div', { class: 'pp-invoice-top' },
          h('div', null, h('strong', null, inv.seller.name), h('div', null, `ABN ${inv.seller.abn}`), h('div', { class: 'pp-sub' }, 'hello@glideinside.com.au')),
          h('div', { class: 'pp-invoice-meta' }, h('h3', null, 'Tax invoice'), h('div', null, `Invoice ${inv.number}`), h('div', null, `Date ${ddmmyyyy(inv.issuedAt)}`), h('div', null, `Due ${ddmmyyyy(inv.dueAt)}`))),
        h('div', { class: 'pp-invoice-to' }, h('div', { class: 'pp-sub' }, 'Billed to'), h('strong', null, inv.buyer.legalName || 'Legal name not set'), h('div', null, inv.buyer.abn ? `ABN ${inv.buyer.abn}` : 'ABN not set'), h('div', { class: 'pp-sub' }, inv.buyer.contact)),
        h('p', null, `Period: ${monthLabel(inv.month)} (Sydney time)`),
        h('table', { class: 'pp-table' }, h('thead', null, h('tr', null, h('th', { scope: 'col' }, 'Description'), h('th', { scope: 'col', class: 'pp-num' }, 'Qty'), h('th', { scope: 'col', class: 'pp-num' }, 'Unit price incl. GST'), h('th', { scope: 'col', class: 'pp-num' }, 'Amount incl. GST'))), h('tbody', null, ...inv.lines.map(line))),
        h('dl', { class: 'pp-totals' }, h('dt', null, 'Subtotal excl. GST'), h('dd', null, formatAud(inv.subtotalExGstCents)), h('dt', null, 'GST (10%)'), h('dd', null, formatAud(inv.gstCents)), h('dt', null, 'Total incl. GST'), h('dd', null, h('strong', null, formatAud(inv.totalInclGstCents)))),
        h('p', { class: 'pp-sub' }, inv.payment?.method === 'card' ? `Charged to the card on file${inv.payment.last4 ? ` (${inv.payment.brand ? `${inv.payment.brand} ` : ''}ending ${inv.payment.last4})` : ''}. All amounts include GST.` : 'Payment terms: 14 days. All amounts include GST.')),
      footer: (d) => [h('button', { class: 'pp-btn', type: 'button', onclick: () => window.print() }, 'Print or save as PDF'), h('button', { class: 'pp-btn pp-btn--primary', type: 'button', onclick: () => d.close() }, 'Close')] });
    }).catch((e) => toast(errorMessage(e), { kind: 'error' }));
  }

  // Billing details (legal name and ABN are required for the tax invoice).
  const form = h('form', { class: 'pp-form pp-form--grid', novalidate: true, onsubmit: (e) => {
    e.preventDefault();
    busy(save, async () => {
      try {
        const f = form.elements;
        await api.setBillingContact({ legalName: f.legal.value, abn: f.abn.value, name: f.name.value, email: f.email.value, phone: f.phone.value });
        toast('Billing details saved.', { kind: 'ok' });
        refreshMe?.();
      } catch (ex) {
        err.textContent = errorMessage(ex);
        err.hidden = false;
        return;
      }
      err.hidden = true;
    });
  } },
  field('Legal business name', (id) => h('input', { id, name: 'legal', type: 'text', value: contact.legalName || '', required: true, maxlength: '120', readonly: !canWrite }), { required: true, hint: 'Printed on your tax invoices.' }),
  field('ABN', (id) => h('input', { id, name: 'abn', type: 'text', inputmode: 'numeric', value: contact.abn || '', required: true, readonly: !canWrite }), { required: true, hint: '11 digits.' }),
  field('Billing contact name', (id) => h('input', { id, name: 'name', type: 'text', value: contact.name || '', required: true, readonly: !canWrite }), { required: true }),
  field('Billing email', (id) => h('input', { id, name: 'email', type: 'email', value: contact.email || '', required: true, readonly: !canWrite }), { required: true, hint: 'Where invoices are sent.' }),
  field('Phone', (id) => h('input', { id, name: 'phone', type: 'tel', value: contact.phone || '', readonly: !canWrite })));
  const err = h('p', { class: 'pp-error', role: 'alert', hidden: true });
  const save = h('button', { class: 'pp-btn pp-btn--primary', type: 'submit' }, 'Save billing details');
  form.append(err, canWrite ? h('div', { class: 'pp-field--wide' }, save) : null);

  const topToggle = h('input', { type: 'checkbox', checked: !!me.org.allowClientTopUps, disabled: !canSettings, onchange: async (e) => {
    try {
      await api.setOrgSettings({ allowClientTopUps: e.target.checked });
      toast(e.target.checked ? 'Clients can now top up AI credits.' : 'Clients can no longer top up AI credits. Staff still can.', { kind: 'ok' });
      refreshMe?.();
    } catch (ex) {
      e.target.checked = !e.target.checked;
      toast(errorMessage(ex), { kind: 'error' });
    }
  } });

  function accountCard() {
    const card = acct.card ? `${acct.card.brand ? acct.card.brand.charAt(0).toUpperCase() + acct.card.brand.slice(1) : 'Card'} ending ${acct.card.last4}` : null;
    if (acct.status === 'trial') {
      return h('section', { class: 'pp-card pp-account pp-account--trial', id: 'account-status' },
        h('div', { class: 'pp-card-head' }, h('h3', null, 'Account'), chip(`Free trial: ${acct.daysLeft} ${acct.daysLeft === 1 ? 'day' : 'days'} left`, 'warn')),
        h('p', null, `Your free trial runs until the end of ${acct.lastTrialDay || ddmmyyyy(acct.trialEndsAt)}. Until then your staff can use everything except client logins and AI credit top-ups. The monthly AI allowance still applies.`),
        h('p', null, 'When the trial ends the account becomes read only until you add billing details. Your projects are kept for 90 days after a trial ends unless you ask for them to be deleted.'),
        h('p', { class: 'pp-sub' }, TRIAL_PRICING_TEXT),
        canWrite ? h('div', { class: 'pp-actions' }, addBillingButton(api, { goBilling: () => form.scrollIntoView({ behavior: 'smooth' }) })) : null);
    }
    if (acct.readOnly) {
      return h('section', { class: 'pp-card pp-account pp-account--ended', id: 'account-status' },
        h('div', { class: 'pp-card-head' }, h('h3', null, 'Account'), chip(acct.status === 'trial_ended' ? 'Trial ended: read only' : 'Read only', 'warn')),
        h('p', null, 'You can still view your projects. Add billing details to make changes, export and issue client logins again.'),
        acct.dataKeptUntil ? h('p', { class: 'pp-sub' }, `Your projects are kept until ${ddmmyyyy(acct.dataKeptUntil)}. Ask us to delete them sooner if you prefer.`) : null,
        h('p', { class: 'pp-sub' }, TRIAL_PRICING_TEXT),
        canWrite ? h('div', { class: 'pp-actions' }, addBillingButton(api, { goBilling: () => form.scrollIntoView({ behavior: 'smooth' }) })) : null);
    }
    return h('section', { class: 'pp-card pp-account', id: 'account-status' },
      h('div', { class: 'pp-card-head' }, h('h3', null, 'Account'), chip('Active', 'ok')),
      h('p', null, card ? `Charges are taken automatically from your ${card} at the end of each month.` : 'Charges are invoiced at the end of each month.'),
      canWrite ? h('div', { class: 'pp-actions' }, addBillingButton(api, { label: card ? 'Change card' : 'Add card details', primary: false, goBilling: () => form.scrollIntoView({ behavior: 'smooth' }) })) : null);
  }

  const lp = usage.loginPricing || null;
  host.append(...[
    h('div', { class: 'pp-head' }, h('div', null, h('h2', null, 'Billing'), h('p', { class: 'pp-lead pp-lead--sm' }, 'Charges are collected on one invoice at the end of each calendar month, Sydney time. There is no monthly fee.'))),
    accountCard(),
    missingDetails ? h('p', { class: 'pp-notice pp-notice--warn', role: 'alert' }, icon('warning', 18), 'Add your legal business name and ABN below. They are needed on your tax invoice.') : null,
    h('section', { class: 'pp-card' },
      h('div', { class: 'pp-card-head' }, h('h3', null, `${monthLabel(usage.month)} so far`), h('p', { class: 'pp-total' }, formatAud(t.totalCents), h('small', null, ' incl. GST'))),
      h('p', { class: 'pp-notice pp-notice--quiet' }, icon('info', 18), `${CHARGE_NOTICE} Each AI credit top-up of 300 credits is A$10 incl. GST. Resetting passwords, disabling logins and staff logins are free.`),
      lp ? h('p', { class: 'pp-notice pp-notice--quiet', id: 'login-rate' }, icon('info', 18), lp.customRateCents
        ? `${lp.count} new client ${lp.count === 1 ? 'login' : 'logins'} this month. Your agreed rate is ${formatAud(lp.customRateCents)} incl. GST per new client login.`
        : `${lp.count} new client ${lp.count === 1 ? 'login' : 'logins'} this month. The next one is ${formatAud(lp.currentRateCents)} incl. GST. Logins 1 to 15 in a month are A$35 each, logins 16 to 50 are A$25 each, above 50 is a custom rate.`) : null,
      h('h4', null, `New client logins (first sign in this month): ${t.loginsCount} = ${formatAud(t.loginsCents)}`),
      table([{ label: 'Client' }, { label: 'First sign in (DD/MM/YYYY)' }, { label: 'Charge', num: true }], loginRows, 'No clients have signed in for the first time this month.'),
      h('h4', null, `AI credit top-ups: ${t.topUpsCount} at A$10 = ${formatAud(t.topUpsCents)}`),
      table([{ label: 'Login' }, { label: 'Added (DD/MM/YYYY)' }, { label: 'Credits' }, { label: 'Charge', num: true }], topRows, 'No AI top-ups this month.'),
      h('dl', { class: 'pp-totals' }, h('dt', null, `New client logins (${t.loginsCount})`), h('dd', null, formatAud(t.loginsCents)), h('dt', null, `AI top-ups (${t.topUpsCount} x A$10)`), h('dd', null, formatAud(t.topUpsCents)), h('dt', null, 'Month total incl. GST'), h('dd', null, h('strong', null, formatAud(t.totalCents))))),
    h('section', { class: 'pp-card' }, h('h3', null, 'Past invoices'),
      table([{ label: 'Invoice' }, { label: 'Month' }, { label: 'Issued' }, { label: 'Logins', num: true }, { label: 'Top-ups', num: true }, { label: 'Total incl. GST', num: true }, { label: 'Status' }, { label: '' }],
        invoices.map((i) => h('tr', null, h('td', null, i.number), h('td', null, monthLabel(i.month)), h('td', null, ddmmyyyy(i.issuedAt)), h('td', { class: 'pp-num' }, String(i.loginsCount)), h('td', { class: 'pp-num' }, String(i.topUpsCount)), h('td', { class: 'pp-num' }, formatAud(i.totalCents)), h('td', null, chip(i.status === 'paid' ? 'Paid' : 'Due', i.status === 'paid' ? 'ok' : 'warn')), h('td', null, h('button', { class: 'pp-btn pp-btn--sm', type: 'button', onclick: () => invoiceDialog(i.id) }, 'View tax invoice')))), 'No past invoices yet.')),
    h('section', { class: 'pp-card' }, h('h3', null, 'AI credits'),
      h('p', null, 'Every login, staff and client, includes a monthly AI helper allowance with a hard stop at zero. Extra credits can be added at A$10 incl. GST for 300 credits, added immediately and charged on your end of month invoice.'),
      acct.status === 'trial' ? h('p', { class: 'pp-notice pp-notice--quiet' }, icon('info', 18), 'AI credit top-ups are not available during the free trial. The monthly allowance still applies.') : null,
      h('label', { class: 'pp-check pp-check--big' }, topToggle, h('span', null, h('strong', null, 'Allow clients to top up AI credits'), h('small', null, 'On by default. When off, clients who run out wait for next month; your staff can still top up.')))),
    h('section', { class: 'pp-card' }, h('h3', null, 'Billing details and contact'), form)].filter(Boolean));
}
