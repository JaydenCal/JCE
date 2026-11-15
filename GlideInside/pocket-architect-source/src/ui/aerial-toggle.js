// The Aerial on/off button: a labelled eye button (aria-pressed) used on the lot card viewers (housing and commercial), over the 2D plan and the
// 3D view, and in the enlarged top view. State lives in site.lot.layers.aerial (see src/site/aerial-pref.js); the choice is remembered per browser.
import { h } from './dom.js';
import { aerialOn, hasAerial, setAerial } from '../site/aerial-pref.js';

export const AERIAL_CSS = `
.ps-aerial{display:inline-flex;align-items:center;gap:7px;height:30px;padding:0 12px 0 10px!important;border-radius:15px;border:1px solid rgba(255,255,255,.28)!important;background:rgba(10,10,12,.76)!important;-webkit-backdrop-filter:blur(16px);backdrop-filter:blur(16px);color:#fff;font:500 12px/1 system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif;cursor:pointer;white-space:nowrap}
.ps-aerial:hover{background:rgba(40,40,46,.88)!important}
.ps-aerial:focus-visible{outline:2px solid #fff;outline-offset:2px}
.ps-aerial[aria-pressed=false]{color:rgba(255,255,255,.78)}
.ps-aerial svg{width:16px;height:16px;flex:none}
.ps-aerial[disabled]{opacity:.5;cursor:default}
.ps-aerial[hidden]{display:none!important}
.lc-root .lc-aerial{position:absolute;right:64px;top:98px}
.lc-embed.is-compact .lc-aerial{right:12px;top:234px}
.lc-root[data-view="2d"] .lc-aerial,.lc-root[data-view="split"] .lc-aerial{display:none!important}
.ps-aerial-fab{position:absolute;left:12px;bottom:44px;z-index:15}
.ps-stage:has(.lc-root:not([hidden])) .ps-aerial-fab{display:none}
.tv-bar .ps-aerial{height:40px;border-radius:20px;padding:0 14px 0 12px!important}
`;
const EYE = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" stroke-width="2"/></svg>';
const EYE_OFF = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M2 12s3.6-6.5 10-6.5c2 0 3.8.6 5.3 1.5M22 12s-3.6 6.5-10 6.5c-2 0-3.8-.6-5.3-1.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M3 3l18 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';

let cssDone = false;
export function injectAerialCss() {
  if (cssDone || typeof document === 'undefined') return;
  cssDone = true;
  if (document.getElementById('ps-aerial-css')) return;
  const st = document.createElement('style');
  st.id = 'ps-aerial-css';
  st.textContent = AERIAL_CSS;
  document.head.append(st);
}

/** The label the button shows for a state. */
export const aerialLabel = (on) => `Aerial: ${on ? 'On' : 'Off'}`;

/** @returns {{ el: HTMLButtonElement, sync: Function, dispose: Function }} */
export function createAerialToggle({ store, className = '', dataPs = 'aerial-toggle' }) {
  injectAerialCss();
  const label = h('span', { class: 'ps-aerial-t' });
  const icon = h('span', { class: 'ps-aerial-i', 'aria-hidden': 'true' });
  const el = h('button', { class: `ps-aerial ${className}`.trim(), type: 'button', 'aria-pressed': 'true', dataset: { ps: dataPs }, onclick: () => { setAerial(store, !aerialOn(store.project)); sync(); } }, icon, label);
  function sync() {
    const lot = store.project?.site?.lot;
    el.hidden = !lot;
    if (!lot) return;
    const on = aerialOn(store.project);
    const has = hasAerial(store.project);
    el.setAttribute('aria-pressed', String(on));
    el.setAttribute('aria-label', has ? `Aerial imagery, currently ${on ? 'on' : 'off'}. Press to turn it ${on ? 'off' : 'on'}.` : 'Aerial imagery, none for this lot');
    el.title = has ? (on ? 'Turn the aerial imagery off for a clean ground' : 'Turn the aerial imagery on') : 'No aerial imagery for this lot';
    el.disabled = !has;
    icon.innerHTML = on ? EYE : EYE_OFF;
    label.textContent = aerialLabel(on);
  }
  const off = store.on('project', sync);
  sync();
  return { el, sync, dispose: () => off?.() };
}
