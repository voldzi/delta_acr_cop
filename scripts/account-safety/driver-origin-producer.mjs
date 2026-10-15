import { constants, openSync, writeSync, fsyncSync, closeSync } from 'node:fs';
import { join } from 'node:path';
import { GuardFailure, requireGuard, canonical, canonicalJson, readRootFile, requireRootDirectory, exact, hex, uuid, sha256 } from './root-records.mjs';

const OP_KEYS = ['contractVersion', 'operationId', 'storeIncarnation', 'permitId', 'kind', 'bodyDigest', 'schemaDigest', 'cutoff'];
const KINDS = new Set(['expire', 'revoke', 'erase', 'ack']);
const fixed = Object.freeze({
  register: 'SELECT sim_driver_guard_source.register_origin($1::uuid,$2::uuid,$3::uuid,$4::text,$5::text,$6::text,$7::timestamptz) AS value',
  claim: 'SELECT sim_driver_guard_source.claim_origin($1::uuid,$2::uuid,$3::xid8,$4::integer,$5::timestamptz) AS value',
  execute: 'SELECT sim_driver_guard_source.execute_origin($1::uuid,$2::jsonb) AS value',
  resolve: 'SELECT sim_driver_guard_source.resolve_or_seal($1::uuid) AS value',
  digest: "SELECT encode(sha256(convert_to($1::jsonb::text,'UTF8')),'hex') AS value",
  descriptor: "SELECT pg_current_xact_id()::text AS xid,pg_backend_pid() AS pid,backend_start::text AS start FROM pg_stat_activity WHERE pid=pg_backend_pid()",
});
export function validateOperation(value) {
  requireGuard(exact(value, OP_KEYS) && value.contractVersion === 'cop-driver-origin-v1' && uuid(value.operationId) &&
    uuid(value.storeIncarnation) && uuid(value.permitId) && KINDS.has(value.kind) && hex(value.bodyDigest) && hex(value.schemaDigest), 'GUARD_OPERATION_SHAPE');
  if (value.kind === 'expire') {
    const time = typeof value.cutoff === 'string' ? Date.parse(value.cutoff) : NaN;
    requireGuard(Number.isFinite(time) && new Date(time).toISOString() === value.cutoff, 'GUARD_CUTOFF');
  } else requireGuard(value.cutoff === null, 'GUARD_CUTOFF');
  return Object.freeze({ ...value });
}
async function value(client, sql, args) {
  const result = await client.query(sql, args);
  requireGuard(result.rows.length === 1 && Object.hasOwn(result.rows[0], 'value'), 'GUARD_SQL_RESPONSE');
  return result.rows[0].value;
}
async function rollback(client) { try { await client.query('ROLLBACK'); } catch { /* No inferred outcome. */ } }
function pending(reason) { return Object.freeze({ contractVersion: 'cop-driver-origin-result-v1', state: 'pending', reason }); }
function terminal(operationId, state) { return Object.freeze({ contractVersion: 'cop-driver-origin-result-v1', operationId, state }); }
export function validateRevokeEffect(effect) {
  requireGuard(exact(effect, ['deletedBatchCount']) && Number.isSafeInteger(effect.deletedBatchCount) &&
    effect.deletedBatchCount >= 0, 'GUARD_REVOKE_EFFECT');
  return Object.freeze({ deletedBatchCount: effect.deletedBatchCount });
}
function resolvedState(result, operationId) {
  requireGuard(result && result.operationId === operationId && typeof result.state === 'string', 'GUARD_ORIGIN_RESPONSE');
  if (result.state === 'origin_commit_known') return 'origin-commit-known';
  if (result.state === 'origin_no_effect_closed') return 'origin-no-effects-closed';
  requireGuard(result.state === 'pending', 'GUARD_ORIGIN_RESPONSE');
  return null;
}

/** Control COMMIT plus a second committed exact-origin observation. Neither an
 * inner JSON nor a failed COMMIT acknowledgement is returned as terminal. */
export async function resolveOriginal(control, operationId) {
  requireGuard(uuid(operationId), 'GUARD_OPERATION_SHAPE');
  try {
    await control.query('BEGIN');
    const first = await value(control, fixed.resolve, [operationId]);
    const initial = resolvedState(first, operationId);
    await control.query('COMMIT');
    if (!initial) return pending('origin-unresolved');
    await control.query('BEGIN');
    const second = await value(control, fixed.resolve, [operationId]);
    const current = resolvedState(second, operationId);
    await control.query('COMMIT');
    return current && current === initial ? terminal(operationId, current) : pending('origin-unresolved');
  } catch {
    await rollback(control);
    return pending('store-unavailable');
  }
}

