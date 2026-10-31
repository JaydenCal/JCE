// In-page modal dialogs. Never confirm() or prompt().

import { h } from './dom.js';
import { icon } from './icons.js';

let root = null;
const stack = [];

export function mountModals(el) {
  root = el;
}

const FOCUSABLE = 'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';
const visible = (n) => n.offsetParent !== null;

// One listener for every modal: Escape closes the top one, Tab stays inside it, wherever focus happens to be.
document.addEventListener('keydown', (e) => {
  const top = stack[stack.length - 1];
  if (!top) return;
  if (e.key === 'Escape') {
    if (!top.dismissible) return;
    e.stopPropagation();
    e.preventDefault();
    top.close('dismiss');
  } else if (e.key === 'Tab') {
    const items = [...top.dialog.querySelectorAll(FOCUSABLE)].filter(visible);
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;
    if (!top.dialog.contains(active)) {
      e.preventDefault();
      first.focus();
    } else if (e.shiftKey && active === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  }
}, true);

// body: Node, or (close) => Node. footer: Node, or (close) => Node.
export function openModal({ title, body, footer, size = 'md', dismissible = true, onClose } = {}) {
  const host = root || document.body;
  const previous = document.activeElement;
  let closed = false;
  const entry = { dismissible, dialog: null, close: null };
  const close = (reason) => {
    if (closed) return;
    closed = true;
    const i = stack.indexOf(entry);
    if (i >= 0) stack.splice(i, 1);
    scrim.remove();
    if (previous && previous.focus) {
      try {
        previous.focus({ preventScroll: true });
      } catch {
        /* element removed */
      }
    }
    onClose?.(reason);
  };
  const titleId = `ps-modal-title-${Math.random().toString(36).slice(2, 7)}`;
  const content = typeof body === 'function' ? body(close) : body;
  const foot = typeof footer === 'function' ? footer(close) : footer;
  const dialog = h(
    'div',
    { class: `ps-modal${size === 'sm' ? ' ps-modal--sm' : size === 'lg' ? ' ps-modal--lg' : ''}`, role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': titleId },
    h('div', { class: 'ps-modal-head' },
      h('h2', { id: titleId }, title),
      dismissible ? h('button', { class: 'ps-btn ps-btn--ghost ps-btn--icon', type: 'button', 'aria-label': 'Close', onclick: () => close('dismiss') }, icon('close', { size: 18 })) : null),
    h('div', { class: 'ps-modal-body' }, content),
    foot ? h('div', { class: 'ps-modal-foot' }, foot) : null,
  );
  const scrim = h('div', { class: 'ps-scrim' }, dialog);
  scrim.addEventListener('pointerdown', (e) => {
    if (dismissible && e.target === scrim) close('dismiss');
  });
  entry.dialog = dialog;
  entry.close = close;
  stack.push(entry);
  host.append(scrim);
  setTimeout(() => {
    const first = [...dialog.querySelectorAll('.ps-modal-body button, .ps-modal-body input, .ps-modal-body select')].find(visible) || [...dialog.querySelectorAll(FOCUSABLE)].find(visible);
    first?.focus({ preventScroll: true });
  }, 0);
  return { close, el: dialog };
}

// Yes or no inside the page. Resolves true when confirmed.
export function askConfirm({ title, message, confirmLabel = 'Confirm', cancelLabel = 'Cancel', danger = false }) {
  return new Promise((resolve) => {
    let answer = false;
    openModal({
      title,
      size: 'sm',
      body: h('p', { style: { margin: '0 0 4px' } }, message),
      footer: (close) => [
        h('button', { class: 'ps-btn', type: 'button', onclick: () => close('cancel') }, cancelLabel),
        h('button', {
          class: `ps-btn ${danger ? 'ps-btn--danger' : 'ps-btn--primary'}`,
          type: 'button',
          onclick: () => {
            answer = true;
            close('confirm');
          },
        }, confirmLabel),
      ],
      onClose: () => resolve(answer),
    });
  });
}
