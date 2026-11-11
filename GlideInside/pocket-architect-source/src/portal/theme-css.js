// CSS text and DOM hooks for the builder colour scheme (see theme.js for the colour maths). Everything here is scoped to
// :root[data-brand-theme], which is only set while a builder staff or client login is active, so the public site and the public
// app keep the Glide Inside look. Override rules are additive; the existing rules are not edited.

import { deriveTheme, themeVars, hasBrand } from './theme.js';

const STYLE_ID = 'gi-brand-theme';
const decl = (o) => Object.entries(o).map(([k, v]) => `${k}:${v}`).join(';');

/** The full stylesheet text for a set of brand colours, or '' when no primary colour is set. */
export function themeCss(colours) {
  const theme = deriveTheme(colours);
  if (!theme) return '';
  const v = themeVars(theme);
  const R = ':root[data-brand-theme]';
  return [
    `${R}{${decl({ ...v.portal, ...v.app, ...v.brand, '--bt-soft': theme.accentSoft })}}`,
    `${R}[data-theme="dark"]{${decl({ ...v.appDark, '--bt-button': theme.dark.button, '--bt-button-ink': theme.dark.buttonInk })}}`,
    `${R} ::selection{background:var(--bt-button);color:var(--bt-button-ink)}`,
    // Builder portal pages: the builder's bar replaces the Glide Inside site header while signed in.
    `${R} .site-header{display:none}`,
    `${R} .pp-brandbar{background:var(--bt-primary);color:var(--bt-primary-ink)}`,
    `${R} .pp-brand small{color:var(--bt-primary-ink);opacity:.82}`,
    `${R} .pp-brandbar .pp-btn{border-color:var(--bt-primary-ink);color:var(--bt-primary-ink);background:transparent}`,
    `${R} .pp-brandbar .pp-btn:hover{background:var(--bt-primary-ink);color:var(--bt-primary)}`,
    `${R} .pp-btn--primary,${R} .pp-btn--sm.pp-btn--primary{background:var(--bt-button);border-color:var(--bt-button);color:var(--bt-button-ink)}`,
    `${R} .pp-btn--primary:hover,${R} .pp-btn--sm.pp-btn--primary:hover{background:var(--bt-button-hover);border-color:var(--bt-button-hover);color:var(--bt-button-ink)}`,
    `${R} .pp-btn:focus-visible,${R} .pp-tab:focus-visible,${R} .pp-link:focus-visible,${R} .pp-pick-item:focus-visible{outline-color:var(--accent)}`,
    `${R} .pp-notice,${R} .pp-trial:not(.pp-trial--ended){background:var(--bt-soft);color:var(--ink)}`,
    `${R} .pp-trial:not(.pp-trial--ended) .pp-trial-text p{color:var(--ink)}`,
    // Pocket Architect: primary buttons, selected segments, chips and the builder strip.
    `${R} .ps-btn--primary,${R} .ps-seg-btn[aria-selected="true"],${R} .ps-seg-btn[aria-pressed="true"],${R} .ps-cat[aria-pressed="true"],${R} .ps-chip[aria-pressed="true"],${R} .pas-btn--primary{background:var(--bt-button);border-color:var(--bt-button);color:var(--bt-button-ink)}`,
    `${R} .ps-topbar{box-shadow:inset 0 3px 0 var(--bt-button)}`,
    `${R} .pas-strip{background:var(--bt-primary);color:var(--bt-primary-ink);border-bottom-color:var(--bt-primary-deep)}`,
    `${R} .pas-strip .pas-brand small,${R} .pas-strip .pas-status{color:var(--bt-primary-ink);opacity:.85}`,
    `${R} .pas-strip .pas-btn--primary{background:var(--bt-primary-ink);border-color:var(--bt-primary-ink);color:var(--bt-primary)}`,
    `${R} .pas-strip .pas-btn:focus-visible,${R} .pas-strip .pas-chip:focus-visible{outline-color:var(--bt-primary-ink)}`,
    // Small credit, kept quiet.
    `.gi-powered{font:600 11px/1.2 var(--ps-font-ui,var(--font,system-ui,sans-serif));letter-spacing:.02em;white-space:nowrap;opacity:.85}`,
    `.pas-strip .gi-powered{color:var(--bt-primary-ink,inherit)}`,
  ].join('\n');
}

