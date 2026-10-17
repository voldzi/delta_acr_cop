/** Actual COP app-data adapter against SIM main, Router, relay and owned SQL.
 * Component acceptance only: no actual Keycloak, Root or whole-account claim.
 * All credentials are fresh process memory; external provider calls forbidden.
 */
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,mkdir,chmod,rm,readFile} from 'node:fs/promises';
import {statSync,realpathSync} from 'node:fs';
import {createServer} from 'node:http';
import {createSign,generateKeyPairSync,randomUUID,randomBytes,createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {join,dirname} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createSimCleanLifecycleErasureAdapter} from '../../apps/cop-api/dist/sim-clean-lifecycle-erasure.js';
assert.deepEqual(process.argv.slice(2),['--run']);
const sim='/Users/voldzi/.codex/worktrees/sim-account-erasure/02 SIM';
assert.equal(realpathSync(sim),sim);
const modules=['scripts/fixtures/clean-whole-sim-v1.mjs','scripts/fixtures/clean-whole-sim-user-data-v2.mjs',
 'apps/simulator-api/dist/user-data.js','apps/ai-router-api/dist/sim-user-history.js','apps/situation-data-api/dist/sim-user-data-relay.js'];
async function sourcePins(){return Object.fromEntries(await Promise.all(modules.map(async p=>[p,createHash('sha256').update(await readFile(join(sim,p))).digest('hex')])))}
const pins=await sourcePins();
const baseFixture=await import(pathToFileURL(join(sim,modules[0]))),appFixture=await import(pathToFileURL(join(sim,modules[1])));
const exec=promisify(execFile),bin='/opt/homebrew/opt/postgresql@18/bin';
const env=Object.fromEntries(Object.entries(process.env).filter(([k])=>['PATH','HOME','USER','LOGNAME','LANG','LC_ALL','TMPDIR'].includes(k)));
assert.match((await exec(join(bin,'postgres'),['--version'],{env})).stdout,/PostgreSQL\) 18\.3/);
const oldMask=process.umask(0o077),root=await mkdtemp('/private/tmp/sim-clean-whole-pg-');await chmod(root,0o700);await mkdir(join(root,'s'),{mode:0o700});
function owned(){assert.equal(dirname(realpathSync(root)),'/private/tmp');assert.equal(statSync(root).uid,process.getuid());assert.equal(statSync(root).mode&0o777,0o700)}
const now=Math.floor(Date.now()/1000),actors=Object.fromEntries(['a','b'].map(k=>[k,{subjectId:randomUUID(),routerUserId:'cop_'+randomBytes(32).toString('base64url'),contributorIdDay:randomBytes(32).toString('base64url'),oidcIat:now}]));
const input=appFixture.makeCleanWholeAppInput(baseFixture.makeCleanWholeInput({actors})),base=input.base,privateConfig=input.userDataEnvironment;
const {privateKey,publicKey}=generateKeyPairSync('rsa',{modulusLength:2048}),jwk={...publicKey.export({format:'jwk'}),kid:'synthetic-cop-sim-joint',alg:'RS256',use:'sig'};
function headers(name){const head=Buffer.from(JSON.stringify({alg:'RS256',kid:jwk.kid,typ:'JWT'})).toString('base64url'),body=Buffer.from(JSON.stringify({iss:base.issuer,sub:actors[name].subjectId,iat:actors[name].oidcIat,exp:Math.floor(Date.now()/1000)+300,aud:'cop-web',azp:'cop-web',preferred_username:'same-synthetic-display-name',realm_access:{roles:['SIM_ADMIN']}})).toString('base64url'),value=head+'.'+body;return {authorization:'Bearer '+value+'.'+createSign('RSA-SHA256').update(value).end().sign(privateKey).toString('base64url'),'content-type':'application/json'}}
const serve=(app,port=0)=>new Promise((resolve,reject)=>{const s=createServer(app);s.once('error',reject);s.listen(port,'127.0.0.1',()=>resolve(s))});
const close=s=>new Promise(resolve=>s.close(resolve));
let pgStarted=false,db,ai,app,jwks,mainHttp,relayHttp,checks=0;
const check=x=>{assert.ok(x);checks++};
try{
 owned();await exec(join(bin,'initdb'),['-D',join(root,'db'),'-U','owned_fixture_admin','--auth-local=trust','--auth-host=reject','--no-locale'],{env});
 await exec(join(bin,'pg_ctl'),['-D',join(root,'db'),'-l',join(root,'pg.log'),'-o',`-k ${join(root,'s')} -c listen_addresses='' -c cluster_name=${baseFixture.FIXTURE_CLUSTER}`,'-w','start'],{env});pgStarted=true;
 db=await baseFixture.createCleanWholeDatabase({socket:join(root,'s')});await baseFixture.provisionCleanWhole(db,base);await appFixture.provisionCleanWholeApp(db,input);
 ai=await baseFixture.startCleanWholeComponent(db,base,'ai',{ephemeralPorts:true,simHistorySettings:appFixture.historySettings(input),syntheticModelResponse:JSON.stringify({name:'Synthetic exercise',description:'Fictional civil test only.',durationSeconds:60,objectCount:1})});
 jwks=await serve((_q,r)=>{r.setHeader('content-type','application/json');r.end(JSON.stringify({keys:[jwk]}))});
 app=await appFixture.startCleanWholeApp(db,input,{jwksUri:'http://127.0.0.1:'+jwks.address().port+'/certs',routerUrl:ai.api});mainHttp=await serve(app.app,4314);
 const express=createRequire(join(sim,'apps/situation-data-api/package.json'))('express'),relay=express();
 const {registerSimUserDataRelay}=await import(pathToFileURL(join(sim,modules[4])));
 const previous=process.env.NODE_ENV;process.env.NODE_ENV='test';try{registerSimUserDataRelay(relay,{owner:'cop-sim-clean-whole-20261017',target:'http://127.0.0.1:4314'})}finally{if(previous===undefined)delete process.env.NODE_ENV;else process.env.NODE_ENV=previous}
 relayHttp=await serve(relay);
 const config={issuer:base.issuer,resetEpoch:base.resetEpoch,tokensNotBefore:base.tokensNotBefore,actorSecret:privateConfig.copActorSecret,userIdSecret:randomBytes(32).toString('base64url'),token:privateConfig.copToken,baseUrl:'http://127.0.0.1:'+relayHttp.address().port,component:'sim_user_data'};
 const adapter=createSimCleanLifecycleErasureAdapter(config);
 const principal=name=>({authMode:'oidc',issuer:base.issuer,subjectId:actors[name].subjectId,tokenIssuedAt:actors[name].oidcIat,username:'',displayName:''});
 for(const name of ['a','b']){
  const response=await fetch('http://127.0.0.1:4314/api/v1/scenarios',{method:'POST',headers:headers(name),body:JSON.stringify({name:'Synthetic owned scenario',description:'Fictional test content only.',area:{type:'BBOX',bbox:[14,49.8,15,50.3]},durationSeconds:60,seed:17,blocks:[{blockId:'rescue-sim',enabled:true,objectCount:1,updateRateHz:1}],faults:[]}),signal:AbortSignal.timeout(7000)});check(response.status===201);await response.body?.cancel();
 }
 check(await adapter.ready());const actor=principal('a'),context={accountKey:createHash('sha256').update(actor.subjectId).digest('hex'),operationId:randomUUID(),requestedAt:new Date().toISOString(),signal:AbortSignal.timeout(25000)};
 check((await adapter.preflight(actor,context)).ready);const initial=await adapter.erase(actor,context);check(['pending','completed'].includes(initial.status));
 await assert.rejects(adapter.verifiedCompletedOperationProof(principal('b'),context));checks++;
 let proof;const until=Date.now()+15000;do{proof=await adapter.verifiedCompletedOperationProof(actor,context);if(proof.status==='completed')break;await new Promise(r=>setTimeout(r,200))}while(Date.now()<until);
 check(proof.status==='completed');const readback=await app.read();check(Object.values(readback.actors.a.counts).every(n=>n===0));check(readback.actors.b.counts.scenarios===1);
 check((await adapter.erase(actor,context)).status==='completed');
 await assert.rejects(adapter.erase({...actor,issuer:'https://foreign.invalid'},context));checks++;
 const broken=createSimCleanLifecycleErasureAdapter({...config,token:randomBytes(32).toString('base64url')});check(!await broken.ready());await assert.rejects(broken.erase(actor,context));checks++;
 check(ai.guard.attempts===0);assert.deepEqual(await sourcePins(),pins);
 console.log(JSON.stringify({contractVersion:'cop-sim-app-clean-joint-component-v1',checks,actualCopAdapter:true,actualSimMainRouterRelay:true,actualOwnedPostgres:true,actualSimOidcVerification:true,actualKeycloak:false,realRootAdmission:false,wholeAccountAcceptance:false,productionTouched:false,externalProviderAttempts:0,sourcePins:pins}));
}finally{
 if(relayHttp)await close(relayHttp);if(mainHttp)await close(mainHttp);await app?.close();if(jwks)await close(jwks);await ai?.close();await db?.close();
 if(pgStarted){owned();await exec(join(bin,'pg_ctl'),['-D',join(root,'db'),'-m','fast','-w','stop'],{env})}
 owned();await rm(root,{recursive:true,force:true});process.umask(oldMask);
}
