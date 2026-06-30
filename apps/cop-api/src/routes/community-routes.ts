import type { FastifyInstance, RouteHandlerMethod } from "fastify";

export interface CommunityRouteHandlers {
  completeReportAttachment: RouteHandlerMethod;
  createGroup: RouteHandlerMethod;
  createReport: RouteHandlerMethod;
  createReportAttachment: RouteHandlerMethod;
  deleteGroup: RouteHandlerMethod;
  deleteReport: RouteHandlerMethod;
  getGroup: RouteHandlerMethod;
  getReport: RouteHandlerMethod;
  getReportAttachmentContent: RouteHandlerMethod;
  getReportAttachmentDerivativeContent: RouteHandlerMethod;
  joinGroup: RouteHandlerMethod;
  listGroups: RouteHandlerMethod;
  listReports: RouteHandlerMethod;
  submitReport: RouteHandlerMethod;
  updateGroupMetadata: RouteHandlerMethod;
  updateReport: RouteHandlerMethod;
  uploadReportAttachment: RouteHandlerMethod;
  upsertGroupMember: RouteHandlerMethod;
}

export type CommunityGroupRouteHandlers = Pick<
  CommunityRouteHandlers,
  | "createGroup"
  | "deleteGroup"
  | "getGroup"
  | "joinGroup"
  | "listGroups"
  | "updateGroupMetadata"
  | "upsertGroupMember"
>;

export type CommunityReportRouteHandlers = Pick<
  CommunityRouteHandlers,
  | "completeReportAttachment"
  | "createReport"
  | "createReportAttachment"
  | "deleteReport"
  | "getReport"
  | "getReportAttachmentContent"
  | "getReportAttachmentDerivativeContent"
  | "listReports"
  | "submitReport"
  | "updateReport"
  | "uploadReportAttachment"
>;

export function registerCommunityGroupRoutes(app: FastifyInstance, handlers: CommunityGroupRouteHandlers): void {
  app.get("/api/v1/community/groups", handlers.listGroups);
  app.post("/api/v1/community/groups", handlers.createGroup);
  app.get("/api/v1/community/groups/:groupId", handlers.getGroup);
  app.patch("/api/v1/community/groups/:groupId/metadata", handlers.updateGroupMetadata);
  app.delete("/api/v1/community/groups/:groupId", handlers.deleteGroup);
  app.post("/api/v1/community/groups/:groupId/join-request", handlers.joinGroup);
  app.post("/api/v1/community/groups/:groupId/members", handlers.upsertGroupMember);
}

export function registerCommunityReportRoutes(app: FastifyInstance, handlers: CommunityReportRouteHandlers): void {
  app.get("/api/v1/community/reports", handlers.listReports);
  app.post("/api/v1/community/reports", handlers.createReport);
  app.patch("/api/v1/community/reports/:reportId", handlers.updateReport);
  app.get("/api/v1/community/reports/:reportId", handlers.getReport);
  app.delete("/api/v1/community/reports/:reportId", handlers.deleteReport);
  app.post("/api/v1/community/reports/:reportId/submit", handlers.submitReport);
  app.post("/api/v1/community/reports/:reportId/attachments", handlers.createReportAttachment);
  app.post("/api/v1/community/reports/:reportId/attachments/:attachmentId/complete", handlers.completeReportAttachment);
  app.post("/api/v1/community/reports/:reportId/attachments/:attachmentId/upload", handlers.uploadReportAttachment);
  app.get("/api/v1/community/reports/:reportId/attachments/:attachmentId/content", handlers.getReportAttachmentContent);
  app.get(
    "/api/v1/community/reports/:reportId/attachments/:attachmentId/derivatives/:derivativeId/content",
    handlers.getReportAttachmentDerivativeContent
  );
}

export function registerCommunityRoutes(app: FastifyInstance, handlers: CommunityRouteHandlers): void {
  registerCommunityGroupRoutes(app, handlers);
  registerCommunityReportRoutes(app, handlers);
}
