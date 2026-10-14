/* Embed bridge: tells the parent page which named views this viewer has, and lets it trigger them. */
(function(){
  if(!/[?&]embed=1/.test(location.search))return;
  function post(m){try{parent.postMessage(m,'*')}catch(e){}}
  function views(){return Array.prototype.map.call(document.querySelectorAll('#views button[data-v]'),function(b){return {id:b.dataset.v,label:(b.textContent||b.dataset.v).trim()}})}
  var zoomOn=false,rm=window.matchMedia&&matchMedia('(prefers-reduced-motion: reduce)').matches;
  function V(){return window.__viewer}
  function CAM(){var v=V();return v&&(v.camera?v.camera():v.getCamera())}
  function CTL(){var v=V();return v&&(v.controls?v.controls():v.getControls())}
  function tween(ms,fn){if(rm||!ms){fn(1);return}var t0=performance.now();(function f(n){var k=Math.min(1,(n-t0)/ms);fn(1-Math.pow(1-k,3));if(k<1)requestAnimationFrame(f)})(t0)}
  /* dolly toward the target on taking control */
  function dolly(k,ms){
    var c=CAM(),t=CTL();if(!c||!t||!c.isPerspectiveCamera)return;
    var tg=t.target.clone(),p0=c.position.clone(),d0=p0.distanceTo(tg),d1=Math.max(t.minDistance||0.5,d0*k),dir=p0.clone().sub(tg).normalize();
    tween(ms,function(e){c.position.copy(tg).addScaledVector(dir,d0+(d1-d0)*e);c.lookAt(tg);if(t.update)t.update()});
  }
  /* switch to a named view, flying the camera there instead of snapping */
  function fly(id){
    var b=document.querySelector('#views button[data-v="'+String(id).replace(/"/g,'')+'"]');if(!b)return;
    var c0=CAM(),t0=CTL(),op=c0&&c0.position.clone(),ot=t0&&t0.target.clone(),persp=c0&&c0.isPerspectiveCamera;
    b.click();
    var c1=CAM(),t1=CTL();
    if(!persp||!c1||!c1.isPerspectiveCamera||!t1)return;
    var dp=c1.position.clone(),dt=t1.target.clone();
    c1.position.copy(op);t1.target.copy(ot);
    tween(900,function(e){c1.position.lerpVectors(op,dp,e);t1.target.lerpVectors(ot,dt,e);c1.lookAt(t1.target);if(t1.update)t1.update()});
  }
  var st=document.createElement('style');st.textContent='html.orbit canvas{cursor:grab}html.orbit canvas:active{cursor:grabbing}';document.head.appendChild(st);
  /* the page keeps the wheel until control is taken */
  window.addEventListener('wheel',function(e){if(zoomOn)return;e.stopImmediatePropagation();e.preventDefault();post({type:'wheel',dx:e.deltaX,dy:e.deltaY})},{capture:true,passive:false});
  window.addEventListener('pointerdown',function(){if(!zoomOn)post({type:'engage'})},true);
  window.addEventListener('load',function(){post({type:'ready',views:views()})});
  window.addEventListener('message',function(e){
    if(e.source!==parent)return;var d=e.data||{};
    if(d.type==='control'){zoomOn=!!d.on;if(d.on)dolly(0.62,800)}
    if(d.type==='orbit')document.documentElement.classList.toggle('orbit',!!d.on);
    if(d.type==='view'){var b=document.querySelector('#views button[data-v="'+String(d.id).replace(/"/g,'')+'"]');if(b)b.click()}
  });
  window.addEventListener('keydown',function(e){if(e.key==='Escape')post({type:'release'})});
})();
