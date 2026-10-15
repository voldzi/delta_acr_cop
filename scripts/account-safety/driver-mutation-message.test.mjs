import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import test from 'node:test';
import {canonical} from './root-records.mjs';
import {DRIVER_MUTATION_MESSAGE,decodeDriverMutationMessage} from './driver-mutation-message.mjs';
const base=()=>({contractVersion:DRIVER_MUTATION_MESSAGE,requestId:randomUUID(),scopeId:randomUUID()});
const scope=()=>({method:'DELETE',path:'/api/v1/internal/driver-measurements/v1/contributions',authorization:'Bearer '+'x'.repeat(64),
  actor:'a'.repeat(40),actorSignature:'1'.repeat(64),body:{contractVersion:'sim-driver-measurements-v1',contributorIdDay:'a'.repeat(43)}});
const ref=()=>({recordId:randomUUID(),digest:'a'.repeat(64)});
const packet=v=>Buffer.from(canonical(v)+'\n');
test('accepts exact begin with typed daily withdrawal and no caller origin',()=>{
  const r={...base(),action:'begin',scope:scope()};assert.deepEqual(decodeDriverMutationMessage(packet(r)),r);
});
test('accepts exact current and end with opaque Root reference only',()=>{
  for(const action of ['current','end']){const r={...base(),action,scopeRef:ref(),...(action==='current'?{kind:'erase'}:{})};assert.deepEqual(decodeDriverMutationMessage(packet(r)),r);}
});
test('rejects GPS intake unrelated HTTP methods and normalized path variants',()=>{
  for(const input of [{...scope(),method:'POST',path:'/api/v1/internal/driver-measurements/v1/batches'},
    {...scope(),method:'GET'},{...scope(),path:scope().path+'?token=x'},
    {...scope(),body:{...scope().body,points:[[1,2]]}},
    {...scope(),path:'/situation-data'+scope().path}])
    assert.throws(()=>decodeDriverMutationMessage(packet({...base(),action:'begin',scope:input})));
});
test('rejects supplied origin authority callback flags and extra end body',()=>{
  for(const extra of [{operationId:randomUUID()},{accepted:true},{ctx:{}},{scopeRef:ref()}])
    assert.throws(()=>decodeDriverMutationMessage(packet({...base(),action:'begin',scope:scope(),...extra})));
  assert.throws(()=>decodeDriverMutationMessage(packet({...base(),action:'end',scopeRef:ref(),body:{}})));
});
test('rejects substituted message version action scope UUID and reference',()=>{
  const r={...base(),action:'current',scopeRef:ref(),kind:'ack'};
  for(const extra of [{contractVersion:'cop-root-driver-context-message-v1'},{action:'release'},{scopeId:'unknown'},
    {scopeRef:{...ref(),digest:'bad'}},{kind:'expire'}])assert.throws(()=>decodeDriverMutationMessage(packet({...r,...extra})));
});
test('rejects duplicate keys noncanonical bytes and oversized packets',()=>{
  const r={...base(),action:'end',scopeRef:ref()},p=packet(r);
  assert.throws(()=>decodeDriverMutationMessage(Buffer.from(p.toString().trim())));
  assert.throws(()=>decodeDriverMutationMessage(Buffer.from(p.toString().replace('{','{"action":"end",'))));
  assert.throws(()=>decodeDriverMutationMessage(Buffer.alloc(16385,32)));
});
