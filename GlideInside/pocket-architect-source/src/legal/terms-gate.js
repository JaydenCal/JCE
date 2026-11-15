// The terms acceptance gate. Every path that produces a plan PDF or DXF calls
//     const accepted = await requirePlanTerms({ context: 'lot-card-site-pdf' });   // null when the person cancels
// before it generates anything. The gate shows the modal unless this person has already accepted the CURRENT version.
//
// Memory: per user when signed in (the host supplies a subject such as "portal:u_1", "pack:ent_1" or "csub:trial"), per browser otherwise
// ("anon"). Only the current version is remembered; a new version asks again. Where the person is signed in or holds an entitlement the
// host's `record(version, context)` is awaited before generation, and a failure keeps the dialog open (the server also refuses paid
// exports with 409 TERMS_REQUIRED until the acceptance is on record). Anonymous free previews are recorded in this browser only.

import { PLAN_TERMS } from './plan-terms.js';

const KEY = 'gi.planTerms.accepted';

/** Acceptance memory over localStorage. Every access is wrapped: private windows and blocked storage fall back to this page only. */
export function createAcceptanceMemory({ storage = null } = {}) {
  const fallback = new Map();
  const store = storage || (() => { try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch { return null; } })();
  const read = () => {
    try {
      const raw = store?.getItem(KEY);
      if (raw) { const v = JSON.parse(raw); if (v && typeof v === 'object') return v; }
    } catch { /* unreadable */ }
    return Object.fromEntries(fallback);
  };
  const write = (all) => {
    fallback.clear();
    for (const [k, v] of Object.entries(all)) fallback.set(k, v);
    try { store?.setItem(KEY, JSON.stringify(all)); } catch { /* kept for this page only */ }
  };
  return {
    /** { version, acceptedAt } when this subject accepted exactly `version`, else null. */
    get(subject, version) {
      const rec = read()[subject];
      return rec && rec.version === version ? { version: rec.version, acceptedAt: rec.acceptedAt } : null;
    },
    set(subject, version, acceptedAt) { write({ ...read(), [subject]: { version, acceptedAt } }); },
    clear(subject) { const all = read(); delete all[subject]; write(all); },
  };
}

/**
 * host: { terms, memory, getIdentity() => { subject, record: boolean }, record(version, context) => Promise, openDialog(opts) => Promise<boolean>, now }
 * `openDialog({ terms, onConfirm })` resolves true when the person ticks and confirms (onConfirm runs first and may throw to keep it open).
 */
export function createTermsGate(host = {}) {
  const cfg = { terms: PLAN_TERMS, memory: createAcceptanceMemory(), getIdentity: () => ({ subject: 'anon', record: false }), record: null, openDialog: null, now: () => new Date(), ...host };
  let pending = null; // two exports started at once share one dialog
  return {
    configure(next = {}) { Object.assign(cfg, next); },
    get terms() { return cfg.terms; },
    /** True when the current person has accepted the current version (no dialog). */
    isAccepted() { const { subject } = cfg.getIdentity(); return !!cfg.memory.get(subject, cfg.terms.version); },
    /** { version, acceptedAt } of the remembered acceptance, or null. Exporters print this date on the sheets. */
    current() { const { subject } = cfg.getIdentity(); return cfg.memory.get(subject, cfg.terms.version); },
    /** Forget the local acceptance (used after the server answers TERMS_REQUIRED, so the person is asked and recorded again). */
    forget() { const { subject } = cfg.getIdentity(); cfg.memory.clear(subject); },
    /** Resolves { version, acceptedAt } or null when the person cancelled. */
    async require({ context = 'export' } = {}) {
      const id = cfg.getIdentity();
      const have = cfg.memory.get(id.subject, cfg.terms.version);
      if (have) return have;
      if (pending) return pending;
      if (typeof cfg.openDialog !== 'function') return null; // no way to ask: generation stays blocked
      pending = (async () => {
        let acceptedAt = null;
        const ok = await cfg.openDialog({
          terms: cfg.terms,
          onConfirm: async () => {
            acceptedAt = cfg.now().toISOString();
            if (id.record && typeof cfg.record === 'function') await cfg.record(cfg.terms.version, context);
          },
        });
        if (!ok || !acceptedAt) return null;
        cfg.memory.set(id.subject, cfg.terms.version, acceptedAt);
        return { version: cfg.terms.version, acceptedAt };
      })().finally(() => { pending = null; });
      return pending;
    },
  };
}

// The shared gate for the page. The premium layer configures identity and recording; the modal is attached lazily so Node tests and the
// Worker never load DOM code.
export const planTermsGate = createTermsGate({
  openDialog: async (opts) => (await import('./terms-modal.js')).openTermsModal(opts),
});
/** The public page with the same text (website-live/plan-terms.html). */
export const PLAN_TERMS_URL = '/plan-terms.html';
export const planTermsLinkText = () => `Terms of use v${planTermsGate.terms.version}`;
export const requirePlanTerms = (o) => planTermsGate.require(o);
/** { version, acceptedAt } to hand to the exporters (`terms` option), or { version } when nothing is remembered. */
export const termsForExport = () => planTermsGate.current() || { version: planTermsGate.terms.version };
export default planTermsGate;
