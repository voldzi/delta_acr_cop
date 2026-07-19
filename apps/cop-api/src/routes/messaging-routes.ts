import type { FastifyInstance, RouteHandlerMethod } from "fastify";

export interface MessagingRouteHandlers {
  addConversationMembers: RouteHandlerMethod;
  bindMatrixRoom: RouteHandlerMethod;
  bootstrap: RouteHandlerMethod;
  conversationDetail: RouteHandlerMethod;
  conversations: RouteHandlerMethod;
  createConversation: RouteHandlerMethod;
  deleteWebPushDevice: RouteHandlerMethod;
  e2eeResetAuth: RouteHandlerMethod;
  matrixPushGateway: RouteHandlerMethod;
  registerWebPushDevice: RouteHandlerMethod;
  resolveConversation: RouteHandlerMethod;
  resolveMatrixIdentities: RouteHandlerMethod;
  startVoiceCall: RouteHandlerMethod;
  status: RouteHandlerMethod;
  transitionVoiceCall: RouteHandlerMethod;
  voiceCallDetail: RouteHandlerMethod;
  voiceCalls: RouteHandlerMethod;
  webPushConfig: RouteHandlerMethod;
}

export function registerMessagingRoutes(app: FastifyInstance, handlers: MessagingRouteHandlers): void {
  app.post("/_matrix/push/v1/notify", handlers.matrixPushGateway);
  app.get("/api/v1/messaging/status", handlers.status);
  app.get("/api/v1/push/web/config", handlers.webPushConfig);
  app.post("/api/v1/push/web/devices", handlers.registerWebPushDevice);
  app.delete("/api/v1/push/web/devices/:deviceId", handlers.deleteWebPushDevice);
  app.post("/api/v1/messaging/bootstrap", handlers.bootstrap);
  app.post(
    "/api/v1/messaging/e2ee/reset-auth",
    { config: { rateLimit: { max: 3, timeWindow: "1 minute" } } },
    handlers.e2eeResetAuth
  );
  app.post(
    "/api/v1/messaging/calls",
    { config: { rateLimit: { max: 8, timeWindow: "1 minute" } } },
    handlers.startVoiceCall
  );
  app.get("/api/v1/messaging/calls", handlers.voiceCalls);
  app.get("/api/v1/messaging/calls/:callId", handlers.voiceCallDetail);
  app.post(
    "/api/v1/messaging/calls/:callId/actions",
    { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } },
    handlers.transitionVoiceCall
  );
  app.get("/api/v1/messaging/conversations", handlers.conversations);
  app.get("/api/v1/messaging/conversations/resolve", handlers.resolveConversation);
  app.get("/api/v1/messaging/conversations/:conversationId", handlers.conversationDetail);
  app.post("/api/v1/messaging/conversations", handlers.createConversation);
  app.post("/api/v1/messaging/matrix/identities/resolve", handlers.resolveMatrixIdentities);
  app.post("/api/v1/messaging/conversations/:conversationId/members", handlers.addConversationMembers);
  app.post("/api/v1/messaging/conversations/:conversationId/matrix-room", handlers.bindMatrixRoom);
}
