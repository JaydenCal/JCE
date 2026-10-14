/** Keyboard shortcut rules of the viewer shell, kept out of the component so they can be tested. */

export interface KeyLike { code: string; ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean; repeat?: boolean; target?: unknown }
export interface ModeLike { fpActive: boolean; placeActive: boolean }

/** True when the key event came from a field the user is typing in. */
export function isTypingTarget(t: unknown): boolean {
  const el = t as { tagName?: string; isContentEditable?: boolean } | null | undefined;
  if (!el) return false;
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || !!el.isContentEditable;
}

/**
 * D toggles Design mode. It must NOT while walking in first person (D strafes right there, and entering Design leaves first person),
 * while typing in a field, with Ctrl or Meta held, on key repeat, or while placing items (D duplicates there).
 */
export function designShortcutAllowed(e: KeyLike, m: ModeLike | null | undefined): boolean {
  if (e.code !== 'KeyD' || e.ctrlKey || e.metaKey || e.repeat) return false;
  if (isTypingTarget(e.target)) return false;
  if (!m || m.fpActive || m.placeActive) return false;
  return true;
}
