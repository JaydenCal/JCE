// Overlay styles for the 3D viewer, injected once as a <style> element by viewer.js.
// Colours come from the --ps-* custom properties defined by the app shell, with fallbacks.

export const VIEWER_CSS = `
.ps3d-root{position:absolute;inset:0;overflow:hidden;background:var(--ps-bg,#e8edf2);touch-action:none;user-select:none;-webkit-user-select:none;font-family:var(--ps-font-ui,system-ui,-apple-system,"Segoe UI",sans-serif);color:var(--ps-text,#1c2430)}
.ps3d-canvas{position:absolute;inset:0;width:100%;height:100%;display:block;outline:none}
.ps3d-hints{position:absolute;left:12px;bottom:12px;display:flex;flex-wrap:wrap;gap:8px;max-width:calc(100% - 24px);pointer-events:none;transition:opacity .5s ease;z-index:5}
.ps3d-hints[hidden]{display:none}
.ps3d-hints.is-faded{opacity:0}
.ps3d-chip{background:var(--ps-panel,#fff);color:var(--ps-text,#1c2430);border:1px solid var(--ps-border,#cfd6de);border-radius:999px;padding:5px 11px;font-size:12px;line-height:1.25;font-weight:500;box-shadow:0 1px 4px rgba(0,0,0,.14)}
.ps3d-note{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;padding:24px;text-align:center;font-size:15px;color:var(--ps-muted,#5b6674);background:var(--ps-bg,#e8edf2)}
.ps3d-picker{position:absolute;z-index:20;width:272px;max-width:calc(100% - 16px);box-sizing:border-box;background:var(--ps-panel,#fff);color:var(--ps-text,#1c2430);border:1px solid var(--ps-border,#cfd6de);border-radius:12px;box-shadow:0 10px 30px rgba(0,0,0,.24);padding:10px 12px 12px;font-size:13px;user-select:none}
.ps3d-picker[hidden]{display:none}
.ps3d-picker-head{display:flex;align-items:center;justify-content:space-between;gap:8px}
.ps3d-picker-head strong{font-size:14px;font-weight:600}
.ps3d-x{width:30px;height:30px;border-radius:8px;border:0;background:transparent;color:var(--ps-muted,#5b6674);font-size:20px;line-height:1;cursor:pointer}
.ps3d-x:hover{background:var(--ps-border,#e2e7ec)}
.ps3d-picker-cur{margin:0 0 8px;color:var(--ps-muted,#5b6674);font-size:12px}
.ps3d-chips{display:flex;flex-wrap:wrap;gap:6px}
.ps3d-chipbtn{border:1px solid var(--ps-border,#cfd6de);background:transparent;color:var(--ps-text,#1c2430);border-radius:999px;padding:5px 10px;font-size:12px;cursor:pointer;font-family:inherit}
.ps3d-chipbtn:hover{border-color:var(--ps-accent,#1f6feb)}
.ps3d-chipbtn[aria-pressed="true"]{background:var(--ps-accent,#1f6feb);border-color:var(--ps-accent,#1f6feb);color:var(--ps-accent-ink,#fff)}
.ps3d-swatches{display:flex;flex-wrap:wrap;gap:7px;margin-top:10px}
.ps3d-swatch{width:26px;height:26px;border-radius:50%;border:2px solid rgba(0,0,0,.18);padding:0;cursor:pointer}
.ps3d-swatch:hover{transform:scale(1.08)}
.ps3d-swatch[aria-pressed="true"]{outline:2px solid var(--ps-accent,#1f6feb);outline-offset:2px}
.ps3d-chipbtn:focus-visible,.ps3d-swatch:focus-visible,.ps3d-x:focus-visible,.ps3d-btn:focus-visible{outline:2px solid var(--ps-accent,#1f6feb);outline-offset:2px}
.ps3d-check{display:flex;align-items:center;gap:6px;margin-top:10px;font-size:12.5px;cursor:pointer}
.ps3d-msg{margin-top:6px;font-size:12px;color:var(--ps-danger,#b3261e)}
.ps3d-msg:empty{display:none}
.ps3d-hud{position:absolute;inset:0;pointer-events:none;z-index:15}
.ps3d-hud[hidden]{display:none}
.ps3d-cross{position:absolute;left:50%;top:50%;width:18px;height:18px;transform:translate(-50%,-50%);opacity:.85}
.ps3d-cross::before,.ps3d-cross::after{content:"";position:absolute;background:#fff;box-shadow:0 0 2px rgba(0,0,0,.7)}
.ps3d-cross::before{left:8px;top:2px;width:2px;height:14px}
.ps3d-cross::after{left:2px;top:8px;width:14px;height:2px}
.ps3d-hudtop{position:absolute;top:12px;left:12px;right:12px;display:flex;align-items:center;gap:10px;z-index:3}
.ps3d-hudhint{background:var(--ps-panel,#fff);color:var(--ps-text,#1c2430);border:1px solid var(--ps-border,#cfd6de);border-radius:999px;padding:6px 12px;font-size:12px;box-shadow:0 1px 4px rgba(0,0,0,.14);transition:opacity .6s ease}
.ps3d-hudhint.is-faded{opacity:0}
.ps3d-btn{pointer-events:auto;min-height:40px;padding:8px 14px;border-radius:10px;border:1px solid var(--ps-border,#cfd6de);background:var(--ps-panel,#fff);color:var(--ps-text,#1c2430);font:600 13px/1 var(--ps-font-ui,system-ui,sans-serif);cursor:pointer;box-shadow:0 1px 4px rgba(0,0,0,.14)}
.ps3d-btn:disabled{opacity:.45;cursor:default}
.ps3d-btn:not(:disabled):hover{border-color:var(--ps-accent,#1f6feb)}
.ps3d-start{position:absolute;left:50%;top:58%;transform:translateX(-50%);background:var(--ps-panel,#fff);color:var(--ps-text,#1c2430);border:1px solid var(--ps-border,#cfd6de);border-radius:999px;padding:8px 16px;font-size:14px;font-weight:600;box-shadow:0 2px 10px rgba(0,0,0,.2)}
.ps3d-start[hidden]{display:none}
.ps3d-levels{position:absolute;right:12px;top:50%;transform:translateY(-50%);display:flex;flex-direction:column;align-items:stretch;gap:8px;z-index:3;text-align:center}
.ps3d-levels[hidden]{display:none}
.ps3d-levelname{background:var(--ps-panel,#fff);color:var(--ps-text,#1c2430);border:1px solid var(--ps-border,#cfd6de);border-radius:8px;padding:5px 10px;font-size:12px;font-weight:600;min-width:64px}
.ps3d-zone{position:absolute;top:0;bottom:0;pointer-events:auto;touch-action:none;z-index:1}
.ps3d-zone[hidden]{display:none}
.ps3d-zone-move{left:0;width:45%}
.ps3d-zone-look{right:0;width:55%}
.ps3d-joy{position:absolute;width:112px;height:112px;margin:0;border-radius:50%;border:2px solid rgba(255,255,255,.75);background:rgba(20,28,40,.22);transform:translate(-50%,-50%);pointer-events:none;z-index:2}
.ps3d-joy[hidden]{display:none}
.ps3d-joyknob{position:absolute;left:50%;top:50%;width:48px;height:48px;border-radius:50%;background:rgba(255,255,255,.85);box-shadow:0 1px 5px rgba(0,0,0,.35);transform:translate(-50%,-50%)}
.ps3d-key{display:inline-block;min-width:18px;padding:2px 5px;border-radius:5px;border:1px solid var(--ps-border,#cfd6de);background:var(--ps-bg,#eef1f5);color:var(--ps-muted,#5b6674);font:600 11px/1.1 var(--ps-font-ui,system-ui,sans-serif);text-align:center}
.ps3d-editbar{position:absolute;top:12px;right:12px;z-index:12;display:flex;flex-wrap:wrap;justify-content:flex-end;align-items:center;gap:8px;max-width:calc(100% - 24px)}
.ps3d-editbar[hidden]{display:none}
.ps3d-edit{pointer-events:auto;display:inline-flex;align-items:center;gap:8px;min-height:40px;padding:6px 12px 6px 10px;border-radius:999px;border:1px solid var(--ps-border,#cfd6de);background:var(--ps-panel,#fff);color:var(--ps-text,#1c2430);font:600 13px/1 var(--ps-font-ui,system-ui,sans-serif);cursor:pointer;box-shadow:0 1px 4px rgba(0,0,0,.18),0 0 0 1px rgba(20,30,45,.04)}
.ps3d-edit:hover{border-color:var(--ps-accent,#1f6feb)}
.ps3d-edit:focus-visible,.ps3d-tool:focus-visible,.ps3d-prompt:focus-visible{outline:2px solid var(--ps-accent,#1f6feb);outline-offset:2px}
.ps3d-edit-sw{position:relative;width:30px;height:18px;border-radius:999px;background:var(--ps-border,#c3cad3);transition:background .15s ease}
.ps3d-edit-sw::after{content:"";position:absolute;left:2px;top:2px;width:14px;height:14px;border-radius:50%;background:#fff;box-shadow:0 1px 2px rgba(0,0,0,.35);transition:transform .15s ease}
.ps3d-edit-state{min-width:22px;color:var(--ps-muted,#5b6674);font-weight:700}
.ps3d-edit.is-on{background:var(--ps-accent,#1f6feb);border-color:var(--ps-accent,#1f6feb);color:var(--ps-accent-ink,#fff)}
.ps3d-edit.is-on .ps3d-edit-sw{background:rgba(255,255,255,.45)}
.ps3d-edit.is-on .ps3d-edit-sw::after{transform:translateX(12px)}
.ps3d-edit.is-on .ps3d-edit-state{color:var(--ps-accent-ink,#fff)}
.ps3d-edit.is-on .ps3d-key{background:rgba(255,255,255,.2);border-color:rgba(255,255,255,.5);color:var(--ps-accent-ink,#fff)}
.ps3d-tools{pointer-events:auto;display:inline-flex;gap:2px;padding:3px;border-radius:12px;border:1px solid var(--ps-border,#cfd6de);background:var(--ps-panel,#fff);box-shadow:0 1px 4px rgba(0,0,0,.18),0 0 0 1px rgba(20,30,45,.04)}
.ps3d-tools[hidden]{display:none}
.ps3d-tool{min-height:34px;padding:6px 12px;border-radius:9px;border:0;background:transparent;color:var(--ps-text,#1c2430);font:600 13px/1 var(--ps-font-ui,system-ui,sans-serif);cursor:pointer}
.ps3d-tool:hover{background:var(--ps-bg,#eef1f5)}
.ps3d-tool[aria-pressed="true"]{background:var(--ps-accent,#1f6feb);color:var(--ps-accent-ink,#fff)}
.ps3d-editmsg{position:absolute;top:100%;right:0;margin-top:8px;pointer-events:none;width:max-content;max-width:min(340px,calc(100vw - 24px));padding:6px 12px;border-radius:12px;border:1px solid var(--ps-border,#cfd6de);background:var(--ps-panel,#fff);color:var(--ps-text,#1c2430);font-size:12.5px;line-height:1.35;text-align:left;box-shadow:0 1px 4px rgba(0,0,0,.18)}
.ps3d-editmsg[hidden]{display:none}
.ps3d-editmsg.is-error{border-color:var(--ps-danger,#b3261e);color:var(--ps-danger,#b3261e)}
.ps3d-tip{position:absolute;z-index:14;pointer-events:none;padding:4px 9px;border-radius:8px;background:#1b2430;color:#fff;font:600 12px/1.3 var(--ps-font-ui,system-ui,sans-serif);white-space:nowrap;box-shadow:0 2px 8px rgba(0,0,0,.3)}
.ps3d-tip[hidden]{display:none}
.ps3d-root.is-editing .ps3d-canvas{outline:2px solid var(--ps-accent,#1f6feb);outline-offset:-2px}
.ps3d-prompt{position:absolute;left:50%;bottom:13%;transform:translateX(-50%);pointer-events:auto;display:inline-flex;align-items:center;gap:10px;min-height:44px;padding:8px 16px 8px 10px;border-radius:999px;border:1px solid var(--ps-border,#cfd6de);background:var(--ps-panel,#fff);color:var(--ps-text,#1c2430);font:600 14px/1 var(--ps-font-ui,system-ui,sans-serif);cursor:pointer;box-shadow:0 3px 14px rgba(0,0,0,.28);z-index:4}
.ps3d-prompt[hidden]{display:none}
.ps3d-prompt .ps3d-key{font-size:13px;padding:4px 8px}
.ps3d-toast{position:absolute;left:50%;bottom:14%;transform:translateX(-50%);z-index:16;max-width:min(420px,calc(100% - 24px));padding:8px 14px;border-radius:12px;border:1px solid var(--ps-border,#cfd6de);background:var(--ps-panel,#fff);color:var(--ps-text,#1c2430);font-size:13px;line-height:1.35;text-align:center;pointer-events:none;box-shadow:0 2px 10px rgba(0,0,0,.22)}
.ps3d-toast[hidden]{display:none}
.ps3d-toast.is-error{border-color:var(--ps-danger,#b3261e);color:var(--ps-danger,#b3261e)}
.ps3d-armbar{position:absolute;left:50%;bottom:22%;transform:translateX(-50%);z-index:17;display:flex;align-items:center;gap:8px;flex-wrap:wrap;justify-content:center;max-width:calc(100% - 24px);padding:6px 8px 6px 14px;border-radius:14px;border:1px solid var(--ps-border,#cfd6de);background:var(--ps-panel,#fff);color:var(--ps-text,#1c2430);font-size:13px;box-shadow:0 2px 10px rgba(0,0,0,.22)}
.ps3d-armbar[hidden]{display:none}
.ps3d-armbar .ps3d-btn{min-height:34px;padding:6px 12px}
.ps3d-itembar{position:absolute;z-index:13;display:flex;align-items:center;gap:6px;flex-wrap:wrap;justify-content:center;max-width:calc(100% - 16px);padding:5px 6px 5px 12px;border-radius:12px;border:1px solid var(--ps-border,#cfd6de);background:var(--ps-panel,#fff);color:var(--ps-text,#1c2430);font-size:12.5px;box-shadow:0 2px 10px rgba(0,0,0,.24);user-select:none}
.ps3d-itembar[hidden]{display:none}
.ps3d-itembar.is-walk{left:50%!important;top:64px!important;transform:translateX(-50%)}
.ps3d-itemname{font-weight:600;margin-right:2px;max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ps3d-itembtn{min-height:32px;padding:5px 10px;border-radius:8px;border:1px solid var(--ps-border,#cfd6de);background:var(--ps-panel,#fff);color:var(--ps-text,#1c2430);font:600 12.5px/1 var(--ps-font-ui,system-ui,sans-serif);cursor:pointer}
.ps3d-itembtn[hidden]{display:none}
.ps3d-itembtn:hover{border-color:var(--ps-accent,#1f6feb)}
.ps3d-itembtn.is-danger{color:var(--ps-danger,#b3261e)}
.ps3d-itembtn.is-danger:hover{border-color:var(--ps-danger,#b3261e)}
.ps3d-itembtn:focus-visible{outline:2px solid var(--ps-accent,#1f6feb);outline-offset:2px}
@media (max-width:560px){.ps3d-hudtop{flex-wrap:wrap;align-items:flex-start}.ps3d-hudhint{border-radius:12px;max-width:calc(100% - 100px)}.ps3d-hints{bottom:8px}}
@media (prefers-reduced-motion:reduce){.ps3d-edit-sw,.ps3d-edit-sw::after{transition:none}.ps3d-hints,.ps3d-hudhint{transition:none}.ps3d-swatch:hover{transform:none}}
`;
