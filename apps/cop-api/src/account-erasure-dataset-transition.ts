import type { Pool, PoolClient } from "pg";
import { databaseFenceDigest } from "./account-erasure-continuity-postgres.js";
import type { AccountErasureFenceEntry } from "./account-erasure-continuity.js";

/** Administrator-only database stage, never an HTTP/API runtime operation.
 * Caller must quarantine every affected owner before restoring/rebinding and
 * keep it quarantined through fresh replay/owner acceptance. This function
 * cannot attest hypervisor actions, backup expiry or provider cleanup. */
export interface DatasetTransition {
  guardStoreId: string; applicationStoreId: string; configurationFingerprint: string;
  previous: { incarnationId: string; restoreGeneration: number };
  restoredLocal: { incarnationId: string; restoreGeneration: number };
  next: { incarnationId: string; restoreGeneration: number };
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const hex = /^[0-9a-f]{64}$/u;
const need = (value: unknown): void => { if (!value) throw new Error("RESTORE_TRANSITION_UNPROVEN"); };
const equalBinding = (actual: { incarnation_id: string; restore_generation: string }, expected: DatasetTransition["next"]) =>
  actual.incarnation_id === expected.incarnationId && Number(actual.restore_generation) === expected.restoreGeneration;

export async function transitionAccountErasureDataset(guard: Pool, business: Pool, plan: DatasetTransition): Promise<{
  status: "replay_required"; datasetBinding: DatasetTransition["next"]; journalSequence: number; journalDigest: string;
}> {
  need([plan.guardStoreId,plan.applicationStoreId,plan.previous.incarnationId,plan.restoredLocal.incarnationId,plan.next.incarnationId].every(v=>uuid.test(v)) &&
    hex.test(plan.configurationFingerprint) && [plan.previous.restoreGeneration,plan.restoredLocal.restoreGeneration,plan.next.restoreGeneration].every(v=>Number.isSafeInteger(v)&&v>0) &&
    plan.next.restoreGeneration===plan.previous.restoreGeneration+1 && plan.next.incarnationId!==plan.previous.incarnationId &&
    plan.next.incarnationId!==plan.restoredLocal.incarnationId && plan.restoredLocal.restoreGeneration<=plan.previous.restoreGeneration);
  let g: PoolClient | undefined, b: PoolClient | undefined, guardCommitted=false;
  try {
    g=await guard.connect(); b=await business.connect();
    for(const c of [g,b]) {
      const role=(await c.query("SELECT current_setting('is_superuser') superuser,pg_is_in_recovery() recovery,current_database() database")).rows[0];
      need(role?.superuser==='on' && role.recovery===false && (c===g ? role.database==='cop_account_safety_guard' : ['cop','cop_erasure_test'].includes(role.database)));
    }
    await g.query("BEGIN");await g.query("SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='30s'");
    await g.query("SELECT pg_advisory_xact_lock(1932540802,2)");
    await b.query("BEGIN");await b.query("SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='30s'");
    await b.query("SELECT pg_advisory_xact_lock(hashtextextended($1,731031))",['mobility-v1']);
    await b.query("LOCK TABLE cop_mobility_v1 IN ACCESS EXCLUSIVE MODE");
    const cfg=(await g.query("SELECT * FROM cop_safety_v2.configuration WHERE singleton")).rows[0];
    const replay=(await g.query("SELECT * FROM cop_safety_v2.dataset_replays WHERE owner='cop' FOR UPDATE")).rows[0];
    need(cfg?.contract_version==='cop-database-safety-v2' && cfg.guard_store_id===plan.guardStoreId && cfg.application_store_id===plan.applicationStoreId &&
      cfg.configuration_fingerprint===plan.configurationFingerprint && hex.test(cfg.initial_digest) && replay?.store_id===plan.applicationStoreId &&
      (equalBinding(replay,plan.previous)||equalBinding(replay,plan.next)));
    const journal=(await g.query<{sequence:string;previous_digest:string;digest:string;account_key:string;operation_id:string;entry:AccountErasureFenceEntry}>(
      "SELECT sequence,previous_digest,digest,account_key,operation_id,entry FROM cop_safety_v2.fences ORDER BY sequence LIMIT 100001")).rows;
    need(journal.length<=100000);let sequence=0,digest=cfg.initial_digest as string;
    for(const row of journal) {
      need(Number(row.sequence)===sequence+1 && row.previous_digest===digest && row.entry.contractVersion==='cop-erasure-fence-entry-v1' &&
        row.entry.applicationStoreId===plan.applicationStoreId && row.entry.configurationFingerprint===plan.configurationFingerprint &&
        row.entry.accountKey===row.account_key && row.entry.job.operationId===row.operation_id &&
        databaseFenceDigest(Number(row.sequence),row.previous_digest,row.entry)===row.digest);
      sequence=Number(row.sequence);digest=row.digest;
    }
    const marker=(await b.query("SELECT value FROM cop_mobility_v1 WHERE key='account-safety:store-identity-v1'")).rows[0]?.value;
    const local=(await b.query("SELECT value FROM cop_mobility_v1 WHERE key='account-erasure:configuration-v1'")).rows[0]?.value;
    const markerIs=(binding:DatasetTransition['next'])=>marker?.storeId===plan.applicationStoreId && marker.incarnationId===binding.incarnationId;
    const configIs=(binding:DatasetTransition['next'])=>local?.storeId===plan.applicationStoreId && local.version===4 && local.fingerprint===plan.configurationFingerprint &&
      local.datasetBinding?.incarnationId===binding.incarnationId && local.datasetBinding?.restoreGeneration===binding.restoreGeneration;
    // An exact interrupted retry is allowed; unknown/copied enrollment is not.
    need((markerIs(plan.restoredLocal)&&configIs(plan.restoredLocal)) ||
      (equalBinding(replay,plan.next)&&markerIs(plan.next)&&(configIs(plan.restoredLocal)||configIs(plan.next))));
    if(equalBinding(replay,plan.previous)) {
      await g.query("UPDATE cop_safety_v2.dataset_replays SET incarnation_id=$1,restore_generation=$2,replay_sequence=0,replay_digest=$3,accepted_at=clock_timestamp() WHERE owner='cop'",
        [plan.next.incarnationId,plan.next.restoreGeneration,cfg.initial_digest]);
    }
    if(!markerIs(plan.next)) {
      await b.query("UPDATE cop_mobility_v1 SET value=$1 WHERE key='account-safety:store-identity-v1'",[{...marker,incarnationId:plan.next.incarnationId}]);
      // Leave the original configuration binding untouched so the controller
      // detects restore, resets every checkpoint and revalidates the actor seal.
      // It writes the new binding only after actual independent replay.
    }
    await g.query("COMMIT");guardCommitted=true;
    await b.query("COMMIT");
    return {status:'replay_required',datasetBinding:{...plan.next},journalSequence:sequence,journalDigest:digest};
  } catch {
    await b?.query('ROLLBACK').catch(()=>undefined);
    if(!guardCommitted)await g?.query('ROLLBACK').catch(()=>undefined);
    throw new Error('RESTORE_TRANSITION_UNPROVEN');
  } finally { b?.release();g?.release(); }
}
