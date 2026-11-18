if(/[?&]embed=1/.test(location.search)||window.__embedForce){document.documentElement.classList.add('embed');document.documentElement.setAttribute('data-theme','dark');window.__embed=true;
/* Speed: cap the pixel ratio, render on demand (frames are only run while awake), and let the page release the WebGL context. */
(function(){
  var real=window.devicePixelRatio||1;
  try{Object.defineProperty(window,'devicePixelRatio',{configurable:true,get:function(){return Math.min(1.5,real)}})}catch(e){}
  var raf=window.requestAnimationFrame.bind(window),caf=window.cancelAnimationFrame.bind(window);
  var q=[],qid=0,until=performance.now()+4000,paused=false;
  function awake(){return !paused&&performance.now()<until}
  function flush(){var l=q;q=[];l.forEach(function(it){it.real=raf(it.cb)})}
  window.requestAnimationFrame=function(cb){
    if(awake()){return raf(cb)}
    var it={id:--qid,cb:cb,real:0};q.push(it);return it.id;
  };
  window.cancelAnimationFrame=function(id){
    if(id<0){q=q.filter(function(it){return it.id!==id});return}
    caf(id);
  };
  /* keep rendering for ms after any input or change, then go idle (no frames at all) */
  window.__wake=function(ms){
    until=Math.max(until,performance.now()+(ms||1500));
    if(q.length&&!paused)flush();
  };
  window.__pause=function(on){paused=!!on;if(!paused)window.__wake(800)};
  window.__isAwake=awake;
  /* remember WebGL contexts so the parent can release them */
  var gc=HTMLCanvasElement.prototype.getContext;window.__gl=[];
  HTMLCanvasElement.prototype.getContext=function(t){var c=gc.apply(this,arguments);if(c&&/webgl/.test(t)&&window.__gl.indexOf(c)<0)window.__gl.push(c);return c};
  window.__disposeGL=function(){window.__gl.forEach(function(g){try{var x=g.getExtension('WEBGL_lose_context');x&&x.loseContext()}catch(e){}})};
})();
}
