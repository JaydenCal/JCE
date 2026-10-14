/* Embed bridge: tells the parent page which named views this viewer has, and lets it trigger them. */
(function(){
  if(!/[?&]embed=1/.test(location.search))return;
  function post(m){try{parent.postMessage(m,'*')}catch(e){}}
  function views(){return Array.prototype.map.call(document.querySelectorAll('#views button[data-v]'),function(b){return {id:b.dataset.v,label:(b.textContent||b.dataset.v).trim()}})}
  var zoomOn=false;
  var st=document.createElement('style');st.textContent='html.orbit canvas{cursor:grab}html.orbit canvas:active{cursor:grabbing}';document.head.appendChild(st);
  /* the page keeps the wheel until control is taken */
  window.addEventListener('wheel',function(e){if(zoomOn)return;e.stopImmediatePropagation();e.preventDefault();post({type:'wheel',dx:e.deltaX,dy:e.deltaY})},{capture:true,passive:false});
  window.addEventListener('pointerdown',function(){if(!zoomOn)post({type:'engage'})},true);
  window.addEventListener('load',function(){post({type:'ready',views:views()})});
  window.addEventListener('message',function(e){
    if(e.source!==parent)return;var d=e.data||{};
    if(d.type==='control')zoomOn=!!d.on;
    if(d.type==='orbit')document.documentElement.classList.toggle('orbit',!!d.on);
    if(d.type==='view'){var b=document.querySelector('#views button[data-v="'+String(d.id).replace(/"/g,'')+'"]');if(b)b.click()}
  });
  window.addEventListener('keydown',function(e){if(e.key==='Escape')post({type:'release'})});
})();
