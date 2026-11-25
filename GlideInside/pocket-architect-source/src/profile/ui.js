// Free profile screens: the friendly save prompt, create profile and sign in, My designs, your profile (email preferences, password, delete),
// the top bar buttons and the "Saved" status. Plain words, no dashes, never a hard stop: the tool works the same without a profile.

import { h, clear } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { openModal, askConfirm } from '../ui/modal.js';
import { toast } from '../ui/toast.js';
import { track, isStandalonePage } from '../ui/analytics.js';
import { isPhoneMode } from '../phone/mode.js';
import { projectToSvg, svgDataUri } from '../portal/thumbnail.js';
import { passwordProblem } from '../portal/credentials.js';
import { ddmmyyyyOf } from '../ui/cloud.js';
import { ProfileError } from './api.js';
import { MARKETING_TEXT, MARKETING_TEXT_VERSION, SAVE_INCLUDED_TEXT, SAVE_CARD_TEXT, passwordStrength } from './wording.js';

const STYLE = `
.ps-prof-btn .ps-prof-dot{display:none}
.ps-prof-btn[data-state="in"] .ps-prof-dot{display:inline-block;width:7px;height:7px;border-radius:50%;background:var(--ps-ok);margin-left:2px}
.ps-prof-save-text{display:inline;font-weight:600}.ps-shell .ps-topbar .ps-btn.ps-prof-save{height:40px;padding:0 16px!important;margin-right:16px;border-radius:8px;background:#1f7a4d!important;border-color:#1f7a4d!important;color:#fff!important;font-size:15px;gap:6px}.ps-shell .ps-topbar .ps-btn.ps-prof-save:hover{background:#18643f!important}.ps-shell .ps-topbar .ps-btn.ps-prof-save .ps-icon{color:#fff}.ps-shell .ps-topbar .ps-prof-save:has(.ps-prof-save-text){width:auto;padding:0 11px}
@media (min-width:1700px){.ps-shell .ps-topbar .ps-prof-save .ps-prof-save-text{display:inline}.ps-shell .ps-topbar .ps-prof-save:has(.ps-prof-save-text){width:auto;padding:0 11px}}
/* In the guided flow the offer is an inline card between the step and the Back / Next bar: it never covers the fit card or the facts. */
.gf-root>.ps-prof-prompt{position:relative;left:auto;top:auto;bottom:auto;right:auto;transform:none;z-index:auto;flex:none;width:auto;max-width:640px;margin:0 20px 10px;align-self:flex-start;animation:none}
@media (max-width:640px){.gf-root>.ps-prof-prompt{margin:0 12px 8px;align-self:stretch;max-width:none;padding:10px 12px}.gf-root>.ps-prof-prompt p{margin:0 0 8px;font-size:13px}}
.ps-prof-prompt{position:absolute;left:50%;top:64px;transform:translateX(-50%);z-index:40;width:min(380px,calc(100% - 32px));padding:14px 14px 12px;background:var(--ps-panel);color:var(--ps-text);border:1px solid var(--ps-border-strong);border-left:4px solid var(--ps-accent);border-radius:var(--ps-radius-lg);box-shadow:var(--ps-shadow,0 6px 24px rgba(0,0,0,.2));animation:ps-toast-in .18s ease-out}
.ps-prof-prompt h2{margin:0 0 4px;font-size:16px;font-weight:600}
.ps-prof-prompt p{margin:0 0 10px;font-size:14px;color:var(--ps-muted)}
.ps-prof-prompt .ps-prof-actions{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.ps-prof-prompt .ps-prof-x{position:absolute;top:6px;right:6px}
.ps-prof-tabs{display:flex;gap:4px;margin:0 0 12px;border-bottom:1px solid var(--ps-border)}
.ps-prof-tab{padding:8px 12px;border:0;border-bottom:2px solid transparent;background:transparent;color:var(--ps-muted);font-weight:600;font-size:14px}
.ps-prof-tab[aria-selected="true"]{color:var(--ps-text);border-bottom-color:var(--ps-accent)}
.ps-prof-form{display:grid;gap:10px}
.ps-prof-intro{margin:0 0 12px;font-size:14px;line-height:1.45;color:var(--ps-text)}
.ps-prof-form label.ps-prof-lab{display:block;font-size:13px;font-weight:600;margin:0 0 3px}
.ps-prof-form .ps-prof-opt{font-weight:400;color:var(--ps-muted)}
.ps-prof-form .ps-input,.ps-prof-form .ps-select{width:100%}
.ps-prof-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}
@media (max-width:520px){.ps-prof-grid{grid-template-columns:1fr}}
.ps-prof-pw{display:flex;gap:6px}
.ps-prof-pw .ps-input{flex:1;min-width:0}
.ps-prof-meter{display:flex;gap:3px;margin:6px 0 0}
.ps-prof-meter i{flex:1;height:4px;border-radius:2px;background:var(--ps-border)}
.ps-prof-meter[data-score="1"] i:nth-child(-n+1){background:var(--ps-danger)}
.ps-prof-meter[data-score="2"] i:nth-child(-n+2){background:var(--ps-warning)}
.ps-prof-meter[data-score="3"] i:nth-child(-n+3){background:var(--ps-ok)}
.ps-prof-meter[data-score="4"] i{background:var(--ps-ok)}
.ps-prof-check{display:flex;gap:8px;align-items:flex-start;font-size:13px;line-height:1.4}
.ps-prof-check input{margin-top:2px;flex:0 0 auto}
.ps-prof-err{margin:0;padding:8px 10px;background:var(--ps-danger-soft);color:var(--ps-danger);border-radius:var(--ps-radius);font-size:13px}
.ps-prof-err[hidden]{display:none}
.ps-prof-note{margin:0;font-size:13px;color:var(--ps-muted)}
.ps-prof-list{list-style:none;margin:0;padding:0;display:grid;gap:8px}
.ps-prof-row{display:grid;grid-template-columns:96px minmax(0,1fr);gap:12px;align-items:start;padding:8px;background:var(--ps-field);border:1px solid var(--ps-border);border-radius:var(--ps-radius)}
.ps-prof-thumb{width:96px;height:60px;border-radius:var(--ps-radius-sm);background:var(--ps-panel-2);border:1px solid var(--ps-border);object-fit:cover;display:grid;place-items:center;color:var(--ps-faint);font-size:11px}
.ps-prof-meta{display:flex;gap:8px;flex-wrap:wrap;align-items:center;font-size:13px;color:var(--ps-muted);margin:2px 0 6px}
.ps-prof-name{font-weight:600;font-size:15px;color:var(--ps-text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ps-prof-row .ps-prof-actions{display:flex;gap:6px;flex-wrap:wrap}
.ps-prof-count{display:flex;justify-content:space-between;gap:8px;align-items:center;flex-wrap:wrap;margin:0 0 10px;font-size:13px;color:var(--ps-muted)}
.ps-prof-sec{padding:12px 0;border-top:1px solid var(--ps-border)}
.ps-prof-sec:first-child{border-top:0;padding-top:0}
.ps-prof-sec h3{margin:0 0 6px;font-size:14px;font-weight:600}
.ps-prof-status{display:inline-flex;gap:6px;align-items:center;white-space:nowrap}
.ps-prof-status[data-state="error"],.ps-prof-status[data-state="limit"]{color:var(--ps-danger)}
.ps-prof-status button{border:0;background:transparent;color:inherit;text-decoration:underline;padding:0;font:inherit}
@media (max-width:599.98px){.ps-prof-prompt{right:8px;left:8px;width:auto;transform:none;top:56px}}
/* The small save card (a house placed on the person's own lot): phone tool, home page viewer and the phone editor. Sits above the bottom bar, never over the lot card. */
.ps-prof-card{top:auto;bottom:14px;left:14px;transform:none;width:min(340px,calc(100% - 28px));padding:10px 12px 8px;border-left-width:4px}
.ps-prof-card h2{margin:0 0 2px;font-size:15px}
.ps-prof-card p{margin:0 0 8px;font-size:13px;line-height:1.35}
.ps-prof-card-row{display:flex;gap:8px;align-items:stretch}
.ps-prof-card-row .ps-input{flex:1;min-width:0;height:44px;font-size:16px}
.ps-prof-card-row .ps-btn{height:44px;min-width:76px;padding:0 18px}
.ps-prof-card-err{margin:6px 0 0;font-size:12px;color:var(--ps-danger)}
.ps-prof-card-err[hidden]{display:none}
.ps-prof-card .ps-prof-nn{margin:2px 0 0;min-height:44px;min-width:88px;padding:0 6px;font-size:13px}
@media (max-width:640px){.ps-prof-card{left:8px;right:8px;width:auto;bottom:12px}}
html[data-phone="1"] .ps-shell>.ps-prof-card{bottom:76px}
.ps-stage>.ps-prof-card{position:absolute;z-index:45}
.ps-prof-card:focus{outline:none}
@media (min-width:701px){.ps-stage>.ps-prof-card{left:56%;bottom:84px;transform:translateX(-50%);width:min(320px,calc(100% - 28px))}}
html[data-phone="1"] .ps-stage:has(.lc-root.is-phone:not([hidden]))>.ps-prof-card{bottom:122px}
.ps-stage:has(.lc-card.is-open)>.ps-prof-card{display:none}
`;