/** An opaque dispatch record is persisted before effects. The production
 * factory supplies only Root-controlled storage and connections. No HTTP body,
 * caller-selected XID, SQL text or credential is accepted by this port. */
export class DriverOriginProducer {
  #control; #executor; #dispatch; #validateCurrent; #running = false;
  constructor({ control, executor, dispatch, validateCurrent }) {
    this.#control = control; this.#executor = executor; this.#dispatch = dispatch; this.#validateCurrent = validateCurrent;
  }
  async #resolve(op) {
    const resolved = await resolveOriginal(this.#control, op.operationId);
    if (resolved.state !== 'origin-commit-known' || op.kind !== 'revoke') return resolved;
    try {
      const effect = await this.#dispatch.readRevokeEffect(op);
      // Missing persisted observation is never an invented zero or a reason to
      // repeat DELETE. The HTTP owner must return 503 without this scalar.
      return effect ? Object.freeze({ ...resolved, revokeEffect: validateRevokeEffect(effect) }) : resolved;
    } catch { return pending('effect-observation-unavailable'); }
  }
  async probe(operation) {
    const op = validateOperation(operation);
    if (this.#running) return pending('origin-busy');
    this.#running = true;
    try {
      await this.#validateCurrent(op, 'probe');
      return await this.#resolve(op);
    } catch { return pending('authority-unavailable'); }
    finally { this.#running = false; }
  }
  async runOnce(operation, transientBody) {
    const op = validateOperation(operation);
    requireGuard(typeof transientBody === 'string' && Buffer.byteLength(transientBody) <= 16_384, 'GUARD_PAYLOAD_SIZE');
    if (this.#running) return pending('origin-busy');
    this.#running = true;
    let admitted = false, bodyVerified = false;
    try {
      // A previous attempted dispatch can only resolve this same origin. The
      // fresh permit check applies only to new work; historical resolution is
      // still admitted through the current protected Root binding.
      await this.#validateCurrent(op, 'probe');
      admitted = true;
      const digest = await value(this.#control, fixed.digest, [transientBody]);
      if (digest !== op.bodyDigest) return pending('authority-unavailable');
      bodyVerified = true;
      if (await this.#dispatch.exists(op)) return await this.#resolve(op);
      await this.#validateCurrent(op, 'work', transientBody);
      if (!await this.#dispatch.claim(op)) return await this.#resolve(op);
      await this.#control.query('BEGIN');
      const registered = await value(this.#control, fixed.register,
        [op.operationId, op.storeIncarnation, op.permitId, op.kind, op.bodyDigest, op.schemaDigest, op.cutoff]);
      requireGuard(registered?.operationId === op.operationId, 'GUARD_REGISTRATION_RESPONSE');
      await this.#control.query('COMMIT');
      // A target-side historical registration wins over a rewound local file.
      // Never claim another transaction for an already claimed/terminal origin.
      if (registered.state !== 'prepared') return await this.#resolve(op);
      await this.#executor.query('BEGIN');
      const result = await this.#executor.query(fixed.descriptor);
      requireGuard(result.rows.length === 1 && /^[0-9]+$/.test(result.rows[0].xid) &&
        Number.isSafeInteger(result.rows[0].pid) && result.rows[0].pid > 0 && typeof result.rows[0].start === 'string', 'GUARD_DESCRIPTOR');
      const actual = result.rows[0];
      await this.#control.query('BEGIN');
      const claim = await value(this.#control, fixed.claim, [op.operationId, op.storeIncarnation, actual.xid, actual.pid, actual.start]);
      requireGuard(claim?.operationId === op.operationId && claim.state === 'claimed', 'GUARD_CLAIM_RESPONSE');
      await this.#control.query('COMMIT');
      // An executor can receive only its actual Root-owned original descriptor;
      // both effects and marker remain inside this original transaction.
      const effect = await value(this.#executor, fixed.execute, [op.operationId, transientBody]);
      requireGuard(effect?.operationId === op.operationId && effect.kind === op.kind &&
        effect.observed === 'effects_and_marker_in_origin_transaction' && effect.provisionalInCallerTransaction === true &&
        effect.requiresOriginCommitAndFreshReadback === true, 'GUARD_EXECUTION_RESPONSE');
      if (op.kind === 'revoke') await this.#dispatch.recordRevokeEffect(op,
        validateRevokeEffect({ deletedBatchCount: effect.deletedBatchCount }));
      await this.#executor.query('COMMIT');
      return await this.#resolve(op);
    } catch {
      if (!admitted || !bodyVerified) return pending('authority-unavailable');
      await rollback(this.#executor); await rollback(this.#control);
      // No new UUID, refreshed cutoff, replacement permit or second DELETE.
      return await this.#resolve(op);
    } finally { this.#running = false; }
  }
}

export class RootDispatchFiles {
  constructor(directory) {
    requireGuard(process.getuid?.() === 0 && process.geteuid?.() === 0, 'ROOT_EXECUTION_REQUIRED');
    requireRootDirectory(directory, { secret: true });
    this.directory = directory;
  }
  async exists(op) {
    try { return this.#read(op); }
    catch (error) { if (error?.code === 'ENOENT') return false; throw new GuardFailure('GUARD_DISPATCH_UNKNOWN'); }
  }
  #read(op) {
    const path = join(this.directory, op.operationId + '.json');
    const row = canonicalJson(readRootFile(path, { secret: true, max: 1024 }));
    requireGuard(exact(row, ['operationId', 'bindingDigest']) && row.operationId === op.operationId &&
      row.bindingDigest === sha256(canonical(op)), 'GUARD_DISPATCH_BINDING');
    return true;
  }
  async claim(op) {
    requireRootDirectory(this.directory, { secret: true });
    const path = join(this.directory, op.operationId + '.json'); let fd;
    try { fd = openSync(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600); }
    catch (error) { if (error?.code === 'EEXIST') { this.#read(op); return false; } throw new GuardFailure('GUARD_DISPATCH_UNKNOWN'); }
    try {
      const bytes = Buffer.from(canonical({ operationId: op.operationId, bindingDigest: sha256(canonical(op)) }) + '\n');
      let written = 0;
      while (written < bytes.length) written += writeSync(fd, bytes, written, bytes.length - written);
      fsyncSync(fd);
    } finally { closeSync(fd); }
    const parent = openSync(this.directory, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    try { fsyncSync(parent); } finally { closeSync(parent); }
    return true;
  }
  async recordRevokeEffect(op, effect) {
    requireGuard(op.kind === 'revoke', 'GUARD_REVOKE_EFFECT');
    requireRootDirectory(this.directory, { secret: true });
    const row = { contractVersion: 'cop-root-revoke-observation-v1', operationId: op.operationId,
      bindingDigest: sha256(canonical(op)), revokeEffect: validateRevokeEffect(effect) };
    const bytes = Buffer.from(canonical(row) + '\n');
    const path = join(this.directory, op.operationId + '.effect.json'); let fd;
    try { fd = openSync(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600); }
    catch (error) {
      if (error?.code === 'EEXIST') {
        requireGuard(canonical(await this.readRevokeEffect(op)) === canonical(effect), 'GUARD_REVOKE_EFFECT_CHANGED'); return;
      }
      throw new GuardFailure('GUARD_REVOKE_EFFECT_UNAVAILABLE');
    }
    try {
      let written = 0; while (written < bytes.length) written += writeSync(fd, bytes, written, bytes.length - written);
      fsyncSync(fd);
    } finally { closeSync(fd); }
    const parent = openSync(this.directory, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    try { fsyncSync(parent); } finally { closeSync(parent); }
  }
  async readRevokeEffect(op) {
    requireGuard(op.kind === 'revoke', 'GUARD_REVOKE_EFFECT');
    let bytes;
    try { bytes = readRootFile(join(this.directory, op.operationId + '.effect.json'), { secret: true, max: 2048 }); }
    catch (error) { if (error?.code === 'ENOENT') return null; throw error; }
    const row = canonicalJson(bytes);
    requireGuard(exact(row, ['contractVersion', 'operationId', 'bindingDigest', 'revokeEffect']) &&
      row.contractVersion === 'cop-root-revoke-observation-v1' && row.operationId === op.operationId &&
      row.bindingDigest === sha256(canonical(op)), 'GUARD_REVOKE_EFFECT_BINDING');
    return validateRevokeEffect(row.revokeEffect);
  }
}
