
(function(){
'use strict';
var d=document, html=d.documentElement; html.classList.add('js');
var motionPreference=window.matchMedia('(prefers-reduced-motion: reduce)');
var reduce=motionPreference.matches;
var desk=window.matchMedia('(min-width:900px)');
function clamp(v,a,b){return v<a?a:(v>b?b:v);}
function lerp(a,b,t){return a+(b-a)*t;}
function smooth(a,b,x){var t=clamp((x-a)/(b-a),0,1);return t*t*(3-2*t);}
function easeOut(t){return 1-Math.pow(1-t,3);}
function $(s,r){return (r||d).querySelector(s);}
function $$(s,r){return Array.prototype.slice.call((r||d).querySelectorAll(s));}
function wrapPi(a){a=(a+Math.PI)%(2*Math.PI); if(a<0)a+=2*Math.PI; return a-Math.PI;}
function rnd(i){var s=Math.sin(i*12.9898)*43758.5453; return s-Math.floor(s);}

function positionTags(tags,w,h,step,project){
  var boxes=[];
  tags.forEach(function(t){
    if(t.step!==step)return;
    var p=project(t);if(p.z>1||p.z<-1){t.el.style.visibility='hidden';return;}t.el.style.visibility='visible';
    var tw=Math.min(t.el.offsetWidth||100,w-24),th=t.el.offsetHeight||20;
    var x=clamp(p.x-tw/2,12,Math.max(12,w-tw-12)),y=clamp(p.y-th-14,12,Math.max(12,h-th-12));
    for(var tries=0;tries<12;tries++){
      var hit=boxes.some(function(b){return x<b.x+b.w+6&&x+tw+6>b.x&&y<b.y+b.h+6&&y+th+6>b.y;});
      if(!hit)break;y+=th+8;if(y+th>h-12)y=12;
    }
    if(boxes.some(function(b){return x<b.x+b.w+4&&x+tw+4>b.x&&y<b.y+b.h+4&&y+th+4>b.y;})){t.el.style.visibility='hidden';return;}
    boxes.push({x:x,y:y,w:tw,h:th});t.el.style.transform='translate('+x.toFixed(1)+'px,'+y.toFixed(1)+'px)';
  });
}
/* =====================================================================
   The site: one explicit ground model that every layer is draped on
   ===================================================================== */
var X0=-10,X1=10,Z0=-7,Z1=7,BASE=-3.2;
var XC=6.3;                               // cul-de-sac centre
function fz(x){return -1.4-0.5*Math.sin((Math.min(x,XC)+2)*0.33);}   // road centreline
var ZC=fz(XC);
function RL(x){return 0.80-0.014*(Math.min(x,XC)+10);}               // road design level
function creekZ(x){return 5.0+0.6*Math.sin(x*0.45);}
function natural(x,z){
  var h=1.6-0.16*(z+7);
  h+=0.22*Math.sin(x*0.35+0.6)*Math.cos(z*0.3)+0.10*Math.sin(x*0.9+z*0.5);
  var dd=z-creekZ(x);
  h-=0.95*Math.exp(-(dd*dd)/0.75);
  if(dd>0.4) h+=0.35*(dd-0.4);
  return h;
}
function frontN(x){
  var z=fz(x)-0.85, ex=x-XC, R=1.45;
  if(Math.abs(ex)<R) z=Math.min(z, ZC-Math.sqrt(R*R-ex*ex));
  return z;
}
var CREEK=-0.95, L1=0.02, FPL=0.12;       // normal water level, 1% AEP level, planning level
var pads=[];
(function(){
  var i,xc,z;
  for(i=0;i<8;i++){ xc=-9.2+2.1*i+1.05; z=frontN(xc)-1.25; pads.push({x:xc,z:z,hw:0.66,hd:0.52,y:natural(xc,z),house:(i!==2&&i!==6)}); }
  for(i=0;i<6;i++){ xc=-9.2+2.1*i+1.05; z=fz(xc)+0.85+1.15; pads.push({x:xc,z:z,hw:0.66,hd:0.52,y:Math.max(natural(xc,z),FPL+0.04),house:(i!==4)}); }
})();
var FEAT=pads[10];
var BAS={x:6.0,z:2.0,hw:1.4,hd:0.75}; BAS.y=natural(BAS.x,BAS.z)-0.5;
function ground(x,z){
  var h=natural(x,z),i,p,ax,az,dd,w;
  var db=Math.max(0,Math.sqrt((x-XC)*(x-XC)+(z-ZC)*(z-ZC))-0.6);
  var dl=(x<=XC)?Math.abs(z-fz(x)):1e9;
  dd=Math.min(dl,db);
  if(dd<1.3){ w=1-smooth(0.6,1.3,dd); h=lerp(h,RL(x),w); }
  for(i=0;i<pads.length;i++){
    p=pads[i]; ax=Math.max(Math.abs(x-p.x)-p.hw,0); az=Math.max(Math.abs(z-p.z)-p.hd,0);
    if(ax<0.45&&az<0.45){ dd=Math.sqrt(ax*ax+az*az); if(dd<0.45){ w=1-smooth(0,0.45,dd); h=lerp(h,p.y,w); } }
  }
  ax=Math.max(Math.abs(x-BAS.x)-BAS.hw,0); az=Math.max(Math.abs(z-BAS.z)-BAS.hd,0); dd=Math.sqrt(ax*ax+az*az);
  if(dd<0.5){ w=1-smooth(0,0.5,dd); h=lerp(h,BAS.y,w); }
  return h;
}

/* ---------- shared orbit drag: horizontal drag turns the model, vertical touch still scrolls ---------- */
function Orbit(el,cur,goal,onDrag){
  var drag=null;
  el.addEventListener('pointerdown',function(e){
    if(e.pointerType==='mouse'&&e.button!==0) return;
    drag={x:e.clientX,y:e.clientY,id:e.pointerId,touch:e.pointerType!=='mouse'};
    try{el.setPointerCapture(e.pointerId);}catch(_){}
    el.classList.add('dragging'); if(onDrag) onDrag();
  });
  el.addEventListener('pointermove',function(e){
    if(!drag||e.pointerId!==drag.id) return;
    var mx=e.clientX-drag.x,my=e.clientY-drag.y; drag.x=e.clientX; drag.y=e.clientY;
    goal.th-=mx*0.009; cur.th-=mx*0.009;
    if(!drag.touch){ var p=clamp(goal.ph-my*0.006,0.2,1.5); cur.ph+=p-goal.ph; goal.ph=p; }
  });
  function end(e){ if(drag&&(!e||e.pointerId===drag.id)){ drag=null; el.classList.remove('dragging'); } }
  el.addEventListener('pointerup',end); el.addEventListener('pointercancel',end);
  return {active:function(){return !!drag;}};
}
function place(cam,c,fit){
  var dd=c.d*fit, sp=Math.sin(c.ph);
  cam.position.set(c.tx+dd*sp*Math.sin(c.th), c.ty+dd*Math.cos(c.ph), c.tz+dd*sp*Math.cos(c.th));
  cam.lookAt(c.tx,c.ty,c.tz);
}
function fitFor(aspect){ return aspect<1.55 ? Math.pow(1.55/aspect,0.9) : 1; }

function gridFloor(renderer,size,y){
  var c=d.createElement('canvas'); c.width=c.height=1024; var x=c.getContext('2d'),q;
  x.strokeStyle='rgba(199,162,86,0.6)'; x.lineWidth=1;
  for(q=0;q<=1024;q+=32){ x.beginPath(); x.moveTo(q+0.5,0); x.lineTo(q+0.5,1024); x.stroke(); x.beginPath(); x.moveTo(0,q+0.5); x.lineTo(1024,q+0.5); x.stroke(); }
  x.globalCompositeOperation='destination-in';
  var g=x.createRadialGradient(512,512,90,512,512,512); g.addColorStop(0,'rgba(0,0,0,1)'); g.addColorStop(0.55,'rgba(0,0,0,0.45)'); g.addColorStop(1,'rgba(0,0,0,0)');
  x.fillStyle=g; x.fillRect(0,0,1024,1024);
  var tex=new THREE.CanvasTexture(c); tex.anisotropy=Math.min(8,renderer.capabilities.getMaxAnisotropy());
  var m=new THREE.Mesh(new THREE.PlaneGeometry(size,size),new THREE.MeshBasicMaterial({map:tex,transparent:true,opacity:0.42,depthWrite:false}));
  m.rotation.x=-Math.PI/2; m.position.y=y; m.renderOrder=-1; return m;
}
var scenes=[];

/* =====================================================================
   Scene 1: the explorable site
   ===================================================================== */
function buildSite(){
  var stage=$('#stage'), canvas=$('#site3d'), tagsEl=$('#tags');
  var renderer=new THREE.WebGLRenderer({canvas:canvas,antialias:true,alpha:true});
  renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,3));
  var scene=new THREE.Scene(), camera=new THREE.PerspectiveCamera(32,1,0.5,300), world=new THREE.Group();
  scene.add(world);
  scene.add(new THREE.HemisphereLight(0xfff1d0,0x0b0b0a,0.72));
  var key=new THREE.DirectionalLight(0xffe2a8,0.8); key.position.set(-9,11,8); scene.add(key);
  var rim=new THREE.DirectionalLight(0x9fb6c4,0.3); rim.position.set(10,6,-9); scene.add(rim);
  scene.add(gridFloor(renderer,64,BASE-0.03));

  var GOLD=0xC7A256;
  var LAY={};
  ['land','cut','roads','pave','swept','storm','sewer','esc','foot'].forEach(function(n){ LAY[n]={cur:0,goal:0,items:[],grp:new THREE.Group(),under:false}; world.add(LAY[n].grp); });
  LAY.storm.under=LAY.sewer.under=LAY.foot.under=LAY.pave.under=LAY.swept.under=LAY.esc.under=LAY.cut.under=true;
  function reg(layer,mat,dOp,hOp,dCol,hCol){
    mat.transparent=true; mat.opacity=dOp;
    LAY[layer].items.push({m:mat,d:dOp,h:hOp,dc:dCol!=null?new THREE.Color(dCol):null,hc:hCol!=null?new THREE.Color(hCol):null});
    return mat;
  }
  function V(x,y,z){return new THREE.Vector3(x,y,z);}
  function segs(arr,mat,order){
    var g=new THREE.BufferGeometry(); g.setAttribute('position',new THREE.Float32BufferAttribute(arr,3));
    var l=new THREE.LineSegments(g,mat); l.renderOrder=(order==null?2:order); return l;
  }
  function drape(arr,x1,z1,x2,z2,off){
    var len=Math.sqrt((x2-x1)*(x2-x1)+(z2-z1)*(z2-z1)), n=Math.max(1,Math.ceil(len/0.25)), i,ax,az,bx,bz;
    for(i=0;i<n;i++){
      ax=lerp(x1,x2,i/n); az=lerp(z1,z2,i/n); bx=lerp(x1,x2,(i+1)/n); bz=lerp(z1,z2,(i+1)/n);
      arr.push(ax,ground(ax,az)+off,az, bx,ground(bx,bz)+off,bz);
    }
  }
  var UP=V(0,1,0);
  function tube(a,b,r,mat){
    var dir=V(0,0,0).subVectors(b,a), len=dir.length();
    var m=new THREE.Mesh(new THREE.CylinderGeometry(r,r,len,8,1,true),mat);
    m.position.copy(a).addScaledVector(dir,0.5); m.quaternion.setFromUnitVectors(UP,dir.normalize());
    return m;
  }
  function pathOf(pts){
    var acc=[0],i; for(i=1;i<pts.length;i++) acc.push(acc[i-1]+pts[i].distanceTo(pts[i-1]));
    var total=acc[acc.length-1];
    return function(t,out){
      var s=((t%1)+1)%1*total, i=1; while(i<acc.length-1&&acc[i]<s) i++;
      var u=(s-acc[i-1])/Math.max(1e-6,acc[i]-acc[i-1]); return out.copy(pts[i-1]).lerp(pts[i],u);
    };
  }

  /* ---- terrain ---- */
  var NX=80,NZ=56,dx=(X1-X0)/NX,dz=(Z1-Z0)/NZ,i,j,k;
  var cnt=(NX+1)*(NZ+1), hs=new Float32Array(cnt), pos=new Float32Array(cnt*3), col=new Float32Array(cnt*3);
  var cLo=new THREE.Color(0x1d1c19), cHi=new THREE.Color(0x3b382f), ct=new THREE.Color();
  for(j=0;j<=NZ;j++) for(i=0;i<=NX;i++){
    var x=X0+i*dx, z=Z0+j*dz, h=ground(x,z); k=j*(NX+1)+i; hs[k]=h;
    pos[k*3]=x; pos[k*3+1]=h; pos[k*3+2]=z;
    ct.copy(cLo).lerp(cHi,clamp((h+1.2)/3,0,1)); col[k*3]=ct.r; col[k*3+1]=ct.g; col[k*3+2]=ct.b;
  }
  var idx=[];
  for(j=0;j<NZ;j++) for(i=0;i<NX;i++){ var a=j*(NX+1)+i,b=a+1,c=a+NX+1,e=c+1; idx.push(a,c,b,b,c,e); }
  var tg=new THREE.BufferGeometry();
  tg.setAttribute('position',new THREE.BufferAttribute(pos,3)); tg.setAttribute('color',new THREE.BufferAttribute(col,3));
  tg.setIndex(idx); tg.computeVertexNormals();
  var terMat=new THREE.MeshStandardMaterial({vertexColors:true,roughness:0.96,metalness:0,transparent:true,opacity:1,polygonOffset:true,polygonOffsetFactor:1,polygonOffsetUnits:1});
  var ter=new THREE.Mesh(tg,terMat); ter.renderOrder=1; world.add(ter);

  /* ---- cut and fill: recolour the ground by how far the design sits below or above natural ---- */
  var colBase=new Float32Array(col), colCF=new Float32Array(cnt*3), cfApplied=0, sumCut=0, sumFill=0;
  (function(){
    var CUT=new THREE.Color(0xE0673A), FILL=new THREE.Color(0x57B88C), q, dd;
    for(q=0;q<cnt;q++){
      dd=hs[q]-natural(pos[q*3],pos[q*3+2]);
      if(dd>0) sumFill+=dd; else sumCut-=dd;
      ct.setRGB(colBase[q*3],colBase[q*3+1],colBase[q*3+2]);
      if(Math.abs(dd)>0.012) ct.lerp(dd>0?FILL:CUT,clamp(Math.abs(dd)/0.28,0.4,1)); else ct.multiplyScalar(0.72);
      colCF[q*3]=ct.r; colCF[q*3+1]=ct.g; colCF[q*3+2]=ct.b;
    }
  })();

  /* ---- contours (marching squares on the same grid) ---- */
  var cMin=[],cMaj=[];
  for(var n=-6;n<=10;n++){
    var lv=n*0.2+0.0007, tgt=(n%5===0)?cMaj:cMin;
    for(j=0;j<NZ;j++) for(i=0;i<NX;i++){
      var a2=j*(NX+1)+i, h00=hs[a2],h10=hs[a2+1],h01=hs[a2+NX+1],h11=hs[a2+NX+2];
      if(lv<Math.min(h00,h10,h01,h11)||lv>Math.max(h00,h10,h01,h11)) continue;
      var x0=X0+i*dx,z0=Z0+j*dz,pt=[],t;
      if((h00<lv)!==(h10<lv)){t=(lv-h00)/(h10-h00); pt.push(x0+t*dx,z0);}
      if((h10<lv)!==(h11<lv)){t=(lv-h10)/(h11-h10); pt.push(x0+dx,z0+t*dz);}
      if((h01<lv)!==(h11<lv)){t=(lv-h01)/(h11-h01); pt.push(x0+t*dx,z0+dz);}
      if((h00<lv)!==(h01<lv)){t=(lv-h00)/(h01-h00); pt.push(x0,z0+t*dz);}
      for(k=0;k+3<pt.length;k+=4) tgt.push(pt[k],lv+0.012,pt[k+1],pt[k+2],lv+0.012,pt[k+3]);
    }
  }
  var cMinMat=new THREE.LineBasicMaterial({color:GOLD,transparent:true,opacity:0.2});
  var cMajMat=new THREE.LineBasicMaterial({color:GOLD,transparent:true,opacity:0.5});
  world.add(segs(cMin,cMinMat,2)); world.add(segs(cMaj,cMajMat,2));

  /* ---- block sides with soil strata, and the block outline ---- */
  (function(){
    var p=[],c=[],T=new THREE.Color(0x4a4334),C=new THREE.Color(0x6a5b3f),R=new THREE.Color(0x2c2b28);
    function quad(ax,ay0,ay1,az,bx,by0,by1,bz,cl,f){
      p.push(ax,ay0,az,bx,by0,bz,bx,by1,bz, ax,ay0,az,bx,by1,bz,ax,ay1,az);
      for(var q=0;q<6;q++) c.push(cl.r*f,cl.g*f,cl.b*f);
    }
    function rock(x,z){return -1.15+0.14*Math.sin(x*0.5+z*0.4);}
    function wall(pts,f){
      for(var q=0;q<pts.length-1;q++){
        var A=pts[q],B=pts[q+1],ha=ground(A[0],A[1]),hb=ground(B[0],B[1]),a1=ha-0.2,b1=hb-0.2;
        var ra=Math.min(a1,rock(A[0],A[1])), rb=Math.min(b1,rock(B[0],B[1]));
        quad(A[0],ha,a1,A[1],B[0],hb,b1,B[1],T,f); quad(A[0],a1,ra,A[1],B[0],b1,rb,B[1],C,f); quad(A[0],ra,BASE,A[1],B[0],rb,BASE,B[1],R,f);
      }
    }
    var s=[],nn=[],ee=[],ww=[],q,rimL=[];
    for(q=0;q<=NX;q++){ s.push([X0+q*dx,Z1]); nn.push([X0+q*dx,Z0]); }
    for(q=0;q<=NZ;q++){ ww.push([X0,Z0+q*dz]); ee.push([X1,Z0+q*dz]); }
    wall(s,1.0); wall(nn,0.5); wall(ww,0.76); wall(ee,0.76);
    var g=new THREE.BufferGeometry();
    g.setAttribute('position',new THREE.Float32BufferAttribute(p,3)); g.setAttribute('color',new THREE.Float32BufferAttribute(c,3));
    world.add(new THREE.Mesh(g,new THREE.MeshBasicMaterial({vertexColors:true,side:THREE.DoubleSide})));
    [s,nn,ww,ee].forEach(function(arr){ for(q=0;q<arr.length-1;q++){ var A=arr[q],B=arr[q+1]; rimL.push(A[0],ground(A[0],A[1])+0.012,A[1],B[0],ground(B[0],B[1])+0.012,B[1]); } });
    world.add(segs(rimL,new THREE.LineBasicMaterial({color:GOLD,transparent:true,opacity:0.9}),2));
    var fr=[X0,BASE,Z0,X1,BASE,Z0, X1,BASE,Z0,X1,BASE,Z1, X1,BASE,Z1,X0,BASE,Z1, X0,BASE,Z1,X0,BASE,Z0];
    [[X0,Z0],[X1,Z0],[X1,Z1],[X0,Z1]].forEach(function(cn){ fr.push(cn[0],BASE,cn[1],cn[0],ground(cn[0],cn[1]),cn[1]); });
    world.add(segs(fr,new THREE.LineBasicMaterial({color:GOLD,transparent:true,opacity:0.4}),2));
  })();

  /* ---- water: a level plane, the terrain's own depth gives the flood extent ---- */
  var water=new THREE.Mesh(new THREE.PlaneGeometry(X1-X0-0.02,Z1-Z0-0.02),
    new THREE.MeshBasicMaterial({color:0x3f93ba,transparent:true,opacity:0.62,depthWrite:false}));
  water.rotation.x=-Math.PI/2; water.position.y=CREEK; water.renderOrder=5; world.add(water);

  /* ---- trees along the creek ---- */
  (function(){
    var geo=new THREE.IcosahedronGeometry(0.2,0), mat=new THREE.MeshStandardMaterial({color:0x46553f,roughness:1,flatShading:true}), q=0, x, z, m, sgn;
    for(x=-9.6;x<9.8;x+=0.8){
      for(sgn=-1;sgn<=1;sgn+=2){
        q++; z=creekZ(x)+sgn*(1.0+rnd(q)*0.6);
        if(z>6.8||(sgn<0&&x>4.2&&x<8.2)) continue;
        m=new THREE.Mesh(geo,mat); var sc=0.8+rnd(q+50)*0.7; m.scale.set(sc,sc*1.35,sc);
        m.position.set(x+(rnd(q+9)-0.5)*0.5,ground(x,z)+0.2*sc,z); m.rotation.y=rnd(q)*6; world.add(m);
      }
    }
  })();

  /* ---- houses ---- */
  var bodyMat=new THREE.MeshStandardMaterial({color:0xb4ad9b,roughness:0.9,transparent:true});
  var roofMat=new THREE.MeshStandardMaterial({color:0x6b6557,roughness:0.9,transparent:true,flatShading:true});
  var fBody=bodyMat.clone(), fRoof=roofMat.clone();
  var bodyGeo=new THREE.BoxGeometry(1.08,0.34,0.78), roofGeo=new THREE.ConeGeometry(0.78,0.3,4,1);
  var featG=null;
  pads.forEach(function(p){
    if(!p.house) return;
    var g=new THREE.Group(), feat=(p===FEAT);
    var body=new THREE.Mesh(bodyGeo,feat?fBody:bodyMat); body.position.y=0.17; g.add(body);
    var rg=new THREE.Group(); rg.scale.set(1,1,0.73); rg.position.y=0.49;
    var roof=new THREE.Mesh(roofGeo,feat?fRoof:roofMat); roof.rotation.y=Math.PI/4; rg.add(roof); g.add(rg);
    g.position.set(p.x,p.y,p.z); g.traverse(function(o){o.renderOrder=2;}); world.add(g);
    if(feat) featG=g;
  });

  /* ---- layer: lots and pads ---- */
  (function(){
    var arr=[],q,x,xa,xb;
    for(q=0;q<=8;q++){ x=-9.2+2.1*q; drape(arr,x,frontN(x),x,-6.3,0.035); }
    drape(arr,-9.2,-6.3,7.6,-6.3,0.035);
    for(x=-9.2;x<7.6-1e-6;x+=0.2){ xa=x; xb=Math.min(7.6,x+0.2); drape(arr,xa,frontN(xa),xb,frontN(xb),0.035); }
    for(q=0;q<=6;q++){ x=-9.2+2.1*q; drape(arr,x,fz(x)+0.85,x,2.6,0.035); }
    drape(arr,-9.2,2.6,3.4,2.6,0.035);
    for(x=-9.2;x<3.4-1e-6;x+=0.2){ xa=x; xb=Math.min(3.4,x+0.2); drape(arr,xa,fz(xa)+0.85,xb,fz(xb)+0.85,0.035); }
    LAY.land.grp.add(segs(arr,reg('land',new THREE.LineBasicMaterial({color:GOLD}),0.1,1),2));
    var pm=reg('land',new THREE.MeshBasicMaterial({color:GOLD,depthWrite:false}),0,0.34);
    pads.forEach(function(p){
      var m=new THREE.Mesh(new THREE.PlaneGeometry(p.hw*2,p.hd*2),pm); m.rotation.x=-Math.PI/2; m.position.set(p.x,p.y+0.028,p.z); m.renderOrder=2; LAY.land.grp.add(m);
    });
  })();

  /* ---- layer: road ---- */
  var roadMat;
  (function(){
    var p=[],ix=[],q,x,steps=66,nv=0;
    for(q=0;q<=steps;q++){ x=lerp(X0,XC,q/steps); p.push(x,RL(x)+0.02,fz(x)-0.45, x,RL(x)+0.02,fz(x)+0.45); if(q<steps){ ix.push(nv,nv+1,nv+2, nv+2,nv+1,nv+3); } nv+=2; }
    var c0=nv; p.push(XC,RL(XC)+0.02,ZC); nv++;
    for(q=0;q<=40;q++){ var an=q/40*Math.PI*2; p.push(XC+1.05*Math.cos(an),RL(XC)+0.02,ZC+1.05*Math.sin(an)); if(q<40) ix.push(c0,nv+1,nv); nv++; }
    var g=new THREE.BufferGeometry(); g.setAttribute('position',new THREE.Float32BufferAttribute(p,3)); g.setIndex(ix); g.computeVertexNormals();
    roadMat=reg('roads',new THREE.MeshStandardMaterial({color:0x2b2a26,roughness:1}),1,1,0x2b2a26,0x514c40);
    var road=new THREE.Mesh(g,roadMat); road.renderOrder=2; LAY.roads.grp.add(road);
    var kerb=[],ctr=[],tick=[],xa,xb,sgn;
    for(x=X0;x<XC+1e-6;x+=0.2){
      xa=x; xb=Math.min(XC,x+0.2);
      for(sgn=-1;sgn<=1;sgn+=2){
        var za=fz(xa)+sgn*0.45, zb=fz(xb)+sgn*0.45;
        if(Math.sqrt((xb-XC)*(xb-XC)+(zb-ZC)*(zb-ZC))>1.05) kerb.push(xa,RL(xa)+0.035,za,xb,RL(xb)+0.035,zb);
      }
    }
    for(q=0;q<64;q++){
      var a1=q/64*Math.PI*2,a2=(q+1)/64*Math.PI*2, px=XC+1.05*Math.cos(a1), pz=ZC+1.05*Math.sin(a1);
      if(px<XC&&Math.abs(pz-fz(px))<0.45) continue;
      kerb.push(px,RL(XC)+0.035,pz, XC+1.05*Math.cos(a2),RL(XC)+0.035,ZC+1.05*Math.sin(a2));
    }
    LAY.roads.grp.add(segs(kerb,reg('roads',new THREE.LineBasicMaterial({color:GOLD}),0.3,1),2));
    var cp=[]; for(x=X0;x<=XC+1e-6;x+=0.25) cp.push(V(x,RL(x)+0.036,fz(x)));
    var cl=new THREE.Line(new THREE.BufferGeometry().setFromPoints(cp),reg('roads',new THREE.LineDashedMaterial({color:0xf2f0ea,dashSize:0.28,gapSize:0.2}),0.18,0.95));
    cl.computeLineDistances(); cl.renderOrder=2; LAY.roads.grp.add(cl);
    for(x=-9;x<=6;x+=1){ tick.push(x,RL(x)+0.037,fz(x)-0.14, x,RL(x)+0.037,fz(x)+0.14); }
    LAY.roads.grp.add(segs(tick,reg('roads',new THREE.LineBasicMaterial({color:0xf2f0ea}),0,0.8),2));
  })();

  /* ---- layer: pavement, shown as an exploded core lifted out of the road ---- */
  var PV={x0:-2.6,parts:[]};
  (function(){
    var G=LAY.pave.grp, m=-0.165*Math.cos((PV.x0+2)*0.33);
    PV.ang=-Math.atan(m); PV.y0=RL(PV.x0); PV.zc=fz(PV.x0);
    var holder=new THREE.Group(); holder.position.set(PV.x0,PV.y0,PV.zc); holder.rotation.y=PV.ang; G.add(holder);
    var edgeMat=reg('pave',new THREE.LineBasicMaterial({color:GOLD}),0,1);
    [['Subgrade',0.30,0x5c4f3b,0.62],['Subbase',0.26,0x8d7955,1.27],['Base',0.22,0xb49d6e,1.88],['Wearing course',0.10,0x3d3c38,2.40]].forEach(function(df,qi){
      var mat=reg('pave',new THREE.MeshStandardMaterial({color:df[2],roughness:0.95}),0,1);
      var geo=new THREE.BoxGeometry(2.4,df[1],0.9), mesh=new THREE.Mesh(geo,mat); mesh.renderOrder=3;
      var ed=new THREE.LineSegments(new THREE.EdgesGeometry(geo),edgeMat); ed.renderOrder=3; mesh.add(ed);
      holder.add(mesh); PV.parts.push({mesh:mesh,y:df[3],th:df[1],name:df[0],side:(qi%2?1:-1)});
    });
    var patch=new THREE.Mesh(new THREE.PlaneGeometry(2.4,0.9),reg('pave',new THREE.MeshBasicMaterial({color:0x0e0e0d,depthWrite:false}),0,0.9));
    patch.rotation.x=-Math.PI/2; patch.position.y=0.03; patch.renderOrder=2; holder.add(patch);
    var po=new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.PlaneGeometry(2.4,0.9)),edgeMat); po.rotation.x=-Math.PI/2; po.position.y=0.034; po.renderOrder=2; holder.add(po);
  })();

  /* ---- layer: stormwater ---- */
  var stormDots=[], stormPath;
  (function(){
    var G=LAY.storm.grp, mat=reg('storm',new THREE.MeshBasicMaterial({color:0xE2BE6A}),0,1), q, pts=[];
    var xs=[-8,-4.8,-1.6,1.6,4.6];
    xs.forEach(function(x){ pts.push(V(x,RL(x)-0.36,fz(x)+0.5)); });
    pts.push(V(5.3,BAS.y+0.06,BAS.z-BAS.hd+0.05));
    for(q=0;q<pts.length-1;q++) G.add(tube(pts[q],pts[q+1],0.055,mat));
    xs.forEach(function(x){ var pit=new THREE.Mesh(new THREE.BoxGeometry(0.17,0.42,0.17),mat); pit.position.set(x,RL(x)-0.19,fz(x)+0.5); G.add(pit); });
    [-6.4,-0.2,3.2].forEach(function(x){
      var pit=new THREE.Mesh(new THREE.BoxGeometry(0.17,0.42,0.17),mat); pit.position.set(x,RL(x)-0.19,fz(x)-0.5); G.add(pit);
      G.add(tube(V(x,RL(x)-0.33,fz(x)-0.5),V(x,RL(x)-0.36,fz(x)+0.5),0.04,mat));
    });
    var o1=V(BAS.x+0.9,BAS.y+0.05,BAS.z+BAS.hd-0.05), cz=creekZ(7.4), o2=V(7.4,natural(7.4,cz-0.55)+0.05,cz-0.55);
    G.add(tube(o1,o2,0.055,mat));
    var hw=new THREE.Mesh(new THREE.BoxGeometry(0.34,0.2,0.1),mat); hw.position.copy(o2); hw.position.y+=0.06; G.add(hw);
    var rimA=[],bx0=BAS.x-BAS.hw-0.25,bx1=BAS.x+BAS.hw+0.25,bz0=BAS.z-BAS.hd-0.25,bz1=BAS.z+BAS.hd+0.25;
    drape(rimA,bx0,bz0,bx1,bz0,0.035); drape(rimA,bx1,bz0,bx1,bz1,0.035); drape(rimA,bx1,bz1,bx0,bz1,0.035); drape(rimA,bx0,bz1,bx0,bz0,0.035);
    G.add(segs(rimA,reg('storm',new THREE.LineBasicMaterial({color:GOLD}),0,1),0));
    stormPath=pathOf(pts);
    var dm=reg('storm',new THREE.MeshBasicMaterial({color:0xFFF6DC}),0,1), dg=new THREE.SphereGeometry(0.07,10,8);
    for(q=0;q<7;q++){ var s=new THREE.Mesh(dg,dm); G.add(s); stormDots.push(s); }
  })();

  /* ---- layer: water and sewer ---- */
  var PS={x:8.7,z:-0.2}, riseDots=[], risePath;
  (function(){
    var G=LAY.sewer.grp, mat=reg('sewer',new THREE.MeshBasicMaterial({color:0xE2BE6A}),0,1), q, x, pts=[];
    // gravity sewer down the south verge to the pump station
    [-9,-5.5,-2,1.5,5.2].forEach(function(xx,qi){ pts.push(V(xx,RL(xx)-0.55-0.05*qi,fz(xx)+0.74)); });
    var gy=ground(PS.x,PS.z); pts.push(V(PS.x,gy-0.95,PS.z));
    for(q=0;q<pts.length-1;q++) G.add(tube(pts[q],pts[q+1],0.05,mat));
    for(q=0;q<pts.length-1;q++){ var top=ground(pts[q].x,pts[q].z)+0.03; var mh=new THREE.Mesh(new THREE.CylinderGeometry(0.09,0.09,top-pts[q].y+0.06,10),mat); mh.position.set(pts[q].x,(top+pts[q].y-0.06)/2,pts[q].z); G.add(mh); }
    var well=new THREE.Mesh(new THREE.CylinderGeometry(0.27,0.27,1.4,16),mat); well.position.set(PS.x,gy+0.04-0.7,PS.z); G.add(well);
    var kiosk=new THREE.Mesh(new THREE.BoxGeometry(0.3,0.3,0.16),mat); kiosk.position.set(PS.x+0.5,gy+0.15,PS.z); G.add(kiosk);
    // rising main up the hill and off the block
    var rp=[V(PS.x,gy-0.5,PS.z)], zz;
    for(zz=PS.z-0.6;zz>Z0+0.05;zz-=0.6) rp.push(V(8.95,ground(8.95,zz)-0.22,zz));
    rp.push(V(8.95,ground(8.95,Z0+0.02)-0.22,Z0+0.02));
    for(q=0;q<rp.length-1;q++) G.add(tube(rp[q],rp[q+1],0.032,mat));
    risePath=pathOf(rp);
    // water main along the north verge, with hydrants
    var wp=[]; for(x=X0+0.02;x<=5.21;x+=0.4) wp.push(V(x,RL(x)-0.16,fz(x)-0.68));
    for(q=0;q<wp.length-1;q++) G.add(tube(wp[q],wp[q+1],0.028,mat));
    [-7,-1,5].forEach(function(xx){ var hy=new THREE.Mesh(new THREE.CylinderGeometry(0.04,0.04,0.34,8),mat); hy.position.set(xx,RL(xx)+0.0,fz(xx)-0.68); G.add(hy); });
    var dm=reg('sewer',new THREE.MeshBasicMaterial({color:0xFFF6DC}),0,1), dg=new THREE.SphereGeometry(0.06,10,8);
    for(q=0;q<4;q++){ var s=new THREE.Mesh(dg,dm); G.add(s); riseDots.push(s); }
  })();

  /* ---- layer: footings under the featured house and its neighbours ---- */
  (function(){
    var G=LAY.foot.grp, mat=reg('foot',new THREE.MeshBasicMaterial({color:0xE2BE6A}),0,1);
    var geo=new THREE.CylinderGeometry(0.05,0.05,0.75,10);
    [pads[9],pads[10],pads[11]].forEach(function(p){
      [-0.42,0,0.42].forEach(function(ox){ [-0.28,0.28].forEach(function(oz){ var m=new THREE.Mesh(geo,mat); m.position.set(p.x+ox,p.y-0.37,p.z+oz); G.add(m); }); });
    });
    var em=reg('foot',new THREE.LineBasicMaterial({color:GOLD}),0,1);
    var e1=new THREE.LineSegments(new THREE.EdgesGeometry(bodyGeo),em); e1.position.set(FEAT.x,FEAT.y+0.17,FEAT.z); G.add(e1);
  })();

  /* ---- driveways and crossovers, shown with the road layer ---- */
  (function(){
    var G=LAY.roads.grp, mat=reg('roads',new THREE.MeshStandardMaterial({color:0x34322d,roughness:1,side:THREE.DoubleSide}),0,1,0x34322d,0x7d7562);
    function kerbN(x){ var z=fz(x)-0.45, ex=x-XC; if(Math.abs(ex)<1.05) z=Math.min(z,ZC-Math.sqrt(1.05*1.05-ex*ex)); return z; }
    pads.forEach(function(p,qi){
      if(!p.house) return;
      var north=qi<8, z0=north?kerbN(p.x):fz(p.x)+0.45, z1=north?p.z+p.hd:p.z-p.hd, n=6, ps=[], ix=[], q, z, y, w=0.11, a;
      for(q=0;q<=n;q++){ z=lerp(z0,z1,q/n); y=ground(p.x,z)+0.03; ps.push(p.x-w,y,z,p.x+w,y,z); if(q<n){ a=q*2; ix.push(a,a+2,a+1,a+1,a+2,a+3); } }
      var g=new THREE.BufferGeometry(); g.setAttribute('position',new THREE.Float32BufferAttribute(ps,3)); g.setIndex(ix); g.computeVertexNormals();
      var m=new THREE.Mesh(g,mat); m.renderOrder=2; G.add(m);
    });
  })();

  /* ---- retaining walls holding the cut behind the uphill pads, shown with earthworks ---- */
  (function(){
    var G=LAY.cut.grp, mat=reg('cut',new THREE.MeshStandardMaterial({color:0xd8d0ba,roughness:0.8}),0,1);
    pads.forEach(function(p,qi){
      if(qi>=8) return;
      var zb=p.z-p.hd-0.03, hgt=clamp(natural(p.x,zb-0.25)-p.y,0.09,0.34);
      var m=new THREE.Mesh(new THREE.BoxGeometry(p.hw*2+0.16,hgt,0.05),mat); m.position.set(p.x,p.y+hgt/2,zb); m.renderOrder=2; G.add(m);
    });
  })();

  /* ---- layer: swept path of a waste truck using the cul-de-sac ---- */
  var SW={};
  (function(){
    var G=LAY.swept.grp, pts=[], x, a, r=0.66, yb=0.055, q;
    for(x=-1.6;x<XC-1.0;x+=0.35) pts.push(V(x,RL(x)+yb,fz(x)-0.2));
    for(a=-2.2;a<=2.2001;a+=0.2) pts.push(V(XC+r*Math.cos(a),RL(XC)+yb,ZC+r*Math.sin(a)));
    for(x=XC-1.0;x>-1.6;x-=0.35) pts.push(V(x,RL(x)+yb,fz(x)+0.2));
    var curve=new THREE.CatmullRomCurve3(pts,false,'centripetal'); SW.curve=curve;
    var N=340, ps=[], ix=[], eL=[], eR=[], p=V(0,0,0), t=V(0,0,0), pl=null, pr=null;
    for(q=0;q<=N;q++){
      curve.getPointAt(q/N,p); curve.getTangentAt(q/N,t);
      var dc=Math.sqrt((p.x-XC)*(p.x-XC)+(p.z-ZC)*(p.z-ZC)), k=1-smooth(0.9,1.7,dc), hl=0.16+0.10*k, hr=0.16+0.05*k;
      var lx=p.x+t.z*hl, lz=p.z-t.x*hl, rx=p.x-t.z*hr, rz=p.z+t.x*hr;
      ps.push(lx,p.y,lz,rx,p.y,rz);
      if(q<N){ var b=q*2; ix.push(b,b+2,b+1,b+1,b+2,b+3); }
      if(pl){ eL.push(pl[0],p.y+0.004,pl[1],lx,p.y+0.004,lz); eR.push(pr[0],p.y+0.004,pr[1],rx,p.y+0.004,rz); }
      pl=[lx,lz]; pr=[rx,rz];
    }
    var g=new THREE.BufferGeometry(); g.setAttribute('position',new THREE.Float32BufferAttribute(ps,3)); g.setIndex(ix);
    var rib=new THREE.Mesh(g,reg('swept',new THREE.MeshBasicMaterial({color:GOLD,side:THREE.DoubleSide,depthWrite:false}),0,0.34)); rib.renderOrder=3; G.add(rib);
    G.add(segs(eL.concat(eR),reg('swept',new THREE.LineBasicMaterial({color:GOLD}),0,1),3));
    SW.mats=[];
    var truck=makeTruck(function(c){ var m=reg('swept',new THREE.MeshStandardMaterial({color:c,roughness:0.7}),0,1); SW.mats.push(m); return m; },'waste');
    truck.scale.set(0.125,0.125,0.125); G.add(truck); SW.truck=truck;
    curve.getPointAt(0.42,truck.position);
  })();

  /* ---- layer: erosion and sediment control while the site is being built ---- */
  (function(){
    var G=LAY.esc.grp, lm=reg('esc',new THREE.LineBasicMaterial({color:0xE2BE6A}),0,1), arr=[], dv=[], q, x;
    function fence(x1,z1,x2,z2){
      var len=Math.sqrt((x2-x1)*(x2-x1)+(z2-z1)*(z2-z1)), n=Math.max(1,Math.round(len/0.4)), ax,az,bx,bz,ay,by;
      for(q=0;q<n;q++){
        ax=lerp(x1,x2,q/n); az=lerp(z1,z2,q/n); bx=lerp(x1,x2,(q+1)/n); bz=lerp(z1,z2,(q+1)/n); ay=ground(ax,az); by=ground(bx,bz);
        arr.push(ax,ay+0.15,az,bx,by+0.15,bz, ax,ay,az,ax,ay+0.15,az);
      }
      arr.push(x2,ground(x2,z2),z2,x2,ground(x2,z2)+0.15,z2);
    }
    fence(-9.4,2.9,4.0,2.9); fence(4.0,2.9,4.0,3.3); fence(4.0,3.3,8.2,3.3);
    drape(dv,-9.4,-6.6,7.9,-6.6,0.05);                                    // diversion drain above the works, drawn dashed
    for(q=0;q+5<dv.length;q+=12) arr.push(dv[q],dv[q+1],dv[q+2],dv[q+3],dv[q+4],dv[q+5]);
    for(x=-9.95;x<=-9.2+1e-6;x+=0.125) arr.push(x,RL(x)+0.045,fz(x)-0.45,x,RL(x)+0.045,fz(x)+0.45);      // stabilised entry
    arr.push(-9.95,RL(-9.95)+0.045,fz(-9.95)-0.45,-9.2,RL(-9.2)+0.045,fz(-9.2)-0.45, -9.95,RL(-9.95)+0.045,fz(-9.95)+0.45,-9.2,RL(-9.2)+0.045,fz(-9.2)+0.45);
    var bx0=BAS.x-BAS.hw-0.25,bx1=BAS.x+BAS.hw+0.25,bz0=BAS.z-BAS.hd-0.25,bz1=BAS.z+BAS.hd+0.25;
    drape(arr,bx0,bz0,bx1,bz0,0.04); drape(arr,bx1,bz0,bx1,bz1,0.04); drape(arr,bx1,bz1,bx0,bz1,0.04); drape(arr,bx0,bz1,bx0,bz0,0.04);
    G.add(segs(arr,lm,2));
  })();

  /* ---- overland flow paths for a major storm, shown with stormwater: each line runs downhill from its start ---- */
  var flowPaths=[], flowDots=[], flowTag=null;
  (function(){
    var G=LAY.storm.grp, lm=reg('storm',new THREE.LineBasicMaterial({color:0x7CC4E8}),0,0.9), arr=[], starts=[], i;
    for(i=1;i<=7;i++) starts.push([-9.2+2.1*i,-6.0]);
    for(i=1;i<=5;i++) starts.push([-9.2+2.1*i,fz(-9.2+2.1*i)+1.0]);
    starts.push([BAS.x+0.9,BAS.z+BAS.hd+0.3]);
    starts.forEach(function(st){
      var px=st[0],pz=st[1],pts=[],q,gx,gz,gl,e=0.06;
      for(q=0;q<280;q++){
        pts.push(V(px,ground(px,pz)+0.05,pz));
        if(pz>creekZ(px)-0.12||px<X0+0.1||px>X1-0.1||pz<Z0+0.1||pz>Z1-0.1) break;
        gx=(ground(px+e,pz)-ground(px-e,pz))/(2*e); gz=(ground(px,pz+e)-ground(px,pz-e))/(2*e); gl=Math.sqrt(gx*gx+gz*gz);
        if(gl<0.004) break;
        px-=0.11*gx/gl; pz-=0.11*gz/gl;
      }
      if(pts.length<8) return;
      for(q=0;q<pts.length-1;q++) arr.push(pts[q].x,pts[q].y,pts[q].z,pts[q+1].x,pts[q+1].y,pts[q+1].z);
      flowPaths.push(pathOf(pts)); if(!flowTag&&st[1]>-3) flowTag=pts[Math.min(pts.length-1,8)];
    });
    G.add(segs(arr,lm,2));
    var dm=reg('storm',new THREE.MeshBasicMaterial({color:0xC9EBFB}),0,1), dg=new THREE.SphereGeometry(0.05,8,6);
    flowPaths.forEach(function(){ var sp=new THREE.Mesh(dg,dm); sp.renderOrder=2; G.add(sp); flowDots.push(sp); });
  })();

  /* ---- tags: HTML labels pinned to points in the model ---- */
  var tags=[];
  function tag(step,text,x,y,z){ var el=d.createElement('span'); el.className='tag'; el.textContent=text; tagsEl.appendChild(el); tags.push({step:step,el:el,p:V(x,y,z)}); }
  tag('land','Building pads',pads[3].x,pads[3].y+0.1,pads[3].z);
  tag('land','Lot boundaries',-9.2,ground(-9.2,-6.3),-6.3);
  tag('roads','Cul-de-sac',XC,RL(XC),ZC);
  tag('roads','Kerb and gutter',-4.4,RL(-4.4),fz(-4.4)+0.45);
  tag('cut','Cut',pads[3].x,pads[3].y+0.05,pads[3].z-0.72);
  tag('cut','Fill',pads[9].x,pads[9].y+0.05,pads[9].z+0.72);
  tag('cut','Basin excavation',BAS.x,BAS.y,BAS.z);
  tag('cut','Retaining wall',pads[5].x,pads[5].y+0.32,pads[5].z-pads[5].hd);
  tag('roads','Driveways and crossovers',pads[4].x,RL(pads[4].x)+0.05,fz(pads[4].x)-0.9);
  tag('swept','Swept path',XC+0.75,RL(XC),ZC-0.1);
  tag('swept','Waste truck',0,0,0); tags[tags.length-1].track=function(pp){ pp.copy(SW.truck.position); pp.y+=0.5; };
  if(flowTag) tag('storm','Overland flow path',flowTag.x,flowTag.y,flowTag.z);
  tag('esc','Sediment fence',-3,ground(-3,2.9)+0.15,2.9);
  tag('esc','Diversion drain',0.5,ground(0.5,-6.6),-6.6);
  tag('esc','Stabilised site entry',-9.5,RL(-9.5),fz(-9.5));
  tag('esc','Sediment basin',BAS.x,BAS.y,BAS.z);
  PV.parts.forEach(function(pt){
    tag('pave',pt.name,PV.x0+pt.side*1.2*Math.cos(PV.ang),PV.y0,PV.zc-pt.side*1.2*Math.sin(PV.ang));
    tags[tags.length-1].dyn=function(){ return PV.y0+pt.mesh.position.y+pt.th/2; };
  });
  tag('storm','Pits and pipes',-1.6,RL(-1.6),fz(-1.6)+0.5);
  tag('storm','Detention basin',BAS.x,BAS.y,BAS.z);
  tag('storm','Outlet to creek',7.4,natural(7.4,creekZ(7.4)-0.55)+0.1,creekZ(7.4)-0.55);
  tag('flood','Creek',-4.5,L1,creekZ(-4.5));
  tag('flood','Floor levels',pads[9].x,pads[9].y+0.6,pads[9].z);
  tag('sewer','Pump station',PS.x,ground(PS.x,PS.z)+0.3,PS.z);
  tag('sewer','Rising main',8.95,ground(8.95,-4.6),-4.6);
  tag('sewer','Water main',2.4,RL(2.4),fz(2.4)-0.68);
  tag('sewer','Gravity sewer',-5.5,RL(-5.5)-0.2,fz(-5.5)+0.74);

  /* ---- steps: camera, layer strengths, ground transparency ---- */
  var STEPS={
    overview:{cam:[0.62,1.03,24.5,0,-1.0,0.3],act:{land:0.42,roads:0.6},ter:1,spin:true},
    land:{cam:[0.34,0.80,21.5,-0.8,-0.6,-1.6],act:{land:1,roads:0.3},ter:1},
    cut:{cam:[0.5,0.74,20.5,-0.6,-0.6,-1.2],act:{cut:1,land:0.2,roads:0.3},ter:1},
    roads:{cam:[-0.5,1.08,16,-0.2,-0.2,-1.3],act:{roads:1,land:0.18},ter:1},
    pave:{cam:[-0.5,1.22,9.2,PV.x0,PV.y0+1.3,PV.zc],act:{pave:1,roads:0.9,land:0.1},ter:1},
    swept:{cam:[0.42,1.0,5.6,XC-1.0,0.3,ZC],act:{swept:1,roads:0.9,land:0.12},ter:1},
    storm:{cam:[0.95,0.96,17,3.0,-0.5,0.5],act:{storm:1,roads:0.4,land:0.08},ter:0.3},
    flood:{cam:[0.22,1.13,21.5,0,-0.9,2.0],act:{land:0.35,roads:0.4},ter:1},
    sewer:{cam:[1.38,0.9,19.5,3.6,-0.6,-1.3],act:{sewer:1,roads:0.4,land:0.08},ter:0.3},
    esc:{cam:[0.7,0.8,22,-0.5,-0.8,-0.6],act:{esc:1,land:0.3,roads:0.35},ter:1},
    all:{cam:[0.9,1.0,25,0,-1.0,0.3],act:{land:0.6,roads:0.85,storm:0.9,sewer:0.9},ter:0.5,spin:true}
  };
  var cur={th:0.62-0.9,ph:1.03,d:32.5,tx:0,ty:-1.0,tz:0.3}, goal={th:0.62,ph:1.03,d:32.5,tx:0,ty:-1.0,tz:0.3};
  var S={step:'overview',intro:reduce?1:0,terOp:1,terGoal:1,houseOp:1,flood:CREEK,floodGoal:CREEK,slider:L1,hold:false,W:0,H:0,fit:1};
  var hint=$('#hint');
  var orb=Orbit(canvas,cur,goal,function(){ S.hold=true; if(hint) hint.classList.add('gone'); });

  function setStep(name){
    var st=STEPS[name]; if(!st) return;
    S.step=name; S.hold=false;
    goal.th=cur.th+wrapPi(st.cam[0]-cur.th); goal.ph=st.cam[1]; goal.d=st.cam[2]; goal.tx=st.cam[3]; goal.ty=st.cam[4]; goal.tz=st.cam[5];
    for(var n in LAY) LAY[n].goal=st.act[n]||0;
    S.terGoal=st.ter;
    S.floodGoal=(name==='flood')?S.slider:CREEK;
    tags.forEach(function(t){ t.el.classList.toggle('on',t.step===name); });
  }
  function setFlood(level){ S.slider=level; if(S.step==='flood') S.floodGoal=level; }

  function resize(){
    var w=stage.clientWidth,h=stage.clientHeight; if(!w||!h) return;
    if(w===S.W&&h===S.H) return; S.W=w; S.H=h;
    renderer.setSize(w,h,false); camera.aspect=w/h; camera.updateProjectionMatrix(); S.fit=fitFor(w/h);
  }
  var v=V(0,0,0), tmp=V(0,0,0);
  function tick(dt,time){
    resize(); if(!S.W) return;
    var st=STEPS[S.step], kk=(reduce||S.paused)?1:1-Math.exp(-dt*3.2), n, Ly, q, it;
    if(S.paused) S.intro=1;
    if(S.intro<1) S.intro=Math.min(1,S.intro+dt/1.9);
    var e=easeOut(S.intro);
    world.scale.y=0.03+0.97*e; world.position.y=BASE*(1-world.scale.y);
    if(st.spin&&!S.hold&&!orb.active()&&!reduce&&!S.paused) goal.th+=dt*0.055;
    cur.th+=(goal.th-cur.th)*kk; cur.ph+=(goal.ph-cur.ph)*kk; cur.d+=(goal.d-cur.d)*kk;
    cur.tx+=(goal.tx-cur.tx)*kk; cur.ty+=(goal.ty-cur.ty)*kk; cur.tz+=(goal.tz-cur.tz)*kk;
    place(camera,cur,S.fit*(1+0.35*(1-e)));
    for(n in LAY){
      Ly=LAY[n]; Ly.cur+=(Ly.goal-Ly.cur)*kk;
      for(q=0;q<Ly.items.length;q++){ it=Ly.items[q]; it.m.opacity=lerp(it.d,it.h,Ly.cur); if(it.dc) it.m.color.copy(it.dc).lerp(it.hc,Ly.cur); }
      if(Ly.under) Ly.grp.visible=Ly.cur>0.012;
    }
    S.terOp+=(S.terGoal-S.terOp)*kk; terMat.opacity=S.terOp; roadMat.opacity=S.terOp;
    var cc=LAY.cut.cur<0.004?0:LAY.cut.cur;
    if(Math.abs(cc-cfApplied)>0.004||(cc===0&&cfApplied!==0)){
      for(q=0;q<col.length;q++) col[q]=colBase[q]+(colCF[q]-colBase[q])*cc;
      tg.attributes.color.needsUpdate=true; cfApplied=cc;
    }
    var pc=LAY.pave.cur, pe=pc*pc*(3-2*pc);
    for(q=0;q<PV.parts.length;q++) PV.parts[q].mesh.position.y=0.02+PV.parts[q].y*pe;
    if(LAY.swept.cur>0.02){
      var su=(time*0.05)%1, sf=smooth(0,0.05,su)*(1-smooth(0.95,1,su));
      SW.curve.getPointAt(su,SW.truck.position); SW.curve.getTangentAt(su,tmp); SW.truck.rotation.y=Math.atan2(-tmp.z,tmp.x);
      for(q=0;q<SW.mats.length;q++) SW.mats[q].opacity*=sf;
      if(S.step==='swept'&&!orb.active()){ goal.tx=SW.truck.position.x; goal.tz=SW.truck.position.z; }   // keep the truck in view
    }
    if(LAY.storm.cur>0.02) for(q=0;q<flowDots.length;q++) flowPaths[q](time*0.075+q*0.37,flowDots[q].position);
    var hg=S.terGoal<1?0.32:1; S.houseOp+=(hg-S.houseOp)*kk;
    bodyMat.opacity=roofMat.opacity=S.houseOp;
    fBody.opacity=fRoof.opacity=Math.min(S.houseOp,lerp(1,0.12,LAY.foot.cur));
    S.flood+=(S.floodGoal-S.flood)*(reduce?1:1-Math.exp(-dt*4.5)); water.position.y=S.flood; if(S.wtex) S.wtex.offset.x=time*0.012;
    if(LAY.storm.cur>0.02) for(q=0;q<stormDots.length;q++) stormPath(time*0.085+q/stormDots.length,stormDots[q].position);
    if(LAY.sewer.cur>0.02) for(q=0;q<riseDots.length;q++) risePath(time*0.11+q/riseDots.length,riseDots[q].position);
    renderer.render(scene,camera);
    for(q=0;q<tags.length;q++){
      var t=tags[q]; if(t.step!==S.step) continue;
      if(t.dyn) t.p.y=t.dyn();
      if(t.track) t.track(t.p);
      v.set(t.p.x,t.p.y*world.scale.y+world.position.y,t.p.z).project(camera);
      var sx=(v.x*0.5+0.5)*S.W, sy=(-v.y*0.5+0.5)*S.H;
      positionTags(tags,S.W,S.H,S.step,function(t){ if(t.dyn) t.p.y=t.dyn(); if(t.track) t.track(t.p); v.set(t.p.x,t.p.y*world.scale.y+world.position.y,t.p.z).project(camera); return {x:(v.x*.5+.5)*S.W,y:(-v.y*.5+.5)*S.H,z:v.z}; });
      break;
    }
  }
  /* ---- optional textures for this model ---- */
  if(SKINS[TEX]) (function(){
    var sk=SKINS[TEX], q, i, p, c0=new THREE.Color(), cG=new THREE.Color(), cE=new THREE.Color(), cS=new THREE.Color(), CUT=new THREE.Color(0xE0673A), FILL=new THREE.Color(0x57B88C);
    planarUV(tg,0.9,0.9,'xz');
    if(sk.grass[0]!=null){
      cG.setHex(sk.grass[0]); cE.setHex(sk.earth[0]); cS.setHex(sk.sand[0]);
      for(q=0;q<cnt;q++){
        var x=pos[q*3], z=pos[q*3+2], onPad=false, w=1-smooth(0.45,1.15,Math.abs(z-creekZ(x)));
        for(i=0;i<pads.length;i++){ p=pads[i]; if(Math.abs(x-p.x)<p.hw+0.12&&Math.abs(z-p.z)<p.hd+0.12){ onPad=true; break; } }
        c0.copy(onPad?cE:cG).multiplyScalar(0.9+0.2*rnd(q*1.37)); if(w>0) c0.lerp(cS,w);
        colBase[q*3]=c0.r; colBase[q*3+1]=c0.g; colBase[q*3+2]=c0.b;
      }
    } else { for(q=0;q<colBase.length;q++) colBase[q]=Math.min(1,colBase[q]*sk.grass[2]); CUT.multiplyScalar(sk.grass[2]); FILL.multiplyScalar(sk.grass[2]); }
    for(q=0;q<cnt;q++){
      var dd=hs[q]-natural(pos[q*3],pos[q*3+2]); c0.setRGB(colBase[q*3],colBase[q*3+1],colBase[q*3+2]);
      if(Math.abs(dd)>0.012) c0.lerp(dd>0?FILL:CUT,clamp(Math.abs(dd)/0.28,0.4,1)); else c0.multiplyScalar(0.72);
      colCF[q*3]=c0.r; colCF[q*3+1]=c0.g; colCF[q*3+2]=c0.b;
    }
    for(q=0;q<col.length;q++) col[q]=colBase[q]; tg.attributes.color.needsUpdate=true;
    terMat.map=texRep(sk.grass[1],1,1); terMat.needsUpdate=true;
    LAY.roads.grp.traverse(function(o){ if(o.isMesh&&o.geometry&&!o.geometry.attributes.uv) planarUV(o.geometry,1.6,1.6,'xz'); });
    LAY.roads.items.forEach(function(it){
      if(!it.dc||!it.m.isMeshStandardMaterial) return;
      var kind=(it.m===roadMat)?'road':'conc', k=sk[kind];
      if(k[0]!=null){ it.dc.setHex(k[0]).multiplyScalar(0.88); it.hc.setHex(k[0]).multiplyScalar(1.12); } else { it.dc.multiplyScalar(k[2]); it.hc.multiplyScalar(k[2]); }
      it.m.map=texRep(k[1],1,1); it.m.needsUpdate=true;
    });
    boxUV(bodyGeo,0.3);
    [bodyMat,fBody].forEach(function(m){ skinMat(m,'wall',1,1); }); [roofMat,fRoof].forEach(function(m){ skinMat(m,'roof',6,3); });
    if(sk.water){ water.material.color.setHex(sk.water[0]); water.material.map=texRep(sk.water[1],10,7); water.material.needsUpdate=true; S.wtex=water.material.map; }
    world.traverse(function(o){
      if(!o.isMesh) return;
      if(sk.tree&&o.geometry.type==='IcosahedronGeometry') o.material.color.setHex(sk.tree[0]);
      if(o.material.isMeshBasicMaterial&&o.material.vertexColors&&o.material.side===THREE.DoubleSide){
        var ca=o.geometry.attributes.color, st=sk.strata;
        planarUV(o.geometry,0.8,0.8,'wall');
        for(q=0;q<ca.count;q++) ca.setXYZ(q,Math.min(1,ca.getX(q)*st[0]),Math.min(1,ca.getY(q)*st[1]),Math.min(1,ca.getZ(q)*st[2]));
        ca.needsUpdate=true; o.material.map=texRep(st[3],1,1); o.material.needsUpdate=true;
      }
    });
    skinLights(scene);
  })();

  setStep('overview');
  return {el:stage,tick:tick,visible:true,setStep:setStep,setFlood:setFlood,state:S,reset:function(){setStep(S.step); for(var n in cur) cur[n]=goal[n]; S.hold=true; S.intro=1;},balance:{cut:sumCut,fill:sumFill}};
}

