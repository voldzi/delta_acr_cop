import type { FastifyInstance, FastifyRequest } from "fastify";
import { correlationIdFrom, sendError } from "./errors.js";
import { actorFromRequest } from "./security.js";
import { VoiceGrantError, type VoiceGrantLedger } from "./voice-grant-ledger.js";
import type { VoiceGrantRevoker } from "./voice-grant-revocation.js";

export function registerVoiceGrantRevocationRoutes(app: FastifyInstance, ledger: VoiceGrantLedger | undefined,
  revoker: VoiceGrantRevoker, now: () => Date,
  verifiedActor: typeof actorFromRequest = actorFromRequest): void {
  app.post("/api/v1/me/voice-installations/revoke", {
    bodyLimit: 1_024, config: { rateLimit: { max: 10, timeWindow: "1 minute" } }
  }, async (request: FastifyRequest, reply) => {
    reply.header("Cache-Control", "no-store");
    try {
      const actor = verifiedActor(request);
      if (!actor || actor.authMode !== "oidc" || !actor.issuer) throw new VoiceGrantError(401, "UNAUTHORIZED");
      if (!ledger) throw new VoiceGrantError(503, "VOICE_GRANTS_UNAVAILABLE");
      const input = request.body as Record<string, unknown> | undefined;
      const operationId = request.headers["idempotency-key"];
      if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).length !== 1 ||
          typeof input.installationId !== "string" || typeof operationId !== "string") {
        throw new VoiceGrantError(400, "VALIDATION_ERROR");
      }
      const revocation = await ledger.revokeInstallation(actor, input.installationId, operationId, now());
      const providerVerified = await revoker.revoke(revocation.grants, revocation.operationId);
      return reply.code(providerVerified ? 200 : 202).send({
        contractVersion: "cop-voice-installation-revocation-v1", operationId: revocation.operationId,
        scope: "installation", status: providerVerified ? "revoked" : "revoking",
        joinDenied: true, providerVerified, accountDeleted: false
      });
    } catch (error) {
      const known = error instanceof VoiceGrantError ? error : new VoiceGrantError(503, "VOICE_GRANTS_UNAVAILABLE");
      return sendError(reply, known.status, known.code, "Hlasový přístup nyní nelze spravovat.",
        correlationIdFrom(request.headers["x-correlation-id"]));
    }
  });
}
