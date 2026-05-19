import cors from "@fastify/cors";
import sensible from "@fastify/sensible";
import websocket from "@fastify/websocket";
import { AiGateway } from "@cop/ai-gateway";
import { createCopObjectFromEvent, type CanonicalEventEnvelope, type ObservedObject, type SourceSystem } from "@cop/canonical-model";
import { ContractValidators, formatValidationErrors } from "@cop/ingest-contracts";
import { resolveSymbolFromRequest } from "@cop/nato-symbol-renderer";
import { defaultSystemSubject, evaluateReadPolicy } from "@cop/policy-engine";
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import { createHash } from "node:crypto";
import { buildCopAlerts, type CopAlert } from "./alerts.js";
import { correlationIdFrom, sendError } from "./errors.js";
import { CopStreamBroadcaster, type CopStreamMessage } from "./cop-stream.js";
import { buildConflictEvidenceIndex, withConflictEvidence, type ObjectConflictEvidence } from "./conflict-evidence.js";
import { withEventProvenance } from "./provenance.js";
import { actorFromRequest, requireBearerToken, type AuthenticatedActor } from "./security.js";
import { buildSourceHealthItems } from "./source-health.js";
import { appendAudit, createInitialState } from "./state.js";
import { createTrackHistoryStoreFromEnv, type TrackHistoryStore } from "./track-history-store.js";
import { appendTrackHistory, parseTrackHistoryQuery, queryTrackHistory, type TrackHistoryQuery } from "./temporal-history.js";
import { createTrackLifecycleConfig, selectCurrentTracks, type TrackLifecycleConfig } from "./track-lifecycle.js";
import type { AlertAcknowledgement, CopState, TrackHistoryPoint } from "./types.js";
import {
  createUserProfileStoreFromEnv,
  InMemoryUserProfileStore,
  type UserAlertPreferences,
  type UserProfileRecord,
  type UserProfileStore
} from "./user-profile-store.js";

export interface BuildServerOptions {
  state?: CopState;
  logger?: boolean;
  now?: () => Date;
  trackHistoryStore?: TrackHistoryStore;
  trackLifecycle?: TrackLifecycleConfig;
  streamBroadcaster?: CopStreamBroadcaster;
  userProfileStore?: UserProfileStore;
}

type DependencyStatus = "disabled" | "degraded" | "ok";

