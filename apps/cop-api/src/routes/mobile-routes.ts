import type { FastifyInstance, RouteHandlerMethod } from "fastify";

export interface MobileRouteHandlers {
  appleAppSiteAssociation: RouteHandlerMethod;
  bootstrap: RouteHandlerMethod;
  deviceRegister: RouteHandlerMethod;
  deviceRevoke: RouteHandlerMethod;
  devices: RouteHandlerMethod;
  meshAcks: RouteHandlerMethod;
  meshIngest: RouteHandlerMethod;
  offlineSnapshot: RouteHandlerMethod;
  pairFallback: RouteHandlerMethod;
  pairingClaim: RouteHandlerMethod;
  pairingConfirm: RouteHandlerMethod;
  pairingCreate: RouteHandlerMethod;
  pairingStatus: RouteHandlerMethod;
}

export function registerMobileRoutes(app: FastifyInstance, handlers: MobileRouteHandlers): void {
  app.get("/api/v1/mobile/bootstrap", handlers.bootstrap);
  app.get("/api/v1/mobile/offline-snapshot", handlers.offlineSnapshot);
  app.get("/.well-known/apple-app-site-association", handlers.appleAppSiteAssociation);
  app.get("/mobile/pair/:code", handlers.pairFallback);
  app.post("/api/v1/mobile/pairing/sessions", handlers.pairingCreate);
  app.get("/api/v1/mobile/pairing/sessions/:code", handlers.pairingStatus);
  app.post("/api/v1/mobile/pairing/sessions/:code/claim", handlers.pairingClaim);
  app.post("/api/v1/mobile/pairing/sessions/:code/confirm", handlers.pairingConfirm);
  app.get("/api/v1/mobile/devices", handlers.devices);
  app.post("/api/v1/mobile/devices", handlers.deviceRegister);
  app.delete("/api/v1/mobile/devices/:deviceId", handlers.deviceRevoke);
  app.post("/api/v1/mobile/mesh/ingest", handlers.meshIngest);
  app.get("/api/v1/mobile/mesh/acks", handlers.meshAcks);
}
