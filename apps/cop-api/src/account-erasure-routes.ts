import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { AccountErasureError, type AccountErasureService } from "./account-erasure.js";
import { actorFromRequest } from "./security.js";
import { correlationIdFrom, sendError } from "./errors.js";

const path = "/api/v1/me/account-deletion";
function failure(request: FastifyRequest, reply: FastifyReply, error: unknown) {
  const known = error instanceof AccountErasureError ? error : new AccountErasureError(503, "ERASURE_UNAVAILABLE");
  return sendError(reply, known.status, known.code, "Odstranění účtu COP nyní nelze dokončit.",
    correlationIdFrom(request.headers["x-correlation-id"]));
}

/** Register after the bearer signature guard. Receipt recovery is an explicit fence exception. */
export function registerAccountErasureRoutes(app: FastifyInstance, service?: AccountErasureService) {
  app.addHook("onRequest", async (request, reply) => {
    const requestPath = request.url.split("?")[0]!;
    if (requestPath.startsWith("/health") || requestPath === "/metrics") return;
    if (!service || request.method === "OPTIONS" || requestPath === path || requestPath.startsWith(path + "/")) return;
    // The BFF endpoints have a separate verified token guard at creation/refresh.
    if (requestPath.startsWith("/api/v1/auth/")) return;
    const actor = actorFromRequest(request);
    if (actor?.authMode !== "oidc") return;
    try { await service.assertAllowed(actor); } catch (error) { return failure(request, reply, error); }
  });
  app.get(path + "/capabilities", async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    const actor = actorFromRequest(request);
    if (actor?.authMode !== "oidc") return failure(request, reply, new AccountErasureError(401, "UNAUTHORIZED"));
    return service?.capabilities() ?? { contractVersion: "cop-account-erasure-v1", accountDeletion: false, unavailableReason: "not_enabled" };
  });
  app.get(path + "/:operationId", async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    try {
      const actor = actorFromRequest(request);
      if (actor?.authMode !== "oidc") throw new AccountErasureError(401, "UNAUTHORIZED");
      if (!service) throw new AccountErasureError(503, "ERASURE_NOT_READY");
      return await service.read(actor, (request.params as { operationId: string }).operationId);
    } catch (error) { return failure(request, reply, error); }
  });
  app.post(path, { bodyLimit: 1024, config: { rateLimit: { max: 5, timeWindow: "1 minute" } } }, async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    try {
      const actor = actorFromRequest(request);
      if (actor?.authMode !== "oidc") throw new AccountErasureError(401, "UNAUTHORIZED");
      if (!service) throw new AccountErasureError(503, "ERASURE_NOT_READY");
      const operationId = request.headers["idempotency-key"];
      if (typeof operationId !== "string") throw new AccountErasureError(400, "VALIDATION_ERROR");
      const receipt = await service.request(actor, operationId, request.body);
      return reply.code(receipt.accountDeleted ? 200 : 202).send(receipt);
    } catch (error) { return failure(request, reply, error); }
  });
}
