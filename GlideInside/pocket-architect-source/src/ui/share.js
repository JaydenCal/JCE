// Save and share, restored from the live app (15/10/2026). A "Share" button next to Save opens a dialog that saves the design
// online (POST or PUT /api/projects) and shows the link; opening the app on <page>?share=<id> loads that design read only
// with a "Make my own copy" button. The browser that saved keeps the edit key (cloud.js), so only it can update the link.
// Everything the person sees is in this file; the wire format and storage are in cloud.js.

import { h } from './dom.js';
import { icon } from './icons.js';
import { openModal, askConfirm } from './modal.js';
import { toast } from './toast.js';
import { track } from './analytics.js';
import { migrate, validate } from '../model/schema.js';
import { createCloud, readShare, saveShared, forkProject, saveErrorMessage, loadErrorMessage, ddmmyyyyOf, shareIdFromSearch } from './cloud.js';

const STYLE = `
.ps-shared-banner{position:absolute;top:8px;left:50%;transform:translateX(-50%);z-index:6;display:flex;gap:10px;align-items:center;flex-wrap:wrap;justify-content:center;max-width:calc(100% - 24px);padding:6px 8px 6px 14px;background:var(--ps-panel);color:var(--ps-text);border:1px solid var(--ps-border-strong);border-radius:var(--ps-radius-lg);box-shadow:0 2px 10px rgba(0,0,0,.18);font-size:14px}
.ps-shared-banner .ps-btn{flex:0 0 auto}
.ps-share-link{display:flex;gap:8px;align-items:center;margin-top:12px}
.ps-share-link input{flex:1;min-width:0}
.ps-share-keep{margin:12px 0 0;padding:8px 10px;background:var(--ps-panel-2);border:1px solid var(--ps-border);border-radius:var(--ps-radius);font-size:13px;color:var(--ps-muted)}
`;

function ensureStyle() {
  if (document.getElementById('ps-share-style')) return;
  const style = h('style', { id: 'ps-share-style' });
  style.textContent = STYLE;
  document.head.append(style);
}

async function copyText(text, input) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      input?.focus();
      input?.select();
      return !!document.execCommand?.('copy');
    } catch {
      return false;
    }
  }
}

/**
 * initShare({ store, refs, config, replaceProject, hasEdits, fetchImpl })
 *   replaceProject(project) -> boolean, hasEdits() -> boolean (the person's own work would be replaced),
 *   setAutosaveShown(on) shows or hides the "Autosave on" label while a read only design is open.
 * Returns { openDialog, share, forkShared, editShared, openLink, cloud, state } and adds the Share button to the top bar.
 */
