// Clients: Generate account (first name only), list with status, last sign in, projects, AI credits; reset, disable, delete, export.

import { h, openDialog, confirmDialog, field, busy, toast, chip, icon, errorMessage, downloadText } from './kit.js?v=20261119f';
import { credentialsCard } from './credentials-card.js?v=20261119f';
import { ddmmyyyy } from '../billing.js?v=20261119f';
import { appLink, designLink, portalUrl } from '../links.js?v=20261119f';
import { slug } from '../../ui/dom.js?v=20261119f';
import { TEMP_PASSWORD_DAYS } from '../mock-api.js?v=20261119f';
import { accountOf, isReadOnly, addBillingButton } from './trial-ui.js?v=20261119f';

export const CHARGE_NOTICE = 'Client logins are free. There is no charge when you generate one or when your client first signs in.';

const houseAccessText = (a) => (a === 'all' ? 'All designs' : `${a.length} selected`);
const day = (iso) => (iso ? ddmmyyyy(iso) : null);

export function aiText(ai) {
  return `${ai.used} of ${ai.monthlyCap} used this month`;
}

export function accessPicker(houses, initial = 'all') {
  const all = h('input', { type: 'radio', name: 'access', value: 'all', checked: initial === 'all' });
  const some = h('input', { type: 'radio', name: 'access', value: 'some', checked: initial !== 'all' });
  const boxes = houses.map((x) => h('label', { class: 'pp-check' }, h('input', { type: 'checkbox', value: x.id, checked: Array.isArray(initial) && initial.includes(x.id), onchange: () => { some.checked = true; } }), h('span', null, x.name)));
  const el = h('fieldset', { class: 'pp-fieldset' },
    h('legend', null, 'House designs they can see', h('span', { class: 'pp-opt' }, ' (optional, can be changed later)')),
    h('label', { class: 'pp-check' }, all, h('span', null, 'All of my designs')),
    h('label', { class: 'pp-check' }, some, h('span', null, 'Only the designs I select')),
    h('div', { class: 'pp-checklist' }, ...boxes),
    h('p', { class: 'pp-hint' }, 'Clients see only your own house designs.'));
  return { el, value: () => (all.checked ? 'all' : boxes.map((b) => b.querySelector('input')).filter((i) => i.checked).map((i) => i.value)) };
}

