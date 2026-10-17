import { loadAccountErasureContinuity } from "./account-erasure-continuity-production.js";
import { PostgresAccountErasureContinuity } from "./account-erasure-continuity-postgres.js";
import { createBackupRestoreErasureAdapter } from "./backup-restore-erasure.js";
import { createMediaStorageFromEnv } from "./media-storage.js";
import { createMediaUploadSettlementFromEnv } from "./media-upload-settlement.js";
import type { BuildServerOptions } from "./server.js";

export interface AccountErasureRuntime {
  serverOptions: Pick<BuildServerOptions, "accountErasureContinuity" | "backupRestoreErasureAdapter" | "mediaStorage" | "simErasureIdentityReview">;
  close(): Promise<void>;
}

/** Bind real production owners once before constructing the HTTP server. The
 * database alternative never falls back to native authority or a positive
 * callback when a configured owner cannot initialize. */
export async function loadAccountErasureRuntime(): Promise<AccountErasureRuntime> {
  const env = { ...process.env };
  if (env.COP_ACCOUNT_ERASURE_SCOPE === "cop_sim_shared_identity_v1" && env.COP_ACCOUNT_SAFETY_AUTHORITY_MODE !== "database_v2")
    throw new Error("Shared identity erasure requires the independent database journal");
  if (env.COP_ACCOUNT_ERASURE_ENABLED !== "true" && env.COP_ACCOUNT_SAFETY_GUARD_REQUIRED !== "true")
    return { serverOptions: {}, close: async () => undefined };
  const continuity = await loadAccountErasureContinuity();
  let settlement: ReturnType<typeof createMediaUploadSettlementFromEnv>;
  let closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
    await Promise.all([continuity.close?.(), settlement?.close()]);
  };
  try {
    if (env.COP_ACCOUNT_ERASURE_SCOPE === "cop_sim_shared_identity_v1" && !(continuity instanceof PostgresAccountErasureContinuity))
      throw new Error("Shared identity erasure requires the actual independent database journal");
    const serverOptions: AccountErasureRuntime["serverOptions"] = { accountErasureContinuity: continuity };
    if (continuity instanceof PostgresAccountErasureContinuity) {
      const issuer = env.COP_OIDC_ISSUER ?? "";
      serverOptions.backupRestoreErasureAdapter = createBackupRestoreErasureAdapter({
        continuity, issuer, identitySecret: env.COP_ACCOUNT_ERASURE_SECRET ?? ""
      });
      serverOptions.simErasureIdentityReview = (actor, context) => continuity.reviewRouterIdentity(actor, context, {
        issuer, userIdSecret: env.COP_AI_CHAT_ROUTER_USER_ID_SECRET ?? ""
      });
      settlement = createMediaUploadSettlementFromEnv(env);
      serverOptions.mediaStorage = createMediaStorageFromEnv(env, { uploadSettlement: settlement });
    }
    return { serverOptions, close };
  } catch (error) {
    await close();
    throw error;
  }
}