/* =====================================================================
   Scene 2: the footing model
   ===================================================================== */
function buildPier(){
  var wrap=$('#pierWrap'), canvas=$('#pier3d');
  var renderer=new THREE.WebGLRenderer({canvas:canvas,antialias:true,alpha:true});
  renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,3));
  var scene=new THREE.Scene(), camera=new THREE.PerspectiveCamera(30,1,0.3,200), g=new THREE.Group();
  scene.add(g);
  scene.add(new THREE.HemisphereLight(0xfff1d0,0x0b0b0a,0.62));
  var key=new THREE.DirectionalLight(0xffe6b8,0.72); key.position.set(-6,9,9); scene.add(key);
  var rim=new THREE.DirectionalLight(0x9fb6c4,0.3); rim.position.set(8,5,-8); scene.add(rim);
  scene.add(gridFloor(renderer,34,-3.43));
  var GOLD=0xC7A256, XW=9.2, ZB=-3.0, ZCUT=1.42, ZF=3.0, ROW=1.8, SOIL=-0.3, ROCK=-1.6, BOT=-3.4;
  var P={L:2.1,D:0.45,nx:6,cut:true,reo:false,view:'orbit'};
  var frontG=new THREE.Group(), frontMats=[]; g.add(frontG);
  function slab(y0,y1,z0,z1,colr,parent,front){
    var m=new THREE.MeshStandardMaterial({color:colr,roughness:1});
    var mesh=new THREE.Mesh(new THREE.BoxGeometry(XW,y0-y1,z1-z0),m); mesh.position.set(0,(y0+y1)/2,(z0+z1)/2); parent.add(mesh);
    var em=new THREE.LineBasicMaterial({color:GOLD,transparent:true,opacity:0.4});
    var ed=new THREE.LineSegments(new THREE.EdgesGeometry(mesh.geometry),em); ed.position.copy(mesh.position); parent.add(ed);
    if(front){ m.transparent=true; frontMats.push({m:m,o:1},{m:em,o:0.4}); }
  }
  [[0,SOIL,0x4a4334],[SOIL,ROCK,0x6a5b3f],[ROCK,BOT,0x2c2b28]].forEach(function(s){
    slab(s[0],s[1],ZB,ZCUT,s[2],g,false); slab(s[0],s[1],ZCUT,ZF,s[2],frontG,true);
  });
  // bearers, floor frame and a ghost of the dwelling above
  var steel=new THREE.MeshStandardMaterial({color:0x7d776a,roughness:0.6,metalness:0.3});
  [-ROW,0,ROW].forEach(function(z){ var b=new THREE.Mesh(new THREE.BoxGeometry(8.2,0.2,0.12),steel); b.position.set(0,0.27,z); g.add(b); });
  var fl=new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(8.4,0.12,4.4)),new THREE.LineBasicMaterial({color:GOLD})); fl.position.y=0.43; g.add(fl);
  var gh=new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(8.4,2.5,4.4)),new THREE.LineBasicMaterial({color:GOLD,transparent:true,opacity:0.28})); gh.position.y=0.49+1.25; g.add(gh);

  var pierMat=new THREE.MeshStandardMaterial({color:0x9a9587,roughness:0.9});
  var frontMat=new THREE.MeshStandardMaterial({color:0x9a9587,roughness:0.9,transparent:true,opacity:1});
  var barMat=new THREE.MeshStandardMaterial({color:0xD9B15F,roughness:0.45,metalness:0.5});
  var piersG=new THREE.Group(), cageG=new THREE.Group(), dimG=new THREE.Group(); g.add(piersG); g.add(cageG); g.add(dimG);
  var dimMat=new THREE.LineBasicMaterial({color:0xF2F0EA});
  function clear(grp){ while(grp.children.length){ var c=grp.children.pop(); if(c.geometry) c.geometry.dispose(); } }
  function rebuild(){
    clear(piersG); clear(cageG); clear(dimG);
    var xs=[],i,r=P.D/2,Lt=P.L+0.15,k,y;
    for(i=0;i<P.nx;i++) xs.push(lerp(-3.6,3.6,i/(P.nx-1)));
    [-ROW,0,ROW].forEach(function(z){ xs.forEach(function(x){
      var m=new THREE.Mesh(new THREE.CylinderGeometry(r,r,Lt,28),z===ROW?frontMat:pierMat); m.position.set(x,0.15-Lt/2,z); m.renderOrder=3; piersG.add(m);
    }); });
    var rc=r-0.075, barL=P.L+0.05;
    xs.forEach(function(x){
      for(k=0;k<6;k++){ var a=k*Math.PI/3, bar=new THREE.Mesh(new THREE.CylinderGeometry(0.014,0.014,barL,6),barMat); bar.position.set(x+rc*Math.cos(a),0.1-barL/2,ROW+rc*Math.sin(a)); cageG.add(bar); }
      for(y=0.0;y>-(P.L-0.1);y-=0.3){ var lig=new THREE.Mesh(new THREE.TorusGeometry(rc+0.016,0.009,6,24),barMat); lig.rotation.x=Math.PI/2; lig.position.set(x,y,ROW); cageG.add(lig); }
    });
    var dxp=xs[0]-r-0.32, pts=[dxp,0,ROW,dxp,-P.L,ROW, dxp-0.12,0,ROW,dxp+0.12,0,ROW, dxp-0.12,-P.L,ROW,dxp+0.12,-P.L,ROW];
    var dg=new THREE.BufferGeometry(); dg.setAttribute('position',new THREE.Float32BufferAttribute(pts,3)); dimG.add(new THREE.LineSegments(dg,dimMat));
    cageG.visible=P.reo; frontMat.opacity=P.reo?0.22:1; frontMat.depthWrite=!P.reo;
  }
  var VIEWS={orbit:[0.6,1.2,17.5,0,-0.85,0.5],side:[0,1.5,15.5,0,-1.0,0],plan:[0,0.03,18,0,0,0]};
  var cur={th:0.6-0.7,ph:1.2,d:17.5,tx:0,ty:-0.85,tz:0.5}, goal={th:0.6,ph:1.2,d:17.5,tx:0,ty:-0.85,tz:0.5};
  var S={W:0,H:0,fit:1,front:1,hold:false};
  var orb=Orbit(canvas,cur,goal,function(){S.hold=true;});
  function setView(name){
    var vw=VIEWS[name]; P.view=name; S.hold=(name!=='orbit');
    goal.th=cur.th+wrapPi(vw[0]-cur.th); goal.ph=vw[1]; goal.d=vw[2]; goal.tx=vw[3]; goal.ty=vw[4]; goal.tz=vw[5];
    $$('[data-view]').forEach(function(b){ b.setAttribute('aria-pressed',b.getAttribute('data-view')===name?'true':'false'); });
  }
  function resize(){
    var w=wrap.clientWidth,h=wrap.clientHeight; if(!w||!h||(w===S.W&&h===S.H)) return; S.W=w; S.H=h;
    renderer.setSize(w,h,false); camera.aspect=w/h; camera.updateProjectionMatrix(); S.fit=w/h<1.3?Math.pow(1.3/(w/h),0.9):1;
  }
  function tick(dt){
    resize(); if(!S.W) return;
    var kk=reduce?1:1-Math.exp(-dt*3.4),q;
    if(P.view==='orbit'&&!S.hold&&!orb.active()&&!reduce&&!S.paused) goal.th+=dt*0.05;
    cur.th+=(goal.th-cur.th)*kk; cur.ph+=(goal.ph-cur.ph)*kk; cur.d+=(goal.d-cur.d)*kk;
    cur.tx+=(goal.tx-cur.tx)*kk; cur.ty+=(goal.ty-cur.ty)*kk; cur.tz+=(goal.tz-cur.tz)*kk;
    place(camera,cur,S.fit);
    var fg=P.cut?0:1; S.front+=(fg-S.front)*kk;
    frontG.visible=S.front>0.02; frontG.position.z=(1-S.front)*2.2;
    for(q=0;q<frontMats.length;q++) frontMats[q].m.opacity=frontMats[q].o*S.front;
    renderer.render(scene,camera);
  }
  // controls
  $$('[data-view]').forEach(function(b){ b.addEventListener('click',function(){ setView(b.getAttribute('data-view')); }); });
  var tCut=$('#tCut'), tReo=$('#tReo');
  tCut.addEventListener('click',function(){ P.cut=!P.cut; tCut.setAttribute('aria-pressed',P.cut?'true':'false'); });
  tReo.addEventListener('click',function(){ P.reo=!P.reo; tReo.setAttribute('aria-pressed',P.reo?'true':'false'); if(P.reo&&!P.cut){ P.cut=true; tCut.setAttribute('aria-pressed','true'); } rebuild(); });
  S.front=0; rebuild();
  return {el:wrap,tick:tick,visible:false};
}

