// Run inside the already deployed SIM. Only the approved public Penny points.
import { canonicalRoutingHash as hash } from './apps/situation-data-api/dist/routing-safety.js';
import { arrivalDistance } from './apps/situation-data-api/dist/user-selected-arrival.js';
const version='sim-user-selected-arrival-v1';
const from={lat:50.1209513,lon:17.3831568},target={lat:50.1215849,lon:17.3810814},access={lat:50.1214775,lon:17.3814008};
const same=(a,b)=>hash(a)===hash(b),point=a=>({lon:a[0],lat:a[1]}),assert=(ok,code)=>{if(!ok)throw Error(code);},validHash=x=>typeof x==='string'&&/^[0-9a-f]{64}$/.test(x);
function verify(body,request,selected){
 const now=Date.now(),expected={...request,via:[],avoid:[]};
 assert(body.coverage?.state==='covered'&&same(body.query,expected),'REQUEST_BINDING_FAILED');
 assert(Array.isArray(body.routes)&&body.routes.length>0&&body.routes.length<=3&&Array.isArray(body.features)&&body.features.length===body.routes.length,'VARIANT_BINDING_FAILED');
 const speed=body.traffic?.liveSpeeds;
 if(speed?.state==='current')assert(typeof speed.overlayGeneration==='string'&&speed.overlayGeneration.length>0&&Date.parse(speed.usableUntil)>now&&speed.routingDataset===body.coverage.routingDataset.version,'TRAFFIC_METADATA_FAILED');
 const ids=new Set();
 for(const route of body.routes){
  const coords=route.geometry?.coordinates,k=route.knownClosures;
  assert(typeof route.routeId==='string'&&route.routeId.length>0&&!ids.has(route.routeId)&&route.status==='ok'&&route.quality?.mode==='engine_route'&&route.quality.engine==='valhalla'&&!('fallbackReason'in route.quality)&&route.vehicleAssessment?.providerCosting==='auto','ENGINE_REQUIREMENTS_FAILED');ids.add(route.routeId);
  assert(route.geometry?.type==='LineString'&&Array.isArray(coords)&&coords.length>=2&&coords.every(p=>Array.isArray(p)&&p.length===2&&p.every(Number.isFinite)&&Math.abs(p[0])<=180&&Math.abs(p[1])<=90),'GEOMETRY_FAILED');
  assert(arrivalDistance(point(coords[0]),request.from)<=25&&arrivalDistance(point(coords.at(-1)),request.to)<=25,'ROAD_SNAP_FAILED');
  assert(k?.version==='sim-known-road-closures-v1'&&k.state==='applied'&&k.coverage==='incomplete'&&validHash(k.revision)&&k.geometryHash===hash(route.geometry)&&k.requestHash===hash(expected)&&same(k.routingDataset,body.coverage.routingDataset),'KNOWN_CLOSURE_BINDING_FAILED');
  const observed=Date.parse(k.observedAt),until=Date.parse(k.validUntil),built=Date.parse(k.routingDataset.builtAt);
  assert(Number.isFinite(observed)&&Number.isFinite(until)&&Number.isFinite(built)&&observed<=now&&until>now&&until>observed&&until-observed<=600000&&built<=now&&now-built<864000000&&until<=built+864000000&&typeof k.routingDataset.version==='string'&&k.routingDataset.version.length>0,'PROOF_FRESHNESS_FAILED');
  assert(k.engine?.provider==='valhalla'&&typeof k.engine.version==='string'&&k.engine.version.length>0&&k.engine.fallbackUsed===false&&Number.isInteger(k.appliedClosureCount)&&k.appliedClosureCount>=0&&k.appliedClosureCount<=128&&Array.isArray(k.exclusions)&&k.exclusions.length===k.appliedClosureCount,'ENGINE_REQUIREMENTS_FAILED');
  assert(new Set(k.exclusions.map(e=>e.closureId)).size===k.exclusions.length&&k.exclusions.every(e=>typeof e.closureId==='string'&&e.closureId.length>0&&validHash(e.reviewedGeometryHash)&&e.enforcedDirection==='both'&&((e.sourceDirection==='both'&&e.enforcementReason==='source_both_direction')||(e.sourceDirection==='unknown'&&e.enforcementReason==='conservative_whole_structure_avoidance'))),'KNOWN_CLOSURE_BINDING_FAILED');
  const features=body.features.filter(f=>(f.properties?.routeId??f.id)===route.routeId);assert(features.length===1&&same(features[0].geometry,route.geometry)&&same(features[0].properties?.knownClosures,k),'FEATURE_BINDING_FAILED');
  assert(Number.isFinite(route.distanceM)&&route.distanceM>0&&Number.isFinite(route.durationSeconds)&&route.durationSeconds>0&&Array.isArray(route.steps)&&route.steps.length>0&&route.steps.length<=10000,'MANEUVER_BINDING_FAILED');
  let previousEnd=0;
  for(const step of route.steps){
   assert(Number.isInteger(step.beginShapeIndex)&&Number.isInteger(step.endShapeIndex)&&step.beginShapeIndex===previousEnd&&step.endShapeIndex>=step.beginShapeIndex&&step.endShapeIndex<coords.length&&Number.isFinite(step.distanceM)&&step.distanceM>=0&&Number.isFinite(step.durationSeconds)&&step.durationSeconds>=0,'MANEUVER_BINDING_FAILED');
   previousEnd=step.endShapeIndex;
  }
  assert(previousEnd===coords.length-1,'MANEUVER_BINDING_FAILED');
  if(!selected){assert(!('arrival'in route)&&!('arrival'in features[0].properties),'UNSOLICITED_ARRIVAL_FAILED');continue;}
  const a=route.arrival,end=point(coords.at(-1));
  assert(a?.version===version&&a.selection==='user_selected'&&same(a.target,request.arrival.target)&&same(a.requestedAccess,request.to)&&same(a.mappedEndpoint,end)&&a.profileId==='car'&&a.remainingAccess==='unverified'&&a.routeId===route.routeId&&a.requestHash===hash(expected)&&a.geometryHash===hash(route.geometry)&&same(a.routingDataset,k.routingDataset)&&a.closureRevision===k.revision&&a.engine?.provider==='valhalla'&&a.engine.version===k.engine.version&&a.engine.costing==='auto'&&a.engine.fallbackUsed===false&&Date.parse(a.validUntil)>now&&Date.parse(a.validUntil)<=until&&same(features[0].properties.arrival,a),'ARRIVAL_BINDING_FAILED');
  const gap=arrivalDistance(end,request.arrival.target),snap=arrivalDistance(end,request.to);
  assert(arrivalDistance(request.to,request.arrival.target)<=250&&Number.isFinite(a.distanceM)&&Number.isFinite(a.snapDistanceM)&&gap<=250&&snap<=25&&a.distanceM<=250&&a.snapDistanceM<=25&&Math.abs(a.distanceM-gap)<=.01&&Math.abs(a.snapDistanceM-snap)<=.01,'ARRIVAL_DISTANCE_FAILED');
 }
}
async function route(request){const r=await fetch('http://127.0.0.1:4020/api/v1/routing/alternatives',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(request),signal:AbortSignal.timeout(45000)});return {http:r.status,body:await r.json()};}
try{
 const cap=await(await fetch('http://127.0.0.1:4020/api/v1/routing/profiles')).json();
 assert(same(cap.userSelectedArrival,{version,availability:'requires_runtime_validation',selection:'user_selected_only',profileIds:['car'],maxRemainingDistanceM:250,maxSnapDistanceM:25,remainingAccess:'unverified',cachePolicy:'no_cache'}),'CAPABILITY_FAILED');
 const ordinary={profileId:'car',from,to:target,includeSteps:true,includeRoadAttributes:true,alternatives:3};const original=await route(ordinary);
 if(original.http===422)assert(original.body.error?.code==='ROUTING_RESTRICTIONS_RELAXATION_REQUIRED','ORIGINAL_ERROR_FAILED');
 else{assert(original.http===200,'ORIGINAL_HTTP_FAILED');verify(original.body,ordinary,false);}
 const request={...ordinary,to:access,arrival:{version,selection:'user_selected',target}},selected=await route(request);
 assert(selected.http===200,'SELECTED_HTTP_FAILED');verify(selected.body,request,true);
 const invalid=await route({...request,via:[]});assert(invalid.http===422&&invalid.body.error?.code==='ROUTING_ARRIVAL_UNSUPPORTED','UNSUPPORTED_COMBINATION_FAILED');
 console.log(JSON.stringify({verified:true,checkedAt:new Date().toISOString(),original:{http:original.http,...(original.http===422?{code:original.body.error.code}:{fullyVerified:true})},selectedAccess:{http:200,variants:selected.body.routes.map(r=>({distanceM:r.distanceM,durationSeconds:r.durationSeconds,steps:r.steps.length,remainingDistanceM:r.arrival.distanceM,snapDistanceM:r.arrival.snapDistanceM,graph:r.arrival.routingDataset.version,engine:r.arrival.engine,proofVerified:true}))},unsupported:{http:422,code:invalid.body.error.code},trafficFreshnessNotAssessed:true,productionRuntimeChanged:false}));
}catch(e){const allowed=new Set(['REQUEST_BINDING_FAILED','VARIANT_BINDING_FAILED','ENGINE_REQUIREMENTS_FAILED','GEOMETRY_FAILED','ROAD_SNAP_FAILED','KNOWN_CLOSURE_BINDING_FAILED','PROOF_FRESHNESS_FAILED','FEATURE_BINDING_FAILED','MANEUVER_BINDING_FAILED','UNSOLICITED_ARRIVAL_FAILED','ARRIVAL_BINDING_FAILED','ARRIVAL_DISTANCE_FAILED','CAPABILITY_FAILED','ORIGINAL_ERROR_FAILED','ORIGINAL_HTTP_FAILED','SELECTED_HTTP_FAILED','UNSUPPORTED_COMBINATION_FAILED','TRAFFIC_METADATA_FAILED']);console.log(JSON.stringify({verified:false,checkedAt:new Date().toISOString(),failureCode:allowed.has(e.message)?e.message:'HTTP_PROBE_FAILED'}));}
