import { createHash } from 'node:crypto';
export const userTables = Object.freeze([
  'cop_community_report_enrichment_jobs','cop_community_report_attachments','cop_community_report_confirmations',
  'cop_community_reports','cop_community_group_members','cop_community_groups',
  'cop_mobile_mesh_acks','cop_mobile_devices','cop_mobile_pairing_sessions',
  'cop_safety_notification_cooldowns','cop_safety_notification_deliveries','cop_safety_notification_web_devices',
  'cop_user_alert_acknowledgements','cop_user_drawing_audit','cop_user_drawings',
  'cop_voice_calls','cop_web_sessions','cop_user_profiles','cop_driver_measurement_consents'
]);
export const optionalUserTables = Object.freeze([
  'cop_community_erasure_ownership','cop_community_owned_media','cop_community_metadata_owners',
  'cop_community_media_write_leases','cop_voice_media_grants','cop_incident_erasure_owners',
  'cop_incident_erasure_contributors','cop_content_erasure_media_manifest','cop_content_erasure_projection_manifest',
  'cop_incident_tasks','cop_incidents','cop_edge_replay_cursors'
]);
export const userPrefixes = Object.freeze(['identity:','account:','account-provenance:','account-email:',
  'vehicle:','group:','invite:','invite-notification:','invite-notification-handoff:','operation:',
  'device:','dispatch-device:','share:']);
const emptyOnlyTables = ['cop_domain_dead_letters','cop_openai_mcp_usage'];
const q = name => 'public."'+name+'"';
const sha = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
async function inventory(c) {
  if((await c.query('SELECT current_database() db')).rows[0].db !== 'cop') throw Error('WRONG_DATABASE');
  const counts = {};
  for(const table of userTables) counts[table] = Number((await c.query('SELECT count(*) n FROM '+q(table))).rows[0].n);
  const sideCounts={};
  for(const table of optionalUserTables) {
    const present=(await c.query('SELECT to_regclass($1) IS NOT NULL present',['public.'+table])).rows[0].present;
    sideCounts[table]=present?Number((await c.query('SELECT count(*) n FROM '+q(table))).rows[0].n):null;
  }
  const emptyOnlyCounts={};
  for(const table of emptyOnlyTables) {
    const present=(await c.query('SELECT to_regclass($1) IS NOT NULL present',['public.'+table])).rows[0].present;
    emptyOnlyCounts[table]=present?Number((await c.query('SELECT count(*) n FROM '+q(table))).rows[0].n):null;
    if(emptyOnlyCounts[table]!==null&&emptyOnlyCounts[table]!==0)throw Error('RESET_UNCLASSIFIED_QUEUE_OR_BILLING_DATA');
  }
  const auditPresent=(await c.query("SELECT to_regclass('public.cop_domain_events') IS NOT NULL present")).rows[0].present;
  const audits=auditPresent?(await c.query("SELECT count(*) FILTER(WHERE entity_type='auditRecord')::int user_audits,count(*) FILTER(WHERE entity_type<>'auditRecord')::int other_events FROM cop_domain_events")).rows[0]:null;
  const kv=(await c.query('SELECT count(*)::int total,count(*) FILTER(WHERE EXISTS(SELECT 1 FROM unnest($1::text[]) p WHERE left(key,length(p))=p))::int user_rows FROM public.cop_mobility_v1',[userPrefixes])).rows[0];
  const foreignKeys=(await c.query("SELECT conname,conrelid::regclass::text source,confrelid::regclass::text target FROM pg_constraint WHERE contype='f' AND connamespace='public'::regnamespace ORDER BY 2,1")).rows;
  const unexpected = foreignKeys.filter(f => [...userTables,...optionalUserTables].includes(f.target) && ![...userTables,...optionalUserTables].includes(f.source));
  if(unexpected.length) throw Error('UNPLANNED_FOREIGN_KEY');
  const control = (await c.query('SELECT (SELECT count(*) FROM cop_driver_measurement_config)::int driver_config,(SELECT count(*) FROM cop_federation_nodes)::int federation_config')).rows[0];
  return { contractVersion:'cop-clean-user-reset-plan-v1',counts,sideCounts,emptyOnlyCounts,audits,kv,foreignKeys,control };
}
/** Read-only plan contains names and aggregate counts, never rows or credentials. */
export async function inspectCopUserReset(pool) {
  const c=await pool.connect();try { await c.query('BEGIN READ ONLY');await c.query("SET LOCAL statement_timeout='20s'");const plan=await inventory(c);await c.query('ROLLBACK');return {...plan,planDigest:sha(plan)}; } catch(e){await c.query('ROLLBACK').catch(()=>{});throw e;}finally{c.release();}
}
/** Operator-only component, no application route and no automatic execution.
 * Caller must first freeze ALL COP writers and revoke/delete the old test identities.
 * It must maintain the freeze through filesystem/provider reset and epoch readback.
 */