export function buildServer(options: BuildServerOptions = {}): FastifyInstance {
  const app = Fastify({
    logger: options.logger ?? false
  });
  const state = options.state ?? createInitialState();
  const validators = new ContractValidators();
  const aiGateway = new AiGateway();
  const now = options.now ?? (() => new Date());
  const trackLifecycle = options.trackLifecycle ?? createTrackLifecycleConfig();
  const trackHistoryStore = options.trackHistoryStore ?? createTrackHistoryStoreFromEnv();
  const streamBroadcaster = options.streamBroadcaster ?? createStreamBroadcasterFromEnv();
  const userProfileStore = options.userProfileStore ?? createUserProfileStoreFromEnv();
  const userProfileFallbackStore = new InMemoryUserProfileStore("memory-fallback");
  let trackHistoryStoreStatus: DependencyStatus = trackHistoryStore ? "degraded" : "disabled";
  let trackHistoryStoreDetail = trackHistoryStore ? `${trackHistoryStore.name}: initializing` : "in-memory only";
  let userProfileStoreStatus: DependencyStatus = "degraded";
  let userProfileStoreDetail = `${userProfileStore.name}: initializing`;
  let restoredCurrentTrackCount = 0;

  app.decorate("copState", state);
  void app.register(cors, { origin: true });
  void app.register(sensible);
  void app.register(websocket);
  app.addHook("preHandler", requireBearerToken);
  app.addHook("onReady", async () => {
    await initializeUserProfileStore();
    if (!trackHistoryStore) {
      return;
    }
    try {
      await trackHistoryStore.init();
      restoredCurrentTrackCount = await restoreCurrentState();
      trackHistoryStoreStatus = "ok";
      trackHistoryStoreDetail = `${trackHistoryStore.name}: ready; restored ${restoredCurrentTrackCount} current tracks`;
    } catch (error) {
      trackHistoryStoreStatus = "degraded";
      trackHistoryStoreDetail = `${trackHistoryStore.name}: ${errorMessage(error)}`;
      app.log.error({ error }, "Track history store initialization failed; using in-memory fallback.");
    }
  });
  app.addHook("onClose", async () => {
    await trackHistoryStore?.close();
    await userProfileStore.close();
    await userProfileFallbackStore.close();
  });

  app.get("/health/live", async () => ({
    status: "ok",
    timestamp: new Date().toISOString()
  }));

  app.get("/health/ready", async () => ({
    status: "ok",
    timestamp: new Date().toISOString()
  }));

  app.get("/health/dependencies", async () => ({
    status: "ok",
    dependencies: [
      { name: "source-registry", status: "ok" },
      { name: "in-memory-cop-state", status: "ok" },
      { name: "track-history-store", status: trackHistoryStoreStatus, detail: trackHistoryStoreDependencyDetail() },
      { name: "user-profile-store", status: userProfileStoreStatus, detail: userProfileStoreDependencyDetail() },
      { name: "ai-gateway", status: "degraded", detail: "mock provider only" }
    ]
  }));

  app.get("/metrics", async (_request, reply) => {
    const currentObjects = selectCurrentTracks(state.objects.values(), now(), trackLifecycle);
    const trackHistoryPointCount = await countTrackHistoryPoints();
    const persistedCurrentTrackCount = await countPersistedCurrentTracks();
    const streamMetrics = streamBroadcaster.metrics;
    const lines = [
      "# HELP cop_sources_total Registered COP source systems.",
      "# TYPE cop_sources_total gauge",
      `cop_sources_total ${state.sources.size}`,
      "# HELP cop_events_total Accepted ingest events.",
      "# TYPE cop_events_total counter",
      `cop_events_total ${state.events.size}`,
      "# HELP cop_objects_total Current non-expired COP objects.",
      "# TYPE cop_objects_total gauge",
      `cop_objects_total ${currentObjects.length}`,
      "# HELP cop_current_tracks_persisted_total Persisted current COP track snapshots.",
      "# TYPE cop_current_tracks_persisted_total gauge",
      `cop_current_tracks_persisted_total ${persistedCurrentTrackCount}`,
      "# HELP cop_track_history_points_total Retained temporal track history points.",
      "# TYPE cop_track_history_points_total gauge",
      `cop_track_history_points_total ${trackHistoryPointCount}`,
      "# HELP cop_stream_clients_total Connected COP live stream clients.",
      "# TYPE cop_stream_clients_total gauge",
      `cop_stream_clients_total ${streamMetrics.clientCount}`,
      "# HELP cop_stream_messages_total COP live stream messages created by type.",
      "# TYPE cop_stream_messages_total counter",
      `cop_stream_messages_total{type="snapshot"} ${streamMetrics.snapshotMessagesTotal}`,
      `cop_stream_messages_total{type="delta"} ${streamMetrics.deltaMessagesTotal}`,
      `cop_stream_messages_total{type="heartbeat"} ${streamMetrics.heartbeatMessagesTotal}`,
      `cop_stream_messages_total{type="backpressure"} ${streamMetrics.backpressureMessagesTotal}`,
      `cop_stream_messages_total{type="reconnect_required"} ${streamMetrics.reconnectRequiredMessagesTotal}`,
      "# HELP cop_stream_write_errors_total COP live stream write errors.",
      "# TYPE cop_stream_write_errors_total counter",
      `cop_stream_write_errors_total ${streamMetrics.writeErrorsTotal}`,
      "# HELP cop_stream_backpressure_active Whether COP stream backpressure is currently active.",
      "# TYPE cop_stream_backpressure_active gauge",
      `cop_stream_backpressure_active ${streamMetrics.backpressureActive ? 1 : 0}`,
      "# HELP cop_stream_backpressure_client_threshold Client threshold for stream backpressure.",
      "# TYPE cop_stream_backpressure_client_threshold gauge",
      `cop_stream_backpressure_client_threshold ${streamMetrics.backpressureClientThreshold}`,
      "# HELP cop_stream_last_message_timestamp_seconds Last COP stream message timestamp by type.",
      "# TYPE cop_stream_last_message_timestamp_seconds gauge",
      `cop_stream_last_message_timestamp_seconds{type="snapshot"} ${timestampSeconds(streamMetrics.lastSnapshotAt)}`,
      `cop_stream_last_message_timestamp_seconds{type="delta"} ${timestampSeconds(streamMetrics.lastDeltaAt)}`,
      `cop_stream_last_message_timestamp_seconds{type="heartbeat"} ${timestampSeconds(streamMetrics.lastHeartbeatAt)}`,
      `cop_stream_last_message_timestamp_seconds{type="backpressure"} ${timestampSeconds(streamMetrics.lastBackpressureAt)}`,
      `cop_stream_last_message_timestamp_seconds{type="write_error"} ${timestampSeconds(streamMetrics.lastWriteErrorAt)}`
    ];
    return reply.type("text/plain").send(`${lines.join("\n")}\n`);
  });

  async function initializeUserProfileStore(): Promise<void> {
    try {
      await userProfileStore.init();
      userProfileStoreStatus = "ok";
      userProfileStoreDetail = `${userProfileStore.name}: ready`;
    } catch (error) {
      userProfileStoreStatus = "degraded";
      userProfileStoreDetail = `${userProfileStore.name}: ${errorMessage(error)}`;
      await userProfileFallbackStore.init();
      app.log.error({ error }, "User profile store initialization failed; using in-memory fallback.");
    }
  }

  async function countTrackHistoryPoints(): Promise<number> {
    if (trackHistoryStore && trackHistoryStoreStatus === "ok") {
      try {
        return await trackHistoryStore.count();
      } catch (error) {
        markTrackHistoryStoreDegraded(error);
      }
    }
    return Array.from(state.trackHistory.values()).reduce((sum, points) => sum + points.length, 0);
  }

  async function countPersistedCurrentTracks(): Promise<number> {
    if (trackHistoryStore && trackHistoryStoreStatus === "ok") {
      try {
        return await trackHistoryStore.countCurrent();
      } catch (error) {
        markTrackHistoryStoreDegraded(error);
      }
    }
    return state.objects.size;
  }

  async function restoreCurrentState(): Promise<number> {
    if (!trackHistoryStore) {
      return 0;
    }
    const objects = await trackHistoryStore.loadCurrent();
    for (const object of objects) {
      state.objects.set(object.objectId, object);
    }
    return objects.length;
  }

  function markTrackHistoryStoreDegraded(error: unknown): void {
    if (!trackHistoryStore) {
      return;
    }
    trackHistoryStoreStatus = "degraded";
    trackHistoryStoreDetail = `${trackHistoryStore.name}: ${errorMessage(error)}`;
    app.log.error({ error }, "Track history store failed; using in-memory fallback.");
  }

  function trackHistoryStoreDependencyDetail(): string {
    const diagnostics = trackHistoryStore?.diagnostics?.();
    return diagnostics ? `${trackHistoryStoreDetail}; ${diagnostics}` : trackHistoryStoreDetail;
  }

  function markUserProfileStoreDegraded(error: unknown): void {
    userProfileStoreStatus = "degraded";
    userProfileStoreDetail = `${userProfileStore.name}: ${errorMessage(error)}`;
    app.log.error({ error }, "User profile store failed; using in-memory fallback.");
  }

  function userProfileStoreDependencyDetail(): string {
    const diagnostics = userProfileStore.diagnostics?.();
    return diagnostics ? `${userProfileStoreDetail}; ${diagnostics}` : userProfileStoreDetail;
  }

  function activeUserProfileStore(): UserProfileStore {
    return userProfileStoreStatus === "ok" ? userProfileStore : userProfileFallbackStore;
  }

  async function readUserProfile(actor: AuthenticatedActor): Promise<UserProfileRecord | null> {
    try {
      return await activeUserProfileStore().getProfile(actor.subjectId);
    } catch (error) {
      markUserProfileStoreDegraded(error);
      return userProfileFallbackStore.getProfile(actor.subjectId);
    }
  }

  async function upsertUserProfile(profile: Omit<UserProfileRecord, "createdAt" | "updatedAt">): Promise<UserProfileRecord> {
    try {
      return await activeUserProfileStore().upsertProfile(profile);
    } catch (error) {
      markUserProfileStoreDegraded(error);
      return userProfileFallbackStore.upsertProfile(profile);
    }
  }

  async function readAlertAcknowledgements(actor: AuthenticatedActor): Promise<Map<string, AlertAcknowledgement>> {
    try {
      return await activeUserProfileStore().getAlertAcknowledgements(actor.subjectId);
    } catch (error) {
      markUserProfileStoreDegraded(error);
      return userProfileFallbackStore.getAlertAcknowledgements(actor.subjectId);
    }
  }

  async function acknowledgeAlertForActor(actor: AuthenticatedActor, acknowledgement: AlertAcknowledgement): Promise<void> {
    try {
      await activeUserProfileStore().acknowledgeAlert(actor.subjectId, acknowledgement);
    } catch (error) {
      markUserProfileStoreDegraded(error);
      await userProfileFallbackStore.acknowledgeAlert(actor.subjectId, acknowledgement);
    }
  }

  function requireActor(request: FastifyRequest, reply: FastifyReply): AuthenticatedActor | null {
    const actor = actorFromRequest(request);
    if (actor) {
      return actor;
    }
    sendError(
      reply,
      401,
      "UNAUTHORIZED",
      "Authenticated operator identity is required.",
      correlationIdFrom(request.headers["x-correlation-id"])
    );
    return null;
  }

  async function persistTrackHistoryPoint(point: TrackHistoryPoint | undefined): Promise<void> {
    if (!trackHistoryStore || !point || trackHistoryStoreStatus !== "ok") {
      return;
    }
    try {
      await trackHistoryStore.append(point);
    } catch (error) {
      markTrackHistoryStoreDegraded(error);
    }
  }

  async function persistCurrentTrack(object: ObservedObject, event: CanonicalEventEnvelope): Promise<void> {
    if (!trackHistoryStore || trackHistoryStoreStatus !== "ok") {
      return;
    }
    try {
      await trackHistoryStore.upsertCurrent(object, event);
    } catch (error) {
      markTrackHistoryStoreDegraded(error);
    }
  }

  async function readTrackHistory(
    query: ReturnType<typeof parseTrackHistoryQuery>,
    requestNow: Date
  ): Promise<Array<{ objectId: string; points: TrackHistoryPoint[] }>> {
    if (trackHistoryStore && trackHistoryStoreStatus === "ok") {
      try {
        return await trackHistoryStore.query(query, requestNow);
      } catch (error) {
        markTrackHistoryStoreDegraded(error);
      }
    }
    return queryTrackHistory(state, query, requestNow);
  }

  async function buildConflictEvidenceForObjects(
    objects: ObservedObject[],
    requestNow: Date,
    query: TrackHistoryQuery = {}
  ): Promise<Map<string, ObjectConflictEvidence>> {
    const objectIds = objects.map((object) => object.objectId);
    if (objectIds.length === 0) {
      return new Map();
    }

    const historyItems = await readTrackHistory(
      {
        ...query,
        limit: query.limit ?? 24,
        objectIds,
        seconds: query.seconds ?? 300
      },
      requestNow
    );
    return buildConflictEvidenceIndex({
      evaluatedAt: requestNow.toISOString(),
      historyItems,
      objects,
      sourceHealth: buildSourceHealthItems(state, requestNow, trackLifecycle)
    });
  }

  async function decorateObjectsWithConflictEvidence(
    objects: ObservedObject[],
    requestNow: Date,
    query?: TrackHistoryQuery
  ): Promise<ObservedObject[]> {
    const evidenceIndex = await buildConflictEvidenceForObjects(objects, requestNow, query);
    return objects.map((object) => withConflictEvidence(object, evidenceIndex.get(object.objectId)));
  }

  async function buildAlertItems({
    actor,
    includeAcknowledged,
    includeExpired,
    requestNow
  }: {
    actor: AuthenticatedActor;
    includeAcknowledged: boolean;
    includeExpired: boolean;
    requestNow: Date;
  }): Promise<CopAlert[]> {
    const subject = defaultSystemSubject();
    const readableObjects = selectCurrentTracks(state.objects.values(), requestNow, trackLifecycle, includeExpired).filter((object) =>
      canReadObject(subject, object)
    );
    const objectsWithEvidence = await decorateObjectsWithConflictEvidence(readableObjects, requestNow);
    const alerts = buildCopAlerts({
      acknowledgements: await readAlertAcknowledgements(actor),
      evaluatedAt: requestNow.toISOString(),
      objects: objectsWithEvidence,
      sourceHealth: buildSourceHealthItems(state, requestNow, trackLifecycle)
    });
    const profile = await readUserProfile(actor);
    const preferredAlerts = filterAlertsByPreferences(alerts, profile?.alertPreferences ?? {});
    return includeAcknowledged ? preferredAlerts : preferredAlerts.filter((alert) => alert.status === "ACTIVE");
  }

  function decorateObjectsWithInMemoryConflictEvidence(objects: ObservedObject[], requestNow: Date): ObservedObject[] {
    const historyItems = objects.map((object) => ({
      objectId: object.objectId,
      points: state.trackHistory.get(object.objectId) ?? []
    }));
    const evidenceIndex = buildConflictEvidenceIndex({
      evaluatedAt: requestNow.toISOString(),
      historyItems,
      objects,
      sourceHealth: buildSourceHealthItems(state, requestNow, trackLifecycle)
    });
    return objects.map((object) => withConflictEvidence(object, evidenceIndex.get(object.objectId)));
  }

  app.get("/api/v1/me/preferences", async (request, reply) => {
    const actor = requireActor(request, reply);
    if (!actor) {
      return reply;
    }

    const profile = await readUserProfile(actor);
    return {
      actor,
      alertPreferences: profile?.alertPreferences ?? {},
      preferences: profile?.preferences ?? {},
      updatedAt: profile?.updatedAt ?? null
    };
  });

  app.put("/api/v1/me/preferences", async (request, reply) => {
    const actor = requireActor(request, reply);
    if (!actor) {
      return reply;
    }

    const existing = await readUserProfile(actor);
    const body = isRecord(request.body) ? request.body : {};
    const preferences = hasOwn(body, "preferences")
      ? normalizeUserPreferences(body.preferences)
      : existing?.preferences ?? {};
    const alertPreferences = hasOwn(body, "alertPreferences")
      ? normalizeAlertPreferences(body.alertPreferences)
      : existing?.alertPreferences ?? {};

    const profile = await upsertUserProfile({
      alertPreferences,
      displayName: actor.displayName,
      ...(actor.email ? { email: actor.email } : {}),
      preferences,
      subjectId: actor.subjectId,
      username: actor.username
    });
    appendAudit(state, "USER_PROFILE_UPDATED", {
      actorAuthMode: actor.authMode,
      actorSubjectId: actor.subjectId,
      preferenceKeys: Object.keys(preferences).sort()
    }, correlationIdFrom(request.headers["x-correlation-id"]));

    return {
      actor,
      alertPreferences: profile.alertPreferences,
      preferences: profile.preferences,
      updatedAt: profile.updatedAt
    };
  });

  app.get("/api/v1/sources", async () => ({
    items: Array.from(state.sources.values())
  }));

  app.get("/api/v1/sources/health", async () => {
    const requestNow = now();
    return {
      items: buildSourceHealthItems(state, requestNow, trackLifecycle),
      serverTimestamp: requestNow.toISOString()
    };
  });

  app.post("/api/v1/sources", async (request, reply) => {
    const correlationId = correlationIdFrom(request.headers["x-correlation-id"]);
    const validation = validators.validateSourceSystem(request.body);
    if (!validation.valid || !validation.data) {
      return sendError(
        reply,
        400,
        "VALIDATION_ERROR",
        "Source system payload does not match schema.",
        correlationId,
        formatValidationErrors(validation.errors)
      );
    }

    const now = new Date().toISOString();
    const source: SourceSystem = {
      ...validation.data,
      status: validation.data.status ?? "REGISTERED",
      createdAt: validation.data.createdAt ?? now,
      updatedAt: now
    };
    state.sources.set(source.sourceSystemId, source);
    appendAudit(state, "SOURCE_REGISTERED", { sourceSystemId: source.sourceSystemId }, correlationId);
    return reply.code(201).send(source);
  });

  app.get("/api/v1/sources/:sourceSystemId", async (request, reply) => {
    const params = request.params as { sourceSystemId: string };
    const source = state.sources.get(params.sourceSystemId);
    if (!source) {
      return sendError(reply, 404, "NOT_FOUND", "Source system was not found.", crypto.randomUUID());
    }
    return source;
  });

  app.patch("/api/v1/sources/:sourceSystemId", async (request, reply) => {
    const params = request.params as { sourceSystemId: string };
    const source = state.sources.get(params.sourceSystemId);
    if (!source) {
      return sendError(reply, 404, "NOT_FOUND", "Source system was not found.", crypto.randomUUID());
    }
    const patch = request.body as Partial<SourceSystem>;
    const updated = {
      ...source,
      ...patch,
      sourceSystemId: source.sourceSystemId,
      updatedAt: new Date().toISOString()
    };
    state.sources.set(source.sourceSystemId, updated);
    appendAudit(state, "SOURCE_UPDATED", { sourceSystemId: source.sourceSystemId });
    return updated;
  });

  app.post("/api/v1/sources/:sourceSystemId/revoke", async (request, reply) => {
    const params = request.params as { sourceSystemId: string };
    const source = state.sources.get(params.sourceSystemId);
    if (!source) {
      return sendError(reply, 404, "NOT_FOUND", "Source system was not found.", crypto.randomUUID());
    }
    const changedAt = new Date().toISOString();
    state.sources.set(source.sourceSystemId, { ...source, status: "REVOKED", updatedAt: changedAt });
    appendAudit(state, "SOURCE_REVOKED", { sourceSystemId: source.sourceSystemId });
    return reply.code(202).send({
      sourceSystemId: source.sourceSystemId,
      status: "REVOKED",
      changedAt
    });
  });

  app.post("/api/v1/ingest/events", async (request, reply) => {
    const correlationId = correlationIdFrom(request.headers["x-correlation-id"]);
    const validation = validators.validateCanonicalEvent(request.body);
    if (!validation.valid || !validation.data) {
      appendAudit(state, "INGEST_REJECTED", { reason: "schema" }, correlationId);
      return sendError(
        reply,
        400,
        "VALIDATION_ERROR",
        "Payload does not match schema.",
        correlationId,
        formatValidationErrors(validation.errors)
      );
    }

    return handleIngestEvent(
      state,
      validation.data,
      request.headers,
      reply,
      correlationId,
      persistCurrentTrack,
      persistTrackHistoryPoint,
      publishCurrentTracks
    );
  });

  app.post("/api/v1/ingest/batches", async (request, reply) => {
    const correlationId = correlationIdFrom(request.headers["x-correlation-id"]);
    const body = request.body as { batchId?: string; contractVersion?: string; sourceSystemId?: string; events?: unknown[] };
    if (!body.batchId || body.contractVersion !== "cop-ingest-v1" || !body.sourceSystemId || !Array.isArray(body.events)) {
      return sendError(reply, 400, "VALIDATION_ERROR", "Batch payload does not match contract.", correlationId);
    }

    const sourceCheck = validateSourceForRequest(state, body.sourceSystemId, body.sourceSystemId, correlationId);
    if (!sourceCheck.valid) {
      return sendError(reply, sourceCheck.statusCode, sourceCheck.code, sourceCheck.message, correlationId);
    }

    const items: Array<{ eventId: string; status: "QUEUED" | "REJECTED"; errorCode?: string }> = [];
    const acceptedObjects: ObservedObject[] = [];
    for (const item of body.events) {
      const validation = validators.validateCanonicalEvent(item);
      if (!validation.valid || !validation.data) {
        items.push({ eventId: "unknown", status: "REJECTED", errorCode: "VALIDATION_ERROR" });
        continue;
      }

      const result = acceptEvent(state, validation.data);
      await persistCurrentTrack(result.object, result.accepted);
      await persistTrackHistoryPoint(result.historyPoint);
      acceptedObjects.push(result.object);
      items.push({ eventId: result.accepted.eventId, status: "QUEUED" });
    }
    await publishCurrentTracks(acceptedObjects);

    const response = {
      batchId: body.batchId,
      acceptedCount: items.filter((item) => item.status === "QUEUED").length,
      rejectedCount: items.filter((item) => item.status === "REJECTED").length,
      items
    };
    appendAudit(state, "INGEST_BATCH_ACCEPTED", { ...response }, correlationId);
    return reply.code(202).send(response);
  });

  app.get("/api/v1/cop/tracks", async (request) => {
    const query = request.query as { includeExpired?: string };
    const includeExpired = query.includeExpired === "true";
    const requestNow = now();
    const subject = defaultSystemSubject();
    const readableItems = selectCurrentTracks(state.objects.values(), requestNow, trackLifecycle, includeExpired).filter((object) => {
      const decision = evaluateReadPolicy(subject, {
        classification: "UNCLASSIFIED",
        synthetic: object.synthetic
      });
      return decision.allowed;
    });
    const items = await decorateObjectsWithConflictEvidence(readableItems, requestNow);
    return { items, nextCursor: null };
  });

  app.get("/api/v1/cop/conflicts", async (request) => {
    const rawQuery = request.query as Record<string, unknown> & { includeExpired?: string };
    const query = parseTrackHistoryQuery(rawQuery);
    const includeExpired = rawQuery.includeExpired === "true";
    const requestNow = now();
    const subject = defaultSystemSubject();
    const currentObjects = selectCurrentTracks(state.objects.values(), requestNow, trackLifecycle, includeExpired).filter((object) =>
      canReadObject(subject, object)
    );
    const requestedObjectIds = new Set(query.objectIds ?? []);
    const scopedObjects = requestedObjectIds.size > 0
      ? currentObjects.filter((object) => requestedObjectIds.has(object.objectId))
      : currentObjects;
    const evidenceIndex = await buildConflictEvidenceForObjects(scopedObjects, requestNow, query);
    return {
      items: Array.from(evidenceIndex.values()),
      nextCursor: null,
      serverTimestamp: requestNow.toISOString()
    };
  });

  app.get("/api/v1/cop/alerts", async (request, reply) => {
    const query = request.query as { includeAcknowledged?: string; includeExpired?: string };
    const actor = requireActor(request, reply);
    if (!actor) {
      return reply;
    }
    const requestNow = now();
    const items = await buildAlertItems({
      actor,
      includeAcknowledged: query.includeAcknowledged === "true",
      includeExpired: query.includeExpired === "true",
      requestNow
    });
    return {
      items,
      nextCursor: null,
      serverTimestamp: requestNow.toISOString()
    };
  });

  app.post("/api/v1/cop/alerts/:alertId/acknowledge", async (request, reply) => {
    const params = request.params as { alertId: string };
    const actor = requireActor(request, reply);
    if (!actor) {
      return reply;
    }
    const body = request.body as { note?: string } | undefined;
    const requestNow = now();
    const currentAlerts = await buildAlertItems({
      actor,
      includeAcknowledged: true,
      includeExpired: true,
      requestNow
    });
    const alert = currentAlerts.find((candidate) => candidate.alertId === params.alertId);
    if (!alert) {
      return sendError(reply, 404, "NOT_FOUND", "Alert was not found in current COP alert evidence.", crypto.randomUUID());
    }

    const acknowledgement = {
      acknowledgedAt: requestNow.toISOString(),
      acknowledgedBy: actor.username,
      alertId: params.alertId,
      note: body?.note
    };
    await acknowledgeAlertForActor(actor, acknowledgement);
    appendAudit(state, "ALERT_ACKNOWLEDGED", {
      actorAuthMode: actor.authMode,
      actorSubjectId: actor.subjectId,
      alertId: params.alertId,
      alertType: alert.type,
      objectId: alert.objectId,
      sourceSystemId: alert.sourceSystemId
    });
    return {
      ...alert,
      acknowledgedAt: acknowledgement.acknowledgedAt,
      status: "ACKNOWLEDGED" as const
    };
  });

  app.get("/api/v1/cop/track-history", async (request) => {
    const query = parseTrackHistoryQuery(request.query as Record<string, unknown>);
    const requestNow = now();
    const subject = defaultSystemSubject();
    const items = (await readTrackHistory(query, requestNow))
      .map((item) => ({
        ...item,
        points: item.points.filter((point) => canReadHistoryPoint(subject, point))
      }))
      .filter((item) => item.points.length > 0);
    return {
      items,
      nextCursor: null,
      serverTimestamp: requestNow.toISOString()
    };
  });

  app.get("/api/v1/stream/cop/health", async () => {
    const requestNow = now();
    const metrics = streamBroadcaster.metrics;
    return {
      metrics,
      serverTimestamp: requestNow.toISOString(),
      status: streamHealthStatus(metrics, requestNow)
    };
  });

  app.post("/api/v1/cop/subscriptions", async (request, reply) => {
    const correlationId = correlationIdFrom(request.headers["x-correlation-id"]);
    const validation = validators.validateCopSubscription(request.body);
    if (!validation.valid) {
      return sendError(
        reply,
        400,
        "VALIDATION_ERROR",
        "Subscription payload does not match schema.",
        correlationId,
        formatValidationErrors(validation.errors)
      );
    }
    const subscriptionId = crypto.randomUUID();
    appendAudit(state, "COP_SUBSCRIPTION_CREATED", { subscriptionId }, correlationId);
    return reply.code(201).send({
      subscriptionId,
      streamUrl: `/api/v1/stream/cop/${subscriptionId}`,
      expiresAt: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString()
    });
  });

  app.get("/api/v1/stream/cop/live", async (request, reply) => {
    const subject = defaultSystemSubject();
    const subscriptionId = crypto.randomUUID();
    const writeMessage = (message: CopStreamMessage) => {
      if (reply.raw.destroyed || reply.raw.writableEnded) {
        return;
      }

      const visibleMessage = filterStreamMessage(subject, message);
      if (!visibleMessage) {
        return;
      }

      try {
        reply.raw.write(`event: ${visibleMessage.type}\n`);
        reply.raw.write(`id: ${visibleMessage.sequence}\n`);
        reply.raw.write(`data: ${JSON.stringify(visibleMessage)}\n\n`);
      } catch {
        streamBroadcaster.recordWriteError(now());
        streamBroadcaster.createReconnectRequired("stream_write_failed", now());
        request.raw.destroy();
      }
    };

    reply.hijack();
    reply.raw.writeHead(200, {
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "content-type": "text/event-stream; charset=utf-8",
      "x-accel-buffering": "no"
    });
    reply.raw.write("retry: 5000\n\n");
    const unsubscribe = streamBroadcaster.subscribe(writeMessage);
    const snapshotNow = now();
    writeMessage(streamBroadcaster.createSnapshot(subscriptionId, await readableCurrentTracks(subject, snapshotNow), snapshotNow));
    const initialBackpressure = streamBroadcaster.createBackpressure(now());
    if (initialBackpressure) {
      writeMessage(initialBackpressure);
    }

    const heartbeat = setInterval(() => {
      const heartbeatNow = now();
      const backpressure = streamBroadcaster.createBackpressure(heartbeatNow);
      if (backpressure) {
        writeMessage(backpressure);
      }
      writeMessage(streamBroadcaster.createHeartbeat(heartbeatNow));
    }, 15000);
    const cleanup = () => {
      clearInterval(heartbeat);
      unsubscribe();
    };
    request.raw.once("close", cleanup);
  });

  app.get("/api/v1/stream/cop/:subscriptionId", async (request) => {
    const params = request.params as { subscriptionId: string };
    const subject = defaultSystemSubject();
    const requestNow = now();
    const objects = await readableCurrentTracks(subject, requestNow);
    return {
      type: "snapshot",
      subscriptionId: params.subscriptionId,
      serverTimestamp: requestNow.toISOString(),
      sequence: 1,
      changes: objects.map((object) => ({
        changeType: "OBJECT_SNAPSHOT",
        object
      }))
    };
  });

  app.post("/api/v1/symbology/resolve", async (request, reply) => {
    const correlationId = correlationIdFrom(request.headers["x-correlation-id"]);
    const validation = validators.validateSymbolResolveRequest(request.body);
    if (!validation.valid || !validation.data) {
      return sendError(
        reply,
        400,
        "VALIDATION_ERROR",
        "Symbol resolve payload does not match schema.",
        correlationId,
        formatValidationErrors(validation.errors)
      );
    }
    return resolveSymbolFromRequest(validation.data as Parameters<typeof resolveSymbolFromRequest>[0]);
  });

  app.get("/api/v1/audit/events", async () => ({
    items: state.auditEvents
  }));

  app.post("/api/v1/ai/cop-assistant/query", async (request, reply) => {
    const correlationId = correlationIdFrom(request.headers["x-correlation-id"]);
    const validation = validators.validateAiCopQuery(request.body);
    if (!validation.valid || !validation.data) {
      return sendError(
        reply,
        400,
        "VALIDATION_ERROR",
        "AI COP query payload does not match schema.",
        correlationId,
        formatValidationErrors(validation.errors)
      );
    }
    const response = await aiGateway.queryCopAssistant(validation.data as Parameters<AiGateway["queryCopAssistant"]>[0]);
    appendAudit(state, `AI_REQUEST_${response.status}`, { requestId: response.requestId, provider: response.provider }, correlationId);
    return response;
  });

  async function readableCurrentTracks(subject: ReturnType<typeof defaultSystemSubject>, requestNow: Date): Promise<ObservedObject[]> {
    const objects = selectCurrentTracks(state.objects.values(), requestNow, trackLifecycle).filter((object) => canReadObject(subject, object));
    return decorateObjectsWithConflictEvidence(objects, requestNow);
  }

  async function publishCurrentTracks(objects: ObservedObject[]): Promise<void> {
    const subject = defaultSystemSubject();
    const requestNow = now();
    const readableObjects = decorateObjectsWithInMemoryConflictEvidence(
      objects.filter((object) => canReadObject(subject, object)),
      requestNow
    );
    streamBroadcaster.publishObjectUpserts(readableObjects, requestNow);
  }

  return app;
}

