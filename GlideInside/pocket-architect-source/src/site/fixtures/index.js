// Sample responses for the site lookup while CONFIG.siteMock is true. See tools/make-site-fixtures.mjs.
import tamworth from './tamworth.js';
import townsville from './townsville.js';

export const FIXTURES = [tamworth, townsville];

export function fixtureByState(state) {
  return FIXTURES.find((f) => f.lot.state === state) || FIXTURES[0];
}

// Address suggestions: every sample whose label shares a word with the query, else all of them.
export function mockSearch(q) {
  const words = String(q || '').toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 2);
  const all = FIXTURES.flatMap((f) => f.search.map((s) => ({ ...s, label: `${s.label} (sample)`, sample: true })));
  const hit = all.filter((s) => words.some((w) => s.label.toLowerCase().includes(w)));
  return (hit.length ? hit : all).slice(0, 8);
}
