// Form field builders for the properties panel. Each returns { el, refresh } so a field can be
// re-synced with the project in place (keeping focus) instead of being rebuilt on every change.

import { h } from './dom.js';

let counter = 0;
const nid = () => `psf-${++counter}`;
const round = (v, d) => (d > 0 ? Math.round(v * 10 ** d) / 10 ** d : Math.round(v));

export function row(label, control, { id, stack = false } = {}) {
  return h('div', { class: `ps-field${stack ? ' ps-field--stack' : ''}` }, h('label', { for: id }, label), control);
}

export function section(title, ...children) {
  return h('div', { class: 'ps-sec' }, title ? h('h3', null, title) : null, ...children);
}

export function numberField({ label, get, commit, min, max, step = 1, unit = 'mm', placeholder, allowBlank = false, decimals = 0, readOnly = false }) {
  const id = nid();
  const input = h('input', { class: 'ps-input ps-num', id, type: 'number', inputmode: 'decimal', step: String(step), readonly: readOnly || null });
  if (min != null) input.min = String(min);
  if (max != null) input.max = String(max);
  if (placeholder != null) input.placeholder = String(placeholder);
  const refresh = () => {
    if (document.activeElement === input) return;
    const v = get();
    input.value = v == null || Number.isNaN(v) ? '' : String(round(v, decimals));
  };
  const doCommit = () => {
    const raw = input.value.trim();
    if (raw === '') {
      if (allowBlank) commit(null);
      else refresh();
      return;
    }
    const n = Number(raw);
    if (!Number.isFinite(n)) return refresh();
    const cur = get();
    if (cur != null && Math.abs(cur - n) < 1e-9) return;
    commit(n);
  };
  input.addEventListener('change', doCommit);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      input.value = get() == null ? '' : String(round(get(), decimals));
      input.blur();
      e.stopPropagation();
    }
  });
  const wrap = h('div', { class: 'ps-input-wrap' }, input, unit ? h('span', { class: 'ps-unit' }, unit) : null);
  refresh();
  return { el: row(label, wrap, { id }), refresh, input };
}

export function textField({ label, get, commit, maxlength = 60 }) {
  const id = nid();
  const input = h('input', { class: 'ps-input', id, type: 'text', maxlength: String(maxlength), autocomplete: 'off' });
  const refresh = () => {
    if (document.activeElement !== input) input.value = get() ?? '';
  };
  input.addEventListener('change', () => {
    const v = input.value.trim();
    if (v !== (get() ?? '')) commit(v);
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') input.blur();
    if (e.key === 'Escape') {
      input.value = get() ?? '';
      input.blur();
      e.stopPropagation();
    }
  });
  refresh();
  return { el: row(label, input, { id }), refresh, input };
}

// options: [{ value, label, group? }] or [[value, label]] or ['a', 'b']
export function normaliseOptions(options) {
  return options.map((o) => (Array.isArray(o) ? { value: o[0], label: o[1] } : typeof o === 'object' ? o : { value: o, label: String(o) }));
}

export function selectField({ label, options, get, commit, stack = false, disabled = false }) {
  const id = nid();
  const opts = normaliseOptions(options);
  const select = h('select', { class: 'ps-select', id, disabled: disabled || null });
  const groups = new Map();
  for (const o of opts) {
    const opt = h('option', { value: String(o.value) }, o.label);
    if (o.group) {
      if (!groups.has(o.group)) {
        const g = h('optgroup', { label: o.group });
        groups.set(o.group, g);
        select.append(g);
      }
      groups.get(o.group).append(opt);
    } else select.append(opt);
  }
  const refresh = () => {
    const v = String(get() ?? '');
    if (![...select.options].some((o) => o.value === v)) select.append(h('option', { value: v }, v || 'None'));
    select.value = v;
  };
  select.addEventListener('change', () => commit(select.value));
  refresh();
  return { el: label ? row(label, select, { id, stack }) : select, refresh, select };
}

export function checkField({ label, get, commit }) {
  const id = nid();
  const input = h('input', { type: 'checkbox', id });
  const refresh = () => {
    input.checked = !!get();
  };
  input.addEventListener('change', () => commit(input.checked));
  refresh();
  return { el: h('div', { class: 'ps-check' }, input, h('label', { for: id }, label)), refresh, input };
}

export function segmented({ options, get, commit, small = true, label }) {
  const opts = normaliseOptions(options);
  const wrap = h('div', { class: `ps-seg${small ? ' ps-seg--sm' : ''}`, role: 'group', 'aria-label': label || null });
  const buttons = opts.map((o) =>
    h('button', {
      class: 'ps-seg-btn', type: 'button', 'aria-pressed': 'false', dataset: { value: o.value },
      onclick: () => commit(o.value),
    }, o.label));
  wrap.append(...buttons);
  const refresh = () => {
    const v = get();
    buttons.forEach((b, i) => b.setAttribute('aria-pressed', String(opts[i].value === v)));
  };
  refresh();
  return { el: wrap, refresh };
}

// Row of small preset buttons for a numeric value. The one equal to get() is shown pressed.
export function presetChips({ values, get, commit, unit = '', label }) {
  const wrap = h('div', { class: 'ps-chips', role: 'group', 'aria-label': label || null });
  const buttons = values.map((v) =>
    h('button', { class: 'ps-chip', type: 'button', 'aria-pressed': 'false', dataset: { value: v }, title: `${v} mm`, onclick: () => commit(v) }, `${v}${unit}`));
  wrap.append(...buttons);
  const refresh = () => {
    const cur = get();
    buttons.forEach((b, i) => b.setAttribute('aria-pressed', String(cur != null && Math.round(cur) === values[i])));
  };
  refresh();
  return { el: wrap, refresh };
}

export function button(text, onclick, { cls = '', title, icon } = {}) {
  return h('button', { class: `ps-btn ${cls}`.trim(), type: 'button', title: title || null, onclick }, icon || null, text);
}

export function readout(label, text) {
  const out = h('span', { class: 'ps-readout' }, text);
  return { el: row(label, out), refresh() {}, set(v) { out.textContent = v; }, out };
}

// Collects fields so a whole form can be refreshed with one call.
export function formBuilder() {
  const items = [];
  return {
    add(f) {
      items.push(f);
      return f.el;
    },
    refresh() {
      for (const f of items) f.refresh?.();
    },
  };
}