async function handleIngestEvent(
  state: CopState,
  event: CanonicalEventEnvelope,
  headers: Record<string, string | string[] | undefined>,
  reply: FastifyReply,
  correlationId: string,
  persistCurrentTrack: (object: ObservedObject, event: CanonicalEventEnvelope) => Promise<void>,
  persistTrackHistoryPoint: (point: TrackHistoryPoint | undefined) => Promise<void>,
  publishCurrentTracks: (objects: ObservedObject[]) => Promise<void>
) {
  const headerSource = headerAsString(headers["x-source-system-id"]);
  const sourceCheck = validateSourceForRequest(state, headerSource, event.source.sourceSystemId, correlationId);
  if (!sourceCheck.valid) {
    appendAudit(state, "INGEST_REJECTED", { reason: sourceCheck.code, sourceSystemId: event.source.sourceSystemId }, correlationId);
    return sendError(reply, sourceCheck.statusCode, sourceCheck.code, sourceCheck.message, correlationId);
  }

  if (!sourceCheck.source.allowedEventTypes.includes(event.eventType)) {
    return sendError(reply, 422, "EVENT_TYPE_NOT_ALLOWED", "Source is not allowed to publish this event type.", correlationId);
  }

  if (!sourceCheck.source.allowedObjectTypes.includes(event.payload.objectType)) {
    return sendError(reply, 422, "OBJECT_TYPE_NOT_ALLOWED", "Source is not allowed to publish this object type.", correlationId);
  }

  if (sourceCheck.source.synthetic && event.simulation?.synthetic !== true) {
    return sendError(reply, 422, "SYNTHETIC_FLAG_REQUIRED", "Synthetic source must mark events as synthetic.", correlationId);
  }

  const key = headerAsString(headers["x-idempotency-key"]);
  if (!key) {
    return sendError(reply, 400, "IDEMPOTENCY_KEY_REQUIRED", "X-Idempotency-Key header is required.", correlationId);
  }

  const hash = hashPayload(event);
  const previous = state.idempotency.get(key);
  if (previous && previous.hash !== hash) {
    appendAudit(state, "IDEMPOTENCY_CONFLICT", { eventId: event.eventId }, correlationId);
    return sendError(reply, 409, "IDEMPOTENCY_CONFLICT", "Idempotency key was reused with different content.", correlationId);
  }
  if (previous) {
    return reply.code(202).send(previous.response);
  }

  const result = acceptEvent(state, event);
  await persistCurrentTrack(result.object, result.accepted);
  await persistTrackHistoryPoint(result.historyPoint);
  await publishCurrentTracks([result.object]);
  const accepted = result.accepted;
  const response = {
    accepted: true,
    eventId: accepted.eventId,
    ingestId: crypto.randomUUID(),
    receivedAt: accepted.ingestTimestamp,
    status: "QUEUED",
    correlationId
  };
  state.idempotency.set(key, { hash, response });
  appendAudit(state, "INGEST_ACCEPTED", { eventId: event.eventId, sourceSystemId: event.source.sourceSystemId }, correlationId);
  return reply.code(202).send(response);
}

