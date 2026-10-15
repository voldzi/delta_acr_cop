import { join } from 'node:path';
import { exact, hex, uuid, readRootFile, requireGuard, verifyRootRecord } from './root-records.mjs';

const CONTEXT = ['contractVersion', 'recordId', 'recordDigest', 'storeIncarnation', 'operationDigest', 'readbackDigest', 'reportProtection', 'observedAtUTC'];
const BASE = ['contractVersion', 'operationHash', 'actorHash', 'requestHash', 'contributors', 'checkpointHash'];
const PROTECTIONS = ['no_report', 'enforced_single_writer', 'shared_generation_fence'];

/** Only Root control invokes this. A typed SQL context alone is insufficient:
 * require an actual signed publication record, an independently signed report
 * inventory/barrier record, and a fresh locked source readback. No body or
 * contributor list is written to a journal or included in the public result. */
export async function validateRootPublication(control, bodyText, operation, keys, permit) {
  const body = JSON.parse(bodyText);
  requireGuard(exact(body, [...BASE, 'publicationContext']), 'GUARD_PUBLICATION_BODY');
  const context = body.publicationContext;
  requireGuard(exact(context, CONTEXT) && context.contractVersion === 'cop-driver-publication-context-v1' &&
    uuid(context.recordId) && hex(context.recordDigest) && context.storeIncarnation === operation.storeIncarnation &&
    hex(context.operationDigest) && hex(context.readbackDigest) && PROTECTIONS.includes(context.reportProtection) &&
    typeof context.observedAtUTC === 'string' && Number.isFinite(Date.parse(context.observedAtUTC)) &&
    new Date(context.observedAtUTC).toISOString() === context.observedAtUTC, 'GUARD_PUBLICATION_CONTEXT');
  const signed = verifyRootRecord(readRootFile(join('/var/lib/cop-account-safety/publication', context.recordId + '.json'), { secret: true }),
    keys, 'publication-readback');
  const p = signed.payload;
  requireGuard(signed.digest === context.recordDigest && p.recordId === context.recordId && uuid(p.eraseOriginId) &&
    p.guardStoreId === permit.guardStoreId && p.continuityEpoch === permit.continuityEpoch &&
    p.datasetBindingId === permit.datasetBindingId && p.storeIncarnation === operation.storeIncarnation &&
    p.operationDigest === context.operationDigest && p.readbackDigest === context.readbackDigest &&
    p.reportProtection === context.reportProtection && p.observedAtUTC === context.observedAtUTC &&
    Date.parse(p.observedAtUTC) <= Date.parse(p.issuedAt) &&
    exact(p.reportInventoryRef, ['recordId', 'digest']) && uuid(p.reportInventoryRef.recordId) && hex(p.reportInventoryRef.digest),
  'GUARD_PUBLICATION_RECORD');
  const inventory = verifyRootRecord(readRootFile(join('/var/lib/cop-account-safety/evidence', p.reportInventoryRef.recordId + '.json'), { secret: true }),
    keys, 'report-inventory');
  requireGuard(inventory.digest === p.reportInventoryRef.digest && inventory.payload.recordId === p.reportInventoryRef.recordId &&
    inventory.payload.guardStoreId === permit.guardStoreId && inventory.payload.continuityEpoch === permit.continuityEpoch &&
    inventory.payload.datasetBindingId === permit.datasetBindingId && inventory.payload.storeIncarnation === operation.storeIncarnation &&
    inventory.payload.scope === 'cop_jizda_preserve_shared_identity_sim' && inventory.payload.reportProtection === context.reportProtection &&
    inventory.payload.operationDigest === context.operationDigest && inventory.payload.readbackDigest === context.readbackDigest &&
    inventory.payload.decision === (context.reportProtection === 'no_report' ? 'verified-no-derived-publication' : 'verified-derived-barrier'),
  'GUARD_PUBLICATION_INVENTORY');
  const base = Object.fromEntries(BASE.map(key => [key, body[key]]));
  const response = await control.query('SELECT sim_driver_guard_source.read_publication_context($1::uuid,$2::jsonb) AS value',
    [p.eraseOriginId, JSON.stringify(base)]);
  const readback = response.rows[0]?.value;
  requireGuard(response.rows.length === 1 && readback && readback.storeIncarnation === operation.storeIncarnation &&
    readback.erasureOperationDigest === context.operationDigest && readback.databaseZeroVerified === true &&
    readback.remainingBatchCount === 0 && Array.isArray(base.contributors) &&
    readback.exactFenceCount === new Set(base.contributors.map(row => row.contributorHash)).size,
  'GUARD_PUBLICATION_READBACK');
  const stableReadback = { ...readback, readbackAt: context.observedAtUTC };
  const digest = await control.query("SELECT encode(sha256(convert_to($1::jsonb::text,'UTF8')),'hex') AS value", [JSON.stringify(stableReadback)]);
  requireGuard(digest.rows.length === 1 && digest.rows[0].value === context.readbackDigest, 'GUARD_PUBLICATION_CHANGED');
}
