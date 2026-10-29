import { createHash } from "node:crypto";
import type { FastifyRequest } from "fastify";
import { verifiedOidcIdentityFromRequest } from "./security.js";

/** Service assertion for planning quotas/binding, never an access credential.
 * Call only after COP authentication. Client headers/body and decoded JWTs are
 * deliberately ignored. No identity or assertion belongs in logs.
 */
export function planningActorFromRequest(request: FastifyRequest): string | undefined {
  const identity = verifiedOidcIdentityFromRequest(request);
  if (!identity?.issuer || !identity.subjectId || identity.subjectId !== identity.subjectId.trim() ||
    identity.issuer.includes("\0") || identity.subjectId.includes("\0")) return undefined;
  return createHash("sha256")
    .update(`cop-planning-actor-v1\0${identity.issuer}\0${identity.subjectId}`, "utf8")
    .digest("hex");
}