function acceptEvent(
  state: CopState,
  event: CanonicalEventEnvelope
): { accepted: CanonicalEventEnvelope; historyPoint: TrackHistoryPoint | undefined; object: ObservedObject } {
  const accepted: CanonicalEventEnvelope = {
    ...event,
    ingestTimestamp: event.ingestTimestamp ?? new Date().toISOString()
  };
  state.events.set(accepted.eventId, accepted);
  const object = withEventProvenance(createCopObjectFromEvent(accepted), accepted);
  state.objects.set(object.objectId, object);
  const historyPoint = appendTrackHistory(state, accepted, object);
  return { accepted, historyPoint, object };
}

function canReadHistoryPoint(subject: ReturnType<typeof defaultSystemSubject>, point: TrackHistoryPoint): boolean {
  return canReadBySyntheticFlag(subject, point.synthetic);
}

function canReadObject(subject: ReturnType<typeof defaultSystemSubject>, object: ObservedObject): boolean {
  return canReadBySyntheticFlag(subject, object.synthetic);
}

function canReadBySyntheticFlag(subject: ReturnType<typeof defaultSystemSubject>, synthetic: boolean | undefined): boolean {
  const decision = evaluateReadPolicy(subject, {
    classification: "UNCLASSIFIED",
    synthetic
  });
  return decision.allowed;
}