export async function renderClients(host, { api, me, refreshBilling, goBilling }) {
  const acct = accountOf(me);
  const locked = !acct.canIssueClients; // free trial (client logins unlock with billing details) or read only
  const canWrite = me.permissions.includes('clients.write') && !isReadOnly(me);
  const canGenerate = canWrite && !locked;
  const houses = await api.listHouses();
  const tbody = h('tbody');
  const table = h('table', { class: 'pp-table pp-table--stack' },
    h('thead', null, h('tr', null, ...['Client', 'Lot address', 'Houses', 'Status', 'Last sign in', 'Projects', 'AI credits', 'Actions'].map((t) => h('th', { scope: 'col' }, t)))), tbody);
  const empty = h('p', { class: 'pp-empty', hidden: true }, locked ? 'No client logins yet.' : 'No client logins yet. Use Generate account to create the first one.');

  function regionRow(canSet) {
    const input = h('input', { type: 'text', maxlength: '60', value: me.org.directoryRegion || '', disabled: !canSet, placeholder: 'Mid North Coast NSW', dataset: { setting: 'directoryRegion' }, 'aria-label': 'Region shown in the local builder search' });
    const save = async () => {
      try {
        me.org = await api.setOrgSettings({ directoryRegion: input.value });
        toast('Saved.', { kind: 'ok' });
      } catch (ex) {
        toast(errorMessage(ex), { kind: 'error' });
      }
    };
    return h('div', { class: 'pp-region', style: { display: 'flex', gap: '10px', alignItems: 'flex-end', flexWrap: 'wrap', padding: '6px 0 6px 28px' } }, h('div', null, h('strong', null, 'Region shown in the builder search'), h('span', { class: 'pp-sub' }, 'Optional. For example the towns or area you build in.'), h('div', null, input)), h('button', { class: 'pp-btn pp-btn--sm', type: 'button', disabled: !canSet, onclick: save }, 'Save region'));
  }

  // Client access requests: visitors who asked this builder for a login. Approve issues the login through the normal flow.
  const reqHost = h('section', { class: 'pp-card', id: 'client-requests', hidden: true, dataset: { ps: 'client-requests' } });
  async function loadRequests() {
    let list = [];
    try { list = await api.listClientRequests({ status: 'pending' }); } catch { list = []; }
    reqHost.hidden = list.length === 0;
    if (!list.length) return;
    reqHost.replaceChildren(
      h('h3', null, `Client login requests (${list.length})`),
      h('p', { class: 'pp-lead pp-lead--sm' }, 'These people found you in the local builder search and asked for a login. Approve to generate their account, then pass the username and temporary password on yourself. The system sends no email.'),
      h('div', { class: 'pp-table-wrap' }, h('table', { class: 'pp-table pp-table--stack' },
        h('thead', null, h('tr', null, ...['Name', 'Contact', 'Lot address', 'Chosen design', 'Requested', 'Actions'].map((t) => h('th', { scope: 'col' }, t)))),
        h('tbody', null, ...list.map((q) => h('tr', { dataset: { id: q.id, ps: 'client-request' } },
          td('Name', h('strong', null, q.name)),
          td('Contact', h('div', null, q.email), h('div', { class: 'pp-sub' }, q.phone)),
          td('Lot address', q.lotAddress || h('span', { class: 'pp-sub' }, 'Not given')),
          td('Chosen design', q.designName || h('span', { class: 'pp-sub' }, 'None yet')),
          td('Requested', day(q.createdAt)),
          td('Actions', canGenerate ? h('div', { class: 'pp-actions' },
            h('button', { class: 'pp-btn pp-btn--sm pp-btn--primary', type: 'button', dataset: { act: 'approve' }, onclick: (e) => approveRequest(e.currentTarget, q) }, 'Approve'),
            h('button', { class: 'pp-btn pp-btn--sm', type: 'button', dataset: { act: 'decline' }, onclick: () => declineRequest(q) }, 'Decline')) : h('span', { class: 'pp-sub' }, locked ? 'Add billing details to approve' : 'Read only'))))))));
  }
  async function approveRequest(btn, q) {
    await busy(btn, async () => {
      try {
        const r = await api.approveClientRequest(q.id);
        openDialog({ title: `Account for ${r.client.name}`, body: h('div', null,
          credentialsCard({ username: r.credentials.username, password: r.credentials.password, who: r.client.name, signInUrl: portalUrl('?client=1'), expiryDays: TEMP_PASSWORD_DAYS }),
          h('p', { class: 'pp-notice pp-notice--quiet' }, icon('info', 18), `${r.charge.note} Pass these details to ${r.client.name} yourself (${q.email}, ${q.phone}).`)),
        footer: (x) => h('button', { class: 'pp-btn pp-btn--primary', type: 'button', onclick: () => x.close() }, 'Done') });
        await load();
        await loadRequests();
        refreshBilling?.();
      } catch (ex) {
        toast(errorMessage(ex), { kind: 'error' });
      }
    });
  }
  function declineRequest(q) {
    confirmDialog({ title: `Decline ${q.name}?`, message: 'The request is marked declined. Nothing is sent to them.', confirmLabel: 'Decline request' }).then(async (ok) => {
      if (!ok) return;
      try {
        await api.declineClientRequest(q.id, {});
        toast('Request declined.', { kind: 'ok' });
        await loadRequests();
      } catch (ex) {
        toast(errorMessage(ex), { kind: 'error' });
      }
    });
  }

  function settingsCard() {
    const canSet = me.permissions.includes('billing.write') && !isReadOnly(me);
    const row = (key, title, help) => {
      const box = h('input', { type: 'checkbox', dataset: { setting: key }, checked: (key === 'showAerialDefault' || key === 'showAiAssistant') ? me.org[key] !== false : !!me.org[key], disabled: !canSet, onchange: async (e) => {
        try {
          me.org = await api.setOrgSettings({ [key]: e.target.checked });
          toast('Saved.', { kind: 'ok' });
        } catch (ex) {
          e.target.checked = !e.target.checked;
          toast(errorMessage(ex), { kind: 'error' });
        }
      } });
      return h('label', { class: 'pp-check' }, box, h('span', null, h('strong', null, title), h('span', { class: 'pp-sub' }, help)));
    };
    return h('section', { class: 'pp-card pp-client-settings' },
      h('h3', null, 'Client settings'),
      h('p', { class: 'pp-lead pp-lead--sm' }, 'What your clients can see and do. Your own staff logins are not affected.'),
      row('showAerialDefault', 'Show aerial by default', 'On by default: lots open with the aerial imagery. Turn it off to open on a clean ground. Anyone can still switch the aerial on or off, and the browser remembers their choice.'),
      row('showAiAssistant', 'Show AI design assistant to clients', 'On by default. Turn it off to hide the assistant entirely for your clients (their plans, colours and exports are unaffected). Your own staff logins keep it.'),
      row('directoryListed', 'List my business in the local builder search', 'Off by default. When on, visitors to Glide Inside Residential can find your business by name (you appear with your name, region and logo only) and ask you for a client login. Their request waits in the list on this page and nothing is emailed. You decide whether to approve it.'),
      regionRow(canSet),
      me?.org?.internal === true ? row('showGlideToClients', 'Show Glide Inside sample designs to clients', 'Off (the default) means clients see only your own house designs.') : null, // builders: own designs only (owner 18/11/2026)
      row('allowClientEnquiries', 'Let clients send their plans to JCE for engineering and DA quotes', 'On by default. Nothing is sent until the client ticks consent and presses Send.'),
      row('allowClientCadExports', 'Let clients export DXF and 3D models as well as the PDF', 'Off by default: clients get your branded PDF plans only. The design files stay your property (see the terms: clients are licensed to use the plans for their own build only).'));
  }

  async function load() {
    const clients = await api.listClients();
    empty.hidden = clients.length > 0;
    table.hidden = clients.length === 0;
    tbody.replaceChildren(...clients.map(row));
  }
  const td = (label, ...kids) => h('td', { dataset: { label } }, ...kids);

  function row(c) {
    const items = [
      canWrite ? h('button', { class: 'pp-menu-item', type: 'button', onclick: () => editDialog(c) }, 'Edit') : null,
      canGenerate ? h('button', { class: 'pp-menu-item', type: 'button', onclick: () => resetDialog(c) }, icon('key', 14), 'Reset password') : null,
      canWrite && (c.status === 'active' || !locked) ? h('button', { class: 'pp-menu-item', type: 'button', onclick: (e) => toggle(e.currentTarget, c) }, c.status === 'active' ? 'Disable' : 'Enable') : null,
      c.projectCount ? h('button', { class: 'pp-menu-item', type: 'button', onclick: () => projectsDialog(c) }, icon('open', 14), 'Open as client view') : null,
      h('button', { class: 'pp-menu-item', type: 'button', onclick: (e) => exportProjects(e.currentTarget, c) }, icon('download', 14), 'Export projects'),
      canWrite ? h('button', { class: 'pp-menu-item pp-menu-item--danger', type: 'button', onclick: () => deleteDialog(c) }, icon('trash', 14), 'Delete') : null].filter(Boolean);
    const menu = h('details', { class: 'pp-menu', onclick: (e) => { if (e.target.closest('.pp-menu-item')) menu.open = false; } }, h('summary', { class: 'pp-btn pp-btn--sm' }, 'Actions'), h('div', { class: 'pp-menu-list' }, ...items));
    const actions = menu;
    const sign = c.lastSignInAt ? day(c.lastSignInAt) : 'Not signed in yet';
    return h('tr', { dataset: { id: c.id } },
      td('Client', h('strong', null, c.name), h('div', { class: 'pp-sub' }, c.username), c.email ? h('div', { class: 'pp-sub' }, c.email) : null),
      td('Lot address', c.lotAddress || h('span', { class: 'pp-sub' }, 'Not added')),
      td('Houses', houseAccessText(c.houseAccess)),
      td('Status', chip(c.status === 'active' ? 'Active' : 'Disabled', c.status === 'active' ? 'ok' : 'muted'), c.mustChangePassword && c.tempPasswordExpiresAt ? h('div', { class: 'pp-sub' }, `Temporary password expires ${day(c.tempPasswordExpiresAt)}`) : null),
      td('Last sign in', sign),
      td('Projects', c.projectCount ? h('button', { class: 'pp-link', type: 'button', onclick: () => projectsDialog(c) }, `${c.projectCount} ${c.projectCount === 1 ? 'project' : 'projects'}`) : '0'),
      td('AI credits', h('div', null, aiText(c.ai)), h('div', { class: 'pp-sub' }, `${c.ai.remaining} left${c.ai.topUpBalance ? ` (incl. ${c.ai.topUpBalance} top-up)` : ''}`),
        c.ai.remaining === 0 ? chip('Stopped', 'warn') : null),
      td('Actions', actions));
  }

  // Generate account -------------------------------------------------------------------------------------------------------
  function generateDialog() {
    const first = h('input', { type: 'text', name: 'first', maxlength: '60', autocomplete: 'off', required: true, placeholder: 'Sarah' });
    const email = h('input', { type: 'email', name: 'email', autocomplete: 'off' });
    const lot = h('input', { type: 'text', name: 'lot', maxlength: '200', autocomplete: 'off', placeholder: 'Lot 14, 22 Banksia Rise, Thornton NSW 2322' });
    const picker = accessPicker(houses);
    const err = h('p', { class: 'pp-error', role: 'alert', hidden: true });
    let d;
    const form = h('form', { class: 'pp-form', novalidate: true, onsubmit: (e) => { e.preventDefault(); go(); } },
      h('p', { class: 'pp-notice' }, icon('info', 18), CHARGE_NOTICE),
      field('Client first name', () => first, { required: true, hint: 'The username is made from this name, for example sarah-4821.' }),
      h('details', { class: 'pp-more' }, h('summary', null, 'Add email, lot address or house access (optional, can be added later)'),
        field('Email', () => email), field('Lot address', () => lot), picker.el),
      err);
    const go = () => busy(submit, async () => {
      err.hidden = true;
      try {
        const r = await api.issueClientLogin({ firstName: first.value, email: email.value, lotAddress: lot.value, houseAccess: picker.value() });
        showCredentials(r);
        await load();
        refreshBilling?.();
      } catch (ex) {
        err.textContent = errorMessage(ex);
        err.hidden = false;
      }
    });
    const submit = h('button', { class: 'pp-btn pp-btn--primary', type: 'button', onclick: go }, 'Generate account');
    d = openDialog({ title: 'Generate account', body: form, footer: (x) => [h('button', { class: 'pp-btn', type: 'button', onclick: () => x.close() }, 'Cancel'), submit] });

    function showCredentials(r) {
      d.setTitle(`Account for ${r.client.name}`);
      d.setBody(h('div', null,
        credentialsCard({ username: r.credentials.username, password: r.credentials.password, who: r.client.name, signInUrl: portalUrl('?client=1'), expiryDays: TEMP_PASSWORD_DAYS }),
        h('p', { class: 'pp-notice pp-notice--quiet' }, icon('info', 18), 'A$30 incl. GST is charged on your monthly invoice once your client first signs in (A$25 each from the 16th new client login in a month). Nothing is charged if they never do, and you can delete an unused login free.')));
      d.setFooter((x) => [h('button', { class: 'pp-btn', type: 'button', onclick: () => { x.close(); generateDialog(); } }, 'Generate another'), h('button', { class: 'pp-btn pp-btn--primary', type: 'button', onclick: () => x.close() }, 'Done')]);
    }
  }

  function resetDialog(c) {
    confirmDialog({ title: `Reset password for ${c.name}?`, message: 'A new temporary password is generated and the old one stops working. There is no charge. The client must choose their own password at next sign in.', confirmLabel: 'Reset password' }).then(async (ok) => {
      if (!ok) return;
      try {
        const r = await api.resetClientPassword(c.id);
        openDialog({ title: `New password for ${c.name}`, body: credentialsCard({ ...r.credentials, who: c.name, signInUrl: portalUrl('?client=1'), expiryDays: TEMP_PASSWORD_DAYS }), footer: (x) => h('button', { class: 'pp-btn pp-btn--primary', type: 'button', onclick: () => x.close() }, 'Done') });
        await load();
      } catch (ex) {
        toast(errorMessage(ex), { kind: 'error' });
      }
    });
  }
  async function toggle(btn, c) {
    await busy(btn, async () => {
      await (c.status === 'active' ? api.disableClient(c.id) : api.enableClient(c.id));
      toast(c.status === 'active' ? `${c.name}'s login is disabled. Their projects are kept.` : `${c.name}'s login is active again.`, { kind: 'ok' });
      await load();
    });
  }
  function editDialog(c) {
    const first = h('input', { type: 'text', value: c.name, maxlength: '60', required: true });
    const email = h('input', { type: 'email', value: c.email || '' });
    const lot = h('input', { type: 'text', value: c.lotAddress || '', maxlength: '200' });
    const picker = accessPicker(houses, c.houseAccess);
    openDialog({ title: `Edit ${c.name}`, body: h('div', { class: 'pp-form' }, field('First name', () => first, { required: true }), field('Email', () => email), field('Lot address', () => lot), picker.el),
      footer: (d) => [h('button', { class: 'pp-btn', type: 'button', onclick: () => d.close() }, 'Cancel'), h('button', { class: 'pp-btn pp-btn--primary', type: 'button', onclick: (e) => busy(e.currentTarget, async () => { await api.updateClient(c.id, { firstName: first.value, email: email.value, lotAddress: lot.value, houseAccess: picker.value() }); d.close(); toast('Saved.', { kind: 'ok' }); await load(); }) }, 'Save')] });
  }
  async function projectsDialog(c) {
    const list = await api.listProjects({ clientId: c.id });
    openDialog({ title: `${c.name}'s projects`, body: h('ul', { class: 'pp-list' }, list.map((p) => h('li', null, h('div', null, h('strong', null, p.name), h('div', { class: 'pp-sub' }, `${p.lotAddress || 'No lot address'} · updated ${day(p.updatedAt)}${p.editedByStaff ? ' · last saved by staff' : ''}`)),
      h('div', { class: 'pp-actions' },
        h('a', { class: 'pp-btn pp-btn--sm pp-btn--primary', href: designLink({ project: p.id }), target: '_blank', rel: 'noopener', title: 'Opens the project the way the client sees it. Saving goes back to their project, recorded as edited by staff.' }, icon('open', 15), 'Open as client view'),
        h('a', { class: 'pp-btn pp-btn--sm', href: appLink({ project: p.id }), target: '_blank', rel: 'noopener' }, 'Full editor'))))),
    footer: (d) => h('button', { class: 'pp-btn', type: 'button', onclick: () => d.close() }, 'Close') });
  }
  async function exportProjects(btn, c) {
    await busy(btn, async () => {
      const data = await api.exportClientProjects(c.id);
      downloadText(JSON.stringify(data, null, 2), `${slug(c.name)}-${c.username}-projects.json`);
      toast(`Exported ${data.projects.length} ${data.projects.length === 1 ? 'project' : 'projects'} for ${c.name}.`, { kind: 'ok' });
    });
  }
  function deleteDialog(c) {
    confirmDialog({ title: `Delete ${c.name}?`, danger: true, confirmLabel: 'Delete login and projects',
      message: `This removes the login ${c.username} and all ${c.projectCount} of their projects. It cannot be undone. Export their projects first if you want to keep a copy. ${c.billed ? 'A charge made for this login before client logins became free stays on your invoice.' : 'There is no charge for removing a login.'}` }).then(async (ok) => {
      if (!ok) return;
      try {
        const r = await api.deleteClient(c.id);
        toast(`Deleted ${c.name} and ${r.removedProjects} ${r.removedProjects === 1 ? 'project' : 'projects'}.`, { kind: 'ok' });
        await load();
      } catch (ex) {
        toast(errorMessage(ex), { kind: 'error' });
      }
    });
  }

  const lockedNotice = acct.status === 'trial'
    ? h('div', { class: 'pp-notice pp-notice--lock', id: 'clients-locked' }, icon('lock', 18), h('div', null, h('strong', null, 'Client logins unlock when you add billing details.'), h('p', null, 'During your free trial your staff can use the whole portal, including the house library, branding, Glide Inside Residential and exports. Client logins are charged at A$30 incl. GST each (A$25 each after 15 in a month), once, when the client first signs in. Nothing is charged for a login that is never used.')), addBillingButton(api, { goBilling }))
    : h('div', { class: 'pp-notice pp-notice--lock', id: 'clients-locked' }, icon('lock', 18), h('div', null, h('strong', null, 'This account is read only.'), h('p', null, 'Add billing details to issue and manage client logins again.')), addBillingButton(api, { goBilling }));
  host.append(
    h('div', { class: 'pp-head' },
      h('div', null, h('h2', null, 'Clients'), h('p', { class: 'pp-lead pp-lead--sm' }, 'Give each client a login to Glide Inside Residential with your branding and your house designs. The system sends no email, so you pass the username and password on yourself.')),
      canGenerate ? h('button', { class: 'pp-btn pp-btn--primary pp-btn--lg', type: 'button', id: 'generate-account', onclick: generateDialog }, icon('plus', 18), 'Generate account') : null),
    locked ? lockedNotice : h('p', { class: 'pp-notice' }, icon('info', 18), CHARGE_NOTICE),
    reqHost,
    h('div', { class: 'pp-table-wrap' }, table), empty,
    settingsCard());
  loadRequests();
  return load();
}
