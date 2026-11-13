import{a as wt,f as vt,g as kt}from"./ps-chunk-BPB232KT.js";import{a as K,b as ut,f as bt,g as gt,m as yt,n as C,o as ot}from"./ps-chunk-3SDROMR5.js";import{a as ct,b as m,f as dt,g as xt,h as ft,i as ht,j as $t,n as mt}from"./ps-chunk-EIHKGOZF.js";import"./ps-chunk-FYM43IIJ.js";import"./ps-chunk-2NDQRQNN.js";import{A as rt,B as lt,F as pt}from"./ps-chunk-YUABBF4N.js";import"./ps-chunk-F4D5FBML.js";import"./ps-chunk-E4XECTYR.js";var Dt="Concept design only. Not for construction. Not a development application drawing. Verify all dimensions on site.",l=K.ink,Bt=K.accent,At="#80848c",Et="#26282e",It="#9ea0a6",Nt="#c43030",Mt="#3c425a",zt="Helvetica, Arial, 'Segoe UI', sans-serif",n=r=>String(r??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");var t=r=>Math.round(r*10)/10,et=r=>`${t(r.x)},${t(r.y)}`,I=r=>r.map(et).join(" "),P=r=>`${(Math.round(r*100)/100).toFixed(2)} m\xB2`;function Ot(r,M,{catalogue:G=null,withSite:N=!1}={}){let X=gt(r,M,N,G),{shapes:L,dims:j,box:x}=X,u=Math.max(x.w,x.h,4e3),k=u*.04,O=u*.1,b={x0:x.minX-k,y0:x.minY-k,x1:x.maxX+k,y1:x.maxY+k+O},g=o=>t(u*o),f=g(.0016),D=g(.0026),T=u/72,Q=T*.86,p=Math.max(u/88,160),s=[];for(let o of M.rooms)o.outdoor&&s.push(`<polygon points="${I(o.polygon)}" fill="#f0eee4" stroke="${At}" stroke-width="${f}" stroke-dasharray="${g(.008)} ${g(.005)}"/>`);let _=[];for(let o of M.furniture){for(let a of yt(G,o)){let i=t(Math.max(.5,Math.min(3.5,a.width||1))*f);for(let e of a.paths)if(!(e.pts.length<2))if(a.op==="fill"){if(e.pts.length<3)continue;let d=a.tint?Math.min(1,a.alpha):0,$=F=>Math.round(255-(255-F)*d);s.push(`<polygon points="${I(e.pts)}" fill="rgb(${$(128)},${$(132)},${$(140)})" stroke="none"/>`)}else{let d=a.dash?.length?` stroke-dasharray="${a.dash.map(F=>t(Math.max(20,F))).join(" ")}"`:"",$=e.closed&&e.pts.length>2?"polygon":"polyline";s.push(`<${$} points="${I(e.pts)}" fill="none" stroke="${At}" stroke-width="${i}"${d}/>`)}}_.push(C($t(o,ht(G,o)),30))}for(let o of M.stairs){let a=ft(o);s.push(`<polygon points="${I(a.corners)}" fill="#fff" stroke="${l}" stroke-width="${D}"/>`);for(let i of a.treads)s.push(`<line x1="${t(i[0].x)}" y1="${t(i[0].y)}" x2="${t(i[1].x)}" y2="${t(i[1].y)}" stroke="${l}" stroke-width="${f}"/>`);for(let i of a.arrow)s.push(`<polyline points="${I(i)}" fill="none" stroke="${l}" stroke-width="${D}"/>`)}for(let o of L){let a=o.wall.status;for(let i of o.pieces)if(a==="demolish")s.push(`<polygon points="${I(i.poly)}" fill="none" stroke="${Nt}" stroke-width="${f}" stroke-dasharray="${g(.006)} ${g(.004)}"/>`);else{let e=a==="existing"?It:Et;s.push(`<polygon points="${I(i.poly)}" fill="${e}" stroke="${e}" stroke-width="${t(f*.5)}"/>`)}}let H=[];for(let o of L)for(let a of o.spans){let i=a.opening;if(i.kind==="door"){let e=dt(o,i),d=Math.atan2(e.F.y-e.H.y,e.F.x-e.H.x),$=Math.atan2(e.O.y-e.H.y,e.O.x-e.H.x)-d;$=Math.atan2(Math.sin($),Math.cos($)),s.push(`<g fill="none" stroke="${l}" stroke-width="${f}"><line x1="${t(e.H.x)}" y1="${t(e.H.y)}" x2="${t(e.O.x)}" y2="${t(e.O.y)}"/><path d="M${et(e.F)} A${t(e.radius)} ${t(e.radius)} 0 0 ${$>0?1:0} ${et(e.O)}"/></g>`),H.push(C([e.H,e.F,e.O,{x:e.F.x+e.O.x-e.H.x,y:e.F.y+e.O.y-e.H.y}],20))}for(let e of xt(o,i).lines)s.push(`<line x1="${t(e[0].x)}" y1="${t(e[0].y)}" x2="${t(e[1].x)}" y2="${t(e[1].y)}" stroke="${l}" stroke-width="${f}"/>`)}let A=[],z=[];for(let o of j){A.push(C([o.a,o.b],60));for(let e of o.ext)A.push(C(e,40)),z.push(`<line x1="${t(e[0].x)}" y1="${t(e[0].y)}" x2="${t(e[1].x)}" y2="${t(e[1].y)}"/>`);z.push(`<line x1="${t(o.a.x)}" y1="${t(o.a.y)}" x2="${t(o.b.x)}" y2="${t(o.b.y)}"/>`);for(let e of o.ticks)z.push(`<line x1="${t(e[0].x)}" y1="${t(e[0].y)}" x2="${t(e[1].x)}" y2="${t(e[1].y)}" stroke-width="${D}"/>`);let a=o.text.length*p*.56;A.push(o.textRot?{x0:o.textAt.x-p,y0:o.textAt.y-a/2,x1:o.textAt.x+40,y1:o.textAt.y+a/2}:{x0:o.textAt.x-a/2,y0:o.textAt.y-p,x1:o.textAt.x+a/2,y1:o.textAt.y+40});let i=o.textRot?` transform="rotate(-90 ${t(o.textAt.x)} ${t(o.textAt.y)})"`:"";z.push(`<text x="${t(o.textAt.x)}" y="${t(o.textAt.y)}"${i} text-anchor="middle" fill="${Mt}" stroke="none" font-size="${t(p)}">${n(o.text)}</text>`)}let Y=[];for(let o of L)for(let a of o.pieces)Y.push(C(a.poly,10));let q=Math.max(0,...L.map(o=>Number(o.wall.thickness)||0))/2+u/400,J=[],U=[];for(let o of M.rooms){let a=m(o.name)||String(o.type||"Room"),i=P(rt(o.polygon)/1e6),e=pt(o.polygon),d=T,$=Math.max(a.length*.6*d,i.length*.52*Q),F=Math.max(e.w-2*q,600);$>F&&(d=Math.max(T*.55,d*(F/$)));let V=d*.86,Z=Math.max(a.length*.6*d,i.length*.52*V),W=d+V*1.15,Lt=[...Y,..._,...H,...A,...J],tt=lt(o.polygon),st={poly:o.polygon,w:Z,h:W,obstacles:Lt,prefer:tt,step:Math.max(u/220,40)},E=ot({...st,inset:q})||ot({...st,inset:u/800})||{x:tt.x,y:tt.y};J.push({x0:E.x-Z/2,y0:E.y-W/2,x1:E.x+Z/2,y1:E.y+W/2});let it=E.y-W/2;U.push(`<text x="${t(E.x)}" y="${t(it+d*.88)}" text-anchor="middle" font-size="${t(d)}" font-weight="700" fill="${l}">${n(a)}</text><text x="${t(E.x)}" y="${t(it+d+V*1.02)}" text-anchor="middle" font-size="${t(V)}" fill="${l}">${n(i)}</text>`)}s.push(...U);for(let o of N?r.site?.tanks||[]:[])s.push(`<circle cx="${t(o.x)}" cy="${t(o.y)}" r="${t(o.diameter/2)}" fill="none" stroke="${l}" stroke-width="${D}"/>`),s.push(`<text x="${t(o.x)}" y="${t(o.y+p*.35)}" text-anchor="middle" font-size="${t(p)}" fill="${l}">${n(`RWT ${Math.round(o.capacityL)}L`)}</text>`);s.push(`<g stroke="${Mt}" stroke-width="${f}">${z.join("")}</g>`);let y=[5,4,3,2,1].map(o=>({n:o,mm:o*1e3})).find(o=>o.mm<=x.w*.9)||{n:1,mm:1e3},R=y.n>=5?5:y.n>=2?2:1,h=x.maxY+k+O*.5,w=u*.006;for(let o=0;o<R;o++)s.push(`<rect x="${t(x.minX+y.mm*o/R)}" y="${t(h)}" width="${t(y.mm/R)}" height="${t(w)}" fill="${o%2?"#fff":l}" stroke="${l}" stroke-width="${f}"/>`);s.push(`<text x="${t(x.minX)}" y="${t(h-p*.35)}" text-anchor="middle" font-size="${t(p)}" fill="${l}">0</text>`),s.push(`<text x="${t(x.minX+y.mm)}" y="${t(h-p*.35)}" text-anchor="middle" font-size="${t(p)}" fill="${l}">${y.n} m</text>`);let c=u*.03,S=x.maxX-c,v=h-c*.2,B=Number(r.site?.northDeg)||0;s.push(`<g transform="rotate(${B} ${t(S)} ${t(v)})"><polygon points="${t(S)},${t(v-c)} ${t(S+c*.38)},${t(v+c*.6)} ${t(S)},${t(v+c*.3)} ${t(S-c*.38)},${t(v+c*.6)}" fill="${l}"/><text x="${t(S)}" y="${t(v-c*1.12)}" text-anchor="middle" font-size="${t(p*1.1)}" font-weight="700" fill="${l}">N</text></g>`);let nt=b.x1-b.x0,at=b.y1-b.y0,St=`${m(M.name)||"Level"} floor plan`;return`<svg class="pa-plan" viewBox="${t(b.x0)} ${t(b.y0)} ${t(nt)} ${t(at)}" role="img" aria-label="${n(St)}" font-family="${n(zt)}" style="aspect-ratio:${t(nt)}/${t(at)}">${s.join("")}</svg>`}var Tt=`
:root{--ink:${l};--accent:${Bt};--line:#d9dee4;--bg:#f4f6f8;--card:#fff;--mut:#5b6877}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.5 ${zt}}
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
footer{border-top:1px solid var(--line);background:#fff;margin-top:12px}
footer .pa-wrap{padding:14px 16px 22px;font-size:12.5px;color:var(--mut)}
footer p{margin:0 0 6px}
[hidden]{display:none!important}
@media print{.pa-tabs,.pa-view,.pa-tools{display:none!important}.pa-scroll{overflow:visible}.pa-plan{min-width:0}[data-panel=plan]{display:block!important}body{background:#fff}.pa-card{break-inside:avoid}}
`,Ht=`(function(){var tabs=[].slice.call(document.querySelectorAll('.pa-tab')),panels=[].slice.call(document.querySelectorAll('[data-panel]'));
function show(n){tabs.forEach(function(t){t.setAttribute('aria-selected',String(t.dataset.tab===n))});panels.forEach(function(p){p.hidden=p.dataset.panel!==n});
var g=document.getElementById('pa-glb');
if(n==='3d'&&window.PA3D&&!window.PA3D.started&&g){window.PA3D.start(document.getElementById('pa-view'),g.textContent.trim(),g.getAttribute('data-enc')||'')}
if(window.PA3D&&window.PA3D.started)window.PA3D.setActive(n==='3d')}
tabs.forEach(function(t){t.addEventListener('click',function(){show(t.dataset.tab);try{history.replaceState(null,'','#'+t.dataset.tab)}catch(e){}})});
var h=(location.hash||'').slice(1);show(h==='3d'&&document.getElementById('pa-view')?'3d':'plan')})();`;function jt(r,M={}){let{catalogue:G=null,config:N={},glb:X="",glbEncoding:L="",viewerJs:j="",logo:x=ut,date:u=new Date,trial:k=!1}=M,O=!!(X&&j),b=ct(r),g=mt(r),f=r.titleBlock||{},D=m(f.projectName)||m(r.name)||"Design",T=m(f.date)||bt(u),Q=m(N.disclaimer||Dt),p=N.seller||{},s=g.totals.reduce((h,w)=>h+w.indoor,0),_=g.totals.reduce((h,w)=>h+w.outdoor,0),H=b.reduce((h,w)=>h+w.rooms.filter(c=>c.type==="bedroom").length,0),A=[`<li><b>${n(P(s))}</b> indoor</li>`];_>0&&A.push(`<li><b>${n(P(_))}</b> outdoor</li>`),A.push(`<li><b>${b.length}</b> ${b.length===1?"level":"levels"}</li>`),H&&A.push(`<li><b>${H}</b> ${H===1?"bedroom":"bedrooms"}</li>`);let z=[m(f.client),m(f.address)].filter(Boolean).join(" | "),Y=b.map((h,w)=>{let c=g.totals[w],S=g.rooms.filter(B=>B.level===m(h.name)).map(B=>`<tr><td>${n(B.name)}</td><td>${n(B.type)}</td><td class="n">${n(P(B.area))}</td></tr>`),v=m(h.name)||"Level";return`<section class="pa-card" aria-label="${n(v)} floor plan"><h2>${n(v)} floor plan</h2><div class="pa-scroll">${Ot(r,h,{catalogue:G,withSite:w===0})}</div></section>
<section class="pa-card"><h2>${n(v)} rooms</h2><div class="pa-scroll"><table><thead><tr><th>Room</th><th>Type</th><th class="n">Area (m\xB2)</th></tr></thead><tbody>${S.join("")}<tr class="tot"><td colspan="2">Total indoor</td><td class="n">${n(P(c.indoor))}</td></tr>${c.outdoor>0?`<tr class="tot"><td colspan="2">Total outdoor</td><td class="n">${n(P(c.outdoor))}</td></tr>`:""}</tbody></table></div></section>`}),q=`<nav class="pa-tabs" role="tablist" aria-label="Views"><button class="pa-tab" role="tab" data-tab="plan" aria-selected="true">Plan</button>${O?'<button class="pa-tab" role="tab" data-tab="3d" aria-selected="false">3D</button>':""}</nav>`,J=O?'<div data-panel="3d" hidden><div class="pa-view" id="pa-view" aria-label="Interactive 3D model"><div class="pa-tools"><button class="pa-btn" id="pa-reset" type="button">Reset view</button><button class="pa-btn" id="pa-roof" type="button" aria-pressed="true" hidden>Roof on</button></div></div></div>':"",U=O?`<script id="pa-glb" type="text/plain"${L?` data-enc="${n(L)}"`:""}>${X}<\/script>
<script>${j.replace(/<\/script/gi,"<\\/script").replace(/<!--/g,"<\\!--")}<\/script>
`:"",y=K.name,R=[m(p.name),p.abn?`ABN ${m(p.abn)}`:""].filter(Boolean).join(" | ");return`<!doctype html>
<html lang="en-AU">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${n(D)} | ${n(y)}</title>
<meta name="robots" content="noindex">
<style>${Tt}${k?vt:""}</style>${k?`
<meta name="generator" content="${wt}">`:""}
</head>
<body>${k?`
${kt}`:""}
<header class="pa-head"><div class="pa-wrap">
<div class="pa-top"><img class="pa-logo" src="${n(x)}" alt="${n(y)}"><span class="pa-date">${n(T)}</span></div>
<h1>${n(D)}</h1>
${z?`<p class="pa-sub">${n(z)}</p>`:""}
<ul class="pa-stats">${A.join("")}</ul>
${q}
</div></header>
<main><div class="pa-wrap">
<div data-panel="plan">${Y.join(`
`)}</div>
${J}
</div></main>
<footer><div class="pa-wrap"><p>${n(Q)}</p><p>${n(y)} | ${n(N.productName||"Pocket Architect")}${R?` | ${n(R)}`:""} | Prepared ${n(T)}</p></div></footer>
${U}<script>${Ht}<\/script>
</body>
</html>
`}export{Dt as HTML_DISCLAIMER,n as esc,Ot as levelSvg,jt as toHTML};
