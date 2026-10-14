(function(){
'use strict';
var d=document,root=d.documentElement;
var reduce=window.matchMedia('(prefers-reduced-motion: reduce)').matches;
function $(s,c){return (c||d).querySelector(s)}
function $$(s,c){return Array.prototype.slice.call((c||d).querySelectorAll(s))}
function clamp(v,a,b){return v<a?a:v>b?b:v}
function store(k,v){try{if(v===undefined)return localStorage.getItem(k);localStorage.setItem(k,v)}catch(e){return null}}

/* submission key */
var key=$('input[name=submission_key]');
if(key){try{key.value=(window.crypto&&crypto.randomUUID)?crypto.randomUUID():String(Date.now())+Math.random().toString(16).slice(2)}catch(e){key.value=String(Date.now())}}

/* mobile menu */
var tg=$('.nav-toggle'),menu=$('#menu');
if(tg&&menu){
  tg.addEventListener('click',function(){var o=menu.classList.toggle('open');tg.setAttribute('aria-expanded',o)});
  $$('a',menu).forEach(function(a){a.addEventListener('click',function(){menu.classList.remove('open');tg.setAttribute('aria-expanded','false')})});
}

var hubTabs=$$('[data-hub]'),hubPanels=$$('.hub-panel'),modelsReq=null,hubNear=false;
/* ---------- audience picker ---------- */
var G='guides/';
var GUIDE={
  'stormwater-management-plans-and-osd':[G+'stormwater-management-plans-and-osd-nsw.html','Stormwater plans and OSD'],
  'erosion-and-sediment-control-plans':[G+'erosion-and-sediment-control-plans-nsw.html','Erosion and sediment control plans'],
  'flood-maps-and-1-percent-aep':[G+'flood-maps-and-1-percent-aep-regional-nsw.html','Flood maps and the 1% AEP'],
  'pump-station-and-pressure-sewer-design':[G+'pump-station-and-pressure-sewer-design-nsw.html','Pump station and pressure sewer design'],
  'swept-path-analysis':[G+'swept-path-analysis-nsw.html','Swept path analysis'],
  'site-classification-footings-and-piers':[G+'site-classification-footings-and-piers.html','Site classification, footings and piers']
};
var MODELNAME={subdivision:'Subdivisions',commercial:'Commercial and industrial',house:'Residential'};
var HUBTAB={subdivision:'subdivision',commercial:'commercial',house:'residential'};
var ROLES={
  developer:{label:'Developer',bullets:['Subdivision and multi-dwelling civil packages','Feasibility, OSD and stormwater','Flood and services (water and sewer) coordinated','Planning and multidisciplinary project delivery'],guides:['stormwater-management-plans-and-osd','erosion-and-sediment-control-plans'],model:'subdivision',project:'Subdivision',need:'Subdivision design'},
  council:{label:'Council',bullets:['RFI responses and flood assessments to the NSW Flood Risk Management Manual','Water and sewer designed to your specification','Independent peer review','Planning and multidisciplinary project delivery'],guides:['flood-maps-and-1-percent-aep','pump-station-and-pressure-sewer-design'],model:'subdivision',project:'Council or infrastructure work',need:'Council request for information'},
  architect:{label:'Architect',bullets:['Early stormwater and levels advice','Driveways, swept paths and accessible paths','Civil sub-consultant for DA and CC'],guides:['swept-path-analysis','site-classification-footings-and-piers'],model:'commercial',project:'Duplex or multi-dwelling',need:'Stormwater plan'},
  individual:{label:'Individual',bullets:['Stormwater plan for a DA, granny flat or extension','Slab and footings','Driveway design'],guides:['stormwater-management-plans-and-osd','site-classification-footings-and-piers'],model:'house',project:'New house or granny flat',need:'Stormwater plan'}
};
var state={role:'',need:'',project:''};
var roleField=$('#roleField');
function el(tag,cls,txt){var e=d.createElement(tag);if(cls)e.className=cls;if(txt)e.textContent=txt;return e}
function setRole(name,opts){
  var r=ROLES[name];if(!r)return;
  opts=opts||{};
  state.role=name;state.need=r.need;state.project=r.project;
  if(roleField)roleField.value=r.label;
  $$('input[name=role-sel]').forEach(function(i){i.checked=i.value===name});
  var ul=$('#rbullets');ul.textContent='';
  r.bullets.forEach(function(b){ul.appendChild(el('li','',b))});
  var gd=$('#rguides');gd.textContent='';
  r.guides.forEach(function(slug){var g=GUIDE[slug];var a=el('a','chip',g[1]);a.href=g[0];gd.appendChild(a)});
  $('#rmodel').textContent=MODELNAME[r.model]+' model, ready to explore.';
  var go=$('#rmodel-go');go.textContent='Open the '+MODELNAME[r.model].toLowerCase()+' model';
  go.setAttribute('data-model',r.model);
  if(!opts.silent)store('jce-role',name);
  hubSwitch(HUBTAB[r.model],false);
}
$$('input[name=role-sel]').forEach(function(i){i.addEventListener('change',function(){setRole(i.value)})});
var saved=store('jce-role');if(saved&&ROLES[saved])setRole(saved,{silent:true});
var rgo=$('#rmodel-go');
if(rgo)rgo.addEventListener('click',function(){var m=rgo.getAttribute('data-model');if(m)hubSwitch(HUBTAB[m],false)});

/* ---------- quote bar and quote links: preselect what is known, then scroll ---------- */
function setSel(name,val){var s=$('#quoteForm [name='+name+']');if(!s||!val)return;for(var i=0;i<s.options.length;i++){if(s.options[i].text===val){s.selectedIndex=i;return}}}
function prefill(need){
  setSel('project',state.project);
  setSel('need',need||state.need);
}
$$('[data-quote]').forEach(function(a){a.addEventListener('click',function(){prefill(a.getAttribute('data-need'))})});
$$('.svc[data-need]').forEach(function(a){if(a.getAttribute('href')==='#contact')a.addEventListener('click',function(){prefill(a.getAttribute('data-need'))})});

/* in-page links jump straight to the target: smooth scrolling is cut short by the pinned section */
$$('a[href^="#"]').forEach(function(a){
  a.addEventListener('click',function(e){
    var id=a.getAttribute('href');if(id.length<2)return;
    var t=d.getElementById(id.slice(1));if(!t)return;
    e.preventDefault();
    var y=t.getBoundingClientRect().top+window.pageYOffset-(id==='#top'?0:76);
    root.style.scrollBehavior='auto';window.scrollTo(0,Math.max(0,y));root.style.scrollBehavior='';
    try{history.replaceState(null,'',id)}catch(x){}
  });
});

/* ---------- FAQ: one open at a time ---------- */
$$('.faq details').forEach(function(dt){dt.addEventListener('toggle',function(){if(dt.open)$$('.faq details').forEach(function(o){if(o!==dt)o.open=false})})});

/* ---------- model hub (jce-models.js loaded on first need) ---------- */
function loadScript(src){return new Promise(function(ok,bad){var s=d.createElement('script');s.src=src;s.onload=ok;s.onerror=bad;d.head.appendChild(s)})}
function loadModels(){
  if(modelsReq)return modelsReq;
  modelsReq=loadScript('vendor/three-r128.min.js').then(function(){return loadScript('jce-models.js')}).catch(function(){root.classList.add('no3d')});
  return modelsReq;
}
function hubSwitch(name,focus){
  hubTabs.forEach(function(b){var on=b.getAttribute('data-hub')===name;b.setAttribute('aria-selected',on);b.tabIndex=on?0:-1;if(on&&focus)b.focus()});
  hubPanels.forEach(function(p){var on=p.id==='hub-'+name;p.classList.toggle('on',on)});
  if(modelsReq||hubNear)loadModels();
}
hubTabs.forEach(function(b,i){
  b.addEventListener('click',function(){loadModels();hubSwitch(b.getAttribute('data-hub'),false)});
  b.addEventListener('keydown',function(e){
    var n=null;
    if(e.key==='ArrowRight')n=(i+1)%hubTabs.length;
    if(e.key==='ArrowLeft')n=(i-1+hubTabs.length)%hubTabs.length;
    if(n!==null){e.preventDefault();loadModels();hubSwitch(hubTabs[n].getAttribute('data-hub'),true)}
  });
});
var hub=$('#models');
if(hub&&'IntersectionObserver' in window){
  var hio=new IntersectionObserver(function(en){if(en[0].isIntersecting){hubNear=true;loadModels();hio.disconnect()}},{rootMargin:'700px 0px'});
  hio.observe(hub);
}else{hubNear=true;loadModels()}

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
  card.querySelector('.label').textContent=control?'Model controls on':'Take control of the model';
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
  (views[cur]||[]).forEach(function(v){
    var b=el('button','vbtn',v.label);b.type='button';b.setAttribute('data-id',v.id);b.setAttribute('aria-pressed',v.id===activeView?'true':'false');
    b.addEventListener('click',function(){activeView=v.id;$$('.vbtn',vcol).forEach(function(o){o.setAttribute('aria-pressed',o===b?'true':'false')});post(cur,{type:'view',id:v.id})});
    vcol.appendChild(b);
  });
}
function setControl(on){
  if(on===control)return;
  control=on;
  var f=frameOf(cur);
  if(on){send(cur,1);if(f)f.style.opacity=1;activeView=''}
  post(cur,{type:'control',on:on});orb={};
  if(on)buildViews();
  else{activeView='';orb={};paint(cur);send(cur,mapT(prog))}
  ui();
}
var pend=false;
function update(p){
  prog=clamp(p,0,1);readout(prog);
  if(control&&mapT(prog)<0.85)setControl(false);
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
    if(dta.type==='wheel'&&m===cur)window.scrollBy({top:dta.dy,left:0,behavior:'instant'});
    if(dta.type==='morph-ready'||dta.jceModelReady||dta.type==='ready')markReady(m);
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
if(!webgl){var n=$('#stageNote');if(n)n.hidden=false}
if(range)range.addEventListener('input',function(){update(range.value/100)});
if(sec&&'IntersectionObserver' in window){
  var sio=new IntersectionObserver(function(en){if(en[0].isIntersecting){loadFrame(cur);sio.disconnect()}},{rootMargin:'900px 0px'});
  sio.observe(sec);
}else loadFrame(cur);
readout(0);paint('seniors');paint('industrial');
if(reduce){root.classList.add('rm');update(1)}

/* ---------- process flowchart: draws in, nodes light, a token travels ---------- */
var flows=$$('.fc');
function flowAt(p){
  flows.forEach(function(svg){
    $$('.cn',svg).forEach(function(c){
      var L=c._L||(c._L=c.getTotalLength()),a=+c.getAttribute('data-a'),b=+c.getAttribute('data-b');
      var k=clamp((p-a)/(b-a),0,1);
      c.style.strokeDasharray=c.classList.contains('cn')&&(c.classList.contains('loop')||c.classList.contains('no'))?'':'';
      if(!c._dash){c._dash=getComputedStyle(c).strokeDasharray}
      if(c._dash&&c._dash!=='none'){ /* dashed connectors: reveal with a mask-like clip using opacity ramp */ c.style.opacity=k>0?1:0;c.style.strokeDasharray=c._dash;c.style.strokeDashoffset=0;if(k<1){c.style.strokeDasharray=(L*k)+' '+L;} }
      else{c.style.strokeDasharray=L;c.style.strokeDashoffset=L*(1-k)}
      c.style.markerEnd=k>=0.99?'':'none';
    });
    $$('.fn',svg).forEach(function(n){n.classList.toggle('lit',p>=+n.getAttribute('data-f')-0.001)});
    var t=$('.tok',svg),x0=+t.getAttribute('data-x0'),y0=+t.getAttribute('data-y0'),x1=+t.getAttribute('data-x1'),y1=+t.getAttribute('data-y1');
    t.setAttribute('cx',x0+(x1-x0)*p);t.setAttribute('cy',y0+(y1-y0)*p);
  });
}

/* ---------- GSAP: reveals, count-up, pinned scrub ---------- */
function start(){
  var gsap=window.gsap,ST=window.ScrollTrigger;
  if(!gsap||!ST){root.classList.add('nopin');return}
  gsap.registerPlugin(ST);
  if(reduce)return;
  root.classList.add('rv');
  $$('.sh,.card,.ptable,.faq,.form,.stat,.flow,.note,.picker,.hub-tabs').forEach(function(e){e.setAttribute('data-reveal','')});
  ST.batch('[data-reveal]',{start:'top 92%',once:true,batchMax:4,onEnter:function(b){gsap.to(b,{opacity:1,y:0,duration:.7,ease:'power3.out',stagger:.07,overwrite:true})}});
  $$('[data-count]').forEach(function(e){
    var end=+e.getAttribute('data-count'),pre=e.getAttribute('data-prefix')||'',suf=e.getAttribute('data-suffix')||'',o={v:0};
    ST.create({trigger:e,start:'top 92%',once:true,onEnter:function(){
      gsap.to(o,{v:end,duration:1.2,ease:'power2.out',onUpdate:function(){e.textContent=pre+Math.round(o.v)+suf},onComplete:function(){e.textContent=pre+end+suf}});
    }});
  });
  gsap.from('.who-img',{opacity:0,y:36,duration:1.1,ease:'power3.out',delay:.3,clearProps:'transform,opacity'});
  gsap.from('.who figcaption',{opacity:0,duration:.8,delay:.9});
  var fl=$('#flow');
  if(fl){
    root.classList.add('js-flow');flowAt(0);
    ST.create({trigger:fl,start:'top 78%',end:'bottom 55%',scrub:0.4,onUpdate:function(self){flowAt(self.progress)}});
  }
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
