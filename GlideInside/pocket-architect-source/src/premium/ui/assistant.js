// The AI panel. Locked: an explanation, example prompts and an unlock button. Unlocked: history, input, credits meter,
// warning banners, pre-flight estimate, and the reply applied through the operations layer as one undo step.

import { OPS } from '../../model/ops.js';
import { el, clear, formatAud, humanise, track } from '../util.js';
import { icon } from '../icons.js';
import { buildContext } from '../ai/context.js';
import { describeOp, summariseOps, nameResolver } from '../ai/summary.js';
import { siteCallProblem } from '../ai/tools.js';
import { friendlyError, isAuthLoss } from '../messages.js';
import { canBuyMessages, buyMessagesLabel, topUpOfferText, normaliseCredits, meterText, resetText, leftFraction, meterLevel, isExhausted, warningText, exhaustedText, claimWarning, canTopUp, topUpLabel, availableCredits } from '../credits.js';
import { promptsFor, chipsFor, BASE_PROMPTS, COMMERCIAL_PROMPTS } from '../ai/suggestions.js';
import { hasCatalogue } from '../ai/commercial-catalogue.js';
import { isCommercial } from '../../commercial/schema.js';

export const EXAMPLE_PROMPTS = BASE_PROMPTS;

const MAX_MESSAGE = 2000;
const opLabel = (op) => OPS[op]?.label || humanise(op);
const HISTORY_MESSAGES = 8; // the last four exchanges

