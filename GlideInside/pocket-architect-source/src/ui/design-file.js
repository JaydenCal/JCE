// Reading a saved design file. Pure: no DOM, so it is covered by tests/editor2d.test.mjs.

import { migrate, validate } from '../model/schema.js';

// Parse and check a file's text. Returns { project } or { error } with a message fit for the person.
export function parseDesign(text) {
  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    return { error: 'That file is not a Plan Studio design. It could not be read as JSON.' };
  }
  let project;
  try {
    project = migrate(raw);
  } catch (e) {
    return { error: e?.message?.startsWith('Not a Plan Studio') || e?.message?.startsWith('This project') ? `${e.message}.` : 'That file is not a Plan Studio design.' };
  }
  const problems = validate(project);
  if (problems.length) return { error: 'That design file has problems and cannot be opened.', problems };
  return { project };
}
