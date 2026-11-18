import{a as xo,b as Qp,c as Yu,d as Zu,e as _o,f as jp,g as tm}from"./ps-chunk-QFDTRIMG.js";import{d as Js}from"./ps-chunk-WLXF7YQC.js";import{b as oc,g as Yp,j as Zp,l as Oi,n as Jp,q as $p,r as Kp}from"./ps-chunk-EYLMPE6I.js";import{P as go,R as qu,S as Wp,W as rc,b as Gp,i as Vp,q as Hp}from"./ps-chunk-FJFRJNRC.js";import{a as Up,b as Fp,c as Xu,d as Op,p as Fi,r as Bp,v as zp}from"./ps-chunk-6KNCANQR.js";import{y as kp}from"./ps-chunk-SWWKCYSD.js";import{A as mo,B as Dp,C as wn,F as Np,b as Hu,c as Ys,d as Wu,e as Zs,h as ui,i as fi,j as Ui,n as Cp,o as Ip,p as Pp,s as Lp,u as sc}from"./ps-chunk-W4GZCNH3.js";import{c as Xp,j as qp}from"./ps-chunk-Y3RQN2V7.js";import{b as Yx}from"./ps-chunk-E4XECTYR.js";var nl="186",f0={LEFT:0,MIDDLE:1,RIGHT:2,ROTATE:0,DOLLY:1,PAN:2},d0={ROTATE:0,PAN:1,DOLLY_PAN:2,DOLLY_ROTATE:3},Wf=0,ru=1,Xf=2,p0=3,m0=0,$r=1,qf=2,Ns=3,Ri=0,rn=1,Ne=2,Yn=0,Us=1,ou=2,au=3,lu=4,Yf=5,g0=6,ns=100,Zf=101,Jf=102,$f=103,Kf=104,Qf=200,jf=201,td=202,ed=203,cu=204,hu=205,nd=206,id=207,sd=208,rd=209,od=210,ad=211,ld=212,cd=213,hd=214,zo=0,ko=1,Go=2,ys=3,Vo=4,Ho=5,Wo=6,Xo=7,Kr=0,ud=1,fd=2,Dn=0,uu=1,fu=2,du=3,pu=4,mu=5,gu=6,xu=7,$c="attached",dd="detached",il=300,Zn=301,Ci=302,Qr=303,jr=304,Fs=306,In=1e3,Ce=1001,_r=1002,Ie=1003,_u=1004,x0=1004,Os=1005,_0=1005,le=1006,to=1007,y0=1007,Ve=1008,v0=1008,dn=1009,yu=1010,vu=1011,Bs=1012,sl=1013,En=1014,en=1015,Nn=1016,rl=1017,ol=1018,zs=1020,Mu=35902,Su=35899,bu=1021,Eu=1022,nn=1023,Vn=1026,Ii=1027,al=1028,eo=1029,Pi=1030,ll=1031,M0=1032,cl=1033,no=33776,io=33777,so=33778,ro=33779,hl=35840,ul=35841,fl=35842,dl=35843,pl=36196,ml=37492,gl=37496,xl=37488,_l=37489,oo=37490,yl=37491,vl=37808,Ml=37809,Sl=37810,bl=37811,El=37812,Tl=37813,wl=37814,Al=37815,Rl=37816,Cl=37817,Il=37818,Pl=37819,Ll=37820,Dl=37821,Nl=36492,Ul=36494,Fl=36495,Ol=36283,Bl=36284,ao=36285,zl=36286,pd=2200,md=2201,gd=2202,yr=2300,qo=2301,Do=2302,Kc=2303,Wi=2400,Xi=2401,vr=2402,kl=2500,Tu=2501,xd=0,_d=1,yd=2,vd=3200,S0=3201,b0=3202,E0=3203,oi=0,Md=1,ai="",Ee="srgb",Mr="srgb-linear",Sr="linear",ue="srgb",T0="",w0="rg",A0="ga",R0=0,No=7680,C0=7681,I0=7682,P0=7683,L0=34055,D0=34056,N0=5386,U0=512,F0=513,O0=514,B0=515,z0=516,k0=517,G0=518,Sd=519,bd=512,Ed=513,Td=514,Gl=515,wd=516,Ad=517,Vl=518,Rd=519,Hl=35044,V0=35048,H0=35040,W0=35045,X0=35049,q0=35041,Y0=35046,Z0=35050,J0=35042,$0="100",wu="300 es",xn=2e3,qi=2001,K0={COMPUTE:"compute",RENDER:"render"},Q0={PERSPECTIVE:"perspective",LINEAR:"linear",FLAT:"flat"},j0={NORMAL:"normal",CENTROID:"centroid",SAMPLE:"sample",FIRST:"first",EITHER:"either"},tg={TEXTURE_COMPARE:"depthTextureCompare"},eg={NONE:0,SHARED:1,FULL:2};function Zx(s){for(let t=s.length-1;t>=0;--t)if(s[t]>=65535)return!0;return!1}var Jx={Int8Array,Uint8Array,Uint8ClampedArray,Int16Array,Uint16Array,Int32Array,Uint32Array,Float32Array,Float64Array};function gr(s,t){return new Jx[s](t)}function ng(s){return ArrayBuffer.isView(s)&&!(s instanceof DataView)}function br(s){return document.createElementNS("http://www.w3.org/1999/xhtml",s)}function Cd(){let s=br("canvas");return s.style.display="block",s}var em={},Yi=null;function ig(s){Yi=s}function sg(){return Yi}function Er(...s){let t="THREE."+s.shift();Yi?Yi("log",t,...s):console.log(t,...s)}function rg(s){let t=s[0];if(typeof t=="string"&&t.startsWith("TSL:")){let e=s[1];e&&e.isStackTrace?s[0]+=" "+e.getLocation():s[1]='Stack trace not available. Enable "THREE.Node.captureStackTrace" to capture stack traces.'}return s}function St(...s){s=rg(s);let t="THREE."+s.shift();if(Yi)Yi("warn",t,...s);else{let e=s[0];e&&e.isStackTrace?console.warn(e.getError(t)):console.warn(t,...s)}}function Bt(...s){s=rg(s);let t="THREE."+s.shift();if(Yi)Yi("error",t,...s);else{let e=s[0];e&&e.isStackTrace?console.error(e.getError(t)):console.error(t,...s)}}function ti(...s){let t=s.join(" ");t in em||(em[t]=!0,St(...s))}function og(s,t,e){return new Promise(function(n,i){function r(){switch(s.clientWaitSync(t,s.SYNC_FLUSH_COMMANDS_BIT,0)){case s.WAIT_FAILED:i();break;case s.TIMEOUT_EXPIRED:setTimeout(r,e);break;default:n()}}setTimeout(r,e)})}var ag={[zo]:ko,[Go]:Wo,[Vo]:Xo,[ys]:Ho,[ko]:zo,[Wo]:Go,[Xo]:Vo,[Ho]:ys},_n=class{addEventListener(t,e){this._listeners===void 0&&(this._listeners={});let n=this._listeners;n[t]===void 0&&(n[t]=[]),n[t].indexOf(e)===-1&&n[t].push(e)}hasEventListener(t,e){let n=this._listeners;return n===void 0?!1:n[t]!==void 0&&n[t].indexOf(e)!==-1}removeEventListener(t,e){let n=this._listeners;if(n===void 0)return;let i=n[t];if(i!==void 0){let r=i.indexOf(e);r!==-1&&i.splice(r,1)}}dispatchEvent(t){let e=this._listeners;if(e===void 0)return;let n=e[t.type];if(n!==void 0){t.target=this;let i=n.slice(0);for(let r=0,o=i.length;r<o;r++)i[r].call(this,t);t.target=null}}},Qe=["00","01","02","03","04","05","06","07","08","09","0a","0b","0c","0d","0e","0f","10","11","12","13","14","15","16","17","18","19","1a","1b","1c","1d","1e","1f","20","21","22","23","24","25","26","27","28","29","2a","2b","2c","2d","2e","2f","30","31","32","33","34","35","36","37","38","39","3a","3b","3c","3d","3e","3f","40","41","42","43","44","45","46","47","48","49","4a","4b","4c","4d","4e","4f","50","51","52","53","54","55","56","57","58","59","5a","5b","5c","5d","5e","5f","60","61","62","63","64","65","66","67","68","69","6a","6b","6c","6d","6e","6f","70","71","72","73","74","75","76","77","78","79","7a","7b","7c","7d","7e","7f","80","81","82","83","84","85","86","87","88","89","8a","8b","8c","8d","8e","8f","90","91","92","93","94","95","96","97","98","99","9a","9b","9c","9d","9e","9f","a0","a1","a2","a3","a4","a5","a6","a7","a8","a9","aa","ab","ac","ad","ae","af","b0","b1","b2","b3","b4","b5","b6","b7","b8","b9","ba","bb","bc","bd","be","bf","c0","c1","c2","c3","c4","c5","c6","c7","c8","c9","ca","cb","cc","cd","ce","cf","d0","d1","d2","d3","d4","d5","d6","d7","d8","d9","da","db","dc","dd","de","df","e0","e1","e2","e3","e4","e5","e6","e7","e8","e9","ea","eb","ec","ed","ee","ef","f0","f1","f2","f3","f4","f5","f6","f7","f8","f9","fa","fb","fc","fd","fe","ff"],nm=1234567,_s=Math.PI/180,vs=180/Math.PI;function Sn(){let s=Math.random()*4294967295|0,t=Math.random()*4294967295|0,e=Math.random()*4294967295|0,n=Math.random()*4294967295|0;return(Qe[s&255]+Qe[s>>8&255]+Qe[s>>16&255]+Qe[s>>24&255]+"-"+Qe[t&255]+Qe[t>>8&255]+"-"+Qe[t>>16&15|64]+Qe[t>>24&255]+"-"+Qe[e&63|128]+Qe[e>>8&255]+"-"+Qe[e>>16&255]+Qe[e>>24&255]+Qe[n&255]+Qe[n>>8&255]+Qe[n>>16&255]+Qe[n>>24&255]).toLowerCase()}function $t(s,t,e){return Math.max(t,Math.min(e,s))}function Id(s,t){return(s%t+t)%t}function $x(s,t,e,n,i){return n+(s-t)*(i-n)/(e-t)}function Kx(s,t,e){return s!==t?(e-s)/(t-s):0}function Uo(s,t,e){return(1-e)*s+e*t}function Qx(s,t,e,n){return Uo(s,t,1-Math.exp(-e*n))}function jx(s,t=1){return t-Math.abs(Id(s,t*2)-t)}function t_(s,t,e){return s<=t?0:s>=e?1:(s=(s-t)/(e-t),s*s*(3-2*s))}function e_(s,t,e){return s<=t?0:s>=e?1:(s=(s-t)/(e-t),s*s*s*(s*(s*6-15)+10))}function n_(s,t){return s+Math.floor(Math.random()*(t-s+1))}function i_(s,t){return s+Math.random()*(t-s)}function s_(s){return s*(.5-Math.random())}function r_(s){s!==void 0&&(nm=s);let t=nm+=1831565813;return t=Math.imul(t^t>>>15,t|1),t^=t+Math.imul(t^t>>>7,t|61),((t^t>>>14)>>>0)/4294967296}function o_(s){return s*_s}function a_(s){return s*vs}function l_(s){return s>0&&Number.isInteger(s)&&2**Math.round(Math.log2(s))===s}function c_(s){return Math.pow(2,Math.ceil(Math.log(s)/Math.LN2))}function h_(s){return Math.pow(2,Math.floor(Math.log(s)/Math.LN2))}function u_(s,t,e,n,i){let r=Math.cos,o=Math.sin,a=r(e/2),l=o(e/2),c=r((t+n)/2),h=o((t+n)/2),f=r((t-n)/2),u=o((t-n)/2),d=r((n-t)/2),p=o((n-t)/2);switch(i){case"XYX":s.set(a*h,l*f,l*u,a*c);break;case"YZY":s.set(l*u,a*h,l*f,a*c);break;case"ZXZ":s.set(l*f,l*u,a*h,a*c);break;case"XZX":s.set(a*h,l*p,l*d,a*c);break;case"YXY":s.set(l*d,a*h,l*p,a*c);break;case"ZYZ":s.set(l*p,l*d,a*h,a*c);break;default:St("MathUtils: .setQuaternionFromProperEuler() encountered an unknown order: "+i)}}function cn(s,t){switch(t.constructor){case Float32Array:return s;case Uint32Array:return s/4294967295;case Uint16Array:return s/65535;case Uint8Array:case Uint8ClampedArray:return s/255;case Int32Array:return Math.max(s/2147483647,-1);case Int16Array:return Math.max(s/32767,-1);case Int8Array:return Math.max(s/127,-1);default:throw new Error("THREE.MathUtils: Invalid component type.")}}function ee(s,t){switch(t.constructor){case Float32Array:return s;case Uint32Array:return Math.round(s*4294967295);case Uint16Array:return Math.round(s*65535);case Uint8Array:case Uint8ClampedArray:return Math.round(s*255);case Int32Array:return Math.round(s*2147483647);case Int16Array:return Math.round(s*32767);case Int8Array:return Math.round(s*127);default:throw new Error("THREE.MathUtils: Invalid component type.")}}var lg={DEG2RAD:_s,RAD2DEG:vs,generateUUID:Sn,clamp:$t,euclideanModulo:Id,mapLinear:$x,inverseLerp:Kx,lerp:Uo,damp:Qx,pingpong:jx,smoothstep:t_,smootherstep:e_,randInt:n_,randFloat:i_,randFloatSpread:s_,seededRandom:r_,degToRad:o_,radToDeg:a_,isPowerOfTwo:l_,ceilPowerOfTwo:c_,floorPowerOfTwo:h_,setQuaternionFromProperEuler:u_,normalize:ee,denormalize:cn},Od=class Od{constructor(t=0,e=0){this.x=t,this.y=e}get width(){return this.x}set width(t){this.x=t}get height(){return this.y}set height(t){this.y=t}set(t,e){return this.x=t,this.y=e,this}setScalar(t){return this.x=t,this.y=t,this}setX(t){return this.x=t,this}setY(t){return this.y=t,this}setComponent(t,e){switch(t){case 0:this.x=e;break;case 1:this.y=e;break;default:throw new Error("THREE.Vector2: index is out of range: "+t)}return this}getComponent(t){switch(t){case 0:return this.x;case 1:return this.y;default:throw new Error("THREE.Vector2: index is out of range: "+t)}}clone(){return new this.constructor(this.x,this.y)}copy(t){return this.x=t.x,this.y=t.y,this}add(t){return this.x+=t.x,this.y+=t.y,this}addScalar(t){return this.x+=t,this.y+=t,this}addVectors(t,e){return this.x=t.x+e.x,this.y=t.y+e.y,this}addScaledVector(t,e){return this.x+=t.x*e,this.y+=t.y*e,this}sub(t){return this.x-=t.x,this.y-=t.y,this}subScalar(t){return this.x-=t,this.y-=t,this}subVectors(t,e){return this.x=t.x-e.x,this.y=t.y-e.y,this}multiply(t){return this.x*=t.x,this.y*=t.y,this}multiplyScalar(t){return this.x*=t,this.y*=t,this}divide(t){return this.x/=t.x,this.y/=t.y,this}divideScalar(t){return this.multiplyScalar(1/t)}applyMatrix3(t){let e=this.x,n=this.y,i=t.elements;return this.x=i[0]*e+i[3]*n+i[6],this.y=i[1]*e+i[4]*n+i[7],this}min(t){return this.x=Math.min(this.x,t.x),this.y=Math.min(this.y,t.y),this}max(t){return this.x=Math.max(this.x,t.x),this.y=Math.max(this.y,t.y),this}clamp(t,e){return this.x=$t(this.x,t.x,e.x),this.y=$t(this.y,t.y,e.y),this}clampScalar(t,e){return this.x=$t(this.x,t,e),this.y=$t(this.y,t,e),this}clampLength(t,e){let n=this.length();return this.divideScalar(n||1).multiplyScalar($t(n,t,e))}floor(){return this.x=Math.floor(this.x),this.y=Math.floor(this.y),this}ceil(){return this.x=Math.ceil(this.x),this.y=Math.ceil(this.y),this}round(){return this.x=Math.round(this.x),this.y=Math.round(this.y),this}roundToZero(){return this.x=Math.trunc(this.x),this.y=Math.trunc(this.y),this}negate(){return this.x=-this.x,this.y=-this.y,this}dot(t){return this.x*t.x+this.y*t.y}cross(t){return this.x*t.y-this.y*t.x}lengthSq(){return this.x*this.x+this.y*this.y}length(){return Math.sqrt(this.x*this.x+this.y*this.y)}manhattanLength(){return Math.abs(this.x)+Math.abs(this.y)}normalize(){return this.divideScalar(this.length()||1)}angle(){return Math.atan2(-this.y,-this.x)+Math.PI}angleTo(t){let e=Math.sqrt(this.lengthSq()*t.lengthSq());if(e===0)return Math.PI/2;let n=this.dot(t)/e;return Math.acos($t(n,-1,1))}distanceTo(t){return Math.sqrt(this.distanceToSquared(t))}distanceToSquared(t){let e=this.x-t.x,n=this.y-t.y;return e*e+n*n}manhattanDistanceTo(t){return Math.abs(this.x-t.x)+Math.abs(this.y-t.y)}setLength(t){return this.normalize().multiplyScalar(t)}lerp(t,e){return this.x+=(t.x-this.x)*e,this.y+=(t.y-this.y)*e,this}lerpVectors(t,e,n){return this.x=t.x+(e.x-t.x)*n,this.y=t.y+(e.y-t.y)*n,this}equals(t){return t.x===this.x&&t.y===this.y}fromArray(t,e=0){return this.x=t[e],this.y=t[e+1],this}toArray(t=[],e=0){return t[e]=this.x,t[e+1]=this.y,t}fromBufferAttribute(t,e){return this.x=t.getX(e),this.y=t.getY(e),this}rotateAround(t,e){let n=Math.cos(e),i=Math.sin(e),r=this.x-t.x,o=this.y-t.y;return this.x=r*n-o*i+t.x,this.y=r*i+o*n+t.y,this}random(){return this.x=Math.random(),this.y=Math.random(),this}*[Symbol.iterator](){yield this.x,yield this.y}};Od.prototype.isVector2=!0;var rt=Od,ze=class{constructor(t=0,e=0,n=0,i=1){this.isQuaternion=!0,this._x=t,this._y=e,this._z=n,this._w=i}static slerpFlat(t,e,n,i,r,o,a){let l=n[i+0],c=n[i+1],h=n[i+2],f=n[i+3],u=r[o+0],d=r[o+1],p=r[o+2],x=r[o+3];if(f!==x||l!==u||c!==d||h!==p){let m=l*u+c*d+h*p+f*x;m<0&&(u=-u,d=-d,p=-p,x=-x,m=-m);let g=1-a;if(m<.9995){let v=Math.acos(m),b=Math.sin(v);g=Math.sin(g*v)/b,a=Math.sin(a*v)/b,l=l*g+u*a,c=c*g+d*a,h=h*g+p*a,f=f*g+x*a}else{l=l*g+u*a,c=c*g+d*a,h=h*g+p*a,f=f*g+x*a;let v=1/Math.sqrt(l*l+c*c+h*h+f*f);l*=v,c*=v,h*=v,f*=v}}t[e]=l,t[e+1]=c,t[e+2]=h,t[e+3]=f}static multiplyQuaternionsFlat(t,e,n,i,r,o){let a=n[i],l=n[i+1],c=n[i+2],h=n[i+3],f=r[o],u=r[o+1],d=r[o+2],p=r[o+3];return t[e]=a*p+h*f+l*d-c*u,t[e+1]=l*p+h*u+c*f-a*d,t[e+2]=c*p+h*d+a*u-l*f,t[e+3]=h*p-a*f-l*u-c*d,t}get x(){return this._x}set x(t){this._x=t,this._onChangeCallback()}get y(){return this._y}set y(t){this._y=t,this._onChangeCallback()}get z(){return this._z}set z(t){this._z=t,this._onChangeCallback()}get w(){return this._w}set w(t){this._w=t,this._onChangeCallback()}set(t,e,n,i){return this._x=t,this._y=e,this._z=n,this._w=i,this._onChangeCallback(),this}clone(){return new this.constructor(this._x,this._y,this._z,this._w)}copy(t){return this._x=t.x,this._y=t.y,this._z=t.z,this._w=t.w,this._onChangeCallback(),this}setFromEuler(t,e=!0){let n=t._x,i=t._y,r=t._z,o=t._order,a=Math.cos,l=Math.sin,c=a(n/2),h=a(i/2),f=a(r/2),u=l(n/2),d=l(i/2),p=l(r/2);switch(o){case"XYZ":this._x=u*h*f+c*d*p,this._y=c*d*f-u*h*p,this._z=c*h*p+u*d*f,this._w=c*h*f-u*d*p;break;case"YXZ":this._x=u*h*f+c*d*p,this._y=c*d*f-u*h*p,this._z=c*h*p-u*d*f,this._w=c*h*f+u*d*p;break;case"ZXY":this._x=u*h*f-c*d*p,this._y=c*d*f+u*h*p,this._z=c*h*p+u*d*f,this._w=c*h*f-u*d*p;break;case"ZYX":this._x=u*h*f-c*d*p,this._y=c*d*f+u*h*p,this._z=c*h*p-u*d*f,this._w=c*h*f+u*d*p;break;case"YZX":this._x=u*h*f+c*d*p,this._y=c*d*f+u*h*p,this._z=c*h*p-u*d*f,this._w=c*h*f-u*d*p;break;case"XZY":this._x=u*h*f-c*d*p,this._y=c*d*f-u*h*p,this._z=c*h*p+u*d*f,this._w=c*h*f+u*d*p;break;default:St("Quaternion: .setFromEuler() encountered an unknown order: "+o)}return e===!0&&this._onChangeCallback(),this}setFromAxisAngle(t,e){let n=e/2,i=Math.sin(n);return this._x=t.x*i,this._y=t.y*i,this._z=t.z*i,this._w=Math.cos(n),this._onChangeCallback(),this}setFromRotationMatrix(t){let e=t.elements,n=e[0],i=e[4],r=e[8],o=e[1],a=e[5],l=e[9],c=e[2],h=e[6],f=e[10],u=n+a+f;if(u>0){let d=.5/Math.sqrt(u+1);this._w=.25/d,this._x=(h-l)*d,this._y=(r-c)*d,this._z=(o-i)*d}else if(n>a&&n>f){let d=2*Math.sqrt(1+n-a-f);this._w=(h-l)/d,this._x=.25*d,this._y=(i+o)/d,this._z=(r+c)/d}else if(a>f){let d=2*Math.sqrt(1+a-n-f);this._w=(r-c)/d,this._x=(i+o)/d,this._y=.25*d,this._z=(l+h)/d}else{let d=2*Math.sqrt(1+f-n-a);this._w=(o-i)/d,this._x=(r+c)/d,this._y=(l+h)/d,this._z=.25*d}return this._onChangeCallback(),this}setFromUnitVectors(t,e){let n=t.dot(e)+1;return n<1e-8?(n=0,Math.abs(t.x)>Math.abs(t.z)?(this._x=-t.y,this._y=t.x,this._z=0,this._w=n):(this._x=0,this._y=-t.z,this._z=t.y,this._w=n)):(this._x=t.y*e.z-t.z*e.y,this._y=t.z*e.x-t.x*e.z,this._z=t.x*e.y-t.y*e.x,this._w=n),this.normalize()}angleTo(t){return 2*Math.acos(Math.abs($t(this.dot(t),-1,1)))}rotateTowards(t,e){let n=this.angleTo(t);if(n===0)return this;let i=Math.min(1,e/n);return this.slerp(t,i),this}identity(){return this.set(0,0,0,1)}invert(){return this.conjugate()}conjugate(){return this._x*=-1,this._y*=-1,this._z*=-1,this._onChangeCallback(),this}dot(t){return this._x*t._x+this._y*t._y+this._z*t._z+this._w*t._w}lengthSq(){return this._x*this._x+this._y*this._y+this._z*this._z+this._w*this._w}length(){return Math.sqrt(this._x*this._x+this._y*this._y+this._z*this._z+this._w*this._w)}normalize(){let t=this.length();return t===0?(this._x=0,this._y=0,this._z=0,this._w=1):(t=1/t,this._x=this._x*t,this._y=this._y*t,this._z=this._z*t,this._w=this._w*t),this._onChangeCallback(),this}multiply(t){return this.multiplyQuaternions(this,t)}premultiply(t){return this.multiplyQuaternions(t,this)}multiplyQuaternions(t,e){let n=t._x,i=t._y,r=t._z,o=t._w,a=e._x,l=e._y,c=e._z,h=e._w;return this._x=n*h+o*a+i*c-r*l,this._y=i*h+o*l+r*a-n*c,this._z=r*h+o*c+n*l-i*a,this._w=o*h-n*a-i*l-r*c,this._onChangeCallback(),this}slerp(t,e){let n=t._x,i=t._y,r=t._z,o=t._w,a=this.dot(t);a<0&&(n=-n,i=-i,r=-r,o=-o,a=-a);let l=1-e;if(a<.9995){let c=Math.acos(a),h=Math.sin(c);l=Math.sin(l*c)/h,e=Math.sin(e*c)/h,this._x=this._x*l+n*e,this._y=this._y*l+i*e,this._z=this._z*l+r*e,this._w=this._w*l+o*e,this._onChangeCallback()}else this._x=this._x*l+n*e,this._y=this._y*l+i*e,this._z=this._z*l+r*e,this._w=this._w*l+o*e,this.normalize();return this}slerpQuaternions(t,e,n){return this.copy(t).slerp(e,n)}random(){let t=2*Math.PI*Math.random(),e=2*Math.PI*Math.random(),n=Math.random(),i=Math.sqrt(1-n),r=Math.sqrt(n);return this.set(i*Math.sin(t),i*Math.cos(t),r*Math.sin(e),r*Math.cos(e))}equals(t){return t._x===this._x&&t._y===this._y&&t._z===this._z&&t._w===this._w}fromArray(t,e=0){return this._x=t[e],this._y=t[e+1],this._z=t[e+2],this._w=t[e+3],this._onChangeCallback(),this}toArray(t=[],e=0){return t[e]=this._x,t[e+1]=this._y,t[e+2]=this._z,t[e+3]=this._w,t}fromBufferAttribute(t,e){return this._x=t.getX(e),this._y=t.getY(e),this._z=t.getZ(e),this._w=t.getW(e),this._onChangeCallback(),this}toJSON(){return this.toArray()}_onChange(t){return this._onChangeCallback=t,this}_onChangeCallback(){}*[Symbol.iterator](){yield this._x,yield this._y,yield this._z,yield this._w}},Bd=class Bd{constructor(t=0,e=0,n=0){this.x=t,this.y=e,this.z=n}set(t,e,n){return n===void 0&&(n=this.z),this.x=t,this.y=e,this.z=n,this}setScalar(t){return this.x=t,this.y=t,this.z=t,this}setX(t){return this.x=t,this}setY(t){return this.y=t,this}setZ(t){return this.z=t,this}setComponent(t,e){switch(t){case 0:this.x=e;break;case 1:this.y=e;break;case 2:this.z=e;break;default:throw new Error("THREE.Vector3: index is out of range: "+t)}return this}getComponent(t){switch(t){case 0:return this.x;case 1:return this.y;case 2:return this.z;default:throw new Error("THREE.Vector3: index is out of range: "+t)}}clone(){return new this.constructor(this.x,this.y,this.z)}copy(t){return this.x=t.x,this.y=t.y,this.z=t.z,this}add(t){return this.x+=t.x,this.y+=t.y,this.z+=t.z,this}addScalar(t){return this.x+=t,this.y+=t,this.z+=t,this}addVectors(t,e){return this.x=t.x+e.x,this.y=t.y+e.y,this.z=t.z+e.z,this}addScaledVector(t,e){return this.x+=t.x*e,this.y+=t.y*e,this.z+=t.z*e,this}sub(t){return this.x-=t.x,this.y-=t.y,this.z-=t.z,this}subScalar(t){return this.x-=t,this.y-=t,this.z-=t,this}subVectors(t,e){return this.x=t.x-e.x,this.y=t.y-e.y,this.z=t.z-e.z,this}multiply(t){return this.x*=t.x,this.y*=t.y,this.z*=t.z,this}multiplyScalar(t){return this.x*=t,this.y*=t,this.z*=t,this}multiplyVectors(t,e){return this.x=t.x*e.x,this.y=t.y*e.y,this.z=t.z*e.z,this}applyEuler(t){return this.applyQuaternion(im.setFromEuler(t))}applyAxisAngle(t,e){return this.applyQuaternion(im.setFromAxisAngle(t,e))}applyMatrix3(t){let e=this.x,n=this.y,i=this.z,r=t.elements;return this.x=r[0]*e+r[3]*n+r[6]*i,this.y=r[1]*e+r[4]*n+r[7]*i,this.z=r[2]*e+r[5]*n+r[8]*i,this}applyNormalMatrix(t){return this.applyMatrix3(t).normalize()}applyMatrix4(t){let e=this.x,n=this.y,i=this.z,r=t.elements,o=1/(r[3]*e+r[7]*n+r[11]*i+r[15]);return this.x=(r[0]*e+r[4]*n+r[8]*i+r[12])*o,this.y=(r[1]*e+r[5]*n+r[9]*i+r[13])*o,this.z=(r[2]*e+r[6]*n+r[10]*i+r[14])*o,this}applyQuaternion(t){let e=this.x,n=this.y,i=this.z,r=t.x,o=t.y,a=t.z,l=t.w,c=2*(o*i-a*n),h=2*(a*e-r*i),f=2*(r*n-o*e);return this.x=e+l*c+o*f-a*h,this.y=n+l*h+a*c-r*f,this.z=i+l*f+r*h-o*c,this}project(t){return this.applyMatrix4(t.matrixWorldInverse).applyMatrix4(t.projectionMatrix)}unproject(t){return this.applyMatrix4(t.projectionMatrixInverse).applyMatrix4(t.matrixWorld)}transformDirection(t){let e=this.x,n=this.y,i=this.z,r=t.elements;return this.x=r[0]*e+r[4]*n+r[8]*i,this.y=r[1]*e+r[5]*n+r[9]*i,this.z=r[2]*e+r[6]*n+r[10]*i,this.normalize()}divide(t){return this.x/=t.x,this.y/=t.y,this.z/=t.z,this}divideScalar(t){return this.multiplyScalar(1/t)}min(t){return this.x=Math.min(this.x,t.x),this.y=Math.min(this.y,t.y),this.z=Math.min(this.z,t.z),this}max(t){return this.x=Math.max(this.x,t.x),this.y=Math.max(this.y,t.y),this.z=Math.max(this.z,t.z),this}clamp(t,e){return this.x=$t(this.x,t.x,e.x),this.y=$t(this.y,t.y,e.y),this.z=$t(this.z,t.z,e.z),this}clampScalar(t,e){return this.x=$t(this.x,t,e),this.y=$t(this.y,t,e),this.z=$t(this.z,t,e),this}clampLength(t,e){let n=this.length();return this.divideScalar(n||1).multiplyScalar($t(n,t,e))}floor(){return this.x=Math.floor(this.x),this.y=Math.floor(this.y),this.z=Math.floor(this.z),this}ceil(){return this.x=Math.ceil(this.x),this.y=Math.ceil(this.y),this.z=Math.ceil(this.z),this}round(){return this.x=Math.round(this.x),this.y=Math.round(this.y),this.z=Math.round(this.z),this}roundToZero(){return this.x=Math.trunc(this.x),this.y=Math.trunc(this.y),this.z=Math.trunc(this.z),this}negate(){return this.x=-this.x,this.y=-this.y,this.z=-this.z,this}dot(t){return this.x*t.x+this.y*t.y+this.z*t.z}lengthSq(){return this.x*this.x+this.y*this.y+this.z*this.z}length(){return Math.sqrt(this.x*this.x+this.y*this.y+this.z*this.z)}manhattanLength(){return Math.abs(this.x)+Math.abs(this.y)+Math.abs(this.z)}normalize(){return this.divideScalar(this.length()||1)}setLength(t){return this.normalize().multiplyScalar(t)}lerp(t,e){return this.x+=(t.x-this.x)*e,this.y+=(t.y-this.y)*e,this.z+=(t.z-this.z)*e,this}lerpVectors(t,e,n){return this.x=t.x+(e.x-t.x)*n,this.y=t.y+(e.y-t.y)*n,this.z=t.z+(e.z-t.z)*n,this}cross(t){return this.crossVectors(this,t)}crossVectors(t,e){let n=t.x,i=t.y,r=t.z,o=e.x,a=e.y,l=e.z;return this.x=i*l-r*a,this.y=r*o-n*l,this.z=n*a-i*o,this}projectOnVector(t){let e=t.lengthSq();if(e===0)return this.set(0,0,0);let n=t.dot(this)/e;return this.copy(t).multiplyScalar(n)}projectOnPlane(t){return Ju.copy(this).projectOnVector(t),this.sub(Ju)}reflect(t){return this.sub(Ju.copy(t).multiplyScalar(2*this.dot(t)))}angleTo(t){let e=Math.sqrt(this.lengthSq()*t.lengthSq());if(e===0)return Math.PI/2;let n=this.dot(t)/e;return Math.acos($t(n,-1,1))}distanceTo(t){return Math.sqrt(this.distanceToSquared(t))}distanceToSquared(t){let e=this.x-t.x,n=this.y-t.y,i=this.z-t.z;return e*e+n*n+i*i}manhattanDistanceTo(t){return Math.abs(this.x-t.x)+Math.abs(this.y-t.y)+Math.abs(this.z-t.z)}setFromSpherical(t){return this.setFromSphericalCoords(t.radius,t.phi,t.theta)}setFromSphericalCoords(t,e,n){let i=Math.sin(e)*t;return this.x=i*Math.sin(n),this.y=Math.cos(e)*t,this.z=i*Math.cos(n),this}setFromCylindrical(t){return this.setFromCylindricalCoords(t.radius,t.theta,t.y)}setFromCylindricalCoords(t,e,n){return this.x=t*Math.sin(e),this.y=n,this.z=t*Math.cos(e),this}setFromMatrixPosition(t){let e=t.elements;return this.x=e[12],this.y=e[13],this.z=e[14],this}setFromMatrixScale(t){let e=this.setFromMatrixColumn(t,0).length(),n=this.setFromMatrixColumn(t,1).length(),i=this.setFromMatrixColumn(t,2).length();return this.x=e,this.y=n,this.z=i,this}setFromMatrixColumn(t,e){return this.fromArray(t.elements,e*4)}setFromMatrix3Column(t,e){return this.fromArray(t.elements,e*3)}setFromEuler(t){return this.x=t._x,this.y=t._y,this.z=t._z,this}setFromColor(t){return this.x=t.r,this.y=t.g,this.z=t.b,this}equals(t){return t.x===this.x&&t.y===this.y&&t.z===this.z}fromArray(t,e=0){return this.x=t[e],this.y=t[e+1],this.z=t[e+2],this}toArray(t=[],e=0){return t[e]=this.x,t[e+1]=this.y,t[e+2]=this.z,t}fromBufferAttribute(t,e){return this.x=t.getX(e),this.y=t.getY(e),this.z=t.getZ(e),this}random(){return this.x=Math.random(),this.y=Math.random(),this.z=Math.random(),this}randomDirection(){let t=Math.random()*Math.PI*2,e=Math.random()*2-1,n=Math.sqrt(1-e*e);return this.x=n*Math.cos(t),this.y=e,this.z=n*Math.sin(t),this}*[Symbol.iterator](){yield this.x,yield this.y,yield this.z}};Bd.prototype.isVector3=!0;var P=Bd,Ju=new P,im=new ze,zd=class zd{constructor(t,e,n,i,r,o,a,l,c){this.elements=[1,0,0,0,1,0,0,0,1],t!==void 0&&this.set(t,e,n,i,r,o,a,l,c)}set(t,e,n,i,r,o,a,l,c){let h=this.elements;return h[0]=t,h[1]=i,h[2]=a,h[3]=e,h[4]=r,h[5]=l,h[6]=n,h[7]=o,h[8]=c,this}identity(){return this.set(1,0,0,0,1,0,0,0,1),this}copy(t){let e=this.elements,n=t.elements;return e[0]=n[0],e[1]=n[1],e[2]=n[2],e[3]=n[3],e[4]=n[4],e[5]=n[5],e[6]=n[6],e[7]=n[7],e[8]=n[8],this}extractBasis(t,e,n){return t.setFromMatrix3Column(this,0),e.setFromMatrix3Column(this,1),n.setFromMatrix3Column(this,2),this}setFromMatrix4(t){let e=t.elements;return this.set(e[0],e[4],e[8],e[1],e[5],e[9],e[2],e[6],e[10]),this}multiply(t){return this.multiplyMatrices(this,t)}premultiply(t){return this.multiplyMatrices(t,this)}multiplyMatrices(t,e){let n=t.elements,i=e.elements,r=this.elements,o=n[0],a=n[3],l=n[6],c=n[1],h=n[4],f=n[7],u=n[2],d=n[5],p=n[8],x=i[0],m=i[3],g=i[6],v=i[1],b=i[4],y=i[7],M=i[2],S=i[5],w=i[8];return r[0]=o*x+a*v+l*M,r[3]=o*m+a*b+l*S,r[6]=o*g+a*y+l*w,r[1]=c*x+h*v+f*M,r[4]=c*m+h*b+f*S,r[7]=c*g+h*y+f*w,r[2]=u*x+d*v+p*M,r[5]=u*m+d*b+p*S,r[8]=u*g+d*y+p*w,this}multiplyScalar(t){let e=this.elements;return e[0]*=t,e[3]*=t,e[6]*=t,e[1]*=t,e[4]*=t,e[7]*=t,e[2]*=t,e[5]*=t,e[8]*=t,this}determinant(){let t=this.elements,e=t[0],n=t[1],i=t[2],r=t[3],o=t[4],a=t[5],l=t[6],c=t[7],h=t[8];return e*o*h-e*a*c-n*r*h+n*a*l+i*r*c-i*o*l}invert(){let t=this.elements,e=t[0],n=t[1],i=t[2],r=t[3],o=t[4],a=t[5],l=t[6],c=t[7],h=t[8],f=h*o-a*c,u=a*l-h*r,d=c*r-o*l,p=e*f+n*u+i*d;if(p===0)return this.set(0,0,0,0,0,0,0,0,0);let x=1/p;return t[0]=f*x,t[1]=(i*c-h*n)*x,t[2]=(a*n-i*o)*x,t[3]=u*x,t[4]=(h*e-i*l)*x,t[5]=(i*r-a*e)*x,t[6]=d*x,t[7]=(n*l-c*e)*x,t[8]=(o*e-n*r)*x,this}transpose(){let t,e=this.elements;return t=e[1],e[1]=e[3],e[3]=t,t=e[2],e[2]=e[6],e[6]=t,t=e[5],e[5]=e[7],e[7]=t,this}getNormalMatrix(t){return this.setFromMatrix4(t).invert().transpose()}transposeIntoArray(t){let e=this.elements;return t[0]=e[0],t[1]=e[3],t[2]=e[6],t[3]=e[1],t[4]=e[4],t[5]=e[7],t[6]=e[2],t[7]=e[5],t[8]=e[8],this}setUvTransform(t,e,n,i,r,o,a){let l=Math.cos(r),c=Math.sin(r);return this.set(n*l,n*c,-n*(l*o+c*a)+o+t,-i*c,i*l,-i*(-c*o+l*a)+a+e,0,0,1),this}scale(t,e){return ti("Matrix3: .scale() is deprecated. Use .makeScale() instead."),this.premultiply($u.makeScale(t,e)),this}rotate(t){return ti("Matrix3: .rotate() is deprecated. Use .makeRotation() instead."),this.premultiply($u.makeRotation(-t)),this}translate(t,e){return ti("Matrix3: .translate() is deprecated. Use .makeTranslation() instead."),this.premultiply($u.makeTranslation(t,e)),this}makeTranslation(t,e){return t.isVector2?this.set(1,0,t.x,0,1,t.y,0,0,1):this.set(1,0,t,0,1,e,0,0,1),this}makeRotation(t){let e=Math.cos(t),n=Math.sin(t);return this.set(e,-n,0,n,e,0,0,0,1),this}makeScale(t,e){return this.set(t,0,0,0,e,0,0,0,1),this}equals(t){let e=this.elements,n=t.elements;for(let i=0;i<9;i++)if(e[i]!==n[i])return!1;return!0}fromArray(t,e=0){for(let n=0;n<9;n++)this.elements[n]=t[n+e];return this}toArray(t=[],e=0){let n=this.elements;return t[e]=n[0],t[e+1]=n[1],t[e+2]=n[2],t[e+3]=n[3],t[e+4]=n[4],t[e+5]=n[5],t[e+6]=n[6],t[e+7]=n[7],t[e+8]=n[8],t}clone(){return new this.constructor().fromArray(this.elements)}};zd.prototype.isMatrix3=!0;var jt=zd,$u=new jt,sm=new jt().set(.4123908,.3575843,.1804808,.212639,.7151687,.0721923,.0193308,.1191948,.9505322),rm=new jt().set(3.2409699,-1.5373832,-.4986108,-.9692436,1.8759675,.0415551,.0556301,-.203977,1.0569715);function f_(){let s={enabled:!0,workingColorSpace:Mr,spaces:{},convert:function(i,r,o){return this.enabled===!1||r===o||!r||!o||(this.spaces[r].transfer===ue&&(i.r=vi(i.r),i.g=vi(i.g),i.b=vi(i.b)),this.spaces[r].primaries!==this.spaces[o].primaries&&(i.applyMatrix3(this.spaces[r].toXYZ),i.applyMatrix3(this.spaces[o].fromXYZ)),this.spaces[o].transfer===ue&&(i.r=xr(i.r),i.g=xr(i.g),i.b=xr(i.b))),i},workingToColorSpace:function(i,r){return this.convert(i,this.workingColorSpace,r)},colorSpaceToWorking:function(i,r){return this.convert(i,r,this.workingColorSpace)},getPrimaries:function(i){return this.spaces[i].primaries},getTransfer:function(i){return i===ai?Sr:this.spaces[i].transfer},getToneMappingMode:function(i){return this.spaces[i].outputColorSpaceConfig.toneMappingMode||"standard"},getLuminanceCoefficients:function(i,r=this.workingColorSpace){return i.fromArray(this.spaces[r].luminanceCoefficients)},define:function(i){Object.assign(this.spaces,i)},_getMatrix:function(i,r,o){return i.copy(this.spaces[r].toXYZ).multiply(this.spaces[o].fromXYZ)},_getDrawingBufferColorSpace:function(i){return this.spaces[i].outputColorSpaceConfig.drawingBufferColorSpace},_getUnpackColorSpace:function(i=this.workingColorSpace){return this.spaces[i].workingColorSpaceConfig.unpackColorSpace},fromWorkingColorSpace:function(i,r){return ti("ColorManagement: .fromWorkingColorSpace() has been renamed to .workingToColorSpace()."),s.workingToColorSpace(i,r)},toWorkingColorSpace:function(i,r){return ti("ColorManagement: .toWorkingColorSpace() has been renamed to .colorSpaceToWorking()."),s.colorSpaceToWorking(i,r)}},t=[.64,.33,.3,.6,.15,.06],e=[.2126,.7152,.0722],n=[.3127,.329];return s.define({[Mr]:{primaries:t,whitePoint:n,transfer:Sr,toXYZ:sm,fromXYZ:rm,luminanceCoefficients:e,workingColorSpaceConfig:{unpackColorSpace:Ee},outputColorSpaceConfig:{drawingBufferColorSpace:Ee}},[Ee]:{primaries:t,whitePoint:n,transfer:ue,toXYZ:sm,fromXYZ:rm,luminanceCoefficients:e,outputColorSpaceConfig:{drawingBufferColorSpace:Ee}}}),s}var re=f_();function vi(s){return s<.04045?s*.0773993808:Math.pow(s*.9478672986+.0521327014,2.4)}function xr(s){return s<.0031308?s*12.92:1.055*Math.pow(s,.41666)-.055}var $s,Yo=class{static getDataURL(t,e="image/png"){if(/^data:/i.test(t.src)||typeof HTMLCanvasElement>"u")return t.src;let n;if(t instanceof HTMLCanvasElement)n=t;else{$s===void 0&&($s=br("canvas")),$s.width=t.width,$s.height=t.height;let i=$s.getContext("2d");t instanceof ImageData?i.putImageData(t,0,0):i.drawImage(t,0,0,t.width,t.height),n=$s}return n.toDataURL(e)}static sRGBToLinear(t){if(typeof HTMLImageElement<"u"&&t instanceof HTMLImageElement||typeof HTMLCanvasElement<"u"&&t instanceof HTMLCanvasElement||typeof ImageBitmap<"u"&&t instanceof ImageBitmap){let e=br("canvas");e.width=t.width,e.height=t.height;let n=e.getContext("2d");n.drawImage(t,0,0,t.width,t.height);let i=n.getImageData(0,0,t.width,t.height),r=i.data;for(let o=0;o<r.length;o++)r[o]=vi(r[o]/255)*255;return n.putImageData(i,0,0),e}else if(t.data){let e=t.data.slice(0);for(let n=0;n<e.length;n++)e instanceof Uint8Array||e instanceof Uint8ClampedArray?e[n]=Math.floor(vi(e[n]/255)*255):e[n]=vi(e[n]);return{data:e,width:t.width,height:t.height}}else return St("ImageUtils.sRGBToLinear(): Unsupported image type. No color space conversion applied."),t}},d_=0,Cn=class{constructor(t=null){this.isTextureSource=!0,Object.defineProperty(this,"id",{value:d_++}),this.uuid=Sn(),this.data=t,this.dataReady=!0,this.version=0}getSize(t){let e=this.data;return typeof HTMLVideoElement<"u"&&e instanceof HTMLVideoElement?t.set(e.videoWidth,e.videoHeight,0):typeof VideoFrame<"u"&&e instanceof VideoFrame?t.set(e.displayWidth,e.displayHeight,0):e!==null?t.set(e.width,e.height,e.depth||0):t.set(0,0,0),t}set needsUpdate(t){t===!0&&this.version++}toJSON(t){let e=t===void 0||typeof t=="string";if(!e&&t.images[this.uuid]!==void 0)return t.images[this.uuid];let n={uuid:this.uuid,url:""},i=this.data;if(i!==null){let r;if(Array.isArray(i)){r=[];for(let o=0,a=i.length;o<a;o++)i[o].isDataTexture?r.push(Ku(i[o].image)):r.push(Ku(i[o]))}else r=Ku(i);n.url=r}return e||(t.images[this.uuid]=n),n}};function Ku(s){return typeof HTMLImageElement<"u"&&s instanceof HTMLImageElement||typeof HTMLCanvasElement<"u"&&s instanceof HTMLCanvasElement||typeof ImageBitmap<"u"&&s instanceof ImageBitmap?Yo.getDataURL(s):s.data?{data:Array.from(s.data),width:s.width,height:s.height,type:s.data.constructor.name}:(St("Texture: Unable to serialize Texture."),{})}var Qc=class extends Cn{constructor(t=null){ti('Source: "Source" has been renamed to "TextureSource". Please update your code to use "THREE.TextureSource" instead.'),super(t),this.isSource=!0}},p_=0,Qu=new P,Pe=class s extends _n{constructor(t=s.DEFAULT_IMAGE,e=s.DEFAULT_MAPPING,n=Ce,i=Ce,r=le,o=Ve,a=nn,l=dn,c=s.DEFAULT_ANISOTROPY,h=ai){super(),this.isTexture=!0,Object.defineProperty(this,"id",{value:p_++}),this.uuid=Sn(),this.name="",this.source=new Cn(t),this.mipmaps=[],this.mapping=e,this.channel=0,this.wrapS=n,this.wrapT=i,this.magFilter=r,this.minFilter=o,this.anisotropy=c,this.format=a,this.internalFormat=null,this.type=l,this.offset=new rt(0,0),this.repeat=new rt(1,1),this.center=new rt(0,0),this.rotation=0,this.matrixAutoUpdate=!0,this.matrix=new jt,this.generateMipmaps=!0,this.premultiplyAlpha=!1,this.flipY=!0,this.unpackAlignment=4,this.colorSpace=h,this.userData={},this.updateRanges=[],this.version=0,this.onUpdate=null,this.renderTarget=null,this.isRenderTargetTexture=!1,this.isArrayTexture=!!(t&&t.depth&&t.depth>1),this.pmremVersion=0,this.normalized=!1}get width(){return this.source.getSize(Qu).x}get height(){return this.source.getSize(Qu).y}get depth(){return this.source.getSize(Qu).z}get image(){return this.source.data}set image(t){this.source.data=t}updateMatrix(){this.matrix.setUvTransform(this.offset.x,this.offset.y,this.repeat.x,this.repeat.y,this.rotation,this.center.x,this.center.y)}addUpdateRange(t,e){this.updateRanges.push({start:t,count:e})}clearUpdateRanges(){this.updateRanges.length=0}clone(){return new this.constructor().copy(this)}copy(t){return this.name=t.name,this.source=t.source,this.mipmaps=t.mipmaps.slice(0),this.mapping=t.mapping,this.channel=t.channel,this.wrapS=t.wrapS,this.wrapT=t.wrapT,this.magFilter=t.magFilter,this.minFilter=t.minFilter,this.anisotropy=t.anisotropy,this.format=t.format,this.internalFormat=t.internalFormat,this.type=t.type,this.normalized=t.normalized,this.offset.copy(t.offset),this.repeat.copy(t.repeat),this.center.copy(t.center),this.rotation=t.rotation,this.matrixAutoUpdate=t.matrixAutoUpdate,this.matrix.copy(t.matrix),this.generateMipmaps=t.generateMipmaps,this.premultiplyAlpha=t.premultiplyAlpha,this.flipY=t.flipY,this.unpackAlignment=t.unpackAlignment,this.colorSpace=t.colorSpace,this.renderTarget=t.renderTarget,this.isRenderTargetTexture=t.isRenderTargetTexture,this.isArrayTexture=t.isArrayTexture,this.userData=JSON.parse(JSON.stringify(t.userData)),this.needsUpdate=!0,this}setValues(t){for(let e in t){let n=t[e];if(n===void 0){St(`Texture.setValues(): parameter '${e}' has value of undefined.`);continue}let i=this[e];if(i===void 0){St(`Texture.setValues(): property '${e}' does not exist.`);continue}i&&n&&i.isVector2&&n.isVector2||i&&n&&i.isVector3&&n.isVector3||i&&n&&i.isMatrix3&&n.isMatrix3?i.copy(n):this[e]=n}}toJSON(t){let e=t===void 0||typeof t=="string";if(!e&&t.textures[this.uuid]!==void 0)return t.textures[this.uuid];let n={metadata:{version:4.7,type:"Texture",generator:"Texture.toJSON"},uuid:this.uuid,name:this.name,image:this.source.toJSON(t).uuid,mapping:this.mapping,channel:this.channel,repeat:[this.repeat.x,this.repeat.y],offset:[this.offset.x,this.offset.y],center:[this.center.x,this.center.y],rotation:this.rotation,wrap:[this.wrapS,this.wrapT],format:this.format,internalFormat:this.internalFormat,type:this.type,normalized:this.normalized,colorSpace:this.colorSpace,minFilter:this.minFilter,magFilter:this.magFilter,anisotropy:this.anisotropy,flipY:this.flipY,generateMipmaps:this.generateMipmaps,premultiplyAlpha:this.premultiplyAlpha,unpackAlignment:this.unpackAlignment};return Object.keys(this.userData).length>0&&(n.userData=this.userData),e||(t.textures[this.uuid]=n),n}dispose(){this.dispatchEvent({type:"dispose"})}transformUv(t){if(this.mapping!==il)return t;if(t.applyMatrix3(this.matrix),t.x<0||t.x>1)switch(this.wrapS){case In:t.x=t.x-Math.floor(t.x);break;case Ce:t.x=t.x<0?0:1;break;case _r:Math.abs(Math.floor(t.x)%2)===1?t.x=Math.ceil(t.x)-t.x:t.x=t.x-Math.floor(t.x);break}if(t.y<0||t.y>1)switch(this.wrapT){case In:t.y=t.y-Math.floor(t.y);break;case Ce:t.y=t.y<0?0:1;break;case _r:Math.abs(Math.floor(t.y)%2)===1?t.y=Math.ceil(t.y)-t.y:t.y=t.y-Math.floor(t.y);break}return this.flipY&&(t.y=1-t.y),t}set needsUpdate(t){t===!0&&(this.version++,this.source.needsUpdate=!0)}set needsPMREMUpdate(t){t===!0&&this.pmremVersion++}};Pe.DEFAULT_IMAGE=null;Pe.DEFAULT_MAPPING=il;Pe.DEFAULT_ANISOTROPY=1;var kd=class kd{constructor(t=0,e=0,n=0,i=1){this.x=t,this.y=e,this.z=n,this.w=i}get width(){return this.z}set width(t){this.z=t}get height(){return this.w}set height(t){this.w=t}set(t,e,n,i){return this.x=t,this.y=e,this.z=n,this.w=i,this}setScalar(t){return this.x=t,this.y=t,this.z=t,this.w=t,this}setX(t){return this.x=t,this}setY(t){return this.y=t,this}setZ(t){return this.z=t,this}setW(t){return this.w=t,this}setComponent(t,e){switch(t){case 0:this.x=e;break;case 1:this.y=e;break;case 2:this.z=e;break;case 3:this.w=e;break;default:throw new Error("THREE.Vector4: index is out of range: "+t)}return this}getComponent(t){switch(t){case 0:return this.x;case 1:return this.y;case 2:return this.z;case 3:return this.w;default:throw new Error("THREE.Vector4: index is out of range: "+t)}}clone(){return new this.constructor(this.x,this.y,this.z,this.w)}copy(t){return this.x=t.x,this.y=t.y,this.z=t.z,this.w=t.w!==void 0?t.w:1,this}add(t){return this.x+=t.x,this.y+=t.y,this.z+=t.z,this.w+=t.w,this}addScalar(t){return this.x+=t,this.y+=t,this.z+=t,this.w+=t,this}addVectors(t,e){return this.x=t.x+e.x,this.y=t.y+e.y,this.z=t.z+e.z,this.w=t.w+e.w,this}addScaledVector(t,e){return this.x+=t.x*e,this.y+=t.y*e,this.z+=t.z*e,this.w+=t.w*e,this}sub(t){return this.x-=t.x,this.y-=t.y,this.z-=t.z,this.w-=t.w,this}subScalar(t){return this.x-=t,this.y-=t,this.z-=t,this.w-=t,this}subVectors(t,e){return this.x=t.x-e.x,this.y=t.y-e.y,this.z=t.z-e.z,this.w=t.w-e.w,this}multiply(t){return this.x*=t.x,this.y*=t.y,this.z*=t.z,this.w*=t.w,this}multiplyScalar(t){return this.x*=t,this.y*=t,this.z*=t,this.w*=t,this}applyMatrix4(t){let e=this.x,n=this.y,i=this.z,r=this.w,o=t.elements;return this.x=o[0]*e+o[4]*n+o[8]*i+o[12]*r,this.y=o[1]*e+o[5]*n+o[9]*i+o[13]*r,this.z=o[2]*e+o[6]*n+o[10]*i+o[14]*r,this.w=o[3]*e+o[7]*n+o[11]*i+o[15]*r,this}divide(t){return this.x/=t.x,this.y/=t.y,this.z/=t.z,this.w/=t.w,this}divideScalar(t){return this.multiplyScalar(1/t)}setAxisAngleFromQuaternion(t){this.w=2*Math.acos(t.w);let e=Math.sqrt(1-t.w*t.w);return e<1e-4?(this.x=1,this.y=0,this.z=0):(this.x=t.x/e,this.y=t.y/e,this.z=t.z/e),this}setAxisAngleFromRotationMatrix(t){let e,n,i,r,l=t.elements,c=l[0],h=l[4],f=l[8],u=l[1],d=l[5],p=l[9],x=l[2],m=l[6],g=l[10];if(Math.abs(h-u)<.01&&Math.abs(f-x)<.01&&Math.abs(p-m)<.01){if(Math.abs(h+u)<.1&&Math.abs(f+x)<.1&&Math.abs(p+m)<.1&&Math.abs(c+d+g-3)<.1)return this.set(1,0,0,0),this;e=Math.PI;let b=(c+1)/2,y=(d+1)/2,M=(g+1)/2,S=(h+u)/4,w=(f+x)/4,_=(p+m)/4;return b>y&&b>M?b<.01?(n=0,i=.707106781,r=.707106781):(n=Math.sqrt(b),i=S/n,r=w/n):y>M?y<.01?(n=.707106781,i=0,r=.707106781):(i=Math.sqrt(y),n=S/i,r=_/i):M<.01?(n=.707106781,i=.707106781,r=0):(r=Math.sqrt(M),n=w/r,i=_/r),this.set(n,i,r,e),this}let v=Math.sqrt((m-p)*(m-p)+(f-x)*(f-x)+(u-h)*(u-h));return Math.abs(v)<.001&&(v=1),this.x=(m-p)/v,this.y=(f-x)/v,this.z=(u-h)/v,this.w=Math.acos((c+d+g-1)/2),this}setFromMatrixPosition(t){let e=t.elements;return this.x=e[12],this.y=e[13],this.z=e[14],this.w=e[15],this}min(t){return this.x=Math.min(this.x,t.x),this.y=Math.min(this.y,t.y),this.z=Math.min(this.z,t.z),this.w=Math.min(this.w,t.w),this}max(t){return this.x=Math.max(this.x,t.x),this.y=Math.max(this.y,t.y),this.z=Math.max(this.z,t.z),this.w=Math.max(this.w,t.w),this}clamp(t,e){return this.x=$t(this.x,t.x,e.x),this.y=$t(this.y,t.y,e.y),this.z=$t(this.z,t.z,e.z),this.w=$t(this.w,t.w,e.w),this}clampScalar(t,e){return this.x=$t(this.x,t,e),this.y=$t(this.y,t,e),this.z=$t(this.z,t,e),this.w=$t(this.w,t,e),this}clampLength(t,e){let n=this.length();return this.divideScalar(n||1).multiplyScalar($t(n,t,e))}floor(){return this.x=Math.floor(this.x),this.y=Math.floor(this.y),this.z=Math.floor(this.z),this.w=Math.floor(this.w),this}ceil(){return this.x=Math.ceil(this.x),this.y=Math.ceil(this.y),this.z=Math.ceil(this.z),this.w=Math.ceil(this.w),this}round(){return this.x=Math.round(this.x),this.y=Math.round(this.y),this.z=Math.round(this.z),this.w=Math.round(this.w),this}roundToZero(){return this.x=Math.trunc(this.x),this.y=Math.trunc(this.y),this.z=Math.trunc(this.z),this.w=Math.trunc(this.w),this}negate(){return this.x=-this.x,this.y=-this.y,this.z=-this.z,this.w=-this.w,this}dot(t){return this.x*t.x+this.y*t.y+this.z*t.z+this.w*t.w}lengthSq(){return this.x*this.x+this.y*this.y+this.z*this.z+this.w*this.w}length(){return Math.sqrt(this.x*this.x+this.y*this.y+this.z*this.z+this.w*this.w)}manhattanLength(){return Math.abs(this.x)+Math.abs(this.y)+Math.abs(this.z)+Math.abs(this.w)}normalize(){return this.divideScalar(this.length()||1)}setLength(t){return this.normalize().multiplyScalar(t)}lerp(t,e){return this.x+=(t.x-this.x)*e,this.y+=(t.y-this.y)*e,this.z+=(t.z-this.z)*e,this.w+=(t.w-this.w)*e,this}lerpVectors(t,e,n){return this.x=t.x+(e.x-t.x)*n,this.y=t.y+(e.y-t.y)*n,this.z=t.z+(e.z-t.z)*n,this.w=t.w+(e.w-t.w)*n,this}equals(t){return t.x===this.x&&t.y===this.y&&t.z===this.z&&t.w===this.w}fromArray(t,e=0){return this.x=t[e],this.y=t[e+1],this.z=t[e+2],this.w=t[e+3],this}toArray(t=[],e=0){return t[e]=this.x,t[e+1]=this.y,t[e+2]=this.z,t[e+3]=this.w,t}fromBufferAttribute(t,e){return this.x=t.getX(e),this.y=t.getY(e),this.z=t.getZ(e),this.w=t.getW(e),this}random(){return this.x=Math.random(),this.y=Math.random(),this.z=Math.random(),this.w=Math.random(),this}*[Symbol.iterator](){yield this.x,yield this.y,yield this.z,yield this.w}};kd.prototype.isVector4=!0;var ge=kd,Tr=class extends _n{constructor(t=1,e=1,n={}){super(),n=Object.assign({generateMipmaps:!1,internalFormat:null,minFilter:le,depthBuffer:!0,stencilBuffer:!1,resolveColorBuffer:!0,resolveDepthBuffer:!0,resolveStencilBuffer:!0,storeMultisampledColorBuffer:!0,storeMultisampledDepthBuffer:!0,storeMultisampledStencilBuffer:!0,depthTexture:null,samples:0,count:1,depth:1,multiview:!1,useArrayDepthTexture:!1},n),this.isRenderTarget=!0,this.width=t,this.height=e,this.depth=n.depth,this.scissor=new ge(0,0,t,e),this.scissorTest=!1,this.viewport=new ge(0,0,t,e),this.textures=[];let i={width:t,height:e,depth:n.depth},r=new Pe(i),o=n.count;for(let a=0;a<o;a++)this.textures[a]=r.clone(),this.textures[a].isRenderTargetTexture=!0,this.textures[a].renderTarget=this;this._setTextureOptions(n),this.depthBuffer=n.depthBuffer,this.stencilBuffer=n.stencilBuffer,this.resolveColorBuffer=n.resolveColorBuffer,this.resolveDepthBuffer=n.resolveDepthBuffer,this.resolveStencilBuffer=n.resolveStencilBuffer,this.storeMultisampledColorBuffer=n.storeMultisampledColorBuffer,this.storeMultisampledDepthBuffer=n.storeMultisampledDepthBuffer,this.storeMultisampledStencilBuffer=n.storeMultisampledStencilBuffer,this._depthTexture=null,this.depthTexture=n.depthTexture,this.samples=n.samples,this.multiview=n.multiview,this.useArrayDepthTexture=n.useArrayDepthTexture}_setTextureOptions(t={}){let e={minFilter:le,generateMipmaps:!1,flipY:!1,internalFormat:null};t.mapping!==void 0&&(e.mapping=t.mapping),t.wrapS!==void 0&&(e.wrapS=t.wrapS),t.wrapT!==void 0&&(e.wrapT=t.wrapT),t.wrapR!==void 0&&(e.wrapR=t.wrapR),t.magFilter!==void 0&&(e.magFilter=t.magFilter),t.minFilter!==void 0&&(e.minFilter=t.minFilter),t.format!==void 0&&(e.format=t.format),t.type!==void 0&&(e.type=t.type),t.anisotropy!==void 0&&(e.anisotropy=t.anisotropy),t.colorSpace!==void 0&&(e.colorSpace=t.colorSpace),t.flipY!==void 0&&(e.flipY=t.flipY),t.generateMipmaps!==void 0&&(e.generateMipmaps=t.generateMipmaps),t.internalFormat!==void 0&&(e.internalFormat=t.internalFormat);for(let n=0;n<this.textures.length;n++)this.textures[n].setValues(e)}get texture(){return this.textures[0]}set texture(t){this.textures[0]=t}set depthTexture(t){this._depthTexture!==null&&this._depthTexture.renderTarget===this&&(this._depthTexture.renderTarget=null),t!==null&&t.renderTarget===null&&(t.renderTarget=this),this._depthTexture=t}get depthTexture(){return this._depthTexture}setSize(t,e,n=1){if(this.width!==t||this.height!==e||this.depth!==n){this.width=t,this.height=e,this.depth=n;for(let i=0,r=this.textures.length;i<r;i++)this.textures[i].image.width=t,this.textures[i].image.height=e,this.textures[i].image.depth=n,this.textures[i].isData3DTexture!==!0&&(this.textures[i].isArrayTexture=this.textures[i].image.depth>1);this.dispose()}this.viewport.set(0,0,t,e),this.scissor.set(0,0,t,e)}clone(){return new this.constructor().copy(this)}copy(t){this.width=t.width,this.height=t.height,this.depth=t.depth,this.scissor.copy(t.scissor),this.scissorTest=t.scissorTest,this.viewport.copy(t.viewport),this.textures.length=0;for(let e=0,n=t.textures.length;e<n;e++){this.textures[e]=t.textures[e].clone(),this.textures[e].isRenderTargetTexture=!0,this.textures[e].renderTarget=this;let i=Object.assign({},t.textures[e].image);this.textures[e].source=new Cn(i)}if(this.depthBuffer=t.depthBuffer,this.stencilBuffer=t.stencilBuffer,this.resolveColorBuffer=t.resolveColorBuffer,this.resolveDepthBuffer=t.resolveDepthBuffer,this.resolveStencilBuffer=t.resolveStencilBuffer,this.storeMultisampledColorBuffer=t.storeMultisampledColorBuffer,this.storeMultisampledDepthBuffer=t.storeMultisampledDepthBuffer,this.storeMultisampledStencilBuffer=t.storeMultisampledStencilBuffer,t.depthTexture!==null)if(t.depthTexture.renderTarget===t){let e=t.depthTexture.clone();e.renderTarget=null,this.depthTexture=e}else this.depthTexture=t.depthTexture;return this.samples=t.samples,this.multiview=t.multiview,this.useArrayDepthTexture=t.useArrayDepthTexture,this}dispose(){this.dispatchEvent({type:"dispose"})}},Je=class extends Tr{constructor(t=1,e=1,n={}){super(t,e,n),this.isWebGLRenderTarget=!0}},Ms=class extends Pe{constructor(t=null,e=1,n=1,i=1){super(null),this.isDataArrayTexture=!0,this.image={data:t,width:e,height:n,depth:i},this.magFilter=Ie,this.minFilter=Ie,this.wrapR=Ce,this.generateMipmaps=!1,this.flipY=!1,this.unpackAlignment=1,this.layerUpdates=new Set}copy(t){return super.copy(t),this.wrapR=t.wrapR,this}addLayerUpdate(t){this.layerUpdates.add(t)}clearLayerUpdates(){this.layerUpdates.clear()}},jc=class extends Je{constructor(t=1,e=1,n=1,i={}){super(t,e,i),this.isWebGLArrayRenderTarget=!0,this.depth=n,this.texture=new Ms(null,t,e,n),this._setTextureOptions(i),this.texture.isRenderTargetTexture=!0}},Ss=class extends Pe{constructor(t=null,e=1,n=1,i=1){super(null),this.isData3DTexture=!0,this.image={data:t,width:e,height:n,depth:i},this.magFilter=Ie,this.minFilter=Ie,this.wrapR=Ce,this.generateMipmaps=!1,this.flipY=!1,this.unpackAlignment=1}copy(t){return super.copy(t),this.wrapR=t.wrapR,this}},th=class extends Je{constructor(t=1,e=1,n=1,i={}){super(t,e,i),this.isWebGL3DRenderTarget=!0,this.depth=n,this.texture=new Ss(null,t,e,n),this._setTextureOptions(i),this.texture.isRenderTargetTexture=!0}},su=class su{constructor(t,e,n,i,r,o,a,l,c,h,f,u,d,p,x,m){this.elements=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1],t!==void 0&&this.set(t,e,n,i,r,o,a,l,c,h,f,u,d,p,x,m)}set(t,e,n,i,r,o,a,l,c,h,f,u,d,p,x,m){let g=this.elements;return g[0]=t,g[4]=e,g[8]=n,g[12]=i,g[1]=r,g[5]=o,g[9]=a,g[13]=l,g[2]=c,g[6]=h,g[10]=f,g[14]=u,g[3]=d,g[7]=p,g[11]=x,g[15]=m,this}identity(){return this.set(1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1),this}clone(){return new su().fromArray(this.elements)}copy(t){let e=this.elements,n=t.elements;return e[0]=n[0],e[1]=n[1],e[2]=n[2],e[3]=n[3],e[4]=n[4],e[5]=n[5],e[6]=n[6],e[7]=n[7],e[8]=n[8],e[9]=n[9],e[10]=n[10],e[11]=n[11],e[12]=n[12],e[13]=n[13],e[14]=n[14],e[15]=n[15],this}copyPosition(t){let e=this.elements,n=t.elements;return e[12]=n[12],e[13]=n[13],e[14]=n[14],this}setFromMatrix3(t){let e=t.elements;return this.set(e[0],e[3],e[6],0,e[1],e[4],e[7],0,e[2],e[5],e[8],0,0,0,0,1),this}extractBasis(t,e,n){return this.determinantAffine()===0?(t.set(1,0,0),e.set(0,1,0),n.set(0,0,1),this):(t.setFromMatrixColumn(this,0),e.setFromMatrixColumn(this,1),n.setFromMatrixColumn(this,2),this)}makeBasis(t,e,n){return this.set(t.x,e.x,n.x,0,t.y,e.y,n.y,0,t.z,e.z,n.z,0,0,0,0,1),this}extractRotation(t){if(t.determinantAffine()===0)return this.identity();let e=this.elements,n=t.elements,i=1/Ks.setFromMatrixColumn(t,0).length(),r=1/Ks.setFromMatrixColumn(t,1).length(),o=1/Ks.setFromMatrixColumn(t,2).length();return e[0]=n[0]*i,e[1]=n[1]*i,e[2]=n[2]*i,e[3]=0,e[4]=n[4]*r,e[5]=n[5]*r,e[6]=n[6]*r,e[7]=0,e[8]=n[8]*o,e[9]=n[9]*o,e[10]=n[10]*o,e[11]=0,e[12]=0,e[13]=0,e[14]=0,e[15]=1,this}makeRotationFromEuler(t){let e=this.elements,n=t.x,i=t.y,r=t.z,o=Math.cos(n),a=Math.sin(n),l=Math.cos(i),c=Math.sin(i),h=Math.cos(r),f=Math.sin(r);if(t.order==="XYZ"){let u=o*h,d=o*f,p=a*h,x=a*f;e[0]=l*h,e[4]=-l*f,e[8]=c,e[1]=d+p*c,e[5]=u-x*c,e[9]=-a*l,e[2]=x-u*c,e[6]=p+d*c,e[10]=o*l}else if(t.order==="YXZ"){let u=l*h,d=l*f,p=c*h,x=c*f;e[0]=u+x*a,e[4]=p*a-d,e[8]=o*c,e[1]=o*f,e[5]=o*h,e[9]=-a,e[2]=d*a-p,e[6]=x+u*a,e[10]=o*l}else if(t.order==="ZXY"){let u=l*h,d=l*f,p=c*h,x=c*f;e[0]=u-x*a,e[4]=-o*f,e[8]=p+d*a,e[1]=d+p*a,e[5]=o*h,e[9]=x-u*a,e[2]=-o*c,e[6]=a,e[10]=o*l}else if(t.order==="ZYX"){let u=o*h,d=o*f,p=a*h,x=a*f;e[0]=l*h,e[4]=p*c-d,e[8]=u*c+x,e[1]=l*f,e[5]=x*c+u,e[9]=d*c-p,e[2]=-c,e[6]=a*l,e[10]=o*l}else if(t.order==="YZX"){let u=o*l,d=o*c,p=a*l,x=a*c;e[0]=l*h,e[4]=x-u*f,e[8]=p*f+d,e[1]=f,e[5]=o*h,e[9]=-a*h,e[2]=-c*h,e[6]=d*f+p,e[10]=u-x*f}else if(t.order==="XZY"){let u=o*l,d=o*c,p=a*l,x=a*c;e[0]=l*h,e[4]=-f,e[8]=c*h,e[1]=u*f+x,e[5]=o*h,e[9]=d*f-p,e[2]=p*f-d,e[6]=a*h,e[10]=x*f+u}return e[3]=0,e[7]=0,e[11]=0,e[12]=0,e[13]=0,e[14]=0,e[15]=1,this}makeRotationFromQuaternion(t){return this.compose(m_,t,g_)}lookAt(t,e,n){let i=this.elements;return vn.subVectors(t,e),vn.lengthSq()===0&&(vn.z=1),vn.normalize(),Bi.crossVectors(n,vn),Bi.lengthSq()===0&&(Math.abs(n.z)===1?vn.x+=1e-4:vn.z+=1e-4,vn.normalize(),Bi.crossVectors(n,vn)),Bi.normalize(),ac.crossVectors(vn,Bi),i[0]=Bi.x,i[4]=ac.x,i[8]=vn.x,i[1]=Bi.y,i[5]=ac.y,i[9]=vn.y,i[2]=Bi.z,i[6]=ac.z,i[10]=vn.z,this}multiply(t){return this.multiplyMatrices(this,t)}premultiply(t){return this.multiplyMatrices(t,this)}multiplyMatrices(t,e){let n=t.elements,i=e.elements,r=this.elements,o=n[0],a=n[4],l=n[8],c=n[12],h=n[1],f=n[5],u=n[9],d=n[13],p=n[2],x=n[6],m=n[10],g=n[14],v=n[3],b=n[7],y=n[11],M=n[15],S=i[0],w=i[4],_=i[8],T=i[12],R=i[1],L=i[5],D=i[9],F=i[13],C=i[2],N=i[6],z=i[10],O=i[14],H=i[3],U=i[7],W=i[11],Z=i[15];return r[0]=o*S+a*R+l*C+c*H,r[4]=o*w+a*L+l*N+c*U,r[8]=o*_+a*D+l*z+c*W,r[12]=o*T+a*F+l*O+c*Z,r[1]=h*S+f*R+u*C+d*H,r[5]=h*w+f*L+u*N+d*U,r[9]=h*_+f*D+u*z+d*W,r[13]=h*T+f*F+u*O+d*Z,r[2]=p*S+x*R+m*C+g*H,r[6]=p*w+x*L+m*N+g*U,r[10]=p*_+x*D+m*z+g*W,r[14]=p*T+x*F+m*O+g*Z,r[3]=v*S+b*R+y*C+M*H,r[7]=v*w+b*L+y*N+M*U,r[11]=v*_+b*D+y*z+M*W,r[15]=v*T+b*F+y*O+M*Z,this}multiplyScalar(t){let e=this.elements;return e[0]*=t,e[4]*=t,e[8]*=t,e[12]*=t,e[1]*=t,e[5]*=t,e[9]*=t,e[13]*=t,e[2]*=t,e[6]*=t,e[10]*=t,e[14]*=t,e[3]*=t,e[7]*=t,e[11]*=t,e[15]*=t,this}determinant(){let t=this.elements,e=t[0],n=t[4],i=t[8],r=t[12],o=t[1],a=t[5],l=t[9],c=t[13],h=t[2],f=t[6],u=t[10],d=t[14],p=t[3],x=t[7],m=t[11],g=t[15],v=l*d-c*u,b=a*d-c*f,y=a*u-l*f,M=o*d-c*h,S=o*u-l*h,w=o*f-a*h;return e*(x*v-m*b+g*y)-n*(p*v-m*M+g*S)+i*(p*b-x*M+g*w)-r*(p*y-x*S+m*w)}determinantAffine(){let t=this.elements,e=t[0],n=t[4],i=t[8],r=t[1],o=t[5],a=t[9],l=t[2],c=t[6],h=t[10];return e*(o*h-a*c)-n*(r*h-a*l)+i*(r*c-o*l)}transpose(){let t=this.elements,e;return e=t[1],t[1]=t[4],t[4]=e,e=t[2],t[2]=t[8],t[8]=e,e=t[6],t[6]=t[9],t[9]=e,e=t[3],t[3]=t[12],t[12]=e,e=t[7],t[7]=t[13],t[13]=e,e=t[11],t[11]=t[14],t[14]=e,this}setPosition(t,e,n){let i=this.elements;return t.isVector3?(i[12]=t.x,i[13]=t.y,i[14]=t.z):(i[12]=t,i[13]=e,i[14]=n),this}invert(){let t=this.elements,e=t[0],n=t[1],i=t[2],r=t[3],o=t[4],a=t[5],l=t[6],c=t[7],h=t[8],f=t[9],u=t[10],d=t[11],p=t[12],x=t[13],m=t[14],g=t[15],v=e*a-n*o,b=e*l-i*o,y=e*c-r*o,M=n*l-i*a,S=n*c-r*a,w=i*c-r*l,_=h*x-f*p,T=h*m-u*p,R=h*g-d*p,L=f*m-u*x,D=f*g-d*x,F=u*g-d*m,C=v*F-b*D+y*L+M*R-S*T+w*_;if(C===0)return this.set(0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0);let N=1/C;return t[0]=(a*F-l*D+c*L)*N,t[1]=(i*D-n*F-r*L)*N,t[2]=(x*w-m*S+g*M)*N,t[3]=(u*S-f*w-d*M)*N,t[4]=(l*R-o*F-c*T)*N,t[5]=(e*F-i*R+r*T)*N,t[6]=(m*y-p*w-g*b)*N,t[7]=(h*w-u*y+d*b)*N,t[8]=(o*D-a*R+c*_)*N,t[9]=(n*R-e*D-r*_)*N,t[10]=(p*S-x*y+g*v)*N,t[11]=(f*y-h*S-d*v)*N,t[12]=(a*T-o*L-l*_)*N,t[13]=(e*L-n*T+i*_)*N,t[14]=(x*b-p*M-m*v)*N,t[15]=(h*M-f*b+u*v)*N,this}scale(t){let e=this.elements,n=t.x,i=t.y,r=t.z;return e[0]*=n,e[4]*=i,e[8]*=r,e[1]*=n,e[5]*=i,e[9]*=r,e[2]*=n,e[6]*=i,e[10]*=r,e[3]*=n,e[7]*=i,e[11]*=r,this}getMaxScaleOnAxis(){let t=this.elements,e=t[0]*t[0]+t[1]*t[1]+t[2]*t[2],n=t[4]*t[4]+t[5]*t[5]+t[6]*t[6],i=t[8]*t[8]+t[9]*t[9]+t[10]*t[10];return Math.sqrt(Math.max(e,n,i))}makeTranslation(t,e,n){return t.isVector3?this.set(1,0,0,t.x,0,1,0,t.y,0,0,1,t.z,0,0,0,1):this.set(1,0,0,t,0,1,0,e,0,0,1,n,0,0,0,1),this}makeRotationX(t){let e=Math.cos(t),n=Math.sin(t);return this.set(1,0,0,0,0,e,-n,0,0,n,e,0,0,0,0,1),this}makeRotationY(t){let e=Math.cos(t),n=Math.sin(t);return this.set(e,0,n,0,0,1,0,0,-n,0,e,0,0,0,0,1),this}makeRotationZ(t){let e=Math.cos(t),n=Math.sin(t);return this.set(e,-n,0,0,n,e,0,0,0,0,1,0,0,0,0,1),this}makeRotationAxis(t,e){let n=Math.cos(e),i=Math.sin(e),r=1-n,o=t.x,a=t.y,l=t.z,c=r*o,h=r*a;return this.set(c*o+n,c*a-i*l,c*l+i*a,0,c*a+i*l,h*a+n,h*l-i*o,0,c*l-i*a,h*l+i*o,r*l*l+n,0,0,0,0,1),this}makeScale(t,e,n){return this.set(t,0,0,0,0,e,0,0,0,0,n,0,0,0,0,1),this}makeShear(t,e,n,i,r,o){return this.set(1,n,r,0,t,1,o,0,e,i,1,0,0,0,0,1),this}compose(t,e,n){let i=this.elements,r=e._x,o=e._y,a=e._z,l=e._w,c=r+r,h=o+o,f=a+a,u=r*c,d=r*h,p=r*f,x=o*h,m=o*f,g=a*f,v=l*c,b=l*h,y=l*f,M=n.x,S=n.y,w=n.z;return i[0]=(1-(x+g))*M,i[1]=(d+y)*M,i[2]=(p-b)*M,i[3]=0,i[4]=(d-y)*S,i[5]=(1-(u+g))*S,i[6]=(m+v)*S,i[7]=0,i[8]=(p+b)*w,i[9]=(m-v)*w,i[10]=(1-(u+x))*w,i[11]=0,i[12]=t.x,i[13]=t.y,i[14]=t.z,i[15]=1,this}decompose(t,e,n){let i=this.elements;t.x=i[12],t.y=i[13],t.z=i[14];let r=this.determinantAffine();if(r===0)return n.set(1,1,1),e.identity(),this;let o=Ks.set(i[0],i[1],i[2]).length(),a=Ks.set(i[4],i[5],i[6]).length(),l=Ks.set(i[8],i[9],i[10]).length();r<0&&(o=-o),Fn.copy(this);let c=1/o,h=1/a,f=1/l;return Fn.elements[0]*=c,Fn.elements[1]*=c,Fn.elements[2]*=c,Fn.elements[4]*=h,Fn.elements[5]*=h,Fn.elements[6]*=h,Fn.elements[8]*=f,Fn.elements[9]*=f,Fn.elements[10]*=f,e.setFromRotationMatrix(Fn),n.x=o,n.y=a,n.z=l,this}makePerspective(t,e,n,i,r,o,a=xn,l=!1){let c=this.elements,h=2*r/(e-t),f=2*r/(n-i),u=(e+t)/(e-t),d=(n+i)/(n-i),p,x;if(l)p=r/(o-r),x=o*r/(o-r);else if(a===xn)p=-(o+r)/(o-r),x=-2*o*r/(o-r);else if(a===qi)p=-o/(o-r),x=-o*r/(o-r);else throw new Error("THREE.Matrix4.makePerspective(): Invalid coordinate system: "+a);return c[0]=h,c[4]=0,c[8]=u,c[12]=0,c[1]=0,c[5]=f,c[9]=d,c[13]=0,c[2]=0,c[6]=0,c[10]=p,c[14]=x,c[3]=0,c[7]=0,c[11]=-1,c[15]=0,this}makeOrthographic(t,e,n,i,r,o,a=xn,l=!1){let c=this.elements,h=2/(e-t),f=2/(n-i),u=-(e+t)/(e-t),d=-(n+i)/(n-i),p,x;if(l)p=1/(o-r),x=o/(o-r);else if(a===xn)p=-2/(o-r),x=-(o+r)/(o-r);else if(a===qi)p=-1/(o-r),x=-r/(o-r);else throw new Error("THREE.Matrix4.makeOrthographic(): Invalid coordinate system: "+a);return c[0]=h,c[4]=0,c[8]=0,c[12]=u,c[1]=0,c[5]=f,c[9]=0,c[13]=d,c[2]=0,c[6]=0,c[10]=p,c[14]=x,c[3]=0,c[7]=0,c[11]=0,c[15]=1,this}equals(t){let e=this.elements,n=t.elements;for(let i=0;i<16;i++)if(e[i]!==n[i])return!1;return!0}fromArray(t,e=0){for(let n=0;n<16;n++)this.elements[n]=t[n+e];return this}toArray(t=[],e=0){let n=this.elements;return t[e]=n[0],t[e+1]=n[1],t[e+2]=n[2],t[e+3]=n[3],t[e+4]=n[4],t[e+5]=n[5],t[e+6]=n[6],t[e+7]=n[7],t[e+8]=n[8],t[e+9]=n[9],t[e+10]=n[10],t[e+11]=n[11],t[e+12]=n[12],t[e+13]=n[13],t[e+14]=n[14],t[e+15]=n[15],t}};su.prototype.isMatrix4=!0;var Jt=su,Ks=new P,Fn=new Jt,m_=new P(0,0,0),g_=new P(1,1,1),Bi=new P,ac=new P,vn=new P,om=new Jt,am=new ze,Pn=class s{constructor(t=0,e=0,n=0,i=s.DEFAULT_ORDER){this.isEuler=!0,this._x=t,this._y=e,this._z=n,this._order=i}get x(){return this._x}set x(t){this._x=t,this._onChangeCallback()}get y(){return this._y}set y(t){this._y=t,this._onChangeCallback()}get z(){return this._z}set z(t){this._z=t,this._onChangeCallback()}get order(){return this._order}set order(t){this._order=t,this._onChangeCallback()}set(t,e,n,i=this._order){return this._x=t,this._y=e,this._z=n,this._order=i,this._onChangeCallback(),this}clone(){return new this.constructor(this._x,this._y,this._z,this._order)}copy(t){return this._x=t._x,this._y=t._y,this._z=t._z,this._order=t._order,this._onChangeCallback(),this}setFromRotationMatrix(t,e=this._order,n=!0){let i=t.elements,r=i[0],o=i[4],a=i[8],l=i[1],c=i[5],h=i[9],f=i[2],u=i[6],d=i[10];switch(e){case"XYZ":this._y=Math.asin($t(a,-1,1)),Math.abs(a)<.9999999?(this._x=Math.atan2(-h,d),this._z=Math.atan2(-o,r)):(this._x=Math.atan2(u,c),this._z=0);break;case"YXZ":this._x=Math.asin(-$t(h,-1,1)),Math.abs(h)<.9999999?(this._y=Math.atan2(a,d),this._z=Math.atan2(l,c)):(this._y=Math.atan2(-f,r),this._z=0);break;case"ZXY":this._x=Math.asin($t(u,-1,1)),Math.abs(u)<.9999999?(this._y=Math.atan2(-f,d),this._z=Math.atan2(-o,c)):(this._y=0,this._z=Math.atan2(l,r));break;case"ZYX":this._y=Math.asin(-$t(f,-1,1)),Math.abs(f)<.9999999?(this._x=Math.atan2(u,d),this._z=Math.atan2(l,r)):(this._x=0,this._z=Math.atan2(-o,c));break;case"YZX":this._z=Math.asin($t(l,-1,1)),Math.abs(l)<.9999999?(this._x=Math.atan2(-h,c),this._y=Math.atan2(-f,r)):(this._x=0,this._y=Math.atan2(a,d));break;case"XZY":this._z=Math.asin(-$t(o,-1,1)),Math.abs(o)<.9999999?(this._x=Math.atan2(u,c),this._y=Math.atan2(a,r)):(this._x=Math.atan2(-h,d),this._y=0);break;default:St("Euler: .setFromRotationMatrix() encountered an unknown order: "+e)}return this._order=e,n===!0&&this._onChangeCallback(),this}setFromQuaternion(t,e,n){return om.makeRotationFromQuaternion(t),this.setFromRotationMatrix(om,e,n)}setFromVector3(t,e=this._order){return this.set(t.x,t.y,t.z,e)}reorder(t){return am.setFromEuler(this),this.setFromQuaternion(am,t)}equals(t){return t._x===this._x&&t._y===this._y&&t._z===this._z&&t._order===this._order}fromArray(t){return this._x=t[0],this._y=t[1],this._z=t[2],t[3]!==void 0&&(this._order=t[3]),this._onChangeCallback(),this}toArray(t=[],e=0){return t[e]=this._x,t[e+1]=this._y,t[e+2]=this._z,t[e+3]=this._order,t}_onChange(t){return this._onChangeCallback=t,this}_onChangeCallback(){}*[Symbol.iterator](){yield this._x,yield this._y,yield this._z,yield this._order}};Pn.DEFAULT_ORDER="XYZ";var bs=class{constructor(){this.mask=1}set(t){this.mask=(1<<t|0)>>>0}enable(t){this.mask|=1<<t|0}enableAll(){this.mask=-1}toggle(t){this.mask^=1<<t|0}disable(t){this.mask&=~(1<<t|0)}disableAll(){this.mask=0}test(t){return(this.mask&t.mask)!==0}isEnabled(t){return(this.mask&(1<<t|0))!==0}},x_=0,lm=new P,Qs=new ze,di=new Jt,lc=new P,yo=new P,__=new P,y_=new ze,cm=new P(1,0,0),hm=new P(0,1,0),um=new P(0,0,1),fm={type:"added"},v_={type:"removed"},js={type:"childadded",child:null},ju={type:"childremoved",child:null},ae=class s extends _n{constructor(){super(),this.isObject3D=!0,Object.defineProperty(this,"id",{value:x_++}),this.uuid=Sn(),this.name="",this.type="Object3D",this.parent=null,this.children=[],this.up=s.DEFAULT_UP.clone();let t=new P,e=new Pn,n=new ze,i=new P(1,1,1);function r(){n.setFromEuler(e,!1)}function o(){e.setFromQuaternion(n,void 0,!1)}e._onChange(r),n._onChange(o),Object.defineProperties(this,{position:{configurable:!0,enumerable:!0,value:t},rotation:{configurable:!0,enumerable:!0,value:e},quaternion:{configurable:!0,enumerable:!0,value:n},scale:{configurable:!0,enumerable:!0,value:i},modelViewMatrix:{value:new Jt},normalMatrix:{value:new jt}}),this.matrix=new Jt,this.matrixWorld=new Jt,this.matrixAutoUpdate=s.DEFAULT_MATRIX_AUTO_UPDATE,this.matrixWorldAutoUpdate=s.DEFAULT_MATRIX_WORLD_AUTO_UPDATE,this.matrixWorldNeedsUpdate=!1,this.layers=new bs,this.visible=!0,this.castShadow=!1,this.receiveShadow=!1,this.frustumCulled=!0,this.renderOrder=0,this.animations=[],this.customDepthMaterial=void 0,this.customDistanceMaterial=void 0,this.static=!1,this.userData={},this.pivot=null}onBeforeShadow(){}onAfterShadow(){}onBeforeRender(){}onAfterRender(){}applyMatrix4(t){this.matrixAutoUpdate&&this.updateMatrix(),this.matrix.premultiply(t),this.matrix.decompose(this.position,this.quaternion,this.scale)}applyQuaternion(t){return this.quaternion.premultiply(t),this}setRotationFromAxisAngle(t,e){this.quaternion.setFromAxisAngle(t,e)}setRotationFromEuler(t){this.quaternion.setFromEuler(t,!0)}setRotationFromMatrix(t){this.quaternion.setFromRotationMatrix(t)}setRotationFromQuaternion(t){this.quaternion.copy(t)}rotateOnAxis(t,e){return Qs.setFromAxisAngle(t,e),this.quaternion.multiply(Qs),this}rotateOnWorldAxis(t,e){return Qs.setFromAxisAngle(t,e),this.quaternion.premultiply(Qs),this}rotateX(t){return this.rotateOnAxis(cm,t)}rotateY(t){return this.rotateOnAxis(hm,t)}rotateZ(t){return this.rotateOnAxis(um,t)}translateOnAxis(t,e){return lm.copy(t).applyQuaternion(this.quaternion),this.position.add(lm.multiplyScalar(e)),this}translateX(t){return this.translateOnAxis(cm,t)}translateY(t){return this.translateOnAxis(hm,t)}translateZ(t){return this.translateOnAxis(um,t)}localToWorld(t){return this.updateWorldMatrix(!0,!1),t.applyMatrix4(this.matrixWorld)}worldToLocal(t){return this.updateWorldMatrix(!0,!1),t.applyMatrix4(di.copy(this.matrixWorld).invert())}lookAt(t,e,n){t.isVector3?lc.copy(t):lc.set(t,e,n);let i=this.parent;this.updateWorldMatrix(!0,!1),yo.setFromMatrixPosition(this.matrixWorld),this.isCamera||this.isLight?di.lookAt(yo,lc,this.up):di.lookAt(lc,yo,this.up),this.quaternion.setFromRotationMatrix(di),i&&(di.extractRotation(i.matrixWorld),Qs.setFromRotationMatrix(di),this.quaternion.premultiply(Qs.invert()))}add(t){if(arguments.length>1){for(let e=0;e<arguments.length;e++)this.add(arguments[e]);return this}return t===this?(Bt("Object3D.add: object can't be added as a child of itself.",t),this):(t&&t.isObject3D?(t.removeFromParent(),t.parent=this,this.children.push(t),t.dispatchEvent(fm),js.child=t,this.dispatchEvent(js),js.child=null):Bt("Object3D.add: object not an instance of THREE.Object3D.",t),this)}remove(t){if(arguments.length>1){for(let n=0;n<arguments.length;n++)this.remove(arguments[n]);return this}let e=this.children.indexOf(t);return e!==-1&&(t.parent=null,this.children.splice(e,1),t.dispatchEvent(v_),ju.child=t,this.dispatchEvent(ju),ju.child=null),this}removeFromParent(){let t=this.parent;return t!==null&&t.remove(this),this}clear(){return this.remove(...this.children)}attach(t){return this.updateWorldMatrix(!0,!1),di.copy(this.matrixWorld).invert(),t.parent!==null&&(t.parent.updateWorldMatrix(!0,!1),di.multiply(t.parent.matrixWorld)),t.applyMatrix4(di),t.removeFromParent(),t.parent=this,this.children.push(t),t.updateWorldMatrix(!1,!0),t.dispatchEvent(fm),js.child=t,this.dispatchEvent(js),js.child=null,this}getObjectById(t){return this.getObjectByProperty("id",t)}getObjectByName(t){return this.getObjectByProperty("name",t)}getObjectByProperty(t,e){if(this[t]===e)return this;for(let n=0,i=this.children.length;n<i;n++){let o=this.children[n].getObjectByProperty(t,e);if(o!==void 0)return o}}getObjectsByProperty(t,e,n=[]){this[t]===e&&n.push(this);let i=this.children;for(let r=0,o=i.length;r<o;r++)i[r].getObjectsByProperty(t,e,n);return n}getWorldPosition(t){return this.updateWorldMatrix(!0,!1),t.setFromMatrixPosition(this.matrixWorld)}getWorldQuaternion(t){return this.updateWorldMatrix(!0,!1),this.matrixWorld.decompose(yo,t,__),t}getWorldScale(t){return this.updateWorldMatrix(!0,!1),this.matrixWorld.decompose(yo,y_,t),t}getWorldDirection(t){this.updateWorldMatrix(!0,!1);let e=this.matrixWorld.elements;return t.set(e[8],e[9],e[10]).normalize()}raycast(){}intersectsFrustum(){}traverse(t){t(this);let e=this.children;for(let n=0,i=e.length;n<i;n++)e[n].traverse(t)}traverseVisible(t){if(this.visible===!1)return;t(this);let e=this.children;for(let n=0,i=e.length;n<i;n++)e[n].traverseVisible(t)}traverseAncestors(t){let e=this.parent;e!==null&&(t(e),e.traverseAncestors(t))}updateMatrix(){this.matrix.compose(this.position,this.quaternion,this.scale);let t=this.pivot;if(t!==null){let e=t.x,n=t.y,i=t.z,r=this.matrix.elements;r[12]+=e-r[0]*e-r[4]*n-r[8]*i,r[13]+=n-r[1]*e-r[5]*n-r[9]*i,r[14]+=i-r[2]*e-r[6]*n-r[10]*i}this.matrixWorldNeedsUpdate=!0}updateMatrixWorld(t){this.matrixAutoUpdate&&this.updateMatrix(),(this.matrixWorldNeedsUpdate||t)&&(this.matrixWorldAutoUpdate===!0&&(this.parent===null?this.matrixWorld.copy(this.matrix):this.matrixWorld.multiplyMatrices(this.parent.matrixWorld,this.matrix)),this.matrixWorldNeedsUpdate=!1,t=!0);let e=this.children;for(let n=0,i=e.length;n<i;n++)e[n].updateMatrixWorld(t)}updateWorldMatrix(t,e,n=!1){let i=this.parent;if(t===!0&&i!==null&&i.updateWorldMatrix(!0,!1),this.matrixAutoUpdate&&this.updateMatrix(),(this.matrixWorldNeedsUpdate||n)&&(this.matrixWorldAutoUpdate===!0&&(this.parent===null?this.matrixWorld.copy(this.matrix):this.matrixWorld.multiplyMatrices(this.parent.matrixWorld,this.matrix)),this.matrixWorldNeedsUpdate=!1,n=!0),e===!0){let r=this.children;for(let o=0,a=r.length;o<a;o++)r[o].updateWorldMatrix(!1,!0,n)}}toJSON(t){let e=t===void 0||typeof t=="string",n={};e&&(t={geometries:{},materials:{},textures:{},images:{},shapes:{},skeletons:{},animations:{},nodes:{}},n.metadata={version:4.7,type:"Object",generator:"Object3D.toJSON"});let i={};i.uuid=this.uuid,i.type=this.type,i.name=this.name,i.castShadow=this.castShadow,i.receiveShadow=this.receiveShadow,i.visible=this.visible,i.frustumCulled=this.frustumCulled,i.renderOrder=this.renderOrder,i.static=this.static,i.matrixAutoUpdate=this.matrixAutoUpdate,Object.keys(this.userData).length>0&&(i.userData=this.userData),i.layers=this.layers.mask,i.matrix=this.matrix.toArray(),i.up=this.up.toArray(),this.pivot!==null&&(i.pivot=this.pivot.toArray()),this.morphTargetDictionary!==void 0&&(i.morphTargetDictionary=Object.assign({},this.morphTargetDictionary)),this.morphTargetInfluences!==void 0&&(i.morphTargetInfluences=this.morphTargetInfluences.slice()),this.isInstancedMesh&&(i.type="InstancedMesh",i.count=this.count,i.instanceMatrix=this.instanceMatrix.toJSON(),this.instanceColor!==null&&(i.instanceColor=this.instanceColor.toJSON())),this.isBatchedMesh&&(i.type="BatchedMesh",i.perObjectFrustumCulled=this.perObjectFrustumCulled,i.sortObjects=this.sortObjects,i.drawRanges=this._drawRanges,i.reservedRanges=this._reservedRanges,i.geometryInfo=this._geometryInfo.map(a=>({...a,boundingBox:a.boundingBox?a.boundingBox.toJSON():void 0,boundingSphere:a.boundingSphere?a.boundingSphere.toJSON():void 0})),i.instanceInfo=this._instanceInfo.map(a=>({...a})),i.availableInstanceIds=this._availableInstanceIds.slice(),i.availableGeometryIds=this._availableGeometryIds.slice(),i.nextIndexStart=this._nextIndexStart,i.nextVertexStart=this._nextVertexStart,i.geometryCount=this._geometryCount,i.maxInstanceCount=this._maxInstanceCount,i.maxVertexCount=this._maxVertexCount,i.maxIndexCount=this._maxIndexCount,i.geometryInitialized=this._geometryInitialized,i.matricesTexture=this._matricesTexture.toJSON(t),i.indirectTexture=this._indirectTexture.toJSON(t),this._colorsTexture!==null&&(i.colorsTexture=this._colorsTexture.toJSON(t)),this.boundingSphere!==null&&(i.boundingSphere=this.boundingSphere.toJSON()),this.boundingBox!==null&&(i.boundingBox=this.boundingBox.toJSON()));function r(a,l){return a[l.uuid]===void 0&&(a[l.uuid]=l.toJSON(t)),l.uuid}if(this.isScene)this.background&&(this.background.isColor?i.background=this.background.toJSON():this.background.isTexture&&(i.background=this.background.toJSON(t).uuid)),this.environment&&this.environment.isTexture&&this.environment.isRenderTargetTexture!==!0&&(i.environment=this.environment.toJSON(t).uuid);else if(this.isMesh||this.isLine||this.isPoints){i.geometry=r(t.geometries,this.geometry);let a=this.geometry.parameters;if(a!==void 0&&a.shapes!==void 0){let l=a.shapes;if(Array.isArray(l))for(let c=0,h=l.length;c<h;c++){let f=l[c];r(t.shapes,f)}else r(t.shapes,l)}}if(this.isSkinnedMesh&&(i.bindMode=this.bindMode,i.bindMatrix=this.bindMatrix.toArray(),this.skeleton!==void 0&&(r(t.skeletons,this.skeleton),i.skeleton=this.skeleton.uuid)),this.material!==void 0)if(Array.isArray(this.material)){let a=[];for(let l=0,c=this.material.length;l<c;l++)a.push(r(t.materials,this.material[l]));i.material=a}else i.material=r(t.materials,this.material);if(this.children.length>0){i.children=[];for(let a=0;a<this.children.length;a++)i.children.push(this.children[a].toJSON(t).object)}if(this.animations.length>0){i.animations=[];for(let a=0;a<this.animations.length;a++){let l=this.animations[a];i.animations.push(r(t.animations,l))}}if(e){let a=o(t.geometries),l=o(t.materials),c=o(t.textures),h=o(t.images),f=o(t.shapes),u=o(t.skeletons),d=o(t.animations),p=o(t.nodes);a.length>0&&(n.geometries=a),l.length>0&&(n.materials=l),c.length>0&&(n.textures=c),h.length>0&&(n.images=h),f.length>0&&(n.shapes=f),u.length>0&&(n.skeletons=u),d.length>0&&(n.animations=d),p.length>0&&(n.nodes=p)}return n.object=i,n;function o(a){let l=[];for(let c in a){let h=a[c];delete h.metadata,l.push(h)}return l}}clone(t){return new this.constructor().copy(this,t)}copy(t,e=!0){if(this.name=t.name,this.up.copy(t.up),this.position.copy(t.position),this.rotation.order=t.rotation.order,this.quaternion.copy(t.quaternion),this.scale.copy(t.scale),this.pivot=t.pivot!==null?t.pivot.clone():null,this.matrix.copy(t.matrix),this.matrixWorld.copy(t.matrixWorld),this.matrixAutoUpdate=t.matrixAutoUpdate,this.matrixWorldAutoUpdate=t.matrixWorldAutoUpdate,this.matrixWorldNeedsUpdate=t.matrixWorldNeedsUpdate,this.layers.mask=t.layers.mask,this.visible=t.visible,this.castShadow=t.castShadow,this.receiveShadow=t.receiveShadow,this.frustumCulled=t.frustumCulled,this.renderOrder=t.renderOrder,this.static=t.static,this.animations=t.animations.slice(),this.userData=JSON.parse(JSON.stringify(t.userData)),e===!0)for(let n=0;n<t.children.length;n++){let i=t.children[n];this.add(i.clone())}return this}dispose(){this.dispatchEvent({type:"dispose"})}};ae.DEFAULT_UP=new P(0,1,0);ae.DEFAULT_MATRIX_AUTO_UPDATE=!0;ae.DEFAULT_MATRIX_WORLD_AUTO_UPDATE=!0;var Te=class extends ae{constructor(){super(),this.isGroup=!0,this.type="Group"}},M_={type:"move"},Es=class{constructor(){this._targetRay=null,this._grip=null,this._hand=null}getHandSpace(){return this._hand===null&&(this._hand=new Te,this._hand.matrixAutoUpdate=!1,this._hand.visible=!1,this._hand.joints={},this._hand.inputState={pinching:!1}),this._hand}getTargetRaySpace(){return this._targetRay===null&&(this._targetRay=new Te,this._targetRay.matrixAutoUpdate=!1,this._targetRay.visible=!1,this._targetRay.hasLinearVelocity=!1,this._targetRay.linearVelocity=new P,this._targetRay.hasAngularVelocity=!1,this._targetRay.angularVelocity=new P),this._targetRay}getGripSpace(){return this._grip===null&&(this._grip=new Te,this._grip.matrixAutoUpdate=!1,this._grip.visible=!1,this._grip.hasLinearVelocity=!1,this._grip.linearVelocity=new P,this._grip.hasAngularVelocity=!1,this._grip.angularVelocity=new P,this._grip.eventsEnabled=!1),this._grip}dispatchEvent(t){return this._targetRay!==null&&this._targetRay.dispatchEvent(t),this._grip!==null&&this._grip.dispatchEvent(t),this._hand!==null&&this._hand.dispatchEvent(t),this}connect(t){if(t&&t.hand){let e=this._hand;if(e)for(let n of t.hand.values())this._getHandJoint(e,n)}return this.dispatchEvent({type:"connected",data:t}),this}disconnect(t){return this.dispatchEvent({type:"disconnected",data:t}),this._targetRay!==null&&(this._targetRay.visible=!1),this._grip!==null&&(this._grip.visible=!1),this._hand!==null&&(this._hand.visible=!1),this}update(t,e,n){let i=null,r=null,o=null,a=this._targetRay,l=this._grip,c=this._hand;if(t&&e.session.visibilityState!=="visible-blurred"){if(c&&t.hand){o=!0;for(let x of t.hand.values()){let m=e.getJointPose(x,n),g=this._getHandJoint(c,x);m!==null&&(g.matrix.fromArray(m.transform.matrix),g.matrix.decompose(g.position,g.rotation,g.scale),g.matrixWorldNeedsUpdate=!0,g.jointRadius=m.radius),g.visible=m!==null}let h=c.joints["index-finger-tip"],f=c.joints["thumb-tip"],u=h.position.distanceTo(f.position),d=.02,p=.005;c.inputState.pinching&&u>d+p?(c.inputState.pinching=!1,this.dispatchEvent({type:"pinchend",handedness:t.handedness,target:this})):!c.inputState.pinching&&u<=d-p&&(c.inputState.pinching=!0,this.dispatchEvent({type:"pinchstart",handedness:t.handedness,target:this}))}else l!==null&&t.gripSpace&&(r=e.getPose(t.gripSpace,n),r!==null&&(l.matrix.fromArray(r.transform.matrix),l.matrix.decompose(l.position,l.rotation,l.scale),l.matrixWorldNeedsUpdate=!0,r.linearVelocity?(l.hasLinearVelocity=!0,l.linearVelocity.copy(r.linearVelocity)):l.hasLinearVelocity=!1,r.angularVelocity?(l.hasAngularVelocity=!0,l.angularVelocity.copy(r.angularVelocity)):l.hasAngularVelocity=!1,l.eventsEnabled&&l.dispatchEvent({type:"gripUpdated",data:t,target:this})));a!==null&&(i=e.getPose(t.targetRaySpace,n),i===null&&r!==null&&(i=r),i!==null&&(a.matrix.fromArray(i.transform.matrix),a.matrix.decompose(a.position,a.rotation,a.scale),a.matrixWorldNeedsUpdate=!0,i.linearVelocity?(a.hasLinearVelocity=!0,a.linearVelocity.copy(i.linearVelocity)):a.hasLinearVelocity=!1,i.angularVelocity?(a.hasAngularVelocity=!0,a.angularVelocity.copy(i.angularVelocity)):a.hasAngularVelocity=!1,this.dispatchEvent(M_)))}return a!==null&&(a.visible=i!==null),l!==null&&(l.visible=r!==null),c!==null&&(c.visible=o!==null),this}_getHandJoint(t,e){if(t.joints[e.jointName]===void 0){let n=new Te;n.matrixAutoUpdate=!1,n.visible=!1,t.joints[e.jointName]=n,t.add(n)}return t.joints[e.jointName]}},cg={aliceblue:15792383,antiquewhite:16444375,aqua:65535,aquamarine:8388564,azure:15794175,beige:16119260,bisque:16770244,black:0,blanchedalmond:16772045,blue:255,blueviolet:9055202,brown:10824234,burlywood:14596231,cadetblue:6266528,chartreuse:8388352,chocolate:13789470,coral:16744272,cornflowerblue:6591981,cornsilk:16775388,crimson:14423100,cyan:65535,darkblue:139,darkcyan:35723,darkgoldenrod:12092939,darkgray:11119017,darkgreen:25600,darkgrey:11119017,darkkhaki:12433259,darkmagenta:9109643,darkolivegreen:5597999,darkorange:16747520,darkorchid:10040012,darkred:9109504,darksalmon:15308410,darkseagreen:9419919,darkslateblue:4734347,darkslategray:3100495,darkslategrey:3100495,darkturquoise:52945,darkviolet:9699539,deeppink:16716947,deepskyblue:49151,dimgray:6908265,dimgrey:6908265,dodgerblue:2003199,firebrick:11674146,floralwhite:16775920,forestgreen:2263842,fuchsia:16711935,gainsboro:14474460,ghostwhite:16316671,gold:16766720,goldenrod:14329120,gray:8421504,green:32768,greenyellow:11403055,grey:8421504,honeydew:15794160,hotpink:16738740,indianred:13458524,indigo:4915330,ivory:16777200,khaki:15787660,lavender:15132410,lavenderblush:16773365,lawngreen:8190976,lemonchiffon:16775885,lightblue:11393254,lightcoral:15761536,lightcyan:14745599,lightgoldenrodyellow:16448210,lightgray:13882323,lightgreen:9498256,lightgrey:13882323,lightpink:16758465,lightsalmon:16752762,lightseagreen:2142890,lightskyblue:8900346,lightslategray:7833753,lightslategrey:7833753,lightsteelblue:11584734,lightyellow:16777184,lime:65280,limegreen:3329330,linen:16445670,magenta:16711935,maroon:8388608,mediumaquamarine:6737322,mediumblue:205,mediumorchid:12211667,mediumpurple:9662683,mediumseagreen:3978097,mediumslateblue:8087790,mediumspringgreen:64154,mediumturquoise:4772300,mediumvioletred:13047173,midnightblue:1644912,mintcream:16121850,mistyrose:16770273,moccasin:16770229,navajowhite:16768685,navy:128,oldlace:16643558,olive:8421376,olivedrab:7048739,orange:16753920,orangered:16729344,orchid:14315734,palegoldenrod:15657130,palegreen:10025880,paleturquoise:11529966,palevioletred:14381203,papayawhip:16773077,peachpuff:16767673,peru:13468991,pink:16761035,plum:14524637,powderblue:11591910,purple:8388736,rebeccapurple:6697881,red:16711680,rosybrown:12357519,royalblue:4286945,saddlebrown:9127187,salmon:16416882,sandybrown:16032864,seagreen:3050327,seashell:16774638,sienna:10506797,silver:12632256,skyblue:8900331,slateblue:6970061,slategray:7372944,slategrey:7372944,snow:16775930,springgreen:65407,steelblue:4620980,tan:13808780,teal:32896,thistle:14204888,tomato:16737095,turquoise:4251856,violet:15631086,wheat:16113331,white:16777215,whitesmoke:16119285,yellow:16776960,yellowgreen:10145074},zi={h:0,s:0,l:0},cc={h:0,s:0,l:0};function tf(s,t,e){return e<0&&(e+=1),e>1&&(e-=1),e<1/6?s+(t-s)*6*e:e<1/2?t:e<2/3?s+(t-s)*6*(2/3-e):s}var _t=class{constructor(t,e,n){return this.isColor=!0,this.r=1,this.g=1,this.b=1,this.set(t,e,n)}set(t,e,n){if(e===void 0&&n===void 0){let i=t;i&&i.isColor?this.copy(i):typeof i=="number"?this.setHex(i):typeof i=="string"&&this.setStyle(i)}else this.setRGB(t,e,n);return this}setScalar(t){return this.r=t,this.g=t,this.b=t,this}setHex(t,e=Ee){return t=Math.floor(t),this.r=(t>>16&255)/255,this.g=(t>>8&255)/255,this.b=(t&255)/255,re.colorSpaceToWorking(this,e),this}setRGB(t,e,n,i=re.workingColorSpace){return this.r=t,this.g=e,this.b=n,re.colorSpaceToWorking(this,i),this}setHSL(t,e,n,i=re.workingColorSpace){if(t=Id(t,1),e=$t(e,0,1),n=$t(n,0,1),e===0)this.r=this.g=this.b=n;else{let r=n<=.5?n*(1+e):n+e-n*e,o=2*n-r;this.r=tf(o,r,t+1/3),this.g=tf(o,r,t),this.b=tf(o,r,t-1/3)}return re.colorSpaceToWorking(this,i),this}setStyle(t,e=Ee){function n(r){r!==void 0&&parseFloat(r)<1&&St("Color: Alpha component of "+t+" will be ignored.")}let i;if(i=/^(\w+)\(([^\)]*)\)/.exec(t)){let r,o=i[1],a=i[2];switch(o){case"rgb":case"rgba":if(r=/^\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*(\d*\.?\d+)\s*)?$/.exec(a))return n(r[4]),this.setRGB(Math.min(255,parseInt(r[1],10))/255,Math.min(255,parseInt(r[2],10))/255,Math.min(255,parseInt(r[3],10))/255,e);if(r=/^\s*(\d+)\%\s*,\s*(\d+)\%\s*,\s*(\d+)\%\s*(?:,\s*(\d*\.?\d+)\s*)?$/.exec(a))return n(r[4]),this.setRGB(Math.min(100,parseInt(r[1],10))/100,Math.min(100,parseInt(r[2],10))/100,Math.min(100,parseInt(r[3],10))/100,e);break;case"hsl":case"hsla":if(r=/^\s*(\d*\.?\d+)\s*,\s*(\d*\.?\d+)\%\s*,\s*(\d*\.?\d+)\%\s*(?:,\s*(\d*\.?\d+)\s*)?$/.exec(a))return n(r[4]),this.setHSL(parseFloat(r[1])/360,parseFloat(r[2])/100,parseFloat(r[3])/100,e);break;default:St("Color: Unknown color model "+t)}}else if(i=/^\#([A-Fa-f\d]+)$/.exec(t)){let r=i[1],o=r.length;if(o===3)return this.setRGB(parseInt(r.charAt(0),16)/15,parseInt(r.charAt(1),16)/15,parseInt(r.charAt(2),16)/15,e);if(o===6)return this.setHex(parseInt(r,16),e);St("Color: Invalid hex color "+t)}else if(t&&t.length>0)return this.setColorName(t,e);return this}setColorName(t,e=Ee){let n=cg[t.toLowerCase()];return n!==void 0?this.setHex(n,e):St("Color: Unknown color "+t),this}clone(){return new this.constructor(this.r,this.g,this.b)}copy(t){return this.r=t.r,this.g=t.g,this.b=t.b,this}copySRGBToLinear(t){return this.r=vi(t.r),this.g=vi(t.g),this.b=vi(t.b),this}copyLinearToSRGB(t){return this.r=xr(t.r),this.g=xr(t.g),this.b=xr(t.b),this}convertSRGBToLinear(){return this.copySRGBToLinear(this),this}convertLinearToSRGB(){return this.copyLinearToSRGB(this),this}getHex(t=Ee){return re.workingToColorSpace(je.copy(this),t),Math.round($t(je.r*255,0,255))*65536+Math.round($t(je.g*255,0,255))*256+Math.round($t(je.b*255,0,255))}getHexString(t=Ee){return("000000"+this.getHex(t).toString(16)).slice(-6)}getHSL(t,e=re.workingColorSpace){re.workingToColorSpace(je.copy(this),e);let n=je.r,i=je.g,r=je.b,o=Math.max(n,i,r),a=Math.min(n,i,r),l,c,h=(a+o)/2;if(a===o)l=0,c=0;else{let f=o-a;switch(c=h<=.5?f/(o+a):f/(2-o-a),o){case n:l=(i-r)/f+(i<r?6:0);break;case i:l=(r-n)/f+2;break;case r:l=(n-i)/f+4;break}l/=6}return t.h=l,t.s=c,t.l=h,t}getRGB(t,e=re.workingColorSpace){return re.workingToColorSpace(je.copy(this),e),t.r=je.r,t.g=je.g,t.b=je.b,t}getStyle(t=Ee){re.workingToColorSpace(je.copy(this),t);let e=je.r,n=je.g,i=je.b;return t!==Ee?`color(${t} ${e.toFixed(3)} ${n.toFixed(3)} ${i.toFixed(3)})`:`rgb(${Math.round(e*255)},${Math.round(n*255)},${Math.round(i*255)})`}offsetHSL(t,e,n){return this.getHSL(zi),this.setHSL(zi.h+t,zi.s+e,zi.l+n)}add(t){return this.r+=t.r,this.g+=t.g,this.b+=t.b,this}addColors(t,e){return this.r=t.r+e.r,this.g=t.g+e.g,this.b=t.b+e.b,this}addScalar(t){return this.r+=t,this.g+=t,this.b+=t,this}sub(t){return this.r=Math.max(0,this.r-t.r),this.g=Math.max(0,this.g-t.g),this.b=Math.max(0,this.b-t.b),this}multiply(t){return this.r*=t.r,this.g*=t.g,this.b*=t.b,this}multiplyScalar(t){return this.r*=t,this.g*=t,this.b*=t,this}lerp(t,e){return this.r+=(t.r-this.r)*e,this.g+=(t.g-this.g)*e,this.b+=(t.b-this.b)*e,this}lerpColors(t,e,n){return this.r=t.r+(e.r-t.r)*n,this.g=t.g+(e.g-t.g)*n,this.b=t.b+(e.b-t.b)*n,this}lerpHSL(t,e){this.getHSL(zi),t.getHSL(cc);let n=Uo(zi.h,cc.h,e),i=Uo(zi.s,cc.s,e),r=Uo(zi.l,cc.l,e);return this.setHSL(n,i,r),this}setFromVector3(t){return this.r=t.x,this.g=t.y,this.b=t.z,this}applyMatrix3(t){let e=this.r,n=this.g,i=this.b,r=t.elements;return this.r=r[0]*e+r[3]*n+r[6]*i,this.g=r[1]*e+r[4]*n+r[7]*i,this.b=r[2]*e+r[5]*n+r[8]*i,this}equals(t){return t.r===this.r&&t.g===this.g&&t.b===this.b}fromArray(t,e=0){return this.r=t[e],this.g=t[e+1],this.b=t[e+2],this}toArray(t=[],e=0){return t[e]=this.r,t[e+1]=this.g,t[e+2]=this.b,t}fromBufferAttribute(t,e){return this.r=t.getX(e),this.g=t.getY(e),this.b=t.getZ(e),this}toJSON(){return this.getHex()}*[Symbol.iterator](){yield this.r,yield this.g,yield this.b}},je=new _t;_t.NAMES=cg;var Zo=class s{constructor(t,e=25e-5){this.isFogExp2=!0,this.name="",this.color=new _t(t),this.density=e}clone(){return new s(this.color,this.density)}toJSON(){return{type:"FogExp2",name:this.name,color:this.color.getHex(),density:this.density}}},Jo=class s{constructor(t,e=1,n=1e3){this.isFog=!0,this.name="",this.color=new _t(t),this.near=e,this.far=n}clone(){return new s(this.color,this.near,this.far)}toJSON(){return{type:"Fog",name:this.name,color:this.color.getHex(),near:this.near,far:this.far}}},$o=class extends ae{constructor(){super(),this.isScene=!0,this.type="Scene",this.background=null,this.environment=null,this.fog=null,this.backgroundBlurriness=0,this.backgroundIntensity=1,this.backgroundRotation=new Pn,this.environmentIntensity=1,this.environmentRotation=new Pn,this.overrideMaterial=null,typeof __THREE_DEVTOOLS__<"u"&&__THREE_DEVTOOLS__.dispatchEvent(new CustomEvent("observe",{detail:this}))}copy(t,e){return super.copy(t,e),t.background!==null&&(this.background=t.background.clone()),t.environment!==null&&(this.environment=t.environment.clone()),t.fog!==null&&(this.fog=t.fog.clone()),this.backgroundBlurriness=t.backgroundBlurriness,this.backgroundIntensity=t.backgroundIntensity,this.backgroundRotation.copy(t.backgroundRotation),this.environmentIntensity=t.environmentIntensity,this.environmentRotation.copy(t.environmentRotation),t.overrideMaterial!==null&&(this.overrideMaterial=t.overrideMaterial.clone()),this.matrixAutoUpdate=t.matrixAutoUpdate,this}toJSON(t){let e=super.toJSON(t);return this.fog!==null&&(e.object.fog=this.fog.toJSON()),e.object.backgroundBlurriness=this.backgroundBlurriness,e.object.backgroundIntensity=this.backgroundIntensity,e.object.backgroundRotation=this.backgroundRotation.toArray(),e.object.environmentIntensity=this.environmentIntensity,e.object.environmentRotation=this.environmentRotation.toArray(),e}},On=new P,pi=new P,ef=new P,mi=new P,tr=new P,er=new P,dm=new P,nf=new P,sf=new P,rf=new P,of=new ge,af=new ge,lf=new ge,kn=class s{constructor(t=new P,e=new P,n=new P){this.a=t,this.b=e,this.c=n}static getNormal(t,e,n,i){i.subVectors(n,e),On.subVectors(t,e),i.cross(On);let r=i.lengthSq();return r>0?i.multiplyScalar(1/Math.sqrt(r)):i.set(0,0,0)}static getBarycoord(t,e,n,i,r){On.subVectors(i,e),pi.subVectors(n,e),ef.subVectors(t,e);let o=On.dot(On),a=On.dot(pi),l=On.dot(ef),c=pi.dot(pi),h=pi.dot(ef),f=o*c-a*a;if(f===0)return r.set(0,0,0),null;let u=1/f,d=(c*l-a*h)*u,p=(o*h-a*l)*u;return r.set(1-d-p,p,d)}static containsPoint(t,e,n,i){return this.getBarycoord(t,e,n,i,mi)===null?!1:mi.x>=0&&mi.y>=0&&mi.x+mi.y<=1}static getInterpolation(t,e,n,i,r,o,a,l){return this.getBarycoord(t,e,n,i,mi)===null?(l.x=0,l.y=0,"z"in l&&(l.z=0),"w"in l&&(l.w=0),null):(l.setScalar(0),l.addScaledVector(r,mi.x),l.addScaledVector(o,mi.y),l.addScaledVector(a,mi.z),l)}static getInterpolatedAttribute(t,e,n,i,r,o){return of.setScalar(0),af.setScalar(0),lf.setScalar(0),of.fromBufferAttribute(t,e),af.fromBufferAttribute(t,n),lf.fromBufferAttribute(t,i),o.setScalar(0),o.addScaledVector(of,r.x),o.addScaledVector(af,r.y),o.addScaledVector(lf,r.z),o}static isFrontFacing(t,e,n,i){return On.subVectors(n,e),pi.subVectors(t,e),On.cross(pi).dot(i)<0}set(t,e,n){return this.a.copy(t),this.b.copy(e),this.c.copy(n),this}setFromPointsAndIndices(t,e,n,i){return this.a.copy(t[e]),this.b.copy(t[n]),this.c.copy(t[i]),this}setFromAttributeAndIndices(t,e,n,i){return this.a.fromBufferAttribute(t,e),this.b.fromBufferAttribute(t,n),this.c.fromBufferAttribute(t,i),this}clone(){return new this.constructor().copy(this)}copy(t){return this.a.copy(t.a),this.b.copy(t.b),this.c.copy(t.c),this}getArea(){return On.subVectors(this.c,this.b),pi.subVectors(this.a,this.b),On.cross(pi).length()*.5}getMidpoint(t){return t.addVectors(this.a,this.b).add(this.c).multiplyScalar(1/3)}getNormal(t){return s.getNormal(this.a,this.b,this.c,t)}getPlane(t){return t.setFromCoplanarPoints(this.a,this.b,this.c)}getBarycoord(t,e){return s.getBarycoord(t,this.a,this.b,this.c,e)}getInterpolation(t,e,n,i,r){return s.getInterpolation(t,this.a,this.b,this.c,e,n,i,r)}containsPoint(t){return s.containsPoint(t,this.a,this.b,this.c)}isFrontFacing(t){return s.isFrontFacing(this.a,this.b,this.c,t)}intersectsBox(t){return t.intersectsTriangle(this)}closestPointToPoint(t,e){let n=this.a,i=this.b,r=this.c,o,a;tr.subVectors(i,n),er.subVectors(r,n),nf.subVectors(t,n);let l=tr.dot(nf),c=er.dot(nf);if(l<=0&&c<=0)return e.copy(n);sf.subVectors(t,i);let h=tr.dot(sf),f=er.dot(sf);if(h>=0&&f<=h)return e.copy(i);let u=l*f-h*c;if(u<=0&&l>=0&&h<=0)return o=l/(l-h),e.copy(n).addScaledVector(tr,o);rf.subVectors(t,r);let d=tr.dot(rf),p=er.dot(rf);if(p>=0&&d<=p)return e.copy(r);let x=d*c-l*p;if(x<=0&&c>=0&&p<=0)return a=c/(c-p),e.copy(n).addScaledVector(er,a);let m=h*p-d*f;if(m<=0&&f-h>=0&&d-p>=0)return dm.subVectors(r,i),a=(f-h)/(f-h+(d-p)),e.copy(i).addScaledVector(dm,a);let g=1/(m+x+u);return o=x*g,a=u*g,e.copy(n).addScaledVector(tr,o).addScaledVector(er,a)}equals(t){return t.a.equals(this.a)&&t.b.equals(this.b)&&t.c.equals(this.c)}},Ae=class{constructor(t=new P(1/0,1/0,1/0),e=new P(-1/0,-1/0,-1/0)){this.isBox3=!0,this.min=t,this.max=e}set(t,e){return this.min.copy(t),this.max.copy(e),this}setFromArray(t){this.makeEmpty();for(let e=0,n=t.length;e<n;e+=3)this.expandByPoint(Bn.fromArray(t,e));return this}setFromBufferAttribute(t){this.makeEmpty();for(let e=0,n=t.count;e<n;e++)this.expandByPoint(Bn.fromBufferAttribute(t,e));return this}setFromPoints(t){this.makeEmpty();for(let e=0,n=t.length;e<n;e++)this.expandByPoint(t[e]);return this}setFromCenterAndSize(t,e){let n=Bn.copy(e).multiplyScalar(.5);return this.min.copy(t).sub(n),this.max.copy(t).add(n),this}setFromObject(t,e=!1){return this.makeEmpty(),this.expandByObject(t,e)}clone(){return new this.constructor().copy(this)}copy(t){return this.min.copy(t.min),this.max.copy(t.max),this}makeEmpty(){return this.min.x=this.min.y=this.min.z=1/0,this.max.x=this.max.y=this.max.z=-1/0,this}isEmpty(){return this.max.x<this.min.x||this.max.y<this.min.y||this.max.z<this.min.z}getCenter(t){return this.isEmpty()?t.set(0,0,0):t.addVectors(this.min,this.max).multiplyScalar(.5)}getSize(t){return this.isEmpty()?t.set(0,0,0):t.subVectors(this.max,this.min)}expandByPoint(t){return this.min.min(t),this.max.max(t),this}expandByVector(t){return this.min.sub(t),this.max.add(t),this}expandByScalar(t){return this.min.addScalar(-t),this.max.addScalar(t),this}expandByObject(t,e=!1){t.updateWorldMatrix(!1,!1);let n=t.geometry;if(n!==void 0){let r=n.getAttribute("position");if(e===!0&&r!==void 0&&t.isInstancedMesh!==!0)for(let o=0,a=r.count;o<a;o++)t.isMesh===!0?t.getVertexPosition(o,Bn):Bn.fromBufferAttribute(r,o),Bn.applyMatrix4(t.matrixWorld),this.expandByPoint(Bn);else t.boundingBox!==void 0?(t.boundingBox===null&&t.computeBoundingBox(),hc.copy(t.boundingBox)):(n.boundingBox===null&&n.computeBoundingBox(),hc.copy(n.boundingBox)),hc.applyMatrix4(t.matrixWorld),this.union(hc)}let i=t.children;for(let r=0,o=i.length;r<o;r++)this.expandByObject(i[r],e);return this}containsPoint(t){return t.x>=this.min.x&&t.x<=this.max.x&&t.y>=this.min.y&&t.y<=this.max.y&&t.z>=this.min.z&&t.z<=this.max.z}containsBox(t){return this.min.x<=t.min.x&&t.max.x<=this.max.x&&this.min.y<=t.min.y&&t.max.y<=this.max.y&&this.min.z<=t.min.z&&t.max.z<=this.max.z}getParameter(t,e){return e.set((t.x-this.min.x)/(this.max.x-this.min.x),(t.y-this.min.y)/(this.max.y-this.min.y),(t.z-this.min.z)/(this.max.z-this.min.z))}intersectsBox(t){return t.max.x>=this.min.x&&t.min.x<=this.max.x&&t.max.y>=this.min.y&&t.min.y<=this.max.y&&t.max.z>=this.min.z&&t.min.z<=this.max.z}intersectsSphere(t){return this.clampPoint(t.center,Bn),Bn.distanceToSquared(t.center)<=t.radius*t.radius}intersectsPlane(t){let e,n;return t.normal.x>0?(e=t.normal.x*this.min.x,n=t.normal.x*this.max.x):(e=t.normal.x*this.max.x,n=t.normal.x*this.min.x),t.normal.y>0?(e+=t.normal.y*this.min.y,n+=t.normal.y*this.max.y):(e+=t.normal.y*this.max.y,n+=t.normal.y*this.min.y),t.normal.z>0?(e+=t.normal.z*this.min.z,n+=t.normal.z*this.max.z):(e+=t.normal.z*this.max.z,n+=t.normal.z*this.min.z),e<=-t.constant&&n>=-t.constant}intersectsTriangle(t){if(this.isEmpty())return!1;this.getCenter(vo),uc.subVectors(this.max,vo),nr.subVectors(t.a,vo),ir.subVectors(t.b,vo),sr.subVectors(t.c,vo),ki.subVectors(ir,nr),Gi.subVectors(sr,ir),os.subVectors(nr,sr);let e=[0,-ki.z,ki.y,0,-Gi.z,Gi.y,0,-os.z,os.y,ki.z,0,-ki.x,Gi.z,0,-Gi.x,os.z,0,-os.x,-ki.y,ki.x,0,-Gi.y,Gi.x,0,-os.y,os.x,0];return!cf(e,nr,ir,sr,uc)||(e=[1,0,0,0,1,0,0,0,1],!cf(e,nr,ir,sr,uc))?!1:(fc.crossVectors(ki,Gi),e=[fc.x,fc.y,fc.z],cf(e,nr,ir,sr,uc))}clampPoint(t,e){return e.copy(t).clamp(this.min,this.max)}distanceToPoint(t){return this.clampPoint(t,Bn).distanceTo(t)}getBoundingSphere(t){return this.isEmpty()?t.makeEmpty():(this.getCenter(t.center),t.radius=this.getSize(Bn).length()*.5),t}intersect(t){return this.min.max(t.min),this.max.min(t.max),this.isEmpty()&&this.makeEmpty(),this}union(t){return this.min.min(t.min),this.max.max(t.max),this}applyMatrix4(t){return this.isEmpty()?this:(gi[0].set(this.min.x,this.min.y,this.min.z).applyMatrix4(t),gi[1].set(this.min.x,this.min.y,this.max.z).applyMatrix4(t),gi[2].set(this.min.x,this.max.y,this.min.z).applyMatrix4(t),gi[3].set(this.min.x,this.max.y,this.max.z).applyMatrix4(t),gi[4].set(this.max.x,this.min.y,this.min.z).applyMatrix4(t),gi[5].set(this.max.x,this.min.y,this.max.z).applyMatrix4(t),gi[6].set(this.max.x,this.max.y,this.min.z).applyMatrix4(t),gi[7].set(this.max.x,this.max.y,this.max.z).applyMatrix4(t),this.setFromPoints(gi),this)}translate(t){return this.min.add(t),this.max.add(t),this}equals(t){return t.min.equals(this.min)&&t.max.equals(this.max)}toJSON(){return{min:this.min.toArray(),max:this.max.toArray()}}fromJSON(t){return this.min.fromArray(t.min),this.max.fromArray(t.max),this}},gi=[new P,new P,new P,new P,new P,new P,new P,new P],Bn=new P,hc=new Ae,nr=new P,ir=new P,sr=new P,ki=new P,Gi=new P,os=new P,vo=new P,uc=new P,fc=new P,as=new P;function cf(s,t,e,n,i){for(let r=0,o=s.length-3;r<=o;r+=3){as.fromArray(s,r);let a=i.x*Math.abs(as.x)+i.y*Math.abs(as.y)+i.z*Math.abs(as.z),l=t.dot(as),c=e.dot(as),h=n.dot(as);if(Math.max(-Math.max(l,c,h),Math.min(l,c,h))>a)return!1}return!0}var yi=S_();function S_(){let s=new ArrayBuffer(4),t=new Float32Array(s),e=new Uint32Array(s),n=new Uint32Array(512),i=new Uint32Array(512);for(let l=0;l<256;++l){let c=l-127;c<-27?(n[l]=0,n[l|256]=32768,i[l]=24,i[l|256]=24):c<-14?(n[l]=1024>>-c-14,n[l|256]=1024>>-c-14|32768,i[l]=-c-1,i[l|256]=-c-1):c<=15?(n[l]=c+15<<10,n[l|256]=c+15<<10|32768,i[l]=13,i[l|256]=13):c<128?(n[l]=31744,n[l|256]=64512,i[l]=24,i[l|256]=24):(n[l]=31744,n[l|256]=64512,i[l]=13,i[l|256]=13)}let r=new Uint32Array(2048),o=new Uint32Array(64),a=new Uint32Array(64);for(let l=1;l<1024;++l){let c=l<<13,h=0;for(;!(c&8388608);)c<<=1,h-=8388608;c&=-8388609,h+=947912704,r[l]=c|h}for(let l=1024;l<2048;++l)r[l]=939524096+(l-1024<<13);for(let l=1;l<31;++l)o[l]=l<<23;o[31]=1199570944,o[32]=2147483648;for(let l=33;l<63;++l)o[l]=2147483648+(l-32<<23);o[63]=3347054592;for(let l=1;l<64;++l)l!==32&&(a[l]=1024);return{floatView:t,uint32View:e,baseTable:n,shiftTable:i,mantissaTable:r,exponentTable:o,offsetTable:a}}function gn(s){Math.abs(s)>65504&&St("DataUtils.toHalfFloat(): Value out of range."),s=$t(s,-65504,65504),yi.floatView[0]=s;let t=yi.uint32View[0],e=t>>23&511;return yi.baseTable[e]+((t&8388607)>>yi.shiftTable[e])}function Po(s){let t=s>>10;return yi.uint32View[0]=yi.mantissaTable[yi.offsetTable[t]+(s&1023)]+yi.exponentTable[t],yi.floatView[0]}var eh=class{static toHalfFloat(t){return gn(t)}static fromHalfFloat(t){return Po(t)}},Fe=new P,dc=new rt,b_=0,Qt=class extends _n{constructor(t,e,n=!1){if(super(),Array.isArray(t))throw new TypeError("THREE.BufferAttribute: array should be a Typed Array.");this.isBufferAttribute=!0,Object.defineProperty(this,"id",{value:b_++}),this.name="",this.array=t,this.itemSize=e,this.count=t!==void 0?t.length/e:0,this.normalized=n,this.usage=Hl,this.updateRanges=[],this.gpuType=en,this.version=0}onUploadCallback(){}set needsUpdate(t){t===!0&&this.version++}setUsage(t){return this.usage=t,this}addUpdateRange(t,e){this.updateRanges.push({start:t,count:e})}clearUpdateRanges(){this.updateRanges.length=0}copy(t){return this.name=t.name,this.array=new t.array.constructor(t.array),this.itemSize=t.itemSize,this.count=t.count,this.normalized=t.normalized,this.usage=t.usage,this.gpuType=t.gpuType,this}copyAt(t,e,n){t*=this.itemSize,n*=e.itemSize;for(let i=0,r=this.itemSize;i<r;i++)this.array[t+i]=e.array[n+i];return this}copyArray(t){return this.array.set(t),this}applyMatrix3(t){if(this.itemSize===2)for(let e=0,n=this.count;e<n;e++)dc.fromBufferAttribute(this,e),dc.applyMatrix3(t),this.setXY(e,dc.x,dc.y);else if(this.itemSize===3)for(let e=0,n=this.count;e<n;e++)Fe.fromBufferAttribute(this,e),Fe.applyMatrix3(t),this.setXYZ(e,Fe.x,Fe.y,Fe.z);return this}applyMatrix4(t){for(let e=0,n=this.count;e<n;e++)Fe.fromBufferAttribute(this,e),Fe.applyMatrix4(t),this.setXYZ(e,Fe.x,Fe.y,Fe.z);return this}applyNormalMatrix(t){for(let e=0,n=this.count;e<n;e++)Fe.fromBufferAttribute(this,e),Fe.applyNormalMatrix(t),this.setXYZ(e,Fe.x,Fe.y,Fe.z);return this}transformDirection(t){for(let e=0,n=this.count;e<n;e++)Fe.fromBufferAttribute(this,e),Fe.transformDirection(t),this.setXYZ(e,Fe.x,Fe.y,Fe.z);return this}set(t,e=0){return this.array.set(t,e),this}getComponent(t,e){let n=this.array[t*this.itemSize+e];return this.normalized&&(n=cn(n,this.array)),n}setComponent(t,e,n){return this.normalized&&(n=ee(n,this.array)),this.array[t*this.itemSize+e]=n,this}getX(t){let e=this.array[t*this.itemSize];return this.normalized&&(e=cn(e,this.array)),e}setX(t,e){return this.normalized&&(e=ee(e,this.array)),this.array[t*this.itemSize]=e,this}getY(t){let e=this.array[t*this.itemSize+1];return this.normalized&&(e=cn(e,this.array)),e}setY(t,e){return this.normalized&&(e=ee(e,this.array)),this.array[t*this.itemSize+1]=e,this}getZ(t){let e=this.array[t*this.itemSize+2];return this.normalized&&(e=cn(e,this.array)),e}setZ(t,e){return this.normalized&&(e=ee(e,this.array)),this.array[t*this.itemSize+2]=e,this}getW(t){let e=this.array[t*this.itemSize+3];return this.normalized&&(e=cn(e,this.array)),e}setW(t,e){return this.normalized&&(e=ee(e,this.array)),this.array[t*this.itemSize+3]=e,this}setXY(t,e,n){return t*=this.itemSize,this.normalized&&(e=ee(e,this.array),n=ee(n,this.array)),this.array[t+0]=e,this.array[t+1]=n,this}setXYZ(t,e,n,i){return t*=this.itemSize,this.normalized&&(e=ee(e,this.array),n=ee(n,this.array),i=ee(i,this.array)),this.array[t+0]=e,this.array[t+1]=n,this.array[t+2]=i,this}setXYZW(t,e,n,i,r){return t*=this.itemSize,this.normalized&&(e=ee(e,this.array),n=ee(n,this.array),i=ee(i,this.array),r=ee(r,this.array)),this.array[t+0]=e,this.array[t+1]=n,this.array[t+2]=i,this.array[t+3]=r,this}onUpload(t){return this.onUploadCallback=t,this}clone(){return new this.constructor(this.array,this.itemSize).copy(this)}toJSON(){let t={itemSize:this.itemSize,type:this.array.constructor.name,array:Array.from(this.array),normalized:this.normalized};return t.name=this.name,t.usage=this.usage,t.gpuType=this.gpuType,t}dispose(){this.dispatchEvent({type:"dispose"})}},nh=class extends Qt{constructor(t,e,n){super(new Int8Array(t),e,n)}},ih=class extends Qt{constructor(t,e,n){super(new Uint8Array(t),e,n)}},sh=class extends Qt{constructor(t,e,n){super(new Uint8ClampedArray(t),e,n)}},rh=class extends Qt{constructor(t,e,n){super(new Int16Array(t),e,n)}},wr=class extends Qt{constructor(t,e,n){super(new Uint16Array(t),e,n)}},oh=class extends Qt{constructor(t,e,n){super(new Int32Array(t),e,n)}},Ar=class extends Qt{constructor(t,e,n){super(new Uint32Array(t),e,n)}},ah=class extends Qt{constructor(t,e,n){super(new Uint16Array(t),e,n),this.isFloat16BufferAttribute=!0}getX(t){let e=Po(this.array[t*this.itemSize]);return this.normalized&&(e=cn(e,this.array)),e}setX(t,e){return this.normalized&&(e=ee(e,this.array)),this.array[t*this.itemSize]=gn(e),this}getY(t){let e=Po(this.array[t*this.itemSize+1]);return this.normalized&&(e=cn(e,this.array)),e}setY(t,e){return this.normalized&&(e=ee(e,this.array)),this.array[t*this.itemSize+1]=gn(e),this}getZ(t){let e=Po(this.array[t*this.itemSize+2]);return this.normalized&&(e=cn(e,this.array)),e}setZ(t,e){return this.normalized&&(e=ee(e,this.array)),this.array[t*this.itemSize+2]=gn(e),this}getW(t){let e=Po(this.array[t*this.itemSize+3]);return this.normalized&&(e=cn(e,this.array)),e}setW(t,e){return this.normalized&&(e=ee(e,this.array)),this.array[t*this.itemSize+3]=gn(e),this}setXY(t,e,n){return t*=this.itemSize,this.normalized&&(e=ee(e,this.array),n=ee(n,this.array)),this.array[t+0]=gn(e),this.array[t+1]=gn(n),this}setXYZ(t,e,n,i){return t*=this.itemSize,this.normalized&&(e=ee(e,this.array),n=ee(n,this.array),i=ee(i,this.array)),this.array[t+0]=gn(e),this.array[t+1]=gn(n),this.array[t+2]=gn(i),this}setXYZW(t,e,n,i,r){return t*=this.itemSize,this.normalized&&(e=ee(e,this.array),n=ee(n,this.array),i=ee(i,this.array),r=ee(r,this.array)),this.array[t+0]=gn(e),this.array[t+1]=gn(n),this.array[t+2]=gn(i),this.array[t+3]=gn(r),this}},At=class extends Qt{constructor(t,e,n){super(new Float32Array(t),e,n)}},E_=new Ae,Mo=new P,hf=new P,ke=class{constructor(t=new P,e=-1){this.isSphere=!0,this.center=t,this.radius=e}set(t,e){return this.center.copy(t),this.radius=e,this}setFromPoints(t,e){let n=this.center;e!==void 0?n.copy(e):E_.setFromPoints(t).getCenter(n);let i=0;for(let r=0,o=t.length;r<o;r++)i=Math.max(i,n.distanceToSquared(t[r]));return this.radius=Math.sqrt(i),this}copy(t){return this.center.copy(t.center),this.radius=t.radius,this}isEmpty(){return this.radius<0}makeEmpty(){return this.center.set(0,0,0),this.radius=-1,this}containsPoint(t){return t.distanceToSquared(this.center)<=this.radius*this.radius}distanceToPoint(t){return t.distanceTo(this.center)-this.radius}intersectsSphere(t){let e=this.radius+t.radius;return t.center.distanceToSquared(this.center)<=e*e}intersectsBox(t){return t.intersectsSphere(this)}intersectsPlane(t){return Math.abs(t.distanceToPoint(this.center))<=this.radius}clampPoint(t,e){let n=this.center.distanceToSquared(t);return e.copy(t),n>this.radius*this.radius&&(e.sub(this.center).normalize(),e.multiplyScalar(this.radius).add(this.center)),e}getBoundingBox(t){return this.isEmpty()?(t.makeEmpty(),t):(t.set(this.center,this.center),t.expandByScalar(this.radius),t)}applyMatrix4(t){return this.center.applyMatrix4(t),this.radius=this.radius*t.getMaxScaleOnAxis(),this}translate(t){return this.center.add(t),this}expandByPoint(t){if(this.isEmpty())return this.center.copy(t),this.radius=0,this;Mo.subVectors(t,this.center);let e=Mo.lengthSq();if(e>this.radius*this.radius){let n=Math.sqrt(e),i=(n-this.radius)*.5;this.center.addScaledVector(Mo,i/n),this.radius+=i}return this}union(t){return t.isEmpty()?this:this.isEmpty()?(this.copy(t),this):(this.center.equals(t.center)===!0?this.radius=Math.max(this.radius,t.radius):(hf.subVectors(t.center,this.center).setLength(t.radius),this.expandByPoint(Mo.copy(t.center).add(hf)),this.expandByPoint(Mo.copy(t.center).sub(hf))),this)}equals(t){return t.center.equals(this.center)&&t.radius===this.radius}clone(){return new this.constructor().copy(this)}toJSON(){return{radius:this.radius,center:this.center.toArray()}}fromJSON(t){return this.radius=t.radius,this.center.fromArray(t.center),this}},T_=0,An=new Jt,uf=new ae,rr=new P,Mn=new Ae,So=new Ae,Ye=new P,qt=class s extends _n{constructor(){super(),this.isBufferGeometry=!0,Object.defineProperty(this,"id",{value:T_++}),this.uuid=Sn(),this.name="",this.type="BufferGeometry",this.index=null,this.indirect=null,this.indirectOffset=0,this.attributes={},this.morphAttributes={},this.morphTargetsRelative=!1,this.groups=[],this.boundingBox=null,this.boundingSphere=null,this.drawRange={start:0,count:1/0},this.userData={},this._transformed=!1}getIndex(){return this.index}setIndex(t){return Array.isArray(t)?this.index=new(Zx(t)?Ar:wr)(t,1):this.index=t,this}setIndirect(t,e=0){return this.indirect=t,this.indirectOffset=e,this}getIndirect(){return this.indirect}getAttribute(t){return this.attributes[t]}setAttribute(t,e){return this.attributes[t]=e,this}deleteAttribute(t){return delete this.attributes[t],this}hasAttribute(t){return this.attributes[t]!==void 0}addGroup(t,e,n=0){this.groups.push({start:t,count:e,materialIndex:n})}clearGroups(){this.groups=[]}setDrawRange(t,e){this.drawRange.start=t,this.drawRange.count=e}applyMatrix4(t){let e=this.attributes.position;e!==void 0&&(e.applyMatrix4(t),e.needsUpdate=!0);let n=this.attributes.normal;if(n!==void 0){let r=new jt().getNormalMatrix(t);n.applyNormalMatrix(r),n.needsUpdate=!0}let i=this.attributes.tangent;return i!==void 0&&(i.transformDirection(t),i.needsUpdate=!0),this.boundingBox!==null&&this.computeBoundingBox(),this.boundingSphere!==null&&this.computeBoundingSphere(),this._transformed=!0,this}applyQuaternion(t){return An.makeRotationFromQuaternion(t),this.applyMatrix4(An),this}rotateX(t){return An.makeRotationX(t),this.applyMatrix4(An),this}rotateY(t){return An.makeRotationY(t),this.applyMatrix4(An),this}rotateZ(t){return An.makeRotationZ(t),this.applyMatrix4(An),this}translate(t,e,n){return An.makeTranslation(t,e,n),this.applyMatrix4(An),this}scale(t,e,n){return An.makeScale(t,e,n),this.applyMatrix4(An),this}lookAt(t){return uf.lookAt(t),uf.updateMatrix(),this.applyMatrix4(uf.matrix),this}center(){return this.computeBoundingBox(),this.boundingBox.getCenter(rr).negate(),this.translate(rr.x,rr.y,rr.z),this}setFromPoints(t){let e=this.getAttribute("position");if(e===void 0){let n=[];for(let i=0,r=t.length;i<r;i++){let o=t[i];n.push(o.x,o.y,o.z||0)}this.setAttribute("position",new At(n,3))}else{let n=Math.min(t.length,e.count);for(let i=0;i<n;i++){let r=t[i];e.setXYZ(i,r.x,r.y,r.z||0)}t.length>e.count&&St("BufferGeometry: Buffer size too small for points data. Use .dispose() and create a new geometry."),e.needsUpdate=!0}return this}computeBoundingBox(){this.boundingBox===null&&(this.boundingBox=new Ae);let t=this.attributes.position,e=this.morphAttributes.position;if(t&&t.isGLBufferAttribute){Bt("BufferGeometry.computeBoundingBox(): GLBufferAttribute requires a manual bounding box.",this),this.boundingBox.set(new P(-1/0,-1/0,-1/0),new P(1/0,1/0,1/0));return}if(t!==void 0){if(this.boundingBox.setFromBufferAttribute(t),e)for(let n=0,i=e.length;n<i;n++){let r=e[n];Mn.setFromBufferAttribute(r),this.morphTargetsRelative?(Ye.addVectors(this.boundingBox.min,Mn.min),this.boundingBox.expandByPoint(Ye),Ye.addVectors(this.boundingBox.max,Mn.max),this.boundingBox.expandByPoint(Ye)):(this.boundingBox.expandByPoint(Mn.min),this.boundingBox.expandByPoint(Mn.max))}}else this.boundingBox.makeEmpty();(isNaN(this.boundingBox.min.x)||isNaN(this.boundingBox.min.y)||isNaN(this.boundingBox.min.z))&&Bt('BufferGeometry.computeBoundingBox(): Computed min/max have NaN values. The "position" attribute is likely to have NaN values.',this)}computeBoundingSphere(){this.boundingSphere===null&&(this.boundingSphere=new ke);let t=this.attributes.position,e=this.morphAttributes.position;if(t&&t.isGLBufferAttribute){Bt("BufferGeometry.computeBoundingSphere(): GLBufferAttribute requires a manual bounding sphere.",this),this.boundingSphere.set(new P,1/0);return}if(t){let n=this.boundingSphere.center;if(Mn.setFromBufferAttribute(t),e)for(let r=0,o=e.length;r<o;r++){let a=e[r];So.setFromBufferAttribute(a),this.morphTargetsRelative?(Ye.addVectors(Mn.min,So.min),Mn.expandByPoint(Ye),Ye.addVectors(Mn.max,So.max),Mn.expandByPoint(Ye)):(Mn.expandByPoint(So.min),Mn.expandByPoint(So.max))}Mn.getCenter(n);let i=0;for(let r=0,o=t.count;r<o;r++)Ye.fromBufferAttribute(t,r),i=Math.max(i,n.distanceToSquared(Ye));if(e)for(let r=0,o=e.length;r<o;r++){let a=e[r],l=this.morphTargetsRelative;for(let c=0,h=a.count;c<h;c++)Ye.fromBufferAttribute(a,c),l&&(rr.fromBufferAttribute(t,c),Ye.add(rr)),i=Math.max(i,n.distanceToSquared(Ye))}this.boundingSphere.radius=Math.sqrt(i),isNaN(this.boundingSphere.radius)&&Bt('BufferGeometry.computeBoundingSphere(): Computed radius is NaN. The "position" attribute is likely to have NaN values.',this)}}computeTangents(){let t=this.index,e=this.attributes;if(t===null||e.position===void 0||e.normal===void 0||e.uv===void 0){Bt("BufferGeometry: .computeTangents() failed. Missing required attributes (index, position, normal or uv)");return}let n=e.position,i=e.normal,r=e.uv,o=this.getAttribute("tangent");(o===void 0||o.count!==n.count)&&(o=new Qt(new Float32Array(4*n.count),4),this.setAttribute("tangent",o));let a=[],l=[];for(let _=0;_<n.count;_++)a[_]=new P,l[_]=new P;let c=new P,h=new P,f=new P,u=new rt,d=new rt,p=new rt,x=new P,m=new P;function g(_,T,R){c.fromBufferAttribute(n,_),h.fromBufferAttribute(n,T),f.fromBufferAttribute(n,R),u.fromBufferAttribute(r,_),d.fromBufferAttribute(r,T),p.fromBufferAttribute(r,R),h.sub(c),f.sub(c),d.sub(u),p.sub(u);let L=1/(d.x*p.y-p.x*d.y);isFinite(L)&&(x.copy(h).multiplyScalar(p.y).addScaledVector(f,-d.y).multiplyScalar(L),m.copy(f).multiplyScalar(d.x).addScaledVector(h,-p.x).multiplyScalar(L),a[_].add(x),a[T].add(x),a[R].add(x),l[_].add(m),l[T].add(m),l[R].add(m))}let v=this.groups;v.length===0&&(v=[{start:0,count:t.count}]);for(let _=0,T=v.length;_<T;++_){let R=v[_],L=R.start,D=R.count;for(let F=L,C=L+D;F<C;F+=3)g(t.getX(F+0),t.getX(F+1),t.getX(F+2))}let b=new P,y=new P,M=new P,S=new P;function w(_){M.fromBufferAttribute(i,_),S.copy(M);let T=a[_];b.copy(T),b.sub(M.multiplyScalar(M.dot(T))).normalize(),y.crossVectors(S,T);let L=y.dot(l[_])<0?-1:1;o.setXYZW(_,b.x,b.y,b.z,L)}for(let _=0,T=v.length;_<T;++_){let R=v[_],L=R.start,D=R.count;for(let F=L,C=L+D;F<C;F+=3)w(t.getX(F+0)),w(t.getX(F+1)),w(t.getX(F+2))}this._transformed=!0}computeVertexNormals(){let t=this.index,e=this.getAttribute("position");if(e!==void 0){let n=this.getAttribute("normal");if(n===void 0||n.count!==e.count)n=new Qt(new Float32Array(e.count*3),3),this.setAttribute("normal",n);else for(let u=0,d=n.count;u<d;u++)n.setXYZ(u,0,0,0);let i=new P,r=new P,o=new P,a=new P,l=new P,c=new P,h=new P,f=new P;if(t)for(let u=0,d=t.count;u<d;u+=3){let p=t.getX(u+0),x=t.getX(u+1),m=t.getX(u+2);i.fromBufferAttribute(e,p),r.fromBufferAttribute(e,x),o.fromBufferAttribute(e,m),h.subVectors(o,r),f.subVectors(i,r),h.cross(f),a.fromBufferAttribute(n,p),l.fromBufferAttribute(n,x),c.fromBufferAttribute(n,m),a.add(h),l.add(h),c.add(h),n.setXYZ(p,a.x,a.y,a.z),n.setXYZ(x,l.x,l.y,l.z),n.setXYZ(m,c.x,c.y,c.z)}else for(let u=0,d=e.count;u<d;u+=3)i.fromBufferAttribute(e,u+0),r.fromBufferAttribute(e,u+1),o.fromBufferAttribute(e,u+2),h.subVectors(o,r),f.subVectors(i,r),h.cross(f),n.setXYZ(u+0,h.x,h.y,h.z),n.setXYZ(u+1,h.x,h.y,h.z),n.setXYZ(u+2,h.x,h.y,h.z);this.normalizeNormals(),n.needsUpdate=!0}}normalizeNormals(){let t=this.attributes.normal;for(let e=0,n=t.count;e<n;e++)Ye.fromBufferAttribute(t,e),Ye.normalize(),t.setXYZ(e,Ye.x,Ye.y,Ye.z)}toNonIndexed(){function t(a,l){let c=a.array,h=a.itemSize,f=a.normalized,u=new c.constructor(l.length*h),d=0,p=0;for(let x=0,m=l.length;x<m;x++){a.isInterleavedBufferAttribute?d=l[x]*a.data.stride+a.offset:d=l[x]*h;for(let g=0;g<h;g++)u[p++]=c[d++]}return new Qt(u,h,f)}if(this.index===null)return St("BufferGeometry.toNonIndexed(): BufferGeometry is already non-indexed."),this;let e=new s,n=this.index.array,i=this.attributes;for(let a in i){let l=i[a],c=t(l,n);e.setAttribute(a,c)}let r=this.morphAttributes;for(let a in r){let l=[],c=r[a];for(let h=0,f=c.length;h<f;h++){let u=c[h],d=t(u,n);l.push(d)}e.morphAttributes[a]=l}e.morphTargetsRelative=this.morphTargetsRelative;let o=this.groups;for(let a=0,l=o.length;a<l;a++){let c=o[a];e.addGroup(c.start,c.count,c.materialIndex)}return e}toJSON(){let t={metadata:{version:4.7,type:"BufferGeometry",generator:"BufferGeometry.toJSON"}};if(t.uuid=this.uuid,t.type=this.parameters!==void 0&&this._transformed===!0?"BufferGeometry":this.type,t.name=this.name,Object.keys(this.userData).length>0&&(t.userData=this.userData),this.parameters!==void 0&&this._transformed!==!0){let l=this.parameters;for(let c in l)l[c]!==void 0&&(t[c]=l[c]);return t}t.data={attributes:{}};let e=this.index;e!==null&&(t.data.index={type:e.array.constructor.name,array:Array.prototype.slice.call(e.array)});let n=this.attributes;for(let l in n){let c=n[l];t.data.attributes[l]=c.toJSON(t.data)}let i={},r=!1;for(let l in this.morphAttributes){let c=this.morphAttributes[l],h=[];for(let f=0,u=c.length;f<u;f++){let d=c[f];h.push(d.toJSON(t.data))}h.length>0&&(i[l]=h,r=!0)}r&&(t.data.morphAttributes=i,t.data.morphTargetsRelative=this.morphTargetsRelative);let o=this.groups;o.length>0&&(t.data.groups=JSON.parse(JSON.stringify(o)));let a=this.boundingSphere;return a!==null&&(t.data.boundingSphere=a.toJSON()),t}clone(){return new this.constructor().copy(this)}copy(t){this.index=null,this.attributes={},this.morphAttributes={},this.groups=[],this.boundingBox=null,this.boundingSphere=null;let e={};this.name=t.name;let n=t.index;n!==null&&this.setIndex(n.clone());let i=t.attributes;for(let c in i){let h=i[c];this.setAttribute(c,h.clone(e))}let r=t.morphAttributes;for(let c in r){let h=[],f=r[c];for(let u=0,d=f.length;u<d;u++)h.push(f[u].clone(e));this.morphAttributes[c]=h}this.morphTargetsRelative=t.morphTargetsRelative;let o=t.groups;for(let c=0,h=o.length;c<h;c++){let f=o[c];this.addGroup(f.start,f.count,f.materialIndex)}let a=t.boundingBox;a!==null&&(this.boundingBox=a.clone());let l=t.boundingSphere;return l!==null&&(this.boundingSphere=l.clone()),this.drawRange.start=t.drawRange.start,this.drawRange.count=t.drawRange.count,this.userData=t.userData,this._transformed=t._transformed,this}dispose(){this.dispatchEvent({type:"dispose"})}},Zi=class{constructor(t,e){this.isInterleavedBuffer=!0,this.array=t,this.stride=e,this.count=t!==void 0?t.length/e:0,this.usage=Hl,this.updateRanges=[],this.version=0,this.uuid=Sn()}onUploadCallback(){}set needsUpdate(t){t===!0&&this.version++}setUsage(t){return this.usage=t,this}addUpdateRange(t,e){this.updateRanges.push({start:t,count:e})}clearUpdateRanges(){this.updateRanges.length=0}copy(t){return this.array=new t.array.constructor(t.array),this.count=t.count,this.stride=t.stride,this.usage=t.usage,this}copyAt(t,e,n){t*=this.stride,n*=e.stride;for(let i=0,r=this.stride;i<r;i++)this.array[t+i]=e.array[n+i];return this}set(t,e=0){return this.array.set(t,e),this}clone(t){t.arrayBuffers===void 0&&(t.arrayBuffers={}),this.array.buffer._uuid===void 0&&(this.array.buffer._uuid=Sn()),t.arrayBuffers[this.array.buffer._uuid]===void 0&&(t.arrayBuffers[this.array.buffer._uuid]=this.array.slice(0).buffer);let e=new this.array.constructor(t.arrayBuffers[this.array.buffer._uuid]),n=new this.constructor(e,this.stride);return n.setUsage(this.usage),n}onUpload(t){return this.onUploadCallback=t,this}toJSON(t){t.arrayBuffers===void 0&&(t.arrayBuffers={}),this.array.buffer._uuid===void 0&&(this.array.buffer._uuid=Sn()),t.arrayBuffers[this.array.buffer._uuid]===void 0&&(t.arrayBuffers[this.array.buffer._uuid]=Array.from(new Uint32Array(this.array.buffer)));let e={uuid:this.uuid,buffer:this.array.buffer._uuid,type:this.array.constructor.name,stride:this.stride};return e.usage=this.usage,e}},ln=new P,Mi=class s{constructor(t,e,n,i=!1){this.isInterleavedBufferAttribute=!0,this.name="",this.data=t,this.itemSize=e,this.offset=n,this.normalized=i}get count(){return this.data.count}get array(){return this.data.array}set needsUpdate(t){this.data.needsUpdate=t}applyMatrix4(t){for(let e=0,n=this.data.count;e<n;e++)ln.fromBufferAttribute(this,e),ln.applyMatrix4(t),this.setXYZ(e,ln.x,ln.y,ln.z);return this}applyNormalMatrix(t){for(let e=0,n=this.count;e<n;e++)ln.fromBufferAttribute(this,e),ln.applyNormalMatrix(t),this.setXYZ(e,ln.x,ln.y,ln.z);return this}transformDirection(t){for(let e=0,n=this.count;e<n;e++)ln.fromBufferAttribute(this,e),ln.transformDirection(t),this.setXYZ(e,ln.x,ln.y,ln.z);return this}getComponent(t,e){let n=this.array[t*this.data.stride+this.offset+e];return this.normalized&&(n=cn(n,this.array)),n}setComponent(t,e,n){return this.normalized&&(n=ee(n,this.array)),this.data.array[t*this.data.stride+this.offset+e]=n,this}setX(t,e){return this.normalized&&(e=ee(e,this.array)),this.data.array[t*this.data.stride+this.offset]=e,this}setY(t,e){return this.normalized&&(e=ee(e,this.array)),this.data.array[t*this.data.stride+this.offset+1]=e,this}setZ(t,e){return this.normalized&&(e=ee(e,this.array)),this.data.array[t*this.data.stride+this.offset+2]=e,this}setW(t,e){return this.normalized&&(e=ee(e,this.array)),this.data.array[t*this.data.stride+this.offset+3]=e,this}getX(t){let e=this.data.array[t*this.data.stride+this.offset];return this.normalized&&(e=cn(e,this.array)),e}getY(t){let e=this.data.array[t*this.data.stride+this.offset+1];return this.normalized&&(e=cn(e,this.array)),e}getZ(t){let e=this.data.array[t*this.data.stride+this.offset+2];return this.normalized&&(e=cn(e,this.array)),e}getW(t){let e=this.data.array[t*this.data.stride+this.offset+3];return this.normalized&&(e=cn(e,this.array)),e}setXY(t,e,n){return t=t*this.data.stride+this.offset,this.normalized&&(e=ee(e,this.array),n=ee(n,this.array)),this.data.array[t+0]=e,this.data.array[t+1]=n,this}setXYZ(t,e,n,i){return t=t*this.data.stride+this.offset,this.normalized&&(e=ee(e,this.array),n=ee(n,this.array),i=ee(i,this.array)),this.data.array[t+0]=e,this.data.array[t+1]=n,this.data.array[t+2]=i,this}setXYZW(t,e,n,i,r){return t=t*this.data.stride+this.offset,this.normalized&&(e=ee(e,this.array),n=ee(n,this.array),i=ee(i,this.array),r=ee(r,this.array)),this.data.array[t+0]=e,this.data.array[t+1]=n,this.data.array[t+2]=i,this.data.array[t+3]=r,this}clone(t){if(t===void 0){Er("InterleavedBufferAttribute.clone(): Cloning an interleaved buffer attribute will de-interleave buffer data.");let e=[];for(let n=0;n<this.count;n++){let i=n*this.data.stride+this.offset;for(let r=0;r<this.itemSize;r++)e.push(this.data.array[i+r])}return new Qt(new this.array.constructor(e),this.itemSize,this.normalized)}else return t.interleavedBuffers===void 0&&(t.interleavedBuffers={}),t.interleavedBuffers[this.data.uuid]===void 0&&(t.interleavedBuffers[this.data.uuid]=this.data.clone(t)),new s(t.interleavedBuffers[this.data.uuid],this.itemSize,this.offset,this.normalized)}toJSON(t){if(t===void 0){Er("InterleavedBufferAttribute.toJSON(): Serializing an interleaved buffer attribute will de-interleave buffer data.");let e=[];for(let n=0;n<this.count;n++){let i=n*this.data.stride+this.offset;for(let r=0;r<this.itemSize;r++)e.push(this.data.array[i+r])}return{itemSize:this.itemSize,type:this.array.constructor.name,array:e,normalized:this.normalized}}else return t.interleavedBuffers===void 0&&(t.interleavedBuffers={}),t.interleavedBuffers[this.data.uuid]===void 0&&(t.interleavedBuffers[this.data.uuid]=this.data.toJSON(t)),{isInterleavedBufferAttribute:!0,itemSize:this.itemSize,data:this.data.uuid,offset:this.offset,normalized:this.normalized}}},ff=new P,w_=new P,A_=new jt,Rn=class{constructor(t=new P(1,0,0),e=0){this.isPlane=!0,this.normal=t,this.constant=e}set(t,e){return this.normal.copy(t),this.constant=e,this}setComponents(t,e,n,i){return this.normal.set(t,e,n),this.constant=i,this}setFromNormalAndCoplanarPoint(t,e){return this.normal.copy(t),this.constant=-e.dot(this.normal),this}setFromCoplanarPoints(t,e,n){let i=ff.subVectors(n,e).cross(w_.subVectors(t,e)).normalize();return this.setFromNormalAndCoplanarPoint(i,t),this}copy(t){return this.normal.copy(t.normal),this.constant=t.constant,this}normalize(){let t=1/this.normal.length();return this.normal.multiplyScalar(t),this.constant*=t,this}negate(){return this.constant*=-1,this.normal.negate(),this}distanceToPoint(t){return this.normal.dot(t)+this.constant}distanceToSphere(t){return this.distanceToPoint(t.center)-t.radius}projectPoint(t,e){return e.copy(t).addScaledVector(this.normal,-this.distanceToPoint(t))}intersectLine(t,e,n=!0){let i=t.delta(ff),r=this.normal.dot(i);if(r===0)return this.distanceToPoint(t.start)===0?e.copy(t.start):null;let o=-(t.start.dot(this.normal)+this.constant)/r;return n===!0&&(o<0||o>1)?null:e.copy(t.start).addScaledVector(i,o)}intersectsLine(t){let e=this.distanceToPoint(t.start),n=this.distanceToPoint(t.end);return e<0&&n>0||n<0&&e>0}intersectsBox(t){return t.intersectsPlane(this)}intersectsSphere(t){return t.intersectsPlane(this)}coplanarPoint(t){return t.copy(this.normal).multiplyScalar(-this.constant)}applyMatrix4(t,e){let n=e||A_.getNormalMatrix(t),i=this.coplanarPoint(ff).applyMatrix4(t),r=this.normal.applyMatrix3(n).normalize();return this.constant=-i.dot(r),this}translate(t){return this.constant-=t.dot(this.normal),this}equals(t){return t.normal.equals(this.normal)&&t.constant===this.constant}clone(){return new this.constructor().copy(this)}toJSON(){return{normal:this.normal.toArray(),constant:this.constant}}fromJSON(t){return this.normal.fromArray(t.normal),this.constant=t.constant,this}},R_=0,Ge=class extends _n{constructor(){super(),this.isMaterial=!0,Object.defineProperty(this,"id",{value:R_++}),this.uuid=Sn(),this.name="",this.type="Material",this.blending=Us,this.side=Ri,this.vertexColors=!1,this.opacity=1,this.transparent=!1,this.alphaHash=!1,this.blendSrc=cu,this.blendDst=hu,this.blendEquation=ns,this.blendSrcAlpha=null,this.blendDstAlpha=null,this.blendEquationAlpha=null,this.blendColor=new _t(0,0,0),this.blendAlpha=0,this.depthFunc=ys,this.depthTest=!0,this.depthWrite=!0,this.stencilWriteMask=255,this.stencilFunc=Sd,this.stencilRef=0,this.stencilFuncMask=255,this.stencilFail=No,this.stencilZFail=No,this.stencilZPass=No,this.stencilWrite=!1,this.clippingPlanes=null,this.clipIntersection=!1,this.clipShadows=!1,this.shadowSide=null,this.colorWrite=!0,this.precision=null,this.polygonOffset=!1,this.polygonOffsetFactor=0,this.polygonOffsetUnits=0,this.dithering=!1,this.alphaToCoverage=!1,this.premultipliedAlpha=!1,this.forceSinglePass=!1,this.allowOverride=!0,this.visible=!0,this.toneMapped=!0,this.userData={},this.version=0,this._alphaTest=0}get alphaTest(){return this._alphaTest}set alphaTest(t){this._alphaTest>0!=t>0&&this.version++,this._alphaTest=t}onBeforeRender(){}onBeforeCompile(){}customProgramCacheKey(){return this.onBeforeCompile.toString()}setValues(t){if(t!==void 0)for(let e in t){let n=t[e];if(n===void 0){St(`Material: parameter '${e}' has value of undefined.`);continue}let i=this[e];if(i===void 0){St(`Material: '${e}' is not a property of THREE.${this.type}.`);continue}i&&i.isColor?i.set(n):i&&i.isVector2&&n&&n.isVector2||i&&i.isEuler&&n&&n.isEuler||i&&i.isVector3&&n&&n.isVector3?i.copy(n):this[e]=n}}toJSON(t){let e=t===void 0||typeof t=="string";e&&(t={textures:{},images:{}});let n={metadata:{version:4.7,type:"Material",generator:"Material.toJSON"}};n.uuid=this.uuid,n.type=this.type,n.blending=this.blending,n.side=this.side,n.shadowSide=this.shadowSide,n.vertexColors=this.vertexColors,n.opacity=this.opacity,n.transparent=this.transparent,n.blendSrc=this.blendSrc,n.blendDst=this.blendDst,n.blendEquation=this.blendEquation,n.blendSrcAlpha=this.blendSrcAlpha,n.blendDstAlpha=this.blendDstAlpha,n.blendEquationAlpha=this.blendEquationAlpha,n.blendColor=this.blendColor.getHex(),n.blendAlpha=this.blendAlpha,n.depthFunc=this.depthFunc,n.depthTest=this.depthTest,n.depthWrite=this.depthWrite,n.colorWrite=this.colorWrite,n.clipIntersection=this.clipIntersection,n.clipShadows=this.clipShadows,n.stencilWriteMask=this.stencilWriteMask,n.stencilFunc=this.stencilFunc,n.stencilRef=this.stencilRef,n.stencilFuncMask=this.stencilFuncMask,n.stencilFail=this.stencilFail,n.stencilZFail=this.stencilZFail,n.stencilZPass=this.stencilZPass,n.stencilWrite=this.stencilWrite,n.polygonOffset=this.polygonOffset,n.polygonOffsetFactor=this.polygonOffsetFactor,n.polygonOffsetUnits=this.polygonOffsetUnits,n.dithering=this.dithering,n.alphaTest=this.alphaTest,n.alphaHash=this.alphaHash,n.alphaToCoverage=this.alphaToCoverage,n.premultipliedAlpha=this.premultipliedAlpha,n.forceSinglePass=this.forceSinglePass,n.allowOverride=this.allowOverride,n.visible=this.visible,n.toneMapped=this.toneMapped,n.name=this.name,this.color&&this.color.isColor&&(n.color=this.color.getHex()),this.roughness!==void 0&&(n.roughness=this.roughness),this.metalness!==void 0&&(n.metalness=this.metalness),this.sheen!==void 0&&(n.sheen=this.sheen),this.sheenColor&&this.sheenColor.isColor&&(n.sheenColor=this.sheenColor.getHex()),this.sheenRoughness!==void 0&&(n.sheenRoughness=this.sheenRoughness),this.emissive&&this.emissive.isColor&&(n.emissive=this.emissive.getHex()),this.emissiveIntensity!==void 0&&(n.emissiveIntensity=this.emissiveIntensity),this.specular&&this.specular.isColor&&(n.specular=this.specular.getHex()),this.specularIntensity!==void 0&&(n.specularIntensity=this.specularIntensity),this.specularColor&&this.specularColor.isColor&&(n.specularColor=this.specularColor.getHex()),this.shininess!==void 0&&(n.shininess=this.shininess),this.clearcoat!==void 0&&(n.clearcoat=this.clearcoat),this.clearcoatRoughness!==void 0&&(n.clearcoatRoughness=this.clearcoatRoughness),this.clearcoatMap&&this.clearcoatMap.isTexture&&(n.clearcoatMap=this.clearcoatMap.toJSON(t).uuid),this.clearcoatRoughnessMap&&this.clearcoatRoughnessMap.isTexture&&(n.clearcoatRoughnessMap=this.clearcoatRoughnessMap.toJSON(t).uuid),this.clearcoatNormalMap&&this.clearcoatNormalMap.isTexture&&(n.clearcoatNormalMap=this.clearcoatNormalMap.toJSON(t).uuid,n.clearcoatNormalScale=this.clearcoatNormalScale.toArray()),this.sheenColorMap&&this.sheenColorMap.isTexture&&(n.sheenColorMap=this.sheenColorMap.toJSON(t).uuid),this.sheenRoughnessMap&&this.sheenRoughnessMap.isTexture&&(n.sheenRoughnessMap=this.sheenRoughnessMap.toJSON(t).uuid),this.dispersion!==void 0&&(n.dispersion=this.dispersion),this.retroreflectivity!==void 0&&(n.retroreflectivity=this.retroreflectivity),this.iridescence!==void 0&&(n.iridescence=this.iridescence),this.iridescenceIOR!==void 0&&(n.iridescenceIOR=this.iridescenceIOR),this.iridescenceThicknessRange!==void 0&&(n.iridescenceThicknessRange=this.iridescenceThicknessRange),this.iridescenceMap&&this.iridescenceMap.isTexture&&(n.iridescenceMap=this.iridescenceMap.toJSON(t).uuid),this.iridescenceThicknessMap&&this.iridescenceThicknessMap.isTexture&&(n.iridescenceThicknessMap=this.iridescenceThicknessMap.toJSON(t).uuid),this.anisotropy!==void 0&&(n.anisotropy=this.anisotropy),this.anisotropyRotation!==void 0&&(n.anisotropyRotation=this.anisotropyRotation),this.anisotropyMap&&this.anisotropyMap.isTexture&&(n.anisotropyMap=this.anisotropyMap.toJSON(t).uuid),this.map&&this.map.isTexture&&(n.map=this.map.toJSON(t).uuid),this.matcap&&this.matcap.isTexture&&(n.matcap=this.matcap.toJSON(t).uuid),this.alphaMap&&this.alphaMap.isTexture&&(n.alphaMap=this.alphaMap.toJSON(t).uuid),this.lightMap&&this.lightMap.isTexture&&(n.lightMap=this.lightMap.toJSON(t).uuid,n.lightMapIntensity=this.lightMapIntensity),this.aoMap&&this.aoMap.isTexture&&(n.aoMap=this.aoMap.toJSON(t).uuid,n.aoMapIntensity=this.aoMapIntensity),this.bumpMap&&this.bumpMap.isTexture&&(n.bumpMap=this.bumpMap.toJSON(t).uuid,n.bumpScale=this.bumpScale),this.normalMap&&this.normalMap.isTexture&&(n.normalMap=this.normalMap.toJSON(t).uuid,n.normalMapType=this.normalMapType,n.normalScale=this.normalScale.toArray()),this.displacementMap&&this.displacementMap.isTexture&&(n.displacementMap=this.displacementMap.toJSON(t).uuid,n.displacementScale=this.displacementScale,n.displacementBias=this.displacementBias),this.roughnessMap&&this.roughnessMap.isTexture&&(n.roughnessMap=this.roughnessMap.toJSON(t).uuid),this.metalnessMap&&this.metalnessMap.isTexture&&(n.metalnessMap=this.metalnessMap.toJSON(t).uuid),this.emissiveMap&&this.emissiveMap.isTexture&&(n.emissiveMap=this.emissiveMap.toJSON(t).uuid),this.specularMap&&this.specularMap.isTexture&&(n.specularMap=this.specularMap.toJSON(t).uuid),this.specularIntensityMap&&this.specularIntensityMap.isTexture&&(n.specularIntensityMap=this.specularIntensityMap.toJSON(t).uuid),this.specularColorMap&&this.specularColorMap.isTexture&&(n.specularColorMap=this.specularColorMap.toJSON(t).uuid),this.envMap&&this.envMap.isTexture&&(n.envMap=this.envMap.toJSON(t).uuid,this.combine!==void 0&&(n.combine=this.combine)),this.envMapRotation!==void 0&&(n.envMapRotation=this.envMapRotation.toArray()),this.envMapIntensity!==void 0&&(n.envMapIntensity=this.envMapIntensity),this.reflectivity!==void 0&&(n.reflectivity=this.reflectivity),this.refractionRatio!==void 0&&(n.refractionRatio=this.refractionRatio),this.gradientMap&&this.gradientMap.isTexture&&(n.gradientMap=this.gradientMap.toJSON(t).uuid),this.transmission!==void 0&&(n.transmission=this.transmission),this.transmissionMap&&this.transmissionMap.isTexture&&(n.transmissionMap=this.transmissionMap.toJSON(t).uuid),this.thickness!==void 0&&(n.thickness=this.thickness),this.thicknessMap&&this.thicknessMap.isTexture&&(n.thicknessMap=this.thicknessMap.toJSON(t).uuid),this.attenuationDistance!==void 0&&(n.attenuationDistance=this.attenuationDistance),this.attenuationColor!==void 0&&(n.attenuationColor=this.attenuationColor.getHex()),this.size!==void 0&&(n.size=this.size),this.sizeAttenuation!==void 0&&(n.sizeAttenuation=this.sizeAttenuation),Array.isArray(this.clippingPlanes)&&this.clippingPlanes.length>0&&(n.clippingPlanes=this.clippingPlanes.map(r=>r.toJSON())),this.rotation!==void 0&&(n.rotation=this.rotation),this.depthPacking!==void 0&&(n.depthPacking=this.depthPacking),this.linewidth!==void 0&&(n.linewidth=this.linewidth),this.linecap!==void 0&&(n.linecap=this.linecap),this.linejoin!==void 0&&(n.linejoin=this.linejoin),this.dashSize!==void 0&&(n.dashSize=this.dashSize),this.gapSize!==void 0&&(n.gapSize=this.gapSize),this.scale!==void 0&&(n.scale=this.scale),this.wireframe!==void 0&&(n.wireframe=this.wireframe),this.wireframeLinewidth!==void 0&&(n.wireframeLinewidth=this.wireframeLinewidth),this.wireframeLinecap!==void 0&&(n.wireframeLinecap=this.wireframeLinecap),this.wireframeLinejoin!==void 0&&(n.wireframeLinejoin=this.wireframeLinejoin),this.flatShading!==void 0&&(n.flatShading=this.flatShading),this.fog!==void 0&&(n.fog=this.fog),Object.keys(this.userData).length>0&&(n.userData=this.userData);function i(r){let o=[];for(let a in r){let l=r[a];delete l.metadata,o.push(l)}return o}if(e){let r=i(t.textures),o=i(t.images);r.length>0&&(n.textures=r),o.length>0&&(n.images=o)}return n}fromJSON(t,e){if(t.uuid!==void 0&&(this.uuid=t.uuid),t.name!==void 0&&(this.name=t.name),t.color!==void 0&&this.color!==void 0&&this.color.setHex(t.color),t.roughness!==void 0&&(this.roughness=t.roughness),t.metalness!==void 0&&(this.metalness=t.metalness),t.sheen!==void 0&&(this.sheen=t.sheen),t.sheenColor!==void 0&&(this.sheenColor=new _t().setHex(t.sheenColor)),t.sheenRoughness!==void 0&&(this.sheenRoughness=t.sheenRoughness),t.emissive!==void 0&&this.emissive!==void 0&&this.emissive.setHex(t.emissive),t.specular!==void 0&&this.specular!==void 0&&this.specular.setHex(t.specular),t.specularIntensity!==void 0&&(this.specularIntensity=t.specularIntensity),t.specularColor!==void 0&&this.specularColor!==void 0&&this.specularColor.setHex(t.specularColor),t.shininess!==void 0&&(this.shininess=t.shininess),t.clearcoat!==void 0&&(this.clearcoat=t.clearcoat),t.clearcoatRoughness!==void 0&&(this.clearcoatRoughness=t.clearcoatRoughness),t.dispersion!==void 0&&(this.dispersion=t.dispersion),t.retroreflectivity!==void 0&&(this.retroreflectivity=t.retroreflectivity),t.iridescence!==void 0&&(this.iridescence=t.iridescence),t.iridescenceIOR!==void 0&&(this.iridescenceIOR=t.iridescenceIOR),t.iridescenceThicknessRange!==void 0&&(this.iridescenceThicknessRange=t.iridescenceThicknessRange),t.transmission!==void 0&&(this.transmission=t.transmission),t.thickness!==void 0&&(this.thickness=t.thickness),t.attenuationDistance!==void 0&&(this.attenuationDistance=t.attenuationDistance),t.attenuationColor!==void 0&&this.attenuationColor!==void 0&&this.attenuationColor.setHex(t.attenuationColor),t.anisotropy!==void 0&&(this.anisotropy=t.anisotropy),t.anisotropyRotation!==void 0&&(this.anisotropyRotation=t.anisotropyRotation),t.fog!==void 0&&(this.fog=t.fog),t.flatShading!==void 0&&(this.flatShading=t.flatShading),t.blending!==void 0&&(this.blending=t.blending),t.combine!==void 0&&(this.combine=t.combine),t.side!==void 0&&(this.side=t.side),t.shadowSide!==void 0&&(this.shadowSide=t.shadowSide),t.opacity!==void 0&&(this.opacity=t.opacity),t.transparent!==void 0&&(this.transparent=t.transparent),t.alphaTest!==void 0&&(this.alphaTest=t.alphaTest),t.alphaHash!==void 0&&(this.alphaHash=t.alphaHash),t.depthFunc!==void 0&&(this.depthFunc=t.depthFunc),t.depthTest!==void 0&&(this.depthTest=t.depthTest),t.depthWrite!==void 0&&(this.depthWrite=t.depthWrite),t.colorWrite!==void 0&&(this.colorWrite=t.colorWrite),t.clippingPlanes!==void 0&&(this.clippingPlanes=t.clippingPlanes.map(n=>new Rn().fromJSON(n))),t.clipIntersection!==void 0&&(this.clipIntersection=t.clipIntersection),t.clipShadows!==void 0&&(this.clipShadows=t.clipShadows),t.depthPacking!==void 0&&(this.depthPacking=t.depthPacking),t.blendSrc!==void 0&&(this.blendSrc=t.blendSrc),t.blendDst!==void 0&&(this.blendDst=t.blendDst),t.blendEquation!==void 0&&(this.blendEquation=t.blendEquation),t.blendSrcAlpha!==void 0&&(this.blendSrcAlpha=t.blendSrcAlpha),t.blendDstAlpha!==void 0&&(this.blendDstAlpha=t.blendDstAlpha),t.blendEquationAlpha!==void 0&&(this.blendEquationAlpha=t.blendEquationAlpha),t.blendColor!==void 0&&this.blendColor!==void 0&&this.blendColor.setHex(t.blendColor),t.blendAlpha!==void 0&&(this.blendAlpha=t.blendAlpha),t.stencilWriteMask!==void 0&&(this.stencilWriteMask=t.stencilWriteMask),t.stencilFunc!==void 0&&(this.stencilFunc=t.stencilFunc),t.stencilRef!==void 0&&(this.stencilRef=t.stencilRef),t.stencilFuncMask!==void 0&&(this.stencilFuncMask=t.stencilFuncMask),t.stencilFail!==void 0&&(this.stencilFail=t.stencilFail),t.stencilZFail!==void 0&&(this.stencilZFail=t.stencilZFail),t.stencilZPass!==void 0&&(this.stencilZPass=t.stencilZPass),t.stencilWrite!==void 0&&(this.stencilWrite=t.stencilWrite),t.wireframe!==void 0&&(this.wireframe=t.wireframe),t.wireframeLinewidth!==void 0&&(this.wireframeLinewidth=t.wireframeLinewidth),t.wireframeLinecap!==void 0&&(this.wireframeLinecap=t.wireframeLinecap),t.wireframeLinejoin!==void 0&&(this.wireframeLinejoin=t.wireframeLinejoin),t.rotation!==void 0&&(this.rotation=t.rotation),t.linewidth!==void 0&&(this.linewidth=t.linewidth),t.linecap!==void 0&&(this.linecap=t.linecap),t.linejoin!==void 0&&(this.linejoin=t.linejoin),t.dashSize!==void 0&&(this.dashSize=t.dashSize),t.gapSize!==void 0&&(this.gapSize=t.gapSize),t.scale!==void 0&&(this.scale=t.scale),t.polygonOffset!==void 0&&(this.polygonOffset=t.polygonOffset),t.polygonOffsetFactor!==void 0&&(this.polygonOffsetFactor=t.polygonOffsetFactor),t.polygonOffsetUnits!==void 0&&(this.polygonOffsetUnits=t.polygonOffsetUnits),t.dithering!==void 0&&(this.dithering=t.dithering),t.alphaToCoverage!==void 0&&(this.alphaToCoverage=t.alphaToCoverage),t.premultipliedAlpha!==void 0&&(this.premultipliedAlpha=t.premultipliedAlpha),t.forceSinglePass!==void 0&&(this.forceSinglePass=t.forceSinglePass),t.allowOverride!==void 0&&(this.allowOverride=t.allowOverride),t.visible!==void 0&&(this.visible=t.visible),t.toneMapped!==void 0&&(this.toneMapped=t.toneMapped),t.userData!==void 0&&(this.userData=t.userData),t.vertexColors!==void 0&&(typeof t.vertexColors=="number"?this.vertexColors=t.vertexColors>0:this.vertexColors=t.vertexColors),t.size!==void 0&&(this.size=t.size),t.sizeAttenuation!==void 0&&(this.sizeAttenuation=t.sizeAttenuation),t.map!==void 0&&(this.map=e[t.map]||null),t.matcap!==void 0&&(this.matcap=e[t.matcap]||null),t.alphaMap!==void 0&&(this.alphaMap=e[t.alphaMap]||null),t.bumpMap!==void 0&&(this.bumpMap=e[t.bumpMap]||null),t.bumpScale!==void 0&&(this.bumpScale=t.bumpScale),t.normalMap!==void 0&&(this.normalMap=e[t.normalMap]||null),t.normalMapType!==void 0&&(this.normalMapType=t.normalMapType),t.normalScale!==void 0){let n=t.normalScale;Array.isArray(n)===!1&&(n=[n,n]),this.normalScale=new rt().fromArray(n)}return t.displacementMap!==void 0&&(this.displacementMap=e[t.displacementMap]||null),t.displacementScale!==void 0&&(this.displacementScale=t.displacementScale),t.displacementBias!==void 0&&(this.displacementBias=t.displacementBias),t.roughnessMap!==void 0&&(this.roughnessMap=e[t.roughnessMap]||null),t.metalnessMap!==void 0&&(this.metalnessMap=e[t.metalnessMap]||null),t.emissiveMap!==void 0&&(this.emissiveMap=e[t.emissiveMap]||null),t.emissiveIntensity!==void 0&&(this.emissiveIntensity=t.emissiveIntensity),t.specularMap!==void 0&&(this.specularMap=e[t.specularMap]||null),t.specularIntensityMap!==void 0&&(this.specularIntensityMap=e[t.specularIntensityMap]||null),t.specularColorMap!==void 0&&(this.specularColorMap=e[t.specularColorMap]||null),t.envMap!==void 0&&(this.envMap=e[t.envMap]||null),t.envMapRotation!==void 0&&this.envMapRotation.fromArray(t.envMapRotation),t.envMapIntensity!==void 0&&(this.envMapIntensity=t.envMapIntensity),t.reflectivity!==void 0&&(this.reflectivity=t.reflectivity),t.refractionRatio!==void 0&&(this.refractionRatio=t.refractionRatio),t.lightMap!==void 0&&(this.lightMap=e[t.lightMap]||null),t.lightMapIntensity!==void 0&&(this.lightMapIntensity=t.lightMapIntensity),t.aoMap!==void 0&&(this.aoMap=e[t.aoMap]||null),t.aoMapIntensity!==void 0&&(this.aoMapIntensity=t.aoMapIntensity),t.gradientMap!==void 0&&(this.gradientMap=e[t.gradientMap]||null),t.clearcoatMap!==void 0&&(this.clearcoatMap=e[t.clearcoatMap]||null),t.clearcoatRoughnessMap!==void 0&&(this.clearcoatRoughnessMap=e[t.clearcoatRoughnessMap]||null),t.clearcoatNormalMap!==void 0&&(this.clearcoatNormalMap=e[t.clearcoatNormalMap]||null),t.clearcoatNormalScale!==void 0&&(this.clearcoatNormalScale=new rt().fromArray(t.clearcoatNormalScale)),t.iridescenceMap!==void 0&&(this.iridescenceMap=e[t.iridescenceMap]||null),t.iridescenceThicknessMap!==void 0&&(this.iridescenceThicknessMap=e[t.iridescenceThicknessMap]||null),t.transmissionMap!==void 0&&(this.transmissionMap=e[t.transmissionMap]||null),t.thicknessMap!==void 0&&(this.thicknessMap=e[t.thicknessMap]||null),t.anisotropyMap!==void 0&&(this.anisotropyMap=e[t.anisotropyMap]||null),t.sheenColorMap!==void 0&&(this.sheenColorMap=e[t.sheenColorMap]||null),t.sheenRoughnessMap!==void 0&&(this.sheenRoughnessMap=e[t.sheenRoughnessMap]||null),this}clone(){return new this.constructor().copy(this)}copy(t){this.name=t.name,this.blending=t.blending,this.side=t.side,this.vertexColors=t.vertexColors,this.opacity=t.opacity,this.transparent=t.transparent,this.blendSrc=t.blendSrc,this.blendDst=t.blendDst,this.blendEquation=t.blendEquation,this.blendSrcAlpha=t.blendSrcAlpha,this.blendDstAlpha=t.blendDstAlpha,this.blendEquationAlpha=t.blendEquationAlpha,this.blendColor.copy(t.blendColor),this.blendAlpha=t.blendAlpha,this.depthFunc=t.depthFunc,this.depthTest=t.depthTest,this.depthWrite=t.depthWrite,this.stencilWriteMask=t.stencilWriteMask,this.stencilFunc=t.stencilFunc,this.stencilRef=t.stencilRef,this.stencilFuncMask=t.stencilFuncMask,this.stencilFail=t.stencilFail,this.stencilZFail=t.stencilZFail,this.stencilZPass=t.stencilZPass,this.stencilWrite=t.stencilWrite;let e=t.clippingPlanes,n=null;if(e!==null){let i=e.length;n=new Array(i);for(let r=0;r!==i;++r)n[r]=e[r].clone()}return this.clippingPlanes=n,this.clipIntersection=t.clipIntersection,this.clipShadows=t.clipShadows,this.shadowSide=t.shadowSide,this.colorWrite=t.colorWrite,this.precision=t.precision,this.polygonOffset=t.polygonOffset,this.polygonOffsetFactor=t.polygonOffsetFactor,this.polygonOffsetUnits=t.polygonOffsetUnits,this.dithering=t.dithering,this.alphaTest=t.alphaTest,this.alphaHash=t.alphaHash,this.alphaToCoverage=t.alphaToCoverage,this.premultipliedAlpha=t.premultipliedAlpha,this.forceSinglePass=t.forceSinglePass,this.allowOverride=t.allowOverride,this.visible=t.visible,this.toneMapped=t.toneMapped,this.userData=JSON.parse(JSON.stringify(t.userData)),this}dispose(){this.dispatchEvent({type:"dispose"})}set needsUpdate(t){t===!0&&this.version++}},Ji=class extends Ge{constructor(t){super(),this.isSpriteMaterial=!0,this.type="SpriteMaterial",this.color=new _t(16777215),this.map=null,this.alphaMap=null,this.rotation=0,this.sizeAttenuation=!0,this.transparent=!0,this.fog=!0,this.setValues(t)}copy(t){return super.copy(t),this.color.copy(t.color),this.map=t.map,this.alphaMap=t.alphaMap,this.rotation=t.rotation,this.sizeAttenuation=t.sizeAttenuation,this.fog=t.fog,this}},or,bo=new P,ar=new P,lr=new P,cr=new rt,Eo=new rt,hg=new Jt,pc=new P,To=new P,mc=new P,pm=new rt,df=new rt,mm=new rt,Ts=class extends ae{constructor(t=new Ji){if(super(),this.isSprite=!0,this.type="Sprite",or===void 0){or=new qt;let e=new Float32Array([-.5,-.5,0,0,0,.5,-.5,0,1,0,.5,.5,0,1,1,-.5,.5,0,0,1]),n=new Zi(e,5);or.setIndex([0,1,2,0,2,3]),or.setAttribute("position",new Mi(n,3,0,!1)),or.setAttribute("uv",new Mi(n,2,3,!1))}this.geometry=or,this.material=t,this.center=new rt(.5,.5),this.count=1}intersectsFrustum(t){return t.intersectsSprite(this)}raycast(t,e){t.camera===null&&Bt('Sprite: "Raycaster.camera" needs to be set in order to raycast against sprites.'),ar.setFromMatrixScale(this.matrixWorld),hg.copy(t.camera.matrixWorld),this.modelViewMatrix.multiplyMatrices(t.camera.matrixWorldInverse,this.matrixWorld),lr.setFromMatrixPosition(this.modelViewMatrix),t.camera.isPerspectiveCamera&&this.material.sizeAttenuation===!1&&ar.multiplyScalar(-lr.z);let n=this.material.rotation,i,r;n!==0&&(r=Math.cos(n),i=Math.sin(n));let o=this.center;gc(pc.set(-.5,-.5,0),lr,o,ar,i,r),gc(To.set(.5,-.5,0),lr,o,ar,i,r),gc(mc.set(.5,.5,0),lr,o,ar,i,r),pm.set(0,0),df.set(1,0),mm.set(1,1);let a=t.ray.intersectTriangle(pc,To,mc,!1,bo);if(a===null&&(gc(To.set(-.5,.5,0),lr,o,ar,i,r),df.set(0,1),a=t.ray.intersectTriangle(pc,mc,To,!1,bo),a===null))return;let l=t.ray.origin.distanceTo(bo);l<t.near||l>t.far||e.push({distance:l,point:bo.clone(),uv:kn.getInterpolation(bo,pc,To,mc,pm,df,mm,new rt),face:null,object:this})}copy(t,e){return super.copy(t,e),t.center!==void 0&&this.center.copy(t.center),this.material=t.material,this}};function gc(s,t,e,n,i,r){cr.subVectors(s,e).addScalar(.5).multiply(n),i!==void 0?(Eo.x=r*cr.x-i*cr.y,Eo.y=i*cr.x+r*cr.y):Eo.copy(cr),s.copy(t),s.x+=Eo.x,s.y+=Eo.y,s.applyMatrix4(hg)}var xc=new P,gm=new P,Ko=class extends ae{constructor(){super(),this.isLOD=!0,this._currentLevel=0,this.type="LOD",Object.defineProperties(this,{levels:{enumerable:!0,value:[]}}),this.autoUpdate=!0}copy(t){super.copy(t,!1);let e=t.levels;for(let n=0,i=e.length;n<i;n++){let r=e[n];this.addLevel(r.object.clone(),r.distance,r.hysteresis)}return this.autoUpdate=t.autoUpdate,this}addLevel(t,e=0,n=0){e=Math.abs(e);let i=this.levels,r;for(r=0;r<i.length&&!(e<i[r].distance);r++);return i.splice(r,0,{distance:e,hysteresis:n,object:t}),this.add(t),this}removeLevel(t){let e=this.levels;for(let n=0;n<e.length;n++)if(e[n].distance===t){let i=e.splice(n,1);return this.remove(i[0].object),!0}return!1}getCurrentLevel(){return this._currentLevel}getObjectForDistance(t){let e=this.levels;if(e.length>0){let n,i;for(n=1,i=e.length;n<i;n++){let r=e[n].distance;if(e[n].object.visible&&(r-=r*e[n].hysteresis),t<r)break}return e[n-1].object}return null}raycast(t,e){if(this.levels.length>0){xc.setFromMatrixPosition(this.matrixWorld);let i=t.ray.origin.distanceTo(xc);this.getObjectForDistance(i).raycast(t,e)}}update(t){let e=this.levels;if(e.length>1){xc.setFromMatrixPosition(t.matrixWorld),gm.setFromMatrixPosition(this.matrixWorld);let n=xc.distanceTo(gm)/t.zoom;e[0].object.visible=!0;let i,r;for(i=1,r=e.length;i<r;i++){let o=e[i].distance;if(e[i].object.visible&&(o-=o*e[i].hysteresis),n>=o)e[i-1].object.visible=!1,e[i].object.visible=!0;else break}for(this._currentLevel=i-1;i<r;i++)e[i].object.visible=!1}}toJSON(t){let e=super.toJSON(t);e.object.autoUpdate=this.autoUpdate,e.object.levels=[];let n=this.levels;for(let i=0,r=n.length;i<r;i++){let o=n[i];e.object.levels.push({object:o.object.uuid,distance:o.distance,hysteresis:o.hysteresis})}return e}},xi=new P,pf=new P,_c=new P,yc=new P,Si=class{constructor(t=new P,e=new P(0,0,-1)){this.origin=t,this.direction=e}set(t,e){return this.origin.copy(t),this.direction.copy(e),this}copy(t){return this.origin.copy(t.origin),this.direction.copy(t.direction),this}at(t,e){return e.copy(this.origin).addScaledVector(this.direction,t)}lookAt(t){return this.direction.copy(t).sub(this.origin).normalize(),this}recast(t){return this.origin.copy(this.at(t,xi)),this}closestPointToPoint(t,e){e.subVectors(t,this.origin);let n=e.dot(this.direction);return n<0?e.copy(this.origin):e.copy(this.origin).addScaledVector(this.direction,n)}distanceToPoint(t){return Math.sqrt(this.distanceSqToPoint(t))}distanceSqToPoint(t){let e=xi.subVectors(t,this.origin).dot(this.direction);return e<0?this.origin.distanceToSquared(t):(xi.copy(this.origin).addScaledVector(this.direction,e),xi.distanceToSquared(t))}distanceSqToSegment(t,e,n,i){pf.copy(t).add(e).multiplyScalar(.5),_c.copy(e).sub(t).normalize(),yc.copy(this.origin).sub(pf);let r=t.distanceTo(e)*.5,o=-this.direction.dot(_c),a=yc.dot(this.direction),l=-yc.dot(_c),c=yc.lengthSq(),h=Math.abs(1-o*o),f,u,d,p;if(h>0)if(f=o*l-a,u=o*a-l,p=r*h,f>=0)if(u>=-p)if(u<=p){let x=1/h;f*=x,u*=x,d=f*(f+o*u+2*a)+u*(o*f+u+2*l)+c}else u=r,f=Math.max(0,-(o*u+a)),d=-f*f+u*(u+2*l)+c;else u=-r,f=Math.max(0,-(o*u+a)),d=-f*f+u*(u+2*l)+c;else u<=-p?(f=Math.max(0,-(-o*r+a)),u=f>0?-r:Math.min(Math.max(-r,-l),r),d=-f*f+u*(u+2*l)+c):u<=p?(f=0,u=Math.min(Math.max(-r,-l),r),d=u*(u+2*l)+c):(f=Math.max(0,-(o*r+a)),u=f>0?r:Math.min(Math.max(-r,-l),r),d=-f*f+u*(u+2*l)+c);else u=o>0?-r:r,f=Math.max(0,-(o*u+a)),d=-f*f+u*(u+2*l)+c;return n&&n.copy(this.origin).addScaledVector(this.direction,f),i&&i.copy(pf).addScaledVector(_c,u),d}intersectSphere(t,e){if(t.radius<0)return null;xi.subVectors(t.center,this.origin);let n=xi.dot(this.direction),i=xi.dot(xi)-n*n,r=t.radius*t.radius;if(i>r)return null;let o=Math.sqrt(r-i),a=n-o,l=n+o;return l<0?null:a<0?this.at(l,e):this.at(a,e)}intersectsSphere(t){return t.radius<0?!1:this.distanceSqToPoint(t.center)<=t.radius*t.radius}distanceToPlane(t){let e=t.normal.dot(this.direction);if(e===0)return t.distanceToPoint(this.origin)===0?0:null;let n=-(this.origin.dot(t.normal)+t.constant)/e;return n>=0?n:null}intersectPlane(t,e){let n=this.distanceToPlane(t);return n===null?null:this.at(n,e)}intersectsPlane(t){let e=t.distanceToPoint(this.origin);return e===0||t.normal.dot(this.direction)*e<0}intersectBox(t,e){let n,i,r,o,a,l,c=1/this.direction.x,h=1/this.direction.y,f=1/this.direction.z,u=this.origin;return c>=0?(n=(t.min.x-u.x)*c,i=(t.max.x-u.x)*c):(n=(t.max.x-u.x)*c,i=(t.min.x-u.x)*c),h>=0?(r=(t.min.y-u.y)*h,o=(t.max.y-u.y)*h):(r=(t.max.y-u.y)*h,o=(t.min.y-u.y)*h),n>o||r>i||((r>n||isNaN(n))&&(n=r),(o<i||isNaN(i))&&(i=o),f>=0?(a=(t.min.z-u.z)*f,l=(t.max.z-u.z)*f):(a=(t.max.z-u.z)*f,l=(t.min.z-u.z)*f),n>l||a>i)||((a>n||n!==n)&&(n=a),(l<i||i!==i)&&(i=l),i<0)?null:this.at(n>=0?n:i,e)}intersectsBox(t){return this.intersectBox(t,xi)!==null}intersectTriangle(t,e,n,i,r){let o=this.origin,a=this.direction,l=a.x,c=a.y,h=a.z,f=t.x-o.x,u=t.y-o.y,d=t.z-o.z,p=e.x-o.x,x=e.y-o.y,m=e.z-o.z,g=n.x-o.x,v=n.y-o.y,b=n.z-o.z,y=Math.abs(l),M=Math.abs(c),S=Math.abs(h),w,_,T,R,L,D,F,C,N,z,O,H;if(y>=M&&y>=S?(T=l,D=f,N=p,H=g,l>=0?(w=c,_=h,R=u,L=d,F=x,C=m,z=v,O=b):(w=h,_=c,R=d,L=u,F=m,C=x,z=b,O=v)):M>=S?(T=c,D=u,N=x,H=v,c>=0?(w=h,_=l,R=d,L=f,F=m,C=p,z=b,O=g):(w=l,_=h,R=f,L=d,F=p,C=m,z=g,O=b)):(T=h,D=d,N=m,H=b,h>=0?(w=l,_=c,R=f,L=u,F=p,C=x,z=g,O=v):(w=c,_=l,R=u,L=f,F=x,C=p,z=v,O=g)),T===0)return null;let U=w/T,W=_/T,Z=1/T,j=R-U*D,q=L-W*D,it=F-U*N,ft=C-W*N,ht=z-U*H,G=O-W*H,Q=ht*ft-G*it,lt=j*G-q*ht,yt=it*q-ft*j;if(i){if(Q<0||lt<0||yt<0)return null}else if((Q<0||lt<0||yt<0)&&(Q>0||lt>0||yt>0))return null;let dt=Q+lt+yt;if(dt===0)return null;let xt=Z*(Q*D+lt*N+yt*H);return(dt>0?xt<0:xt>0)?null:this.at(xt/dt,r)}applyMatrix4(t){return this.origin.applyMatrix4(t),this.direction.transformDirection(t),this}equals(t){return t.origin.equals(this.origin)&&t.direction.equals(this.direction)}clone(){return new this.constructor().copy(this)}},sn=class extends Ge{constructor(t){super(),this.isMeshBasicMaterial=!0,this.type="MeshBasicMaterial",this.color=new _t(16777215),this.map=null,this.lightMap=null,this.lightMapIntensity=1,this.aoMap=null,this.aoMapIntensity=1,this.specularMap=null,this.alphaMap=null,this.envMap=null,this.envMapRotation=new Pn,this.combine=Kr,this.reflectivity=1,this.refractionRatio=.98,this.wireframe=!1,this.wireframeLinewidth=1,this.wireframeLinecap="round",this.wireframeLinejoin="round",this.fog=!0,this.setValues(t)}copy(t){return super.copy(t),this.color.copy(t.color),this.map=t.map,this.lightMap=t.lightMap,this.lightMapIntensity=t.lightMapIntensity,this.aoMap=t.aoMap,this.aoMapIntensity=t.aoMapIntensity,this.specularMap=t.specularMap,this.alphaMap=t.alphaMap,this.envMap=t.envMap,this.envMapRotation.copy(t.envMapRotation),this.combine=t.combine,this.reflectivity=t.reflectivity,this.refractionRatio=t.refractionRatio,this.wireframe=t.wireframe,this.wireframeLinewidth=t.wireframeLinewidth,this.wireframeLinecap=t.wireframeLinecap,this.wireframeLinejoin=t.wireframeLinejoin,this.fog=t.fog,this}},xm=new Jt,ls=new Si,vc=new ke,_m=new P,Mc=new P,Sc=new P,bc=new P,mf=new P,Ec=new P,ym=new P,Tc=new P,ce=class extends ae{constructor(t=new qt,e=new sn){super(),this.isMesh=!0,this.type="Mesh",this.geometry=t,this.material=e,this.morphTargetDictionary=void 0,this.morphTargetInfluences=void 0,this.count=1,this.updateMorphTargets()}copy(t,e){return super.copy(t,e),t.morphTargetInfluences!==void 0&&(this.morphTargetInfluences=t.morphTargetInfluences.slice()),t.morphTargetDictionary!==void 0&&(this.morphTargetDictionary=Object.assign({},t.morphTargetDictionary)),this.material=Array.isArray(t.material)?t.material.slice():t.material,this.geometry=t.geometry,this}updateMorphTargets(){let e=this.geometry.morphAttributes,n=Object.keys(e);if(n.length>0){let i=e[n[0]];if(i!==void 0){this.morphTargetInfluences=[],this.morphTargetDictionary={};for(let r=0,o=i.length;r<o;r++){let a=i[r].name||String(r);this.morphTargetInfluences.push(0),this.morphTargetDictionary[a]=r}}}}getVertexPosition(t,e){let n=this.geometry,i=n.attributes.position,r=n.morphAttributes.position,o=n.morphTargetsRelative;e.fromBufferAttribute(i,t);let a=this.morphTargetInfluences;if(r&&a){Ec.set(0,0,0);for(let l=0,c=r.length;l<c;l++){let h=a[l],f=r[l];h!==0&&(mf.fromBufferAttribute(f,t),o?Ec.addScaledVector(mf,h):Ec.addScaledVector(mf.sub(e),h))}e.add(Ec)}return e}intersectsFrustum(t){return t.intersectsObject(this)}raycast(t,e){let n=this.geometry,i=this.material,r=this.matrixWorld;i!==void 0&&(n.boundingSphere===null&&n.computeBoundingSphere(),vc.copy(n.boundingSphere),vc.applyMatrix4(r),ls.copy(t.ray).recast(t.near),!(vc.containsPoint(ls.origin)===!1&&(ls.intersectSphere(vc,_m)===null||ls.origin.distanceToSquared(_m)>(t.far-t.near)**2))&&(xm.copy(r).invert(),ls.copy(t.ray).applyMatrix4(xm),!(n.boundingBox!==null&&ls.intersectsBox(n.boundingBox)===!1)&&this._computeIntersections(t,e,ls)))}_computeIntersections(t,e,n){let i,r=this.geometry,o=this.material,a=r.index,l=r.attributes.position,c=r.attributes.uv,h=r.attributes.uv1,f=r.attributes.normal,u=r.groups,d=r.drawRange;if(a!==null)if(Array.isArray(o))for(let p=0,x=u.length;p<x;p++){let m=u[p],g=o[m.materialIndex],v=Math.max(m.start,d.start),b=Math.min(a.count,Math.min(m.start+m.count,d.start+d.count));for(let y=v,M=b;y<M;y+=3){let S=a.getX(y),w=a.getX(y+1),_=a.getX(y+2);i=wc(this,g,t,n,c,h,f,S,w,_),i&&(i.faceIndex=Math.floor(y/3),i.face.materialIndex=m.materialIndex,e.push(i))}}else{let p=Math.max(0,d.start),x=Math.min(a.count,d.start+d.count);for(let m=p,g=x;m<g;m+=3){let v=a.getX(m),b=a.getX(m+1),y=a.getX(m+2);i=wc(this,o,t,n,c,h,f,v,b,y),i&&(i.faceIndex=Math.floor(m/3),e.push(i))}}else if(l!==void 0)if(Array.isArray(o))for(let p=0,x=u.length;p<x;p++){let m=u[p],g=o[m.materialIndex],v=Math.max(m.start,d.start),b=Math.min(l.count,Math.min(m.start+m.count,d.start+d.count));for(let y=v,M=b;y<M;y+=3){let S=y,w=y+1,_=y+2;i=wc(this,g,t,n,c,h,f,S,w,_),i&&(i.faceIndex=Math.floor(y/3),i.face.materialIndex=m.materialIndex,e.push(i))}}else{let p=Math.max(0,d.start),x=Math.min(l.count,d.start+d.count);for(let m=p,g=x;m<g;m+=3){let v=m,b=m+1,y=m+2;i=wc(this,o,t,n,c,h,f,v,b,y),i&&(i.faceIndex=Math.floor(m/3),e.push(i))}}}};function C_(s,t,e,n,i,r,o,a){let l;if(t.side===rn?l=n.intersectTriangle(o,r,i,!0,a):l=n.intersectTriangle(i,r,o,t.side===Ri,a),l===null)return null;Tc.copy(a),Tc.applyMatrix4(s.matrixWorld);let c=e.ray.origin.distanceTo(Tc);return c<e.near||c>e.far?null:{distance:c,point:Tc.clone(),object:s}}function wc(s,t,e,n,i,r,o,a,l,c){s.getVertexPosition(a,Mc),s.getVertexPosition(l,Sc),s.getVertexPosition(c,bc);let h=C_(s,t,e,n,Mc,Sc,bc,ym);if(h){let f=new P;kn.getBarycoord(ym,Mc,Sc,bc,f),i&&(h.uv=kn.getInterpolatedAttribute(i,a,l,c,f,new rt)),r&&(h.uv1=kn.getInterpolatedAttribute(r,a,l,c,f,new rt)),o&&(h.normal=kn.getInterpolatedAttribute(o,a,l,c,f,new P),h.normal.dot(n.direction)>0&&h.normal.multiplyScalar(-1));let u={a,b:l,c,normal:new P,materialIndex:0};kn.getNormal(Mc,Sc,bc,u.normal),h.face=u,h.barycoord=f}return h}var wo=new ge,vm=new ge,Mm=new ge,I_=new ge,Sm=new Jt,Ac=new P,gf=new ke,bm=new Jt,xf=new Si,Qo=class extends ce{constructor(t,e){super(t,e),this.isSkinnedMesh=!0,this.type="SkinnedMesh",this.bindMode=$c,this.bindMatrix=new Jt,this.bindMatrixInverse=new Jt,this.boundingBox=null,this.boundingSphere=null}computeBoundingBox(){let t=this.geometry;this.boundingBox===null&&(this.boundingBox=new Ae),this.boundingBox.makeEmpty();let e=t.getAttribute("position");for(let n=0;n<e.count;n++)this.getVertexPosition(n,Ac),this.boundingBox.expandByPoint(Ac)}computeBoundingSphere(){let t=this.geometry;this.boundingSphere===null&&(this.boundingSphere=new ke),this.boundingSphere.makeEmpty();let e=t.getAttribute("position");for(let n=0;n<e.count;n++)this.getVertexPosition(n,Ac),this.boundingSphere.expandByPoint(Ac)}copy(t,e){return super.copy(t,e),this.bindMode=t.bindMode,this.bindMatrix.copy(t.bindMatrix),this.bindMatrixInverse.copy(t.bindMatrixInverse),this.skeleton=t.skeleton,t.boundingBox!==null&&(this.boundingBox=t.boundingBox.clone()),t.boundingSphere!==null&&(this.boundingSphere=t.boundingSphere.clone()),this}raycast(t,e){let n=this.material,i=this.matrixWorld;n!==void 0&&(this.boundingSphere===null&&this.computeBoundingSphere(),gf.copy(this.boundingSphere),gf.applyMatrix4(i),t.ray.intersectsSphere(gf)!==!1&&(bm.copy(i).invert(),xf.copy(t.ray).applyMatrix4(bm),!(this.boundingBox!==null&&xf.intersectsBox(this.boundingBox)===!1)&&this._computeIntersections(t,e,xf)))}getVertexPosition(t,e){return super.getVertexPosition(t,e),this.applyBoneTransform(t,e),e}bind(t,e){this.skeleton=t,e===void 0&&(this.updateMatrixWorld(!0),this.skeleton.calculateInverses(),e=this.matrixWorld),this.bindMatrix.copy(e),this.bindMatrixInverse.copy(e).invert()}pose(){this.skeleton.pose()}normalizeSkinWeights(){let t=new ge,e=this.geometry.attributes.skinWeight;for(let n=0,i=e.count;n<i;n++){t.fromBufferAttribute(e,n);let r=1/t.manhattanLength();r!==1/0?t.multiplyScalar(r):t.set(1,0,0,0),e.setXYZW(n,t.x,t.y,t.z,t.w)}}updateMatrixWorld(t){super.updateMatrixWorld(t),this.bindMode===$c?this.bindMatrixInverse.copy(this.matrixWorld).invert():this.bindMode===dd?this.bindMatrixInverse.copy(this.bindMatrix).invert():St("SkinnedMesh: Unrecognized bindMode: "+this.bindMode)}applyBoneTransform(t,e){let n=this.skeleton,i=this.geometry;vm.fromBufferAttribute(i.attributes.skinIndex,t),Mm.fromBufferAttribute(i.attributes.skinWeight,t),e.isVector4?(wo.copy(e),e.set(0,0,0,0)):(wo.set(...e,1),e.set(0,0,0)),wo.applyMatrix4(this.bindMatrix);for(let r=0;r<4;r++){let o=Mm.getComponent(r);if(o!==0){let a=vm.getComponent(r);Sm.multiplyMatrices(n.bones[a].matrixWorld,n.boneInverses[a]),e.addScaledVector(I_.copy(wo).applyMatrix4(Sm),o)}}return e.isVector4&&(e.w=wo.w),e.applyMatrix4(this.bindMatrixInverse)}},Rr=class extends ae{constructor(){super(),this.isBone=!0,this.type="Bone"}},hn=class extends Pe{constructor(t=null,e=1,n=1,i,r,o,a,l,c=Ie,h=Ie,f,u){super(null,o,a,l,c,h,i,r,f,u),this.isDataTexture=!0,this.image={data:t,width:e,height:n},this.generateMipmaps=!1,this.flipY=!1,this.unpackAlignment=1}},Em=new Jt,P_=new Jt,jo=class s{constructor(t=[],e=[]){this.uuid=Sn(),this.bones=t.slice(0),this.boneInverses=e,this.boneMatrices=null,this.boneTexture=null,this.init()}init(){let t=this.bones,e=this.boneInverses;if(this.boneMatrices=new Float32Array(t.length*16),e.length===0)this.calculateInverses();else if(t.length!==e.length){St("Skeleton: Number of inverse bone matrices does not match amount of bones."),this.boneInverses=[];for(let n=0,i=this.bones.length;n<i;n++)this.boneInverses.push(new Jt)}}calculateInverses(){this.boneInverses.length=0;for(let t=0,e=this.bones.length;t<e;t++){let n=new Jt;this.bones[t]&&n.copy(this.bones[t].matrixWorld).invert(),this.boneInverses.push(n)}}pose(){for(let t=0,e=this.bones.length;t<e;t++){let n=this.bones[t];n&&n.matrixWorld.copy(this.boneInverses[t]).invert()}for(let t=0,e=this.bones.length;t<e;t++){let n=this.bones[t];n&&(n.parent&&n.parent.isBone?(n.matrix.copy(n.parent.matrixWorld).invert(),n.matrix.multiply(n.matrixWorld)):n.matrix.copy(n.matrixWorld),n.matrix.decompose(n.position,n.quaternion,n.scale))}}update(){let t=this.bones,e=this.boneInverses,n=this.boneMatrices,i=this.boneTexture;for(let r=0,o=t.length;r<o;r++){let a=t[r]?t[r].matrixWorld:P_;Em.multiplyMatrices(a,e[r]),Em.toArray(n,r*16)}i!==null&&(i.needsUpdate=!0)}clone(){return new s(this.bones,this.boneInverses)}computeBoneTexture(){let t=Math.sqrt(this.bones.length*4);t=Math.ceil(t/4)*4,t=Math.max(t,4);let e=new Float32Array(t*t*4);e.set(this.boneMatrices);let n=new hn(e,t,t,nn,en);return n.needsUpdate=!0,this.boneMatrices=e,this.boneTexture=n,this}getBoneByName(t){for(let e=0,n=this.bones.length;e<n;e++){let i=this.bones[e];if(i.name===t)return i}}dispose(){this.boneTexture!==null&&(this.boneTexture.dispose(),this.boneTexture=null)}fromJSON(t,e){this.uuid=t.uuid;for(let n=0,i=t.bones.length;n<i;n++){let r=t.bones[n],o=e[r];o===void 0&&(St("Skeleton: No bone found with UUID:",r),o=new Rr),this.bones.push(o),this.boneInverses.push(new Jt().fromArray(t.boneInverses[n]))}return this.init(),this}toJSON(){let t={metadata:{version:4.7,type:"Skeleton",generator:"Skeleton.toJSON"},bones:[],boneInverses:[]};t.uuid=this.uuid;let e=this.bones,n=this.boneInverses;for(let i=0,r=e.length;i<r;i++){let o=e[i];t.bones.push(o.uuid);let a=n[i];t.boneInverses.push(a.toArray())}return t}},ei=class extends Qt{constructor(t,e,n,i=1){super(t,e,n),this.isInstancedBufferAttribute=!0,this.meshPerAttribute=i}copy(t){return super.copy(t),this.meshPerAttribute=t.meshPerAttribute,this}toJSON(){let t=super.toJSON();return t.meshPerAttribute=this.meshPerAttribute,t.isInstancedBufferAttribute=!0,t}},hr=new Jt,Tm=new Jt,Rc=[],wm=new Ae,L_=new Jt,Ao=new ce,Ro=new ke,Hn=class extends ce{constructor(t,e,n){super(t,e),this.isInstancedMesh=!0,this.instanceMatrix=new ei(new Float32Array(n*16),16),this.instanceColor=null,this.morphTexture=null,this.count=n,this.boundingBox=null,this.boundingSphere=null;for(let i=0;i<n;i++)this.setMatrixAt(i,L_)}computeBoundingBox(){let t=this.geometry,e=this.count;this.boundingBox===null&&(this.boundingBox=new Ae),t.boundingBox===null&&t.computeBoundingBox(),this.boundingBox.makeEmpty();for(let n=0;n<e;n++)this.getMatrixAt(n,hr),wm.copy(t.boundingBox).applyMatrix4(hr),this.boundingBox.union(wm)}computeBoundingSphere(){let t=this.geometry,e=this.count;this.boundingSphere===null&&(this.boundingSphere=new ke),t.boundingSphere===null&&t.computeBoundingSphere(),this.boundingSphere.makeEmpty();for(let n=0;n<e;n++)this.getMatrixAt(n,hr),Ro.copy(t.boundingSphere).applyMatrix4(hr),this.boundingSphere.union(Ro)}copy(t,e){return super.copy(t,e),this.instanceMatrix.copy(t.instanceMatrix),t.morphTexture!==null&&(this.morphTexture=t.morphTexture.clone()),t.instanceColor!==null&&(this.instanceColor=t.instanceColor.clone()),this.count=t.count,t.boundingBox!==null&&(this.boundingBox=t.boundingBox.clone()),t.boundingSphere!==null&&(this.boundingSphere=t.boundingSphere.clone()),this}getColorAt(t,e){return this.instanceColor===null?e.setRGB(1,1,1):e.fromArray(this.instanceColor.array,t*3)}getMatrixAt(t,e){return e.fromArray(this.instanceMatrix.array,t*16)}getMorphAt(t,e){let n=e.morphTargetInfluences,i=this.morphTexture.source.data.data,r=n.length+1,o=t*r+1;for(let a=0;a<n.length;a++)n[a]=i[o+a]}raycast(t,e){let n=this.matrixWorld,i=this.count;if(Ao.geometry=this.geometry,Ao.material=this.material,Ao.material!==void 0&&(this.boundingSphere===null&&this.computeBoundingSphere(),Ro.copy(this.boundingSphere),Ro.applyMatrix4(n),t.ray.intersectsSphere(Ro)!==!1))for(let r=0;r<i;r++){this.getMatrixAt(r,hr),Tm.multiplyMatrices(n,hr),Ao.matrixWorld=Tm,Ao.raycast(t,Rc);for(let o=0,a=Rc.length;o<a;o++){let l=Rc[o];l.instanceId=r,l.object=this,e.push(l)}Rc.length=0}}setColorAt(t,e){return this.instanceColor===null&&(this.instanceColor=new ei(new Float32Array(this.instanceMatrix.count*3).fill(1),3)),e.toArray(this.instanceColor.array,t*3),this}setMatrixAt(t,e){return e.toArray(this.instanceMatrix.array,t*16),this}setMorphAt(t,e){let n=e.morphTargetInfluences,i=n.length+1;this.morphTexture===null&&(this.morphTexture=new hn(new Float32Array(i*this.count),i,this.count,al,en));let r=this.morphTexture.source.data.data,o=0;for(let c=0;c<n.length;c++)o+=n[c];let a=this.geometry.morphTargetsRelative?1:1-o,l=i*t;return r[l]=a,r.set(n,l+1),this}updateMorphTargets(){}dispose(){super.dispose(),this.morphTexture!==null&&(this.morphTexture.dispose(),this.morphTexture=null)}},cs=new ke,D_=new rt(.5,.5),Cc=new P,ni=class{constructor(t=new Rn,e=new Rn,n=new Rn,i=new Rn,r=new Rn,o=new Rn){this.planes=[t,e,n,i,r,o]}set(t,e,n,i,r,o){let a=this.planes;return a[0].copy(t),a[1].copy(e),a[2].copy(n),a[3].copy(i),a[4].copy(r),a[5].copy(o),this}copy(t){let e=this.planes;for(let n=0;n<6;n++)e[n].copy(t.planes[n]);return this}setFromProjectionMatrix(t,e=xn,n=!1){let i=this.planes,r=t.elements,o=r[0],a=r[1],l=r[2],c=r[3],h=r[4],f=r[5],u=r[6],d=r[7],p=r[8],x=r[9],m=r[10],g=r[11],v=r[12],b=r[13],y=r[14],M=r[15];if(i[0].setComponents(c-o,d-h,g-p,M-v).normalize(),i[1].setComponents(c+o,d+h,g+p,M+v).normalize(),i[2].setComponents(c+a,d+f,g+x,M+b).normalize(),i[3].setComponents(c-a,d-f,g-x,M-b).normalize(),n)i[4].setComponents(l,u,m,y).normalize(),i[5].setComponents(c-l,d-u,g-m,M-y).normalize();else if(i[4].setComponents(c-l,d-u,g-m,M-y).normalize(),e===xn)i[5].setComponents(c+l,d+u,g+m,M+y).normalize();else if(e===qi)i[5].setComponents(l,u,m,y).normalize();else throw new Error("THREE.Frustum.setFromProjectionMatrix(): Invalid coordinate system: "+e);return this}intersectsObject(t){if(t.boundingSphere!==void 0)t.boundingSphere===null&&t.computeBoundingSphere(),cs.copy(t.boundingSphere).applyMatrix4(t.matrixWorld);else{let e=t.geometry;e.boundingSphere===null&&e.computeBoundingSphere(),cs.copy(e.boundingSphere).applyMatrix4(t.matrixWorld)}return this.intersectsSphere(cs)}intersectsSprite(t){cs.center.set(0,0,0);let e=D_.distanceTo(t.center);return cs.radius=.7071067811865476+e,cs.applyMatrix4(t.matrixWorld),this.intersectsSphere(cs)}intersectsSphere(t){let e=this.planes,n=t.center,i=-t.radius;for(let r=0;r<6;r++)if(e[r].distanceToPoint(n)<i)return!1;return!0}intersectsBox(t){let e=this.planes;for(let n=0;n<6;n++){let i=e[n];if(Cc.x=i.normal.x>0?t.max.x:t.min.x,Cc.y=i.normal.y>0?t.max.y:t.min.y,Cc.z=i.normal.z>0?t.max.z:t.min.z,i.distanceToPoint(Cc)<0)return!1}return!0}containsPoint(t){let e=this.planes;for(let n=0;n<6;n++)if(e[n].distanceToPoint(t)<0)return!1;return!0}clone(){return new this.constructor().copy(this)}},Am=new Jt,ta=class s{constructor(){this.coordinateSystem=xn,this._frustums=[],this._count=0}setFromArrayCamera(t){let e=t.cameras,n=this._frustums;for(let i=0;i<e.length;i++){let r=e[i];Am.multiplyMatrices(r.projectionMatrix,r.matrixWorldInverse),n[i]===void 0&&(n[i]=new ni),n[i].setFromProjectionMatrix(Am,r.coordinateSystem,r.reversedDepth)}return this._count=e.length,this}intersectsObject(t){let e=this._frustums;for(let n=0;n<this._count;n++)if(e[n].intersectsObject(t))return!0;return!1}intersectsSprite(t){let e=this._frustums;for(let n=0;n<this._count;n++)if(e[n].intersectsSprite(t))return!0;return!1}intersectsSphere(t){let e=this._frustums;for(let n=0;n<this._count;n++)if(e[n].intersectsSphere(t))return!0;return!1}intersectsBox(t){let e=this._frustums;for(let n=0;n<this._count;n++)if(e[n].intersectsBox(t))return!0;return!1}containsPoint(t){let e=this._frustums;for(let n=0;n<this._count;n++)if(e[n].containsPoint(t))return!0;return!1}copy(t){this.coordinateSystem=t.coordinateSystem;let e=this._frustums,n=t._frustums;for(let i=0;i<t._count;i++)e[i]===void 0&&(e[i]=new ni),e[i].copy(n[i]);return this._count=t._count,this}clone(){return new s().copy(this)}};function _f(s,t){return s-t}function N_(s,t){return s.z-t.z}function U_(s,t){return t.z-s.z}var Lf=class{constructor(){this.index=0,this.pool=[],this.list=[]}push(t,e,n,i){let r=this.pool,o=this.list;this.index>=r.length&&r.push({start:-1,count:-1,z:-1,index:-1});let a=r[this.index];o.push(a),this.index++,a.start=t,a.count=e,a.z=n,a.index=i}reset(){this.list.length=0,this.index=0}},mn=new Jt,F_=new _t(1,1,1),O_=new ni,B_=new ta,Ic=new Ae,hs=new ke,Co=new P,Rm=new P,z_=new P,yf=new Lf,tn=new ce,Pc=[];function k_(s,t,e=0){let n=t.itemSize;if(s.isInterleavedBufferAttribute||s.array.constructor!==t.array.constructor){let i=s.count;for(let r=0;r<i;r++)for(let o=0;o<n;o++)t.setComponent(r+e,o,s.getComponent(r,o))}else t.array.set(s.array,e*n);t.needsUpdate=!0}function us(s,t){if(s.constructor!==t.constructor){let e=Math.min(s.length,t.length);for(let n=0;n<e;n++)t[n]=s[n]}else{let e=Math.min(s.length,t.length);t.set(new s.constructor(s.buffer,0,e))}}var ea=class extends ce{constructor(t,e,n=e*2,i){super(new qt,i),this.isBatchedMesh=!0,this.perObjectFrustumCulled=!0,this.sortObjects=!0,this.boundingBox=null,this.boundingSphere=null,this.customSort=null,this._instanceInfo=[],this._geometryInfo=[],this._availableInstanceIds=[],this._availableGeometryIds=[],this._nextIndexStart=0,this._nextVertexStart=0,this._geometryCount=0,this._visibilityChanged=!0,this._geometryInitialized=!1,this._maxInstanceCount=t,this._maxVertexCount=e,this._maxIndexCount=n,this._multiDrawCounts=new Int32Array(t),this._multiDrawStarts=new Int32Array(t),this._multiDrawCount=0,this._multiDrawBytesPerElement=1,this._matricesTexture=null,this._indirectTexture=null,this._colorsTexture=null,this._initMatricesTexture(),this._initIndirectTexture()}get maxInstanceCount(){return this._maxInstanceCount}get instanceCount(){return this._instanceInfo.length-this._availableInstanceIds.length}get unusedVertexCount(){return this._maxVertexCount-this._nextVertexStart}get unusedIndexCount(){return this._maxIndexCount-this._nextIndexStart}_initMatricesTexture(){let t=Math.sqrt(this._maxInstanceCount*4);t=Math.ceil(t/4)*4,t=Math.max(t,4);let e=new Float32Array(t*t*4),n=new hn(e,t,t,nn,en);this._matricesTexture=n}_initIndirectTexture(){let t=Math.sqrt(this._maxInstanceCount);t=Math.ceil(t);let e=new Uint32Array(t*t),n=new hn(e,t,t,eo,En);this._indirectTexture=n}_initColorsTexture(){let t=Math.sqrt(this._maxInstanceCount);t=Math.ceil(t);let e=new Float32Array(t*t*4).fill(1),n=new hn(e,t,t,nn,en);n.colorSpace=re.workingColorSpace,this._colorsTexture=n}_initializeGeometry(t){let e=this.geometry,n=this._maxVertexCount,i=this._maxIndexCount;if(this._geometryInitialized===!1){for(let r in t.attributes){let o=t.getAttribute(r),{array:a,itemSize:l,normalized:c}=o,h=new a.constructor(n*l),f=new Qt(h,l,c);e.setAttribute(r,f)}if(t.getIndex()!==null){let r=n>65535?new Uint32Array(i):new Uint16Array(i);e.setIndex(new Qt(r,1))}this._geometryInitialized=!0}}_validateGeometry(t){let e=this.geometry;if(!!t.getIndex()!=!!e.getIndex())throw new Error('THREE.BatchedMesh: All geometries must consistently have "index".');for(let n in e.attributes){if(!t.hasAttribute(n))throw new Error(`THREE.BatchedMesh: Added geometry missing "${n}". All geometries must have consistent attributes.`);let i=t.getAttribute(n),r=e.getAttribute(n);if(i.itemSize!==r.itemSize||i.normalized!==r.normalized)throw new Error("THREE.BatchedMesh: All attributes must have a consistent itemSize and normalized value.")}}validateInstanceId(t){let e=this._instanceInfo;if(t<0||t>=e.length||e[t].active===!1)throw new Error(`THREE.BatchedMesh: Invalid instanceId ${t}. Instance is either out of range or has been deleted.`)}validateGeometryId(t){let e=this._geometryInfo;if(t<0||t>=e.length||e[t].active===!1)throw new Error(`THREE.BatchedMesh: Invalid geometryId ${t}. Geometry is either out of range or has been deleted.`)}setCustomSort(t){return this.customSort=t,this}computeBoundingBox(){this.boundingBox===null&&(this.boundingBox=new Ae);let t=this.boundingBox,e=this._instanceInfo;t.makeEmpty();for(let n=0,i=e.length;n<i;n++){if(e[n].active===!1)continue;let r=e[n].geometryIndex;this.getMatrixAt(n,mn),this.getBoundingBoxAt(r,Ic).applyMatrix4(mn),t.union(Ic)}}computeBoundingSphere(){this.boundingSphere===null&&(this.boundingSphere=new ke);let t=this.boundingSphere,e=this._instanceInfo;t.makeEmpty();for(let n=0,i=e.length;n<i;n++){if(e[n].active===!1)continue;let r=e[n].geometryIndex;this.getMatrixAt(n,mn),this.getBoundingSphereAt(r,hs).applyMatrix4(mn),t.union(hs)}}addInstance(t){if(this._instanceInfo.length>=this.maxInstanceCount&&this._availableInstanceIds.length===0)throw new Error("THREE.BatchedMesh: Maximum item count reached.");let n={visible:!0,active:!0,geometryIndex:t},i=null;this._availableInstanceIds.length>0?(this._availableInstanceIds.sort(_f),i=this._availableInstanceIds.shift(),this._instanceInfo[i]=n):(i=this._instanceInfo.length,this._instanceInfo.push(n));let r=this._matricesTexture;mn.identity().toArray(r.image.data,i*16),r.needsUpdate=!0;let o=this._colorsTexture;return o&&(F_.toArray(o.image.data,i*4),o.needsUpdate=!0),this._visibilityChanged=!0,i}addGeometry(t,e=-1,n=-1){this._initializeGeometry(t),this._validateGeometry(t);let i={vertexStart:-1,vertexCount:-1,reservedVertexCount:-1,indexStart:-1,indexCount:-1,reservedIndexCount:-1,start:-1,count:-1,boundingBox:null,boundingSphere:null,active:!0},r=this._geometryInfo;i.vertexStart=this._nextVertexStart,i.reservedVertexCount=e===-1?t.getAttribute("position").count:e;let o=t.getIndex();if(o!==null&&(i.indexStart=this._nextIndexStart,i.reservedIndexCount=n===-1?o.count:n),i.indexStart!==-1&&i.indexStart+i.reservedIndexCount>this._maxIndexCount||i.vertexStart+i.reservedVertexCount>this._maxVertexCount)throw new Error("THREE.BatchedMesh: Reserved space request exceeds the maximum buffer size.");let l;return this._availableGeometryIds.length>0?(this._availableGeometryIds.sort(_f),l=this._availableGeometryIds.shift(),r[l]=i):(l=this._geometryCount,this._geometryCount++,r.push(i)),this.setGeometryAt(l,t),this._nextIndexStart=i.indexStart+i.reservedIndexCount,this._nextVertexStart=i.vertexStart+i.reservedVertexCount,l}setGeometryAt(t,e){if(t>=this._geometryCount)throw new Error("THREE.BatchedMesh: Maximum geometry count reached.");this._validateGeometry(e);let n=this.geometry,i=n.getIndex()!==null,r=n.getIndex(),o=e.getIndex(),a=this._geometryInfo[t];if(i&&o.count>a.reservedIndexCount||e.attributes.position.count>a.reservedVertexCount)throw new Error("THREE.BatchedMesh: Reserved space not large enough for provided geometry.");let l=a.vertexStart,c=a.reservedVertexCount;a.vertexCount=e.getAttribute("position").count;for(let h in n.attributes){let f=e.getAttribute(h),u=n.getAttribute(h);k_(f,u,l);let d=f.itemSize;for(let p=f.count,x=c;p<x;p++){let m=l+p;for(let g=0;g<d;g++)u.setComponent(m,g,0)}u.needsUpdate=!0,u.addUpdateRange(l*d,c*d)}if(i){let h=a.indexStart,f=a.reservedIndexCount;a.indexCount=e.getIndex().count;for(let u=0;u<o.count;u++)r.setX(h+u,l+o.getX(u));for(let u=o.count,d=f;u<d;u++)r.setX(h+u,l);r.needsUpdate=!0,r.addUpdateRange(h,a.reservedIndexCount)}return a.start=i?a.indexStart:a.vertexStart,a.count=i?a.indexCount:a.vertexCount,a.boundingBox=null,e.boundingBox!==null&&(a.boundingBox=e.boundingBox.clone()),a.boundingSphere=null,e.boundingSphere!==null&&(a.boundingSphere=e.boundingSphere.clone()),this._visibilityChanged=!0,t}deleteGeometry(t){let e=this._geometryInfo;if(t>=e.length||e[t].active===!1)return this;let n=this._instanceInfo;for(let i=0,r=n.length;i<r;i++)n[i].active&&n[i].geometryIndex===t&&this.deleteInstance(i);return e[t].active=!1,this._availableGeometryIds.push(t),this._visibilityChanged=!0,this}deleteInstance(t){return this.validateInstanceId(t),this._instanceInfo[t].active=!1,this._availableInstanceIds.push(t),this._visibilityChanged=!0,this}optimize(){let t=0,e=0,n=this._geometryInfo,i=n.map((o,a)=>a).sort((o,a)=>n[o].vertexStart-n[a].vertexStart),r=this.geometry;for(let o=0,a=n.length;o<a;o++){let l=i[o],c=n[l];if(c.active!==!1){if(r.index!==null){if(c.indexStart!==e){let{indexStart:h,vertexStart:f,reservedIndexCount:u}=c,d=r.index,p=d.array,x=t-f;for(let m=h;m<h+u;m++)p[m]=p[m]+x;d.array.copyWithin(e,h,h+u),d.addUpdateRange(e,u),d.needsUpdate=!0,c.indexStart=e}e+=c.reservedIndexCount}if(c.vertexStart!==t){let{vertexStart:h,reservedVertexCount:f}=c,u=r.attributes;for(let d in u){let p=u[d],{array:x,itemSize:m}=p;x.copyWithin(t*m,h*m,(h+f)*m),p.addUpdateRange(t*m,f*m),p.needsUpdate=!0}c.vertexStart=t}t+=c.reservedVertexCount,c.start=r.index?c.indexStart:c.vertexStart}}return this._nextIndexStart=e,this._nextVertexStart=t,this._visibilityChanged=!0,this}getBoundingBoxAt(t,e){if(t>=this._geometryCount)return null;let n=this.geometry,i=this._geometryInfo[t];if(i.boundingBox===null){let r=new Ae,o=n.index,a=n.attributes.position;for(let l=i.start,c=i.start+i.count;l<c;l++){let h=l;o&&(h=o.getX(h)),r.expandByPoint(Co.fromBufferAttribute(a,h))}i.boundingBox=r}return e.copy(i.boundingBox),e}getBoundingSphereAt(t,e){if(t>=this._geometryCount)return null;let n=this.geometry,i=this._geometryInfo[t];if(i.boundingSphere===null){let r=new ke;this.getBoundingBoxAt(t,Ic),Ic.getCenter(r.center);let o=n.index,a=n.attributes.position,l=0;for(let c=i.start,h=i.start+i.count;c<h;c++){let f=c;o&&(f=o.getX(f)),Co.fromBufferAttribute(a,f),l=Math.max(l,r.center.distanceToSquared(Co))}r.radius=Math.sqrt(l),i.boundingSphere=r}return e.copy(i.boundingSphere),e}setMatrixAt(t,e){this.validateInstanceId(t);let n=this._matricesTexture,i=this._matricesTexture.image.data;return e.toArray(i,t*16),n.needsUpdate=!0,this}getMatrixAt(t,e){return this.validateInstanceId(t),e.fromArray(this._matricesTexture.image.data,t*16)}setColorAt(t,e){return this.validateInstanceId(t),this._colorsTexture===null&&this._initColorsTexture(),e.toArray(this._colorsTexture.image.data,t*4),this._colorsTexture.needsUpdate=!0,this}getColorAt(t,e){return this.validateInstanceId(t),this._colorsTexture===null?e.isVector4?e.set(1,1,1,1):e.setRGB(1,1,1):e.fromArray(this._colorsTexture.image.data,t*4)}setVisibleAt(t,e){return this.validateInstanceId(t),this._instanceInfo[t].visible===e?this:(this._instanceInfo[t].visible=e,this._visibilityChanged=!0,this)}getVisibleAt(t){return this.validateInstanceId(t),this._instanceInfo[t].visible}setGeometryIdAt(t,e){return this.validateInstanceId(t),this.validateGeometryId(e),this._instanceInfo[t].geometryIndex=e,this._visibilityChanged=!0,this}getGeometryIdAt(t){return this.validateInstanceId(t),this._instanceInfo[t].geometryIndex}getGeometryRangeAt(t,e={}){this.validateGeometryId(t);let n=this._geometryInfo[t];return e.vertexStart=n.vertexStart,e.vertexCount=n.vertexCount,e.reservedVertexCount=n.reservedVertexCount,e.indexStart=n.indexStart,e.indexCount=n.indexCount,e.reservedIndexCount=n.reservedIndexCount,e.start=n.start,e.count=n.count,e}setInstanceCount(t){let e=this._availableInstanceIds,n=this._instanceInfo;for(e.sort(_f);e[e.length-1]===n.length-1;)n.pop(),e.pop();if(t<n.length)throw new Error(`THREE.BatchedMesh: Instance ids outside the range ${t} are being used. Cannot shrink instance count.`);let i=new Int32Array(t),r=new Int32Array(t);us(this._multiDrawCounts,i),us(this._multiDrawStarts,r),this._multiDrawCounts=i,this._multiDrawStarts=r,this._maxInstanceCount=t;let o=this._indirectTexture,a=this._matricesTexture,l=this._colorsTexture;o.dispose(),this._initIndirectTexture(),us(o.image.data,this._indirectTexture.image.data),a.dispose(),this._initMatricesTexture(),us(a.image.data,this._matricesTexture.image.data),l&&(l.dispose(),this._initColorsTexture(),us(l.image.data,this._colorsTexture.image.data))}setGeometrySize(t,e){let n=[...this._geometryInfo].filter(a=>a.active);if(Math.max(...n.map(a=>a.vertexStart+a.reservedVertexCount))>t)throw new Error(`THREE.BatchedMesh: Geometry vertex values are being used outside the range ${e}. Cannot shrink further.`);if(this.geometry.index&&Math.max(...n.map(l=>l.indexStart+l.reservedIndexCount))>e)throw new Error(`THREE.BatchedMesh: Geometry index values are being used outside the range ${e}. Cannot shrink further.`);let r=this.geometry;r.dispose(),this._maxVertexCount=t,this._maxIndexCount=e,this._geometryInitialized&&(this._geometryInitialized=!1,this.geometry=new qt,this._initializeGeometry(r));let o=this.geometry;r.index&&us(r.index.array,o.index.array);for(let a in r.attributes)us(r.attributes[a].array,o.attributes[a].array)}raycast(t,e){let n=this._instanceInfo,i=this._geometryInfo,r=this.matrixWorld,o=this.geometry;tn.material=this.material,tn.geometry.index=o.index,tn.geometry.attributes=o.attributes,tn.geometry.boundingBox===null&&(tn.geometry.boundingBox=new Ae),tn.geometry.boundingSphere===null&&(tn.geometry.boundingSphere=new ke);for(let a=0,l=n.length;a<l;a++){if(!n[a].visible||!n[a].active)continue;let c=n[a].geometryIndex,h=i[c];tn.geometry.setDrawRange(h.start,h.count),this.getMatrixAt(a,tn.matrixWorld).premultiply(r),this.getBoundingBoxAt(c,tn.geometry.boundingBox),this.getBoundingSphereAt(c,tn.geometry.boundingSphere),tn.raycast(t,Pc);for(let f=0,u=Pc.length;f<u;f++){let d=Pc[f];d.object=this,d.batchId=a,e.push(d)}Pc.length=0}tn.material=null,tn.geometry.index=null,tn.geometry.attributes={},tn.geometry.setDrawRange(0,1/0)}copy(t){return super.copy(t),this.geometry=t.geometry.clone(),this.perObjectFrustumCulled=t.perObjectFrustumCulled,this.sortObjects=t.sortObjects,this.boundingBox=t.boundingBox!==null?t.boundingBox.clone():null,this.boundingSphere=t.boundingSphere!==null?t.boundingSphere.clone():null,this._geometryInfo=t._geometryInfo.map(e=>({...e,boundingBox:e.boundingBox!==null?e.boundingBox.clone():null,boundingSphere:e.boundingSphere!==null?e.boundingSphere.clone():null})),this._instanceInfo=t._instanceInfo.map(e=>({...e})),this._availableInstanceIds=t._availableInstanceIds.slice(),this._availableGeometryIds=t._availableGeometryIds.slice(),this._nextIndexStart=t._nextIndexStart,this._nextVertexStart=t._nextVertexStart,this._geometryCount=t._geometryCount,this._maxInstanceCount=t._maxInstanceCount,this._maxVertexCount=t._maxVertexCount,this._maxIndexCount=t._maxIndexCount,this._geometryInitialized=t._geometryInitialized,this._multiDrawCounts=t._multiDrawCounts.slice(),this._multiDrawStarts=t._multiDrawStarts.slice(),this._multiDrawBytesPerElement=t._multiDrawBytesPerElement,this._indirectTexture=t._indirectTexture.clone(),this._indirectTexture.image.data=this._indirectTexture.image.data.slice(),this._matricesTexture=t._matricesTexture.clone(),this._matricesTexture.image.data=this._matricesTexture.image.data.slice(),this._colorsTexture!==null&&(this._colorsTexture=t._colorsTexture.clone(),this._colorsTexture.image.data=this._colorsTexture.image.data.slice()),this}dispose(){super.dispose(),this.geometry.dispose(),this._matricesTexture.dispose(),this._matricesTexture=null,this._indirectTexture.dispose(),this._indirectTexture=null,this._colorsTexture!==null&&(this._colorsTexture.dispose(),this._colorsTexture=null)}onBeforeRender(t,e,n,i,r){if(!this._visibilityChanged&&!this.perObjectFrustumCulled&&!this.sortObjects)return;let o=i.getIndex(),a=o===null?1:o.array.BYTES_PER_ELEMENT,l=1;r.wireframe&&(l=2,a=i.attributes.position.count>65535?4:2);let c=this._instanceInfo,h=this._multiDrawStarts,f=this._multiDrawCounts,u=this._geometryInfo,d=this.perObjectFrustumCulled,p=this._indirectTexture,x=p.image.data,m=n.isArrayCamera?B_:O_;d&&(n.isArrayCamera?m.setFromArrayCamera(n):(mn.multiplyMatrices(n.projectionMatrix,n.matrixWorldInverse).multiply(this.matrixWorld),m.setFromProjectionMatrix(mn,n.coordinateSystem,n.reversedDepth)));let g=0;if(this.sortObjects){mn.copy(this.matrixWorld).invert(),Co.setFromMatrixPosition(n.matrixWorld).applyMatrix4(mn),Rm.set(0,0,-1).transformDirection(n.matrixWorld).transformDirection(mn);for(let y=0,M=c.length;y<M;y++)if(c[y].visible&&c[y].active){let S=c[y].geometryIndex;this.getMatrixAt(y,mn),this.getBoundingSphereAt(S,hs).applyMatrix4(mn);let w=!1;if(d&&(w=!m.intersectsSphere(hs)),!w){let _=u[S],T=z_.subVectors(hs.center,Co).dot(Rm);yf.push(_.start,_.count,T,y)}}let v=yf.list,b=this.customSort;b===null?v.sort(r.transparent?U_:N_):b.call(this,v,n);for(let y=0,M=v.length;y<M;y++){let S=v[y];h[g]=S.start*a*l,f[g]=S.count*l,x[g]=S.index,g++}yf.reset()}else for(let v=0,b=c.length;v<b;v++)if(c[v].visible&&c[v].active){let y=c[v].geometryIndex,M=!1;if(d&&(this.getMatrixAt(v,mn),this.getBoundingSphereAt(y,hs).applyMatrix4(mn),M=!m.intersectsSphere(hs)),!M){let S=u[y];h[g]=S.start*a*l,f[g]=S.count*l,x[g]=v,g++}}p.needsUpdate=!0,this._multiDrawCount=g,this._multiDrawBytesPerElement=a,this._visibilityChanged=!1}onBeforeShadow(t,e,n,i,r,o){this.onBeforeRender(t,null,i,r,o)}},Ze=class extends Ge{constructor(t){super(),this.isLineBasicMaterial=!0,this.type="LineBasicMaterial",this.color=new _t(16777215),this.map=null,this.linewidth=1,this.linecap="round",this.linejoin="round",this.fog=!0,this.setValues(t)}copy(t){return super.copy(t),this.color.copy(t.color),this.map=t.map,this.linewidth=t.linewidth,this.linecap=t.linecap,this.linejoin=t.linejoin,this.fog=t.fog,this}},lh=new P,ch=new P,Cm=new Jt,Io=new Si,Lc=new ke,vf=new P,Im=new P,Wn=class extends ae{constructor(t=new qt,e=new Ze){super(),this.isLine=!0,this.type="Line",this.geometry=t,this.material=e,this.morphTargetDictionary=void 0,this.morphTargetInfluences=void 0,this.updateMorphTargets()}copy(t,e){return super.copy(t,e),this.material=Array.isArray(t.material)?t.material.slice():t.material,this.geometry=t.geometry,this}computeLineDistances(){let t=this.geometry;if(t.index===null){let e=t.attributes.position,n=[0];for(let i=1,r=e.count;i<r;i++)lh.fromBufferAttribute(e,i-1),ch.fromBufferAttribute(e,i),n[i]=n[i-1],n[i]+=lh.distanceTo(ch);t.setAttribute("lineDistance",new At(n,1))}else St("Line.computeLineDistances(): Computation only possible with non-indexed BufferGeometry.");return this}intersectsFrustum(t){return t.intersectsObject(this)}raycast(t,e){let n=this.geometry,i=this.matrixWorld,r=t.params.Line.threshold,o=n.drawRange;if(n.boundingSphere===null&&n.computeBoundingSphere(),Lc.copy(n.boundingSphere),Lc.applyMatrix4(i),Lc.radius+=r,t.ray.intersectsSphere(Lc)===!1)return;Cm.copy(i).invert(),Io.copy(t.ray).applyMatrix4(Cm);let a=r/((this.scale.x+this.scale.y+this.scale.z)/3),l=a*a,c=this.isLineSegments?2:1,h=n.index,u=n.attributes.position;if(h!==null){let d=Math.max(0,o.start),p=Math.min(h.count,o.start+o.count);for(let x=d,m=p-1;x<m;x+=c){let g=h.getX(x),v=h.getX(x+1),b=Dc(this,t,Io,l,g,v,x);b&&e.push(b)}if(this.isLineLoop){let x=h.getX(p-1),m=h.getX(d),g=Dc(this,t,Io,l,x,m,p-1);g&&e.push(g)}}else{let d=Math.max(0,o.start),p=Math.min(u.count,o.start+o.count);for(let x=d,m=p-1;x<m;x+=c){let g=Dc(this,t,Io,l,x,x+1,x);g&&e.push(g)}if(this.isLineLoop){let x=Dc(this,t,Io,l,p-1,d,p-1);x&&e.push(x)}}}updateMorphTargets(){let e=this.geometry.morphAttributes,n=Object.keys(e);if(n.length>0){let i=e[n[0]];if(i!==void 0){this.morphTargetInfluences=[],this.morphTargetDictionary={};for(let r=0,o=i.length;r<o;r++){let a=i[r].name||String(r);this.morphTargetInfluences.push(0),this.morphTargetDictionary[a]=r}}}}};function Dc(s,t,e,n,i,r,o){let a=s.geometry.attributes.position;if(lh.fromBufferAttribute(a,i),ch.fromBufferAttribute(a,r),e.distanceSqToSegment(lh,ch,vf,Im)>n)return;vf.applyMatrix4(s.matrixWorld);let c=t.ray.origin.distanceTo(vf);if(!(c<t.near||c>t.far))return{distance:c,point:Im.clone().applyMatrix4(s.matrixWorld),index:o,face:null,faceIndex:null,barycoord:null,object:s}}var Pm=new P,Lm=new P,bn=class extends Wn{constructor(t,e){super(t,e),this.isLineSegments=!0,this.type="LineSegments"}computeLineDistances(){let t=this.geometry;if(t.index===null){let e=t.attributes.position,n=[];for(let i=0,r=e.count;i<r;i+=2)Pm.fromBufferAttribute(e,i),Lm.fromBufferAttribute(e,i+1),n[i]=i===0?0:n[i-1],n[i+1]=n[i]+Pm.distanceTo(Lm);t.setAttribute("lineDistance",new At(n,1))}else St("LineSegments.computeLineDistances(): Computation only possible with non-indexed BufferGeometry.");return this}},na=class extends Wn{constructor(t,e){super(t,e),this.isLineLoop=!0,this.type="LineLoop"}},Cr=class extends Ge{constructor(t){super(),this.isPointsMaterial=!0,this.type="PointsMaterial",this.color=new _t(16777215),this.map=null,this.alphaMap=null,this.size=1,this.sizeAttenuation=!0,this.fog=!0,this.setValues(t)}copy(t){return super.copy(t),this.color.copy(t.color),this.map=t.map,this.alphaMap=t.alphaMap,this.size=t.size,this.sizeAttenuation=t.sizeAttenuation,this.fog=t.fog,this}},Dm=new Jt,Df=new Si,Nc=new ke,Uc=new P,ia=class extends ae{constructor(t=new qt,e=new Cr){super(),this.isPoints=!0,this.type="Points",this.geometry=t,this.material=e,this.morphTargetDictionary=void 0,this.morphTargetInfluences=void 0,this.updateMorphTargets()}copy(t,e){return super.copy(t,e),this.material=Array.isArray(t.material)?t.material.slice():t.material,this.geometry=t.geometry,this}intersectsFrustum(t){return t.intersectsObject(this)}raycast(t,e){let n=this.geometry,i=this.matrixWorld,r=t.params.Points.threshold,o=n.drawRange;if(n.boundingSphere===null&&n.computeBoundingSphere(),Nc.copy(n.boundingSphere),Nc.applyMatrix4(i),Nc.radius+=r,t.ray.intersectsSphere(Nc)===!1)return;Dm.copy(i).invert(),Df.copy(t.ray).applyMatrix4(Dm);let a=r/((this.scale.x+this.scale.y+this.scale.z)/3),l=a*a,c=n.index,f=n.attributes.position;if(c!==null){let u=Math.max(0,o.start),d=Math.min(c.count,o.start+o.count);for(let p=u,x=d;p<x;p++){let m=c.getX(p);Uc.fromBufferAttribute(f,m),Nm(Uc,m,l,i,t,e,this)}}else{let u=Math.max(0,o.start),d=Math.min(f.count,o.start+o.count);for(let p=u,x=d;p<x;p++)Uc.fromBufferAttribute(f,p),Nm(Uc,p,l,i,t,e,this)}}updateMorphTargets(){let e=this.geometry.morphAttributes,n=Object.keys(e);if(n.length>0){let i=e[n[0]];if(i!==void 0){this.morphTargetInfluences=[],this.morphTargetDictionary={};for(let r=0,o=i.length;r<o;r++){let a=i[r].name||String(r);this.morphTargetInfluences.push(0),this.morphTargetDictionary[a]=r}}}}};function Nm(s,t,e,n,i,r,o){let a=Df.distanceSqToPoint(s);if(a<e){let l=new P;Df.closestPointToPoint(s,l),l.applyMatrix4(n);let c=i.ray.origin.distanceTo(l);if(c<i.near||c>i.far)return;r.push({distance:c,distanceToRay:Math.sqrt(a),point:l,index:t,face:null,faceIndex:null,barycoord:null,object:o})}}var sa=class extends Pe{constructor(t,e,n,i,r=le,o=le,a,l,c){super(t,e,n,i,r,o,a,l,c),this.isVideoTexture=!0,this.generateMipmaps=!1,this._requestVideoFrameCallbackId=0;let h=this;function f(){h.needsUpdate=!0,h._requestVideoFrameCallbackId=t.requestVideoFrameCallback(f)}"requestVideoFrameCallback"in t&&(this._requestVideoFrameCallbackId=t.requestVideoFrameCallback(f))}clone(){return new this.constructor(this.image).copy(this)}update(){let t=this.image;"requestVideoFrameCallback"in t===!1&&t.readyState>=t.HAVE_CURRENT_DATA&&(this.needsUpdate=!0)}dispose(){this._requestVideoFrameCallbackId!==0&&(this.source.data.cancelVideoFrameCallback(this._requestVideoFrameCallbackId),this._requestVideoFrameCallbackId=0),super.dispose()}},hh=class extends sa{constructor(t,e,n,i,r,o,a,l){super({},t,e,n,i,r,o,a,l),this.isVideoFrameTexture=!0}update(){}clone(){return new this.constructor().copy(this)}setFrame(t){this.image=t,this.needsUpdate=!0}},uh=class extends Pe{constructor(t,e){super({width:t,height:e}),this.isFramebufferTexture=!0,this.magFilter=Ie,this.minFilter=Ie,this.generateMipmaps=!1,this.needsUpdate=!0}},ws=class extends Pe{constructor(t,e,n,i,r,o,a,l,c,h,f,u){super(null,o,a,l,c,h,i,r,f,u),this.isCompressedTexture=!0,this.image={width:e,height:n},this.mipmaps=t,this.flipY=!1,this.generateMipmaps=!1}},fh=class extends ws{constructor(t,e,n,i,r,o){super(t,e,n,r,o),this.isCompressedArrayTexture=!0,this.image.depth=i,this.wrapR=Ce,this.layerUpdates=new Set}copy(t){return super.copy(t),this.wrapR=t.wrapR,this}addLayerUpdate(t){this.layerUpdates.add(t)}clearLayerUpdates(){this.layerUpdates.clear()}},dh=class extends ws{constructor(t,e,n){super(void 0,t[0].width,t[0].height,e,n,Zn),this.isCompressedCubeTexture=!0,this.isCubeTexture=!0,this.image=t}},$i=class extends Pe{constructor(t=[],e=Zn,n,i,r,o,a,l,c,h){super(t,e,n,i,r,o,a,l,c,h),this.isCubeTexture=!0,this.flipY=!1}get images(){return this.image}set images(t){this.image=t}},Xn=class extends Pe{constructor(t,e,n,i,r,o,a,l,c){super(t,e,n,i,r,o,a,l,c),this.isCanvasTexture=!0,this.needsUpdate=!0}},ph=class extends Pe{constructor(t,e,n,i,r,o,a,l,c){super(t,e,n,i,r,o,a,l,c),this.isHTMLTexture=!0,this.generateMipmaps=!1,this.needsUpdate=!0;let h=t?t.parentNode:null;h!==null&&"requestPaint"in h&&(h.onpaint=()=>{this.needsUpdate=!0},h.requestPaint())}dispose(){let t=this.image?this.image.parentNode:null;t!==null&&"onpaint"in t&&(t.onpaint=null),super.dispose()}},bi=class extends Pe{constructor(t,e,n=En,i,r,o,a=Ie,l=Ie,c,h=Vn,f=1){if(h!==Vn&&h!==Ii)throw new Error("THREE.DepthTexture: format must be either THREE.DepthFormat or THREE.DepthStencilFormat");let u={width:t,height:e,depth:f};super(u,i,r,o,a,l,h,n,c),this.isDepthTexture=!0,this.flipY=!1,this.generateMipmaps=!1,this.compareFunction=null}copy(t){return super.copy(t),this.source=new Cn(Object.assign({},t.image)),this.compareFunction=t.compareFunction,this}toJSON(t){let e=super.toJSON(t);return e.compareFunction=this.compareFunction,e}},ra=class extends bi{constructor(t,e=En,n=Zn,i,r,o=Ie,a=Ie,l,c=Vn){let h={width:t,height:t,depth:1},f=[h,h,h,h,h,h];super(t,t,e,n,i,r,o,a,l,c),this.image=f,this.isCubeDepthTexture=!0,this.isCubeTexture=!0}get images(){return this.image}set images(t){this.image=t}},Ir=class extends Pe{constructor(t=null){super(),this.sourceTexture=t,this.isExternalTexture=!0}copy(t){return super.copy(t),this.sourceTexture=t.sourceTexture,this}},ii=class s extends qt{constructor(t=1,e=1,n=1,i=1,r=1,o=1){super(),this.type="BoxGeometry",this.parameters={width:t,height:e,depth:n,widthSegments:i,heightSegments:r,depthSegments:o};let a=this;i=Math.floor(i),r=Math.floor(r),o=Math.floor(o);let l=[],c=[],h=[],f=[],u=0,d=0;p("z","y","x",-1,-1,n,e,t,o,r,0),p("z","y","x",1,-1,n,e,-t,o,r,1),p("x","z","y",1,1,t,n,e,i,o,2),p("x","z","y",1,-1,t,n,-e,i,o,3),p("x","y","z",1,-1,t,e,n,i,r,4),p("x","y","z",-1,-1,t,e,-n,i,r,5),this.setIndex(l),this.setAttribute("position",new At(c,3)),this.setAttribute("normal",new At(h,3)),this.setAttribute("uv",new At(f,2));function p(x,m,g,v,b,y,M,S,w,_,T){let R=y/w,L=M/_,D=y/2,F=M/2,C=S/2,N=w+1,z=_+1,O=0,H=0,U=new P;for(let W=0;W<z;W++){let Z=W*L-F;for(let j=0;j<N;j++){let q=j*R-D;U[x]=q*v,U[m]=Z*b,U[g]=C,c.push(U.x,U.y,U.z),U[x]=0,U[m]=0,U[g]=S>0?1:-1,h.push(U.x,U.y,U.z),f.push(j/w),f.push(1-W/_),O+=1}}for(let W=0;W<_;W++)for(let Z=0;Z<w;Z++){let j=u+Z+N*W,q=u+Z+N*(W+1),it=u+(Z+1)+N*(W+1),ft=u+(Z+1)+N*W;l.push(j,q,ft),l.push(q,it,ft),H+=6}a.addGroup(d,H,T),d+=H,u+=O}}copy(t){return super.copy(t),this.parameters=Object.assign({},t.parameters),this}static fromJSON(t){return new s(t.width,t.height,t.depth,t.widthSegments,t.heightSegments,t.depthSegments)}},oa=class s extends qt{constructor(t=1,e=1,n=4,i=8,r=1){super(),this.type="CapsuleGeometry",this.parameters={radius:t,height:e,capSegments:n,radialSegments:i,heightSegments:r},e=Math.max(0,e),n=Math.max(1,Math.floor(n)),i=Math.max(3,Math.floor(i)),r=Math.max(1,Math.floor(r));let o=[],a=[],l=[],c=[],h=e/2,f=Math.PI/2*t,u=e,d=2*f+u,p=n*2+r,x=i+1,m=new P,g=new P;for(let v=0;v<=p;v++){let b=0,y=0,M=0,S=0;if(v<=n){let T=v/n,R=T*Math.PI/2;y=-h-t*Math.cos(R),M=t*Math.sin(R),S=-t*Math.cos(R),b=T*f}else if(v<=n+r){let T=(v-n)/r;y=-h+T*e,M=t,S=0,b=f+T*u}else{let T=(v-n-r)/n,R=T*Math.PI/2;y=h+t*Math.sin(R),M=t*Math.cos(R),S=t*Math.sin(R),b=f+u+T*f}let w=Math.max(0,Math.min(1,b/d)),_=0;v===0?_=.5/i:v===p&&(_=-.5/i);for(let T=0;T<=i;T++){let R=T/i,L=R*Math.PI*2,D=Math.sin(L),F=Math.cos(L);g.x=-M*F,g.y=y,g.z=M*D,a.push(g.x,g.y,g.z),m.set(-M*F,S,M*D),m.normalize(),l.push(m.x,m.y,m.z),c.push(R+_,w)}if(v>0){let T=(v-1)*x;for(let R=0;R<i;R++){let L=T+R,D=T+R+1,F=v*x+R,C=v*x+R+1;o.push(L,D,F),o.push(D,C,F)}}}this.setIndex(o),this.setAttribute("position",new At(a,3)),this.setAttribute("normal",new At(l,3)),this.setAttribute("uv",new At(c,2))}copy(t){return super.copy(t),this.parameters=Object.assign({},t.parameters),this}static fromJSON(t){return new s(t.radius,t.height,t.capSegments,t.radialSegments,t.heightSegments)}},aa=class s extends qt{constructor(t=1,e=32,n=0,i=Math.PI*2){super(),this.type="CircleGeometry",this.parameters={radius:t,segments:e,thetaStart:n,thetaLength:i},e=Math.max(3,e);let r=[],o=[],a=[],l=[],c=new P,h=new rt;o.push(0,0,0),a.push(0,0,1),l.push(.5,.5);for(let f=0,u=3;f<=e;f++,u+=3){let d=n+f/e*i;c.x=t*Math.cos(d),c.y=t*Math.sin(d),o.push(c.x,c.y,c.z),a.push(0,0,1),h.x=(o[u]/t+1)/2,h.y=(o[u+1]/t+1)/2,l.push(h.x,h.y)}for(let f=1;f<=e;f++)r.push(f,f+1,0);this.setIndex(r),this.setAttribute("position",new At(o,3)),this.setAttribute("normal",new At(a,3)),this.setAttribute("uv",new At(l,2))}copy(t){return super.copy(t),this.parameters=Object.assign({},t.parameters),this}static fromJSON(t){return new s(t.radius,t.segments,t.thetaStart,t.thetaLength)}},Ei=class s extends qt{constructor(t=1,e=1,n=1,i=32,r=1,o=!1,a=0,l=Math.PI*2){super(),this.type="CylinderGeometry",this.parameters={radiusTop:t,radiusBottom:e,height:n,radialSegments:i,heightSegments:r,openEnded:o,thetaStart:a,thetaLength:l};let c=this;i=Math.floor(i),r=Math.floor(r);let h=[],f=[],u=[],d=[],p=0,x=[],m=n/2,g=0;v(),o===!1&&(t>0&&b(!0),e>0&&b(!1)),this.setIndex(h),this.setAttribute("position",new At(f,3)),this.setAttribute("normal",new At(u,3)),this.setAttribute("uv",new At(d,2));function v(){let y=new P,M=new P,S=0,w=(e-t)/n;for(let _=0;_<=r;_++){let T=[],R=_/r,L=R*(e-t)+t;for(let D=0;D<=i;D++){let F=D/i,C=F*l+a,N=Math.sin(C),z=Math.cos(C);M.x=L*N,M.y=-R*n+m,M.z=L*z,f.push(M.x,M.y,M.z),y.set(N,w,z).normalize(),u.push(y.x,y.y,y.z),d.push(F,1-R),T.push(p++)}x.push(T)}for(let _=0;_<i;_++)for(let T=0;T<r;T++){let R=x[T][_],L=x[T+1][_],D=x[T+1][_+1],F=x[T][_+1];(t>0||T!==0)&&(h.push(R,L,F),S+=3),(e>0||T!==r-1)&&(h.push(L,D,F),S+=3)}c.addGroup(g,S,0),g+=S}function b(y){let M=p,S=new rt,w=new P,_=0,T=y===!0?t:e,R=y===!0?1:-1;for(let D=1;D<=i;D++)f.push(0,m*R,0),u.push(0,R,0),d.push(.5,.5),p++;let L=p;for(let D=0;D<=i;D++){let C=D/i*l+a,N=Math.cos(C),z=Math.sin(C);w.x=T*z,w.y=m*R,w.z=T*N,f.push(w.x,w.y,w.z),u.push(0,R,0),S.x=N*.5+.5,S.y=z*.5*R+.5,d.push(S.x,S.y),p++}for(let D=0;D<i;D++){let F=M+D,C=L+D;y===!0?h.push(C,C+1,F):h.push(C+1,C,F),_+=3}c.addGroup(g,_,y===!0?1:2),g+=_}}copy(t){return super.copy(t),this.parameters=Object.assign({},t.parameters),this}static fromJSON(t){return new s(t.radiusTop,t.radiusBottom,t.height,t.radialSegments,t.heightSegments,t.openEnded,t.thetaStart,t.thetaLength)}},Pr=class s extends Ei{constructor(t=1,e=1,n=32,i=1,r=!1,o=0,a=Math.PI*2){super(0,t,e,n,i,r,o,a),this.type="ConeGeometry",this.parameters={radius:t,height:e,radialSegments:n,heightSegments:i,openEnded:r,thetaStart:o,thetaLength:a}}static fromJSON(t){return new s(t.radius,t.height,t.radialSegments,t.heightSegments,t.openEnded,t.thetaStart,t.thetaLength)}},Ti=class s extends qt{constructor(t=[],e=[],n=1,i=0){super(),this.type="PolyhedronGeometry",this.parameters={vertices:t,indices:e,radius:n,detail:i};let r=[],o=[];a(i),c(n),h(),this.setAttribute("position",new At(r,3)),this.setAttribute("normal",new At(r.slice(),3)),this.setAttribute("uv",new At(o,2)),i===0?this.computeVertexNormals():this.normalizeNormals();function a(v){let b=new P,y=new P,M=new P;for(let S=0;S<e.length;S+=3)d(e[S+0],b),d(e[S+1],y),d(e[S+2],M),l(b,y,M,v)}function l(v,b,y,M){let S=M+1,w=[];for(let _=0;_<=S;_++){w[_]=[];let T=v.clone().lerp(y,_/S),R=b.clone().lerp(y,_/S),L=S-_;for(let D=0;D<=L;D++)D===0&&_===S?w[_][D]=T:w[_][D]=T.clone().lerp(R,D/L)}for(let _=0;_<S;_++)for(let T=0;T<2*(S-_)-1;T++){let R=Math.floor(T/2);T%2===0?(u(w[_][R+1]),u(w[_+1][R]),u(w[_][R])):(u(w[_][R+1]),u(w[_+1][R+1]),u(w[_+1][R]))}}function c(v){let b=new P;for(let y=0;y<r.length;y+=3)b.x=r[y+0],b.y=r[y+1],b.z=r[y+2],b.normalize().multiplyScalar(v),r[y+0]=b.x,r[y+1]=b.y,r[y+2]=b.z}function h(){let v=new P;for(let b=0;b<r.length;b+=3){v.x=r[b+0],v.y=r[b+1],v.z=r[b+2];let y=m(v)/2/Math.PI+.5,M=g(v)/Math.PI+.5;o.push(y,1-M)}p(),f()}function f(){for(let v=0;v<o.length;v+=6){let b=o[v+0],y=o[v+2],M=o[v+4],S=Math.max(b,y,M),w=Math.min(b,y,M);S>.9&&w<.1&&(b<.2&&(o[v+0]+=1),y<.2&&(o[v+2]+=1),M<.2&&(o[v+4]+=1))}}function u(v){r.push(v.x,v.y,v.z)}function d(v,b){let y=v*3;b.x=t[y+0],b.y=t[y+1],b.z=t[y+2]}function p(){let v=new P,b=new P,y=new P,M=new P,S=new rt,w=new rt,_=new rt;for(let T=0,R=0;T<r.length;T+=9,R+=6){v.set(r[T+0],r[T+1],r[T+2]),b.set(r[T+3],r[T+4],r[T+5]),y.set(r[T+6],r[T+7],r[T+8]),S.set(o[R+0],o[R+1]),w.set(o[R+2],o[R+3]),_.set(o[R+4],o[R+5]),M.copy(v).add(b).add(y).divideScalar(3);let L=m(M);x(S,R+0,v,L),x(w,R+2,b,L),x(_,R+4,y,L)}}function x(v,b,y,M){M<0&&v.x===1&&(o[b]=v.x-1),y.x===0&&y.z===0&&(o[b]=M/2/Math.PI+.5)}function m(v){return Math.atan2(v.z,-v.x)}function g(v){return Math.atan2(-v.y,Math.sqrt(v.x*v.x+v.z*v.z))}}copy(t){return super.copy(t),this.parameters=Object.assign({},t.parameters),this}static fromJSON(t){return new s(t.vertices,t.indices,t.radius,t.detail)}},la=class s extends Ti{constructor(t=1,e=0){let n=(1+Math.sqrt(5))/2,i=1/n,r=[-1,-1,-1,-1,-1,1,-1,1,-1,-1,1,1,1,-1,-1,1,-1,1,1,1,-1,1,1,1,0,-i,-n,0,-i,n,0,i,-n,0,i,n,-i,-n,0,-i,n,0,i,-n,0,i,n,0,-n,0,-i,n,0,-i,-n,0,i,n,0,i],o=[3,11,7,3,7,15,3,15,13,7,19,17,7,17,6,7,6,15,17,4,8,17,8,10,17,10,6,8,0,16,8,16,2,8,2,10,0,12,1,0,1,18,0,18,16,6,10,2,6,2,13,6,13,15,2,16,18,2,18,3,2,3,13,18,1,9,18,9,11,18,11,3,4,14,12,4,12,0,4,0,8,11,9,5,11,5,19,11,19,7,19,5,14,19,14,4,19,4,17,1,12,14,1,14,5,1,5,9];super(r,o,t,e),this.type="DodecahedronGeometry",this.parameters={radius:t,detail:e}}static fromJSON(t){return new s(t.radius,t.detail)}},Fc=new P,Oc=new P,Mf=new P,Bc=new kn,ca=class extends qt{constructor(t=null,e=1){if(super(),this.type="EdgesGeometry",this.parameters={geometry:t,thresholdAngle:e},t!==null){let i=Math.pow(10,4),r=Math.cos(_s*e),o=t.getIndex(),a=t.getAttribute("position"),l=o?o.count:a.count,c=[0,0,0],h=["a","b","c"],f=new Array(3),u={},d=[];for(let p=0;p<l;p+=3){o?(c[0]=o.getX(p),c[1]=o.getX(p+1),c[2]=o.getX(p+2)):(c[0]=p,c[1]=p+1,c[2]=p+2);let{a:x,b:m,c:g}=Bc;if(x.fromBufferAttribute(a,c[0]),m.fromBufferAttribute(a,c[1]),g.fromBufferAttribute(a,c[2]),Bc.getNormal(Mf),f[0]=`${Math.round(x.x*i)},${Math.round(x.y*i)},${Math.round(x.z*i)}`,f[1]=`${Math.round(m.x*i)},${Math.round(m.y*i)},${Math.round(m.z*i)}`,f[2]=`${Math.round(g.x*i)},${Math.round(g.y*i)},${Math.round(g.z*i)}`,!(f[0]===f[1]||f[1]===f[2]||f[2]===f[0]))for(let v=0;v<3;v++){let b=(v+1)%3,y=f[v],M=f[b],S=Bc[h[v]],w=Bc[h[b]],_=`${y}_${M}`,T=`${M}_${y}`;T in u&&u[T]?(Mf.dot(u[T].normal)<=r&&(d.push(S.x,S.y,S.z),d.push(w.x,w.y,w.z)),u[T]=null):_ in u||(u[_]={index0:c[v],index1:c[b],normal:Mf.clone()})}}for(let p in u)if(u[p]){let{index0:x,index1:m}=u[p];Fc.fromBufferAttribute(a,x),Oc.fromBufferAttribute(a,m),d.push(Fc.x,Fc.y,Fc.z),d.push(Oc.x,Oc.y,Oc.z)}this.setAttribute("position",new At(d,3))}}copy(t){return super.copy(t),this.parameters=Object.assign({},t.parameters),this}},yn=class{constructor(){this.type="Curve",this.arcLengthDivisions=200,this.needsUpdate=!1,this.cacheArcLengths=null}getPoint(){St("Curve: .getPoint() not implemented.")}getPointAt(t,e){let n=this.getUtoTmapping(t);return this.getPoint(n,e)}getPoints(t=5){let e=[];for(let n=0;n<=t;n++)e.push(this.getPoint(n/t));return e}getSpacedPoints(t=5){let e=[];for(let n=0;n<=t;n++)e.push(this.getPointAt(n/t));return e}getLength(){let t=this.getLengths();return t[t.length-1]}getLengths(t=this.arcLengthDivisions){if(this.cacheArcLengths&&this.cacheArcLengths.length===t+1&&!this.needsUpdate)return this.cacheArcLengths;this.needsUpdate=!1;let e=[],n,i=this.getPoint(0),r=0;e.push(0);for(let o=1;o<=t;o++)n=this.getPoint(o/t),r+=n.distanceTo(i),e.push(r),i=n;return this.cacheArcLengths=e,e}updateArcLengths(){this.needsUpdate=!0,this.getLengths()}getUtoTmapping(t,e=null){let n=this.getLengths(),i=0,r=n.length,o;e?o=e:o=t*n[r-1];let a=0,l=r-1,c;for(;a<=l;)if(i=Math.floor(a+(l-a)/2),c=n[i]-o,c<0)a=i+1;else if(c>0)l=i-1;else{l=i;break}if(i=l,n[i]===o)return i/(r-1);let h=n[i],u=n[i+1]-h,d=(o-h)/u;return(i+d)/(r-1)}getTangent(t,e){let i=t-1e-4,r=t+1e-4;i<0&&(i=0),r>1&&(r=1);let o=this.getPoint(i),a=this.getPoint(r),l=e||(o.isVector2?new rt:new P);return l.copy(a).sub(o).normalize(),l}getTangentAt(t,e){let n=this.getUtoTmapping(t);return this.getTangent(n,e)}computeFrenetFrames(t,e=!1){let n=new P,i=[],r=[],o=[],a=new P,l=new Jt;for(let d=0;d<=t;d++){let p=d/t;i[d]=this.getTangentAt(p,new P)}r[0]=new P,o[0]=new P;let c=Number.MAX_VALUE,h=Math.abs(i[0].x),f=Math.abs(i[0].y),u=Math.abs(i[0].z);h<=c&&(c=h,n.set(1,0,0)),f<=c&&(c=f,n.set(0,1,0)),u<=c&&n.set(0,0,1),a.crossVectors(i[0],n).normalize(),r[0].crossVectors(i[0],a),o[0].crossVectors(i[0],r[0]);for(let d=1;d<=t;d++){if(r[d]=r[d-1].clone(),o[d]=o[d-1].clone(),a.crossVectors(i[d-1],i[d]),a.length()>Number.EPSILON){a.normalize();let p=Math.acos($t(i[d-1].dot(i[d]),-1,1));r[d].applyMatrix4(l.makeRotationAxis(a,p))}o[d].crossVectors(i[d],r[d])}if(e===!0){let d=Math.acos($t(r[0].dot(r[t]),-1,1));d/=t,i[0].dot(a.crossVectors(r[0],r[t]))>0&&(d=-d);for(let p=1;p<=t;p++)r[p].applyMatrix4(l.makeRotationAxis(i[p],d*p)),o[p].crossVectors(i[p],r[p])}return{tangents:i,normals:r,binormals:o}}clone(){return new this.constructor().copy(this)}copy(t){return this.arcLengthDivisions=t.arcLengthDivisions,this}toJSON(){let t={metadata:{version:4.7,type:"Curve",generator:"Curve.toJSON"}};return t.arcLengthDivisions=this.arcLengthDivisions,t.type=this.type,t}fromJSON(t){return this.arcLengthDivisions=t.arcLengthDivisions,this}},As=class extends yn{constructor(t=0,e=0,n=1,i=1,r=0,o=Math.PI*2,a=!1,l=0){super(),this.isEllipseCurve=!0,this.type="EllipseCurve",this.aX=t,this.aY=e,this.xRadius=n,this.yRadius=i,this.aStartAngle=r,this.aEndAngle=o,this.aClockwise=a,this.aRotation=l}getPoint(t,e=new rt){let n=e,i=Math.PI*2,r=this.aEndAngle-this.aStartAngle,o=Math.abs(r)<Number.EPSILON;for(;r<0;)r+=i;for(;r>i;)r-=i;r<Number.EPSILON&&(o?r=0:r=i),this.aClockwise===!0&&!o&&(r===i?r=-i:r=r-i);let a=this.aStartAngle+t*r,l=this.aX+this.xRadius*Math.cos(a),c=this.aY+this.yRadius*Math.sin(a);if(this.aRotation!==0){let h=Math.cos(this.aRotation),f=Math.sin(this.aRotation),u=l-this.aX,d=c-this.aY;l=u*h-d*f+this.aX,c=u*f+d*h+this.aY}return n.set(l,c)}copy(t){return super.copy(t),this.aX=t.aX,this.aY=t.aY,this.xRadius=t.xRadius,this.yRadius=t.yRadius,this.aStartAngle=t.aStartAngle,this.aEndAngle=t.aEndAngle,this.aClockwise=t.aClockwise,this.aRotation=t.aRotation,this}toJSON(){let t=super.toJSON();return t.aX=this.aX,t.aY=this.aY,t.xRadius=this.xRadius,t.yRadius=this.yRadius,t.aStartAngle=this.aStartAngle,t.aEndAngle=this.aEndAngle,t.aClockwise=this.aClockwise,t.aRotation=this.aRotation,t}fromJSON(t){return super.fromJSON(t),this.aX=t.aX,this.aY=t.aY,this.xRadius=t.xRadius,this.yRadius=t.yRadius,this.aStartAngle=t.aStartAngle,this.aEndAngle=t.aEndAngle,this.aClockwise=t.aClockwise,this.aRotation=t.aRotation,this}},ha=class extends As{constructor(t,e,n,i,r,o){super(t,e,n,n,i,r,o),this.isArcCurve=!0,this.type="ArcCurve"}};function Pd(){let s=0,t=0,e=0,n=0;function i(r,o,a,l){s=r,t=a,e=-3*r+3*o-2*a-l,n=2*r-2*o+a+l}return{initCatmullRom:function(r,o,a,l,c){i(o,a,c*(a-r),c*(l-o))},initNonuniformCatmullRom:function(r,o,a,l,c,h,f){let u=(o-r)/c-(a-r)/(c+h)+(a-o)/h,d=(a-o)/h-(l-o)/(h+f)+(l-a)/f;u*=h,d*=h,i(o,a,u,d)},calc:function(r){let o=r*r,a=o*r;return s+t*r+e*o+n*a}}}var Um=new P,Fm=new P,Sf=new Pd,bf=new Pd,Ef=new Pd,ua=class extends yn{constructor(t=[],e=!1,n="centripetal",i=.5){super(),this.isCatmullRomCurve3=!0,this.type="CatmullRomCurve3",this.points=t,this.closed=e,this.curveType=n,this.tension=i}getPoint(t,e=new P){let n=e,i=this.points,r=i.length,o=(r-(this.closed?0:1))*t,a=Math.floor(o),l=o-a;this.closed?a+=a>0?0:(Math.floor(Math.abs(a)/r)+1)*r:l===0&&a===r-1&&(a=r-2,l=1);let c,h;this.closed||a>0?c=i[(a-1)%r]:(Fm.subVectors(i[0],i[1]).add(i[0]),c=Fm);let f=i[a%r],u=i[(a+1)%r];if(this.closed||a+2<r?h=i[(a+2)%r]:(Um.subVectors(i[r-1],i[r-2]).add(i[r-1]),h=Um),this.curveType==="centripetal"||this.curveType==="chordal"){let d=this.curveType==="chordal"?.5:.25,p=Math.pow(c.distanceToSquared(f),d),x=Math.pow(f.distanceToSquared(u),d),m=Math.pow(u.distanceToSquared(h),d);x<1e-4&&(x=1),p<1e-4&&(p=x),m<1e-4&&(m=x),Sf.initNonuniformCatmullRom(c.x,f.x,u.x,h.x,p,x,m),bf.initNonuniformCatmullRom(c.y,f.y,u.y,h.y,p,x,m),Ef.initNonuniformCatmullRom(c.z,f.z,u.z,h.z,p,x,m)}else this.curveType==="catmullrom"&&(Sf.initCatmullRom(c.x,f.x,u.x,h.x,this.tension),bf.initCatmullRom(c.y,f.y,u.y,h.y,this.tension),Ef.initCatmullRom(c.z,f.z,u.z,h.z,this.tension));return n.set(Sf.calc(l),bf.calc(l),Ef.calc(l)),n}copy(t){super.copy(t),this.points=[];for(let e=0,n=t.points.length;e<n;e++){let i=t.points[e];this.points.push(i.clone())}return this.closed=t.closed,this.curveType=t.curveType,this.tension=t.tension,this}toJSON(){let t=super.toJSON();t.points=[];for(let e=0,n=this.points.length;e<n;e++){let i=this.points[e];t.points.push(i.toArray())}return t.closed=this.closed,t.curveType=this.curveType,t.tension=this.tension,t}fromJSON(t){super.fromJSON(t),this.points=[];for(let e=0,n=t.points.length;e<n;e++){let i=t.points[e];this.points.push(new P().fromArray(i))}return this.closed=t.closed,this.curveType=t.curveType,this.tension=t.tension,this}};function Om(s,t,e,n,i){let r=(n-t)*.5,o=(i-e)*.5,a=s*s,l=s*a;return(2*e-2*n+r+o)*l+(-3*e+3*n-2*r-o)*a+r*s+e}function G_(s,t){let e=1-s;return e*e*t}function V_(s,t){return 2*(1-s)*s*t}function H_(s,t){return s*s*t}function Fo(s,t,e,n){return G_(s,t)+V_(s,e)+H_(s,n)}function W_(s,t){let e=1-s;return e*e*e*t}function X_(s,t){let e=1-s;return 3*e*e*s*t}function q_(s,t){return 3*(1-s)*s*s*t}function Y_(s,t){return s*s*s*t}function Oo(s,t,e,n,i){return W_(s,t)+X_(s,e)+q_(s,n)+Y_(s,i)}var Lr=class extends yn{constructor(t=new rt,e=new rt,n=new rt,i=new rt){super(),this.isCubicBezierCurve=!0,this.type="CubicBezierCurve",this.v0=t,this.v1=e,this.v2=n,this.v3=i}getPoint(t,e=new rt){let n=e,i=this.v0,r=this.v1,o=this.v2,a=this.v3;return n.set(Oo(t,i.x,r.x,o.x,a.x),Oo(t,i.y,r.y,o.y,a.y)),n}copy(t){return super.copy(t),this.v0.copy(t.v0),this.v1.copy(t.v1),this.v2.copy(t.v2),this.v3.copy(t.v3),this}toJSON(){let t=super.toJSON();return t.v0=this.v0.toArray(),t.v1=this.v1.toArray(),t.v2=this.v2.toArray(),t.v3=this.v3.toArray(),t}fromJSON(t){return super.fromJSON(t),this.v0.fromArray(t.v0),this.v1.fromArray(t.v1),this.v2.fromArray(t.v2),this.v3.fromArray(t.v3),this}},fa=class extends yn{constructor(t=new P,e=new P,n=new P,i=new P){super(),this.isCubicBezierCurve3=!0,this.type="CubicBezierCurve3",this.v0=t,this.v1=e,this.v2=n,this.v3=i}getPoint(t,e=new P){let n=e,i=this.v0,r=this.v1,o=this.v2,a=this.v3;return n.set(Oo(t,i.x,r.x,o.x,a.x),Oo(t,i.y,r.y,o.y,a.y),Oo(t,i.z,r.z,o.z,a.z)),n}copy(t){return super.copy(t),this.v0.copy(t.v0),this.v1.copy(t.v1),this.v2.copy(t.v2),this.v3.copy(t.v3),this}toJSON(){let t=super.toJSON();return t.v0=this.v0.toArray(),t.v1=this.v1.toArray(),t.v2=this.v2.toArray(),t.v3=this.v3.toArray(),t}fromJSON(t){return super.fromJSON(t),this.v0.fromArray(t.v0),this.v1.fromArray(t.v1),this.v2.fromArray(t.v2),this.v3.fromArray(t.v3),this}},Dr=class extends yn{constructor(t=new rt,e=new rt){super(),this.isLineCurve=!0,this.type="LineCurve",this.v1=t,this.v2=e}getPoint(t,e=new rt){let n=e;return t===1?n.copy(this.v2):(n.copy(this.v2).sub(this.v1),n.multiplyScalar(t).add(this.v1)),n}getPointAt(t,e){return this.getPoint(t,e)}getTangent(t,e=new rt){return e.subVectors(this.v2,this.v1).normalize()}getTangentAt(t,e){return this.getTangent(t,e)}copy(t){return super.copy(t),this.v1.copy(t.v1),this.v2.copy(t.v2),this}toJSON(){let t=super.toJSON();return t.v1=this.v1.toArray(),t.v2=this.v2.toArray(),t}fromJSON(t){return super.fromJSON(t),this.v1.fromArray(t.v1),this.v2.fromArray(t.v2),this}},da=class extends yn{constructor(t=new P,e=new P){super(),this.isLineCurve3=!0,this.type="LineCurve3",this.v1=t,this.v2=e}getPoint(t,e=new P){let n=e;return t===1?n.copy(this.v2):(n.copy(this.v2).sub(this.v1),n.multiplyScalar(t).add(this.v1)),n}getPointAt(t,e){return this.getPoint(t,e)}getTangent(t,e=new P){return e.subVectors(this.v2,this.v1).normalize()}getTangentAt(t,e){return this.getTangent(t,e)}copy(t){return super.copy(t),this.v1.copy(t.v1),this.v2.copy(t.v2),this}toJSON(){let t=super.toJSON();return t.v1=this.v1.toArray(),t.v2=this.v2.toArray(),t}fromJSON(t){return super.fromJSON(t),this.v1.fromArray(t.v1),this.v2.fromArray(t.v2),this}},Nr=class extends yn{constructor(t=new rt,e=new rt,n=new rt){super(),this.isQuadraticBezierCurve=!0,this.type="QuadraticBezierCurve",this.v0=t,this.v1=e,this.v2=n}getPoint(t,e=new rt){let n=e,i=this.v0,r=this.v1,o=this.v2;return n.set(Fo(t,i.x,r.x,o.x),Fo(t,i.y,r.y,o.y)),n}copy(t){return super.copy(t),this.v0.copy(t.v0),this.v1.copy(t.v1),this.v2.copy(t.v2),this}toJSON(){let t=super.toJSON();return t.v0=this.v0.toArray(),t.v1=this.v1.toArray(),t.v2=this.v2.toArray(),t}fromJSON(t){return super.fromJSON(t),this.v0.fromArray(t.v0),this.v1.fromArray(t.v1),this.v2.fromArray(t.v2),this}},Ur=class extends yn{constructor(t=new P,e=new P,n=new P){super(),this.isQuadraticBezierCurve3=!0,this.type="QuadraticBezierCurve3",this.v0=t,this.v1=e,this.v2=n}getPoint(t,e=new P){let n=e,i=this.v0,r=this.v1,o=this.v2;return n.set(Fo(t,i.x,r.x,o.x),Fo(t,i.y,r.y,o.y),Fo(t,i.z,r.z,o.z)),n}copy(t){return super.copy(t),this.v0.copy(t.v0),this.v1.copy(t.v1),this.v2.copy(t.v2),this}toJSON(){let t=super.toJSON();return t.v0=this.v0.toArray(),t.v1=this.v1.toArray(),t.v2=this.v2.toArray(),t}fromJSON(t){return super.fromJSON(t),this.v0.fromArray(t.v0),this.v1.fromArray(t.v1),this.v2.fromArray(t.v2),this}},Fr=class extends yn{constructor(t=[]){super(),this.isSplineCurve=!0,this.type="SplineCurve",this.points=t}getPoint(t,e=new rt){let n=e,i=this.points,r=(i.length-1)*t,o=Math.floor(r),a=r-o,l=i[o===0?o:o-1],c=i[o],h=i[o>i.length-2?i.length-1:o+1],f=i[o>i.length-3?i.length-1:o+2];return n.set(Om(a,l.x,c.x,h.x,f.x),Om(a,l.y,c.y,h.y,f.y)),n}copy(t){super.copy(t),this.points=[];for(let e=0,n=t.points.length;e<n;e++){let i=t.points[e];this.points.push(i.clone())}return this}toJSON(){let t=super.toJSON();t.points=[];for(let e=0,n=this.points.length;e<n;e++){let i=this.points[e];t.points.push(i.toArray())}return t}fromJSON(t){super.fromJSON(t),this.points=[];for(let e=0,n=t.points.length;e<n;e++){let i=t.points[e];this.points.push(new rt().fromArray(i))}return this}},mh=Object.freeze({__proto__:null,ArcCurve:ha,CatmullRomCurve3:ua,CubicBezierCurve:Lr,CubicBezierCurve3:fa,EllipseCurve:As,LineCurve:Dr,LineCurve3:da,QuadraticBezierCurve:Nr,QuadraticBezierCurve3:Ur,SplineCurve:Fr}),pa=class extends yn{constructor(){super(),this.type="CurvePath",this.curves=[],this.autoClose=!1}add(t){this.curves.push(t)}closePath(){let t=this.curves[0].getPoint(0),e=this.curves[this.curves.length-1].getPoint(1);if(!t.equals(e)){let n=t.isVector2===!0?"LineCurve":"LineCurve3";this.curves.push(new mh[n](e,t))}return this}getPoint(t,e){let n=t*this.getLength(),i=this.getCurveLengths(),r=0;for(;r<i.length;){if(i[r]>=n){let o=i[r]-n,a=this.curves[r],l=a.getLength(),c=l===0?0:1-o/l;return a.getPointAt(c,e)}r++}return null}getLength(){let t=this.getCurveLengths();return t[t.length-1]}updateArcLengths(){this.needsUpdate=!0,this.cacheLengths=null,this.getCurveLengths()}getCurveLengths(){if(this.cacheLengths&&this.cacheLengths.length===this.curves.length)return this.cacheLengths;let t=[],e=0;for(let n=0,i=this.curves.length;n<i;n++)e+=this.curves[n].getLength(),t.push(e);return this.cacheLengths=t,t}getSpacedPoints(t=40){let e=[];for(let n=0;n<=t;n++)e.push(this.getPoint(n/t));return this.autoClose&&e.push(e[0]),e}getPoints(t=12){let e=[],n;for(let i=0,r=this.curves;i<r.length;i++){let o=r[i],a=o.isEllipseCurve?t*2:o.isLineCurve||o.isLineCurve3?1:o.isSplineCurve?t*o.points.length:t,l=o.getPoints(a);for(let c=0;c<l.length;c++){let h=l[c];n&&n.equals(h)||(e.push(h),n=h)}}return this.autoClose&&e.length>1&&!e[e.length-1].equals(e[0])&&e.push(e[0]),e}copy(t){super.copy(t),this.curves=[];for(let e=0,n=t.curves.length;e<n;e++){let i=t.curves[e];this.curves.push(i.clone())}return this.autoClose=t.autoClose,this}toJSON(){let t=super.toJSON();t.autoClose=this.autoClose,t.curves=[];for(let e=0,n=this.curves.length;e<n;e++){let i=this.curves[e];t.curves.push(i.toJSON())}return t}fromJSON(t){super.fromJSON(t),this.autoClose=t.autoClose,this.curves=[];for(let e=0,n=t.curves.length;e<n;e++){let i=t.curves[e];this.curves.push(new mh[i.type]().fromJSON(i))}return this}},Ki=class extends pa{constructor(t){super(),this.type="Path",this.currentPoint=new rt,t&&this.setFromPoints(t)}setFromPoints(t){this.moveTo(t[0].x,t[0].y);for(let e=1,n=t.length;e<n;e++)this.lineTo(t[e].x,t[e].y);return this}moveTo(t,e){return this.currentPoint.set(t,e),this}lineTo(t,e){let n=new Dr(this.currentPoint.clone(),new rt(t,e));return this.curves.push(n),this.currentPoint.set(t,e),this}quadraticCurveTo(t,e,n,i){let r=new Nr(this.currentPoint.clone(),new rt(t,e),new rt(n,i));return this.curves.push(r),this.currentPoint.set(n,i),this}bezierCurveTo(t,e,n,i,r,o){let a=new Lr(this.currentPoint.clone(),new rt(t,e),new rt(n,i),new rt(r,o));return this.curves.push(a),this.currentPoint.set(r,o),this}splineThru(t){let e=[this.currentPoint.clone()].concat(t),n=new Fr(e);return this.curves.push(n),this.currentPoint.copy(t[t.length-1]),this}arc(t,e,n,i,r,o){let a=this.currentPoint.x,l=this.currentPoint.y;return this.absarc(t+a,e+l,n,i,r,o),this}absarc(t,e,n,i,r,o){return this.absellipse(t,e,n,n,i,r,o),this}ellipse(t,e,n,i,r,o,a,l){let c=this.currentPoint.x,h=this.currentPoint.y;return this.absellipse(t+c,e+h,n,i,r,o,a,l),this}absellipse(t,e,n,i,r,o,a,l){let c=new As(t,e,n,i,r,o,a,l);if(this.curves.length>0){let f=c.getPoint(0);f.equals(this.currentPoint)||this.lineTo(f.x,f.y)}this.curves.push(c);let h=c.getPoint(1);return this.currentPoint.copy(h),this}copy(t){return super.copy(t),this.currentPoint.copy(t.currentPoint),this}toJSON(){let t=super.toJSON();return t.currentPoint=this.currentPoint.toArray(),t}fromJSON(t){return super.fromJSON(t),this.currentPoint.fromArray(t.currentPoint),this}},Qi=class extends Ki{constructor(t){super(t),this.uuid=Sn(),this.type="Shape",this.holes=[]}getPointsHoles(t){let e=[];for(let n=0,i=this.holes.length;n<i;n++)e[n]=this.holes[n].getPoints(t);return e}extractPoints(t){return{shape:this.getPoints(t),holes:this.getPointsHoles(t)}}copy(t){super.copy(t),this.holes=[];for(let e=0,n=t.holes.length;e<n;e++){let i=t.holes[e];this.holes.push(i.clone())}return this}toJSON(){let t=super.toJSON();t.uuid=this.uuid,t.holes=[];for(let e=0,n=this.holes.length;e<n;e++){let i=this.holes[e];t.holes.push(i.toJSON())}return t}fromJSON(t){super.fromJSON(t),this.uuid=t.uuid,this.holes=[];for(let e=0,n=t.holes.length;e<n;e++){let i=t.holes[e];this.holes.push(new Ki().fromJSON(i))}return this}};function Z_(s,t,e=2){let n=t&&t.length,i=n?t[0]*e:s.length,r=ug(s,0,i,e,!0),o=[];if(!r||r.next===r.prev)return o;let a,l,c;if(n&&(r=j_(s,t,r,e)),s.length>80*e){a=s[0],l=s[1];let h=a,f=l;for(let u=e;u<i;u+=e){let d=s[u],p=s[u+1];d<a&&(a=d),p<l&&(l=p),d>h&&(h=d),p>f&&(f=p)}c=Math.max(h-a,f-l),c=c!==0?32767/c:0}return ma(r,o,e,a,l,c,0),o}function ug(s,t,e,n,i){let r;if(i===hy(s,t,e,n)>0)for(let o=t;o<e;o+=n)r=Bm(o/n|0,s[o],s[o+1],r);else for(let o=e-n;o>=t;o-=n)r=Bm(o/n|0,s[o],s[o+1],r);return r&&Or(r,r.next)&&(xa(r),r=r.next),r}function Rs(s,t){if(!s)return s;t||(t=s);let e=s,n;do if(n=!1,!e.steiner&&(Or(e,e.next)||we(e.prev,e,e.next)===0)){if(xa(e),e=t=e.prev,e===e.next)break;n=!0}else e=e.next;while(n||e!==t);return t}function ma(s,t,e,n,i,r,o){if(!s)return;!o&&r&&sy(s,n,i,r);let a=s;for(;s.prev!==s.next;){let l=s.prev,c=s.next;if(r?$_(s,n,i,r):J_(s)){t.push(l.i,s.i,c.i),xa(s),s=c.next,a=c.next;continue}if(s=c,s===a){o?o===1?(s=K_(Rs(s),t),ma(s,t,e,n,i,r,2)):o===2&&Q_(s,t,e,n,i,r):ma(Rs(s),t,e,n,i,r,1);break}}}function J_(s){let t=s.prev,e=s,n=s.next;if(we(t,e,n)>=0)return!1;let i=t.x,r=e.x,o=n.x,a=t.y,l=e.y,c=n.y,h=Math.min(i,r,o),f=Math.min(a,l,c),u=Math.max(i,r,o),d=Math.max(a,l,c),p=n.next;for(;p!==t;){if(p.x>=h&&p.x<=u&&p.y>=f&&p.y<=d&&Lo(i,a,r,l,o,c,p.x,p.y)&&we(p.prev,p,p.next)>=0)return!1;p=p.next}return!0}function $_(s,t,e,n){let i=s.prev,r=s,o=s.next;if(we(i,r,o)>=0)return!1;let a=i.x,l=r.x,c=o.x,h=i.y,f=r.y,u=o.y,d=Math.min(a,l,c),p=Math.min(h,f,u),x=Math.max(a,l,c),m=Math.max(h,f,u),g=Nf(d,p,t,e,n),v=Nf(x,m,t,e,n),b=s.prevZ,y=s.nextZ;for(;b&&b.z>=g&&y&&y.z<=v;){if(b.x>=d&&b.x<=x&&b.y>=p&&b.y<=m&&b!==i&&b!==o&&Lo(a,h,l,f,c,u,b.x,b.y)&&we(b.prev,b,b.next)>=0||(b=b.prevZ,y.x>=d&&y.x<=x&&y.y>=p&&y.y<=m&&y!==i&&y!==o&&Lo(a,h,l,f,c,u,y.x,y.y)&&we(y.prev,y,y.next)>=0))return!1;y=y.nextZ}for(;b&&b.z>=g;){if(b.x>=d&&b.x<=x&&b.y>=p&&b.y<=m&&b!==i&&b!==o&&Lo(a,h,l,f,c,u,b.x,b.y)&&we(b.prev,b,b.next)>=0)return!1;b=b.prevZ}for(;y&&y.z<=v;){if(y.x>=d&&y.x<=x&&y.y>=p&&y.y<=m&&y!==i&&y!==o&&Lo(a,h,l,f,c,u,y.x,y.y)&&we(y.prev,y,y.next)>=0)return!1;y=y.nextZ}return!0}function K_(s,t){let e=s;do{let n=e.prev,i=e.next.next;!Or(n,i)&&dg(n,e,e.next,i)&&ga(n,i)&&ga(i,n)&&(t.push(n.i,e.i,i.i),xa(e),xa(e.next),e=s=i),e=e.next}while(e!==s);return Rs(e)}function Q_(s,t,e,n,i,r){let o=s;do{let a=o.next.next;for(;a!==o.prev;){if(o.i!==a.i&&ay(o,a)){let l=pg(o,a);o=Rs(o,o.next),l=Rs(l,l.next),ma(o,t,e,n,i,r,0),ma(l,t,e,n,i,r,0);return}a=a.next}o=o.next}while(o!==s)}function j_(s,t,e,n){let i=[];for(let r=0,o=t.length;r<o;r++){let a=t[r]*n,l=r<o-1?t[r+1]*n:s.length,c=ug(s,a,l,n,!1);c===c.next&&(c.steiner=!0),i.push(oy(c))}i.sort(ty);for(let r=0;r<i.length;r++)e=ey(i[r],e);return e}function ty(s,t){let e=s.x-t.x;if(e===0&&(e=s.y-t.y,e===0)){let n=(s.next.y-s.y)/(s.next.x-s.x),i=(t.next.y-t.y)/(t.next.x-t.x);e=n-i}return e}function ey(s,t){let e=ny(s,t);if(!e)return t;let n=pg(e,s);return Rs(n,n.next),Rs(e,e.next)}function ny(s,t){let e=t,n=s.x,i=s.y,r=-1/0,o;if(Or(s,e))return e;do{if(Or(s,e.next))return e.next;if(i<=e.y&&i>=e.next.y&&e.next.y!==e.y){let f=e.x+(i-e.y)*(e.next.x-e.x)/(e.next.y-e.y);if(f<=n&&f>r&&(r=f,o=e.x<e.next.x?e:e.next,f===n))return o}e=e.next}while(e!==t);if(!o)return null;let a=o,l=o.x,c=o.y,h=1/0;e=o;do{if(n>=e.x&&e.x>=l&&n!==e.x&&fg(i<c?n:r,i,l,c,i<c?r:n,i,e.x,e.y)){let f=Math.abs(i-e.y)/(n-e.x);ga(e,s)&&(f<h||f===h&&(e.x>o.x||e.x===o.x&&iy(o,e)))&&(o=e,h=f)}e=e.next}while(e!==a);return o}function iy(s,t){return we(s.prev,s,t.prev)<0&&we(t.next,s,s.next)<0}function sy(s,t,e,n){let i=s;do i.z===0&&(i.z=Nf(i.x,i.y,t,e,n)),i.prevZ=i.prev,i.nextZ=i.next,i=i.next;while(i!==s);i.prevZ.nextZ=null,i.prevZ=null,ry(i)}function ry(s){let t,e=1;do{let n=s,i;s=null;let r=null;for(t=0;n;){t++;let o=n,a=0;for(let c=0;c<e&&(a++,o=o.nextZ,!!o);c++);let l=e;for(;a>0||l>0&&o;)a!==0&&(l===0||!o||n.z<=o.z)?(i=n,n=n.nextZ,a--):(i=o,o=o.nextZ,l--),r?r.nextZ=i:s=i,i.prevZ=r,r=i;n=o}r.nextZ=null,e*=2}while(t>1);return s}function Nf(s,t,e,n,i){return s=(s-e)*i|0,t=(t-n)*i|0,s=(s|s<<8)&16711935,s=(s|s<<4)&252645135,s=(s|s<<2)&858993459,s=(s|s<<1)&1431655765,t=(t|t<<8)&16711935,t=(t|t<<4)&252645135,t=(t|t<<2)&858993459,t=(t|t<<1)&1431655765,s|t<<1}function oy(s){let t=s,e=s;do(t.x<e.x||t.x===e.x&&t.y<e.y)&&(e=t),t=t.next;while(t!==s);return e}function fg(s,t,e,n,i,r,o,a){return(i-o)*(t-a)>=(s-o)*(r-a)&&(s-o)*(n-a)>=(e-o)*(t-a)&&(e-o)*(r-a)>=(i-o)*(n-a)}function Lo(s,t,e,n,i,r,o,a){return!(s===o&&t===a)&&fg(s,t,e,n,i,r,o,a)}function ay(s,t){return s.next.i!==t.i&&s.prev.i!==t.i&&!ly(s,t)&&(ga(s,t)&&ga(t,s)&&cy(s,t)&&(we(s.prev,s,t.prev)||we(s,t.prev,t))||Or(s,t)&&we(s.prev,s,s.next)>0&&we(t.prev,t,t.next)>0)}function we(s,t,e){return(t.y-s.y)*(e.x-t.x)-(t.x-s.x)*(e.y-t.y)}function Or(s,t){return s.x===t.x&&s.y===t.y}function dg(s,t,e,n){let i=kc(we(s,t,e)),r=kc(we(s,t,n)),o=kc(we(e,n,s)),a=kc(we(e,n,t));return!!(i!==r&&o!==a||i===0&&zc(s,e,t)||r===0&&zc(s,n,t)||o===0&&zc(e,s,n)||a===0&&zc(e,t,n))}function zc(s,t,e){return t.x<=Math.max(s.x,e.x)&&t.x>=Math.min(s.x,e.x)&&t.y<=Math.max(s.y,e.y)&&t.y>=Math.min(s.y,e.y)}function kc(s){return s>0?1:s<0?-1:0}function ly(s,t){let e=s;do{if(e.i!==s.i&&e.next.i!==s.i&&e.i!==t.i&&e.next.i!==t.i&&dg(e,e.next,s,t))return!0;e=e.next}while(e!==s);return!1}function ga(s,t){return we(s.prev,s,s.next)<0?we(s,t,s.next)>=0&&we(s,s.prev,t)>=0:we(s,t,s.prev)<0||we(s,s.next,t)<0}function cy(s,t){let e=s,n=!1,i=(s.x+t.x)/2,r=(s.y+t.y)/2;do e.y>r!=e.next.y>r&&e.next.y!==e.y&&i<(e.next.x-e.x)*(r-e.y)/(e.next.y-e.y)+e.x&&(n=!n),e=e.next;while(e!==s);return n}function pg(s,t){let e=Uf(s.i,s.x,s.y),n=Uf(t.i,t.x,t.y),i=s.next,r=t.prev;return s.next=t,t.prev=s,e.next=i,i.prev=e,n.next=e,e.prev=n,r.next=n,n.prev=r,n}function Bm(s,t,e,n){let i=Uf(s,t,e);return n?(i.next=n.next,i.prev=n,n.next.prev=i,n.next=i):(i.prev=i,i.next=i),i}function xa(s){s.next.prev=s.prev,s.prev.next=s.next,s.prevZ&&(s.prevZ.nextZ=s.nextZ),s.nextZ&&(s.nextZ.prevZ=s.prevZ)}function Uf(s,t,e){return{i:s,x:t,y:e,prev:null,next:null,z:0,prevZ:null,nextZ:null,steiner:!1}}function hy(s,t,e,n){let i=0;for(let r=t,o=e-n;r<e;r+=n)i+=(s[o]-s[r])*(s[r+1]+s[o+1]),o=r;return i}var Ff=class{static triangulate(t,e,n=2){return Z_(t,e,n)}},Be=class s{static area(t){let e=t.length,n=0;for(let i=e-1,r=0;r<e;i=r++)n+=t[i].x*t[r].y-t[r].x*t[i].y;return n*.5}static isClockWise(t){return s.area(t)<0}static triangulateShape(t,e){let n=[],i=[],r=[];zm(t),km(n,t);let o=t.length;e.forEach(zm);for(let l=0;l<e.length;l++)i.push(o),o+=e[l].length,km(n,e[l]);let a=Ff.triangulate(n,i);for(let l=0;l<a.length;l+=3)r.push(a.slice(l,l+3));return r}};function zm(s){let t=s.length;t>2&&s[t-1].equals(s[0])&&s.pop()}function km(s,t){for(let e=0;e<t.length;e++)s.push(t[e].x),s.push(t[e].y)}var _a=class s extends qt{constructor(t=new Qi([new rt(.5,.5),new rt(-.5,.5),new rt(-.5,-.5),new rt(.5,-.5)]),e={}){super(),this.type="ExtrudeGeometry",this.parameters={shapes:t,options:e},t=Array.isArray(t)?t:[t];let n=this,i=[],r=[];for(let a=0,l=t.length;a<l;a++){let c=t[a];o(c)}this.setAttribute("position",new At(i,3)),this.setAttribute("uv",new At(r,2)),this.computeVertexNormals();function o(a){let l=[],c=e.curveSegments!==void 0?e.curveSegments:12,h=e.steps!==void 0?e.steps:1,f=e.depth!==void 0?e.depth:1,u=e.bevelEnabled!==void 0?e.bevelEnabled:!0,d=e.bevelThickness!==void 0?e.bevelThickness:.2,p=e.bevelSize!==void 0?e.bevelSize:d-.1,x=e.bevelOffset!==void 0?e.bevelOffset:0,m=e.bevelSegments!==void 0?e.bevelSegments:3,g=e.extrudePath,v=e.UVGenerator!==void 0?e.UVGenerator:uy,b,y=!1,M,S,w,_;if(g){b=g.getSpacedPoints(h),y=!0,u=!1;let nt=g.isCatmullRomCurve3?g.closed:!1;M=g.computeFrenetFrames(h,nt),S=new P,w=new P,_=new P}u||(m=0,d=0,p=0,x=0);let T=a.extractPoints(c),R=T.shape,L=T.holes;if(!Be.isClockWise(R)){R=R.reverse();for(let nt=0,ct=L.length;nt<ct;nt++){let mt=L[nt];Be.isClockWise(mt)&&(L[nt]=mt.reverse())}}function F(nt){let mt=10000000000000001e-36,gt=nt[0];for(let vt=1;vt<=nt.length;vt++){let zt=vt%nt.length,Ft=nt[zt],Wt=Ft.x-gt.x,Yt=Ft.y-gt.y,B=Wt*Wt+Yt*Yt,se=Math.max(Math.abs(Ft.x),Math.abs(Ft.y),Math.abs(gt.x),Math.abs(gt.y)),Kt=mt*se*se;if(B<=Kt){nt.splice(zt,1),vt--;continue}gt=Ft}}F(R),L.forEach(F);let C=L.length,N=R;for(let nt=0;nt<C;nt++){let ct=L[nt];R=R.concat(ct)}function z(nt,ct,mt){return ct||Bt("ExtrudeGeometry: vec does not exist"),nt.clone().addScaledVector(ct,mt)}let O=R.length;function H(nt,ct,mt){let gt,vt,zt,Ft=nt.x-ct.x,Wt=nt.y-ct.y,Yt=mt.x-nt.x,B=mt.y-nt.y,se=Ft*Ft+Wt*Wt,Kt=Ft*B-Wt*Yt;if(Math.abs(Kt)>Number.EPSILON){let I=Math.sqrt(se),E=Math.sqrt(Yt*Yt+B*B),Y=ct.x-Wt/I,k=ct.y+Ft/I,J=mt.x-B/E,at=mt.y+Yt/E,pt=((J-Y)*B-(at-k)*Yt)/(Ft*B-Wt*Yt);gt=Y+Ft*pt-nt.x,vt=k+Wt*pt-nt.y;let tt=gt*gt+vt*vt;if(tt<=2)return new rt(gt,vt);zt=Math.sqrt(tt/2)}else{let I=!1;Ft>Number.EPSILON?Yt>Number.EPSILON&&(I=!0):Ft<-Number.EPSILON?Yt<-Number.EPSILON&&(I=!0):Math.sign(Wt)===Math.sign(B)&&(I=!0),I?(gt=-Wt,vt=Ft,zt=Math.sqrt(se)):(gt=Ft,vt=Wt,zt=Math.sqrt(se/2))}return new rt(gt/zt,vt/zt)}let U=[];for(let nt=0,ct=N.length,mt=ct-1,gt=nt+1;nt<ct;nt++,mt++,gt++)mt===ct&&(mt=0),gt===ct&&(gt=0),U[nt]=H(N[nt],N[mt],N[gt]);let W=[],Z,j=U.concat();for(let nt=0,ct=C;nt<ct;nt++){let mt=L[nt];Z=[];for(let gt=0,vt=mt.length,zt=vt-1,Ft=gt+1;gt<vt;gt++,zt++,Ft++)zt===vt&&(zt=0),Ft===vt&&(Ft=0),Z[gt]=H(mt[gt],mt[zt],mt[Ft]);W.push(Z),j=j.concat(Z)}let q;if(m===0)q=Be.triangulateShape(N,L);else{let nt=[],ct=[];for(let mt=0;mt<m;mt++){let gt=mt/m,vt=d*Math.cos(gt*Math.PI/2),zt=p*Math.sin(gt*Math.PI/2)+x;for(let Ft=0,Wt=N.length;Ft<Wt;Ft++){let Yt=z(N[Ft],U[Ft],zt);lt(Yt.x,Yt.y,-vt),gt===0&&nt.push(Yt)}for(let Ft=0,Wt=C;Ft<Wt;Ft++){let Yt=L[Ft];Z=W[Ft];let B=[];for(let se=0,Kt=Yt.length;se<Kt;se++){let I=z(Yt[se],Z[se],zt);lt(I.x,I.y,-vt),gt===0&&B.push(I)}gt===0&&ct.push(B)}}q=Be.triangulateShape(nt,ct)}let it=q.length,ft=p+x;for(let nt=0;nt<O;nt++){let ct=u?z(R[nt],j[nt],ft):R[nt];y?(w.copy(M.normals[0]).multiplyScalar(ct.x),S.copy(M.binormals[0]).multiplyScalar(ct.y),_.copy(b[0]).add(w).add(S),lt(_.x,_.y,_.z)):lt(ct.x,ct.y,0)}for(let nt=1;nt<=h;nt++)for(let ct=0;ct<O;ct++){let mt=u?z(R[ct],j[ct],ft):R[ct];y?(w.copy(M.normals[nt]).multiplyScalar(mt.x),S.copy(M.binormals[nt]).multiplyScalar(mt.y),_.copy(b[nt]).add(w).add(S),lt(_.x,_.y,_.z)):lt(mt.x,mt.y,f/h*nt)}for(let nt=m-1;nt>=0;nt--){let ct=nt/m,mt=d*Math.cos(ct*Math.PI/2),gt=p*Math.sin(ct*Math.PI/2)+x;for(let vt=0,zt=N.length;vt<zt;vt++){let Ft=z(N[vt],U[vt],gt);lt(Ft.x,Ft.y,f+mt)}for(let vt=0,zt=L.length;vt<zt;vt++){let Ft=L[vt];Z=W[vt];for(let Wt=0,Yt=Ft.length;Wt<Yt;Wt++){let B=z(Ft[Wt],Z[Wt],gt);y?lt(B.x,B.y+b[h-1].y,b[h-1].x+mt):lt(B.x,B.y,f+mt)}}}ht(),G();function ht(){let nt=i.length/3;if(u){let ct=0,mt=O*ct;for(let gt=0;gt<it;gt++){let vt=q[gt];yt(vt[2]+mt,vt[1]+mt,vt[0]+mt)}ct=h+m*2,mt=O*ct;for(let gt=0;gt<it;gt++){let vt=q[gt];yt(vt[0]+mt,vt[1]+mt,vt[2]+mt)}}else{for(let ct=0;ct<it;ct++){let mt=q[ct];yt(mt[2],mt[1],mt[0])}for(let ct=0;ct<it;ct++){let mt=q[ct];yt(mt[0]+O*h,mt[1]+O*h,mt[2]+O*h)}}n.addGroup(nt,i.length/3-nt,0)}function G(){let nt=i.length/3,ct=0;Q(N,ct),ct+=N.length;for(let mt=0,gt=L.length;mt<gt;mt++){let vt=L[mt];Q(vt,ct),ct+=vt.length}n.addGroup(nt,i.length/3-nt,1)}function Q(nt,ct){let mt=nt.length;for(;--mt>=0;){let gt=mt,vt=mt-1;vt<0&&(vt=nt.length-1);for(let zt=0,Ft=h+m*2;zt<Ft;zt++){let Wt=O*zt,Yt=O*(zt+1),B=ct+gt+Wt,se=ct+vt+Wt,Kt=ct+vt+Yt,I=ct+gt+Yt;dt(B,se,Kt,I)}}}function lt(nt,ct,mt){l.push(nt),l.push(ct),l.push(mt)}function yt(nt,ct,mt){xt(nt),xt(ct),xt(mt);let gt=i.length/3,vt=v.generateTopUV(n,i,gt-3,gt-2,gt-1);Vt(vt[0]),Vt(vt[1]),Vt(vt[2])}function dt(nt,ct,mt,gt){xt(nt),xt(ct),xt(gt),xt(ct),xt(mt),xt(gt);let vt=i.length/3,zt=v.generateSideWallUV(n,i,vt-6,vt-3,vt-2,vt-1);Vt(zt[0]),Vt(zt[1]),Vt(zt[3]),Vt(zt[1]),Vt(zt[2]),Vt(zt[3])}function xt(nt){i.push(l[nt*3+0]),i.push(l[nt*3+1]),i.push(l[nt*3+2])}function Vt(nt){r.push(nt.x),r.push(nt.y)}}}copy(t){return super.copy(t),this.parameters=Object.assign({},t.parameters),this}toJSON(){let t=super.toJSON(),e=this.parameters.shapes,n=this.parameters.options;return fy(e,n,t)}static fromJSON(t,e){let n=[];for(let r=0,o=t.shapes.length;r<o;r++){let a=e[t.shapes[r]];n.push(a)}let i=t.options.extrudePath;return i!==void 0&&(t.options.extrudePath=new mh[i.type]().fromJSON(i)),new s(n,t.options)}},uy={generateTopUV:function(s,t,e,n,i){let r=t[e*3],o=t[e*3+1],a=t[n*3],l=t[n*3+1],c=t[i*3],h=t[i*3+1];return[new rt(r,o),new rt(a,l),new rt(c,h)]},generateSideWallUV:function(s,t,e,n,i,r){let o=t[e*3],a=t[e*3+1],l=t[e*3+2],c=t[n*3],h=t[n*3+1],f=t[n*3+2],u=t[i*3],d=t[i*3+1],p=t[i*3+2],x=t[r*3],m=t[r*3+1],g=t[r*3+2];return Math.abs(a-h)<Math.abs(o-c)?[new rt(o,1-l),new rt(c,1-f),new rt(u,1-p),new rt(x,1-g)]:[new rt(a,1-l),new rt(h,1-f),new rt(d,1-p),new rt(m,1-g)]}};function fy(s,t,e){if(e.shapes=[],Array.isArray(s))for(let n=0,i=s.length;n<i;n++){let r=s[n];e.shapes.push(r.uuid)}else e.shapes.push(s.uuid);return e.options=Object.assign({},t),t.extrudePath!==void 0&&(e.options.extrudePath=t.extrudePath.toJSON()),e}var Cs=class s extends Ti{constructor(t=1,e=0){let n=(1+Math.sqrt(5))/2,i=[-1,n,0,1,n,0,-1,-n,0,1,-n,0,0,-1,n,0,1,n,0,-1,-n,0,1,-n,n,0,-1,n,0,1,-n,0,-1,-n,0,1],r=[0,11,5,0,5,1,0,1,7,0,7,10,0,10,11,1,5,9,5,11,4,11,10,2,10,7,6,7,1,8,3,9,4,3,4,2,3,2,6,3,6,8,3,8,9,4,9,5,2,4,11,6,2,10,8,6,7,9,8,1];super(i,r,t,e),this.type="IcosahedronGeometry",this.parameters={radius:t,detail:e}}static fromJSON(t){return new s(t.radius,t.detail)}},ya=class s extends qt{constructor(t=[new rt(0,-.5),new rt(.5,0),new rt(0,.5)],e=12,n=0,i=Math.PI*2){super(),this.type="LatheGeometry",this.parameters={points:t,segments:e,phiStart:n,phiLength:i},e=Math.floor(e),i=$t(i,0,Math.PI*2);let r=[],o=[],a=[],l=[],c=[],h=1/e,f=new P,u=new rt,d=new P,p=new P,x=new P,m=0,g=0;for(let v=0;v<=t.length-1;v++)switch(v){case 0:m=t[v+1].x-t[v].x,g=t[v+1].y-t[v].y,d.x=g*1,d.y=-m,d.z=g*0,x.copy(d),d.normalize(),l.push(d.x,d.y,d.z);break;case t.length-1:l.push(x.x,x.y,x.z);break;default:m=t[v+1].x-t[v].x,g=t[v+1].y-t[v].y,d.x=g*1,d.y=-m,d.z=g*0,p.copy(d),d.x+=x.x,d.y+=x.y,d.z+=x.z,d.normalize(),l.push(d.x,d.y,d.z),x.copy(p)}for(let v=0;v<=e;v++){let b=n+v*h*i,y=Math.sin(b),M=Math.cos(b);for(let S=0;S<=t.length-1;S++){f.x=t[S].x*y,f.y=t[S].y,f.z=t[S].x*M,o.push(f.x,f.y,f.z),u.x=v/e,u.y=S/(t.length-1),a.push(u.x,u.y);let w=l[3*S+0]*y,_=l[3*S+1],T=l[3*S+0]*M;c.push(w,_,T)}}for(let v=0;v<e;v++)for(let b=0;b<t.length-1;b++){let y=b+v*t.length,M=y,S=y+t.length,w=y+t.length+1,_=y+1;r.push(M,S,_),r.push(w,_,S)}this.setIndex(r),this.setAttribute("position",new At(o,3)),this.setAttribute("uv",new At(a,2)),this.setAttribute("normal",new At(c,3))}copy(t){return super.copy(t),this.parameters=Object.assign({},t.parameters),this}static fromJSON(t){return new s(t.points,t.segments,t.phiStart,t.phiLength)}},Br=class s extends Ti{constructor(t=1,e=0){let n=[1,0,0,-1,0,0,0,1,0,0,-1,0,0,0,1,0,0,-1],i=[0,2,4,0,4,3,0,3,5,0,5,2,1,2,5,1,5,3,1,3,4,1,4,2];super(n,i,t,e),this.type="OctahedronGeometry",this.parameters={radius:t,detail:e}}static fromJSON(t){return new s(t.radius,t.detail)}},wi=class s extends qt{constructor(t=1,e=1,n=1,i=1){super(),this.type="PlaneGeometry",this.parameters={width:t,height:e,widthSegments:n,heightSegments:i};let r=t/2,o=e/2,a=Math.floor(n),l=Math.floor(i),c=a+1,h=l+1,f=t/a,u=e/l,d=[],p=[],x=[],m=[];for(let g=0;g<h;g++){let v=g*u-o;for(let b=0;b<c;b++){let y=b*f-r;p.push(y,-v,0),x.push(0,0,1),m.push(b/a),m.push(1-g/l)}}for(let g=0;g<l;g++)for(let v=0;v<a;v++){let b=v+c*g,y=v+c*(g+1),M=v+1+c*(g+1),S=v+1+c*g;d.push(b,y,S),d.push(y,M,S)}this.setIndex(d),this.setAttribute("position",new At(p,3)),this.setAttribute("normal",new At(x,3)),this.setAttribute("uv",new At(m,2))}copy(t){return super.copy(t),this.parameters=Object.assign({},t.parameters),this}static fromJSON(t){return new s(t.width,t.height,t.widthSegments,t.heightSegments)}},va=class s extends qt{constructor(t=.5,e=1,n=32,i=1,r=0,o=Math.PI*2){super(),this.type="RingGeometry",this.parameters={innerRadius:t,outerRadius:e,thetaSegments:n,phiSegments:i,thetaStart:r,thetaLength:o},n=Math.max(3,n),i=Math.max(1,i);let a=[],l=[],c=[],h=[],f=t,u=(e-t)/i,d=new P,p=new rt;for(let x=0;x<=i;x++){for(let m=0;m<=n;m++){let g=r+m/n*o;d.x=f*Math.cos(g),d.y=f*Math.sin(g),l.push(d.x,d.y,d.z),c.push(0,0,1),p.x=(d.x/e+1)/2,p.y=(d.y/e+1)/2,h.push(p.x,p.y)}f+=u}for(let x=0;x<i;x++){let m=x*(n+1);for(let g=0;g<n;g++){let v=g+m,b=v,y=v+n+1,M=v+n+2,S=v+1;a.push(b,y,S),a.push(y,M,S)}}this.setIndex(a),this.setAttribute("position",new At(l,3)),this.setAttribute("normal",new At(c,3)),this.setAttribute("uv",new At(h,2))}copy(t){return super.copy(t),this.parameters=Object.assign({},t.parameters),this}static fromJSON(t){return new s(t.innerRadius,t.outerRadius,t.thetaSegments,t.phiSegments,t.thetaStart,t.thetaLength)}},Ma=class s extends qt{constructor(t=new Qi([new rt(0,.5),new rt(-.5,-.5),new rt(.5,-.5)]),e=12){super(),this.type="ShapeGeometry",this.parameters={shapes:t,curveSegments:e};let n=[],i=[],r=[],o=[],a=0,l=0;if(Array.isArray(t)===!1)c(t);else for(let h=0;h<t.length;h++)c(t[h]),this.addGroup(a,l,h),a+=l,l=0;this.setIndex(n),this.setAttribute("position",new At(i,3)),this.setAttribute("normal",new At(r,3)),this.setAttribute("uv",new At(o,2));function c(h){let f=i.length/3,u=h.extractPoints(e),d=u.shape,p=u.holes;Be.isClockWise(d)===!1&&(d=d.reverse());for(let m=0,g=p.length;m<g;m++){let v=p[m];Be.isClockWise(v)===!0&&(p[m]=v.reverse())}let x=Be.triangulateShape(d,p);for(let m=0,g=p.length;m<g;m++){let v=p[m];d=d.concat(v)}for(let m=0,g=d.length;m<g;m++){let v=d[m];i.push(v.x,v.y,0),r.push(0,0,1),o.push(v.x,v.y)}for(let m=0,g=x.length;m<g;m++){let v=x[m],b=v[0]+f,y=v[1]+f,M=v[2]+f;n.push(b,y,M),l+=3}}}copy(t){return super.copy(t),this.parameters=Object.assign({},t.parameters),this}toJSON(){let t=super.toJSON(),e=this.parameters.shapes;return dy(e,t)}static fromJSON(t,e){let n=[];for(let i=0,r=t.shapes.length;i<r;i++){let o=e[t.shapes[i]];n.push(o)}return new s(n,t.curveSegments)}};function dy(s,t){if(t.shapes=[],Array.isArray(s))for(let e=0,n=s.length;e<n;e++){let i=s[e];t.shapes.push(i.uuid)}else t.shapes.push(s.uuid);return t}var zr=class s extends qt{constructor(t=1,e=32,n=16,i=0,r=Math.PI*2,o=0,a=Math.PI){super(),this.type="SphereGeometry",this.parameters={radius:t,widthSegments:e,heightSegments:n,phiStart:i,phiLength:r,thetaStart:o,thetaLength:a},e=Math.max(3,Math.floor(e)),n=Math.max(2,Math.floor(n));let l=Math.min(o+a,Math.PI),c=0,h=[],f=new P,u=new P,d=[],p=[],x=[],m=[];for(let g=0;g<=n;g++){let v=[],b=g/n,y=o+b*a,M=t*Math.cos(y),S=Math.sqrt(t*t-M*M),w=0;g===0&&o===0?w=.5/e:g===n&&l===Math.PI&&(w=-.5/e);for(let _=0;_<=e;_++){let T=_/e,R=i+T*r;f.x=-S*Math.cos(R),f.y=M,f.z=S*Math.sin(R),p.push(f.x,f.y,f.z),u.copy(f).normalize(),x.push(u.x,u.y,u.z),m.push(T+w,1-b),v.push(c++)}h.push(v)}for(let g=0;g<n;g++)for(let v=0;v<e;v++){let b=h[g][v+1],y=h[g][v],M=h[g+1][v],S=h[g+1][v+1];(g!==0||o>0)&&d.push(b,y,S),(g!==n-1||l<Math.PI)&&d.push(y,M,S)}this.setIndex(d),this.setAttribute("position",new At(p,3)),this.setAttribute("normal",new At(x,3)),this.setAttribute("uv",new At(m,2))}copy(t){return super.copy(t),this.parameters=Object.assign({},t.parameters),this}static fromJSON(t){return new s(t.radius,t.widthSegments,t.heightSegments,t.phiStart,t.phiLength,t.thetaStart,t.thetaLength)}},Sa=class s extends Ti{constructor(t=1,e=0){let n=[1,1,1,-1,-1,1,-1,1,-1,1,-1,-1],i=[2,1,0,0,3,2,1,3,0,2,3,1];super(n,i,t,e),this.type="TetrahedronGeometry",this.parameters={radius:t,detail:e}}static fromJSON(t){return new s(t.radius,t.detail)}},ba=class s extends qt{constructor(t=1,e=.4,n=12,i=48,r=Math.PI*2,o=0,a=Math.PI*2){super(),this.type="TorusGeometry",this.parameters={radius:t,tube:e,radialSegments:n,tubularSegments:i,arc:r,thetaStart:o,thetaLength:a},n=Math.floor(n),i=Math.floor(i);let l=[],c=[],h=[],f=[],u=new P,d=new P,p=new P;for(let x=0;x<=n;x++){let m=o+x/n*a;for(let g=0;g<=i;g++){let v=g/i*r;d.x=(t+e*Math.cos(m))*Math.cos(v),d.y=(t+e*Math.cos(m))*Math.sin(v),d.z=e*Math.sin(m),c.push(d.x,d.y,d.z),u.x=t*Math.cos(v),u.y=t*Math.sin(v),p.subVectors(d,u).normalize(),h.push(p.x,p.y,p.z),f.push(g/i),f.push(x/n)}}for(let x=1;x<=n;x++)for(let m=1;m<=i;m++){let g=(i+1)*x+m-1,v=(i+1)*(x-1)+m-1,b=(i+1)*(x-1)+m,y=(i+1)*x+m;l.push(g,v,y),l.push(v,b,y)}this.setIndex(l),this.setAttribute("position",new At(c,3)),this.setAttribute("normal",new At(h,3)),this.setAttribute("uv",new At(f,2))}copy(t){return super.copy(t),this.parameters=Object.assign({},t.parameters),this}static fromJSON(t){return new s(t.radius,t.tube,t.radialSegments,t.tubularSegments,t.arc,t.thetaStart,t.thetaLength)}},Ea=class s extends qt{constructor(t=1,e=.4,n=64,i=8,r=2,o=3){super(),this.type="TorusKnotGeometry",this.parameters={radius:t,tube:e,tubularSegments:n,radialSegments:i,p:r,q:o},n=Math.floor(n),i=Math.floor(i);let a=[],l=[],c=[],h=[],f=new P,u=new P,d=new P,p=new P,x=new P,m=new P,g=new P;for(let b=0;b<=n;++b){let y=b/n*r*Math.PI*2;v(y,r,o,t,d),v(y+.01,r,o,t,p),m.subVectors(p,d),g.addVectors(p,d),x.crossVectors(m,g),g.crossVectors(x,m),x.normalize(),g.normalize();for(let M=0;M<=i;++M){let S=M/i*Math.PI*2,w=-e*Math.cos(S),_=e*Math.sin(S);f.x=d.x+(w*g.x+_*x.x),f.y=d.y+(w*g.y+_*x.y),f.z=d.z+(w*g.z+_*x.z),l.push(f.x,f.y,f.z),u.subVectors(f,d).normalize(),c.push(u.x,u.y,u.z),h.push(b/n),h.push(M/i)}}for(let b=1;b<=n;b++)for(let y=1;y<=i;y++){let M=(i+1)*(b-1)+(y-1),S=(i+1)*b+(y-1),w=(i+1)*b+y,_=(i+1)*(b-1)+y;a.push(M,S,_),a.push(S,w,_)}this.setIndex(a),this.setAttribute("position",new At(l,3)),this.setAttribute("normal",new At(c,3)),this.setAttribute("uv",new At(h,2));function v(b,y,M,S,w){let _=Math.cos(b),T=Math.sin(b),R=M/y*b,L=Math.cos(R);w.x=S*(2+L)*.5*_,w.y=S*(2+L)*T*.5,w.z=S*Math.sin(R)*.5}}copy(t){return super.copy(t),this.parameters=Object.assign({},t.parameters),this}static fromJSON(t){return new s(t.radius,t.tube,t.tubularSegments,t.radialSegments,t.p,t.q)}},Ta=class s extends qt{constructor(t=new Ur(new P(-1,-1,0),new P(-1,1,0),new P(1,1,0)),e=64,n=1,i=8,r=!1){super(),this.type="TubeGeometry",this.parameters={path:t,tubularSegments:e,radius:n,radialSegments:i,closed:r};let o=t.computeFrenetFrames(e,r);this.tangents=o.tangents,this.normals=o.normals,this.binormals=o.binormals;let a=new P,l=new P,c=new rt,h=new P,f=[],u=[],d=[],p=[];x(),this.setIndex(p),this.setAttribute("position",new At(f,3)),this.setAttribute("normal",new At(u,3)),this.setAttribute("uv",new At(d,2));function x(){for(let b=0;b<e;b++)m(b);m(r===!1?e:0),v(),g()}function m(b){h=t.getPointAt(b/e,h);let y=o.normals[b],M=o.binormals[b];for(let S=0;S<=i;S++){let w=S/i*Math.PI*2,_=Math.sin(w),T=-Math.cos(w);l.x=T*y.x+_*M.x,l.y=T*y.y+_*M.y,l.z=T*y.z+_*M.z,l.normalize(),u.push(l.x,l.y,l.z),a.x=h.x+n*l.x,a.y=h.y+n*l.y,a.z=h.z+n*l.z,f.push(a.x,a.y,a.z)}}function g(){for(let b=1;b<=e;b++)for(let y=1;y<=i;y++){let M=(i+1)*(b-1)+(y-1),S=(i+1)*b+(y-1),w=(i+1)*b+y,_=(i+1)*(b-1)+y;p.push(M,S,_),p.push(S,w,_)}}function v(){for(let b=0;b<=e;b++)for(let y=0;y<=i;y++)c.x=b/e,c.y=y/i,d.push(c.x,c.y)}}copy(t){return super.copy(t),this.parameters=Object.assign({},t.parameters),this}toJSON(){let t=super.toJSON();return t.path=this.parameters.path.toJSON(),t}static fromJSON(t){return new s(new mh[t.path.type]().fromJSON(t.path),t.tubularSegments,t.radius,t.radialSegments,t.closed)}},wa=class extends qt{constructor(t=null){if(super(),this.type="WireframeGeometry",this.parameters={geometry:t},t!==null){let e=[],n=new Set,i=new P,r=new P;if(t.index!==null){let o=t.attributes.position,a=t.index,l=t.groups;l.length===0&&(l=[{start:0,count:a.count,materialIndex:0}]);for(let c=0,h=l.length;c<h;++c){let f=l[c],u=f.start,d=f.count;for(let p=u,x=u+d;p<x;p+=3)for(let m=0;m<3;m++){let g=a.getX(p+m),v=a.getX(p+(m+1)%3);i.fromBufferAttribute(o,g),r.fromBufferAttribute(o,v),Gm(i,r,n)===!0&&(e.push(i.x,i.y,i.z),e.push(r.x,r.y,r.z))}}}else{let o=t.attributes.position;for(let a=0,l=o.count/3;a<l;a++)for(let c=0;c<3;c++){let h=3*a+c,f=3*a+(c+1)%3;i.fromBufferAttribute(o,h),r.fromBufferAttribute(o,f),Gm(i,r,n)===!0&&(e.push(i.x,i.y,i.z),e.push(r.x,r.y,r.z))}}this.setAttribute("position",new At(e,3))}}copy(t){return super.copy(t),this.parameters=Object.assign({},t.parameters),this}};function Gm(s,t,e){let n=`${s.x},${s.y},${s.z}-${t.x},${t.y},${t.z}`,i=`${t.x},${t.y},${t.z}-${s.x},${s.y},${s.z}`;return e.has(n)===!0||e.has(i)===!0?!1:(e.add(n),e.add(i),!0)}var Vm=Object.freeze({__proto__:null,BoxGeometry:ii,CapsuleGeometry:oa,CircleGeometry:aa,ConeGeometry:Pr,CylinderGeometry:Ei,DodecahedronGeometry:la,EdgesGeometry:ca,ExtrudeGeometry:_a,IcosahedronGeometry:Cs,LatheGeometry:ya,OctahedronGeometry:Br,PlaneGeometry:wi,PolyhedronGeometry:Ti,RingGeometry:va,ShapeGeometry:Ma,SphereGeometry:zr,TetrahedronGeometry:Sa,TorusGeometry:ba,TorusKnotGeometry:Ea,TubeGeometry:Ta,WireframeGeometry:wa}),Aa=class extends Ge{constructor(t){super(),this.isShadowMaterial=!0,this.type="ShadowMaterial",this.color=new _t(0),this.transparent=!0,this.fog=!0,this.setValues(t)}copy(t){return super.copy(t),this.color.copy(t.color),this.fog=t.fog,this}};function ks(s){let t={};for(let e in s){t[e]={};for(let n in s[e]){let i=s[e][n];if(Hm(i))i.isRenderTargetTexture?(St("UniformsUtils: Textures of render targets cannot be cloned via cloneUniforms() or mergeUniforms()."),t[e][n]=null):t[e][n]=i.clone();else if(Array.isArray(i))if(Hm(i[0])){let r=[];for(let o=0,a=i.length;o<a;o++)r[o]=i[o].clone();t[e][n]=r}else t[e][n]=i.slice();else t[e][n]=i}}return t}function on(s){let t={};for(let e=0;e<s.length;e++){let n=ks(s[e]);for(let i in n)t[i]=n[i]}return t}function Hm(s){return s&&(s.isColor||s.isMatrix3||s.isMatrix4||s.isVector2||s.isVector3||s.isVector4||s.isTexture||s.isQuaternion)}function py(s){let t=[];for(let e=0;e<s.length;e++)t.push(s[e].clone());return t}function Ld(s){let t=s.getRenderTarget();return t===null?s.outputColorSpace:t.isXRRenderTarget===!0?t.texture.colorSpace:re.workingColorSpace}var Dd={clone:ks,merge:on},my=`void main() {
	gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
}`,gy=`void main() {
	gl_FragColor = vec4( 1.0, 0.0, 0.0, 1.0 );
}`,un=class extends Ge{constructor(t){super(),this.isShaderMaterial=!0,this.type="ShaderMaterial",this.defines={},this.uniforms={},this.uniformsGroups=[],this.vertexShader=my,this.fragmentShader=gy,this.linewidth=1,this.wireframe=!1,this.wireframeLinewidth=1,this.fog=!1,this.lights=!1,this.clipping=!1,this.forceSinglePass=!0,this.extensions={clipCullDistance:!1,multiDraw:!1},this.defaultAttributeValues={color:[1,1,1],uv:[0,0],uv1:[0,0]},this.index0AttributeName=void 0,this.uniformsNeedUpdate=!1,this.glslVersion=null,t!==void 0&&this.setValues(t)}copy(t){return super.copy(t),this.fragmentShader=t.fragmentShader,this.vertexShader=t.vertexShader,this.uniforms=ks(t.uniforms),this.uniformsGroups=py(t.uniformsGroups),this.defines=Object.assign({},t.defines),this.wireframe=t.wireframe,this.wireframeLinewidth=t.wireframeLinewidth,this.fog=t.fog,this.lights=t.lights,this.clipping=t.clipping,this.extensions=Object.assign({},t.extensions),this.glslVersion=t.glslVersion,this.defaultAttributeValues=Object.assign({},t.defaultAttributeValues),this.index0AttributeName=t.index0AttributeName,this.uniformsNeedUpdate=t.uniformsNeedUpdate,this}toJSON(t){let e=super.toJSON(t);e.glslVersion=this.glslVersion,e.uniforms={};for(let i in this.uniforms){let o=this.uniforms[i].value;o&&o.isTexture?e.uniforms[i]={type:"t",value:o.toJSON(t).uuid}:o&&o.isColor?e.uniforms[i]={type:"c",value:o.getHex()}:o&&o.isVector2?e.uniforms[i]={type:"v2",value:o.toArray()}:o&&o.isVector3?e.uniforms[i]={type:"v3",value:o.toArray()}:o&&o.isVector4?e.uniforms[i]={type:"v4",value:o.toArray()}:o&&o.isMatrix3?e.uniforms[i]={type:"m3",value:o.toArray()}:o&&o.isMatrix4?e.uniforms[i]={type:"m4",value:o.toArray()}:e.uniforms[i]={value:o}}Object.keys(this.defines).length>0&&(e.defines=this.defines),e.vertexShader=this.vertexShader,e.fragmentShader=this.fragmentShader,e.lights=this.lights,e.clipping=this.clipping;let n={};for(let i in this.extensions)this.extensions[i]===!0&&(n[i]=!0);return Object.keys(n).length>0&&(e.extensions=n),e}fromJSON(t,e){if(super.fromJSON(t,e),t.uniforms!==void 0)for(let n in t.uniforms){let i=t.uniforms[n];switch(this.uniforms[n]={},i.type){case"t":this.uniforms[n].value=e[i.value]||null;break;case"c":this.uniforms[n].value=new _t().setHex(i.value);break;case"v2":this.uniforms[n].value=new rt().fromArray(i.value);break;case"v3":this.uniforms[n].value=new P().fromArray(i.value);break;case"v4":this.uniforms[n].value=new ge().fromArray(i.value);break;case"m3":this.uniforms[n].value=new jt().fromArray(i.value);break;case"m4":this.uniforms[n].value=new Jt().fromArray(i.value);break;default:this.uniforms[n].value=i.value}}if(t.defines!==void 0&&(this.defines=t.defines),t.vertexShader!==void 0&&(this.vertexShader=t.vertexShader),t.fragmentShader!==void 0&&(this.fragmentShader=t.fragmentShader),t.glslVersion!==void 0&&(this.glslVersion=t.glslVersion),t.extensions!==void 0)for(let n in t.extensions)this.extensions[n]=t.extensions[n];return t.lights!==void 0&&(this.lights=t.lights),t.clipping!==void 0&&(this.clipping=t.clipping),this}},kr=class extends un{constructor(t){super(t),this.isRawShaderMaterial=!0,this.type="RawShaderMaterial"}},He=class extends Ge{constructor(t){super(),this.isMeshStandardMaterial=!0,this.type="MeshStandardMaterial",this.defines={STANDARD:""},this.color=new _t(16777215),this.roughness=1,this.metalness=0,this.map=null,this.lightMap=null,this.lightMapIntensity=1,this.aoMap=null,this.aoMapIntensity=1,this.emissive=new _t(0),this.emissiveIntensity=1,this.emissiveMap=null,this.bumpMap=null,this.bumpScale=1,this.normalMap=null,this.normalMapType=oi,this.normalScale=new rt(1,1),this.displacementMap=null,this.displacementScale=1,this.displacementBias=0,this.roughnessMap=null,this.metalnessMap=null,this.alphaMap=null,this.envMap=null,this.envMapRotation=new Pn,this.envMapIntensity=1,this.wireframe=!1,this.wireframeLinewidth=1,this.wireframeLinecap="round",this.wireframeLinejoin="round",this.flatShading=!1,this.fog=!0,this.setValues(t)}copy(t){return super.copy(t),this.defines={STANDARD:""},this.color.copy(t.color),this.roughness=t.roughness,this.metalness=t.metalness,this.map=t.map,this.lightMap=t.lightMap,this.lightMapIntensity=t.lightMapIntensity,this.aoMap=t.aoMap,this.aoMapIntensity=t.aoMapIntensity,this.emissive.copy(t.emissive),this.emissiveMap=t.emissiveMap,this.emissiveIntensity=t.emissiveIntensity,this.bumpMap=t.bumpMap,this.bumpScale=t.bumpScale,this.normalMap=t.normalMap,this.normalMapType=t.normalMapType,this.normalScale.copy(t.normalScale),this.displacementMap=t.displacementMap,this.displacementScale=t.displacementScale,this.displacementBias=t.displacementBias,this.roughnessMap=t.roughnessMap,this.metalnessMap=t.metalnessMap,this.alphaMap=t.alphaMap,this.envMap=t.envMap,this.envMapRotation.copy(t.envMapRotation),this.envMapIntensity=t.envMapIntensity,this.wireframe=t.wireframe,this.wireframeLinewidth=t.wireframeLinewidth,this.wireframeLinecap=t.wireframeLinecap,this.wireframeLinejoin=t.wireframeLinejoin,this.flatShading=t.flatShading,this.fog=t.fog,this}},Ra=class extends He{constructor(t){super(),this.isMeshPhysicalMaterial=!0,this.defines={STANDARD:"",PHYSICAL:""},this.type="MeshPhysicalMaterial",this.anisotropyRotation=0,this.anisotropyMap=null,this.clearcoatMap=null,this.clearcoatRoughness=0,this.clearcoatRoughnessMap=null,this.clearcoatNormalScale=new rt(1,1),this.clearcoatNormalMap=null,this.ior=1.5,Object.defineProperty(this,"reflectivity",{get:function(){return $t(2.5*(this.ior-1)/(this.ior+1),0,1)},set:function(e){this.ior=(1+.4*e)/(1-.4*e)}}),this.iridescenceMap=null,this.iridescenceIOR=1.3,this.iridescenceThicknessRange=[100,400],this.iridescenceThicknessMap=null,this.sheenColor=new _t(0),this.sheenColorMap=null,this.sheenRoughness=1,this.sheenRoughnessMap=null,this.transmissionMap=null,this.thickness=0,this.thicknessMap=null,this.attenuationDistance=1/0,this.attenuationColor=new _t(1,1,1),this.specularIntensity=1,this.specularIntensityMap=null,this.specularColor=new _t(1,1,1),this.specularColorMap=null,this._anisotropy=0,this._clearcoat=0,this._dispersion=0,this._iridescence=0,this._retroreflectivity=0,this._sheen=0,this._transmission=0,this.setValues(t)}get anisotropy(){return this._anisotropy}set anisotropy(t){this._anisotropy>0!=t>0&&this.version++,this._anisotropy=t}get clearcoat(){return this._clearcoat}set clearcoat(t){this._clearcoat>0!=t>0&&this.version++,this._clearcoat=t}get iridescence(){return this._iridescence}set iridescence(t){this._iridescence>0!=t>0&&this.version++,this._iridescence=t}get dispersion(){return this._dispersion}set dispersion(t){this._dispersion>0!=t>0&&this.version++,this._dispersion=t}get retroreflectivity(){return this._retroreflectivity}set retroreflectivity(t){this._retroreflectivity>0!=t>0&&this.version++,this._retroreflectivity=t}get sheen(){return this._sheen}set sheen(t){this._sheen>0!=t>0&&this.version++,this._sheen=t}get transmission(){return this._transmission}set transmission(t){this._transmission>0!=t>0&&this.version++,this._transmission=t}copy(t){return super.copy(t),this.defines={STANDARD:"",PHYSICAL:""},this.anisotropy=t.anisotropy,this.anisotropyRotation=t.anisotropyRotation,this.anisotropyMap=t.anisotropyMap,this.clearcoat=t.clearcoat,this.clearcoatMap=t.clearcoatMap,this.clearcoatRoughness=t.clearcoatRoughness,this.clearcoatRoughnessMap=t.clearcoatRoughnessMap,this.clearcoatNormalMap=t.clearcoatNormalMap,this.clearcoatNormalScale.copy(t.clearcoatNormalScale),this.dispersion=t.dispersion,this.ior=t.ior,this.iridescence=t.iridescence,this.iridescenceMap=t.iridescenceMap,this.iridescenceIOR=t.iridescenceIOR,this.iridescenceThicknessRange=[...t.iridescenceThicknessRange],this.iridescenceThicknessMap=t.iridescenceThicknessMap,this.retroreflectivity=t.retroreflectivity,this.sheen=t.sheen,this.sheenColor.copy(t.sheenColor),this.sheenColorMap=t.sheenColorMap,this.sheenRoughness=t.sheenRoughness,this.sheenRoughnessMap=t.sheenRoughnessMap,this.transmission=t.transmission,this.transmissionMap=t.transmissionMap,this.thickness=t.thickness,this.thicknessMap=t.thicknessMap,this.attenuationDistance=t.attenuationDistance,this.attenuationColor.copy(t.attenuationColor),this.specularIntensity=t.specularIntensity,this.specularIntensityMap=t.specularIntensityMap,this.specularColor.copy(t.specularColor),this.specularColorMap=t.specularColorMap,this}},Ca=class extends Ge{constructor(t){super(),this.isMeshPhongMaterial=!0,this.type="MeshPhongMaterial",this.color=new _t(16777215),this.specular=new _t(1118481),this.shininess=30,this.map=null,this.lightMap=null,this.lightMapIntensity=1,this.aoMap=null,this.aoMapIntensity=1,this.emissive=new _t(0),this.emissiveIntensity=1,this.emissiveMap=null,this.bumpMap=null,this.bumpScale=1,this.normalMap=null,this.normalMapType=oi,this.normalScale=new rt(1,1),this.displacementMap=null,this.displacementScale=1,this.displacementBias=0,this.specularMap=null,this.alphaMap=null,this.envMap=null,this.envMapRotation=new Pn,this.combine=Kr,this.reflectivity=1,this.envMapIntensity=1,this.refractionRatio=.98,this.wireframe=!1,this.wireframeLinewidth=1,this.wireframeLinecap="round",this.wireframeLinejoin="round",this.flatShading=!1,this.fog=!0,this.setValues(t)}copy(t){return super.copy(t),this.color.copy(t.color),this.specular.copy(t.specular),this.shininess=t.shininess,this.map=t.map,this.lightMap=t.lightMap,this.lightMapIntensity=t.lightMapIntensity,this.aoMap=t.aoMap,this.aoMapIntensity=t.aoMapIntensity,this.emissive.copy(t.emissive),this.emissiveMap=t.emissiveMap,this.emissiveIntensity=t.emissiveIntensity,this.bumpMap=t.bumpMap,this.bumpScale=t.bumpScale,this.normalMap=t.normalMap,this.normalMapType=t.normalMapType,this.normalScale.copy(t.normalScale),this.displacementMap=t.displacementMap,this.displacementScale=t.displacementScale,this.displacementBias=t.displacementBias,this.specularMap=t.specularMap,this.alphaMap=t.alphaMap,this.envMap=t.envMap,this.envMapRotation.copy(t.envMapRotation),this.combine=t.combine,this.reflectivity=t.reflectivity,this.envMapIntensity=t.envMapIntensity,this.refractionRatio=t.refractionRatio,this.wireframe=t.wireframe,this.wireframeLinewidth=t.wireframeLinewidth,this.wireframeLinecap=t.wireframeLinecap,this.wireframeLinejoin=t.wireframeLinejoin,this.flatShading=t.flatShading,this.fog=t.fog,this}},Ia=class extends Ge{constructor(t){super(),this.isMeshToonMaterial=!0,this.defines={TOON:""},this.type="MeshToonMaterial",this.color=new _t(16777215),this.map=null,this.gradientMap=null,this.lightMap=null,this.lightMapIntensity=1,this.aoMap=null,this.aoMapIntensity=1,this.emissive=new _t(0),this.emissiveIntensity=1,this.emissiveMap=null,this.bumpMap=null,this.bumpScale=1,this.normalMap=null,this.normalMapType=oi,this.normalScale=new rt(1,1),this.displacementMap=null,this.displacementScale=1,this.displacementBias=0,this.alphaMap=null,this.wireframe=!1,this.wireframeLinewidth=1,this.wireframeLinecap="round",this.wireframeLinejoin="round",this.fog=!0,this.setValues(t)}copy(t){return super.copy(t),this.color.copy(t.color),this.map=t.map,this.gradientMap=t.gradientMap,this.lightMap=t.lightMap,this.lightMapIntensity=t.lightMapIntensity,this.aoMap=t.aoMap,this.aoMapIntensity=t.aoMapIntensity,this.emissive.copy(t.emissive),this.emissiveMap=t.emissiveMap,this.emissiveIntensity=t.emissiveIntensity,this.bumpMap=t.bumpMap,this.bumpScale=t.bumpScale,this.normalMap=t.normalMap,this.normalMapType=t.normalMapType,this.normalScale.copy(t.normalScale),this.displacementMap=t.displacementMap,this.displacementScale=t.displacementScale,this.displacementBias=t.displacementBias,this.alphaMap=t.alphaMap,this.wireframe=t.wireframe,this.wireframeLinewidth=t.wireframeLinewidth,this.wireframeLinecap=t.wireframeLinecap,this.wireframeLinejoin=t.wireframeLinejoin,this.fog=t.fog,this}},Pa=class extends Ge{constructor(t){super(),this.isMeshNormalMaterial=!0,this.type="MeshNormalMaterial",this.bumpMap=null,this.bumpScale=1,this.normalMap=null,this.normalMapType=oi,this.normalScale=new rt(1,1),this.displacementMap=null,this.displacementScale=1,this.displacementBias=0,this.wireframe=!1,this.wireframeLinewidth=1,this.flatShading=!1,this.setValues(t)}copy(t){return super.copy(t),this.bumpMap=t.bumpMap,this.bumpScale=t.bumpScale,this.normalMap=t.normalMap,this.normalMapType=t.normalMapType,this.normalScale.copy(t.normalScale),this.displacementMap=t.displacementMap,this.displacementScale=t.displacementScale,this.displacementBias=t.displacementBias,this.wireframe=t.wireframe,this.wireframeLinewidth=t.wireframeLinewidth,this.flatShading=t.flatShading,this}},La=class extends Ge{constructor(t){super(),this.isMeshLambertMaterial=!0,this.type="MeshLambertMaterial",this.color=new _t(16777215),this.map=null,this.lightMap=null,this.lightMapIntensity=1,this.aoMap=null,this.aoMapIntensity=1,this.emissive=new _t(0),this.emissiveIntensity=1,this.emissiveMap=null,this.bumpMap=null,this.bumpScale=1,this.normalMap=null,this.normalMapType=oi,this.normalScale=new rt(1,1),this.displacementMap=null,this.displacementScale=1,this.displacementBias=0,this.specularMap=null,this.alphaMap=null,this.envMap=null,this.envMapRotation=new Pn,this.combine=Kr,this.reflectivity=1,this.envMapIntensity=1,this.refractionRatio=.98,this.wireframe=!1,this.wireframeLinewidth=1,this.wireframeLinecap="round",this.wireframeLinejoin="round",this.flatShading=!1,this.fog=!0,this.setValues(t)}copy(t){return super.copy(t),this.color.copy(t.color),this.map=t.map,this.lightMap=t.lightMap,this.lightMapIntensity=t.lightMapIntensity,this.aoMap=t.aoMap,this.aoMapIntensity=t.aoMapIntensity,this.emissive.copy(t.emissive),this.emissiveMap=t.emissiveMap,this.emissiveIntensity=t.emissiveIntensity,this.bumpMap=t.bumpMap,this.bumpScale=t.bumpScale,this.normalMap=t.normalMap,this.normalMapType=t.normalMapType,this.normalScale.copy(t.normalScale),this.displacementMap=t.displacementMap,this.displacementScale=t.displacementScale,this.displacementBias=t.displacementBias,this.specularMap=t.specularMap,this.alphaMap=t.alphaMap,this.envMap=t.envMap,this.envMapRotation.copy(t.envMapRotation),this.combine=t.combine,this.reflectivity=t.reflectivity,this.envMapIntensity=t.envMapIntensity,this.refractionRatio=t.refractionRatio,this.wireframe=t.wireframe,this.wireframeLinewidth=t.wireframeLinewidth,this.wireframeLinecap=t.wireframeLinecap,this.wireframeLinejoin=t.wireframeLinejoin,this.flatShading=t.flatShading,this.fog=t.fog,this}},Gr=class extends Ge{constructor(t){super(),this.isMeshDepthMaterial=!0,this.type="MeshDepthMaterial",this.depthPacking=vd,this.map=null,this.alphaMap=null,this.displacementMap=null,this.displacementScale=1,this.displacementBias=0,this.wireframe=!1,this.wireframeLinewidth=1,this.setValues(t)}copy(t){return super.copy(t),this.depthPacking=t.depthPacking,this.map=t.map,this.alphaMap=t.alphaMap,this.displacementMap=t.displacementMap,this.displacementScale=t.displacementScale,this.displacementBias=t.displacementBias,this.wireframe=t.wireframe,this.wireframeLinewidth=t.wireframeLinewidth,this}},Vr=class extends Ge{constructor(t){super(),this.isMeshDistanceMaterial=!0,this.type="MeshDistanceMaterial",this.map=null,this.alphaMap=null,this.displacementMap=null,this.displacementScale=1,this.displacementBias=0,this.setValues(t)}copy(t){return super.copy(t),this.map=t.map,this.alphaMap=t.alphaMap,this.displacementMap=t.displacementMap,this.displacementScale=t.displacementScale,this.displacementBias=t.displacementBias,this}},Da=class extends Ge{constructor(t){super(),this.isMeshMatcapMaterial=!0,this.defines={MATCAP:""},this.type="MeshMatcapMaterial",this.color=new _t(16777215),this.matcap=null,this.map=null,this.bumpMap=null,this.bumpScale=1,this.normalMap=null,this.normalMapType=oi,this.normalScale=new rt(1,1),this.displacementMap=null,this.displacementScale=1,this.displacementBias=0,this.alphaMap=null,this.wireframe=!1,this.wireframeLinewidth=1,this.flatShading=!1,this.fog=!0,this.setValues(t)}copy(t){return super.copy(t),this.defines={MATCAP:""},this.color.copy(t.color),this.matcap=t.matcap,this.map=t.map,this.bumpMap=t.bumpMap,this.bumpScale=t.bumpScale,this.normalMap=t.normalMap,this.normalMapType=t.normalMapType,this.normalScale.copy(t.normalScale),this.displacementMap=t.displacementMap,this.displacementScale=t.displacementScale,this.displacementBias=t.displacementBias,this.alphaMap=t.alphaMap,this.wireframe=t.wireframe,this.wireframeLinewidth=t.wireframeLinewidth,this.flatShading=t.flatShading,this.fog=t.fog,this}},Na=class extends Ze{constructor(t){super(),this.isLineDashedMaterial=!0,this.type="LineDashedMaterial",this.scale=1,this.dashSize=3,this.gapSize=1,this.setValues(t)}copy(t){return super.copy(t),this.scale=t.scale,this.dashSize=t.dashSize,this.gapSize=t.gapSize,this}};function zn(s,t){return!s||s.constructor===t?s:typeof t.BYTES_PER_ELEMENT=="number"?new t(s):Array.prototype.slice.call(s)}function Bo(s){return s!==void 0&&s.inTangents!==void 0&&s.outTangents!==void 0}function mg(s){function t(i,r){return s[i]-s[r]}let e=s.length,n=new Array(e);for(let i=0;i!==e;++i)n[i]=i;return n.sort(t),n}function Of(s,t,e){let n=s.length,i=new s.constructor(n);for(let r=0,o=0;o!==n;++r){let a=e[r]*t;for(let l=0;l!==t;++l)i[o++]=s[a+l]}return i}function gg(s,t,e,n){let i=1,r=s[0];for(;r!==void 0&&r[n]===void 0;)r=s[i++];if(r===void 0)return;let o=r[n];if(o!==void 0)if(Array.isArray(o))do o=r[n],o!==void 0&&(t.push(r.time),e.push(...o)),r=s[i++];while(r!==void 0);else if(o.toArray!==void 0)do o=r[n],o!==void 0&&(t.push(r.time),o.toArray(e,e.length)),r=s[i++];while(r!==void 0);else do o=r[n],o!==void 0&&(t.push(r.time),e.push(o)),r=s[i++];while(r!==void 0)}function xy(s,t,e,n,i=30){let r=s.clone();r.name=t;let o=[];for(let l=0;l<r.tracks.length;++l){let c=r.tracks[l],h=c.getValueSize(),f=[],u=[];for(let d=0;d<c.times.length;++d){let p=c.times[d]*i;if(!(p<e||p>=n)){f.push(c.times[d]);for(let x=0;x<h;++x)u.push(c.values[d*h+x])}}f.length!==0&&(c.times=zn(f,c.times.constructor),c.values=zn(u,c.values.constructor),o.push(c))}r.tracks=o;let a=1/0;for(let l=0;l<r.tracks.length;++l)a>r.tracks[l].times[0]&&(a=r.tracks[l].times[0]);for(let l=0;l<r.tracks.length;++l)r.tracks[l].shift(-1*a);return r.resetDuration(),r}function _y(s,t=0,e=s,n=30){n<=0&&(n=30);let i=e.tracks.length,r=t/n;for(let o=0;o<i;++o){let a=e.tracks[o],l=a.ValueTypeName;if(l==="bool"||l==="string")continue;let c=s.tracks.find(function(g){return g.name===a.name&&g.ValueTypeName===l});if(c===void 0)continue;let h=0,f=a.getValueSize();a.createInterpolant.isInterpolantFactoryMethodGLTFCubicSpline&&(h=f/3);let u=0,d=c.getValueSize();c.createInterpolant.isInterpolantFactoryMethodGLTFCubicSpline&&(u=d/3);let p=a.times.length-1,x;if(r<=a.times[0]){let g=h,v=f-h;x=a.values.slice(g,v)}else if(r>=a.times[p]){let g=p*f+h,v=g+f-h;x=a.values.slice(g,v)}else{let g=a.createInterpolant(),v=h,b=f-h;g.evaluate(r),x=g.resultBuffer.slice(v,b)}l==="quaternion"&&new ze().fromArray(x).normalize().conjugate().toArray(x);let m=c.times.length;for(let g=0;g<m;++g){let v=g*d+u;if(l==="quaternion")ze.multiplyQuaternionsFlat(c.values,v,x,0,c.values,v);else{let b=d-u*2;for(let y=0;y<b;++y)c.values[v+y]-=x[y]}}}return s.blendMode=Tu,s}var gh=class{static convertArray(t,e){return zn(t,e)}static isTypedArray(t){return ng(t)}static hasTangents(t){return Bo(t)}static getKeyframeOrder(t){return mg(t)}static sortedArray(t,e,n){return Of(t,e,n)}static flattenJSON(t,e,n,i){gg(t,e,n,i)}static subclip(t,e,n,i,r=30){return xy(t,e,n,i,r)}static makeClipAdditive(t,e=0,n=t,i=30){return _y(t,e,n,i)}},Ai=class{constructor(t,e,n,i){this.parameterPositions=t,this._cachedIndex=0,this.resultBuffer=i!==void 0?i:new e.constructor(n),this.sampleValues=e,this.valueSize=n,this.settings=null,this.DefaultSettings_={}}evaluate(t){let e=this.parameterPositions,n=this._cachedIndex,i=e[n],r=e[n-1];t:{e:{let o;n:{i:if(!(t<i)){for(let a=n+2;;){if(i===void 0){if(t<r)break i;return n=e.length,this._cachedIndex=n,this.copySampleValue_(n-1)}if(n===a)break;if(r=i,i=e[++n],t<i)break e}o=e.length;break n}if(!(t>=r)){let a=e[1];t<a&&(n=2,r=a);for(let l=n-2;;){if(r===void 0)return this._cachedIndex=0,this.copySampleValue_(0);if(n===l)break;if(i=r,r=e[--n-1],t>=r)break e}o=n,n=0;break n}break t}for(;n<o;){let a=n+o>>>1;t<e[a]?o=a:n=a+1}if(i=e[n],r=e[n-1],r===void 0)return this._cachedIndex=0,this.copySampleValue_(0);if(i===void 0)return n=e.length,this._cachedIndex=n,this.copySampleValue_(n-1)}this._cachedIndex=n,this.intervalChanged_(n,r,i)}return this.interpolate_(n,r,t,i)}getSettings_(){return this.settings||this.DefaultSettings_}copySampleValue_(t){let e=this.resultBuffer,n=this.sampleValues,i=this.valueSize,r=t*i;for(let o=0;o!==i;++o)e[o]=n[r+o];return e}interpolate_(){throw new Error("THREE.Interpolant: Call to abstract method.")}intervalChanged_(){}},Ua=class extends Ai{constructor(t,e,n,i){super(t,e,n,i),this._weightPrev=-0,this._offsetPrev=-0,this._weightNext=-0,this._offsetNext=-0,this.DefaultSettings_={endingStart:Wi,endingEnd:Wi}}intervalChanged_(t,e,n){let i=this.parameterPositions,r=t-2,o=t+1,a=i[r],l=i[o];if(a===void 0)switch(this.getSettings_().endingStart){case Xi:r=t,a=2*e-n;break;case vr:r=i.length-2,a=e+i[r]-i[r+1];break;default:r=t,a=n}if(l===void 0)switch(this.getSettings_().endingEnd){case Xi:o=t,l=2*n-e;break;case vr:o=1,l=n+i[1]-i[0];break;default:o=t-1,l=e}let c=(n-e)*.5,h=this.valueSize;this._weightPrev=c/(e-a),this._weightNext=c/(l-n),this._offsetPrev=r*h,this._offsetNext=o*h}interpolate_(t,e,n,i){let r=this.resultBuffer,o=this.sampleValues,a=this.valueSize,l=t*a,c=l-a,h=this._offsetPrev,f=this._offsetNext,u=this._weightPrev,d=this._weightNext,p=(n-e)/(i-e),x=p*p,m=x*p,g=-u*m+2*u*x-u*p,v=(1+u)*m+(-1.5-2*u)*x+(-.5+u)*p+1,b=(-1-d)*m+(1.5+d)*x+.5*p,y=d*m-d*x;for(let M=0;M!==a;++M)r[M]=g*o[h+M]+v*o[c+M]+b*o[l+M]+y*o[f+M];return r}},Hr=class extends Ai{constructor(t,e,n,i){super(t,e,n,i)}interpolate_(t,e,n,i){let r=this.resultBuffer,o=this.sampleValues,a=this.valueSize,l=t*a,c=l-a,h=(n-e)/(i-e),f=1-h;for(let u=0;u!==a;++u)r[u]=o[c+u]*f+o[l+u]*h;return r}},Fa=class extends Ai{constructor(t,e,n,i){super(t,e,n,i)}interpolate_(t){return this.copySampleValue_(t-1)}},Oa=class extends Ai{interpolate_(t,e,n,i){let r=this.resultBuffer,o=this.sampleValues,a=this.valueSize,l=t*a,c=l-a,h=this.inTangents,f=this.outTangents;if(!h||!f){let p=(n-e)/(i-e),x=1-p;for(let m=0;m!==a;++m)r[m]=o[c+m]*x+o[l+m]*p;return r}let u=a*2,d=t-1;for(let p=0;p!==a;++p){let x=o[c+p],m=o[l+p],g=d*u+p*2,v=f[g],b=f[g+1],y=t*u+p*2,M=h[y],S=h[y+1],w=vy(n,e,v,M,i);r[p]=xg(w,x,b,S,m)}return r}};function xg(s,t,e,n,i){let r=1-s;return r*r*r*t+3*r*r*s*e+3*r*s*s*n+s*s*s*i}function yy(s,t,e,n,i){let r=1-s;return 3*r*r*(e-t)+6*r*s*(n-e)+3*s*s*(i-n)}function vy(s,t,e,n,i){let r=(s-t)/(i-t);for(let o=0;o<8;o++){let a=xg(r,t,e,n,i)-s;if(Math.abs(a)<1e-10)break;let l=yy(r,t,e,n,i);if(Math.abs(l)<1e-10)break;r=Math.max(0,Math.min(1,r-a/l))}return r}var fn=class{constructor(t,e,n,i){if(t===void 0)throw new Error("THREE.KeyframeTrack: track name is undefined");if(e===void 0||e.length===0)throw new Error("THREE.KeyframeTrack: no keyframes in track named "+t);this.name=t,this.times=zn(e,this.TimeBufferType),this.values=zn(n,this.ValueBufferType),this.setInterpolation(i||this.DefaultInterpolation)}static toJSON(t){let e=t.constructor,n;if(e.toJSON!==this.toJSON)n=e.toJSON(t);else{n={name:t.name,times:zn(t.times,Array),values:zn(t.values,Array)};let i=t.getInterpolation();i!==t.DefaultInterpolation&&(n.interpolation=i),Bo(t.settings)&&(n.settings={inTangents:zn(t.settings.inTangents,Array),outTangents:zn(t.settings.outTangents,Array)})}return n.type=t.ValueTypeName,n}InterpolantFactoryMethodDiscrete(t){return new Fa(this.times,this.values,this.getValueSize(),t)}InterpolantFactoryMethodLinear(t){return new Hr(this.times,this.values,this.getValueSize(),t)}InterpolantFactoryMethodSmooth(t){return new Ua(this.times,this.values,this.getValueSize(),t)}InterpolantFactoryMethodBezier(t){let e=new Oa(this.times,this.values,this.getValueSize(),t);return this.settings&&(e.inTangents=this.settings.inTangents,e.outTangents=this.settings.outTangents),e}setInterpolation(t){let e;switch(t){case yr:e=this.InterpolantFactoryMethodDiscrete;break;case qo:e=this.InterpolantFactoryMethodLinear;break;case Do:e=this.InterpolantFactoryMethodSmooth;break;case Kc:e=this.InterpolantFactoryMethodBezier;break}if(e===void 0){let n="unsupported interpolation for "+this.ValueTypeName+" keyframe track named "+this.name;if(this.createInterpolant===void 0)if(t!==this.DefaultInterpolation)this.setInterpolation(this.DefaultInterpolation);else throw new Error(n);return St("KeyframeTrack:",n),this}return this.createInterpolant=e,this}getInterpolation(){switch(this.createInterpolant){case this.InterpolantFactoryMethodDiscrete:return yr;case this.InterpolantFactoryMethodLinear:return qo;case this.InterpolantFactoryMethodSmooth:return Do;case this.InterpolantFactoryMethodBezier:return Kc}}getValueSize(){return this.values.length/this.times.length}shift(t){if(t!==0){let e=this.times;for(let n=0,i=e.length;n!==i;++n)e[n]+=t}return this}scale(t){if(t!==1){let e=this.times;for(let n=0,i=e.length;n!==i;++n)e[n]*=t;Bo(this.settings)&&(Wm(this.settings.inTangents,t),Wm(this.settings.outTangents,t))}return this}trim(t,e){let n=this.times,i=n.length,r=0,o=i-1;for(;r!==i&&n[r]<t;)++r;for(;o!==-1&&n[o]>e;)--o;if(++o,r!==0||o!==i){r>=o&&(o=Math.max(o,1),r=o-1);let a=this.getValueSize();this.times=n.slice(r,o),this.values=this.values.slice(r*a,o*a)}return this}validate(){let t=!0,e=this.getValueSize();e-Math.floor(e)!==0&&(Bt("KeyframeTrack: Invalid value size in track.",this),t=!1);let n=this.times,i=this.values,r=n.length;r===0&&(Bt("KeyframeTrack: Track is empty.",this),t=!1);let o=null;for(let a=0;a!==r;a++){let l=n[a];if(typeof l=="number"&&isNaN(l)){Bt("KeyframeTrack: Time is not a valid number.",this,a,l),t=!1;break}if(o!==null&&o>l){Bt("KeyframeTrack: Out of order keys.",this,a,l,o),t=!1;break}o=l}if(i!==void 0&&ng(i))for(let a=0,l=i.length;a!==l;++a){let c=i[a];if(isNaN(c)){Bt("KeyframeTrack: Value is not a valid number.",this,a,c),t=!1;break}}return t}optimize(){let t=this.times.slice(),e=this.values.slice(),n=this.getValueSize(),i=this.getInterpolation()===Do,r=t.length-1,o=1;for(let a=1;a<r;++a){let l=!1,c=t[a],h=t[a+1];if(c!==h&&(a!==1||c!==t[0]))if(i)l=!0;else{let f=a*n,u=f-n,d=f+n;for(let p=0;p!==n;++p){let x=e[f+p];if(x!==e[u+p]||x!==e[d+p]){l=!0;break}}}if(l){if(a!==o){t[o]=t[a];let f=a*n,u=o*n;for(let d=0;d!==n;++d)e[u+d]=e[f+d]}++o}}if(r>0){t[o]=t[r];for(let a=r*n,l=o*n,c=0;c!==n;++c)e[l+c]=e[a+c];++o}return o!==t.length?(this.times=t.slice(0,o),this.values=e.slice(0,o*n)):(this.times=t,this.values=e),this}clone(){let t=this.times.slice(),e=this.values.slice(),n=this.constructor,i=new n(this.name,t,e);return i.createInterpolant=this.createInterpolant,Bo(this.settings)&&(i.settings={inTangents:this.settings.inTangents.slice(),outTangents:this.settings.outTangents.slice()}),i}};function Wm(s,t){for(let e=0,n=s.length;e!==n;e+=2)s[e]*=t}fn.prototype.ValueTypeName="";fn.prototype.TimeBufferType=Float32Array;fn.prototype.ValueBufferType=Float32Array;fn.prototype.DefaultInterpolation=qo;var si=class extends fn{constructor(t,e,n){super(t,e,n)}};si.prototype.ValueTypeName="bool";si.prototype.ValueBufferType=Array;si.prototype.DefaultInterpolation=yr;si.prototype.InterpolantFactoryMethodLinear=void 0;si.prototype.InterpolantFactoryMethodSmooth=void 0;var Wr=class extends fn{constructor(t,e,n,i){super(t,e,n,i)}};Wr.prototype.ValueTypeName="color";var Is=class extends fn{constructor(t,e,n,i){super(t,e,n,i)}};Is.prototype.ValueTypeName="number";var Ba=class extends Ai{constructor(t,e,n,i){super(t,e,n,i)}interpolate_(t,e,n,i){let r=this.resultBuffer,o=this.sampleValues,a=this.valueSize,l=(n-e)/(i-e),c=t*a;for(let h=c+a;c!==h;c+=4)ze.slerpFlat(r,0,o,c-a,o,c,l);return r}},Ps=class extends fn{constructor(t,e,n,i){super(t,e,n,i)}InterpolantFactoryMethodLinear(t){return new Ba(this.times,this.values,this.getValueSize(),t)}};Ps.prototype.ValueTypeName="quaternion";Ps.prototype.InterpolantFactoryMethodSmooth=void 0;var ri=class extends fn{constructor(t,e,n){super(t,e,n)}};ri.prototype.ValueTypeName="string";ri.prototype.ValueBufferType=Array;ri.prototype.DefaultInterpolation=yr;ri.prototype.InterpolantFactoryMethodLinear=void 0;ri.prototype.InterpolantFactoryMethodSmooth=void 0;var Xr=class extends fn{constructor(t,e,n,i){super(t,e,n,i)}};Xr.prototype.ValueTypeName="vector";var ji=class{constructor(t="",e=-1,n=[],i=kl){this.name=t,this.tracks=n,this.duration=e,this.blendMode=i,this.uuid=Sn(),this.userData={},this.duration<0&&this.resetDuration()}static parse(t){let e=[],n=t.tracks,i=1/(t.fps||1);for(let o=0,a=n.length;o!==a;++o)e.push(Sy(n[o]).scale(i));let r=new this(t.name,t.duration,e,t.blendMode);return r.uuid=t.uuid,r.userData=JSON.parse(t.userData||"{}"),r}static toJSON(t){let e=[],n=t.tracks,i={name:t.name,duration:t.duration,tracks:e,uuid:t.uuid,blendMode:t.blendMode,userData:JSON.stringify(t.userData)};for(let r=0,o=n.length;r!==o;++r)e.push(fn.toJSON(n[r]));return i}static CreateFromMorphTargetSequence(t,e,n,i){let r=e.length,o=[];for(let a=0;a<r;a++){let l=[],c=[];l.push((a+r-1)%r,a,(a+1)%r),c.push(0,1,0);let h=mg(l);l=Of(l,1,h),c=Of(c,1,h),!i&&l[0]===0&&(l.push(r),c.push(c[0])),o.push(new Is(".morphTargetInfluences["+e[a].name+"]",l,c).scale(1/n))}return new this(t,-1,o)}static findByName(t,e){let n=t;if(!Array.isArray(t)){let i=t;n=i.geometry&&i.geometry.animations||i.animations}for(let i=0;i<n.length;i++)if(n[i].name===e)return n[i];return null}static CreateClipsFromMorphTargetSequences(t,e,n){let i={},r=/^([\w-]*?)([\d]+)$/;for(let a=0,l=t.length;a<l;a++){let c=t[a],h=c.name.match(r);if(h&&h.length>1){let f=h[1],u=i[f];u||(i[f]=u=[]),u.push(c)}}let o=[];for(let a in i)o.push(this.CreateFromMorphTargetSequence(a,i[a],e,n));return o}resetDuration(){let t=this.tracks,e=0;for(let n=0,i=t.length;n!==i;++n){let r=this.tracks[n];e=Math.max(e,r.times[r.times.length-1])}return this.duration=e,this}trim(){for(let t=0;t<this.tracks.length;t++)this.tracks[t].trim(0,this.duration);return this}validate(){let t=!0;for(let e=0;e<this.tracks.length;e++)t=t&&this.tracks[e].validate();return t}optimize(){for(let t=0;t<this.tracks.length;t++)this.tracks[t].optimize();return this}clone(){let t=[];for(let n=0;n<this.tracks.length;n++)t.push(this.tracks[n].clone());let e=new this.constructor(this.name,this.duration,t,this.blendMode);return e.userData=JSON.parse(JSON.stringify(this.userData)),e}toJSON(){return this.constructor.toJSON(this)}};function My(s){switch(s.toLowerCase()){case"scalar":case"double":case"float":case"number":case"integer":return Is;case"vector":case"vector2":case"vector3":case"vector4":return Xr;case"color":return Wr;case"quaternion":return Ps;case"bool":case"boolean":return si;case"string":return ri}throw new Error("THREE.KeyframeTrack: Unsupported typeName: "+s)}function Sy(s){if(s.type===void 0)throw new Error("THREE.KeyframeTrack: track type undefined, can not parse");let t=My(s.type);if(s.times===void 0){let n=[],i=[];gg(s.keys,n,i,"value"),s.times=n,s.values=i}let e;return t.parse!==void 0?e=t.parse(s):e=new t(s.name,s.times,s.values,s.interpolation),Bo(s.settings)&&(e.settings={inTangents:zn(s.settings.inTangents,Float32Array),outTangents:zn(s.settings.outTangents,Float32Array)}),e}var Gn={enabled:!1,files:{},add:function(s,t){this.enabled!==!1&&(Xm(s)||(this.files[s]=t))},get:function(s){if(this.enabled!==!1&&!Xm(s))return this.files[s]},remove:function(s){delete this.files[s]},clear:function(){this.files={}}};function Xm(s){try{let t=s.slice(s.indexOf(":")+1);return new URL(t).protocol==="blob:"}catch{return!1}}var qr=class{constructor(t,e,n){let i=this,r=!1,o=0,a=0,l,c=[];this.onStart=void 0,this.onLoad=t,this.onProgress=e,this.onError=n,this._abortController=null,this.itemStart=function(h){a++,r===!1&&i.onStart!==void 0&&i.onStart(h,o,a),r=!0},this.itemEnd=function(h){o++,i.onProgress!==void 0&&i.onProgress(h,o,a),o===a&&(r=!1,i.onLoad!==void 0&&i.onLoad())},this.itemError=function(h){i.onError!==void 0&&i.onError(h)},this.resolveURL=function(h){return h=h.normalize("NFC"),l?l(h):h},this.setURLModifier=function(h){return l=h,this},this.addHandler=function(h,f){return c.push(h,f),this},this.removeHandler=function(h){let f=c.indexOf(h);return f!==-1&&c.splice(f,2),this},this.getHandler=function(h){for(let f=0,u=c.length;f<u;f+=2){let d=c[f],p=c[f+1];if(d.global&&(d.lastIndex=0),d.test(h))return p}return null},this.abort=function(){return this.abortController.abort(),this._abortController=null,this}}get abortController(){return this._abortController||(this._abortController=new AbortController),this._abortController}},Nd=new qr,$e=class{constructor(t){this.manager=t!==void 0?t:Nd,this.crossOrigin="anonymous",this.withCredentials=!1,this.path="",this.resourcePath="",this.requestHeader={},typeof __THREE_DEVTOOLS__<"u"&&__THREE_DEVTOOLS__.dispatchEvent(new CustomEvent("observe",{detail:this}))}load(){}loadAsync(t,e){let n=this;return new Promise(function(i,r){n.load(t,i,e,r)})}parse(){}setCrossOrigin(t){return this.crossOrigin=t,this}setWithCredentials(t){return this.withCredentials=t,this}setPath(t){return this.path=t,this}setResourcePath(t){return this.resourcePath=t,this}setRequestHeader(t){return this.requestHeader=t,this}abort(){return this}};$e.DEFAULT_MATERIAL_NAME="__DEFAULT";var _i={},Bf=class extends Error{constructor(t,e){super(t),this.response=e}},Ln=class extends $e{constructor(t){super(t),this.mimeType="",this.responseType="",this._abortController=new AbortController}load(t,e,n,i){t===void 0&&(t=""),this.path!==void 0&&(t=this.path+t),t=this.manager.resolveURL(t);let r=Gn.get(`file:${t}`);if(r!==void 0){this.manager.itemStart(t),setTimeout(()=>{e&&e(r),this.manager.itemEnd(t)},0);return}if(_i[t]!==void 0){_i[t].push({onLoad:e,onProgress:n,onError:i});return}_i[t]=[],_i[t].push({onLoad:e,onProgress:n,onError:i});let o=new Request(t,{headers:new Headers(this.requestHeader),credentials:this.withCredentials?"include":"same-origin",signal:typeof AbortSignal.any=="function"?AbortSignal.any([this._abortController.signal,this.manager.abortController.signal]):this._abortController.signal}),a=this.mimeType,l=this.responseType;fetch(o).then(c=>{if(c.status===200||c.status===0){if(c.status===0&&St("FileLoader: HTTP Status 0 received."),typeof ReadableStream>"u"||c.body===void 0||c.body.getReader===void 0)return c;let h=_i[t],f=c.body.getReader(),u=c.headers.get("X-File-Size")||c.headers.get("Content-Length"),d=u?parseInt(u):0,p=d!==0,x=0,m=new ReadableStream({start(g){v();function v(){f.read().then(({done:b,value:y})=>{if(b)g.close();else{x+=y.byteLength;let M=new ProgressEvent("progress",{lengthComputable:p,loaded:x,total:d});for(let S=0,w=h.length;S<w;S++){let _=h[S];_.onProgress&&_.onProgress(M)}g.enqueue(y),v()}},b=>{g.error(b)})}}});return new Response(m)}else throw new Bf(`fetch for "${c.url}" responded with ${c.status}: ${c.statusText}`,c)}).then(c=>{switch(l){case"arraybuffer":return c.arrayBuffer();case"blob":return c.blob();case"document":return c.text().then(h=>new DOMParser().parseFromString(h,a));case"json":return c.json();default:if(a==="")return c.text();{let f=/charset="?([^;"\s]*)"?/i.exec(a),u=f&&f[1]?f[1].toLowerCase():void 0,d=new TextDecoder(u);return c.arrayBuffer().then(p=>d.decode(p))}}}).then(c=>{Gn.add(`file:${t}`,c);let h=_i[t];delete _i[t];for(let f=0,u=h.length;f<u;f++){let d=h[f];d.onLoad&&d.onLoad(c)}}).catch(c=>{let h=_i[t];if(h===void 0)throw this.manager.itemError(t),c;delete _i[t];for(let f=0,u=h.length;f<u;f++){let d=h[f];d.onError&&d.onError(c)}this.manager.itemError(t)}).finally(()=>{this.manager.itemEnd(t)}),this.manager.itemStart(t)}setResponseType(t){return this.responseType=t,this}setMimeType(t){return this.mimeType=t,this}abort(){return this._abortController.abort(),this._abortController=new AbortController,this}},xh=class extends $e{constructor(t){super(t)}load(t,e,n,i){let r=this,o=new Ln(this.manager);o.setPath(this.path),o.setRequestHeader(this.requestHeader),o.setWithCredentials(this.withCredentials),o.load(t,function(a){try{e(r.parse(JSON.parse(a)))}catch(l){i?i(l):Bt(l),r.manager.itemError(t)}},n,i)}parse(t){let e=[];for(let n=0;n<t.length;n++){let i=ji.parse(t[n]);e.push(i)}return e}},_h=class extends $e{constructor(t){super(t)}load(t,e,n,i){let r=this,o=[],a=new ws,l=new Ln(this.manager);l.setPath(this.path),l.setResponseType("arraybuffer"),l.setRequestHeader(this.requestHeader),l.setWithCredentials(r.withCredentials);let c=0;function h(f){l.load(t[f],function(u){let d=r.parse(u,!0);o[f]={width:d.width,height:d.height,format:d.format,mipmaps:d.mipmaps},c+=1,c===6&&(d.mipmapCount===1&&(a.minFilter=le),a.image=o,a.format=d.format,a.needsUpdate=!0,e&&e(a))},n,i)}if(Array.isArray(t))for(let f=0,u=t.length;f<u;++f)h(f);else l.load(t,function(f){let u=r.parse(f,!0);if(u.isCubemap){let d=u.mipmaps.length/u.mipmapCount;for(let p=0;p<d;p++){o[p]={mipmaps:[]};for(let x=0;x<u.mipmapCount;x++)o[p].mipmaps.push(u.mipmaps[p*u.mipmapCount+x]),o[p].format=u.format,o[p].width=u.width,o[p].height=u.height}a.image=o}else a.image.width=u.width,a.image.height=u.height,a.mipmaps=u.mipmaps;u.mipmapCount===1&&(a.minFilter=le),a.format=u.format,a.needsUpdate=!0,e&&e(a)},n,i);return a}},ur=new WeakMap,ts=class extends $e{constructor(t){super(t)}load(t,e,n,i){this.path!==void 0&&(t=this.path+t),t=this.manager.resolveURL(t);let r=this,o=Gn.get(`image:${t}`);if(o!==void 0){if(o.complete===!0)r.manager.itemStart(t),setTimeout(function(){e&&e(o),r.manager.itemEnd(t)},0);else{let f=ur.get(o);f===void 0&&(f=[],ur.set(o,f)),f.push({onLoad:e,onError:i})}return o}let a=br("img");function l(){h(),e&&e(this);let f=ur.get(this)||[];for(let u=0;u<f.length;u++){let d=f[u];d.onLoad&&d.onLoad(this)}ur.delete(this),r.manager.itemEnd(t)}function c(f){h(),i&&i(f),Gn.remove(`image:${t}`);let u=ur.get(this)||[];for(let d=0;d<u.length;d++){let p=u[d];p.onError&&p.onError(f)}ur.delete(this),r.manager.itemError(t),r.manager.itemEnd(t)}function h(){a.removeEventListener("load",l,!1),a.removeEventListener("error",c,!1)}return a.addEventListener("load",l,!1),a.addEventListener("error",c,!1),t.slice(0,5)!=="data:"&&this.crossOrigin!==void 0&&(a.crossOrigin=this.crossOrigin),Gn.add(`image:${t}`,a),r.manager.itemStart(t),a.src=t,a}},yh=class extends $e{constructor(t){super(t)}load(t,e,n,i){let r=new $i;r.colorSpace=Ee;let o=new ts(this.manager);o.setCrossOrigin(this.crossOrigin),o.setPath(this.path);let a=0;function l(c){o.load(t[c],function(h){r.images[c]=h,a++,a===6&&(r.needsUpdate=!0,e&&e(r))},void 0,i)}for(let c=0;c<t.length;++c)l(c);return r}},vh=class extends $e{constructor(t){super(t)}load(t,e,n,i){let r=this,o=new hn,a=new Ln(this.manager);return a.setResponseType("arraybuffer"),a.setRequestHeader(this.requestHeader),a.setPath(this.path),a.setWithCredentials(r.withCredentials),a.load(t,function(l){let c;try{c=r.parse(l)}catch(h){i!==void 0?i(h):Bt(h);return}r._applyTexData(o,c),e&&e(o,c)},n,i),o}createDataTexture(t){let e=new hn;return this._applyTexData(e,this.parse(t)),e}_applyTexData(t,e){e.image!==void 0?t.image=e.image:e.data!==void 0&&(t.image.width=e.width,t.image.height=e.height,t.image.data=e.data),t.wrapS=e.wrapS!==void 0?e.wrapS:Ce,t.wrapT=e.wrapT!==void 0?e.wrapT:Ce,t.magFilter=e.magFilter!==void 0?e.magFilter:le,t.minFilter=e.minFilter!==void 0?e.minFilter:le,t.anisotropy=e.anisotropy!==void 0?e.anisotropy:1,e.colorSpace!==void 0&&(t.colorSpace=e.colorSpace),e.flipY!==void 0&&(t.flipY=e.flipY),e.format!==void 0&&(t.format=e.format),e.type!==void 0&&(t.type=e.type),e.mipmaps!==void 0&&(t.mipmaps=e.mipmaps,t.minFilter=Ve),e.mipmapCount===1&&(t.minFilter=le),e.generateMipmaps!==void 0&&(t.generateMipmaps=e.generateMipmaps),t.needsUpdate=!0}},Mh=class extends $e{constructor(t){super(t)}load(t,e,n,i){let r=new Pe,o=new ts(this.manager);return o.setCrossOrigin(this.crossOrigin),o.setPath(this.path),o.load(t,function(a){r.image=a,r.needsUpdate=!0,e!==void 0&&e(r)},n,i),r}},qn=class extends ae{constructor(t,e=1){super(),this.isLight=!0,this.type="Light",this.color=new _t(t),this.intensity=e}copy(t,e){return super.copy(t,e),this.color.copy(t.color),this.intensity=t.intensity,this}toJSON(t){let e=super.toJSON(t);return e.object.color=this.color.getHex(),e.object.intensity=this.intensity,e}},za=class extends qn{constructor(t,e,n){super(t,n),this.isHemisphereLight=!0,this.type="HemisphereLight",this.position.copy(ae.DEFAULT_UP),this.updateMatrix(),this.groundColor=new _t(e)}copy(t,e){return super.copy(t,e),this.groundColor.copy(t.groundColor),this}toJSON(t){let e=super.toJSON(t);return e.object.groundColor=this.groundColor.getHex(),e}},Tf=new Jt,qm=new P,Ym=new P,Ls=class{constructor(t){this.camera=t,this.intensity=1,this.bias=0,this.biasNode=null,this.normalBias=0,this.radius=1,this.blurSamples=8,this.mapSize=new rt(512,512),this.mapType=dn,this.map=null,this.mapPass=null,this.matrix=new Jt,this.autoUpdate=!0,this.needsUpdate=!1,this._frustum=new ni,this._frameExtents=new rt(1,1),this._viewportCount=1,this._viewports=[new ge(0,0,1,1)]}getViewportCount(){return this._viewportCount}getCamera(){return this.camera}getFrustum(){return this._frustum}updateMatrices(t){let e=this.camera;qm.setFromMatrixPosition(t.matrixWorld),e.position.copy(qm),Ym.setFromMatrixPosition(t.target.matrixWorld),e.lookAt(Ym),e.updateMatrixWorld(),this._updateMatrix(e,this.matrix,this._frustum)}_updateMatrix(t,e,n,i){Tf.multiplyMatrices(t.projectionMatrix,t.matrixWorldInverse),n.setFromProjectionMatrix(Tf,t.coordinateSystem,t.reversedDepth);let r=this._frameExtents,o=i?i.z/r.x:1,a=i?i.w/r.y:1,l=i?i.x/r.x:0,c=i?i.y/r.y:0;t.coordinateSystem===qi||t.reversedDepth?e.set(.5*o,0,0,.5*o+l,0,.5*a,0,.5*a+c,0,0,1,0,0,0,0,1):e.set(.5*o,0,0,.5*o+l,0,.5*a,0,.5*a+c,0,0,.5,.5,0,0,0,1),e.multiply(Tf)}getViewport(t){return this._viewports[t]}getFrameExtents(){return this._frameExtents}dispose(){this.map&&this.map.dispose(),this.mapPass&&this.mapPass.dispose()}copy(t){return this.camera=t.camera.clone(),this.intensity=t.intensity,this.bias=t.bias,this.radius=t.radius,this.autoUpdate=t.autoUpdate,this.needsUpdate=t.needsUpdate,this.normalBias=t.normalBias,this.blurSamples=t.blurSamples,this.mapSize.copy(t.mapSize),this.biasNode=t.biasNode,this}clone(){return new this.constructor().copy(this)}toJSON(){let t={};return t.intensity=this.intensity,t.bias=this.bias,t.normalBias=this.normalBias,t.radius=this.radius,t.blurSamples=this.blurSamples,t.mapSize=this.mapSize.toArray(),t.camera=this.camera.toJSON(!1).object,delete t.camera.matrix,t}},Gc=new P,Vc=new ze,jn=new P,Ds=class extends ae{constructor(){super(),this.isCamera=!0,this.type="Camera",this.matrixWorldInverse=new Jt,this.projectionMatrix=new Jt,this.projectionMatrixInverse=new Jt,this.coordinateSystem=xn,this._reversedDepth=!1}get reversedDepth(){return this._reversedDepth}copy(t,e){return super.copy(t,e),this.matrixWorldInverse.copy(t.matrixWorldInverse),this.projectionMatrix.copy(t.projectionMatrix),this.projectionMatrixInverse.copy(t.projectionMatrixInverse),this.coordinateSystem=t.coordinateSystem,this}getWorldDirection(t){return super.getWorldDirection(t).negate()}updateMatrixWorld(t){super.updateMatrixWorld(t),this.matrixWorld.decompose(Gc,Vc,jn),jn.x===1&&jn.y===1&&jn.z===1?this.matrixWorldInverse.copy(this.matrixWorld).invert():this.matrixWorldInverse.compose(Gc,Vc,jn.set(1,1,1)).invert()}updateWorldMatrix(t,e,n=!1){super.updateWorldMatrix(t,e,n),this.matrixWorld.decompose(Gc,Vc,jn),jn.x===1&&jn.y===1&&jn.z===1?this.matrixWorldInverse.copy(this.matrixWorld).invert():this.matrixWorldInverse.compose(Gc,Vc,jn.set(1,1,1)).invert()}clone(){return new this.constructor().copy(this)}},Vi=new P,Zm=new rt,Jm=new rt,Oe=class extends Ds{constructor(t=50,e=1,n=.1,i=2e3){super(),this.isPerspectiveCamera=!0,this.type="PerspectiveCamera",this.fov=t,this.zoom=1,this.near=n,this.far=i,this.focus=10,this.aspect=e,this.view=null,this.filmGauge=35,this.filmOffset=0,this.updateProjectionMatrix()}copy(t,e){return super.copy(t,e),this.fov=t.fov,this.zoom=t.zoom,this.near=t.near,this.far=t.far,this.focus=t.focus,this.aspect=t.aspect,this.view=t.view===null?null:Object.assign({},t.view),this.filmGauge=t.filmGauge,this.filmOffset=t.filmOffset,this}setFocalLength(t){let e=.5*this.getFilmHeight()/t;this.fov=vs*2*Math.atan(e),this.updateProjectionMatrix()}getFocalLength(){let t=Math.tan(_s*.5*this.fov);return .5*this.getFilmHeight()/t}getEffectiveFOV(){return vs*2*Math.atan(Math.tan(_s*.5*this.fov)/this.zoom)}getFilmWidth(){return this.filmGauge*Math.min(this.aspect,1)}getFilmHeight(){return this.filmGauge/Math.max(this.aspect,1)}getViewBounds(t,e,n){Vi.set(-1,-1,.5).applyMatrix4(this.projectionMatrixInverse),e.set(Vi.x,Vi.y).multiplyScalar(-t/Vi.z),Vi.set(1,1,.5).applyMatrix4(this.projectionMatrixInverse),n.set(Vi.x,Vi.y).multiplyScalar(-t/Vi.z)}getViewSize(t,e){return this.getViewBounds(t,Zm,Jm),e.subVectors(Jm,Zm)}setViewOffset(t,e,n,i,r,o){this.aspect=t/e,this.view===null&&(this.view={enabled:!0,fullWidth:1,fullHeight:1,offsetX:0,offsetY:0,width:1,height:1}),this.view.enabled=!0,this.view.fullWidth=t,this.view.fullHeight=e,this.view.offsetX=n,this.view.offsetY=i,this.view.width=r,this.view.height=o,this.updateProjectionMatrix()}clearViewOffset(){this.view!==null&&(this.view.enabled=!1),this.updateProjectionMatrix()}updateProjectionMatrix(){let t=this.near,e=t*Math.tan(_s*.5*this.fov)/this.zoom,n=2*e,i=this.aspect*n,r=-.5*i,o=this.view;if(this.view!==null&&this.view.enabled){let l=o.fullWidth,c=o.fullHeight;r+=o.offsetX*i/l,e-=o.offsetY*n/c,i*=o.width/l,n*=o.height/c}let a=this.filmOffset;a!==0&&(r+=t*a/this.getFilmWidth()),this.projectionMatrix.makePerspective(r,r+i,e,e-n,t,this.far,this.coordinateSystem,this.reversedDepth),this.projectionMatrixInverse.copy(this.projectionMatrix).invert()}toJSON(t){let e=super.toJSON(t);return e.object.fov=this.fov,e.object.zoom=this.zoom,e.object.near=this.near,e.object.far=this.far,e.object.focus=this.focus,e.object.aspect=this.aspect,this.view!==null&&(e.object.view=Object.assign({},this.view)),e.object.filmGauge=this.filmGauge,e.object.filmOffset=this.filmOffset,e}},zf=class extends Ls{constructor(){super(new Oe(50,1,.5,500)),this.isSpotLightShadow=!0,this.focus=1,this.aspect=1}updateMatrices(t){let e=this.camera,n=vs*2*t.angle*this.focus,i=this.mapSize.width/this.mapSize.height*this.aspect,r=t.distance||e.far;(n!==e.fov||i!==e.aspect||r!==e.far)&&(e.fov=n,e.aspect=i,e.far=r,e.updateProjectionMatrix()),super.updateMatrices(t)}copy(t){return super.copy(t),this.focus=t.focus,this.aspect=t.aspect,this}toJSON(){let t=super.toJSON();return t.focus=this.focus,t.aspect=this.aspect,t}},ka=class extends qn{constructor(t,e,n=0,i=Math.PI/3,r=0,o=2){super(t,e),this.isSpotLight=!0,this.type="SpotLight",this.position.copy(ae.DEFAULT_UP),this.updateMatrix(),this.target=new ae,this.distance=n,this.angle=i,this.penumbra=r,this.decay=o,this.map=null,this.shadow=new zf}get power(){return this.intensity*Math.PI}set power(t){this.intensity=t/Math.PI}dispose(){super.dispose(),this.shadow.dispose()}copy(t,e){return super.copy(t,e),this.distance=t.distance,this.angle=t.angle,this.penumbra=t.penumbra,this.decay=t.decay,this.target=t.target.clone(),this.map=t.map,this.shadow=t.shadow.clone(),this}toJSON(t){let e=super.toJSON(t);return e.object.distance=this.distance,e.object.angle=this.angle,e.object.decay=this.decay,e.object.penumbra=this.penumbra,e.object.target=this.target.uuid,this.map&&this.map.isTexture&&(e.object.map=this.map.toJSON(t).uuid),e.object.shadow=this.shadow.toJSON(),e}},kf=class extends Ls{constructor(){super(new Oe(90,1,.5,500)),this.isPointLightShadow=!0}},Ga=class extends qn{constructor(t,e,n=0,i=2){super(t,e),this.isPointLight=!0,this.type="PointLight",this.distance=n,this.decay=i,this.shadow=new kf}get power(){return this.intensity*4*Math.PI}set power(t){this.intensity=t/(4*Math.PI)}dispose(){super.dispose(),this.shadow.dispose()}copy(t,e){return super.copy(t,e),this.distance=t.distance,this.decay=t.decay,this.shadow=t.shadow.clone(),this}toJSON(t){let e=super.toJSON(t);return e.object.distance=this.distance,e.object.decay=this.decay,e.object.shadow=this.shadow.toJSON(),e}},es=class extends Ds{constructor(t=-1,e=1,n=1,i=-1,r=.1,o=2e3){super(),this.isOrthographicCamera=!0,this.type="OrthographicCamera",this.zoom=1,this.view=null,this.left=t,this.right=e,this.top=n,this.bottom=i,this.near=r,this.far=o,this.updateProjectionMatrix()}copy(t,e){return super.copy(t,e),this.left=t.left,this.right=t.right,this.top=t.top,this.bottom=t.bottom,this.near=t.near,this.far=t.far,this.zoom=t.zoom,this.view=t.view===null?null:Object.assign({},t.view),this}setViewOffset(t,e,n,i,r,o){this.view===null&&(this.view={enabled:!0,fullWidth:1,fullHeight:1,offsetX:0,offsetY:0,width:1,height:1}),this.view.enabled=!0,this.view.fullWidth=t,this.view.fullHeight=e,this.view.offsetX=n,this.view.offsetY=i,this.view.width=r,this.view.height=o,this.updateProjectionMatrix()}clearViewOffset(){this.view!==null&&(this.view.enabled=!1),this.updateProjectionMatrix()}updateProjectionMatrix(){let t=(this.right-this.left)/(2*this.zoom),e=(this.top-this.bottom)/(2*this.zoom),n=(this.right+this.left)/2,i=(this.top+this.bottom)/2,r=n-t,o=n+t,a=i+e,l=i-e;if(this.view!==null&&this.view.enabled){let c=(this.right-this.left)/this.view.fullWidth/this.zoom,h=(this.top-this.bottom)/this.view.fullHeight/this.zoom;r+=c*this.view.offsetX,o=r+c*this.view.width,a-=h*this.view.offsetY,l=a-h*this.view.height}this.projectionMatrix.makeOrthographic(r,o,a,l,this.near,this.far,this.coordinateSystem,this.reversedDepth),this.projectionMatrixInverse.copy(this.projectionMatrix).invert()}toJSON(t){let e=super.toJSON(t);return e.object.zoom=this.zoom,e.object.left=this.left,e.object.right=this.right,e.object.top=this.top,e.object.bottom=this.bottom,e.object.near=this.near,e.object.far=this.far,this.view!==null&&(e.object.view=Object.assign({},this.view)),e}},Gf=class extends Ls{constructor(){super(new es(-5,5,5,-5,.5,500)),this.isDirectionalLightShadow=!0}},Va=class extends qn{constructor(t,e){super(t,e),this.isDirectionalLight=!0,this.type="DirectionalLight",this.position.copy(ae.DEFAULT_UP),this.updateMatrix(),this.target=new ae,this.shadow=new Gf}dispose(){super.dispose(),this.shadow.dispose()}copy(t){return super.copy(t),this.target=t.target.clone(),this.shadow=t.shadow.clone(),this}toJSON(t){let e=super.toJSON(t);return e.object.shadow=this.shadow.toJSON(),e.object.target=this.target.uuid,e}},Ha=class extends qn{constructor(t,e){super(t,e),this.isAmbientLight=!0,this.type="AmbientLight"}},Wa=class extends qn{constructor(t,e,n=10,i=10){super(t,e),this.isRectAreaLight=!0,this.type="RectAreaLight",this.width=n,this.height=i}get power(){return this.intensity*this.width*this.height*Math.PI}set power(t){this.intensity=t/(this.width*this.height*Math.PI)}copy(t){return super.copy(t),this.width=t.width,this.height=t.height,this}toJSON(t){let e=super.toJSON(t);return e.object.width=this.width,e.object.height=this.height,e}},Yr=class{constructor(){this.isSphericalHarmonics3=!0,this.coefficients=[];for(let t=0;t<9;t++)this.coefficients.push(new P)}set(t){for(let e=0;e<9;e++)this.coefficients[e].copy(t[e]);return this}zero(){for(let t=0;t<9;t++)this.coefficients[t].set(0,0,0);return this}getAt(t,e){let n=t.x,i=t.y,r=t.z,o=this.coefficients;return e.copy(o[0]).multiplyScalar(.282095),e.addScaledVector(o[1],.488603*i),e.addScaledVector(o[2],.488603*r),e.addScaledVector(o[3],.488603*n),e.addScaledVector(o[4],1.092548*(n*i)),e.addScaledVector(o[5],1.092548*(i*r)),e.addScaledVector(o[6],.315392*(3*r*r-1)),e.addScaledVector(o[7],1.092548*(n*r)),e.addScaledVector(o[8],.546274*(n*n-i*i)),e}getIrradianceAt(t,e){let n=t.x,i=t.y,r=t.z,o=this.coefficients;return e.copy(o[0]).multiplyScalar(.886227),e.addScaledVector(o[1],2*.511664*i),e.addScaledVector(o[2],2*.511664*r),e.addScaledVector(o[3],2*.511664*n),e.addScaledVector(o[4],2*.429043*n*i),e.addScaledVector(o[5],2*.429043*i*r),e.addScaledVector(o[6],.743125*r*r-.247708),e.addScaledVector(o[7],2*.429043*n*r),e.addScaledVector(o[8],.429043*(n*n-i*i)),e}add(t){for(let e=0;e<9;e++)this.coefficients[e].add(t.coefficients[e]);return this}addScaledSH(t,e){for(let n=0;n<9;n++)this.coefficients[n].addScaledVector(t.coefficients[n],e);return this}scale(t){for(let e=0;e<9;e++)this.coefficients[e].multiplyScalar(t);return this}lerp(t,e){for(let n=0;n<9;n++)this.coefficients[n].lerp(t.coefficients[n],e);return this}equals(t){for(let e=0;e<9;e++)if(!this.coefficients[e].equals(t.coefficients[e]))return!1;return!0}copy(t){return this.set(t.coefficients)}clone(){return new this.constructor().copy(this)}fromArray(t,e=0){let n=this.coefficients;for(let i=0;i<9;i++)n[i].fromArray(t,e+i*3);return this}toArray(t=[],e=0){let n=this.coefficients;for(let i=0;i<9;i++)n[i].toArray(t,e+i*3);return t}static getBasisAt(t,e){let n=t.x,i=t.y,r=t.z;e[0]=.282095,e[1]=.488603*i,e[2]=.488603*r,e[3]=.488603*n,e[4]=1.092548*n*i,e[5]=1.092548*i*r,e[6]=.315392*(3*r*r-1),e[7]=1.092548*n*r,e[8]=.546274*(n*n-i*i)}},Xa=class extends qn{constructor(t=new Yr,e=1){super(void 0,e),this.isLightProbe=!0,this.sh=t}copy(t){return super.copy(t),this.sh.copy(t.sh),this}toJSON(t){let e=super.toJSON(t);return e.object.sh=this.sh.toArray(),e}},$m={},qa=class s extends $e{constructor(t){super(t),this.textures={}}load(t,e,n,i){let r=this,o=new Ln(r.manager);o.setPath(r.path),o.setRequestHeader(r.requestHeader),o.setWithCredentials(r.withCredentials),o.load(t,function(a){try{e(r.parse(JSON.parse(a)))}catch(l){i?i(l):Bt(l),r.manager.itemError(t)}},n,i)}parse(t){let e=this.createMaterialFromType(t.type);return e.fromJSON(t,this.textures),e}setTextures(t){return this.textures=t,this}createMaterialFromType(t){return s.createMaterialFromType(t)}static createMaterialFromType(t){let n={ShadowMaterial:Aa,SpriteMaterial:Ji,RawShaderMaterial:kr,ShaderMaterial:un,PointsMaterial:Cr,MeshPhysicalMaterial:Ra,MeshStandardMaterial:He,MeshPhongMaterial:Ca,MeshToonMaterial:Ia,MeshNormalMaterial:Pa,MeshLambertMaterial:La,MeshDepthMaterial:Gr,MeshDistanceMaterial:Vr,MeshBasicMaterial:sn,MeshMatcapMaterial:Da,LineDashedMaterial:Na,LineBasicMaterial:Ze,Material:Ge,...$m}[t],i;return n===void 0?(ti(`MaterialLoader: Unknown material type "${t}". Use .registerMaterial() before starting the deserialization process.`),i=new Ge):i=new n,i}static registerMaterial(t,e){$m[t]=e}},Zr=class{static extractUrlBase(t){let e=t.lastIndexOf("/");return e===-1?"./":t.slice(0,e+1)}static resolveURL(t,e){return typeof t!="string"||t===""?"":(/^https?:\/\//i.test(e)&&/^\//.test(t)&&(e=e.replace(/(^https?:\/\/[^\/]+).*/i,"$1")),/^(https?:)?\/\//i.test(t)||/^data:.*,.*$/i.test(t)||/^blob:.*$/i.test(t)?t:e+t)}},Ya=class extends qt{constructor(){super(),this.isInstancedBufferGeometry=!0,this.type="InstancedBufferGeometry",this.instanceCount=1/0}copy(t){return super.copy(t),this.instanceCount=t.instanceCount,this}toJSON(){let t=super.toJSON();return t.instanceCount=this.instanceCount,t.isInstancedBufferGeometry=!0,t}},Za=class extends $e{constructor(t){super(t)}load(t,e,n,i){let r=this,o=new Ln(r.manager);o.setPath(r.path),o.setRequestHeader(r.requestHeader),o.setWithCredentials(r.withCredentials),o.load(t,function(a){try{e(r.parse(JSON.parse(a)))}catch(l){i?i(l):Bt(l),r.manager.itemError(t)}},n,i)}parse(t){let e={},n={};function i(d,p){if(e[p]!==void 0)return e[p];let m=d.interleavedBuffers[p],g=r(d,m.buffer),v=gr(m.type,g),b=new Zi(v,m.stride);return b.uuid=m.uuid,m.usage!==void 0&&b.setUsage(m.usage),e[p]=b,b}function r(d,p){if(n[p]!==void 0)return n[p];let m=d.arrayBuffers[p],g=new Uint32Array(m).buffer;return n[p]=g,g}let o=t.isInstancedBufferGeometry?new Ya:new qt,a=t.data.index;if(a!==void 0){let d=gr(a.type,a.array);o.setIndex(new Qt(d,1))}let l=t.data.attributes;for(let d in l){let p=l[d],x;if(p.isInterleavedBufferAttribute){let m=i(t.data,p.data);x=new Mi(m,p.itemSize,p.offset,p.normalized)}else{let m=gr(p.type,p.array),g=p.isInstancedBufferAttribute?ei:Qt;x=new g(m,p.itemSize,p.normalized)}p.name!==void 0&&(x.name=p.name),p.usage!==void 0&&x.setUsage(p.usage),p.gpuType!==void 0&&(x.gpuType=p.gpuType),o.setAttribute(d,x)}let c=t.data.morphAttributes;if(c)for(let d in c){let p=c[d],x=[];for(let m=0,g=p.length;m<g;m++){let v=p[m],b;if(v.isInterleavedBufferAttribute){let y=i(t.data,v.data);b=new Mi(y,v.itemSize,v.offset,v.normalized)}else{let y=gr(v.type,v.array);b=new Qt(y,v.itemSize,v.normalized)}v.name!==void 0&&(b.name=v.name),v.usage!==void 0&&b.setUsage(v.usage),v.gpuType!==void 0&&(b.gpuType=v.gpuType),x.push(b)}o.morphAttributes[d]=x}t.data.morphTargetsRelative&&(o.morphTargetsRelative=!0);let f=t.data.groups||t.data.drawcalls||t.data.offsets;if(f!==void 0)for(let d=0,p=f.length;d!==p;++d){let x=f[d];o.addGroup(x.start,x.count,x.materialIndex)}let u=t.data.boundingSphere;return u!==void 0&&(o.boundingSphere=new ke().fromJSON(u)),t.name&&(o.name=t.name),t.userData&&(o.userData=t.userData),o}},wf={},Sh=class extends $e{constructor(t){super(t)}load(t,e,n,i){let r=this,o=this.path===""?Zr.extractUrlBase(t):this.path;this.resourcePath=this.resourcePath||o;let a=new Ln(this.manager);a.setPath(this.path),a.setRequestHeader(this.requestHeader),a.setWithCredentials(this.withCredentials),a.load(t,function(l){let c=null;try{c=JSON.parse(l)}catch(f){i!==void 0&&i(f),Bt("ObjectLoader: Can't parse "+t+".",f.message);return}let h=c.metadata;if(h===void 0||h.type===void 0||h.type.toLowerCase()==="geometry"){i!==void 0&&i(new Error("THREE.ObjectLoader: Can't load "+t)),Bt("ObjectLoader: Can't load "+t);return}r.parse(c,e)},n,i)}async loadAsync(t,e){let n=this,i=this.path===""?Zr.extractUrlBase(t):this.path;this.resourcePath=this.resourcePath||i;let r=new Ln(this.manager);r.setPath(this.path),r.setRequestHeader(this.requestHeader),r.setWithCredentials(this.withCredentials);let o=await r.loadAsync(t,e),a;try{a=JSON.parse(o)}catch(c){throw new Error("THREE.ObjectLoader: Can't parse "+t+". "+c.message)}let l=a.metadata;if(l===void 0||l.type===void 0||l.type.toLowerCase()==="geometry")throw new Error("THREE.ObjectLoader: Can't load "+t);return await n.parseAsync(a)}parse(t,e){let n=this.parseAnimations(t.animations),i=this.parseShapes(t.shapes),r=this.parseGeometries(t.geometries,i),o=this.parseImages(t.images,function(){e!==void 0&&e(c)}),a=this.parseTextures(t.textures,o),l=this.parseMaterials(t.materials,a),c=this.parseObject(t.object,r,l,a,n),h=this.parseSkeletons(t.skeletons,c);if(this.bindSkeletons(c,h),this.bindLightTargets(c),e!==void 0){let f=!1;for(let u in o)if(o[u].data instanceof HTMLImageElement){f=!0;break}f===!1&&e(c)}return c}async parseAsync(t){let e=this.parseAnimations(t.animations),n=this.parseShapes(t.shapes),i=this.parseGeometries(t.geometries,n),r=await this.parseImagesAsync(t.images),o=this.parseTextures(t.textures,r),a=this.parseMaterials(t.materials,o),l=this.parseObject(t.object,i,a,o,e),c=this.parseSkeletons(t.skeletons,l);return this.bindSkeletons(l,c),this.bindLightTargets(l),l}static registerGeometry(t,e){wf[t]=e}parseShapes(t){let e={};if(t!==void 0)for(let n=0,i=t.length;n<i;n++){let r=new Qi().fromJSON(t[n]);e[r.uuid]=r}return e}parseSkeletons(t,e){let n={},i={};if(e.traverse(function(r){r.isBone&&(i[r.uuid]=r)}),t!==void 0)for(let r=0,o=t.length;r<o;r++){let a=new jo().fromJSON(t[r],i);n[a.uuid]=a}return n}parseGeometries(t,e){let n={};if(t!==void 0){let i=new Za;for(let r=0,o=t.length;r<o;r++){let a,l=t[r];switch(l.type){case"BufferGeometry":case"InstancedBufferGeometry":a=i.parse(l);break;default:l.type in Vm?a=Vm[l.type].fromJSON(l,e):l.type in wf?a=wf[l.type].fromJSON(l,e):St(`ObjectLoader: Unknown geometry type "${l.type}". Use .registerGeometry() before starting the deserialization process.`)}a.uuid=l.uuid,l.name!==void 0&&(a.name=l.name),l.userData!==void 0&&(a.userData=l.userData),n[l.uuid]=a}}return n}parseMaterials(t,e){let n={},i={};if(t!==void 0){let r=new qa;r.setTextures(e);for(let o=0,a=t.length;o<a;o++){let l=t[o];n[l.uuid]===void 0&&(n[l.uuid]=r.parse(l)),i[l.uuid]=n[l.uuid]}}return i}parseAnimations(t){let e={};if(t!==void 0)for(let n=0;n<t.length;n++){let i=t[n],r=ji.parse(i);e[r.uuid]=r}return e}parseImages(t,e){let n=this,i={},r;function o(l){return l=n.manager.resolveURL(l),n.manager.itemStart(l),r.load(l,function(){n.manager.itemEnd(l)},void 0,function(){n.manager.itemError(l),n.manager.itemEnd(l)})}function a(l){if(typeof l=="string"){let c=l,h=/^(\/\/)|([a-z]+:(\/\/)?)/i.test(c)?c:n.resourcePath+c;return o(h)}else return l.data?{data:gr(l.type,l.data),width:l.width,height:l.height}:null}if(t!==void 0&&t.length>0){let l=new qr(e);r=new ts(l),r.setCrossOrigin(this.crossOrigin);for(let c=0,h=t.length;c<h;c++){let f=t[c],u=f.url;if(Array.isArray(u)){let d=[];for(let p=0,x=u.length;p<x;p++){let m=u[p],g=a(m);g!==null&&(g instanceof HTMLImageElement?d.push(g):d.push(new hn(g.data,g.width,g.height)))}i[f.uuid]=new Cn(d)}else{let d=a(f.url);i[f.uuid]=new Cn(d)}}}return i}async parseImagesAsync(t){let e=this,n={},i;async function r(o){if(typeof o=="string"){let a=o,l=/^(\/\/)|([a-z]+:(\/\/)?)/i.test(a)?a:e.resourcePath+a;return await i.loadAsync(l)}else return o.data?{data:gr(o.type,o.data),width:o.width,height:o.height}:null}if(t!==void 0&&t.length>0){i=new ts(this.manager),i.setCrossOrigin(this.crossOrigin);for(let o=0,a=t.length;o<a;o++){let l=t[o],c=l.url;if(Array.isArray(c)){let h=[];for(let f=0,u=c.length;f<u;f++){let d=c[f],p=await r(d);p!==null&&(p instanceof HTMLImageElement?h.push(p):h.push(new hn(p.data,p.width,p.height)))}n[l.uuid]=new Cn(h)}else{let h=await r(l.url);n[l.uuid]=new Cn(h)}}}return n}parseTextures(t,e){function n(r,o){return typeof r=="number"?r:(St("ObjectLoader.parseTexture: Constant should be in numeric form.",r),o[r])}let i={};if(t!==void 0)for(let r=0,o=t.length;r<o;r++){let a=t[r];a.image===void 0&&St('ObjectLoader: No "image" specified for',a.uuid),e[a.image]===void 0&&St("ObjectLoader: Undefined image",a.image);let l=e[a.image],c=l.data,h;Array.isArray(c)?(h=new $i,c.length===6&&(h.needsUpdate=!0)):(c&&c.data?h=new hn:h=new Pe,c&&(h.needsUpdate=!0)),h.source=l,h.uuid=a.uuid,a.name!==void 0&&(h.name=a.name),a.mapping!==void 0&&(h.mapping=n(a.mapping,by)),a.channel!==void 0&&(h.channel=a.channel),a.offset!==void 0&&h.offset.fromArray(a.offset),a.repeat!==void 0&&h.repeat.fromArray(a.repeat),a.center!==void 0&&h.center.fromArray(a.center),a.rotation!==void 0&&(h.rotation=a.rotation),a.wrap!==void 0&&(h.wrapS=n(a.wrap[0],Km),h.wrapT=n(a.wrap[1],Km)),a.format!==void 0&&(h.format=a.format),a.internalFormat!==void 0&&(h.internalFormat=a.internalFormat),a.type!==void 0&&(h.type=a.type),a.colorSpace!==void 0&&(h.colorSpace=a.colorSpace),a.minFilter!==void 0&&(h.minFilter=n(a.minFilter,Qm)),a.magFilter!==void 0&&(h.magFilter=n(a.magFilter,Qm)),a.anisotropy!==void 0&&(h.anisotropy=a.anisotropy),a.flipY!==void 0&&(h.flipY=a.flipY),a.generateMipmaps!==void 0&&(h.generateMipmaps=a.generateMipmaps),a.premultiplyAlpha!==void 0&&(h.premultiplyAlpha=a.premultiplyAlpha),a.unpackAlignment!==void 0&&(h.unpackAlignment=a.unpackAlignment),a.compareFunction!==void 0&&(h.compareFunction=a.compareFunction),a.normalized!==void 0&&(h.normalized=a.normalized),a.userData!==void 0&&(h.userData=a.userData),i[a.uuid]=h}return i}parseObject(t,e,n,i,r){let o;function a(u){return e[u]===void 0&&St("ObjectLoader: Undefined geometry",u),e[u]}function l(u){if(u!==void 0){if(Array.isArray(u)){let d=[];for(let p=0,x=u.length;p<x;p++){let m=u[p];n[m]===void 0&&St("ObjectLoader: Undefined material",m),d.push(n[m])}return d}return n[u]===void 0&&St("ObjectLoader: Undefined material",u),n[u]}}function c(u){return i[u]===void 0&&St("ObjectLoader: Undefined texture",u),i[u]}let h,f;switch(t.type){case"Scene":o=new $o,t.background!==void 0&&(Number.isInteger(t.background)?o.background=new _t(t.background):o.background=c(t.background)),t.environment!==void 0&&(o.environment=c(t.environment)),t.fog!==void 0&&(t.fog.type==="Fog"?o.fog=new Jo(t.fog.color,t.fog.near,t.fog.far):t.fog.type==="FogExp2"&&(o.fog=new Zo(t.fog.color,t.fog.density)),t.fog.name!==""&&(o.fog.name=t.fog.name)),t.backgroundBlurriness!==void 0&&(o.backgroundBlurriness=t.backgroundBlurriness),t.backgroundIntensity!==void 0&&(o.backgroundIntensity=t.backgroundIntensity),t.backgroundRotation!==void 0&&o.backgroundRotation.fromArray(t.backgroundRotation),t.environmentIntensity!==void 0&&(o.environmentIntensity=t.environmentIntensity),t.environmentRotation!==void 0&&o.environmentRotation.fromArray(t.environmentRotation);break;case"PerspectiveCamera":o=new Oe(t.fov,t.aspect,t.near,t.far),t.focus!==void 0&&(o.focus=t.focus),t.zoom!==void 0&&(o.zoom=t.zoom),t.filmGauge!==void 0&&(o.filmGauge=t.filmGauge),t.filmOffset!==void 0&&(o.filmOffset=t.filmOffset),t.view!==void 0&&(o.view=Object.assign({},t.view));break;case"OrthographicCamera":o=new es(t.left,t.right,t.top,t.bottom,t.near,t.far),t.zoom!==void 0&&(o.zoom=t.zoom),t.view!==void 0&&(o.view=Object.assign({},t.view));break;case"AmbientLight":o=new Ha(t.color,t.intensity);break;case"DirectionalLight":o=new Va(t.color,t.intensity),o.target=t.target||"";break;case"PointLight":o=new Ga(t.color,t.intensity,t.distance,t.decay);break;case"RectAreaLight":o=new Wa(t.color,t.intensity,t.width,t.height);break;case"SpotLight":o=new ka(t.color,t.intensity,t.distance,t.angle,t.penumbra,t.decay),o.target=t.target||"";break;case"HemisphereLight":o=new za(t.color,t.groundColor,t.intensity);break;case"LightProbe":let u=new Yr().fromArray(t.sh);o=new Xa(u,t.intensity);break;case"SkinnedMesh":h=a(t.geometry),f=l(t.material),o=new Qo(h,f),t.bindMode!==void 0&&(o.bindMode=t.bindMode),t.bindMatrix!==void 0&&o.bindMatrix.fromArray(t.bindMatrix),t.skeleton!==void 0&&(o.skeleton=t.skeleton);break;case"Mesh":h=a(t.geometry),f=l(t.material),o=new ce(h,f);break;case"InstancedMesh":h=a(t.geometry),f=l(t.material);let d=t.count,p=t.instanceMatrix,x=t.instanceColor;o=new Hn(h,f,d),o.instanceMatrix=new ei(new Float32Array(p.array),16),x!==void 0&&(o.instanceColor=new ei(new Float32Array(x.array),x.itemSize));break;case"BatchedMesh":h=a(t.geometry),f=l(t.material),o=new ea(t.maxInstanceCount,t.maxVertexCount,t.maxIndexCount,f),o.geometry=h,o.perObjectFrustumCulled=t.perObjectFrustumCulled,o.sortObjects=t.sortObjects,o._drawRanges=t.drawRanges,o._reservedRanges=t.reservedRanges,o._geometryInfo=t.geometryInfo.map(m=>{let g=null,v=null;return m.boundingBox!==void 0&&(g=new Ae().fromJSON(m.boundingBox)),m.boundingSphere!==void 0&&(v=new ke().fromJSON(m.boundingSphere)),{...m,boundingBox:g,boundingSphere:v}}),o._instanceInfo=t.instanceInfo,o._availableInstanceIds=t._availableInstanceIds,o._availableGeometryIds=t._availableGeometryIds,o._nextIndexStart=t.nextIndexStart,o._nextVertexStart=t.nextVertexStart,o._geometryCount=t.geometryCount,o._maxInstanceCount=t.maxInstanceCount,o._maxVertexCount=t.maxVertexCount,o._maxIndexCount=t.maxIndexCount,o._geometryInitialized=t.geometryInitialized,o._matricesTexture=c(t.matricesTexture.uuid),o._indirectTexture=c(t.indirectTexture.uuid),t.colorsTexture!==void 0&&(o._colorsTexture=c(t.colorsTexture.uuid)),t.boundingSphere!==void 0&&(o.boundingSphere=new ke().fromJSON(t.boundingSphere)),t.boundingBox!==void 0&&(o.boundingBox=new Ae().fromJSON(t.boundingBox));break;case"LOD":o=new Ko;break;case"Line":o=new Wn(a(t.geometry),l(t.material));break;case"LineLoop":o=new na(a(t.geometry),l(t.material));break;case"LineSegments":o=new bn(a(t.geometry),l(t.material));break;case"PointCloud":case"Points":o=new ia(a(t.geometry),l(t.material));break;case"Sprite":o=new Ts(l(t.material));break;case"Group":o=new Te;break;case"Bone":o=new Rr;break;default:o=new ae}if(o.uuid=t.uuid,t.name!==void 0&&(o.name=t.name),t.matrix!==void 0?(o.matrix.fromArray(t.matrix),t.matrixAutoUpdate!==void 0&&(o.matrixAutoUpdate=t.matrixAutoUpdate),o.matrixAutoUpdate&&o.matrix.decompose(o.position,o.quaternion,o.scale)):(t.position!==void 0&&o.position.fromArray(t.position),t.rotation!==void 0&&o.rotation.fromArray(t.rotation),t.quaternion!==void 0&&o.quaternion.fromArray(t.quaternion),t.scale!==void 0&&o.scale.fromArray(t.scale)),t.up!==void 0&&o.up.fromArray(t.up),t.pivot!==void 0&&(o.pivot=new P().fromArray(t.pivot)),t.morphTargetDictionary!==void 0&&(o.morphTargetDictionary=Object.assign({},t.morphTargetDictionary)),t.morphTargetInfluences!==void 0&&(o.morphTargetInfluences=t.morphTargetInfluences.slice()),t.castShadow!==void 0&&(o.castShadow=t.castShadow),t.receiveShadow!==void 0&&(o.receiveShadow=t.receiveShadow),t.shadow&&(t.shadow.intensity!==void 0&&(o.shadow.intensity=t.shadow.intensity),t.shadow.bias!==void 0&&(o.shadow.bias=t.shadow.bias),t.shadow.normalBias!==void 0&&(o.shadow.normalBias=t.shadow.normalBias),t.shadow.radius!==void 0&&(o.shadow.radius=t.shadow.radius),t.shadow.blurSamples!==void 0&&(o.shadow.blurSamples=t.shadow.blurSamples),t.shadow.focus!==void 0&&(o.shadow.focus=t.shadow.focus),t.shadow.aspect!==void 0&&(o.shadow.aspect=t.shadow.aspect),t.shadow.mapSize!==void 0&&o.shadow.mapSize.fromArray(t.shadow.mapSize),t.shadow.camera!==void 0&&(o.shadow.camera=this.parseObject(t.shadow.camera))),t.visible!==void 0&&(o.visible=t.visible),t.frustumCulled!==void 0&&(o.frustumCulled=t.frustumCulled),t.renderOrder!==void 0&&(o.renderOrder=t.renderOrder),t.static!==void 0&&(o.static=t.static),t.userData!==void 0&&(o.userData=t.userData),t.layers!==void 0&&(o.layers.mask=t.layers),t.children!==void 0){let u=t.children;for(let d=0;d<u.length;d++)o.add(this.parseObject(u[d],e,n,i,r))}if(t.animations!==void 0){let u=t.animations;for(let d=0;d<u.length;d++){let p=u[d];o.animations.push(r[p])}}if(t.type==="LOD"){t.autoUpdate!==void 0&&(o.autoUpdate=t.autoUpdate);let u=t.levels;for(let d=0;d<u.length;d++){let p=u[d],x=o.getObjectByProperty("uuid",p.object);x!==void 0&&o.addLevel(x,p.distance,p.hysteresis)}}return o}bindSkeletons(t,e){Object.keys(e).length!==0&&t.traverse(function(n){if(n.isSkinnedMesh===!0&&n.skeleton!==void 0){let i=e[n.skeleton];i===void 0?St("ObjectLoader: No skeleton found with UUID:",n.skeleton):n.bind(i,n.bindMatrix)}})}bindLightTargets(t){t.traverse(function(e){if(e.isDirectionalLight||e.isSpotLight){let n=e.target,i=t.getObjectByProperty("uuid",n);i!==void 0?e.target=i:e.target=new ae}})}},by={UVMapping:il,CubeReflectionMapping:Zn,CubeRefractionMapping:Ci,EquirectangularReflectionMapping:Qr,EquirectangularRefractionMapping:jr,CubeUVReflectionMapping:Fs},Km={RepeatWrapping:In,ClampToEdgeWrapping:Ce,MirroredRepeatWrapping:_r},Qm={NearestFilter:Ie,NearestMipmapNearestFilter:_u,NearestMipmapLinearFilter:Os,LinearFilter:le,LinearMipmapNearestFilter:to,LinearMipmapLinearFilter:Ve},Af=new WeakMap,bh=class extends $e{constructor(t){super(t),this.isImageBitmapLoader=!0,typeof createImageBitmap>"u"&&St("ImageBitmapLoader: createImageBitmap() not supported."),typeof fetch>"u"&&St("ImageBitmapLoader: fetch() not supported."),this.options={premultiplyAlpha:"none"},this._abortController=new AbortController}setOptions(t){return this.options=t,this}load(t,e,n,i){t===void 0&&(t=""),this.path!==void 0&&(t=this.path+t),t=this.manager.resolveURL(t);let r=this,o=Gn.get(`image-bitmap:${t}`);if(o!==void 0){if(r.manager.itemStart(t),o.then){o.then(c=>{Af.has(o)===!0?(i&&i(Af.get(o)),r.manager.itemError(t),r.manager.itemEnd(t)):(e&&e(c),r.manager.itemEnd(t))});return}setTimeout(function(){e&&e(o),r.manager.itemEnd(t)},0);return}let a={};a.credentials=this.crossOrigin==="anonymous"?"same-origin":"include",a.headers=this.requestHeader,a.signal=typeof AbortSignal.any=="function"?AbortSignal.any([this._abortController.signal,this.manager.abortController.signal]):this._abortController.signal;let l=fetch(t,a).then(function(c){return c.blob()}).then(function(c){return createImageBitmap(c,Object.assign({},r.options,{colorSpaceConversion:"none"}))}).then(function(c){return Gn.add(`image-bitmap:${t}`,c),e&&e(c),r.manager.itemEnd(t),c}).catch(function(c){i&&i(c),Af.set(l,c),Gn.remove(`image-bitmap:${t}`),r.manager.itemError(t),r.manager.itemEnd(t)});Gn.add(`image-bitmap:${t}`,l),r.manager.itemStart(t)}abort(){return this._abortController.abort(),this._abortController=new AbortController,this}},Hc,Jr=class{static getContext(){return Hc===void 0&&(Hc=new(window.AudioContext||window.webkitAudioContext)),Hc}static setContext(t){Hc=t}},Eh=class extends $e{constructor(t){super(t)}load(t,e,n,i){let r=this,o=new Ln(this.manager);o.setResponseType("arraybuffer"),o.setPath(this.path),o.setRequestHeader(this.requestHeader),o.setWithCredentials(this.withCredentials),o.load(t,function(l){try{let c=l.slice(0),h=Jr.getContext(),f=t+"#decode";r.manager.itemStart(f),h.decodeAudioData(c,function(u){e(u),r.manager.itemEnd(f)}).catch(function(u){a(u),r.manager.itemEnd(f)})}catch(c){a(c)}},n,i);function a(l){i?i(l):Bt(l),r.manager.itemError(t)}}},jm=new Jt,t0=new Jt,fs=new Jt,Th=class{constructor(){this.type="StereoCamera",this.aspect=1,this.eyeSep=.064,this.cameraL=new Oe,this.cameraL.layers.enable(1),this.cameraL.matrixAutoUpdate=!1,this.cameraR=new Oe,this.cameraR.layers.enable(2),this.cameraR.matrixAutoUpdate=!1,this._cache={focus:null,fov:null,aspect:null,near:null,far:null,zoom:null,eyeSep:null}}update(t){let e=this._cache;if(e.focus!==t.focus||e.fov!==t.fov||e.aspect!==t.aspect*this.aspect||e.near!==t.near||e.far!==t.far||e.zoom!==t.zoom||e.eyeSep!==this.eyeSep){e.focus=t.focus,e.fov=t.fov,e.aspect=t.aspect*this.aspect,e.near=t.near,e.far=t.far,e.zoom=t.zoom,e.eyeSep=this.eyeSep,fs.copy(t.projectionMatrix);let i=e.eyeSep/2,r=i*e.near/e.focus,o=e.near*Math.tan(_s*e.fov*.5)/e.zoom,a,l;t0.elements[12]=-i,jm.elements[12]=i,a=-o*e.aspect+r,l=o*e.aspect+r,fs.elements[0]=2*e.near/(l-a),fs.elements[8]=(l+a)/(l-a),this.cameraL.projectionMatrix.copy(fs),a=-o*e.aspect-r,l=o*e.aspect-r,fs.elements[0]=2*e.near/(l-a),fs.elements[8]=(l+a)/(l-a),this.cameraR.projectionMatrix.copy(fs)}this.cameraL.matrix.copy(t.matrixWorld).multiply(t0),this.cameraL.matrixWorldNeedsUpdate=!0,this.cameraR.matrix.copy(t.matrixWorld).multiply(jm),this.cameraR.matrixWorldNeedsUpdate=!0}},fr=-90,dr=1,Ja=class extends ae{constructor(t,e,n){super(),this.type="CubeCamera",this.renderTarget=n,this.coordinateSystem=null,this.activeMipmapLevel=0;let i=new Oe(fr,dr,t,e);i.layers=this.layers,this.add(i);let r=new Oe(fr,dr,t,e);r.layers=this.layers,this.add(r);let o=new Oe(fr,dr,t,e);o.layers=this.layers,this.add(o);let a=new Oe(fr,dr,t,e);a.layers=this.layers,this.add(a);let l=new Oe(fr,dr,t,e);l.layers=this.layers,this.add(l);let c=new Oe(fr,dr,t,e);c.layers=this.layers,this.add(c)}updateCoordinateSystem(){let t=this.coordinateSystem,e=this.children.concat(),[n,i,r,o,a,l]=e;for(let c of e)this.remove(c);if(t===xn)n.up.set(0,1,0),n.lookAt(1,0,0),i.up.set(0,1,0),i.lookAt(-1,0,0),r.up.set(0,0,-1),r.lookAt(0,1,0),o.up.set(0,0,1),o.lookAt(0,-1,0),a.up.set(0,1,0),a.lookAt(0,0,1),l.up.set(0,1,0),l.lookAt(0,0,-1);else if(t===qi)n.up.set(0,-1,0),n.lookAt(-1,0,0),i.up.set(0,-1,0),i.lookAt(1,0,0),r.up.set(0,0,1),r.lookAt(0,1,0),o.up.set(0,0,-1),o.lookAt(0,-1,0),a.up.set(0,-1,0),a.lookAt(0,0,1),l.up.set(0,-1,0),l.lookAt(0,0,-1);else throw new Error("THREE.CubeCamera.updateCoordinateSystem(): Invalid coordinate system: "+t);for(let c of e)this.add(c),c.updateMatrixWorld()}update(t,e){this.parent===null&&this.updateMatrixWorld();let{renderTarget:n,activeMipmapLevel:i}=this;this.coordinateSystem!==t.coordinateSystem&&(this.coordinateSystem=t.coordinateSystem,this.updateCoordinateSystem());let[r,o,a,l,c,h]=this.children,f=t.getRenderTarget(),u=t.getActiveCubeFace(),d=t.getActiveMipmapLevel(),p=t.xr.enabled;t.xr.enabled=!1;let x=n.texture.generateMipmaps;n.texture.generateMipmaps=!1;let m=!1;t.isWebGLRenderer===!0?m=t.state.buffers.depth.getReversed():m=t.reversedDepthBuffer,t.setRenderTarget(n,0,i),m&&t.autoClear===!1&&t.clearDepth(),t.render(e,r),t.setRenderTarget(n,1,i),m&&t.autoClear===!1&&t.clearDepth(),t.render(e,o),t.setRenderTarget(n,2,i),m&&t.autoClear===!1&&t.clearDepth(),t.render(e,a),t.setRenderTarget(n,3,i),m&&t.autoClear===!1&&t.clearDepth(),t.render(e,l),t.setRenderTarget(n,4,i),m&&t.autoClear===!1&&t.clearDepth(),t.render(e,c),n.texture.generateMipmaps=x,t.setRenderTarget(n,5,i),m&&t.autoClear===!1&&t.clearDepth(),t.render(e,h),t.setRenderTarget(f,u,d),t.xr.enabled=p,n.texture.needsPMREMUpdate=!0}},$a=class extends Oe{constructor(t=[]){super(),this.isArrayCamera=!0,this.isMultiViewCamera=!1,this.cameras=t}},Ka=class{constructor(){this._previousTime=0,this._currentTime=0,this._startTime=performance.now(),this._delta=0,this._elapsed=0,this._timescale=1,this._document=null,this._pageVisibilityHandler=null}connect(t){this._document=t,t.hidden!==void 0&&(this._pageVisibilityHandler=Ey.bind(this),t.addEventListener("visibilitychange",this._pageVisibilityHandler,!1))}disconnect(){this._pageVisibilityHandler!==null&&(this._document.removeEventListener("visibilitychange",this._pageVisibilityHandler),this._pageVisibilityHandler=null),this._document=null}getDelta(){return this._delta/1e3}getElapsed(){return this._elapsed/1e3}getTimescale(){return this._timescale}setTimescale(t){return this._timescale=t,this}reset(){return this._currentTime=performance.now()-this._startTime,this}dispose(){this.disconnect()}update(t){return this._pageVisibilityHandler!==null&&this._document.hidden===!0?this._delta=0:(this._previousTime=this._currentTime,this._currentTime=(t!==void 0?t:performance.now())-this._startTime,this._delta=(this._currentTime-this._previousTime)*this._timescale,this._elapsed+=this._delta),this}};function Ey(){this._document.hidden===!1&&this.reset()}var ds=new P,Rf=new ze,Ty=new P,ps=new P,ms=new P,wh=class extends ae{constructor(){super(),this.type="AudioListener",this.context=Jr.getContext(),this.gain=this.context.createGain(),this.gain.connect(this.context.destination),this.filter=null,this.timeDelta=0,this._timer=new Ka}getInput(){return this.gain}removeFilter(){return this.filter!==null&&(this.gain.disconnect(this.filter),this.filter.disconnect(this.context.destination),this.gain.connect(this.context.destination),this.filter=null),this}getFilter(){return this.filter}setFilter(t){return this.filter!==null?(this.gain.disconnect(this.filter),this.filter.disconnect(this.context.destination)):this.gain.disconnect(this.context.destination),this.filter=t,this.gain.connect(this.filter),this.filter.connect(this.context.destination),this}getMasterVolume(){return this.gain.gain.value}setMasterVolume(t){return this.gain.gain.setTargetAtTime(t,this.context.currentTime,.01),this}updateMatrixWorld(t){super.updateMatrixWorld(t),this._timer.update();let e=this.context.listener;if(this.timeDelta=this._timer.getDelta(),this.matrixWorld.decompose(ds,Rf,Ty),ps.set(0,0,-1).applyQuaternion(Rf),ms.set(0,1,0).applyQuaternion(Rf),e.positionX){let n=this.context.currentTime+this.timeDelta;e.positionX.linearRampToValueAtTime(ds.x,n),e.positionY.linearRampToValueAtTime(ds.y,n),e.positionZ.linearRampToValueAtTime(ds.z,n),e.forwardX.linearRampToValueAtTime(ps.x,n),e.forwardY.linearRampToValueAtTime(ps.y,n),e.forwardZ.linearRampToValueAtTime(ps.z,n),e.upX.linearRampToValueAtTime(ms.x,n),e.upY.linearRampToValueAtTime(ms.y,n),e.upZ.linearRampToValueAtTime(ms.z,n)}else e.setPosition(ds.x,ds.y,ds.z),e.setOrientation(ps.x,ps.y,ps.z,ms.x,ms.y,ms.z)}},Qa=class extends ae{constructor(t){super(),this.type="Audio",this.listener=t,this.context=t.context,this.gain=this.context.createGain(),this.gain.connect(t.getInput()),this.autoplay=!1,this.buffer=null,this.detune=0,this.loop=!1,this.loopStart=0,this.loopEnd=0,this.offset=0,this.duration=void 0,this.playbackRate=1,this.isPlaying=!1,this.hasPlaybackControl=!0,this.source=null,this.sourceType="empty",this._startedAt=0,this._progress=0,this._connected=!1,this.filters=[]}getOutput(){return this.gain}setNodeSource(t){return this.hasPlaybackControl=!1,this.sourceType="audioNode",this.source=t,this.connect(),this}setMediaElementSource(t){return this.hasPlaybackControl=!1,this.sourceType="mediaNode",this.source=this.context.createMediaElementSource(t),this.connect(),this}setMediaStreamSource(t){return this.hasPlaybackControl=!1,this.sourceType="mediaStreamNode",this.source=this.context.createMediaStreamSource(t),this.connect(),this}setBuffer(t){return this.buffer=t,this.sourceType="buffer",this.autoplay&&this.play(),this}play(t=0){if(this.isPlaying===!0){St("Audio: Audio is already playing.");return}if(this.hasPlaybackControl===!1){St("Audio: this Audio has no playback control.");return}this._startedAt=this.context.currentTime+t;let e=this.context.createBufferSource();return e.buffer=this.buffer,e.loop=this.loop,e.loopStart=this.loopStart,e.loopEnd=this.loopEnd,e.onended=this.onEnded.bind(this),e.start(this._startedAt,this._progress+this.offset,this.duration),this.isPlaying=!0,this.source=e,this.setDetune(this.detune),this.setPlaybackRate(this.playbackRate),this.connect()}pause(){if(this.hasPlaybackControl===!1){St("Audio: this Audio has no playback control.");return}return this.isPlaying===!0&&(this._progress+=Math.max(this.context.currentTime-this._startedAt,0)*this.playbackRate,this.loop===!0&&(this._progress=this._progress%(this.duration||this.buffer.duration)),this.source.stop(),this.source.onended=null,this.isPlaying=!1),this}stop(t=0){if(this.hasPlaybackControl===!1){St("Audio: this Audio has no playback control.");return}return this._progress=0,this.source!==null&&(this.source.stop(this.context.currentTime+t),this.source.onended=null),this.isPlaying=!1,this}connect(){if(this.filters.length>0){this.source.connect(this.filters[0]);for(let t=1,e=this.filters.length;t<e;t++)this.filters[t-1].connect(this.filters[t]);this.filters[this.filters.length-1].connect(this.getOutput())}else this.source.connect(this.getOutput());return this._connected=!0,this}disconnect(){if(this._connected!==!1){if(this.filters.length>0){this.source.disconnect(this.filters[0]);for(let t=1,e=this.filters.length;t<e;t++)this.filters[t-1].disconnect(this.filters[t]);this.filters[this.filters.length-1].disconnect(this.getOutput())}else this.source.disconnect(this.getOutput());return this._connected=!1,this}}getFilters(){return this.filters}setFilters(t){return t||(t=[]),this._connected===!0?(this.disconnect(),this.filters=t.slice(),this.connect()):this.filters=t.slice(),this}setDetune(t){return this.detune=t,this.isPlaying===!0&&this.source.detune!==void 0&&this.source.detune.setTargetAtTime(this.detune,this.context.currentTime,.01),this}getDetune(){return this.detune}getFilter(){return this.getFilters()[0]}setFilter(t){return this.setFilters(t?[t]:[])}setPlaybackRate(t){if(this.hasPlaybackControl===!1){St("Audio: this Audio has no playback control.");return}return this.playbackRate=t,this.isPlaying===!0&&this.source.playbackRate.setTargetAtTime(this.playbackRate,this.context.currentTime,.01),this}getPlaybackRate(){return this.playbackRate}onEnded(){this.isPlaying=!1,this._progress=0}getLoop(){return this.hasPlaybackControl===!1?(St("Audio: this Audio has no playback control."),!1):this.loop}setLoop(t){if(this.hasPlaybackControl===!1){St("Audio: this Audio has no playback control.");return}return this.loop=t,this.isPlaying===!0&&(this.source.loop=this.loop),this}setLoopStart(t){return this.loopStart=t,this}setLoopEnd(t){return this.loopEnd=t,this}getVolume(){return this.gain.gain.value}setVolume(t){return this.gain.gain.setTargetAtTime(t,this.context.currentTime,.01),this}copy(t,e){return super.copy(t,e),t.sourceType!=="buffer"?(St("Audio: Audio source type cannot be copied."),this):(this.autoplay=t.autoplay,this.buffer=t.buffer,this.detune=t.detune,this.loop=t.loop,this.loopStart=t.loopStart,this.loopEnd=t.loopEnd,this.offset=t.offset,this.duration=t.duration,this.playbackRate=t.playbackRate,this.hasPlaybackControl=t.hasPlaybackControl,this.sourceType=t.sourceType,this.filters=t.filters.slice(),this)}clone(t){return new this.constructor(this.listener).copy(this,t)}},gs=new P,e0=new ze,wy=new P,xs=new P,Ah=class extends Qa{constructor(t){super(t),this.panner=this.context.createPanner(),this.panner.panningModel="HRTF",this.panner.connect(this.gain)}connect(){return super.connect(),this.panner.connect(this.gain),this}disconnect(){return super.disconnect(),this.panner.disconnect(this.gain),this}getOutput(){return this.panner}getRefDistance(){return this.panner.refDistance}setRefDistance(t){return this.panner.refDistance=t,this}getRolloffFactor(){return this.panner.rolloffFactor}setRolloffFactor(t){return this.panner.rolloffFactor=t,this}getDistanceModel(){return this.panner.distanceModel}setDistanceModel(t){return this.panner.distanceModel=t,this}getMaxDistance(){return this.panner.maxDistance}setMaxDistance(t){return this.panner.maxDistance=t,this}setDirectionalCone(t,e,n){return this.panner.coneInnerAngle=t,this.panner.coneOuterAngle=e,this.panner.coneOuterGain=n,this}updateMatrixWorld(t){if(super.updateMatrixWorld(t),this.hasPlaybackControl===!0&&this.isPlaying===!1)return;this.matrixWorld.decompose(gs,e0,wy),xs.set(0,0,1).applyQuaternion(e0);let e=this.panner;if(e.positionX){let n=this.context.currentTime+this.listener.timeDelta;e.positionX.linearRampToValueAtTime(gs.x,n),e.positionY.linearRampToValueAtTime(gs.y,n),e.positionZ.linearRampToValueAtTime(gs.z,n),e.orientationX.linearRampToValueAtTime(xs.x,n),e.orientationY.linearRampToValueAtTime(xs.y,n),e.orientationZ.linearRampToValueAtTime(xs.z,n)}else e.setPosition(gs.x,gs.y,gs.z),e.setOrientation(xs.x,xs.y,xs.z)}},Rh=class{constructor(t,e=2048){this.analyser=t.context.createAnalyser(),this.analyser.fftSize=e,this.data=new Uint8Array(this.analyser.frequencyBinCount),t.getOutput().connect(this.analyser)}getFrequencyData(){return this.analyser.getByteFrequencyData(this.data),this.data}getAverageFrequency(){let t=0,e=this.getFrequencyData();for(let n=0;n<e.length;n++)t+=e[n];return t/e.length}},ja=class{constructor(t,e,n){this.binding=t,this.valueSize=n;let i,r,o;switch(e){case"quaternion":i=this._slerp,r=this._slerpAdditive,o=this._setAdditiveIdentityQuaternion,this.buffer=new Float64Array(n*6),this._workIndex=5;break;case"string":case"bool":i=this._select,r=this._select,o=this._setAdditiveIdentityOther,this.buffer=new Array(n*5);break;default:i=this._lerp,r=this._lerpAdditive,o=this._setAdditiveIdentityNumeric,this.buffer=new Float64Array(n*5)}this._mixBufferRegion=i,this._mixBufferRegionAdditive=r,this._setIdentity=o,this._origIndex=3,this._addIndex=4,this.cumulativeWeight=0,this.cumulativeWeightAdditive=0,this.useCount=0,this.referenceCount=0}accumulate(t,e){let n=this.buffer,i=this.valueSize,r=t*i+i,o=this.cumulativeWeight;if(o===0){for(let a=0;a!==i;++a)n[r+a]=n[a];o=e}else{o+=e;let a=e/o;this._mixBufferRegion(n,r,0,a,i)}this.cumulativeWeight=o}accumulateAdditive(t){let e=this.buffer,n=this.valueSize,i=n*this._addIndex;this.cumulativeWeightAdditive===0&&this._setIdentity(),this._mixBufferRegionAdditive(e,i,0,t,n),this.cumulativeWeightAdditive+=t}apply(t){let e=this.valueSize,n=this.buffer,i=t*e+e,r=this.cumulativeWeight,o=this.cumulativeWeightAdditive,a=this.binding;if(this.cumulativeWeight=0,this.cumulativeWeightAdditive=0,r<1){let l=e*this._origIndex;this._mixBufferRegion(n,i,l,1-r,e)}o>0&&this._mixBufferRegionAdditive(n,i,this._addIndex*e,1,e);for(let l=e,c=e+e;l!==c;++l)if(n[l]!==n[l+e]){a.setValue(n,i);break}}saveOriginalState(){let t=this.binding,e=this.buffer,n=this.valueSize,i=n*this._origIndex;t.getValue(e,i);for(let r=n,o=i;r!==o;++r)e[r]=e[i+r%n];this._setIdentity(),this.cumulativeWeight=0,this.cumulativeWeightAdditive=0}restoreOriginalState(){let t=this.valueSize*3;this.binding.setValue(this.buffer,t)}_setAdditiveIdentityNumeric(){let t=this._addIndex*this.valueSize,e=t+this.valueSize;for(let n=t;n<e;n++)this.buffer[n]=0}_setAdditiveIdentityQuaternion(){this._setAdditiveIdentityNumeric(),this.buffer[this._addIndex*this.valueSize+3]=1}_setAdditiveIdentityOther(){let t=this._origIndex*this.valueSize,e=this._addIndex*this.valueSize;for(let n=0;n<this.valueSize;n++)this.buffer[e+n]=this.buffer[t+n]}_select(t,e,n,i,r){if(i>=.5)for(let o=0;o!==r;++o)t[e+o]=t[n+o]}_slerp(t,e,n,i){ze.slerpFlat(t,e,t,e,t,n,i)}_slerpAdditive(t,e,n,i,r){let o=this._workIndex*r;ze.multiplyQuaternionsFlat(t,o,t,e,t,n),ze.slerpFlat(t,e,t,e,t,o,i)}_lerp(t,e,n,i,r){let o=1-i;for(let a=0;a!==r;++a){let l=e+a;t[l]=t[l]*o+t[n+a]*i}}_lerpAdditive(t,e,n,i,r){for(let o=0;o!==r;++o){let a=e+o;t[a]=t[a]+t[n+o]*i}}},Ud="\\[\\]\\.:\\/",Ay=new RegExp("["+Ud+"]","g"),Fd="[^"+Ud+"]",Ry="[^"+Ud.replace("\\.","")+"]",Cy=/((?:WC+[\/:])*)/.source.replace("WC",Fd),Iy=/(WCOD+)?/.source.replace("WCOD",Ry),Py=/(?:\.(WC+)(?:\[(.+)\])?)?/.source.replace("WC",Fd),Ly=/\.(WC+)(?:\[(.+)\])?/.source.replace("WC",Fd),Dy=new RegExp("^"+Cy+Iy+Py+Ly+"$"),Ny=["material","materials","bones","map"],Vf=class{constructor(t,e,n){let i=n||me.parseTrackName(e);this._targetGroup=t,this._bindings=t.subscribe_(e,i)}getValue(t,e){this.bind();let n=this._targetGroup.nCachedObjects_,i=this._bindings[n];i!==void 0&&i.getValue(t,e)}setValue(t,e){let n=this._bindings;for(let i=this._targetGroup.nCachedObjects_,r=n.length;i!==r;++i)n[i].setValue(t,e)}bind(){let t=this._bindings;for(let e=this._targetGroup.nCachedObjects_,n=t.length;e!==n;++e)t[e].bind()}unbind(){let t=this._bindings;for(let e=this._targetGroup.nCachedObjects_,n=t.length;e!==n;++e)t[e].unbind()}},me=class s{constructor(t,e,n){this.path=e,this.parsedPath=n||s.parseTrackName(e),this.node=s.findNode(t,this.parsedPath.nodeName),this.rootNode=t,this.getValue=this._getValue_unbound,this.setValue=this._setValue_unbound}static create(t,e,n){return t&&t.isAnimationObjectGroup?new s.Composite(t,e,n):new s(t,e,n)}static sanitizeNodeName(t){return t.replace(/\s/g,"_").replace(Ay,"")}static parseTrackName(t){let e=Dy.exec(t);if(e===null)throw new Error("THREE.PropertyBinding: Cannot parse trackName: "+t);let n={nodeName:e[2],objectName:e[3],objectIndex:e[4],propertyName:e[5],propertyIndex:e[6]},i=n.nodeName&&n.nodeName.lastIndexOf(".");if(i!==void 0&&i!==-1){let r=n.nodeName.substring(i+1);Ny.indexOf(r)!==-1&&(n.nodeName=n.nodeName.substring(0,i),n.objectName=r)}if(n.propertyName===null||n.propertyName.length===0)throw new Error("THREE.PropertyBinding: can not parse propertyName from trackName: "+t);return n}static findNode(t,e){if(e===void 0||e===""||e==="."||e===-1||e===t.name||e===t.uuid)return t;if(t.skeleton){let n=t.skeleton.getBoneByName(e);if(n!==void 0)return n}if(t.children){let n=function(r){for(let o=0;o<r.length;o++){let a=r[o];if(a.name===e||a.uuid===e)return a;let l=n(a.children);if(l)return l}return null},i=n(t.children);if(i)return i}return null}_getValue_unavailable(){}_setValue_unavailable(){}_getValue_direct(t,e){t[e]=this.targetObject[this.propertyName]}_getValue_array(t,e){let n=this.resolvedProperty;for(let i=0,r=n.length;i!==r;++i)t[e++]=n[i]}_getValue_arrayElement(t,e){t[e]=this.resolvedProperty[this.propertyIndex]}_getValue_toArray(t,e){this.resolvedProperty.toArray(t,e)}_setValue_direct(t,e){this.targetObject[this.propertyName]=t[e]}_setValue_direct_setNeedsUpdate(t,e){this.targetObject[this.propertyName]=t[e],this.targetObject.needsUpdate=!0}_setValue_direct_setMatrixWorldNeedsUpdate(t,e){this.targetObject[this.propertyName]=t[e],this.targetObject.matrixWorldNeedsUpdate=!0}_setValue_array(t,e){let n=this.resolvedProperty;for(let i=0,r=n.length;i!==r;++i)n[i]=t[e++]}_setValue_array_setNeedsUpdate(t,e){let n=this.resolvedProperty;for(let i=0,r=n.length;i!==r;++i)n[i]=t[e++];this.targetObject.needsUpdate=!0}_setValue_array_setMatrixWorldNeedsUpdate(t,e){let n=this.resolvedProperty;for(let i=0,r=n.length;i!==r;++i)n[i]=t[e++];this.targetObject.matrixWorldNeedsUpdate=!0}_setValue_arrayElement(t,e){this.resolvedProperty[this.propertyIndex]=t[e]}_setValue_arrayElement_setNeedsUpdate(t,e){this.resolvedProperty[this.propertyIndex]=t[e],this.targetObject.needsUpdate=!0}_setValue_arrayElement_setMatrixWorldNeedsUpdate(t,e){this.resolvedProperty[this.propertyIndex]=t[e],this.targetObject.matrixWorldNeedsUpdate=!0}_setValue_fromArray(t,e){this.resolvedProperty.fromArray(t,e)}_setValue_fromArray_setNeedsUpdate(t,e){this.resolvedProperty.fromArray(t,e),this.targetObject.needsUpdate=!0}_setValue_fromArray_setMatrixWorldNeedsUpdate(t,e){this.resolvedProperty.fromArray(t,e),this.targetObject.matrixWorldNeedsUpdate=!0}_getValue_unbound(t,e){this.bind(),this.getValue(t,e)}_setValue_unbound(t,e){this.bind(),this.setValue(t,e)}bind(){let t=this.node,e=this.parsedPath,n=e.objectName,i=e.propertyName,r=e.propertyIndex;if(t||(t=s.findNode(this.rootNode,e.nodeName),this.node=t),this.getValue=this._getValue_unavailable,this.setValue=this._setValue_unavailable,!t){St("PropertyBinding: No target node found for track: "+this.path+".");return}if(n){let c=e.objectIndex;switch(n){case"materials":if(!t.material){Bt("PropertyBinding: Can not bind to material as node does not have a material.",this);return}if(!t.material.materials){Bt("PropertyBinding: Can not bind to material.materials as node.material does not have a materials array.",this);return}t=t.material.materials;break;case"bones":if(!t.skeleton){Bt("PropertyBinding: Can not bind to bones as node does not have a skeleton.",this);return}t=t.skeleton.bones;for(let h=0;h<t.length;h++)if(t[h].name===c){c=h;break}break;case"map":if("map"in t){t=t.map;break}if(!t.material){Bt("PropertyBinding: Can not bind to material as node does not have a material.",this);return}if(!t.material.map){Bt("PropertyBinding: Can not bind to material.map as node.material does not have a map.",this);return}t=t.material.map;break;default:if(t[n]===void 0){Bt("PropertyBinding: Can not bind to objectName of node undefined.",this);return}t=t[n]}if(c!==void 0){if(t[c]===void 0){Bt("PropertyBinding: Trying to bind to objectIndex of objectName, but is undefined.",this,t);return}t=t[c]}}let o=t[i];if(o===void 0){let c=e.nodeName;Bt("PropertyBinding: Trying to update property for track: "+c+"."+i+" but it wasn't found.",t);return}let a=this.Versioning.None;this.targetObject=t,t.isMaterial===!0?a=this.Versioning.NeedsUpdate:t.isObject3D===!0&&(a=this.Versioning.MatrixWorldNeedsUpdate);let l=this.BindingType.Direct;if(r!==void 0){if(i==="morphTargetInfluences"){if(!t.geometry){Bt("PropertyBinding: Can not bind to morphTargetInfluences because node does not have a geometry.",this);return}if(!t.geometry.morphAttributes){Bt("PropertyBinding: Can not bind to morphTargetInfluences because node does not have a geometry.morphAttributes.",this);return}t.morphTargetDictionary[r]!==void 0&&(r=t.morphTargetDictionary[r])}l=this.BindingType.ArrayElement,this.resolvedProperty=o,this.propertyIndex=r}else o.fromArray!==void 0&&o.toArray!==void 0?(l=this.BindingType.HasFromToArray,this.resolvedProperty=o):Array.isArray(o)?(l=this.BindingType.EntireArray,this.resolvedProperty=o):this.propertyName=i;this.getValue=this.GetterByBindingType[l],this.setValue=this.SetterByBindingTypeAndVersioning[l][a]}unbind(){this.node=null,this.getValue=this._getValue_unbound,this.setValue=this._setValue_unbound}};me.Composite=Vf;me.prototype.BindingType={Direct:0,EntireArray:1,ArrayElement:2,HasFromToArray:3};me.prototype.Versioning={None:0,NeedsUpdate:1,MatrixWorldNeedsUpdate:2};me.prototype.GetterByBindingType=[me.prototype._getValue_direct,me.prototype._getValue_array,me.prototype._getValue_arrayElement,me.prototype._getValue_toArray];me.prototype.SetterByBindingTypeAndVersioning=[[me.prototype._setValue_direct,me.prototype._setValue_direct_setNeedsUpdate,me.prototype._setValue_direct_setMatrixWorldNeedsUpdate],[me.prototype._setValue_array,me.prototype._setValue_array_setNeedsUpdate,me.prototype._setValue_array_setMatrixWorldNeedsUpdate],[me.prototype._setValue_arrayElement,me.prototype._setValue_arrayElement_setNeedsUpdate,me.prototype._setValue_arrayElement_setMatrixWorldNeedsUpdate],[me.prototype._setValue_fromArray,me.prototype._setValue_fromArray_setNeedsUpdate,me.prototype._setValue_fromArray_setMatrixWorldNeedsUpdate]];var Ch=class{constructor(){this.isAnimationObjectGroup=!0,this.uuid=Sn(),this._objects=Array.prototype.slice.call(arguments),this.nCachedObjects_=0;let t={};this._indicesByUUID=t;for(let n=0,i=arguments.length;n!==i;++n)t[arguments[n].uuid]=n;this._paths=[],this._parsedPaths=[],this._bindings=[],this._bindingsIndicesByPath={};let e=this;this.stats={objects:{get total(){return e._objects.length},get inUse(){return this.total-e.nCachedObjects_}},get bindingsPerObject(){return e._bindings.length}}}add(){let t=this._objects,e=this._indicesByUUID,n=this._paths,i=this._parsedPaths,r=this._bindings,o=r.length,a,l=t.length,c=this.nCachedObjects_;for(let h=0,f=arguments.length;h!==f;++h){let u=arguments[h],d=u.uuid,p=e[d];if(p===void 0){p=l++,e[d]=p,t.push(u);for(let x=0,m=o;x!==m;++x)r[x].push(new me(u,n[x],i[x]))}else if(p<c){a=t[p];let x=--c,m=t[x];e[m.uuid]=p,t[p]=m,e[d]=x,t[x]=u;for(let g=0,v=o;g!==v;++g){let b=r[g],y=b[x],M=b[p];b[p]=y,M===void 0&&(M=new me(u,n[g],i[g])),b[x]=M}}else t[p]!==a&&Bt("AnimationObjectGroup: Different objects with the same UUID detected. Clean the caches or recreate your infrastructure when reloading scenes.")}this.nCachedObjects_=c}remove(){let t=this._objects,e=this._indicesByUUID,n=this._bindings,i=n.length,r=this.nCachedObjects_;for(let o=0,a=arguments.length;o!==a;++o){let l=arguments[o],c=l.uuid,h=e[c];if(h!==void 0&&h>=r){let f=r++,u=t[f];e[u.uuid]=h,t[h]=u,e[c]=f,t[f]=l;for(let d=0,p=i;d!==p;++d){let x=n[d],m=x[f],g=x[h];x[h]=m,x[f]=g}}}this.nCachedObjects_=r}uncache(){let t=this._objects,e=this._indicesByUUID,n=this._bindings,i=n.length,r=this.nCachedObjects_,o=t.length;for(let a=0,l=arguments.length;a!==l;++a){let c=arguments[a],h=c.uuid,f=e[h];if(f!==void 0)if(delete e[h],f<r){let u=--r,d=t[u],p=--o,x=t[p];f!==u&&(e[d.uuid]=f),t[f]=d,u!==p&&(e[x.uuid]=u),t[u]=x,t.pop();for(let m=0,g=i;m!==g;++m){let v=n[m],b=v[u],y=v[p];v[f]=b,v[u]=y,v.pop()}}else{let u=--o,d=t[u];f!==u&&(e[d.uuid]=f),t[f]=d,t.pop();for(let p=0,x=i;p!==x;++p){let m=n[p];m[f]=m[u],m.pop()}}}this.nCachedObjects_=r}subscribe_(t,e){let n=this._bindingsIndicesByPath,i=n[t],r=this._bindings;if(i!==void 0)return r[i];let o=this._paths,a=this._parsedPaths,l=this._objects,c=l.length,h=this.nCachedObjects_,f=new Array(c);i=r.length,n[t]=i,o.push(t),a.push(e),r.push(f);for(let u=h,d=l.length;u!==d;++u){let p=l[u];f[u]=new me(p,t,e)}return f}unsubscribe_(t){let e=this._bindingsIndicesByPath,n=e[t];if(n!==void 0){let i=this._paths,r=this._parsedPaths,o=this._bindings,a=o.length-1,l=o[a],c=i[a];e[c]=n,o[n]=l,o.pop(),r[n]=r[a],r.pop(),i[n]=i[a],i.pop()}}},tl=class{constructor(t,e,n=null,i=e.blendMode){this._mixer=t,this._clip=e,this._localRoot=n,this.blendMode=i;let r=e.tracks,o=r.length,a=new Array(o),l={endingStart:Wi,endingEnd:Wi};for(let c=0;c!==o;++c){let h=r[c].createInterpolant(null);a[c]=h,h.settings=l}this._interpolantSettings=l,this._interpolants=a,this._propertyBindings=new Array(o),this._cacheIndex=null,this._byClipCacheIndex=null,this._timeScaleInterpolant=null,this._restoreTimeScale=null,this._weightInterpolant=null,this.loop=md,this._loopCount=-1,this._startTime=null,this.time=0,this.timeScale=1,this._effectiveTimeScale=1,this.weight=1,this._effectiveWeight=1,this.repetitions=1/0,this.paused=!1,this.enabled=!0,this.clampWhenFinished=!1,this.zeroSlopeAtStart=!0,this.zeroSlopeAtEnd=!0}play(){return this._mixer._activateAction(this),this}stop(){return this._mixer._deactivateAction(this),this.reset()}reset(){return this.paused=!1,this.enabled=!0,this.time=0,this._loopCount=-1,this._startTime=null,this.stopFading().stopWarping()}isRunning(){return this.enabled&&!this.paused&&this.timeScale!==0&&this._startTime===null&&this._mixer._isActiveAction(this)}isScheduled(){return this._mixer._isActiveAction(this)}startAt(t){return this._startTime=t,this}setLoop(t,e){return this.loop=t,this.repetitions=e,this}setEffectiveWeight(t){return this.weight=t,this._effectiveWeight=this.enabled?t:0,this.stopFading()}getEffectiveWeight(){return this._effectiveWeight}fadeIn(t){return this._scheduleFading(t,0,1)}fadeOut(t){return this._scheduleFading(t,1,0)}crossFadeFrom(t,e,n=!1){if(t.fadeOut(e),this.fadeIn(e),n===!0){let i=this._clip.duration,r=t._clip.duration,o=r/i,a=i/r;t._restoreTimeScale=t.timeScale,this._restoreTimeScale=this.timeScale,t.warp(1,o,e),this.warp(a,1,e)}return this}crossFadeTo(t,e,n=!1){return t.crossFadeFrom(this,e,n)}stopFading(){let t=this._weightInterpolant;return t!==null&&(this._weightInterpolant=null,this._mixer._takeBackControlInterpolant(t)),this}setEffectiveTimeScale(t){return this.timeScale=t,this._effectiveTimeScale=this.paused?0:t,this.stopWarping()}getEffectiveTimeScale(){return this._effectiveTimeScale}setDuration(t){return this.timeScale=this._clip.duration/t,this.stopWarping()}syncWith(t){return this.time=t.time,this.timeScale=t.timeScale,this.stopWarping()}halt(t){return this.warp(this._effectiveTimeScale,0,t)}warp(t,e,n){let i=this._mixer,r=i.time,o=this.timeScale,a=this._timeScaleInterpolant;a===null&&(a=i._lendControlInterpolant(),this._timeScaleInterpolant=a);let l=a.parameterPositions,c=a.sampleValues;return l[0]=r,l[1]=r+n,c[0]=t/o,c[1]=e/o,this}stopWarping(){let t=this._timeScaleInterpolant;return t!==null&&(this._timeScaleInterpolant=null,this._mixer._takeBackControlInterpolant(t)),this._restoreTimeScale=null,this}getMixer(){return this._mixer}getClip(){return this._clip}getRoot(){return this._localRoot||this._mixer._root}_update(t,e,n,i){if(!this.enabled){this._updateWeight(t);return}let r=this._startTime;if(r!==null){let l=(t-r)*n;l<0||n===0?e=0:(this._startTime=null,e=n*l)}e*=this._updateTimeScale(t);let o=this._updateTime(e),a=this._updateWeight(t);if(a>0){let l=this._interpolants,c=this._propertyBindings;switch(this.blendMode){case Tu:for(let h=0,f=l.length;h!==f;++h)l[h].evaluate(o),c[h].accumulateAdditive(a);break;case kl:default:for(let h=0,f=l.length;h!==f;++h)l[h].evaluate(o),c[h].accumulate(i,a)}}}_updateWeight(t){let e=0;if(this.enabled){e=this.weight;let n=this._weightInterpolant;if(n!==null){let i=n.evaluate(t)[0];e*=i,t>n.parameterPositions[1]&&(this.stopFading(),i===0&&(this.enabled=!1))}}return this._effectiveWeight=e,e}_updateTimeScale(t){let e=0;if(!this.paused){e=this.timeScale;let n=this._timeScaleInterpolant;if(n!==null){let i=n.evaluate(t)[0];e*=i,t>n.parameterPositions[1]&&(e===0?this.paused=!0:(this._restoreTimeScale!==null&&(e=this._restoreTimeScale),this.timeScale=e),this.stopWarping())}}return this._effectiveTimeScale=e,e}_updateTime(t){let e=this._clip.duration,n=this.loop,i=this.time+t,r=this._loopCount,o=n===gd;if(t===0)return r===-1?i:o&&(r&1)===1?e-i:i;if(n===pd){r===-1&&(this._loopCount=0,this._setEndings(!0,!0,!1));t:{if(i>=e)i=e;else if(i<0)i=0;else{this.time=i;break t}this.clampWhenFinished?this.paused=!0:this.enabled=!1,this.time=i,this._mixer.dispatchEvent({type:"finished",action:this,direction:t<0?-1:1})}}else{if(r===-1&&(t>=0?(r=0,this._setEndings(!0,this.repetitions===0,o)):this._setEndings(this.repetitions===0,!0,o)),i>=e||i<0){let a=Math.floor(i/e);i-=e*a,r+=Math.abs(a);let l=this.repetitions-r;if(l<=0)this.clampWhenFinished?this.paused=!0:this.enabled=!1,i=t>0?e:0,this.time=i,this._mixer.dispatchEvent({type:"finished",action:this,direction:t>0?1:-1});else{if(l===1){let c=t<0;this._setEndings(c,!c,o)}else this._setEndings(!1,!1,o);this._loopCount=r,this.time=i,this._mixer.dispatchEvent({type:"loop",action:this,loopDelta:a})}}else this._loopCount=r,this.time=i;if(o&&(r&1)===1)return e-i}return i}_setEndings(t,e,n){let i=this._interpolantSettings;n?(i.endingStart=Xi,i.endingEnd=Xi):(t?i.endingStart=this.zeroSlopeAtStart?Xi:Wi:i.endingStart=vr,e?i.endingEnd=this.zeroSlopeAtEnd?Xi:Wi:i.endingEnd=vr)}_scheduleFading(t,e,n){let i=this._mixer,r=i.time,o=this._weightInterpolant;o===null&&(o=i._lendControlInterpolant(),this._weightInterpolant=o);let a=o.parameterPositions,l=o.sampleValues;return a[0]=r,l[0]=e,a[1]=r+t,l[1]=n,this}},Uy=new Float32Array(1),Ih=class extends _n{constructor(t){super(),this._root=t,this._initMemoryManager(),this._accuIndex=0,this.time=0,this.timeScale=1,typeof __THREE_DEVTOOLS__<"u"&&__THREE_DEVTOOLS__.dispatchEvent(new CustomEvent("observe",{detail:this}))}_bindAction(t,e){let n=t._localRoot||this._root,i=t._clip.tracks,r=i.length,o=t._propertyBindings,a=t._interpolants,l=n.uuid,c=this._bindingsByRootAndName,h=c[l];h===void 0&&(h={},c[l]=h);for(let f=0;f!==r;++f){let u=i[f],d=u.name,p=h[d];if(p!==void 0)++p.referenceCount,o[f]=p;else{if(p=o[f],p!==void 0){p._cacheIndex===null&&(++p.referenceCount,this._addInactiveBinding(p,l,d));continue}let x=e&&e._propertyBindings[f].binding.parsedPath;p=new ja(me.create(n,d,x),u.ValueTypeName,u.getValueSize()),++p.referenceCount,this._addInactiveBinding(p,l,d),o[f]=p}a[f].resultBuffer=p.buffer}}_activateAction(t){if(!this._isActiveAction(t)){if(t._cacheIndex===null){let n=(t._localRoot||this._root).uuid,i=t._clip.uuid,r=this._actionsByClip[i];this._bindAction(t,r&&r.knownActions[0]),this._addInactiveAction(t,i,n)}let e=t._propertyBindings;for(let n=0,i=e.length;n!==i;++n){let r=e[n];r.useCount++===0&&(this._lendBinding(r),r.saveOriginalState())}this._lendAction(t)}}_deactivateAction(t){if(this._isActiveAction(t)){let e=t._propertyBindings;for(let n=0,i=e.length;n!==i;++n){let r=e[n];--r.useCount===0&&(r.restoreOriginalState(),this._takeBackBinding(r))}this._takeBackAction(t)}}_initMemoryManager(){this._actions=[],this._nActiveActions=0,this._actionsByClip={},this._bindings=[],this._nActiveBindings=0,this._bindingsByRootAndName={},this._controlInterpolants=[],this._nActiveControlInterpolants=0;let t=this;this.stats={actions:{get total(){return t._actions.length},get inUse(){return t._nActiveActions}},bindings:{get total(){return t._bindings.length},get inUse(){return t._nActiveBindings}},controlInterpolants:{get total(){return t._controlInterpolants.length},get inUse(){return t._nActiveControlInterpolants}}}}_isActiveAction(t){let e=t._cacheIndex;return e!==null&&e<this._nActiveActions}_addInactiveAction(t,e,n){let i=this._actions,r=this._actionsByClip,o=r[e];if(o===void 0)o={knownActions:[t],actionByRoot:{}},t._byClipCacheIndex=0,r[e]=o;else{let a=o.knownActions;t._byClipCacheIndex=a.length,a.push(t)}t._cacheIndex=i.length,i.push(t),o.actionByRoot[n]=t}_removeInactiveAction(t){let e=this._actions,n=e[e.length-1],i=t._cacheIndex;n._cacheIndex=i,e[i]=n,e.pop(),t._cacheIndex=null;let r=t._clip.uuid,o=this._actionsByClip,a=o[r],l=a.knownActions,c=l[l.length-1],h=t._byClipCacheIndex;c._byClipCacheIndex=h,l[h]=c,l.pop(),t._byClipCacheIndex=null;let f=a.actionByRoot,u=(t._localRoot||this._root).uuid;delete f[u],l.length===0&&delete o[r],this._removeInactiveBindingsForAction(t)}_removeInactiveBindingsForAction(t){let e=t._propertyBindings;for(let n=0,i=e.length;n!==i;++n){let r=e[n];--r.referenceCount===0&&this._removeInactiveBinding(r)}}_lendAction(t){let e=this._actions,n=t._cacheIndex,i=this._nActiveActions++,r=e[i];t._cacheIndex=i,e[i]=t,r._cacheIndex=n,e[n]=r}_takeBackAction(t){let e=this._actions,n=t._cacheIndex,i=--this._nActiveActions,r=e[i];t._cacheIndex=i,e[i]=t,r._cacheIndex=n,e[n]=r}_addInactiveBinding(t,e,n){let i=this._bindingsByRootAndName,r=this._bindings,o=i[e];o===void 0&&(o={},i[e]=o),o[n]=t,t._cacheIndex=r.length,r.push(t)}_removeInactiveBinding(t){let e=this._bindings,n=t.binding,i=n.rootNode.uuid,r=n.path,o=this._bindingsByRootAndName,a=o[i],l=e[e.length-1],c=t._cacheIndex;l._cacheIndex=c,e[c]=l,e.pop(),delete a[r],Object.keys(a).length===0&&delete o[i]}_lendBinding(t){let e=this._bindings,n=t._cacheIndex,i=this._nActiveBindings++,r=e[i];t._cacheIndex=i,e[i]=t,r._cacheIndex=n,e[n]=r}_takeBackBinding(t){let e=this._bindings,n=t._cacheIndex,i=--this._nActiveBindings,r=e[i];t._cacheIndex=i,e[i]=t,r._cacheIndex=n,e[n]=r}_lendControlInterpolant(){let t=this._controlInterpolants,e=this._nActiveControlInterpolants++,n=t[e];return n===void 0&&(n=new Hr(new Float32Array(2),new Float32Array(2),1,Uy),n.__cacheIndex=e,t[e]=n),n}_takeBackControlInterpolant(t){let e=this._controlInterpolants,n=t.__cacheIndex,i=--this._nActiveControlInterpolants,r=e[i];t.__cacheIndex=i,e[i]=t,r.__cacheIndex=n,e[n]=r}clipAction(t,e,n){let i=e||this._root,r=i.uuid,o=typeof t=="string"?ji.findByName(i,t):t,a=o!==null?o.uuid:t,l=this._actionsByClip[a],c=null;if(n===void 0&&(o!==null?n=o.blendMode:n=kl),l!==void 0){let f=l.actionByRoot[r];if(f!==void 0&&f.blendMode===n)return f;c=l.knownActions[0],o===null&&(o=c._clip)}if(o===null)return null;let h=new tl(this,o,e,n);return this._bindAction(h,c),this._addInactiveAction(h,a,r),h}existingAction(t,e){let n=e||this._root,i=n.uuid,r=typeof t=="string"?ji.findByName(n,t):t,o=r?r.uuid:t,a=this._actionsByClip[o];return a!==void 0&&a.actionByRoot[i]||null}stopAllAction(){let t=this._actions,e=this._nActiveActions;for(let n=e-1;n>=0;--n)t[n].stop();return this}update(t){t*=this.timeScale;let e=this._actions,n=this._nActiveActions,i=this.time+=t,r=Math.sign(t),o=this._accuIndex^=1;for(let c=0;c!==n;++c)e[c]._update(i,t,r,o);let a=this._bindings,l=this._nActiveBindings;for(let c=0;c!==l;++c)a[c].apply(o);return this}setTime(t){this.time=0;for(let e=0;e<this._actions.length;e++)this._actions[e].time=0;return this.update(t)}getRoot(){return this._root}uncacheClip(t){let e=this._actions,n=t.uuid,i=this._actionsByClip,r=i[n];if(r!==void 0){let o=r.knownActions;for(let a=0,l=o.length;a!==l;++a){let c=o[a];this._deactivateAction(c);let h=c._cacheIndex,f=e[e.length-1];c._cacheIndex=null,c._byClipCacheIndex=null,f._cacheIndex=h,e[h]=f,e.pop(),this._removeInactiveBindingsForAction(c)}delete i[n]}}uncacheRoot(t){let e=t.uuid,n=this._actionsByClip;for(let o in n){let a=n[o].actionByRoot,l=a[e];l!==void 0&&(this._deactivateAction(l),this._removeInactiveAction(l))}let i=this._bindingsByRootAndName,r=i[e];if(r!==void 0)for(let o in r){let a=r[o];a.restoreOriginalState(),this._removeInactiveBinding(a)}}uncacheAction(t,e){let n=this.existingAction(t,e);n!==null&&(this._deactivateAction(n),this._removeInactiveAction(n))}},Ph=class extends Tr{constructor(t=1,e=1,n=1,i={}){super(t,e,i),this.isRenderTarget3D=!0,this.depth=n;for(let r=0;r<this.textures.length;r++){let o=new Ss(null,t,e,n);o.isRenderTargetTexture=!0,o.renderTarget=this,this.textures[r]=o}this._setTextureOptions(i)}},Lh=class s{constructor(t){this.value=t}clone(){return new s(this.value.clone===void 0?this.value:this.value.clone())}},Fy=0,Dh=class extends _n{constructor(){super(),this.isUniformsGroup=!0,Object.defineProperty(this,"id",{value:Fy++}),this.name="",this.usage=Hl,this.uniforms=[]}add(t){return this.uniforms.push(t),this}remove(t){let e=this.uniforms.indexOf(t);return e!==-1&&this.uniforms.splice(e,1),this}setName(t){return this.name=t,this}setUsage(t){return this.usage=t,this}dispose(){this.dispatchEvent({type:"dispose"})}copy(t){this.name=t.name,this.usage=t.usage;let e=t.uniforms;this.uniforms.length=0;for(let n=0,i=e.length;n<i;n++){let r=Array.isArray(e[n])?e[n]:[e[n]];for(let o=0;o<r.length;o++)this.uniforms.push(r[o].clone())}return this}clone(){return new this.constructor().copy(this)}},Nh=class extends Zi{constructor(t,e,n=1){super(t,e),this.isInstancedInterleavedBuffer=!0,this.meshPerAttribute=n}copy(t){return super.copy(t),this.meshPerAttribute=t.meshPerAttribute,this}clone(t){let e=super.clone(t);return e.meshPerAttribute=this.meshPerAttribute,e}toJSON(t){let e=super.toJSON(t);return e.isInstancedInterleavedBuffer=!0,e.meshPerAttribute=this.meshPerAttribute,e}},Uh=class{constructor(t,e,n,i,r,o=!1){this.isGLBufferAttribute=!0,this.name="",this.buffer=t,this.type=e,this.itemSize=n,this.elementSize=i,this.count=r,this.normalized=o,this.version=0}set needsUpdate(t){t===!0&&this.version++}setBuffer(t){return this.buffer=t,this}setType(t,e){return this.type=t,this.elementSize=e,this}setItemSize(t){return this.itemSize=t,this}setCount(t){return this.count=t,this}},n0=new Jt,Fh=class{constructor(t,e,n=0,i=1/0){this.ray=new Si(t,e),this.near=n,this.far=i,this.camera=null,this.layers=new bs,this.params={Mesh:{},Line:{threshold:1},LOD:{},Points:{threshold:1},Sprite:{}}}set(t,e){this.ray.set(t,e)}setFromCamera(t,e){e.isPerspectiveCamera?(this.ray.origin.setFromMatrixPosition(e.matrixWorld),this.ray.direction.set(t.x,t.y,.5).unproject(e).sub(this.ray.origin).normalize(),this.camera=e):e.isOrthographicCamera?(this.ray.origin.set(t.x,t.y,e.projectionMatrix.elements[14]).unproject(e),this.ray.direction.set(0,0,-1).transformDirection(e.matrixWorld),this.camera=e):Bt("Raycaster: Unsupported camera type: "+e.type)}setFromXRController(t){return n0.identity().extractRotation(t.matrixWorld),this.ray.origin.setFromMatrixPosition(t.matrixWorld),this.ray.direction.set(0,0,-1).applyMatrix4(n0),this}intersectObject(t,e=!0,n=[]){return Hf(t,this,n,e),n.sort(i0),n}intersectObjects(t,e=!0,n=[]){for(let i=0,r=t.length;i<r;i++)Hf(t[i],this,n,e);return n.sort(i0),n}};function i0(s,t){return s.distance-t.distance}function Hf(s,t,e,n){let i=!0;if(s.layers.test(t.layers)&&s.raycast(t,e)===!1&&(i=!1),i===!0&&n===!0){let r=s.children;for(let o=0,a=r.length;o<a;o++)Hf(r[o],t,e,!0)}}var Oh=class{constructor(t=!0){this.autoStart=t,this.startTime=0,this.oldTime=0,this.elapsedTime=0,this.running=!1,St("Clock: This module has been deprecated. Please use THREE.Timer instead.")}start(){this.startTime=performance.now(),this.oldTime=this.startTime,this.elapsedTime=0,this.running=!0}stop(){this.getElapsedTime(),this.running=!1,this.autoStart=!1}getElapsedTime(){return this.getDelta(),this.elapsedTime}getDelta(){let t=0;if(this.autoStart&&!this.running)return this.start(),0;if(this.running){let e=performance.now();t=(e-this.oldTime)/1e3,this.oldTime=e,this.elapsedTime+=t}return t}},Bh=class{constructor(t=1,e=0,n=0){this.radius=t,this.phi=e,this.theta=n}set(t,e,n){return this.radius=t,this.phi=e,this.theta=n,this}copy(t){return this.radius=t.radius,this.phi=t.phi,this.theta=t.theta,this}makeSafe(){return this.phi=$t(this.phi,1e-6,Math.PI-1e-6),this}setFromVector3(t){return this.setFromCartesianCoords(t.x,t.y,t.z)}setFromCartesianCoords(t,e,n){return this.radius=Math.sqrt(t*t+e*e+n*n),this.radius===0?(this.theta=0,this.phi=0):(this.theta=Math.atan2(t,n),this.phi=Math.acos($t(e/this.radius,-1,1))),this}clone(){return new this.constructor().copy(this)}},zh=class{constructor(t=1,e=0,n=0){this.radius=t,this.theta=e,this.y=n}set(t,e,n){return this.radius=t,this.theta=e,this.y=n,this}copy(t){return this.radius=t.radius,this.theta=t.theta,this.y=t.y,this}setFromVector3(t){return this.setFromCartesianCoords(t.x,t.y,t.z)}setFromCartesianCoords(t,e,n){return this.radius=Math.sqrt(t*t+n*n),this.theta=Math.atan2(t,n),this.y=e,this}clone(){return new this.constructor().copy(this)}},Gd=class Gd{constructor(t,e,n,i){this.elements=[1,0,0,1],t!==void 0&&this.set(t,e,n,i)}identity(){return this.set(1,0,0,1),this}fromArray(t,e=0){for(let n=0;n<4;n++)this.elements[n]=t[n+e];return this}set(t,e,n,i){let r=this.elements;return r[0]=t,r[2]=e,r[1]=n,r[3]=i,this}};Gd.prototype.isMatrix2=!0;var kh=Gd,s0=new rt,el=class{constructor(t=new rt(1/0,1/0),e=new rt(-1/0,-1/0)){this.isBox2=!0,this.min=t,this.max=e}set(t,e){return this.min.copy(t),this.max.copy(e),this}setFromPoints(t){this.makeEmpty();for(let e=0,n=t.length;e<n;e++)this.expandByPoint(t[e]);return this}setFromCenterAndSize(t,e){let n=s0.copy(e).multiplyScalar(.5);return this.min.copy(t).sub(n),this.max.copy(t).add(n),this}clone(){return new this.constructor().copy(this)}copy(t){return this.min.copy(t.min),this.max.copy(t.max),this}makeEmpty(){return this.min.x=this.min.y=1/0,this.max.x=this.max.y=-1/0,this}isEmpty(){return this.max.x<this.min.x||this.max.y<this.min.y}getCenter(t){return this.isEmpty()?t.set(0,0):t.addVectors(this.min,this.max).multiplyScalar(.5)}getSize(t){return this.isEmpty()?t.set(0,0):t.subVectors(this.max,this.min)}expandByPoint(t){return this.min.min(t),this.max.max(t),this}expandByVector(t){return this.min.sub(t),this.max.add(t),this}expandByScalar(t){return this.min.addScalar(-t),this.max.addScalar(t),this}containsPoint(t){return t.x>=this.min.x&&t.x<=this.max.x&&t.y>=this.min.y&&t.y<=this.max.y}containsBox(t){return this.min.x<=t.min.x&&t.max.x<=this.max.x&&this.min.y<=t.min.y&&t.max.y<=this.max.y}getParameter(t,e){return e.set((t.x-this.min.x)/(this.max.x-this.min.x),(t.y-this.min.y)/(this.max.y-this.min.y))}intersectsBox(t){return t.max.x>=this.min.x&&t.min.x<=this.max.x&&t.max.y>=this.min.y&&t.min.y<=this.max.y}clampPoint(t,e){return e.copy(t).clamp(this.min,this.max)}distanceToPoint(t){return this.clampPoint(t,s0).distanceTo(t)}intersect(t){return this.min.max(t.min),this.max.min(t.max),this.isEmpty()&&this.makeEmpty(),this}union(t){return this.min.min(t.min),this.max.max(t.max),this}translate(t){return this.min.add(t),this.max.add(t),this}equals(t){return t.min.equals(this.min)&&t.max.equals(this.max)}},r0=new P,Wc=new P,pr=new P,mr=new P,Cf=new P,Oy=new P,By=new P,Gh=class{constructor(t=new P,e=new P){this.start=t,this.end=e}set(t,e){return this.start.copy(t),this.end.copy(e),this}copy(t){return this.start.copy(t.start),this.end.copy(t.end),this}getCenter(t){return t.addVectors(this.start,this.end).multiplyScalar(.5)}delta(t){return t.subVectors(this.end,this.start)}distanceSq(){return this.start.distanceToSquared(this.end)}distance(){return this.start.distanceTo(this.end)}at(t,e){return this.delta(e).multiplyScalar(t).add(this.start)}closestPointToPointParameter(t,e){r0.subVectors(t,this.start),Wc.subVectors(this.end,this.start);let n=Wc.dot(Wc);if(n===0)return 0;let r=Wc.dot(r0)/n;return e&&(r=$t(r,0,1)),r}closestPointToPoint(t,e,n){let i=this.closestPointToPointParameter(t,e);return this.delta(n).multiplyScalar(i).add(this.start)}distanceSqToLine3(t,e=Oy,n=By){let i=10000000000000001e-32,r,o,a=this.start,l=t.start,c=this.end,h=t.end;pr.subVectors(c,a),mr.subVectors(h,l),Cf.subVectors(a,l);let f=pr.dot(pr),u=mr.dot(mr),d=mr.dot(Cf);if(f<=i&&u<=i)return e.copy(a),n.copy(l),e.sub(n),e.dot(e);if(f<=i)r=0,o=d/u,o=$t(o,0,1);else{let p=pr.dot(Cf);if(u<=i)o=0,r=$t(-p/f,0,1);else{let x=pr.dot(mr),m=f*u-x*x;m!==0?r=$t((x*d-p*u)/m,0,1):r=0,o=(x*r+d)/u,o<0?(o=0,r=$t(-p/f,0,1)):o>1&&(o=1,r=$t((x-p)/f,0,1))}}return e.copy(a).addScaledVector(pr,r),n.copy(l).addScaledVector(mr,o),e.distanceToSquared(n)}applyMatrix4(t){return this.start.applyMatrix4(t),this.end.applyMatrix4(t),this}equals(t){return t.start.equals(this.start)&&t.end.equals(this.end)}clone(){return new this.constructor().copy(this)}},o0=new P,Vh=class extends ae{constructor(t,e){super(),this.light=t,this.matrixAutoUpdate=!1,this.color=e,this.type="SpotLightHelper";let n=new qt,i=[0,0,0,0,0,1,0,0,0,1,0,1,0,0,0,-1,0,1,0,0,0,0,1,1,0,0,0,0,-1,1];for(let o=0,a=1,l=32;o<l;o++,a++){let c=o/l*Math.PI*2,h=a/l*Math.PI*2;i.push(Math.cos(c),Math.sin(c),1,Math.cos(h),Math.sin(h),1)}n.setAttribute("position",new At(i,3));let r=new Ze({fog:!1,toneMapped:!1});this.cone=new bn(n,r),this.add(this.cone),this.update()}dispose(){super.dispose(),this.cone.geometry.dispose(),this.cone.material.dispose()}update(){this.light.updateWorldMatrix(!0,!1),this.light.target.updateWorldMatrix(!0,!1),this.parent?(this.parent.updateWorldMatrix(!0),this.matrix.copy(this.parent.matrixWorld).invert().multiply(this.light.matrixWorld)):this.matrix.copy(this.light.matrixWorld),this.matrixWorldNeedsUpdate=!0;let t=this.light.distance?this.light.distance:1e3,e=t*Math.tan(this.light.angle);this.cone.scale.set(e,e,t),o0.setFromMatrixPosition(this.light.target.matrixWorld),this.cone.lookAt(o0),this.color!==void 0?this.cone.material.color.set(this.color):this.cone.material.color.copy(this.light.color)}},Hi=new P,Xc=new Jt,If=new Jt,Hh=class extends bn{constructor(t){let e=_g(t),n=new qt,i=[],r=[];for(let c=0;c<e.length;c++){let h=e[c];h.parent&&h.parent.isBone&&(i.push(0,0,0),i.push(0,0,0),r.push(0,0,0),r.push(0,0,0))}n.setAttribute("position",new At(i,3)),n.setAttribute("color",new At(r,3));let o=new Ze({vertexColors:!0,depthTest:!1,depthWrite:!1,toneMapped:!1,transparent:!0});super(n,o),this.isSkeletonHelper=!0,this.type="SkeletonHelper",this.root=t,this.bones=e,this.matrix=t.matrixWorld,this.matrixAutoUpdate=!1;let a=new _t(255),l=new _t(65280);this.setColors(a,l)}updateMatrixWorld(t){let e=this.bones,n=this.geometry,i=n.getAttribute("position");If.copy(this.root.matrixWorld).invert();for(let r=0,o=0;r<e.length;r++){let a=e[r];a.parent&&a.parent.isBone&&(Xc.multiplyMatrices(If,a.matrixWorld),Hi.setFromMatrixPosition(Xc),i.setXYZ(o,Hi.x,Hi.y,Hi.z),Xc.multiplyMatrices(If,a.parent.matrixWorld),Hi.setFromMatrixPosition(Xc),i.setXYZ(o+1,Hi.x,Hi.y,Hi.z),o+=2)}n.getAttribute("position").needsUpdate=!0,super.updateMatrixWorld(t)}setColors(t,e){let i=this.geometry.getAttribute("color");for(let r=0;r<i.count;r+=2)i.setXYZ(r,t.r,t.g,t.b),i.setXYZ(r+1,e.r,e.g,e.b);return i.needsUpdate=!0,this}dispose(){super.dispose(),this.geometry.dispose(),this.material.dispose()}};function _g(s){let t=[];s.isBone===!0&&t.push(s);for(let e=0;e<s.children.length;e++)t.push(..._g(s.children[e]));return t}var Wh=class extends ce{constructor(t,e,n){let i=new zr(e,4,2),r=new sn({wireframe:!0,fog:!1,toneMapped:!1});super(i,r),this.light=t,this.color=n,this.type="PointLightHelper",this.matrix=this.light.matrixWorld,this.matrixAutoUpdate=!1,this.update()}dispose(){super.dispose(),this.geometry.dispose(),this.material.dispose()}update(){this.matrixWorldNeedsUpdate=!0,this.light.updateWorldMatrix(!0,!1),this.color!==void 0?this.material.color.set(this.color):this.material.color.copy(this.light.color)}},zy=new P,a0=new _t,l0=new _t,Xh=class extends ae{constructor(t,e,n){super(),this.light=t,this.matrix=t.matrixWorld,this.matrixAutoUpdate=!1,this.color=n,this.type="HemisphereLightHelper";let i=new Br(e);i.rotateY(Math.PI*.5),this.material=new sn({wireframe:!0,fog:!1,toneMapped:!1}),this.color===void 0&&(this.material.vertexColors=!0);let r=i.getAttribute("position"),o=new Float32Array(r.count*3);i.setAttribute("color",new Qt(o,3)),this.add(new ce(i,this.material)),this.update()}dispose(){super.dispose(),this.children[0].geometry.dispose(),this.children[0].material.dispose()}update(){let t=this.children[0];if(this.color!==void 0)this.material.color.set(this.color);else{let e=t.geometry.getAttribute("color");a0.copy(this.light.color),l0.copy(this.light.groundColor);for(let n=0,i=e.count;n<i;n++){let r=n<i/2?a0:l0;e.setXYZ(n,r.r,r.g,r.b)}e.needsUpdate=!0}this.matrixWorldNeedsUpdate=!0,this.light.updateWorldMatrix(!0,!1),t.lookAt(zy.setFromMatrixPosition(this.light.matrixWorld).negate())}},qh=class extends bn{constructor(t=10,e=10,n=4473924,i=8947848){n=new _t(n),i=new _t(i);let r=e/2,o=t/e,a=t/2,l=[],c=[];for(let u=0,d=0,p=-a;u<=e;u++,p+=o){l.push(-a,0,p,a,0,p),l.push(p,0,-a,p,0,a);let x=u===r?n:i;x.toArray(c,d),d+=3,x.toArray(c,d),d+=3,x.toArray(c,d),d+=3,x.toArray(c,d),d+=3}let h=new qt;h.setAttribute("position",new At(l,3)),h.setAttribute("color",new At(c,3));let f=new Ze({vertexColors:!0,toneMapped:!1});super(h,f),this.type="GridHelper"}dispose(){super.dispose(),this.geometry.dispose(),this.material.dispose()}},Yh=class extends bn{constructor(t=10,e=16,n=8,i=64,r=4473924,o=8947848){r=new _t(r),o=new _t(o);let a=[],l=[];if(e>1)for(let f=0;f<e;f++){let u=f/e*(Math.PI*2),d=Math.sin(u)*t,p=Math.cos(u)*t;a.push(0,0,0),a.push(d,0,p);let x=f&1?r:o;l.push(x.r,x.g,x.b),l.push(x.r,x.g,x.b)}for(let f=0;f<n;f++){let u=f&1?r:o,d=t-t/n*f;for(let p=0;p<i;p++){let x=p/i*(Math.PI*2),m=Math.sin(x)*d,g=Math.cos(x)*d;a.push(m,0,g),l.push(u.r,u.g,u.b),x=(p+1)/i*(Math.PI*2),m=Math.sin(x)*d,g=Math.cos(x)*d,a.push(m,0,g),l.push(u.r,u.g,u.b)}}let c=new qt;c.setAttribute("position",new At(a,3)),c.setAttribute("color",new At(l,3));let h=new Ze({vertexColors:!0,toneMapped:!1});super(c,h),this.type="PolarGridHelper"}dispose(){super.dispose(),this.geometry.dispose(),this.material.dispose()}},c0=new P,qc=new P,h0=new P,Zh=class extends ae{constructor(t,e,n){super(),this.light=t,this.matrix=t.matrixWorld,this.matrixAutoUpdate=!1,this.color=n,this.type="DirectionalLightHelper",e===void 0&&(e=1);let i=new qt;i.setAttribute("position",new At([-e,e,0,e,e,0,e,-e,0,-e,-e,0,-e,e,0],3));let r=new Ze({fog:!1,toneMapped:!1});this.lightPlane=new Wn(i,r),this.add(this.lightPlane),i=new qt,i.setAttribute("position",new At([0,0,0,0,0,1],3)),this.targetLine=new Wn(i,r),this.add(this.targetLine),this.update()}dispose(){super.dispose(),this.lightPlane.geometry.dispose(),this.lightPlane.material.dispose(),this.targetLine.geometry.dispose(),this.targetLine.material.dispose()}update(){this.matrixWorldNeedsUpdate=!0,this.light.updateWorldMatrix(!0,!1),this.light.target.updateWorldMatrix(!0,!1),c0.setFromMatrixPosition(this.light.matrixWorld),qc.setFromMatrixPosition(this.light.target.matrixWorld),h0.subVectors(qc,c0),this.lightPlane.lookAt(qc),this.color!==void 0?(this.lightPlane.material.color.set(this.color),this.targetLine.material.color.set(this.color)):(this.lightPlane.material.color.copy(this.light.color),this.targetLine.material.color.copy(this.light.color)),this.targetLine.lookAt(qc),this.targetLine.scale.z=h0.length()}},Yc=new P,Re=new Ds,Jh=class extends bn{constructor(t){let e=new qt,n=new Ze({color:16777215,vertexColors:!0,toneMapped:!1}),i=[],r=[],o={};a("n1","n2"),a("n2","n4"),a("n4","n3"),a("n3","n1"),a("f1","f2"),a("f2","f4"),a("f4","f3"),a("f3","f1"),a("n1","f1"),a("n2","f2"),a("n3","f3"),a("n4","f4"),a("p","n1"),a("p","n2"),a("p","n3"),a("p","n4"),a("u1","u2"),a("u2","u3"),a("u3","u1"),a("c","t"),a("p","c"),a("cn1","cn2"),a("cn3","cn4"),a("cf1","cf2"),a("cf3","cf4");function a(p,x){l(p),l(x)}function l(p){i.push(0,0,0),r.push(0,0,0),o[p]===void 0&&(o[p]=[]),o[p].push(i.length/3-1)}e.setAttribute("position",new At(i,3)),e.setAttribute("color",new At(r,3)),super(e,n),this.type="CameraHelper",this.camera=t,this.camera.updateProjectionMatrix&&this.camera.updateProjectionMatrix(),this.matrix=t.matrixWorld,this.matrixAutoUpdate=!1,this.pointMap=o,this.update();let c=new _t(16755200),h=new _t(16711680),f=new _t(43775),u=new _t(16777215),d=new _t(3355443);this.setColors(c,h,f,u,d)}setColors(t,e,n,i,r){let a=this.geometry.getAttribute("color");return a.setXYZ(0,t.r,t.g,t.b),a.setXYZ(1,t.r,t.g,t.b),a.setXYZ(2,t.r,t.g,t.b),a.setXYZ(3,t.r,t.g,t.b),a.setXYZ(4,t.r,t.g,t.b),a.setXYZ(5,t.r,t.g,t.b),a.setXYZ(6,t.r,t.g,t.b),a.setXYZ(7,t.r,t.g,t.b),a.setXYZ(8,t.r,t.g,t.b),a.setXYZ(9,t.r,t.g,t.b),a.setXYZ(10,t.r,t.g,t.b),a.setXYZ(11,t.r,t.g,t.b),a.setXYZ(12,t.r,t.g,t.b),a.setXYZ(13,t.r,t.g,t.b),a.setXYZ(14,t.r,t.g,t.b),a.setXYZ(15,t.r,t.g,t.b),a.setXYZ(16,t.r,t.g,t.b),a.setXYZ(17,t.r,t.g,t.b),a.setXYZ(18,t.r,t.g,t.b),a.setXYZ(19,t.r,t.g,t.b),a.setXYZ(20,t.r,t.g,t.b),a.setXYZ(21,t.r,t.g,t.b),a.setXYZ(22,t.r,t.g,t.b),a.setXYZ(23,t.r,t.g,t.b),a.setXYZ(24,e.r,e.g,e.b),a.setXYZ(25,e.r,e.g,e.b),a.setXYZ(26,e.r,e.g,e.b),a.setXYZ(27,e.r,e.g,e.b),a.setXYZ(28,e.r,e.g,e.b),a.setXYZ(29,e.r,e.g,e.b),a.setXYZ(30,e.r,e.g,e.b),a.setXYZ(31,e.r,e.g,e.b),a.setXYZ(32,n.r,n.g,n.b),a.setXYZ(33,n.r,n.g,n.b),a.setXYZ(34,n.r,n.g,n.b),a.setXYZ(35,n.r,n.g,n.b),a.setXYZ(36,n.r,n.g,n.b),a.setXYZ(37,n.r,n.g,n.b),a.setXYZ(38,i.r,i.g,i.b),a.setXYZ(39,i.r,i.g,i.b),a.setXYZ(40,r.r,r.g,r.b),a.setXYZ(41,r.r,r.g,r.b),a.setXYZ(42,r.r,r.g,r.b),a.setXYZ(43,r.r,r.g,r.b),a.setXYZ(44,r.r,r.g,r.b),a.setXYZ(45,r.r,r.g,r.b),a.setXYZ(46,r.r,r.g,r.b),a.setXYZ(47,r.r,r.g,r.b),a.setXYZ(48,r.r,r.g,r.b),a.setXYZ(49,r.r,r.g,r.b),a.needsUpdate=!0,this}update(){let t=this.geometry,e=this.pointMap,n=1,i=1,r,o;if(Re.projectionMatrixInverse.copy(this.camera.projectionMatrixInverse),this.camera.reversedDepth===!0)r=1,o=0;else if(this.camera.coordinateSystem===xn)r=-1,o=1;else if(this.camera.coordinateSystem===qi)r=0,o=1;else throw new Error("THREE.CameraHelper.update(): Invalid coordinate system: "+this.camera.coordinateSystem);De("c",e,t,Re,0,0,r),De("t",e,t,Re,0,0,o),De("n1",e,t,Re,-n,-i,r),De("n2",e,t,Re,n,-i,r),De("n3",e,t,Re,-n,i,r),De("n4",e,t,Re,n,i,r),De("f1",e,t,Re,-n,-i,o),De("f2",e,t,Re,n,-i,o),De("f3",e,t,Re,-n,i,o),De("f4",e,t,Re,n,i,o),De("u1",e,t,Re,n*.7,i*1.1,r),De("u2",e,t,Re,-n*.7,i*1.1,r),De("u3",e,t,Re,0,i*2,r),De("cf1",e,t,Re,-n,0,o),De("cf2",e,t,Re,n,0,o),De("cf3",e,t,Re,0,-i,o),De("cf4",e,t,Re,0,i,o),De("cn1",e,t,Re,-n,0,r),De("cn2",e,t,Re,n,0,r),De("cn3",e,t,Re,0,-i,r),De("cn4",e,t,Re,0,i,r),t.getAttribute("position").needsUpdate=!0}dispose(){super.dispose(),this.geometry.dispose(),this.material.dispose()}};function De(s,t,e,n,i,r,o){Yc.set(i,r,o).unproject(n);let a=t[s];if(a!==void 0){let l=e.getAttribute("position");for(let c=0,h=a.length;c<h;c++)l.setXYZ(a[c],Yc.x,Yc.y,Yc.z)}}var Zc=new Ae,$h=class extends bn{constructor(t,e=16776960){let n=new Uint16Array([0,1,1,2,2,3,3,0,4,5,5,6,6,7,7,4,0,4,1,5,2,6,3,7]),i=new Float32Array(8*3),r=new qt;r.setIndex(new Qt(n,1)),r.setAttribute("position",new Qt(i,3)),super(r,new Ze({color:e,toneMapped:!1})),this.object=t,this.type="BoxHelper",this.matrixAutoUpdate=!1,this.update()}update(){if(this.object!==void 0&&Zc.setFromObject(this.object),Zc.isEmpty())return;let t=Zc.min,e=Zc.max,n=this.geometry.attributes.position,i=n.array;i[0]=e.x,i[1]=e.y,i[2]=e.z,i[3]=t.x,i[4]=e.y,i[5]=e.z,i[6]=t.x,i[7]=t.y,i[8]=e.z,i[9]=e.x,i[10]=t.y,i[11]=e.z,i[12]=e.x,i[13]=e.y,i[14]=t.z,i[15]=t.x,i[16]=e.y,i[17]=t.z,i[18]=t.x,i[19]=t.y,i[20]=t.z,i[21]=e.x,i[22]=t.y,i[23]=t.z,n.needsUpdate=!0,this.geometry.computeBoundingSphere()}setFromObject(t){return this.object=t,this.update(),this}copy(t,e){return super.copy(t,e),this.object=t.object,this}dispose(){super.dispose(),this.geometry.dispose(),this.material.dispose()}},Kh=class extends bn{constructor(t,e=16776960){let n=new Uint16Array([0,1,1,2,2,3,3,0,4,5,5,6,6,7,7,4,0,4,1,5,2,6,3,7]),i=[1,1,1,-1,1,1,-1,-1,1,1,-1,1,1,1,-1,-1,1,-1,-1,-1,-1,1,-1,-1],r=new qt;r.setIndex(new Qt(n,1)),r.setAttribute("position",new At(i,3)),super(r,new Ze({color:e,toneMapped:!1})),this.box=t,this.type="Box3Helper",this.geometry.computeBoundingSphere()}updateMatrixWorld(t){let e=this.box;e.isEmpty()||(e.getCenter(this.position),e.getSize(this.scale),this.scale.multiplyScalar(.5),super.updateMatrixWorld(t))}dispose(){super.dispose(),this.geometry.dispose(),this.material.dispose()}},Qh=class extends Wn{constructor(t,e=1,n=16776960){let i=n,r=[1,-1,0,-1,1,0,-1,-1,0,1,1,0,-1,1,0,-1,-1,0,1,-1,0,1,1,0],o=new qt;o.setAttribute("position",new At(r,3)),o.computeBoundingSphere(),super(o,new Ze({color:i,toneMapped:!1})),this.type="PlaneHelper",this.plane=t,this.size=e;let a=[1,1,0,-1,1,0,-1,-1,0,1,1,0,-1,-1,0,1,-1,0],l=new qt;l.setAttribute("position",new At(a,3)),l.computeBoundingSphere(),this.add(new ce(l,new sn({color:i,opacity:.2,transparent:!0,depthWrite:!1,toneMapped:!1})))}updateMatrixWorld(t){this.position.set(0,0,0),this.scale.set(.5*this.size,.5*this.size,1),this.lookAt(this.plane.normal),this.translateZ(-this.plane.constant),super.updateMatrixWorld(t)}dispose(){super.dispose(),this.geometry.dispose(),this.material.dispose(),this.children[0].geometry.dispose(),this.children[0].material.dispose()}},u0=new P,Jc,Pf,jh=class extends ae{constructor(t=new P(0,0,1),e=new P(0,0,0),n=1,i=16776960,r=n*.2,o=r*.2){super(),this.type="ArrowHelper",Jc===void 0&&(Jc=new qt,Jc.setAttribute("position",new At([0,0,0,0,1,0],3)),Pf=new Pr(.5,1,5,1),Pf.translate(0,-.5,0)),this.position.copy(e),this.line=new Wn(Jc,new Ze({color:i,toneMapped:!1})),this.line.matrixAutoUpdate=!1,this.add(this.line),this.cone=new ce(Pf,new sn({color:i,toneMapped:!1})),this.cone.matrixAutoUpdate=!1,this.add(this.cone),this.setDirection(t),this.setLength(n,r,o)}setDirection(t){if(t.y>.99999)this.quaternion.set(0,0,0,1);else if(t.y<-.99999)this.quaternion.set(1,0,0,0);else{u0.set(t.z,0,-t.x).normalize();let e=Math.acos(t.y);this.quaternion.setFromAxisAngle(u0,e)}}setLength(t,e=t*.2,n=e*.2){this.line.scale.set(1,Math.max(1e-4,t-e),1),this.line.updateMatrix(),this.cone.scale.set(n,e,n),this.cone.position.y=t,this.cone.updateMatrix()}setColor(t){this.line.material.color.set(t),this.cone.material.color.set(t)}copy(t){return super.copy(t,!1),this.line.copy(t.line),this.cone.copy(t.cone),this}dispose(){super.dispose(),this.line.geometry.dispose(),this.line.material.dispose(),this.cone.geometry.dispose(),this.cone.material.dispose()}},tu=class extends bn{constructor(t=1){let e=[0,0,0,t,0,0,0,0,0,0,t,0,0,0,0,0,0,t],n=[1,0,0,1,.6,0,0,1,0,.6,1,0,0,0,1,0,.6,1],i=new qt;i.setAttribute("position",new At(e,3)),i.setAttribute("color",new At(n,3));let r=new Ze({vertexColors:!0,toneMapped:!1});super(i,r),this.type="AxesHelper"}setColors(t,e,n){let i=new _t,r=this.geometry.attributes.color.array;return i.set(t),i.toArray(r,0),i.toArray(r,3),i.set(e),i.toArray(r,6),i.toArray(r,9),i.set(n),i.toArray(r,12),i.toArray(r,15),this.geometry.attributes.color.needsUpdate=!0,this}dispose(){super.dispose(),this.geometry.dispose(),this.material.dispose()}},eu=class{constructor(){this.type="ShapePath",this.color=new _t,this.subPaths=[],this.currentPath=null,this.userData={}}moveTo(t,e){return this.currentPath=new Ki,this.subPaths.push(this.currentPath),this.currentPath.moveTo(t,e),this}lineTo(t,e){return this.currentPath.lineTo(t,e),this}quadraticCurveTo(t,e,n,i){return this.currentPath.quadraticCurveTo(t,e,n,i),this}bezierCurveTo(t,e,n,i,r,o){return this.currentPath.bezierCurveTo(t,e,n,i,r,o),this}splineThru(t){return this.currentPath.splineThru(t),this}toShapes(){function t(l,c){let h=!1,f=c.length;for(let u=0,d=f-1;u<f;d=u++){let p=c[u],x=c[d];p.y>l.y!=x.y>l.y&&l.x<(x.x-p.x)*(l.y-p.y)/(x.y-p.y)+p.x&&(h=!h)}return h}function e(l,c){let h=c.getCenter(new rt);if(t(h,l))return h;let f=h.y,u=[],d=l.length;for(let p=0;p<d;p++){let x=l[p],m=l[(p+1)%d];if(x.y>f!=m.y>f){let g=x.x+(f-x.y)*(m.x-x.x)/(m.y-x.y);u.push(g)}}return u.length>1&&(u.sort((p,x)=>p-x),h.x=(u[0]+u[1])/2),h}let n=this.userData.style&&this.userData.style.fillRule||"nonzero";n!=="nonzero"&&n!=="evenodd"&&(St('Fill-rule "'+n+'" is not supported, falling back to "nonzero".'),n="nonzero");let i=n==="nonzero"?l=>l!==0:l=>(l&1)!==0,r=[];for(let l of this.subPaths){let c=l.getPoints();if(c.length<3)continue;let h=Be.area(c);if(h===0)continue;let f=new el;for(let u=0;u<c.length;u++)f.expandByPoint(c[u]);r.push({subPath:l,points:c,boundingBox:f,interiorPoint:e(c,f),absArea:Math.abs(h),winding:h<0?-1:1,container:null,exclude:!1,role:null})}r.sort((l,c)=>c.absArea-l.absArea);for(let l=0;l<r.length;l++){let c=r[l],h=0;for(let f=l-1;f>=0;f--){let u=r[f];if(u.boundingBox.containsBox(c.boundingBox)&&t(c.interiorPoint,u.points)){c.container=u.exclude?u.container:u,h=u.winding,c.winding+=h;break}}i(c.winding)===i(h)&&(c.exclude=!0)}for(let l of r)l.exclude||(l.role=l.container===null||l.container.role==="hole"?"outer":"hole");let o=[],a=new Map;for(let l of r){if(l.exclude||l.role!=="outer")continue;let c=new Qi;c.curves=l.subPath.curves,o.push(c),a.set(l,c)}for(let l of r){if(l.exclude||l.role!=="hole")continue;let c=a.get(l.container);if(!c)continue;let h=new Ki;h.curves=l.subPath.curves,c.holes.push(h)}return o}},nu=class extends _n{constructor(t,e=null){super(),this.object=t,this.domElement=e,this.enabled=!0,this.state=-1,this.keys={},this.mouseButtons={LEFT:null,MIDDLE:null,RIGHT:null},this.touches={ONE:null,TWO:null}}connect(t){this.domElement!==null&&this.disconnect(),this.domElement=t}disconnect(){}dispose(){}update(){}};function ky(s,t){let e=s.image&&s.image.width?s.image.width/s.image.height:1;return e>t?(s.repeat.x=1,s.repeat.y=e/t,s.offset.x=0,s.offset.y=(1-s.repeat.y)/2):(s.repeat.x=t/e,s.repeat.y=1,s.offset.x=(1-s.repeat.x)/2,s.offset.y=0),s}function Gy(s,t){let e=s.image&&s.image.width?s.image.width/s.image.height:1;return e>t?(s.repeat.x=t/e,s.repeat.y=1,s.offset.x=(1-s.repeat.x)/2,s.offset.y=0):(s.repeat.x=1,s.repeat.y=e/t,s.offset.x=0,s.offset.y=(1-s.repeat.y)/2),s}function Vy(s){return s.repeat.x=1,s.repeat.y=1,s.offset.x=0,s.offset.y=0,s}function Au(s,t,e,n){let i=Hy(n);switch(e){case bu:return s*t;case al:return s*t/i.components*i.byteLength;case eo:return s*t/i.components*i.byteLength;case Pi:return s*t*2/i.components*i.byteLength;case ll:return s*t*2/i.components*i.byteLength;case Eu:return s*t*3/i.components*i.byteLength;case nn:return s*t*4/i.components*i.byteLength;case cl:return s*t*4/i.components*i.byteLength;case no:case io:return Math.floor((s+3)/4)*Math.floor((t+3)/4)*8;case so:case ro:return Math.floor((s+3)/4)*Math.floor((t+3)/4)*16;case ul:case dl:return Math.max(s,16)*Math.max(t,8)/4;case hl:case fl:return Math.max(s,8)*Math.max(t,8)/2;case pl:case ml:case xl:case _l:return Math.floor((s+3)/4)*Math.floor((t+3)/4)*8;case gl:case oo:case yl:return Math.floor((s+3)/4)*Math.floor((t+3)/4)*16;case vl:return Math.floor((s+3)/4)*Math.floor((t+3)/4)*16;case Ml:return Math.floor((s+4)/5)*Math.floor((t+3)/4)*16;case Sl:return Math.floor((s+4)/5)*Math.floor((t+4)/5)*16;case bl:return Math.floor((s+5)/6)*Math.floor((t+4)/5)*16;case El:return Math.floor((s+5)/6)*Math.floor((t+5)/6)*16;case Tl:return Math.floor((s+7)/8)*Math.floor((t+4)/5)*16;case wl:return Math.floor((s+7)/8)*Math.floor((t+5)/6)*16;case Al:return Math.floor((s+7)/8)*Math.floor((t+7)/8)*16;case Rl:return Math.floor((s+9)/10)*Math.floor((t+4)/5)*16;case Cl:return Math.floor((s+9)/10)*Math.floor((t+5)/6)*16;case Il:return Math.floor((s+9)/10)*Math.floor((t+7)/8)*16;case Pl:return Math.floor((s+9)/10)*Math.floor((t+9)/10)*16;case Ll:return Math.floor((s+11)/12)*Math.floor((t+9)/10)*16;case Dl:return Math.floor((s+11)/12)*Math.floor((t+11)/12)*16;case Nl:case Ul:case Fl:return Math.ceil(s/4)*Math.ceil(t/4)*16;case Ol:case Bl:return Math.ceil(s/4)*Math.ceil(t/4)*8;case ao:case zl:return Math.ceil(s/4)*Math.ceil(t/4)*16}throw new Error(`Unable to determine texture byte length for ${e} format.`)}function Hy(s){switch(s){case dn:case yu:return{byteLength:1,components:1};case Bs:case vu:case Nn:return{byteLength:2,components:1};case rl:case ol:return{byteLength:2,components:4};case En:case sl:case en:return{byteLength:4,components:1};case Mu:case Su:return{byteLength:4,components:3}}throw new Error(`THREE.TextureUtils: Unknown texture type ${s}.`)}var iu=class{static contain(t,e){return ky(t,e)}static cover(t,e){return Gy(t,e)}static fill(t){return Vy(t)}static getByteLength(t,e,n,i){return Au(t,e,n,i)}};typeof __THREE_DEVTOOLS__<"u"&&__THREE_DEVTOOLS__.dispatchEvent(new CustomEvent("register",{detail:{revision:nl}}));typeof window<"u"&&(window.__THREE__?St("WARNING: Multiple instances of Three.js being imported."):window.__THREE__=nl);var ci={};Yx(ci,{ACESFilmicToneMapping:()=>pu,AddEquation:()=>ns,AddOperation:()=>fd,AdditiveAnimationBlendMode:()=>Tu,AdditiveBlending:()=>ou,AgXToneMapping:()=>gu,AlphaFormat:()=>bu,AlwaysCompare:()=>Rd,AlwaysDepth:()=>ko,AlwaysStencilFunc:()=>Sd,AmbientLight:()=>Ha,AnimationAction:()=>tl,AnimationClip:()=>ji,AnimationLoader:()=>xh,AnimationMixer:()=>Ih,AnimationObjectGroup:()=>Ch,AnimationUtils:()=>gh,ArcCurve:()=>ha,ArrayCamera:()=>$a,ArrowHelper:()=>jh,AttachedBindMode:()=>$c,Audio:()=>Qa,AudioAnalyser:()=>Rh,AudioContext:()=>Jr,AudioListener:()=>wh,AudioLoader:()=>Eh,AxesHelper:()=>tu,BackSide:()=>rn,BasicDepthPacking:()=>vd,BasicShadowMap:()=>m0,BatchedMesh:()=>ea,BezierInterpolant:()=>Oa,Bone:()=>Rr,BooleanKeyframeTrack:()=>si,Box2:()=>el,Box3:()=>Ae,Box3Helper:()=>Kh,BoxGeometry:()=>ii,BoxHelper:()=>$h,BufferAttribute:()=>Qt,BufferGeometry:()=>qt,BufferGeometryLoader:()=>Za,ByteType:()=>yu,Cache:()=>Gn,Camera:()=>Ds,CameraHelper:()=>Jh,CanvasTexture:()=>Xn,CapsuleGeometry:()=>oa,CatmullRomCurve3:()=>ua,CineonToneMapping:()=>du,CircleGeometry:()=>aa,ClampToEdgeWrapping:()=>Ce,Clock:()=>Oh,Color:()=>_t,ColorKeyframeTrack:()=>Wr,ColorManagement:()=>re,Compatibility:()=>tg,CompressedArrayTexture:()=>fh,CompressedCubeTexture:()=>dh,CompressedTexture:()=>ws,CompressedTextureLoader:()=>_h,ConeGeometry:()=>Pr,ConstantAlphaFactor:()=>cd,ConstantColorFactor:()=>ad,Controls:()=>nu,CubeCamera:()=>Ja,CubeDepthTexture:()=>ra,CubeReflectionMapping:()=>Zn,CubeRefractionMapping:()=>Ci,CubeTexture:()=>$i,CubeTextureLoader:()=>yh,CubeUVReflectionMapping:()=>Fs,CubicBezierCurve:()=>Lr,CubicBezierCurve3:()=>fa,CubicInterpolant:()=>Ua,CullFaceBack:()=>ru,CullFaceFront:()=>Xf,CullFaceFrontBack:()=>p0,CullFaceNone:()=>Wf,Curve:()=>yn,CurvePath:()=>pa,CustomBlending:()=>Yf,CustomToneMapping:()=>mu,CylinderGeometry:()=>Ei,Cylindrical:()=>zh,Data3DTexture:()=>Ss,DataArrayTexture:()=>Ms,DataTexture:()=>hn,DataTextureLoader:()=>vh,DataUtils:()=>eh,DecrementStencilOp:()=>P0,DecrementWrapStencilOp:()=>D0,DefaultLoadingManager:()=>Nd,DepthFormat:()=>Vn,DepthStencilFormat:()=>Ii,DepthTexture:()=>bi,DetachedBindMode:()=>dd,DirectionalLight:()=>Va,DirectionalLightHelper:()=>Zh,DiscreteInterpolant:()=>Fa,DodecahedronGeometry:()=>la,DoubleSide:()=>Ne,DstAlphaFactor:()=>nd,DstColorFactor:()=>sd,DynamicCopyUsage:()=>Z0,DynamicDrawUsage:()=>V0,DynamicReadUsage:()=>X0,EdgesGeometry:()=>ca,EllipseCurve:()=>As,EqualCompare:()=>Td,EqualDepth:()=>Vo,EqualStencilFunc:()=>O0,EquirectangularReflectionMapping:()=>Qr,EquirectangularRefractionMapping:()=>jr,Euler:()=>Pn,EventDispatcher:()=>_n,ExternalTexture:()=>Ir,ExtrudeGeometry:()=>_a,FileLoader:()=>Ln,Float16BufferAttribute:()=>ah,Float32BufferAttribute:()=>At,FloatType:()=>en,Fog:()=>Jo,FogExp2:()=>Zo,FramebufferTexture:()=>uh,FrontSide:()=>Ri,Frustum:()=>ni,FrustumArray:()=>ta,GLBufferAttribute:()=>Uh,GLSL1:()=>$0,GLSL3:()=>wu,GreaterCompare:()=>wd,GreaterDepth:()=>Wo,GreaterEqualCompare:()=>Vl,GreaterEqualDepth:()=>Ho,GreaterEqualStencilFunc:()=>G0,GreaterStencilFunc:()=>z0,GridHelper:()=>qh,Group:()=>Te,HTMLTexture:()=>ph,HalfFloatType:()=>Nn,HemisphereLight:()=>za,HemisphereLightHelper:()=>Xh,IcosahedronGeometry:()=>Cs,ImageBitmapLoader:()=>bh,ImageLoader:()=>ts,ImageUtils:()=>Yo,IncrementStencilOp:()=>I0,IncrementWrapStencilOp:()=>L0,InstancedBufferAttribute:()=>ei,InstancedBufferGeometry:()=>Ya,InstancedInterleavedBuffer:()=>Nh,InstancedMesh:()=>Hn,Int16BufferAttribute:()=>rh,Int32BufferAttribute:()=>oh,Int8BufferAttribute:()=>nh,IntType:()=>sl,InterleavedBuffer:()=>Zi,InterleavedBufferAttribute:()=>Mi,Interpolant:()=>Ai,InterpolateBezier:()=>Kc,InterpolateDiscrete:()=>yr,InterpolateLinear:()=>qo,InterpolateSmooth:()=>Do,InterpolationSamplingMode:()=>j0,InterpolationSamplingType:()=>Q0,InvertStencilOp:()=>N0,KeepStencilOp:()=>No,KeyframeTrack:()=>fn,LOD:()=>Ko,LatheGeometry:()=>ya,Layers:()=>bs,LessCompare:()=>Ed,LessDepth:()=>Go,LessEqualCompare:()=>Gl,LessEqualDepth:()=>ys,LessEqualStencilFunc:()=>B0,LessStencilFunc:()=>F0,Light:()=>qn,LightProbe:()=>Xa,LightShadow:()=>Ls,Line:()=>Wn,Line3:()=>Gh,LineBasicMaterial:()=>Ze,LineCurve:()=>Dr,LineCurve3:()=>da,LineDashedMaterial:()=>Na,LineLoop:()=>na,LineSegments:()=>bn,LinearFilter:()=>le,LinearInterpolant:()=>Hr,LinearMipMapLinearFilter:()=>v0,LinearMipMapNearestFilter:()=>y0,LinearMipmapLinearFilter:()=>Ve,LinearMipmapNearestFilter:()=>to,LinearSRGBColorSpace:()=>Mr,LinearToneMapping:()=>uu,LinearTransfer:()=>Sr,Loader:()=>$e,LoaderUtils:()=>Zr,LoadingManager:()=>qr,LoopOnce:()=>pd,LoopPingPong:()=>gd,LoopRepeat:()=>md,MOUSE:()=>f0,Material:()=>Ge,MaterialBlending:()=>g0,MaterialLoader:()=>qa,MathUtils:()=>lg,Matrix2:()=>kh,Matrix3:()=>jt,Matrix4:()=>Jt,MaxEquation:()=>Kf,Mesh:()=>ce,MeshBasicMaterial:()=>sn,MeshDepthMaterial:()=>Gr,MeshDistanceMaterial:()=>Vr,MeshLambertMaterial:()=>La,MeshMatcapMaterial:()=>Da,MeshNormalMaterial:()=>Pa,MeshPhongMaterial:()=>Ca,MeshPhysicalMaterial:()=>Ra,MeshStandardMaterial:()=>He,MeshToonMaterial:()=>Ia,MinEquation:()=>$f,MirroredRepeatWrapping:()=>_r,MixOperation:()=>ud,MultiplyBlending:()=>lu,MultiplyOperation:()=>Kr,NearestFilter:()=>Ie,NearestMipMapLinearFilter:()=>_0,NearestMipMapNearestFilter:()=>x0,NearestMipmapLinearFilter:()=>Os,NearestMipmapNearestFilter:()=>_u,NeutralToneMapping:()=>xu,NeverCompare:()=>bd,NeverDepth:()=>zo,NeverStencilFunc:()=>U0,NoBlending:()=>Yn,NoColorSpace:()=>ai,NoNormalPacking:()=>T0,NoToneMapping:()=>Dn,NormalAnimationBlendMode:()=>kl,NormalBlending:()=>Us,NormalGAPacking:()=>A0,NormalRGPacking:()=>w0,NotEqualCompare:()=>Ad,NotEqualDepth:()=>Xo,NotEqualStencilFunc:()=>k0,NumberKeyframeTrack:()=>Is,Object3D:()=>ae,ObjectLoader:()=>Sh,ObjectSpaceNormalMap:()=>Md,OctahedronGeometry:()=>Br,OneFactor:()=>jf,OneMinusConstantAlphaFactor:()=>hd,OneMinusConstantColorFactor:()=>ld,OneMinusDstAlphaFactor:()=>id,OneMinusDstColorFactor:()=>rd,OneMinusSrcAlphaFactor:()=>hu,OneMinusSrcColorFactor:()=>ed,OrthographicCamera:()=>es,PCFShadowMap:()=>$r,PCFSoftShadowMap:()=>qf,PMREMGenerator:()=>Yl,Path:()=>Ki,PerspectiveCamera:()=>Oe,Plane:()=>Rn,PlaneGeometry:()=>wi,PlaneHelper:()=>Qh,PointLight:()=>Ga,PointLightHelper:()=>Wh,Points:()=>ia,PointsMaterial:()=>Cr,PolarGridHelper:()=>Yh,PolyhedronGeometry:()=>Ti,PositionalAudio:()=>Ah,PropertyBinding:()=>me,PropertyMixer:()=>ja,QuadraticBezierCurve:()=>Nr,QuadraticBezierCurve3:()=>Ur,Quaternion:()=>ze,QuaternionKeyframeTrack:()=>Ps,QuaternionLinearInterpolant:()=>Ba,R11_EAC_Format:()=>xl,RED_GREEN_RGTC2_Format:()=>ao,RED_RGTC1_Format:()=>Ol,REVISION:()=>nl,RG11_EAC_Format:()=>oo,RGBADepthPacking:()=>S0,RGBAFormat:()=>nn,RGBAIntegerFormat:()=>cl,RGBA_ASTC_10x10_Format:()=>Pl,RGBA_ASTC_10x5_Format:()=>Rl,RGBA_ASTC_10x6_Format:()=>Cl,RGBA_ASTC_10x8_Format:()=>Il,RGBA_ASTC_12x10_Format:()=>Ll,RGBA_ASTC_12x12_Format:()=>Dl,RGBA_ASTC_4x4_Format:()=>vl,RGBA_ASTC_5x4_Format:()=>Ml,RGBA_ASTC_5x5_Format:()=>Sl,RGBA_ASTC_6x5_Format:()=>bl,RGBA_ASTC_6x6_Format:()=>El,RGBA_ASTC_8x5_Format:()=>Tl,RGBA_ASTC_8x6_Format:()=>wl,RGBA_ASTC_8x8_Format:()=>Al,RGBA_BPTC_Format:()=>Nl,RGBA_ETC2_EAC_Format:()=>gl,RGBA_PVRTC_2BPPV1_Format:()=>dl,RGBA_PVRTC_4BPPV1_Format:()=>fl,RGBA_S3TC_DXT1_Format:()=>io,RGBA_S3TC_DXT3_Format:()=>so,RGBA_S3TC_DXT5_Format:()=>ro,RGBDepthPacking:()=>b0,RGBFormat:()=>Eu,RGBIntegerFormat:()=>M0,RGB_BPTC_SIGNED_Format:()=>Ul,RGB_BPTC_UNSIGNED_Format:()=>Fl,RGB_ETC1_Format:()=>pl,RGB_ETC2_Format:()=>ml,RGB_PVRTC_2BPPV1_Format:()=>ul,RGB_PVRTC_4BPPV1_Format:()=>hl,RGB_S3TC_DXT1_Format:()=>no,RGDepthPacking:()=>E0,RGFormat:()=>Pi,RGIntegerFormat:()=>ll,RawShaderMaterial:()=>kr,Ray:()=>Si,Raycaster:()=>Fh,RectAreaLight:()=>Wa,RedFormat:()=>al,RedIntegerFormat:()=>eo,ReinhardToneMapping:()=>fu,RenderObjectRefreshType:()=>eg,RenderTarget:()=>Tr,RenderTarget3D:()=>Ph,RepeatWrapping:()=>In,ReplaceStencilOp:()=>C0,ReverseSubtractEquation:()=>Jf,RingGeometry:()=>va,SIGNED_R11_EAC_Format:()=>_l,SIGNED_RED_GREEN_RGTC2_Format:()=>zl,SIGNED_RED_RGTC1_Format:()=>Bl,SIGNED_RG11_EAC_Format:()=>yl,SRGBColorSpace:()=>Ee,SRGBTransfer:()=>ue,Scene:()=>$o,ShaderChunk:()=>ne,ShaderLib:()=>Jn,ShaderMaterial:()=>un,ShadowMaterial:()=>Aa,Shape:()=>Qi,ShapeGeometry:()=>Ma,ShapePath:()=>eu,ShapeUtils:()=>Be,ShortType:()=>vu,Skeleton:()=>jo,SkeletonHelper:()=>Hh,SkinnedMesh:()=>Qo,Source:()=>Qc,Sphere:()=>ke,SphereGeometry:()=>zr,Spherical:()=>Bh,SphericalHarmonics3:()=>Yr,SplineCurve:()=>Fr,SpotLight:()=>ka,SpotLightHelper:()=>Vh,Sprite:()=>Ts,SpriteMaterial:()=>Ji,SrcAlphaFactor:()=>cu,SrcAlphaSaturateFactor:()=>od,SrcColorFactor:()=>td,StaticCopyUsage:()=>Y0,StaticDrawUsage:()=>Hl,StaticReadUsage:()=>W0,StereoCamera:()=>Th,StreamCopyUsage:()=>J0,StreamDrawUsage:()=>H0,StreamReadUsage:()=>q0,StringKeyframeTrack:()=>ri,SubtractEquation:()=>Zf,SubtractiveBlending:()=>au,TOUCH:()=>d0,TangentSpaceNormalMap:()=>oi,TetrahedronGeometry:()=>Sa,Texture:()=>Pe,TextureLoader:()=>Mh,TextureSource:()=>Cn,TextureUtils:()=>iu,Timer:()=>Ka,TimestampQuery:()=>K0,TorusGeometry:()=>ba,TorusKnotGeometry:()=>Ea,Triangle:()=>kn,TriangleFanDrawMode:()=>yd,TriangleStripDrawMode:()=>_d,TrianglesDrawMode:()=>xd,TubeGeometry:()=>Ta,UVMapping:()=>il,Uint16BufferAttribute:()=>wr,Uint32BufferAttribute:()=>Ar,Uint8BufferAttribute:()=>ih,Uint8ClampedBufferAttribute:()=>sh,Uniform:()=>Lh,UniformsGroup:()=>Dh,UniformsLib:()=>Rt,UniformsUtils:()=>Dd,UnsignedByteType:()=>dn,UnsignedInt101111Type:()=>Su,UnsignedInt248Type:()=>zs,UnsignedInt5999Type:()=>Mu,UnsignedIntType:()=>En,UnsignedShort4444Type:()=>rl,UnsignedShort5551Type:()=>ol,UnsignedShortType:()=>Bs,VSMShadowMap:()=>Ns,Vector2:()=>rt,Vector3:()=>P,Vector4:()=>ge,VectorKeyframeTrack:()=>Xr,VideoFrameTexture:()=>hh,VideoTexture:()=>sa,WebGL3DRenderTarget:()=>th,WebGLArrayRenderTarget:()=>jc,WebGLCoordinateSystem:()=>xn,WebGLCubeRenderTarget:()=>Zl,WebGLRenderTarget:()=>Je,WebGLRenderer:()=>ip,WebGLUtils:()=>qg,WebGPUCoordinateSystem:()=>qi,WebXRController:()=>Es,WireframeGeometry:()=>wa,WrapAroundEnding:()=>vr,ZeroCurvatureEnding:()=>Wi,ZeroFactor:()=>Qf,ZeroSlopeEnding:()=>Xi,ZeroStencilOp:()=>R0,createCanvasElement:()=>Cd,error:()=>Bt,getConsoleFunction:()=>sg,log:()=>Er,setConsoleFunction:()=>ig,warn:()=>St,warnOnce:()=>ti});function kg(){let s=null,t=!1,e=null,n=null;function i(r,o){n=s.requestAnimationFrame(i),e(r,o)}return{start:function(){t!==!0&&e!==null&&s!==null&&(n=s.requestAnimationFrame(i),t=!0)},stop:function(){s!==null&&s.cancelAnimationFrame(n),t=!1},setAnimationLoop:function(r){e=r},setContext:function(r){s=r}}}function Wy(s){let t=new WeakMap;function e(a,l){let c=a.array,h=a.usage,f=c.byteLength,u=s.createBuffer();s.bindBuffer(l,u),s.bufferData(l,c,h),a.onUploadCallback();let d;if(c instanceof Float32Array)d=s.FLOAT;else if(typeof Float16Array<"u"&&c instanceof Float16Array)d=s.HALF_FLOAT;else if(c instanceof Uint16Array)a.isFloat16BufferAttribute?d=s.HALF_FLOAT:d=s.UNSIGNED_SHORT;else if(c instanceof Int16Array)d=s.SHORT;else if(c instanceof Uint32Array)d=s.UNSIGNED_INT;else if(c instanceof Int32Array)d=s.INT;else if(c instanceof Int8Array)d=s.BYTE;else if(c instanceof Uint8Array)d=s.UNSIGNED_BYTE;else if(c instanceof Uint8ClampedArray)d=s.UNSIGNED_BYTE;else throw new Error("THREE.WebGLAttributes: Unsupported buffer data format: "+c);return{buffer:u,type:d,bytesPerElement:c.BYTES_PER_ELEMENT,version:a.version,size:f}}function n(a,l,c){let h=l.array,f=l.updateRanges;if(s.bindBuffer(c,a),f.length===0)s.bufferSubData(c,0,h);else{f.sort((d,p)=>d.start-p.start);let u=0;for(let d=1;d<f.length;d++){let p=f[u],x=f[d];x.start<=p.start+p.count+1?p.count=Math.max(p.count,x.start+x.count-p.start):(++u,f[u]=x)}f.length=u+1;for(let d=0,p=f.length;d<p;d++){let x=f[d];s.bufferSubData(c,x.start*h.BYTES_PER_ELEMENT,h,x.start,x.count)}l.clearUpdateRanges()}l.onUploadCallback()}function i(a){return a.isInterleavedBufferAttribute&&(a=a.data),t.get(a)}function r(a){a.isInterleavedBufferAttribute&&(a=a.data);let l=t.get(a);l&&(s.deleteBuffer(l.buffer),t.delete(a))}function o(a,l){if(a.isInterleavedBufferAttribute&&(a=a.data),a.isGLBufferAttribute){let h=t.get(a);(!h||h.version<a.version)&&t.set(a,{buffer:a.buffer,type:a.type,bytesPerElement:a.elementSize,version:a.version});return}let c=t.get(a);if(c===void 0)t.set(a,e(a,l));else if(c.version<a.version){if(c.size!==a.array.byteLength)throw new Error("THREE.WebGLAttributes: The size of the buffer attribute's array buffer does not match the original size. Resizing buffer attributes is not supported.");n(c.buffer,a,l),c.version=a.version}}return{get:i,remove:r,update:o}}var Xy=`#ifdef USE_ALPHAHASH
	if ( diffuseColor.a < getAlphaHashThreshold( vPosition ) ) discard;
#endif`,qy=`#ifdef USE_ALPHAHASH
	const float ALPHA_HASH_SCALE = 0.05;
	float hash2D( vec2 value ) {
		return fract( 1.0e4 * sin( 17.0 * value.x + 0.1 * value.y ) * ( 0.1 + abs( sin( 13.0 * value.y + value.x ) ) ) );
	}
	float hash3D( vec3 value ) {
		return hash2D( vec2( hash2D( value.xy ), value.z ) );
	}
	float getAlphaHashThreshold( vec3 position ) {
		float maxDeriv = max(
			length( dFdx( position.xyz ) ),
			length( dFdy( position.xyz ) )
		);
		float pixScale = 1.0 / ( ALPHA_HASH_SCALE * maxDeriv );
		vec2 pixScales = vec2(
			exp2( floor( log2( pixScale ) ) ),
			exp2( ceil( log2( pixScale ) ) )
		);
		vec2 alpha = vec2(
			hash3D( floor( pixScales.x * position.xyz ) ),
			hash3D( floor( pixScales.y * position.xyz ) )
		);
		float lerpFactor = fract( log2( pixScale ) );
		float x = ( 1.0 - lerpFactor ) * alpha.x + lerpFactor * alpha.y;
		float a = min( lerpFactor, 1.0 - lerpFactor );
		vec3 cases = vec3(
			x * x / ( 2.0 * a * ( 1.0 - a ) ),
			( x - 0.5 * a ) / ( 1.0 - a ),
			1.0 - ( ( 1.0 - x ) * ( 1.0 - x ) / ( 2.0 * a * ( 1.0 - a ) ) )
		);
		float threshold = ( x < ( 1.0 - a ) )
			? ( ( x < a ) ? cases.x : cases.y )
			: cases.z;
		return clamp( threshold , 1.0e-6, 1.0 );
	}
#endif`,Yy=`#ifdef USE_ALPHAMAP
	diffuseColor.a *= texture2D( alphaMap, vAlphaMapUv ).g;
#endif`,Zy=`#ifdef USE_ALPHAMAP
	uniform sampler2D alphaMap;
#endif`,Jy=`#ifdef USE_ALPHATEST
	#ifdef ALPHA_TO_COVERAGE
	diffuseColor.a = smoothstep( alphaTest, alphaTest + fwidth( diffuseColor.a ), diffuseColor.a );
	if ( diffuseColor.a == 0.0 ) discard;
	#else
	if ( diffuseColor.a < alphaTest ) discard;
	#endif
#endif`,$y=`#ifdef USE_ALPHATEST
	uniform float alphaTest;
#endif`,Ky=`#ifdef USE_AOMAP
	float ambientOcclusion = ( texture2D( aoMap, vAoMapUv ).r - 1.0 ) * aoMapIntensity + 1.0;
	reflectedLight.indirectDiffuse *= ambientOcclusion;
	#if defined( USE_CLEARCOAT ) 
		clearcoatSpecularIndirect *= ambientOcclusion;
	#endif
	#if defined( USE_SHEEN ) 
		sheenSpecularIndirect *= ambientOcclusion;
	#endif
	#if defined( USE_ENVMAP ) && defined( STANDARD )
		float dotNV = saturate( dot( geometryNormal, geometryViewDir ) );
		reflectedLight.indirectSpecular *= computeSpecularOcclusion( dotNV, ambientOcclusion, material.roughness );
	#endif
#endif`,Qy=`#ifdef USE_AOMAP
	uniform sampler2D aoMap;
	uniform float aoMapIntensity;
#endif`,jy=`#ifdef USE_BATCHING
	#if ! defined( GL_ANGLE_multi_draw )
	#define gl_DrawID _gl_DrawID
	uniform int _gl_DrawID;
	#endif
	uniform highp sampler2D batchingTexture;
	uniform highp usampler2D batchingIdTexture;
	mat4 getBatchingMatrix( const in float i ) {
		int size = textureSize( batchingTexture, 0 ).x;
		int j = int( i ) * 4;
		int x = j % size;
		int y = j / size;
		vec4 v1 = texelFetch( batchingTexture, ivec2( x, y ), 0 );
		vec4 v2 = texelFetch( batchingTexture, ivec2( x + 1, y ), 0 );
		vec4 v3 = texelFetch( batchingTexture, ivec2( x + 2, y ), 0 );
		vec4 v4 = texelFetch( batchingTexture, ivec2( x + 3, y ), 0 );
		return mat4( v1, v2, v3, v4 );
	}
	float getIndirectIndex( const in int i ) {
		int size = textureSize( batchingIdTexture, 0 ).x;
		int x = i % size;
		int y = i / size;
		return float( texelFetch( batchingIdTexture, ivec2( x, y ), 0 ).r );
	}
#endif
#ifdef USE_BATCHING_COLOR
	uniform sampler2D batchingColorTexture;
	vec4 getBatchingColor( const in float i ) {
		int size = textureSize( batchingColorTexture, 0 ).x;
		int j = int( i );
		int x = j % size;
		int y = j / size;
		return texelFetch( batchingColorTexture, ivec2( x, y ), 0 );
	}
#endif`,tv=`#ifdef USE_BATCHING
	mat4 batchingMatrix = getBatchingMatrix( getIndirectIndex( gl_DrawID ) );
#endif`,ev=`vec3 transformed = vec3( position );
#ifdef USE_ALPHAHASH
	vPosition = vec3( position );
#endif`,nv=`vec3 objectNormal = vec3( normal );
#ifdef USE_TANGENT
	vec3 objectTangent = vec3( tangent.xyz );
#endif`,iv=`float G_BlinnPhong_Implicit( ) {
	return 0.25;
}
float D_BlinnPhong( const in float shininess, const in float dotNH ) {
	return RECIPROCAL_PI * ( shininess * 0.5 + 1.0 ) * pow( dotNH, shininess );
}
vec3 BRDF_BlinnPhong( const in vec3 lightDir, const in vec3 viewDir, const in vec3 normal, const in vec3 specularColor, const in float shininess ) {
	vec3 halfDir = normalize( lightDir + viewDir );
	float dotNH = saturate( dot( normal, halfDir ) );
	float dotVH = saturate( dot( viewDir, halfDir ) );
	vec3 F = F_Schlick( specularColor, 1.0, dotVH );
	float G = G_BlinnPhong_Implicit( );
	float D = D_BlinnPhong( shininess, dotNH );
	return F * ( G * D );
} // validated`,sv=`#ifdef USE_IRIDESCENCE
	const mat3 XYZ_TO_REC709 = mat3(
		 3.2404542, -0.9692660,  0.0556434,
		-1.5371385,  1.8760108, -0.2040259,
		-0.4985314,  0.0415560,  1.0572252
	);
	vec3 Fresnel0ToIor( vec3 fresnel0 ) {
		vec3 sqrtF0 = sqrt( fresnel0 );
		return ( vec3( 1.0 ) + sqrtF0 ) / ( vec3( 1.0 ) - sqrtF0 );
	}
	vec3 IorToFresnel0( vec3 transmittedIor, float incidentIor ) {
		return pow2( ( transmittedIor - vec3( incidentIor ) ) / ( transmittedIor + vec3( incidentIor ) ) );
	}
	float IorToFresnel0( float transmittedIor, float incidentIor ) {
		return pow2( ( transmittedIor - incidentIor ) / ( transmittedIor + incidentIor ));
	}
	vec3 evalSensitivity( float OPD, vec3 shift ) {
		float phase = 2.0 * PI * OPD * 1.0e-9;
		vec3 val = vec3( 5.4856e-13, 4.4201e-13, 5.2481e-13 );
		vec3 pos = vec3( 1.6810e+06, 1.7953e+06, 2.2084e+06 );
		vec3 var = vec3( 4.3278e+09, 9.3046e+09, 6.6121e+09 );
		vec3 xyz = val * sqrt( 2.0 * PI * var ) * cos( pos * phase + shift ) * exp( - pow2( phase ) * var );
		xyz.x += 9.7470e-14 * sqrt( 2.0 * PI * 4.5282e+09 ) * cos( 2.2399e+06 * phase + shift[ 0 ] ) * exp( - 4.5282e+09 * pow2( phase ) );
		xyz /= 1.0685e-7;
		vec3 rgb = XYZ_TO_REC709 * xyz;
		return rgb;
	}
	vec3 evalIridescence( float outsideIOR, float eta2, float cosTheta1, float thinFilmThickness, vec3 baseF0 ) {
		vec3 I;
		float iridescenceIOR = mix( outsideIOR, eta2, smoothstep( 0.0, 0.03, thinFilmThickness ) );
		float sinTheta2Sq = pow2( outsideIOR / iridescenceIOR ) * ( 1.0 - pow2( cosTheta1 ) );
		float cosTheta2Sq = 1.0 - sinTheta2Sq;
		if ( cosTheta2Sq < 0.0 ) {
			return vec3( 1.0 );
		}
		float cosTheta2 = sqrt( cosTheta2Sq );
		float R0 = IorToFresnel0( iridescenceIOR, outsideIOR );
		float R12 = F_Schlick( R0, 1.0, cosTheta1 );
		float T121 = 1.0 - R12;
		float phi12 = 0.0;
		if ( iridescenceIOR < outsideIOR ) phi12 = PI;
		float phi21 = PI - phi12;
		vec3 baseIOR = Fresnel0ToIor( clamp( baseF0, 0.0, 0.9999 ) );		vec3 R1 = IorToFresnel0( baseIOR, iridescenceIOR );
		vec3 R23 = F_Schlick( R1, 1.0, cosTheta2 );
		vec3 phi23 = vec3( 0.0 );
		if ( baseIOR[ 0 ] < iridescenceIOR ) phi23[ 0 ] = PI;
		if ( baseIOR[ 1 ] < iridescenceIOR ) phi23[ 1 ] = PI;
		if ( baseIOR[ 2 ] < iridescenceIOR ) phi23[ 2 ] = PI;
		float OPD = 2.0 * iridescenceIOR * thinFilmThickness * cosTheta2;
		vec3 phi = vec3( phi21 ) + phi23;
		vec3 R123 = clamp( R12 * R23, 1e-5, 0.9999 );
		vec3 r123 = sqrt( R123 );
		vec3 Rs = pow2( T121 ) * R23 / ( vec3( 1.0 ) - R123 );
		vec3 C0 = R12 + Rs;
		I = C0;
		vec3 Cm = Rs - T121;
		for ( int m = 1; m <= 2; ++ m ) {
			Cm *= r123;
			vec3 Sm = 2.0 * evalSensitivity( float( m ) * OPD, float( m ) * phi );
			I += Cm * Sm;
		}
		return max( I, vec3( 0.0 ) );
	}
#endif`,rv=`#ifdef USE_BUMPMAP
	uniform sampler2D bumpMap;
	uniform float bumpScale;
	vec2 dHdxy_fwd() {
		vec2 dSTdx = dFdx( vBumpMapUv );
		vec2 dSTdy = dFdy( vBumpMapUv );
		float Hll = bumpScale * texture2D( bumpMap, vBumpMapUv ).x;
		float dBx = bumpScale * texture2D( bumpMap, vBumpMapUv + dSTdx ).x - Hll;
		float dBy = bumpScale * texture2D( bumpMap, vBumpMapUv + dSTdy ).x - Hll;
		return vec2( dBx, dBy );
	}
	vec3 perturbNormalArb( vec3 surf_pos, vec3 surf_norm, vec2 dHdxy, float faceDirection ) {
		vec3 vSigmaX = normalize( dFdx( surf_pos.xyz ) );
		vec3 vSigmaY = normalize( dFdy( surf_pos.xyz ) );
		vec3 vN = surf_norm;
		vec3 R1 = cross( vSigmaY, vN );
		vec3 R2 = cross( vN, vSigmaX );
		float fDet = dot( vSigmaX, R1 ) * faceDirection;
		vec3 vGrad = sign( fDet ) * ( dHdxy.x * R1 + dHdxy.y * R2 );
		return normalize( abs( fDet ) * surf_norm - vGrad );
	}
#endif`,ov=`#if NUM_CLIPPING_PLANES > 0
	vec4 plane;
	#ifdef ALPHA_TO_COVERAGE
		float distanceToPlane, distanceGradient;
		float clipOpacity = 1.0;
		#pragma unroll_loop_start
		for ( int i = 0; i < UNION_CLIPPING_PLANES; i ++ ) {
			plane = clippingPlanes[ i ];
			distanceToPlane = - dot( vClipPosition, plane.xyz ) + plane.w;
			distanceGradient = fwidth( distanceToPlane ) / 2.0;
			clipOpacity *= smoothstep( - distanceGradient, distanceGradient, distanceToPlane );
			if ( clipOpacity == 0.0 ) discard;
		}
		#pragma unroll_loop_end
		#if UNION_CLIPPING_PLANES < NUM_CLIPPING_PLANES
			float unionClipOpacity = 1.0;
			#pragma unroll_loop_start
			for ( int i = UNION_CLIPPING_PLANES; i < NUM_CLIPPING_PLANES; i ++ ) {
				plane = clippingPlanes[ i ];
				distanceToPlane = - dot( vClipPosition, plane.xyz ) + plane.w;
				distanceGradient = fwidth( distanceToPlane ) / 2.0;
				unionClipOpacity *= 1.0 - smoothstep( - distanceGradient, distanceGradient, distanceToPlane );
			}
			#pragma unroll_loop_end
			clipOpacity *= 1.0 - unionClipOpacity;
		#endif
		diffuseColor.a *= clipOpacity;
		if ( diffuseColor.a == 0.0 ) discard;
	#else
		#pragma unroll_loop_start
		for ( int i = 0; i < UNION_CLIPPING_PLANES; i ++ ) {
			plane = clippingPlanes[ i ];
			if ( dot( vClipPosition, plane.xyz ) > plane.w ) discard;
		}
		#pragma unroll_loop_end
		#if UNION_CLIPPING_PLANES < NUM_CLIPPING_PLANES
			bool clipped = true;
			#pragma unroll_loop_start
			for ( int i = UNION_CLIPPING_PLANES; i < NUM_CLIPPING_PLANES; i ++ ) {
				plane = clippingPlanes[ i ];
				clipped = ( dot( vClipPosition, plane.xyz ) > plane.w ) && clipped;
			}
			#pragma unroll_loop_end
			if ( clipped ) discard;
		#endif
	#endif
#endif`,av=`#if NUM_CLIPPING_PLANES > 0
	varying vec3 vClipPosition;
	uniform vec4 clippingPlanes[ NUM_CLIPPING_PLANES ];
#endif`,lv=`#if NUM_CLIPPING_PLANES > 0
	varying vec3 vClipPosition;
#endif`,cv=`#if NUM_CLIPPING_PLANES > 0
	vClipPosition = - mvPosition.xyz;
#endif`,hv=`#if defined( USE_COLOR ) || defined( USE_COLOR_ALPHA )
	diffuseColor *= vColor;
#endif`,uv=`#if defined( USE_COLOR ) || defined( USE_COLOR_ALPHA )
	varying vec4 vColor;
#endif`,fv=`#if defined( USE_COLOR ) || defined( USE_COLOR_ALPHA ) || defined( USE_INSTANCING_COLOR ) || defined( USE_BATCHING_COLOR )
	varying vec4 vColor;
#endif`,dv=`#if defined( USE_COLOR ) || defined( USE_COLOR_ALPHA ) || defined( USE_INSTANCING_COLOR ) || defined( USE_BATCHING_COLOR )
	vColor = vec4( 1.0 );
#endif
#ifdef USE_COLOR_ALPHA
	vColor *= color;
#elif defined( USE_COLOR )
	vColor.rgb *= color;
#endif
#ifdef USE_INSTANCING_COLOR
	vColor.rgb *= instanceColor.rgb;
#endif
#ifdef USE_BATCHING_COLOR
	vColor *= getBatchingColor( getIndirectIndex( gl_DrawID ) );
#endif`,pv=`#define PI 3.141592653589793
#define PI2 6.283185307179586
#define PI_HALF 1.5707963267948966
#define RECIPROCAL_PI 0.3183098861837907
#define RECIPROCAL_PI2 0.15915494309189535
#define EPSILON 1e-6
#ifndef saturate
#define saturate( a ) clamp( a, 0.0, 1.0 )
#endif
#define whiteComplement( a ) ( 1.0 - saturate( a ) )
float pow2( const in float x ) { return x*x; }
vec3 pow2( const in vec3 x ) { return x*x; }
float pow3( const in float x ) { return x*x*x; }
float pow4( const in float x ) { float x2 = x*x; return x2*x2; }
float max3( const in vec3 v ) { return max( max( v.x, v.y ), v.z ); }
float average( const in vec3 v ) { return dot( v, vec3( 0.3333333 ) ); }
highp float rand( const in vec2 uv ) {
	const highp float a = 12.9898, b = 78.233, c = 43758.5453;
	highp float dt = dot( uv.xy, vec2( a,b ) ), sn = mod( dt, PI );
	return fract( sin( sn ) * c );
}
#ifdef HIGH_PRECISION
	float precisionSafeLength( vec3 v ) { return length( v ); }
#else
	float precisionSafeLength( vec3 v ) {
		float maxComponent = max3( abs( v ) );
		return length( v / maxComponent ) * maxComponent;
	}
#endif
struct IncidentLight {
	vec3 color;
	vec3 direction;
	bool visible;
};
struct ReflectedLight {
	vec3 directDiffuse;
	vec3 directSpecular;
	vec3 indirectDiffuse;
	vec3 indirectSpecular;
};
#ifdef USE_ALPHAHASH
	varying vec3 vPosition;
#endif
vec3 transformDirection( in vec3 dir, in mat4 matrix ) {
	return normalize( ( matrix * vec4( dir, 0.0 ) ).xyz );
}
#define inverseTransformDirection transformDirectionByInverseViewMatrix
vec3 transformNormalByInverseViewMatrix( in vec3 normal, in mat4 viewMatrix ) {
	return normalize( ( vec4( normal, 0.0 ) * viewMatrix ).xyz );
}
vec3 transformDirectionByInverseViewMatrix( in vec3 dir, in mat4 viewMatrix ) {
	return normalize( ( vec4( dir, 0.0 ) * viewMatrix ).xyz );
}
bool isPerspectiveMatrix( mat4 m ) {
	return m[ 2 ][ 3 ] == - 1.0;
}
vec2 equirectUv( in vec3 dir ) {
	float u = atan( dir.z, dir.x ) * RECIPROCAL_PI2 + 0.5;
	float v = asin( clamp( dir.y, - 1.0, 1.0 ) ) * RECIPROCAL_PI + 0.5;
	return vec2( u, v );
}
vec3 BRDF_Lambert( const in vec3 diffuseColor ) {
	return RECIPROCAL_PI * diffuseColor;
}
vec3 F_Schlick( const in vec3 f0, const in float f90, const in float dotVH ) {
	float fresnel = exp2( ( - 5.55473 * dotVH - 6.98316 ) * dotVH );
	return f0 * ( 1.0 - fresnel ) + ( f90 * fresnel );
}
float F_Schlick( const in float f0, const in float f90, const in float dotVH ) {
	float fresnel = exp2( ( - 5.55473 * dotVH - 6.98316 ) * dotVH );
	return f0 * ( 1.0 - fresnel ) + ( f90 * fresnel );
} // validated`,mv=`#ifdef ENVMAP_TYPE_CUBE_UV
	#define cubeUV_minMipLevel 4.0
	#define cubeUV_minTileSize 16.0
	float getFace( vec3 direction ) {
		vec3 absDirection = abs( direction );
		float face = - 1.0;
		if ( absDirection.x > absDirection.z ) {
			if ( absDirection.x > absDirection.y )
				face = direction.x > 0.0 ? 0.0 : 3.0;
			else
				face = direction.y > 0.0 ? 1.0 : 4.0;
		} else {
			if ( absDirection.z > absDirection.y )
				face = direction.z > 0.0 ? 2.0 : 5.0;
			else
				face = direction.y > 0.0 ? 1.0 : 4.0;
		}
		return face;
	}
	vec2 getUV( vec3 direction, float face ) {
		vec2 uv;
		if ( face == 0.0 ) {
			uv = vec2( direction.z, direction.y ) / abs( direction.x );
		} else if ( face == 1.0 ) {
			uv = vec2( - direction.x, - direction.z ) / abs( direction.y );
		} else if ( face == 2.0 ) {
			uv = vec2( - direction.x, direction.y ) / abs( direction.z );
		} else if ( face == 3.0 ) {
			uv = vec2( - direction.z, direction.y ) / abs( direction.x );
		} else if ( face == 4.0 ) {
			uv = vec2( - direction.x, direction.z ) / abs( direction.y );
		} else {
			uv = vec2( direction.x, direction.y ) / abs( direction.z );
		}
		return 0.5 * ( uv + 1.0 );
	}
	vec3 bilinearCubeUV( sampler2D envMap, vec3 direction, float mipInt ) {
		float face = getFace( direction );
		float filterInt = max( cubeUV_minMipLevel - mipInt, 0.0 );
		mipInt = max( mipInt, cubeUV_minMipLevel );
		float faceSize = exp2( mipInt );
		highp vec2 uv = getUV( direction, face ) * ( faceSize - 2.0 ) + 1.0;
		if ( face > 2.0 ) {
			uv.y += faceSize;
			face -= 3.0;
		}
		uv.x += face * faceSize;
		uv.x += filterInt * 3.0 * cubeUV_minTileSize;
		uv.y += 4.0 * ( exp2( CUBEUV_MAX_MIP ) - faceSize );
		uv.x *= CUBEUV_TEXEL_WIDTH;
		uv.y *= CUBEUV_TEXEL_HEIGHT;
		#ifdef texture2DGradEXT
			return texture2DGradEXT( envMap, uv, vec2( 0.0 ), vec2( 0.0 ) ).rgb;
		#else
			return texture2D( envMap, uv ).rgb;
		#endif
	}
	#define cubeUV_r0 1.0
	#define cubeUV_m0 - 2.0
	#define cubeUV_r1 0.8
	#define cubeUV_m1 - 1.0
	#define cubeUV_r4 0.4
	#define cubeUV_m4 2.0
	#define cubeUV_r5 0.305
	#define cubeUV_m5 3.0
	#define cubeUV_r6 0.21
	#define cubeUV_m6 4.0
	float roughnessToMip( float roughness ) {
		float mip = 0.0;
		if ( roughness >= cubeUV_r1 ) {
			mip = ( cubeUV_r0 - roughness ) * ( cubeUV_m1 - cubeUV_m0 ) / ( cubeUV_r0 - cubeUV_r1 ) + cubeUV_m0;
		} else if ( roughness >= cubeUV_r4 ) {
			mip = ( cubeUV_r1 - roughness ) * ( cubeUV_m4 - cubeUV_m1 ) / ( cubeUV_r1 - cubeUV_r4 ) + cubeUV_m1;
		} else if ( roughness >= cubeUV_r5 ) {
			mip = ( cubeUV_r4 - roughness ) * ( cubeUV_m5 - cubeUV_m4 ) / ( cubeUV_r4 - cubeUV_r5 ) + cubeUV_m4;
		} else if ( roughness >= cubeUV_r6 ) {
			mip = ( cubeUV_r5 - roughness ) * ( cubeUV_m6 - cubeUV_m5 ) / ( cubeUV_r5 - cubeUV_r6 ) + cubeUV_m5;
		} else {
			mip = - 2.0 * log2( 1.16 * roughness );		}
		return mip;
	}
	vec4 textureCubeUV( sampler2D envMap, vec3 sampleDir, float roughness ) {
		float mip = clamp( roughnessToMip( roughness ), cubeUV_m0, CUBEUV_MAX_MIP );
		float mipF = fract( mip );
		float mipInt = floor( mip );
		vec3 color0 = bilinearCubeUV( envMap, sampleDir, mipInt );
		if ( mipF == 0.0 ) {
			return vec4( color0, 1.0 );
		} else {
			vec3 color1 = bilinearCubeUV( envMap, sampleDir, mipInt + 1.0 );
			return vec4( mix( color0, color1, mipF ), 1.0 );
		}
	}
#endif`,gv=`vec3 transformedNormal = objectNormal;
#ifdef USE_TANGENT
	vec3 transformedTangent = objectTangent;
#endif
#ifdef USE_BATCHING
	mat3 bm = mat3( batchingMatrix );
	transformedNormal /= vec3( dot( bm[ 0 ], bm[ 0 ] ), dot( bm[ 1 ], bm[ 1 ] ), dot( bm[ 2 ], bm[ 2 ] ) );
	transformedNormal = bm * transformedNormal;
	#ifdef USE_TANGENT
		transformedTangent = bm * transformedTangent;
	#endif
#endif
#ifdef USE_INSTANCING
	mat3 im = mat3( instanceMatrix );
	transformedNormal /= vec3( dot( im[ 0 ], im[ 0 ] ), dot( im[ 1 ], im[ 1 ] ), dot( im[ 2 ], im[ 2 ] ) );
	transformedNormal = im * transformedNormal;
	#ifdef USE_TANGENT
		transformedTangent = im * transformedTangent;
	#endif
#endif
transformedNormal = normalMatrix * transformedNormal;
#ifdef FLIP_SIDED
	transformedNormal = - transformedNormal;
#endif
#ifdef USE_TANGENT
	transformedTangent = ( modelViewMatrix * vec4( transformedTangent, 0.0 ) ).xyz;
#endif`,xv=`#ifdef USE_DISPLACEMENTMAP
	uniform sampler2D displacementMap;
	uniform float displacementScale;
	uniform float displacementBias;
#endif`,_v=`#ifdef USE_DISPLACEMENTMAP
	transformed += normalize( objectNormal ) * ( texture2D( displacementMap, vDisplacementMapUv ).x * displacementScale + displacementBias );
#endif`,yv=`#ifdef USE_EMISSIVEMAP
	vec4 emissiveColor = texture2D( emissiveMap, vEmissiveMapUv );
	#ifdef DECODE_VIDEO_TEXTURE_EMISSIVE
		emissiveColor = sRGBTransferEOTF( emissiveColor );
	#endif
	totalEmissiveRadiance *= emissiveColor.rgb;
#endif`,vv=`#ifdef USE_EMISSIVEMAP
	uniform sampler2D emissiveMap;
#endif`,Mv="gl_FragColor = linearToOutputTexel( gl_FragColor );",Sv=`vec4 LinearTransferOETF( in vec4 value ) {
	return value;
}
vec4 sRGBTransferEOTF( in vec4 value ) {
	return vec4( mix( pow( value.rgb * 0.9478672986 + vec3( 0.0521327014 ), vec3( 2.4 ) ), value.rgb * 0.0773993808, vec3( lessThanEqual( value.rgb, vec3( 0.04045 ) ) ) ), value.a );
}
vec4 sRGBTransferOETF( in vec4 value ) {
	return vec4( mix( pow( value.rgb, vec3( 0.41666 ) ) * 1.055 - vec3( 0.055 ), value.rgb * 12.92, vec3( lessThanEqual( value.rgb, vec3( 0.0031308 ) ) ) ), value.a );
}`,bv=`#ifdef USE_ENVMAP
	#ifdef ENV_WORLDPOS
		vec3 cameraToFrag;
		if ( isOrthographic ) {
			cameraToFrag = normalize( vec3( - viewMatrix[ 0 ][ 2 ], - viewMatrix[ 1 ][ 2 ], - viewMatrix[ 2 ][ 2 ] ) );
		} else {
			cameraToFrag = normalize( vWorldPosition - cameraPosition );
		}
		vec3 worldNormal = transformNormalByInverseViewMatrix( normal, viewMatrix );
		#ifdef ENVMAP_MODE_REFLECTION
			vec3 reflectVec = reflect( cameraToFrag, worldNormal );
		#else
			vec3 reflectVec = refract( cameraToFrag, worldNormal, refractionRatio );
		#endif
	#else
		vec3 reflectVec = vReflect;
	#endif
	#ifdef ENVMAP_TYPE_CUBE
		vec4 envColor = textureCube( envMap, envMapRotation * reflectVec );
		#ifdef ENVMAP_BLENDING_MULTIPLY
			outgoingLight = mix( outgoingLight, outgoingLight * envColor.xyz, specularStrength * reflectivity );
		#elif defined( ENVMAP_BLENDING_MIX )
			outgoingLight = mix( outgoingLight, envColor.xyz, specularStrength * reflectivity );
		#elif defined( ENVMAP_BLENDING_ADD )
			outgoingLight += envColor.xyz * specularStrength * reflectivity;
		#endif
	#endif
#endif`,Ev=`#ifdef USE_ENVMAP
	uniform float envMapIntensity;
	uniform mat3 envMapRotation;
	#ifdef ENVMAP_TYPE_CUBE
		uniform samplerCube envMap;
	#else
		uniform sampler2D envMap;
	#endif
#endif`,Tv=`#ifdef USE_ENVMAP
	uniform float reflectivity;
	#if defined( USE_BUMPMAP ) || defined( USE_NORMALMAP ) || defined( PHONG ) || defined( LAMBERT )
		#define ENV_WORLDPOS
	#endif
	#ifdef ENV_WORLDPOS
		varying vec3 vWorldPosition;
		uniform float refractionRatio;
	#else
		varying vec3 vReflect;
	#endif
#endif`,wv=`#ifdef USE_ENVMAP
	#if defined( USE_BUMPMAP ) || defined( USE_NORMALMAP ) || defined( PHONG ) || defined( LAMBERT )
		#define ENV_WORLDPOS
	#endif
	#ifdef ENV_WORLDPOS
		
		varying vec3 vWorldPosition;
	#else
		varying vec3 vReflect;
		uniform float refractionRatio;
	#endif
#endif`,Av=`#ifdef USE_ENVMAP
	#ifdef ENV_WORLDPOS
		vWorldPosition = worldPosition.xyz;
	#else
		vec3 cameraToVertex;
		if ( isOrthographic ) {
			cameraToVertex = normalize( vec3( - viewMatrix[ 0 ][ 2 ], - viewMatrix[ 1 ][ 2 ], - viewMatrix[ 2 ][ 2 ] ) );
		} else {
			cameraToVertex = normalize( worldPosition.xyz - cameraPosition );
		}
		vec3 worldNormal = transformNormalByInverseViewMatrix( transformedNormal, viewMatrix );
		#ifdef ENVMAP_MODE_REFLECTION
			vReflect = reflect( cameraToVertex, worldNormal );
		#else
			vReflect = refract( cameraToVertex, worldNormal, refractionRatio );
		#endif
	#endif
#endif`,Rv=`#ifdef USE_FOG
	vFogDepth = - mvPosition.z;
#endif`,Cv=`#ifdef USE_FOG
	varying float vFogDepth;
#endif`,Iv=`#ifdef USE_FOG
	#ifdef FOG_EXP2
		float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
	#else
		float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
	#endif
	gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );
#endif`,Pv=`#ifdef USE_FOG
	uniform vec3 fogColor;
	varying float vFogDepth;
	#ifdef FOG_EXP2
		uniform float fogDensity;
	#else
		uniform float fogNear;
		uniform float fogFar;
	#endif
#endif`,Lv=`#ifdef USE_GRADIENTMAP
	uniform sampler2D gradientMap;
#endif
vec3 getGradientIrradiance( vec3 normal, vec3 lightDirection ) {
	float dotNL = dot( normal, lightDirection );
	vec2 coord = vec2( dotNL * 0.5 + 0.5, 0.0 );
	#ifdef USE_GRADIENTMAP
		return vec3( texture2D( gradientMap, coord ).r );
	#else
		vec2 fw = fwidth( coord ) * 0.5;
		return mix( vec3( 0.7 ), vec3( 1.0 ), smoothstep( 0.7 - fw.x, 0.7 + fw.x, coord.x ) );
	#endif
}`,Dv=`#ifdef USE_LIGHTMAP
	uniform sampler2D lightMap;
	uniform float lightMapIntensity;
#endif`,Nv=`LambertMaterial material;
material.diffuseColor = diffuseColor.rgb;
material.specularStrength = specularStrength;`,Uv=`varying vec3 vViewPosition;
struct LambertMaterial {
	vec3 diffuseColor;
	float specularStrength;
};
void RE_Direct_Lambert( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in LambertMaterial material, inout ReflectedLight reflectedLight ) {
	float dotNL = saturate( dot( geometryNormal, directLight.direction ) );
	vec3 irradiance = dotNL * directLight.color;
	reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
}
void RE_IndirectDiffuse_Lambert( const in vec3 irradiance, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in LambertMaterial material, inout ReflectedLight reflectedLight ) {
	reflectedLight.indirectDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
}
#define RE_Direct				RE_Direct_Lambert
#define RE_IndirectDiffuse		RE_IndirectDiffuse_Lambert`,Fv=`uniform bool receiveShadow;
uniform vec3 ambientLightColor;
#if defined( USE_LIGHT_PROBES )
	uniform vec3 lightProbe[ 9 ];
#endif
vec3 shGetIrradianceAt( in vec3 normal, in vec3 shCoefficients[ 9 ] ) {
	float x = normal.x, y = normal.y, z = normal.z;
	vec3 result = shCoefficients[ 0 ] * 0.886227;
	result += shCoefficients[ 1 ] * 2.0 * 0.511664 * y;
	result += shCoefficients[ 2 ] * 2.0 * 0.511664 * z;
	result += shCoefficients[ 3 ] * 2.0 * 0.511664 * x;
	result += shCoefficients[ 4 ] * 2.0 * 0.429043 * x * y;
	result += shCoefficients[ 5 ] * 2.0 * 0.429043 * y * z;
	result += shCoefficients[ 6 ] * ( 0.743125 * z * z - 0.247708 );
	result += shCoefficients[ 7 ] * 2.0 * 0.429043 * x * z;
	result += shCoefficients[ 8 ] * 0.429043 * ( x * x - y * y );
	return result;
}
vec3 getLightProbeIrradiance( const in vec3 lightProbe[ 9 ], const in vec3 normal ) {
	vec3 worldNormal = transformNormalByInverseViewMatrix( normal, viewMatrix );
	vec3 irradiance = shGetIrradianceAt( worldNormal, lightProbe );
	return irradiance;
}
vec3 getAmbientLightIrradiance( const in vec3 ambientLightColor ) {
	vec3 irradiance = ambientLightColor;
	return irradiance;
}
float getDistanceAttenuation( const in float lightDistance, const in float cutoffDistance, const in float decayExponent ) {
	float distanceFalloff = 1.0 / max( pow( lightDistance, decayExponent ), 0.01 );
	if ( cutoffDistance > 0.0 ) {
		distanceFalloff *= pow2( saturate( 1.0 - pow4( lightDistance / cutoffDistance ) ) );
	}
	return distanceFalloff;
}
float getSpotAttenuation( const in float coneCosine, const in float penumbraCosine, const in float angleCosine ) {
	return smoothstep( coneCosine, penumbraCosine, angleCosine );
}
#if NUM_SUN_LIGHTS > 0
	struct SunLight {
		vec3 direction;
		vec3 color;
	};
	uniform SunLight sunLights[ NUM_SUN_LIGHTS ];
	void getSunLightInfo( const in SunLight sunLight, out IncidentLight light ) {
		light.color = sunLight.color;
		light.direction = sunLight.direction;
		light.visible = true;
	}
#endif
#if NUM_DIR_LIGHTS > 0
	struct DirectionalLight {
		vec3 direction;
		vec3 color;
	};
	uniform DirectionalLight directionalLights[ NUM_DIR_LIGHTS ];
	void getDirectionalLightInfo( const in DirectionalLight directionalLight, out IncidentLight light ) {
		light.color = directionalLight.color;
		light.direction = directionalLight.direction;
		light.visible = true;
	}
#endif
#if NUM_POINT_LIGHTS > 0
	struct PointLight {
		vec3 position;
		vec3 color;
		float distance;
		float decay;
	};
	uniform PointLight pointLights[ NUM_POINT_LIGHTS ];
	void getPointLightInfo( const in PointLight pointLight, const in vec3 geometryPosition, out IncidentLight light ) {
		vec3 lVector = pointLight.position - geometryPosition;
		light.direction = normalize( lVector );
		float lightDistance = length( lVector );
		light.color = pointLight.color;
		light.color *= getDistanceAttenuation( lightDistance, pointLight.distance, pointLight.decay );
		light.visible = ( light.color != vec3( 0.0 ) );
	}
#endif
#if NUM_SPOT_LIGHTS > 0
	struct SpotLight {
		vec3 position;
		vec3 direction;
		vec3 color;
		float distance;
		float decay;
		float coneCos;
		float penumbraCos;
	};
	uniform SpotLight spotLights[ NUM_SPOT_LIGHTS ];
	void getSpotLightInfo( const in SpotLight spotLight, const in vec3 geometryPosition, out IncidentLight light ) {
		vec3 lVector = spotLight.position - geometryPosition;
		light.direction = normalize( lVector );
		float angleCos = dot( light.direction, spotLight.direction );
		float spotAttenuation = getSpotAttenuation( spotLight.coneCos, spotLight.penumbraCos, angleCos );
		if ( spotAttenuation > 0.0 ) {
			float lightDistance = length( lVector );
			light.color = spotLight.color * spotAttenuation;
			light.color *= getDistanceAttenuation( lightDistance, spotLight.distance, spotLight.decay );
			light.visible = ( light.color != vec3( 0.0 ) );
		} else {
			light.color = vec3( 0.0 );
			light.visible = false;
		}
	}
#endif
#if NUM_RECT_AREA_LIGHTS > 0
	struct RectAreaLight {
		vec3 color;
		vec3 position;
		vec3 halfWidth;
		vec3 halfHeight;
	};
	uniform sampler2D ltc_1;	uniform sampler2D ltc_2;
	uniform RectAreaLight rectAreaLights[ NUM_RECT_AREA_LIGHTS ];
#endif
#if NUM_HEMI_LIGHTS > 0
	struct HemisphereLight {
		vec3 direction;
		vec3 skyColor;
		vec3 groundColor;
	};
	uniform HemisphereLight hemisphereLights[ NUM_HEMI_LIGHTS ];
	vec3 getHemisphereLightIrradiance( const in HemisphereLight hemiLight, const in vec3 normal ) {
		float dotNL = dot( normal, hemiLight.direction );
		float hemiDiffuseWeight = 0.5 * dotNL + 0.5;
		vec3 irradiance = mix( hemiLight.groundColor, hemiLight.skyColor, hemiDiffuseWeight );
		return irradiance;
	}
#endif
#include <lightprobes_pars_fragment>`,Ov=`#ifdef USE_ENVMAP
	vec3 getIBLIrradiance( const in vec3 normal ) {
		#ifdef ENVMAP_TYPE_CUBE_UV
			vec3 worldNormal = transformNormalByInverseViewMatrix( normal, viewMatrix );
			vec4 envMapColor = textureCubeUV( envMap, envMapRotation * worldNormal, 1.0 );
			return PI * envMapColor.rgb * envMapIntensity;
		#else
			return vec3( 0.0 );
		#endif
	}
	vec3 getIBLRadiance( const in vec3 viewDir, const in vec3 normal, const in float roughness ) {
		#ifdef ENVMAP_TYPE_CUBE_UV
			vec3 reflectVec = reflect( - viewDir, normal );
			reflectVec = normalize( mix( reflectVec, normal, pow4( roughness ) ) );
			reflectVec = transformDirectionByInverseViewMatrix( reflectVec, viewMatrix );
			vec4 envMapColor = textureCubeUV( envMap, envMapRotation * reflectVec, roughness );
			return envMapColor.rgb * envMapIntensity;
		#else
			return vec3( 0.0 );
		#endif
	}
	#ifdef USE_RETROREFLECTION
		vec3 getIBLRetroRadiance( const in vec3 viewDir, const in vec3 normal, const in float roughness ) {
			#ifdef ENVMAP_TYPE_CUBE_UV
				vec3 retroVec = normalize( mix( viewDir, normal, pow4( roughness ) ) );
				retroVec = transformDirectionByInverseViewMatrix( retroVec, viewMatrix );
				vec4 envMapColor = textureCubeUV( envMap, envMapRotation * retroVec, roughness );
				return envMapColor.rgb * envMapIntensity;
			#else
				return vec3( 0.0 );
			#endif
		}
	#endif
	#ifdef USE_ANISOTROPY
		vec3 getIBLAnisotropyRadiance( const in vec3 viewDir, const in vec3 normal, const in float roughness, const in vec3 bitangent, const in float anisotropy ) {
			#ifdef ENVMAP_TYPE_CUBE_UV
				vec3 bentNormal = cross( bitangent, viewDir );
				bentNormal = normalize( cross( bentNormal, bitangent ) );
				bentNormal = normalize( mix( bentNormal, normal, pow2( pow2( 1.0 - anisotropy * ( 1.0 - roughness ) ) ) ) );
				return getIBLRadiance( viewDir, bentNormal, roughness );
			#else
				return vec3( 0.0 );
			#endif
		}
		#ifdef USE_RETROREFLECTION
			vec3 getIBLAnisotropyRetroRadiance( const in vec3 viewDir, const in vec3 normal, const in float roughness, const in vec3 bitangent, const in float anisotropy ) {
				#ifdef ENVMAP_TYPE_CUBE_UV
					vec3 bentNormal = cross( bitangent, viewDir );
					bentNormal = normalize( cross( bentNormal, bitangent ) );
					bentNormal = normalize( mix( bentNormal, normal, pow2( pow2( 1.0 - anisotropy * ( 1.0 - roughness ) ) ) ) );
					return getIBLRetroRadiance( viewDir, bentNormal, roughness );
				#else
					return vec3( 0.0 );
				#endif
			}
		#endif
	#endif
#endif`,Bv=`ToonMaterial material;
material.diffuseColor = diffuseColor.rgb;`,zv=`varying vec3 vViewPosition;
struct ToonMaterial {
	vec3 diffuseColor;
};
void RE_Direct_Toon( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in ToonMaterial material, inout ReflectedLight reflectedLight ) {
	vec3 irradiance = getGradientIrradiance( geometryNormal, directLight.direction ) * directLight.color;
	reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
}
void RE_IndirectDiffuse_Toon( const in vec3 irradiance, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in ToonMaterial material, inout ReflectedLight reflectedLight ) {
	reflectedLight.indirectDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
}
#define RE_Direct				RE_Direct_Toon
#define RE_IndirectDiffuse		RE_IndirectDiffuse_Toon`,kv=`BlinnPhongMaterial material;
material.diffuseColor = diffuseColor.rgb;
material.specularColor = specular;
material.specularShininess = shininess;
material.specularStrength = specularStrength;`,Gv=`varying vec3 vViewPosition;
struct BlinnPhongMaterial {
	vec3 diffuseColor;
	vec3 specularColor;
	float specularShininess;
	float specularStrength;
};
void RE_Direct_BlinnPhong( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in BlinnPhongMaterial material, inout ReflectedLight reflectedLight ) {
	float dotNL = saturate( dot( geometryNormal, directLight.direction ) );
	vec3 irradiance = dotNL * directLight.color;
	reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
	reflectedLight.directSpecular += irradiance * BRDF_BlinnPhong( directLight.direction, geometryViewDir, geometryNormal, material.specularColor, material.specularShininess ) * material.specularStrength;
}
void RE_IndirectDiffuse_BlinnPhong( const in vec3 irradiance, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in BlinnPhongMaterial material, inout ReflectedLight reflectedLight ) {
	reflectedLight.indirectDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
}
#define RE_Direct				RE_Direct_BlinnPhong
#define RE_IndirectDiffuse		RE_IndirectDiffuse_BlinnPhong`,Vv=`PhysicalMaterial material;
material.diffuseColor = diffuseColor.rgb;
material.diffuseContribution = diffuseColor.rgb * ( 1.0 - metalnessFactor );
material.metalness = metalnessFactor;
vec3 dxy = max( abs( dFdx( nonPerturbedNormal ) ), abs( dFdy( nonPerturbedNormal ) ) );
float geometryRoughness = max( max( dxy.x, dxy.y ), dxy.z );
material.roughness = max( roughnessFactor, 0.0525 );material.roughness += geometryRoughness;
material.roughness = min( material.roughness, 1.0 );
#ifdef IOR
	material.ior = ior;
	#ifdef USE_SPECULAR
		float specularIntensityFactor = specularIntensity;
		vec3 specularColorFactor = specularColor;
		#ifdef USE_SPECULAR_COLORMAP
			specularColorFactor *= texture2D( specularColorMap, vSpecularColorMapUv ).rgb;
		#endif
		#ifdef USE_SPECULAR_INTENSITYMAP
			specularIntensityFactor *= texture2D( specularIntensityMap, vSpecularIntensityMapUv ).a;
		#endif
		material.specularF90 = mix( specularIntensityFactor, 1.0, metalnessFactor );
	#else
		float specularIntensityFactor = 1.0;
		vec3 specularColorFactor = vec3( 1.0 );
		material.specularF90 = 1.0;
	#endif
	material.specularColor = min( pow2( ( material.ior - 1.0 ) / ( material.ior + 1.0 ) ) * specularColorFactor, vec3( 1.0 ) ) * specularIntensityFactor;
	material.specularColorBlended = mix( material.specularColor, diffuseColor.rgb, metalnessFactor );
#else
	material.specularColor = vec3( 0.04 );
	material.specularColorBlended = mix( material.specularColor, diffuseColor.rgb, metalnessFactor );
	material.specularF90 = 1.0;
#endif
#ifdef USE_CLEARCOAT
	material.clearcoat = clearcoat;
	material.clearcoatRoughness = clearcoatRoughness;
	material.clearcoatF0 = vec3( 0.04 );
	material.clearcoatF90 = 1.0;
	#ifdef USE_CLEARCOATMAP
		material.clearcoat *= texture2D( clearcoatMap, vClearcoatMapUv ).x;
	#endif
	#ifdef USE_CLEARCOAT_ROUGHNESSMAP
		material.clearcoatRoughness *= texture2D( clearcoatRoughnessMap, vClearcoatRoughnessMapUv ).y;
	#endif
	material.clearcoat = saturate( material.clearcoat );	material.clearcoatRoughness = max( material.clearcoatRoughness, 0.0525 );
	material.clearcoatRoughness += geometryRoughness;
	material.clearcoatRoughness = min( material.clearcoatRoughness, 1.0 );
#endif
#ifdef USE_DISPERSION
	material.dispersion = dispersion;
#endif
#ifdef USE_RETROREFLECTION
	material.retroreflectivity = retroreflectivity;
#endif
#ifdef USE_IRIDESCENCE
	material.iridescence = iridescence;
	material.iridescenceIOR = iridescenceIOR;
	#ifdef USE_IRIDESCENCEMAP
		material.iridescence *= texture2D( iridescenceMap, vIridescenceMapUv ).r;
	#endif
	#ifdef USE_IRIDESCENCE_THICKNESSMAP
		material.iridescenceThickness = (iridescenceThicknessMaximum - iridescenceThicknessMinimum) * texture2D( iridescenceThicknessMap, vIridescenceThicknessMapUv ).g + iridescenceThicknessMinimum;
	#else
		material.iridescenceThickness = iridescenceThicknessMaximum;
	#endif
#endif
#ifdef USE_SHEEN
	material.sheenColor = sheenColor;
	#ifdef USE_SHEEN_COLORMAP
		material.sheenColor *= texture2D( sheenColorMap, vSheenColorMapUv ).rgb;
	#endif
	material.sheenRoughness = clamp( sheenRoughness, 0.0001, 1.0 );
	#ifdef USE_SHEEN_ROUGHNESSMAP
		material.sheenRoughness *= texture2D( sheenRoughnessMap, vSheenRoughnessMapUv ).a;
	#endif
#endif
#ifdef USE_ANISOTROPY
	#ifdef USE_ANISOTROPYMAP
		mat2 anisotropyMat = mat2( anisotropyVector.x, anisotropyVector.y, - anisotropyVector.y, anisotropyVector.x );
		vec3 anisotropyPolar = texture2D( anisotropyMap, vAnisotropyMapUv ).rgb;
		vec2 anisotropyV = anisotropyMat * normalize( 2.0 * anisotropyPolar.rg - vec2( 1.0 ) ) * anisotropyPolar.b;
	#else
		vec2 anisotropyV = anisotropyVector;
	#endif
	material.anisotropy = length( anisotropyV );
	if( material.anisotropy == 0.0 ) {
		anisotropyV = vec2( 1.0, 0.0 );
	} else {
		anisotropyV /= material.anisotropy;
		material.anisotropy = saturate( material.anisotropy );
	}
	material.alphaT = mix( pow2( material.roughness ), 1.0, pow2( material.anisotropy ) );
	material.anisotropyT = tbn[ 0 ] * anisotropyV.x + tbn[ 1 ] * anisotropyV.y;
	material.anisotropyB = tbn[ 1 ] * anisotropyV.x - tbn[ 0 ] * anisotropyV.y;
#endif`,Hv=`uniform sampler2D dfgLUT;
struct PhysicalMaterial {
	vec3 diffuseColor;
	vec3 diffuseContribution;
	vec3 specularColor;
	vec3 specularColorBlended;
	float roughness;
	float metalness;
	float specularF90;
	float dispersion;
	vec2 dfg;
	vec3 multiScatteringCompensation;
	#ifdef USE_RETROREFLECTION
		float retroreflectivity;
	#endif
	#ifdef USE_CLEARCOAT
		float clearcoat;
		float clearcoatRoughness;
		vec3 clearcoatF0;
		float clearcoatF90;
	#endif
	#ifdef USE_IRIDESCENCE
		float iridescence;
		float iridescenceIOR;
		float iridescenceThickness;
		vec3 iridescenceFresnel;
		vec3 iridescenceF0Dielectric;
		vec3 iridescenceF0Metallic;
	#endif
	#ifdef USE_SHEEN
		vec3 sheenColor;
		float sheenRoughness;
	#endif
	#ifdef IOR
		float ior;
	#endif
	#ifdef USE_TRANSMISSION
		float transmission;
		float transmissionAlpha;
		float thickness;
		float attenuationDistance;
		vec3 attenuationColor;
	#endif
	#ifdef USE_ANISOTROPY
		float anisotropy;
		float alphaT;
		vec3 anisotropyT;
		vec3 anisotropyB;
	#endif
};
vec3 clearcoatSpecularDirect = vec3( 0.0 );
vec3 clearcoatSpecularIndirect = vec3( 0.0 );
vec3 sheenSpecularDirect = vec3( 0.0 );
vec3 sheenSpecularIndirect = vec3(0.0 );
vec3 Schlick_to_F0( const in vec3 f, const in float f90, const in float dotVH ) {
    float x = clamp( 1.0 - dotVH, 0.0, 1.0 );
    float x2 = x * x;
    float x5 = clamp( x * x2 * x2, 0.0, 0.9999 );
    return ( f - vec3( f90 ) * x5 ) / ( 1.0 - x5 );
}
float V_GGX_SmithCorrelated( const in float alpha, const in float dotNL, const in float dotNV ) {
	float a2 = pow2( alpha );
	float gv = dotNL * sqrt( a2 + ( 1.0 - a2 ) * pow2( dotNV ) );
	float gl = dotNV * sqrt( a2 + ( 1.0 - a2 ) * pow2( dotNL ) );
	return 0.5 / max( gv + gl, EPSILON );
}
float D_GGX( const in float alpha, const in float dotNH ) {
	float a2 = pow2( alpha );
	float denom = pow2( dotNH ) * ( a2 - 1.0 ) + 1.0;
	return RECIPROCAL_PI * a2 / pow2( denom );
}
#ifdef USE_ANISOTROPY
	float V_GGX_SmithCorrelated_Anisotropic( const in float alphaT, const in float alphaB, const in float dotTV, const in float dotBV, const in float dotTL, const in float dotBL, const in float dotNV, const in float dotNL ) {
		float gv = dotNL * length( vec3( alphaT * dotTV, alphaB * dotBV, dotNV ) );
		float gl = dotNV * length( vec3( alphaT * dotTL, alphaB * dotBL, dotNL ) );
		return 0.5 / max( gv + gl, EPSILON );
	}
	float D_GGX_Anisotropic( const in float alphaT, const in float alphaB, const in float dotNH, const in float dotTH, const in float dotBH ) {
		float a2 = alphaT * alphaB;
		highp vec3 v = vec3( alphaB * dotTH, alphaT * dotBH, a2 * dotNH );
		highp float v2 = dot( v, v );
		float w2 = a2 / v2;
		return RECIPROCAL_PI * a2 * pow2 ( w2 );
	}
#endif
#ifdef USE_CLEARCOAT
	vec3 BRDF_GGX_Clearcoat( const in vec3 lightDir, const in vec3 viewDir, const in vec3 normal, const in PhysicalMaterial material) {
		vec3 f0 = material.clearcoatF0;
		float f90 = material.clearcoatF90;
		float roughness = material.clearcoatRoughness;
		float alpha = pow2( roughness );
		vec3 halfDir = normalize( lightDir + viewDir );
		float dotNL = saturate( dot( normal, lightDir ) );
		float dotNV = saturate( dot( normal, viewDir ) );
		float dotNH = saturate( dot( normal, halfDir ) );
		float dotVH = saturate( dot( viewDir, halfDir ) );
		vec3 F = F_Schlick( f0, f90, dotVH );
		float V = V_GGX_SmithCorrelated( alpha, dotNL, dotNV );
		float D = D_GGX( alpha, dotNH );
		return F * ( V * D );
	}
#endif
vec3 BRDF_GGX( const in vec3 lightDir, const in vec3 viewDir, const in vec3 normal, const in PhysicalMaterial material ) {
	vec3 f0 = material.specularColorBlended;
	float f90 = material.specularF90;
	float roughness = material.roughness;
	float alpha = pow2( roughness );
	vec3 halfDir = normalize( lightDir + viewDir );
	float dotNL = saturate( dot( normal, lightDir ) );
	float dotNV = saturate( dot( normal, viewDir ) );
	float dotNH = saturate( dot( normal, halfDir ) );
	float dotVH = saturate( dot( viewDir, halfDir ) );
	vec3 F = F_Schlick( f0, f90, dotVH );
	#ifdef USE_IRIDESCENCE
		F = mix( F, material.iridescenceFresnel, material.iridescence );
	#endif
	#ifdef USE_ANISOTROPY
		float dotTL = dot( material.anisotropyT, lightDir );
		float dotTV = dot( material.anisotropyT, viewDir );
		float dotTH = dot( material.anisotropyT, halfDir );
		float dotBL = dot( material.anisotropyB, lightDir );
		float dotBV = dot( material.anisotropyB, viewDir );
		float dotBH = dot( material.anisotropyB, halfDir );
		float V = V_GGX_SmithCorrelated_Anisotropic( material.alphaT, alpha, dotTV, dotBV, dotTL, dotBL, dotNV, dotNL );
		float D = D_GGX_Anisotropic( material.alphaT, alpha, dotNH, dotTH, dotBH );
	#else
		float V = V_GGX_SmithCorrelated( alpha, dotNL, dotNV );
		float D = D_GGX( alpha, dotNH );
	#endif
	return F * ( V * D );
}
vec2 LTC_Uv( const in vec3 N, const in vec3 V, const in float roughness ) {
	const float LUT_SIZE = 64.0;
	const float LUT_SCALE = ( LUT_SIZE - 1.0 ) / LUT_SIZE;
	const float LUT_BIAS = 0.5 / LUT_SIZE;
	float dotNV = saturate( dot( N, V ) );
	vec2 uv = vec2( roughness, sqrt( 1.0 - dotNV ) );
	uv = uv * LUT_SCALE + LUT_BIAS;
	return uv;
}
float LTC_ClippedSphereFormFactor( const in vec3 f ) {
	float l = length( f );
	return max( ( l * l + f.z ) / ( l + 1.0 ), 0.0 );
}
vec3 LTC_EdgeVectorFormFactor( const in vec3 v1, const in vec3 v2 ) {
	float x = dot( v1, v2 );
	float y = abs( x );
	float a = 0.8543985 + ( 0.4965155 + 0.0145206 * y ) * y;
	float b = 3.4175940 + ( 4.1616724 + y ) * y;
	float v = a / b;
	float theta_sintheta = ( x > 0.0 ) ? v : 0.5 * inversesqrt( max( 1.0 - x * x, 1e-7 ) ) - v;
	return cross( v1, v2 ) * theta_sintheta;
}
vec3 LTC_Evaluate( const in vec3 N, const in vec3 V, const in vec3 P, const in mat3 mInv, const in vec3 rectCoords[ 4 ] ) {
	vec3 v1 = rectCoords[ 1 ] - rectCoords[ 0 ];
	vec3 v2 = rectCoords[ 3 ] - rectCoords[ 0 ];
	vec3 lightNormal = cross( v1, v2 );
	if( dot( lightNormal, P - rectCoords[ 0 ] ) < 0.0 ) return vec3( 0.0 );
	vec3 T1, T2;
	T1 = normalize( V - N * dot( V, N ) );
	T2 = - cross( N, T1 );
	mat3 mat = mInv * transpose( mat3( T1, T2, N ) );
	vec3 coords[ 4 ];
	coords[ 0 ] = mat * ( rectCoords[ 0 ] - P );
	coords[ 1 ] = mat * ( rectCoords[ 1 ] - P );
	coords[ 2 ] = mat * ( rectCoords[ 2 ] - P );
	coords[ 3 ] = mat * ( rectCoords[ 3 ] - P );
	coords[ 0 ] = normalize( coords[ 0 ] );
	coords[ 1 ] = normalize( coords[ 1 ] );
	coords[ 2 ] = normalize( coords[ 2 ] );
	coords[ 3 ] = normalize( coords[ 3 ] );
	vec3 vectorFormFactor = vec3( 0.0 );
	vectorFormFactor += LTC_EdgeVectorFormFactor( coords[ 0 ], coords[ 1 ] );
	vectorFormFactor += LTC_EdgeVectorFormFactor( coords[ 1 ], coords[ 2 ] );
	vectorFormFactor += LTC_EdgeVectorFormFactor( coords[ 2 ], coords[ 3 ] );
	vectorFormFactor += LTC_EdgeVectorFormFactor( coords[ 3 ], coords[ 0 ] );
	float result = LTC_ClippedSphereFormFactor( vectorFormFactor );
	return vec3( result );
}
#if defined( USE_SHEEN )
float D_Charlie( float roughness, float dotNH ) {
	float alpha = pow2( roughness );
	float invAlpha = 1.0 / alpha;
	float cos2h = dotNH * dotNH;
	float sin2h = max( 1.0 - cos2h, 0.0078125 );
	return ( 2.0 + invAlpha ) * pow( sin2h, invAlpha * 0.5 ) / ( 2.0 * PI );
}
float V_Neubelt( float dotNV, float dotNL ) {
	return saturate( 1.0 / ( 4.0 * ( dotNL + dotNV - dotNL * dotNV ) ) );
}
vec3 BRDF_Sheen( const in vec3 lightDir, const in vec3 viewDir, const in vec3 normal, vec3 sheenColor, const in float sheenRoughness ) {
	vec3 halfDir = normalize( lightDir + viewDir );
	float dotNL = saturate( dot( normal, lightDir ) );
	float dotNV = saturate( dot( normal, viewDir ) );
	float dotNH = saturate( dot( normal, halfDir ) );
	float D = D_Charlie( sheenRoughness, dotNH );
	float V = V_Neubelt( dotNV, dotNL );
	return sheenColor * ( D * V );
}
#endif
float IBLSheenBRDF( const in vec3 normal, const in vec3 viewDir, const in float roughness ) {
	float dotNV = saturate( dot( normal, viewDir ) );
	float r2 = roughness * roughness;
	float rInv = 1.0 / ( roughness + 0.1 );
	float a = -1.9362 + 1.0678 * roughness + 0.4573 * r2 - 0.8469 * rInv;
	float b = -0.6014 + 0.5538 * roughness - 0.4670 * r2 - 0.1255 * rInv;
	float DG = exp( a * dotNV + b );
	return saturate( DG );
}
vec3 EnvironmentBRDF( const in vec3 normal, const in vec3 viewDir, const in vec3 specularColor, const in float specularF90, const in float roughness ) {
	float dotNV = saturate( dot( normal, viewDir ) );
	vec2 fab = texture2D( dfgLUT, vec2( roughness, dotNV ) ).rg;
	return specularColor * fab.x + specularF90 * fab.y;
}
#ifdef USE_IRIDESCENCE
void computeMultiscatteringIridescence( const in vec2 fab, const in vec3 specularColor, const in float specularF90, const in float iridescence, const in vec3 iridescenceF0, inout vec3 singleScatter, inout vec3 multiScatter ) {
#else
void computeMultiscattering( const in vec2 fab, const in vec3 specularColor, const in float specularF90, inout vec3 singleScatter, inout vec3 multiScatter ) {
#endif
	#ifdef USE_IRIDESCENCE
		vec3 Fr = mix( specularColor, iridescenceF0, iridescence );
	#else
		vec3 Fr = specularColor;
	#endif
	vec3 FssEss = Fr * fab.x + specularF90 * fab.y;
	float Ess = fab.x + fab.y;
	float Ems = 1.0 - Ess;
	vec3 Favg = Fr + ( 1.0 - Fr ) * 0.047619;	vec3 Fms = FssEss * Favg / ( 1.0 - Ems * Favg );
	singleScatter += FssEss;
	multiScatter += Fms * Ems;
}
#if NUM_RECT_AREA_LIGHTS > 0
	void RE_Direct_RectArea_Physical( const in RectAreaLight rectAreaLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight ) {
		vec3 normal = geometryNormal;
		vec3 viewDir = geometryViewDir;
		vec3 position = geometryPosition;
		vec3 lightPos = rectAreaLight.position;
		vec3 halfWidth = rectAreaLight.halfWidth;
		vec3 halfHeight = rectAreaLight.halfHeight;
		vec3 lightColor = rectAreaLight.color;
		float roughness = material.roughness;
		vec3 rectCoords[ 4 ];
		rectCoords[ 0 ] = lightPos + halfWidth - halfHeight;		rectCoords[ 1 ] = lightPos - halfWidth - halfHeight;
		rectCoords[ 2 ] = lightPos - halfWidth + halfHeight;
		rectCoords[ 3 ] = lightPos + halfWidth + halfHeight;
		vec2 uv = LTC_Uv( normal, viewDir, roughness );
		vec4 t1 = texture2D( ltc_1, uv );
		vec4 t2 = texture2D( ltc_2, uv );
		mat3 mInv = mat3(
			vec3( t1.x, 0, t1.y ),
			vec3(    0, 1,    0 ),
			vec3( t1.z, 0, t1.w )
		);
		vec3 fresnel = ( material.specularColorBlended * t2.x + ( material.specularF90 - material.specularColorBlended ) * t2.y );
		reflectedLight.directSpecular += lightColor * fresnel * LTC_Evaluate( normal, viewDir, position, mInv, rectCoords );
		reflectedLight.directDiffuse += lightColor * material.diffuseContribution * LTC_Evaluate( normal, viewDir, position, mat3( 1.0 ), rectCoords );
		#ifdef USE_CLEARCOAT
			vec3 Ncc = geometryClearcoatNormal;
			vec2 uvClearcoat = LTC_Uv( Ncc, viewDir, material.clearcoatRoughness );
			vec4 t1Clearcoat = texture2D( ltc_1, uvClearcoat );
			vec4 t2Clearcoat = texture2D( ltc_2, uvClearcoat );
			mat3 mInvClearcoat = mat3(
				vec3( t1Clearcoat.x, 0, t1Clearcoat.y ),
				vec3(             0, 1,             0 ),
				vec3( t1Clearcoat.z, 0, t1Clearcoat.w )
			);
			vec3 fresnelClearcoat = material.clearcoatF0 * t2Clearcoat.x + ( material.clearcoatF90 - material.clearcoatF0 ) * t2Clearcoat.y;
			clearcoatSpecularDirect += lightColor * fresnelClearcoat * LTC_Evaluate( Ncc, viewDir, position, mInvClearcoat, rectCoords );
		#endif
	}
#endif
void RE_Direct_Physical( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight ) {
	float dotNL = saturate( dot( geometryNormal, directLight.direction ) );
	vec3 irradiance = dotNL * directLight.color;
	#ifdef USE_CLEARCOAT
		float dotNLcc = saturate( dot( geometryClearcoatNormal, directLight.direction ) );
		vec3 ccIrradiance = dotNLcc * directLight.color;
		clearcoatSpecularDirect += ccIrradiance * BRDF_GGX_Clearcoat( directLight.direction, geometryViewDir, geometryClearcoatNormal, material );
	#endif
	#ifdef USE_SHEEN
 
 		sheenSpecularDirect += irradiance * BRDF_Sheen( directLight.direction, geometryViewDir, geometryNormal, material.sheenColor, material.sheenRoughness );
 
 		float sheenAlbedoV = IBLSheenBRDF( geometryNormal, geometryViewDir, material.sheenRoughness );
 		float sheenAlbedoL = IBLSheenBRDF( geometryNormal, directLight.direction, material.sheenRoughness );
 
 		float sheenEnergyComp = 1.0 - max3( material.sheenColor ) * max( sheenAlbedoV, sheenAlbedoL );
 
 		irradiance *= sheenEnergyComp;
 
 	#endif
	vec3 specularBRDF = BRDF_GGX( directLight.direction, geometryViewDir, geometryNormal, material );
	#ifdef USE_RETROREFLECTION
		vec3 retroViewDir = reflect( - geometryViewDir, geometryNormal );
		vec3 retroSpecularBRDF = BRDF_GGX( directLight.direction, retroViewDir, geometryNormal, material );
		specularBRDF = mix( specularBRDF, retroSpecularBRDF, saturate( material.retroreflectivity ) );
	#endif
	reflectedLight.directSpecular += irradiance * specularBRDF * material.multiScatteringCompensation;
	vec3 halfDir = normalize( directLight.direction + geometryViewDir );
	float dotVH = saturate( dot( geometryViewDir, halfDir ) );
	vec3 F = F_Schlick( material.specularColor, material.specularF90, dotVH );
	#ifdef USE_RETROREFLECTION
		vec3 retroHalfDir = normalize( directLight.direction + retroViewDir );
		float dotRetroVH = saturate( dot( retroViewDir, retroHalfDir ) );
		vec3 retroF = F_Schlick( material.specularColor, material.specularF90, dotRetroVH );
		F = mix( F, retroF, saturate( material.retroreflectivity ) );
	#endif
	reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseContribution ) * ( 1.0 - F );
}
void RE_IndirectDiffuse_Physical( const in vec3 irradiance, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight ) {
	vec3 singleScattering = vec3( 0.0 );
	vec3 multiScattering = vec3( 0.0 );
	#ifdef USE_IRIDESCENCE
		computeMultiscatteringIridescence( material.dfg, material.specularColor, material.specularF90, material.iridescence, material.iridescenceF0Dielectric, singleScattering, multiScattering );
	#else
		computeMultiscattering( material.dfg, material.specularColor, material.specularF90, singleScattering, multiScattering );
	#endif
	vec3 diffuse = irradiance * BRDF_Lambert( material.diffuseContribution ) * ( 1.0 - singleScattering - multiScattering );
	#ifdef USE_SHEEN
		float sheenAlbedo = IBLSheenBRDF( geometryNormal, geometryViewDir, material.sheenRoughness );
		sheenSpecularIndirect += irradiance * material.sheenColor * sheenAlbedo * RECIPROCAL_PI;
		float sheenEnergyComp = 1.0 - max3( material.sheenColor ) * sheenAlbedo;
		diffuse *= sheenEnergyComp;
	#endif
	reflectedLight.indirectDiffuse += diffuse;
}
void RE_IndirectSpecular_Physical( const in vec3 radiance, const in vec3 irradiance, const in vec3 clearcoatRadiance, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight) {
	#ifdef USE_CLEARCOAT
		clearcoatSpecularIndirect += clearcoatRadiance * EnvironmentBRDF( geometryClearcoatNormal, geometryViewDir, material.clearcoatF0, material.clearcoatF90, material.clearcoatRoughness );
	#endif
	#ifdef USE_SHEEN
		sheenSpecularIndirect += irradiance * material.sheenColor * IBLSheenBRDF( geometryNormal, geometryViewDir, material.sheenRoughness ) * RECIPROCAL_PI;
 	#endif
	vec3 singleScatteringDielectric = vec3( 0.0 );
	vec3 multiScatteringDielectric = vec3( 0.0 );
	vec3 singleScatteringMetallic = vec3( 0.0 );
	vec3 multiScatteringMetallic = vec3( 0.0 );
	#ifdef USE_IRIDESCENCE
		computeMultiscatteringIridescence( material.dfg, material.specularColor, material.specularF90, material.iridescence, material.iridescenceF0Dielectric, singleScatteringDielectric, multiScatteringDielectric );
		computeMultiscatteringIridescence( material.dfg, material.diffuseColor, material.specularF90, material.iridescence, material.iridescenceF0Metallic, singleScatteringMetallic, multiScatteringMetallic );
	#else
		computeMultiscattering( material.dfg, material.specularColor, material.specularF90, singleScatteringDielectric, multiScatteringDielectric );
		computeMultiscattering( material.dfg, material.diffuseColor, material.specularF90, singleScatteringMetallic, multiScatteringMetallic );
	#endif
	vec3 singleScattering = mix( singleScatteringDielectric, singleScatteringMetallic, material.metalness );
	vec3 multiScattering = mix( multiScatteringDielectric, multiScatteringMetallic, material.metalness );
	vec3 totalScatteringDielectric = singleScatteringDielectric + multiScatteringDielectric;
	vec3 diffuse = material.diffuseContribution * ( 1.0 - totalScatteringDielectric );
	vec3 cosineWeightedIrradiance = irradiance * RECIPROCAL_PI;
	vec3 indirectSpecular = radiance * singleScattering;
	indirectSpecular += multiScattering * cosineWeightedIrradiance;
	vec3 indirectDiffuse = diffuse * cosineWeightedIrradiance;
	#ifdef USE_SHEEN
		float sheenAlbedo = IBLSheenBRDF( geometryNormal, geometryViewDir, material.sheenRoughness );
		float sheenEnergyComp = 1.0 - max3( material.sheenColor ) * sheenAlbedo;
		indirectSpecular *= sheenEnergyComp;
		indirectDiffuse *= sheenEnergyComp;
	#endif
	reflectedLight.indirectSpecular += indirectSpecular;
	reflectedLight.indirectDiffuse += indirectDiffuse;
}
#define RE_Direct				RE_Direct_Physical
#define RE_Direct_RectArea		RE_Direct_RectArea_Physical
#define RE_IndirectDiffuse		RE_IndirectDiffuse_Physical
#define RE_IndirectSpecular		RE_IndirectSpecular_Physical
float computeSpecularOcclusion( const in float dotNV, const in float ambientOcclusion, const in float roughness ) {
	return saturate( pow( dotNV + ambientOcclusion, exp2( - 16.0 * roughness - 1.0 ) ) - 1.0 + ambientOcclusion );
}`,Wv=`
vec3 geometryPosition = - vViewPosition;
vec3 geometryNormal = normal;
vec3 geometryViewDir = ( isOrthographic ) ? vec3( 0, 0, 1 ) : normalize( vViewPosition );
vec3 geometryClearcoatNormal = vec3( 0.0 );
#ifdef USE_CLEARCOAT
	geometryClearcoatNormal = clearcoatNormal;
#endif
#ifdef USE_IRIDESCENCE
	float dotNVi = saturate( dot( normal, geometryViewDir ) );
	if ( material.iridescenceThickness == 0.0 ) {
		material.iridescence = 0.0;
	} else {
		material.iridescence = saturate( material.iridescence );
	}
	if ( material.iridescence > 0.0 ) {
		vec3 iridescenceFresnelDielectric = evalIridescence( 1.0, material.iridescenceIOR, dotNVi, material.iridescenceThickness, material.specularColor );
		vec3 iridescenceFresnelMetallic = evalIridescence( 1.0, material.iridescenceIOR, dotNVi, material.iridescenceThickness, material.diffuseColor );
		material.iridescenceFresnel = mix( iridescenceFresnelDielectric, iridescenceFresnelMetallic, material.metalness );
		material.iridescenceF0Dielectric = Schlick_to_F0( iridescenceFresnelDielectric, 1.0, dotNVi );
		material.iridescenceF0Metallic = Schlick_to_F0( iridescenceFresnelMetallic, 1.0, dotNVi );
	}
#endif
#ifdef STANDARD
	float dotNVms = saturate( dot( geometryNormal, geometryViewDir ) );
	material.dfg = texture2D( dfgLUT, vec2( material.roughness, dotNVms ) ).rg;
	#if ( NUM_SUN_LIGHTS > 0 || NUM_DIR_LIGHTS > 0 || NUM_POINT_LIGHTS > 0 || NUM_SPOT_LIGHTS > 0 )
		float EssMs = material.dfg.x + material.dfg.y;
		material.multiScatteringCompensation = 1.0 + material.specularColorBlended * ( 1.0 / EssMs - 1.0 );
	#endif
#endif
IncidentLight directLight;
#if ( NUM_POINT_LIGHTS > 0 ) && defined( RE_Direct )
	PointLight pointLight;
	#if defined( USE_SHADOWMAP ) && NUM_POINT_LIGHT_SHADOWS > 0
	PointLightShadow pointLightShadow;
	#endif
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_POINT_LIGHTS; i ++ ) {
		pointLight = pointLights[ i ];
		getPointLightInfo( pointLight, geometryPosition, directLight );
		#if defined( USE_SHADOWMAP ) && ( UNROLLED_LOOP_INDEX < NUM_POINT_LIGHT_SHADOWS ) && ( defined( SHADOWMAP_TYPE_PCF ) || defined( SHADOWMAP_TYPE_BASIC ) )
		pointLightShadow = pointLightShadows[ i ];
		directLight.color *= ( directLight.visible && receiveShadow ) ? getPointShadow( pointShadowMap[ i ], pointLightShadow.shadowMapSize, pointLightShadow.shadowIntensity, pointLightShadow.shadowBias, pointLightShadow.shadowRadius, vPointShadowCoord[ i ], pointLightShadow.shadowCameraNear, pointLightShadow.shadowCameraFar ) : 1.0;
		#endif
		RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
	}
	#pragma unroll_loop_end
#endif
#if ( NUM_SPOT_LIGHTS > 0 ) && defined( RE_Direct )
	SpotLight spotLight;
	vec4 spotColor;
	vec3 spotLightCoord;
	bool inSpotLightMap;
	#if defined( USE_SHADOWMAP ) && NUM_SPOT_LIGHT_SHADOWS > 0
	SpotLightShadow spotLightShadow;
	#endif
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_SPOT_LIGHTS; i ++ ) {
		spotLight = spotLights[ i ];
		getSpotLightInfo( spotLight, geometryPosition, directLight );
		#if ( UNROLLED_LOOP_INDEX < NUM_SPOT_LIGHT_SHADOWS_WITH_MAPS )
		#define SPOT_LIGHT_MAP_INDEX UNROLLED_LOOP_INDEX
		#elif ( UNROLLED_LOOP_INDEX < NUM_SPOT_LIGHT_SHADOWS )
		#define SPOT_LIGHT_MAP_INDEX NUM_SPOT_LIGHT_MAPS
		#else
		#define SPOT_LIGHT_MAP_INDEX ( UNROLLED_LOOP_INDEX - NUM_SPOT_LIGHT_SHADOWS + NUM_SPOT_LIGHT_SHADOWS_WITH_MAPS )
		#endif
		#if ( SPOT_LIGHT_MAP_INDEX < NUM_SPOT_LIGHT_MAPS )
			spotLightCoord = vSpotLightCoord[ i ].xyz / vSpotLightCoord[ i ].w;
			inSpotLightMap = all( lessThan( abs( spotLightCoord * 2. - 1. ), vec3( 1.0 ) ) );
			spotColor = texture2D( spotLightMap[ SPOT_LIGHT_MAP_INDEX ], spotLightCoord.xy );
			directLight.color = inSpotLightMap ? directLight.color * spotColor.rgb : directLight.color;
		#endif
		#undef SPOT_LIGHT_MAP_INDEX
		#if defined( USE_SHADOWMAP ) && ( UNROLLED_LOOP_INDEX < NUM_SPOT_LIGHT_SHADOWS )
		spotLightShadow = spotLightShadows[ i ];
		directLight.color *= ( directLight.visible && receiveShadow ) ? getShadow( spotShadowMap[ i ], spotLightShadow.shadowMapSize, spotLightShadow.shadowIntensity, spotLightShadow.shadowBias, spotLightShadow.shadowRadius, vSpotLightCoord[ i ] ) : 1.0;
		#endif
		RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
	}
	#pragma unroll_loop_end
#endif
#if ( NUM_SUN_LIGHTS > 0 ) && defined( RE_Direct )
	SunLight sunLight;
	#if defined( USE_SHADOWMAP ) && NUM_SUN_LIGHT_SHADOWS > 0
	SunLightShadow sunLightShadow;
	#endif
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_SUN_LIGHTS; i ++ ) {
		sunLight = sunLights[ i ];
		getSunLightInfo( sunLight, directLight );
		#if defined( USE_SHADOWMAP ) && ( UNROLLED_LOOP_INDEX < NUM_SUN_LIGHT_SHADOWS )
		sunLightShadow = sunLightShadows[ i ];
		directLight.color *= ( directLight.visible && receiveShadow ) ? getSunShadow( sunShadowMap[ i ], sunLightShadow, UNROLLED_LOOP_INDEX ) : 1.0;
		#endif
		RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
	}
	#pragma unroll_loop_end
#endif
#if ( NUM_DIR_LIGHTS > 0 ) && defined( RE_Direct )
	DirectionalLight directionalLight;
	#if defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS > 0
	DirectionalLightShadow directionalLightShadow;
	#endif
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_DIR_LIGHTS; i ++ ) {
		directionalLight = directionalLights[ i ];
		getDirectionalLightInfo( directionalLight, directLight );
		#if defined( USE_SHADOWMAP ) && ( UNROLLED_LOOP_INDEX < NUM_DIR_LIGHT_SHADOWS )
		directionalLightShadow = directionalLightShadows[ i ];
		directLight.color *= ( directLight.visible && receiveShadow ) ? getShadow( directionalShadowMap[ i ], directionalLightShadow.shadowMapSize, directionalLightShadow.shadowIntensity, directionalLightShadow.shadowBias, directionalLightShadow.shadowRadius, vDirectionalShadowCoord[ i ] ) : 1.0;
		#endif
		RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
	}
	#pragma unroll_loop_end
#endif
#if ( NUM_RECT_AREA_LIGHTS > 0 ) && defined( RE_Direct_RectArea )
	RectAreaLight rectAreaLight;
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_RECT_AREA_LIGHTS; i ++ ) {
		rectAreaLight = rectAreaLights[ i ];
		RE_Direct_RectArea( rectAreaLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
	}
	#pragma unroll_loop_end
#endif
#if defined( RE_IndirectDiffuse )
	vec3 iblIrradiance = vec3( 0.0 );
	vec3 irradiance = getAmbientLightIrradiance( ambientLightColor );
	#if defined( USE_LIGHT_PROBES )
		irradiance += getLightProbeIrradiance( lightProbe, geometryNormal );
	#endif
	#if ( NUM_HEMI_LIGHTS > 0 )
		#pragma unroll_loop_start
		for ( int i = 0; i < NUM_HEMI_LIGHTS; i ++ ) {
			irradiance += getHemisphereLightIrradiance( hemisphereLights[ i ], geometryNormal );
		}
		#pragma unroll_loop_end
	#endif
	#ifdef USE_LIGHT_PROBES_GRID
		vec3 probeWorldPos = ( ( vec4( geometryPosition, 1.0 ) - viewMatrix[ 3 ] ) * viewMatrix ).xyz;
		vec3 probeWorldNormal = transformNormalByInverseViewMatrix( geometryNormal, viewMatrix );
		irradiance += getLightProbeGridIrradiance( probeWorldPos, probeWorldNormal );
	#endif
#endif
#if defined( RE_IndirectSpecular )
	vec3 radiance = vec3( 0.0 );
	vec3 clearcoatRadiance = vec3( 0.0 );
#endif`,Xv=`#if defined( RE_IndirectDiffuse )
	#ifdef USE_LIGHTMAP
		vec4 lightMapTexel = texture2D( lightMap, vLightMapUv );
		vec3 lightMapIrradiance = lightMapTexel.rgb * lightMapIntensity;
		irradiance += lightMapIrradiance;
	#endif
	#if defined( USE_ENVMAP ) && defined( ENVMAP_TYPE_CUBE_UV )
		#if defined( STANDARD ) || defined( LAMBERT ) || defined( PHONG )
			iblIrradiance += getIBLIrradiance( geometryNormal );
		#endif
	#endif
#endif
#if defined( USE_ENVMAP ) && defined( RE_IndirectSpecular )
	#ifdef USE_ANISOTROPY
		vec3 iblRadiance = getIBLAnisotropyRadiance( geometryViewDir, geometryNormal, material.roughness, material.anisotropyB, material.anisotropy );
	#else
		vec3 iblRadiance = getIBLRadiance( geometryViewDir, geometryNormal, material.roughness );
	#endif
	#ifdef USE_RETROREFLECTION
		#ifdef USE_ANISOTROPY
			vec3 retroIBLRadiance = getIBLAnisotropyRetroRadiance( geometryViewDir, geometryNormal, material.roughness, material.anisotropyB, material.anisotropy );
		#else
			vec3 retroIBLRadiance = getIBLRetroRadiance( geometryViewDir, geometryNormal, material.roughness );
		#endif
		iblRadiance = mix( iblRadiance, retroIBLRadiance, saturate( material.retroreflectivity ) );
	#endif
	radiance += iblRadiance;
	#ifdef USE_CLEARCOAT
		clearcoatRadiance += getIBLRadiance( geometryViewDir, geometryClearcoatNormal, material.clearcoatRoughness );
	#endif
#endif`,qv=`#if defined( RE_IndirectDiffuse )
	#if defined( LAMBERT ) || defined( PHONG )
		irradiance += iblIrradiance;
	#endif
	RE_IndirectDiffuse( irradiance, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
#endif
#if defined( RE_IndirectSpecular )
	RE_IndirectSpecular( radiance, iblIrradiance, clearcoatRadiance, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
#endif`,Yv=`#ifdef USE_LIGHT_PROBES_GRID
uniform highp sampler3D probesSH;
uniform vec3 probesMin;
uniform vec3 probesMax;
uniform vec3 probesResolution;
vec3 getLightProbeGridIrradiance( vec3 worldPos, vec3 worldNormal ) {
	vec3 res = probesResolution;
	vec3 gridRange = probesMax - probesMin;
	vec3 resMinusOne = res - 1.0;
	vec3 probeSpacing = gridRange / resMinusOne;
	vec3 samplePos = worldPos + worldNormal * probeSpacing * 0.5;
	vec3 uvw = clamp( ( samplePos - probesMin ) / gridRange, 0.0, 1.0 );
	uvw = uvw * resMinusOne / res + 0.5 / res;
	float nz          = res.z;
	float paddedSlices = nz + 2.0;
	float atlasDepth  = 7.0 * paddedSlices;
	float uvZBase     = uvw.z * nz + 1.0;
	vec4 s0 = texture( probesSH, vec3( uvw.xy, ( uvZBase                       ) / atlasDepth ) );
	vec4 s1 = texture( probesSH, vec3( uvw.xy, ( uvZBase +       paddedSlices   ) / atlasDepth ) );
	vec4 s2 = texture( probesSH, vec3( uvw.xy, ( uvZBase + 2.0 * paddedSlices   ) / atlasDepth ) );
	vec4 s3 = texture( probesSH, vec3( uvw.xy, ( uvZBase + 3.0 * paddedSlices   ) / atlasDepth ) );
	vec4 s4 = texture( probesSH, vec3( uvw.xy, ( uvZBase + 4.0 * paddedSlices   ) / atlasDepth ) );
	vec4 s5 = texture( probesSH, vec3( uvw.xy, ( uvZBase + 5.0 * paddedSlices   ) / atlasDepth ) );
	vec4 s6 = texture( probesSH, vec3( uvw.xy, ( uvZBase + 6.0 * paddedSlices   ) / atlasDepth ) );
	vec3 c0 = s0.xyz;
	vec3 c1 = vec3( s0.w, s1.xy );
	vec3 c2 = vec3( s1.zw, s2.x );
	vec3 c3 = s2.yzw;
	vec3 c4 = s3.xyz;
	vec3 c5 = vec3( s3.w, s4.xy );
	vec3 c6 = vec3( s4.zw, s5.x );
	vec3 c7 = s5.yzw;
	vec3 c8 = s6.xyz;
	float x = worldNormal.x, y = worldNormal.y, z = worldNormal.z;
	vec3 result = c0 * 0.886227;
	result += c1 * 2.0 * 0.511664 * y;
	result += c2 * 2.0 * 0.511664 * z;
	result += c3 * 2.0 * 0.511664 * x;
	result += c4 * 2.0 * 0.429043 * x * y;
	result += c5 * 2.0 * 0.429043 * y * z;
	result += c6 * ( 0.743125 * z * z - 0.247708 );
	result += c7 * 2.0 * 0.429043 * x * z;
	result += c8 * 0.429043 * ( x * x - y * y );
	return max( result, vec3( 0.0 ) );
}
#endif`,Zv=`#if defined( USE_LOGARITHMIC_DEPTH_BUFFER )
	gl_FragDepth = vIsPerspective == 0.0 ? gl_FragCoord.z : log2( vFragDepth ) * logDepthBufFC * 0.5;
#endif`,Jv=`#if defined( USE_LOGARITHMIC_DEPTH_BUFFER )
	uniform float logDepthBufFC;
	varying float vFragDepth;
	varying float vIsPerspective;
#endif`,$v=`#ifdef USE_LOGARITHMIC_DEPTH_BUFFER
	varying float vFragDepth;
	varying float vIsPerspective;
#endif`,Kv=`#ifdef USE_LOGARITHMIC_DEPTH_BUFFER
	vFragDepth = 1.0 + gl_Position.w;
	vIsPerspective = float( isPerspectiveMatrix( projectionMatrix ) );
#endif`,Qv=`#ifdef USE_MAP
	vec4 sampledDiffuseColor = texture2D( map, vMapUv );
	#ifdef DECODE_VIDEO_TEXTURE
		sampledDiffuseColor = sRGBTransferEOTF( sampledDiffuseColor );
	#endif
	diffuseColor *= sampledDiffuseColor;
#endif`,jv=`#ifdef USE_MAP
	uniform sampler2D map;
#endif`,tM=`#if defined( USE_MAP ) || defined( USE_ALPHAMAP )
	#if defined( USE_POINTS_UV )
		vec2 uv = vUv;
	#else
		vec2 uv = ( uvTransform * vec3( gl_PointCoord.x, 1.0 - gl_PointCoord.y, 1 ) ).xy;
	#endif
#endif
#ifdef USE_MAP
	diffuseColor *= texture2D( map, uv );
#endif
#ifdef USE_ALPHAMAP
	diffuseColor.a *= texture2D( alphaMap, uv ).g;
#endif`,eM=`#if defined( USE_POINTS_UV )
	varying vec2 vUv;
#else
	#if defined( USE_MAP ) || defined( USE_ALPHAMAP )
		uniform mat3 uvTransform;
	#endif
#endif
#ifdef USE_MAP
	uniform sampler2D map;
#endif
#ifdef USE_ALPHAMAP
	uniform sampler2D alphaMap;
#endif`,nM=`float metalnessFactor = metalness;
#ifdef USE_METALNESSMAP
	vec4 texelMetalness = texture2D( metalnessMap, vMetalnessMapUv );
	metalnessFactor *= texelMetalness.b;
#endif`,iM=`#ifdef USE_METALNESSMAP
	uniform sampler2D metalnessMap;
#endif`,sM=`#ifdef USE_INSTANCING_MORPH
	float morphTargetInfluences[ MORPHTARGETS_COUNT ];
	float morphTargetBaseInfluence = texelFetch( morphTexture, ivec2( 0, gl_InstanceID ), 0 ).r;
	for ( int i = 0; i < MORPHTARGETS_COUNT; i ++ ) {
		morphTargetInfluences[i] =  texelFetch( morphTexture, ivec2( i + 1, gl_InstanceID ), 0 ).r;
	}
#endif`,rM=`#if defined( USE_MORPHCOLORS )
	vColor *= morphTargetBaseInfluence;
	for ( int i = 0; i < MORPHTARGETS_COUNT; i ++ ) {
		#if defined( USE_COLOR_ALPHA )
			if ( morphTargetInfluences[ i ] != 0.0 ) vColor += getMorph( gl_VertexID, i, 2 ) * morphTargetInfluences[ i ];
		#elif defined( USE_COLOR )
			if ( morphTargetInfluences[ i ] != 0.0 ) vColor += getMorph( gl_VertexID, i, 2 ).rgb * morphTargetInfluences[ i ];
		#endif
	}
#endif`,oM=`#ifdef USE_MORPHNORMALS
	objectNormal *= morphTargetBaseInfluence;
	for ( int i = 0; i < MORPHTARGETS_COUNT; i ++ ) {
		if ( morphTargetInfluences[ i ] != 0.0 ) objectNormal += getMorph( gl_VertexID, i, 1 ).xyz * morphTargetInfluences[ i ];
	}
#endif`,aM=`#ifdef USE_MORPHTARGETS
	#ifndef USE_INSTANCING_MORPH
		uniform float morphTargetBaseInfluence;
		uniform float morphTargetInfluences[ MORPHTARGETS_COUNT ];
	#endif
	uniform sampler2DArray morphTargetsTexture;
	uniform ivec2 morphTargetsTextureSize;
	vec4 getMorph( const in int vertexIndex, const in int morphTargetIndex, const in int offset ) {
		int texelIndex = vertexIndex * MORPHTARGETS_TEXTURE_STRIDE + offset;
		int y = texelIndex / morphTargetsTextureSize.x;
		int x = texelIndex - y * morphTargetsTextureSize.x;
		ivec3 morphUV = ivec3( x, y, morphTargetIndex );
		return texelFetch( morphTargetsTexture, morphUV, 0 );
	}
#endif`,lM=`#ifdef USE_MORPHTARGETS
	transformed *= morphTargetBaseInfluence;
	for ( int i = 0; i < MORPHTARGETS_COUNT; i ++ ) {
		if ( morphTargetInfluences[ i ] != 0.0 ) transformed += getMorph( gl_VertexID, i, 0 ).xyz * morphTargetInfluences[ i ];
	}
#endif`,cM=`float faceDirection = gl_FrontFacing ? 1.0 : - 1.0;
#ifdef FLAT_SHADED
	vec3 fdx = dFdx( vViewPosition );
	vec3 fdy = dFdy( vViewPosition );
	vec3 normal = normalize( cross( fdx, fdy ) );
#else
	vec3 normal = normalize( vNormal );
	#ifdef DOUBLE_SIDED
		normal *= faceDirection;
	#endif
#endif
#if defined( USE_NORMALMAP_TANGENTSPACE ) || defined( USE_CLEARCOAT_NORMALMAP ) || defined( USE_ANISOTROPY )
	#ifdef USE_TANGENT
		mat3 tbn = mat3( normalize( vTangent ), normalize( vBitangent ), normal );
	#else
		mat3 tbn = getTangentFrame( - vViewPosition, normal,
		#if defined( USE_NORMALMAP )
			vNormalMapUv
		#elif defined( USE_CLEARCOAT_NORMALMAP )
			vClearcoatNormalMapUv
		#else
			vUv
		#endif
		);
	#endif
	#ifdef DOUBLE_SIDED
		tbn[0] *= faceDirection;
		tbn[1] *= faceDirection;
	#endif
#endif
#ifdef USE_CLEARCOAT_NORMALMAP
	#ifdef USE_TANGENT
		mat3 tbn2 = mat3( normalize( vTangent ), normalize( vBitangent ), normal );
	#else
		mat3 tbn2 = getTangentFrame( - vViewPosition, normal, vClearcoatNormalMapUv );
	#endif
	#ifdef DOUBLE_SIDED
		tbn2[0] *= faceDirection;
		tbn2[1] *= faceDirection;
	#endif
#endif
vec3 nonPerturbedNormal = normal;`,hM=`#ifdef USE_NORMALMAP_OBJECTSPACE
	normal = texture2D( normalMap, vNormalMapUv ).xyz * 2.0 - 1.0;
	#ifdef FLIP_SIDED
		normal = - normal;
	#endif
	#ifdef DOUBLE_SIDED
		normal = normal * faceDirection;
	#endif
	normal = normalize( normalMatrix * normal );
#elif defined( USE_NORMALMAP_TANGENTSPACE )
	vec3 mapN = texture2D( normalMap, vNormalMapUv ).xyz * 2.0 - 1.0;
	#if defined( USE_PACKED_NORMALMAP )
		mapN = vec3( mapN.xy, sqrt( saturate( 1.0 - dot( mapN.xy, mapN.xy ) ) ) );
	#endif
	mapN.xy *= normalScale;
	normal = normalize( tbn * mapN );
#elif defined( USE_BUMPMAP )
	normal = perturbNormalArb( - vViewPosition, normal, dHdxy_fwd(), faceDirection );
#endif`,uM=`#ifndef FLAT_SHADED
	varying vec3 vNormal;
	#ifdef USE_TANGENT
		varying vec3 vTangent;
		varying vec3 vBitangent;
	#endif
#endif`,fM=`#ifndef FLAT_SHADED
	varying vec3 vNormal;
	#ifdef USE_TANGENT
		varying vec3 vTangent;
		varying vec3 vBitangent;
	#endif
#endif`,dM=`#ifndef FLAT_SHADED
	vNormal = normalize( transformedNormal );
	#ifdef USE_TANGENT
		vTangent = normalize( transformedTangent );
		vBitangent = normalize( cross( vNormal, vTangent ) * tangent.w );
		#ifdef FLIP_SIDED
			vBitangent = - vBitangent;
		#endif
	#endif
#endif`,pM=`#ifdef USE_NORMALMAP
	uniform sampler2D normalMap;
	uniform vec2 normalScale;
#endif
#ifdef USE_NORMALMAP_OBJECTSPACE
	uniform mat3 normalMatrix;
#endif
#if ! defined ( USE_TANGENT ) && ( defined ( USE_NORMALMAP_TANGENTSPACE ) || defined ( USE_CLEARCOAT_NORMALMAP ) || defined( USE_ANISOTROPY ) )
	mat3 getTangentFrame( vec3 eye_pos, vec3 surf_norm, vec2 uv ) {
		vec3 q0 = dFdx( eye_pos.xyz );
		vec3 q1 = dFdy( eye_pos.xyz );
		vec2 st0 = dFdx( uv.st );
		vec2 st1 = dFdy( uv.st );
		vec3 N = surf_norm;
		vec3 q1perp = cross( q1, N );
		vec3 q0perp = cross( N, q0 );
		vec3 T = q1perp * st0.x + q0perp * st1.x;
		vec3 B = q1perp * st0.y + q0perp * st1.y;
		float det = max( dot( T, T ), dot( B, B ) );
		float scale = ( det == 0.0 ) ? 0.0 : inversesqrt( det );
		return mat3( T * scale, B * scale, N );
	}
#endif`,mM=`#ifdef USE_CLEARCOAT
	vec3 clearcoatNormal = nonPerturbedNormal;
#endif`,gM=`#ifdef USE_CLEARCOAT_NORMALMAP
	vec3 clearcoatMapN = texture2D( clearcoatNormalMap, vClearcoatNormalMapUv ).xyz * 2.0 - 1.0;
	clearcoatMapN.xy *= clearcoatNormalScale;
	clearcoatNormal = normalize( tbn2 * clearcoatMapN );
#endif`,xM=`#ifdef USE_CLEARCOATMAP
	uniform sampler2D clearcoatMap;
#endif
#ifdef USE_CLEARCOAT_NORMALMAP
	uniform sampler2D clearcoatNormalMap;
	uniform vec2 clearcoatNormalScale;
#endif
#ifdef USE_CLEARCOAT_ROUGHNESSMAP
	uniform sampler2D clearcoatRoughnessMap;
#endif`,_M=`#ifdef USE_IRIDESCENCEMAP
	uniform sampler2D iridescenceMap;
#endif
#ifdef USE_IRIDESCENCE_THICKNESSMAP
	uniform sampler2D iridescenceThicknessMap;
#endif`,yM=`#ifdef OPAQUE
diffuseColor.a = 1.0;
#endif
#ifdef USE_TRANSMISSION
diffuseColor.a *= material.transmissionAlpha;
#endif
gl_FragColor = vec4( outgoingLight, diffuseColor.a );`,vM=`vec3 packNormalToRGB( const in vec3 normal ) {
	return normalize( normal ) * 0.5 + 0.5;
}
vec3 unpackRGBToNormal( const in vec3 rgb ) {
	return 2.0 * rgb.xyz - 1.0;
}
const float PackUpscale = 256. / 255.;const float UnpackDownscale = 255. / 256.;const float ShiftRight8 = 1. / 256.;
const float Inv255 = 1. / 255.;
const vec4 PackFactors = vec4( 1.0, 256.0, 256.0 * 256.0, 256.0 * 256.0 * 256.0 );
const vec2 UnpackFactors2 = vec2( UnpackDownscale, 1.0 / PackFactors.g );
const vec3 UnpackFactors3 = vec3( UnpackDownscale / PackFactors.rg, 1.0 / PackFactors.b );
const vec4 UnpackFactors4 = vec4( UnpackDownscale / PackFactors.rgb, 1.0 / PackFactors.a );
vec4 packDepthToRGBA( const in float v ) {
	if( v <= 0.0 )
		return vec4( 0., 0., 0., 0. );
	if( v >= 1.0 )
		return vec4( 1., 1., 1., 1. );
	float vuf;
	float af = modf( v * PackFactors.a, vuf );
	float bf = modf( vuf * ShiftRight8, vuf );
	float gf = modf( vuf * ShiftRight8, vuf );
	return vec4( vuf * Inv255, gf * PackUpscale, bf * PackUpscale, af );
}
vec3 packDepthToRGB( const in float v ) {
	if( v <= 0.0 )
		return vec3( 0., 0., 0. );
	if( v >= 1.0 )
		return vec3( 1., 1., 1. );
	float vuf;
	float bf = modf( v * PackFactors.b, vuf );
	float gf = modf( vuf * ShiftRight8, vuf );
	return vec3( vuf * Inv255, gf * PackUpscale, bf );
}
vec2 packDepthToRG( const in float v ) {
	if( v <= 0.0 )
		return vec2( 0., 0. );
	if( v >= 1.0 )
		return vec2( 1., 1. );
	float vuf;
	float gf = modf( v * 256., vuf );
	return vec2( vuf * Inv255, gf );
}
float unpackRGBAToDepth( const in vec4 v ) {
	return dot( v, UnpackFactors4 );
}
float unpackRGBToDepth( const in vec3 v ) {
	return dot( v, UnpackFactors3 );
}
float unpackRGToDepth( const in vec2 v ) {
	return v.r * UnpackFactors2.r + v.g * UnpackFactors2.g;
}
vec4 pack2HalfToRGBA( const in vec2 v ) {
	vec4 r = vec4( v.x, fract( v.x * 255.0 ), v.y, fract( v.y * 255.0 ) );
	return vec4( r.x - r.y / 255.0, r.y, r.z - r.w / 255.0, r.w );
}
vec2 unpackRGBATo2Half( const in vec4 v ) {
	return vec2( v.x + ( v.y / 255.0 ), v.z + ( v.w / 255.0 ) );
}
float viewZToOrthographicDepth( const in float viewZ, const in float near, const in float far ) {
	return ( viewZ + near ) / ( near - far );
}
float orthographicDepthToViewZ( const in float depth, const in float near, const in float far ) {
	#ifdef USE_REVERSED_DEPTH_BUFFER
	
		return depth * ( far - near ) - far;
	#else
		return depth * ( near - far ) - near;
	#endif
}
float viewZToPerspectiveDepth( const in float viewZ, const in float near, const in float far ) {
	return ( ( near + viewZ ) * far ) / ( ( far - near ) * viewZ );
}
float perspectiveDepthToViewZ( const in float depth, const in float near, const in float far ) {
	
	#ifdef USE_REVERSED_DEPTH_BUFFER
		return ( near * far ) / ( ( near - far ) * depth - near );
	#else
		return ( near * far ) / ( ( far - near ) * depth - far );
	#endif
}`,MM=`#ifdef PREMULTIPLIED_ALPHA
	gl_FragColor.rgb *= gl_FragColor.a;
#endif`,SM=`vec4 mvPosition = vec4( transformed, 1.0 );
#ifdef USE_BATCHING
	mvPosition = batchingMatrix * mvPosition;
#endif
#ifdef USE_INSTANCING
	mvPosition = instanceMatrix * mvPosition;
#endif
mvPosition = modelViewMatrix * mvPosition;
gl_Position = projectionMatrix * mvPosition;`,bM=`#ifdef DITHERING
	gl_FragColor.rgb = dithering( gl_FragColor.rgb );
#endif`,EM=`#ifdef DITHERING
	vec3 dithering( vec3 color ) {
		float grid_position = rand( gl_FragCoord.xy );
		vec3 dither_shift_RGB = vec3( 0.25 / 255.0, -0.25 / 255.0, 0.25 / 255.0 );
		dither_shift_RGB = mix( 2.0 * dither_shift_RGB, -2.0 * dither_shift_RGB, grid_position );
		return color + dither_shift_RGB;
	}
#endif`,TM=`float roughnessFactor = roughness;
#ifdef USE_ROUGHNESSMAP
	vec4 texelRoughness = texture2D( roughnessMap, vRoughnessMapUv );
	roughnessFactor *= texelRoughness.g;
#endif`,wM=`#ifdef USE_ROUGHNESSMAP
	uniform sampler2D roughnessMap;
#endif`,AM=`#if NUM_SPOT_LIGHT_COORDS > 0
	varying vec4 vSpotLightCoord[ NUM_SPOT_LIGHT_COORDS ];
#endif
#if NUM_SPOT_LIGHT_MAPS > 0
	uniform sampler2D spotLightMap[ NUM_SPOT_LIGHT_MAPS ];
#endif
#ifdef USE_SHADOWMAP
	#if NUM_SUN_LIGHT_SHADOWS > 0
		#define SUN_LIGHT_CASCADES 2
		#if defined( SHADOWMAP_TYPE_PCF )
			uniform sampler2DShadow sunShadowMap[ NUM_SUN_LIGHT_SHADOWS ];
		#else
			uniform sampler2D sunShadowMap[ NUM_SUN_LIGHT_SHADOWS ];
		#endif
		uniform mat4 sunShadowMatrix[ NUM_SUN_LIGHT_SHADOWS * SUN_LIGHT_CASCADES ];
		uniform vec4 sunShadowCascade[ NUM_SUN_LIGHT_SHADOWS * SUN_LIGHT_CASCADES ];
		varying vec4 vSunShadowWorldPosition;
		varying vec3 vSunShadowWorldNormal;
		struct SunLightShadow {
			float shadowIntensity;
			float shadowBias;
			float shadowNormalBias;
			float shadowRadius;
			vec2 shadowMapSize;
		};
		uniform SunLightShadow sunLightShadows[ NUM_SUN_LIGHT_SHADOWS ];
	#endif
	#if NUM_DIR_LIGHT_SHADOWS > 0
		#if defined( SHADOWMAP_TYPE_PCF )
			uniform sampler2DShadow directionalShadowMap[ NUM_DIR_LIGHT_SHADOWS ];
		#else
			uniform sampler2D directionalShadowMap[ NUM_DIR_LIGHT_SHADOWS ];
		#endif
		varying vec4 vDirectionalShadowCoord[ NUM_DIR_LIGHT_SHADOWS ];
		struct DirectionalLightShadow {
			float shadowIntensity;
			float shadowBias;
			float shadowNormalBias;
			float shadowRadius;
			vec2 shadowMapSize;
		};
		uniform DirectionalLightShadow directionalLightShadows[ NUM_DIR_LIGHT_SHADOWS ];
	#endif
	#if NUM_SPOT_LIGHT_SHADOWS > 0
		#if defined( SHADOWMAP_TYPE_PCF )
			uniform sampler2DShadow spotShadowMap[ NUM_SPOT_LIGHT_SHADOWS ];
		#else
			uniform sampler2D spotShadowMap[ NUM_SPOT_LIGHT_SHADOWS ];
		#endif
		struct SpotLightShadow {
			float shadowIntensity;
			float shadowBias;
			float shadowNormalBias;
			float shadowRadius;
			vec2 shadowMapSize;
		};
		uniform SpotLightShadow spotLightShadows[ NUM_SPOT_LIGHT_SHADOWS ];
	#endif
	#if NUM_POINT_LIGHT_SHADOWS > 0
		#if defined( SHADOWMAP_TYPE_PCF )
			uniform samplerCubeShadow pointShadowMap[ NUM_POINT_LIGHT_SHADOWS ];
		#elif defined( SHADOWMAP_TYPE_BASIC )
			uniform samplerCube pointShadowMap[ NUM_POINT_LIGHT_SHADOWS ];
		#endif
		varying vec4 vPointShadowCoord[ NUM_POINT_LIGHT_SHADOWS ];
		struct PointLightShadow {
			float shadowIntensity;
			float shadowBias;
			float shadowNormalBias;
			float shadowRadius;
			vec2 shadowMapSize;
			float shadowCameraNear;
			float shadowCameraFar;
		};
		uniform PointLightShadow pointLightShadows[ NUM_POINT_LIGHT_SHADOWS ];
	#endif
	#if defined( SHADOWMAP_TYPE_PCF )
		float interleavedGradientNoise( vec2 position ) {
			return fract( 52.9829189 * fract( dot( position, vec2( 0.06711056, 0.00583715 ) ) ) );
		}
		vec2 vogelDiskSample( int sampleIndex, int samplesCount, float phi ) {
			const float goldenAngle = 2.399963229728653;
			float r = sqrt( ( float( sampleIndex ) + 0.5 ) / float( samplesCount ) );
			float theta = float( sampleIndex ) * goldenAngle + phi;
			return vec2( cos( theta ), sin( theta ) ) * r;
		}
	#endif
	#if defined( SHADOWMAP_TYPE_PCF )
		float getShadow( sampler2DShadow shadowMap, vec2 shadowMapSize, float shadowIntensity, float shadowBias, float shadowRadius, vec4 shadowCoord ) {
			float shadow = 1.0;
			shadowCoord.xyz /= shadowCoord.w;
			shadowCoord.z += shadowBias;
			bool inFrustum = shadowCoord.x >= 0.0 && shadowCoord.x <= 1.0 && shadowCoord.y >= 0.0 && shadowCoord.y <= 1.0;
			bool frustumTest = inFrustum && shadowCoord.z <= 1.0;
			if ( frustumTest ) {
				vec2 texelSize = vec2( 1.0 ) / shadowMapSize;
				float radius = shadowRadius * texelSize.x;
				float phi = interleavedGradientNoise( gl_FragCoord.xy ) * PI2;
				shadow = (
					texture( shadowMap, vec3( shadowCoord.xy + vogelDiskSample( 0, 5, phi ) * radius, shadowCoord.z ) ) +
					texture( shadowMap, vec3( shadowCoord.xy + vogelDiskSample( 1, 5, phi ) * radius, shadowCoord.z ) ) +
					texture( shadowMap, vec3( shadowCoord.xy + vogelDiskSample( 2, 5, phi ) * radius, shadowCoord.z ) ) +
					texture( shadowMap, vec3( shadowCoord.xy + vogelDiskSample( 3, 5, phi ) * radius, shadowCoord.z ) ) +
					texture( shadowMap, vec3( shadowCoord.xy + vogelDiskSample( 4, 5, phi ) * radius, shadowCoord.z ) )
				) * 0.2;
			}
			return mix( 1.0, shadow, shadowIntensity );
		}
	#elif defined( SHADOWMAP_TYPE_VSM )
		float getShadow( sampler2D shadowMap, vec2 shadowMapSize, float shadowIntensity, float shadowBias, float shadowRadius, vec4 shadowCoord ) {
			float shadow = 1.0;
			shadowCoord.xyz /= shadowCoord.w;
			#ifdef USE_REVERSED_DEPTH_BUFFER
				shadowCoord.z -= shadowBias;
			#else
				shadowCoord.z += shadowBias;
			#endif
			bool inFrustum = shadowCoord.x >= 0.0 && shadowCoord.x <= 1.0 && shadowCoord.y >= 0.0 && shadowCoord.y <= 1.0;
			bool frustumTest = inFrustum && shadowCoord.z <= 1.0;
			if ( frustumTest ) {
				vec2 distribution = texture2D( shadowMap, shadowCoord.xy ).rg;
				float mean = distribution.x;
				float variance = distribution.y * distribution.y;
				#ifdef USE_REVERSED_DEPTH_BUFFER
					float hard_shadow = step( mean, shadowCoord.z );
				#else
					float hard_shadow = step( shadowCoord.z, mean );
				#endif
				
				if ( hard_shadow == 1.0 ) {
					shadow = 1.0;
				} else {
					variance = max( variance, 0.0000001 );
					float d = shadowCoord.z - mean;
					float p_max = variance / ( variance + d * d );
					p_max = clamp( ( p_max - 0.3 ) / 0.65, 0.0, 1.0 );
					shadow = max( hard_shadow, p_max );
				}
			}
			return mix( 1.0, shadow, shadowIntensity );
		}
	#else
		float getShadow( sampler2D shadowMap, vec2 shadowMapSize, float shadowIntensity, float shadowBias, float shadowRadius, vec4 shadowCoord ) {
			float shadow = 1.0;
			shadowCoord.xyz /= shadowCoord.w;
			#ifdef USE_REVERSED_DEPTH_BUFFER
				shadowCoord.z -= shadowBias;
			#else
				shadowCoord.z += shadowBias;
			#endif
			bool inFrustum = shadowCoord.x >= 0.0 && shadowCoord.x <= 1.0 && shadowCoord.y >= 0.0 && shadowCoord.y <= 1.0;
			bool frustumTest = inFrustum && shadowCoord.z <= 1.0;
			if ( frustumTest ) {
				float depth = texture2D( shadowMap, shadowCoord.xy ).r;
				#ifdef USE_REVERSED_DEPTH_BUFFER
					shadow = step( depth, shadowCoord.z );
				#else
					shadow = step( shadowCoord.z, depth );
				#endif
			}
			return mix( 1.0, shadow, shadowIntensity );
		}
	#endif
	#if NUM_SUN_LIGHT_SHADOWS > 0
		float getSunShadow(
			#if defined( SHADOWMAP_TYPE_PCF )
				sampler2DShadow shadowMap,
			#else
				sampler2D shadowMap,
			#endif
			SunLightShadow sunLightShadow,
			int shadowIndex
		) {
			vec4 shadowWorldPosition = vec4( vSunShadowWorldPosition.xyz + vSunShadowWorldNormal * sunLightShadow.shadowNormalBias, 1.0 );
			float viewDepth = vSunShadowWorldPosition.w;
			int cascadeOffset = shadowIndex * SUN_LIGHT_CASCADES;
			float shadow = 1.0;
			for ( int i = SUN_LIGHT_CASCADES - 1; i >= 0; i -- ) {
				vec4 cascade = sunShadowCascade[ cascadeOffset + i ];
				if ( viewDepth >= cascade.x && viewDepth < cascade.y ) {
					float cascadeShadow = getShadow(
						shadowMap,
						sunLightShadow.shadowMapSize,
						sunLightShadow.shadowIntensity,
						sunLightShadow.shadowBias,
						sunLightShadow.shadowRadius,
						sunShadowMatrix[ cascadeOffset + i ] * shadowWorldPosition
					);
					shadow = mix( cascadeShadow, shadow, smoothstep( cascade.z, cascade.y, viewDepth ) );
				}
			}
			return shadow;
		}
	#endif
	#if NUM_POINT_LIGHT_SHADOWS > 0
	#if defined( SHADOWMAP_TYPE_PCF )
	float getPointShadow( samplerCubeShadow shadowMap, vec2 shadowMapSize, float shadowIntensity, float shadowBias, float shadowRadius, vec4 shadowCoord, float shadowCameraNear, float shadowCameraFar ) {
		float shadow = 1.0;
		vec3 lightToPosition = shadowCoord.xyz;
		vec3 bd3D = normalize( lightToPosition );
		vec3 absVec = abs( lightToPosition );
		float viewSpaceZ = max( max( absVec.x, absVec.y ), absVec.z );
		if ( viewSpaceZ - shadowCameraFar <= 0.0 && viewSpaceZ - shadowCameraNear >= 0.0 ) {
			#ifdef USE_REVERSED_DEPTH_BUFFER
				float dp = ( shadowCameraNear * ( shadowCameraFar - viewSpaceZ ) ) / ( viewSpaceZ * ( shadowCameraFar - shadowCameraNear ) );
				dp -= shadowBias;
			#else
				float dp = ( shadowCameraFar * ( viewSpaceZ - shadowCameraNear ) ) / ( viewSpaceZ * ( shadowCameraFar - shadowCameraNear ) );
				dp += shadowBias;
			#endif
			float texelSize = shadowRadius / shadowMapSize.x;
			vec3 absDir = abs( bd3D );
			vec3 tangent = absDir.x > absDir.z ? vec3( 0.0, 1.0, 0.0 ) : vec3( 1.0, 0.0, 0.0 );
			tangent = normalize( cross( bd3D, tangent ) );
			vec3 bitangent = cross( bd3D, tangent );
			float phi = interleavedGradientNoise( gl_FragCoord.xy ) * PI2;
			vec2 sample0 = vogelDiskSample( 0, 5, phi );
			vec2 sample1 = vogelDiskSample( 1, 5, phi );
			vec2 sample2 = vogelDiskSample( 2, 5, phi );
			vec2 sample3 = vogelDiskSample( 3, 5, phi );
			vec2 sample4 = vogelDiskSample( 4, 5, phi );
			shadow = (
				texture( shadowMap, vec4( bd3D + ( tangent * sample0.x + bitangent * sample0.y ) * texelSize, dp ) ) +
				texture( shadowMap, vec4( bd3D + ( tangent * sample1.x + bitangent * sample1.y ) * texelSize, dp ) ) +
				texture( shadowMap, vec4( bd3D + ( tangent * sample2.x + bitangent * sample2.y ) * texelSize, dp ) ) +
				texture( shadowMap, vec4( bd3D + ( tangent * sample3.x + bitangent * sample3.y ) * texelSize, dp ) ) +
				texture( shadowMap, vec4( bd3D + ( tangent * sample4.x + bitangent * sample4.y ) * texelSize, dp ) )
			) * 0.2;
		}
		return mix( 1.0, shadow, shadowIntensity );
	}
	#elif defined( SHADOWMAP_TYPE_BASIC )
	float getPointShadow( samplerCube shadowMap, vec2 shadowMapSize, float shadowIntensity, float shadowBias, float shadowRadius, vec4 shadowCoord, float shadowCameraNear, float shadowCameraFar ) {
		float shadow = 1.0;
		vec3 lightToPosition = shadowCoord.xyz;
		vec3 absVec = abs( lightToPosition );
		float viewSpaceZ = max( max( absVec.x, absVec.y ), absVec.z );
		if ( viewSpaceZ - shadowCameraFar <= 0.0 && viewSpaceZ - shadowCameraNear >= 0.0 ) {
			float dp = ( shadowCameraFar * ( viewSpaceZ - shadowCameraNear ) ) / ( viewSpaceZ * ( shadowCameraFar - shadowCameraNear ) );
			dp += shadowBias;
			vec3 bd3D = normalize( lightToPosition );
			float depth = textureCube( shadowMap, bd3D ).r;
			#ifdef USE_REVERSED_DEPTH_BUFFER
				depth = 1.0 - depth;
			#endif
			shadow = step( dp, depth );
		}
		return mix( 1.0, shadow, shadowIntensity );
	}
	#endif
	#endif
#endif`,RM=`#if NUM_SPOT_LIGHT_COORDS > 0
	uniform mat4 spotLightMatrix[ NUM_SPOT_LIGHT_COORDS ];
	varying vec4 vSpotLightCoord[ NUM_SPOT_LIGHT_COORDS ];
#endif
#ifdef USE_SHADOWMAP
	#if NUM_SUN_LIGHT_SHADOWS > 0
		varying vec4 vSunShadowWorldPosition;
		varying vec3 vSunShadowWorldNormal;
	#endif
	#if NUM_DIR_LIGHT_SHADOWS > 0
		uniform mat4 directionalShadowMatrix[ NUM_DIR_LIGHT_SHADOWS ];
		varying vec4 vDirectionalShadowCoord[ NUM_DIR_LIGHT_SHADOWS ];
		struct DirectionalLightShadow {
			float shadowIntensity;
			float shadowBias;
			float shadowNormalBias;
			float shadowRadius;
			vec2 shadowMapSize;
		};
		uniform DirectionalLightShadow directionalLightShadows[ NUM_DIR_LIGHT_SHADOWS ];
	#endif
	#if NUM_SPOT_LIGHT_SHADOWS > 0
		struct SpotLightShadow {
			float shadowIntensity;
			float shadowBias;
			float shadowNormalBias;
			float shadowRadius;
			vec2 shadowMapSize;
		};
		uniform SpotLightShadow spotLightShadows[ NUM_SPOT_LIGHT_SHADOWS ];
	#endif
	#if NUM_POINT_LIGHT_SHADOWS > 0
		uniform mat4 pointShadowMatrix[ NUM_POINT_LIGHT_SHADOWS ];
		varying vec4 vPointShadowCoord[ NUM_POINT_LIGHT_SHADOWS ];
		struct PointLightShadow {
			float shadowIntensity;
			float shadowBias;
			float shadowNormalBias;
			float shadowRadius;
			vec2 shadowMapSize;
			float shadowCameraNear;
			float shadowCameraFar;
		};
		uniform PointLightShadow pointLightShadows[ NUM_POINT_LIGHT_SHADOWS ];
	#endif
#endif`,CM=`#if ( defined( USE_SHADOWMAP ) && ( NUM_DIR_LIGHT_SHADOWS > 0 || NUM_SUN_LIGHT_SHADOWS > 0 || NUM_POINT_LIGHT_SHADOWS > 0 ) ) || ( NUM_SPOT_LIGHT_COORDS > 0 )
	#ifdef HAS_NORMAL
		vec3 shadowWorldNormal = transformNormalByInverseViewMatrix( transformedNormal, viewMatrix );
	#else
		vec3 shadowWorldNormal = vec3( 0.0 );
	#endif
	vec4 shadowWorldPosition;
#endif
#if defined( USE_SHADOWMAP )
	#if NUM_SUN_LIGHT_SHADOWS > 0
		vSunShadowWorldPosition = vec4( worldPosition.xyz, - mvPosition.z );
		vSunShadowWorldNormal = shadowWorldNormal;
	#endif
	#if NUM_DIR_LIGHT_SHADOWS > 0
		#pragma unroll_loop_start
		for ( int i = 0; i < NUM_DIR_LIGHT_SHADOWS; i ++ ) {
			shadowWorldPosition = worldPosition + vec4( shadowWorldNormal * directionalLightShadows[ i ].shadowNormalBias, 0 );
			vDirectionalShadowCoord[ i ] = directionalShadowMatrix[ i ] * shadowWorldPosition;
		}
		#pragma unroll_loop_end
	#endif
	#if NUM_POINT_LIGHT_SHADOWS > 0
		#pragma unroll_loop_start
		for ( int i = 0; i < NUM_POINT_LIGHT_SHADOWS; i ++ ) {
			shadowWorldPosition = worldPosition + vec4( shadowWorldNormal * pointLightShadows[ i ].shadowNormalBias, 0 );
			vPointShadowCoord[ i ] = pointShadowMatrix[ i ] * shadowWorldPosition;
		}
		#pragma unroll_loop_end
	#endif
#endif
#if NUM_SPOT_LIGHT_COORDS > 0
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_SPOT_LIGHT_COORDS; i ++ ) {
		shadowWorldPosition = worldPosition;
		#if ( defined( USE_SHADOWMAP ) && UNROLLED_LOOP_INDEX < NUM_SPOT_LIGHT_SHADOWS )
			shadowWorldPosition.xyz += shadowWorldNormal * spotLightShadows[ i ].shadowNormalBias;
		#endif
		vSpotLightCoord[ i ] = spotLightMatrix[ i ] * shadowWorldPosition;
	}
	#pragma unroll_loop_end
#endif`,IM=`float getShadowMask() {
	float shadow = 1.0;
	#ifdef USE_SHADOWMAP
	#if NUM_SUN_LIGHT_SHADOWS > 0
	SunLightShadow sunLight;
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_SUN_LIGHT_SHADOWS; i ++ ) {
		sunLight = sunLightShadows[ i ];
		shadow *= receiveShadow ? getSunShadow( sunShadowMap[ i ], sunLight, UNROLLED_LOOP_INDEX ) : 1.0;
	}
	#pragma unroll_loop_end
	#endif
	#if NUM_DIR_LIGHT_SHADOWS > 0
	DirectionalLightShadow directionalLight;
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_DIR_LIGHT_SHADOWS; i ++ ) {
		directionalLight = directionalLightShadows[ i ];
		shadow *= receiveShadow ? getShadow( directionalShadowMap[ i ], directionalLight.shadowMapSize, directionalLight.shadowIntensity, directionalLight.shadowBias, directionalLight.shadowRadius, vDirectionalShadowCoord[ i ] ) : 1.0;
	}
	#pragma unroll_loop_end
	#endif
	#if NUM_SPOT_LIGHT_SHADOWS > 0
	SpotLightShadow spotLight;
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_SPOT_LIGHT_SHADOWS; i ++ ) {
		spotLight = spotLightShadows[ i ];
		shadow *= receiveShadow ? getShadow( spotShadowMap[ i ], spotLight.shadowMapSize, spotLight.shadowIntensity, spotLight.shadowBias, spotLight.shadowRadius, vSpotLightCoord[ i ] ) : 1.0;
	}
	#pragma unroll_loop_end
	#endif
	#if NUM_POINT_LIGHT_SHADOWS > 0 && ( defined( SHADOWMAP_TYPE_PCF ) || defined( SHADOWMAP_TYPE_BASIC ) )
	PointLightShadow pointLight;
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_POINT_LIGHT_SHADOWS; i ++ ) {
		pointLight = pointLightShadows[ i ];
		shadow *= receiveShadow ? getPointShadow( pointShadowMap[ i ], pointLight.shadowMapSize, pointLight.shadowIntensity, pointLight.shadowBias, pointLight.shadowRadius, vPointShadowCoord[ i ], pointLight.shadowCameraNear, pointLight.shadowCameraFar ) : 1.0;
	}
	#pragma unroll_loop_end
	#endif
	#endif
	return shadow;
}`,PM=`#ifdef USE_SKINNING
	mat4 boneMatX = getBoneMatrix( skinIndex.x );
	mat4 boneMatY = getBoneMatrix( skinIndex.y );
	mat4 boneMatZ = getBoneMatrix( skinIndex.z );
	mat4 boneMatW = getBoneMatrix( skinIndex.w );
#endif`,LM=`#ifdef USE_SKINNING
	uniform mat4 bindMatrix;
	uniform mat4 bindMatrixInverse;
	uniform highp sampler2D boneTexture;
	mat4 getBoneMatrix( const in float i ) {
		int size = textureSize( boneTexture, 0 ).x;
		int j = int( i ) * 4;
		int x = j % size;
		int y = j / size;
		vec4 v1 = texelFetch( boneTexture, ivec2( x, y ), 0 );
		vec4 v2 = texelFetch( boneTexture, ivec2( x + 1, y ), 0 );
		vec4 v3 = texelFetch( boneTexture, ivec2( x + 2, y ), 0 );
		vec4 v4 = texelFetch( boneTexture, ivec2( x + 3, y ), 0 );
		return mat4( v1, v2, v3, v4 );
	}
#endif`,DM=`#ifdef USE_SKINNING
	vec4 skinVertex = bindMatrix * vec4( transformed, 1.0 );
	vec4 skinned = vec4( 0.0 );
	skinned += boneMatX * skinVertex * skinWeight.x;
	skinned += boneMatY * skinVertex * skinWeight.y;
	skinned += boneMatZ * skinVertex * skinWeight.z;
	skinned += boneMatW * skinVertex * skinWeight.w;
	transformed = ( bindMatrixInverse * skinned ).xyz;
#endif`,NM=`#ifdef USE_SKINNING
	mat4 skinMatrix = mat4( 0.0 );
	skinMatrix += skinWeight.x * boneMatX;
	skinMatrix += skinWeight.y * boneMatY;
	skinMatrix += skinWeight.z * boneMatZ;
	skinMatrix += skinWeight.w * boneMatW;
	skinMatrix = bindMatrixInverse * skinMatrix * bindMatrix;
	objectNormal = vec4( skinMatrix * vec4( objectNormal, 0.0 ) ).xyz;
	#ifdef USE_TANGENT
		objectTangent = vec4( skinMatrix * vec4( objectTangent, 0.0 ) ).xyz;
	#endif
#endif`,UM=`float specularStrength;
#ifdef USE_SPECULARMAP
	vec4 texelSpecular = texture2D( specularMap, vSpecularMapUv );
	specularStrength = texelSpecular.r;
#else
	specularStrength = 1.0;
#endif`,FM=`#ifdef USE_SPECULARMAP
	uniform sampler2D specularMap;
#endif`,OM=`#if defined( TONE_MAPPING )
	gl_FragColor.rgb = toneMapping( gl_FragColor.rgb );
#endif`,BM=`#ifndef saturate
#define saturate( a ) clamp( a, 0.0, 1.0 )
#endif
uniform float toneMappingExposure;
vec3 LinearToneMapping( vec3 color ) {
	return saturate( toneMappingExposure * color );
}
vec3 ReinhardToneMapping( vec3 color ) {
	color *= toneMappingExposure;
	return saturate( color / ( vec3( 1.0 ) + color ) );
}
vec3 CineonToneMapping( vec3 color ) {
	color *= toneMappingExposure;
	color = max( vec3( 0.0 ), color - 0.004 );
	return pow( ( color * ( 6.2 * color + 0.5 ) ) / ( color * ( 6.2 * color + 1.7 ) + 0.06 ), vec3( 2.2 ) );
}
vec3 RRTAndODTFit( vec3 v ) {
	vec3 a = v * ( v + 0.0245786 ) - 0.000090537;
	vec3 b = v * ( 0.983729 * v + 0.4329510 ) + 0.238081;
	return a / b;
}
vec3 ACESFilmicToneMapping( vec3 color ) {
	const mat3 ACESInputMat = mat3(
		vec3( 0.59719, 0.07600, 0.02840 ),		vec3( 0.35458, 0.90834, 0.13383 ),
		vec3( 0.04823, 0.01566, 0.83777 )
	);
	const mat3 ACESOutputMat = mat3(
		vec3(  1.60475, -0.10208, -0.00327 ),		vec3( -0.53108,  1.10813, -0.07276 ),
		vec3( -0.07367, -0.00605,  1.07602 )
	);
	color *= toneMappingExposure / 0.6;
	color = ACESInputMat * color;
	color = RRTAndODTFit( color );
	color = ACESOutputMat * color;
	return saturate( color );
}
const mat3 LINEAR_REC2020_TO_LINEAR_SRGB = mat3(
	vec3( 1.6605, - 0.1246, - 0.0182 ),
	vec3( - 0.5876, 1.1329, - 0.1006 ),
	vec3( - 0.0728, - 0.0083, 1.1187 )
);
const mat3 LINEAR_SRGB_TO_LINEAR_REC2020 = mat3(
	vec3( 0.6274, 0.0691, 0.0164 ),
	vec3( 0.3293, 0.9195, 0.0880 ),
	vec3( 0.0433, 0.0113, 0.8956 )
);
vec3 agxDefaultContrastApprox( vec3 x ) {
	vec3 x2 = x * x;
	vec3 x4 = x2 * x2;
	return + 15.5 * x4 * x2
		- 40.14 * x4 * x
		+ 31.96 * x4
		- 6.868 * x2 * x
		+ 0.4298 * x2
		+ 0.1191 * x
		- 0.00232;
}
vec3 AgXToneMapping( vec3 color ) {
	const mat3 AgXInsetMatrix = mat3(
		vec3( 0.856627153315983, 0.137318972929847, 0.11189821299995 ),
		vec3( 0.0951212405381588, 0.761241990602591, 0.0767994186031903 ),
		vec3( 0.0482516061458583, 0.101439036467562, 0.811302368396859 )
	);
	const mat3 AgXOutsetMatrix = mat3(
		vec3( 1.1271005818144368, - 0.1413297634984383, - 0.14132976349843826 ),
		vec3( - 0.11060664309660323, 1.157823702216272, - 0.11060664309660294 ),
		vec3( - 0.016493938717834573, - 0.016493938717834257, 1.2519364065950405 )
	);
	const float AgxMinEv = - 12.47393;	const float AgxMaxEv = 4.026069;
	color *= toneMappingExposure;
	color = LINEAR_SRGB_TO_LINEAR_REC2020 * color;
	color = AgXInsetMatrix * color;
	color = max( color, 1e-10 );	color = log2( color );
	color = ( color - AgxMinEv ) / ( AgxMaxEv - AgxMinEv );
	color = clamp( color, 0.0, 1.0 );
	color = agxDefaultContrastApprox( color );
	color = AgXOutsetMatrix * color;
	color = pow( max( vec3( 0.0 ), color ), vec3( 2.2 ) );
	color = LINEAR_REC2020_TO_LINEAR_SRGB * color;
	color = clamp( color, 0.0, 1.0 );
	return color;
}
vec3 NeutralToneMapping( vec3 color ) {
	const float StartCompression = 0.8 - 0.04;
	const float Desaturation = 0.15;
	color *= toneMappingExposure;
	float x = min( color.r, min( color.g, color.b ) );
	float offset = x < 0.08 ? x - 6.25 * x * x : 0.04;
	color -= offset;
	float peak = max( color.r, max( color.g, color.b ) );
	if ( peak < StartCompression ) return color;
	float d = 1. - StartCompression;
	float newPeak = 1. - d * d / ( peak + d - StartCompression );
	color *= newPeak / peak;
	float g = 1. - 1. / ( Desaturation * ( peak - newPeak ) + 1. );
	return mix( color, vec3( newPeak ), g );
}
vec3 CustomToneMapping( vec3 color ) { return color; }`,zM=`#ifdef USE_TRANSMISSION
	material.transmission = transmission;
	material.transmissionAlpha = 1.0;
	material.thickness = thickness;
	material.attenuationDistance = attenuationDistance;
	material.attenuationColor = attenuationColor;
	#ifdef USE_TRANSMISSIONMAP
		material.transmission *= texture2D( transmissionMap, vTransmissionMapUv ).r;
	#endif
	#ifdef USE_THICKNESSMAP
		material.thickness *= texture2D( thicknessMap, vThicknessMapUv ).g;
	#endif
	vec3 pos = vWorldPosition;
	vec3 v = normalize( cameraPosition - pos );
	vec3 n = transformNormalByInverseViewMatrix( normal, viewMatrix );
	vec4 transmitted = getIBLVolumeRefraction(
		n, v, material.roughness, material.diffuseContribution, material.specularColorBlended, material.specularF90,
		pos, modelMatrix, viewMatrix, projectionMatrix, material.dispersion, material.ior, material.thickness,
		material.attenuationColor, material.attenuationDistance );
	material.transmissionAlpha = mix( material.transmissionAlpha, transmitted.a, material.transmission );
	totalDiffuse = mix( totalDiffuse, transmitted.rgb, material.transmission );
#endif`,kM=`#ifdef USE_TRANSMISSION
	uniform float transmission;
	uniform float thickness;
	uniform float attenuationDistance;
	uniform vec3 attenuationColor;
	#ifdef USE_TRANSMISSIONMAP
		uniform sampler2D transmissionMap;
	#endif
	#ifdef USE_THICKNESSMAP
		uniform sampler2D thicknessMap;
	#endif
	uniform vec2 transmissionSamplerSize;
	uniform sampler2D transmissionSamplerMap;
	uniform mat4 modelMatrix;
	uniform mat4 projectionMatrix;
	varying vec3 vWorldPosition;
	float w0( float a ) {
		return ( 1.0 / 6.0 ) * ( a * ( a * ( - a + 3.0 ) - 3.0 ) + 1.0 );
	}
	float w1( float a ) {
		return ( 1.0 / 6.0 ) * ( a *  a * ( 3.0 * a - 6.0 ) + 4.0 );
	}
	float w2( float a ){
		return ( 1.0 / 6.0 ) * ( a * ( a * ( - 3.0 * a + 3.0 ) + 3.0 ) + 1.0 );
	}
	float w3( float a ) {
		return ( 1.0 / 6.0 ) * ( a * a * a );
	}
	float g0( float a ) {
		return w0( a ) + w1( a );
	}
	float g1( float a ) {
		return w2( a ) + w3( a );
	}
	float h0( float a ) {
		return - 1.0 + w1( a ) / ( w0( a ) + w1( a ) );
	}
	float h1( float a ) {
		return 1.0 + w3( a ) / ( w2( a ) + w3( a ) );
	}
	vec4 bicubic( sampler2D tex, vec2 uv, vec4 texelSize, float lod ) {
		uv = uv * texelSize.zw + 0.5;
		vec2 iuv = floor( uv );
		vec2 fuv = fract( uv );
		float g0x = g0( fuv.x );
		float g1x = g1( fuv.x );
		float h0x = h0( fuv.x );
		float h1x = h1( fuv.x );
		float h0y = h0( fuv.y );
		float h1y = h1( fuv.y );
		vec2 p0 = ( vec2( iuv.x + h0x, iuv.y + h0y ) - 0.5 ) * texelSize.xy;
		vec2 p1 = ( vec2( iuv.x + h1x, iuv.y + h0y ) - 0.5 ) * texelSize.xy;
		vec2 p2 = ( vec2( iuv.x + h0x, iuv.y + h1y ) - 0.5 ) * texelSize.xy;
		vec2 p3 = ( vec2( iuv.x + h1x, iuv.y + h1y ) - 0.5 ) * texelSize.xy;
		return g0( fuv.y ) * ( g0x * textureLod( tex, p0, lod ) + g1x * textureLod( tex, p1, lod ) ) +
			g1( fuv.y ) * ( g0x * textureLod( tex, p2, lod ) + g1x * textureLod( tex, p3, lod ) );
	}
	vec4 textureBicubic( sampler2D sampler, vec2 uv, float lod ) {
		vec2 fLodSize = vec2( textureSize( sampler, int( lod ) ) );
		vec2 cLodSize = vec2( textureSize( sampler, int( lod + 1.0 ) ) );
		vec2 fLodSizeInv = 1.0 / fLodSize;
		vec2 cLodSizeInv = 1.0 / cLodSize;
		vec4 fSample = bicubic( sampler, uv, vec4( fLodSizeInv, fLodSize ), floor( lod ) );
		vec4 cSample = bicubic( sampler, uv, vec4( cLodSizeInv, cLodSize ), ceil( lod ) );
		return mix( fSample, cSample, fract( lod ) );
	}
	vec3 getVolumeTransmissionRay( const in vec3 n, const in vec3 v, const in float thickness, const in float ior, const in mat4 modelMatrix ) {
		vec3 refractionVector = refract( - v, normalize( n ), 1.0 / ior );
		vec3 modelScale;
		modelScale.x = length( vec3( modelMatrix[ 0 ].xyz ) );
		modelScale.y = length( vec3( modelMatrix[ 1 ].xyz ) );
		modelScale.z = length( vec3( modelMatrix[ 2 ].xyz ) );
		return normalize( refractionVector ) * thickness * modelScale;
	}
	float applyIorToRoughness( const in float roughness, const in float ior ) {
		return roughness * clamp( ior * 2.0 - 2.0, 0.0, 1.0 );
	}
	vec4 getTransmissionSample( const in vec2 fragCoord, const in float roughness, const in float ior ) {
		float lod = log2( transmissionSamplerSize.x ) * applyIorToRoughness( roughness, ior );
		return textureBicubic( transmissionSamplerMap, fragCoord.xy, lod );
	}
	vec3 volumeAttenuation( const in float transmissionDistance, const in vec3 attenuationColor, const in float attenuationDistance ) {
		if ( isinf( attenuationDistance ) ) {
			return vec3( 1.0 );
		} else {
			vec3 attenuationCoefficient = -log( attenuationColor ) / attenuationDistance;
			vec3 transmittance = exp( - attenuationCoefficient * transmissionDistance );			return transmittance;
		}
	}
	vec4 getIBLVolumeRefraction( const in vec3 n, const in vec3 v, const in float roughness, const in vec3 diffuseColor,
		const in vec3 specularColor, const in float specularF90, const in vec3 position, const in mat4 modelMatrix,
		const in mat4 viewMatrix, const in mat4 projMatrix, const in float dispersion, const in float ior, const in float thickness,
		const in vec3 attenuationColor, const in float attenuationDistance ) {
		vec4 transmittedLight;
		vec3 transmittance;
		#ifdef USE_DISPERSION
			float halfSpread = ( ior - 1.0 ) * 0.025 * dispersion;
			vec3 iors = vec3( ior - halfSpread, ior, ior + halfSpread );
			for ( int i = 0; i < 3; i ++ ) {
				vec3 transmissionRay = getVolumeTransmissionRay( n, v, thickness, iors[ i ], modelMatrix );
				vec3 refractedRayExit = position + transmissionRay;
				vec4 ndcPos = projMatrix * viewMatrix * vec4( refractedRayExit, 1.0 );
				vec2 refractionCoords = ndcPos.xy / ndcPos.w;
				refractionCoords += 1.0;
				refractionCoords /= 2.0;
				vec4 transmissionSample = getTransmissionSample( refractionCoords, roughness, iors[ i ] );
				transmittedLight[ i ] = transmissionSample[ i ];
				transmittedLight.a += transmissionSample.a;
				transmittance[ i ] = diffuseColor[ i ] * volumeAttenuation( length( transmissionRay ), attenuationColor, attenuationDistance )[ i ];
			}
			transmittedLight.a /= 3.0;
		#else
			vec3 transmissionRay = getVolumeTransmissionRay( n, v, thickness, ior, modelMatrix );
			vec3 refractedRayExit = position + transmissionRay;
			vec4 ndcPos = projMatrix * viewMatrix * vec4( refractedRayExit, 1.0 );
			vec2 refractionCoords = ndcPos.xy / ndcPos.w;
			refractionCoords += 1.0;
			refractionCoords /= 2.0;
			transmittedLight = getTransmissionSample( refractionCoords, roughness, ior );
			transmittance = diffuseColor * volumeAttenuation( length( transmissionRay ), attenuationColor, attenuationDistance );
		#endif
		vec3 attenuatedColor = transmittance * transmittedLight.rgb;
		vec3 F = EnvironmentBRDF( n, v, specularColor, specularF90, roughness );
		float transmittanceFactor = ( transmittance.r + transmittance.g + transmittance.b ) / 3.0;
		return vec4( ( 1.0 - F ) * attenuatedColor, 1.0 - ( 1.0 - transmittedLight.a ) * transmittanceFactor );
	}
#endif`,GM=`#if defined( USE_UV ) || defined( USE_ANISOTROPY )
	varying vec2 vUv;
#endif
#ifdef USE_MAP
	varying vec2 vMapUv;
#endif
#ifdef USE_ALPHAMAP
	varying vec2 vAlphaMapUv;
#endif
#ifdef USE_LIGHTMAP
	varying vec2 vLightMapUv;
#endif
#ifdef USE_AOMAP
	varying vec2 vAoMapUv;
#endif
#ifdef USE_BUMPMAP
	varying vec2 vBumpMapUv;
#endif
#ifdef USE_NORMALMAP
	varying vec2 vNormalMapUv;
#endif
#ifdef USE_EMISSIVEMAP
	varying vec2 vEmissiveMapUv;
#endif
#ifdef USE_METALNESSMAP
	varying vec2 vMetalnessMapUv;
#endif
#ifdef USE_ROUGHNESSMAP
	varying vec2 vRoughnessMapUv;
#endif
#ifdef USE_ANISOTROPYMAP
	varying vec2 vAnisotropyMapUv;
#endif
#ifdef USE_CLEARCOATMAP
	varying vec2 vClearcoatMapUv;
#endif
#ifdef USE_CLEARCOAT_NORMALMAP
	varying vec2 vClearcoatNormalMapUv;
#endif
#ifdef USE_CLEARCOAT_ROUGHNESSMAP
	varying vec2 vClearcoatRoughnessMapUv;
#endif
#ifdef USE_IRIDESCENCEMAP
	varying vec2 vIridescenceMapUv;
#endif
#ifdef USE_IRIDESCENCE_THICKNESSMAP
	varying vec2 vIridescenceThicknessMapUv;
#endif
#ifdef USE_SHEEN_COLORMAP
	varying vec2 vSheenColorMapUv;
#endif
#ifdef USE_SHEEN_ROUGHNESSMAP
	varying vec2 vSheenRoughnessMapUv;
#endif
#ifdef USE_SPECULARMAP
	varying vec2 vSpecularMapUv;
#endif
#ifdef USE_SPECULAR_COLORMAP
	varying vec2 vSpecularColorMapUv;
#endif
#ifdef USE_SPECULAR_INTENSITYMAP
	varying vec2 vSpecularIntensityMapUv;
#endif
#ifdef USE_TRANSMISSIONMAP
	uniform mat3 transmissionMapTransform;
	varying vec2 vTransmissionMapUv;
#endif
#ifdef USE_THICKNESSMAP
	uniform mat3 thicknessMapTransform;
	varying vec2 vThicknessMapUv;
#endif`,VM=`#if defined( USE_UV ) || defined( USE_ANISOTROPY )
	varying vec2 vUv;
#endif
#ifdef USE_MAP
	uniform mat3 mapTransform;
	varying vec2 vMapUv;
#endif
#ifdef USE_ALPHAMAP
	uniform mat3 alphaMapTransform;
	varying vec2 vAlphaMapUv;
#endif
#ifdef USE_LIGHTMAP
	uniform mat3 lightMapTransform;
	varying vec2 vLightMapUv;
#endif
#ifdef USE_AOMAP
	uniform mat3 aoMapTransform;
	varying vec2 vAoMapUv;
#endif
#ifdef USE_BUMPMAP
	uniform mat3 bumpMapTransform;
	varying vec2 vBumpMapUv;
#endif
#ifdef USE_NORMALMAP
	uniform mat3 normalMapTransform;
	varying vec2 vNormalMapUv;
#endif
#ifdef USE_DISPLACEMENTMAP
	uniform mat3 displacementMapTransform;
	varying vec2 vDisplacementMapUv;
#endif
#ifdef USE_EMISSIVEMAP
	uniform mat3 emissiveMapTransform;
	varying vec2 vEmissiveMapUv;
#endif
#ifdef USE_METALNESSMAP
	uniform mat3 metalnessMapTransform;
	varying vec2 vMetalnessMapUv;
#endif
#ifdef USE_ROUGHNESSMAP
	uniform mat3 roughnessMapTransform;
	varying vec2 vRoughnessMapUv;
#endif
#ifdef USE_ANISOTROPYMAP
	uniform mat3 anisotropyMapTransform;
	varying vec2 vAnisotropyMapUv;
#endif
#ifdef USE_CLEARCOATMAP
	uniform mat3 clearcoatMapTransform;
	varying vec2 vClearcoatMapUv;
#endif
#ifdef USE_CLEARCOAT_NORMALMAP
	uniform mat3 clearcoatNormalMapTransform;
	varying vec2 vClearcoatNormalMapUv;
#endif
#ifdef USE_CLEARCOAT_ROUGHNESSMAP
	uniform mat3 clearcoatRoughnessMapTransform;
	varying vec2 vClearcoatRoughnessMapUv;
#endif
#ifdef USE_SHEEN_COLORMAP
	uniform mat3 sheenColorMapTransform;
	varying vec2 vSheenColorMapUv;
#endif
#ifdef USE_SHEEN_ROUGHNESSMAP
	uniform mat3 sheenRoughnessMapTransform;
	varying vec2 vSheenRoughnessMapUv;
#endif
#ifdef USE_IRIDESCENCEMAP
	uniform mat3 iridescenceMapTransform;
	varying vec2 vIridescenceMapUv;
#endif
#ifdef USE_IRIDESCENCE_THICKNESSMAP
	uniform mat3 iridescenceThicknessMapTransform;
	varying vec2 vIridescenceThicknessMapUv;
#endif
#ifdef USE_SPECULARMAP
	uniform mat3 specularMapTransform;
	varying vec2 vSpecularMapUv;
#endif
#ifdef USE_SPECULAR_COLORMAP
	uniform mat3 specularColorMapTransform;
	varying vec2 vSpecularColorMapUv;
#endif
#ifdef USE_SPECULAR_INTENSITYMAP
	uniform mat3 specularIntensityMapTransform;
	varying vec2 vSpecularIntensityMapUv;
#endif
#ifdef USE_TRANSMISSIONMAP
	uniform mat3 transmissionMapTransform;
	varying vec2 vTransmissionMapUv;
#endif
#ifdef USE_THICKNESSMAP
	uniform mat3 thicknessMapTransform;
	varying vec2 vThicknessMapUv;
#endif`,HM=`#if defined( USE_UV ) || defined( USE_ANISOTROPY )
	vUv = vec3( uv, 1 ).xy;
#endif
#ifdef USE_MAP
	vMapUv = ( mapTransform * vec3( MAP_UV, 1 ) ).xy;
#endif
#ifdef USE_ALPHAMAP
	vAlphaMapUv = ( alphaMapTransform * vec3( ALPHAMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_LIGHTMAP
	vLightMapUv = ( lightMapTransform * vec3( LIGHTMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_AOMAP
	vAoMapUv = ( aoMapTransform * vec3( AOMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_BUMPMAP
	vBumpMapUv = ( bumpMapTransform * vec3( BUMPMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_NORMALMAP
	vNormalMapUv = ( normalMapTransform * vec3( NORMALMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_DISPLACEMENTMAP
	vDisplacementMapUv = ( displacementMapTransform * vec3( DISPLACEMENTMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_EMISSIVEMAP
	vEmissiveMapUv = ( emissiveMapTransform * vec3( EMISSIVEMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_METALNESSMAP
	vMetalnessMapUv = ( metalnessMapTransform * vec3( METALNESSMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_ROUGHNESSMAP
	vRoughnessMapUv = ( roughnessMapTransform * vec3( ROUGHNESSMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_ANISOTROPYMAP
	vAnisotropyMapUv = ( anisotropyMapTransform * vec3( ANISOTROPYMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_CLEARCOATMAP
	vClearcoatMapUv = ( clearcoatMapTransform * vec3( CLEARCOATMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_CLEARCOAT_NORMALMAP
	vClearcoatNormalMapUv = ( clearcoatNormalMapTransform * vec3( CLEARCOAT_NORMALMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_CLEARCOAT_ROUGHNESSMAP
	vClearcoatRoughnessMapUv = ( clearcoatRoughnessMapTransform * vec3( CLEARCOAT_ROUGHNESSMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_IRIDESCENCEMAP
	vIridescenceMapUv = ( iridescenceMapTransform * vec3( IRIDESCENCEMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_IRIDESCENCE_THICKNESSMAP
	vIridescenceThicknessMapUv = ( iridescenceThicknessMapTransform * vec3( IRIDESCENCE_THICKNESSMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_SHEEN_COLORMAP
	vSheenColorMapUv = ( sheenColorMapTransform * vec3( SHEEN_COLORMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_SHEEN_ROUGHNESSMAP
	vSheenRoughnessMapUv = ( sheenRoughnessMapTransform * vec3( SHEEN_ROUGHNESSMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_SPECULARMAP
	vSpecularMapUv = ( specularMapTransform * vec3( SPECULARMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_SPECULAR_COLORMAP
	vSpecularColorMapUv = ( specularColorMapTransform * vec3( SPECULAR_COLORMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_SPECULAR_INTENSITYMAP
	vSpecularIntensityMapUv = ( specularIntensityMapTransform * vec3( SPECULAR_INTENSITYMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_TRANSMISSIONMAP
	vTransmissionMapUv = ( transmissionMapTransform * vec3( TRANSMISSIONMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_THICKNESSMAP
	vThicknessMapUv = ( thicknessMapTransform * vec3( THICKNESSMAP_UV, 1 ) ).xy;
#endif`,WM=`#if defined( USE_ENVMAP ) || defined( DISTANCE ) || defined ( USE_SHADOWMAP ) || defined ( USE_TRANSMISSION ) || NUM_SPOT_LIGHT_COORDS > 0
	vec4 worldPosition = vec4( transformed, 1.0 );
	#ifdef USE_BATCHING
		worldPosition = batchingMatrix * worldPosition;
	#endif
	#ifdef USE_INSTANCING
		worldPosition = instanceMatrix * worldPosition;
	#endif
	worldPosition = modelMatrix * worldPosition;
#endif`,XM=`varying vec2 vUv;
uniform mat3 uvTransform;
void main() {
	vUv = ( uvTransform * vec3( uv, 1 ) ).xy;
	gl_Position = vec4( position.xy, 1.0, 1.0 );
}`,qM=`uniform sampler2D t2D;
uniform float backgroundIntensity;
varying vec2 vUv;
void main() {
	vec4 texColor = texture2D( t2D, vUv );
	#ifdef DECODE_VIDEO_TEXTURE
		texColor = vec4( mix( pow( texColor.rgb * 0.9478672986 + vec3( 0.0521327014 ), vec3( 2.4 ) ), texColor.rgb * 0.0773993808, vec3( lessThanEqual( texColor.rgb, vec3( 0.04045 ) ) ) ), texColor.w );
	#endif
	texColor.rgb *= backgroundIntensity;
	gl_FragColor = texColor;
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
}`,YM=`varying vec3 vWorldDirection;
#include <common>
void main() {
	vWorldDirection = transformDirection( position, modelMatrix );
	#include <begin_vertex>
	#include <project_vertex>
	gl_Position.z = gl_Position.w;
}`,ZM=`#ifdef ENVMAP_TYPE_CUBE
	uniform samplerCube envMap;
#elif defined( ENVMAP_TYPE_CUBE_UV )
	uniform sampler2D envMap;
#endif
uniform float backgroundBlurriness;
uniform float backgroundIntensity;
uniform mat3 backgroundRotation;
varying vec3 vWorldDirection;
#include <cube_uv_reflection_fragment>
void main() {
	#ifdef ENVMAP_TYPE_CUBE
		vec4 texColor = textureCube( envMap, backgroundRotation * vWorldDirection );
	#elif defined( ENVMAP_TYPE_CUBE_UV )
		vec4 texColor = textureCubeUV( envMap, backgroundRotation * vWorldDirection, backgroundBlurriness );
	#else
		vec4 texColor = vec4( 0.0, 0.0, 0.0, 1.0 );
	#endif
	texColor.rgb *= backgroundIntensity;
	gl_FragColor = texColor;
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
}`,JM=`varying vec3 vWorldDirection;
#include <common>
void main() {
	vWorldDirection = transformDirection( position, modelMatrix );
	#include <begin_vertex>
	#include <project_vertex>
	gl_Position.z = gl_Position.w;
}`,$M=`uniform samplerCube tCube;
uniform float tFlip;
uniform float opacity;
varying vec3 vWorldDirection;
void main() {
	vec4 texColor = textureCube( tCube, vec3( tFlip * vWorldDirection.x, vWorldDirection.yz ) );
	gl_FragColor = texColor;
	gl_FragColor.a *= opacity;
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
}`,KM=`#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
varying vec2 vHighPrecisionZW;
void main() {
	#include <uv_vertex>
	#include <batching_vertex>
	#include <skinbase_vertex>
	#include <morphinstance_vertex>
	#ifdef USE_DISPLACEMENTMAP
		#include <beginnormal_vertex>
		#include <morphnormal_vertex>
		#include <skinnormal_vertex>
	#endif
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	vHighPrecisionZW = gl_Position.zw;
}`,QM=`#if DEPTH_PACKING == 3200
	uniform float opacity;
#endif
#include <common>
#include <packing>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
varying vec2 vHighPrecisionZW;
void main() {
	vec4 diffuseColor = vec4( 1.0 );
	#include <clipping_planes_fragment>
	#if DEPTH_PACKING == 3200
		diffuseColor.a = opacity;
	#endif
	#include <map_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	#include <logdepthbuf_fragment>
	#ifdef USE_REVERSED_DEPTH_BUFFER
		float fragCoordZ = vHighPrecisionZW[ 0 ] / vHighPrecisionZW[ 1 ];
	#else
		float fragCoordZ = 0.5 * vHighPrecisionZW[ 0 ] / vHighPrecisionZW[ 1 ] + 0.5;
	#endif
	#if DEPTH_PACKING == 3200
		gl_FragColor = vec4( vec3( 1.0 - fragCoordZ ), opacity );
	#elif DEPTH_PACKING == 3201
		gl_FragColor = packDepthToRGBA( fragCoordZ );
	#elif DEPTH_PACKING == 3202
		gl_FragColor = vec4( packDepthToRGB( fragCoordZ ), 1.0 );
	#elif DEPTH_PACKING == 3203
		gl_FragColor = vec4( packDepthToRG( fragCoordZ ), 0.0, 1.0 );
	#endif
}`,jM=`#define DISTANCE
varying vec3 vWorldPosition;
#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <batching_vertex>
	#include <skinbase_vertex>
	#include <morphinstance_vertex>
	#ifdef USE_DISPLACEMENTMAP
		#include <beginnormal_vertex>
		#include <morphnormal_vertex>
		#include <skinnormal_vertex>
	#endif
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <worldpos_vertex>
	#include <clipping_planes_vertex>
	vWorldPosition = worldPosition.xyz;
}`,tS=`#define DISTANCE
uniform vec3 referencePosition;
uniform float nearDistance;
uniform float farDistance;
varying vec3 vWorldPosition;
#include <common>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( 1.0 );
	#include <clipping_planes_fragment>
	#include <map_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	float dist = length( vWorldPosition - referencePosition );
	dist = ( dist - nearDistance ) / ( farDistance - nearDistance );
	dist = saturate( dist );
	gl_FragColor = vec4( dist, 0.0, 0.0, 1.0 );
}`,eS=`varying vec3 vWorldDirection;
#include <common>
void main() {
	vWorldDirection = transformDirection( position, modelMatrix );
	#include <begin_vertex>
	#include <project_vertex>
}`,nS=`uniform sampler2D tEquirect;
varying vec3 vWorldDirection;
#include <common>
void main() {
	vec3 direction = normalize( vWorldDirection );
	vec2 sampleUV = equirectUv( direction );
	gl_FragColor = texture2D( tEquirect, sampleUV );
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
}`,iS=`uniform float scale;
attribute float lineDistance;
varying float vLineDistance;
#include <common>
#include <uv_pars_vertex>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <morphtarget_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	vLineDistance = scale * lineDistance;
	#include <uv_vertex>
	#include <color_vertex>
	#include <morphinstance_vertex>
	#include <morphcolor_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	#include <fog_vertex>
}`,sS=`uniform vec3 diffuse;
uniform float opacity;
uniform float dashSize;
uniform float totalSize;
varying float vLineDistance;
#include <common>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <fog_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	if ( mod( vLineDistance, totalSize ) > dashSize ) {
		discard;
	}
	vec3 outgoingLight = vec3( 0.0 );
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <color_fragment>
	outgoingLight = diffuseColor.rgb;
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
}`,rS=`#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <envmap_pars_vertex>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <color_vertex>
	#include <morphinstance_vertex>
	#include <morphcolor_vertex>
	#include <batching_vertex>
	#if defined ( USE_ENVMAP ) || defined ( USE_SKINNING )
		#include <beginnormal_vertex>
		#include <morphnormal_vertex>
		#include <skinbase_vertex>
		#include <skinnormal_vertex>
		#include <defaultnormal_vertex>
	#endif
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	#include <worldpos_vertex>
	#include <envmap_vertex>
	#include <fog_vertex>
}`,oS=`uniform vec3 diffuse;
uniform float opacity;
#ifndef FLAT_SHADED
	varying vec3 vNormal;
#endif
#include <common>
#include <dithering_pars_fragment>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <aomap_pars_fragment>
#include <lightmap_pars_fragment>
#include <envmap_common_pars_fragment>
#include <envmap_pars_fragment>
#include <fog_pars_fragment>
#include <specularmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <color_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	#include <specularmap_fragment>
	ReflectedLight reflectedLight = ReflectedLight( vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ) );
	#ifdef USE_LIGHTMAP
		vec4 lightMapTexel = texture2D( lightMap, vLightMapUv );
		reflectedLight.indirectDiffuse += lightMapTexel.rgb * lightMapIntensity * RECIPROCAL_PI;
	#else
		reflectedLight.indirectDiffuse += vec3( 1.0 );
	#endif
	#include <aomap_fragment>
	reflectedLight.indirectDiffuse *= diffuseColor.rgb;
	vec3 outgoingLight = reflectedLight.indirectDiffuse;
	#include <envmap_fragment>
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
	#include <dithering_fragment>
}`,aS=`#define LAMBERT
varying vec3 vViewPosition;
#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <envmap_pars_vertex>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <normal_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <shadowmap_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <color_vertex>
	#include <morphinstance_vertex>
	#include <morphcolor_vertex>
	#include <batching_vertex>
	#include <beginnormal_vertex>
	#include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
	#include <normal_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	vViewPosition = - mvPosition.xyz;
	#include <worldpos_vertex>
	#include <envmap_vertex>
	#include <shadowmap_vertex>
	#include <fog_vertex>
}`,lS=`#define LAMBERT
uniform vec3 diffuse;
uniform vec3 emissive;
uniform float opacity;
#include <common>
#include <dithering_pars_fragment>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <aomap_pars_fragment>
#include <lightmap_pars_fragment>
#include <emissivemap_pars_fragment>
#include <cube_uv_reflection_fragment>
#include <envmap_common_pars_fragment>
#include <envmap_pars_fragment>
#include <envmap_physical_pars_fragment>
#include <fog_pars_fragment>
#include <bsdfs>
#include <lights_pars_begin>
#include <normal_pars_fragment>
#include <lights_lambert_pars_fragment>
#include <shadowmap_pars_fragment>
#include <bumpmap_pars_fragment>
#include <normalmap_pars_fragment>
#include <specularmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	ReflectedLight reflectedLight = ReflectedLight( vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ) );
	vec3 totalEmissiveRadiance = emissive;
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <color_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	#include <specularmap_fragment>
	#include <normal_fragment_begin>
	#include <normal_fragment_maps>
	#include <emissivemap_fragment>
	#include <lights_lambert_fragment>
	#include <lights_fragment_begin>
	#include <lights_fragment_maps>
	#include <lights_fragment_end>
	#include <aomap_fragment>
	vec3 outgoingLight = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse + totalEmissiveRadiance;
	#include <envmap_fragment>
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
	#include <dithering_fragment>
}`,cS=`#define MATCAP
varying vec3 vViewPosition;
#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <color_pars_vertex>
#include <displacementmap_pars_vertex>
#include <fog_pars_vertex>
#include <normal_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <color_vertex>
	#include <morphinstance_vertex>
	#include <morphcolor_vertex>
	#include <batching_vertex>
	#include <beginnormal_vertex>
	#include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
	#include <normal_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	#include <fog_vertex>
	vViewPosition = - mvPosition.xyz;
}`,hS=`#define MATCAP
uniform vec3 diffuse;
uniform float opacity;
uniform sampler2D matcap;
varying vec3 vViewPosition;
#include <common>
#include <dithering_pars_fragment>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <fog_pars_fragment>
#include <normal_pars_fragment>
#include <bumpmap_pars_fragment>
#include <normalmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <color_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	#include <normal_fragment_begin>
	#include <normal_fragment_maps>
	vec3 viewDir = normalize( vViewPosition );
	vec3 x = normalize( vec3( viewDir.z, 0.0, - viewDir.x ) );
	vec3 y = cross( viewDir, x );
	vec2 uv = vec2( dot( x, normal ), dot( y, normal ) ) * 0.495 + 0.5;
	#ifdef USE_MATCAP
		vec4 matcapColor = texture2D( matcap, uv );
	#else
		vec4 matcapColor = vec4( vec3( mix( 0.2, 0.8, uv.y ) ), 1.0 );
	#endif
	vec3 outgoingLight = diffuseColor.rgb * matcapColor.rgb;
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
	#include <dithering_fragment>
}`,uS=`#define NORMAL
#if defined( FLAT_SHADED ) || defined( USE_BUMPMAP ) || defined( USE_NORMALMAP_TANGENTSPACE )
	varying vec3 vViewPosition;
#endif
#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <normal_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <batching_vertex>
	#include <beginnormal_vertex>
	#include <morphinstance_vertex>
	#include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
	#include <normal_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
#if defined( FLAT_SHADED ) || defined( USE_BUMPMAP ) || defined( USE_NORMALMAP_TANGENTSPACE )
	vViewPosition = - mvPosition.xyz;
#endif
}`,fS=`#define NORMAL
uniform float opacity;
#if defined( FLAT_SHADED ) || defined( USE_BUMPMAP ) || defined( USE_NORMALMAP_TANGENTSPACE )
	varying vec3 vViewPosition;
#endif
#include <uv_pars_fragment>
#include <normal_pars_fragment>
#include <bumpmap_pars_fragment>
#include <normalmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( 0.0, 0.0, 0.0, opacity );
	#include <clipping_planes_fragment>
	#include <logdepthbuf_fragment>
	#include <normal_fragment_begin>
	#include <normal_fragment_maps>
	gl_FragColor = vec4( normalize( normal ) * 0.5 + 0.5, diffuseColor.a );
	#ifdef OPAQUE
		gl_FragColor.a = 1.0;
	#endif
}`,dS=`#define PHONG
varying vec3 vViewPosition;
#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <envmap_pars_vertex>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <normal_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <shadowmap_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <color_vertex>
	#include <morphcolor_vertex>
	#include <batching_vertex>
	#include <beginnormal_vertex>
	#include <morphinstance_vertex>
	#include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
	#include <normal_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	vViewPosition = - mvPosition.xyz;
	#include <worldpos_vertex>
	#include <envmap_vertex>
	#include <shadowmap_vertex>
	#include <fog_vertex>
}`,pS=`#define PHONG
uniform vec3 diffuse;
uniform vec3 emissive;
uniform vec3 specular;
uniform float shininess;
uniform float opacity;
#include <common>
#include <dithering_pars_fragment>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <aomap_pars_fragment>
#include <lightmap_pars_fragment>
#include <emissivemap_pars_fragment>
#include <cube_uv_reflection_fragment>
#include <envmap_common_pars_fragment>
#include <envmap_pars_fragment>
#include <envmap_physical_pars_fragment>
#include <fog_pars_fragment>
#include <bsdfs>
#include <lights_pars_begin>
#include <normal_pars_fragment>
#include <lights_phong_pars_fragment>
#include <shadowmap_pars_fragment>
#include <bumpmap_pars_fragment>
#include <normalmap_pars_fragment>
#include <specularmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	ReflectedLight reflectedLight = ReflectedLight( vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ) );
	vec3 totalEmissiveRadiance = emissive;
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <color_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	#include <specularmap_fragment>
	#include <normal_fragment_begin>
	#include <normal_fragment_maps>
	#include <emissivemap_fragment>
	#include <lights_phong_fragment>
	#include <lights_fragment_begin>
	#include <lights_fragment_maps>
	#include <lights_fragment_end>
	#include <aomap_fragment>
	vec3 outgoingLight = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse + reflectedLight.directSpecular + reflectedLight.indirectSpecular + totalEmissiveRadiance;
	#include <envmap_fragment>
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
	#include <dithering_fragment>
}`,mS=`#define STANDARD
varying vec3 vViewPosition;
#ifdef USE_TRANSMISSION
	varying vec3 vWorldPosition;
#endif
#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <normal_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <shadowmap_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <color_vertex>
	#include <morphinstance_vertex>
	#include <morphcolor_vertex>
	#include <batching_vertex>
	#include <beginnormal_vertex>
	#include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
	#include <normal_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	vViewPosition = - mvPosition.xyz;
	#include <worldpos_vertex>
	#include <shadowmap_vertex>
	#include <fog_vertex>
#ifdef USE_TRANSMISSION
	vWorldPosition = worldPosition.xyz;
#endif
}`,gS=`#define STANDARD
#ifdef PHYSICAL
	#define IOR
	#define USE_SPECULAR
#endif
uniform vec3 diffuse;
uniform vec3 emissive;
uniform float roughness;
uniform float metalness;
uniform float opacity;
#ifdef IOR
	uniform float ior;
#endif
#ifdef USE_SPECULAR
	uniform float specularIntensity;
	uniform vec3 specularColor;
	#ifdef USE_SPECULAR_COLORMAP
		uniform sampler2D specularColorMap;
	#endif
	#ifdef USE_SPECULAR_INTENSITYMAP
		uniform sampler2D specularIntensityMap;
	#endif
#endif
#ifdef USE_CLEARCOAT
	uniform float clearcoat;
	uniform float clearcoatRoughness;
#endif
#ifdef USE_DISPERSION
	uniform float dispersion;
#endif
#ifdef USE_RETROREFLECTION
	uniform float retroreflectivity;
#endif
#ifdef USE_IRIDESCENCE
	uniform float iridescence;
	uniform float iridescenceIOR;
	uniform float iridescenceThicknessMinimum;
	uniform float iridescenceThicknessMaximum;
#endif
#ifdef USE_SHEEN
	uniform vec3 sheenColor;
	uniform float sheenRoughness;
	#ifdef USE_SHEEN_COLORMAP
		uniform sampler2D sheenColorMap;
	#endif
	#ifdef USE_SHEEN_ROUGHNESSMAP
		uniform sampler2D sheenRoughnessMap;
	#endif
#endif
#ifdef USE_ANISOTROPY
	uniform vec2 anisotropyVector;
	#ifdef USE_ANISOTROPYMAP
		uniform sampler2D anisotropyMap;
	#endif
#endif
varying vec3 vViewPosition;
#include <common>
#include <dithering_pars_fragment>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <aomap_pars_fragment>
#include <lightmap_pars_fragment>
#include <emissivemap_pars_fragment>
#include <iridescence_fragment>
#include <cube_uv_reflection_fragment>
#include <envmap_common_pars_fragment>
#include <envmap_physical_pars_fragment>
#include <fog_pars_fragment>
#include <lights_pars_begin>
#include <normal_pars_fragment>
#include <lights_physical_pars_fragment>
#include <transmission_pars_fragment>
#include <shadowmap_pars_fragment>
#include <bumpmap_pars_fragment>
#include <normalmap_pars_fragment>
#include <clearcoat_pars_fragment>
#include <iridescence_pars_fragment>
#include <roughnessmap_pars_fragment>
#include <metalnessmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	ReflectedLight reflectedLight = ReflectedLight( vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ) );
	vec3 totalEmissiveRadiance = emissive;
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <color_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	#include <roughnessmap_fragment>
	#include <metalnessmap_fragment>
	#include <normal_fragment_begin>
	#include <normal_fragment_maps>
	#include <clearcoat_normal_fragment_begin>
	#include <clearcoat_normal_fragment_maps>
	#include <emissivemap_fragment>
	#include <lights_physical_fragment>
	#include <lights_fragment_begin>
	#include <lights_fragment_maps>
	#include <lights_fragment_end>
	#include <aomap_fragment>
	vec3 totalDiffuse = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse;
	vec3 totalSpecular = reflectedLight.directSpecular + reflectedLight.indirectSpecular;
	#include <transmission_fragment>
	vec3 outgoingLight = totalDiffuse + totalSpecular + totalEmissiveRadiance;
	#ifdef USE_SHEEN
 
		outgoingLight = outgoingLight + sheenSpecularDirect + sheenSpecularIndirect;
 
 	#endif
	#ifdef USE_CLEARCOAT
		float dotNVcc = saturate( dot( geometryClearcoatNormal, geometryViewDir ) );
		vec3 Fcc = F_Schlick( material.clearcoatF0, material.clearcoatF90, dotNVcc );
		outgoingLight = outgoingLight * ( 1.0 - material.clearcoat * Fcc ) + ( clearcoatSpecularDirect + clearcoatSpecularIndirect ) * material.clearcoat;
	#endif
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
	#include <dithering_fragment>
}`,xS=`#define TOON
varying vec3 vViewPosition;
#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <normal_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <shadowmap_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <color_vertex>
	#include <morphinstance_vertex>
	#include <morphcolor_vertex>
	#include <batching_vertex>
	#include <beginnormal_vertex>
	#include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
	#include <normal_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	vViewPosition = - mvPosition.xyz;
	#include <worldpos_vertex>
	#include <shadowmap_vertex>
	#include <fog_vertex>
}`,_S=`#define TOON
uniform vec3 diffuse;
uniform vec3 emissive;
uniform float opacity;
#include <common>
#include <dithering_pars_fragment>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <aomap_pars_fragment>
#include <lightmap_pars_fragment>
#include <emissivemap_pars_fragment>
#include <gradientmap_pars_fragment>
#include <fog_pars_fragment>
#include <bsdfs>
#include <lights_pars_begin>
#include <normal_pars_fragment>
#include <lights_toon_pars_fragment>
#include <shadowmap_pars_fragment>
#include <bumpmap_pars_fragment>
#include <normalmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	ReflectedLight reflectedLight = ReflectedLight( vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ) );
	vec3 totalEmissiveRadiance = emissive;
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <color_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	#include <normal_fragment_begin>
	#include <normal_fragment_maps>
	#include <emissivemap_fragment>
	#include <lights_toon_fragment>
	#include <lights_fragment_begin>
	#include <lights_fragment_maps>
	#include <lights_fragment_end>
	#include <aomap_fragment>
	vec3 outgoingLight = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse + totalEmissiveRadiance;
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
	#include <dithering_fragment>
}`,yS=`uniform float size;
uniform float scale;
#include <common>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <morphtarget_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
#ifdef USE_POINTS_UV
	varying vec2 vUv;
	uniform mat3 uvTransform;
#endif
void main() {
	#ifdef USE_POINTS_UV
		vUv = ( uvTransform * vec3( uv, 1 ) ).xy;
	#endif
	#include <color_vertex>
	#include <morphinstance_vertex>
	#include <morphcolor_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <project_vertex>
	gl_PointSize = size;
	#ifdef USE_SIZEATTENUATION
		bool isPerspective = isPerspectiveMatrix( projectionMatrix );
		if ( isPerspective ) gl_PointSize *= ( scale / - mvPosition.z );
	#endif
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	#include <worldpos_vertex>
	#include <fog_vertex>
}`,vS=`uniform vec3 diffuse;
uniform float opacity;
#include <common>
#include <color_pars_fragment>
#include <map_particle_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <fog_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	vec3 outgoingLight = vec3( 0.0 );
	#include <logdepthbuf_fragment>
	#include <map_particle_fragment>
	#include <color_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	outgoingLight = diffuseColor.rgb;
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
}`,MS=`#include <common>
#include <batching_pars_vertex>
#include <fog_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <shadowmap_pars_vertex>
void main() {
	#include <batching_vertex>
	#include <beginnormal_vertex>
	#include <morphinstance_vertex>
	#include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <worldpos_vertex>
	#include <shadowmap_vertex>
	#include <fog_vertex>
}`,SS=`uniform vec3 color;
uniform float opacity;
#include <common>
#include <fog_pars_fragment>
#include <bsdfs>
#include <lights_pars_begin>
#include <logdepthbuf_pars_fragment>
#include <shadowmap_pars_fragment>
#include <shadowmask_pars_fragment>
void main() {
	#include <logdepthbuf_fragment>
	gl_FragColor = vec4( color, opacity * ( 1.0 - getShadowMask() ) );
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
}`,bS=`uniform float rotation;
uniform vec2 center;
#include <common>
#include <uv_pars_vertex>
#include <fog_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	vec4 mvPosition = modelViewMatrix[ 3 ];
	vec2 scale = vec2( length( modelMatrix[ 0 ].xyz ), length( modelMatrix[ 1 ].xyz ) );
	#ifndef USE_SIZEATTENUATION
		bool isPerspective = isPerspectiveMatrix( projectionMatrix );
		if ( isPerspective ) scale *= - mvPosition.z;
	#endif
	vec2 alignedPosition = ( position.xy - ( center - vec2( 0.5 ) ) ) * scale;
	vec2 rotatedPosition;
	rotatedPosition.x = cos( rotation ) * alignedPosition.x - sin( rotation ) * alignedPosition.y;
	rotatedPosition.y = sin( rotation ) * alignedPosition.x + cos( rotation ) * alignedPosition.y;
	mvPosition.xy += rotatedPosition;
	gl_Position = projectionMatrix * mvPosition;
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	#include <fog_vertex>
}`,ES=`uniform vec3 diffuse;
uniform float opacity;
#include <common>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <fog_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	vec3 outgoingLight = vec3( 0.0 );
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	outgoingLight = diffuseColor.rgb;
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
}`,ne={alphahash_fragment:Xy,alphahash_pars_fragment:qy,alphamap_fragment:Yy,alphamap_pars_fragment:Zy,alphatest_fragment:Jy,alphatest_pars_fragment:$y,aomap_fragment:Ky,aomap_pars_fragment:Qy,batching_pars_vertex:jy,batching_vertex:tv,begin_vertex:ev,beginnormal_vertex:nv,bsdfs:iv,iridescence_fragment:sv,bumpmap_pars_fragment:rv,clipping_planes_fragment:ov,clipping_planes_pars_fragment:av,clipping_planes_pars_vertex:lv,clipping_planes_vertex:cv,color_fragment:hv,color_pars_fragment:uv,color_pars_vertex:fv,color_vertex:dv,common:pv,cube_uv_reflection_fragment:mv,defaultnormal_vertex:gv,displacementmap_pars_vertex:xv,displacementmap_vertex:_v,emissivemap_fragment:yv,emissivemap_pars_fragment:vv,colorspace_fragment:Mv,colorspace_pars_fragment:Sv,envmap_fragment:bv,envmap_common_pars_fragment:Ev,envmap_pars_fragment:Tv,envmap_pars_vertex:wv,envmap_physical_pars_fragment:Ov,envmap_vertex:Av,fog_vertex:Rv,fog_pars_vertex:Cv,fog_fragment:Iv,fog_pars_fragment:Pv,gradientmap_pars_fragment:Lv,lightmap_pars_fragment:Dv,lights_lambert_fragment:Nv,lights_lambert_pars_fragment:Uv,lights_pars_begin:Fv,lights_toon_fragment:Bv,lights_toon_pars_fragment:zv,lights_phong_fragment:kv,lights_phong_pars_fragment:Gv,lights_physical_fragment:Vv,lights_physical_pars_fragment:Hv,lights_fragment_begin:Wv,lights_fragment_maps:Xv,lights_fragment_end:qv,lightprobes_pars_fragment:Yv,logdepthbuf_fragment:Zv,logdepthbuf_pars_fragment:Jv,logdepthbuf_pars_vertex:$v,logdepthbuf_vertex:Kv,map_fragment:Qv,map_pars_fragment:jv,map_particle_fragment:tM,map_particle_pars_fragment:eM,metalnessmap_fragment:nM,metalnessmap_pars_fragment:iM,morphinstance_vertex:sM,morphcolor_vertex:rM,morphnormal_vertex:oM,morphtarget_pars_vertex:aM,morphtarget_vertex:lM,normal_fragment_begin:cM,normal_fragment_maps:hM,normal_pars_fragment:uM,normal_pars_vertex:fM,normal_vertex:dM,normalmap_pars_fragment:pM,clearcoat_normal_fragment_begin:mM,clearcoat_normal_fragment_maps:gM,clearcoat_pars_fragment:xM,iridescence_pars_fragment:_M,opaque_fragment:yM,packing:vM,premultiplied_alpha_fragment:MM,project_vertex:SM,dithering_fragment:bM,dithering_pars_fragment:EM,roughnessmap_fragment:TM,roughnessmap_pars_fragment:wM,shadowmap_pars_fragment:AM,shadowmap_pars_vertex:RM,shadowmap_vertex:CM,shadowmask_pars_fragment:IM,skinbase_vertex:PM,skinning_pars_vertex:LM,skinning_vertex:DM,skinnormal_vertex:NM,specularmap_fragment:UM,specularmap_pars_fragment:FM,tonemapping_fragment:OM,tonemapping_pars_fragment:BM,transmission_fragment:zM,transmission_pars_fragment:kM,uv_pars_fragment:GM,uv_pars_vertex:VM,uv_vertex:HM,worldpos_vertex:WM,background_vert:XM,background_frag:qM,backgroundCube_vert:YM,backgroundCube_frag:ZM,cube_vert:JM,cube_frag:$M,depth_vert:KM,depth_frag:QM,distance_vert:jM,distance_frag:tS,equirect_vert:eS,equirect_frag:nS,linedashed_vert:iS,linedashed_frag:sS,meshbasic_vert:rS,meshbasic_frag:oS,meshlambert_vert:aS,meshlambert_frag:lS,meshmatcap_vert:cS,meshmatcap_frag:hS,meshnormal_vert:uS,meshnormal_frag:fS,meshphong_vert:dS,meshphong_frag:pS,meshphysical_vert:mS,meshphysical_frag:gS,meshtoon_vert:xS,meshtoon_frag:_S,points_vert:yS,points_frag:vS,shadow_vert:MS,shadow_frag:SS,sprite_vert:bS,sprite_frag:ES},Rt={common:{diffuse:{value:new _t(16777215)},opacity:{value:1},map:{value:null},mapTransform:{value:new jt},alphaMap:{value:null},alphaMapTransform:{value:new jt},alphaTest:{value:0}},specularmap:{specularMap:{value:null},specularMapTransform:{value:new jt}},envmap:{envMap:{value:null},envMapRotation:{value:new jt},reflectivity:{value:1},ior:{value:1.5},refractionRatio:{value:.98},dfgLUT:{value:null}},aomap:{aoMap:{value:null},aoMapIntensity:{value:1},aoMapTransform:{value:new jt}},lightmap:{lightMap:{value:null},lightMapIntensity:{value:1},lightMapTransform:{value:new jt}},bumpmap:{bumpMap:{value:null},bumpMapTransform:{value:new jt},bumpScale:{value:1}},normalmap:{normalMap:{value:null},normalMapTransform:{value:new jt},normalScale:{value:new rt(1,1)}},displacementmap:{displacementMap:{value:null},displacementMapTransform:{value:new jt},displacementScale:{value:1},displacementBias:{value:0}},emissivemap:{emissiveMap:{value:null},emissiveMapTransform:{value:new jt}},metalnessmap:{metalnessMap:{value:null},metalnessMapTransform:{value:new jt}},roughnessmap:{roughnessMap:{value:null},roughnessMapTransform:{value:new jt}},gradientmap:{gradientMap:{value:null}},fog:{fogDensity:{value:25e-5},fogNear:{value:1},fogFar:{value:2e3},fogColor:{value:new _t(16777215)}},lights:{ambientLightColor:{value:[]},lightProbe:{value:[]},sunLights:{value:[],properties:{direction:{},color:{}}},sunLightShadows:{value:[],properties:{shadowIntensity:1,shadowBias:{},shadowNormalBias:{},shadowRadius:{},shadowMapSize:{}}},sunShadowMatrix:{value:[]},sunShadowCascade:{value:[]},directionalLights:{value:[],properties:{direction:{},color:{}}},directionalLightShadows:{value:[],properties:{shadowIntensity:1,shadowBias:{},shadowNormalBias:{},shadowRadius:{},shadowMapSize:{}}},directionalShadowMatrix:{value:[]},spotLights:{value:[],properties:{color:{},position:{},direction:{},distance:{},coneCos:{},penumbraCos:{},decay:{}}},spotLightShadows:{value:[],properties:{shadowIntensity:1,shadowBias:{},shadowNormalBias:{},shadowRadius:{},shadowMapSize:{}}},spotLightMap:{value:[]},spotLightMatrix:{value:[]},pointLights:{value:[],properties:{color:{},position:{},decay:{},distance:{}}},pointLightShadows:{value:[],properties:{shadowIntensity:1,shadowBias:{},shadowNormalBias:{},shadowRadius:{},shadowMapSize:{},shadowCameraNear:{},shadowCameraFar:{}}},pointShadowMatrix:{value:[]},hemisphereLights:{value:[],properties:{direction:{},skyColor:{},groundColor:{}}},rectAreaLights:{value:[],properties:{color:{},position:{},width:{},height:{}}},ltc_1:{value:null},ltc_2:{value:null},probesSH:{value:null},probesMin:{value:new P},probesMax:{value:new P},probesResolution:{value:new P}},points:{diffuse:{value:new _t(16777215)},opacity:{value:1},size:{value:1},scale:{value:1},map:{value:null},alphaMap:{value:null},alphaMapTransform:{value:new jt},alphaTest:{value:0},uvTransform:{value:new jt}},sprite:{diffuse:{value:new _t(16777215)},opacity:{value:1},center:{value:new rt(.5,.5)},rotation:{value:0},map:{value:null},mapTransform:{value:new jt},alphaMap:{value:null},alphaMapTransform:{value:new jt},alphaTest:{value:0}}},Jn={basic:{uniforms:on([Rt.common,Rt.specularmap,Rt.envmap,Rt.aomap,Rt.lightmap,Rt.fog]),vertexShader:ne.meshbasic_vert,fragmentShader:ne.meshbasic_frag},lambert:{uniforms:on([Rt.common,Rt.specularmap,Rt.envmap,Rt.aomap,Rt.lightmap,Rt.emissivemap,Rt.bumpmap,Rt.normalmap,Rt.displacementmap,Rt.fog,Rt.lights,{emissive:{value:new _t(0)},envMapIntensity:{value:1}}]),vertexShader:ne.meshlambert_vert,fragmentShader:ne.meshlambert_frag},phong:{uniforms:on([Rt.common,Rt.specularmap,Rt.envmap,Rt.aomap,Rt.lightmap,Rt.emissivemap,Rt.bumpmap,Rt.normalmap,Rt.displacementmap,Rt.fog,Rt.lights,{emissive:{value:new _t(0)},specular:{value:new _t(1118481)},shininess:{value:30},envMapIntensity:{value:1}}]),vertexShader:ne.meshphong_vert,fragmentShader:ne.meshphong_frag},standard:{uniforms:on([Rt.common,Rt.envmap,Rt.aomap,Rt.lightmap,Rt.emissivemap,Rt.bumpmap,Rt.normalmap,Rt.displacementmap,Rt.roughnessmap,Rt.metalnessmap,Rt.fog,Rt.lights,{emissive:{value:new _t(0)},roughness:{value:1},metalness:{value:0},envMapIntensity:{value:1}}]),vertexShader:ne.meshphysical_vert,fragmentShader:ne.meshphysical_frag},toon:{uniforms:on([Rt.common,Rt.aomap,Rt.lightmap,Rt.emissivemap,Rt.bumpmap,Rt.normalmap,Rt.displacementmap,Rt.gradientmap,Rt.fog,Rt.lights,{emissive:{value:new _t(0)}}]),vertexShader:ne.meshtoon_vert,fragmentShader:ne.meshtoon_frag},matcap:{uniforms:on([Rt.common,Rt.bumpmap,Rt.normalmap,Rt.displacementmap,Rt.fog,{matcap:{value:null}}]),vertexShader:ne.meshmatcap_vert,fragmentShader:ne.meshmatcap_frag},points:{uniforms:on([Rt.points,Rt.fog]),vertexShader:ne.points_vert,fragmentShader:ne.points_frag},dashed:{uniforms:on([Rt.common,Rt.fog,{scale:{value:1},dashSize:{value:1},totalSize:{value:2}}]),vertexShader:ne.linedashed_vert,fragmentShader:ne.linedashed_frag},depth:{uniforms:on([Rt.common,Rt.displacementmap]),vertexShader:ne.depth_vert,fragmentShader:ne.depth_frag},normal:{uniforms:on([Rt.common,Rt.bumpmap,Rt.normalmap,Rt.displacementmap,{opacity:{value:1}}]),vertexShader:ne.meshnormal_vert,fragmentShader:ne.meshnormal_frag},sprite:{uniforms:on([Rt.sprite,Rt.fog]),vertexShader:ne.sprite_vert,fragmentShader:ne.sprite_frag},background:{uniforms:{uvTransform:{value:new jt},t2D:{value:null},backgroundIntensity:{value:1}},vertexShader:ne.background_vert,fragmentShader:ne.background_frag},backgroundCube:{uniforms:{envMap:{value:null},backgroundBlurriness:{value:0},backgroundIntensity:{value:1},backgroundRotation:{value:new jt}},vertexShader:ne.backgroundCube_vert,fragmentShader:ne.backgroundCube_frag},cube:{uniforms:{tCube:{value:null},tFlip:{value:-1},opacity:{value:1}},vertexShader:ne.cube_vert,fragmentShader:ne.cube_frag},equirect:{uniforms:{tEquirect:{value:null}},vertexShader:ne.equirect_vert,fragmentShader:ne.equirect_frag},distance:{uniforms:on([Rt.common,Rt.displacementmap,{referencePosition:{value:new P},nearDistance:{value:1},farDistance:{value:1e3}}]),vertexShader:ne.distance_vert,fragmentShader:ne.distance_frag},shadow:{uniforms:on([Rt.lights,Rt.fog,{color:{value:new _t(0)},opacity:{value:1}}]),vertexShader:ne.shadow_vert,fragmentShader:ne.shadow_frag}};Jn.physical={uniforms:on([Jn.standard.uniforms,{clearcoat:{value:0},clearcoatMap:{value:null},clearcoatMapTransform:{value:new jt},clearcoatNormalMap:{value:null},clearcoatNormalMapTransform:{value:new jt},clearcoatNormalScale:{value:new rt(1,1)},clearcoatRoughness:{value:0},clearcoatRoughnessMap:{value:null},clearcoatRoughnessMapTransform:{value:new jt},dispersion:{value:0},retroreflectivity:{value:0},iridescence:{value:0},iridescenceMap:{value:null},iridescenceMapTransform:{value:new jt},iridescenceIOR:{value:1.3},iridescenceThicknessMinimum:{value:100},iridescenceThicknessMaximum:{value:400},iridescenceThicknessMap:{value:null},iridescenceThicknessMapTransform:{value:new jt},sheen:{value:0},sheenColor:{value:new _t(0)},sheenColorMap:{value:null},sheenColorMapTransform:{value:new jt},sheenRoughness:{value:1},sheenRoughnessMap:{value:null},sheenRoughnessMapTransform:{value:new jt},transmission:{value:0},transmissionMap:{value:null},transmissionMapTransform:{value:new jt},transmissionSamplerSize:{value:new rt},transmissionSamplerMap:{value:null},thickness:{value:0},thicknessMap:{value:null},thicknessMapTransform:{value:new jt},attenuationDistance:{value:0},attenuationColor:{value:new _t(0)},specularColor:{value:new _t(1,1,1)},specularColorMap:{value:null},specularColorMapTransform:{value:new jt},specularIntensity:{value:1},specularIntensityMap:{value:null},specularIntensityMapTransform:{value:new jt},anisotropyVector:{value:new rt},anisotropyMap:{value:null},anisotropyMapTransform:{value:new jt}}]),vertexShader:ne.meshphysical_vert,fragmentShader:ne.meshphysical_frag};var Ru={r:0,b:0,g:0},TS=new Jt,Gg=new jt;Gg.set(-1,0,0,0,1,0,0,0,1);function wS(s,t,e,n,i,r){let o=new _t(0),a=i===!0?0:1,l,c,h=null,f=0,u=null;function d(v){let b=v.isScene===!0?v.background:null;if(b&&b.isTexture){let y=v.backgroundBlurriness>0;b=t.get(b,y)}return b}function p(v){let b=!1,y=d(v);y===null?m(o,a):y&&y.isColor&&(m(y,1),b=!0);let M=s.xr.getEnvironmentBlendMode();M==="additive"?e.buffers.color.setClear(0,0,0,1,r):M==="alpha-blend"&&e.buffers.color.setClear(0,0,0,0,r),(s.autoClear||b)&&(e.buffers.depth.setTest(!0),e.buffers.depth.setMask(!0),e.buffers.color.setMask(!0),s.clear(s.autoClearColor,s.autoClearDepth,s.autoClearStencil))}function x(v,b){let y=d(b);y&&(y.isCubeTexture||y.mapping===Fs)?(c===void 0&&(c=new ce(new ii(1,1,1),new un({name:"BackgroundCubeMaterial",uniforms:ks(Jn.backgroundCube.uniforms),vertexShader:Jn.backgroundCube.vertexShader,fragmentShader:Jn.backgroundCube.fragmentShader,side:rn,depthTest:!1,depthWrite:!1,fog:!1,allowOverride:!1})),c.geometry.deleteAttribute("normal"),c.geometry.deleteAttribute("uv"),c.onBeforeRender=function(M,S,w){this.matrixWorld.copyPosition(w.matrixWorld)},Object.defineProperty(c.material,"envMap",{get:function(){return this.uniforms.envMap.value}}),n.update(c)),c.material.uniforms.envMap.value=y,c.material.uniforms.backgroundBlurriness.value=b.backgroundBlurriness,c.material.uniforms.backgroundIntensity.value=b.backgroundIntensity,c.material.uniforms.backgroundRotation.value.setFromMatrix4(TS.makeRotationFromEuler(b.backgroundRotation)).transpose(),y.isCubeTexture&&y.isRenderTargetTexture===!1&&c.material.uniforms.backgroundRotation.value.premultiply(Gg),c.material.toneMapped=re.getTransfer(y.colorSpace)!==ue,(h!==y||f!==y.version||u!==s.toneMapping)&&(c.material.needsUpdate=!0,h=y,f=y.version,u=s.toneMapping),c.layers.enableAll(),v.unshift(c,c.geometry,c.material,0,0,null)):y&&y.isTexture&&(l===void 0&&(l=new ce(new wi(2,2),new un({name:"BackgroundMaterial",uniforms:ks(Jn.background.uniforms),vertexShader:Jn.background.vertexShader,fragmentShader:Jn.background.fragmentShader,side:Ri,depthTest:!1,depthWrite:!1,fog:!1,allowOverride:!1})),l.geometry.deleteAttribute("normal"),Object.defineProperty(l.material,"map",{get:function(){return this.uniforms.t2D.value}}),n.update(l)),l.material.uniforms.t2D.value=y,l.material.uniforms.backgroundIntensity.value=b.backgroundIntensity,l.material.toneMapped=re.getTransfer(y.colorSpace)!==ue,y.matrixAutoUpdate===!0&&y.updateMatrix(),l.material.uniforms.uvTransform.value.copy(y.matrix),(h!==y||f!==y.version||u!==s.toneMapping)&&(l.material.needsUpdate=!0,h=y,f=y.version,u=s.toneMapping),l.layers.enableAll(),v.unshift(l,l.geometry,l.material,0,0,null))}function m(v,b){v.getRGB(Ru,Ld(s)),e.buffers.color.setClear(Ru.r,Ru.g,Ru.b,b,r)}function g(){c!==void 0&&(c.geometry.dispose(),c.material.dispose(),c=void 0),l!==void 0&&(l.geometry.dispose(),l.material.dispose(),l=void 0)}return{getClearColor:function(){return o},setClearColor:function(v,b=1){o.set(v),a=b,m(o,a)},getClearAlpha:function(){return a},setClearAlpha:function(v){a=v,m(o,a)},render:p,addToRenderList:x,dispose:g}}function AS(s,t){let e=s.getParameter(s.MAX_VERTEX_ATTRIBS),n={},i=u(null),r=i,o=!1;function a(L,D,F,C,N){let z=!1,O=f(L,C,F,D);r!==O&&(r=O,c(r.object)),z=d(L,C,F,N),z&&p(L,C,F,N),N!==null&&t.update(N,s.ELEMENT_ARRAY_BUFFER),(z||o)&&(o=!1,y(L,D,F,C),N!==null&&s.bindBuffer(s.ELEMENT_ARRAY_BUFFER,t.get(N).buffer))}function l(){return s.createVertexArray()}function c(L){return s.bindVertexArray(L)}function h(L){return s.deleteVertexArray(L)}function f(L,D,F,C){let N=C.wireframe===!0,z=n[D.id];z===void 0&&(z={},n[D.id]=z);let O=L.isInstancedMesh===!0?L.id:0,H=z[O];H===void 0&&(H={},z[O]=H);let U=H[F.id];U===void 0&&(U={},H[F.id]=U);let W=U[N];return W===void 0&&(W=u(l()),U[N]=W),W}function u(L){let D=[],F=[],C=[];for(let N=0;N<e;N++)D[N]=0,F[N]=0,C[N]=0;return{geometry:null,program:null,wireframe:!1,newAttributes:D,enabledAttributes:F,attributeDivisors:C,object:L,attributes:{},index:null}}function d(L,D,F,C){let N=r.attributes,z=D.attributes,O=0,H=F.getAttributes();for(let U in H)if(H[U].location>=0){let Z=N[U],j=z[U];if(j===void 0&&(U==="instanceMatrix"&&L.instanceMatrix&&(j=L.instanceMatrix),U==="instanceColor"&&L.instanceColor&&(j=L.instanceColor)),Z===void 0||Z.attribute!==j||j&&Z.data!==j.data)return!0;O++}return r.attributesNum!==O||r.index!==C}function p(L,D,F,C){let N={},z=D.attributes,O=0,H=F.getAttributes();for(let U in H)if(H[U].location>=0){let Z=z[U];Z===void 0&&(U==="instanceMatrix"&&L.instanceMatrix&&(Z=L.instanceMatrix),U==="instanceColor"&&L.instanceColor&&(Z=L.instanceColor));let j={};j.attribute=Z,Z&&Z.data&&(j.data=Z.data),N[U]=j,O++}r.attributes=N,r.attributesNum=O,r.index=C}function x(){let L=r.newAttributes;for(let D=0,F=L.length;D<F;D++)L[D]=0}function m(L){g(L,0)}function g(L,D){let F=r.newAttributes,C=r.enabledAttributes,N=r.attributeDivisors;F[L]=1,C[L]===0&&(s.enableVertexAttribArray(L),C[L]=1),N[L]!==D&&(s.vertexAttribDivisor(L,D),N[L]=D)}function v(){let L=r.newAttributes,D=r.enabledAttributes;for(let F=0,C=D.length;F<C;F++)D[F]!==L[F]&&(s.disableVertexAttribArray(F),D[F]=0)}function b(L,D,F,C,N,z,O){O===!0?s.vertexAttribIPointer(L,D,F,N,z):s.vertexAttribPointer(L,D,F,C,N,z)}function y(L,D,F,C){x();let N=C.attributes,z=F.getAttributes(),O=D.defaultAttributeValues;for(let H in z){let U=z[H];if(U.location>=0){let W=N[H];if(W===void 0&&(H==="instanceMatrix"&&L.instanceMatrix&&(W=L.instanceMatrix),H==="instanceColor"&&L.instanceColor&&(W=L.instanceColor)),W!==void 0){let Z=W.normalized,j=W.itemSize,q=t.get(W);if(q===void 0)continue;let it=q.buffer,ft=q.type,ht=q.bytesPerElement,G=ft===s.INT||ft===s.UNSIGNED_INT||W.gpuType===sl;if(W.isInterleavedBufferAttribute){let Q=W.data,lt=Q.stride,yt=W.offset;if(Q.isInstancedInterleavedBuffer){for(let dt=0;dt<U.locationSize;dt++)g(U.location+dt,Q.meshPerAttribute);L.isInstancedMesh!==!0&&C._maxInstanceCount===void 0&&(C._maxInstanceCount=Q.meshPerAttribute*Q.count)}else for(let dt=0;dt<U.locationSize;dt++)m(U.location+dt);s.bindBuffer(s.ARRAY_BUFFER,it);for(let dt=0;dt<U.locationSize;dt++)b(U.location+dt,j/U.locationSize,ft,Z,lt*ht,(yt+j/U.locationSize*dt)*ht,G)}else{if(W.isInstancedBufferAttribute){for(let Q=0;Q<U.locationSize;Q++)g(U.location+Q,W.meshPerAttribute);L.isInstancedMesh!==!0&&C._maxInstanceCount===void 0&&(C._maxInstanceCount=W.meshPerAttribute*W.count)}else for(let Q=0;Q<U.locationSize;Q++)m(U.location+Q);s.bindBuffer(s.ARRAY_BUFFER,it);for(let Q=0;Q<U.locationSize;Q++)b(U.location+Q,j/U.locationSize,ft,Z,j*ht,j/U.locationSize*Q*ht,G)}}else if(O!==void 0){let Z=O[H];if(Z!==void 0)switch(Z.length){case 2:s.vertexAttrib2fv(U.location,Z);break;case 3:s.vertexAttrib3fv(U.location,Z);break;case 4:s.vertexAttrib4fv(U.location,Z);break;default:s.vertexAttrib1fv(U.location,Z)}}}}v()}function M(){T();for(let L in n){let D=n[L];for(let F in D){let C=D[F];for(let N in C){let z=C[N];for(let O in z)h(z[O].object),delete z[O];delete C[N]}}delete n[L]}}function S(L){if(n[L.id]===void 0)return;let D=n[L.id];for(let F in D){let C=D[F];for(let N in C){let z=C[N];for(let O in z)h(z[O].object),delete z[O];delete C[N]}}delete n[L.id]}function w(L){for(let D in n){let F=n[D];for(let C in F){let N=F[C];if(N[L.id]===void 0)continue;let z=N[L.id];for(let O in z)h(z[O].object),delete z[O];delete N[L.id]}}}function _(L){for(let D in n){let F=n[D],C=L.isInstancedMesh===!0?L.id:0,N=F[C];if(N!==void 0){for(let z in N){let O=N[z];for(let H in O)h(O[H].object),delete O[H];delete N[z]}delete F[C],Object.keys(F).length===0&&delete n[D]}}}function T(){R(),o=!0,r!==i&&(r=i,c(r.object))}function R(){i.geometry=null,i.program=null,i.wireframe=!1}return{setup:a,reset:T,resetDefaultState:R,dispose:M,releaseStatesOfGeometry:S,releaseStatesOfObject:_,releaseStatesOfProgram:w,initAttributes:x,enableAttribute:m,disableUnusedAttributes:v}}function RS(s,t,e){let n;function i(l){n=l}function r(l,c){s.drawArrays(n,l,c),e.update(c,n,1)}function o(l,c,h){h!==0&&(s.drawArraysInstanced(n,l,c,h),e.update(c,n,h))}function a(l,c,h){if(h===0)return;t.get("WEBGL_multi_draw").multiDrawArraysWEBGL(n,l,0,c,0,h);let u=0;for(let d=0;d<h;d++)u+=c[d];e.update(u,n,1)}this.setMode=i,this.render=r,this.renderInstances=o,this.renderMultiDraw=a}function CS(s,t,e,n){let i;function r(){if(i!==void 0)return i;if(t.has("EXT_texture_filter_anisotropic")===!0){let w=t.get("EXT_texture_filter_anisotropic");i=s.getParameter(w.MAX_TEXTURE_MAX_ANISOTROPY_EXT)}else i=0;return i}function o(w){return!(w!==nn&&n.convert(w)!==s.getParameter(s.IMPLEMENTATION_COLOR_READ_FORMAT))}function a(w){let _=w===Nn&&(t.has("EXT_color_buffer_half_float")||t.has("EXT_color_buffer_float"));return!(w!==dn&&w!==en&&!_&&n.convert(w)!==s.getParameter(s.IMPLEMENTATION_COLOR_READ_TYPE))}function l(w){if(w==="highp"){if(s.getShaderPrecisionFormat(s.VERTEX_SHADER,s.HIGH_FLOAT).precision>0&&s.getShaderPrecisionFormat(s.FRAGMENT_SHADER,s.HIGH_FLOAT).precision>0)return"highp";w="mediump"}return w==="mediump"&&s.getShaderPrecisionFormat(s.VERTEX_SHADER,s.MEDIUM_FLOAT).precision>0&&s.getShaderPrecisionFormat(s.FRAGMENT_SHADER,s.MEDIUM_FLOAT).precision>0?"mediump":"lowp"}let c=e.precision!==void 0?e.precision:"highp",h=l(c);h!==c&&(St("WebGLRenderer:",c,"not supported, using",h,"instead."),c=h);let f=e.logarithmicDepthBuffer===!0,u=e.reversedDepthBuffer===!0&&t.has("EXT_clip_control");e.reversedDepthBuffer===!0&&u===!1&&St("WebGLRenderer: Unable to use reversed depth buffer due to missing EXT_clip_control extension. Fallback to default depth buffer.");let d=s.getParameter(s.MAX_TEXTURE_IMAGE_UNITS),p=s.getParameter(s.MAX_VERTEX_TEXTURE_IMAGE_UNITS),x=s.getParameter(s.MAX_TEXTURE_SIZE),m=s.getParameter(s.MAX_CUBE_MAP_TEXTURE_SIZE),g=s.getParameter(s.MAX_VERTEX_ATTRIBS),v=s.getParameter(s.MAX_VERTEX_UNIFORM_VECTORS),b=s.getParameter(s.MAX_VARYING_VECTORS),y=s.getParameter(s.MAX_FRAGMENT_UNIFORM_VECTORS),M=s.getParameter(s.MAX_SAMPLES),S=s.getParameter(s.SAMPLES);return{isWebGL2:!0,getMaxAnisotropy:r,getMaxPrecision:l,textureFormatReadable:o,textureTypeReadable:a,precision:c,logarithmicDepthBuffer:f,reversedDepthBuffer:u,maxTextures:d,maxVertexTextures:p,maxTextureSize:x,maxCubemapSize:m,maxAttributes:g,maxVertexUniforms:v,maxVaryings:b,maxFragmentUniforms:y,maxSamples:M,samples:S}}function IS(s){let t=this,e=null,n=0,i=!1,r=!1,o=new Rn,a=new jt,l={value:null,needsUpdate:!1};this.uniform=l,this.numPlanes=0,this.numIntersection=0,this.init=function(f,u){let d=f.length!==0||u||n!==0||i;return i=u,n=f.length,d},this.beginShadows=function(){r=!0,h(null)},this.endShadows=function(){r=!1},this.setGlobalState=function(f,u){e=h(f,u,0)},this.setState=function(f,u,d){let p=f.clippingPlanes,x=f.clipIntersection,m=f.clipShadows,g=s.get(f);if(!i||p===null||p.length===0||r&&!m)r?h(null):c();else{let v=r?0:n,b=v*4,y=g.clippingState||null;l.value=y,y=h(p,u,b,d);for(let M=0;M!==b;++M)y[M]=e[M];g.clippingState=y,this.numIntersection=x?this.numPlanes:0,this.numPlanes+=v}};function c(){l.value!==e&&(l.value=e,l.needsUpdate=n>0),t.numPlanes=n,t.numIntersection=0}function h(f,u,d,p){let x=f!==null?f.length:0,m=null;if(x!==0){if(m=l.value,p!==!0||m===null){let g=d+x*4,v=u.matrixWorldInverse;a.getNormalMatrix(v),(m===null||m.length<g)&&(m=new Float32Array(g));for(let b=0,y=d;b!==x;++b,y+=4)o.copy(f[b]).applyMatrix4(v,a),o.normal.toArray(m,y),m[y+3]=o.constant}l.value=m,l.needsUpdate=!0}return t.numPlanes=x,t.numIntersection=0,m}}var co=4,PS=6,LS=20,DS=256,Wl=new es,yg=new _t,Vd=null,Hd=0,Wd=0,Xd=!1,NS=new P,Gs=new P,Yl=class{constructor(t){this._renderer=t,this._pingPongRenderTarget=null,this._lodMax=0,this._cubeSize=0,this._sizeLods=[],this._lodMeshes=[],this._backgroundBox=null,this._cubemapMaterial=null,this._equirectMaterial=null,this._blurMaterial=null,this._ggxMaterial=null}fromScene(t,e=0,n=.1,i=100,r={}){let{size:o=256,position:a=NS}=r;Vd=this._renderer.getRenderTarget(),Hd=this._renderer.getActiveCubeFace(),Wd=this._renderer.getActiveMipmapLevel(),Xd=this._renderer.xr.enabled,this._renderer.xr.enabled=!1,this._setSize(o);let l=this._allocateTargets();return l.depthBuffer=!0,this._sceneToCubeUV(t,n,i,l,a),e>0&&this._blur(l,0,0,e),this._applyPMREM(l),this._cleanup(l),l}fromEquirectangular(t,e=null){return this._fromTexture(t,e)}fromCubemap(t,e=null){return this._fromTexture(t,e)}compileCubemapShader(){this._cubemapMaterial===null&&(this._cubemapMaterial=Sg(),this._compileMaterial(this._cubemapMaterial))}compileEquirectangularShader(){this._equirectMaterial===null&&(this._equirectMaterial=Mg(),this._compileMaterial(this._equirectMaterial))}dispose(){this._dispose(),this._cubemapMaterial!==null&&this._cubemapMaterial.dispose(),this._equirectMaterial!==null&&this._equirectMaterial.dispose(),this._backgroundBox!==null&&(this._backgroundBox.geometry.dispose(),this._backgroundBox.material.dispose())}_setSize(t){this._lodMax=Math.floor(Math.log2(t)),this._cubeSize=Math.pow(2,this._lodMax)}_dispose(){this._blurMaterial!==null&&this._blurMaterial.dispose(),this._ggxMaterial!==null&&this._ggxMaterial.dispose(),this._pingPongRenderTarget!==null&&this._pingPongRenderTarget.dispose();for(let t=0;t<this._lodMeshes.length;t++)this._lodMeshes[t].geometry.dispose()}_cleanup(t){this._renderer.setRenderTarget(Vd,Hd,Wd),this._renderer.xr.enabled=Xd,t.scissorTest=!1,lo(t,0,0,t.width,t.height)}_fromTexture(t,e){t.mapping===Zn||t.mapping===Ci?this._setSize(t.image.length===0?16:t.image[0].width||t.image[0].image.width):this._setSize(t.image.width/4),Vd=this._renderer.getRenderTarget(),Hd=this._renderer.getActiveCubeFace(),Wd=this._renderer.getActiveMipmapLevel(),Xd=this._renderer.xr.enabled,this._renderer.xr.enabled=!1;let n=e||this._allocateTargets();return this._textureToCubeUV(t,n),this._applyPMREM(n),this._cleanup(n),n}_allocateTargets(){let t=3*Math.max(this._cubeSize,112),e=4*this._cubeSize,n={magFilter:le,minFilter:le,generateMipmaps:!1,type:Nn,format:nn,colorSpace:Mr,depthBuffer:!1},i=vg(t,e,n);if(this._pingPongRenderTarget===null||this._pingPongRenderTarget.width!==t||this._pingPongRenderTarget.height!==e){this._pingPongRenderTarget!==null&&this._dispose(),this._pingPongRenderTarget=vg(t,e,n);let{_lodMax:r}=this;({lodMeshes:this._lodMeshes,sizeLods:this._sizeLods}=US(r)),this._blurMaterial=OS(r,t,e),this._ggxMaterial=FS(r,t,e)}return i}_compileMaterial(t){let e=new ce(new qt,t);this._renderer.compile(e,Wl)}_sceneToCubeUV(t,e,n,i,r){let l=new Oe(90,1,e,n),c=[1,-1,1,1,1,1],h=[1,1,1,-1,-1,-1],f=this._renderer,u=f.autoClear,d=f.toneMapping;f.getClearColor(yg),f.toneMapping=Dn,f.autoClear=!1,f.state.buffers.depth.getReversed()&&(f.setRenderTarget(i),f.clearDepth(),f.setRenderTarget(null)),this._backgroundBox===null&&(this._backgroundBox=new ce(new ii,new sn({name:"PMREM.Background",side:rn,depthWrite:!1,depthTest:!1})));let x=this._backgroundBox,m=x.material,g=!1,v=t.background;v?v.isColor&&(m.color.copy(v),t.background=null,g=!0):(m.color.copy(yg),g=!0);for(let b=0;b<6;b++){let y=b%3;y===0?(l.up.set(0,c[b],0),l.position.set(r.x,r.y,r.z),l.lookAt(r.x+h[b],r.y,r.z)):y===1?(l.up.set(0,0,c[b]),l.position.set(r.x,r.y,r.z),l.lookAt(r.x,r.y+h[b],r.z)):(l.up.set(0,c[b],0),l.position.set(r.x,r.y,r.z),l.lookAt(r.x,r.y,r.z+h[b]));let M=this._cubeSize;lo(i,y*M,b>2?M:0,M,M),f.setRenderTarget(i),g&&f.render(x,l),f.render(t,l)}f.toneMapping=d,f.autoClear=u,t.background=v}_textureToCubeUV(t,e){let n=this._renderer,i=t.mapping===Zn||t.mapping===Ci;i?(this._cubemapMaterial===null&&(this._cubemapMaterial=Sg()),this._cubemapMaterial.uniforms.flipEnvMap.value=t.isRenderTargetTexture===!1?-1:1):this._equirectMaterial===null&&(this._equirectMaterial=Mg());let r=i?this._cubemapMaterial:this._equirectMaterial,o=this._lodMeshes[0];o.material=r;let a=r.uniforms;a.envMap.value=t;let l=this._cubeSize;lo(e,0,0,3*l,2*l),n.setRenderTarget(e),n.render(o,Wl)}_applyPMREM(t){let e=this._renderer,n=e.autoClear;e.autoClear=!1;let i=this._lodMeshes.length;for(let r=1;r<i;r++)this._applyGGXFilter(t,r-1,r);e.autoClear=n}_applyGGXFilter(t,e,n){let i=this._renderer,r=this._pingPongRenderTarget,o=this._ggxMaterial,a=this._lodMeshes[n];a.material=o;let l=o.uniforms,c=n/(this._lodMeshes.length-1),h=e/(this._lodMeshes.length-1),f=Math.sqrt(c*c-h*h),u=c*1.25,d=f*u,{_lodMax:p}=this,x=this._sizeLods[n],m=3*x*(n>p-co?n-p+co:0),g=4*(this._cubeSize-x);l.envMap.value=t.texture,l.roughness.value=d,l.mipInt.value=p-e,lo(r,m,g,3*x,2*x),i.setRenderTarget(r),i.render(a,Wl),l.envMap.value=r.texture,l.roughness.value=0,l.mipInt.value=p-n,lo(t,m,g,3*x,2*x),i.setRenderTarget(t),i.render(a,Wl)}_blur(t,e,n,i){let r=this._pingPongRenderTarget,o=Math.min(i,Math.PI)/Math.SQRT2;this._blurPass(t,r,e,n,o),this._blurPass(r,t,n,n,o)}_blurPass(t,e,n,i,r){let o=this._renderer,a=this._blurMaterial,l=this._lodMeshes[i];l.material=a;let c=a.uniforms;c.envMap.value=t.texture,c.sigma.value=r,c.mipInt.value=this._lodMax-n;let h=this._sizeLods[i],f=3*h*(i>this._lodMax-co?i-this._lodMax+co:0),u=4*(this._cubeSize-h);lo(e,f,u,3*h,2*h),o.setRenderTarget(e),o.render(l,Wl)}};function US(s){let t=[],e=[],n=s,i=s-co+1+PS;for(let r=0;r<i;r++){let o=Math.pow(2,n);t.push(o);let a=1/(o-2),l=-a,c=1+a,h=[l,l,c,l,c,c,l,l,c,c,l,c],f=6,u=6,d=3,p=new Float32Array(d*u*f),x=new Float32Array(d*u*f);for(let g=0;g<f;g++){let v=g%3*2/3-1,b=g>2?0:-1,y=[v,b,0,v+2/3,b,0,v+2/3,b+1,0,v,b,0,v+2/3,b+1,0,v,b+1,0];p.set(y,d*u*g);for(let M=0;M<u;M++){let S=h[M*2]*2-1,w=h[M*2+1]*2-1;g===0?Gs.set(1,w,S):g===1?Gs.set(-S,1,-w):g===2?Gs.set(-S,w,1):g===3?Gs.set(-1,w,-S):g===4?Gs.set(-S,-1,w):Gs.set(S,w,-1),Gs.toArray(x,(g*u+M)*d)}}let m=new qt;m.setAttribute("position",new Qt(p,d)),m.setAttribute("outputDirection",new Qt(x,d)),e.push(new ce(m,null)),n>co&&n--}return{lodMeshes:e,sizeLods:t}}function vg(s,t,e){let n=new Je(s,t,e);return n.texture.mapping=Fs,n.texture.name="PMREM.cubeUv",n.scissorTest=!0,n}function lo(s,t,e,n,i){s.viewport.set(t,e,n,i),s.scissor.set(t,e,n,i)}function FS(s,t,e){return new un({name:"PMREMGGXConvolution",defines:{GGX_SAMPLES:DS,CUBEUV_TEXEL_WIDTH:1/t,CUBEUV_TEXEL_HEIGHT:1/e,CUBEUV_MAX_MIP:`${s}.0`},uniforms:{envMap:{value:null},roughness:{value:0},mipInt:{value:0}},vertexShader:Iu(),fragmentShader:`

			precision highp float;
			precision highp int;

			varying vec3 vOutputDirection;

			uniform sampler2D envMap;
			uniform float roughness;
			uniform float mipInt;

			#define ENVMAP_TYPE_CUBE_UV
			#include <cube_uv_reflection_fragment>

			#define PI 3.14159265359

			// Van der Corput radical inverse
			float radicalInverse_VdC(uint bits) {
				bits = (bits << 16u) | (bits >> 16u);
				bits = ((bits & 0x55555555u) << 1u) | ((bits & 0xAAAAAAAAu) >> 1u);
				bits = ((bits & 0x33333333u) << 2u) | ((bits & 0xCCCCCCCCu) >> 2u);
				bits = ((bits & 0x0F0F0F0Fu) << 4u) | ((bits & 0xF0F0F0F0u) >> 4u);
				bits = ((bits & 0x00FF00FFu) << 8u) | ((bits & 0xFF00FF00u) >> 8u);
				return float(bits) * 2.3283064365386963e-10; // / 0x100000000
			}

			// Hammersley sequence
			vec2 hammersley(uint i, uint N) {
				return vec2(float(i) / float(N), radicalInverse_VdC(i));
			}

			// GGX VNDF importance sampling (Eric Heitz 2018)
			// "Sampling the GGX Distribution of Visible Normals"
			// https://jcgt.org/published/0007/04/01/
			vec3 importanceSampleGGX_VNDF(vec2 Xi, vec3 V, float roughness) {
				float alpha = roughness * roughness;

				// Section 4.1: Orthonormal basis
				vec3 T1 = vec3(1.0, 0.0, 0.0);
				vec3 T2 = cross(V, T1);

				// Section 4.2: Parameterization of projected area
				float r = sqrt(Xi.x);
				float phi = 2.0 * PI * Xi.y;
				float t1 = r * cos(phi);
				float t2 = r * sin(phi);
				float s = 0.5 * (1.0 + V.z);
				t2 = (1.0 - s) * sqrt(1.0 - t1 * t1) + s * t2;

				// Section 4.3: Reprojection onto hemisphere
				vec3 Nh = t1 * T1 + t2 * T2 + sqrt(max(0.0, 1.0 - t1 * t1 - t2 * t2)) * V;

				// Section 3.4: Transform back to ellipsoid configuration
				return normalize(vec3(alpha * Nh.x, alpha * Nh.y, max(0.0, Nh.z)));
			}

			void main() {
				vec3 N = normalize(vOutputDirection);
				vec3 V = N; // Assume view direction equals normal for pre-filtering

				vec3 prefilteredColor = vec3(0.0);
				float totalWeight = 0.0;

				// For very low roughness, just sample the environment directly
				if (roughness < 0.001) {
					gl_FragColor = vec4(bilinearCubeUV(envMap, N, mipInt), 1.0);
					return;
				}

				// Tangent space basis for VNDF sampling
				vec3 up = abs(N.z) < 0.999 ? vec3(0.0, 0.0, 1.0) : vec3(1.0, 0.0, 0.0);
				vec3 tangent = normalize(cross(up, N));
				vec3 bitangent = cross(N, tangent);

				for(uint i = 0u; i < uint(GGX_SAMPLES); i++) {
					vec2 Xi = hammersley(i, uint(GGX_SAMPLES));

					// For PMREM, V = N, so in tangent space V is always (0, 0, 1)
					vec3 H_tangent = importanceSampleGGX_VNDF(Xi, vec3(0.0, 0.0, 1.0), roughness);

					// Transform H back to world space
					vec3 H = normalize(tangent * H_tangent.x + bitangent * H_tangent.y + N * H_tangent.z);
					vec3 L = normalize(2.0 * dot(V, H) * H - V);

					float NdotL = max(dot(N, L), 0.0);

					if(NdotL > 0.0) {
						// Sample environment at fixed mip level
						// VNDF importance sampling handles the distribution filtering
						vec3 sampleColor = bilinearCubeUV(envMap, L, mipInt);

						// Weight by NdotL for the split-sum approximation
						// VNDF PDF naturally accounts for the visible microfacet distribution
						prefilteredColor += sampleColor * NdotL;
						totalWeight += NdotL;
					}
				}

				if (totalWeight > 0.0) {
					prefilteredColor = prefilteredColor / totalWeight;
				}

				gl_FragColor = vec4(prefilteredColor, 1.0);
			}
		`,blending:Yn,depthTest:!1,depthWrite:!1})}function OS(s,t,e){return new un({name:"SphericalGaussianBlur",defines:{SAMPLES:LS,CUBEUV_TEXEL_WIDTH:1/t,CUBEUV_TEXEL_HEIGHT:1/e,CUBEUV_MAX_MIP:`${s}.0`},uniforms:{envMap:{value:null},sigma:{value:0},mipInt:{value:0}},vertexShader:Iu(),fragmentShader:`

			precision highp float;
			precision highp int;

			varying vec3 vOutputDirection;

			uniform sampler2D envMap;
			uniform float sigma;
			uniform float mipInt;

			#define ENVMAP_TYPE_CUBE_UV
			#include <cube_uv_reflection_fragment>

			#define PI 3.14159265359
			#define GOLDEN_ANGLE 2.39996322973

			void main() {

				if ( sigma == 0.0 ) {

					gl_FragColor = vec4( bilinearCubeUV( envMap, vOutputDirection, mipInt ), 1.0 );
					return;

				}

				vec3 outputDirection = normalize( vOutputDirection );

				vec3 up = abs( outputDirection.z ) < 0.999 ? vec3( 0.0, 0.0, 1.0 ) : vec3( 1.0, 0.0, 0.0 );
				vec3 tangent = normalize( cross( up, outputDirection ) );
				vec3 bitangent = cross( outputDirection, tangent );

				// Truncate the kernel at three standard deviations or at the antipode.
				float thetaMax = min( 3.0 * sigma, PI );
				float truncation = 1.0 - exp( - 0.5 * thetaMax * thetaMax / ( sigma * sigma ) );

				vec3 accumColor = vec3( 0.0 );
				float accumWeight = 0.0;

				for ( int i = 0; i < SAMPLES; i ++ ) {

					// Stratified inverse-CDF sampling of the Gaussian, placed on a golden-angle spiral.
					float stratum = ( float( i ) + 0.5 ) / float( SAMPLES );
					float theta = sigma * sqrt( - 2.0 * log( 1.0 - stratum * truncation ) );
					float phi = float( i ) * GOLDEN_ANGLE;

					vec3 offset = cos( phi ) * tangent + sin( phi ) * bitangent;
					vec3 sampleDirection = cos( theta ) * outputDirection + sin( theta ) * offset;

					// Correct the planar sample density to solid angle.
					float weight = sin( theta ) / theta;

					accumColor += weight * bilinearCubeUV( envMap, sampleDirection, mipInt );
					accumWeight += weight;

				}

				gl_FragColor = vec4( accumColor / accumWeight, 1.0 );

			}
		`,blending:Yn,depthTest:!1,depthWrite:!1})}function Mg(){return new un({name:"EquirectangularToCubeUV",uniforms:{envMap:{value:null}},vertexShader:Iu(),fragmentShader:`

			precision mediump float;
			precision mediump int;

			varying vec3 vOutputDirection;

			uniform sampler2D envMap;

			#include <common>

			void main() {

				vec3 outputDirection = normalize( vOutputDirection );
				vec2 uv = equirectUv( outputDirection );

				gl_FragColor = vec4( texture2D ( envMap, uv ).rgb, 1.0 );

			}
		`,blending:Yn,depthTest:!1,depthWrite:!1})}function Sg(){return new un({name:"CubemapToCubeUV",uniforms:{envMap:{value:null},flipEnvMap:{value:-1}},vertexShader:Iu(),fragmentShader:`

			precision mediump float;
			precision mediump int;

			uniform float flipEnvMap;

			varying vec3 vOutputDirection;

			uniform samplerCube envMap;

			void main() {

				gl_FragColor = textureCube( envMap, vec3( flipEnvMap * vOutputDirection.x, vOutputDirection.yz ) );

			}
		`,blending:Yn,depthTest:!1,depthWrite:!1})}function Iu(){return`

		precision mediump float;
		precision mediump int;

		attribute vec3 outputDirection;

		varying vec3 vOutputDirection;

		void main() {

			vOutputDirection = outputDirection;
			gl_Position = vec4( position, 1.0 );

		}
	`}var Zl=class extends Je{constructor(t=1,e={}){super(t,t,e),this.isWebGLCubeRenderTarget=!0;let n={width:t,height:t,depth:1},i=[n,n,n,n,n,n];this.texture=new $i(i),this._setTextureOptions(e),this.texture.isRenderTargetTexture=!0}fromEquirectangularTexture(t,e){this.texture.type=e.type,this.texture.colorSpace=e.colorSpace,this.texture.generateMipmaps=e.generateMipmaps,this.texture.minFilter=e.minFilter,this.texture.magFilter=e.magFilter;let n={uniforms:{tEquirect:{value:null}},vertexShader:`

				varying vec3 vWorldDirection;

				vec3 transformDirection( in vec3 dir, in mat4 matrix ) {

					return normalize( ( matrix * vec4( dir, 0.0 ) ).xyz );

				}

				void main() {

					vWorldDirection = transformDirection( position, modelMatrix );

					#include <begin_vertex>
					#include <project_vertex>

				}
			`,fragmentShader:`

				uniform sampler2D tEquirect;

				varying vec3 vWorldDirection;

				#include <common>

				void main() {

					vec3 direction = normalize( vWorldDirection );

					vec2 sampleUV = equirectUv( direction );

					gl_FragColor = texture2D( tEquirect, sampleUV );

				}
			`},i=new ii(5,5,5),r=new un({name:"CubemapFromEquirect",uniforms:ks(n.uniforms),vertexShader:n.vertexShader,fragmentShader:n.fragmentShader,side:rn,blending:Yn});r.uniforms.tEquirect.value=e;let o=new ce(i,r),a=e.minFilter;return e.minFilter===Ve&&(e.minFilter=le),new Ja(1,10,this).update(t,o),e.minFilter=a,o.geometry.dispose(),o.material.dispose(),this}clear(t,e=!0,n=!0,i=!0){let r=t.getRenderTarget();for(let o=0;o<6;o++)t.setRenderTarget(this,o),t.clear(e,n,i);t.setRenderTarget(r)}};function BS(s){let t=new WeakMap,e=new WeakMap,n=null;function i(u,d=!1){return u==null?null:d?o(u):r(u)}function r(u){if(u&&u.isTexture){let d=u.mapping;if(d===Qr||d===jr)if(t.has(u)){let p=t.get(u).texture;return a(p,u.mapping)}else{let p=u.image;if(p&&p.height>0){let x=new Zl(p.height);return x.fromEquirectangularTexture(s,u),t.set(u,x),u.addEventListener("dispose",c),a(x.texture,u.mapping)}else return null}}return u}function o(u){if(u&&u.isTexture){let d=u.mapping,p=d===Qr||d===jr,x=d===Zn||d===Ci;if(p||x){let m=e.get(u),g=m!==void 0?m.texture.pmremVersion:0;if(u.isRenderTargetTexture&&u.pmremVersion!==g)return n===null&&(n=new Yl(s)),m=p?n.fromEquirectangular(u,m):n.fromCubemap(u,m),m.texture.pmremVersion=u.pmremVersion,e.set(u,m),m.texture;if(m!==void 0)return m.texture;{let v=u.image;return p&&v&&v.height>0||x&&v&&l(v)?(n===null&&(n=new Yl(s)),m=p?n.fromEquirectangular(u):n.fromCubemap(u),m.texture.pmremVersion=u.pmremVersion,e.set(u,m),u.addEventListener("dispose",h),m.texture):null}}}return u}function a(u,d){return d===Qr?u.mapping=Zn:d===jr&&(u.mapping=Ci),u}function l(u){let d=0,p=6;for(let x=0;x<p;x++)u[x]!==void 0&&d++;return d===p}function c(u){let d=u.target;d.removeEventListener("dispose",c);let p=t.get(d);p!==void 0&&(t.delete(d),p.dispose())}function h(u){let d=u.target;d.removeEventListener("dispose",h);let p=e.get(d);p!==void 0&&(e.delete(d),p.dispose())}function f(){t=new WeakMap,e=new WeakMap,n!==null&&(n.dispose(),n=null)}return{get:i,dispose:f}}function zS(s){let t={};function e(n){if(t[n]!==void 0)return t[n];let i=s.getExtension(n);return t[n]=i,i}return{has:function(n){return e(n)!==null},init:function(){e("EXT_color_buffer_float"),e("WEBGL_clip_cull_distance"),e("OES_texture_float_linear"),e("EXT_color_buffer_half_float"),e("WEBGL_multisampled_render_to_texture"),e("WEBGL_render_shared_exponent")},get:function(n){let i=e(n);return i===null&&ti("WebGLRenderer: "+n+" extension not supported."),i}}}function kS(s,t,e,n){let i={},r=new WeakMap;function o(f){let u=f.target;u.index!==null&&t.remove(u.index);for(let p in u.attributes)t.remove(u.attributes[p]);u.removeEventListener("dispose",o),delete i[u.id];let d=r.get(u);d&&(t.remove(d),r.delete(u)),n.releaseStatesOfGeometry(u),u.isInstancedBufferGeometry===!0&&delete u._maxInstanceCount,e.memory.geometries--}function a(f,u){return i[u.id]===!0||(u.addEventListener("dispose",o),i[u.id]=!0,e.memory.geometries++),u}function l(f){let u=f.attributes;for(let d in u)t.update(u[d],s.ARRAY_BUFFER)}function c(f){let u=[],d=f.index,p=f.attributes.position,x=0;if(p===void 0)return;if(d!==null){let v=d.array;x=d.version;for(let b=0,y=v.length;b<y;b+=3){let M=v[b+0],S=v[b+1],w=v[b+2];u.push(M,S,S,w,w,M)}}else{let v=p.array;x=p.version;for(let b=0,y=v.length/3-1;b<y;b+=3){let M=b+0,S=b+1,w=b+2;u.push(M,S,S,w,w,M)}}let m=new(p.count>=65535?Ar:wr)(u,1);m.version=x;let g=r.get(f);g&&t.remove(g),r.set(f,m)}function h(f){let u=r.get(f);if(u){let d=f.index;d!==null&&u.version<d.version&&c(f)}else c(f);return r.get(f)}return{get:a,update:l,getWireframeAttribute:h}}function GS(s,t,e){let n;function i(f){n=f}let r,o;function a(f){r=f.type,o=f.bytesPerElement}function l(f,u){s.drawElements(n,u,r,f*o),e.update(u,n,1)}function c(f,u,d){d!==0&&(s.drawElementsInstanced(n,u,r,f*o,d),e.update(u,n,d))}function h(f,u,d){if(d===0)return;t.get("WEBGL_multi_draw").multiDrawElementsWEBGL(n,u,0,r,f,0,d);let x=0;for(let m=0;m<d;m++)x+=u[m];e.update(x,n,1)}this.setMode=i,this.setIndex=a,this.render=l,this.renderInstances=c,this.renderMultiDraw=h}function VS(s){let t={geometries:0,textures:0},e={frame:0,calls:0,triangles:0,points:0,lines:0};function n(r,o,a){switch(e.calls++,o){case s.TRIANGLES:e.triangles+=a*(r/3);break;case s.LINES:e.lines+=a*(r/2);break;case s.LINE_STRIP:e.lines+=a*(r-1);break;case s.LINE_LOOP:e.lines+=a*r;break;case s.POINTS:e.points+=a*r;break;default:Bt("WebGLInfo: Unknown draw mode:",o);break}}function i(){e.calls=0,e.triangles=0,e.points=0,e.lines=0}return{memory:t,render:e,programs:null,autoReset:!0,reset:i,update:n}}function HS(s,t,e){let n=new WeakMap,i=new ge;function r(o,a,l){let c=o.morphTargetInfluences,h=a.morphAttributes.position||a.morphAttributes.normal||a.morphAttributes.color,f=h!==void 0?h.length:0,u=n.get(a);if(u===void 0||u.count!==f){let T=function(){w.dispose(),n.delete(a),a.removeEventListener("dispose",T)};u!==void 0&&u.texture.dispose();let d=a.morphAttributes.position!==void 0,p=a.morphAttributes.normal!==void 0,x=a.morphAttributes.color!==void 0,m=a.morphAttributes.position||[],g=a.morphAttributes.normal||[],v=a.morphAttributes.color||[],b=0;d===!0&&(b=1),p===!0&&(b=2),x===!0&&(b=3);let y=a.attributes.position.count*b,M=1;y>t.maxTextureSize&&(M=Math.ceil(y/t.maxTextureSize),y=t.maxTextureSize);let S=new Float32Array(y*M*4*f),w=new Ms(S,y,M,f);w.type=en,w.needsUpdate=!0;let _=b*4;for(let R=0;R<f;R++){let L=m[R],D=g[R],F=v[R],C=y*M*4*R;for(let N=0;N<L.count;N++){let z=N*_;d===!0&&(i.fromBufferAttribute(L,N),S[C+z+0]=i.x,S[C+z+1]=i.y,S[C+z+2]=i.z,S[C+z+3]=0),p===!0&&(i.fromBufferAttribute(D,N),S[C+z+4]=i.x,S[C+z+5]=i.y,S[C+z+6]=i.z,S[C+z+7]=0),x===!0&&(i.fromBufferAttribute(F,N),S[C+z+8]=i.x,S[C+z+9]=i.y,S[C+z+10]=i.z,S[C+z+11]=F.itemSize===4?i.w:1)}}u={count:f,texture:w,size:new rt(y,M)},n.set(a,u),a.addEventListener("dispose",T)}if(o.isInstancedMesh===!0&&o.morphTexture!==null)l.getUniforms().setValue(s,"morphTexture",o.morphTexture,e);else{let d=0;for(let x=0;x<c.length;x++)d+=c[x];let p=a.morphTargetsRelative?1:1-d;l.getUniforms().setValue(s,"morphTargetBaseInfluence",p),l.getUniforms().setValue(s,"morphTargetInfluences",c)}l.getUniforms().setValue(s,"morphTargetsTexture",u.texture,e),l.getUniforms().setValue(s,"morphTargetsTextureSize",u.size)}return{update:r}}function WS(s,t,e,n,i){let r=new WeakMap;function o(c){let h=i.render.frame,f=c.geometry,u=t.get(c,f);if(r.get(u)!==h&&(t.update(u),r.set(u,h)),c.isInstancedMesh&&(c.hasEventListener("dispose",l)===!1&&c.addEventListener("dispose",l),r.get(c)!==h&&(e.update(c.instanceMatrix,s.ARRAY_BUFFER),c.instanceColor!==null&&e.update(c.instanceColor,s.ARRAY_BUFFER),r.set(c,h))),c.isSkinnedMesh){let d=c.skeleton;r.get(d)!==h&&(d.update(),r.set(d,h))}return u}function a(){r=new WeakMap}function l(c){let h=c.target;h.removeEventListener("dispose",l),n.releaseStatesOfObject(h),e.remove(h.instanceMatrix),h.instanceColor!==null&&e.remove(h.instanceColor)}return{update:o,dispose:a}}var XS={[uu]:"LINEAR_TONE_MAPPING",[fu]:"REINHARD_TONE_MAPPING",[du]:"CINEON_TONE_MAPPING",[pu]:"ACES_FILMIC_TONE_MAPPING",[gu]:"AGX_TONE_MAPPING",[xu]:"NEUTRAL_TONE_MAPPING",[mu]:"CUSTOM_TONE_MAPPING"};function qS(s,t,e,n,i,r){let o=new Je(t,e,{type:s,depthBuffer:i,stencilBuffer:r,samples:n?4:0,storeMultisampledDepthBuffer:!1,storeMultisampledStencilBuffer:!1,resolveDepthBuffer:!1,resolveStencilBuffer:!1}),a=null,l=null,c=new qt;c.setAttribute("position",new At([-1,3,0,-1,-1,0,3,-1,0],3)),c.setAttribute("uv",new At([0,2,0,0,2,0],2));let h=new kr({uniforms:{tDiffuse:{value:null}},vertexShader:`
			precision highp float;

			uniform mat4 modelViewMatrix;
			uniform mat4 projectionMatrix;

			attribute vec3 position;
			attribute vec2 uv;

			varying vec2 vUv;

			void main() {
				vUv = uv;
				gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
			}`,fragmentShader:`
			precision highp float;

			uniform sampler2D tDiffuse;

			varying vec2 vUv;

			#include <tonemapping_pars_fragment>
			#include <colorspace_pars_fragment>

			void main() {
				gl_FragColor = texture2D( tDiffuse, vUv );

				#ifdef LINEAR_TONE_MAPPING
					gl_FragColor.rgb = LinearToneMapping( gl_FragColor.rgb );
				#elif defined( REINHARD_TONE_MAPPING )
					gl_FragColor.rgb = ReinhardToneMapping( gl_FragColor.rgb );
				#elif defined( CINEON_TONE_MAPPING )
					gl_FragColor.rgb = CineonToneMapping( gl_FragColor.rgb );
				#elif defined( ACES_FILMIC_TONE_MAPPING )
					gl_FragColor.rgb = ACESFilmicToneMapping( gl_FragColor.rgb );
				#elif defined( AGX_TONE_MAPPING )
					gl_FragColor.rgb = AgXToneMapping( gl_FragColor.rgb );
				#elif defined( NEUTRAL_TONE_MAPPING )
					gl_FragColor.rgb = NeutralToneMapping( gl_FragColor.rgb );
				#elif defined( CUSTOM_TONE_MAPPING )
					gl_FragColor.rgb = CustomToneMapping( gl_FragColor.rgb );
				#endif

				#ifdef SRGB_TRANSFER
					gl_FragColor = sRGBTransferOETF( gl_FragColor );
				#endif
			}`,depthTest:!1,depthWrite:!1}),f=new ce(c,h),u=new es(-1,1,1,-1,0,1),d=null,p=null,x=!1,m,g=null,v=[],b=!1;this.setSize=function(y,M){o.setSize(y,M),a!==null&&a.setSize(y,M),l!==null&&l.setSize(y,M);for(let S=0;S<v.length;S++){let w=v[S];w.setSize&&w.setSize(y,M)}},this.setEffects=function(y){v=y,b=v.length>0&&v[0].isRenderPass===!0;let M=o.width,S=o.height;v.length>0&&a===null&&(a=new Je(M,S,{type:Nn,depthBuffer:!1,stencilBuffer:!1}),l=new Je(M,S,{type:Nn,depthBuffer:!1,stencilBuffer:!1}));for(let w=0;w<v.length;w++){let _=v[w];_.setSize&&_.setSize(M,S)}},this.begin=function(y,M){if(x||y.toneMapping===Dn&&v.length===0)return!1;if(g=M,M!==null){let S=M.width,w=M.height;(o.width!==S||o.height!==w)&&this.setSize(S,w)}return b===!1&&y.setRenderTarget(o),m=y.toneMapping,y.toneMapping=Dn,!0},this.hasRenderPass=function(){return b},this.end=function(y,M){y.toneMapping=m,x=!0;let S=o,w=a;for(let _=0;_<v.length;_++){let T=v[_];T.enabled!==!1&&(T.render(y,w,S,M),T.needsSwap!==!1&&(S=w,w=w===a?l:a))}if(d!==y.outputColorSpace||p!==y.toneMapping){d=y.outputColorSpace,p=y.toneMapping,h.defines={},re.getTransfer(d)===ue&&(h.defines.SRGB_TRANSFER="");let _=XS[p];_&&(h.defines[_]=""),h.needsUpdate=!0}h.uniforms.tDiffuse.value=S.texture,y.setRenderTarget(g),y.render(f,u),g=null,x=!1},this.isCompositing=function(){return x},this.dispose=function(){o.dispose(),a!==null&&a.dispose(),l!==null&&l.dispose(),c.dispose(),h.dispose()}}var Vg=new Pe,Zd=new bi(1,1),Hg=new Ms,Wg=new Ss,Xg=new $i,bg=[],Eg=[],Tg=new Float32Array(16),wg=new Float32Array(9),Ag=new Float32Array(4);function uo(s,t,e){let n=s[0];if(n<=0||n>0)return s;let i=t*e,r=bg[i];if(r===void 0&&(r=new Float32Array(i),bg[i]=r),t!==0){n.toArray(r,0);for(let o=1,a=0;o!==t;++o)a+=e,s[o].toArray(r,a)}return r}function We(s,t){if(s.length!==t.length)return!1;for(let e=0,n=s.length;e<n;e++)if(s[e]!==t[e])return!1;return!0}function Xe(s,t){for(let e=0,n=t.length;e<n;e++)s[e]=t[e]}function Pu(s,t){let e=Eg[t];e===void 0&&(e=new Int32Array(t),Eg[t]=e);for(let n=0;n!==t;++n)e[n]=s.allocateTextureUnit();return e}function YS(s,t){let e=this.cache;e[0]!==t&&(s.uniform1f(this.addr,t),e[0]=t)}function ZS(s,t){let e=this.cache;if(t.x!==void 0)(e[0]!==t.x||e[1]!==t.y)&&(s.uniform2f(this.addr,t.x,t.y),e[0]=t.x,e[1]=t.y);else{if(We(e,t))return;s.uniform2fv(this.addr,t),Xe(e,t)}}function JS(s,t){let e=this.cache;if(t.x!==void 0)(e[0]!==t.x||e[1]!==t.y||e[2]!==t.z)&&(s.uniform3f(this.addr,t.x,t.y,t.z),e[0]=t.x,e[1]=t.y,e[2]=t.z);else if(t.r!==void 0)(e[0]!==t.r||e[1]!==t.g||e[2]!==t.b)&&(s.uniform3f(this.addr,t.r,t.g,t.b),e[0]=t.r,e[1]=t.g,e[2]=t.b);else{if(We(e,t))return;s.uniform3fv(this.addr,t),Xe(e,t)}}function $S(s,t){let e=this.cache;if(t.x!==void 0)(e[0]!==t.x||e[1]!==t.y||e[2]!==t.z||e[3]!==t.w)&&(s.uniform4f(this.addr,t.x,t.y,t.z,t.w),e[0]=t.x,e[1]=t.y,e[2]=t.z,e[3]=t.w);else{if(We(e,t))return;s.uniform4fv(this.addr,t),Xe(e,t)}}function KS(s,t){let e=this.cache,n=t.elements;if(n===void 0){if(We(e,t))return;s.uniformMatrix2fv(this.addr,!1,t),Xe(e,t)}else{if(We(e,n))return;Ag.set(n),s.uniformMatrix2fv(this.addr,!1,Ag),Xe(e,n)}}function QS(s,t){let e=this.cache,n=t.elements;if(n===void 0){if(We(e,t))return;s.uniformMatrix3fv(this.addr,!1,t),Xe(e,t)}else{if(We(e,n))return;wg.set(n),s.uniformMatrix3fv(this.addr,!1,wg),Xe(e,n)}}function jS(s,t){let e=this.cache,n=t.elements;if(n===void 0){if(We(e,t))return;s.uniformMatrix4fv(this.addr,!1,t),Xe(e,t)}else{if(We(e,n))return;Tg.set(n),s.uniformMatrix4fv(this.addr,!1,Tg),Xe(e,n)}}function tb(s,t){let e=this.cache;e[0]!==t&&(s.uniform1i(this.addr,t),e[0]=t)}function eb(s,t){let e=this.cache;if(t.x!==void 0)(e[0]!==t.x||e[1]!==t.y)&&(s.uniform2i(this.addr,t.x,t.y),e[0]=t.x,e[1]=t.y);else{if(We(e,t))return;s.uniform2iv(this.addr,t),Xe(e,t)}}function nb(s,t){let e=this.cache;if(t.x!==void 0)(e[0]!==t.x||e[1]!==t.y||e[2]!==t.z)&&(s.uniform3i(this.addr,t.x,t.y,t.z),e[0]=t.x,e[1]=t.y,e[2]=t.z);else{if(We(e,t))return;s.uniform3iv(this.addr,t),Xe(e,t)}}function ib(s,t){let e=this.cache;if(t.x!==void 0)(e[0]!==t.x||e[1]!==t.y||e[2]!==t.z||e[3]!==t.w)&&(s.uniform4i(this.addr,t.x,t.y,t.z,t.w),e[0]=t.x,e[1]=t.y,e[2]=t.z,e[3]=t.w);else{if(We(e,t))return;s.uniform4iv(this.addr,t),Xe(e,t)}}function sb(s,t){let e=this.cache;e[0]!==t&&(s.uniform1ui(this.addr,t),e[0]=t)}function rb(s,t){let e=this.cache;if(t.x!==void 0)(e[0]!==t.x||e[1]!==t.y)&&(s.uniform2ui(this.addr,t.x,t.y),e[0]=t.x,e[1]=t.y);else{if(We(e,t))return;s.uniform2uiv(this.addr,t),Xe(e,t)}}function ob(s,t){let e=this.cache;if(t.x!==void 0)(e[0]!==t.x||e[1]!==t.y||e[2]!==t.z)&&(s.uniform3ui(this.addr,t.x,t.y,t.z),e[0]=t.x,e[1]=t.y,e[2]=t.z);else{if(We(e,t))return;s.uniform3uiv(this.addr,t),Xe(e,t)}}function ab(s,t){let e=this.cache;if(t.x!==void 0)(e[0]!==t.x||e[1]!==t.y||e[2]!==t.z||e[3]!==t.w)&&(s.uniform4ui(this.addr,t.x,t.y,t.z,t.w),e[0]=t.x,e[1]=t.y,e[2]=t.z,e[3]=t.w);else{if(We(e,t))return;s.uniform4uiv(this.addr,t),Xe(e,t)}}function lb(s,t,e){let n=this.cache,i=e.allocateTextureUnit();n[0]!==i&&(s.uniform1i(this.addr,i),n[0]=i);let r;this.type===s.SAMPLER_2D_SHADOW?(Zd.compareFunction=e.isReversedDepthBuffer()?Vl:Gl,r=Zd):r=Vg,e.setTexture2D(t||r,i)}function cb(s,t,e){let n=this.cache,i=e.allocateTextureUnit();n[0]!==i&&(s.uniform1i(this.addr,i),n[0]=i),e.setTexture3D(t||Wg,i)}function hb(s,t,e){let n=this.cache,i=e.allocateTextureUnit();n[0]!==i&&(s.uniform1i(this.addr,i),n[0]=i),e.setTextureCube(t||Xg,i)}function ub(s,t,e){let n=this.cache,i=e.allocateTextureUnit();n[0]!==i&&(s.uniform1i(this.addr,i),n[0]=i),e.setTexture2DArray(t||Hg,i)}function fb(s){switch(s){case 5126:return YS;case 35664:return ZS;case 35665:return JS;case 35666:return $S;case 35674:return KS;case 35675:return QS;case 35676:return jS;case 5124:case 35670:return tb;case 35667:case 35671:return eb;case 35668:case 35672:return nb;case 35669:case 35673:return ib;case 5125:return sb;case 36294:return rb;case 36295:return ob;case 36296:return ab;case 35678:case 36198:case 36298:case 36306:case 35682:return lb;case 35679:case 36299:case 36307:return cb;case 35680:case 36300:case 36308:case 36293:return hb;case 36289:case 36303:case 36311:case 36292:return ub}}function db(s,t){s.uniform1fv(this.addr,t)}function pb(s,t){let e=uo(t,this.size,2);s.uniform2fv(this.addr,e)}function mb(s,t){let e=uo(t,this.size,3);s.uniform3fv(this.addr,e)}function gb(s,t){let e=uo(t,this.size,4);s.uniform4fv(this.addr,e)}function xb(s,t){let e=uo(t,this.size,4);s.uniformMatrix2fv(this.addr,!1,e)}function _b(s,t){let e=uo(t,this.size,9);s.uniformMatrix3fv(this.addr,!1,e)}function yb(s,t){let e=uo(t,this.size,16);s.uniformMatrix4fv(this.addr,!1,e)}function vb(s,t){s.uniform1iv(this.addr,t)}function Mb(s,t){s.uniform2iv(this.addr,t)}function Sb(s,t){s.uniform3iv(this.addr,t)}function bb(s,t){s.uniform4iv(this.addr,t)}function Eb(s,t){s.uniform1uiv(this.addr,t)}function Tb(s,t){s.uniform2uiv(this.addr,t)}function wb(s,t){s.uniform3uiv(this.addr,t)}function Ab(s,t){s.uniform4uiv(this.addr,t)}function Rb(s,t,e){let n=this.cache,i=t.length,r=Pu(e,i);We(n,r)||(s.uniform1iv(this.addr,r),Xe(n,r));let o;this.type===s.SAMPLER_2D_SHADOW?o=Zd:o=Vg;for(let a=0;a!==i;++a)e.setTexture2D(t[a]||o,r[a])}function Cb(s,t,e){let n=this.cache,i=t.length,r=Pu(e,i);We(n,r)||(s.uniform1iv(this.addr,r),Xe(n,r));for(let o=0;o!==i;++o)e.setTexture3D(t[o]||Wg,r[o])}function Ib(s,t,e){let n=this.cache,i=t.length,r=Pu(e,i);We(n,r)||(s.uniform1iv(this.addr,r),Xe(n,r));for(let o=0;o!==i;++o)e.setTextureCube(t[o]||Xg,r[o])}function Pb(s,t,e){let n=this.cache,i=t.length,r=Pu(e,i);We(n,r)||(s.uniform1iv(this.addr,r),Xe(n,r));for(let o=0;o!==i;++o)e.setTexture2DArray(t[o]||Hg,r[o])}function Lb(s){switch(s){case 5126:return db;case 35664:return pb;case 35665:return mb;case 35666:return gb;case 35674:return xb;case 35675:return _b;case 35676:return yb;case 5124:case 35670:return vb;case 35667:case 35671:return Mb;case 35668:case 35672:return Sb;case 35669:case 35673:return bb;case 5125:return Eb;case 36294:return Tb;case 36295:return wb;case 36296:return Ab;case 35678:case 36198:case 36298:case 36306:case 35682:return Rb;case 35679:case 36299:case 36307:return Cb;case 35680:case 36300:case 36308:case 36293:return Ib;case 36289:case 36303:case 36311:case 36292:return Pb}}var Jd=class{constructor(t,e,n){this.id=t,this.addr=n,this.cache=[],this.type=e.type,this.setValue=fb(e.type)}},$d=class{constructor(t,e,n){this.id=t,this.addr=n,this.cache=[],this.type=e.type,this.size=e.size,this.setValue=Lb(e.type)}},Kd=class{constructor(t){this.id=t,this.seq=[],this.map={}}setValue(t,e,n){let i=this.seq;for(let r=0,o=i.length;r!==o;++r){let a=i[r];a.setValue(t,e[a.id],n)}}},qd=/(\w+)(\])?(\[|\.)?/g;function Rg(s,t){s.seq.push(t),s.map[t.id]=t}function Db(s,t,e){let n=s.name,i=n.length;for(qd.lastIndex=0;;){let r=qd.exec(n),o=qd.lastIndex,a=r[1],l=r[2]==="]",c=r[3];if(l&&(a=a|0),c===void 0||c==="["&&o+2===i){Rg(e,c===void 0?new Jd(a,s,t):new $d(a,s,t));break}else{let f=e.map[a];f===void 0&&(f=new Kd(a),Rg(e,f)),e=f}}}var ho=class{constructor(t,e){this.seq=[],this.map={};let n=t.getProgramParameter(e,t.ACTIVE_UNIFORMS);for(let o=0;o<n;++o){let a=t.getActiveUniform(e,o),l=t.getUniformLocation(e,a.name);Db(a,l,this)}let i=[],r=[];for(let o of this.seq)o.type===t.SAMPLER_2D_SHADOW||o.type===t.SAMPLER_CUBE_SHADOW||o.type===t.SAMPLER_2D_ARRAY_SHADOW?i.push(o):r.push(o);i.length>0&&(this.seq=i.concat(r))}setValue(t,e,n,i){let r=this.map[e];r!==void 0&&r.setValue(t,n,i)}setOptional(t,e,n){let i=e[n];i!==void 0&&this.setValue(t,n,i)}static upload(t,e,n,i){for(let r=0,o=e.length;r!==o;++r){let a=e[r],l=n[a.id];l.needsUpdate!==!1&&a.setValue(t,l.value,i)}}static seqWithValue(t,e){let n=[];for(let i=0,r=t.length;i!==r;++i){let o=t[i];o.id in e&&n.push(o)}return n}};function Cg(s,t,e){let n=s.createShader(t);return s.shaderSource(n,e),s.compileShader(n),n}var Nb=37297,Ub=0;function Fb(s,t){let e=s.split(`
`),n=[],i=Math.max(t-6,0),r=Math.min(t+6,e.length);for(let o=i;o<r;o++){let a=o+1;n.push(`${a===t?">":" "} ${a}: ${e[o]}`)}return n.join(`
`)}var Ig=new jt;function Ob(s){re._getMatrix(Ig,re.workingColorSpace,s);let t=`mat3( ${Ig.elements.map(e=>e.toFixed(4))} )`;switch(re.getTransfer(s)){case Sr:return[t,"LinearTransferOETF"];case ue:return[t,"sRGBTransferOETF"];default:return St("WebGLProgram: Unsupported color space: ",s),[t,"LinearTransferOETF"]}}function Pg(s,t,e){let n=s.getShaderParameter(t,s.COMPILE_STATUS),r=(s.getShaderInfoLog(t)||"").trim();if(n&&r==="")return"";let o=/ERROR: 0:(\d+)/.exec(r);if(o){let a=parseInt(o[1]);return e.toUpperCase()+`

`+r+`

`+Fb(s.getShaderSource(t),a)}else return r}function Bb(s,t){let e=Ob(t);return[`vec4 ${s}( vec4 value ) {`,`	return ${e[1]}( vec4( value.rgb * ${e[0]}, value.a ) );`,"}"].join(`
`)}var zb={[uu]:"Linear",[fu]:"Reinhard",[du]:"Cineon",[pu]:"ACESFilmic",[gu]:"AgX",[xu]:"Neutral",[mu]:"Custom"};function kb(s,t){let e=zb[t];return e===void 0?(St("WebGLProgram: Unsupported toneMapping:",t),"vec3 "+s+"( vec3 color ) { return LinearToneMapping( color ); }"):"vec3 "+s+"( vec3 color ) { return "+e+"ToneMapping( color ); }"}var Cu=new P;function Gb(){re.getLuminanceCoefficients(Cu);let s=Cu.x.toFixed(4),t=Cu.y.toFixed(4),e=Cu.z.toFixed(4);return["float luminance( const in vec3 rgb ) {",`	const vec3 weights = vec3( ${s}, ${t}, ${e} );`,"	return dot( weights, rgb );","}"].join(`
`)}function Vb(s){return[s.extensionClipCullDistance?"#extension GL_ANGLE_clip_cull_distance : require":"",s.extensionMultiDraw?"#extension GL_ANGLE_multi_draw : require":""].filter(ql).join(`
`)}function Hb(s){let t=[];for(let e in s){let n=s[e];n!==!1&&t.push("#define "+e+" "+n)}return t.join(`
`)}function Wb(s,t){let e={},n=s.getProgramParameter(t,s.ACTIVE_ATTRIBUTES);for(let i=0;i<n;i++){let r=s.getActiveAttrib(t,i),o=r.name,a=1;r.type===s.FLOAT_MAT2&&(a=2),r.type===s.FLOAT_MAT3&&(a=3),r.type===s.FLOAT_MAT4&&(a=4),e[o]={type:r.type,location:s.getAttribLocation(t,o),locationSize:a}}return e}function ql(s){return s!==""}function Lg(s,t){let e=t.numSpotLightShadows+t.numSpotLightMaps-t.numSpotLightShadowsWithMaps;return s.replace(/NUM_SUN_LIGHTS/g,t.numSunLights).replace(/NUM_DIR_LIGHTS/g,t.numDirLights).replace(/NUM_SPOT_LIGHTS/g,t.numSpotLights).replace(/NUM_SPOT_LIGHT_MAPS/g,t.numSpotLightMaps).replace(/NUM_SPOT_LIGHT_COORDS/g,e).replace(/NUM_RECT_AREA_LIGHTS/g,t.numRectAreaLights).replace(/NUM_POINT_LIGHTS/g,t.numPointLights).replace(/NUM_HEMI_LIGHTS/g,t.numHemiLights).replace(/NUM_SUN_LIGHT_SHADOWS/g,t.numSunLightShadows).replace(/NUM_DIR_LIGHT_SHADOWS/g,t.numDirLightShadows).replace(/NUM_SPOT_LIGHT_SHADOWS_WITH_MAPS/g,t.numSpotLightShadowsWithMaps).replace(/NUM_SPOT_LIGHT_SHADOWS/g,t.numSpotLightShadows).replace(/NUM_POINT_LIGHT_SHADOWS/g,t.numPointLightShadows)}function Dg(s,t){return s.replace(/NUM_CLIPPING_PLANES/g,t.numClippingPlanes).replace(/UNION_CLIPPING_PLANES/g,t.numClippingPlanes-t.numClipIntersection)}var Xb=/^[ \t]*#include +<([\w\d./]+)>/gm;function Qd(s){return s.replace(Xb,Yb)}var qb=new Map;function Yb(s,t){let e=ne[t];if(e===void 0){let n=qb.get(t);if(n!==void 0)e=ne[n],St('WebGLRenderer: Shader chunk "%s" has been deprecated. Use "%s" instead.',t,n);else throw new Error("THREE.WebGLProgram: Can not resolve #include <"+t+">")}return Qd(e)}var Zb=/#pragma unroll_loop_start\s+for\s*\(\s*int\s+i\s*=\s*(\d+)\s*;\s*i\s*<\s*(\d+)\s*;\s*i\s*\+\+\s*\)\s*{([\s\S]+?)}\s+#pragma unroll_loop_end/g;function Ng(s){return s.replace(Zb,Jb)}function Jb(s,t,e,n){let i="";for(let r=parseInt(t);r<parseInt(e);r++)i+=n.replace(/\[\s*i\s*\]/g,"[ "+r+" ]").replace(/UNROLLED_LOOP_INDEX/g,r);return i}function Ug(s){let t=`precision ${s.precision} float;
	precision ${s.precision} int;
	precision ${s.precision} sampler2D;
	precision ${s.precision} samplerCube;
	precision ${s.precision} sampler3D;
	precision ${s.precision} sampler2DArray;
	precision ${s.precision} sampler2DShadow;
	precision ${s.precision} samplerCubeShadow;
	precision ${s.precision} sampler2DArrayShadow;
	precision ${s.precision} isampler2D;
	precision ${s.precision} isampler3D;
	precision ${s.precision} isamplerCube;
	precision ${s.precision} isampler2DArray;
	precision ${s.precision} usampler2D;
	precision ${s.precision} usampler3D;
	precision ${s.precision} usamplerCube;
	precision ${s.precision} usampler2DArray;
	`;return s.precision==="highp"?t+=`
#define HIGH_PRECISION`:s.precision==="mediump"?t+=`
#define MEDIUM_PRECISION`:s.precision==="lowp"&&(t+=`
#define LOW_PRECISION`),t}var $b={[$r]:"SHADOWMAP_TYPE_PCF",[Ns]:"SHADOWMAP_TYPE_VSM"};function Kb(s){return $b[s.shadowMapType]||"SHADOWMAP_TYPE_BASIC"}var Qb={[Zn]:"ENVMAP_TYPE_CUBE",[Ci]:"ENVMAP_TYPE_CUBE",[Fs]:"ENVMAP_TYPE_CUBE_UV"};function jb(s){return s.envMap===!1?"ENVMAP_TYPE_CUBE":Qb[s.envMapMode]||"ENVMAP_TYPE_CUBE"}var t1={[Ci]:"ENVMAP_MODE_REFRACTION"};function e1(s){return s.envMap===!1?"ENVMAP_MODE_REFLECTION":t1[s.envMapMode]||"ENVMAP_MODE_REFLECTION"}var n1={[Kr]:"ENVMAP_BLENDING_MULTIPLY",[ud]:"ENVMAP_BLENDING_MIX",[fd]:"ENVMAP_BLENDING_ADD"};function i1(s){return s.envMap===!1?"ENVMAP_BLENDING_NONE":n1[s.combine]||"ENVMAP_BLENDING_NONE"}function s1(s){let t=s.envMapCubeUVHeight;if(t===null)return null;let e=Math.log2(t)-2,n=1/t;return{texelWidth:1/(3*Math.max(Math.pow(2,e),7*16)),texelHeight:n,maxMip:e}}function r1(s,t,e,n){let i=s.getContext(),r=e.defines,o=e.vertexShader,a=e.fragmentShader,l=Kb(e),c=jb(e),h=e1(e),f=i1(e),u=s1(e),d=Vb(e),p=Hb(r),x=i.createProgram(),m,g,v=e.glslVersion?"#version "+e.glslVersion+`
`:"";e.isRawShaderMaterial?(m=["#define SHADER_TYPE "+e.shaderType,"#define SHADER_NAME "+e.shaderName,p].filter(ql).join(`
`),m.length>0&&(m+=`
`),g=["#define SHADER_TYPE "+e.shaderType,"#define SHADER_NAME "+e.shaderName,p].filter(ql).join(`
`),g.length>0&&(g+=`
`)):(m=[Ug(e),"#define SHADER_TYPE "+e.shaderType,"#define SHADER_NAME "+e.shaderName,p,e.extensionClipCullDistance?"#define USE_CLIP_DISTANCE":"",e.batching?"#define USE_BATCHING":"",e.batchingColor?"#define USE_BATCHING_COLOR":"",e.instancing?"#define USE_INSTANCING":"",e.instancingColor?"#define USE_INSTANCING_COLOR":"",e.instancingMorph?"#define USE_INSTANCING_MORPH":"",e.useFog&&e.fog?"#define USE_FOG":"",e.useFog&&e.fogExp2?"#define FOG_EXP2":"",e.map?"#define USE_MAP":"",e.envMap?"#define USE_ENVMAP":"",e.envMap?"#define "+h:"",e.lightMap?"#define USE_LIGHTMAP":"",e.aoMap?"#define USE_AOMAP":"",e.bumpMap?"#define USE_BUMPMAP":"",e.normalMap?"#define USE_NORMALMAP":"",e.normalMapObjectSpace?"#define USE_NORMALMAP_OBJECTSPACE":"",e.normalMapTangentSpace?"#define USE_NORMALMAP_TANGENTSPACE":"",e.displacementMap?"#define USE_DISPLACEMENTMAP":"",e.emissiveMap?"#define USE_EMISSIVEMAP":"",e.anisotropy?"#define USE_ANISOTROPY":"",e.anisotropyMap?"#define USE_ANISOTROPYMAP":"",e.clearcoatMap?"#define USE_CLEARCOATMAP":"",e.clearcoatRoughnessMap?"#define USE_CLEARCOAT_ROUGHNESSMAP":"",e.clearcoatNormalMap?"#define USE_CLEARCOAT_NORMALMAP":"",e.iridescenceMap?"#define USE_IRIDESCENCEMAP":"",e.iridescenceThicknessMap?"#define USE_IRIDESCENCE_THICKNESSMAP":"",e.specularMap?"#define USE_SPECULARMAP":"",e.specularColorMap?"#define USE_SPECULAR_COLORMAP":"",e.specularIntensityMap?"#define USE_SPECULAR_INTENSITYMAP":"",e.roughnessMap?"#define USE_ROUGHNESSMAP":"",e.metalnessMap?"#define USE_METALNESSMAP":"",e.alphaMap?"#define USE_ALPHAMAP":"",e.alphaHash?"#define USE_ALPHAHASH":"",e.transmission?"#define USE_TRANSMISSION":"",e.transmissionMap?"#define USE_TRANSMISSIONMAP":"",e.thicknessMap?"#define USE_THICKNESSMAP":"",e.sheenColorMap?"#define USE_SHEEN_COLORMAP":"",e.sheenRoughnessMap?"#define USE_SHEEN_ROUGHNESSMAP":"",e.mapUv?"#define MAP_UV "+e.mapUv:"",e.alphaMapUv?"#define ALPHAMAP_UV "+e.alphaMapUv:"",e.lightMapUv?"#define LIGHTMAP_UV "+e.lightMapUv:"",e.aoMapUv?"#define AOMAP_UV "+e.aoMapUv:"",e.emissiveMapUv?"#define EMISSIVEMAP_UV "+e.emissiveMapUv:"",e.bumpMapUv?"#define BUMPMAP_UV "+e.bumpMapUv:"",e.normalMapUv?"#define NORMALMAP_UV "+e.normalMapUv:"",e.displacementMapUv?"#define DISPLACEMENTMAP_UV "+e.displacementMapUv:"",e.metalnessMapUv?"#define METALNESSMAP_UV "+e.metalnessMapUv:"",e.roughnessMapUv?"#define ROUGHNESSMAP_UV "+e.roughnessMapUv:"",e.anisotropyMapUv?"#define ANISOTROPYMAP_UV "+e.anisotropyMapUv:"",e.clearcoatMapUv?"#define CLEARCOATMAP_UV "+e.clearcoatMapUv:"",e.clearcoatNormalMapUv?"#define CLEARCOAT_NORMALMAP_UV "+e.clearcoatNormalMapUv:"",e.clearcoatRoughnessMapUv?"#define CLEARCOAT_ROUGHNESSMAP_UV "+e.clearcoatRoughnessMapUv:"",e.iridescenceMapUv?"#define IRIDESCENCEMAP_UV "+e.iridescenceMapUv:"",e.iridescenceThicknessMapUv?"#define IRIDESCENCE_THICKNESSMAP_UV "+e.iridescenceThicknessMapUv:"",e.sheenColorMapUv?"#define SHEEN_COLORMAP_UV "+e.sheenColorMapUv:"",e.sheenRoughnessMapUv?"#define SHEEN_ROUGHNESSMAP_UV "+e.sheenRoughnessMapUv:"",e.specularMapUv?"#define SPECULARMAP_UV "+e.specularMapUv:"",e.specularColorMapUv?"#define SPECULAR_COLORMAP_UV "+e.specularColorMapUv:"",e.specularIntensityMapUv?"#define SPECULAR_INTENSITYMAP_UV "+e.specularIntensityMapUv:"",e.transmissionMapUv?"#define TRANSMISSIONMAP_UV "+e.transmissionMapUv:"",e.thicknessMapUv?"#define THICKNESSMAP_UV "+e.thicknessMapUv:"",e.vertexTangents&&e.flatShading===!1?"#define USE_TANGENT":"",e.vertexNormals?"#define HAS_NORMAL":"",e.vertexColors?"#define USE_COLOR":"",e.vertexAlphas?"#define USE_COLOR_ALPHA":"",e.vertexUv1s?"#define USE_UV1":"",e.vertexUv2s?"#define USE_UV2":"",e.vertexUv3s?"#define USE_UV3":"",e.pointsUvs?"#define USE_POINTS_UV":"",e.flatShading?"#define FLAT_SHADED":"",e.skinning?"#define USE_SKINNING":"",e.morphTargets?"#define USE_MORPHTARGETS":"",e.morphNormals&&e.flatShading===!1?"#define USE_MORPHNORMALS":"",e.morphColors?"#define USE_MORPHCOLORS":"",e.morphTargetsCount>0?"#define MORPHTARGETS_TEXTURE_STRIDE "+e.morphTextureStride:"",e.morphTargetsCount>0?"#define MORPHTARGETS_COUNT "+e.morphTargetsCount:"",e.doubleSided?"#define DOUBLE_SIDED":"",e.flipSided?"#define FLIP_SIDED":"",e.shadowMapEnabled?"#define USE_SHADOWMAP":"",e.shadowMapEnabled?"#define "+l:"",e.sizeAttenuation?"#define USE_SIZEATTENUATION":"",e.numLightProbes>0?"#define USE_LIGHT_PROBES":"",e.logarithmicDepthBuffer?"#define USE_LOGARITHMIC_DEPTH_BUFFER":"",e.reversedDepthBuffer?"#define USE_REVERSED_DEPTH_BUFFER":"","uniform mat4 modelMatrix;","uniform mat4 modelViewMatrix;","uniform mat4 projectionMatrix;","uniform mat4 viewMatrix;","uniform mat3 normalMatrix;","uniform vec3 cameraPosition;","uniform bool isOrthographic;","#ifdef USE_INSTANCING","	attribute mat4 instanceMatrix;","#endif","#ifdef USE_INSTANCING_COLOR","	attribute vec3 instanceColor;","#endif","#ifdef USE_INSTANCING_MORPH","	uniform sampler2D morphTexture;","#endif","attribute vec3 position;","attribute vec3 normal;","attribute vec2 uv;","#ifdef USE_UV1","	attribute vec2 uv1;","#endif","#ifdef USE_UV2","	attribute vec2 uv2;","#endif","#ifdef USE_UV3","	attribute vec2 uv3;","#endif","#ifdef USE_TANGENT","	attribute vec4 tangent;","#endif","#if defined( USE_COLOR_ALPHA )","	attribute vec4 color;","#elif defined( USE_COLOR )","	attribute vec3 color;","#endif","#ifdef USE_SKINNING","	attribute vec4 skinIndex;","	attribute vec4 skinWeight;","#endif",`
`].filter(ql).join(`
`),g=[Ug(e),"#define SHADER_TYPE "+e.shaderType,"#define SHADER_NAME "+e.shaderName,p,e.useFog&&e.fog?"#define USE_FOG":"",e.useFog&&e.fogExp2?"#define FOG_EXP2":"",e.alphaToCoverage?"#define ALPHA_TO_COVERAGE":"",e.map?"#define USE_MAP":"",e.matcap?"#define USE_MATCAP":"",e.envMap?"#define USE_ENVMAP":"",e.envMap?"#define "+c:"",e.envMap?"#define "+h:"",e.envMap?"#define "+f:"",u?"#define CUBEUV_TEXEL_WIDTH "+u.texelWidth:"",u?"#define CUBEUV_TEXEL_HEIGHT "+u.texelHeight:"",u?"#define CUBEUV_MAX_MIP "+u.maxMip+".0":"",e.lightMap?"#define USE_LIGHTMAP":"",e.aoMap?"#define USE_AOMAP":"",e.bumpMap?"#define USE_BUMPMAP":"",e.normalMap?"#define USE_NORMALMAP":"",e.normalMapObjectSpace?"#define USE_NORMALMAP_OBJECTSPACE":"",e.normalMapTangentSpace?"#define USE_NORMALMAP_TANGENTSPACE":"",e.packedNormalMap?"#define USE_PACKED_NORMALMAP":"",e.emissiveMap?"#define USE_EMISSIVEMAP":"",e.anisotropy?"#define USE_ANISOTROPY":"",e.anisotropyMap?"#define USE_ANISOTROPYMAP":"",e.clearcoat?"#define USE_CLEARCOAT":"",e.clearcoatMap?"#define USE_CLEARCOATMAP":"",e.clearcoatRoughnessMap?"#define USE_CLEARCOAT_ROUGHNESSMAP":"",e.clearcoatNormalMap?"#define USE_CLEARCOAT_NORMALMAP":"",e.dispersion?"#define USE_DISPERSION":"",e.retroreflection?"#define USE_RETROREFLECTION":"",e.iridescence?"#define USE_IRIDESCENCE":"",e.iridescenceMap?"#define USE_IRIDESCENCEMAP":"",e.iridescenceThicknessMap?"#define USE_IRIDESCENCE_THICKNESSMAP":"",e.specularMap?"#define USE_SPECULARMAP":"",e.specularColorMap?"#define USE_SPECULAR_COLORMAP":"",e.specularIntensityMap?"#define USE_SPECULAR_INTENSITYMAP":"",e.roughnessMap?"#define USE_ROUGHNESSMAP":"",e.metalnessMap?"#define USE_METALNESSMAP":"",e.alphaMap?"#define USE_ALPHAMAP":"",e.alphaTest?"#define USE_ALPHATEST":"",e.alphaHash?"#define USE_ALPHAHASH":"",e.sheen?"#define USE_SHEEN":"",e.sheenColorMap?"#define USE_SHEEN_COLORMAP":"",e.sheenRoughnessMap?"#define USE_SHEEN_ROUGHNESSMAP":"",e.transmission?"#define USE_TRANSMISSION":"",e.transmissionMap?"#define USE_TRANSMISSIONMAP":"",e.thicknessMap?"#define USE_THICKNESSMAP":"",e.vertexTangents&&e.flatShading===!1?"#define USE_TANGENT":"",e.vertexColors||e.instancingColor?"#define USE_COLOR":"",e.vertexAlphas||e.batchingColor?"#define USE_COLOR_ALPHA":"",e.vertexUv1s?"#define USE_UV1":"",e.vertexUv2s?"#define USE_UV2":"",e.vertexUv3s?"#define USE_UV3":"",e.pointsUvs?"#define USE_POINTS_UV":"",e.gradientMap?"#define USE_GRADIENTMAP":"",e.flatShading?"#define FLAT_SHADED":"",e.doubleSided?"#define DOUBLE_SIDED":"",e.flipSided?"#define FLIP_SIDED":"",e.shadowMapEnabled?"#define USE_SHADOWMAP":"",e.shadowMapEnabled?"#define "+l:"",e.premultipliedAlpha?"#define PREMULTIPLIED_ALPHA":"",e.numLightProbes>0?"#define USE_LIGHT_PROBES":"",e.numLightProbeGrids>0?"#define USE_LIGHT_PROBES_GRID":"",e.decodeVideoTexture?"#define DECODE_VIDEO_TEXTURE":"",e.decodeVideoTextureEmissive?"#define DECODE_VIDEO_TEXTURE_EMISSIVE":"",e.logarithmicDepthBuffer?"#define USE_LOGARITHMIC_DEPTH_BUFFER":"",e.reversedDepthBuffer?"#define USE_REVERSED_DEPTH_BUFFER":"","uniform mat4 viewMatrix;","uniform vec3 cameraPosition;","uniform bool isOrthographic;",e.toneMapping!==Dn?"#define TONE_MAPPING":"",e.toneMapping!==Dn?ne.tonemapping_pars_fragment:"",e.toneMapping!==Dn?kb("toneMapping",e.toneMapping):"",e.dithering?"#define DITHERING":"",e.opaque?"#define OPAQUE":"",ne.colorspace_pars_fragment,Bb("linearToOutputTexel",e.outputColorSpace),Gb(),e.useDepthPacking?"#define DEPTH_PACKING "+e.depthPacking:"",`
`].filter(ql).join(`
`)),o=Qd(o),o=Lg(o,e),o=Dg(o,e),a=Qd(a),a=Lg(a,e),a=Dg(a,e),o=Ng(o),a=Ng(a),e.isRawShaderMaterial!==!0&&(v=`#version 300 es
`,m=[d,"#define attribute in","#define varying out","#define texture2D texture"].join(`
`)+`
`+m,g=["#define varying in",e.glslVersion===wu?"":"layout(location = 0) out highp vec4 pc_fragColor;",e.glslVersion===wu?"":"#define gl_FragColor pc_fragColor","#define gl_FragDepthEXT gl_FragDepth","#define texture2D texture","#define textureCube texture","#define texture2DProj textureProj","#define texture2DLodEXT textureLod","#define texture2DProjLodEXT textureProjLod","#define textureCubeLodEXT textureLod","#define texture2DGradEXT textureGrad","#define texture2DProjGradEXT textureProjGrad","#define textureCubeGradEXT textureGrad"].join(`
`)+`
`+g);let b=v+m+o,y=v+g+a,M=Cg(i,i.VERTEX_SHADER,b),S=Cg(i,i.FRAGMENT_SHADER,y);i.attachShader(x,M),i.attachShader(x,S),e.index0AttributeName!==void 0?i.bindAttribLocation(x,0,e.index0AttributeName):e.hasPositionAttribute===!0&&i.bindAttribLocation(x,0,"position"),i.linkProgram(x);function w(L){if(s.debug.checkShaderErrors){let D=i.getProgramInfoLog(x)||"",F=i.getShaderInfoLog(M)||"",C=i.getShaderInfoLog(S)||"",N=D.trim(),z=F.trim(),O=C.trim(),H=!0,U=!0;if(i.getProgramParameter(x,i.LINK_STATUS)===!1)if(H=!1,typeof s.debug.onShaderError=="function")s.debug.onShaderError(i,x,M,S);else{let W=Pg(i,M,"vertex"),Z=Pg(i,S,"fragment");Bt("WebGLProgram: Shader Error "+i.getError()+" - VALIDATE_STATUS "+i.getProgramParameter(x,i.VALIDATE_STATUS)+`

Material Name: `+L.name+`
Material Type: `+L.type+`

Program Info Log: `+N+`
`+W+`
`+Z)}else N!==""?St("WebGLProgram: Program Info Log:",N):(z===""||O==="")&&(U=!1);U&&(L.diagnostics={runnable:H,programLog:N,vertexShader:{log:z,prefix:m},fragmentShader:{log:O,prefix:g}})}i.deleteShader(M),i.deleteShader(S),_=new ho(i,x),T=Wb(i,x)}let _;this.getUniforms=function(){return _===void 0&&w(this),_};let T;this.getAttributes=function(){return T===void 0&&w(this),T};let R=e.rendererExtensionParallelShaderCompile===!1;return this.isReady=function(){return R===!1&&(R=i.getProgramParameter(x,Nb)),R},this.destroy=function(){n.releaseStatesOfProgram(this),i.deleteProgram(x),this.program=void 0},this.type=e.shaderType,this.name=e.shaderName,this.id=Ub++,this.cacheKey=t,this.usedTimes=1,this.program=x,this.vertexShader=M,this.fragmentShader=S,this}var o1=0,jd=class{constructor(){this.shaderCache=new Map,this.materialCache=new Map}update(t,e,n){let i=this._getShaderCacheForMaterial(t);return i.has(e)===!1&&(i.add(e),e.usedTimes++),i.has(n)===!1&&(i.add(n),n.usedTimes++),this}remove(t){let e=this.materialCache.get(t);for(let n of e)n.usedTimes--,n.usedTimes===0&&this.shaderCache.delete(n.code);return this.materialCache.delete(t),this}getVertexShaderStage(t){return this._getShaderStage(t.vertexShader)}getFragmentShaderStage(t){return this._getShaderStage(t.fragmentShader)}dispose(){this.shaderCache.clear(),this.materialCache.clear()}_getShaderCacheForMaterial(t){let e=this.materialCache,n=e.get(t);return n===void 0&&(n=new Set,e.set(t,n)),n}_getShaderStage(t){let e=this.shaderCache,n=e.get(t);return n===void 0&&(n=new tp(t),e.set(t,n)),n}},tp=class{constructor(t){this.id=o1++,this.code=t,this.usedTimes=0}};function a1(s){return s===Pi||s===oo||s===ao}function l1(s,t,e,n,i,r){let o=new bs,a=new jd,l=new Set,c=[],h=new Map,f=n.logarithmicDepthBuffer,u=n.precision,d={MeshDepthMaterial:"depth",MeshDistanceMaterial:"distance",MeshNormalMaterial:"normal",MeshBasicMaterial:"basic",MeshLambertMaterial:"lambert",MeshPhongMaterial:"phong",MeshToonMaterial:"toon",MeshStandardMaterial:"physical",MeshPhysicalMaterial:"physical",MeshMatcapMaterial:"matcap",LineBasicMaterial:"basic",LineDashedMaterial:"dashed",PointsMaterial:"points",ShadowMaterial:"shadow",SpriteMaterial:"sprite"};function p(_){return l.add(_),_===0?"uv":`uv${_}`}function x(_,T,R,L,D,F){let C=L.fog,N=D.geometry,z=_.isMeshStandardMaterial||_.isMeshLambertMaterial||_.isMeshPhongMaterial?L.environment:null,O=_.isMeshStandardMaterial||_.isMeshLambertMaterial&&!_.envMap||_.isMeshPhongMaterial&&!_.envMap,H=t.get(_.envMap||z,O),U=H&&H.mapping===Fs?H.image.height:null,W=d[_.type];_.precision!==null&&(u=n.getMaxPrecision(_.precision),u!==_.precision&&St("WebGLProgram.getParameters:",_.precision,"not supported, using",u,"instead."));let Z=N.morphAttributes.position||N.morphAttributes.normal||N.morphAttributes.color,j=Z!==void 0?Z.length:0,q=0;N.morphAttributes.position!==void 0&&(q=1),N.morphAttributes.normal!==void 0&&(q=2),N.morphAttributes.color!==void 0&&(q=3);let it,ft,ht,G;if(W){let ve=Jn[W];it=ve.vertexShader,ft=ve.fragmentShader}else{it=_.vertexShader,ft=_.fragmentShader;let ve=a.getVertexShaderStage(_),de=a.getFragmentShaderStage(_);a.update(_,ve,de),ht=ve.id,G=de.id}let Q=s.getRenderTarget(),lt=s.state.buffers.depth.getReversed(),yt=D.isInstancedMesh===!0,dt=D.isBatchedMesh===!0,xt=!!_.map,Vt=!!_.matcap,nt=!!H,ct=!!_.aoMap,mt=!!_.lightMap,gt=!!_.bumpMap&&_.wireframe===!1,vt=!!_.normalMap,zt=!!_.displacementMap,Ft=!!_.emissiveMap,Wt=!!_.metalnessMap,Yt=!!_.roughnessMap,B=_.anisotropy>0,se=_.clearcoat>0,Kt=_.dispersion>0,I=_.retroreflectivity>0,E=_.iridescence>0,Y=_.sheen>0,k=_.transmission>0,J=B&&!!_.anisotropyMap,at=se&&!!_.clearcoatMap,pt=se&&!!_.clearcoatNormalMap,tt=se&&!!_.clearcoatRoughnessMap,st=E&&!!_.iridescenceMap,Mt=E&&!!_.iridescenceThicknessMap,kt=Y&&!!_.sheenColorMap,bt=Y&&!!_.sheenRoughnessMap,Et=!!_.specularMap,Ht=!!_.specularColorMap,Zt=!!_.specularIntensityMap,te=k&&!!_.transmissionMap,X=k&&!!_.thicknessMap,Tt=!!_.gradientMap,ot=!!_.alphaMap,wt=_.alphaTest>0,Pt=!!_.alphaHash,ut=!!_.extensions,Xt=Dn;_.toneMapped&&(Q===null||Q.isXRRenderTarget===!0)&&(Xt=s.toneMapping);let Ot={shaderID:W,shaderType:_.type,shaderName:_.name,vertexShader:it,fragmentShader:ft,defines:_.defines,customVertexShaderID:ht,customFragmentShaderID:G,isRawShaderMaterial:_.isRawShaderMaterial===!0,glslVersion:_.glslVersion,precision:u,batching:dt,batchingColor:dt&&D._colorsTexture!==null,instancing:yt,instancingColor:yt&&D.instanceColor!==null,instancingMorph:yt&&D.morphTexture!==null,outputColorSpace:Q===null?s.outputColorSpace:Q.isXRRenderTarget===!0?Q.texture.colorSpace:re.workingColorSpace,alphaToCoverage:!!_.alphaToCoverage,map:xt,matcap:Vt,envMap:nt,envMapMode:nt&&H.mapping,envMapCubeUVHeight:U,aoMap:ct,lightMap:mt,bumpMap:gt,normalMap:vt,displacementMap:zt,emissiveMap:Ft,normalMapObjectSpace:vt&&_.normalMapType===Md,normalMapTangentSpace:vt&&_.normalMapType===oi,packedNormalMap:vt&&_.normalMapType===oi&&a1(_.normalMap.format),metalnessMap:Wt,roughnessMap:Yt,anisotropy:B,anisotropyMap:J,clearcoat:se,clearcoatMap:at,clearcoatNormalMap:pt,clearcoatRoughnessMap:tt,dispersion:Kt,retroreflection:I,iridescence:E,iridescenceMap:st,iridescenceThicknessMap:Mt,sheen:Y,sheenColorMap:kt,sheenRoughnessMap:bt,specularMap:Et,specularColorMap:Ht,specularIntensityMap:Zt,transmission:k,transmissionMap:te,thicknessMap:X,gradientMap:Tt,opaque:_.transparent===!1&&_.blending===Us&&_.alphaToCoverage===!1,alphaMap:ot,alphaTest:wt,alphaHash:Pt,combine:_.combine,mapUv:xt&&p(_.map.channel),aoMapUv:ct&&p(_.aoMap.channel),lightMapUv:mt&&p(_.lightMap.channel),bumpMapUv:gt&&p(_.bumpMap.channel),normalMapUv:vt&&p(_.normalMap.channel),displacementMapUv:zt&&p(_.displacementMap.channel),emissiveMapUv:Ft&&p(_.emissiveMap.channel),metalnessMapUv:Wt&&p(_.metalnessMap.channel),roughnessMapUv:Yt&&p(_.roughnessMap.channel),anisotropyMapUv:J&&p(_.anisotropyMap.channel),clearcoatMapUv:at&&p(_.clearcoatMap.channel),clearcoatNormalMapUv:pt&&p(_.clearcoatNormalMap.channel),clearcoatRoughnessMapUv:tt&&p(_.clearcoatRoughnessMap.channel),iridescenceMapUv:st&&p(_.iridescenceMap.channel),iridescenceThicknessMapUv:Mt&&p(_.iridescenceThicknessMap.channel),sheenColorMapUv:kt&&p(_.sheenColorMap.channel),sheenRoughnessMapUv:bt&&p(_.sheenRoughnessMap.channel),specularMapUv:Et&&p(_.specularMap.channel),specularColorMapUv:Ht&&p(_.specularColorMap.channel),specularIntensityMapUv:Zt&&p(_.specularIntensityMap.channel),transmissionMapUv:te&&p(_.transmissionMap.channel),thicknessMapUv:X&&p(_.thicknessMap.channel),alphaMapUv:ot&&p(_.alphaMap.channel),vertexTangents:!!N.attributes.tangent&&(vt||B),vertexNormals:!!N.attributes.normal,vertexColors:_.vertexColors,vertexAlphas:_.vertexColors===!0&&!!N.attributes.color&&N.attributes.color.itemSize===4,pointsUvs:D.isPoints===!0&&!!N.attributes.uv&&(xt||ot),fog:!!C,useFog:_.fog===!0,fogExp2:!!C&&C.isFogExp2,flatShading:_.wireframe===!1&&(_.flatShading===!0||N.attributes.normal===void 0&&vt===!1&&(_.isMeshLambertMaterial||_.isMeshPhongMaterial||_.isMeshStandardMaterial||_.isMeshPhysicalMaterial)),sizeAttenuation:_.sizeAttenuation===!0,logarithmicDepthBuffer:f,reversedDepthBuffer:lt,skinning:D.isSkinnedMesh===!0,hasPositionAttribute:N.attributes.position!==void 0,morphTargets:N.morphAttributes.position!==void 0,morphNormals:N.morphAttributes.normal!==void 0,morphColors:N.morphAttributes.color!==void 0,morphTargetsCount:j,morphTextureStride:q,numSunLights:T.sun.length,numDirLights:T.directional.length,numPointLights:T.point.length,numSpotLights:T.spot.length,numSpotLightMaps:T.spotLightMap.length,numRectAreaLights:T.rectArea.length,numHemiLights:T.hemi.length,numSunLightShadows:T.sunShadowMap.length,numDirLightShadows:T.directionalShadowMap.length,numPointLightShadows:T.pointShadowMap.length,numSpotLightShadows:T.spotShadowMap.length,numSpotLightShadowsWithMaps:T.numSpotLightShadowsWithMaps,numLightProbes:T.numLightProbes,numLightProbeGrids:F.length,numClippingPlanes:r.numPlanes,numClipIntersection:r.numIntersection,dithering:_.dithering,shadowMapEnabled:s.shadowMap.enabled&&R.length>0,shadowMapType:s.shadowMap.type,toneMapping:Xt,decodeVideoTexture:xt&&_.map.isVideoTexture===!0&&re.getTransfer(_.map.colorSpace)===ue,decodeVideoTextureEmissive:Ft&&_.emissiveMap.isVideoTexture===!0&&re.getTransfer(_.emissiveMap.colorSpace)===ue,premultipliedAlpha:_.premultipliedAlpha,doubleSided:_.side===Ne,flipSided:_.side===rn,useDepthPacking:_.depthPacking>=0,depthPacking:_.depthPacking||0,index0AttributeName:_.index0AttributeName,extensionClipCullDistance:ut&&_.extensions.clipCullDistance===!0&&e.has("WEBGL_clip_cull_distance"),extensionMultiDraw:(ut&&_.extensions.multiDraw===!0||dt)&&e.has("WEBGL_multi_draw"),rendererExtensionParallelShaderCompile:e.has("KHR_parallel_shader_compile"),customProgramCacheKey:_.customProgramCacheKey()};return Ot.vertexUv1s=l.has(1),Ot.vertexUv2s=l.has(2),Ot.vertexUv3s=l.has(3),l.clear(),Ot}function m(_){let T=[];if(_.shaderID?T.push(_.shaderID):(T.push(_.customVertexShaderID),T.push(_.customFragmentShaderID)),_.defines!==void 0)for(let R in _.defines)T.push(R),T.push(_.defines[R]);return _.isRawShaderMaterial===!1&&(g(T,_),v(T,_),T.push(s.outputColorSpace)),T.push(_.customProgramCacheKey),T.join()}function g(_,T){_.push(T.precision),_.push(T.outputColorSpace),_.push(T.envMapMode),_.push(T.envMapCubeUVHeight),_.push(T.mapUv),_.push(T.alphaMapUv),_.push(T.lightMapUv),_.push(T.aoMapUv),_.push(T.bumpMapUv),_.push(T.normalMapUv),_.push(T.displacementMapUv),_.push(T.emissiveMapUv),_.push(T.metalnessMapUv),_.push(T.roughnessMapUv),_.push(T.anisotropyMapUv),_.push(T.clearcoatMapUv),_.push(T.clearcoatNormalMapUv),_.push(T.clearcoatRoughnessMapUv),_.push(T.iridescenceMapUv),_.push(T.iridescenceThicknessMapUv),_.push(T.sheenColorMapUv),_.push(T.sheenRoughnessMapUv),_.push(T.specularMapUv),_.push(T.specularColorMapUv),_.push(T.specularIntensityMapUv),_.push(T.transmissionMapUv),_.push(T.thicknessMapUv),_.push(T.combine),_.push(T.fogExp2),_.push(T.sizeAttenuation),_.push(T.morphTargetsCount),_.push(T.morphAttributeCount),_.push(T.numSunLights),_.push(T.numDirLights),_.push(T.numPointLights),_.push(T.numSpotLights),_.push(T.numSpotLightMaps),_.push(T.numHemiLights),_.push(T.numRectAreaLights),_.push(T.numSunLightShadows),_.push(T.numDirLightShadows),_.push(T.numPointLightShadows),_.push(T.numSpotLightShadows),_.push(T.numSpotLightShadowsWithMaps),_.push(T.numLightProbes),_.push(T.shadowMapType),_.push(T.toneMapping),_.push(T.numClippingPlanes),_.push(T.numClipIntersection),_.push(T.depthPacking)}function v(_,T){o.disableAll(),T.instancing&&o.enable(0),T.instancingColor&&o.enable(1),T.instancingMorph&&o.enable(2),T.matcap&&o.enable(3),T.envMap&&o.enable(4),T.normalMapObjectSpace&&o.enable(5),T.normalMapTangentSpace&&o.enable(6),T.clearcoat&&o.enable(7),T.iridescence&&o.enable(8),T.alphaTest&&o.enable(9),T.vertexColors&&o.enable(10),T.vertexAlphas&&o.enable(11),T.vertexUv1s&&o.enable(12),T.vertexUv2s&&o.enable(13),T.vertexUv3s&&o.enable(14),T.vertexTangents&&o.enable(15),T.anisotropy&&o.enable(16),T.alphaHash&&o.enable(17),T.batching&&o.enable(18),T.dispersion&&o.enable(19),T.retroreflection&&o.enable(24),T.batchingColor&&o.enable(20),T.gradientMap&&o.enable(21),T.packedNormalMap&&o.enable(22),T.vertexNormals&&o.enable(23),_.push(o.mask),o.disableAll(),T.fog&&o.enable(0),T.useFog&&o.enable(1),T.flatShading&&o.enable(2),T.logarithmicDepthBuffer&&o.enable(3),T.reversedDepthBuffer&&o.enable(4),T.skinning&&o.enable(5),T.morphTargets&&o.enable(6),T.morphNormals&&o.enable(7),T.morphColors&&o.enable(8),T.premultipliedAlpha&&o.enable(9),T.shadowMapEnabled&&o.enable(10),T.doubleSided&&o.enable(11),T.flipSided&&o.enable(12),T.useDepthPacking&&o.enable(13),T.dithering&&o.enable(14),T.transmission&&o.enable(15),T.sheen&&o.enable(16),T.opaque&&o.enable(17),T.pointsUvs&&o.enable(18),T.decodeVideoTexture&&o.enable(19),T.decodeVideoTextureEmissive&&o.enable(20),T.alphaToCoverage&&o.enable(21),T.numLightProbeGrids>0&&o.enable(22),T.hasPositionAttribute&&o.enable(23),_.push(o.mask)}function b(_){let T=d[_.type],R;if(T){let L=Jn[T];R=Dd.clone(L.uniforms)}else R=_.uniforms;return R}function y(_,T){let R=h.get(T);return R!==void 0?++R.usedTimes:(R=new r1(s,T,_,i),c.push(R),h.set(T,R)),R}function M(_){if(--_.usedTimes===0){let T=c.indexOf(_);c[T]=c[c.length-1],c.pop(),h.delete(_.cacheKey),_.destroy()}}function S(_){a.remove(_)}function w(){a.dispose()}return{getParameters:x,getProgramCacheKey:m,getUniforms:b,acquireProgram:y,releaseProgram:M,releaseShaderCache:S,programs:c,dispose:w}}function c1(){let s=new WeakMap;function t(o){return s.has(o)}function e(o){let a=s.get(o);return a===void 0&&(a={},s.set(o,a)),a}function n(o){s.delete(o)}function i(o,a,l){s.get(o)[a]=l}function r(){s=new WeakMap}return{has:t,get:e,remove:n,update:i,dispose:r}}function h1(s,t){return s.groupOrder!==t.groupOrder?s.groupOrder-t.groupOrder:s.renderOrder!==t.renderOrder?s.renderOrder-t.renderOrder:s.material.id!==t.material.id?s.material.id-t.material.id:s.materialVariant!==t.materialVariant?s.materialVariant-t.materialVariant:s.z!==t.z?s.z-t.z:s.id-t.id}function Fg(s,t){return s.groupOrder!==t.groupOrder?s.groupOrder-t.groupOrder:s.renderOrder!==t.renderOrder?s.renderOrder-t.renderOrder:s.z!==t.z?t.z-s.z:s.id-t.id}function Og(){let s=[],t=0,e=[],n=[],i=[];function r(){t=0,e.length=0,n.length=0,i.length=0}function o(u){let d=0;return u.isInstancedMesh&&(d+=2),u.isSkinnedMesh&&(d+=1),d}function a(u,d,p,x,m,g){let v=s[t];return v===void 0?(v={id:u.id,object:u,geometry:d,material:p,materialVariant:o(u),groupOrder:x,renderOrder:u.renderOrder,z:m,group:g},s[t]=v):(v.id=u.id,v.object=u,v.geometry=d,v.material=p,v.materialVariant=o(u),v.groupOrder=x,v.renderOrder=u.renderOrder,v.z=m,v.group=g),t++,v}function l(u,d,p,x,m,g,v){v.reversedDepth===!0&&(m=-m);let b=a(u,d,p,x,m,g);p.transmission>0?n.push(b):p.transparent===!0?i.push(b):e.push(b)}function c(u,d,p,x,m,g){let v=a(u,d,p,x,m,g);p.transmission>0?n.unshift(v):p.transparent===!0?i.unshift(v):e.unshift(v)}function h(u,d){e.length>1&&e.sort(u||h1),n.length>1&&n.sort(d||Fg),i.length>1&&i.sort(d||Fg)}function f(){for(let u=t,d=s.length;u<d;u++){let p=s[u];if(p.id===null)break;p.id=null,p.object=null,p.geometry=null,p.material=null,p.group=null}}return{opaque:e,transmissive:n,transparent:i,init:r,push:l,unshift:c,finish:f,sort:h}}function u1(){let s=new WeakMap;function t(n,i){let r=s.get(n),o;return r===void 0?(o=new Og,s.set(n,[o])):i>=r.length?(o=new Og,r.push(o)):o=r[i],o}function e(){s=new WeakMap}return{get:t,dispose:e}}function f1(){let s={};return{get:function(t){if(s[t.id]!==void 0)return s[t.id];let e;switch(t.type){case"SunLight":case"DirectionalLight":e={direction:new P,color:new _t};break;case"SpotLight":e={position:new P,direction:new P,color:new _t,distance:0,coneCos:0,penumbraCos:0,decay:0};break;case"PointLight":e={position:new P,color:new _t,distance:0,decay:0};break;case"HemisphereLight":e={direction:new P,skyColor:new _t,groundColor:new _t};break;case"RectAreaLight":e={color:new _t,position:new P,halfWidth:new P,halfHeight:new P};break}return s[t.id]=e,e}}}function d1(){let s={};return{get:function(t){if(s[t.id]!==void 0)return s[t.id];let e;switch(t.type){case"SunLight":case"DirectionalLight":e={shadowIntensity:1,shadowBias:0,shadowNormalBias:0,shadowRadius:1,shadowMapSize:new rt};break;case"SpotLight":e={shadowIntensity:1,shadowBias:0,shadowNormalBias:0,shadowRadius:1,shadowMapSize:new rt};break;case"PointLight":e={shadowIntensity:1,shadowBias:0,shadowNormalBias:0,shadowRadius:1,shadowMapSize:new rt,shadowCameraNear:1,shadowCameraFar:1e3};break}return s[t.id]=e,e}}}var p1=0;function m1(s,t){return(t.castShadow?2:0)-(s.castShadow?2:0)+(t.map?1:0)-(s.map?1:0)}function g1(s){let t=new f1,e=d1(),n={version:0,hash:{sunLength:-1,directionalLength:-1,pointLength:-1,spotLength:-1,rectAreaLength:-1,hemiLength:-1,numSunShadows:-1,numDirectionalShadows:-1,numPointShadows:-1,numSpotShadows:-1,numSpotMaps:-1,numLightProbes:-1},ambient:[0,0,0],probe:[],sun:[],sunShadow:[],sunShadowMap:[],sunShadowMatrix:[],sunShadowCascade:[],directional:[],directionalShadow:[],directionalShadowMap:[],directionalShadowMatrix:[],spot:[],spotLightMap:[],spotShadow:[],spotShadowMap:[],spotLightMatrix:[],rectArea:[],rectAreaLTC1:null,rectAreaLTC2:null,point:[],pointShadow:[],pointShadowMap:[],pointShadowMatrix:[],hemi:[],numSpotLightShadowsWithMaps:0,numLightProbes:0};for(let c=0;c<9;c++)n.probe.push(new P);let i=new P,r=new Jt,o=new Jt;function a(c){let h=0,f=0,u=0;for(let D=0;D<9;D++)n.probe[D].set(0,0,0);let d=0,p=0,x=0,m=0,g=0,v=0,b=0,y=0,M=0,S=0,w=0,_=0,T=0,R=0;c.sort(m1);for(let D=0,F=c.length;D<F;D++){let C=c[D],N=C.color,z=C.intensity,O=C.distance,H=null;if(C.shadow&&C.shadow.map&&(C.shadow.map.texture.format===Pi?H=C.shadow.map.texture:H=C.shadow.map.depthTexture||C.shadow.map.texture),C.isAmbientLight)h+=N.r*z,f+=N.g*z,u+=N.b*z;else if(C.isLightProbe){for(let U=0;U<9;U++)n.probe[U].addScaledVector(C.sh.coefficients[U],z);R++}else if(C.isSunLight){let U=t.get(C);if(U.color.copy(C.color).multiplyScalar(C.intensity),C.castShadow){let W=C.shadow,Z=e.get(C);Z.shadowIntensity=W.intensity,Z.shadowBias=W.bias,Z.shadowNormalBias=W.normalBias,Z.shadowRadius=W.radius,Z.shadowMapSize.copy(W.mapSize).multiply(W.getFrameExtents()),n.sunShadow[p]=Z,n.sunShadowMap[p]=H;let j=W.getViewportCount();for(let q=0;q<j;q++)n.sunShadowMatrix[x+q]=W.getMatrix(q),n.sunShadowCascade[x+q]=W._cascadeData[q];x+=j,p++}n.sun[d]=U,d++}else if(C.isDirectionalLight){let U=t.get(C);if(U.color.copy(C.color).multiplyScalar(C.intensity),C.castShadow){let W=C.shadow,Z=e.get(C);Z.shadowIntensity=W.intensity,Z.shadowBias=W.bias,Z.shadowNormalBias=W.normalBias,Z.shadowRadius=W.radius,Z.shadowMapSize=W.mapSize,n.directionalShadow[m]=Z,n.directionalShadowMap[m]=H,n.directionalShadowMatrix[m]=C.shadow.matrix,M++}n.directional[m]=U,m++}else if(C.isSpotLight){let U=t.get(C);U.position.setFromMatrixPosition(C.matrixWorld),U.color.copy(N).multiplyScalar(z),U.distance=O,U.coneCos=Math.cos(C.angle),U.penumbraCos=Math.cos(C.angle*(1-C.penumbra)),U.decay=C.decay,n.spot[v]=U;let W=C.shadow;if(C.map&&(n.spotLightMap[_]=C.map,_++,W.updateMatrices(C),C.castShadow&&T++),n.spotLightMatrix[v]=W.matrix,C.castShadow){let Z=e.get(C);Z.shadowIntensity=W.intensity,Z.shadowBias=W.bias,Z.shadowNormalBias=W.normalBias,Z.shadowRadius=W.radius,Z.shadowMapSize=W.mapSize,n.spotShadow[v]=Z,n.spotShadowMap[v]=H,w++}v++}else if(C.isRectAreaLight){let U=t.get(C);U.color.copy(N).multiplyScalar(z),U.halfWidth.set(C.width*.5,0,0),U.halfHeight.set(0,C.height*.5,0),n.rectArea[b]=U,b++}else if(C.isPointLight){let U=t.get(C);if(U.color.copy(C.color).multiplyScalar(C.intensity),U.distance=C.distance,U.decay=C.decay,C.castShadow){let W=C.shadow,Z=e.get(C);Z.shadowIntensity=W.intensity,Z.shadowBias=W.bias,Z.shadowNormalBias=W.normalBias,Z.shadowRadius=W.radius,Z.shadowMapSize=W.mapSize,Z.shadowCameraNear=W.camera.near,Z.shadowCameraFar=W.camera.far,n.pointShadow[g]=Z,n.pointShadowMap[g]=H,n.pointShadowMatrix[g]=C.shadow.matrix,S++}n.point[g]=U,g++}else if(C.isHemisphereLight){let U=t.get(C);U.skyColor.copy(C.color).multiplyScalar(z),U.groundColor.copy(C.groundColor).multiplyScalar(z),n.hemi[y]=U,y++}}b>0&&(s.has("OES_texture_float_linear")===!0?(n.rectAreaLTC1=Rt.LTC_FLOAT_1,n.rectAreaLTC2=Rt.LTC_FLOAT_2):(n.rectAreaLTC1=Rt.LTC_HALF_1,n.rectAreaLTC2=Rt.LTC_HALF_2)),n.ambient[0]=h,n.ambient[1]=f,n.ambient[2]=u;let L=n.hash;(L.sunLength!==d||L.directionalLength!==m||L.pointLength!==g||L.spotLength!==v||L.rectAreaLength!==b||L.hemiLength!==y||L.numSunShadows!==p||L.numDirectionalShadows!==M||L.numPointShadows!==S||L.numSpotShadows!==w||L.numSpotMaps!==_||L.numLightProbes!==R)&&(n.sun.length=d,n.directional.length=m,n.spot.length=v,n.rectArea.length=b,n.point.length=g,n.hemi.length=y,n.sunShadow.length=p,n.sunShadowMap.length=p,n.sunShadowMatrix.length=x,n.sunShadowCascade.length=x,n.directionalShadow.length=M,n.directionalShadowMap.length=M,n.directionalShadowMatrix.length=M,n.pointShadow.length=S,n.pointShadowMap.length=S,n.pointShadowMatrix.length=S,n.spotShadow.length=w,n.spotShadowMap.length=w,n.spotLightMatrix.length=w+_-T,n.spotLightMap.length=_,n.numSpotLightShadowsWithMaps=T,n.numLightProbes=R,L.sunLength=d,L.directionalLength=m,L.pointLength=g,L.spotLength=v,L.rectAreaLength=b,L.hemiLength=y,L.numSunShadows=p,L.numDirectionalShadows=M,L.numPointShadows=S,L.numSpotShadows=w,L.numSpotMaps=_,L.numLightProbes=R,n.version=p1++)}function l(c,h){let f=0,u=0,d=0,p=0,x=0,m=0,g=h.matrixWorldInverse;for(let v=0,b=c.length;v<b;v++){let y=c[v];if(y.isSunLight){let M=n.sun[f];M.direction.setFromMatrixPosition(y.matrixWorld),M.direction.transformDirection(g),f++}else if(y.isDirectionalLight){let M=n.directional[u];M.direction.setFromMatrixPosition(y.matrixWorld),i.setFromMatrixPosition(y.target.matrixWorld),M.direction.sub(i),M.direction.transformDirection(g),u++}else if(y.isSpotLight){let M=n.spot[p];M.position.setFromMatrixPosition(y.matrixWorld),M.position.applyMatrix4(g),M.direction.setFromMatrixPosition(y.matrixWorld),i.setFromMatrixPosition(y.target.matrixWorld),M.direction.sub(i),M.direction.transformDirection(g),p++}else if(y.isRectAreaLight){let M=n.rectArea[x];M.position.setFromMatrixPosition(y.matrixWorld),M.position.applyMatrix4(g),o.identity(),r.copy(y.matrixWorld),r.premultiply(g),o.extractRotation(r),M.halfWidth.set(y.width*.5,0,0),M.halfHeight.set(0,y.height*.5,0),M.halfWidth.applyMatrix4(o),M.halfHeight.applyMatrix4(o),x++}else if(y.isPointLight){let M=n.point[d];M.position.setFromMatrixPosition(y.matrixWorld),M.position.applyMatrix4(g),d++}else if(y.isHemisphereLight){let M=n.hemi[m];M.direction.setFromMatrixPosition(y.matrixWorld),M.direction.transformDirection(g),m++}}}return{setup:a,setupView:l,state:n}}function Bg(s){let t=new g1(s),e=[],n=[],i=[];function r(u){f.camera=u,e.length=0,n.length=0,i.length=0}function o(u){e.push(u)}function a(u){n.push(u)}function l(u){i.push(u)}function c(){t.setup(e)}function h(u){t.setupView(e,u)}let f={lightsArray:e,shadowsArray:n,lightProbeGridArray:i,camera:null,lights:t,transmissionRenderTarget:{},textureUnits:0};return{init:r,state:f,setupLights:c,setupLightsView:h,pushLight:o,pushShadow:a,pushLightProbeGrid:l}}function x1(s){let t=new WeakMap;function e(i,r=0){let o=t.get(i),a;return o===void 0?(a=new Bg(s),t.set(i,[a])):r>=o.length?(a=new Bg(s),o.push(a)):a=o[r],a}function n(){t=new WeakMap}return{get:e,dispose:n}}var _1=`void main() {
	gl_Position = vec4( position, 1.0 );
}`,y1=`uniform sampler2D shadow_pass;
uniform vec2 resolution;
uniform float radius;
void main() {
	const float samples = float( VSM_SAMPLES );
	float mean = 0.0;
	float squared_mean = 0.0;
	float uvStride = samples <= 1.0 ? 0.0 : 2.0 / ( samples - 1.0 );
	float uvStart = samples <= 1.0 ? 0.0 : - 1.0;
	for ( float i = 0.0; i < samples; i ++ ) {
		float uvOffset = uvStart + i * uvStride;
		#ifdef HORIZONTAL_PASS
			vec2 distribution = texture2D( shadow_pass, ( gl_FragCoord.xy + vec2( uvOffset, 0.0 ) * radius ) / resolution ).rg;
			mean += distribution.x;
			squared_mean += distribution.y * distribution.y + distribution.x * distribution.x;
		#else
			float depth = texture2D( shadow_pass, ( gl_FragCoord.xy + vec2( 0.0, uvOffset ) * radius ) / resolution ).r;
			mean += depth;
			squared_mean += depth * depth;
		#endif
	}
	mean = mean / samples;
	squared_mean = squared_mean / samples;
	float std_dev = sqrt( max( 0.0, squared_mean - mean * mean ) );
	gl_FragColor = vec4( mean, std_dev, 0.0, 1.0 );
}`,v1=[new P(1,0,0),new P(-1,0,0),new P(0,1,0),new P(0,-1,0),new P(0,0,1),new P(0,0,-1)],M1=[new P(0,-1,0),new P(0,-1,0),new P(0,0,1),new P(0,0,-1),new P(0,-1,0),new P(0,-1,0)],zg=new Jt,Xl=new P,Yd=new P;function S1(s,t,e){let n=new ni,i=new rt,r=new rt,o=new ge,a=new Gr,l=new Vr,c={},h=e.maxTextureSize,f={[Ri]:rn,[rn]:Ri,[Ne]:Ne},u=new un({defines:{VSM_SAMPLES:8},uniforms:{shadow_pass:{value:null},resolution:{value:new rt},radius:{value:4}},vertexShader:_1,fragmentShader:y1}),d=u.clone();d.defines.HORIZONTAL_PASS=1;let p=new qt;p.setAttribute("position",new Qt(new Float32Array([-1,-1,.5,3,-1,.5,-1,3,.5]),3));let x=new ce(p,u),m=this;this.enabled=!1,this.autoUpdate=!0,this.needsUpdate=!1,this.type=$r;let g=this.type;this.render=function(S,w,_){if(m.enabled===!1||m.autoUpdate===!1&&m.needsUpdate===!1||S.length===0)return;this.type===qf&&(St("WebGLShadowMap: PCFSoftShadowMap has been removed. Using PCFShadowMap instead."),this.type=$r);let T=s.getRenderTarget(),R=s.getActiveCubeFace(),L=s.getActiveMipmapLevel(),D=s.state;D.setBlending(Yn),D.buffers.depth.getReversed()===!0?D.buffers.color.setClear(0,0,0,0):D.buffers.color.setClear(1,1,1,1),D.buffers.depth.setTest(!0),D.setScissorTest(!1);let F=g!==this.type;F&&w.traverse(function(C){C.material&&(Array.isArray(C.material)?C.material.forEach(N=>N.needsUpdate=!0):C.material.needsUpdate=!0)});for(let C=0,N=S.length;C<N;C++){let z=S[C],O=z.shadow;if(O===void 0){St("WebGLShadowMap:",z,"has no shadow.");continue}if(O.autoUpdate===!1&&O.needsUpdate===!1)continue;i.copy(O.mapSize);let H=O.getFrameExtents();i.multiply(H),r.copy(O.mapSize),(i.x>h||i.y>h)&&(i.x>h&&(r.x=Math.floor(h/H.x),i.x=r.x*H.x,O.mapSize.x=r.x),i.y>h&&(r.y=Math.floor(h/H.y),i.y=r.y*H.y,O.mapSize.y=r.y));let U=s.state.buffers.depth.getReversed();if(O.camera._reversedDepth=U,O.map===null||F===!0){if(O.map!==null&&(O.map.depthTexture!==null&&(O.map.depthTexture.dispose(),O.map.depthTexture=null),O.map.dispose()),this.type===Ns){if(z.isPointLight){St("WebGLShadowMap: VSM shadow maps are not supported for PointLights. Use PCF or BasicShadowMap instead.");continue}O.map=new Je(i.x,i.y,{format:Pi,type:Nn,minFilter:le,magFilter:le,generateMipmaps:!1}),O.map.texture.name=z.name+".shadowMap",O.map.depthTexture=new bi(i.x,i.y,en),O.map.depthTexture.name=z.name+".shadowMapDepth",O.map.depthTexture.format=Vn,O.map.depthTexture.compareFunction=null,O.map.depthTexture.minFilter=Ie,O.map.depthTexture.magFilter=Ie}else z.isPointLight?(O.map=new Zl(i.x),O.map.depthTexture=new ra(i.x,En)):(O.map=new Je(i.x,i.y),O.map.depthTexture=new bi(i.x,i.y,En)),O.map.depthTexture.name=z.name+".shadowMap",O.map.depthTexture.format=Vn,this.type===$r?(O.map.depthTexture.compareFunction=U?Vl:Gl,O.map.depthTexture.minFilter=le,O.map.depthTexture.magFilter=le):(O.map.depthTexture.compareFunction=null,O.map.depthTexture.minFilter=Ie,O.map.depthTexture.magFilter=Ie);O.camera.updateProjectionMatrix()}O.map.isWebGLCubeRenderTarget!==!0&&(O.map.width!==i.x||O.map.height!==i.y)&&O.map.setSize(i.x,i.y);let W=O.map.isWebGLCubeRenderTarget?6:O.getViewportCount();z.isPointLight!==!0&&O.updateMatrices(z,_);for(let Z=0;Z<W;Z++){let j=O.getCamera(Z);if(z.isPointLight){let q=O.camera,it=O.matrix,ft=z.distance||q.far;ft!==q.far&&(q.far=ft,q.updateProjectionMatrix()),Xl.setFromMatrixPosition(z.matrixWorld),q.position.copy(Xl),Yd.copy(q.position),Yd.add(v1[Z]),q.up.copy(M1[Z]),q.lookAt(Yd),q.updateMatrixWorld(),it.makeTranslation(-Xl.x,-Xl.y,-Xl.z),zg.multiplyMatrices(q.projectionMatrix,q.matrixWorldInverse),O._frustum.setFromProjectionMatrix(zg,q.coordinateSystem,q.reversedDepth)}if(O.map.isWebGLCubeRenderTarget)s.setRenderTarget(O.map,Z),s.clear();else{Z===0&&(s.setRenderTarget(O.map),s.clear());let q=O.getViewport(Z);o.set(r.x*q.x,r.y*q.y,r.x*q.z,r.y*q.w),D.viewport(o)}n=O.getFrustum(Z),y(w,_,j,z,this.type)}O.isPointLightShadow!==!0&&this.type===Ns&&v(O,_),O.needsUpdate=!1}g=this.type,m.needsUpdate=!1,s.setRenderTarget(T,R,L)};function v(S,w){let _=t.update(x);u.defines.VSM_SAMPLES!==S.blurSamples&&(u.defines.VSM_SAMPLES=S.blurSamples,d.defines.VSM_SAMPLES=S.blurSamples,u.needsUpdate=!0,d.needsUpdate=!0),S.mapPass===null?S.mapPass=new Je(i.x,i.y,{format:Pi,type:Nn}):(S.mapPass.width!==S.map.width||S.mapPass.height!==S.map.height)&&S.mapPass.setSize(S.map.width,S.map.height),u.uniforms.shadow_pass.value=S.map.depthTexture,u.uniforms.resolution.value.set(S.map.width,S.map.height),u.uniforms.radius.value=S.radius,s.setRenderTarget(S.mapPass),s.clear(),s.renderBufferDirect(w,null,_,u,x,null),d.uniforms.shadow_pass.value=S.mapPass.texture,d.uniforms.resolution.value.set(S.map.width,S.map.height),d.uniforms.radius.value=S.radius,s.setRenderTarget(S.map),s.clear(),s.renderBufferDirect(w,null,_,d,x,null)}function b(S,w,_,T){let R=null,L=_.isPointLight===!0?S.customDistanceMaterial:S.customDepthMaterial;if(L!==void 0)R=L;else if(R=_.isPointLight===!0?l:a,s.localClippingEnabled&&w.clipShadows===!0&&Array.isArray(w.clippingPlanes)&&w.clippingPlanes.length!==0||w.displacementMap&&w.displacementScale!==0||w.alphaMap&&w.alphaTest>0||w.map&&w.alphaTest>0||w.alphaToCoverage===!0){let D=R.uuid,F=w.uuid,C=c[D];C===void 0&&(C={},c[D]=C);let N=C[F];N===void 0&&(N=R.clone(),C[F]=N,w.addEventListener("dispose",M)),R=N}if(R.visible=w.visible,R.wireframe=w.wireframe,T===Ns?R.side=w.shadowSide!==null?w.shadowSide:w.side:R.side=w.shadowSide!==null?w.shadowSide:f[w.side],R.alphaMap=w.alphaMap,R.alphaTest=w.alphaToCoverage===!0?.5:w.alphaTest,R.map=w.map,R.clipShadows=w.clipShadows,R.clippingPlanes=w.clippingPlanes,R.clipIntersection=w.clipIntersection,R.displacementMap=w.displacementMap,R.displacementScale=w.displacementScale,R.displacementBias=w.displacementBias,R.wireframeLinewidth=w.wireframeLinewidth,R.linewidth=w.linewidth,_.isPointLight===!0&&R.isMeshDistanceMaterial===!0){let D=s.properties.get(R);D.light=_}return R}function y(S,w,_,T,R){if(S.visible===!1)return;if(S.layers.test(w.layers)&&(S.isMesh||S.isLine||S.isPoints)&&(S.castShadow||S.receiveShadow&&R===Ns)&&(!S.frustumCulled||S.intersectsFrustum(n))){S.modelViewMatrix.multiplyMatrices(_.matrixWorldInverse,S.matrixWorld);let F=t.update(S),C=S.material;if(Array.isArray(C)){let N=F.groups;for(let z=0,O=N.length;z<O;z++){let H=N[z],U=C[H.materialIndex];if(U&&U.visible){let W=b(S,U,T,R);S.onBeforeShadow(s,S,w,_,F,W,H),s.renderBufferDirect(_,null,F,W,S,H),S.onAfterShadow(s,S,w,_,F,W,H)}}}else if(C.visible){let N=b(S,C,T,R);S.onBeforeShadow(s,S,w,_,F,N,null),s.renderBufferDirect(_,null,F,N,S,null),S.onAfterShadow(s,S,w,_,F,N,null)}}let D=S.children;for(let F=0,C=D.length;F<C;F++)y(D[F],w,_,T,R)}function M(S){S.target.removeEventListener("dispose",M);for(let _ in c){let T=c[_],R=S.target.uuid;R in T&&(T[R].dispose(),delete T[R])}}}function b1(s,t){function e(){let X=!1,Tt=new ge,ot=null,wt=new ge(0,0,0,0);return{setMask:function(Pt){ot!==Pt&&!X&&(s.colorMask(Pt,Pt,Pt,Pt),ot=Pt)},setLocked:function(Pt){X=Pt},setClear:function(Pt,ut,Xt,Ot,ve){ve===!0&&(Pt*=Ot,ut*=Ot,Xt*=Ot),Tt.set(Pt,ut,Xt,Ot),wt.equals(Tt)===!1&&(s.clearColor(Pt,ut,Xt,Ot),wt.copy(Tt))},reset:function(){X=!1,ot=null,wt.set(-1,0,0,0)}}}function n(){let X=!1,Tt=!1,ot=null,wt=null,Pt=null;return{setReversed:function(ut){if(Tt!==ut){let Xt=t.get("EXT_clip_control");ut?Xt.clipControlEXT(Xt.LOWER_LEFT_EXT,Xt.ZERO_TO_ONE_EXT):Xt.clipControlEXT(Xt.LOWER_LEFT_EXT,Xt.NEGATIVE_ONE_TO_ONE_EXT),Tt=ut;let Ot=Pt;Pt=null,this.setClear(Ot)}},getReversed:function(){return Tt},setTest:function(ut){ut?Q(s.DEPTH_TEST):lt(s.DEPTH_TEST)},setMask:function(ut){ot!==ut&&!X&&(s.depthMask(ut),ot=ut)},setFunc:function(ut){if(Tt&&(ut=ag[ut]),wt!==ut){switch(ut){case zo:s.depthFunc(s.NEVER);break;case ko:s.depthFunc(s.ALWAYS);break;case Go:s.depthFunc(s.LESS);break;case ys:s.depthFunc(s.LEQUAL);break;case Vo:s.depthFunc(s.EQUAL);break;case Ho:s.depthFunc(s.GEQUAL);break;case Wo:s.depthFunc(s.GREATER);break;case Xo:s.depthFunc(s.NOTEQUAL);break;default:s.depthFunc(s.LEQUAL)}wt=ut}},setLocked:function(ut){X=ut},setClear:function(ut){Pt!==ut&&(Pt=ut,Tt&&(ut=1-ut),s.clearDepth(ut))},reset:function(){X=!1,ot=null,wt=null,Pt=null,Tt=!1}}}function i(){let X=!1,Tt=null,ot=null,wt=null,Pt=null,ut=null,Xt=null,Ot=null,ve=null;return{setTest:function(de){X||(de?Q(s.STENCIL_TEST):lt(s.STENCIL_TEST))},setMask:function(de){Tt!==de&&!X&&(s.stencilMask(de),Tt=de)},setFunc:function(de,Un,Kn){(ot!==de||wt!==Un||Pt!==Kn)&&(s.stencilFunc(de,Un,Kn),ot=de,wt=Un,Pt=Kn)},setOp:function(de,Un,Kn){(ut!==de||Xt!==Un||Ot!==Kn)&&(s.stencilOp(de,Un,Kn),ut=de,Xt=Un,Ot=Kn)},setLocked:function(de){X=de},setClear:function(de){ve!==de&&(s.clearStencil(de),ve=de)},reset:function(){X=!1,Tt=null,ot=null,wt=null,Pt=null,ut=null,Xt=null,Ot=null,ve=null}}}let r=new e,o=new n,a=new i,l=new WeakMap,c=new WeakMap,h={},f={},u={},d=new WeakMap,p=[],x=null,m=!1,g=null,v=null,b=null,y=null,M=null,S=null,w=null,_=new _t(0,0,0),T=0,R=!1,L=null,D=null,F=null,C=null,N=null,z=s.getParameter(s.MAX_COMBINED_TEXTURE_IMAGE_UNITS),O=!1,H=0,U=s.getParameter(s.VERSION);U.indexOf("WebGL")!==-1?(H=parseFloat(/^WebGL (\d)/.exec(U)[1]),O=H>=1):U.indexOf("OpenGL ES")!==-1&&(H=parseFloat(/^OpenGL ES (\d)/.exec(U)[1]),O=H>=2);let W=null,Z={},j=s.getParameter(s.SCISSOR_BOX),q=s.getParameter(s.VIEWPORT),it=new ge().fromArray(j),ft=new ge().fromArray(q);function ht(X,Tt,ot,wt){let Pt=new Uint8Array(4),ut=s.createTexture();s.bindTexture(X,ut),s.texParameteri(X,s.TEXTURE_MIN_FILTER,s.NEAREST),s.texParameteri(X,s.TEXTURE_MAG_FILTER,s.NEAREST);for(let Xt=0;Xt<ot;Xt++)X===s.TEXTURE_3D||X===s.TEXTURE_2D_ARRAY?s.texImage3D(Tt,0,s.RGBA,1,1,wt,0,s.RGBA,s.UNSIGNED_BYTE,Pt):s.texImage2D(Tt+Xt,0,s.RGBA,1,1,0,s.RGBA,s.UNSIGNED_BYTE,Pt);return ut}let G={};G[s.TEXTURE_2D]=ht(s.TEXTURE_2D,s.TEXTURE_2D,1),G[s.TEXTURE_CUBE_MAP]=ht(s.TEXTURE_CUBE_MAP,s.TEXTURE_CUBE_MAP_POSITIVE_X,6),G[s.TEXTURE_2D_ARRAY]=ht(s.TEXTURE_2D_ARRAY,s.TEXTURE_2D_ARRAY,1,1),G[s.TEXTURE_3D]=ht(s.TEXTURE_3D,s.TEXTURE_3D,1,1),r.setClear(0,0,0,1),o.setClear(1),a.setClear(0),Q(s.DEPTH_TEST),o.setFunc(ys),gt(!1),vt(ru),Q(s.CULL_FACE),ct(Yn);function Q(X){h[X]!==!0&&(s.enable(X),h[X]=!0)}function lt(X){h[X]!==!1&&(s.disable(X),h[X]=!1)}function yt(X,Tt){return u[X]!==Tt?(s.bindFramebuffer(X,Tt),u[X]=Tt,X===s.DRAW_FRAMEBUFFER&&(u[s.FRAMEBUFFER]=Tt),X===s.FRAMEBUFFER&&(u[s.DRAW_FRAMEBUFFER]=Tt),!0):!1}function dt(X,Tt){let ot=p,wt=!1;if(X){ot=d.get(Tt),ot===void 0&&(ot=[],d.set(Tt,ot));let Pt=X.textures;if(ot.length!==Pt.length||ot[0]!==s.COLOR_ATTACHMENT0){for(let ut=0,Xt=Pt.length;ut<Xt;ut++)ot[ut]=s.COLOR_ATTACHMENT0+ut;ot.length=Pt.length,wt=!0}}else ot[0]!==s.BACK&&(ot[0]=s.BACK,wt=!0);wt&&s.drawBuffers(ot)}function xt(X){return x!==X?(s.useProgram(X),x=X,!0):!1}let Vt={[ns]:s.FUNC_ADD,[Zf]:s.FUNC_SUBTRACT,[Jf]:s.FUNC_REVERSE_SUBTRACT};Vt[$f]=s.MIN,Vt[Kf]=s.MAX;let nt={[Qf]:s.ZERO,[jf]:s.ONE,[td]:s.SRC_COLOR,[cu]:s.SRC_ALPHA,[od]:s.SRC_ALPHA_SATURATE,[sd]:s.DST_COLOR,[nd]:s.DST_ALPHA,[ed]:s.ONE_MINUS_SRC_COLOR,[hu]:s.ONE_MINUS_SRC_ALPHA,[rd]:s.ONE_MINUS_DST_COLOR,[id]:s.ONE_MINUS_DST_ALPHA,[ad]:s.CONSTANT_COLOR,[ld]:s.ONE_MINUS_CONSTANT_COLOR,[cd]:s.CONSTANT_ALPHA,[hd]:s.ONE_MINUS_CONSTANT_ALPHA};function ct(X,Tt,ot,wt,Pt,ut,Xt,Ot,ve,de){if(X===Yn){m===!0&&(lt(s.BLEND),m=!1);return}if(m===!1&&(Q(s.BLEND),m=!0),X!==Yf){if(X!==g||de!==R){if((v!==ns||M!==ns)&&(s.blendEquation(s.FUNC_ADD),v=ns,M=ns),de)switch(X){case Us:s.blendFuncSeparate(s.ONE,s.ONE_MINUS_SRC_ALPHA,s.ONE,s.ONE_MINUS_SRC_ALPHA);break;case ou:s.blendFunc(s.ONE,s.ONE);break;case au:s.blendFuncSeparate(s.ZERO,s.ONE_MINUS_SRC_COLOR,s.ZERO,s.ONE);break;case lu:s.blendFuncSeparate(s.DST_COLOR,s.ONE_MINUS_SRC_ALPHA,s.ZERO,s.ONE);break;default:Bt("WebGLState: Invalid blending: ",X);break}else switch(X){case Us:s.blendFuncSeparate(s.SRC_ALPHA,s.ONE_MINUS_SRC_ALPHA,s.ONE,s.ONE_MINUS_SRC_ALPHA);break;case ou:s.blendFuncSeparate(s.SRC_ALPHA,s.ONE,s.ONE,s.ONE);break;case au:Bt("WebGLState: SubtractiveBlending requires material.premultipliedAlpha = true");break;case lu:Bt("WebGLState: MultiplyBlending requires material.premultipliedAlpha = true");break;default:Bt("WebGLState: Invalid blending: ",X);break}b=null,y=null,S=null,w=null,_.set(0,0,0),T=0,g=X,R=de}return}Pt=Pt||Tt,ut=ut||ot,Xt=Xt||wt,(Tt!==v||Pt!==M)&&(s.blendEquationSeparate(Vt[Tt],Vt[Pt]),v=Tt,M=Pt),(ot!==b||wt!==y||ut!==S||Xt!==w)&&(s.blendFuncSeparate(nt[ot],nt[wt],nt[ut],nt[Xt]),b=ot,y=wt,S=ut,w=Xt),(Ot.equals(_)===!1||ve!==T)&&(s.blendColor(Ot.r,Ot.g,Ot.b,ve),_.copy(Ot),T=ve),g=X,R=!1}function mt(X,Tt){X.side===Ne?lt(s.CULL_FACE):Q(s.CULL_FACE);let ot=X.side===rn;Tt&&(ot=!ot),gt(ot),X.blending===Us&&X.transparent===!1?ct(Yn):ct(X.blending,X.blendEquation,X.blendSrc,X.blendDst,X.blendEquationAlpha,X.blendSrcAlpha,X.blendDstAlpha,X.blendColor,X.blendAlpha,X.premultipliedAlpha),o.setFunc(X.depthFunc),o.setTest(X.depthTest),o.setMask(X.depthWrite),r.setMask(X.colorWrite);let wt=X.stencilWrite;a.setTest(wt),wt&&(a.setMask(X.stencilWriteMask),a.setFunc(X.stencilFunc,X.stencilRef,X.stencilFuncMask),a.setOp(X.stencilFail,X.stencilZFail,X.stencilZPass)),Ft(X.polygonOffset,X.polygonOffsetFactor,X.polygonOffsetUnits),X.alphaToCoverage===!0?Q(s.SAMPLE_ALPHA_TO_COVERAGE):lt(s.SAMPLE_ALPHA_TO_COVERAGE)}function gt(X){L!==X&&(X?s.frontFace(s.CW):s.frontFace(s.CCW),L=X)}function vt(X){X!==Wf?(Q(s.CULL_FACE),X!==D&&(X===ru?s.cullFace(s.BACK):X===Xf?s.cullFace(s.FRONT):s.cullFace(s.FRONT_AND_BACK))):lt(s.CULL_FACE),D=X}function zt(X){X!==F&&(O&&s.lineWidth(X),F=X)}function Ft(X,Tt,ot){X?(Q(s.POLYGON_OFFSET_FILL),(C!==Tt||N!==ot)&&(C=Tt,N=ot,o.getReversed()&&(Tt=-Tt),s.polygonOffset(Tt,ot))):lt(s.POLYGON_OFFSET_FILL)}function Wt(X){X?Q(s.SCISSOR_TEST):lt(s.SCISSOR_TEST)}function Yt(X){X===void 0&&(X=s.TEXTURE0+z-1),W!==X&&(s.activeTexture(X),W=X)}function B(X,Tt,ot){ot===void 0&&(W===null?ot=s.TEXTURE0+z-1:ot=W);let wt=Z[ot];wt===void 0&&(wt={type:void 0,texture:void 0},Z[ot]=wt),(wt.type!==X||wt.texture!==Tt)&&(W!==ot&&(s.activeTexture(ot),W=ot),s.bindTexture(X,Tt||G[X]),wt.type=X,wt.texture=Tt)}function se(){let X=Z[W];X!==void 0&&X.type!==void 0&&(s.bindTexture(X.type,null),X.type=void 0,X.texture=void 0)}function Kt(){try{s.compressedTexImage2D(...arguments)}catch(X){Bt("WebGLState:",X)}}function I(){try{s.compressedTexImage3D(...arguments)}catch(X){Bt("WebGLState:",X)}}function E(){try{s.texSubImage2D(...arguments)}catch(X){Bt("WebGLState:",X)}}function Y(){try{s.texSubImage3D(...arguments)}catch(X){Bt("WebGLState:",X)}}function k(){try{s.compressedTexSubImage2D(...arguments)}catch(X){Bt("WebGLState:",X)}}function J(){try{s.compressedTexSubImage3D(...arguments)}catch(X){Bt("WebGLState:",X)}}function at(){try{s.texStorage2D(...arguments)}catch(X){Bt("WebGLState:",X)}}function pt(){try{s.texStorage3D(...arguments)}catch(X){Bt("WebGLState:",X)}}function tt(){try{s.texImage2D(...arguments)}catch(X){Bt("WebGLState:",X)}}function st(){try{s.texImage3D(...arguments)}catch(X){Bt("WebGLState:",X)}}function Mt(X){return f[X]!==void 0?f[X]:s.getParameter(X)}function kt(X,Tt){f[X]!==Tt&&(s.pixelStorei(X,Tt),f[X]=Tt)}function bt(X){it.equals(X)===!1&&(s.scissor(X.x,X.y,X.z,X.w),it.copy(X))}function Et(X){ft.equals(X)===!1&&(s.viewport(X.x,X.y,X.z,X.w),ft.copy(X))}function Ht(X,Tt){let ot=c.get(Tt);ot===void 0&&(ot=new WeakMap,c.set(Tt,ot));let wt=ot.get(X);wt===void 0&&(wt=s.getUniformBlockIndex(Tt,X.name),ot.set(X,wt))}function Zt(X,Tt){let wt=c.get(Tt).get(X);l.get(Tt)!==wt&&(s.uniformBlockBinding(Tt,wt,X.__bindingPointIndex),l.set(Tt,wt))}function te(){s.disable(s.BLEND),s.disable(s.CULL_FACE),s.disable(s.DEPTH_TEST),s.disable(s.POLYGON_OFFSET_FILL),s.disable(s.SCISSOR_TEST),s.disable(s.STENCIL_TEST),s.disable(s.SAMPLE_ALPHA_TO_COVERAGE),s.blendEquation(s.FUNC_ADD),s.blendFunc(s.ONE,s.ZERO),s.blendFuncSeparate(s.ONE,s.ZERO,s.ONE,s.ZERO),s.blendColor(0,0,0,0),s.colorMask(!0,!0,!0,!0),s.clearColor(0,0,0,0),s.depthMask(!0),s.depthFunc(s.LESS),o.setReversed(!1),s.clearDepth(1),s.stencilMask(4294967295),s.stencilFunc(s.ALWAYS,0,4294967295),s.stencilOp(s.KEEP,s.KEEP,s.KEEP),s.clearStencil(0),s.cullFace(s.BACK),s.frontFace(s.CCW),s.polygonOffset(0,0),s.activeTexture(s.TEXTURE0),s.bindFramebuffer(s.FRAMEBUFFER,null),s.bindFramebuffer(s.DRAW_FRAMEBUFFER,null),s.bindFramebuffer(s.READ_FRAMEBUFFER,null),s.useProgram(null),s.lineWidth(1),s.scissor(0,0,s.canvas.width,s.canvas.height),s.viewport(0,0,s.canvas.width,s.canvas.height),s.pixelStorei(s.PACK_ALIGNMENT,4),s.pixelStorei(s.UNPACK_ALIGNMENT,4),s.pixelStorei(s.UNPACK_FLIP_Y_WEBGL,!1),s.pixelStorei(s.UNPACK_PREMULTIPLY_ALPHA_WEBGL,!1),s.pixelStorei(s.UNPACK_COLORSPACE_CONVERSION_WEBGL,s.BROWSER_DEFAULT_WEBGL),s.pixelStorei(s.PACK_ROW_LENGTH,0),s.pixelStorei(s.PACK_SKIP_PIXELS,0),s.pixelStorei(s.PACK_SKIP_ROWS,0),s.pixelStorei(s.UNPACK_ROW_LENGTH,0),s.pixelStorei(s.UNPACK_IMAGE_HEIGHT,0),s.pixelStorei(s.UNPACK_SKIP_PIXELS,0),s.pixelStorei(s.UNPACK_SKIP_ROWS,0),s.pixelStorei(s.UNPACK_SKIP_IMAGES,0),h={},f={},W=null,Z={},u={},d=new WeakMap,p=[],x=null,m=!1,g=null,v=null,b=null,y=null,M=null,S=null,w=null,_=new _t(0,0,0),T=0,R=!1,L=null,D=null,F=null,C=null,N=null,it.set(0,0,s.canvas.width,s.canvas.height),ft.set(0,0,s.canvas.width,s.canvas.height),r.reset(),o.reset(),a.reset()}return{buffers:{color:r,depth:o,stencil:a},enable:Q,disable:lt,bindFramebuffer:yt,drawBuffers:dt,useProgram:xt,setBlending:ct,setMaterial:mt,setFlipSided:gt,setCullFace:vt,setLineWidth:zt,setPolygonOffset:Ft,setScissorTest:Wt,activeTexture:Yt,bindTexture:B,unbindTexture:se,compressedTexImage2D:Kt,compressedTexImage3D:I,texImage2D:tt,texImage3D:st,pixelStorei:kt,getParameter:Mt,updateUBOMapping:Ht,uniformBlockBinding:Zt,texStorage2D:at,texStorage3D:pt,texSubImage2D:E,texSubImage3D:Y,compressedTexSubImage2D:k,compressedTexSubImage3D:J,scissor:bt,viewport:Et,reset:te}}function E1(s,t,e,n,i,r,o){let a=t.has("WEBGL_multisampled_render_to_texture")?t.get("WEBGL_multisampled_render_to_texture"):null,l=typeof navigator>"u"?!1:/OculusBrowser/g.test(navigator.userAgent),c=new rt,h=new WeakMap,f=new Set,u,d=new WeakMap,p=!1;try{p=typeof OffscreenCanvas<"u"&&new OffscreenCanvas(1,1).getContext("2d")!==null}catch{}function x(I,E){return p?new OffscreenCanvas(I,E):br("canvas")}function m(I,E,Y){let k=1,J=Kt(I);if((J.width>Y||J.height>Y)&&(k=Y/Math.max(J.width,J.height)),k<1)if(typeof HTMLImageElement<"u"&&I instanceof HTMLImageElement||typeof HTMLCanvasElement<"u"&&I instanceof HTMLCanvasElement||typeof ImageBitmap<"u"&&I instanceof ImageBitmap||typeof VideoFrame<"u"&&I instanceof VideoFrame){let at=Math.floor(k*J.width),pt=Math.floor(k*J.height);u===void 0&&(u=x(at,pt));let tt=E?x(at,pt):u;return tt.width=at,tt.height=pt,tt.getContext("2d").drawImage(I,0,0,at,pt),St("WebGLRenderer: Texture has been resized from ("+J.width+"x"+J.height+") to ("+at+"x"+pt+")."),tt}else return"data"in I&&St("WebGLRenderer: Image in DataTexture is too big ("+J.width+"x"+J.height+")."),I;return I}function g(I){return I.generateMipmaps}function v(I){s.generateMipmap(I)}function b(I){return I.isWebGLCubeRenderTarget?s.TEXTURE_CUBE_MAP:I.isWebGL3DRenderTarget?s.TEXTURE_3D:I.isWebGLArrayRenderTarget||I.isCompressedArrayTexture?s.TEXTURE_2D_ARRAY:s.TEXTURE_2D}function y(I,E,Y,k,J,at=!1){if(I!==null){if(s[I]!==void 0)return s[I];St("WebGLRenderer: Attempt to use non-existing WebGL internal format '"+I+"'")}let pt;k&&(pt=t.get("EXT_texture_norm16"),pt||St("WebGLRenderer: Unable to use normalized textures without EXT_texture_norm16 extension"));let tt=E;if(E===s.RED&&(Y===s.FLOAT&&(tt=s.R32F),Y===s.HALF_FLOAT&&(tt=s.R16F),Y===s.UNSIGNED_BYTE&&(tt=s.R8),Y===s.UNSIGNED_SHORT&&pt&&(tt=pt.R16_EXT),Y===s.SHORT&&pt&&(tt=pt.R16_SNORM_EXT)),E===s.RED_INTEGER&&(Y===s.UNSIGNED_BYTE&&(tt=s.R8UI),Y===s.UNSIGNED_SHORT&&(tt=s.R16UI),Y===s.UNSIGNED_INT&&(tt=s.R32UI),Y===s.BYTE&&(tt=s.R8I),Y===s.SHORT&&(tt=s.R16I),Y===s.INT&&(tt=s.R32I)),E===s.RG&&(Y===s.FLOAT&&(tt=s.RG32F),Y===s.HALF_FLOAT&&(tt=s.RG16F),Y===s.UNSIGNED_BYTE&&(tt=s.RG8),Y===s.UNSIGNED_SHORT&&pt&&(tt=pt.RG16_EXT),Y===s.SHORT&&pt&&(tt=pt.RG16_SNORM_EXT)),E===s.RG_INTEGER&&(Y===s.UNSIGNED_BYTE&&(tt=s.RG8UI),Y===s.UNSIGNED_SHORT&&(tt=s.RG16UI),Y===s.UNSIGNED_INT&&(tt=s.RG32UI),Y===s.BYTE&&(tt=s.RG8I),Y===s.SHORT&&(tt=s.RG16I),Y===s.INT&&(tt=s.RG32I)),E===s.RGB_INTEGER&&(Y===s.UNSIGNED_BYTE&&(tt=s.RGB8UI),Y===s.UNSIGNED_SHORT&&(tt=s.RGB16UI),Y===s.UNSIGNED_INT&&(tt=s.RGB32UI),Y===s.BYTE&&(tt=s.RGB8I),Y===s.SHORT&&(tt=s.RGB16I),Y===s.INT&&(tt=s.RGB32I)),E===s.RGBA_INTEGER&&(Y===s.UNSIGNED_BYTE&&(tt=s.RGBA8UI),Y===s.UNSIGNED_SHORT&&(tt=s.RGBA16UI),Y===s.UNSIGNED_INT&&(tt=s.RGBA32UI),Y===s.BYTE&&(tt=s.RGBA8I),Y===s.SHORT&&(tt=s.RGBA16I),Y===s.INT&&(tt=s.RGBA32I)),E===s.RGB&&(Y===s.UNSIGNED_SHORT&&pt&&(tt=pt.RGB16_EXT),Y===s.SHORT&&pt&&(tt=pt.RGB16_SNORM_EXT),Y===s.UNSIGNED_INT_5_9_9_9_REV&&(tt=s.RGB9_E5),Y===s.UNSIGNED_INT_10F_11F_11F_REV&&(tt=s.R11F_G11F_B10F)),E===s.RGBA){let st=at?Sr:re.getTransfer(J);Y===s.FLOAT&&(tt=s.RGBA32F),Y===s.HALF_FLOAT&&(tt=s.RGBA16F),Y===s.UNSIGNED_BYTE&&(tt=st===ue?s.SRGB8_ALPHA8:s.RGBA8),Y===s.UNSIGNED_SHORT&&pt&&(tt=pt.RGBA16_EXT),Y===s.SHORT&&pt&&(tt=pt.RGBA16_SNORM_EXT),Y===s.UNSIGNED_SHORT_4_4_4_4&&(tt=s.RGBA4),Y===s.UNSIGNED_SHORT_5_5_5_1&&(tt=s.RGB5_A1)}return(tt===s.R16F||tt===s.R32F||tt===s.RG16F||tt===s.RG32F||tt===s.RGBA16F||tt===s.RGBA32F)&&t.get("EXT_color_buffer_float"),tt}function M(I,E){let Y;return I?E===null||E===En||E===zs?Y=s.DEPTH24_STENCIL8:E===en?Y=s.DEPTH32F_STENCIL8:E===Bs&&(Y=s.DEPTH24_STENCIL8,St("DepthTexture: 16 bit depth attachment is not supported with stencil. Using 24-bit attachment.")):E===null||E===En||E===zs?Y=s.DEPTH_COMPONENT24:E===en?Y=s.DEPTH_COMPONENT32F:E===Bs&&(Y=s.DEPTH_COMPONENT16),Y}function S(I,E){return g(I)===!0||I.isFramebufferTexture&&I.minFilter!==Ie&&I.minFilter!==le?Math.log2(Math.max(E.width,E.height))+1:I.mipmaps!==void 0&&I.mipmaps.length>0?I.mipmaps.length:I.isCompressedTexture&&Array.isArray(I.image)?E.mipmaps.length:1}function w(I){let E=I.target;E.removeEventListener("dispose",w),T(E),E.isVideoTexture&&h.delete(E),E.isHTMLTexture&&f.delete(E)}function _(I){let E=I.target;E.removeEventListener("dispose",_),L(E)}function T(I){let E=n.get(I);if(E.__webglInit===void 0)return;let Y=I.source,k=d.get(Y);if(k){let J=k[E.__cacheKey];J.usedTimes--,J.usedTimes===0&&R(I),Object.keys(k).length===0&&d.delete(Y)}n.remove(I)}function R(I){let E=n.get(I);s.deleteTexture(E.__webglTexture);let Y=I.source,k=d.get(Y);delete k[E.__cacheKey],o.memory.textures--}function L(I){let E=n.get(I);if(I.depthTexture&&(I.depthTexture.dispose(),n.remove(I.depthTexture)),I.isWebGLCubeRenderTarget)for(let k=0;k<6;k++){if(Array.isArray(E.__webglFramebuffer[k]))for(let J=0;J<E.__webglFramebuffer[k].length;J++)s.deleteFramebuffer(E.__webglFramebuffer[k][J]);else s.deleteFramebuffer(E.__webglFramebuffer[k]);E.__webglDepthbuffer&&s.deleteRenderbuffer(E.__webglDepthbuffer[k])}else{if(Array.isArray(E.__webglFramebuffer))for(let k=0;k<E.__webglFramebuffer.length;k++)s.deleteFramebuffer(E.__webglFramebuffer[k]);else s.deleteFramebuffer(E.__webglFramebuffer);if(E.__webglDepthbuffer&&s.deleteRenderbuffer(E.__webglDepthbuffer),E.__webglMultisampledFramebuffer&&s.deleteFramebuffer(E.__webglMultisampledFramebuffer),E.__webglColorRenderbuffer)for(let k=0;k<E.__webglColorRenderbuffer.length;k++)E.__webglColorRenderbuffer[k]&&s.deleteRenderbuffer(E.__webglColorRenderbuffer[k]);E.__webglDepthRenderbuffer&&s.deleteRenderbuffer(E.__webglDepthRenderbuffer)}let Y=I.textures;for(let k=0,J=Y.length;k<J;k++){let at=n.get(Y[k]);at.__webglTexture&&(s.deleteTexture(at.__webglTexture),o.memory.textures--),n.remove(Y[k])}n.remove(I)}let D=0;function F(){D=0}function C(){return D}function N(I){D=I}function z(){let I=D;return I>=i.maxTextures&&St("WebGLTextures: Trying to use "+(I+1)+" texture units while this GPU supports only "+i.maxTextures),D+=1,I}function O(I){let E=[];return E.push(I.wrapS),E.push(I.wrapT),E.push(I.wrapR||0),E.push(I.magFilter),E.push(I.minFilter),E.push(I.anisotropy),E.push(I.internalFormat),E.push(I.format),E.push(I.type),E.push(I.generateMipmaps),E.push(I.premultiplyAlpha),E.push(I.flipY),E.push(I.unpackAlignment),E.push(I.colorSpace),E.join()}function H(I,E){let Y=n.get(I);if(I.isVideoTexture&&B(I),I.isRenderTargetTexture===!1&&I.isExternalTexture!==!0&&I.version>0&&Y.__version!==I.version){let k=I.image;if(k===null)St("WebGLRenderer: Texture marked for update but no image data found.");else if(k.complete===!1)St("WebGLRenderer: Texture marked for update but image is incomplete");else{lt(Y,I,E);return}}else I.isExternalTexture&&(Y.__webglTexture=I.sourceTexture?I.sourceTexture:null);e.bindTexture(s.TEXTURE_2D,Y.__webglTexture,s.TEXTURE0+E)}function U(I,E){let Y=n.get(I);if(I.isRenderTargetTexture===!1&&I.version>0&&Y.__version!==I.version){lt(Y,I,E);return}else I.isExternalTexture&&(Y.__webglTexture=I.sourceTexture?I.sourceTexture:null);e.bindTexture(s.TEXTURE_2D_ARRAY,Y.__webglTexture,s.TEXTURE0+E)}function W(I,E){let Y=n.get(I);if(I.isRenderTargetTexture===!1&&I.version>0&&Y.__version!==I.version){lt(Y,I,E);return}e.bindTexture(s.TEXTURE_3D,Y.__webglTexture,s.TEXTURE0+E)}function Z(I,E){let Y=n.get(I);if(I.isCubeDepthTexture!==!0&&I.version>0&&Y.__version!==I.version){yt(Y,I,E);return}e.bindTexture(s.TEXTURE_CUBE_MAP,Y.__webglTexture,s.TEXTURE0+E)}let j={[In]:s.REPEAT,[Ce]:s.CLAMP_TO_EDGE,[_r]:s.MIRRORED_REPEAT},q={[Ie]:s.NEAREST,[_u]:s.NEAREST_MIPMAP_NEAREST,[Os]:s.NEAREST_MIPMAP_LINEAR,[le]:s.LINEAR,[to]:s.LINEAR_MIPMAP_NEAREST,[Ve]:s.LINEAR_MIPMAP_LINEAR},it={[bd]:s.NEVER,[Rd]:s.ALWAYS,[Ed]:s.LESS,[Gl]:s.LEQUAL,[Td]:s.EQUAL,[Vl]:s.GEQUAL,[wd]:s.GREATER,[Ad]:s.NOTEQUAL};function ft(I,E){if(E.type===en&&t.has("OES_texture_float_linear")===!1&&(E.magFilter===le||E.magFilter===to||E.magFilter===Os||E.magFilter===Ve||E.minFilter===le||E.minFilter===to||E.minFilter===Os||E.minFilter===Ve)&&St("WebGLRenderer: Unable to use linear filtering with floating point textures. OES_texture_float_linear not supported on this device."),s.texParameteri(I,s.TEXTURE_WRAP_S,j[E.wrapS]),s.texParameteri(I,s.TEXTURE_WRAP_T,j[E.wrapT]),(I===s.TEXTURE_3D||I===s.TEXTURE_2D_ARRAY)&&s.texParameteri(I,s.TEXTURE_WRAP_R,j[E.wrapR]),s.texParameteri(I,s.TEXTURE_MAG_FILTER,q[E.magFilter]),s.texParameteri(I,s.TEXTURE_MIN_FILTER,q[E.minFilter]),E.compareFunction&&(s.texParameteri(I,s.TEXTURE_COMPARE_MODE,s.COMPARE_REF_TO_TEXTURE),s.texParameteri(I,s.TEXTURE_COMPARE_FUNC,it[E.compareFunction])),t.has("EXT_texture_filter_anisotropic")===!0){if(E.magFilter===Ie||E.minFilter!==Os&&E.minFilter!==Ve||E.type===en&&t.has("OES_texture_float_linear")===!1)return;if(E.anisotropy>1||n.get(E).__currentAnisotropy){let Y=t.get("EXT_texture_filter_anisotropic");s.texParameterf(I,Y.TEXTURE_MAX_ANISOTROPY_EXT,Math.min(E.anisotropy,i.getMaxAnisotropy())),n.get(E).__currentAnisotropy=E.anisotropy}}}function ht(I,E){let Y=!1;I.__webglInit===void 0&&(I.__webglInit=!0,E.addEventListener("dispose",w));let k=E.source,J=d.get(k);J===void 0&&(J={},d.set(k,J));let at=O(E);if(at!==I.__cacheKey){J[at]===void 0&&(J[at]={texture:s.createTexture(),usedTimes:0},o.memory.textures++,Y=!0),J[at].usedTimes++;let pt=J[I.__cacheKey];pt!==void 0&&(J[I.__cacheKey].usedTimes--,pt.usedTimes===0&&R(E)),I.__cacheKey=at,I.__webglTexture=J[at].texture}return Y}function G(I,E,Y){return Math.floor(Math.floor(I/Y)/E)}function Q(I,E,Y,k){let at=I.updateRanges;if(at.length===0)e.texSubImage2D(s.TEXTURE_2D,0,0,0,E.width,E.height,Y,k,E.data);else{at.sort((kt,bt)=>kt.start-bt.start);let pt=0;for(let kt=1;kt<at.length;kt++){let bt=at[pt],Et=at[kt],Ht=bt.start+bt.count,Zt=G(Et.start,E.width,4),te=G(bt.start,E.width,4);Et.start<=Ht+1&&Zt===te&&G(Et.start+Et.count-1,E.width,4)===Zt?bt.count=Math.max(bt.count,Et.start+Et.count-bt.start):(++pt,at[pt]=Et)}at.length=pt+1;let tt=e.getParameter(s.UNPACK_ROW_LENGTH),st=e.getParameter(s.UNPACK_SKIP_PIXELS),Mt=e.getParameter(s.UNPACK_SKIP_ROWS);e.pixelStorei(s.UNPACK_ROW_LENGTH,E.width);for(let kt=0,bt=at.length;kt<bt;kt++){let Et=at[kt],Ht=Math.floor(Et.start/4),Zt=Math.ceil(Et.count/4),te=Ht%E.width,X=Math.floor(Ht/E.width),Tt=Zt,ot=1;e.pixelStorei(s.UNPACK_SKIP_PIXELS,te),e.pixelStorei(s.UNPACK_SKIP_ROWS,X),e.texSubImage2D(s.TEXTURE_2D,0,te,X,Tt,ot,Y,k,E.data)}I.clearUpdateRanges(),e.pixelStorei(s.UNPACK_ROW_LENGTH,tt),e.pixelStorei(s.UNPACK_SKIP_PIXELS,st),e.pixelStorei(s.UNPACK_SKIP_ROWS,Mt)}}function lt(I,E,Y){let k=s.TEXTURE_2D;(E.isDataArrayTexture||E.isCompressedArrayTexture)&&(k=s.TEXTURE_2D_ARRAY),E.isData3DTexture&&(k=s.TEXTURE_3D);let J=ht(I,E),at=E.source;e.bindTexture(k,I.__webglTexture,s.TEXTURE0+Y);let pt=n.get(at);if(at.version!==pt.__version||J===!0){if(e.activeTexture(s.TEXTURE0+Y),(typeof ImageBitmap<"u"&&E.image instanceof ImageBitmap)===!1){let ot=re.getPrimaries(re.workingColorSpace),wt=E.colorSpace===ai?null:re.getPrimaries(E.colorSpace),Pt=E.colorSpace===ai||ot===wt?s.NONE:s.BROWSER_DEFAULT_WEBGL;e.pixelStorei(s.UNPACK_FLIP_Y_WEBGL,E.flipY),e.pixelStorei(s.UNPACK_PREMULTIPLY_ALPHA_WEBGL,E.premultiplyAlpha),e.pixelStorei(s.UNPACK_COLORSPACE_CONVERSION_WEBGL,Pt)}e.pixelStorei(s.UNPACK_ALIGNMENT,E.unpackAlignment);let st=m(E.image,!1,i.maxTextureSize);st=se(E,st);let Mt=r.convert(E.format,E.colorSpace),kt=r.convert(E.type),bt=y(E.internalFormat,Mt,kt,E.normalized,E.colorSpace,E.isVideoTexture);ft(k,E);let Et,Ht=E.mipmaps,Zt=E.isVideoTexture!==!0,te=pt.__version===void 0||J===!0,X=at.dataReady,Tt=S(E,st);if(E.isDepthTexture)bt=M(E.format===Ii,E.type),te&&(Zt?e.texStorage2D(s.TEXTURE_2D,1,bt,st.width,st.height):e.texImage2D(s.TEXTURE_2D,0,bt,st.width,st.height,0,Mt,kt,null));else if(E.isDataTexture)if(Ht.length>0){Zt&&te&&e.texStorage2D(s.TEXTURE_2D,Tt,bt,Ht[0].width,Ht[0].height);for(let ot=0,wt=Ht.length;ot<wt;ot++)Et=Ht[ot],Zt?X&&e.texSubImage2D(s.TEXTURE_2D,ot,0,0,Et.width,Et.height,Mt,kt,Et.data):e.texImage2D(s.TEXTURE_2D,ot,bt,Et.width,Et.height,0,Mt,kt,Et.data);E.generateMipmaps=!1}else Zt?(te&&e.texStorage2D(s.TEXTURE_2D,Tt,bt,st.width,st.height),X&&Q(E,st,Mt,kt)):e.texImage2D(s.TEXTURE_2D,0,bt,st.width,st.height,0,Mt,kt,st.data);else if(E.isCompressedTexture)if(E.isCompressedArrayTexture){Zt&&te&&e.texStorage3D(s.TEXTURE_2D_ARRAY,Tt,bt,Ht[0].width,Ht[0].height,st.depth);for(let ot=0,wt=Ht.length;ot<wt;ot++)if(Et=Ht[ot],E.format!==nn)if(Mt!==null)if(Zt){if(X)if(E.layerUpdates.size>0){let Pt=Au(Et.width,Et.height,E.format,E.type);for(let ut of E.layerUpdates){let Xt=Et.data.subarray(ut*Pt/Et.data.BYTES_PER_ELEMENT,(ut+1)*Pt/Et.data.BYTES_PER_ELEMENT);e.compressedTexSubImage3D(s.TEXTURE_2D_ARRAY,ot,0,0,ut,Et.width,Et.height,1,Mt,Xt)}}else e.compressedTexSubImage3D(s.TEXTURE_2D_ARRAY,ot,0,0,0,Et.width,Et.height,st.depth,Mt,Et.data)}else e.compressedTexImage3D(s.TEXTURE_2D_ARRAY,ot,bt,Et.width,Et.height,st.depth,0,Et.data,0,0);else St("WebGLRenderer: Attempt to load unsupported compressed texture format in .uploadTexture()");else Zt?X&&e.texSubImage3D(s.TEXTURE_2D_ARRAY,ot,0,0,0,Et.width,Et.height,st.depth,Mt,kt,Et.data):e.texImage3D(s.TEXTURE_2D_ARRAY,ot,bt,Et.width,Et.height,st.depth,0,Mt,kt,Et.data);E.layerUpdates.size>0&&E.clearLayerUpdates()}else{Zt&&te&&e.texStorage2D(s.TEXTURE_2D,Tt,bt,Ht[0].width,Ht[0].height);for(let ot=0,wt=Ht.length;ot<wt;ot++)Et=Ht[ot],E.format!==nn?Mt!==null?Zt?X&&e.compressedTexSubImage2D(s.TEXTURE_2D,ot,0,0,Et.width,Et.height,Mt,Et.data):e.compressedTexImage2D(s.TEXTURE_2D,ot,bt,Et.width,Et.height,0,Et.data):St("WebGLRenderer: Attempt to load unsupported compressed texture format in .uploadTexture()"):Zt?X&&e.texSubImage2D(s.TEXTURE_2D,ot,0,0,Et.width,Et.height,Mt,kt,Et.data):e.texImage2D(s.TEXTURE_2D,ot,bt,Et.width,Et.height,0,Mt,kt,Et.data)}else if(E.isDataArrayTexture)if(Zt){if(te&&e.texStorage3D(s.TEXTURE_2D_ARRAY,Tt,bt,st.width,st.height,st.depth),X)if(E.layerUpdates.size>0){let ot=Au(st.width,st.height,E.format,E.type);for(let wt of E.layerUpdates){let Pt=st.data.subarray(wt*ot/st.data.BYTES_PER_ELEMENT,(wt+1)*ot/st.data.BYTES_PER_ELEMENT);e.texSubImage3D(s.TEXTURE_2D_ARRAY,0,0,0,wt,st.width,st.height,1,Mt,kt,Pt)}E.clearLayerUpdates()}else e.texSubImage3D(s.TEXTURE_2D_ARRAY,0,0,0,0,st.width,st.height,st.depth,Mt,kt,st.data)}else e.texImage3D(s.TEXTURE_2D_ARRAY,0,bt,st.width,st.height,st.depth,0,Mt,kt,st.data);else if(E.isData3DTexture)Zt?(te&&e.texStorage3D(s.TEXTURE_3D,Tt,bt,st.width,st.height,st.depth),X&&e.texSubImage3D(s.TEXTURE_3D,0,0,0,0,st.width,st.height,st.depth,Mt,kt,st.data)):e.texImage3D(s.TEXTURE_3D,0,bt,st.width,st.height,st.depth,0,Mt,kt,st.data);else if(E.isFramebufferTexture){if(te)if(Zt)e.texStorage2D(s.TEXTURE_2D,Tt,bt,st.width,st.height);else{let ot=st.width,wt=st.height;for(let Pt=0;Pt<Tt;Pt++)e.texImage2D(s.TEXTURE_2D,Pt,bt,ot,wt,0,Mt,kt,null),ot>>=1,wt>>=1}}else if(E.isHTMLTexture){if("texElementImage2D"in s){let ot=s.canvas;if(ot.hasAttribute("layoutsubtree")||ot.setAttribute("layoutsubtree","true"),st.parentNode!==ot){ot.appendChild(st),f.add(E),ot.onpaint=wt=>{let Pt=wt.changedElements;for(let ut of f)Pt.includes(ut.image)&&(ut.needsUpdate=!0)},ot.requestPaint();return}if(s.texElementImage2D.length===3)s.texElementImage2D(s.TEXTURE_2D,s.RGBA8,st);else{let Pt=s.RGBA,ut=s.RGBA,Xt=s.UNSIGNED_BYTE;s.texElementImage2D(s.TEXTURE_2D,0,Pt,ut,Xt,st)}s.texParameteri(s.TEXTURE_2D,s.TEXTURE_MIN_FILTER,s.LINEAR),s.texParameteri(s.TEXTURE_2D,s.TEXTURE_WRAP_S,s.CLAMP_TO_EDGE),s.texParameteri(s.TEXTURE_2D,s.TEXTURE_WRAP_T,s.CLAMP_TO_EDGE)}}else if(Ht.length>0){if(Zt&&te){let ot=Kt(Ht[0]);e.texStorage2D(s.TEXTURE_2D,Tt,bt,ot.width,ot.height)}for(let ot=0,wt=Ht.length;ot<wt;ot++)Et=Ht[ot],Zt?X&&e.texSubImage2D(s.TEXTURE_2D,ot,0,0,Mt,kt,Et):e.texImage2D(s.TEXTURE_2D,ot,bt,Mt,kt,Et);E.generateMipmaps=!1}else if(Zt){if(te){let ot=Kt(st);e.texStorage2D(s.TEXTURE_2D,Tt,bt,ot.width,ot.height)}X&&e.texSubImage2D(s.TEXTURE_2D,0,0,0,Mt,kt,st)}else e.texImage2D(s.TEXTURE_2D,0,bt,Mt,kt,st);g(E)&&v(k),pt.__version=at.version,E.onUpdate&&E.onUpdate(E)}I.__version=E.version}function yt(I,E,Y){if(E.image.length!==6)return;let k=ht(I,E),J=E.source;e.bindTexture(s.TEXTURE_CUBE_MAP,I.__webglTexture,s.TEXTURE0+Y);let at=n.get(J);if(J.version!==at.__version||k===!0){e.activeTexture(s.TEXTURE0+Y);let pt=re.getPrimaries(re.workingColorSpace),tt=E.colorSpace===ai?null:re.getPrimaries(E.colorSpace),st=E.colorSpace===ai||pt===tt?s.NONE:s.BROWSER_DEFAULT_WEBGL;e.pixelStorei(s.UNPACK_FLIP_Y_WEBGL,E.flipY),e.pixelStorei(s.UNPACK_PREMULTIPLY_ALPHA_WEBGL,E.premultiplyAlpha),e.pixelStorei(s.UNPACK_ALIGNMENT,E.unpackAlignment),e.pixelStorei(s.UNPACK_COLORSPACE_CONVERSION_WEBGL,st);let Mt=E.isCompressedTexture||E.image[0].isCompressedTexture,kt=E.image[0]&&E.image[0].isDataTexture,bt=[];for(let ut=0;ut<6;ut++)!Mt&&!kt?bt[ut]=m(E.image[ut],!0,i.maxCubemapSize):bt[ut]=kt?E.image[ut].image:E.image[ut],bt[ut]=se(E,bt[ut]);let Et=bt[0],Ht=r.convert(E.format,E.colorSpace),Zt=r.convert(E.type),te=y(E.internalFormat,Ht,Zt,E.normalized,E.colorSpace),X=E.isVideoTexture!==!0,Tt=at.__version===void 0||k===!0,ot=J.dataReady,wt=S(E,Et);ft(s.TEXTURE_CUBE_MAP,E);let Pt;if(Mt){X&&Tt&&e.texStorage2D(s.TEXTURE_CUBE_MAP,wt,te,Et.width,Et.height);for(let ut=0;ut<6;ut++){Pt=bt[ut].mipmaps;for(let Xt=0;Xt<Pt.length;Xt++){let Ot=Pt[Xt];E.format!==nn?Ht!==null?X?ot&&e.compressedTexSubImage2D(s.TEXTURE_CUBE_MAP_POSITIVE_X+ut,Xt,0,0,Ot.width,Ot.height,Ht,Ot.data):e.compressedTexImage2D(s.TEXTURE_CUBE_MAP_POSITIVE_X+ut,Xt,te,Ot.width,Ot.height,0,Ot.data):St("WebGLRenderer: Attempt to load unsupported compressed texture format in .setTextureCube()"):X?ot&&e.texSubImage2D(s.TEXTURE_CUBE_MAP_POSITIVE_X+ut,Xt,0,0,Ot.width,Ot.height,Ht,Zt,Ot.data):e.texImage2D(s.TEXTURE_CUBE_MAP_POSITIVE_X+ut,Xt,te,Ot.width,Ot.height,0,Ht,Zt,Ot.data)}}}else{if(Pt=E.mipmaps,X&&Tt){Pt.length>0&&wt++;let ut=Kt(bt[0]);e.texStorage2D(s.TEXTURE_CUBE_MAP,wt,te,ut.width,ut.height)}for(let ut=0;ut<6;ut++)if(kt){X?ot&&e.texSubImage2D(s.TEXTURE_CUBE_MAP_POSITIVE_X+ut,0,0,0,bt[ut].width,bt[ut].height,Ht,Zt,bt[ut].data):e.texImage2D(s.TEXTURE_CUBE_MAP_POSITIVE_X+ut,0,te,bt[ut].width,bt[ut].height,0,Ht,Zt,bt[ut].data);for(let Xt=0;Xt<Pt.length;Xt++){let ve=Pt[Xt].image[ut].image;X?ot&&e.texSubImage2D(s.TEXTURE_CUBE_MAP_POSITIVE_X+ut,Xt+1,0,0,ve.width,ve.height,Ht,Zt,ve.data):e.texImage2D(s.TEXTURE_CUBE_MAP_POSITIVE_X+ut,Xt+1,te,ve.width,ve.height,0,Ht,Zt,ve.data)}}else{X?ot&&e.texSubImage2D(s.TEXTURE_CUBE_MAP_POSITIVE_X+ut,0,0,0,Ht,Zt,bt[ut]):e.texImage2D(s.TEXTURE_CUBE_MAP_POSITIVE_X+ut,0,te,Ht,Zt,bt[ut]);for(let Xt=0;Xt<Pt.length;Xt++){let Ot=Pt[Xt];X?ot&&e.texSubImage2D(s.TEXTURE_CUBE_MAP_POSITIVE_X+ut,Xt+1,0,0,Ht,Zt,Ot.image[ut]):e.texImage2D(s.TEXTURE_CUBE_MAP_POSITIVE_X+ut,Xt+1,te,Ht,Zt,Ot.image[ut])}}}g(E)&&v(s.TEXTURE_CUBE_MAP),at.__version=J.version,E.onUpdate&&E.onUpdate(E)}I.__version=E.version}function dt(I,E,Y,k,J,at){let pt=r.convert(Y.format,Y.colorSpace),tt=r.convert(Y.type),st=y(Y.internalFormat,pt,tt,Y.normalized,Y.colorSpace),Mt=n.get(E),kt=n.get(Y);if(kt.__renderTarget=E,!Mt.__hasExternalTextures){let bt=Math.max(1,E.width>>at),Et=Math.max(1,E.height>>at);J===s.TEXTURE_3D||J===s.TEXTURE_2D_ARRAY?e.texImage3D(J,at,st,bt,Et,E.depth,0,pt,tt,null):e.texImage2D(J,at,st,bt,Et,0,pt,tt,null)}e.bindFramebuffer(s.FRAMEBUFFER,I),Yt(E)?a.framebufferTexture2DMultisampleEXT(s.FRAMEBUFFER,k,J,kt.__webglTexture,0,Wt(E)):(J===s.TEXTURE_2D||J>=s.TEXTURE_CUBE_MAP_POSITIVE_X&&J<=s.TEXTURE_CUBE_MAP_NEGATIVE_Z)&&s.framebufferTexture2D(s.FRAMEBUFFER,k,J,kt.__webglTexture,at),e.bindFramebuffer(s.FRAMEBUFFER,null)}function xt(I,E,Y){if(s.bindRenderbuffer(s.RENDERBUFFER,I),E.depthBuffer){let k=E.depthTexture,J=k&&k.isDepthTexture?k.type:null,at=M(E.stencilBuffer,J),pt=E.stencilBuffer?s.DEPTH_STENCIL_ATTACHMENT:s.DEPTH_ATTACHMENT;Yt(E)?a.renderbufferStorageMultisampleEXT(s.RENDERBUFFER,Wt(E),at,E.width,E.height):Y?s.renderbufferStorageMultisample(s.RENDERBUFFER,Wt(E),at,E.width,E.height):s.renderbufferStorage(s.RENDERBUFFER,at,E.width,E.height),s.framebufferRenderbuffer(s.FRAMEBUFFER,pt,s.RENDERBUFFER,I)}else{let k=E.textures;for(let J=0;J<k.length;J++){let at=k[J],pt=r.convert(at.format,at.colorSpace),tt=r.convert(at.type),st=y(at.internalFormat,pt,tt,at.normalized,at.colorSpace);Yt(E)?a.renderbufferStorageMultisampleEXT(s.RENDERBUFFER,Wt(E),st,E.width,E.height):Y?s.renderbufferStorageMultisample(s.RENDERBUFFER,Wt(E),st,E.width,E.height):s.renderbufferStorage(s.RENDERBUFFER,st,E.width,E.height)}}s.bindRenderbuffer(s.RENDERBUFFER,null)}function Vt(I,E,Y){let k=E.isWebGLCubeRenderTarget===!0;if(e.bindFramebuffer(s.FRAMEBUFFER,I),!(E.depthTexture&&E.depthTexture.isDepthTexture))throw new Error("THREE.WebGLTextures: renderTarget.depthTexture must be an instance of THREE.DepthTexture.");let J=n.get(E.depthTexture);if(J.__renderTarget=E,(!J.__webglTexture||E.depthTexture.image.width!==E.width||E.depthTexture.image.height!==E.height)&&(E.depthTexture.image.width=E.width,E.depthTexture.image.height=E.height,E.depthTexture.needsUpdate=!0),k){if(J.__webglInit===void 0&&(J.__webglInit=!0,E.depthTexture.addEventListener("dispose",w)),J.__webglTexture===void 0){J.__webglTexture=s.createTexture(),e.bindTexture(s.TEXTURE_CUBE_MAP,J.__webglTexture),ft(s.TEXTURE_CUBE_MAP,E.depthTexture);let Mt=r.convert(E.depthTexture.format),kt=r.convert(E.depthTexture.type),bt;E.depthTexture.format===Vn?bt=s.DEPTH_COMPONENT24:E.depthTexture.format===Ii&&(bt=s.DEPTH24_STENCIL8);for(let Et=0;Et<6;Et++)s.texImage2D(s.TEXTURE_CUBE_MAP_POSITIVE_X+Et,0,bt,E.width,E.height,0,Mt,kt,null)}}else H(E.depthTexture,0);let at=J.__webglTexture,pt=Wt(E),tt=k?s.TEXTURE_CUBE_MAP_POSITIVE_X+Y:s.TEXTURE_2D,st=E.depthTexture.format===Ii?s.DEPTH_STENCIL_ATTACHMENT:s.DEPTH_ATTACHMENT;if(E.depthTexture.format===Vn)Yt(E)?a.framebufferTexture2DMultisampleEXT(s.FRAMEBUFFER,st,tt,at,0,pt):s.framebufferTexture2D(s.FRAMEBUFFER,st,tt,at,0);else if(E.depthTexture.format===Ii)Yt(E)?a.framebufferTexture2DMultisampleEXT(s.FRAMEBUFFER,st,tt,at,0,pt):s.framebufferTexture2D(s.FRAMEBUFFER,st,tt,at,0);else throw new Error("THREE.WebGLTextures: Unknown depthTexture format.")}function nt(I){let E=n.get(I),Y=I.isWebGLCubeRenderTarget===!0;if(E.__boundDepthTexture!==I.depthTexture){let k=I.depthTexture;if(E.__depthDisposeCallback&&E.__depthDisposeCallback(),k){let J=()=>{delete E.__boundDepthTexture,delete E.__depthDisposeCallback,k.removeEventListener("dispose",J)};k.addEventListener("dispose",J),E.__depthDisposeCallback=J}E.__boundDepthTexture=k}if(I.depthTexture&&!E.__autoAllocateDepthBuffer)if(Y)for(let k=0;k<6;k++)Vt(E.__webglFramebuffer[k],I,k);else{let k=I.texture.mipmaps;k&&k.length>0?Vt(E.__webglFramebuffer[0],I,0):Vt(E.__webglFramebuffer,I,0)}else if(Y){E.__webglDepthbuffer=[];for(let k=0;k<6;k++)if(e.bindFramebuffer(s.FRAMEBUFFER,E.__webglFramebuffer[k]),E.__webglDepthbuffer[k]===void 0)E.__webglDepthbuffer[k]=s.createRenderbuffer(),xt(E.__webglDepthbuffer[k],I,!1);else{let J=I.stencilBuffer?s.DEPTH_STENCIL_ATTACHMENT:s.DEPTH_ATTACHMENT,at=E.__webglDepthbuffer[k];s.bindRenderbuffer(s.RENDERBUFFER,at),s.framebufferRenderbuffer(s.FRAMEBUFFER,J,s.RENDERBUFFER,at)}}else{let k=I.texture.mipmaps;if(k&&k.length>0?e.bindFramebuffer(s.FRAMEBUFFER,E.__webglFramebuffer[0]):e.bindFramebuffer(s.FRAMEBUFFER,E.__webglFramebuffer),E.__webglDepthbuffer===void 0)E.__webglDepthbuffer=s.createRenderbuffer(),xt(E.__webglDepthbuffer,I,!1);else{let J=I.stencilBuffer?s.DEPTH_STENCIL_ATTACHMENT:s.DEPTH_ATTACHMENT,at=E.__webglDepthbuffer;s.bindRenderbuffer(s.RENDERBUFFER,at),s.framebufferRenderbuffer(s.FRAMEBUFFER,J,s.RENDERBUFFER,at)}}e.bindFramebuffer(s.FRAMEBUFFER,null)}function ct(I,E,Y){let k=n.get(I);E!==void 0&&dt(k.__webglFramebuffer,I,I.texture,s.COLOR_ATTACHMENT0,s.TEXTURE_2D,0),Y!==void 0&&nt(I)}function mt(I){let E=I.texture,Y=n.get(I),k=n.get(E);I.addEventListener("dispose",_);let J=I.textures,at=I.isWebGLCubeRenderTarget===!0,pt=J.length>1;if(pt||(k.__webglTexture===void 0&&(k.__webglTexture=s.createTexture()),k.__version=E.version,o.memory.textures++),at){Y.__webglFramebuffer=[];for(let tt=0;tt<6;tt++)if(E.mipmaps&&E.mipmaps.length>0){Y.__webglFramebuffer[tt]=[];for(let st=0;st<E.mipmaps.length;st++)Y.__webglFramebuffer[tt][st]=s.createFramebuffer()}else Y.__webglFramebuffer[tt]=s.createFramebuffer()}else{if(E.mipmaps&&E.mipmaps.length>0){Y.__webglFramebuffer=[];for(let tt=0;tt<E.mipmaps.length;tt++)Y.__webglFramebuffer[tt]=s.createFramebuffer()}else Y.__webglFramebuffer=s.createFramebuffer();if(pt)for(let tt=0,st=J.length;tt<st;tt++){let Mt=n.get(J[tt]);Mt.__webglTexture===void 0&&(Mt.__webglTexture=s.createTexture(),o.memory.textures++)}if(I.samples>0&&Yt(I)===!1){Y.__webglMultisampledFramebuffer=s.createFramebuffer(),Y.__webglColorRenderbuffer=[],e.bindFramebuffer(s.FRAMEBUFFER,Y.__webglMultisampledFramebuffer);for(let tt=0;tt<J.length;tt++){let st=J[tt];Y.__webglColorRenderbuffer[tt]=s.createRenderbuffer(),s.bindRenderbuffer(s.RENDERBUFFER,Y.__webglColorRenderbuffer[tt]);let Mt=r.convert(st.format,st.colorSpace),kt=r.convert(st.type),bt=y(st.internalFormat,Mt,kt,st.normalized,st.colorSpace,I.isXRRenderTarget===!0),Et=Wt(I);s.renderbufferStorageMultisample(s.RENDERBUFFER,Et,bt,I.width,I.height),s.framebufferRenderbuffer(s.FRAMEBUFFER,s.COLOR_ATTACHMENT0+tt,s.RENDERBUFFER,Y.__webglColorRenderbuffer[tt])}s.bindRenderbuffer(s.RENDERBUFFER,null),I.depthBuffer&&(Y.__webglDepthRenderbuffer=s.createRenderbuffer(),xt(Y.__webglDepthRenderbuffer,I,!0)),e.bindFramebuffer(s.FRAMEBUFFER,null)}}if(at){e.bindTexture(s.TEXTURE_CUBE_MAP,k.__webglTexture),ft(s.TEXTURE_CUBE_MAP,E);for(let tt=0;tt<6;tt++)if(E.mipmaps&&E.mipmaps.length>0)for(let st=0;st<E.mipmaps.length;st++)dt(Y.__webglFramebuffer[tt][st],I,E,s.COLOR_ATTACHMENT0,s.TEXTURE_CUBE_MAP_POSITIVE_X+tt,st);else dt(Y.__webglFramebuffer[tt],I,E,s.COLOR_ATTACHMENT0,s.TEXTURE_CUBE_MAP_POSITIVE_X+tt,0);g(E)&&v(s.TEXTURE_CUBE_MAP),e.unbindTexture()}else if(pt){for(let tt=0,st=J.length;tt<st;tt++){let Mt=J[tt],kt=n.get(Mt),bt=s.TEXTURE_2D;(I.isWebGL3DRenderTarget||I.isWebGLArrayRenderTarget)&&(bt=I.isWebGL3DRenderTarget?s.TEXTURE_3D:s.TEXTURE_2D_ARRAY),e.bindTexture(bt,kt.__webglTexture),ft(bt,Mt),dt(Y.__webglFramebuffer,I,Mt,s.COLOR_ATTACHMENT0+tt,bt,0),g(Mt)&&v(bt)}e.unbindTexture()}else{let tt=s.TEXTURE_2D;if((I.isWebGL3DRenderTarget||I.isWebGLArrayRenderTarget)&&(tt=I.isWebGL3DRenderTarget?s.TEXTURE_3D:s.TEXTURE_2D_ARRAY),e.bindTexture(tt,k.__webglTexture),ft(tt,E),E.mipmaps&&E.mipmaps.length>0)for(let st=0;st<E.mipmaps.length;st++)dt(Y.__webglFramebuffer[st],I,E,s.COLOR_ATTACHMENT0,tt,st);else dt(Y.__webglFramebuffer,I,E,s.COLOR_ATTACHMENT0,tt,0);g(E)&&v(tt),e.unbindTexture()}I.depthBuffer&&nt(I)}function gt(I){let E=I.textures;for(let Y=0,k=E.length;Y<k;Y++){let J=E[Y];if(g(J)){let at=b(I),pt=n.get(J).__webglTexture;e.bindTexture(at,pt),v(at),e.unbindTexture()}}}let vt=[],zt=[];function Ft(I){if(I.samples>0){if(Yt(I)===!1){let E=I.textures,Y=I.width,k=I.height,J=s.COLOR_BUFFER_BIT,at=I.stencilBuffer?s.DEPTH_STENCIL_ATTACHMENT:s.DEPTH_ATTACHMENT,pt=n.get(I),tt=E.length>1;if(tt)for(let Mt=0;Mt<E.length;Mt++)e.bindFramebuffer(s.FRAMEBUFFER,pt.__webglMultisampledFramebuffer),s.framebufferRenderbuffer(s.FRAMEBUFFER,s.COLOR_ATTACHMENT0+Mt,s.RENDERBUFFER,null),e.bindFramebuffer(s.FRAMEBUFFER,pt.__webglFramebuffer),s.framebufferTexture2D(s.DRAW_FRAMEBUFFER,s.COLOR_ATTACHMENT0+Mt,s.TEXTURE_2D,null,0);e.bindFramebuffer(s.READ_FRAMEBUFFER,pt.__webglMultisampledFramebuffer);let st=I.texture.mipmaps;st&&st.length>0?e.bindFramebuffer(s.DRAW_FRAMEBUFFER,pt.__webglFramebuffer[0]):e.bindFramebuffer(s.DRAW_FRAMEBUFFER,pt.__webglFramebuffer);for(let Mt=0;Mt<E.length;Mt++){if(I.resolveDepthBuffer&&(I.depthBuffer&&(J|=s.DEPTH_BUFFER_BIT),I.stencilBuffer&&I.resolveStencilBuffer&&(J|=s.STENCIL_BUFFER_BIT)),tt){s.framebufferRenderbuffer(s.READ_FRAMEBUFFER,s.COLOR_ATTACHMENT0,s.RENDERBUFFER,pt.__webglColorRenderbuffer[Mt]);let kt=n.get(E[Mt]).__webglTexture;s.framebufferTexture2D(s.DRAW_FRAMEBUFFER,s.COLOR_ATTACHMENT0,s.TEXTURE_2D,kt,0)}s.blitFramebuffer(0,0,Y,k,0,0,Y,k,J,s.NEAREST),l===!0&&(vt.length=0,zt.length=0,vt.push(s.COLOR_ATTACHMENT0+Mt),I.depthBuffer&&I.storeMultisampledDepthBuffer===!1&&(vt.push(at),zt.push(at),s.invalidateFramebuffer(s.DRAW_FRAMEBUFFER,zt)),s.invalidateFramebuffer(s.READ_FRAMEBUFFER,vt))}if(e.bindFramebuffer(s.READ_FRAMEBUFFER,null),e.bindFramebuffer(s.DRAW_FRAMEBUFFER,null),tt)for(let Mt=0;Mt<E.length;Mt++){e.bindFramebuffer(s.FRAMEBUFFER,pt.__webglMultisampledFramebuffer),s.framebufferRenderbuffer(s.FRAMEBUFFER,s.COLOR_ATTACHMENT0+Mt,s.RENDERBUFFER,pt.__webglColorRenderbuffer[Mt]);let kt=n.get(E[Mt]).__webglTexture;e.bindFramebuffer(s.FRAMEBUFFER,pt.__webglFramebuffer),s.framebufferTexture2D(s.DRAW_FRAMEBUFFER,s.COLOR_ATTACHMENT0+Mt,s.TEXTURE_2D,kt,0)}e.bindFramebuffer(s.DRAW_FRAMEBUFFER,pt.__webglMultisampledFramebuffer)}else if(I.depthBuffer&&I.storeMultisampledDepthBuffer===!1&&l){let E=I.stencilBuffer?s.DEPTH_STENCIL_ATTACHMENT:s.DEPTH_ATTACHMENT;s.invalidateFramebuffer(s.DRAW_FRAMEBUFFER,[E])}}}function Wt(I){return Math.min(i.maxSamples,I.samples)}function Yt(I){let E=n.get(I);return I.samples>0&&t.has("WEBGL_multisampled_render_to_texture")===!0&&E.__useRenderToTexture!==!1}function B(I){let E=o.render.frame;h.get(I)!==E&&(h.set(I,E),I.update())}function se(I,E){let Y=I.colorSpace,k=I.format,J=I.type;return I.isCompressedTexture===!0||I.isVideoTexture===!0||Y!==Mr&&Y!==ai&&(re.getTransfer(Y)===ue?(k!==nn||J!==dn)&&St("WebGLTextures: sRGB encoded textures have to use RGBAFormat and UnsignedByteType."):Bt("WebGLTextures: Unsupported texture color space:",Y)),E}function Kt(I){return typeof HTMLImageElement<"u"&&I instanceof HTMLImageElement?(c.width=I.naturalWidth||I.width,c.height=I.naturalHeight||I.height):typeof VideoFrame<"u"&&I instanceof VideoFrame?(c.width=I.displayWidth,c.height=I.displayHeight):(c.width=I.width,c.height=I.height),c}this.allocateTextureUnit=z,this.resetTextureUnits=F,this.getTextureUnits=C,this.setTextureUnits=N,this.setTexture2D=H,this.setTexture2DArray=U,this.setTexture3D=W,this.setTextureCube=Z,this.rebindTextures=ct,this.setupRenderTarget=mt,this.updateRenderTargetMipmap=gt,this.updateMultisampleRenderTarget=Ft,this.setupDepthRenderbuffer=nt,this.setupFrameBufferTexture=dt,this.useMultisampledRTT=Yt,this.isReversedDepthBuffer=function(){return e.buffers.depth.getReversed()}}function qg(s,t){function e(n,i=ai){let r,o=re.getTransfer(i);if(n===dn)return s.UNSIGNED_BYTE;if(n===rl)return s.UNSIGNED_SHORT_4_4_4_4;if(n===ol)return s.UNSIGNED_SHORT_5_5_5_1;if(n===Mu)return s.UNSIGNED_INT_5_9_9_9_REV;if(n===Su)return s.UNSIGNED_INT_10F_11F_11F_REV;if(n===yu)return s.BYTE;if(n===vu)return s.SHORT;if(n===Bs)return s.UNSIGNED_SHORT;if(n===sl)return s.INT;if(n===En)return s.UNSIGNED_INT;if(n===en)return s.FLOAT;if(n===Nn)return s.HALF_FLOAT;if(n===bu)return s.ALPHA;if(n===Eu)return s.RGB;if(n===nn)return s.RGBA;if(n===Vn)return s.DEPTH_COMPONENT;if(n===Ii)return s.DEPTH_STENCIL;if(n===al)return s.RED;if(n===eo)return s.RED_INTEGER;if(n===Pi)return s.RG;if(n===ll)return s.RG_INTEGER;if(n===cl)return s.RGBA_INTEGER;if(n===no||n===io||n===so||n===ro)if(o===ue)if(r=t.get("WEBGL_compressed_texture_s3tc_srgb"),r!==null){if(n===no)return r.COMPRESSED_SRGB_S3TC_DXT1_EXT;if(n===io)return r.COMPRESSED_SRGB_ALPHA_S3TC_DXT1_EXT;if(n===so)return r.COMPRESSED_SRGB_ALPHA_S3TC_DXT3_EXT;if(n===ro)return r.COMPRESSED_SRGB_ALPHA_S3TC_DXT5_EXT}else return null;else if(r=t.get("WEBGL_compressed_texture_s3tc"),r!==null){if(n===no)return r.COMPRESSED_RGB_S3TC_DXT1_EXT;if(n===io)return r.COMPRESSED_RGBA_S3TC_DXT1_EXT;if(n===so)return r.COMPRESSED_RGBA_S3TC_DXT3_EXT;if(n===ro)return r.COMPRESSED_RGBA_S3TC_DXT5_EXT}else return null;if(n===hl||n===ul||n===fl||n===dl)if(r=t.get("WEBGL_compressed_texture_pvrtc"),r!==null){if(n===hl)return r.COMPRESSED_RGB_PVRTC_4BPPV1_IMG;if(n===ul)return r.COMPRESSED_RGB_PVRTC_2BPPV1_IMG;if(n===fl)return r.COMPRESSED_RGBA_PVRTC_4BPPV1_IMG;if(n===dl)return r.COMPRESSED_RGBA_PVRTC_2BPPV1_IMG}else return null;if(n===pl||n===ml||n===gl||n===xl||n===_l||n===oo||n===yl)if(r=t.get("WEBGL_compressed_texture_etc"),r!==null){if(n===pl||n===ml)return o===ue?r.COMPRESSED_SRGB8_ETC2:r.COMPRESSED_RGB8_ETC2;if(n===gl)return o===ue?r.COMPRESSED_SRGB8_ALPHA8_ETC2_EAC:r.COMPRESSED_RGBA8_ETC2_EAC;if(n===xl)return r.COMPRESSED_R11_EAC;if(n===_l)return r.COMPRESSED_SIGNED_R11_EAC;if(n===oo)return r.COMPRESSED_RG11_EAC;if(n===yl)return r.COMPRESSED_SIGNED_RG11_EAC}else return null;if(n===vl||n===Ml||n===Sl||n===bl||n===El||n===Tl||n===wl||n===Al||n===Rl||n===Cl||n===Il||n===Pl||n===Ll||n===Dl)if(r=t.get("WEBGL_compressed_texture_astc"),r!==null){if(n===vl)return o===ue?r.COMPRESSED_SRGB8_ALPHA8_ASTC_4x4_KHR:r.COMPRESSED_RGBA_ASTC_4x4_KHR;if(n===Ml)return o===ue?r.COMPRESSED_SRGB8_ALPHA8_ASTC_5x4_KHR:r.COMPRESSED_RGBA_ASTC_5x4_KHR;if(n===Sl)return o===ue?r.COMPRESSED_SRGB8_ALPHA8_ASTC_5x5_KHR:r.COMPRESSED_RGBA_ASTC_5x5_KHR;if(n===bl)return o===ue?r.COMPRESSED_SRGB8_ALPHA8_ASTC_6x5_KHR:r.COMPRESSED_RGBA_ASTC_6x5_KHR;if(n===El)return o===ue?r.COMPRESSED_SRGB8_ALPHA8_ASTC_6x6_KHR:r.COMPRESSED_RGBA_ASTC_6x6_KHR;if(n===Tl)return o===ue?r.COMPRESSED_SRGB8_ALPHA8_ASTC_8x5_KHR:r.COMPRESSED_RGBA_ASTC_8x5_KHR;if(n===wl)return o===ue?r.COMPRESSED_SRGB8_ALPHA8_ASTC_8x6_KHR:r.COMPRESSED_RGBA_ASTC_8x6_KHR;if(n===Al)return o===ue?r.COMPRESSED_SRGB8_ALPHA8_ASTC_8x8_KHR:r.COMPRESSED_RGBA_ASTC_8x8_KHR;if(n===Rl)return o===ue?r.COMPRESSED_SRGB8_ALPHA8_ASTC_10x5_KHR:r.COMPRESSED_RGBA_ASTC_10x5_KHR;if(n===Cl)return o===ue?r.COMPRESSED_SRGB8_ALPHA8_ASTC_10x6_KHR:r.COMPRESSED_RGBA_ASTC_10x6_KHR;if(n===Il)return o===ue?r.COMPRESSED_SRGB8_ALPHA8_ASTC_10x8_KHR:r.COMPRESSED_RGBA_ASTC_10x8_KHR;if(n===Pl)return o===ue?r.COMPRESSED_SRGB8_ALPHA8_ASTC_10x10_KHR:r.COMPRESSED_RGBA_ASTC_10x10_KHR;if(n===Ll)return o===ue?r.COMPRESSED_SRGB8_ALPHA8_ASTC_12x10_KHR:r.COMPRESSED_RGBA_ASTC_12x10_KHR;if(n===Dl)return o===ue?r.COMPRESSED_SRGB8_ALPHA8_ASTC_12x12_KHR:r.COMPRESSED_RGBA_ASTC_12x12_KHR}else return null;if(n===Nl||n===Ul||n===Fl)if(r=t.get("EXT_texture_compression_bptc"),r!==null){if(n===Nl)return o===ue?r.COMPRESSED_SRGB_ALPHA_BPTC_UNORM_EXT:r.COMPRESSED_RGBA_BPTC_UNORM_EXT;if(n===Ul)return r.COMPRESSED_RGB_BPTC_SIGNED_FLOAT_EXT;if(n===Fl)return r.COMPRESSED_RGB_BPTC_UNSIGNED_FLOAT_EXT}else return null;if(n===Ol||n===Bl||n===ao||n===zl)if(r=t.get("EXT_texture_compression_rgtc"),r!==null){if(n===Ol)return r.COMPRESSED_RED_RGTC1_EXT;if(n===Bl)return r.COMPRESSED_SIGNED_RED_RGTC1_EXT;if(n===ao)return r.COMPRESSED_RED_GREEN_RGTC2_EXT;if(n===zl)return r.COMPRESSED_SIGNED_RED_GREEN_RGTC2_EXT}else return null;return n===zs?s.UNSIGNED_INT_24_8:s[n]!==void 0?s[n]:null}return{convert:e}}var T1=`
void main() {

	gl_Position = vec4( position, 1.0 );

}`,w1=`
uniform sampler2DArray depthColor;
uniform float depthWidth;
uniform float depthHeight;

void main() {

	vec2 coord = vec2( gl_FragCoord.x / depthWidth, gl_FragCoord.y / depthHeight );

	if ( coord.x >= 1.0 ) {

		gl_FragDepth = texture( depthColor, vec3( coord.x - 1.0, coord.y, 1 ) ).r;

	} else {

		gl_FragDepth = texture( depthColor, vec3( coord.x, coord.y, 0 ) ).r;

	}

}`,ep=class{constructor(){this.texture=null,this.mesh=null,this.depthNear=0,this.depthFar=0}init(t,e){if(this.texture===null){let n=new Ir(t.texture);(t.depthNear!==e.depthNear||t.depthFar!==e.depthFar)&&(this.depthNear=t.depthNear,this.depthFar=t.depthFar),this.texture=n}}getMesh(t){if(this.texture!==null&&this.mesh===null){let e=t.cameras[0].viewport,n=new un({vertexShader:T1,fragmentShader:w1,uniforms:{depthColor:{value:this.texture},depthWidth:{value:e.z},depthHeight:{value:e.w}}});this.mesh=new ce(new wi(20,20),n)}return this.mesh}reset(){this.texture=null,this.mesh=null}getDepthTexture(){return this.texture}},np=class extends _n{constructor(t,e){super();let n=this,i=null,r=1,o=null,a="local-floor",l=1,c=null,h=null,f=null,u=null,d=null,p=null,x=typeof XRWebGLBinding<"u",m=new ep,g={},v=e.getContextAttributes(),b=null,y=null,M=[],S=[],w=new rt,_=null,T=null,R=new Oe;R.viewport=new ge;let L=new Oe;L.viewport=new ge;let D=[R,L],F=new $a,C=null,N=null;this.cameraAutoUpdate=!0,this.enabled=!1,this.isPresenting=!1,this.getController=function(G){let Q=M[G];return Q===void 0&&(Q=new Es,M[G]=Q),Q.getTargetRaySpace()},this.getControllerGrip=function(G){let Q=M[G];return Q===void 0&&(Q=new Es,M[G]=Q),Q.getGripSpace()},this.getHand=function(G){let Q=M[G];return Q===void 0&&(Q=new Es,M[G]=Q),Q.getHandSpace()};function z(G){let Q=S.indexOf(G.inputSource);if(Q===-1)return;let lt=M[Q];lt!==void 0&&(lt.update(G.inputSource,G.frame,c||o),lt.dispatchEvent({type:G.type,data:G.inputSource}))}function O(){i.removeEventListener("select",z),i.removeEventListener("selectstart",z),i.removeEventListener("selectend",z),i.removeEventListener("squeeze",z),i.removeEventListener("squeezestart",z),i.removeEventListener("squeezeend",z),i.removeEventListener("end",O),i.removeEventListener("inputsourceschange",H);for(let G=0;G<M.length;G++){let Q=S[G];Q!==null&&(S[G]=null,M[G].disconnect(Q))}C=null,N=null,m.reset();for(let G in g)delete g[G];if(t.setRenderTarget(b),d=null,u=null,f=null,i=null,y=null,ht.stop(),n.isPresenting=!1,t.setPixelRatio(_),t.setSize(w.width,w.height,!1),T!==null){let G=T.camera;G.fov=T.fov,G.zoom=T.zoom,G.updateProjectionMatrix(),T=null}n.dispatchEvent({type:"sessionend"})}this.setFramebufferScaleFactor=function(G){r=G,n.isPresenting===!0&&St("WebXRManager: Cannot change framebuffer scale while presenting.")},this.setReferenceSpaceType=function(G){a=G,n.isPresenting===!0&&St("WebXRManager: Cannot change reference space type while presenting.")},this.getReferenceSpace=function(){return c||o},this.setReferenceSpace=function(G){c=G},this.getBaseLayer=function(){return u!==null?u:d},this.getBinding=function(){return f===null&&x&&(f=new XRWebGLBinding(i,e)),f},this.getFrame=function(){return p},this.getSession=function(){return i},this.setSession=async function(G){if(i=G,i!==null){if(b=t.getRenderTarget(),i.addEventListener("select",z),i.addEventListener("selectstart",z),i.addEventListener("selectend",z),i.addEventListener("squeeze",z),i.addEventListener("squeezestart",z),i.addEventListener("squeezeend",z),i.addEventListener("end",O),i.addEventListener("inputsourceschange",H),v.xrCompatible!==!0&&await e.makeXRCompatible(),_=t.getPixelRatio(),t.getSize(w),x&&"createProjectionLayer"in XRWebGLBinding.prototype){let lt=null,yt=null,dt=null;v.depth&&(dt=v.stencil?e.DEPTH24_STENCIL8:e.DEPTH_COMPONENT24,lt=v.stencil?Ii:Vn,yt=v.stencil?zs:En);let xt={colorFormat:e.RGBA8,depthFormat:dt,scaleFactor:r};f=this.getBinding(),u=f.createProjectionLayer(xt),i.updateRenderState({layers:[u]}),t.setPixelRatio(1),t.setSize(u.textureWidth,u.textureHeight,!1),y=new Je(u.textureWidth,u.textureHeight,{format:nn,type:dn,depthTexture:new bi(u.textureWidth,u.textureHeight,yt,void 0,void 0,void 0,void 0,void 0,void 0,lt),stencilBuffer:v.stencil,colorSpace:t.outputColorSpace,samples:v.antialias?4:0,resolveDepthBuffer:u.ignoreDepthValues===!1,resolveStencilBuffer:u.ignoreDepthValues===!1,storeMultisampledDepthBuffer:u.ignoreDepthValues===!1,storeMultisampledStencilBuffer:u.ignoreDepthValues===!1})}else{let lt={antialias:v.antialias,alpha:!0,depth:v.depth,stencil:v.stencil,framebufferScaleFactor:r};d=new XRWebGLLayer(i,e,lt),i.updateRenderState({baseLayer:d}),t.setPixelRatio(1),t.setSize(d.framebufferWidth,d.framebufferHeight,!1),y=new Je(d.framebufferWidth,d.framebufferHeight,{format:nn,type:dn,colorSpace:t.outputColorSpace,stencilBuffer:v.stencil,resolveDepthBuffer:d.ignoreDepthValues===!1,resolveStencilBuffer:d.ignoreDepthValues===!1,storeMultisampledDepthBuffer:d.ignoreDepthValues===!1,storeMultisampledStencilBuffer:d.ignoreDepthValues===!1})}y.isXRRenderTarget=!0,this.setFoveation(l),c=null,o=await i.requestReferenceSpace(a),ht.setContext(i),ht.start(),n.isPresenting=!0,n.dispatchEvent({type:"sessionstart"})}},this.getEnvironmentBlendMode=function(){if(i!==null)return i.environmentBlendMode},this.getDepthTexture=function(){return m.getDepthTexture()};function H(G){for(let Q=0;Q<G.removed.length;Q++){let lt=G.removed[Q],yt=S.indexOf(lt);yt>=0&&(S[yt]=null,M[yt].disconnect(lt))}for(let Q=0;Q<G.added.length;Q++){let lt=G.added[Q],yt=S.indexOf(lt);if(yt===-1){for(let xt=0;xt<M.length;xt++)if(xt>=S.length){S.push(lt),yt=xt;break}else if(S[xt]===null){S[xt]=lt,yt=xt;break}if(yt===-1)break}let dt=M[yt];dt&&dt.connect(lt)}}let U=new P,W=new P;function Z(G,Q,lt){U.setFromMatrixPosition(Q.matrixWorld),W.setFromMatrixPosition(lt.matrixWorld);let yt=U.distanceTo(W),dt=Q.projectionMatrix.elements,xt=lt.projectionMatrix.elements,Vt=dt[14]/(dt[10]-1),nt=dt[14]/(dt[10]+1),ct=(dt[9]+1)/dt[5],mt=(dt[9]-1)/dt[5],gt=(dt[8]-1)/dt[0],vt=(xt[8]+1)/xt[0],zt=Vt*gt,Ft=Vt*vt,Wt=yt/(-gt+vt),Yt=Wt*-gt;if(Q.matrixWorld.decompose(G.position,G.quaternion,G.scale),G.translateX(Yt),G.translateZ(Wt),G.matrixWorld.compose(G.position,G.quaternion,G.scale),G.matrixWorldInverse.copy(G.matrixWorld).invert(),dt[10]===-1)G.projectionMatrix.copy(Q.projectionMatrix),G.projectionMatrixInverse.copy(Q.projectionMatrixInverse);else{let B=Vt+Wt,se=nt+Wt,Kt=zt-Yt,I=Ft+(yt-Yt),E=ct*nt/se*B,Y=mt*nt/se*B;G.projectionMatrix.makePerspective(Kt,I,E,Y,B,se),G.projectionMatrixInverse.copy(G.projectionMatrix).invert()}}function j(G,Q){Q===null?G.matrixWorld.copy(G.matrix):G.matrixWorld.multiplyMatrices(Q.matrixWorld,G.matrix),G.matrixWorldInverse.copy(G.matrixWorld).invert()}this.updateCamera=function(G){if(i===null)return;let Q=G.near,lt=G.far;m.texture!==null&&(m.depthNear>0&&(Q=m.depthNear),m.depthFar>0&&(lt=m.depthFar)),F.near=L.near=R.near=Q,F.far=L.far=R.far=lt,(C!==F.near||N!==F.far)&&(i.updateRenderState({depthNear:F.near,depthFar:F.far}),C=F.near,N=F.far),F.layers.mask=G.layers.mask|6,R.layers.mask=F.layers.mask&-5,L.layers.mask=F.layers.mask&-3;let yt=G.parent,dt=F.cameras;j(F,yt);for(let xt=0;xt<dt.length;xt++)j(dt[xt],yt);dt.length===2?Z(F,R,L):F.projectionMatrix.copy(R.projectionMatrix),T===null&&G.isPerspectiveCamera&&(T={camera:G,fov:G.fov,zoom:G.zoom}),q(G,F,yt)};function q(G,Q,lt){lt===null?G.matrix.copy(Q.matrixWorld):(G.matrix.copy(lt.matrixWorld),G.matrix.invert(),G.matrix.multiply(Q.matrixWorld)),G.matrix.decompose(G.position,G.quaternion,G.scale),G.updateMatrixWorld(!0),G.projectionMatrix.copy(Q.projectionMatrix),G.projectionMatrixInverse.copy(Q.projectionMatrixInverse),G.isPerspectiveCamera&&(G.fov=vs*2*Math.atan(1/G.projectionMatrix.elements[5]),G.zoom=1)}this.getCamera=function(){return F},this.getFoveation=function(){if(!(u===null&&d===null))return l},this.setFoveation=function(G){l=G,u!==null&&(u.fixedFoveation=G),d!==null&&d.fixedFoveation!==void 0&&(d.fixedFoveation=G)},this.hasDepthSensing=function(){return m.texture!==null},this.getDepthSensingMesh=function(){return m.getMesh(F)},this.getCameraTexture=function(G){return g[G]};let it=null;function ft(G,Q){if(h=Q.getViewerPose(c||o),p=Q,h!==null){let lt=h.views;d!==null&&(t.setRenderTargetFramebuffer(y,d.framebuffer),t.setRenderTarget(y));let yt=!1;lt.length!==F.cameras.length&&(F.cameras.length=0,yt=!0);for(let nt=0;nt<lt.length;nt++){let ct=lt[nt],mt=null;if(d!==null)mt=d.getViewport(ct);else{let vt=f.getViewSubImage(u,ct);mt=vt.viewport,nt===0&&(t.setRenderTargetTextures(y,vt.colorTexture,vt.depthStencilTexture),t.setRenderTarget(y))}let gt=D[nt];gt===void 0&&(gt=new Oe,gt.layers.enable(nt),gt.viewport=new ge,D[nt]=gt),gt.matrix.fromArray(ct.transform.matrix),gt.matrix.decompose(gt.position,gt.quaternion,gt.scale),gt.projectionMatrix.fromArray(ct.projectionMatrix),gt.projectionMatrixInverse.copy(gt.projectionMatrix).invert(),gt.viewport.set(mt.x,mt.y,mt.width,mt.height),nt===0&&(F.matrix.copy(gt.matrix),F.matrix.decompose(F.position,F.quaternion,F.scale)),yt===!0&&F.cameras.push(gt)}let dt=i.enabledFeatures;if(dt&&dt.includes("depth-sensing")&&i.depthUsage=="gpu-optimized"&&x){f=n.getBinding();let nt=f.getDepthInformation(lt[0]);nt&&nt.isValid&&nt.texture&&m.init(nt,i.renderState)}if(dt&&dt.includes("camera-access")&&x){t.state.unbindTexture(),f=n.getBinding();for(let nt=0;nt<lt.length;nt++){let ct=lt[nt].camera;if(ct){let mt=g[ct];mt||(mt=new Ir,g[ct]=mt);let gt=f.getCameraImage(ct);mt.sourceTexture=gt}}}}for(let lt=0;lt<M.length;lt++){let yt=S[lt],dt=M[lt];yt!==null&&dt!==void 0&&dt.update(yt,Q,c||o)}it&&it(G,Q),Q.detectedPlanes&&n.dispatchEvent({type:"planesdetected",data:Q}),p=null}let ht=new kg;ht.setAnimationLoop(ft),this.setAnimationLoop=function(G){it=G},this.dispose=function(){}}},A1=new Jt,Yg=new jt;Yg.set(-1,0,0,0,1,0,0,0,1);function R1(s,t){function e(m,g){m.matrixAutoUpdate===!0&&m.updateMatrix(),g.value.copy(m.matrix)}function n(m,g){g.color.getRGB(m.fogColor.value,Ld(s)),g.isFog?(m.fogNear.value=g.near,m.fogFar.value=g.far):g.isFogExp2&&(m.fogDensity.value=g.density)}function i(m,g,v,b,y){g.isNodeMaterial?g.uniformsNeedUpdate=!1:g.isMeshBasicMaterial?r(m,g):g.isMeshLambertMaterial?(r(m,g),g.envMap&&(m.envMapIntensity.value=g.envMapIntensity)):g.isMeshToonMaterial?(r(m,g),f(m,g)):g.isMeshPhongMaterial?(r(m,g),h(m,g),g.envMap&&(m.envMapIntensity.value=g.envMapIntensity)):g.isMeshStandardMaterial?(r(m,g),u(m,g),g.isMeshPhysicalMaterial&&d(m,g,y)):g.isMeshMatcapMaterial?(r(m,g),p(m,g)):g.isMeshDepthMaterial?r(m,g):g.isMeshDistanceMaterial?(r(m,g),x(m,g)):g.isMeshNormalMaterial?r(m,g):g.isLineBasicMaterial?(o(m,g),g.isLineDashedMaterial&&a(m,g)):g.isPointsMaterial?l(m,g,v,b):g.isSpriteMaterial?c(m,g):g.isShadowMaterial?(m.color.value.copy(g.color),m.opacity.value=g.opacity):g.isShaderMaterial&&(g.uniformsNeedUpdate=!1)}function r(m,g){m.opacity.value=g.opacity,g.color&&m.diffuse.value.copy(g.color),g.emissive&&m.emissive.value.copy(g.emissive).multiplyScalar(g.emissiveIntensity),g.map&&(m.map.value=g.map,e(g.map,m.mapTransform)),g.alphaMap&&(m.alphaMap.value=g.alphaMap,e(g.alphaMap,m.alphaMapTransform)),g.bumpMap&&(m.bumpMap.value=g.bumpMap,e(g.bumpMap,m.bumpMapTransform),m.bumpScale.value=g.bumpScale,g.side===rn&&(m.bumpScale.value*=-1)),g.normalMap&&(m.normalMap.value=g.normalMap,e(g.normalMap,m.normalMapTransform),m.normalScale.value.copy(g.normalScale),g.side===rn&&m.normalScale.value.negate()),g.displacementMap&&(m.displacementMap.value=g.displacementMap,e(g.displacementMap,m.displacementMapTransform),m.displacementScale.value=g.displacementScale,m.displacementBias.value=g.displacementBias),g.emissiveMap&&(m.emissiveMap.value=g.emissiveMap,e(g.emissiveMap,m.emissiveMapTransform)),g.specularMap&&(m.specularMap.value=g.specularMap,e(g.specularMap,m.specularMapTransform)),g.alphaTest>0&&(m.alphaTest.value=g.alphaTest);let v=t.get(g),b=v.envMap,y=v.envMapRotation;b&&(m.envMap.value=b,m.envMapRotation.value.setFromMatrix4(A1.makeRotationFromEuler(y)).transpose(),b.isCubeTexture&&b.isRenderTargetTexture===!1&&m.envMapRotation.value.premultiply(Yg),m.reflectivity.value=g.reflectivity,m.ior.value=g.ior,m.refractionRatio.value=g.refractionRatio),g.lightMap&&(m.lightMap.value=g.lightMap,m.lightMapIntensity.value=g.lightMapIntensity,e(g.lightMap,m.lightMapTransform)),g.aoMap&&(m.aoMap.value=g.aoMap,m.aoMapIntensity.value=g.aoMapIntensity,e(g.aoMap,m.aoMapTransform))}function o(m,g){m.diffuse.value.copy(g.color),m.opacity.value=g.opacity,g.map&&(m.map.value=g.map,e(g.map,m.mapTransform))}function a(m,g){m.dashSize.value=g.dashSize,m.totalSize.value=g.dashSize+g.gapSize,m.scale.value=g.scale}function l(m,g,v,b){m.diffuse.value.copy(g.color),m.opacity.value=g.opacity,m.size.value=g.size*v,m.scale.value=b*.5,g.map&&(m.map.value=g.map,e(g.map,m.uvTransform)),g.alphaMap&&(m.alphaMap.value=g.alphaMap,e(g.alphaMap,m.alphaMapTransform)),g.alphaTest>0&&(m.alphaTest.value=g.alphaTest)}function c(m,g){m.diffuse.value.copy(g.color),m.opacity.value=g.opacity,m.rotation.value=g.rotation,g.map&&(m.map.value=g.map,e(g.map,m.mapTransform)),g.alphaMap&&(m.alphaMap.value=g.alphaMap,e(g.alphaMap,m.alphaMapTransform)),g.alphaTest>0&&(m.alphaTest.value=g.alphaTest)}function h(m,g){m.specular.value.copy(g.specular),m.shininess.value=Math.max(g.shininess,1e-4)}function f(m,g){g.gradientMap&&(m.gradientMap.value=g.gradientMap)}function u(m,g){m.metalness.value=g.metalness,g.metalnessMap&&(m.metalnessMap.value=g.metalnessMap,e(g.metalnessMap,m.metalnessMapTransform)),m.roughness.value=g.roughness,g.roughnessMap&&(m.roughnessMap.value=g.roughnessMap,e(g.roughnessMap,m.roughnessMapTransform)),g.envMap&&(m.envMapIntensity.value=g.envMapIntensity)}function d(m,g,v){m.ior.value=g.ior,g.sheen>0&&(m.sheenColor.value.copy(g.sheenColor).multiplyScalar(g.sheen),m.sheenRoughness.value=g.sheenRoughness,g.sheenColorMap&&(m.sheenColorMap.value=g.sheenColorMap,e(g.sheenColorMap,m.sheenColorMapTransform)),g.sheenRoughnessMap&&(m.sheenRoughnessMap.value=g.sheenRoughnessMap,e(g.sheenRoughnessMap,m.sheenRoughnessMapTransform))),g.clearcoat>0&&(m.clearcoat.value=g.clearcoat,m.clearcoatRoughness.value=g.clearcoatRoughness,g.clearcoatMap&&(m.clearcoatMap.value=g.clearcoatMap,e(g.clearcoatMap,m.clearcoatMapTransform)),g.clearcoatRoughnessMap&&(m.clearcoatRoughnessMap.value=g.clearcoatRoughnessMap,e(g.clearcoatRoughnessMap,m.clearcoatRoughnessMapTransform)),g.clearcoatNormalMap&&(m.clearcoatNormalMap.value=g.clearcoatNormalMap,e(g.clearcoatNormalMap,m.clearcoatNormalMapTransform),m.clearcoatNormalScale.value.copy(g.clearcoatNormalScale),g.side===rn&&m.clearcoatNormalScale.value.negate())),g.dispersion>0&&(m.dispersion.value=g.dispersion),g.retroreflectivity>0&&(m.retroreflectivity.value=g.retroreflectivity),g.iridescence>0&&(m.iridescence.value=g.iridescence,m.iridescenceIOR.value=g.iridescenceIOR,m.iridescenceThicknessMinimum.value=g.iridescenceThicknessRange[0],m.iridescenceThicknessMaximum.value=g.iridescenceThicknessRange[1],g.iridescenceMap&&(m.iridescenceMap.value=g.iridescenceMap,e(g.iridescenceMap,m.iridescenceMapTransform)),g.iridescenceThicknessMap&&(m.iridescenceThicknessMap.value=g.iridescenceThicknessMap,e(g.iridescenceThicknessMap,m.iridescenceThicknessMapTransform))),g.transmission>0&&(m.transmission.value=g.transmission,m.transmissionSamplerMap.value=v.texture,m.transmissionSamplerSize.value.set(v.width,v.height),g.transmissionMap&&(m.transmissionMap.value=g.transmissionMap,e(g.transmissionMap,m.transmissionMapTransform)),m.thickness.value=g.thickness,g.thicknessMap&&(m.thicknessMap.value=g.thicknessMap,e(g.thicknessMap,m.thicknessMapTransform)),m.attenuationDistance.value=g.attenuationDistance,m.attenuationColor.value.copy(g.attenuationColor)),g.anisotropy>0&&(m.anisotropyVector.value.set(g.anisotropy*Math.cos(g.anisotropyRotation),g.anisotropy*Math.sin(g.anisotropyRotation)),g.anisotropyMap&&(m.anisotropyMap.value=g.anisotropyMap,e(g.anisotropyMap,m.anisotropyMapTransform))),m.specularIntensity.value=g.specularIntensity,m.specularColor.value.copy(g.specularColor),g.specularColorMap&&(m.specularColorMap.value=g.specularColorMap,e(g.specularColorMap,m.specularColorMapTransform)),g.specularIntensityMap&&(m.specularIntensityMap.value=g.specularIntensityMap,e(g.specularIntensityMap,m.specularIntensityMapTransform))}function p(m,g){g.matcap&&(m.matcap.value=g.matcap)}function x(m,g){let v=t.get(g).light;m.referencePosition.value.setFromMatrixPosition(v.matrixWorld),m.nearDistance.value=v.shadow.camera.near,m.farDistance.value=v.shadow.camera.far}return{refreshFogUniforms:n,refreshMaterialUniforms:i}}function C1(s,t,e,n){let i={},r={},o=[],a=s.getParameter(s.MAX_UNIFORM_BUFFER_BINDINGS);function l(y,M){let S=M.program;n.uniformBlockBinding(y,S)}function c(y,M){let S=i[y.id];S===void 0&&(m(y),S=h(y),i[y.id]=S,y.addEventListener("dispose",v));let w=M.program;n.updateUBOMapping(y,w);let _=t.render.frame;r[y.id]!==_&&(u(y),r[y.id]=_)}function h(y){let M=f();y.__bindingPointIndex=M;let S=s.createBuffer(),w=y.__size,_=y.usage;return s.bindBuffer(s.UNIFORM_BUFFER,S),s.bufferData(s.UNIFORM_BUFFER,w,_),s.bindBuffer(s.UNIFORM_BUFFER,null),s.bindBufferBase(s.UNIFORM_BUFFER,M,S),S}function f(){for(let y=0;y<a;y++)if(o.indexOf(y)===-1)return o.push(y),y;return Bt("WebGLRenderer: Maximum number of simultaneously usable uniforms groups reached."),0}function u(y){let M=i[y.id],S=y.uniforms,w=y.__cache;s.bindBuffer(s.UNIFORM_BUFFER,M);for(let _=0,T=S.length;_<T;_++){let R=S[_];if(Array.isArray(R))for(let L=0,D=R.length;L<D;L++)d(R[L],_,L,w);else d(R,_,0,w)}s.bindBuffer(s.UNIFORM_BUFFER,null)}function d(y,M,S,w){if(x(y,M,S,w)===!0){let _=y.__offset,T=y.value;if(Array.isArray(T)){let R=0;for(let L=0;L<T.length;L++){let D=T[L],F=g(D);p(D,y.__data,R),typeof D!="number"&&typeof D!="boolean"&&!D.isMatrix3&&!ArrayBuffer.isView(D)&&(R+=F.storage/Float32Array.BYTES_PER_ELEMENT)}}else p(T,y.__data,0);s.bufferSubData(s.UNIFORM_BUFFER,_,y.__data)}}function p(y,M,S){typeof y=="number"||typeof y=="boolean"?M[0]=y:y.isMatrix3?(M[0]=y.elements[0],M[1]=y.elements[1],M[2]=y.elements[2],M[3]=0,M[4]=y.elements[3],M[5]=y.elements[4],M[6]=y.elements[5],M[7]=0,M[8]=y.elements[6],M[9]=y.elements[7],M[10]=y.elements[8],M[11]=0):ArrayBuffer.isView(y)?M.set(new y.constructor(y.buffer,y.byteOffset,M.length)):y.toArray(M,S)}function x(y,M,S,w){let _=y.value,T=M+"_"+S;if(w[T]===void 0)return typeof _=="number"||typeof _=="boolean"?w[T]=_:ArrayBuffer.isView(_)?w[T]=_.slice():w[T]=_.clone(),!0;{let R=w[T];if(typeof _=="number"||typeof _=="boolean"){if(R!==_)return w[T]=_,!0}else{if(ArrayBuffer.isView(_))return!0;if(R.equals(_)===!1)return R.copy(_),!0}}return!1}function m(y){let M=y.uniforms,S=0,w=16;for(let T=0,R=M.length;T<R;T++){let L=Array.isArray(M[T])?M[T]:[M[T]];for(let D=0,F=L.length;D<F;D++){let C=L[D],N=Array.isArray(C.value)?C.value:[C.value];for(let z=0,O=N.length;z<O;z++){let H=N[z],U=g(H),W=S%w,Z=W%U.boundary,j=W+Z;S+=Z,j!==0&&w-j<U.storage&&(S+=w-j),C.__data=new Float32Array(U.storage/Float32Array.BYTES_PER_ELEMENT),C.__offset=S,S+=U.storage}}}let _=S%w;return _>0&&(S+=w-_),y.__size=S,y.__cache={},this}function g(y){let M={boundary:0,storage:0};return typeof y=="number"||typeof y=="boolean"?(M.boundary=4,M.storage=4):y.isVector2?(M.boundary=8,M.storage=8):y.isVector3||y.isColor?(M.boundary=16,M.storage=12):y.isVector4?(M.boundary=16,M.storage=16):y.isMatrix3?(M.boundary=48,M.storage=48):y.isMatrix4?(M.boundary=64,M.storage=64):y.isTexture?St("WebGLRenderer: Texture samplers can not be part of an uniforms group."):ArrayBuffer.isView(y)?(M.boundary=16,M.storage=y.byteLength):St("WebGLRenderer: Unsupported uniform value type.",y),M}function v(y){let M=y.target;M.removeEventListener("dispose",v);let S=o.indexOf(M.__bindingPointIndex);o.splice(S,1),s.deleteBuffer(i[M.id]),delete i[M.id],delete r[M.id]}function b(){for(let y in i)s.deleteBuffer(i[y]);o=[],i={},r={}}return{bind:l,update:c,dispose:b}}var I1=new Uint16Array([12469,15057,12620,14925,13266,14620,13807,14376,14323,13990,14545,13625,14713,13328,14840,12882,14931,12528,14996,12233,15039,11829,15066,11525,15080,11295,15085,10976,15082,10705,15073,10495,13880,14564,13898,14542,13977,14430,14158,14124,14393,13732,14556,13410,14702,12996,14814,12596,14891,12291,14937,11834,14957,11489,14958,11194,14943,10803,14921,10506,14893,10278,14858,9960,14484,14039,14487,14025,14499,13941,14524,13740,14574,13468,14654,13106,14743,12678,14818,12344,14867,11893,14889,11509,14893,11180,14881,10751,14852,10428,14812,10128,14765,9754,14712,9466,14764,13480,14764,13475,14766,13440,14766,13347,14769,13070,14786,12713,14816,12387,14844,11957,14860,11549,14868,11215,14855,10751,14825,10403,14782,10044,14729,9651,14666,9352,14599,9029,14967,12835,14966,12831,14963,12804,14954,12723,14936,12564,14917,12347,14900,11958,14886,11569,14878,11247,14859,10765,14828,10401,14784,10011,14727,9600,14660,9289,14586,8893,14508,8533,15111,12234,15110,12234,15104,12216,15092,12156,15067,12010,15028,11776,14981,11500,14942,11205,14902,10752,14861,10393,14812,9991,14752,9570,14682,9252,14603,8808,14519,8445,14431,8145,15209,11449,15208,11451,15202,11451,15190,11438,15163,11384,15117,11274,15055,10979,14994,10648,14932,10343,14871,9936,14803,9532,14729,9218,14645,8742,14556,8381,14461,8020,14365,7603,15273,10603,15272,10607,15267,10619,15256,10631,15231,10614,15182,10535,15118,10389,15042,10167,14963,9787,14883,9447,14800,9115,14710,8665,14615,8318,14514,7911,14411,7507,14279,7198,15314,9675,15313,9683,15309,9712,15298,9759,15277,9797,15229,9773,15166,9668,15084,9487,14995,9274,14898,8910,14800,8539,14697,8234,14590,7790,14479,7409,14367,7067,14178,6621,15337,8619,15337,8631,15333,8677,15325,8769,15305,8871,15264,8940,15202,8909,15119,8775,15022,8565,14916,8328,14804,8009,14688,7614,14569,7287,14448,6888,14321,6483,14088,6171,15350,7402,15350,7419,15347,7480,15340,7613,15322,7804,15287,7973,15229,8057,15148,8012,15046,7846,14933,7611,14810,7357,14682,7069,14552,6656,14421,6316,14251,5948,14007,5528,15356,5942,15356,5977,15353,6119,15348,6294,15332,6551,15302,6824,15249,7044,15171,7122,15070,7050,14949,6861,14818,6611,14679,6349,14538,6067,14398,5651,14189,5311,13935,4958,15359,4123,15359,4153,15356,4296,15353,4646,15338,5160,15311,5508,15263,5829,15188,6042,15088,6094,14966,6001,14826,5796,14678,5543,14527,5287,14377,4985,14133,4586,13869,4257,15360,1563,15360,1642,15358,2076,15354,2636,15341,3350,15317,4019,15273,4429,15203,4732,15105,4911,14981,4932,14836,4818,14679,4621,14517,4386,14359,4156,14083,3795,13808,3437,15360,122,15360,137,15358,285,15355,636,15344,1274,15322,2177,15281,2765,15215,3223,15120,3451,14995,3569,14846,3567,14681,3466,14511,3305,14344,3121,14037,2800,13753,2467,15360,0,15360,1,15359,21,15355,89,15346,253,15325,479,15287,796,15225,1148,15133,1492,15008,1749,14856,1882,14685,1886,14506,1783,14324,1608,13996,1398,13702,1183]),li=null;function P1(){return li===null&&(li=new hn(I1,16,16,Pi,Nn),li.name="DFG_LUT",li.minFilter=le,li.magFilter=le,li.wrapS=Ce,li.wrapT=Ce,li.generateMipmaps=!1,li.needsUpdate=!0),li}var ip=class{constructor(t={}){let{canvas:e=Cd(),context:n=null,depth:i=!0,stencil:r=!1,alpha:o=!1,antialias:a=!1,premultipliedAlpha:l=!0,preserveDrawingBuffer:c=!1,powerPreference:h="default",failIfMajorPerformanceCaveat:f=!1,reversedDepthBuffer:u=!1,outputBufferType:d=dn}=t;this.isWebGLRenderer=!0;let p;if(n!==null){if(typeof WebGLRenderingContext<"u"&&n instanceof WebGLRenderingContext)throw new Error("THREE.WebGLRenderer: WebGL 1 is not supported since r163.");p=n.getContextAttributes().alpha}else p=o;let x=d,m=new Set([cl,ll,eo]),g=new Set([dn,En,Bs,zs,rl,ol]),v=new Uint32Array(4),b=new Int32Array(4),y=new P,M=null,S=null,w=[],_=[],T=null;this.domElement=e,this.debug={checkShaderErrors:!0,diagnostics:{keywords:!1},onShaderError:null},this.autoClear=!0,this.autoClearColor=!0,this.autoClearDepth=!0,this.autoClearStencil=!0,this.sortObjects=!0,this.clippingPlanes=[],this.localClippingEnabled=!1,this.toneMapping=Dn,this.toneMappingExposure=1,this.transmissionResolutionScale=1;let R=this,L=!1,D=null,F=null,C=null,N=null;this._outputColorSpace=Ee;let z=0,O=0,H=null,U=-1,W=null,Z=new ge,j=new ge,q=null,it=new _t(0),ft=0,ht=e.width,G=e.height,Q=1,lt=null,yt=null,dt=new ge(0,0,ht,G),xt=new ge(0,0,ht,G),Vt=!1,nt=new ni,ct=!1,mt=!1,gt=new Jt,vt=new P,zt=new ge,Ft={background:null,fog:null,environment:null,overrideMaterial:null,isScene:!0},Wt=!1;function Yt(){return H===null?Q:1}let B=n;function se(A,V){return e.getContext(A,V)}let Kt,I,E,Y,k,J,at,pt,tt,st,Mt,kt,bt,Et,Ht,Zt,te,X,Tt,ot,wt,Pt,ut;try{let A={alpha:!0,depth:i,stencil:r,antialias:a,premultipliedAlpha:l,preserveDrawingBuffer:c,powerPreference:h,failIfMajorPerformanceCaveat:f};if("setAttribute"in e&&e.setAttribute("data-engine",`three.js r${nl}`),e.addEventListener("webglcontextlost",ve,!1),e.addEventListener("webglcontextrestored",de,!1),e.addEventListener("webglcontextcreationerror",Un,!1),B===null){let V="webgl2";if(B=se(V,A),B===null)throw se(V)?new Error("THREE.WebGLRenderer: Error creating WebGL context with your selected attributes."):new Error("THREE.WebGLRenderer: Error creating WebGL context.")}Xt()}catch(A){throw e.removeEventListener("webglcontextlost",ve,!1),e.removeEventListener("webglcontextrestored",de,!1),e.removeEventListener("webglcontextcreationerror",Un,!1),Bt("WebGLRenderer: "+A.message),A}function Xt(){Kt=new zS(B),Kt.init(),wt=new qg(B,Kt),I=new CS(B,Kt,t,wt),E=new b1(B,Kt),I.reversedDepthBuffer&&u&&E.buffers.depth.setReversed(!0),F=B.createFramebuffer(),C=B.createFramebuffer(),N=B.createFramebuffer(),Y=new VS(B),k=new c1,J=new E1(B,Kt,E,k,I,wt,Y),at=new BS(R),pt=new Wy(B),Pt=new AS(B,pt),tt=new kS(B,pt,Y,Pt),st=new WS(B,tt,pt,Pt,Y),X=new HS(B,I,J),Ht=new IS(k),Mt=new l1(R,at,Kt,I,Pt,Ht),kt=new R1(R,k),bt=new u1,Et=new x1(Kt),te=new wS(R,at,E,st,p,l),Zt=new S1(R,st,I),ut=new C1(B,Y,I,E),Tt=new RS(B,Kt,Y),ot=new GS(B,Kt,Y),Y.programs=Mt.programs,R.capabilities=I,R.extensions=Kt,R.properties=k,R.renderLists=bt,R.shadowMap=Zt,R.state=E,R.info=Y}x!==dn&&(T=new qS(x,e.width,e.height,a,i,r));let Ot=new np(R,B);this.xr=Ot,this.getContext=function(){return B},this.getContextAttributes=function(){return B.getContextAttributes()},this.forceContextLoss=function(){let A=Kt.get("WEBGL_lose_context");A&&A.loseContext()},this.forceContextRestore=function(){let A=Kt.get("WEBGL_lose_context");A&&A.restoreContext()},this.getPixelRatio=function(){return Q},this.setPixelRatio=function(A){A!==void 0&&(Q=A,this.setSize(ht,G,!1))},this.getSize=function(A){return A.set(ht,G)},this.setSize=function(A,V,et=!0){if(Ot.isPresenting){St("WebGLRenderer: Can't change size while VR device is presenting.");return}ht=A,G=V,e.width=Math.floor(A*Q),e.height=Math.floor(V*Q),et===!0&&(e.style.width=A+"px",e.style.height=V+"px"),T!==null&&T.setSize(e.width,e.height),this.setViewport(0,0,A,V)},this.getDrawingBufferSize=function(A){return A.set(ht*Q,G*Q).floor()},this.setDrawingBufferSize=function(A,V,et){ht=A,G=V,Q=et,e.width=Math.floor(A*et),e.height=Math.floor(V*et),this.setViewport(0,0,A,V)},this.setEffects=function(A){if(x===dn){Bt("WebGLRenderer: setEffects() requires outputBufferType set to HalfFloatType or FloatType.");return}if(A){for(let V=0;V<A.length;V++)if(A[V].isOutputPass===!0){St("WebGLRenderer: OutputPass is not needed in setEffects(). Tone mapping and color space conversion are applied automatically.");break}}T.setEffects(A||[])},this.getCurrentViewport=function(A){return A.copy(Z)},this.getViewport=function(A){return A.copy(dt)},this.setViewport=function(A,V,et,$){A.isVector4?dt.set(A.x,A.y,A.z,A.w):dt.set(A,V,et,$),E.viewport(Z.copy(dt).multiplyScalar(Q).round())},this.getScissor=function(A){return A.copy(xt)},this.setScissor=function(A,V,et,$){A.isVector4?xt.set(A.x,A.y,A.z,A.w):xt.set(A,V,et,$),E.scissor(j.copy(xt).multiplyScalar(Q).round())},this.getScissorTest=function(){return Vt},this.setScissorTest=function(A){E.setScissorTest(Vt=A)},this.setOpaqueSort=function(A){lt=A},this.setTransparentSort=function(A){yt=A},this.getClearColor=function(A){return A.copy(te.getClearColor())},this.setClearColor=function(){te.setClearColor(...arguments)},this.getClearAlpha=function(){return te.getClearAlpha()},this.setClearAlpha=function(){te.setClearAlpha(...arguments)},this.clear=function(A=!0,V=!0,et=!0){let $=0;if(A){let K=!1;if(H!==null){let It=H.texture.format;K=m.has(It)}if(K){let It=H.texture.type,Dt=g.has(It),Ct=te.getClearColor(),Nt=te.getClearAlpha(),Gt=Ct.r,ie=Ct.g,oe=Ct.b;Dt?(v[0]=Gt,v[1]=ie,v[2]=oe,v[3]=Nt,B.clearBufferuiv(B.COLOR,0,v)):(b[0]=Gt,b[1]=ie,b[2]=oe,b[3]=Nt,B.clearBufferiv(B.COLOR,0,b))}else $|=B.COLOR_BUFFER_BIT}V&&($|=B.DEPTH_BUFFER_BIT,this.state.buffers.depth.setMask(!0)),et&&($|=B.STENCIL_BUFFER_BIT,this.state.buffers.stencil.setMask(4294967295)),$!==0&&B.clear($)},this.clearColor=function(){this.clear(!0,!1,!1)},this.clearDepth=function(){this.clear(!1,!0,!1)},this.clearStencil=function(){this.clear(!1,!1,!0)},this.setNodesHandler=function(A){A.setRenderer(this),D=A},this.dispose=function(){e.removeEventListener("webglcontextlost",ve,!1),e.removeEventListener("webglcontextrestored",de,!1),e.removeEventListener("webglcontextcreationerror",Un,!1),te.dispose(),bt.dispose(),Et.dispose(),k.dispose(),at.dispose(),st.dispose(),Pt.dispose(),ut.dispose(),Mt.dispose(),Ot.dispose(),Ot.removeEventListener("sessionstart",vp),Ot.removeEventListener("sessionend",Mp),rs.stop()};function ve(A){A.preventDefault(),Er("WebGLRenderer: Context Lost."),L=!0}function de(){Er("WebGLRenderer: Context Restored."),L=!1;let A=Y.autoReset,V=Zt.enabled,et=Zt.autoUpdate,$=Zt.needsUpdate,K=Zt.type;Xt(),Y.autoReset=A,Zt.enabled=V,Zt.autoUpdate=et,Zt.needsUpdate=$,Zt.type=K}function Un(A){Bt("WebGLRenderer: A WebGL context could not be created. Reason: ",A.statusMessage)}function Kn(A){let V=A.target;V.removeEventListener("dispose",Kn),kx(V)}function kx(A){Gx(A),k.remove(A)}function Gx(A){let V=k.get(A).programs;V!==void 0&&(V.forEach(function(et){Mt.releaseProgram(et)}),A.isShaderMaterial&&Mt.releaseShaderCache(A))}this.renderBufferDirect=function(A,V,et,$,K,It){V===null&&(V=Ft);let Dt=K.isMesh&&K.matrixWorld.determinantAffine()<0,Ct=Wx(A,V,et,$,K);E.setMaterial($,Dt);let Nt=et.index,Gt=1;if($.wireframe===!0){if(Nt=tt.getWireframeAttribute(et),Nt===void 0)return;Gt=2}let ie=et.drawRange,oe=et.attributes.position,Ut=ie.start*Gt,pe=(ie.start+ie.count)*Gt;It!==null&&(Ut=Math.max(Ut,It.start*Gt),pe=Math.min(pe,(It.start+It.count)*Gt)),Nt!==null?(Ut=Math.max(Ut,0),pe=Math.min(pe,Nt.count)):oe!=null&&(Ut=Math.max(Ut,0),pe=Math.min(pe,oe.count));let Ue=pe-Ut;if(Ue<0||Ue===1/0)return;Pt.setup(K,$,Ct,et,Nt);let Se,_e=Tt;if(Nt!==null&&(Se=pt.get(Nt),_e=ot,_e.setIndex(Se)),K.isMesh)$.wireframe===!0?(E.setLineWidth($.wireframeLinewidth*Yt()),_e.setMode(B.LINES)):_e.setMode(B.TRIANGLES);else if(K.isLine){let Ke=$.linewidth;Ke===void 0&&(Ke=1),E.setLineWidth(Ke*Yt()),K.isLineSegments?_e.setMode(B.LINES):K.isLineLoop?_e.setMode(B.LINE_LOOP):_e.setMode(B.LINE_STRIP)}else K.isPoints?_e.setMode(B.POINTS):K.isSprite&&_e.setMode(B.TRIANGLES);if(K.isBatchedMesh)if(Kt.get("WEBGL_multi_draw"))_e.renderMultiDraw(K._multiDrawStarts,K._multiDrawCounts,K._multiDrawCount);else{let Ke=K._multiDrawStarts,Lt=K._multiDrawCounts,an=K._multiDrawCount,he=Nt?pt.get(Nt).bytesPerElement:1,Tn=k.get($).currentProgram.getUniforms();for(let Qn=0;Qn<an;Qn++)Tn.setValue(B,"_gl_DrawID",Qn),_e.render(Ke[Qn]/he,Lt[Qn])}else if(K.isInstancedMesh)_e.renderInstances(Ut,Ue,K.count);else if(et.isInstancedBufferGeometry){let Ke=et._maxInstanceCount!==void 0?et._maxInstanceCount:1/0,Lt=Math.min(et.instanceCount,Ke);_e.renderInstances(Ut,Ue,Lt)}else _e.render(Ut,Ue)};function yp(A,V,et,$){D!==null&&A.isNodeMaterial&&D.setObject($,A),ct===!0&&Ht.setState(A,et,!1),A.transparent===!0&&A.side===Ne&&A.forceSinglePass===!1?(A.side=rn,A.needsUpdate=!0,ic(A,V,$),A.side=Ri,A.needsUpdate=!0,ic(A,V,$),A.side=Ne):ic(A,V,$)}this.compile=function(A,V,et=null){et===null&&(et=A),D!==null&&D.renderStart(A,V,et),S=Et.get(et),S.init(V),_.push(S),et.traverseVisible(function(K){K.isLight&&K.layers.test(V.layers)&&(S.pushLight(K),K.castShadow&&S.pushShadow(K))}),A!==et&&A.traverseVisible(function(K){K.isLight&&K.layers.test(V.layers)&&(S.pushLight(K),K.castShadow&&S.pushShadow(K))}),S.setupLights(),D!==null&&D.updateLights(S.state.lightsArray),mt=this.localClippingEnabled,ct=Ht.init(this.clippingPlanes,mt),ct===!0&&Ht.setGlobalState(this.clippingPlanes,V),D!==null&&Zt.render(S.state.shadowsArray,et,V);let $=new Set;return A.traverse(function(K){if(!(K.isMesh||K.isPoints||K.isLine||K.isSprite))return;let It=K.material;if(It)if(Array.isArray(It))for(let Dt=0;Dt<It.length;Dt++){let Ct=It[Dt];yp(Ct,et,V,K),$.add(Ct)}else yp(It,et,V,K),$.add(It)}),S=_.pop(),D!==null&&D.renderEnd(),$},this.compileAsync=function(A,V,et=null){let $=this.compile(A,V,et);return new Promise(K=>{function It(){if($.forEach(function(Dt){let Nt=k.get(Dt).currentProgram;(Nt===void 0||Nt.isReady())&&$.delete(Dt)}),$.size===0){K(A);return}setTimeout(It,10)}Kt.get("KHR_parallel_shader_compile")!==null?It():setTimeout(It,10)})};let Gu=null;function Vx(A){Gu&&Gu(A)}function vp(){rs.stop()}function Mp(){rs.start()}let rs=new kg;rs.setAnimationLoop(Vx),typeof self<"u"&&rs.setContext(self),this.setAnimationLoop=function(A){Gu=A,Ot.setAnimationLoop(A),A===null?rs.stop():rs.start()},Ot.addEventListener("sessionstart",vp),Ot.addEventListener("sessionend",Mp),this.render=function(A,V){if(V!==void 0&&V.isCamera!==!0){Bt("WebGLRenderer.render: camera is not an instance of THREE.Camera.");return}if(L===!0)return;D!==null&&D.renderStart(A,V);let et=Ot.enabled===!0&&Ot.isPresenting===!0,$=T!==null&&(H===null||et)&&T.begin(R,H);if(A.matrixWorldAutoUpdate===!0&&A.updateMatrixWorld(),V.parent===null&&V.matrixWorldAutoUpdate===!0&&V.updateMatrixWorld(),Ot.enabled===!0&&Ot.isPresenting===!0&&(T===null||T.isCompositing()===!1)&&(Ot.cameraAutoUpdate===!0&&Ot.updateCamera(V),V=Ot.getCamera()),A.isScene===!0&&A.onBeforeRender(R,A,V,H),S=Et.get(A,_.length),S.init(V),S.state.textureUnits=J.getTextureUnits(),_.push(S),gt.multiplyMatrices(V.projectionMatrix,V.matrixWorldInverse),nt.setFromProjectionMatrix(gt,xn,V.reversedDepth),mt=this.localClippingEnabled,ct=Ht.init(this.clippingPlanes,mt),M=bt.get(A,w.length),M.init(),w.push(M),Ot.enabled===!0&&Ot.isPresenting===!0){let Dt=R.xr.getDepthSensingMesh();Dt!==null&&Vu(Dt,V,-1/0,R.sortObjects)}Vu(A,V,0,R.sortObjects),M.finish(),D!==null&&D.updateLights(S.state.lightsArray),R.sortObjects===!0&&M.sort(lt,yt),Wt=Ot.enabled===!1||Ot.isPresenting===!1||Ot.hasDepthSensing()===!1,Wt&&te.addToRenderList(M,A),this.info.render.frame++,this.info.autoReset===!0&&this.info.reset(),ct===!0&&Ht.beginShadows();let K=S.state.shadowsArray;if(Zt.render(K,A,V),ct===!0&&Ht.endShadows(),($&&T.hasRenderPass())===!1){let Dt=M.opaque,Ct=M.transmissive;if(S.setupLights(),V.isArrayCamera){let Nt=V.cameras;if(Ct.length>0)for(let Gt=0,ie=Nt.length;Gt<ie;Gt++){let oe=Nt[Gt];bp(Dt,Ct,A,oe)}Wt&&te.render(A);for(let Gt=0,ie=Nt.length;Gt<ie;Gt++){let oe=Nt[Gt];Sp(M,A,oe,oe.viewport)}}else Ct.length>0&&bp(Dt,Ct,A,V),Wt&&te.render(A),Sp(M,A,V)}H!==null&&O===0&&(J.updateMultisampleRenderTarget(H),J.updateRenderTargetMipmap(H)),$&&T.end(R),A.isScene===!0&&A.onAfterRender(R,A,V),Pt.resetDefaultState(),U=-1,W=null,_.pop(),_.length>0?(S=_[_.length-1],J.setTextureUnits(S.state.textureUnits),ct===!0&&Ht.setGlobalState(R.clippingPlanes,S.state.camera)):S=null,w.pop(),w.length>0?M=w[w.length-1]:M=null,D!==null&&D.renderEnd()};function Vu(A,V,et,$){if(A.visible===!1)return;if(A.layers.test(V.layers)){if(A.isGroup)et=A.renderOrder;else if(A.isLOD)A.autoUpdate===!0&&A.update(V);else if(A.isLightProbeGrid)S.pushLightProbeGrid(A);else if(A.isLight)S.pushLight(A),A.castShadow&&S.pushShadow(A);else if(A.isSprite){if(!A.frustumCulled||A.intersectsFrustum(nt)){$&&zt.setFromMatrixPosition(A.matrixWorld).applyMatrix4(gt);let Dt=st.update(A),Ct=A.material;Ct.visible&&M.push(A,Dt,Ct,et,zt.z,null,V)}}else if((A.isMesh||A.isLine||A.isPoints)&&(!A.frustumCulled||A.intersectsFrustum(nt))){let Dt=st.update(A),Ct=A.material;if($&&(A.boundingSphere!==void 0?(A.boundingSphere===null&&A.computeBoundingSphere(),zt.copy(A.boundingSphere.center)):(Dt.boundingSphere===null&&Dt.computeBoundingSphere(),zt.copy(Dt.boundingSphere.center)),zt.applyMatrix4(A.matrixWorld).applyMatrix4(gt)),Array.isArray(Ct)){let Nt=Dt.groups;for(let Gt=0,ie=Nt.length;Gt<ie;Gt++){let oe=Nt[Gt],Ut=Ct[oe.materialIndex];Ut&&Ut.visible&&M.push(A,Dt,Ut,et,zt.z,oe,V)}}else Ct.visible&&M.push(A,Dt,Ct,et,zt.z,null,V)}}let It=A.children;for(let Dt=0,Ct=It.length;Dt<Ct;Dt++)Vu(It[Dt],V,et,$)}function Sp(A,V,et,$){let{opaque:K,transmissive:It,transparent:Dt}=A;S.setupLightsView(et),ct===!0&&Ht.setGlobalState(R.clippingPlanes,et),$&&E.viewport(Z.copy($)),K.length>0&&nc(K,V,et),It.length>0&&nc(It,V,et),Dt.length>0&&nc(Dt,V,et),E.buffers.depth.setTest(!0),E.buffers.depth.setMask(!0),E.buffers.color.setMask(!0),E.setPolygonOffset(!1)}function bp(A,V,et,$){if((et.isScene===!0?et.overrideMaterial:null)!==null)return;if(S.state.transmissionRenderTarget[$.id]===void 0){let Ut=Kt.has("EXT_color_buffer_half_float")||Kt.has("EXT_color_buffer_float");S.state.transmissionRenderTarget[$.id]=new Je(1,1,{generateMipmaps:!0,type:Ut?Nn:dn,minFilter:Ve,samples:Math.max(4,I.samples),stencilBuffer:r,resolveDepthBuffer:!1,resolveStencilBuffer:!1,storeMultisampledDepthBuffer:!1,storeMultisampledStencilBuffer:!1,colorSpace:re.workingColorSpace})}let It=S.state.transmissionRenderTarget[$.id],Dt=$.viewport||Z;It.setSize(Dt.z*R.transmissionResolutionScale,Dt.w*R.transmissionResolutionScale);let Ct=R.getRenderTarget(),Nt=R.getActiveCubeFace(),Gt=R.getActiveMipmapLevel();R.setRenderTarget(It),R.getClearColor(it),ft=R.getClearAlpha(),ft<1&&R.setClearColor(16777215,.5),R.clear(),Wt&&te.render(et);let ie=R.toneMapping;R.toneMapping=Dn;let oe=$.viewport;if($.viewport!==void 0&&($.viewport=void 0),S.setupLightsView($),ct===!0&&Ht.setGlobalState(R.clippingPlanes,$),nc(A,et,$),J.updateMultisampleRenderTarget(It),J.updateRenderTargetMipmap(It),Kt.has("WEBGL_multisampled_render_to_texture")===!1){let Ut=!1;for(let pe=0,Ue=V.length;pe<Ue;pe++){let Se=V[pe],{object:_e,geometry:Ke,material:Lt,group:an}=Se;if(Lt.side===Ne&&_e.layers.test($.layers)){let he=Lt.side;Lt.side=rn,Lt.needsUpdate=!0,Ep(_e,et,$,Ke,Lt,an),Lt.side=he,Lt.needsUpdate=!0,Ut=!0}}Ut===!0&&(J.updateMultisampleRenderTarget(It),J.updateRenderTargetMipmap(It))}R.setRenderTarget(Ct,Nt,Gt),R.setClearColor(it,ft),oe!==void 0&&($.viewport=oe),R.toneMapping=ie}function nc(A,V,et){let $=V.isScene===!0?V.overrideMaterial:null;for(let K=0,It=A.length;K<It;K++){let Dt=A[K],{object:Ct,geometry:Nt,group:Gt}=Dt,ie=Dt.material;ie.allowOverride===!0&&$!==null&&(ie=$),Ct.layers.test(et.layers)&&Ep(Ct,V,et,Nt,ie,Gt)}}function Ep(A,V,et,$,K,It){D!==null&&K.isNodeMaterial&&D.setObject(A,K),A.onBeforeRender(R,V,et,$,K,It),A.modelViewMatrix.multiplyMatrices(et.matrixWorldInverse,A.matrixWorld),A.normalMatrix.getNormalMatrix(A.modelViewMatrix),K.onBeforeRender(R,V,et,$,A,It),K.transparent===!0&&K.side===Ne&&K.forceSinglePass===!1?(K.side=rn,K.needsUpdate=!0,R.renderBufferDirect(et,V,$,K,A,It),K.side=Ri,K.needsUpdate=!0,R.renderBufferDirect(et,V,$,K,A,It),K.side=Ne):R.renderBufferDirect(et,V,$,K,A,It),A.onAfterRender(R,V,et,$,K,It)}function ic(A,V,et){V.isScene!==!0&&(V=Ft);let $=k.get(A),K=S.state.lights,It=S.state.shadowsArray,Dt=K.state.version,Ct=Mt.getParameters(A,K.state,It,V,et,S.state.lightProbeGridArray),Nt=Mt.getProgramCacheKey(Ct),Gt=$.programs;$.environment=A.isMeshStandardMaterial||A.isMeshLambertMaterial||A.isMeshPhongMaterial?V.environment:null,$.fog=V.fog;let ie=A.isMeshStandardMaterial||A.isMeshLambertMaterial&&!A.envMap||A.isMeshPhongMaterial&&!A.envMap;$.envMap=at.get(A.envMap||$.environment,ie),$.envMapRotation=$.environment!==null&&A.envMap===null?V.environmentRotation:A.envMapRotation,Gt===void 0&&(A.addEventListener("dispose",Kn),Gt=new Map,$.programs=Gt);let oe=Gt.get(Nt);if(oe!==void 0){if($.currentProgram===oe&&$.lightsStateVersion===Dt)return wp(A,Ct),oe}else Ct.uniforms=Mt.getUniforms(A),D!==null&&A.isNodeMaterial&&D.build(A,et,Ct),A.onBeforeCompile(Ct,R),oe=Mt.acquireProgram(Ct,Nt),Gt.set(Nt,oe),$.uniforms=Ct.uniforms;let Ut=$.uniforms;return(!A.isShaderMaterial&&!A.isRawShaderMaterial||A.clipping===!0)&&(Ut.clippingPlanes=Ht.uniform),wp(A,Ct),$.needsLights=qx(A),$.lightsStateVersion=Dt,$.needsLights&&(Ut.ambientLightColor.value=K.state.ambient,Ut.lightProbe.value=K.state.probe,Ut.sunLights.value=K.state.sun,Ut.sunLightShadows.value=K.state.sunShadow,Ut.directionalLights.value=K.state.directional,Ut.directionalLightShadows.value=K.state.directionalShadow,Ut.spotLights.value=K.state.spot,Ut.spotLightShadows.value=K.state.spotShadow,Ut.rectAreaLights.value=K.state.rectArea,Ut.ltc_1.value=K.state.rectAreaLTC1,Ut.ltc_2.value=K.state.rectAreaLTC2,Ut.pointLights.value=K.state.point,Ut.pointLightShadows.value=K.state.pointShadow,Ut.hemisphereLights.value=K.state.hemi,Ut.sunShadowMatrix.value=K.state.sunShadowMatrix,Ut.sunShadowCascade.value=K.state.sunShadowCascade,Ut.directionalShadowMatrix.value=K.state.directionalShadowMatrix,Ut.spotLightMatrix.value=K.state.spotLightMatrix,Ut.spotLightMap.value=K.state.spotLightMap,Ut.pointShadowMatrix.value=K.state.pointShadowMatrix),$.lightProbeGrid=S.state.lightProbeGridArray.length>0,$.currentProgram=oe,$.uniformsList=null,oe}function Tp(A){if(A.uniformsList===null){let V=A.currentProgram.getUniforms();A.uniformsList=ho.seqWithValue(V.seq,A.uniforms)}return A.uniformsList}function wp(A,V){let et=k.get(A);et.outputColorSpace=V.outputColorSpace,et.batching=V.batching,et.batchingColor=V.batchingColor,et.instancing=V.instancing,et.instancingColor=V.instancingColor,et.instancingMorph=V.instancingMorph,et.skinning=V.skinning,et.morphTargets=V.morphTargets,et.morphNormals=V.morphNormals,et.morphColors=V.morphColors,et.morphTargetsCount=V.morphTargetsCount,et.numClippingPlanes=V.numClippingPlanes,et.numIntersection=V.numClipIntersection,et.vertexAlphas=V.vertexAlphas,et.vertexTangents=V.vertexTangents,et.toneMapping=V.toneMapping}function Hx(A,V){if(A.length===0)return null;if(A.length===1)return A[0].texture!==null?A[0]:null;y.setFromMatrixPosition(V.matrixWorld);for(let et=0,$=A.length;et<$;et++){let K=A[et];if(K.texture!==null&&K.boundingBox.containsPoint(y))return K}return null}function Wx(A,V,et,$,K){V.isScene!==!0&&(V=Ft),J.resetTextureUnits();let It=V.fog,Dt=$.isMeshStandardMaterial||$.isMeshLambertMaterial||$.isMeshPhongMaterial?V.environment:null,Ct=H===null?R.outputColorSpace:H.isXRRenderTarget===!0?H.texture.colorSpace:re.workingColorSpace,Nt=$.isMeshStandardMaterial||$.isMeshLambertMaterial&&!$.envMap||$.isMeshPhongMaterial&&!$.envMap,Gt=at.get($.envMap||Dt,Nt),ie=$.vertexColors===!0&&!!et.attributes.color&&et.attributes.color.itemSize===4,oe=!!et.attributes.tangent&&(!!$.normalMap||$.anisotropy>0),Ut=!!et.morphAttributes.position,pe=!!et.morphAttributes.normal,Ue=!!et.morphAttributes.color,Se=Dn;$.toneMapped&&(H===null||H.isXRRenderTarget===!0)&&(Se=R.toneMapping);let _e=et.morphAttributes.position||et.morphAttributes.normal||et.morphAttributes.color,Ke=_e!==void 0?_e.length:0,Lt=k.get($),an=S.state.lights;if(ct===!0&&(mt===!0||A!==W)){let Me=A===W&&$.id===U;Ht.setState($,A,Me)}let he=!1;$.version===Lt.__version?(Lt.needsLights&&Lt.lightsStateVersion!==an.state.version||Lt.outputColorSpace!==Ct||K.isBatchedMesh&&Lt.batching===!1||!K.isBatchedMesh&&Lt.batching===!0||K.isBatchedMesh&&Lt.batchingColor===!0&&K._colorsTexture===null||K.isBatchedMesh&&Lt.batchingColor===!1&&K._colorsTexture!==null||K.isInstancedMesh&&Lt.instancing===!1||!K.isInstancedMesh&&Lt.instancing===!0||K.isSkinnedMesh&&Lt.skinning===!1||!K.isSkinnedMesh&&Lt.skinning===!0||K.isInstancedMesh&&Lt.instancingColor===!0&&K.instanceColor===null||K.isInstancedMesh&&Lt.instancingColor===!1&&K.instanceColor!==null||K.isInstancedMesh&&Lt.instancingMorph===!0&&K.morphTexture===null||K.isInstancedMesh&&Lt.instancingMorph===!1&&K.morphTexture!==null||Lt.envMap!==Gt||$.fog===!0&&Lt.fog!==It||Lt.numClippingPlanes!==void 0&&(Lt.numClippingPlanes!==Ht.numPlanes||Lt.numIntersection!==Ht.numIntersection)||Lt.vertexAlphas!==ie||Lt.vertexTangents!==oe||Lt.morphTargets!==Ut||Lt.morphNormals!==pe||Lt.morphColors!==Ue||Lt.toneMapping!==Se||Lt.morphTargetsCount!==Ke||!!Lt.lightProbeGrid!=S.state.lightProbeGridArray.length>0)&&(he=!0):(he=!0,Lt.__version=$.version);let Tn=Lt.currentProgram;he===!0&&(Tn=ic($,V,K),D&&$.isNodeMaterial&&D.onUpdateProgram($,Tn,Lt));let Qn=!1,Li=!1,Xs=!1,xe=Tn.getUniforms(),Le=Lt.uniforms;if(E.useProgram(Tn.program)&&(Qn=!0,Li=!0,Xs=!0),$.id!==U&&(U=$.id,Li=!0),Lt.needsLights){let Me=Hx(S.state.lightProbeGridArray,K);Lt.lightProbeGrid!==Me&&(Lt.lightProbeGrid=Me,Li=!0)}if(Qn||W!==A){E.buffers.depth.getReversed()&&A.reversedDepth!==!0&&(A._reversedDepth=!0,A.updateProjectionMatrix()),xe.setValue(B,"projectionMatrix",A.projectionMatrix),xe.setValue(B,"viewMatrix",A.matrixWorldInverse);let Ni=xe.map.cameraPosition;Ni!==void 0&&Ni.setValue(B,vt.setFromMatrixPosition(A.matrixWorld)),I.logarithmicDepthBuffer&&xe.setValue(B,"logDepthBufFC",2/(Math.log(A.far+1)/Math.LN2)),($.isMeshPhongMaterial||$.isMeshToonMaterial||$.isMeshLambertMaterial||$.isMeshBasicMaterial||$.isMeshStandardMaterial||$.isShaderMaterial)&&xe.setValue(B,"isOrthographic",A.isOrthographicCamera===!0),W!==A&&(W=A,Li=!0,Xs=!0)}if(Lt.needsLights&&(an.state.sunShadowMap.length>0&&xe.setValue(B,"sunShadowMap",an.state.sunShadowMap,J),an.state.directionalShadowMap.length>0&&xe.setValue(B,"directionalShadowMap",an.state.directionalShadowMap,J),an.state.spotShadowMap.length>0&&xe.setValue(B,"spotShadowMap",an.state.spotShadowMap,J),an.state.pointShadowMap.length>0&&xe.setValue(B,"pointShadowMap",an.state.pointShadowMap,J)),K.isSkinnedMesh){xe.setOptional(B,K,"bindMatrix"),xe.setOptional(B,K,"bindMatrixInverse");let Me=K.skeleton;Me&&(Me.boneTexture===null&&Me.computeBoneTexture(),xe.setValue(B,"boneTexture",Me.boneTexture,J))}K.isBatchedMesh&&(xe.setOptional(B,K,"batchingTexture"),xe.setValue(B,"batchingTexture",K._matricesTexture,J),xe.setOptional(B,K,"batchingIdTexture"),xe.setValue(B,"batchingIdTexture",K._indirectTexture,J),xe.setOptional(B,K,"batchingColorTexture"),K._colorsTexture!==null&&xe.setValue(B,"batchingColorTexture",K._colorsTexture,J));let Di=et.morphAttributes;if((Di.position!==void 0||Di.normal!==void 0||Di.color!==void 0)&&X.update(K,et,Tn),(Li||Lt.receiveShadow!==K.receiveShadow)&&(Lt.receiveShadow=K.receiveShadow,xe.setValue(B,"receiveShadow",K.receiveShadow)),($.isMeshStandardMaterial||$.isMeshLambertMaterial||$.isMeshPhongMaterial)&&$.envMap===null&&V.environment!==null&&(Le.envMapIntensity.value=V.environmentIntensity),Le.dfgLUT!==void 0&&(Le.dfgLUT.value=P1()),Li){if(xe.setValue(B,"toneMappingExposure",R.toneMappingExposure),Lt.needsLights&&Xx(Le,Xs),It&&$.fog===!0&&kt.refreshFogUniforms(Le,It),kt.refreshMaterialUniforms(Le,$,Q,G,S.state.transmissionRenderTarget[A.id]),Lt.needsLights&&Lt.lightProbeGrid){let Me=Lt.lightProbeGrid;Le.probesSH.value=Me.texture,Le.probesMin.value.copy(Me.boundingBox.min),Le.probesMax.value.copy(Me.boundingBox.max),Le.probesResolution.value.copy(Me.resolution)}ho.upload(B,Tp(Lt),Le,J)}if($.isShaderMaterial&&$.uniformsNeedUpdate===!0&&(ho.upload(B,Tp(Lt),Le,J),$.uniformsNeedUpdate=!1),$.isSpriteMaterial&&xe.setValue(B,"center",K.center),xe.setValue(B,"modelViewMatrix",K.modelViewMatrix),xe.setValue(B,"normalMatrix",K.normalMatrix),xe.setValue(B,"modelMatrix",K.matrixWorld),$.uniformsGroups!==void 0){let Me=$.uniformsGroups;for(let Ni=0,qs=Me.length;Ni<qs;Ni++){let Rp=Me[Ni];ut.update(Rp,Tn),ut.bind(Rp,Tn)}}return Tn}function Xx(A,V){A.ambientLightColor.needsUpdate=V,A.lightProbe.needsUpdate=V,A.sunLights.needsUpdate=V,A.sunLightShadows.needsUpdate=V,A.directionalLights.needsUpdate=V,A.directionalLightShadows.needsUpdate=V,A.pointLights.needsUpdate=V,A.pointLightShadows.needsUpdate=V,A.spotLights.needsUpdate=V,A.spotLightShadows.needsUpdate=V,A.rectAreaLights.needsUpdate=V,A.hemisphereLights.needsUpdate=V}function qx(A){return A.isMeshLambertMaterial||A.isMeshToonMaterial||A.isMeshPhongMaterial||A.isMeshStandardMaterial||A.isShadowMaterial||A.isShaderMaterial&&A.lights===!0}this.getActiveCubeFace=function(){return z},this.getActiveMipmapLevel=function(){return O},this.getRenderTarget=function(){return H},this.setRenderTargetTextures=function(A,V,et){let $=k.get(A);$.__autoAllocateDepthBuffer=A.resolveDepthBuffer===!1,$.__autoAllocateDepthBuffer===!1&&($.__useRenderToTexture=!1),k.get(A.texture).__webglTexture=V,k.get(A.depthTexture).__webglTexture=$.__autoAllocateDepthBuffer?void 0:et,$.__hasExternalTextures=!0},this.setRenderTargetFramebuffer=function(A,V){let et=k.get(A);et.__webglFramebuffer=V,et.__useDefaultFramebuffer=V===void 0},this.setRenderTarget=function(A,V=0,et=0){H=A,z=V,O=et;let $=null,K=!1,It=!1;if(A){let Ct=k.get(A);if(Ct.__useDefaultFramebuffer!==void 0){E.bindFramebuffer(B.FRAMEBUFFER,Ct.__webglFramebuffer),Z.copy(A.viewport),j.copy(A.scissor),q=A.scissorTest,E.viewport(Z),E.scissor(j),E.setScissorTest(q),U=-1;return}else if(Ct.__webglFramebuffer===void 0)J.setupRenderTarget(A);else if(Ct.__hasExternalTextures)J.rebindTextures(A,k.get(A.texture).__webglTexture,k.get(A.depthTexture).__webglTexture);else if(A.depthBuffer){let ie=A.depthTexture;if(Ct.__boundDepthTexture!==ie){if(ie!==null&&k.has(ie)&&(A.width!==ie.image.width||A.height!==ie.image.height))throw new Error("THREE.WebGLRenderer: Attached DepthTexture is initialized to the incorrect size.");J.setupDepthRenderbuffer(A)}}let Nt=A.texture;(Nt.isData3DTexture||Nt.isDataArrayTexture||Nt.isCompressedArrayTexture)&&(It=!0);let Gt=k.get(A).__webglFramebuffer;A.isWebGLCubeRenderTarget?(Array.isArray(Gt[V])?$=Gt[V][et]:$=Gt[V],K=!0):A.samples>0&&J.useMultisampledRTT(A)===!1?$=k.get(A).__webglMultisampledFramebuffer:Array.isArray(Gt)?$=Gt[et]:$=Gt,Z.copy(A.viewport),j.copy(A.scissor),q=A.scissorTest}else Z.copy(dt).multiplyScalar(Q).floor(),j.copy(xt).multiplyScalar(Q).floor(),q=Vt;if(et!==0&&($=F),E.bindFramebuffer(B.FRAMEBUFFER,$)&&E.drawBuffers(A,$),E.viewport(Z),E.scissor(j),E.setScissorTest(q),K){let Ct=k.get(A.texture);B.framebufferTexture2D(B.FRAMEBUFFER,B.COLOR_ATTACHMENT0,B.TEXTURE_CUBE_MAP_POSITIVE_X+V,Ct.__webglTexture,et)}else if(It){let Ct=V;for(let Nt=0;Nt<A.textures.length;Nt++){let Gt=k.get(A.textures[Nt]);B.framebufferTextureLayer(B.FRAMEBUFFER,B.COLOR_ATTACHMENT0+Nt,Gt.__webglTexture,et,Ct)}}else if(A!==null&&et!==0){let Ct=k.get(A.texture);B.framebufferTexture2D(B.FRAMEBUFFER,B.COLOR_ATTACHMENT0,B.TEXTURE_2D,Ct.__webglTexture,et)}U=-1};function Ap(A){let V=k.get(A);return(V.__readFormat!==A.format||V.__readType!==A.type)&&(V.__readFormat=A.format,V.__readType=A.type,V.__formatReadable=I.textureFormatReadable(A.format),V.__typeReadable=I.textureTypeReadable(A.type)),V}this.readRenderTargetPixels=function(A,V,et,$,K,It,Dt,Ct=0){if(!(A&&A.isWebGLRenderTarget)){Bt("WebGLRenderer.readRenderTargetPixels: renderTarget is not THREE.WebGLRenderTarget.");return}let Nt=k.get(A).__webglFramebuffer;if(A.isWebGLCubeRenderTarget&&Dt!==void 0&&(Nt=Nt[Dt]),Nt){E.bindFramebuffer(B.FRAMEBUFFER,Nt);try{let Gt=A.textures[Ct],ie=Gt.format,oe=Gt.type;A.textures.length>1&&B.readBuffer(B.COLOR_ATTACHMENT0+Ct);let Ut=Ap(Gt);if(Ut.__formatReadable===!1){Bt("WebGLRenderer.readRenderTargetPixels: renderTarget is not in RGBA or implementation defined format.");return}if(Ut.__typeReadable===!1){Bt("WebGLRenderer.readRenderTargetPixels: renderTarget is not in UnsignedByteType or implementation defined type.");return}V>=0&&V<=A.width-$&&et>=0&&et<=A.height-K&&B.readPixels(V,et,$,K,wt.convert(ie),wt.convert(oe),It)}finally{let Gt=H!==null?k.get(H).__webglFramebuffer:null;E.bindFramebuffer(B.FRAMEBUFFER,Gt)}}},this.readRenderTargetPixelsAsync=async function(A,V,et,$,K,It,Dt,Ct=0){if(!(A&&A.isWebGLRenderTarget))throw new Error("THREE.WebGLRenderer.readRenderTargetPixels: renderTarget is not THREE.WebGLRenderTarget.");let Nt=k.get(A).__webglFramebuffer;if(A.isWebGLCubeRenderTarget&&Dt!==void 0&&(Nt=Nt[Dt]),Nt)if(V>=0&&V<=A.width-$&&et>=0&&et<=A.height-K){E.bindFramebuffer(B.FRAMEBUFFER,Nt);let Gt=A.textures[Ct],ie=Gt.format,oe=Gt.type;A.textures.length>1&&B.readBuffer(B.COLOR_ATTACHMENT0+Ct);let Ut=Ap(Gt);if(Ut.__formatReadable===!1)throw new Error("THREE.WebGLRenderer.readRenderTargetPixelsAsync: renderTarget is not in RGBA or implementation defined format.");if(Ut.__typeReadable===!1)throw new Error("THREE.WebGLRenderer.readRenderTargetPixelsAsync: renderTarget is not in UnsignedByteType or implementation defined type.");let pe=B.createBuffer();B.bindBuffer(B.PIXEL_PACK_BUFFER,pe),B.bufferData(B.PIXEL_PACK_BUFFER,It.byteLength,B.STREAM_READ),B.readPixels(V,et,$,K,wt.convert(ie),wt.convert(oe),0),B.bindBuffer(B.PIXEL_PACK_BUFFER,null);let Ue=H!==null?k.get(H).__webglFramebuffer:null;E.bindFramebuffer(B.FRAMEBUFFER,Ue);let Se=B.fenceSync(B.SYNC_GPU_COMMANDS_COMPLETE,0);return B.flush(),await og(B,Se,4),B.bindBuffer(B.PIXEL_PACK_BUFFER,pe),B.getBufferSubData(B.PIXEL_PACK_BUFFER,0,It),B.bindBuffer(B.PIXEL_PACK_BUFFER,null),B.deleteBuffer(pe),B.deleteSync(Se),It}else throw new Error("THREE.WebGLRenderer.readRenderTargetPixelsAsync: requested read bounds are out of range.")},this.copyFramebufferToTexture=function(A,V=null,et=0){let $=Math.pow(2,-et),K=Math.floor(A.image.width*$),It=Math.floor(A.image.height*$),Dt=V!==null?V.x:0,Ct=V!==null?V.y:0;J.setTexture2D(A,0),B.copyTexSubImage2D(B.TEXTURE_2D,et,0,0,Dt,Ct,K,It),E.unbindTexture()},this.copyTextureToTexture=function(A,V,et=null,$=null,K=0,It=0){let Dt,Ct,Nt,Gt,ie,oe,Ut,pe,Ue,Se=A.isCompressedTexture?A.mipmaps[It]:A.image;if(et!==null)Dt=et.max.x-et.min.x,Ct=et.max.y-et.min.y,Nt=et.isBox3?et.max.z-et.min.z:1,Gt=et.min.x,ie=et.min.y,oe=et.isBox3?et.min.z:0;else{let Le=Math.pow(2,-K);Dt=Math.floor(Se.width*Le),Ct=Math.floor(Se.height*Le),A.isDataArrayTexture?Nt=Se.depth:A.isData3DTexture?Nt=Math.floor(Se.depth*Le):Nt=1,Gt=0,ie=0,oe=0}$!==null?(Ut=$.x,pe=$.y,Ue=$.z):(Ut=0,pe=0,Ue=0);let _e=wt.convert(V.format),Ke=wt.convert(V.type),Lt;V.isData3DTexture?(J.setTexture3D(V,0),Lt=B.TEXTURE_3D):V.isDataArrayTexture||V.isCompressedArrayTexture?(J.setTexture2DArray(V,0),Lt=B.TEXTURE_2D_ARRAY):(J.setTexture2D(V,0),Lt=B.TEXTURE_2D),E.activeTexture(B.TEXTURE0),E.pixelStorei(B.UNPACK_FLIP_Y_WEBGL,V.flipY),E.pixelStorei(B.UNPACK_PREMULTIPLY_ALPHA_WEBGL,V.premultiplyAlpha),E.pixelStorei(B.UNPACK_ALIGNMENT,V.unpackAlignment);let an=E.getParameter(B.UNPACK_ROW_LENGTH),he=E.getParameter(B.UNPACK_IMAGE_HEIGHT),Tn=E.getParameter(B.UNPACK_SKIP_PIXELS),Qn=E.getParameter(B.UNPACK_SKIP_ROWS),Li=E.getParameter(B.UNPACK_SKIP_IMAGES);E.pixelStorei(B.UNPACK_ROW_LENGTH,Se.width),E.pixelStorei(B.UNPACK_IMAGE_HEIGHT,Se.height),E.pixelStorei(B.UNPACK_SKIP_PIXELS,Gt),E.pixelStorei(B.UNPACK_SKIP_ROWS,ie),E.pixelStorei(B.UNPACK_SKIP_IMAGES,oe);let Xs=A.isDataArrayTexture||A.isData3DTexture,xe=V.isDataArrayTexture||V.isData3DTexture;if(A.isDepthTexture){let Le=k.get(A),Di=k.get(V),Me=k.get(Le.__renderTarget),Ni=k.get(Di.__renderTarget);E.bindFramebuffer(B.READ_FRAMEBUFFER,Me.__webglFramebuffer),E.bindFramebuffer(B.DRAW_FRAMEBUFFER,Ni.__webglFramebuffer);for(let qs=0;qs<Nt;qs++)Xs&&(B.framebufferTextureLayer(B.READ_FRAMEBUFFER,B.COLOR_ATTACHMENT0,k.get(A).__webglTexture,K,oe+qs),B.framebufferTextureLayer(B.DRAW_FRAMEBUFFER,B.COLOR_ATTACHMENT0,k.get(V).__webglTexture,It,Ue+qs)),B.blitFramebuffer(Gt,ie,Dt,Ct,Ut,pe,Dt,Ct,B.DEPTH_BUFFER_BIT,B.NEAREST);E.bindFramebuffer(B.READ_FRAMEBUFFER,null),E.bindFramebuffer(B.DRAW_FRAMEBUFFER,null)}else if(K!==0||A.isRenderTargetTexture||k.has(A)){let Le=k.get(A),Di=k.get(V);E.bindFramebuffer(B.READ_FRAMEBUFFER,C),E.bindFramebuffer(B.DRAW_FRAMEBUFFER,N);for(let Me=0;Me<Nt;Me++)Xs?B.framebufferTextureLayer(B.READ_FRAMEBUFFER,B.COLOR_ATTACHMENT0,Le.__webglTexture,K,oe+Me):B.framebufferTexture2D(B.READ_FRAMEBUFFER,B.COLOR_ATTACHMENT0,B.TEXTURE_2D,Le.__webglTexture,K),xe?B.framebufferTextureLayer(B.DRAW_FRAMEBUFFER,B.COLOR_ATTACHMENT0,Di.__webglTexture,It,Ue+Me):B.framebufferTexture2D(B.DRAW_FRAMEBUFFER,B.COLOR_ATTACHMENT0,B.TEXTURE_2D,Di.__webglTexture,It),K!==0?B.blitFramebuffer(Gt,ie,Dt,Ct,Ut,pe,Dt,Ct,B.COLOR_BUFFER_BIT,B.NEAREST):xe?B.copyTexSubImage3D(Lt,It,Ut,pe,Ue+Me,Gt,ie,Dt,Ct):B.copyTexSubImage2D(Lt,It,Ut,pe,Gt,ie,Dt,Ct);E.bindFramebuffer(B.READ_FRAMEBUFFER,null),E.bindFramebuffer(B.DRAW_FRAMEBUFFER,null)}else xe?A.isDataTexture||A.isData3DTexture?B.texSubImage3D(Lt,It,Ut,pe,Ue,Dt,Ct,Nt,_e,Ke,Se.data):V.isCompressedArrayTexture?B.compressedTexSubImage3D(Lt,It,Ut,pe,Ue,Dt,Ct,Nt,_e,Se.data):B.texSubImage3D(Lt,It,Ut,pe,Ue,Dt,Ct,Nt,_e,Ke,Se):A.isDataTexture?B.texSubImage2D(B.TEXTURE_2D,It,Ut,pe,Dt,Ct,_e,Ke,Se.data):A.isCompressedTexture?B.compressedTexSubImage2D(B.TEXTURE_2D,It,Ut,pe,Se.width,Se.height,_e,Se.data):B.texSubImage2D(B.TEXTURE_2D,It,Ut,pe,Dt,Ct,_e,Ke,Se);E.pixelStorei(B.UNPACK_ROW_LENGTH,an),E.pixelStorei(B.UNPACK_IMAGE_HEIGHT,he),E.pixelStorei(B.UNPACK_SKIP_PIXELS,Tn),E.pixelStorei(B.UNPACK_SKIP_ROWS,Qn),E.pixelStorei(B.UNPACK_SKIP_IMAGES,Li),It===0&&V.generateMipmaps&&B.generateMipmap(Lt),E.unbindTexture()},this.initRenderTarget=function(A){k.get(A).__webglFramebuffer===void 0&&J.setupRenderTarget(A)},this.initTexture=function(A){A.isCubeTexture?J.setTextureCube(A,0):A.isData3DTexture?J.setTexture3D(A,0):A.isDataArrayTexture||A.isCompressedArrayTexture?J.setTexture2DArray(A,0):J.setTexture2D(A,0),E.unbindTexture()},this.resetState=function(){z=0,O=0,H=null,E.reset(),Pt.reset()},typeof __THREE_DEVTOOLS__<"u"&&__THREE_DEVTOOLS__.dispatchEvent(new CustomEvent("observe",{detail:this}))}get coordinateSystem(){return xn}get outputColorSpace(){return this._outputColorSpace}set outputColorSpace(t){this._outputColorSpace=t;let e=this.getContext();e.drawingBufferColorSpace=re._getDrawingBufferColorSpace(t),e.unpackColorSpace=re._getUnpackColorSpace()}};var Zg=(s,t)=>[s[1]*t[2]-s[2]*t[1],s[2]*t[0]-s[0]*t[2],s[0]*t[1]-s[1]*t[0]],Lu=(s,t)=>[s[0]-t[0],s[1]-t[1],s[2]-t[2]],ye=class{constructor(){this.slots=new Map}_slot(t){let e=this.slots.get(t);return e||(e={pos:[],nor:[],uv:[]},this.slots.set(t,e)),e}get empty(){for(let t of this.slots.values())if(t.pos.length)return!1;return!0}tri(t,e,n,i,r=[0,0],o=[1,0],a=[0,1],l=null){let c=Zg(Lu(n,e),Lu(i,e)),h=Math.hypot(c[0],c[1],c[2]);if(h<1e-9)return;let f=c[0]/h,u=c[1]/h,d=c[2]/h;l&&f*l[0]+u*l[1]+d*l[2]<0&&([n,i]=[i,n],[o,a]=[a,o],f=-f,u=-u,d=-d);let p=this._slot(t);p.pos.push(e[0],e[1],e[2],n[0],n[1],n[2],i[0],i[1],i[2]),p.nor.push(f,u,d,f,u,d,f,u,d),p.uv.push(r[0],r[1],o[0],o[1],a[0],a[1])}triN(t,e,n,i,r,o,a,l=[0,0],c=[1,0],h=[0,1]){let f=Zg(Lu(n,e),Lu(i,e)),u=[r[0]+o[0]+a[0],r[1]+o[1]+a[1],r[2]+o[2]+a[2]];if(Math.hypot(f[0],f[1],f[2])<1e-12)return;f[0]*u[0]+f[1]*u[1]+f[2]*u[2]<0&&([n,i]=[i,n],[o,a]=[a,o],[c,h]=[h,c]);let d=this._slot(t);d.pos.push(e[0],e[1],e[2],n[0],n[1],n[2],i[0],i[1],i[2]),d.nor.push(r[0],r[1],r[2],o[0],o[1],o[2],a[0],a[1],a[2]),d.uv.push(l[0],l[1],c[0],c[1],h[0],h[1])}quad(t,e,n,i,r,o=[[0,0],[1,0],[1,1],[0,1]],a=null){this.tri(t,e,n,i,o[0],o[1],o[2],a),this.tri(t,e,i,r,o[0],o[2],o[3],a)}poly(t,e,n,i=null){for(let r=1;r<e.length-1;r++)this.tri(t,e[0],e[r],e[r+1],n[0],n[r],n[r+1],i)}append(t){for(let[e,n]of t.slots){let i=this._slot(e);for(let r=0;r<n.pos.length;r++)i.pos.push(n.pos[r]);for(let r=0;r<n.nor.length;r++)i.nor.push(n.nor[r]);for(let r=0;r<n.uv.length;r++)i.uv.push(n.uv[r])}}build(t=null){let e=[],n=t||[...this.slots.keys()];for(let f of n)this.slots.get(f)?.pos.length&&e.push(f);if(!e.length)return null;let i=0;for(let f of e)i+=this.slots.get(f).pos.length;let r=new Float32Array(i),o=new Float32Array(i),a=new Float32Array(i/3*2),l=new qt,c=0,h=0;return e.forEach((f,u)=>{let d=this.slots.get(f);r.set(d.pos,c),o.set(d.nor,c),a.set(d.uv,h),l.addGroup(c/3,d.pos.length/3,u),c+=d.pos.length,h+=d.uv.length}),l.setAttribute("position",new Qt(r,3)),l.setAttribute("normal",new Qt(o,3)),l.setAttribute("uv",new Qt(a,2)),l.computeBoundingBox(),l.computeBoundingSphere(),{geometry:l,slotKeys:e}}};function Du(s,t,e,n,i,r,o,a){if(e-t<1e-6||i-n<1e-6||o-r<1e-6)return;let l=typeof a=="string"?{px:a,nx:a,py:a,ny:a,pz:a,nz:a}:a;l.px&&s.quad(l.px,[e,n,r],[e,n,o],[e,i,o],[e,i,r],[[r,n],[o,n],[o,i],[r,i]],[1,0,0]),l.nx&&s.quad(l.nx,[t,n,r],[t,n,o],[t,i,o],[t,i,r],[[r,n],[o,n],[o,i],[r,i]],[-1,0,0]),l.py&&s.quad(l.py,[t,i,r],[e,i,r],[e,i,o],[t,i,o],[[t,r],[e,r],[e,o],[t,o]],[0,1,0]),l.ny&&s.quad(l.ny,[t,n,r],[e,n,r],[e,n,o],[t,n,o],[[t,r],[e,r],[e,o],[t,o]],[0,-1,0]),l.pz&&s.quad(l.pz,[t,n,o],[e,n,o],[e,i,o],[t,i,o],[[t,n],[e,n],[e,i],[t,i]],[0,0,1]),l.nz&&s.quad(l.nz,[t,n,r],[e,n,r],[e,i,r],[t,i,r],[[t,n],[e,n],[e,i],[t,i]],[0,0,-1])}function qe(s,t,e,n,i,r,o,a,l){let c=Math.cos(r),h=Math.sin(r),f=(m,g,v)=>[t+c*m-h*g,v,e+h*m+c*g],u=typeof l=="string"?{pu:l,nu:l,pv:l,nv:l,py:l,ny:l}:l,d=m=>[m[0],m[2]];u.pu&&s.quad(u.pu,f(n,-i,o),f(n,i,o),f(n,i,a),f(n,-i,a),[[0,o],[2*i,o],[2*i,a],[0,a]],[c,0,h]),u.nu&&s.quad(u.nu,f(-n,-i,o),f(-n,i,o),f(-n,i,a),f(-n,-i,a),[[0,o],[2*i,o],[2*i,a],[0,a]],[-c,0,-h]),u.pv&&s.quad(u.pv,f(-n,i,o),f(n,i,o),f(n,i,a),f(-n,i,a),[[0,o],[2*n,o],[2*n,a],[0,a]],[-h,0,c]),u.nv&&s.quad(u.nv,f(-n,-i,o),f(n,-i,o),f(n,-i,a),f(-n,-i,a),[[0,o],[2*n,o],[2*n,a],[0,a]],[h,0,-c]);let p=[f(-n,-i,a),f(n,-i,a),f(n,i,a),f(-n,i,a)],x=[f(-n,-i,o),f(n,-i,o),f(n,i,o),f(-n,i,o)];u.py&&s.quad(u.py,p[0],p[1],p[2],p[3],p.map(d),[0,1,0]),u.ny&&s.quad(u.ny,x[0],x[1],x[2],x[3],x.map(d),[0,-1,0])}function fo(s,t,e,n,i,r,o,a){let l=typeof a=="string"?{side:a,top:a,bottom:a}:a,c=2*Math.PI*n;for(let h=0;h<o;h++){let f=h/o*Math.PI*2,u=(h+1)/o*Math.PI*2,d=Math.cos(f),p=Math.sin(f),x=Math.cos(u),m=Math.sin(u),g=[t+n*d,i,e+n*p],v=[t+n*x,i,e+n*m],b=[t+n*x,r,e+n*m],y=[t+n*d,r,e+n*p],M=[d,0,p],S=[x,0,m],w=h/o*c,_=(h+1)/o*c;l.side&&(s.triN(l.side,g,v,b,M,S,S,[w,i],[_,i],[_,r]),s.triN(l.side,g,b,y,M,S,M,[w,i],[_,r],[w,r])),l.top&&s.tri(l.top,[t,r,e],b,y,[t,e],[b[0],b[2]],[y[0],y[2]],[0,1,0]),l.bottom&&s.tri(l.bottom,[t,i,e],v,g,[t,e],[v[0],v[2]],[g[0],g[2]],[0,-1,0])}}function Jl(s,t=!1){let e=s[0].index!==null,n=new Set(Object.keys(s[0].attributes)),i=new Set(Object.keys(s[0].morphAttributes)),r={},o={},a=s[0].morphTargetsRelative,l=new qt,c=0;for(let h=0;h<s.length;++h){let f=s[h],u=0;if(e!==(f.index!==null))return console.error("THREE.BufferGeometryUtils: .mergeGeometries() failed with geometry at index "+h+". All geometries must have compatible attributes; make sure index attribute exists among all geometries, or in none of them."),null;for(let d in f.attributes){if(!n.has(d))return console.error("THREE.BufferGeometryUtils: .mergeGeometries() failed with geometry at index "+h+'. All geometries must have compatible attributes; make sure "'+d+'" attribute exists among all geometries, or in none of them.'),null;r[d]===void 0&&(r[d]=[]),r[d].push(f.attributes[d]),u++}if(u!==n.size)return console.error("THREE.BufferGeometryUtils: .mergeGeometries() failed with geometry at index "+h+". Make sure all geometries have the same number of attributes."),null;if(a!==f.morphTargetsRelative)return console.error("THREE.BufferGeometryUtils: .mergeGeometries() failed with geometry at index "+h+". .morphTargetsRelative must be consistent throughout all geometries."),null;for(let d in f.morphAttributes){if(!i.has(d))return console.error("THREE.BufferGeometryUtils: .mergeGeometries() failed with geometry at index "+h+".  .morphAttributes must be consistent throughout all geometries."),null;o[d]===void 0&&(o[d]=[]),o[d].push(f.morphAttributes[d])}if(t){let d;if(e)d=f.index.count;else if(f.attributes.position!==void 0)d=f.attributes.position.count;else return console.error("THREE.BufferGeometryUtils: .mergeGeometries() failed with geometry at index "+h+". The geometry must have either an index or a position attribute"),null;l.addGroup(c,d,h),c+=d}}if(e){let h=0,f=[];for(let u=0;u<s.length;++u){let d=s[u].index;for(let p=0;p<d.count;++p)f.push(d.getX(p)+h);h+=s[u].attributes.position.count}l.setIndex(f)}for(let h in r){let f=Jg(r[h]);if(!f)return console.error("THREE.BufferGeometryUtils: .mergeGeometries() failed while trying to merge the "+h+" attribute."),null;l.setAttribute(h,f)}for(let h in o){let f=o[h][0].length;if(f!==0){l.morphAttributes=l.morphAttributes||{},l.morphAttributes[h]=[];for(let u=0;u<f;++u){let d=[];for(let x=0;x<o[h].length;++x)d.push(o[h][x][u]);let p=Jg(d);if(!p)return console.error("THREE.BufferGeometryUtils: .mergeGeometries() failed while trying to merge the "+h+" morphAttribute."),null;l.morphAttributes[h].push(p)}}}return l}function Jg(s){let t,e,n,i=-1,r=0;for(let c=0;c<s.length;++c){let h=s[c];if(t===void 0&&(t=h.array.constructor),t!==h.array.constructor)return console.error("THREE.BufferGeometryUtils: .mergeAttributes() failed. BufferAttribute.array must be of consistent array types across matching attributes."),null;if(e===void 0&&(e=h.itemSize),e!==h.itemSize)return console.error("THREE.BufferGeometryUtils: .mergeAttributes() failed. BufferAttribute.itemSize must be consistent across matching attributes."),null;if(n===void 0&&(n=h.normalized),n!==h.normalized)return console.error("THREE.BufferGeometryUtils: .mergeAttributes() failed. BufferAttribute.normalized must be consistent across matching attributes."),null;if(i===-1&&(i=h.gpuType),i!==h.gpuType)return console.error("THREE.BufferGeometryUtils: .mergeAttributes() failed. BufferAttribute.gpuType must be consistent across matching attributes."),null;r+=h.count*e}let o=new t(r),a=new Qt(o,e,n),l=0;for(let c=0;c<s.length;++c){let h=s[c];if(h.isInterleavedBufferAttribute){let f=l/e;for(let u=0,d=h.count;u<d;u++)for(let p=0;p<e;p++){let x=h.getComponent(u,p);a.setComponent(u+f,p,x)}}else o.set(h.array,l);l+=h.count*e}return i!==void 0&&(a.gpuType=i),a}function be(s,t,e={},n={}){if(!s)return null;let{geometry:i}=s,r=s.slotKeys,o=r.map(l=>t[l]);if(o.length>1){let l=i.groups.map(u=>({start:u.start,count:u.count,mi:u.materialIndex})),c=[],h=[],f=[];for(let u of l){let d=c.length-1;d>=0&&f[d]===o[u.mi]?c[d].count+=u.count:(c.push({start:u.start,count:u.count}),h.push(r[u.mi]),f.push(o[u.mi]))}c.length<l.length&&(i.clearGroups(),c.forEach((u,d)=>i.addGroup(u.start,u.count,d)),r=h,o=f)}let a=new ce(i,o.length===1?o[0]:o);return a.userData={...e,slotKeys:r},n.faceOf&&(a.userData.faceBySlot=r.map(l=>n.faceOf[l])),a.castShadow=n.cast??!0,a.receiveShadow=n.receive??!0,n.name&&(a.name=n.name),o.some(l=>l?.transparent)&&(a.castShadow=!1),a}function VE(s){s&&s.traverse(t=>{t.geometry&&t.geometry.dispose();let e=Array.isArray(t.material)?t.material:t.material?[t.material]:[];for(let n of e)n.userData?.shared||(n.userData?.disposeMap&&n.map?.dispose?.(),n.dispose())})}function HE(s){let t=new Ae,e=!1;return s.updateWorldMatrix(!0,!0),s.traverse(n=>{if(!n.isMesh||n.userData?.ground||!n.geometry)return;n.geometry.boundingBox||n.geometry.computeBoundingBox();let i=n.geometry.boundingBox.clone().applyMatrix4(n.matrixWorld);Number.isFinite(i.min.x+i.max.x+i.min.y+i.max.y+i.min.z+i.max.z)&&(t.union(i),e=!0)}),e?t:null}function $g(s,t=null){let e=[],n=!0;if(s.traverse(a=>{a!==s&&(a.isMesh?Array.isArray(a.material)||!a.geometry?.attributes?.position||a.isInstancedMesh||a.isSkinnedMesh?n=!1:e.push(a):(a.isLine||a.isPoints||a.isSprite)&&(n=!1))}),!n||e.length<2)return s;s.updateMatrixWorld(!0);let i=new Jt().copy(s.matrixWorld).invert(),r=new Map,o=a=>{if(!t?.vertexColour||!a.color||a.map||a.normalMap||a.transparent||a.opacity<1||a.emissiveMap||a.emissive&&a.emissive.getHex()!==0)return null;let l=(a.metalness??0)>.3,c=(a.roughness??.8)<.45;return{key:`v|${l?1:0}|${c?1:0}|${a.side===Ne?1:0}`,rough:c?.35:.8,metal:l?.6:0,side:a.side===Ne?"double":"front"}};try{for(let l of e){let c=new Jt().multiplyMatrices(i,l.matrixWorld),h=l.geometry.clone();h.index&&(h=h.toNonIndexed()),h.applyMatrix4(c);for(let d of Object.keys(h.attributes))["position","normal","uv"].includes(d)||h.deleteAttribute(d);h.attributes.normal||h.computeVertexNormals(),h.attributes.uv||h.setAttribute("uv",new Qt(new Float32Array(h.attributes.position.count*2),2)),h.clearGroups();let f=o(l.material),u=f?f.key:`m|${l.material.uuid}`;if(f){let d=h.attributes.position.count,p=new Float32Array(d*3),x=l.material.color;for(let m=0;m<d;m++)p[m*3]=x.r,p[m*3+1]=x.g,p[m*3+2]=x.b;h.setAttribute("color",new Qt(p,3))}r.has(u)||r.set(u,{cls:f,material:l.material,geos:[],cast:l.castShadow,receive:l.receiveShadow}),r.get(u).geos.push(h)}let a=new Te;a.name=s.name;for(let l of r.values()){let c=l.geos.length>1?Jl(l.geos,!1):l.geos[0];if(!c)return s;let h=l.cls?t.vertexColour(l.cls):l.material,f=new ce(c,h);f.castShadow=l.cast,f.receiveShadow=l.receive,a.add(f)}for(let l of e)l.geometry.dispose();return a}catch{return s}}var $l=1,L1=3,D1=.3,N1=260,U1=750,Nu=[0,90,320,1100],F1=[0,.3,.78,1],sp=s=>Number.isFinite(s);function jg(s){let t=s?.site?.lot?.boundary;return Array.isArray(t)&&t.length>=3}function Kg(s,t=null){let e=t;for(let n of s)!n||!sp(n.x)||!sp(n.y)||(e?(e.x0=Math.min(e.x0,n.x),e.y0=Math.min(e.y0,n.y),e.x1=Math.max(e.x1,n.x),e.y1=Math.max(e.y1,n.y)):e={x0:n.x,y0:n.y,x1:n.x,y1:n.y});return e}function tx(s,t=30){if(!s)return null;let e=t*1e3,n=s.aerial?.extent,i=Kg(s.boundary||[]),r=null;if(n&&[n.x0,n.y0,n.x1,n.y1].every(sp)&&n.x1>n.x0&&n.y1>n.y0)r={x0:n.x0,y0:n.y0,x1:n.x1,y1:n.y1};else{let o=i?{...i}:null;for(let l of s.neighbours||[])l.isRoad||(o=Kg(l.ring||[],o));o&&(r={x0:o.x0-e,y0:o.y0-e,x1:o.x1+e,y1:o.y1+e});let a=s.terrain;if(a&&r){let l={x0:a.x0,y0:a.y0,x1:a.x0+(a.cols-1)*a.cellMm,y1:a.y0+(a.rows-1)*a.cellMm};l.x0<=r.x0&&l.y0<=r.y0&&l.x1>=r.x1&&l.y1>=r.y1&&(r=l)}}return r?(i&&(r.x0=Math.min(r.x0,i.x0),r.y0=Math.min(r.y0,i.y0),r.x1=Math.max(r.x1,i.x1),r.y1=Math.max(r.y1,i.y1)),r):null}function rp(s,t=U1,e=N1){let n=s.x1-s.x0,i=s.y1-s.y0,r=Math.max(t,Math.max(n,i)/e),o=Math.max(1,Math.ceil(n/r)),a=Math.max(1,Math.ceil(i/r));return{cols:o+1,rows:a+1,dx:n/o,dy:i/a,x0:s.x0,y0:s.y0}}function op(s,t,e){if(!s)return null;let n=Math.min(Math.max(t,s.x0),s.x0+(s.cols-1)*s.cellMm),i=Math.min(Math.max(e,s.y0),s.y0+(s.rows-1)*s.cellMm);return Xp(s,n,i)}function Uu(s,t,e){let n=Math.max(s.minX-t,0,t-s.maxX)/1e3,i=Math.max(s.minY-e,0,e-s.maxY)/1e3;return Math.hypot(n,i)}function Fu(s,t,e){let n=e-$l;if(n<=0)return t;let i=s-t,r=Math.max(D1,Math.abs(i)*L1);return n>=r?s:t+i*(n/r)}var ex=(s,t)=>(s+t&1)===1;function ap(s,t){let e=[];for(let n=0;n<t-1;n++)for(let i=0;i<s-1;i++){let r=n*s+i,o=r+1,a=r+s,l=a+1;ex(i,n)?e.push(r,a,l,r,l,o):e.push(r,a,o,o,a,l)}return e}function nx(s,t,e){let n=Math.min(Math.max((t-s.x0)/s.dx,0),s.cols-1),i=Math.min(Math.max((e-s.y0)/s.dy,0),s.rows-1),r=Math.min(s.cols-2,Math.floor(n)),o=Math.min(s.rows-2,Math.floor(i)),a=n-r,l=i-o,c=(p,x)=>s.heights[x*s.cols+p],h=c(r,o),f=c(r+1,o),u=c(r,o+1),d=c(r+1,o+1);return ex(r,o)?a>=l?h+(f-h)*a+(d-f)*l:h+(d-u)*a+(u-h)*l:a+l<=1?h+(f-h)*a+(u-h)*l:d+(u-d)*(1-a)+(f-d)*(1-l)}function ix(s,t,{step:e=.5,lift:n=.06,closed:i=!1}={}){let r=[],o=s.length,a=i?o:o-1;for(let l=0;l<a;l++){let c=s[l],h=s[(l+1)%o],f=Math.hypot(h.x-c.x,h.y-c.y)/1e3,u=Math.max(1,Math.ceil(f/e));for(let d=0;d<u;d++){let p=c.x+(h.x-c.x)*d/u,x=c.y+(h.y-c.y)*d/u;r.push([p/1e3,t(p,x)+n,x/1e3])}}if(!i&&o){let l=s[o-1];r.push([l.x/1e3,t(l.x,l.y)+n,l.y/1e3])}return r}function sx(s,t,e=!1){let n=s.length,i=[],r=[];for(let a=0;a<n;a++){let l=s[a],c=s[e?(a-1+n)%n:Math.max(0,a-1)],h=s[e?(a+1)%n:Math.min(n-1,a+1)],f=h[0]-c[0],u=h[2]-c[2],d=Math.hypot(f,u)||1;f/=d,u/=d,i.push(l[0]-u*t,l[1],l[2]+f*t,l[0]+u*t,l[1],l[2]-f*t)}let o=e?n:n-1;for(let a=0;a<o;a++){let l=a*2,c=(a+1)%n*2;r.push(l,l+1,c,l+1,c+1,c)}return{positions:i,indices:r}}function rx(s,t=1.6,e=1,n=!1){let i=n&&s.length?[...s,s[0]]:s,r=[],o=[],a=!0,l=t;for(let c=0;c+1<i.length;c++){let h=i[c],f=i[c+1],u=Math.hypot(f[0]-h[0],f[1]-h[1],f[2]-h[2]),d=0;for(a&&!o.length&&o.push(h);u-d>1e-9;){let p=Math.min(l,u-d);d+=p,l-=p;let x=u?d/u:1,m=[h[0]+(f[0]-h[0])*x,h[1]+(f[1]-h[1])*x,h[2]+(f[2]-h[2])*x];a&&o.push(m),l<=1e-9&&(a?(o.length>=2&&r.push(o),o=[]):o=[m],a=!a,l=a?t:e)}}return a&&o.length>=2&&r.push(o),r}function ox(s){let t=s?.boundary||[],e=t.length;return e<2?[]:(s.frontEdges||[]).filter(n=>Number.isInteger(n)&&n>=0&&n<e).map(n=>[t[n],t[(n+1)%e]])}function ax(s,t,e=Nu,n=F1){let i=s.length,r=[],o=[];e.forEach((l,c)=>{for(let h of s)r.push(h.x+h.dir[0]*l,c===0?h.y:t,h.z+h.dir[1]*l),o.push(n[c])});let a=[];for(let l=0;l+1<e.length;l++)for(let c=0;c<i;c++){let h=l*i+c,f=l*i+(c+1)%i,u=(l+1)*i+c,d=(l+1)*i+(c+1)%i;a.push(h,f,u,f,d,u)}return{positions:r,colourT:o,indices:a}}function lp(s,t){let e=[],n=(i,r,o,a)=>e.push({i,j:r,dir:[o,a]});for(let i=0;i<s-1;i++)n(i,0,i===0?-1:0,-1);for(let i=0;i<t-1;i++)n(s-1,i,1,i===0?-1:0);for(let i=s-1;i>0;i--)n(i,t-1,i===s-1?1:0,1);for(let i=t-1;i>0;i--)n(0,i,-1,i===t-1?1:0);return e}var Qg=s=>{let t=0,e=0,n=0;for(let i=0;i<s.length;i++){let r=s[i],o=s[(i+1)%s.length],a=r.x*o.y-o.x*r.y;t+=a,e+=(r.x+o.x)*a,n+=(r.y+o.y)*a}if(Math.abs(t)<1e-6){let i=s.length||1;return{x:s.reduce((r,o)=>r+o.x,0)/i,y:s.reduce((r,o)=>r+o.y,0)/i}}return{x:e/(3*t),y:n/(3*t)}};function lx(s){if(!s?.boundary?.length)return[];let t=[],e=Qg(s.boundary),n=[];s.lotNumber&&n.push(`Lot ${s.lotNumber}`),s.planLabel&&n.push(s.planLabel),Number.isFinite(s.areaM2)&&n.push(`${Math.round(s.areaM2).toLocaleString("en-AU")} m\xB2`),n.length&&t.push({kind:"lot",lines:n,x:e.x,y:e.y});for(let i of s.neighbours||[]){if(i.isRoad||!i.ring?.length||!i.lotNumber)continue;let r=[`Lot ${i.lotNumber}`];i.planLabel&&r.push(i.planLabel);let o=Qg(i.ring);t.push({kind:"neighbour",lines:r,x:o.x,y:o.y})}return t}var pn=(s,t)=>s?.layers?.[t]!==!1;var ux=Math.PI/180,Bu="#9aae52";function hx(s,t,e,n,i=!0,r=[]){let o=e.map(f=>new rt(f.x/1e3,f.y/1e3)),a=r.map(f=>f.map(u=>new rt(u.x/1e3,u.y/1e3))),l;try{l=Be.triangulateShape(o,a)}catch{l=[]}let c=o.concat(...a),h=i?[0,1,0]:[0,-1,0];for(let f of l){let[u,d,p]=f.map(x=>c[x]);s.tri(t,[u.x,n,u.y],[d.x,n,d.y],[p.x,n,p.y],[u.x,u.y],[d.x,d.y],[p.x,p.y],h)}}function ZE(s,t,e,n=null){let i=e?(e.min.x+e.max.x)/2:0,r=e?(e.min.z+e.max.z)/2:0,o=Math.max(150,e?Math.hypot(e.max.x-e.min.x,e.max.z-e.min.z)*6:0),a=new ye,l=48,c=n??s.groundY;for(let u=0;u<l;u++){let d=u/l*Math.PI*2,p=(u+1)/l*Math.PI*2,x=[i+o*Math.cos(d),c,r+o*Math.sin(d)],m=[i+o*Math.cos(p),c,r+o*Math.sin(p)];a.tri("ground",[i,c,r],x,m,[i,r],[x[0],x[2]],[m[0],m[2]],[0,1,0])}let h=s.lib.get("grass",Bu),f=be(a.build(),{ground:h},{ground:!0},{cast:!1,receive:!0,name:"ground"});return f&&t.add(f),o}function JE(s,t,e,n,i){let r=e.elevation/1e3,o=new ye,a=n.polygon,l=.14,c=r;hx(o,"top",a,c);let h=a.length,f=e.elevation<=1e3,u=s.groundY,d=c-l,p=(M,S)=>{!f||d-u<.08||Du(o,M-.05,M+.05,u,d,S-.05,S+.05,{px:"post",nx:"post",pz:"post",nz:"post",py:null,ny:null})};for(let M=0;M<h;M++){let S=a[M],w=a[(M+1)%h],_=[S.x/1e3,0,S.y/1e3],T=[w.x/1e3,0,w.y/1e3],R=O1(a,S,w);o.quad("side",[_[0],c-l,_[2]],[T[0],c-l,T[2]],[T[0],c,T[2]],[_[0],c,_[2]],[[0,0],[1,0],[1,1],[0,1]],[R.x,0,R.y]);let L=ui(S,w)/1e3,D=Math.max(1,Math.ceil(L/2.4));for(let F=0;F<D;F++)p(_[0]+(T[0]-_[0])*F/D,_[2]+(T[2]-_[2])*F/D)}if(hx(o,"under",a,c-l,!1),n.balustrade)for(let M=0;M<h;M++){let S=a[M],w=a[(M+1)%h];if(fx(S,w,i))continue;let _=ui(S,w)/1e3;if(_<.3)continue;let T=Math.atan2(w.y-S.y,w.x-S.x),R=(S.x+w.x)/2e3,L=(S.y+w.y)/2e3;qe(o,R,L,_/2,.02,T,c+.95,c+1,"rail"),qe(o,R,L,_/2,.006,T,c+.1,c+.95,{pu:"glass",nu:"glass",pv:"glass",nv:"glass",py:null,ny:null});let D=Math.max(1,Math.ceil(_/1.2));for(let F=0;F<=D;F++){let C=F/D,N=(S.x+(w.x-S.x)*C)/1e3,z=(S.y+(w.y-S.y)*C)/1e3;Du(o,N-.03,N+.03,c,c+1,z-.03,z+.03,"rail")}}let x=s.tint(n.status),m=s.floorFinish(n,"decking"),g=s.lib.get(m.material,m.hex,{tint:x}),v=s.lib.plain(Ou(m.hex,.62),{tint:x,rough:.8}),b=o.build(),y=be(b,{top:g,side:v,under:v,post:v,rail:s.lib.frame(s.hex(s.fin.frames.colour),{tint:x}),glass:s.lib.glass({tint:x})},{kind:"deck",id:n.id,levelId:e.id},{name:`deck:${n.id}`});y&&t.add(y)}function $E(s,t,e,n,i){let r=n.polygon,o=r.length;if(o<3)return;let a=e.elevation/1e3,l=new ye;for(let h=0;h<o;h++){let f=r[h],u=r[(h+1)%o],d=ui(f,u)/1e3,p=Math.max(1,Math.ceil(d/1.2)),x=Math.atan2(u.y-f.y,u.x-f.x);for(let m=0;m<p;m++){let g=Ui(f,u,m/p),v=Ui(f,u,(m+1)/p);if(ui(g,v)<300||fx(g,v,i))continue;let b=ui(g,v)/1e3,y=(g.x+v.x)/2e3,M=(g.y+v.y)/2e3;qe(l,y,M,b/2,.02,x,a+.95,a+1,"rail"),qe(l,y,M,b/2,.006,x,a+.1,a+.95,{pu:"glass",nu:"glass",pv:"glass",nv:"glass",py:null,ny:null});for(let S of[g,v])Du(l,S.x/1e3-.03,S.x/1e3+.03,a,a+1,S.y/1e3-.03,S.y/1e3+.03,"rail")}}let c=be(l.build(),{rail:s.lib.frame(s.hex(s.fin.frames.colour),{tint:s.tint(n.status)}),glass:s.lib.glass({tint:s.tint(n.status)})},{decor:!0,levelId:e.id},{name:`balustrade:${n.id}`});c&&t.add(c)}function O1(s,t,e){let n=fi(Ys(e,t)),i={x:n.y,y:-n.x},r=Ui(t,e,.5),o={x:r.x+i.x*20,y:r.y+i.y*20};return wn(o,s)?{x:-i.x,y:-i.y}:i}function fx(s,t,e){let n=fi(Ys(t,s)),i=Ui(s,t,.5);for(let r of e){let o=Ip(r);if(!(Math.abs(Zs(n,o))<.95)&&sc(i,r.a,r.b).d<(r.thickness||100)/2+200)return!0}return!1}function Ou(s,t){let e=new _t(s);return e.multiplyScalar(t),`#${e.getHexString()}`}function KE(s,t,e,n,i){let r=e.elevation/1e3,o=new ye,a=Math.max(3,Math.round(i/.18)),l=i/a,c=n.length/1e3/a,h=n.width/1e3,f=(n.rotation||0)*ux,u=n.x/1e3,d=n.y/1e3,p=Math.cos(f),x=Math.sin(f);for(let b=1;b<a;b++){let y=-n.length/2e3+(b-1)*c,M=y+c,S=(y+M)/2,w=u-x*S,_=d+p*S;qe(o,w,_,h/2,c/2,f,r,r+b*l,{pu:"step",nu:"step",pv:"step",nv:"step",py:"tread",ny:null})}let m=s.floorFinish({type:"living",floor:null},"timber"),g=s.lib.get(m.material,m.hex),v=be(o.build(),{step:s.lib.plain(Ou(m.hex,.78),{rough:.7}),tread:g},{kind:"stair",id:n.id,levelId:e.id},{name:`stair:${n.id}`});v&&t.add(v)}function QE(s,t,e,n){let i=e.diameter/2e3,r=e.height/1e3,o=e.x/1e3,a=e.y/1e3,l=s.groundY,c=new ye;fo(c,o,a,i,l,l+r,48,{side:"body",top:null,bottom:null}),fo(c,o,a,i*1.01,l,l+.05,48,{side:"rim",top:"rim",bottom:null}),fo(c,o,a,i*.98,l+r,l+r+.07,48,{side:"lid",top:"lid",bottom:"lid"}),fo(c,o+i*.45,a,.18,l+r+.07,l+r+.13,20,{side:"lid",top:"lid",bottom:null}),fo(c,o+i+.04,a,.04,l+.25,l+.5,12,{side:"pipe",top:"pipe",bottom:null});let h=s.tint(e.status),f=s.hex(e.colour),u=be(c.build(),{body:s.lib.get("tank",f,{tint:h}),rim:s.lib.plain(Ou(f,.8),{tint:h}),lid:s.lib.plain(Ou(f,.72),{tint:h,rough:.6}),pipe:s.lib.plain("#2d3034",{tint:h})},{kind:"tank",id:e.id,levelId:n},{name:`tank:${e.id}`});u&&t.add(u)}function B1(s,t,e,n){let i=new Te,r=new ce(new ii(s/1e3,e/1e3,t/1e3),n);return r.position.y=e/2e3,i.add(r),i}function jE(s,t,e,n){let i=null;try{i=s.catalogue?.getFurniture?.(n.item)||null}catch{i=null}let r=n.w??i?.w??600,o=n.d??i?.d??600,a=i?.h??700,l=null;if(i?.build3d)try{l=i.build3d(ci,{w:r,d:o,h:a})}catch{l=null}(!l||!l.isObject3D)&&(l=B1(r,o,a,s.lib.plain("#a9aeb3",{rough:.8})));let h=new Ae().setFromObject(l).getSize(new P),f=Math.max(r,o,a)/1e3,u=Math.max(h.x,h.y,h.z);if(u>f*40?l.scale.multiplyScalar(.001):u>0&&u<f/40&&l.scale.multiplyScalar(1e3),l.updateMatrixWorld(!0),l.scale.x!==1){let x=new Te;x.add(l),l=x}l=$g(l,s.lib);let d=new Te;d.add(l),d.position.set(n.x/1e3,e.elevation/1e3,n.y/1e3),d.rotation.y=-(n.rotation||0)*ux,d.name=`furniture:${n.id}`;let p={kind:"furniture",id:n.id,levelId:e.id};d.userData=p,d.traverse(x=>{x.isMesh&&(x.userData={...p},x.castShadow=!0,x.receiveShadow=!0)}),t.add(d)}var z1=typeof document<"u",hp=new Map;function fp(s,t,e,{aniso:n=16,repeat:i=!0}={}){if(!z1)return null;if(hp.has(s))return hp.get(s);let r=document.createElement("canvas");r.width=t,r.height=t,e(r.getContext("2d"),t);let o=new Xn(r);return o.colorSpace=Ee,i&&(o.wrapS=In,o.wrapT=In),o.anisotropy=n,o.magFilter=le,o.minFilter=Ve,hp.set(s,o),o}function Vs(s){let t=s>>>0;return()=>(t=t*1664525+1013904223>>>0)/4294967296}function is(s,t,e,n,i,r,o){let a=Vs(o);for(let l=0;l<e;l++){s.globalAlpha=i*(.3+a()*.7),s.fillStyle=n[Math.floor(a()*n.length)];let c=r*(.6+a()*.9),h=r*(.6+a()*.9),f=a()*t,u=a()*t;s.fillRect(f,u,c,h),f+c>t&&s.fillRect(f-t,u,c,h),u+h>t&&s.fillRect(f,u-t,c,h)}s.globalAlpha=1}var hi=(s,t)=>{let e=parseInt(s.slice(1),16),n=i=>Math.max(0,Math.min(255,Math.round(i*t)));return`rgb(${n(e>>16&255)},${n(e>>8&255)},${n(e&255)})`},up={concrete(s,t,e){s.fillStyle=e.base,s.fillRect(0,0,t,t);let n=Vs(7);for(let i=0;i<14;i++)s.globalAlpha=.016,s.fillStyle=n()>.5?"#ffffff":"#77746e",s.fillRect(n()*t-120,n()*t-120,240+n()*200,240+n()*200);if(s.globalAlpha=1,is(s,t,14e3,["#a9a69d","#d3d0c7","#bbb8ae","#c4c1b7","#8f8c83"],.32,2.2,11),e.broom){s.strokeStyle="rgba(70,66,58,0.05)",s.lineWidth=1;for(let i=0;i<t;i+=3)s.beginPath(),s.moveTo(0,i+i%7*.2),s.lineTo(t,i),s.stroke()}s.fillStyle="rgba(52,50,44,0.62)",s.fillRect(0,0,t,4),s.fillRect(0,0,4,t),s.fillStyle="rgba(255,255,255,0.18)",s.fillRect(0,4,t,2),s.fillRect(4,0,2,t)},asphalt(s,t,e){s.fillStyle=e.base,s.fillRect(0,0,t,t);let n=e.coarse?3.2:2.2;is(s,t,e.coarse?22e3:3e4,[hi(e.base,.8),hi(e.base,1.15),hi(e.base,1.3),hi(e.base,.65),hi(e.base,1.45)],.55,n,21),is(s,t,260,["#26282a","#76797c"],.35,6,22);let i=Vs(23);for(let r=0;r<5;r++)s.globalAlpha=.02,s.fillStyle="#111",s.fillRect(i()*t-100,i()*t-100,200+i()*200,200+i()*200);s.globalAlpha=1},seal(s,t,e){s.fillStyle=hi(e.base,.7),s.fillRect(0,0,t,t),is(s,t,16e3,["#8d8b85","#a29f97","#74726d","#b3afa5","#615f5b"],.85,5,31),is(s,t,7e3,["#999690","#84827c","#aaa69c"],.8,3,32)},gravel(s,t,e){s.fillStyle=hi(e.base,.78),s.fillRect(0,0,t,t);let n=Vs(41),i=["#b2a58b","#9c8f77","#c4b89f","#8a7e69","#d0c6af","#a89b81","#7d7260"];for(let r=0;r<5200;r++){let o=2+n()*4.2,a=n()*t,l=n()*t;s.fillStyle="rgba(40,34,24,0.35)",s.beginPath(),s.arc(a+1,l+1.2,o,0,Math.PI*2),s.fill(),s.fillStyle=i[Math.floor(n()*i.length)],s.beginPath(),s.arc(a,l,o,0,Math.PI*2),s.fill()}},permeable(s,t,e){s.fillStyle="#5d5c58",s.fillRect(0,0,t,t),is(s,t,9e3,["#7a7975","#4c4b48","#8b8a85"],.7,2,51);let n=t/2400,i=200*n,r=100*n,o=7*n,a=Vs(52);for(let l=0;l*r<t;l++){let c=l%2?i/2:0;for(let h=-1;h*i<t;h++){let f=h*i+c,u=l*r;s.fillStyle=hi(e.base,.88+a()*.22),s.fillRect(f+o/2,u+o/2,i-o,r-o),s.fillStyle="rgba(255,255,255,0.10)",s.fillRect(f+o/2,u+o/2,i-o,1.4)}}},pavers(s,t,e){s.fillStyle="#b8ad9a",s.fillRect(0,0,t,t);let n=t/2400,i=230*n,r=115*n,o=4*n,a=Vs(61);for(let l=0;l*r<t;l++){let c=l%2?i/2:0;for(let h=-1;h*i<t;h++){let f=h*i+c,u=l*r;s.fillStyle=hi(e.base,.86+a()*.26),s.fillRect(f+o/2,u+o/2,i-o,r-o)}}is(s,t,7e3,["#8f826f","#cdbfa8"],.18,1.6,62)},aggregate(s,t,e){s.fillStyle=hi(e.base,.85),s.fillRect(0,0,t,t);let n=Vs(71),i=["#c7b79a","#a39278","#d8d0bf","#8d7f69","#b8a98b","#e0d9c8","#9a8c75"];for(let r=0;r<6500;r++){let o=2.4+n()*3.8;s.fillStyle=i[Math.floor(n()*i.length)],s.beginPath(),s.ellipse(n()*t,n()*t,o,o*(.7+n()*.3),n()*3,0,Math.PI*2),s.fill()}s.fillStyle="rgba(50,44,34,0.55)",s.fillRect(0,0,t,4),s.fillRect(0,0,4,t)},kerb(s,t){s.fillStyle="#b9b7ae",s.fillRect(0,0,t,t),is(s,t,2600,["#a29f96","#cbc8bf","#aaa79e"],.4,1.6,81)}},Kl=(s,t=1024)=>up[s.kind]?fp(`pav:${s.kind}:${s.base}:${s.coarse?"c":""}:${s.broom?"b":""}`,t,(e,n)=>up[s.kind](e,n,s)):null,k1=()=>fp("pav:accessible",256,(s,t)=>Kp(s,t/2,t/2,t),{repeat:!1,aniso:8}),G1=()=>fp("pav:kerb",256,(s,t)=>up.kerb(s,t));function $n(s,t={}){let e=new He({color:s,roughness:.92,metalness:0,envMapIntensity:.25,...t});return e.userData.shared=!1,e.map&&(e.userData.disposeMap=!1),e}var Hs=.025,dx=.012,px=3;function V1(s,t,e,n,i){let r=e[0],o={x:e[1].x-r.x,y:e[1].y-r.y},a=Math.hypot(o.x,o.y)||1,l=o.x/a,c=o.y/a,h=(m,g)=>{let v=m-r.x/1e3,b=g-r.y/1e3;return[(v*l+b*c)/i,(-v*c+b*l)/i]},f=(m,g)=>[m,n(m,g)+Hs,g],u=e.map(m=>({x:m.x/1e3,y:m.y/1e3}));if(e.length===4){let m=Math.hypot(u[1].x-u[0].x,u[1].y-u[0].y),g=Math.hypot(u[3].x-u[0].x,u[3].y-u[0].y),v=Math.max(1,Math.ceil(m/px)),b=Math.max(1,Math.ceil(g/px)),y=(M,S)=>{let w=M/v,_=S/b,T=u[0].x+(u[1].x-u[0].x)*w,R=u[0].y+(u[1].y-u[0].y)*w,L=u[3].x+(u[2].x-u[3].x)*w,D=u[3].y+(u[2].y-u[3].y)*w;return{x:T+(L-T)*_,y:R+(D-R)*_}};for(let M=0;M<v;M++)for(let S=0;S<b;S++){let w=y(M,S),_=y(M+1,S),T=y(M+1,S+1),R=y(M,S+1);s.quad(t,f(w.x,w.y),f(_.x,_.y),f(T.x,T.y),f(R.x,R.y),[h(w.x,w.y),h(_.x,_.y),h(T.x,T.y),h(R.x,R.y)],[0,1,0])}return}let p=u.map(m=>new rt(m.x,m.y)),x=[];try{x=Be.triangulateShape(p,[])}catch{x=[]}for(let[m,g,v]of x)s.tri(t,f(u[m].x,u[m].y),f(u[g].x,u[g].y),f(u[v].x,u[v].y),h(u[m].x,u[m].y),h(u[g].x,u[g].y),h(u[v].x,u[v].y),[0,1,0])}function H1(s,t,e,n,i){let r=e.profile,o=Zp(r)>0;for(let a=0;a+1<n.length;a++){let l=n[a],c=n[a+1],h=c.x-l.x,f=c.y-l.y,u=Math.hypot(h,f);if(u<1)continue;let d=h/u,p=f/u,x=-p,m=d,g=(y,M)=>[(y.x+x*M)/1e3,0,(y.y+m*M)/1e3],v=(y,M)=>{let S=g(y,M.x);return S[1]=i(S[0],S[2])+Hs+M.y/1e3,S};for(let y=0;y<r.length;y++){let M=r[y],S=r[(y+1)%r.length],w=S.x-M.x,_=S.y-M.y,T=Math.hypot(w,_);if(T<1)continue;let R=o?{x:_/T,y:-w/T}:{x:-_/T,y:w/T},L=[x*R.x,R.y,m*R.x];s.quad(t,v(l,M),v(c,M),v(c,S),v(l,S),[[0,M.y/1e3],[u/1e3,M.y/1e3],[u/1e3,S.y/1e3],[0,S.y/1e3]],L)}let b=(y,M)=>{let S=r.map(_=>v(y,_)),w=[d*M,0,p*M];for(let _=1;_<S.length-1;_++)s.tri(t,S[0],S[_],S[_+1],[0,0],[0,0],[0,0],w)};b(l,-1),b(c,1)}}function W1(s,t,e,n,i){let r=e.map(o=>{let a=o.x/1e3,l=o.y/1e3;return[a,n(a,l)+Hs+i,l]});r.length<3||s.poly(t,r,r.map(o=>[o[0],o[2]]),[0,1,0])}function X1(s,t,e,n){let i=e.lengthMm/1e3,r=e.widthMm/1e3,o=e.heightMm/1e3,a=e.rotationDeg*Math.PI/180,l=Math.cos(a),c=Math.sin(a),h=e.centre.x/1e3,f=e.centre.y/1e3,u=n(h,f)+Hs,d=(m,g,v)=>[h+l*m-c*g,u+v,f+c*m+l*g],p=Math.min(.9,i/4),x=[[-i/2,0],[-i/2+p,o],[i/2-p,o],[i/2,0]];for(let m=0;m+1<x.length;m++){let[g,v]=x[m],[b,y]=x[m+1];s.quad(t,d(g,-r/2,v),d(b,-r/2,y),d(b,r/2,y),d(g,r/2,v),[[0,0],[1,0],[1,1],[0,1]],[0,1,0])}s.poly(t,[d(-i/2,-r/2,0),d(-i/2+p,-r/2,o),d(i/2-p,-r/2,o),d(i/2,-r/2,0)],[[0,0],[1,0],[1,1],[0,1]],[-c,0,l]),s.poly(t,[d(-i/2,r/2,0),d(-i/2+p,r/2,o),d(i/2-p,r/2,o),d(i/2,r/2,0)],[[0,0],[1,0],[1,1],[0,1]],[c,0,-l])}function mx(s,t,e,{model:n=null}={}){if(t?.mode!=="commercial"||!t.commercial)return null;let i=n||Js(t.commercial,t.site?.lot||null);if(!i.areas.length&&!i.kerbs.length)return null;let r=(c,h)=>e(c*1e3,h*1e3),o=new Te;o.name="commercial-pavements";let a={areas:0,kerbs:0,paint:0,stops:0,humps:0,symbols:0},l=(c,h)=>{c&&(c.userData={...c.userData,ground:!0,extras:!0,pavements:!0},c.name=h,c.renderOrder=2,o.add(c))};{let c=new ye,h={};for(let f of i.areas){let u=oc(f.type);if(u&&(V1(c,f.type,f.polygon,r,u.texture3d.tileM),a.areas+=1,!h[f.type])){let d=Kl(u.texture3d);h[f.type]=d?$n("#ffffff",{map:d,roughness:.95,polygonOffset:!0,polygonOffsetFactor:-1,polygonOffsetUnits:-1}):$n(u.colour,{polygonOffset:!0,polygonOffsetFactor:-1,polygonOffsetUnits:-1})}}l(be(c.build(),h,{ground:!0},{cast:!1,receive:!0}),"pavement-areas")}{let c=new ye,h={},f=G1();for(let u of i.kerbs){let d=Yp(u.type);d&&(H1(c,u.type,d,u.polyline,r),a.kerbs+=1,h[u.type]||(h[u.type]=f?$n("#ffffff",{map:f,color:d.colour,roughness:.88}):$n(d.colour,{roughness:.88})))}l(be(c.build(),h,{ground:!0},{cast:!0,receive:!0}),"pavement-kerbs")}{let c=new ye,h={white:$n(Oi.white,{roughness:.8,polygonOffset:!0,polygonOffsetFactor:-3,polygonOffsetUnits:-3}),yellow:$n(Oi.yellow,{roughness:.8,polygonOffset:!0,polygonOffsetFactor:-3,polygonOffsetUnits:-3}),blue:$n(Oi.blue,{roughness:.8,polygonOffset:!0,polygonOffsetFactor:-3,polygonOffsetUnits:-3}),stop:$n("#d6d3c8",{roughness:.9}),hump:$n("#c4b36b",{roughness:.9}),icon:null},f=k1();h.icon=f?$n("#ffffff",{map:f,roughness:.8,transparent:!1,polygonOffset:!0,polygonOffsetFactor:-4,polygonOffsetUnits:-4}):$n(Oi.blue,{polygonOffset:!0,polygonOffsetFactor:-4,polygonOffsetUnits:-4});let u=d=>d===Oi.yellow?"yellow":d===Oi.blue?"blue":"white";for(let d of i.items){if(!Jp(d.type))continue;let p=$p(d);if(p.solid?.type==="box"){let x=p.solid;qe(c,x.centre.x/1e3,x.centre.y/1e3,x.uMm/2e3,x.vMm/2e3,x.rotationDeg*Math.PI/180,r(x.centre.x/1e3,x.centre.y/1e3)+Hs,r(x.centre.x/1e3,x.centre.y/1e3)+Hs+x.heightMm/1e3,"stop"),a.stops+=1;continue}p.solid?.type==="hump"&&(X1(c,"hump",p.solid,r),a.humps+=1);for(let x of p.polygons)if(x.kind!=="solid"&&p.solid?.type!=="hump"){if(p.symbol&&x.colour===Oi.blue){let m=x.polygon.map(g=>{let v=g.x/1e3,b=g.y/1e3;return[v,r(v,b)+Hs+dx,b]});c.quad("icon",m[0],m[1],m[2],m[3],[[0,0],[1,0],[1,1],[0,1]],[0,1,0]),a.symbols+=1;continue}W1(c,u(x.colour),x.polygon,r,dx),a.paint+=1}}l(be(c.build(),h,{ground:!0},{cast:!1,receive:!0}),"pavement-markings")}return o.children.length?(s.add(o),{group:o,stats:a}):null}var q1=.03,gx=2.4;function dp(s,t={}){let e=new He({color:s,roughness:.93,metalness:0,envMapIntensity:.25,...t});return e.userData.shared=!1,e.map&&(e.userData.disposeMap=!1),e}function Ws(s,t,e,n,i=0){let r=(f,u)=>Math.hypot(f[0]-u[0],f[1]-u[1]),o=r(s,t),a=r(t,e),l=r(e,s),c=Math.max(o,a,l);if(c<=gx||i>8){n.push([s,t,e]);return}let h=(f,u)=>[(f[0]+u[0])/2,(f[1]+u[1])/2];if(c===o){let f=h(s,t);Ws(s,f,e,n,i+1),Ws(f,t,e,n,i+1)}else if(c===a){let f=h(t,e);Ws(s,t,f,n,i+1),Ws(s,f,e,n,i+1)}else{let f=h(e,s);Ws(s,t,f,n,i+1),Ws(f,t,e,n,i+1)}}function Y1(s){let t=s.map(i=>new rt(i.x/1e3,i.y/1e3)),e=[];try{e=Be.triangulateShape(t,[])}catch{e=[]}let n=[];for(let[i,r,o]of e)Ws([t[i].x,t[i].y],[t[r].x,t[r].y],[t[o].x,t[o].y],n);return n}function xx(s,t){if(s?.mode==="commercial")return null;let e=Vp(s);if(!e.length)return null;let n=(c,h)=>t(c*1e3,h*1e3),i=new ye,r={},o={ways:e.length,pieces:0,triangles:0,byMaterial:{}},a=[];for(let c of e){let h=Hp(s,c),f=Gp[c.material],u=oc(f.type),d=c.material;if(!r[d]){let y=u?Kl(u.texture3d):null;r[d]=y?dp("#ffffff",{map:y,polygonOffset:!0,polygonOffsetFactor:-5,polygonOffsetUnits:-5}):dp(f.colour,{polygonOffset:!0,polygonOffsetFactor:-5,polygonOffsetUnits:-5})}let p=u?.texture3d?.tileM||3,x=c.pts.length>1?Math.atan2(c.pts[1].y-c.pts[0].y,c.pts[1].x-c.pts[0].x):0,m=Math.cos(x),g=Math.sin(x),v=(y,M)=>[(y*m+M*g)/p,(-y*g+M*m)/p],b=(y,M)=>[y,n(y,M)+q1,M];for(let y of h.pieces){o.pieces+=1,o.byMaterial[c.material]=(o.byMaterial[c.material]||0)+1;for(let[S,w,_]of Y1(y.ring))i.tri(d,b(S[0],S[1]),b(w[0],w[1]),b(_[0],_[1]),v(S[0],S[1]),v(w[0],w[1]),v(_[0],_[1]),[0,1,0]),o.triangles+=1;r.edge||(r.edge=dp("#50545a",{roughness:.9,polygonOffset:!0,polygonOffsetFactor:-7,polygonOffsetUnits:-7}));let M=y.ring;for(let S=0;S<M.length;S++){let w=M[S],_=M[(S+1)%M.length],T=Math.hypot(_.x-w.x,_.y-w.y);if(T<50)continue;let R=-(_.y-w.y)/T,L=(_.x-w.x)/T,D=Math.max(1,Math.ceil(T/1e3/gx));for(let F=0;F<D;F++){let C={x:w.x+(_.x-w.x)*F/D,y:w.y+(_.y-w.y)*F/D},N={x:w.x+(_.x-w.x)*(F+1)/D,y:w.y+(_.y-w.y)*(F+1)/D},z=(O,H)=>b(O.x/1e3+R*.035*H,O.y/1e3+L*.035*H);i.quad("edge",z(C,-1),z(N,-1),z(N,1),z(C,1),[[0,0],[1,0],[1,1],[0,1]],[0,1,0])}}}a.push(h.centre)}if(i.empty)return null;let l=be(i.build(),r,{ground:!0},{cast:!1,receive:!0,name:"drawn-pavement"});return l&&(l.userData={...l.userData,ground:!0,extras:!0,drawnPavement:!0},l.renderOrder=3),{mesh:l,stats:o,centres:a}}var Sx=typeof document<"u",pp=new Map;function gp(s,t,e,{repeat:n=null,aniso:i=16}={}){if(!Sx)return null;if(pp.has(s))return pp.get(s);let r=document.createElement("canvas");r.width=t,r.height=t,e(r.getContext("2d"),t);let o=new Xn(r);return o.colorSpace=Ee,o.wrapS=In,o.wrapT=In,o.anisotropy=i,o.magFilter=le,o.minFilter=Ve,n&&o.repeat.set(n[0],n[1]),pp.set(s,o),o}function mp(s,t,e,n,i,r=1.4){let o=12345,a=()=>(o=o*1664525+1013904223>>>0)/4294967296;for(let l=0;l<e;l++)s.globalAlpha=i*(.3+a()*.7),s.fillStyle=n[Math.floor(a()*n.length)],s.fillRect(a()*t,a()*t,r*(.6+a()),r*(.6+a()));s.globalAlpha=1}var Z1=()=>gp("asphalt",512,(s,t)=>{s.fillStyle="#44474a",s.fillRect(0,0,t,t),mp(s,t,9e3,["#3a3d40","#505357","#4a4d51","#5b5e62","#34373a"],.55,1.6),mp(s,t,90,["#2c2e30","#6a6d70"],.35,3)}),_x=(s,t)=>gp(t,512,(e,n)=>{e.fillStyle=s,e.fillRect(0,0,n,n),mp(e,n,6e3,["#a9a69d","#cfccc3","#bbb8ae","#c4c1b7"],.35,1.5),e.fillStyle="rgba(60,58,52,0.55)",e.fillRect(0,0,n,3),e.fillRect(0,0,3,n)});function fe(s,t={}){let e=new He({color:s,roughness:.9,metalness:0,envMapIntensity:.3,...t});return e.userData.shared=!1,e.map&&(e.userData.disposeMap=!1),e}function jl(s,t={}){let e=new sn({color:s,...t});return e.userData.shared=!1,e}var J1=s=>[s.x/1e3,s.y/1e3];function $1(s,t,e){let n=0,i=1,r=t.x-s.x,o=t.y-s.y,a=(c,h)=>{if(c===0)return h>=0;let f=h/c;if(c<0){if(f>i)return!1;f>n&&(n=f)}else{if(f<n)return!1;f<i&&(i=f)}return!0},l=600;return a(-r,s.x-(e.x0+l))&&a(r,e.x1-l-s.x)&&a(-o,s.y-(e.y0+l))&&a(o,e.y1-l-s.y)?[{x:s.x+r*n,y:s.y+o*n},{x:s.x+r*i,y:s.y+o*i}]:null}function yx(s,t=1.5){let[e,n]=s,i=Math.hypot(n.x-e.x,n.y-e.y)/1e3,r=Math.max(1,Math.ceil(i/t));return Array.from({length:r+1},(o,a)=>({x:e.x+(n.x-e.x)*a/r,y:e.y+(n.y-e.y)*a/r}))}function K1(s,t=1.5,e=[]){let[n,i]=s,r=Math.hypot(i.x-n.x,i.y-n.y)/1e3,o=new Set,a=Math.max(1,Math.ceil(r/t));for(let l=0;l<=a;l++)o.add(l/a);for(let l of e)r>0&&l>0&&l<r&&o.add(l/r);return[...o].sort((l,c)=>l-c).map(l=>({x:n.x+(i.x-n.x)*l,y:n.y+(i.y-n.y)*l}))}function vx(s,t,e=.6){if(!t)return 1;if(s>=t[0]&&s<=t[1])return 0;let n=s<t[0]?t[0]-s:s-t[1];return Math.min(1,n/e)}function bx(s,t,e,n,{extent:i=null,tm:r=null,realAerial:o=!1}={}){let a=e.site?.lot;if(!a?.boundary?.length)return null;let l=new Te;l.name="site-extras",t.add(l);let c=(C,N)=>n(C*1e3,N*1e3),h=C=>{C&&(C.userData={...C.userData,ground:!0,extras:!0},l.add(C))},f={road:!1,driveway:!1,fences:0,houses:0,trees:0,bushes:0},u=Z1(),d=_x("#c3c0b7","concrete-path"),p=_x("#bdbab1","concrete-drive"),x=(C,N,z,O,H,U=3,W=1,Z=H)=>{let j=0,q=Math.min(z?.length||0,O?.length||0);for(let it=0;it+1<q;it++){if(!z[it]||!z[it+1]||!O[it]||!O[it+1])continue;let ft=[z[it].x/1e3,0,z[it].y/1e3],ht=[z[it+1].x/1e3,0,z[it+1].y/1e3],G=[O[it].x/1e3,0,O[it].y/1e3],Q=[O[it+1].x/1e3,0,O[it+1].y/1e3];ft[1]=c(ft[0],ft[2])+H,ht[1]=c(ht[0],ht[2])+H,G[1]=c(G[0],G[2])+Z,Q[1]=c(Q[0],Q[2])+Z;let lt=j/U;j+=Math.hypot(ht[0]-ft[0],ht[2]-ft[2]);let yt=j/U;C.quad(N,ft,ht,Q,G,[[lt,0],[yt,0],[yt,W],[lt,W]],[0,1,0])}},m=pn(a,"road")?go(a,{extendM:60}):[],g=pn(a,"driveway")&&e.mode!=="commercial"?rc(e):null,v=[];if(m.length&&i){let C=new ye;for(let N of m){let z=N.lines,O=it=>$1(it[0],it[1],i),H=Object.fromEntries(Object.entries(z).map(([it,ft])=>[it,O(ft)]));if(Object.values(H).some(it=>!it))continue;v.push(N);let U=(it,ft=1.5)=>yx(H[it],ft);x(C,"asphalt",U("gutter"),U("farGutter"),.025,6,1),x(C,"gutter",U("kerb",2),U("gutter",2),.015,3,.15,.025),x(C,"gutter",U("farGutter",2),U("farKerb",2),.025,3,.15,.015);let W=[[0,.015],[.015,.1],[.06,.145],[.13,.155],[.2,.14],[.25,.09],[.3,.045],[.34,.03]],Z=null;if(g?.ok&&g.crossover?.polygon?.length&&g.edge===N.edge){let it=H.kerb[0],ft=g.crossover.polygon.map(ht=>((ht.x-it.x)*N.u.x+(ht.y-it.y)*N.u.y)/1e3);Z=[Math.min(...ft),Math.max(...ft)]}let j=(it,ft,ht)=>{let G=K1(H[it],1.5,ht?[ht[0]-.6,ht[0],ht[1],ht[1]+.6]:[]),Q=H[it][0],lt=G.map(dt=>((dt.x-Q.x)*N.u.x+(dt.y-Q.y)*N.u.y)/1e3),yt=N.outward;for(let dt=0;dt+1<W.length;dt++)for(let xt=0;xt+1<G.length;xt++){let Vt=(Ft,Wt,Yt,B)=>{let se=[(Ft.x-yt.x*ft*Wt*1e3)/1e3,0,(Ft.y-yt.y*ft*Wt*1e3)/1e3];return se[1]=c(se[0],se[2])+.015+(Yt-.015)*B,se},nt=vx(lt[xt],ht),ct=vx(lt[xt+1],ht);if(nt===0&&ct===0)continue;let mt=Vt(G[xt],W[dt][0],W[dt][1],nt),gt=Vt(G[xt+1],W[dt][0],W[dt][1],ct),vt=Vt(G[xt],W[dt+1][0],W[dt+1][1],nt),zt=Vt(G[xt+1],W[dt+1][0],W[dt+1][1],ct);C.quad("kerb",mt,gt,zt,vt,void 0,[0,1,0])}};j("kerb",1,Z),j("farKerb",-1,null),x(C,"path",U("footpathNear",2),U("footpathFar",2),.04,1.5,1);for(let[it,ft]of[["gutter",1],["farGutter",-1]]){let ht=U(it,2),G=Q=>ht.map(lt=>({x:lt.x+N.outward.x*ft*Q,y:lt.y+N.outward.y*ft*Q}));x(C,"line",G(300),G(420),.033,1,1)}let q=U("centreline",.5);for(let it=0;it+1<q.length;it++){if(it%12>5)continue;let ft=q[it+1].x-q[it].x,ht=q[it+1].y-q[it].y,G=Math.hypot(ft,ht)||1,Q=-ht/G*55,lt=ft/G*55;x(C,"line",[{x:q[it].x+Q,y:q[it].y+lt},{x:q[it+1].x+Q,y:q[it+1].y+lt}],[{x:q[it].x-Q,y:q[it].y-lt},{x:q[it+1].x-Q,y:q[it+1].y-lt}],.033,1,1)}}if(!C.empty){let N=fe("#ffffff",{map:d,roughness:.92});h(be(C.build(),{asphalt:u?fe("#eeeeee",{map:u,roughness:.95}):fe("#45484b",{roughness:.95}),gutter:fe("#a3a19a",{roughness:.9}),kerb:fe("#b4b2aa",{roughness:.85}),path:d?N:fe("#c3c0b7"),line:fe("#f4f3ec",{roughness:.8,polygonOffset:!0,polygonOffsetFactor:-2,polygonOffsetUnits:-2})},{ground:!0},{cast:!1,receive:!0,name:"road"})),f.road=!0}}let b=(mo(a.boundary)||0)/1e6>=4e3,y=[],M=[];{let C=new ye;if(g?.ok&&!g.manual){f.driveway=!0;let O=g.widthMm/2,H=[],U=[],W=g.centre;for(let j=0;j<W.length;j++){let q=W[j],it=W[Math.min(W.length-1,j+1)],ft=W[Math.max(0,j-1)],ht=fi({x:it.x-ft.x,y:it.y-ft.y});H.push({x:q.x-ht.y*O,y:q.y+ht.x*O}),U.push({x:q.x+ht.y*O,y:q.y-ht.x*O})}x(C,"drive",H,U,.04,3,1);let Z=g.crossover.polygon;if(Z?.length>3){let j=Z.map(it=>new rt(it.x/1e3,it.y/1e3)),q=[];try{q=Be.triangulateShape(j,[])}catch{q=[]}for(let it of q){let ft=it.map(ht=>[j[ht].x,c(j[ht].x,j[ht].y)+.072,j[ht].y]);C.tri("drive",ft[0],ft[1],ft[2],[ft[0][0]/3,ft[0][2]/3],[ft[1][0]/3,ft[1][2]/3],[ft[2][0]/3,ft[2][2]/3],[0,1,0])}}y.push(W),M.push(g.polygon)}let N=xx(e,n);if(N?.mesh){h(N.mesh),f.driveway=!0,f.drawn=N.stats;for(let O of N.centres)y.push(O)}let z=e.mode==="commercial"?null:j1(e,v[0]||m[0]||null,a);if(z){let O=(m[0]||v[0])?.lines?.property;if(O){let H=z.normal,U=Hu(z.mid,Wu(H,150)),W=Q1(U,H,O[0],O[1]);if(W!=null&&W>0&&W<4e4){let Z=Hu(U,Wu(H,W)),j=yx([U,Z],1),q=500,it=j.map(ht=>({x:ht.x-H.y*q,y:ht.y+H.x*q})),ft=j.map(ht=>({x:ht.x+H.y*q,y:ht.y-H.x*q}));x(C,"path",it,ft,.045,1.5,1),y.push(j)}}}C.empty||h(be(C.build(),{drive:b?fe("#a89f8c",{roughness:1,polygonOffset:!0,polygonOffsetFactor:-4,polygonOffsetUnits:-4}):p?fe("#ffffff",{map:p,roughness:.9,polygonOffset:!0,polygonOffsetFactor:-4,polygonOffsetUnits:-4}):fe("#bdbab1",{polygonOffset:!0,polygonOffsetFactor:-4,polygonOffsetUnits:-4}),path:d?fe("#ffffff",{map:d,roughness:.92}):fe("#c3c0b7")},{ground:!0},{cast:!1,receive:!0,name:"driveway"}))}let S=[],w=[],_=(a.frontEdges||[]).filter(C=>Number.isInteger(C)&&C>=0&&C<a.boundary.length),T=pn(a,"fences");{let C=new ye,N=[];if(e.mode==="commercial"&&e.commercial)try{N=[...Js(e.commercial,a).areas.map(H=>H.polygon),...Fi(e.commercial).flatMap(H=>[H.outline,...(H.extras||[]).map(U=>U.polygon)])].filter(H=>H?.length>2)}catch{N=[]}let z=(H,U=600)=>N.some(W=>wn(H,W)||W.some((Z,j)=>sc(H,Z,W[(j+1)%W.length]).d<U)),O=(H,U)=>!z(H)&&y.every(W=>W.every((Z,j)=>j%2||Math.hypot(Z.x-H.x,Z.y-H.y)>U));for(let H of _.slice(0,2)){let U=a.boundary[H],W=a.boundary[(H+1)%a.boundary.length],Z=Math.hypot(W.x-U.x,W.y-U.y);if(Z<4e3)continue;let j=fi({x:W.x-U.x,y:W.y-U.y}),q={x:-j.y,y:j.x},it=Ui(U,W,.5);wn({x:it.x+q.x*300,y:it.y+q.y*300},a.boundary)||(q={x:-q.x,y:-q.y});let ft=(g?.widthMm||3e3)/2+700,ht=[],G=()=>{if(ht.length>2){let yt=dt=>ht.map(xt=>({x:xt.x+q.x*dt,y:xt.y+q.y*dt}));x(C,"mulch",yt(700),yt(1900),.03,2,1)}ht=[]},Q=Math.floor(Z/500);for(let yt=0;yt<=Q;yt++){let dt={x:U.x+j.x*yt*500,y:U.y+j.y*yt*500};yt*500<900||Z-yt*500<900||!O(dt,ft)||!O({x:dt.x+q.x*1300,y:dt.y+q.y*1300},ft)?G():ht.push(dt)}G();let lt=xo(5+H);for(let yt=900;yt<Z-900;yt+=1100+lt()*800){let dt={x:U.x+j.x*yt+q.x*1300,y:U.y+j.y*yt+q.y*1300};O(dt,ft)&&S.push({x:dt.x/1e3,z:dt.y/1e3,r:.35+lt()*.35,h:lt()>.8?1.1:.5+lt()*.35,seed:lt()})}}if(e.mode==="commercial")for(let H of _.slice(0,2)){let U=a.boundary[H],W=a.boundary[(H+1)%a.boundary.length],Z=Math.hypot(W.x-U.x,W.y-U.y);if(Z<12e3)continue;let j=fi({x:W.x-U.x,y:W.y-U.y}),q={x:-j.y,y:j.x},it=Ui(U,W,.5);wn({x:it.x+q.x*300,y:it.y+q.y*300},a.boundary)||(q={x:-q.x,y:-q.y});let ft=xo(41+H),ht=Math.max(1,Math.floor(Z/13e3));for(let G=0;G<ht;G++){let Q=(G+.5)/ht*Z+(ft()-.5)*2500,lt={x:U.x+j.x*Q+q.x*1500,y:U.y+j.y*Q+q.y*1500};z(lt,1800)||w.push({x:lt.x/1e3,z:lt.y/1e3,r:1.5+ft()*.5,h:4.6+ft()*1.4,seed:300+H*20+G})}}C.empty||h(be(C.build(),{mulch:fe("#4d3a29",{roughness:1})},{ground:!0},{cast:!1,receive:!0,name:"garden-beds"}))}if(T){let C=e.mode!=="commercial",N=new ye,z=a.boundary.length;for(let H=0;H<z;H++){if(_.includes(H))continue;let U=a.boundary[H],W=a.boundary[(H+1)%z],Z=Math.hypot(W.x-U.x,W.y-U.y)/1e3,j=Math.max(1,Math.round(Z/(C?2.7:2.35))),q=Math.atan2(W.y-U.y,W.x-U.x);for(let ht=0;ht<j;ht++){let G=ht/j,Q=(ht+1)/j,lt={x:U.x+(W.x-U.x)*G,y:U.y+(W.y-U.y)*G},yt={x:U.x+(W.x-U.x)*Q,y:U.y+(W.y-U.y)*Q},dt=Math.min(c(lt.x/1e3,lt.y/1e3),c(yt.x/1e3,yt.y/1e3))-.06,xt=(c(lt.x/1e3,lt.y/1e3)+c(yt.x/1e3,yt.y/1e3))/2,Vt=(lt.x+yt.x)/2e3,nt=(lt.y+yt.y)/2e3,ct=Z/j/2-.035;if(C){for(let mt of[.5,.98])qe(N,Vt,nt,ct+.035,.022,q,xt+mt-.045,xt+mt+.045,"cap");qe(N,yt.x/1e3,yt.y/1e3,.055,.055,q,dt,xt+1.2,"post")}else qe(N,Vt,nt,ct,.018,q,dt,xt+1.8,"sheet"),qe(N,Vt,nt,ct,.03,q,xt+1.78,xt+1.83,"cap"),qe(N,yt.x/1e3,yt.y/1e3,.035,.04,q,dt,xt+1.85,"post");f.fences++}let it=U,ft=c(it.x/1e3,it.y/1e3);C?qe(N,it.x/1e3,it.y/1e3,.055,.055,q,ft-.06,ft+1.2,"post"):qe(N,it.x/1e3,it.y/1e3,.035,.04,q,ft-.06,ft+1.85,"post")}let O=e.mode==="commercial"?{sheet:"#4a5056",cap:"#34383d",post:"#34383d"}:{sheet:"#8a6b47",cap:"#8a6b47",post:"#7a5d3d"};h(be(N.build(),{sheet:fe(O.sheet,{roughness:C?.9:.6,metalness:C?0:.25}),cap:fe(O.cap,{roughness:C?.9:.6,metalness:C?0:.3}),post:fe(O.post,{roughness:C?.9:.6,metalness:C?0:.3})},{ground:!0},{cast:!0,receive:!0,name:"fences"}))}if(_.length){let C=_[0],N=a.boundary[C],z=a.boundary[(C+1)%a.boundary.length],O=ui(N,z),H=fi({x:z.x-N.x,y:z.y-N.y}),U=g?.ok?Zs(Ys(g.kerbPoint,N),H):O/2,W=U>O/2?Math.max(1500,U-g.widthMm/2-1500):Math.min(O-1500,U+(g?.widthMm||3e3)/2+1500),Z={x:N.x+H.x*W,y:N.y+H.y*W},j=c(Z.x/1e3,Z.y/1e3),q=new ye,it=Math.atan2(H.y,H.x);qe(q,Z.x/1e3,Z.y/1e3,.035,.035,it,j-.05,j+.98,"post"),qe(q,Z.x/1e3,Z.y/1e3,.22,.15,it,j+.98,j+1.24,"box"),qe(q,Z.x/1e3,Z.y/1e3,.23,.16,it,j+1.24,j+1.27,"lid"),h(be(q.build(),{post:fe("#33363a",{roughness:.5,metalness:.4}),box:fe("#2f3236",{roughness:.45,metalness:.45}),lid:fe("#7e8388",{roughness:.4,metalness:.6})},{ground:!0},{cast:!0,receive:!1,name:"letterbox"}))}let L=[a.boundary,...(a.neighbours||[]).filter(C=>!C.isRoad&&C.ring?.length>2).map(C=>C.ring)].map(C=>C.map(J1)),D=!o&&(a.source==="sample"?pn(a,"houses"):a.layers?.houses===!0),F=[];if(D&&(e.mode==="commercial"?sE:iE)(l,L,c,f,F),m.length||D)for(let C of tm(L)){let N=C.x*1e3,z=C.y*1e3;i&&(N<i.x0+2e3||N>i.x1-2e3||z<i.y0+2e3||z>i.y1-2e3)||y.some(O=>O.some((H,U)=>!(U%2)&&Math.hypot(H.x-N,H.y-z)<2600))||m.some(O=>{let[H,U]=O.lines.property,W=ui(H,U)/2,Z=(H.x+U.x)/2,j=(H.y+U.y)/2,q=(N-Z)*O.u.x+(z-j)*O.u.y,it=(N-Z)*O.outward.x+(z-j)*O.outward.y;return it>0&&it<4e4&&Math.abs(q)<W+2500})||F.push({x:C.x,z:C.y,r:C.r,h:C.h,seed:C.seed})}if(F.push(...w),nE(l,F,c,f),tE(l,S,c,f),Sx&&r){let C=qu(e),N=C.length>2?Wp(C):null;if(N){let z=gp("contact",128,(Z,j)=>{let q=Z.createRadialGradient(j/2,j/2,j*.18,j/2,j/2,j/2);q.addColorStop(0,"rgba(0,0,0,0.55)"),q.addColorStop(.55,"rgba(0,0,0,0.30)"),q.addColorStop(1,"rgba(0,0,0,0)"),Z.clearRect(0,0,j,j),Z.fillStyle=q,Z.fillRect(0,0,j,j)},{aniso:4}),O=N.w/1e3+3,H=N.d/1e3+3,U=new ce(new wi(O,H),jl("#000000",{map:z,transparent:!0,depthWrite:!1,polygonOffset:!0,polygonOffsetFactor:-3,polygonOffsetUnits:-3}));U.rotation.set(-Math.PI/2,0,0);let W=new Te;W.add(U),W.rotation.y=-Math.atan2(N.u.y,N.u.x),W.position.set(N.centre.x/1e3,r.padY+.012,N.centre.y/1e3),U.userData={ground:!0,extras:!0},U.renderOrder=1,W.userData={ground:!0,extras:!0},l.add(W)}}return f}function Q1(s,t,e,n){let i={x:n.x-e.x,y:n.y-e.y},r=t.x*i.y-t.y*i.x;return Math.abs(r)<1e-9?null:((e.x-s.x)*i.y-(e.y-s.y)*i.x)/r}function j1(s,t,e){let n=[...s.levels||[]].sort((l,c)=>l.elevation-c.elevation)[0];if(!n)return null;let i=t||go(e)[0];if(!i)return null;let r=qu(s),o=r.length?Dp(r):{x:0,y:0},a=null;for(let l of n.openings||[]){if(l.kind!=="door"||l.status==="demolish")continue;let c=(n.walls||[]).find(p=>p.id===l.wallId);if(!c||c.kind!=="exterior"||Cp(c)<1)continue;let h=Lp(c,l.offset),f=Pp(c),u;c.outside===1?u=f:c.outside===-1?u={x:-f.x,y:-f.y}:u=Zs(f,Ys(h,o))>=0?f:{x:-f.x,y:-f.y},u=fi(u);let d=Zs(u,i.outward);d>.7&&(!a||d>a.score)&&(a={score:d,mid:h,normal:u})}return a}function tE(s,t,e,n){if(!t.length)return;let i=Ex(1,2,.55),r=jl("#ffffff",{vertexColors:!0}),o=new Hn(i,r,t.length),a=["#4c7f3b","#5a8c42","#3c6a33","#6e9948","#4a7a3a"],l=new ae,c=new _t;t.forEach((h,f)=>{l.position.set(h.x,e(h.x,h.z)+h.h*.35,h.z),l.scale.set(h.r,h.h,h.r),l.rotation.set(0,h.seed*6.28,0),l.updateMatrix(),o.setMatrixAt(f,l.matrix),c.set(a[Math.floor(h.seed*97)%a.length]).offsetHSL(0,0,(h.seed-.5)*.08),o.setColorAt(f,c)}),o.instanceMatrix.needsUpdate=!0,o.userData={ground:!0,extras:!0},o.castShadow=!0,o.receiveShadow=!1,o.name="bushes",s.add(o),n.bushes=t.length}function Ex(s,t,e=1,n=0){let i=new Cs(s,t),r=i.attributes.position,o=new Float32Array(r.count*3),a=new _t;for(let l=0;l<r.count;l++){let c=r.getX(l),h=r.getY(l),f=r.getZ(l),u=1+.12*Math.sin(c*5.1/s+f*3.3/s+n)*Math.cos(h*4.2/s+c*2.1/s);r.setXYZ(l,c*u,h*u*e,f*u);let d=(h/s+1)/2,p=.9+.2*(Math.sin((c*7+h*3)/s+n)*Math.cos(f*6/s)*.5+.5);a.setScalar(.62+.55*d).multiplyScalar(p),o[l*3]=a.r,o[l*3+1]=a.g,o[l*3+2]=a.b}return i.setAttribute("color",new Qt(o,3)),i.deleteAttribute("uv"),i.deleteAttribute("normal"),i}function Tx(s){let t=(s>>>0)+2654435769;return()=>{t=t+1831565813>>>0;let e=t;return e=Math.imul(e^e>>>15,e|1),e^=e+Math.imul(e^e>>>7,e|61),((e^e>>>14)>>>0)/4294967296}}function eE(s){let t=Tx(97+s*31),e=[9,11,8][s],n=[];for(let l=0;l<e;l++){let c=t()*Math.PI*2,h=s===2?.2+t()*.3:.1+t()*.42,f=s===1?.62+t()*.42:.58+t()*.38;n.push({x:Math.cos(c)*h,y:f,z:Math.sin(c)*h,rr:.11+t()*.07,sq:.5+t()*.18,tone:.9+(f-.58)*.45+(t()-.5)*.1})}let i=[],r=(l,c,h,f)=>{let u=new Float32Array(l.attributes.position.count*3);for(let d=0;d<u.length;d+=3)u[d]=c,u[d+1]=h,u[d+2]=f;return l.setAttribute("color",new Qt(u,3)),l.deleteAttribute("uv"),l.deleteAttribute("normal"),l},o=new Ei(.035,.07,.72,5,1).toNonIndexed();o.translate(0,.36,0),i.push(r(o,.74,.69,.62));for(let l=0;l<Math.min(5,e);l++){let c=n[l],h=new P(0,.5+l%2*.08,0),f=new P(c.x*.85,.34+c.y*.62-.04,c.z*.85),u=h.distanceTo(f),d=new Ei(.012,.028,u,3,1).toNonIndexed();d.translate(0,u/2,0),d.applyQuaternion(new ze().setFromUnitVectors(new P(0,1,0),f.clone().sub(h).normalize())),d.translate(h.x,h.y,h.z),i.push(r(d,.7,.65,.58))}let a=n.map((l,c)=>{let h=Ex(l.rr*1.25,1,l.sq,c*1.9+s),f=h.attributes.color;for(let u=0;u<f.count;u++)f.setXYZ(u,Math.min(1.25,f.getX(u)*l.tone+.12),Math.min(1.25,f.getY(u)*l.tone+.12),Math.min(1.25,f.getZ(u)*l.tone+.12));return h.translate(l.x,.34+l.y*.7,l.z),h});return{bark:Jl(i,!1),leaf:Jl(a,!1)}}function nE(s,t,e,n){if(!t.length)return;let i=["#7aa85a","#86ad63","#6f9a58","#8fb06a","#79a266","#93ab7c","#a0b48a","#7d9f78"],r=new ae,o=new _t,a=jl("#ffffff",{vertexColors:!0});for(let l=0;l<3;l++){let c=t.filter(p=>Math.abs(Math.floor(p.seed))%3===l);if(!c.length)continue;let{bark:h,leaf:f}=eE(l);if(!h||!f)continue;let u=new Hn(f,jl("#ffffff",{vertexColors:!0}),c.length),d=new Hn(h,a,c.length);c.forEach((p,x)=>{let m=Tx(Math.floor(p.seed*7)+x),g=.82+m()*.4;r.position.set(p.x,e(p.x,p.z)-.05,p.z),r.scale.set(p.r*2*g,p.h*(.86+m()*.3),p.r*2*(1.15-(g-.82))),r.rotation.set((m()-.5)*.06,p.seed*2.399%6.28,(m()-.5)*.06),r.updateMatrix(),u.setMatrixAt(x,r.matrix),d.setMatrixAt(x,r.matrix),o.set(i[Math.floor(m()*i.length)]),u.setColorAt(x,o)}),u.instanceMatrix.needsUpdate=!0,d.instanceMatrix.needsUpdate=!0;for(let[p,x]of[[u,"trees"],[d,"tree-trunks"]])p.userData={ground:!0,extras:!0},p.castShadow=!0,p.receiveShadow=!1,p.name=x,s.add(p)}n.trees=t.length}function iE(s,t,e,n,i){let r=new ye,o=new ye,a=new ye,l=new ye;for(let f=1;f<t.length;f++){let u=Zu(t,f),d=jp(u.W,u.depth,f),{hw:p,hd:x,setback:m,side:g}=d,v=(k,J,at)=>{let pt=_o(u,k,J);return[pt[0],at,pt[1]]},b=(k,J)=>[k*u.ux+J*u.nx,0,k*u.uy+J*u.ny],y=(k,J,at)=>{let pt=b(k,J);return[pt[0],at,pt[2]]},M=[[-p/2,m],[p/2,m],[p/2,m+x],[-p/2,m+x]],S=M.map(([k,J])=>{let at=v(k,J,0);return e(at[0],at[2])}),w=Math.min(...S)-.15,_=Math.max(...S)+.12,T=_+(d.storeys===2?5.4:2.7),R=Yu[d.wallIdx],L=(k,J,at,pt,tt,st,Mt)=>r.quad(`w${d.wallIdx}`,v(k,J,tt),v(at,pt,tt),v(at,pt,st),v(k,J,st),[[0,tt],[1,tt],[1,st],[0,st]],Mt),[D,F,C,N]=M;L(D[0],D[1],F[0],F[1],w,T,y(0,-1,0)),L(F[0],F[1],C[0],C[1],w,T,y(1,0,0)),L(C[0],C[1],N[0],N[1],w,T,y(0,1,0)),L(N[0],N[1],D[0],D[1],w,T,y(-1,0,0));let z=.5,O=p/2+z,H=m-z,U=m+x+z,W=Math.tan(22*Math.PI/180),Z=(x+2*z)/2,j=T-.12+Z*W,q=T-.12,it=(H+U)/2,ft=Math.max(.4,O-Z),ht=[-ft,ft],G=`r${d.roofIdx}`,Q=(k,J)=>{let at=b(k,J),pt=Math.cos(Math.atan(W));return[at[0]*Math.sin(Math.atan(W)),pt,at[2]*Math.sin(Math.atan(W))]};o.quad(G,v(-O,H,q),v(O,H,q),v(ht[1],it,j),v(ht[0],it,j),[[0,0],[1,0],[1,1],[0,1]],Q(0,-1)),o.quad(G,v(O,U,q),v(-O,U,q),v(ht[0],it,j),v(ht[1],it,j),[[0,0],[1,0],[1,1],[0,1]],Q(0,1)),o.tri(G,v(O,H,q),v(O,U,q),v(ht[1],it,j),[0,0],[1,0],[.5,1],Q(1,0)),o.tri(G,v(-O,U,q),v(-O,H,q),v(ht[0],it,j),[0,0],[1,0],[.5,1],Q(-1,0)),o.quad("soffit",v(-O,H,q-.02),v(O,H,q-.02),v(O,U,q-.02),v(-O,U,q-.02),[[0,0],[1,0],[1,1],[0,1]],[0,-1,0]);let lt=[[-O,H,O,H,0,-1],[O,H,O,U,1,0],[O,U,-O,U,0,1],[-O,U,-O,H,-1,0]];for(let[k,J,at,pt,tt,st]of lt)l.quad("fascia",v(k,J,q-.18),v(at,pt,q-.18),v(at,pt,q+.02),v(k,J,q+.02),[[0,0],[1,0],[1,1],[0,1]],y(tt,st,0));let dt=g*(p/2-3.4/2-.4),xt=[dt-3.2,dt+3.2],Vt=[m-1.6,m+4.5],nt=_+2.55,ct=(k,J,at,pt,tt)=>r.quad(`w${d.wallIdx}`,v(k,J,w),v(at,pt,w),v(at,pt,nt),v(k,J,nt),[[0,0],[1,0],[1,1],[0,1]],tt);ct(xt[0],Vt[0],xt[1],Vt[0],y(0,-1,0)),ct(xt[1],Vt[0],xt[1],Vt[1],y(1,0,0)),ct(xt[0],Vt[1],xt[0],Vt[0],y(-1,0,0));let mt=Math.tan(18*Math.PI/180),gt=(xt[0]+xt[1])/2,vt=(xt[1]-xt[0])/2+z,zt=nt+vt*mt,Ft=(k,J)=>[b(J,0)[0]*Math.sin(Math.atan(mt)),Math.cos(Math.atan(mt)),b(J,0)[2]*Math.sin(Math.atan(mt))];o.quad(G,v(xt[0]-z,Vt[0]-z,nt),v(xt[0]-z,Vt[1],nt),v(gt,Vt[1],zt),v(gt,Vt[0]-z,zt),[[0,0],[1,0],[1,1],[0,1]],Ft(0,-1)),o.quad(G,v(xt[1]+z,Vt[1],nt),v(xt[1]+z,Vt[0]-z,nt),v(gt,Vt[0]-z,zt),v(gt,Vt[1],zt),[[0,0],[1,0],[1,1],[0,1]],Ft(0,1)),r.tri(`w${d.wallIdx}`,v(xt[0]-z,Vt[0]-z,nt),v(xt[1]+z,Vt[0]-z,nt),v(gt,Vt[0]-z,zt),[0,0],[1,0],[.5,1],y(0,-1,0));let Wt=(k,J,at,pt,tt,st,Mt,kt,bt=.015)=>k.quad(J,v(at,Mt,tt),v(pt,Mt,tt),v(pt,Mt,st),v(at,Mt,st),[[0,0],[1,0],[1,1],[0,1]],kt,bt);Wt(l,"garagedoor",gt-2.4,gt+2.4,_,_+2.1,Vt[0]-.012,y(0,-1,0));let Yt=[-p/2+1.6,-p/2+5,p/2-5,p/2-1.6].map(k=>Math.min(Math.max(k,-p/2+.8),p/2-.8)),B=g>0?[Yt[0],Yt[1]]:[Yt[2],Yt[3]];for(let k of[...new Set(B)])Wt(a,"glass",k-.9,k+.9,_+.95,_+2.05,m-.012,y(0,-1,0));Wt(l,"door",-g*p*.18-.5,-g*p*.18+.5,_,_+2.05,m-.012,y(0,-1,0));for(let k of[-p/4,p/4])Wt(a,"glass",k-1,k+1,_+.95,_+2.05,m+x+.012,y(0,1,0));for(let k of[m+x*.3,m+x*.7])a.quad("glass",v(p/2+.012,k-.8,_+.95),v(p/2+.012,k+.8,_+.95),v(p/2+.012,k+.8,_+2.05),v(p/2+.012,k-.8,_+2.05),[[0,0],[1,0],[1,1],[0,1]],y(1,0,0));n.houses++;let se=xo(500+f);for(let k=0;k<3;k++){let J=(se()-.5)*u.W*.8,at=m+x+3+se()*Math.max(2,u.depth-m-x-6),pt=1.7+se()*1.8,tt=_o(u,J,at);i.push({x:tt[0],z:tt[1],r:pt,h:4.2+pt*1.5,seed:f*7+k})}let Kt=-g*(u.W*.28),I=e(...(()=>{let k=_o(u,Kt,u.depth-3.7);return[k[0],k[1]]})()),E=[[Kt-1.6,u.depth-5],[Kt+1.6,u.depth-5],[Kt+1.6,u.depth-2.4],[Kt-1.6,u.depth-2.4]],Y=(k,J,at)=>r.quad("shed",v(E[k][0],E[k][1],I-.1),v(E[J][0],E[J][1],I-.1),v(E[J][0],E[J][1],I+2.3),v(E[k][0],E[k][1],I+2.3),[[0,0],[1,0],[1,1],[0,1]],at);Y(0,1,y(0,-1,0)),Y(1,2,y(1,0,0)),Y(2,3,y(0,1,0)),Y(3,0,y(-1,0,0)),o.quad("shedroof",v(Kt-1.8,u.depth-5.2,I+2.3),v(Kt+1.8,u.depth-5.2,I+2.3),v(Kt+1.8,u.depth-2.2,I+2.55),v(Kt-1.8,u.depth-2.2,I+2.55),[[0,0],[1,0],[1,1],[0,1]],[0,1,0])}let c={};Yu.forEach((f,u)=>{c[`w${u}`]=fe(f,{roughness:.95})});let h={};Qp.forEach(([f],u)=>{h[`r${u}`]=fe(f,{roughness:.5,metalness:.25,side:Ne})}),r.empty||Ql(s,be(r.build(),{...c,shed:fe("#7a7f82",{roughness:.6,metalness:.2})},{ground:!0},{cast:!0,receive:!0,name:"neighbour-walls"})),o.empty||Ql(s,be(o.build(),{...h,soffit:fe("#d8d3c6"),shedroof:fe("#5d6266",{roughness:.5,metalness:.3})},{ground:!0},{cast:!0,receive:!0,name:"neighbour-roofs"})),l.empty||Ql(s,be(l.build(),{fascia:fe("#4a4f54",{roughness:.5,metalness:.2}),garagedoor:fe("#d9d6cc",{roughness:.6}),door:fe("#3d4b5c",{roughness:.6})},{ground:!0},{cast:!1,receive:!1,name:"neighbour-trim"})),a.empty||Ql(s,be(a.build(),{glass:jl("#8fb0c6",{side:Ne})},{ground:!0},{cast:!1,receive:!1,name:"neighbour-windows"}))}var Mx=["#d3d6d8","#c2c7cc","#d6d0c0","#b3bab5","#9aa2aa","#e2e1dc"];function sE(s,t,e,n){let i=new ye;for(let o=1;o<t.length;o++){let a=Zu(t,o);if(!(a.W>16)||!(a.depth>24))continue;let l=xo(900+o),c=Math.min(a.W-10,a.W*(.44+.16*l()),44),h=Math.min(a.depth-20,a.depth*(.32+.14*l()),48),f=Math.max(11,a.depth*.16+l()*4),u=5.2+l()*1.8,d=`w${Math.floor(l()*Mx.length)}`,p=(D,F,C)=>{let N=_o(a,D,F);return[N[0],C,N[1]]},x=(D,F)=>[D*a.ux+F*a.nx,0,D*a.uy+F*a.ny],m=[[-c/2,f],[c/2,f],[c/2,f+h],[-c/2,f+h]],g=m.map(([D,F])=>{let C=p(D,F,0);return e(C[0],C[2])}),v=Math.min(...g)-.15,b=Math.max(...g)+.1,y=b+u,M=c/2*Math.tan(5*Math.PI/180),S=(D,F,C)=>{i.quad("dado",p(m[D][0],m[D][1],v),p(m[F][0],m[F][1],v),p(m[F][0],m[F][1],b+1.1),p(m[D][0],m[D][1],b+1.1),[[0,0],[1,0],[1,1],[0,1]],C),i.quad(d,p(m[D][0],m[D][1],b+1.1),p(m[F][0],m[F][1],b+1.1),p(m[F][0],m[F][1],y),p(m[D][0],m[D][1],y),[[0,0],[1,0],[1,1],[0,1]],C)};S(0,1,x(0,-1)),S(1,2,x(1,0)),S(2,3,x(0,1)),S(3,0,x(-1,0));for(let[D,F]of[[f,-1],[f+h,1]])i.tri(d,p(-c/2,D,y),p(c/2,D,y),p(0,D,y+M),[0,0],[1,0],[.5,1],x(0,F));let w=.3,_=Math.cos(Math.atan(M/(c/2))),T=Math.sin(Math.atan(M/(c/2))),R=y-w*M/(c/2);for(let D of[-1,1]){let F=x(D,0);i.quad("roof",p(D*(c/2+w),f-w,R),p(D*(c/2+w),f+h+w,R),p(0,f+h+w,y+M),p(0,f-w,y+M),[[0,0],[1,0],[1,1],[0,1]],[F[0]*T,_,F[2]*T])}let L=Math.max(1,Math.min(4,Math.floor(c/12)));for(let D=0;D<L;D++){let F=(-.5+(D+.5)/L)*c*.8;i.quad("door",p(F-2.2,f-.04,b),p(F+2.2,f-.04,b),p(F+2.2,f-.04,b+4.6),p(F-2.2,f-.04,b+4.6),[[0,0],[1,0],[1,1],[0,1]],x(0,-1))}n.houses++}if(i.empty)return;let r={dado:fe("#a9a8a2",{roughness:.95}),roof:fe("#959ba1",{roughness:.7,metalness:.1,side:Ne}),door:fe("#5b636b",{roughness:.6,metalness:.2})};Mx.forEach((o,a)=>{r[`w${a}`]=fe(o,{roughness:.7,metalness:.15})}),Ql(s,be(i.build(),r,{ground:!0},{cast:!0,receive:!0,name:"neighbour-sheds"}))}function Ql(s,t){t&&(t.userData={...t.userData,ground:!0,extras:!0},s.add(t))}var rE=.01,Ax=.05,oE=.1,aE=1.2,tc=36,ss=s=>Np(s);function xp(s,t,e){let n=Math.max(e.minX-s.x,0,s.x-e.maxX),i=Math.max(e.minY-s.y,0,s.y-e.maxY),r=Math.hypot(n,i)/1e3;if(r>tc)return{d:r,q:s};if(wn(s,t))return{d:0,q:s};let o=1/0,a=s;for(let l=0;l<t.length;l++){let c=t[l],h=t[(l+1)%t.length],f=h.x-c.x,u=h.y-c.y,d=f*f+u*u,p=d?Math.max(0,Math.min(1,((s.x-c.x)*f+(s.y-c.y)*u)/d)):0,x=Math.hypot(s.x-c.x-p*f,s.y-c.y-p*u);x<o&&(o=x,a={x:c.x+p*f,y:c.y+p*u})}return{d:o/1e3,q:a}}function lE(s){let t=s.length;if(!t)return null;let e=s.reduce((f,u)=>f+u.x,0)/t,n=s.reduce((f,u)=>f+u.z,0)/t,i=s.reduce((f,u)=>f+u.y,0)/t,r=0,o=0,a=0,l=0,c=0;for(let f of s){let u=f.x-e,d=f.z-n,p=f.y-i;r+=u*u,o+=u*d,a+=d*d,l+=u*p,c+=d*p}let h=r*a-o*o;return Math.abs(h)>1e-6?{cx:e,cz:n,cy:i,gx:(l*a-c*o)/h,gz:(c*r-l*o)/h}:{cx:e,cz:n,cy:i,gx:0,gz:0}}function cE(s,t,e=Ax,n=rE){let i=Math.hypot(s,t);if(i<.002)return{gx:0,gz:0};let r=Math.min(e,Math.max(n,i))/i;return{gx:s*r,gz:t*r}}function hE(s,t,e=2e3){let n=[];for(let i of s){let r=ss(i);for(let o=r.minX+e/2;o<r.maxX;o+=e)for(let a=r.minY+e/2;a<r.maxY;a+=e)wn({x:o,y:a},i)&&n.push({x:o/1e3,z:a/1e3,y:t(o,a)});if(n.length>4e3)break}return n}var uE=.06,wx=.01,fE=.03;function dE(s,t=1500){let e=s.map((o,a)=>({poly:o,bb:ss(o),i:a})).sort((o,a)=>o.bb.minX-a.bb.minX),n=e.map((o,a)=>a),i=o=>{for(;n[o]!==o;)n[o]=n[n[o]],o=n[o];return o};for(let o=0;o<e.length;o++)for(let a=o+1;a<e.length&&e[a].bb.minX<=e[o].bb.maxX+t;a++){let l=e[o].bb,c=e[a].bb;c.minY<=l.maxY+t&&l.minY<=c.maxY+t&&(n[i(a)]=i(o))}let r=new Map;return e.forEach((o,a)=>{let l=i(a);r.has(l)||r.set(l,[]),r.get(l).push(o.poly)}),[...r.values()]}var pE=12;function mE(s,t){let{u:e,outward:n,poly:i}=s,r=i[0],o=M=>((M.x-r.x)*e.x+(M.y-r.y)*e.y)/1e3,a=M=>((M.x-r.x)*n.x+(M.y-r.y)*n.y)/1e3,l=Math.min(...i.map(o)),c=Math.max(...i.map(o)),h=Math.min(...i.map(a)),f=Math.max(...i.map(a));if(!(c>l)||!(f>h))return null;let u=Math.max(2,Math.ceil((c-l)/pE)+1),d=(c-l)/(u-1),p=(M,S)=>t(r.x+(e.x*M+n.x*S)*1e3,r.y+(e.y*M+n.y*S)*1e3),x=(h+f)/2,m=Array.from({length:u},(M,S)=>(p(l+S*d,h+.2*(f-h))+p(l+S*d,x)+p(l+S*d,f-.2*(f-h)))/3);for(let M=0;M<3;M++)m=m.map((S,w)=>w===0||w===u-1?S:(m[w-1]+2*S+m[w+1])/4);let g=uE*d;for(let M=1;M<u;M++)m[M]=Math.max(m[M-1]-g,Math.min(m[M-1]+g,m[M]));for(let M=u-2;M>=0;M--)m[M]=Math.max(m[M+1]-g,Math.min(m[M+1]+g,m[M]));let v=(p(l+(c-l)/2,f)-p(l+(c-l)/2,h))/(f-h),b=-Math.max(wx,Math.min(fE,v<0?-v:wx));return{level:(M,S)=>{let w={x:M,y:S},T=(Math.min(c,Math.max(l,o(w)))-l)/d,R=Math.min(u-2,Math.floor(T)),L=T-R;return m[R]*(1-L)+m[R+1]*L+b*(a(w)-x)},crossfall:b,grade:Math.max(...m.slice(1).map((M,S)=>Math.abs(M-m[S])/d))}}function gE(s,t=12e3){let e=new Map,n=(i,r)=>i*73856093+r*19349663;for(let i of s){let r=Math.floor(i.box.minX/t),o=Math.floor(i.box.maxX/t),a=Math.floor(i.box.minY/t),l=Math.floor(i.box.maxY/t);for(let c=r;c<=o;c++)for(let h=a;h<=l;h++){let f=n(c,h),u=e.get(f);u?u.push(i):e.set(f,[i])}}return(i,r)=>e.get(n(Math.floor(i/t),Math.floor(r/t)))||xE}var xE=[];function Rx({rawAt:s,padY:t,fp:e=null,pads:n=null,paving:i=[],driveways:r=[],corridors:o=[],cellM:a=.75}){let l=[],c=(n&&n.length?n:e?[[{x:e.minX,y:e.minY},{x:e.maxX,y:e.minY},{x:e.maxX,y:e.maxY},{x:e.minX,y:e.maxY}]]:[]).filter(_=>Array.isArray(_)&&_.length>=3),h=_=>{let T=1/0;for(let R of c)T=Math.min(T,xp(_,R,ss(R)).d);return T},f=Math.max(aE,1.5*a),u=Math.max($l,1.5*a),d=_=>{let T=null;for(let R of _)for(let L of R){let D=c.length?h(L):0;(!T||D<T.d)&&(T={d:D,q:L})}return T},p=[],x=(_,T)=>{for(let R of p)if(wn({x:_,y:T},R.poly))return R.level(_,T);return null},m=(_,{max:T,dir:R=null})=>{let L=_.filter(j=>Array.isArray(j)&&j.length>=3);if(!L.length)return;let D=0;for(let j of L){let q=ss(j);D+=(q.maxX-q.minX)*(q.maxY-q.minY)/1e6}let F=hE(L,s,Math.max(2e3,Math.sqrt(D/1500)*1e3)),C=lE(F);if(!C)return;let N=c.length?d(L):null,z=!!N&&N.d<=12,O;if(R){let j=G=>(G.x-R.o.x)/1e3*R.u.x+(G.y-R.o.y)/1e3*R.u.y,q=L.flat().reduce((G,Q)=>j(Q)>j(G)?Q:G,L[0][0]),it=Math.max(1,j(q)),ft=x(q.x,q.y)??s(q.x,q.y),ht=Math.max(-T,Math.min(T,(ft-t)/it));O={gx:R.u.x*ht,gz:R.u.y*ht}}else{O=cE(C.gx,C.gz,T);let j=null;for(let q of p)for(let it of L)for(let ft of it){let ht=xp(ft,q.poly,q.bb);ht.d<=6&&(!j||ht.d<j.d)&&(j={d:ht.d,x:ft.x,y:ft.y,lvl:q.level(ft.x,ft.y)})}if(j&&N&&z){let q=Math.hypot(O.gx,O.gz),it=q?O.gx/q:0,ft=q?O.gz/q:1,ht=(j.x-N.q.x)/1e3*it+(j.y-N.q.y)/1e3*ft;if(Math.abs(ht)>5){let G=Math.max(-T,Math.min(T,(j.lvl-t)/ht));O={gx:it*G,gz:ft*G}}}}let H=R?R.o:z?N.q:null,U=H?H.x/1e3:C.cx,W=H?H.y/1e3:C.cz,Z=H?t:C.cy;l.push({polys:L,boxes:L.map(ss),level:(j,q)=>Z+O.gx*(j/1e3-U)+O.gz*(q/1e3-W),fall:Math.hypot(O.gx,O.gz)})},g=[];for(let _ of o){let T=mE(_,s);T&&(p.push({poly:_.poly,bb:ss(_.poly),level:T.level}),g.push({polys:[_.poly],boxes:[ss(_.poly)],level:T.level,fall:T.grade,road:!0,crossfall:T.crossfall}))}let v=(_,T,R)=>{let L=F=>(F.x-T.x)*R.x+(F.y-T.y)*R.y,D=[];for(let F=0;F<_.length;F++){let C=_[F],N=_[(F+1)%_.length],z=L(C),O=L(N);if(z<=0&&D.push(C),z<0&&O>0||z>0&&O<0){let H=z/(z-O);D.push({x:C.x+(N.x-C.x)*H,y:C.y+(N.y-C.y)*H})}}return D},b=i.filter(_=>Array.isArray(_)&&_.length>=3).map(_=>{let T=_;for(let R of o)T.length>=3&&(T=v(T,R.poly[0],R.outward));return T}).filter(_=>_.length>=3&&mo(_)>1e5);if(b.length)for(let _ of dE(b))m(_,{max:Ax});for(let _ of r){let T=_.polys.filter(R=>Array.isArray(R)&&R.length>=3).map(R=>{let L=R;for(let D of o)L.length>=3&&(L=v(L,D.poly[0],D.outward));return L}).filter(R=>R.length>=3&&mo(R)>1e5);m(T,{max:oE,dir:_.dir})}if(l.push(...g),!l.length)return null;let y=c.map(_=>({polys:[_],boxes:[ss(_)],level:()=>t,fall:0,pad:!0}));l.unshift(...y),l.forEach((_,T)=>{_.rank=T,_.band=_.pad?u:f});let M=[];l.forEach(_=>_.polys.forEach((T,R)=>{let L=_.boxes[R],D=(tc+_.band)*1e3;M.push({z:_,poly:T,bb:L,box:{minX:L.minX-D,maxX:L.maxX+D,minY:L.minY-D,maxY:L.maxY+D}})}));let S=gE(M);return{zones:l,heightAt:(_,T,R)=>{let L={x:_,y:T},D=null,F=1/0,C=L,N=1/0;for(let U of S(_,T)){let W=Math.max(U.bb.minX-_,0,_-U.bb.maxX),Z=Math.max(U.bb.minY-T,0,T-U.bb.maxY),j=Math.hypot(W,Z)/1e3;if(j>tc+U.z.band||(N<0?j>0:j>=N))continue;let q=xp(L,U.poly,U.bb);if(q.d>tc+U.z.band)continue;let it=q.d===0?-1+U.z.rank*1e-6:q.d+U.z.rank*1e-9;it<N&&(N=it,D=U.z,F=q.d,C=q.q)}if(!D)return R;let z=D.band;if(F<=z)return D.level(_,T);if(F>tc+z)return R;let O=z/F,H=D.level(C.x+(_-C.x)*O,C.y+(T-C.y)*O);return Fu(R,H,F-z+$l)},band:f}}function Cx(s,t,e){let n=0,i=0;for(let r=0;r<s.rows;r++)for(let o=0;o<s.cols;o++){let a=s.x0+o*s.dx,l=s.y0+r*s.dy,c=s.heights[r*s.cols+o]-t(a,l);c>.005?i+=c*e:c<-.005&&(n+=-c*e)}return{cutM3:Math.round(n),fillM3:Math.round(i)}}var ec=[1,1,1],Px=[.1,.13,.16],_E=[.07,.07,.07],zu=[.16,.17,.18],Ix=["#e9eaec","#c9ccd1","#2b2e33","#8d9299","#f4f4f2","#7b1f24","#2f4a73","#5c6166","#b9b2a3","#1d1f22"],_p=s=>{let t=Math.sin(s*127.1+311.7)*43758.5453;return t-Math.floor(t)};function Lx(){let s=[],t=[],e=(a,l,c,h)=>{s.push(...a,...l,...c),t.push(...h,...h,...h)},n=(a,l,c,h,f)=>{e(a,l,c,f),e(a,c,h,f)};return{prism:(a,l,c,h,f,u,d,p=null,x=null)=>{let[m,g,v,b]=p||[a,l,f,u],y=[[a,c,f],[l,c,f],[l,c,u],[a,c,u]],M=[[m,h,v],[g,h,v],[g,h,b],[m,h,b]],S=x||d;n(M[3],M[2],M[1],M[0],d),n(y[0],y[1],y[2],y[3],d),n(y[1],y[0],M[0],M[1],S),n(y[3],y[2],M[2],M[3],S),n(y[0],y[3],M[3],M[0],S),n(y[2],y[1],M[1],M[2],S)},wheel:(a,l,c,h)=>{for(let u=0;u<10;u++){let d=u/10*Math.PI*2,p=(u+1)/10*Math.PI*2,x=(m,g)=>[a+Math.cos(m)*c,c+Math.sin(m)*c,g];n(x(d,l-h/2),x(p,l-h/2),x(p,l+h/2),x(d,l+h/2),_E),e([a,c,l-h/2],x(p,l-h/2),x(d,l-h/2),zu),e([a,c,l+h/2],x(d,l+h/2),x(p,l+h/2),zu)}},quad:n,tri:e,build:()=>{let a=new qt;return a.setAttribute("position",new At(s,3)),a.setAttribute("color",new At(t,3)),a.computeVertexNormals(),a}}}function yE(){let s=Lx();s.prism(-2.2,2.2,.26,.82,-.9,.9,ec,[-2.14,2.1,-.86,.86]),s.prism(-2.2,2.2,.2,.3,-.88,.88,zu),s.prism(-1.75,1.05,.82,1.44,-.84,.84,ec,[-1.3,.35,-.72,.72],Px);for(let t of[-1.38,1.36])for(let e of[-.84,.84])s.wheel(t,e,.33,.2);return s.build()}function vE(){let s=Lx();s.prism(-4.3,4.2,.55,.95,-1.05,1.05,zu),s.prism(-4.3,2.35,.95,3.75,-1.24,1.24,ec),s.prism(2.55,4.3,.55,1.75,-1.2,1.2,ec),s.prism(2.55,4.3,1.75,2.75,-1.2,1.2,ec,[2.6,4.05,-1.14,1.14],Px);for(let t of[-3,-1.85,3.3])for(let e of[-1.08,1.08])s.wheel(t,e,.5,.3);return s.build()}function ME(s){let t=s?.commercial,e={cars:[],trucks:[]};if(s?.mode!=="commercial"||!t)return e;let n=[];try{n.push(...kp(t).rows)}catch{}try{n.push(...zp(t).rows)}catch{}let i=0,r=!1;for(let o of n)for(let a of o.slots||[]){if(i+=1,a.kind&&a.kind!=="bay"){r=!1;continue}let l=a.poly;if(!l||l.length<4)continue;let c=_p(i*7+3)<(r?.22:.42);if(r=c,!c)continue;let h=(l[0].x+l[1].x+l[2].x+l[3].x)/4,f=(l[0].y+l[1].y+l[2].y+l[3].y)/4,u=l[3].x-l[0].x,d=l[3].y-l[0].y,p=_p(i*13+1)<.3?Math.PI:0;e.cars.push({x:h,y:f,ang:Math.atan2(d,u)+p,colour:Ix[Math.floor(_p(i*31+9)*Ix.length)]})}for(let o of Fi(t)){let a=[];try{let b=Bp(o,s),y=new Map(b.walls.map(M=>[M.id,M]));a=b.openings.filter(M=>M.kind==="roller_door"&&(M.sill||0)>=900).map(M=>({o:M,w:y.get(M.wallId)})).filter(M=>M.w)}catch{a=[]}if(!a.length)continue;let{o:l,w:c}=a[0],h=c.a||c.start,f=c.b||c.end;if(!h||!f)continue;let u=Math.hypot(f.x-h.x,f.y-h.y)||1,d={x:(f.x-h.x)/u,y:(f.y-h.y)/u},p={x:h.x+d.x*(l.offset+l.width/2),y:h.y+d.y*(l.offset+l.width/2)},x=o.outline||[],m=x.length?{x:x.reduce((b,y)=>b+y.x,0)/x.length,y:x.reduce((b,y)=>b+y.y,0)/x.length}:{x:NaN,y:NaN},g={x:-d.y,y:d.x},v=Fp(o.place,{x:0,y:-1});(Number.isFinite(m.x)?g.x*(p.x-m.x)+g.y*(p.y-m.y)<0:g.x*v.x+g.y*v.y<0)&&(g={x:-g.x,y:-g.y}),e.trucks.push({x:p.x+g.x*4600,y:p.y+g.y*4600,ang:Math.atan2(g.y,g.x)})}return e}function Dx(s,t,e){let n=ME(t);if(!n.cars.length&&!n.trucks.length)return null;let i=new Te;i.name="commercial-entourage";let r=new ae,o=new _t,a=(l,c,h,f)=>{if(!c.length)return;let u=new He({vertexColors:!0,roughness:.42,metalness:.15,envMapIntensity:.9});u.userData.shared=!1;let d=new Hn(l,u,c.length);c.forEach((p,x)=>{let m=p.x/1e3,g=p.y/1e3;r.position.set(m,e(p.x,p.y)+.06,g),r.rotation.set(0,-p.ang,0),r.updateMatrix(),d.setMatrixAt(x,r.matrix),d.setColorAt(x,o.set(f(p,x)))}),d.instanceMatrix.needsUpdate=!0,d.instanceColor&&(d.instanceColor.needsUpdate=!0),d.name=h,d.castShadow=!0,d.receiveShadow=!0,d.userData={ground:!0,extras:!0,entourage:!0},i.add(d)};return a(yE(),n.cars,"entourage-cars",l=>l.colour),a(vE(),n.trucks,"entourage-trucks",()=>"#f1f1ee"),i.userData={ground:!0,extras:!0},s.add(i),{cars:n.cars.length,trucks:n.trucks.length}}var SE=["fuel-canopy","truck-canopy","pump-island","underground-tank-pad","air-water-bay"];function Nx(s,t,e){let n=t?.commercial;if(t?.mode!=="commercial"||!n?.buildings?.length)return 0;let i=(h,f)=>e(h*1e3,f*1e3),r=new ye,o=0;for(let h of Fi(n)){if(!h.extras.some(w=>w.kind==="fuel-canopy"||w.kind==="truck-canopy"))continue;let f=h.extras.filter(w=>SE.includes(w.kind)).flatMap(w=>w.polygon.map(_=>Xu(h.place,_))),u=(h.outline||[]).map(w=>Xu(h.place,w)).filter(w=>Math.abs(w.y)<1),d=Op([...f,...u]),p=2500,x=[{x:d.minX-p,y:d.minY-p},{x:d.maxX+p,y:d.minY-p},{x:d.maxX+p,y:-150},{x:d.minX-p,y:-150}].map(w=>Up(h.place,w)),[m,g,v,b]=x.map(w=>({x:w.x/1e3,y:w.y/1e3})),y=Math.max(1,Math.ceil(Math.hypot(g.x-m.x,g.y-m.y))),M=Math.max(1,Math.ceil(Math.hypot(b.x-m.x,b.y-m.y))),S=(w,_)=>{let T=w/y,R=_/M,L=m.x+(g.x-m.x)*T,D=m.y+(g.y-m.y)*T,F=b.x+(v.x-b.x)*T,C=b.y+(v.y-b.y)*T,N=L+(F-L)*R,z=D+(C-D)*R;return{v:[N,i(N,z)+.025,z],uv:[T*y/4,R*M/4]}};for(let w=0;w<y;w++)for(let _=0;_<M;_++){let T=S(w,_),R=S(w+1,_),L=S(w+1,_+1),D=S(w,_+1);r.quad("concrete",T.v,R.v,L.v,D.v,[T.uv,R.uv,L.uv,D.uv],[0,1,0])}o+=1}if(!o)return 0;let a=Kl({kind:"concrete",base:"#c9c7c0",broom:!0}),l=new He({color:a?"#ffffff":"#c9c7c0",map:a||null,roughness:.94,metalness:0,envMapIntensity:.25,polygonOffset:!0,polygonOffsetFactor:-1,polygonOffsetUnits:-1});l.userData.shared=!1,l.userData.disposeMap=!1;let c=be(r.build(),{concrete:l},{ground:!0},{cast:!1,receive:!0});return c?(c.name="forecourt-slabs",c.userData={...c.userData,ground:!0,extras:!0,pavements:!0},c.renderOrder=1,s.add(c),o):0}var ku="#6f8a58",Ux="#a89a62",Fx="#8b8e92",bE="#a7aaae",EE="#9aa88a";function TE(s){let t=[...s.levels].sort((n,i)=>n.elevation-i.elevation)[0];if(!t)return null;let e=[];for(let n of t.walls)e.push(n.a,n.b);for(let n of t.rooms)e.push(...n.polygon);return e.length?{minX:Math.min(...e.map(n=>n.x)),maxX:Math.max(...e.map(n=>n.x)),minY:Math.min(...e.map(n=>n.y)),maxY:Math.max(...e.map(n=>n.y))}:null}function wE(s,t,e){let n=[];s.mode==="commercial"&&s.commercial?n=Fi(s.commercial).map(o=>o.outline):e&&(n=[[{x:e.minX,y:e.minY},{x:e.maxX,y:e.minY},{x:e.maxX,y:e.maxY},{x:e.minX,y:e.maxY}]]);let i=0,r=0;for(let o of n){if(!o||o.length<3)continue;let a=o.map(p=>p.x),l=o.map(p=>p.y),c=Math.min(...a),h=Math.max(...a),f=Math.min(...l),u=Math.max(...l),d=Math.max(500,Math.max(h-c,u-f)/24);for(let p=c+d/2;p<h;p+=d)for(let x=f+d/2;x<u;x+=d){if(!wn({x:p,y:x},o))continue;let m=op(t.terrain,p,x);m!=null&&(i+=m,r++)}}return r?i/r:null}function AE(s,t={}){let e=s.site?.lot;if(!e)return null;let n=qp(e),i=[...s.levels].sort((f,u)=>f.elevation-u.elevation)[0],r=(i?i.elevation:0)/1e3,o=TE(s),a=r-.15;if(e.terrain&&!Number.isFinite(e.floorRL)){let f=wE(s,e,o);f!=null&&(n=f+.15)}let l=(f,u)=>{if(!e.terrain)return a;let d=op(e.terrain,f,u);return d==null?a:d-n+r},c=null;if(e.terrain)try{let f=s.mode==="commercial"&&s.commercial?Js(s.commercial,e).areas.map(p=>p.polygon):[],u=[];if(s.mode!=="commercial"&&o){let p=rc(s);if(p?.ok&&p.polygon?.length>=3&&p.centre?.length>=2){let x=p.centre[0],m=p.centre[p.centre.length-1],g=Math.hypot(m.x-x.x,m.y-x.y)||1,v=Uu(o,x.x,x.y),b=Uu(o,m.x,m.y),[y,M]=v<=b?[x,m]:[m,x];u.push({polys:[p.polygon,...p.crossover?.polygon?.length>3?[p.crossover.polygon]:[]],dir:{o:y,u:{x:(M.x-y.x)/g,y:(M.y-y.y)/g}}})}}let d=[];if(pn(e,"road"))for(let p of go(e,{extendM:60})){let x=p.lines;d.push({poly:[x.footpathNear[0],x.footpathNear[1],x.farKerb[1],x.farKerb[0]].map(m=>({x:m.x,y:m.y})),u:p.u,outward:p.outward})}c=Rx({rawAt:l,padY:a,fp:o,pads:s.mode==="commercial"&&s.commercial?Fi(s.commercial).map(p=>p.outline).filter(p=>p?.length>=3):null,paving:f,driveways:u,corridors:d,cellM:t.cellM||.75})}catch(f){console.warn("[viewer3d] auto grading skipped",f)}return{heightAt:(f,u)=>{let d=l(f,u);return c?c.heightAt(f,u,d):o?Fu(d,a,Uu(o,f,u)):d},rawAt:l,grading:c,floorRL:n,base:r,padY:a}}function WT(s,t=ku){try{let e=s?.width,n=s?.height;if(!e||!n||typeof document>"u")return t;let i=document.createElement("canvas");i.width=16,i.height=16;let r=i.getContext("2d",{willReadFrequently:!0});r.drawImage(s,0,0,16,16);let o=r.getImageData(0,0,16,16).data,a=0,l=0,c=0,h=0;for(let f=0;f<16;f++)for(let u=0;u<16;u++){if(u>1&&f>1&&u<14&&f<14)continue;let d=(f*16+u)*4;a+=o[d],l+=o[d+1],c+=o[d+2],h++}return`#${[a,l,c].map(f=>Math.round(f/h).toString(16).padStart(2,"0")).join("")}`}catch{return t}}function RE(s,t={}){let e=new sn({color:s,...t});return e.userData.shared=!1,e}function po(s,t,e,{half:n,color:i,lift:r=0,userData:o={},order:a=2}){let l=[],c=[];for(let d of e){let p=sx(d.pts,n,d.closed),x=l.length/3;for(let m of p.positions)l.push(m);for(let m of p.indices)c.push(x+m)}if(!c.length)return null;let h=new qt;h.setAttribute("position",new At(l,3)),h.setIndex(c);let f=RE(i,{side:Ne,polygonOffset:!0,polygonOffsetFactor:-2-a,polygonOffsetUnits:-2-a}),u=new ce(h,f);return u.name=t,u.castShadow=!1,u.receiveShadow=!1,u.renderOrder=a,u.userData={ground:!0,...o},s.add(u),u}function Ox(s,t){if(typeof document>"u")return null;let e=t==="lot",n=e?34:28,i=14,r=(x,m)=>`${m} ${x}px Barlow, "Helvetica Neue", Arial, sans-serif`,o=document.createElement("canvas"),a=o.getContext("2d");a.font=r(n,700);let l=Math.ceil(Math.max(...s.map(x=>a.measureText(x).width))+i*2),c=n*1.25,h=Math.ceil(s.length*c+i*2);o.width=l,o.height=h,a.font=r(n,700),a.textAlign="center",a.textBaseline="middle",a.lineJoin="round";let f=Math.min(h/2-1,s.length>1?20:h/2);a.beginPath(),a.moveTo(1+f,1),a.arcTo(l-1,1,l-1,h-1,f),a.arcTo(l-1,h-1,1,h-1,f),a.arcTo(1,h-1,1,1,f),a.arcTo(1,1,l-1,1,f),a.closePath(),a.fillStyle="rgba(255,255,255,0.76)",a.fill(),a.lineWidth=1.5,a.strokeStyle=e?"rgba(166,27,27,0.55)":"rgba(58,63,51,0.35)",a.stroke(),s.forEach((x,m)=>{let g=i+c*(m+.5);a.font=r(m===0?n:n*.86,m===0?700:600),a.fillStyle=e?"#a61b1b":"#3a3f33",a.fillText(x,l/2,g)});let u=new Xn(o);u.colorSpace=Ee,u.anisotropy=4;let d=new Ji({map:u,transparent:!0,depthTest:!0,depthWrite:!1,sizeAttenuation:!1,toneMapped:!1});d.userData.shared=!1,d.userData.disposeMap=!0;let p=new Ts(d);return p.scale.y=(e?.021:.016)*s.length+.01,p.scale.x=p.scale.y*(l/h),p.renderOrder=20,p}function zx(s,t){let e=t?.image,n=new rt(e?.width||1024,e?.height||1024);return s.onBeforeCompile=i=>{i.uniforms.uAerialSize={value:n},i.vertexShader=i.vertexShader.replace("#include <common>",`#include <common>
varying vec2 vAerialW;`).replace("#include <begin_vertex>",`#include <begin_vertex>
vAerialW = (modelMatrix * vec4(position, 1.0)).xz;`),i.fragmentShader=i.fragmentShader.replace("#include <common>",`#include <common>
uniform vec2 uAerialSize;
varying vec2 vAerialW;
float aerialHash(vec2 p) { p = fract(p * vec2(0.1031, 0.1030)); p += dot(p, p.yx + 33.33); return fract((p.x + p.y) * p.x); }
float aerialNoise(vec2 p) { vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(aerialHash(i), aerialHash(i + vec2(1.0, 0.0)), f.x), mix(aerialHash(i + vec2(0.0, 1.0)), aerialHash(i + vec2(1.0, 1.0)), f.x), f.y); }`).replace("#include <map_fragment>",`#ifdef USE_MAP
  vec2 aTx = vMapUv * uAerialSize - 0.5;
  vec2 aI = floor(aTx);
  vec2 aF = fract(aTx);
  float aFp = max(length(dFdx(aTx)), length(dFdy(aTx)));       // texels per screen pixel: below 1 the picture is magnified
  float aK = 1.0 - smoothstep(0.18, 0.75, aFp);                 // 0 at about 1:1, 1 when a texel covers five or more pixels
  vec2 aS = smoothstep(0.0, 1.0, smoothstep(0.0, 1.0, aF));
  vec2 aUv = (aI + mix(aF, aS, aK) + 0.5) / uAerialSize;
  vec4 sampledDiffuseColor = textureGrad(map, aUv, dFdx(vMapUv), dFdy(vMapUv));
  float aW = max(length(dFdx(vAerialW)), length(dFdy(vAerialW))); // metres per screen pixel
  float aG = (aerialHash(floor(vAerialW / 0.03)) - 0.5) * 0.20 * (1.0 - smoothstep(0.012, 0.03, aW))
           + (aerialNoise(vAerialW / 0.11) - 0.5) * 0.20 * (1.0 - smoothstep(0.04, 0.10, aW))
           + (aerialNoise(vAerialW / 0.42 + 17.0) - 0.5) * 0.14 * (1.0 - smoothstep(0.15, 0.38, aW));
  sampledDiffuseColor.rgb *= 1.0 + aG * aK;
  diffuseColor *= sampledDiffuseColor;
#endif`)},s.customProgramCacheKey=()=>"aerial-sharp-1",s}var CE=[1.3,1,1.04],IE=.6,PE=150,LE=2;function Bx(s,t,e,n=null,i=!1){if(typeof document>"u")return null;let r=s.lib.get("grass",Bu);if(!r?.map)return null;let o=(e.x1-e.x0)/1e3,a=(e.y1-e.y0)/1e3,l=1024/Math.max(o,a),c=document.createElement("canvas");c.width=Math.max(8,Math.round(o*l)),c.height=Math.max(8,Math.round(a*l));let h=c.getContext("2d");h.fillStyle="#000",h.fillRect(0,0,c.width,c.height),h.fillStyle="#fff";let f=[t.boundary,...(t.neighbours||[]).filter(w=>!w.isRoad&&w.ring?.length>2).map(w=>w.ring)];for(let w of f)h.beginPath(),w.forEach((_,T)=>{let R=(_.x-e.x0)/1e3*l,L=(_.y-e.y0)/1e3*l;T?h.lineTo(R,L):h.moveTo(R,L)}),h.closePath(),h.fill();let u=new Xn(c);u.flipY=!1,u.magFilter=le,u.minFilter=Ve,u.anisotropy=8;let d=r.map.clone(),p=1/(r.map.repeat.x||1),x=1/(r.map.repeat.y||1);d.repeat.set(o/p,a/x),d.needsUpdate=!0;let m=new He({color:r.color.clone(),map:d,roughness:1,metalness:0,envMapIntensity:.25});m.userData.shared=!1,m.userData.disposeMap=!0,m.userData.lotMask=u,m.addEventListener("dispose",()=>u.dispose()),n&&(n.colorSpace=Ee,n.wrapS=Ce,n.wrapT=Ce,n.magFilter=le,n.generateMipmaps=!0,n.minFilter=Ve,n.anisotropy=Math.max(n.anisotropy||1,8),n.needsUpdate=!0);let g=t.boundary||[],v=g.reduce((w,_)=>w+_.x,0)/Math.max(1,g.length),b=g.reduce((w,_)=>w+_.y,0)/Math.max(1,g.length),y=g.reduce((w,_)=>Math.max(w,Math.hypot(_.x-v,_.y-b)),0)/1e3,M=Math.max(PE,y*1.15),S=new rt((v-e.x0)/1e3/o,1-(b-e.y0)/1e3/a);return m.onBeforeCompile=w=>{w.uniforms.uLotMask={value:u},w.uniforms.uFadeC={value:S},w.uniforms.uFadeR={value:new rt(M,M*LE)},w.uniforms.uExtM={value:new rt(o,a)},n&&(w.uniforms.uAerialTex={value:n}),w.uniforms.uPaddock={value:new P(...CE)},w.vertexShader=w.vertexShader.replace("#include <common>",`#include <common>
varying vec2 vLotUv;
varying vec2 vAerUv;`).replace("#include <begin_vertex>",`#include <begin_vertex>
vLotUv = vec2(uv.x, 1.0 - uv.y);
vAerUv = uv;`),w.fragmentShader=w.fragmentShader.replace("#include <common>",`#include <common>
uniform sampler2D uLotMask;
uniform vec3 uPaddock;
varying vec2 vLotUv;
varying vec2 vAerUv;`+(n?`
uniform sampler2D uAerialTex;
uniform vec2 uFadeC;
uniform vec2 uFadeR;
uniform vec2 uExtM;`:"")).replace("#include <map_fragment>",`#include <map_fragment>
  float lotM = texture2D(uLotMask, vLotUv).r;
  // outside the lots: the dry paddock tone, with the mowing bands flattened (fine grain kept)
  vec3 lawnC = diffuseColor.rgb;
  float lawnL = dot(lawnC, vec3(0.3333));
  vec3 padC = diffuse * uPaddock * mix(0.9, lawnL / max(dot(diffuse, vec3(0.3333)), 0.001), 0.25);
  ${n?"lawnC = diffuse * mix(1.0, lawnL / max(dot(diffuse, vec3(0.3333)), 0.001), 0.2); // weak mowing stripes under a real aerial":""}
  diffuseColor.rgb = mix(padC, lawnC, lotM);
${n?`  vec3 aerC = texture2D(uAerialTex, vAerUv).rgb;
  float dM = length((vAerUv - uFadeC) * uExtM);
  float nearK = 1.0 - smoothstep(uFadeR.x, uFadeR.y, dM);
  vec3 aerSoft = mix(vec3(dot(aerC, vec3(0.3333))), aerC, 0.85) * 1.08;
  vec3 aerFull = aerC * 1.06;
  diffuseColor.rgb = mix(mix(diffuseColor.rgb, aerSoft, ${(i?.92:IE).toFixed(2)}), aerFull, nearK);`:""}`)},m.customProgramCacheKey=()=>n?i?"lawn-ground-aerial-5w":"lawn-ground-aerial-5":"lawn-ground-2",m}function XT(s,t,e,{texture:n=null,edgeColour:i=null,wideTexture:r=null,wideEdgeColour:o=null,showContours:a=!1}={}){let l=e.site?.lot,c=tx(l,30),h=c?rp(c):null,f=AE(e,{cellM:h?Math.max(h.dx,h.dy)/1e3:.75});if(!f||!jg(e))return null;let u=c;if(!u)return null;let{cols:d,rows:p}=h,x=new Float32Array(d*p),m=new Float32Array(d*p*3),g=new Float32Array(d*p*2),v=!!(n&&l.aerial?.extent&&pn(l,"aerial")),b=!v&&l.aerialSource==="none",y=u.x1-u.x0,M=u.y1-u.y0;for(let G=0;G<p;G++)for(let Q=0;Q<d;Q++){let lt=h.x0+Q*h.dx,yt=h.y0+G*h.dy,dt=f.heightAt(lt,yt),xt=G*d+Q;x[xt]=dt,m[xt*3]=lt/1e3,m[xt*3+1]=dt,m[xt*3+2]=yt/1e3,g[xt*2]=Q/(d-1),g[xt*2+1]=1-G/(p-1)}let S=new qt;S.setAttribute("position",new Qt(m,3)),S.setAttribute("uv",new Qt(g,2)),S.setIndex(ap(d,p)),S.computeVertexNormals();let w=null,_=v?Bx(s,l,u,n,!!r):null;_?w=_:v?(n.colorSpace=Ee,n.wrapS=Ce,n.wrapT=Ce,n.magFilter=le,n.generateMipmaps=!0,n.minFilter=Ve,n.anisotropy=Math.max(n.anisotropy||1,16),n.needsUpdate=!0,w=new He({map:n,roughness:1,metalness:0,envMapIntensity:.25}),w.userData.shared=!1,zx(w,n)):w=b?s.lib.get("grass",Fx,{flat:!0}):Bx(s,l,u)||s.lib.get("grass",Bu);let T=new ce(S,w);T.name="site-terrain",T.receiveShadow=!0,T.castShadow=!1,T.userData={ground:!0,siteTerrain:!0,frame:!1},t.add(T);let R={cols:d,rows:p,x0:h.x0,y0:h.y0,dx:h.dx,dy:h.dy,heights:x},L=(G,Q)=>nx(R,G,Q),D=v&&r?DE(t,l,f,u,r):null,F=D?D.nodes:lp(d,p).map(G=>({x:m[(G.j*d+G.i)*3],y:x[G.j*d+G.i],z:m[(G.j*d+G.i)*3+2],dir:G.dir})),C=0;for(let G of F)C+=G.y;let N=F.length?C/F.length:f.padY,z=ax(F,N-.05),O=b?new _t(Fx):D?new _t(o||ku):!v||_?new _t(Ux):new _t(i||ku).lerp(new _t(ku),.55).multiplyScalar(1.12),H=new _t(b?bE:!v||_?Ux:EE),U=[];for(let G of z.colourT){let Q=O.clone().lerp(H,G);U.push(Q.r,Q.g,Q.b)}let W=new qt;W.setAttribute("position",new At(z.positions,3)),W.setAttribute("color",new At(U,3)),W.setIndex(z.indices);let Z=new sn({vertexColors:!0,side:Ne});Z.userData.shared=!1;let j=new ce(W,Z);j.name="site-horizon",j.userData={ground:!0,horizon:!0},j.frustumCulled=!1,t.add(j),NE(t,l,L,{showContours:a});let q=null;try{q=bx(s,t,e,L,{extent:u,tm:f,realAerial:!!n||!!(l.aerial?.extent&&pn(l,"aerial"))})}catch(G){console.warn("[viewer3d] site extras skipped",G)}try{e.mode==="commercial"&&mx(t,e,L)}catch(G){console.warn("[viewer3d] commercial pavements skipped",G)}try{e.mode==="commercial"&&(Nx(t,e,L),Dx(t,e,L))}catch(G){console.warn("[viewer3d] commercial entourage skipped",G)}let it=D?D.extent.x1-D.extent.x0:y,ft=D?D.extent.y1-D.extent.y0:M,ht=null;if(f.grading)try{ht=Cx(R,f.rawAt,h.dx/1e3*(h.dy/1e3))}catch{ht=null}return{extras:q,earthworks:ht,edgeY:N,extent:u,wideExtent:D?D.extent:null,grid:R,outerR:Nu[Nu.length-1]+Math.max(it,ft)/2e3}}function DE(s,t,e,n,i){let r=t.aerialWide?.extent;if(!r||![r.x0,r.y0,r.x1,r.y1].every(Number.isFinite)||!(r.x1>r.x0&&r.y1>r.y0)||!(r.x0<=n.x0&&r.y0<=n.y0&&r.x1>=n.x1&&r.y1>=n.y1)||!pn(t,"aerial"))return null;let o=rp(r,4e3,170),{cols:a,rows:l}=o,c=new Float32Array(a*l*3),h=new Float32Array(a*l*2),f=new Float32Array(a*l);for(let b=0;b<l;b++)for(let y=0;y<a;y++){let M=o.x0+y*o.dx,S=o.y0+b*o.dy,w=e.heightAt(M,S),_=b*a+y;f[_]=w,c[_*3]=M/1e3,c[_*3+1]=w-.08,c[_*3+2]=S/1e3,h[_*2]=y/(a-1),h[_*2+1]=1-b/(l-1)}let u=ap(a,l),d=[],p=1;for(let b=0;b<u.length;b+=3){let y=!0;for(let M=0;M<3;M++){let S=u[b+M],w=c[S*3]*1e3,_=c[S*3+2]*1e3;if(!(w>=n.x0-p&&w<=n.x1+p&&_>=n.y0-p&&_<=n.y1+p)){y=!1;break}}y||d.push(u[b],u[b+1],u[b+2])}let x=new qt;x.setAttribute("position",new Qt(c,3)),x.setAttribute("uv",new Qt(h,2)),x.setIndex(d),x.computeVertexNormals(),i.colorSpace=Ee,i.wrapS=Ce,i.wrapT=Ce,i.magFilter=le,i.generateMipmaps=!0,i.minFilter=Ve,i.anisotropy=Math.max(i.anisotropy||1,16),i.needsUpdate=!0;let m=new He({map:i,roughness:1,metalness:0,envMapIntensity:.25,polygonOffset:!0,polygonOffsetFactor:2,polygonOffsetUnits:2});m.userData.shared=!1,zx(m,i);let g=new ce(x,m);g.name="site-terrain-wide",g.receiveShadow=!0,g.castShadow=!1,g.userData={ground:!0,siteTerrain:!0,siteTerrainWide:!0,frame:!1},s.add(g);let v=lp(a,l).map(b=>({x:c[(b.j*a+b.i)*3],y:f[b.j*a+b.i],z:c[(b.j*a+b.i)*3+2],dir:b.dir}));return{extent:{x0:r.x0,y0:r.y0,x1:r.x1,y1:r.y1},nodes:v}}function NE(s,t,e,{showContours:n}){let i=new Te;i.name="site-overlays",s.add(i);let r=.07,o=(l,c,h=.5,f=r)=>ix(l,e,{step:h,lift:f,closed:c});if(pn(t,"neighbours")&&t.neighbours?.length){let l=t.neighbours.filter(c=>c.ring?.length>2).map(c=>({pts:o(c.ring,!0,1,.05),closed:!0}));po(i,"neighbour-boundaries",l,{half:.06,color:"#fff2b3",userData:{neighbourBoundary:!0},order:1})}if(pn(t,"boundary")){let l=[{pts:o(t.boundary,!0),closed:!0}];for(let c of t.holes||[])c.length>2&&l.push({pts:o(c,!0),closed:!0});po(i,"lot-boundary",l,{half:.15,color:"#e01b1b",userData:{lotBoundary:!0,frame:!0},order:4})}if(pn(t,"setbacks")&&Array.isArray(t.envelope)&&t.envelope.length>2){let l=o(t.envelope,!0,.4,.09),c=rx(l,1.8,1.1,!0).map(h=>({pts:h,closed:!1}));po(i,"setback-envelope",c,{half:.055,color:"#0b7a5b",userData:{setbackEnvelope:!0},order:3})}let a=ox(t);if(a.length&&po(i,"street-frontage",a.map(l=>({pts:o(l,!1,.5,.04),closed:!1})),{half:.22,color:"#1d5fd1",userData:{frontage:!0},order:2}),n&&pn(t,"contours")&&t.contours?.length){let l=[],c=[];for(let h of t.contours){let f=[];for(let u=0;u+1<h.pts.length;u+=2)f.push({x:h.pts[u],y:h.pts[u+1]});f.length<2||(h.major?c:l).push({pts:o(f,!!h.closed,1.5,.12),closed:!1})}po(i,"site-contours-minor",l,{half:.05,color:"#b0763a",userData:{contours:!0},order:2}),po(i,"site-contours-major",c,{half:.1,color:"#8a4c16",userData:{contours:!0},order:2})}if(pn(t,"labels")){for(let c of lx(t)){let h=Ox(c.lines,c.kind);if(!h)continue;let f=e(c.x,c.y);h.position.set(c.x/1e3,f+(c.kind==="lot"?9:4),c.y/1e3),h.name=`label:${c.kind}`,h.userData={label:!0},i.add(h)}let l=a[0];if(l){let c={x:(l[0].x+l[1].x)/2,y:(l[0].y+l[1].y)/2},h=Ox(["Street frontage"],"neighbour");h&&(h.position.set(c.x/1e3,e(c.x,c.y)+2.2,c.y/1e3),h.name="label:frontage",h.userData={label:!0},i.add(h))}}}export{nl as a,f0 as b,d0 as c,qf as d,Ri as e,rn as f,Ne as g,xu as h,In as i,Ce as j,_r as k,Ie as l,_u as m,Os as n,le as o,to as p,Ve as q,nn as r,yr as s,qo as t,ai as u,Ee as v,lg as w,rt as x,ze as y,P as z,jt as A,re as B,Yo as C,Cn as D,Jt as E,Pn as F,Te as G,_t as H,$o as I,Ae as J,Qt as K,ke as L,qt as M,Rn as N,Si as O,sn as P,ce as Q,Ze as R,Wn as S,na as T,ws as U,Xn as V,ii as W,Ei as X,Qi as Y,_a as Z,wi as _,zr as $,un as aa,He as ba,za as ca,Oe as da,Ga as ea,Va as fa,me as ga,Fh as ha,Bh as ia,Kh as ja,nu as ka,Yl as la,ip as ma,ci as na,ye as oa,qe as pa,fo as qa,be as ra,VE as sa,HE as ta,jg as ua,tx as va,rp as wa,Kl as xa,hx as ya,ZE as za,JE as Aa,$E as Ba,Ou as Ca,KE as Da,QE as Ea,jE as Fa,lE as Ga,Cx as Ha,TE as Ia,AE as Ja,WT as Ka,XT as La};
/*! Bundled license information:

three/build/three.core.js:
  (**
   * @license
   * Copyright 2010-2026 Three.js Authors
   * SPDX-License-Identifier: MIT
   *)

three/build/three.module.js:
  (**
   * @license
   * Copyright 2010-2026 Three.js Authors
   * SPDX-License-Identifier: MIT
   *)
*/
