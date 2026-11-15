var r=`
.up-wrap { display: grid; gap: 12px; min-width: 0; font-size: 14px; }
.up-tabs { display: flex; gap: 6px; flex-wrap: wrap; border-bottom: 1px solid var(--ps-line, rgba(127,127,127,.35)); padding-bottom: 8px; }
.up-tab { appearance: none; border: 1px solid var(--ps-line, rgba(127,127,127,.35)); background: transparent; color: inherit; border-radius: 999px; padding: 6px 14px; font: inherit; cursor: pointer; }
.up-tab[aria-selected="true"] { background: var(--ps-accent, #ffc83d); color: var(--ps-accent-ink, #1b1b1b); border-color: var(--ps-accent, #ffc83d); font-weight: 600; }
.up-drop { border: 2px dashed var(--ps-line, rgba(127,127,127,.55)); border-radius: 12px; padding: 22px 16px; text-align: center; cursor: pointer; display: grid; gap: 6px; }
.up-drop.is-over { border-color: var(--ps-accent, #ffc83d); background: rgba(255,200,61,.1); }
.up-drop b { font-size: 15px; }
.up-hint { margin: 0; opacity: .75; font-size: 12.5px; line-height: 1.45; }
.up-formats { display: flex; flex-wrap: wrap; gap: 6px; justify-content: center; }
.up-formats span { border: 1px solid var(--ps-line, rgba(127,127,127,.4)); border-radius: 6px; padding: 1px 7px; font-size: 12px; }
.up-sec { display: grid; gap: 8px; border: 1px solid var(--ps-line, rgba(127,127,127,.3)); border-radius: 10px; padding: 10px 12px; }
.up-sec h3 { margin: 0; font-size: 13px; letter-spacing: .02em; text-transform: uppercase; opacity: .8; }
.up-row { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
.up-row > .ps-input, .up-row > select { flex: 1 1 160px; min-width: 0; }
.up-lbl { font-size: 12.5px; opacity: .85; }
.up-num { width: 84px; flex: none !important; }
.up-ta { width: 100%; min-height: 120px; font: 13px/1.4 ui-monospace, Menlo, Consolas, monospace; resize: vertical; box-sizing: border-box; }
.up-list { max-height: 150px; overflow: auto; border: 1px solid var(--ps-line, rgba(127,127,127,.3)); border-radius: 8px; }
.up-item { display: flex; gap: 8px; align-items: center; padding: 6px 10px; cursor: pointer; }
.up-item:hover { background: rgba(127,127,127,.12); }
.up-item small { opacity: .7; margin-left: auto; white-space: nowrap; }
.up-crs { max-height: 138px; overflow: auto; border: 1px solid var(--ps-line, rgba(127,127,127,.3)); border-radius: 8px; }
.up-crs button { display: block; width: 100%; text-align: left; border: 0; background: transparent; color: inherit; font: inherit; padding: 5px 10px; cursor: pointer; }
.up-crs button:hover, .up-crs button[aria-selected="true"] { background: rgba(255,200,61,.18); }
.up-warn { margin: 0; padding: 8px 10px; border-radius: 8px; background: rgba(255,170,60,.16); font-size: 12.5px; }
.up-err { margin: 0; padding: 8px 10px; border-radius: 8px; background: rgba(240,80,70,.16); font-size: 13px; }
.up-ok { margin: 0; padding: 8px 10px; border-radius: 8px; background: rgba(90,200,140,.16); font-size: 13px; }
.up-prev { width: 100%; height: 150px; border-radius: 8px; background: rgba(127,127,127,.12); display: block; }
.up-table { width: 100%; border-collapse: collapse; font-size: 12.5px; }
.up-table th, .up-table td { text-align: left; padding: 3px 6px; border-bottom: 1px solid rgba(127,127,127,.2); }
.up-map { display: grid; gap: 8px; }
.up-map-wrap { position: relative; }
.up-map-cv { width: 100%; height: auto; border-radius: 10px; touch-action: none; cursor: grab; display: block; background: #8b8e92; }
.up-map-bar { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.up-map-bar > input[type="text"] { flex: 1 1 200px; }
.up-map-bar > input[type="range"] { flex: 1 1 160px; }
.up-map-zoom { position: absolute; right: 8px; top: 8px; display: grid; gap: 4px; }
.up-zoom { width: 34px; padding: 0 !important; justify-content: center; }
.up-map-coords { font: 12px ui-monospace, Menlo, Consolas, monospace; opacity: .8; }
.up-map-note { font-size: 12.5px; opacity: .85; }
.up-attr { position: fixed; left: 10px; bottom: 6px; z-index: 5; font: 11px system-ui, sans-serif; color: rgba(255,255,255,.92); text-shadow: 0 1px 2px rgba(0,0,0,.7); pointer-events: none; }
.up-rules-grid { display: grid; grid-template-columns: minmax(0, 1fr) 96px 64px; gap: 6px 8px; align-items: center; }
.up-rules-grid .up-def { grid-column: 1 / -1; font-size: 11.5px; opacity: .7; margin-top: -4px; }
.lc-upload{position:absolute;right:64px;top:62px;height:30px;padding:0 14px!important;border:1px solid rgba(255,255,255,.22)!important;background:rgba(10,10,12,.76)!important;-webkit-backdrop-filter:blur(16px);backdrop-filter:blur(16px);border-radius:15px;font:500 12px var(--lc-sans,system-ui);color:var(--lc-t1,#fff);cursor:pointer;display:flex;align-items:center;z-index:2}
.lc-upload:hover{background:rgba(40,40,46,.85)}
.lc-embed.is-compact .lc-upload{right:62px;top:58px}
.lc-root[data-view="2d"] .lc-upload,.lc-root[data-view="split"] .lc-upload{display:none!important}
.up-tag { font-size: 11px; border-radius: 6px; padding: 1px 6px; background: rgba(255,200,61,.22); white-space: nowrap; }
.up-tag.is-set { background: rgba(90,200,140,.22); }
`,a=()=>{if(typeof document>"u"||document.getElementById("up-style"))return;let p=document.createElement("style");p.id="up-style",p.textContent=r,document.head.append(p)};export{a};
