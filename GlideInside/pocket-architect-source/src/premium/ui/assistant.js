// The AI panel. Locked: an explanation, example prompts and an unlock button. Unlocked: history, input, credits meter,
// warning banners, pre-flight estimate, and the reply applied through the operations layer as one undo step.

import { OPS } from '../../model/ops.js';
import { el, clear, formatAud, humanise, track } from '../util.js';
import { icon } from '../icons.js';
import { buildContext } from '../ai/context.js';
import { describeOp, summariseOps, nameResolver } from '../ai/summary.js';
import { friendlyError, isAuthLoss } from '../messages.js';
import { normaliseCredits, meterText, leftFraction, meterLevel, isExhausted, warningText, exhaustedText, claimWarning } from '../credits.js';

export const EXAMPLE_PROMPTS = [
  'Change the roof colour to charcoal',
  'Make the deck 1 m deeper',
  'Add a 3 by 3 m study next to the living room',
  'Flip the plan left to right',
];

const MAX_MESSAGE = 2000;
const opLabel = (op) => OPS[op]?.label || humanise(op);
const HISTORY_MESSAGES = 8; // the last four exchanges

/**
 * createAssistant({ root, store, api, config, catalogue, layer, getState, actions })
 *   getState(): { entitled, token, devUnlock, credits, notice }
 *   actions:    { unlock(source), restore(), setCredits(credits), authLost(message) }
 */
