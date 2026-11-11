// Builder colour scheme: validation, readable colour derivation, CSS variable mapping and logo colour picking.
// Pure functions (no DOM at import) so the server, the mock and the tests can share them. See theme-css.js for the CSS text and
// applyBrandTheme for the browser side. Colours are stored as #rrggbb. Only primary is needed to switch a builder on;
// accent defaults to primary. The setback red, green and amber states, the 3D scene and map linework are never recoloured.

export const GI_DEFAULT = { primary: '#12231c', accent: '#a3532d' }; // Glide Inside portal look, used by "Reset to default"
export const COLOUR_KEYS = ['primary', 'accent', 'darkInk', 'darkBg'];
const LABELS = { primary: 'Primary colour', accent: 'Accent colour', darkInk: 'Dark mode text colour', darkBg: 'Dark mode background' };
export const AA = 4.5;
const WHITE = '#ffffff';
const NEAR_BLACK = '#101418';
const PAPER_LIGHT = '#f1f2f4'; // darkest light surface used by the portal and app, so text that passes here passes on white too
const PANEL_DARK = '#0f2037';

// Hex handling ------------------------------------------------------------------------------------------------------------------
/** "#abc", "#AABBCC" or "aabbcc" to "#aabbcc". Returns null when it is not a hex colour. */
export function normaliseHex(v) {
  if (typeof v !== 'string') return null;
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(v.trim());
  if (!m) return null;
  let x = m[1].toLowerCase();
  if (x.length === 3) x = [...x].map((c) => c + c).join('');
  return `#${x}`;
}
export const isHex = (v) => normaliseHex(v) !== null;
export const toRgb = (hex) => { const n = normaliseHex(hex); return [1, 3, 5].map((i) => parseInt(n.slice(i, i + 2), 16)); };
export const fromRgb = ([r, g, b]) => `#${[r, g, b].map((c) => Math.max(0, Math.min(255, Math.round(c))).toString(16).padStart(2, '0')).join('')}`;
const rgba = (hex, a) => { const [r, g, b] = toRgb(hex); return `rgba(${r}, ${g}, ${b}, ${a})`; };