export function initShare({ store, refs, config, replaceProject, hasEdits = () => false, setAutosaveShown = () => {}, fetchImpl = null }) {
  ensureStyle();
  const cloud = createCloud({ base: config.apiBase, fetchImpl });
  const state = { id: null, banner: null, hadOwn: false, owner: false };

  // The button, in the File group next to Save. The top bar module is not touched.
  const saveBtn = refs.topbar?.querySelector('[data-action="save"]');
  const button = h('button', {
    class: 'ps-btn', type: 'button', title: 'Save a copy online and get a link to share', 'aria-label': 'Save a copy online and get a link to share', dataset: { action: 'share' },
    onclick: () => share(),
  }, icon('link', { size: 18 }), h('span', { class: 'ps-btn-text' }, 'Share'));
  saveBtn?.after(button);

  function clearBanner() {
    state.banner?.remove();
    state.banner = null;
  }

  function leaveShared() {
    state.id = null;
    state.owner = false;
    clearBanner();
    store.readOnly = false;
    store.setAutosave(config.embedMode !== 'demo');
    setAutosaveShown(config.embedMode !== 'demo');
    try {
      const url = new URL(location.href);
      url.searchParams.delete('share');
      history.replaceState(history.state, '', url.pathname + url.search + url.hash);
    } catch {
      /* the address bar is left as it is */
    }
  }

  async function confirmReplace(title, message, confirmLabel) {
    return !state.hadOwn || (await askConfirm({ title, message, confirmLabel, danger: true }));
  }

  async function forkShared() {
    if (!state.id) return;
    if (!(await confirmReplace('Make your own copy?', 'Your copy will replace the design that was saved in this browser before you opened this link.', 'Make my copy'))) return;
    const copy = forkProject(store.project);
    leaveShared();
    if (replaceProject(copy)) {
      store.saveNow?.();
      track('ps_share_fork');
      toast('Your copy is ready. Change it as you like. Use Share to get a link of your own.', { kind: 'ok', timeout: 9000 });
    }
  }

  // The owner's browser holds the edit key for this id: keep the same id so Share updates the same link.
  async function editShared() {
    if (!state.id || !state.owner) return;
    if (!(await confirmReplace('Edit your shared design?', 'This replaces the design that was saved in this browser before you opened this link. Use Share afterwards to update the link.', 'Edit this design'))) return;
    const project = store.project;
    leaveShared();
    if (replaceProject(project)) {
      store.saveNow?.();
      toast('You can edit this design again. Use Share to update the link.', { kind: 'ok', timeout: 9000 });
    }
  }

  function showBanner() {
    clearBanner();
    const buttons = [];
    if (state.owner) buttons.push(h('button', { class: 'ps-btn ps-btn--sm', type: 'button', dataset: { action: 'edit-shared' }, onclick: () => editShared() }, 'Edit this design'));
    buttons.push(h('button', { class: 'ps-btn ps-btn--primary ps-btn--sm', type: 'button', dataset: { action: 'fork' }, onclick: () => forkShared() }, 'Make my own copy'));
    state.banner = h('div', { class: 'ps-shared-banner', role: 'region', 'aria-label': 'Shared design' },
      h('span', null, state.owner ? 'This is your shared design. It is read only here.' : 'You are looking at a shared design. It is read only.'),
      ...buttons);
    refs.stage.prepend(state.banner);
  }

  /** Open a shared link. Read only; resolves true when the design is showing. */
  async function openLink(id) {
    state.hadOwn = hasEdits();
    store.setAutosave(false);
    setAutosaveShown(false);
    let loaded;
    try {
      loaded = await cloud.load(id);
      const project = migrate(loaded.project);
      if (validate(project).length) throw new Error('That shared design has problems and cannot be opened.');
      if (!replaceProject(project)) throw new Error('That shared design could not be opened.');
      store.readOnly = true; // set once the design is in, so loading it is not refused
    } catch (e) {
      store.readOnly = false;
      store.setAutosave(config.embedMode !== 'demo');
      setAutosaveShown(config.embedMode !== 'demo');
      openModal({
        title: 'This shared design could not be opened',
        size: 'sm',
        body: h('p', { style: { margin: 0 } }, loadErrorMessage(e)),
        footer: (close) => h('button', { class: 'ps-btn ps-btn--primary', type: 'button', onclick: () => close() }, 'Close'),
      });
      return false;
    }
    state.id = id;
    state.owner = readShare(store.project.id)?.id === id; // this browser saved it, so it holds the edit key
    showBanner();
    track('ps_share_open');
    return true;
  }

  /** The Share dialog. In a shared (read only) design the button offers the copy instead. */
  function share() {
    if (state.id) return forkShared();
    return openDialog();
  }

  function openDialog() {
    const status = h('p', { class: 'ps-hint', role: 'status', 'aria-live': 'polite', style: { margin: '8px 0 0' } });
    const email = h('input', { class: 'ps-input', type: 'email', id: 'ps-share-email', autocomplete: 'email', maxlength: '254', placeholder: 'name@example.com', style: { width: '100%' } });
    const link = h('input', { class: 'ps-input', type: 'text', readonly: true, 'aria-label': 'Share link', onfocus: (e) => e.target.select() });
    const copy = h('button', { class: 'ps-btn ps-btn--primary', type: 'button', dataset: { action: 'copy-link' } }, 'Copy link');
    const save = h('button', { class: 'ps-btn ps-btn--primary', type: 'button', dataset: { action: 'share-save' } }, 'Save and share');
    const linkRow = h('div', { class: 'ps-share-link' }, link, copy);
    const intro = h('p', { style: { margin: '0 0 8px' } }, 'Save a copy of this design online and get a link. Anyone with the link can look at it, walk through it in 3D and make their own copy. They cannot change yours.');
    const keep = h('p', { class: 'ps-share-keep', dataset: { role: 'edit-rights' } }, 'This browser keeps the right to update this link. If you clear this browser\'s site data, or use another device, you can still open the link but cannot update it. Save again there to make a new link.');
    const hint = h('p', { class: 'ps-hint', style: { margin: '0 0 12px' } }, 'The link is saved in this browser and shown here. We do not email it to you, so copy it somewhere safe. Saving again later keeps the same link.');
    const privacy = config.links?.privacy;
    const emailBox = h('div', { style: { margin: '0 0 8px' } },
      h('label', { for: 'ps-share-email', style: { display: 'block', fontWeight: 500, marginBottom: '4px' } }, 'Email (optional)'),
      email,
      h('p', { class: 'ps-hint', style: { margin: '4px 0 0' } }, 'If you add an email we keep it with your saved design. We do not send you an email. ', privacy ? h('a', { href: privacy, target: '_blank', rel: 'noopener' }, 'Privacy') : null));
    let busy = false;

    function refresh() {
      const own = readShare(store.project.id);
      link.value = own?.url || '';
      linkRow.hidden = !own;
      keep.hidden = !own;
      emailBox.hidden = !!own;
      intro.hidden = !!own;
      save.textContent = own ? 'Update shared copy' : 'Save and share';
      if (own) status.textContent = `Saved ${ddmmyyyyOf(own.savedAt)}. The link stays open until ${ddmmyyyyOf(own.expiresAt)}, and each save extends it.`;
    }

    async function run() {
      if (busy) return;
      busy = true;
      save.disabled = true;
      status.textContent = 'Saving';
      store.saveNow?.();
      try {
        const out = await saveShared(cloud, store.project, { email: email.value.trim() || undefined });
        track('ps_share_save', { created: out.created });
        refresh();
        status.textContent = out.created ? 'Saved. Copy the link below and keep it.' : 'Updated. The link is the same.';
        if (out.created && out.keyKept === false) status.textContent += ' This browser could not store the edit key, so this link cannot be updated later.';
        link.focus();
        link.select();
      } catch (e) {
        status.textContent = saveErrorMessage(e);
      } finally {
        busy = false;
        save.disabled = false;
      }
    }

    save.addEventListener('click', run);
    copy.addEventListener('click', async () => {
      const ok = await copyText(link.value, link);
      status.textContent = ok ? 'Link copied.' : 'Press Ctrl+C (Cmd+C on a Mac) to copy the link.';
      if (ok) track('ps_share_copy');
    });
    refresh();
    return openModal({
      title: 'Save and share',
      size: 'sm',
      body: h('div', null, intro, hint, emailBox, linkRow, keep, status),
      footer: (close) => [h('button', { class: 'ps-btn', type: 'button', onclick: () => close('done') }, 'Close'), save],
    });
  }

  // The live link format: ?share=<id>
  function linkFromAddress() {
    return shareIdFromSearch(globalThis.location?.search);
  }

  return { openDialog, share, forkShared, editShared, openLink, linkFromAddress, leave: leaveShared, cloud, state, button, dispose: () => { button.remove(); clearBanner(); } };
}
