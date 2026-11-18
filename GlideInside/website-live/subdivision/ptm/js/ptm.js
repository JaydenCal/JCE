/* Plan-to-model widget (interactive build).
   The 3D viewer is an iframe (models/*.html?embed=1) driven by postMessage. It loads when the section nears the
   viewport, is interactive as soon as it is ready (see models/embed-bridge.js for the click / touch rules),
   renders on demand, and the hidden model's iframe (and its WebGL context) is released when switching.
   The plan/model slider drives the morph; there is no scroll pinning, so nothing fights the visitor's orbit. */
(function(){
'use strict';
var d=document,root=d.documentElement;
var reduce=window.matchMedia('(prefers-reduced-motion: reduce)').matches;
function $(s,c){return (c||d).querySelector(s)}
function $$(s,c){return Array.prototype.slice.call((c||d).querySelectorAll(s))}
function clamp(v,a,b){return v<a?a:v>b?b:v}
function el(tag,cls,txt){var e=d.createElement(tag);if(cls)e.className=cls;if(txt)e.textContent=txt;return e}
var sec=$('#showcase');if(!sec)return;
var slots=$$('.slot',sec),toggles=$$('.tg',sec),wrap=$('.stagewrap',sec);
var range=$('#showRange'),rdFill=$('#rdFill'),rdPct=$('#rdPct'),rdStage=$('#rdStage'),cap=$('#showCap');
var vcol=$('#vcol'),stageEl=$('#showStage'),toggle=$('.toggle',sec);
var CAPS={residential:'32 single-storey units on a sloping lot. Drag to orbit, scroll or pinch to zoom, and use the slider to move between the issued plan and the model.',industrial:'A warehouse development at siteworks stage. Drag to orbit, scroll or pinch to zoom, and use the slider to move between the issued plan and the model.'};
var webgl=false;
try{var cv=d.createElement('canvas');webgl=!!(window.WebGLRenderingContext&&(cv.getContext('webgl')||cv.getContext('experimental-webgl')))}catch(e){}
var ready={residential:false,industrial:false},views={residential:null,industrial:null};
var prog=0,activeView='',touched=false,auto=0,visible=false,started=false;
function slot(m){return slots.filter(function(s){return s.getAttribute('data-m')===m})[0]}
function frameOf(m){var s=slot(m);return s&&$('iframe',s)}
function srcOf(m){var f=frameOf(m),u=f&&f.getAttribute('data-src');return u&&u!=='about:blank'?u:''}
function avail(m){return !!srcOf(m)}
var cur=avail('industrial')&&!avail('residential')?'industrial':(avail('residential')?'residential':'industrial');
function mapT(p){return reduce?1:clamp((p-0.06)/0.88,0,1)}
function sm(x){x=clamp(x,0,1);return x*x*(3-2*x)}
function post(m,msg){var f=frameOf(m);if(!f||!f.contentWindow||!ready[m])return;try{f.contentWindow.postMessage(msg,'*')}catch(e){}}
function send(m,t){post(m,{type:'morph',t:t,keep:touched})}
/* the issued plan sheet crossfades into the live model, so no frame is ever blank */
function paint(m){
  var s=slot(m),paper=$('.paper',s),f=$('iframe',s),t=mapT(prog);
  var sheet=ready[m]&&webgl?1-sm((t-0.05)/0.3):1;
  paper.style.opacity=sheet;paper.style.transform='scale('+(1+0.07*(1-sheet))+')';
  f.style.opacity=ready[m]&&webgl?sm((t-0.12)/0.3):0;
}
function readout(p){
  var pct=Math.round(p*100);
  rdPct.textContent=('00'+pct).slice(-3);rdFill.style.width=pct+'%';
  rdStage.textContent=p<0.06?'PLAN':p>0.94?'MODEL':'RISING';
  if(range&&+range.value!==pct)range.value=pct;
}
function ui(){
  wrap.classList.toggle('drag',!!(webgl&&ready[cur]));
  vcol.hidden=!(webgl&&ready[cur]&&views[cur]&&views[cur].length&&mapT(prog)>=0.5);
}
function buildViews(){
  vcol.textContent='';
  var list=(views[cur]||[]).map(function(v){return {id:v.id,label:(v.id==='inside'&&/dwelling/i.test(v.label))?'Inside dwellings':v.label}});
  function rank(v){return /^services?$/.test(v.id)?0:v.id==='inside'?1:2}
  list=list.map(function(v,i){return {v:v,i:i}}).sort(function(a,b){return rank(a.v)-rank(b.v)||a.i-b.i}).map(function(o){return o.v});
  list.forEach(function(v){
    var b=el('button','vbtn',v.label);b.type='button';b.setAttribute('data-id',v.id);b.setAttribute('aria-pressed',v.id===activeView?'true':'false');
    b.addEventListener('click',function(){activeView=v.id;touched=true;$$('.vbtn',vcol).forEach(function(o){o.setAttribute('aria-pressed',o===b?'true':'false')});post(cur,{type:'view',id:v.id})});
    vcol.appendChild(b);
  });
}
var pend=false;
function setProg(p){
  prog=clamp(p,0,1);readout(prog);paint(cur);ui();
  if(pend)return;pend=true;
  requestAnimationFrame(function(){pend=false;send(cur,mapT(prog))});
}
function stopAuto(){auto++}
/* one-shot rise from plan to model the first time the ready model is on screen; any input cancels it */
function autoplay(){
  if(started||!visible||!ready[cur]||touched)return;started=true;
  if(reduce){setProg(1);return}
  var id=++auto,t0=performance.now(),from=prog,dur=1900;
  (function f(n){if(id!==auto)return;var k=clamp((n-t0)/dur,0,1);setProg(from+(1-from)*(1-Math.pow(1-k,3)));if(k<1)requestAnimationFrame(f)})(t0);
}
function loadFrame(m){
  var f=frameOf(m);if(!f||!webgl||!avail(m))return;
  if(f.getAttribute('src')&&f.getAttribute('src')!=='about:blank')return;
  f.setAttribute('src',srcOf(m));
}
/* release a hidden model: lose its WebGL context, then drop the page */
function unloadFrame(m){
  var f=frameOf(m);if(!f)return;
  if(ready[m])post(m,{type:'dispose'});
  ready[m]=false;slot(m).classList.remove('ready');
  var s=slot(m);
  setTimeout(function(){if(m!==cur&&f.getAttribute('src'))f.setAttribute('src','about:blank');paint(m)},60);
  if(s)paint(m);
}
function markReady(m){
  if(ready[m])return;ready[m]=true;slot(m).classList.add('ready');
  if(m===cur){buildViews();send(m,mapT(prog));paint(m);ui();post(m,{type:'visible',on:visible});autoplay()}
}
window.addEventListener('message',function(e){
  var dta=e.data;if(!dta||typeof dta!=='object')return;
  ['residential','industrial'].forEach(function(m){
    var f=frameOf(m);if(!f||e.source!==f.contentWindow)return;
    if(dta.type==='ready'&&dta.views)views[m]=dta.views;
    if(dta.type==='interact'){touched=true;stopAuto();if(m===cur)send(m,mapT(prog))}
    if(dta.type==='wheel'&&m===cur)window.scrollBy({top:dta.dy,left:0,behavior:'instant'});
    if(dta.type==='morph-ready'||dta.ptmModelReady||dta.type==='ready')markReady(m);
  });
});
function pick(m){
  if(m===cur||!avail(m))return;
  var prev=cur;cur=m;
  toggles.forEach(function(b){var on=b.getAttribute('data-m')===m;b.classList.toggle('on',on);b.setAttribute('aria-pressed',on)});
  slots.forEach(function(s){s.classList.toggle('on',s.getAttribute('data-m')===m)});
  cap.textContent=CAPS[m];activeView='';touched=false;
  unloadFrame(prev);
  loadFrame(m);
  if(ready[m]){buildViews();send(m,mapT(prog))}else vcol.textContent='';
  paint(m);ui();
}
/* a model with no file yet (e.g. residential) is hidden cleanly, never shown as an empty frame */
toggles.forEach(function(b){
  var m=b.getAttribute('data-m');
  var s=slot(m);b.hidden=!avail(m);if(s){s.hidden=!avail(m);if(!avail(m))s.classList.remove('on')}
  b.addEventListener('click',function(){pick(b.getAttribute('data-m'))});
});
if(toggle)toggle.hidden=toggles.filter(function(b){return !b.hidden}).length<2;
slots.forEach(function(s){var m=s.getAttribute('data-m');s.classList.toggle('on',m===cur&&!s.hidden)});
toggles.forEach(function(b){var on=b.getAttribute('data-m')===cur;b.classList.toggle('on',on);b.setAttribute('aria-pressed',on)});
cap.textContent=CAPS[cur];
if(!webgl){var n=$('#stageNote');if(n)n.hidden=false}
if(range)range.addEventListener('input',function(){touched=true;stopAuto();setProg(range.value/100)});
/* load the 3D only when the section nears the viewport; pause its rendering when off screen */
if('IntersectionObserver' in window){
  var lio=new IntersectionObserver(function(en){if(en[0].isIntersecting){loadFrame(cur);lio.disconnect()}},{rootMargin:'700px 0px'});
  lio.observe(sec);
  var vio=new IntersectionObserver(function(en){visible=en[0].intersectionRatio>=0.35;post(cur,{type:'visible',on:en[0].isIntersecting});if(visible)autoplay()},{threshold:[0,0.35,0.6]});
  vio.observe(stageEl);
}else{loadFrame(cur);visible=true}
readout(0);paint('residential');paint('industrial');
if(reduce){root.classList.add('rm');setProg(1)}
})();
