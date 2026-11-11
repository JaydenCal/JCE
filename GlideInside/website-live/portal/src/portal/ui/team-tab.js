// Team: builder staff (admin or designer). Staff logins are generated the same way as client logins and are never charged.

import { h, openDialog, confirmDialog, field, busy, toast, chip, icon, errorMessage } from './kit.js';
import { credentialsCard } from './credentials-card.js';
import { ddmmyyyy } from '../billing.js';
import { portalUrl } from '../links.js';
import { TEMP_PASSWORD_DAYS } from '../mock-api.js';

export const ROLE_TEXT = { admin: 'Admin: everything, including clients, billing, team and branding', designer: 'Designer: house designs, view clients and projects' };

export async function renderTeam(host, { api, me }) {
  const canWrite = me.permissions.includes('team.write');
  const tbody = h('tbody');
  async function load() {
    const team = await api.listTeam();
    tbody.replaceChildren(...team.map((u) => h('tr', { dataset: { id: u.id } },
      h('td', { dataset: { label: 'Name' } }, h('strong', null, u.name), u.id === me.user.id ? h('span', { class: 'pp-sub' }, ' (you)') : null, h('div', { class: 'pp-sub' }, u.username), u.email ? h('div', { class: 'pp-sub' }, u.email) : null),
      h('td', { dataset: { label: 'Role' } }, canWrite && u.id !== me.user.id ? h('select', { 'aria-label': `Role for ${u.name}`, onchange: async (e) => { try { await api.updateStaff(u.id, { role: e.target.value }); toast('Role changed.', { kind: 'ok' }); } catch (ex) { toast(errorMessage(ex), { kind: 'error' }); await load(); } } }, ['admin', 'designer'].map((r) => h('option', { value: r, selected: r === u.role }, r === 'admin' ? 'Admin' : 'Designer'))) : chip(u.role === 'admin' ? 'Admin' : 'Designer', 'neutral')),
      h('td', { dataset: { label: 'Status' } }, chip(u.status === 'active' ? 'Active' : 'Disabled', u.status === 'active' ? 'ok' : 'muted'), u.mustChangePassword && u.tempPasswordExpiresAt ? h('div', { class: 'pp-sub' }, `Temporary password expires ${ddmmyyyy(u.tempPasswordExpiresAt)}`) : null),
      h('td', { dataset: { label: 'Last sign in' } }, u.lastSignInAt ? ddmmyyyy(u.lastSignInAt) : 'Never'),
      h('td', { dataset: { label: 'AI credits' } }, `${u.ai.used} of ${u.ai.monthlyCap} used`, h('div', { class: 'pp-sub' }, `${u.ai.remaining} left`)),
      h('td', { dataset: { label: 'Actions' } }, canWrite && u.id !== me.user.id ? h('div', { class: 'pp-actions pp-actions--tight' },
        h('button', { class: 'pp-btn pp-btn--sm', type: 'button', onclick: () => reset(u) }, icon('key', 14), 'Reset password'),
        h('button', { class: 'pp-btn pp-btn--sm', type: 'button', onclick: (e) => busy(e.currentTarget, async () => { await (u.status === 'active' ? api.disableStaff(u.id) : api.enableStaff(u.id)); await load(); }) }, u.status === 'active' ? 'Disable' : 'Enable')) : null))));
  }
  function reset(u) {
    confirmDialog({ title: `Reset password for ${u.name}?`, message: 'A new temporary password is generated. The old one stops working.', confirmLabel: 'Reset password' }).then(async (ok) => {
      if (!ok) return;
      try {
        const r = await api.resetStaffPassword(u.id);
        openDialog({ title: `New password for ${u.name}`, body: credentialsCard({ ...r.credentials, who: u.name, signInUrl: portalUrl(''), expiryDays: TEMP_PASSWORD_DAYS }), footer: (d) => h('button', { class: 'pp-btn pp-btn--primary', type: 'button', onclick: () => d.close() }, 'Done') });
        await load();
      } catch (ex) {
        toast(errorMessage(ex), { kind: 'error' });
      }
    });
  }
  function generate() {
    const first = h('input', { type: 'text', maxlength: '60', required: true, autocomplete: 'off' });
    const email = h('input', { type: 'email', autocomplete: 'off' });
    const role = h('select', null, h('option', { value: 'designer' }, 'Designer'), h('option', { value: 'admin' }, 'Admin'));
    const err = h('p', { class: 'pp-error', role: 'alert', hidden: true });
    const submit = h('button', { class: 'pp-btn pp-btn--primary', type: 'button', onclick: () => busy(submit, async () => {
      try {
        const r = await api.inviteStaff({ firstName: first.value, email: email.value, role: role.value });
        d.setTitle(`Account for ${r.user.name}`);
        d.setBody(credentialsCard({ ...r.credentials, who: r.user.name, signInUrl: portalUrl(''), expiryDays: TEMP_PASSWORD_DAYS }));
        d.setFooter((x) => h('button', { class: 'pp-btn pp-btn--primary', type: 'button', onclick: () => x.close() }, 'Done'));
        await load();
      } catch (ex) {
        err.textContent = errorMessage(ex);
        err.hidden = false;
      }
    }) }, 'Generate account');
    const d = openDialog({ title: 'Generate staff account', body: h('div', { class: 'pp-form' },
      h('p', { class: 'pp-notice pp-notice--quiet' }, icon('info', 18), 'Staff logins are not charged.'),
      field('First name', () => first, { required: true }), field('Role', () => role, { required: true, hint: `${ROLE_TEXT.admin}. ${ROLE_TEXT.designer}.` }), field('Email', () => email, { hint: 'Needed for the forgot password link. Staff can also sign in with their username.' }), err),
    footer: (x) => [h('button', { class: 'pp-btn', type: 'button', onclick: () => x.close() }, 'Cancel'), submit] });
  }
  host.append(
    h('div', { class: 'pp-head' }, h('div', null, h('h2', null, 'Team'), h('p', { class: 'pp-lead pp-lead--sm' }, 'Builder staff who can sign in and manage designs. Designers cannot issue client logins or see billing.')),
      canWrite ? h('button', { class: 'pp-btn pp-btn--primary pp-btn--lg', type: 'button', onclick: generate }, icon('plus', 18), 'Generate staff account') : null),
    h('div', { class: 'pp-table-wrap' }, h('table', { class: 'pp-table pp-table--stack' }, h('thead', null, h('tr', null, ...['Name', 'Role', 'Status', 'Last sign in', 'AI credits', 'Actions'].map((t) => h('th', { scope: 'col' }, t)))), tbody)));
  return load();
}
