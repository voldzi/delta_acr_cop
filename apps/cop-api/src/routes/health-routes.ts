import type { FastifyInstance, RouteHandlerMethod } from "fastify";

export interface HealthRouteHandlers {
  dependencies: RouteHandlerMethod;
  live: RouteHandlerMethod;
  metrics: RouteHandlerMethod;
  ready: RouteHandlerMethod;
}

export function registerHealthRoutes(app: FastifyInstance, handlers: HealthRouteHandlers): void {
  app.get("/health/live", handlers.live);
  app.get("/health/ready", handlers.ready);
  app.get("/health/dependencies", handlers.dependencies);
  app.get("/metrics", handlers.metrics);
}
