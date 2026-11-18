import{d as yt,n as wt,o as vt}from"./ps-chunk-CKAXM6KG.js";import{a as tt,b as kt,f as At,g as Mt,m as zt,n as P,o as nt}from"./ps-chunk-2LB3QLU2.js";import{a as dt,b as $,f as xt,g as ft,h as ht,i as $t,j as mt,n as bt}from"./ps-chunk-ODWTJKMZ.js";import{t as ut,u as gt}from"./ps-chunk-WYF3YJCY.js";import"./ps-chunk-Y3RQN2V7.js";import"./ps-chunk-M6JB7X2N.js";import"./ps-chunk-MVPQ7ORD.js";import"./ps-chunk-GBTDWXNT.js";import"./ps-chunk-WDZCJAMI.js";import"./ps-chunk-6C4UOIRG.js";import"./ps-chunk-LS64NFS3.js";import"./ps-chunk-Z4ANWK4B.js";import"./ps-chunk-TTN77HBS.js";import{B as lt,C as pt,G as ct}from"./ps-chunk-6KHILDJR.js";import"./ps-chunk-E4XECTYR.js";var Ot="Concept design only. Not for construction. Not a development application drawing. Verify all dimensions on site.",p=tt.ink,Bt=tt.accent,St="#80848c",Et="#26282e",It="#9ea0a6",Tt="#c43030",Lt="#3c425a",Nt="Helvetica, Arial, 'Segoe UI', sans-serif",a=s=>String(s??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");var t=s=>Math.round(s*10)/10,st=s=>`${t(s.x)},${t(s.y)}`,E=s=>s.map(st).join(" "),_=s=>`${(Math.round(s*100)/100).toFixed(2)} m\xB2`;function Ht(s,A,{catalogue:X=null,withSite:M=!1}={}){let q=Mt(s,A,M,X),{shapes:S,dims:J,box:f}=q,b=Math.max(f.w,f.h,4e3),w=b*.04,L=b*.1,g={x0:f.minX-w,y0:f.minY-w,x1:f.maxX+w,y1:f.maxY+w+L},y=o=>t(b*o),h=y(.0016),N=y(.0026),I=b/72,ot=I*.86,c=Math.max(b/88,160),i=[];for(let o of A.rooms)o.outdoor&&i.push(`<polygon points="${E(o.polygon)}" fill="#f0eee4" stroke="${St}" stroke-width="${h}" stroke-dasharray="${y(.008)} ${y(.005)}"/>`);let j=[];for(let o of A.furniture){for(let n of zt(X,o)){let l=t(Math.max(.5,Math.min(3.5,n.width||1))*h);for(let e of n.paths)if(!(e.pts.length<2))if(n.op==="fill"){if(e.pts.length<3)continue;let x=n.tint?Math.min(1,n.alpha):0,m=G=>Math.round(255-(255-G)*x);i.push(`<polygon points="${E(e.pts)}" fill="rgb(${m(128)},${m(132)},${m(140)})" stroke="none"/>`)}else{let x=n.dash?.length?` stroke-dasharray="${n.dash.map(G=>t(Math.max(20,G))).join(" ")}"`:"",m=e.closed&&e.pts.length>2?"polygon":"polyline";i.push(`<${m} points="${E(e.pts)}" fill="none" stroke="${St}" stroke-width="${l}"${x}/>`)}}j.push(P(mt(o,$t(X,o)),30))}for(let o of A.stairs){let n=ht(o);i.push(`<polygon points="${E(n.corners)}" fill="#fff" stroke="${p}" stroke-width="${N}"/>`);for(let l of n.treads)i.push(`<line x1="${t(l[0].x)}" y1="${t(l[0].y)}" x2="${t(l[1].x)}" y2="${t(l[1].y)}" stroke="${p}" stroke-width="${h}"/>`);for(let l of n.arrow)i.push(`<polyline points="${E(l)}" fill="none" stroke="${p}" stroke-width="${N}"/>`)}for(let o of S){let n=o.wall.status;for(let l of o.pieces)if(n==="demolish")i.push(`<polygon points="${E(l.poly)}" fill="none" stroke="${Tt}" stroke-width="${h}" stroke-dasharray="${y(.006)} ${y(.004)}"/>`);else{let e=n==="existing"?It:Et;i.push(`<polygon points="${E(l.poly)}" fill="${e}" stroke="${e}" stroke-width="${t(h*.5)}"/>`)}}let T=[];for(let o of S)for(let n of o.spans){let l=n.opening;if(l.kind==="door"){let e=xt(o,l),x=Math.atan2(e.F.y-e.H.y,e.F.x-e.H.x),m=Math.atan2(e.O.y-e.H.y,e.O.x-e.H.x)-x;m=Math.atan2(Math.sin(m),Math.cos(m)),i.push(`<g fill="none" stroke="${p}" stroke-width="${h}"><line x1="${t(e.H.x)}" y1="${t(e.H.y)}" x2="${t(e.O.x)}" y2="${t(e.O.y)}"/><path d="M${st(e.F)} A${t(e.radius)} ${t(e.radius)} 0 0 ${m>0?1:0} ${st(e.O)}"/></g>`),T.push(P([e.H,e.F,e.O,{x:e.F.x+e.O.x-e.H.x,y:e.F.y+e.O.y-e.H.y}],20))}for(let e of ft(o,l).lines)i.push(`<line x1="${t(e[0].x)}" y1="${t(e[0].y)}" x2="${t(e[1].x)}" y2="${t(e[1].y)}" stroke="${p}" stroke-width="${h}"/>`)}let v=[],z=[];for(let o of J){v.push(P([o.a,o.b],60));for(let e of o.ext)v.push(P(e,40)),z.push(`<line x1="${t(e[0].x)}" y1="${t(e[0].y)}" x2="${t(e[1].x)}" y2="${t(e[1].y)}"/>`);z.push(`<line x1="${t(o.a.x)}" y1="${t(o.a.y)}" x2="${t(o.b.x)}" y2="${t(o.b.y)}"/>`);for(let e of o.ticks)z.push(`<line x1="${t(e[0].x)}" y1="${t(e[0].y)}" x2="${t(e[1].x)}" y2="${t(e[1].y)}" stroke-width="${N}"/>`);let n=o.text.length*c*.56;v.push(o.textRot?{x0:o.textAt.x-c,y0:o.textAt.y-n/2,x1:o.textAt.x+40,y1:o.textAt.y+n/2}:{x0:o.textAt.x-n/2,y0:o.textAt.y-c,x1:o.textAt.x+n/2,y1:o.textAt.y+40});let l=o.textRot?` transform="rotate(-90 ${t(o.textAt.x)} ${t(o.textAt.y)})"`:"";z.push(`<text x="${t(o.textAt.x)}" y="${t(o.textAt.y)}"${l} text-anchor="middle" fill="${Lt}" stroke="none" font-size="${t(c)}">${a(o.text)}</text>`)}let U=[];for(let o of S)for(let n of o.pieces)U.push(P(n.poly,10));let V=Math.max(0,...S.map(o=>Number(o.wall.thickness)||0))/2+b/400,W=[],H=[];for(let o of A.rooms){let n=$(o.name)||String(o.type||"Room"),l=_(lt(o.polygon)/1e6),e=ct(o.polygon),x=I,m=Math.max(n.length*.6*x,l.length*.52*ot),G=Math.max(e.w-2*V,600);m>G&&(x=Math.max(I*.55,x*(G/m)));let Q=x*.86,et=Math.max(n.length*.6*x,l.length*.52*Q),Z=x+Q*1.15,Dt=[...U,...j,...T,...v,...W],at=pt(o.polygon),it={poly:o.polygon,w:et,h:Z,obstacles:Dt,prefer:at,step:Math.max(b/220,40)},B=nt({...it,inset:V})||nt({...it,inset:b/800})||{x:at.x,y:at.y};W.push({x0:B.x-et/2,y0:B.y-Z/2,x1:B.x+et/2,y1:B.y+Z/2});let rt=B.y-Z/2;H.push(`<text x="${t(B.x)}" y="${t(rt+x*.88)}" text-anchor="middle" font-size="${t(x)}" font-weight="700" fill="${p}">${a(n)}</text><text x="${t(B.x)}" y="${t(rt+x+Q*1.02)}" text-anchor="middle" font-size="${t(Q)}" fill="${p}">${a(l)}</text>`)}i.push(...H);for(let o of M?s.site?.tanks||[]:[])i.push(`<circle cx="${t(o.x)}" cy="${t(o.y)}" r="${t(o.diameter/2)}" fill="none" stroke="${p}" stroke-width="${N}"/>`),i.push(`<text x="${t(o.x)}" y="${t(o.y+c*.35)}" text-anchor="middle" font-size="${t(c)}" fill="${p}">${a(`RWT ${Math.round(o.capacityL)}L`)}</text>`);i.push(`<g stroke="${Lt}" stroke-width="${h}">${z.join("")}</g>`);let k=[5,4,3,2,1].map(o=>({n:o,mm:o*1e3})).find(o=>o.mm<=f.w*.9)||{n:1,mm:1e3},Y=k.n>=5?5:k.n>=2?2:1,R=f.maxY+w+L*.5,F=b*.006;for(let o=0;o<Y;o++)i.push(`<rect x="${t(f.minX+k.mm*o/Y)}" y="${t(R)}" width="${t(k.mm/Y)}" height="${t(F)}" fill="${o%2?"#fff":p}" stroke="${p}" stroke-width="${h}"/>`);i.push(`<text x="${t(f.minX)}" y="${t(R-c*.35)}" text-anchor="middle" font-size="${t(c)}" fill="${p}">0</text>`),i.push(`<text x="${t(f.minX+k.mm)}" y="${t(R-c*.35)}" text-anchor="middle" font-size="${t(c)}" fill="${p}">${k.n} m</text>`);let u=b*.03,r=f.maxX-u,d=R-u*.2,D=Number(s.site?.northDeg)||0;i.push(`<g transform="rotate(${D} ${t(r)} ${t(d)})"><polygon points="${t(r)},${t(d-u)} ${t(r+u*.38)},${t(d+u*.6)} ${t(r)},${t(d+u*.3)} ${t(r-u*.38)},${t(d+u*.6)}" fill="${p}"/><text x="${t(r)}" y="${t(d-u*1.12)}" text-anchor="middle" font-size="${t(c*1.1)}" font-weight="700" fill="${p}">N</text></g>`);let K=g.x1-g.x0,C=g.y1-g.y0,O=`${$(A.name)||"Level"} floor plan`;return`<svg class="pa-plan" viewBox="${t(g.x0)} ${t(g.y0)} ${t(K)} ${t(C)}" role="img" aria-label="${a(O)}" font-family="${a(Nt)}" style="aspect-ratio:${t(K)}/${t(C)}">${i.join("")}</svg>`}var Rt=`
:root{--ink:${p};--accent:${Bt};--line:#d9dee4;--bg:#f4f6f8;--card:#fff;--mut:#5b6877}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.5 ${Nt}}
header.pa-head{background:#fff;border-bottom:3px solid var(--accent)}
.pa-wrap{max-width:1100px;margin:0 auto;padding:0 16px}
.pa-top{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:14px 0 6px;flex-wrap:wrap}
.pa-logo{height:30px;width:auto;max-width:70vw}
.pa-date{color:var(--mut);font-size:13px}
h1{margin:6px 0 2px;font-size:clamp(22px,4.5vw,32px);line-height:1.2}
.pa-sub{color:var(--mut);margin:0 0 10px}
.pa-stats{display:flex;flex-wrap:wrap;gap:8px;margin:8px 0 14px;padding:0;list-style:none}
.pa-stats li{background:var(--bg);border:1px solid var(--line);border-radius:8px;padding:6px 12px;font-size:14px}
.pa-stats b{font-size:16px}
.pa-tabs{display:flex;gap:4px;margin:0;padding:0}
.pa-tab{appearance:none;border:0;background:transparent;font:inherit;font-weight:600;color:var(--mut);padding:10px 18px;border-bottom:3px solid transparent;margin-bottom:-3px;cursor:pointer}
.pa-tab[aria-selected=true]{color:var(--ink);border-bottom-color:var(--ink)}
.pa-tab:focus-visible,.pa-btn:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
main{padding:18px 0 8px}
.pa-card{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:14px;margin:0 0 16px}
.pa-card h2{margin:0 0 8px;font-size:18px}
.pa-scroll{overflow-x:auto;-webkit-overflow-scrolling:touch}
.pa-plan{display:block;width:100%;min-width:560px;height:auto;background:#fff}
table{border-collapse:collapse;width:100%;font-size:14px}
th,td{text-align:left;padding:6px 8px;border-bottom:1px solid var(--line)}
th{background:var(--bg);font-weight:600}
td.n,th.n{text-align:right;white-space:nowrap}
tr.tot td{font-weight:700}
.pa-view{position:relative;background:linear-gradient(#cfe3f2,#f3f7fa 70%);border-radius:10px;overflow:hidden;height:min(72vh,720px);min-height:340px;border:1px solid var(--line)}
.pa-view canvas{display:block;width:100%;height:100%;touch-action:none}
.pa-tools{position:absolute;right:10px;top:10px;display:flex;gap:6px;flex-wrap:wrap;z-index:2}
.pa-btn{appearance:none;border:1px solid var(--line);background:#fff;color:var(--ink);font:inherit;font-size:14px;font-weight:600;padding:7px 12px;border-radius:8px;cursor:pointer;min-height:36px}
.pa-btn[aria-pressed=true]{background:var(--ink);color:#fff;border-color:var(--ink)}
.pa-msg{padding:28px 18px;text-align:center;color:var(--mut)}
.pa-lbl{position:absolute;left:0;top:0;transform:translate(-50%,-50%);pointer-events:none;white-space:nowrap;text-align:center;font:700 12px/1.25 Arial,sans-serif;color:#3a3f33;background:rgba(255,255,255,.76);border:1px solid rgba(58,63,51,.35);border-radius:14px;padding:3px 10px}
.pa-lbl.lot{font-size:14px;color:#a61b1b;border-color:rgba(166,27,27,.55)}
.pa-lbl small{display:block;font-weight:600;font-size:.86em}
footer{border-top:1px solid var(--line);background:#fff;margin-top:12px}
footer .pa-wrap{padding:14px 16px 22px;font-size:12.5px;color:var(--mut)}
footer p{margin:0 0 6px}
[hidden]{display:none!important}
@media print{.pa-tabs,.pa-view,.pa-tools{display:none!important}.pa-scroll{overflow:visible}.pa-plan{min-width:0}[data-panel=plan]{display:block!important}body{background:#fff}.pa-card{break-inside:avoid}}
`,Ft=`(function(){var tabs=[].slice.call(document.querySelectorAll('.pa-tab')),panels=[].slice.call(document.querySelectorAll('[data-panel]'));
function show(n){tabs.forEach(function(t){t.setAttribute('aria-selected',String(t.dataset.tab===n))});panels.forEach(function(p){p.hidden=p.dataset.panel!==n});
var g=document.getElementById('pa-glb');
if(n==='3d'&&window.PA3D&&!window.PA3D.started&&g){window.PA3D.start(document.getElementById('pa-view'),g.textContent.trim(),g.getAttribute('data-enc')||'')}
if(window.PA3D&&window.PA3D.started)window.PA3D.setActive(n==='3d')}
tabs.forEach(function(t){t.addEventListener('click',function(){show(t.dataset.tab);try{history.replaceState(null,'','#'+t.dataset.tab)}catch(e){}})});
var h=(location.hash||'').slice(1);show(h==='3d'&&document.getElementById('pa-view')?'3d':'plan')})();`;function Jt(s,A={}){let{catalogue:X=null,config:M={},glb:q="",glbEncoding:S="",viewerJs:J="",logo:f=kt,date:b=new Date,trial:w=!1}=A,L=!!(q&&J),g=dt(s),y=bt(s),h=s.titleBlock||{},N=$(h.projectName)||$(s.name)||"Design",I=$(h.date)||At(b),ot=$(M.disclaimer||Ot),c=M.seller||{},i=y.totals.reduce((r,d)=>r+d.indoor,0),j=y.totals.reduce((r,d)=>r+d.outdoor,0),T=g.reduce((r,d)=>r+d.rooms.filter(D=>D.type==="bedroom").length,0),v=[`<li><b>${a(_(i))}</b> indoor</li>`];j>0&&v.push(`<li><b>${a(_(j))}</b> outdoor</li>`),v.push(`<li><b>${g.length}</b> ${g.length===1?"level":"levels"}</li>`),T&&v.push(`<li><b>${T}</b> ${T===1?"bedroom":"bedrooms"}</li>`);let z=[$(h.client),$(h.address)].filter(Boolean).join(" | "),U=g.map((r,d)=>{let D=y.totals[d],K=y.rooms.filter(O=>O.level===$(r.name)).map(O=>`<tr><td>${a(O.name)}</td><td>${a(O.type)}</td><td class="n">${a(_(O.area))}</td></tr>`),C=$(r.name)||"Level";return`<section class="pa-card" aria-label="${a(C)} floor plan"><h2>${a(C)} floor plan</h2><div class="pa-scroll">${Ht(s,r,{catalogue:X,withSite:d===0})}</div></section>
<section class="pa-card"><h2>${a(C)} rooms</h2><div class="pa-scroll"><table><thead><tr><th>Room</th><th>Type</th><th class="n">Area (m\xB2)</th></tr></thead><tbody>${K.join("")}<tr class="tot"><td colspan="2">Total indoor</td><td class="n">${a(_(D.indoor))}</td></tr>${D.outdoor>0?`<tr class="tot"><td colspan="2">Total outdoor</td><td class="n">${a(_(D.outdoor))}</td></tr>`:""}</tbody></table></div></section>`}),V=`<nav class="pa-tabs" role="tablist" aria-label="Views"><button class="pa-tab" role="tab" data-tab="plan" aria-selected="true">Plan</button>${L?'<button class="pa-tab" role="tab" data-tab="3d" aria-selected="false">3D</button>':""}</nav>`,W=L?'<div data-panel="3d" hidden><div class="pa-view" id="pa-view" aria-label="Interactive 3D model"><div class="pa-tools"><button class="pa-btn" id="pa-reset" type="button">Reset view</button><button class="pa-btn" id="pa-roof" type="button" aria-pressed="true" hidden>Roof on</button></div></div></div>':"",H=s.site?.lot,k=L&&H?.boundary?.length&&gt(H,"labels")?ut(H).map(r=>({k:r.kind,t:r.lines.map($),x:Math.round(r.x)/1e3,z:Math.round(r.y)/1e3})):[],Y=k.length?`<script id="pa-labels" type="application/json">${JSON.stringify(k).replace(/</g,"\\u003c")}<\/script>
`:"",R=L?`${Y}<script id="pa-glb" type="text/plain"${S?` data-enc="${a(S)}"`:""}>${q}<\/script>
<script>${J.replace(/<\/script/gi,"<\\/script").replace(/<!--/g,"<\\!--")}<\/script>
`:"",F=tt.name,u=[$(c.name),c.abn?`ABN ${$(c.abn)}`:""].filter(Boolean).join(" | ");return`<!doctype html>
<html lang="en-AU">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${a(N)} | ${a(F)}</title>
<meta name="robots" content="noindex">
<style>${Rt}${w?wt:""}</style>${w?`
<meta name="generator" content="${yt}">`:""}
</head>
<body>${w?`
${vt}`:""}
<header class="pa-head"><div class="pa-wrap">
<div class="pa-top"><img class="pa-logo" src="${a(f)}" alt="${a(F)}"><span class="pa-date">${a(I)}</span></div>
<h1>${a(N)}</h1>
${z?`<p class="pa-sub">${a(z)}</p>`:""}
<ul class="pa-stats">${v.join("")}</ul>
${V}
</div></header>
<main><div class="pa-wrap">
<div data-panel="plan">${U.join(`
`)}</div>
${W}
</div></main>
<footer><div class="pa-wrap"><p>${a(ot)}</p><p>${a(M.productName&&M.productName!==F?M.productName:F)}${u?` | ${a(u)}`:""} | Prepared ${a(I)}</p></div></footer>
${R}<script>${Ft}<\/script>
</body>
</html>
`}export{Ot as HTML_DISCLAIMER,a as esc,Ht as levelSvg,Jt as toHTML};
