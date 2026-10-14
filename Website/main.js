(function(){
'use strict';
var d=document,root=d.documentElement;
var reduce=window.matchMedia('(prefers-reduced-motion: reduce)').matches;
function $(s,c){return (c||d).querySelector(s)}
function $$(s,c){return Array.prototype.slice.call((c||d).querySelectorAll(s))}

/* submission key */
var key=$('input[name=submission_key]');
if(key){try{key.value=(window.crypto&&crypto.randomUUID)?crypto.randomUUID():String(Date.now())+Math.random().toString(16).slice(2)}catch(e){key.value=String(Date.now())}}

/* mobile menu */
var tg=$('.nav-toggle'),menu=$('#menu');
if(tg&&menu){
  tg.addEventListener('click',function(){var o=menu.classList.toggle('open');tg.setAttribute('aria-expanded',o)});
  $$('a',menu).forEach(function(a){a.addEventListener('click',function(){menu.classList.remove('open');tg.setAttribute('aria-expanded','false')})});
}

/* tabs */
var tabs=$('#tabs');
if(tabs){
  var btns=$$('[role=tab]',tabs),panels=$$('[role=tabpanel]',tabs);
  function sel(i,focus){btns.forEach(function(b,j){var on=i===j;b.setAttribute('aria-selected',on);b.tabIndex=on?0:-1;panels[j].hidden=!on;if(on&&focus)b.focus()})}
  btns.forEach(function(b,i){
    b.addEventListener('click',function(){sel(i)});
    b.addEventListener('keydown',function(e){
      var n=null;
      if(e.key==='ArrowRight')n=(i+1)%btns.length;
      if(e.key==='ArrowLeft')n=(i-1+btns.length)%btns.length;
      if(n!==null){e.preventDefault();sel(n,true)}
    });
  });
  tabs.classList.add('ready');sel(0);
}

/* model loader */
var mb=$('#model-box'),ml=$('#model-load');
if(mb&&ml){
  ml.addEventListener('click',function(){
    var f=d.createElement('iframe');
    f.src='model/index.html';f.title='Interactive 3D site model';f.allowFullscreen=true;
    mb.appendChild(f);mb.classList.add('live');
  });
}

/* GSAP */
if(!window.gsap||!window.ScrollTrigger){root.classList.remove('js');return}
var gsap=window.gsap;gsap.registerPlugin(window.ScrollTrigger);

if(reduce){root.classList.remove('js');if(tabs){$$('[role=tabpanel]',tabs).forEach(function(p,i){p.hidden=i!==0})}return}

/* hero headline reveal */
var h1=$('#h1');
if(h1){
  (function wrap(node){
    $$('*',node).length;
    Array.prototype.slice.call(node.childNodes).forEach(function(n){
      if(n.nodeType===3){
        var frag=d.createDocumentFragment();
        n.textContent.split(/(\s+)/).forEach(function(w){
          if(!w)return;
          if(/^\s+$/.test(w)){frag.appendChild(d.createTextNode(' '));return}
          var s=d.createElement('span');s.className='hw';s.textContent=w;frag.appendChild(s);
        });
        node.replaceChild(frag,n);
      }else if(n.nodeType===1){
        var em=n;
        var parts=em.textContent.split(/(\s+)/);em.textContent='';
        parts.forEach(function(w){
          if(!w)return;
          if(/^\s+$/.test(w)){em.appendChild(d.createTextNode(' '));return}
          var s=d.createElement('span');s.className='hw';s.textContent=w;em.appendChild(s);
        });
      }
    });
  })(h1);
  gsap.to('.hw',{opacity:1,y:0,duration:.8,ease:'power3.out',stagger:.07,delay:.1});
}
gsap.fromTo('.hero-copy > *:not(h1), .hero-cards > *',{opacity:0,y:24},{opacity:1,y:0,duration:.8,ease:'power3.out',stagger:.1,delay:.35,clearProps:'transform'});

/* generic reveals */
$$('.sec-head, .card, .cmp, .ptable, .faq, .form, .panel, .stat, .model-box').forEach(function(el){el.setAttribute('data-reveal','')});
window.ScrollTrigger.batch('[data-reveal]',{
  start:'top 90%',once:true,
  onEnter:function(b){gsap.to(b,{opacity:1,y:0,duration:.7,ease:'power3.out',stagger:.08,overwrite:true})}
});

/* timeline draw */
var tl=$$('.timeline li');
if(tl.length){
  tl.forEach(function(li){li.style.setProperty('--p',0)});
  var o={p:0};
  window.ScrollTrigger.create({trigger:'.timeline',start:'top 92%',once:true,onEnter:function(){
    tl.forEach(function(li,i){
      gsap.to(li,{'--p':1,duration:.6,delay:i*.18,ease:'power2.out'});
      gsap.from(li.querySelector('.node'),{scale:0,duration:.4,delay:i*.18,ease:'back.out(2)'});
    });
  }});
}

/* count-up */
$$('[data-count]').forEach(function(el){
  var end=+el.getAttribute('data-count'),pre=el.getAttribute('data-prefix')||'',suf=el.getAttribute('data-suffix')||'',o={v:0};
  window.ScrollTrigger.create({trigger:el,start:'top 92%',once:true,onEnter:function(){
    gsap.to(o,{v:end,duration:1.4,ease:'power2.out',onUpdate:function(){el.textContent=pre+Math.round(o.v)+suf},onComplete:function(){el.textContent=pre+end+suf}});
  }});
});

/* pinned walkthrough */
var mm=window.matchMedia('(min-width: 600px)');
var walk=$('#walkthrough');
if(walk){
  var frames=$$('.frame',walk),steps=$$('.walk-steps li',walk),cur=$('.cur',walk);
  walk.classList.add('pinned');
  var idx=0;
  function show(i){
    if(i===idx)return;
    gsap.to(frames[idx],{opacity:0,duration:.45,overwrite:true});
    gsap.to(frames[i],{opacity:1,duration:.45,overwrite:true});
    steps.forEach(function(s,j){s.classList.toggle('on',j===i)});
    cur.textContent='0'+(i+1);
    idx=i;
  }
  gsap.set(frames,{opacity:function(i){return i===0?1:0}});
  window.ScrollTrigger.create({
    trigger:walk,start:'top top',end:'+=300%',pin:true,anticipatePin:1,
    onUpdate:function(self){show(Math.min(3,Math.floor(self.progress*4)))}
  });
}
window.addEventListener('load',function(){window.ScrollTrigger.refresh()});
})();
