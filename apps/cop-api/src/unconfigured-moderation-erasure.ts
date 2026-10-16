import { createHash, randomUUID } from "node:crypto";
import type { AccountErasureAdapter, AccountErasureAssessment, AccountErasureOperationContext, AccountErasureProof } from "./account-erasure.js";
import { CommunicationSafetyError } from "./communication-safety.js";
import type { MobilityStore, MobilityTransaction } from "./mobility-store.js";
import type { AuthenticatedActor } from "./security.js";

const namespace = "communication-safety:";
const prefix = namespace + "erasure-fence:";
const version = "cop-unconfigured-moderation-empty-v1";
const hex = /^[a-f0-9]{64}$/u;
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u;
interface Fence { operationId: string; proofId?: string }
const fail = () => new CommunicationSafetyError(503, "UNCONFIGURED_MODERATION_UNAVAILABLE");
const pending = (): AccountErasureProof => ({ status: "pending", remaining: "cleanup_pending" });

function validFence(key: string, value: unknown): value is Fence {
  if (!key.startsWith(prefix) || !hex.test(key.slice(prefix.length)) || !value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  const fields = Object.keys(row).sort().join(",");
  return (fields === "operationId" || fields === "operationId,proofId") &&
    typeof row.operationId === "string" && uuid.test(row.operationId) &&
    (!Object.hasOwn(row, "proofId") || typeof row.proofId === "string" && uuid.test(row.proofId));
}
async function emptyUnconfiguredStore(tx: MobilityTransaction, signal?: AbortSignal): Promise<boolean> {
  signal?.throwIfAborted();
  const rows = await tx.scan<unknown>(namespace);
  signal?.throwIfAborted();
  return rows.every(row => validFence(row.key, row.value));
}

/** Only for an absent CommunicationSafetyService with reporting disabled.
 * This owner never initializes reporting, decrypts data or erases unknown rows.
 * The actual persistent MobilityStore transaction serializes its full namespace
 * scan and compatible permanent fence with every configured service writer.
 * Existing reporting/configuration, including empty indexes, makes it unavailable.
 */
export function createUnconfiguredModerationErasureAdapter(options: {
  store: MobilityStore; issuer: string;
  assertCopAccessFenced(actor: AuthenticatedActor, context: { accountKey: string; operationId: string }): Promise<boolean>;
}): AccountErasureAdapter {
  if (!options.issuer || typeof options.assertCopAccessFenced !== "function") throw fail();
  const actorOwner = (actor: AuthenticatedActor): string => {
    if (actor.authMode !== "oidc" || actor.issuer !== options.issuer || !actor.subjectId || Buffer.byteLength(actor.subjectId) > 512 ||
      /[\u0000-\u001f\u007f]/u.test(actor.subjectId)) throw new CommunicationSafetyError(401, "UNAUTHORIZED");
    return createHash("sha256").update(JSON.stringify([actor.issuer, actor.subjectId])).digest("hex");
  };
  const assess = async (tx: MobilityTransaction, signal: AbortSignal): Promise<AccountErasureAssessment> =>
    await emptyUnconfiguredStore(tx, signal) ? { ready: true, version, transactionVersion: version } : { ready: false, reason: "adapter_unavailable" };
  return {
    id: "moderation_audit",
    async ready() { try { return await options.store.transact([], tx => emptyUnconfiguredStore(tx)); } catch { return false; } },
    async preflight(actor, { signal }) {
      actorOwner(actor);
      try { return await options.store.transact([], tx => assess(tx, signal)); }
      catch { signal.throwIfAborted(); return { ready: false, reason: "adapter_unavailable" }; }
    },
    async preflightWithin(actor, { transaction, signal }) {
      actorOwner(actor);
      try { return await assess(transaction, signal); }
      catch { signal.throwIfAborted(); throw fail(); }
    },
    async erase(inputActor, inputContext: AccountErasureOperationContext): Promise<AccountErasureProof> {
      const actor = { ...inputActor };
      const context = { accountKey: inputContext.accountKey, operationId: inputContext.operationId, requestedAt: inputContext.requestedAt, signal: inputContext.signal };
      const owner = actorOwner(actor), key = prefix + owner;
      if (!uuid.test(context.operationId) || !hex.test(context.accountKey) || !Number.isFinite(Date.parse(context.requestedAt)) ||
        new Date(context.requestedAt).toISOString() !== context.requestedAt) throw fail();
      context.signal.throwIfAborted();
      try {
        if (!await options.assertCopAccessFenced(actor, { accountKey: context.accountKey, operationId: context.operationId })) throw fail();
        context.signal.throwIfAborted();
        return await options.store.transact([key], async tx => {
          if (!await emptyUnconfiguredStore(tx, context.signal)) return pending();
          const previous = await tx.get<Fence>(key);
          if (previous && previous.operationId !== context.operationId)
            throw new CommunicationSafetyError(409, "MODERATION_ERASURE_OPERATION_CONFLICT");
          const proofId = previous?.proofId ?? randomUUID();
          if (!previous?.proofId) await tx.set(key, { operationId: context.operationId, proofId });
          const saved = await tx.get<unknown>(key);
          context.signal.throwIfAborted();
          if (!validFence(key, saved) || saved.operationId !== context.operationId || saved.proofId !== proofId) throw fail();
          if (!await emptyUnconfiguredStore(tx, context.signal)) return pending();
          return { status: "completed", proofId };
        });
      } catch (error) {
        context.signal.throwIfAborted();
        if (error instanceof CommunicationSafetyError) throw error;
        throw fail();
      }
    }
  };
}
