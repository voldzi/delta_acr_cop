import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { correlationIdFrom, sendError } from "../errors.js";
import { actorFromRequest, type AuthenticatedActor } from "../security.js";
import { planningActorFromRequest } from "../routing-planning-actor.js";
import { createRoutingRequestContext } from "../routing-source.js";
import { PlanningOriginError, type PlanningOriginSource } from "../routing-planning-origin.js";
import { PlanningTransportError } from "../routing-planning-transport.js";

export function registerPlanningOriginRoutes(app: FastifyInstance, options: {
  source?: PlanningOriginSource; now: () => Date;
  assertActorAllowed?: (actor: AuthenticatedActor) => Promise<void>;
}): void {
  const requestError = (error: FastifyError, request: FastifyRequest, reply: FastifyReply) => {
    const status = error.statusCode === 413 ? 413 : [400, 415].includes(error.statusCode ?? 0) ? 400 : 503;
    reply.header("Cache-Control", "no-store");
    return sendError(reply, status, status === 413 ? "PLANNING_ORIGIN_BODY_TOO_LARGE" : "PLANNING_ORIGIN_REQUEST_ERROR",
      "Planning request could not be processed.", createRoutingRequestContext(correlationIdFrom(request.headers["x-correlation-id"])).correlationId);
  };
  for (const operation of ["candidates", "preview"] as const) {
    app.post(`/api/v1/routing/planning-origin/${operation}`, { bodyLimit: 32 * 1024, errorHandler: requestError }, async (request, reply) => {
      const correlationId = createRoutingRequestContext(correlationIdFrom(request.headers["x-correlation-id"])).correlationId;
      reply.header("Cache-Control", "no-store");
      const opaqueActor = planningActorFromRequest(request), actor = actorFromRequest(request);
      if (!opaqueActor || !actor || actor.authMode !== "oidc") {
        return sendError(reply, 401, "UNAUTHORIZED", "Planning requires a verified COP identity.", correlationId);
      }
      if (request.query && Object.keys(request.query as object).length) return sendError(reply, 400, "VALIDATION_ERROR", "Planning does not accept query parameters.", correlationId);
      if (!options.source) return sendError(reply, 503, "PLANNING_ORIGIN_UNAVAILABLE", "Planning service is unavailable.", correlationId);
      const assertCurrent = async () => {
        if (planningActorFromRequest(request) !== opaqueActor) throw new PlanningOriginError(401, "UNAUTHORIZED");
        await options.assertActorAllowed?.(actor);
      };
      try {
        await assertCurrent();
        return await options.source.request(operation, request.body, {
          actor: opaqueActor, correlationId
        }, options.now(), assertCurrent);
      } catch (error) {
        if (error instanceof PlanningOriginError) return sendError(reply, error.statusCode, error.code, "Planning request could not be verified.", correlationId);
        if (error instanceof PlanningTransportError) {
          if (error.retryAfter) reply.header("Retry-After", error.retryAfter);
          return sendError(reply, error.statusCode, error.code, "Planning service could not complete the request.", correlationId);
        }
        return sendError(reply, 503, "PLANNING_ORIGIN_UNAVAILABLE", "Planning service is unavailable.", correlationId);
      }
    });
  }
}