/* =====================================================================
   Boot the 3D, then wire the page
   ===================================================================== */

/* =====================================================================
   Optional surface textures. Off unless a style is chosen (window.JCE_TEX or #tex=name).
   Every texture is drawn in the browser, so nothing extra is downloaded.
   ===================================================================== */
var TEX=(function(){ var m=/[#&?]tex=(\w+)/.exec(String(window.location.hash)+String(window.location.search)); return m?m[1]:(window.JCE_TEX||'hatch'); })();
var TXC={};
function rng(seed){ var s=seed>>>0; return function(){ s=(Math.imul(s,1664525)+1013904223)>>>0; return s/4294967296; }; }
function grey(v){ v=Math.round(clamp(v,0,255)); return 'rgb('+v+','+v+','+v+')'; }
function cTex(key,size,draw){
  if(!TXC[key]){ var c=d.createElement('canvas'); c.width=c.height=size; draw(c.getContext('2d'),size); var t=new THREE.CanvasTexture(c); t.wrapS=t.wrapT=THREE.RepeatWrapping; t.anisotropy=8; TXC[key]=t; }
  return TXC[key];
}
function texOf(name){
  switch(name){
    case 'speck': return cTex(name,256,function(x,S){ var r=rng(11),i; x.fillStyle=grey(232); x.fillRect(0,0,S,S); for(i=0;i<2600;i++){ x.fillStyle=grey(232+(r()-0.55)*70); x.fillRect(r()*S,r()*S,1+r()*2.2,1+r()*2.2); } });
    case 'grass': return cTex(name,256,function(x,S){ var r=rng(23),i,px,py; x.fillStyle=grey(226); x.fillRect(0,0,S,S); for(i=0;i<3600;i++){ x.strokeStyle=grey(226+(r()-0.62)*100); px=r()*S; py=r()*S; x.beginPath(); x.moveTo(px,py); x.lineTo(px+(r()-0.5)*5,py-2-r()*5); x.stroke(); } });
    case 'asph': return cTex(name,256,function(x,S){ var r=rng(37),i; x.fillStyle=grey(228); x.fillRect(0,0,S,S); for(i=0;i<5200;i++){ x.fillStyle=grey(228+(r()-0.5)*90); x.fillRect(r()*S,r()*S,1.2,1.2); } });
    case 'board': return cTex(name,128,function(x,S){ x.fillStyle=grey(246); x.fillRect(0,0,S,S); x.fillStyle=grey(172); for(var p=0;p<S;p+=16) x.fillRect(0,p,S,2); });
    case 'brick': return cTex(name,128,function(x,S){ x.fillStyle=grey(240); x.fillRect(0,0,S,S); x.fillStyle=grey(165); var row=0,y,xx; for(y=0;y<S;y+=16){ x.fillRect(0,y,S,2); for(xx=(row%2?16:0);xx<S;xx+=32) x.fillRect(xx,y,2,16); row++; } });
    case 'tile': return cTex(name,128,function(x,S){ x.fillStyle=grey(242); x.fillRect(0,0,S,S); x.fillStyle=grey(150); var row=0,y,xx; for(y=0;y<S;y+=16){ x.fillRect(0,y,S,3); for(xx=(row%2?8:0);xx<S;xx+=16) x.fillRect(xx,y,1.5,16); row++; } });
    case 'rib': return cTex(name,128,function(x,S){ x.fillStyle=grey(244); x.fillRect(0,0,S,S); x.fillStyle=grey(176); for(var p=0;p<S;p+=12) x.fillRect(p,0,3,S); });
    case 'ripple': return cTex(name,128,function(x,S){ x.fillStyle=grey(232); x.fillRect(0,0,S,S); x.strokeStyle=grey(255); x.lineWidth=1.5; for(var p=6;p<S;p+=16){ x.beginPath(); for(var q=0;q<=S;q+=8) x.lineTo(q,p+3*Math.sin(q*0.196+p)); x.stroke(); } });
    case 'stipI': return cTex(name,256,function(x,S){ var r=rng(51),i; x.fillStyle=grey(86); x.fillRect(0,0,S,S); x.fillStyle=grey(255); for(i=0;i<1000;i++) x.fillRect(r()*S,r()*S,1.5,1.5); });
    case 'hatchI': return cTex(name,128,function(x,S){ x.fillStyle=grey(98); x.fillRect(0,0,S,S); x.strokeStyle=grey(255); x.lineWidth=1.4; for(var p=-S;p<S*2;p+=16){ x.beginPath(); x.moveTo(p,0); x.lineTo(p+S,S); x.stroke(); } });
    case 'ribI': return cTex(name,128,function(x,S){ x.fillStyle=grey(124); x.fillRect(0,0,S,S); x.fillStyle=grey(255); for(var p=0;p<S;p+=12) x.fillRect(p,0,1.7,S); });
    case 'boardI': return cTex(name,128,function(x,S){ x.fillStyle=grey(150); x.fillRect(0,0,S,S); x.fillStyle=grey(255); for(var p=0;p<S;p+=16) x.fillRect(0,p,S,1.7); });
  }
  return null;
}
function texRep(name,rx,ry){ var t=texOf(name).clone(); t.needsUpdate=true; t.repeat.set(rx,ry); return t; }
/* per style: kind -> [colour or null, texture, colour multiplier]; strata -> [r,g,b multipliers, texture] */
var SKINS={
  natural:{hemi:[0.72,0xffffff,0x55554c],key:[0.62,0xfff6e4],grass:[0x668846,'grass'],earth:[0xa88c5e,'speck'],sand:[0xbba57c,'speck'],road:[0x4b4c50,'asph'],conc:[0xb4b1a8,'speck'],wall:[0xd5cebc,'board'],wall2:[0xa87458,'brick'],roof:[0x98573f,'tile'],roof2:[0x6f7780,'rib'],metal:[0xa7aaad,'rib'],water:[0x3f8fc4,'ripple'],tree:[0x4a7338],strata:[1.8,1.45,1.1,'speck']},
  sepia:{hemi:[0.7,0xfff1d0,0x2a2620],key:[0.66,0xffe2a8],grass:[0x716e44,'grass'],earth:[0xa89060,'speck'],sand:[0xbba57a,'speck'],road:[0x403c36,'asph'],conc:[0xb3a98f,'speck'],wall:[0xcbbc98,'board'],wall2:[0xa99570,'brick'],roof:[0x5a4b36,'tile'],roof2:[0x6e6554,'rib'],metal:[0x9a9079,'rib'],water:[0x3a86ab,'ripple'],tree:[0x535f3a],strata:[1.5,1.35,1.05,'speck']},
  clay:{hemi:[0.66,0xffffff,0x55524b],key:[0.6,0xfff4e0],grass:[0xb9b4a7,'speck'],earth:[0xa9a394,'speck'],sand:[0xc4beb0,'speck'],road:[0x75726b,'asph'],conc:[0xcbc6ba,'speck'],wall:[0xe0dbd0,'board'],wall2:[0xd2cdc1,'board'],roof:[0x97917f,'rib'],roof2:[0x8d887c,'rib'],metal:[0xb5b0a5,'rib'],water:[0x7fa9bd,'ripple'],tree:[0x8f9c80],strata:[2.4,2.3,2.1,'speck']},
  blueprint:{hemi:[0.9,0xdfeaff,0x0a1830],key:[0.7,0xffffff],grass:[0x2f66b0,'stipI'],earth:[0x3a74c0,'stipI'],sand:[0x4a86d0,'stipI'],road:[0x244f8c,'stipI'],conc:[0x4a86d0,'stipI'],wall:[0x8fbdf0,'boardI'],wall2:[0x8fbdf0,'boardI'],roof:[0x6fa3e0,'ribI'],roof2:[0x6fa3e0,'ribI'],metal:[0x8fbdf0,'ribI'],water:[0xbfe2ff,'ripple'],tree:[0x5d94d6],strata:[1.0,2.2,4.2,'hatchI']},
  hatch:{grass:[null,'stipI',2.6],earth:[null,'stipI',2.6],sand:[null,'stipI',2.6],road:[null,'stipI',2.3],conc:[null,'stipI',1.6],wall:[null,'boardI',1.5],wall2:[null,'boardI',1.5],roof:[null,'ribI',1.9],roof2:[null,'ribI',1.9],metal:[null,'ribI',1.7],strata:[2.4,2.4,2.4,'hatchI']}
};
function skinMat(mat,kind,rx,ry){
  var sk=SKINS[TEX], k=sk&&sk[kind]; if(!k||!mat) return;
  if(k[0]!=null) mat.color.setHex(k[0]); if(k[2]) mat.color.multiplyScalar(k[2]);
  if(k[1]) mat.map=texRep(k[1],rx||1,ry||1); mat.needsUpdate=true;
}
function planarUV(g,sx,sy,mode){
  var p=g.attributes.position, uv=new Float32Array(p.count*2), i;
  for(i=0;i<p.count;i++){ if(mode==='wall'){ uv[i*2]=(p.getX(i)+p.getZ(i))*sx; uv[i*2+1]=p.getY(i)*sy; } else { uv[i*2]=p.getX(i)*sx; uv[i*2+1]=p.getZ(i)*sy; } }
  g.setAttribute('uv',new THREE.BufferAttribute(uv,2));
}
function boxUV(g,tile){            // scale a box's UVs so one texture repeat covers the same real size on every face
  var pr=g.parameters, uv=g.attributes.uv, dims=[[pr.depth,pr.height],[pr.depth,pr.height],[pr.width,pr.depth],[pr.width,pr.depth],[pr.width,pr.height],[pr.width,pr.height]], f, i;
  for(f=0;f<6;f++) for(i=0;i<4;i++){ var n=f*4+i; uv.setXY(n,uv.getX(n)*dims[f][0]/tile,uv.getY(n)*dims[f][1]/tile); }
  uv.needsUpdate=true;
}
function skinLights(scene){
  var sk=SKINS[TEX], firstKey=true; if(!sk||!sk.hemi) return;
  scene.children.forEach(function(o){
    if(o.isHemisphereLight){ o.intensity=sk.hemi[0]; o.color.setHex(sk.hemi[1]); o.groundColor.setHex(sk.hemi[2]); }
    else if(o.isDirectionalLight&&firstKey){ firstKey=false; o.intensity=sk.key[0]; o.color.setHex(sk.key[1]); }
  });
}
function skinViewer(vw,kinds){
  var sk=SKINS[TEX], done=[]; if(!sk) return;
  var TILE={grass:7,road:5,conc:4,wall:3,wall2:2.4,roof:2.2,roof2:2,metal:2};
  vw.world.traverse(function(o){
    if(!o.isMesh||!o.material||!o.material.userData||o.material.userData.hex==null) return;
    var kind=kinds[o.material.userData.hex], g=o.geometry; if(!kind) return;
    if(!g.userData.uvDone){ g.userData.uvDone=1; if(g.type==='BoxGeometry') boxUV(g,TILE[kind]||4); else if(!g.attributes.uv) planarUV(g,1/(TILE[kind]||4),1/(TILE[kind]||4),'xz'); }
    if(done.indexOf(o.material)<0){ done.push(o.material); skinMat(o.material,kind,1,1); }
  });
  skinLights(vw.scene);
}

/* =====================================================================
   Shared pieces for the smaller models: a detailed truck, a hip roof, simple builders
   ===================================================================== */
function makeTruck(mk,kind){       // about 9.6 m long, nose toward +x, wheels on y=0; kind: 'waste' or 'delivery'
  var g=new THREE.Group(), cream=mk(0xece5d0), dark=mk(0x1a1a18), gold=mk(0xC7A256), glass=mk(0x27313a), steel=mk(0x8d8a80), lamp=mk(0xfff0b8), red=mk(0xb5392c);
  function b(w,h,dp,m,x,y,z,rz){ var me=new THREE.Mesh(new THREE.BoxGeometry(w,h,dp),m); me.position.set(x,y,z); if(rz) me.rotation.z=rz; me.renderOrder=4; g.add(me); return me; }
  function c(r,len,m,x,y,z,axis){ var me=new THREE.Mesh(new THREE.CylinderGeometry(r,r,len,28),m); if(axis==='z') me.rotation.x=Math.PI/2; me.position.set(x,y,z); me.renderOrder=4; g.add(me); return me; }
  // chassis rails, fuel tank, steps
  b(8.9,0.3,0.9,dark,-0.05,0.9,0); b(1.2,0.55,0.5,steel,1.2,0.8,1.0); b(1.2,0.55,0.5,steel,1.2,0.8,-1.0); b(0.7,0.12,0.5,steel,2.6,0.6,1.2); b(0.7,0.12,0.5,steel,2.6,0.6,-1.2);
  // cab: lower body, upper cabin, raked windscreen, side glass, roof, grille, lights, mirrors
  b(2.15,1.25,2.46,cream,3.42,1.65,0);
  b(1.75,1.15,2.4,cream,3.22,2.85,0);
  b(0.08,1.12,2.2,glass,4.22,2.82,0,-0.2);
  b(1.2,0.78,2.46,glass,3.3,2.92,0);
  b(1.9,0.1,2.46,cream,3.22,3.46,0);
  b(0.08,0.55,1.7,dark,4.52,1.6,0); b(0.34,0.42,2.5,dark,4.5,1.02,0);
  b(0.06,0.2,0.36,lamp,4.56,1.36,0.92); b(0.06,0.2,0.36,lamp,4.56,1.36,-0.92);
  b(0.1,0.42,0.06,dark,4.18,2.9,1.42); b(0.1,0.42,0.06,dark,4.18,2.9,-1.42); b(0.3,0.05,0.22,dark,4.12,3.02,1.32); b(0.3,0.05,0.22,dark,4.12,3.02,-1.32);
  c(0.07,1.9,steel,2.2,3.0,1.05,'y');                                   // exhaust stack
  if(kind==='delivery'){
    b(6.6,2.75,2.5,cream,-1.15,2.48,0); b(6.62,0.3,2.52,gold,-1.15,1.75,0);
    b(0.06,2.4,2.2,steel,-4.46,2.45,0); b(0.08,0.06,2.3,dark,-4.47,3.1,0); b(0.08,0.06,2.3,dark,-4.47,2.45,0); b(0.08,0.06,2.3,dark,-4.47,1.8,0);
  } else {
    b(0.3,0.16,0.3,mk(0xE9A23B),3.2,3.59,0);                              // beacon
    b(5.3,2.55,2.5,cream,-0.55,2.4,0); b(5.32,0.3,2.52,gold,-0.55,1.75,0);
    [-2.6,-1.3,0.0,1.3].forEach(function(px){ b(0.1,2.3,2.56,steel,px,2.45,0); });          // body ribs
    b(5.0,0.1,1.6,steel,-0.55,3.72,0);
    b(1.5,2.2,2.5,cream,-3.9,2.15,0); b(1.2,1.5,2.52,steel,-4.35,2.75,0,0.5);            // hopper and raked tailgate
    b(0.9,0.5,2.2,dark,-4.3,1.2,0);
    b(0.12,1.7,0.12,dark,0.6,1.75,1.36,0.25); b(0.12,1.7,0.12,dark,-0.4,1.75,1.36,0.25); b(1.3,0.12,0.12,dark,0.1,1.0,1.42);    // side lifter arms
    var bin=mk(0x3f5d3c); b(0.75,1.0,0.6,bin,0.1,1.25,1.72); b(0.8,0.1,0.66,bin,0.1,1.8,1.72);
  }
  b(0.06,0.22,0.3,red,-4.72,1.25,0.95); b(0.06,0.22,0.3,red,-4.72,1.25,-0.95);
  // wheels with hubs, and guards over the rear axles
  [[3.3,1.08],[3.3,-1.08],[-1.75,1.08],[-1.75,-1.08],[-3.05,1.08],[-3.05,-1.08]].forEach(function(p){
    c(0.54,0.4,dark,p[0],0.54,p[1],'z'); c(0.24,0.44,steel,p[0],0.54,p[1],'z');
  });
  b(2.9,0.08,0.5,dark,-2.4,1.18,1.08); b(2.9,0.08,0.5,dark,-2.4,1.18,-1.08);
  return g;
}
function hipRoof(w,dp,h){          // ridge along x; w is the longer side
  var hw=w/2, hd=dp/2, r=Math.max(0,(w-dp)/2), g=new THREE.BufferGeometry();
  g.setAttribute('position',new THREE.Float32BufferAttribute([-hw,0,-hd, hw,0,-hd, hw,0,hd, -hw,0,hd, -r,h,0, r,h,0],3));
  g.setIndex([0,4,5, 0,5,1, 1,5,2, 2,5,4, 2,4,3, 3,4,0]);
  g=g.toNonIndexed(); g.computeVertexNormals(); return g;
}
function bx(parent,w,h,dp,m,x,y,z,ord){ var me=new THREE.Mesh(new THREE.BoxGeometry(w,h,dp),m); me.position.set(x,y,z); if(ord!=null) me.renderOrder=ord; parent.add(me); return me; }
function edg(parent,mesh,m,ord){ var e=new THREE.LineSegments(new THREE.EdgesGeometry(mesh.geometry),m); e.position.copy(mesh.position); e.rotation.copy(mesh.rotation); e.scale.copy(mesh.scale); e.renderOrder=(ord==null?3:ord); parent.add(e); return e; }
function tb(parent,a,b,r,m,ord){
  var dir=new THREE.Vector3().subVectors(b,a), len=dir.length(), me=new THREE.Mesh(new THREE.CylinderGeometry(r,r,len,10),m);
  me.position.copy(a).addScaledVector(dir,0.5); me.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),dir.normalize());
  if(ord!=null) me.renderOrder=ord; parent.add(me); return me;
}
function ln(parent,arr,m,ord){ var g=new THREE.BufferGeometry(); g.setAttribute('position',new THREE.Float32BufferAttribute(arr,3)); var l=new THREE.LineSegments(g,m); l.renderOrder=(ord==null?3:ord); parent.add(l); return l; }
function pathFn(pts){
  var acc=[0],i; for(i=1;i<pts.length;i++) acc.push(acc[i-1]+pts[i].distanceTo(pts[i-1]));
  var total=acc[acc.length-1];
  return function(t,out){ var s=((t%1)+1)%1*total, k=1; while(k<acc.length-1&&acc[k]<s) k++; var u=(s-acc[k-1])/Math.max(1e-6,acc[k]-acc[k-1]); return out.copy(pts[k-1]).lerp(pts[k],u); };
}
function pipeRun(parent,pts,r,m){ for(var i=0;i<pts.length-1;i++) tb(parent,pts[i],pts[i+1],r,m,0); }

/* ---------- a compact viewer: layers that light up, labels pinned to the model, drag to turn ---------- */
function Viewer(wrap,canvas){
  var renderer=new THREE.WebGLRenderer({canvas:canvas,antialias:true,alpha:true});
  renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,3));
  var scene=new THREE.Scene(), camera=new THREE.PerspectiveCamera(32,1,1,900), world=new THREE.Group(); scene.add(world);
  scene.add(new THREE.HemisphereLight(0xfff1d0,0x0b0b0a,0.74));
  var key=new THREE.DirectionalLight(0xffe2a8,0.8); key.position.set(-9,11,8); scene.add(key);
  var rim=new THREE.DirectionalLight(0x9fb6c4,0.3); rim.position.set(10,6,-9); scene.add(rim);
  function V(x,y,z){return new THREE.Vector3(x,y,z);}
  var LAY={}, FG={}, tags=[], STEPS={}, hooks=[], S={step:'',W:0,H:0,fit:1,hold:false};
  var cur={th:0,ph:1,d:60,tx:0,ty:0,tz:0}, goal={th:0,ph:1,d:60,tx:0,ty:0,tz:0}, first=true;
  var tagsEl=wrap.querySelector('.tags');
  function layer(n,hide){ if(!LAY[n]){ LAY[n]={cur:0,goal:0,items:[],grp:new THREE.Group(),hide:!!hide}; world.add(LAY[n].grp); } return LAY[n].grp; }
  function reg(n,mat,dOp,hOp,dCol,hCol){ layer(n); mat.transparent=true; mat.opacity=dOp; LAY[n].items.push({m:mat,d:dOp,h:hOp,dc:dCol!=null?new THREE.Color(dCol):null,hc:hCol!=null?new THREE.Color(hCol):null}); return mat; }
  function fg(n,mat){ if(!FG[n]) FG[n]={mats:[],cur:1,goal:1}; mat.transparent=true; FG[n].mats.push(mat); return mat; }
  function tag(step,text,x,y,z){ var el=d.createElement('span'); el.className='tag'; el.textContent=text; tagsEl.appendChild(el); var t={step:step,el:el,p:V(x,y,z)}; tags.push(t); return t; }
  function setStep(name){
    var st=STEPS[name], n; if(!st) return; S.step=name; S.hold=false;
    goal.ph=st.cam[1]; goal.d=st.cam[2]; goal.tx=st.cam[3]; goal.ty=st.cam[4]; goal.tz=st.cam[5];
    if(first){ first=false; goal.th=st.cam[0]; for(n in goal) cur[n]=goal[n]; cur.th=goal.th-0.5; } else goal.th=cur.th+wrapPi(st.cam[0]-cur.th);
    for(n in LAY) LAY[n].goal=(st.act&&st.act[n])||0;
    for(n in FG) FG[n].goal=(st.fade&&st.fade[n]!=null)?st.fade[n]:1;
    tags.forEach(function(t){ t.el.classList.toggle('on',t.step===name); });
  }
  var orb=Orbit(canvas,cur,goal,function(){S.hold=true;}), v=V(0,0,0);
  function tick(dt,time){
    var w=wrap.clientWidth,h=wrap.clientHeight; if(!w||!h) return;
    if(w!==S.W||h!==S.H){ S.W=w; S.H=h; renderer.setSize(w,h,false); camera.aspect=w/h; camera.updateProjectionMatrix(); S.fit=(w/h)<1.25?Math.pow(1.25/(w/h),0.85):1; }
    var st=STEPS[S.step]||{}, kk=(reduce||S.paused)?1:1-Math.exp(-dt*3.2), n,q,it,Ly,f;
    if(st.spin&&!S.hold&&!orb.active()&&!reduce&&!S.paused) goal.th+=dt*0.06;
    for(n in cur) cur[n]+=(goal[n]-cur[n])*kk;
    place(camera,cur,S.fit);
    for(n in LAY){ Ly=LAY[n]; Ly.cur+=(Ly.goal-Ly.cur)*kk; for(q=0;q<Ly.items.length;q++){ it=Ly.items[q]; it.m.opacity=lerp(it.d,it.h,Ly.cur); if(it.dc) it.m.color.copy(it.dc).lerp(it.hc,Ly.cur); } if(Ly.hide) Ly.grp.visible=Ly.cur>0.012; }
    for(n in FG){ f=FG[n]; f.cur+=(f.goal-f.cur)*kk; for(q=0;q<f.mats.length;q++) f.mats[q].opacity=f.cur; }
    for(q=0;q<hooks.length;q++) hooks[q](dt,time,LAY,S);
    renderer.render(scene,camera);
    for(q=0;q<tags.length;q++){
      var t=tags[q]; if(t.step!==S.step) continue; if(t.track) t.track(t.p);
      v.copy(t.p).project(camera);
      positionTags(tags,S.W,S.H,S.step,function(t){ if(t.track) t.track(t.p); v.copy(t.p).project(camera); return {x:(v.x*.5+.5)*S.W,y:(-v.y*.5+.5)*S.H,z:v.z}; });
      break;
    }
  }
  scene.add(gridFloor(renderer,260,-3.4));
  return {el:wrap,visible:false,tick:tick,scene:scene,world:world,layer:layer,reg:reg,fg:fg,tag:tag,setStep:setStep,STEPS:STEPS,hooks:hooks,V:V,goal:goal,state:S,reset:function(){setStep(S.step);for(var n in cur) cur[n]=goal[n];S.hold=true;}};
}
function initMV(el,builder){
  var stage=el.querySelector('.mv-stage'), vw=Viewer(stage,el.querySelector('canvas'));
  builder(vw);
  var chips=$$('.seg[data-mv]',el), arts=$$('.mv-text article',el);
  function pick(name){
    chips.forEach(function(c){ c.setAttribute('aria-pressed',c.getAttribute('data-mv')===name?'true':'false'); });
    arts.forEach(function(a){ a.hidden=a.getAttribute('data-for')!==name; });
    vw.setStep(name);
  }
  chips.forEach(function(c){ c.addEventListener('click',function(){ pick(c.getAttribute('data-mv')); }); });
  pick('overview');
  return vw;
}