/** Browser: set (or replace) the brand stylesheet and mark the page as themed. Returns true when a theme was applied. */
export function applyBrandTheme(colours, doc = typeof document !== 'undefined' ? document : null) {
  if (!doc) return false;
  clearBrandTheme(doc);
  if (!hasBrand(colours)) return false;
  const style = doc.createElement('style');
  style.id = STYLE_ID;
  style.textContent = themeCss(colours);
  doc.head.append(style);
  doc.documentElement.setAttribute('data-brand-theme', '1');
  return true;
}
export function clearBrandTheme(doc = typeof document !== 'undefined' ? document : null) {
  if (!doc) return;
  doc.getElementById(STYLE_ID)?.remove();
  doc.documentElement.removeAttribute('data-brand-theme');
}
/** Scoped variables for a live preview box in the settings page (no page wide change). Returns an inline style string. */
export function previewStyle(colours) {
  const theme = deriveTheme(colours);
  if (!theme) return '';
  return decl({ ...themeVars(theme).brand, '--bt-soft': theme.accentSoft, '--bt-link': theme.link });
}

// Settings page (Branding tab) styles: colour pickers, logo swatches and the live preview. Injected once by the tab.
const SETTINGS_CSS = `
.gi-colours{display:grid;gap:14px;margin-top:22px;padding-top:18px;border-top:1px solid var(--line,#d3dad4)}
.gi-colours h3{margin:0}
.gi-col-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}@media(max-width:700px){.gi-col-grid{grid-template-columns:1fr}}
.gi-col-field label{display:block;font-weight:700;font-size:14px;margin-bottom:5px}
.gi-col-row{display:flex;gap:8px;align-items:center}
.gi-col-row input[type=color]{width:48px;height:44px;padding:2px;border:1px solid var(--line,#d3dad4);border-radius:10px;background:#fff;cursor:pointer;flex:none}
.gi-col-row input[type=text]{font:500 16px var(--font,system-ui);width:11ch;min-height:44px;border:1px solid var(--line,#d3dad4);border-radius:10px;padding:0 10px;background:#fff;color:var(--ink,#16211d);text-transform:lowercase}
.gi-col-row input[aria-invalid=true]{border-color:#9b2c1a}
.gi-swatches{display:flex;gap:18px;flex-wrap:wrap;align-items:center}
.gi-swatch{display:grid;gap:4px;justify-items:center;font:600 12px var(--font,system-ui);color:var(--muted,#55625b)}
.gi-swatch i{display:block;width:44px;height:44px;border-radius:10px;border:1px solid rgba(0,0,0,.2)}
.gi-swatch span{display:flex;gap:4px;flex-wrap:nowrap}
.gi-swatch button{font:600 11px var(--font,system-ui);padding:3px 7px;border:1px solid var(--line,#d3dad4);border-radius:6px;background:#fff;color:var(--ink,#16211d);cursor:pointer}
.gi-dark summary{cursor:pointer;font-weight:700;padding:4px 0}
.gi-prev{border:1px solid var(--line,#d3dad4);border-radius:12px;overflow:hidden;background:#fff;max-width:520px;font:500 14px var(--font,system-ui);color:var(--ink,#16211d)}
.gi-prev-bar{display:flex;align-items:center;gap:10px;padding:10px 14px;background:var(--bt-primary);color:var(--bt-primary-ink)}
.gi-prev-bar img{height:28px;width:auto;max-width:110px;background:#fff;border-radius:5px;padding:2px;object-fit:contain}
.gi-prev-bar strong{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.gi-prev-body{display:grid;gap:10px;padding:14px;background:var(--paper,#f3f5f2)}
.gi-prev-tabs{display:flex;gap:14px;border-bottom:1px solid var(--line,#d3dad4);font-weight:700}
.gi-prev-tabs span{padding:4px 0 7px;color:var(--muted,#55625b)}.gi-prev-tabs span:first-child{color:var(--ink,#16211d);border-bottom:3px solid var(--bt-button)}
.gi-prev-row{display:flex;gap:12px;align-items:center;flex-wrap:wrap}
.gi-prev-btn{display:inline-block;padding:8px 14px;border-radius:9px;font-weight:700;background:var(--bt-button);color:var(--bt-button-ink)}
.gi-prev-link{color:var(--bt-link);font-weight:700;text-decoration:underline}
.gi-prev-note{background:var(--bt-soft);padding:8px 10px;border-radius:8px;font-size:13px}
.gi-prev-foot{padding:6px 14px;font-size:11px;color:var(--muted,#55625b);border-top:1px solid var(--line,#d3dad4);background:#fff}
.gi-adjust{margin:10px 0 0;padding-left:18px;font-size:13px;color:var(--muted,#55625b)}
`;
export function injectSettingsStyles(doc = typeof document !== 'undefined' ? document : null) {
  if (!doc || doc.getElementById('gi-brand-settings-css')) return;
  const s = doc.createElement('style');
  s.id = 'gi-brand-settings-css';
  s.textContent = SETTINGS_CSS;
  doc.head.append(s);
}
