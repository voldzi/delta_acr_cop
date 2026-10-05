import sharp from "sharp";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { correlationIdFrom, sendError } from "./errors.js";
import type { AuthenticatedActor } from "./security.js";
import { userAvatar, userAvatarRevision, type UserProfileRecord, type UserProfileStore } from "./user-profile-store.js";

export async function canonicalAvatar(value: unknown): Promise<string | null> {
  if (value === null) return null;
  if (typeof value !== "string" || value.length > 240030) throw new Error("INVALID_AVATAR");
  const match = /^data:image\/(png|jpeg);base64,([A-Za-z0-9+/]+={0,2})$/u.exec(value);
  if (!match || match[2]!.length % 4 !== 0) throw new Error("INVALID_AVATAR");
  const bytes = Buffer.from(match[2]!, "base64");
  if (!bytes.length || bytes.length > 180000 || bytes.toString("base64") !== match[2]) throw new Error("INVALID_AVATAR");
  const input = sharp(bytes, { limitInputPixels: 1048576, failOn: "warning", pages: 1 });
  const metadata = await input.metadata();
  if (metadata.format !== match[1] || !metadata.width || !metadata.height || metadata.width > 1024 || metadata.height > 1024 || (metadata.pages ?? 1) !== 1) throw new Error("INVALID_AVATAR");
  // Decode and re-encode: no EXIF, XMP, GPS, comments or user-supplied URLs survive.
  const output = await input.autoOrient().resize(512, 512, { fit: "inside", withoutEnlargement: true }).png().toBuffer();
  if (output.length > 180000) throw new Error("INVALID_AVATAR");
  return "data:image/png;base64," + output.toString("base64");
}

export function registerCOPAccountProfile(app: FastifyInstance, options: {
  store: UserProfileStore;
  requireActor(request: FastifyRequest, reply: FastifyReply): AuthenticatedActor | null;
  ready(): Promise<boolean>;
  degraded(error: unknown): void;
  now(): Date;
}) {
  function wire(actor: AuthenticatedActor, profile: UserProfileRecord | null) {
    return { contractVersion: "cop-account-profile-v1", subjectId: actor.subjectId, issuer: actor.issuer!,
      displayName: actor.displayName, email: actor.email ?? null, emailVerified: !!actor.email && actor.emailVerified === true,
      avatarDataUrl: userAvatar(profile), revision: userAvatarRevision(actor.subjectId, profile),
      updatedAt: profile?.updatedAt ?? null, serverTimestamp: options.now().toISOString() };
  }
  for (const method of ["GET", "PATCH"] as const) {
    app.route({ method, url: method === "GET" ? "/api/v1/me/profile" : "/api/v1/me/profile/avatar", bodyLimit: 245000,
      async handler(request, reply) {
        reply.header("Cache-Control", "no-store");
        const actor = options.requireActor(request, reply);
        if (!actor) return reply;
        const correlationId = correlationIdFrom(request.headers["x-correlation-id"]);
        const fail = (status: number, code: string, message: string) => sendError(reply, status, code, message, correlationId);
        if (actor.authMode !== "oidc" || !actor.issuer) return fail(401, "UNAUTHORIZED", "Je nutná ověřená relace COP.");
        if (!await options.ready() || !options.store.updateAvatar) return fail(503, "PROFILE_UNAVAILABLE", "Profil COP nyní není dostupný.");
        let avatar: string | null = null;
        let revision: string | undefined;
        if (method === "PATCH") {
          const header = request.headers["if-match"];
          if (header === undefined) return fail(428, "PRECONDITION_REQUIRED", "Nejprve načtěte aktuální profil.");
          if (typeof header !== "string" || !/^"[a-f0-9]{64}"$/u.test(header)) return fail(400, "VALIDATION_ERROR", "Neplatná revize profilu.");
          revision = header.slice(1, -1);
          const body = request.body;
          if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).length !== 1 || !Object.hasOwn(body, "avatarDataUrl")) return fail(400, "VALIDATION_ERROR", "Lze změnit pouze vlastní avatar.");
          try { avatar = await canonicalAvatar((body as { avatarDataUrl: unknown }).avatarDataUrl); }
          catch { return fail(400, "VALIDATION_ERROR", "Použijte malý platný obrázek PNG nebo JPEG."); }
        }
        try {
          const profile = method === "GET" ? await options.store.getProfile(actor.subjectId)
            : await options.store.updateAvatar!({ subjectId: actor.subjectId, username: actor.username, displayName: actor.displayName, ...(actor.email ? { email: actor.email } : {}) }, avatar, revision!);
          if (method === "PATCH" && !profile) return fail(412, "PROFILE_CHANGED", "Profil se změnil. Načtěte jej znovu a potvrďte změnu.");
          const result = wire(actor, profile);
          reply.header("ETag", '"' + result.revision + '"');
          return result;
        } catch (error) {
          options.degraded(error);
          return fail(503, "PROFILE_UNAVAILABLE", "Profil COP nyní není dostupný.");
        }
      }
    });
  }
}
