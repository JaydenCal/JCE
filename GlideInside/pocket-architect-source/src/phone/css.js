// Phone mode styles. Everything is scoped to html[data-phone="1"], so the desktop layout is not touched. Injected once at start (injectPhoneCss).
export const PHONE_CSS = `
/* Pieces that only exist for the phone are hidden everywhere else. */
.ps-dock,.ps-quick,.ps-phone-share,.gf-menu,.ps-more-desktop,.ps-phone-view{display:none}
.ps-phone-view:not([hidden]){display:inline-flex}
.ps-sheet-scrim{position:fixed;inset:0;z-index:1090;background:rgba(10,14,20,.5)}
.ps-sheet{position:fixed;left:0;right:0;bottom:0;z-index:1100;max-height:82dvh;display:flex;flex-direction:column;background:var(--ps-panel,#fff);color:var(--ps-text,#1a1c20);border-radius:18px 18px 0 0;box-shadow:0 -8px 30px rgba(0,0,0,.28);padding-bottom:env(safe-area-inset-bottom);font:15px/1.4 var(--ps-font-ui,system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif)}
.ps-sheet *{box-sizing:border-box}
.ps-sheet-grab{width:44px;height:5px;border-radius:3px;background:var(--ps-border-strong,#c3c6cc);margin:8px auto 0}
.ps-sheet-head{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:6px 16px 8px}
.ps-sheet-head h2{margin:0;font-size:18px}
.ps-sheet-close{min-height:44px;min-width:64px;border:0;border-radius:10px;background:transparent;color:var(--ps-accent,#1b4fd1);font-weight:600;font-size:16px;font-family:inherit;}
.ps-sheet-body{overflow:auto;padding:0 12px 14px;overscroll-behavior:contain}
.ps-sheet-list{display:flex;flex-direction:column;gap:8px}
.ps-sheet-item{display:flex;align-items:center;gap:12px;width:100%;min-height:52px;padding:10px 14px;text-align:left;border:1px solid var(--ps-border,#dcdde0);border-radius:12px;background:var(--ps-panel,#fff);color:inherit;font:inherit}
.ps-sheet-item[aria-pressed="true"]{border-color:var(--ps-accent,#1b4fd1);background:var(--ps-accent-soft,#e6ecfb)}
.ps-sheet-item-t{display:flex;flex-direction:column;min-width:0}.ps-sheet-item-t b{font-size:16px}.ps-sheet-item-t small{color:var(--ps-muted,#5a5e66);font-size:13px}
.ps-sheet-note{margin:0 0 10px;color:var(--ps-muted,#5a5e66)}
.ps-sheet-link{width:100%;min-height:48px;border:1px solid var(--ps-border,#dcdde0);border-radius:10px;padding:8px 10px;font:16px system-ui,sans-serif}
.ps-tool-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin-bottom:10px}
.ps-tool-grid--more{margin:10px 0 0}.ps-tool-grid[hidden]{display:none}
.ps-tool-tile{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;min-height:84px;padding:8px 4px;text-align:center;border:1px solid var(--ps-border,#dcdde0);border-radius:12px;background:var(--ps-panel,#fff);color:inherit;font:inherit}
.ps-tool-tile b{font-size:14px}.ps-tool-tile small{color:var(--ps-muted,#5a5e66);font-size:11.5px;line-height:1.2}
.ps-tool-tile[aria-pressed="true"]{border-color:var(--ps-accent,#1b4fd1);background:var(--ps-accent-soft,#e6ecfb);color:var(--ps-accent,#1b4fd1)}
.ps-phone-view{position:fixed;left:12px;bottom:calc(12px + env(safe-area-inset-bottom));z-index:1000;min-height:44px;padding:0 18px;align-items:center;border-radius:999px;border:1px solid rgba(255,255,255,.4);background:rgba(14,16,20,.85);color:#fff;font:600 15px system-ui,sans-serif}

/* ---------------- The guided flow on a phone ---------------- */
html[data-phone="1"] .gf-root[data-kind="residential"]{height:100dvh;bottom:auto}
html[data-phone="1"] .gf-root[data-kind="residential"] .gf-head{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:2px 8px;align-items:center;padding:6px 12px 8px}
html[data-phone="1"] .gf-root[data-kind="residential"] .gf-brand{font-size:15px}
html[data-phone="1"] .gf-root[data-kind="residential"] .gf-help,html[data-phone="1"] .gf-root[data-kind="residential"] .gf-skip{display:none}
/* Find your lot: the sample lot and the upload are real secondary buttons on a phone, never hidden with the header links. */
html[data-phone="1"] .gf-root[data-kind="residential"] .gf-alts{display:flex;flex-direction:column;gap:8px}
html[data-phone="1"] .gf-root[data-kind="residential"] .gf-skip.gf-alt{display:flex;align-items:center;justify-content:center;width:100%;min-height:44px;margin:0!important;padding:8px 14px!important;border:1px solid var(--gf-border);border-radius:12px;background:var(--gf-panel);color:var(--gf-text);font-weight:600;font-size:15px;font-family:inherit;;text-decoration:none;white-space:normal}
html[data-phone="1"] .gf-root[data-kind="residential"] .gf-skip.gf-alt[hidden]{display:none}
html[data-phone="1"] .gf-root[data-kind="residential"] .gf-fail-actions{flex-direction:column}
html[data-phone="1"] .gf-root[data-kind="residential"] .gf-fail-actions .gf-btn{min-height:48px;width:100%}
html[data-phone="1"] .gf-root[data-kind="residential"] .gf-menu{display:inline-flex;align-items:center;justify-content:center;min-height:44px;min-width:72px;padding:0 14px;border:1px solid var(--gf-border);border-radius:12px;background:var(--gf-panel);color:var(--gf-text);font-weight:600;font-size:15px;font-family:inherit;}
html[data-phone="1"] .gf-root[data-kind="residential"] .gf-prog{grid-column:1/-1;order:0;width:100%;flex-basis:auto;justify-content:space-between}
html[data-phone="1"] .gf-root[data-kind="residential"] .gf-prog li{padding:2px 6px}
html[data-phone="1"] .gf-root[data-kind="residential"] .gf-prog li button{min-width:44px;min-height:44px;justify-content:center}
html[data-phone="1"] .gf-root[data-kind="residential"] .gf-body{padding:10px 12px;overflow-x:hidden}
html[data-phone="1"] .gf-root[data-kind="residential"] .gf-title{font-size:20px;margin-bottom:2px}
html[data-phone="1"] .gf-root[data-kind="residential"] .gf-intro{font-size:14px;margin-bottom:10px}
html[data-phone="1"] .gf-root[data-kind="residential"] .gf-foot{gap:10px;padding:10px 12px calc(10px + env(safe-area-inset-bottom));box-shadow:0 -4px 14px rgba(0,0,0,.08)}
html[data-phone="1"] .gf-root[data-kind="residential"] .gf-foot .gf-btn{min-height:52px;font-size:16px;border-radius:12px;padding:10px 12px}
html[data-phone="1"] .gf-root[data-kind="residential"] .gf-foot .gf-btn--primary{flex:2}
html[data-phone="1"] .gf-root[data-kind="residential"] .gf-foot .gf-btn:not(.gf-btn--primary){flex:1}
html[data-phone="1"] .gf-root[data-kind="residential"] .gf-field{flex-wrap:wrap}
html[data-phone="1"] .gf-root[data-kind="residential"] .gf-field input{flex:1 1 100%;font-size:16px;min-height:48px}
html[data-phone="1"] .gf-root[data-kind="residential"] .gf-field .gf-btn{flex:1 1 100%;min-height:48px}
html[data-phone="1"] .gf-root[data-kind="residential"] .gf-suggest li{min-height:48px;display:flex;align-items:center}
/* Step 2: filters in a grid, homes as compact rows, the builder search after the homes. */
html[data-phone="1"] .gf-root[data-step-id="home"] .gf-content>div{display:flex;flex-direction:column}
html[data-phone="1"] .gf-root[data-step-id="home"] .gf-content>div>:first-child{order:5}
html[data-phone="1"] .gf-root[data-step-id="home"] .gf-filters{display:grid;grid-template-columns:1fr 1fr;gap:8px 10px;margin-bottom:10px}
html[data-phone="1"] .gf-root[data-step-id="home"] .gf-filters label{flex-direction:column;align-items:stretch;gap:4px;font-size:13px}
html[data-phone="1"] .gf-root[data-step-id="home"] .gf-filters select{min-height:44px;font-size:16px;width:100%}
html[data-phone="1"] .gf-root[data-step-id="home"] .gf-homes{grid-template-columns:minmax(0,1fr);gap:10px}
html[data-phone="1"] .gf-root[data-step-id="home"] .gf-home{flex-direction:row;align-items:stretch;min-height:96px}
html[data-phone="1"] .gf-root[data-step-id="home"] .gf-home img{width:116px;height:auto;aspect-ratio:1;flex:none;border-right:1px solid var(--gf-border)}
html[data-phone="1"] .gf-root[data-step-id="home"] .gf-home-b{padding:10px 12px;min-width:0}
html[data-phone="1"] .gf-root[data-step-id="home"] .gf-note{order:4}
/* Steps 3 and 4 use the whole screen: no intro line, no page scroll on step 3. */
html[data-phone="1"] .gf-root[data-step-id="place"] .gf-intro,html[data-phone="1"] .gf-root[data-step-id="check"] .gf-intro{display:none}
html[data-phone="1"] .gf-root[data-step-id="place"] .gf-title,html[data-phone="1"] .gf-root[data-step-id="check"] .gf-title{font-size:17px;margin-bottom:6px}
html[data-phone="1"] .gf-root[data-step-id="place"] .gf-body{overflow:hidden;padding-bottom:8px}
.gf-place--phone{display:flex;flex-direction:column;gap:8px;flex:1;min-height:0}
.gf-place--phone .gf-stage{flex:1 1 auto;height:auto;min-height:150px}
.gf-place--phone .gf-zoom{flex-direction:column;align-items:flex-end;flex-wrap:nowrap;right:8px;top:8px}
.gf-place--phone .gf-zoom{pointer-events:none}
.gf-place--phone .gf-zoom [data-ps=flow-aerial-toggle]:disabled{display:none}
.gf-place--phone .gf-zb{pointer-events:auto;height:44px;min-width:44px;border-radius:22px;font-size:14px}
.gf-place--phone .gf-zb--wide{display:none}
.gf-place--phone .gf-zb[data-ps="flow-fit-lot"],.gf-place--phone .gf-zb[data-ps="flow-aerial-toggle"]{display:inline-flex;align-items:center;justify-content:center;padding:0 14px}
.gf-sheet{flex:none;display:flex;flex-direction:column;gap:8px;padding:10px;background:var(--gf-panel);border:1px solid var(--gf-border);border-radius:16px;box-shadow:0 -4px 16px rgba(0,0,0,.08);max-height:44%}
.gf-sheet.is-open{max-height:54%;overflow:auto}
.gf-prow{display:flex;align-items:center;gap:8px}
.gf-prow .gf-status{flex:1;min-width:0;margin:0;padding:8px 10px;font-size:14px;line-height:1.3}
.gf-pmore{flex:none;min-height:44px;min-width:68px;padding:0 12px;border-radius:12px;border:1px solid var(--gf-border);background:var(--gf-panel);color:var(--gf-text);font-weight:600;font-size:14px;font-family:inherit;}
.gf-pmore[data-attention="1"]{border-color:var(--gf-warn);color:var(--gf-warn)}
.gf-pctl{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:6px}
.gf-pbtn{min-height:52px;border-radius:12px;border:1px solid var(--gf-border);background:var(--gf-panel);color:var(--gf-text);font-size:22px;line-height:1;padding:0}
.gf-pbtn:active{background:var(--gf-acc-soft)}
.gf-pbody{display:none}
.gf-sheet.is-open .gf-pbody{display:flex;flex-direction:column;gap:10px}
.gf-pbody .gf-pad,.gf-pbody .gf-card>.gf-note:last-of-type{display:none}
.gf-pbody .gf-ctl .gf-btn{min-height:48px}
.gf-pbody select{min-height:44px;font-size:16px}
/* Step 4 */
.gf-check--phone{display:flex;flex-direction:column;gap:10px}
.gf-ptabs{display:grid;grid-template-columns:1fr 1fr;gap:4px;padding:4px;background:var(--gf-panel);border:1px solid var(--gf-border);border-radius:14px}
.gf-ptab{min-height:44px;border:0;border-radius:10px;background:transparent;color:var(--gf-text);font-weight:600;font-size:16px;font-family:inherit;}
.gf-ptab[aria-selected="true"]{background:var(--gf-acc);color:var(--gf-acc-ink)}
.gf-viewbox{position:relative;height:min(46vh,420px);min-height:240px;border-radius:12px;overflow:hidden;border:1px solid var(--gf-border);background:#cfd8e0}
.gf-viewbox>.gf-3d{position:absolute;inset:0;min-height:0;height:auto;border:0;border-radius:0}
.gf-viewbox>.gf-3d[hidden]{display:none}
.gf-planview{position:absolute;inset:0}.gf-planview[hidden]{display:none}
.gf-planview .gf-map{width:100%;height:100%;max-height:none;border:0;border-radius:0}
.gf-pcol{display:flex;flex-direction:column;gap:10px;min-width:0}
.gf-facts{list-style:none;margin:10px 0 0;padding:0;display:flex;flex-direction:column}
.gf-facts li{display:flex;justify-content:space-between;gap:10px;padding:8px 0;border-bottom:1px solid var(--gf-border);font-size:14px;min-height:40px;align-items:center}
.gf-facts li span{color:var(--gf-muted)}.gf-facts li b{text-align:right;font-weight:600}
.gf-facts li[data-met="false"] b{color:var(--gf-warn)}.gf-facts li[data-met="true"] b{color:var(--gf-ok)}
.gf-more summary{min-height:44px;display:flex;align-items:center;font-weight:600;cursor:pointer}

html[data-phone="1"] .gf-viewbox .ps3d-viewbar,html[data-phone="1"] .gf-viewbox .ps3d-hints,html[data-phone="1"] .gf-viewbox .ps3d-chip--toggle,html[data-phone="1"] .gf-viewbox .lc-root,html[data-phone="1"] .gf-viewbox .ps3d-editbar{display:none!important}

/* The profile offer: in the flow it is an inline card above the bottom bar (see profile/ui.js); in the editor it sits above the dock. */
html[data-phone="1"] .ps-shell[data-phone-ui] .ps-prof-prompt{top:auto;bottom:calc(150px + env(safe-area-inset-bottom));left:8px;right:8px;width:auto;transform:none}
html[data-phone="1"] .ps-shell[data-phone-ui] .lc-root[data-view="2d"]{display:none!important}
html[data-phone="1"] .ps3d-edit-state{display:none}

/* ---------------- The editor on a phone ---------------- */
html[data-phone="1"] .ps-shell[data-phone-ui] .ps-topbar .ps-back .ps-btn-text{display:none!important}
html[data-phone="1"] .ps-shell[data-phone-ui] .ps-topbar .ps-back.ps-btn--wide:has(.ps-btn-text){width:44px;padding:0}
html[data-phone="1"] #app{padding:0}
html[data-phone="1"] .ps-shell[data-phone-ui]{height:100dvh;border:0;border-radius:0;grid-template-rows:auto minmax(0,1fr) auto auto}
html[data-phone="1"] .ps-shell[data-phone-ui] .ps-topbar{display:flex;flex-wrap:nowrap;align-items:center;gap:6px;padding:6px 8px}
html[data-phone="1"] .ps-shell[data-phone-ui] .ps-topbar .ps-brand,html[data-phone="1"] .ps-shell[data-phone-ui] .ps-topbar .ps-view-switch,html[data-phone="1"] .ps-shell[data-phone-ui] .ps-topbar .ps-topbar-spacer,html[data-phone="1"] .ps-shell[data-phone-ui] .ps-more-btn{display:none}
html[data-phone="1"] .ps-shell[data-phone-ui] .ps-topbar>.ps-back{order:1;width:44px;height:44px;padding:0;margin:0}
html[data-phone="1"] .ps-shell[data-phone-ui] .ps-topbar>.ps-name{order:2;flex:1 1 0;min-width:0;width:auto;height:44px;font-size:16px}
html[data-phone="1"] .ps-shell[data-phone-ui] .ps-topbar>.ps-group{order:3}
html[data-phone="1"] .ps-shell[data-phone-ui] .ps-topbar>.ps-group .ps-btn{width:44px;height:44px}
html[data-phone="1"] .ps-shell[data-phone-ui] .ps-topbar>.ps-group .ps-btn:nth-child(2){display:none}
html[data-phone="1"] .ps-shell[data-phone-ui] .ps-topbar>.ps-premium-slot{order:5;margin:0;display:flex}
html[data-phone="1"] .ps-shell[data-phone-ui] .ps-topbar .psp-bar{display:flex;gap:6px;align-items:center}
html[data-phone="1"] .ps-shell[data-phone-ui] .ps-topbar .ps-prof-save{height:44px;padding:0 12px!important;margin:0;border-radius:10px}
html[data-phone="1"] .ps-shell[data-phone-ui] .ps-topbar .ps-prof-save .ps-prof-save-text{display:inline;font-size:15px}
html[data-phone="1"] .ps-shell[data-phone-ui] .ps-topbar .ps-phone-share{display:inline-flex;order:6;width:44px;height:44px;padding:0;align-items:center;justify-content:center;border-radius:10px;border:1px solid var(--ps-border-strong)}
html[data-phone="1"] .ps-shell[data-phone-ui] .ps-topbar .ps-phone-share[hidden]{display:none}
html[data-phone="1"] .ps-shell[data-phone-ui] .ps-phone-share-t{display:none}
html[data-phone="1"] .ps-shell[data-phone-ui] .ps-toolbox{display:none}
html[data-phone="1"] .ps-shell[data-phone-ui] .ps-main{display:block;position:relative;min-height:0}
html[data-phone="1"] .ps-shell[data-phone-ui] .ps-stage{position:absolute;inset:0}
/* Properties as a bottom sheet, opened from the dock. */
html[data-phone="1"] .ps-shell[data-phone-ui] .ps-panel{position:absolute;left:0;right:0;bottom:0;top:auto;max-height:62%;z-index:46;border:0;border-top:1px solid var(--ps-border-strong);border-radius:16px 16px 0 0;box-shadow:0 -8px 24px rgba(0,0,0,.22);display:flex;flex-direction:column}
html[data-phone="1"] .ps-shell[data-phone-ui] .ps-panel[data-open="false"]{display:none}
html[data-phone="1"] .ps-shell[data-phone-ui] .ps-panel[data-open="true"] .ps-panel-body{display:block;overflow:auto}
html[data-phone="1"] .ps-shell[data-phone-ui] .ps-panel-head{padding:6px 8px}
html[data-phone="1"] .ps-shell[data-phone-ui] .ps-tab{min-height:44px}
html[data-phone="1"] .ps-shell[data-phone-ui] .ps-sheet-toggle{min-width:44px;min-height:44px}
/* Status bar: the hint (short, touch words, wrapped) and the save state only. */
html[data-phone="1"] .ps-shell[data-phone-ui] .ps-statusbar{grid-row:3;padding:6px 12px;gap:2px 10px;min-height:0}
html[data-phone="1"] .ps-shell[data-phone-ui] .ps-status-cell,html[data-phone="1"] .ps-shell[data-phone-ui] .ps-autosave,html[data-phone="1"] .ps-shell[data-phone-ui] .ps-status-btn[aria-label^="Switch between"]{display:none}
html[data-phone="1"] .ps-shell[data-phone-ui] .ps-status-hint{flex:1 1 100%;order:0;white-space:normal;overflow:visible;text-overflow:clip;font-size:13px;line-height:1.35}
html[data-phone="1"] .ps-shell[data-phone-ui] .ps-status-hint:empty{display:none}
html[data-phone="1"] .ps-shell[data-phone-ui] .ps-status-btn{height:32px}
/* The bottom dock. */
html[data-phone="1"] .ps-shell[data-phone-ui] .ps-dock{grid-row:4;display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:4px;padding:6px 8px calc(6px + env(safe-area-inset-bottom));background:var(--ps-panel);border-top:1px solid var(--ps-border-strong)}
html[data-phone="1"] .ps-dock-btn{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;min-height:52px;border:0;border-radius:12px;background:transparent;color:var(--ps-text);font:600 12px/1.1 var(--ps-font-ui,system-ui,sans-serif)}
html[data-phone="1"] .ps-dock-btn[aria-pressed="true"]{background:var(--ps-accent-soft);color:var(--ps-accent)}
html[data-phone="1"] .ps-dock-btn:active{background:var(--ps-hover)}
/* Move and turn the house: big buttons over the bottom of the plan. */
html[data-phone="1"] .ps-shell[data-phone-ui] .ps-quick:not([hidden]){position:absolute;left:8px;right:8px;bottom:8px;z-index:20;display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:6px;padding:8px;background:var(--ps-panel);border:1px solid var(--ps-border-strong);border-radius:14px;box-shadow:0 4px 16px rgba(0,0,0,.25)}
html[data-phone="1"] .ps-quick-btn{min-height:48px;border-radius:10px;border:1px solid var(--ps-border-strong);background:var(--ps-panel);color:var(--ps-text);font-size:22px;line-height:1;padding:0}
html[data-phone="1"] .ps-quick-btn:active{background:var(--ps-accent-soft)}
html[data-phone="1"] .ps-shell[data-phone-ui] .ps-toasts{bottom:calc(84px + env(safe-area-inset-bottom))}
/* The menu: the topbar's More list as a bottom sheet with big rows. */
html[data-phone="1"] .ps-shell[data-phone-ui] .ps-more-wrap{position:static}
html[data-phone="1"] .ps-shell[data-phone-ui] .ps-topbar[data-more-open="1"]::after{content:"";position:fixed;inset:0;z-index:1040;background:rgba(10,14,20,.5)}
html[data-phone="1"] .ps-shell[data-phone-ui] .ps-more-pop:not([hidden]){position:fixed;left:0;right:0;top:auto;bottom:0;z-index:1050;max-height:78dvh;overflow:auto;display:flex;flex-direction:column;align-items:stretch;gap:8px;padding:14px 12px calc(14px + env(safe-area-inset-bottom));border-radius:18px 18px 0 0;box-shadow:0 -8px 30px rgba(0,0,0,.3);background:var(--ps-panel)}
html[data-phone="1"] .ps-shell[data-phone-ui] .ps-more-pop>.ps-btn,html[data-phone="1"] .ps-shell[data-phone-ui] .ps-more-pop .ps-group .ps-btn{width:100%!important;min-height:50px;height:auto;padding:0 14px!important;justify-content:flex-start;gap:12px;font-size:16px;border-radius:12px}
html[data-phone="1"] .ps-shell[data-phone-ui] .ps-more-pop .ps-btn .ps-btn-text{display:inline!important}
html[data-phone="1"] .ps-shell[data-phone-ui] .ps-more-pop .ps-group{display:flex;flex-direction:column;gap:8px;width:100%}
html[data-phone="1"] .ps-shell[data-phone-ui] .ps-more-pop .ps-more-desktop{display:inline-flex;align-items:center}
html[data-phone="1"] .ps-shell[data-phone-ui] .ps-more-pop .ps-prof-save{display:none}
html[data-phone="1"] .ps-shell[data-phone-ui] .ps-more-pop .ps-levels{flex-wrap:wrap}
/* ---------------- Tap targets: 44 px on a phone (owner stress test, 20/11/2026) ----------------
   Real size where the layout has room; an invisible hit area (::after) for small pills that sit among other controls. */
html[data-phone="1"] .ps-btn,html[data-phone="1"] .ps-btn--sm,html[data-phone="1"] .ps-btn--icon{min-height:44px;min-width:44px}
html[data-phone="1"] .ps-shell[data-phone-ui] .ps-topbar>.ps-back{min-width:44px!important}
html[data-phone="1"] .ps-modal .ps-input,html[data-phone="1"] .ps-modal .ps-select,html[data-phone="1"] .ps-modal input:not([type=checkbox]):not([type=radio]):not([type=range]),html[data-phone="1"] .ps-modal select,html[data-phone="1"] .ps-prof-form .ps-input{min-height:44px;font-size:16px}
html[data-phone="1"] .ps-prof-check{min-height:44px;align-items:center}
html[data-phone="1"] .ps-prof-check input{width:22px;height:22px;margin:0}
html[data-phone="1"] .ps-prof-tab{min-height:44px}
html[data-phone="1"] .ps-prof-prompt .ps-btn,html[data-phone="1"] .ps-prof-prompt .ps-prof-x{min-height:44px;min-width:44px}
html[data-phone="1"] .ps-prof-prompt .ps-prof-x{top:2px;right:2px}
html[data-phone="1"] .ps-prof-prompt h2{padding-right:44px}
html[data-phone="1"] .fitc-x{width:44px;height:44px;border-radius:22px;margin:-12px -12px 0 0}
html[data-phone="1"] .fitc-btn,html[data-phone="1"] .fitcoach-ok,html[data-phone="1"] .fitcoach-skip{min-height:44px;min-width:44px}
html[data-phone="1"] .pso-btn{min-height:44px;min-width:64px}
html[data-phone="1"] .gf-backpill{min-height:44px!important;height:44px;padding:0 16px!important;line-height:1.2;font-size:13px!important}
html[data-phone="1"] .ps-status-btn,html[data-phone="1"] .ps-credit-chip{position:relative}
html[data-phone="1"] .ps-status-btn::after,html[data-phone="1"] .ps-credit-chip::after{content:"";position:absolute;left:-6px;right:-6px;top:50%;height:44px;transform:translateY(-50%)}
html[data-phone="1"] .ps-seg-btn,html[data-phone="1"] .ps-level-tab,html[data-phone="1"] .ps-radio{min-height:44px}
html[data-phone="1"] .ps-rot-input,html[data-phone="1"] .ps-rot-btn{min-height:44px}
html[data-phone="1"] .ps-panel-hide{min-width:44px;min-height:44px}
html[data-phone="1"] .ps-more-pop .psp-menu-btn,html[data-phone="1"] .ps-more-pop .psp-bar-slot>*,html[data-phone="1"] .ps-more-pop .psp-menu-wrap>*{min-height:44px}
html[data-phone="1"] .ps-drawer input,html[data-phone="1"] .ps-drawer select{min-height:44px;font-size:16px}
html[data-phone="1"] .ps-drawer .ps-chip,html[data-phone="1"] .ps-drawer [role=tab],html[data-phone="1"] .ps-drawer button{min-height:44px;min-width:44px}
/* 3D overlays: the lot card controls, the room chips, Edit room and Back to the plan. */
html[data-phone="1"] .lc-chev,html[data-phone="1"] .lc-min,html[data-phone="1"] .lc-more{position:relative;min-width:44px;min-height:44px;display:inline-flex;align-items:center;justify-content:center}
html[data-phone="1"] .lc-more{height:44px}
html[data-phone="1"] .lc-root .lc-tab,html[data-phone="1"] .lc-root.is-compact .lc-tab{height:44px;min-height:44px}
html[data-phone="1"] .lc-root .lc-btn,html[data-phone="1"] .lc-root.is-compact .lc-btn,html[data-phone="1"] .lc-root .lc-sendbtn{min-height:44px;height:auto}
html[data-phone="1"] .lc-root .lc-pager button,html[data-phone="1"] .lc-root.is-compact .lc-pager button{width:44px;height:44px;line-height:42px}
html[data-phone="1"] .lc-root .lc-pager,html[data-phone="1"] .lc-root.is-compact .lc-pager{height:48px}
/* Every close control on a phone is a 44 px target (tutorial menu and video, commercial details panel, tutorial skip, tour skip). */
html[data-phone="1"] .tut-x{width:44px;height:44px;border-radius:22px}
html[data-phone="1"] .cc-panel .cc-x{width:44px;height:44px;line-height:42px;right:6px;top:6px}
html[data-phone="1"] .tut-skip,html[data-phone="1"] .pso-link{min-height:44px;min-width:44px}
html[data-phone="1"] .lc-mini-x{position:relative}
html[data-phone="1"] .lc-mini-x::after{content:"";position:absolute;left:50%;top:50%;width:44px;height:44px;transform:translate(-50%,-50%)}
html[data-phone="1"] .ps3d-roombar .ps3d-chip,html[data-phone="1"] .ps3d-chip--toggle,html[data-phone="1"] .ps3d-chip--btn,html[data-phone="1"] .ps3d-btn,html[data-phone="1"] .ps-backplan{min-height:44px;display:inline-flex;align-items:center;justify-content:center}
html[data-phone="1"] .ps3d-edit .ps3d-key{display:none}
html[data-phone="1"] .ps3d-edit,html[data-phone="1"] .ps3d-tool,html[data-phone="1"] .ps3d-itembtn,html[data-phone="1"] .ps3d-armbar .ps3d-btn,html[data-phone="1"] .ps3d-editbar button,html[data-phone="1"] .ps3d-editbar .ps3d-chip,html[data-phone="1"] .ps3d-editbar label,html[data-phone="1"] .ps3d-editbar .ps3d-btn{min-height:44px}
/* The way back to the placement step stays at the top left in 2D and the Rotate box stands under it. */
html[data-phone="1"] .ps-shell[data-phone-ui][data-view="2d"] .gf-backpill{top:12px!important}
html[data-phone="1"] .ps-stage:has(.gf-backpill:not([hidden])) .ps-rot-box{top:64px}
/* The save offer in the editor clears the move and turn buttons. */
html[data-phone="1"] .ps-shell[data-phone-ui]:has(.ps-quick:not([hidden])) .ps-prof-prompt{bottom:calc(236px + env(safe-area-inset-bottom))}
/* Pinch zoom: never on the page while the editor is up, and never when a pinch starts on a 3D overlay (the lot card, room chips, credit text). */
html[data-phone="1"] .ps-shell[data-phone-ui]{touch-action:pan-x pan-y}
html[data-phone="1"] .ps-shell[data-phone-ui] .ps-stage,html[data-phone="1"] .lc-root,html[data-phone="1"] .lc-root>*,html[data-phone="1"] .ps-credit,html[data-phone="1"] .ps-credit *,html[data-phone="1"] .ps3d-roombar,html[data-phone="1"] .ps3d-roombar *,html[data-phone="1"] .ps3d-viewbar,html[data-phone="1"] .ps3d-editbar,html[data-phone="1"] .ps3d-hints{touch-action:pan-x pan-y}

/* 3D on a phone: the dock holds the Plan toggle, and the 3D overlays keep clear of the dock. */
html[data-phone="1"] .ps-shell[data-phone-ui] .ps-hintbar{display:none}
`;

let injected = false;
export function injectPhoneCss() {
  if (injected || typeof document === 'undefined') return;
  injected = true;
  const st = document.createElement('style');
  st.dataset.ps = 'phone-css';
  st.textContent = PHONE_CSS;
  document.head.append(st);
}
