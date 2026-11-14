// Extra styles for the commercial lot card (src/commercial/lotcard.js). It reuses the housing card's classes (lc-*, src/lotcard/lot-card-css.js)
// and adds only what the commercial card has on top: the feasibility headline, two colour rows, the layout switcher label and list, and the
// Units and feasibility panels.
export const COMMERCIAL_CARD_CSS = `
.cc-root .lc-title{font-size:24px}
.cc-feas{margin:4px 0 8px;padding:8px 12px;border-radius:10px;background:rgba(255,255,255,.07);border:1px solid var(--lc-line);display:flex;align-items:center;gap:12px;flex-wrap:wrap}
.cc-feas-t{flex:1 1 220px;min-width:0;font:500 12.5px/1.35 var(--lc-sans);color:var(--lc-t1)}
.cc-feas-t b{font:400 19px/1.1 var(--lc-serif);margin-right:6px;white-space:nowrap}
.cc-feas-t div{display:flex;align-items:baseline;flex-wrap:wrap;margin:1px 0}
.cc-land{display:flex;align-items:center;justify-content:space-between;gap:12px;margin:8px 0 6px;font:500 12.5px var(--lc-sans)}
.cc-land input{width:130px;height:32px;border-radius:8px;border:1px solid rgba(255,255,255,.28);background:rgba(255,255,255,.08);color:inherit;padding:0 10px;font:500 13px var(--lc-sans)}
.cc-feas-t i{font-style:normal;color:var(--lc-t2)}
.cc-feas .lc-btn{height:32px;font-size:12px;padding:0 14px!important}
.cc-feas[hidden]{display:none}
.cc-root .lc-sp .lc-k{width:68px}
.cc-root .lc-fit,.lc-embed:not(.is-compact).cc-root .lc-fit{min-height:0;margin-top:0;padding:0;line-height:1.5}
.cc-fits{margin:6px 0 14px;display:flex;flex-direction:column;gap:2px}
.cc-root .lc-tab{height:30px;padding:0 12px!important;font-size:12.5px}
.cc-root .lc-sp-rooms .lc-k{padding-top:6px}
.cc-root .lc-tabs{gap:6px;flex-wrap:wrap}
.cc-fits .lc-fit[hidden]{display:none}
.lc-embed:not(.is-compact).cc-root .lc-card{width:clamp(400px,calc(50% - 168px),600px)}
.cc-root .lc-pager{height:50px;border-radius:25px}
.cc-pgt{display:flex!important;flex-direction:column;align-items:center;justify-content:center;gap:1px;min-width:0!important;max-width:none!important;flex:1;padding:0 4px;text-transform:none!important;letter-spacing:0!important;cursor:pointer}
.cc-pgt i{font:500 9.5px/1 var(--lc-sans);font-style:normal;letter-spacing:.16em;text-transform:uppercase;color:var(--lc-t2)}
.cc-pgt b{font:500 12.5px/1.2 var(--lc-sans);max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.cc-root .lc-pager button.cc-pgt{width:auto;height:auto;border-radius:12px;line-height:1.2}
.lc-embed:not(.is-compact).cc-root .lc-pager{left:calc(clamp(400px,calc(50% - 168px),600px) + 28px);right:auto;transform:none;width:auto;min-width:300px;max-width:calc(100% - clamp(400px,calc(50% - 168px),600px) - min(18%,200px) - 64px);justify-content:space-between}
.cc-root.is-compact .lc-pager{height:46px;left:12px;right:auto;max-width:calc(100% - 24px);min-width:0}
.cc-root.is-compact .cc-pgt b{font-size:11.5px}
.cc-list{position:absolute;bottom:60px;left:0;right:0;margin:0;padding:6px;list-style:none;border-radius:14px;z-index:6;min-width:260px}
.cc-list[hidden]{display:none}
.cc-list button{display:flex;justify-content:space-between;gap:10px;width:100%;text-align:left;padding:9px 12px!important;border-radius:9px;font:500 12.5px var(--lc-sans)}
.cc-list button:hover,.cc-list button[aria-current=true]{background:rgba(255,255,255,.14)}
.cc-list button i{font-style:normal;color:var(--lc-t2);font-size:11px}
.cc-panel{position:absolute;left:50%;top:70px;transform:translateX(-50%);width:min(580px,calc(100% - 24px));max-height:calc(100% - 140px);overflow:auto;padding:16px 18px 18px;border-radius:16px;z-index:8;color:var(--lc-t1)}
.cc-panel[hidden]{display:none}
.cc-panel h3{margin:0 0 2px;font:400 22px/1.15 var(--lc-serif)}
.cc-panel .cc-sub{margin:0 0 10px;font:400 12px/1.4 var(--lc-sans);color:var(--lc-t2)}
.cc-panel .cc-x{position:absolute;right:10px;top:10px;width:32px;height:32px;border-radius:50%;border:1px solid rgba(255,255,255,.25)!important;font-size:16px;line-height:30px}
.cc-panel table{width:100%;border-collapse:collapse;font:400 12.5px/1.35 var(--lc-sans)}
.cc-panel th{padding:6px 8px;text-align:left;font:500 10px var(--lc-sans);letter-spacing:.12em;text-transform:uppercase;color:var(--lc-t2);border-bottom:1px solid var(--lc-line)}
.cc-panel td{padding:6px 8px;border-bottom:1px solid rgba(255,255,255,.07)}
.cc-panel td.n,.cc-panel th.n{text-align:right;white-space:nowrap}
.cc-panel tbody tr.cc-unit{cursor:pointer}
.cc-panel tbody tr.cc-unit:hover{background:rgba(255,255,255,.1)}
.cc-panel tr.cc-total td{font-weight:600;border-bottom:0}
.cc-panel h4{margin:14px 0 4px;font:500 10.5px var(--lc-sans);letter-spacing:.14em;text-transform:uppercase;color:var(--lc-t2)}
.cc-line{display:flex;justify-content:space-between;gap:12px;padding:5px 0;border-bottom:1px solid rgba(255,255,255,.07);font:400 12.5px/1.35 var(--lc-sans)}
.cc-line b{font-weight:600;white-space:nowrap}
.cc-line i{display:block;font-style:normal;color:var(--lc-t2);font-size:11px}
.cc-note{margin:10px 0 0;font:400 11.5px/1.45 var(--lc-sans);color:var(--lc-t2)}
.cc-panel .lc-btn{height:34px;font-size:12px;margin-top:12px}
.cc-root.is-compact .lc-fit{font-size:11.5px}
.cc-root.is-phone .lc-tab{padding:0 8px!important;font-size:11.5px;height:28px}
.cc-root.is-phone .lc-tabs{gap:4px}
.cc-root.is-phone .cc-feas{padding:6px 10px}
.cc-root.is-phone .cc-feas-t b{font-size:16px}
.lc-embed:not(.is-compact).cc-root .cc-panel{left:calc(clamp(400px,calc(50% - 168px),600px) + 28px);transform:none;width:min(500px,calc(100% - clamp(400px,calc(50% - 168px),600px) - 260px));min-width:380px;max-height:calc(100% - 190px)}
.cc-root.is-compact .cc-panel{top:104px;max-height:calc(100% - 300px)}
.cc-panel td:nth-child(2){white-space:nowrap}
.cc-root.is-phone .cc-panel{padding:14px 12px}
.cc-root.is-phone .cc-panel :is(td,th){padding:6px 4px;font-size:11.5px;white-space:nowrap}
.cc-root.is-phone .cc-line{font-size:12px}
`;
