import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import {
  contributorIdDay, DRIVER_MEASUREMENT_CONSENT_VERSION, DRIVER_MEASUREMENT_MOBILE_VERSION,
  toSimBatch, validateMobileBatch
} from "../driver-measurement-contract.js";
import type { DriverMeasurementConsentStore } from "../driver-measurement-consent-store.js";
import { DriverMeasurementSourceError, type DriverMeasurementSource } from "../driver-measurement-source.js";
import { correlationIdFrom, sendError } from "../errors.js";
import { actorFromRequest, type AuthenticatedActor } from "../security.js";

const prefix = "/api/v1/driver-measurements/v1";
const grantSchema = z.strictObject({
  contractVersion: z.literal(DRIVER_MEASUREMENT_MOBILE_VERSION),
  version: z.literal(DRIVER_MEASUREMENT_CONSENT_VERSION),
  granted: z.literal(true)
});

export interface DriverMeasurementRoutesConfig {
  enabled: boolean;
  cleanupEnabled: boolean;
  pilotEnabled?: boolean;
  pilotSubjectIds?: string;
  oidcClientId: string;
  /** Separate, exact signed-azp allowlist for own-state read and revocation. */
  cleanupOidcClientIds?: string;
  oidcIssuer?: string;
  secret: string;
  store?: DriverMeasurementConsentStore;
  source?: DriverMeasurementSource;
  /** Actual configured global guard initialization, awaited before any normal
   * cleanup worker handoff. No readiness boolean or client-selected gate. */
  beforeCleanupWorkers?: () => Promise<void>;
  now: () => Date;
}

