// Inert on local previews. Activation requires the public HTTPS host and an explicit GA4 and/or Google Ads ID
// in launch-config.json. Event parameters never include names, emails, phone numbers, form text or query strings.
// v5 (12 October 2026): Google Ads "upload_started" conversion on first use of the order form (once per tab), and the
// "purchase" conversion on order-confirmed.html counts only a real order reference from this tab, once per order.
const pageUrl=new URL(location.href);
const localHosts=new Set(['localhost','127.0.0.1','[::1]']);
async function initialiseAnalytics(){
  if(pageUrl.protocol!=='https:'||localHosts.has(pageUrl.hostname))return;
  const response=await fetch(new URL('./launch-config.json',import.meta.url),{cache:'no-cache'});
  if(!response.ok)return;
  const config=await response.json();
  const publicUrl=new URL(config.publicSiteUrl||'https://invalid.invalid/');
  if(publicUrl.protocol!=='https:'||publicUrl.host!==pageUrl.host)return;
  const ga4=config.analyticsEnabled===true&&/^G-[A-Z0-9]+$/.test(config.analyticsMeasurementId||'')?config.analyticsMeasurementId:'';
  // The Google tag loads only when adsEnabled is true AND adsTagId is a real AW-123... ID (placeholders never load it).
  const ads=config.adsEnabled===true&&/^AW-[0-9]+$/.test(config.adsTagId||'')?config.adsTagId:'';
  const label=key=>ads&&/^[A-Za-z0-9_-]+$/.test(config[key]||'')&&!/^PASTE_/.test(config[key])?config[key]:'';
  const adsLabel=label('adsLeadConversionLabel');
  const uploadLabel=label('adsUploadStartedConversionLabel');
  const purchaseLabel=label('adsPurchaseConversionLabel');
  if(!ga4&&!ads)return;
  window.dataLayer=window.dataLayer||[];
  window.gtag=function(){window.dataLayer.push(arguments);};
  window.gtag('js',new Date());
  if(ga4){
    window.gtag('config',ga4,{send_page_view:false,allow_google_signals:false,allow_ad_personalization_signals:false});
    window.gtag('event','page_view',{page_title:document.title,page_location:pageUrl.origin+pageUrl.pathname});
  }
  if(ads)window.gtag('config',ads);
  const tag=document.createElement('script');
  tag.async=true;tag.src='https://www.googletagmanager.com/gtag/js?id='+encodeURIComponent(ga4||ads);
  document.head.append(tag);
  const record=(name,parameters={})=>{if(ga4)window.gtag('event',name,parameters);};
  // Session flags stop a reload or a second focus from counting the same conversion twice.
  const once=key=>{try{if(sessionStorage.getItem(key))return false;sessionStorage.setItem(key,'1');}catch{}return true;};
  const rooms=new Set(['living','kitchen','dining','bedroom','aerial']);
  const services=new Set(['residential-fly-throughs','display-home-virtual-tours','commercial-rural-models','drone-photogrammetry','subdivision-feasibility']);
  const hero=document.getElementById('hero-video-toggle');
  document.addEventListener('click',event=>{
    const control=event.target.closest('a,button');
    if(!control)return;
    if(control.id==='open-residential'||control.id==='watch-example')record('residential_preview_open');
    if(control.dataset.modelStep)record('model_step',{step:String(control.dataset.modelStep).slice(0,20)});
    if(control.dataset.modelLayer||control.dataset.modelOption)record('model_layer_toggle',{layer:String(control.dataset.modelLayer||control.dataset.modelOption).slice(0,60),action:control.getAttribute('aria-pressed')==='true'?'hide':'show'});
    if(control===hero)record('hero_video_toggle',{action:control.textContent.trim().toLowerCase()==='pause'?'pause':'play'});
    if(rooms.has(control.dataset.room))record('room_view_selected',{room:control.dataset.room});
    if(control.id==='drone-play'&&!control.disabled)record('drone_process_control',{action:control.textContent.trim().startsWith('Pause')?'pause':control.textContent.trim().startsWith('Replay')?'replay':'play'});
    if(control.id==='drone-replay'&&!control.disabled)record('drone_process_control',{action:'replay'});
    if(/^[0-4]$/.test(control.dataset.droneStep||''))record('drone_stage_selected',{stage:Number(control.dataset.droneStep)});
    if(control.tagName==='A'){
      const target=new URL(control.href,pageUrl);
      if(target.protocol==='mailto:')record('contact_email_click');
      if(target.protocol==='tel:')record('contact_phone_click');
      if(target.origin!==pageUrl.origin)return;
      if(target.hash==='#enquire')record('enquiry_opened');
      const service=target.pathname.match(/\/services\/([a-z-]+)\.html$/)?.[1];
      if(services.has(service))record('service_page_open',{service});
    }
  },true);
  // Stripe sends paying customers back to order-confirmed.html in the same tab. script.js saved the order reference
  // in this tab before the hand-over, so only a real order counts, and only once per reference.
  if(/\/order-confirmed\.html$/.test(pageUrl.pathname)){
    const value=Number(config.orderValue)||249;
    let ref='';
    try{ref=JSON.parse(sessionStorage.getItem('glideinside-order')||'{}').ref||'';}catch{}
    if(/^GI-[0-9]{8}-[A-Z0-9]{5}$/.test(ref)&&once('glideinside-purchase-'+ref)){
      const transaction={transaction_id:ref};
      record('purchase',{currency:'AUD',value,...transaction});
      if(purchaseLabel)window.gtag('event','conversion',{send_to:ads+'/'+purchaseLabel,value,currency:'AUD',...transaction});
    }
  }
  // Order funnel: first use of the form, the hand-over to Stripe and sample plays (fired by script.js).
  document.addEventListener('glideinside:form-start',event=>{
    record('form_start',{form_mode:String(event.detail?.mode||'').slice(0,10)});
    if(uploadLabel&&once('glideinside-upload-started'))window.gtag('event','conversion',{send_to:ads+'/'+uploadLabel});
  });
  document.addEventListener('glideinside:checkout',()=>record('begin_checkout',{currency:'AUD',value:Number(config.orderValue)||249}));
  document.addEventListener('glideinside:sample',event=>record('sample_play',{sample:String(event.detail?.sample||'').slice(0,40)}));
  // The hero hand-off from the video to the live 3D home: shown, first drag, replayed.
  document.addEventListener('glideinside:hero',event=>record('hero_model',{action:String(event.detail?.action||'').slice(0,10)}));
  // The site model's plans-to-model steps: started by the visitor or on first view, paused, resumed, played to the end.
  document.addEventListener('glideinside:model-tour',event=>record('model_tour',{action:String(event.detail?.action||'').slice(0,10),trigger:String(event.detail?.trigger||'').slice(0,6)}));
  // Fired by script.js only after contact.php confirms a quote request was delivered.
  document.addEventListener('glideinside:lead',event=>{
    const type=String(event.detail?.type||'').slice(0,60);
    record('generate_lead',{form_type:type});
    if(ads&&adsLabel)window.gtag('event','conversion',{send_to:ads+'/'+adsLabel});
  });
}
initialiseAnalytics().catch(()=>{});
