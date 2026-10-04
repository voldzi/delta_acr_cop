(() => {
 'use strict';
 const contractVersion='vcode-public-v1';
 function create(config) {
  if(!config || typeof config.websiteId!=='string' || !/^\/[a-zA-Z0-9_/-]+$/.test(config.collectorPath) || !Array.isArray(config.allowedPaths) || (!Array.isArray(config.allowedEvents)||config.allowedEvents.length) || config.autoPageview!==false || config.autoClick!==false || config.captureTitle!==false || config.captureReferrer!==false || config.credentials!=='omit' || config.offline!=='discard')throw new Error('Unsupported analytics configuration');
  const allowed=new Set(config.allowedPaths);
  return Object.freeze({pageview(path){
   if(navigator.doNotTrack==='1'||navigator.globalPrivacyControl===true||navigator.onLine===false||!allowed.has(path))return;
   fetch(config.collectorPath,{method:'POST',headers:{'Content-Type':'application/json'},credentials:'omit',referrerPolicy:'no-referrer',keepalive:true,body:JSON.stringify({website:config.websiteId,name:'pageview',path})}).catch(()=>{});
  }});
 }
 window.vcodePublicAnalytics=Object.freeze({contractVersion,create});
})();
