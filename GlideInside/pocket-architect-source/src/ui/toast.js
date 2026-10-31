// In-page toasts. Never alert().

import { h } from './dom.js';

let region = null;

export function mountToasts(el) {
  region = el;
}

// kind: 'info' | 'ok' | 'warn' | 'error'. action: { label, onClick }.
export function toast(message, { kind = 'info', timeout, action } = {}) {
  if (!region) {
    (kind === 'error' ? console.error : console.log)(`[toast] ${message}`);
    return { dismiss() {} };
  }
  const ms = timeout ?? (kind === 'error' ? 8000 : kind === 'warn' ? 6000 : 3800);
  let timer = null;
  const el = h('div', { class: 'ps-toast', role: kind === 'error' ? 'alert' : 'status', dataset: { kind } }, h('span', null, message));
  const dismiss = () => {
    clearTimeout(timer);
    el.remove();
  };
  if (action) {
    el.append(
      h('button', {
        type: 'button',
        onclick: () => {
          try {
            action.onClick();
          } finally {
            dismiss();
          }
        },
      }, action.label),
    );
  }
  el.addEventListener('click', (e) => {
    if (e.target === el || e.target.tagName === 'SPAN') dismiss();
  });
  while (region.children.length >= 3) region.firstChild.remove();
  region.append(el);
  if (ms > 0) timer = setTimeout(dismiss, ms);
  return { dismiss };
}