// WCAG 2 contrast -------------------------------------------------------------------------------------------------------------
export function luminance(hex) {
  const [r, g, b] = toRgb(hex).map((c) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
export function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}
/** Mix colour a toward colour b by t (0 to 1). */
export function mix(a, b, t) {
  const x = toRgb(a), y = toRgb(b);
  return fromRgb(x.map((c, i) => c + (y[i] - c) * t));
}
export const darken = (hex, t) => mix(hex, '#000000', t);
export const lighten = (hex, t) => mix(hex, '#ffffff', t);
/** White or near black (pure black for the few mid tones near black fails), whichever reads better on the fill. */
export function inkFor(fill) {
  const w = contrast(fill, WHITE), k = contrast(fill, NEAR_BLACK);
  if (Math.max(w, k) >= AA) return w >= k ? WHITE : NEAR_BLACK;
  return w >= contrast(fill, '#000000') ? WHITE : '#000000'; // mid tones: pure black or white always reaches at least 4.58
}
/**
 * Nudge fg toward black or white until it reaches the contrast ratio against bg. Returns { colour, changed }.
 * Direction follows the background: light surfaces darken the colour, dark surfaces lighten it.
 */
export function ensureContrast(fg, bg, min = AA) {
  if (contrast(fg, bg) >= min) return { colour: fg, changed: false };
  const toward = luminance(bg) > 0.4 ? '#000000' : '#ffffff';
  let lo = 0, hi = 1;
  for (let i = 0; i < 14; i++) { const mid = (lo + hi) / 2; if (contrast(mix(fg, toward, mid), bg) >= min) hi = mid; else lo = mid; }
  return { colour: mix(fg, toward, hi), changed: true };
}
/** A button fill with readable text: keeps the fill when white or near black text already reaches AA, else derives a variant. */
export function buttonColours(fill) {
  const ink = inkFor(fill);
  if (contrast(fill, ink) >= AA) return { fill, ink, changed: false };
  const toward = ink === WHITE ? '#000000' : '#ffffff';
  let lo = 0, hi = 1;
  for (let i = 0; i < 14; i++) { const mid = (lo + hi) / 2; if (contrast(mix(fill, toward, mid), ink) >= AA) hi = mid; else lo = mid; }
  return { fill: mix(fill, toward, hi), ink, changed: true };
}

// Validation ------------------------------------------------------------------------------------------------------------------
/**
 * Brand colours from an API body or form. Returns { ok, colours, errors } where colours has all four keys (hex or null) and
 * errors maps key to a message. Empty string or null clears a colour. undefined keys are left out of `colours` when partial.
 */
export function validateColours(input, { partial = false } = {}) {
  const colours = {};
  const errors = {};
  const src = input && typeof input === 'object' ? input : {};
  for (const k of COLOUR_KEYS) {
    const v = src[k];
    if (v === undefined) { if (!partial) colours[k] = null; continue; }
    if (v === null || v === '') { colours[k] = null; continue; }
    const n = normaliseHex(v);
    if (!n) errors[k] = `${LABELS[k]} must be a hex colour such as #1f6f4a.`;
    else colours[k] = n;
  }
  if (!partial && !errors.primary && !colours.primary && (colours.accent || colours.darkInk || colours.darkBg)) errors.primary = 'Choose a primary colour first.';
  return { ok: Object.keys(errors).length === 0, colours, errors };
}
export const hasBrand = (c) => !!(c && normaliseHex(c.primary));

// Derivation ------------------------------------------------------------------------------------------------------------------
/**
 * Everything the portal and app need from the chosen colours. `adjusted` lists the roles where a chosen colour failed AA and a
 * variant was derived, so the settings page can say so.
 */
export function deriveTheme(colours) {
  if (!hasBrand(colours)) return null;
  const primary = normaliseHex(colours.primary);
  const accent = normaliseHex(colours.accent) || primary;
  const adjusted = [];
  const primaryInk = inkFor(primary);
  const primaryDeep = darken(primary, 0.3);
  const btn = buttonColours(accent);
  if (btn.changed) adjusted.push('Buttons use a slightly adjusted shade of your accent so the text stays readable.');
  const link = ensureContrast(accent, PAPER_LIGHT);
  if (link.changed) adjusted.push('Links and tab text use a darker shade of your accent so they stay readable on white.');
  const accentSoft = mix(accent, WHITE, 0.82);
  const accentSoftLine = mix(accent, WHITE, 0.55);
  // Dark mode (Pocket Architect only): readable accent on the dark panel, optional own text and background colours.
  const darkBg = normaliseHex(colours.darkBg);
  const darkInk = normaliseHex(colours.darkInk);
  const panel = darkBg ? lighten(darkBg, 0.06) : PANEL_DARK;
  const dAccent = ensureContrast(lighten(accent, 0.25), panel).colour;
  const dBtn = buttonColours(dAccent);
  return {
    primary, primaryInk, primaryDeep, accent,
    button: btn.fill, buttonInk: btn.ink, buttonHover: darken(btn.fill, 0.14),
    link: link.colour, accentSoft, accentSoftLine,
    dark: {
      accent: dAccent, button: dBtn.fill, buttonInk: dBtn.ink, accentSoft: mix(dAccent, '#000000', 0.7), focus: lighten(dAccent, 0.15),
      bg: darkBg, canvas: darkBg ? lighten(darkBg, 0.03) : null, panel: darkBg ? panel : null, field: darkBg ? darken(darkBg, 0.15) : null,
      text: darkInk ? ensureContrast(darkInk, darkBg ? panel : PANEL_DARK).colour : null,
    },
    adjusted,
  };
}

/**
 * CSS custom properties for each surface. Keys are the existing design tokens:
 *   portal  (website-live framework.css and portal.css):  --accent, --accent-hover, --accent-soft, --deep, --deep-2
 *   app     (styles.css, light and dark):                 --ps-accent, --ps-accent-ink, --ps-accent-soft, --ps-focus (+ dark surfaces)
 * plus the brand layer --bt-* used by the override rules in theme-css.js.
 */
export function themeVars(theme) {
  if (!theme) return { portal: {}, app: {}, appDark: {}, brand: {} };
  const d = theme.dark;
  return {
    portal: { '--accent': theme.link, '--accent-hover': theme.buttonHover, '--accent-soft': theme.accentSoftLine, '--deep': theme.primary, '--deep-2': theme.primaryDeep },
    app: { '--ps-accent': theme.link, '--ps-accent-ink': theme.buttonInk, '--ps-accent-soft': theme.accentSoft, '--ps-focus': theme.link },
    appDark: {
      '--ps-accent': d.accent, '--ps-accent-ink': d.buttonInk, '--ps-accent-soft': d.accentSoft, '--ps-focus': d.focus,
      ...(d.bg ? { '--ps-bg': d.bg, '--ps-canvas': d.canvas, '--ps-panel': d.panel, '--ps-field': d.field } : {}),
      ...(d.text ? { '--ps-text': d.text } : {}),
    },
    brand: {
      '--bt-primary': theme.primary, '--bt-primary-ink': theme.primaryInk, '--bt-primary-deep': theme.primaryDeep,
      '--bt-button': theme.button, '--bt-button-ink': theme.buttonInk, '--bt-button-hover': theme.buttonHover,
      '--bt-dark-button': d.button, '--bt-dark-button-ink': d.buttonInk,
    },
  };
}

// Logo colour picking -------------------------------------------------------------------------------------------------------------
const rgbToHsl = ([r, g, b]) => {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn;
  if (!d) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1));
  const hh = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [(hh * 60 + 360) % 360, s, l];
};
/**
 * The 2 to 3 dominant colours of an image, from RGBA pixel data (Uint8ClampedArray). Near white, near black, grey and
 * transparent pixels are ignored. Pixels are bucketed on a coarse grid, then similar buckets are merged by hue distance.
 */
