import{a as M}from"./ps-chunk-ZGJTAITA.js";var B={bedroom:"#dfe7dc",bathroom:"#d3e3e8",ensuite:"#d3e3e8",wc:"#d3e3e8",laundry:"#d3e3e8",kitchen:"#efe3d0",living:"#f0e8d8",family:"#f0e8d8",dining:"#f0e8d8",garage:"#e3e5e1",carport:"#e3e5e1",alfresco:"#e9efe2",deck:"#e9efe2",patio:"#e9efe2",verandah:"#e9efe2",workshop:"#e3e5e1",store:"#e3e5e1"},u=a=>Math.round(a*10)/10;function N(a,{width:o=320,height:t=200,ink:s="#232a28",paper:c="#f3f4ef"}={}){let n=M(a),i=[];for(let e of n.walls)i.push(e.a,e.b);for(let e of n.rooms)i.push(...e.polygon);if(!i.length)return`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${o} ${t}"><rect width="${o}" height="${t}" fill="${c}"/></svg>`;let h=Math.min(...i.map(e=>e.x)),w=Math.max(...i.map(e=>e.x)),f=Math.min(...i.map(e=>e.y)),g=Math.max(...i.map(e=>e.y)),b=14,l=Math.min((o-b*2)/Math.max(1,w-h),(t-b*2)/Math.max(1,g-f)),T=(o-(w-h)*l)/2-h*l,q=(t-(g-f)*l)/2-f*l,p=e=>u(e*l+T),m=e=>u(e*l+q),d="";for(let e of n.rooms)d+=`<polygon points="${e.polygon.map(r=>`${p(r.x)},${m(r.y)}`).join(" ")}" fill="${B[e.type]||"#ecece6"}" stroke="none"/>`;for(let e of n.walls){if(e.status==="demolish")continue;let r=Math.max(1.4,u(e.thickness*l));d+=`<line x1="${p(e.a.x)}" y1="${m(e.a.y)}" x2="${p(e.b.x)}" y2="${m(e.b.y)}" stroke="${s}" stroke-width="${r}" stroke-linecap="square"/>`}for(let e of n.openings){let r=n.walls.find(A=>A.id===e.wallId);if(!r)continue;let y=r.b.x-r.a.x,k=r.b.y-r.a.y,x=Math.hypot(y,k)||1,v=y/x,$=k/x,S=e.offset-e.width/2,j=e.offset+e.width/2,_=e.kind==="window"?"#7fa6b5":c;d+=`<line x1="${p(r.a.x+v*S)}" y1="${m(r.a.y+$*S)}" x2="${p(r.a.x+v*j)}" y2="${m(r.a.y+$*j)}" stroke="${_}" stroke-width="${Math.max(1.6,u(r.thickness*l*.7))}"/>`}return`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${o} ${t}" width="${o}" height="${t}"><rect width="${o}" height="${t}" fill="${c}"/>${d}</svg>`}var W=a=>`data:image/svg+xml;utf8,${encodeURIComponent(a)}`;var C=`
river maple cedar olive lemon peach mango berry apple melon plum cherry honey sugar
salt pepper basil mint sage thyme ginger cocoa bread toast cream butter cheese bacon pasta
rice bean corn pea carrot onion potato tomato lime fig date nut almond walnut pecan oat
wheat barley flour dough cake pie jam jelly candy syrup tea coffee milk juice soup stew
salad steak koala emu wombat dingo roo gecko parrot magpie finch robin wren eagle hawk owl
duck swan goose crane heron stork fox wolf bear deer moose otter seal whale shark dolphin
crab fish trout salmon tuna eel frog toad snail bee ant moth beetle spider cricket horse
pony zebra camel llama sheep lamb goat cow bull pig hen rooster chick rabbit hare mouse
badger beaver panda tiger lion cheetah monkey gorilla koi turtle lizard sun moon star cloud
rain snow wind storm frost mist dew fog sky sea lake pond creek brook stream beach sand dune
cliff rock stone hill ridge peak valley field meadow forest grove wood leaf branch twig root
seed bloom petal flower daisy rose tulip lily iris fern moss reed vine bush shrub palm pine
oak elm ash birch willow gum wattle waratah red blue green gold silver amber coral teal navy
ruby jade pearl ivory ochre tan grey black white pink purple orange yellow brown cyan lilac
crimson scarlet copper bronze lamp clock chair table desk door gate fence wall roof floor
brick tile paint brush hammer nail screw saw drill ladder bucket rope chain anchor boat sail
oar kite ball drum bell flute harp piano guitar book pen pencil paper map key lock box bag
basket jar cup bowl plate spoon fork knife pan pot kettle toaster oven fridge sofa bed rug
mat shelf frame mirror window curtain pillow blanket happy sunny quiet calm brave bright
swift gentle kind warm cool fresh clear soft smooth sharp round tall small big tiny grand
lucky merry jolly proud steady fast slow early late young old new cosy neat tidy shiny clean
dry wet light dark rich plain wild free true wise keen north south east west down left right
front back over under noon dawn dusk day night week month year spring summer autumn winter
road path track trail lane street bridge tunnel station train tram bus truck van car bike
ship plane rocket tower castle cabin barn shed hut tent camp farm garden park market shop
cafe school race jump run walk swim climb dance sing play game goal team coach score point
win tie prize medal trophy one two three four five six seven eight nine ten dozen half azure
beige denim fawn hazel indigo khaki mauve mocha rust slate tawny umber arrow badge banner
beacon candle compass crown feather flag globe harbor island jewel lantern ocean planet
pocket pillar ribbon shield signal summit sunset thunder trumpet voyage whistle pebble
magnet hammock sandal jumper scarf boots gloves hat coat shirt sock belt ring button zip
needle thread wool cotton silk linen fleece mitten sweater apron towel soap comb razor
`.split(/\s+/).filter(Boolean);var z=new Set(`
password password1 password12 password123 password1234 passw0rd p@ssw0rd p@ssword 1234567890 12345678910 123456789012 0123456789
qwertyuiop qwerty123 qwerty1234 qwertyuiop123 1qaz2wsx 1q2w3e4r5t zxcvbnm123 asdfghjkl asdfghjkl1 abcdefghij abcd123456 abc1234567
iloveyou1 iloveyou12 letmein123 letmein1234 welcome123 welcome1234 welcome12345 admin12345 administrator adminadmin admin123456
changeme123 changeme1234 trustno1234 monkey1234 dragon1234 football123 baseball123 sunshine123 princess123 superman123 batman1234
master1234 shadow1234 michael1234 jennifer123 charlie1234 jordan12345 hunter1234 mustang123 starwars123 pokemon123 whatever123
australia123 australia1 sydney12345 melbourne123 brisbane123 newcastle123 queensland1 password2024 password2025 password2026
builder1234 builder12345 samplehomes1 samplehomes123 glideinside1 glideinside123 pocketarchitect
111111111111 1111111111 2222222222 0000000000 1212121212 1234512345 9876543210 12345678901 123456789a abc123abc1
`.split(/\s+/).filter(Boolean));var O="23456789",I=4;function D(a){if(!Number.isInteger(a)||a<1||a>4294967295)throw new RangeError("max must be an integer from 1 to 2^32");let o=Math.floor(4294967296/a)*a,t=new Uint32Array(1);for(;;)if(globalThis.crypto.getRandomValues(t),t[0]<o)return t[0]%a}var L=(a,o)=>Array.from({length:a},()=>O[o(O.length)]).join("");function U(a){return((String(a||"").trim().split(/[\s-]+/)[0]||"").normalize("NFD").replace(/[̀-ͯ]/g,"").toLowerCase().replace(/[^a-z]/g,"")||"user").slice(0,12)}function Y(a,o=[],{randomInt:t=D}={}){let s=o instanceof Set?o:new Set([...o].map(n=>String(n).toLowerCase())),c=U(a);for(let n=0;n<200;n+=1){let i=`${c}-${L(I,t)}`;if(!s.has(i))return i}throw new Error("Could not generate a unique username")}function K({randomInt:a=D,words:o=C}={}){let t=o[a(o.length)],s=o[a(o.length)];for(;s===t;)s=o[a(o.length)];return`${t}-${s}-${L(2,a)}`}function V(a=16){return[...globalThis.crypto.getRandomValues(new Uint8Array(a))].map(o=>o.toString(16).padStart(2,"0")).join("")}var R=10;function J(a,o={}){if(typeof a!="string"||a.length<R)return`Use at least ${R} characters.`;let t=a.toLowerCase();if(z.has(t))return"That password is too common. Choose something harder to guess.";if(/^(.)\1+$/.test(a))return"Choose a password with a mix of characters.";let s=String(o.email||"").split("@")[0].toLowerCase();return o.username&&t.includes(String(o.username).toLowerCase())?"The password cannot contain your username.":s.length>=4&&t.includes(s)?"The password cannot contain your email address.":o.temporary&&t===String(o.temporary).toLowerCase()?"Choose a new password, not the temporary one.":null}export{N as a,W as b,Y as c,K as d,V as e,J as f};
