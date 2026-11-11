// Sign in, forgot password, reset, and the forced change of a temporary password.

import { h, field, busy, toast, errorMessage, icon } from './kit.js';
import { DEMO_LOGINS } from '../mock-api.js';
import { CONFIG } from '../../config.js';
import { MIN_PASSWORD_LENGTH } from '../credentials.js';
import { builderName } from '../builders.js';
import { applyBrandTheme } from '../theme-css.js';

const authShell = (title, intro, ...children) =>
  h('section', { class: 'pp-auth' }, h('div', { class: 'pp-auth-card' }, h('h1', null, title), intro ? h('p', { class: 'pp-lead' }, intro) : null, ...children));

function errorBox() {
  return h('p', { class: 'pp-error', role: 'alert', hidden: true });
}
const showError = (box, msg) => { box.textContent = msg; box.hidden = !msg; };

/** Builder and client sign in on one page. ?client=1 or ?role=client opens the client tab. ?builder=<slug> shows that builder's name, logo and colours. */
export function signInView({ api, client = false, onSignedIn, goForgot, builder = null, role = null }) {
  let mode = client || role === 'client' ? 'client' : 'builder';
  let brand = null, missing = false;
  const brandBox = h('div', { class: 'pp-brandbox', hidden: true });
  const host = h('div');
  function paintBrand() {
    brandBox.hidden = !(brand || missing);
    brandBox.replaceChildren(...(brand ? [brand.logoUrl && h('img', { class: 'pp-brandbox-logo', src: brand.logoUrl, alt: '' }), h('p', { class: 'pp-brandbox-name' }, brand.name)].filter(Boolean) : []));
  }
  function renderMissing() {
    const name = builderName(builder) || 'That builder';
    host.replaceChildren(h('div', { class: 'pp-nobuilder' },
      h('h2', null, `${name} isn\u2019t\u00a0using Glide Inside yet.`),
      mode === 'client'
        ? h('p', { class: 'pp-lead pp-lead--sm' }, 'Ask your consultant about designing with Glide Inside.')
        : h('p', { class: 'pp-lead pp-lead--sm' }, 'Builder staff can try it free for 14 days.'),
      mode === 'builder' ? h('a', { class: 'pp-btn pp-btn--primary pp-btn--block', href: `/for-builders/?builder=${encodeURIComponent(builder)}#trial` }, 'Start a free 14 day trial') : null,
      h('p', { class: 'pp-center' }, h('a', { href: '/' }, 'Choose a different builder'))));
  }
  if (builder && api.getBrand) {
    api.getBrand(builder).then((b) => { brand = b; applyBrandTheme(b.colours); paintBrand(); }, (e) => {
      if (e && (e.code === 'NOT_FOUND' || e.status === 404)) { missing = true; paintBrand(); render(); }
    });
  }
  const demo = CONFIG.portalMock ? h('details', { class: 'pp-demo' },
    h('summary', null, 'Review mode: sample logins'),
    h('p', null, 'This is a front end review build. Nothing is sent anywhere; sample data stays in this browser.'),
    h('ul', null,
      h('li', null, h('strong', null, 'Builder admin: '), h('code', null, DEMO_LOGINS.admin.identifier), ' / ', h('code', null, DEMO_LOGINS.admin.password)),
      h('li', null, h('strong', null, 'Builder designer: '), h('code', null, DEMO_LOGINS.designer.identifier), ' / ', h('code', null, DEMO_LOGINS.designer.password)),
      h('li', null, h('strong', null, 'Client: '), h('code', null, DEMO_LOGINS.client.identifier), ' / ', h('code', null, DEMO_LOGINS.client.password)))) : null;

  function render() {
    if (missing) return renderMissing();
    const err = errorBox();
    const idInput = (id) => h('input', { id, type: mode === 'builder' ? 'email' : 'text', name: 'username', autocomplete: 'username', required: true, autocapitalize: 'none', spellcheck: 'false', placeholder: mode === 'builder' ? 'you@yourbuilder.com.au' : 'sarah-4821' });
    const pwInput = (id) => h('input', { id, type: 'password', name: 'password', autocomplete: 'current-password', required: true });
    const idField = field(mode === 'builder' ? 'Email or username' : 'Username', idInput, { required: true });
    const submit = h('button', { class: 'pp-btn pp-btn--primary pp-btn--block', type: 'submit' }, 'Sign in');
    const form = h('form', { class: 'pp-form', novalidate: true, onsubmit: async (e) => {
      e.preventDefault();
      showError(err, '');
      const identifier = form.elements.username.value.trim();
      const password = form.elements.password.value;
      if (!identifier || !password) return showError(err, 'Enter your username and password.');
      await busy(submit, async () => {
        try {
          onSignedIn(await api.signIn({ identifier, password }));
        } catch (ex) {
          showError(err, errorMessage(ex));
          form.elements.password.value = '';
          form.elements.password.focus();
        }
      });
    } }, idField, field('Password', pwInput, { required: true }), err, submit,
    h('p', { class: 'pp-center' }, mode === 'builder'
      ? h('a', { href: '#forgot', onclick: (e) => { e.preventDefault(); goForgot(); } }, 'Forgot password?')
      : h('span', { class: 'pp-hint' }, 'Forgot your password? Ask your builder for a new one.')));
    const tab = (id, label) => h('button', { class: 'pp-tab', role: 'tab', type: 'button', 'aria-selected': String(mode === id), onclick: () => { mode = id; render(); } }, label);
    host.replaceChildren(
      h('div', { class: 'pp-tabs pp-tabs--auth', role: 'tablist', 'aria-label': 'Who is signing in' }, tab('builder', 'Builder login'), tab('client', 'Client login')),
      h('p', { class: 'pp-lead pp-lead--sm' }, mode === 'builder' ? 'For builder staff: manage your house designs, client logins and billing.' : 'Use the username and password your builder gave you.'),
      form,
      ...(builder && mode === 'client' ? [] : [h('div', { class: 'pp-center pp-trial-link', style: { marginTop: '16px', display: 'grid', gap: '8px' } }, h('span', { class: 'pp-hint' }, 'New builder?'), h('a', { class: 'pp-btn pp-btn--block', href: '/for-builders/#trial', dataset: { pp: 'start-trial' } }, 'Start a free 14 day trial'))]),
      ...(demo ? [demo] : []));
    form.elements.username.focus();
  }
  render();
  return authShell('Sign in to Pocket Architect', null, brandBox, host);
}

