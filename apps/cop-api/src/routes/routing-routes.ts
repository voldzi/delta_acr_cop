import type { FastifyInstance, RouteHandlerMethod } from "fastify";

export interface RoutingRouteHandlers {
  alternatives: RouteHandlerMethod;
  isochrone: RouteHandlerMethod;
  nearestAccess: RouteHandlerMethod;
  profiles: RouteHandlerMethod;
  route: RouteHandlerMethod;
}

export function registerRoutingRoutes(app: FastifyInstance, handlers: RoutingRouteHandlers): void {
  app.get("/api/v1/routing/profiles", handlers.profiles);
  app.post("/api/v1/routing/route", handlers.route);
  app.post("/api/v1/routing/alternatives", handlers.alternatives);
  app.post("/api/v1/routing/isochrone", handlers.isochrone);
  app.post("/api/v1/routing/nearest-access", handlers.nearestAccess);
}
