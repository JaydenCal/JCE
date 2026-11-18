// Wording and rules shared by the browser and the Worker for free user profiles (server/lib/profiles.js, src/profile/*).
// One source, so the sentence a person sees beside a tick box is the sentence the server records. Plain words, no dashes.

/** Version of the site terms and privacy policy a person accepts when they create a profile (the pages' "Last updated" date). */
export const TERMS_VERSION = '2026-11-18';

/**
 * The exact marketing consent wording, by version. Consent is recorded with the version AND the words, so a contact is only
 * marketable for the wording they actually agreed to. Change the words by adding a NEW version here, never by editing an old one.
 */
export const MARKETING_TEXTS = {
  'mk-2026-11-15': 'Send me occasional Glide Inside updates and offers. You can unsubscribe at any time.',
};
export const MARKETING_TEXT_VERSION = 'mk-2026-11-15';
export const MARKETING_TEXT = MARKETING_TEXTS[MARKETING_TEXT_VERSION];

export const ROLES = [
  ['homeowner', 'Homeowner'],
  ['builder', 'Builder'],
  ['developer', 'Developer'],
  ['other', 'Other'],
];
export const ROLE_IDS = ROLES.map(([id]) => id);

export const DESIGN_KINDS = ['residential', 'commercial'];

/** Rough strength of a password as the person types: { score 0 to 4, label }. A hint only, the real rule is passwordProblem. */
export function passwordStrength(pw) {
  const s = String(pw || '');
  if (!s) return { score: 0, label: '' };
  let score = 0;
  if (s.length >= 10) score += 1;
  if (s.length >= 14) score += 1;
  if (/[a-z]/.test(s) && /[A-Z]/.test(s)) score += 1;
  if (/\d/.test(s) && /[^A-Za-z0-9]/.test(s)) score += 1;
  else if (/\d/.test(s) || /[^A-Za-z0-9]/.test(s)) score += 0.5;
  if (s.length < 10) score = Math.min(score, 1);
  score = Math.max(0, Math.min(4, Math.floor(score)));
  return { score, label: ['Too short or too easy to guess', 'Weak', 'Fair', 'Good', 'Strong'][score] };
}
