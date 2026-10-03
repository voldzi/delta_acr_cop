import type { FastifyInstance, FastifyReply, FastifyRequest, RouteHandlerMethod } from "fastify";
import { actorFromRequest } from "../security.js";
import { correlationIdFrom, sendError } from "../errors.js";

export interface RoutingRouteHandlers {
  alternatives: RouteHandlerMethod;
  isochrone: RouteHandlerMethod;
  nearestAccess: RouteHandlerMethod;
  profiles: RouteHandlerMethod;
  route: RouteHandlerMethod;
}

async function requireRoutingActor(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  // Global bearer/BFF authentication runs first. Never infer an actor from body
  // fields or accept a signed token without a usable subject for this facade.
  if (!actorFromRequest(request)) {
    sendError(reply, 401, "UNAUTHORIZED", "Routing requires an authenticated user identity.", correlationIdFrom(request.headers["x-correlation-id"]));
  }
}

export function registerRoutingRoutes(app: FastifyInstance, handlers: RoutingRouteHandlers): void {
  app.get("/api/v1/routing/profiles", { preHandler: requireRoutingActor }, handlers.profiles);
  app.post("/api/v1/routing/route", { preHandler: requireRoutingActor }, handlers.route);
  app.post("/api/v1/routing/alternatives", { preHandler: requireRoutingActor }, handlers.alternatives);
  app.post("/api/v1/routing/isochrone", { preHandler: requireRoutingActor }, handlers.isochrone);
  app.post("/api/v1/routing/nearest-access", { preHandler: requireRoutingActor }, handlers.nearestAccess);
}
