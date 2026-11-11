// Styles for the lot card (src/lotcard/lot-card.js): dark glass, serif design name, small caps labels, as in the sales demo.
export const LOT_CARD_CSS = `
.ps-stage:has(.lc-root:not([hidden])) .pso-dock{display:none}
.lc-root{--lc-t1:rgba(255,255,255,.92);--lc-t2:rgba(255,255,255,.6);--lc-line:rgba(255,255,255,.14);--lc-acc:#ffc83d;
 --lc-serif:"Iowan Old Style","Palatino Linotype",Palatino,Georgia,serif;--lc-sans:system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;
 position:absolute;inset:0;z-index:20;pointer-events:none;color:var(--lc-t1);font:13px/1.4 var(--lc-sans)}
.lc-root[hidden]{display:none}
.lc-root>*{pointer-events:auto}
.lc-glass{background:rgba(10,10,12,.76);-webkit-backdrop-filter:blur(16px) saturate(1.15);backdrop-filter:blur(16px) saturate(1.15);border:1px solid var(--lc-line)}
.lc-root button{font:inherit;color:inherit;background:none;border:0;cursor:pointer;padding:0}
.lc-root button:focus-visible{outline:2px solid #fff;outline-offset:2px}
.lc-head{position:absolute;left:156px;top:12px;max-width:calc(100% - 330px);pointer-events:none;text-shadow:0 1px 10px rgba(0,0,0,.6)}
.lc-head-t{display:block;font:500 12px/1 var(--lc-sans);letter-spacing:.22em;text-transform:uppercase;color:#fff}
.lc-head-s{display:block;margin-top:6px;font:400 11px/1 var(--lc-sans);color:rgba(255,255,255,.74)}
.lc-card{position:absolute;left:12px;bottom:14px;width:min(700px,calc(100% - 24px));border-radius:16px;padding:20px 24px 0}
.lc-hd{display:flex;align-items:flex-start;justify-content:space-between;gap:8px}
.lc-title{margin:0;font:400 30px/1.1 var(--lc-serif);color:var(--lc-t1)}
.lc-sub{margin-top:6px;font:400 13px/1.35 var(--lc-sans);color:var(--lc-t2)}
.lc-sub span{display:block}.lc-sub .lc-sc{margin-top:3px;color:var(--lc-t1);opacity:.85}
.lc-more{display:none;height:30px;padding:0 12px!important;border:1px solid rgba(255,255,255,.22)!important;border-radius:15px;font:500 11px var(--lc-sans);letter-spacing:.06em;white-space:nowrap}
.lc-stats{display:flex;gap:22px;flex-wrap:wrap;margin:14px 0 10px}
.lc-stats b{display:block;font:400 26px/1 var(--lc-serif);white-space:nowrap}
.lc-stats i{display:block;margin-top:5px;font:500 10px var(--lc-sans);font-style:normal;letter-spacing:.1em;text-transform:uppercase;color:var(--lc-t2);white-space:nowrap}
.lc-sp{margin:6px 0 8px;display:flex;align-items:center;gap:10px}
.lc-sp .lc-k{flex:none;width:68px}
.lc-sp-rooms{align-items:flex-start}.lc-sp-rooms .lc-k{padding-top:8px}
.lc-k{font:500 10.5px/1.2 var(--lc-sans);letter-spacing:.14em;text-transform:uppercase;color:var(--lc-t2)}
.lc-strip{display:flex;gap:2px;flex-wrap:wrap}
.lc-chip{width:32px;height:32px;padding:2px!important;border-radius:50%;border:1px solid transparent!important}
.lc-sw{display:block;width:26px;height:26px;border-radius:50%;border:1px solid rgba(255,255,255,.25);background:linear-gradient(135deg,var(--r) 0 50%,var(--w) 50% 100%)}
.lc-chip[aria-pressed=true]{border-color:var(--lc-acc)!important;box-shadow:0 0 0 1px var(--lc-acc)}
.lc-acts{display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-top:12px}
.lc-btn{height:40px;padding:0 20px!important;border-radius:20px;border:1px solid rgba(255,255,255,.22)!important;font:500 13px var(--lc-sans);letter-spacing:.04em;white-space:nowrap}
.lc-btn:hover{background:rgba(255,255,255,.1)}
.lc-pri{background:#fff!important;color:#000!important;border-color:#fff!important}.lc-pri:hover{background:rgba(255,255,255,.86)!important}
.lc-gh{border-color:transparent!important;color:var(--lc-t2)!important;text-decoration:underline;text-underline-offset:3px;padding:0 6px!important}
.lc-fit{margin-top:6px;min-height:46px;display:flex;align-items:center;font:500 12.5px var(--lc-sans)}.lc-fit[hidden]{display:none}.lc-card:has(.lc-fit[hidden]) .lc-acts{margin-bottom:16px}
.lc-fit[data-state=inside]{color:#6fd39a}.lc-fit[data-state=outside]{color:#ff8a7a}.lc-fit[data-state=check]{color:#f2b94b}
.lc-dot{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:6px}
.lc-pager{position:absolute;left:50%;transform:translateX(-50%);bottom:14px;z-index:2;display:flex;align-items:center;gap:2px;height:44px;border-radius:22px;padding:0 4px}
.lc-pager[hidden]{display:none}
.lc-pager button{width:40px;height:40px;border-radius:50%;font-size:20px;line-height:38px}.lc-pager button:hover{background:rgba(255,255,255,.1)}
.lc-pgt{font:500 10.5px var(--lc-sans);letter-spacing:.16em;min-width:150px;max-width:300px;text-align:center;text-transform:uppercase;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.lc-mini{position:absolute;right:12px;bottom:44px;width:min(21%,210px);min-width:110px;aspect-ratio:3/4;border-radius:12px!important;border:1px solid rgba(255,255,255,.35)!important;box-shadow:0 6px 24px rgba(0,0,0,.45);overflow:hidden;display:block;background:#e8ece7}
.lc-mini canvas{width:100%;height:100%;display:block}
.lc-mini-t{position:absolute;left:8px;top:6px;font:500 9px var(--lc-sans);letter-spacing:.14em;color:#fff;background:rgba(10,10,12,.7);padding:3px 7px;border-radius:9px}
.lc-north{position:absolute;right:6px;top:6px;width:30px;height:30px}
.lc-nlabel{position:absolute;right:6px;top:6px;width:30px;text-align:center;font:700 9px/1 var(--lc-sans);font-style:normal;color:#fff;margin-top:-1px;transform:translateY(-2px);pointer-events:none;display:none}
.lc-on .ps3d-hints{left:50%;transform:translateX(-50%);bottom:auto;top:12px;justify-content:center}
.lc-on .ps3d-chip--toggle{bottom:12px}
.lc-rooms{display:none!important;position:absolute;left:468px;right:206px;max-width:560px;bottom:68px;border-radius:14px;padding:10px 14px}
.lc-rooms[hidden]{display:none}
.lc-tabs{display:flex;gap:6px;flex-wrap:wrap}
.lc-tab{height:34px;padding:0 16px!important;border-radius:17px;border:1px solid rgba(255,255,255,.28)!important;font:500 13px var(--lc-sans);letter-spacing:.01em;text-transform:none;white-space:nowrap}
.lc-tab:hover{background:rgba(255,255,255,.1)}
.lc-tab[aria-selected=true]{background:#fff!important;color:#000!important;border-color:#fff!important}
.lc-rooms-row{display:flex;gap:12px;align-items:center;margin-top:8px}
.lc-cap{flex:1;margin:0;font:400 12px/1.4 var(--lc-sans);color:var(--lc-t1)}
.lc-plan{flex:none;width:150px;height:100px}
.lc-room{fill:rgba(255,255,255,.14);stroke:rgba(255,255,255,.5);stroke-width:1;cursor:pointer}
.lc-room:hover{fill:rgba(255,255,255,.28)}
.lc-room.is-on{fill:#ffc83d;stroke:#fff}
.lc-full .ps3d-viewbar,.lc-full .ps3d-chip--toggle,.lc-full .ps3d-hints{display:none!important}
.lc-find{position:absolute;right:172px;top:12px;height:40px;max-width:min(340px,calc(100% - 520px));padding:0 16px!important;display:flex;align-items:center;gap:8px;border-radius:20px;font:500 13px var(--lc-sans);color:var(--lc-t1)}.lc-find span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.lc-root.is-compact .lc-find{display:none}
.lc-root.is-compact .lc-more{display:inline-block}
.lc-root.is-compact .lc-rooms{display:block!important;left:12px;right:116px;max-width:none;top:156px;bottom:auto;padding:8px 10px}
.lc-root.is-compact .lc-sp-rooms{display:none}
.lc-root.is-compact .lc-tabs{flex-wrap:nowrap;overflow-x:auto}
.lc-root.is-compact .lc-rooms-row{display:none}
.lc-root.is-compact .lc-body{display:none}
.lc-root.is-compact .lc-card.is-open .lc-body{display:block}
.lc-root.is-compact .lc-card{padding:10px 12px}
.lc-root.is-compact .lc-fit{min-height:0}
.lc-root.is-compact .lc-tab{height:26px;padding:0 10px!important;font-size:11px}
.lc-root.is-compact .lc-title{font-size:18px}
.lc-root.is-compact .lc-stats b{font-size:18px}.lc-root.is-compact .lc-sub{font-size:11.5px}.lc-root.is-compact .lc-btn{height:36px;font-size:11.5px;padding:0 14px!important}
.lc-root.is-compact .lc-head{left:12px;top:48px;max-width:calc(100% - 130px)}
.lc-root.is-compact .lc-mini{width:92px;min-width:92px;bottom:auto;top:52px}
.lc-root.is-compact .lc-mini-t{font-size:7.5px;padding:2px 5px;left:5px;top:5px}
.lc-root.is-compact .lc-north{width:22px;height:22px;right:4px;top:4px}
.ps-stage:has(.lc-root.is-compact:not([hidden])) .ps-credit{bottom:14px}
.ps-stage:has(.lc-root.is-phone:not([hidden])) .ps-credit{bottom:112px}
.lc-root[data-view="2d"] .lc-find,.lc-root[data-view="split"] .lc-find,.lc-root[data-view="2d"] .lc-head,.lc-root[data-view="2d"] .lc-rooms,.lc-root[data-view="2d"] .lc-mini,.lc-root[data-view="split"] .lc-head,.lc-root[data-view="split"] .lc-rooms,.lc-root[data-view="split"] .lc-mini,.lc-root[data-view="split"] .lc-pager{display:none!important}
.lc-root[data-view="2d"] .lc-card,.lc-root[data-view="split"] .lc-card{width:min(440px,calc(100% - 24px));padding:12px 16px 0}
.lc-root[data-view="2d"] .lc-title,.lc-root[data-view="split"] .lc-title{font-size:21px}
.lc-root[data-view="2d"] .lc-stats,.lc-root[data-view="split"] .lc-stats{gap:14px;margin:10px 0 6px}
.lc-root[data-view="2d"] .lc-stats b,.lc-root[data-view="split"] .lc-stats b{font-size:18px}
.lc-root[data-view="2d"] .lc-sp-rooms,.lc-root[data-view="split"] .lc-sp-rooms{display:none}
.lc-root[data-view="2d"] .lc-fit,.lc-root[data-view="split"] .lc-fit{min-height:34px}
.lc-root[data-view="2d"] .lc-btn,.lc-root[data-view="split"] .lc-btn{height:36px;font-size:11.5px;padding:0 16px!important}
.lc-root.is-phone .lc-card{left:0;right:0;bottom:0;width:auto;border-radius:14px 14px 0 0;border-bottom:0}
.lc-root.is-phone .lc-pager{bottom:112px}
.lc-root.is-compact .lc-pager{bottom:124px;left:12px;transform:none;height:36px}
.lc-root.is-phone:has(.lc-card.is-open) .lc-pager,.lc-root.is-compact:has(.lc-card.is-open) .lc-pager{display:none}
.lc-root.is-compact .lc-pager button{width:32px;height:32px;line-height:30px}
.lc-root.is-compact .lc-pgt{min-width:0;max-width:120px;font-size:9.5px}
/* In a room view the card folds to its header and the room pills so it never covers the view. */
.lc-root[data-room="1"]:not(.is-compact) .lc-card :is(.lc-stats,.lc-sp:not(.lc-sp-rooms),.lc-acts,.lc-fit){display:none}
.lc-compact.lc-on .ps3d-viewbar{top:auto;bottom:170px;left:12px;transform:none}
.lc-compact.lc-on .ps3d-hints{display:none}
@media (max-width:640px){.lc-plan{width:110px;height:74px}.lc-stats{gap:10px}.lc-btn{height:34px;padding:0 12px!important}}
@media (prefers-reduced-motion:no-preference){.lc-chip,.lc-btn{transition:background .15s,box-shadow .15s}}
`;
