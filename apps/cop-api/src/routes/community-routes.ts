import { actorFromRequest } from "../security.js";
import { correlationIdFrom, sendError } from "../errors.js";
import type { FastifyInstance, RouteHandlerMethod } from "fastify";

export interface CommunityRouteHandlers {
  completeReportAttachment: RouteHandlerMethod;
  confirmReport: RouteHandlerMethod;
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
  leaveGroup: RouteHandlerMethod;
  listGroups: RouteHandlerMethod;
  removeGroupMember: RouteHandlerMethod;
  resolveReport: RouteHandlerMethod;
  listReports: RouteHandlerMethod;
  submitReport: RouteHandlerMethod;
  updateGroupMetadata: RouteHandlerMethod;
  updateReportAttachmentAccess: RouteHandlerMethod;
  updateReport: RouteHandlerMethod;
  uploadReportAttachment: RouteHandlerMethod;
  upsertGroupMember: RouteHandlerMethod;
  withdrawReport: RouteHandlerMethod;
}

export type CommunityGroupRouteHandlers = Pick<
  CommunityRouteHandlers,
  | "createGroup"
  | "deleteGroup"
  | "getGroup"
  | "joinGroup"
  | "leaveGroup"
  | "listGroups"
  | "removeGroupMember"
  | "updateGroupMetadata"
  | "upsertGroupMember"
>;

export type CommunityReportRouteHandlers = Pick<
  CommunityRouteHandlers,
  | "completeReportAttachment"
  | "confirmReport"
  | "createReport"
  | "createReportAttachment"
  | "deleteReport"
  | "getReport"
  | "getReportAttachmentContent"
  | "getReportAttachmentDerivativeContent"
  | "listReports"
  | "resolveReport"
  | "submitReport"
  | "updateReportAttachmentAccess"
  | "updateReport"
  | "uploadReportAttachment"
  | "withdrawReport"
>;

export function registerCommunityGroupRoutes(app: FastifyInstance, handlers: CommunityGroupRouteHandlers): void {
  app.get("/api/v1/community/groups", handlers.listGroups);
  app.post("/api/v1/community/groups", handlers.createGroup);
  app.get("/api/v1/community/groups/:groupId", handlers.getGroup);
  app.patch("/api/v1/community/groups/:groupId/metadata", handlers.updateGroupMetadata);
  app.delete("/api/v1/community/groups/:groupId", handlers.deleteGroup);
  app.post("/api/v1/community/groups/:groupId/join-request", handlers.joinGroup);
  app.post("/api/v1/community/groups/:groupId/members", handlers.upsertGroupMember);
  app.delete("/api/v1/community/groups/:groupId/members/me", handlers.leaveGroup);
  app.delete("/api/v1/community/groups/:groupId/members/:subjectId", handlers.removeGroupMember);
}

export function registerCommunityReportRoutes(app: FastifyInstance, handlers: CommunityReportRouteHandlers): void {
  app.get("/api/v1/community/reports", storeBoundary(handlers.listReports));
  app.post(
    "/api/v1/community/reports",
    {
      config: {
        rateLimit: {
          hook: "preHandler",
          max: 20,
          timeWindow: "1 minute",
          keyGenerator: (request) => `${request.ip}:${actorFromRequest(request)?.subjectId ?? "anonymous"}`
        }
      }
    },
    storeBoundary(handlers.createReport)
  );
  app.patch("/api/v1/community/reports/:reportId", storeBoundary(handlers.updateReport));
  app.get("/api/v1/community/reports/:reportId", storeBoundary(handlers.getReport));
  app.delete("/api/v1/community/reports/:reportId", storeBoundary(handlers.deleteReport));
  app.post(
    "/api/v1/community/reports/:reportId/submit",
    {
      config: {
        rateLimit: {
          hook: "preHandler",
          max: 30,
          timeWindow: "1 minute",
          keyGenerator: (request) => `${request.ip}:${actorFromRequest(request)?.subjectId ?? "anonymous"}`
        }
      }
    },
    storeBoundary(handlers.submitReport)
  );
  app.put(
    "/api/v1/community/reports/:reportId/confirmation",
    {
      config: {
        rateLimit: {
          hook: "preHandler",
          max: 60,
          timeWindow: "1 minute",
          keyGenerator: (request) => `${request.ip}:${actorFromRequest(request)?.subjectId ?? "anonymous"}`
        }
      }
    },
    storeBoundary(handlers.confirmReport)
  );
  app.post("/api/v1/community/reports/:reportId/resolve", storeBoundary(handlers.resolveReport));
  app.post("/api/v1/community/reports/:reportId/withdraw", storeBoundary(handlers.withdrawReport));
  app.post("/api/v1/community/reports/:reportId/attachments", storeBoundary(handlers.createReportAttachment));
  app.patch(
    "/api/v1/community/reports/:reportId/attachments/:attachmentId/access",
    handlers.updateReportAttachmentAccess
  );
  app.post(
    "/api/v1/community/reports/:reportId/attachments/:attachmentId/complete",
    storeBoundary(handlers.completeReportAttachment)
  );
  app.post(
    "/api/v1/community/reports/:reportId/attachments/:attachmentId/upload",
    storeBoundary(handlers.uploadReportAttachment)
  );
  app.get(
    "/api/v1/community/reports/:reportId/attachments/:attachmentId/content",
    storeBoundary(handlers.getReportAttachmentContent)
  );
  app.get(
    "/api/v1/community/reports/:reportId/attachments/:attachmentId/derivatives/:derivativeId/content",
    handlers.getReportAttachmentDerivativeContent
  );
}

export function registerCommunityRoutes(app: FastifyInstance, handlers: CommunityRouteHandlers): void {
  registerCommunityGroupRoutes(app, handlers);
  registerCommunityReportRoutes(app, handlers);
}

/** Durable errors must never acknowledge a mutation in the process-local fallback store. */
function storeBoundary(handler: RouteHandlerMethod): RouteHandlerMethod {
  return async function (request, reply) {
    try {
      return await handler.call(this, request, reply);
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "COMMUNITY_REPORT_STORE_UNAVAILABLE")
        return sendError(
          reply,
          503,
          "COMMUNITY_REPORT_STORE_UNAVAILABLE",
          "Community report storage is temporarily unavailable.",
          correlationIdFrom(request.headers["x-correlation-id"])
        );
      throw error;
    }
  };
}