export function createAssistant({ root, store, api, config, catalogue, layer, getState, actions }) {
  const dev = () => !!getState().devUnlock;
  const pack = config.planPack || {};
  const isOn = () => !!config.premiumEnabled;
  const box = el('div', { class: 'psp-ai psp-scope' });
  root.append(box);

  let messages = [];
  let projectId = store.project.id;
  let busy = false;
  let nextId = 1;
  let disposed = false;
  let els = {};
  const dismissedBanners = new Set();
  let banners = []; // { id, kind, text }

  // Locked view --------------------------------------------------------------------------------------------------------
  function lockedView() {
    const st = getState();
    return [
      st.notice ? el('div', { class: 'psp-note psp-note--warn', role: 'status' }, icon('info', 16), el('span', null, st.notice)) : null,
      el('div', { class: 'psp-ai-head' },
        el('h3', { class: 'psp-ai-title' }, icon('spark', 16), 'AI design assistant'),
        el('span', { class: 'psp-badge' }, 'Plan Pack')),
      el('p', { class: 'psp-ai-lead' }, 'Describe a change in plain English and the assistant edits your plan, as one step you can undo. It is part of the Plan Pack.'),
      el('p', { class: 'psp-ai-label' }, 'Try asking'),
      el('div', { class: 'psp-prompts', role: 'list' },
        EXAMPLE_PROMPTS.map((text) => el('button', { class: 'psp-prompt', type: 'button', disabled: true, role: 'listitem', title: 'Unlock the Plan Pack to use the assistant' }, icon('lock', 12), text))),
      el('div', { class: 'psp-locked-box' },
        el('p', { class: 'psp-muted' }, `${pack.credits ?? 500} AI credits per project, plus PDF, DXF and 3D model exports. Drawing, the 3D view and walking through your design stay free.`),
        isOn()
          ? el('button', { class: 'psp-btn psp-btn--primary psp-btn--block', type: 'button', onclick: () => actions.unlock('assistant') }, icon('lock', 14), `Unlock plans, ${formatAud(pack.priceAud ?? 30)}`)
          : el('button', { class: 'psp-btn psp-btn--block', type: 'button', disabled: true }, icon('lock', 14), 'Plan Pack coming soon'),
        isOn() ? el('button', { class: 'psp-btn psp-btn--link', type: 'button', onclick: () => actions.restore() }, 'Already bought? Restore purchase') : null),
    ];
  }

  // Unlocked view ----------------------------------------------------------------------------------------------------
  function meterView() {
    const st = getState();
    const c = st.credits;
    const level = meterLevel(c);
    const text = c ? meterText(c) : st.token ? 'Checking your credits' : 'Credits show once the server is connected';
    els.meterText = el('span', null, text);
    els.fill = el('div', { class: 'psp-meter-fill', style: { width: `${Math.round(leftFraction(c) * 100)}%` } });
    els.bar = el('div', { class: 'psp-meter-bar', role: 'progressbar', 'aria-label': 'AI credits left', 'aria-valuemin': '0', 'aria-valuemax': String(c?.total ?? 0), 'aria-valuenow': String(c?.remaining ?? 0) }, els.fill);
    els.meter = el('div', { class: 'psp-meter', 'data-level': level }, el('div', { class: 'psp-meter-text' }, els.meterText), els.bar);
    return els.meter;
  }

  function updateMeter() {
    if (!els.meter) return;
    const c = getState().credits;
    els.meter.dataset.level = meterLevel(c);
    els.meterText.textContent = c ? meterText(c) : getState().token ? 'Checking your credits' : 'Credits show once the server is connected';
    els.fill.style.width = `${Math.round(leftFraction(c) * 100)}%`;
    els.bar.setAttribute('aria-valuemax', String(c?.total ?? 0));
    els.bar.setAttribute('aria-valuenow', String(c?.remaining ?? 0));
  }

  const readOnly = () => isExhausted(getState().credits);

  function unlockedView() {
    const st = getState();
    els = {};
    els.banners = el('div', { class: 'psp-banners' });
    els.history = el('div', { class: 'psp-history', role: 'log', 'aria-live': 'polite', 'aria-label': 'Assistant conversation' });
    els.prompts = el('div', { class: 'psp-prompts' });
    els.lead = el('p', { class: 'psp-ai-lead' }, 'Tell the assistant what to change. It edits your plan and you can undo the whole change in one click. It does not check your design against building codes or planning rules.');
    els.input = el('textarea', { class: 'psp-input', rows: 3, maxlength: MAX_MESSAGE, 'aria-label': 'Message to the assistant', placeholder: 'Describe a change, for example: make the deck 1 m deeper' });
    els.send = el('button', { class: 'psp-btn psp-btn--primary', type: 'button', onclick: () => submit() }, icon('send', 14), 'Send');
    els.hint = el('span', { class: 'psp-muted' }, 'Enter to send. Shift and Enter for a new line.');
    els.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        submit();
      }
    });
    els.input.addEventListener('input', syncCompose);
    els.compose = el('div', { class: 'psp-compose' }, els.input, el('div', { class: 'psp-compose-row' }, els.hint, els.send));
    for (const text of EXAMPLE_PROMPTS) {
      els.prompts.append(el('button', {
        class: 'psp-prompt', type: 'button',
        onclick: () => {
          els.input.value = text;
          syncCompose();
          els.input.focus();
        },
      }, text));
    }
    const out = [
      el('div', { class: 'psp-ai-head' },
        el('h3', { class: 'psp-ai-title' }, icon('spark', 16), 'AI design assistant'),
        st.token ? null : el('span', { class: 'psp-badge', title: 'Developer unlock on localhost' }, 'Dev')),
      meterView(),
      els.banners,
      els.lead,
      els.history,
      els.prompts,
      els.compose,
    ];
    return out;
  }

  function renderBanners() {
    if (!els.banners) return;
    clear(els.banners);
    const c = getState().credits;
    const list = [...banners];
    if (isExhausted(c)) list.unshift({ id: 'exhausted', kind: 'danger', text: exhaustedText(c), sticky: true });
    for (const b of list) {
      els.banners.append(el('div', { class: `psp-banner${b.kind === 'danger' ? ' psp-banner--danger' : b.kind === 'info' ? ' psp-banner--info' : ''}`, role: 'status' },
        icon(b.kind === 'info' ? 'info' : 'warning', 16),
        el('span', null, b.text),
        b.sticky ? null : el('button', {
          class: 'psp-btn psp-btn--ghost psp-btn--icon', type: 'button', 'aria-label': 'Dismiss',
          onclick: () => {
            banners = banners.filter((x) => x.id !== b.id);
            dismissedBanners.add(b.id);
            renderBanners();
          },
        }, icon('close', 14))));
    }
  }

  function syncCompose() {
    if (!els.input) return;
    const locked = readOnly();
    els.input.disabled = locked;
    els.input.placeholder = locked ? 'The assistant is read-only because all credits are used' : 'Describe a change, for example: make the deck 1 m deeper';
    els.send.disabled = locked || busy || !els.input.value.trim();
    els.send.replaceChildren(busy ? el('span', { class: 'psp-spin', 'aria-hidden': 'true' }) : icon('send', 14), busy ? 'Working' : 'Send');
    els.send.setAttribute('aria-busy', busy ? 'true' : 'false');
    els.prompts.hidden = locked || messages.length > 0;
    els.lead.hidden = messages.length > 0;
    for (const b of els.prompts.querySelectorAll('button')) b.disabled = locked || busy;
  }

  // History -------------------------------------------------------------------------------------------------------------------
  function changeList(items, fail) {
    if (!items.length) return null;
    return el('ul', { class: `psp-changes${fail ? ' psp-changes--fail' : ''}` },
      items.map((t) => el('li', null, icon(fail ? 'warning' : 'check', 14), el('span', null, t))));
  }

  function messageView(m) {
    if (m.role === 'user') return el('div', { class: 'psp-msg psp-msg--user' }, m.text);
    if (m.pending) return el('div', { class: 'psp-msg', role: 'status', 'aria-label': 'The assistant is working' }, el('span', { class: 'psp-dots', 'aria-hidden': 'true' }, el('i'), el('i'), el('i')));
    if (m.role === 'system') return el('div', { class: `psp-msg psp-msg--system${m.error ? ' psp-msg--error' : ''}` }, m.text);
    const kids = [el('p', null, m.text)];
    if (m.applied?.length) kids.push(el('p', { class: 'psp-changes-title' }, 'Changes made'), changeList(m.applied, false));
    if (m.failed?.length) kids.push(el('p', { class: 'psp-changes-title' }, 'Could not apply'), changeList(m.failed, true));
    const actionsRow = [];
    if (m.undo?.available) {
      actionsRow.push(el('button', { class: 'psp-btn psp-btn--sm', type: 'button', onclick: () => undoMessage(m) }, icon('undo', 14), 'Undo'));
    } else if (m.undo?.done) {
      actionsRow.push(el('span', { class: 'psp-muted' }, 'Undone'));
    }
    if (m.credits != null) actionsRow.push(el('span', { class: 'psp-muted' }, `${m.credits} ${m.credits === 1 ? 'credit' : 'credits'} used`));
    if (actionsRow.length) kids.push(el('div', { class: 'psp-msg-actions' }, actionsRow));
    return el('div', { class: `psp-msg${m.error ? ' psp-msg--error' : ''}` }, kids);
  }

  function renderHistory() {
    if (!els.history) return;
    clear(els.history);
    for (const m of messages) els.history.append(messageView(m));
    els.history.scrollTop = els.history.scrollHeight;
    syncCompose();
  }

  const add = (m) => {
    const full = { id: nextId++, ...m };
    messages.push(full);
    renderHistory();
    return full;
  };

  function undoMessage(m) {
    if (!m.undo?.available) return;
    m.undo.available = false;
    if (store.undoLabel() === m.undo.label) {
      store.undo();
      m.undo.done = true;
    }
    renderHistory();
  }

  // Applying a reply -----------------------------------------------------------------------------------------------------
  function applyReply(res, msg) {
    const ops = Array.isArray(res.ops) ? res.ops : [];
    const names = nameResolver(catalogue);
    const phrases = ops.map((o) => describeOp(o.op, o.args, store.project, names));
    const applied = [];
    const failed = [];
    let label = null;
    if (ops.length) {
      label = `AI: ${summariseOps(phrases)}`;
      let results = null;
      try {
        results = store.runBatch(label, ops.map((o) => ({ op: o.op, args: o.args })));
      } catch (e) {
        console.warn('[assistant] the changes could not be applied', e);
      }
      if (!results) {
        ops.forEach((o) => failed.push(`${opLabel(o.op)}: the change could not be applied.`));
        label = null;
      } else {
        results.forEach((r, i) => {
          if (r.ok) applied.push(phrases[i]);
          else failed.push(`${opLabel(ops[i].op)}: ${r.error || 'it could not be applied.'}`);
        });
        if (!applied.length) {
          store.undo(); // nothing changed, so do not leave an empty step in the history
          label = null;
        }
      }
    }
    for (const r of Array.isArray(res.rejected) ? res.rejected : []) {
      failed.push(`${opLabel(r.op)}: ${r.error || 'it was not valid.'}`);
    }
    msg.pending = false;
    msg.text = (res.reply || '').trim() || (applied.length ? 'Done.' : 'I could not work out a change from that. Try describing it a different way.');
    msg.applied = applied;
    msg.failed = failed;
    msg.credits = Number.isFinite(res.credits?.charged) ? res.credits.charged : null;
    if (label) msg.undo = { label, available: true };
    return { appliedCount: applied.length };
  }

  // Sending a request ------------------------------------------------------------------------------------------------
  const turnsForServer = () =>
    messages
      .filter((m) => (m.role === 'user' || m.role === 'assistant') && m.ok && !m.pending && m.text)
      .slice(-HISTORY_MESSAGES)
      .map((m) => ({ role: m.role, content: m.text }));

  // The estimate reports the live balance, so keep the meter honest before the request runs.
  function patchRemaining(remaining) {
    const c = getState().credits;
    if (c && Number.isFinite(remaining)) actions.setCredits({ ...c, remaining, used: Math.max(0, c.total - remaining) });
  }

  async function confirmCost({ estimatedCredits, remaining }) {
    return layer.confirmDialog({
      title: 'This may use a lot of credits',
      message: `This change may use about ${estimatedCredits} credits. ${remaining} ${remaining === 1 ? 'credit remains' : 'credits remain'}. Continue?`,
      confirmLabel: 'Continue',
      cancelLabel: 'Cancel',
    });
  }

  function fail(msg, e) {
    msg.pending = false;
    msg.error = true;
    if (e?.code === 'CREDITS_EXHAUSTED' && !(Number(e.details?.remaining) > 0)) {
      const c = getState().credits;
      actions.setCredits({ total: c?.total ?? pack.credits ?? 0, used: c?.total ?? pack.credits ?? 0, remaining: 0, warnLevel: 1 });
      msg.text = 'All AI credits in this Plan Pack have been used, so the assistant is read-only now. Manual editing and exports still work.';
      track('ps_ai_credits_exhausted', {});
    } else {
      msg.text = friendlyError(e, { area: 'ai', dev: dev() });
    }
  }

  async function submit() {
    const st = getState();
    if (busy || disposed || readOnly() || !els.input) return;
    const text = els.input.value.trim();
    if (!text) return;
    if (text.length > MAX_MESSAGE) {
      add({ role: 'system', text: `Keep each request under ${MAX_MESSAGE} characters.`, error: true });
      return;
    }
    if (!st.token) {
      add({ role: 'system', error: true, text: dev()
        ? 'Developer unlock builds the exports in this browser, but the assistant needs the Plan Studio server running and a Plan Pack for this design. See server/README.md to start the server, then make a test purchase or restore one.'
        : 'Your Plan Pack could not be verified. Restore your purchase to use the assistant.' });
      return;
    }
    const pid = store.project.id;
    const history = turnsForServer();
    const activeLevelId = store.ui.activeLevelId;
    els.input.value = '';
    const userMsg = add({ role: 'user', text });
    const pending = add({ role: 'assistant', pending: true });
    busy = true;
    syncCompose();
    track('ps_ai_request', { length: text.length });
    try {
      const context = buildContext(store.project, { activeLevelId }).text;
      const base = { message: text, context, history, activeLevelId };
      const est = await api.estimate(st.token, base);
      patchRemaining(est.remaining);
      let confirmLarge = false;
      if (est.requiresConfirm) {
        if (!(await confirmCost(est))) {
          messages = messages.filter((m) => m !== userMsg && m !== pending);
          els.input.value = text;
          return;
        }
        confirmLarge = true;
      }
      let res;
      try {
        res = await api.edit(st.token, { ...base, confirmLarge });
      } catch (e) {
        if (e.code === 'CONFIRM_REQUIRED' && !confirmLarge) {
          const ok = await confirmCost({ estimatedCredits: e.details?.estimatedCredits ?? est.estimatedCredits, remaining: e.details?.remaining ?? est.remaining });
          if (!ok) {
            messages = messages.filter((m) => m !== userMsg && m !== pending);
            els.input.value = text;
            return;
          }
          res = await api.edit(st.token, { ...base, confirmLarge: true });
        } else throw e;
      }
      if (disposed) return;
      if (store.project.id !== pid) return; // the person opened another design while this ran
      userMsg.ok = true;
      pending.ok = true;
      applyReply(res, pending);
      const credits = normaliseCredits(res.credits);
      if (credits) actions.setCredits(credits);
      const w = res.warning;
      if (w && Number.isFinite(w.level) && claimWarning(pid, w.level)) {
        banners.push({ id: `w${w.level}`, kind: w.level >= 0.95 ? 'danger' : 'warn', text: warningText(w) });
        track('ps_ai_credits_warning', { level: w.level });
      }
      if (credits && isExhausted(credits)) track('ps_ai_credits_exhausted', {});
    } catch (e) {
      if (disposed) return;
      if (isAuthLoss(e)) {
        messages = messages.filter((m) => m !== pending);
        actions.authLost(e);
        return;
      }
      fail(pending, e);
    } finally {
      busy = false;
      if (!disposed) {
        renderBanners();
        renderHistory();
        updateMeter();
      }
    }
  }

  // Rendering ---------------------------------------------------------------------------------------------------------------
  function render() {
    if (disposed) return;
    const draft = els.input?.value || '';
    clear(box);
    const st = getState();
    if (!st.entitled) {
      els = {};
      box.append(...lockedView().filter(Boolean));
      return;
    }
    box.append(...unlockedView().filter(Boolean));
    els.input.value = draft;
    renderBanners();
    renderHistory();
  }

  // The plan or the credits changed elsewhere.
  const offProject = store.on('project', (info = {}) => {
    if (store.project.id !== projectId) {
      projectId = store.project.id;
      messages = [];
      banners = [];
      render();
      return;
    }
    const label = String(info.label || '');
    let changed = false;
    for (const m of messages) {
      if (!m.undo?.available) continue;
      m.undo.available = false;
      if (label === `Undo ${m.undo.label}`) m.undo.done = true;
      changed = true;
    }
    if (changed) renderHistory();
  });

  render();

  return {
    el: box,
    render,
    refreshCredits() {
      updateMeter();
      renderBanners();
      syncCompose();
    },
    reset() {
      messages = [];
      banners = [];
    },
    get busy() {
      return busy;
    },
    dispose() {
      disposed = true;
      offProject?.();
      box.remove();
    },
  };
}
