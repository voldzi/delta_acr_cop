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
import { buildCopAlerts, type AoiRule, type AoiRuleAffiliationScope, type CopAlert } from "./alerts.js";
import { correlationIdFrom, sendError } from "./errors.js";
import { CopStreamBroadcaster, type CopStreamMessage } from "./cop-stream.js";
import { buildConflictEvidenceIndex, withConflictEvidence, type ObjectConflictEvidence } from "./conflict-evidence.js";
import { createFlightDataSourceFromEnv, unavailableFlightDataHealth, type FlightAirportQuery, type FlightDataSource } from "./flight-data-source.js";
import { withEventProvenance } from "./provenance.js";
import { actorFromRequest, requireBearerToken, type AuthenticatedActor } from "./security.js";
import { buildSourceHealthItems } from "./source-health.js";
import {
  buildSituationDataHealth,
  createSituationDataSourceFromEnv,
  emptySituationFeatureCollection,
  parseSituationFeatureQuery,
  unavailableSituationDataHealth,
  type SituationDataSource,
  type SituationFeatureCollection,
  type SituationFeatureQuery,
  type SituationSourceDescriptor
} from "./situation-data-source.js";
import {
  buildSafetyDataHealth,
  createSafetyDataSourceFromEnv,
  emptySafetyFeatureCollection,
  parseSafetyFeatureQuery,
  unavailableSafetyDataHealth,
  type SafetyDataSource,
  type SafetyFeatureQuery
} from "./safety-data-source.js";
import { appendAudit, createInitialState } from "./state.js";
import { createTrackHistoryStoreFromEnv, type TrackHistoryStore } from "./track-history-store.js";
import { appendTrackHistory, parseTrackHistoryQuery, queryTrackHistory, type TrackHistoryQuery } from "./temporal-history.js";
import { createTrackLifecycleConfig, selectCurrentTracks, type TrackLifecycleConfig } from "./track-lifecycle.js";
import type { AlertAcknowledgement, CopState, SourceHealthOverride, TrackHistoryPoint } from "./types.js";
import {
  createUserProfileStoreFromEnv,
  InMemoryUserProfileStore,
  type UserAlertPreferences,
  type UserProfileRecord,
  type UserProfileStore
} from "./user-profile-store.js";

export interface BuildServerOptions {
  flightDataSource?: FlightDataSource;
  safetyDataSource?: SafetyDataSource;
  situationDataSource?: SituationDataSource;
  state?: CopState;
  logger?: boolean;
  now?: () => Date;
  trackHistoryStore?: TrackHistoryStore;
  trackLifecycle?: TrackLifecycleConfig;
  streamBroadcaster?: CopStreamBroadcaster;
  userProfileStore?: UserProfileStore;
}

type DependencyStatus = "disabled" | "degraded" | "ok";
type MobilePlatform = "ios" | "ipados";

interface MobileSnapshotQuery {
  includeAcknowledged: boolean;
  includeExpired: boolean;
  historyQuery: TrackHistoryQuery;
}