function filterStreamMessage(subject: ReturnType<typeof defaultSystemSubject>, message: CopStreamMessage): CopStreamMessage | null {
  if (message.type === "heartbeat" || message.type === "backpressure" || message.type === "reconnect_required") {
    return message;
  }

  const changes = message.changes.filter((change) => canReadObject(subject, change.object));
  if (message.type === "snapshot") {
    return { ...message, changes };
  }
  return changes.length > 0 ? { ...message, changes } : null;
}

function filterAlertsByPreferences(alerts: CopAlert[], preferences: UserAlertPreferences): CopAlert[] {
  const enabledTypes = new Set(preferences.enabledTypes ?? []);
  const minimumSeverity = preferences.minimumSeverity;
  return alerts.filter((alert) => {
    if (enabledTypes.size > 0 && !enabledTypes.has(alert.type)) {
      return false;
    }
    return !minimumSeverity || alertSeverityRank(alert.severity) >= alertSeverityRank(minimumSeverity);
  });
}

function alertSeverityRank(severity: CopAlert["severity"]): number {
  if (severity === "critical") {
    return 3;
  }
  if (severity === "warning") {
    return 2;
  }
  return 1;
}

function normalizeUserPreferences(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) {
    return {};
  }

  return compactRecord({
    activeWorkspace: optionalString(value.activeWorkspace, ["map", "data", "sources", "alerts", "replay"]),
    affiliationScope: optionalString(value.affiliationScope, ["all", "friend", "hostile", "neutral", "unknown"]),
    alertRadiusKm: optionalFiniteNumber(value.alertRadiusKm, 1, 50),
    autoFit: optionalBoolean(value.autoFit),
    autoRefresh: optionalBoolean(value.autoRefresh),
    domainScope: optionalString(value.domainScope, ["all", "AIR", "LAND", "SEA", "RESCUE", "OTHER"]),
    includeSynthetic: optionalBoolean(value.includeSynthetic),
    mapView: normalizeMapViewPreference(value.mapView),
    minConfidence: optionalFiniteNumber(value.minConfidence, 0, 1),
    predictionMinutes: optionalFiniteNumber(value.predictionMinutes, 2, 20),
    predictionMode: optionalString(value.predictionMode, ["adaptive", "telemetry", "history", "maneuver"]),
    proximityAlertEnabled: optionalBoolean(value.proximityAlertEnabled),
    refreshSeconds: optionalFiniteNumber(value.refreshSeconds, 1, 60),
    selectedLayer: optionalString(value.selectedLayer, ["air-situation", "uav", "friendly", "foreign", "data-quality"]),
    showHistory: optionalBoolean(value.showHistory),
    showPrediction: optionalBoolean(value.showPrediction),
    trackHistoryLimit: optionalFiniteNumber(value.trackHistoryLimit, 1, 1000),
    trackHistoryWindowSeconds: optionalFiniteNumber(value.trackHistoryWindowSeconds, 1, 3600)
  });
}

