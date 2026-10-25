import {test} from 'node:test';
import assert from 'node:assert/strict';
import {checkPolicyTransport} from './check-policy-transport.mjs';
const env={COP_CSM_MESSAGING_BASE_URL:'http://internal.test',COP_CSM_MESSAGING_TOKEN:'synthetic-only-secret'};
const reply=(status,code)=>new Response(JSON.stringify({error:{code}}),{status});
test('configured canonical path rejects invalid token and self pair, without actual accounts',async()=>{
 const requests=[];const result=await checkPolicyTransport(env,async(url,options)=>{requests.push({url,options});return requests.length===1?reply(401,'UNAUTHORIZED'):reply(400,'VALIDATION_ERROR');});
 assert.equal(result.ok,true);assert.equal(requests.length,2);assert.equal(requests[0].options.body,requests[1].options.body);assert.equal(JSON.parse(requests[0].options.body).peerId,requests[0].options.headers['x-csm-user-id']);assert.equal(requests[1].options.redirect,'error');assert(!JSON.stringify(result).includes(env.COP_CSM_MESSAGING_TOKEN));
});
test('a disabled Messaging policy cannot pass readiness',async()=>{
 let n=0;assert.deepEqual(await checkPolicyTransport(env,async()=>++n===1?reply(401,'UNAUTHORIZED'):reply(503,'COMMUNICATION_POLICY_UNAVAILABLE')),{ok:false,code:'POLICY_DEPENDENCY_UNAVAILABLE'});
});
test('an accidental fail-open boundary cannot pass',async()=>{
 assert.deepEqual(await checkPolicyTransport(env,async()=>new Response(JSON.stringify({result:true}))),{ok:false,code:'POLICY_AUTH_BOUNDARY_UNPROVEN'});
});
test('network errors, malformed/oversized responses and missing config are bounded',async()=>{
 for (const f of [async()=>{throw Error('private');},async()=>new Response('private'),async()=>new Response('x'.repeat(32769))]){const r=await checkPolicyTransport(env,f);assert.equal(r.ok,false);assert(!JSON.stringify(r).includes('private'));}
 assert.equal((await checkPolicyTransport({},async()=>{throw Error();})).code,'POLICY_CONFIG_MISSING');
});
