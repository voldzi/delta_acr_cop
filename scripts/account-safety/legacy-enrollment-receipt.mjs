/** First-enrollment transfer journal. Only the existing database administrator
 * may access it. The original receipt commits atomically with provenance; it
 * contains technical hashes/row keys, never tokens, ciphertext or content. */
import {createHash} from 'node:crypto';
const need=(v,c='LEGACY_DURABLE_RECEIPT_UNPROVEN')=>{if(!v)throw Error(c);};
const sha=v=>createHash('sha256').update(v).digest('hex'),hex=/^[a-f0-9]{64}$/u;
export const legacyReceiptTable='cop_legacy_erasure_enrollment_receipts';
export const legacyReceiptSchema=`CREATE TABLE IF NOT EXISTS public.cop_legacy_erasure_enrollment_receipts (
 plan_sha256 text PRIMARY KEY,
 source_sha256 text NOT NULL,
 binding_sha256 text NOT NULL,
 receipt_sha256 text NOT NULL,
 receipt_text text NOT NULL
);`;
const fields=['plan_sha256','source_sha256','binding_sha256','receipt_sha256','receipt_text'];
export async function legacyReceiptCatalog(c){
 const actor=(await c.query("SELECT current_user actor,session_user original,(SELECT rolsuper FROM pg_roles WHERE rolname=current_user) root")).rows[0];need(actor?.root===true&&actor.actor===actor.original,'LEGACY_DURABLE_ROOT_REQUIRED');
 const rows=(await c.query(`SELECT c.oid,pg_get_userbyid(c.relowner) owner,c.relkind,c.relpersistence,c.relrowsecurity,c.relforcerowsecurity,c.relispartition,
 EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid=c.oid AND NOT tgisinternal) custom_trigger,
 EXISTS(SELECT 1 FROM pg_rewrite WHERE ev_class=c.oid AND rulename<>'_RETURN') custom_rule,
 EXISTS(SELECT 1 FROM pg_inherits WHERE inhrelid=c.oid OR inhparent=c.oid) inherited,
 EXISTS(SELECT 1 FROM aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) WHERE grantee<>c.relowner) foreign_acl
 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname=$1`,[legacyReceiptTable])).rows;
 if(!rows.length)return {ready:false,missing:true,count:null};
 need(rows.length===1,'LEGACY_DURABLE_TABLE_AMBIGUOUS');const t=rows[0];need(t.owner===actor.original&&t.relkind==='r'&&t.relpersistence==='p'&&!t.relrowsecurity&&!t.relforcerowsecurity&&!t.relispartition&&!t.custom_trigger&&!t.custom_rule&&!t.inherited&&!t.foreign_acl,'LEGACY_DURABLE_TABLE_DRIFT');
 const columns=(await c.query(`SELECT a.attname name,format_type(a.atttypid,a.atttypmod) type,a.attnotnull required,a.attidentity,a.attgenerated,pg_get_expr(d.adbin,d.adrelid) default_value FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum WHERE a.attrelid=$1 AND a.attnum>0 AND NOT a.attisdropped ORDER BY a.attnum`,[t.oid])).rows;
 need(columns.length===fields.length&&columns.every((v,i)=>v.name===fields[i]&&v.type==='text'&&v.required&&!v.attidentity&&!v.attgenerated&&v.default_value===null),'LEGACY_DURABLE_COLUMN_DRIFT');
 const constraints=(await c.query("SELECT contype,convalidated,condeferrable,condeferred,pg_get_constraintdef(oid) definition FROM pg_constraint WHERE conrelid=$1 AND contype<>'n'",[t.oid])).rows;
 need(constraints.length===1&&constraints[0].contype==='p'&&constraints[0].convalidated&&!constraints[0].condeferrable&&!constraints[0].condeferred&&constraints[0].definition==='PRIMARY KEY (plan_sha256)','LEGACY_DURABLE_CONSTRAINT_DRIFT');
 const indexes=(await c.query("SELECT i.indisprimary,i.indisunique,i.indisvalid,i.indisready,i.indislive,i.indexprs IS NULL AND i.indpred IS NULL plain,i.indnatts=i.indnkeyatts keys_only,am.amname method FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid JOIN pg_am am ON am.oid=c.relam WHERE i.indrelid=$1",[t.oid])).rows;
 need(indexes.length===1&&['indisprimary','indisunique','indisvalid','indisready','indislive','plain','keys_only'].every(k=>indexes[0][k]===true)&&indexes[0].method==='btree','LEGACY_DURABLE_INDEX_DRIFT');
 const count=(await c.query('SELECT count(*)::int n FROM public.'+legacyReceiptTable)).rows[0]?.n;need(Number.isSafeInteger(count)&&count>=0&&count<=1,'LEGACY_DURABLE_FOREIGN_RECEIPTS');return {ready:true,missing:false,count};
}
export async function prepareLegacyReceiptStore(c,mode){need(['check','apply'].includes(mode),'LEGACY_DURABLE_FIXED_MODE');const before=await legacyReceiptCatalog(c);if(mode==='apply'&&!before.ready){await c.query(legacyReceiptSchema);}const after=await legacyReceiptCatalog(c);need(!after.ready||after.count===0,'LEGACY_DURABLE_EXISTING_TRANSFER');return {...after,created:mode==='apply'&&before.missing};}
function encodedReceipt(receipt){const value=JSON.stringify(receipt);need(Buffer.byteLength(value)<=1048576&&receipt?.contractVersion==='cop-legacy-erasure-provenance-enrollment-v1'&&receipt.mode==='apply'&&receipt.provenanceComplete===false&&['planSha256','sourceHelperSha256','bindingSha256'].every(k=>hex.test(receipt[k]??'')),'LEGACY_DURABLE_RAW_RECEIPT_INVALID');return value;}
export async function storeLegacyReceipt(c,receipt){const catalog=await legacyReceiptCatalog(c);need(catalog.ready&&catalog.count===0,'LEGACY_DURABLE_STORE_NOT_EMPTY');need((await c.query('SHOW transaction_read_only')).rows[0]?.transaction_read_only==='off','LEGACY_DURABLE_WRITE_TRANSACTION_REQUIRED');const raw=encodedReceipt(receipt),digest=sha(raw);await c.query('INSERT INTO public.'+legacyReceiptTable+'(plan_sha256,source_sha256,binding_sha256,receipt_sha256,receipt_text) VALUES($1,$2,$3,$4,$5)',[receipt.planSha256,receipt.sourceHelperSha256,receipt.bindingSha256,digest,raw]);return digest;}
export async function readLegacyReceipt(c,planSha256,sourceSha256){need(hex.test(planSha256??'')&&hex.test(sourceSha256??''),'LEGACY_DURABLE_FIXED_SCOPE');const catalog=await legacyReceiptCatalog(c);need(catalog.ready,'LEGACY_DURABLE_STORE_MISSING');const rows=(await c.query('SELECT * FROM public.'+legacyReceiptTable+' WHERE plan_sha256=$1',[planSha256])).rows;if(!rows.length)return null;need(rows.length===1&&rows[0].source_sha256===sourceSha256&&hex.test(rows[0].binding_sha256)&&hex.test(rows[0].receipt_sha256)&&typeof rows[0].receipt_text==='string'&&Buffer.byteLength(rows[0].receipt_text)<=1048576&&sha(rows[0].receipt_text)===rows[0].receipt_sha256,'LEGACY_DURABLE_TRANSFER_CHANGED');const receipt=JSON.parse(rows[0].receipt_text);need(encodedReceipt(receipt)===rows[0].receipt_text&&receipt.planSha256===planSha256&&receipt.sourceHelperSha256===sourceSha256&&receipt.bindingSha256===rows[0].binding_sha256,'LEGACY_DURABLE_TRANSFER_UNBOUND');return {receipt,receiptSha256:rows[0].receipt_sha256};}
export async function purgeLegacyReceipt(c,receipt){const found=await readLegacyReceipt(c,receipt.planSha256,receipt.sourceHelperSha256);if(!found)return {purged:true,alreadyTransferred:true};const expected=encodedReceipt(receipt);need(JSON.stringify(found.receipt)===expected&&found.receiptSha256===sha(expected),'LEGACY_DURABLE_PURGE_PROOF_CHANGED');need((await c.query('DELETE FROM public.'+legacyReceiptTable+' WHERE plan_sha256=$1 AND source_sha256=$2 AND binding_sha256=$3 AND receipt_sha256=$4',[receipt.planSha256,receipt.sourceHelperSha256,receipt.bindingSha256,found.receiptSha256])).rowCount===1,'LEGACY_DURABLE_PURGE_CAS_FAILED');need((await legacyReceiptCatalog(c)).count===0,'LEGACY_DURABLE_PURGE_NOT_EMPTY');return {purged:true,alreadyTransferred:false};}
