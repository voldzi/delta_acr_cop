import type { FastifyInstance, RouteHandlerMethod } from "fastify";

export interface RadioRouteHandlers {
  createProfile: RouteHandlerMethod;
  linkCheck: RouteHandlerMethod;
  listProfiles: RouteHandlerMethod;
  mobileTowerViewshed: RouteHandlerMethod;
  radioCoverage: RouteHandlerMethod;
  siteSearch: RouteHandlerMethod;
}

export function registerRadioRoutes(app: FastifyInstance, handlers: RadioRouteHandlers): void {
  app.get("/api/v1/mobile-coverage/towers/:towerId/viewshed", handlers.mobileTowerViewshed);
  app.get("/api/v1/radio/profiles", handlers.listProfiles);
  app.post("/api/v1/radio/profiles", handlers.createProfile);
  app.post("/api/v1/radio/coverage", handlers.radioCoverage);
  app.post("/api/v1/radio/link-check", handlers.linkCheck);
  app.post("/api/v1/radio/site-search", handlers.siteSearch);
}
