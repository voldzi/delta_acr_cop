import cors from "@fastify/cors";
import sensible from "@fastify/sensible";
import websocket from "@fastify/websocket";
import { AiGateway } from "@cop/ai-gateway";
import { createCopObjectFromEvent, type CanonicalEventEnvelope, type ObservedObject, type SourceSystem } from "@cop/canonical-model";
import { ContractValidators, formatValidationErrors } from "@cop/ingest-contracts";
import { resolveSymbolFromRequest } from "@cop/nato-symbol-renderer";
import { defaultSystemSubject, evaluateReadPolicy } from "@cop/policy-engine";
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { buildCopAlerts, type AoiRule, type AoiRuleAffiliationScope, type CopAlert } from "./alerts.js";
import {
  createCommunityReportStoreFromEnv,
  InMemoryCommunityReportStore,
  type CommunityGroupMemberRole,
  type CommunityGroupMemberStatus,
  type CommunityGroupRecord,
  type CommunityGroupVisibility,
  type CommunityAttachmentKind,
  type CommunityLocationSource,
  type CommunityReportAttachmentRecord,
  type CommunityReportCategory,
  type CommunityReportLocation,
  type CommunityReportQuery,
  type CommunityReportRecord,
  type CommunityReportStatus,
  type CommunityReportStore,
  type CommunityReportVisibility
} from "./community-report-store.js";
import { correlationIdFrom, sendError } from "./errors.js";
import { CopStreamBroadcaster, type CopStreamMessage } from "./cop-stream.js";
import { buildConflictEvidenceIndex, withConflictEvidence, type ObjectConflictEvidence } from "./conflict-evidence.js";
import {
  createFlightDataSourceFromEnv,
  emptyFlightReferenceFeatureCollection,
  unavailableFlightDataHealth,
  type FlightAirportQuery,
  type FlightDataSource,
  type FlightReferenceFeatureCollection,
  type FlightReferenceFeatureQuery,
  type FlightReferenceLayerId
} from "./flight-data-source.js";
import { buildMapCatalog, type BuildMapCatalogInput, type MapCatalogLayer } from "./map-catalog.js";
import {
  buildMissionArenaHealth,
  createMissionArenaSourceFromEnv,
  emptyMissionArenaFeatureCollection,
  unavailableMissionArenaHealth,
  type MissionArenaFeatureCollection,
  type MissionArenaFeatureQuery,
  type MissionArenaLayerId,
  type MissionArenaSource
} from "./mission-arena-source.js";
import {
  createMediaConversionManagerFromEnv,
  readSpatialDerivative,
  type MediaConversionManager,
  type SpatialVideoDerivativeMetadata
} from "./media-conversion.js";
import { createMediaStorageFromEnv, type MediaStorage } from "./media-storage.js";
import {
  createMessagingProviderFromEnv,
  type MessagingConversationCreateRequest,
  type MessagingConversationMember,
  type MessagingMatrixRoomBindingRequest,
  type MessagingMapLink,
  type MessagingProvider
} from "./messaging-provider.js";
import { createPlaceGeocoderFromEnv, type PlaceGeocoder } from "./place-geocoder.js";
import { withEventProvenance } from "./provenance.js";
import { actorFromRequest, requireBearerToken, type AuthenticatedActor } from "./security.js";
import { buildSourceHealthItems } from "./source-health.js";
import {
  buildSituationDataHealth,
  createSituationDataSourceFromEnv,
  emptySituationFeatureCollection,
  unavailableSituationDataHealth,
  type SituationDataSource,
  type SituationFeature,
  type SituationFeatureCollection,
  type SituationFeatureQuery,
  type SituationLayerId,
  type SituationSourceDescriptor
} from "./situation-data-source.js";
import {
  buildSafetyDataHealth,
  createSafetyDataSourceFromEnv,
  emptySafetyFeatureCollection,
  unavailableSafetyDataHealth,
  type SafetyDataSource,
  type SafetyFeatureQuery,
  type SafetyLayerId
} from "./safety-data-source.js";
import {
  buildTakGatewayHealth,
  createTakGatewaySourceFromEnv,
  emptyTakGatewayFeatureCollection,
  unavailableTakGatewayHealth,
  type TakGatewayFeatureQuery,
  type TakGatewayLayerId,
  type TakGatewaySource
} from "./tak-gateway-source.js";
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
  communityReportStore?: CommunityReportStore;
  mediaStorage?: MediaStorage;
  messagingProvider?: MessagingProvider;
  missionArenaSource?: MissionArenaSource;
  placeGeocoder?: PlaceGeocoder;
  safetyDataSource?: SafetyDataSource;
  situationDataSource?: SituationDataSource;
  takGatewaySource?: TakGatewaySource;
  state?: CopState;
  logger?: boolean;
  now?: () => Date;
  trackHistoryStore?: TrackHistoryStore;
  trackLifecycle?: TrackLifecycleConfig;
  streamBroadcaster?: CopStreamBroadcaster;
  userProfileStore?: UserProfileStore;
}

type DependencyStatus = "disabled" | "degraded" | "ok";
type CommunityReportHazardSeverity = "advisory" | "warning" | "critical";
type MobilePlatform = "ios" | "ipados";

type CommunityAttachmentResponse = CommunityReportAttachmentRecord & {
  contentUrl?: string;
  derivatives?: CommunityAttachmentDerivativeResponse[];
};

interface CommunityAttachmentDerivativeResponse {
  byteSize?: number;
  contentType?: string;
  contentUrl?: string;
  derivativeId: "xr-sbs";
  error?: string;
  kind: "video";
  layout: "side_by_side";
  status: SpatialVideoDerivativeMetadata["status"];
  updatedAt: string;
}

type CommunityReportResponse = CommunityReportRecord & {
  attachments: CommunityAttachmentResponse[];
};

