/** Explicit first-enrollment operator tool. No login-derived ownership, deletion,
 * grants, arbitrary SQL/host or automatic runtime recovery. Administrators are
 * trusted per ADR0055; the reviewed plan binds their historical evidence to
 * exact full rows while all COP writers are actually paused. */
import { createHash,createHmac,createCipheriv,createDecipheriv,createPublicKey,verify as verifySignature,randomBytes } from 'node:crypto';
import { constants,openSync,fstatSync,readFileSync,closeSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { hostname } from 'node:os';
import { parseEnvironment } from './provision-database-v2.mjs';
import { loadOperatorEnvironment } from './operator-profile-environment.mjs';
const need=(v,c='LEGACY_PROVENANCE_UNPROVEN')=>{if(!v)throw Error(c);};
const sha=v=>createHash('sha256').update(v).digest('hex'),hash=v=>sha(JSON.stringify(v));
const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
const same=(a,b)=>JSON.stringify(canonical(a))===JSON.stringify(canonical(b));
const hex=/^[a-f0-9]{64}$/u,uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/iu;
const revision='b13fbdc71f3d9821f8b857c3f73255a75c46fa76';
export const legacySourcePins=Object.freeze({revision,security:'15584f9af5f5e97f9015f505429dad961bb222bd955b0d41a9f8e8b42e8a325b',server:'079f7e3f22ef41900fc6a83921e732224140a4939e80024cc87031fe17fc131c',community:'d96d1e21f808cbdae64ca3b43a0234e7ed9aefbf593f7157bceca467fa389ed5',profile:'a2a4921142db116fe68129f1d4fb6897bbc0f623d683baa9493c2ff509603fb9',device:'3934cb62239943530b8d92cb7a80f1976cc842c01ce77d919605f5db7ca0ad0e',voice:'9be2f617144f46453a3902801a61711709933f1555c14e3198c26e8a4ffb279f',session:'7ab080a253d1854ab7244a6ae5d8aa8abdec12a80d7e38779896f17f69e2550b'});
const specs={
 report:{table:'cop_community_reports',keys:['report_id'],subject:['subject_id'],times:['created_at','updated_at'],ledger:'report',source:'community'},
 attachment:{table:'cop_community_report_attachments',keys:['attachment_id'],subject:['subject_id'],times:['created_at','uploaded_at'],ledger:'attachment',source:'community'},
 group:{table:'cop_community_groups',keys:['group_id'],subject:['owner_subject_id'],times:['created_at','updated_at'],ledger:'group',source:'community'},
 membership:{table:'cop_community_group_members',keys:['group_id','subject_id'],subject:['subject_id'],times:['requested_at','joined_at'],ledger:'membership',source:'community'},
 confirmation:{table:'cop_community_report_confirmations',keys:['report_id','subject_id'],subject:['subject_id'],times:['created_at','updated_at'],ledger:'confirmation',source:'community'},
 profile:{table:'cop_user_profiles',keys:['subject_id'],subject:['subject_id'],times:['created_at','updated_at'],issuer:'issuer',source:'profile'},
 device:{table:'cop_mobile_devices',keys:['subject_id','device_id'],subject:['subject_id'],times:['paired_at','last_seen_at','revoked_at'],issuer:'owner_issuer',source:'device'},
 mesh_ack:{table:'cop_mobile_mesh_acks',keys:['subject_id','envelope_id'],subject:['subject_id'],times:['received_at','updated_at'],issuer:'owner_issuer',source:'device'},
 pairing:{table:'cop_mobile_pairing_sessions',keys:['code'],subject:['created_by_subject_id','claimed_by_subject_id'],times:['created_at','claimed_at','confirmed_at'],source:'device'},
 session:{table:'cop_web_sessions',keys:['session_id'],subject:[],times:['created_at','updated_at'],source:'session'},
 voice:{table:'cop_voice_calls',keys:['call_id'],subject:['initiator_subject_id','accepted_by_subject_id'],times:['created_at','updated_at','connected_at','ended_at'],issuer:'owner_issuer',source:'voice'}
};
const labKinds=new Set(['report','group','membership','confirmation']);
const technical=['cop_content_erasure_fences','cop_content_erasure_component_proofs','cop_content_erasure_projection_manifest','cop_content_erasure_media_manifest','cop_runtime_owner_fences','cop_community_media_write_leases','cop_user_profile_erasure_fences','cop_web_session_erasure_fences'];
const tables=[...new Set(Object.values(specs).map(v=>v.table)), 'cop_community_erasure_ownership','cop_community_owned_media','cop_community_metadata_owners','cop_web_sessions','cop_web_session_erasure_metadata','cop_mobility_v1',...technical];
const fixedKeys=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&same(Object.keys(v).sort(),[...keys].sort());
const text=v=>typeof v==='string'&&v.length>0&&v.length<=2048&&!/[\0\r\n]/u.test(v);
function schema(){const s=readFileSync(new URL('../../apps/cop-api/src/legacy-nonaccount-provenance.ts',import.meta.url),'utf8');const found=/export const legacyNonAccountProvenanceSchema = `([^`]+)`;/u.exec(s);need(found,'LEGACY_SCHEMA_EXPORT_MISSING');need(/^\s*CREATE TABLE IF NOT EXISTS cop_legacy_nonaccount_provenance \([\s\S]+\);\s*$/u.test(found[1])&&!/\b(?:DELETE|UPDATE|GRANT|ALTER|DROP|INSERT)\b/u.test(found[1]),'LEGACY_SCHEMA_SCOPE');return found[1].replace('CREATE TABLE IF NOT EXISTS cop_legacy_nonaccount_provenance','CREATE TABLE IF NOT EXISTS public.cop_legacy_nonaccount_provenance');}
function validate(plan,reviewedPlanSha256,issuer){
 need(fixedKeys(plan,['contractVersion','planId','binding','writer','issuer','evidence','rows',...(Object.hasOwn(plan??{},'signedSessionPolicy')?['signedSessionPolicy']:[])])&&plan.contractVersion==='cop-legacy-erasure-provenance-enrollment-v1'&&uuid.test(plan.planId??'')&&hex.test(reviewedPlanSha256??'')&&hash(plan)===reviewedPlanSha256,'LEGACY_PLAN_NOT_REVIEWED');
 need(plan.issuer===issuer&&/^https:\/\//u.test(issuer)&&!/[?#@]/u.test(issuer),'LEGACY_ISSUER_CHANGED');
 need(fixedKeys(plan.binding,['guardStoreId','applicationStoreId','incarnationId','restoreGeneration','configurationFingerprint'])&&[plan.binding.guardStoreId,plan.binding.applicationStoreId,plan.binding.incarnationId].every(v=>uuid.test(v))&&Number.isSafeInteger(plan.binding.restoreGeneration)&&plan.binding.restoreGeneration>0&&hex.test(plan.binding.configurationFingerprint),'LEGACY_PLAN_BINDING_INVALID');
 need(fixedKeys(plan.writer,['containerId','imageId'])&&hex.test(plan.writer.containerId)&&/^sha256:[a-f0-9]{64}$/u.test(plan.writer.imageId),'LEGACY_WRITER_IDENTITY_INVALID');
 need(Array.isArray(plan.evidence)&&plan.evidence.length>0&&plan.evidence.length<=100&&Array.isArray(plan.rows)&&plan.rows.length>0&&plan.rows.length<=10000,'LEGACY_PLAN_BOUND');
 const evidence=new Map();
 for(const e of plan.evidence){need(fixedKeys(e,['id','authentication','issuer','sourcePins','authConfigSha256','writersInventorySha256','validFrom','validUntil'])&&uuid.test(e.id??'')&&!evidence.has(e.id)&&['verified_oidc_sub','hardcoded_lab'].includes(e.authentication)&&e.issuer===(e.authentication==='verified_oidc_sub'?issuer:null)&&same(e.sourcePins,legacySourcePins)&&hex.test(e.authConfigSha256??'')&&hex.test(e.writersInventorySha256??'')&&Number.isFinite(Date.parse(e.validFrom))&&Number.isFinite(Date.parse(e.validUntil))&&Date.parse(e.validFrom)<Date.parse(e.validUntil),'LEGACY_HISTORICAL_EVIDENCE_REQUIRED');evidence.set(e.id,e);}
 if(plan.rows.some(r=>r.kind==='session'))validateSessionPolicy(plan);
 const seen=new Set();
 for(const r of plan.rows){const s=specs[r.kind],e=evidence.get(r.evidenceId);need(fixedKeys(r,['kind','key','fullRowSha256','ownershipBeforeSha256','originalSubjects','evidenceId'])&&s&&fixedKeys(r.key,s.keys)&&Object.values(r.key).every(text)&&hex.test(r.fullRowSha256??'')&&(s.ledger?hex.test(r.ownershipBeforeSha256??''):r.ownershipBeforeSha256===null)&&Array.isArray(r.originalSubjects)&&r.originalSubjects.length>0&&r.originalSubjects.length<=100&&same(r.originalSubjects,[...new Set(r.originalSubjects)].sort())&&e,'LEGACY_ROW_PLAN_INVALID');
  if(r.kind==='session')need(e.authentication==='verified_oidc_sub'&&r.originalSubjects.length===1,'LEGACY_SESSION_PLAN_UNPROVEN');
  need(e.authentication==='hardcoded_lab'?labKinds.has(r.kind)&&same(r.originalSubjects,['lab']):r.originalSubjects.every(v=>uuid.test(v)),'LEGACY_IDENTITY_NOT_ORIGINAL_SUB');const identity=hash([r.kind,r.key]);need(!seen.has(identity),'LEGACY_DUPLICATE_ROW');seen.add(identity);
 }
 return evidence;
}
const sessionPolicyKeys=['contractVersion','issuer','authorizedParty','jwksUri','jwksSha256','encryptionKeyFingerprint'];
function validateSessionPolicy(plan){
 const p=plan.signedSessionPolicy;need(fixedKeys(p,sessionPolicyKeys)&&p.contractVersion==='cop-legacy-original-signed-session-policy-v1'&&p.issuer===plan.issuer&&text(p.authorizedParty)&&p.authorizedParty.length<=128&&hex.test(p.jwksSha256??'')&&hex.test(p.encryptionKeyFingerprint??''),'LEGACY_SESSION_POLICY_UNPROVEN');
 const u=new URL(p.jwksUri);need(['http:','https:'].includes(u.protocol)&&!u.username&&!u.password&&!u.search&&!u.hash,'LEGACY_SESSION_JWKS_URI_UNPROVEN');return p;
}
const sessionKey=secret=>{need(typeof secret==='string'&&secret.trim().length>=32,'LEGACY_SESSION_SECRET_UNPROVEN');return createHash('sha256').update(secret.trim()).digest();};
const sessionKeyFingerprint=key=>createHash('sha256').update('cop-web-session-owner-key-v1\0').update(key).digest('hex');
function base64url(value,max){need(typeof value==='string'&&value.length>0&&value.length<=max&&/^[A-Za-z0-9_-]+$/u.test(value),'LEGACY_SESSION_ENCODING_UNPROVEN');const bytes=Buffer.from(value,'base64url');need(bytes.toString('base64url')===value,'LEGACY_SESSION_ENCODING_UNPROVEN');return bytes;}
function decryptSession(ciphertext,key){
 try{need(typeof ciphertext==='string'&&ciphertext.length<=1500000,'LEGACY_SESSION_CIPHER_BOUND');const parts=ciphertext.split('.');need(parts.length===3,'LEGACY_SESSION_ENCODING_UNPROVEN');const iv=base64url(parts[0],32),tag=base64url(parts[1],32),body=base64url(parts[2],1500000);need(iv.length===12&&tag.length===16,'LEGACY_SESSION_ENCODING_UNPROVEN');const decipher=createDecipheriv('aes-256-gcm',key,iv);decipher.setAuthTag(tag);const plain=Buffer.concat([decipher.update(body),decipher.final()]);try{const value=JSON.parse(plain.toString('utf8'));need(value&&typeof value==='object'&&!Array.isArray(value),'LEGACY_SESSION_PAYLOAD_UNPROVEN');return value;}finally{plain.fill(0);}}
 catch{throw Error('LEGACY_SESSION_DECRYPT_UNPROVEN');}
}
function encryptSession(value,key){const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv),plain=Buffer.from(JSON.stringify(value));try{const encrypted=Buffer.concat([cipher.update(plain),cipher.final()]);return iv.toString('base64url')+'.'+cipher.getAuthTag().toString('base64url')+'.'+encrypted.toString('base64url');}finally{plain.fill(0);}}
async function loadSignedSessionInputs({plan,secret,issuer,clientId,jwksUri,fixture=false}){
 const policy=validateSessionPolicy(plan);need(policy.issuer===issuer&&policy.authorizedParty===clientId&&policy.jwksUri===jwksUri,'LEGACY_SESSION_CONFIG_CHANGED');const u=new URL(jwksUri);
 if(fixture)need(u.protocol==='http:'&&u.hostname==='127.0.0.1'&&Number(u.port)>=1024&&u.pathname==='/jwks','LEGACY_SESSION_FIXTURE_JWKS_ONLY');
 else{const auth=new URL(issuer);need(u.protocol==='https:'&&u.origin===auth.origin,'LEGACY_SESSION_JWKS_ORIGIN_CHANGED');}
 const key=sessionKey(secret);if(sessionKeyFingerprint(key)!==policy.encryptionKeyFingerprint){key.fill(0);throw Error('LEGACY_SESSION_KEY_FINGERPRINT_CHANGED');}
 try{const response=await fetch(jwksUri,{method:'GET',redirect:'error',signal:AbortSignal.timeout(3000),headers:{accept:'application/json'},cache:'no-store'});need(response.status===200&&response.body,'LEGACY_SESSION_JWKS_UNAVAILABLE');const reader=response.body.getReader(),chunks=[];let size=0;try{while(true){const{done,value}=await reader.read();if(done)break;size+=value.byteLength;need(size<=131072,'LEGACY_SESSION_JWKS_BOUND');chunks.push(value);}}finally{await reader.cancel().catch(()=>{});}const jwks=JSON.parse(Buffer.concat(chunks).toString('utf8'));need(jwks&&Array.isArray(jwks.keys)&&jwks.keys.length>0&&jwks.keys.length<=32&&hash(canonical(jwks))===policy.jwksSha256,'LEGACY_SESSION_JWKS_DIGEST_CHANGED');return {key,jwks,policy};}
 catch(error){key.fill(0);throw Error(/^LEGACY_[A-Z_]+$/u.test(error?.message??'')?error.message:'LEGACY_SESSION_JWKS_UNAVAILABLE');}
}
function signedSessionProof(row,subjects,input){
 need(input&&row.owner_hash===null&&subjects.length===1,'LEGACY_SESSION_OWNER_ALREADY_ATTRIBUTED');const{key,jwks,policy}=input,payload=decryptSession(row.token_payload,key);
 need(typeof payload.accessToken==='string'&&payload.accessToken.length<=65536&&payload.profile&&typeof payload.profile==='object'&&!Array.isArray(payload.profile)&&payload.profile.issuer===undefined&&payload.profile.subjectId===subjects[0]&&[payload.refreshToken,payload.idToken].every(v=>v===undefined||typeof v==='string'),'LEGACY_SESSION_PROFILE_UNPROVEN');
 const parts=payload.accessToken.split('.');need(parts.length===3,'LEGACY_SESSION_JWT_UNPROVEN');let header,claims;
 try{header=JSON.parse(base64url(parts[0],8192).toString('utf8'));claims=JSON.parse(base64url(parts[1],49152).toString('utf8'));}catch{throw Error('LEGACY_SESSION_JWT_UNPROVEN');}
 need(header&&typeof header==='object'&&!Array.isArray(header)&&header.alg==='RS256'&&text(header.kid)&&header.kid.length<=256&&['crit','jku','jwk','x5u','b64','zip'].every(k=>header[k]===undefined),'LEGACY_SESSION_JWT_HEADER_UNPROVEN');
 const keys=jwks.keys.filter(k=>k&&k.kid===header.kid);need(keys.length===1,'LEGACY_SESSION_SIGNING_KEY_UNAVAILABLE');const jwk=keys[0];
 need(jwk.kty==='RSA'&&(!jwk.alg||jwk.alg==='RS256')&&(!jwk.use||jwk.use==='sig')&&(!jwk.key_ops||(Array.isArray(jwk.key_ops)&&jwk.key_ops.includes('verify')&&!jwk.key_ops.includes('sign')))&&['d','p','q','dp','dq','qi','oth'].every(k=>jwk[k]===undefined),'LEGACY_SESSION_SIGNING_KEY_UNPROVEN');
 base64url(jwk.n,2048);base64url(jwk.e,32);let publicKey;try{publicKey=createPublicKey({key:jwk,format:'jwk'});}catch{throw Error('LEGACY_SESSION_SIGNING_KEY_UNPROVEN');}
 need(publicKey.asymmetricKeyType==='rsa'&&publicKey.asymmetricKeyDetails.modulusLength>=2048,'LEGACY_SESSION_SIGNING_KEY_UNPROVEN');
 let valid=false;try{valid=verifySignature('RSA-SHA256',Buffer.from(parts[0]+'.'+parts[1]),publicKey,base64url(parts[2],2048));}catch{}need(valid,'LEGACY_SESSION_SIGNATURE_UNPROVEN');
 need(claims&&typeof claims==='object'&&!Array.isArray(claims)&&claims.iss===policy.issuer&&claims.azp===policy.authorizedParty&&claims.sub===subjects[0]&&uuid.test(claims.sub),'LEGACY_SESSION_CLAIMS_UNPROVEN');
 const updated=Date.parse(row.updated_at),created=Date.parse(row.created_at),storedAccess=Date.parse(row.access_expires_at),payloadAccess=Date.parse(payload.accessTokenExpiresAt),expires=Date.parse(row.session_expires_at),skew=30000;
 need([updated,created,storedAccess,payloadAccess,expires].every(Number.isFinite)&&created<=updated&&expires>updated&&storedAccess===payloadAccess&&Number.isSafeInteger(claims.iat)&&Number.isSafeInteger(claims.exp)&&claims.iat>=0&&claims.exp>claims.iat&&claims.exp-claims.iat<=3600&&(claims.nbf===undefined||Number.isSafeInteger(claims.nbf))&&claims.iat*1000>=created-skew&&claims.iat*1000<=updated+skew&&claims.exp*1000>updated-skew&&(claims.nbf===undefined||claims.nbf*1000<=updated+skew)&&Math.abs(storedAccess-claims.exp*1000)<=skew,'LEGACY_SESSION_HISTORICAL_TIME_UNPROVEN');
 const next={...payload,profile:{...payload.profile,issuer:policy.issuer}},ownerHash=createHmac('sha256',key).update('cop-web-session-owner-v1\0').update(JSON.stringify([policy.issuer,subjects[0]])).digest('hex');
 const proof={ciphertextSha256:sha(row.token_payload),accessTokenSha256:sha(payload.accessToken),jwkThumbprintSha256:hash({e:jwk.e,kty:'RSA',n:jwk.n}),kidSha256:sha(header.kid),claimTimesSha256:hash([claims.iat,claims.nbf??null,claims.exp,updated]),ownerKeyFingerprint:policy.encryptionKeyFingerprint};
 return {next,ownerHash,proofDigest:hash(proof)};
}

function pausedWriter(writer,fixture){
 const raw=execFileSync('/usr/bin/env',['-u','DOCKER_HOST','-u','DOCKER_CONTEXT',fixture?'/usr/local/bin/docker':'/usr/bin/docker','inspect','--format','{{json .Id}} {{json .Image}} {{json .State}} {{json .Config.Labels}}',writer.containerId],{encoding:'utf8',timeout:10000,stdio:['ignore','pipe','pipe'],env:{PATH:process.env.PATH,HOME:process.env.HOME}}).trim();
 const m=/^("[a-f0-9]+") ("sha256:[a-f0-9]+") (\{.*?\}) (\{.*\})$/u.exec(raw);need(m,'LEGACY_WRITER_INSPECT_INVALID');const[id,image,state,labels]=m.slice(1).map(v=>JSON.parse(v));
 need(id===writer.containerId&&image===writer.imageId&&state.Running===true&&state.Paused===true&&state.Pid>0,'LEGACY_WRITER_NOT_PAUSED');
 need(fixture?labels['cop.test.owner']==='legacy-erasure-provenance':labels['com.docker.compose.project']==='cop'&&labels['com.docker.compose.service']==='cop-api','LEGACY_WRITER_CUSTODY');
 if(!fixture){const all=execFileSync('/usr/bin/env',['-u','DOCKER_HOST','-u','DOCKER_CONTEXT','/usr/bin/docker','ps','-q','--no-trunc','--filter','label=com.docker.compose.project=cop','--filter','label=com.docker.compose.service=cop-api'],{encoding:'utf8',timeout:10000,stdio:['ignore','pipe','pipe'],env:{PATH:process.env.PATH,HOME:process.env.HOME}}).trim().split(/\s+/u);need(same(all,[writer.containerId]),'LEGACY_OTHER_COP_WRITER');}
 return {contractVersion:'cop-legacy-provenance-host-writer-v1',containerId:id,imageId:image,pid:state.Pid,startedAt:state.StartedAt,paused:true,sourceHelperSha256:sha(readFileSync(new URL(import.meta.url)))};
}
async function binding(g,b,expected,allowMissingTechnical=new Set(),readOnly=false){
 const rows=(await g.query(`SELECT c.contract_version,c.guard_store_id,c.application_store_id,c.configuration_fingerprint,c.initial_digest,r.store_id,r.incarnation_id,r.restore_generation,r.replay_sequence,r.replay_digest FROM cop_safety_v2.configuration c JOIN cop_safety_v2.dataset_replays r ON r.owner='cop' WHERE c.singleton ${readOnly?'':'FOR SHARE OF c,r'}`)).rows;
 need(rows.length===1,'LEGACY_GUARD_NOT_ENROLLED');const r=rows[0];need(r.contract_version==='cop-database-safety-v2'&&r.guard_store_id===expected.guardStoreId&&r.application_store_id===expected.applicationStoreId&&r.store_id===expected.applicationStoreId&&r.incarnation_id===expected.incarnationId&&Number(r.restore_generation)===expected.restoreGeneration&&r.configuration_fingerprint===expected.configurationFingerprint&&Number(r.replay_sequence)===0&&r.replay_digest===r.initial_digest,'LEGACY_BINDING_CHANGED');
 need((await g.query('SELECT count(*)::int n FROM cop_safety_v2.fences')).rows[0].n===0,'LEGACY_ACCEPTED_ERASURE_EXISTS');
 const records=(await b.query("SELECT key,value FROM cop_mobility_v1 WHERE key IN ('account-safety:store-identity-v1','account-erasure:configuration-v1') ORDER BY key")).rows;
 const local=records.find(v=>v.key==='account-erasure:configuration-v1')?.value,marker=records.find(v=>v.key==='account-safety:store-identity-v1')?.value;
 need(local?.version===4&&local.fingerprint===expected.configurationFingerprint&&local.storeId===expected.applicationStoreId&&local.datasetBinding?.incarnationId===expected.incarnationId&&local.datasetBinding.restoreGeneration===expected.restoreGeneration&&marker?.storeId===expected.applicationStoreId&&marker.incarnationId===expected.incarnationId,'LEGACY_LOCAL_BINDING_CHANGED');
 need((await b.query("SELECT count(*)::int n FROM cop_mobility_v1 WHERE key LIKE 'account-erasure:job:%'")).rows[0].n===0,'LEGACY_ACCEPTED_ERASURE_EXISTS');
 for(const name of technical){if(allowMissingTechnical.has(name)&&!(await b.query('SELECT to_regclass($1) name',['public.'+name])).rows[0].name)continue;need((await b.query('SELECT count(*)::int n FROM public.'+name)).rows[0].n===0,'LEGACY_ACCEPTED_ERASURE_OR_LEASE_EXISTS');}
 return hash([rows,records]);
}
async function catalog(b,names,owner){
 for(const name of names){const rows=(await b.query(`SELECT c.relkind,c.relrowsecurity,c.relforcerowsecurity,c.relispartition,pg_get_userbyid(c.relowner) owner,EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid=c.oid AND NOT tgisinternal) custom_trigger,EXISTS(SELECT 1 FROM pg_rewrite WHERE ev_class=c.oid AND rulename<>'_RETURN') custom_rule,EXISTS(SELECT 1 FROM pg_inherits WHERE inhrelid=c.oid OR inhparent=c.oid) inherited FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname=$1`,[name])).rows;need(rows.length===1&&rows[0].relkind==='r'&&rows[0].owner===owner&&!rows[0].relrowsecurity&&!rows[0].relforcerowsecurity&&!rows[0].relispartition&&!rows[0].custom_trigger&&!rows[0].custom_rule&&!rows[0].inherited,'LEGACY_RELATION_DRIFT');}
}
async function provenanceColumns(b){
 for(const s of Object.values(specs)){
  const cols=(await b.query("SELECT attname,format_type(atttypid,atttypmod) type,attgenerated,attidentity FROM pg_attribute WHERE attrelid=$1::regclass AND attnum>0 AND NOT attisdropped",['public.'+s.table])).rows;
  const byName=new Map(cols.map(v=>[v.attname,v]));
  const required=[...s.keys,...s.subject,...s.times,...(s.issuer?[s.issuer]:[]),...(s.table==='cop_user_profiles'?['erasure_fenced']:[]),...(s.table==='cop_mobile_pairing_sessions'?['created_by_owner_issuer','claimed_by_owner_issuer','device_payload']:[]),...(s.table==='cop_voice_calls'?['kind','participant_subject_ids']:[]),...(s.table==='cop_web_sessions'?['token_payload','owner_hash','access_expires_at','session_expires_at']:[])];
  need(required.every(k=>byName.has(k)&&!byName.get(k).attgenerated&&!byName.get(k).attidentity),'LEGACY_PROVENANCE_COLUMN_MISSING');
  need(s.subject.every(k=>byName.get(k).type==='text')&&s.times.every(k=>byName.get(k).type==='timestamp with time zone')&&(!s.issuer||byName.get(s.issuer).type==='text'),'LEGACY_PROVENANCE_COLUMN_TYPE_CHANGED');
  const pks=(await b.query("SELECT ARRAY(SELECT a.attname::text FROM unnest(c.conkey) WITH ORDINALITY x(n,ord) JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=x.n ORDER BY x.ord) keys FROM pg_constraint c WHERE c.conrelid=$1::regclass AND c.contype='p'",['public.'+s.table])).rows;
  need(pks.length===1&&same(pks[0].keys,s.keys),'LEGACY_PROVENANCE_PRIMARY_KEY_CHANGED');
 }
}
async function legacyLedgerCatalog(b,owner){
 await catalog(b,['cop_legacy_nonaccount_provenance'],owner);
 const columns=(await b.query("SELECT attname,format_type(atttypid,atttypmod) type,attnotnull FROM pg_attribute WHERE attrelid='public.cop_legacy_nonaccount_provenance'::regclass AND attnum>0 AND NOT attisdropped ORDER BY attnum")).rows;
 need(same(columns,['kind','row_key','writer_kind','source_revision','evidence_digest','row_sha256','ownership_sha256'].map(attname=>({attname,type:'text',attnotnull:true}))),'LEGACY_NONACCOUNT_SCHEMA_DRIFT');
 const pk=(await b.query("SELECT pg_get_constraintdef(oid) definition FROM pg_constraint WHERE conrelid='public.cop_legacy_nonaccount_provenance'::regclass AND contype='p'")).rows;
 need(pk.length===1&&pk[0].definition==='PRIMARY KEY (kind, row_key)','LEGACY_NONACCOUNT_SCHEMA_DRIFT');
}
function writerWitness(plan,reviewedPlanSha256,witness){
 need(fixedKeys(witness,['contractVersion','containerId','imageId','pid','startedAt','paused','sourceHelperSha256','reviewedPlanSha256'])&&witness.contractVersion==='cop-legacy-provenance-host-writer-v1'&&witness.containerId===plan.writer.containerId&&witness.imageId===plan.writer.imageId&&Number.isSafeInteger(witness.pid)&&witness.pid>0&&Number.isFinite(Date.parse(witness.startedAt))&&witness.paused===true&&witness.reviewedPlanSha256===reviewedPlanSha256&&witness.sourceHelperSha256===sha(readFileSync(new URL(import.meta.url))),'LEGACY_HOST_WRITER_WITNESS_UNBOUND');
 return hash(witness);
}
const provenanceColumnSpecs={
 cop_user_profiles:[['issuer','text',false,null],['erasure_fenced','boolean',true,'false']],
 cop_mobile_devices:[['owner_issuer','text',false,null]],cop_mobile_mesh_acks:[['owner_issuer','text',false,null]],
 cop_mobile_pairing_sessions:[['created_by_owner_issuer','text',false,null],['claimed_by_owner_issuer','text',false,null]],
 cop_voice_calls:[['owner_issuer','text',false,null]],cop_web_sessions:[['owner_hash','text',false,null]]
};
const prerequisiteTables={
 cop_user_profile_erasure_fences:[['subject_hash','text',true,null],['created_at','timestamp with time zone',true,'now()']],
 cop_web_session_erasure_fences:[['owner_hash','text',true,null],['created_at','timestamp with time zone',true,'now()']],
 cop_web_session_erasure_metadata:[['id','integer',true,null],['key_fingerprint','text',true,null]]
};
function prerequisiteSql(){
 const s=readFileSync(new URL('../../apps/cop-api/src/legacy-erasure-schema.ts',import.meta.url),'utf8'),a=/export const legacyErasureColumnsSql = `([^`]+)`;/u.exec(s)?.[1],b=/export const legacyErasureTablesSql = `([^`]+)`;/u.exec(s)?.[1];
 need(a&&b,'LEGACY_PREP_SCHEMA_EXPORT_MISSING');const statements=(a+b).split(';').map(v=>v.trim()).filter(Boolean);
 const columns=Object.entries(provenanceColumnSpecs).flatMap(([t,cs])=>cs.map(c=>'ALTER TABLE '+t+' ADD COLUMN IF NOT EXISTS '+c[0]+' '+(c[1]==='text'?'text':'boolean NOT NULL DEFAULT false')));
 need(statements.length===12&&statements.slice(0,8).every((v,i)=>v===columns[i])&&same(statements.slice(8,11).map(v=>/^CREATE TABLE IF NOT EXISTS (cop_[a-z_]+) \(/u.exec(v)?.[1]),Object.keys(prerequisiteTables))&&statements[11]==='CREATE INDEX IF NOT EXISTS cop_web_sessions_owner_idx ON cop_web_sessions(owner_hash) WHERE owner_hash IS NOT NULL','LEGACY_PREP_SCHEMA_SCOPE');
 const qualified=statements.map(v=>v.replace(/ALTER TABLE (cop_[a-z_]+)/u,'ALTER TABLE public.$1').replace(/CREATE TABLE IF NOT EXISTS (cop_[a-z_]+)/u,'CREATE TABLE IF NOT EXISTS public.$1').replace(/\bON (cop_[a-z_]+)/u,'ON public.$1'));
 return {sql:qualified.map(v=>v+';').join('\n'),digest:hash([a,b])};
}
export function legacyErasureSchemaDdlSha256(){return prerequisiteSql().digest;}
function validatePreparationPlan(plan,reviewedPlanSha256,issuer){
 if(plan?.contractVersion==='cop-legacy-erasure-provenance-enrollment-v1')return validate(plan,reviewedPlanSha256,issuer);
 need(fixedKeys(plan,['contractVersion','planId','binding','writer','exportedDdlSha256'])&&plan.contractVersion==='cop-legacy-erasure-schema-preparation-plan-v1'&&uuid.test(plan.planId??'')&&hex.test(reviewedPlanSha256??'')&&hash(plan)===reviewedPlanSha256&&plan.exportedDdlSha256===prerequisiteSql().digest,'LEGACY_SCHEMA_PLAN_NOT_REVIEWED');
 need(fixedKeys(plan.binding,['guardStoreId','applicationStoreId','incarnationId','restoreGeneration','configurationFingerprint'])&&[plan.binding.guardStoreId,plan.binding.applicationStoreId,plan.binding.incarnationId].every(v=>uuid.test(v))&&Number.isSafeInteger(plan.binding.restoreGeneration)&&plan.binding.restoreGeneration>0&&hex.test(plan.binding.configurationFingerprint),'LEGACY_PLAN_BINDING_INVALID');
 need(fixedKeys(plan.writer,['containerId','imageId'])&&hex.test(plan.writer.containerId)&&/^sha256:[a-f0-9]{64}$/u.test(plan.writer.imageId),'LEGACY_WRITER_IDENTITY_INVALID');
}
async function prerequisiteCatalog(b,owner){
 const missingColumns=[],missingTables=[],facts=[];
 for(const[table,wanted]of Object.entries(provenanceColumnSpecs)){
  const cols=(await b.query("SELECT a.attname,format_type(a.atttypid,a.atttypmod) type,a.attnotnull,pg_get_expr(d.adbin,d.adrelid) default_value,a.attidentity,a.attgenerated FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum WHERE a.attrelid=$1::regclass AND a.attnum>0 AND NOT a.attisdropped",['public.'+table])).rows;
  for(const c of wanted){const row=cols.find(v=>v.attname===c[0]);if(!row){missingColumns.push(table+'.'+c[0]);continue;}need(row.type===c[1]&&row.attnotnull===c[2]&&row.default_value===c[3]&&!row.attidentity&&!row.attgenerated,'LEGACY_PREP_COLUMN_DRIFT');facts.push([table,c,row]);}
 }
 for(const[table,wanted]of Object.entries(prerequisiteTables)){
  if(!(await b.query('SELECT to_regclass($1) name',['public.'+table])).rows[0].name){missingTables.push(table);continue;}
  await catalog(b,[table],owner);const cols=(await b.query("SELECT a.attname,format_type(a.atttypid,a.atttypmod) type,a.attnotnull,pg_get_expr(d.adbin,d.adrelid) default_value,a.attidentity,a.attgenerated FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum WHERE a.attrelid=$1::regclass AND a.attnum>0 AND NOT a.attisdropped ORDER BY a.attnum",['public.'+table])).rows;
  need(same(cols.map(v=>[v.attname,v.type,v.attnotnull,v.default_value]),wanted)&&cols.every(v=>!v.attidentity&&!v.attgenerated),'LEGACY_PREP_TABLE_COLUMN_DRIFT');
  const constraints=(await b.query("SELECT contype,pg_get_constraintdef(oid) definition,convalidated,condeferrable FROM pg_constraint WHERE conrelid=$1::regclass AND contype<>'n' ORDER BY contype",['public.'+table])).rows;
  const pk='PRIMARY KEY ('+wanted[0][0]+')';need(constraints.length===(table==='cop_web_session_erasure_metadata'?2:1)&&constraints.every(v=>v.convalidated&&!v.condeferrable&&(v.contype==='p'?v.definition===pk:v.contype==='c'&&v.definition==='CHECK ((id = 1))')),'LEGACY_PREP_TABLE_CONSTRAINT_DRIFT');
  need((await b.query('SELECT count(*)::int n FROM public.'+table)).rows[0].n===0,'LEGACY_PREP_EXISTING_ERASURE_STATE');facts.push([table,cols,constraints]);
 }
 const index=(await b.query("SELECT i.indisvalid,i.indisready,i.indisunique,pg_get_indexdef(i.indexrelid) definition FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname='cop_web_sessions_owner_idx'")).rows;
 let missingIndex=index.length===0;
 if(!missingIndex)need(index.length===1&&index[0].indisvalid&&index[0].indisready&&!index[0].indisunique&&index[0].definition.replaceAll('public.','')==='CREATE INDEX cop_web_sessions_owner_idx ON cop_web_sessions USING btree (owner_hash) WHERE (owner_hash IS NOT NULL)','LEGACY_PREP_INDEX_DRIFT');
 return {missingColumns,missingTables,missingIndex,digest:hash([facts,index])};
}
async function prepareLegacy({mode,business,guard,plan,reviewedPlanSha256,issuer,fixture=false,hostWriterWitness}){
 need(['check','apply'].includes(mode),'LEGACY_FIXED_MODE');validatePreparationPlan(plan,reviewedPlanSha256,issuer);const currentWitness=()=>fixture?{...pausedWriter(plan.writer,true),reviewedPlanSha256}:hostWriterWitness,writerBefore=writerWitness(plan,reviewedPlanSha256,currentWitness()),ddl=prerequisiteSql(),b=await business.connect(),g=await guard.connect();let bt=false,gt=false;
 try{
  await b.query('BEGIN');bt=true;await b.query("SET LOCAL lock_timeout='3s';SET LOCAL statement_timeout='30s';SET LOCAL search_path=pg_catalog,public;SET LOCAL TimeZone='UTC'");await b.query("SELECT pg_advisory_xact_lock(hashtextextended('cop-content-writers-v1',731032))");
  const owner=(await b.query("SELECT pg_get_userbyid(relowner) owner FROM pg_class WHERE oid='public.cop_mobility_v1'::regclass")).rows[0]?.owner;need(/^[A-Za-z_][A-Za-z0-9_]{0,62}$/u.test(owner??''),'LEGACY_OWNER_UNPROVEN');
  const role=(await b.query('SELECT rolsuper,rolcreatedb,rolcreaterole,rolbypassrls FROM pg_roles WHERE rolname=$1',[owner])).rows[0];need(role&&!role.rolsuper&&!role.rolcreatedb&&!role.rolcreaterole&&!role.rolbypassrls,'LEGACY_APP_ROLE_UNPROVEN');
  const base=[...new Set(tables)].filter(v=>!Object.hasOwn(prerequisiteTables,v));await catalog(b,base,owner);await b.query('LOCK TABLE '+base.sort().map(v=>'public.'+v).join(',')+' IN SHARE ROW EXCLUSIVE MODE');
  await g.query('BEGIN');gt=true;await g.query("SET LOCAL lock_timeout='3s';SET LOCAL statement_timeout='30s'");await g.query('SELECT pg_advisory_xact_lock(1932540802,2)');
  const beforeBinding=await binding(g,b,plan.binding,new Set(Object.keys(prerequisiteTables))),before=await prerequisiteCatalog(b,owner);
  need((await b.query('SELECT rolsuper FROM pg_roles WHERE rolname=session_user')).rows[0]?.rolsuper===true,'LEGACY_ROOT_DATABASE_ADMIN_REQUIRED');await b.query('SET LOCAL ROLE "'+owner+'"');
  if(mode==='apply')await b.query(ddl.sql);const after=await prerequisiteCatalog(b,owner),ready=after.missingColumns.length===0&&after.missingTables.length===0&&!after.missingIndex;
  need(beforeBinding===await binding(g,b,plan.binding,mode==='check'?new Set(Object.keys(prerequisiteTables)):new Set()),'LEGACY_BINDING_MOVED');need(writerBefore===writerWitness(plan,reviewedPlanSha256,currentWitness()),'LEGACY_WRITER_MOVED');
  const result={contractVersion:'cop-legacy-erasure-schema-preparation-v1',mode,schemaReady:ready,missingColumns:after.missingColumns,missingTables:after.missingTables,missingIndex:after.missingIndex,addedColumns:mode==='apply'?before.missingColumns:[],createdTables:mode==='apply'?before.missingTables:[],existingRowsReattributed:false,metadataFingerprintInserted:false,firstEnrollmentConfirmed:ready,bindingSha256:beforeBinding,catalogSha256:after.digest,exportedDdlSha256:ddl.digest,hostWriterWitnessSha256:writerBefore,hostPostReadbackRequired:true,provenanceComplete:false};
  await b.query('COMMIT');bt=false;await g.query('COMMIT');gt=false;return result;
 }catch(error){if(bt)await b.query('ROLLBACK').catch(()=>{});if(gt)await g.query('ROLLBACK').catch(()=>{});throw Error(/^LEGACY_[A-Z_]+$/u.test(error?.message??'')?error.message:'LEGACY_PREP_UNPROVEN');}finally{b.release();g.release();}
}

/** Private technical hashes only. SQL never returns row content or session
 * ciphertext to this readback path. Exact key scope is the reviewed plan. */
async function provenancePostState(b,plan){
 const rows=[],markerPresent=!!(await b.query("SELECT to_regclass('public.cop_legacy_nonaccount_provenance') name")).rows[0].name;
 for(const r of plan.rows){const s=specs[r.kind],where=s.keys.map((k,i)=>k+'=$'+(i+1)).join(' AND '),params=s.keys.map(k=>r.key[k]);
  const actual=(await b.query(`SELECT encode(sha256(convert_to(to_jsonb(r)::text,'UTF8')),'hex') digest FROM public.${s.table} r WHERE ${where}`,params)).rows;need(actual.length===1&&hex.test(actual[0].digest),'LEGACY_POST_STATE_ROW_MISSING');
  let ownershipSha256=null,nonAccountMarkerSha256=null;
  if(s.ledger){const rowKey=s.keys.map(k=>r.key[k]).join(':'),w=(await b.query("SELECT encode(sha256(convert_to(to_jsonb(o)::text,'UTF8')),'hex') digest FROM cop_community_erasure_ownership o WHERE kind=$1 AND row_key=$2",[s.ledger,rowKey])).rows;need(w.length<=1,'LEGACY_POST_STATE_WITNESS_AMBIGUOUS');ownershipSha256=w[0]?.digest??sha('null');
   if(markerPresent){const m=(await b.query("SELECT encode(sha256(convert_to(to_jsonb(o)::text,'UTF8')),'hex') digest FROM cop_legacy_nonaccount_provenance o WHERE kind=$1 AND row_key=$2",[s.ledger,rowKey])).rows;need(m.length<=1,'LEGACY_POST_STATE_MARKER_AMBIGUOUS');nonAccountMarkerSha256=m[0]?.digest??null;}
  }
  rows.push({kind:r.kind,key:r.key,fullRowSha256:actual[0].digest,ownershipSha256,nonAccountMarkerSha256});
 }
 return rows;
}
function validateProvenanceReceipt(receipt,plan,reviewedPlanSha256,writerBefore){
 const keys=['contractVersion','mode','planSha256','bindingSha256','checkedRows','appliedRows','oidcRows','nonAccountRows','firstEnrollmentConfirmed','hostWriterWitnessSha256','hostPostReadbackRequired','provenanceComplete','legacySessions','signedSessionProofDigests','wholeAccountComplete','sourceHelperSha256','postState','postStateSha256'];
 need(fixedKeys(receipt,keys)&&receipt.contractVersion==='cop-legacy-erasure-provenance-enrollment-v1'&&receipt.mode==='apply'&&receipt.planSha256===reviewedPlanSha256&&receipt.sourceHelperSha256===sha(readFileSync(new URL(import.meta.url)))&&receipt.hostWriterWitnessSha256===writerBefore&&receipt.firstEnrollmentConfirmed===true&&receipt.hostPostReadbackRequired===true&&receipt.provenanceComplete===false&&receipt.wholeAccountComplete===false&&hex.test(receipt.bindingSha256??''),'LEGACY_RECEIPT_UNBOUND');
 const oidc=plan.rows.filter(r=>plan.evidence.find(e=>e.id===r.evidenceId).authentication==='verified_oidc_sub').length,sessions=plan.rows.filter(r=>r.kind==='session').length;
 need(receipt.checkedRows===plan.rows.length&&receipt.appliedRows===plan.rows.length&&receipt.oidcRows===oidc&&receipt.nonAccountRows===plan.rows.length-oidc&&fixedKeys(receipt.legacySessions,['activeCount','action','enrolled','applied'])&&receipt.legacySessions.activeCount===0&&receipt.legacySessions.action==='none'&&receipt.legacySessions.enrolled===sessions&&receipt.legacySessions.applied===(sessions>0)&&Array.isArray(receipt.signedSessionProofDigests)&&receipt.signedSessionProofDigests.length===sessions&&receipt.signedSessionProofDigests.every(v=>hex.test(v)),'LEGACY_RECEIPT_INCOMPLETE');
 need(Array.isArray(receipt.postState)&&receipt.postState.length===plan.rows.length&&receipt.postStateSha256===hash(receipt.postState),'LEGACY_RECEIPT_POST_STATE_INVALID');
 for(let i=0;i<plan.rows.length;i++){const r=plan.rows[i],s=specs[r.kind],v=receipt.postState[i],lab=plan.evidence.find(e=>e.id===r.evidenceId).authentication==='hardcoded_lab';need(fixedKeys(v,['kind','key','fullRowSha256','ownershipSha256','nonAccountMarkerSha256'])&&v.kind===r.kind&&same(v.key,r.key)&&hex.test(v.fullRowSha256??'')&&(s.ledger?hex.test(v.ownershipSha256??''):v.ownershipSha256===null)&&(lab?hex.test(v.nonAccountMarkerSha256??''):v.nonAccountMarkerSha256===null),'LEGACY_RECEIPT_POST_STATE_INVALID');}
}
async function verifyReceipt({business,guard,plan,reviewedPlanSha256,issuer,fixture=false,hostWriterWitness,receipt}){
 validate(plan,reviewedPlanSha256,issuer);const currentWitness=()=>fixture?{...pausedWriter(plan.writer,true),reviewedPlanSha256}:hostWriterWitness,writerBefore=writerWitness(plan,reviewedPlanSha256,currentWitness());validateProvenanceReceipt(receipt,plan,reviewedPlanSha256,writerBefore);
 const b=await business.connect(),g=await guard.connect();let bt=false,gt=false;
 try{
  await b.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');bt=true;await b.query("SET LOCAL lock_timeout='3s';SET LOCAL statement_timeout='30s';SET LOCAL search_path=pg_catalog,public;SET LOCAL TimeZone='UTC'");await b.query("SELECT pg_advisory_xact_lock(hashtextextended('cop-content-writers-v1',731032))");
  await g.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');gt=true;await g.query("SET LOCAL lock_timeout='3s';SET LOCAL statement_timeout='30s'");await g.query('SELECT pg_advisory_xact_lock(1932540802,2)');
  const owner=(await b.query("SELECT pg_get_userbyid(relowner) owner FROM pg_class WHERE oid='public.cop_mobility_v1'::regclass")).rows[0]?.owner;need(/^[A-Za-z_][A-Za-z0-9_]{0,62}$/u.test(owner??''),'LEGACY_OWNER_UNPROVEN');const role=(await b.query('SELECT rolsuper,rolcreatedb,rolcreaterole,rolbypassrls FROM pg_roles WHERE rolname=$1',[owner])).rows[0];need(role&&!role.rolsuper&&!role.rolcreatedb&&!role.rolcreaterole&&!role.rolbypassrls,'LEGACY_APP_ROLE_UNPROVEN');
  await catalog(b,[...new Set(tables)],owner);await provenanceColumns(b);if(receipt.nonAccountRows>0)await legacyLedgerCatalog(b,owner);const actualBinding=await binding(g,b,plan.binding,new Set(),true);need(actualBinding===receipt.bindingSha256,'LEGACY_RECEIPT_BINDING_CHANGED');
  if(plan.rows.some(r=>r.kind==='session')){const metadata=(await b.query('SELECT id,key_fingerprint FROM cop_web_session_erasure_metadata ORDER BY id')).rows;need(metadata.length<=1&&metadata.every(v=>v.id===1&&v.key_fingerprint===plan.signedSessionPolicy.encryptionKeyFingerprint),'LEGACY_SESSION_EXISTING_KEY_BINDING_CHANGED');}
  const postState=await provenancePostState(b,plan);need(same(postState,receipt.postState)&&hash(postState)===receipt.postStateSha256,'LEGACY_RECEIPT_ACTUAL_STATE_CHANGED');const activeCount=(await b.query('SELECT count(*)::int n FROM cop_web_sessions WHERE owner_hash IS NULL AND session_expires_at>now()')).rows[0].n;need(activeCount===0,'LEGACY_RECEIPT_ACTIVE_SESSION_UNPROVEN');need(writerBefore===writerWitness(plan,reviewedPlanSha256,currentWitness()),'LEGACY_WRITER_MOVED');
  await b.query('COMMIT');bt=false;await g.query('COMMIT');gt=false;return {contractVersion:'cop-legacy-erasure-provenance-receipt-readback-v1',verified:true,readOnly:true,planSha256:reviewedPlanSha256,sourceHelperSha256:receipt.sourceHelperSha256,bindingSha256:actualBinding,postStateSha256:receipt.postStateSha256,checkedRows:postState.length,legacySessions:{activeCount},hostWriterWitnessSha256:writerBefore,hostPostReadbackRequired:true,provenanceComplete:false,wholeAccountComplete:false};
 }catch(error){if(bt)await b.query('ROLLBACK').catch(()=>{});if(gt)await g.query('ROLLBACK').catch(()=>{});throw Error(/^LEGACY_[A-Z_]+$/u.test(error?.message??'')?error.message:'LEGACY_RECEIPT_UNPROVEN');}finally{b.release();g.release();}
}

async function enroll({mode,business,guard,plan,reviewedPlanSha256,issuer,fixture=false,hostWriterWitness,sessionInputs}){
 need(['check','apply'].includes(mode),'LEGACY_FIXED_MODE');const evidence=validate(plan,reviewedPlanSha256,issuer);
 const currentWitness=()=>fixture?{...pausedWriter(plan.writer,true),reviewedPlanSha256}:hostWriterWitness;
 const writerBefore=writerWitness(plan,reviewedPlanSha256,currentWitness()),b=await business.connect(),g=await guard.connect();let bt=false,gt=false;
 try{
  await b.query('BEGIN');bt=true;await b.query("SET LOCAL lock_timeout='3s';SET LOCAL statement_timeout='30s';SET LOCAL search_path=pg_catalog,public;SET LOCAL TimeZone='UTC'");
  await b.query("SELECT pg_advisory_xact_lock(hashtextextended('cop-content-writers-v1',731032))");
  const ownerRows=(await b.query("SELECT pg_get_userbyid(relowner) owner FROM pg_class WHERE oid='public.cop_mobility_v1'::regclass")).rows;need(ownerRows.length===1&&/^[A-Za-z_][A-Za-z0-9_]{0,62}$/u.test(ownerRows[0].owner),'LEGACY_OWNER_UNPROVEN');const owner=ownerRows[0].owner;
  const role=(await b.query('SELECT rolsuper,rolcreatedb,rolcreaterole,rolbypassrls FROM pg_roles WHERE rolname=$1',[owner])).rows[0];need(role&&!role.rolsuper&&!role.rolcreatedb&&!role.rolcreaterole&&!role.rolbypassrls,'LEGACY_APP_ROLE_UNPROVEN');
  await catalog(b,[...new Set(tables)],owner);await provenanceColumns(b);await b.query('LOCK TABLE '+[...new Set(tables)].sort().map(v=>'public.'+v).join(',')+' IN SHARE ROW EXCLUSIVE MODE');
  await g.query('BEGIN');gt=true;await g.query("SET LOCAL lock_timeout='3s';SET LOCAL statement_timeout='30s'");await g.query('SELECT pg_advisory_xact_lock(1932540802,2)');const before=await binding(g,b,plan.binding);
  need((await b.query('SELECT rolsuper FROM pg_roles WHERE rolname=session_user')).rows[0]?.rolsuper===true,'LEGACY_ROOT_DATABASE_ADMIN_REQUIRED');await b.query('SET LOCAL ROLE "'+owner+'"');
  if(plan.rows.some(r=>r.kind==='session')){
   need(sessionInputs,'LEGACY_SESSION_PROOF_INPUTS_REQUIRED');
   await b.query("SELECT pg_advisory_xact_lock(18101203,hashtext('owner-key-configuration'))");
   const metadata=(await b.query('SELECT id,key_fingerprint FROM cop_web_session_erasure_metadata ORDER BY id')).rows;
   need(metadata.length<=1&&metadata.every(v=>v.id===1&&v.key_fingerprint===sessionInputs.policy.encryptionKeyFingerprint),'LEGACY_SESSION_EXISTING_KEY_BINDING_CHANGED');
  }
  const checks=[];
  for(const r of plan.rows){const s=specs[r.kind],e=evidence.get(r.evidenceId),where=s.keys.map((k,i)=>k+'=$'+(i+1)).join(' AND '),params=s.keys.map(k=>r.key[k]);
   const found=(await b.query(`SELECT to_jsonb(r)::text row_text FROM public.${s.table} r WHERE ${where} FOR UPDATE`,params)).rows;need(found.length===1&&sha(found[0].row_text)===r.fullRowSha256,'LEGACY_FULL_ROW_CAS_FAILED');const value=JSON.parse(found[0].row_text);
   const sessionEvidence=r.kind==='session'?signedSessionProof(value,r.originalSubjects,sessionInputs):undefined;
   const subjects=sessionEvidence?r.originalSubjects:[...new Set([...s.subject.map(k=>value[k]),...(r.kind==='voice'?value.participant_subject_ids??[]:[]),...(r.kind==='pairing'?[value.device_payload?.subjectId]:[])].filter(v=>v!==null&&v!==undefined))].sort();need(same(subjects,r.originalSubjects),'LEGACY_ORIGINAL_SUBJECT_CHANGED');
   const times=s.times.map(k=>value[k]).filter(v=>v!==null&&v!==undefined);need(times.length>0&&times.every(t=>Number.isFinite(Date.parse(t))&&Date.parse(t)>=Date.parse(e.validFrom)&&Date.parse(t)<Date.parse(e.validUntil)),'LEGACY_WRITER_TIME_WINDOW_UNPROVEN');
   if(s.issuer)need(value[s.issuer]===null,'LEGACY_EXISTING_ISSUER_NOT_NULL');
   if(r.kind==='pairing'){
    need(value.created_by_owner_issuer===null&&value.claimed_by_owner_issuer===null&&(!value.device_payload||value.device_payload.ownerIssuer===undefined),'LEGACY_EXISTING_ISSUER_NOT_NULL');
    need(value.device_payload===null||(typeof value.device_payload==='object'&&!Array.isArray(value.device_payload)&&uuid.test(value.device_payload.subjectId??'')&&value.device_payload.subjectId===value.claimed_by_subject_id),'LEGACY_PAIRING_PAYLOAD_PROVENANCE_UNPROVEN');
   }
   if(r.kind==='voice')need(value.kind==='direct'&&Array.isArray(value.participant_subject_ids)&&value.participant_subject_ids.length===1,'LEGACY_VOICE_NAMESPACE_UNPROVEN');
   if(r.kind==='profile')need(value.erasure_fenced===false,'LEGACY_PROFILE_ALREADY_FENCED');
   let rowKey,ownership;
   if(s.ledger){rowKey=s.keys.length===1?String(value[s.keys[0]]):String(value[s.keys[0]])+':'+value.subject_id;const existing=(await b.query('SELECT to_jsonb(o)::text row_text FROM cop_community_erasure_ownership o WHERE kind=$1 AND row_key=$2 FOR UPDATE',[s.ledger,rowKey])).rows;need(existing.length<=1&&sha(existing[0]?.row_text??'null')===r.ownershipBeforeSha256,'LEGACY_OWNERSHIP_WITNESS_CHANGED');ownership=existing[0]?JSON.parse(existing[0].row_text):null;need(!ownership||(ownership.issuer===null&&ownership.subject_id===subjects[0]),'LEGACY_EXISTING_OWNERSHIP_NOT_NULL');}
   checks.push({r,s,e,where,params,value,rowKey,ownership,sessionEvidence});
  }
  if(mode==='apply'){
   const needsLab=checks.some(v=>v.e.authentication==='hardcoded_lab');if(needsLab){await b.query(schema());await legacyLedgerCatalog(b,owner);}
   for(const v of checks){const{r,s,e,where,params,value,rowKey,ownership,sessionEvidence}=v;let sessionCiphertext;
    if(e.authentication==='hardcoded_lab'){
     const prior=(await b.query('SELECT * FROM cop_legacy_nonaccount_provenance WHERE kind=$1 AND row_key=$2',[s.ledger,rowKey])).rows;need(prior.length===0,'LEGACY_NONACCOUNT_ALREADY_ENROLLED');
     await b.query("INSERT INTO cop_legacy_nonaccount_provenance(kind,row_key,writer_kind,source_revision,evidence_digest,row_sha256,ownership_sha256) VALUES($1,$2,'hardcoded_lab',$3,$4,$5,$6)",[s.ledger,rowKey,revision,hash(e),r.fullRowSha256,r.ownershipBeforeSha256]);
    }else if(s.ledger){
     if(ownership)need((await b.query('UPDATE cop_community_erasure_ownership SET issuer=$3 WHERE kind=$1 AND row_key=$2 AND issuer IS NULL',[s.ledger,rowKey,issuer])).rowCount===1,'LEGACY_OWNERSHIP_UPDATE_FAILED');
     else await b.query('INSERT INTO cop_community_erasure_ownership(kind,row_key,subject_id,issuer) VALUES($1,$2,$3,$4)',[s.ledger,rowKey,r.originalSubjects[0],issuer]);
    }else if(r.kind==='session'){
     sessionCiphertext=encryptSession(sessionEvidence.next,sessionInputs.key);
     need(same(decryptSession(sessionCiphertext,sessionInputs.key),sessionEvidence.next),'LEGACY_SESSION_REENCRYPT_READBACK_FAILED');
     need((await b.query('UPDATE cop_web_sessions SET token_payload=$2,owner_hash=$3 WHERE session_id=$1 AND owner_hash IS NULL AND token_payload=$4',[value.session_id,sessionCiphertext,sessionEvidence.ownerHash,value.token_payload])).rowCount===1,'LEGACY_SESSION_BLOB_CAS_FAILED');
    }else if(r.kind==='pairing'){
     const count=params.length;need((await b.query(`UPDATE public.${s.table} SET created_by_owner_issuer=$${count+1},claimed_by_owner_issuer=CASE WHEN claimed_by_subject_id IS NULL THEN NULL ELSE $${count+1} END,device_payload=CASE WHEN device_payload IS NULL THEN NULL ELSE jsonb_set(device_payload,'{ownerIssuer}',to_jsonb($${count+1}::text)) END WHERE ${where} AND created_by_owner_issuer IS NULL AND claimed_by_owner_issuer IS NULL`,[...params,issuer])).rowCount===1,'LEGACY_PAIRING_UPDATE_FAILED');
    }else need((await b.query(`UPDATE public.${s.table} SET ${s.issuer}=$${params.length+1} WHERE ${where} AND ${s.issuer} IS NULL`,[...params,issuer])).rowCount===1,'LEGACY_ISSUER_UPDATE_FAILED');
    // Full-row before CAS was mandatory; post-readback must contain exactly the
    // intended provenance additions and preserve every other original field.
    const actual=JSON.parse((await b.query(`SELECT to_jsonb(r)::text row_text FROM public.${s.table} r WHERE ${where}`,params)).rows[0].row_text);
    const expected={...value};if(e.authentication!=='hardcoded_lab'&&!s.ledger){if(r.kind==='session'){expected.token_payload=sessionCiphertext;expected.owner_hash=sessionEvidence.ownerHash;}else if(r.kind==='pairing'){expected.created_by_owner_issuer=issuer;if(expected.claimed_by_subject_id!==null)expected.claimed_by_owner_issuer=issuer;if(expected.device_payload!==null)expected.device_payload={...expected.device_payload,ownerIssuer:issuer};}else expected[s.issuer]=issuer;}
    need(same(actual,expected),'LEGACY_POST_ROW_READBACK_FAILED');
    if(r.kind==='session')need(same(decryptSession(actual.token_payload,sessionInputs.key),sessionEvidence.next)&&actual.owner_hash===sessionEvidence.ownerHash,'LEGACY_SESSION_POST_READBACK_FAILED');
    if(s.ledger){
     const witness=(await b.query('SELECT to_jsonb(o)::text row_text FROM cop_community_erasure_ownership o WHERE kind=$1 AND row_key=$2',[s.ledger,rowKey])).rows;
     if(e.authentication==='hardcoded_lab'){
      need(sha(witness[0]?.row_text??'null')===r.ownershipBeforeSha256,'LEGACY_LAB_WITNESS_MUTATED');
      const marker=(await b.query('SELECT * FROM cop_legacy_nonaccount_provenance WHERE kind=$1 AND row_key=$2',[s.ledger,rowKey])).rows;
      need(marker.length===1&&same(marker[0],{kind:s.ledger,row_key:rowKey,writer_kind:'hardcoded_lab',source_revision:revision,evidence_digest:hash(e),row_sha256:r.fullRowSha256,ownership_sha256:r.ownershipBeforeSha256}),'LEGACY_LAB_MARKER_READBACK_FAILED');
     }else need(witness.length===1&&same(JSON.parse(witness[0].row_text),{kind:s.ledger,row_key:rowKey,subject_id:r.originalSubjects[0],issuer}),'LEGACY_OIDC_WITNESS_READBACK_FAILED');
    }
   }
  }
  need(before===await binding(g,b,plan.binding),'LEGACY_BINDING_MOVED');need(writerBefore===writerWitness(plan,reviewedPlanSha256,currentWitness()),'LEGACY_WRITER_MOVED');
  const sessionPlan=(await b.query('SELECT count(*)::int n FROM cop_web_sessions WHERE owner_hash IS NULL AND session_expires_at>now()')).rows[0].n;
  const postState=mode==='apply'?await provenancePostState(b,plan):[];
  const result={contractVersion:'cop-legacy-erasure-provenance-enrollment-v1',sourceHelperSha256:sha(readFileSync(new URL(import.meta.url))),postState,postStateSha256:hash(postState),mode,planSha256:reviewedPlanSha256,bindingSha256:before,checkedRows:checks.length,appliedRows:mode==='apply'?checks.length:0,oidcRows:checks.filter(v=>v.e.authentication==='verified_oidc_sub').length,nonAccountRows:checks.filter(v=>v.e.authentication==='hardcoded_lab').length,firstEnrollmentConfirmed:true,hostWriterWitnessSha256:writerBefore,hostPostReadbackRequired:true,provenanceComplete:false,legacySessions:{activeCount:sessionPlan,action:sessionPlan?'original_signed_token_provenance_required':'none',enrolled:checks.filter(v=>v.r.kind==='session').length,applied:mode==='apply'&&checks.some(v=>v.r.kind==='session')},signedSessionProofDigests:checks.filter(v=>v.sessionEvidence).map(v=>v.sessionEvidence.proofDigest),wholeAccountComplete:false};
  await b.query('COMMIT');bt=false;await g.query('COMMIT');gt=false;return result;
 }catch(error){if(bt)await b.query('ROLLBACK').catch(()=>{});if(gt)await g.query('ROLLBACK').catch(()=>{});throw Error(/^LEGACY_[A-Z_]+$/u.test(error?.message??'')?error.message:'LEGACY_PROVENANCE_UNPROVEN');}
 finally{b.release();g.release();}
}

const policyAttestation={contractVersion:'cop-historical-issuer-operator-attestation-v1',reference:'call_0ec214d3623f442da730ce7a86fbdbe6',claim:'all_real_COP_Jizda_accounts_only_current_Keycloak_realm_cop'};
function validateCandidatePolicy(p,reviewedPolicySha256,issuer){
 need(fixedKeys(p,['contractVersion','planId','binding','writer','issuer','evidence','historicalIssuerAttestation',...(Object.hasOwn(p??{},'signedSessionPolicy')?['signedSessionPolicy']:[])])&&p.contractVersion==='cop-legacy-erasure-provenance-policy-v1'&&uuid.test(p.planId??'')&&hex.test(reviewedPolicySha256??'')&&hash(p)===reviewedPolicySha256,'LEGACY_POLICY_NOT_REVIEWED');
 need(p.issuer===issuer&&/^https:\/\//u.test(issuer)&&!/[?#@]/u.test(issuer)&&same(p.historicalIssuerAttestation,policyAttestation),'LEGACY_POLICY_HISTORICAL_ATTESTATION_UNPROVEN');
 need(fixedKeys(p.binding,['guardStoreId','applicationStoreId','incarnationId','restoreGeneration','configurationFingerprint'])&&[p.binding.guardStoreId,p.binding.applicationStoreId,p.binding.incarnationId].every(v=>uuid.test(v))&&Number.isSafeInteger(p.binding.restoreGeneration)&&p.binding.restoreGeneration>0&&hex.test(p.binding.configurationFingerprint),'LEGACY_PLAN_BINDING_INVALID');
 need(fixedKeys(p.writer,['containerId','imageId'])&&hex.test(p.writer.containerId)&&/^sha256:[a-f0-9]{64}$/u.test(p.writer.imageId),'LEGACY_WRITER_IDENTITY_INVALID');
 need(Array.isArray(p.evidence)&&p.evidence.length>0&&p.evidence.length<=100,'LEGACY_POLICY_EVIDENCE_REQUIRED');
 const evidence=new Map();
 for(const e of p.evidence){need(fixedKeys(e,['id','authentication','issuer','sourcePins','authConfigSha256','writersInventorySha256','validFrom','validUntil'])&&uuid.test(e.id??'')&&!evidence.has(e.id)&&['verified_oidc_sub','hardcoded_lab'].includes(e.authentication)&&e.issuer===(e.authentication==='verified_oidc_sub'?issuer:null)&&same(e.sourcePins,legacySourcePins)&&hex.test(e.authConfigSha256??'')&&hex.test(e.writersInventorySha256??'')&&Number.isFinite(Date.parse(e.validFrom))&&Number.isFinite(Date.parse(e.validUntil))&&Date.parse(e.validFrom)<Date.parse(e.validUntil),'LEGACY_HISTORICAL_EVIDENCE_REQUIRED');evidence.set(e.id,e);}

 if(p.signedSessionPolicy)validateSessionPolicy(p);return evidence;
}
function policyWriterWitness(policy,reviewedPolicySha256,witness){
 need(fixedKeys(witness,['contractVersion','containerId','imageId','pid','startedAt','paused','sourceHelperSha256','reviewedPolicySha256'])&&witness.contractVersion==='cop-legacy-provenance-policy-host-writer-v1'&&witness.containerId===policy.writer.containerId&&witness.imageId===policy.writer.imageId&&Number.isSafeInteger(witness.pid)&&witness.pid>0&&Number.isFinite(Date.parse(witness.startedAt))&&witness.paused===true&&witness.reviewedPolicySha256===reviewedPolicySha256&&witness.sourceHelperSha256===sha(readFileSync(new URL(import.meta.url))),'LEGACY_POLICY_HOST_WITNESS_UNBOUND');return hash(witness);
}
function fixturePolicyWitness(policy,reviewedPolicySha256){return {...pausedWriter(policy.writer,true),contractVersion:'cop-legacy-provenance-policy-host-writer-v1',reviewedPolicySha256};}
async function createCandidate({business,guard,plan:policy,reviewedPolicySha256,issuer,fixture=false,hostWriterWitness,sessionInputs}){
 const evidence=validateCandidatePolicy(policy,reviewedPolicySha256,issuer),currentWitness=()=>fixture?fixturePolicyWitness(policy,reviewedPolicySha256):hostWriterWitness,writerBefore=policyWriterWitness(policy,reviewedPolicySha256,currentWitness()),b=await business.connect(),g=await guard.connect();let bt=false,gt=false;
 try{
  await b.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');bt=true;await b.query("SET LOCAL lock_timeout='3s';SET LOCAL statement_timeout='30s';SET LOCAL search_path=pg_catalog,public;SET LOCAL TimeZone='UTC'");await b.query("SELECT pg_advisory_xact_lock(hashtextextended('cop-content-writers-v1',731032))");
  await g.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');gt=true;await g.query("SET LOCAL lock_timeout='3s';SET LOCAL statement_timeout='30s'");await g.query('SELECT pg_advisory_xact_lock(1932540802,2)');
  const owner=(await b.query("SELECT pg_get_userbyid(relowner) owner FROM pg_class WHERE oid='public.cop_mobility_v1'::regclass")).rows[0]?.owner;need(/^[A-Za-z_][A-Za-z0-9_]{0,62}$/u.test(owner??''),'LEGACY_OWNER_UNPROVEN');const role=(await b.query('SELECT rolsuper,rolcreatedb,rolcreaterole,rolbypassrls FROM pg_roles WHERE rolname=$1',[owner])).rows[0];need(role&&!role.rolsuper&&!role.rolcreatedb&&!role.rolcreaterole&&!role.rolbypassrls,'LEGACY_APP_ROLE_UNPROVEN');
  await catalog(b,[...new Set(tables)],owner);await provenanceColumns(b);const before=await binding(g,b,policy.binding,new Set(),true);
  if((await b.query("SELECT to_regclass('public.cop_legacy_nonaccount_provenance') name")).rows[0].name)need((await b.query('SELECT count(*)::int n FROM cop_legacy_nonaccount_provenance')).rows[0].n===0,'LEGACY_CANDIDATE_EXISTING_ENROLLMENT');
  if(policy.signedSessionPolicy){const metadata=(await b.query('SELECT id,key_fingerprint FROM cop_web_session_erasure_metadata ORDER BY id')).rows;need(metadata.length<=1&&metadata.every(v=>v.id===1&&v.key_fingerprint===policy.signedSessionPolicy.encryptionKeyFingerprint),'LEGACY_SESSION_EXISTING_KEY_BINDING_CHANGED');}
  const inventory=await inventoryRows(b),rows=[],countsByKind={};let unresolved=0,oidcRows=0,nonAccountRows=0,sessionRows=0;
  for(const r of inventory.rows){countsByKind[r.kind]=(countsByKind[r.kind]??0)+1;
   if(['known_issuer_preserve','existing_owner_hash_preserve'].includes(r.disposition))continue;
   if(r.disposition==='nonaccount_lab_preserve'&&['profile','pairing'].includes(r.kind))continue;
   if(!['oidc_history_unverified','hardcoded_lab_history_unverified','original_signed_token_proof_required'].includes(r.disposition)){unresolved++;continue;}
   let subjects=r.originalSubjects;
   if(r.kind==='session'){
    need(sessionInputs,'LEGACY_SESSION_PROOF_INPUTS_REQUIRED');const records=(await b.query('SELECT to_jsonb(r)::text row_text FROM cop_web_sessions r WHERE session_id=$1',[r.key.session_id])).rows;need(records.length===1&&sha(records[0].row_text)===r.physicalBeforeSchemaRowSha256,'LEGACY_CANDIDATE_SESSION_CAS_FAILED');const value=JSON.parse(records[0].row_text),candidateSubject=decryptSession(value.token_payload,sessionInputs.key)?.profile?.subjectId;need(uuid.test(candidateSubject??''),'LEGACY_SESSION_ORIGINAL_SUBJECT_UNPROVEN');signedSessionProof(value,[candidateSubject],sessionInputs);subjects=[candidateSubject];
   }
   const authentication=r.disposition==='hardcoded_lab_history_unverified'?'hardcoded_lab':'verified_oidc_sub',first=Date.parse(r.timeWindow.first),last=Date.parse(r.timeWindow.last),matching=[...evidence.values()].filter(e=>e.authentication===authentication&&Number.isFinite(first)&&Number.isFinite(last)&&first>=Date.parse(e.validFrom)&&last<Date.parse(e.validUntil));
   if(matching.length!==1||!Array.isArray(subjects)||subjects.length===0||r.physicalBeforeSchemaRowSha256!==r.proposedPostSchemaRowSha256){unresolved++;continue;}
   rows.push({kind:r.kind,key:r.key,fullRowSha256:r.physicalBeforeSchemaRowSha256,ownershipBeforeSha256:r.ownershipBeforeSha256,originalSubjects:subjects,evidenceId:matching[0].id});if(authentication==='hardcoded_lab')nonAccountRows++;else oidcRows++;if(r.kind==='session')sessionRows++;
  }
  const candidatePlan=unresolved===0&&rows.length>0?{contractVersion:'cop-legacy-erasure-provenance-enrollment-v1',planId:policy.planId,binding:policy.binding,writer:policy.writer,issuer:policy.issuer,evidence:policy.evidence,rows,...(policy.signedSessionPolicy?{signedSessionPolicy:policy.signedSessionPolicy}:{})}:null;
  if(candidatePlan)validate(candidatePlan,hash(candidatePlan),issuer);else if(rows.length===0&&unresolved===0)unresolved=1;
  need(before===await binding(g,b,policy.binding,new Set(),true),'LEGACY_BINDING_MOVED');need(writerBefore===policyWriterWitness(policy,reviewedPolicySha256,currentWitness()),'LEGACY_WRITER_MOVED');
  const summary={contractVersion:'cop-legacy-erasure-candidate-summary-v1',candidateSha256:candidatePlan?hash(candidatePlan):null,policySha256:reviewedPolicySha256,sourceHelperSha256:sha(readFileSync(new URL(import.meta.url))),bindingSha256:before,hostWriterWitnessSha256:writerBefore,totalRows:inventory.rowCount,countsByKind,oidcRows,nonAccountRows,sessionRows,unresolved};
  await b.query('COMMIT');bt=false;await g.query('COMMIT');gt=false;return {candidatePlan,summary};
 }catch(error){if(bt)await b.query('ROLLBACK').catch(()=>{});if(gt)await g.query('ROLLBACK').catch(()=>{});throw Error(/^LEGACY_[A-Z_]+$/u.test(error?.message??'')?error.message:'LEGACY_CANDIDATE_UNPROVEN');}finally{b.release();g.release();}
}

function privateFile(path,uid){const fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);try{const s=fstatSync(fd);need(s.isFile()&&s.nlink===1&&s.uid===uid&&(s.mode&511)===384&&s.size<=8*1024*1024,'LEGACY_PRIVATE_FILE_CUSTODY');return readFileSync(fd,'utf8');}finally{closeSync(fd);}}
/** Host Node22/24 readback only. The existing Root installer owns the lock,
 * pause and exact before/after pointer/CID checks; no socket enters the SQL
 * carrier. A final host readback is required before any complete receipt. */
export function inspectLegacyProvenanceWriter({reviewedPlanSha256}={}){
 need(process.getuid?.()===0&&hostname().split('.')[0]==='docker'&&Number(process.versions.node.split('.')[0])>=22&&!process.env.NODE_OPTIONS&&!process.env.NODE_PATH,'LEGACY_HOST_ROOT_CONTEXT');
 const plan=JSON.parse(privateFile('/srv/cop/runtime/account-erasure-install/legacy-provenance-plan.json',0));
 need(hex.test(reviewedPlanSha256??'')&&hash(plan)===reviewedPlanSha256&&hex.test(plan.writer?.containerId??'')&&/^sha256:[a-f0-9]{64}$/u.test(plan.writer?.imageId??''),'LEGACY_HOST_PLAN_NOT_REVIEWED');
 return {...pausedWriter(plan.writer,false),reviewedPlanSha256};
}
export function inspectLegacyProvenancePolicyWriter({reviewedPolicySha256}={}){
 need(process.getuid?.()===0&&hostname().split('.')[0]==='docker'&&Number(process.versions.node.split('.')[0])>=22&&!process.env.NODE_OPTIONS&&!process.env.NODE_PATH,'LEGACY_HOST_ROOT_CONTEXT');
 const policy=JSON.parse(privateFile('/srv/cop/runtime/account-erasure-install/legacy-provenance-policy.json',0));need(hex.test(reviewedPolicySha256??'')&&hash(policy)===reviewedPolicySha256&&hex.test(policy.writer?.containerId??'')&&/^sha256:[a-f0-9]{64}$/u.test(policy.writer?.imageId??''),'LEGACY_HOST_POLICY_NOT_REVIEWED');return {...pausedWriter(policy.writer,false),contractVersion:'cop-legacy-provenance-policy-host-writer-v1',reviewedPolicySha256};
}
async function productionRun({mode,password,reviewedPlanSha256,reviewedPolicySha256,hostWriterWitness,receipt}={},run){
 need(process.getuid?.()===0&&hostname().split('.')[0]==='docker'&&Number(process.versions.node.split('.')[0])===24&&!process.env.NODE_OPTIONS&&!process.env.NODE_PATH,'LEGACY_ROOT_CONTEXT');
 const env=loadOperatorEnvironment();need(env.COP_ACCOUNT_SAFETY_AUTHORITY_MODE==='database_v2'&&env.COP_ACCOUNT_ERASURE_ENABLED!=='true'&&(env.COP_ACCOUNT_ERASURE_SECRET??'').length>=32,'LEGACY_PRODUCTION_SCOPE');
 const plan=JSON.parse(privateFile(run===createCandidate?'/srv/cop/runtime/account-erasure-install/legacy-provenance-policy.json':'/srv/cop/runtime/account-erasure-install/legacy-provenance-plan.json',0));
 const expected={guardStoreId:env.COP_ACCOUNT_SAFETY_GUARD_STORE_ID,applicationStoreId:env.COP_ACCOUNT_SAFETY_STORE_ID,incarnationId:env.COP_ACCOUNT_SAFETY_INCARNATION_ID,restoreGeneration:plan.binding?.restoreGeneration,configurationFingerprint:sha('cop-account-erasure-config-v1\0'+env.COP_ACCOUNT_ERASURE_SECRET)};need(same(plan.binding,expected),'LEGACY_ENV_BINDING_CHANGED');
 const ca=readFileSync('/etc/vcode-cop-pgbouncer/postgres-ca.crt');need(sha(ca)==='7a3f9d9373cd63361148230e6c2804c6fb76dc204e18d5039aad7c7838d7a14a','LEGACY_CA_CHANGED');
 const{databaseContinuityEndpoints}=await import('../../apps/cop-api/dist/account-erasure-continuity-production.js'),routes=databaseContinuityEndpoints(env),{Pool}=createRequire(new URL('../../apps/cop-api/package.json',import.meta.url))('pg'),pools=[];
 const pool=(route,db)=>{const u=new URL(route);need(u.hostname==='haproxy.home.cz'&&u.port==='5000'&&u.pathname==='/'+db&&!u.hash&&[...u.searchParams.keys()].every(k=>k==='application_name')&&typeof password==='string'&&password&&!/[\r\n\0]/u.test(password),'LEGACY_DATABASE_ROUTE');const p=new Pool({host:u.hostname,port:5000,database:db,user:'postgres',password,ssl:{ca:ca.toString(),rejectUnauthorized:true,servername:'haproxy.home.cz'},max:1,connectionTimeoutMillis:3000,query_timeout:35000,application_name:'cop-explicit-legacy-provenance'});p.on('error',()=>{});pools.push(p);return p;};
 const issuer=env.COP_OIDC_ISSUER?.replace(/\/$/u,'');let sessionInputs;
 try{if(run===prepareLegacy)validatePreparationPlan(plan,reviewedPlanSha256,issuer);else if(run===createCandidate)validateCandidatePolicy(plan,reviewedPolicySha256,issuer);else validate(plan,reviewedPlanSha256,issuer);if((run===enroll&&plan.rows.some(r=>r.kind==='session'))||(run===createCandidate&&plan.signedSessionPolicy))sessionInputs=await loadSignedSessionInputs({plan,secret:env.COP_WEB_SESSION_SECRET,issuer,clientId:env.COP_OIDC_CLIENT_ID?.trim(),jwksUri:issuer+'/protocol/openid-connect/certs'});return await run({mode,business:pool(routes.targetUrl,'cop'),guard:pool(routes.guardUrl,'cop_account_safety_guard'),plan,reviewedPlanSha256,reviewedPolicySha256,hostWriterWitness,issuer,sessionInputs,receipt});}finally{sessionInputs?.key.fill(0);await Promise.all(pools.map(v=>v.end()));}
}
export async function generateLegacyErasureProvenanceCandidate(options){return productionRun(options,createCandidate);}
export async function enrollLegacyErasureProvenance(options){return productionRun(options,enroll);}
export async function prepareLegacyErasureSchema(options){return productionRun(options,prepareLegacy);}
export async function verifyLegacyErasureProvenanceReceipt(options){return productionRun(options,verifyReceipt);}
/** Actual host-side inspection for the uniquely labelled local fixture only. */
export function inspectLegacyProvenanceWriterFixture({writer,reviewedPlanSha256}){
 need(hex.test(writer?.containerId??'')&&/^sha256:[a-f0-9]{64}$/u.test(writer?.imageId??'')&&hex.test(reviewedPlanSha256??''),'LEGACY_FIXTURE_WRITER_SCOPE');
 return {...pausedWriter(writer,true),reviewedPlanSha256};
}
/** Only the uniquely owned local fixture can use this import-only seam. */
async function fixtureRun(options,run){for(const[k,db]of[['business','cop_legacy_provenance_test'],['guard','cop_legacy_provenance_guard_test']]){const u=new URL(options[k].options.connectionString);need(u.hostname==='127.0.0.1'&&u.pathname==='/'+db&&u.username==='cop_legacy_provenance_test_admin'&&!u.hash&&!u.search&&Number(u.port)>=1024,'LEGACY_FIXTURE_ONLY');need((await options[k].query('SHOW cluster_name')).rows[0]?.cluster_name==='cop_legacy_erasure_provenance_test','LEGACY_FIXTURE_CLUSTER');}let sessionInputs;try{if(run===prepareLegacy)validatePreparationPlan(options.plan,options.reviewedPlanSha256,options.issuer);else if(run===createCandidate)validateCandidatePolicy(options.plan,options.reviewedPolicySha256,options.issuer);else validate(options.plan,options.reviewedPlanSha256,options.issuer);if((run===enroll&&options.plan.rows.some(r=>r.kind==='session'))||(run===createCandidate&&options.plan.signedSessionPolicy))sessionInputs=await loadSignedSessionInputs({plan:options.plan,secret:options.sessionSecret,issuer:options.issuer,clientId:'cop-web',jwksUri:options.plan.signedSessionPolicy.jwksUri,fixture:true});options={...options,sessionInputs};if(options.hostWriterWitness){
 const before=run===createCandidate?fixturePolicyWitness(options.plan,options.reviewedPolicySha256):inspectLegacyProvenanceWriterFixture({writer:options.plan.writer,reviewedPlanSha256:options.reviewedPlanSha256});
 need((run===createCandidate?policyWriterWitness(options.plan,options.reviewedPolicySha256,options.hostWriterWitness):writerWitness(options.plan,options.reviewedPlanSha256,options.hostWriterWitness))===hash(before),'LEGACY_HOST_WRITER_WITNESS_UNBOUND');
 const result=await run({...options,fixture:false});
 need(hash(before)===hash(run===createCandidate?fixturePolicyWitness(options.plan,options.reviewedPolicySha256):inspectLegacyProvenanceWriterFixture({writer:options.plan.writer,reviewedPlanSha256:options.reviewedPlanSha256})),'LEGACY_HOST_POST_READBACK_CHANGED');
 return result;
 }return await run({...options,fixture:true});}finally{sessionInputs?.key.fill(0);}}
export function inspectLegacyProvenancePolicyWriterFixture({policy,reviewedPolicySha256}){need(hex.test(reviewedPolicySha256??'')&&hash(policy)===reviewedPolicySha256,'LEGACY_FIXTURE_POLICY_SCOPE');return fixturePolicyWitness(policy,reviewedPolicySha256);}
export async function generateLegacyErasureProvenanceCandidateFixture(options){return fixtureRun(options,createCandidate);}
export async function enrollLegacyErasureProvenanceFixture(options){return fixtureRun(options,enroll);}
export async function prepareLegacyErasureSchemaFixture(options){return fixtureRun(options,prepareLegacy);}
export async function verifyLegacyErasureProvenanceReceiptFixture(options){return fixtureRun(options,verifyReceipt);}

/** Read-only facts, deliberately NOT an applicable enrollment plan. No current
 * login, email matching or unverified history is promoted to authority. */
async function inventoryRows(b){
  const rows=[],missingTables=[],schemaFacts=[];let bounded=0;
  const ownershipPresent=!!(await b.query("SELECT to_regclass('public.cop_community_erasure_ownership') name")).rows[0].name;
  for(const[kind,s]of Object.entries(specs)){
   if(!(await b.query('SELECT to_regclass($1) name',['public.'+s.table])).rows[0].name){missingTables.push(s.table);continue;}
   const columns=(await b.query("SELECT a.attname,format_type(a.atttypid,a.atttypmod) type,a.attnotnull,pg_get_expr(d.adbin,d.adrelid) default_value FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum WHERE a.attrelid=$1::regclass AND a.attnum>0 AND NOT a.attisdropped ORDER BY a.attnum",['public.'+s.table])).rows;
   const projection={};for(const c of provenanceColumnSpecs[s.table]??[])if(!columns.some(v=>v.attname===c[0]))projection[c[0]]=c[0]==='erasure_fenced'?false:null;
   schemaFacts.push({table:s.table,projectedMissingProvenanceAttributes:Object.keys(projection),existingProvenanceColumns:columns.filter(v=>(provenanceColumnSpecs[s.table]??[]).some(c=>c[0]===v.attname))});
   const names=[...new Set([...s.keys,...s.subject,...s.times,...(s.issuer?[s.issuer]:[]),...(kind==='pairing'?['device_payload']:[]),...(kind==='voice'?['participant_subject_ids']:[])])];
   const metadata="jsonb_build_object("+names.flatMap(k=>["'"+k+"'",k==='device_payload'?"jsonb_build_object('subjectId',to_jsonb(r)->'device_payload'->'subjectId')":"to_jsonb(r)->'"+k+"'"]).join(',')+")"+(kind==='session'?"||jsonb_build_object('owner_hash_present',(to_jsonb(r)->>'owner_hash') IS NOT NULL)":"");
   const records=(await b.query(`SELECT ${metadata} metadata,encode(sha256(convert_to(to_jsonb(r)::text,'UTF8')),'hex') physical_sha256,encode(sha256(convert_to((to_jsonb(r)||$1::jsonb)::text,'UTF8')),'hex') projected_sha256 FROM public.${s.table} r ORDER BY ${s.keys.join(',')} LIMIT 10001`,[projection])).rows;
   bounded+=records.length;need(bounded<=10000,'LEGACY_INVENTORY_BOUND');
   for(const record of records){const m=record.metadata,key=Object.fromEntries(s.keys.map(k=>[k,m[k]])),subjects=kind==='session'?null:[...new Set([...s.subject.map(k=>m[k]),...(kind==='pairing'?[m.device_payload?.subjectId]:[]),...(kind==='voice'?m.participant_subject_ids??[]:[])].filter(v=>v!==null&&v!==undefined))].sort();
    // Never copy pairing device metadata; only its already stored exact subject.
    const times=s.times.map(k=>m[k]).filter(v=>v!==null&&v!==undefined);let ownershipBeforeSha256=null,witnessState='not_applicable',knownIssuer=s.issuer?m[s.issuer]:null;
    if(s.ledger){const rowKey=s.keys.length===1?String(m[s.keys[0]]):String(m[s.keys[0]])+':'+m.subject_id;
     if(!ownershipPresent){witnessState='table_absent';ownershipBeforeSha256=sha('null');}
     else{const witnesses=(await b.query("SELECT subject_id,issuer,encode(sha256(convert_to(to_jsonb(o)::text,'UTF8')),'hex') digest FROM cop_community_erasure_ownership o WHERE kind=$1 AND row_key=$2",[s.ledger,rowKey])).rows;need(witnesses.length<=1,'LEGACY_INVENTORY_WITNESS_AMBIGUOUS');const w=witnesses[0];ownershipBeforeSha256=w?.digest??sha('null');witnessState=w?'row_present':'row_absent';knownIssuer=w?.issuer??null;if(w&&w.subject_id!==subjects?.[0])witnessState='subject_mismatch_unresolved';}
    }
    const containsLab=subjects?.includes('lab'),allLab=subjects?.length===1&&subjects[0]==='lab';
    let disposition=kind==='session'?(m.owner_hash_present?'existing_owner_hash_preserve':'original_signed_token_proof_required'):knownIssuer?'known_issuer_preserve':containsLab?allLab?(labKinds.has(kind)?'hardcoded_lab_history_unverified':'nonaccount_lab_preserve'):'mixed_reference_unresolved':subjects?.every(v=>uuid.test(v))?'oidc_history_unverified':'non_uuid_subject_unresolved';
    if(witnessState==='subject_mismatch_unresolved')disposition=witnessState;
    rows.push({kind,key,physicalBeforeSchemaRowSha256:record.physical_sha256,proposedPostSchemaRowSha256:record.projected_sha256,ownershipBeforeSha256,ownershipWitnessState:witnessState,originalSubjects:subjects,timeWindow:{first:times.length?times.slice().sort((a,b)=>Date.parse(a)-Date.parse(b))[0]:null,last:times.length?times.slice().sort((a,b)=>Date.parse(a)-Date.parse(b)).at(-1):null},disposition,historicalEvidenceVerified:false,requiredEvidence:kind==='session'?['original_RS256_signature','fixed_issuer_client_subject','historical_row_time_binding']:['reviewed_historical_writer_source','actual_auth_configuration_covering_row_time_window']});
   }
  }
  const result={contractVersion:'cop-legacy-provenance-proposed-inventory-v1',enrollmentAllowed:false,historicalEvidenceVerified:false,guardAuthorityInspected:false,tokenPayloadReturned:false,freeContentReturned:false,missingTables:[...new Set(missingTables)],schemaFacts,rows,rowCount:rows.length,inventorySha256:hash([schemaFacts,rows])};
  return result;
}
export async function proposedInventory({business,expectedDatabase}){
 const b=await business.connect();let tx=false;
 try{
  await b.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');tx=true;await b.query("SET LOCAL statement_timeout='15s';SET LOCAL TimeZone='UTC'");need((await b.query('SELECT current_database() db')).rows[0].db===expectedDatabase,'LEGACY_INVENTORY_DATABASE_CHANGED');
  const result=await inventoryRows(b);
  await b.query('COMMIT');tx=false;return result;
 }catch(error){if(tx)await b.query('ROLLBACK').catch(()=>{});throw Error(/^LEGACY_[A-Z_]+$/u.test(error?.message??'')?error.message:'LEGACY_INVENTORY_UNPROVEN');}finally{b.release();}
}
export async function inspectLegacyErasureProvenance({password}={}){
 need(process.getuid?.()===0&&hostname().split('.')[0]==='docker'&&Number(process.versions.node.split('.')[0])===24&&!process.env.NODE_OPTIONS&&!process.env.NODE_PATH,'LEGACY_ROOT_CONTEXT');
 const env=Object.fromEntries(parseEnvironment(privateFile('/srv/cop/.env',1000))),route=new URL(env.COP_LEASE_DATABASE_URL??env.COP_DATABASE_URL),ca=readFileSync('/etc/vcode-cop-pgbouncer/postgres-ca.crt');
 need(['postgres:','postgresql:'].includes(route.protocol)&&route.hostname==='haproxy.home.cz'&&route.port==='5000'&&route.pathname==='/cop'&&!route.hash&&[...route.searchParams.keys()].every(k=>['application_name','sslmode','sslrootcert'].includes(k))&&sha(ca)==='7a3f9d9373cd63361148230e6c2804c6fb76dc204e18d5039aad7c7838d7a14a','LEGACY_INVENTORY_FIXED_ROUTE');
 need(password===undefined||(typeof password==='string'&&password.length>0&&!/[\r\n\0]/u.test(password)),'LEGACY_INVENTORY_PASSWORD_INVALID');const{Pool}=createRequire(new URL('../../apps/cop-api/package.json',import.meta.url))('pg'),business=new Pool({host:route.hostname,port:5000,database:'cop',user:password===undefined?decodeURIComponent(route.username):'postgres',password:password===undefined?decodeURIComponent(route.password):password,ssl:{ca:ca.toString(),rejectUnauthorized:true,servername:'haproxy.home.cz'},max:1,connectionTimeoutMillis:3000,query_timeout:20000,application_name:'cop-legacy-provenance-readonly'});business.on('error',()=>{});
 try{return await proposedInventory({business,expectedDatabase:'cop'});}finally{await business.end();}
}
export async function inspectLegacyErasureProvenanceFixture({business}){
 const u=new URL(business.options.connectionString);need(u.hostname==='127.0.0.1'&&u.pathname==='/cop_legacy_provenance_test'&&u.username==='cop_legacy_provenance_test_admin'&&!u.hash&&!u.search&&Number(u.port)>=1024,'LEGACY_FIXTURE_ONLY');need((await business.query('SHOW cluster_name')).rows[0]?.cluster_name==='cop_legacy_erasure_provenance_test','LEGACY_FIXTURE_CLUSTER');return proposedInventory({business,expectedDatabase:'cop_legacy_provenance_test'});
}
