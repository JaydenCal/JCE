// Small UI kit for the portal screens (dashboard page on the site): DOM builder, dialogs, toasts, copy and download helpers.
// Plain DOM, no framework. Styles are in website-live/portal/portal.css (class prefix pp-).

import { h, clear } from '../../ui/dom.js';
import { ApiError } from '../../premium/api.js';

export { h, clear };

const ICONS = {
  plus: '<path d="M12 5v14M5 12h14"/>',
  copy: '<rect x="8.5" y="8.5" width="11" height="11" rx="1.5"/><path d="M15.5 8.5V6a1.5 1.5 0 0 0-1.5-1.5H6A1.5 1.5 0 0 0 4.5 6v8A1.5 1.5 0 0 0 6 15.5h2.5"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  lock: '<rect x="5.5" y="10.5" width="13" height="9" rx="1.5"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"/>',
  info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5M12 8v.1"/>',
  warning: '<path d="M12 4l9 16H3z"/><path d="M12 10v4M12 17.2v.1"/>',
  user: '<circle cx="12" cy="8.5" r="3.5"/><path d="M5 20c.8-3.6 3.6-5.5 7-5.5s6.2 1.9 7 5.5"/>',
  logout: '<path d="M14 4.5h4.5a1.5 1.5 0 0 1 1.5 1.5v12a1.5 1.5 0 0 1-1.5 1.5H14M10 8l-4 4 4 4M6 12h9"/>',
  download: '<path d="M12 4v11M7.5 10.5L12 15l4.5-4.5M5 19.5h14"/>',
  upload: '<path d="M12 16V5M7.5 9.5L12 5l4.5 4.5M5 19.5h14"/>',
  trash: '<path d="M4.5 7h15M9 7V4.5h6V7M6.5 7l1 13h9l1-13M10.5 11v6M13.5 11v6"/>',
  key: '<circle cx="8" cy="14" r="3.5"/><path d="M10.5 11.5L19 3M16 6l2.5 2.5M13.5 8.5L15 10"/>',
  open: '<path d="M14 4.5h5.5V10M19.5 4.5L11 13M17.5 14v4.5a1 1 0 0 1-1 1h-10a1 1 0 0 1-1-1v-10a1 1 0 0 1 1-1H10"/>',
  home: '<path d="M4 11l8-6.5 8 6.5M6 9.5v9.5h12V9.5"/>',
};
export function icon(name, size = 18) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  for (const [k, v] of Object.entries({ viewBox: '0 0 24 24', width: size, height: size, fill: 'none', stroke: 'currentColor', 'stroke-width': 1.7, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true', focusable: 'false' })) svg.setAttribute(k, String(v));
  svg.innerHTML = ICONS[name] || ICONS.info;
  return svg;
}

export const errorMessage = (e) => (e instanceof ApiError ? e.message : e?.message || 'Something went wrong. Try again.');

// Toasts -------------------------------------------------------------------------------------------------------------------
let region = null;
export function toast(message, { kind = 'info', timeout = 4500 } = {}) {
  if (!region) {
    region = h('div', { class: 'pp-toasts', 'aria-live': 'polite' });
    document.body.append(region);
  }
  const el = h('div', { class: 'pp-toast', role: kind === 'error' ? 'alert' : 'status', dataset: { kind } }, message);
  while (region.children.length >= 3) region.firstChild.remove();
  region.append(el);
  if (timeout) setTimeout(() => el.remove(), timeout);
  el.addEventListener('click', () => el.remove());
}

// Dialogs --------------------------------------------------------------------------------------------------------------------
const FOCUSABLE = 'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';
const stack = [];
document.addEventListener('keydown', (e) => {
  const top = stack[stack.length - 1];
  if (!top) return;
  if (e.key === 'Escape' && top.dismissible) {
    e.preventDefault();
    top.close('dismiss');
  } else if (e.key === 'Tab') {
    const items = [...top.dialog.querySelectorAll(FOCUSABLE)].filter((n) => n.offsetParent !== null);
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (!top.dialog.contains(document.activeElement)) {
      e.preventDefault();
      first.focus();
    } else if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }
}, true);

/** body and footer: Node or (api) => Node, where api = { close, setBody, setFooter, setTitle }. */
export function openDialog({ title, body, footer, size = 'md', dismissible = true, onClose } = {}) {
  const previous = document.activeElement;
  const titleId = `pp-dlg-${Math.random().toString(36).slice(2, 7)}`;
  const bodyEl = h('div', { class: 'pp-dialog-body' });
  const footEl = h('div', { class: 'pp-dialog-foot' });
  const titleEl = h('h2', { id: titleId }, title);
  const dialog = h('div', { class: `pp-dialog pp-dialog--${size}`, role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': titleId },
    h('div', { class: 'pp-dialog-head' }, titleEl, dismissible ? h('button', { class: 'pp-btn pp-btn--ghost pp-btn--icon', type: 'button', 'aria-label': 'Close', onclick: () => close('dismiss') }, icon('close')) : null),
    bodyEl, footEl);
  const scrim = h('div', { class: 'pp-scrim' }, dialog);
  let closed = false;
  const entry = { dialog, dismissible, close: (r) => close(r) };
  function close(reason = 'close') {
    if (closed) return;
    closed = true;
    stack.splice(stack.indexOf(entry), 1);
    scrim.remove();
    try {
      previous?.focus?.({ preventScroll: true });
    } catch {
      /* element gone */
    }
    onClose?.(reason);
  }
  const api = {
    close,
    el: dialog,
    setTitle: (t) => { titleEl.textContent = t; },
    setBody(node) { clear(bodyEl); bodyEl.append(typeof node === 'function' ? node(api) : node); },
    setFooter(node) { clear(footEl); const n = typeof node === 'function' ? node(api) : node; footEl.hidden = !n; if (n) footEl.append(n); },
  };
  api.setBody(body);
  api.setFooter(footer || null);
  scrim.addEventListener('pointerdown', (e) => {
    if (dismissible && e.target === scrim) close('dismiss');
  });
  stack.push(entry);
  document.body.append(scrim);
  setTimeout(() => ([...dialog.querySelectorAll('input, select, textarea')].find((n) => n.offsetParent !== null) || dialog.querySelector('.pp-dialog-body button, .pp-dialog-foot button'))?.focus({ preventScroll: true }), 0);
  return api;
}

export function confirmDialog({ title, message, confirmLabel = 'Confirm', danger = false, detail = null }) {
  return new Promise((resolve) => {
    let ok = false;
    openDialog({
      title, size: 'sm',
      body: h('div', null, h('p', { style: { margin: '0 0 8px' } }, message), detail),
      footer: (d) => [h('button', { class: 'pp-btn', type: 'button', onclick: () => d.close('cancel') }, 'Cancel'), h('button', { class: `pp-btn ${danger ? 'pp-btn--danger' : 'pp-btn--primary'}`, type: 'button', onclick: () => { ok = true; d.close('ok'); } }, confirmLabel)],
      onClose: () => resolve(ok),
    });
  });
}

// Helpers -----------------------------------------------------------------------------------------------------------------------
export async function copyText(value) {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    const ta = h('textarea', { 'aria-hidden': 'true', tabindex: '-1', style: { position: 'fixed', opacity: '0', left: '-999px' } });
    ta.value = value;
    document.body.append(ta);
    ta.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
    ta.remove();
    return ok;
  }
}

export function downloadText(text, filename, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = h('a', { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

let fieldN = 0;
/** A labelled control. make(id) returns the input node. */
export function field(label, make, { hint, required = false, wide = false } = {}) {
  const id = `pp-f${++fieldN}`;
  const control = make(id);
  const hintId = hint ? `${id}-hint` : null;
  if (hintId) control.setAttribute('aria-describedby', hintId);
  return h('div', { class: `pp-field${wide ? ' pp-field--wide' : ''}` },
    h('label', { for: id }, label, required ? h('span', { class: 'pp-req', 'aria-hidden': 'true' }, ' *') : h('span', { class: 'pp-opt' }, ' (optional)')),
    control, hint ? h('p', { class: 'pp-hint', id: hintId }, hint) : null);
}

/** Disable a button while an async action runs; shows the error as a toast. */
export async function busy(button, fn) {
  if (button) button.disabled = true;
  try {
    return await fn();
  } catch (e) {
    toast(errorMessage(e), { kind: 'error', timeout: 8000 });
    return undefined;
  } finally {
    if (button) button.disabled = false;
  }
}

export const chip = (text, kind = 'neutral') => h('span', { class: `pp-chip pp-chip--${kind}` }, text);

/** Reads a PNG or JPG file, scales it to at most 600 px wide and resolves with a data URL (same limits as the plan title block). */
export function scaleLogoFile(file, maxW = 600) {
  return new Promise((resolve, reject) => {
    if (!file || !/^image\/(png|jpeg)$/.test(file.type)) return reject(new Error('Choose a PNG or JPG image.'));
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('That image could not be read.'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('That image could not be read.'));
      img.onload = () => {
        const k = Math.min(1, maxW / img.naturalWidth);
        const c = document.createElement('canvas');
        c.width = Math.max(1, Math.round(img.naturalWidth * k));
        c.height = Math.max(1, Math.round(img.naturalHeight * k));
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        resolve(c.toDataURL(file.type === 'image/png' ? 'image/png' : 'image/jpeg', 0.9));
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}
