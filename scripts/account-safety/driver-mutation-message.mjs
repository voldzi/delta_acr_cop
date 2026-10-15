/** Private v2 mutation lifecycle codec, not authority or a live broker route.
 * App scope UUIDs correlate HTTP requests; Root alone chooses origin UUIDs.
 * Only begin carries a raw typed COP claim. GPS/intake bodies are excluded.
 */
import {canonical,canonicalJson,exact,hex,uuid,requireGuard} from './root-records.mjs';
import {driverContextScope} from './driver-root-context.mjs';
export const DRIVER_MUTATION_MESSAGE='cop-root-driver-mutation-message-v2';
const reference=v=>exact(v,['recordId','digest'])&&uuid(v.recordId)&&hex(v.digest);
export function decodeDriverMutationMessage(bytes){
  const r=canonicalJson(bytes,16384);
  requireGuard(r?.contractVersion===DRIVER_MUTATION_MESSAGE&&uuid(r.requestId)&&uuid(r.scopeId),'GUARD_MUTATION_MESSAGE');
  if(r.action==='begin'){
    requireGuard(exact(r,['contractVersion','requestId','scopeId','action','scope']),'GUARD_MUTATION_MESSAGE');
    const scope=driverContextScope(r.scope);
    requireGuard(scope&&canonical(scope)===canonical(r.scope),'GUARD_MUTATION_MESSAGE');
  }else if(r.action==='current'){
    requireGuard(exact(r,['contractVersion','requestId','scopeId','action','scopeRef','kind'])&&reference(r.scopeRef)&&
      ['revoke','erase','ack'].includes(r.kind),'GUARD_MUTATION_MESSAGE');
  }else{
    requireGuard(r.action==='end'&&exact(r,['contractVersion','requestId','scopeId','action','scopeRef'])&&reference(r.scopeRef),'GUARD_MUTATION_MESSAGE');
  }
  return r;
}
