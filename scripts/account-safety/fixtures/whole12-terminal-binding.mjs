/** Read-only database and live epoch binding for the owned two-actor harness.
 * No production inputs, no deletion, no report publication or Root admission.
 */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
const {Pool}=createRequire('/app/apps/cop-api/package.json')('pg');
const sha=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export async function readWhole12TerminalBinding(root='/dev/shm/cop-clean-whole') {
  assert.equal(root,'/dev/shm/cop-clean-whole');
  const f=JSON.parse(readFileSync(root+'/cop-private.json','utf8'));
  const op=JSON.parse(readFileSync(root+'/whole12-before.json','utf8')).operationId;
  const cfg=JSON.parse(readFileSync(root+'/sim-private.json','utf8'));
  assert.equal(f.ownerLabel,'cop-clean-whole12-956262c6abdb');
  assert.equal(op,'b1c21024-0c2f-4a3d-afad-911f95d73c1b');
  const epoch=cfg.input.base.resetEpoch;
  assert.equal(epoch,'a7f98504-9c29-4942-8fb3-7236ab819a07');
  for(const url of [f.database.businessRuntimeUrl,f.database.guardAdminUrl]) {
    assert.equal(typeof url,'string');
    assert.equal(new URL(url).hostname,'127.0.0.1');
  }
  const p=new Pool({connectionString:f.database.businessRuntimeUrl,max:1});
  const g=new Pool({connectionString:f.database.guardAdminUrl,max:1});
  try {
    const jobs=(await p.query("SELECT value FROM cop_mobility_v1 WHERE left(key,length('account-erasure:job:'))='account-erasure:job:' AND value->>'operationId'=$1",[op])).rows;
    assert.equal(jobs.length,1);
    const job=jobs[0].value;
    assert.equal(job.operationId,op);assert.equal(typeof job.completedAt,'string');
    assert.equal(job.required.length,12);
    assert(job.required.every(k=>job.checkpoints[k]?.status==='completed'));
    const fences=(await g.query('SELECT operation_id::text,digest,entry FROM cop_safety_v2.fences WHERE operation_id=$1',[op])).rows;
    assert.equal(fences.length,1);assert.equal(fences[0].entry.job.operationId,op);
    const {createWhole12SimReadbackAdapter}=await import(root+'/sim-readback-source/scripts/fixtures/whole12-sim-readback-adapter.mjs');
    const sim=await createWhole12SimReadbackAdapter(root+'/sim-private.json');
    const live=await sim.readback();assert.equal(live.resetEpoch,epoch);
    assert(Object.values(live.owners).every(x=>x.stateA==='deleted'&&x.removableA===0));
    // Epoch comes from the live SIM database readback, not an invented COP
    // column. The digest binds that epoch to the actual terminal COP job and
    // its independent accepted fence. Private job/principal bytes stay here.
    return {operationId:op,resetEpoch:live.resetEpoch,operationState:'deleted',
      terminalBindingDigest:sha({resetEpoch:live.resetEpoch,job,fence:fences[0]}),
      databaseSource:'cop_mobility_v1+cop_safety_v2.fences',epochSource:'live_sim_database_readback'};
  } finally {await Promise.all([p.end(),g.end()]);}
}