// Commercial mode loads its tool functions and the building catalogue on first use, so housing designs never pay for them.
let commercialLoad = null;
const loadCommercial = () => {
  commercialLoad ||= Promise.all([import('../ai/commercial-ops.js'), import('../ai/commercial-context.js'), import('../ai/commercial-core.js'), import('../ai/commercial-catalogue.js')])
    .then(async ([ops, ctx, core, cat]) => {
      await cat.loadCommercialTypes();
      return { ops, ctx, core };
    });
  return commercialLoad;
};

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
  let toppingUp = false;
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
        el('span', { class: 'psp-badge' }, st.commercial ? 'Subscription' : 'Plan Pack')),
      el('p', { class: 'psp-ai-lead' }, st.commercial ? 'Describe a change in plain English and the assistant edits your layout, as one step you can undo. It comes with the Commercial Developer subscription.' : 'Describe a change in plain English and the assistant edits your plan, as one step you can undo. It is part of the Plan Pack.'),
      el('p', { class: 'psp-ai-label' }, 'Try asking'),
      el('div', { class: 'psp-prompts', role: 'list' },
        (st.commercial ? COMMERCIAL_PROMPTS : EXAMPLE_PROMPTS).map((text) => el('button', { class: 'psp-prompt', type: 'button', disabled: true, role: 'listitem', title: st.commercial ? 'Subscribe to use the assistant' : 'Unlock the Plan Pack to use the assistant' }, icon('lock', 12), text))),
      el('div', { class: 'psp-locked-box' },
        el('p', { class: 'psp-muted' }, st.commercial ? 'Commercial Developer, A$50 per month, unlimited plan sets, plus a monthly allowance of AI messages. Drawing and the 3D view stay free.' : `${pack.credits ?? 500} AI credits per job, plus PDF, DXF and 3D model exports. Drawing, the 3D view and walking through your design stay free.`),
        isOn() || st.commercial
          ? el('button', { class: 'psp-btn psp-btn--primary psp-btn--block', type: 'button', onclick: () => actions.unlock('assistant') }, icon('lock', 14), st.commercial ? `Subscribe, ${formatAud(50)} per month` : `Unlock plans, ${formatAud(pack.priceAud ?? 30)}`)
          : el('button', { class: 'psp-btn psp-btn--block', type: 'button', disabled: true }, icon('lock', 14), 'Plan Pack unavailable, try again'),
        isOn() || st.commercial ? el('button', { class: 'psp-btn psp-btn--link', type: 'button', onclick: () => actions.restore() }, st.commercial ? 'Already subscribed? Restore subscription' : 'Already bought? Restore purchase') : null),
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
    els.resetText = el('span', { class: 'psp-meter-reset' }, resetText(c));
    els.topUp = el('button', { class: 'psp-btn psp-btn--sm psp-topup', type: 'button', onclick: () => topUp() });
    els.meter = el('div', { class: 'psp-meter', 'data-level': level }, el('div', { class: 'psp-meter-text' }, els.meterText), els.bar, els.resetText, els.topUp);
    syncTopUp();
    return els.meter;
  }

  // The top-up button sits in the credits display for builder and client logins, whenever top-ups are allowed.
  function syncTopUp() {
    if (!els.topUp) return;
    const st = getState();
    const show = canTopUp(st.credits);
    els.topUp.hidden = !show;
    els.topUp.disabled = busy || toppingUp;
    if (show) els.topUp.textContent = topUpLabel(st.credits, st.session?.kind);
    if (els.resetText) els.resetText.hidden = !els.resetText.textContent;
  }

  function updateMeter() {
    if (!els.meter) return;
    const c = getState().credits;
    els.meter.dataset.level = meterLevel(c);
    els.meterText.textContent = c ? meterText(c) : getState().token ? 'Checking your credits' : 'Credits show once the server is connected';
    els.fill.style.width = `${Math.round(leftFraction(c) * 100)}%`;
    els.bar.setAttribute('aria-valuemax', String(c?.total ?? 0));
    els.bar.setAttribute('aria-valuenow', String(c?.remaining ?? 0));
    if (els.resetText) els.resetText.textContent = resetText(c);
    syncTopUp();
  }

  const readOnly = () => isExhausted(getState().credits);

  function unlockedView() {
    const st = getState();
    els = {};
    els.banners = el('div', { class: 'psp-banners' });
    els.history = el('div', { class: 'psp-history', role: 'log', 'aria-live': 'polite', 'aria-label': 'AI design assistant conversation' });
    els.prompts = el('div', { class: 'psp-prompts' });
    els.lead = el('p', { class: 'psp-ai-lead' }, isCommercial(store.project)
      ? 'Ask the assistant to plan the lot. It places units and buildings, compares layouts and writes a development brief, and you can undo any change in one click. Every figure is indicative, so check with council.'
      : 'Tell the assistant what to change. It edits your plan and you can undo the whole change in one click. It does not check your design against building codes or planning rules.');
    els.input = el('textarea', { class: 'psp-input', rows: 3, maxlength: MAX_MESSAGE, 'aria-label': 'Message to the assistant', placeholder: composePlaceholder() });
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
    renderPrompts();
    const out = [
      el('div', { class: 'psp-ai-head' },
        el('h3', { class: 'psp-ai-title' }, icon('spark', 16), 'AI design assistant'),
        (st.token || !st.devUnlock) ? null : el('span', { class: 'psp-badge', title: 'Developer unlock on localhost' }, 'Dev')),
      meterView(),
      els.banners,
      els.lead,
      els.history,
      els.prompts,
      els.compose,
    ];
    return out;
  }

  const composePlaceholder = () => (isCommercial(store.project) ? 'Describe what to plan, for example: fit the most units' : 'Describe a change, for example: make the deck 1 m deeper');

  // Chips follow the design: the commercial chips in commercial mode, site questions when a real lot is loaded, the usual examples otherwise.
  function renderPrompts() {
    if (!els.prompts) return;
    clear(els.prompts);
    const { prompts, note } = chipsFor(store.project, { hasCatalogue: hasCatalogue() });
    if (els.siteNote) els.siteNote.remove();
    for (const text of prompts) {
      els.prompts.append(el('button', {
        class: 'psp-prompt', type: 'button',
        onclick: () => {
          els.input.value = text;
          syncCompose();
          els.input.focus();
        },
      }, text));
    }
    els.siteNote = note ? el('p', { class: 'psp-muted psp-site-note' }, note) : null;
    if (els.siteNote) els.prompts.after(els.siteNote);
    syncCompose();
  }

  async function topUp() {
    const st = getState();
    const c = st.credits;
    if (toppingUp || busy || !canTopUp(c) || !st.token) return;
    const role = st.session?.kind;
    const ok = await layer.confirmDialog({
      title: 'Top up AI credits',
      message: `Add ${c.topUp.credits} credits now for ${formatAud(c.topUp.amountCents / 100)} including GST? It goes on ${role === 'builder' ? 'your' : "your builder's"} monthly invoice, with no card payment. Top-up credits carry over until used and are spent after your monthly credits.`,
      confirmLabel: `Add ${c.topUp.credits} credits`,
      cancelLabel: 'Cancel',
    });
    if (!ok || disposed) return;
    toppingUp = true;
    syncTopUp();
    try {
      const res = await api.topUp(st.token);
      const next = normaliseCredits(res.credits);
      if (next) actions.setCredits(next);
      layer.notify(`${c.topUp.credits} credits added.`, 'ok');
      track('ps_ai_topup', { credits: c.topUp.credits });
      banners = banners.filter((b) => b.id !== 'exhausted');
    } catch (e) {
      layer.notify(friendlyError(e, { area: 'ai', dev: dev() }), 'error', 8000);
    } finally {
      toppingUp = false;
      if (!disposed) {
        renderBanners();
        syncCompose();
        updateMeter();
      }
    }
  }

  function renderBanners() {
    if (!els.banners) return;
    clear(els.banners);
    const c = getState().credits;
    const list = [...banners];
    if (isExhausted(c)) list.unshift({ id: 'exhausted', kind: 'danger', text: exhaustedText(c), sticky: true });
    else if (c?.commercial && c.warnLevel >= 0.8) list.unshift({ id: 'commercial-warn', kind: 'info', text: warningText({ level: c.warnLevel, remaining: availableCredits(c), usedPercent: c.total ? (c.used / c.total) * 100 : 0 }, c), sticky: true });
    for (const b of list) {
      els.banners.append(el('div', { class: `psp-banner${b.kind === 'danger' ? ' psp-banner--danger' : b.kind === 'info' ? ' psp-banner--info' : ''}`, role: 'status' },
        icon(b.kind === 'info' ? 'info' : 'warning', 16),
        el('span', null, b.text, b.id === 'exhausted' && canBuyMessages(c)
          ? el('span', null, ' ', el('button', { class: 'psp-btn psp-btn--primary psp-btn--sm psp-topup', type: 'button', disabled: !c.commercialTopUp.available, onclick: () => actions.buyMore?.() }, buyMessagesLabel(c)), ' ', el('small', null, topUpOfferText(c)))
          : null,
        b.id === 'exhausted' && canTopUp(c)
          ? el('button', { class: 'psp-btn psp-btn--primary psp-btn--sm psp-topup', type: 'button', disabled: toppingUp, onclick: () => topUp() }, topUpLabel(c, getState().session?.kind))
          : null),
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
    els.input.placeholder = locked ? (getState().session?.kind && getState().session.kind !== 'public' ? 'The assistant is read-only until the monthly credits reset' : 'The assistant is read-only because all credits are used') : composePlaceholder();
    els.send.disabled = locked || busy || !els.input.value.trim();
    els.send.replaceChildren(busy ? el('span', { class: 'psp-spin', 'aria-hidden': 'true' }) : icon('send', 14), busy ? 'Working' : 'Send');
    els.send.setAttribute('aria-busy', busy ? 'true' : 'false');
    els.prompts.hidden = locked || messages.length > 0;
    if (els.siteNote) els.siteNote.hidden = els.prompts.hidden;
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
    if (m.notes?.length) kids.push(el('p', { class: 'psp-changes-title' }, m.commercial ? 'Plan notes' : 'Site check'), changeList(m.notes, false));
    if (m.failed?.length) kids.push(el('p', { class: 'psp-changes-title' }, 'Could not apply'), changeList(m.failed, true));
    if (m.table) kids.push(optionsView(m));
    if (m.brief) kids.push(briefView(m.brief));
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

  // The comparison table from compare_options: one row per option with an Apply button. Applying is one undo step.
  function optionsView(m) {
    const t = m.table;
    const cards = t.rows.map((r) => {
      const applied = m.optionApplied?.id === r.id;
      const [title, ...rest] = r.cells;
      return el('div', { class: `psp-option${applied ? ' is-applied' : ''}`, 'data-option': r.id },
        el('div', { class: 'psp-option-title' }, title),
        el('dl', { class: 'psp-option-grid' }, ...rest.flatMap((c, i) => [el('dt', null, t.columns[i + 1]), el('dd', null, c)])),
        applied
          ? (m.optionApplied.available ? el('button', { class: 'psp-btn psp-btn--sm', type: 'button', onclick: () => undoOption(m) }, icon('undo', 14), 'Undo') : el('span', { class: 'psp-muted' }, 'Applied'))
          : el('button', { class: 'psp-btn psp-btn--sm psp-btn--primary', type: 'button', disabled: busy, onclick: () => applyOption(m, r.id) }, 'Apply this option'));
    });
    return el('div', { class: 'psp-options', 'data-ps': 'ai-options', role: 'group', 'aria-label': 'Layout options' },
      el('p', { class: 'psp-changes-title' }, 'Options'),
      ...cards,
      t.note ? el('p', { class: 'psp-muted' }, t.note) : null);
  }

  // The development brief: kept with the plan set, shown here to read and copy.
  function briefView(b) {
    const copy = el('button', { class: 'psp-btn psp-btn--sm', type: 'button', onclick: async () => {
      try {
        await navigator.clipboard.writeText(b.text);
        layer.notify('Brief copied.', 'ok');
      } catch {
        layer.notify('Copy is not available in this browser. Select the text instead.', 'warn');
      }
    } }, 'Copy brief');
    return el('details', { class: 'psp-brief', open: true },
      el('summary', null, 'Development brief'),
      el('pre', { class: 'psp-brief-text', 'data-ps': 'ai-brief' }, b.text),
      el('div', { class: 'psp-msg-actions' }, copy, el('span', { class: 'psp-muted' }, 'Kept with the plan set')));
  }

  async function applyOption(m, id) {
    const opt = (m.options || []).find((o) => o.id === id);
    if (!opt || busy) return;
    const { core } = await loadCommercial();
    const label = `AI: Applied option ${id}`;
    try {
      store.apply(label, (p) => core.applyScheme(p, opt.scheme));
      m.optionApplied = { id, label, available: true };
      track('ps_ai_option_applied', { option: id });
    } catch (e) {
      layer.notify(friendlyError(e, { area: 'ai', dev: dev() }), 'error', 8000);
    }
    renderHistory();
  }

  function undoOption(m) {
    if (!m.optionApplied?.available) return;
    m.optionApplied.available = false;
    if (store.undoLabel() === m.optionApplied.label) store.undo();
    renderHistory();
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
    const all = Array.isArray(res.ops) ? res.ops : [];
    // Site operations are checked against this design first: no lot, or no setbacks loaded, means no guessing.
    const blocked = all.map((o) => siteCallProblem(o.op, store.project));
    const ops = all.filter((_, i) => !blocked[i]);
    const names = nameResolver(catalogue);
    const phrases = ops.map((o) => describeOp(o.op, o.args, store.project, names));
    const applied = [];
    const failed = [];
    const notes = [];
    let label = null;
    let honest = null; // a refused fit: the reply written before the attempt may say otherwise, so this one message wins
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
          if (r.ok && typeof r.result?.report === 'string') notes.push(r.result.report);
          if (r.ok && r.result?.table) { msg.table = r.result.table; msg.options = r.result.options || []; }
          if (r.ok && r.result?.brief) msg.brief = r.result.brief;
          if (r.ok && r.result?.changed === false) return; // a report or a suggestion: nothing to list or undo
          if (r.ok) applied.push(phrases[i]);
          else {
            failed.push(`${opLabel(ops[i].op)}: ${r.error || 'it could not be applied.'}`);
            if (ops[i].op === 'suggest_site_position' && r.error) honest = r.error;
          }
        });
        if (!applied.length) {
          store.undo(); // nothing changed, so do not leave an empty step in the history
          label = null;
        }
      }
    }
    all.forEach((o, i) => blocked[i] && failed.push(`${opLabel(o.op)}: ${blocked[i]}`));
    for (const r of Array.isArray(res.rejected) ? res.rejected : []) {
      failed.push(`${opLabel(r.op)}: ${r.error || 'it was not valid.'}`);
    }
    msg.pending = false;
    msg.commercial = isCommercial(store.project);
    msg.text = honest || (res.reply || '').trim() || (applied.length || notes.length ? 'Done.' : 'I could not work out a change from that. Try describing it a different way.');
    msg.applied = applied;
    msg.notes = msg.brief || msg.table ? notes.filter((n) => !/^(Development brief written|\d options? worked out)/.test(n)) : notes;
    msg.failed = honest ? [] : failed;
    if (honest) msg.notes = [];
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
    if (c?.kind === 'org' || c?.commercial) return; // the estimate counts top-up credits too, so it cannot be mapped onto the monthly meter
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
    const kind = getState().session?.kind;
    if (e?.code === 'CREDITS_EXHAUSTED' && getState().credits?.commercial) {
      const c = getState().credits;
      actions.setCredits({ ...c, used: c.total, remaining: 0, topUpRemaining: 0, warnLevel: 1, commercialTopUp: e.details?.commercialTopUp === undefined ? c.commercialTopUp : e.details.commercialTopUp, renewsOn: e.details?.renewsOn || c.renewsOn });
      msg.text = exhaustedText(getState().credits);
      track('ps_ai_credits_exhausted', {});
    } else if (kind && kind !== 'public' && (e?.code === 'UNAUTHORISED' || e?.code === 'NOT_ENTITLED')) {
      msg.text = 'Your login could not be verified. Sign in again to use the assistant.';
    } else if (e?.code === 'CREDITS_EXHAUSTED' && kind && kind !== 'public' && !(Number(e.details?.remaining) > 0)) {
      const c = getState().credits;
      const next = normaliseCredits({ ...(c || {}), total: c?.total ?? 0, used: c?.total ?? 0, remaining: 0, topUpRemaining: 0, kind: 'org', monthResetsOn: e.details?.monthResetsOn || c?.monthResetsOn, topUp: e.details?.topUp || c?.topUp });
      if (next) actions.setCredits(next);
      msg.text = exhaustedText(getState().credits);
      track('ps_ai_credits_exhausted', {});
    } else if (e?.code === 'CREDITS_EXHAUSTED' && !(Number(e.details?.remaining) > 0)) {
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
        : st.session && (st.session.kind === 'builder' || st.session.kind === 'client') || st.portal
          ? 'Your sign-in could not be verified. Sign in again to use the AI design assistant.'
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
      let context;
      if (isCommercial(store.project)) {
        const { ctx } = await loadCommercial();
        context = ctx.buildCommercialContext(store.project).text;
      } else context = buildContext(store.project, { activeLevelId }).text;
      const base = { message: text, context, history, activeLevelId, ...(isCommercial(store.project) ? { mode: 'commercial', commercial: true } : {}) };
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
      if (isCommercial(store.project)) await loadCommercial(); // the tool functions must be attached before the reply is applied
      applyReply(res, pending);
      const credits = normaliseCredits(res.credits);
      if (credits) actions.setCredits(credits);
      const w = res.warning;
      if (w && Number.isFinite(w.level) && !getState().credits?.commercial && claimWarning(getState().credits?.kind === 'org' ? `${pid}.${getState().credits.monthResetsOn || ''}` : pid, w.level)) {
        banners.push({ id: `w${w.level}`, kind: w.level >= 0.95 ? 'danger' : 'warn', text: warningText(w, getState().credits) });
        track('ps_ai_credits_warning', { level: w.level });
      }
      if (credits && isExhausted(credits)) track('ps_ai_credits_exhausted', {});
    } catch (e) {
      if (disposed) return;
      if (isAuthLoss(e) && !(st.session?.kind && st.session.kind !== 'public')) {
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
    renderPrompts();
    const label = String(info.label || '');
    let changed = false;
    for (const m of messages) {
      if (m.optionApplied?.available && label !== m.optionApplied.label) {
        m.optionApplied.available = false;
        changed = true;
      }
      if (!m.undo?.available) continue;
      m.undo.available = false;
      if (label === `Undo ${m.undo.label}`) m.undo.done = true;
      changed = true;
    }
    if (els.input) els.input.placeholder = composePlaceholder();
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
      syncTopUp();
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
