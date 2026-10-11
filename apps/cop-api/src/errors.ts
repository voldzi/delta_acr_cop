import type { FastifyReply, RouteShorthandOptions } from "fastify";
import type { ErrorResponse } from "./types.js";

export function correlationIdFrom(value: unknown): string {
  return typeof value === "string" && value.length > 0 ? value : crypto.randomUUID();
}

export function sendError(
  reply: FastifyReply,
  statusCode: number,
  code: string,
  message: string,
  correlationId: string,
  details?: Array<{ path: string; issue: string }>
): FastifyReply {
  const body: ErrorResponse = {
    error: {
      code,
      message,
      details,
      correlationId
    }
  };
  return reply.code(statusCode).send(body);
}

/** Public JSON endpoints must not inherit the large authenticated-media upload limit. */
export function requestBodyLimitOptions(bodyLimit: number): RouteShorthandOptions {
  return {
    bodyLimit,
    errorHandler(error, request, reply) {
      if (error.code === "FST_ERR_CTP_BODY_TOO_LARGE") {
        return sendError(reply, 413, "PAYLOAD_TOO_LARGE", "Request body exceeds the permitted size.",
          correlationIdFrom(request.headers["x-correlation-id"]));
      }
      return reply.send(error);
    }
  };
}
