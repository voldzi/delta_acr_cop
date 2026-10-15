import { buildServer } from "./server.js";
import { loadAccountErasureContinuity } from "./account-erasure-continuity-production.js";
import { PostgresAccountErasureContinuity } from "./account-erasure-continuity-postgres.js";

const port = Number.parseInt(process.env.COP_API_PORT ?? "4310", 10);
const host = process.env.COP_API_HOST ?? "0.0.0.0";
const backlog = positiveInteger(process.env.COP_API_LISTEN_BACKLOG, 4096);

const continuity = process.env.COP_ACCOUNT_ERASURE_ENABLED === "true" || process.env.COP_ACCOUNT_SAFETY_GUARD_REQUIRED === "true"
  ? await loadAccountErasureContinuity() : undefined;
const app = buildServer({ logger: true, accountErasureContinuity: continuity,
  simErasureIdentityReview: continuity instanceof PostgresAccountErasureContinuity
    ? (actor, context) => continuity.reviewRouterIdentity(actor, context, {
      issuer: process.env.COP_OIDC_ISSUER ?? "", userIdSecret: process.env.COP_AI_CHAT_ROUTER_USER_ID_SECRET ?? ""
    }) : undefined });
app.addHook("onClose", async () => { await continuity?.close?.(); });

try {
  await app.listen({ host, port, backlog });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}
