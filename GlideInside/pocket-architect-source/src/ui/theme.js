// Light and dark theme. Light is the default whatever the operating system says;
// dark applies only when the visitor (or the host page) chooses it. The choice is remembered in 'ps.theme'.

import { storage } from './dom.js';

const KEY = 'ps.theme';
const listeners = new Set();

export function systemTheme() {
  return 'light';
}

export function currentTheme() {
  const attr = document.documentElement.dataset.theme;
  return attr === 'dark' || attr === 'light' ? attr : 'light';
}

export function applyTheme(theme, { remember = false } = {}) {
  document.documentElement.dataset.theme = theme === 'dark' ? 'dark' : 'light';
  if (remember) storage.set(KEY, theme === 'dark' ? 'dark' : 'light');
  listeners.forEach((fn) => fn(currentTheme()));
}

export function initTheme() {
  const fromUrl = new URLSearchParams(location.search).get('theme');
  const saved = storage.get(KEY);
  const pick = fromUrl === 'dark' || fromUrl === 'light' ? fromUrl : saved === 'dark' || saved === 'light' ? saved : 'light';
  applyTheme(pick);
}

export function onTheme(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