export function dominantColours(data, max = 3) {
  const buckets = new Map();
  for (let i = 0; i + 3 < data.length; i += 4) {
    if (data[i + 3] < 200) continue;
    const rgb = [data[i], data[i + 1], data[i + 2]];
    const [h, s, l] = rgbToHsl(rgb);
    if (l > 0.9 || l < 0.12 || s < 0.22) continue; // near white, near black, grey
    const key = `${Math.round(h / 20)}-${Math.round(s * 3)}-${Math.round(l * 4)}`;
    const b = buckets.get(key) || { n: 0, r: 0, g: 0, b: 0, h };
    b.n++; b.r += rgb[0]; b.g += rgb[1]; b.b += rgb[2];
    buckets.set(key, b);
  }
  const ranked = [...buckets.values()].sort((a, b) => b.n - a.n);
  const out = [];
  for (const b of ranked) {
    const hex = fromRgb([b.r / b.n, b.g / b.n, b.b / b.n]);
    const hue = rgbToHsl(toRgb(hex))[0];
    if (out.some((o) => { const dh = Math.abs(o.hue - hue); return Math.min(dh, 360 - dh) < 28; })) continue;
    out.push({ hex, hue, n: b.n });
    if (out.length >= max) break;
  }
  return out.map((o) => o.hex);
}
/** Browser only: dominant colours of a logo data URL, sampled on a small canvas. Resolves to [] when nothing usable is found. */
export function pickColoursFromLogo(dataUrl, max = 3) {
  return new Promise((resolve) => {
    if (typeof document === 'undefined' || !dataUrl) return resolve([]);
    const img = new Image();
    img.onload = () => {
      try {
        const w = 96, h = Math.max(1, Math.round((img.naturalHeight / img.naturalWidth) * w)) || 96;
        const c = document.createElement('canvas');
        c.width = w; c.height = h;
        const g = c.getContext('2d', { willReadFrequently: true });
        g.drawImage(img, 0, 0, w, h);
        resolve(dominantColours(g.getImageData(0, 0, w, h).data, max));
      } catch { resolve([]); }
    };
    img.onerror = () => resolve([]);
    img.src = dataUrl;
  });
}
