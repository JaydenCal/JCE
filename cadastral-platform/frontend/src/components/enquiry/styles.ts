/** Scoped styles. Colours come from the app's CSS variables (RGB triplets, as in globals.css) with safe fallbacks,
 *  so the modal adopts the current theme (paper/gold, dark mode) automatically. */
export const ENQUIRY_CSS = `
.enq{--e-bg:rgb(var(--bg,241 240 236));--e-panel:rgb(var(--panel,var(--surface,255 255 255)));--e-fg:rgb(var(--fg,var(--ink,30 32 36)));
--e-muted:rgb(var(--muted,103 107 114));--e-line:rgb(var(--line,216 214 207));--e-accent:rgb(var(--accent,var(--brand,168 132 47)));
--e-accent-strong:rgb(var(--accent-strong,var(--brand-strong,132 101 28)));--e-accent-fg:rgb(var(--accent-fg,var(--brand-fg,255 255 255)));
--e-danger:rgb(var(--danger,179 50 42));--e-ok:rgb(var(--ok,36 120 66));--e-soft:rgb(var(--subtle,233 231 224));
color:var(--e-fg);font-family:var(--font-body,inherit);font-size:14px;line-height:1.5}
.enq *{box-sizing:border-box}
.enq-backdrop{position:fixed;inset:0;z-index:1000;background:rgb(20 20 22/.55);display:flex;align-items:center;justify-content:center;padding:16px}
.enq-dialog{background:var(--e-panel);border:1px solid var(--e-line);border-radius:12px;width:100%;max-width:720px;max-height:calc(100dvh - 32px);display:flex;flex-direction:column;box-shadow:0 30px 80px -20px rgb(0 0 0/.5)}
.enq-head{display:flex;align-items:flex-start;gap:12px;padding:18px 22px 12px;border-bottom:1px solid var(--e-line)}
.enq-head h2{margin:0;font-family:var(--font-display,inherit);font-weight:500;font-size:22px;line-height:1.2}
.enq-eyebrow{font-family:var(--font-mono,monospace);font-size:11px;letter-spacing:.2em;text-transform:uppercase;color:var(--e-accent-strong);margin-bottom:4px}
.enq-close{margin-left:auto;background:none;border:1px solid var(--e-line);border-radius:6px;width:36px;height:36px;color:var(--e-fg);cursor:pointer;font-size:18px;line-height:1}
.enq-close:hover{background:var(--e-soft)}
.enq-body{padding:16px 22px 22px;overflow-y:auto}
.enq-page{max-width:760px;margin:0 auto;padding:24px 16px 64px}
.enq-page .enq-card{background:var(--e-panel);border:1px solid var(--e-line);border-radius:12px;padding:22px}
.enq-note{background:var(--e-soft);border-left:3px solid var(--e-accent);padding:10px 12px;border-radius:4px;font-size:13px;margin:0 0 16px}
.enq-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px 16px}
.enq-full{grid-column:1/-1}
.enq label.enq-l,.enq legend{display:block;font-size:12px;font-weight:600;letter-spacing:.02em;margin-bottom:4px}
.enq-req{color:var(--e-danger)}
.enq input[type=text],.enq input[type=email],.enq input[type=tel],.enq select,.enq textarea{width:100%;padding:9px 11px;font:inherit;color:var(--e-fg);background:var(--e-bg);border:1px solid var(--e-line);border-radius:6px}
.enq textarea{min-height:110px;resize:vertical}
.enq input:focus-visible,.enq select:focus-visible,.enq textarea:focus-visible,.enq button:focus-visible,.enq a:focus-visible{outline:2px solid var(--e-accent);outline-offset:2px}
.enq [aria-invalid=true]{border-color:var(--e-danger)}
.enq-err{color:var(--e-danger);font-size:12px;margin-top:3px}
.enq fieldset{border:0;margin:0;padding:0;min-width:0}
.enq-checks{display:grid;grid-template-columns:1fr 1fr;gap:6px 16px}
.enq-check{display:flex;gap:8px;align-items:flex-start;font-size:13px}
.enq-check input{margin-top:3px;accent-color:rgb(var(--accent,var(--brand,168 132 47)));width:16px;height:16px;flex:none}
.enq-hint{color:var(--e-muted);font-size:12px}
.enq-privacy{border:1px solid var(--e-line);border-radius:8px;padding:12px 14px;font-size:12.5px;background:var(--e-bg)}
.enq-privacy h3{margin:0 0 6px;font-size:13px}
.enq-privacy p{margin:0 0 6px}
.enq a{color:var(--e-accent-strong);text-decoration:underline}
.enq-actions{display:flex;gap:10px;justify-content:flex-end;flex-wrap:wrap;margin-top:6px}
.enq-btn{font:inherit;font-weight:600;border-radius:6px;padding:10px 20px;cursor:pointer;border:1px solid var(--e-fg);background:transparent;color:var(--e-fg)}
.enq-btn:hover{background:var(--e-soft)}
.enq-btn-primary{background:var(--e-accent-strong);border-color:var(--e-accent-strong);color:var(--e-accent-fg)}
.enq-btn-primary:hover{background:var(--e-fg);border-color:var(--e-fg);color:var(--e-bg)}
.enq-btn:disabled{opacity:.5;cursor:not-allowed}
.enq-banner{border:1px solid var(--e-danger);color:var(--e-danger);border-radius:6px;padding:10px 12px;margin-bottom:12px;font-size:13px}
.enq-success{text-align:center;padding:12px 0 4px}
.enq-ref{display:inline-block;font-family:var(--font-mono,monospace);font-size:18px;letter-spacing:.06em;border:1px dashed var(--e-accent);padding:8px 14px;border-radius:6px;margin:10px 0;user-select:all}
.enq-files{list-style:none;margin:6px 0 0;padding:0;font-size:12.5px}
.enq-files li{display:flex;gap:8px;align-items:center;justify-content:space-between;padding:3px 0}
.enq-link{background:none;border:0;color:var(--e-accent-strong);text-decoration:underline;cursor:pointer;font:inherit;padding:0}
.enq-hp{position:absolute!important;left:-10000px;width:1px;height:1px;overflow:hidden}
.enq-trigger{font:inherit;cursor:pointer}
@media (max-width:640px){
 .enq-backdrop{padding:0;align-items:stretch}
 .enq-dialog{max-width:none;max-height:none;height:100dvh;border-radius:0;border:0}
 .enq-grid,.enq-checks{grid-template-columns:1fr}
 .enq-head,.enq-body{padding-left:16px;padding-right:16px}
 .enq input[type=text],.enq input[type=email],.enq input[type=tel],.enq select,.enq textarea{font-size:16px}
 .enq-actions .enq-btn{flex:1}
}`;
