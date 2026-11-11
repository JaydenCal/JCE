// Styles for the signed in strip in Pocket Architect (builder staff and client logins). Prefix pas-, colours from --ps-* tokens.

const CSS = `
.pas-strip{display:flex;align-items:center;gap:8px 10px;flex-wrap:wrap;padding:6px 10px;background:var(--ps-panel-2,#f5f5f6);border-bottom:1px solid var(--ps-border,#dcdde0);font:500 13px var(--ps-font-ui,system-ui,sans-serif);color:var(--ps-text,#1a1c20)}
.pas-brand{display:flex;align-items:center;gap:8px;min-width:0;margin-right:6px}
.pas-brand img{height:26px;width:auto;max-width:120px;object-fit:contain;background:#fff;border-radius:3px;padding:2px}
.pas-brand strong{font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:200px}
.pas-brand small{color:var(--ps-muted,#5a5e66);font-size:11px;white-space:nowrap}
.pas-spacer{flex:1 1 0;min-width:0}
.pas-btn{display:inline-flex;align-items:center;gap:6px;font:600 13px var(--ps-font-ui,system-ui,sans-serif);color:var(--ps-text,#1a1c20);background:var(--ps-panel,#fff);border:1px solid var(--ps-border-strong,#b6b8bd);border-radius:var(--ps-radius,5px);padding:0 11px;min-height:32px;cursor:pointer;text-decoration:none;white-space:nowrap}
.pas-btn:hover{background:var(--ps-hover,#eeeff1)}
.pas-btn:focus-visible,.pas-item:focus-visible,.pas-chip:focus-visible{outline:2px solid var(--ps-focus,#1b4fd1);outline-offset:2px}
.pas-btn--primary{background:var(--ps-accent,#1b4fd1);border-color:var(--ps-accent,#1b4fd1);color:var(--ps-accent-ink,#fff)}.pas-btn--primary:hover{filter:brightness(.93);background:var(--ps-accent,#1b4fd1)}
.pas-btn:disabled{opacity:.55;cursor:default}
.pas-chip{display:inline-flex;align-items:center;gap:6px;font:600 12px var(--ps-font-ui,system-ui,sans-serif);border:1px solid var(--ps-border,#dcdde0);background:var(--ps-panel,#fff);border-radius:99px;padding:0 10px;min-height:28px;cursor:pointer;color:var(--ps-text,#1a1c20)}
.pas-chip[data-level=low]{border-color:var(--ps-warning,#935800);background:var(--ps-warning-soft,#f7e9cc)}.pas-chip[data-level=out]{border-color:var(--ps-danger,#b52828);background:var(--ps-danger-soft,#f7dada)}
.pas-status{color:var(--ps-muted,#5a5e66);font-size:12px}
.pas-pop{position:fixed;z-index:60;background:var(--ps-panel,#fff);border:1px solid var(--ps-border-strong,#b6b8bd);border-radius:var(--ps-radius-lg,6px);box-shadow:var(--ps-shadow,0 10px 30px rgba(0,0,0,.2));padding:10px;width:min(420px,calc(100vw - 16px));max-height:min(560px,calc(100vh - 80px));display:flex;flex-direction:column;gap:8px}
.pas-pop h3{margin:0;font:700 14px var(--ps-font-ui,system-ui,sans-serif)}
.pas-pop input[type=search],.pas-pop input[type=text],.pas-modal input[type=text],.pas-modal input[type=number]{font:500 14px var(--ps-font-ui,system-ui,sans-serif);min-height:34px;border:1px solid var(--ps-border-strong,#b6b8bd);border-radius:var(--ps-radius,5px);padding:0 10px;background:var(--ps-field,#fff);color:var(--ps-text,#1a1c20);width:100%;box-sizing:border-box}
.pas-list{overflow:auto;display:grid;gap:6px;min-height:0;padding:2px}
.pas-group{margin:6px 0 0;font:700 11px var(--ps-font-mono,monospace);letter-spacing:.08em;text-transform:uppercase;color:var(--ps-muted,#5a5e66)}
.pas-item{display:flex;gap:10px;align-items:center;text-align:left;width:100%;background:var(--ps-panel,#fff);border:1px solid var(--ps-border,#dcdde0);border-radius:var(--ps-radius,5px);padding:6px;cursor:pointer;font:inherit;color:inherit}
.pas-item:hover{border-color:var(--ps-accent,#1b4fd1);background:var(--ps-accent-soft,#e6ecfb)}
.pas-item img{width:84px;height:52px;flex:none;object-fit:contain;background:#fff;border:1px solid var(--ps-border,#dcdde0);border-radius:3px}
.pas-item span{display:block;min-width:0}.pas-item strong{display:block;font-size:13px}.pas-item small{display:block;color:var(--ps-muted,#5a5e66);font-size:11.5px}
.pas-empty{color:var(--ps-muted,#5a5e66);margin:6px 2px}
.pas-modal-scrim{position:fixed;inset:0;z-index:80;background:var(--ps-scrim,rgba(16,18,22,.42));display:grid;place-items:center;padding:12px}
.pas-modal{background:var(--ps-panel,#fff);border-radius:var(--ps-radius-lg,6px);box-shadow:var(--ps-shadow);width:min(460px,100%);max-height:calc(100vh - 24px);overflow:auto;padding:16px;display:grid;gap:10px}
.pas-modal h2{margin:0;font:700 17px var(--ps-font-ui,system-ui,sans-serif)}.pas-modal p{margin:0;color:var(--ps-muted,#5a5e66)}
.pas-modal label{display:grid;gap:4px;font-weight:600}
.pas-row{display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap}
.pas-place{position:absolute;left:50%;bottom:14px;transform:translateX(-50%);z-index:30;background:var(--ps-panel,#fff);border:1px solid var(--ps-border-strong,#b6b8bd);border-radius:var(--ps-radius-lg,6px);box-shadow:var(--ps-shadow);padding:10px 12px;display:grid;gap:8px;width:min(560px,calc(100% - 16px));font:500 13px var(--ps-font-ui,system-ui,sans-serif);color:var(--ps-text,#1a1c20)}
.pas-place h3{margin:0;font:700 14px var(--ps-font-ui,system-ui,sans-serif)}
.pas-place .pas-row{justify-content:flex-start;align-items:center}
.pas-place .pas-row.pas-end{justify-content:flex-end}
.pas-place input[type=number]{width:76px}
.pas-catch{position:absolute;inset:0;z-index:20;cursor:grab;touch-action:none}.pas-catch:active{cursor:grabbing}
.pas-warn{color:var(--ps-warning,#935800);font-weight:600}
.pas-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
@media(max-width:700px){.pas-brand strong{max-width:120px}.pas-btn .pas-label{display:none}.pas-btn--keep .pas-label{display:inline}}
`;

export function injectStripStyles() {
  if (document.getElementById('pas-styles')) return;
  const style = document.createElement('style');
  style.id = 'pas-styles';
  style.textContent = CSS;
  document.head.append(style);
}
