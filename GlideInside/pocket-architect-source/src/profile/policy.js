// When to offer "Create a free profile to save your design". No DOM here (covered by tests/free-profile.test.mjs); ui.js supplies the pieces.
//   a. once per session, at the first moment of value: after the first design is placed (in the guided flow, when the person reaches the
//      Check it step) or drawn. Finding the lot alone is not value, so it never starts the prompt
//   b. when the person tries to leave with work that is not saved to a profile (only where the browser allows a leave prompt)
//   c. when they use Save or Share while signed out
//   d. the small Save to profile button, which always opens it
// "Not now" stops a, b and c for the rest of the session (d still works, because the person asked for it).
// Never mid drag, never over another dialog, never to someone who already has an account here (builder or client login, Commercial
// subscriber or trial login, internal account) and never when the server has no profile service.

import { isValueLabel } from './controller.js';

const SESSION_KEY = 'ps.profile.prompt';

export function createPromptPolicy({
  status = () => 'out', otherAccount = () => false, isBusy = () => false, show = () => {}, session = null,
  setTimer = (fn, ms) => setTimeout(fn, ms), clearTimer = (t) => clearTimeout(t), idleMs = 1000, maxIdleTries = 1800,
} = {}) {
  // sessionStorage can be blocked: the flags then live in memory for this page.
  const memory = new Map();
  const read = (k) => {
    try {
      const v = session ? session.getItem(`${SESSION_KEY}.${k}`) : null;
      return v ?? memory.get(k) ?? null;
    } catch {
      return memory.get(k) ?? null;
    }
  };
  const write = (k, v) => {
    memory.set(k, v);
    try {
      session?.setItem(`${SESSION_KEY}.${k}`, v);
    } catch {
      /* the in memory flag stands */
    }
  };

  let edited = false; // a meaningful edit has happened in this session
  let pending = null;
  let open = false;

  const available = () => status() === 'out' && !otherAccount();
  const suppressed = () => read('notnow') === '1';
  const eligible = () => available() && !suppressed();

  function showNow(reason) {
    if (open || !available()) return false;
    open = true;
    show(reason);
    return true;
  }

  /** Wait for a calm moment: not dragging, no dialog open. Gives up quietly after a while. */
  function whenIdle(reason, tries = 0) {
    clearTimer(pending);
    pending = null;
    if (!eligible() || open) return;
    if (isBusy()) {
      if (tries < maxIdleTries) pending = setTimer(() => whenIdle(reason, tries + 1), idleMs);
      return;
    }
    showNow(reason);
  }

  return {
    /** Wire to the store 'project' event. */
    noteEdit(label) {
      if (!isValueLabel(label)) return;
      edited = true;
      if (read('edit') === '1' || !eligible()) return;
      write('edit', '1'); // once per session, whether or not it was shown
      whenIdle('edit');
    },
    /** Save or Share while signed out. Resolves true when the prompt was shown (the save itself carries on either way). */
    onSaveOrShare(kind) {
      if (!eligible() || open) return false;
      return showNow(kind === 'share' ? 'share' : 'save');
    },
    /** The small button. Always opens it for a person who could have a profile. */
    openFromButton: () => showNow('button'),
    /** beforeunload: returns true when the browser should ask before leaving. If the person stays, the prompt is offered. */
    onBeforeUnload(event) {
      if (!eligible() || !edited || open) return false;
      try {
        event.preventDefault();
        event.returnValue = '';
      } catch {
        return false;
      }
      // If the page really leaves, this timer never fires. If the person chose to stay, it does.
      setTimer(() => whenIdle('leave'), 0);
      return true;
    },
    dismiss() {
      open = false;
      write('notnow', '1');
    },
    closed() {
      open = false;
    },
    isOpen: () => open,
    get edited() { return edited; },
    eligible, suppressed, available,
    dispose() {
      clearTimer(pending);
      pending = null;
    },
  };
}