interface CommunityMediaTicketPayload {
  attachmentId: string;
  derivativeId?: string;
  exp: number;
  reportId: string;
  sub?: string;
  v: 1;
}

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
  const maxCommunityAttachmentBytes = readPositiveInteger(process.env.COP_MEDIA_MAX_ATTACHMENT_BYTES, 25 * 1024 * 1024);
  const app = Fastify({
    bodyLimit: readPositiveInteger(process.env.COP_API_BODY_LIMIT_BYTES, Math.max(1024 * 1024, maxCommunityAttachmentBytes * 2)),
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
  const communityReportStore = options.communityReportStore ?? createCommunityReportStoreFromEnv();
  const communityReportFallbackStore = new InMemoryCommunityReportStore("memory-fallback");
  const mediaStorage = options.mediaStorage ?? createMediaStorageFromEnv();
  const mediaConversionManager: MediaConversionManager | undefined = createMediaConversionManagerFromEnv({
    logger: app.log,
    mediaStorage,
    updateAttachmentMetadata: updateCommunityAttachmentMetadata
  });
  const messagingProvider = options.messagingProvider ?? createMessagingProviderFromEnv();
  const missionArenaSource = options.missionArenaSource ?? createMissionArenaSourceFromEnv();
  const placeGeocoder = options.placeGeocoder ?? createPlaceGeocoderFromEnv();
  const flightDataSource = options.flightDataSource ?? createFlightDataSourceFromEnv();
  const safetyDataSource = options.safetyDataSource ?? createSafetyDataSourceFromEnv();
  const situationDataSource = options.situationDataSource ?? createSituationDataSourceFromEnv();
  const takGatewaySource = options.takGatewaySource ?? createTakGatewaySourceFromEnv();
  const mobileDeviceRegistrations = new Map<string, MobileDeviceRegistration>();
  let trackHistoryStoreStatus: DependencyStatus = trackHistoryStore ? "degraded" : "disabled";
  let trackHistoryStoreDetail = trackHistoryStore ? `${trackHistoryStore.name}: initializing` : "in-memory only";
  let userProfileStoreStatus: DependencyStatus = "degraded";
  let userProfileStoreDetail = `${userProfileStore.name}: initializing`;
  let communityReportStoreStatus: DependencyStatus = communityReportStore ? "degraded" : "disabled";
  let communityReportStoreDetail = communityReportStore ? `${communityReportStore.name}: initializing` : "disabled";
  let mediaStorageStatus: DependencyStatus = mediaStorage ? "degraded" : "disabled";
  let mediaStorageDetail = mediaStorage ? `${mediaStorage.name}: initializing` : "disabled";
  let restoredCurrentTrackCount = 0;
  let flightDataPollTimer: ReturnType<typeof setInterval> | undefined;
  let trackPersistenceFlushTimer: ReturnType<typeof setTimeout> | undefined;
  let trackPersistenceFlushInFlight = false;
  let droppedTrackHistoryPoints = 0;
  const trackPersistenceBatchSize = readPositiveInteger(process.env.COP_INGEST_PERSISTENCE_BATCH_SIZE, 250);
  const trackPersistenceFlushMs = readPositiveInteger(process.env.COP_INGEST_PERSISTENCE_FLUSH_MS, 100);
  const maxQueuedTrackHistoryPoints = readPositiveInteger(process.env.COP_INGEST_PERSISTENCE_MAX_HISTORY_QUEUE, 20000);
  const pendingCurrentTrackPersistence = new Map<string, { event: CanonicalEventEnvelope; object: ObservedObject }>();
  const pendingTrackHistoryPersistence: TrackHistoryPoint[] = [];

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
  if (takGatewaySource) {
    state.sources.set(takGatewaySource.sourceSystem.sourceSystemId, takGatewaySource.sourceSystem);
  }
  if (missionArenaSource) {
    state.sources.set(missionArenaSource.sourceSystem.sourceSystemId, missionArenaSource.sourceSystem);
  }
  void app.register(cors, { origin: true });
  void app.register(sensible);
  void app.register(websocket);
  app.addContentTypeParser(
    /^(?:image\/.+|video\/.+|application\/pdf|application\/octet-stream)(?:;.*)?$/iu,
    { bodyLimit: maxCommunityAttachmentBytes, parseAs: "buffer" },
    (_request, body, done) => {
      done(null, body);
    }
  );
  app.addHook("preHandler", requireBearerToken);
  app.addHook("onReady", async () => {
    await initializeUserProfileStore();
    await initializeCommunityReportStore();
    await initializeMediaStorage();
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
    if (trackPersistenceFlushTimer) {
      clearTimeout(trackPersistenceFlushTimer);
      trackPersistenceFlushTimer = undefined;
    }
    if (!trackPersistenceFlushInFlight) {
      await flushQueuedTrackPersistence();
    }
    await trackHistoryStore?.close();
    await userProfileStore.close();
    await userProfileFallbackStore.close();
    await communityReportStore?.close();
    await communityReportFallbackStore.close();
    mediaConversionManager?.close();
    await mediaStorage?.close();
  });

  app.get("/health/live", async () => ({
    status: "ok",
    timestamp: new Date().toISOString()
  }));

  app.get("/health/ready", async () => ({
    status: "ok",
    timestamp: new Date().toISOString()
  }));

  app.get("/health/dependencies", async () => {
    const messaging = await withDependencyTimeout(
      "csm-messaging-provider",
      messagingDependency(),
      {
        detail: `Messaging provider dependency check timed out after ${healthDependencyTimeoutMs()} ms.`,
        name: "csm-messaging-provider",
        status: "degraded"
      }
    );
    return {
      status: "ok",
      dependencies: [
      { name: "source-registry", status: "ok" },
      { name: "in-memory-cop-state", status: "ok" },
      { name: "track-history-store", status: trackHistoryStoreStatus, detail: trackHistoryStoreDependencyDetail() },
      { name: "user-profile-store", status: userProfileStoreStatus, detail: userProfileStoreDependencyDetail() },
      { name: "community-report-store", status: communityReportStoreStatus, detail: communityReportStoreDependencyDetail() },
      { name: "media-storage", status: mediaStorageStatus, detail: mediaStorageDependencyDetail() },
      { name: "place-geocoder", status: placeGeocoder ? "ok" : "disabled", detail: placeGeocoder?.diagnostics?.() ?? "disabled" },
      messaging,
      ...(flightDataSource ? [flightDataDependency()] : []),
      ...(situationDataSource ? [situationDataDependency()] : []),
      ...(safetyDataSource ? [safetyDataDependency()] : []),
      ...(missionArenaSource ? [missionArenaDependency()] : []),
      ...(takGatewaySource ? [takGatewayDependency()] : []),
      { name: "ai-gateway", status: "degraded", detail: "mock provider only" }
    ]
    };
  });

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
      ...safetyDataCacheMetricLines(),
      ...takGatewayCacheMetricLines()
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

  async function initializeCommunityReportStore(): Promise<void> {
    if (!communityReportStore) {
      await communityReportFallbackStore.init();
      return;
    }
    try {
      await communityReportStore.init();
      communityReportStoreStatus = "ok";
      communityReportStoreDetail = `${communityReportStore.name}: ready`;
    } catch (error) {
      communityReportStoreStatus = "degraded";
      communityReportStoreDetail = `${communityReportStore.name}: ${errorMessage(error)}`;
      await communityReportFallbackStore.init();
      app.log.error({ error }, "Community report store initialization failed; using in-memory fallback.");
    }
  }

  async function initializeMediaStorage(): Promise<void> {
    if (!mediaStorage) {
      return;
    }
    try {
      await mediaStorage.init();
      mediaStorageStatus = "ok";
      mediaStorageDetail = `${mediaStorage.name}: ready`;
    } catch (error) {
      mediaStorageStatus = "degraded";
      mediaStorageDetail = `${mediaStorage.name}: ${errorMessage(error)}`;
      app.log.error({ error }, "Media storage initialization failed; attachment uploads are unavailable.");
    }
  }

  async function countTrackHistoryPoints(): Promise<number> {
    await flushQueuedTrackPersistence();
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
    await flushQueuedTrackPersistence();
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

  function markCommunityReportStoreDegraded(error: unknown): void {
    if (!communityReportStore) {
      return;
    }
    communityReportStoreStatus = "degraded";
    communityReportStoreDetail = `${communityReportStore.name}: ${errorMessage(error)}`;
    app.log.error({ error }, "Community report store failed; using in-memory fallback.");
  }

  function communityReportStoreDependencyDetail(): string {
    const diagnostics = communityReportStore?.diagnostics?.();
    return diagnostics ? `${communityReportStoreDetail}; ${diagnostics}` : communityReportStoreDetail;
  }

  function mediaStorageDependencyDetail(): string {
    const diagnostics = mediaStorage?.diagnostics?.();
    return diagnostics ? `${mediaStorageDetail}; ${diagnostics}` : mediaStorageDetail;
  }

  async function messagingDependency(): Promise<{ detail: string; name: string; status: DependencyStatus }> {
    const status = await messagingProvider.fetchStatus(now());
    return {
      detail: status.detail ?? status.warnings[0] ?? status.status,
      name: "csm-messaging-provider",
      status: status.status === "online" ? "ok" : status.status === "disabled" ? "disabled" : "degraded"
    };
  }

  function withDependencyTimeout<T extends { detail?: string; name: string; status: DependencyStatus }>(
    dependencyName: string,
    operation: Promise<T>,
    fallback: T
  ): Promise<T> {
    const timeoutMs = healthDependencyTimeoutMs();
    return new Promise<T>((resolve) => {
      let settled = false;
      const timeout = setTimeout(() => {
        if (settled) {
          return;
        }
        settled = true;
        app.log.warn({ dependencyName, timeoutMs }, "Health dependency check timed out.");
        resolve(fallback);
      }, timeoutMs);

      operation.then(
        (value) => {
          if (settled) {
            return;
          }
          settled = true;
          clearTimeout(timeout);
          resolve(value);
        },
        (error) => {
          if (settled) {
            return;
          }
          settled = true;
          clearTimeout(timeout);
          app.log.warn({ dependencyName, error }, "Health dependency check rejected.");
          resolve({
            ...fallback,
            detail: `${fallback.detail ?? "Dependency check failed"} ${errorMessage(error)}`
          });
        }
      );
    });
  }

  function activeUserProfileStore(): UserProfileStore {
    return userProfileStoreStatus === "ok" ? userProfileStore : userProfileFallbackStore;
  }

  function activeCommunityReportStore(): CommunityReportStore {
    return communityReportStore && communityReportStoreStatus === "ok" ? communityReportStore : communityReportFallbackStore;
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
        queueTrackPersistence(accepted.object, accepted.accepted, accepted.historyPoint);
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

  function takGatewayDependency(): { detail: string; name: string; status: DependencyStatus } {
    if (!takGatewaySource) {
      return { detail: "disabled", name: "tak-gateway-source", status: "disabled" };
    }
    const health = readTakGatewayHealth(state.sources.get(takGatewaySource.sourceSystem.sourceSystemId));
    if (!health) {
      return { detail: "waiting for first request", name: "tak-gateway-source", status: "degraded" };
    }
    return {
      detail: health.detail ?? health.lastError ?? health.health.toLowerCase(),
      name: "tak-gateway-source",
      status: health.health === "ONLINE" ? "ok" : "degraded"
    };
  }

  function takGatewayCacheMetricLines(): string[] {
    const cache = takGatewaySource?.cacheStats?.();
    if (!cache) {
      return [];
    }
    return [
      "# HELP cop_tak_gateway_cache_entries Cached TAK Gateway viewport entries.",
      "# TYPE cop_tak_gateway_cache_entries gauge",
      `cop_tak_gateway_cache_entries ${cache.entries}`,
      "# HELP cop_tak_gateway_cache_inflight In-flight TAK Gateway cache refreshes.",
      "# TYPE cop_tak_gateway_cache_inflight gauge",
      `cop_tak_gateway_cache_inflight ${cache.inflight}`,
      "# HELP cop_tak_gateway_cache_requests_total TAK Gateway cache requests by result.",
      "# TYPE cop_tak_gateway_cache_requests_total counter",
      `cop_tak_gateway_cache_requests_total{result="hit"} ${cache.hits}`,
      `cop_tak_gateway_cache_requests_total{result="miss"} ${cache.misses}`,
      `cop_tak_gateway_cache_requests_total{result="coalesced"} ${cache.coalescedHits}`,
      `cop_tak_gateway_cache_requests_total{result="stale"} ${cache.staleHits}`,
      "# HELP cop_tak_gateway_cache_refreshes_total TAK Gateway upstream refreshes completed by COP.",
      "# TYPE cop_tak_gateway_cache_refreshes_total counter",
      `cop_tak_gateway_cache_refreshes_total ${cache.refreshes}`,
      "# HELP cop_tak_gateway_cache_errors_total TAK Gateway upstream refresh errors observed by COP.",
      "# TYPE cop_tak_gateway_cache_errors_total counter",
      `cop_tak_gateway_cache_errors_total ${cache.errors}`,
      "# HELP cop_tak_gateway_cache_evictions_total TAK Gateway cache evictions.",
      "# TYPE cop_tak_gateway_cache_evictions_total counter",
      `cop_tak_gateway_cache_evictions_total ${cache.evictions}`
    ];
  }

  function activeTakGatewaySourceSystem(): SourceSystem {
    if (!takGatewaySource) {
      throw new Error("TAK Gateway source is not enabled.");
    }
    return state.sources.get(takGatewaySource.sourceSystem.sourceSystemId) ?? takGatewaySource.sourceSystem;
  }

  function missionArenaDependency(): { detail: string; name: string; status: DependencyStatus } {
    if (!missionArenaSource) {
      return { detail: "disabled", name: "mission-arena-source", status: "disabled" };
    }
    const health = readMissionArenaHealth(state.sources.get(missionArenaSource.sourceSystem.sourceSystemId));
    if (!health) {
      return { detail: "waiting for first request", name: "mission-arena-source", status: "degraded" };
    }
    return {
      detail: health.detail ?? health.lastError ?? health.health.toLowerCase(),
      name: "mission-arena-source",
      status: health.health === "ONLINE" ? "ok" : "degraded"
    };
  }

  function activeMissionArenaSourceSystem(): SourceSystem {
    if (!missionArenaSource) {
      throw new Error("Mission Arena source is not enabled.");
    }
    return state.sources.get(missionArenaSource.sourceSystem.sourceSystemId) ?? missionArenaSource.sourceSystem;
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

  async function createCommunityReport(input: Parameters<CommunityReportStore["createReport"]>[0], requestNow: Date): Promise<CommunityReportRecord> {
    try {
      return await activeCommunityReportStore().createReport(input, requestNow);
    } catch (error) {
      markCommunityReportStoreDegraded(error);
      return communityReportFallbackStore.createReport(input, requestNow);
    }
  }

  async function readCommunityReport(reportId: string): Promise<CommunityReportRecord | null> {
    try {
      return await activeCommunityReportStore().getReport(reportId);
    } catch (error) {
      markCommunityReportStoreDegraded(error);
      return communityReportFallbackStore.getReport(reportId);
    }
  }

  async function listCommunityReports(query: CommunityReportQuery): Promise<CommunityReportRecord[]> {
    try {
      return await activeCommunityReportStore().listReports(query);
    } catch (error) {
      markCommunityReportStoreDegraded(error);
      return communityReportFallbackStore.listReports(query);
    }
  }

  async function submitCommunityReport(reportId: string, actor: AuthenticatedActor, requestNow: Date): Promise<CommunityReportRecord | null> {
    try {
      return await activeCommunityReportStore().submitReport(reportId, actor.subjectId, requestNow);
    } catch (error) {
      markCommunityReportStoreDegraded(error);
      return communityReportFallbackStore.submitReport(reportId, actor.subjectId, requestNow);
    }
  }

  async function updateCommunityReport(reportId: string, actor: AuthenticatedActor, input: Parameters<CommunityReportStore["updateReport"]>[2], requestNow: Date): Promise<CommunityReportRecord | null> {
    try {
      return await activeCommunityReportStore().updateReport(reportId, actor.subjectId, input, requestNow);
    } catch (error) {
      markCommunityReportStoreDegraded(error);
      return communityReportFallbackStore.updateReport(reportId, actor.subjectId, input, requestNow);
    }
  }

  async function deleteCommunityReport(reportId: string, actor: AuthenticatedActor, requestNow: Date): Promise<boolean> {
    try {
      return await activeCommunityReportStore().deleteReport(reportId, actor.subjectId, requestNow);
    } catch (error) {
      markCommunityReportStoreDegraded(error);
      return communityReportFallbackStore.deleteReport(reportId, actor.subjectId, requestNow);
    }
  }

  async function createCommunityAttachment(input: Parameters<CommunityReportStore["createAttachment"]>[0]) {
    try {
      return await activeCommunityReportStore().createAttachment(input);
    } catch (error) {
      markCommunityReportStoreDegraded(error);
      return communityReportFallbackStore.createAttachment(input);
    }
  }

  async function completeCommunityAttachment(input: Parameters<CommunityReportStore["completeAttachment"]>[0]) {
    try {
      return await activeCommunityReportStore().completeAttachment(input);
    } catch (error) {
      markCommunityReportStoreDegraded(error);
      return communityReportFallbackStore.completeAttachment(input);
    }
  }

  async function updateCommunityAttachmentMetadata(input: Parameters<CommunityReportStore["updateAttachmentMetadata"]>[0]) {
    try {
      return await activeCommunityReportStore().updateAttachmentMetadata(input);
    } catch (error) {
      markCommunityReportStoreDegraded(error);
      return communityReportFallbackStore.updateAttachmentMetadata(input);
    }
  }

  async function enqueueSpatialVideoConversion(reportId: string, attachment: CommunityReportAttachmentRecord, requestNow: Date): Promise<CommunityReportAttachmentRecord> {
    if (!mediaConversionManager) {
      return attachment;
    }
    try {
      return await mediaConversionManager.enqueueAttachment({
        attachment,
        reportId,
        requestNow
      });
    } catch (error) {
      app.log.error({ error, attachmentId: attachment.attachmentId, reportId }, "Spatial video conversion enqueue failed.");
      return attachment;
    }
  }

  async function createCommunityGroup(input: Parameters<CommunityReportStore["createGroup"]>[0], requestNow: Date) {
    try {
      return await activeCommunityReportStore().createGroup(input, requestNow);
    } catch (error) {
      markCommunityReportStoreDegraded(error);
      return communityReportFallbackStore.createGroup(input, requestNow);
    }
  }

  async function readCommunityGroup(groupId: string) {
    try {
      return await activeCommunityReportStore().getGroup(groupId);
    } catch (error) {
      markCommunityReportStoreDegraded(error);
      return communityReportFallbackStore.getGroup(groupId);
    }
  }

  async function listCommunityGroups(query: Parameters<CommunityReportStore["listGroups"]>[0]) {
    try {
      return await activeCommunityReportStore().listGroups(query);
    } catch (error) {
      markCommunityReportStoreDegraded(error);
      return communityReportFallbackStore.listGroups(query);
    }
  }

  async function requestCommunityGroupMembership(groupId: string, actor: AuthenticatedActor, requestNow: Date) {
    try {
      return await activeCommunityReportStore().requestGroupMembership(groupId, actorToCommunityActor(actor), requestNow);
    } catch (error) {
      markCommunityReportStoreDegraded(error);
      return communityReportFallbackStore.requestGroupMembership(groupId, actorToCommunityActor(actor), requestNow);
    }
  }

  async function upsertCommunityGroupMember(input: Parameters<CommunityReportStore["upsertGroupMember"]>[0], requestNow: Date) {
    try {
      return await activeCommunityReportStore().upsertGroupMember(input, requestNow);
    } catch (error) {
      markCommunityReportStoreDegraded(error);
      return communityReportFallbackStore.upsertGroupMember(input, requestNow);
    }
  }

  async function readCommunityActorGroupIds(actor: AuthenticatedActor | null): Promise<Set<string>> {
    if (!actor) {
      return new Set();
    }
    const groups = await listCommunityGroups({
      subjectId: actor.subjectId
    });
    return new Set(groups.flatMap((group) =>
      group.members.some((member) => member.subjectId === actor.subjectId && member.status === "active")
        ? [group.groupId]
        : []
    ));
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

  function queueTrackPersistence(
    object: ObservedObject,
    event: CanonicalEventEnvelope,
    historyPoint: TrackHistoryPoint | undefined
  ): void {
    if (!trackHistoryStore || trackHistoryStoreStatus !== "ok") {
      return;
    }
    pendingCurrentTrackPersistence.set(object.objectId, { event, object });
    if (historyPoint) {
      pendingTrackHistoryPersistence.push(historyPoint);
      const overflow = pendingTrackHistoryPersistence.length - maxQueuedTrackHistoryPoints;
      if (overflow > 0) {
        pendingTrackHistoryPersistence.splice(0, overflow);
        droppedTrackHistoryPoints += overflow;
        app.log.warn(
          { droppedTrackHistoryPoints, overflow, queueSize: pendingTrackHistoryPersistence.length },
          "Dropped oldest queued track history points because ingest persistence queue is full."
        );
      }
    }
    scheduleTrackPersistenceFlush();
  }

  function scheduleTrackPersistenceFlush(delayMs = trackPersistenceFlushMs): void {
    if (trackPersistenceFlushTimer) {
      return;
    }
    trackPersistenceFlushTimer = setTimeout(() => {
      trackPersistenceFlushTimer = undefined;
      void flushQueuedTrackPersistence();
    }, delayMs);
    trackPersistenceFlushTimer.unref?.();
  }

  async function flushQueuedTrackPersistence(): Promise<void> {
    if (trackPersistenceFlushInFlight) {
      scheduleTrackPersistenceFlush();
      return;
    }
    trackPersistenceFlushInFlight = true;
    try {
      while (pendingCurrentTrackPersistence.size > 0 || pendingTrackHistoryPersistence.length > 0) {
        const currentBatch = takeQueuedCurrentTrackPersistence(trackPersistenceBatchSize);
        const historyBatch = pendingTrackHistoryPersistence.splice(0, trackPersistenceBatchSize);
        const results = await Promise.allSettled([
          ...currentBatch.map(({ event, object }) => persistCurrentTrack(object, event)),
          ...historyBatch.map((point) => persistTrackHistoryPoint(point))
        ]);
        const rejected = results.filter((result) => result.status === "rejected").length;
        if (rejected > 0) {
          app.log.warn({ rejected }, "Queued track persistence operations failed.");
        }
      }
    } finally {
      trackPersistenceFlushInFlight = false;
      if (pendingCurrentTrackPersistence.size > 0 || pendingTrackHistoryPersistence.length > 0) {
        scheduleTrackPersistenceFlush();
      }
    }
  }

  function takeQueuedCurrentTrackPersistence(limit: number): Array<{ event: CanonicalEventEnvelope; object: ObservedObject }> {
    const batch: Array<{ event: CanonicalEventEnvelope; object: ObservedObject }> = [];
    for (const [objectId, value] of pendingCurrentTrackPersistence.entries()) {
      batch.push(value);
      pendingCurrentTrackPersistence.delete(objectId);
      if (batch.length >= limit) {
        break;
      }
    }
    return batch;
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
    await flushQueuedTrackPersistence();
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

  app.get("/api/v1/messaging/status", async () => {
    return messagingProvider.fetchStatus(now());
  });

  app.post("/api/v1/messaging/bootstrap", async (request, reply) => {
    const actor = requireActor(request, reply);
    if (!actor) {
      return reply;
    }

    const body = isRecord(request.body) ? request.body : {};
    const deviceId = normalizeMatrixDeviceId(body.deviceId);
    if (body.deviceId !== undefined && !deviceId) {
      return sendError(
        reply,
        400,
        "VALIDATION_ERROR",
        "Matrix deviceId may contain only A-Z, a-z, 0-9, dot, underscore, equals and dash, with max length 64.",
        correlationIdFrom(request.headers["x-correlation-id"])
      );
    }
    return messagingProvider.fetchMatrixBootstrap(actor, now(), deviceId);
  });

  app.get("/api/v1/messaging/conversations", async (request, reply) => {
    const actor = requireActor(request, reply);
    if (!actor) {
      return reply;
    }

    return messagingProvider.fetchConversations(actor, now());
  });

  app.post("/api/v1/messaging/conversations", async (request, reply) => {
    const actor = requireActor(request, reply);
    if (!actor) {
      return reply;
    }

    const conversationRequest = normalizeMessagingConversationCreateRequest(request.body);
    if (!conversationRequest) {
      return sendError(
        reply,
        400,
        "VALIDATION_ERROR",
        "Messaging conversation requires a title and may not contain plaintext message fields.",
        correlationIdFrom(request.headers["x-correlation-id"])
      );
    }
    const result = await messagingProvider.createConversation(actor, now(), conversationRequest);
    return reply.code(result.conversation ? 201 : 502).send(result);
  });

  app.post("/api/v1/messaging/matrix/identities/resolve", async (request, reply) => {
    const actor = requireActor(request, reply);
    if (!actor) {
      return reply;
    }
    const userIds = normalizeMatrixIdentityResolutionRequest(request.body);
    if (!userIds) {
      return sendError(
        reply,
        400,
        "VALIDATION_ERROR",
        "Identity resolution requires userIds as a non-empty array of CSM user identifiers.",
        correlationIdFrom(request.headers["x-correlation-id"])
      );
    }
    return messagingProvider.resolveMatrixIdentities(actor, now(), userIds);
  });

  app.post("/api/v1/messaging/conversations/:conversationId/members", async (request, reply) => {
    const actor = requireActor(request, reply);
    if (!actor) {
      return reply;
    }
    const params = request.params as { conversationId: string };
    const members = normalizeMessagingConversationMembersRequest(request.body);
    if (!members) {
      return sendError(
        reply,
        400,
        "VALIDATION_ERROR",
        "Messaging conversation member sync requires members[] and may not contain plaintext message fields.",
        correlationIdFrom(request.headers["x-correlation-id"])
      );
    }
    const result = await messagingProvider.addConversationMembers(actor, now(), params.conversationId, members);
    return reply.code(result.conversation ? 200 : 502).send(result);
  });

  app.post("/api/v1/messaging/conversations/:conversationId/matrix-room", async (request, reply) => {
    const actor = requireActor(request, reply);
    if (!actor) {
      return reply;
    }
    const params = request.params as { conversationId: string };
    const binding = normalizeMatrixRoomBindingRequest(request.body);
    if (!binding) {
      return sendError(
        reply,
        400,
        "VALIDATION_ERROR",
        "Matrix room binding requires a roomId and may not contain message content.",
        correlationIdFrom(request.headers["x-correlation-id"])
      );
    }
    const result = await messagingProvider.bindMatrixRoom(actor, now(), params.conversationId, binding);
    return reply.code(result.conversation ? 200 : 502).send(result);
  });

  app.get("/api/v1/community/groups", async (request, reply) => {
    const actor = requireActor(request, reply);
    if (!actor) {
      return reply;
    }
    const requestNow = now();
    const groups = await listCommunityGroups({
      includePublic: true,
      subjectId: actor.subjectId
    });
    return {
      items: groups,
      serverTimestamp: requestNow.toISOString()
    };
  });

  app.post("/api/v1/community/groups", async (request, reply) => {
    const actor = requireActor(request, reply);
    if (!actor) {
      return reply;
    }
    const groupRequest = normalizeCommunityGroupRequest(request.body);
    if (!groupRequest) {
      return sendError(
        reply,
        400,
        "VALIDATION_ERROR",
        "Community group requires a name.",
        correlationIdFrom(request.headers["x-correlation-id"])
      );
    }
    const requestNow = now();
    const group = await createCommunityGroup({
      anchorLocation: groupRequest.anchorLocation,
      createdBy: actorToCommunityActor(actor),
      description: groupRequest.description,
      metadata: groupRequest.metadata,
      name: groupRequest.name,
      visibility: groupRequest.visibility
    }, requestNow);
    appendAudit(state, "COMMUNITY_GROUP_CREATED", {
      actorAuthMode: actor.authMode,
      actorSubjectId: actor.subjectId,
      groupId: group.groupId,
      visibility: group.visibility
    }, correlationIdFrom(request.headers["x-correlation-id"]));
    return reply.code(201).send(group);
  });

  app.get("/api/v1/community/groups/:groupId", async (request, reply) => {
    const actor = requireActor(request, reply);
    if (!actor) {
      return reply;
    }
    const params = request.params as { groupId: string };
    const group = await readCommunityGroup(params.groupId);
    if (!group || !canReadCommunityGroup(group, actor)) {
      return sendError(reply, 404, "NOT_FOUND", "Community group was not found.", crypto.randomUUID());
    }
    return group;
  });

  app.post("/api/v1/community/groups/:groupId/join-request", async (request, reply) => {
    const actor = requireActor(request, reply);
    if (!actor) {
      return reply;
    }
    const params = request.params as { groupId: string };
    const requestNow = now();
    const group = await requestCommunityGroupMembership(params.groupId, actor, requestNow);
    if (!group) {
      return sendError(reply, 404, "NOT_FOUND", "Community group was not found.", crypto.randomUUID());
    }
    appendAudit(state, "COMMUNITY_GROUP_JOIN_REQUESTED", {
      actorAuthMode: actor.authMode,
      actorSubjectId: actor.subjectId,
      groupId: group.groupId
    }, correlationIdFrom(request.headers["x-correlation-id"]));
    return group;
  });

  app.post("/api/v1/community/groups/:groupId/members", async (request, reply) => {
    const actor = requireActor(request, reply);
    if (!actor) {
      return reply;
    }
    const params = request.params as { groupId: string };
    const memberRequest = normalizeCommunityGroupMemberRequest(request.body);
    if (!memberRequest) {
      return sendError(
        reply,
        400,
        "VALIDATION_ERROR",
        "Community group member requires subjectId.",
        correlationIdFrom(request.headers["x-correlation-id"])
      );
    }
    const requestNow = now();
    const group = await upsertCommunityGroupMember({
      actor: actorToCommunityActor(actor),
      groupId: params.groupId,
      member: {
        displayName: memberRequest.displayName,
        subjectId: memberRequest.subjectId,
        username: memberRequest.username
      },
      role: memberRequest.role,
      status: memberRequest.status
    }, requestNow);
    if (!group) {
      return sendError(reply, 404, "NOT_FOUND", "Community group was not found or cannot be managed by current user.", crypto.randomUUID());
    }
    appendAudit(state, "COMMUNITY_GROUP_MEMBER_UPSERTED", {
      actorAuthMode: actor.authMode,
      actorSubjectId: actor.subjectId,
      groupId: group.groupId,
      memberSubjectId: memberRequest.subjectId,
      status: memberRequest.status
    }, correlationIdFrom(request.headers["x-correlation-id"]));
    return group;
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

  app.get("/api/v1/community/reports", async (request, reply) => {
    const actor = actorFromRequest(request);
    const requestNow = now();
    const query = parseCommunityReportQuery(request.query as Record<string, unknown>, actor);
    const items = (await listCommunityReports(query)).filter((report) => canReadCommunityReport(report, actor));
    const actorGroupIds = await readCommunityActorGroupIds(actor);
    const responseItems = communityReportResponseItems(items, requestNow, actor, actorGroupIds);
    return {
      featureCollection: communityReportsFeatureCollection(responseItems, requestNow, actor, actorGroupIds),
      items: responseItems,
      nextCursor: null,
      serverTimestamp: requestNow.toISOString()
    };
  });

  app.post("/api/v1/community/reports", async (request, reply) => {
    const actor = requireActor(request, reply);
    if (!actor) {
      return reply;
    }
    const requestNow = now();
    const input = normalizeCreateCommunityReport(request.body, actor, requestNow);
    if (!input) {
      return sendError(
        reply,
        400,
        "VALIDATION_ERROR",
        "Community report requires category and location {lat, lon}.",
        correlationIdFrom(request.headers["x-correlation-id"])
      );
    }
    const requestedGroupId = communityReportGroupId(input);
    if (requestedGroupId) {
      const group = await readCommunityGroup(requestedGroupId);
      if (!group || !canUseCommunityGroupForReport(group, actor)) {
        return sendError(reply, 403, "FORBIDDEN", "Current user cannot publish into the selected community group.", crypto.randomUUID());
      }
    }
    const report = await createCommunityReport(input, requestNow);
    appendAudit(state, "COMMUNITY_REPORT_CREATED", {
      actorAuthMode: actor.authMode,
      actorSubjectId: actor.subjectId,
      category: report.category,
      reportId: report.reportId
    }, correlationIdFrom(request.headers["x-correlation-id"]));
    return reply.code(201).send(communityReportResponseItem(report, requestNow, actor, new Set()));
  });

  app.patch("/api/v1/community/reports/:reportId", async (request, reply) => {
    const actor = requireActor(request, reply);
    if (!actor) {
      return reply;
    }
    const params = request.params as { reportId: string };
    const update = normalizeCommunityReportUpdate(request.body);
    if (!update) {
      return sendError(
        reply,
        400,
        "VALIDATION_ERROR",
        "Community report update requires at least one editable field.",
        correlationIdFrom(request.headers["x-correlation-id"])
      );
    }
    const requestedGroupId = communityReportGroupId({ properties: update.properties ?? {} });
    if (requestedGroupId) {
      const group = await readCommunityGroup(requestedGroupId);
      if (!group || !canUseCommunityGroupForReport(group, actor)) {
        return sendError(reply, 403, "FORBIDDEN", "Current user cannot publish into the selected community group.", crypto.randomUUID());
      }
    }
    const requestNow = now();
    const report = await updateCommunityReport(params.reportId, actor, update, requestNow);
    if (!report) {
      return sendError(reply, 404, "NOT_FOUND", "Community report was not found.", crypto.randomUUID());
    }
    appendAudit(state, "COMMUNITY_REPORT_UPDATED", {
      actorAuthMode: actor.authMode,
      actorSubjectId: actor.subjectId,
      reportId: report.reportId
    }, correlationIdFrom(request.headers["x-correlation-id"]));
    return communityReportResponseItem(report, requestNow, actor, await readCommunityActorGroupIds(actor));
  });

  app.get("/api/v1/community/reports/:reportId", async (request, reply) => {
    const actor = actorFromRequest(request);
    const params = request.params as { reportId: string };
    const report = await readCommunityReport(params.reportId);
    if (!report || !canReadCommunityReport(report, actor)) {
      return sendError(reply, 404, "NOT_FOUND", "Community report was not found.", crypto.randomUUID());
    }
    return communityReportResponseItem(report, now(), actor, await readCommunityActorGroupIds(actor));
  });

  app.delete("/api/v1/community/reports/:reportId", async (request, reply) => {
    const actor = requireActor(request, reply);
    if (!actor) {
      return reply;
    }
    const params = request.params as { reportId: string };
    const deleted = await deleteCommunityReport(params.reportId, actor, now());
    if (!deleted) {
      return sendError(reply, 404, "NOT_FOUND", "Community report was not found.", crypto.randomUUID());
    }
    appendAudit(state, "COMMUNITY_REPORT_DELETED", {
      actorAuthMode: actor.authMode,
      actorSubjectId: actor.subjectId,
      reportId: params.reportId
    }, correlationIdFrom(request.headers["x-correlation-id"]));
    return reply.code(204).send();
  });

  app.post("/api/v1/community/reports/:reportId/submit", async (request, reply) => {
    const actor = requireActor(request, reply);
    if (!actor) {
      return reply;
    }
    const params = request.params as { reportId: string };
    const requestNow = now();
    const report = await submitCommunityReport(params.reportId, actor, requestNow);
    if (!report) {
      return sendError(reply, 404, "NOT_FOUND", "Community report was not found.", crypto.randomUUID());
    }
    appendAudit(state, "COMMUNITY_REPORT_SUBMITTED", {
      actorAuthMode: actor.authMode,
      actorSubjectId: actor.subjectId,
      attachmentCount: report.attachments.length,
      category: report.category,
      reportId: report.reportId
    }, correlationIdFrom(request.headers["x-correlation-id"]));
    return communityReportResponseItem(report, requestNow, actor, new Set());
  });

  app.post("/api/v1/community/reports/:reportId/attachments", async (request, reply) => {
    const actor = requireActor(request, reply);
    if (!actor) {
      return reply;
    }
    if (!mediaStorage || mediaStorageStatus !== "ok") {
      return sendError(
        reply,
        503,
        "MEDIA_STORAGE_UNAVAILABLE",
        "Community media storage is not configured.",
        correlationIdFrom(request.headers["x-correlation-id"])
      );
    }
    const params = request.params as { reportId: string };
    const report = await readCommunityReport(params.reportId);
    if (!report || report.createdBy.subjectId !== actor.subjectId) {
      return sendError(reply, 404, "NOT_FOUND", "Community report was not found.", crypto.randomUUID());
    }
    const attachmentRequest = normalizeCommunityAttachmentRequest(request.body);
    if (!attachmentRequest) {
      return sendError(
        reply,
        400,
        "VALIDATION_ERROR",
        "Attachment requires kind, contentType and byteSize.",
        correlationIdFrom(request.headers["x-correlation-id"])
      );
    }
    const requestNow = now();
    const attachmentId = crypto.randomUUID();
    const upload = await mediaStorage.createUploadSlot({
      attachmentId,
      byteSize: attachmentRequest.byteSize,
      contentType: attachmentRequest.contentType,
      fileName: attachmentRequest.fileName,
      reportId: report.reportId
    }, requestNow);
    const attachment = await createCommunityAttachment({
      attachmentId,
      bucket: upload.bucket,
      byteSize: attachmentRequest.byteSize,
      capturedAt: attachmentRequest.capturedAt,
      captureLocation: attachmentRequest.captureLocation,
      checksumSha256: attachmentRequest.checksumSha256,
      contentType: attachmentRequest.contentType,
      fileName: attachmentRequest.fileName,
      kind: attachmentRequest.kind,
      metadata: attachmentRequest.metadata,
      objectKey: upload.objectKey,
      reportId: report.reportId,
      subjectId: actor.subjectId,
      uploadExpiresAt: upload.expiresAt
    });
    appendAudit(state, "COMMUNITY_ATTACHMENT_UPLOAD_CREATED", {
      actorAuthMode: actor.authMode,
      actorSubjectId: actor.subjectId,
      attachmentId,
      byteSize: attachment.byteSize,
      contentType: attachment.contentType,
      kind: attachment.kind,
      reportId: report.reportId
    }, correlationIdFrom(request.headers["x-correlation-id"]));
    return reply.code(201).send({
      attachment,
      upload
    });
  });

  app.post("/api/v1/community/reports/:reportId/attachments/:attachmentId/complete", async (request, reply) => {
    const actor = requireActor(request, reply);
    if (!actor) {
      return reply;
    }
    const params = request.params as { attachmentId: string; reportId: string };
    const body = isRecord(request.body) ? request.body : {};
    const requestNow = now();
    const attachment = await completeCommunityAttachment({
      attachmentId: params.attachmentId,
      byteSize: optionalFiniteNumber(body.byteSize, 1, readPositiveInteger(process.env.COP_MEDIA_MAX_ATTACHMENT_BYTES, 25 * 1024 * 1024)),
      checksumSha256: optionalChecksumSha256(body.checksumSha256),
      completedAt: requestNow.toISOString(),
      reportId: params.reportId,
      subjectId: actor.subjectId
    });
    if (!attachment) {
      return sendError(reply, 404, "NOT_FOUND", "Community report attachment was not found.", crypto.randomUUID());
    }
    appendAudit(state, "COMMUNITY_ATTACHMENT_UPLOAD_COMPLETED", {
      actorAuthMode: actor.authMode,
      actorSubjectId: actor.subjectId,
      attachmentId: attachment.attachmentId,
      reportId: attachment.reportId
    }, correlationIdFrom(request.headers["x-correlation-id"]));
    const convertedAttachment = await enqueueSpatialVideoConversion(params.reportId, attachment, requestNow);
    return communityAttachmentResponseItem(convertedAttachment, params.reportId, true, actor, requestNow);
  });

  app.post("/api/v1/community/reports/:reportId/attachments/:attachmentId/upload", async (request, reply) => {
    const actor = requireActor(request, reply);
    if (!actor) {
      return reply;
    }
    if (!mediaStorage || mediaStorageStatus !== "ok") {
      return sendError(
        reply,
        503,
        "MEDIA_STORAGE_UNAVAILABLE",
        "Community media storage is not configured.",
        correlationIdFrom(request.headers["x-correlation-id"])
      );
    }
    const params = request.params as { attachmentId: string; reportId: string };
    const report = await readCommunityReport(params.reportId);
    const attachment = report?.attachments.find((item) => item.attachmentId === params.attachmentId);
    if (!report || report.createdBy.subjectId !== actor.subjectId || !attachment) {
      return sendError(reply, 404, "NOT_FOUND", "Community report attachment was not found.", crypto.randomUUID());
    }
    const uploadBody = normalizeCommunityAttachmentUploadBody(request.body, attachment.byteSize, maxCommunityAttachmentBytes);
    if (!uploadBody) {
      return sendError(
        reply,
        400,
        "VALIDATION_ERROR",
        "Attachment upload requires binary data or base64 data matching the declared attachment size.",
        correlationIdFrom(request.headers["x-correlation-id"])
      );
    }
    const checksumSha256 = createHash("sha256").update(uploadBody.body).digest("hex");
    const requestNow = now();
    await mediaStorage.putObject({
      body: uploadBody.body,
      contentType: attachment.contentType,
      objectKey: attachment.objectKey
    }, requestNow);
    const completed = await completeCommunityAttachment({
      attachmentId: attachment.attachmentId,
      byteSize: uploadBody.body.length,
      checksumSha256,
      completedAt: requestNow.toISOString(),
      reportId: report.reportId,
      subjectId: actor.subjectId
    });
    if (!completed) {
      return sendError(reply, 404, "NOT_FOUND", "Community report attachment was not found.", crypto.randomUUID());
    }
    appendAudit(state, "COMMUNITY_ATTACHMENT_PROXY_UPLOADED", {
      actorAuthMode: actor.authMode,
      actorSubjectId: actor.subjectId,
      attachmentId: attachment.attachmentId,
      byteSize: uploadBody.body.length,
      contentType: attachment.contentType,
      reportId: report.reportId
    }, correlationIdFrom(request.headers["x-correlation-id"]));
    const convertedAttachment = await enqueueSpatialVideoConversion(report.reportId, completed, requestNow);
    return communityAttachmentResponseItem(convertedAttachment, report.reportId, true, actor, requestNow);
  });

  app.get("/api/v1/community/reports/:reportId/attachments/:attachmentId/content", async (request, reply) => {
    if (!mediaStorage || mediaStorageStatus !== "ok") {
      return sendError(
        reply,
        503,
        "MEDIA_STORAGE_UNAVAILABLE",
        "Community media storage is not configured.",
        correlationIdFrom(request.headers["x-correlation-id"])
      );
    }
    const actor = actorFromRequest(request);
    const params = request.params as { attachmentId: string; reportId: string };
    const report = await readCommunityReport(params.reportId);
    if (!report) {
      return sendError(reply, 404, "NOT_FOUND", "Community report attachment was not found.", crypto.randomUUID());
    }
    const attachment = report.attachments.find((item) => item.attachmentId === params.attachmentId && item.status === "uploaded");
    if (!attachment) {
      return sendError(reply, 404, "NOT_FOUND", "Community report attachment was not found.", crypto.randomUUID());
    }
    const requestNow = now();
    const hasValidTicket = hasValidCommunityMediaTicket(request.query, {
      attachmentId: params.attachmentId,
      reportId: params.reportId
    }, requestNow);
    if (!hasValidTicket && (!canReadCommunityReport(report, actor) || !canReadCommunityAttachment(report, attachment, actor, await readCommunityActorGroupIds(actor)))) {
      return sendError(reply, 404, "NOT_FOUND", "Community report attachment was not found.", crypto.randomUUID());
    }
    const readUrl = await mediaStorage.createReadUrl({ objectKey: attachment.objectKey }, requestNow);
    const range = typeof request.headers.range === "string" ? request.headers.range : undefined;
    const mediaResponse = await fetch(readUrl, {
      headers: range ? { range } : undefined
    });
    if (!mediaResponse.ok && mediaResponse.status !== 206) {
      return sendError(reply, 502, "MEDIA_STORAGE_ERROR", `Media storage returned HTTP ${mediaResponse.status}.`, crypto.randomUUID());
    }
    const contentLength = mediaResponse.headers.get("content-length");
    const contentRange = mediaResponse.headers.get("content-range");
    const acceptRanges = mediaResponse.headers.get("accept-ranges");
    reply
      .code(mediaResponse.status)
      .header("Cache-Control", "private, max-age=300")
      .header("Content-Disposition", contentDispositionHeader(attachment.fileName ?? attachment.attachmentId))
      .header("Content-Type", attachment.contentType);
    if (contentLength) {
      reply.header("Content-Length", contentLength);
    }
    if (contentRange) {
      reply.header("Content-Range", contentRange);
    }
    if (acceptRanges) {
      reply.header("Accept-Ranges", acceptRanges);
    }
    return reply.send(Buffer.from(await mediaResponse.arrayBuffer()));
  });

  app.get("/api/v1/community/reports/:reportId/attachments/:attachmentId/derivatives/:derivativeId/content", async (request, reply) => {
    if (!mediaStorage || mediaStorageStatus !== "ok") {
      return sendError(
        reply,
        503,
        "MEDIA_STORAGE_UNAVAILABLE",
        "Community media storage is not configured.",
        correlationIdFrom(request.headers["x-correlation-id"])
      );
    }
    const actor = actorFromRequest(request);
    const params = request.params as { attachmentId: string; derivativeId: string; reportId: string };
    const report = await readCommunityReport(params.reportId);
    if (!report || params.derivativeId !== "xr-sbs") {
      return sendError(reply, 404, "NOT_FOUND", "Community report attachment derivative was not found.", crypto.randomUUID());
    }
    const attachment = report.attachments.find((item) => item.attachmentId === params.attachmentId && item.status === "uploaded");
    if (!attachment) {
      return sendError(reply, 404, "NOT_FOUND", "Community report attachment derivative was not found.", crypto.randomUUID());
    }
    const requestNow = now();
    const hasValidTicket = hasValidCommunityMediaTicket(request.query, {
      attachmentId: params.attachmentId,
      derivativeId: params.derivativeId,
      reportId: params.reportId
    }, requestNow);
    if (!hasValidTicket && (!canReadCommunityReport(report, actor) || !canReadCommunityAttachment(report, attachment, actor, await readCommunityActorGroupIds(actor)))) {
      return sendError(reply, 404, "NOT_FOUND", "Community report attachment derivative was not found.", crypto.randomUUID());
    }
    const derivative = readSpatialDerivative(attachment);
    if (!derivative || derivative.status !== "ready" || !derivative.objectKey) {
      return sendError(reply, 404, "NOT_FOUND", "Community report attachment derivative was not found.", crypto.randomUUID());
    }
    const readUrl = await mediaStorage.createReadUrl({ objectKey: derivative.objectKey }, requestNow);
    const range = typeof request.headers.range === "string" ? request.headers.range : undefined;
    const mediaResponse = await fetch(readUrl, {
      headers: range ? { range } : undefined
    });
    if (!mediaResponse.ok && mediaResponse.status !== 206) {
      return sendError(reply, 502, "MEDIA_STORAGE_ERROR", `Media storage returned HTTP ${mediaResponse.status}.`, crypto.randomUUID());
    }
    const contentLength = mediaResponse.headers.get("content-length");
    const contentRange = mediaResponse.headers.get("content-range");
    const acceptRanges = mediaResponse.headers.get("accept-ranges");
    const baseName = stripFileExtension(attachment.fileName ?? attachment.attachmentId);
    reply
      .code(mediaResponse.status)
      .header("Cache-Control", "private, max-age=300")
      .header("Content-Disposition", contentDispositionHeader(`${baseName}-xr-sbs.mp4`))
      .header("Content-Type", derivative.contentType ?? "video/mp4");
    if (contentLength) {
      reply.header("Content-Length", contentLength);
    }
    if (contentRange) {
      reply.header("Content-Range", contentRange);
    }
    if (acceptRanges) {
      reply.header("Accept-Ranges", acceptRanges);
    }
    return reply.send(Buffer.from(await mediaResponse.arrayBuffer()));
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

  app.get("/api/v1/map/catalog", async (request) => {
    const requestNow = now();
    const actor = actorFromRequest(request);
    const query = request.query as Record<string, unknown>;
    const includeDiagnostics = Boolean(actor) && parseBooleanQuery(query.includeDiagnostics);
    const includePartner = Boolean(actor) && parseBooleanQuery(query.includePartner);
    const locale = typeof query.locale === "string" && query.locale.trim() ? query.locale.trim() : "cs-CZ";

    const providers = await readMapCatalogProviders(requestNow, actor, includePartner);

    return buildMapCatalog({
      flight: providers.flight,
      generatedAt: requestNow,
      includeDiagnostics,
      includePartner,
      locale,
      missionArena: providers.missionArena,
      safety: providers.safety,
      situation: providers.situation,
      tak: providers.tak
    });
  });

  app.get("/api/v1/geocode/search", async (request, reply) => {
    if (!placeGeocoder) {
      return sendError(reply, 503, "GEOCODER_UNAVAILABLE", "Place geocoder is disabled.", correlationIdFrom(request.headers["x-correlation-id"]));
    }
    const query = request.query as Record<string, unknown>;
    const q = optionalTrimmedString(query.q ?? query.query, 160);
    if (!q || q.length < 3) {
      return sendError(reply, 400, "VALIDATION_ERROR", "Geocode search requires q with at least 3 characters.", correlationIdFrom(request.headers["x-correlation-id"]));
    }
    try {
      return await placeGeocoder.search({
        language: optionalTrimmedString(query.language, 40),
        limit: optionalFiniteNumber(query.limit, 1, 8),
        query: q
      }, now());
    } catch (error) {
      app.log.warn({ error, q }, "Place geocode search failed.");
      return sendError(reply, 502, "GEOCODER_UPSTREAM_UNAVAILABLE", errorMessage(error), correlationIdFrom(request.headers["x-correlation-id"]));
    }
  });

  app.post("/api/v1/map/query", async (request, reply) => {
    const requestNow = now();
    const actor = actorFromRequest(request);
    const query = parseMapQueryRequest(request.body);
    if (!query) {
      return sendError(reply, 400, "VALIDATION_ERROR", "Map query requires bbox=[west,south,east,north] and layerIds[].", crypto.randomUUID());
    }

    const includeDiagnostics = Boolean(actor) && query.includeDiagnostics;
    const includePartner = Boolean(actor) && query.includePartner;
    const providers = await readMapCatalogProviders(requestNow, actor, includePartner);
    const catalog = buildMapCatalog({
      flight: providers.flight,
      generatedAt: requestNow,
      includeDiagnostics,
      includePartner,
      locale: "cs-CZ",
      missionArena: providers.missionArena,
      safety: providers.safety,
      situation: providers.situation,
      tak: providers.tak
    });
    const selectedLayers = catalog.layers.filter((layer) => query.layerIds.includes(layer.layerId));
    const unknownLayerIds = query.layerIds.filter((layerId) => !catalog.layers.some((layer) => layer.layerId === layerId));
    const providerQueries = buildProviderFeatureQueries(selectedLayers, query);
    const warnings = [
      ...catalog.warnings,
      ...(unknownLayerIds.length > 0 ? [`Unknown or unauthorized map layers ignored: ${unknownLayerIds.join(", ")}.`] : [])
    ];

    const [situationCollection, safetyCollection, flightCollection, communityCollection, missionArenaCollection, takCollection] = await Promise.all([
      readSituationMapQuery(providerQueries.situation, requestNow, actor, selectedLayers),
      readSafetyMapQuery(providerQueries.safety, requestNow),
      readFlightReferenceMapQuery(providerQueries.flight, requestNow),
      readCommunityMapQuery(providerQueries.community, requestNow, actor),
      readMissionArenaMapQuery(providerQueries.missionArena, requestNow),
      includePartner ? readTakMapQuery(providerQueries.tak, requestNow) : Promise.resolve(undefined)
    ]);

    const featureCount = (situationCollection?.summary.featureCount ?? 0)
      + (safetyCollection?.summary.featureCount ?? 0)
      + (flightCollection?.summary.featureCount ?? 0)
      + (communityCollection?.summary.featureCount ?? 0)
      + (missionArenaCollection?.summary.featureCount ?? 0)
      + (takCollection?.summary.featureCount ?? 0);
    return {
      contractVersion: "cop-map-query-v1",
      community: communityCollection,
      flight: flightCollection,
      generatedAt: requestNow.toISOString(),
      missionArena: missionArenaCollection,
      query: {
        bbox: query.bbox,
        layerIds: selectedLayers.map((layer) => layer.layerId),
        limit: query.limit
      },
      safety: safetyCollection,
      situation: situationCollection,
      summary: {
        featureCount,
        layerCount: selectedLayers.length,
        warningCount: warnings.length
      },
      tak: takCollection,
      warnings
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
      queueTrackPersistence,
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
      queueTrackPersistence(result.object, result.accepted, result.historyPoint);
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

  async function readFlightCatalogProvider(requestNow: Date) {
    if (!flightDataSource) {
      return {
        status: "disabled" as const,
        warning: "Flight data source is disabled."
      };
    }
    try {
      const catalog = flightDataSource.fetchCatalog ? await flightDataSource.fetchCatalog(requestNow) : undefined;
      return {
        catalog,
        status: "online" as const
      };
    } catch (error) {
      appendAudit(state, "MAP_CATALOG_FLIGHT_PROVIDER_FAILED", {
        error: errorMessage(error),
        sourceSystemId: flightDataSource.sourceSystem.sourceSystemId
      });
      app.log.warn({ error }, "Flight data catalog provider request failed.");
      return {
        status: "unavailable" as const,
        warning: errorMessage(error)
      };
    }
  }

  async function readMapCatalogProviders(requestNow: Date, actor: AuthenticatedActor | null, includePartner: boolean): Promise<{
    flight: NonNullable<BuildMapCatalogInput["flight"]>;
    missionArena: NonNullable<BuildMapCatalogInput["missionArena"]>;
    safety: NonNullable<BuildMapCatalogInput["safety"]>;
    situation: NonNullable<BuildMapCatalogInput["situation"]>;
    tak?: NonNullable<BuildMapCatalogInput["tak"]>;
  }> {
    const [situation, safety, flight, missionArena, tak] = await Promise.all([
      withCatalogProviderTimeout(
        "sim.situation-data",
        readSituationCatalogProvider(requestNow, actor),
        () => unavailableSituationCatalogProvider("Situation data")
      ),
      withCatalogProviderTimeout(
        "sim.safety-data",
        readSafetyCatalogProvider(requestNow),
        () => unavailableSafetyCatalogProvider("Safety data")
      ),
      withCatalogProviderTimeout(
        "sim.flight-data",
        readFlightCatalogProvider(requestNow),
        () => unavailableFlightCatalogProvider("Flight data")
      ),
      withCatalogProviderTimeout(
        "csm.mission-arena",
        readMissionArenaCatalogProvider(requestNow),
        () => unavailableMissionArenaCatalogProvider("Mission Arena")
      ),
      includePartner
        ? withCatalogProviderTimeout(
            "sim.tak-gateway",
            readTakCatalogProvider(requestNow),
            () => unavailableTakCatalogProvider("TAK Gateway")
          )
        : Promise.resolve(undefined)
    ]);
    return {
      flight,
      missionArena,
      safety,
      situation,
      tak
    };
  }

  function withCatalogProviderTimeout<T>(
    providerId: string,
    operation: Promise<T>,
    fallback: () => T
  ): Promise<T> {
    const timeoutMs = mapCatalogProviderTimeoutMs();
    return new Promise<T>((resolve) => {
      let settled = false;
      const timeout = setTimeout(() => {
        if (settled) {
          return;
        }
        settled = true;
        app.log.warn({ providerId, timeoutMs }, "Map catalog provider timed out; returning degraded catalog slice.");
        appendAudit(state, "MAP_CATALOG_PROVIDER_TIMEOUT", { providerId, timeoutMs });
        resolve(fallback());
      }, timeoutMs);

      operation.then(
        (value) => {
          if (settled) {
            return;
          }
          settled = true;
          clearTimeout(timeout);
          resolve(value);
        },
        (error) => {
          if (settled) {
            return;
          }
          settled = true;
          clearTimeout(timeout);
          app.log.warn({ error, providerId }, "Map catalog provider rejected before timeout; returning degraded catalog slice.");
          appendAudit(state, "MAP_CATALOG_PROVIDER_REJECTED", { error: errorMessage(error), providerId });
          resolve(fallback());
        }
      );
    });
  }

  function unavailableFlightCatalogProvider(label: string): NonNullable<BuildMapCatalogInput["flight"]> {
    return {
      status: "unavailable",
      warning: catalogProviderTimeoutWarning(label)
    };
  }

  function unavailableMissionArenaCatalogProvider(label: string): NonNullable<BuildMapCatalogInput["missionArena"]> {
    return {
      layers: [],
      sources: [],
      status: "unavailable",
      warning: catalogProviderTimeoutWarning(label)
    };
  }

  function unavailableSafetyCatalogProvider(label: string): NonNullable<BuildMapCatalogInput["safety"]> {
    return {
      layers: [],
      sources: [],
      status: "unavailable",
      warning: catalogProviderTimeoutWarning(label)
    };
  }

  function unavailableSituationCatalogProvider(label: string): NonNullable<BuildMapCatalogInput["situation"]> {
    return {
      layers: [],
      sources: [],
      status: "unavailable",
      warning: catalogProviderTimeoutWarning(label)
    };
  }

  function unavailableTakCatalogProvider(label: string): NonNullable<BuildMapCatalogInput["tak"]> {
    return {
      layers: [],
      sources: [],
      status: "unavailable",
      warning: catalogProviderTimeoutWarning(label)
    };
  }

  function catalogProviderTimeoutWarning(label: string): string {
    return `${label} catalog provider timed out after ${mapCatalogProviderTimeoutMs()} ms.`;
  }

  async function readSituationCatalogProvider(requestNow: Date, actor: AuthenticatedActor | null) {
    if (!situationDataSource) {
      return {
        layers: [],
        sources: [],
        status: "disabled" as const,
        warning: "Situation data source is disabled."
      };
    }

    try {
      const [catalog, layers, rawSources] = await Promise.all([
        situationDataSource.fetchCatalog ? situationDataSource.fetchCatalog(requestNow) : Promise.resolve(undefined),
        situationDataSource.fetchLayers(requestNow),
        situationDataSource.fetchSources(requestNow)
      ]);
      const sources = filterSituationSourcesForActor(rawSources, actor);
      const health = buildSituationDataHealth(layers, requestNow);
      state.sources.set(situationDataSource.sourceSystem.sourceSystemId, withSituationDataHealth(activeSituationDataSourceSystem(), health));
      return {
        catalog,
        layers,
        sources,
        status: "online" as const
      };
    } catch (error) {
      const health = unavailableSituationDataHealth(error, requestNow);
      state.sources.set(situationDataSource.sourceSystem.sourceSystemId, withSituationDataHealth(activeSituationDataSourceSystem(), health));
      appendAudit(state, "MAP_CATALOG_SITUATION_PROVIDER_FAILED", {
        error: errorMessage(error),
        sourceSystemId: situationDataSource.sourceSystem.sourceSystemId
      });
      app.log.warn({ error }, "Situation data catalog provider request failed.");
      return {
        layers: [],
        sources: [],
        status: "unavailable" as const,
        warning: health.lastError ?? "Situation data catalog provider is unavailable."
      };
    }
  }

  async function readSafetyCatalogProvider(requestNow: Date) {
    if (!safetyDataSource) {
      return {
        layers: [],
        sources: [],
        status: "disabled" as const,
        warning: "Safety data source is disabled."
      };
    }

    try {
      const [catalog, layers, sources] = await Promise.all([
        safetyDataSource.fetchCatalog ? safetyDataSource.fetchCatalog(requestNow) : Promise.resolve(undefined),
        safetyDataSource.fetchLayers(requestNow),
        safetyDataSource.fetchSources(requestNow)
      ]);
      const health = buildSafetyDataHealth(layers, requestNow);
      state.sources.set(safetyDataSource.sourceSystem.sourceSystemId, withSafetyDataHealth(activeSafetyDataSourceSystem(), health));
      return {
        catalog,
        layers,
        sources,
        status: "online" as const
      };
    } catch (error) {
      const health = unavailableSafetyDataHealth(error, requestNow);
      state.sources.set(safetyDataSource.sourceSystem.sourceSystemId, withSafetyDataHealth(activeSafetyDataSourceSystem(), health));
      appendAudit(state, "MAP_CATALOG_SAFETY_PROVIDER_FAILED", {
        error: errorMessage(error),
        sourceSystemId: safetyDataSource.sourceSystem.sourceSystemId
      });
      app.log.warn({ error }, "Safety data catalog provider request failed.");
      return {
        layers: [],
        sources: [],
        status: "unavailable" as const,
        warning: health.lastError ?? "Safety data catalog provider is unavailable."
      };
    }
  }

  async function readTakCatalogProvider(requestNow: Date) {
    if (!takGatewaySource) {
      return {
        layers: [],
        sources: [],
        status: "disabled" as const,
        warning: "TAK Gateway source is disabled."
      };
    }

    try {
      const [catalog, layers, sources] = await Promise.all([
        takGatewaySource.fetchCatalog ? takGatewaySource.fetchCatalog(requestNow) : Promise.resolve(undefined),
        takGatewaySource.fetchLayers(requestNow),
        takGatewaySource.fetchSources(requestNow)
      ]);
      const health = buildTakGatewayHealth(layers, requestNow);
      state.sources.set(takGatewaySource.sourceSystem.sourceSystemId, withTakGatewayHealth(activeTakGatewaySourceSystem(), health));
      return {
        catalog,
        layers,
        sources,
        status: "online" as const
      };
    } catch (error) {
      const health = unavailableTakGatewayHealth(error, requestNow);
      state.sources.set(takGatewaySource.sourceSystem.sourceSystemId, withTakGatewayHealth(activeTakGatewaySourceSystem(), health));
      appendAudit(state, "MAP_CATALOG_TAK_PROVIDER_FAILED", {
        error: errorMessage(error),
        sourceSystemId: takGatewaySource.sourceSystem.sourceSystemId
      });
      app.log.warn({ error }, "TAK Gateway catalog provider request failed.");
      return {
        layers: [],
        sources: [],
        status: "unavailable" as const,
        warning: health.lastError ?? "TAK Gateway catalog provider is unavailable."
      };
    }
  }

  async function readMissionArenaCatalogProvider(requestNow: Date) {
    if (!missionArenaSource) {
      return {
        layers: [],
        sources: [],
        status: "disabled" as const
      };
    }

    try {
      const [layers, sources] = await Promise.all([
        missionArenaSource.fetchLayers(requestNow),
        missionArenaSource.fetchSources(requestNow)
      ]);
      const health = buildMissionArenaHealth(layers, requestNow);
      state.sources.set(missionArenaSource.sourceSystem.sourceSystemId, withMissionArenaHealth(activeMissionArenaSourceSystem(), health));
      return {
        layers,
        sources,
        status: "online" as const
      };
    } catch (error) {
      const health = unavailableMissionArenaHealth(error, requestNow);
      state.sources.set(missionArenaSource.sourceSystem.sourceSystemId, withMissionArenaHealth(activeMissionArenaSourceSystem(), health));
      appendAudit(state, "MAP_CATALOG_MISSION_ARENA_PROVIDER_FAILED", {
        error: errorMessage(error),
        sourceSystemId: missionArenaSource.sourceSystem.sourceSystemId
      });
      app.log.warn({ error }, "Mission Arena catalog provider request failed.");
      return {
        layers: [],
        sources: [],
        status: "unavailable" as const,
        warning: health.lastError ?? "Mission Arena catalog provider is unavailable."
      };
    }
  }

  async function readSituationMapQuery(
    query: SituationFeatureQuery | undefined,
    requestNow: Date,
    actor: AuthenticatedActor | null,
    selectedLayers: MapCatalogLayer[] = []
  ) {
    if (!query) {
      return undefined;
    }
    if (!situationDataSource) {
      return {
        ...emptySituationFeatureCollection(query, requestNow, ["Situation data source is disabled."]),
        sourceHealth: {
          detail: "disabled",
          evaluatedAt: requestNow.toISOString(),
          health: "WAITING" as const,
          lastPollAt: requestNow.toISOString()
        }
      };
    }

    const sanitized = sanitizeSituationQueryForActor(query, actor);
    if (sanitized.blocked) {
      const collection = emptySituationFeatureCollection(sanitized.query, requestNow, sanitized.warnings);
      return {
        ...collection,
        sourceHealth: buildSituationDataHealth(collection, requestNow)
      };
    }

    try {
      const actorFilteredCollection = filterSituationCollectionForActor(await situationDataSource.fetchFeatures(sanitized.query, requestNow), actor, sanitized.warnings);
      const collection = filterSituationCollectionForCatalogLayers(actorFilteredCollection, selectedLayers);
      const health = buildSituationDataHealth(collection, requestNow);
      state.sources.set(situationDataSource.sourceSystem.sourceSystemId, withSituationDataHealth(activeSituationDataSourceSystem(), health));
      return {
        ...collection,
        sourceHealth: health
      };
    } catch (error) {
      const health = unavailableSituationDataHealth(error, requestNow);
      state.sources.set(situationDataSource.sourceSystem.sourceSystemId, withSituationDataHealth(activeSituationDataSourceSystem(), health));
      appendAudit(state, "MAP_QUERY_SITUATION_PROVIDER_FAILED", {
        error: errorMessage(error),
        sourceSystemId: situationDataSource.sourceSystem.sourceSystemId
      });
      app.log.warn({ error }, "Situation data map query failed.");
      return {
        ...emptySituationFeatureCollection(sanitized.query, requestNow, [health.lastError ?? "Situation data features are unavailable."]),
        sourceHealth: health
      };
    }
  }

  async function readSafetyMapQuery(query: SafetyFeatureQuery | undefined, requestNow: Date) {
    if (!query) {
      return undefined;
    }
    if (!safetyDataSource) {
      return {
        ...emptySafetyFeatureCollection(query, requestNow, ["Safety data source is disabled."]),
        sourceHealth: {
          detail: "disabled",
          evaluatedAt: requestNow.toISOString(),
          health: "WAITING" as const,
          lastPollAt: requestNow.toISOString()
        }
      };
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
      appendAudit(state, "MAP_QUERY_SAFETY_PROVIDER_FAILED", {
        error: errorMessage(error),
        sourceSystemId: safetyDataSource.sourceSystem.sourceSystemId
      });
      app.log.warn({ error }, "Safety data map query failed.");
      return {
        ...emptySafetyFeatureCollection(query, requestNow, [health.lastError ?? "Safety data features are unavailable."]),
        sourceHealth: health
      };
    }
  }

  async function readFlightReferenceMapQuery(query: FlightReferenceFeatureQuery | undefined, requestNow: Date): Promise<(FlightReferenceFeatureCollection & { sourceHealth?: SourceHealthOverride }) | undefined> {
    if (!query) {
      return undefined;
    }
    if (!flightDataSource?.fetchReferenceFeatures) {
      return {
        ...emptyFlightReferenceFeatureCollection(query, requestNow, ["Flight reference source is disabled."]),
        sourceHealth: {
          detail: "disabled",
          evaluatedAt: requestNow.toISOString(),
          health: "WAITING" as const,
          lastPollAt: requestNow.toISOString()
        }
      };
    }

    try {
      const collection = await flightDataSource.fetchReferenceFeatures(query, requestNow);
      const health: SourceHealthOverride = {
        detail: `reference features ${collection.summary.featureCount}`,
        evaluatedAt: requestNow.toISOString(),
        generatedAt: collection.generatedAt,
        health: collection.warnings.length > 0 ? "DEGRADED" : "ONLINE",
        lastPollAt: requestNow.toISOString(),
        lastSuccessAt: requestNow.toISOString(),
        summary: {
          featureCount: collection.summary.featureCount,
          sourceCount: collection.summary.sourceCount,
          staleFeatureCount: collection.summary.staleFeatureCount
        },
        warnings: collection.warnings
      };
      state.sources.set(flightDataSource.sourceSystem.sourceSystemId, withFlightDataHealth(activeFlightDataSourceSystem(), health));
      return {
        ...collection,
        sourceHealth: health
      };
    } catch (error) {
      const health = unavailableFlightDataHealth(error, requestNow);
      state.sources.set(flightDataSource.sourceSystem.sourceSystemId, withFlightDataHealth(activeFlightDataSourceSystem(), health));
      appendAudit(state, "MAP_QUERY_FLIGHT_REFERENCE_PROVIDER_FAILED", {
        error: errorMessage(error),
        sourceSystemId: flightDataSource.sourceSystem.sourceSystemId
      });
      app.log.warn({ error }, "Flight reference map query failed.");
      return {
        ...emptyFlightReferenceFeatureCollection(query, requestNow, [health.lastError ?? "Flight reference features are unavailable."]),
        sourceHealth: health
      };
    }
  }

  async function readCommunityMapQuery(query: CommunityMapFeatureQuery | undefined, requestNow: Date, actor: AuthenticatedActor | null) {
    if (!query) {
      return undefined;
    }
    try {
      const reports = (await listCommunityReports({
        bbox: query.bbox,
        includeOwnDrafts: Boolean(actor),
        limit: query.limit,
        ...(actor ? { subjectId: actor.subjectId } : {})
      })).filter((report) => canReadCommunityReport(report, actor));
      const actorGroupIds = await readCommunityActorGroupIds(actor);
      return {
        ...communityReportsFeatureCollection(
          communityReportResponseItems(reports, requestNow, actor, actorGroupIds),
          requestNow,
          actor,
          actorGroupIds
        ),
        query
      };
    } catch (error) {
      appendAudit(state, "MAP_QUERY_COMMUNITY_REPORTS_FAILED", {
        error: errorMessage(error)
      });
      app.log.warn({ error }, "Community report map query failed.");
      return {
        ...communityReportsFeatureCollection([], requestNow, actor, new Set()),
        query,
        warnings: [errorMessage(error)]
      };
    }
  }

  async function readMissionArenaMapQuery(query: MissionArenaFeatureQuery | undefined, requestNow: Date): Promise<(MissionArenaFeatureCollection & { sourceHealth?: SourceHealthOverride }) | undefined> {
    if (!query) {
      return undefined;
    }
    if (!missionArenaSource) {
      return {
        ...emptyMissionArenaFeatureCollection(query, requestNow, ["Mission Arena source is disabled."]),
        sourceHealth: {
          detail: "disabled",
          evaluatedAt: requestNow.toISOString(),
          health: "WAITING" as const,
          lastPollAt: requestNow.toISOString()
        }
      };
    }

    try {
      const collection = await missionArenaSource.fetchFeatures(query, requestNow);
      const health = buildMissionArenaHealth(collection, requestNow);
      state.sources.set(missionArenaSource.sourceSystem.sourceSystemId, withMissionArenaHealth(activeMissionArenaSourceSystem(), health));
      return {
        ...collection,
        sourceHealth: health
      };
    } catch (error) {
      const health = unavailableMissionArenaHealth(error, requestNow);
      state.sources.set(missionArenaSource.sourceSystem.sourceSystemId, withMissionArenaHealth(activeMissionArenaSourceSystem(), health));
      appendAudit(state, "MAP_QUERY_MISSION_ARENA_PROVIDER_FAILED", {
        error: errorMessage(error),
        sourceSystemId: missionArenaSource.sourceSystem.sourceSystemId
      });
      app.log.warn({ error }, "Mission Arena map query failed.");
      return {
        ...emptyMissionArenaFeatureCollection(query, requestNow, [health.lastError ?? "Mission Arena features are unavailable."]),
        sourceHealth: health
      };
    }
  }

  async function readTakMapQuery(query: TakGatewayFeatureQuery | undefined, requestNow: Date) {
    if (!query) {
      return undefined;
    }
    if (!takGatewaySource) {
      return {
        ...emptyTakGatewayFeatureCollection(query, requestNow, ["TAK Gateway source is disabled."]),
        sourceHealth: {
          detail: "disabled",
          evaluatedAt: requestNow.toISOString(),
          health: "WAITING" as const,
          lastPollAt: requestNow.toISOString()
        }
      };
    }

    try {
      const collection = await takGatewaySource.fetchFeatures(query, requestNow);
      const health = buildTakGatewayHealth(collection, requestNow);
      state.sources.set(takGatewaySource.sourceSystem.sourceSystemId, withTakGatewayHealth(activeTakGatewaySourceSystem(), health));
      return {
        ...collection,
        sourceHealth: health
      };
    } catch (error) {
      const health = unavailableTakGatewayHealth(error, requestNow);
      state.sources.set(takGatewaySource.sourceSystem.sourceSystemId, withTakGatewayHealth(activeTakGatewaySourceSystem(), health));
      appendAudit(state, "MAP_QUERY_TAK_PROVIDER_FAILED", {
        error: errorMessage(error),
        sourceSystemId: takGatewaySource.sourceSystem.sourceSystemId
      });
      app.log.warn({ error }, "TAK Gateway map query failed.");
      return {
        ...emptyTakGatewayFeatureCollection(query, requestNow, [health.lastError ?? "TAK Gateway features are unavailable."]),
        sourceHealth: health
      };
    }
  }

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
  queueTrackPersistence: (
    object: ObservedObject,
    event: CanonicalEventEnvelope,
    historyPoint: TrackHistoryPoint | undefined
  ) => void,
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
  queueTrackPersistence(result.object, result.accepted, result.historyPoint);
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

function withTakGatewayHealth(source: SourceSystem, health: SourceHealthOverride): SourceSystem {
  return {
    ...source,
    attributes: {
      ...source.attributes,
      sourceHealth: health,
      takGatewayHealth: health
    },
    updatedAt: health.evaluatedAt
  };
}

function withMissionArenaHealth(source: SourceSystem, health: SourceHealthOverride): SourceSystem {
  return {
    ...source,
    attributes: {
      ...source.attributes,
      sourceHealth: health,
      missionArenaHealth: health
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

function readTakGatewayHealth(source: SourceSystem | undefined): SourceHealthOverride | undefined {
  return readSourceHealthFromAttributes(source?.attributes?.takGatewayHealth ?? source?.attributes?.sourceHealth);
}

function readMissionArenaHealth(source: SourceSystem | undefined): SourceHealthOverride | undefined {
  return readSourceHealthFromAttributes(source?.attributes?.missionArenaHealth ?? source?.attributes?.sourceHealth);
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

interface MapFeatureQueryRequest {
  bbox: SituationFeatureQuery["bbox"];
  filters: Record<string, Record<string, unknown>>;
  includeDiagnostics: boolean;
  includePartner: boolean;
  layerIds: string[];
  limit: number;
}

interface ProviderFeatureQueries {
  community?: CommunityMapFeatureQuery;
  flight?: FlightReferenceFeatureQuery;
  missionArena?: MissionArenaFeatureQuery;
  safety?: SafetyFeatureQuery;
  situation?: SituationFeatureQuery;
  tak?: TakGatewayFeatureQuery;
}

interface CommunityMapFeatureQuery {
  bbox: CommunityReportQuery["bbox"];
  layerIds: string[];
  limit: number;
}

function parseMapQueryRequest(body: unknown): MapFeatureQueryRequest | null {
  if (!isRecord(body)) {
    return null;
  }
  const bbox = parseMapQueryBbox(body.bbox);
  const layerIds = normalizeMapQueryStringList(body.layerIds ?? body.layers);
  if (!bbox || layerIds.length === 0) {
    return null;
  }
  return {
    bbox,
    filters: normalizeMapQueryFilters(body.filters),
    includeDiagnostics: parseBooleanQuery(body.includeDiagnostics),
    includePartner: parseBooleanQuery(body.includePartner),
    layerIds,
    limit: optionalFiniteNumber(body.limit, 1, 1000) ?? 250
  };
}

function parseMapQueryBbox(value: unknown): SituationFeatureQuery["bbox"] | null {
  const parts = Array.isArray(value)
    ? value.map(Number)
    : typeof value === "string"
      ? value.split(",").map(Number)
      : isRecord(value)
        ? [value.west, value.south, value.east, value.north].map(Number)
        : [];
  if (parts.length !== 4 || !parts.every(Number.isFinite)) {
    return null;
  }
  const [west, south, east, north] = parts as [number, number, number, number];
  if (west >= east || south >= north) {
    return null;
  }
  return {
    east: clampNumber(east, -180, 180),
    north: clampNumber(north, -90, 90),
    south: clampNumber(south, -90, 90),
    west: clampNumber(west, -180, 180)
  };
}

function normalizeMapQueryStringList(value: unknown): string[] {
  const raw = Array.isArray(value) ? value : typeof value === "string" ? value.split(",") : [];
  return Array.from(new Set(raw.flatMap((item) => typeof item === "string" && item.trim() ? [item.trim()] : []))).slice(0, 128);
}

function normalizeMapQueryFilters(value: unknown): Record<string, Record<string, unknown>> {
  if (!isRecord(value)) {
    return {};
  }
  return Object.fromEntries(Object.entries(value).flatMap(([key, entry]) => {
    if (!key.trim() || !isRecord(entry)) {
      return [];
    }
    return [[key.trim(), entry]];
  }));
}

function buildProviderFeatureQueries(layers: MapCatalogLayer[], request: MapFeatureQueryRequest): ProviderFeatureQueries {
  const situationLayers = new Set<SituationLayerId>();
  const situationSources = new Set<string>();
  const safetyLayers = new Set<SafetyLayerId>();
  const flightLayers = new Set<FlightReferenceLayerId>();
  const missionArenaLayers = new Set<MissionArenaLayerId>();
  const takLayers = new Set<TakGatewayLayerId>();
  const communityLayerIds = new Set<string>();
  let situationTechnology: string | undefined;

  for (const layer of layers) {
    if (layer.query.mode !== "bbox") {
      continue;
    }
    if (layer.query.providerId === "sim.situation-data") {
      for (const layerId of layer.query.providerLayerIds ?? []) {
        if (isSituationLayerId(layerId)) {
          situationLayers.add(layerId);
        }
      }
      for (const sourceId of layer.query.providerSourceIds ?? []) {
        situationSources.add(sourceId);
      }
      situationTechnology = situationTechnology ?? readMapQueryTechnology(request.filters[layer.layerId]) ?? readDefaultTechnologyFilter(layer);
    } else if (layer.query.providerId === "sim.safety-data") {
      for (const layerId of layer.query.providerLayerIds ?? []) {
        if (isSafetyLayerId(layerId)) {
          safetyLayers.add(layerId);
        }
      }
    } else if (layer.query.providerId === "sim.flight-data") {
      const providerLayerIds = layer.query.providerLayerIds ?? [];
      for (const layerId of providerLayerIds) {
        if (isFlightReferenceLayerId(layerId)) {
          flightLayers.add(layerId);
        }
      }
      if (providerLayerIds.length === 0) {
        const streamLayer = flightReferenceLayerIdForStream(layer.query.streamId);
        if (streamLayer) {
          flightLayers.add(streamLayer);
        }
      }
    } else if (layer.query.providerId === "cop.community") {
      communityLayerIds.add(layer.layerId);
    } else if (layer.query.providerId === "csm.mission-arena") {
      for (const providerLayerId of layer.query.providerLayerIds ?? []) {
        if (isMissionArenaLayerId(providerLayerId)) {
          missionArenaLayers.add(providerLayerId);
        }
      }
    } else if (layer.query.providerId === "sim.tak-gateway") {
      for (const layerId of layer.query.providerLayerIds ?? []) {
        if (isTakGatewayLayerId(layerId)) {
          takLayers.add(layerId);
        }
      }
    }
  }

  return {
    ...(safetyLayers.size > 0
      ? {
          safety: {
            bbox: request.bbox,
            layers: Array.from(safetyLayers),
            limit: request.limit
          }
        }
      : {}),
    ...(communityLayerIds.size > 0
      ? {
          community: {
            bbox: request.bbox,
            layerIds: Array.from(communityLayerIds),
            limit: request.limit
          }
      }
      : {}),
    ...(missionArenaLayers.size > 0
      ? {
          missionArena: {
            bbox: request.bbox,
            layers: Array.from(missionArenaLayers),
            limit: Math.min(request.limit, 50)
          }
        }
      : {}),
    ...(flightLayers.size > 0
      ? {
          flight: {
            bbox: request.bbox,
            layers: Array.from(flightLayers),
            limit: request.limit
          }
        }
      : {}),
    ...(situationLayers.size > 0
      ? {
          situation: {
            bbox: request.bbox,
            layers: Array.from(situationLayers),
            limit: request.limit,
            ...(situationSources.size > 0 ? { sources: Array.from(situationSources) } : {}),
            ...(situationTechnology ? { technology: situationTechnology } : {})
          }
        }
      : {}),
    ...(takLayers.size > 0
      ? {
          tak: {
            bbox: request.bbox,
            layers: Array.from(takLayers),
            limit: request.limit
          }
        }
      : {})
  };
}

function readMapQueryTechnology(value: Record<string, unknown> | undefined): string | undefined {
  const raw = value?.technology;
  if (Array.isArray(raw)) {
    return raw.find((item): item is string => isCoverageTechnology(item));
  }
  return isCoverageTechnology(raw) ? raw : undefined;
}

function readDefaultTechnologyFilter(layer: MapCatalogLayer): string | undefined {
  const technologyFilter = layer.filters?.find((filter) => filter.filterId === "technology");
  const raw = technologyFilter?.defaultValue;
  if (Array.isArray(raw)) {
    return raw.find((item): item is string => isCoverageTechnology(item));
  }
  return isCoverageTechnology(raw) ? raw : undefined;
}

function isCoverageTechnology(value: unknown): value is string {
  return value === "2G" || value === "4G" || value === "5G";
}

function isSituationLayerId(value: string): value is SituationLayerId {
  return value === "air_quality"
    || value === "fire"
    || value === "flood"
    || value === "ground"
    || value === "mobile"
    || value === "mobile_coverage"
    || value === "mobile_network"
    || value === "traffic"
    || value === "warnings"
    || value === "weather_alerts"
    || value === "weather";
}

function isSafetyLayerId(value: string): value is SafetyLayerId {
  return value === "fire" || value === "flood" || value === "warnings" || value === "weather_alerts";
}

function isFlightReferenceLayerId(value: string): value is FlightReferenceLayerId {
  return value === "flight.airports" || value === "flight.airspaces";
}

function flightReferenceLayerIdForStream(streamId: string | undefined): FlightReferenceLayerId | undefined {
  if (streamId === "airports") {
    return "flight.airports";
  }
  if (streamId === "airspaces") {
    return "flight.airspaces";
  }
  return undefined;
}

function isTakGatewayLayerId(value: string): value is TakGatewayLayerId {
  return value === "ground" || value === "mobile" || value === "traffic";
}

function isMissionArenaLayerId(value: string): value is MissionArenaLayerId {
  return value === "presentation.mission_arena";
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

function filterSituationCollectionForCatalogLayers(
  collection: SituationFeatureCollection,
  selectedLayers: MapCatalogLayer[]
): SituationFeatureCollection {
  const situationLayers = selectedLayers.filter((layer) => layer.query.mode === "bbox" && layer.query.providerId === "sim.situation-data");
  if (situationLayers.length === 0) {
    return collection;
  }
  const features = collection.features.filter((feature) => situationLayers.some((layer) => situationFeatureMatchesCatalogLayer(feature, layer)));
  const sourceIds = new Set(features.map((feature) => feature.properties.sourceId));
  const sources = sourceIds.size > 0 ? collection.sources.filter((source) => sourceIds.has(source.sourceId)) : collection.sources;
  return {
    ...collection,
    features,
    sources,
    summary: {
      ...collection.summary,
      featureCount: features.length,
      sourceCount: sources.length,
      staleFeatureCount: features.filter((feature) => feature.properties.stale).length
    }
  };
}

function situationFeatureMatchesCatalogLayer(feature: SituationFeature, layer: MapCatalogLayer): boolean {
  const providerLayerIds = layer.query.providerLayerIds ?? [];
  if (providerLayerIds.length > 0 && !providerLayerIds.includes(feature.properties.layer)) {
    return false;
  }
  const providerSourceIds = layer.query.providerSourceIds ?? [];
  if (providerSourceIds.length > 0 && !providerSourceIds.includes(feature.properties.sourceId)) {
    return false;
  }
  const categoryIds = layer.query.categoryIds ?? [];
  if (categoryIds.length > 0 && !categoryIds.map(normalizeSituationCategoryId).includes(normalizeSituationCategoryId(feature.properties.category))) {
    return false;
  }
  return true;
}

function normalizeSituationCategoryId(value: string): string {
  return value.toLowerCase().replace(/[\s.-]+/g, "_");
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

function parseCommunityReportQuery(query: Record<string, unknown>, actor: AuthenticatedActor | null): CommunityReportQuery {
  return {
    ...(parseBboxQuery(query.bbox) ? { bbox: parseBboxQuery(query.bbox) } : {}),
    ...(parseCommunityCategories(query.category ?? query.categories).length > 0
      ? { categories: parseCommunityCategories(query.category ?? query.categories) }
      : {}),
    includeOwnDrafts: Boolean(actor) && (query.includeOwnDrafts === "true" || query.includeOwnDrafts === true),
    limit: optionalFiniteNumber(query.limit, 1, 500) ?? 100,
    ...(parseCommunityStatuses(query.status ?? query.statuses).length > 0
      ? { statuses: parseCommunityStatuses(query.status ?? query.statuses) }
      : {}),
    ...(actor ? { subjectId: actor.subjectId } : {})
  };
}

function normalizeCreateCommunityReport(
  value: unknown,
  actor: AuthenticatedActor,
  requestNow: Date
): Parameters<CommunityReportStore["createReport"]>[0] | null {
  if (!isRecord(value)) {
    return null;
  }
  const category = isCommunityReportCategory(value.category) ? value.category : undefined;
  const location = normalizeCommunityLocation(value.location, "device");
  if (!category || !location) {
    return null;
  }
  const title = optionalTrimmedString(value.title, 120) ?? communityCategoryLabel(category);
  const hazardSeverity = isCommunityReportHazardSeverity(value.hazardSeverity)
    ? value.hazardSeverity
    : isCommunityReportHazardSeverity(value.severity)
      ? value.severity
      : communitySeverity(category);
  const validUntil = optionalIsoTimestamp(value.validUntil);
  const properties = {
    ...normalizedJsonRecord(value.properties, 8000),
    hazardSeverity,
    ...(optionalUuid(value.groupId) ? { groupId: optionalUuid(value.groupId) } : {}),
    ...(optionalTrimmedString(value.groupName, 120) ? { groupName: optionalTrimmedString(value.groupName, 120) } : {}),
    ...(validUntil ? { validUntil } : {})
  };
  return {
    category,
    createdBy: {
      displayName: actor.displayName,
      subjectId: actor.subjectId,
      username: actor.username
    },
    ...(optionalTrimmedString(value.description, 2000) ? { description: optionalTrimmedString(value.description, 2000) } : {}),
    location,
    observedAt: optionalIsoTimestamp(value.observedAt, requestNow) ?? requestNow.toISOString(),
    properties,
    title,
    visibility: isCommunityVisibility(value.visibility) ? value.visibility : "community"
  };
}

function normalizeCommunityReportUpdate(value: unknown): Parameters<CommunityReportStore["updateReport"]>[2] | null {
  if (!isRecord(value)) {
    return null;
  }
  const category = isCommunityReportCategory(value.category) ? value.category : undefined;
  const location = normalizeCommunityLocation(value.location, "manual");
  const title = optionalTrimmedString(value.title, 120);
  const description = hasOwn(value, "description")
    ? optionalTrimmedString(value.description, 2000) ?? null
    : undefined;
  const hazardSeverity = isCommunityReportHazardSeverity(value.hazardSeverity)
    ? value.hazardSeverity
    : isCommunityReportHazardSeverity(value.severity)
      ? value.severity
      : undefined;
  const validUntil = hasOwn(value, "validUntil") ? optionalIsoTimestamp(value.validUntil) ?? null : undefined;
  const properties = {
    ...normalizedJsonRecord(value.properties, 8000),
    ...(hazardSeverity ? { hazardSeverity } : {}),
    ...(optionalUuid(value.groupId) ? { groupId: optionalUuid(value.groupId) } : {}),
    ...(optionalTrimmedString(value.groupName, 120) ? { groupName: optionalTrimmedString(value.groupName, 120) } : {})
  };
  const update = {
    ...(category ? { category } : {}),
    ...(description !== undefined ? { description } : {}),
    ...(location ? { location } : {}),
    ...(Object.keys(properties).length > 0 ? { properties } : {}),
    ...(title ? { title } : {}),
    ...(validUntil !== undefined ? { validUntil } : {}),
    ...(isCommunityVisibility(value.visibility) ? { visibility: value.visibility } : {})
  };
  return Object.keys(update).length > 0 ? update : null;
}

function actorToCommunityActor(actor: AuthenticatedActor) {
  return {
    displayName: actor.displayName,
    subjectId: actor.subjectId,
    username: actor.username
  };
}

function normalizeCommunityGroupRequest(value: unknown): {
  anchorLocation?: CommunityReportLocation;
  description?: string;
  metadata?: Record<string, unknown>;
  name: string;
  visibility: CommunityGroupVisibility;
} | null {
  if (!isRecord(value)) {
    return null;
  }
  const name = optionalTrimmedString(value.name, 80);
  if (!name) {
    return null;
  }
  return {
    ...(normalizeCommunityLocation(value.anchorLocation, "manual") ? { anchorLocation: normalizeCommunityLocation(value.anchorLocation, "manual") } : {}),
    ...(optionalTrimmedString(value.description, 500) ? { description: optionalTrimmedString(value.description, 500) } : {}),
    ...(isRecord(value.metadata) ? { metadata: normalizedJsonRecord(value.metadata, 4000) } : {}),
    name,
    visibility: isCommunityGroupVisibility(value.visibility) ? value.visibility : "private"
  };
}

function normalizeCommunityGroupMemberRequest(value: unknown): {
  displayName: string;
  role: CommunityGroupMemberRole;
  status: CommunityGroupMemberStatus;
  subjectId: string;
  username: string;
} | null {
  if (!isRecord(value)) {
    return null;
  }
  const subjectId = optionalTrimmedString(value.subjectId, 160);
  if (!subjectId) {
    return null;
  }
  const displayName = optionalTrimmedString(value.displayName, 160) ?? subjectId;
  const username = optionalTrimmedString(value.username, 160) ?? subjectId;
  return {
    displayName,
    role: isCommunityGroupMemberRole(value.role) ? value.role : "member",
    status: isCommunityGroupMemberStatus(value.status) ? value.status : "active",
    subjectId,
    username
  };
}

const messagingPlaintextKeys = new Set([
  "body",
  "comment",
  "comments",
  "content",
  "description",
  "draft",
  "lastMessage",
  "last_message",
  "message",
  "messagePreview",
  "message_preview",
  "messages",
  "note",
  "notes",
  "plaintext",
  "summary",
  "text",
  "transcript"
]);

const messagingMetadataKeys = new Set([
  "classification",
  "csmObjectId",
  "eventId",
  "eventType",
  "externalId",
  "incidentId",
  "objectId",
  "priority",
  "severity",
  "source",
  "tags"
]);

function normalizeMessagingConversationCreateRequest(value: unknown): MessagingConversationCreateRequest | null {
  if (!isRecord(value) || containsMessagingPlaintextKey(value)) {
    return null;
  }
  const title = optionalTrimmedString(value.title, 120);
  if (!title) {
    return null;
  }
  const mapLinks = normalizeMessagingMapLinks(value.mapLinks);
  const members = normalizeMessagingMembers(value.members);
  const metadata = normalizeMessagingMetadata(value.metadata);
  return {
    ...(mapLinks ? { mapLinks } : {}),
    ...(members ? { members } : {}),
    ...(metadata ? { metadata } : {}),
    title,
    type: value.type === "direct" ? "direct" : "group"
  };
}

function normalizeMatrixDeviceId(value: unknown): string | undefined {
  const deviceId = optionalTrimmedString(value, 64);
  return deviceId && /^[A-Za-z0-9._=-]{1,64}$/u.test(deviceId) ? deviceId : undefined;
}

function normalizeMatrixIdentityResolutionRequest(value: unknown): string[] | null {
  if (!isRecord(value) || containsMessagingPlaintextKey(value) || !Array.isArray(value.userIds)) {
    return null;
  }
  const userIds = Array.from(new Set(value.userIds
    .map((item) => optionalTrimmedString(item, 160))
    .filter((item): item is string => Boolean(item))
    .slice(0, 100)));
  return userIds.length > 0 ? userIds : null;
}

function normalizeMessagingConversationMembersRequest(value: unknown): MessagingConversationMember[] | null {
  if (!isRecord(value) || containsMessagingPlaintextKey(value)) {
    return null;
  }
  const members = normalizeMessagingMembers(value.members);
  return members?.length ? members : null;
}

function normalizeMatrixRoomBindingRequest(value: unknown): MessagingMatrixRoomBindingRequest | null {
  if (!isRecord(value) || containsMessagingPlaintextKey(value)) {
    return null;
  }
  const roomId = optionalTrimmedString(value.roomId, 512);
  if (!roomId || !/^![^\s:]+:.+$/u.test(roomId)) {
    return null;
  }
  return {
    ...(typeof value.encrypted === "boolean" ? { encrypted: value.encrypted } : {}),
    roomId
  };
}

function containsMessagingPlaintextKey(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.some(containsMessagingPlaintextKey);
  }
  if (!isRecord(value)) {
    return false;
  }
  return Object.entries(value).some(([key, nested]) =>
    messagingPlaintextKeys.has(key) || messagingPlaintextKeys.has(key.toLowerCase()) || containsMessagingPlaintextKey(nested)
  );
}

function normalizeMessagingMembers(value: unknown): MessagingConversationCreateRequest["members"] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const members = value.flatMap((item) => {
    if (typeof item === "string") {
      const userId = optionalTrimmedString(item, 128);
      return userId ? [{ userId }] : [];
    }
    if (!isRecord(item)) {
      return [];
    }
    const userId = optionalTrimmedString(item.userId ?? item.id, 128);
    return userId
      ? [{
          ...(optionalTrimmedString(item.displayName, 160) ? { displayName: optionalTrimmedString(item.displayName, 160) } : {}),
          ...(optionalTrimmedString(item.role, 32) ? { role: optionalTrimmedString(item.role, 32) } : {}),
          userId
        }]
      : [];
  });
  return members.length ? members.slice(0, 100) : undefined;
}

function normalizeMessagingMapLinks(value: unknown): MessagingMapLink[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const links = value.flatMap((item) => {
    if (!isRecord(item)) {
      return [];
    }
    const targetId = optionalTrimmedString(item.targetId, 160);
    if (!targetId) {
      return [];
    }
    const bbox = Array.isArray(item.bbox) && item.bbox.length === 4
      ? item.bbox.flatMap((coordinate) => typeof coordinate === "number" && Number.isFinite(coordinate) ? [coordinate] : [])
      : undefined;
    return [{
      ...(bbox?.length === 4 ? { bbox } : {}),
      ...(optionalTrimmedString(item.label, 160) ? { label: optionalTrimmedString(item.label, 160) } : {}),
      ...(optionalTrimmedString(item.layerId, 160) ? { layerId: optionalTrimmedString(item.layerId, 160) } : {}),
      targetId
    }];
  });
  return links.length ? links.slice(0, 25) : undefined;
}

function normalizeMessagingMetadata(value: unknown): MessagingConversationCreateRequest["metadata"] | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const metadata: NonNullable<MessagingConversationCreateRequest["metadata"]> = {};
  for (const [key, rawValue] of Object.entries(value)) {
    if (!messagingMetadataKeys.has(key)) {
      continue;
    }
    const normalizedValue = normalizeMessagingMetadataValue(rawValue);
    if (normalizedValue !== undefined) {
      metadata[key] = normalizedValue;
    }
  }
  return Object.keys(metadata).length ? metadata : undefined;
}

function normalizeMessagingMetadataValue(value: unknown): string | number | boolean | null | Array<string | number | boolean | null> | undefined {
  if (value === null || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : undefined;
  }
  if (typeof value === "string") {
    return optionalTrimmedString(value, 256);
  }
  if (Array.isArray(value)) {
    const values = value.flatMap((item) => {
      const normalized = normalizeMessagingMetadataValue(item);
      return normalized !== undefined && !Array.isArray(normalized) ? [normalized] : [];
    });
    return values.length ? values.slice(0, 32) : undefined;
  }
  return undefined;
}

function normalizeCommunityAttachmentRequest(value: unknown): {
  byteSize: number;
  capturedAt?: string;
  captureLocation?: CommunityReportLocation;
  checksumSha256?: string;
  contentType: string;
  fileName?: string;
  kind: CommunityAttachmentKind;
  metadata: Record<string, unknown>;
} | null {
  if (!isRecord(value)) {
    return null;
  }
  const contentType = optionalTrimmedString(value.contentType, 120)?.toLowerCase();
  const byteSize = optionalFiniteNumber(value.byteSize, 1, readPositiveInteger(process.env.COP_MEDIA_MAX_ATTACHMENT_BYTES, 25 * 1024 * 1024));
  const kind = isCommunityAttachmentKind(value.kind) ? value.kind : contentType ? kindFromContentType(contentType) : undefined;
  if (!contentType || byteSize === undefined || !kind || !isAllowedCommunityContentType(contentType, kind)) {
    return null;
  }
  return {
    byteSize,
    ...(optionalIsoTimestamp(value.capturedAt) ? { capturedAt: optionalIsoTimestamp(value.capturedAt) } : {}),
    ...(normalizeCommunityLocation(value.captureLocation, "photo_exif") ? { captureLocation: normalizeCommunityLocation(value.captureLocation, "photo_exif") } : {}),
    ...(optionalChecksumSha256(value.checksumSha256) ? { checksumSha256: optionalChecksumSha256(value.checksumSha256) } : {}),
    contentType,
    ...(optionalTrimmedString(value.fileName, 160) ? { fileName: optionalTrimmedString(value.fileName, 160) } : {}),
    kind,
    metadata: normalizedJsonRecord(value.metadata, 4000)
  };
}

function normalizeCommunityAttachmentUploadBody(value: unknown, declaredByteSize: number, maxByteSize: number): { body: Buffer } | null {
  if (Buffer.isBuffer(value)) {
    if (value.length < 1 || value.length > maxByteSize || value.length !== declaredByteSize) {
      return null;
    }
    return { body: value };
  }
  if (!isRecord(value)) {
    return null;
  }
  const rawData = typeof value.dataBase64 === "string"
    ? value.dataBase64
    : typeof value.base64 === "string"
      ? value.base64
      : undefined;
  if (!rawData) {
    return null;
  }
  const data = rawData.includes(",") ? rawData.slice(rawData.indexOf(",") + 1) : rawData;
  if (!/^[a-z0-9+/=\s]+$/iu.test(data)) {
    return null;
  }
  const body = Buffer.from(data.replace(/\s+/gu, ""), "base64");
  const requestedByteSize = optionalFiniteNumber(value.byteSize, 1, maxByteSize);
  if (body.length < 1 || body.length > maxByteSize || body.length !== declaredByteSize) {
    return null;
  }
  if (requestedByteSize !== undefined && requestedByteSize !== body.length) {
    return null;
  }
  return { body };
}

function canReadCommunityReport(report: CommunityReportRecord, actor: AuthenticatedActor | null): boolean {
  if (actor && report.createdBy.subjectId === actor.subjectId) {
    return true;
  }
  if (report.visibility === "private") {
    return false;
  }
  return report.status === "submitted" || report.status === "published";
}

function canReadCommunityGroup(group: CommunityGroupRecord, actor: AuthenticatedActor): boolean {
  return group.visibility === "public" || group.members.some((member) => member.subjectId === actor.subjectId);
}

function canUseCommunityGroupForReport(group: CommunityGroupRecord, actor: AuthenticatedActor): boolean {
  return group.members.some((member) =>
    member.subjectId === actor.subjectId
    && member.status === "active"
  );
}

function communityReportGroupId(report: Pick<CommunityReportRecord, "properties"> | { properties?: Record<string, unknown> }): string | undefined {
  return optionalUuid(report.properties?.groupId);
}

type CommunityAttachmentAccessMode = "groups" | "private" | "public" | "users";

interface CommunityAttachmentAccessPolicy {
  groupIds: string[];
  mode: CommunityAttachmentAccessMode;
  userSubjectIds: string[];
}

function canReadCommunityAttachment(
  report: CommunityReportRecord,
  attachment: CommunityReportAttachmentRecord | CommunityAttachmentResponse,
  actor: AuthenticatedActor | null,
  actorGroupIds: Set<string>
): boolean {
  if (actor && report.createdBy.subjectId === actor.subjectId) {
    return true;
  }
  const access = communityAttachmentAccessPolicy(attachment);
  if (access.mode === "public") {
    return canReadCommunityReport(report, actor);
  }
  if (!actor) {
    return false;
  }
  if (access.mode === "private") {
    return false;
  }
  if (access.mode === "users") {
    return access.userSubjectIds.includes(actor.subjectId);
  }
  return access.groupIds.some((groupId) => actorGroupIds.has(groupId));
}

function communityAttachmentAccessPolicy(attachment: { metadata?: Record<string, unknown> }): CommunityAttachmentAccessPolicy {
  const access = isRecord(attachment.metadata?.access) ? attachment.metadata.access : {};
  const mode = isCommunityAttachmentAccessMode(access.audience) ? access.audience : isCommunityAttachmentAccessMode(access.mode) ? access.mode : "public";
  return {
    groupIds: normalizeCsv(access.groupIds).slice(0, 50),
    mode,
    userSubjectIds: normalizeCsv(access.userSubjectIds ?? access.subjectIds).slice(0, 50)
  };
}

function communityAttachmentAccessSummary(attachment: { metadata?: Record<string, unknown> }): Record<string, unknown> {
  const access = communityAttachmentAccessPolicy(attachment);
  return {
    audience: access.mode,
    groupCount: access.groupIds.length,
    userCount: access.userSubjectIds.length
  };
}

function communityReportResponseItem(
  report: CommunityReportRecord,
  requestNow: Date,
  actor: AuthenticatedActor | null,
  actorGroupIds: Set<string>
): CommunityReportResponse {
  return {
    ...report,
    attachments: report.attachments.map((attachment) =>
      communityAttachmentResponseItem(
        attachment,
        report.reportId,
        canReadCommunityAttachment(report, attachment, actor, actorGroupIds),
        actor,
        requestNow
      )
    )
  };
}

function communityReportResponseItems(
  reports: CommunityReportRecord[],
  requestNow: Date,
  actor: AuthenticatedActor | null,
  actorGroupIds: Set<string>
): CommunityReportResponse[] {
  return reports.map((report) => communityReportResponseItem(report, requestNow, actor, actorGroupIds));
}

function communityAttachmentResponseItem(
  attachment: CommunityReportAttachmentRecord,
  reportId: string,
  canReadMedia = true,
  actor: AuthenticatedActor | null = null,
  requestNow = new Date()
): CommunityAttachmentResponse {
  return {
    ...attachment,
    ...communityAttachmentDerivativeResponse(attachment, reportId, canReadMedia, actor, requestNow),
    ...(attachment.status === "uploaded" && canReadMedia
      ? { contentUrl: communityAttachmentContentUrl(reportId, attachment.attachmentId, actor, requestNow) }
      : {})
  };
}

function communityAttachmentDerivativeResponse(
  attachment: CommunityReportAttachmentRecord,
  reportId: string,
  canReadMedia: boolean,
  actor: AuthenticatedActor | null = null,
  requestNow = new Date()
): { derivatives?: CommunityAttachmentDerivativeResponse[] } {
  const derivative = readSpatialDerivative(attachment);
  if (!derivative) {
    return {};
  }
  return {
    derivatives: [{
      ...(typeof derivative.byteSize === "number" ? { byteSize: derivative.byteSize } : {}),
      ...(derivative.contentType ? { contentType: derivative.contentType } : {}),
      ...(canReadMedia && derivative.status === "ready"
        ? { contentUrl: communityAttachmentDerivativeContentUrl(reportId, attachment.attachmentId, derivative.derivativeId, actor, requestNow) }
        : {}),
      derivativeId: derivative.derivativeId,
      ...(derivative.error ? { error: derivative.error } : {}),
      kind: "video",
      layout: derivative.layout,
      status: derivative.status,
      updatedAt: derivative.updatedAt
    }]
  };
}

function communityAttachmentContentUrl(
  reportId: string,
  attachmentId: string,
  actor: AuthenticatedActor | null,
  requestNow: Date
): string {
  const path = `/api/v1/community/reports/${encodeURIComponent(reportId)}/attachments/${encodeURIComponent(attachmentId)}/content`;
  return appendCommunityMediaTicket(path, reportId, attachmentId, undefined, actor, requestNow);
}

function communityAttachmentDerivativeContentUrl(
  reportId: string,
  attachmentId: string,
  derivativeId: string,
  actor: AuthenticatedActor | null,
  requestNow: Date
): string {
  const path = `/api/v1/community/reports/${encodeURIComponent(reportId)}/attachments/${encodeURIComponent(attachmentId)}/derivatives/${encodeURIComponent(derivativeId)}/content`;
  return appendCommunityMediaTicket(path, reportId, attachmentId, derivativeId, actor, requestNow);
}

function appendCommunityMediaTicket(
  path: string,
  reportId: string,
  attachmentId: string,
  derivativeId: string | undefined,
  actor: AuthenticatedActor | null,
  requestNow: Date
): string {
  if (!actor) {
    return path;
  }
  const mediaToken = createCommunityMediaTicket({
    actor,
    attachmentId,
    derivativeId,
    reportId,
    requestNow
  });
  return `${path}?mediaToken=${encodeURIComponent(mediaToken)}`;
}

function createCommunityMediaTicket({
  actor,
  attachmentId,
  derivativeId,
  reportId,
  requestNow
}: {
  actor: AuthenticatedActor;
  attachmentId: string;
  derivativeId?: string;
  reportId: string;
  requestNow: Date;
}): string {
  const ttlSeconds = readPositiveInteger(process.env.COP_MEDIA_ACCESS_TOKEN_TTL_SECONDS, 10 * 60);
  const payload: CommunityMediaTicketPayload = {
    attachmentId,
    ...(derivativeId ? { derivativeId } : {}),
    exp: Math.floor(requestNow.getTime() / 1000) + ttlSeconds,
    reportId,
    sub: actor.subjectId,
    v: 1
  };
  const encodedPayload = base64UrlEncode(Buffer.from(JSON.stringify(payload), "utf8"));
  return `${encodedPayload}.${signCommunityMediaTicket(encodedPayload)}`;
}

function hasValidCommunityMediaTicket(
  query: unknown,
  expected: {
    attachmentId: string;
    derivativeId?: string;
    reportId: string;
  },
  requestNow = new Date()
): boolean {
  const token = isRecord(query) && typeof query.mediaToken === "string" ? query.mediaToken : undefined;
  if (!token) {
    return false;
  }
  const [encodedPayload, signature, extra] = token.split(".");
  if (!encodedPayload || !signature || extra !== undefined) {
    return false;
  }
  const expectedSignature = signCommunityMediaTicket(encodedPayload);
  const signatureBuffer = Buffer.from(signature, "utf8");
  const expectedBuffer = Buffer.from(expectedSignature, "utf8");
  if (signatureBuffer.length !== expectedBuffer.length || !timingSafeEqual(signatureBuffer, expectedBuffer)) {
    return false;
  }
  const payload = parseCommunityMediaTicketPayload(encodedPayload);
  if (!payload) {
    return false;
  }
  const nowSeconds = Math.floor(requestNow.getTime() / 1000);
  return payload.v === 1
    && payload.exp >= nowSeconds
    && payload.reportId === expected.reportId
    && payload.attachmentId === expected.attachmentId
    && (payload.derivativeId ?? "") === (expected.derivativeId ?? "");
}

function parseCommunityMediaTicketPayload(encodedPayload: string): CommunityMediaTicketPayload | null {
  try {
    const parsed = JSON.parse(base64UrlDecode(encodedPayload).toString("utf8")) as unknown;
    if (!isRecord(parsed)
      || parsed.v !== 1
      || typeof parsed.exp !== "number"
      || typeof parsed.reportId !== "string"
      || typeof parsed.attachmentId !== "string"
      || (hasOwn(parsed, "derivativeId") && typeof parsed.derivativeId !== "string")) {
      return null;
    }
    return {
      attachmentId: parsed.attachmentId,
      ...(typeof parsed.derivativeId === "string" ? { derivativeId: parsed.derivativeId } : {}),
      exp: parsed.exp,
      reportId: parsed.reportId,
      ...(typeof parsed.sub === "string" ? { sub: parsed.sub } : {}),
      v: 1
    };
  } catch {
    return null;
  }
}

function signCommunityMediaTicket(encodedPayload: string): string {
  return base64UrlEncode(createHmac("sha256", communityMediaTicketSecret()).update(encodedPayload).digest());
}

function communityMediaTicketSecret(): string {
  return process.env.COP_MEDIA_ACCESS_TOKEN_SECRET
    ?? process.env.COP_LAB_TOKEN
    ?? "dev-community-media-ticket-secret";
}

function base64UrlEncode(value: Buffer): string {
  return value.toString("base64").replace(/\+/gu, "-").replace(/\//gu, "_").replace(/=+$/u, "");
}

function base64UrlDecode(value: string): Buffer {
  const padded = `${value}${"=".repeat((4 - value.length % 4) % 4)}`;
  return Buffer.from(padded.replace(/-/gu, "+").replace(/_/gu, "/"), "base64");
}

function communityReportsFeatureCollection(
  reports: CommunityReportRecord[],
  requestNow: Date,
  actor: AuthenticatedActor | null,
  actorGroupIds: Set<string>
) {
  return {
    features: reports.map((report) => ({
      geometry: {
        coordinates: [report.location.lon, report.location.lat],
        type: "Point" as const
      },
      id: report.reportId,
      properties: {
        attachmentCount: report.attachments.length,
        attachments: communityFeatureAttachments(report, actor, actorGroupIds, requestNow),
        category: report.category,
        confidence: report.location.accuracyM ? Math.max(0.35, Math.min(0.95, 1 - report.location.accuracyM / 1000)) : 0.7,
        description: report.description ?? null,
        documentCount: report.attachments.filter((attachment) => attachment.kind === "document" && attachment.status === "uploaded").length,
        featureId: `community:${report.reportId}`,
        groupId: typeof report.properties.groupId === "string" ? report.properties.groupId : null,
        groupName: typeof report.properties.groupName === "string" ? report.properties.groupName : null,
        hazardSeverity: communityReportSeverity(report),
        label: report.title,
        layer: "community",
        locationAccuracyM: report.location.accuracyM ?? null,
        observedAt: report.observedAt,
        photoCount: report.attachments.filter((attachment) => attachment.kind === "photo" && attachment.status === "uploaded").length,
        reportId: report.reportId,
        severity: communityReportSeverity(report),
        sourceId: "community_reports",
        status: report.status,
        stale: isCommunityReportStale(report, requestNow),
        validUntil: communityReportValidUntil(report) ?? null,
        videoCount: report.attachments.filter((attachment) => attachment.kind === "video" && attachment.status === "uploaded").length,
        visibility: report.visibility
      },
      type: "Feature" as const
    })),
    generatedAt: requestNow.toISOString(),
    source: {
      generatedAt: requestNow.toISOString(),
      sourceId: "community_reports",
      sourceType: "COMMUNITY_REPORTS"
    },
    summary: {
      featureCount: reports.length,
      submittedCount: reports.filter((report) => report.status === "submitted").length,
      uploadedAttachmentCount: reports.reduce(
        (sum, report) => sum + report.attachments.filter((attachment) => attachment.status === "uploaded").length,
        0
      )
    },
    type: "FeatureCollection" as const
  };
}

function communityFeatureAttachments(
  report: CommunityReportRecord,
  actor: AuthenticatedActor | null,
  actorGroupIds: Set<string>,
  requestNow: Date
): Array<{
  access: Record<string, unknown>;
  accessDenied?: boolean;
  attachmentId: string;
  byteSize: number;
  contentType: string;
  contentUrl?: string;
  derivatives?: CommunityAttachmentDerivativeResponse[];
  fileName?: string;
  kind: CommunityAttachmentKind;
  metadata?: Record<string, unknown>;
  uploadedAt?: string;
}> {
  return report.attachments
    .filter((attachment) => attachment.status === "uploaded")
    .map((attachment) => {
      const canReadMedia = canReadCommunityAttachment(report, attachment, actor, actorGroupIds);
      const existingContentUrl = (attachment as CommunityAttachmentResponse).contentUrl;
      return {
        access: communityAttachmentAccessSummary(attachment),
        ...(canReadMedia ? {} : { accessDenied: true }),
        attachmentId: attachment.attachmentId,
        byteSize: attachment.byteSize,
        contentType: attachment.contentType,
        ...(canReadMedia
          ? {
              contentUrl: typeof existingContentUrl === "string" && existingContentUrl
                ? existingContentUrl
                : communityAttachmentContentUrl(report.reportId, attachment.attachmentId, actor, requestNow)
            }
          : {}),
        ...communityAttachmentDerivativeResponse(attachment, report.reportId, canReadMedia, actor, requestNow),
        ...(attachment.fileName ? { fileName: attachment.fileName } : {}),
        kind: attachment.kind,
        ...(Object.keys(attachment.metadata ?? {}).length > 0 ? { metadata: attachment.metadata } : {}),
        ...(attachment.uploadedAt ? { uploadedAt: attachment.uploadedAt } : {})
      };
    });
}

function parseBboxQuery(value: unknown): CommunityReportQuery["bbox"] | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const parts = value.split(",").map(Number);
  if (parts.length !== 4 || !parts.every(Number.isFinite)) {
    return undefined;
  }
  const [west, south, east, north] = parts as [number, number, number, number];
  if (west >= east || south >= north) {
    return undefined;
  }
  return {
    east: clampNumber(east, -180, 180),
    north: clampNumber(north, -90, 90),
    south: clampNumber(south, -90, 90),
    west: clampNumber(west, -180, 180)
  };
}

function parseCommunityCategories(value: unknown): CommunityReportCategory[] {
  return normalizeCsv(value).filter(isCommunityReportCategory);
}

function parseCommunityStatuses(value: unknown): CommunityReportStatus[] {
  return normalizeCsv(value).filter(isCommunityReportStatus);
}

function normalizeCsv(value: unknown): string[] {
  const items = Array.isArray(value) ? value : typeof value === "string" ? value.split(",") : [];
  return Array.from(new Set(items.flatMap((item) => typeof item === "string" ? [item.trim()] : []).filter(Boolean)));
}

function normalizeCommunityLocation(value: unknown, fallbackSource: CommunityLocationSource): CommunityReportLocation | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const lat = optionalFiniteNumber(value.lat, -90, 90);
  const lon = optionalFiniteNumber(value.lon, -180, 180);
  if (lat === undefined || lon === undefined) {
    return undefined;
  }
  return {
    ...(optionalFiniteNumber(value.accuracyM, 0, 100000) !== undefined ? { accuracyM: optionalFiniteNumber(value.accuracyM, 0, 100000) } : {}),
    lat,
    lon,
    source: isCommunityLocationSource(value.source) ? value.source : fallbackSource
  };
}

function normalizedJsonRecord(value: unknown, maxJsonLength: number): Record<string, unknown> {
  if (!isRecord(value)) {
    return {};
  }
  const json = JSON.stringify(value);
  if (json.length > maxJsonLength) {
    return {};
  }
  return value;
}

function optionalIsoTimestamp(value: unknown, fallback?: Date): string | undefined {
  if (typeof value !== "string" || !value.trim()) {
    return fallback?.toISOString();
  }
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : fallback?.toISOString();
}

function optionalChecksumSha256(value: unknown): string | undefined {
  return typeof value === "string" && /^[0-9a-f]{64}$/iu.test(value.trim()) ? value.trim().toLowerCase() : undefined;
}

function kindFromContentType(contentType: string): CommunityAttachmentKind | undefined {
  if (contentType.startsWith("image/")) {
    return "photo";
  }
  if (contentType.startsWith("video/")) {
    return "video";
  }
  if (contentType === "application/pdf") {
    return "document";
  }
  return undefined;
}

function isAllowedCommunityContentType(contentType: string, kind: CommunityAttachmentKind): boolean {
  const allowedByKind: Record<CommunityAttachmentKind, string[]> = {
    document: ["application/pdf"],
    photo: ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"],
    video: ["video/mp4", "video/quicktime"]
  };
  return allowedByKind[kind].includes(contentType);
}

function isCommunityReportHazardSeverity(value: unknown): value is CommunityReportHazardSeverity {
  return value === "advisory" || value === "warning" || value === "critical";
}

function communityReportSeverity(report: CommunityReportRecord): CommunityReportHazardSeverity {
  const severity = report.properties.hazardSeverity ?? report.properties.severity;
  return isCommunityReportHazardSeverity(severity) ? severity : communitySeverity(report.category);
}

function communityReportValidUntil(report: CommunityReportRecord): string | undefined {
  const value = report.properties.validUntil;
  return typeof value === "string" && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : undefined;
}

function isCommunityReportStale(report: CommunityReportRecord, requestNow: Date): boolean {
  const validUntil = communityReportValidUntil(report);
  return validUntil ? Date.parse(validUntil) < requestNow.getTime() : false;
}

function communitySeverity(category: CommunityReportCategory): "advisory" | "warning" | "critical" {
  if (category === "fire" || category === "flood" || category === "medical") {
    return "critical";
  }
  if (category === "bridge_damage" || category === "road_blockage" || category === "infrastructure_damage" || category === "hazard") {
    return "warning";
  }
  return "advisory";
}

function communityCategoryLabel(category: CommunityReportCategory): string {
  const labels: Record<CommunityReportCategory, string> = {
    bridge_damage: "Poškozený most",
    fire: "Požár",
    flood: "Povodeň",
    hazard: "Riziko v okolí",
    infrastructure_damage: "Poškozená infrastruktura",
    medical: "Zdravotní událost",
    other: "Hlášení",
    road_blockage: "Neprůjezdná komunikace",
    utility_outage: "Výpadek služby"
  };
  return labels[category];
}

function isCommunityReportCategory(value: unknown): value is CommunityReportCategory {
  return value === "fire"
    || value === "flood"
    || value === "bridge_damage"
    || value === "road_blockage"
    || value === "infrastructure_damage"
    || value === "medical"
    || value === "utility_outage"
    || value === "hazard"
    || value === "other";
}

function isCommunityReportStatus(value: unknown): value is CommunityReportStatus {
  return value === "draft" || value === "submitted" || value === "published" || value === "hidden" || value === "rejected";
}

function isCommunityVisibility(value: unknown): value is CommunityReportVisibility {
  return value === "private" || value === "community" || value === "public";
}

function isCommunityGroupVisibility(value: unknown): value is CommunityGroupVisibility {
  return value === "private" || value === "public";
}

function isCommunityGroupMemberRole(value: unknown): value is CommunityGroupMemberRole {
  return value === "owner" || value === "admin" || value === "member";
}

function isCommunityGroupMemberStatus(value: unknown): value is CommunityGroupMemberStatus {
  return value === "active" || value === "pending";
}

function isCommunityAttachmentAccessMode(value: unknown): value is CommunityAttachmentAccessMode {
  return value === "public" || value === "private" || value === "users" || value === "groups";
}

function isCommunityLocationSource(value: unknown): value is CommunityLocationSource {
  return value === "device" || value === "manual" || value === "media_metadata" || value === "photo_exif" || value === "unknown";
}

function isCommunityAttachmentKind(value: unknown): value is CommunityAttachmentKind {
  return value === "photo" || value === "video" || value === "document";
}

function contentDispositionHeader(value: string): string {
  const fileName = sanitizeContentDispositionFileName(value);
  const fallback = fileName
    .replace(/[^\x20-\x7E]/gu, "_")
    .replace(/["\\;]/gu, "_")
    .trim()
    .slice(0, 160) || "attachment";
  return `inline; filename="${fallback}"; filename*=UTF-8''${encodeRfc5987FileName(fileName)}`;
}

function sanitizeContentDispositionFileName(value: string): string {
  return value.replace(/[\u0000-\u001F\u007F]/gu, "_").slice(0, 160) || "attachment";
}

function encodeRfc5987FileName(value: string): string {
  try {
    return encodeURIComponent(value).replace(/['()*]/gu, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
  } catch {
    return "attachment";
  }
}

function stripFileExtension(value: string): string {
  return sanitizeContentDispositionFileName(value).replace(/\.[^.]+$/u, "") || "attachment";
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
    communityReports: true,
    communityReportUploads: true,
    deviceRegistration: true,
    offlineSnapshot: true,
    pushNotifications: false,
    safetyContext: true,
    serverUserProfile: true,
    situationContext: true,
    sseStream: true,
    takGatewayContext: true,
    trackHistory: true
  };
}

function mobileEndpoints() {
  return {
    acknowledgeAlert: "/api/v1/cop/alerts/{alertId}/acknowledge",
    alerts: "/api/v1/cop/alerts",
    bootstrap: "/api/v1/mobile/bootstrap",
    communityReportAttachmentComplete: "/api/v1/community/reports/{reportId}/attachments/{attachmentId}/complete",
    communityReportAttachmentCreate: "/api/v1/community/reports/{reportId}/attachments",
    communityReportAttachmentDerivativeContent: "/api/v1/community/reports/{reportId}/attachments/{attachmentId}/derivatives/{derivativeId}/content",
    communityReportAttachmentUpload: "/api/v1/community/reports/{reportId}/attachments/{attachmentId}/upload",
    communityReportDelete: "/api/v1/community/reports/{reportId}",
    communityReportDetail: "/api/v1/community/reports/{reportId}",
    communityReportSubmit: "/api/v1/community/reports/{reportId}/submit",
    communityReportUpdate: "/api/v1/community/reports/{reportId}",
    communityReports: "/api/v1/community/reports",
    deviceRegistration: "/api/v1/mobile/devices",
    mapQuery: "/api/v1/map/query",
    offlineSnapshot: "/api/v1/mobile/offline-snapshot",
    preferences: "/api/v1/me/preferences",
    mapCatalog: "/api/v1/map/catalog",
    messagingBootstrap: "/api/v1/messaging/bootstrap",
    messagingConversations: "/api/v1/messaging/conversations",
    messagingMatrixIdentityResolution: "/api/v1/messaging/matrix/identities/resolve",
    messagingConversationMembers: "/api/v1/messaging/conversations/{conversationId}/members",
    messagingMatrixRoomBinding: "/api/v1/messaging/conversations/{conversationId}/matrix-room",
    messagingStatus: "/api/v1/messaging/status",
    sourceHealth: "/api/v1/sources/health",
    sources: "/api/v1/sources",
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
    glyphsTemplateUrl: env.COP_TILE_GLYPHS_URL ?? "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf",
    styleUrl: env.COP_MAP_STYLE_URL ?? "",
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
    catalogLayerIds: normalizeStringList(value.catalogLayerIds, 120, 140),
    domainScope: optionalString(value.domainScope, ["all", "AIR", "LAND", "SEA", "RESCUE", "OTHER"]),
    includeSynthetic: optionalBoolean(value.includeSynthetic),
    mapClusterEnabled: optionalBoolean(value.mapClusterEnabled),
    mapView: normalizeMapViewPreference(value.mapView),
    minConfidence: optionalFiniteNumber(value.minConfidence, 0, 1),
    predictionMinutes: optionalFiniteNumber(value.predictionMinutes, 2, 20),
    predictionMode: optionalString(value.predictionMode, ["adaptive", "telemetry", "history", "maneuver"]),
    proximityAlertEnabled: optionalBoolean(value.proximityAlertEnabled),
    publicFlightSymbolMode: optionalString(value.publicFlightSymbolMode, ["civil", "standard"]),
    refreshSeconds: optionalFiniteNumber(value.refreshSeconds, 1, 60),
    selectedLayer: optionalString(value.selectedLayer, ["air-situation", "sim-air", "uav", "friendly", "foreign", "public-flights", "data-quality"]),
    showAlertAreas: optionalBoolean(value.showAlertAreas),
    showHistory: optionalBoolean(value.showHistory),
    showPrediction: optionalBoolean(value.showPrediction),
    safetyLayerIds: optionalStringArray(value.safetyLayerIds, ["warnings", "flood"]),
    situationLayerIds: optionalStringArray(value.situationLayerIds, ["weather", "ground", "mobile", "mobile_network", "mobile_coverage", "traffic", "air_quality"]),
    situationSourceIds: normalizeStringList(value.situationSourceIds, 32, 80),
    takLayerIds: optionalStringArray(value.takLayerIds, ["mobile", "ground", "traffic"]),
    trackLayerIds: optionalStringArray(value.trackLayerIds, ["air-situation", "sim-air", "uav", "friendly", "foreign", "public-flights", "data-quality"]),
    trackHistoryDisplayMode: optionalString(value.trackHistoryDisplayMode, ["all", "selected"]),
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
  const polygon = normalizeAoiPolygon(value.polygon);
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
      ...(polygon ? { polygon } : {}),
      radiusKm,
      ...(isCopAlertSeverity(value.severity) ? { severity: value.severity } : {})
    }
  ];
}

function normalizeAoiPolygon(value: unknown): AoiRule["polygon"] | undefined {
  if (!isRecord(value) || value.type !== "Polygon" || !Array.isArray(value.coordinates)) {
    return undefined;
  }
  const rings = value.coordinates.flatMap((ring) => normalizeAoiPolygonRing(ring));
  return rings.length > 0 ? { type: "Polygon", coordinates: rings.slice(0, 4) } : undefined;
}

function normalizeAoiPolygonRing(value: unknown): Array<Array<[number, number]>> {
  if (!Array.isArray(value)) {
    return [];
  }
  const points = value.flatMap((coordinate): Array<[number, number]> => {
    if (!Array.isArray(coordinate) || coordinate.length < 2) {
      return [];
    }
    const lon = optionalFiniteNumber(coordinate[0], -180, 180);
    const lat = optionalFiniteNumber(coordinate[1], -90, 90);
    return lon === undefined || lat === undefined ? [] : [[lon, lat]];
  }).slice(0, 160);
  if (points.length < 3) {
    return [];
  }
  const closed = closeAoiPolygonRing(points);
  return closed.length >= 4 ? [closed] : [];
}

function closeAoiPolygonRing(points: Array<[number, number]>): Array<[number, number]> {
  const first = points[0];
  const last = points[points.length - 1];
  if (!first || !last) {
    return points;
  }
  if (first[0] === last[0] && first[1] === last[1]) {
    return points;
  }
  return [...points, first];
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

function optionalUuid(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(normalized)
    ? normalized.toLowerCase()
    : undefined;
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

function mapCatalogProviderTimeoutMs(): number {
  return readPositiveInteger(process.env.COP_MAP_CATALOG_PROVIDER_TIMEOUT_MS, 3500);
}

function healthDependencyTimeoutMs(): number {
  return readPositiveInteger(process.env.COP_HEALTH_DEPENDENCY_TIMEOUT_MS, 2500);
}

function parseBooleanQuery(value: unknown): boolean {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value !== "string") {
    return false;
  }
  return value === "true" || value === "1" || value === "yes" || value === "on";
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
