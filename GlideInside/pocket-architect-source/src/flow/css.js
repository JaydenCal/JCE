// Styles for the guided start flow (residential and commercial). Uses the app tokens so the dark theme follows.
import { FINDER_CSS } from './builder-finder.js';
export const FLOW_CSS = `
.ps-modal-root{z-index:1000} /* dialogs opened from a step (Add building) stand above the flow */
.gf-root{--gf-bg:var(--ps-bg,#f1f2f4);--gf-panel:var(--ps-panel,#fff);--gf-text:var(--ps-text,#1a1c20);--gf-muted:var(--ps-muted,#5a5e66);--gf-border:var(--ps-border,#dcdde0);
 --gf-acc:var(--ps-accent,#1b4fd1);--gf-acc-ink:var(--ps-accent-ink,#fff);--gf-acc-soft:var(--ps-accent-soft,#e6ecfb);--gf-ok:var(--ps-ok,#17724a);--gf-ok-soft:var(--ps-ok-soft,#dbefe4);
 --gf-warn:var(--ps-warning,#935800);--gf-warn-soft:var(--ps-warning-soft,#f7e9cc);--gf-bad:var(--ps-danger,#b52828);
 position:fixed;inset:0;z-index:900;display:flex;flex-direction:column;background:var(--gf-bg);color:var(--gf-text);font:14px/1.45 var(--ps-font-ui,system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif)}
.gf-root[hidden]{display:none}
.gf-root *{box-sizing:border-box}
.gf-root button{font:inherit;cursor:pointer}
.gf-root button:focus-visible,.gf-root input:focus-visible,.gf-root select:focus-visible{outline:2px solid var(--gf-acc);outline-offset:2px}
.gf-head{display:flex;align-items:center;gap:16px;padding:10px 20px;background:var(--gf-panel);border-bottom:1px solid var(--gf-border)}
.gf-brand{font-weight:700;letter-spacing:.02em;white-space:nowrap}
.gf-prog{display:flex;flex:1;gap:4px;margin:0;padding:0;list-style:none;justify-content:center;min-width:0}
.gf-prog li{display:flex;align-items:center;gap:8px;padding:4px 10px;border-radius:999px;color:var(--gf-muted);font-weight:600;white-space:nowrap}
.gf-prog li button{all:unset;display:flex;align-items:center;gap:8px;cursor:pointer;border-radius:999px}
.gf-prog li button:focus-visible{outline:2px solid var(--gf-acc);outline-offset:3px}
.gf-prog li[data-state="todo"] button{cursor:default}
.gf-num{display:inline-grid;place-items:center;width:24px;height:24px;border-radius:50%;border:2px solid var(--gf-border);font-size:12px;flex:none}
.gf-prog li[data-state="done"]{color:var(--gf-text)}
.gf-prog li[data-state="done"] .gf-num{background:var(--gf-ok);border-color:var(--gf-ok);color:#fff}
.gf-prog li[data-state="current"]{color:var(--gf-acc);background:var(--gf-acc-soft)}
.gf-prog li[data-state="current"] .gf-num{background:var(--gf-acc);border-color:var(--gf-acc);color:var(--gf-acc-ink)}
.gf-help{margin-left:auto}.gf-help+.gf-skip{margin-left:0}
.gf-skip{margin-left:auto;background:none;border:0;color:var(--gf-muted);text-decoration:underline;padding:6px;white-space:nowrap}
.gf-body{flex:1;min-height:0;overflow:auto;padding:20px;display:flex;flex-direction:column}
.gf-wrap{width:100%;max-width:1180px;margin:0 auto;display:flex;flex-direction:column;flex:1;min-height:0}
.gf-title{margin:0 0 4px;font-size:24px;line-height:1.2}
.gf-intro{margin:0 0 16px;color:var(--gf-muted);max-width:70ch}
.gf-foot{display:flex;align-items:center;gap:12px;padding:12px 20px;background:var(--gf-panel);border-top:1px solid var(--gf-border)}
.gf-foot .gf-count{margin-right:auto;color:var(--gf-muted);font-size:12px}
.gf-btn{border:1px solid var(--gf-border);background:var(--gf-panel);color:var(--gf-text);border-radius:8px;padding:10px 18px;font-weight:600;min-height:44px}
.gf-btn:hover:not(:disabled){background:var(--ps-hover,#eeeff1)}
.gf-btn:disabled{opacity:.5;cursor:not-allowed}
.gf-btn--primary{background:var(--gf-acc);border-color:var(--gf-acc);color:var(--gf-acc-ink)}
.gf-btn--primary:hover:not(:disabled){background:var(--gf-acc);filter:brightness(1.08)}
.gf-btn--sm{min-height:36px;padding:6px 12px}
.gf-card{background:var(--gf-panel);border:1px solid var(--gf-border);border-radius:12px;padding:16px}
.gf-grid{display:grid;gap:16px;grid-template-columns:minmax(0,1.3fr) minmax(0,1fr)}
.gf-row{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
.gf-field{display:flex;gap:8px;position:relative}
.gf-field input{flex:1;min-width:0;border:1px solid var(--gf-border);border-radius:8px;padding:11px 12px;font:inherit;background:var(--ps-field,#fff);color:var(--gf-text);min-height:44px}
.gf-suggest{position:absolute;left:0;right:0;top:100%;margin:4px 0 0;padding:4px;list-style:none;background:var(--gf-panel);border:1px solid var(--gf-border);border-radius:8px;z-index:5;box-shadow:0 8px 24px rgba(0,0,0,.14)}
.gf-suggest li{padding:10px 12px;border-radius:6px;cursor:pointer}
.gf-suggest li:hover,.gf-suggest li[aria-selected="true"]{background:var(--gf-acc-soft)}
.gf-note{margin:8px 0 0;color:var(--gf-muted);font-size:13px}
.gf-note--bad{color:var(--gf-bad)}
.gf-spin{display:inline-block;width:16px;height:16px;margin-right:8px;vertical-align:-3px;border:2px solid var(--gf-muted,#8a8f98);border-top-color:var(--gf-accent,#1b4fd1);border-radius:50%;animation:gf-spin .8s linear infinite}
@keyframes gf-spin{to{transform:rotate(360deg)}}
@media (prefers-reduced-motion:reduce){.gf-spin{animation:none;border-top-color:var(--gf-muted,#8a8f98);border-style:dotted}}
.gf-dim{opacity:.35;pointer-events:none;transition:opacity .2s}
@media (prefers-reduced-motion:reduce){.gf-dim{transition:none}}
.gf-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(110px,1fr));gap:10px;margin:12px 0 0}
.gf-stat{border:1px solid var(--gf-border);border-radius:10px;padding:10px 12px}
.gf-stat b{display:block;font-size:20px;line-height:1.2}
.gf-stat span{color:var(--gf-muted);font-size:12px}
.gf-chip{display:inline-flex;align-items:center;gap:6px;border-radius:999px;padding:3px 10px;font-size:12px;font-weight:700;background:var(--gf-acc-soft);color:var(--gf-acc)}
.gf-chip--ok{background:var(--gf-ok-soft);color:var(--gf-ok)}
.gf-chip--warn{background:var(--gf-warn-soft);color:var(--gf-warn)}
.gf-map{width:100%;height:auto;max-height:min(52vh,540px);display:block;background:#e9efe3;border-radius:10px;border:1px solid var(--gf-border)}
.gf-map-wrap{position:relative}
.gf-filters{display:flex;flex-wrap:wrap;gap:16px;margin:0 0 14px}
.gf-filters label{display:flex;align-items:center;gap:8px;font-weight:600}
.gf-filters select{border:1px solid var(--gf-border);border-radius:8px;padding:8px 10px;font:inherit;background:var(--ps-field,#fff);color:var(--gf-text);min-height:40px}
.gf-homes{display:grid;gap:14px;grid-template-columns:repeat(auto-fill,minmax(250px,1fr))}
.gf-home{text-align:left;border:2px solid var(--gf-border);border-radius:12px;background:var(--gf-panel);color:inherit;padding:0;overflow:hidden;display:flex;flex-direction:column}
.gf-home:hover{border-color:var(--gf-acc)}
.gf-home[aria-pressed="true"]{border-color:var(--gf-acc);box-shadow:0 0 0 3px var(--gf-acc-soft)}
.gf-home img{display:block;width:100%;height:auto;background:#f3f4ef;aspect-ratio:8/5;object-fit:contain}
.gf-home-b{padding:12px 14px;display:flex;flex-direction:column;gap:6px}
.gf-home-b strong{font-size:16px}
.gf-home-s{color:var(--gf-muted);font-size:13px}
.gf-empty{padding:24px;text-align:center;color:var(--gf-muted)}
.gf-stage{position:relative;border:1px solid var(--gf-border);border-radius:12px;background:#dfe7d6;overflow:hidden;touch-action:none;flex:1;min-height:320px}
.gf-stage svg{position:absolute;inset:0;width:100%;height:100%;display:block;user-select:none;-webkit-user-select:none}
.gf-zoom{position:absolute;right:8px;top:8px;display:flex;flex-wrap:wrap;gap:4px;justify-content:flex-end;max-width:calc(100% - 16px);z-index:3}
.gf-zb{height:30px;min-width:30px;padding:0 9px;border-radius:15px;border:1px solid var(--gf-border,#d3dad4);background:rgba(255,255,255,.94);color:#16211d;font:600 12px/1 system-ui,sans-serif;cursor:pointer;box-shadow:0 1px 4px rgba(0,0,0,.15)}
.gf-zb:hover:not(:disabled){border-color:#1b4fd1}.gf-zb:disabled{opacity:.55;cursor:default}
.gf-stage .gf-house{cursor:grab}
.gf-stage .gf-house:active{cursor:grabbing}
.gf-stage .gf-bld{cursor:grab}
.gf-stage .gf-bld:active{cursor:grabbing}
.gf-seg{display:flex;gap:8px;flex-wrap:wrap;margin:8px 0 0}
.gf-seg .gf-btn[aria-pressed="true"]{border-color:var(--gf-acc);background:var(--gf-acc-soft);font-weight:700}
.gf-type[disabled]{opacity:.6}
.gf-handle{cursor:crosshair}
.gf-place{display:grid;gap:16px;grid-template-columns:minmax(0,1fr) 300px;flex:1;min-height:0}
.gf-side{display:flex;flex-direction:column;gap:12px}
.gf-place--fit{grid-template-columns:minmax(0,1fr) 320px;grid-template-rows:auto auto minmax(0,1fr);grid-template-areas:"coach fit" "stage fit" "stage side"}
.gf-place--fit>.gf-coachrow{grid-area:coach;min-width:0}
.gf-place--fit>.gf-stage{grid-area:stage}
.gf-place--fit>.gf-fitwrap{grid-area:fit;display:flex;flex-direction:column;gap:10px;min-width:0}
.gf-place--fit>.gf-side{grid-area:side}
.gf-coachrow.gf-wait,.gf-coachrow:empty,.gf-coachrow:not(:has(.fitcoach:not([hidden]))){display:none}
@keyframes gf-breach{0%,100%{stroke-opacity:1}50%{stroke-opacity:.35}}
.gf-breach{animation:gf-breach 1.4s ease-in-out infinite}
@media (prefers-reduced-motion:reduce){.gf-breach{animation:none}}
.gf-status{display:flex;gap:10px;align-items:flex-start;border-radius:10px;padding:10px 12px;font-weight:600}
.gf-status[data-state="inside"]{background:var(--gf-ok-soft);color:var(--gf-ok)}
.gf-status[data-state="outside"]{background:var(--gf-warn-soft);color:var(--gf-warn)}
.gf-status[data-state="unknown"],.gf-status[data-state="none"]{background:var(--gf-acc-soft);color:var(--gf-text)}
.gf-ctl{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}
.gf-ctl .gf-btn{padding:8px 6px;min-height:44px}
.gf-pad{display:grid;grid-template-columns:repeat(3,44px);grid-template-rows:repeat(3,44px);gap:4px;justify-content:center}
.gf-pad .gf-btn{padding:0;min-height:0;font-size:18px}
.gf-pad .gf-mid{grid-column:2;grid-row:2;font-size:11px;color:var(--gf-muted);display:grid;place-items:center}
.gf-check{display:grid;gap:16px;grid-template-columns:minmax(0,1fr) minmax(0,1.1fr);flex:1;min-height:0}
.gf-3d{position:relative;border:1px solid var(--gf-border);border-radius:12px;overflow:hidden;background:#cfd8e0;min-height:320px}
.gf-3d>.ps3d-root,.gf-3d>div{position:absolute;inset:0}
.gf-table{width:100%;border-collapse:collapse;font-size:13px}
.gf-table th,.gf-table td{text-align:left;padding:6px 4px;border-bottom:1px solid var(--gf-border)}
.gf-lines{margin:12px 0 0;padding:0 0 0 18px}
.gf-lines li{margin:4px 0}
.gf-resume{position:absolute;left:12px;top:12px;z-index:30}
.gf-backpill{position:absolute;left:12px;bottom:88px;z-index:30;border:1px solid var(--ps-border,#dcdde0);background:var(--ps-panel,#fff);color:var(--ps-text,#1a1c20);border-radius:999px;padding:8px 16px;font:600 13px var(--ps-font-ui,system-ui,sans-serif);box-shadow:0 2px 10px rgba(0,0,0,.18);cursor:pointer;min-height:40px}
.gf-backpill:hover{border-color:var(--ps-accent,#1b4fd1)}
/* Narrow screens: the pill moves up under the Back to plan button, clear of the 3D view chips (Street view, Front, Aerial) at the bottom left. */
@media (max-width:599.98px){.ps-stage[data-commercial="1"] .gf-backpill{top:86px}.gf-backpill{top:52px;bottom:auto;left:12px;padding:5px 12px;min-height:32px;font-size:12px}}
/* With the lot card open over the 3D view the pill goes to the top left column too, so it never sits on the card's buttons. */
.ps-stage:has(.lc-root:not([hidden])) .gf-backpill{top:108px;bottom:auto;left:12px}
.gf-kinds{display:grid;gap:12px;grid-template-columns:repeat(auto-fill,minmax(220px,1fr))}
.gf-kind-ic{font-size:12px;color:var(--gf-muted)}

.gf-types{display:grid;gap:14px;grid-template-columns:repeat(auto-fill,minmax(250px,1fr))}
.gf-typecard{text-align:left;border:2px solid var(--gf-border);border-radius:12px;background:var(--gf-panel);color:inherit;padding:0;overflow:hidden;display:flex;flex-direction:column;cursor:pointer;font:inherit;min-height:44px}
.gf-typecard:hover{border-color:var(--gf-acc)}
.gf-typecard[aria-pressed="true"]{border-color:var(--gf-acc);box-shadow:0 0 0 3px var(--gf-acc-soft)}
.gf-typecard-b{padding:12px 14px;display:flex;flex-direction:column;gap:6px}
.gf-typecard-s{color:var(--gf-muted);font-size:13px}
@media (max-width:900px){
 .gf-grid,.gf-place,.gf-check{grid-template-columns:minmax(0,1fr)}
 .gf-place--fit{grid-template-rows:auto;grid-template-areas:"coach" "fit" "stage" "side"}
 .gf-stage{min-height:300px;flex:none;height:46vh}
 .gf-3d{min-height:280px;height:38vh;flex:none}
}
@media (max-width:640px){
 .gf-head{padding:8px 12px;gap:8px;flex-wrap:wrap}
 .gf-brand{font-size:13px}
 .gf-prog{order:3;flex-basis:100%;justify-content:space-between;gap:0}
 .gf-prog li{padding:2px 4px}
 .gf-prog li:not([data-state="current"]) .gf-lbl{display:none}
 .gf-body{padding:14px 12px}
 .gf-title{font-size:20px}
 .gf-foot{padding:10px 12px}
 .gf-foot .gf-count{display:none}
 .gf-foot .gf-btn{flex:1}
 .gf-homes,.gf-types{grid-template-columns:minmax(0,1fr)}
}
@media (prefers-reduced-motion:no-preference){.gf-root{animation:gf-in .18s ease-out}@keyframes gf-in{from{opacity:0}to{opacity:1}}}
${FINDER_CSS}`;