interface MobileDeviceRegistration {
  appVersion: string;
  buildNumber?: string;
  capabilities: string[];
  deviceId: string;
  deviceModel?: string;
  deviceSessionId: string;
  osVersion?: string;
  platform: MobilePlatform;
  pushTokenRegistered: boolean;
  registeredAt: string;
  subjectId: string;
}

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
  const flightDataSource = options.flightDataSource ?? createFlightDataSourceFromEnv();
  const safetyDataSource = options.safetyDataSource ?? createSafetyDataSourceFromEnv();
  const situationDataSource = options.situationDataSource ?? createSituationDataSourceFromEnv();
  const mobileDeviceRegistrations = new Map<string, MobileDeviceRegistration>();
  let trackHistoryStoreStatus: DependencyStatus = trackHistoryStore ? "degraded" : "disabled";
  let trackHistoryStoreDetail = trackHistoryStore ? `${trackHistoryStore.name}: initializing` : "in-memory only";
  let userProfileStoreStatus: DependencyStatus = "degraded";
  let userProfileStoreDetail = `${userProfileStore.name}: initializing`;
  let restoredCurrentTrackCount = 0;
  let flightDataPollTimer: ReturnType<typeof setInterval> | undefined;

  app.decorate("copState", state);
  if (flightDataSource) {
    state.sources.set(flightDataSource.sourceSystem.sourceSystemId, flightDataSource.sourceSystem);
  }
  if (situationDataSource) {
    state.sources.set(situationDataSource.sourceSystem.sourceSystemId, situationDataSource.sourceSystem);
  }
  if (safetyDataSource) {
    state.sources.set(safetyDataSource.sourceSystem.sourceSystemId, safetyDataSource.sourceSystem);
  }
  void app.register(cors, { origin: true });
  void app.register(sensible);
  void app.register(websocket);
  app.addHook("preHandler", requireBearerToken);
  app.addHook("onReady", async () => {
    await initializeUserProfileStore();
    if (trackHistoryStore) {
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
    }
    await initializeFlightDataSource();
  });
  app.addHook("onClose", async () => {
    if (flightDataPollTimer) {
      clearInterval(flightDataPollTimer);
    }
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
      ...(flightDataSource ? [flightDataDependency()] : []),
      ...(situationDataSource ? [situationDataDependency()] : []),
      ...(safetyDataSource ? [safetyDataDependency()] : []),
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
      `cop_stream_last_message_timestamp_seconds{type="write_error"} ${timestampSeconds(streamMetrics.lastWriteErrorAt)}`,
      ...situationDataCacheMetricLines(),
      ...safetyDataCacheMetricLines()
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

  async function initializeFlightDataSource(): Promise<void> {
    if (!flightDataSource) {
      return;
    }
    await refreshFlightDataSource("startup");
    if (flightDataSource.config.pollMs > 0) {
      flightDataPollTimer = setInterval(() => {
        void refreshFlightDataSource("interval");
      }, flightDataSource.config.pollMs);
      flightDataPollTimer.unref?.();
    }
  }

  async function refreshFlightDataSource(trigger: "interval" | "startup"): Promise<void> {
    if (!flightDataSource) {
      return;
    }
    const requestNow = now();
    try {
      const result = await flightDataSource.poll(requestNow);
      state.sources.set(flightDataSource.sourceSystem.sourceSystemId, withFlightDataHealth(activeFlightDataSourceSystem(), result.health));
      const acceptedObjects: ObservedObject[] = [];
      for (const event of result.events) {
        if (state.events.has(event.eventId)) {
          continue;
        }
        const accepted = acceptEvent(state, event);
        await persistCurrentTrack(accepted.object, accepted.accepted);
        await persistTrackHistoryPoint(accepted.historyPoint);
        acceptedObjects.push(accepted.object);
      }
      if (acceptedObjects.length > 0) {
        await publishCurrentTracks(acceptedObjects);
      }
      appendAudit(state, "FLIGHT_DATA_POLL_OK", {
        acceptedEvents: acceptedObjects.length,
        sourceSystemId: flightDataSource.sourceSystem.sourceSystemId,
        trigger,
        warnings: result.response.warnings
      });
    } catch (error) {
      const health = unavailableFlightDataHealth(error, requestNow);
      state.sources.set(flightDataSource.sourceSystem.sourceSystemId, withFlightDataHealth(activeFlightDataSourceSystem(), health));
      appendAudit(state, "FLIGHT_DATA_POLL_FAILED", {
        error: errorMessage(error),
        sourceSystemId: flightDataSource.sourceSystem.sourceSystemId,
        trigger
      });
      app.log.warn({ error }, "Flight data source poll failed.");
    }
  }

  function flightDataDependency(): { detail: string; name: string; status: DependencyStatus } {
    if (!flightDataSource) {
      return { detail: "disabled", name: "flight-data-source", status: "disabled" };
    }
    const health = readFlightDataHealth(state.sources.get(flightDataSource.sourceSystem.sourceSystemId));
    if (!health) {
      return { detail: "waiting for first poll", name: "flight-data-source", status: "degraded" };
    }
    return {
      detail: health.detail ?? health.lastError ?? health.health.toLowerCase(),
      name: "flight-data-source",
      status: health.health === "ONLINE" ? "ok" : "degraded"
    };
  }

  function activeFlightDataSourceSystem(): SourceSystem {
    if (!flightDataSource) {
      throw new Error("Flight data source is not enabled.");
    }
    return state.sources.get(flightDataSource.sourceSystem.sourceSystemId) ?? flightDataSource.sourceSystem;
  }

  function situationDataDependency(): { detail: string; name: string; status: DependencyStatus } {
    if (!situationDataSource) {
      return { detail: "disabled", name: "situation-data-source", status: "disabled" };
    }
    const health = readSituationDataHealth(state.sources.get(situationDataSource.sourceSystem.sourceSystemId));
    if (!health) {
      return { detail: "waiting for first request", name: "situation-data-source", status: "degraded" };
    }
    return {
      detail: health.detail ?? health.lastError ?? health.health.toLowerCase(),
      name: "situation-data-source",
      status: health.health === "ONLINE" ? "ok" : "degraded"
    };
  }

  function situationDataCacheMetricLines(): string[] {
    const cache = situationDataSource?.cacheStats?.();
    if (!cache) {
      return [];
    }
    return [
      "# HELP cop_situation_cache_entries Cached situation-data canonical viewport entries.",
      "# TYPE cop_situation_cache_entries gauge",
      `cop_situation_cache_entries ${cache.entries}`,
      "# HELP cop_situation_cache_inflight In-flight situation-data cache refreshes.",
      "# TYPE cop_situation_cache_inflight gauge",
      `cop_situation_cache_inflight ${cache.inflight}`,
      "# HELP cop_situation_cache_requests_total Situation-data cache requests by result.",
      "# TYPE cop_situation_cache_requests_total counter",
      `cop_situation_cache_requests_total{result="hit"} ${cache.hits}`,
      `cop_situation_cache_requests_total{result="miss"} ${cache.misses}`,
      `cop_situation_cache_requests_total{result="coalesced"} ${cache.coalescedHits}`,
      `cop_situation_cache_requests_total{result="stale"} ${cache.staleHits}`,
      "# HELP cop_situation_cache_refreshes_total Situation-data upstream refreshes completed by COP.",
      "# TYPE cop_situation_cache_refreshes_total counter",
      `cop_situation_cache_refreshes_total ${cache.refreshes}`,
      "# HELP cop_situation_cache_errors_total Situation-data upstream refresh errors observed by COP.",
      "# TYPE cop_situation_cache_errors_total counter",
      `cop_situation_cache_errors_total ${cache.errors}`,
      "# HELP cop_situation_cache_evictions_total Situation-data cache evictions.",
      "# TYPE cop_situation_cache_evictions_total counter",
      `cop_situation_cache_evictions_total ${cache.evictions}`
    ];
  }

  function activeSituationDataSourceSystem(): SourceSystem {
    if (!situationDataSource) {
      throw new Error("Situation data source is not enabled.");
    }
    return state.sources.get(situationDataSource.sourceSystem.sourceSystemId) ?? situationDataSource.sourceSystem;
  }

  function safetyDataDependency(): { detail: string; name: string; status: DependencyStatus } {
    if (!safetyDataSource) {
      return { detail: "disabled", name: "safety-data-source", status: "disabled" };
    }
    const health = readSafetyDataHealth(state.sources.get(safetyDataSource.sourceSystem.sourceSystemId));
    if (!health) {
      return { detail: "waiting for first request", name: "safety-data-source", status: "degraded" };
    }
    return {
      detail: health.detail ?? health.lastError ?? health.health.toLowerCase(),
      name: "safety-data-source",
      status: health.health === "ONLINE" ? "ok" : "degraded"
    };
  }

  function safetyDataCacheMetricLines(): string[] {
    const cache = safetyDataSource?.cacheStats?.();
    if (!cache) {
      return [];
    }
    return [
      "# HELP cop_safety_cache_entries Cached safety-data canonical viewport entries.",
      "# TYPE cop_safety_cache_entries gauge",
      `cop_safety_cache_entries ${cache.entries}`,
      "# HELP cop_safety_cache_inflight In-flight safety-data cache refreshes.",
      "# TYPE cop_safety_cache_inflight gauge",
      `cop_safety_cache_inflight ${cache.inflight}`,
      "# HELP cop_safety_cache_requests_total Safety-data cache requests by result.",
      "# TYPE cop_safety_cache_requests_total counter",
      `cop_safety_cache_requests_total{result="hit"} ${cache.hits}`,
      `cop_safety_cache_requests_total{result="miss"} ${cache.misses}`,
      `cop_safety_cache_requests_total{result="coalesced"} ${cache.coalescedHits}`,
      `cop_safety_cache_requests_total{result="stale"} ${cache.staleHits}`,
      "# HELP cop_safety_cache_refreshes_total Safety-data upstream refreshes completed by COP.",
      "# TYPE cop_safety_cache_refreshes_total counter",
      `cop_safety_cache_refreshes_total ${cache.refreshes}`,
      "# HELP cop_safety_cache_errors_total Safety-data upstream refresh errors observed by COP.",
      "# TYPE cop_safety_cache_errors_total counter",
      `cop_safety_cache_errors_total ${cache.errors}`,
      "# HELP cop_safety_cache_evictions_total Safety-data cache evictions.",
      "# TYPE cop_safety_cache_evictions_total counter",
      `cop_safety_cache_evictions_total ${cache.evictions}`
    ];
  }

  function activeSafetyDataSourceSystem(): SourceSystem {
    if (!safetyDataSource) {
      throw new Error("Safety data source is not enabled.");
    }
    return state.sources.get(safetyDataSource.sourceSystem.sourceSystemId) ?? safetyDataSource.sourceSystem;
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
    const profile = await readUserProfile(actor);
    const alerts = buildCopAlerts({
      acknowledgements: await readAlertAcknowledgements(actor),
      aoiRules: profile?.alertPreferences.aoiRules ?? [],
      evaluatedAt: requestNow.toISOString(),
      objects: objectsWithEvidence,
      sourceHealth: buildSourceHealthItems(state, requestNow, trackLifecycle)
    });
    const preferredAlerts = filterAlertsByPreferences(alerts, profile?.alertPreferences ?? {});
    return includeAcknowledged ? preferredAlerts : preferredAlerts.filter((alert) => alert.status === "ACTIVE");
  }

  async function buildMobileSnapshot(actor: AuthenticatedActor, requestNow: Date, query: MobileSnapshotQuery) {
    const subject = defaultSystemSubject();
    const readableObjects = selectCurrentTracks(state.objects.values(), requestNow, trackLifecycle, query.includeExpired).filter((object) =>
      canReadObject(subject, object)
    );
    const decoratedObjects = await decorateObjectsWithConflictEvidence(readableObjects, requestNow, query.historyQuery);
    const objectIds = query.historyQuery.objectIds && query.historyQuery.objectIds.length > 0
      ? query.historyQuery.objectIds
      : decoratedObjects.map((object) => object.objectId);
    const historyItems = (await readTrackHistory({ ...query.historyQuery, objectIds }, requestNow))
      .map((item) => ({
        ...item,
        points: item.points.filter((point) => canReadHistoryPoint(subject, point))
      }))
      .filter((item) => item.points.length > 0);
    const sourceHealthItems = buildSourceHealthItems(state, requestNow, trackLifecycle);
    const alerts = await buildAlertItems({
      actor,
      includeAcknowledged: query.includeAcknowledged,
      includeExpired: query.includeExpired,
      requestNow
    });
    return {
      alerts,
      cachePolicy: mobileCachePolicy(),
      health: {
        status: "ok",
        timestamp: requestNow.toISOString()
      },
      objects: decoratedObjects,
      serverTimestamp: requestNow.toISOString(),
      snapshotId: createMobileSnapshotId(requestNow, decoratedObjects, alerts, historyItems),
      sourceHealth: sourceHealthItems,
      sources: Array.from(state.sources.values()),
      streamHealth: {
        metrics: streamBroadcaster.metrics,
        serverTimestamp: requestNow.toISOString(),
        status: streamHealthStatus(streamBroadcaster.metrics, requestNow)
      },
      trackHistory: historyItems
    };
  }

  async function buildMobileBootstrap(actor: AuthenticatedActor, requestNow: Date, query: MobileSnapshotQuery) {
    const profile = await readUserProfile(actor);
    return {
      actor,
      auth: mobileAuthConfig(),
      capabilities: mobileCapabilities(),
      endpoints: mobileEndpoints(),
      map: mobileMapConfig(),
      policy: mobileNativePolicy(),
      profile: {
        alertPreferences: profile?.alertPreferences ?? {},
        preferences: profile?.preferences ?? {},
        updatedAt: profile?.updatedAt ?? null
      },
      snapshot: await buildMobileSnapshot(actor, requestNow, query),
      serverTimestamp: requestNow.toISOString()
    };
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

  app.get("/api/v1/mobile/bootstrap", async (request, reply) => {
    const actor = requireActor(request, reply);
    if (!actor) {
      return reply;
    }
    const requestNow = now();
    return buildMobileBootstrap(actor, requestNow, parseMobileSnapshotQuery(request.query as Record<string, unknown>));
  });

  app.get("/api/v1/mobile/offline-snapshot", async (request, reply) => {
    const actor = requireActor(request, reply);
    if (!actor) {
      return reply;
    }
    const requestNow = now();
    return buildMobileSnapshot(actor, requestNow, parseMobileSnapshotQuery(request.query as Record<string, unknown>));
  });

  app.post("/api/v1/mobile/devices", async (request, reply) => {
    const actor = requireActor(request, reply);
    if (!actor) {
      return reply;
    }
    const registration = normalizeMobileDeviceRegistration(request.body, actor, now());
    if (!registration) {
      return sendError(
        reply,
        400,
        "VALIDATION_ERROR",
        "Mobile device registration payload does not match contract.",
        correlationIdFrom(request.headers["x-correlation-id"])
      );
    }
    mobileDeviceRegistrations.set(`${actor.subjectId}:${registration.deviceId}`, registration);
    appendAudit(state, "MOBILE_DEVICE_REGISTERED", {
      actorAuthMode: actor.authMode,
      actorSubjectId: actor.subjectId,
      appVersion: registration.appVersion,
      capabilities: registration.capabilities,
      deviceId: registration.deviceId,
      platform: registration.platform,
      pushTokenRegistered: registration.pushTokenRegistered
    }, correlationIdFrom(request.headers["x-correlation-id"]));
    return reply.code(202).send({
      actor,
      device: registration,
      policy: mobileNativePolicy(),
      serverTimestamp: registration.registeredAt
    });
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

  app.get("/api/v1/flight-data/airports", async (request, reply) => {
    const requestNow = now();
    if (!flightDataSource?.fetchAirports) {
      return sendError(reply, 503, "SOURCE_UNAVAILABLE", "Flight airport reference source is disabled.", crypto.randomUUID());
    }
    const query = parseFlightAirportQuery(request.query as Record<string, unknown>);
    try {
      return {
        ...await flightDataSource.fetchAirports(query, requestNow),
        serverTimestamp: requestNow.toISOString()
      };
    } catch (error) {
      appendAudit(state, "FLIGHT_AIRPORTS_FAILED", {
        error: errorMessage(error),
        sourceSystemId: flightDataSource.sourceSystem.sourceSystemId
      });
      app.log.warn({ error }, "Flight airport reference request failed.");
      return sendError(reply, 502, "UPSTREAM_UNAVAILABLE", errorMessage(error), crypto.randomUUID());
    }
  });

  app.get("/api/v1/situation/layers", async () => {
    const requestNow = now();
    if (!situationDataSource) {
      return {
        items: [],
        serverTimestamp: requestNow.toISOString(),
        sourceStatus: "disabled",
        warnings: ["Situation data source is disabled."]
      };
    }

    try {
      const items = await situationDataSource.fetchLayers(requestNow);
      const health = buildSituationDataHealth(items, requestNow);
      state.sources.set(situationDataSource.sourceSystem.sourceSystemId, withSituationDataHealth(activeSituationDataSourceSystem(), health));
      return {
        items,
        serverTimestamp: requestNow.toISOString(),
        sourceHealth: health,
        sourceStatus: health.health
      };
    } catch (error) {
      const health = unavailableSituationDataHealth(error, requestNow);
      state.sources.set(situationDataSource.sourceSystem.sourceSystemId, withSituationDataHealth(activeSituationDataSourceSystem(), health));
      appendAudit(state, "SITUATION_DATA_LAYERS_FAILED", {
        error: errorMessage(error),
        sourceSystemId: situationDataSource.sourceSystem.sourceSystemId
      });
      app.log.warn({ error }, "Situation data layers request failed.");
      return {
        items: [],
        serverTimestamp: requestNow.toISOString(),
        sourceHealth: health,
        sourceStatus: health.health,
        warnings: [health.lastError ?? "Situation data layers are unavailable."]
      };
    }
  });

  app.get("/api/v1/situation/sources", async (request) => {
    const requestNow = now();
    const actor = actorFromRequest(request);
    if (!situationDataSource) {
      return {
        items: [],
        serverTimestamp: requestNow.toISOString(),
        sourceStatus: "disabled",
        warnings: ["Situation data source is disabled."]
      };
    }

    try {
      const items = filterSituationSourcesForActor(await situationDataSource.fetchSources(requestNow), actor);
      const health = buildSituationDataHealth(items.map((source) => ({
        defaultVisible: source.enabled === true,
        label: source.label ?? source.sourceId,
        layerId: source.layers?.[0] ?? "weather"
      })), requestNow);
      state.sources.set(situationDataSource.sourceSystem.sourceSystemId, withSituationDataHealth(activeSituationDataSourceSystem(), health));
      return {
        items,
        serverTimestamp: requestNow.toISOString(),
        sourceHealth: health,
        sourceStatus: health.health
      };
    } catch (error) {
      const health = unavailableSituationDataHealth(error, requestNow);
      state.sources.set(situationDataSource.sourceSystem.sourceSystemId, withSituationDataHealth(activeSituationDataSourceSystem(), health));
      appendAudit(state, "SITUATION_DATA_SOURCES_FAILED", {
        error: errorMessage(error),
        sourceSystemId: situationDataSource.sourceSystem.sourceSystemId
      });
      app.log.warn({ error }, "Situation data sources request failed.");
      return {
        items: [],
        serverTimestamp: requestNow.toISOString(),
        sourceHealth: health,
        sourceStatus: health.health,
        warnings: [health.lastError ?? "Situation data sources are unavailable."]
      };
    }
  });

  app.get("/api/v1/situation/features", async (request, reply) => {
    const requestNow = now();
    const actor = actorFromRequest(request);
    if (!situationDataSource) {
      const fallbackQuery = defaultSituationFeatureQuery();
      return {
        ...emptySituationFeatureCollection(fallbackQuery, requestNow, ["Situation data source is disabled."]),
        sourceHealth: {
          detail: "disabled",
          evaluatedAt: requestNow.toISOString(),
          health: "WAITING" as const,
          lastPollAt: requestNow.toISOString()
        }
      };
    }

    const query = parseSituationFeatureQuery(request.query as Record<string, unknown>, situationDataSource.config);
    if (!query) {
      return sendError(reply, 400, "VALIDATION_ERROR", "Situation feature query requires bbox=west,south,east,north.", crypto.randomUUID());
    }
    const sanitized = sanitizeSituationQueryForActor(query, actor);
    const sourceWarnings = sanitized.warnings;
    if (sanitized.blocked) {
      const collection = emptySituationFeatureCollection(sanitized.query, requestNow, sourceWarnings);
      const health = buildSituationDataHealth(collection, requestNow);
      return {
        ...collection,
        sourceHealth: health
      };
    }

    try {
      const collection = filterSituationCollectionForActor(await situationDataSource.fetchFeatures(sanitized.query, requestNow), actor, sourceWarnings);
      const health = buildSituationDataHealth(collection, requestNow);
      state.sources.set(situationDataSource.sourceSystem.sourceSystemId, withSituationDataHealth(activeSituationDataSourceSystem(), health));
      return {
        ...collection,
        sourceHealth: health
      };
    } catch (error) {
      const health = unavailableSituationDataHealth(error, requestNow);
      state.sources.set(situationDataSource.sourceSystem.sourceSystemId, withSituationDataHealth(activeSituationDataSourceSystem(), health));
      appendAudit(state, "SITUATION_DATA_FEATURES_FAILED", {
        error: errorMessage(error),
        sourceSystemId: situationDataSource.sourceSystem.sourceSystemId
      });
      app.log.warn({ error }, "Situation data features request failed.");
      return {
        ...emptySituationFeatureCollection(sanitized.query, requestNow, [health.lastError ?? "Situation data features are unavailable."]),
        sourceHealth: health
      };
    }
  });

  app.get("/api/v1/safety/layers", async () => {
    const requestNow = now();
    if (!safetyDataSource) {
      return {
        items: [],
        serverTimestamp: requestNow.toISOString(),
        sourceStatus: "disabled",
        warnings: ["Safety data source is disabled."]
      };
    }

    try {
      const items = await safetyDataSource.fetchLayers(requestNow);
      const health = buildSafetyDataHealth(items, requestNow);
      state.sources.set(safetyDataSource.sourceSystem.sourceSystemId, withSafetyDataHealth(activeSafetyDataSourceSystem(), health));
      return {
        items,
        serverTimestamp: requestNow.toISOString(),
        sourceHealth: health,
        sourceStatus: health.health
      };
    } catch (error) {
      const health = unavailableSafetyDataHealth(error, requestNow);
      state.sources.set(safetyDataSource.sourceSystem.sourceSystemId, withSafetyDataHealth(activeSafetyDataSourceSystem(), health));
      appendAudit(state, "SAFETY_DATA_LAYERS_FAILED", {
        error: errorMessage(error),
        sourceSystemId: safetyDataSource.sourceSystem.sourceSystemId
      });
      app.log.warn({ error }, "Safety data layers request failed.");
      return {
        items: [],
        serverTimestamp: requestNow.toISOString(),
        sourceHealth: health,
        sourceStatus: health.health,
        warnings: [health.lastError ?? "Safety data layers are unavailable."]
      };
    }
  });

  app.get("/api/v1/safety/sources", async () => {
    const requestNow = now();
    if (!safetyDataSource) {
      return {
        items: [],
        serverTimestamp: requestNow.toISOString(),
        sourceStatus: "disabled",
        warnings: ["Safety data source is disabled."]
      };
    }

    try {
      const items = await safetyDataSource.fetchSources(requestNow);
      const health = buildSafetyDataHealth(items, requestNow);
      state.sources.set(safetyDataSource.sourceSystem.sourceSystemId, withSafetyDataHealth(activeSafetyDataSourceSystem(), health));
      return {
        items,
        serverTimestamp: requestNow.toISOString(),
        sourceHealth: health,
        sourceStatus: health.health
      };
    } catch (error) {
      const health = unavailableSafetyDataHealth(error, requestNow);
      state.sources.set(safetyDataSource.sourceSystem.sourceSystemId, withSafetyDataHealth(activeSafetyDataSourceSystem(), health));
      appendAudit(state, "SAFETY_DATA_SOURCES_FAILED", {
        error: errorMessage(error),
        sourceSystemId: safetyDataSource.sourceSystem.sourceSystemId
      });
      app.log.warn({ error }, "Safety data sources request failed.");
      return {
        items: [],
        serverTimestamp: requestNow.toISOString(),
        sourceHealth: health,
        sourceStatus: health.health,
        warnings: [health.lastError ?? "Safety data sources are unavailable."]
      };
    }
  });

  app.get("/api/v1/safety/config", async () => {
    const requestNow = now();
    if (!safetyDataSource) {
      return {
        config: {},
        serverTimestamp: requestNow.toISOString(),
        sourceStatus: "disabled",
        warnings: ["Safety data source is disabled."]
      };
    }

    try {
      const config = await safetyDataSource.fetchConfig(requestNow);
      const health: SourceHealthOverride = {
        detail: "config available",
        evaluatedAt: requestNow.toISOString(),
        health: "ONLINE",
        lastPollAt: requestNow.toISOString(),
        lastSuccessAt: requestNow.toISOString()
      };
      state.sources.set(safetyDataSource.sourceSystem.sourceSystemId, withSafetyDataHealth(activeSafetyDataSourceSystem(), health));
      return {
        config,
        serverTimestamp: requestNow.toISOString(),
        sourceHealth: health,
        sourceStatus: health.health
      };
    } catch (error) {
      const health = unavailableSafetyDataHealth(error, requestNow);
      state.sources.set(safetyDataSource.sourceSystem.sourceSystemId, withSafetyDataHealth(activeSafetyDataSourceSystem(), health));
      appendAudit(state, "SAFETY_DATA_CONFIG_FAILED", {
        error: errorMessage(error),
        sourceSystemId: safetyDataSource.sourceSystem.sourceSystemId
      });
      app.log.warn({ error }, "Safety data config request failed.");
      return {
        config: {},
        serverTimestamp: requestNow.toISOString(),
        sourceHealth: health,
        sourceStatus: health.health,
        warnings: [health.lastError ?? "Safety data config is unavailable."]
      };
    }
  });

  app.get("/api/v1/safety/features", async (request, reply) => {
    const requestNow = now();
    if (!safetyDataSource) {
      const fallbackQuery = defaultSafetyFeatureQuery();
      return {
        ...emptySafetyFeatureCollection(fallbackQuery, requestNow, ["Safety data source is disabled."]),
        sourceHealth: {
          detail: "disabled",
          evaluatedAt: requestNow.toISOString(),
          health: "WAITING" as const,
          lastPollAt: requestNow.toISOString()
        }
      };
    }

    const query = parseSafetyFeatureQuery(request.query as Record<string, unknown>, safetyDataSource.config);
    if (!query) {
      return sendError(reply, 400, "VALIDATION_ERROR", "Safety feature query requires bbox=west,south,east,north.", crypto.randomUUID());
    }

    try {
      const collection = await safetyDataSource.fetchFeatures(query, requestNow);
      const health = buildSafetyDataHealth(collection, requestNow);
      state.sources.set(safetyDataSource.sourceSystem.sourceSystemId, withSafetyDataHealth(activeSafetyDataSourceSystem(), health));
      return {
        ...collection,
        sourceHealth: health
      };
    } catch (error) {
      const health = unavailableSafetyDataHealth(error, requestNow);
      state.sources.set(safetyDataSource.sourceSystem.sourceSystemId, withSafetyDataHealth(activeSafetyDataSourceSystem(), health));
      appendAudit(state, "SAFETY_DATA_FEATURES_FAILED", {
        error: errorMessage(error),
        sourceSystemId: safetyDataSource.sourceSystem.sourceSystemId
      });
      app.log.warn({ error }, "Safety data features request failed.");
      return {
        ...emptySafetyFeatureCollection(query, requestNow, [health.lastError ?? "Safety data features are unavailable."]),
        sourceHealth: health
      };
    }
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

function withFlightDataHealth(source: SourceSystem, health: SourceHealthOverride): SourceSystem {
  return {
    ...source,
    attributes: {
      ...source.attributes,
      sourceHealth: health,
      flightDataHealth: health
    },
    updatedAt: health.evaluatedAt
  };
}

function withSituationDataHealth(source: SourceSystem, health: SourceHealthOverride): SourceSystem {
  return {
    ...source,
    attributes: {
      ...source.attributes,
      sourceHealth: health,
      situationDataHealth: health
    },
    updatedAt: health.evaluatedAt
  };
}

function withSafetyDataHealth(source: SourceSystem, health: SourceHealthOverride): SourceSystem {
  return {
    ...source,
    attributes: {
      ...source.attributes,
      sourceHealth: health,
      safetyDataHealth: health
    },
    updatedAt: health.evaluatedAt
  };
}

function readFlightDataHealth(source: SourceSystem | undefined): SourceHealthOverride | undefined {
  return readSourceHealthFromAttributes(source?.attributes?.flightDataHealth);
}

function readSituationDataHealth(source: SourceSystem | undefined): SourceHealthOverride | undefined {
  return readSourceHealthFromAttributes(source?.attributes?.situationDataHealth ?? source?.attributes?.sourceHealth);
}

function readSafetyDataHealth(source: SourceSystem | undefined): SourceHealthOverride | undefined {
  return readSourceHealthFromAttributes(source?.attributes?.safetyDataHealth ?? source?.attributes?.sourceHealth);
}

function readSourceHealthFromAttributes(value: unknown): SourceHealthOverride | undefined {
  if (!isRecord(value) || !isSourceHealthOverride(value.health)) {
    return undefined;
  }
  return {
    detail: typeof value.detail === "string" ? value.detail : undefined,
    evaluatedAt: typeof value.evaluatedAt === "string" ? value.evaluatedAt : new Date().toISOString(),
    generatedAt: typeof value.generatedAt === "string" ? value.generatedAt : undefined,
    health: value.health,
    lastError: typeof value.lastError === "string" ? value.lastError : undefined,
    lastPollAt: typeof value.lastPollAt === "string" ? value.lastPollAt : undefined,
    lastSuccessAt: typeof value.lastSuccessAt === "string" ? value.lastSuccessAt : undefined,
    summary: isRecord(value.summary) ? value.summary : undefined,
    warnings: Array.isArray(value.warnings) ? value.warnings.filter((warning): warning is string => typeof warning === "string") : undefined
  };
}

function isSourceHealthOverride(value: unknown): value is SourceHealthOverride["health"] {
  return value === "DEGRADED" || value === "ONLINE" || value === "STALE" || value === "UNAVAILABLE" || value === "WAITING";
}

function defaultSituationFeatureQuery(): SituationFeatureQuery {
  return {
    bbox: {
      east: 15.35,
      north: 50.45,
      south: 49.65,
      west: 13.85
    },
    layers: ["weather"],
    limit: 250
  };
}

function parseFlightAirportQuery(value: Record<string, unknown>): FlightAirportQuery {
  return {
    ...(typeof value.bbox === "string" && value.bbox.trim() ? { bbox: value.bbox.trim() } : {}),
    limit: optionalFiniteNumber(value.limit, 1, 500) ?? 200,
    ...(typeof value.query === "string" && value.query.trim() ? { query: value.query.trim().slice(0, 80) } : {})
  };
}

function sanitizeSituationQueryForActor(query: SituationFeatureQuery, actor: AuthenticatedActor | null): { blocked: boolean; query: SituationFeatureQuery; warnings: string[] } {
  const sources = query.sources;
  if (!sources || sources.length === 0) {
    return { blocked: false, query, warnings: [] };
  }
  const allowedSources = sources.filter((sourceId) => canReadSituationSource(sourceId, actor));
  const blockedSources = sources.filter((sourceId) => !allowedSources.includes(sourceId));
  const warnings = blockedSources.length > 0
    ? [`Restricted situation source hidden: ${blockedSources.join(", ")}.`]
    : [];
  if (allowedSources.length === 0) {
    return {
      blocked: true,
      query: { ...query, sources: [] },
      warnings
    };
  }
  return {
    blocked: false,
    query: { ...query, sources: allowedSources },
    warnings
  };
}

function filterSituationCollectionForActor(
  collection: SituationFeatureCollection,
  actor: AuthenticatedActor | null,
  extraWarnings: string[] = []
): SituationFeatureCollection {
  const features = collection.features.filter((feature) => canReadSituationSource(feature.properties.sourceId, actor));
  const sources = filterSituationSourcesForActor(collection.sources, actor);
  const warnings = [...collection.warnings, ...extraWarnings];
  return {
    ...collection,
    features,
    sources,
    summary: {
      ...collection.summary,
      featureCount: features.length,
      sourceCount: sources.length,
      staleFeatureCount: features.filter((feature) => feature.properties.stale).length,
      warningCount: warnings.length
    },
    warnings
  };
}

function filterSituationSourcesForActor(sources: SituationSourceDescriptor[], actor: AuthenticatedActor | null): SituationSourceDescriptor[] {
  return sources.filter((source) => canReadSituationSource(source.sourceId, actor));
}

function canReadSituationSource(sourceId: string, actor: AuthenticatedActor | null): boolean {
  if (sourceId !== "ardos_partner") {
    return true;
  }
  if (process.env.COP_ARDOS_PARTNER_ENABLED !== "true") {
    return false;
  }
  if (!actor) {
    return false;
  }
  if (actor.authMode === "lab") {
    return true;
  }
  const requiredRole = process.env.COP_ARDOS_REQUIRED_ROLE?.trim();
  return requiredRole ? Boolean(actor.roles?.includes(requiredRole)) : true;
}

function defaultSafetyFeatureQuery(): SafetyFeatureQuery {
  return {
    bbox: {
      east: 15.35,
      north: 50.45,
      south: 49.65,
      west: 13.85
    },
    layers: ["warnings", "flood"],
    limit: 250
  };
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

function parseMobileSnapshotQuery(query: Record<string, unknown>): MobileSnapshotQuery {
  const historyQuery = parseTrackHistoryQuery(query);
  return {
    historyQuery: {
      ...historyQuery,
      seconds: historyQuery.seconds ?? 180
    },
    includeAcknowledged: query.includeAcknowledged === "true",
    includeExpired: query.includeExpired === "true"
  };
}

function createMobileSnapshotId(
  requestNow: Date,
  objects: ObservedObject[],
  alerts: CopAlert[],
  historyItems: Array<{ objectId: string; points: TrackHistoryPoint[] }>
): string {
  const payload = {
    alerts: alerts.map((alert) => [alert.alertId, alert.status, alert.updatedAt]),
    history: historyItems.map((item) => [item.objectId, item.points.at(-1)?.timestamp ?? null, item.points.length]),
    objects: objects.map((object) => [object.objectId, object.status, object.lastUpdatedAt ?? null]),
    serverTimestamp: requestNow.toISOString()
  };
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex").slice(0, 32);
}

function normalizeMobileDeviceRegistration(
  value: unknown,
  actor: AuthenticatedActor,
  registeredAt: Date
): MobileDeviceRegistration | null {
  if (!isRecord(value)) {
    return null;
  }
  const deviceId = optionalTrimmedString(value.deviceId, 160);
  const appVersion = optionalTrimmedString(value.appVersion, 40);
  const platform = isMobilePlatform(value.platform) ? value.platform : undefined;
  if (!deviceId || !appVersion || !platform) {
    return null;
  }
  const pushToken = optionalTrimmedString(value.pushToken, 4096);
  return {
    appVersion,
    ...(optionalTrimmedString(value.buildNumber, 40) ? { buildNumber: optionalTrimmedString(value.buildNumber, 40) } : {}),
    capabilities: normalizeStringList(value.capabilities, 16, 80),
    deviceId,
    ...(optionalTrimmedString(value.deviceModel, 80) ? { deviceModel: optionalTrimmedString(value.deviceModel, 80) } : {}),
    deviceSessionId: crypto.randomUUID(),
    ...(optionalTrimmedString(value.osVersion, 40) ? { osVersion: optionalTrimmedString(value.osVersion, 40) } : {}),
    platform,
    pushTokenRegistered: Boolean(pushToken),
    registeredAt: registeredAt.toISOString(),
    subjectId: actor.subjectId
  };
}

function mobileAuthConfig(env: Record<string, string | undefined> = process.env) {
  const issuer = env.COP_OIDC_ISSUER ?? "";
  return {
    clientId: env.COP_OIDC_CLIENT_ID ?? "cop-web",
    issuer: issuer || null,
    mode: env.COP_AUTH_MODE === "oidc" || env.COP_AUTH_MODE === "hybrid" ? env.COP_AUTH_MODE : "lab",
    redirectUriScheme: env.COP_MOBILE_REDIRECT_SCHEME ?? "cop",
    scope: env.COP_OIDC_SCOPE ?? "openid profile email"
  };
}

function mobileCapabilities() {
  return {
    alertAcknowledgement: true,
    aoiAlerts: true,
    bootstrap: true,
    deviceRegistration: true,
    offlineSnapshot: true,
    pushNotifications: false,
    safetyContext: true,
    serverUserProfile: true,
    situationContext: true,
    sseStream: true,
    trackHistory: true
  };
}

function mobileEndpoints() {
  return {
    acknowledgeAlert: "/api/v1/cop/alerts/{alertId}/acknowledge",
    alerts: "/api/v1/cop/alerts",
    bootstrap: "/api/v1/mobile/bootstrap",
    deviceRegistration: "/api/v1/mobile/devices",
    offlineSnapshot: "/api/v1/mobile/offline-snapshot",
    preferences: "/api/v1/me/preferences",
    sourceHealth: "/api/v1/sources/health",
    sources: "/api/v1/sources",
    safetyConfig: "/api/v1/safety/config",
    safetyFeatures: "/api/v1/safety/features",
    safetyLayers: "/api/v1/safety/layers",
    safetySources: "/api/v1/safety/sources",
    situationFeatures: "/api/v1/situation/features",
    situationLayers: "/api/v1/situation/layers",
    stream: "/api/v1/stream/cop/live",
    trackHistory: "/api/v1/cop/track-history",
    tracks: "/api/v1/cop/tracks"
  };
}

function mobileMapConfig(env: Record<string, string | undefined> = process.env) {
  return {
    attribution: env.COP_TILE_ATTRIBUTION ?? "&copy; OpenStreetMap contributors",
    defaultCenter: parseCoordinatePair(env.COP_MAP_CENTER, [14.42, 50.08]),
    defaultZoom: readPositiveNumber(env.COP_MAP_ZOOM, 8),
    tileTemplateUrl: env.COP_TILE_URL ?? "https://tile.openstreetmap.org/{z}/{x}/{y}.png"
  };
}

function mobileCachePolicy(env: Record<string, string | undefined> = process.env) {
  return {
    apiResponses: "network-only",
    maxHistoryPointsPerObject: readPositiveInteger(env.COP_MOBILE_MAX_HISTORY_POINTS, 120),
    maxHistorySeconds: readPositiveInteger(env.COP_MOBILE_MAX_HISTORY_SECONDS, 180),
    mode: "read-only",
    offlineCacheTtlSeconds: readPositiveInteger(env.COP_MOBILE_OFFLINE_CACHE_TTL_SECONDS, 900),
    recommendedStorage: "encrypted-device-storage"
  };
}

function mobileNativePolicy(env: Record<string, string | undefined> = process.env) {
  return {
    minimumAppVersion: env.COP_MOBILE_MINIMUM_APP_VERSION ?? "0.1.0",
    offlineCacheTtlSeconds: mobileCachePolicy(env).offlineCacheTtlSeconds,
    pushNotifications: "not_configured",
    requireBiometricUnlock: readBoolean(env.COP_MOBILE_REQUIRE_BIOMETRIC_UNLOCK, false),
    requireManagedDevice: readBoolean(env.COP_MOBILE_REQUIRE_MANAGED_DEVICE, false)
  };
}

function isMobilePlatform(value: unknown): value is MobilePlatform {
  return value === "ios" || value === "ipados";
}

function normalizeStringList(value: unknown, maxItems: number, maxLength: number): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .flatMap((item) => typeof item === "string" ? [item.trim().slice(0, maxLength)] : [])
    .filter(Boolean)
    .slice(0, maxItems);
}

function parseCoordinatePair(value: string | undefined, fallback: [number, number]): [number, number] {
  const [lonRaw, latRaw] = (value ?? "").split(",");
  const lon = Number(lonRaw);
  const lat = Number(latRaw);
  return Number.isFinite(lon) && Number.isFinite(lat) ? [clampNumber(lon, -180, 180), clampNumber(lat, -90, 90)] : fallback;
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
    mapClusterEnabled: optionalBoolean(value.mapClusterEnabled),
    mapView: normalizeMapViewPreference(value.mapView),
    minConfidence: optionalFiniteNumber(value.minConfidence, 0, 1),
    predictionMinutes: optionalFiniteNumber(value.predictionMinutes, 2, 20),
    predictionMode: optionalString(value.predictionMode, ["adaptive", "telemetry", "history", "maneuver"]),
    proximityAlertEnabled: optionalBoolean(value.proximityAlertEnabled),
    refreshSeconds: optionalFiniteNumber(value.refreshSeconds, 1, 60),
    selectedLayer: optionalString(value.selectedLayer, ["air-situation", "uav", "friendly", "foreign", "public-flights", "data-quality"]),
    showAlertAreas: optionalBoolean(value.showAlertAreas),
    showHistory: optionalBoolean(value.showHistory),
    showPrediction: optionalBoolean(value.showPrediction),
    safetyLayerIds: optionalStringArray(value.safetyLayerIds, ["warnings", "flood"]),
    situationLayerIds: optionalStringArray(value.situationLayerIds, ["weather", "ground", "mobile", "traffic", "air_quality"]),
    situationSourceIds: normalizeStringList(value.situationSourceIds, 32, 80),
    trackLayerIds: optionalStringArray(value.trackLayerIds, ["air-situation", "uav", "friendly", "foreign", "public-flights", "data-quality"]),
    trackHistoryLimit: optionalFiniteNumber(value.trackHistoryLimit, 1, 1000),
    trackHistoryWindowSeconds: optionalFiniteNumber(value.trackHistoryWindowSeconds, 1, 3600)
  });
}

function normalizeAlertPreferences(value: unknown): UserAlertPreferences {
  if (!isRecord(value)) {
    return {};
  }

  const aoiRules = Array.isArray(value.aoiRules) ? value.aoiRules.flatMap(normalizeAoiRule) : undefined;
  const enabledTypes = Array.isArray(value.enabledTypes) ? value.enabledTypes.filter(isCopAlertType) : undefined;
  const minimumSeverity = isCopAlertSeverity(value.minimumSeverity) ? value.minimumSeverity : undefined;
  return {
    ...(aoiRules && aoiRules.length > 0 ? { aoiRules } : {}),
    ...(enabledTypes && enabledTypes.length > 0 ? { enabledTypes } : {}),
    ...(minimumSeverity ? { minimumSeverity } : {})
  };
}

function normalizeAoiRule(value: unknown): AoiRule[] {
  if (!isRecord(value)) {
    return [];
  }
  const id = optionalTrimmedString(value.id, 80);
  const name = optionalTrimmedString(value.name, 120);
  const lat = optionalFiniteNumber(value.lat, -90, 90);
  const lon = optionalFiniteNumber(value.lon, -180, 180);
  const radiusKm = optionalFiniteNumber(value.radiusKm, 0.2, 500);
  const fillOpacity = optionalFiniteNumber(value.fillOpacity, 0.02, 0.35);
  if (!id || !name || lat === undefined || lon === undefined || radiusKm === undefined) {
    return [];
  }
  return [
    {
      ...(isAoiRuleAffiliationScope(value.affiliationScope) ? { affiliationScope: value.affiliationScope } : {}),
      ...(isHexColor(value.color) ? { color: value.color } : {}),
      enabled: value.enabled === true,
      ...(fillOpacity !== undefined ? { fillOpacity } : {}),
      id,
      lat,
      lon,
      name,
      radiusKm,
      ...(isCopAlertSeverity(value.severity) ? { severity: value.severity } : {})
    }
  ];
}

function isHexColor(value: unknown): value is string {
  return typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value);
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

function optionalStringArray(value: unknown, allowedValues: string[]): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const allowed = new Set(allowedValues);
  const normalized = value.filter((item): item is string => typeof item === "string" && allowed.has(item));
  return Array.from(new Set(normalized));
}

function optionalTrimmedString(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim();
  return normalized ? normalized.slice(0, maxLength) : undefined;
}

function isCopAlertType(value: unknown): value is CopAlert["type"] {
  return value === "AOI_ENTRY"
    || value === "LOW_CONFIDENCE"
    || value === "SOURCE_DEGRADED"
    || value === "TRACK_CONFLICT"
    || value === "TRACK_LOST"
    || value === "TRACK_STALE";
}

function isCopAlertSeverity(value: unknown): value is CopAlert["severity"] {
  return value === "info" || value === "warning" || value === "critical";
}

function isAoiRuleAffiliationScope(value: unknown): value is AoiRuleAffiliationScope {
  return value === "all" || value === "friend" || value === "hostile" || value === "unknown";
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

function readPositiveNumber(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function readBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) {
    return fallback;
  }
  return value === "true" || value === "1";
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
