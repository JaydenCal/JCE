// Credits: the meter text, the warning banners and the "shown once" memory. Pure helpers plus a little storage.

import { storage, plural } from './util.js';

/** Accepts the server's balance shapes ({ total, used, remaining, warnLevel } or the edit reply's `credits`). */
export function normaliseCredits(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const total = Number(raw.total);
  const used = Number(raw.used);
  if (!Number.isFinite(total) || !Number.isFinite(used)) return null;
  const remaining = Number.isFinite(Number(raw.remaining)) ? Number(raw.remaining) : Math.max(0, total - used);
  return { total, used, remaining: Math.max(0, remaining), warnLevel: Number(raw.warnLevel) || 0 };
}

export const meterText = (c) => (c ? `${c.remaining} of ${c.total} credits left` : '');
export const leftFraction = (c) => (c && c.total > 0 ? Math.min(1, Math.max(0, c.remaining / c.total)) : 0);
export const isExhausted = (c) => !!c && c.remaining <= 0;

/** 'ok' | 'warn' (80% used or more) | 'danger' (95% used or more). */
export function meterLevel(c) {
  if (!c || c.total <= 0) return 'ok';
  const used = 1 - leftFraction(c);
  return used >= 0.95 ? 'danger' : used >= 0.8 ? 'warn' : 'ok';
}

/** Banner text for a server warning { level, usedPercent, remaining }. */
export function warningText(w) {
  const left = `${w.remaining} ${plural(w.remaining, 'credit')} left`;
  const percent = Number.isFinite(w.usedPercent) ? Math.round(w.usedPercent) : Math.round(w.level * 100);
  if (w.level >= 0.95) return `Only ${left}. When they run out the assistant becomes read-only. Editing and exports keep working.`;
  if (w.level >= 0.8) return `You have used ${percent}% of the AI credits in this Plan Pack. ${left[0].toUpperCase()}${left.slice(1)}.`;
  if (w.level >= 0.5 && w.level < 0.6) return `You have used half of the AI credits in this Plan Pack. ${left[0].toUpperCase()}${left.slice(1)}.`;
  return `You have used ${percent}% of the AI credits in this Plan Pack. ${left[0].toUpperCase()}${left.slice(1)}.`;
}

export const exhaustedText = (c) =>
  `You have used all ${c?.total ?? ''} AI credits in this Plan Pack, so the assistant is now read-only. Manual editing and exports still work.`.replace('  ', ' ');

// Each threshold is shown once per project, even across reloads.
const key = (projectId) => `ps.ai.warned.${projectId}`;

export function warnedLevels(projectId) {
  try {
    const list = JSON.parse(storage.get(key(projectId)) || '[]');
    return Array.isArray(list) ? list.filter((n) => Number.isFinite(n)) : [];
  } catch {
    return [];
  }
}

/** True the first time a level is seen for this project (and remembers it), false after. */
export function claimWarning(projectId, level) {
  const seen = warnedLevels(projectId);
  if (seen.includes(level)) return false;
  seen.push(level);
  storage.set(key(projectId), JSON.stringify(seen));
  return true;
}
