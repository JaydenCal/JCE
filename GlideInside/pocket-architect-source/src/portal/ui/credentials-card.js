// The "shown once" card for a generated username and password, with Copy buttons and Copy both.

import { h, icon, copyText, toast } from './kit.js';

/**
 * credentialsCard({ username, password, who, signInUrl, expiryDays })
 * Used for client logins and for staff logins.
 */
export function credentialsCard({ username, password, who = 'this person', signInUrl = '', expiryDays = 7 }) {
  const row = (label, value, id) => {
    const btn = h('button', { class: 'pp-btn pp-btn--sm', type: 'button', 'aria-label': `Copy ${label.toLowerCase()}`, onclick: async () => {
      const ok = await copyText(value);
      toast(ok ? `${label} copied.` : `Could not copy. Select the ${label.toLowerCase()} and copy it by hand.`, { kind: ok ? 'ok' : 'warn' });
      if (ok) {
        btn.replaceChildren(icon('check', 16), 'Copied');
        setTimeout(() => btn.replaceChildren(icon('copy', 16), 'Copy'), 1800);
      }
    } }, icon('copy', 16), 'Copy');
    return h('div', { class: 'pp-cred-row' }, h('span', { class: 'pp-cred-label', id: `${id}-l` }, label), h('output', { class: 'pp-cred-value', id, 'aria-labelledby': `${id}-l` }, value), btn);
  };
  const both = `Username: ${username}\nPassword: ${password}${signInUrl ? `\nSign in at: ${signInUrl}` : ''}`;
  const copyBoth = h('button', { class: 'pp-btn pp-btn--primary', type: 'button', onclick: async () => {
    const ok = await copyText(both);
    toast(ok ? 'Username and password copied.' : 'Could not copy. Select the details and copy them by hand.', { kind: ok ? 'ok' : 'warn' });
  } }, icon('copy', 16), 'Copy both');
  return h('div', { class: 'pp-cred', role: 'group', 'aria-label': `Login for ${who}` },
    h('p', { class: 'pp-cred-title' }, icon('lock', 18), `Login for ${who}`),
    row('Username', username, 'pp-cred-user'),
    row('Password', password, 'pp-cred-pass'),
    h('div', { class: 'pp-cred-actions' }, copyBoth),
    h('p', { class: 'pp-cred-note' }, h('strong', null, 'Shown once. '), `This password cannot be shown again, so copy it now. It is temporary: it must be changed at first sign in, and it stops working after ${expiryDays} days if it is not used. No email is sent, so pass these details on yourself.`));
}