function normalizeAlertPreferences(value: unknown): UserAlertPreferences {
  if (!isRecord(value)) {
    return {};
  }

  const enabledTypes = Array.isArray(value.enabledTypes) ? value.enabledTypes.filter(isCopAlertType) : undefined;
  const minimumSeverity = isCopAlertSeverity(value.minimumSeverity) ? value.minimumSeverity : undefined;
  return {
    ...(enabledTypes && enabledTypes.length > 0 ? { enabledTypes } : {}),
    ...(minimumSeverity ? { minimumSeverity } : {})
  };
}

function normalizeMapViewPreference(value: unknown): Record<string, unknown> | undefined {
  if (!isRecord(value) || !Array.isArray(value.center) || value.center.length !== 2) {
    return undefined;
  }
  const lon = Number(value.center[0]);
  const lat = Number(value.center[1]);
  const zoom = Number(value.zoom);
  if (!Number.isFinite(lon) || !Number.isFinite(lat) || !Number.isFinite(zoom)) {
    return undefined;
  }
  return compactRecord({
    bearing: optionalFiniteNumber(value.bearing, -360, 360),
    center: [clampNumber(lon, -180, 180), clampNumber(lat, -90, 90)],
    pitch: optionalFiniteNumber(value.pitch, 0, 85),
    zoom: clampNumber(zoom, 0, 22)
  });
}

