// Reads the --ps-* design tokens so canvas drawing follows the page theme (light, dark, host brand).

const COLOURS = {
  gridMinor: ['--ps-grid-minor', 'rgba(0,0,0,0.045)'],
  gridMajor: ['--ps-grid-major', 'rgba(0,0,0,0.11)'],
  canvas: ['--ps-canvas', '#ffffff'],
  panel: ['--ps-panel', '#ffffff'],
  ink: ['--ps-ink', '#1a1c20'],
  existing: ['--ps-wall-existing', '#8c9097'],
  demolish: ['--ps-wall-demolish', '#cf3535'],
  line: ['--ps-line', '#2c2f36'],
  lineSoft: ['--ps-line-soft', '#80848c'],
  dim: ['--ps-dim', '#4d5560'],
  accent: ['--ps-accent', '#1b4fd1'],
  accentSoft: ['--ps-accent-soft', '#e6ecfb'],
  text: ['--ps-text', '#1a1c20'],
  muted: ['--ps-muted', '#5a5e66'],
  roomA: ['--ps-room-a', 'rgba(90,96,106,0.06)'],
  roomB: ['--ps-room-b', 'rgba(25,150,165,0.12)'],
  roomC: ['--ps-room-c', 'rgba(120,90,200,0.09)'],
  roomD: ['--ps-room-d', 'rgba(130,134,142,0.16)'],
  outdoor: ['--ps-room-outdoor', 'rgba(30,140,85,0.45)'],
  ghostOk: ['--ps-ghost-ok', 'rgba(27,79,209,0.55)'],
  ghostBad: ['--ps-ghost-bad', 'rgba(181,40,40,0.65)'],
  danger: ['--ps-danger', '#b52828'],
  warning: ['--ps-warning', '#935800'],
  ok: ['--ps-ok', '#17724a'],
};
const FONTS = {
  ui: ['--ps-font-ui', 'system-ui, sans-serif'],
  label: ['--ps-font-label', 'system-ui, sans-serif'],
  mono: ['--ps-font-mono', 'ui-monospace, monospace'],
};

export function readTheme(el) {
  const cs = getComputedStyle(el);
  const t = { c: {}, f: {} };
  let key = '';
  for (const [k, [name, fb]] of Object.entries(COLOURS)) {
    t.c[k] = cs.getPropertyValue(name).trim() || fb;
    key += t.c[k];
  }
  for (const [k, [name, fb]] of Object.entries(FONTS)) t.f[k] = cs.getPropertyValue(name).trim() || fb;
  t.key = key;
  return t;
}

// Tint token for a room type.
const WET = ['bathroom', 'ensuite', 'wc', 'laundry', 'kitchen', 'pantry'];
const SLEEP = ['bedroom', 'robe'];
const SERVICE = ['garage', 'carport', 'workshop', 'store'];
export function roomTint(theme, type) {
  if (WET.includes(type)) return theme.c.roomB;
  if (SLEEP.includes(type)) return theme.c.roomC;
  if (SERVICE.includes(type)) return theme.c.roomD;
  return theme.c.roomA;
}
