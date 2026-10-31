// Premium UI styles. Injected once. Every selector starts with .psp- and every colour comes from a --ps-* token
// with a fallback, so the layer looks right inside the app and on its own test page.

export const CSS = `
.psp-scope {
  --psp-bg: var(--ps-panel, #fbfcfe);
  --psp-bg2: var(--ps-panel-2, #eef2f7);
  --psp-field: var(--ps-field, #ffffff);
  --psp-hover: var(--ps-hover, #e3eaf3);
  --psp-text: var(--ps-text, #14202e);
  --psp-muted: var(--ps-muted, #53657a);
  --psp-border: var(--ps-border, #cbd6e2);
  --psp-border-strong: var(--ps-border-strong, #a7b6c9);
  --psp-accent: var(--ps-accent, #1b4fd1);
  --psp-accent-ink: var(--ps-accent-ink, #ffffff);
  --psp-ok: var(--ps-ok, #17724a);
  --psp-warn: var(--ps-warn, var(--ps-warning, #935800));
  --psp-danger: var(--ps-danger, #b52828);
  --psp-scrim: var(--ps-scrim, rgba(10, 20, 36, 0.45));
  --psp-shadow: var(--ps-shadow, 0 10px 30px rgba(14, 28, 50, 0.22));
  --psp-radius: var(--ps-radius, 5px);
  --psp-font: var(--ps-font-ui, system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif);
  --psp-label: var(--ps-font-label, 'Arial Narrow', system-ui, sans-serif);
  --psp-mono: var(--ps-font-mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace);
  font-family: var(--psp-font);
  color: var(--psp-text);
  box-sizing: border-box;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) .psp-scope {
    --psp-bg: var(--ps-panel, #0f2037);
    --psp-bg2: var(--ps-panel-2, #132a46);
    --psp-field: var(--ps-field, #0a1829);
    --psp-hover: var(--ps-hover, #183456);
    --psp-text: var(--ps-text, #e3f0f8);
    --psp-muted: var(--ps-muted, #94abc2);
    --psp-border: var(--ps-border, #224060);
    --psp-border-strong: var(--ps-border-strong, #365d86);
    --psp-accent: var(--ps-accent, #6b99ff);
    --psp-accent-ink: var(--ps-accent-ink, #06142e);
    --psp-ok: var(--ps-ok, #4cc58a);
    --psp-warn: var(--ps-warn, var(--ps-warning, #e9b24c));
    --psp-danger: var(--ps-danger, #ff7a7a);
    --psp-scrim: var(--ps-scrim, rgba(2, 8, 18, 0.62));
    --psp-shadow: var(--ps-shadow, 0 10px 30px rgba(0, 0, 0, 0.55));
  }
}
:root[data-theme="dark"] .psp-scope {
  --psp-bg: var(--ps-panel, #0f2037);
  --psp-bg2: var(--ps-panel-2, #132a46);
  --psp-field: var(--ps-field, #0a1829);
  --psp-hover: var(--ps-hover, #183456);
  --psp-text: var(--ps-text, #e3f0f8);
  --psp-muted: var(--ps-muted, #94abc2);
  --psp-border: var(--ps-border, #224060);
  --psp-border-strong: var(--ps-border-strong, #365d86);
  --psp-accent: var(--ps-accent, #6b99ff);
  --psp-accent-ink: var(--ps-accent-ink, #06142e);
  --psp-ok: var(--ps-ok, #4cc58a);
  --psp-warn: var(--ps-warn, var(--ps-warning, #e9b24c));
  --psp-danger: var(--ps-danger, #ff7a7a);
  --psp-scrim: var(--ps-scrim, rgba(2, 8, 18, 0.62));
  --psp-shadow: var(--ps-shadow, 0 10px 30px rgba(0, 0, 0, 0.55));
}
.psp-scope *, .psp-scope *::before, .psp-scope *::after { box-sizing: border-box; }
.psp-scope [hidden] { display: none !important; }
.psp-icon { flex: none; vertical-align: middle; }
.psp-sr { position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0; }

/* Buttons --------------------------------------------------------------------------------------- */
.psp-btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 6px;
  min-height: 32px; padding: 0 12px;
  border: 1px solid var(--psp-border-strong); border-radius: var(--psp-radius);
  background: var(--psp-field); color: var(--psp-text);
  font: 500 13px/1.1 var(--psp-font); white-space: nowrap; cursor: pointer;
}
.psp-btn:hover:not(:disabled) { background: var(--psp-hover); }
.psp-btn:focus-visible, .psp-input:focus-visible, .psp-prompt:focus-visible, .psp-menu-item:focus-visible { outline: 2px solid var(--psp-accent); outline-offset: 2px; }
.psp-btn:disabled, .psp-btn[aria-disabled="true"] { opacity: 0.6; cursor: not-allowed; }
.psp-btn--primary { background: var(--psp-accent); border-color: var(--psp-accent); color: var(--psp-accent-ink); font-weight: 600; }
.psp-btn--primary:hover:not(:disabled) { background: color-mix(in srgb, var(--psp-accent) 86%, #000); }
.psp-btn--danger { background: var(--psp-danger); border-color: var(--psp-danger); color: #fff; }
.psp-btn--ghost { background: transparent; border-color: transparent; }
.psp-btn--block { display: flex; width: 100%; }
.psp-btn--sm { min-height: 28px; padding: 0 9px; font-size: 12.5px; }
.psp-btn--link { display: inline; min-height: 0; padding: 0; border: 0; background: none; color: var(--psp-accent); font: inherit; text-decoration: underline; white-space: normal; text-align: left; }
.psp-btn--link:hover:not(:disabled) { background: none; text-decoration-thickness: 2px; }
.psp-btn--icon { width: 32px; padding: 0; }
.psp-spin { display: inline-block; width: 14px; height: 14px; border: 2px solid currentColor; border-right-color: transparent; border-radius: 50%; animation: psp-rot 0.8s linear infinite; }
@keyframes psp-rot { to { transform: rotate(360deg); } }

/* Top bar --------------------------------------------------------------------------------------- */
.psp-bar { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; }
.psp-menu-wrap { position: relative; display: inline-flex; }
.psp-menu {
  position: fixed; z-index: 80; width: min(300px, calc(100vw - 16px)); padding: 6px;
  background: var(--psp-bg); border: 1px solid var(--psp-border-strong); border-radius: var(--psp-radius); box-shadow: var(--psp-shadow);
}
.psp-menu[hidden] { display: none; }
.psp-menu-head { padding: 6px 8px 4px; font: 600 11px/1.2 var(--psp-label); letter-spacing: 0.08em; text-transform: uppercase; color: var(--psp-muted); }
.psp-menu-item {
  display: grid; grid-template-columns: 1fr auto; align-items: center; gap: 2px 10px; width: 100%;
  padding: 8px; border: 0; border-radius: var(--psp-radius); background: transparent; color: var(--psp-text);
  text-align: left; font: 500 13.5px/1.25 var(--psp-font); cursor: pointer;
}
.psp-menu-item:hover:not(:disabled), .psp-menu-item:focus-visible { background: var(--psp-hover); }
.psp-menu-item small { grid-column: 1; color: var(--psp-muted); font-weight: 400; font-size: 12px; }
.psp-menu-item .psp-icon { grid-column: 2; grid-row: 1 / span 2; color: var(--psp-muted); }
.psp-menu-item:disabled { opacity: 0.6; cursor: progress; }
.psp-menu-foot { margin-top: 4px; padding: 8px 8px 6px; border-top: 1px solid var(--psp-border); font-size: 12px; color: var(--psp-muted); }
.psp-chip {
  display: inline-flex; align-items: center; gap: 6px; min-height: 28px; padding: 0 10px;
  border: 1px solid var(--psp-ok); border-radius: 999px; color: var(--psp-ok);
  background: color-mix(in srgb, var(--psp-ok) 10%, transparent);
  font: 600 12.5px/1 var(--psp-font); white-space: nowrap; cursor: pointer;
}
.psp-chip:hover { background: color-mix(in srgb, var(--psp-ok) 18%, transparent); }
.psp-chip:focus-visible { outline: 2px solid var(--psp-accent); outline-offset: 2px; }

/* Modal layer ----------------------------------------------------------------------------------- */
.psp-layer { position: fixed; inset: 0; z-index: 90; pointer-events: none; }
.psp-layer > * { pointer-events: auto; }
.psp-scrim { position: absolute; inset: 0; display: grid; place-items: center; padding: 16px; overflow: auto; background: var(--psp-scrim); }
.psp-modal {
  display: flex; flex-direction: column; width: min(520px, 100%); max-height: min(calc(100vh - 32px), 760px);
  background: var(--psp-bg); color: var(--psp-text); border: 1px solid var(--psp-border-strong);
  border-radius: calc(var(--psp-radius) + 1px); box-shadow: var(--psp-shadow);
}
.psp-modal--sm { width: min(420px, 100%); }
.psp-modal-head { display: flex; align-items: center; gap: 8px; padding: 16px 18px 8px; }
.psp-modal-head h2 { flex: 1; margin: 0; font: 600 18px/1.25 var(--psp-font); }
.psp-modal-body { min-height: 0; padding: 4px 18px 16px; overflow-y: auto; font-size: 14px; line-height: 1.5; }
.psp-modal-body p { margin: 0 0 10px; }
.psp-modal-foot { display: flex; flex-wrap: wrap; justify-content: flex-end; align-items: center; gap: 8px; padding: 12px 18px; border-top: 1px solid var(--psp-border); }
.psp-modal-foot[hidden] { display: none; }
.psp-modal-foot .psp-grow { flex: 1 1 auto; }
.psp-hero { display: flex; align-items: baseline; flex-wrap: wrap; gap: 4px 10px; margin: 2px 0 12px; }
.psp-price { font: 600 30px/1 var(--psp-label); letter-spacing: 0.01em; }
.psp-price-note { color: var(--psp-muted); font-size: 13px; }
.psp-includes { display: grid; gap: 8px; margin: 0 0 12px; padding: 0; list-style: none; }
.psp-includes li { display: grid; grid-template-columns: 18px 1fr; gap: 8px; }
.psp-includes .psp-icon { margin-top: 2px; color: var(--psp-ok); }
.psp-fine { margin: 0 0 8px; color: var(--psp-muted); font-size: 12px; line-height: 1.5; }
.psp-note { display: flex; gap: 8px; margin: 0 0 12px; padding: 9px 11px; border: 1px solid var(--psp-border); border-radius: var(--psp-radius); background: var(--psp-bg2); font-size: 13px; line-height: 1.45; }
.psp-note .psp-icon { margin-top: 1px; }
.psp-note--warn { border-color: var(--psp-warn); background: color-mix(in srgb, var(--psp-warn) 12%, var(--psp-bg)); }
.psp-note--danger { border-color: var(--psp-danger); background: color-mix(in srgb, var(--psp-danger) 10%, var(--psp-bg)); }
.psp-note--ok { border-color: var(--psp-ok); background: color-mix(in srgb, var(--psp-ok) 10%, var(--psp-bg)); }
.psp-field { display: grid; gap: 4px; margin: 0 0 10px; }
.psp-label { font: 600 12px/1.2 var(--psp-label); letter-spacing: 0.05em; text-transform: uppercase; color: var(--psp-muted); }
.psp-input {
  width: 100%; min-height: 36px; padding: 6px 10px;
  border: 1px solid var(--psp-border-strong); border-radius: var(--psp-radius);
  background: var(--psp-field); color: var(--psp-text); font: 14px/1.35 var(--psp-font);
}
textarea.psp-input { resize: vertical; min-height: 64px; }
.psp-error { margin: 0 0 10px; color: var(--psp-danger); font-size: 13px; }
.psp-kv { display: grid; grid-template-columns: auto 1fr; gap: 4px 12px; margin: 0 0 12px; font-size: 13px; }
.psp-kv dt { color: var(--psp-muted); }
.psp-kv dd { margin: 0; min-width: 0; overflow-wrap: anywhere; }
.psp-mono { font-family: var(--psp-mono); font-size: 12.5px; }
.psp-copy-row { display: flex; align-items: center; gap: 6px; }
.psp-center { display: grid; justify-items: center; gap: 10px; padding: 12px 0; text-align: center; }
.psp-center .psp-spin { width: 26px; height: 26px; border-width: 3px; color: var(--psp-accent); }

/* Toasts ---------------------------------------------------------------------------------------- */
.psp-toasts { position: absolute; left: 50%; bottom: 48px; display: grid; justify-items: center; gap: 6px; width: min(520px, calc(100% - 24px)); transform: translateX(-50%); pointer-events: none; }
.psp-toast {
  pointer-events: auto; max-width: 100%; padding: 9px 13px; border-radius: var(--psp-radius);
  background: var(--psp-text); color: var(--psp-bg); box-shadow: var(--psp-shadow); font-size: 13.5px; line-height: 1.4;
  animation: psp-in 0.18s ease-out;
}
.psp-toast[data-kind="ok"] { background: var(--psp-ok); color: #fff; }
.psp-toast[data-kind="error"] { background: var(--psp-danger); color: #fff; }
.psp-toast[data-kind="warn"] { background: var(--psp-warn); color: #fff; }
@keyframes psp-in { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }

/* Assistant panel ------------------------------------------------------------------------------- */
.psp-ai { display: flex; flex-direction: column; gap: 10px; padding: 2px 0 6px; font-size: 13px; line-height: 1.45; }
.psp-ai-head { display: flex; align-items: center; gap: 8px; }
.psp-ai-title { display: flex; align-items: center; gap: 6px; flex: 1; margin: 0; font: 600 15px/1.2 var(--psp-font); }
.psp-ai-title .psp-icon { color: var(--psp-accent); }
.psp-badge { padding: 1px 7px; border: 1px solid var(--psp-border-strong); border-radius: 999px; color: var(--psp-muted); font: 600 11px/1.5 var(--psp-label); letter-spacing: 0.08em; text-transform: uppercase; }
.psp-ai p { margin: 0; }
.psp-ai-lead { color: var(--psp-muted); }
.psp-ai-label { margin: 2px 0 -4px; font: 600 11.5px/1.2 var(--psp-label); letter-spacing: 0.08em; text-transform: uppercase; color: var(--psp-muted); }
.psp-meter { display: grid; gap: 4px; }
.psp-meter-bar { height: 6px; overflow: hidden; border: 1px solid var(--psp-border); border-radius: 4px; background: var(--psp-bg2); }
.psp-meter-fill { height: 100%; width: 0; background: var(--psp-accent); transition: width 0.3s ease; }
.psp-meter[data-level="warn"] .psp-meter-fill { background: var(--psp-warn); }
.psp-meter[data-level="danger"] .psp-meter-fill { background: var(--psp-danger); }
.psp-meter-text { display: flex; justify-content: space-between; gap: 8px; color: var(--psp-muted); font-size: 12px; }
.psp-banners { display: grid; gap: 6px; }
.psp-banners:empty { display: none; }
.psp-banner {
  display: flex; align-items: flex-start; gap: 8px; padding: 8px 10px;
  border: 1px solid var(--psp-warn); border-radius: var(--psp-radius);
  background: color-mix(in srgb, var(--psp-warn) 12%, var(--psp-bg)); font-size: 12.5px;
}
.psp-banner > span:first-of-type { flex: 1; }
.psp-banner--danger { border-color: var(--psp-danger); background: color-mix(in srgb, var(--psp-danger) 10%, var(--psp-bg)); }
.psp-banner--info { border-color: var(--psp-border-strong); background: var(--psp-bg2); }
.psp-banner .psp-btn--icon { width: 24px; min-height: 24px; margin: -3px -4px -3px 0; }
.psp-history {
  display: flex; flex-direction: column; gap: 8px; min-height: 96px; max-height: 46vh; overflow-y: auto; padding: 8px;
  border: 1px solid var(--psp-border); border-radius: calc(var(--psp-radius) + 1px); background: color-mix(in srgb, var(--psp-bg2) 55%, transparent);
}
.psp-history:empty { display: none; }
.psp-msg { max-width: 100%; padding: 8px 10px; border: 1px solid var(--psp-border); border-radius: var(--psp-radius); background: var(--psp-field); overflow-wrap: anywhere; }
.psp-msg--user { align-self: flex-end; max-width: 92%; border-color: color-mix(in srgb, var(--psp-accent) 40%, var(--psp-border)); background: color-mix(in srgb, var(--psp-accent) 11%, var(--psp-bg)); }
.psp-msg--system { background: var(--psp-bg2); color: var(--psp-muted); }
.psp-msg--error { border-color: var(--psp-danger); background: color-mix(in srgb, var(--psp-danger) 8%, var(--psp-bg)); }
.psp-msg p + p { margin-top: 6px; }
.psp-changes { margin: 6px 0 0; padding: 0; list-style: none; display: grid; gap: 3px; }
.psp-changes li { display: grid; grid-template-columns: 16px 1fr; gap: 6px; }
.psp-changes .psp-icon { margin-top: 2px; color: var(--psp-ok); }
.psp-changes--fail .psp-icon { color: var(--psp-warn); }
.psp-changes-title { margin: 8px 0 0 !important; font: 600 11.5px/1.2 var(--psp-label); letter-spacing: 0.08em; text-transform: uppercase; color: var(--psp-muted); }
.psp-msg-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-top: 8px; }
.psp-muted { color: var(--psp-muted); font-size: 12px; }
.psp-dots { display: inline-flex; gap: 4px; align-items: center; height: 18px; }
.psp-dots i { width: 6px; height: 6px; border-radius: 50%; background: var(--psp-muted); animation: psp-bounce 1.1s ease-in-out infinite; }
.psp-dots i:nth-child(2) { animation-delay: 0.15s; }
.psp-dots i:nth-child(3) { animation-delay: 0.3s; }
@keyframes psp-bounce { 0%, 80%, 100% { opacity: 0.35; transform: none; } 40% { opacity: 1; transform: translateY(-3px); } }
.psp-prompts { display: flex; flex-wrap: wrap; gap: 6px; }
.psp-prompt {
  display: inline-flex; align-items: center; gap: 6px; min-height: 30px; padding: 3px 11px;
  border: 1px solid var(--psp-border-strong); border-radius: 999px; background: var(--psp-field); color: var(--psp-text);
  font: 400 12.5px/1.25 var(--psp-font); text-align: left; cursor: pointer;
}
.psp-prompt:hover:not(:disabled) { background: var(--psp-hover); }
.psp-prompt:disabled { border-style: dashed; color: var(--psp-muted); cursor: not-allowed; }
.psp-prompt .psp-icon { color: var(--psp-muted); }
.psp-modal--xl { width: min(1200px, 100%); height: min(calc(100vh - 32px), 860px); max-height: none; }
.psp-modal--xl .psp-modal-body { display: flex; flex-direction: column; padding: 4px 18px 12px; overflow: hidden; }
.psp-pv-setup { display: flex; align-items: center; gap: 8px 10px; flex-wrap: wrap; padding: 8px 10px; margin: 0 0 8px; border: 1px solid var(--psp-border); border-radius: var(--psp-radius); background: var(--psp-bg2); font-size: 12.5px; }
.psp-pv-setup label { color: var(--psp-muted); }
.psp-pv-setup .psp-select { font: inherit; padding: 4px 6px; border: 1px solid var(--psp-border); border-radius: var(--psp-radius); background: var(--psp-bg); color: var(--psp-text); }
.psp-pv-setupnote { flex: 1 1 14em; min-width: 0; color: var(--psp-muted); }
.psp-pv-setupnote.is-warn { color: var(--psp-danger); }
.psp-pv-wrap { display: flex; flex-direction: column; flex: 1; min-height: 0; }
.psp-pv-status { display: flex; align-items: center; gap: 8px; margin: 8px 0; color: var(--psp-muted); }
.psp-pv-status.is-error { color: var(--psp-danger); }
.psp-pv { display: grid; grid-template-columns: 156px minmax(0, 1fr); gap: 12px; flex: 1; min-height: 0; }
.psp-pv[hidden] { display: none; }
.psp-pv-rail { display: flex; flex-direction: column; gap: 8px; overflow-y: auto; padding: 2px 4px 2px 0; }
.psp-pv-thumb { display: grid; justify-items: center; gap: 2px; padding: 5px; border: 2px solid var(--psp-border); border-radius: var(--psp-radius); background: var(--psp-bg2); color: var(--psp-muted); font: 600 12px/1.2 var(--psp-font); cursor: pointer; }
.psp-pv-thumb canvas { display: block; width: 100%; height: auto; background: #fff; }
.psp-pv-thumb.is-on { border-color: var(--psp-accent); color: var(--psp-text); }
.psp-pv-thumb:focus-visible { outline: 2px solid var(--psp-accent); outline-offset: 2px; }
.psp-pv-main { display: flex; flex-direction: column; gap: 8px; min-width: 0; min-height: 0; }
.psp-pv-tools { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.psp-pv-tools .psp-grow { flex: 1 1 auto; }
.psp-pv-label, .psp-pv-zoomlabel { font-size: 12.5px; color: var(--psp-muted); }
.psp-pv-zoomlabel { min-width: 3.2em; text-align: center; }
.psp-pv-stage { flex: 1; min-height: 0; overflow: auto; display: grid; place-items: center; padding: 12px; background: var(--psp-bg2); border: 1px solid var(--psp-border); border-radius: var(--psp-radius); }
.psp-pv-sheet { display: block; max-width: none; background: #fff; box-shadow: 0 2px 10px rgba(0, 0, 0, 0.25); user-select: none; -webkit-user-select: none; -webkit-touch-callout: none; }
.psp-pv-note { font-size: 12px; color: var(--psp-muted); max-width: 46ch; }
.psp-compose { display: grid; gap: 6px; }
.psp-compose-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.psp-locked-box { display: grid; gap: 8px; padding: 12px; border: 1px dashed var(--psp-border-strong); border-radius: calc(var(--psp-radius) + 1px); background: var(--psp-bg2); }

@media (pointer: coarse) {
  .psp-btn { min-height: 40px; }
  .psp-btn--sm { min-height: 36px; }
  .psp-prompt { min-height: 38px; }
  .psp-menu-item { padding: 11px 8px; }
}
@media (max-width: 599.98px) {
  .psp-scrim { place-items: end center; padding: 8px; }
  .psp-modal { max-height: calc(100vh - 16px); }
  .psp-history { max-height: 38vh; }
  .psp-modal--xl { height: calc(100vh - 16px); }
  .psp-pv { grid-template-columns: minmax(0, 1fr); grid-template-rows: auto minmax(0, 1fr); }
  .psp-pv-rail { flex-direction: row; overflow-x: auto; overflow-y: hidden; }
  .psp-pv-thumb { flex: none; width: 96px; }
}
@media (prefers-reduced-motion: reduce) {
  .psp-toast, .psp-spin, .psp-dots i, .psp-meter-fill { animation: none; transition: none; }
}
`;

export function injectStyles(doc = document) {
  if (!doc || doc.getElementById('psp-styles')) return;
  const style = doc.createElement('style');
  style.id = 'psp-styles';
  style.textContent = CSS;
  (doc.head || doc.documentElement).append(style);
}
