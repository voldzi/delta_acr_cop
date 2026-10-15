/** Host Root fact publisher only. It never creates an enrollment, accepts a
 * policy/image, changes Docker, starts a consumer or writes database rows. */
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { canonical, readRootFile, sha256, requireGuard, requireRootDirectory } from './root-records.mjs';
import { issueRootRecord, storeRootRecord } from './root-record-issuer.mjs';
import { collectRuntimeObservation } from './root-runtime-observer.mjs';

const OWNERS = ['cop_api', 'sim_driver_measurements', 'sim_ai_router'];
const DIRECTORY = '/run/cop-account-safety/private/runtime-observations';
export async function publishRuntimeObservation(owner) {
  requireGuard(process.getuid?.() === 0 && process.geteuid?.() === 0 && OWNERS.includes(owner), 'ROOT_EXECUTION_REQUIRED');
  requireRootDirectory(DIRECTORY, { secret: true });
  const keyBytes = readRootFile('/etc/cop-account-safety/public/verification-keys.json');
  const observation = await collectRuntimeObservation(owner);
  requireGuard(Date.now() - Date.parse(observation.observedAtUTC) <= 1000, 'GUARD_HOST_OBSERVATION_STALE');
  const issued = issueRootRecord('host-runtime-observation', { observation }, { lifetimeMs: 5000, expectedKeyringDigest: sha256(keyBytes) });
  storeRootRecord(join(DIRECTORY, owner + '.json'), issued.bytes, { replace: true });
  return Object.freeze({ recordId: issued.payload.recordId, digest: issued.digest });
}
export async function main(args = process.argv.slice(2)) {
  requireGuard(canonical(args) === canonical(['--watch']), 'GUARD_HOST_WATCH_USAGE');
  let stopping = false;
  for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, () => { stopping = true; });
  while (!stopping) {
    await Promise.all(OWNERS.map(async owner => {
      try { await publishRuntimeObservation(owner); }
      catch { process.stderr.write('COP_ROOT_HOST_OBSERVATION_UNAVAILABLE ' + owner + '\n'); }
    }));
    if (!stopping) await new Promise(resolve => setTimeout(resolve, 1000));
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main().catch(() => { process.stderr.write('COP_ROOT_HOST_WATCH_UNAVAILABLE\n'); process.exitCode = 1; });