/* =====================================================================
   A house block: new dwelling, extension and granny flat
   ===================================================================== */
function buildHouse(vw){
  var V=vw.V, W=vw.world, GOLD=0xC7A256, PALE=0xF3DFA6, PIPE=0xE2BE6A;
  function M(c,o){ var p={color:c,roughness:0.92},k,m; if(o) for(k in o) p[k]=o[k]; m=new THREE.MeshStandardMaterial(p); m.userData.hex=c; return m; }
  var gm=vw.fg('ground',M(0x2b2925)), rd=vw.fg('ground',M(0x1a1a18)), fp=vw.fg('ground',M(0x4a473f)), kb=M(0x8e8a80);
  var g1=bx(W,20,2.6,35,gm,0,-1.3,9,1), g2=bx(W,20,3.3,9.5,gm,0,-0.95,-13.25,1);
  var eg=new THREE.LineBasicMaterial({color:GOLD,transparent:true,opacity:0.5}); edg(W,g1,eg,2); edg(W,g2,eg,2);
  bx(W,20,0.05,5.4,rd,0,0.03,23.8,2); bx(W,20,0.16,0.3,kb,0,0.08,20.95,2); bx(W,20,0.04,1.3,fp,0,0.03,19,2);
  ln(W,[-9,0.06,17,9,0.06,17, -9,0.06,17,-9,0.06,-8.5, 9,0.06,17,9,0.06,-8.5, -9,0.76,-8.5,-9,0.76,-17, 9,0.76,-8.5,9,0.76,-17, -9,0.76,-17,9,0.76,-17],
     new THREE.LineBasicMaterial({color:GOLD,transparent:true,opacity:0.85}),3);
  var wall=bx(W,18,1.0,0.28,M(0xcfc8b4),0,0.4,-8.5,2);

  var slabM=M(0x8f8a7d), wallsM=vw.fg('bldg',M(0xb9b2a0)), extM=vw.fg('bldg',M(0xddd5bf)), roofM=vw.fg('bldg',M(0x5f5a4e,{side:THREE.DoubleSide,flatShading:true})), slabs=[];
  function building(cx,cz,w,dp,base,hgt,roofH,wm){
    slabs.push(bx(W,w+0.5,0.3,dp+0.5,slabM,cx,base+0.15,cz,2));
    bx(W,w,hgt,dp,wm,cx,base+0.3+hgt/2,cz,2);
    if(!roofH){ bx(W,w+0.6,0.16,dp+0.6,roofM,cx,base+0.3+hgt+0.08,cz,2); return; }
    var long=w>=dp, r=new THREE.Mesh(hipRoof(long?w+1:dp+1,long?dp+1:w+1,roofH),roofM);
    if(!long) r.rotation.y=Math.PI/2; r.position.set(cx,base+0.3+hgt,cz); r.renderOrder=2; W.add(r);
  }
  building(-1.5,4,11,12,0,2.6,1.7,wallsM);        // new dwelling
  building(-2,-4.2,6,4,0,2.5,0,extM);             // extension
  building(2.5,-13.2,8,6.5,0.7,2.5,1.3,wallsM);   // granny flat on the upper level

  // driveway, crossover, carport and car
  var dvM=vw.fg('ground',M(0x55524a)), carM=M(0x8d8778);
  bx(W,3.2,0.06,11.2,dvM,6.6,0.04,11.4,2); bx(W,3.8,0.07,3.9,dvM,6.6,0.045,18.95,2);
  [[5.1,0.6],[8.1,0.6],[5.1,5.6],[8.1,5.6]].forEach(function(p){ bx(W,0.12,2.4,0.12,kb,p[0],1.2,p[1],2); });
  bx(W,3.5,0.12,5.6,roofM,6.6,2.46,3.1,2);
  bx(W,1.8,0.7,4.2,carM,6.6,0.62,3.2,2); bx(W,1.6,0.55,2.2,carM,6.6,1.22,3.0,2);
  var tankM=M(0x9b968a), rt=new THREE.Mesh(new THREE.CylinderGeometry(1.15,1.15,2.3,20),tankM); rt.position.set(-4.5,0.7+1.15,-13); rt.renderOrder=2; W.add(rt);

  // layer: slabs
  var sl=vw.layer('slab',true), slF=vw.reg('slab',new THREE.MeshBasicMaterial({color:GOLD,depthWrite:false}),0,0.45), slL=vw.reg('slab',new THREE.LineBasicMaterial({color:PALE}),0,1);
  slabs.forEach(function(s){
    var p=s.geometry.parameters, x0=s.position.x-p.width/2, x1=x0+p.width, z0=s.position.z-p.depth/2, z1=z0+p.depth, y=s.position.y+0.19, arr=[], x, z;
    bx(sl,p.width,0.02,p.depth,slF,s.position.x,s.position.y+0.17,s.position.z,3); edg(sl,s,slL,4);
    for(x=x0+1.1;x<x1-0.3;x+=1.1) arr.push(x,y,z0,x,y,z1);
    for(z=z0+1.1;z<z1-0.3;z+=1.1) arr.push(x0,y,z,x1,y,z);
    ln(sl,arr,slL,4);
  });

  // layer: driveway
  var dl=vw.layer('drive',true), dL=vw.reg('drive',new THREE.LineBasicMaterial({color:PALE}),0,1), dF=vw.reg('drive',new THREE.MeshBasicMaterial({color:GOLD,depthWrite:false}),0,0.32);
  bx(dl,3.2,0.02,11.2,dF,6.6,0.09,11.4,3); bx(dl,3.8,0.02,3.9,dF,6.6,0.095,18.95,3);
  ln(dl,[5,0.11,5.8,5,0.11,20.9, 8.2,0.11,5.8,8.2,0.11,20.9, 4.7,0.11,17,8.5,0.11,17, 4.7,0.11,20.9,8.5,0.11,20.9],dL,4);

  // layer: stormwater and on-site detention
  var st=vw.layer('storm',true), pm=vw.reg('storm',new THREE.MeshBasicMaterial({color:PIPE}),0,1), Y=-0.6;
  [[-7,10],[4,10],[-7,-2],[4,-2]].forEach(function(p){ tb(st,V(p[0],2.9,p[1]),V(p[0],Y,p[1]),0.07,pm,0); });
  [[-1.5,-9.95],[6.5,-9.95]].forEach(function(p){ tb(st,V(p[0],3.5,p[1]),V(p[0],0.2,p[1]),0.07,pm,0); });
  var runA=[V(-8,Y,-7.2),V(-8,Y,12),V(-7.6,-0.75,13.2)], runB=[V(4.8,Y,-2),V(4.8,Y,11.2),V(-3.5,Y,11.2),V(-4.4,-0.75,13.2)], runO=[V(-6,-0.9,15.4),V(-6,-0.9,17.5),V(-6,-0.3,20.8)];
  pipeRun(st,runA,0.09,pm); pipeRun(st,runB,0.09,pm); pipeRun(st,runO,0.09,pm);
  pipeRun(st,[V(-7,Y,-2),V(-8,Y,-2)],0.07,pm); pipeRun(st,[V(-7,Y,10),V(-7,Y,11.2),V(-8,Y,11.2)],0.07,pm); pipeRun(st,[V(4,Y,-2),V(4.8,Y,-2)],0.07,pm); pipeRun(st,[V(4,Y,10),V(4.8,Y,10)],0.07,pm);
  pipeRun(st,[V(6.5,0.2,-9.95),V(6.5,0.2,-9.3),V(-1.5,0.2,-9.3),V(-1.5,0.2,-9.95)],0.07,pm);
  pipeRun(st,[V(-1.5,0.2,-9.3),V(-3.6,0.2,-12.2)],0.07,pm);
  pipeRun(st,[V(-5.6,0.2,-13),V(-8,0.2,-13),V(-8,0.2,-8.7),V(-8,Y,-7.2)],0.07,pm);
  bx(st,0.6,0.75,0.6,pm,-8,-0.33,-7.2,0);
  var tk=bx(st,3.2,1.1,2.8,vw.reg('storm',new THREE.MeshBasicMaterial({color:GOLD,depthWrite:false}),0,0.14),-6,-0.95,14,0);
  edg(st,tk,vw.reg('storm',new THREE.LineBasicMaterial({color:PALE}),0,1),0);
  var wat=bx(st,3.1,1.0,2.7,vw.reg('storm',new THREE.MeshBasicMaterial({color:0x3f93ba,depthWrite:false}),0,0.6),-6,-0.95,14,0);
  bx(st,0.7,0.05,0.7,pm,-6,0.03,14,3); bx(st,0.5,0.3,0.3,pm,-6,-0.2,20.85,3);
  var dots=[], dm=vw.reg('storm',new THREE.MeshBasicMaterial({color:0xFFF6DC}),0,1), dg=new THREE.SphereGeometry(0.16,10,8), paths=[pathFn(runA),pathFn(runB),pathFn(runO)];
  paths.forEach(function(){ for(var q=0;q<2;q++){ var s=new THREE.Mesh(dg,dm); st.add(s); dots.push(s); } });
  vw.hooks.push(function(dt,time,LAY){
    if(LAY.storm.cur<0.02) return;
    for(var q=0;q<dots.length;q++) paths[q>>1](time*0.11+(q&1)*0.5,dots[q].position);
    var lv=0.5+0.42*Math.sin(time*0.5); wat.scale.y=Math.max(0.05,lv); wat.position.y=-1.45+0.5*wat.scale.y;
  });

  // layer: levels, retaining and sediment control
  var si=vw.layer('site',true), sL=vw.reg('site',new THREE.LineBasicMaterial({color:PALE}),0,1), fa=[], x;
  edg(si,wall,sL,4);
  for(x=-9;x<4.4;x+=0.9){ fa.push(x,0.65,17.4,Math.min(4.4,x+0.9),0.65,17.4, x,0.05,17.4,x,0.65,17.4); }
  fa.push(4.4,0.05,17.4,4.4,0.65,17.4);
  for(x=5.2;x<=8.01;x+=0.35) fa.push(x,0.12,17.2,x,0.12,20.6);
  ln(si,fa,sL,4);
  bx(si,18,0.02,8.2,vw.reg('site',new THREE.MeshBasicMaterial({color:GOLD,depthWrite:false}),0,0.16),0,0.72,-13,3);

  vw.tag('overview','New dwelling',-1.5,4.8,4); vw.tag('overview','Extension',-2,3.1,-4.2); vw.tag('overview','Granny flat',2.5,4.7,-13.2);

  /* ---------- zoomed detailing for each layer (illustrative, not to scale) ---------- */
  function DM(layer,c,op){ return vw.reg(layer,new THREE.MeshStandardMaterial({color:c,roughness:0.85,depthWrite:op>0.95}),0,op); }
  function DL(layer,c,op){ return vw.reg(layer,new THREE.LineBasicMaterial({color:c}),0,op==null?1:op); }
  function track(t,fn){ t.track=fn; return t; }
  var tmpV=V(0,0,0);

  // slab: an exploded corner of the slab, from bedding up to the concrete
  var SD={x:0.5,z:13.6,y:0.25,w:4,d:3};
  var sd=vw.layer('slabd',true);
  var sand=new THREE.Group(), barrier=new THREE.Group(), reo=new THREE.Group(), conc=new THREE.Group();
  [sand,barrier,reo,conc].forEach(function(g){ g.position.set(SD.x,SD.y,SD.z); sd.add(g); });
  bx(sand,SD.w,0.12,SD.d,DM('slabd',0x8f7d58,0.95),0,0,0,2);
  bx(barrier,SD.w+0.05,0.02,SD.d+0.05,DM('slabd',0x2c2b27,0.9),0,0,0,2);
  var rl=[], q;
  for(q=-SD.w/2+0.2;q<SD.w/2;q+=0.25) rl.push(q,0,-SD.d/2+0.1,q,0,SD.d/2-0.1);
  for(q=-SD.d/2+0.2;q<SD.d/2;q+=0.25) rl.push(-SD.w/2+0.1,0,q,SD.w/2-0.1,0,q);
  ln(reo,rl,DL('slabd',0xF3DFA6),3);
  var tl=[];                                                                         // trench bars in the beams
  [-0.12,0,0.12].forEach(function(o){ tl.push(-SD.w/2,-0.32,SD.d/2-0.18+o,SD.w/2,-0.32,SD.d/2-0.18+o, SD.w/2-0.18+o,-0.32,-SD.d/2,SD.w/2-0.18+o,-0.32,SD.d/2, -SD.w/2,-0.28,o,SD.w/2,-0.28,o); });
  ln(reo,tl,DL('slabd',0xE2BE6A),3);
  var cm=DM('slabd',0xbdb7a8,0.93);
  bx(conc,SD.w,0.14,SD.d,cm,0,0,0,2);
  bx(conc,SD.w,0.5,0.36,cm,0,-0.32,SD.d/2-0.18,2);                                  // edge beam, front
  bx(conc,0.36,0.5,SD.d,cm,SD.w/2-0.18,-0.32,0,2);                                  // edge beam, side
  bx(conc,SD.w,0.42,0.3,cm,0,-0.28,0,2);                                            // internal stiffening beam
  edg(conc,bx(conc,SD.w,0.14,SD.d,DL('slabd',0xF3DFA6,0.0001),0,0,0,2),DL('slabd',0xF3DFA6),3);
  vw.hooks.push(function(dt,time,LAY){
    var e=LAY.slabd.cur; if(e<0.01) return;
    var b=0.08*Math.sin(time*0.8);
    barrier.position.y=SD.y+0.12+0.45*e;
    reo.position.y=SD.y+0.2+0.95*e+b*0.5;
    conc.position.y=SD.y+0.62+1.6*e+b;
  });
  track(vw.tag('slab','Concrete slab',0,0,0),function(p){ p.set(SD.x-1.2,conc.position.y+0.1,SD.z-0.6); });
  track(vw.tag('slab','Stiffening beams',0,0,0),function(p){ p.set(SD.x+SD.w/2-0.2,conc.position.y-0.55,SD.z+SD.d/2-0.2); });
  track(vw.tag('slab','Reinforcing mesh and trench bars',0,0,0),function(p){ p.set(SD.x-1.6,reo.position.y,SD.z+1.2); });
  track(vw.tag('slab','Vapour barrier',0,0,0),function(p){ p.set(SD.x+1.4,barrier.position.y,SD.z+1.4); });
  vw.tag('slab','Compacted sand bedding',SD.x-1.5,SD.y,SD.z+1.5);
  vw.tag('slab','Dwelling slab',-1.5,0.5,6);

  // stormwater: the on-site detention tank, its outlet pit and orifice plate
  var odd=vw.layer('stormd',true);
  var pit=bx(odd,0.8,1.3,0.8,DM('stormd',0x6f6a5e,0.35),-6,-0.75,15.85,1);
  edg(odd,pit,DL('stormd',0xF3DFA6),3);
  var ring=new THREE.Mesh(new THREE.RingGeometry(0.07,0.3,28),new THREE.MeshBasicMaterial({color:0xE2BE6A,side:THREE.DoubleSide,transparent:true,opacity:0})); vw.reg('stormd',ring.material,0,1);
  ring.position.set(-6,-1.15,15.46); ring.renderOrder=3; odd.add(ring);
  bx(odd,0.8,0.04,0.06,DM('stormd',0xE2BE6A,1),-6,-0.35,15.62,3);                     // overflow weir
  var gl=[]; for(q=-0.3;q<=0.31;q+=0.1) gl.push(-6.35,0.08,15.85+q,-5.65,0.08,15.85+q);
  ln(odd,gl,DL('stormd',0xF3DFA6),4);
  vw.tag('storm','On-site detention storage',-6.9,-0.4,13.4);
  vw.tag('storm','Orifice plate',-6,-1.15,15.5);
  vw.tag('storm','Overflow weir',-5.4,-0.32,15.65);
  vw.tag('storm','Access grate',-6,0.12,16.3);
  vw.tag('storm','Inlets from roof and site',-4.4,-0.7,13.2);
  vw.tag('storm','Outlet to kerb',-6,-0.3,19.5);

  // driveway: a long section beside the driveway, with a car checking clearance
  var dd2=vw.layer('drived',true), PX=8.95;
  var panel=new THREE.Mesh(new THREE.PlaneGeometry(16.2,2.4),new THREE.MeshBasicMaterial({color:0x2a2418,side:THREE.DoubleSide,transparent:true,opacity:0,depthWrite:false})); vw.reg('drived',panel.material,0,0.7); edg(dd2,panel,DL('drived',0x6B5527),3);
  panel.rotation.y=Math.PI/2; panel.position.set(PX,1.1,13.4); panel.renderOrder=2; dd2.add(panel);
  var prof=[[5.8,1.25],[7.5,1.22],[9,1.12],[15.2,0.78],[16.4,0.72],[17.4,0.71],[18.2,0.66],[20.1,0.36],[20.9,0.24]].map(function(p){ return [p[0],0.3+(p[1]-0.24)*1.5]; }), pl=[], i, pfm=DM('drived',0xF3DFA6,1);
  for(i=0;i<prof.length-1;i++) tb(dd2,V(PX+0.06,prof[i][1],prof[i][0]),V(PX+0.06,prof[i+1][1],prof[i+1][0]),0.045,pfm,4);
  var ticks=[]; [[5.8,'g'],[17.4,'b'],[20.9,'k']].forEach(function(k){ var y=prof.filter(function(p){return p[0]===k[0];})[0][1]; tb(dd2,V(PX+0.06,y-0.3,k[0]),V(PX+0.06,y+0.3,k[0]),0.03,DM('drived',0xE2BE6A,1),4); });
  var carP=new THREE.Group(), cmat=DM('drived',0xe9e2cd,1);
  bx(carP,0.08,0.18,1.1,cmat,0,0.14,0,4); bx(carP,0.08,0.15,0.55,cmat,0,0.3,-0.05,4);
  carP.position.x=PX+0.12; dd2.add(carP);
  var cpath=pathFn(prof.map(function(p){ return V(PX+0.12,p[1]+0.04,p[0]); }).reverse());
  vw.hooks.push(function(dt,time,LAY){
    if(LAY.drived.cur<0.01) return;
    var u=(time*0.06)%1; cpath(u,carP.position); cpath(Math.min(0.999,u+0.01),tmpV);
    carP.rotation.x=-Math.atan2(tmpV.y-carP.position.y,Math.abs(tmpV.z-carP.position.z)||1e-6);
  });
  vw.tag('drive','Garage floor level',PX,1.95,5.9);
  vw.tag('drive','Driveway grade',PX,1.55,11.8);
  vw.tag('drive','Transition',PX,1.2,15.8);
  vw.tag('drive','Boundary level',PX,1.15,17.4);
  vw.tag('drive','Crossover to council standard',PX,0.85,19.3);
  vw.tag('drive','Kerb layback',PX,0.4,21.1);

  // levels: a section through the retaining wall at the edge of the upper pad
  var rd2=vw.layer('sited',true);
  bx(rd2,18,0.25,0.95,DM('sited',0x9a9384,0.95),0,-0.225,-8.38,2);                  // footing
  var agg=bx(rd2,18,0.78,0.38,DM('sited',0xC7A256,0.55),0,0.36,-8.83,2);             // drainage aggregate
  edg(rd2,agg,DL('sited',0xF3DFA6),3);
  tb(rd2,V(-9,0.08,-8.84),V(9,0.08,-8.84),0.07,DM('sited',0xE2BE6A,1),3);            // subsoil drain
  ln(rd2,[9.01,0.76,-9.05,9.01,0.76,-12, 9.01,0,-8.36,9.01,0,-6],DL('sited',0xF3DFA6),4);
  var SX=10.04;
  bx(rd2,0.03,0.8,3.0,DM('sited',0x5b4a30,0.95),SX,0.36,-10.5,4);                   // retained fill
  bx(rd2,0.03,1.0,0.28,DM('sited',0xd8d0ba,1),SX,0.4,-8.5,5);                         // wall
  bx(rd2,0.03,0.25,0.95,DM('sited',0x9a9384,1),SX,-0.225,-8.38,5);                    // footing
  bx(rd2,0.03,0.78,0.38,DM('sited',0xC7A256,1),SX+0.005,0.36,-8.83,5);                // aggregate
  var pc=new THREE.Mesh(new THREE.CircleGeometry(0.075,20),new THREE.MeshBasicMaterial({color:0x1a1a18,transparent:true,opacity:0,side:THREE.DoubleSide})); vw.reg('sited',pc.material,0,1);
  pc.rotation.y=Math.PI/2; pc.position.set(SX+0.03,0.08,-8.84); pc.renderOrder=6; rd2.add(pc);
  ln(rd2,[SX+0.03,0.76,-12,SX+0.03,0.76,-8.64, SX+0.03,0,-8.36,SX+0.03,0,-6.4],DL('sited',0xF3DFA6),6);
  vw.tag('site','Retaining wall to AS 4678',10.05,0.85,-8.5);
  vw.tag('site','Drainage aggregate',10.05,0.5,-8.83);
  vw.tag('site','Subsoil drain',10.05,0.08,-8.84);
  vw.tag('site','Wall footing',10.05,-0.25,-8.0);
  vw.tag('site','Upper pad level',10.05,0.78,-11.2);
  vw.tag('site','Lower pad level',10.05,0.02,-6.8);

  vw.STEPS.overview={cam:[0.7,1.0,50,0,1.0,3],act:{drive:0.35},spin:true};
  vw.STEPS.slab={cam:[0.62,1.18,12.5,0.5,1.25,13.4],act:{slab:0.5,slabd:1},fade:{bldg:0.12}};
  vw.STEPS.storm={cam:[-0.55,0.95,12,-6,-0.6,15],act:{storm:1,stormd:1},fade:{ground:0.18,bldg:0.3}};
  vw.STEPS.drive={cam:[1.45,1.3,18,8.9,0.8,13.4],act:{drive:0.6,drived:1}};
  vw.STEPS.site={cam:[1.5,1.38,7.2,10,0.25,-9.0],act:{site:0.6,sited:1},fade:{ground:0.3,bldg:0.4}};
  skinViewer(vw,{0x2b2925:'grass',0x1a1a18:'road',0x4a473f:'conc',0x8e8a80:'conc',0xcfc8b4:'conc',0x8f8a7d:'conc',0xb9b2a0:'wall',0xddd5bf:'wall2',0x5f5a4e:'roof',0x55524a:'conc',0x9b968a:'metal'});
}

