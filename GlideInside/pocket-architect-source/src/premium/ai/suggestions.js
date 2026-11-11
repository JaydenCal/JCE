// Prompt chips for the AI panel. With a real lot on the design the chips are about the site; otherwise the usual examples.
// Pure, so it is easy to test. Never offers a setback chip that cannot work: without loaded setbacks it offers the fall and
// level chips only and says why.

import { lotOf } from '../../model/placement.js';

export const BASE_PROMPTS = [
  'Change the roof colour to charcoal',
  'Make the deck 1 m deeper',
  'Add a 3 by 3 m study next to the living room',
  'Flip the plan left to right',
];

export const SITE_PROMPTS = {
  fit: 'Fit this house inside the setbacks',
  garage: 'Move the garage to the front setback',
  fall: 'How much fall is on this lot?',
  check: 'Check the house against the setbacks',
  floor: 'Set the floor level to suit the ground',
  rotate: 'Rotate the house 90 degrees',
};

/** { prompts: [text], note: string|null } for the design. */
export function promptsFor(project) {
  const lot = lotOf(project);
  if (!lot) return { prompts: BASE_PROMPTS, note: null };
  const hasSetbacks = !!(lot.setbacks || lot.envelope);
  const hasLevels = !!(lot.terrain || (Array.isArray(lot.contours) && lot.contours.length));
  const prompts = [];
  if (hasSetbacks) prompts.push(SITE_PROMPTS.fit, SITE_PROMPTS.garage, SITE_PROMPTS.check);
  prompts.push(hasLevels ? SITE_PROMPTS.fall : SITE_PROMPTS.rotate);
  if (hasLevels) prompts.push(SITE_PROMPTS.floor);
  if (hasSetbacks && prompts.length < 5) prompts.push(BASE_PROMPTS[0]);
  return { prompts, note: hasSetbacks ? null : 'Council setbacks are not loaded for this lot, so the assistant cannot check or position the house against them.' };
}
