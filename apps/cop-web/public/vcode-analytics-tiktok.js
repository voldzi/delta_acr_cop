(() => {
 'use strict';
 const events=new Set(['app-store-click','contact-click','outbound-click']);
 const sources={google:['google.com','google.cz','google.co.uk'],seznam:['seznam.cz'],bing:['bing.com'],duckduckgo:['duckduckgo.com'],facebook:['facebook.com','fb.com'],instagram:['instagram.com'],tiktok:['tiktok.com'],linkedin:['linkedin.com'],openai:['openai.com','chatgpt.com'],claude:['claude.ai'],perplexity:['perplexity.ai']};
 function source(){try{const host=new URL(document.referrer).hostname.toLowerCase();return Object.entries(sources).find(([,domains])=>domains.some(domain=>host===domain||host.endsWith('.'+domain)))?.[0];}catch{return undefined;}}
 function create(config){
  if(!config||typeof config.websiteId!=='string'||!/^\/[a-zA-Z0-9_/-]+$/.test(config.collectorPath)||!Array.isArray(config.allowedPaths)||!Array.isArray(config.allowedEvents)||config.allowedEvents.some(name=>!events.has(name))||typeof config.captureSources!=='boolean'||config.autoPageview!==false||config.autoClick!==false||config.captureTitle!==false||config.captureReferrer!==false||config.credentials!=='omit'||config.offline!=='discard')throw new Error('Unsupported analytics configuration');
  const paths=new Set(config.allowedPaths),allowed=new Set(config.allowedEvents),entrySource=config.captureSources?source():undefined;
  function send(name,path){
   if(navigator.doNotTrack==='1'||navigator.globalPrivacyControl===true||navigator.onLine===false||!paths.has(path)||(name!=='pageview'&&!allowed.has(name)))return;
   const input={website:config.websiteId,name,path};if(name==='pageview'&&entrySource)input.source=entrySource;
   fetch(config.collectorPath,{method:'POST',headers:{'Content-Type':'application/json'},credentials:'omit',referrerPolicy:'no-referrer',keepalive:true,body:JSON.stringify(input)}).catch(()=>{});
  }
  return Object.freeze({pageview:path=>send('pageview',path),event:(name,path)=>send(name,path)});
 }
 window.vcodePublicAnalytics=Object.freeze({contractVersion:'vcode-public-v2',create});
})();
