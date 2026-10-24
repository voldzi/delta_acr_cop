import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import test from 'node:test';
const raw=JSON.parse(readFileSync(new URL('../../docs/api/examples/user-selected-arrival-v1.fixture.json',import.meta.url),'utf8'));
const canonical=v=>Array.isArray(v)?`[${v.map(canonical).join(',')}]`:v!==null&&typeof v==='object'?`{${Object.keys(v).sort().map(k=>`${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`:JSON.stringify(v);
const hash=v=>createHash('sha256').update(canonical(v)).digest('hex');
const distance=(a,b)=>{const r=Math.PI/180,h=Math.sin((a.lat-b.lat)*r/2)**2+Math.cos(a.lat*r)*Math.cos(b.lat*r)*Math.sin((a.lon-b.lon)*r/2)**2;return 6371000*2*Math.asin(Math.sqrt(Math.max(0,Math.min(1,h))));};
const text=readFileSync(new URL('./accept-sim-arrival-fresh.mjs',import.meta.url),'utf8');
const code=text.slice(text.indexOf("const version="),text.indexOf('async function route('));
class FixtureDate extends Date{static now(){return Date.parse(raw.validationNow);}}
// Only fixed repository code is compiled. Fixture objects are passed as values.
const verify=Function('hash','arrivalDistance','Date',code+';return verify;')(hash,distance,FixtureDate);
const copy=()=>structuredClone(raw);
function ordinary(){const f=copy();delete f.request.arrival;delete f.response.query.arrival;for(const r of f.response.routes){delete r.arrival;r.knownClosures.requestHash=hash(f.response.query);const feature=f.response.features.find(x=>(x.properties.routeId??x.id)===r.routeId);delete feature.properties.arrival;feature.properties.knownClosures=structuredClone(r.knownClosures);}return f;}
test('all selected variants and exact bindings accepted',()=>{const f=copy();verify(f.response,f.request,true);});
test('ordinary 200 requires full proof and absent arrival fields',()=>{const f=ordinary();verify(f.response,f.request,false);});
for(const mode of ['retarget','expiry','fallback','secondVariant','featureOnlyArrival','nullArrival','roadSnap26','featureGeometry','requestHash','nullFallbackReason','fallbackEngine','currentTrafficGraphMismatch','maneuverGap','negativeStepDuration'])test('reject '+mode,()=>{
 const f=ordinary(),r=f.response.routes[mode==='secondVariant'?1:0];
 if(mode==='retarget')f.response.query.to={lat:50.2,lon:17.4};
 if(mode==='expiry')r.knownClosures.validUntil=raw.validationNow;
 if(mode==='fallback')r.knownClosures.engine.fallbackUsed=true;
 if(mode==='secondVariant')r.knownClosures.geometryHash='0'.repeat(64);
 if(mode==='featureOnlyArrival')f.response.features[1].properties.arrival=null;
 if(mode==='nullArrival')r.arrival=null;
 if(mode==='roadSnap26')r.geometry.coordinates.at(-1)[1]+=.0003;
 if(mode==='featureGeometry')f.response.features[0].geometry.coordinates[0][0]+=.001;
 if(mode==='nullFallbackReason')r.quality.fallbackReason=null;
 if(mode==='fallbackEngine')r.quality.engine='osm-postgis-graph';
 if(mode==='currentTrafficGraphMismatch')f.response.traffic={liveSpeeds:{state:'current',overlayGeneration:'synthetic',usableUntil:'2026-10-23T12:09:00Z',routingDataset:'wrong'}};
 if(mode==='maneuverGap')r.steps[0].beginShapeIndex=1;
 if(mode==='negativeStepDuration')r.steps[0].durationSeconds=-1;
 if(mode==='requestHash')r.knownClosures.requestHash='0'.repeat(64);
 assert.throws(()=>verify(f.response,f.request,false));
});