export async function applyCopUserReset(pool, plan, authorization) {
  if(authorization?.contractVersion!=='cop-clean-user-reset-authorization-v1' || authorization.allCopWritersStopped!==true ||
    authorization.oldIdentityAdmissionClosed!==true || authorization.testDataDestructionApproved!==true ||
    authorization.createOldDataBackup!==false || typeof authorization.rootAdmission?.assertCurrent!=='function' || !uuid.test(authorization.resetEpoch??'') ||
    !Number.isSafeInteger(authorization.tokensNotBefore) || authorization.tokensNotBefore<=0 ||
    plan?.planDigest!==sha(Object.fromEntries(Object.entries(plan).filter(([k])=>k!=='planDigest')))) throw Error('RESET_AUTHORIZATION_REQUIRED');
  await authorization.rootAdmission.assertCurrent();
  const c=await pool.connect();try {
    await c.query('BEGIN');await c.query("SET LOCAL lock_timeout='5s'");await c.query("SET LOCAL statement_timeout='30s'");
    await c.query('SELECT pg_advisory_xact_lock(1932540802,17)');
    const side=Object.entries(plan.sideCounts).filter(([,n])=>n!==null).map(([table])=>table);
    await c.query('LOCK TABLE '+[...userTables,...side,...(plan.audits?['cop_domain_events']:[]),...Object.entries(plan.emptyOnlyCounts).filter(([,n])=>n!==null).map(([table])=>table),'cop_mobility_v1','cop_driver_measurement_config','cop_federation_nodes'].map(q).join(',')+' IN ACCESS EXCLUSIVE MODE');
    if(sha(await inventory(c))!==plan.planDigest) throw Error('RESET_PLAN_CHANGED');
    if((await c.query("SELECT to_regclass('public.cop_clean_reset_epoch') IS NOT NULL present")).rows[0].present) throw Error('RESET_ALREADY_ENROLLED');
    // No CASCADE: any unplanned dependent data blocks the transaction.
    await c.query('TRUNCATE TABLE '+[...userTables,...side].map(q).join(','));
    if(plan.audits)await c.query("DELETE FROM cop_domain_events WHERE entity_type='auditRecord'");
    await c.query('DELETE FROM public.cop_mobility_v1 WHERE EXISTS(SELECT 1 FROM unnest($1::text[]) p WHERE left(key,length(p))=p)',[userPrefixes]);
    await c.query('ALTER TABLE public.cop_user_profiles ADD COLUMN IF NOT EXISTS issuer text');
    await c.query('ALTER TABLE public.cop_user_profiles ALTER COLUMN issuer SET NOT NULL');
    await c.query("ALTER TABLE public.cop_user_profiles ADD CONSTRAINT cop_clean_profile_issuer CHECK(issuer ~ '^https://[^[:space:]]+/realms/[A-Za-z0-9_.-]+$')");
    await c.query("ALTER TABLE public.cop_user_profiles ADD CONSTRAINT cop_clean_profile_subject CHECK(subject_id ~ '^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$')");
    await c.query('CREATE TABLE public.cop_clean_reset_epoch(singleton boolean PRIMARY KEY CHECK(singleton), reset_epoch uuid NOT NULL, tokens_not_before bigint NOT NULL CHECK(tokens_not_before>0), scope text NOT NULL CHECK(scope=\'cop_sim_shared_identity_v1\'), completed_at timestamptz NOT NULL DEFAULT clock_timestamp())');
    const epochReader=(await c.query("SELECT pg_get_userbyid(c.relowner) role FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname='cop_user_profiles'")).rows[0]?.role;
    if(typeof epochReader!=='string'||!/^[A-Za-z_][A-Za-z0-9_]{0,62}$/.test(epochReader))throw Error('RESET_EPOCH_READER_UNPROVEN');
    // Existing application owner can verify the nonsecret baseline, but cannot
    // update or replace the administrator-owned reset witness.
    await c.query('GRANT SELECT ON public.cop_clean_reset_epoch TO "'+epochReader+'"');
    await c.query("INSERT INTO public.cop_clean_reset_epoch(singleton,reset_epoch,tokens_not_before,scope) VALUES(true,$1,$2,'cop_sim_shared_identity_v1')",[authorization.resetEpoch,authorization.tokensNotBefore]);
    const after=await inventory(c);
    if(Object.values(after.counts).some(n=>n!==0)||Object.values(after.sideCounts).some(n=>n!==null&&n!==0)||after.audits?.user_audits>0||after.audits?.other_events!==plan.audits?.other_events||after.kv.user_rows!==0||sha(after.control)!==sha(plan.control))throw Error('RESET_READBACK_FAILED');
    await authorization.rootAdmission.assertCurrent();
    await c.query('COMMIT');
    return {contractVersion:'cop-clean-user-reset-result-v1',resetEpoch:authorization.resetEpoch,tokensNotBefore:authorization.tokensNotBefore,removedRows:Object.values(plan.counts).reduce((a,b)=>a+b,0)+Object.values(plan.sideCounts).reduce((a,b)=>a+(b??0),0)+(plan.audits?.user_audits??0)+plan.kv.user_rows,counts:after.counts,sideCounts:after.sideCounts,audits:after.audits,configurationPreserved:true,oldDataBackupCreated:false};
  }catch(e){await c.query('ROLLBACK').catch(()=>{});throw e;}finally{c.release();}
}
