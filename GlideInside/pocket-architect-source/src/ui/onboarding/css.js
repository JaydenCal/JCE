// One-off style injection. Every selector is prefixed .pso- and uses the app's --ps-* tokens.

const CSS = `
/* An in-page modal (confirmations, title block, design type) takes over until it closes. */
body:has(.ps-scrim) .pso-layer { visibility: hidden; }
.pso-layer { position: fixed; inset: 0; z-index: 900; pointer-events: none; font-family: var(--ps-font-ui); color: var(--ps-text); }
.pso-spot { position: fixed; border-radius: 8px; box-shadow: 0 0 0 9999px rgba(10, 20, 36, 0.52); outline: 2px solid var(--ps-accent-ink); pointer-events: none; transition: left .25s ease, top .25s ease, width .25s ease, height .25s ease; }
.pso-spot[data-none="true"] { box-shadow: 0 0 0 9999px rgba(10, 20, 36, 0.42); outline: none; width: 0; height: 0; }
.pso-spot::after { content: ''; position: absolute; inset: -5px; border: 2px solid var(--ps-accent); border-radius: 11px; animation: pso-pulse 1.8s ease-in-out infinite; }
.pso-card { position: fixed; width: 300px; max-width: calc(100vw - 16px); background: var(--ps-panel); color: var(--ps-text); border: 1px solid var(--ps-border-strong); border-radius: var(--ps-radius-lg); box-shadow: var(--ps-shadow); padding: 12px 14px 12px; pointer-events: auto; font-size: 14px; line-height: 1.4; }
.pso-card[data-centre="true"] { left: 50%; top: 50%; transform: translate(-50%, -50%); }
.pso-step { font-family: var(--ps-font-label); font-size: 12px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--ps-muted); margin: 0 0 2px; display: flex; justify-content: space-between; align-items: center; gap: 8px; }
.pso-title { margin: 0 0 4px; font-size: 16px; font-weight: 600; }
.pso-text { margin: 0 0 8px; color: var(--ps-text); }
.pso-tick { color: var(--ps-ok); font-weight: 600; display: none; }
.pso-card[data-done="true"] .pso-tick { display: inline; }
.pso-anim { display: block; width: 100%; height: auto; background: var(--ps-canvas); border: 1px solid var(--ps-border); border-radius: var(--ps-radius); margin: 0 0 8px; }
.pso-row { display: flex; align-items: center; gap: 8px; margin-top: 4px; }
.pso-grow { flex: 1; }
.pso-btn { font: inherit; font-size: 13px; font-weight: 500; height: 28px; padding: 0 12px; background: var(--ps-field); color: var(--ps-text); border: 1px solid var(--ps-border-strong); border-radius: var(--ps-radius-sm); cursor: pointer; }
.pso-btn:hover { background: var(--ps-hover); }
.pso-btn:focus-visible, .pso-link:focus-visible, .pso-pill:focus-visible, .pso-switch:focus-visible { outline: 2px solid var(--ps-focus); outline-offset: 2px; }
.pso-btn--primary { background: var(--ps-accent); border-color: var(--ps-accent); color: var(--ps-accent-ink); }
.pso-btn--primary:hover { background: var(--ps-accent); filter: brightness(1.1); }
.pso-btn:disabled { opacity: .45; cursor: default; }
.pso-link { font: inherit; font-size: 13px; background: none; border: 0; padding: 2px 0; color: var(--ps-muted); text-decoration: underline; cursor: pointer; }
.pso-link:hover { color: var(--ps-text); }
.pso-dots { display: flex; gap: 4px; }
.pso-dots i { width: 6px; height: 6px; border-radius: 50%; background: var(--ps-border-strong); }
.pso-dots i[data-on="true"] { background: var(--ps-accent); }
.pso-hint { width: 252px; padding: 10px 12px; animation: pso-in .18s ease-out; }
.pso-hint .pso-text { margin-bottom: 6px; }
.pso-hint[data-side="right"]::before, .pso-hint[data-side="left"]::before { content: ''; position: absolute; top: calc(50% - 6px); width: 10px; height: 10px; background: var(--ps-panel); border: 1px solid var(--ps-border-strong); transform: rotate(45deg); }
.pso-hint[data-side="right"]::before { left: -6px; border-right: 0; border-top: 0; }
.pso-hint[data-side="left"]::before { right: -6px; border-left: 0; border-bottom: 0; }
.pso-dock { position: absolute; left: 12px; bottom: 56px; z-index: 8; display: flex; flex-direction: column; align-items: flex-start; gap: 6px; font-family: var(--ps-font-ui); }
.pso-dock--fixed { position: fixed; z-index: 800; }
.pso-pill { display: inline-flex; align-items: center; gap: 6px; height: 26px; padding: 0 10px 0 8px; font: inherit; font-size: 12.5px; font-weight: 500; color: var(--ps-text); background: var(--ps-panel); border: 1px solid var(--ps-border-strong); border-radius: 999px; cursor: pointer; box-shadow: 0 1px 3px rgba(14, 28, 50, .15); }
.pso-pill:hover { background: var(--ps-hover); }
.pso-pill .pso-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--ps-ok); }
.pso-pill[data-on="false"] .pso-dot { background: var(--ps-border-strong); }
.pso-pop { order: -1; width: 232px; background: var(--ps-panel); border: 1px solid var(--ps-border-strong); border-radius: var(--ps-radius-lg); box-shadow: var(--ps-shadow); padding: 10px 12px; font-size: 13px; line-height: 1.4; }
.pso-pop[hidden] { display: none; }
.pso-pop p { margin: 4px 0 8px; color: var(--ps-muted); }
.pso-switchrow { display: flex; align-items: center; justify-content: space-between; gap: 10px; font-weight: 600; }
.pso-switch { position: relative; width: 38px; height: 22px; padding: 0; border: 1px solid var(--ps-border-strong); border-radius: 999px; background: var(--ps-panel-2); cursor: pointer; flex: none; }
.pso-switch::after { content: ''; position: absolute; top: 2px; left: 2px; width: 16px; height: 16px; border-radius: 50%; background: var(--ps-muted); transition: transform .15s ease, background .15s ease; }
.pso-switch[aria-checked="true"] { background: var(--ps-accent); border-color: var(--ps-accent); }
.pso-switch[aria-checked="true"]::after { transform: translateX(16px); background: var(--ps-accent-ink); }
.pso-key { fill: var(--ps-field); stroke: var(--ps-border-strong); }
@keyframes pso-pulse { 0%, 100% { opacity: .9; transform: scale(1); } 50% { opacity: .25; transform: scale(1.03); } }
@keyframes pso-in { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }
@media (prefers-reduced-motion: reduce) {
  .pso-spot, .pso-spot::after, .pso-hint, .pso-switch::after { animation: none; transition: none; }
}
@media (max-width: 599.98px) { .pso-card { width: 280px; } }
`;

export function injectCss() {
  if (document.getElementById('pso-style')) return;
  const s = document.createElement('style');
  s.id = 'pso-style';
  s.textContent = CSS;
  document.head.append(s);
}
