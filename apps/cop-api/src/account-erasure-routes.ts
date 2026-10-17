import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { AccountErasureError, type AccountErasureService } from "./account-erasure.js";
import { actorFromRequest } from "./security.js";
import { correlationIdFrom, sendError } from "./errors.js";
import { ERASURE_RECEIPT_COOKIE, ERASURE_RECEIPT_HEADER, erasureCapabilityFrom, isAccountErasureReceiptRead } from "./account-erasure-transport.js";

const path = "/api/v1/me/account-deletion";
function failure(request: FastifyRequest, reply: FastifyReply, error: unknown) {
  const known = error instanceof AccountErasureError ? error : new AccountErasureError(503, "ERASURE_UNAVAILABLE");
  return sendError(reply, known.status, known.code, "Odstranění účtu COP nyní nelze dokončit.",
    correlationIdFrom(request.headers["x-correlation-id"]));
}

/** Register after the bearer signature guard. Receipt recovery is an explicit fence exception. */
export function registerAccountErasureRoutes(app: FastifyInstance, service?: AccountErasureService) {
  let checkOwnerReadinessRateLimit: ReturnType<FastifyInstance["createRateLimit"]> | undefined;
  app.get(path + "/receipts/:operationId", { exposeHeadRoute: false }, async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    try {
      if (!isAccountErasureReceiptRead(request)) throw new AccountErasureError(400, "VALIDATION_ERROR");
      if (!service) throw new AccountErasureError(503, "ERASURE_NOT_READY");
      return await service.readWithCapability((request.params as { operationId: string }).operationId, erasureCapabilityFrom(request));
    } catch (error) { return failure(request, reply, error); }
  });
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
    const query = request.query as Record<string, unknown>;
    if (Object.keys(query).some(key => key !== "includeOwnerReadiness") ||
      (Object.hasOwn(query, "includeOwnerReadiness") && query.includeOwnerReadiness !== "true"))
      return failure(request, reply, new AccountErasureError(400, "VALIDATION_ERROR"));
    if (query.includeOwnerReadiness === "true") {
      checkOwnerReadinessRateLimit ??= app.createRateLimit({ max: 5, timeWindow: "1 minute" });
      const limit = await checkOwnerReadinessRateLimit(request);
      if (!limit.isAllowed && limit.isExceeded) {
        reply.header("Retry-After", limit.ttlInSeconds);
        return failure(request, reply, new AccountErasureError(429, "RATE_LIMIT_EXCEEDED"));
      }
      const capabilities = service?.options.accepted
        ? await service.capabilities()
        : service ? { contractVersion: service.contractVersion, accountDeletion: false, unavailableReason: "not_accepted" }
          : { contractVersion: "cop-account-erasure-v1", accountDeletion: false, unavailableReason: "not_enabled" };
      const ownerReadiness = service ? await service.ownerReadiness() : {
        contractVersion: "cop-account-erasure-owner-readiness-v1", ready: false, checkedAt: new Date().toISOString(), unavailableReason: "required_adapters_missing"
      };
      return { ...capabilities, ownerReadiness };
    }
    return service?.capabilities() ?? { contractVersion: "cop-account-erasure-v1", accountDeletion: false, unavailableReason: "not_enabled" };
  });
  app.post(path + "/preflight", { bodyLimit: 1024, config: { rateLimit: { max: 5, timeWindow: "1 minute" } } }, async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    try {
      const actor = actorFromRequest(request), operation = request.headers["idempotency-key"];
      if (actor?.authMode !== "oidc") throw new AccountErasureError(401, "UNAUTHORIZED");
      if (!service) throw new AccountErasureError(503, "ERASURE_NOT_READY");
      if (typeof operation !== "string" || !request.body || typeof request.body !== "object" || Array.isArray(request.body) || Object.keys(request.body).length) throw new AccountErasureError(400, "VALIDATION_ERROR");
      const result = await service.preflight(actor, operation);
      if (result.capability) {
        reply.header(ERASURE_RECEIPT_HEADER, result.capability);
        const existing = reply.getHeader("Set-Cookie");
        const cookies = Array.isArray(existing) ? existing : existing ? [String(existing)] : [];
        reply.header("Set-Cookie", [...cookies, ERASURE_RECEIPT_COOKIE + "=" + result.capability + "; Path=" + path + "; Max-Age=2592000; Secure; HttpOnly; SameSite=Strict"]);
      }
      return result.response;
    } catch (error) { return failure(request, reply, error); }
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
      const planId = request.headers["x-cop-erasure-plan"];
      const receipt = await service.request(actor, operationId, request.body,
        typeof planId === "string" ? { planId, capability: erasureCapabilityFrom(request) } : undefined);
      return reply.code(receipt.accountDeleted ? 200 : 202).send(receipt);
    } catch (error) { return failure(request, reply, error); }
  });
}