/* =====================================================================
   A commercial site: warehouse, car park, treatment unit and underground storage
   ===================================================================== */
function buildComm(vw){
  var V=vw.V, W=vw.world, GOLD=0xC7A256, PALE=0xF3DFA6, PIPE=0xE2BE6A;
  function M(c,o){ var p={color:c,roughness:0.92},k,m; if(o) for(k in o) p[k]=o[k]; m=new THREE.MeshStandardMaterial(p); m.userData.hex=c; return m; }
  var gm=vw.fg('ground',M(0x2b2925)), rd=vw.fg('ground',M(0x1a1a18)), fp=vw.fg('ground',M(0x4a473f)), kb=M(0x8e8a80);
  var g1=bx(W,56,3,56,gm,0,-1.5,5,1); edg(W,g1,new THREE.LineBasicMaterial({color:GOLD,transparent:true,opacity:0.5}),2);
  bx(W,56,0.05,7,rd,0,0.03,28.5,2); bx(W,56,0.16,0.3,kb,0,0.08,24.85,2); bx(W,56,0.04,1.5,fp,0,0.03,22.5,2);
  ln(W,[-25,0.07,-20,25,0.07,-20, 25,0.07,-20,25,0.07,20, 25,0.07,20,-25,0.07,20, -25,0.07,20,-25,0.07,-20],new THREE.LineBasicMaterial({color:GOLD,transparent:true,opacity:0.85}),3);
  // pavements
  var asph=vw.fg('pave',M(0x1f1f1d)), conc=vw.fg('pave',M(0x55524a));
  bx(W,32,0.05,17.5,asph,-6,0.035,10.75,2);                   // car park
  bx(W,15,0.06,39.5,conc,17.5,0.04,-0.25,2);                  // truck court
  bx(W,6,0.06,4.9,asph,3,0.04,22.4,2); bx(W,9,0.07,4.9,conc,17.5,0.045,22.4,2);   // crossovers
  // building
  var wallsM=vw.fg('bldg',M(0xa9a391)), roofM=vw.fg('bldg',M(0x5c584d)), darkM=vw.fg('bldg',M(0x20201d)), slabM=M(0x8f8a7d);
  bx(W,30.6,0.25,18.6,slabM,-7,0.125,-9,2); bx(W,30,7,18,wallsM,-7,3.75,-9,2); bx(W,30.8,0.3,18.8,roofM,-7,7.4,-9,2);
  bx(W,0.1,5,4,darkM,8.06,2.75,-12,2); bx(W,0.1,5,4,darkM,8.06,2.75,-6,2); bx(W,3,0.2,12,roofM,9.5,5.6,-9,2);
  bx(W,12,1.6,0.1,darkM,-14,4.6,0.06,2); bx(W,1.6,2.4,0.1,darkM,-3,1.45,0.06,2);
  var rt=new THREE.Mesh(new THREE.CylinderGeometry(1.3,1.3,3.2,20),M(0x9b968a)); rt.position.set(-23.5,1.6,-6); rt.renderOrder=2; W.add(rt);
  // trees along the frontage
  var tg=new THREE.IcosahedronGeometry(1.5,0), tm=M(0x46553f,{flatShading:true});
  [-22,-15,-8,9.5,24].forEach(function(x,i){ var t=new THREE.Mesh(tg,tm); t.position.set(x,2.0,21.1); t.scale.set(1,1.3,1); t.rotation.y=i; t.renderOrder=2; W.add(t); });

  // layer: car park and pavement
  var pk=vw.layer('park'), pL=vw.reg('park',new THREE.LineBasicMaterial({color:PALE}),0.35,1), bays=[], x, z;
  for(x=-21;x<=2.5;x+=2.6){ bays.push(x,0.08,2.2,x,0.08,7.6, x,0.08,14,x,0.08,19.4); }
  bays.push(-21,0.08,7.6,2.4,0.08,7.6, -21,0.08,14,2.4,0.08,14);
  for(z=2.6;z<7.6;z+=0.7) bays.push(2.4,0.08,z,5.0,0.08,z+0.7);        // shared zone beside the accessible bay
  bays.push(5.0,0.08,2.2,5.0,0.08,7.6);
  ln(pk,bays,pL,3);
  var jl=[], jM=vw.reg('park',new THREE.LineBasicMaterial({color:PALE}),0.1,0.7);
  for(z=-20;z<=19.5;z+=5) jl.push(10,0.09,z,25,0.09,z);
  jl.push(15,0.09,-20,15,0.09,19.5, 20,0.09,-20,20,0.09,19.5);
  ln(pk,jl,jM,3);
  bx(pk,2.6,0.02,5.4,vw.reg('park',new THREE.MeshBasicMaterial({color:0x3f93ba,depthWrite:false}),0.25,0.75),1.1,0.085,4.9,3);

  // layer: stormwater, treatment unit and underground storage
  var st=vw.layer('storm',true), pm=vw.reg('storm',new THREE.MeshBasicMaterial({color:PIPE}),0,1), Y=-1.3;
  var trunk=[V(17.5,Y,-8),V(17.5,Y,10.75),V(0,Y,10.75),V(-9,Y,10.75),V(-10.5,-1.5,10.75)];
  pipeRun(st,trunk,0.22,pm);
  [[17.5,-8],[17.5,10.75],[0,10.75],[-9,10.75]].forEach(function(p){ bx(st,0.9,1.5,0.9,pm,p[0],-0.72,p[1],0); bx(st,0.9,0.05,0.9,pm,p[0],0.1,p[1],3); });
  [-20,-10,0].forEach(function(px){ tb(st,V(px,7.2,0.25),V(px,-1.0,0.25),0.12,pm,0); pipeRun(st,[V(px,-1.0,0.25),V(px,px===-20?-1.0:Y,px===-20?4.2:10.75)],0.14,pm); });
  // treatment unit: a horizontal vessel with two access risers
  var spM=vw.reg('storm',new THREE.MeshBasicMaterial({color:GOLD,depthWrite:false}),0,0.3), spL=vw.reg('storm',new THREE.LineBasicMaterial({color:PALE}),0,1);
  var sp=new THREE.Mesh(new THREE.CylinderGeometry(0.95,0.95,5,20),spM); sp.rotation.z=Math.PI/2; sp.position.set(-13,-1.5,10.75); st.add(sp); edg(st,sp,spL,0);
  [-14.4,-11.6].forEach(function(px){ tb(st,V(px,-0.6,10.75),V(px,0.08,10.75),0.38,pm,0); bx(st,0.9,0.05,0.9,pm,px,0.1,10.75,3); });
  // underground storage under the car park
  var sto=bx(st,6,1.3,13,vw.reg('storm',new THREE.MeshBasicMaterial({color:GOLD,depthWrite:false}),0,0.13),-19,-1.3,10.75,0); edg(st,sto,spL,0);
  var cell=[]; for(z=4.25+1.3;z<17.2;z+=1.3) cell.push(-22,-0.64,z,-16,-0.64,z); for(x=-22+1.2;x<-16;x+=1.2) cell.push(x,-0.64,4.25,x,-0.64,17.25);
  ln(st,cell,vw.reg('storm',new THREE.LineBasicMaterial({color:PALE}),0,0.55),0);
  var wat=bx(st,5.9,1.2,12.9,vw.reg('storm',new THREE.MeshBasicMaterial({color:0x3f93ba,depthWrite:false}),0,0.55),-19,-1.3,10.75,0);
  pipeRun(st,[V(-15.5,-1.5,10.75),V(-16,-1.5,10.75)],0.22,pm);
  var out=[V(-19,-1.6,17.25),V(-19,-1.6,18.6),V(-19,-1.5,25.4),V(-28,-1.4,25.4)];
  pipeRun(st,out,0.22,pm); bx(st,1.1,1.7,1.1,pm,-19,-0.8,18.6,0); bx(st,1.0,0.05,1.0,pm,-19,0.1,18.6,3); bx(st,1.0,1.5,1.0,pm,-19,-0.75,25.4,0);
  var dots=[], dm=vw.reg('storm',new THREE.MeshBasicMaterial({color:0xFFF6DC}),0,1), dg=new THREE.SphereGeometry(0.34,10,8), p1=pathFn(trunk), p2=pathFn(out);
  for(var q=0;q<5;q++){ var s=new THREE.Mesh(dg,dm); st.add(s); dots.push(s); }
  vw.hooks.push(function(dt,time,LAY){
    if(LAY.storm.cur<0.02) return;
    for(var i=0;i<3;i++) p1(time*0.07+i/3,dots[i].position);
    for(i=3;i<5;i++) p2(time*0.1+(i-3)/2,dots[i].position);
    var lv=0.5+0.42*Math.sin(time*0.45); wat.scale.y=Math.max(0.05,lv); wat.position.y=-1.9+0.6*wat.scale.y;
  });

  // layer: truck access and swept path
  var tr=vw.layer('truck',true), pts=[V(27.5,0.1,28.3),V(23,0.1,28.3),V(19.2,0.1,26.6),V(17.6,0.1,22),V(17.5,0.1,10),V(17.5,0.1,0),V(16.6,0.1,-5.6),V(14.2,0.1,-8.6),V(12.4,0.1,-9)];
  var curve=new THREE.CatmullRomCurve3(pts,false,'centripetal'), N=160, ps=[], ix=[], eL=[], eR=[], p=V(0,0,0), t=V(0,0,0), pl=null, pr=null, prevT=null;
  for(q=0;q<=N;q++){
    curve.getPointAt(q/N,p); curve.getTangentAt(q/N,t);
    var bend=prevT?Math.min(1,prevT.angleTo(t)*14):0, hl=1.5+1.1*bend, hr=1.5+0.6*bend; prevT=t.clone();
    var lx=p.x+t.z*hl, lz=p.z-t.x*hl, rx=p.x-t.z*hr, rz=p.z+t.x*hr;
    ps.push(lx,0.1,lz,rx,0.1,rz); if(q<N){ var b0=q*2; ix.push(b0,b0+2,b0+1,b0+1,b0+2,b0+3); }
    if(pl){ eL.push(pl[0],0.12,pl[1],lx,0.12,lz); eR.push(pr[0],0.12,pr[1],rx,0.12,rz); }
    pl=[lx,lz]; pr=[rx,rz];
  }
  var rg=new THREE.BufferGeometry(); rg.setAttribute('position',new THREE.Float32BufferAttribute(ps,3)); rg.setIndex(ix);
  var rib=new THREE.Mesh(rg,vw.reg('truck',new THREE.MeshBasicMaterial({color:GOLD,side:THREE.DoubleSide,depthWrite:false}),0,0.3)); rib.renderOrder=3; tr.add(rib);
  ln(tr,eL.concat(eR),vw.reg('truck',new THREE.LineBasicMaterial({color:PALE}),0,1),4);
  var truck=makeTruck(function(c){ return vw.reg('truck',new THREE.MeshStandardMaterial({color:c,roughness:0.7}),0,1); },'delivery'); tr.add(truck);
  var tmp=V(0,0,0);
  vw.hooks.push(function(dt,time,LAY){
    if(LAY.truck.cur<0.02) return;
    var u=0.5-0.5*Math.cos(time*0.22); curve.getPointAt(u,truck.position); truck.position.y=0.1; curve.getTangentAt(u,tmp); truck.rotation.y=Math.atan2(-tmp.z,tmp.x);
  });

  vw.tag('overview','Warehouse',-7,7.8,-9); vw.tag('overview','Car park',-8,0.3,10.75); vw.tag('overview','Truck court',17.5,0.3,-4);
  vw.tag('storm','SPEL treatment unit',-12.2,4.2,10.75); vw.tag('storm','Underground storage',-20.5,0.2,12.5); vw.tag('storm','Outlet pit',-19,0.2,19.6); vw.tag('storm','Council drain',-26.5,0.2,25.4); vw.tag('storm','Grated pit',0,1.6,10.75);
  vw.tag('park','Car park to AS 2890',-12,0.2,16.7); vw.tag('park','Accessible bay',1.1,0.2,4.9); vw.tag('park','Heavy-duty hardstand',20,0.2,-12);
  var tt=vw.tag('truck','Delivery truck',0,0,0); tt.track=function(pp){ pp.copy(truck.position); pp.y+=3.8; };
  vw.tag('truck','Swept path',17.5,0.2,12); vw.tag('truck','Loading dock',9.5,5.8,-9);

  vw.STEPS.overview={cam:[0.75,1.0,96,-1,1.5,5],act:{park:0.3},spin:true};
  vw.STEPS.storm={cam:[-0.3,0.84,58,-10,-1.2,13],act:{storm:1,park:0.15},fade:{ground:0.3,pave:0.22,bldg:0.45}};
  vw.STEPS.park={cam:[0.3,0.78,72,-2,0,9],act:{park:1}};
  vw.STEPS.truck={cam:[1.05,0.9,74,13,1,7],act:{truck:1,park:0.3}};
  skinViewer(vw,{0x2b2925:'grass',0x1a1a18:'road',0x4a473f:'conc',0x8e8a80:'conc',0x1f1f1d:'road',0x55524a:'conc',0xa9a391:'wall',0x5c584d:'roof2',0x8f8a7d:'conc',0x9b968a:'metal',0x46553f:'tree'});
}



