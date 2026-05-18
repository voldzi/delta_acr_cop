import type { FastifyReply } from "fastify";
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
