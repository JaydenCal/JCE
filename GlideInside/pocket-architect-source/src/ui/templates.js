// "New design" picker. One card per template plus Blank. Replacing a design with edits asks inside the modal.

import { h } from './dom.js';
import { openModal } from './modal.js';
import { DESIGN_TYPES } from './design-type.js';

const TYPE_LABEL = { house: 'House', unit: 'Unit', shed: 'Shed', extension: 'Extension' };

export function levelCount(t) {
  if (Array.isArray(t?.levels)) return t.levels.length;
  const n = Number(t?.levels);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

// templates: [{ id, name, type, description, levels, create }]
// onPick(template), onBlank(), onSaveCopy() are called after the modal closes (onSaveCopy keeps it open).
// onDesignType(typeId), when given, adds the Design type row: it closes the picker and swaps the design for a generic one
// of that type, keeping the title block (the caller asks for confirmation). currentType marks the current one.
export function openTemplatePicker({ templates = [], hasEdits = false, designName = 'this design', onPick, onBlank, onSaveCopy, onDesignType, currentType = null } = {}) {
  let pending = null;
  const confirmText = h('span');
  const confirmBar = h('div', { class: 'ps-confirm', role: 'alert', hidden: true });

  return openModal({
    title: 'Start a new design',
    body: (close) => {
      const finish = (entry) => {
        close('chosen');
        if (entry.blank) onBlank?.();
        else onPick?.(entry.template);
      };
      const choose = (entry) => {
        if (!hasEdits) {
          finish(entry);
          return;
        }
        pending = entry;
        confirmText.textContent = `Replace "${designName}" with ${entry.blank ? 'a blank design' : `"${entry.template.name}"`}? Your changes to the current design will be lost unless you save a copy first.`;
        confirmBar.hidden = false;
        confirmBar.querySelector('[data-act="replace"]')?.focus();
      };
      confirmBar.append(
        confirmText,
        h('span', { class: 'ps-row' },
          h('button', { class: 'ps-btn ps-btn--sm', type: 'button', onclick: () => {
            pending = null;
            confirmBar.hidden = true;
          } }, 'Keep my design'),
          onSaveCopy ? h('button', { class: 'ps-btn ps-btn--sm', type: 'button', onclick: () => onSaveCopy() }, 'Save a copy') : null,
          h('button', { class: 'ps-btn ps-btn--sm ps-btn--danger', type: 'button', dataset: { act: 'replace' }, onclick: () => pending && finish(pending) }, 'Replace design')));

      const card = (entry, name, description, tags) =>
        h('button', { class: 'ps-card', type: 'button', onclick: () => choose(entry) },
          h('strong', null, name),
          h('p', null, description),
          h('span', { class: 'ps-card-meta' }, tags.map((t) => h('span', { class: 'ps-tag' }, t))));

      const cards = h('div', { class: 'ps-cards' },
        templates.map((t) => card({ template: t }, t.name, t.description || '', [TYPE_LABEL[t.type] || 'Design', `${levelCount(t)} ${levelCount(t) === 1 ? 'level' : 'levels'}`])),
        card({ blank: true }, 'Blank design', 'An empty plan. Draw rooms and walls yourself, or place a room and build out from there.', ['Blank', '1 level']));

      const typeRow = onDesignType
        ? h('div', { class: 'ps-field ps-field--chips', style: { margin: '0 0 12px' } },
          h('span', { class: 'ps-field-label' }, 'Design type'),
          h('span', { class: 'ps-seg ps-seg--sm', role: 'group', 'aria-label': 'Design type' },
            DESIGN_TYPES.map((d) => h('button', {
              class: 'ps-seg-btn', type: 'button', dataset: { designType: d.id }, 'aria-pressed': String(d.id === currentType),
              onclick: () => {
                if (d.id === currentType) return;
                close('design-type');
                onDesignType(d.id);
              },
            }, d.label))),
          h('p', { class: 'ps-hint', style: { margin: '4px 0 0' } }, 'Swaps this design for a generic one of that type and keeps the title block details. You can undo.'))
        : null;

      return h('div', null,
        typeRow,
        h('p', { class: 'ps-hint', style: { margin: '0 0 12px' } }, 'Or choose a starting point. Everything can be changed afterwards.'),
        confirmBar,
        cards);
    },
  });
}
