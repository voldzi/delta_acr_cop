import assert from 'node:assert/strict';
import test from 'node:test';
import {mutationIntentDeadline} from './mutation-intent-deadline.mjs';
const base=Date.parse('2026-10-15T12:00:00.000Z');
const p=(a,b)=>({issuedAt:new Date(base+a).toISOString(),expiresAt:new Date(base+b).toISOString()});
test('permits exact absolute deadline and one remaining millisecond',()=>{
  mutationIntentDeadline(p(0,5000),base+5000,base);
  mutationIntentDeadline(p(0,1),base+1,base);
});
test('rejects relative TTL shifted past claim expiry by actual signer issuance',()=>{
  assert.throws(()=>mutationIntentDeadline(p(1,5001),base+5000,base+1),/GUARD_MUTATION_INTENT_EXPIRED/);
});
test('rejects issuance at or beyond absolute signed claim expiry',()=>{
  for(const n of [5000,5001])assert.throws(()=>mutationIntentDeadline(p(n,n+1),base+5000,base+n));
});
test('rejects expired record even when claim itself still lives',()=>{
  assert.throws(()=>mutationIntentDeadline(p(0,100),base+5000,base+100));
});
test('rejects future issuance zero lifetime and overlong lifetime',()=>{
  for(const [a,b]of [[1,100],[0,0],[0,5001]])assert.throws(()=>mutationIntentDeadline(p(a,b),base+10000,base));
});
test('rejects malformed timestamps and noncanonical offsets',()=>{
  for(const v of [{issuedAt:'invalid',expiresAt:p(0,100).expiresAt},{...p(0,100),issuedAt:'2026-10-15T12:00:00+00:00'}])
    assert.throws(()=>mutationIntentDeadline(v,base+1000,base));
});
test('rejects unknown noninteger or unbounded clocks',()=>{
  for(const n of [undefined,NaN,Infinity,base+0.5])assert.throws(()=>mutationIntentDeadline(p(0,100),n,base));
  assert.throws(()=>mutationIntentDeadline(p(0,100),base+1000,NaN));
});
