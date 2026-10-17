/** Pure preparation of the exact first-enrollment manifest. No I/O or apply. */
import {createHash} from 'node:crypto';
import {validateManifest} from './provision-database-v2.mjs';
const need=(v)=>{if(!v)throw Error('CLEAN_COP_MANIFEST_PREPARATION_REJECTED')};
const sha=v=>createHash('sha256').update(v).digest('hex');
export function prepareCleanCopManifest(input){
 const {environment,resetEpoch,tokensNotBefore,applicationStoreId,incarnationId,guardStoreId,initialDigest,postgresCaSha256,decision}=input;
 need(environment?.COP_OIDC_ISSUER==='https://login.zeleznalady.cz/realms/cop');
 need(typeof environment.COP_AI_CHAT_ROUTER_USER_ID_SECRET==='string'&&environment.COP_AI_CHAT_ROUTER_USER_ID_SECRET.length>=32);
 need(typeof environment.COP_SIM_ERASURE_ACTOR_SECRET==='string'&&environment.COP_SIM_ERASURE_ACTOR_SECRET.length>=32);
 need(!Object.hasOwn(environment,'COP_ACCOUNT_ERASURE_SECRET')||typeof environment.COP_ACCOUNT_ERASURE_SECRET==='string'&&environment.COP_ACCOUNT_ERASURE_SECRET.length>=32);
 need(decision&&Object.keys(decision).sort().join()===['allLegacyUsersTestOnly','currentKeycloakOnly','sharedIdentityRemovalApproved'].sort().join()&&Object.values(decision).every(x=>x===true));
 // The direct human decisions are an operator policy input. This hash does not
 // claim historical alias discovery, a provider receipt, or runtime readiness.
 const routerKeyFingerprint=sha('cop-router-identity-key-v1\0'+environment.COP_AI_CHAT_ROUTER_USER_ID_SECRET);
 const identityEvidenceDigest=sha(JSON.stringify({contractVersion:'cop-clean-identity-decision-v1',issuer:environment.COP_OIDC_ISSUER,routerKeyFingerprint,resetEpoch,decision}));
 const manifest=validateManifest({contractVersion:'cop-database-safety-provision-clean-v1',firstEnrollment:true,allowGenerateErasureSecret:!environment.COP_ACCOUNT_ERASURE_SECRET,
  applicationStoreId,incarnationId,guardStoreId,restoreGeneration:1,initialDigest,identityEvidenceDigest,
  identityBinding:{contractVersion:'cop-existing-router-identity-v1',issuer:environment.COP_OIDC_ISSUER,routerKeyFingerprint,evidenceDigest:identityEvidenceDigest},
  postgresCaSha256,deletionScope:'cop_sim_shared_identity_v1',resetEpoch,tokensNotBefore});
 return {manifest,plan:{contractVersion:'cop-clean-first-enrollment-input-v1',planDigest:sha(JSON.stringify(manifest)+'\n'),factsInspected:false,readinessClaimed:false}};
}
