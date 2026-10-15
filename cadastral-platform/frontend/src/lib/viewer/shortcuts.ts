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

// ---- stage 11: view tools -------------------------------------------------------------------------------------------------------------------------------------

export type ToolShortcut = 'plan' | 'measure' | 'help';
export interface ToolKey extends KeyLike { key?: string }
/**
 * T toggles the top (plan) view, M the measurement tool, H or ? the shortcut help. None of them while typing in a field, with Ctrl or Meta held, on key repeat or
 * while walking in first person (those keys do nothing there, and M would leave the walk by accident). Returns the tool the key asks for, or null.
 */
export function toolShortcut(e: ToolKey, m: ModeLike | null | undefined): ToolShortcut | null {
  if (e.ctrlKey || e.metaKey || e.repeat || isTypingTarget(e.target)) return null;
  const help = e.code === 'KeyH' || e.key === '?';
  if (help) return 'help';
  if (!m || m.fpActive) return null;
  if (e.code === 'KeyT') return 'plan';
  if (e.code === 'KeyM' && !m.placeActive) return 'measure';
  return null;
}

export interface ShortcutDef { keys: string; action: string }
export interface ShortcutGroup { title: string; items: readonly ShortcutDef[] }
/** The shortcut help overlay: what each key does, by mode. Kept next to the rules above so a test can compare them. */
export const SHORTCUT_GROUPS: readonly ShortcutGroup[] = [
  { title: 'Modes', items: [{ keys: 'F', action: 'Walk (first person), when the model has a walkable surface' }, { keys: 'P', action: 'Place items' }, { keys: 'D', action: 'Design objects (not while walking)' }, { keys: 'M', action: 'Measure distance, area or level difference' }, { keys: 'T', action: 'Top (plan) view on and off' }, { keys: 'H or ?', action: 'This help' }] },
  { title: 'Walk', items: [{ keys: 'W A S D or arrows', action: 'Move' }, { keys: 'Shift', action: 'Sprint' }, { keys: 'Space', action: 'Jump' }, { keys: 'C', action: 'Crouch' }, { keys: 'Mouse', action: 'Look (click the view first)' }, { keys: 'Esc', action: 'Leave the walk' }] },
  { title: 'Design', items: [{ keys: 'Click', action: 'Place a point, or add a vertex' }, { keys: 'Double click or Enter', action: 'Finish a line or area' }, { keys: 'Esc', action: 'Cancel the drawing, then clear the selection' }, { keys: 'Delete', action: 'Delete the selected object or vertex' }, { keys: 'Alt', action: 'Hold to switch snapping off' }, { keys: 'Ctrl Z, Ctrl Y', action: 'Undo, redo' }, { keys: 'Q E R', action: 'Turn a building or tank being placed' }] },
  { title: 'Place items', items: [{ keys: 'Q E or wheel', action: 'Rotate' }, { keys: 'G', action: 'Move the selected item' }, { keys: 'D', action: 'Duplicate the selected item' }, { keys: 'Delete', action: 'Delete the selected item' }, { keys: 'Esc', action: 'Cancel' }] },
  { title: 'Measure', items: [{ keys: 'Click', action: 'Add a point on the terrain' }, { keys: 'Backspace', action: 'Remove the last point' }, { keys: 'Esc', action: 'Clear the points' }] },
];
