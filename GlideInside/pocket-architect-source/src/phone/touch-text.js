// Touch wording for tool tips and panel help. A phone has no mouse, hover, keyboard or Q wheel, so the same advice is given in taps and drags.
import { isPhoneMode } from './mode.js';

/** Plain click words to tap words, for lines that need nothing else changed. */
export const touchWords = (s) => String(s || '')
  .replace(/\bdouble[- ]click(s|ing)?\b/gi, (m) => (m[0] === 'D' ? 'Double tap' : 'double tap'))
  .replace(/\bClick(ing)?\b/g, (m) => (m === 'Click' ? 'Tap' : 'Tapping'))
  .replace(/\bclick(ing)?\b/g, (m) => (m === 'click' ? 'tap' : 'tapping'));

/** The desktop text, or the touch text on a phone. */
export const tt = (desktop, touch) => (isPhoneMode() ? touch : desktop);

/** Tool tip cards (first use) in touch words. Every tool that has a tip has a touch version here. */
export const HINT_TEXT_TOUCH = {
  select: 'Tap a piece to select it, then drag it to move it.',
  rotate: 'Tap an item, then drag round it or twist with two fingers to turn it. It snaps to 15 degrees and to the lot edges.',
  room: 'Drag a rectangle on the plan. The walls are drawn for you.',
  wall: 'Tap each corner in turn. Double tap to finish.',
  door: 'Tap a wall to place a door.',
  sliding_door: 'Tap a wall to place a sliding door.',
  garage_door: 'Tap a wall to place a garage door.',
  roller_door: 'Tap a wall to place a roller door.',
  opening: 'Tap a wall to cut a plain opening.',
  window: 'Tap a wall to place a window. It snaps to the wall.',
  furniture: 'Pick an item, then tap the plan to place it. Twist with two fingers or use the rotate buttons to turn it.',
  stairs: 'Drag a rectangle where the stairs should go.',
  deck: 'Drag a rectangle for a deck, patio or alfresco area.',
  tank: 'Tap the plan to place a tank. Choose its size in the panel.',
  measure: 'Tap two points to read the distance. Nothing is saved.',
  underlay: 'Add an image, tap two known points, then enter the true distance to set the scale.',
  status: 'Tap walls or rooms to mark them existing, new or demolish.',
  wheel: 'Tap Choose item to open the furniture list, then pick an item.',
  '3d': 'Drag to orbit and pinch to zoom. Tap a wall to change its finish.',
  walk: 'Use the left thumb pad to move and drag the right side to look around.',
};

/**
 * Any tip, tour or coach sentence in touch words (used on a phone only). Keyboard and mouse advice is replaced, not just reworded.
 */
export function touchLine(text) {
  let s = String(text || '');
  s = s.replace(/Press Q over the plan to open the wheel of items already in your design, then pick one\./, 'Tap Choose item to open the list of furniture, then pick one.');
  s = s.replace(/use W, A, S and D to move\. Hold E near a door to open it\./, 'use the left thumb pad to move and drag the right side to look. Tap the door prompt to open it.');
  s = s.replace(/hover a wall and click to place it/i, 'tap a wall to place it');
  s = s.replace(/Drag to orbit and scroll to zoom/, 'Drag to orbit and pinch to zoom').replace(/Drag to look around and scroll to zoom/, 'Drag to look around and pinch to zoom');
  s = s.replace(/ \((?:[A-Z])\)/g, '');
  s = s.replace(/Click the start, then click each corner\./, 'Tap the start, then tap each corner.');
  s = s.replace(/Click each PI, then double click to finish\./, 'Tap each PI, then double tap to finish.');
  s = s.replace(/ Add curve rounds each PI\./, ' Add curve rounds each PI.');
  return touchWords(s);
}
