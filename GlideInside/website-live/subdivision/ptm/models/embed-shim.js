/* Loads between three.js and the model script (embed only): wraps WebGLRenderer so shadow maps are capped at 1024
   and every renderer is remembered, so the parent page can release it. */
(function(){
  if(!window.__embed||!window.THREE||!THREE.WebGLRenderer||THREE.WebGLRenderer.__wrapped)return;
  var Orig=THREE.WebGLRenderer;window.__renderers=[];
  function W(p){
    var r=new Orig(p),o=r.render,n=0;window.__renderers.push(r);
    r.render=function(scene){
      if(n<6&&scene&&scene.traverse){
        n++;
        scene.traverse(function(l){
          var s=l.isLight&&l.shadow;
          if(s&&s.mapSize&&(s.mapSize.x>1024||s.mapSize.y>1024)){s.mapSize.set(Math.min(1024,s.mapSize.x),Math.min(1024,s.mapSize.y));if(s.map){s.map.dispose();s.map=null}}
        });
      }
      return o.apply(this,arguments);
    };
    return r;
  }
  W.prototype=Orig.prototype;W.__wrapped=true;
  try{THREE.WebGLRenderer=W}catch(e){}
})();