export function forgotView({ api, goBack, goReset }) {
  const err = errorBox();
  const out = h('div', { 'aria-live': 'polite' });
  const submit = h('button', { class: 'pp-btn pp-btn--primary pp-btn--block', type: 'submit' }, 'Send reset link');
  const form = h('form', { class: 'pp-form', onsubmit: async (e) => {
    e.preventDefault();
    showError(err, '');
    await busy(submit, async () => {
      try {
        const res = await api.requestPasswordReset({ identifier: form.elements.email.value });
        out.replaceChildren(h('p', { class: 'pp-ok' }, icon('check'), 'If that email address belongs to a builder login, a reset link is on its way. The link works for 1 hour.'),
          res.mock ? h('p', { class: 'pp-demo-note' }, 'Review mode: no email is sent. ', h('button', { class: 'pp-link', type: 'button', onclick: () => goReset(res.mock.token) }, 'Open the reset link')) : null);
      } catch (ex) {
        showError(err, errorMessage(ex));
      }
    });
  } }, field('Your email address', (id) => h('input', { id, type: 'email', name: 'email', autocomplete: 'email', required: true }), { required: true }), err, submit, out);
  return authShell('Forgot your password?', 'Builder staff: enter the email address on your login and we will send a link to choose a new password. Client logins are reset by your builder.', form,
    h('p', { class: 'pp-center' }, h('a', { href: '#', onclick: (e) => { e.preventDefault(); goBack(); } }, 'Back to sign in')));
}

function passwordFields() {
  return [
    field('New password', (id) => h('input', { id, type: 'password', name: 'next', autocomplete: 'new-password', minlength: String(MIN_PASSWORD_LENGTH), required: true }), { required: true, hint: `At least ${MIN_PASSWORD_LENGTH} characters. A few words with spaces works well. Common passwords are refused.` }),
    field('Type it again', (id) => h('input', { id, type: 'password', name: 'again', autocomplete: 'new-password', required: true }), { required: true }),
  ];
}

export function resetView({ api, token, goBack }) {
  const err = errorBox();
  const submit = h('button', { class: 'pp-btn pp-btn--primary pp-btn--block', type: 'submit' }, 'Save new password');
  const form = h('form', { class: 'pp-form', onsubmit: async (e) => {
    e.preventDefault();
    showError(err, '');
    const { next, again } = form.elements;
    if (next.value !== again.value) return showError(err, 'The two passwords do not match.');
    await busy(submit, async () => {
      try {
        await api.completePasswordReset({ token, newPassword: next.value });
        toast('Password changed. Sign in with the new password.', { kind: 'ok' });
        goBack();
      } catch (ex) {
        showError(err, errorMessage(ex));
      }
    });
  } }, ...passwordFields(), err, submit);
  return authShell('Choose a new password', null, form);
}

/** Shown after the first sign in with a temporary password, and nothing else works until it is done. */
export function changePasswordView({ api, me, onDone, onSignOut }) {
  const err = errorBox();
  const submit = h('button', { class: 'pp-btn pp-btn--primary pp-btn--block', type: 'submit' }, 'Save and continue');
  const form = h('form', { class: 'pp-form', onsubmit: async (e) => {
    e.preventDefault();
    showError(err, '');
    const { current, next, again } = form.elements;
    if (next.value !== again.value) return showError(err, 'The two passwords do not match.');
    await busy(submit, async () => {
      try {
        await api.changePassword({ currentPassword: current.value, newPassword: next.value });
        toast('Password changed.', { kind: 'ok' });
        onDone(await api.me());
      } catch (ex) {
        showError(err, errorMessage(ex));
      }
    });
  } },
  field('Temporary password', (id) => h('input', { id, type: 'password', name: 'current', autocomplete: 'current-password', required: true }), { required: true, hint: 'The one you were given.' }),
  ...passwordFields(), err, submit);
  return authShell(`Welcome, ${me.user.name}. Choose your own password`, 'The password you were given is temporary. Choose a new one before you continue.', form,
    h('p', { class: 'pp-center' }, h('button', { class: 'pp-link', type: 'button', onclick: onSignOut }, 'Sign out')));
}