function ensureStyle() {
  if (document.getElementById('ps-profile-style')) return;
  const s = h('style', { id: 'ps-profile-style' });
  s.textContent = STYLE;
  document.head.append(s);
}

const clock = (t) => new Date(t).toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' });
const siteUrl = (config, which, fallback) => {
  const given = config.links?.[which];
  if (given) return given;
  try {
    return new URL(fallback, document.baseURI).href;
  } catch {
    return fallback;
  }
};
const contactEmail = () => (typeof window !== 'undefined' && window.GI_CONFIG?.email) || 'hello@glideinside.com.au';

/** Plain words for a failed profile call. Never says whether an email has a profile. */
export function profileErrorText(e, fallback = 'Something went wrong. Try again.') {
  if (!(e instanceof ProfileError)) return fallback;
  if (e.code === 'NETWORK' || e.code === 'TIMEOUT') return e.message;
  if (e.code === 'SERVER_UNAVAILABLE') return 'Profiles are not available right now. Your design is still saved in this browser.';
  if (e.code === 'RATE_LIMITED') {
    const min = e.retryAfter ? Math.max(1, Math.ceil(e.retryAfter / 60)) : null;
    return `Too many attempts. ${min ? `Try again in about ${min} ${min === 1 ? 'minute' : 'minutes'}.` : 'Please wait a few minutes and try again.'}`;
  }
  return e.message || fallback;
}

/** A small plan picture for the My designs list: a drawing of the lowest level (it fits the plan to the picture), or the plan canvas when the design has no rooms or walls (a commercial layout). */
export async function makeThumbnail(project, planHost) {
  const W = 240;
  const H = 150;
  const lvl = project?.levels?.[0];
  if (lvl && (lvl.rooms?.length || lvl.walls?.length)) {
    try {
      const svg = projectToSvg(project, { width: W, height: H });
      const img = new Image();
      await new Promise((res, rej) => {
        img.onload = res;
        img.onerror = rej;
        img.src = svgDataUri(svg);
        setTimeout(rej, 1500);
      });
      const out = h('canvas', { width: W, height: H });
      out.getContext('2d').drawImage(img, 0, 0, W, H);
      const url = out.toDataURL('image/jpeg', 0.72);
      if (url.length < 58000) return url;
    } catch {
      /* fall through to the canvas */
    }
  }
  try {
    const c = planHost?.querySelector?.('canvas');
    if (c && c.width > 20 && c.height > 20 && c.offsetParent !== null) {
      const out = h('canvas', { width: W, height: H });
      const g = out.getContext('2d');
      g.fillStyle = '#ffffff';
      g.fillRect(0, 0, W, H);
      const k = Math.min(W / c.width, H / c.height);
      g.drawImage(c, (W - c.width * k) / 2, (H - c.height * k) / 2, c.width * k, c.height * k);
      const url = out.toDataURL('image/jpeg', 0.72);
      if (url.length < 58000) return url;
    }
  } catch {
    /* a tainted canvas (aerial from another site) cannot be read */
  }
  return null;
}