function compactRecord(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined));
}

function optionalBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function optionalFiniteNumber(value: unknown, min: number, max: number): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? clampNumber(parsed, min, max) : undefined;
}

function optionalString(value: unknown, allowedValues: string[]): string | undefined {
  return typeof value === "string" && allowedValues.includes(value) ? value : undefined;
}

function isCopAlertType(value: unknown): value is CopAlert["type"] {
  return value === "LOW_CONFIDENCE"
    || value === "SOURCE_DEGRADED"
    || value === "TRACK_CONFLICT"
    || value === "TRACK_LOST"
    || value === "TRACK_STALE";
}

function isCopAlertSeverity(value: unknown): value is CopAlert["severity"] {
  return value === "info" || value === "warning" || value === "critical";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOwn(value: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function validateSourceForRequest(
  state: CopState,
  headerSourceSystemId: string | undefined,
  bodySourceSystemId: string,
  correlationId: string
):
  | { valid: true; source: SourceSystem }
  | { valid: false; statusCode: number; code: string; message: string; correlationId: string } {
  if (!headerSourceSystemId) {
    return {
      valid: false,
      statusCode: 400,
      code: "SOURCE_HEADER_REQUIRED",
      message: "X-Source-System-Id header is required.",
      correlationId
    };
  }
  if (headerSourceSystemId !== bodySourceSystemId) {
    return {
      valid: false,
      statusCode: 403,
      code: "SOURCE_MISMATCH",
      message: "Header sourceSystemId does not match payload sourceSystemId.",
      correlationId
    };
  }
  const source = state.sources.get(bodySourceSystemId);
  if (!source) {
    return {
      valid: false,
      statusCode: 403,
      code: "SOURCE_NOT_REGISTERED",
      message: "Source system is not registered.",
      correlationId
    };
  }
  if (source.status !== "ACTIVE") {
    return {
      valid: false,
      statusCode: 403,
      code: "SOURCE_NOT_ACTIVE",
      message: "Source system is not active.",
      correlationId
    };
  }
  return { valid: true, source };
}

function hashPayload(data: unknown): string {
  return createHash("sha256").update(JSON.stringify(data)).digest("hex");
}

function headerAsString(value: unknown): string | undefined {
  if (Array.isArray(value)) {
    return value[0];
  }
  return typeof value === "string" ? value : undefined;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "unknown error";
}

function createStreamBroadcasterFromEnv(env: Record<string, string | undefined> = process.env): CopStreamBroadcaster {
  return new CopStreamBroadcaster({
    backpressureClientThreshold: readPositiveInteger(env.COP_STREAM_BACKPRESSURE_CLIENTS, 25),
    recommendedRetryMs: readPositiveInteger(env.COP_STREAM_RETRY_MS, 5000)
  });
}

function readPositiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : fallback;
}

function timestampSeconds(value: string | undefined): number {
  if (!value) {
    return 0;
  }
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? Math.floor(timestamp / 1000) : 0;
}

function streamHealthStatus(metrics: CopStreamBroadcaster["metrics"], now: Date): "degraded" | "ok" {
  if (metrics.backpressureActive) {
    return "degraded";
  }
  const lastWriteErrorMs = metrics.lastWriteErrorAt ? Date.parse(metrics.lastWriteErrorAt) : Number.NaN;
  return Number.isFinite(lastWriteErrorMs) && now.getTime() - lastWriteErrorMs < 5 * 60 * 1000 ? "degraded" : "ok";
}
