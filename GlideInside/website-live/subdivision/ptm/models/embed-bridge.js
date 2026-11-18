/* Embed bridge: tells the parent page which named views this viewer has, lets it trigger them, and makes the viewer
   directly interactive: mouse drag orbits, wheel zooms after a click (or with ctrl/cmd), right-drag pans, and the page
   keeps scrolling otherwise. Touch: one finger scrolls the page, two fingers orbit and zoom, a tap activates one-finger orbit. */
(function(){
  if(!/[?&]embed=1/.test(location.search))return;
  var doc=document,root=doc.documentElement;
  function post(m){try{parent.postMessage(m,'*')}catch(e){}}
  function views(){return Array.prototype.map.call(doc.querySelectorAll('#views button[data-v]'),function(b){return {id:b.dataset.v,label:(b.textContent||b.dataset.v).trim()}})}
  var rm=window.matchMedia&&matchMedia('(prefers-reduced-motion: reduce)').matches;
  function V(){return window.__viewer}
  function CAM(){var v=V();return v&&(v.camera?v.camera():v.getCamera())}
  function CTL(){var v=V();return v&&(v.controls?v.controls():v.getControls())}
  function wake(ms){if(window.__wake)window.__wake(ms)}
  var animId=0;
  function tween(ms,fn){var id=++animId;if(rm||!ms){fn(1);wake(200);return}var t0=performance.now();wake(ms+300);(function f(n){if(id!==animId)return;var k=Math.min(1,(n-t0)/ms);fn(1-Math.pow(1-k,3));if(k<1)requestAnimationFrame(f)})(t0)}
  function clampCtl(t){if(!t||!t.target)return;t.maxPolarAngle=Math.PI/2-0.02;t.minDistance=Math.max(t.minDistance||0,3)}
  /* switch to a named view, flying the camera there instead of snapping */
  function fly(id){
    var b=doc.querySelector('#views button[data-v="'+String(id).replace(/"/g,'')+'"]');if(!b)return;
    var c0=CAM(),t0=CTL(),op=c0&&c0.position.clone(),ot=t0&&t0.target.clone(),persp=c0&&c0.isPerspectiveCamera;
    b.click();
    var c1=CAM(),t1=CTL();clampCtl(t1);
    if(!persp||!c1||!c1.isPerspectiveCamera||!t1)return;
    var dp=c1.position.clone(),dt=t1.target.clone();
    c1.position.copy(op);t1.target.copy(ot);
    tween(900,function(e){c1.position.lerpVectors(op,dp,e);t1.target.lerpVectors(ot,dt,e);c1.lookAt(t1.target);if(t1.update)t1.update()});
  }
  /* ---- interaction state and hint ---- */
  var coarse=window.matchMedia&&matchMedia('(pointer:coarse)').matches;
  var active=false,hint=null;
  var st=doc.createElement('style');
  st.textContent='canvas{touch-action:none;cursor:grab}canvas:active{cursor:grabbing}.__hint{position:absolute;left:50%;bottom:14px;transform:translateX(-50%);z-index:9;pointer-events:none;font:500 12px/1 ui-monospace,Menlo,Consolas,monospace;letter-spacing:.08em;text-transform:uppercase;color:#efe9dc;background:rgba(10,10,9,.78);border:1px solid rgba(230,181,142,.5);padding:8px 12px;white-space:nowrap;opacity:0;transition:opacity .25s}.__hint.on{opacity:1}';
  doc.head.appendChild(st);
  function mkHint(){
    hint=doc.createElement('div');hint.className='__hint';hint.setAttribute('aria-hidden','true');
    hint.textContent=coarse?'Tap to interact, two fingers to orbit':'Click to interact';
    (doc.getElementById('stage')||doc.body).appendChild(hint);
    setTimeout(function(){showHint()},300);
  }
  function showHint(){if(hint)hint.classList.toggle('on',!active)}
  function setActive(on){if(on===active)return;active=on;showHint();if(on){post({type:'interact'});wake(1500)}}
  function scrollParent(dy,dx){try{parent.scrollBy(dx||0,dy)}catch(e){post({type:'wheel',dx:dx||0,dy:dy})}}
  /* wheel: the page keeps it until the visitor clicks into the model (or holds ctrl/cmd, which also covers trackpad pinch) */
  window.addEventListener('wheel',function(e){
    if(active||e.ctrlKey||e.metaKey){wake(1500);return}
    e.stopImmediatePropagation();e.preventDefault();scrollParent(e.deltaY,e.deltaX);
  },{capture:true,passive:false});
  /* pointer: mouse and pen activate on press; touch uses the held-finger logic below */
  var tp={},tn=0;
  function count(){return Object.keys(tp).length}
  window.addEventListener('pointerdown',function(e){
    wake(1500);
    if(e.pointerType!=='touch'){setActive(true);return}
    if(e.__replay)return;
    tp[e.pointerId]={sy:e.screenY,sx:e.screenX,t:performance.now(),moved:false,held:false,ev:e,tgt:e.target};
    if(active)return;
    var n=count();
    if(n===1){tp[e.pointerId].held=true;e.stopImmediatePropagation();return}
    /* second finger: hand the first one to the orbit controls too, so pinch and two-finger orbit work */
    Object.keys(tp).forEach(function(k){
      var o=tp[k];if(!o.held)return;o.held=false;o.moved=true;
      var r=new PointerEvent('pointerdown',{pointerId:+k,pointerType:'touch',isPrimary:true,clientX:o.ev.clientX,clientY:o.ev.clientY,screenX:o.ev.screenX,screenY:o.ev.screenY,button:0,buttons:1,bubbles:true,cancelable:true});
      r.__replay=true;(o.tgt||doc.querySelector('canvas')).dispatchEvent(r);
    });
  },true);
  window.addEventListener('pointermove',function(e){
    if(e.pointerType==='touch'){
      var o=tp[e.pointerId];
      if(o&&o.held){
        e.stopImmediatePropagation();
        var dy=o.sy-e.screenY,dx=o.sx-e.screenX;
        if(!o.moved&&Math.abs(dy)+Math.abs(dx)>8)o.moved=true;
        if(o.moved){scrollParent(dy,dx)}
        o.sy=e.screenY;o.sx=e.screenX;return;
      }
    }
    if(e.buttons||e.pointerType==='touch')wake(1500);
  },true);
  function up(e){
    if(e.pointerType!=='touch')return;
    var o=tp[e.pointerId];delete tp[e.pointerId];
    if(o&&o.held){e.stopImmediatePropagation();if(!o.moved&&performance.now()-o.t<500)setActive(true)}
    wake(1500);
  }
  window.addEventListener('pointerup',up,true);
  window.addEventListener('pointercancel',up,true);
  doc.addEventListener('mouseleave',function(){setActive(false)});
  window.addEventListener('blur',function(){setActive(false)});
  window.addEventListener('resize',function(){wake(800)});
  window.addEventListener('keydown',function(e){if(e.key==='Escape'){setActive(false);post({type:'release'})}wake(800)});
  window.addEventListener('load',function(){
    mkHint();
    var t=CTL();
    if(t&&t.addEventListener){
      /* no idle auto-spin: it would keep the viewer rendering forever */
      try{Object.defineProperty(t,'autoRotate',{configurable:true,get:function(){return false},set:function(){}})}catch(e){}
      t.addEventListener('change',function(){wake(600)});clampCtl(t)}
    wake(1500);
    post({type:'ready',views:views()});
  });
  window.addEventListener('message',function(e){
    if(e.source!==parent)return;var d=e.data||{};
    wake(700);
    /* the model disables its controls while a morph is held; keep them live so the visitor can orbit at any point */
    if(d.type==='morph'){var ct=CTL();if(ct){ct.enabled=true;ct.enableZoom=true}}
    if(d.type==='view')fly(d.id);
    if(d.type==='visible'&&window.__pause)window.__pause(!d.on);
    if(d.type==='dispose'){if(window.__pause)window.__pause(true);if(window.__disposeGL)window.__disposeGL()}
  });
})();