var site=null, pier=null;
var modelRecords=[
  {name:'subdivision',el:$('#stage'),factory:function(){site=buildSite(); return site;}},
  {name:'residential',el:$('#mvHouse .mv-stage'),factory:function(){return initMV($('#mvHouse'),buildHouse);}},
  {name:'commercial',el:$('#mvComm .mv-stage'),factory:function(){return initMV($('#mvComm'),buildComm);}}
];
function initialise(record){
  if(record.scene||record.failed){d.dispatchEvent(new CustomEvent('jce:model-ready',{detail:{name:record.name}}));return;}
  try{
    record.scene=record.factory();record.scene.state.paused=reduce;record.time=5;
    if(record.name==='subdivision')record.scene.state.intro=1;
    if(record.name==='subdivision') { var chosen=$('.layer[aria-current="true"]');if(chosen)record.scene.setStep(chosen.getAttribute('data-go'));if($('#floodLevel'))record.scene.setFlood(parseFloat($('#floodLevel').value)); }
    updatePause(record);
  }catch(err){record.failed=true;var container=record.el.closest('.mv')||record.el.closest('.model-demo');container.classList.add('mv-off'); var p=d.createElement('p');p.className='scope-note';p.textContent='This model is unavailable. Please use the service descriptions below.';container.appendChild(p);}
  d.dispatchEvent(new CustomEvent('jce:model-ready',{detail:{name:record.name}}));
}
function updatePause(record){var b=$('[data-model-pause="'+record.name+'"]');if(b&&record.scene){b.setAttribute('aria-pressed',record.scene.state.paused?'true':'false');b.textContent=record.scene.state.paused?'Resume motion':'Pause motion';}}
if('IntersectionObserver' in window){
  var io=new IntersectionObserver(function(entries){entries.forEach(function(en){modelRecords.forEach(function(record){if(record.el===en.target){record.visible=en.isIntersecting;if(en.isIntersecting)initialise(record);}});});},{rootMargin:'120px'});
  modelRecords.forEach(function(record){if(record.el)io.observe(record.el);});
}else{modelRecords.forEach(function(record){record.visible=true;initialise(record);});}
$$('[data-model-pause]').forEach(function(button){button.addEventListener('click',function(){var record=modelRecords.filter(function(r){return r.name===button.getAttribute('data-model-pause');})[0];initialise(record);if(record.scene){record.scene.state.paused=!record.scene.state.paused;updatePause(record);}});});
$$('[data-model-reset]').forEach(function(button){button.addEventListener('click',function(){var record=modelRecords.filter(function(r){return r.name===button.getAttribute('data-model-reset');})[0];initialise(record);if(record.scene)record.scene.reset();});});
if(motionPreference.addEventListener)motionPreference.addEventListener('change',function(event){reduce=event.matches;modelRecords.forEach(function(record){if(record.scene){record.scene.state.paused=reduce;updatePause(record);}});});
var lastFrame=0;
d.addEventListener('jce:model-open',function(event){modelRecords.forEach(function(record){record.visible=record.name===event.detail.name;if(record.visible)initialise(record);});});
d.addEventListener('jce:model-close',function(){modelRecords.forEach(function(record){record.visible=false;});});
function loop(t){var dt=Math.min(.2,(t-lastFrame)/1000||.016);lastFrame=t;if(!d.hidden)modelRecords.forEach(function(record){var dialog=record.el&&record.el.closest('dialog');if(record.scene&&record.visible&&(!dialog||dialog.open)){if(!record.scene.state.paused)record.time+=dt;record.scene.tick(dt,record.time);}});window.requestAnimationFrame(loop);}
window.requestAnimationFrame(loop);