export function registerDriverMeasurementRoutes(app: FastifyInstance, config: DriverMeasurementRoutesConfig): void {
  const { enabled, cleanupEnabled, oidcClientId, secret, store, source, now } = config;
  const runtimeEnabled = enabled || cleanupEnabled;
  const oidcIssuer = config.oidcIssuer ?? process.env.COP_OIDC_ISSUER?.trim().replace(/\/$/u, "");
  const cleanupClients = parseCleanupClients(config.cleanupOidcClientIds);
  const pilotSubjects = parsePilotSubjects(config.pilotSubjectIds);
  const intakeAllowed = (subjectId: string): boolean => enabled
    && (!config.pilotEnabled || (pilotSubjects !== null && pilotSubjects.has(subjectId)));
  if (runtimeEnabled && (!store || !source || secret.length < 32)) {
    throw new Error("Driver measurement COP adapter requires a durable store, SIM connection and 32-character HMAC secret.");
  }
  let retryTimer: NodeJS.Timeout | undefined;
  let cleanupInFlight = false;
  let cleanupJob: Promise<void> | undefined;
  let cleanupCursor = 0;
  async function flush(): Promise<void> {
    if (!store?.withPendingDeletion || !source) return;
    const records = await store.pending();
    if (!records.length) return;
    let attempts = 0;
    for (let index = 0; index < records.length && attempts < 4; index += 1) {
      const record = records[(cleanupCursor + index) % records.length]!;
      for (const day of record.days) {
        if (attempts >= 4) break;
        attempts += 1;
        try {
          // A stale pending() snapshot grants no provider authority. The exact
          // consent store serializes this handoff with whole-account fencing.
          await store.withPendingDeletion(record.subjectId, day,
            () => source.delete(contributorIdDay(secret, record.subjectId, day), {
              subjectId: record.subjectId, contributorDay: day, actorSource: "consent_ledger"
            }));
        } catch { continue; }
      }
    }
    cleanupCursor = (cleanupCursor + 1) % records.length;
  }
  function scheduleCleanup(): void {
    if (cleanupInFlight || !runtimeEnabled) return;
    cleanupInFlight = true;
    cleanupJob = flush().catch(() => undefined).finally(() => { cleanupInFlight = false; cleanupJob = undefined; });
  }
  if (runtimeEnabled) {
    app.addHook("onReady", async () => {
      await store!.init(secret);
      await config.beforeCleanupWorkers?.();
      scheduleCleanup();
      retryTimer = setInterval(scheduleCleanup, 60_000);
      retryTimer.unref?.();
    });
    app.addHook("onClose", async () => {
      if (retryTimer) clearInterval(retryTimer);
      await cleanupJob;
      await store!.close();
    });
  }
  function actor(request: FastifyRequest, reply: FastifyReply, cleanupOnly = false): AuthenticatedActor | null {
    reply.header("Cache-Control", "no-store");
    const correlationId = correlationIdFrom(request.headers["x-correlation-id"]);
    if (!(cleanupOnly ? runtimeEnabled : enabled)) {
      sendError(reply, 503, "DRIVER_MEASUREMENTS_DISABLED", "Měření dopravy není zapnuto.", correlationId);
      return null;
    }
    if (request.headers.origin) {
      sendError(reply, 403, "DRIVER_MEASUREMENTS_NATIVE_ONLY", "Měření dopravy vyžaduje nativní aplikaci.", correlationId);
      return null;
    }
    if (cleanupOnly && !cleanupClients) {
      sendError(reply, 503, "DRIVER_MEASUREMENTS_CLEANUP_CLIENTS_NOT_CONFIGURED",
        "Odvolání měření dopravy nyní není připraveno.", correlationId);
      return null;
    }
    // Registered behind the verified bearer guard. Neither aud nor request data
    // may substitute for the pinned issuer and the token's signed azp.
    const principal = actorFromRequest(request);
    const clientId = principal?.authorizedParty;
    if (!principal || principal.authMode !== "oidc" || !oidcIssuer || principal.issuer !== oidcIssuer ||
        typeof clientId !== "string" || !(cleanupOnly ? cleanupClients!.has(clientId) : clientId === oidcClientId)) {
      sendError(reply, 403, "DRIVER_MEASUREMENTS_IDENTITY_REQUIRED", "Je nutné přihlášení uživatele.", correlationId);
      return null;
    }
    // Cohort membership comes only from the verified OIDC actor. Cleanup is
    // independent of intake and must remain available to former pilot users.
    if (!cleanupOnly && config.pilotEnabled) {
      if (!pilotSubjects?.size) {
        sendError(reply, 503, "DRIVER_MEASUREMENTS_PILOT_NOT_CONFIGURED",
          "Pilot měření dopravy není připraven.", correlationId);
        return null;
      }
      if (!pilotSubjects.has(principal.subjectId)) {
        sendError(reply, 403, "DRIVER_MEASUREMENTS_PILOT_NOT_ELIGIBLE",
          "Účet není zařazen do pilotu měření dopravy.", correlationId);
        return null;
      }
    }
    return principal;
  }
  function failure(request: FastifyRequest, reply: FastifyReply, error: unknown): FastifyReply {
    const sourceError = error instanceof DriverMeasurementSourceError ? error : undefined;
    const status = sourceError?.statusCode ?? 503;
    if (status === 429 && sourceError?.retryAfter && /^\d{1,5}$/.test(sourceError.retryAfter)) {
      reply.header("Retry-After", sourceError.retryAfter);
    }
    return sendError(reply, status, sourceError?.code ?? "DRIVER_MEASUREMENTS_UPSTREAM_ERROR",
      "Měření dopravy nyní nelze zpracovat.", correlationIdFrom(request.headers["x-correlation-id"]));
  }
  function requestError(error: FastifyError, request: FastifyRequest, reply: FastifyReply): FastifyReply {
    // Parser messages can quote raw request bytes. Never log or forward them.
    const status = error.statusCode === 413 ? 413 : [400, 415].includes(error.statusCode ?? 0) ? 400 : 503;
    return sendError(reply, status,
      status === 413 ? "DRIVER_MEASUREMENTS_BODY_TOO_LARGE" : "DRIVER_MEASUREMENTS_REQUEST_ERROR",
      status === 413 ? "Požadavek překračuje povolenou velikost." : "Požadavek měření nelze zpracovat.",
      correlationIdFrom(request.headers["x-correlation-id"]));
  }
  const consentOptions = { bodyLimit: 1024, errorHandler: requestError };
  app.get(`${prefix}/consent`, consentOptions, async (request, reply) => {
    const principal = actor(request, reply, true);
    if (!principal) return reply;
    const subjectId = principal.subjectId;
    try {
      const consent = await store!.get(subjectId);
      return reply.send({ contractVersion: DRIVER_MEASUREMENT_MOBILE_VERSION,
        granted: !!consent.grantedAt && !consent.revokedAt,
        grantedAt: consent.revokedAt ? null : consent.grantedAt,
        pendingDeletion: consent.pendingDays.length > 0,
        canGrant: principal.authorizedParty === oidcClientId && intakeAllowed(subjectId) && consent.pendingDays.length === 0
          && consent.lastRevokedDay !== now().toISOString().slice(0, 10) });
    } catch (error) { return failure(request, reply, error); }
  });
  app.post(`${prefix}/consent`, consentOptions, async (request, reply) => {
    const principal = actor(request, reply);
    if (!principal) return reply;
    const subjectId = principal.subjectId;
    if (!grantSchema.safeParse(request.body).success) {
      return sendError(reply, 400, "DRIVER_MEASUREMENTS_INVALID_CONSENT", "Neplatné potvrzení souhlasu.",
        correlationIdFrom(request.headers["x-correlation-id"]));
    }
    try {
      const consent = await store!.grant(subjectId, now(), { issuer: principal.issuer!, subjectId });
      if (!consent) return sendError(reply, 409, "DRIVER_MEASUREMENTS_REGRANT_BLOCKED",
        "Opětovný souhlas je možný až po dokončení smazání a v dalším UTC dni.",
        correlationIdFrom(request.headers["x-correlation-id"]));
      return reply.send({ contractVersion: DRIVER_MEASUREMENT_MOBILE_VERSION,
        version: DRIVER_MEASUREMENT_CONSENT_VERSION, grantedAt: consent.grantedAt });
    } catch (error) { return failure(request, reply, error); }
  });
  app.delete(`${prefix}/consent`, consentOptions, async (request, reply) => {
    const principal = actor(request, reply, true);
    if (!principal) return reply;
    const subjectId = principal.subjectId;
    if (request.body !== undefined) return sendError(reply, 400, "DRIVER_MEASUREMENTS_INVALID_REVOKE",
      "Odvolání souhlasu nemá tělo.", correlationIdFrom(request.headers["x-correlation-id"]));
    try {
      await store!.revoke(subjectId, now(), { issuer: principal.issuer!, subjectId });
      const consent = await store!.get(subjectId);
      scheduleCleanup();
      return reply.code(consent.pendingDays.length ? 202 : 200).send({
        contractVersion: DRIVER_MEASUREMENT_MOBILE_VERSION, granted: false,
        pendingDeletion: consent.pendingDays.length > 0
      });
    } catch (error) { return failure(request, reply, error); }
  });
  app.post(`${prefix}/batches`, {
    bodyLimit: 1_048_576,
    errorHandler: requestError
  }, async (request, reply) => {
    const principal = actor(request, reply);
    if (!principal) return reply;
    const subjectId = principal.subjectId;
    try {
      const result = await store!.withActive(subjectId, async (consent) => {
        const batch = validateMobileBatch(request.body, consent, now());
        if (!batch) return { invalid: true as const };
        const upstreamBatch = toSimBatch(batch, consent, subjectId, secret);
        if (Buffer.byteLength(JSON.stringify(upstreamBatch), "utf8") > 1_048_576) {
          throw new DriverMeasurementSourceError(413);
        }
        const receipt = await source!.send(upstreamBatch, { subjectId, contributorDay: batch.contributorDay, tokenIssuedAt: principal.tokenIssuedAt });
        return { invalid: false as const, receipt: {
          ...receipt, contractVersion: DRIVER_MEASUREMENT_MOBILE_VERSION, batchId: batch.batchId
        } };
      }, { issuer: principal.issuer!, subjectId });
      if (!result) return sendError(reply, 403, "DRIVER_MEASUREMENTS_CONSENT_REQUIRED",
        "Měření dopravy vyžaduje platný souhlas.", correlationIdFrom(request.headers["x-correlation-id"]));
      if (result.invalid) return sendError(reply, 400, "DRIVER_MEASUREMENTS_INVALID_BATCH",
        "Dávka měření nesplňuje mobilní kontrakt.", correlationIdFrom(request.headers["x-correlation-id"]));
      return reply.send(result.receipt);
    } catch (error) { return failure(request, reply, error); }
  });
}

function parseCleanupClients(value: string | undefined): Set<string> | null {
  const configured = value === undefined ? "csm-mobile" : value;
  if (!configured.trim() || configured.length > 8192) return null;
  const clients = configured.split(",").map(client => client.trim());
  if (clients.length > 100 || clients.some(client => !/^[A-Za-z0-9._:\-]{1,255}$/u.test(client))) return null;
  return new Set(clients);
}

function parsePilotSubjects(value: string | undefined): Set<string> | null {
  if (!value?.trim()) return new Set();
  if (value.length > 8192) return null;
  const subjects = value.split(",").map((subject) => subject.trim());
  // Malformed configuration disables all intake; never partially accept it.
  if (subjects.length > 100 || subjects.some((subject) => !/^[A-Za-z0-9._~:@/\-]{1,255}$/.test(subject))) return null;
  return new Set(subjects);
}