const glyph = (inner) => h('span', { class: 'ps-prof-ico', style: { display: 'inline-flex' }, html: `<svg class="ps-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>` });
// Drawn here so they do not look like the Save (download) and Open (folder) buttons beside them.
const GLYPH = {
  saveProfile: '<circle cx="10" cy="8.5" r="3.4"/><path d="M3.5 20c.8-3.4 3.3-5.2 6.5-5.2 1.4 0 2.6.3 3.6.9M18 13v6M15 16h6"/>',
  designs: '<rect x="4" y="6" width="12" height="14" rx="1.2"/><path d="M8 3.5h10a2 2 0 0 1 2 2V16M7.5 11h5M7.5 14.5h5"/>',
  person: '<circle cx="12" cy="8.5" r="3.6"/><path d="M5 20c.8-3.6 3.6-5.4 7-5.4s6.2 1.8 7 5.4"/>',
};

export function initProfileUi({ app, controller, policy, refs, store, config, otherAccount, viewer = false }) {
  ensureStyle();
  const termsUrl = siteUrl(config, 'terms', '../../terms.html');
  const privacyUrl = siteUrl(config, 'privacy', '../../privacy.html');
  let prompt = null;
  let modal = null;

  // Top bar -------------------------------------------------------------------------------------------------------------------
  const anchor = refs.topbar?.querySelector('[data-action="share"]') || refs.topbar?.querySelector('[data-action="save"]');
  const saveBtn = h('button', { class: 'ps-btn ps-prof-btn ps-prof-save', type: 'button', title: 'Save this design to your profile. Saving is included, no payment needed.', 'aria-label': 'Save design', dataset: { action: 'profile-save' }, onclick: () => onSaveClick() },
    glyph(GLYPH.saveProfile), h('span', { class: 'ps-btn-text ps-prof-save-text' }, 'Save design'));
  const saveText = saveBtn.querySelector('.ps-prof-save-text');
  let savedTimer = null;
  async function onSaveClick() {
    if (controller.state.status !== 'in') { policy.openFromButton(); return; }
    if (controller.state.saveState === 'limit') {
      // The count may have dropped since the limit was hit (a design deleted here or in another tab): check before showing the full message.
      try { await controller.listDesigns(); } catch { /* keep the limit state */ }
      if (controller.state.saveState === 'limit') { openLimit(); return; }
    }
    saveText.textContent = 'Saving';
    let r = null;
    try { r = await controller.saveNow(); } catch { r = null; }
    if (r && r.ok === false && r.code === 'DESIGN_LIMIT_REACHED') { saveText.textContent = 'Profile full'; openLimit(); return; }
    saveText.textContent = r && r.ok === false ? 'Not saved' : 'Saved';
    clearTimeout(savedTimer);
    savedTimer = setTimeout(() => { saveText.textContent = 'Save design'; }, 2500);
  }
  const designsBtn = h('button', { class: 'ps-btn ps-prof-btn', type: 'button', title: 'My designs', 'aria-label': 'My designs', dataset: { action: 'my-designs' }, onclick: () => openDesigns() }, glyph(GLYPH.designs), h('span', { class: 'ps-btn-text' }, 'My designs'));
  const accountBtn = h('button', { class: 'ps-btn ps-prof-btn', type: 'button', title: 'Your profile', 'aria-label': 'Your profile', dataset: { action: 'profile-account', state: 'in' }, onclick: () => openAccount() }, glyph(GLYPH.person), h('i', { class: 'ps-prof-dot' }));
  if (!viewer) { if (anchor) anchor.after(designsBtn, accountBtn); else refs.topbar?.append(designsBtn, accountBtn); }
  // The big Save design button sits on the right beside Exports and Unlock (owner 15/11/2026), so it is easy to find.
  const placeSave = () => {
    const ex = refs.topbar?.querySelector('.psp-bar .psp-menu-wrap');
    if (ex) ex.before(saveBtn);
    else if (!saveBtn.isConnected) (anchor ? anchor.after(saveBtn) : refs.topbar?.append(saveBtn));
  };
  if (!viewer) {
    placeSave();
    if (!refs.topbar?.querySelector('.psp-bar')) setTimeout(placeSave, 0), setTimeout(placeSave, 800);
  }

  // Status bar ------------------------------------------------------------------------------------------------------------------
  const statusText = h('span', { class: 'ps-prof-status', role: 'status', 'aria-live': 'polite', dataset: { role: 'profile-status' } });
  statusText.hidden = true;
  const localSaved = refs.statusbar?.querySelector('.ps-autosave');
  if (!viewer) { if (localSaved) localSaved.before(statusText); else refs.statusbar?.append(statusText); }

  function renderStatus() {
    const s = controller.state;
    statusText.hidden = s.status !== 'in';
    if (s.status !== 'in') return;
    statusText.dataset.state = s.saveState;
    clear(statusText);
    if (s.saveState === 'saving') statusText.append('Saving to profile');
    else if (s.saveState === 'saved') statusText.append(`Saved to profile ${s.savedAt ? clock(s.savedAt) : ''}`.trim());
    else if (s.saveState === 'limit') statusText.append(`Not saved. Your profile is full (${s.limit} ${s.limit === 1 ? 'design' : 'designs'}). `, h('button', { type: 'button', dataset: { action: 'status-my-designs' }, onclick: () => openDesigns() }, 'Open My designs'), ' or ', h('button', { type: 'button', dataset: { action: 'status-save-file' }, onclick: () => saveToFile() }, 'Save to file'));
    else if (s.saveState === 'error') statusText.append(s.message || 'Not saved to your profile yet');
    else statusText.append('Not saved to your profile yet. ', h('button', { type: 'button', dataset: { action: 'status-save-now' }, onclick: () => onSaveClick() }, 'Save design'));
    statusText.title = s.message || '';
    if (s.saveState === 'limit') saveText.textContent = 'Profile full';
    else if (saveText.textContent === 'Profile full') saveText.textContent = 'Save design';
  }

  /** The profile is at its limit: say so plainly, with one click to My designs and the file save right there. Never a payment step. */
  function limitText() {
    return `Your profile is full (${controller.state.limit} ${controller.state.limit === 1 ? 'design' : 'designs'}). Delete an old design in My designs to save this one, or use Save to file.`;
  }
  function saveToFile() {
    const b = refs.topbar?.querySelector('[data-action="save"]');
    if (b) b.click();
  }
  function openLimit() {
    if (document.querySelector('[data-role="profile-limit"]')) return;
    openModal({
      title: 'Your profile is full', size: 'sm',
      body: h('p', { dataset: { role: 'profile-limit' }, style: { margin: 0 } }, limitText()),
      footer: (close) => [
        h('button', { class: 'ps-btn', type: 'button', dataset: { action: 'limit-save-file' }, onclick: () => { close('file'); saveToFile(); } }, 'Save to file'),
        h('button', { class: 'ps-btn ps-btn--primary', type: 'button', dataset: { action: 'limit-my-designs' }, onclick: () => { close('designs'); openDesigns(); } }, 'Open My designs')],
    });
  }

  function refresh() {
    const s = controller.state;
    const off = s.status === 'unavailable' || s.status === 'loading' || otherAccount();
    saveBtn.hidden = off;
    designsBtn.hidden = off || s.status !== 'in';
    accountBtn.hidden = off || s.status !== 'in';
    if (off) {
      closePrompt();
      statusText.hidden = true;
    } else renderStatus();
  }
  const offState = controller.subscribe(() => { refresh(); });
  const offUi = store.on('ui', (patch = {}) => { if ('premium' in patch) refresh(); });
  refresh();

  // The prompt (non blocking) --------------------------------------------------------------------------------------------------
  function closePrompt() {
    document.removeEventListener('keydown', onPromptKey, true);
    window.removeEventListener('keydown', onPromptKey, true);
    prompt?.remove();
    prompt = null;
    policy.closed();
  }
  // The small card (email and Save) goes with the moment a house is placed on a lot or the first edit on a phone, and always in the lot viewer.
  const useCard = (reason) => viewer || ((reason === 'placed' || reason === 'edit') && isPhoneMode());
  function showPrompt(reason) {
    if (prompt) return;
    if (isPhoneMode()) return; // phones never see the Save your design card (owner 25/11/2026): the email is asked for at the free plans step. Desktop keeps it.
    const card = useCard(reason);
    track('ps_profile_prompt', { reason, card: card ? 'compact' : 'full' });
    const title = h('h2', { id: 'ps-prof-prompt-title' }, 'Save your design');
    if (card) {
      const email = h('input', { class: 'ps-input', type: 'email', name: 'email', autocomplete: 'email', inputmode: 'email', maxlength: '254', placeholder: 'Your email', 'aria-label': 'Email address', dataset: { role: 'card-email' } });
      const err = h('p', { class: 'ps-prof-card-err', role: 'alert', hidden: true });
      const row = h('form', { class: 'ps-prof-card-row', novalidate: true, onsubmit: (ev) => {
        ev.preventDefault();
        const value = email.value.trim();
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value)) { err.textContent = 'Enter a valid email address.'; err.hidden = false; email.focus(); return; }
        closePrompt();
        openAuth('create', { purpose: 'save', email: value }); // the free profile dialog, with the email filled in
      } }, email, h('button', { class: 'ps-btn ps-btn--primary', type: 'submit', dataset: { action: 'card-save' } }, 'Save'));
      prompt = h('section', { class: 'ps-prof-prompt ps-prof-card', role: 'region', 'aria-labelledby': 'ps-prof-prompt-title', dataset: { role: 'profile-prompt', reason, variant: 'card' } },
        title, h('p', null, SAVE_CARD_TEXT), row, err,
        h('button', { class: 'ps-btn ps-btn--ghost ps-prof-nn', type: 'button', dataset: { action: 'prompt-notnow' }, onclick: () => notNow() }, 'Not now'));
      placePrompt();
      return;
    }
    prompt = h('section', { class: 'ps-prof-prompt', role: 'region', 'aria-labelledby': 'ps-prof-prompt-title', dataset: { role: 'profile-prompt', reason } },
      h('button', { class: 'ps-btn ps-btn--ghost ps-btn--icon ps-prof-x', type: 'button', 'aria-label': 'Not now', onclick: () => notNow() }, icon('close', { size: 16 })),
      title,
      h('p', null, reason === 'leave' ? 'Your design is only in this browser. Saving it to your profile keeps it safe and lets you open it on any device. No payment or card needed.' : SAVE_INCLUDED_TEXT),
      h('div', { class: 'ps-prof-actions' },
        h('button', { class: 'ps-btn ps-btn--primary', type: 'button', dataset: { action: 'prompt-create' }, onclick: () => { closePrompt(); openAuth('create'); } }, 'Create profile'),
        h('button', { class: 'ps-btn', type: 'button', dataset: { action: 'prompt-signin' }, onclick: () => { closePrompt(); openAuth('signin'); } }, 'Sign in'),
        h('button', { class: 'ps-btn ps-btn--ghost', type: 'button', dataset: { action: 'prompt-notnow' }, onclick: () => notNow() }, 'Not now')));
    placePrompt();
  }
  function placePrompt() {
    // Inside the guided flow (Check it step) the prompt stands above the flow, in the page itself.
    const flowRoot = document.documentElement.classList.contains('gf-open') ? document.querySelector('.gf-root:not([hidden])') : null;
    const flowFoot = flowRoot?.querySelector(':scope > .gf-foot');
    if (flowRoot && flowFoot) {
      flowFoot.before(prompt);
      // When the flow closes the card goes on into the editor, where it stands under the top bar as before.
      const mo = new MutationObserver(() => {
        if (!prompt) { mo.disconnect(); return; }
        if (!document.documentElement.classList.contains('gf-open')) { (refs.shell || document.body).append(prompt); mo.disconnect(); }
      });
      mo.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    } else if (viewer) (refs.stage || refs.shell || document.body).append(prompt);
    else (refs.shell || document.body).append(prompt);
    document.addEventListener('keydown', onPromptKey, true);
    window.addEventListener('keydown', onPromptKey, true);
    // Focus belongs to the prompt while it is open: a leftover onboarding button must not keep it (Escape then goes to the prompt).
    try {
      if (!isStandalonePage()) return; // inside a frame the host page keeps the focus
      const ae = document.activeElement;
      if (!ae || ae === document.body || ae.closest?.('.pso-card, .pso-dock, .pso-pop, [class*="pso-"]')) { prompt.tabIndex = -1; prompt.focus({ preventScroll: true }); }
    } catch { /* focus is a convenience */ }
  }
  // Escape closes the prompt like Not now (unless a dialog is open on top of it, which takes Escape for itself).
  function onPromptKey(e) {
    if (e.key !== 'Escape') return;
    if (!prompt) { document.removeEventListener('keydown', onPromptKey, true); window.removeEventListener('keydown', onPromptKey, true); return; }
    if (document.querySelector('.ps-modal')) return;
    e.stopPropagation();
    notNow();
  }
  function notNow() {
    document.removeEventListener('keydown', onPromptKey, true);
    window.removeEventListener('keydown', onPromptKey, true);
    prompt?.remove();
    prompt = null;
    policy.dismiss();
  }

  // Create profile and sign in ---------------------------------------------------------------------------------------------------
  let authClosed = null;
  let accountWait = null;
  function openAuth(initial = 'create', { purpose = 'save', email: prefill = '' } = {}) {
    if (modal) modal.close('replace');
    let tab = initial;
    const body = h('div');
    const handle = openModal({ title: initial === 'signin' ? 'Sign in' : purpose === 'save' ? 'Save your design' : 'Create your profile', size: 'sm', body, onClose: () => { modal = null; authClosed?.(); } });
    modal = handle;
    const title = handle.el.querySelector('.ps-modal-head h2');

    const err = h('p', { class: 'ps-prof-err', role: 'alert', hidden: true });
    const showErr = (m) => { err.textContent = m || ''; err.hidden = !m; };
    const busy = (btn, on, label) => { btn.disabled = on; btn.textContent = on ? 'One moment' : label; };
    const field = (label, input, { optional = false, id, hint } = {}) => h('div', null,
      h('label', { class: 'ps-prof-lab', for: id }, label, optional ? h('span', { class: 'ps-prof-opt' }, ' (optional)') : null), input, hint || null);

    function pwBox(id, autocomplete) {
      const input = h('input', { class: 'ps-input', id, type: 'password', autocomplete, maxlength: '200', required: true });
      const show = h('button', { class: 'ps-btn', type: 'button', 'aria-pressed': 'false', onclick: () => {
        const on = input.type === 'password';
        input.type = on ? 'text' : 'password';
        show.setAttribute('aria-pressed', String(on));
        show.textContent = on ? 'Hide' : 'Show';
      } }, 'Show');
      return { input, row: h('div', { class: 'ps-prof-pw' }, input, show) };
    }

    function createForm() {
      const name = h('input', { class: 'ps-input', id: 'ps-prof-name', type: 'text', autocomplete: 'name', maxlength: '80', required: true });
      const email = h('input', { class: 'ps-input', id: 'ps-prof-email', type: 'email', autocomplete: 'email', maxlength: '254', required: true });
      if (prefill) email.value = String(prefill).slice(0, 254);
      const pw = pwBox('ps-prof-pw', 'new-password');
      const meter = h('div', { class: 'ps-prof-meter', 'aria-hidden': 'true', dataset: { score: '0' } }, h('i'), h('i'), h('i'), h('i'));
      const PW_HINT = 'At least 10 characters.';
      const hint = h('p', { class: 'ps-prof-note', id: 'ps-prof-pw-hint', style: { marginTop: '4px' } }, PW_HINT);
      pw.input.setAttribute('aria-describedby', 'ps-prof-pw-hint');
      pw.input.addEventListener('input', () => {
        const v = pw.input.value;
        const st = passwordStrength(v);
        meter.dataset.score = String(st.score);
        const problem = v ? passwordProblem(v, { email: email.value }) : null;
        hint.textContent = !v ? PW_HINT : problem || `Strength: ${st.label}.`;
      });
      const terms = h('input', { type: 'checkbox', id: 'ps-prof-terms', required: true }); // one tick covers the site terms and the privacy policy
      const marketing = h('input', { type: 'checkbox', id: 'ps-prof-mk', dataset: { version: MARKETING_TEXT_VERSION } }); // unticked by default (Spam Act)
      const submit = h('button', { class: 'ps-btn ps-btn--primary', type: 'submit', dataset: { action: 'create-submit' } }, 'Create profile');
      const form = h('form', { class: 'ps-prof-form', novalidate: true, autocomplete: 'on' },
        field('Name', name, { id: 'ps-prof-name' }),
        field('Email', email, { id: 'ps-prof-email' }),
        field('Password', pw.row, { id: 'ps-prof-pw', hint: h('div', null, meter, hint) }),
        h('label', { class: 'ps-prof-check', for: 'ps-prof-terms' }, terms, h('span', null, 'I accept the ', h('a', { href: termsUrl, target: '_blank', rel: 'noopener' }, 'site terms'), ' and ', h('a', { href: privacyUrl, target: '_blank', rel: 'noopener' }, 'privacy policy'), '.')),
        h('label', { class: 'ps-prof-check', for: 'ps-prof-mk' }, marketing, h('span', null, MARKETING_TEXT)),
        err, submit,
        h('p', { class: 'ps-prof-note' }, 'No email is sent when you create a profile.'));
      form.addEventListener('submit', async (ev) => {
        ev.preventDefault();
        showErr('');
        if (!name.value.trim()) return showErr('Enter your name.'), name.focus();
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.value.trim())) return showErr('Enter a valid email address.'), email.focus();
        const problem = passwordProblem(pw.input.value, { email: email.value });
        if (problem) return showErr(problem), pw.input.focus();
        if (!terms.checked) return showErr('Please accept the site terms and privacy policy to save your design.');
        busy(submit, true);
        try {
          const out = await controller.signUp({
            name: name.value.trim(), email: email.value.trim(), password: pw.input.value,
            acceptTerms: true, acceptPrivacy: true, marketing: marketing.checked,
          });
          pw.input.value = '';
          track('ps_profile_signup', { marketing: marketing.checked });
          handle.close('done');
          toast(out.saved?.ok ? 'Profile created. Your design is saved to it.' : 'Profile created.', { kind: 'ok' });
        } catch (e) {
          showErr(profileErrorText(e));
          busy(submit, false, 'Create profile');
        }
      });
      return form;
    }

    function signInForm() {
      const email = h('input', { class: 'ps-input', id: 'ps-prof-in-email', type: 'email', autocomplete: 'email', maxlength: '254', required: true });
      const pw = pwBox('ps-prof-in-pw', 'current-password');
      const submit = h('button', { class: 'ps-btn ps-btn--primary', type: 'submit', dataset: { action: 'signin-submit' } }, 'Sign in');
      // TODO(email): a reset link by email needs a mail provider, which is not connected. Until then people contact us.
      const form = h('form', { class: 'ps-prof-form', novalidate: true },
        field('Email', email, { id: 'ps-prof-in-email' }), field('Password', pw.row, { id: 'ps-prof-in-pw' }), err, submit,
        h('p', { class: 'ps-prof-note' }, 'Forgot your password? ', h('a', { href: `mailto:${contactEmail()}?subject=Glide%20Inside%20profile%20help` }, 'Contact us'), ' and we will help you get back in.'));
      form.addEventListener('submit', async (ev) => {
        ev.preventDefault();
        showErr('');
        if (!email.value.trim() || !pw.input.value) return showErr('Enter your email and password.');
        busy(submit, true);
        try {
          const out = await controller.signIn({ email: email.value.trim(), password: pw.input.value });
          pw.input.value = '';
          track('ps_profile_signin');
          handle.close('done');
          toast(out.saved?.ok ? 'Signed in. Your design is saved to your profile.' : 'Signed in.', { kind: 'ok' });
        } catch (e) {
          showErr(profileErrorText(e));
          busy(submit, false, 'Sign in');
        }
      });
      return form;
    }

    function paint() {
      showErr('');
      title.textContent = tab === 'signin' ? 'Sign in' : purpose === 'save' ? 'Save your design' : 'Create your profile';
      const tabs = h('div', { class: 'ps-prof-tabs', role: 'tablist' },
        ...[['create', 'Create profile'], ['signin', 'Sign in']].map(([id, label]) => h('button', { class: 'ps-prof-tab', type: 'button', role: 'tab', 'aria-selected': String(tab === id), dataset: { tab: id }, onclick: () => { tab = id; paint(); } }, label)));
      clear(body);
      body.append(tabs, tab === 'signin' ? signInForm() : h('div', null, h('p', { class: 'ps-prof-intro', dataset: { role: 'save-included' } }, purpose === 'save' ? SAVE_INCLUDED_TEXT : 'A profile is included. No payment or card needed.'), createForm()));
      setTimeout(() => body.querySelector('input')?.focus({ preventScroll: true }), 0);
    }
    paint();
    return handle;
  }

  // My designs ------------------------------------------------------------------------------------------------------------------
  async function openDesigns() {
    if (controller.state.status !== 'in') return openAuth('signin');
    const body = h('div', { dataset: { role: 'my-designs' } });
    const handle = openModal({ title: 'My designs', size: 'lg', sheet: true, body, footer: (close) => h('button', { class: 'ps-btn', type: 'button', onclick: () => close('done') }, 'Close') });
    const msg = h('p', { class: 'ps-hint', role: 'status', 'aria-live': 'polite' }, 'Loading');
    body.append(msg);
    let data;
    const load = async () => {
      try {
        data = await controller.listDesigns();
        paint();
      } catch (e) {
        clear(body);
        body.append(h('p', { class: 'ps-prof-err', role: 'alert' }, profileErrorText(e, 'Your designs could not be loaded.')));
      }
    };
    const act = async (fn, okMsg) => {
      try {
        await fn();
        if (okMsg) toast(okMsg, { kind: 'ok' });
        await load();
      } catch (e) {
        toast(profileErrorText(e), { kind: 'warn', timeout: 7000 });
      }
    };

    async function open(d) {
      if (['error', 'limit'].includes(controller.state.saveState) && !(await askConfirm({ title: 'Open this design?', message: 'The design on screen could not be saved to your profile. Opening another design replaces it. Use Save to keep a file first if you want it.', confirmLabel: 'Open design', danger: true }))) return;
      try {
        await controller.openDesign(d.id, { replaceProject: (p) => app.replaceProject(p) });
        handle.close('opened');
        toast(`Opened ${d.name}.`, { kind: 'ok' });
      } catch (e) {
        toast(profileErrorText(e, 'That design could not be opened.'), { kind: 'warn', timeout: 7000 });
      }
    }

    function rename(d, nameEl, actions) {
      const input = h('input', { class: 'ps-input', type: 'text', maxlength: '80', value: d.name, 'aria-label': 'Design name' });
      const save = h('button', { class: 'ps-btn ps-btn--primary ps-btn--sm', type: 'button', onclick: () => commit() }, 'Save name');
      const cancel = h('button', { class: 'ps-btn ps-btn--sm', type: 'button', onclick: () => load() }, 'Cancel');
      const commit = () => {
        const v = input.value.trim();
        if (!v) return;
        // The open design keeps its own name field: rename it there too when it is the one on screen.
        if (store.project.id === d.projectId) {
          try { store.run('set_project', { name: v }); } catch { /* the saved copy is renamed anyway */ }
        }
        act(() => controller.renameDesign(d.id, v), 'Renamed.');
      };
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') commit(); else if (e.key === 'Escape') load(); });
      nameEl.replaceWith(input);
      clear(actions);
      actions.append(save, cancel);
      input.focus();
      input.select();
    }

    function row(d) {
      const nameEl = h('div', { class: 'ps-prof-name', title: d.name }, d.name);
      const actions = h('div', { class: 'ps-prof-actions' },
        h('button', { class: 'ps-btn ps-btn--primary ps-btn--sm', type: 'button', dataset: { action: 'open-design' }, onclick: () => open(d) }, 'Open'),
        h('button', { class: 'ps-btn ps-btn--sm', type: 'button', dataset: { action: 'rename-design' }, onclick: () => rename(d, nameEl, actions) }, 'Rename'),
        h('button', { class: 'ps-btn ps-btn--sm', type: 'button', dataset: { action: 'duplicate-design' }, onclick: () => act(() => controller.duplicateDesign(d.id), 'Copy made.') }, 'Duplicate'),
        h('button', { class: 'ps-btn ps-btn--danger ps-btn--sm', type: 'button', dataset: { action: 'delete-design' }, onclick: async () => {
          if (await askConfirm({ title: 'Delete this design?', message: `"${d.name}" will be removed from your profile. This cannot be undone.`, confirmLabel: 'Delete design', danger: true })) act(() => controller.removeDesign(d.id), 'Design deleted.');
        } }, 'Delete'));
      return h('li', { class: 'ps-prof-row', dataset: { design: d.id } },
        d.thumbnail ? h('img', { class: 'ps-prof-thumb', src: d.thumbnail, alt: '', width: 96, height: 60 }) : h('div', { class: 'ps-prof-thumb', 'aria-hidden': 'true' }, 'No picture'),
        h('div', { style: { minWidth: 0 } }, nameEl,
          h('div', { class: 'ps-prof-meta' }, h('span', { class: 'ps-tag' }, d.kind === 'commercial' ? 'Commercial' : 'Residential'), h('span', null, d.address || 'No address'), h('span', null, ddmmyyyyOf(d.updatedAt))),
          actions));
    }

    function paint() {
      clear(body);
      const full = data.count >= data.limit;
      body.append(h('div', { class: 'ps-prof-count' },
        h('span', null, `${data.count} of ${data.limit} designs${full ? '. Delete one to save another.' : ''}`),
        h('button', { class: 'ps-btn ps-btn--sm', type: 'button', dataset: { action: 'save-now' }, onclick: async (e) => {
          const btn = e.currentTarget; // currentTarget is null once the handler has awaited
          btn.disabled = true;
          const r = await controller.saveNow();
          if (r.ok) await load();
          else {
            toast(controller.state.message || 'Not saved.', { kind: 'warn', timeout: 7000 });
            btn.disabled = false;
          }
        } }, 'Save this design now')));
      if (!data.designs.length) body.append(h('p', { class: 'ps-hint' }, 'Nothing saved yet. Your designs are saved here as you work, or press Save this design now.'));
      else body.append(h('ul', { class: 'ps-prof-list' }, ...data.designs.map(row)));
    }
    await load();
    return handle;
  }

  // Your profile ----------------------------------------------------------------------------------------------------------------
  function openAccount() {
    const p = controller.state.profile;
    if (!p) return openAuth('signin');
    const status = h('p', { class: 'ps-hint', role: 'status', 'aria-live': 'polite', style: { margin: '6px 0 0' } });
    const mk = h('input', { type: 'checkbox', id: 'ps-prof-prefs-mk', checked: p.marketing ? true : null });
    if (p.marketing) mk.checked = true;
    mk.addEventListener('change', async () => {
      mk.disabled = true;
      try {
        await controller.setMarketing(mk.checked);
        status.textContent = mk.checked ? 'You will get occasional updates and offers.' : 'You are unsubscribed from updates and offers.';
      } catch (e) {
        mk.checked = !mk.checked;
        status.textContent = profileErrorText(e);
      }
      mk.disabled = false;
    });
    const cur = h('input', { class: 'ps-input', type: 'password', autocomplete: 'current-password', id: 'ps-prof-cur', maxlength: '200' });
    const nxt = h('input', { class: 'ps-input', type: 'password', autocomplete: 'new-password', id: 'ps-prof-new', maxlength: '200' });
    const pwErr = h('p', { class: 'ps-prof-err', role: 'alert', hidden: true });
    const pwBtn = h('button', { class: 'ps-btn', type: 'button', dataset: { action: 'change-password' }, onclick: async () => {
      pwErr.hidden = true;
      const problem = passwordProblem(nxt.value, { email: p.email });
      if (!cur.value) { pwErr.textContent = 'Enter your current password.'; pwErr.hidden = false; return; }
      if (problem) { pwErr.textContent = problem; pwErr.hidden = false; return; }
      pwBtn.disabled = true;
      try {
        await controller.changePassword(cur.value, nxt.value);
        cur.value = nxt.value = '';
        toast('Password changed. Other devices are signed out.', { kind: 'ok' });
      } catch (e) {
        pwErr.textContent = profileErrorText(e);
        pwErr.hidden = false;
      }
      pwBtn.disabled = false;
    } }, 'Change password');
    const body = h('div', null,
      h('div', { class: 'ps-prof-sec' }, h('h3', null, p.name), h('p', { class: 'ps-prof-note' }, p.email), h('p', { class: 'ps-prof-note' }, `${p.designCount} of ${p.designLimit} designs saved`)),
      h('div', { class: 'ps-prof-sec' }, h('h3', null, 'Email preferences'),
        h('label', { class: 'ps-prof-check', for: 'ps-prof-prefs-mk' }, mk, h('span', null, MARKETING_TEXT)),
        h('button', { class: 'ps-btn', type: 'button', style: { marginTop: '8px' }, dataset: { action: 'unsubscribe' }, onclick: async (e) => {
          const b = e.currentTarget;
          b.disabled = true;
          try { await controller.setMarketing(false); mk.checked = false; status.textContent = 'You are unsubscribed from news and offers. We will not send you marketing.'; } catch (er) { status.textContent = profileErrorText(er); }
          b.disabled = false;
        } }, 'Unsubscribe from news and offers'), status),
      h('div', { class: 'ps-prof-sec' }, h('h3', null, 'Change password'),
        h('div', { class: 'ps-prof-form' },
          h('div', null, h('label', { class: 'ps-prof-lab', for: 'ps-prof-cur' }, 'Current password'), cur),
          h('div', null, h('label', { class: 'ps-prof-lab', for: 'ps-prof-new' }, 'New password'), nxt, h('p', { class: 'ps-prof-note', style: { marginTop: '4px' } }, 'At least 10 characters.')),
          pwErr, pwBtn)),
      h('div', { class: 'ps-prof-sec' }, h('h3', null, 'Delete my account'),
        h('p', { class: 'ps-prof-note', style: { marginBottom: '8px' } }, 'This deletes your profile and all of your saved designs from our server. Designs kept in this browser stay here until you clear them. This cannot be undone.'),
        h('button', { class: 'ps-btn ps-btn--danger', type: 'button', dataset: { action: 'delete-account' }, onclick: () => openDelete(handle) }, 'Delete my account')));
    const handle = openModal({
      title: 'Your profile', size: 'sm', body,
      footer: (close) => [
        h('button', { class: 'ps-btn', type: 'button', dataset: { action: 'sign-out' }, onclick: async () => { try { await controller.signOut(); close('out'); toast('Signed out.', { kind: 'info' }); } catch (e) { toast(profileErrorText(e), { kind: 'warn' }); } } }, 'Sign out'),
        h('button', { class: 'ps-btn ps-btn--primary', type: 'button', onclick: () => close('done') }, 'Close')],
    });
    return handle;
  }

  function openDelete(parent) {
    const pw = h('input', { class: 'ps-input', type: 'password', autocomplete: 'current-password', id: 'ps-prof-del-pw', maxlength: '200', 'aria-label': 'Your password' });
    const err = h('p', { class: 'ps-prof-err', role: 'alert', hidden: true });
    const count = controller.state.profile?.designCount ?? 0;
    openModal({
      title: 'Delete your account?', size: 'sm',
      body: h('div', { class: 'ps-prof-form' },
        h('p', { style: { margin: 0 } }, `This deletes your profile and ${count === 1 ? 'your 1 saved design' : `all ${count} saved designs`}. It cannot be undone. Type your password to confirm.`),
        pw, err),
      footer: (close) => [
        h('button', { class: 'ps-btn', type: 'button', onclick: () => close('cancel') }, 'Keep my account'),
        h('button', { class: 'ps-btn ps-btn--danger', type: 'button', dataset: { action: 'confirm-delete-account' }, onclick: async (e) => {
          err.hidden = true;
          if (!pw.value) { err.textContent = 'Enter your password.'; err.hidden = false; return; }
          const btn = e.currentTarget; // currentTarget is null once the handler has awaited
          btn.disabled = true;
          try {
            await controller.deleteAccount(pw.value);
            pw.value = '';
            close('deleted');
            parent?.close('deleted');
            toast('Your account and designs were deleted.', { kind: 'ok' });
          } catch (ex) {
            err.textContent = profileErrorText(ex);
            err.hidden = false;
            btn.disabled = false;
          }
        } }, 'Delete account')],
    });
  }

  /**
   * Account before PDF: resolves true when a free profile is signed in (opening the sign up / sign in dialog if not), false when the
   * person closes the dialog without signing in. Sign up signs in straight away, so the caller carries on to the terms and the PDF.
   */
  function requireAccount({ reason = 'pdf' } = {}) {
    const st = () => controller.state.status;
    if (st() === 'in') return Promise.resolve(true);
    return new Promise((resolve) => {
      let done = false;
      let off = null;
      let timer = 0;
      const finish = (ok) => { if (done) return; done = true; off?.(); clearTimeout(timer); resolve(ok); };
      const show = () => {
        if (st() === 'in') { finish(true); return; }
        closePrompt();
        const handle = openAuth('create', { purpose: 'account' });
        accountWait = { reason };
        off = controller.subscribe(() => { if (st() === 'in') { try { handle.close('signed-in'); } catch { /* closed */ } finish(true); } });
        authClosed = () => { if (st() === 'in') finish(true); else finish(false); authClosed = null; };
      };
      if (st() === 'loading') { off = controller.subscribe(() => { if (st() !== 'loading') { off?.(); off = null; clearTimeout(timer); show(); } }); timer = setTimeout(() => { off?.(); off = null; show(); }, 3000); } else show();
    });
  }

  return {
    requireAccount, showPrompt, closePrompt, openAuth, openDesigns, openAccount, refresh, buttons: { saveBtn, designsBtn, accountBtn },
    dispose() {
      offState();
      offUi?.();
      saveBtn.remove();
      designsBtn.remove();
      accountBtn.remove();
      statusText.remove();
      closePrompt();
    },
  };
}
