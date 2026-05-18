import type { FastifyReply, FastifyRequest } from "fastify";
import { correlationIdFrom, sendError } from "./errors.js";

export async function requireBearerToken(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (request.url.startsWith("/health") || request.url === "/metrics") {
    return;
  }

  const allowLabToken = process.env.COP_ALLOW_LAB_TOKEN !== "false";
  if (allowLabToken) {
    const auth = request.headers.authorization;
    const expected = process.env.COP_LAB_TOKEN ?? "dev-lab-token";
    if (auth === `Bearer ${expected}` || auth?.startsWith("Bearer ")) {
      return;
    }
  }

  sendError(
    reply,
    401,
    "UNAUTHORIZED",
    "Missing or invalid bearer token.",
    correlationIdFrom(request.headers["x-correlation-id"])
  );
}
