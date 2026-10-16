import { createHash, createHmac } from "node:crypto";
import type { AccountErasureAdapter, AccountErasureAssessment, AccountErasureOperationContext, AccountErasureProof } from "./account-erasure.js";
import type { AccountErasureReplay } from "./account-erasure-continuity.js";
import { PostgresAccountErasureContinuity } from "./account-erasure-continuity-postgres.js";
import type { AuthenticatedActor } from "./security.js";

/** This owner proves live restore suppression, not physical deletion of PBS
 * copies. ADR0055 trusts administrators to quarantine restored datasets and
 * preserve the independent journal until every referring backup has expired. */
const POLICY = "cop-backup-restore-protection-v1";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const hex = /^[0-9a-f]{64}$/u;
const digest = (value: unknown) => createHash("sha256").update(POLICY + "\0").update(JSON.stringify(value)).digest("hex");

export function createBackupRestoreErasureAdapter(options: {
  /** Actual production database implementation; no positive verifier callback. */
  continuity: PostgresAccountErasureContinuity; issuer: string; identitySecret: string;
}): AccountErasureAdapter & { readonly id: "backup_restore" } {
  if (!(options.continuity instanceof PostgresAccountErasureContinuity) || !options.issuer || options.identitySecret.length < 32)
    throw new Error("BACKUP_RESTORE_CONFIGURATION_UNPROVEN");
  const fingerprint = createHash("sha256").update("cop-account-erasure-config-v1\0").update(options.identitySecret).digest("hex");
  const accountKey = (actor: AuthenticatedActor): string => {
    if (actor.authMode !== "oidc" || actor.issuer !== options.issuer || !actor.subjectId || Buffer.byteLength(actor.subjectId) > 512)
      throw new Error("BACKUP_RESTORE_ACTOR_UNPROVEN");
    return createHmac("sha256", options.identitySecret).update("cop-account-erasure-identity-v1\0")
      .update(JSON.stringify([actor.issuer, actor.subjectId])).digest("hex");
  };
  const current = async (signal?: AbortSignal): Promise<AccountErasureReplay> => {
    signal?.throwIfAborted();
    const replay = await options.continuity.snapshot();
    if (replay.configurationFingerprint !== fingerprint || !uuid.test(replay.applicationStoreId) ||
      !replay.datasetBinding || !uuid.test(replay.datasetBinding.incarnationId) ||
      !Number.isSafeInteger(replay.datasetBinding.restoreGeneration) || replay.datasetBinding.restoreGeneration < 1)
      throw new Error("BACKUP_RESTORE_BINDING_UNPROVEN");
    // This performs actual independent SQL enrollment/head and local replay
    // readback. A copied catalog file or application acceptance flag cannot pass.
    const observed = await options.continuity.assertCurrent(replay.frontier);
    const remaining = Date.parse(observed.validUntil) - Date.now();
    if (!Number.isFinite(remaining) || remaining <= 0 || remaining > 5000) throw new Error("BACKUP_RESTORE_OBSERVATION_EXPIRED");
    signal?.throwIfAborted();
    return replay;
  };
  return {
    id: "backup_restore",
    async ready() { try { await current(); return true; } catch { return false; } },
    async preflight(actor, context): Promise<AccountErasureAssessment> {
      try {
        accountKey(actor);
        const replay = await current(context.signal);
        return { ready: true, version: digest([replay.applicationStoreId, fingerprint, replay.datasetBinding]) };
      } catch { return { ready: false, reason: "adapter_unavailable" }; }
    },
    async erase(actor, context: AccountErasureOperationContext): Promise<AccountErasureProof> {
      if (!hex.test(context.accountKey) || accountKey(actor) !== context.accountKey || !uuid.test(context.operationId) ||
        !Number.isFinite(Date.parse(context.requestedAt)) || new Date(context.requestedAt).toISOString() !== context.requestedAt)
        throw new Error("BACKUP_RESTORE_OPERATION_UNPROVEN");
      const replay = await current(context.signal), binding = replay.datasetBinding!;
      if (context.datasetBinding?.incarnationId !== binding.incarnationId || context.datasetBinding.restoreGeneration !== binding.restoreGeneration)
        throw new Error("BACKUP_RESTORE_DATASET_UNPROVEN");
      const matches = replay.entries.filter(entry => entry.accountKey === context.accountKey || entry.job.operationId === context.operationId);
      if (matches.length !== 1 || matches[0]!.accountKey !== context.accountKey || matches[0]!.job.operationId !== context.operationId ||
        matches[0]!.job.requestedAt !== context.requestedAt || !matches[0]!.job.required.includes("backup_restore"))
        throw new Error("BACKUP_RESTORE_FENCE_UNPROVEN");
      context.signal.throwIfAborted();
      return { status: "completed", proofId: digest([replay.applicationStoreId, fingerprint, binding, matches[0]]) };
    }
  };
}
