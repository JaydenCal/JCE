/* Plan-to-model widget. Needs gsap + ScrollTrigger (optional: without them it still works, un-pinned).
   Markup: see index.html (#showcase). Viewers are iframes using postMessage (see README). */
(function(){
'use strict';
var d=document,root=d.documentElement;
var reduce=window.matchMedia('(prefers-reduced-motion: reduce)').matches;
function $(s,c){return (c||d).querySelector(s)}
function $$(s,c){return Array.prototype.slice.call((c||d).querySelectorAll(s))}
function clamp(v,a,b){return v<a?a:v>b?b:v}
function store(k,v){try{if(v===undefined)return localStorage.getItem(k);localStorage.setItem(k,v)}catch(e){return null}}
function el(tag,cls,txt){var e=d.createElement(tag);if(cls)e.className=cls;if(txt)e.textContent=txt;return e}
/* ---------- plan to model showcase ---------- */
var sec=$('#showcase'),slots=$$('.slot',sec),toggles=$$('.tg',sec),wrap=$('.stagewrap',sec);
var range=$('#showRange'),rdFill=$('#rdFill'),rdPct=$('#rdPct'),rdStage=$('#rdStage'),cap=$('#showCap');
var card=$('#ctlCard'),ctlBtn=$('#ctlBtn'),vcol=$('#vcol'),stageEl=$('#showStage');
var CAPS={seniors:'32 single-storey units on a sloping lot. The issued plan sheet rises into the graded surface, accessways, ramps and services as you scroll.',industrial:'A warehouse development at siteworks stage. The issued levels plan lifts into ground, drainage and buildings as you scroll.'};
var cur='seniors',prog=0,webgl=false,control=false,clicked=false,activeView='';
try{var cv=d.createElement('canvas');webgl=!!(window.WebGLRenderingContext&&(cv.getContext('webgl')||cv.getContext('experimental-webgl')))}catch(e){}
var ready={seniors:false,industrial:false},views={seniors:null,industrial:null};
function slot(m){return slots.filter(function(s){return s.getAttribute('data-m')===m})[0]}
function frameOf(m){var s=slot(m);return s&&$('iframe',s)}
function mapT(p){return reduce?1:clamp((p-0.06)/0.88,0,1)}
function post(m,msg){var f=frameOf(m);if(!f||!f.contentWindow||!ready[m])return;try{f.contentWindow.postMessage(msg,'*')}catch(e){}}
function send(m,t){post(m,{type:'morph',t:t})}
function sm(x){x=clamp(x,0,1);return x*x*(3-2*x)}
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
  card.hidden=!(webgl&&ready[cur]&&(control||clicked||mapT(prog)>=0.6));
  card.classList.toggle('on',control);
  syncOrbit();
  card.querySelector('.label').textContent=control?'Scroll locked \u00b7 Esc to release':'Take control of the model';
  ctlBtn.textContent=control?'Release':'Take control';
  vcol.hidden=!(control&&views[cur]);
  wrap.classList.toggle('ctl',control);
}
var fine=window.matchMedia('(hover:hover) and (pointer:fine)').matches,orb={};
function syncOrbit(){
  ['seniors','industrial'].forEach(function(m){
    var want=m===cur&&webgl&&ready[m]&&(control||(fine&&mapT(prog)>=0.6)),zoom=m===cur&&control,o=orb[m]||{};
    if(o.on!==want||o.zoom!==zoom){orb[m]={on:want,zoom:zoom};post(m,{type:'orbit',on:want,zoom:zoom})}
  });
  var any=ready[cur]&&webgl&&(control||(fine&&mapT(prog)>=0.6));
  wrap.classList.toggle('drag',!!any);
}
function buildViews(){
  vcol.textContent='';
  var list=(views[cur]||[]).map(function(v){return {id:v.id,label:(v.id==='inside'&&/dwelling/i.test(v.label))?'Inside dwellings':v.label}});
  function rank(v){return /^services?$/.test(v.id)?0:v.id==='inside'?1:2}
  list=list.map(function(v,i){return {v:v,i:i}}).sort(function(a,b){return rank(a.v)-rank(b.v)||a.i-b.i}).map(function(o){return o.v});
  list.forEach(function(v){
    var b=el('button','vbtn',v.label);b.type='button';b.setAttribute('data-id',v.id);b.setAttribute('aria-pressed',v.id===activeView?'true':'false');
    b.addEventListener('click',function(){activeView=v.id;$$('.vbtn',vcol).forEach(function(o){o.setAttribute('aria-pressed',o===b?'true':'false')});post(cur,{type:'view',id:v.id})});
    vcol.appendChild(b);
  });
}
var locked=false,inside=false;
function applyLock(){lockPage(control&&inside)}
wrap.addEventListener('pointerenter',function(e){if(e.pointerType==='touch')return;inside=true;applyLock()});
wrap.addEventListener('pointerleave',function(e){if(e.pointerType==='touch')return;inside=false;applyLock()});
function stopTouch(e){if(!e.target.closest||!e.target.closest('.vcol'))e.preventDefault()}
function lockPage(on){
  if(on===locked)return;locked=on;
  var h=root,sb=window.innerWidth-h.clientWidth;
  if(on){h.style.setProperty('--sbw',sb+'px');h.style.overflow='hidden';d.body.style.paddingRight=sb+'px';d.addEventListener('touchmove',stopTouch,{passive:false})}
  else{h.style.overflow='';h.style.removeProperty('--sbw');d.body.style.paddingRight='';d.removeEventListener('touchmove',stopTouch)}
}
function setControl(on){
  if(on===control)return;
  control=on;
  var f=frameOf(cur);
  if(on){post(cur,{type:'morph',t:1,keep:true});if(f)f.style.opacity=1;activeView='';inside=true}else inside=false;
  post(cur,{type:'control',on:on});orb={};applyLock();
  if(on)buildViews();
  else{activeView='';orb={};paint(cur);send(cur,mapT(prog))}
  ui();
}
var pend=false;
function update(p){
  prog=clamp(p,0,1);readout(prog);
  if(control&&mapT(prog)<0.55)setControl(false);
  if(!control)paint(cur);
  ui();
  if(control||pend)return;pend=true;
  requestAnimationFrame(function(){pend=false;if(!control)send(cur,mapT(prog))});
}
function loadFrame(m){
  var f=frameOf(m);if(!f||f.getAttribute('src')||!webgl)return;
  f.setAttribute('src',f.getAttribute('data-src'));
}
function markReady(m){ready[m]=true;slot(m).classList.add('ready');send(m,mapT(prog));paint(m);ui()}
window.addEventListener('message',function(e){
  var dta=e.data;if(!dta)return;
  ['seniors','industrial'].forEach(function(m){
    var f=frameOf(m);if(!f||e.source!==f.contentWindow)return;
    if(dta.type==='ready'&&dta.views)views[m]=dta.views;
    if(dta.type==='release'&&m===cur)setControl(false);
    if(dta.type==='engage'&&m===cur&&!control&&fine&&mapT(prog)>=0.6)setControl(true);
    if(dta.type==='wheel'&&m===cur){if(!control&&fine&&mapT(prog)>=0.6)setControl(true);else if(!control)window.scrollBy({top:dta.dy,left:0,behavior:'instant'})}
    if(dta.type==='morph-ready'||dta.ptmModelReady||dta.type==='ready')markReady(m);
  });
});
function pick(m){
  setControl(false);
  cur=m;clicked=false;
  toggles.forEach(function(b){var on=b.getAttribute('data-m')===m;b.classList.toggle('on',on);b.setAttribute('aria-pressed',on)});
  slots.forEach(function(s){s.classList.toggle('on',s.getAttribute('data-m')===m)});
  cap.textContent=CAPS[m];
  loadFrame(m);send(m,mapT(prog));paint(m);ui();
}
toggles.forEach(function(b){b.addEventListener('click',function(){pick(b.getAttribute('data-m'))})});
ctlBtn.addEventListener('click',function(){setControl(!control)});
stageEl.addEventListener('click',function(){clicked=true;ui()});
d.addEventListener('keydown',function(e){if(e.key==='Escape'&&control)setControl(false)});
d.addEventListener('pointerdown',function(e){if(control&&!wrap.contains(e.target))setControl(false)});
window.addEventListener('resize',function(){if(control)setControl(false)});
if(!webgl){var n=$('#stageNote');if(n)n.hidden=false}
if(range)range.addEventListener('input',function(){update(range.value/100)});
if(sec&&'IntersectionObserver' in window){
  var sio=new IntersectionObserver(function(en){if(en[0].isIntersecting){loadFrame(cur);sio.disconnect()}},{rootMargin:'900px 0px'});
  sio.observe(sec);
}else loadFrame(cur);
readout(0);paint('seniors');paint('industrial');
if(reduce){root.classList.add('rm');update(1)}

function start(){
  var gsap=window.gsap,ST=window.ScrollTrigger;
  if(!gsap||!ST){root.classList.add('nopin');return}
  gsap.registerPlugin(ST);
  if(reduce)return;
  var pin=$('#showPin');
  if(pin){
    var mobile=window.matchMedia('(max-width:639px)').matches;
    ST.create({trigger:pin,start:'top top',end:'+='+(mobile?'160%':'220%'),pin:true,anticipatePin:1,refreshPriority:1,onUpdate:function(self){update(self.progress)},onRefresh:function(self){update(self.progress)}});
  }
  window.addEventListener('load',function(){ST.refresh()});
}
if(window.gsap&&window.ScrollTrigger)start();
else window.addEventListener('load',start);
})();
