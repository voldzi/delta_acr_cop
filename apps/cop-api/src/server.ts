import cors from "@fastify/cors";
import sensible from "@fastify/sensible";
import websocket from "@fastify/websocket";
import { AiGateway } from "@cop/ai-gateway";
import { createCopObjectFromEvent, type CanonicalEventEnvelope, type ObservedObject, type SourceSystem } from "@cop/canonical-model";
import { ContractValidators, formatValidationErrors } from "@cop/ingest-contracts";
import { resolveSymbolFromRequest } from "@cop/nato-symbol-renderer";
import { defaultSystemSubject, evaluateReadPolicy } from "@cop/policy-engine";
import Fastify, { type FastifyInstance, type FastifyReply } from "fastify";
import { createHash } from "node:crypto";
import { correlationIdFrom, sendError } from "./errors.js";
import { CopStreamBroadcaster, type CopStreamMessage } from "./cop-stream.js";
import { buildConflictEvidenceIndex, withConflictEvidence, type ObjectConflictEvidence } from "./conflict-evidence.js";
import { withEventProvenance } from "./provenance.js";
import { requireBearerToken } from "./security.js";
import { buildSourceHealthItems } from "./source-health.js";
import { appendAudit, createInitialState } from "./state.js";
import { createTrackHistoryStoreFromEnv, type TrackHistoryStore } from "./track-history-store.js";
import { appendTrackHistory, parseTrackHistoryQuery, queryTrackHistory, type TrackHistoryQuery } from "./temporal-history.js";
import { createTrackLifecycleConfig, selectCurrentTracks, type TrackLifecycleConfig } from "./track-lifecycle.js";
import type { CopState, TrackHistoryPoint } from "./types.js";

export interface BuildServerOptions {
  state?: CopState;
  logger?: boolean;
  now?: () => Date;
  trackHistoryStore?: TrackHistoryStore;
  trackLifecycle?: TrackLifecycleConfig;
  streamBroadcaster?: CopStreamBroadcaster;
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
  const streamBroadcaster = options.streamBroadcaster ?? new CopStreamBroadcaster();
  let trackHistoryStoreStatus: DependencyStatus = trackHistoryStore ? "degraded" : "disabled";
  let trackHistoryStoreDetail = trackHistoryStore ? `${trackHistoryStore.name}: initializing` : "in-memory only";
  let restoredCurrentTrackCount = 0;

  app.decorate("copState", state);
  void app.register(cors, { origin: true });
  void app.register(sensible);
  void app.register(websocket);
  app.addHook("preHandler", requireBearerToken);
  app.addHook("onReady", async () => {
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
      { name: "track-history-store", status: trackHistoryStoreStatus, detail: trackHistoryStoreDetail },
      { name: "ai-gateway", status: "degraded", detail: "mock provider only" }
    ]
  }));

  app.get("/metrics", async (_request, reply) => {
    const currentObjects = selectCurrentTracks(state.objects.values(), now(), trackLifecycle);
    const trackHistoryPointCount = await countTrackHistoryPoints();
    const persistedCurrentTrackCount = await countPersistedCurrentTracks();
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
      `cop_stream_clients_total ${streamBroadcaster.clientCount}`
    ];
    return reply.type("text/plain").send(`${lines.join("\n")}\n`);
  });

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
    const snapshotNow = now();
    writeMessage(streamBroadcaster.createSnapshot(subscriptionId, await readableCurrentTracks(subject, snapshotNow), snapshotNow));

    const unsubscribe = streamBroadcaster.subscribe(writeMessage);
    const heartbeat = setInterval(() => {
      writeMessage(streamBroadcaster.createHeartbeat(now()));
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
  if (message.type === "heartbeat") {
    return message;
  }

  const changes = message.changes.filter((change) => canReadObject(subject, change.object));
  if (message.type === "snapshot") {
    return { ...message, changes };
  }
  return changes.length > 0 ? { ...message, changes } : null;
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
