// Only the approved public Penny coordinates. No token creation or identity output.
import { createRoutingSourceFromEnv } from '/app/apps/cop-api/dist/routing-source.js';
const source = createRoutingSourceFromEnv();
const from={lat:50.1209513,lon:17.3831568},target={lat:50.1215849,lon:17.3810814},access={lat:50.1214775,lon:17.3814008};
try {
 if(!source)throw Error('ROUTING_DISABLED');
 const profiles=await source.fetchProfiles(new Date());
 if(profiles.userSelectedArrival?.availability!=='requires_runtime_validation')throw Error('CAPABILITY_UNAVAILABLE');
 let original;
 try{
  const ordinary=await source.alternatives({profileId:'car',from,to:target,includeSteps:true,includeRoadAttributes:true,alternatives:3},new Date());
  const distance=(a,b)=>{const rad=Math.PI/180,h=Math.sin((a.lat-b.lat)*rad/2)**2+Math.cos(a.lat*rad)*Math.cos(b.lat*rad)*Math.sin((a.lon-b.lon)*rad/2)**2;return 6371000*2*Math.asin(Math.sqrt(Math.max(0,Math.min(1,h))));};
  if(!ordinary.routes?.length||!ordinary.routes.every(r=>r.quality?.mode==='engine_route'&&r.quality.engine==='valhalla'&&!('fallbackReason'in r.quality)&&r.vehicleAssessment?.providerCosting==='auto'&&r.knownClosures?.engine.fallbackUsed===false&&!('arrival'in r)&&distance(from,{lon:r.geometry.coordinates[0][0],lat:r.geometry.coordinates[0][1]})<=25&&distance(target,{lon:r.geometry.coordinates.at(-1)[0],lat:r.geometry.coordinates.at(-1)[1]})<=25))throw Error('ORDINARY_PROOF_FAILED');
  original={http:200,fullyVerified:true};
 }catch(e){if(e.status===422&&e.code==='ROUTING_RESTRICTIONS_RELAXATION_REQUIRED')original={http:422,code:e.code};else throw e;}
 const result=await source.alternatives({profileId:'car',from,to:access,arrival:{version:'sim-user-selected-arrival-v1',selection:'user_selected',target},includeSteps:true,includeRoadAttributes:true,alternatives:3},new Date());
 if(!result.routes?.length||!result.routes.every(r=>r.arrival?.remainingAccess==='unverified'&&r.arrival.engine.fallbackUsed===false))throw Error('ACTUAL_PROOF_FAILED');
 for(const authorization of [undefined,'Bearer dev-lab-token']){
  const res=await fetch('http://127.0.0.1:4310/api/v1/routing/route',{method:'POST',headers:{'content-type':'application/json',...(authorization?{authorization}:{})},body:JSON.stringify({profileId:'car',from,to:access}),signal:AbortSignal.timeout(15000)});
  if(res.status!==401)throw Error('HTTP_AUTH_BOUNDARY_FAILED');
 }
 console.log(JSON.stringify({verified:true,actualProductionCopAdapterToSimToEngine:true,trafficFreshnessNotAssessed:true,anonymousAndLabRejected:true,authenticatedUserHttpAndPhoneAcceptancePending:true,original,capabilities:profiles.userSelectedArrival,variants:result.routes.map(r=>({distanceM:r.distanceM,durationSeconds:r.durationSeconds,steps:r.steps?.length,remainingDistanceM:r.arrival.distanceM,snapDistanceM:r.arrival.snapDistanceM,graph:r.arrival.routingDataset.version,engine:r.arrival.engine,proofVerified:true}))}));
}catch(e){console.log(JSON.stringify({verified:false,code:['ROUTING_DISABLED','CAPABILITY_UNAVAILABLE','ORDINARY_PROOF_FAILED','ACTUAL_PROOF_FAILED','HTTP_AUTH_BOUNDARY_FAILED'].includes(e.message)?e.message:'LIVE_ADAPTER_ACCEPTANCE_FAILED'}));process.exitCode=1;}