/* ---------- model layers update one compact caption in place ---------- */
var stepEls=$$('.model-demo .step'), layerBtns=$$('.layer');
function showStep(name){
  stepEls.forEach(function(el){ var active=el.getAttribute('data-step')===name; el.hidden=!active; el.classList.toggle('on',active); });
  layerBtns.forEach(function(b){ var active=b.getAttribute('data-go')===name; b.setAttribute('aria-current',active?'true':'false'); b.setAttribute('aria-pressed',active?'true':'false'); });
  if(site) site.setStep(name);
}
layerBtns.forEach(function(b){
  b.setAttribute('aria-controls','s-'+b.getAttribute('data-go'));
  b.addEventListener('click',function(){ showStep(b.getAttribute('data-go')); });
});
showStep('overview');

/* ---------- flood slider ---------- */
var fl=$('#floodLevel'), flRead=$('#floodRead');
function floodText(L){
  var wet=0,i; for(i=0;i<pads.length;i++) if(pads[i].y<L-0.004) wet++;
  if(wet>0) return 'Extreme flood, beyond the design event. '+wet+' of '+pads.length+' building pads under water.';
  if(L<-0.55) return 'Normal creek level. Water stays in the channel.';
  if(L<L1-0.07) return 'Flood rising. Water is out of the creek and onto the floodplain.';
  if(L<=L1+0.07) return '1% AEP flood. Every building pad stays dry, because the pad levels were set above it.';
  return 'Above the 1% AEP flood and the pads are still dry. That margin is the freeboard.';
}
if(fl){
  fl.addEventListener('input',function(){ var L=CREEK+parseFloat(fl.value)/100*1.6; flRead.textContent=floodText(L); if(site) site.setFlood(L); });
}

