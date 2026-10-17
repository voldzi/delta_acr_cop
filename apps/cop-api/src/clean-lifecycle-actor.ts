import { createHmac, randomUUID } from "node:crypto";
import { opaqueUserId } from "./ai-router-chat.js";
export interface CleanLifecycleActorConfig { issuer: string; resetEpoch: string; actorSecret: string; userIdSecret: string; tokensNotBefore?: number }
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
export function validateCleanLifecycleConfig(config: CleanLifecycleActorConfig): void {
  const url = new URL(config.issuer);
  if (url.protocol !== "https:" || url.search || url.hash || url.username || url.password || !uuid.test(config.resetEpoch) ||
    config.actorSecret.length < 32 || config.userIdSecret.length < 32 ||
    (config.tokensNotBefore !== undefined && (!Number.isSafeInteger(config.tokensNotBefore) || config.tokensNotBefore < 0))) throw new Error("CLEAN_LIFECYCLE_CONFIG_INVALID");
}
/** Internal calls only, after the caller verified the OIDC actor. No user-authored text or credential in claims. */
export function signedCleanLifecycleActor(config: CleanLifecycleActorConfig, subjectId: string, options: {
  operationId?: string; requestedAt?: string; resourceId?: string; now?: Date; tokenIssuedAt?: number;
} = {}): Record<string, string> {
  validateCleanLifecycleConfig(config);
  const now = options.now ?? new Date(), sub = opaqueUserId(config.userIdSecret, subjectId);
  const operationId = options.operationId ?? randomUUID(), requestedAt = options.requestedAt ?? now.toISOString();
  const resourceId = options.resourceId ?? sub;
  if (!Number.isSafeInteger(options.tokenIssuedAt) || Number(options.tokenIssuedAt) < 0 ||
    (config.tokensNotBefore !== undefined && Number(options.tokenIssuedAt) <= config.tokensNotBefore) || Number(options.tokenIssuedAt) > Math.floor(now.getTime() / 1000) || !uuid.test(subjectId) || !uuid.test(operationId) || new Date(requestedAt).toISOString() !== requestedAt ||
    !/^[-_A-Za-z0-9]{32,128}$/u.test(resourceId)) throw new Error("CLEAN_LIFECYCLE_ACTOR_INVALID");
  const iat = Math.floor(now.getTime() / 1000);
  const claims = { iss: "cop", aud: "sim-clean-lifecycle-v1", sub, oidcIssuer: config.issuer, oidcSubject: subjectId,
    resetEpoch: config.resetEpoch, operationId, requestedAt, iat, exp: iat + 60, jti: randomUUID(), resourceId, oidcIat: options.tokenIssuedAt };
  const encoded = Buffer.from(JSON.stringify(claims)).toString("base64url");
  return { "x-cop-clean-actor": encoded,
    "x-cop-clean-actor-signature": createHmac("sha256", config.actorSecret).update(encoded).digest("hex") };
}
export function cleanLifecycleActorConfigFromEnv(actorSecret: string, env = process.env): CleanLifecycleActorConfig | undefined {
  if (env.COP_ACCOUNT_ERASURE_SCOPE !== "cop_sim_shared_identity_v1") return undefined;
  const cutoff = env.COP_USER_RESET_TOKENS_NOT_BEFORE ?? "";
  if (!/^[1-9][0-9]{0,12}$/u.test(cutoff) || !Number.isSafeInteger(Number(cutoff)) || Number(cutoff) > Math.floor(Date.now() / 1000))
    throw new Error("CLEAN_LIFECYCLE_CUTOFF_INVALID");
  const config = { tokensNotBefore: Number(cutoff), issuer: env.COP_OIDC_ISSUER ?? "", resetEpoch: env.COP_USER_RESET_EPOCH ?? "",
    actorSecret, userIdSecret: env.COP_AI_CHAT_ROUTER_USER_ID_SECRET ?? "" };
  validateCleanLifecycleConfig(config); return config;
}
