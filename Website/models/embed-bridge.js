/* Embed bridge: tells the parent page which named views this viewer has, and lets it trigger them. */
(function(){
  if(!/[?&]embed=1/.test(location.search))return;
  function post(m){try{parent.postMessage(m,'*')}catch(e){}}
  function views(){return Array.prototype.map.call(document.querySelectorAll('#views button[data-v]'),function(b){return {id:b.dataset.v,label:(b.textContent||b.dataset.v).trim()}})}
  window.addEventListener('load',function(){post({type:'ready',views:views()})});
  window.addEventListener('message',function(e){
    if(e.source!==parent)return;var d=e.data||{};
    if(d.type==='view'){var b=document.querySelector('#views button[data-v="'+String(d.id).replace(/"/g,'')+'"]');if(b)b.click()}
  });
  window.addEventListener('keydown',function(e){if(e.key==='Escape')post({type:'release'})});
})();