/* ---------- cut and fill balance, read off the model ---------- */
var cfRead=$('#cfRead');
if(cfRead&&site&&site.balance){
  var cfTot=site.balance.cut+site.balance.fill, cfPc=Math.round(100*site.balance.cut/cfTot);
  cfRead.textContent='In this model: '+cfPc+'% cut, '+(100-cfPc)+'% fill.';
}

var mnav=$('.mnav');
if(mnav) $$('a',mnav).forEach(function(a){ a.addEventListener('click',function(){ mnav.removeAttribute('open'); }); });

/* ---------- areas plan ---------- */
var TOWNS={
  'gunnedah':{n:'Gunnedah',c:'Gunnedah Shire Council area.'},
  'tamworth':{n:'Tamworth',c:'Tamworth Regional Council area.'},
  'armidale':{n:'Armidale',c:'Armidale Regional Council area.'},
  'moree':{n:'Moree',c:'Moree Plains Shire Council area.'},
  'macksville':{n:'Macksville',c:'Nambucca Valley Council area.'},
  'coffs-harbour':{n:'Coffs Harbour',c:'City of Coffs Harbour area.'},
  'port-macquarie':{n:'Port Macquarie',c:'Port Macquarie-Hastings Council area.'},
  'grafton':{n:'Grafton',c:'Clarence Valley Council area.'}
};
var whereNow=$('#whereNow'), dots=$$('.town'), chips=$$('.chip'), locs=$$('.loc'), curTown=null;
function pickTown(slug){
  var t=TOWNS[slug]; if(!t||slug===curTown) return; curTown=slug;
  dots.forEach(function(o){ o.classList.toggle('on',o.getAttribute('data-town')===slug); });
  chips.forEach(function(c){ c.setAttribute('aria-pressed',c.getAttribute('data-pick')===slug?'true':'false'); });
  locs.forEach(function(l){ l.classList.toggle('hit',l.id==='loc-'+slug); });
  whereNow.textContent=t.c+' ';
  var a=d.createElement('a'); a.href='#loc-'+slug; a.textContent='See what we do in '+t.n; whereNow.appendChild(a);
}
dots.forEach(function(o){ var s=o.getAttribute('data-town'); o.addEventListener('pointerenter',function(){pickTown(s);}); o.addEventListener('click',function(){pickTown(s);}); });
chips.forEach(function(c){ var s=c.getAttribute('data-pick'); c.addEventListener('click',function(){pickTown(s);}); c.addEventListener('mouseenter',function(){pickTown(s);}); c.addEventListener('focus',function(){pickTown(s);}); });

})();
